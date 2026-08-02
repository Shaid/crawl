"""Amiga sequential-planar bitmap decoding.

Numpy port of the decoder that produced the verified reference renders. Planes
are stored one whole plane after another, each (width / 8) * height bytes;
plane 0 contributes bit 0. This is *not* row-interleaved — that layout was
tried and produces vertically scrambled output.

Mirrors `decodePlanar` in tools/shared/amiga-planar.ts; the two must agree.
"""
import numpy as np


def decode_planar(data, width, height, planes=6):
    """Decode sequential-planar data into a (height, width) index array.

    Returns None when `data` is too short for the requested geometry.
    """
    bpr = width // 8
    need = bpr * height * planes
    if len(data) < need:
        return None
    buf = np.frombuffer(data[:need], dtype=np.uint8).reshape(planes, height, bpr)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :width]
    weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
    return (bits * weights).sum(axis=0).astype(np.uint8)


def decode_masked(data, width, height, color_planes=6):
    """Decode a mask plane followed by `color_planes` colour planes.

    This is the bcdfb-bcdfn monster sprite layout: 7 planes total, where plane 0
    is a 1-bit opacity mask (1 = opaque) and planes 1..6 carry a 6bpp EHB colour
    index. Returns (indices, mask) or (None, None) if the data is short.
    """
    bpr = width // 8
    plane_size = bpr * height
    need = plane_size * (color_planes + 1)
    if len(data) < need:
        return None, None
    mask = decode_planar(data, width, height, 1)
    indices = decode_planar(data[plane_size:], width, height, color_planes)
    return indices, mask


def decode_sprite_pair(data, lines, record_bytes=96):
    """Decode an *attached* Amiga hardware-sprite pair into an index array.

    Sprite data is 16 px wide and stored one scanline at a time as two big-
    endian words (SPRxDATA, SPRxDATB) = 2 bitplanes. An attached pair chains
    an even sprite (planes 0-1) with the following odd one (planes 2-3),
    giving 15 colours; the odd sprite's data lives `record_bytes` further on
    in the source bank. Returns a (lines, 16) index array whose value `v`
    lights hardware colour register 16 + v (0 = transparent).
    """
    out = np.zeros((lines, 16), dtype=np.uint8)
    for plane_pair in (0, 1):
        base = plane_pair * record_bytes
        raw = np.frombuffer(data[base:base + lines * 4], dtype=np.uint8)
        rows = raw.reshape(lines, 4)
        bits = np.unpackbits(rows, axis=1, bitorder='big').reshape(lines, 2, 16)
        out |= (bits[:, 0] << (plane_pair * 2)).astype(np.uint8)
        out |= (bits[:, 1] << (plane_pair * 2 + 1)).astype(np.uint8)
    return out


def decode_stencil(data, width, height):
    """Decode a bare 1-bit stencil plane into a (height, width) 0/1 array.

    Used for assets that carry no colour data at all -- currently only the
    dungeon tilesets' `door-clip-stencil`, which the door open/close animation
    feeds to the blitter's A channel. Returns None when `data` is short.
    """
    return decode_planar(data, width, height, 1)


def stencil_to_rgba(mask):
    """Render a 0/1 stencil as an opaque-white silhouette on transparent."""
    h, w = mask.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    on = mask > 0
    out[on] = (255, 255, 255, 255)
    return out


def to_rgba(indices, palette, mask=None, transparent_index0=False):
    """Map an index array to an (h, w, 4) uint8 RGBA array.

    `palette` is a flat list of RGB triplets (see palette.ehb_palette).
    Alpha comes from `mask` when given, otherwise from `transparent_index0`.
    Indices with no palette entry render magenta so mistakes stay visible.
    """
    h, w = indices.shape
    pal = np.zeros((256, 3), dtype=np.uint8)
    pal[:] = (255, 0, 255)
    n = min(256, len(palette) // 3)
    for i in range(n):
        pal[i] = palette[i * 3:i * 3 + 3]

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = pal[indices]
    if mask is not None:
        out[:, :, 3] = np.where(mask > 0, 255, 0)
    elif transparent_index0:
        out[:, :, 3] = np.where(indices > 0, 255, 0)
    else:
        out[:, :, 3] = 255
    return out

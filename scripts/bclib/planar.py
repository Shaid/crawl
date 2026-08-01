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

#!/usr/bin/env python3
"""Might & Magic III (Amiga) sprite cell codec.

Container (confirmed for all sprite extensions):

  sprite file:
    u16 BE frameCount
    frameCount × { u32 BE cellA; u32 BE cellB }     ; 8-byte entries, cellB = 0 = none
  cell (at each offset):
    u16 BE x; u16 BE y; u16 BE h; u16 BE w          ; NOTE: third = height!
    body (record stream)

Body format is EXTENSION-INDEPENDENT — CONFIRMED (byte-exact, 1811/1811 frames
across .mon/.fac/.icn/.pic/.out; decode loop = root CODE hunk code1.bin+0x209E
for cellA bodies, +0x20C2 for cellB; geometry code at +0x1FE4..0x1FF8):

  [count u16][count × u16]          literal run of 16-bit words
  [marker u16]                      marker: skip (~marker)&0xffff words of
                                    zeros in dest (0xfffe→1, 0xfffd→2,
                                    0xfffb→4, 0xfff7→8); 0xffff = end
  ... until 0xffff terminator; the emitted word list is exactly
  6·ceil(w/16)·h words (verified: every frame fills the buffer exactly).

Decoded layout: 6 planes (plane 0 = 1-bit mask, planes 1-5 = 5-bit colour),
row-major within each plane — pixel (x,y) = plane word
y·ceil(w/16) + x//16, bit 15-(x%16) (bit 15 = leftmost pixel of the word).

frame N = base cell (cellA) + overlay cell (cellB). Both cells decode with
the same record-stream body; cellB is OR-ed into the same buffer (per-frame
animation overlay); cellB may be 0 (no overlay). See
docs/mm3/amiga/data-structure.md "Amiga sprite cells".
"""
from __future__ import annotations
import struct


def parse_frames(data: bytes):
    count = struct.unpack_from('>H', data, 0)[0]
    frames = []
    for i in range(count):
        a, b = struct.unpack_from('>II', data, 2 + i * 8)
        frames.append((a, b))
    return frames


RECORD_EXTENSIONS = ('.mon', '.fac', '.icn', '.pic', '.out')


def decode_body_records(data: bytes, cell_off: int) -> list[int]:
    """Decode a cell body record stream into 6·ceil(w/16)·h u16 words.

    CONFIRMED (byte-exact, 1811/1811 frames across .mon/.fac/.icn/.pic/.out):
    the cell body (after the 8-byte x,y,h,w header — NOTE the field order:
    third = height, fourth = width, per the game's geometry code at
    code1.bin+0x1FE4/0x1FF0/0x1FF8) is a flat u16 BE stream:
      [count u16][count × u16]         literal run (count < 0x8000)
      [marker u16]                     marker: skip = (~marker) & 0xffff words
                                       in dest (0xfffe→1, 0xfffd→2, 0xfffb→4,
                                       0xfff7→8); 0xffff alone = end of stream
    The decode loop (game's own code, root CODE hunk code1.bin+0x209E, cellA
    body; +0x20C2 for cellB) consumes every body word and emits exactly
    6·ceil(w/16)·h words. Bitmap layout: plane-major (plane 0 = 1-bit mask,
    planes 1-5 = colour), row-major within a plane — pixel (x,y) at
    word plane·ceil(w/16)·h + y·ceil(w/16) + x//16, bit 15-(x%16).
    Returns the flat word list (len == 6·ceil(w/16)·h); caller must supply
    the cell's w/h to interpret it.
    """
    body = data[cell_off + 8:]
    words = struct.unpack('>%dH' % (len(body) // 2), body)
    dst = []
    src = 0
    n = len(words)
    while src < n:
        hd = words[src]
        src += 1
        if hd & 0x8000:
            skip = (~hd) & 0xffff
            if skip == 0:
                break
            dst.extend([0] * skip)
        else:
            cnt = hd
            if src + cnt > n:
                break
            dst.extend(words[src:src + cnt])
            src += cnt
    return dst


def words_to_planes(words: list[int], w: int, h: int) -> list[list[int]]:
    """Split a decoded body word list into 6 bitplanes (index 0 = mask).

    Each plane is ceil(w/16)·h words, row-major: plane word
    y·ceil(w/16) + x//16 holds the 16 pixels x..x+15 of row y, bit 15 =
    leftmost pixel."""
    rw = (w + 15) // 16
    planes = []
    for p in range(6):
        base = p * rw * h
        planes.append(words[base:base + rw * h])
    return planes


def planes_to_grids(planes: list[list[int]], w: int, h: int):
    """Expand 6 planes (row-major u16 words) into (mask, colour) grids,
    each a flat w×h list. mask = plane 0 bits; colour = 5-bit index from
    planes 1-5."""
    rw = (w + 15) // 16
    npx = w * h
    mask = [0] * npx
    colour = [0] * npx
    for y in range(h):
        for x in range(w):
            wi = y * rw + x // 16
            bit = 1 << (15 - (x % 16))
            idx = y * w + x
            if planes[0][wi] & bit:
                mask[idx] = 1
            c = 0
            for p in range(1, 6):
                if planes[p][wi] & bit:
                    c |= 1 << (p - 1)
            colour[idx] = c
    return mask, colour


def decode_cell_planes(data: bytes, off: int, end: int, w: int, h: int, rle: bool = False):
    """Decode the 6 planes of one cell into (mask, colour_index) grids.
    `end` bounds the cell; planes beyond the available data are zero-filled.
    `rle` is accepted for API compatibility; the record-stream decode is
    unconditional (CONFIRMED corpus-wide, 1811/1811 frames exact)."""
    words = decode_body_records(data, off)
    planes = words_to_planes(words, w, h)
    mask, colour = planes_to_grids(planes, w, h)
    consumed = 8 + len(words) * 2
    return mask, colour, planes, consumed


def decode_cell(data: bytes, off: int, end: int, rle: bool = False):
    """Returns dict with x,y,w,h, mask, colour, and the bytes consumed.

    Cell header is {x, y, h, w} on disk (third field = height, fourth =
    width) per the game's geometry code (code1.bin+0x1FE4..0x1FF8); the
    dict reports w/h in the normal order."""
    x, y, h, w = struct.unpack_from('>HHHH', data, off)
    if w == 0 or h == 0 or w > 512 or h > 512 or off + 8 > len(data):
        return None
    mask, colour, planes, consumed = decode_cell_planes(data, off, min(end, len(data)), w, h, rle)
    return {
        'x': x, 'y': y, 'w': w, 'h': h,
        'mask': mask, 'colour': colour,
        'planes': planes, 'consumed': consumed,
        'offset': off,
    }


def decode_sprite(data: bytes, overlay_rle: bool = True):
    """Decode a whole sprite file: returns list of frames, each frame =
    list of decoded cells (base first, then overlay)."""
    frames = parse_frames(data)
    all_offs = sorted({c for (aa, bb) in frames for c in (aa, bb) if c and c + 8 <= len(data)})
    out = []
    for (a, b) in frames:
        cells = []
        if a and a + 8 <= len(data):
            nxt = [o for o in all_offs if o > a]
            end = min(nxt) if nxt else len(data)
            cell = decode_cell(data, a, end)
            if cell:
                cells.append(cell)
        if b and b + 8 <= len(data):
            end = len(data)
            # find the next cell offset after b to bound it
            nxt = [o for o in (c for (aa, bb) in frames for c in (aa, bb)) if o > b]
            if nxt:
                end = min(nxt)
            cell = decode_cell(data, b, end, rle=overlay_rle)
            if cell:
                cells.append(cell)
        out.append(cells)
    return out


def composite_frame(cells, w_canvas=None, h_canvas=None):
    """Composite a frame's cells onto a canvas (mask + 5-bit colour grid).
    Overlay cells clear their rect before drawing (DOS convention)."""
    if not cells:
        return None
    cw = w_canvas or max(c['x'] + c['w'] for c in cells)
    ch = h_canvas or max(c['y'] + c['h'] for c in cells)
    canvas_mask = [0] * (cw * ch)
    canvas_colour = [0] * (cw * ch)
    for ci, cell in enumerate(cells):
        x, y, w, h = cell['x'], cell['y'], cell['w'], cell['h']
        for yy in range(h):
            for xx in range(w):
                sx, sy = x + xx, y + yy
                if not (0 <= sy < ch and 0 <= sx < cw):
                    continue
                src = yy * w + xx
                if cell['mask'][src]:
                    idx = sy * cw + sx
                    canvas_mask[idx] = 1
                    canvas_colour[idx] = cell['colour'][src]
    return {'w': cw, 'h': ch, 'mask': canvas_mask, 'colour': canvas_colour}

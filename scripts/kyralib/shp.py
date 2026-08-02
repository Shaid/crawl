"""Lands of Lore ".SHP" multi-frame shape/sprite format, DOS/VGA.

Ported from ScummVM's Screen_v2::getPtrToShape/getShapeSize
(engines/kyra/graphics/screen_v2.cpp:192-232) and the shape-header +
scanline-stream parsing inside Screen::drawShape
(engines/kyra/graphics/screen.cpp:1709-2059,2171-2184,2429-2439), fetched
2026-08-02.

A `.SHP` file is a standard kyralib.format80 Kyra bitmap (10-byte header +
LCW payload) whose DECOMPRESSED payload is a shape directory:

    u16 numShapes
    u32[numShapes + 1] offsets   (sentinel last entry; each shape's real
                                  byte position is `offsets[i] + 2`, per
                                  ScummVM's `getPtrToShape`)
    <shape 0 bytes><shape 1 bytes>...

Per-shape header (all offsets relative to the shape's own start = `offsets[i]+2`):
    u16  shapeFlags   bit0 = has an embedded per-shape colour remap table;
                       bit1 = payload is NOT LCW-compressed (raw scanline
                       stream already); bit2 = colourTableColors is an
                       explicit byte (else defaults to 16, Kyra1 only —
                       LOL/EOB2 always have bit2 set in this corpus)
    u8   height
    u16  width
    u8[3] unknown     (skipped by the reference decoder; not decoded here)
    u16  frameSize    uncompressed scanline-stream byte size (LCW dest size
                       if bit1 clear)
    u8   colourTableColors   present iff shapeFlags & 4
    u8[colourTableColors] colourTable   present iff shapeFlags & 1
    <payload>          LCW-compressed (if !bit1) or raw (if bit1) scanline
                       stream, `frameSize` bytes once decompressed

Scanline stream (Screen::drawShapeProcessLineNoScaleUpwind): read bytes
until `width` output pixels have been produced per row, `height` rows:
    byte c != 0   -> one opaque pixel; the *palette index* is
                     `colourTable[c]` if a colour table is present
                     (Screen::drawShapePlotType37, the LoL monster/creature
                     plot routine used at runtime), else `c` directly.
    byte c == 0   -> next byte is a transparent-pixel run length; advance
                     the output cursor that many pixels without drawing.

Verified: `MONSTER.PAK`'s `LIZARD.SHP` decompresses (outer LCW) to exactly
its header's declared size; its directory holds 17 shapes, 16 of which
report identical 82x86 dimensions (a walk/attack animation cycle) plus one
5x20 outlier (shape 16, flags=2 i.e. uncompressed/no colour table — likely
a cursor or UI glyph bundled in the same file, not a monster frame); each
shape's scanline stream decodes to exactly `height` full rows of `width`
pixels with no overrun/underrun across all 17 shapes. See
docs/landsoflore/dosvga/data-structure.md.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

from .format80 import decompress_bitmap, decode_frame4


@dataclass
class ShpShape:
    flags: int
    width: int
    height: int
    frame_size: int
    color_table: bytes | None
    pixel_stream: bytes  # decompressed scanline stream, `frame_size` bytes


def parse_shp_container(chunk: bytes) -> list[ShpShape]:
    _header, payload = decompress_bitmap(chunk)
    count = struct.unpack_from('<H', payload, 0)[0]
    raw_offsets = struct.unpack_from(f'<{count + 1}I', payload, 2)

    shapes = []
    for i in range(count):
        p = raw_offsets[i] + 2
        flags = struct.unpack_from('<H', payload, p)[0]
        height = payload[p + 2]
        width = struct.unpack_from('<H', payload, p + 3)[0]
        frame_size = struct.unpack_from('<H', payload, p + 8)[0]
        q = p + 10
        color_table = None
        if flags & 4:
            n_colors = payload[q]; q += 1
        else:
            n_colors = 16
        if flags & 1:
            color_table = payload[q:q + n_colors]
            q += n_colors

        if flags & 2:
            stream = payload[q:q + frame_size]
        else:
            stream = decode_frame4(payload[q:], frame_size)

        shapes.append(ShpShape(flags, width, height, frame_size, color_table, stream))
    return shapes


def decode_shape_indices(shape: ShpShape) -> np.ndarray:
    """Decode one shape's scanline stream -> (height, width) uint8 palette
    indices, with 0 reserved to mean 'transparent' (matches this project's
    convention of treating index 0 as transparent for VGA atlases -- a
    remapped colour-table entry that lands on 0 will also render
    transparent, a minor known imprecision noted in the docs).

    A remapped value of 255 is Screen::drawShapePlotType37's shadow/blend
    sentinel (`if (cmd == 255) cmd = _dsBackgroundFadingTable[*dst];` —
    engines/kyra/graphics/screen.cpp:2429-2437): at runtime it looks up a
    fade table keyed on whatever's *already on screen* at that pixel, which
    a static, background-less extractor has no equivalent for. Rendered as
    transparent here rather than literal palette index 255 (which is a
    bright magenta/reserved VGA slot in most Kyra palettes and looks like a
    decode bug otherwise) — an approximation, not a decode of the real
    shadow effect."""
    out = np.zeros((shape.height, shape.width), dtype=np.uint8)
    src = shape.pixel_stream
    sp = 0
    table = shape.color_table
    for row in range(shape.height):
        x = 0
        while x < shape.width:
            c = src[sp]; sp += 1
            if c:
                v = table[c] if table is not None and c < len(table) else c
                out[row, x] = 0 if v == 255 else v
                x += 1
            else:
                run = src[sp]; sp += 1
                x += run
    return out

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


SCREEN_W = 320  # Screen::SCREEN_W (screen.h:590) -- the page-buffer row stride
                # loadMonsterShapes' tmpPal1 sampling loop steps by.


def decode_palette_strip_base_table(shapes: list[ShpShape]) -> np.ndarray:
    """Reconstruct `tmpPal1`, the 64-entry "base colour" table
    LoLEngine::loadMonsterShapes builds from shape index 16 -- the small
    "palette strip" image every monster .SHP bundles alongside its 16
    animation frames (engine/sprites_lol.cpp:70-80, fetched 2026-09-02):

        uint8 *palShape = _screen->makeShapeCopy(p, 16);
        _screen->clearPage(3);
        _screen->drawShape(2, palShape, 0, 0, 0, 0);
        uint8 *tmpPal1 = new uint8[64]();
        for (int i = 0; i < 64; i++) {
            tmpPal1[i] = *p;
            p += 320;
        }

    `getCPagePtr(2)`/`getPagePtr(3)` alias the SAME physical buffer: in VGA
    mode `Screen::_pageMapping[i] = i & ~1` for every page (screen.cpp:209-211),
    so page 2 and page 3 share one 320x200-byte allocation. `clearPage(3)`
    therefore zeroes the exact buffer `p` (captured earlier as
    `getCPagePtr(2)`, right after `loadBitmap(file, 3, 3, 0)` decompressed the
    .SHP payload into it) still points at; `drawShape(2, palShape, 0, 0, 0, 0)`
    then draws shape 16 back into that now-blank buffer at (0,0), unscaled,
    with no external colour-table override (flags=0) -- shape 16 itself
    almost always has shapeFlags bit0 clear too (no internal remap table
    either), so its raw stream bytes are written as literal VGA palette
    indices, transparent runs left as the cleared 0.

    The sampling loop then walks straight down COLUMN 0 of that buffer for
    64 rows (`p += 320` == one screen row per step). Since shape 16 is only
    `strip.height` rows tall (<=20 in every monster .SHP seen in this
    corpus) and the buffer was fully zeroed first, rows `height..63` read
    back as 0 -- `decode_shape_indices`' own "untouched pixel stays 0"
    convention already reproduces this exactly, so this function just reuses
    it and pads/truncates column 0 to 64 entries.

    Verified against `LIZARD.SHP` (2026-09-02): decoded column 0 for shape
    16's real 20 rows is `[65,66,67,68,69,70,71,72,73,74,1,50,48,47,75,4,5,
    6,7,0]` -- a clean 65..74 ascending ramp (10 consecutive VGA palette
    slots, plausibly a shading/skin-tone bank) followed by 9 discrete
    "anchor" colour values (eyes/teeth/highlight swatches) and one terminal
    0 (row 19 is entirely transparent) -- exactly the shape a hand-authored
    per-monster colour key would take, not noise."""
    strip = shapes[16]
    grid = decode_shape_indices(strip)  # (height, width), 0 = untouched/transparent
    base = np.zeros(64, dtype=np.uint8)
    h = min(64, grid.shape[0])
    base[:h] = grid[:h, 0]
    return base


def compute_monster_brightness_palettes(shape: ShpShape, base_table: np.ndarray,
                                         strip_grid: np.ndarray) -> np.ndarray:
    """Reconstruct one animation frame's `_monsterPalettes[pos]` -- an
    `(8, numCol)` array of colour-table variants, one row per "brightness"
    level selected at render time by `LoLEngine::drawMonster`'s
    `int d = m->flags & 7;` (engine/sprites_lol.cpp:603,611):

        uint8 *monsterPalette = d ? _monsterPalettes[pos] + (shp[10] * (d - 1)) : 0;

    `d == 0` (the common/default case -- an undamaged, unflagged monster)
    passes a NULL palette override and draws with the shape's own embedded
    `color_table` unmodified; this function's output is only consulted for
    `d in 1..7`. It is NOT needed to render a monster's default appearance
    -- `decode_shape_indices` (using `color_table[c]` directly, already
    implemented) is the complete base-render decode.

    Ported from engine/sprites_lol.cpp:81-112 (fetched 2026-09-02):

        for (int ii = 0; ii < numCol; ii++) {
            uint8 *cl = (uint8 *)memchr(tmpPal1, tmpPal2[1 + ii], 64);
            if (!cl) continue;
            tmpPal3[ii] = (uint16)(cl - tmpPal1);
        }
        for (int ii = 0; ii < 8; ii++) {
            for (int iii = 0; iii < numCol; iii++) {
                if (tmpPal3[iii] == 0xFFFF) continue;
                if (p[tmpPal3[iii] * 320 + ii + 1])
                    tmpPal2[1 + iii] = p[tmpPal3[iii] * 320 + ii + 1];
            }
            memcpy(_monsterPalettes[pos] + ii * numCol, &tmpPal2[1], numCol);
        }

    i.e. for each of a frame's `numCol` colour-table entries, find which ROW
    of the palette-strip image (`strip_grid`, the same buffer
    `decode_palette_strip_base_table` samples column 0 of) that entry's
    value first appears in (via `base_table`), then for brightness level
    `ii` (0-7) read that SAME row's column `ii+1` as the replacement colour
    -- falling back to the frame's own original value when that pixel is
    transparent/out of the strip's width (`shape 16` is only 5px/4 real
    columns wide in every monster .SHP checked, so levels `ii>=3` degrade to
    "unchanged" for most colour-table entries; this is a real, confirmed
    property of the authored strip data, not a decode bug)."""
    if shape.color_table is None:
        return np.zeros((8, 0), dtype=np.uint8)
    color_table = np.frombuffer(shape.color_table, dtype=np.uint8)
    num_col = len(color_table)
    row_for = np.full(num_col, -1, dtype=np.int32)
    for i, v in enumerate(color_table):
        matches = np.nonzero(base_table == v)[0]
        if len(matches):
            row_for[i] = matches[0]

    out = np.zeros((8, num_col), dtype=np.uint8)
    strip_h, strip_w = strip_grid.shape
    for level in range(8):
        col = level + 1
        row = color_table.copy()
        if col < strip_w:
            for i in range(num_col):
                r = row_for[i]
                if r < 0 or r >= strip_h:
                    continue
                v = strip_grid[r, col]
                if v:
                    row[i] = v
        out[level] = row
    return out


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

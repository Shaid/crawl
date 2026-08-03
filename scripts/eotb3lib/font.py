"""CHARGEN/FONT6.FNT + FONT8.FNT bit-packed font decoder, plus the
proportional-width "resource font" format (EYE.RES/HACK.RES/OPEN.RES
"<N>x8 font"/"Ornate font"/"Font" resources).

Part 1, confirmed byte-exact against data/eotb3/dosvga/CHARGEN/FONT6.FNT
(1028 B) and FONT8.FNT (1284 B), cross-checked against ThirdEye's
apps/thirdeye/graphics/font.cpp ("isChargenFnt" branch).

Layout:
    u16 fileSize - 2                (sanity check value)
    u16 offsets[128]                one per ASCII 0..127, file-relative
    u8  glyphData[]                 8-column bitmap rows, 1 byte/row,
                                     bit 7 = leftmost pixel

Glyph height for character i = offsets[i+1] - offsets[i] (or
fileSize - offsets[i] for i == 127); glyph width is fixed at 8 pixels.
FONT6.FNT glyphs are 6 rows tall, FONT8.FNT glyphs are 8 rows tall (hence
the filenames) -- but this is a consequence of the offset deltas, not a
declared field.

Part 2, `load_resource_font`/`looks_like_resource_font`: a *different*,
proportional-width font resource format embedded directly in
HACK.RES/OPEN.RES (Dungeon Hack) under names like "8x8 font", "6x8 font",
"Ornate font", "Font" -- solved this pass (see
docs/dungeonhack/dosvga/data-structure.md), then independently confirmed
field-for-field against community tooling written with real AESOP source
access: Mirek Luza's DAESOP decompiler (`convert.h`'s `OLD_FONT_HEADER`
struct -- `char_count`/`char_height`/4 reserved bytes, exactly this
module's first 8 bytes; `convert.c`'s `readOldCharacterDefinition()` --
`0x108`-based glyph pointer table (0x108 == 264 == our
RES_FONT_OFFSET_TABLE_START exactly) and
`size = 2 + columns*height` matching this module's per-glyph span formula
exactly, including reading `columns` as a full u16 not u8, which this
module now does too). DAESOP's own header comment flags it as
"almost certainly incomplete" -- it doesn't identify the 256-byte
charRemap table this module decodes (DAESOP's converter skips over it
blindly via `loPos += MAX_CHARACTERS_IN_OLD_FONT` without using its
content). EOB3's own EYE.RES has 3 same-named resources ("8x8 font"/
"6x8 font"/"Ornate font") but they do NOT match this layout (a constant
`count=11826`-shaped header field regardless of file size) -- confirmed a
different, still-undecoded format there; this decoder is
Dungeon-Hack-specific even though it lives in this shared module.

Layout (all fields LE):
    u16 count                       number of charset slots (<=256; not all
                                     populated -- width==0 means "no glyph")
    u16 rowHeight                   fixed glyph height in pixels for every
                                     glyph in this resource (proportional
                                     width, fixed height)
    u16 reserved0                   0 observed
    u16 reserved1                   0 observed
    u8  charRemap[256]              maps a raw byte (assumed ASCII/codepage
                                     code) to a glyph index in 0..count-1;
                                     identity (remap[i]==i) in every
                                     resource seen so far, so not yet
                                     exercised against a real remap case
    u16 offsets[count]              file-relative offset of glyph i's
                                     record, immediately following the
                                     remap table (offset 8+256=264)
    per glyph, at its offset:
        u16 width                   this glyph's pixel width (0 = unused
                                     slot, no pixel data)
        width*rowHeight pixel bytes row-major, 1 byte/pixel (small palette
                                     indices observed: 0 = background,
                                     15 = foreground, in the confirmed
                                     2-colour renders)
    Glyph i's total span in the file is offsets[i+1]-offsets[i] (or
    filesize-offsets[i] for the last glyph); unused/near-empty glyphs (the
    control-character range in every font sampled) have span==2 (header
    only, no pixel bytes) rather than being omitted from the offset table.
"""
from __future__ import annotations

import struct

WIDTH = 8


def load_font(blob: bytes) -> dict:
    if len(blob) < 4 + 128 * 2:
        raise ValueError("font file too short")
    sm2 = struct.unpack_from("<H", blob, 0)[0]
    if sm2 != len(blob) - 2:
        raise ValueError(f"font size-check field {sm2} != filesize-2 {len(blob) - 2}")

    offsets = list(struct.unpack_from("<128H", blob, 2))
    glyphs = {}
    for i in range(128):
        go = offsets[i]
        go_next = offsets[i + 1] if i + 1 < 128 else len(blob)
        if go_next <= go or go_next > len(blob):
            continue
        height = go_next - go
        if height == 0 or height > 64:
            continue
        rows = blob[go:go + height]
        glyphs[i] = {"width": WIDTH, "height": height, "rows": rows}
    return {"glyphs": glyphs}


def glyph_to_bitmap(glyph: dict):
    """Return a height x width list-of-lists of 0/1 (1 = set pixel)."""
    out = []
    for row_byte in glyph["rows"]:
        out.append([1 if (row_byte & (1 << (7 - x))) else 0 for x in range(WIDTH)])
    return out


REMAP_TABLE_SIZE = 256
RES_FONT_HEADER_SIZE = 8
RES_FONT_OFFSET_TABLE_START = RES_FONT_HEADER_SIZE + REMAP_TABLE_SIZE  # 264


def looks_like_resource_font(blob: bytes) -> bool:
    """Structural check for the proportional "resource font" format (see
    module docstring part 2). Deliberately strict (validates every glyph's
    offset/span is in-bounds and every declared width*height pixel block
    fits) to avoid false-positiving against unrelated small resources."""
    if len(blob) < RES_FONT_OFFSET_TABLE_START + 2:
        return False
    count, row_height = struct.unpack_from("<HH", blob, 0)
    if not (1 <= count <= 256) or not (1 <= row_height <= 64):
        return False
    table_end = RES_FONT_OFFSET_TABLE_START + count * 2
    if table_end > len(blob):
        return False
    offsets = struct.unpack_from(f"<{count}H", blob, RES_FONT_OFFSET_TABLE_START)
    for i, go in enumerate(offsets):
        if go < table_end or go + 2 > len(blob):
            return False
        go_next = offsets[i + 1] if i + 1 < count else len(blob)
        span = go_next - go
        if span < 2:
            return False
        w = struct.unpack_from("<H", blob, go)[0]
        if w == 0:
            continue
        if go + 2 + w * row_height > len(blob):
            return False
    return True


def load_resource_font(blob: bytes) -> dict:
    """Decode a "resource font" (HACK.RES/OPEN.RES "<N>x8 font"/"Ornate
    font"/"Font"). Returns {count, row_height, remap, glyphs: {index:
    {width, height, pixels (row-major bytes)}}} -- indices with width==0
    are omitted from `glyphs` (unused charset slot)."""
    count, row_height = struct.unpack_from("<HH", blob, 0)
    remap = list(blob[RES_FONT_HEADER_SIZE:RES_FONT_HEADER_SIZE + REMAP_TABLE_SIZE])
    offsets = list(struct.unpack_from(f"<{count}H", blob, RES_FONT_OFFSET_TABLE_START))
    glyphs = {}
    for i in range(count):
        go = offsets[i]
        go_next = offsets[i + 1] if i + 1 < count else len(blob)
        span = go_next - go
        if span < 2 or go + 2 > len(blob):
            continue
        w = struct.unpack_from("<H", blob, go)[0]
        if w == 0:
            continue
        n = w * row_height
        px = blob[go + 2:go + 2 + n]
        if len(px) < n:
            continue
        glyphs[i] = {"width": w, "height": row_height, "pixels": px}
    return {"count": count, "row_height": row_height, "remap": remap, "glyphs": glyphs}

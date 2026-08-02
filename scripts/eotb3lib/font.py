"""CHARGEN/FONT6.FNT + FONT8.FNT bit-packed font decoder.

Confirmed byte-exact against data/eotb3/dosvga/CHARGEN/FONT6.FNT (1028 B)
and FONT8.FNT (1284 B), cross-checked against ThirdEye's
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

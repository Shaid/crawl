#!/usr/bin/env python3
"""Extract two monochrome 8x8 fonts from bcdfo's `chargen_logo`-`sigil_0` gap.

`docs/blackcrypt/TODO.md`'s `bcdfo-ui-gaps` item tracks a ~5.3 KB gap in
bcdfo (file offset 0x99C0-0xAE68) that didn't fit the "appended mask plane"
pattern that solved bcdfo's other 3 gaps. This pass found real content in
the *middle* of it: two more monochrome, 1-bit-per-pixel, 8x8 bitmap fonts —
found by histogramming non-zero bytes per 200-byte window across the gap
(most of it actually is empty/unclear, but two dense, contiguous windows
stood out) and confirming what filled those windows by direct visual
inspection, not a blind width/plane-count sweep.

Font A (`chargen-font-a`) — file offset 0x9E30, 584 B, 73 glyph slots:
    a punctuation/digit/'@'-'Z' charset (matching the game's usual
    `SUBI.B #n,D0` ASCII-relative indexing convention, though the exact
    constant wasn't code-confirmed this pass — visually the run reads as
    ASCII '&'..'Z' starting at slot 9, with slots 0-8 holding a handful of
    directional-arrow icons instead of their literal ASCII glyphs, the same
    "icons replace unused punctuation slots" trick already documented for
    bcdfa's message-log font), followed by 3 more arrow icons and what look
    like "dissolve" transition-effect frames past 'Z'. **Rendered only** —
    no consumer code was traced for this range.

Font B (`chargen-font-b`) — file offset 0xA250, 208 B, 26 glyphs:
    a plain, bolder-weight A-Z alphabet. **Confirmed** against DOS
    `clipper.clp` entry 207, `"CG Font"` (8x472, 59 glyph slots of which the
    first 33 are blank and the last 26 are this same alphabet): decoding
    both as 8x8 1bpp glyph grids and comparing bit-for-bit gives **1,664 of
    1,664 bits agreeing — a byte-exact, 100.000% match — across all 26
    letters**.

The gap's leading ~1,128 B (0x99C0-0x9E28, a repeating 24-byte-per-row bar
pattern) and its trailing ~2,300 B (0xA320-0xAE68, mostly zero with a weak,
still-unconfirmed lead in the last 280 B) are unaffected by this — see
data-structure.md's "bcdfo — Character Portraits + UI Elements" for the
full picture.

Output:
    public/assets/blackcrypt/amiga/sprites/chargen-font-a.{png,json}
    public/assets/blackcrypt/amiga/sprites/chargen-font-b.{png,json}
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

import bclib

FONT_A_OFFSET = 0x9E30
FONT_A_COUNT = 73

FONT_B_OFFSET = 0xA250
FONT_B_COUNT = 26

GLYPH_W = GLYPH_H = 8
GLYPH_BYTES = 8  # 1bpp, 8 rows x 1 byte


def _glyphs(data, offset, count):
    for n in range(count):
        off = offset + n * GLYPH_BYTES
        rows = data[off:off + GLYPH_BYTES]
        if len(rows) < GLYPH_BYTES:
            break
        bits = np.unpackbits(np.frombuffer(bytes(rows), dtype=np.uint8)).reshape(GLYPH_H, GLYPH_W)
        yield n, bits.astype(bool)


def _atlas(data, offset, count, name):
    sprites = []
    for n, bits in _glyphs(data, offset, count):
        rgba = np.zeros((GLYPH_H, GLYPH_W, 4), dtype=np.uint8)
        rgba[bits] = (255, 255, 255, 255)
        sprites.append((f'glyph{n:02d}', rgba))
    if not sprites:
        return None
    sheet, frames = bclib.pack_atlas(sprites, max_width=GLYPH_W * 26)
    return bclib.write_atlas(name, sheet, frames, register=False)


def main():
    bcdfo_path = bclib.data_dir('blackcrypt', 'amiga') / 'bcdfo'
    if not bcdfo_path.exists():
        print(f'No {bcdfo_path} — nothing to do')
        return

    data = bcdfo_path.read_bytes()

    entries = []
    e = _atlas(data, FONT_A_OFFSET, FONT_A_COUNT, 'chargen-font-a')
    if e:
        entries.append(e)
        print(f'  sprites/chargen-font-a: {FONT_A_COUNT} glyphs '
              f'(bcdfo+0x{FONT_A_OFFSET:04X}, rendered only — no consumer traced)')

    e = _atlas(data, FONT_B_OFFSET, FONT_B_COUNT, 'chargen-font-b')
    if e:
        entries.append(e)
        print(f'  sprites/chargen-font-b: {FONT_B_COUNT} glyphs '
              f'(bcdfo+0x{FONT_B_OFFSET:04X}, confirmed vs DOS clipper.clp '
              f'"CG Font", 100.000% bit-exact match)')

    if entries:
        bclib.write_manifest(entries)


if __name__ == '__main__':
    main()

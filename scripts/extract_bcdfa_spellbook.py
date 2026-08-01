#!/usr/bin/env python3
"""Extract Black Crypt's Amiga Spell Book background from bcdfa's entry 5.

bcdfa's container-directory entry 5 (`SLOT_TEXT_RESOURCE`, file offset
0x111E1, 34,340 B decoded) is still largely unclassified — see
`bclib.bcdfa`'s module docstring — but its first 13,440 bytes (offset
0x0000-0x3480) are now solved: a single opaque 320x56, 6-plane background
image, the parchment/border art the in-game spell book UI is drawn against.

No consumer code was traced this pass — this range has no
`MOVEA.L $B4(A5),An`-family hit at all, unlike every other sub-record in
this bank. It's confirmed a different way: DOS `clipper.clp` entry 147,
`"Spell Book"`, 320x56, matches this record's exact decoded byte count and,
decoded and compared index-for-index against the DOS 8bpp raster, produces
a **100.000% silhouette match (17,920/17,920 pixels)** — the per-index
opaque-pixel counts agree exactly, not just the shape. See
data-structure.md's "bcdfa — Text/UI Resource Bank" for the full writeup.

Requires `build/cache/blackcrypt/bcdft_decompressed.bin` (run
`scripts/decompress_bcdft.py` first if missing) for the container directory.

Output:
    public/assets/blackcrypt/amiga/screens/spell-book-bg.png
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from extract_items import ui_palette


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    bcdfq_path = amiga / 'bcdfq'
    s1_path = bclib.cache_dir('blackcrypt') / 'bcdft_decompressed.bin'

    if not bcdfa_path.exists() or not bcdfq_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return
    if not s1_path.exists():
        print(f'No {s1_path} — run scripts/decompress_bcdft.py first')
        return

    s1 = s1_path.read_bytes()
    raw = bcdfa_path.read_bytes()
    chunks = bclib.read_container_chunks(s1, raw, bclib.rle_decompress)
    text_resource = chunks[bclib.SLOT_TEXT_RESOURCE]

    ehb = bclib.ehb_palette(ui_palette(bcdfq_path.read_bytes()))

    idx = bclib.spell_book_background(text_resource)
    rgba = bclib.to_rgba(idx, ehb)

    out_dir = bclib.asset_dir('screens')
    bclib.write_png(out_dir / 'spell-book-bg.png', rgba)
    print(f'  screens/spell-book-bg.png: {rgba.shape[1]}x{rgba.shape[0]} '
          f'(bcdfa entry 5, offset 0x0000, confirmed vs DOS clipper.clp '
          f'"Spell Book", 100.000% silhouette match)')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Extract Black Crypt's Amiga throwing-item projectile sprites from bcdfa.

bcdfa's container-directory entry 12 (`SLOT_THROWING_ITEMS`, file offset
0x300C2, raw — not RLE — 1,092 B) is the in-flight sprite bank for
thrown/fired weapons: Arrow and Dagger, each at 3 shrinking view depths and
both horizontal facings (2 weapons x 3 depths x 2 facings = 12 records, 7
planes each — mask + 6bpp EHB). Confirmed via its own consumer (the
projectile-flight animator, S_1 `+0x21A78`), two corroborating tables (a
per-weapon hot-spot table and a 24-point flight-path table) and the DOS
`clipper.clp` archive, which brackets exactly these six sprite shapes
between its "Start/End Throwing Items" markers. See data-structure.md's
"`0x300C2`-EOF tail — SOLVED — the Throwing-Items projectile sprites".

Requires `build/cache/blackcrypt/bcdft_decompressed.bin` (run
`scripts/decompress_bcdft.py` first if missing) for the container directory.

Output:
    public/assets/blackcrypt/amiga/sprites/throwing-items.{png,json}
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
    chunk = chunks[bclib.SLOT_THROWING_ITEMS]

    ehb = bclib.ehb_palette(ui_palette(bcdfq_path.read_bytes()))

    sprites = []
    for name, facing, w, h, idx, mask in bclib.throwing_item_sprites(chunk):
        rgba = bclib.to_rgba(idx, ehb, mask=mask)
        sprites.append((f'{name}_facing{facing}', rgba))

    if not sprites:
        print('  no throwing-item sprites decoded')
        return

    sheet, frames = bclib.pack_atlas(sprites, max_width=16 * 12)
    bclib.write_atlas('throwing-items', sheet, frames)
    print(f'  sprites/throwing-items: {len(frames)} sprites '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

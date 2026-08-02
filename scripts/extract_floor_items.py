#!/usr/bin/env python3
"""Extract the Black Crypt Amiga dungeon-floor item sprites.

147 masked sprites = **49 floor graphics x 3 view depths**, the art the 3D
viewport draws for an object lying on a dungeon floor square. These are a
separate asset class from the 24x24 inventory icons (`extract_items.py`):
purpose-drawn "lying flat" art, each item pre-rendered at three sizes for the
three drawable floor depths.

Two files are needed, because the pixels and the geometry live apart:

  * `data/blackcrypt/amiga/bcdfa` — one RLE stream at **0x270C4** decoding to
    exactly 31,388 bytes of plane data.
  * `build/cache/blackcrypt/bcdft_decompressed.bin` — the decompressed bcdft
    S_1 overlay, which carries the 147 x 10-byte blit-descriptor table at
    **+0x271B6** (run `scripts/decompress_bcdft.py` first if it is missing).

See `bclib/bcdfa.py` for the record layout and
`docs/blackcrypt/amiga/data-structure.md`, "Dungeon-floor item sprites", for
the byte-level spec and the verification evidence.

Output:
    public/assets/blackcrypt/amiga/sprites/floor-items.{png,json}
    public/assets/blackcrypt/amiga/data/floor-item-gfx-table.json

Palette
-------
Floor sprites only ever use colour registers 0-25 and their EHB half-brights
32-57 — never 26-31, the swappable dungeon accent ramp — so one palette serves
every dungeon level.

They are drawn *inside the 3D viewport*, which is a different copper region
from the equipment panel, and the two disagree on two registers. The panel
runs the live overrides `extract_items.py` documents (reg 1 = 0x158,
reg 9 = 0x940); the viewport runs the **shipped** values (reg 1 = 0xC86,
reg 9 = 0x0DD). Screenshot evidence: sprite 120's index-1 pixels render as
RGB (204,136,102) = 0xC86 and sprite 24's index-41 (EHB of 9) pixels render as
half of 0x0DD. So this extractor uses the bcdft dungeon palette unmodified.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    s1_path = bclib.cache_dir('blackcrypt') / 'bcdft_decompressed.bin'

    if not bcdfa_path.exists():
        print(f'No bcdfa at {bcdfa_path} — nothing to do')
        return
    if not s1_path.exists():
        print(f'No {s1_path} — run scripts/decompress_bcdft.py first')
        return

    s1 = s1_path.read_bytes()
    ehb = bclib.ehb_palette(
        bclib.read_palette_words(s1, bclib.BCDFT_DUNGEON_PALETTE, 32))

    sprites = []
    for n, group, depth, w, h, rec in bclib.floor_item_sprites(
            bcdfa_path.read_bytes(), s1):
        idx, mask = bclib.decode_masked(rec, w, h, bclib.FLOOR_ITEM_PLANES - 1)
        if idx is None:
            print(f'  WARN floor sprite {n}: short record')
            continue
        sprites.append((f'floor{group:02d}-d{depth}',
                        bclib.to_rgba(idx, ehb, mask=mask)))

    if not sprites:
        print('  no floor-item sprites decoded')
        return

    sheet, frames = bclib.pack_atlas(sprites, max_width=512)
    bclib.write_atlas('floor-items', sheet, frames, groups='data/floor-item-names.json')
    print(f'  sprites/floor-items: {len(frames)} sprites '
          f'({bclib.FLOOR_ITEM_GROUPS} items x {bclib.FLOOR_ITEM_DEPTHS} depths, '
          f'{sheet.shape[1]}x{sheet.shape[0]} atlas)')

    table = bclib.floor_item_gfx_table(s1)
    bclib.write_json(bclib.asset_dir('data') / 'floor-item-gfx-table.json', {
        'source': 'bcdft S_1 +0x%05X' % bclib.FLOOR_ITEM_GFX_TABLE,
        'none': bclib.FLOOR_ITEM_GFX_NONE,
        'groups': table,
    }, pretty=True)
    drawn = sum(1 for v in table if v != bclib.FLOOR_ITEM_GFX_NONE)
    print(f'  data/floor-item-gfx-table: {len(table)} gfxNumbers, '
          f'{drawn} with a floor graphic')

    bclib.write_json(bclib.asset_dir('data') / 'floor-item-names.json', {
        'source': ("DOS/Windows clipper.clp 'Start Floor Items'/'End Floor "
                   "Items' marker block (directory entries 652-798), "
                   "cross-referenced by exact per-depth width/height match "
                   "plus per-pixel silhouette agreement (35,869/35,872 "
                   "opaque-vs-transparent pixels, 99.992%) -- see "
                   "scripts/verify_floor_item_dos_names.py"),
        'groups': [{'name': n, 'frames': [f'floor{i:02d}-d{d}' for d in range(3)]}
                   for i, n in enumerate(bclib.FLOOR_ITEM_NAMES)],
    }, pretty=True)
    print(f'  data/floor-item-names: {len(bclib.FLOOR_ITEM_NAMES)} confirmed group names')


if __name__ == '__main__':
    main()

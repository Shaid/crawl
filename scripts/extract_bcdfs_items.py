#!/usr/bin/env python3
"""Extract every named item placed in the dungeon, with its icon index.

Joins three confirmed pieces:

* `bcdfs` — the map file, walked with `bclib.bcdfs` (the game's own loader,
  13/13 maps with zero deviation). Every item/structure record carries a
  `gfxNumber` (word `+0x00`) and a **name reference** (word `+0x02`).
* the name reference resolves to a string via `bclib.bcdfs.item_name` — a
  byte offset into decompressed `bcdft` S_1 `+0x1C4E2` when bit 15 is clear,
  or an index into the 19-entry pointer table at S_2 `+0x07BA` when it is set.
* `gfxNumber` → 0-179 item-icon index via the confirmed 236-byte LUT at
  decompressed `bcdft` S_1 `+0x26EF2`.

Output: `public/assets/blackcrypt/amiga/data/item-names.json`.

    python3 scripts/extract_bcdfs_items.py
"""
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bclib import bcdfa, bcdfs, paths

ROOT = Path(__file__).resolve().parents[1]
BCDFS = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'
S1_PATH = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
S2_PATH = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_s2_data.bin'

#: 236-byte `gfxNumber` → item-icon-index LUT (confirmed; max value 174).
GFX_TO_ICON_LUT = 0x26EF2
GFX_TO_ICON_COUNT = 236

ITEM_TYPES = bcdfa.ITEM_TYPE_NAMES


def main():
    raw = BCDFS.read_bytes()
    s1 = S1_PATH.read_bytes()
    s2 = S2_PATH.read_bytes()
    lut = s1[GFX_TO_ICON_LUT:GFX_TO_ICON_LUT + GFX_TO_ICON_COUNT]

    records = bcdfs.read_records(raw)

    instances = []
    by_gfx = defaultdict(Counter)
    types = defaultdict(Counter)
    for map_index, row, col, offset, rec in records:
        if rec[0] & 0x80:               # monster stat block, no name field
            continue
        name = bcdfs.item_name(s1, s2, struct.unpack_from('>H', rec, 2)[0])
        if name is None:
            continue
        gfx = struct.unpack_from('>H', rec, 0)[0]
        item_type = rec[5]
        by_gfx[gfx][name] += 1
        types[gfx][item_type] += 1
        instances.append({
            'map': map_index + 1,
            'row': row,
            'col': col,
            'offset': offset,
            'gfxNumber': gfx,
            'itemType': item_type,
            'itemTypeName': ITEM_TYPES.get(item_type),
            'name': name,
        })

    catalog = []
    for gfx in sorted(by_gfx):
        icon = lut[gfx] if gfx < len(lut) else None
        catalog.append({
            'gfxNumber': gfx,
            'iconIndex': icon,
            'itemTypes': sorted(types[gfx]),
            'names': [n for n, _ in by_gfx[gfx].most_common()],
            'instances': sum(by_gfx[gfx].values()),
        })

    out = paths.asset_dir('data') / 'item-names.json'
    paths.write_json(out, {'catalog': catalog, 'instances': instances})
    print(f'  {len(records)} records walked, {len(instances)} named item placements, '
          f'{len(catalog)} distinct gfxNumbers -> {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()

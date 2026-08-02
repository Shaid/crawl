#!/usr/bin/env python3
"""Extract Black Crypt's Amiga key icons from bcdfa's SLOT_TEXT_RESOURCE tail.

bcdfa's container-directory entry 5 (`SLOT_TEXT_RESOURCE`, file offset
0x111E1, 34,340 B decoded) is now fully classified into 13 records — see
`bclib.TEXT_RESOURCE_LAYOUT` — of which its last 2,436 bytes (`0x7CA0`-end)
are fully solved: **29 key icons**, 8x14, 6 sequential bitplanes, no mask
(the same backdrop-index-53 convention as the 24x24 item icons). Confirmed
via two independent consumer call sites (S_1 `+0x1FB40`/`+0x206D4`, both
`gfxNumber - 200` then `x84`) and against the DOS `clipper.clp` archive,
which brackets exactly 29 unnamed 8x14 entries between its "Start Keys"/
"End Keys" markers (313-341): 3,248/3,248 pixels agree (100.000%) across
29/29 frames. See data-structure.md's "`0x7CA0`-end — the 29 key icons".

Requires `build/cache/blackcrypt/bcdft_decompressed.bin` (run
`scripts/decompress_bcdft.py` first if missing) for the container directory.

Output:
    public/assets/blackcrypt/amiga/sprites/keys.{png,json}
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

    sprites = []
    manifest = []
    for n, gfx_number, idx in bclib.key_icon_sprites(text_resource):
        rgba = bclib.to_rgba(idx, ehb, mask=(idx != bclib.KEY_ICON_BACKDROP_INDEX))
        name = f'key{n:02d}'
        sprites.append((name, rgba))
        manifest.append({'name': name, 'index': n, 'gfxNumber': gfx_number})

    if not sprites:
        print('  no key icons decoded')
        return

    sheet, frames = bclib.pack_atlas(sprites, max_width=8 * 29)
    bclib.write_atlas('keys', sheet, frames)
    bclib.write_json(bclib.asset_dir('data') / 'key-icon-gfx-table.json', manifest, pretty=True)
    print(f'  sprites/keys: {len(frames)} key icons (gfxNumber '
          f'{bclib.KEY_ICON_GFX_BASE}-{bclib.KEY_ICON_GFX_BASE + bclib.KEY_ICON_COUNT - 1}) '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Extract Black Crypt's Amiga equipment-panel paperdoll graphics from bcdfa.

Two separate banks, both maskless 6-plane EHB art like the 24x24 item icons:

  sprites/armour.{png,json}     19 chest-armour images, 32x29, from the RLE
                                stream at bcdfa+0x2D05E (13,224 B = 19 x 696,
                                zero remainder). Selected by the gfxNumber ->
                                armour-index lookup table in the decompressed
                                `bcdft` S_1 at +0x270CA (values 0..18).

  sprites/paperdoll.{png,json}   7 large equipment images stored 48 px wide
                                (only the left 36 px are drawn), 4 at 29 rows
                                and 3 at 25 rows, from the RLE stream at
                                bcdfa+0x036FD. Heights are not uniform, so the
                                record offsets are a table, not a stride.

Ground truth (see docs/blackcrypt/amiga/data-structure.md for the numbers):
armour record 0 and paperdoll records 2 and 4 each reproduce their on-screen
appearance in `data/default-3.png` RGB-exactly, and the 19 armour images agree
with the DOS port's 19 32x29 chest-armour icons on 17,567 / 17,632 silhouette
pixels (99.631%).

Palette: the same UI palette as the item icons (bcdfq `game` plus the two
registers the game reprograms at runtime), so this script reuses
`extract_items.ui_palette`.
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
    if not bcdfa_path.exists() or not bcdfq_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return

    raw = bcdfa_path.read_bytes()
    ehb = bclib.ehb_palette(ui_palette(bcdfq_path.read_bytes()))

    armour = []
    for n, rec in bclib.armour_icons(raw):
        idx = bclib.decode_planar(rec, bclib.ARMOUR_WIDTH, bclib.ARMOUR_HEIGHT,
                                  bclib.ARMOUR_COLOR_PLANES)
        armour.append((f'armour{n:02d}',
                       bclib.to_rgba(idx, ehb,
                                     mask=(idx != bclib.ARMOUR_BACKDROP_INDEX))))
    if armour:
        sheet, frames = bclib.pack_atlas(armour, max_width=bclib.ARMOUR_WIDTH * 10)
        bclib.write_atlas('armour', sheet, frames)
        print(f'  sprites/armour: {len(frames)} chest-armour images '
              f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')

    doll = []
    for n, height, rec in bclib.paperdoll_records(raw):
        idx = bclib.decode_planar(rec, bclib.PAPERDOLL_STORAGE_WIDTH, height,
                                  bclib.PAPERDOLL_COLOR_PLANES)
        # Columns 36..47 are off-screen padding the game never blits.
        idx = idx[:, :bclib.PAPERDOLL_WIDTH]
        doll.append((f'paperdoll{n}',
                     bclib.to_rgba(idx, ehb,
                                   mask=(idx != bclib.PAPERDOLL_BACKDROP_INDEX))))
    if doll:
        sheet, frames = bclib.pack_atlas(doll, max_width=bclib.PAPERDOLL_WIDTH * 7)
        bclib.write_atlas('paperdoll', sheet, frames)
        print(f'  sprites/paperdoll: {len(frames)} equipment images '
              f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

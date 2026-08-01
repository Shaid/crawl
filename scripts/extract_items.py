#!/usr/bin/env python3
"""Extract the Black Crypt Amiga item icon bank from bcdfa.

180 icons, 24x24, 6 sequential bitplanes, no mask — the graphics the game
draws for every carryable object in the inventory / equipment panel. (Objects
lying on a dungeon floor square use a different, masked bank — see
`scripts/extract_floor_items.py`.) Two RLE streams inside bcdfa; see
`bclib/bcdfa.py` for the
container layout and `docs/blackcrypt/amiga/data-structure.md` for the
byte-level spec and the verification evidence.

Output:
    public/assets/blackcrypt/amiga/sprites/items.{png,json}
    public/assets/blackcrypt/amiga/palettes/ui.json

Palette
-------
The icons only ever use colour registers 0-25 and their EHB half-brights
32-57; they never touch 26-31, which is the swappable dungeon accent ramp.
So the bcdfq `game` palette is the right base — with two corrections.
Registers **1** and **9** are reprogrammed at runtime and hold different
values in-game than the bcdfq table ships with. All three in-game emulator
savestates (data/blackcrypt/default-{2,3,4}.uss) agree on the live values, and
they are what the real screenshots show, so they are applied here:

    reg  bcdfq `game`      live in-game
      1  0xC86 (204,136,102)  0x158 (17,85,136)
      9  0x0DD (0,221,221)    0x940 (153,68,0)

That is 367 of 103,680 icon pixels (0.354%); every other pixel renders
identically from the shipped table.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

#: Colour registers the game reprograms before drawing the UI. Sourced from
#: the AGAC (colour register) chunk of three in-game savestates, which agree
#: with each other and with the captured screenshots. 12-bit Amiga words.
UI_PALETTE_OVERRIDES = {1: 0x158, 9: 0x940}


def ui_palette(bcdfq):
    words = list(bclib.read_named_palette(bcdfq, 'game'))
    for reg, word in UI_PALETTE_OVERRIDES.items():
        words[reg] = word
    return words


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    bcdfq_path = amiga / 'bcdfq'
    if not bcdfa_path.exists() or not bcdfq_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return

    words = ui_palette(bcdfq_path.read_bytes())
    ehb = bclib.ehb_palette(words)

    bclib.write_json(bclib.asset_dir('palettes') / 'ui.json', {
        'colors': [dict(zip('rgb', bclib.amiga12_to_rgb(w))) for w in words],
    }, pretty=True)

    sprites = []
    for bank, n, icon in bclib.item_icons(bcdfa_path.read_bytes()):
        idx = bclib.decode_planar(icon, bclib.ITEM_WIDTH, bclib.ITEM_HEIGHT,
                                  bclib.ITEM_COLOR_PLANES)
        if idx is None:
            print(f'  WARN item b{bank}/{n}: short record')
            continue
        # Not a mask plane — index 53 is the flat backdrop the artists drew
        # around each icon. Cut it so the atlas composites over any background.
        sprites.append((f'item{len(sprites):03d}',
                        bclib.to_rgba(idx, ehb,
                                      mask=(idx != bclib.ITEM_BACKDROP_INDEX))))

    if not sprites:
        print('  no item icons decoded')
        return

    sheet, frames = bclib.pack_atlas(sprites, max_width=24 * 16)
    bclib.write_atlas('items', sheet, frames)
    print(f'  sprites/items: {len(frames)} icons '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

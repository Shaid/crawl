#!/usr/bin/env python3
"""Extract Eye of the Beholder III's CHARGEN/ assets (DOS/Windows port).

CHARGEN/ is the character-creation sub-program's asset bundle: two CPS
backdrops, an item-icon CPS sheet, a 90-portrait sheet, a 256-colour VGA
palette, two bitmap fonts, and the item/item-type data tables. All formats
are confirmed byte-exact against real files (see scripts/eotb3lib/ module
docstrings and docs/eotb3/dosvga/data-structure.md for the verification
evidence and cross-reference to the independent "ThirdEye" reimplementation).

Output:
    public/assets/eotb3/dosvga/palettes/chargen.json
    public/assets/eotb3/dosvga/screens/chargen.png
    public/assets/eotb3/dosvga/screens/chargen-b.png
    public/assets/eotb3/dosvga/sprites/item-icons.{png,json}
    public/assets/eotb3/dosvga/sprites/portraits.{png,json}
    public/assets/eotb3/dosvga/sprites/font6.{png,json}
    public/assets/eotb3/dosvga/sprites/font8.{png,json}
    public/assets/eotb3/dosvga/data/item.json
    public/assets/eotb3/dosvga/data/itemtype.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import bclib
from eotb3lib import cps, bitmap, palette as pal_mod, itemdat, font as font_mod

GAME, PLATFORM = 'eotb3', 'dosvga'
# ITEMICN.CPS icon grid: 16x16px cells, 20 cols x 6 rows (320/16, 96/16) --
# confirmed by overlaying a 16px grid on the decoded sheet (clean alignment,
# no icon bleeds across a cell boundary) and cross-checked against
# CHARGEN/ITEM.DAT's `pic` field, whose max value (111) fits inside the
# 120-cell grid with room to spare.
ICON_SIZE = 16
ICON_COLS = 20
ICON_ROWS = 6


def palette_to_flat(colours):
    flat = []
    for c in colours:
        flat.extend([c['r'], c['g'], c['b']])
    flat += [0] * (768 - len(flat))
    return flat


def indexed_to_rgba(pixels, width, height, flat_pal, colourkey=None):
    idx = np.frombuffer(bytes(pixels), dtype=np.uint8).reshape(height, width)
    pal_arr = np.array(flat_pal, dtype=np.uint8).reshape(256, 3)
    rgb = pal_arr[idx]
    alpha = np.full((height, width, 1), 255, dtype=np.uint8)
    if colourkey is not None:
        alpha[idx == colourkey] = 0
    return np.concatenate([rgb, alpha], axis=-1)


def main():
    root = bclib.data_dir(GAME, PLATFORM)
    chargen = root / 'CHARGEN'
    if not chargen.exists():
        print(f'No CHARGEN data at {chargen} — nothing to do')
        return

    # --- Palette ---------------------------------------------------------
    pal_blob = (chargen / 'PALETTE.COL').read_bytes()
    colours = pal_mod.load_raw_palette(pal_blob)
    assert len(colours) == 256, f'expected 256 colours, got {len(colours)}'
    bclib.write_json(
        bclib.asset_dir('palettes', GAME, PLATFORM) / 'chargen.json',
        {'colors': colours}, pretty=True,
    )
    flat_pal = palette_to_flat(colours)
    print(f'palette: {len(colours)} colours -> palettes/chargen.json')

    # --- CPS backdrops -----------------------------------------------------
    for src_name, out_name in [('CHARGEN.CPS', 'chargen'), ('CHARGENB.CPS', 'chargen-b')]:
        d = cps.load_cps(chargen / src_name)
        rgba = indexed_to_rgba(d['pixels'], d['width'], d['height'], flat_pal)
        out = bclib.write_png(bclib.asset_dir('screens', GAME, PLATFORM) / f'{out_name}.png', rgba)
        print(f'{src_name}: {d["width"]}x{d["height"]} (LCW compressed={d["compression"] == 4}) -> {out}')

    # --- Item icon sheet (ITEMICN.CPS) -- pack each icon as its own atlas frame
    d = cps.load_cps(chargen / 'ITEMICN.CPS')
    full = np.frombuffer(bytes(d['pixels']), dtype=np.uint8).reshape(d['height'], d['width'])
    cols, rows = d['width'] // ICON_SIZE, d['height'] // ICON_SIZE
    sprites = []
    for r in range(rows):
        for c in range(cols):
            cell = full[r * ICON_SIZE:(r + 1) * ICON_SIZE, c * ICON_SIZE:(c + 1) * ICON_SIZE]
            if not cell.any():
                continue  # empty grid cell (icon count < rows*cols)
            pal_arr = np.array(flat_pal, dtype=np.uint8).reshape(256, 3)
            rgb = pal_arr[cell]
            alpha = np.full((ICON_SIZE, ICON_SIZE, 1), 255, dtype=np.uint8)
            alpha[cell == 0] = 0  # index 0 (black) as transparency key
            rgba = np.concatenate([rgb, alpha], axis=-1)
            sprites.append((f'icon-{r * cols + c:03d}', rgba))
    sheet, frames = bclib.pack_atlas(sprites)
    bclib.write_atlas('item-icons', sheet, frames, category='sprites', game=GAME, platform=PLATFORM)
    print(f'ITEMICN.CPS: {len(sprites)} icons ({cols}x{rows} grid of {ICON_SIZE}px cells) -> sprites/item-icons.png')

    # --- Portrait sheet (CHARPICS.BMP) ------------------------------------
    charpics_blob = (chargen / 'CHARPICS.BMP').read_bytes()
    portraits = bitmap.decode_charpics(charpics_blob)
    sprites = []
    for i, p in enumerate(portraits):
        rgba = indexed_to_rgba(p['pixels'], p['width'], p['height'], flat_pal)
        sprites.append((f'portrait-{i:03d}', rgba))
    sheet, frames = bclib.pack_atlas(sprites)
    bclib.write_atlas('portraits', sheet, frames, category='sprites', game=GAME, platform=PLATFORM)
    print(f'CHARPICS.BMP: {len(portraits)} portraits -> sprites/portraits.png')

    # --- Fonts -------------------------------------------------------------
    for fname, out_name in [('FONT6.FNT', 'font6'), ('FONT8.FNT', 'font8')]:
        blob = (chargen / fname).read_bytes()
        f = font_mod.load_font(blob)
        sprites = []
        for ch, glyph in sorted(f['glyphs'].items()):
            bits = font_mod.glyph_to_bitmap(glyph)
            h, w = glyph['height'], glyph['width']
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            arr = np.array(bits, dtype=bool)
            rgba[arr] = [255, 255, 255, 255]
            sprites.append((f'char-{ch:03d}', rgba))
        sheet, frames = bclib.pack_atlas(sprites, max_width=256)
        bclib.write_atlas(out_name, sheet, frames, category='sprites', game=GAME, platform=PLATFORM)
        print(f'{fname}: {len(sprites)} glyphs -> sprites/{out_name}.png')

    # --- ITEM.DAT / ITEMTYPE.DAT -------------------------------------------
    item_blob = (chargen / 'ITEM.DAT').read_bytes()
    item_data = itemdat.load_item_dat(item_blob)
    assert item_data['consumedBytes'] == item_data['totalBytes'], 'ITEM.DAT size mismatch'
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'item.json', item_data, pretty=True)
    print(f"ITEM.DAT: {item_data['numItems']} items, {item_data['numNames']} names -> data/item.json")

    itemtype_blob = (chargen / 'ITEMTYPE.DAT').read_bytes()
    itemtype_data = itemdat.load_itemtype_dat(itemtype_blob)
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'itemtype.json', itemtype_data, pretty=True)
    print(f"ITEMTYPE.DAT: {itemtype_data['count']} types -> data/itemtype.json")

    bclib.write_platform_index([(GAME, PLATFORM)])


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Extract Black Crypt's Amiga "Adventure Screen" UI panel bank from bcdfa.

bcdfa's very first RLE stream (file offset 0, decoding to 18,932 bytes and
terminating exactly where the paperdoll stream at 0x036FD begins) is not
BCSPEED data at all — it is the in-dungeon status-bar art: the class
LV:/AC: stat panel, the character-portrait placeholder frame, the twin-gem
ring-slot graphic, the Save/Rest options buttons, the 8-way movement
compass, five "Page" tabs and the four pressure-plate icons. Every record is
a **7-plane masked sprite** (stencil plane 0 + 6 EHB colour planes), read
cookie-cut against its own stencil — not an opaque backdrop-keyed rectangle
(that was the old, one-plane-late reading; see the `> Correction` in
`bclib.bcdfa`'s UI-panel docstring and data-structure.md's "bcdfa — UI Panel
Bank").

Every record is independently confirmed against a same-named DOS
`clipper.clp` entry (AS Stats, Face Square, Gem Stone, Options, Up Arrows,
Page 1-5, Pressure Plate 1/2 Up/Down) at 98.8-100% silhouette agreement,
except `ghost` (DOS "Ghost", a 50% black stipple — confirmed a different
way, see data-structure.md) — see docs/blackcrypt/amiga/data-structure.md,
"bcdfa — UI Panel Bank".

Output:
    public/assets/blackcrypt/amiga/sprites/ui-panel.{png,json}
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

    sprites = []
    for name, w, h, idx, mask in bclib.ui_panel_records(raw):
        rgba = bclib.to_rgba(idx, ehb, mask=mask)
        sprites.append((name, rgba))

    if not sprites:
        print('  no UI panel records decoded')
        return

    sheet, frames = bclib.pack_atlas(sprites, max_width=96 * 4)
    bclib.write_atlas('ui-panel', sheet, frames)
    print(f'  sprites/ui-panel: {len(frames)} records '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

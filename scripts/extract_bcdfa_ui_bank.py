#!/usr/bin/env python3
"""Extract the rest of bcdfa's entry 5 — the UI / automap resource bank.

bcdfa's container-directory entry 5 (`SLOT_TEXT_RESOURCE`, file offset
0x111E1, 34,340 B decoded) is now **fully classified**: thirteen records
that tile the chunk with zero remainder (`bclib.TEXT_RESOURCE_LAYOUT`,
asserted by `bclib.check_text_resource_layout`). Two of them already had
their own extractors — `extract_bcdfa_spellbook.py` (offset `0x0000`) and
`extract_bcdfa_keys.py` (`0x7CA0`). This script covers the remaining
eleven, whose offsets and geometry all come out of their own consumers'
literal displacements in decompressed `bcdft` S_1, and each of which is
confirmed pixel-for-pixel against a named DOS `clipper.clp` entry:

    0x3480  112x141  right-hand side panel  = "Stone" (+ "Castor 0" baked in)
    0x62C4  112x23   blank-stone erase strip  (Amiga-only)
    0x6A50  112x11   scroll roller          = "Scroll Top"
    0x6DEC  112x1    parchment row          = "Scroll Piece"  (tiled 84x)
    0x6E40  15x8x7   flame animation        = "Fire Animation"
    0x7110  16x18    mouse pointer sprite   = "Mouse Arrow"
    0x7230  16x5     bubble sprite          = "Bubble"
    0x7350  16x20    automap cell           = "Auto Map Block"
    0x73A0  24x8x8   automap tiles          = "Auto Map Tiles"
    0x75E0  48x24    closed chest           = "Treasure Chest 0"
    0x7940  48x24    open chest             = "Treasure Chest 1"

See `docs/blackcrypt/amiga/data-structure.md`, "bcdfa — UI / Automap
Resource Bank", for the full record table, the consumer disassembly, and the
verification figures. `scripts/verify_bcdfa_entry5_dos.py` re-runs the DOS
cross-check.

Requires `build/cache/blackcrypt/bcdft_decompressed.bin` (run
`scripts/decompress_bcdft.py` first if missing) — both for the container
directory and for the automap palette at S_1 `+0x1E886`.

Output:
    public/assets/blackcrypt/amiga/sprites/ui-side-panel.{png,json}
    public/assets/blackcrypt/amiga/sprites/fire-animation.{png,json}
    public/assets/blackcrypt/amiga/sprites/automap.{png,json}
    public/assets/blackcrypt/amiga/palettes/automap.json
    public/assets/blackcrypt/amiga/data/fire-animation.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from extract_items import ui_palette

#: Playfield-1 of the automap screen is 3 planes, playfield-2 is 2 planes at
#: COLOR8..COLOR11 — so a flat 32-entry palette covers both, no EHB half.
AUTOMAP_PALETTE_WORDS = 32


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
    chunks = bclib.read_container_chunks(s1, bcdfa_path.read_bytes(), bclib.rle_decompress)
    bank = chunks[bclib.SLOT_TEXT_RESOURCE]

    # The bank's own structural invariant — 13 records, 0 remainder.
    bclib.check_text_resource_layout()
    if len(bank) != bclib.TEXT_RESOURCE_BYTES:
        raise ValueError(f'bcdfa entry 5 is {len(bank)} B, expected '
                         f'{bclib.TEXT_RESOURCE_BYTES}')

    ehb = bclib.ehb_palette(ui_palette(bcdfq_path.read_bytes()))

    automap_words = bclib.read_palette_words(s1, bclib.BCDFT_AUTOMAP_PALETTE,
                                             AUTOMAP_PALETTE_WORDS)
    automap_rgb = []
    for w in automap_words:
        automap_rgb.extend(bclib.amiga12_to_rgb(w))
    bclib.write_json(bclib.asset_dir('palettes') / 'automap.json', {
        'colors': [dict(zip('rgb', bclib.amiga12_to_rgb(w))) for w in automap_words],
    }, pretty=True)

    # ── Panel family (6-plane EHB, opaque) ───────────────────────────────
    panels = [
        ('stone-panel', bclib.stone_panel(bank)),
        ('panel-clear-strip', bclib.panel_clear_strip(bank)),
        ('scroll-top', bclib.scroll_top(bank)),
        ('scroll-piece', bclib.scroll_piece(bank)),
        ('scroll-panel', bclib.scroll_panel(bank)),
    ]
    for n, idx in bclib.treasure_chest_sprites(bank):
        panels.append((f'treasure-chest-{n}', idx))
    sheet, frames = bclib.pack_atlas([(n, bclib.to_rgba(i, ehb)) for n, i in panels],
                                     max_width=512)
    bclib.write_atlas('ui-side-panel', sheet, frames)
    print(f'  sprites/ui-side-panel: {len(frames)} records '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')

    # ── Fire Animation (15 frames, backdrop index 26 = transparent) ───────
    flames = []
    for n, idx in bclib.fire_animation_frames(bank):
        rgba = bclib.to_rgba(idx, ehb,
                             mask=(idx != bclib.FIRE_ANIMATION_BACKDROP_INDEX))
        flames.append((f'flame{n:02d}', rgba))
    sheet, frames = bclib.pack_atlas(flames, max_width=8 * bclib.FIRE_ANIMATION_COUNT)
    bclib.write_atlas('fire-animation', sheet, frames)
    bclib.write_json(bclib.asset_dir('data') / 'fire-animation.json', {
        'frames': bclib.FIRE_ANIMATION_COUNT,
        'width': bclib.FIRE_ANIMATION_WIDTH,
        'height': bclib.FIRE_ANIMATION_HEIGHT,
        'ticksPerFrame': bclib.FIRE_ANIMATION_TICKS_PER_FRAME,
        'periodTicks': bclib.FIRE_ANIMATION_PERIOD,
        'instances': [
            {'x': x, 'y': y, 'phaseTicks': p}
            for (x, y), p in zip(bclib.FIRE_ANIMATION_POSITIONS,
                                 bclib.FIRE_ANIMATION_PHASES)
        ],
    }, pretty=True)
    print(f'  sprites/fire-animation: {len(frames)} frames, 4 screen instances '
          f'phased {bclib.FIRE_ANIMATION_PHASES}')

    # ── Automap tiles / block / sprites (automap palette) ─────────────────
    automap = []
    for n, idx in bclib.automap_tiles(bank):
        automap.append((f'tile{n:02d}', bclib.to_rgba(idx, automap_rgb)))
    block = bclib.automap_block(bank)
    automap.append(('block', bclib.to_rgba(block + bclib.AUTOMAP_BLOCK_COLOR_BASE,
                                           automap_rgb)))
    # Hardware sprites index COLOR16..COLOR31; 0 is transparent.
    for name, idx in (('mouse-pointer', bclib.mouse_pointer_sprite(bank)),
                      ('bubble', bclib.bubble_sprite(bank))):
        automap.append((name, bclib.to_rgba(idx + 16, automap_rgb, mask=(idx != 0))))
    sheet, frames = bclib.pack_atlas(automap, max_width=256)
    bclib.write_atlas('automap', sheet, frames)
    print(f'  sprites/automap: {bclib.AUTOMAP_TILE_COUNT} tiles + block + '
          f'2 hardware sprites ({sheet.shape[1]}x{sheet.shape[0]} atlas)')
    print('  palettes/automap.json: 32 words (S_1 +0x1E886)')


if __name__ == '__main__':
    main()

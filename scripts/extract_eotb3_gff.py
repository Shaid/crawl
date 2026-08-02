#!/usr/bin/env python3
"""Extract Eye of the Beholder III's cutscene GFF files (INTRO/DARK/FINALE/LICH.GFF).

Each .GFF is a "GFFI" container (Miles Design Inc, used by Westwood/SSI's
CINE.EXE cutscene player) holding tagged asset blocks: PAL (palette), BMP
(still frame), BMA (bitmap animation -- frames chained back to back), ACF,
MERR, *SEQ (playback sequencing, not decoded here), ADV (Miles AIL sound
driver blobs, not game content), LSE (music). See scripts/eotb3lib/gffi.py
and bitmap.py for the format docstrings, and
docs/eotb3/dosvga/data-structure.md for the verification evidence.

Output (per GFF, name lower-cased):
    public/assets/eotb3/dosvga/palettes/<gff>-N.json
    public/assets/eotb3/dosvga/screens/<gff>-bmp-N.png
    public/assets/eotb3/dosvga/sprites/<gff>-bma-N.{png,json}   (animation frames)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import bclib
from eotb3lib import gffi, bitmap, palette as pal_mod

GAME, PLATFORM = 'eotb3', 'dosvga'
GFF_FILES = ['INTRO.GFF', 'DARK.GFF', 'FINALE.GFF', 'LICH.GFF']
MAX_BMA_FRAMES_PER_ASSET = 64  # cap runaway/misframed animations


def palette_to_flat(colours):
    flat = []
    for c in colours:
        flat.extend([c['r'], c['g'], c['b']])
    flat += [0] * (768 - len(flat))
    return flat


def indexed_to_rgba(pixels, width, height, flat_pal):
    idx = np.frombuffer(bytes(pixels), dtype=np.uint8).reshape(height, width)
    pal_arr = np.array(flat_pal, dtype=np.uint8).reshape(256, 3)
    rgb = pal_arr[idx]
    alpha = np.full((height, width, 1), 255, dtype=np.uint8)
    return np.concatenate([rgb, alpha], axis=-1)


def main():
    root = bclib.data_dir(GAME, PLATFORM)

    for fname in GFF_FILES:
        path = root / fname
        if not path.exists():
            print(f'  {fname}: not found, skipping')
            continue
        g = gffi.load(str(path))
        stem = fname.split('.')[0].lower()
        print(f'{fname}: {g.number_of_tags} tag blocks, {len(g.assets)} assets')

        pal_assets = g.by_tag('PAL')
        palettes = []
        for a in pal_assets:
            colours = pal_mod.load_raw_palette(g.read(a))
            bclib.write_json(
                bclib.asset_dir('palettes', GAME, PLATFORM) / f'{stem}-{a.unique}.json',
                {'colors': colours}, pretty=True)
            palettes.append(colours)
        # Fall back to the chargen global palette for GFFs with no embedded
        # PAL block (DARK/LICH.GFF -- confirmed no PAL tag present).
        if not palettes:
            chargen_pal = root / 'CHARGEN' / 'PALETTE.COL'
            palettes = [pal_mod.load_raw_palette(chargen_pal.read_bytes())]
        flat_pal = palette_to_flat(palettes[0])
        print(f'  {len(pal_assets)} embedded palette(s)'
              + ('' if pal_assets else ' (using CHARGEN palette as fallback)'))

        bmp_assets = g.by_tag('BMP')
        for a in bmp_assets:
            blob = g.read(a)
            try:
                subs = bitmap.decode_all_subbitmaps(blob)
            except (IndexError, ValueError):
                continue
            fr = subs[0]
            if len(fr['pixels']) != fr['width'] * fr['height']:
                continue
            rgba = indexed_to_rgba(fr['pixels'], fr['width'], fr['height'], flat_pal)
            bclib.write_png(
                bclib.asset_dir('screens', GAME, PLATFORM) / f'{stem}-bmp-{a.unique}.png', rgba)
        print(f'  {len(bmp_assets)} BMP frame(s) -> screens/{stem}-bmp-*.png')

        # BMA = the same old-format multi-sub-bitmap table as GFF BMP/CHARPICS
        # (numSubBitmaps @ offset 4 + an offset table), just with many more
        # sub-images -- each one already IS an animation frame. (An earlier
        # version of this script assumed BMA frames were chained end-to-end
        # via next_pos, like nothing pointed at them; checking a real BMA
        # blob showed numSubBitmaps=66 read directly from its own header,
        # each offset already valid -- no chaining needed.)
        bma_assets = g.by_tag('BMA')
        total_frames = 0
        for a in bma_assets:
            blob = g.read(a)
            sprites = []
            try:
                subs = bitmap.decode_all_subbitmaps(blob, 0)
            except (IndexError, ValueError):
                subs = []
            for i, fr in enumerate(subs[:MAX_BMA_FRAMES_PER_ASSET]):
                if len(fr['pixels']) != fr['width'] * fr['height']:
                    continue
                rgba = indexed_to_rgba(fr['pixels'], fr['width'], fr['height'], flat_pal)
                sprites.append((f'{stem}-bma-{a.unique}-{i:03d}', rgba))
            if sprites:
                sheet, frames = bclib.pack_atlas(sprites, max_width=2048)
                bclib.write_atlas(f'{stem}-bma-{a.unique}', sheet, frames,
                                  category='sprites', game=GAME, platform=PLATFORM)
                total_frames += len(sprites)
        print(f'  {len(bma_assets)} BMA animation(s), {total_frames} frames total '
              f'-> sprites/{stem}-bma-*.png')


if __name__ == '__main__':
    main()

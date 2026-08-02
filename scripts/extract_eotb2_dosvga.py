#!/usr/bin/env python3
"""Eye of the Beholder II (DOS/VGA) extractor.

Unlike EOB1, this corpus (data/eotb2/dosvga/) ships as loose files with NO
PAK container — confirmed by `strings START.EXE` referencing `.CPS`
filenames directly (e.g. "COIN.CPS", "DRAGON1.CPS") with zero `.PAK`
mentions anywhere in the executable. `START.EXE` (333 KB) is the real game
executable; `SETUP.EXE` is a small config utility. See
docs/eotb2/dosvga/data-structure.md.

Reuses kyralib (shared with EOB1 and Lands of Lore) unchanged for the CPS
bitmap header, LCW decompression, VGA palette, VCN/VMP tileset, and MAZ
level-grid decode — all byte-identical formats to EOB1's DOS files.

Writes:
  - palettes/*.json       every standalone .PAL (19 files, 768 B/256-colour)
  - screens/*.png (+json)  every .CPS as a 1-frame atlas
  - textures/*_vcn.png     the 6 wall-set .VCN tilesets
  - data/*.json            MAZ level grids (15 levels)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from bclib.atlas import Frame
from bclib.paths import asset_dir, write_atlas, write_json, data_dir
from kyralib.format80 import decompress_bitmap
from kyralib.palette import vga_palette_to_rgb, palette_to_rgba
from kyralib.vcn import parse_vcn, decode_all_tiles
from kyralib.maze import parse_maz

GAME = 'eotb2'
PLATFORM = 'dosvga'

WALL_SETS = ['AZURE', 'CRIMSON', 'DUNG', 'FOREST', 'MEZZ', 'SILVER']

# No CPS in this corpus names its own default UI/menu palette identically;
# PALETTE0.PAL was found empirically to render DARKMOON.CPS (the "Legend of
# Darkmoon" title screen) and other non-wall-set screens correctly.
DEFAULT_PALETTE = 'PALETTE0.PAL'


def find_palette_for(base: Path, stem: str) -> bytes | None:
    for ext in ('PAL',):
        cand = base / f'{stem}.{ext}'
        if cand.exists():
            return cand.read_bytes()
    default = base / DEFAULT_PALETTE
    return default.read_bytes() if default.exists() else None


def extract_palettes(base: Path):
    written = 0
    for path in sorted(base.glob('*.PAL')):
        chunk = path.read_bytes()
        if len(chunk) % 3 != 0 or len(chunk) == 0:
            continue
        rgb = vga_palette_to_rgb(chunk)
        colors = [{'r': int(r), 'g': int(g), 'b': int(b)} for r, g, b in rgb]
        write_json(asset_dir('palettes', GAME, PLATFORM) / f'{path.stem.lower()}.json',
                   {'colors': colors}, pretty=True)
        written += 1
    return written


def extract_cps_screens(base: Path):
    written = 0
    skipped = []
    for path in sorted(base.glob('*.CPS')):
        chunk = path.read_bytes()
        try:
            header, pixels = decompress_bitmap(chunk)
        except Exception as exc:
            skipped.append((path.name, str(exc)))
            continue
        if header.img_size != 64000:
            skipped.append((path.name, f'unexpected img_size {header.img_size}'))
            continue

        if header.pal_size:
            rgb = vga_palette_to_rgb(header.palette)
        else:
            pal_bytes = find_palette_for(base, path.stem)
            if pal_bytes is None:
                skipped.append((path.name, 'no palette found'))
                continue
            rgb = vga_palette_to_rgb(pal_bytes)
        if rgb.shape[0] < 256:
            rgb = np.concatenate([rgb, np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)])
        rgba_pal = palette_to_rgba(rgb, transparent_index=None)

        img = np.frombuffer(pixels, dtype=np.uint8).reshape(200, 320)
        sheet = rgba_pal[img]

        out_name = path.stem.lower()
        frames = [Frame(out_name, 0, 0, 320, 200)]
        write_atlas(out_name, sheet, frames, category='screens',
                    game=GAME, platform=PLATFORM)
        written += 1
    return written, skipped


def extract_vcn_wallsets(base: Path):
    written = 0
    for wall in WALL_SETS:
        vcn_path = base / f'{wall}.VCN'
        pal_path = base / f'{wall}.PAL'
        if not vcn_path.exists() or not pal_path.exists():
            continue
        vcn = parse_vcn(vcn_path.read_bytes())
        tiles = decode_all_tiles(vcn)

        rgb = vga_palette_to_rgb(pal_path.read_bytes())
        if rgb.shape[0] < 256:
            rgb = np.concatenate([rgb, np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)])
        rgba_pal = palette_to_rgba(rgb, transparent_index=0)

        cols = 32
        rows = (vcn.num_tiles + cols - 1) // cols
        sheet_idx = np.zeros((rows * 8, cols * 8), dtype=np.uint8)
        frames = []
        for i in range(vcn.num_tiles):
            r, c = divmod(i, cols)
            sheet_idx[r * 8:(r + 1) * 8, c * 8:(c + 1) * 8] = tiles[i]
            frames.append(Frame(f'{wall.lower()}_{i:04d}', c * 8, r * 8, 8, 8))

        sheet = rgba_pal[sheet_idx]
        write_atlas(f'{wall.lower()}_vcn', sheet, frames, category='textures',
                    game=GAME, platform=PLATFORM)
        written += 1
    return written


def extract_mazes(base: Path):
    written = 0
    for path in sorted(base.glob('LEVEL*.MAZ'), key=lambda p: int(''.join(filter(str.isdigit, p.stem)))):
        try:
            maze = parse_maz(path.read_bytes())
        except Exception:
            continue
        out = {
            'width': maze.width,
            'height': maze.height,
            'tileSizeFlag': maze.tile_size_flag,
            'walls': maze.walls.tolist(),
        }
        write_json(asset_dir('data', GAME, PLATFORM) / f'{path.stem.lower()}_maz.json', out)
        written += 1
    return written


def main():
    base = data_dir(GAME, PLATFORM)

    n_pal = extract_palettes(base)
    print(f'Palettes: {n_pal}')

    n_cps, skipped = extract_cps_screens(base)
    print(f'CPS screens: {n_cps} (skipped {len(skipped)})')
    for name, reason in skipped[:20]:
        print(f'  skip {name}: {reason}')

    n_vcn = extract_vcn_wallsets(base)
    print(f'VCN wall tilesets: {n_vcn}')

    n_maz = extract_mazes(base)
    print(f'MAZ level grids: {n_maz}')


if __name__ == '__main__':
    main()

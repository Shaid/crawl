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
                          plus the 8 alternate EGA-render-mode .PAL-shaped
                          .EGA files, suffixed `_ega` to avoid colliding
                          with the same-stem .PAL output
  - screens/*.png (+json)  every .CPS as a 1-frame atlas
  - textures/*_vcn.png     the 6 wall-set .VCN tilesets
  - data/*.json            MAZ level grids (15 levels), ITEM.DAT,
                          ITEMTYPE.DAT, TEXT.DAT, per-file .DCR and .DEC
                          decoration tables
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
from kyralib.items import parse_item_dat, parse_itemtype_dat, item_dat_to_json, itemtype_dat_to_json
from kyralib.decorations import parse_dec, dec_to_json
from kyralib.dcr import parse_dcr, dcr_to_json
from kyralib.textdat import parse_text_dat
from kyralib.inf import parse_inf2_sublevels

GAME = 'eotb2'
PLATFORM = 'dosvga'

WALL_SETS = ['AZURE', 'CRIMSON', 'DUNG', 'FOREST', 'MEZZ', 'SILVER']

# No CPS in this corpus names its own default UI/menu palette identically;
# PALETTE0.PAL was found empirically to render DARKMOON.CPS (the "Legend of
# Darkmoon" title screen) and other non-wall-set screens correctly. Still
# the right fallback for genuine UI/menu/item CPS files -- but was
# previously (wrongly) also the fallback for every monster CPS with no
# name-matched .PAL, which produced garish, level-palette-mismatched
# colours (confirmed visually: ant.png, basilisk.png, beholder.png all
# rendered with electric-blue/purple/red colours before this fix). See
# `build_monster_wallset_palette` and docs/eotb2/dosvga/data-structure.md
# § "Palette resolution (per-CPS)".
DEFAULT_PALETTE = 'PALETTE0.PAL'

NUM_LEVELS = 16


def build_monster_wallset_palette(base: Path) -> dict[str, str]:
    """{MONSTER_CPS_STEM (uppercase): PALETTE_STEM (uppercase, no ext)} --
    EOB2 port of EOB1's `build_monster_wallset_palette`
    (`extract_eotb_dosvga.py`): a monster CPS is composited over the
    already-loaded dungeon view, so its real in-game palette is whatever
    wall-set `.PAL` is active for the level it appears on, not a name
    match on the monster's own stem (none of these files have one) or the
    game-wide UI fallback.

    Reads every `LEVELn.INF`'s **full sub-level chain**
    (`kyralib.inf.parse_inf2_sublevels` -- EOB2-specific: different header
    offsets from EOB1, plus a sub-level chaining mechanism this session
    found is genuinely used -- several real monster CPS stems, including
    `ant`, only appear in a level's *second* sub-level block, which a
    naive sub==0-only header parse misses entirely). For each sub-level,
    the palette a monster resolves to is `secondWallSetStem` when present
    (the LEVEL10-14 AZURE override -- see "INF -- Level configuration"),
    else `wallSetStem`.

    Verified against all 16 real `LEVELn.INF` files: 29 distinct monster
    stems resolve (up from 24 using sub==0 alone), each to exactly one
    palette stem, **except `cleric1`** which appears on both LEVEL5
    (`mezz`) and LEVEL8's second sub-level (`silver`) -- the one case
    where EOB2 breaks EOB1's "no monster reused across two wall sets"
    invariant. First-occurrence-wins (level order, then sub-level order)
    is used as the tie-break, so `cleric1` resolves to `mezz`; documented
    here as an acknowledged, deliberate choice rather than silently
    picking one."""
    mapping: dict[str, str] = {}
    for level in range(1, NUM_LEVELS + 1):
        inf_path = base / f'LEVEL{level}.INF'
        if not inf_path.exists():
            continue
        try:
            sublevels = parse_inf2_sublevels(inf_path.read_bytes())
        except Exception:
            continue
        for sub in sublevels:
            palette_stem = (sub.second_wall_set_stem or sub.wall_set_stem).upper()
            for stem in sub.monster_stems:
                key = stem.upper()
                mapping.setdefault(key, palette_stem)  # first occurrence wins
    return mapping


def find_palette_for(base: Path, stem: str, monster_wallset: dict[str, str] | None = None) -> bytes | None:
    monster_wallset = monster_wallset or {}
    if stem.upper() in monster_wallset:
        pal_name = f'{monster_wallset[stem.upper()]}.PAL'
        cand = base / pal_name
        if cand.exists():
            return cand.read_bytes()
        # Fall through to the ordinary lookup if the mapped wall-set
        # somehow has no .PAL on disk (shouldn't happen in this corpus --
        # all 6 wall-set stems the mapping can produce have one).
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


def extract_cps_screens(base: Path, monster_wallset: dict[str, str] | None = None):
    monster_wallset = monster_wallset or {}
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
            pal_bytes = find_palette_for(base, path.stem, monster_wallset)
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


def extract_ega_palettes(base: Path):
    """The 8 `.EGA` files in this corpus are NOT graphics (unlike EOB1) —
    they are 768-byte alternate VGA-style palettes selected instead of the
    matching `.PAL` when the game's EGA render mode is active. Decoded with
    the same reader as `.PAL`, written under a `_ega` suffix so they don't
    collide with the same-stem `.PAL` output. See data-structure.md §
    ".EGA files"."""
    written = 0
    for path in sorted(base.glob('*.EGA')):
        chunk = path.read_bytes()
        if len(chunk) != 768:
            continue
        rgb = vga_palette_to_rgb(chunk)
        colors = [{'r': int(r), 'g': int(g), 'b': int(b)} for r, g, b in rgb]
        write_json(asset_dir('palettes', GAME, PLATFORM) / f'{path.stem.lower()}_ega.json',
                   {'colors': colors}, pretty=True)
        written += 1
    return written


def extract_item_tables(base: Path):
    written = 0
    item_path = base / 'ITEM.DAT'
    if item_path.exists():
        item_dat = parse_item_dat(item_path.read_bytes())
        write_json(asset_dir('data', GAME, PLATFORM) / 'item.json',
                   item_dat_to_json(item_dat), pretty=True)
        written += 1
    itemtype_path = base / 'ITEMTYPE.DAT'
    if itemtype_path.exists():
        itemtypes = parse_itemtype_dat(itemtype_path.read_bytes())
        write_json(asset_dir('data', GAME, PLATFORM) / 'itemtype.json',
                   itemtype_dat_to_json(itemtypes), pretty=True)
        written += 1
    return written


def extract_text_dat(base: Path):
    written = 0
    text_path = base / 'TEXT.DAT'
    if text_path.exists():
        strings = parse_text_dat(text_path.read_bytes())
        write_json(asset_dir('data', GAME, PLATFORM) / 'text.json',
                   {'strings': strings}, pretty=True)
        written = 1
    return written


def extract_dcr_files(base: Path):
    written = 0
    for path in sorted(base.glob('*.DCR')):
        dcr = parse_dcr(path.read_bytes())
        write_json(asset_dir('data', GAME, PLATFORM) / f'{path.stem.lower()}_dcr.json',
                   dcr_to_json(dcr), pretty=True)
        written += 1
    return written


def extract_dec_files(base: Path):
    written = 0
    for path in sorted(base.glob('*.DEC')):
        dec = parse_dec(path.read_bytes())
        write_json(asset_dir('data', GAME, PLATFORM) / f'{path.stem.lower()}_dec.json',
                   dec_to_json(dec), pretty=True)
        written += 1
    return written


def main():
    base = data_dir(GAME, PLATFORM)

    n_pal = extract_palettes(base)
    print(f'Palettes: {n_pal}')

    monster_wallset = build_monster_wallset_palette(base)
    print(f'Monster CPS -> wall-set palette mappings: {len(monster_wallset)}')

    n_cps, skipped = extract_cps_screens(base, monster_wallset)
    print(f'CPS screens: {n_cps} (skipped {len(skipped)})')
    for name, reason in skipped[:20]:
        print(f'  skip {name}: {reason}')

    n_vcn = extract_vcn_wallsets(base)
    print(f'VCN wall tilesets: {n_vcn}')

    n_maz = extract_mazes(base)
    print(f'MAZ level grids: {n_maz}')

    n_ega = extract_ega_palettes(base)
    print(f'EGA alternate palettes: {n_ega}')

    n_items = extract_item_tables(base)
    print(f'Item tables (ITEM.DAT/ITEMTYPE.DAT): {n_items}')

    n_text = extract_text_dat(base)
    print(f'TEXT.DAT: {n_text}')

    n_dcr = extract_dcr_files(base)
    print(f'DCR monster-decoration files: {n_dcr}')

    n_dec = extract_dec_files(base)
    print(f'DEC level-decoration files: {n_dec}')


if __name__ == '__main__':
    main()

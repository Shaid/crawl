#!/usr/bin/env python3
"""Eye of the Beholder 1 (DOS/VGA) extractor.

Reads the six EOBDATA{1..6}.PAK containers under data/eotb/dosvga/ (parsed
with kyralib.pak, byte-exact port of ScummVM's ResLoaderPak) and writes:

  - palettes/*.json      every standalone 768-byte VGA palette (.PAL / .COL)
  - screens/*.png (+json) every .CPS/.CMP full-canvas image (320x200 VGA),
                          as a 1-frame atlas, LCW-decompressed via
                          kyralib.format80 and coloured with the best
                          name-matched palette found across the whole game
  - textures/*_vcn.png   every wall-set .VCN tileset (8x8 tiles), packed
                          into one atlas per wall set, decoded via
                          kyralib.vcn
  - data/*.json           MAZ level grids (kyralib.maze) and the PAK
                          directory listing itself, for traceability

See docs/eotb/dosvga/data-structure.md for verification evidence.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from bclib.atlas import Frame
from bclib.paths import asset_dir, write_atlas, write_json, data_dir
from kyralib.pak import load_pak, PakEntry
from kyralib.format80 import decompress_bitmap
from kyralib.palette import vga_palette_to_rgb, palette_to_rgba
from kyralib.vcn import parse_vcn, decode_all_tiles
from kyralib.maze import parse_maz

GAME = 'eotb'
PLATFORM = 'dosvga'

PAK_FILES = [f'EOBDATA{i}.PAK' for i in range(1, 7)]

WALL_SETS = ['BLUE', 'BRICK', 'DROW', 'GREEN', 'XANATHA']

# Palette resolution fallbacks when no name-matched .PAL/.COL exists.
DEFAULT_PALETTE = 'EOBPAL.COL'


def load_all_paks(base: Path):
    """Return {pak_filename: (raw_bytes, {name: PakEntry})} and a global
    name -> (pak_filename, PakEntry) index (first occurrence wins, matching
    how the game's own resource loader would resolve a bare filename)."""
    paks = {}
    global_index: dict[str, tuple[str, PakEntry]] = {}
    for pak_name in PAK_FILES:
        path = base / pak_name
        if not path.exists():
            continue
        data, entries = load_pak(str(path))
        paks[pak_name] = (data, entries)
        for name, entry in entries.items():
            if name not in global_index:
                global_index[name] = (pak_name, entry)
    return paks, global_index


def get_bytes(paks, global_index, name) -> bytes | None:
    hit = global_index.get(name)
    if hit is None:
        return None
    pak_name, entry = hit
    data, _ = paks[pak_name]
    return data[entry.offset:entry.offset + entry.size]


def find_palette_for(name_no_ext: str, paks, global_index) -> bytes:
    """Best-effort name-matched VGA palette lookup: <STEM>.PAL, then
    <STEM>.COL, then the global default EOBPAL.COL. Unverified per-file
    (the game's actual palette-selection logic is data-driven inside INF/
    level-load code we have not traced for every screen) — labelled
    'rendered' confidence in the docs, not 'confirmed'."""
    for ext in ('PAL', 'COL'):
        cand = f'{name_no_ext}.{ext}'
        b = get_bytes(paks, global_index, cand)
        if b is not None:
            return b
    return get_bytes(paks, global_index, DEFAULT_PALETTE)


def extract_palettes(paks, global_index):
    written = 0
    for pak_name, (data, entries) in paks.items():
        for name, entry in entries.items():
            if not (name.upper().endswith('.PAL') or name.upper().endswith('.COL')):
                continue
            chunk = data[entry.offset:entry.offset + entry.size]
            if len(chunk) % 3 != 0 or len(chunk) == 0:
                continue
            rgb = vga_palette_to_rgb(chunk)
            out_name = name.rsplit('.', 1)[0].lower()
            colors = [{'r': int(r), 'g': int(g), 'b': int(b)} for r, g, b in rgb]
            write_json(asset_dir('palettes', GAME, PLATFORM) / f'{out_name}.json',
                       {'colors': colors}, pretty=True)
            written += 1
    return written


def extract_cps_screens(paks, global_index):
    written = 0
    skipped = []
    for pak_name, (data, entries) in paks.items():
        for name, entry in entries.items():
            upper = name.upper()
            if not (upper.endswith('.CPS') or upper.endswith('.CMP')):
                continue
            chunk = data[entry.offset:entry.offset + entry.size]
            try:
                header, pixels = decompress_bitmap(chunk)
            except Exception as exc:
                skipped.append((name, str(exc)))
                continue
            if header.img_size != 64000:
                skipped.append((name, f'unexpected img_size {header.img_size}'))
                continue

            stem = name.rsplit('.', 1)[0]
            if header.pal_size:
                rgb = vga_palette_to_rgb(header.palette)
            else:
                pal_bytes = find_palette_for(stem, paks, global_index)
                if pal_bytes is None:
                    skipped.append((name, 'no palette found'))
                    continue
                rgb = vga_palette_to_rgb(pal_bytes)
            # Pad palette to 256 entries if short (some standalone palettes are <256 colours).
            if rgb.shape[0] < 256:
                pad = np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)
                rgb = np.concatenate([rgb, pad], axis=0)
            rgba_pal = palette_to_rgba(rgb, transparent_index=None)

            img = np.frombuffer(pixels, dtype=np.uint8).reshape(200, 320)
            sheet = rgba_pal[img]

            out_name = stem.lower()
            frames = [Frame(out_name, 0, 0, 320, 200)]
            write_atlas(out_name, sheet, frames, category='screens',
                        game=GAME, platform=PLATFORM)
            written += 1
    return written, skipped


def extract_vcn_wallsets(paks, global_index):
    written = 0
    for wall in WALL_SETS:
        vcn_bytes = get_bytes(paks, global_index, f'{wall}.VCN')
        pal_bytes = get_bytes(paks, global_index, f'{wall}.PAL')
        if vcn_bytes is None or pal_bytes is None:
            continue
        vcn = parse_vcn(vcn_bytes)
        tiles = decode_all_tiles(vcn)  # (n, 8, 8) palette indices (post col_map)

        rgb = vga_palette_to_rgb(pal_bytes)
        if rgb.shape[0] < 256:
            pad = np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)
            rgb = np.concatenate([rgb, pad], axis=0)
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


def extract_mazes(paks, global_index):
    written = 0
    for level in range(1, 13):
        maz_bytes = get_bytes(paks, global_index, f'LEVEL{level}.MAZ')
        if maz_bytes is None:
            continue
        try:
            maze = parse_maz(maz_bytes)
        except Exception:
            continue
        out = {
            'width': maze.width,
            'height': maze.height,
            'tileSizeFlag': maze.tile_size_flag,
            'walls': maze.walls.tolist(),  # 1024 x [N,E,S,W]
        }
        write_json(asset_dir('data', GAME, PLATFORM) / f'level{level}_maz.json', out)
        written += 1
    return written


def main():
    base = data_dir(GAME, PLATFORM)
    paks, global_index = load_all_paks(base)
    print(f'Loaded {len(paks)} PAK files, {len(global_index)} unique entries')

    n_pal = extract_palettes(paks, global_index)
    print(f'Palettes: {n_pal}')

    n_cps, skipped = extract_cps_screens(paks, global_index)
    print(f'CPS/CMP screens: {n_cps} (skipped {len(skipped)})')
    for name, reason in skipped[:20]:
        print(f'  skip {name}: {reason}')

    n_vcn = extract_vcn_wallsets(paks, global_index)
    print(f'VCN wall tilesets: {n_vcn}')

    n_maz = extract_mazes(paks, global_index)
    print(f'MAZ level grids: {n_maz}')

    # Directory listing for traceability / debugging.
    listing = {}
    for pak_name, (_data, entries) in paks.items():
        listing[pak_name] = [
            {'name': e.name, 'offset': e.offset, 'size': e.size}
            for e in sorted(entries.values(), key=lambda e: e.offset)
        ]
    write_json(asset_dir('data', GAME, PLATFORM) / 'pak_directory.json', listing, pretty=True)


if __name__ == '__main__':
    main()

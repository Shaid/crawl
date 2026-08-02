#!/usr/bin/env python3
"""Lands of Lore: The Throne of Chaos (DOS/VGA) extractor.

`data/landsoflore/dosvga/GAME.DAT` (306,751,488 bytes) is NOT a Kyra
resource file — it's a raw ISO 9660 CD-ROM image (`CD001` signature at the
standard offset 0x8001; 7z identifies it as `Type = Iso`, Volume
`LOL_V102`, Publisher `WESTWOOD STUDIOS`). The real Kyra-engine PAK files
(`DATA/STARTUP.PAK`, `DATA/ENG/GENERAL.PAK`, `DATA/L01.PAK`,
`DATA/MONSTER.PAK`, `DATA/CATWALK.PAK`, ...) live inside it. This extractor
shells out to `7z` (already a project dependency conceptually alongside
amitools/ira for other platforms — see docs/landsoflore/dosvga/data-structure.md)
to pull a representative subset of PAKs out to `build/cache/landsoflore/iso/`,
then decodes them with the same kyralib used for EOB1/EOB2.

Format notes specific to LOL (all confirmed against real files — see the
doc): PAK container and CPS/LCW are byte-identical to EOB. VCN tiles are
identical too. VMP and the level grid (here named .CMZ, not .MAZ) are
BOTH wrapped in an extra outer Kyra-bitmap/LCW layer that EOB's raw
.VMP/.MAZ files don't have — kyralib.vcn.parse_vmp auto-detects this;
.CMZ is decompressed once via kyralib.format80 then parsed identically to
an EOB .MAZ via kyralib.maze. LOL also introduces a new format, .SHP
(multi-frame creature/UI sprites) — kyralib.shp, ported from ScummVM's
Screen_v2::getPtrToShape + Screen::drawShape's scanline decoder.

Known unresolved issue (see doc): the default/UI palettes in this corpus
reserve a placeholder range at literal RGB (255, 0, 255) for wall-texture
and monster-body colours, which the live game patches in at runtime from
a source not yet located in this static corpus. This extractor renders
that placeholder range as transparent rather than publishing bogus
magenta pixels — VCN/SHP *structure* is confirmed byte-exact; final
colour for those two asset classes is not.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from bclib.atlas import Frame
from bclib.paths import asset_dir, cache_dir, write_atlas, write_json, data_dir
from kyralib.pak import parse_pak, read_entry
from kyralib.format80 import decompress_bitmap
from kyralib.palette import vga_palette_to_rgb, palette_to_rgba
from kyralib.vcn import parse_vcn, decode_all_tiles
from kyralib.maze import parse_maz
from kyralib.shp import parse_shp_container, decode_shape_indices

GAME = 'landsoflore'
PLATFORM = 'dosvga'

# Representative subset (breadth-first pass, not the full ~300MB ISO).
ISO_PATHS = [
    'DATA/STARTUP.PAK',
    'DATA/ENG/STARTUP.PAK',
    'DATA/ENG/GENERAL.PAK',
    'DATA/ENG/INTRO1.PAK',
    'DATA/MONSTER.PAK',
    'DATA/CATWALK.PAK',
    'DATA/L01.PAK',
]

def greyscale_ramp_rgba(transparent_index: int = 0) -> np.ndarray:
    """256-entry grey ramp (index N -> RGB (N,N,N)), index 0 transparent.

    Used instead of a real palette for VCN/SHP assets whose true in-game
    colour source is unresolved in this corpus (see module docstring) —
    per this project's convention of rendering unconfirmed-palette content
    in greyscale rather than guessing a colour that might be wrong (a
    wrong palette makes a correct decode look wrong; grey makes clear
    what IS confirmed: the shape/structure, not the colour)."""
    idx = np.arange(256, dtype=np.uint8)
    rgba = np.stack([idx, idx, idx, np.full(256, 255, dtype=np.uint8)], axis=1)
    rgba[transparent_index, 3] = 0
    return rgba


def extract_from_iso(iso_path: Path, cache: Path) -> Path:
    out_dir = cache / 'iso'
    out_dir.mkdir(parents=True, exist_ok=True)
    missing = [p for p in ISO_PATHS if not (out_dir / p).exists()]
    if missing:
        subprocess.run(['7z', 'x', '-y', f'-o{out_dir}', str(iso_path), *missing],
                        check=True, capture_output=True)
    return out_dir


def load_pak(root: Path, rel: str):
    data = (root / rel).read_bytes()
    entries = {e.name: e for e in parse_pak(data)}
    return data, entries


def extract_palettes(root: Path):
    written = 0
    seen = set()
    for rel in ISO_PATHS:
        data, entries = load_pak(root, rel)
        for name, entry in entries.items():
            if not name.upper().endswith('.COL'):
                continue
            if name in seen:
                continue
            seen.add(name)
            chunk = read_entry(data, entry)
            if len(chunk) % 3 != 0 or not chunk:
                continue
            rgb = vga_palette_to_rgb(chunk)
            colors = [{'r': int(r), 'g': int(g), 'b': int(b)} for r, g, b in rgb]
            write_json(asset_dir('palettes', GAME, PLATFORM) / f'{name.rsplit(".",1)[0].lower()}.json',
                       {'colors': colors}, pretty=True)
            written += 1
    return written


def extract_cps_screens(root: Path):
    written = 0
    skipped = []
    seen = set()
    for rel in ISO_PATHS:
        data, entries = load_pak(root, rel)
        for name, entry in entries.items():
            if not name.upper().endswith('.CPS'):
                continue
            if name in seen:
                continue
            seen.add(name)
            chunk = read_entry(data, entry)
            try:
                header, pixels = decompress_bitmap(chunk)
            except Exception as exc:
                skipped.append((name, str(exc)))
                continue
            if header.img_size != 64000 or not header.pal_size:
                skipped.append((name, f'img_size={header.img_size} pal_size={header.pal_size}'))
                continue
            rgb = vga_palette_to_rgb(header.palette)
            if rgb.shape[0] < 256:
                rgb = np.concatenate([rgb, np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)])
            rgba_pal = palette_to_rgba(rgb, transparent_index=None)
            img = np.frombuffer(pixels, dtype=np.uint8).reshape(200, 320)
            sheet = rgba_pal[img]
            out_name = name.rsplit('.', 1)[0].lower()
            write_atlas(out_name, sheet, [Frame(out_name, 0, 0, 320, 200)],
                        category='screens', game=GAME, platform=PLATFORM)
            written += 1
    return written, skipped


def extract_vcn_wallset(root: Path, pak_rel: str, stem: str):
    data, entries = load_pak(root, pak_rel)
    vcn_name = f'{stem}.VCN'
    if vcn_name not in entries:
        return False
    vcn = parse_vcn(read_entry(data, entries[vcn_name]))
    tiles = decode_all_tiles(vcn)

    # Rendered in greyscale, not colour -- see module docstring: this
    # corpus's wall-tile colour source (colMap indices land in a palette
    # range that's a literal (255,0,255) placeholder in every candidate
    # palette checked) is not resolved. Structure (tile count, byte size)
    # IS confirmed; colour is not.
    rgba_pal = greyscale_ramp_rgba()
    cols = 32
    rows = (vcn.num_tiles + cols - 1) // cols
    sheet_idx = np.zeros((rows * 8, cols * 8), dtype=np.uint8)
    frames = []
    for i in range(vcn.num_tiles):
        r, c = divmod(i, cols)
        sheet_idx[r * 8:(r + 1) * 8, c * 8:(c + 1) * 8] = tiles[i]
        frames.append(Frame(f'{stem.lower()}_{i:04d}', c * 8, r * 8, 8, 8))
    sheet = rgba_pal[sheet_idx]
    write_atlas(f'{stem.lower()}_vcn', sheet, frames, category='textures',
                game=GAME, platform=PLATFORM)
    return True


def extract_shp_sprites(root: Path, pak_rel: str, stem: str):
    data, entries = load_pak(root, pak_rel)
    shp_name = f'{stem}.SHP'
    if shp_name not in entries:
        return False
    shapes = parse_shp_container(read_entry(data, entries[shp_name]))
    if not shapes:
        return False

    # Greyscale, not colour -- see extract_vcn_wallset's comment and the
    # module docstring. Shape/silhouette decode is confirmed byte-exact
    # (every shape's scanline stream consumes exactly its declared
    # frame_size); the colour-table remap's target palette is not.
    rgba_pal = greyscale_ramp_rgba()
    sprites = []
    for i, s in enumerate(shapes):
        idx = decode_shape_indices(s)
        sprites.append((f'{stem.lower()}_{i:02d}', rgba_pal[idx]))

    from bclib.atlas import pack_atlas
    sheet, frames = pack_atlas(sprites)
    write_atlas(f'{stem.lower()}_shp', sheet, frames, category='sprites',
                game=GAME, platform=PLATFORM)
    return True


def extract_cmz_level(root: Path, pak_rel: str, level_name: str):
    data, entries = load_pak(root, pak_rel)
    cmz_entries = [n for n in entries if n.upper().endswith('.CMZ')]
    written = 0
    for name in cmz_entries:
        chunk = read_entry(data, entries[name])
        try:
            _header, payload = decompress_bitmap(chunk)
            maze = parse_maz(payload)
        except Exception:
            continue
        out = {
            'width': maze.width, 'height': maze.height,
            'tileSizeFlag': maze.tile_size_flag, 'walls': maze.walls.tolist(),
        }
        write_json(asset_dir('data', GAME, PLATFORM) / f'{name.rsplit(".",1)[0].lower()}_cmz.json', out)
        written += 1
    return written


def main():
    iso_path = data_dir(GAME, PLATFORM) / 'GAME.DAT'
    cache = cache_dir(GAME)
    root = extract_from_iso(iso_path, cache)

    n_pal = extract_palettes(root)
    print(f'Palettes: {n_pal}')

    n_cps, skipped = extract_cps_screens(root)
    print(f'CPS screens (embedded palette only): {n_cps} (skipped {len(skipped)})')
    for name, reason in skipped[:20]:
        print(f'  skip {name}: {reason}')

    ok = extract_vcn_wallset(root, 'DATA/CATWALK.PAK', 'CATWALK')
    print(f'CATWALK VCN wall tileset: {"ok" if ok else "missing"} (rendered greyscale, see docs)')

    ok = extract_shp_sprites(root, 'DATA/MONSTER.PAK', 'LIZARD')
    print(f'LIZARD SHP creature sprite: {"ok" if ok else "missing"} (rendered greyscale, see docs)')
    for stem in ['ORC', 'TREZ', 'CABAL']:
        extract_shp_sprites(root, 'DATA/MONSTER.PAK', stem)

    n_cmz = extract_cmz_level(root, 'DATA/L01.PAK', 'level1')
    print(f'CMZ level grids (L01.PAK): {n_cmz}')


if __name__ == '__main__':
    main()

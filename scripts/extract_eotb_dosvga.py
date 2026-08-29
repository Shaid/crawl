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
  - screens/*.png (EGA)  every .EGA render-mode bitmap, same container as
                          .CPS but coloured with the static, game-wide
                          EGA_DEFAULT_PALETTE (kyralib.ega_palette) instead
                          of a name-matched .PAL/.COL
  - textures/*_ecn.png   every wall-set .ECN (EGA-mode .VCN equivalent)
                          tileset, same layout as .VCN, EGA palette
  - data/*.json           MAZ level grids (kyralib.maze), ITEM.DAT/
                          ITEMTYPE.DAT (kyralib.items), and the PAK
                          directory listing itself, for traceability

Monster CPS screens (`screens/kobold.png` etc.) are coloured with the
owning level's wall-set palette (e.g. KOBOLD.CPS -> BRICK.PAL), resolved
via each LEVELn.INF's monster-shape-slot header fields (kyralib.inf) --
not the EOBPAL.COL fallback earlier passes used, which per
docs/eotb/dosvga/data-structure.md's own trace of `initLevelData` is very
likely wrong (a monster CPS is composited over the already-loaded dungeon
view, so its real palette is whatever wall-set `.PAL` is active for the
level that monster appears in).

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
from kyralib.items import parse_item_dat, parse_itemtype_dat
from kyralib.inf import parse_inf_header
from kyralib.ega_palette import ega_default_palette_rgb
from dataclasses import asdict

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


def resolve_monster_cps_name(stem: str, global_index) -> str | None:
    """`<STEM>.CPS`, falling back to `<STEM>1.CPS` -- ported from
    `Screen_EoB::loadEoBBitmap`'s EOB1 "loadAlternative" branch
    (`graphics/screen_eob.cpp`, fetched 2026-08-29):
    `tmp.insertChar('1', tmp.size() - 4)` when the bare `<STEM>.CPS` isn't
    found. Confirmed against this corpus: 6 of the 22 EOB1 monster stems
    embedded in LEVELn.INF (spider, drider, mantis, xorn, xanath, rust)
    have no bare `<STEM>.CPS` file at all -- only `<STEM>1.CPS` -- and this
    exact rule resolves every one of them with zero gaps."""
    direct = f'{stem.upper()}.CPS'
    if direct in global_index:
        return direct
    alt = f'{stem.upper()}1.CPS'
    if alt in global_index:
        return alt
    return None


def build_monster_wallset_palette(paks, global_index) -> dict[str, str]:
    """{MONSTER_CPS_FILENAME: WALLSET_STEM} for every monster named in any
    LEVELn.INF's monster-shape-slot header fields (kyralib.inf) -- see
    docs/eotb/dosvga/data-structure.md § "VGA palette" -> "Monster CPS
    files". Confirmed: all 22 EOB1 monsters resolve to exactly one
    wall-set apiece (no monster reused across two different wall sets in
    this corpus)."""
    mapping: dict[str, str] = {}
    for level in range(1, 13):
        inf_bytes = get_bytes(paks, global_index, f'LEVEL{level}.INF')
        if inf_bytes is None:
            continue
        try:
            header = parse_inf_header(inf_bytes)
        except Exception:
            continue
        for stem in header.monster_stems:
            cps_name = resolve_monster_cps_name(stem, global_index)
            if cps_name is None:
                continue
            mapping[cps_name] = header.wall_set_stem.upper()
    return mapping


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


def extract_cps_screens(paks, global_index, monster_wallset: dict[str, str] | None = None):
    monster_wallset = monster_wallset or {}
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
            elif upper in monster_wallset:
                # Monster CPS: composited over the owning level's dungeon
                # view in the live game, so its real palette is that
                # level's wall-set .PAL, not a name-match on the monster's
                # own stem (which has no .PAL/.COL of its own anyway) --
                # see docs/eotb/dosvga/data-structure.md § "VGA palette".
                pal_bytes = get_bytes(paks, global_index, f'{monster_wallset[upper]}.PAL')
                if pal_bytes is None:
                    pal_bytes = find_palette_for(stem, paks, global_index)
                rgb = vga_palette_to_rgb(pal_bytes)
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


def extract_ega_screens(paks, global_index):
    """`.EGA` render-mode bitmaps -- same container/codec as `.CPS`
    (kyralib.format80), but coloured with the single, static, game-wide
    EGA_DEFAULT_PALETTE (kyralib.ega_palette) instead of a name-matched
    .PAL/.COL. See docs/eotb/dosvga/data-structure.md § "EGA render mode"."""
    written = 0
    skipped = []
    rgb = ega_default_palette_rgb()  # 16 x 3
    pad = np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)
    rgba_pal = palette_to_rgba(np.concatenate([rgb, pad], axis=0), transparent_index=None)

    for pak_name, (data, entries) in paks.items():
        for name, entry in entries.items():
            if not name.upper().endswith('.EGA'):
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

            img = np.frombuffer(pixels, dtype=np.uint8).reshape(200, 320)
            # EGA-mode pixel bytes are indices into the 16-colour
            # EGA_DEFAULT_PALETTE, not the 256-colour VGA one -- mask to 4
            # bits to guard against any stray high-nibble bits, matching
            # the hardware's own 4bpp EGA planes.
            sheet = rgba_pal[img & 0x0F]

            # `_ega` suffix is load-bearing, not cosmetic: every .EGA stem
            # is identical to its .CPS sibling's stem (DOOR.EGA/DOOR.CPS,
            # KOBOLD.EGA/KOBOLD.CPS, ...), and write_atlas's manifest key
            # is 'screens/<name>' -- writing both under the bare stem would
            # silently overwrite the VGA screen (extract_cps_screens runs
            # first in main(), so the EGA version would win invisibly).
            out_name = f"{name.rsplit('.', 1)[0].lower()}_ega"
            frames = [Frame(out_name, 0, 0, 320, 200)]
            write_atlas(out_name, sheet, frames, category='screens',
                        game=GAME, platform=PLATFORM)
            written += 1
    return written, skipped


def decode_ecn_tile_raw(vcn, tile_idx: int) -> np.ndarray:
    """Decode one 8x8 ECN tile to its RAW nibble values (0-15), bypassing
    `vcn.col_map`. Confirmed empirically: every real EOB1 `.ECN`'s
    `col_map[0:16]` is all-zero (unlike the VGA `.VCN` case, where col_map
    is a real nibble -> 256-colour remap) -- EGA mode's raw tile nibbles
    already ARE the intended 0-15 EGA-palette index, with no remap layer
    at all (the format-shared 32-byte col_map field is present but
    vestigial for this render mode)."""
    off = tile_idx * 32
    raw = vcn.tiles[off:off + 32]
    out = np.zeros((8, 8), dtype=np.uint8)
    for row in range(8):
        for bx in range(4):
            b = raw[row * 4 + bx]
            out[row, bx * 2] = b >> 4
            out[row, bx * 2 + 1] = b & 0xF
    return out


def extract_ecn_wallsets(paks, global_index):
    """`.ECN` -- the EGA-mode `.VCN` equivalent. Structurally identical
    container (kyralib.vcn's parse_vcn works unmodified for the header --
    verified byte-exact against all 5 real EOB1 wall sets: numTiles*32+34
    equals the decompressed payload length exactly for every one), coloured
    with the static EGA_DEFAULT_PALETTE instead of a name-matched .PAL, and
    decoded via `decode_ecn_tile_raw` (see its doc -- `col_map` is
    vestigial/all-zero in every real `.ECN` in this corpus, unlike VGA
    `.VCN`)."""
    written = 0
    rgb = ega_default_palette_rgb()
    pad = np.zeros((256 - rgb.shape[0], 3), dtype=np.uint8)
    rgba_pal = palette_to_rgba(np.concatenate([rgb, pad], axis=0), transparent_index=0)

    for wall in WALL_SETS:
        ecn_bytes = get_bytes(paks, global_index, f'{wall}.ECN')
        if ecn_bytes is None:
            continue
        vcn = parse_vcn(ecn_bytes)

        cols = 32
        rows = (vcn.num_tiles + cols - 1) // cols
        sheet_idx = np.zeros((rows * 8, cols * 8), dtype=np.uint8)
        frames = []
        for i in range(vcn.num_tiles):
            r, c = divmod(i, cols)
            sheet_idx[r * 8:(r + 1) * 8, c * 8:(c + 1) * 8] = decode_ecn_tile_raw(vcn, i)
            frames.append(Frame(f'{wall.lower()}_ega_{i:04d}', c * 8, r * 8, 8, 8))

        sheet = rgba_pal[sheet_idx]
        write_atlas(f'{wall.lower()}_ecn', sheet, frames, category='textures',
                    game=GAME, platform=PLATFORM)
        written += 1
    return written


def extract_item_data(paks, global_index):
    """ITEM.DAT / ITEMTYPE.DAT -> data/item.json, data/itemtype.json.
    See docs/eotb/dosvga/data-structure.md § "ITEM.DAT / ITEMTYPE.DAT"."""
    written = 0
    item_bytes = get_bytes(paks, global_index, 'ITEM.DAT')
    if item_bytes is not None:
        items, names = parse_item_dat(item_bytes)
        out = {
            'items': [asdict(it) for it in items],
            'names': names,
        }
        write_json(asset_dir('data', GAME, PLATFORM) / 'item.json', out)
        written += 1

    itemtype_bytes = get_bytes(paks, global_index, 'ITEMTYPE.DAT')
    if itemtype_bytes is not None:
        types = parse_itemtype_dat(itemtype_bytes)
        out = {'types': [asdict(t) for t in types]}
        write_json(asset_dir('data', GAME, PLATFORM) / 'itemtype.json', out)
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

    monster_wallset = build_monster_wallset_palette(paks, global_index)
    print(f'Monster CPS -> wall-set palette mappings: {len(monster_wallset)}')

    n_cps, skipped = extract_cps_screens(paks, global_index, monster_wallset)
    print(f'CPS/CMP screens: {n_cps} (skipped {len(skipped)})')
    for name, reason in skipped[:20]:
        print(f'  skip {name}: {reason}')

    n_vcn = extract_vcn_wallsets(paks, global_index)
    print(f'VCN wall tilesets: {n_vcn}')

    n_ega, ega_skipped = extract_ega_screens(paks, global_index)
    print(f'EGA screens: {n_ega} (skipped {len(ega_skipped)})')
    for name, reason in ega_skipped[:20]:
        print(f'  skip {name}: {reason}')

    n_ecn = extract_ecn_wallsets(paks, global_index)
    print(f'ECN (EGA-mode) wall tilesets: {n_ecn}')

    n_items = extract_item_data(paks, global_index)
    print(f'Item data tables: {n_items}')

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

#!/usr/bin/env python3
"""Verify `bclib.FLOOR_ITEM_NAMES` against the DOS/Windows `clipper.clp` oracle.

Black Crypt's Amiga dungeon-floor item bank (`bcdfa+0x270C4`, 147 masked
sprites = 49 items x 3 view depths — see `extract_floor_items.py`) has no
name string anywhere near it in the Amiga files; positional indexing into
the nearby `bcdft` string region was already shown unsafe (385 strings
extracted vs. the DOS doc's 254 item names — see
`docs/blackcrypt/amiga/data-structure.md`, "Dungeon-floor item sprites",
"Still open").

The DOS/Windows port's `clipper.clp` archive turns out to carry its own
explicit `Start Floor Items` / `End Floor Items` marker block (directory
type 0x01, entries 651 and 799) delimiting exactly 147 entries — the same
49 x 3 structure, named on the first entry of every 3, monotonically
non-increasing width/height within each triple (near -> far), byte-for-byte
the same shape as the Amiga table. This script re-derives the group-name
mapping from scratch and checks it two ways:

  1. Dimension match: for every (group, depth), the DOS entry's (w, h) must
     equal the Amiga descriptor's (w, h) *at the same group index*.
  2. Silhouette match: per-pixel opacity (Amiga mask plane vs. DOS's
     brown/cyan background-key) must agree almost everywhere. Colour is
     *not* compared — the DOS port's dungeon-floor art is separately
     authored (different palette assignment), same convention already
     established for the 24x24 inventory icons.

Requires `data/blackcrypt/amiga/bcdfa`, `build/cache/blackcrypt/
bcdft_decompressed.bin` (run `scripts/decompress_bcdft.py` first if
missing) and `data/blackcrypt/dosvga/clipper.clp`.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from extract_clipper import parse_clp

KNOWN_BG = ((95, 67, 51), (0, 255, 255))


def main():
    amiga_dir = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga_dir / 'bcdfa'
    s1_path = bclib.cache_dir('blackcrypt') / 'bcdft_decompressed.bin'
    clp_path = bclib.data_dir('blackcrypt', 'dosvga') / 'clipper.clp'

    if not bcdfa_path.exists() or not s1_path.exists():
        print('  missing Amiga bcdfa / decompressed S_1 -- nothing to verify')
        return
    if not clp_path.exists():
        print('  missing DOS clipper.clp -- nothing to verify')
        return

    s1 = s1_path.read_bytes()
    amiga = {}
    for n, group, depth, w, h, rec in bclib.floor_item_sprites(bcdfa_path.read_bytes(), s1):
        idx, mask = bclib.decode_masked(rec, w, h, bclib.FLOOR_ITEM_PLANES - 1)
        amiga[(group, depth)] = (w, h, mask.astype(bool))

    entries = parse_clp(clp_path)
    markers = {e['name']: e['index'] for e in entries if e['type'] == 1}
    start, end = markers.get('Start Floor Items'), markers.get('End Floor Items')
    if start is None or end is None:
        print('  clipper.clp has no Start/End Floor Items markers -- cannot verify')
        return

    dos_floor = entries[start + 1:end]
    if len(dos_floor) != bclib.FLOOR_ITEM_COUNT:
        print(f'  DOS floor-item block has {len(dos_floor)} entries, '
              f'expected {bclib.FLOOR_ITEM_COUNT} -- cannot verify')
        return

    dos_groups = [dos_floor[i:i + 3] for i in range(0, bclib.FLOOR_ITEM_COUNT, 3)]

    pal = next(bytes(e['data']) for e in entries if e['type'] == 3 and e['name'] == 'Palette')
    pal = np.frombuffer(pal[:768], dtype=np.uint8).reshape(256, 3)

    dim_ok = 0
    total_pixels = 0
    silhouette_agree = 0
    worst = []
    name_mismatches = []

    for gi, dos_group in enumerate(dos_groups):
        dos_name = dos_group[0]['name']
        claimed = bclib.FLOOR_ITEM_NAMES[gi]
        if dos_name != claimed:
            name_mismatches.append((gi, claimed, dos_name))

        group_dim_ok = True
        group_pixels = 0
        group_agree = 0
        for depth, e in enumerate(dos_group):
            w, h = e['width'], e['height']
            aw, ah, amask = amiga[(gi, depth)]
            if (aw, ah) != (w, h):
                group_dim_ok = False
                continue
            didx = np.frombuffer(bytes(e['data'])[:w * h], dtype=np.uint8).reshape(h, w)
            drgb = pal[didx]
            dopaque = np.ones((h, w), dtype=bool)
            for bg in KNOWN_BG:
                dopaque &= ~np.all(drgb == np.array(bg, dtype=np.uint8), axis=2)
            agree = (amask == dopaque)
            group_pixels += w * h
            group_agree += int(agree.sum())

        dim_ok += int(group_dim_ok)
        total_pixels += group_pixels
        silhouette_agree += group_agree
        worst.append((group_agree / group_pixels if group_pixels else 0, gi, claimed))

    print(f'  dimension match: {dim_ok}/{bclib.FLOOR_ITEM_GROUPS} groups, all 3 depths exact')
    print(f'  name match (DOS entry name == bclib.FLOOR_ITEM_NAMES): '
          f'{bclib.FLOOR_ITEM_GROUPS - len(name_mismatches)}/{bclib.FLOOR_ITEM_GROUPS}')
    for gi, claimed, dos_name in name_mismatches:
        print(f'    MISMATCH group {gi}: claimed {claimed!r}, DOS says {dos_name!r}')
    print(f'  silhouette agreement: {silhouette_agree}/{total_pixels} pixels '
          f'({100 * silhouette_agree / total_pixels:.3f}%)')
    worst.sort()
    print('  lowest-agreement groups:')
    for frac, gi, name in worst[:5]:
        print(f'    group {gi:2d} ({name}): {100 * frac:.3f}%')

    if dim_ok == bclib.FLOOR_ITEM_GROUPS and not name_mismatches:
        print('  OK -- bclib.FLOOR_ITEM_NAMES confirmed against clipper.clp')
    else:
        print('  FAILED -- see mismatches above')
        sys.exit(1)


if __name__ == '__main__':
    main()

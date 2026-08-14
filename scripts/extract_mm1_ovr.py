#!/usr/bin/env python3
"""
Extract the MM1 `.OVR` map-script overlays to `public/assets/mm1/dosega/`.

Usage: python3 scripts/extract_mm1_ovr.py [dataDir]

Each of the 55 MAZEDATA screens has a companion `*.OVR` overlay (compiled
8086 code + data segment with the map's selection tables and text
strings — see `scripts/mm1lib/ovr.py` for the container spec).

Outputs:
  data/ovr.json — per-overlay summary: header fields, WALLPIX area table
                  + lane ids (resolved to entry indices), event triples,
                  string count
  data/ovr-text.json — every map's text strings (the game's actual
                  dialogue/description text per screen)

The code-segment semantics (map script behaviour) is open work — see
docs/mm1/dosega/data-structure.md.
"""
from __future__ import annotations

import glob
import json
import os
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from mm1lib.ovr import read_ovr  # noqa: E402
from mm1lib.wallpix import TILE_AREAS, TILE_OFFSET  # noqa: E402
from bclib.paths import write_manifest, write_platform_index  # noqa: E402

# MAZEDATA slug order (from tools/mm1/map.ts MM1_MAP_SLUGS)
SLUGS = ['sorpigal', 'portsmit', 'algary', 'dusk', 'erliquin',
         'cave1', 'cave2', 'cave3', 'cave4', 'cave5', 'cave6', 'cave7', 'cave8', 'cave9',
         'areaa1', 'areaa2', 'areaa3', 'areaa4',
         'areab1', 'areab2', 'areab3', 'areab4',
         'areac1', 'areac2', 'areac3', 'areac4',
         'aread1', 'aread2', 'aread3', 'aread4',
         'areae1', 'areae2', 'areae3', 'areae4',
         'doom', 'blackrn', 'blackrs', 'qvl1', 'qvl2', 'rwl1', 'rwl2', 'enf1', 'enf2',
         'whitew', 'dragad', 'udrag1', 'udrag2', 'udrag3', 'demon', 'alamar',
         'pp1', 'pp2', 'pp3', 'pp4', 'astral']


def wallpix_entry(area_table: int, lane_id: int) -> int | None:
    """Resolve a lane id to a WALLPIX entry index (maps.cpp loadTile)."""
    if not (1 <= area_table <= 3):
        return None
    arr = TILE_AREAS[area_table - 1]
    ctr = TILE_OFFSET[area_table - 1]
    for v in arr:
        if v == lane_id:
            if ctr >= 19:
                # maps.cpp: ctr==19 -> reused entry 0 (ctr>19 sets a distinct
                # _loadFlag in the original but still resolves to entry 0)
                return 0
            return ctr - 1
        ctr += 1
    return None


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'mm1' / 'dosega'
    out = REPO / 'public' / 'assets' / 'mm1' / 'dosega'
    (out / 'data').mkdir(parents=True, exist_ok=True)

    files = sorted(glob.glob(str(data_dir / '*.OVR')))
    if len(files) != 55:
        print(f"  WARNING: expected 55 OVR files, found {len(files)}")

    # map slug (lowercase) -> file
    by_slug = {}
    for f in files:
        stem = os.path.basename(f).replace('.OVR', '').lower()
        by_slug[stem] = f

    summaries = []
    text_rows = []
    size_ok = 0
    for slug in SLUGS:
        f = by_slug.get(slug)
        if not f:
            continue
        ovr = read_ovr(f, slug)
        if ovr.check_size():
            size_ok += 1
        wf = ovr.wall_fields()
        summaries.append({
            'slug': slug,
            'size': len(ovr.data),
            'codeSize': ovr.code_sz,
            'dataSize': ovr.data_sz,
            'entryOffset': ovr.entry_off,
            'loadSeg': ovr.load_seg,
            'mapType': wf['mapType'],
            'areaTable': wf['areaTable'],
            'lanes': [wf['lane1'], wf['lane2'], wf['lane3']],
            'wallEntries': [wallpix_entry(wf['areaTable'], wf[f'lane{i}']) for i in (1, 2, 3)],
            'eventTriples': ovr.event_triples(),
            'stringRegionStart': ovr.string_region_start,
            'strings': len(ovr.strings()),
        })
        text_rows.append({'slug': slug, 'strings': ovr.strings()})

    (out / 'data' / 'ovr.json').write_text(json.dumps({
        'file': '*.OVR (55 overlays)',
        'note': 'Map-script overlays: 14-byte header + compiled 8086 code + data segment '
                '(tables + text). See docs/mm1/dosega/data-structure.md.',
        'overlays': summaries,
    }, indent=2))
    (out / 'data' / 'ovr-text.json').write_text(json.dumps({
        'screens': text_rows,
    }, indent=2))

    print(f"  OVR: {len(summaries)} overlays, size invariant 55/{size_ok}, "
          f"{sum(t['strings'] for t in summaries)} strings extracted")
    write_manifest([
        {'name': 'data/ovr', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/ovr.json'},
        {'name': 'data/ovr-text', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/ovr-text.json'},
    ], 'mm1', 'dosega')
    write_platform_index([{'game': 'mm1', 'platform': 'dosega'}])
    print('  manifest + platform index updated')


if __name__ == '__main__':
    main()

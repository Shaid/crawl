#!/usr/bin/env python3
"""
Extract MM1 (DOS) `WALLPIX.DTA` (17 wall sets) and `MONPIX.DTA` (75 monster
portraits) to `public/assets/mm1/dosega/`.

Usage: python3 scripts/extract_mm1_gfx.py [dataDir]

`dataDir` defaults to `data/mm1/dosega` (GOG DOS install). The decoders are
direct ports of ScummVM's `engines/mm/mm1` loaders (see `scripts/mm1lib/dta.py`
and `docs/mm1/dosega/data-structure.md` for the format spec and the
verification evidence).

Outputs:
  textures/wallpix.png + .json  — shelf-packed atlas of all 204 frustum slices
                                  (17 entries x 12), frames wallNN_<role><d>
  data/wallpix.json             — per-entry colours, biome labels, slice rects
  sprites/monpix.png + .json    — 75 monster portraits (104x96) grid atlas,
                                  named by img number + ScummVM monster names
  data/monpix.json              — per-image palettes + all monster names
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from PIL import Image  # noqa: E402

from mm1lib.dta import EGA_RGB  # noqa: E402
from mm1lib.wallpix import SLICE_ROLES, decode_monpix, decode_wallpix  # noqa: E402
from bclib.paths import write_manifest, write_platform_index  # noqa: E402

ATLAS_MAX_W = 1024


def parse_monster_names(path: Path) -> dict[int, list[str]]:
    """ScummVM `monsters.txt`: name + 16 comma fields, the last is `_imgNum`."""
    img_to_names: dict[int, list[str]] = {}
    for line in path.read_text(errors='replace').splitlines():
        m = re.match(r'"([^"]*)"\s*,(.*)', line)
        if not m:
            continue
        name = m.group(1).rstrip()
        vals = [int(v.strip()) for v in m.group(2).split(',')]
        if not vals:
            continue
        img_to_names.setdefault(vals[-1], []).append(name)
    return img_to_names


def shelf_pack(items, max_w: int) -> None:
    """Greedy shelf-pack `items` (each has w/h, gets x/y) in place; height-first."""
    rows: list[dict] = []
    y = 0
    for it in sorted(items, key=lambda t: -t['h']):
        placed = next((r for r in rows if r['h'] >= it['h'] and r['x'] + it['w'] <= max_w), None)
        if placed is None:
            placed = {'x': 0, 'y': y, 'h': it['h']}
            rows.append(placed)
            y += it['h']
        it['x'], it['y'] = placed['x'], placed['y']
        placed['x'] += it['w']
    return y


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'mm1' / 'dosega'
    out = REPO / 'public' / 'assets' / 'mm1' / 'dosega'
    (out / 'textures').mkdir(parents=True, exist_ok=True)
    (out / 'sprites').mkdir(parents=True, exist_ok=True)
    (out / 'data').mkdir(parents=True, exist_ok=True)

    # ---------- WALLPIX: 17 entries x 12 frustum slices ----------
    wall = decode_wallpix(data_dir / 'WALLPIX.DTA')
    slices = [
        {'entry': e['entry'], 'i': i, 'w': s['w'], 'h': s['h'], 'pixels': s['pixels']}
        for e in wall['entries'] for i, s in enumerate(e['slices'])
    ]
    n_slices = len(slices)
    total_px = sum(s['w'] * s['h'] for s in slices)
    atlas_h = shelf_pack(slices, ATLAS_MAX_W)
    atlas = Image.new('RGB', (ATLAS_MAX_W, atlas_h), (0, 0, 0))
    frames: list[dict] = []
    for s in slices:
        img = Image.new('RGB', (s['w'], s['h']))
        img.putdata([EGA_RGB[v] for v in s['pixels']])
        atlas.paste(img, (s['x'], s['y']))
        frames.append({
            'name': f"wall{s['entry']:02d}_{SLICE_ROLES[s['i']]}{s['i'] % 4}",
            'x': s['x'], 'y': s['y'], 'w': s['w'], 'h': s['h'],
        })
    atlas.save(out / 'textures' / 'wallpix.png')
    (out / 'textures' / 'wallpix.json').write_text(
        json.dumps({'frames': frames, 'width': ATLAS_MAX_W, 'height': atlas_h}))

    (out / 'data' / 'wallpix.json').write_text(json.dumps({
        'file': 'WALLPIX.DTA',
        'entries': [{
            'entry': e['entry'],
            'colors': e['colors'],
            'indexes': e['indexes'],
            'biome': e['biome'],
            'slices': [{'w': s['w'], 'h': s['h']} for s in e['slices']],
        } for e in wall['entries']],
    }, indent=2))
    print(f"  WALLPIX: {len(wall['entries'])} entries, {n_slices} slices, "
          f"{total_px} px decoded, atlas {ATLAS_MAX_W}x{atlas_h}")

    # ---------- MONPIX: 75 monster portraits at 104x96 ----------
    mon = decode_monpix(data_dir / 'MONPIX.DTA')
    names = parse_monster_names(REPO / 'scripts' / 'mm1lib' / 'mm1_monsters.txt')
    mw, mh = mon['width'], mon['height']
    mcols = 10
    mrows = (len(mon['images']) + mcols - 1) // mcols
    matlas = Image.new('RGB', (mcols * mw, mrows * mh), (0, 0, 0))
    mframes: list[dict] = []
    for mi, img in enumerate(mon['images']):
        im = Image.new('RGB', (mw, mh))
        im.putdata([EGA_RGB[v] for v in img['pixels']])
        x, y = (mi % mcols) * mw, (mi // mcols) * mh
        matlas.paste(im, (x, y))
        nm = names.get(mi, ['unused'])[0]
        mframes.append({'name': f'img{mi:02d}-{nm}', 'x': x, 'y': y, 'w': mw, 'h': mh})
    matlas.save(out / 'sprites' / 'monpix.png')
    (out / 'sprites' / 'monpix.json').write_text(
        json.dumps({'frames': mframes, 'width': mcols * mw, 'height': mrows * mh}))

    (out / 'data' / 'monpix.json').write_text(json.dumps({
        'file': 'MONPIX.DTA',
        'width': mw,
        'height': mh,
        'images': [{
            'img': im['img'],
            'palette': im['palette'],
            'indexes': im['indexes'],
            'names': names.get(im['img'], []),
        } for im in mon['images']],
    }, indent=2))
    print(f"  MONPIX: {len(mon['images'])} portraits, atlas {mcols * mw}x{mrows * mh}, "
          f"0-remainder on all entries")

    # ---------- manifest ----------
    write_manifest([
        {'name': 'textures/wallpix', 'sprites': n_slices, 'hasPalette': False, 'png': 'textures/wallpix.png'},
        {'name': 'sprites/monpix', 'sprites': len(mon['images']), 'hasPalette': False, 'png': 'sprites/monpix.png'},
    ], 'mm1', 'dosega')
    write_platform_index([{'game': 'mm1', 'platform': 'dosega'}])
    print('  manifest + platform index updated')


if __name__ == '__main__':
    main()

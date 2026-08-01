#!/usr/bin/env python3
"""Render Black Crypt's Amiga BCSPEED.EFF particle effects, frame-accurately.

`extract_bcdfa_eff.py` exports the raw effect *scripts* (95 effects, groups
of spawn records). This script runs the confirmed particle simulation
(`bclib.bcdfa.simulate_effect` — all 18 PRG tag-byte jump-table handlers,
frame-count bound checks and the viewport kill test) and composites each
simulated tick onto a 208x140 canvas using the already-extracted
`sprites/bcspeed.*` atlas, producing a genuine per-tick animation instead of
only plotting each tick's spawn positions.

Where the previous (uncommitted) probe render only showed each group's own
freshly-spawned particles — sparse for any effect whose visual body comes
from particles travelling after they spawn — this shows every *currently
alive* particle each tick, at the position/frame the simulation gives it,
including ones spawned by an earlier group and still travelling.

Output:
    public/assets/blackcrypt/amiga/data/bcspeed-effects-simulated.json
        (web-native asset) per-effect, per-tick particle lists
        ({gfkRecord, gfkFrame, x, y}) — a browser engine can play these back
        directly with no re-simulation, or use them as a reference to
        validate its own real-time simulation against.
    build/cache/blackcrypt/bcspeed_eff_render/effect<NN>.png
        (verification renders, not a web asset) one contact sheet per
        effect: every simulated tick, up to 10 columns, upscaled 2x.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

import bclib

VIEWPORT_W = bclib.EFF_VIEWPORT_WIDTH
VIEWPORT_H = bclib.EFF_VIEWPORT_HEIGHT
CANVAS_BG = (24, 24, 32, 255)


def load_gfk_atlas():
    import json
    sprites_dir = bclib.asset_dir('sprites')
    atlas = Image.open(sprites_dir / 'bcspeed.png').convert('RGBA')
    frames = {f['name']: f for f in json.loads((sprites_dir / 'bcspeed.json').read_text())['frames']}
    return atlas, frames


def sprite_crop(atlas, frames, gfk_record, gfk_frame):
    f = frames[f'gfk{gfk_record:02d}_f{gfk_frame}']
    return atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    if not bcdfa_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return

    sprites_dir = bclib.asset_dir('sprites')
    if not (sprites_dir / 'bcspeed.png').exists():
        print(f'No {sprites_dir / "bcspeed.png"} — run scripts/render_all.py first')
        return

    raw = bcdfa_path.read_bytes()
    atlas, frames = load_gfk_atlas()

    prg_by_index = {n: recs for n, count, recs in bclib.prg_records(raw)}
    frame_counts = bclib.gfk_frame_counts(raw)

    # Contact sheets are verification renders, not a web asset -- see the
    # project convention that non-web intermediates go to build/cache.
    out_dir = bclib.cache_dir('blackcrypt') / 'bcspeed_eff_render'
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    total_ticks = 0
    for i, offset, last_group_index, frame_delay, groups in bclib.eff_scripts(raw):
        ticks = list(bclib.simulate_effect(groups, last_group_index, prg_by_index, frame_counts))
        total_ticks += len(ticks)
        manifest.append({
            'index': i,
            'bankOffset': offset,
            'groupCount': last_group_index + 1,
            'frameDelay': frame_delay,
            'tickCount': len(ticks),
            'ticks': [
                [{'gfkRecord': p['gfkRecord'], 'gfkFrame': p['gfkFrame'],
                  'x': p['x'], 'y': p['y']} for p in tick]
                for tick in ticks
            ],
        })

        if not ticks:
            continue
        cols = min(10, len(ticks))
        rows = (len(ticks) + cols - 1) // cols
        sheet = Image.new('RGBA', (cols * VIEWPORT_W, rows * VIEWPORT_H), CANVAS_BG)
        for t, tick in enumerate(ticks):
            canvas = Image.new('RGBA', (VIEWPORT_W, VIEWPORT_H), CANVAS_BG)
            for p in tick:
                canvas.alpha_composite(
                    sprite_crop(atlas, frames, p['gfkRecord'], p['gfkFrame']),
                    (p['x'], p['y']))
            x = (t % cols) * VIEWPORT_W
            y = (t // cols) * VIEWPORT_H
            sheet.paste(canvas, (x, y))
        sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
        sheet.convert('RGB').save(out_dir / f'effect{i:02d}.png')

    bclib.write_json(bclib.asset_dir('data') / 'bcspeed-effects-simulated.json', {
        'source': 'bcdfa container-directory entries 3/6/7 (GFK/EFF/PRG), simulated',
        'viewport': {'width': VIEWPORT_W, 'height': VIEWPORT_H},
        'note': ('One entry per effect; `ticks[n]` is every particle visible '
                 'on simulated tick n, already stepped through its own PRG '
                 'movement script (bclib.bcdfa.simulate_effect). x/y are the '
                 'sprite\'s top-left in the 208x140 viewport, gfkRecord/'
                 'gfkFrame index sprites/bcspeed.*.'),
        'effects': manifest,
    }, pretty=True)

    print(f'  {out_dir}/effect*.png: {len(manifest)} effects, {total_ticks} ticks simulated')
    print(f'  data/bcspeed-effects-simulated.json: {len(manifest)} effects')


if __name__ == '__main__':
    main()

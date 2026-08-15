#!/usr/bin/env python3
"""Verify the MM3 indoor 3-D view table (`scripts/mm3lib/mm3_indoor_view.json`)
against real `MM3.CUR` maze data and the real extracted wall sprites.

Run from the repo root:  python3 scripts/verify_mm3_indoor_view.py

This checks the *frozen* table's real-world behavior (every frame it asks
for exists in the real sprite files; no facing/maze produces a crash), not
the table's derivation from the game binary — that one-time disassembly
verification (497,664 cases against a live-disassembly reference, 0
mismatches) isn't reproducible here without `capstone` and the
reconstructed exe, and isn't re-run on every build; see
`scripts/mm3lib/dos_indoor_view.py`'s module doc.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_indoor_view import build_wall_list  # noqa: E402
from mm3lib.dos_maze import load_mazes  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
CUR = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.CUR')
SPRITES = os.path.join(REPO, 'public', 'assets', 'mm3', 'dosvga', 'sprites', 'walls')

MASK2DIR = {0x7000: 'north', 0x0700: 'east', 0x0070: 'south', 0x0007: 'west'}
FACING_NSEW_TO_INDOOR = {0: 0, 1: 2, 2: 1, 3: 3}  # dos_maze N,E,S,W -> indoor-view N,S,E,W


def frame_count(series: str, sprite: str) -> int | None:
    path = os.path.join(SPRITES, f'{series}{sprite}.vga.json')
    if not os.path.exists(path):
        return None
    return json.load(open(path))['frameCount']


def main() -> None:
    mazes = load_mazes(CUR)
    indoor = {i: m for i, m in mazes.items() if not m.is_outdoor()}

    from mm3lib.dos_maze import resolve_graphics
    graphics = resolve_graphics(mazes)

    total = 0
    out_of_range = 0
    missing_sheet = 0
    frame_counts = {}

    for maze_id, m in indoor.items():
        series = graphics[maze_id]['wallSeries']
        for px in range(16):
            for py in range(16):
                def get_wall(dx: int, dy: int, mask: int, m=m) -> int:
                    x, y = px + dx, py + dy
                    if not (0 <= x < 16 and 0 <= y < 16):
                        return 1
                    idx, _ = m.wall(x, y, MASK2DIR[mask])
                    return idx

                for facing_nesw in range(4):
                    facing = FACING_NSEW_TO_INDOOR[facing_nesw]
                    for alt in (0, 1):
                        dl = build_wall_list(get_wall, facing, alt, 0)
                        total += 1
                        for sprite, frame, x, y, flags in dl:
                            key = (series, sprite)
                            if key not in frame_counts:
                                frame_counts[key] = frame_count(series, sprite)
                            fc = frame_counts[key]
                            if fc is None:
                                missing_sheet += 1
                            elif not (0 <= frame < fc):
                                out_of_range += 1

    print(f'views checked: {total}')
    print(f'sprite/frame pairs referenced: {len(frame_counts)}')
    print(f'missing sheets: {missing_sheet}')
    print(f'out-of-range frame refs: {out_of_range}')
    print('PASS' if missing_sheet == 0 and out_of_range == 0 else 'FAIL')


if __name__ == '__main__':
    main()

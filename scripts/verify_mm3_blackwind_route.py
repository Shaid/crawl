#!/usr/bin/env python3
"""Ground-truth check for the MM3 wall-layout decode against a shipped map.

Run from the repo root:  python3 scripts/verify_mm3_blackwind_route.py

`data/mm3/amiga/Docs/mm3-map-castleblackwind.gif` is a human-drawn route
map that ships with the Amiga release: a 16x16 grid of arrow glyphs, each
saying which way to step from that cell to walk the Blackwind Dungeon. Its
axis labels put x = 0..15 left-to-right and y = 0..15 **bottom-to-top**.

This script segments the arrows out of the GIF, converts each to a
(x, y, direction) move, and asks the decoded maze records whether that move
crosses a blocking wall. A correct decode makes almost every move legal in
exactly one maze; a wrong grid orientation, nibble order or blocking-bit
choice scatters the score across the corpus.

Result on retail data: `maze33` (whose `text33.maz` reads "A ladder up to
Castle Blackwind. Leave this deserted dungeon?") scores 108/109 -- the one
"failure" is the arrow that steps off the south edge, i.e. the exit --
against a corpus mean of ~31%.

Needs Pillow + numpy (already used by other scripts/ renderers).
"""
from __future__ import annotations

import collections
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_maze import load_mazes  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
GIF = os.path.join(REPO, 'data', 'mm3', 'amiga', 'Docs', 'mm3-map-castleblackwind.gif')
CUR = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.CUR')

# grid geometry measured from the arrow centroids in the shipped GIF
ORIGIN_X, STEP_X = 18, 17
ORIGIN_Y, STEP_Y = 30, 14
ARROW_PIXELS = (30, 31)          # every arrow glyph is 30 or 31 dark pixels


def components(dark: np.ndarray) -> list[list[tuple[int, int]]]:
    h, w = dark.shape
    seen = np.zeros_like(dark)
    out = []
    for y in range(h):
        for x in range(w):
            if dark[y, x] and not seen[y, x]:
                q = deque([(y, x)])
                seen[y, x] = True
                pts = []
                while q:
                    cy, cx = q.popleft()
                    pts.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                out.append(pts)
    return out


def glyph_direction(pts: list[tuple[int, int]]) -> str:
    """Arrow tip is the 1-px end; the tail is the wide end."""
    y0 = min(p[0] for p in pts)
    x0 = min(p[1] for p in pts)
    norm = {(p[0] - y0, p[1] - x0) for p in pts}
    hh = max(y for y, _ in norm) + 1
    ww = max(x for _, x in norm) + 1
    if hh > ww:   # vertical arrow; screen y is inverted vs. game y
        top = sum(1 for y, _ in norm if y == 0)
        bot = sum(1 for y, _ in norm if y == hh - 1)
        return 'north' if top < bot else 'south'
    left = sum(1 for _, x in norm if x == 0)
    right = sum(1 for _, x in norm if x == ww - 1)
    return 'west' if left < right else 'east'


def main() -> int:
    a = np.asarray(Image.open(GIF).convert('L'))
    arrows = [p for p in components(a < 128) if len(p) in ARROW_PIXELS]
    moves = []
    for p in arrows:
        ys = [q[0] for q in p]
        xs = [q[1] for q in p]
        gx = round(((min(xs) + max(xs)) / 2 - ORIGIN_X) / STEP_X)
        gy = 15 - round(((min(ys) + max(ys)) / 2 - ORIGIN_Y) / STEP_Y)
        moves.append((gx, gy, glyph_direction(p)))
    print(f'arrows found: {len(moves)}  {dict(collections.Counter(d for _, _, d in moves))}')
    if not moves:
        print('no arrows segmented — check the GIF')
        return 1

    mazes = load_mazes(CUR)
    scored = []
    for i, m in mazes.items():
        if m.is_outdoor():
            continue
        ok = sum(1 for (x, y, d) in moves
                 if 0 <= x < 16 and 0 <= y < 16 and not m.blocked(x, y, d))
        scored.append((ok, i))
    scored.sort(reverse=True)
    mean = sum(s for s, _ in scored) / len(scored) / len(moves)
    print(f'corpus mean legal-move rate: {mean:.3f} over {len(scored)} indoor mazes')
    for ok, i in scored[:4]:
        print(f'  maze{i:<3d} {ok}/{len(moves)} = {ok / len(moves):.4f}')
    top_ok = scored[0][0]
    tied = [i for s, i in scored if s == top_ok]
    for i in tied:
        blocked = [(x, y, d) for (x, y, d) in moves if mazes[i].blocked(x, y, d)]
        print(f'best: maze{i} {top_ok}/{len(moves)} — blocked moves: {blocked}')
    if len(tied) > 1:
        print(f'  (tie between {tied}; `text33.maz` names maze33 — "A ladder up to '
              f'Castle Blackwind. Leave this deserted dungeon?")')
    ok = top_ok >= len(moves) - 1 and mean < 0.5
    print('PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())

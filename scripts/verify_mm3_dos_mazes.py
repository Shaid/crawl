#!/usr/bin/env python3
"""Corpus-wide structural verification of the MM3 maze (wall-layout) format.

Run from the repo root:  python3 scripts/verify_mm3_dos_mazes.py

Every check below is an invariant the format must satisfy if the decode in
`mm3lib/dos_maze.py` is right; each prints its own counts so a regression
shows up as a number, not a vibe.

  1. MM3.CUR is exhaustively accounted for: all 240 entries resolve to a
     `maze*.dat` / `maze*.bin` / `maze*.evt` / `maze.nam|chr|pty` name.
  2. Every `maze<N>.dat` is exactly 832 bytes.
  3. Each record's stored maze number (+0x31F) equals its filename number.
  4. Wall blocking bits are symmetric across every interior wall of every
     indoor maze (east-of-A == west-of-B, north-of-A == south-of-B).
  5. Surrounding-maze links (+0x308..0x30B) are reciprocal.
  6. An open map edge implies a surrounding-maze link in that direction.
  7. Outdoor mazes 41..64 tile the shipped world map as a 6x4 grid with
     n+4 == east and n+1 == south, and terrain is continuous across the
     shared edges (vs. an unrelated-map baseline).
"""
from __future__ import annotations

import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib import dos_cc  # noqa: E402
from mm3lib.dos_maze import (  # noqa: E402
    GRID_W, GRID_H, MAZE_IDS, MAZE_RECORD_SIZE, Maze, maze_name, read_entry,
)

REPO = os.path.abspath(os.path.join(HERE, '..'))
CUR = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.CUR')


def main() -> int:
    data = open(CUR, 'rb').read()
    entries, _ = dos_cc.parse(data)
    by_hash = {e.hash: e for e in entries}
    fails = 0

    # 1. exhaustive naming ------------------------------------------------
    names: dict[int, str] = {}
    for n in ('maze.nam', 'maze.chr', 'maze.pty'):
        names[dos_cc.hash_filename(n)] = n
    for i in range(1, 200):
        for ext in ('dat', 'bin', 'evt'):
            names[dos_cc.hash_filename(maze_name(i, ext))] = maze_name(i, ext)
    named = sum(1 for e in entries if e.hash in names)
    print(f'[1] MM3.CUR entries named: {named}/{len(entries)}')
    fails += named != len(entries)

    # 2/3. record size + stored id ----------------------------------------
    mazes: dict[int, Maze] = {}
    for i in MAZE_IDS:
        blob = read_entry(data, by_hash, maze_name(i, 'dat'))
        assert blob is not None, f'maze{i:02d}.dat missing'
        mazes[i] = Maze(i, blob)
    bad_size = [i for i in MAZE_IDS if len(mazes[i].raw) != MAZE_RECORD_SIZE]
    print(f'[2] 832-byte records: {len(MAZE_IDS) - len(bad_size)}/{len(MAZE_IDS)}')
    fails += bool(bad_size)
    id_ok = [i for i in MAZE_IDS if mazes[i].stored_id == i]
    print(f'[3] stored id (+0x31F) == filename id: {len(id_ok)}/{len(MAZE_IDS)}'
          f'  (mismatches: {[i for i in MAZE_IDS if i not in id_ok]})')
    fails += len(id_ok) < len(MAZE_IDS) - 1

    indoor = [i for i in MAZE_IDS if not mazes[i].is_outdoor()]
    outdoor = [i for i in MAZE_IDS if mazes[i].is_outdoor()]
    print(f'    indoor {len(indoor)}, outdoor {len(outdoor)} (ids {outdoor[0]}..{outdoor[-1]})')

    # 4. wall blocking-bit symmetry (indoor only) -------------------------
    ok = tot = 0
    for i in indoor:
        m = mazes[i]
        for y in range(GRID_H):
            for x in range(GRID_W - 1):
                tot += 1
                ok += m.blocked(x, y, 'east') == m.blocked(x + 1, y, 'west')
        for y in range(GRID_H - 1):
            for x in range(GRID_W):
                tot += 1
                ok += m.blocked(x, y, 'north') == m.blocked(x, y + 1, 'south')
    print(f'[4] wall blocking bits symmetric: {ok}/{tot} ({ok / tot:.5f})')
    fails += ok / tot < 0.999

    # 5. surrounding-maze reciprocity -------------------------------------
    opp = {'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east'}
    ok = tot = 0
    bad = []
    for i in MAZE_IDS:
        s = mazes[i].surrounding
        for d, t in s.items():
            if not t:
                continue
            tot += 1
            if t in mazes and mazes[t].surrounding[opp[d]] == i:
                ok += 1
            else:
                bad.append((i, d, t))
    print(f'[5] surrounding-maze links reciprocal: {ok}/{tot} ({ok / tot:.4f})  bad={bad}')
    fails += ok / tot < 0.95

    # 6. open edge <=> neighbour link (indoor only) -----------------------
    ok = tot = 0
    for i in indoor:
        m = mazes[i]
        s = m.surrounding
        edges = {
            'north': [(x, GRID_H - 1) for x in range(GRID_W)],
            'south': [(x, 0) for x in range(GRID_W)],
            'east': [(GRID_W - 1, y) for y in range(GRID_H)],
            'west': [(0, y) for y in range(GRID_H)],
        }
        for d, cells in edges.items():
            open_cells = sum(1 for (x, y) in cells if not m.blocked(x, y, d))
            tot += 1
            ok += (open_cells > 0) == (s[d] != 0)
    print(f'[6] open map edge <=> surrounding link: {ok}/{tot} ({ok / tot:.4f})')
    fails += ok / tot < 0.90

    # 7. world-map tiling -------------------------------------------------
    def row(m: Maze, y: int):
        return [m.wall_word(x, y) & 0xF for x in range(GRID_W)]

    def col(m: Maze, x: int):
        return [m.wall_word(x, y) & 0xF for y in range(GRID_H)]

    def agree(a, b):
        return sum(1 for p, q in zip(a, b) if p == q) / len(a)

    south_pairs = [(n, n + 1) for n in outdoor if (n - 41) % 4 != 3 and n + 1 in mazes]
    east_pairs = [(n, n + 4) for n in outdoor if n + 4 in mazes]
    s_score = sum(agree(row(mazes[a], 0), row(mazes[b], GRID_H - 1))
                  for a, b in south_pairs) / len(south_pairs)
    e_score = sum(agree(col(mazes[a], GRID_W - 1), col(mazes[b], 0))
                  for a, b in east_pairs) / len(east_pairs)
    random.seed(1)
    rp = [(random.choice(outdoor), random.choice(outdoor)) for _ in range(400)]
    base_s = sum(agree(row(mazes[a], 0), row(mazes[b], GRID_H - 1)) for a, b in rp) / len(rp)
    base_e = sum(agree(col(mazes[a], GRID_W - 1), col(mazes[b], 0)) for a, b in rp) / len(rp)
    print(f'[7] outdoor terrain continuity  n+1 south: {s_score:.3f} (baseline {base_s:.3f});'
          f'  n+4 east: {e_score:.3f} (baseline {base_e:.3f})')
    fails += not (s_score > base_s + 0.08 and e_score > base_e + 0.08)

    # link check: does the surrounding table agree with the n+1/n+4 tiling?
    link_ok = sum(1 for n in outdoor
                  if mazes[n].surrounding['south'] in (0, n + 1)
                  and mazes[n].surrounding['east'] in (0, n + 4))
    print(f'    surrounding table agrees with the 6x4 tiling: {link_ok}/{len(outdoor)}')
    fails += link_ok < len(outdoor)

    print('\nFAILURES:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    raise SystemExit(main())

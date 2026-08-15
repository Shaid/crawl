#!/usr/bin/env python3
"""Extract the MM3 maze (wall-layout) grids from `MM3.CUR`.

Run from the repo root:  python3 scripts/extract_mm3_dos_mazes.py

Format: see `scripts/mm3lib/dos_maze.py` and
docs/mm3/dosvga/data-structure.md. Structural verification lives in
`scripts/verify_mm3_dos_mazes.py`.

Output (public/assets/mm3/dosvga/):
  data/mazes.json         — all 105 maze records, decoded
  maps/maze<NN>.png       — indoor wall plot (16x16), one per indoor maze
  maps/world.png          — the 24 outdoor sections composited as the
                            96x64 world map (sections A1..F4 = mazes 41..64)
  maps/*.json             — atlas sidecars
  manifest.json           — merged (upsert by name)
"""
from __future__ import annotations

import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib import dos_cc  # noqa: E402
from mm3lib.dos_maze import (  # noqa: E402
    GRID_H, GRID_W, MAZE_IDS, Maze, maze_name, parse_events, read_entry,
    resolve_graphics,
)

REPO = os.path.abspath(os.path.join(HERE, '..'))
CUR = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.CUR')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'dosvga')

CELL = 14                       # px per maze cell in the wall plot
PAD = 1
BG = (16, 16, 22)
WALL = (232, 232, 240)          # blocking
DECOR = (86, 108, 150)          # non-blocking but non-zero graphic index
FLOOR = (34, 36, 46)

# world-map terrain swatches, indexed by the low nibble of the outdoor word
TERRAIN = [
    (26, 52, 108), (70, 150, 60), (150, 112, 58), (46, 132, 46), (238, 240, 250),
    (86, 120, 62), (206, 74, 30), (226, 206, 128), (120, 120, 128), (30, 96, 190),
    (196, 156, 196), (158, 200, 244), (146, 146, 152), (92, 72, 52), (250, 250, 250),
    (206, 60, 206),
]


def write_png(path: str, rgb: bytes, w: int, h: int) -> None:
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        c = tag + payload
        return struct.pack('>I', len(payload)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


class Canvas:
    def __init__(self, w: int, h: int, fill=BG):
        self.w, self.h = w, h
        self.buf = bytearray(bytes(fill) * (w * h))

    def rect(self, x0: int, y0: int, x1: int, y1: int, c) -> None:
        x0, x1 = max(0, x0), min(self.w, x1)
        n = x1 - x0
        if n <= 0:
            return
        row = bytes(c) * n
        for y in range(max(0, y0), min(self.h, y1)):
            o = (y * self.w + x0) * 3
            self.buf[o:o + n * 3] = row


def render_maze(m: Maze) -> tuple[bytes, int, int]:
    """Wall plot. y is flipped so north is up, matching the game's own maps."""
    w = GRID_W * CELL + PAD
    h = GRID_H * CELL + PAD
    cv = Canvas(w, h)
    for y in range(GRID_H):
        py = (GRID_H - 1 - y) * CELL
        for x in range(GRID_W):
            px = x * CELL
            solid = all(m.blocked(x, y, d) for d in ('north', 'east', 'south', 'west'))
            if not solid:
                cv.rect(px + PAD, py + PAD, px + CELL, py + CELL, FLOOR)
    for y in range(GRID_H):
        py = (GRID_H - 1 - y) * CELL
        for x in range(GRID_W):
            px = x * CELL
            for d, (x0, y0, x1, y1) in (
                ('north', (px, py, px + CELL + PAD, py + PAD)),
                ('south', (px, py + CELL, px + CELL + PAD, py + CELL + PAD)),
                ('west', (px, py, px + PAD, py + CELL + PAD)),
                ('east', (px + CELL, py, px + CELL + PAD, py + CELL + PAD)),
            ):
                idx, block = m.wall(x, y, d)
                if block:
                    cv.rect(x0, y0, x1, y1, WALL)
                elif idx:
                    cv.rect(x0, y0, x1, y1, DECOR)
    return bytes(cv.buf), w, h


def render_world(mazes: dict[int, Maze], scale: int = 6) -> tuple[bytes, int, int]:
    """The 24 outdoor sections as one 96x64 map: n+4 = east, n+1 = south."""
    w, h = 6 * GRID_W * scale, 4 * GRID_H * scale
    cv = Canvas(w, h)
    for col in range(6):
        for rw in range(4):
            m = mazes.get(41 + 4 * col + rw)
            if m is None:
                continue
            for y in range(GRID_H):
                for x in range(GRID_W):
                    c = TERRAIN[m.wall_word(x, y) & 0xF]
                    px = (col * GRID_W + x) * scale
                    py = (rw * GRID_H + (GRID_H - 1 - y)) * scale
                    cv.rect(px, py, px + scale, py + scale, c)
    return bytes(cv.buf), w, h


def merge_manifest(new_entries: list[dict]) -> None:
    path = os.path.join(OUT, 'manifest.json')
    by_name: dict[str, dict] = {}
    if os.path.exists(path):
        try:
            for e in json.load(open(path)):
                by_name[e['name']] = e
        except Exception:
            pass
    for e in new_entries:
        by_name[e['name']] = e
    os.makedirs(OUT, exist_ok=True)
    json.dump(sorted(by_name.values(), key=lambda e: e['name']), open(path, 'w'), indent=1)


def main() -> None:
    data = open(CUR, 'rb').read()
    entries, _ = dos_cc.parse(data)
    by_hash = {e.hash: e for e in entries}

    mazes: dict[int, Maze] = {}
    for i in MAZE_IDS:
        blob = read_entry(data, by_hash, maze_name(i, 'dat'))
        if blob is not None:
            mazes[i] = Maze(i, blob)

    graphics = resolve_graphics(mazes)

    records = []
    manifest: list[dict] = []
    for i, m in sorted(mazes.items()):
        ev_blob = read_entry(data, by_hash, maze_name(i, 'evt'))
        events, consumed = parse_events(ev_blob) if ev_blob else ([], 0)
        rec = {
            'id': i,
            'storedId': m.stored_id,
            'kind': 'outdoor' if m.is_outdoor() else 'indoor',
            'name': graphics[i]['areaName'],
            'graphics': graphics[i],
            'width': GRID_W, 'height': GRID_H,
            'walls': list(m.walls),
            'cells': list(m.cells),
            'graphicSets': list(m.graphic_sets),
            'surrounding': m.surrounding,
            'runPosition': {'x': m.run_position[0], 'y': m.run_position[1]},
            'canSave': m.can_save, 'canRest': m.can_rest, 'canDismiss': m.can_dismiss,
            'trailer': list(m.trailer),
            'events': events,
            'eventBytesConsumed': consumed,
            'eventBytesTotal': len(ev_blob) if ev_blob else 0,
        }
        if not m.is_outdoor():
            rgb, w, h = render_maze(m)
            name = f'maze{i:02d}'
            write_png(os.path.join(OUT, 'maps', f'{name}.png'), rgb, w, h)
            json.dump({'frames': [{'name': name, 'x': 0, 'y': 0, 'w': w, 'h': h}],
                       'width': w, 'height': h},
                      open(os.path.join(OUT, 'maps', f'{name}.json'), 'w'), indent=1)
            rec['png'] = f'maps/{name}.png'
            manifest.append({'name': f'maps/{name}', 'sprites': 1, 'hasPalette': False,
                             'png': f'maps/{name}.png', 'kind': 'atlas',
                             'atlas': f'maps/{name}.json'})
        records.append(rec)

    rgb, w, h = render_world(mazes)
    write_png(os.path.join(OUT, 'maps', 'world.png'), rgb, w, h)
    json.dump({'frames': [{'name': 'world', 'x': 0, 'y': 0, 'w': w, 'h': h}],
               'width': w, 'height': h},
              open(os.path.join(OUT, 'maps', 'world.json'), 'w'), indent=1)
    manifest.append({'name': 'maps/world', 'sprites': 1, 'hasPalette': False,
                     'png': 'maps/world.png', 'kind': 'atlas', 'atlas': 'maps/world.json'})

    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
    json.dump({'source': 'MM3.CUR', 'recordSize': 832, 'mazes': records},
              open(os.path.join(OUT, 'data', 'mazes.json'), 'w'))
    manifest.append({'name': 'data/mazes', 'sprites': 0, 'hasPalette': False, 'png': '',
                     'kind': 'data', 'data': 'data/mazes.json'})
    merge_manifest(manifest)
    print(f'mazes decoded: {len(records)} '
          f'(indoor {sum(1 for r in records if r["kind"] == "indoor")}, '
          f'outdoor {sum(1 for r in records if r["kind"] == "outdoor")}); '
          f'events: {sum(len(r["events"]) for r in records)}')


if __name__ == '__main__':
    main()

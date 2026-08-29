"""MM3 (DOS) outdoor 3-D view — which terrain sprite/frame draws at each of
the outdoor draw-list's fixed screen slots, for a given party position and
facing, on one of the 24 outdoor mazes (ids 41-64).

Confirmed by disassembling the game's own renderer (see
`docs/mm3/dosvga/data-structure.md` "Outdoor mazes are a different union
member" + "Indoor 3-D view" correction for full file-offset citations).
Outdoor mazes repurpose the same wall u16 indoor mazes use for per-side
walls: bits 0-2 = overlay/scenery sprite index (tall art, always exactly 3
frames), bits 4-6 = ground/surface sprite index (flat art, always exactly
25 frames), both indexing the maze trailer's 7 graphic-set slots the same
way indoor walls index their 7 wall-file slots. Two stages:

  1. `BuildOutdoorDrawList` (root exe file 0x1065A-0x1269B, segment
     124F:006A), dispatched when `mazeId` is 41-64: for each of 50 fixed
     screen slots (25 ground + 25 overlay), reads a per-slot `(dx, dy)`
     offset from the party's position (tables at file 0x12C8 dx / 0x1380
     dy, indexed `facing*0x2E + slot`, **facing order N, S, E, W** — same
     order and same tables the indoor view's `BuildWallFlags` uses), masks
     the sampled wall word (`0x70` ground / `0x7` overlay), and resolves
     the 3-bit index through the maze's own graphic-set table to a
     terrain sprite name + a frame (a literal, or one of a 2-entry
     alternator pair selected by `alt`) + a flags word (a literal, or the
     `alt` value itself for a mirror-toggling ground draw).
  2. The actual blit is `vga`+0x1D70 inside the `MM3.CC` `vga` display
     driver (same walker the indoor view uses) — `flags` bit 0 = mirror,
     bit 1 = clip to the 3-D view window, bits 8-9 = a **decimating
     shrink** (`vga`+0x1EDC, 4-entry bit-pattern table `PAT` below —
     16/16, 11/16, 7/16, 4/16 pixels kept on both rows and columns).

This module reimplements stage 1 purely from the frozen data table
`mm3_outdoor_view.json` (extracted once via live disassembly — see that
file's `_meta` field and `build/cache/mm3/outdoor-view/
extract_outdoor{,_table}.py` for the extraction; not re-derived at
build/runtime, matching `dos_indoor_view.py`'s convention). Verified:
49,152 simulated views / 897,106 draws / 0 out-of-range frame refs / 0
missing sprites (see TODO `mm3-maze-outdoor-layers`); real per-facing
renders (forest, road, shoreline, ocean, lava, snow) all coherent; a
real-art top-down world map reproduces `World Map.jpg`.

Ocean note: ground index 0 means "no ground sprite drawn" — the fixed
`water.vga` backdrop (216x73 at screen (8,67)) shows through underneath
everything, so `build_outdoor_draw_list` always emits `water.vga` and a
`day`/`night.vga` sky as its first two entries before the 50 terrain
records (matching `BuildOutdoorDrawList`'s own draw order).
"""
from __future__ import annotations

import json
import os
from typing import Callable

_HERE = os.path.dirname(os.path.abspath(__file__))
_TABLE_PATH = os.path.join(_HERE, 'mm3_outdoor_view.json')

with open(_TABLE_PATH) as _f:
    _TABLE = json.load(_f)

TERRAIN: list[str | None] = _TABLE['terrain']
PAT: list[int] = _TABLE['pat']
CLIP: dict[str, int] = _TABLE['clip']
DXT: list[list[int]] = _TABLE['dxt']
DYT: list[list[int]] = _TABLE['dyt']
RECORDS: list[dict] = _TABLE['records']

GetWallWord = Callable[[int, int], int]
"""`(dx, dy) -> wall u16` — sample the wall word at `(partyX+dx, partyY+dy)`.
The real accessor returns 0 (not the indoor view's 1/"plain wall" default)
when `(dx, dy)` falls outside the current 16x16 maze — outdoor index 0
means "nothing drawn" for both layers, so off-map naturally draws nothing
extra. The caller's `get_wall_word` should replicate that."""


def handle_table(graphic_sets: tuple[int, ...]) -> list[str | None]:
    """The maze's 7 graphic-set ids -> `[None, name1.vga, ..., name7.vga]`
    (1-based, matching the wall-word's 1-7 index range; index 0 unused)."""
    out: list[str | None] = [None]
    for g in graphic_sets:
        out.append(f'{TERRAIN[g]}.vga' if g else None)
    return out


def build_outdoor_draw_list(
    get_wall_word: GetWallWord,
    graphic_sets: tuple[int, ...],
    facing: int,
    alt: int,
) -> list[tuple[str, int, int, int, int]]:
    """Returns `[(sprite, frame, x, y, flags), ...]` in real draw order:
    sky backdrop, water backdrop, then 25 ground + 25 overlay terrain
    draws (any whose resolved index is 0, or whose graphic-set slot is
    unassigned, are omitted — nothing to draw there).

    `facing`: 0=N, 1=S, 2=E, 3=W (matches the indoor view's own order, see
    module doc — convert from the walker's N,E,S,W facing at the call
    site). `alt`: 0/1, the same per-redraw toggle the indoor view uses for
    side-wall alternation; here it selects between each terrain slot's two
    alternator frames/sprites and toggles a handful of ground draws'
    mirror flag.
    """
    handle = handle_table(graphic_sets)
    out: list[tuple[str, int, int, int, int]] = [
        ('day.vga', 0, 8, 8, 0),
        ('water.vga', 0, 8, 0x43, 0),
    ]
    for r in RECORDS:
        slot = r['slot']
        if slot is None:
            dx = dy = 0
        else:
            dx, dy = DXT[facing][slot], DYT[facing][slot]
        w = get_wall_word(dx, dy)
        idx = (w >> 4) & 7 if r['layer'] == 'ground' else w & 7
        if not idx:
            continue
        nm = handle[idx]
        if nm is None:
            continue
        fr = r['frame']
        if isinstance(fr, dict):
            fr = fr['values'][alt]
        fl = r['flags']
        if fl == 'ALT':
            fl = alt
        out.append((nm, fr, r['x'], r['y'], fl))
    return out

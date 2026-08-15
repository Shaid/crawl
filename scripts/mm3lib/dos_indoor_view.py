"""MM3 (DOS) indoor 3-D view — which wall sprite/frame draws at each of the
44 on-screen view slots, for a given party position and facing.

Confirmed by disassembling the game's own renderer (see
`docs/mm3/dosvga/data-structure.md` "Indoor 3-D view" for full file-offset
citations). Three stages:

  1. `BuildWallFlags` (root exe file 0xC395-0xDD3C): 44 hand-unrolled view
     slots. Each slot has, per facing, a fixed `(dx, dy)` offset from the
     party and a `mask` selecting one wall side (matches
     `dos_maze.WALL_SHIFT`'s masks: 0x7000 N / 0x0700 E / 0x0070 S /
     0x0007 W). The sampled wall's 3-bit graphic index (1-7; 0 = no wall)
     is dispatched through a **per-slot** 7-arm jump table — each of the
     44 slots has its own table — whose arms just set small flag globals.
     Facing order is **N, S, E, W** (not N,E,S,W).
  2. `BuildWallList` (file 0xE607-0x105FD + 0xDD3D-0xE606): a fixed set of
     54 "chains" (one run of wall-list items per screen region), each
     gated by an occlusion precondition (any of `pre`'s flags set -> skip
     the whole chain) and, per item, an OR-guard (any of `guards`' flags
     set -> draw this item, first match wins).
  3. The actual walker is `vga`+0x1BB8 inside the `MM3.CC` `vga` display
     driver (API entry 0, `vga`+0x0F3C `drawWallList`) — not in the exe at
     all. It reads the chain-emitted command stream and blits.

This module reimplements stages 1-2 purely from the frozen data table
`mm3_indoor_view.json` (extracted once via live disassembly — see that
file's `_meta` field and the git history of this module for the
extraction script; not re-derived at build/runtime, matching every other
`.dat`/`.dat`-derived table in this project). Verified byte-identical to
the live-disassembly reference across 497,664 test cases (81 indoor mazes
x 256 cells x 4 facings x 2 alternator states x 3 torch phases, 0
mismatches).
"""
from __future__ import annotations

import json
import os
from collections import Counter
from typing import Callable

_HERE = os.path.dirname(os.path.abspath(__file__))
_TABLE_PATH = os.path.join(_HERE, 'mm3_indoor_view.json')

with open(_TABLE_PATH) as _f:
    _TABLE = json.load(_f)

SLOTS: list[dict] = _TABLE['slots']
CHAINS: list[dict] = _TABLE['chains']
SLOT_COUNT: int = _TABLE['_meta']['slotCount']

GetWall = Callable[[int, int, int], int]
"""`(dx, dy, mask) -> graphic index 0-7` — sample the wall at `(partyX+dx,
partyY+dy)` on the side selected by `mask` (0x7000/0x0700/0x0070/0x0007 =
N/E/S/W). 0 = no wall. The real accessor returns `0x1111` (index 1, plain
wall) when `(dx, dy)` falls outside the current 16x16 maze — this module
doesn't special-case that; the caller's `get_wall` should."""


def _eval_spec(spec: dict, alt: int, torch: int) -> int:
    kind = spec['kind']
    if kind == 'imm':
        return spec['value']
    if kind == 'alt':
        return alt
    if kind == 'alt2':
        return 2 | alt
    if kind == 'pair':
        return spec['value'][alt]
    if kind == 'pairinv':
        return spec['value'][1 - alt]
    if kind == 'torch':
        return torch + 1
    if kind == 'expr':
        return 0
    raise ValueError(f'unknown spec kind {kind!r}')


def build_wall_list(get_wall: GetWall, facing: int, alt: int = 0, torch: int = 0) -> list[tuple[str, int, int, int, int]]:
    """Returns `[(sprite, frame, x, y, flags), ...]` in draw order.

    `facing`: 0=N, 1=S, 2=E, 3=W (the indoor view's own order — NOT the
    N,E,S,W order `dos_maze`/the walker's movement code uses elsewhere;
    convert at the call site). `alt`: 0/1, a per-redraw toggle that makes
    side-wall art alternate (DS `0x185` in the real game — the "corridor
    slides past you" effect). `torch`: 0-2, the wall-torch flicker phase.
    `x`/`y` are absolute 320x200 screen coordinates; `flags` bit 0 = draw
    the sprite horizontally mirrored.
    """
    flag: Counter[int] = Counter()
    for slot in SLOTS:
        dx, dy, mask, _sh = slot['geom'][facing]
        idx = get_wall(dx, dy, mask)
        if 1 <= idx <= 7:
            for g in slot['arms'][idx - 1]:
                flag[g] += 1

    out: list[tuple[str, int, int, int, int]] = []
    for chain in CHAINS:
        if any(flag[g] for g in chain['pre']):
            continue
        for item in chain['items']:
            if not any(flag[g] for g in item['guards']):
                continue
            flags_spec = item['flags']
            fl = _eval_spec(flags_spec, alt, torch) if flags_spec['kind'] in ('imm', 'alt', 'alt2') else 0
            fr = _eval_spec(item['frame'], alt, torch)
            out.append((chain['sprite'], fr, item['x'], item['y'], fl))
            break
    return out

"""`.DCR` monster-decoration-parameter decode, EOB2-only (DarkMoonEngine).

Ported from `DarkMoonEngine::loadMonsterDecoration` (engines/kyra/engine/
darkmoon.cpp:310-336). EOB1's `EoBCoreEngine::hasDecorations` is hardcoded
`false`, so EOB1 never loads a `.DCR` file — this format only exists in the
EOB2 corpus.

Each "decoration" is a small overlay shape (weapon, glow effect, etc.) drawn
at a fixed offset onto one of a monster's 6 facing/pose animation frames.
`encW == 0 or encH == 0` marks an inactive slot (per ScummVM's reader, which
skips it rather than drawing anything).

Verified byte-exact (zero residue) against all 9 EOB2 `.DCR` files; see
docs/eotb2/dosvga/data-structure.md § ".DCR — monster decoration parameters".
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, asdict

SLOT_STRUCT = struct.Struct('<BBBBbb')  # encX, encY, encW, encH, s8 offsetX, s8 offsetY
SLOTS_PER_SET = 6


@dataclass
class DcrSlot:
    enc_x: int
    enc_y: int
    enc_w: int
    enc_h: int
    offset_x: int
    offset_y: int
    active: bool  # False when enc_w == 0 or enc_h == 0 (reader skips it)


@dataclass
class DcrFile:
    set_count: int
    sets: list[list[DcrSlot]]  # set_count x 6 slots


def parse_dcr(data: bytes) -> DcrFile:
    (set_count,) = struct.unpack_from('<H', data, 0)
    off = 2
    sets = []
    for _ in range(set_count):
        slots = []
        for _ in range(SLOTS_PER_SET):
            enc_x, enc_y, enc_w, enc_h, offset_x, offset_y = SLOT_STRUCT.unpack_from(data, off)
            slots.append(DcrSlot(enc_x, enc_y, enc_w, enc_h, offset_x, offset_y,
                                  active=(enc_w != 0 and enc_h != 0)))
            off += SLOT_STRUCT.size
        sets.append(slots)
    if off != len(data):
        raise ValueError(f'.DCR residue: parsed {off} of {len(data)} bytes')
    return DcrFile(set_count, sets)


def dcr_to_json(dcr: DcrFile) -> dict:
    return {
        'setCount': dcr.set_count,
        'sets': [[asdict(slot) for slot in s] for s in dcr.sets],
    }

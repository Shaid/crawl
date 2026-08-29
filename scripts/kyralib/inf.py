"""EOB1 (DOS) `.INF` level-configuration header -- monster-shape and
wall-set-stem fields only (the fields this project's monster-CPS palette
lookup needs; the full event-script bytecode region is a separate, still-
open item -- see docs/eotb/TODO.md `eotb1-dos-inf-opcode-operands`).

`.INF` is a standard Kyra bitmap (kyralib.format80 header + LCW payload).
Byte-level layout ported from `EoBCoreEngine::initLevelData`/`loadLevel`
(`engine/scene_eob.cpp:34-309`, fetched 2026-08-02). Verified byte-exact
against real `LEVEL1.INF` (`EOBDATA3.PAK`): `mazStem="level1.maz"`,
`wallSetStem="brick"`, monster stems `"kobold"`/`"leech"` -- matching
EOBDATA3.PAK's known BRICK wall set + kobold/leech monster roster. See
docs/eotb/dosvga/data-structure.md § "INF -- Level configuration".
"""
from __future__ import annotations

from dataclasses import dataclass

from .format80 import decompress_bitmap

WALL_SET_STEM_OFFSET = 0x00E
WALL_SET_STEM_LEN = 12
MONSTER_SLOTS_OFFSET = 0x02F
MONSTER_SLOT_SIZE = 13  # 1-byte monsterType (0xFF = none) + 12-byte cstring stem
NUM_MONSTER_SLOTS = 2


def _cstring(raw: bytes) -> str:
    nul = raw.find(b'\x00')
    return raw[:nul if nul != -1 else len(raw)].decode('latin1')


@dataclass
class InfLevelHeader:
    wall_set_stem: str
    monster_stems: list[str]  # only slots with monsterType != 0xFF


def parse_inf_header(chunk: bytes) -> InfLevelHeader:
    """Decode just the wall-set-stem and monster-shape-slot header fields
    of a DOS EOB1 `.INF` file (not the full record layout -- see module
    doc)."""
    _header, payload = decompress_bitmap(chunk)

    wall_set_stem = _cstring(payload[WALL_SET_STEM_OFFSET:WALL_SET_STEM_OFFSET + WALL_SET_STEM_LEN])

    monster_stems = []
    for i in range(NUM_MONSTER_SLOTS):
        slot_off = MONSTER_SLOTS_OFFSET + i * MONSTER_SLOT_SIZE
        monster_type = payload[slot_off]
        if monster_type == 0xFF:
            continue
        stem = _cstring(payload[slot_off + 1:slot_off + MONSTER_SLOT_SIZE])
        if stem:
            monster_stems.append(stem)

    return InfLevelHeader(wall_set_stem=wall_set_stem, monster_stems=monster_stems)

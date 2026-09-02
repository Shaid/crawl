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


# --- EOB2 --------------------------------------------------------------
#
# EOB2's `.INF` header preamble is structurally different from EOB1's (see
# `docs/eotb2/dosvga/data-structure.md` § "INF -- Level configuration
# (EOB2 header preamble)" and `tools/eotb2/decode-inf.ts`, both already
# root-caused/verified against `EoBCoreEngine::initLevelData`,
# `engine/scene_eob.cpp`): a 1-byte tag (0xEC) at 0x004, then 13-byte
# (not EOB1's 12-byte) NUL-padded cstrings for `mazStem` (0x005),
# `wallSetStem` (0x012), and an optional `secondWallSetStem` (0x020, only
# when the flag byte at 0x01F != 0xFF -- LEVEL10-14's "azure" override).
#
# **New for this session**: `.INF` files also chain to one or more further
# "sub-level" block-properties records (ScummVM's own `sub`-argument
# loop in `initLevelData`, which `tools/eotb2/decode-inf.ts` explicitly
# scopes out -- its own doc comment: "sub-level chaining loop skipped
# here for sub == 0, the only case this module handles"). The chain
# mechanism, derived directly from real bytes this session (not from
# source, which only sketches it in a comment): a fixed reference point
# `data = payload[2:]` (i.e. absolute offset 2, right after the 2-byte
# field at 0x000 that both games skip unconditionally); each block's own
# leading 2-byte field, read *before* that block's own tag byte, is a u16
# LE value added to `data`'s base offset (2) to get the position 2 bytes
# *before* the next block's tag byte. Concretely: block 0 starts at tag
# offset 4 (matching the documented EOB2 header above); reading the u16 LE
# at absolute offset 2 gives the next block's `(tag_offset - 2)`. A chain
# value of `0`/`0xFFFF`, or one that doesn't resolve to another valid
# `0xEC`-tagged/`.maz`-suffixed/known-wall-set block, ends the walk.
#
# Verified against all 16 real `LEVELn.INF` files: every file has exactly
# 1 or 2 sub-level blocks (max chain depth observed: 2; the walk is capped
# generously at 8 iterations as a safety bound, never hit in this corpus).
# The extra sub-level blocks are where several real, on-disk monster CPS
# stems that sub==0-only parsing misses turn up -- e.g. LEVEL3's sub-level
# 1 names `"ant"` (matching `ANT.CPS`, one of the task's confirmed-garish
# examples), LEVEL1's sub-level 1 names `"spider"`, LEVEL7's names
# `"wasp"`, LEVEL16's names `"dran"`/`"dragon"`. All monster stems found
# across every sub-level of every file are real, legible names matching a
# real on-disk `<STEM>.CPS` file in this corpus with zero exceptions.
INF2_STEM_LEN = 13
INF2_WALL_SETS = {'DUNG', 'FOREST', 'MEZZ', 'SILVER', 'CRIMSON', 'AZURE'}
INF2_MAX_SUBLEVELS = 8  # generous safety bound; real corpus max observed is 2


def _cstr2(buf: bytes, start: int, maxlen: int) -> str:
    end = buf.find(b'\x00', start, start + maxlen)
    if end == -1:
        end = start + maxlen
    return buf[start:end].decode('latin1')


@dataclass
class Inf2SubLevel:
    wall_set_stem: str
    second_wall_set_stem: str | None
    monster_stems: list[str]


def _parse_inf2_block(payload: bytes, tag_off: int) -> Inf2SubLevel | None:
    """Parse one EOB2 sub-level's fixed block-properties header (tag,
    mazStem, wallSetStem, optional secondWallSetStem) plus its two
    monster-shape slots, starting at `tag_off`. Returns None if the tag
    byte, mazStem suffix, or wallSetStem name don't check out -- used both
    to validate real blocks and to detect the end of the sub-level chain."""
    if tag_off + 1 + INF2_STEM_LEN * 2 + 1 > len(payload):
        return None
    if payload[tag_off] != 0xEC:
        return None
    maz_stem = _cstr2(payload, tag_off + 1, INF2_STEM_LEN)
    if not maz_stem.lower().endswith('.maz'):
        return None
    wall_set_stem = _cstr2(payload, tag_off + 1 + INF2_STEM_LEN, INF2_STEM_LEN)
    if wall_set_stem.upper() not in INF2_WALL_SETS:
        return None

    flag2_off = tag_off + 1 + INF2_STEM_LEN * 2
    flag2 = payload[flag2_off]
    pos = flag2_off + 1
    second_wall_set_stem = None
    if flag2 != 0xFF:
        second_wall_set_stem = _cstr2(payload, pos, INF2_STEM_LEN)
        pos += INF2_STEM_LEN

    pos += INF2_STEM_LEN  # soundFile (unused here)

    for _ in range(2):  # door-shape records
        disc = payload[pos]
        pos += 1
        if disc in (0xEC, 0xEA):
            pos += 16 + 48

    pos += 2  # stepsUntilScriptCall

    monster_stems = []
    for _ in range(2):  # monster-shape records
        tag_m = payload[pos]
        pos += 1
        if tag_m != 0xEC:
            continue
        stem = _cstr2(payload, pos + 2, INF2_STEM_LEN)
        if stem:
            monster_stems.append(stem)
        pos += 16

    return Inf2SubLevel(wall_set_stem=wall_set_stem, second_wall_set_stem=second_wall_set_stem,
                         monster_stems=monster_stems)


def parse_inf2_sublevels(chunk: bytes) -> list[Inf2SubLevel]:
    """Walk a real EOB2 `.INF` file's full sub-level chain (see module doc
    above `Inf2SubLevel`), returning one entry per valid sub-level block in
    on-disk order."""
    _header, payload = decompress_bitmap(chunk)

    data_base = 2  # fixed reference point every chain-jump adds onto
    pos = data_base
    results: list[Inf2SubLevel] = []
    seen_tag_offs: set[int] = set()
    for _ in range(INF2_MAX_SUBLEVELS):
        tag_off = pos + 2
        if tag_off in seen_tag_offs:
            break
        seen_tag_offs.add(tag_off)
        block = _parse_inf2_block(payload, tag_off)
        if block is None:
            break
        results.append(block)

        if pos + 2 > len(payload):
            break
        chain_val = payload[pos] | (payload[pos + 1] << 8)
        if chain_val in (0, 0xFFFF):
            break
        next_pos = data_base + chain_val
        if next_pos <= pos or next_pos >= len(payload):
            break
        pos = next_pos

    return results

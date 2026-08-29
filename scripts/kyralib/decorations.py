"""`.DEC` level-decoration-definition decode, shared DOS/Amiga (EOB1/EOB2).

Ported from ScummVM's `EoBCoreEngine::loadDecorations`/`getDecDefinitions`
(engines/kyra/engine/scene_eob.cpp:420-462), read via
`createEndianAwareReadStream(decFile, Resource::kForceLE)` — always
little-endian regardless of platform (no Amiga override of
`getDecDefinitions` exists outside SegaCD).

Verified byte-exact (zero residue) against all 6 EOB2 `.DEC` files; see
docs/eotb2/dosvga/data-structure.md § ".DEC — level decoration placement".
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, asdict

DEC_STRUCT = struct.Struct('<10BBB10h10h')  # LevelDecorationProperty, 52 bytes
RECT_STRUCT = struct.Struct('<4H')  # EoBRect8, 8 bytes


@dataclass
class LevelDecorationProperty:
    shape_index: list[int]  # 10 entries, 0xFF sentinel
    next: int
    flags: int
    shape_x: list[int]  # 10 entries, s16
    shape_y: list[int]  # 10 entries, s16


@dataclass
class EoBRect8:
    x: int
    y: int
    w: int
    h: int


@dataclass
class DecFile:
    decorations: list[LevelDecorationProperty]
    rects: list[EoBRect8]


def parse_dec(data: bytes) -> DecFile:
    (dec_count,) = struct.unpack_from('<H', data, 0)
    off = 2
    decorations = []
    for _ in range(dec_count):
        fields = DEC_STRUCT.unpack_from(data, off)
        shape_index = list(fields[0:10])
        next_, flags = fields[10], fields[11]
        shape_x = list(fields[12:22])
        shape_y = list(fields[22:32])
        decorations.append(LevelDecorationProperty(shape_index, next_, flags, shape_x, shape_y))
        off += DEC_STRUCT.size
    (rect_count,) = struct.unpack_from('<H', data, off)
    off += 2
    rects = []
    for _ in range(rect_count):
        rects.append(EoBRect8(*RECT_STRUCT.unpack_from(data, off)))
        off += RECT_STRUCT.size
    if off != len(data):
        raise ValueError(f'.DEC residue: parsed {off} of {len(data)} bytes')
    return DecFile(decorations, rects)


def dec_to_json(dec: DecFile) -> dict:
    return {
        'decorations': [asdict(d) for d in dec.decorations],
        'rects': [asdict(r) for r in dec.rects],
    }

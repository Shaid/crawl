"""MAZ (dungeon level grid) decode, EOB DOS/VGA.

Ported from ScummVM's EoBCoreEngine::loadBlockProperties (engines/kyra/
engine/scene_eob.cpp): `p = getBlockFileData(mazFile) + 6` then 1024 cells
x 4 wall bytes (N/E/S/W), raw (uncompressed) file read — no LCW.

Header (6 bytes, little-endian): width=32 (u16), height=32 (u16), tile-size
flag=4 (u16) — verified against data/eotb/dosvga LEVEL1.MAZ: header bytes
decode to exactly (32, 32, 4), and 6 + 1024*4 = 4102 matches the file's
size exactly (no residue), for every LEVELn.MAZ in the corpus.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

GRID_W = 32
GRID_H = 32
HEADER_SIZE = 6


@dataclass
class MazeGrid:
    width: int
    height: int
    tile_size_flag: int
    walls: np.ndarray  # (1024, 4) uint8, order N/E/S/W per ScummVM's wall[4]


def parse_maz(data: bytes) -> MazeGrid:
    width, height, tile_size_flag = struct.unpack_from('<3H', data, 0)
    cells = data[HEADER_SIZE:HEADER_SIZE + width * height * 4]
    if len(cells) != width * height * 4:
        raise ValueError(f'MAZ cell data truncated: got {len(cells)}, expected {width * height * 4}')
    walls = np.frombuffer(cells, dtype=np.uint8).reshape(width * height, 4)
    return MazeGrid(width, height, tile_size_flag, walls)

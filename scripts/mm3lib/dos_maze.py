#!/usr/bin/env python3
"""MM3 maze (wall-layout) records — `maze<NN>.dat`, 832 bytes each.

The maze grids do NOT live in `MM3.CC`. They live in **`MM3.CUR`**, the
shipped "current game" archive (same CC container format, parsed by
`mm3lib.dos_cc`). `MM3.CUR` is the pristine new-game state: the game copies
it to a save and writes the *modified* maze records back, which is why the
read-only `MM3.CC` has no maze layouts at all — only the `text<NN>.maz`
strings.

Naming (confirmed): `maze%02u.dat` / `maze%02u.bin` / `maze%02u.evt`, the
literal sprintf templates found in the Amiga executable
(`data/mm3/amiga/Might&MagicIII` file offsets 0x7F58, 0x356D3, 0x356C6).
Ids >= 100 naturally render as three digits.

Record layout (all offsets record-relative; **confirmed** — every field
below is cited to the Amiga executable's own accessor code, file offsets in
`data/mm3/amiga/Might&MagicIII`):

    0x000  512 B  wall grid: 16x16 u16 LE, index = y*16 + x
                  (accessor at file 0x20EF6: `y*32 + x*2`, word read)
    0x200  256 B  cell grid: 16x16 u8,  index = y*16 + x
                  (accessor at file 0x211A8: `y*16 + x`, byte read)
    0x300   64 B  trailer (see TRAILER below)

Grid orientation (confirmed): **x increases EAST, y increases NORTH**
(y = 0 is the southern edge). Established three independent ways — the
Amiga move/line-of-sight check at file 0xC412, the shipped world-map
poster (`data/mm3/amiga/Docs/World Map.jpg`, sections A1..F4 == mazes
41..64), and cross-map terrain continuity.

Wall word (confirmed): four 4-bit fields, one per side of the cell:

    bits  0-3   WEST      bits  4-7   SOUTH
    bits  8-11  EAST      bits 12-15  NORTH

    within each field:  bit 3 (0x8) = "blocks movement and line of sight"
                        bits 0-2 (0x7) = wall graphic index 0..7

The 3-bit/1-bit split is the game's own: every one of the 16 call sites of
the wall accessor passes a mask of 0x0007/0x0070/0x0700/0x7000 (graphic
index) or 0x0008/0x0080/0x0800/0x8000 (blocking flag) -- never a full
nibble. The blocking bit is shared by the two cells either side of a wall
(19440/19440 E-W and 19438/19440 N-S agreement across the 81 indoor mazes);
the graphic index is per-side, so the two faces of one wall may differ.

For the 24 **outdoor** mazes (41..64) the same u16 is a different union
member -- terrain layers, not walls (Xeen's `MazeWallOutdoors`). Detected
by `is_outdoor()` below; the per-side reciprocity invariant does not hold
there and `wall()` must not be used.

Trailer (0x300..0x33F):

    +0x00..06  7 x graphic-set id; nonzero id N is looked up 1-based in a
               global name table and loaded as `<name>.vga`
               (Amiga file 0x8E5C..0x8ED2, loop bound `cmpi.w #7`).
               A wall's 3-bit graphic index selects entry N-1 of this table
               (Amiga file 0x10390: `record + 0x2FF + N`, N != 0).
    +0x07      percentage (rand(1..100) test at Amiga file 0x11EF4)
    +0x08      surrounding maze NORTH   (used when y > 15; file 0x20D94)
    +0x09      surrounding maze EAST    (used when x > 15; file 0x20DC0)
    +0x0A      surrounding maze SOUTH   (file 0x2A1E8)
    +0x0B      surrounding maze WEST    (file 0x2A170)
    +0x0C      saving allowed        (0 -> "no saving in this maze", 0x3575A)
    +0x0D      flag, map-timer related (file 0x216F0)
    +0x0E      resting allowed       (0 -> "Too dangerous to rest here!")
    +0x0F      dismiss allowed       (0 -> "Too dangerous to dismiss here!")
    +0x10      0 in all 105 shipped records (read at file 0x36D66 as a
               wall-graphics base offset)
    +0x11,0x12 percentages
    +0x13      run/start position: low nibble = x, high nibble = y
               (file 0x20CCA / 0x20CF0)
    +0x14..1A  7 x 0/1 permission flags
    +0x1B..1E  4 percentages
    +0x1F      maze number (matches the filename for 104 of 105 records;
               `maze89.dat` stores 0 -- an original-data quirk)
    +0x20..3F  256-bit "seen/visited" bitmap, bit index = y*16 + x
               (`addi.l #0x320` at file 0x20E0A / 0x20EE4, on the maze-record
               base loaded at 0x20E04 / 0x20EDE). All zero in the pristine
               MM3.CUR -- nothing has been explored yet.

A 2x2 block of mazes forms one 32x32 area (castles, big dungeons): the
engine keeps 4 records resident at once and resolves x/y in 0..31 by
stepping through the +0x08 (north) and +0x09 (east) links -- Amiga loader
at file 0x7F02, `muls.w #0x340` (= 832) and `cmpi.w #4`.
"""
from __future__ import annotations

import struct
from typing import Iterable

MAZE_RECORD_SIZE = 832
GRID_W = GRID_H = 16

WALLS_OFF = 0x000
CELLS_OFF = 0x200
TRAILER_OFF = 0x300
SEEN_OFF = 0x320

# direction -> bit position of that side's 4-bit field in the wall u16
WALL_SHIFT = {'west': 0, 'south': 4, 'east': 8, 'north': 12}
DIRECTIONS = ('north', 'east', 'south', 'west')
# (dx, dy) with x east, y north
DIR_DELTA = {'north': (0, 1), 'east': (1, 0), 'south': (0, -1), 'west': (-1, 0)}

# maze ids present in the retail MM3.CUR: 1..103, 105, 106 (104 is absent)
MAZE_IDS: tuple[int, ...] = tuple(list(range(1, 104)) + [105, 106])


def maze_name(maze_id: int, ext: str = 'dat') -> str:
    """`maze%02u.<ext>` — the game's own sprintf template."""
    return f'maze{maze_id:02d}.{ext}'


class Maze:
    """One decoded 832-byte maze record."""

    __slots__ = ('maze_id', 'raw', 'walls', 'cells', 'trailer')

    def __init__(self, maze_id: int, raw: bytes):
        if len(raw) != MAZE_RECORD_SIZE:
            raise ValueError(f'maze{maze_id:02d}.dat is {len(raw)} B, expected {MAZE_RECORD_SIZE}')
        self.maze_id = maze_id
        self.raw = raw
        self.walls: tuple[int, ...] = struct.unpack_from('<256H', raw, WALLS_OFF)
        self.cells: bytes = raw[CELLS_OFF:CELLS_OFF + 256]
        self.trailer: bytes = raw[TRAILER_OFF:TRAILER_OFF + 64]

    # ---- wall grid -------------------------------------------------------
    def wall_word(self, x: int, y: int) -> int:
        return self.walls[y * GRID_W + x]

    def wall(self, x: int, y: int, direction: str) -> tuple[int, bool]:
        """(graphic index 0..7, blocks movement) for one side of one cell."""
        v = (self.walls[y * GRID_W + x] >> WALL_SHIFT[direction]) & 0xF
        return v & 7, bool(v & 8)

    def blocked(self, x: int, y: int, direction: str) -> bool:
        return bool((self.walls[y * GRID_W + x] >> (WALL_SHIFT[direction] + 3)) & 1)

    def cell(self, x: int, y: int) -> int:
        return self.cells[y * GRID_W + x]

    def seen(self, x: int, y: int) -> bool:
        i = y * GRID_W + x
        return bool(self.trailer[0x20 + (i >> 3)] & (0x80 >> (i & 7)))

    # ---- trailer ---------------------------------------------------------
    @property
    def graphic_sets(self) -> tuple[int, ...]:
        """7 graphic-set ids; a wall's 3-bit index N (1..7) selects entry N-1."""
        return tuple(self.trailer[0:7])

    @property
    def surrounding(self) -> dict[str, int]:
        """Neighbouring maze ids (0 = none), in the engine's own field order."""
        return {'north': self.trailer[0x08], 'east': self.trailer[0x09],
                'south': self.trailer[0x0A], 'west': self.trailer[0x0B]}

    @property
    def stored_id(self) -> int:
        return self.trailer[0x1F]

    @property
    def run_position(self) -> tuple[int, int]:
        b = self.trailer[0x13]
        return b & 0xF, (b >> 4) & 0xF

    @property
    def can_save(self) -> bool:
        return bool(self.trailer[0x0C])

    @property
    def can_rest(self) -> bool:
        return bool(self.trailer[0x0E])

    @property
    def can_dismiss(self) -> bool:
        return bool(self.trailer[0x0F])

    def is_outdoor(self) -> bool:
        """Outdoor mazes use the u16 as terrain layers, not per-side walls.

        Marked by a nonzero graphic-set table; true for exactly the 24
        world-map sections (mazes 41..64) in retail data.
        """
        return any(self.trailer[0:7])

    def __repr__(self) -> str:
        return f'<Maze {self.maze_id} {"outdoor" if self.is_outdoor() else "indoor"}>'


# ---- container -----------------------------------------------------------

def load_cur(path: str) -> tuple[bytes, dict[int, object]]:
    """Parse MM3.CUR (a CC archive) -> (raw bytes, {hash: entry})."""
    from . import dos_cc
    data = open(path, 'rb').read()
    entries, _ = dos_cc.parse(data)
    return data, {e.hash: e for e in entries}


def read_entry(data: bytes, by_hash: dict, name: str) -> bytes | None:
    """Raw (uncompressed) bytes of a named MM3.CUR entry.

    MM3.CUR entries are stored **raw**, not LZHUF — do not route them
    through `dos_cc.extract_entry`, whose 4-byte-descriptor heuristic
    misfires on flat data.
    """
    from . import dos_cc
    e = by_hash.get(dos_cc.hash_filename(name))
    if e is None:
        return None
    return data[e.offset:e.offset + e.comp_size]


def load_mazes(path: str, ids: Iterable[int] = MAZE_IDS) -> dict[int, Maze]:
    data, by_hash = load_cur(path)
    out: dict[int, Maze] = {}
    for i in ids:
        blob = read_entry(data, by_hash, maze_name(i, 'dat'))
        if blob is not None:
            out[i] = Maze(i, blob)
    return out


# ---- events (`maze<NN>.evt`) --------------------------------------------
# Xeen-family event records: [len][x][y][dir][line][opcode][params...],
# where len counts the 5 fixed bytes + parameters (record size = 1 + len).
# x/y run 0..31 because a 2x2 maze block is one 32x32 area.

def parse_events(blob: bytes) -> tuple[list[dict], int]:
    out: list[dict] = []
    i = 0
    while i < len(blob):
        ln = blob[i]
        if ln < 5 or i + 1 + ln > len(blob):
            break
        r = blob[i + 1:i + 1 + ln]
        out.append({'x': r[0], 'y': r[1], 'direction': r[2], 'line': r[3],
                    'opcode': r[4], 'params': list(r[5:])})
        i += 1 + ln
    return out, i

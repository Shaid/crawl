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

Indoor wall-texture selection -- **confirmed** (see the "Graphics
environment" section below): it is NOT a maze-record field at all. It is a
40-byte constant table in the executable, indexed by `mazeId - 1`.
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


# =========================================================================
# Graphics environment — which wall/tile/sky/music set a maze uses
# =========================================================================
#
# **Confirmed** by disassembling the engine's `LoadMazeGraphics(mazeIndex)`
# routine in BOTH ports (byte-for-byte the same logic and the same constant
# tables):
#
#   Amiga  `data/mm3/amiga/Might&MagicIII` file 0x8D66..0x8FC2
#          (reached only through the SAS/C A4 jump-table stub at file
#          0x15C9C, i.e. `jsr -$7E7E(a4)`; sole call site file 0x1145C)
#   DOS    `build/cache/mm3/MM3_original_reconstructed.exe` file
#          0x34768..0x34978 (an FBOV overlay segment, not root code)
#
# The argument is a **0-based maze index** = `mazeId - 1`.  Proof, three
# independent ways:
#   * the routine's own outdoor cut-off is `index >= 40` (Amiga 0x8DBC
#     `cmpi.w #$28,d4` / DOS 0x347B4 `cmp word [bp+6],0x28`), i.e.
#     mazeId >= 41 — exactly the 24 outdoor world-map sections 41..64;
#   * it stores `index + 1` into the "current graphics maze" byte (Amiga
#     a4-0x1665, DOS [0xE8F7]) and the Corak's-Notes reader (Amiga 0x111BC,
#     DOS 0x371E4) reads that byte back as `- 1` to index a 65-entry
#     per-maze table whose entry 64 is reached when the byte is 105;
#   * that same 65/66-entry table is the game's **maze name table** (DOS
#     DS 0x5784, entry i = mazeId i+1) and its six name groups line up
#     1:1 with the six runs of the environment table below.
#
# Environment table: 40 bytes, index = `mazeId - 1`.
#   Amiga a4-0x3AAF  (file 0x1A06B)   DOS DS 0x30E2 (file 0x1B9D2)
# Byte-identical between the two ports.
MAZE_ENV: tuple[int, ...] = (
    (0,) * 5      # mazeId  1..5   the five towns
    + (1,) * 10   # mazeId  6..15  caverns
    + (2,) * 8    # mazeId 16..23  dungeons
    + (3,) * 5    # mazeId 24..28  castles
    + (2,) * 5    # mazeId 29..33  castle dungeons
    + (4,) * 7    # mazeId 34..40  the spaceship sectors
)

# Env id -> name-pointer table entries.  One contiguous pointer array holds
# all three groups: wall prefixes at Amiga a4-0x43E6 / DOS DS 0x5A34,
# minimap tiles at a4-0x43D2 / DS 0x5A3E, outdoor terrain at a4-0x43BE.
ENV_WALL_PREFIX = ('twn', 'cav', 'dun', 'cas', 'sci')
ENV_TILE_FILE = ('town.til', 'cave.til', 'dung.til', 'castle.til', 'scifi.til')
# `<prefix>.sky` — built by the sky loader (Amiga 0x8A68 area / DOS 0x346F4,
# `mov al,[si+0x30E1]` = the same env table).  Only three of the five ship in
# MM3.CC: towns and castles have no ceiling texture.
ENV_SKY_FILE = ('twn.sky', 'cav.sky', 'dun.sky', 'cas.sky', 'sci.sky')
SHIPPED_SKY_FILES = frozenset({'cav.sky', 'dun.sky', 'sci.sky'})

# The four wall files are loaded as `sprintf("%swl%u.vga", prefix, n)` with
# n taken from a 4-byte order table (Amiga a4-0x5436 file 0x186E4, DOS
# DS 0x310A file 0x1B9FA) = 01 02 04 03, and each handle is stored at
# `spriteArray[n]` (Amiga a4+0xC6A-4+4n, DOS DS 0xC4A6+4n).  So the load
# ORDER is 1,2,4,3 but the slot is always the file's own number: slot n
# always holds `<prefix>wl<n>.vga`.
WALL_LOAD_ORDER = (1, 2, 4, 3)
WALL_FILE_NUMBERS = (1, 2, 3, 4)

# Two maze indices are forced to index 15 (= mazeId 16, "Ancient Temple of
# Moo", env 2 = dungeon) before the table lookup:
#   Amiga 0x8D98 `cmpi.w #$69,d4 / cmpi.w #$68,d4 -> moveq #$f,d4`
#   DOS   0x34794 `cmp word [bp+6],0x69 / 0x68 -> mov word [bp+6],0xF`
# index 104/105 == mazeId 105/106 — the two ids above the 1..103 run, and
# there is no maze 104 in the shipped data.
GRAPHICS_ID_OVERRIDE = {105: 16, 106: 16}

# Music, from the same routine (DOS 0x348E6..0x34925; the Amiga port uses
# `.mx` names and substitutes `shop.mx` for the outdoor case).  The five
# range boundaries are byte-for-byte the six runs of MAZE_ENV.
MUSIC_BY_INDEX = ((5, 'medieval.m'), (15, 'caves.m'), (23, 'eerie.m'),
                  (28, 'city.m'), (33, 'eerie.m'), (40, 'cyber.m'),
                  (10 ** 9, 'venture.m'))

# The engine's own maze-name table, DOS DS 0x5784 (file 0x1E074), entry
# i = mazeId i+1; entries 64/65 are the two out-of-range mazes.
MAZE_NAMES: dict[int, str] = {
    1: 'Fountain Head', 2: 'Baywatch', 3: 'Wildabar', 4: 'Swamp Town',
    5: 'Blistering Heights',
    6: 'Fountain Head Cavern', 7: 'Baywatch Cavern', 8: 'Wildabar Cavern',
    9: 'Swamp Town Cavern', 10: 'Blistering Heights Cavern',
    11: 'Cyclops Cavern', 12: 'Arachnoid Cavern', 13: 'Cursed Cold Cavern',
    14: 'Dragon Cavern', 15: 'The Magic Cavern',
    16: 'Ancient Temple of Moo', 17: 'Slithercult Stronghold',
    18: 'Fortress of Fear', 19: 'Halls of Insanity', 20: 'Dark Warrior Keep',
    21: 'Cathedral of Carnage', 22: 'Tomb of Terror', 23: 'The Maze From Hell',
    24: 'Castle Whiteshield', 25: 'Castle Bloodreign',
    26: 'Castle Dragontooth', 27: 'Castle Greywind', 28: 'Castle Blackwind',
    29: 'Whiteshield Dungeon', 30: 'Bloodreign Dungeon',
    31: 'Dragontooth Dungeon', 32: 'Greywind Dungeon', 33: 'Blackwind Dungeon',
    34: 'Alpha Engine Sector', 35: 'Main Engine Sector',
    36: 'Beta Engine Sector', 37: 'Aft Storage Sector',
    38: 'Central Control Sector', 39: 'Forward Storage Sector',
    40: 'Main Control Sector',
    105: "It's a Secret", 106: 'The Arena',
}
MAZE_NAMES.update({40 + 1 + i: f'{"ABCDEF"[i // 4]}{i % 4 + 1}' for i in range(24)})


def block_primary(mazes: dict[int, 'Maze']) -> dict[int, int]:
    """maze id -> the id whose graphics the maze renders with.

    Mazes 65..103 are the extra quadrants of a 32x32 area; the engine only
    ever calls `LoadMazeGraphics` with the area's *primary* id (all in
    1..40, so all in range of MAZE_ENV).  The block membership is recovered
    from the record's own +0x08 (north) / +0x09 (east) links, walked
    transitively while the target id is above the world-map range.
    """
    out: dict[int, int] = {}
    for pid in sorted(mazes):
        if pid > 40:
            continue
        out.setdefault(pid, pid)
        pending = [pid]
        seen = {pid}
        while pending:
            cur = mazes.get(pending.pop())
            if cur is None:
                continue
            for d in ('north', 'east'):
                nxt = cur.surrounding[d]
                if nxt > 64 and nxt not in seen:
                    seen.add(nxt)
                    out[nxt] = pid
                    pending.append(nxt)
    return out


def graphics_maze_id(maze_id: int, primaries: dict[int, int] | None = None) -> int | None:
    """The maze id the engine loads graphics for when `maze_id` is entered.

    Returns None for the 24 outdoor sections (41..64), which have no wall
    series at all.
    """
    if maze_id in GRAPHICS_ID_OVERRIDE:
        return GRAPHICS_ID_OVERRIDE[maze_id]
    if 41 <= maze_id <= 64:
        return None
    if maze_id <= 40:
        return maze_id
    if primaries and maze_id in primaries:
        return primaries[maze_id]
    return None


def resolve_graphics(mazes: dict[int, 'Maze']) -> dict[int, dict]:
    """Per-maze graphics resolution for the whole corpus.

    {maze_id: {graphicsMazeId, env, wallSeries, wallFiles, tile, sky,
               music, areaName}}  — outdoor mazes get `env=None`.
    """
    primaries = block_primary(mazes)
    out: dict[int, dict] = {}
    for mid in sorted(mazes):
        gid = graphics_maze_id(mid, primaries)
        if gid is None:
            out[mid] = {
                'graphicsMazeId': None, 'env': None, 'wallSeries': None,
                'wallFiles': [], 'tile': 'out.til', 'sky': None,
                'music': 'venture.m', 'areaName': MAZE_NAMES.get(mid),
            }
            continue
        env = MAZE_ENV[gid - 1]
        prefix = ENV_WALL_PREFIX[env]
        sky = ENV_SKY_FILE[env]
        music = next(name for bound, name in MUSIC_BY_INDEX if gid - 1 < bound)
        out[mid] = {
            'graphicsMazeId': gid,
            'env': env,
            'wallSeries': prefix,
            'wallFiles': [f'{prefix}wl{n}.vga' for n in WALL_FILE_NUMBERS],
            'tile': ENV_TILE_FILE[env],
            'sky': sky if sky in SHIPPED_SKY_FILES else None,
            'music': music,
            'areaName': MAZE_NAMES.get(mid) or MAZE_NAMES.get(gid),
        }
    return out


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

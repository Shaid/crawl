#!/usr/bin/env python3
"""Black Crypt (Amiga) — the automap tilemap, reimplemented from the game.

Transcribed instruction for instruction from decompressed `bcdft` S_1
(`data/blackcrypt/extracted/bcdft_decompressed.bin`):

    +0x0382A   RevealAroundParty()      picks a tile for the party square and
                                        its four neighbours, commits it into
                                        the runtime map array
    +0x0369E   RevealWalls(X, Y)        paints tile 0 behind wall edges, and
                                        tile 21 on adjacent illusionary walls
    +0x03B1A   the type-byte jump table (16 entries, base +0x03B2C)
    +0x03B94   ShowAutomap()            bounding box, centring, render loop
    +0x1F9FA   DrawAutomapTile(col, row, tile)

The key fact this module encodes: **there is no separate tilemap buffer.**
The automap tile index for a square lives in *that square's own longword* in
the runtime 64x64 map array at `A4 - 0x37CA`, in **bits 27-20** — the two
nibbles that are the constant `0xFF` on disk. `0xFF` means "not yet
explored"; the render loop skips those squares.

Verified: bits 27-20 are `0xFF` on all 15,168 squares of all 13 maps in
`bcdfs` (zero deviation), and a full-exploration simulation of dungeon
Level 1 reproduces the official Manual & Clue Book's printed map at
**99.25 %** of its pure wall/floor cells (398/401), Level 2 at **98.02 %**
(595/607). See `docs/blackcrypt/amiga/data-structure.md`, section
"bcdfa — UI / Automap Resource Bank" -> "The automap tilemap".

Usage:
    python3 scripts/automap_tiles.py                 # tile census, all maps
    python3 scripts/automap_tiles.py 1 1             # ASCII map, map 1 level 1
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bclib import bcdfs                                        # noqa: E402

BCDFS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     '..', 'data', 'blackcrypt', 'amiga', 'bcdfs')

#: bits 27-20 of a square longword: the automap tile index.
TILE_SHIFT = 20
TILE_MASK = 0x0FF00000
TILE_KEEP = 0xF00FFFFF          # ANDI.L at +0x03B60 / +0x0370A
TILE_UNSEEN = 0xFF              # the on-disk value; "not yet explored"

TILE_NAMES = {
    0: 'wall', 1: 'stairs up', 2: 'stairs down', 3: 'door open (horizontal)',
    4: 'door closed (horizontal)', 5: 'door open (vertical)',
    6: 'door closed (vertical)', 7: 'pillar', 8: 'floor pit', 9: 'teleport',
    10: 'magic field', 11: 'glyph', 12: 'fountain', 13: 'floor plate',
    14: 'trap (visible)', 15: 'floor', 16: 'darkness',
    17: 'party facing N', 18: 'party facing E', 19: 'party facing S',
    20: 'party facing W', 21: 'illusionary wall', 22: 'spinner',
    23: 'special panel',
}

TILE_ASCII = {
    0: '#', 1: 'U', 2: 'W', 3: 'o', 4: 'c', 5: 'O', 6: 'C', 7: 'P', 8: 'p',
    9: 'T', 10: 'M', 11: 'G', 12: 'F', 13: 'L', 14: 't', 15: '.', 16: 'D',
    21: 'I', 22: 'S', 23: 'X',
}


def _w(rec, off):
    return struct.unpack_from('>H', rec, off)[0]


def load_world(raw=None):
    """Walk `bcdfs` into (squares, records) per map, the way the loader does.

    `squares[m][(row, col)]` is the 4-byte square as a big-endian longword.
    `records[m][slot]` is a 20-byte object record, keyed by the runtime slot
    index — the square's `unique` for the head of a same-square chain, and
    each record's own word `+0x12` for the rest.
    """
    if raw is None:
        raw = open(BCDFS, 'rb').read()
    offsets = bcdfs.read_map_offsets(raw)
    squares = [dict() for _ in range(bcdfs.MAP_COUNT)]
    records = [dict() for _ in range(bcdfs.MAP_COUNT)]

    for m in range(bcdfs.MAP_COUNT):
        sq_out, rec_out = squares[m], records[m]
        cur = bcdfs._Cursor(raw, offsets[m] + bcdfs.OFFSET_TABLE_BYTES)
        cur.take(4)
        last_row = bcdfs._signed(cur.take(1)[0])

        def actions(rec):
            nxt = first = rec[0x0D]
            looped = False
            while nxt != 0 and not looped:
                nxt = cur.take(8)[7]
                looped = nxt == first

        def sub_chain(parent, is_monster):
            if bcdfs._word(parent, 0x0A if is_monster else 0x0C) == 0:
                return
            while True:
                rec = bytes(cur.take(bcdfs.RECORD_BYTES))
                mon = bool(rec[0] & 0x80)
                if mon:
                    cur.take(bcdfs.RECORD_BYTES)
                if rec[5] in bcdfs.CONTAINER_TYPES or mon:
                    sub_chain(rec, mon)
                if bcdfs._word(rec, 0x12) == 0:
                    break

        def entity_chain(slot):
            while True:
                rec = bytes(cur.take(bcdfs.RECORD_BYTES))
                if slot:
                    rec_out[slot] = rec
                mon = bool(rec[0] & 0x80)
                if mon:
                    second = cur.take(bcdfs.RECORD_BYTES)
                    if second[0x13] != 0:
                        cur.take(4)
                if rec[5] in bcdfs.CONTAINER_TYPES or mon:
                    sub_chain(rec, mon)
                elif rec[5] in bcdfs.ACTION_TYPES:
                    actions(rec)
                slot = bcdfs._word(rec, 0x12)
                if slot == 0:
                    break

        for row in range(0, last_row + 1):
            first_col = bcdfs._signed(cur.take(1)[0])
            last_col = bcdfs._signed(cur.take(1)[0])
            for col in range(first_col, last_col + 1):
                v = struct.unpack('>I', bytes(cur.take(4)))[0]
                sq_out[(row, col)] = v
                if v & 0xFFF:
                    entity_chain(v & 0xFFF)
    return squares, records


def apply_facing_delta(x, y, facing):
    """S_1 +0x002B4. Facings >= 4 are a no-op (4-entry jump table)."""
    return {0: (x, y + 1), 1: (x + 1, y), 2: (x, y - 1), 3: (x - 1, y)}.get(
        facing, (x, y))


def reveal_walls(sq, recs, x, y):
    """S_1 +0x0369E — paint the wall outline around a revealed feature."""
    for d3 in range(5):
        nx, ny = apply_facing_delta(x, y, d3)
        if (ny, nx) not in sq:
            continue
        if sq.get((y, x), 0) & (0x1000 << d3):
            sq[(ny, nx)] &= TILE_KEEP                       # tile 0 = wall
            continue
        slot = sq[(ny, nx)] & 0xFFF
        while slot:
            rec = recs.get(slot)
            if rec is None:
                break
            if (_w(rec, 0) & 0x7FFF) and rec[5] == 0x10 \
                    and _w(rec, 0x0A) == 0 and _w(rec, 0x0C) == 1:
                sq[(ny, nx)] = (sq[(ny, nx)] & TILE_KEEP) + (21 << TILE_SHIFT)
            slot = _w(rec, 0x12)


def _dispatch(sq, recs, rec, x, y, tile):
    """S_1 +0x03B1A — the 16-entry type-byte jump table (types 0x10-0x1F)."""
    t = rec[5]
    gate = _w(rec, 0x0A) == 0            # SEQ on word +0x0A at +0x03936
    if t == 0x10 and gate:                                   # +0x03956
        tile = {1: 21, 2: 10, 3: 11}.get(_w(rec, 0x0C), tile)
        if _w(rec, 0x0C) in (2, 3):
            reveal_walls(sq, recs, x, y)
    elif t == 0x11 and tile == 15:                           # +0x039A4
        vertical = bool(rec[4] & 0x10)   # +0x04 bit 4 = N wall -> E-W corridor
        is_open = bool(rec[0x0F] & 0x01)  # confirmed door open/closed flag
        tile = {(True, True): 5, (True, False): 6,
                (False, True): 3, (False, False): 4}[(vertical, is_open)]
        reveal_walls(sq, recs, x, y)
    elif t == 0x12 and gate:                                 # +0x039F4
        kind = _w(rec, 0x10)
        if kind < 5:
            tile = {0: 9, 1: 9, 2: 1, 3: 2, 4: 22}[kind]
            reveal_walls(sq, recs, x, y)
    elif t == 0x14:                                          # +0x03A74
        if _w(rec, 0x10) == 0 and gate:
            tile = 8
        reveal_walls(sq, recs, x, y)
    elif t == 0x17:                                          # +0x03A96
        if gate:
            tile = 7
        reveal_walls(sq, recs, x, y)
    elif t == 0x1E:                                          # +0x03AB0
        if rec[7] == 0 and gate:                # byte +0x07 = the inviso flag
            if _w(rec, 0x0E) == 0:
                tile = 13
            elif _w(rec, 0x0C) != 0:
                tile = 14
    elif t == 0x1F:                                          # +0x03AD6
        tile = 12 if _w(rec, 0x0E) == 0 else 23
        reveal_walls(sq, recs, x, y)
    return tile


def reveal_around(sq, recs, party_col, party_row):
    """S_1 +0x0382A. Reveals the party square and its four neighbours."""
    for d5 in range(5):                  # d5 == 4 is the party's own square
        tile = 15                                            # default: floor
        x, y = party_col, party_row
        if d5 < 4:
            if sq.get((party_row, party_col), 0) & (1 << (d5 + 12)):
                tile = 0                          # a wall edge blocks the view
            x, y = apply_facing_delta(x, y, d5)
        if not (0 <= x < 64 and 0 <= y < 64) or (y, x) not in sq:
            continue
        v = sq[(y, x)]
        if v & (1 << 28):                          # square type bit 0 = wall
            tile = 0
        if v & (1 << 29):                      # square type bit 1 = darkness
            tile = 16
        if tile != 0:
            slot = v & 0xFFF
            while slot:
                rec = recs.get(slot)
                if rec is None:
                    break
                if _w(rec, 0) & 0x7FFF:
                    tile = _dispatch(sq, recs, rec, x, y, tile)
                slot = _w(rec, 0x12)
        sq[(y, x)] = (sq[(y, x)] & TILE_KEEP) + (tile << TILE_SHIFT)


def explore(squares, records, map_index, level=None):
    """Reveal from every walkable square, i.e. a fully explored automap."""
    sq = dict(squares[map_index])
    for (row, col), v in squares[map_index].items():
        if v & (1 << 28):
            continue
        if level is not None and ((v >> 16) & 0xF) != level:
            continue
        reveal_around(sq, records[map_index], col, row)
    return sq


def tiles_of(sq, level):
    """The tiles ShowAutomap would draw for `level`: matching level, seen."""
    out = {}
    for (row, col), v in sq.items():
        tile = (v >> TILE_SHIFT) & 0xFF
        if ((v >> 16) & 0xF) == level and tile != TILE_UNSEEN:
            out[(row, col)] = tile
    return out


def main(argv):
    squares, records = load_world()

    # The structural invariant that identifies the field in the first place.
    unseen = {(v & TILE_MASK) >> TILE_SHIFT
              for m in squares for v in m.values()}
    total = sum(len(m) for m in squares)
    assert unseen == {TILE_UNSEEN}, unseen
    print('bcdfs: bits 27-20 are 0x%02X on all %d squares of all %d maps '
          '(0 deviation)' % (TILE_UNSEEN, total, bcdfs.MAP_COUNT))

    if len(argv) == 3:
        m, level = int(argv[1]) - 1, int(argv[2])
        tiles = tiles_of(explore(squares, records, m, level), level)
        rows = [r for r, _ in tiles]
        cols = [c for _, c in tiles]
        print('\nmap %d level %d: rows %d..%d, cols %d..%d'
              % (m + 1, level, min(rows), max(rows), min(cols), max(cols)))
        for row in range(max(rows), min(rows) - 1, -1):     # row 0 at the foot
            print('%2d ' % row + ''.join(
                TILE_ASCII.get(tiles.get((row, col)), ' ')
                for col in range(min(cols), max(cols) + 1)))
        return

    counts = {}
    for m in range(bcdfs.MAP_COUNT):
        for tile in explore(squares, records, m).values():
            tile = (tile >> TILE_SHIFT) & 0xFF
            if tile != TILE_UNSEEN:
                counts[tile] = counts.get(tile, 0) + 1
    print('\ntile  name                      squares (all 13 maps, explored)')
    for tile in range(24):
        print('  %2d  %-24s  %6d' % (tile, TILE_NAMES[tile], counts.get(tile, 0)))


if __name__ == '__main__':
    main(sys.argv)

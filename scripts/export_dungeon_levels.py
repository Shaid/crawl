#!/usr/bin/env python3
"""Export Black Crypt's 13 `bcdfs` maps as a `@seer/dungeon` `DungeonLevelFile`.

Output: `public/assets/blackcrypt/amiga/dungeon/levels.json`, conforming to
`/home/ctemplet/Development/seer/packages/dungeon/src/schema/level.ts`
(read that file for the exact TypeScript shape — this script's field
mapping is documented below, not re-derived from guesswork).

## Load units and sub-levels

A `bcdfs` "map" is a **load unit**, not a dungeon level: 13 maps carry 28
levels between them, selected per-square by a 4-bit nibble (nibble 0 =
"belongs to no level"). See `docs/blackcrypt/amiga/data-structure.md`,
"Map <-> dungeon-level mapping" (confirmed, cross-checked against the
official Manual & Clue Book). `MAP_LEVELS` below is that table, transcribed.

## Densification

Each map's sparse `(row, col)` square dict is densified to a flat 64x64 grid
— `A4-0x37CA`, indexed `(row<<8)|(col<<2)` at runtime, i.e. exactly
`row*64+col` once the `<<2`/`<<8` byte strides are read as element indices.
Squares the on-disk row/col ranges never populate get a defensive fill
(`wallFlags=0xF`, `type=1` [wall], `sublevel=0`, `objectHandle=0`) — not
game data, a rendering-safety default so nothing ever composites art for a
cell the game itself never encodes. See the module docstring in
`scripts/bclib/bcdfs.py` (`read_dungeon_world`) for why this is a safe,
lossless reading of the on-disk format.

## Entity keys

`entities` is flat across the whole file (per the schema), keyed
`"<mapId>:<row>:<col>:<slot>"`. A raw on-disk "unique"/slot number is only
guaranteed distinct *within the same-square chain that names it* — map 4
alone has 4 slot numbers that collide across *different* squares elsewhere
in the same map (see `bcdfs.load_world`'s docstring, discovered empirically
this pass) — so scoping every key by its originating `(row, col)` as well as
`slot` is what keeps this collision-free. A consumer resolves a cell's chain
by combining its own `(row, col)` (which it always has, since it's querying
a specific cell) with the cell's `objectHandle` plane value, then follows
each record's `chainNext` with the same `(row, col)` prefix until it hits 0.

## EntityRecord field mapping

The schema's typed core (`type`, `gfx`, `wallMask`, `slotNibble`,
`chainNext`, `flags`) is generic across games, so this is this exporter's
own choice of which on-disk byte lands in which field, documented here
since nothing about it is imposed by the schema itself:

| Field | Source | Notes |
|---|---|---|
| `type` | monster marker (`raw[0]&0x80`) -> `0x80`; else `raw[5]` | `0x80` is a sentinel distinct from every real item/structure type byte (max `0x30`) |
| `gfx` | monster -> `raw[1]` (the graphics & sound-effects id); else big-endian word `raw[0:2]` | itemType/structureType records store `gfxNumber` as a word at `+0x00`; a monster's is a single byte at `+0x01` |
| `wallMask` | `raw[4]` | "position on square" bit flags for items (N=1/E=2/S=4/W=8), the identical bit convention for a door switch/lock's wall-direction mask; a monster's byte `+0x04` is a constant marker (`0xF0`), not a real mask, but is passed through unchanged for transparency |
| `slotNibble` | `raw[6]` | "position in container" for items (0-15); not meaningful for every type, passed through unchanged |
| `chainNext` | big-endian word `raw[0x12:0x14]` | the same-square chain pointer — present and meaningful in every record type |
| `flags` | big-endian word `raw[0x0E:0x10]` | type-dependent (door open/locked bits, busy counters, sub-kind payload...); always a real field, never padding |
| `raw` | every byte of the record, verbatim | 20 B, or 40/44 B for a monster (stat-continuation record, plus an optional 4-byte tail, appended in stream order — see `bcdfs.read_dungeon_world`) |

Usage:
    python3 scripts/export_dungeon_levels.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bclib import bcdfs, palette as bcpalette, paths

ROOT = Path(__file__).resolve().parents[1]
BCDFS_PATH = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'
S1_PATH = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
S2_PATH = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_s2_data.bin'

GRID_SIZE = 64

#: File stem for each of the 13 maps, 1-indexed by map number.
MAP_FILES = ['bcdfb', 'bcdfc', 'bcdfd', 'bcdfe', 'bcdff', 'bcdfg', 'bcdfh',
             'bcdfi', 'bcdfj', 'bcdfk', 'bcdfl', 'bcdfm', 'bcdfn']

#: Map -> the global dungeon levels (1-28) its nibbles 1..N name, in nibble
#: order. From data-structure.md, "Map <-> dungeon-level mapping"
#: (confirmed against the official Manual & Clue Book).
MAP_LEVELS = {
    1: [1, 2], 2: [3, 4, 5], 3: [6, 7, 8, 9], 4: [10, 11, 12], 5: [13],
    6: [14, 15], 7: [16, 17, 18, 19], 8: [20], 9: [21, 22], 10: [23],
    11: [24, 25, 26], 12: [27], 13: [28],
}
assert sum(len(v) for v in MAP_LEVELS.values()) == 28

#: Defensive fill for a densified cell the on-disk row/col ranges never
#: populate: walled off on every side, marked "wall" (type bit 0), belonging
#: to no sub-level, no object. Not game data -- see the module docstring.
FILL_WALL_FLAGS = 0xF
FILL_TYPE = 1
FILL_SUBLEVEL = 0
FILL_HANDLE = 0


def _u16(rec, off):
    return struct.unpack_from('>H', rec, off)[0]


def build_entity_record(rec):
    """Map a raw 20/40/44-byte record onto the schema's `EntityRecord` shape.
    See the module docstring's field-mapping table."""
    mon = bool(rec[0] & 0x80)
    return {
        'type': 0x80 if mon else rec[5],
        'gfx': rec[1] if mon else _u16(rec, 0x00),
        'wallMask': rec[4],
        'slotNibble': rec[6],
        'chainNext': _u16(rec, 0x12),
        'flags': _u16(rec, 0x0E),
        'raw': list(rec),
    }


def densify(squares):
    """One map's sparse `{(row, col): longword}` dict -> 5 flat 64x64 planes."""
    n = GRID_SIZE * GRID_SIZE
    wall_flags = [FILL_WALL_FLAGS] * n
    type_plane = [FILL_TYPE] * n
    sublevel = [FILL_SUBLEVEL] * n
    handle = [FILL_HANDLE] * n
    # Not a raw on-disk field -- a bookkeeping plane so a consumer (or a
    # test sampling real poses) can tell an actually-encoded square apart
    # from this densifier's own defensive fill, without having to infer it
    # from wallFlags/type values that could coincidentally match the fill.
    populated = [0] * n
    for (row, col), v in squares.items():
        if not (0 <= row < GRID_SIZE and 0 <= col < GRID_SIZE):
            raise ValueError(f'square ({row},{col}) outside the 64x64 grid')
        idx = row * GRID_SIZE + col
        wall_flags[idx] = (v >> 12) & 0xF
        type_plane[idx] = (v >> 28) & 0xF
        sublevel[idx] = (v >> 16) & 0xF
        handle[idx] = v & 0xFFF
        populated[idx] = 1
    return wall_flags, type_plane, sublevel, handle, populated


def build_units_and_entities(squares, entities, tileset_by_map, ramp_by_map):
    units = []
    all_entities = {}
    for m in range(bcdfs.MAP_COUNT):
        map_id = m + 1
        wall_flags, type_plane, sublevel, handle, populated = densify(squares[m])
        tileset = tileset_by_map.get(map_id)
        ramp = ramp_by_map.get(map_id)
        sublevels = [
            {'id': level, 'label': f'Level {level}', 'tileset': tileset, 'paletteRamp': ramp}
            for level in MAP_LEVELS[map_id]
        ]
        units.append({
            'id': map_id,
            'name': MAP_FILES[m],
            'planes': {
                'wallFlags': wall_flags,
                'type': type_plane,
                'sublevel': sublevel,
                'objectHandle': handle,
                'populated': populated,
            },
            'sublevelPlane': 'sublevel',
            'sublevels': sublevels,
            'tileset': tileset,
            'paletteRamp': ramp,
        })
        for row, col, slot, chain_next, rec in entities[m]:
            key = f'{map_id}:{row}:{col}:{slot}'
            record = build_entity_record(rec)
            # `chainNext` in the raw record is the same value already
            # threaded through by `read_dungeon_world`; keep them in sync
            # rather than trusting two derivations to agree by construction.
            assert record['chainNext'] == chain_next
            all_entities[key] = record
    return units, all_entities


def load_tileset_tables():
    """Per-map (1-13) tileset filename + accent-ramp index, straight off
    `bcdft`'s own tables (`bclib.palette.read_level_tileset_indices` /
    `read_level_ramp_indices`) — despite the "level" naming in those
    functions (inherited from the game's own code, whose `$1E5C(A4)`
    dispatch variable this pass confirmed is the *map* number 1-13, not
    a global dungeon-level 1-28: the range checks against 4 and 12 match
    the map file <-> tileset disk-layout table exactly, not the 28-level
    numbering). Returns `(tileset_by_map, ramp_by_map)`, or `({}, {})` if
    the decompressed bcdft caches aren't present.
    """
    if not (S1_PATH.exists() and S2_PATH.exists()):
        print(f'  WARNING: {S1_PATH} / {S2_PATH} not found -- '
              'tileset/paletteRamp fields will be omitted. Run '
              '`cd tools/bcdft_decompress && bash build.sh run` first.')
        return {}, {}
    s1, s2 = S1_PATH.read_bytes(), S2_PATH.read_bytes()
    tileset_idx = bcpalette.read_level_tileset_indices(s1)
    ramp_idx = bcpalette.read_level_ramp_indices(s2)
    tileset_by_map = {m + 1: bcpalette.TILESET_FILES[tileset_idx[m]] for m in range(13)}
    ramp_by_map = {m + 1: ramp_idx[m] for m in range(13)}
    return tileset_by_map, ramp_by_map


def main():
    if not BCDFS_PATH.exists():
        print(f'No {BCDFS_PATH} -- nothing to do')
        return

    raw = BCDFS_PATH.read_bytes()
    squares, entities = bcdfs.read_dungeon_world(raw)
    tileset_by_map, ramp_by_map = load_tileset_tables()
    units, all_entities = build_units_and_entities(squares, entities, tileset_by_map, ramp_by_map)

    doc = {
        'schemaVersion': 1,
        'game': 'blackcrypt',
        'platform': 'amiga',
        'cellSpace': {'kind': 'flat', 'width': GRID_SIZE, 'height': GRID_SIZE},
        'wallStorage': {'kind': 'bitflags', 'plane': 'wallFlags', 'bits': [1, 2, 4, 8]},
        'yAxisDown': False,
        'units': units,
        'entities': all_entities,
        'provenance': {
            'source': 'data/blackcrypt/amiga/bcdfs',
            'spec': 'docs/blackcrypt/amiga/data-structure.md#bcdfs--mapdungeon-format',
        },
    }

    # `dungeon/` is its own top-level asset category (sibling to
    # textures/sprites/data/...), matching M1's hand-authored
    # `dungeon/slots.json` -- not one of `paths.CATEGORIES`, so this writes
    # directly under the asset root rather than through `asset_dir`.
    out_path = paths.asset_root('blackcrypt', 'amiga') / 'dungeon' / 'levels.json'
    paths.write_json(out_path, doc, pretty=True)

    n_squares = sum(len(s) for s in squares)
    n_entities = len(all_entities)
    print(f'  dungeon/levels.json: {len(units)} units, {n_squares} on-disk '
          f'squares densified to {len(units) * GRID_SIZE * GRID_SIZE}, '
          f'{n_entities} entities')
    missing_tilesets = [u['id'] for u in units if u['tileset'] is None]
    if missing_tilesets:
        print(f'  WARNING: no tileset/paletteRamp for map(s) {missing_tilesets}')


if __name__ == '__main__':
    main()

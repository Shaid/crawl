"""
MM1 `WALLPIX.DTA` and `MONPIX.DTA` decoders.

Both files use the shared `.DTA` container + 2bpp RLE screen format from
`dta.py`. The per-entry colour remaps are hardcoded tables from ScummVM's
`engines/mm/mm1` (GPL, oracle):

  * WALLPIX — `maps/maps.cpp` `Maps::loadTile()`: 18 entries, each holding 12
    sequential frustum slices at fixed sizes, coloured by `TILE_COLORS[entry]`
    (`_indexes = [0, colors&0xf, colors>>4, 15]`).
  * MONPIX — `data/monsters.cpp` `Monsters::getMonsterImage()`: 76 entries,
    each one 104x96 image, coloured by `PALETTE[imgNum]`
    (`_indexes = [pal&0xf, pal>>4&0xf, pal>>8&0xf, pal>>12&0xf]`).

Monster names come from ScummVM's static `devtools/create_mm/files/mm1/
monsters.txt` (195 monsters, last field = `_imgNum`). All aquatic monsters
share imgNum 75, which decodes to a real MONPIX portrait (entry 75 — see
`dta.py`'s `DtaContainer` docstring for the container off-by-one that used
to make this entry look absent).
"""
from __future__ import annotations

from .dta import decode_screen, entry_payload, read_dta

# --- WALLPIX ---------------------------------------------------------------

TILE_WIDTHS = [32, 40, 24, 16, 32, 40, 24, 16, 176, 96, 48, 16]
TILE_HEIGHTS = [128, 96, 64, 32, 128, 96, 64, 32, 96, 64, 32, 16]

# maps.cpp TILE_COLORS: per-entry byte, low nibble = 2bpp value 1, high = 2.
TILE_COLORS = [
    0xE6, 0xE6, 0xE6, 0x72, 0x72, 0x72, 0x62, 0x62, 0x62,
    0x62, 0x62, 0xE1, 0x53, 0x53, 0xFF, 0x43, 0x43, 0x63,
]

# Vairn/MM2 doc 24 lane labels for the overland biomes (entry index + 1 =
# the wallNN sheet number); entries 0-5 and 14-17 are the indoor sets.
BIOME_LABELS: dict[int, str] = {
    6: 'trees', 7: 'mountains', 8: 'trees', 9: 'lava',
    10: 'swamp', 11: 'water', 12: 'thick forest', 13: 'mountains',
}

# maps.cpp TILE_AREAS: area id tables (used to map screen kind -> entry).
TILE_AREA1 = [0x10D, 0x0B0B, 0x50A, 0x11A, 0x0B18, 0x517]
TILE_AREA2 = [0xB0B, 0x50A, 0x10D, 0x0F08, 0x907, 0x11A, 0x0B18, 0x517]
TILE_AREA3 = [0xB0B, 0x10D, 0x517, 0x0B18, 0x11A, 0x50A]
TILE_AREAS = [TILE_AREA1, TILE_AREA2, TILE_AREA3]
TILE_OFFSET = [1, 7, 15]

# Slice roles within an entry (order of TILE_WIDTHS/TILE_HEIGHTS).
SLICE_ROLES = ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right',
               'front', 'front', 'front', 'front']


def wallpix_indexes(entry: int) -> list[int]:
    c = TILE_COLORS[entry]
    return [0, c & 0xF, (c >> 4) & 0xF, 15]


def decode_wallpix(path: str) -> dict:
    """Decode all 18 WALLPIX entries into per-slice CLUT8 index grids.

    Returns {"entries": [{entry, colors, biome, slices: [{w, h, pixels}]}]}
    after validating that every entry's payload is consumed with 0 remainder.
    """
    dta = read_dta(path)
    if dta.count != 18:
        raise ValueError(f"WALLPIX.DTA: expected 18 entries, got {dta.count}")
    out = []
    for ei, raw in enumerate(dta.entries()):
        body = entry_payload(raw)
        indexes = wallpix_indexes(ei)
        pos = 0
        slices = []
        for i in range(12):
            w, h = TILE_WIDTHS[i], TILE_HEIGHTS[i]
            px, used = decode_screen(body[pos:], w, h, indexes)
            pos += used
            slices.append({'w': w, 'h': h, 'pixels': px})
        if pos != len(body):
            raise ValueError(f"WALLPIX entry {ei}: {len(body) - pos} unconsumed bytes")
        out.append({
            'entry': ei,
            'colors': TILE_COLORS[ei],
            'indexes': indexes,
            'biome': BIOME_LABELS.get(ei),
            'slices': slices,
        })
    return {'file': 'WALLPIX.DTA', 'entries': out}


# --- MONPIX ----------------------------------------------------------------

MONPIX_W, MONPIX_H = 104, 96

# data/monsters.cpp PALETTE[76] — per-imgNum 4-colour remap (u16, four nibbles).
MONPIX_PALETTE = [
    0xF470, 0xF420, 0xFE20, 0xF630, 0xF420, 0xF620, 0xF460, 0xF6E0,
    0xF510, 0xFE40, 0xF420, 0xF410, 0xFD50, 0xFC90, 0xF430, 0xFC30,
    0xF770, 0xFC30, 0xF420, 0xF430, 0xF420, 0xF490, 0xF110, 0xF4E0,
    0xF430, 0xFD60, 0xF430, 0xFC20, 0xF2A0, 0xF470, 0xF4E0, 0xF250,
    0xF430, 0xF320, 0xFEE0, 0xF420, 0xF220, 0xF420, 0xFDD0, 0xF420,
    0xF620, 0xFC20, 0xFC10, 0xF520, 0xF420, 0xF220, 0xF420, 0xFA50,
    0xFE20, 0xF620, 0xF470, 0xF420, 0xFE10, 0xF4E0, 0xFE40, 0xF140,
    0xF290, 0xF410, 0xF520, 0xF410, 0xFC10, 0xF120, 0xF420, 0xFE10,
    0xF520, 0xF4A0, 0xFE60, 0xFE60, 0xF620, 0xF620, 0xFCE0, 0xF420,
    0xFC20, 0xFC20, 0xFD90, 0xF420,
]


def monpix_indexes(img_num: int) -> list[int]:
    pal = MONPIX_PALETTE[img_num]
    return [pal & 0xF, (pal >> 4) & 0xF, (pal >> 8) & 0xF, (pal >> 12) & 0xF]


def decode_monpix(path: str) -> dict:
    """Decode all 76 MONPIX entries into 104x96 CLUT8 grids (0 remainder)."""
    dta = read_dta(path)
    if dta.count != 76:
        raise ValueError(f"MONPIX.DTA: expected 76 entries, got {dta.count}")
    out = []
    for mi, raw in enumerate(dta.entries()):
        body = entry_payload(raw)
        indexes = monpix_indexes(mi)
        px, used = decode_screen(body, MONPIX_W, MONPIX_H, indexes)
        if used != len(body):
            raise ValueError(f"MONPIX entry {mi}: consumed {used} of {len(body)}")
        out.append({'img': mi, 'palette': MONPIX_PALETTE[mi], 'indexes': indexes, 'pixels': px})
    return {'file': 'MONPIX.DTA', 'width': MONPIX_W, 'height': MONPIX_H, 'images': out}

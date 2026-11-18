"""
MM1 (DOS) `.OVR` map-script overlay container.

Each of the 55 MAZEDATA screens has a companion `*.OVR` overlay (named by
the slug table, e.g. SORPIGAL.OVR). The overlay is the map's script: a
**compiled 8086 code segment** (not a custom bytecode) plus a **data
segment** holding the map's selection tables and its text strings.

Container (verified 55/55: `14 + code_sz + data_sz == file size`):

  +0x00 u16 entry offset into the code segment (242 in all 55 files)
  +0x02 u16 far-data constant (0xF48F in all 55 files)
  +0x04 u16 code_sz
  +0x06 u16 far-data constant (0xC940 in all 55 files; the code writes it
        as a far pointer, e.g. `MOV AX,0xC940` at code entry)
  +0x08 u16 data_sz
  +0x0A u16 0
  +0x0C u16 per-file value (candidate: overlay runtime load segment)
  +0x0E      code segment (code_sz bytes of position-bound 8086 code;
             the code references absolute game memory addresses such as
             0xC973 / 0x3C3A — the game's fixed data layout)
  +0x0E+code_sz  data segment (data_sz bytes):

     data[0]      byte  (map-type/flag; 1 town, 6 cave, 0x22 castle,
                         0x81 overland, 0x20 doom, 0x39 astral)
     data[1]      byte  WALLPIX area table (1-3, -> maps.cpp TILE_AREAS)
     data[2..7]   3x u16 wall/lane ids (near/mid/far frustum or horizon
                          lanes; resolved via TILE_AREAS/TILE_OFFSET)
     data[8..19]  4x 3-byte map EXITS N,E,S,W: (u16 LE map id, u8 section)
                  -- ScummVM Maps::step MAP_{NORTH,EAST,SOUTH,WEST}_EXIT_ID/
                  _SECTION (data offsets 8/10, 11/13, 14/16, 17/19). Resolved
                  by `resolve_exit` below. (An earlier "(x, y, kind) event
                  records" reading was wrong -- audit 2026-11-13.)
     data[20..]   more per-map tables, then the map's text strings
                  (null-separated, \r\n line breaks inside; the start of
                  the string region varies per file)

The selection fields above are cross-checked against ScummVM's
maps.cpp loadTile tables and Vairn/MM2's mm1_wallpix.py parse_ovr_data.
The full map-script semantics (what each code routine does with each
table) is open work — see docs/mm1/dosega/data-structure.md.
"""
from __future__ import annotations

import re
import struct
from pathlib import Path

HEADER_SIZE = 14
ENTRY_OFFSET = 0x00F2


# Map id of each of the 55 screens, in MAZEDATA order. Source: ScummVM
# engines/mm/mm1/maps/mapNN.h `Map(<idx>, "<slug>", <id>, ...)` constructors
# (the id is not stored in the OVR itself). Exits refer to maps by this id.
MAP_IDS = [
    0x604, 0xc03, 0x203, 0x802, 0xb1a, 0xa11, 0x001, 0xc01, 0x202, 0x005, 0x51b, 0x212, 0x601, 0xa00,
    0xf01, 0x502, 0xb02, 0x103, 0xa00, 0x703, 0x101, 0xd03, 0x304, 0xa11, 0x904, 0xf04, 0x505, 0xb05,
    0x106, 0x801, 0x112, 0x706, 0xb1a, 0x11b, 0x706, 0xf08, 0x508, 0xf03, 0x703, 0xf02, 0x702, 0xf04,
    0x704, 0xa11, 0x107, 0xf05, 0xa00, 0x705, 0x412, 0xb07, 0xf01, 0x701, 0xe00, 0x201, 0xb1a,
]
# ScummVM Maps::getIndex: search from LOOKUPS_START[section], first id match.
LOOKUPS_START = [0, 0, 14, 34]


def resolve_exit(map_id: int, section: int) -> int | None:
    """Screen index an exit leads to, or None if the id matches no map
    (pp1's exits, 0x010f, match nothing -- ScummVM would assert; treat as
    'stay on this screen')."""
    if section > 3:
        return None
    for k in range(LOOKUPS_START[section], len(MAP_IDS)):
        if MAP_IDS[k] == map_id:
            return k
    return None


class OvrOverlay:
    def __init__(self, data: bytes, slug: str | None = None):
        self.data = data
        self.slug = slug
        self.entry_off, self.far_a, self.code_sz, self.far_b, self.data_sz, self.far_c, self.load_seg = \
            struct.unpack_from('<7H', data, 0)
        self.code = data[HEADER_SIZE:HEADER_SIZE + self.code_sz]
        self.data_seg = data[HEADER_SIZE + self.code_sz:HEADER_SIZE + self.code_sz + self.data_sz]

    def check_size(self) -> bool:
        return HEADER_SIZE + self.code_sz + self.data_sz == len(self.data)

    def wall_fields(self) -> dict:
        d = self.data_seg
        return {
            'mapType': d[0],
            'areaTable': d[1],
            'lane1': d[2] | (d[3] << 8),
            'lane2': d[4] | (d[5] << 8),
            'lane3': d[6] | (d[7] << 8),
        }

    def exits(self) -> list[tuple[int, int]]:
        """Raw (map id, section) exits in N, E, S, W order."""
        d = self.data_seg
        return [(d[8 + i * 3] | (d[9 + i * 3] << 8), d[10 + i * 3]) for i in range(4)]

    def strings(self, min_len: int = 4) -> list[dict]:
        """Text strings from the data segment: split on nulls, \r\n = line breaks.

        The string region starts at the first long printable run; everything
        before it is tables. Returns [{offset, text}] with \r\n collapsed to
        '\n' for readability.
        """
        d = self.data_seg
        m = re.search(rb'[\x20-\x7e]{16,}', d)
        if not m:
            return []
        region = d[m.start():]
        out = []
        for chunk in region.split(b'\x00'):
            if len(chunk) < min_len:
                continue
            if not all(32 <= c < 127 for c in chunk):
                continue
            text = chunk.decode('ascii')
            text = text.replace('\r', '\n')
            out.append({'text': text})
        return out

    @property
    def string_region_start(self) -> int:
        m = re.search(rb'[\x20-\x7e]{16,}', self.data_seg)
        return m.start() if m else -1


def read_ovr(path: str | Path, slug: str | None = None) -> OvrOverlay:
    return OvrOverlay(Path(path).read_bytes(), slug)

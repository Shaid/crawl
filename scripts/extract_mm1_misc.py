#!/usr/bin/env python3
"""
Extract the remaining MM1 (DOS) misc data files to
`public/assets/mm1/dosega/`:

  ROSTER.DTA   -> data/roster.json       (18 starting characters, 127 B each)
  SCREEN0-9    -> screens/title-*.png    (10 title/menu screens, 320x200 EGA)
  MM.RSM       -> data/mm-rsm-symbols.json (overlay-loader symbol table)
  GACARD.DTA   -> documented (copy-protection card state byte; no decode)

Usage: python3 scripts/extract_mm1_misc.py [dataDir]

Layout sources (ScummVM engines/mm/mm1, GPL oracle):
  ROSTER: data/roster.cpp Roster::synchronize + data/character.cpp
          Character::synchronize (18 x 127 B records + 18 town bytes).
  SCREEN: views/title.cpp — ScreenDecoder at 320x200 with _indexes
          [0,2,4,15] (screen 2: [0,3,5,15]); files carry a u16LE size word.
  MM.RSM: not consumed by ScummVM; structure observed directly (name +
          4-byte address field) — see docs/mm1/dosega/data-structure.md.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from PIL import Image  # noqa: E402

from mm1lib.dta import EGA_RGB, decode_screen, entry_payload  # noqa: E402
from bclib.paths import write_manifest, write_platform_index  # noqa: E402

# --- ROSTER -----------------------------------------------------------------

ROSTER_COUNT = 18
RECORD_SIZE = 127
CHAR_BASE = 64  # 16 name + 5 + 8x2 attr + 2 age + 4 exp + 4 sp + 2 spelllevel + 2 gems + 6 hp + 3 gold + 2 ac + 2 food/cond

# ScummVM Roster::synchronize default portraits for the shipped starter party.
DEFAULT_PORTRAITS = [0, 11, 9, 7, 4, 3]

ATTR_NAMES = ['intelligence', 'might', 'personality', 'endurance', 'speed', 'accuracy', 'luck', 'level']
RESIST_NAMES = ['magic', 'fire', 'cold', 'electricity', 'acid', 'fear', 'poison', 'psychic']
CLASS_NAMES = {0: 'NONE', 1: 'Knight', 2: 'Paladin', 3: 'Archer', 4: 'Cleric', 5: 'Sorcerer', 6: 'Robber'}


def decode_roster(data: bytes) -> list[dict]:
    if len(data) != ROSTER_COUNT * RECORD_SIZE + ROSTER_COUNT:
        raise ValueError(f"ROSTER.DTA: expected {ROSTER_COUNT * RECORD_SIZE + ROSTER_COUNT} B, got {len(data)}")
    out = []
    for i in range(ROSTER_COUNT):
        r = data[i * RECORD_SIZE:(i + 1) * RECORD_SIZE]
        name = r[0:16].split(b'\0')[0].decode('ascii', 'replace')
        attrs = {ATTR_NAMES[k]: {'base': r[21 + k * 2], 'current': r[22 + k * 2]} for k in range(8)}
        resist = {RESIST_NAMES[k]: {'base': r[88 + k * 2], 'current': r[89 + k * 2]} for k in range(8)}
        gold = struct.unpack_from('<H', r, 57)[0] | (r[59] << 16)
        out.append({
            'index': i,
            'name': name,
            'sex': r[16],
            'alignmentInitial': r[17],
            'alignment': r[18],
            'race': r[19],
            'class': r[20],
            'className': CLASS_NAMES.get(r[20], f'class{r[20]}'),
            'attributes': attrs,
            'age': r[37],
            'ageDayCtr': r[38],
            'exp': struct.unpack_from('<I', r, 39)[0],
            'sp': {'current': struct.unpack_from('<H', r, 43)[0], 'base': struct.unpack_from('<H', r, 45)[0]},
            'spellLevel': {'base': r[47], 'current': r[48]},
            'gems': struct.unpack_from('<H', r, 49)[0],
            'hp': {'current': struct.unpack_from('<H', r, 51)[0],
                   'base': struct.unpack_from('<H', r, 53)[0],
                   'max': struct.unpack_from('<H', r, 55)[0]},
            'gold': gold,
            'ac': {'base': r[60], 'current': r[61]},
            'food': r[62],
            'condition': r[63],
            'equippedIds': list(r[64:70]),
            'backpackIds': list(r[70:76]),
            'equippedCharges': list(r[76:82]),
            'backpackCharges': list(r[82:88]),
            'resistances': resist,
            'physical': {'base': r[104], 'current': r[105]},
            'missile': {'base': r[106], 'current': r[107]},
            'trapCtr': r[108],
            'quest': r[109],
            'worthiness': r[110],
            'alignmentCtr': r[111],
            'flags': list(r[112:126]),
            'portrait': r[126],
        })
    return out


# --- SCREENS ----------------------------------------------------------------

def decode_screen_file(raw: bytes, indexes: list[int]) -> list[int]:
    """u16LE size word + ScreenDecoder RLE stream at 320x200; 0-remainder."""
    body = entry_payload(raw)
    px, used = decode_screen(body, 320, 200, indexes)
    if used != len(body):
        raise ValueError(f"screen: consumed {used} of {len(body)}")
    return px


# --- MM.RSM ----------------------------------------------------------------

def parse_rsm_symbols(data: bytes) -> list[dict]:
    """Overlay-loader symbol table: null-terminated name + 4-byte address
    field (`seg-byte, 0x28, u16LE offset`). See data-structure.md."""
    syms = []
    off = 0
    while off < len(data):
        end = data.find(b'\0', off)
        if end < 0:
            break
        raw = data[off:end]
        if len(raw) >= 3 and all(32 <= c < 127 for c in raw):
            addr = data[end + 1:end + 5]
            if len(addr) == 4:
                seg, _, off_lo, off_hi = addr
                syms.append({
                    'name': raw.decode('ascii'),
                    'offset': off,
                    'address': [seg, addr[1], off_lo, off_hi],
                    'farOffset': off_lo | (off_hi << 8),
                })
        off = end + 1
    return syms


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'mm1' / 'dosega'
    out = REPO / 'public' / 'assets' / 'mm1' / 'dosega'
    (out / 'data').mkdir(parents=True, exist_ok=True)
    (out / 'screens').mkdir(parents=True, exist_ok=True)

    # ---------- ROSTER ----------
    roster = decode_roster((data_dir / 'ROSTER.DTA').read_bytes())
    (out / 'data' / 'roster.json').write_text(json.dumps({
        'file': 'ROSTER.DTA',
        'recordSize': RECORD_SIZE,
        'towns': list((data_dir / 'ROSTER.DTA').read_bytes()[ROSTER_COUNT * RECORD_SIZE:]),
        'defaultPortraits': DEFAULT_PORTRAITS,
        'characters': roster,
    }, indent=2))
    print(f"  ROSTER: {len(roster)} characters, {RECORD_SIZE} B each + 18 town bytes")

    # ---------- SCREEN0-9 ----------
    for i in range(10):
        raw = (data_dir / f'SCREEN{i}').read_bytes()
        indexes = [0, 3, 5, 15] if i == 2 else [0, 2, 4, 15]
        px = decode_screen_file(raw, indexes)
        img = Image.new('RGB', (320, 200))
        img.putdata([EGA_RGB[v] for v in px])
        img.save(out / 'screens' / f'title-{i}.png')
    print('  SCREEN0-9: 10 title screens decoded (320x200, 0-remainder)')

    # ---------- MM.RSM ----------
    syms = parse_rsm_symbols((data_dir / 'MM.RSM').read_bytes())
    (out / 'data' / 'mm-rsm-symbols.json').write_text(json.dumps({
        'file': 'MM.RSM',
        'note': 'Overlay-loader symbol table (observed structure; see data-structure.md).',
        'symbols': syms,
    }, indent=2))
    print(f"  MM.RSM: {len(syms)} symbols (overlay loader table)")

    # ---------- GACARD ----------
    gacard = (data_dir / 'GACARD.DTA').read_bytes()
    print(f"  GACARD.DTA: {len(gacard)} byte(s) = {list(gacard)} (copy-protection card state)")

    # ---------- manifest ----------
    write_manifest([
        {'name': 'data/roster', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/roster.json'},
        {'name': 'data/mm-rsm-symbols', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/mm-rsm-symbols.json'},
    ], 'mm1', 'dosega')
    for i in range(10):
        write_manifest([{'name': f'screens/title-{i}', 'sprites': 0, 'hasPalette': False, 'png': f'screens/title-{i}.png'}], 'mm1', 'dosega')
    write_platform_index([{'game': 'mm1', 'platform': 'dosega'}])
    print('  manifest + platform index updated')


if __name__ == '__main__':
    main()

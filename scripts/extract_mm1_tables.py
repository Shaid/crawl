#!/usr/bin/env python3
"""
Extract MM1's items / monsters / spells tables to `public/assets/mm1/dosega/`.

Usage: python3 scripts/extract_mm1_tables.py [dataDir]

Both item and monster tables are embedded in MM.EXE (file offsets below);
spells have no binary table in MM1 (they are code + combat-effect strings) —
the spell lists come from ScummVM's transcription (`scripts/mm1lib/
mm1_spells.json`, sourced from its `strings_en.yml` + `spells_monsters.cpp`).

  ITEMS    MM.EXE +0x19B2A, 255 x 24 B
    [0..13] name (14 chars, uppercase, space-padded)
    [14] disablements, [15] constBonus_id, [16] constBonus_value,
    [17] tempBonus_id, [18] tempBonus_value/spellId, [19] maxCharges,
    [20..21] cost u16 BIG-endian, [22] damage, [23] AC_Dmg

  MONSTERS MM.EXE +0x1B312, 195 x 32 B
    [0..14] name (15 chars — the 15th byte holds the last letter for
    15-char names, else a space pad), [15] count, [16] fleeThreshold,
    [17] defaultHP, [18] defaultAC, [19] maxDamage, [20] attacks,
    [21] speed, [22..23] experience u16LE, [24] loot, [25] resistUndead,
    [26] resistances, [27] bonusOnTouch, [28] specialAbility,
    [29] specialThreshold, [30] counterFlags, [31] imgNum

Verified byte-exact against ScummVM's static items.txt (255/255) and
monsters.txt (195/195) on the GOG retail exe — see docs/mm1/dosega/
data-structure.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from bclib.paths import write_manifest, write_platform_index  # noqa: E402

ITEM_TABLE_OFF = 0x19B2A
ITEM_REC = 24
MON_TABLE_OFF = 0x1B312
MON_REC = 32
MON_NAME = 15

CLASS_NAMES = {0: 'none', 1: 'Knight', 2: 'Paladin', 3: 'Archer', 4: 'Cleric', 5: 'Sorcerer', 6: 'Robber'}


def item_category(item_id: int) -> str:
    if 1 <= item_id <= 60:
        return 'weapon'
    if 61 <= item_id <= 85:
        return 'missile'
    if 86 <= item_id <= 120:
        return 'two-handed'
    if 121 <= item_id <= 155:
        return 'armor'
    if 156 <= item_id <= 170:
        return 'shield'
    return 'special'


def decode_items(exe: bytes) -> list[dict]:
    items = []
    for i in range(255):
        off = ITEM_TABLE_OFF + i * ITEM_REC
        st = exe[off + 14:off + 24]
        items.append({
            'id': i + 1,
            'name': exe[off:off + 14].decode('ascii', 'replace').rstrip(),
            'category': item_category(i + 1),
            'disablements': st[0],
            'constBonusId': st[1],
            'constBonusValue': st[2],
            'tempBonusId': st[3],
            'tempBonusValue': st[4],          # = spellId when tempBonusId == 0xff
            'maxCharges': st[5],
            'cost': (st[6] << 8) | st[7],     # u16 BE
            'damage': st[8],
            'acDmg': st[9],
        })
    return items


def decode_monsters(exe: bytes) -> list[dict]:
    monsters = []
    for i in range(195):
        off = MON_TABLE_OFF + i * MON_REC
        st = exe[off + MON_NAME:off + MON_REC]
        monsters.append({
            'id': i + 1,
            'name': exe[off:off + MON_NAME].decode('ascii', 'replace').rstrip(),
            'count': st[0],
            'fleeThreshold': st[1],
            'defaultHP': st[2],
            'defaultAC': st[3],
            'maxDamage': st[4],
            'attacks': st[5],
            'speed': st[6],
            'experience': st[7] | (st[8] << 8),  # u16 LE
            'loot': st[9],
            'resistUndead': st[10],
            'resistances': st[11],
            'bonusOnTouch': st[12],
            'specialAbility': st[13],
            'specialThreshold': st[14],
            'counterFlags': st[15],
            'imgNum': st[16],
        })
    return monsters


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'mm1' / 'dosega'
    out = REPO / 'public' / 'assets' / 'mm1' / 'dosega'
    (out / 'data').mkdir(parents=True, exist_ok=True)

    exe = (data_dir / 'MM.EXE').read_bytes()
    if len(exe) < MON_TABLE_OFF + 195 * MON_REC:
        raise ValueError(f"MM.EXE too small ({len(exe)} B) — not the expected retail build")

    items = decode_items(exe)
    monsters = decode_monsters(exe)

    (out / 'data' / 'items.json').write_text(json.dumps({
        'file': 'MM.EXE', 'tableOffset': ITEM_TABLE_OFF, 'recordSize': ITEM_REC,
        'items': items,
    }, indent=2))
    (out / 'data' / 'monsters.json').write_text(json.dumps({
        'file': 'MM.EXE', 'tableOffset': MON_TABLE_OFF, 'recordSize': MON_REC,
        'monsters': monsters,
    }, indent=2))

    spells = json.loads((REPO / 'scripts' / 'mm1lib' / 'mm1_spells.json').read_text())
    (out / 'data' / 'spells.json').write_text(json.dumps({
        'note': spells['note'],
        'source': spells['source'],
        'cleric': [{'id': i, 'name': n} for i, n in enumerate(spells['cleric'])],
        'wizard': [{'id': i, 'name': n} for i, n in enumerate(spells['wizard'])],
        'monster': [{'id': i + 1, 'name': n} for i, n in enumerate(spells['monster'])],
    }, indent=2))

    print(f"  ITEMS:    {len(items)} records @ MM.EXE+0x{ITEM_TABLE_OFF:x} ({ITEM_REC} B each)")
    print(f"  MONSTERS: {len(monsters)} records @ MM.EXE+0x{MON_TABLE_OFF:x} ({MON_REC} B each)")
    print(f"  SPELLS:   {len(spells['cleric'])} cleric + {len(spells['wizard'])} wizard + "
          f"{len(spells['monster'])} monster (ScummVM transcription; no binary table)")

    write_manifest([
        {'name': 'data/items', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/items.json'},
        {'name': 'data/monsters', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/monsters.json'},
        {'name': 'data/spells', 'sprites': 0, 'hasPalette': False, 'png': '', 'kind': 'data', 'data': 'data/spells.json'},
    ], 'mm1', 'dosega')
    write_platform_index([{'game': 'mm1', 'platform': 'dosega'}])
    print('  manifest + platform index updated')


if __name__ == '__main__':
    main()

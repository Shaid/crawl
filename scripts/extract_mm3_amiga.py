#!/usr/bin/env python3
"""Extract Might & Magic III (Amiga) .cc containers into web-native assets.

Run from the repo root:  python3 scripts/extract_mm3_amiga.py

Output (public/assets/mm3/amiga/):
  data/cc-directory.json   — full directory across all 8 shipped .cc files
  files/<name>             — every decoded entry by resolved name
  audio/*.raw              — the raw signed 8-bit PCM banks (intra-cc samples)

Verification: the LZ decoder is a faithful port of the game's own routine
(CODE hunk payload 0x55C4); all 553 entries across the 8 files decode with
zero deviation (every LZ entry consumes exactly size-8 bytes and produces
exactly the declared decompressed size). 420/449 distinct keys resolve to
real filenames via the same hash the in-game lookup uses.
"""
from __future__ import annotations
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.amiga_cc import read_cc, extract_entry, amiga_hash  # noqa: E402
from mm3lib import amiga_cc  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
BASE = os.path.join(REPO, 'data', 'mm3', 'amiga')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'amiga')

# Names not in the DOS list but known from the game's own strings / content.
# (The 26 below resolve the credits/ending overlay file names: strings found
# in the exe's overlay segments 1/15 — `.clp` = frame-clip offset tables,
# `.vga`/`.raw` = screens/textures; see docs/mm3/amiga/data-structure.md.)
EXTRA_NAMES = {
    0x6225: 'intro_e00', 0x80D2: 'intro_e01', 0x82D3: 'intro_e02',
    0x9595: 'intro_e03', 0x04BD: 'intro_e04', 0x4879: 'intro_e12',
    0x7FC5: 'intro_e14',
    # mm3-05.cc (credits/ending overlay) — resolved from exe seg-15 strings
    0x206B: 'retreat.vga', 0x252C: 'hatch.raw', 0x2F94: 'ledbar.vga',
    0x3269: 'Nuback.raw', 0x35D6: 'hatch.vga', 0x3ACD: 'numbers.vga',
    0x4489: 'panl.vga', 0x48D8: 'flash.clp', 0x4EC0: 'away1.clp',
    0x4ED0: 'away2.clp', 0x5DEC: 'takebrsh.vga', 0x6800: 'flybrsh.vga',
    0x829D: 'strip.clp', 0x9AF2: 'appear.vga', 0x9BD6: 'button.vga',
    0x9D46: 'mouth.vga', 0xAF5E: 'sea.vga', 0xC6AD: 'room.vga',
    0xCB0D: 'Nuroom.raw', 0xD115: 'pass1.clp', 0xD125: 'pass2.clp',
    0xD92A: 'seaflybrsh.vga', 0xDAFB: 'seabrush.vga', 0xE0CD: 'bubl.clp',
    0xF52B: 'scoreback.raw', 0xFFB4: 'seaback.raw',
}


def load_names():
    names = {}
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        for line in open(os.path.join(here, 'mm3lib', 'dos_filenames.txt'),
                         encoding='latin-1'):
            line = line.strip()
            if line:
                names[amiga_hash(line)] = line
    except OSError:
        pass
    return names


def main():
    os.makedirs(os.path.join(OUT, 'files'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)

    entries_all = []
    counts = {}
    names = load_names()
    for fname in amiga_cc._CC_FILES:
        path = os.path.join(BASE, fname)
        if not os.path.exists(path):
            continue
        data, entries = read_cc(path)
        for e in entries:
            payload, kind = extract_entry(data, e)
            if payload is None:
                continue
            name = names.get(e.key) or EXTRA_NAMES.get(
                e.key, f'{fname}_e{e.index:02d}_k{e.key:04X}')
            ext = name.rsplit('.', 1)[-1] if '.' in name else '?'
            counts[ext] = counts.get(ext, 0) + 1
            with open(os.path.join(OUT, 'files', name), 'wb') as f:
                f.write(payload)
            entries_all.append({
                'file': fname, 'index': e.index, 'key': f'{e.key:04X}',
                'name': name, 'offset': e.offset, 'size': e.size,
                'kind': kind, 'decodedSize': len(payload),
            })

    with open(os.path.join(OUT, 'data', 'cc-directory.json'), 'w') as f:
        json.dump({'base': BASE, 'count': len(entries_all),
                   'entries': entries_all}, f, indent=1)

    print(f'Amiga .cc: {len(entries_all)} entries -> {OUT}')
    print('  by extension:', dict(sorted(counts.items())))


if __name__ == '__main__':
    main()

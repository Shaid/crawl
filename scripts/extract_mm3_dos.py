#!/usr/bin/env python3
"""Extract Might & Magic III (DOS/VGA) MM3.CC into web-native assets.

Run from the repo root:  python3 scripts/extract_mm3_dos.py

Output (public/assets/mm3/dosvga/):
  data/cc-directory.json   — full 558-entry container directory (hash, offset,
                             compressed size, kind, resolved name)
  data/monster-stats.json  — the per-stat .dat tables keyed by stat
  data/maze-text.json      — the .maz map-text entries (raw decoded)
  data/sprites.json        — per-sprite-file frame/cell layout (Xeen-style
                             sprite container: frame table + cell geometry)
  audio/*.wav              — the .s files (unsigned 8-bit PCM @ 8000 Hz)
  files/<name>             — every named entry, verbatim (raw bytes)

Verification: the LZHUF decoder is byte-exact against the reference C++
(rewolf-mm3-dumper) on all 556 compressed entries of the real MM3.CC.
"""
from __future__ import annotations
import json
import os
import re
import struct
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_cc import parse, extract_entry, hash_filename  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
DATA = os.path.join(REPO, 'data', 'mm3', 'dosvga')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'dosvga')

FILES = ['MM3.CC', 'MM3.EXE', 'MM3.CUR', 'MM3.CFG', 'MM3.$$$']


def load_names():
    names = {}
    try:
        for line in open(os.path.join(HERE, 'mm3lib', 'dos_filenames.txt'), encoding='latin-1'):
            line = line.strip()
            if line:
                names[hash_filename(line)] = line
    except OSError:
        pass
    return names


def main():
    os.makedirs(os.path.join(OUT, 'files'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'audio'), exist_ok=True)

    names = load_names()
    data = open(os.path.join(DATA, 'MM3.CC'), 'rb').read()
    entries, _ = parse(data)

    directory = []
    by_ext = {}
    for i, e in enumerate(entries):
        payload, kind = extract_entry(data, e)
        name = names.get(e.hash, f'_UNKNOWN_{e.hash:04X}')
        directory.append({
            'index': i, 'hash': f'{e.hash:04X}', 'name': name,
            'offset': e.offset, 'compressedSize': e.comp_size,
            'kind': kind, 'size': len(payload) if payload is not None else None,
        })
        if payload is None:
            continue
        ext = name.rsplit('.', 1)[-1] if '.' in name else '?'
        by_ext.setdefault(ext, []).append((name, payload))
        with open(os.path.join(OUT, 'files', name), 'wb') as f:
            f.write(payload)

    with open(os.path.join(OUT, 'data', 'cc-directory.json'), 'w') as f:
        json.dump({'file': 'MM3.CC', 'size': len(data), 'count': len(entries),
                   'entries': directory}, f, indent=1)

    # monster stats: one table per stat, values indexed by monster id
    stats = {}
    for name, payload in by_ext.get('dat', []):
        if name.startswith('Mon'):
            stat = name[3:-4]  # e.g. MonHP.dat -> HP
            stats[stat] = [int(b) for b in payload]
    with open(os.path.join(OUT, 'data', 'monster-stats.json'), 'w') as f:
        json.dump({'note': 'values are the raw per-stat table; monster id = index',
                   'tables': stats}, f, indent=1)

    # maze text (raw decoded byte strings)
    maze = {}
    for name, payload in by_ext.get('maz', []):
        maze[name] = payload.decode('latin-1', errors='replace')
    with open(os.path.join(OUT, 'data', 'maze-text.json'), 'w') as f:
        json.dump(maze, f, indent=1)

    # .s speech -> WAV (unsigned 8-bit PCM @ 8000 Hz)
    for name, payload in by_ext.get('s', []):
        w = wave.open(os.path.join(OUT, 'audio', name.replace('.s', '.wav')), 'wb')
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(payload)
        w.close()

    # Xeen-style sprite container census: frame table + cell geometry
    sprites = {}
    for name, payload in by_ext.get('mon', []) + by_ext.get('fac', []) \
            + by_ext.get('icn', []) + by_ext.get('vga', []) + by_ext.get('pic', []):
        if len(payload) < 6:
            continue
        count = struct.unpack_from('<H', payload, 0)[0]
        if count == 0 or 2 + count * 4 > len(payload) or count > 200:
            continue
        frames = []
        ok = True
        for f in range(count):
            c1, c2 = struct.unpack_from('<HH', payload, 2 + f * 4)
            if c1 >= len(payload) or c2 >= len(payload):
                ok = False
                break
            frames.append({'cell1': c1, 'cell2': c2})
        if not ok:
            continue
        sprites[name] = {'frames': count, 'frameTable': frames}
    with open(os.path.join(OUT, 'data', 'sprites.json'), 'w') as f:
        json.dump(sprites, f, indent=1)

    n = len(entries)
    print(f'MM3.CC: {n} entries -> {OUT}')
    print('  by extension:', {k: len(v) for k, v in sorted(by_ext.items())})
    print('  sprite-container files:', len(sprites))


if __name__ == '__main__':
    main()

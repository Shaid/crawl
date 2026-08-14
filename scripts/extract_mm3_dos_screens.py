#!/usr/bin/env python3
"""Render MM3 (DOS) `.raw` screens with the confirmed 256-colour palette.

Run from the repo root:  python3 scripts/extract_mm3_dos_screens.py

`.raw` = 64000 B = 320x200 raw 8-bit VGA (no palette in the file itself).
The palette is confirmed SOLVED, sourced from `MM3.CC` entry `vga` (the
game's own VGA display driver) -- see docs/mm3/dosvga/data-structure.md
"DOS 256-colour palette". There is exactly one palette (no per-screen
variants; the only runtime variation is fade brightness), so every `.raw`
file uses the same table.

Output (public/assets/mm3/dosvga/):
  palettes/dos-vga.json     — the 256-colour palette (6-bit source values
                              + 8-bit scaled RGB)
  screens/<name>.png        — every `.raw` file, rendered
  data/dos-screens.json     — index of rendered screens
  manifest.json             — merged (upsert by name)
"""
from __future__ import annotations
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_cc import parse, extract_entry, hash_filename  # noqa: E402
from mm3lib.dos_palette import load_dos_palette, scale_6_to_8  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
DATA = os.path.join(REPO, 'data', 'mm3', 'dosvga')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'dosvga')

SCREEN_W, SCREEN_H = 320, 200
RAW_SIZE = SCREEN_W * SCREEN_H


def write_png(path: str, rgb: bytes, w: int, h: int) -> None:
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


def load_names() -> dict[int, str]:
    names = {}
    try:
        for line in open(os.path.join(HERE, 'mm3lib', 'dos_filenames.txt'), encoding='latin-1'):
            line = line.strip()
            if line:
                names[hash_filename(line)] = line
    except OSError:
        pass
    return names


def merge_manifest(entries: list[dict]) -> None:
    path = os.path.join(OUT, 'manifest.json')
    by_name = {}
    if os.path.exists(path):
        try:
            for e in json.load(open(path)):
                by_name[e['name']] = e
        except Exception:
            pass
    for e in entries:
        by_name[e['name']] = e
    json.dump(sorted(by_name.values(), key=lambda e: e['name']),
              open(path, 'w'), indent=1)


def main() -> None:
    os.makedirs(os.path.join(OUT, 'palettes'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'screens'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)

    names = load_names()
    cc_data = open(os.path.join(DATA, 'MM3.CC'), 'rb').read()
    entries, _ = parse(cc_data)

    pal_6bit = load_dos_palette(cc_data, entries)
    rgb = [(scale_6_to_8(r), scale_6_to_8(g), scale_6_to_8(b)) for r, g, b in pal_6bit]
    pal_colors = [{'index': i, 'value6bit': list(c6), 'rgb': list(c8)}
                  for i, (c6, c8) in enumerate(zip(pal_6bit, rgb))]
    json.dump({'source': 'MM3.CC entry hash 0x8F99 (vga driver) offset 0x39C',
               'colors': pal_colors},
              open(os.path.join(OUT, 'palettes', 'dos-vga.json'), 'w'), indent=1)

    screen_meta = []
    manifest_entries = [{
        'name': 'palettes/dos-vga', 'sprites': 0, 'hasPalette': False,
        'png': '', 'kind': 'data', 'data': 'palettes/dos-vga.json',
    }]
    for e in entries:
        name = names.get(e.hash)
        if not name or not name.lower().endswith('.raw'):
            continue
        payload, kind = extract_entry(cc_data, e)
        if payload is None or len(payload) != RAW_SIZE:
            continue
        out = bytearray(RAW_SIZE * 3)
        for i, idx in enumerate(payload):
            r, g, b = rgb[idx]
            o = i * 3
            out[o] = r; out[o + 1] = g; out[o + 2] = b
        write_png(os.path.join(OUT, 'screens', f'{name}.png'), bytes(out), SCREEN_W, SCREEN_H)
        json.dump({'frames': [{'name': name, 'x': 0, 'y': 0, 'w': SCREEN_W, 'h': SCREEN_H}],
                   'width': SCREEN_W, 'height': SCREEN_H},
                  open(os.path.join(OUT, 'screens', f'{name}.json'), 'w'), indent=1)
        screen_meta.append({'name': name, 'size': len(payload)})
        manifest_entries.append({
            'name': f'screens/{name}', 'sprites': 1, 'hasPalette': True,
            'png': f'screens/{name}.png', 'kind': 'atlas',
            'atlas': f'screens/{name}.json', 'palette': 'palettes/dos-vga.json',
        })

    json.dump(screen_meta, open(os.path.join(OUT, 'data', 'dos-screens.json'), 'w'), indent=1)
    manifest_entries.append({
        'name': 'data/dos-screens', 'sprites': 0, 'hasPalette': False, 'png': '',
        'kind': 'data', 'data': 'data/dos-screens.json',
    })
    merge_manifest(manifest_entries)
    print(f'DOS screens rendered: {len(screen_meta)}')


if __name__ == '__main__':
    main()

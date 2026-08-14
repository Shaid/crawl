#!/usr/bin/env python3
"""Extract MM3 (Amiga) screen palettes + render the 320x200 5-plane screens.

The primary game palette is statically confirmed in BOTH executables:
  - `Might&MagicIII` DATA hunk payload +0x4A62  (32 words, 0RGB)
  - `MM3-Intro`        DATA hunk payload +0x0FB6 (32 words, byte-identical)
Both are copied word-for-word (32x move.w) into the runtime palette table at
`A4-0x12DC` at boot, and LoadRGB4 (jsr -0xC0(a6)) installs that table as the
screen colours. See docs/mm3/amiga/data-structure.md "Palette".

The main exe DATA hunk also holds 5 credits/ending palettes at
+0x48E0/+0x4920/+0x4960/+0x49A0/+0x49E0 (64-byte stride = 32 words apart),
used by overlay segment 15; the intro holds 3 more intro-specific palettes
at +0x0EC2/+0x0F02/+0x0F42.

Screens: 40000-byte payloads across the 8 .cc files are 320x200 5-plane
planar (5 x 8000 B, bit 7 = leftmost pixel), rendered with the game palette.

Run from the repo root:  python3 scripts/extract_mm3_amiga_screens.py

Output (public/assets/mm3/amiga/):
  palettes/game.json + palettes/credits-0..4.json + palettes/intro-0..3.json
  screens/<name>.png            — every 40000-B payload, rendered
  sprites/game-palette.png      — the 32-colour palette swatch strip
  data/screens.json             — index of rendered screens
  manifest.json                 — merged (upsert by name)
"""
from __future__ import annotations
import json
import os
import struct
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.amiga_cc import read_cc, extract_entry, amiga_hash, _CC_FILES  # noqa: E402

def write_png(path: str, rgb: bytes, w: int, h: int):
    """Minimal RGB8 PNG writer (same shape as the sprite extractor's)."""
    import struct as _s
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return _s.pack('>I', len(data)) + c + _s.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', _s.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


REPO = os.path.abspath(os.path.join(HERE, '..'))
BASE = os.path.join(REPO, 'data', 'mm3', 'amiga')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'amiga')

EXE = os.path.join(BASE, 'Might&MagicIII')
INTRO = os.path.join(BASE, 'MM3-Intro')

MAIN_PALETTES = {  # DATA payload offset -> name
    0x4A62: 'game',
    0x48E0: 'credits-0', 0x4920: 'credits-1', 0x4960: 'credits-2',
    0x49A0: 'credits-3', 0x49E0: 'credits-4',
}
INTRO_PALETTES = {0x0EC2: 'intro-0', 0x0F02: 'intro-1', 0x0F42: 'intro-2', 0x0FB6: 'intro-3'}

SCREEN_W, SCREEN_H = 320, 200


def read_data_hunk(path: str) -> bytes:
    """Return the first HUNK_DATA payload of an Amiga hunk executable."""
    from amitools.binfmt.hunk.HunkReader import HunkReader
    r = HunkReader()
    r.read_file(path)
    for h in r.hunks:
        if h.get('type_name') == 'HUNK_DATA':
            return h['data']
    raise ValueError(f'no DATA hunk in {path}')


def rgb24(w: int) -> list:
    return [((w >> 8) & 0xF) * 17, ((w >> 4) & 0xF) * 17, (w & 0xF) * 17]


def read_palette_words(data: bytes, off: int, count: int = 32) -> list:
    return [struct.unpack_from('>H', data, off + i * 2)[0] for i in range(count)]


def render_screen(dec: bytes, pal_rgb: list) -> bytes:
    """5-plane 320x200 planar -> raw RGB bytes."""
    planes = [dec[i * 8000:(i + 1) * 8000] for i in range(5)]
    out = bytearray(SCREEN_W * SCREEN_H * 3)
    for y in range(SCREEN_H):
        for x in range(SCREEN_W):
            b = y * 40 + x // 8
            bit = 7 - (x % 8)
            idx = 0
            for p in range(5):
                if planes[p][b] & (1 << bit):
                    idx |= (1 << p)
            r, g, bl = pal_rgb[idx]
            o = (y * SCREEN_W + x) * 3
            out[o] = r; out[o + 1] = g; out[o + 2] = bl
    return bytes(out)


def merge_manifest(entries: list):
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


def main():
    os.makedirs(os.path.join(OUT, 'palettes'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'screens'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)

    main_data = read_data_hunk(EXE)
    intro_data = read_data_hunk(INTRO)

    # write all palettes
    pal_entries = []
    for off, name in MAIN_PALETTES.items():
        ws = read_palette_words(main_data, off)
        colors = [{'index': i, 'value': f'{w:04X}', 'rgb': rgb24(w)} for i, w in enumerate(ws)]
        json.dump({'colors': colors}, open(os.path.join(OUT, 'palettes', f'{name}.json'), 'w'), indent=1)
        pal_entries.append({
            'name': f'palettes/{name}', 'sprites': 0, 'hasPalette': False,
            'png': '', 'kind': 'data', 'data': f'palettes/{name}.json',
        })
    for off, name in INTRO_PALETTES.items():
        ws = read_palette_words(intro_data, off)
        colors = [{'index': i, 'value': f'{w:04X}', 'rgb': rgb24(w)} for i, w in enumerate(ws)]
        json.dump({'colors': colors}, open(os.path.join(OUT, 'palettes', f'{name}.json'), 'w'), indent=1)
        pal_entries.append({
            'name': f'palettes/{name}', 'sprites': 0, 'hasPalette': False,
            'png': '', 'kind': 'data', 'data': f'palettes/{name}.json',
        })

    # sanity: the game palette must match the intro's identical copy
    game_ws = read_palette_words(main_data, 0x4A62)
    intro_game_ws = read_palette_words(intro_data, 0x0FB6)
    assert game_ws == intro_game_ws, 'game palette mismatch between executables!'

    # swatch strip for the game palette
    rgb = [rgb24(w) for w in game_ws]
    sw = 32 * 16
    strip = bytearray(sw * 16 * 3)
    for i in range(32):
        r, g, b = rgb[i]
        for yy in range(16):
            for xx in range(16):
                o = ((yy * sw) + (i * 16 + xx)) * 3
                strip[o] = r; strip[o + 1] = g; strip[o + 2] = b
    write_png(os.path.join(OUT, 'sprites', 'game-palette.png'), bytes(strip), sw, 16)

    # render every 40000-B screen with the palette its display code installs
    names = {}
    try:
        for line in open(os.path.join(HERE, 'mm3lib', 'dos_filenames.txt'), encoding='latin-1'):
            line = line.strip()
            if line:
                names[amiga_hash(line)] = line
    except OSError:
        pass

    # Palette per screen. Named screens (control/create/back/stars/computer/
    # front/take.raw) are in-game UI screens -> game palette (confirmed).
    # intro.cc unnamed 40000-B entries are the intro screens; the intro exe
    # installs intro-0 then intro-1 immediately before its first two screen
    # displays (code1+0x3CF6 -> 0x3DC6, +0x3E10 -> 0x3E00), and the screens
    # load in file order -> e1=intro-0, e2=intro-1 (confirmed mapping).
    # mm3-05.cc unnamed 40000-B entries are ending screens; best-fit credits
    # palette by smoothness heuristic (HYPOTHESIS, see data-structure.md).
    screen_palettes = {
        'intro.cc_e1': 'intro-0', 'intro.cc_e2': 'intro-1',
        'mm3-05.cc_e2': 'credits-1', 'mm3-05.cc_e16': 'credits-0',
        'mm3-05.cc_e22': 'credits-0', 'mm3-05.cc_e28': 'credits-3',
    }
    pal_rgbs = {'game': rgb}
    for off, nm in MAIN_PALETTES.items():
        if nm != 'game':
            pal_rgbs[nm] = [rgb24(w) for w in read_palette_words(main_data, off)]
    for off, nm in INTRO_PALETTES.items():
        pal_rgbs[nm] = [rgb24(w) for w in read_palette_words(intro_data, off)]

    screen_meta = []
    screen_entries = []
    for f in _CC_FILES:
        path = os.path.join(BASE, f)
        if not os.path.exists(path):
            continue
        data, ents = read_cc(path)
        for e in ents:
            dec, _ = extract_entry(data, e)
            if not dec or len(dec) != 40000:
                continue
            name = names.get(e.key, f'{f}_e{e.index}')
            pal_name = screen_palettes.get(name, 'game')
            raw = render_screen(dec, pal_rgbs[pal_name])
            png = os.path.join(OUT, 'screens', f'{name}.png')
            write_png(png, raw, SCREEN_W, SCREEN_H)
            # index usage
            c = Counter()
            planes = [dec[i * 8000:(i + 1) * 8000] for i in range(5)]
            for y in range(SCREEN_H):
                for x in range(SCREEN_W):
                    b = y * 40 + x // 8; bit = 7 - (x % 8)
                    idx = 0
                    for p in range(5):
                        if planes[p][b] & (1 << bit):
                            idx |= (1 << p)
                    c[idx] += 1
            screen_meta.append({
                'name': name, 'file': f, 'index': e.index,
                'size': len(dec), 'usedIndices': sorted(c.keys()),
                'dominant': c.most_common(1)[0][0],
                'palette': pal_name,
            })
            screen_entries.append({
                'name': f'screens/{name}', 'sprites': 1, 'hasPalette': True,
                'png': f'screens/{name}.png', 'kind': 'atlas',
                'atlas': f'screens/{name}.json',
                'palette': f'palettes/{pal_name}.json',
            })
            json.dump({'frames': [{'name': f'{name}', 'x': 0, 'y': 0,
                                   'w': SCREEN_W, 'h': SCREEN_H}],
                       'width': SCREEN_W, 'height': SCREEN_H},
                      open(os.path.join(OUT, 'screens', f'{name}.json'), 'w'), indent=1)

    json.dump(screen_meta, open(os.path.join(OUT, 'data', 'screens.json'), 'w'), indent=1)
    screen_entries.append({
        'name': 'data/screens', 'sprites': 0, 'hasPalette': False, 'png': '',
        'kind': 'data', 'data': 'data/screens.json',
    })

    merge_manifest(pal_entries + screen_entries)
    print(f'  palettes: {len(MAIN_PALETTES) + len(INTRO_PALETTES)}'
          f' (game palette cross-exe verified identical)')
    print(f'  screens rendered: {len(screen_meta)}')


if __name__ == '__main__':
    main()

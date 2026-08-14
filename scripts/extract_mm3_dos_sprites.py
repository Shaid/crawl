#!/usr/bin/env python3
"""Extract MM3 (DOS) sprite-container files to PNG atlases + JSON sidecars.

Run from the repo root:  python3 scripts/extract_mm3_dos_sprites.py

Format: see docs/mm3/dosvga/data-structure.md "Sprite container" +
"Scanline opcode grammar" (SOLVED -- decoder ported instruction-for-
instruction from the game's own blitter in `scripts/mm3lib/dos_sprite.py`).
Covers `.vga/.mon/.fac/.icn/.pic/.out/.til/.brd/.sky` (`.spl` is a
different, still-open format -- not included here).

Rendered with the confirmed 256-colour DOS palette (MM3.CC entry `vga`,
see docs/mm3/dosvga/data-structure.md "DOS 256-colour palette"), read from
`build/cache/mm3/palette/mm3_dos_palette.json`.

Output (public/assets/mm3/dosvga/):
  sprites/<subdir>/<name>.png   — per-file composed frame strip (subdir by
                                  extension: monsters/faces/icons/pics/outs/
                                  walls/tiles/boards/skies)
  sprites/<subdir>/<name>.json  — frame table + per-frame raw pixel indices
                                  (base64) alongside the atlas rects
  data/dos-sprite-catalog.json  — full inventory
  manifest.json                 — merged (upsert by name)
"""
from __future__ import annotations
import base64
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_cc import parse, extract_entry, hash_filename  # noqa: E402
from mm3lib.dos_sprite import is_sprite_container, decode_frames, TRANSPARENT  # noqa: E402
from mm3lib.dos_palette import load_dos_palette, scale_6_to_8  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
DATA = os.path.join(REPO, 'data', 'mm3', 'dosvga')
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'dosvga')

# `.spl` is excluded -- confirmed NOT the sprite container (see TODO mm3-mon-rle).
SPRITE_EXTS = ('.vga', '.mon', '.fac', '.icn', '.pic', '.out', '.til', '.brd', '.sky')

SUBDIR = {
    'mon': 'monsters', 'fac': 'faces', 'icn': 'icons', 'pic': 'pics',
    'out': 'outs', 'vga': 'walls', 'til': 'tiles', 'brd': 'boards', 'sky': 'skies',
}


def write_png(path: str, rgba: bytes, w: int, h: int) -> None:
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


def canvas_to_rgba(canvas: list[list[int]], palette: list[tuple[int, int, int]]) -> tuple[bytes, int, int]:
    h = len(canvas)
    w = len(canvas[0]) if h else 0
    out = bytearray(w * h * 4)
    for y in range(h):
        row = canvas[y]
        for x in range(w):
            idx = row[x]
            if idx == TRANSPARENT:
                continue
            r, g, b = palette[idx]
            o = (y * w + x) * 4
            out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255
    return bytes(out), w, h


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
    names = load_names()
    cc_data = open(os.path.join(DATA, 'MM3.CC'), 'rb').read()
    entries, _ = parse(cc_data)
    palette = [(scale_6_to_8(r), scale_6_to_8(g), scale_6_to_8(b))
               for r, g, b in load_dos_palette(cc_data, entries)]

    counts: dict[str, int] = {}
    catalog: list[dict] = []
    manifest_entries: list[dict] = []

    for e in entries:
        name = names.get(e.hash)
        if not name or not name.lower().endswith(SPRITE_EXTS):
            continue
        payload, kind = extract_entry(cc_data, e)
        if payload is None or not is_sprite_container(payload):
            continue
        try:
            frames, cw, ch = decode_frames(payload)
        except Exception:
            continue
        if not frames or cw <= 0 or ch <= 0:
            continue

        # Dedupe identical frames -- the frame table can point multiple
        # indices at the same cell pair (idle holds), same convention as
        # the Amiga sprite extractor.
        seen = set()
        uniq = []
        for fr in frames:
            key = tuple(tuple(row) for row in fr)
            if key not in seen:
                seen.add(key)
                uniq.append(fr)

        ext = name.rsplit('.', 1)[-1].lower()
        sub = SUBDIR[ext]
        d = os.path.join(OUT, 'sprites', sub)
        strip = bytearray(len(uniq) * cw * ch * 4)
        raw_frames = []
        for k, fr in enumerate(uniq):
            rgba, w, h = canvas_to_rgba(fr, palette)
            for y in range(h):
                src = y * w * 4
                dst = (y * cw * len(uniq) + k * cw) * 4
                strip[dst:dst + w * 4] = rgba[src:src + w * 4]
            flat = bytes((v & 0xFF) for row in fr for v in row)
            raw_frames.append({'index': k, 'indices': base64.b64encode(flat).decode()})
        write_png(os.path.join(d, f'{name}.png'), bytes(strip), cw * len(uniq), ch)
        atlas_frames = [{'name': f'{name}.frame{k}', 'x': k * cw, 'y': 0, 'w': cw, 'h': ch}
                         for k in range(len(uniq))]
        json.dump({
            'source': name, 'palette': 'dos-vga',
            'width': cw * len(uniq), 'height': ch,
            'frames': atlas_frames, 'frameCount': len(uniq),
            'rawFrames': raw_frames,
        }, open(os.path.join(d, f'{name}.json'), 'w'))
        catalog.append({'name': name, 'kind': ext, 'frames': len(uniq), 'size': f'{cw}x{ch}'})
        counts[ext] = counts.get(ext, 0) + 1
        manifest_entries.append({
            'name': f'sprites/{sub}/{name}', 'sprites': len(uniq),
            'hasPalette': False, 'png': f'sprites/{sub}/{name}.png',
        })

    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
    json.dump({'counts': counts, 'assets': catalog},
              open(os.path.join(OUT, 'data', 'dos-sprite-catalog.json'), 'w'), indent=1)
    manifest_entries.append({
        'name': 'data/dos-sprite-catalog', 'sprites': 0, 'hasPalette': False,
        'png': '', 'kind': 'data', 'data': 'data/dos-sprite-catalog.json',
    })
    merge_manifest(manifest_entries)
    print('DOS sprites extracted:', counts)


if __name__ == '__main__':
    main()

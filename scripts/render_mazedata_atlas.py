#!/usr/bin/env python3
"""Render Wizardry 6's `mazedata.ega` art bank as a **labelled wall atlas**:
every one of the 153 directory records decoded to colour and laid out on a
grid, each labelled with its `dir` index, dimensions, and a semantic tag
derived from how the compose-list uses it (front wall, side wall, ceiling,
floor, far wall/doorway, door leaf, upper strip, UI icon, ...).

Output: `build/cache/wizardry6/mazedata-labelled.png` (not a web asset).

Usage: python3 scripts/render_mazedata_atlas.py
"""
import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'wizardry6' / 'amiga' / 'mazedata.ega'
PALETTE = ROOT / 'public' / 'assets' / 'wizardry6' / 'amiga' / 'palettes' / 'mazedata.json'
OUT = ROOT / 'build' / 'cache' / 'wizardry6' / 'mazedata-labelled.png'

COLS = 6
CELL_W, CELL_H = 132, 168
FRAME_W, FRAME_H = 124, 124
LABEL_H = CELL_H - FRAME_H


def parse_ega(data: bytes):
    dir_count = struct.unpack_from('>H', data, 0)[0]
    sub_count = struct.unpack_from('>H', data, 2)[0]
    dirs = []
    off = 4
    for i in range(dir_count):
        (offset,) = struct.unpack_from('>I', data, off)
        wu, h = data[off + 4], data[off + 5]
        dirs.append({'index': i, 'offset': offset, 'w': wu * 8, 'h': h})
        off += 6
    comp = []
    for i in range(sub_count):
        comp.append({'index': i, 'dir': data[off], 'x': data[off + 1], 'y': data[off + 2],
                     'clip': data[off + 3], 'w': data[off + 4]})
        off += 5
    return dirs, comp


def decode_dir(data: bytes, rec, palette):
    w, h, off = rec['w'], rec['h'], rec['offset']
    bpr = (w + 7) // 8
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for p in range(4):
        base = off + p * bpr * h
        for y in range(h):
            row = base + y * bpr
            for x in range(w):
                byte = data[row + (x >> 3)]
                if (byte >> (7 - (x & 7))) & 1:
                    r, g, b = palette[1 << p][0:3]
                    cur = px[x, y]
                    px[x, y] = (cur[0] | r, cur[1] | g, cur[2] | b, 255)
    return img


def semantic(rec, comp_of_dir):
    """Label a dir record by how the compose-list references it."""
    idx = rec['index']
    refs = comp_of_dir.get(idx, [])
    labels = set()
    for r in refs:
        # static-corridor / front-wall runs reference the dir; tag by the
        # canonical run families confirmed in the docs.
        if r['index'] in range(0, 3) or r['index'] in range(3, 15):
            labels.add('front wall')
        if r['index'] in range(16, 23):
            labels.add('side wall')
        if r['index'] in range(25, 35):
            labels.add('far wall/door')
        if r['index'] in range(122, 126):
            labels.add('ceiling/front-upper')
        if r['index'] in range(130, 146):
            labels.add('side upper')
        if r['index'] in range(151, 154):
            labels.add('floor')
        if r['index'] in range(178, 181):
            labels.add('door leaf')
    if not labels:
        if idx >= 133:
            labels.add('UI icon')
        else:
            labels.add('?')
    return '/'.join(sorted(labels))


def main():
    if not DATA.exists():
        sys.exit(f'no {DATA} -- place real W6 data first')
    data = DATA.read_bytes()
    dirs, comp = parse_ega(data)
    pal = [(c['r'], c['g'], c['b'], 255) for c in json.loads(PALETTE.read_text())['colors']]
    pal += [(0, 0, 0, 255)] * (16 - len(pal))

    comp_of_dir = {}
    for r in comp:
        comp_of_dir.setdefault(r['dir'], []).append(r)

    n = len(dirs)
    rows = (n + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL_W, rows * CELL_H), (28, 28, 32, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSansCondensed.ttf', 10)
        font_b = ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSansCondensed-Bold.ttf', 10)
    except OSError:
        font = font_b = ImageFont.load_default()

    for i, rec in enumerate(dirs):
        col = i % COLS
        row = i // COLS
        ox = col * CELL_W
        oy = row * CELL_H
        draw.rectangle([ox, oy, ox + CELL_W - 1, oy + CELL_H - 1], outline=(60, 60, 68))
        img = decode_dir(data, rec, pal)
        img.thumbnail((FRAME_W, FRAME_H), Image.LANCZOS)
        ix = ox + (FRAME_W - img.width) // 2
        iy = oy + (FRAME_H - img.height) // 2
        sheet.paste(img, (ix, iy), img)
        tag = semantic(rec, comp_of_dir)
        draw.text((ox + 4, oy + FRAME_H + 1), f"dir {rec['index']:03d} {rec['w']}x{rec['h']}", font=font_b, fill=(255, 255, 255))
        draw.text((ox + 4, oy + FRAME_H + 13), tag, font=font, fill=(180, 200, 220))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert('RGB').save(OUT)
    print(f'Wrote {OUT} ({COLS}x{rows} cells, {n} frames)')


if __name__ == '__main__':
    main()

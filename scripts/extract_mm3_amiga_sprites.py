#!/usr/bin/env python3
"""Extract MM3 (Amiga) sprite files to PNG atlases + JSON sidecars.

Run from the repo root:  python3 scripts/extract_mm3_amiga_sprites.py

Format (see docs/mm3/amiga/data-structure.md "Amiga sprite cells"):
  u16 BE frameCount + frameCount × {u32 BE cellA, u32 BE cellB}
  cell = {u16 x, u16 y, u16 w, u16 h} + body.

Body format is EXTENSION-INDEPENDENT — record stream, CONFIRMED byte-exact
corpus-wide (1811/1811 frames across .mon/.fac/.icn/.pic/.out):
  [count u16][count × u16]    literal run
  [marker u16]                skip (~marker)&0xffff words (0xfffe→1, 0xfffd→2,
                              0xfffb→4, 0xfff7→8); 0xffff = terminator
decodes to exactly 6·w·ceil(h/16) u16 words: plane 0 = 1-bit mask, planes
1-5 = 5-bit colour, column-major within each plane (pixel (x,y) = word
x·ceil(h/16)+y//16, bit 15-(y%16)). The decode loop is the game's own root
CODE hunk code1.bin+0x209E (cellA) / +0x20C2 (cellB).

frame N = base cell (cellA) + overlay cell (cellB); cellB may be 0. Both
cells use the same body format.

Output (public/assets/mm3/amiga/):
  sprites/monsters/<name>.png        — per-picture composed animation strips
  sprites/monsters/<name>.json       — frame table, cell geometry, masks as
                                       base64 (1 byte/pixel)
  sprites/faces/*, sprites/icons/*   — same for .fac/.icn
  data/sprite-catalog.json           — full inventory
  data/palette-candidates.json       — the 32-word 0RGB palette tables found
                                       in the executable DATA hunk (candidate
                                       game palettes; which one the sprites
                                       use at runtime is unresolved — see
                                       docs/mm3/TODO.md mm3-amiga-palette)
"""
from __future__ import annotations
import base64
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.amiga_sprite import (  # noqa: E402
    decode_body_records, words_to_planes, planes_to_grids,
    RECORD_EXTENSIONS,
)
from mm3lib.amiga_cc import load_named_entries  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..'))
OUT = os.path.join(REPO, 'public', 'assets', 'mm3', 'amiga')

# .fac (faces) and .out (expressions) are verified raw-plane decodes.
# .mon/.icn/.pic use the record-stream format (frame 0 verified coherent).
SPRITE_EXTS = ('.fac', '.out', '.mon', '.icn', '.pic')


def rgba_from_cell(mask, colour, w, h, palette):
    """mask/colour lists -> RGBA bytes (palette = list of 32 RGB tuples)."""
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        o = i * 4
        if mask[i]:
            r, g, b = palette[colour[i]]
            rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255
    return bytes(rgba)


def write_png(path, rgba, w, h):
    import zlib
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def submap(kind):
    kind = kind.lstrip('.')
    return {'mon': 'monsters', 'fac': 'faces', 'icn': 'icons', 'pic': 'pics', 'out': 'outs'}[kind]


def read_palette_candidates():
    # The confirmed game palette lives in the exe DATA hunk payload at
    # +0x4A62 (32 words, 0RGB) — identical copy in MM3-Intro at +0x0FB6.
    # See docs/mm3/amiga/data-structure.md "Palette". The old 0x48E0/0x4B5A
    # "candidates" are retracted: 0x48E0 is the credits-0 palette, 0x4B5A
    # is not a palette at all.
    exe = open(os.path.join(REPO, 'data', 'mm3', 'amiga', 'Might&MagicIII'), 'rb').read()
    DATA = 0x15b1c  # DATA hunk payload file offset
    cands = {}
    for name, off in [('game', 0x4A62)]:
        ws = [struct.unpack_from('>H', exe, DATA + off + i * 2)[0] for i in range(32)]
        if any(w > 0xFFF for w in ws):
            continue
        cands[name] = {
            'offset': hex(DATA + off),
            'words': [f'{w:04X}' for w in ws],
            'rgb': [[((w >> 8) & 0xF) * 17, ((w >> 4) & 0xF) * 17, (w & 0xF) * 17] for w in ws],
        }
    return cands


def main():
    cands = read_palette_candidates()
    # render with the confirmed game palette; store words so it can be re-rendered
    pal_name = 'game' if 'game' in cands else next(iter(cands))
    palette = cands[pal_name]['rgb']

    counts = {}
    catalog = []
    for name, payload, kind, fname, e in load_named_entries(os.path.join(REPO, 'data', 'mm3', 'amiga')):
        if not name.endswith(SPRITE_EXTS):
            continue
        ext = '.' + name.rsplit('.', 1)[-1]
        # Record-stream format: [count u16][count×u16] literals with
        # [marker u16] skip words (0xfffe→1, 0xfffd→2, 0xfffb→4, 0xfff7→8),
        # 0xffff terminator; decodes to 6·w·ceil(h/16) u16 words, plane 0 =
        # mask, planes 1-5 = colour, column-major within each plane.
        # CONFIRMED byte-exact corpus-wide (1811/1811 frames), see
        # docs/mm3/amiga/data-structure.md "Amiga sprite cells".
        try:
            if len(payload) < 2:
                continue
            nframes = struct.unpack_from('>H', payload, 0)[0]
            if nframes == 0:
                continue
            frames = []
            for i in range(nframes):
                a, b = struct.unpack_from('>II', payload, 2 + i * 8)
                if a and a + 8 <= len(payload):
                    # Cell header is {x, y, h, w} on disk (third = height,
                    # fourth = width) per the game's geometry code
                    # (code1.bin+0x1FE4..0x1FF8).
                    x, y, h, w = struct.unpack_from('>HHHH', payload, a)
                    if w <= 0 or h <= 0 or w > 600 or h > 600:
                        continue
                    words = decode_body_records(payload, a)
                    total = 6 * ((w + 15) // 16) * h
                    if len(words) != total:
                        continue  # not exact => malformed, skip frame
                    # Per-frame overlay: cellB decodes into the SAME 6-plane
                    # buffer as cellA (both at the same (x,y) rect) and is
                    # OR-ed on top — demon's wings/claws and spider's legs
                    # live in cellB. Verified: every cell decodes to exactly
                    # 6·ceil(w/16)·h words; OR-ing cellA|cellB yields the
                    # full sprite (spider = body+8 legs, 100% coherent).
                    if b and b + 8 <= len(payload):
                        xb, yb, hb, wb = struct.unpack_from('>HHHH', payload, b)
                        if wb == w and hb == h and xb == x and yb == y:
                            wb_words = decode_body_records(payload, b)
                            if len(wb_words) == total:
                                words = [wa | ob for wa, ob in
                                         zip(words, wb_words)]
                    planes = words_to_planes(words, w, h)
                    mask, colour = planes_to_grids(planes, w, h)
                    if sum(mask) == 0:
                        continue
                    frames.append({'w': w, 'h': h, 'mask': mask,
                                   'colour': colour})
            if not frames:
                continue
            # Dedupe identical frames: the game's frame table can point
            # multiple frame indices at the same (cellA, cellB) pair (idle
            # holds, mirrored pairs), so the same decoded mask appears
            # several times. Emit only distinct frames — duplicate atlas
            # frames would misrepresent the animation. (The game's frame
            # ORDER/selection table is not decoded; see TODO
            # mm3-amiga-sprite-anim.)
            seen_frames = set()
            uniq = []
            for fr in frames:
                key = (bytes(fr['mask']), bytes(fr['colour']))
                if key not in seen_frames:
                    seen_frames.add(key)
                    uniq.append(fr)
            frames = uniq
            # one PNG strip per file: composite each frame's base cell
            comps = frames
        except Exception:
            continue
        sub = submap(ext)
        d = os.path.join(OUT, 'sprites', sub)
        os.makedirs(d, exist_ok=True)
        cw = max(c['w'] for c in comps)
        ch = max(c['h'] for c in comps)
        strip = bytearray(len(comps) * cw * ch * 4)
        frame_meta = []
        for k, comp in enumerate(comps):
            rgba = rgba_from_cell(comp['mask'], comp['colour'], comp['w'], comp['h'], palette)
            for y in range(comp['h']):
                src = y * comp['w'] * 4
                dst = (y * cw * len(comps) + k * cw) * 4
                strip[dst:dst + comp['w'] * 4] = rgba[src:src + comp['w'] * 4]
            frame_meta.append({
                'index': k,
                'mask': base64.b64encode(bytes(comp['mask'])).decode(),
                'colour': base64.b64encode(bytes(comp['colour'])).decode(),
            })
        write_png(os.path.join(d, f'{name}.png'), bytes(strip), cw * len(comps), ch)
        atlas_frames = [{
            'name': f'{name}.frame{k}',
            'x': k * cw, 'y': 0, 'w': cw, 'h': ch,
        } for k in range(len(comps))]
        json.dump({
            'source': name, 'file': fname, 'palette': pal_name,
            'width': cw * len(comps), 'height': ch,
            'frames': atlas_frames,
            'frameCount': len(comps),
            'rawFrames': frame_meta,
        }, open(os.path.join(d, f'{name}.json'), 'w'))
        catalog.append({'name': name, 'file': fname, 'kind': ext, 'frames': len(comps), 'size': f'{cw}x{ch}'})
        counts[ext] = counts.get(ext, 0) + 1

    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
    # merge manifest entries: one per rendered sprite strip
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = []
    if os.path.exists(manifest_path):
        try: manifest = json.load(open(manifest_path))
        except Exception: manifest = []
    by_name = {e['name']: e for e in manifest}
    # Drop stale sprite entries for extensions that were previously rendered
    # but are not in this run's catalog (coherence gate / format changes).
    sprite_prefixes = tuple(f'sprites/{s}/' for s in ('monsters', 'faces', 'icons', 'pics', 'outs'))
    by_name = {n: e for n, e in by_name.items() if not n.startswith(sprite_prefixes)}
    for a in catalog:
        by_name[f"sprites/{submap(a['kind'])}/{a['name']}"] = {
            'name': f"sprites/{submap(a['kind'])}/{a['name']}",
            'sprites': a['frames'], 'hasPalette': False,
            'png': f"sprites/{submap(a['kind'])}/{a['name']}.png",
        }
    json.dump(sorted(by_name.values(), key=lambda e: e['name']), open(manifest_path, 'w'), indent=1)
    json.dump({'counts': counts, 'assets': catalog}, open(os.path.join(OUT, 'data', 'sprite-catalog.json'), 'w'), indent=1)
    json.dump(cands, open(os.path.join(OUT, 'data', 'palette-candidates.json'), 'w'), indent=1)
    print('Amiga sprites extracted:', counts)
    print('palette used for renders:', pal_name)


if __name__ == '__main__':
    main()

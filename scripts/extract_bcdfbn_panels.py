#!/usr/bin/env python3
"""bcdfb-bcdfn special-panel block: 80x72 panel bodies + inset sprites.

Levels 2, 3, 4, 6, 9, 11 (gate table S_1 +0x21FE8 non-zero) carry, between the
wall decorations and the sound bank, a block read by the level loader
(`bclib.levelfile`; spec: data-structure.md "Trailing Data", 2026-11-13):

    4,320 B   panel body, 80x72, 6 sequential planes (opaque)
      112 B   4 x 28-B blit descriptors (>H idx, >I src, >I bytesPerPlane,
              >I alt, >H BLTSIZE, >H modulo, >H x, >H y, >H flags, >H w, >H h)
    gate B    inset pixels, 7-plane masked (mask + 6 EHB), at `src` within the
              block; each descriptor's src+7*bytesPerPlane stays inside it

Each level's art is coloured with that level's own dungeon palette
(`bclib.read_dungeon_palette_for_level`).

Output:
    sprites/special-panels.{png,json}   frames m<L>_panel, m<L>_inset<k>;
                                        the JSON adds level/file/kind and, for
                                        insets, the descriptor's x/y placement
                                        (screen x/y, 0,0 = unplaced; every descriptor sharing the pixels)
    data/special-panels.json            per-level layout + verification
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import levelfile, palette as PL

LETTERS = 'bcdefghijklmn'
N_INSETS = 4


def parse_descriptors(raw, desc_off):
    out = []
    for k in range(N_INSETS):
        d = raw[desc_off + 28 * k:desc_off + 28 * k + 28]
        _i, src, bpp, alt, blt, mod, x, y, flags, w, h = struct.unpack('>HIIIHHHHHHH', d)
        out.append({'k': k, 'src': src, 'bytesPerPlane': bpp, 'bltsize': blt,
                    'modulo': mod, 'x': x, 'y': y, 'flags': flags, 'w': w, 'h': h})
    return out


def check_descriptors(descs, gate, level):
    """Raise unless every descriptor is self-consistent and the insets tile
    the pixel block exactly (the highest src+7*bpp == gate bytes)."""
    extent = 0
    for d in descs:
        w, h = d['w'], d['h']
        if d['bytesPerPlane'] != (w // 8) * h:
            raise ValueError(f'level {level} inset {d["k"]}: bytesPerPlane != w/8*h')
        if d['bltsize'] != (h << 6) | (w // 16 + 1):
            raise ValueError(f'level {level} inset {d["k"]}: BLTSIZE mismatch')
        # x/y are screen coordinates (e.g. 92,78), not body-relative; (0,0)
        # marks an unplaced slot the game fills at runtime.
        if not (0 <= d['x'] and d['x'] + w <= 320 and 0 <= d['y'] and d['y'] + h <= 200):
            raise ValueError(f'level {level} inset {d["k"]}: placement outside 320x200')
        extent = max(extent, d['src'] + 7 * d['bytesPerPlane'])
    if extent != gate:
        raise ValueError(f'level {level}: descriptors span {extent} B, gate block {gate} B')


def level_panel(raw, s1, s2, level):
    """Decode level `level`'s special panel. Returns None if the level has none,
    else dict(layout, descs, body_idx, insets{src: (idx, mask)}, palette)."""
    lay = levelfile.tail_layout(raw, s1, level)
    if lay['panel'] is None:
        return None
    p = lay['panel']
    body = bclib.decode_planar(raw[p:p + levelfile.PANEL_BODY_BYTES],
                               levelfile.PANEL_BODY_W, levelfile.PANEL_BODY_H, 6)
    descs = parse_descriptors(raw, lay['panel_desc'])
    check_descriptors(descs, lay['inset_bytes'], level)
    pix = lay['inset_pixels']
    insets = {}
    for d in descs:
        if d['src'] in insets:
            continue
        s = pix + d['src']
        insets[d['src']] = bclib.decode_masked(raw[s:s + 7 * d['bytesPerPlane']], d['w'], d['h'])
    words = PL.read_dungeon_palette_for_level(s1, s2, level)
    return {'layout': lay, 'descs': descs, 'body': body, 'insets': insets,
            'palette': PL.ehb_palette(words)}


def main(src_dir=None):
    src = Path(src_dir) if src_dir else bclib.data_dir('blackcrypt', 'amiga')
    ext = bclib.data_dir('blackcrypt', 'amiga').parent / 'extracted'
    s1p, s2p = ext / 'bcdft_decompressed.bin', ext / 'bcdft_s2_data.bin'
    if not (src / 'bcdfb').exists() or not s1p.exists() or not s2p.exists():
        print('  bcdfb-bcdfn / bcdft images missing — skipping')
        return
    s1, s2 = s1p.read_bytes(), s2p.read_bytes()

    sprites, meta, levels = [], {}, []
    for level in range(1, 14):
        raw = (src / f'bcdf{LETTERS[level - 1]}').read_bytes()
        r = level_panel(raw, s1, s2, level)
        if r is None:
            continue
        pal = r['palette']
        name = f'm{level}_panel'
        sprites.append((name, bclib.to_rgba(r['body'], pal)))
        meta[name] = {'level': level, 'file': f'bcdf{LETTERS[level - 1]}', 'kind': 'panel'}
        by_src = {}
        for d in r['descs']:
            by_src.setdefault(d['src'], []).append(d)
        for src_off, ds in by_src.items():
            idx, mask = r['insets'][src_off]
            n = f'm{level}_inset{ds[0]["k"]}'
            sprites.append((n, bclib.to_rgba(idx, pal, mask=mask)))
            meta[n] = {'level': level, 'file': f'bcdf{LETTERS[level - 1]}', 'kind': 'inset',
                       'placements': [{'k': d['k'], 'x': d['x'], 'y': d['y']} for d in ds]}
        lay = r['layout']
        levels.append({'level': level, 'file': f'bcdf{LETTERS[level - 1]}',
                       'panelOffset': lay['panel'], 'descriptorOffset': lay['panel_desc'],
                       'insetPixelsOffset': lay['inset_pixels'], 'insetBytes': lay['inset_bytes'],
                       'sfxOffset': lay['sfx'], 'descriptors': r['descs']})
        print(f'  level {level:2d}: panel {levelfile.PANEL_BODY_W}x{levelfile.PANEL_BODY_H}, '
              f'{len(by_src)} unique insets ({len(r["descs"])} placements), consumed exactly to sfx')

    sheet, frames = bclib.pack_atlas(sprites)
    entry = bclib.write_atlas('special-panels', sheet, frames)
    jpath = bclib.asset_dir('sprites', 'blackcrypt', 'amiga') / 'special-panels.json'
    doc = bclib.frames_to_json(frames, sheet.shape[1], sheet.shape[0])
    for f in doc['frames']:
        f.update(meta[f['name']])
    bclib.write_json(jpath, doc, pretty=True)
    bclib.write_json(bclib.asset_dir('data', 'blackcrypt', 'amiga') / 'special-panels.json',
                     {'levels': levels, 'gate': levelfile.gate_table(s1)}, pretty=True)
    print(f"  {len(frames)} sprites -> {entry['name']} ({sheet.shape[1]}x{sheet.shape[0]})")


if __name__ == '__main__':
    main(*sys.argv[1:2])

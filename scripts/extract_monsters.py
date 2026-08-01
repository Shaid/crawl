#!/usr/bin/env python3
"""Monster sprite extractor for bcdfb .. bcdfn (Amiga).

Emits one packed atlas — `sprites/monsters` — covering all 13 dungeon levels,
plus a frame sidecar naming each sprite `m<map>_off<data_off>`.

VERIFIED FILE FORMAT
--------------------
  0x0000  12 bytes   file header
  0x000C  42 x 28    frame directory
  0x04A4  214 bytes  secondary table (raw, NOT compressed)
  0x057A  ...        RLE stream  <-- bclib.MONSTER_STREAM_START, all 13 files

Directory entry (28 bytes, big-endian):
  +0   u32  data_off   offset into the DECOMPRESSED buffer  (exact, no fixups)
  +4   u32  bpr        bytes per plane
  +12  u16  bltsize    precomputed Amiga BLTSIZE
  +14  u16  modulo
  +20  u16  type/flags 0x0100 normal, 0x0500 mirrored/alternate
  +22  u16  width  (px)
  +24  u16  height (px)

Sprites are tiled with NO gaps and NO header: next_off - off == 7 * bpr exactly.
Entries sharing a data_off are the *same image* (a normal/mirrored pair), not
sub-frames — so 42 directory slots yield only 10-24 distinct images per file.

SELF-CHECK: decompressed length == max(data_off + 7*bpr) for every file.
"""
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

N_ENTRIES = 42
ENTRY_SIZE = 28
LETTERS = 'bcdefghijklmn'


def read_directory(raw):
    ents = []
    for i in range(N_ENTRIES):
        e = raw[12 + i * ENTRY_SIZE: 12 + (i + 1) * ENTRY_SIZE]
        ents.append({
            'data_off': int.from_bytes(e[0:4], 'big'),
            'bpr':      int.from_bytes(e[4:8], 'big'),
            'bltsize':  int.from_bytes(e[12:14], 'big'),
            'modulo':   int.from_bytes(e[14:16], 'big'),
            'type':     int.from_bytes(e[20:22], 'big'),
            'width':    int.from_bytes(e[22:24], 'big'),
            'height':   int.from_bytes(e[24:26], 'big'),
        })
    return ents


def main(src_dir=None, pal_path=None):
    src = Path(src_dir) if src_dir else bclib.data_dir('blackcrypt', 'amiga')
    pal_file = Path(pal_path) if pal_path else Path(__file__).parent / 'palette_final.json'
    pal = bclib.load_palette_json(pal_file)
    n_pal = len(pal) // 3

    sprites = []
    missing = defaultdict(int)
    total_px = 0

    for letter in LETTERS:
        path = src / f'bcdf{letter}'
        if not path.exists():
            continue
        raw = path.read_bytes()
        ents = read_directory(raw)
        dec = bclib.rle_decompress(raw, bclib.MONSTER_STREAM_START)

        # Entries sharing data_off are the same image; keep one per offset.
        uniq = {}
        for e in ents:
            uniq.setdefault(e['data_off'], e)

        expected = max(o + 7 * e['bpr'] for o, e in uniq.items())
        ok = 'OK' if len(dec) == expected else '** MISMATCH **'
        mapno = ord(letter) - ord('b') + 1
        print(f'  bcdf{letter} (map {mapno:2d}): {len(dec):6d} B decompressed, '
              f'expected {expected:6d} {ok}, {len(uniq)} sprites')

        for off, e in sorted(uniq.items()):
            w, h, bpr = e['width'], e['height'], e['bpr']
            if w == 0 or h == 0 or off + 7 * bpr > len(dec):
                continue
            idx, mask = bclib.decode_masked(dec[off:off + 7 * bpr], w, h)
            if idx is None:
                continue
            # Any visible index beyond the 64-entry EHB palette means the
            # decode drifted; to_rgba paints those magenta, so count them.
            visible = idx[mask > 0]
            for v in visible[visible >= n_pal].tolist():
                missing[int(v)] += 1
            rgba = bclib.to_rgba(idx, pal, mask=mask)
            sprites.append((f'm{mapno}_off{off}_{w}x{h}', rgba))
            total_px += w * h

    if not sprites:
        print('  No bcdfb-bcdfn files found — skipping monsters')
        return

    sheet, frames = bclib.pack_atlas(sprites)
    entry = bclib.write_atlas('monsters', sheet, frames)
    print(f"  {len(frames)} sprites → {entry['name']} "
          f"({sheet.shape[1]}x{sheet.shape[0]})")

    nmiss = sum(missing.values())
    if nmiss:
        print(f'  WARNING {nmiss}/{total_px} px used an unknown palette index '
              f'{sorted(missing)[:8]}')
    else:
        print(f'  palette check: all {total_px} visible px within {n_pal} entries')


if __name__ == '__main__':
    main(*sys.argv[1:3])

#!/usr/bin/env python3
"""bcdfb-bcdfn trailing region: wall-decoration sprites + monster sound bank.

Supersedes `scripts/extract_bcdfbn_icons.py` (deleted). That script claimed the
whole 9-19 KB trailing region was a run of 16x20 icons (92 of them). It was
wrong: only the first **1932 bytes** are graphics; everything after that is a
bank of raw **8-bit signed PCM sound effects**, proven byte-exact against the
DOS release (see docs/blackcrypt/amiga/data-structure.md).

LAYOUT (confirmed) — offsets relative to the first byte after the monster-sprite
RLE stream's 0x00 terminator (= file offset 1402 + header word at +0x02):

    +0      1932 B   wall-decoration graphics: 3 decorations x 644 B
    +1932   to EOF   monster sound-effect bank, raw signed 8-bit PCM,
                     samples stored back to back, last one ending at EOF

One 644-byte decoration block holds the SAME decoration at three view
distances, 16 px wide throughout (2 bytes/row), 7 sequential planes each
(plane 0 = 1bpp mask, planes 1-6 = 6bpp EHB colour) — the game's usual sprite
convention:

    +0     280 B   near:  16 x 20   (7 planes x 40 B)
    +280   210 B   mid:   16 x 15   (7 planes x 30 B)
    +490   154 B   far:   16 x 11   (7 planes x 22 B)
                   280 + 210 + 154 = 644 exactly, no padding

Output:
    sprites/wall-decorations.{png,json}  39 sprites (13 maps x 3 decorations x 3 sizes)
    audio/level<NN>-sfx.raw              per-level sound bank, raw signed 8-bit PCM
    data/level-sfx-banks.json            bank sizes + the samples identified against DOS
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

LETTERS = 'bcdefghijklmn'

GFX_BYTES = 1932            # total wall-decoration region
DECOR_BYTES = 644           # one decoration, all three sizes
N_DECOR = GFX_BYTES // DECOR_BYTES

# (offset within the 644-byte block, height in rows, label). Width is always 16.
SIZES = ((0, 20, 'near'), (280, 15, 'mid'), (490, 11, 'far'))
WIDTH = 16
N_PLANES = 7                # 1 mask + 6 EHB colour


def decor_sprites(body, mapno, pal):
    """Decode the 9 decoration sprites (3 decorations x 3 sizes) of one file."""
    out = []
    for d in range(N_DECOR):
        base = d * DECOR_BYTES
        for off, height, label in SIZES:
            start = base + off
            chunk = body[start:start + WIDTH // 8 * height * N_PLANES]
            idx, mask = bclib.decode_masked(chunk, WIDTH, height, color_planes=6)
            if idx is None:
                continue
            rgba = bclib.to_rgba(idx, pal, mask=mask)
            out.append((f'm{mapno}_decor{d}_{label}', rgba))
    return out


def main(src_dir=None, pal_path=None):
    src = Path(src_dir) if src_dir else bclib.data_dir('blackcrypt', 'amiga')
    pal_file = Path(pal_path) if pal_path else Path(__file__).parent / 'palette_final.json'
    pal = bclib.load_palette_json(pal_file)

    audio_dir = bclib.asset_dir('audio', 'blackcrypt', 'amiga')
    sprites = []
    banks = []

    for letter in LETTERS:
        path = src / f'bcdf{letter}'
        if not path.exists():
            continue
        raw = path.read_bytes()
        _dec, end_pos = bclib.rle_decompress_end(raw, bclib.MONSTER_STREAM_START)
        body = raw[end_pos:]
        mapno = ord(letter) - ord('b') + 1

        if len(body) < GFX_BYTES:
            print(f'  bcdf{letter}: trailing region too short ({len(body)} B) — skipped')
            continue

        sprites.extend(decor_sprites(body[:GFX_BYTES], mapno, pal))

        sfx = body[GFX_BYTES:]
        name = f'level{mapno:02d}-sfx'
        (audio_dir / f'{name}.raw').write_bytes(sfx)
        banks.append({
            'map': mapno, 'file': f'bcdf{letter}',
            'streamEnd': end_pos, 'graphicsBytes': GFX_BYTES,
            'sfxBytes': len(sfx), 'raw': f'audio/{name}.raw',
            'format': 'pcm_s8', 'note': 'samples stored back to back; boundary table not yet located',
        })
        print(f'  bcdf{letter} (map {mapno:2d}): {N_DECOR * len(SIZES)} decor sprites, '
              f'{len(sfx)} B sound bank')

    if not sprites:
        print('  No bcdfb-bcdfn files found — skipping')
        return

    bclib.write_json(bclib.asset_dir('data', 'blackcrypt', 'amiga') / 'level-sfx-banks.json',
                     banks, pretty=True)

    sheet, frames = bclib.pack_atlas(sprites)
    entry = bclib.write_atlas('wall-decorations', sheet, frames)
    print(f"  {len(frames)} sprites -> {entry['name']} ({sheet.shape[1]}x{sheet.shape[0]})")


if __name__ == '__main__':
    main(*sys.argv[1:3])

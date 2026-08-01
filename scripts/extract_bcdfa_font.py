#!/usr/bin/env python3
"""Extract Black Crypt's Amiga font bank (4 regions) from bcdfa.

bcdfa's container directory (see `bclib/bcdfa.py`, "Container directory")
has 13 entries; entry 4 (file offset 0x10779, RLE, decodes to 4,288 B) holds
**four** fonts, not two — see the `> Correction` in `bclib.bcdfa`'s font
docstring and data-structure.md's "bcdfa — Mono Font Bank":

  - Region A — the scrolling in-dungeon message-log font: 64 glyphs, 8x8,
    1bpp. Confirmed via its own consumer code at decompressed bcdft S_1
    `+0x1F3D2`-`+0x1F3FE` (a single-bitplane character blit reading
    `MOVEA.L $E0(A5),A3` = the SLOT_FONT bank, stride 8 bytes/glyph,
    index = ASCII - 0x20).
  - Region B — a 4x5 micro font, 59 glyphs. Consumer: S_1 `+0x20040`/`+0x20148`.
  - Region C+D — an 8x8, 6-colour-plane "big" font with its own 1bpp mask
    (regions C and D respectively), 59 glyphs. Consumer: S_1 `+0x2024E`/
    `+0x2025C`. The mask invariant (region C == OR of region D's 6 planes,
    472/472 bytes) is what pins region D's plane order.

All four regions have their own traced consumer code — nothing here is
"rendered only" anymore.

Requires `build/cache/blackcrypt/bcdft_decompressed.bin` (run
`scripts/decompress_bcdft.py` first if missing) for the container directory.

Output:
    public/assets/blackcrypt/amiga/sprites/font-mono.{png,json}   region A, 64 glyphs, 1bpp
    public/assets/blackcrypt/amiga/sprites/font-micro.{png,json}  region B, 59 glyphs, 4x5 1bpp
    public/assets/blackcrypt/amiga/sprites/font-big.{png,json}    regions C+D, 59 glyphs, 8x8 6bpp masked
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

import bclib
from extract_items import ui_palette


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    bcdfq_path = amiga / 'bcdfq'
    s1_path = bclib.cache_dir('blackcrypt') / 'bcdft_decompressed.bin'

    if not bcdfa_path.exists() or not bcdfq_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return
    if not s1_path.exists():
        print(f'No {s1_path} — run scripts/decompress_bcdft.py first')
        return

    s1 = s1_path.read_bytes()
    raw = bcdfa_path.read_bytes()
    chunks = bclib.read_container_chunks(s1, raw, bclib.rle_decompress)
    font_chunk = chunks[bclib.SLOT_FONT]
    if len(font_chunk) != bclib.FONT_CHUNK_BYTES:
        raise ValueError(
            f'bcdfa: font chunk is {len(font_chunk)} B, expected '
            f'{bclib.FONT_CHUNK_BYTES}')

    # Region A: 1bpp glyphs render as opaque white-on-transparent.
    mono_sprites = []
    for n, bits in bclib.mono_font_glyphs(font_chunk):
        rgba = np.zeros((8, 8, 4), dtype=np.uint8)
        rgba[bits] = (255, 255, 255, 255)
        mono_sprites.append((f'glyph{n:03d}_0x{0x20 + n:02X}', rgba))

    if mono_sprites:
        sheet, frames = bclib.pack_atlas(mono_sprites, max_width=8 * 32)
        bclib.write_atlas('font-mono', sheet, frames)
        print(f'  sprites/font-mono: {len(frames)} glyphs (region A, confirmed via '
              f'consumer code at bcdft S_1 +0x1F3D2) ({sheet.shape[1]}x{sheet.shape[0]} atlas)')

    # Region B: 4x5 micro font, also 1bpp.
    micro_sprites = []
    for n, bits in bclib.font_micro_glyphs(font_chunk):
        rgba = np.zeros((bclib.FONT_REGION_B_HEIGHT, bclib.FONT_REGION_B_WIDTH, 4), dtype=np.uint8)
        rgba[bits] = (255, 255, 255, 255)
        micro_sprites.append((f'glyph{n:03d}_0x{0x20 + n:02X}', rgba))

    if micro_sprites:
        sheet, frames = bclib.pack_atlas(micro_sprites, max_width=4 * 32)
        bclib.write_atlas('font-micro', sheet, frames)
        print(f'  sprites/font-micro: {len(frames)} glyphs (region B, confirmed via '
              f'consumer code at bcdft S_1 +0x20040) ({sheet.shape[1]}x{sheet.shape[0]} atlas)')

    # Regions C+D: 8x8, 6-plane EHB colour, masked by region C's own stencil.
    ehb = bclib.ehb_palette(ui_palette(bcdfq_path.read_bytes()))
    big_sprites = []
    for n, idx, mask in bclib.font_big_glyphs(font_chunk):
        rgba = bclib.to_rgba(idx, ehb, mask=mask)
        big_sprites.append((f'glyph{n:03d}_0x{0x20 + n:02X}', rgba))

    if big_sprites:
        sheet, frames = bclib.pack_atlas(big_sprites, max_width=8 * 20)
        bclib.write_atlas('font-big', sheet, frames)
        print(f'  sprites/font-big: {len(frames)} glyphs (regions C+D, confirmed via '
              f'consumer code at bcdft S_1 +0x2024E/+0x2025C) '
              f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Extract bcdfo's three 8x8 fonts.

bcdfo carries the character-generation screen's text machinery between its
`chargen_stats` element and the mystic sigils. All three ranges are
**code-confirmed** from bcdfp's own string printer, not inferred from the
bytes:

`LAB_00FD` (bcdfp.asm:3614) walks a NUL-terminated string and, per character,
does `SUBI.B #$20,D0` — so every bcdfo font is indexed by `ASCII - 0x20`,
slot 0 = space — then fetches:

    LSL.W  #3,D0  /  ADDA.L 0(A5),A3 / ADDA.L #$0000A148,A3   ; 8 B/glyph  mask
    MULU   #$0030,D1 / ADDA.L 0(A5),A4 / ADDA.L #$0000A320,A4 ; 48 B/glyph colour

and copies 8 mask bytes + 48 colour bytes into two scratch buffers at a
32-byte row stride, which `LAB_0102`'s blitter then draws with minterm $0FCA
(mask in A, colour in B) at a 256-byte plane stride, BLTSIZE `$0211`
(8 rows x 17 words = 272 px, i.e. a 34-character line).

A second printer at bcdfp file 0x02CF4 (inside an IRA `DC.L` block:
`SUBI.B #$20,D0 / LSL.W #3,D0 / MOVEA.L 0(A5),A3 / ADDA.L #$00009E28,A3`)
uses the plain 1-bit font at 0x9E28 into a 42-byte-per-row buffer.

Fonts:

`chargen-font-a` — 0x9E28, 512 B, 64 slots x 8 B, 1bpp.
    ASCII 32-95. Slots 1-3 ('!', '"', '#') and 59-63 ('[' - '_') hold
    directional-arrow and marker icons instead of their literal glyphs — the
    same "icons replace unused punctuation slots" convention already
    documented for bcdfa's message-log font.

`chargen-font-b` — 0xA148, 472 B, 59 slots x 8 B, 1bpp.
    The **mask/silhouette** plane of the colour font below, and a font in its
    own right for 1-bit use. ASCII 32-90; the first 33 slots are blank, the
    last 26 are a bold A-Z. **Confirmed** against DOS `clipper.clp` entry 207
    `"CG Font"` (8x472 8bpp, thresholded to ink/no-ink): all 3,776 bits of all
    59 slots agree — a 100.000%, byte-exact match including the blank slots.

`chargen-font-cg` — 0xA320, 2,832 B, 59 slots x 48 B.
    The same font in colour: 6 EHB bitplanes per glyph, stored plane-major
    *within* each glyph (8 B per plane). Only planes 0, 1 and 5 carry data
    (26 glyphs each): plane 1 is the letter body (index 2), plane 0 a
    highlight (index 3) and plane 5 an EHB shadow (index 34) — a bevelled
    letter. Structural invariant: the OR of all six planes equals
    `chargen-font-b` byte-for-byte for **59/59** slots, which is why one
    8-byte mask can drive a 48-byte glyph.

Output:
    public/assets/blackcrypt/amiga/sprites/chargen-font-a.{png,json}
    public/assets/blackcrypt/amiga/sprites/chargen-font-b.{png,json}
    public/assets/blackcrypt/amiga/sprites/chargen-font-cg.{png,json}
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

import bclib

#: 1-bit font used by the printer at bcdfp file 0x02CF4. ASCII 32-95.
FONT_A_OFFSET = 0x9E28
FONT_A_COUNT = 64

#: 1-bit mask font fetched by LAB_00FD as `0(A5) + $A148 + (ch - 0x20) * 8`.
FONT_B_OFFSET = 0xA148
FONT_B_COUNT = 59

#: 6-plane colour font fetched as `0(A5) + $A320 + (ch - 0x20) * 0x30`.
FONT_CG_OFFSET = 0xA320
FONT_CG_COUNT = 59
FONT_CG_GLYPH_BYTES = 48
FONT_CG_PLANES = 6

GLYPH_W = GLYPH_H = 8
GLYPH_BYTES = 8  # 1bpp, 8 rows x 1 byte


def _mono_glyphs(data, offset, count):
    for n in range(count):
        off = offset + n * GLYPH_BYTES
        rows = data[off:off + GLYPH_BYTES]
        if len(rows) < GLYPH_BYTES:
            break
        bits = np.unpackbits(np.frombuffer(bytes(rows), dtype=np.uint8))
        yield n, bits.reshape(GLYPH_H, GLYPH_W).astype(bool)


def _mono_atlas(data, offset, count, name):
    sprites = []
    for n, bits in _mono_glyphs(data, offset, count):
        rgba = np.zeros((GLYPH_H, GLYPH_W, 4), dtype=np.uint8)
        rgba[bits] = (255, 255, 255, 255)
        sprites.append((f'glyph{n:02d}', rgba))
    if not sprites:
        return None
    sheet, frames = bclib.pack_atlas(sprites, max_width=GLYPH_W * 16)
    return bclib.write_atlas(name, sheet, frames, register=False)


def _colour_atlas(data, palette, name):
    """The 6-plane colour font, cut out with its own 1-bit mask font."""
    sprites = []
    for n in range(FONT_CG_COUNT):
        off = FONT_CG_OFFSET + n * FONT_CG_GLYPH_BYTES
        glyph = data[off:off + FONT_CG_GLYPH_BYTES]
        mask_off = FONT_B_OFFSET + n * GLYPH_BYTES
        idx = bclib.decode_planar(glyph, GLYPH_W, GLYPH_H, FONT_CG_PLANES)
        mask = bclib.decode_planar(data[mask_off:mask_off + GLYPH_BYTES],
                                   GLYPH_W, GLYPH_H, 1)
        if idx is None or mask is None:
            break
        sprites.append((f'glyph{n:02d}', bclib.to_rgba(idx, palette, mask=mask)))
    if not sprites:
        return None
    sheet, frames = bclib.pack_atlas(sprites, max_width=GLYPH_W * 16)
    return bclib.write_atlas(name, sheet, frames, register=False)


def check_mask_invariant(data):
    """OR of the colour font's 6 planes must equal the 1-bit mask font."""
    agree = 0
    for n in range(FONT_CG_COUNT):
        glyph = data[FONT_CG_OFFSET + n * FONT_CG_GLYPH_BYTES:
                     FONT_CG_OFFSET + (n + 1) * FONT_CG_GLYPH_BYTES]
        mask = data[FONT_B_OFFSET + n * GLYPH_BYTES:
                    FONT_B_OFFSET + (n + 1) * GLYPH_BYTES]
        union = bytes(
            glyph[0 * 8 + i] | glyph[1 * 8 + i] | glyph[2 * 8 + i] |
            glyph[3 * 8 + i] | glyph[4 * 8 + i] | glyph[5 * 8 + i]
            for i in range(GLYPH_BYTES))
        agree += union == bytes(mask)
    return agree


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfo_path = amiga / 'bcdfo'
    bcdfp_path = amiga / 'bcdfp'
    if not bcdfo_path.exists() or not bcdfp_path.exists():
        print(f'No {bcdfo_path} — nothing to do')
        return

    data = bcdfo_path.read_bytes()
    palette = bclib.ehb_palette(bclib.read_chargen_palette(bcdfp_path.read_bytes()))

    agree = check_mask_invariant(data)
    if agree != FONT_CG_COUNT:
        raise ValueError(f'colour-font plane union matches the mask font for only '
                         f'{agree}/{FONT_CG_COUNT} slots — layout is wrong')

    entries = []
    e = _mono_atlas(data, FONT_A_OFFSET, FONT_A_COUNT, 'chargen-font-a')
    if e:
        entries.append(e)
        print(f'  sprites/chargen-font-a: {FONT_A_COUNT} slots '
              f'(bcdfo+0x{FONT_A_OFFSET:04X}, ASCII 32-95; consumer at bcdfp 0x02CF4)')

    e = _mono_atlas(data, FONT_B_OFFSET, FONT_B_COUNT, 'chargen-font-b')
    if e:
        entries.append(e)
        print(f'  sprites/chargen-font-b: {FONT_B_COUNT} slots '
              f'(bcdfo+0x{FONT_B_OFFSET:04X}, mask plane of the colour font; '
              f'100.000% bit-exact vs DOS clipper.clp "CG Font")')

    e = _colour_atlas(data, palette, 'chargen-font-cg')
    if e:
        entries.append(e)
        print(f'  sprites/chargen-font-cg: {FONT_CG_COUNT} slots '
              f'(bcdfo+0x{FONT_CG_OFFSET:04X}, 6 planes/glyph; '
              f'plane union == mask font {agree}/{FONT_CG_COUNT})')

    if entries:
        bclib.write_manifest(entries)


if __name__ == '__main__':
    main()

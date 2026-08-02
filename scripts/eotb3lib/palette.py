"""6-bit VGA palette loaders for EOB3 (dosvga).

Two on-disk shapes, both confirmed against real files / ThirdEye's
apps/thirdeye/graphics/palette.cpp:

- Raw palette (CHARGEN/PALETTE.COL, CPS-embedded palettes): N*3 bytes,
  each byte a 6-bit (0..63) VGA DAC value, no header. 768 B = 256 colours.
- "Resource" palette (EYE.RES palette resources, GFF PAL blocks): a 26-byte
  header (u16 numColours, u16 colorArrayOffset, u16 fadeIndexArray00, then
  10 more u16 fade-index-array offsets = 12*2+2 = 26 B), followed by
  numColours*3 bytes of 6-bit RGB at offset 26.
"""
from __future__ import annotations

import struct

PAL_HEADER_SIZE = 26


def scale6to8(v: int) -> int:
    # 0..63 -> 0..255. ThirdEye uses v<<2 (0..252); we match that exactly
    # for byte-for-byte parity with the reference decoder.
    return (v << 2) & 0xFF


def load_raw_palette(blob: bytes) -> list:
    """N*3 raw 6-bit RGB triples, no header (PALETTE.COL, CPS palette block)."""
    n = len(blob) // 3
    out = []
    for i in range(n):
        r, g, b = blob[i * 3], blob[i * 3 + 1], blob[i * 3 + 2]
        out.append({"r": scale6to8(r), "g": scale6to8(g), "b": scale6to8(b)})
    return out


def load_resource_palette(blob: bytes) -> list:
    """26-byte-header palette resource (EYE.RES / GFF PAL block)."""
    if len(blob) < 6:
        raise ValueError("palette resource header truncated")
    num_colours, colour_array, fade0 = struct.unpack_from("<HHH", blob, 0)
    needed = PAL_HEADER_SIZE + num_colours * 3
    if len(blob) < needed:
        raise ValueError(
            f"palette resource data truncated: need {needed}, got {len(blob)}"
        )
    out = []
    for i in range(num_colours):
        off = PAL_HEADER_SIZE + i * 3
        r, g, b = blob[off], blob[off + 1], blob[off + 2]
        out.append({"r": scale6to8(r), "g": scale6to8(g), "b": scale6to8(b)})
    return out

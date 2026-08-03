"""6-bit VGA palette loaders for EOB3/Dungeon Hack (AESOP/16, dosvga).

Two on-disk shapes, both confirmed against real files / ThirdEye's
apps/thirdeye/graphics/palette.cpp, and (as of the Dungeon Hack pass)
against the actual AESOP interpreter source (John Miles' publicly-released
AESOP_INTERPRETER_BUILD_2a archive, DEFS.H/GRAPHICS.C -- see
docs/dungeonhack/dosvga/data-structure.md):

- Raw palette (CHARGEN/PALETTE.COL, CPS-embedded palettes): N*3 bytes,
  each byte a 6-bit (0..63) VGA DAC value, no header. 768 B = 256 colours.
- "Resource" palette (EYE.RES/HACK.RES/OPEN.RES palette resources, GFF PAL
  blocks): a 26-byte header, exactly matching the real interpreter source's
  `PAL_HDR` struct (`DEFS.H`):
      u16 numColours        ("ncolors")
      u16 colorArrayOffset  ("RGB" -- always 26 observed, byte offset of
                             the RGB array from the resource start)
      u16 fadeIndexArray[11] ("fade[11]" -- byte offsets of 11 per-colour
                             brightness/light-falloff lookup tables, each
                             numColours bytes, immediately following the
                             RGB array: fadeIndexArray[k] == colorArrayOffset
                             + numColours*3 + k*numColours, confirmed with
                             zero deviation across every palette resource in
                             both EYE.RES and HACK.RES/OPEN.RES)
  followed by numColours*3 bytes of 6-bit RGB at offset 26, then
  11*numColours bytes of fade-level data (11 brightness steps, 1 byte per
  base colour each -- level 0 observed constant, e.g. every colour maps to
  a single dark index at minimum brightness; the last level is near-
  identity, i.e. "no darkening"). Confirmed against source: `GRAPHICS.C`'s
  `set_palette()` computes `fade_tables[region][i][j] = first_color[region]
  + fade[j]` -- so stored fade bytes are bit-exact DAC index deltas from
  the resource's own colorArrayOffset base, which for both games' `region`
  0 (fixed palette, first_color=0) makes the stored byte equal to the
  absolute DAC index directly. Total resource size is always exactly
  `26 + numColours*14` -- a byte-exact structural invariant holding across
  every palette resource sampled in both games' containers.
"""
from __future__ import annotations

import struct

PAL_HEADER_SIZE = 26
NUM_FADE_LEVELS = 11


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


def resource_palette_fade_tables(blob: bytes) -> list:
    """Return the 11 per-colour brightness/fade-level lookup tables (see
    module docstring) as a list of 11 lists of `numColours` raw DAC-index
    bytes (not yet offset by a DAC region base -- callers add
    `first_color[region]` themselves, matching GRAPHICS.C's set_palette()).
    """
    num_colours, colour_array = struct.unpack_from("<HH", blob, 0)
    fade_offsets = struct.unpack_from("<11H", blob, 4)
    tables = []
    for off in fade_offsets:
        tables.append(list(blob[off:off + num_colours]))
    return tables

"""EOB1 (DOS) EGA/CGA render-mode palette.

Ported from `Palette::_egaColors` (`engines/kyra/graphics/screen.cpp:4269-
4276`) and `EoBEngine::_egaDefaultPalette` (`engines/kyra/resource/
staticres_eob.cpp:1785-1787`), fetched 2026-08-02. See
docs/eotb/dosvga/data-structure.md § "EGA render mode".

Unlike VGA-mode CPS files (which resolve a per-file palette via the
wall-set-stem name-match or an embedded palette), EOB1's `.EGA`/`.ECN`
render-mode assets all share **one single, static, game-wide 16-colour
palette** loaded once at `EoBEngine::init()` — no name-matching needed.
"""
import numpy as np

# Palette::_egaColors -- 16 x (R, G, B), each component already in the
# engine's internal 0-63 VGA-DAC range (classic RGBI EGA hardware values
# 0x00/0x55/0xAA/0xFF scaled by >>2).
EGA_COLORS = [
    (0x00, 0x00, 0x00), (0x00, 0x00, 0xAA), (0x00, 0xAA, 0x00), (0x00, 0xAA, 0xAA),
    (0xAA, 0x00, 0x00), (0xAA, 0x00, 0xAA), (0xAA, 0x55, 0x00), (0xAA, 0xAA, 0xAA),
    (0x55, 0x55, 0x55), (0x55, 0x55, 0xFF), (0x55, 0xFF, 0x55), (0x55, 0xFF, 0xFF),
    (0xFF, 0x55, 0x55), (0xFF, 0x55, 0xFF), (0xFF, 0xFF, 0x55), (0xFF, 0xFF, 0xFF),
]

# EoBEngine::_egaDefaultPalette -- indices into EGA_COLORS, one game-wide
# 16-colour palette used for every EOB1 .EGA/.ECN asset.
EGA_DEFAULT_PALETTE_INDICES = [0, 5, 3, 2, 10, 14, 12, 6, 4, 11, 9, 1, 0, 8, 7, 15]


def ega_default_palette_rgb() -> np.ndarray:
    """The resolved 16 x 3 uint8 RGB palette for EOB1 EGA-mode assets (0-255 range)."""
    rgb64 = np.array([EGA_COLORS[i] for i in EGA_DEFAULT_PALETTE_INDICES], dtype=np.uint8)
    # These EGA_COLORS component values are already full 0-255-range bytes
    # (0x00/0x55/0xAA/0xFF), unlike the 0-63 VGA DAC range .PAL/.COL files
    # use -- no 6-to-8-bit expansion needed here.
    return rgb64

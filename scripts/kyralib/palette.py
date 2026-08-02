"""VGA palette decode for Kyra-engine DOS/VGA files.

Port of ScummVM's Palette::loadVGAPalette (engines/kyra/graphics/screen.cpp):
each colour is 3 bytes (R, G, B), each byte masked to the low 6 bits (VGA DAC
range 0-63). The 6->8 bit expansion used when ScummVM actually paints pixels
is `(v << 2) | (v & 3)` (screen.cpp ~line 4258-4260) — NOT a naive `v * 4`,
though the two agree for all but the low 2 bits. Verified: BRICK1.CPS
decoded through BRICK.PAL with this formula renders a legible, correctly
coloured brick/UI sprite sheet (see docs/eotb/dosvga/data-structure.md).

Standalone palette files (.PAL, .COL, EOBPAL.COL, *.COL entries seen inside
the PAKs) are exactly this format with no header: N*3 raw bytes, 768 bytes
== 256 colours being the common case for full-screen images.
"""
from __future__ import annotations

import numpy as np


def vga_palette_to_rgb(pal_bytes: bytes) -> np.ndarray:
    """Decode raw VGA palette bytes -> (n, 3) uint8 RGB array, 0-255 range."""
    n = len(pal_bytes) // 3
    raw = np.frombuffer(pal_bytes[:n * 3], dtype=np.uint8).reshape(n, 3).astype(np.uint16)
    masked = raw & 0x3F
    expanded = (masked << 2) | (masked & 3)
    return expanded.astype(np.uint8)


def palette_to_rgba(rgb: np.ndarray, transparent_index: int | None = 0) -> np.ndarray:
    """(n,3) RGB -> (n,4) RGBA, with one index (default 0) fully transparent."""
    n = rgb.shape[0]
    rgba = np.concatenate([rgb, np.full((n, 1), 255, dtype=np.uint8)], axis=1)
    if transparent_index is not None and 0 <= transparent_index < n:
        rgba[transparent_index, 3] = 0
    return rgba

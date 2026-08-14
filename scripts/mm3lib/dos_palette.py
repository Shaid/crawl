"""MM3 (DOS) 256-colour VGA palette.

The palette is not in MM3.EXE -- it lives inside MM3.CC entry hash 0x8F99
(filename `vga`, the game's own VGA display driver, x86 code), at
decompressed-entry offset 0x39C: 256 x {u8 r, g, b} 6-bit VGA DAC values
(0-63). Confirmed byte-exact by invoking the driver's own DAC-upload
routine under emulation and capturing the port 0x3C9 write stream, and by
rendering every `.raw` screen coherently -- see
docs/mm3/dosvga/data-structure.md "DOS 256-colour palette".

There is exactly one palette (no per-screen/day-night variants); the only
runtime variation is a global fade brightness scale. No emulation is
needed to extract it -- it's a static byte range inside a normally
LZHUF-decompressed CC entry, so this only depends on `dos_cc.py`.
"""
from __future__ import annotations

from .dos_cc import CCFile, extract_entry, hash_filename

VGA_DRIVER_HASH = hash_filename('vga')
PALETTE_OFFSET = 0x39C
PALETTE_COUNT = 256


def load_dos_palette(cc_data: bytes, entries: list[CCFile]) -> list[tuple[int, int, int]]:
    """Returns 256 x (r, g, b) 6-bit (0-63) VGA DAC values."""
    e = next((e for e in entries if e.hash == VGA_DRIVER_HASH), None)
    if e is None:
        raise ValueError('MM3.CC: vga driver entry (hash 0x8F99) not found')
    payload, _kind = extract_entry(cc_data, e)
    if payload is None or len(payload) < PALETTE_OFFSET + PALETTE_COUNT * 3:
        raise ValueError('MM3.CC: vga driver entry too short for the palette table')
    pal = payload[PALETTE_OFFSET:PALETTE_OFFSET + PALETTE_COUNT * 3]
    return [(pal[i], pal[i + 1], pal[i + 2]) for i in range(0, PALETTE_COUNT * 3, 3)]


def scale_6_to_8(v: int) -> int:
    """6-bit VGA DAC value (0-63) -> 8-bit RGB, bit-replication scale."""
    return (v << 2) | (v >> 4)

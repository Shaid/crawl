"""
MM1 (DOS) `.DTA` graphics container + 2bpp RLE screen decoder.

Direct port of ScummVM's `engines/mm/mm1` loaders (GPL, used as the byte-exact
oracle for this project — see `docs/mm1/dosega/data-structure.md`):

  * `gfx/dta.cpp`  — DTA container: `u16LE` index size + `u32LE` offset table
    (one offset per entry + a sentinel) + entry payloads.
  * `gfx/screen_decoder.cpp` — per-entry image format: a 2-byte `u16LE` size
    word, then an RLE stream (`0x7B` = run marker: `0x7B len-1 value`) that
    fills a `w/4 × h` grid of 2bpp cells **column-major** (the C++ fill
    advances a base pointer once per column, which is easy to mis-port — see
    the pitfall note in the doc), then each cell byte expands MSB-first into
    4 CLUT8 pixels via a 4-entry `_indexes[]` remap table.

The palette on disk is not part of the file: the 2bpp cell values are remapped
through per-entry EGA palette indexes that the game/ScummVM supply at the call
site (WALLPIX: `TILE_COLORS[entry]`; MONPIX: `PALETTE[imgNum]`), then through
the standard 16-colour EGA palette (`gfx/gfx.cpp` `EGA_PALETTE`).
"""
from __future__ import annotations

import struct
from pathlib import Path

# Standard 16-colour EGA palette (ScummVM gfx.cpp EGA_PALETTE), RGB.
EGA_RGB: list[tuple[int, int, int]] = [
    (0x00, 0x00, 0x00), (0x00, 0x00, 0xAA), (0x00, 0xAA, 0x00), (0x00, 0xAA, 0xAA),
    (0xAA, 0x00, 0x00), (0xAA, 0x00, 0xAA), (0xAA, 0x55, 0x00), (0xAA, 0xAA, 0xAA),
    (0x55, 0x55, 0x55), (0x55, 0x55, 0xFF), (0x55, 0xFF, 0x55), (0x55, 0xFF, 0xFF),
    (0xFF, 0x55, 0x55), (0xFF, 0x55, 0xFF), (0xFF, 0xFF, 0x55), (0xFF, 0xFF, 0xFF),
]

# RLE run marker: a literal 0x7B byte never appears in the pixel stream.
RUN_MARKER = 0x7B


class DtaContainer:
    """A `.DTA` file: u16LE index byte-size, u32LE entry offset table, payloads.

    Entries are returned as raw payload bytes **including** the per-entry
    leading `u16LE` size word (callers skip it, exactly like the ScummVM code
    does with `entry->skip(2)`).
    """

    def __init__(self, data: bytes):
        self.data = data
        self.index_size = struct.unpack_from('<H', data, 0)[0]
        if self.index_size % 4 != 0:
            raise ValueError(f"DTA index size {self.index_size} not a multiple of 4")
        n = self.index_size // 4
        self.offsets = struct.unpack_from(f'<{n}I', data, 2)
        self.payload_base = 2 + self.index_size
        if len(self.offsets) < 2:
            raise ValueError("DTA index has no entries")

    @property
    def count(self) -> int:
        return len(self.offsets) - 1

    def entry(self, i: int) -> bytes:
        if not (0 <= i < self.count):
            raise IndexError(f"DTA entry {i} out of range (0..{self.count - 1})")
        start = self.payload_base + self.offsets[i]
        end = self.payload_base + self.offsets[i + 1]
        return self.data[start:end]

    def entries(self) -> list[bytes]:
        return [self.entry(i) for i in range(self.count)]


def decode_screen(stream: bytes, w: int, h: int, indexes: list[int]) -> tuple[list[int], int]:
    """ScreenDecoder::loadStream port.

    Args:
        stream: the RLE byte stream (may contain more bytes than one tile needs).
        w, h:   image dimensions in pixels (w must be a multiple of 4).
        indexes: 4 CLUT8 palette indexes for the 2bpp values 0..3.

    Returns:
        (pixels as CLUT8 indexes, row-major, length w*h, bytes consumed).
    """
    if w % 4 != 0:
        raise ValueError(f"decode_screen: width {w} not a multiple of 4")
    stride = w // 4
    img_size = stride * h
    grid = bytearray(img_size)
    pos = 0
    row = 0
    col = 0
    while col < stride and pos < len(stream):
        v = stream[pos]
        pos += 1
        if v != RUN_MARKER:
            run = 1
        else:
            if pos + 1 >= len(stream):
                break
            run = stream[pos] + 1
            pos += 1
            v = stream[pos]
            pos += 1
        for _ in range(run):
            if col >= stride:  # run overran the tile; excess is discarded
                break
            grid[row * stride + col] = v
            row += 1
            if row >= h:
                row = 0
                col += 1
    px: list[int] = [0] * (w * h)
    p = 0
    for i in range(img_size):
        v = grid[i]
        for _ in range(4):
            px[p] = indexes[(v >> 6) & 3]
            p += 1
            v = (v << 2) & 0xFF
    return px, pos


def decode_screen_rgba(stream: bytes, w: int, h: int, indexes: list[int]) -> tuple[list[int], int]:
    """Like decode_screen but returns 24-bit RGB tuples per pixel."""
    px, consumed = decode_screen(stream, w, h, indexes)
    return [EGA_RGB[i] for i in px], consumed


def entry_payload(entry: bytes) -> bytes:
    """Strip + validate an entry's leading u16LE size word (ScummVM skips it)."""
    (size_word,) = struct.unpack_from('<H', entry, 0)
    body = entry[2:]
    if size_word != len(body):
        raise ValueError(f"entry size word {size_word} != payload length {len(body)}")
    return body


def read_dta(path: str | Path) -> DtaContainer:
    return DtaContainer(Path(path).read_bytes())

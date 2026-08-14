"""Might & Magic III (DOS/VGA) sprite container + scanline-RLE decoder.

Ported instruction-for-instruction from the game's own blitter, which lives in
the VGA display driver stored in `MM3.CC` (entry hash 0x8F99, filename `vga`;
see `docs/mm3/dosvga/data-structure.md`). Driver-image offsets below are file
offsets into the decompressed driver (`build/cache/mm3/palette/vga_driver.bin`).

Container
---------
    u16 frameCount
    frameCount x { u16 cell1Offset; u16 cell2Offset }   ; cell2Offset 0 = none
A frame is cell1 drawn, then cell2 drawn over it (transparent where skipped).
Driver: `vga`+0x1D9A reads cell1 via `mov si,[si]`, draws, advances the frame
table entry by 2, reads cell2, and `or si,si / jz` skips it when zero.

Cell
----
    u16 xOffset; u16 width; u16 yOffset; u16 height
Driver: `vga`+0x1DAE. Note the non-mirrored path *skips* the width field
(`inc si; inc si`) — width is only read by the mirrored variant (`vga`+0x1E36)
for its right-to-left origin. Width therefore never clips a scanline; the
encoder simply stops emitting opcodes once the row's last opaque pixel is done.

Scanline
--------
    u16 lineLength      ; 0 -> blank (fully transparent) row, 2 bytes total
    u16 xSkip           ; starting x within the cell -- counts toward lineLength
    (lineLength - 2) opcode bytes
Driver: `vga`+0x1DC2 `lodsw` / `or ax,ax / jz` (blank row) / `mov bp,si;
add bp,ax` (line end) / `lodsw; add di,ax` (xSkip). The row loop terminates on
`cmp si,bp / je`, i.e. only on an *exact* landing — an opcode overrunning the
line would run the decoder away, so the stream is always exactly consumed.

Opcodes (`vga`+0x1DE0..0x1E11)
-----------------------------
    0x00-0x7F  literal run: the next (op + 1) bytes are palette indices
               (`test al,0x80 / jz`; `mov cl,al; inc cx`; `rep movsw/movsb`)
    0x80-0xBF  transparent skip of (op & 0x3F) + 1 pixels
               (`test al,0x40 / jz`; `and ax,0x3f; inc ax; add di,ax`)
    0xC0-0xFF  run: the next byte is a palette index, drawn (op & 0x3F) + 3 times
               (`and cl,0x3f; add cl,0x3`; `lodsb; mov ah,al`; `rep stosw/stosb`)

This is NOT the MM4/5 "Xeen" grammar (3-bit cmd + 5-bit len, 8 opcode classes,
pattern/ramp and stream-copy commands). MM3's is a strictly simpler 1-/2-bit
scheme with only three commands; applying the Xeen grammar decodes ~80% of
MM3 lines by luck and desyncs on the rest.
"""
from __future__ import annotations

import struct

TRANSPARENT = -1


def op_size(op: int) -> int:
    """Total stream bytes consumed by an opcode, including its operands."""
    if op < 0x80:
        return 1 + op + 1
    if op < 0xC0:
        return 1
    return 2


def op_pixels(op: int) -> int:
    """Pixels advanced by an opcode."""
    if op < 0x80:
        return op + 1
    if op < 0xC0:
        return (op & 0x3F) + 1
    return (op & 0x3F) + 3


def is_sprite_container(data: bytes) -> bool:
    """Cheap structural test: frame table present and first cell right after it."""
    if len(data) < 6:
        return False
    n = struct.unpack_from('<H', data, 0)[0]
    if n == 0 or 2 + n * 4 > len(data):
        return False
    offs = _cell_offsets(data, n)
    return bool(offs) and offs[0] == 2 + n * 4 and offs[-1] < len(data)


def _cell_offsets(data: bytes, n: int) -> list[int]:
    seen = set()
    for i in range(n):
        c1, c2 = struct.unpack_from('<HH', data, 2 + i * 4)
        for c in (c1, c2):
            if c:
                seen.add(c)
    return sorted(seen)


def parse_container(data: bytes) -> tuple[int, list[tuple[int, int]]]:
    """Returns (frameCount, [(cell1Offset, cell2Offset), ...])."""
    n = struct.unpack_from('<H', data, 0)[0]
    if n == 0 or 2 + n * 4 > len(data):
        raise ValueError('not an MM3 sprite container')
    return n, [struct.unpack_from('<HH', data, 2 + i * 4) for i in range(n)]


def cell_header(data: bytes, off: int) -> tuple[int, int, int, int]:
    """Returns (xOffset, width, yOffset, height)."""
    return struct.unpack_from('<HHHH', data, off)


def draw_cell(data: bytes, off: int, canvas: list[list[int]]) -> int:
    """Draw one cell onto `canvas` (list of rows of palette indices, -1 =
    transparent). Returns the stream offset just past the cell."""
    xo, _w, yo, h = cell_header(data, off)
    ch = len(canvas)
    cw = len(canvas[0]) if ch else 0
    p = off + 8
    for y in range(h):
        line_len = struct.unpack_from('<H', data, p)[0]
        if line_len == 0:
            p += 2
            continue
        end = p + 2 + line_len
        x = struct.unpack_from('<H', data, p + 2)[0]
        q = p + 4
        row = yo + y
        while q < end:
            op = data[q]
            if op < 0x80:
                n = op + 1
                if 0 <= row < ch:
                    dst = canvas[row]
                    for i in range(n):
                        dx = xo + x + i
                        if 0 <= dx < cw:
                            dst[dx] = data[q + 1 + i]
                x += n
                q += 1 + n
            elif op < 0xC0:
                x += (op & 0x3F) + 1
                q += 1
            else:
                n = (op & 0x3F) + 3
                v = data[q + 1]
                if 0 <= row < ch:
                    dst = canvas[row]
                    for i in range(n):
                        dx = xo + x + i
                        if 0 <= dx < cw:
                            dst[dx] = v
                x += n
                q += 2
        if q != end:
            raise ValueError(f'opcode stream overran line end at 0x{p:X} '
                             f'(consumed {q - (p + 4)}, declared {line_len - 2})')
        p = end
    return p


def canvas_size(data: bytes) -> tuple[int, int]:
    """Bounding size covering every cell of every frame."""
    n, frames = parse_container(data)
    cw = ch = 0
    for c1, c2 in frames:
        for c in (c1, c2):
            if c:
                xo, w, yo, h = cell_header(data, c)
                cw = max(cw, xo + w)
                ch = max(ch, yo + h)
    return cw, ch


def decode_frames(data: bytes) -> tuple[list[list[list[int]]], int, int]:
    """Decode every frame. Returns (frames, width, height); each frame is a
    height x width grid of palette indices with -1 for transparent."""
    n, frames = parse_container(data)
    cw, ch = canvas_size(data)
    out = []
    for c1, c2 in frames:
        canvas = [[TRANSPARENT] * cw for _ in range(ch)]
        for c in (c1, c2):
            if c:
                draw_cell(data, c, canvas)
        out.append(canvas)
    return out, cw, ch

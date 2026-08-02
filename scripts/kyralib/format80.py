"""Westwood "Format80"/LCW decompressor and the shared Kyra bitmap header.

Byte-exact port of ScummVM's Screen::decodeFrame4 and Screen::loadBitmap
(engines/kyra/graphics/screen.cpp, fetched 2026-08-02). Cross-checked
against an independent reimplementation (scripts/eotb3lib/cps.py's
decompress_lcw, itself checked against the open-source "ThirdEye" EOB3
port) — both produce the same algorithm. Verified against real files:
decompressing every EOBDATA1.PAK .CMP entry and EOBDATA3.PAK's BRICK.VCN
reproduces exactly the header's declared uncompressed size with zero
length deviation; BRICK1.CPS + BRICK.PAL render as a legible sprite sheet
(see docs/eotb/dosvga/data-structure.md).

Shared bitmap header (little-endian), used by .CPS/.CMP/.VCN files and any
other "Screen::loadBitmap"-style resource:
    u16  file_size_field   (= file size - 2; unused by the decoder)
    u16  comp_type         0 = raw, 1/3 = other Format80 variants (unused by
                            this engine family's DOS files), 4 = LCW
    u32  img_size           uncompressed payload size
    u16  pal_size           0, or an embedded-palette byte count
    u8[pal_size] palette
    u8[] payload            raw or LCW-compressed pixel/tile data
"""
from __future__ import annotations

import struct
from dataclasses import dataclass


def decode_frame4(src: bytes, dst_size: int) -> bytes:
    """LCW (Format80) decompression. Port of Screen::decodeFrame4."""
    dst = bytearray(dst_size)
    sp = 0
    dp = 0
    while True:
        count = dst_size - dp
        if count == 0:
            break
        code = src[sp]; sp += 1
        if not (code & 0x80):
            length = min(count, (code >> 4) + 3)
            offs = ((code & 0xF) << 8) | src[sp]; sp += 1
            src_off = dp - offs
            for _ in range(length):
                dst[dp] = dst[src_off]
                dp += 1
                src_off += 1
        elif code & 0x40:
            length = (code & 0x3F) + 3
            if code == 0xFE:
                length = src[sp] | (src[sp + 1] << 8); sp += 2
                if length > count:
                    length = count
                val = src[sp]; sp += 1
                for _ in range(length):
                    dst[dp] = val
                    dp += 1
            else:
                if code == 0xFF:
                    length = src[sp] | (src[sp + 1] << 8); sp += 2
                offs = src[sp] | (src[sp + 1] << 8); sp += 2
                if length > count:
                    length = count
                src_off = offs
                for _ in range(length):
                    dst[dp] = dst[src_off]
                    dp += 1
                    src_off += 1
        elif code != 0x80:
            length = min(count, code & 0x3F)
            for _ in range(length):
                dst[dp] = src[sp]; sp += 1; dp += 1
        else:
            break
    return bytes(dst)


def decode_frame3(src: bytes, dst_size: int, is_amiga: bool = False) -> bytes:
    """RLE (compType 3). Port of Screen::decodeFrame3.

    Signed lead byte: 0 = run (u16 count, BE on DOS / LE on Amiga, + 1 fill
    byte); negative = short run (-code fill bytes, next byte is the value);
    positive = literal copy of `code` bytes.
    """
    dst = bytearray()
    sp = 0
    n = len(src)
    while len(dst) < dst_size and sp < n:
        code = src[sp]; sp += 1
        signed = code - 256 if code >= 128 else code
        if signed == 0:
            if is_amiga:
                sz = src[sp] | (src[sp + 1] << 8)
            else:
                sz = (src[sp] << 8) | src[sp + 1]
            sp += 2
            val = src[sp]; sp += 1
            dst.extend(bytes([val]) * sz)
        elif signed < 0:
            val = src[sp]; sp += 1
            dst.extend(bytes([val]) * (-signed))
        else:
            dst.extend(src[sp:sp + signed])
            sp += signed
    return bytes(dst[:dst_size])


@dataclass
class KyraBitmap:
    comp_type: int
    img_size: int
    pal_size: int
    palette: bytes
    payload: bytes  # raw or LCW-compressed, NOT yet decompressed


def parse_header(chunk: bytes) -> KyraBitmap:
    file_size_field, comp_type, img_size, pal_size = struct.unpack_from('<HHIH', chunk, 0)
    pal = chunk[10:10 + pal_size]
    payload = chunk[10 + pal_size:]
    return KyraBitmap(comp_type, img_size, pal_size, pal, payload)


def decompress_bitmap(chunk: bytes) -> tuple[KyraBitmap, bytes]:
    """Parse a Kyra bitmap header and return (header, decompressed pixels/payload)."""
    h = parse_header(chunk)
    if h.comp_type == 0:
        return h, h.payload[:h.img_size]
    elif h.comp_type == 3:
        return h, decode_frame3(h.payload, h.img_size, is_amiga=False)
    elif h.comp_type == 4:
        return h, decode_frame4(h.payload, h.img_size)
    else:
        raise NotImplementedError(f'Kyra bitmap compType {h.comp_type} not implemented (only 0, 3, 4 seen in this corpus)')

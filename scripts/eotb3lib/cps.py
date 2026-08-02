"""Westwood CPS image loader + LCW (Format80) decompressor.

Format confirmed byte-exact against data/eotb3/dosvga/CHARGEN/*.CPS and
cross-checked against ThirdEye's apps/thirdeye/graphics/cps.cpp (an
independent open-source reimplementation of the same DOS-era Westwood
format used across the studio's catalogue, e.g. Dune II, Kyra engine
titles). See docs/eotb3/dosvga/data-structure.md.

File layout:
    u16 fileSize          entire file size in bytes (data after this field)
    u16 compression        0 = raw, 4 = LCW/Format80
    u32 uncompressedSize   typically 64000 = 320*200 (full VGA screen)
    u16 paletteSize        0 if no embedded palette, else 768 (256 * 3, 6-bit VGA)
    u8  palette[paletteSize]
    u8  data[]             raw or LCW-compressed pixel data

LCW (Format80) opcodes, dispatched on the top bits of the command byte:
    0xxxxxxx <b1>          short relative copy from output; len=((c>>4)&7)+3,
                            offset=((c&0x0F)<<8)|b1 (back-reference, 1..4095)
    10xxxxxx                literal run of (c & 0x3F) bytes; 0x80 = end of stream
    11xxxxxx (c < 0xFE)     medium copy from absolute output position (u16 LE);
                            len = (c & 0x3F) + 3
    0xFE <u16 count><u8 c>  large fill: write `count` copies of byte c
    0xFF <u16 count><u16 pos> large copy from absolute output position `pos`
"""
from __future__ import annotations

import struct


def decompress_lcw(src: bytes, dest_size: int) -> bytearray:
    dest = bytearray()
    i = 0
    n = len(src)
    while i < n and len(dest) < dest_size:
        c = src[i]
        i += 1
        if (c & 0x80) == 0:
            # short relative copy
            if i >= n:
                break
            b1 = src[i]
            i += 1
            count = ((c & 0x70) >> 4) + 3
            offset = ((c & 0x0F) << 8) | b1
            for _ in range(count):
                if len(dest) >= dest_size:
                    break
                pos = len(dest) - offset
                dest.append(dest[pos] if 0 <= pos < len(dest) else 0)
        elif (c & 0x40) == 0:
            if c == 0x80:
                break
            count = c & 0x3F
            take = src[i:i + count]
            dest.extend(take)
            i += count
        elif c == 0xFE:
            if i + 3 > n:
                break
            count = src[i] | (src[i + 1] << 8)
            colour = src[i + 2]
            i += 3
            count = min(count, dest_size - len(dest))
            dest.extend(bytes([colour]) * count)
        elif c == 0xFF:
            if i + 4 > n:
                break
            count = src[i] | (src[i + 1] << 8)
            pos = src[i + 2] | (src[i + 3] << 8)
            i += 4
            count = min(count, dest_size - len(dest))
            for k in range(count):
                p = pos + k
                dest.append(dest[p] if 0 <= p < len(dest) else 0)
        else:
            if i + 2 > n:
                break
            count = (c & 0x3F) + 3
            pos = src[i] | (src[i + 1] << 8)
            i += 2
            for k in range(count):
                if len(dest) >= dest_size:
                    break
                p = pos + k
                dest.append(dest[p] if 0 <= p < len(dest) else 0)
    return dest


def load_cps(path_or_bytes) -> dict:
    if isinstance(path_or_bytes, (bytes, bytearray)):
        data = bytes(path_or_bytes)
    else:
        with open(path_or_bytes, "rb") as f:
            data = f.read()

    if len(data) < 10:
        raise ValueError("CPS file too short")

    file_size, compression, uncomp_size, pal_size = struct.unpack_from("<HHIH", data, 0)
    off = 10
    palette = b""
    if pal_size:
        palette = data[off:off + pal_size]
        off += pal_size

    if compression == 0:
        pixels = data[off:off + uncomp_size]
    elif compression == 4:
        pixels = bytes(decompress_lcw(data[off:], uncomp_size))
    else:
        raise ValueError(f"unknown CPS compression method {compression}")

    if len(pixels) != uncomp_size:
        raise ValueError(
            f"CPS decode size mismatch: got {len(pixels)}, expected {uncomp_size}"
        )

    return {
        "file_size": file_size,
        "compression": compression,
        "uncompressed_size": uncomp_size,
        "palette": palette,
        "pixels": pixels,
        "width": 320,
        "height": 200,
    }

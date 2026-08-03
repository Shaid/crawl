"""AESOP/EOB3 bitmap decoders.

Three distinct on-disk sub-formats, all confirmed against real files and
cross-checked against ThirdEye's apps/thirdeye/graphics/bitmap.cpp/.hpp
(independent open-source reimplementation). See
docs/eotb3/dosvga/data-structure.md for the byte tables.

1. "Old format" row/span RLE (GFF BMP/BMA cutscene frames -- INTRO/DARK/
   FINALE/LICH.GFF; also used directly, un-wrapped, inside Dungeon Hack's
   HACK.RES/OPEN.RES for full-screen event art and wall/decoration LOD
   sprite sets -- see docs/dungeonhack/dosvga/data-structure.md):
     u16 fileSize-ish / unused
     u16 unknown1
     u16 numSubBitmaps      @ offset 4
     u32 offsetTable[numSubBitmaps]   4 B stride, full u32 LE file offset
                                       (table starts @ offset 6). EOB3's
                                       EYE.RES never has a resource bigger
                                       than 64KB using this format, so the
                                       field's top 16 bits always read 0
                                       there and an earlier draft of this
                                       decoder mis-documented/mis-read it as
                                       u16 -- confirmed wrong against
                                       Dungeon Hack's "Drawbridge" resource
                                       (130544 B, 6 sub-frames, entries 3-5
                                       need offsets > 65535); the corrected
                                       u32 read produces byte-identical
                                       results to the old u16 read for every
                                       EOB3 file (regression-checked) and
                                       additionally decodes DH's large
                                       resources correctly. Independently
                                       confirmed field-for-field against
                                       Mirek Luza's DAESOP decompiler
                                       (`convert.c`'s
                                       `getNewBitmapForOldBitmap()`, which
                                       explicitly reads all 4 bytes of each
                                       offset-table entry as well as the
                                       4-byte total-size field at offset 0)
                                       -- see
                                       docs/dungeonhack/dosvga/data-structure.md.
     per sub-bitmap, at its offset:
         u16 width, u16 height, then a scanline stream:
             byte y (0xFF = end of image)
             repeat: u16 x (low 15 bits) | bit15=islast, u8 span_width,
                     then span_width pixels' worth of run/copy tokens:
                         byte token: bit0 = mode (0=copy literal bytes,
                                     1=fill with next byte), bits1-7 =
                                     amount-1
                     until span consumed; if islast, next byte is a new y
                     (or 0xFF to end).
     BMA (bitmap *animation*) uses the SAME format, not a chained variant:
     numSubBitmaps in a real BMA blob is the full frame count (e.g. 66 for
     one INTRO.GFF animation) and every offset in the table already points
     at a valid, independent frame -- decode_all_subbitmaps() handles both
     BMP (numSubBitmaps==1) and BMA (numSubBitmaps>1) uniformly. (An earlier
     draft of this module assumed frames were chained end-to-end via
     next_pos with no directory; checking a real BMA blob showed that was
     wrong -- the directory covers every frame already.)

2. AESOP/16 "1.10" VFX shape table (every bitmap resource embedded directly
   in EYE.RES -- monsters, items, UI, portraits used in-game):
     4-byte version tag "1.10"
     u32 shapeCount
     shapeCount x 8-byte directory entries {u32 offset, u32 colour}
     each entry's offset points at a 24-byte per-shape header (fields beyond
     boundsy/boundsx not yet decoded), followed by a per-line token stream:
         0            end of line
         1 <n>        skip n transparent pixels
         even>=2      run: amount=marker>>1, next byte = pixel value repeated
         odd>=3       string: amount=marker>>1, then `amount` literal pixels
       (boundsy = height-1 @ shapeHeaderOffset+0, boundsx = width-1 @ +2)

3. CHARGEN/CHARPICS.BMP portrait sheet:
     u32 fileSize (== actual file size)
     u16 count
     u16 tableEnd    (file offset where portrait 0's 4-byte sub-header starts)
     u16 zero
     u32 offsets[count-1]   (offsets[i] = start of portrait i+1's sub-header)
     each portrait: u16 width-1, u16 height, then the SAME scanline-RLE
     stream as format 1 (old format), single-image (no y/islast wrapper
     needed beyond the standard scanline loop).
"""
from __future__ import annotations

import struct


def decode_old_format_scanlines(blob: bytes, off: int, width: int, height: int):
    """Decode the row/span RLE stream starting at `off` (just past the
    width/height sub-header) into a width*height indexed pixel buffer.
    Returns (pixels, next_pos) where next_pos is the file offset right after
    the terminating 0xFF row marker (used to find the next BMA frame)."""
    pixels = bytearray(width * height)
    pos = off
    n = len(blob)
    while pos < n:
        y = blob[pos]
        if y == 0xFF:
            pos += 1
            break
        if y >= height:
            raise ValueError(f"scanline y={y} >= height {height} at {pos:#x}")
        pos += 1
        while True:
            if pos + 4 > n:
                raise ValueError(f"span header runs past end of buffer at {pos:#x}")
            x = blob[pos] | ((blob[pos + 1] & 0x7F) << 8)
            islast = blob[pos + 1] & 0x80
            span_width = blob[pos + 2]
            pos += 4  # 4th byte (span byte-count) unused by the decode itself
            remaining = span_width
            while remaining > 0:
                tok = blob[pos]
                mode = tok & 1
                amount = (tok >> 1) + 1
                pos += 1
                base = y * width + x
                if mode == 0:  # copy literal bytes
                    pixels[base:base + amount] = blob[pos:pos + amount]
                    pos += amount
                else:  # fill
                    value = blob[pos]
                    pos += 1
                    pixels[base:base + amount] = bytes([value]) * amount
                x += amount
                remaining -= amount
            if islast:
                break
    return pixels, pos


def decode_old_format_bitmap(blob: bytes, off: int = 0) -> dict:
    """Decode a single old-format sub-bitmap (numSubBitmaps read at off+4;
    only sub-bitmap 0 is decoded -- callers needing every sub-image should
    walk the offset table directly, see decode_all_subbitmaps)."""
    subbitmaps = decode_all_subbitmaps(blob, off)
    return subbitmaps[0]


def decode_all_subbitmaps(blob: bytes, off: int = 0) -> list:
    num_sub = struct.unpack_from("<H", blob, off + 4)[0]
    out = []
    for i in range(num_sub):
        sub_off = struct.unpack_from("<I", blob, off + 6 + i * 4)[0]
        width, height = struct.unpack_from("<HH", blob, sub_off)
        pixels, next_pos = decode_old_format_scanlines(blob, sub_off + 4, width, height)
        out.append({"width": width, "height": height, "pixels": pixels, "next_pos": next_pos})
    return out


def decode_vfx_shape(blob: bytes, dir_off: int, index: int) -> dict:
    """Decode one shape of an AESOP/16 '1.10' VFX shape table (EYE.RES bitmaps)."""
    if blob[0:4] != b"1.10":
        raise ValueError("not a '1.10' VFX shape table")
    count = struct.unpack_from("<I", blob, 4)[0]
    if index >= count:
        raise IndexError(f"shape index {index} >= count {count}")
    entry_off = 8 + index * 8
    shape_off = struct.unpack_from("<I", blob, entry_off)[0]
    boundsy_m1, boundsx_m1 = struct.unpack_from("<HH", blob, shape_off)
    width = boundsx_m1 + 1
    height = boundsy_m1 + 1
    pixels = bytearray(width * height)
    mask = bytearray(width * height)
    pos = shape_off + 24
    n = len(blob)
    for y in range(height):
        if pos >= n:
            break
        x = 0
        while pos < n:
            marker = blob[pos]
            pos += 1
            if marker == 0:
                break
            if marker == 1:
                if pos >= n:
                    break
                x += blob[pos]
                pos += 1
                continue
            amount = marker >> 1
            if marker & 1:  # string: literal pixels
                for _ in range(amount):
                    if pos >= n:
                        break
                    px = blob[pos]
                    pos += 1
                    if x < width:
                        at = y * width + x
                        pixels[at] = px
                        mask[at] = 1
                    x += 1
            else:  # run
                if pos >= n:
                    break
                px = blob[pos]
                pos += 1
                for _ in range(amount):
                    if x < width:
                        at = y * width + x
                        pixels[at] = px
                        mask[at] = 1
                    x += 1
    return {"width": width, "height": height, "pixels": pixels, "mask": mask, "count": count}


def vfx_shape_count(blob: bytes) -> int:
    if blob[0:4] != b"1.10":
        return 0
    return struct.unpack_from("<I", blob, 4)[0]


def looks_like_charpics_dir(blob: bytes) -> bool:
    if len(blob) < 12:
        return False
    if struct.unpack_from("<I", blob, 0)[0] != len(blob):
        return False
    count, table_end = struct.unpack_from("<HH", blob, 4)
    if count < 2 or count > 4096:
        return False
    if table_end != 10 + (count - 1) * 4:
        return False
    if table_end + 4 > len(blob):
        return False
    o0 = struct.unpack_from("<I", blob, 10)[0]
    return o0 > table_end and o0 + 4 <= len(blob)


def decode_charpics(blob: bytes) -> list:
    """Decode CHARGEN/CHARPICS.BMP into a list of {width,height,pixels} portraits."""
    if not looks_like_charpics_dir(blob):
        raise ValueError("not a CHARPICS-style directory")
    count, table_end = struct.unpack_from("<HH", blob, 4)
    offsets = [table_end]
    last = table_end
    for i in range(1, count):
        pos = 10 + (i - 1) * 4
        v = struct.unpack_from("<I", blob, pos)[0]
        if v <= last or v + 4 > len(blob):
            break
        offsets.append(v)
        last = v
    out = []
    for off in offsets:
        width_m1, height = struct.unpack_from("<HH", blob, off)
        width = width_m1 + 1
        pixels, _next_pos = decode_old_format_scanlines(blob, off + 4, width, height)
        out.append({"width": width, "height": height, "pixels": pixels})
    return out

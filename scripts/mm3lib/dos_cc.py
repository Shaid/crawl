#!/usr/bin/env python3
"""MM3.CC (DOS Might & Magic III) container reader + LZHUF.

Ported from rewolf-mm3-dumper (https://github.com/rwfpl/rewolf-mm3-dumper),
verified byte-exact against the compiled C++ reference on all 556 compressed
entries of the real MM3.CC. Note: streams are decoded with 16 bytes of 0x00
padding past their end (the C reference reads past the buffer).

Format (confirmed prior art — ReWolf's reverse-engineering + rewolf-mm3-dumper,
https://github.com/rwfpl/rewolf-mm3-dumper, blog post http://blog.rewolf.pl/blog/?p=1202):

  FileHeader {
    u16 numEntries;
    FileEntry entries[numEntries];   // 8 bytes each, XOR-cipher encrypted
  }
  FileEntry { u16 hash; u16 offsetLo; u8 offsetHi; u16 compressedSize; u8 pad; }

  offset field is 24-bit (offsetHi<<16 | offsetLo), file-relative.

  Header cipher: key starts 0xAC, per byte: b = rotl8(b,2) + key; key += 0x67.
  (decrypt direction)

  Filename hash: h = rotl16(h, 9) + lowercased-char (ch & 0x7F < 0x60 keeps case).
  The lowercase rule: if (ch & 0x7F) < 0x60 keep ch else ch - 0x20.

  First two entries are special (uncompressed, size-limited in the exe).
  Other entries: 4-byte descriptor { u8 init; u8 init; u16 BE decompressedSize }
  then an LZHUF stream (classic lzhuf.c with per-stream dictionary init byte).
"""
from __future__ import annotations
import struct, sys, os

# ---------- the LZHUF decompressor (ported from rwf_lzhuf.cpp, itself the
# canonical lzhuf.c with the MM3 per-stream dictionary-init twist) ----------

D_LEN = (
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
)
D_CODE = (
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7,
    8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9,
    10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11,
    12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15,
    16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19,
    20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23,
    24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31,
    32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39,
    40, 40, 41, 41, 42, 42, 43, 43, 44, 44, 45, 45, 46, 46, 47, 47,
    48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
)
LZHUF_N = 0x1000
LZHUF_F = 0x3C
LZHUF_THRESHOLD = 2
LZHUF_N_CHAR = 0x100 - LZHUF_THRESHOLD + LZHUF_F   # 0x13A
LZHUF_T = LZHUF_N_CHAR * 2 - 1                     # 0x273
LZHUF_R = LZHUF_T - 1                              # 0x272
LZHUF_MAX_FREQ = 0x8000


def _rotl16(v, n):
    return ((v << n) | (v >> (16 - n))) & 0xFFFF


def lzhuf_decompress(data: bytes, out_size: int, init_value: int) -> bytes:
    # The reference C implementation reads 16-bit words past the stream end
    # (the last refill can happen after the final output byte). Pad so the
    # Python port behaves identically; verified byte-exact vs the C++ on all
    # 556 compressed entries of the real MM3.CC.
    data = data + b'\x00' * 16
    freq = [0] * (LZHUF_T + 1)
    prnt = [0] * (LZHUF_T + LZHUF_N_CHAR)
    son = [0] * LZHUF_T
    cache = 0x8000
    in_pos = 0

    def get_bit():
        nonlocal cache, in_pos
        bit = cache >> 15
        cache = (cache << 1) & 0xFFFF
        if cache == 0:
            cache = struct.unpack_from('>H', data, in_pos)[0]
            in_pos += 2
            bit = cache >> 15
            cache = ((cache << 1) | 1) & 0xFFFF
        return bit & 1

    for i in range(LZHUF_N_CHAR):
        freq[i] = 1
        prnt[i + LZHUF_T] = i
        son[i] = i + LZHUF_T
    j = LZHUF_N_CHAR
    i = 0
    while j < LZHUF_T:
        freq[j] = freq[i] + freq[i + 1]
        son[j] = i
        prnt[i] = j
        prnt[i + 1] = j
        i += 2
        j += 1
    prnt[LZHUF_R] = 0
    freq[LZHUF_T] = 0xFFFF

    text_buf = bytearray([init_value] * LZHUF_N)
    text_buf_index = LZHUF_N - LZHUF_F
    out = bytearray()
    while len(out) < out_size:
        c = son[LZHUF_R]
        while c < LZHUF_T:
            bit = get_bit()
            c += bit
            c = son[c]
        c -= LZHUF_T

        if freq[LZHUF_R] == LZHUF_MAX_FREQ:
            # tree reconstruction (from canonical lzhuf.c — not triggered by
            # MM3.CC streams, kept for completeness)
            j = 0
            for i in range(LZHUF_T):
                if son[i] >= LZHUF_T:
                    freq[j] = (freq[i] + 1) // 2
                    son[j] = son[i]
                    j += 1
            j = LZHUF_N_CHAR
            i = 0
            while j < LZHUF_T:
                k = i + 1
                f = freq[j] = freq[i] + freq[k]
                k = j - 1
                while f < freq[k]:
                    k -= 1
                k += 1
                l = j - k
                freq[k+1:k+1+l] = freq[k:k+l]
                freq[k] = f
                son[k+1:k+1+l] = son[k:k+l]
                son[k] = i
                i += 2
                j += 1
            for i in range(LZHUF_T):
                k = son[i]
                if k >= LZHUF_T:
                    prnt[k] = i
                else:
                    prnt[k] = prnt[k + 1] = i

        b = prnt[c + LZHUF_T]
        while True:
            k = freq[b] + 1
            freq[b] = k
            if k > freq[b + 1]:
                l = b + 1
                while k > freq[l]:
                    l += 1
                l -= 1
                freq[b] = freq[l]
                freq[l] = k
                i = son[b]
                prnt[i] = l
                if i < LZHUF_T:
                    prnt[i + 1] = l
                j = son[l]
                son[l] = i
                prnt[j] = b
                if j < LZHUF_T:
                    prnt[j + 1] = b
                son[b] = j
                b = l
            b = prnt[b]
            if b == 0:
                break

        if c < 0x100:
            out.append(c)
            text_buf[text_buf_index] = c
            text_buf_index = (text_buf_index + 1) & (LZHUF_N - 1)
            continue

        bt = 0
        for i in range(8):
            bit = cache >> 15
            cache = (cache << 1) & 0xFFFF
            if cache == 0:
                cache = struct.unpack_from('>H', data, in_pos)[0]
                in_pos += 2
                bit = 1
                for j in range(8 - i):
                    tmp_bit = cache >> 15
                    cache = ((cache << 1) | bit) & 0xFFFF
                    bit = tmp_bit
                    tmp_bit = bt >> 15
                    bt = (bt << 1) & 0xFFFF
                    bt |= bit
                    bit = tmp_bit
                break
            bt = (bt << 1) & 0xFFFF
            bt |= bit & 1

        dc = D_CODE[bt] << 6
        for _ in range(D_LEN[bt] - 2):
            bit = cache >> 15
            cache = (cache << 1) & 0xFFFF
            if cache == 0:
                cache = struct.unpack_from('>H', data, in_pos)[0]
                in_pos += 2
                bit = cache >> 15
                cache = ((cache << 1) | 1) & 0xFFFF
            bt = (bt << 1) & 0xFFFF
            bt |= bit & 1
        dc |= bt & 0x3F
        tbi2 = text_buf_index - dc - 1
        n = c - 0xFD
        for _ in range(n):
            tbi2 &= 0xFFF
            tmp = text_buf[tbi2]
            out.append(tmp)
            text_buf[text_buf_index] = tmp
            text_buf_index = (text_buf_index + 1) & (LZHUF_N - 1)
            tbi2 += 1
    return bytes(out)


# ---------- container ----------

def decrypt_header(buf: bytearray) -> None:
    key = 0xAC
    for i in range(len(buf)):
        b = buf[i]
        b = ((b << 2) | (b >> 6)) & 0xFF
        buf[i] = (b + key) & 0xFF
        key = (key + 0x67) & 0xFF


def hash_filename(name: str) -> int:
    h = 0
    for ch in name.encode('latin-1'):
        c = ch if (ch & 0x7F) < 0x60 else ch - 0x20
        h = _rotl16(h, 9)
        h = (h + c) & 0xFFFF
    return h


class CCFile:
    def __init__(self, hash_, offset, comp_size):
        self.hash = hash_
        self.offset = offset
        self.comp_size = comp_size

    def __repr__(self):
        return f"CCFile(hash=0x{self.hash:04X} off=0x{self.offset:X} csize={self.comp_size})"


def parse(data: bytes) -> tuple[list[CCFile], bytes]:
    n = struct.unpack_from('<H', data, 0)[0]
    hdr = bytearray(data[2:2 + n * 8])
    decrypt_header(hdr)
    entries = []
    for i in range(n):
        h, offlo, offhi, csize, pad = struct.unpack_from('<HHBHB', hdr, i * 8)
        entries.append(CCFile(h, (offhi << 16) | offlo, csize))
    return entries, data


def extract_entry(data: bytes, e: CCFile) -> tuple[bytes | None, str]:
    """Returns (payload, kind) — kind in {'lzhuf','raw','invalid'}."""
    if e.offset + e.comp_size > len(data):
        return None, 'invalid'
    blk = data[e.offset:e.offset + e.comp_size]
    if e.comp_size >= 4:
        w1, w2 = struct.unpack_from('>HH', blk, 0)
        # w1 = init byte duplicated (hi==lo); w2 BE = decompressed size
        if (w1 & 0xFF) == (w1 >> 8):
            out = lzhuf_decompress(blk[4:], w2, w1 & 0xFF)
            return out, 'lzhuf'
    return blk, 'raw'


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'data/mm3/dosvga/MM3.CC'
    outdir = sys.argv[2] if len(sys.argv) > 2 else '/tmp/opencode/mm3cc_out'
    data = open(path, 'rb').read()
    entries, _ = parse(data)
    os.makedirs(outdir, exist_ok=True)
    print(f'{len(entries)} entries, header {2 + len(entries)*8} bytes')
    for i, e in enumerate(entries):
        payload, kind = extract_entry(data, e)
        fn = f'{outdir}/entry_{i:03d}_h{e.hash:04X}.bin'
        if payload is not None:
            with open(fn, 'wb') as f:
                f.write(payload)
            print(f'{i:03d} h={e.hash:04X} off=0x{e.offset:X} csize={e.comp_size} -> {kind} {len(payload)}B {fn}')
        else:
            print(f'{i:03d} h={e.hash:04X} INVALID (off 0x{e.offset:X}+{e.comp_size} > file)')

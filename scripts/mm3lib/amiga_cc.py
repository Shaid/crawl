#!/usr/bin/env python3
"""Might & Magic III (Amiga) .cc container reader.

Reverse-engineered from the game's own loader in the `Might&MagicIII`
executable (root CODE hunk — see docs/mm3/amiga/data-structure.md for the
full trace):

  cc file:
    u16 BE count
    count x { u16 BE key; u32 BE offset; u32 BE size }   (10-byte entries)
    payload entries at `offset`, each exactly `size` bytes (entries tile,
    zero gap)

  key = amiga_hash(filename): fold16(rotl32(h, 5) + uppercase(c)) — the same
  filename-hash family as the DOS port but with rotl32/5 + 16-bit fold
  (verified 420/449 named keys against the DOS filename list).

  payload entry (most entries):
    u32 BE = size - 8          (compressed stream length, redundant)
    u32 BE = decompressed size
    LZ77 stream (exactly size-8 bytes): flag-byte bitstream, LSB first;
      bit 1 = literal byte follows; bit 0 = match: { lo, hi } ->
        dist = (((hi & 0xF0) << 4) | lo) & 0xFFF   (absolute ring position)
        len  = (hi & 0x0F) + 3
      ring 4096 bytes, init 0x20, write index starts 0xFEE, wraps & 0xFFF.

  Special case: global.cc entry 0 is NOT compressed — it is a raw text
  string ("There are only %lu bytes free of ..."), detected by
  u32@+0 != size - 8.

All 553 entries across the 8 shipped .cc files decode with zero deviation
(every LZ entry consumes exactly size-8 bytes and produces exactly the
declared decompressed size); the decoder is a faithful port of the game's
routine at CODE hunk payload 0x55C4.
"""
from __future__ import annotations
import struct

_CC_FILES = ['game.cc', 'global.cc', 'intro.cc',
             'mm3-01.cc', 'mm3-02.cc', 'mm3-03.cc', 'mm3-04.cc', 'mm3-05.cc']


def amiga_hash(name: str) -> int:
    """The Amiga port's filename hash (verified against the in-exe routine
    at CODE payload 0x567A and 420 real filename/key pairs)."""
    h = 0
    for ch in name.encode('latin-1'):
        c = ch & 0x7F
        if c > 0x60:
            c -= 0x20
        h = ((h << 5) | (h >> 27)) & 0xFFFFFFFF
        h = (h + c) & 0xFFFFFFFF
    return ((h & 0xFFFF) + (h >> 16)) & 0xFFFF


class Entry:
    __slots__ = ('key', 'offset', 'size', 'file', 'index')

    def __init__(self, key, offset, size, file, index):
        self.key = key
        self.offset = offset
        self.size = size
        self.file = file
        self.index = index


def read_directory(data: bytes, fname: str = '') -> list:
    count = struct.unpack_from('>H', data, 0)[0]
    entries = []
    for i in range(count):
        key, off, size = struct.unpack_from('>HII', data, 2 + i * 10)
        entries.append(Entry(key, off, size, fname, i))
    return entries


def lz_decompress(stream: bytes, out_size: int) -> bytes:
    """Faithful port of the game's decompressor (CODE payload 0x55C4)."""
    ring = bytearray([0x20] * 4096)
    wi = 0xFEE
    pos = 0
    out = bytearray()
    flag = 0
    bits = 0
    while len(out) < out_size:
        if bits == 0:
            flag = stream[pos]
            pos += 1
            bits = 8
        if flag & 1:
            b = stream[pos]
            pos += 1
            out.append(b)
            ring[wi] = b
            wi = (wi + 1) & 0xFFF
        else:
            lo = stream[pos]
            hi = stream[pos + 1]
            pos += 2
            dist = (((hi & 0xF0) << 4) | lo) & 0xFFF
            n = (hi & 0x0F) + 3
            for k in range(n):
                b = ring[(dist + k) & 0xFFF]
                out.append(b)
                ring[wi] = b
                wi = (wi + 1) & 0xFFF
        flag >>= 1
        bits -= 1
    return bytes(out)


def extract_entry(data: bytes, e: Entry) -> tuple:
    """Returns (payload, kind) — kind in {'lz', 'raw', 'invalid'}."""
    if e.offset + e.size > len(data):
        return None, 'invalid'
    blk = data[e.offset:e.offset + e.size]
    if e.size >= 8:
        csize, decsize = struct.unpack_from('>II', blk, 0)
        if csize == e.size - 8:
            return lz_decompress(blk[8:], decsize), 'lz'
    return blk, 'raw'


def read_cc(path: str):
    data = open(path, 'rb').read()
    return data, read_directory(data, path.rsplit('/', 1)[-1])


def load_named_entries(base: str = 'data/mm3/amiga'):
    """All (name, payload, kind) across the 8 shipped .cc files, using the
    DOS filename list as the name oracle (420/449 keys resolve; the rest are
    Amiga-specific names)."""
    import os
    names = {}
    try:
        import re
        here = os.path.dirname(os.path.abspath(__file__))
        # DOS name list lives next to this module
        for line in open(os.path.join(here, 'dos_filenames.txt'), encoding='latin-1'):
            line = line.strip()
            if line:
                names[amiga_hash(line)] = line
    except OSError:
        pass
    for f in _CC_FILES:
        path = os.path.join(base, f)
        if not os.path.exists(path):
            continue
        data, entries = read_cc(path)
        for e in entries:
            payload, kind = extract_entry(data, e)
            if payload is None:
                continue
            yield names.get(e.key, f'entry{e.index}_k{e.key:04X}'), payload, kind, f, e

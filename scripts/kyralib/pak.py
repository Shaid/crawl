"""Westwood/Kyra PAK container directory parser.

Byte-exact port of ScummVM's ResLoaderPak::load (engines/kyra/resource/
resource_intern.cpp, fetched 2026-08-02). Verified against every
EOBDATA{1..6}.PAK in data/eotb/dosvga/ (all 6 parse cleanly, directory
offsets self-consistent, no corruption) — see
docs/eotb/dosvga/data-structure.md "PAK container" section.

Layout: the file opens directly on the directory (no separate header).
Each directory record is a NUL-terminated filename string followed by a
u32 LE "start offset of the NEXT entry's data" (which doubles as this
entry's end offset). The first entry's own start offset is read before
the loop. The directory ends at an empty filename, or when the read
offset equals the file size. A size-0 span (start == end, e.g. duplicate
boundary entries) is dropped, matching ScummVM's `if (startoffset !=
endoffset)` guard.

Not implemented here: the endian-autodetect fallback (Amiga/big-endian
PAKs) and the LINKLIST aliasing table — neither is exercised by any file
in data/eotb*/dosvga or data/landsoflore/dosvga (all little-endian, no
LINKLIST entry observed as of this port).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass


@dataclass
class PakEntry:
    name: str
    offset: int
    size: int


def parse_pak(data: bytes) -> list[PakEntry]:
    filesize = len(data)
    if filesize < 4:
        return []

    start_offset = struct.unpack_from('<i', data, 0)[0]
    first_offset = start_offset
    pos = 4
    entries: list[PakEntry] = []
    first_file = True

    while pos < filesize:
        if start_offset < pos or start_offset > filesize or start_offset < 0:
            raise ValueError(f'PAK directory corrupt at pos={pos}, start_offset={start_offset}')

        nul = data.index(b'\x00', pos)
        fname = data[pos:nul].decode('latin-1')
        pos = nul + 1

        if fname == '':
            if first_file:
                raise ValueError('PAK directory corrupt: empty first filename')
            break
        first_file = False

        end_offset = struct.unpack_from('<i', data, pos)[0]
        pos += 4

        if not end_offset or pos == first_offset:
            end_offset = filesize

        if start_offset != end_offset:
            entries.append(PakEntry(fname, start_offset, end_offset - start_offset))

        if end_offset == filesize:
            break
        start_offset = end_offset

    return entries


def load_pak(path: str) -> tuple[bytes, dict[str, PakEntry]]:
    """Read a PAK file and return (raw_bytes, {name: entry})."""
    data = open(path, 'rb').read()
    entries = parse_pak(data)
    return data, {e.name: e for e in entries}


def read_entry(data: bytes, entry: PakEntry) -> bytes:
    return data[entry.offset:entry.offset + entry.size]

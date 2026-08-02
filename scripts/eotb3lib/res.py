"""EYE.RES (AESOP/16 resource container) parser.

Format confirmed byte-exact against data/eotb3/dosvga/EYE.RES and
cross-checked against the independent open-source reimplementation
"ThirdEye" (github.com/psi29a/thirdeye, apps/thirdeye/resources/res.cpp,
res.hpp). See docs/eotb3/dosvga/data-structure.md for the byte tables and
verification evidence.

Layout:
    GlobalHeader (36 B):
        signature[16]            "AESOP/16 V1.00\0" + 1 pad byte
        file_size       u32 LE   total file size (verified byte-exact)
        lost_space      u32 LE
        first_directory_block u32 LE  (file offset of first DirectoryBlock)
        create_time     u32 LE   DOS packed datetime
        modify_time     u32 LE   DOS packed datetime

    DirectoryBlock (4 + 128 + 128*4 = 644 B), one per 128 resource slots,
    linked list via next_directory_block (0 = last block):
        next_directory_block   u32 LE  (file offset of next block, 0 = end)
        data_attributes[128]   u8      (1 = slot unused/free)
        entry_header_index[128] u32 LE (file offset of this slot's EntryHeader,
                                         0 = slot not present)

    EntryHeader (12 B), immediately followed by the resource's raw data:
        storage_time    u32 LE
        data_attributes u32 LE
        data_size       u32 LE

    Special tables 0..4 are themselves resources (slot ids 0..4 in the
    first directory block) holding AESOP dictionaries (see parse_dictionary):
        0 = resource name -> resource-id-as-decimal-string
        1, 2 = secondary name tables (object/source-file names)
        3 = low-level runtime function catalog
        4 = message (SEND vocabulary) names
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

AESOP_ID = b"AESOP/16 V1.00"
DIR_BLOCK_ITEMS = 128
GLOBAL_HEADER_SIZE = 36
DIR_BLOCK_SIZE = 4 + DIR_BLOCK_ITEMS + DIR_BLOCK_ITEMS * 4
ENTRY_HEADER_SIZE = 12


@dataclass
class Entry:
    slot: int
    start: int          # file offset of the EntryHeader
    offset: int          # file offset of the resource data (start + 12)
    size: int
    storage_time: int
    attributes: int
    name: str = ""       # resolved from table0, if present


@dataclass
class EyeRes:
    data: bytes
    file_size: int
    lost_space: int
    first_directory_block: int
    create_time: int
    modify_time: int
    dir_blocks: list = field(default_factory=list)   # list[(next_ptr, data_attrs, entry_idx[128])]
    entries: dict = field(default_factory=dict)       # slot -> Entry
    table0: dict = field(default_factory=dict)        # name -> slot id (int)

    def resource_bytes(self, slot: int) -> bytes:
        e = self.entries[slot]
        return self.data[e.offset:e.offset + e.size]

    def find(self, name: str):
        sid = self.table0.get(name)
        return None if sid is None else self.entries.get(sid)


def _rd_u16(b: bytes, off: int) -> int:
    return struct.unpack_from("<H", b, off)[0]


def _rd_u32(b: bytes, off: int) -> int:
    return struct.unpack_from("<I", b, off)[0]


def parse_dictionary(blob: bytes) -> dict:
    """Parse an AESOP dictionary blob (special tables 0..4, .EXPT/.IMPT resources).

    u16 bucket_count, then bucket_count x u32 chain-offset (relative to blob
    start; 0 = empty bucket). Each non-zero chain is a run of length-prefixed
    strings (u16 length INCLUDING trailing NUL) alternating key, value,
    terminated by a zero-length entry.
    """
    out = {}
    if len(blob) < 2:
        return out
    buckets = _rd_u16(blob, 0)
    prev = None
    counter = 1
    for i in range(buckets):
        boff = 2 + i * 4
        if boff + 4 > len(blob):
            break
        chain = _rd_u32(blob, boff)
        if chain == 0:
            continue
        p = chain
        while True:
            if p + 2 > len(blob):
                break
            length = _rd_u16(blob, p)
            p += 2
            if length == 0:
                break
            if p + length > len(blob):
                break
            s = blob[p:p + length]
            if s.endswith(b"\x00"):
                s = s[:-1]
            s = s.decode("latin-1")
            p += length
            if counter % 2 == 0:
                out[prev] = s
            else:
                prev = s
            counter += 1
    return out


def load(path: str) -> EyeRes:
    with open(path, "rb") as f:
        data = f.read()

    if data[0:len(AESOP_ID)] != AESOP_ID:
        raise ValueError(f"{path}: not an AESOP/16 resource (bad signature)")

    file_size, lost_space, first_dir, ctime, mtime = struct.unpack_from(
        "<IIIII", data, 16
    )

    res = EyeRes(
        data=data, file_size=file_size, lost_space=lost_space,
        first_directory_block=first_dir, create_time=ctime, modify_time=mtime,
    )

    # Walk directory block linked list.
    cur = first_dir
    while True:
        next_ptr = _rd_u32(data, cur)
        attrs = data[cur + 4:cur + 4 + DIR_BLOCK_ITEMS]
        idx_off = cur + 4 + DIR_BLOCK_ITEMS
        idx = struct.unpack_from(f"<{DIR_BLOCK_ITEMS}I", data, idx_off)
        res.dir_blocks.append((next_ptr, attrs, idx))
        if next_ptr == 0:
            break
        cur = next_ptr

    # Walk entries across all directory blocks -> slot ids assigned sequentially.
    slot = 0
    for (_next, _attrs, idx) in res.dir_blocks:
        for eh_off in idx:
            if eh_off == 0:
                break
            storage_time, attributes, size = struct.unpack_from("<III", data, eh_off)
            res.entries[slot] = Entry(
                slot=slot, start=eh_off, offset=eh_off + ENTRY_HEADER_SIZE,
                size=size, storage_time=storage_time, attributes=attributes,
            )
            slot += 1

    # Table0 = resource name -> id (special slot 0, right after the header's
    # first directory block; itself a normal entry at slot 0).
    if 0 in res.entries:
        e0 = res.entries[0]
        table0_raw = parse_dictionary(data[e0.offset:e0.offset + e0.size])
        for name, num_str in table0_raw.items():
            try:
                sid = int(num_str)
            except ValueError:
                continue
            res.table0[name] = sid
            if sid in res.entries:
                res.entries[sid].name = name

    return res

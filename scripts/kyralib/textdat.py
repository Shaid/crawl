"""`TEXT.DAT` NPC-dialogue string pool decode, EOB2-only.

Not an `EoBItem`-style table — loaded raw (no LCW) via
`EoBCoreEngine::npcSequence` (engines/kyra/engine/eobcommon.cpp:1397-1410,
`loadFileDataToPage(s, 5, 32000)`). Structurally decoded and verified this
pass (see docs/eotb2/dosvga/data-structure.md § "ITEM.DAT / ITEMTYPE.DAT /
TEXT.DAT"):

    u16 LE  offsets[N]     # N = offsets[0] / 2 (table's own byte length,
                            # in the first entry); each offsets[i] is an
                            # ABSOLUTE file offset (not pool-relative —
                            # offsets[0] itself equals the byte position
                            # where the string pool begins)
    char[]  string pool     # NUL-terminated strings, one per offset entry

Verified: all 122 offsets strictly increasing, first string starts exactly
at the table's own end (byte 244), last string ends well within the file.
"""
from __future__ import annotations

import struct


def parse_text_dat(data: bytes) -> list[str]:
    (first_offset,) = struct.unpack_from('<H', data, 0)
    if first_offset % 2 != 0 or first_offset == 0:
        raise ValueError(f'TEXT.DAT: implausible offsets[0]={first_offset}')
    n = first_offset // 2
    offsets = struct.unpack_from(f'<{n}H', data, 0)
    if list(offsets) != sorted(offsets):
        raise ValueError('TEXT.DAT: offsets not monotonically increasing')
    strings = []
    for start in offsets:
        end = data.index(0, start)
        strings.append(data[start:end].decode('latin1'))
    return strings

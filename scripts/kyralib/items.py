"""EOB1 (DOS) ITEM.DAT / ITEMTYPE.DAT parsers.

Byte-exact port of `EoBCoreEngine::loadItemDefs` (`engine/items_eob.cpp:35-
143`, fetched 2026-08-02). See docs/eotb/dosvga/data-structure.md §
"ITEM.DAT / ITEMTYPE.DAT" -- verified byte-exact against this project's
real EOBDATA6.PAK ITEM.DAT (9,601 bytes: numItems=448 -> 2+448*14=6274,
numNames=95 at that offset -> 6276+95*35=9601, file size exactly, zero
residue) and ITEMTYPE.DAT (914 bytes: numTypes=57 -> 2+57*16=914, file
size exactly, zero residue).
"""
from __future__ import annotations

import struct
from dataclasses import asdict, dataclass


@dataclass
class EobItem:
    name_unid: int
    name_id: int
    flags: int
    icon: int
    type: int
    pos: int
    block: int
    next: int
    prev: int
    level: int
    value: int


def parse_item_dat(data: bytes) -> tuple[list[EobItem], list[str]]:
    num_items = struct.unpack_from('<H', data, 0)[0]
    off = 2
    items = []
    for _ in range(num_items):
        (name_unid, name_id, flags, icon, itype, pos, block, nxt, prev, level, value) = struct.unpack_from(
            '<BBBbbbhhhBb', data, off)
        items.append(EobItem(name_unid, name_id, flags, icon, itype, pos, block, nxt, prev, level, value))
        off += 14
    num_names = struct.unpack_from('<H', data, off)[0]
    off += 2
    names = []
    for _ in range(num_names):
        raw = data[off:off + 35]
        nul = raw.find(b'\x00')
        names.append(raw[:nul if nul != -1 else 35].decode('latin1'))
        off += 35
    if off != len(data):
        raise ValueError(f'ITEM.DAT: expected to land exactly on EOF ({len(data)}), stopped at {off}')
    return items, names


def item_dat_to_json(item_dat: tuple[list[EobItem], list[str]]) -> dict:
    """JSON-shape adapter for `parse_item_dat`'s `(items, names)` tuple --
    added this session to fix a pre-existing `ImportError` in
    `extract_eotb2_dosvga.py` (it already imported this name, which didn't
    exist here yet; unrelated to this session's palette-resolution fix, but
    blocked the extractor from running at all). Same JSON shape EOB1's own
    `extract_eotb_dosvga.py::extract_item_data` already produces inline
    (`{'items': [...], 'names': [...]}`), for consistency."""
    items, names = item_dat
    return {'items': [asdict(it) for it in items], 'names': names}


@dataclass
class EobItemType:
    inv_flags: int
    hand_flags: int
    armor_class: int
    allowed_classes: int
    required_hands: int
    dmg_num_dice_s: int
    dmg_num_pips_s: int
    dmg_inc_s: int
    dmg_num_dice_l: int
    dmg_num_pips_l: int
    dmg_inc_l: int
    unk1: int
    extra_properties: int


def parse_itemtype_dat(data: bytes) -> list[EobItemType]:
    num_types = struct.unpack_from('<H', data, 0)[0]
    off = 2
    types = []
    for _ in range(num_types):
        fields = struct.unpack_from('<HHbbbbbbbbbBH', data, off)
        types.append(EobItemType(*fields))
        off += 16
    if off != len(data):
        raise ValueError(f'ITEMTYPE.DAT: expected to land exactly on EOF ({len(data)}), stopped at {off}')
    return types


def itemtype_dat_to_json(types: list[EobItemType]) -> dict:
    """JSON-shape adapter for `parse_itemtype_dat` -- see `item_dat_to_json`
    doc for why this was added this session."""
    return {'types': [asdict(t) for t in types]}

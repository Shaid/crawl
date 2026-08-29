"""ITEM.DAT / ITEMTYPE.DAT decode, shared EOB1/EOB2 DOS/VGA (and Amiga, modulo
endianness — not re-verified against Amiga bytes here).

Ported from ScummVM's `EoBCoreEngine::loadItemDefs` (engines/kyra/engine/
items_eob.cpp:35-143). Record widths are 14 bytes (`EoBItem`) and 16 bytes
(`EoBItemType`) — confirmed byte-exact (zero residue) against both EOB1's
`EOBDATA6.PAK` copies and EOB2's standalone `ITEM.DAT`/`ITEMTYPE.DAT`; see
docs/eotb/dosvga/data-structure.md and docs/eotb2/dosvga/data-structure.md
§ "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT".
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, asdict

ITEM_STRUCT = struct.Struct('<BBBbbbhhhBb')  # 14 bytes
NAME_LEN = 35
ITEMTYPE_STRUCT = struct.Struct('<HHbbbbbbbbbBH')  # 16 bytes


@dataclass
class EoBItem:
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


@dataclass
class EoBItemType:
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


@dataclass
class ItemDat:
    items: list[EoBItem]
    names: list[str]


def parse_item_dat(data: bytes) -> ItemDat:
    (num_items,) = struct.unpack_from('<H', data, 0)
    off = 2
    items = []
    for _ in range(num_items):
        items.append(EoBItem(*ITEM_STRUCT.unpack_from(data, off)))
        off += ITEM_STRUCT.size
    (num_names,) = struct.unpack_from('<H', data, off)
    off += 2
    names = []
    for _ in range(num_names):
        raw = data[off:off + NAME_LEN]
        names.append(raw.split(b'\x00', 1)[0].decode('latin1'))
        off += NAME_LEN
    if off != len(data):
        raise ValueError(f'ITEM.DAT residue: parsed {off} of {len(data)} bytes')
    return ItemDat(items, names)


def parse_itemtype_dat(data: bytes) -> list[EoBItemType]:
    (num_types,) = struct.unpack_from('<H', data, 0)
    off = 2
    types = []
    for _ in range(num_types):
        types.append(EoBItemType(*ITEMTYPE_STRUCT.unpack_from(data, off)))
        off += ITEMTYPE_STRUCT.size
    if off != len(data):
        raise ValueError(f'ITEMTYPE.DAT residue: parsed {off} of {len(data)} bytes')
    return types


def item_dat_to_json(item_dat: ItemDat) -> dict:
    return {
        'items': [asdict(i) for i in item_dat.items],
        'names': item_dat.names,
    }


def itemtype_dat_to_json(types: list[EoBItemType]) -> dict:
    return {'types': [asdict(t) for t in types]}

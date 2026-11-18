"""CHARGEN/ITEM.DAT + CHARGEN/ITEMTYPE.DAT decoders.

Confirmed byte-exact against data/eotb3/dosvga/CHARGEN/ITEM.DAT (10385 B)
and ITEMTYPE.DAT (1026 B). ITEM.DAT's per-item record layout is the SAME
14-byte EOB1 format documented in docs/eotb/amiga/eotb-item-dat-spec.md
(ModdingWiki) -- confirmed identical field-for-field, cross-checked against
ThirdEye's docs/item_dat_format.md (independent RE, further cross-checked
there against the AD&D 2e Player's Handbook and the bundled CREATE.SAV
Quick Start Party's actual gear).

ITEM.DAT layout:
    u16 numItems            (434 in the bundled file)
    numItems x 14-byte item records (see decode_item_record)
    u16 numNames            (123 in the bundled file)
    numNames x 35-byte NUL-padded name strings

Item record (14 B):
    +0  u8   unid      name-string index when unidentified
    +1  u8   id         name-string index when identified
    +2  u8   bits        0x80 glow-magic, 0x40 identified, 0x20 cursed,
                          0x08 life-drain
    +3  u8   pic         inventory icon index (into ITEMICN.CPS's grid)
    +4  u8   type        item-type index into ITEMTYPE.DAT
    +5  u8   subpos       placement (floor/wall dir 0..7, inventory slot
                           0..26, container compartment 8)
    +6  i16  pos          x + y*32 on the dungeon level; <=0 = consumed/carried
    +8  i16  next         next item id in chain (-1 = tail)
    +10 i16  prev         previous item id (-1 = head)
    +12 u8   level         dungeon level the item lives on
    +13 i8   value         type-dependent bonus/charge/key-kind byte

ITEMTYPE.DAT layout (corrected 2026-11; ThirdEye/ScummVM were right):
    u16 count               (64 in the bundled file; 2 + 64*16 = 1026 = file size)
    count x 16-byte type records (see load_itemtype_dat), starting at file
    offset 2.

Type record (16 B, record-relative offsets), per ScummVM
engines/kyra/engine/items_eob.cpp:109-121 and ThirdEye's docs. Re-verified
2026-11 against the real bytes (record 0 = `08 00 08 00 00 39 01 01 08 00
01 0a 00 00 01 00`) and the 27 named PHB reference types:
    +0  u16  invFlags          inventory/equip-slot flags
    +2  u16  handFlags         hand/placement flags
    +4  i8   armorClass        signed AC modifier (banded -6, chainmail -5,
                                platemail -7, scalemail -4, ...)
    +5  u8   allowedClasses    bit0 Fighter, bit1 Mage, bit2 Cleric, bit3 Thief,
                                bit4 Paladin, bit5 Ranger
    +6  u8   requiredHands     0..2 (reach/handedness)
    +7  u8   dmgNumDiceS       small-target damage dice count
    +8  u8   dmgNumPipsS       small-target dice sides
    +9  i8   dmgIncS           small-target flat bonus
    +10 u8   dmgNumDiceL       large-target dice count
    +11 u8   dmgNumPipsL       large-target dice sides
    +12 i8   dmgIncL           large-target flat bonus
    +13 u8   unk1              0 in the bundled file
    +14 u16  extraProperties   (the old "trailer = 0x0004" was the LAST
                                record's value, not a file trailer)

> Correction (2026-11): the earlier version of this module read records from
> file offset 0 and called the first u16 (the record count) `mask_A`, treating
> every field as "2 bytes later than ThirdEye". That was a framing error: the
> file has a u16 count header, so the values were right but every label was
> misassigned (`mask_A` = previous record's extraProperties, `field3` =
> handFlags, `flag_x` = requiredHands). ThirdEye's layout is correct as written.
> The bundled CHARGEN/ITEM.DAT + ITEMTYPE.DAT are md5-identical to EOB2's.
"""
from __future__ import annotations

import struct

ITEM_RECORD_SIZE = 14
NAME_SIZE = 35
TYPE_RECORD_SIZE = 16


def _decode_name(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("latin-1")


def load_item_dat(blob: bytes) -> dict:
    num_items = struct.unpack_from("<H", blob, 0)[0]
    items = []
    off = 2
    for i in range(num_items):
        rec = blob[off:off + ITEM_RECORD_SIZE]
        unid, id_, bits, pic, type_, subpos = struct.unpack_from("<6B", rec, 0)
        pos, next_, prev = struct.unpack_from("<3h", rec, 6)
        level, value = struct.unpack_from("<Bb", rec, 12)
        items.append({
            "index": i + 1,
            "unid": unid, "id": id_, "bits": bits, "pic": pic, "type": type_,
            "subpos": subpos, "pos": pos, "next": next_, "prev": prev,
            "level": level, "value": value,
        })
        off += ITEM_RECORD_SIZE

    num_names = struct.unpack_from("<H", blob, off)[0]
    off += 2
    names = []
    for i in range(num_names):
        raw = blob[off:off + NAME_SIZE]
        names.append(_decode_name(raw))
        off += NAME_SIZE

    return {"numItems": num_items, "items": items, "numNames": num_names,
            "names": names, "consumedBytes": off, "totalBytes": len(blob)}


def load_itemtype_dat(blob: bytes) -> dict:
    count = struct.unpack_from("<H", blob, 0)[0]
    if 2 + count * TYPE_RECORD_SIZE != len(blob):
        raise ValueError(f"ITEMTYPE.DAT: 2 + {count}*16 != {len(blob)} (count header mismatch)")
    types = []
    for i in range(count):
        off = 2 + i * TYPE_RECORD_SIZE
        inv_flags, hand_flags = struct.unpack_from("<2H", blob, off)
        armor_class = struct.unpack_from("<b", blob, off + 4)[0]
        allowed_classes, required_hands = struct.unpack_from("<2B", blob, off + 5)
        dice_s, pips_s, inc_s = struct.unpack_from("<BBb", blob, off + 7)
        dice_l, pips_l, inc_l = struct.unpack_from("<BBb", blob, off + 10)
        unk1 = blob[off + 13]
        extra = struct.unpack_from("<H", blob, off + 14)[0]
        types.append({
            "index": i, "invFlags": inv_flags, "handFlags": hand_flags,
            "armorClass": armor_class, "allowedClasses": allowed_classes,
            "requiredHands": required_hands,
            "dmgNumDiceS": dice_s, "dmgNumPipsS": pips_s, "dmgIncS": inc_s,
            "dmgNumDiceL": dice_l, "dmgNumPipsL": pips_l, "dmgIncL": inc_l,
            "unk1": unk1, "extraProperties": extra,
        })
    return {"count": count, "types": types}

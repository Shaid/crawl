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

ITEMTYPE.DAT layout (no count header -- N = (filesize - 2) / 16, per
ThirdEye's itemtype_dat.hpp/.cpp "no header, coincidental first field" note):
    N x 16-byte type records (see decode_type_record)
    u16 trailer               (0x0004 in the bundled file, purpose unknown)

Type record (16 B). ThirdEye's own docs/item_dat_format.md documents this
record but with an offset mapping that does NOT match the bundled file
byte-for-byte (its AC_bonus/class_use_mask/dice fields are each 2 bytes
earlier than where they actually are). Re-derived here directly against
the real bytes, cross-checking the same AD&D 2e PHB values that doc cites
(axe 1d8/1d10, banded mail AC -6, spellbook Mage-only 0x02, etc.) across
27 named type records (data/eotb3/dosvga/CHARGEN/ITEMTYPE.DAT) -- ALL
match exactly at the offsets below (0 mismatches):
    +0  u16  mask_A            item-handling flags -- unknown; correlates
                                 with equip slot (0x80/0x81/0x82 cluster on
                                 weapons, distinct values on armour/misc) but
                                 not cleanly decoded
    +2  u16  mask_B            secondary flags -- unknown, mostly 0x0008/
                                 0x0088/0x000a-ish; not decoded
    +4  u16  field3             unknown (icon dims? weight?); not decoded
    +6  i8   ac_bonus            signed AC modifier. VERIFIED: banded -6,
                                  chainmail -5, platemail -7, scalemail -4,
                                  helmet/leather armour/shield -1/-2, 0 for
                                  all weapons.
    +7  u8   class_use_mask      bit0 Fighter, bit1 Mage, bit2 Cleric,
                                  bit3 Thief, bit4 Paladin, bit5 Ranger.
                                  VERIFIED against 27 named types (lock
                                  picks=0x08 Thief-only, spellbook=0x02
                                  Mage-only, holy symbol=0x14 Paladin+
                                  Cleric, staff/rations/boots/robe/ring/
                                  bracers=0x3f all-classes, ...).
    +8  u8   flag_x              small (0..2) per-weapon value, roughly
                                  tracks weapon reach/class (0 light 1H,
                                  1 heavier 1H, 2 polearm/2H/bow); armour
                                  and non-weapons are 0 or 1. Hypothesis,
                                  not fully pinned down.
    +9  u8   sm_dice_count       VERIFIED: axe/longsword 1, dagger 1, ...
    +10 u8   sm_dice_sides       VERIFIED: axe 8 (1d8), shortsword 6 (1d6),
                                  dagger 4 (1d4), matches PHB exactly.
    +11 u8   sm_dmg_plus         VERIFIED: mace/flail +1, others +0.
    +12 u8   lg_dice_count       VERIFIED.
    +13 u8   lg_dice_sides       VERIFIED: axe 10 (1d10), longsword 12
                                  (1d12), shortsword 8 (1d8) -- PHB exact.
    +14 u8   lg_dmg_plus         VERIFIED.
    +15 u8   _pad                0 in every record of the bundled file
                                  (only 1 trailing byte; the earlier
                                  research doc's separate slot_hint/_pad2
                                  fields don't fit in the corrected layout
                                  -- there is no room for them).
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
    count = (len(blob) - 2) // TYPE_RECORD_SIZE
    types = []
    off = 0
    for i in range(count):
        rec = blob[off:off + TYPE_RECORD_SIZE]
        mask_a, mask_b, field3 = struct.unpack_from("<3H", rec, 0)
        ac_bonus = struct.unpack_from("<b", rec, 6)[0]
        class_use_mask, flag_x = struct.unpack_from("<2B", rec, 7)
        sm_dice_count, sm_dice_sides, sm_dmg_plus = struct.unpack_from("<3B", rec, 9)
        lg_dice_count, lg_dice_sides, lg_dmg_plus = struct.unpack_from("<3B", rec, 12)
        pad = rec[15]
        types.append({
            "index": i, "maskA": mask_a, "maskB": mask_b, "field3": field3,
            "acBonus": ac_bonus,
            "classUseMask": class_use_mask, "flagX": flag_x,
            "smDiceCount": sm_dice_count, "smDiceSides": sm_dice_sides,
            "smDmgPlus": sm_dmg_plus, "lgDiceCount": lg_dice_count,
            "lgDiceSides": lg_dice_sides, "lgDmgPlus": lg_dmg_plus,
            "pad": pad,
        })
        off += TYPE_RECORD_SIZE
    trailer = struct.unpack_from("<H", blob, off)[0] if off + 2 <= len(blob) else None
    return {"count": count, "types": types, "trailer": trailer}

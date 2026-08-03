# `ITEMTYPE.DAT` field offsets: a 2-byte correction to ThirdEye's docs

**Game:** Dungeon Hack / Eye of the Beholder III use the same `CHARGEN/ITEMTYPE.DAT`
format (64 × 16-byte type-template records, no count header, trailing
`u16` = `0x0004`).

**Source of the claim:** [ThirdEye](https://github.com/psi29a/thirdeye)'s
`docs/item_dat_format.md`, which documents the record as:

| off | field |
|---|---|
| `+4` | `AC_bonus` |
| `+5` | `class_use_mask` |
| `+6` | `flag_x` |
| `+7` | damage dice fields begin |

## The correction

Cross-checking that document's own cited AD&D 2e reference values (axe
1d8/1d10 damage, banded mail armour class −6, spellbook restricted to
Mage-only via `0x02`, etc.) against the real bytes of `ITEMTYPE.DAT` for 27
named type records shows every field listed above sits **2 bytes later**
than documented:

| off | field |
|---|---|
| `+6` | `ac_bonus` |
| `+7` | `class_use_mask` |
| `+8` | `flag_x` |
| `+9` | damage dice fields begin |

At the corrected offsets, every cited AD&D 2e value lines up exactly —
with two honest exceptions, kept open rather than forced:

- **`staff`**: ThirdEye's doc cites 2d6/1d6 damage; the corrected-offset
  decode reads 1d6/1d6. 1d6 is the canonical AD&D 2e quarterstaff damage,
  which reads as a doc typo rather than a decode error — but this is not
  independently confirmed, just the more plausible of the two.
- **`shield`**: ThirdEye's doc cites `class_use_mask = 0x35`
  (Fighter+Cleric+Paladin+Ranger); the corrected-offset decode reads
  `0x3d` (adds Thief). Both are individually plausible AD&D 2e rule
  variants — some editions restrict thief shield use, some don't. Left as
  an open discrepancy, not resolved either way.

Every other field matches for 27/27 records (`ac_bonus`, both damage-dice
pairs) or 26/27 (`class_use_mask`, the `shield` exception above).

## Full corrected record layout

16 bytes, all unsigned unless noted:

| off | size | field | notes |
|---|---|---|---|
| `+0` | u16 | `mask_A` | unknown — correlates with equip slot, not cleanly decoded |
| `+2` | u16 | `mask_B` | unknown |
| `+4` | u16 | `field3` | unknown (icon dimensions? weight?) |
| `+6` | i8 | `ac_bonus` | **signed**. e.g. banded −6, chainmail −5, platemail −7, scalemail −4, helmet/leather armour/shield −1/−2, `0` for all weapons |
| `+7` | u8 | `class_use_mask` | bit0 Fighter, bit1 Mage, bit2 Cleric, bit3 Thief, bit4 Paladin, bit5 Ranger. e.g. lock picks `0x08` (Thief-only), spellbook `0x02` (Mage-only), holy symbol `0x14` (Paladin+Cleric), staff/rations/boots/robe/ring/bracers `0x3f` (all six) |
| `+8` | u8 | `flag_x` | small values (0..2), roughly tracks weapon reach/class — hypothesis, not fully decoded |
| `+9` | u8 | `sm_dice_count` | small/one-handed damage dice count |
| `+10` | u8 | `sm_dice_sides` | small/one-handed damage dice sides — e.g. axe 8 (1d8), shortsword 6 (1d6), dagger 4 (1d4), exact per the PHB |
| `+11` | u8 | `sm_dmg_plus` | small/one-handed flat damage bonus — e.g. mace/flail `+1`, others `+0` |
| `+12` | u8 | `lg_dice_count` | large/two-handed damage dice count |
| `+13` | u8 | `lg_dice_sides` | large/two-handed damage dice sides — e.g. axe 10 (1d10), longsword 12 (1d12), shortsword 8 (1d8), exact per the PHB |
| `+14` | u8 | `lg_dmg_plus` | large/two-handed flat damage bonus |
| `+15` | u8 | `_pad` | `0` in every bundled record |

## Why this matters

`ITEM.DAT`'s own `type` field (byte `+4` of each 14-byte item record)
indexes directly into this table, so a 2-byte offset error here silently
corrupts every derived stat for every item in the game — armour class,
class restrictions, and damage dice all shift to the wrong field and
partially alias into what should be the unknown leading `mask_A`/`mask_B`/
`field3` region. It's the kind of error that's easy to carry forward
undetected, since the wrong-offset bytes still often decode as small,
plausible-looking integers rather than obvious garbage.

## Provenance

Found and verified during reverse-engineering of Eye of the Beholder III's
data formats in the [crawl](https://github.com/Shaid/crawl) project — see
`scripts/eotb3lib/itemdat.py` for the corrected decoder and
`docs/eotb3/dosvga/data-structure.md` §6.2 for the full write-up in
project context. Verification method: decode all 64 `ITEMTYPE.DAT` records
at both the documented and corrected offsets, then compare 27 named,
recognizable type records (weapons, armour, spellbook, holy symbol, etc.)
against their real-world AD&D 2nd Edition Player's Handbook values.

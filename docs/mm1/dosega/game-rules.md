# Might and Magic I (DOS/EGA) — game rules from the game's own code

Method: single real routines of `MM.EXE` run in a Unicorn 8086 (16-bit real-mode)
harness on synthetic state (`tools/mm1/rules_oracle/`), recorded as vectors
(read-before-write bytes, final changed bytes, registers, stub-call log), and
replayed against a TypeScript port (`tools/mm1/rules.ts`) that runs **only on
the recorded read bytes**: an extra read, a different RNG order or a different
write set fails (`tools/mm1/__tests__/rules.test.ts`). Every unit has a null
control that must fail. Full vector sets are generated into gitignored
`rules_oracle/generated/` by `gen_vectors.sh`; small subsets are committed in
`rules_oracle/vectors/`. Tables/structures are derived from the executable and
cited by offset; ScummVM's (GPL) MM1 engine was **not** used as a source.

## 0. Rules status

| Area | Status | Grade |
|------|--------|-------|
| Symbol table `MM.RSM` (579 symbols) | decoded, closes `mm1-rsm-encoding` | code |
| RNG `random` CODE+0x451B | ported | harness (2000 vectors) |
| Character creation: rollstat 0x5A42, race adjust 0x549B, class eligibility 0x5AE4, setspell 0x5A00, start HP/AC 0x5982, commit 0x57B7..0x597C, resetac 0x732A | ported | harness |
| Training: XP threshold/gold 0x2A92, XP compare 0x2BA3, gold 0x2C2E, level-up commit 0x1B68..0x1D54 | ported | harness |
| Melee: rolldmg 0xC008, party attack setup 0xA399, monster attack setup 0x9CAE, damage to character 0x9DAB, damage to monster 0xC15E (+compaction 0xC2B0), initiative 0xB8E3 | ported | harness |
| Saving throws 0xA655 / 0xA6A3, add condition 0xA6D3, 8 resistance rolls 0xA706..0xA79B, monster magic resist 0xA7C1 | ported | harness |
| Monster touch effects 0xA60F (25 handlers, 1-in-n gate 0xAC2A, UI call log) | ported | harness |
| Combat spells: `comcast` CODE+0xC7C7 (menu, class list, SP/gem costs and borrow, flag gates, target pick, 94-entry table DS:0x39E2, condition/damage/heal/turn/dispel engines, party-damage chain) | `tools/mm1/spells.ts` | harness (2500 vectors, 69 handlers reached, 8 null controls) |
| After combat: `treas` 0xC3AD, `treitem` 0xC422 (+`dropItem` 0xC532), `divide` 0x8386, `resout` 0xA1EA, battle won 0x9FC1..0xA1BE (XP pool, split, overflow) | `tools/mm1/after.ts` | harness (600-1000 vectors each) |
| Encounter group building 0x2F87..0x3206 (level budget, level/type draws, group sizes, monster record copy) | `after.ts` `encGen` | harness (1200) |
| Round loop pieces: monster upkeep `regenmon` 0xAD44, `monadv` 0xAC41, run away 0x9A17, end of round 0x9F1A, next monster + nerve check 0x9A76..0x9B9D | `after.ts` | harness (800 each) |
| Monster special abilities `ability` 0xAF49 (32 handlers via DS:0x33CF, 4 engines: one/all x damage/status) | `spells.ts` `MonsterAbility` | harness (1500) |
| Non-combat cast `qcast` 0x8794 (45 handlers via DS:0x2BEB), item use 0x8619, combat item use 0xC5FD/0xC773 | `tools/mm1/world.ts`, `spells.ts` `UseItem` | harness (qcast 2500, use 1500, useitem 1500; 6 null controls) |
| Encounter greeting/surprise/bribe/retreat/surrender 0x3206 (alignment, gold wipe) | `world.ts` `Surprise` | harness (2500, 3 null controls) |
| Resting `rest` 0x6EE5 / `okrest` 0x6F98 (ambush roll, recovery, ageing with the stat-zero hang, food, max SP 0x71CD) | `world.ts` `Rest` | harness (1500 each, 4 null controls) |
| Party movement forward 0x4D7E / back 0x4E81 / turn 0x4F43, 0x4F7A (walls, doors, map-edge exits, encounter roll) | `world.ts` `Step` | harness (3000, 2 null controls) |
| Gather 0x74BC / share 0x7763 of gems, gold, food | `world.ts` `Pool` | harness (2500, 3 null controls) |
| Search 0x4A28, pick lock `unlock` 0x4A6C, `bash` 0x4BE4 | `world.ts` `Door` | harness (2500, 3 null controls) |
| Still open: food 0x1DF3, shops 0x2196, traps 0x3749, thievery/skills, training-hall flow, class-specific rules, overlay handler execution | **open** | `mm1-rules-world`, `mm1-ovr-code` |

Addressing: image = `MM.EXE[0x200:]`; CS base = image 0; DS = CS+0x107B
paragraphs (DS:0 = image 0x107B0), SS = DS. Overlay code (CS:0xF48F) has still not been executed in the harness; overlay *data* (DS:0xC940, read through the pointer DS:0x132 as `getod(n)`) is modelled by random bytes in the harness, which is enough for every unit above that only reads it. The game code is hand-translated
6502-style assembly (8-bit carry arithmetic, `[bp+di]` = field offset +
record pointer), so most "formulas" are 8-bit with silent wrap; the port
reproduces that.

## 1. Quirks confirmed by the harness (do not "fix" in a remake unless desired)

- `random(n)` retries by shifting with the stale scratch byte `DS:0x3BD3`; if that
  byte is 0 the loop runs 65,536 steps (about 0.2% of random inputs).
- `apdmch` (damage to a character) loses the damage when the low HP byte becomes
  exactly 0 while the high byte is non-zero.
- `rolldmg` with NUMATT = 0 swings 255 times.
- The 1-in-n monster-effect gate (`0xAC2A`) burns two extra `random()` calls
  (`random(n); random(r1); random(n) == n`).
- Saving throw: success when d100 <= 4*level + luck (+20 for class 2), 8-bit;
  rolls 99/100 always fail (character) / 100 fails (monster, 8*[3C29+slot]+20).
- Resistance rolls: affected when d120 < 3 or d120 >= (resistance + party effect
  byte); fear/psychic are skipped when `DS:3CA1` is set.
- Monster touch effect = monster record +0x1B (1..25 handler index; bit 7 set
  only does a character saving throw and returns).

## 2. Where to read details

Formula-level detail is the port itself (`tools/mm1/rules.ts`, each function
cites its CODE address) plus the vectors; this file does not restate it.

## 3. Pass 2 findings

Grades: harness = port replayed against recorded vectors with strict read/write footprint and a null control; code = read from disassembly only.

- **Cast gate** (`comcast`): level key 1-7 x slot key 1-8; list base 0 (clerics) or 0x2F (classes 3/5, sorcerer list); index = base + slot + 8*min(level,4) + 5*max(level-4,0) (94 spells per list). Per-spell flag DS:0xC5DC+n (0x2 outside-only, 0x10 needs `getod(0)&0x80`, 0x4 pick a member, 0x8 pick a monster group, 0x1 confirm) and cost byte DS:0xC63A+n (bit 7 = SP cost is the caster level, low 7 bits = gems). Gems borrow from the high byte (`+0x32`). (harness)
- **Engines**: parameter bytes DS:3C82 saving throw applies, 3C83 resist kind, 3C84 monster count / element, 3C85 value. Damage engine 0xCC84 halves on a successful monster save and quarters on a kind-resist (`mresl` tests the monster's +0x1A mask); heal 0xCE21 caps at max HP; `goz34` 0xD1C6 dispels everything. (harness)
- **Treasure** `treas`: monster +0x18: bit0 gems d6; bits 1-2 gold d10 / d100 / d4 on the high byte. Five item-drop chances 11/21/31/41/51 % rotate through the treasure bits. (harness)
- **Battle won**: XP pool is a 24-bit sum of the monsters' +0x16/+0x17; `divide` 0x8386 is a 32-bit divide over DS:3C86..3C8D; each living member's 32-bit XP at +0x27; overflow sets only the top byte (+0x2A) to 0xFF. (harness)
- **Encounter**: budget = half the summed levels of members with `+0x3F & 0xE0 == 0` (capped 255), plus half the top level; monster level = random(min(modifier + top/2, getod(0x21))) floored by getod(0x2F), cap 10; modifier from random(100) thresholds 51/71/86/96 -> 0..4; type = random(16); group = random(record +0x0F); at most 15 monsters and getod(0x22). Monster records DS:0xA962, 0x20 bytes, index (level-1)*16 + type. (harness)
- **Run away** (key `R`): succeeds when d100 <= DS:3C8F, else second roll d100 < round counter DS:3BDB; failure raises 3C8F by 1 (unless 0). (harness)
- **Monster nerve check** (monpick): flag +0x1E bits 4-5 pick the bound table against the party's top level DS:3C1B: below the first bound never flees, then a 50 % / 75 % chance band, above it always. A runner is removed with no reward. (harness)
- **Regeneration**: flag +0x1E bit 6 gives +5 HP (to the +0x11 maximum); a status gets a saving throw and the highest set bit is cleared. (harness)
- **Abilities**: id +0x1C (1..32), use chance +0x1D percent, uses left = low nibble of +0x1E (decremented on use); a sleeping monster only prints its message. Level-scaled values (`levelSum`) loop back to *after* the `clc`, so the carry out of one pass is added into the next (verified on 2 of 1500 random vectors; null control `abilityCarry`). (harness)

> **Correction (2026-11-26):** pass 1's "Open" text said the combat spell table has 110 entries. The cast table at DS:0x39E2 has 94 reachable entries (one per spell); the non-combat table at DS:0x2BEB also has 94 (45 distinct handlers).

Harness note: stub argument lambdas that read memory (e.g. the `ptext` log reading DS:3BDC/3BDD) are now recorded as reads of the call (`harness.py`); older committed vectors are unaffected.

## 4. Pass 3 findings

- **qcast**: spell flag bytes DS:0xC5DC (bit0 combat only, bit1 outside only, bit2 pick member, bit3 pick monster group, bit4 needs getod(0)&0x80), cost bytes DS:0xC63A; item info record[0x11]==0xFF casts spell record[0x12], else adds record[0x12] to a stat. `use` jumps into the same gates at 0x894F. Handlers that `pop ax` before `jmp` drop their return address (their jmps are stops); the fail path 0x971F goes through ddal to backview 0x74B6. (harness)
- **Greeting 0x3206**: menu A/R/B/S; surprise by either side; run/bribe/surrender wipe gold; alignment counter +0x6F is clamped. (harness)
- **okrest hangs deliberately** (`jmp $` at 0x7100) when an aged stat reaches 0; the spare-one-member ambush compares a 0-based index with a 1-based roll. (harness)
- **Movement**: wall byte DS:3C3C and door layer DS:3C10 hold 2 bits per side; rotation set DS:3C3D..3C40; encounter flag DS:3C18 set when random(getod(0x1D)) equals getod(0x1D); crossing 0..15 jumps to the edge loaders (yplus/xplus/ymin/xmin). (harness)
- **Pooling**: gems 16 bit, gold 24 bit (top byte saturates at 0xFF), food 8 bit capped at 40 on gather; share gives the remainder to the current member. (harness)
- **Doors**: a door in front opens only if getod(0x1E+wallcode)==1; pick-lock rolls random(100)+4*getod(0x31) against the member's +0x6C; bash sums the party's might (+0x18) against getod(0x2D). (harness)
- **Overlays**: `.OVR` = 7 LE words (magic 0xF2, code load 0xF48F, code size, data load 0xC940, data size, bss, entry); entry installs the special-cell dispatcher into DS:0x134 and sets DS:0x132=0xC940; dispatch reads cell table at data+0x33 (count data+0x32), direction masks, word handler table; a miss goes to `erase` then `encountr`. 55 overlays / 886 special cells censused with `rules_oracle/ovr_census.py` (handlers call stanp, wait_, erase, clrbtm2, encountr, ph2, random, loadnext, blacks/food/tavern/temple/training...). 77 table entries fall outside the code (DEMON, part of PP4/AREAE2: different table layout, not analysed). (code-read, census)

> **Correction (2026-11-26):** `.OVR` header word +0x00 is the magic 0xF2 (not an entry offset), +0x02 is the code load offset, +0x0C is the real entry offset. The opcodes are now disassemblable (`rules_oracle/lst_ovr.py`). Pass 2's "qcast is code-read only" is closed.

## Open (all listed in `docs/mm1/TODO.md`)

- `mm1-rules-world`: food 0x1DF3, shops (blacks 0x2196 etc.), traps 0x3749, thievery/skills, training-hall flow, class-specific rules; the bit-7 touch-effect bonus question (not investigated).
- `mm1-ovr-code`: overlay handlers not executed in the harness (DEMON/PP4/AREAE2 table layouts differ).

Paths tried: r2 listing (misaligned) -> custom capstone lister; first RSM parse
paired addresses with the wrong names -> re-derived and checked against code.

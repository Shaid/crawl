# Might & Magic III (Amiga) — Game Rules

Logic foundation for a browser remake's rules core, derived from the game's own 68000 code: the retail `Might&MagicIII` executable (`data/mm3/amiga/Might&MagicIII`, 272,088 B). No other port and no third-party reference code was used for any rule below (DOS-port notes in `docs/mm3/dosvga/` are used only to cross-check *data tables*, section 3). Written 2026-11-25 (pass 1) and 2026-11-26 (pass 2: sections 10-16).

**Method.** Single real routines run in a Unicorn 68000 core (`tools/mm3/rules_oracle/`, no OS/disk/chipset emulation; UI/animation callees are replaced by logging stubs) on synthetic state. Per call the harness records every byte the routine read before writing (the input footprint), every byte it wrote, the return value and each logged stub call. `tools/mm3/rules.ts` is a TypeScript port written from the disassembly; `tools/mm3/__tests__/rules.test.ts` runs it against a *strict* sparse memory seeded with only that footprint, so a port that reads state the game did not read, writes a different byte, draws the RNG in a different order or returns a different value fails. Every group has a **null control**: a deliberately wrong variant must disagree with the vectors somewhere. Same method as MM2 (`docs/mm2/amiga/game-rules.md`), adapted to MM3's overlay-linked executable.

**Address conventions.**
- `R+0xNNNN` = offset into the root `CODE` hunk (86,512 B; its payload starts at file offset `0x28`). `OVn+0xNNNN` = offset into overlay segment *n* (1..8 = hunks 3..10 = the CODE payloads 1,620 / 6,356 / 7,092 / **85,452** / 12,124 / 6,020 / 22,172 / 11,964 B, in file order). The combat/party-action code lives in **OV4** (the 85 KB segment); the root holds the C library, the stat engine and the monster-attack code. Overlay code has no relocations: it is PC-relative plus `A4`-relative.
- `A4` = DATA base + 0x7FFE (SAS/C small data). `-N(A4)` is a global. The DATA hunk is 25,156 B stored, **62,072 B declared**; the harness loads the declared size (zero tail) and every table/global below is inside the `A4` window.
- Calls such as `JSR -31668(A4)` go through the jump table at the start of DATA. Entries `4EF9 <abs32>` are root functions (target = `F_<hex>` in listings); entries from DATA+0x3C0 are 8-byte overlay stubs `BSR.W ovlmgr ; .w seg<<8|flag ; .w offset` (`OV<seg>_<hex>`). 161 root entries + 164 overlay entries.
- Ints are 16 bit; C arguments are pushed right to left, so the **first** argument is at the lowest stack address; the callee returns D0, the caller pops. Characters are 304-byte (0x130) records at `A4-0xC78`, big-endian words in memory.

**Evidence grades.** **harness** = diffed against the game's real routine in Unicorn with null controls; **code** = read from the disassembly at the stated address, not executed; **hyp** = inference; **open** = not derived.

## MM3 rules status (build guide, 2026-11-26, pass 2)

What a remake rules core can take **as is** (harness-verified; full vector sets are generated into the gitignored `tools/mm3/rules_oracle/generated/`, small subsets are committed in `tools/mm3/rules_oracle/vectors/`; 96,608 full vectors, 33 units). Pass 1 is `tools/mm3/rules.ts`, pass 2 is `tools/mm3/rules2.ts` (+ `rules-tables.ts`).

| Area | Verified (harness) | Where |
|---|---|---|
| RNG | `rand15` LCG, `srand`, `rand(lo,hi)` (hi+1 overshoot, lo-first args) | 2 |
| Character stats | bracket bonus table, level, age, equipment bonus sum, condition (status) modifier, **effective attribute**, **max HP**, **armour class**, **max SP** | 4 |
| Level thresholds, training | XP at next level; level threshold `OV4+0xB7EC`, shortfall `R+0x88CA`, payment pools `R+0x8964`; training cost `10*level^2` gold (code) | 4.6, 15 |
| Saves | luck save and the six category/element saves (`OV4+0x82DC`), simple `x/(x+50)` check | 5.1 |
| Damage to a character | HP word, unconscious / dead thresholds, item breakage on death | 5.2 |
| **Monster hits a character** | dice, resistance subtraction, repeated-save halving, 16 special-attack effects (the condition counters) | 5.3 |
| **The monster's turn** | target choice by `AttP` (all / random by party size / class or race preference, incapacitated members skipped or replaced), **the monster's own hit chance** (auto-hit for `DmgT != 0` or an asleep target, d20 with natural 20/1, `HitB` die, AC + 10 or level/2 + 15), attacks per turn `NumA`, party-wiped flags | 10 |
| **Turn order** | speed sort (party Speed attribute, monster `Spd`), ties by index, current actor kept | 11 |
| **Party member hits a monster** | weapon select + damage dice, to-hit roll, damage per hit, swings per round, element resistance scaling (spell kinds return 0) | 6 |
| **Damage to a monster** | physical resistance, element add-on, spell save halving, animation cues, kill: XP split, gold, gems, loot roll, group slot clearing | 12 |
| **Item generator** | item id by d100 x d100, 1-3 enchantment kinds, grade tables | 13 |
| **Spell cast gate** | cast-blocking conditions, SP cost (negative table value = x caster level), gem cost, payment/refund, spell price | 14 |
| Monster tables, spell table | all 22 DOS `Mon*.dat` tables byte-exact in DATA; 60 rule tables + 77 spell names exported to `rules-tables.json` | 3, 16 |

**Code-read only (not harnessed):** the combat round loop (`R+0x11FA0`, 11.2), combat spell resolution against monsters (`OV4+0x13282` mode != 0, 14.3), encounter-start monster volley (`R+0xC5FA`, 10.4), the training level-up application (`OV5+0x1EEE`, 15).

**Open (smallest next steps in section 9 and `docs/mm3/TODO.md`, ids `mm3-rules-*`):** monster surprise and encounter generation (group sizes, reinforcements), flee/morale (**no monster flee/morale or monster spell casting exists in the monster-turn routine `R+0xA1DC`; not located elsewhere**), per-spell effects (77 handlers in OV8, dispatched through a jump table), ranged `Rang` (read only by the position code `R+0x9754`), clock/ageing/food/doors/traps/skills, character creation, shop prices.

Corrections made while writing are in section 8.

## 1. Status summary

Vector counts (full sets): rng 4,008; bracket 600; level 2,000; age 2,000; condmod 3,000; equip 4,000; getstat 4,000; maxhp 3,000; ac 3,000; maxsp 3,000; xpnext 3,000; check 2,000; save 4,000; dmgchar 3,000; monattack 4,000; weapon 3,000; partyhit 4,000; element 2,000; dmghit 2,000; meleeround 3,000; xpsplit 2,000 = 60,608 (pass 1); pass 2: monturn 3,000; initiative 3,000; mondmg 3,000; item 3,000; castpay 3,000; castrefund 3,000; castblock 3,000; spellsp 3,000; spellprice 3,000; levelthr 3,000; shortfall 3,000; pay 3,000 = 36,000 (96,608 total; the `element` set was regenerated with spell kinds). All 53 vitest cases pass with the committed subsets (`npx vitest run tools/mm3`), plus the table export check.  Null controls: off-by-one `rand` range, wrong `level`, flag-flipped `getstat`/`ac`, biased save, missing halving, missing exploding-20, truncated swing count, skipped dead members in the XP split, missing Druid/Ranger second SP pass — each disagrees with the vectors.

## 2. Foundations (harness)

**RNG** — `R+0x12EA8` `rand15()`: `seed = seed*0x41C64E6D + 0x3039 (mod 2^32)`, result `(seed >> 16) & 0x7FFF`; the seed is the `u32` at `A4-0x2104`. `R+0x12EA0` `srand(long)` stores it. This is the SAS/C runtime generator, identical to MM2's.

**`rand(lo, hi)`** — `R+0x64D4`, called 99 times (43 in the root, 26 in OV4, 15 in OV5, ...). **Argument order differs from MM2: `lo` is pushed first** (`rand(1,20)` is `push 1; push 20`). If `hi <= lo` (signed 16-bit) return `lo` **without drawing**; else `r = rand15()`, `n = hi-lo+1`, `k = 0x7FFF / n` (signed 32-bit divide `R+0x14C48`... truncating), result `(lo + r / k) & 0xFFFF`. Because `k` is truncated, the result can exceed `hi` (returns `hi+1`) whenever `r >= k*n`; MM2 used `0x8000` as the numerator, MM3 uses `0x7FFF`. Verified with 8 directed seeds per run whose first draw is >= 32760. Precondition inherited from the code: `n <= 0x7FFF` (larger divides by zero).

Helper arithmetic in the root: `R+0x14168` unsigned 32x32 multiply, `R+0x14BFA` signed divide (quotient), `R+0x14C22` signed remainder, `R+0x14C48` signed divide (quotient, sets flags).

## 3. Monster stat tables (harness: byte-exact data match, 22/22)

The Amiga port **does** carry the DOS `Mon*.dat` tables — compiled into the DATA hunk as 90-entry arrays indexed by monster id (the DOS-side note "the Amiga port has no `Mon*.dat`" in `docs/mm3/TODO.md` `mm3-mon-stats` is wrong). Widths: `HP` and `Gems` u16, `Exp` and `Gold` u32 (big-endian), all others u8. `tools/mm3/rules_oracle/montables.py` finds each DOS table (converted to big-endian) byte-for-byte in the executable: 22/22. `A4` displacements and DATA offsets (also in `vectors/montables.json`):

| Table | A4 disp | Table | A4 disp | Table | A4 disp |
|---|---|---|---|---|---|
| HP (u16) | -24864 | AC | -24684 | Spd (initiative) | -24594 |
| DmgN (dice count) | -24504 | DmgS (die sides) | -24414 | NumA (attacks) | -24324 |
| Exp (u32) | -24234 | DmgT (damage type) | -23874 | AttP (attack preference) | -23784 |
| Spec (special attack) | -23694 | Rang (ranged) | -23604 | HitB | -23514 |
| Trea (treasure id) | -23424 | Gold (u32) | -23334 | Gems (u16) | -22974 |
| Magi | -22794 | Fire | -22704 | Elec | -22614 |
| Cold | -22524 | Acid | -22434 | Ener | -22344 |
| Phys | -22254 | | | | |

Use in code (**harness** for DmgN/DmgS/DmgT/Spec in 5.3, **code** for the rest): `DmgN`/`DmgS` give the dice, `DmgT` (0..6) the resisted category, `Spec` (0..16) the special effect, `AC` the monster armour class in the to-hit roll (6), `Fire/Elec/Cold/Acid/Ener/Magi/Phys` are per-monster **resistance percentages** used by the weapon-element scaling (6.3), `Exp`/`Gold`/`Gems`/`Trea` the kill reward (the monster-death block `OV4+0x1390x..0x13A60`, code: XP -> 6.4, gold added to `A4+0x70A0` (u32), gems to `A4+0x709C` (u16), treasure id `Trea` -> `rand(1,100) <= u8 A4-0x3518[id-1]` yields one loot item, at most 10), `Spd` the monster initiative in the turn-order builder (`OV4+0x130C0`, code). The DOS bestiary id -> name map (`scripts/mm3lib/mm3_monster_names.json`) therefore applies to the Amiga ids unchanged for the 61 confirmed names.

Monster instance state (in battle) lives in `A4` arrays indexed by the battle slot: `u16 A4+0x173A[slot]` = monster id, `u16 A4+0x188E[slot]` = status word (non-zero = disabled: `+20` to be hit; `7` is cleared when hit, `OV4+0x136FA`), `A4-0x3F2B` (u8) = the slot currently targeted.

## 4. Characters (harness)

**Record layout** (0x130 bytes, `A4-0xC78 + slot*0x130`, big-endian). Offsets below are the ones the verified routines read; names are the role the code gives them (**code**) or **hyp** where marked.

| Offset | Meaning |
|---|---|
| +0x11 | race (u8; index into the signed byte tables `A4-0x53A1` (HP) and `A4-0x53AB` (SP)) |
| +0x13 | class (u8 0..9; hyp order Knight, Paladin, Archer, Cleric, Sorcerer, Robber, Ninja, Barbarian, Druid, Ranger — consistent with the class tables: Sorcerer/Archer cast from Intellect, Druid/Ranger from both) |
| +0x14..+0x21 | seven attribute pairs (base u8, temp u8): idx 0..6 = Might, Intellect, Personality, Endurance, Speed, Accuracy, Luck (hyp names; roles confirmed: Might -> damage, Endurance -> HP, Speed -> AC, Accuracy -> to-hit, Luck -> save, Int/Pers -> SP) |
| +0x22 | AC term (u8) |
| +0x23 / +0x24 | level (u8) / temporary level bonus (u8); `level = +0x23 + +0x24` (`R+0xD03E`) |
| +0x26 | extra age in years (u8) |
| +0x27.. | per-class flags (u8 each), `+0x27+0xC / +0xD / +0x2` select the +2 SP bonus (hyp: spell-school bits) |
| +0x2A | u8 flag: +1 HP per level |
| +0x7A | u8: non-zero = has spell points |
| +0x7D..+0x8E | 18 item slots: equip/slot code (u8; **1 or 13 = melee weapon, 4 = ranged**; 0 = empty) |
| +0x90..+0xA2 | 18 item flag bytes: `0x40` / `0x80` set = item ignored by the stat bonuses (hyp: cursed / broken) |
| +0xA3 / +0xB6 / +0xC9 | three 18-byte attribute arrays per item (element / magnitude / stat-kind selectors; tables `A4-0x2A2A`, `A4-0x29B2`/`-0x29E0`/`-0x29C9`, `A4-0x2984`) |
| +0xDC..+0xEE | 18 item ids (u8) |
| +0xEF.. | per-item second element byte (read into `A4+0x330F`) |
| +0x102 / +0x103 | AC bonus / damage reduction (u8) |
| +0x104 / +0x105 | weapon damage bonus / hit bonus added to the equipped weapon |
| +0x107..+0x112 | six (u8,u8) resistance pairs, added to the equipment bonus for the category saves (5.1) |
| +0x113..+0x122 | **16 condition counters** (u8). Order matches MM3's 16 conditions (hyp names): Cursed, Heart Broken, Weak, Poisoned, Diseased, Insane, In Love, Drunk, Asleep, Depressed, Confused, Paralyzed, **Unconscious (+0x11F), Dead (+0x120), Stone (+0x121), Eradicated (+0x122)** — the last four are the ones `damage` and the special attacks set |
| +0x126 | current HP (s16) |
| +0x128 | current SP (u16) |
| +0x12A | birth year (u16; current year `u16 A4-0x1326`) |
| +0x12C | experience (u32) |

**Differences from MM2** (everything else in the MM2 record layout is unrelated): 304-byte record (MM2: 130), 7 attribute pairs and 16 counters instead of MM2's status byte, HP is a *signed* word with a death threshold at `-10`/buffer (5.2), 18 item slots in six parallel arrays, level is `u8 + u8`, XP is at +0x12C.

### 4.1 Bracket bonus — `R+0xCE5C` (harness 600)
`bracket(v)`: `i` = first index with `u16 A4-0x42F0[i] > v` (unsigned); result `s8 A4-0x567B[i]`. Turns an attribute value into a bonus/penalty.

### 4.2 Age — `R+0xCE8E(char, flag)` (harness 2,000)
`age = s16(year - birth)` capped at 0xFE (signed); `flag == 0` adds `+0x26`.

### 4.3 Equipment bonus — `R+0xCEF0(char, kind)` (harness 4,000)
Sums over the 18 slots that have a non-zero slot code (`+0x7D`) and no `0x40/0x80` flag: for `kind < 0xB` and `kind != 3` the `+0xC9` selector `a` contributes `s8 A4-0x2984[a]` when `c7d2(a) (+1 if > 2) == kind` (`c7d2` = first index with `a <= u8 A4-0x53EC[i]`); for `kind > 0xA` the `+0xA3` selector contributes `u8 A4-0x2A2A[a]` when `c7ac(a) + 0xB == kind` (`A4-0x53DC` table); `kind == 9` (AC) also adds `u8 A4-0x27C9[item id]` and, when `+0xB6` is non-zero, `s8 A4-0x29B2[+0xB6]` (skipped for slot codes 1, 4, 13 unless the item id is 0x2A). Kinds seen: stat idx 0..6, 7 = HP, 8 = SP, 9 = AC, 0xB..0x10 = the six save categories.

### 4.4 Condition modifier — `R+0x94FA(char, idx)` (harness 3,000)
Zero when Dead/Stone/Eradicated counters (`+0x120/121/122`) are set. Otherwise each non-zero counter `n` adds to / subtracts from the seven attribute indices: Cursed (`+0x113`) -n on Luck; Poisoned (`+0x116`) -n on Might, Speed, Accuracy; Diseased (`+0x117`) -n on Int, Pers, Endurance; Insane (`+0x118`) +n on Might and Speed, -n on Int, Pers, Accuracy; Heart Broken (`+0x114`) and Weak (`+0x115`) -n on all; In Love (`+0x119`) +n on all; Drunk (`+0x11A`) -n on all but Personality and Luck, +n on those (the exact attribute-index assignment is in `condMod`; **hyp** for the names).

### 4.5 Effective attribute — `R+0xD064(char, idx, flag)` (harness 4,000)
`v = base + ageBracket + equipBonus(idx) + condMod(idx) + temp`, 16-bit, returned as `max(v, 0)` (anything `< 1` returns 0). `ageBracket` is added for idx 1, 2 (row 1 of `u16 A4-0x5432`) and idx 0, 3, 4, 5 (row 0; row stride 0x14 bytes = 10 age brackets, bracket = first `i` with `age < u16 A4-0x540A[i]`); Luck (idx 6) has none. **`flag != 0` skips both the condition modifier and the temp byte** (`+0x15`+2*idx), not just the modifier.

### 4.6 Max HP, AC, max SP, XP thresholds (harness)
- **Max HP** `R+0xAD56` (3,000): `h = u8 A4-0x25EE[class] + bracket(Endurance) + s8 A4-0x53A1[race] + (+0x2A ? 1 : 0)`, min 1; `h *= level`; `h += equipBonus(kind 7)`; min 0.
- **AC** `R+0xADE6(char, flag)` (3,000): `bracket(Speed) + equipBonus(kind 9)`, plus `+0x102 + +0x22` unless `flag`; min 0.
- **Max SP** `R+0xAC46` (3,000): 0 unless `+0x7A`. Classes 2 and 4 use stat 1 (Intellect) and flag byte `+0x27+0xD`; other classes stat 2 (Personality) and `+0x27+0xC`; classes 8 and 9 use `+0x27+2`. `s = bracket(stat) + 3 + s8 A4-0x53AB[race*2 + stat - 1] (+2 if the flag byte is set)`, min 1, `s *= level`, halved unless the class is 3, 4 or 8; classes 8 and 9 run the formula twice (stat 2 then stat 1) and average (`(a + b) >> 1`); then `+ equipBonus(kind 8)`; min 0.
- **XP at next level** `R+0x88FC` (3,000): `XP + need`, with `L = +0x23`: `L == 1` -> `XP` (need 0); `L` in 2..12 -> `need = u16 A4-0x3FCA[class] << (L-2)`; `L > 12` -> `need = (L-12)*0xFA000 + (u16 A4-0x3FCA[class] << 10)`; the shift is the 68k mod-64 shift (level 0 shifts everything out). The level-up in the training hall (`OV5+0x1EEE`, **code**) costs `10 * level^2` gold (`R+0x8964` pays), then sets `XP = threshold - B7EC(char)`, `level += 1`, and refills `HP = maxHP`, `SP = maxSP` (`+0x126`, `+0x128`).

## 5. Saves and damage to characters

### 5.1 Saving throw — `OV4+0x82DC(char, type)` (harness 4,000)
`type 0` (luck): `x = level + bracket(2*Luck)`; `roll = rand(1, x+0x14)`; **success = roll <= x**. `type 1..6` (categories, hyp: physical/fire/cold/electric/poison/energy order unknown): `x = equipBonus(kind) + two resistance bytes`, `roll = rand(1, x+0x28)`, success = roll <= x; the (kind, byte pair) per type is 1:(0x10,+0x111/112) 2:(0xB,+0x107/108) 3:(0xC,+0x10B/10C) 4:(0xD,+0x109/10A) 5:(0xE,+0x10D/10E) 6:(0xF,+0x10F/110). Types above 6 read uninitialised registers (not modelled). `OV4+0x82B0(x)` (harness 2,000): `rand(1, x+0x32) <= x`.

### 5.2 Damage to a character — `OV4+0xECE8(char, dmg)` (harness 3,000)
`HP(+0x126) -= dmg` (16 bit). If `HP < 1`: `buf = maxHP + HP` (`R+0xAD56`); `buf < 1` -> **Dead** (`+0x120 = 1`, `HP = 0`), otherwise **Unconscious** (`+0x11F = 1`, HP stays negative, down to `maxHP` below zero). Dead, or `HP <= -10` on entry, also sets flag `0x80` on the first item with id `0x22..0x29` that is carried. So a character falls unconscious at 0 HP and dies at `-maxHP`.

### 5.3 Monster hits a character — `R+0x9E02(char, slot, monster)` (harness 4,000)
`slot` (0..7) only chooses the hit animation position. The routine (with `UI 971C`, draw `945E` and `OV4+0xECE8` as logged stubs):
1. `+0x11B = 0` (clears the Asleep counter — hyp).
2. `dmg = sum of DmgN[mon] draws of rand(1, DmgS[mon])` (16-bit).
3. If `DmgT[mon] != 0` (type 1..6): one luck save (5.1) halves `dmg`; then types 2..5 subtract the party-wide resistance word `u16 A4-0x1322 / -0x1320 / -0x131E / -0x131C`; then **repeatedly** `while (save(char, type) && dmg != 0) dmg >>= 1` (arithmetic shift; a negative `dmg` never reaches 0). The UI sound/animation id is 4, 0xD, 0xE, 0xF, 0x11 depending on the type.
4. `dmg -= +0x103` (damage reduction), floor 0.
5. If `dmg != 0`, `Spec[mon] != 0` and a luck save **fails**, the special effect runs (one of 16, below).
6. The damage goes to `OV4+0xECE8` (5.2).

There is **no to-hit roll here**; the monster's hit chance is decided by the caller, `R+0xA1DC` (section 10).

Special effects `Spec` 1..16 (counters saturate at 255, i.e. wrap 0 -> 0xFF; `ui` = animation id logged): 1 Poisoned `+0x116`++; 2 Asleep `+0x11B`++; 3 Insane `+0x118`++; 4 Diseased `+0x117`++; 5 Confused `+0x11D`++; 6 Cursed `+0x113`++; 7 first carried item with id `0x22..0x29` gets flag `0x80`; 8 Weak `+0x115`++; 9 SP = 0 (`+0x128`); 10 Paralyzed `+0x11E`++; 11 age `+0x26 += 5`; 12 Unconscious `+0x11F`++ and HP = 0; 13 Eradicated `+0x122`++, every item with id `< 0x48` flagged `0x80`, HP = 0; 14 Stone `+0x121`++, HP = 0; 15 Dead `+0x120`++, HP = 0; 16 every item with id `< 0x46` gets flag `0x40`. (Counter names **hyp**, from the MM3 condition list; offsets and effects **harness**.) The 16 condition counters are mapped in order `+0x113 + n`.

## 6. Party attacks (harness)

### 6.1 Weapon damage — `R+0x11DA6(char, mode)` (harness 3,000)
Clears `A4+0x330A..0x3310`, then scans the 18 slots; `mode 0` accepts slot codes 1 and 13, `mode != 0` code 4. **Every** accepting slot overwrites the globals and rolls its dice, so with several accepted slots the last one wins but all of them draw the RNG: `A4+0x3310 = +0xA3[slot]` (element), `+0x330F = +0xEF[slot]`, hit bonus `s8 A4-0x29E0[+0xB6[slot]] + +0x105` -> `A4+0x330E`, damage `s8 A4-0x29C9[+0xB6[slot]] + +0x104` -> `s16 A4+0x330C`, `nDice = u8 A4-0x2780[id]`, `sides = u8 A4-0x2737[id]`, then `nDice` times `damage += rand(1, sides)`; finally `damage < 1 -> 0`.

### 6.2 To-hit — `OV4+0x12C38(char, mode)` (harness 4,000)
After 6.1: `x = bracket(Accuracy) + s8 A4+0x330E`; `x += level / div[class]` with `div = 1,2,2,3,4,2,2,1,3,2` (class 0..9); `x += d20` where **a natural 20 adds and rolls again** (loop `while roll == 20`); `x -= +0x113` (the Cursed counter); `+20` if the target's status word `A4+0x188E[target]` is non-zero; hit **iff `x >= 10 + AC[monster id]`**. (The monster id is `u16 A4+0x173A[target]`, target `u8 A4-0x3F2B`.)

### 6.3 Damage — `OV4+0x13048` (harness 2,000) and element scaling `OV4+0x12D56` (harness 2,000)
Per hit: `dmg = max(0, bracket(Might) + s16 A4+0x330C)` (the weapon damage of 6.1). Element scaling (kinds 0 and 3 only): `base = u8 A4-0x2A05[el]`; resist = the monster's table chosen by `el` (`< 9` Fire, `< 0x10` Elec, `< 0x15` Cold, `< 0x1A` Acid, `< 0x22` Ener, else Magi; `el == 0` none); `resist == 0` keeps `base`, `100` gives 0, else `base * (100 - resist) / 100` (truncating). The caller is `OV4+0x136E2` (section 12): it is called for every mode and for spell kinds returns 0.

### 6.4 Melee round and XP — `OV4+0x13282` (harness 3,000), `OV4+0x12FB0` (harness 2,000)
Mode 0: `swings = level / div2[class] + 1` with `div2 = 5,6,6,7,8,6,5,4,7,6`; each swing is 6.2 and each hit adds 6.3's damage; the total goes to `OV4+0x136E2(char, total, 0)` (monster damage, logged stub) then `OV4+0x1307C`. **XP split**: every party member — dead or not, the condition switch is vacuous — gets `award / partyCount` added to `+0x12C` (`partyCount` = `u8 A4-0x1672`, or `u8 A4+0x1F74` indices from `A4-0xC81` when `u8 A4-0x104A == 2`). Integer division; the remainder is lost.

## 7. What a rules core can take from this
Everything in the status table is expressed as pure functions over the character record and the `A4` tables in `tools/mm3/rules.ts`; the unit tests are the specification. Tables (`A4-0x42F0` ... ) are read from the executable's DATA hunk — a remake takes the extracted table file (section 16).

## 8. Corrections made while writing
> **Correction (2026-11-25):** the Amiga port is **not** missing the `Mon*.dat` stat tables (`docs/mm3/TODO.md` `mm3-mon-stats`: "the Amiga port has no Mon*.dat (stats compiled into its code)") — they are compiled into the DATA hunk, byte-identical to the DOS files (section 3).
> **Correction (2026-11-25):** first reading of the to-hit roll said a natural 20 skips the Cursed penalty; the `beq 12CC2` at `OV4+0x12CD8` re-rolls instead. The `getstat` `flag` first read as "skip the condition modifier only"; it also skips the temp byte. The condition modifier's out-of-range index (6) returns the case-6 block, not the index.

> **Correction (2026-11-26):** section 5.3 and the TODO said the monster's hit chance was not located. It is in the caller `R+0xA1DC` (section 10): `R+0x9E02` is only the damage/special-effect half of an attack.
> **Correction (2026-11-26):** the status block said `Rang` was a ranged-attack flag used by the monster turn, and `Spd` was read by `OV4+0x130C0`. `Rang` is read once, by the position routine `R+0x9754`; `Spd` is read by the turn-order builder `OV4+0x1307C` (the initiative code starts there, `0x130C0` is mid-function). `OV4+0x12D56` returns 0 for spell kinds (section 12); the pass-1 `element` vectors only exercised kinds 0 and 3 and are regenerated with the other kinds.
> **Correction (2026-11-26):** gems from a kill are added to a **u32** at `A4+0x709C` (not a u16); gold to the u32 `A4+0x70A0`. The loot chance table is `A4-0x3518[Trea-1]` (1, 2, 5, 10, 20, 100 % for treasure ids 1..6, 0 beyond).
> **Correction (2026-11-26):** the level-up rewrite of the experience (section 4.6) is `XP' = R+0x88FC - OV4+0xB7EC` (section 15), not a plain `threshold - B7EC`; `R+0x88FC` is a total-XP equivalent, not the threshold.

## 9. Open (ids in `docs/mm3/TODO.md`)
- `mm3-rules-monster-ai` — surprise and the origin of the encounter-start list `A4+0x1F4E` / mode 5 (10.4); encounter generation (group sizes, reinforcements); flee/morale and monster spells **do not exist in `R+0xA1DC`** (not found elsewhere: search the round loop callees if the remake needs them); ranged `Rang`; `R+0x122DE` (monster id 0x19 melee reaction); a harness for the round loop `R+0x11FA0` (needs the player-command stub).
- `mm3-rules-monster-damage` — the item generator is verified standalone but stubbed inside `OV4+0x136E2` (compose them); `OV4+0` group compaction after a kill (UI); the meaning of `A4-0x1665 == 0x6A`.
- `mm3-rules-spells` — the 77 per-spell handlers (OV8) and the combat spell resolver per kind (14.2, 14.3).
- `mm3-rules-world` — clock/ageing/food, doors/traps, skills, character creation, shop prices, rest; the training level-up application is code-read only.
- `mm3-rules-tables` — done (16); class names remain hyp.

## 10. The monster's turn (harness) — `R+0xA1DC(monster id)`, 3,000 vectors

Callers: the battle round loop (`R+0x12124`, argument 0) and the encounter-start volley (`R+0xC722`, argument = id from the list `A4+0x1F4E[36]`, `0xFF` = none). Logged callees in the harness: `R+0x9E02` (monster hits character, 5.3), `R+0x971C(2)` (miss cue) and `R+0xD1AE` (redraw).

1. **Who acts.** If `u8 A4-0x33A9 == 0` (a battle turn) the argument is ignored: `k = s8 A4-0x3309 - u8 A4+0x1F74` (actor index minus party size) picks the group whose last member is `u8 A4+0x1F73` / `A4-0x1BA` / `A4-0x1B9` (minus 1) for `k = 0/1/2` (other values read a caller register: not modelled); the slot's status word `A4+0x188E[slot]` must be 0 or 1 (anything else = disabled monster, no action); monster id = `u16 A4+0x173A[slot]`.
2. The attack is repeated `NumA[id]` times (`u8 A4-0x5F04`); each repetition chooses a target by `AttP[id]` (`u8 A4-0x5CE8`; the 90 shipped values: 1 x57, 0 x17, 2 x6, 4 x4, 3 x3, 6 x2, 5 x1):
   - **0** — every party position `0..n-1` in turn, **including incapacitated members**, one attack each.
   - **1** — random by party size `n` (`u8 A4+0x1F74`): `n=1` 0; `n=2..5` `rand(0,n-1)`; `n=6` `rand(1,8)==8 ? 5 : rand(0,4)`; `n=7` `rand(1,10)==10 ? 6 : rand(0,5)`; `n=8` `rand(1,12)==12 ? 7 : rand(0,6)` (the rear-most member is hit about half as often); `n=0` or `>8` leaves position -1.
   - **2..6** — the first position (party order table `u8 A4-0xC81[i]` -> character) whose worst condition is not 0xB..0xF (paralysed, unconscious, dead, stone, eradicated) and whose class (`+0x13`) is 3 / 4 / 8 / 1 respectively, or whose race (`+0x11`) is 2 for `AttP = 6`; if none matches, the random rule above. Class numbers as in 4 (names **hyp**).
3. If the (random) pick is incapacitated (worst condition 0xB..0xF) it is **replaced** by a uniform pick among the others: `list` = order[i] of every capable member, `rand(0, len-1)`, then `order[list[r]]` (**a double lookup through the order table**, as in the code; `r == len` — the `hi+1` overshoot of `rand` — reads the `0xFFFF` filler, i.e. `order[-1]`). If nobody is capable: `u8 A4-0x3307 = 1`, `u8 A4-0x104A = 1` (party wiped / battle over) and the routine returns without the redraw.
4. **Hit chance** (the unit the earlier passes could not find): the attack is an **automatic hit** when `DmgT[id] != 0` (`u8 A4-0x5D42`) or the target's asleep counter `+0x11B != 0`. Otherwise `r = rand(1,20)`: `20` -> a hit is issued, **then** (sic, the code falls through) the normal roll below runs as well; `1` -> miss; else `x = rand(1, HitB) + r + (HitB >> 2)` with `HitB = u8 A4-0x5BDA[id]` and the attack hits iff `x >= AC(target) + k`, `AC = R+0xADE6(char,0)`, `k = level/2 + 15` if `u8 A4+0x1F76[position] != 0` (hyp: the member is defending) else `10`. A hit calls `R+0x9E02(char, position, id)`; a miss plays cue 2. So a natural 20 almost always produces two hit calls.
5. Evidence: 3,000 vectors incl. 555 that end in the wiped-party flags (the flags are pre-cleared, so the write is observable) and 1,131 turns with two or more hit calls; null controls: treating damage-type monsters like the rest, and ignoring AC.

**Absent from this routine** (and not found elsewhere): monster ranged attacks (`Rang`, `u8 A4-0x5C34`, is read only by the monster-position code `R+0x9754`), monster spell casting, flee/morale/summon, call for help. `Spec` is applied inside `R+0x9E02` (5.3) and is also shown by the OV8 Identify-Monster spell (name table `A4-0x45A2`).

### 10.4 Encounter-start volley (code) — `R+0xC5FA`
Shows the encounter picture, then calls `R+0xA1DC(id)` for every non-`0xFF` id in `A4+0x1F4E[0..35]` (each with `A4-0x33A9` as set by the caller), clears `A4-0x33A9/-0x33AA`, and if the mode `A4-0x104A == 5` and every member is in a condition 8..0xF it sets mode 1. This is the monsters' opening attack (surprise-like); how the list and `A4-0x104A == 5` are produced is **open** (`mm3-rules-surprise`).

## 11. Turn order and the round loop

### 11.1 Turn order — `OV4+0x1307C` (harness, 3,000 vectors)
Actors: party positions `0..n-1` (speed = `R+0xD064(char, 4, 0)`, the Speed attribute) then one entry per non-empty monster group (the group's last member's `Spd[id]`, `u8 A4-0x6012`). The order `A4+0x331E[12]` (`0xFF` = unused) lists actor indices by **speed descending, ties by actor index** (party first). When a turn is in progress (`A4-0x3308 != 0xFF`) the actor that held the turn is searched again in the new order and `A4-0x3308` points to its new position (unchanged if the entry at that position is still the same actor; left alone when not found).

### 11.2 Round loop (code) — `R+0x11FA0`
`R+0x12150` = "round over": no actor with a clear flag in `A4+0x3312[12]` remains who can still act (members with worst condition 0xB..0xF never can; monsters always can). The loop: if no monsters or no party -> mode `A4-0x104A = 1`; mark the previous actor done (`A4+0x3312`), advance `A4-0x3308 = (A4-0x3308 + 1) mod (n + groups)`, actor `A4-0x3309 = order[...]`; if the round is over rebuild the order (`OV4+0x1307C`), reset `A4-0x3309/-0x3308 = 0xFF` and clear the flags (new round); a party actor whose worst condition is 8 (asleep) or 0xB..0xF **loses the turn** (same set that blocks casting, 14.1); a capable party actor waits for the player's command (`R+0xC166`); a monster actor (`A4-0x3309 >= n`) runs `R+0xA1DC(0)`, and `A4-0x3307 != 0` ends the battle. Initiative is therefore re-evaluated only when the round is over or a monster dies (12).

## 12. Damage to a monster (harness) — `OV4+0x136E2(char, dmg, mode)`, 3,000 vectors
`mode 0` melee (called with the total of 6.4), `2` fixed, `3` item/thrown, other values = spell kinds (`A4+0x332E`). Target slot `u8 A4-0x3F2B`. In order:
1. `dmg == 0` -> cue 2 and stop. Else a status word of 7 on the target is cleared; cue 1; the animation arrays at `A4+0x715C` (index) are set (`+0x1E8C = 3`; `+0x713C = 2` for mode 2, else `A4-0x3C61[min(kind,6)] + 1`).
2. A monster of id `0x19` hit in melee calls `R+0x122DE(char)` (special reaction, **open**).
3. **Physical resistance**: `mode == 0` or `A4+0x332E == 0`: `p = Phys[id]` (`u8 A4-0x56EE`); `p == 100` -> 0 else `dmg = dmg * (100 - p) / 100` (truncating).
4. **Element**: `e = OV4+0x12D56(mode)` (6.3; **always 0 for spell kinds**, nonzero only for modes 0 and 3) is added; `e > 0` also records the element animation (`+0x1E98`, `+0x710C`).
5. **Spell save** (`mode != 0` only): `OV4+0x82B0(id)` — `rand(1, id+0x32) <= id`, i.e. the **monster id is used as its resistance** — on success the damage becomes 5 (kind 0xB or 0xD), 0x32 (0xF) or `dmg >> 1` (other kinds).
6. `HP` (`u16 A4+0x1492[slot]`): `HP > dmg` -> `HP -= dmg`; otherwise `HP = 0` and the monster **dies**. Damage magnitude cue = `<10 / <50 / <200 / else` (0..3, `OV4+0x12D28`).
7. **Death:** cues 0 and 3; XP `Exp[id]` goes through the party split (6.4); unless `u8 A4-0x1665 == 0x6A` (hyp: a no-reward test mode) `Gold[id]` (u32) is added to `A4+0x70A0` and `Gems[id]` (u16) to the **u32** at `A4+0x709C`; a treasure id `Trea[id] != 0` rolls `rand(1,100)` against `u8 A4-0x3518[Trea-1]` (1, 2, 5, 10, 20, 100 % for treasure ids 1..6) — on success one item is generated (section 13, **harness-verified separately; stubbed here**), `u8 A4+0x709B` (count, max 10) increments and the item bytes (+0x90, +0xA3, +0xB6, +0xC9, +0xDC, +0xEF) are appended to the arrays at `A4+0x70D6 / +0x70CC / +0x70C2 / +0x70B8 / +0x70AE / +0x70A4`. The slot is retired (`u16 A4+0xF42[slot] = A4+0xDEE[slot] = 0x80`, `A4-0x3F2B = 0xFF`), the group-index byte of the animation slot `A4+0x715C` (12 of them: `A4+0x1F73, -0x1BA, -0x1B9, +0x3264, +0x3259, +0x3252, +0x3261, +0x3258, +0x3251, +0x325E, +0x3255, +0x3250`) is cleared and, if the first group is still present, the next target is its last member.
Logged callees: `R+0x971C` cues, `R+0x122DE`, redraw `OV4+0`, the item generator. Null control: no physical resistance scaling.

## 13. Item generator (harness) — `R+0xB83A(grade, buf, slot)`, 3,000 vectors
`grade` 0 -> 1. The slot's seven parallel arrays are cleared (`OV4+0xF08A`). Item id (`+0xDC`): `r1 = d100`, `r2 = d100`: `r1 <= 35`: `r2 <= 30 -> rand(1,6)`, `<= 60 -> rand(7,0x11)`, `<= 85 -> rand(0x12,0x1D)`, else `rand(0x1E,0x21)`; `r1 <= 60`: `r2 <= 70 -> rand(0x22,0x29)` else `0x2A`; else `r2 <= 10 -> rand(0x2B,0x2D)`, `<= 20 -> 0x2E`, `<= 35 -> 0x2F`, `<= 45 -> 0x30`, `<= 55 -> rand(0x31,0x33)`, `<= 65 -> 0x34`, `<= 75 -> rand(0x35,0x39)`, `<= 80 -> rand(0x3A,0x3C)`, else `rand(0x3D,0x45)`.
Enchantments: grade 6 -> one kind `rand(1,4)`; otherwise `n = d100 <= 95 ? 1 : <= 99 ? 2 : 3`; `n = 1`: kind by `d100`: (id >= 0x3D and `<= 90` -> 4), `<= 93 -> 3`, `<= 96 -> 1`, `<= 99 -> 2`, else 4; `n >= 2`: distinct kinds from `rand(1,4)` (re-rolled until different), grade columns `rand(0, grade-1)`. Each kind writes: kind 1 -> `+0xA3 = rand(lo,hi) + A4-0x5354[band]` (band from a d100: cuts 25/45/60/75/95, table `A4-0x539C[band][column][lo,hi]`, 12 bytes/band); kind 2 -> `+0xC9` (cuts 15/25/35/50/65/80/85/90/95, `A4-0x534E`, `+A4-0x52D6[band]`); kind 3 -> `+0xB6` (band 1 if grade 6 else `d100 <= 70 ? 0 : 1`, `A4-0x52CC`, `+A4-0x52B4[band]`); kind 4 -> `+0xEF = rand(A4-0x53D6[g], A4-0x53CF[g])` and `+0x90 = rand(1,10)+5`. Null control: grade 6 treated normally. Tables are in `rules-tables.json` (16).

## 14. Spells

### 14.1 Cast gate (harness)
The caster's chosen spell is `u8 +0x7B` (`0xFF` or `0x4D` = none; 77 spells `0..76`, names in `rules-tables.json`). The cast command (`OV8+0x2540`..) checks `OV4+0xB840(char)` — **blocked (1, with a message) when the worst condition is 8 (asleep) or 0xB..0xF**; conditions 9 and 0xA (confused etc.) can still cast — then `OV8+0x534(char, spell)`: SP cost `s16 A4-0x4102[spell]` (a value `< 1` means `-value * level`, level = `R+0xD03E`), gem cost `u16 A4-0x4066[spell]`; returns **1** if `SP(+0x128) < cost` (signed), **2** if the (sign-extended) gem cost exceeds the party gems `u32 A4-0x1304`, else pays both (SP word, gems long) and returns 0. `OV8+0x5AA` refunds the same amounts (cancel). `OV4+0xF10C(spell, level)` is the same SP cost; `OV4+0xF13E(spell, shift)` = `|cost| * (cost < 0 ? 500 : 100) << shift` (spell price, hyp). 3,000 vectors each.
### 14.2 Per-spell effects (code, not harnessed)
The cast command stores the caster in `A4+0x3270`, the mode in `A4-0x104A`, and dispatches on the spell number through a jump table to 77 handlers in OV8 (`OV8+0x606` ... `0x252E`; the handlers listed by the jump-table stubs from `A4-31110`). Several handlers ask for a target, call the refund when cancelled, then apply effects through the shared helpers (`R+0xCB20`-style stat appliers at OV4+0xCB20..0xD8xx: set/add/subtract a character field by index, used by spells, shrines and events). Not decoded per spell.
### 14.3 Combat spells against monsters (code) — `OV4+0x13282`, mode != 0
Area modes (`A4+0x332A == 1`) loop over the party; otherwise a magic-resistance check first: if `Magi[id]` (`u8 A4-0x590A`) is non-zero, `rand(1, casterLevel + 100) < Magi[id]` resists the spell completely (`OV4+0x133D0..0x1342C`). The spell kind `A4+0x332E` then selects damage and mode through a jump table at `OV4+0x136AA` (kinds 7..16; lists of affected monster ids at `A4-0x3C6A/-0x3C5A/-0x3C55/-0x3C48/-0x3C3B/-0x3C23/-0x3C0D`, exported in the table JSON; effects include fixed damage 0x19, "monster's own HP" (kill), half HP, and a status word set from `A4+0x332E` through `OV4+0x82B0`). The per-kind numbers are **open** (`mm3-rules-spells`).

## 15. Training and world
- **Training hall (`OV5+0x1D90`..`0x2030`)**: the level-up needs `R+0x88CA(char) == 0` (harness), the cast-gate condition check (`OV4+0xB840`, so asleep/paralysed/unconscious/dead/stone/eradicated members are refused), and `R+0x8964(0, 10*level^2, 0)` paying gold from the party pool `u32 A4-0x1308` (harness; `(1, c, f)` pays gems from `A4-0x1304`/bank `A4-0x130C`, `(2, c, 0)` food `u16 A4-0x1318`; the bank pool `A4-0x1310` when the flag is set). Then (code): `+0x23` (level) increments, the experience is rewritten and `HP = R+0xAD56`, `SP = R+0xAC46`.
- **Experience** (harness): `R+0x88FC` (6.x) is the **total-XP equivalent** `T = XP(+0x12C) + classXp << (L-2)` (`L = 1`: `T = XP`; `L >= 12`: `(L-11)*0xFA000 + classXp << 10`); `OV4+0xB7EC` is the XP needed to leave level `L`: `classXp << (L-1)` for `L < 12`, else `(L-11)*0xFA000 + (classXp << 10)`; `R+0x88CA = max(0, B7EC - T)`; the level-up rewrites `XP' = T - B7EC(L)` (code), so `T` is conserved.
- **Open** (`mm3-rules-world`): clock/ageing/food consumption, doors and traps, skills, character creation, shop prices, rest.

## 16. Tables for the remake
`npx tsx tools/mm3/rules-tables.ts` writes `public/assets/mm3/amiga/data/rules-tables.json` (gitignored like all assets): 60 tables with `a4` displacement, width, role and values (rules tables, 22 monster tables, the combat-spell monster lists), the 77 spells with SP and gem cost, the three trailing name strings (`None Ready`, `None`, `Fountain Head`) and a few constants. `tools/mm3/__tests__/rules-tables.test.ts` checks every exported byte against the bytes the verified routines read (> 5,000 matched bytes). Class names are **hyp**.

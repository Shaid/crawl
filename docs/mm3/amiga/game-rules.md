# Might & Magic III (Amiga) — Game Rules

Logic foundation for a browser remake's rules core, derived from the game's own 68000 code: the retail `Might&MagicIII` executable (`data/mm3/amiga/Might&MagicIII`, 272,088 B). No other port and no third-party reference code was used for any rule below (DOS-port notes in `docs/mm3/dosvga/` are used only to cross-check *data tables*, section 3). Written 2026-11-25, pass 1.

**Method.** Single real routines run in a Unicorn 68000 core (`tools/mm3/rules_oracle/`, no OS/disk/chipset emulation; UI/animation callees are replaced by logging stubs) on synthetic state. Per call the harness records every byte the routine read before writing (the input footprint), every byte it wrote, the return value and each logged stub call. `tools/mm3/rules.ts` is a TypeScript port written from the disassembly; `tools/mm3/__tests__/rules.test.ts` runs it against a *strict* sparse memory seeded with only that footprint, so a port that reads state the game did not read, writes a different byte, draws the RNG in a different order or returns a different value fails. Every group has a **null control**: a deliberately wrong variant must disagree with the vectors somewhere. Same method as MM2 (`docs/mm2/amiga/game-rules.md`), adapted to MM3's overlay-linked executable.

**Address conventions.**
- `R+0xNNNN` = offset into the root `CODE` hunk (86,512 B; its payload starts at file offset `0x28`). `OVn+0xNNNN` = offset into overlay segment *n* (1..8 = hunks 3..10 = the CODE payloads 1,620 / 6,356 / 7,092 / **85,452** / 12,124 / 6,020 / 22,172 / 11,964 B, in file order). The combat/party-action code lives in **OV4** (the 85 KB segment); the root holds the C library, the stat engine and the monster-attack code. Overlay code has no relocations: it is PC-relative plus `A4`-relative.
- `A4` = DATA base + 0x7FFE (SAS/C small data). `-N(A4)` is a global. The DATA hunk is 25,156 B stored, **62,072 B declared**; the harness loads the declared size (zero tail) and every table/global below is inside the `A4` window.
- Calls such as `JSR -31668(A4)` go through the jump table at the start of DATA. Entries `4EF9 <abs32>` are root functions (target = `F_<hex>` in listings); entries from DATA+0x3C0 are 8-byte overlay stubs `BSR.W ovlmgr ; .w seg<<8|flag ; .w offset` (`OV<seg>_<hex>`). 161 root entries + 164 overlay entries.
- Ints are 16 bit; C arguments are pushed right to left, so the **first** argument is at the lowest stack address; the callee returns D0, the caller pops. Characters are 304-byte (0x130) records at `A4-0xC78`, big-endian words in memory.

**Evidence grades.** **harness** = diffed against the game's real routine in Unicorn with null controls; **code** = read from the disassembly at the stated address, not executed; **hyp** = inference; **open** = not derived.

## MM3 rules status (build guide, 2026-11-25, pass 1)

What a remake rules core can take **as is** (harness-verified; full vector sets are generated into the gitignored `tools/mm3/rules_oracle/generated/`, small subsets are committed in `tools/mm3/rules_oracle/vectors/`; 60,608 full vectors, 21 units):

| Area | Verified (harness) | Where |
|---|---|---|
| RNG | `rand15` LCG, `srand`, `rand(lo,hi)` (hi+1 overshoot, lo-first args) | 2 |
| Character stats | bracket bonus table, level, age, equipment bonus sum, condition (status) modifier, **effective attribute**, **max HP**, **armour class**, **max SP** | 4 |
| Level thresholds | XP at next level (class table, doubling to level 12, then +0xFA000/level) | 4.6 |
| Saves | luck save and the six category/element saves (`OV4+0x82DC`), simple `x/(x+50)` check | 5.1 |
| Damage to a character | HP word, unconscious / dead thresholds, item breakage on death | 5.2 |
| **Monster hits a character** | dice (count x sides), resistance subtraction, repeated-save halving, 16 special-attack effects (the condition counters) | 5.3 |
| **Party member hits a monster** | weapon select + damage dice, to-hit roll (d20, exploding 20, class level divisor, status +20, monster AC + 10), damage per hit (Might bracket), swings per round by class, element resistance scaling | 6 |
| Experience | XP split among the party | 6.4 |
| Monster tables | all 22 DOS `Mon*.dat` tables located byte-exact in the Amiga DATA hunk (22/22) | 3 |

**Open (not derived; smallest next step in section 9 and `docs/mm3/TODO.md`, ids `mm3-rules-*`):** monster AI/target choice (`R+0xA1DC`), monster turn order/initiative builder (`OV4+0x130C0`), apply-damage-to-monster and monster death/loot (`OV4+0x136E2` and the reward block at the monster-death block `OV4+0x1390x..0x13A60`), surprise/encounter generation, ranged mode, monster spell casting, **party spells** (cast gate, costs, effects), shops/training prices (training cost read as `10 * level^2` gold: code), world rules (doors, traps, clock, food, skills), character creation, RNG draw of loot items (`R+0xB882`).

Corrections made while writing are in section 8.

## 1. Status summary

Vector counts (full sets): rng 4,008; bracket 600; level 2,000; age 2,000; condmod 3,000; equip 4,000; getstat 4,000; maxhp 3,000; ac 3,000; maxsp 3,000; xpnext 3,000; check 2,000; save 4,000; dmgchar 3,000; monattack 4,000; weapon 3,000; partyhit 4,000; element 2,000; dmghit 2,000; meleeround 3,000; xpsplit 2,000 = 60,608. All 29 vitest cases pass (`npx vitest run tools/mm3`). Null controls: off-by-one `rand` range, wrong `level`, flag-flipped `getstat`/`ac`, biased save, missing halving, missing exploding-20, truncated swing count, skipped dead members in the XP split, missing Druid/Ranger second SP pass — each disagrees with the vectors.

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

There is **no to-hit roll here**; where the monster's hit chance is decided was **not located** (open, `mm3-rules-monster-ai`).

Special effects `Spec` 1..16 (counters saturate at 255, i.e. wrap 0 -> 0xFF; `ui` = animation id logged): 1 Poisoned `+0x116`++; 2 Asleep `+0x11B`++; 3 Insane `+0x118`++; 4 Diseased `+0x117`++; 5 Confused `+0x11D`++; 6 Cursed `+0x113`++; 7 first carried item with id `0x22..0x29` gets flag `0x80`; 8 Weak `+0x115`++; 9 SP = 0 (`+0x128`); 10 Paralyzed `+0x11E`++; 11 age `+0x26 += 5`; 12 Unconscious `+0x11F`++ and HP = 0; 13 Eradicated `+0x122`++, every item with id `< 0x48` flagged `0x80`, HP = 0; 14 Stone `+0x121`++, HP = 0; 15 Dead `+0x120`++, HP = 0; 16 every item with id `< 0x46` gets flag `0x40`. (Counter names **hyp**, from the MM3 condition list; offsets and effects **harness**.) The 16 condition counters are mapped in order `+0x113 + n`.

## 6. Party attacks (harness)

### 6.1 Weapon damage — `R+0x11DA6(char, mode)` (harness 3,000)
Clears `A4+0x330A..0x3310`, then scans the 18 slots; `mode 0` accepts slot codes 1 and 13, `mode != 0` code 4. **Every** accepting slot overwrites the globals and rolls its dice, so with several accepted slots the last one wins but all of them draw the RNG: `A4+0x3310 = +0xA3[slot]` (element), `+0x330F = +0xEF[slot]`, hit bonus `s8 A4-0x29E0[+0xB6[slot]] + +0x105` -> `A4+0x330E`, damage `s8 A4-0x29C9[+0xB6[slot]] + +0x104` -> `s16 A4+0x330C`, `nDice = u8 A4-0x2780[id]`, `sides = u8 A4-0x2737[id]`, then `nDice` times `damage += rand(1, sides)`; finally `damage < 1 -> 0`.

### 6.2 To-hit — `OV4+0x12C38(char, mode)` (harness 4,000)
After 6.1: `x = bracket(Accuracy) + s8 A4+0x330E`; `x += level / div[class]` with `div = 1,2,2,3,4,2,2,1,3,2` (class 0..9); `x += d20` where **a natural 20 adds and rolls again** (loop `while roll == 20`); `x -= +0x113` (the Cursed counter); `+20` if the target's status word `A4+0x188E[target]` is non-zero; hit **iff `x >= 10 + AC[monster id]`**. (The monster id is `u16 A4+0x173A[target]`, target `u8 A4-0x3F2B`.)

### 6.3 Damage — `OV4+0x13048` (harness 2,000) and element scaling `OV4+0x12D56` (harness 2,000)
Per hit: `dmg = max(0, bracket(Might) + s16 A4+0x330C)` (the weapon damage of 6.1). Element scaling (kinds 0 and 3 only): `base = u8 A4-0x2A05[el]`; resist = the monster's table chosen by `el` (`< 9` Fire, `< 0x10` Elec, `< 0x15` Cold, `< 0x1A` Acid, `< 0x22` Ener, else Magi; `el == 0` none); `resist == 0` keeps `base`, `100` gives 0, else `base * (100 - resist) / 100` (truncating). Which caller applies this to the weapon hit is **open**.

### 6.4 Melee round and XP — `OV4+0x13282` (harness 3,000), `OV4+0x12FB0` (harness 2,000)
Mode 0: `swings = level / div2[class] + 1` with `div2 = 5,6,6,7,8,6,5,4,7,6`; each swing is 6.2 and each hit adds 6.3's damage; the total goes to `OV4+0x136E2(char, total, 0)` (monster damage, logged stub) then `OV4+0x1307C`. **XP split**: every party member — dead or not, the condition switch is vacuous — gets `award / partyCount` added to `+0x12C` (`partyCount` = `u8 A4-0x1672`, or `u8 A4+0x1F74` indices from `A4-0xC81` when `u8 A4-0x104A == 2`). Integer division; the remainder is lost.

## 7. What a rules core can take from this
Everything in the status table is expressed as pure functions over the character record and the `A4` tables in `tools/mm3/rules.ts`; the unit tests are the specification. Tables (`A4-0x42F0` ... ) are read from the executable's DATA hunk — a remake needs a small extracted table file (not yet written: `mm3-rules-tables`).

## 8. Corrections made while writing
> **Correction (2026-11-25):** the Amiga port is **not** missing the `Mon*.dat` stat tables (`docs/mm3/TODO.md` `mm3-mon-stats`: "the Amiga port has no Mon*.dat (stats compiled into its code)") — they are compiled into the DATA hunk, byte-identical to the DOS files (section 3).
> **Correction (2026-11-25):** first reading of the to-hit roll said a natural 20 skips the Cursed penalty; the `beq 12CC2` at `OV4+0x12CD8` re-rolls instead. The `getstat` `flag` first read as "skip the condition modifier only"; it also skips the temp byte. The condition modifier's out-of-range index (6) returns the case-6 block, not the index.

## 9. Open (ids in `docs/mm3/TODO.md`)
- `mm3-rules-monster-ai` — the monster's turn: target preference (`AttP`, `R+0xA1DC`..`0xA67C`), whether it attacks, ranged `Rang`, monster to-hit (not found: `R+0x9E02` has none), initiative/turn order (`OV4+0x130C0`, `Spd`), flee/morale, summon.
- `mm3-rules-monster-damage` — `OV4+0x136E2` (apply damage to a monster slot, status 7 clear, death), the reward block the monster-death block `OV4+0x1390x..0x13A60`, loot item generator `R+0xB882` (item id by d100 bands into the character's `+0xDC` array).
- `mm3-rules-spells` — party spell cast gate, SP cost, effects (not started).
- `mm3-rules-world` — doors/traps/clock/food/skills; character creation; shops/training prices (`10*level^2` read, not harnessed); `mm3-rules-tables` extraction of the DATA tables into a JSON for the remake.

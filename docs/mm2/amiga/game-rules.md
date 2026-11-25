# Might & Magic II (Amiga) — Game Rules

Logic foundation for a browser remake's rules core, derived from the game's own 68000 code: the retail `mm2` executable (`data/mm2/amiga/data/mm2`, 181,524 B). No other port and no third-party reference code was used for any rule below; `docs/mm2/amiga/data-structure.md` (format work ported from Vairn/MM2) is used only for field *meanings*, and where the code disagrees with it this document says so (section 8). Written 2026-11-25; pass 2 (encounters, turn order, monster side, equipment, treasure, training, gates) the same day.

**Method.** Single real routines run in a Unicorn 68000 core (`tools/mm2/rules_oracle/`, no OS/disk/chipset emulation; UI, text and key-wait callees are replaced by logging stubs) on synthetic state. Per call the harness records every byte the routine read before writing (the input footprint), every byte it wrote, the return value and each logged stub call. `tools/mm2/rules.ts` is a TypeScript port written from the disassembly; `tools/mm2/__tests__/rules.test.ts` runs it against a *strict* sparse memory seeded with only that footprint, so a port that reads state the game did not read, writes a different byte, draws the RNG in a different order or returns a different value fails. Every check has a **null control**: a deliberately wrong variant of the port must disagree with the vectors on at least one case.

**Address conventions.**
- `CODE+0xNNNN` = offset into the root CODE hunk (0x2593C bytes; = file offset − 0x28). The executable is an overlay file: root hunks CODE (153,916 B), DATA (8,604 B), BSS; the 15,544 B overlay hunk after `HUNK_OVERLAY` (file `0x28854`) holds the `spells.dat`/`items.dat` loader strings and is **not** loaded by the harness.
- `A4` = DATA base + 0x7FFE (SAS/C small data; set by `LEA SECSTRT_1+32766,A4` at CODE+0x24920). `-N(A4)` is a global. The window `A4-0x7FFE .. A4` is the DATA hunk followed *contiguously* by the zero-cleared BSS (CODE+0x248B0 clears 0x16D8 longs from `A4-24162`); everything the rules touch lives in it. Calls such as `JSR -31668(A4)` go through a jump table of `JMP abs.l` stubs at the start of DATA: target = `u32` at DATA + (0x7FFE + disp) + 2. `tools/mm2/rules_oracle/resolve_asm.py` annotates the IRA listing with the resolved targets (`=> F_22BC6`).
- Ints are 16 bit; C arguments are pushed right to left, the callee returns D0, the caller pops.
- Character records are 130 (0x82) bytes at `A4-10814`, **big-endian words in memory** (little-endian on disk; swapped on load). `charPtr(slot)` = CODE+0x477E = `A4-10814 + slots[slot]*130` with the party table `slots` = 8 × `u16` at `A4-31082` (`0xFFFF` empty), party size `u16` at `A4-31066`.

**Evidence grades.**
- **harness** — diffed against the game's real routine in Unicorn (vector counts below), with null controls.
- **code** — read from the disassembly at the stated address; not executed.
- **hyp** — inference; **open** — not derived (smallest next step in section 9).

Reproduce: `tools/mm2/rules_oracle/gen_vectors.sh` (needs a venv with `unicorn`; full vector sets go to the gitignored `tools/mm2/rules_oracle/generated/`, small committed subsets to `tools/mm2/rules_oracle/vectors/`); `npx vitest run tools/mm2/__tests__/rules.test.ts` uses the full sets when present and the committed subsets otherwise.

## MM2 rules status (build guide, updated 2026-11-25, pass 2)

What a remake rules core can take **as is** (each unit: a real routine run in Unicorn, diffed against a TypeScript port with strict read/write-footprint parity, null control; sections cited; vector counts are full sets, ~1,000+ committed subsets in `tools/mm2/rules_oracle/vectors/`):

| Area | Verified (harness) | Where |
|---|---|---|
| RNG, `rand(lo,hi)` | LCG, hi+1 overshoot | 2 |
| Monster record | unpack (all 256 retail + synthetic), ability uses, initiative | 3.1, 10 |
| Encounter | group sizes, reinforcement pick, budget, generation loop | 10.1 |
| Encounter prompt | surprise roll, Hide, Run, Bribe (Food/Gold/Gems) odds | 10.2 |
| Turn order / round | actor selection, ties, status decay, battle-over test, a member running | 10.3 |
| Monster turn | flee/morale, ability gate, melee vs ranged vs advance vs spell decision, melee and ranged target pick | 11.1-11.2, 4.1, 4.5 |
| Monster hits party | hit roll, damage, saves, death, all **30** special/condition effects | 4.1, 4.3, 11.3 |
| Party hits monster | attack roll, crits, immunity, damage, death, removal, queue XP, quest flag, kill reward, XP award | 4.2, 4.6, 4.7, 11.4 |
| Characters | stat bonus/sync, luck save, spell level/SP, training HP, **XP needed per level, training cost**, rest | 5, 12.2 |
| Equipment | equip/unequip (weapon bytes, AC accumulator, stat bonus), AC recalculation | 12.1 |
| Treasure | treasure count, item roll, charges, use power | 12.3 |
| Spells (gates only) | SP cost, gem gate, SP gate, combat-class gate, location gate | 6, 12.4 |

**Open (not derived; smallest next step):**
- `mm2-rules-spell-effects` — the **effects** of the 96 spells and the monster spell dispatcher CODE+0x1FB4E / group verbs (sprays, breaths, bolts...), the party cast handlers (~CODE+0x1AB0C), `partyEffect` CODE+0x10894, `advance` CODE+0x10118, `special` CODE+0x1042C. The `spells.dat`/`items.dat` loader (overlay hunk) was **not** needed: the harness writes the table bytes where the loader would and the verified routines only read them; extending the harness to load the overlay is still needed for the loader itself.
- `mm2-rules-equipment` (remainder) — item *use* (items.dat `+0x0F` effect), curses/class restriction enforcement at equip, shop rules.
- `mm2-rules-world` — traps, door bash/unlock (CODE+0x9C2A / 0x20D6E), food consumption outside rest, skills, passability.
- `mm2-rules-chargen` — character creation (overlay code).
- Pieces still stubbed inside verified units: the party action routine CODE+0x119C2 (command menu: attack, cast, use, run), bribe payment CODE+0x6C66 / 0x6ACE / 0x6B9A, `retreat` CODE+0x11646's map move; the meaning of per-map bytes `A4-22025` / `-22029` / `-22030..-22032` (hyp: map header fields, set by the map loader).
- Party-attack target prompt (target 0xFF) and ranged/melee mode selection are UI.

Corrections made in pass 2 are in sections 8 and 11 (`> **Correction (date):**`).

## 1. Status summary

| Area | Harness-verified (grade) | Open |
|---|---|---|
| Foundations | RNG: LCG, `rand(lo,hi)` incl. the hi+1 overshoot (harness) | — |
| Character | stat bonus table, luck save, stat-to-working-copy sync, spell level gain and SP formula, Hall of Training level/HP gain, party rest, XP award (harness) | XP gate for training, ageing/ageing effects outside rest, equipment-derived weapon bytes (+0x4C..4F), item use, chargen |
| Melee | monster unpack, monster-vs-party roll, party-vs-monster roll with Robber/Ninja crits, damage to a character incl. saves, kill reward, XP pool/share, party power (harness) | initiative/turn order, applying damage to monsters, monster special attacks and status effects, encounter generation/reinforcement/surprise/flee |
| Spells | SP cost, gem gate, SP gate, spell-level learning, monster spell damage dice (harness) | the per-spell effect handlers (monster dispatcher CODE+0x1FB4E and the party handlers), combat/outdoor gate, spell book contents, spell list vs `tools/mm2/spells.ts` |
| World | rest (harness) | traps, doors/unlock/bash, food consumption outside rest, skills (Mountaineering, Pathfinder...), overland passability, overlay code |

Vector counts (full sets): rng 4,008, monunpack 856 (256 retail + 600 synthetic records), bonus 256, luck 3,000, dmgchar 3,000, melee 3,000, pmelee 3,000, monspecial 2,000, killreward 2,000, partystrength 1,000, mspelldmg 2,000, sync 100, spelllevel 3,000, xpaward 1,500, train 3,000, rest 2,000, spellcost 3,006 — 36,726 vectors; the committed subsets hold ~1,000. **Pass 2 adds 63500** (sections 10-12: encgroup 3,000, moninit 1,500, battleover 1,500, encpick 3,000, encbudget 2,000, encgen 1,500, charflee 2,000, round 2,000, driver 2,000, mondeath/mondamage/questkill/resolve/tgtranged/tgtmelee/monturn 2,000 each, setcond 4,000, monspecial2 3,000, spellgate 3,000, equip/unequip/ac/lootitem/treasure/xpneed/traincost 3,000 each), 100226 in total.

## 2. Foundations (harness)

**RNG** — CODE+0x24048 `rand15()`: `seed = seed*0x41C64E6D + 0x3039 (mod 2^32)`, result `(seed >> 16) & 0x7FFF`; the seed is the `u32` at `A4-24802`. CODE+0x2407C `srand(w)` stores the zero-extended 16-bit `w`. This is the SAS/C runtime's generator, so a remake that seeds it identically reproduces the game's draws.

**`rand(lo, hi)`** — CODE+0x22BC6 (called 109 times; arguments pushed hi first, so `lo` is at `8(A5)`): if `hi <= lo` return `lo` **without drawing**; else `r = rand15()`, `k = 0x8000 / (hi-lo+1)` (unsigned 16-bit division), result `lo + r / k`. Because `k` is truncated the result can exceed `hi`: whenever `r >= k*(hi-lo+1)` (at most `hi-lo` values of `r` in 32,768, e.g. 0.2% for 1..100) it returns `hi+1`. Verified with 8 directed seeds per run whose first draw is >= 32760. Preconditions inherited from the 68k code: `0 < hi-lo+1 <= 0x8000`.

Several rules write `rand(10, 1009) / 10` (signed 16-bit divide, truncating) as a percentile d100 (1..100); others use `rand(1,100)` directly. Both appear below; they are not the same stream of values.

## 3. Monsters

### 3.1 Record unpack — CODE+0x4C8E `unpack_monster(slot)` (harness: 856 vectors, all 256 retail records)

`slotType[slot]` (`A4-4574`, `u8[11]`) is the `monsters.dat` record index of the monster in battle slot `slot`; the record (26 B) is fetched by CODE+0x99C4 from the loaded `monsters.dat` (pointer `u32` at `A4-30658`). The routine clears 0x38 bytes at `A4-4562` and decodes (record offset → working field; `inc` = the byte at that address is incremented, starting from 0):

| Record | Meaning | Working fields |
|---|---|---|
| 0x00..0x0D | name, each `& 0x7F` | `A4-4562..-4549` |
| 0x0E hp | `((c&0x3F)+1) * mul[c>>6]`, `mul` = `u16[4]` at `A4-29804` = {1,10,100,1000}, truncated to 16 bits | `u16 A4-4512` |
| 0x0F xp | `((c&0x1F)+1) * mul[(c&0x60)>>5]`, x1000 if `c >= 0x80` | `u32 A4-4510` |
| 0x10 treasure | bit7/6/5/2 -> inc `-4544/-4545/-4546/-4542`; `c&3` -> `-4541`; `(c>>3)&3` -> `-4543` | |
| 0x11 pabil | `c&0x1F` -> `-4540`; `tier[(c&0xE0)>>4]` -> `-4539`, tier = `u8[8]` at `A4-29796` = {0,10,20,35,50,75,90,100} | group-attack verb, ability chance % |
| 0x12 sabil | bit7/6/5 -> inc `-4525/-4526/-4536`; `c&0x1F` -> `-4537` | single-attack effect |
| 0x13 oabil | bit7 -> inc `-4513`; `(c&0x0F)+1` -> `-4535`, x10 (byte-truncated) if bit4; `(c>>5)&3` -> `-4534` | reinforcements |
| 0x14 speed | `c&0x0F`+1 -> `-4530` **(attacks per round)**; `c>>4`+1 -> `-4538` | |
| 0x15 picture | `c & 0x7F` -> `-4533` | |
| 0x16 ac | bit7/6 -> inc `-4524/-4523`; `(c&0x1F)+1` -> `-4532`, x10 **truncated to a byte** if bit5 | AC |
| 0x17 damage | bit7/6 -> inc `-4521/-4522`; `(c&0x1F)+1` -> `-4531`; if bit5: `250` when the value is > 25, else x10 | damage die |
| 0x18 speed2 | bit7/6 -> inc `-4519/-4520`; same decode -> `-4529` | initiative |
| 0x19 mres | bit0/1/2 -> inc `-4517/-4518/-4516`; `(c>>3)&3` -> `-4528`; `tier[c>>5]` -> `-4527` | |

Checked against `tools/mm2/monsters.ts` on all 256 retail records: hp, xp, ac, damage and initiative agree. Differences only on synthetic records: `monsters.ts` caps AC at 250 where the game does not (it x10-truncates to a byte: code 0x3F -> 64, not 250), and the game caps damage/initiative to 250 only when the base value is > 25. Retail never exercises either (no retail record has bit5 set with a base value > 25), so this is a codec-edge correction, not a data error.

Byte `0x14`'s low nibble is the attack count the melee roll loops over (section 4.1) — the data-structure note that it is "untraced" is now resolved.

## 4. Melee

### 4.1 Monster attacks a party member — CODE+0x10478 (harness: 3,000)

State: acting character slot `u8 A4-1272`; acting monster slot `u8 A4-1271`; `tierThr` = `u8[16]` at `A4-28438` = {40,45,50,55,60,65,70,75,80,90,100,120,150,250,100,200}; per-slot status `u8[11]` at `A4-1305`.
1. `dmg = 0; hits = 0; n = attacks per round (A4-4530)`.
2. `T = tierThr[recordIndex >> 4]` where `recordIndex = slotType[slot]` (so the threshold climbs with the monster's index, 16 monsters per tier).
3. `v = (AC <= T) ? T - AC : 5` with `AC` = character `+0x24`; **status bit 3 halves `v`**.
4. For each of the `n` attacks: `d = rand(10,1009)/10`; if `v > d` the attack hits: `hits++`, `dmg += rand(1, damage die (A4-4531))`.
5. **Status bit 2 halves the total damage.**
6. The routine then calls CODE+0xFF42 (UI text + damage application; reported by the port as `applyHit [dmg, hits]`). That routine also draws `rand(1,8)` to pick the attack verb string.

So a monster's chance to hit is `v` percent per attack (`T - AC`, or a flat 5% when the character's AC exceeds the tier threshold) — AC is a *positive-is-good* byte here.

### 4.2 Party member attacks a monster — CODE+0x111DA `partyAttack(target)` (harness: 3,000)

`mode = A4-24114` (0 melee, 1 ranged); candidate group size = `A4-1316` (melee) or `A4-30654` (ranged), capped at 10; if <= 1 the target is forced to 0 (target `0xFF` opens the interactive target prompt — not modelled). The target is unpacked (section 3.1). With `c` = the acting character (`A4-1269` slot), class `+0x0F`, level `+0x71`:
- `bonusToHit = level / u8[class]@A4-28478` {1,1,1,3,4,2,2,1}; `attacks = level / u8[class]@A4-28470 + 1`, {4,4,5,7,10,5,5,4} levels per extra attack.
- weapon bytes: damage die = `+0x4C` (melee) or `+0x4E` (ranged); a weapon bonus byte = `+0x4D` (melee) or `+0x4F` (ranged) feeds *both* totals below. An Archer (class 2) firing ranged keeps the `+0x4C` die and starts its damage bonus at `rand(1, min(level,100))`.
- accuracy `= weaponBonus + stat_bonus(+0x6F) + A4-31133`; damage bonus `= weaponBonus (+ the Archer roll) + stat_bonus(+0x6B)` (stat_bonus: section 5.1).
- per attack: `d = rand(1,100)`. `d < 6` hits, `d < 9` misses outright. Otherwise `t = (condition bit 0 of +0x26) ? 3 : 25`, `r = rand(1, min(t + bonusToHit, 250))`, `s = r + accuracy` (16 bit): `s > 255` hits, `s <= 10` misses, `((s&255) - A4-31141)` outside `0..127` (16-bit unsigned) misses, otherwise it hits iff `(s & 255) >= monsterAC`.
- hit: `dmg = (rand(1, weaponDie) + damageBonus) & 255`, a result `> 250` becomes 1; `hits++` and the total (16 bit) accumulates. After the loop the total gains `A4-31129` if anything hit.
- **Melee only** (`mode == 0`): `d = rand(1, 100 + min(+0x72, 100))`. Robber (class 5): `d > 90 or d < 5` doubles the total and sets crit=1. Ninja (class 6): `d > 94 or d < 5` quadruples the total and sets crit=2.
- Then CODE+0x11040 (messages + application) receives `[damage, hits, crit]`. Return value 1.

### 4.3 Damage to a character — CODE+0x4952 `damage_char(ch, dmg, pB, pA, pC)` (harness: 3,000 vectors: 662 conscious -> unconscious, 190 alive -> dead, 1,419 with no state change, 729 on an already dead/out character)

- Condition byte `+0x26 >= 0x80` (dead/stoned/...): nothing happens (no RNG).
- `*pA != 0`: `t = A4-31146 + char[+0x16]`; if `t >= rand(1,100)` the hit is negated entirely (the routine returns, *pA unchanged); else `*pA = 0`.
- `*pB != 0`: `luck_save(ch)` true -> damage / 2.
- `*pC` (damage type; `3` and `0xFF` mean none): `resist = A4-31145 + char[+0x17]` (type 1), `[+0x1C]` (2), `[+0x18]` (0) or `[+0x11+type]` otherwise; `resist >= rand(1,100)` -> damage / 4, else `*pC = 0`.
- damage > 0: clear the asleep bit (0x10); if the character is already unconscious (0x40) the condition becomes **0x81 (dead)**; else if `dmg < hp (+0x5E)`, `hp -= dmg`; else condition `|= 0x40` (unconscious) and `hp = 0`.
- the final reduced damage is always left in `A4-3852` (also for 0).

### 4.4 Luck save — CODE+0x48BA `luck_save(ch)` (harness: 3,000)

`r = rand(1,100)`: `r <= 5` fails, `r >= 95` passes. Otherwise `d = rand(1, level + 20)` (level = `+0x20`) and the save passes iff `stat_bonus(+0x15 luck) + level >= d` (a sum that wrapped below `level`, i.e. a negative bonus, becomes 2).

### 4.5 Monster ability gate — CODE+0x105B6 (harness: 2,000)

Returns 1 (and spends one use) iff status bit 6 is clear, uses left (`u8[11]` `A4-1283`) > 0 and `rand(1,100) <= abilityChance` (`A4-4539`, section 3.1, pabil bits 5-7).

### 4.6 Kill reward — CODE+0x10B70 (harness: 2,000)

For the monster in `A4-1309` that just died, using the unpacked treasure bytes:
- `A4-4542` set: gems (`u16 A4-16146`) `+= rand(1,10)`.
- `A4-4543 = k != 0`: `b = recordIndex`; `k==2`: `b >>= 4`; `k >= 3`: `b >>= 1`; `b += rand(1,b)` (byte); `bonus = rand(1,50) + 6`; `k==1` zeroes `b`; gold (`u32 A4-16144`) `+= bonus + (b << 8)` (the shift is 16-bit).
- `A4-4541 = t != 0` and `t >= best-so-far (A4-24105)`: `A4-24104 = recordIndex >> 4`, `A4-24105 = t` (the loot tier for the treasure roll).
- XP pool (`u32 A4-28614`) `+= unpacked XP (A4-4510)`.

### 4.7 End of battle XP — CODE+0x12430 (harness: 1,500; the non-UI part)

Sets `A4-30653 = 1`, `A4-31052 = 0`; runs the treasure award CODE+0x123B0 when `A4-24105 | A4-24104 != 0`. The pool is divided (unsigned, truncating) by the number of members with condition `< 0x80` and that share is added to the `u32` at `+0x62` of each such member. The pool variable is *overwritten with the share*.

### 4.8 Party power for encounters — CODE+0x11E58 (harness: 1,000)

Sum of every member's `u16 +0x74` (effective max HP) / 8, then by the byte at `A4-31150`: `0` -> /4, `1` -> /2, `3` -> x2 (`2` unchanged); `A4-28610` receives half the highest member level (`+0x71 >> 1`). Feeds encounter generation (consumers CODE+0x11F0A, hyp: the byte at `A4-31150` is a difficulty setting).

### 4.9 Monster-cast spell damage dice — CODE+0x1F6DC (harness: 2,000)

Adds `recordIndex >> 4` dice `rand(1, n)` to the accumulator `A4-3852` (not cleared first), then `x2 + 1`. Used by the monster spell dispatcher; the dice count is the monster's tier, not a caster level.

## 5. Characters

### 5.1 Stat bonus — CODE+0x4442 (harness: all 256 inputs)

`bonus(v) = -3 + #{ i : v > T[i] }` over the byte table `T` at `A4-29830` = {4,6,9,13,15,17,19,22,26,30,45,60,75,90,105,120} (a stat <= 4 is -3, 5-6 is -2 ... 121+ is +13), returned as a byte (0xFD = -3). Inputs > 120 read past the 16 listed entries (the following data bytes), which is part of the vector footprint.

### 5.2 Stat sync — CODE+0x4476 (harness: 100)

Copies stored stats into the working copies combat reads: `+0x6B <- +0x10` (might), `+0x6F <- +0x14` (accuracy), `+0x6D <- +0x12`, `+0x6C <- +0x11`, `+0x71 <- +0x20` (level), `+0x72 <- +0x23` (spell level), `+0x6E <- +0x13`.

### 5.3 Spell level and spell points — CODE+0x20064 `learn_spell_level(slot)` (harness: 3,000, 702 successes)

`w = level (+0x20)` for Cleric(3)/Sorcerer(4), `level - 5` for the other classes, then `w = w / 2` (arithmetic shift, only if `w > 0`). Refused unless `1 <= w <= 10` and `w > current spell level (+0x23)`; Paladin(1)/Archer(2) cap `w` at 7. On success: `+0x23 = +0x72 = w`; the first four entries of tier `w` of the clerical table (`A4-25762`, Paladin/Cleric) or sorcerous table (`A4-25794`, Archer/Sorcerer) — 4 bytes per tier, `0x80` = none, `> 0x2F` -> `-0x30` — are OR-ed into the spell book at `+0x51 + (n>>3)` with mask `1 << (n&7)`; **SP = (stat_bonus(INT for Sorcerer/Archer, else PERSONALITY) + 3) * w**, a bonus byte `>= 0xF2` counting as 0, stored in `+0x58` and `+0x5A`.

### 5.4 Hall of Training — CODE+0x20232 `train(slot, cost)` (harness: 3,000)

Hall index `u8 A4-31218`. Refused when the condition byte is non-zero or `cost > gold (+0x66)`. `cost == 0` instead grants `gold += gold/2` (cap 50,000), no payment. Else `gold -= cost`. Then `+0x20` and `+0x71` gain 1 level (saturating at 255); Robber/Ninja with `+0x1E != 0` gain 1 there too. **HP gain** = `classDie[class] * hallMul[hall] / hallDiv[hall]` (16-bit; tables `u16` at `A4-25818` = {12,10,10,8,6,8,8,15} for Knight..Barbarian, `A4-25838` = {1,5,2,3,2,2,5,3,4,3}, `A4-25828` = {2,5,3,4,3,12,10,10,8,6}), **+1 if the division left a remainder** (not for Cleric/Robber/Ninja), **+ endurance bonus** (`stat_bonus(+0x27)`, a byte `>= 0xF0` counting as 0), added to HP (`+0x5E`), base max (`+0x60`) and max (`+0x74`). Paladin/Archer/Cleric/Sorcerer then run 5.3. The XP requirement for training is *not* in this routine (open, section 9).

### 5.5 Rest — CODE+0x19B28 (harness: 2,000; the non-UI part)

Clears 13 per-rest flag bytes (`A4-31147..-31135`); then each member with condition `< 0x80`: condition `&= 0x0D`; age (`+0x21`) `>= 0x50` and `rand(1,100) < 50` -> dies of old age (0x81); HP 0 becomes 1; effective max HP (`+0x74`) = base (`+0x60`), or half of itself with condition bit 3; **only a member with food (`+0x25 != 0`) is processed further**: food -1; unless condition bit 2, HP = max HP; a member with a spell level gets SP (`+0x5A`) `= (stat_bonus(INT/PERSONALITY) + 3) * level (+0x20)`; stat sync (5.2); `+0x73 = +0x27`, `+0x70 = +0x15`, `+0x58 = +0x5A`. After the party: unless `A4-31158 == 9`, `rand(1,60) < 10` interrupts the rest (`A4-31158 = 9`, flags `A4-31058 = A4-31204 = 1`, redraw call).

Note the rest SP formula uses *level* (`+0x20`) where 5.3 uses the new spell level `w`; so the SP pool is `(bonus+3) * level` after any rest and `(bonus+3) * spellLevel` right after training.

## 6. Spells

Spell data in memory: 2-byte records at `A4-11006`, index = Sorcerer 0..47 then Cleric 48..95 (`CODE+0x79C6` computes the index from the chosen level/number via `u8[10]` tables at `A4-29662`/`A4-29653`).

**SP cost** — CODE+0x4BBC (harness: 3,000 mixed): let `b1` = record byte 1. Flat cost `b1 & 0x0F` if non-zero. Else `mult = (b1 & 0x30) >> 4`: `mult != 0` -> `level (+0x71) * mult`; `mult == 0` -> `8` (`10` if `b1 & 0x40`) `+ monster count (A4-30654, capped at 10 except for records 42 and 46 — A4-10922 / A4-10914 — which use it uncapped)`. Result in `u16 A4-16138`.

**Gem gate** — CODE+0x795C: gems needed = `byte0 & 0x3F`, `> 50` means 100 (`u16 A4-16136`); fails (UI message 5, return 0) when `+0x5C` is lower.

**SP gate** — CODE+0x79A0: current SP `+0x58` must be `>=` the cost in `A4-16138` (UI message 6 otherwise).

The remaining gates the cast command checks (CODE+0x78A8: `(byte0 >> 6) & 3` combat/outdoor class; CODE+0x790E: `byte1 >= 0x80` outdoor-only; CODE+0x7B5x callers) were read (**code**) but not harnessed, and no per-spell effect has been derived: see section 9.

## 7. What a rules core can take from this

Combat round skeleton (confirmed pieces): `unpack_monster` -> monster attack roll (4.1) -> `damage_char` (4.3) -> party attack roll (4.2) -> kill reward (4.6) -> XP award (4.7); out of combat: rest (5.5), training (5.4), spell level (5.3), SP/gem gates (6). Missing for a playable loop: initiative (the monster byte `0x18` -> `-1294[slot]` and the round loop CODE+0x12A22/0x12C6E), encounter generation, monster-side damage application (CODE+0x10EAC, 0x10E5E) and special attacks, flee/surprise (CODE+0x12EE0: `rand(1,100) <= 0x28` and `<= A4-24142` -> surprise 2, `>= 0x5A` -> 3, hyp), and the spell effects.

## 8. Corrections to earlier claims

> **Correction (2026-11-25):** `docs/mm2/amiga/data-structure.md` section 5 / `tools/mm2/roster.ts` label the HP fields `+$5E` "HP max", `+$60` "HP temp", `+$74` "HP current" and `+$58` "SP max", `+$5A` "SP cur". The game's code uses them the other way round: damage subtracts from `+0x5E` (4.3), rest copies `+0x74` into `+0x5E` (5.5), training adds to all three (5.4) and `+0x60` is the base maximum that rest copies into `+0x74`; the SP gate spends `+0x58` and rest sets `+0x58 = +0x5A`. Correct reading: **`+0x5E` HP current, `+0x60` base max HP, `+0x74` effective max HP (halved by condition bit 3); `+0x58` SP current, `+0x5A` SP max.** Fresh starters have them equal so the roster fixture cannot tell them apart. `roster.ts` field names are left as the format codec's (on-disk) names; its docs should be read through this correction.

> **Correction (2026-11-25):** `+0x62` is experience (XP award 4.7 adds the share there) and `+0x66` is gold (training reads and charges it); the previously parenthesised "XP / gold" order is right. The routine at CODE+0x1456E (x3 move of `+0x66` into `+0x62`) was not traced here; it is *not* an XP split.

> **Correction (2026-11-25):** the monster record's `0x14` low nibble is not "untraced": `+1` it is the number of attacks per round the melee roll loops over (3.1, 4.1). `0x14`'s high nibble +1 is stored in `A4-4538` (consumer still unidentified).

> **Correction (2026-11-25):** `tools/mm2/monsters.ts` `decodeMonsterStat` (AC/damage/initiative) caps every value at 250; the game truncates AC x10 to a byte and caps damage/initiative at 250 only when the base value is > 25 (3.1). Identical on all retail records.

> **Correction (2026-11-25):** the roster/in-memory record carries working copies at `+0x6B..+0x73` that combat reads (stat sync 5.2), and the weapon bytes the attack roll uses are `+0x4C..+0x4F` — inside the range data-structure.md labels "spellbook bitmask `$4C..$57`". The spell book written by 5.3 lands at `+0x51..`, so those four weapon bytes overlap the first bytes of that range as documented; one of the two readings is wrong (hyp: the weapon bytes are derived equipment values, recomputed when equipment changes; the spell book then starts at `+0x51` rather than `+0x4C`). **Resolved in pass 2 (12.1): confirmed (harness).**

## 9. Open (TODO ids in `docs/mm2/TODO.md`) — pass 1 list, superseded by the status block at the top

- `mm2-rules-initiative` — turn order (`A4-1294[slot]`, party initiative) and the round loop (CODE+0x12A22, 0x12C6E); flee/surprise odds.
- `mm2-rules-monster-special` — monster special attacks and status effects: CODE+0xFD8C (`monster_special`, sabil effect roll with `u8[16]` at `A4-28422`), CODE+0x1F27E (set condition), the group-ability handlers; condition-bit meanings beyond 0x10/0x40/0x80.
- `mm2-rules-monster-damage` — applying damage to a monster (CODE+0x10EAC), death handling (0x10E5E, 0x10CCE compaction), the message/application routine CODE+0x11040 (`resolve`).
- `mm2-rules-encounter` — encounter generation: group count (CODE+0x11D0C), monster pick and reinforcement (CODE+0x11F0A), tier tables.
- `mm2-rules-spell-effects` — per-spell effects (monster dispatcher CODE+0x1FB4E, party handlers around CODE+0x1AB0C/0x1AC94), combat/outdoor gates, spell list cross-check against `tools/mm2/spells.ts`.
- `mm2-rules-training-gate` — XP needed for each level and who calls CODE+0x20232 (event VM / Hall scripts), and the XP table.
- `mm2-rules-equipment` — derivation of `+0x4C..+0x4F` and `+0x24` (AC) from items, item use/charges, curse/class restrictions; the `+0x4C..+0x57` overlap (section 8).
- `mm2-rules-treasure` — CODE+0x123B0 treasure roll from the tier recorded by 4.6.
- `mm2-rules-world` — traps, door bash/unlock (Vairn cites CODE+0x9C2A/0x20D6E), food consumption, skills; overland passability is `mm2-overland-passability-0x9424`.
- `mm2-rules-chargen` — character creation and the overlay hunk (not loaded by the harness).

## 10. Encounters, initiative and the round loop (pass 2)

Ports: `tools/mm2/rules2.ts`; vectors `tools/mm2/rules_oracle/{encgroup,moninit,battleover,encpick,encbudget,encgen,charflee,round,driver}`; tests `tools/mm2/__tests__/rules2.test.ts`. Same strict-footprint method and null controls as passes 1; the harness gained stub *write recording* (a stub's side effects are part of the write footprint) and quiet stubs (UI calls that are not logged).

Per-slot monster arrays (11 slots, set by CODE+0x11C2C `init_slot`): status `u8 A4-1305`, initiative `u8 A4-1294` (record byte 0x18 decode), **ability uses left `u8 A4-1283` = record speed byte high nibble + 1** (the `A4-4538` field of 3.1, now identified; 4.5 spends it), hit points `u16 A4-1338` (record hp). Acted flags: monsters `u8 A4-24138[10]`, party `u8 A4-24128[8]`. Party working initiative = character `+0x6E` (stock `+0x13`, stat sync 5.2).

### 10.1 Encounter generation (harness)

- **Budget** CODE+0x12072 (harness: 2,000): complete (`A4-28609 = 1`) when `sum >= partyPower` (`A4-28618`, 4.8) where each monster adds `(recordIndex >> 4) + 1` (monsters beyond the 10 visible slots each add slot 10's value), or the monster count `>= A4-22032` (a map byte: the map's monster limit, hyp), or `>= 250`.
- **Add a group** CODE+0x11F0A (harness: 3,000): `a = u8[4]@A4-28608[difficulty A4-31150] + partyHalfLevel (A4-28610) + 1 + (d100 < 61 ? 0 : < 81 ? 1 : < 96 ? 2 : 3)`, `a = min(a, 14)`, `a = rand(1, a)`, clamped to the map's tier range `[A4-22030, A4-22031]`, **record index = (a-1)*16 + rand(1,16) - 1**; the record's reinforcement count (`oabil`, `A4-4535`) gives `n = rand(1, count)` copies placed in free slots (< 11); the surplus is added to the monster count anyway (queued, cap 0xF0, wrap to 0xFA).
- **Generate** CODE+0x1213E (harness: 1,500): add a group, re-check the budget, until complete.
- **Group sizes** CODE+0x11D0C (harness: 3,000): melee group `A4-1316` = (if unset) indoor/dungeon (`A4-31202 == 0`) `3 + rand(10,39)/10`, else `partySize/2 + rand(10,69)/10`; surprise 2 halves it, surprise 3 doubles it; capped to the monster count and 10. Party front rank `A4-24141`: dungeon `(3 + rand(10,79)/10) >> 1`, else party size (and for 6+ members `rand(10,39)/20 + party - 2`); surprise 3 x2; surprise 2 `(party < 2 ? 2 : party) - 1`; capped to party size.
- **Slot init** CODE+0x11C82 (harness: 1,500): clears the four per-slot arrays, then `init_slot` for slots `0..min(count,10)` (a count above 10 initialises all 11).

### 10.2 Encounter prompt, surprise, hide, run, bribe (harness: 2,000 with 300+ bribe attempts)

CODE+0x12C6E: the prompt is `A-Attk  B-Bribe  H-Hide  R-Run` (in-game strings). The monster list is the leading non-zero entries of the slot table (id 0 terminates; a non-zero slot 10 adds the queued count); unless `A4-31083 >= 0x80` (scripted encounter, the bit is stripped) the list is topped up by 10.1. Messages "You surprised the monsters!" / "The monsters surprised you!".
- **Surprise roll** (only when `A4-31083 == 0`): `d = rand(1,100)`; `d <= 40 and d <= avgThief` -> **2 = the party surprises** (monster melee group halves); else unless the "no ambush" flag `A4-31142` is set and `d >= 90` -> **3 = the monsters surprise** (no prompt, the fight starts at once, melee group doubles). `avgThief` = CODE+0x4B60: party average of character byte `+0x1E` (16-bit sum / party size, capped 255) kept in `A4-24142`.
- **Hide (H)**: `d < avgThief` -> the encounter is avoided (`A4-30653 = 1`), else the party must Attack.
- **Run (R)**: always succeeds after surprise 2; otherwise `rand(1,100) < A4-22029` (a per-map byte, hyp: loaded with the map); success calls CODE+0x11646 (`retreat`: moves the party back, members with condition `>= 0x10` become dead 0x81 unless `A4-1315`), failure forces Attack.
- **Bribe (B)**: sub-key 1 Food / 2 Gold / 3 Gems, then a number prompt `v`. Food and Gems require `lowbyte(v) >= recordIndex of the first monster`; Gold uses `lowbyte(v) + highbyte(v)` (computed but not compared). Success needs the first monster's matching treasure flag (record `0x10` bits 5/6/7 -> `A4-4546 / -4545 / -4544`, 3.1), `d >= A4-22025` (map bribe threshold, hyp) and the payment routine (CODE+0x6C66 food with the low byte, 0x6ACE gold with `v`, 0x6B9A gems with `v`) accepting; the fight is avoided. Failure falls to Attack. The payment routines are stubs here: their own rules are **open** (`mm2-rules-treasure`).

### 10.3 Turn order and the round loop (harness: 2,000 with scripted action effects)

CODE+0x12A22 `fight()`. Setup: group sizes (10.1), slot init (10.1), the acting character `A4-1272 = rand(1, partySize) - 1`. **Each round**: clear all acted flags; for each monster `i < min(count,10)` with any status bit besides bit 0: `status = status & ((rand(1, recordIndex) & 0xFE) ^ 0xFE)` — a status bit survives a round only while the matching bit of a `rand(1, recordIndex)` roll is clear, so statuses wear off faster on higher-tier monsters, and bit 0 never survives. **Actor selection**: the unacted monster with the highest initiative `A4-1294[i]` (first wins ties, must be > 0) and the unacted party member with the highest `+0x6E` (first wins ties, must be > 0); the **party acts when its initiative is >= the best monster's** (ties go to the party), else the monster acts; when neither exists the round ends. After every action the battle-over test (CODE+0x13282: no monsters, empty party, `A4-1315` set, or no member with condition `<= 0x10`) runs; at the end of the round it runs again and a new round starts if it is clear. Order within a round is therefore deterministic from stats; the only randomness is the status decay. The real action routines (party CODE+0x119C2, monster CODE+0x1064C) are **stubs** in the vectors: a stub models only the acted flag (the monster action also sets `A4-1309`) plus one scripted effect (flag, kill, status, initiative edit); everything an action does beyond that is open (monster turn: see section 11, party commands: `mm2-rules-spell-effects`). After the loop: no monsters -> the XP/treasure end (CODE+0x12430, 4.7); else if `A4-24140` (a member ran) or `A4-1315` -> `retreat` (10.2).
- **A member runs** CODE+0x116B0 (harness: 2,000): `rand(1,100) < A4-22029` -> `A4-24140 = 1`, party size -1, the last member (slot and acted flag) moves into the runner's slot, `A4-24141` clamped, acting character reset.

## 11. Monster side: turn, targeting, special attacks, damage and death (pass 2)

Ports: `tools/mm2/rules3.ts`; vectors `mondeath, mondamage, questkill, resolve, tgtranged, tgtmelee, monturn, setcond, monspecial2`; tests in `rules2.test.ts` (same method as section 10: UI is stubbed, never the rules).

### 11.1 The monster's turn — CODE+0x1064C (harness: 2,000; the leaf actions are logged stubs)

`slot = A4-1271`; its acted flag is set, the record is unpacked, then:
1. `status & 0x30` (asleep 0x10 / held 0x20): the monster does nothing.
2. `status >= 0x80`: applies the lingering party effect `A4-1313` (tables `A4-28454` u16[] / `A4-28446` u8[]), no attack. (`partyEffect`, CODE+0x10894, open.)
3. `status & 0x40`: does nothing (message).
4. **Flee** (unless `A4-1314`): `fleeThr = u8[4]@A4-28442[record oabil bits 5-6 (A4-4534)]`; if `fleeThr < partyHalfLevel (A4-28610)` and `rand(1,100) <= 50` the monster **leaves the fight** (removed from the slot table, no XP/loot, 11.4).
5. Otherwise the **ability gate** (4.5: needs uses > 0, status bit 6 clear, `rand(1,100) <= pabil chance`; spends one use) decides: **gate fails** -> if `slot < A4-1316` (inside the melee group) a **melee attack** (target pick 11.2, roll 4.1); else if the record's sabil bit 6 (`A4-4526`) and `rand(1,100) <= 80` a **ranged attack** (target pick 11.2, roll 4.1 with `A4-24114 = 1`); else it **advances** (CODE+0x10118: may call reinforcements — once per battle (`A4-24139`) a monster of the same kind as slot 10 with the reinforcement bit (`A4-4513`) and `10 < count < 110` adds `count - 10` more). **Gate passes** -> the record's group verb `v = A4-4540` (0..31; names in the game's own table at `A4-28246`: sprays poison, sprays acid, casts a curse, breathes fire/lightning/cold/energy/gas/acid, explodes, gazes, drains magic, drains spell level, vaporizes valuables, juggles party, energy blast, sleep, lightning bolts, fireballs, fingers of death, disintegrate, super shock, dancing sword, incinerate, and invokes power, implosion, inferno, pain, silence, frenzies, paralyze): `v < 0x0F`, `0x1D` or `>= 0x1F` cast through the spell dispatcher (CODE+0x1FB4E, open); other `v` run CODE+0x1042C (`special`, open) when `status & 2`, else the spell dispatcher too.

### 11.2 Who a monster hits (harness: 2,000 each)

- **Melee target** CODE+0x103BA: rotates the acting-character pointer `A4-1272` through the front rank `A4-24141` (the number of exposed members, set by 10.1), growing the rank by one (cap party size) each time the walk has gone round it, until it lands on a member with neither the unconscious (0x40) nor dead (0x80) bit.
- **Ranged/spell target** CODE+0x10332: `rand(1, partySize) - 1`, then the next living member scanning forward. **Quirk (code bug, reproduced):** when the scan wraps past the last slot the dead/alive test still uses the *stale pointer* of the slot that was one past the end, so slot 0 can be returned while dead (and after a wrap the loop re-enters with `r = 0`). It also resets `A4-1272` to 0 whenever it is >= party size.

### 11.3 Special attack effects — CODE+0x0FD8C and CODE+0x1F27E (harness: 3,000 + 4,000)

After a melee hit (not ranged, not when `A4-1270`, target not dead): hit chance `tier + u8[16]@A4-28422[tier] >= d100` (`tier = recordIndex >> 4`, byte add); sabil bit 5 (`A4-4536`) gives the target a luck save (4.4) that cancels it; effect id `A4-4537` (record sabil low 5 bits) `>= 0x20` does nothing, `0x1F` becomes `rand(1,30)`. A target already unconscious or dead widens the front rank. The effect then goes through `set_condition` (also the target of spell effects on party members); **all 30 effects are harness-verified**:

| id | message | rule |
|---|---|---|
| 1 | lost gold | roster index < 24 only; save +0x1E; `+0x66` (u32) -= 0x10000 / 0x100 / 1 by magnitude |
| 2 | lost gems | save +0x1E; `+0x5C` -= 0x100 or 1 |
| 3 | is poisoned | save +0x1C; cond \|= 0x08 |
| 4 | is diseased | save +0x1C; cond \|= 0x04 |
| 5 | falls asleep | save +0x1B; cond \|= 0x10 |
| 6 | is cursed | save +0x16; cond \|= 0x01 |
| 7 | is silenced | save +0x16; cond \|= 0x02 |
| 8 | is paralyzed | save +0x1C; cond \|= 0x20 |
| 9 | collapses | save +0x1C; cond \|= 0x40 (unconscious) |
| 10 / 11 / 12 | dies / turns to stone / is eradicated | no save; cond = 0x81 / 0x82 / 0xFF |
| 13 | lost item | save +0x1E; first non-empty backpack slot cleared, the rest shift down (three 6-byte arrays at `+0x3A`, `+0x40`, `+0x46`) |
| 14 | lost backpack | save +0x1E; all 6 slots cleared |
| 15 / 16 | lost food / all food | save +0x1E; `+0x25` halved / zeroed |
| 17 / 18 | lost all gold / gems | as 1 / 2, zeroed |
| 19 | lost valuables | food, gems, gold (three separate saves) |
| 20 / 21 | is aged | `+0x21` += 1 / 5, cap 200, no save |
| 22 / 23 | lost statistics | working stats (`+0x6B..+0x71`, via table `A4-26232`) -= 2 / halved; an underflow kills |
| 24 | lost statistics | one random base stat `+0x10..+0x15` -= 1 (dies at 0) |
| 25 / 26 | lost level | working level `+0x71` -= 2 / half |
| 27 | lost experience | `+0x62` -= rand(1,80)+20 (floor 0) |
| 28 | items scrambled | save +0x1E; each backpack item id below 0xD0 is replaced by `rand(1,0xCF)` |
| 29 | lost spell points | save +0x1A; `+0x58` = 0 |
| 30 | is assassinated | save +0x1E; HP (`+0x5E`) = 0 and cond \|= 0x40 |

A save succeeds (the effect takes) when `d100 >= resist byte`, so a *high* byte protects; byte 0 always takes. The condition bit meanings (0x01 cursed, 0x02 silenced, 0x04 diseased, 0x08 poisoned, 0x10 asleep, 0x20 paralyzed, 0x40 unconscious, 0x80+ dead/stone/eradicated) come from the game's own message strings paired with the harness-verified masks; rest (5.5) clears 0x02/0x10/0x20/0x40 and keeps 0x01/0x04/0x08.

### 11.4 Applying damage to monsters and death (harness: 2,000 each)

- **Party hit applied** CODE+0x11040: immune (no damage) if the monster's record byte `0x19` field `A4-4528` is non-zero and `A4-4528 - 1 == attacker sex byte (+0x0C)` (field 1 = male attackers have no effect, 2 = female, 3 = none), or the mres bit 2 `A4-4516` is set; otherwise a non-zero total goes to damage.
- **Damage** CODE+0x10EAC: status byte wiped unless `> 0x80`, then bit 4 cleared and bit 0 set; `hp > damage` -> `hp -= damage`, else the monster **dies at damage >= hp** and `A4-3852` becomes 0xFFFF.
- **Death** CODE+0x10E5E: quest bookkeeping (CODE+0x10C66: a party member whose `+0x78` equals the victim's record index and whose `+0x7C` bit 0 is set gets `+0x7C` bit 1 set; hyp: quest target), kill reward (4.6), removal CODE+0x10CCE (count -1, melee group clamped, per-slot arrays shift down), and for slot 10 (the aggregate of queued monsters) the XP of all `count - 9` queued monsters is awarded at once and the count reset to 10.

> **Correction (2026-11-25):** section 3.1 / the record decode: the speed byte `0x14` high nibble + 1 (`A4-4538`) is the monster's **ability uses per battle** (copied to `A4-1283[slot]` at battle start, spent by the gate in 4.5), not an unidentified field.

> **Correction (2026-11-25):** the surprise odds in section 7 ("`rand(1,100) <= 0x28` and `<= A4-24142` -> surprise 2, `>= 0x5A` -> 3, hyp") are now harness-verified (10.2) with the missing pieces: `A4-24142` is the party average of character byte `+0x1E`, 2 means *the party* surprises, 3 means the monsters surprise (suppressed by `A4-31142`).

> **Correction (2026-11-25):** the "monster call-for-help/morale" gap: MM2 does have a morale check (11.1 step 4) and a once-per-battle reinforcement call (11.1 step 5).

## 12. Equipment, treasure, training, spell gates (pass 2)

### 12.1 Equipment (harness: equip 3,000 / unequip 3,000 / AC 3,000; items synthetic)

Character item layout (`+0x28..+0x4B`, three 6-byte arrays per group): **equipped** ids `+0x28`, `+0x2E` (second array), enchant/flags `+0x34` (`& 0x3F` = enchant); **backpack** ids `+0x3A`, `+0x40`, `+0x46`. The items.dat record table is `A4-16126` (256 x 20 B: `+0x0E` bonus byte = stat index (high nibble) and amount (low nibble), `+0x0F` use power, `+0x10` damage / armour value). **Item classes by id**: 1..0x5B melee weapons, 0x5C..0x72 ranged weapons, 0x73..0x9F armour.
- CODE+0xF36C `equip_item(ch, slot)`: melee weapon -> `+0x4C` = record `+0x10`, `+0x4D` = enchant; ranged -> `+0x4E` / `+0x4F`; armour -> the AC accumulator `+0x1F` gains enchant and record `+0x10` (saturating at 255); then the item's stat bonus (record `+0x0E`: stat `+0x10 + type` and its working copy `+0x6B + type` for type <= 5, by `enchant + amount`, saturating) and the AC recalculation. CODE+0xF270 `unequip_item` clears the weapon bytes, subtracts the armour (floor 0) and removes the stat bonus (CODE+0xF110).
- CODE+0x67E6 `recalc_ac`: for every member **AC (`+0x24`) = clamp(stat_bonus(`+0x13`, a negative counted as 0) + `+0x1F`, 0..255)**. A positive-is-good byte (4.1).

> **Correction (2026-11-25):** the overlap question in section 8 is resolved: `+0x4C..+0x4F` are the derived weapon bytes (rewritten at equip); the spell book is **6 bytes at `+0x51..+0x56`** (48 spells; section 5.3 writes `+0x51 + (n>>3)`, `n < 48`), so data-structure.md's "`$4C..$57` spellbook" was too wide. `+0x50` and `+0x57` are not traced.

### 12.2 Hall of Training

- **XP needed** CODE+0x20796 (harness: 3,000): for the next level `L = level + 1` (cap 255), Paladin/Archer/Sorcerer/Ninja use the second row of `u32[2][9]` at `A4-25998` (levels 2..10), the others the first; above level 10 the requirement grows by 0x2EE00 per level (11-13), 0x5DC00 (14-15), 0xBB800 per level for 16-20, 0x177000 for 21-30, 0x2EE000 for 31-50, 0x190000 for 51-75 and 0x5DC000 per level above 75 (the table is cumulative). Training is allowed when `+0x62 (XP) >= XP needed` (CODE+0x20988, **code**).
- **Cost** CODE+0x2073A (harness: 3,000): 0 for roster index >= 24 (hirelings), else `hallMul[hall A4-31218] * (level+1) * 50` gold; then `train` (5.4) charges it and grants the level.

### 12.3 Treasure (harness: loot item 3,000, treasure 3,000; items synthetic)

CODE+0x123B0: `d = rand(1,100)`: `< 11` -> 3 items, `< 46` -> 2, `< 91` -> 1, else none. Each item lowers the loot tier `A4-24105` (set by the kill reward, 4.6) by one while it is above 0, then CODE+0x12206 rolls it: tier capped at 2; `d100` picks the first row of the `u8[7]` thresholds at `A4-28118`; item id = row base `u8@A4-28108[k*4]` + `rand(1, u8@A4-28108[k*4 + tier + 1])`. Charges: items whose bonus byte is not 0xF0, with the kill tier index `A4-24104 >= 2`, roll `rand(1,7)` (replaced by `rand(1, tierIndex)` for 2..12, `rand(1,21)+11` for 13); a result `>= 5` gets flag bits (`d100 < 41` -> 0x80, `< 71` -> 0x40, else 0xC0). Use power: `u8@A4-28111[tier]` when the record's `+0x0F` is non-zero. Results land in `A4-16156[i]` (ids), `A4-16153[i]` (charges/flags), `A4-16150[i]` (use power), where the chest/treasure UI picks them up (**open**).

### 12.4 Spell gates (harness: 3,000)

- CODE+0x78A8: spells.dat byte0 bits 6-7 = 0 anywhere, 1 combat only (`A4-31154 == 2` is "in combat"; set by the round loop), 2 non-combat only, 3 never (messages 3 / 2).
- CODE+0x790E: byte1 >= 0x80 spells are allowed when `A4-31202 == 1` (hyp: overland), otherwise only when the map's 16x16 bit map at `A4-22010` (bit `x & 7` of byte `y*2 + (x > 7)`, party position `A4-31217`/`A4-31216`) is clear (message 4 otherwise). The flagged spells are the outdoor family (Eagle Eye, Fly, Walk on Water, the Transmutations, Nature's Gate, Sand Storm, Meteor Shower, Star Burst, Moon Ray), so `tools/mm2/spells.ts`'s "outdoor-only" label for byte1 bit 7 is right in spirit but the rule is a per-square map flag, not an absolute ban.

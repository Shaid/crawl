# Might & Magic II (Amiga) — Game Rules

Logic foundation for a browser remake's rules core, derived from the game's own 68000 code: the retail `mm2` executable (`data/mm2/amiga/data/mm2`, 181,524 B). No other port and no third-party reference code was used for any rule below; `docs/mm2/amiga/data-structure.md` (format work ported from Vairn/MM2) is used only for field *meanings*, and where the code disagrees with it this document says so (section 8). Written 2026-11-25; pass 2 (encounters, turn order, monster side, equipment, treasure, training, gates) and pass 3 (spells, item use, equip rules, clock) the same day.

**Method.** Single real routines run in a Unicorn 68000 core (`tools/mm2/rules_oracle/`, no OS/disk/chipset emulation; UI, text and key-wait callees are replaced by logging stubs) on synthetic state. Per call the harness records every byte the routine read before writing (the input footprint), every byte it wrote, the return value and each logged stub call. `tools/mm2/rules.ts` is a TypeScript port written from the disassembly; `tools/mm2/__tests__/rules.test.ts` runs it against a *strict* sparse memory seeded with only that footprint, so a port that reads state the game did not read, writes a different byte, draws the RNG in a different order or returns a different value fails. Every check has a **null control**: a deliberately wrong variant of the port must disagree with the vectors on at least one case.

**Address conventions.**
- `CODE+0xNNNN` = offset into the root CODE hunk (0x2593C bytes; = file offset − 0x28). The executable is an overlay file: root hunks CODE (153,916 B), DATA (8,604 B), BSS; the 15,544 B overlay hunk after `HUNK_OVERLAY` (file `0x28854`) holds the `spells.dat`/`items.dat` loader strings (SAS/C code calling the root hunk's libc through the A4 jump table) and is **not** loaded by the harness (13.9).
- `A4` = DATA base + 0x7FFE (SAS/C small data; set by `LEA SECSTRT_1+32766,A4` at CODE+0x24920). `-N(A4)` is a global. The window `A4-0x7FFE .. A4` is the DATA hunk followed *contiguously* by the zero-cleared BSS (CODE+0x248B0 clears 0x16D8 longs from `A4-24162`); everything the rules touch lives in it. Calls such as `JSR -31668(A4)` go through a jump table of `JMP abs.l` stubs at the start of DATA: target = `u32` at DATA + (0x7FFE + disp) + 2. `tools/mm2/rules_oracle/resolve_asm.py` annotates the IRA listing with the resolved targets (`=> F_22BC6`).
- Ints are 16 bit; C arguments are pushed right to left, the callee returns D0, the caller pops.
- Character records are 130 (0x82) bytes at `A4-10814`, **big-endian words in memory** (little-endian on disk; swapped on load). `charPtr(slot)` = CODE+0x477E = `A4-10814 + slots[slot]*130` with the party table `slots` = 8 × `u16` at `A4-31082` (`0xFFFF` empty), party size `u16` at `A4-31066`.

**Evidence grades.**
- **harness** — diffed against the game's real routine in Unicorn (vector counts below), with null controls.
- **code** — read from the disassembly at the stated address; not executed.
- **hyp** — inference; **open** — not derived (smallest next step in section 9).

Reproduce: `tools/mm2/rules_oracle/gen_vectors.sh` (needs a venv with `unicorn`; full vector sets go to the gitignored `tools/mm2/rules_oracle/generated/`, small committed subsets to `tools/mm2/rules_oracle/vectors/`); `npx vitest run tools/mm2/__tests__/rules.test.ts` uses the full sets when present and the committed subsets otherwise.

## MM2 rules status (build guide, updated 2026-11-25, pass 3)

What a remake rules core can take **as is**. Each unit is a real routine run in Unicorn and diffed against a TypeScript port with strict read/write-footprint parity and a null control; section numbers point to the rule text, vector counts are full sets (small subsets are committed in `tools/mm2/rules_oracle/vectors/`, 131,432 vectors over 3 passes).

| Area | Verified (harness) | Where |
|---|---|---|
| RNG, `rand(lo,hi)` | LCG, hi+1 overshoot | 2 |
| Monster record | unpack (all 256 retail + synthetic), ability uses, initiative | 3.1, 10 |
| Encounter | group sizes, reinforcement pick, budget, generation loop, **call for help** | 10.1, 13.5 |
| Encounter prompt | surprise roll, Hide, Run, Bribe (Food/Gold/Gems) odds | 10.2 |
| Turn order / round | actor selection, ties, status decay, battle-over test, a member running | 10.3 |
| Monster turn | flee/morale, ability gate, melee vs ranged vs advance vs spell decision, target picks | 11.1-11.2, 4.1, 4.5 |
| Monster hits party | hit roll, damage, saves, death, all 30 special/condition effects; monster spell **verb table** | 4.1, 4.3, 11.3, 13.5 |
| Party hits monster | attack roll, crits, immunity, damage, death, removal, queue XP, quest flag, kill reward, XP award | 4.2, 4.6, 4.7, 11.4 |
| **Party spells** | cast command, dispatch (96 spells -> 43 non-combat + 53 combat handlers), `partyEffect` engine (resist / immunity / save / damage / condition / kill), dice and group-size helpers, **51 combat and 25 non-combat handlers** (damage, conditions, buffs, heals, cures, party edits) | 13.1-13.4 |
| Characters | stat bonus/sync, luck save, spell level/SP, training HP, XP needed per level, training cost, rest, **world clock and ageing** | 5, 12.2, 13.7 |
| Equipment | equip/unequip, AC; **equip command (class mask, alignment, cursed flag, 0xF0), compatibility, item use (charges, free cast, stat boost)** | 12.1, 13.6 |
| Treasure | treasure count, item roll, charges, use power | 12.3 |
| Spell gates and data | SP cost, gem gate, SP gate, combat-class gate, location gate; spells.dat vs dispatch tables (retail data) | 6, 12.4, 13.8 |

**Open (not derived; smallest next step in 13.9 and `docs/mm2/TODO.md`):**
- `mm2-rules-spell-effects` (remainder, 20 spells marked OPEN in the 13.4 table, e.g. Detect Magic, Location, Teleport-class movers, Identify/Recharge/Enchant item pickers, Raise Dead, Turn Undead/Holy Word engine CODE+0xC028); the monster spell leaves `spray1` / `sprayAll` / `cond` / `cond2` (CODE+0x1F414 / 0x1F632 / 0x1F72E / 0x1F896) and `advance` CODE+0x10118; who charges the SP and gem cost after a cast; the `spells.dat` / `items.dat` overlay loader (**blocked**: SAS/C overlay needing libc stubs).
- `mm2-rules-equipment` (remainder): shop buy/sell prices (**not located**).
- `mm2-rules-world`: door bash CODE+0x9B48 (read: Might sum of the first two members + a `rand(10,109)/10` roll against the door strength `A4-22024`; **code**, not harnessed), unlock CODE+0x20D6E, traps, food outside rest, skills, per-map bytes `A4-22025` / `-22029` / `-22030..-22032` (hyp: map header). The party command menu CODE+0x119C2 is still a stub.
- `mm2-rules-chargen`: character creation (overlay code) — **not started**.
- Training eligibility (`xp >= needed`, CODE+0x20988) is **code-read only**: that routine is the whole Hall UI loop (not a pure function) — `xp_needed` and `training_cost` are harness-verified.
- Party-attack target prompt (target 0xFF) and ranged/melee mode selection are UI.

Corrections made in passes 2 and 3 are in sections 8, 11 and 13 (`> **Correction (date):**`).

## 1. Status summary

The status block at the top lists what is verified and what is open. Vector counts (full sets): pass 1 rng 4,008, monunpack 856 (256 retail + 600 synthetic records), bonus 256, luck 3,000, dmgchar 3,000, melee 3,000, pmelee 3,000, monspecial 2,000, killreward 2,000, partystrength 1,000, mspelldmg 2,000, sync 100, spelllevel 3,000, xpaward 1,500, train 3,000, rest 2,000, spellcost 3,006 = 36,726; pass 2 63,500 (sections 10-12: encgroup 3,000, moninit 1,500, battleover 1,500, encpick 3,000, encbudget 2,000, encgen 1,500, charflee 2,000, round 2,000, driver 2,000, mondeath / mondamage / questkill / resolve / tgtranged / tgtmelee / monturn 2,000 each, setcond 4,000, monspecial2 3,000, spellgate 3,000, equip / unequip / ac / lootitem / treasure / xpneed / traincost 3,000 each); pass 3 31,206 (section 13). Total 131,432.

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
6. The routine then calls CODE+0xFF42 (UI text + damage application; reported by the port as `applyHit [dmg, hits]`). That routine also draws `rand(1,8)` to pick the attack verb string. (Superseded detail: the damage application is 4.3 and the special attack / condition path is 11.3; they were verified in passes 1-2.)

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

The remaining gates the cast command checks (CODE+0x78A8 combat class, CODE+0x790E map-flag gate) are harness-verified in 12.4; the cast command itself, the spell dispatch and the effects are section 13.

## 7. What a rules core can take from this

Combat round skeleton (all of it harness-verified): encounter generation and the prompt (10.1-10.2) -> turn order and round loop (10.3) -> per actor either the monster turn (11.1: flee, ability gate, melee 4.1 / ranged / advance / spell 13.5) with `damage_char` (4.3) and the 30 special effects (11.3), or the party action: attack (4.2), cast (13.1-13.4) or use an item (13.6) -> damage to monsters, death, removal and the kill reward (11.4, 4.6) -> end of battle XP (4.7) and treasure (12.3). Out of combat: rest (5.5), training (5.4, 12.2), spell level (5.3), the clock (13.7), equipment (12.1, 13.6). Not yet derived: the party command menu CODE+0x119C2 (stubbed), shops, doors/traps/food/skills, character creation, and the open spell handlers (status block).

## 8. Corrections to earlier claims

> **Correction (2026-11-25):** `docs/mm2/amiga/data-structure.md` section 5 / `tools/mm2/roster.ts` label the HP fields `+$5E` "HP max", `+$60` "HP temp", `+$74` "HP current" and `+$58` "SP max", `+$5A` "SP cur". The game's code uses them the other way round: damage subtracts from `+0x5E` (4.3), rest copies `+0x74` into `+0x5E` (5.5), training adds to all three (5.4) and `+0x60` is the base maximum that rest copies into `+0x74`; the SP gate spends `+0x58` and rest sets `+0x58 = +0x5A`. Correct reading: **`+0x5E` HP current, `+0x60` base max HP, `+0x74` effective max HP (halved by condition bit 3); `+0x58` SP current, `+0x5A` SP max.** Fresh starters have them equal so the roster fixture cannot tell them apart. `roster.ts` field names are left as the format codec's (on-disk) names; its docs should be read through this correction.

> **Correction (2026-11-25):** `+0x62` is experience (XP award 4.7 adds the share there) and `+0x66` is gold (training reads and charges it); the previously parenthesised "XP / gold" order is right. The routine at CODE+0x1456E (x3 move of `+0x66` into `+0x62`) was not traced here; it is *not* an XP split.

> **Correction (2026-11-25):** the monster record's `0x14` low nibble is not "untraced": `+1` it is the number of attacks per round the melee roll loops over (3.1, 4.1). `0x14`'s high nibble +1 is stored in `A4-4538` (consumer still unidentified).

> **Correction (2026-11-25):** `tools/mm2/monsters.ts` `decodeMonsterStat` (AC/damage/initiative) caps every value at 250; the game truncates AC x10 to a byte and caps damage/initiative at 250 only when the base value is > 25 (3.1). Identical on all retail records.

> **Correction (2026-11-25):** the roster/in-memory record carries working copies at `+0x6B..+0x73` that combat reads (stat sync 5.2), and the weapon bytes the attack roll uses are `+0x4C..+0x4F` — inside the range data-structure.md labels "spellbook bitmask `$4C..$57`". The spell book written by 5.3 lands at `+0x51..`, so those four weapon bytes overlap the first bytes of that range as documented; one of the two readings is wrong (hyp: the weapon bytes are derived equipment values, recomputed when equipment changes; the spell book then starts at `+0x51` rather than `+0x4C`). **Resolved in pass 2 (12.1): confirmed (harness).**

> **Correction (2026-11-25, pass 3):** the pass-1/2 pointer "party cast handlers ~CODE+0x1AB0C / 0x1AC94" was wrong: CODE+0x1AB0C is the "pack is full / you found ..." routine that files rolled treasure into the backpack (12.3), not a spell handler. The cast handlers are CODE+0xA812..0xC9B6 (13.4), reached through the dispatchers CODE+0xCD90 / 0xCFD0. Likewise `special` CODE+0x1042C is a monster special-attack message leaf and `advance` CODE+0x10118 is the monster's step forward, neither is a spell routine.

> **Correction (2026-11-25, pass 3):** `tools/mm2/spells.ts` decoded `spells.dat` byte0 as "bit 0x10 special cost, low nibble gems" and byte1 bits 6-4 as the SP multiplier. The game uses `byte0 & 0x3F` gems (above 50 = 100; retail has 20, 50 and 63 = 100) and byte1 bits 5-4 as the multiplier with bit 6 choosing the monster-scaled base; `spells.ts` is fixed and its item "use power" boost table gained alignment (selector 4) and SP (7). The boost amount is also the slot's enchant byte plus the nibble (13.6).

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

## 13. Spells, item use, equip rules and the clock (pass 3)

Ports: `tools/mm2/rules4.ts`; vectors `tools/mm2/rules_oracle/rules4.py` (units below, full sets in the gitignored `generated/`, ~230 KB of subsets committed in `vectors/`); tests `tools/mm2/__tests__/rules4.test.ts` (28, each unit with a null control). Method as before: the real routine under Unicorn, UI/key leaves stubbed (quiet or logged with scripted answers stored in the vector), strict read/write footprint. Everything the handlers do to monsters goes through the **real** `partyEffect` / `unpack_monster` / RNG; only `damage_monster` (CODE+0x10EAC) and `monster_dies` (0x10E5E, both verified in 11.4) are logged stubs here, with the kill outcome scripted.

Vector counts (full sets): castdisp 206, anywhere 2,000, dicedmg 2,000, maxtargets 2,000, castroute 2,000, partyeffect 2,000, cbspell 3,000, ncspell 3,000, monspell 2,000, itemuse 2,000, canequip 2,000, equipcmd 3,000, clock 3,000, callhelp 3,000 = **31,206**; with passes 1-2: 131,432.

### 13.1 Dispatch (harness)

A spell is a number 0..95: Sorcerer 0..47, Cleric 48..95 in `spells.ts` order (verified: the handler of every spell does what its name says, table below). Two 16-bit-relative jump tables select the handler:

- **Combat dispatcher** CODE+0xCFD0: spells 2..93 through the table at CODE+0xD186 (92 words; the index is `spell - 2`, anything else does nothing).
- **Non-combat dispatcher** CODE+0xCD90: spells 0..95 through the table at CODE+0xCEF6 (96 words; the default target CODE+0xCFCC does nothing).

Each spell has a handler in **exactly one** table (43 non-combat + 53 combat = 96; harness: 206 vectors incl. out-of-range numbers). The assignment is the spells.dat class (byte0 bits 7-6, 12.4): class 1 ("combat only", 53 spells) is in the combat table; class 2 (31, "outside combat only") and class 0 (12, "anywhere") are in the non-combat table. Class-0 spells stay on the non-combat handlers even in a fight: CODE+0x13708 (harness 2,000) returns 1 when the spell is one of the 12 words at `A4-28040`, and the cast command picks the dispatcher with it. With the retail `spells.dat` the test asserts the partition (class counts 12 / 53 / 31 / 0).

**Cast command** CODE+0x13AE2 `cast(ch, spellByte)` (harness 2,000): `spell = (spellByte & 0x7F) - 1` (so an item's use power 0x81 = spell 0); the combat gate and location gate of 12.4 run (messages 3/2/4); then `A4-18380 = ch` (the caster every handler reads), `A4-16140 = 1`, `A4-31209 = 1`, `A4-1342 = 0`, `A4-1339 = 0`; the dispatcher runs; then `A4-16140 = A4-31064` and `A4-31209 = 0`. **`A4-31064` = 1 means "the spell happened"**: every handler sets it on success, the pickers clear it first. `A4-16140 != 0` makes every confirm prompt auto-accept (`A4-16138` / `A4-16136` hold the pending SP and gem cost from the gates of section 6; the non-combat member picker zeroes both on cancel, so cancelling is free (**code**); the code that finally charges them was not traced).

### 13.2 Effect engine `partyEffect(count, firstGroup, element)` — CODE+0x10894 (harness 2,000)

The state it reads is in globals the handler filled: mode `A4-1339` (0 damage, 1 condition, 2 = a monster's lingering effect, treated as 0), damage `u16 A4-1342`, condition `u8 A4-1340`, extend flag `A4-1312`. For up to `count` monster slots from `firstGroup` (count capped by the monster count `A4-30654`; stops at slot 10, 11 with `A4-1312`, or at the monster count):

1. unpack the slot's record (3.1).
2. If `A4-1307 == 0` (set by the sacrifice spell 76 so its blow cannot be resisted): **magic resistance** — if the record's mres tier `A4-4527` is non-zero, `d = rand(casterLevel, 90)`, resisted when `d < tier`; then **element immunity** — `element != 0` and `A4-4522[element-1]` set (fire/electric/cold/acid are the flags unpacked from the damage and initiative bytes, element 5 and 6 from the mres bits 1 and 0, 7 = mres bit 2; names hyp from the spells that use them) resists; then a **save** — `rand(1,191) <= slotType[slot]` (the record index of the monster in that slot!, so later monsters save more often): damage is **halved** (unsigned), a condition below 9 **resists**, a condition of 9 or more is turned into 50 damage.
3. Not resisted and damage 0: nothing happens. Damage: `damage_monster` with the damage; a killing blow (A4-3852 = 0xFFFF) re-visits the same slot (the queue shifted). Condition: `cond - 1` below 7 ORs the status bit `A4-28462[cond-1]` into the slot's status byte (`A4-1305`, bit meanings as in 4.1/11.1); 7 or more kills the monster outright (`monster_dies` with `A4-1310 = 1`).
4. Damage and mode are restored from the entry values after every monster.

### 13.3 Shared helpers (harness)

- **dice(sides, bonus)** CODE+0x1338E (2,000): `A4-1342 = sum over the caster's level (+0x71) of (rand(1,sides) if sides != 0) + bonus` — "5d(1..5)+level" style, e.g. Energy Blast = L x (rand(1,5) + 1); `dice(0, n)` is a flat `n x level` (Cold Beam 6/L, Super Shock 20/L).
- **group count** CODE+0x1333A (2,000): caster level + 4 below level 7; else 10, plus one when the level is at least the monster count (capped at 10).
- **pickers** (real code, key input scripted; harness inside the handler vectors): CODE+0xD43C monster group (a single group is confirmed, otherwise a letter A..: an invalid key asks again; ESC = 0x1B), CODE+0xD390 "everything" confirm, CODE+0xD2EA party member (combat); CODE+0xCC18 member and CODE+0xCCE8 confirm (non-combat). Every picker clears `A4-31064`, sets it on a pick, and turns the pick into a cancel when the square's antimagic flag (`A4-21974` bit 1) is set. Group-area spells 18, 22, 26, 33, 62, 68 additionally refuse a target index below the melee group size `A4-1316`.

### 13.4 Handler table

Element ids are the `partyEffect` element (1 fire, 2 electric, 3 cold, 4 acid, 5 sleep-type, 6 mind-type; names hyp), "cond n" a condition for the mode-1 path, "all" = 10 groups. **harness** unless marked OPEN; the 20 OPEN rows are handlers with big UI flows or helpers not yet harnessed (smallest next step in 13.9).

| # | Spell | Class | Handler | Effect (grade harness unless OPEN) |
|---|---|---|---|---|
| 0 | Awaken | anywhere | 0x0C740 | Awaken: clear 0x90 bits of every living member |
| 1 | Detect Magic | outside | 0x0A812 | OPEN |
| 2 | Energy Blast | combat | 0x0B644 | dice(5,1) x L, 1 group, e0 |
| 3 | Flame Arrow | combat | 0x0B684 | rand(1,5)+3, 1 monster, e1 |
| 4 | Light | outside | 0x0A8CA | Light counter A4-31147 +1 |
| 5 | Location | outside | 0x0A8FA | OPEN |
| 6 | Sleep | combat | 0x0B6CC | cond 4 (sleep), maxTargets groups, e5 |
| 7 | Eagle Eye | outside | 0x0A91C | Eagle Eye counter A4-31136 += 5/L (cap 250/255) |
| 8 | Electric Arrow | combat | 0x0B718 | rand(1,9)+7, 1, e2 |
| 9 | Identify Monster | combat | 0x0B760 | show monster record (key wait) |
| 10 | Jump | outside | 0x0A974 | OPEN |
| 11 | Levitate | outside | 0x0AAAE | Levitate counter A4-31144 +1 |
| 12 | Lloyd's Beacon | outside | 0x0AADC | OPEN |
| 13 | Protection from Magic | anywhere | 0x0C7A2 | A4-31146 = level + 10 |
| 14 | Acid Stream | combat | 0x0B982 | dice(5,3), 1, e4 |
| 15 | Fly | outside | 0x0ABCC | OPEN |
| 16 | Invisibility | combat | 0x0B9C4 | party flag A4-31132 +1 |
| 17 | Lightning Bolt | combat | 0x0B9EE | dice(5,1), 4 groups, e2 |
| 18 | Web | combat | 0x0BA30 | cond 5, maxTargets, e6; target >= melee group |
| 19 | Wizard Eye | outside | 0x0AD22 | Wizard Eye counter A4-31135 (as Eagle Eye) |
| 20 | Cold Beam | combat | 0x0BA8C | dice(0,6) = 6/L, 1, e3 |
| 21 | Feeble Mind | combat | 0x0BACC | cond 6, 5 groups, e0 |
| 22 | Fire Ball | combat | 0x0BB0A | dice(5,1), 6 groups, e1; target >= melee group |
| 23 | Guard Dog | outside | 0x0AD7A | Guard Dog counter A4-31142 +1 |
| 24 | Shield | combat | 0x0BB5C | party flag A4-31131 +1 |
| 25 | Time Distortion | combat | 0x0BB86 | party flag A4-1315 +1 (refused when A4-22016 bit 3) |
| 26 | Disrupt | combat | 0x0BBB2 | 100 dmg, 1, e0; target >= melee group |
| 27 | Fingers of Death | combat | 0x0BBFA | cond 8, 3 groups, e6 |
| 28 | Sand Storm | combat | 0x0BC3A | dice(7,1), 10 groups, e0 |
| 29 | Shelter | outside | 0x0ADA8 | Shelter counter A4-31084 +1 |
| 30 | Teleport | outside | 0x0ADD6 | OPEN |
| 31 | Disintegration | combat | 0x0BC7A | cond 9, 3 groups, e0 |
| 32 | Entrapment | combat | 0x0BCB8 | party flag A4-1314 +1 (refused when A4-22016 bit 0) |
| 33 | Fantastic Freeze | combat | 0x0BCE4 | dice(0,10) = 10/L, 3, e3; target >= melee group |
| 34 | Recharge Item | outside | 0x0AEAC | OPEN |
| 35 | Super Shock | combat | 0x0BD34 | dice(0,20) = 20/L, 1, e2 |
| 36 | Dancing Sword | combat | 0x0BD74 | dice(11,1), all, e0 |
| 37 | Duplication | outside | 0x0AF02 | OPEN |
| 38 | Etherealize | outside | 0x0AFFA | OPEN |
| 39 | Prismatic Light | combat | 0x0BDA6 | cond rand(1,9) (7 also sets A4-1313 = rand(1,4)), all, e0 |
| 40 | Incinerate | combat | 0x0BE02 | dice(21,19), 1, e1 |
| 41 | Mega Volts | combat | 0x0BE44 | dice(9,7), all, e2 |
| 42 | Meteor Shower | combat | 0x0BE78 | rand(1,21)+24, all (extends past 10), e0 |
| 43 | Power Shield | combat | 0x0BEBA | party flag A4-31130 +1 |
| 44 | Implosion | combat | 0x0BEE4 | 1000 dmg, 1, e0 |
| 45 | Inferno | combat | 0x0BF1C | dice(16,4), all, e1 |
| 46 | Star Burst | combat | 0x0BF50 | rand(1,161)+39, all (extends past 10), e0 |
| 47 | Enchant Item | outside | 0x0B050 | OPEN |
| 48 | Apparition | combat | 0x0BF92 | cond 3, all, e6 |
| 49 | Awaken | anywhere | 0x0C740 | Awaken (same handler) |
| 50 | Bless | combat | 0x0BFC4 | party flag A4-31133 +1 |
| 51 | First Aid | anywhere | 0x0C7D0 | heal 8 (member prompt) |
| 52 | Light | outside | 0x0A8CA | Light (same handler) |
| 53 | Power Cure | anywhere | 0x0C7E2 | heal sum of rand(1,10) over level |
| 54 | Turn Undead | combat | 0x0BFEE | OPEN (Turn Undead engine CODE+0xC028) |
| 55 | Cure Wounds | anywhere | 0x0C822 | heal 15 |
| 56 | Heroism | combat | 0x0C12A | +6 level on one member |
| 57 | Nature's Gate | outside | 0x0B0EA | OPEN |
| 58 | Pain | combat | 0x0C162 | rand(1,12)+3, 1, e0 |
| 59 | Protection From Elements | anywhere | 0x0C834 | A4-31145 = level + 20 |
| 60 | Silence | combat | 0x0C1A8 | cond 1, maxTargets, e6 |
| 61 | Weaken | combat | 0x0C1F4 | cond 2, all, e0 |
| 62 | Cold Ray | combat | 0x0C224 | 25 dmg, 5, e3; target >= melee group |
| 63 | Create Food | outside | 0x0B1BE | caster +0x25 += 8 below 0x28 |
| 64 | Cure Poison | anywhere | 0x0C862 | cure bit 0x08 |
| 65 | Immobilize | combat | 0x0C26E | cond 5, 5, e6 |
| 66 | Lasting Light | outside | 0x0B1F2 | Lasting Light: A4-31147 += 20 (255 cap) |
| 67 | Walk on Water | outside | 0x0B22C | flag A4-31143 = 1 |
| 68 | Acid Spray | combat | 0x0C2AE | rand(1,49)+11, 3, e4; target >= melee group |
| 69 | Air Transmutation | outside | 0x0B250 | flag A4-31139 = 1 |
| 70 | Cure Disease | anywhere | 0x0C8BC | cure bit 0x04 |
| 71 | Restore Alignment | outside | 0x0B26A | OPEN |
| 72 | Surface | outside | 0x0B2B2 | OPEN |
| 73 | Holy Bonus | combat | 0x0C308 | party flag A4-31129 += level/2 |
| 74 | Air Encasement | combat | 0x0C332 | cond 7 effect 1 (lingering), 1, e0 |
| 75 | Deadly Swarm | combat | 0x0C376 | rand(1,33)+7, all, e0 |
| 76 | Frenzy | combat | 0x0C3AE | sacrifice one member (HP 0, cond 0x40, +0x73 -1) -> 2 x (+0x4C + +0x4D + 10) to all; once per fight (A4-1308) |
| 77 | Paralyze | combat | 0x0C462 | cond 5, all, e6 |
| 78 | Remove Condition | anywhere | 0x0C916 | clear condition |
| 79 | Earth Transmutation | outside | 0x0B318 | flag A4-31137 = 1 |
| 80 | Rejuvenate | outside | 0x0B332 | OPEN |
| 81 | Stone to Flesh | anywhere | 0x0C96E | Stone to Flesh (cond 0x82 -> 0) |
| 82 | Water Encasement | combat | 0x0C494 | cond 7 effect 2, 1, e3 |
| 83 | Water Transmutation | outside | 0x0B3B2 | flag A4-31140 = 1 |
| 84 | Earth Encasement | combat | 0x0C4DA | cond 7 effect 3, 1, e4 |
| 85 | Fiery Flail | combat | 0x0C520 | rand(255,400), 1, e1 |
| 86 | Moon Ray | combat | 0x0C566 | rand(1,91)+9 to all monsters and heals each living member the same way |
| 87 | Raise Dead | anywhere | 0x0C9B6 | OPEN |
| 88 | Fire Encasement | combat | 0x0C620 | cond 7 effect 4, 1, e1 |
| 89 | Fire Transmutation | outside | 0x0B3CC | flag A4-31138 = 1 |
| 90 | Mass Distortion | combat | 0x0C666 | half of the target group HP, 2 groups, e0 |
| 91 | Town Portal | outside | 0x0B3E6 | OPEN |
| 92 | Divine Intervention | combat | 0x0C6AE | once per fight (A4-1306): caster ages 5 years, everyone cond 0 (0xFF kept) and full HP |
| 93 | Holy Word | combat | 0x0C72A | OPEN (CODE+0xC028 with A4-1312 = 1) |
| 94 | Resurrection | outside | 0x0B492 | OPEN |
| 95 | Uncurse Item | outside | 0x0B524 | OPEN |

### 13.5 Monster spells — CODE+0x1FB4E `monster_spell(verb)` (harness 2,000)

The verb is the monster's pabil/sabil spell number. It copies three per-verb bytes (`A4-26218/-26186/-26154`, the last minus 0x11) to the message state `A4-22064..-22062`. Verbs 0-1, 3-8, 0x18 and 0x1F are **breaths**: damage = the monster's current HP (`A4-1338[slot]`), halved when its record index is below 0xB3, minimum 1, to one member (`spray1`). The other verbs are a table over 2..30: 2 counts up `A4-31141` (max 255); 9, 11-14, 29 call unexamined effect leaves; 10 / 16 / 28 / 30 apply condition 0x82 / 0x10 / 0x02 / 0x20 to the party (`cond`); 19 / 20 apply 0x81 / 0xFF (`cond2`); 15, 21, 23, 27 (and 25 = 1000) are damage to **every** member (`sprayAll`: 15 = 6, 21 = 0x28, 23 = 0x32 dice with `monsterSpellDamage`, 27 = rand(1,15)+1); 17, 18, 22 (0xC), 26 (0x14) are damage to one member. The leaves `spray1` (CODE+0x1F414), `sprayAll` (0x1F632), `cond` (0x1F72E), `cond2` (0x1F896) and the others are logged stubs here: **their bodies are open** (they apply `damage_char` / the 30 special effects to chosen members, built from verified pieces).

**Reinforcements** CODE+0x10082 (harness 3,000): once per battle (`A4-24139` clear), a monster whose record has the call-for-help bit (`A4-4513`, oabil bit 7) in a battle with 11..0x6D monsters including queued ones, whose slot's record index equals `A4-4564`, adds `count - 10` to the count (the queued group joins) and sets the flag; one `rand(1,100)` is always burned. CODE+0x10118 (`advance`, stubbed in `monturn`): the acting monster moves forward through the formation, swapping the per-slot arrays (hp, status, initiative, uses...) with the slots ahead; read (**code**) but **not harnessed** (open).

### 13.6 Item use and equip rules (harness)

- **Use** CODE+0x137E0 (backpack: ids `+0x3A`, charges `+0x40`, flags `+0x46`) and CODE+0x13896 (equipped: `+0x28`, `+0x2E`, `+0x34`) (2,000): no charges: message 0x10. Otherwise one charge is spent; at zero the item vanishes (id 0xFF, flag 0). An **equipped** item's last charge only destroys it (quirk, no effect). Then the record's use power (items.dat `+0x0F`): `>= 0x80` casts spell `(power & 0x7F) - 1` through 13.1 (no message); below 0x80 is a stat boost: byte selected by bits 4-6 of the power = `+0x75, +0x6B, +0x6E, +0x6F, +0x6A, +0x71, +0x72, +0x58` (max-HP low byte, Might working copy, speed, accuracy, alignment, level, spell level, current SP) gains (the slot's enchant byte + the low nibble), saturating at 255; then message 0x11 and `A4-16140 = 1`.
- **Equip command** CODE+0xED9C (3,000): asks for a backpack letter A-F (ESC cancels, an empty slot asks again), takes the first free equipped slot (none: message 2). **Cursed**: a backpack flag byte of 0xFF sets condition bit 0 on the member (message 3). Otherwise errors, later overriding earlier: forbidden-class mask (record `+0x0D` AND `u8[8]@A4-28626` indexed by class `+0x0F` = `{0x80,0x40,0x20,0x10,0x08,0x04,0x02,0x01}` = Knight .. Barbarian, matching `items.ts`) -> message 4; alignment tag (flag byte bits 7-6, 0 = none) mapped by `u8[4]@A4-28630 = {0,2,0,1}` must equal the member's alignment `+0x6A` -> message 5; record bonus byte 0xF0 -> message 14. Then `canEquip`, the three bytes move, `equip_item` (12.1), the backpack closes up, AC is recomputed.
- **Compatibility** CODE+0xEC02 (2,000): classes by item id A 1..0x41, B 0x42..0x5B (both melee), R 0x5C..0x72, C 0x73..0x7E, D 0x7F..0x9A, E 0x9B..0x9F. One melee weapon (A or B, message 6); a B weapon excludes any C item (12) and a C item a B weapon (13); one R (7), one C (8), one D (9), one E (10). B = two-handed and C = shield (hyp, from the exclusion).

### 13.7 The world clock — CODE+0x69DC `advance_time(ticks)` (harness 3,000)

`ticks == 1` on a dark square (`A4-21974` bit 5) with a lit torch spends one unit of the light counter `A4-31147`. The sub-day counter `A4-31156` gains the ticks; at 256 it keeps its low byte and a **day** passes: the calendar word `A4-31198[A4-31158]` +1, every member ages (`+0x22` day byte +1; at 181 the age `+0x21` +1 and the day byte restarts at 1, a year = 180 days), the day counters 60 / 120 / 180 clear the per-period flags `A4-31116`, `A4-31117` (hyp: food/rest used), and day 181 wraps to 1 with the year word `A4-31178[...]` +1 (max 999) and `A4-31126` cleared. (The 68k divides a register whose upper half is leftover from the previous call; the vectors run with it 0 — the low byte is kept.)

### 13.8 Spell data (retail `spells.dat`, code-verified)

`spells.ts` was corrected against the executable: **gems = `byte0 & 0x3F`, above 50 = 100** (retail values 0..10, 20 for Star Burst and Divine Intervention, 50 for Enchant Item and Uncurse Item, 63 = 100 for Duplication; the old "bit 0x10 special, low nibble" read mis-decoded those five), the SP multiplier is bits 5-4 only (bit 6 selects the monster-scaled base 10 instead of 8), and the item use selectors 4 (alignment) and 7 (SP) were missing. The spell order of `spells.ts` is confirmed by the behaviour of all 96 handlers.

### 13.9 Open after pass 3 (TODO ids)

- `mm2-rules-spell-effects` (remainder): the 20 OPEN rows of 13.4 — non-combat 1 (Detect Magic), 5 (Location), 10, 12, 15, 30, 34, 37, 38, 47, 57, 71, 72, 80, 87, 91, 94, 95 and combat 54 (Turn Undead), 93 (Holy Word) with the CODE+0xC028 engine; the monster leaves of 13.5; `advance` CODE+0x10118; the spell cost charge after the handler (the code that reads `A4-16138` / `A4-16136`). Smallest next step: copy `gen_ncspell` for 71 / 72 / 38 (pickers already real) and add stubs for CODE+0x5692 and the item picker CODE+0xB56E.
- Overlay loader (`spells.dat` / `items.dat` read in the overlay hunk): **blocked** — the overlay is SAS/C code that calls the root hunk's libc through the A4 jump table (open/read/close/AllocMem); a harness needs those stubs and the overlay entry points. The tables were checked instead against the real files (spells.dat class bits vs the dispatchers, class/alignment tables vs `items.ts`).
- `mm2-rules-equipment` (remainder): shop buy/sell prices were **not** located in this pass.

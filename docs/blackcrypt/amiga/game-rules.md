# Black Crypt (Amiga) — Game Rules

Logic foundation for the browser remake. Derived from the game's own code (decompressed `bcdft` S_1 code / S_2 data, and `bcdfp`); the DOS port was not needed. Offsets: **S_1 +0xNNNN** = offset in `bcdft_decompressed.bin` (also the Ghidra function address); **A4 = S_2 + 0x7FFE**; an absolute `jsr 0xXXXXX.l` targets S_1 offset `XXXXX - 0x80058`. `bcdfp +0xNNNN` = CODE-hunk offset.

Evidence grades: **harness** = diffed against the game's real 68k routine run in a musashi core (`tools/blackcrypt/rules_oracle/`, vectors in `vectors.json`, TS in `tools/blackcrypt/rules.ts`, test `rules.test.ts`, with a null control); **code** = read from disassembly/decompile (address given), not executed; **hyp** = inference; **open** = not derived (smallest next step given).

Companion data: `game-rules-spells.json` (60-spell table, machine readable), `game-rules-world.json` (field maps, vitals constants, item-effect tables). Exported by `buildAssets`: `public/assets/blackcrypt/amiga/data/rules-tables.json` (see §6).

## 2026-11-23 status summary (pass 2 in §8-§9, pass 3 in §10, pass 4 in §11; the first table is the pass-2 state, kept for history; the **pass-4 table below it is current**)

| Area | Done | Open |
|---|---|---|
| 1 Character state | record field map (§1.1), new-game init, class templates, level-up + XP thresholds (harness), stat tables; **stat names STR/INT/WIS/DEX/CON and record slots, creation caps (stat <= 20, pool 25), class numbering and item class mask bits (§8.9)** | none blocking |
| 2 Combat | player melee (harness), weapon table + monster immunities (harness); **monster melee, target selection, XP award, disease/poison attacks, tick vitals (all harness, §8)**; **behaviour VM decoded: layout, 26 opcodes, all 12 scripts, pointer-table relocation fix (§8.3, harness)**; AC semantics (§8.8) | monster pathfinder `+0x866C` and stacking, ranged branch formulas as harness, possession / stone, wall-clock tick length (h) |
| 3 Spells | model, all 60 spells, memorising / recharge, monster casts (appendix A) | A.6 items 3-6: ray range/path, event 0x25 users |
| 4 World | vitals, resting, traps, locks, no random encounters, no shops, weight / AC / light (appendix B); **vitals cadences corrected (§8.6)** | counter `+0x89`, item effects 0x8D-0x90 names, party-click whitelist |
| 5 Remake spec | §9: clock, characters, player and monster attacks, damage, death, XP, vitals, spells, loot, with grades | §9.9 |

## 1. Character state

### 1.1 Record (0xA8 = 168 bytes, 4 chars at A4+0x1758, slot = class index)
The WHDLoad-trainer layout in `data-structure.md` is partly wrong (+0x52 is not XP, +0x56 is not gold; Black Crypt has no gold). Fields below are from code (grades per row).

| Off | Size | Meaning | Evidence |
|---|---|---|---|
| +0x00 | w | class index 0..3 = slot (new-game init writes the slot number, bcdfp +0x22A..+0x4A2); order Fighter, Cleric, Magic User, Druid as in the chargen templates | code |
| +0x02 | str | name (printed by level-up at rec+2) | code S_1 +0x17D2A |
| +0x16..+0x39 | 3x6 w | pack item unique ids (3 rows of 6) | code, bcdfp init clears |
| +0x1A/+0x1C | w | the two hand slots (item ids; init assigns 5*i+5 / ...) | code |
| +0x3A..+0x43 | 5 w | worn-equipment item ids | code |
| +0x45..+0x48 | b | class-dependent bytes: +0x46 = 0 (Fighter), 0 (Cleric), 5 (MU), 10 (Druid) copied to +0x47, +0x48 = 1; meaning open (spell related?) | code bcdfp +0x238..+0x2E0, hyp on meaning |
| +0x49..+0x4D | 5 b | memorised spell ids (0xFF empty) | code (appendix A) |
| +0x4E / +0x50 | w | HP / max HP (new game 20/20) | code+harness |
| +0x52 / +0x54 / +0x56 | w | food / water / energy (new game 5000 / 5000 / 10000) | code bcdfp +0x40C..+0x440 |
| +0x58,+0x5A | w | last damage dealt per hand (display) | code S_1 +0x1451E |
| +0x5C | w | last damage taken (display) | code +0x17686 |
| +0x5E | b | level (new game 1) | code+harness |
| +0x5F,+0x60,+0x61 | b | attack cooldown flag / hit counter / last attacker | code (hyp on names) |
| +0x62 / +0x63 | b | armour value current/base; base = table(stat +0x68) + 6, +2 added at init | code (appendix B); table is bcdfp data +0x3DC (same shape as T1) |
| +0x64..+0x68 | 5 b | current stats. Template words (0,1,2,3,4) are stored to slots +0x64, +0x66, +0x65, +0x68, +0x67 (bcdfp +0x4D4..+0x614) | code |
| +0x69 | b | resistance/defence percentage compared with rand8(100) by monster melee and monster bolts | code S_1 +0x9D28 |
| +0x6A,+0x6B,+0x6C | b | +0x6A: caster-level bonus; +0x6B: memorise-time bonus; +0x6C: to-hit bonus (each point shifts the melee threshold by 2) | code |
| +0x6E..+0x72 | 5 b | maximum stats (copy of +0x64..) | code |
| +0x78..+0x81 | b | cleared at init (counters) | code |
| +0x82..+0x90 | b | protection / effect counters (appendix B) | code |
| +0x97 / +0x9A | b | disease / poison | code (spells agent + world agent agree) |
| +0xA0 | l | experience points | code+harness |
| +0xA4 | l | carried weight (sum of item weights, init: sum of the 5 start items' +8) | code bcdfp +0x934..+0x97C |

Stat slot roles (code): +0x64 melee damage bonus table T1; +0x65/+0x66 spell stat (clerics/druids use +0x65, others +0x66 per spells agent); +0x67 level-up HP bonus (T1) and disease resistance; +0x68 base armour and melee attack delay (T3) and pit-fall damage. **Names confirmed (2026-11-23, chargen panel labels, §8.9): +0x64 STR, +0x65 WIS, +0x66 INT, +0x67 CON, +0x68 DEX.**

### 1.2 Tables (S_2, 31 words, index = stat value 0..30; harness-checked values in vectors.json, exported in rules-tables.json)
* **T1** `S_2+0x2E4` stat bonus: -7,-6,-5,-4,-3,-3,-2,-2,-1,-1,0,0,0,0,0,0,1,1,2,3,4,4,5,5,6,7,7,7,7,7,7.
* **T2** `S_2+0x322` (spell recharge modifier percent, see A): 35,30,25,25,20,20,15,10,10,5,0,... down to -30.
* **T3** `S_2+0x360` speed: 9,8,7,7,6,5,4,3,3,3,0,...,-1..-9.

### 1.3 Class templates and creation (bcdfp DATA hunk +0x146, 38 B each; code)
`name[14]`, 5 words start stats, 1 word spare points (**25**), 5 words minimum stats (floor when subtracting), 1 word portrait base (0, 9, 18, 27 = 9 faces per class, 36 total). Start / min:

| Class | stats (template order) | portrait base |
|---|---|---|
| FIGHTER | 14, 8, 6, 12, 10 | 0 |
| CLERIC | 12, 8, 14, 6, 10 | 9 |
| MAGIC USER | 8, 14, 6, 12, 10 | 18 |
| DRUID | 6, 8, 12, 10, 14 | 27 |

The party is the fixed four classes; creation edits stats (25 spare points), names and portraits. Point allocation: each stat in [class minimum, 20], pool 25 (§8.9). Starting kit: 20 items = 5 per class (`bcdfp` DATA 0x585C, see data-structure.md).

New-game init (code, bcdfp +0x22A..+0x9DA): level 1, HP/max 20, XP 0, food=water 5000, energy 10000, armour +0x62=+0x63 = table[+0x68]+6+2, weight = sum of starting items.

### 1.4 XP and level-up (**harness**, S_1 +0x17D2A, vs `levelUp()`; 240 random cases exact)
* Level L advances while **xp > 2^(L+7)**; the threshold doubles for each level gained in the same call (multiple levels possible). Level 1 needs >256, L2 >512, L3 >1024 ... (no level cap in this routine).
* Per level gained: `hp += rand16(9) + T1[stat+0x67] + 7` added to both HP and max HP. Same for all classes. Nothing else changes (no stat gain, no spell slots) in this routine; the chain afterwards only redraws and prints "GAINED A LEVEL / N LEVELS".
* Spell level gating uses level (appendix A): spell level <= char level.
* XP source (code, S_1 +0x7ED0 / +0x81C4): when a monster dies, **each living character** gets `xp += word(second record +6) + rand16(second +8) + rand16(first record byte +2)`; args in +0x7ED0 not re-read (**hyp** on the exact args; the loop at +0x81C4 shows this form). Tablets (type 0x30) can also give levels/HP (appendix B).
* RNG: **harness** exact. 6-byte state, `new = s1 + s4 + s5 + 1 (+carry)`, shift register; rand8(n)=byte%n, rand16(n)=(hi<<8|lo)%n, lo drawn first, n=0 returns 0 (S_1 +0x26854/+0x268BA/+0x268CC). Seed source not found in S_1 (**open**; bcdfp/BlackCrypt).

## 2. Combat

### 2.1 Time model (code)
Real-time, not turn-based. Tick counter long at A4+0x1750, incremented once per call of the tick handler `S_1 +0x8B2`. Timed things are a sorted list of 12-byte slots at A4+0x1036 (150 slots, free list head A4+0x173E, next A4+0x103F+12*i), created by **ScheduleEvent +0x5EA** `(type, dueTick, a1, a2, a3, a4)`; the handler dispatches due events by type: 0x01 / 0x05 monster act (a1,a2 = x,y), 0x0A/0x0B misc, 0x14/0x15 weapon cooldown ready (hand), 0x16 pain/flash, 0x1E AC buff expiry (900 or 1800 ticks), 0x1F strength buff expiry (1800), 0x20 compass (3600), 0x21 wizard sight (3600), 0x22 create-wall expiry, 0x23 detect-trap (D4*360), 0x24 haste (D4*120), 0x25, 0x28/0x29. **Open:** wall-clock length of one tick: see §8.7 (hyp 0.1 s). > **Correction (2026-11-23):** the per-tick list that follows is superseded by §8.6.

Per-tick periodic effects in +0x8B2 (code): every 16 ticks: if flag +0x6D (regen) is set and HP<max: +1 HP. Resting (A4+0x1746 != 0, sleeping chars only): every 8 ticks HP += level*2 (level if the square has flag 0x80 and +0x86 is set), clamped to max. Every 64 ticks: if food (+0x52) or water (+0x54) < 2000 the char takes `2 - value/2000` = 2 damage via DamageCharacter (kind 1). Every 512 ticks: poison (+0x9A) deals its value as damage; every 256: disease (+0x97) deals rand16(5)+1... (**code**; exact byte mapping of the two status bytes from the spells/world agents: +0x9A poison, +0x97 disease; the tick code reads +0x97/+0x9A at these cadences and I did not re-verify which pairs with which cadence: **hyp** on the pairing). Food/energy loss per action is in appendix B (code).

### 2.2 Player melee (**harness**, S_1 +0x1451E vs `meleeAttack()`; 500 random cases exact, null control disagrees)
Inputs: attacker level L, stat s64, to-hit bonus b6c, weapon (gfx, item +0xC "extra"), target monster record (hit byte m2 = record +2, HP at record +8).
1. Weapon lookup (S_1 +0x0BDE8): `(base, sides, bonus)`. Bare hand (no item): base = 4 for Fighter else 1, sides = L, bonus 0.
2. `strB = T1[s64]`; **halved (arithmetic shift) when bare-handed**.
3. `thr = 7 - ((L-1)>>1) - strB - 2*b6c + m2`, clamped to [2,20].
4. `roll = rand8(20) + bonus + 1`; **hit iff roll >= thr** (and base != -1). The roll is always drawn; the damage draw only on a hit.
5. `dmg = max(1, rand16(sides) + base + strB + bonus)`; `monHP -= dmg` (16-bit). Death is handled separately (below).
6. Afterwards (code): record +0x12 of the second record is incremented (alert), a cooldown event 0x15 is scheduled at now + max(5, ...) (T3[stat+0x68] + weaponWeight/23, min 5, halved +1 under Haste).

**Weapon table** (gfx -> base,sides; harness, exported as `weaponBase`): 1:(1,4) 2:(2,5) 3:(2,11) 6:(1,4) 7:(1,8) 0x21:(4,20) 0x47:(4,20) 0x59:(1,4) 0x87:(1,6) 0x88:(2,5) 0x89-0x8B:(2,11) 0x8C:(2,7) 0x8D-0x8F:(1,8) 0x90:(1,6) 0xA4:(2,7) 0xBB:(4,20). Other gfx (not weapons) leave the outputs untouched (non-weapon items never reach this routine through the use-item switch). Bonus = item word +0xC.

**Monster-specific rules** (monster type = record byte +1; harness over all 256x256 type/gfx pairs; sha1 in vectors.json): types 0x4B,0x4C: gfx 0x89 doubles base and sides. 0xB1: bonus -= 10 unless the active char's item at +0x36 has gfx 0xC0. 0xB2: immune except gfx 0x8C (tripled). 0xBE: immune except 0x8C, which yields (-3,-3) (a game quirk: negative sides). 0xC5: immune except gfx 0x21, 0x47, 0xBB.

### 2.3 Monsters hurting the party (code, S_1 +0x9D28 monster attack; not harness-verified)
* Target selection `+0x96E8`: the two front slots of the formation (A4+0x1E74 maps slot->char) chosen by facing; dead chars (HP<=0) skipped.
* Melee: if the target has protection byte +0x83 set, 50% auto-miss; if byte at +0x82+(hand) set, miss; otherwise **hit iff rand8(100) >= char[+0x69]**; `dmg = rand16(d4) + d5 + bonus` (d4/d5 from the monster's attack-strength fields), then **DamageCharacter(char, dmg, kind 4, flag 1)** (`+0x17686`). The exact source of d4/d5 and of the random "attack strength + random" fields: **open** (read +0x9D28..+0xA300 preamble).
* DamageCharacter (**code**, +0x17686): if `dmg < HP`: HP -= dmg, records last damage, schedules events; otherwise "DIED": HP=0, items on the char (pack and equipment) drop to the square, party formation updated, party gone if none left. No armour is applied inside this routine (armour acts earlier through +0x69 rolls). Energy -3/food -2/water -3 per damage event.
* Special attacks `+0x98A8`: type 0xC possession (only monster 0x80B1-0x80C...), 0xD stone, 0xE disease, 0xF poison; each gated by a protection byte and `rand8(100)`; poison/disease add to +0x9A/+0x97.
* Monster spells: appendix A.4.
* > **Correction (2026-11-23):** the monster melee rule in the next bullet (`rand8(100) >= char[+0x69]`) is the spell rule; melee is the armour threshold in §8.4 (harness).
* **Monster behaviour is a bytecode VM** (decoded in full: §8.3) (`S_1 +0xAAFC`, called by events 1/5): 6-byte instructions `op,a,w1,w2` per behaviour type; behaviour = record word +0x0E (movement type), script pointers table at `S_2+0x114A` (4 B each, 12 entries; entries 0,4,7,8 share a script). Opcodes seen in the dispatcher: 2,3,4 step/attack, 5 wait w1 ticks, 6 wait speed&0x7F, 9 sidestep, 0xA, 0xB attack (+0x940C), 0xD regenerate (HP += rand + w/2, capped), 0x10 set / 0x12 add / 0x13 sub per-monster variable, 0x16/0x19 (adjacent)/0x1C/0x1D conditions, 0x1E (+0x9626), 0x21, 0x22 transform (set word0, counter 0x14), 0x24 set HP, 0x27 message, 0x28/0x29 state slot write, 0x2B wait 2*speed, 0xFF counter/flee-turn. **Solved in §8.3:** the script pointers in the extracted image are 0x80 low; cells are `op, a, w1, w2`.

### 2.4 Monster death (code, S_1 +0x7ED0)
When `HP < 1`: the monster's carried item chain drops to the square, effects/events are cancelled (+0xB25A), the square is redrawn, and **XP is awarded to each living character** (§1.4). Special-type monsters have custom handling (types 0x80B1.. keep HP at 49 / 1 until a flag; 0xC5-type is a story boss: sets A4+0x1A1E).

## 3. Spells: see Appendix A. Rules in one line: five memorised spell slots per char, no mana, no failure roll (only anti-magic squares fail), recharge timers per spell, spell levels 1..10 gated by char level, damage = magnitude + rand(n).

## 4. World rules: see Appendix B. No random encounters (only scripted/generator spawns), no shops, no currency, no lock-picking, keys are consumed.

## 5. Copy protection
S_1 holds a manual-question table (~+0x1B1E6..+0x1B4F9). It was neither read for answers nor recorded.

## 6. Tooling and tables
* `tools/blackcrypt/rules_oracle/oracle.c` (musashi; `build.sh`; builds on `tools/bcdft_decompress/musashi`): loads S_1 at 0x80058 and S_2 at 0xA8BF0, A4 = S_2+0x7FFE, patches every external `jsr abs.l` target to `RTS` (UI/blitter/text) except the real helpers, and runs single routines to a sentinel return. Modes: `rng`, `levelup`, `weapon`, `melee`, and (pass 2) `mmelee`, `xp`, `ai`, `tick`, `spec`; `TRACE=1` prints every executed S_1 offset. `make_vectors.py <s1> <s2>` regenerates `vectors.json` (116 KB, no game data beyond small rule constants).
* Parity: RNG 72 sequences x 24 draws exact; level-up 240/240; weapon lookup 65,536/65,536 type x gfx (fixture stores the base table and the 6 deviating monster types plus the matrix sha1); bare-hand 16/16; melee 500/500. Null control (perturbed base) disagrees on >20 cases. Pass 2 parity: see the table in §8.
* `tools/blackcrypt/rules-tables.ts` (wired into `tools/shared/game-config.ts` `buildAssets`) writes `rules-tables.json`: T1/T2/T3, XP thresholds, new-character defaults, class templates, 60-spell table (name, recharge, level, nextInPage), weapon base table decoded statically from the dispatch chain (test confirms it equals the harness table). Needs `build/cache/blackcrypt/bcdft_*.bin` (run `tools/bcdft_decompress/build.sh run`).
* **Vector sets (pass 4 housekeeping).** The movement and spell vectors (6 MB + 1 MB compressed) are no longer committed: `rules_oracle/gen_vectors.sh` builds the oracles and writes the full sets to `rules_oracle/generated/` (gitignored, 45 s, byte-identical to the old committed files). The tests load `generated/` when it exists and otherwise the small committed subsets `vectors_move.small.json.gz` (0.5 MB, about 100 cases per kind) and `vectors_spell.small.json.gz` (0.15 MB), shape-stratified by `make_small_vectors.py` so the rare outcomes (door opens, kills, bindings, possession, stone) stay covered; coverage thresholds relax to "at least one" on the subsets (`rules-vectors.ts`). The new event and boss fixtures (`vectors_events.json.gz`, `vectors_boss.json.gz`, 75 KB / 30 KB) are small enough to commit whole.
* The older `classes.json` export (stat labels str/dex/con/int/wis/cha) is wrong; `rules-tables.json` supersedes it.

## 7. Smallest next steps (pass 2 list; superseded by §10.9)
1. Wall-clock tick length: find the reload of the countdown byte `+0x150(a5)` (an interrupt server in the `BlackCrypt` executable) or time a captured session (§8.7).
2. Harness the monster pathfinder `+0x866C` / step `+0x9116` on a synthetic map, then the spell-branch of `+0x9D28` and `+0x940C` / `+0x9626`.
3. Harness the player-side spell routines (heals, cures, buffs: `+0x5070`, `+0x52D6`, `+0x54E2`, `+0x5710`) and `CastSpellRay +0x6D9A` ranges (`+0x435C`).
4. Name item effects 0x8D-0x90 from the dispatch table at `+0x12FEA`; counter `+0x89`; who switches a monster to movement type 10.
5. Possession / stone (`+0x98A8` bits 12 / 13) as harness cases.


## 8. Pass 2 (2026-11-23): monster AI, harnessed combat, ticks, armour, creation

Everything here was derived from the game's own 68k code. New harness modes in `tools/blackcrypt/rules_oracle/oracle.c` run the **real** routines (`mmelee` = S_1 +0x9D28, `xp` = +0x7ED0, `ai` = +0xAAFC, `tick` = +0x8B2, `spec` = +0x98A8) with a call-hook facility (a routine reached by PC is skipped, D0 is forced, its stack arguments are logged), and TS ports live in `tools/blackcrypt/rules-monster.ts` (tests `rules-monster.test.ts`, vectors in `vectors.json`, each with a null control). C-runtime helpers above S_1 +0x28000 (32-bit mul/div) stay real; every other absolute `jsr` target inside S_1 is still stubbed to `RTS`.

| Rule | Routine | Parity (cases) | Null control |
|---|---|---|---|
| Monster melee on the party (target pick, gates, to-hit, damage) | +0x9D28 melee path, +0x96E8, +0x97F0 | **2,500 / 2,500** (return, damage list, flags, RNG state) | AC +4 disagrees on >20 |
| Monster-death XP award | +0x7ED0 loop at +0x819C | **400 / 400** (1,600 character slots) | +1 base disagrees on >300 |
| Behaviour VM (state, call sequence, scheduled event, RNG state) | +0xAAFC | **1,500 / 1,500**; every one of the 26 opcodes executed | +1 speed disagrees on >100 |
| Tick handler vitals (hp, light/hold counters, call sequence) | +0x8B2 | **1,500 / 1,500** | tick shifted by 64 disagrees on >200 |
| Monster disease / poison attacks | +0x98A8 bits 14, 15 | **1,500 / 1,500** | zeroed CON table disagrees on >10 |

### 8.1 Monster record, as loaded (object record 0x14 bytes at A4-0x6E7A + 0x14*id; **code**, fields confirmed by the harness where the VM or melee reads them)
Primary record P (id) and secondary record S (index = P word +0x10):

| Rec | Off | Meaning |
|---|---|---|
| P | w+0 | gfx (0x80B3.. monster, 0x80B7 / 0x80B8 / 0x80B9 / 0x80BE / 0x80C5 special) |
| P | b+1 | monster type byte (weapon immunity rules, §2.2) |
| P | b+2 | hit byte (XP random term; also the player to-hit adjustment) |
| P | b+3 | bits 0-1 = **morale index** (flee threshold 0 / 10 / 20 / 30 % of max HP), bits 2-3 = **speed index** (0..3: act-gate and pathfinder depth), bit 4 = can pass doors, bit 5 = do not turn to face the party, bit 7 = flying |
| P | b+5 | move speed: wait = `b5 & 0x7F` ticks (Rock Eye 0x84 = 4 ticks, Two Head 0x85 = 5) |
| P | b+6 | attack methods: bit 0 = can open doors, bit 1 = melee, bit 2 = ranged / spells |
| P | b+7 | magic charges (decremented by heals, spells) |
| P | w+8 / w+0xA / w+0xC / w+0xE / w+0x10 | current HP / carried item chain head / spell-set bit mask / movement type = script index (0..11) / secondary index |
| S | w+0, w+2 | last-seen party position |
| S | w+4 | VM program counter (cell index, 0 = header) |
| S | w+6 / w+8 | XP base / **maximum HP** (used for XP, damage scaling and morale) |
| S | b+0xA / 0xB / 0xC / 0xD / 0xE | attack-animation frame / position on square (0-3 corner, 4 centre) / facing / turn state (4 = none) / manhattan distance to the party |
| S | b+0xF.. | VM variables var[0..7]; **b+0x11 = var[2] (saved movement type) and b+0x12 = var[3] (flee counter) and b+0x13 = var[4] ("event pending")** alias them |

### 8.2 Monster activation
* A monster act is a scheduled event: **type 1** `(due, x, y, id)` calls the behaviour VM `+0xAAFC(id, x, y)` (called from the tick handler dispatch at +0x1314). **Type 5** is only the attack-animation frame stepper (`+0xB486`, every 2 ticks, cosmetic).
* The VM runs cells from `pc` until an op sets the delay `d5` (ops 5, 6, 9 without a free square, 0x2B, 0xFF). Then `pc` is stored and, unless the last act result was 2 (monster removed / blocked: `var[4] := 0`, no reschedule; for gfx 0x80B7/0x80B8 a result of 2 becomes 0 and `S.b0E := 10`), event 1 is re-scheduled at `tick + d5`. A result of 1 (interrupted) halves the delay: `d5 := d5/2 + 1`. (**harness**)

### 8.3 The behaviour VM (**harness**: `runBehaviour`, 1,500 cases)
Cells are 6 bytes: `op:1, a:1, w1:2, w2:2` at S_2 +0xE92..+0x1149 (116 cells; the block ends exactly at the pointer table S_2 +0x114A). Each script is a contiguous run of cells; `pc` indexes from the script's first (header) cell; jump targets (`w2`) are script-relative. **Pass 1's failure to decode this was a relocation artefact: the 12 script pointers in the extracted S_2 image are 0x80 bytes low** (with +0x80 each lands on a header cell and the last script ends on the table). Header cells (`0x14` / `0x15`) are rewritten at run time by MARK ops; cell 0 is never executed (pc starts at 1).

| Op | Name | Semantics |
|---|---|---|
| 02 / 03 / 04 | ACT_MELEE / ACT_RANGED / ACT_ANY | `w1 == 1`: pursue one step (`+0xA664`); otherwise act in place (`+0x9D28`, op = permitted modes: 2 melee, 3 ranged, 4 either). result = return value; pc++ |
| 05 / 06 / 2B | WAIT / WAIT_SPEED / WAIT_DOUBLE | delay = `w1` / `b5 & 0x7F` / `2*(b5 & 0x7F)` ticks |
| 09 | STEP_RANDOM | one step to a random free neighbour (`+0x8D7E` list); with no free square the delay is `b5 & 0x7F` and **pc stays** |
| 0A | TELEPORT | move to square (x = `a`, y = `w1`); `S.b0E := |partyX - y| + |partyY - y|` (the code subtracts y from both axes) |
| 0B | ACT_SPELL | `+0x940C` ranged spell cast (result code) |
| 0D | HEAL | if charges (`P.b7`) and `P.wC & 3` and `S.maxHp - 5 > P.hp`: `n = (wC & 2) ? 20 : 10`, `hp += rand16(n) + n/2` (cap max), `b7--`; pc++ either way |
| 0E | GOTO | pc = w2 |
| 10 / 12 / 13 | VAR_SET / VAR_ADD / VAR_SUB | `var[a] = / += / -= w1` (byte wrap) |
| 16 | IF_HP_OK | goto `w2` when `hp*100/maxHp >= (b3 & 3)*10` (signed truncating divide), else fall through (= the flee / heal branch) |
| 19 | IF_NOT_ADJACENT | goto `w2` unless `|partyX-x| + |partyY-y| == 1` |
| 1C / 1D | IF_DIST / IF_VAR | compare `S.b0E` (distance) / `var[a]` with `thr = w1 & 0x1FFF`: bit 15 `>`, bit 14 `==`, bit 13 `<` (any set bit that holds); goto `w2` if true |
| 1E | ACT_SPECIAL | `+0x9626(a)` special act (result code); pc++ |
| 21 | STEAL | `+0xA906`: the monster takes the item in the target's hand slot +0x1A (else +0x1C), unless type 6 / 0x2B / 0x26, and holds it (carried chain) |
| 22 | TRANSFORM | `P.gfx = w1; P.b7 = 20` |
| 24 | SET_HP | `S.maxHp = P.hp = w1` |
| 27 | MESSAGE | print string table entry `w1` |
| 28 / 29 | MARK_A / MARK_B | write the header cell: op byte = 0x14 / 0x15 (and `w2` for 29); the monster-death code copies a 0x15 header's word to the dying object (state hand-over) |
| FF | FLEE_TICK | `var[3]--`; if nonzero call `+0x866C`, and (when `A4+0x1E8F != 3`) `pc = 1`, `P.movementType = var[2]`, `var[2] = var[3] = 0`, delay 1; at zero `var[2] = 0`, result 2 |

**Scripts by movement type** (decoded; JSON `monsterAi.scripts` in `rules-tables.json`):

| Type | Script (pc: op) | Reading |
|---|---|---|
| 0, 4, 7, 8 | 1: ACT_ANY(pursue) 2: WAIT_SPEED 3: GOTO 1 | relentless chaser; attacks when adjacent |
| 1 | 1: VAR0=0 2: ACT_MELEE(in place) 3: WAIT_SPEED 4: GOTO 2 | stationary guard, swings at the adjacent square |
| 2 | 1: STEP_RANDOM 2: WAIT 3: ACT_ANY(pursue) 4: WAIT 5: GOTO 1 | wanderer that pursues |
| 3 (thief) | wander until adjacent; STEAL; chase 5 times; TELEPORT to (60, 7); come back when the party is far; ... | steals a hand item then teleports to a hideout |
| 5 (possessor) | chase / random-step loops on distance; on var1 > 0xFE or var0 > 0 transforms 0x80B7 -> 0x80B8 (200 / 150 HP); ACT_SPECIAL | the possession boss behaviour (§8.6) |
| 6 (caster) | 1: pursue 2: wait 3: IF_HP_OK -> 1; 4: ACT_SPELL 5: wait 6: IF_NOT_ADJACENT -> 4; 7: HEAL 8: wait 9: GOTO 1 | pursues while healthy; below its morale threshold casts and heals |
| 9 | melee x3 then ranged, each pursuing, with waits | multi-attacker |
| 10 | ACT_SPECIAL, WAIT_DOUBLE, FLEE_TICK, loop | timed special / fleeing state (who switches a monster to type 10 is **open**) |
| 11 ("thank you") | init vars; ACT_SPECIAL; message 1 when the party is adjacent; pursue loop | friendly NPC behaviour |

### 8.4 Monster act, pursuit and melee (`+0xA664`, `+0x9D28`; melee path **harness**, rest **code**)
* **Gates** (every act attempt, `+0x9D28`; melee-only monsters shown, spell branch in A.4): direction `d2` from monster to party (dx, dy as party minus monster; dominant axis wins, ties = none; none returns 0; `dx >= 4` or `dy >= 4` returns 2). `melee = (b6 bit1) && manhattan == 1 && op in {2,4}`; `magic = (b6 bit2) && aligned && op in {3,4,0xC}`. Unless gfx 0x80B9 on its first act: **gate 1** `rand byte < 255/(speedIdx+1)` (minus 30 for gfx 0x80B7/0x80B8) returns 0 (no act); **gate 2** with `n = melee + magic`: `n == 0` returns 0, else `rand byte < 255/(n+1)` (minus 30 for 0x80B8) returns 0. With both modes available a further `rand byte <= 127` keeps the spell, otherwise melee.
* **Melee** (**harness**): `m = max(1, S.maxHp / 10)`; target from `+0x97F0`; event 5 is scheduled; `thr = clamp(AC + 8 - ((m-1) >> 1) - speedIdx, 2, 20)` with AC = target byte +0x62; **hit iff `rand8(20) + 1 >= thr`**; `dmg = rand16(4*m) + m`; DamageCharacter(target, dmg, kind 4, flag 1). Draw order: gate 1, gate 2, (centre-square target pick `rand16(2)`), `rand8(20)`, `rand16(4m)`.
* **Target selection** (**harness**): `+0x96E8` takes the party formation `A4+0x1E74[slot] = char`, facing `A4+0x1744`: slot `(dir+4-facing+3)&3` (fallback `+1`) and slot `(dir+4-facing+2)&3` (fallback `+3`), only living chars (hp > 0). `+0x97F0`: a corner monster (S.b0B 0..3) uses the first target when `dir == pos`, the second when `(pos+3)&3 == dir`, else none; a centre monster (pos 4) uses whichever exists, or `rand16(2)` between both.
* **Special attacks** (**harness** for bits 14 / 15): for spell-set bits 12..15 the target is picked, then `rand8(100) < char.b69` resists (`b69` is the resistance percentage, higher = safer), and with the magic-shield counter `+0x83` set a second `rand8(100) > 50` resists. **Bit 15 poison**: unless `+0x8B`, `+0x9A += 1`, damage `rand16(10)+1` kind 5. **Bit 14 disease**: unless `+0x88`, infects iff `rand16(20) + 20 - T1[CON] > 30`, then `+0x97 += 1`, damage `rand16(10)+1` kind 6. **Bit 12 possession** (gfx 0x80B7 only, target needs `+0x8F == 0`, the two candidate targets are swapped when `rand16(100) > 50`) and **bit 13 flesh-to-stone** (needs `+0x87 == 0`) both kill the target (DamageCharacter with its full HP, flag 0); possession turns the monster into 0x80B8 with 150 HP, stone creates a statue object (type 0x2F) remembering the character. (**code**)
* **Pursuit** (**code**): `+0xA664` turns the monster toward the party (turn state `S.b0D`), calls the pathfinder `+0x866C` (search depth `3 * (speedIdx + 1)` squares; result `A4+0x1E8F` 1 = open, 2 = blocked, 3 = no path; `A4+0x1E91` = distance), then either attacks (adjacent) or steps (`+0x9116` moves the monster object, redraws). **Door passing** (`+0x8532`, the square-enter test; returns 0 free, 1 blocked, 2 open-it): objects on the square are walked by structure type: door frame (0x11) blocks unless `b3 bit 4`, a locked door (state 2) always blocks, a closed door needs `b6 bit 0` (can open doors, result 2 = open it); pillar (0x17) and illusion wall (0x10) block while solid; pits (0x14): a floor pit blocks all, a ceiling pit blocks flyers; fountains / panels (0x1F) and statues (0x2F) always block. Items and other monsters do not block here.
* **Morale / flee**: only through script ops 0x16 (`IF_HP_OK`) and FLEE_TICK; the morale index (b3 bits 0-1) gives the 0 / 10 / 20 / 30 % threshold. No generic "flee" movement exists beyond the scripts.
* **Ranged** (**code**, A.4): spell-set bits 2..6 fire bolts and 7..10 ice bolts, `dmg = rand16(d4) + d5 + m` against up to two targets, skipped by `+0x83` (51 % pass) / `+0x82+idx` (resisting) / `rand8(100) < b69`; bit 11 holds the party (`A4+0x1756 += 18`); the monster cast gate is gate 1/2 above plus a uniform choice among set bits (max bit 11 beyond distance 1).

### 8.5 Monster death and XP (**harness**, `awardXp`)
When `P.hp < 1` the carried chain drops, effects are cancelled and **every living character (hp > 0) independently gets `xp += rand16(S.maxHp) + rand16(P.b2) + S.w6`**, in slot order (two draws each, first `rand16(S.maxHp)`), followed by the level-up check (§1.4, harness). gfx 0x80C5 with hp < 50 is held at 49 and sets `A4+0x1A1E` (the story-boss stage machine, `+0x79C2` / `+0x7B2E` / `+0x7C40`).

### 8.6 Vitals tick (**harness**, `vitalsTick`; the periodic part of `+0x8B2`)
The tick counter `t` (A4+0x1750) is incremented first; the light timer `A4+0x1754` and the hold timer `A4+0x1756` each lose 1 while above 0. **Everything below runs only when `t & 15 == 0`, or when resting and `t & 7 == 0`** (so the resting food/water cadence `t & 7 == 5` in the code is unreachable):

| Cadence | Effect |
|---|---|
| `t & 15 == 0` | monster-generator scan `+0xB614` (§Appendix B e) |
| every pass, per living character | `AdjustVitals(char, energy, food -1, water -1)` where energy = +125 for a resting character in the resting state (`A4+0x1A07[slot] == 1`), else 0 |
| resting, per living character in state 1 | HP += `level*2` (halved when the square flag bit 31 is set and `+0x86 == 0`), clamped to max |
| per living character, flag `+0x6D` set, `t & 0x200 == 0`, hp < max | HP += 1 |
| square flag bit 31 and `+0x86 == 0` | `rand16(5)+1` damage, kind 4 |
| `t & 0x1FF == 0x100` (resting: `t & 0x1F == 0x10`) | each character with `+0x97 != 0`: damage = `+0x97`, kind 6 |
| `t & 0xFF == 0x80` (resting: `t & 15 == 8`) | each character with `+0x9A != 0`: damage `rand16(+0x9A * 10) + 1`, kind 5 |
| `t & 0x7F == 0x40` | food < 2000: damage 2, water < 2000: damage 2 (kind 4) |
| `t & 63 == 32`, not resting | stat-enchanted pack items (effect word < 0x80, charges not 0 / 0xFF) lose a charge; at the last charge the enchantment is removed (**code**, not in the TS port) |

Damage kinds (4 = physical / hunger, 5 = poison, 6 = disease) are passed to DamageCharacter unchanged. Spell recharge (`+0x10D2`) is outside the gate (every tick not on the gate path). **Corrections to pass 1:** hunger / thirst damage is every 128 ticks (not 64), poison every 256, disease every 512, and the pairing is +0x9A poison / +0x97 disease as pass 1 guessed.

### 8.7 Time (superseded by §10.1: tick = 8 vblanks PAL / 10 NTSC, **harness + code**; the text below is the pass-2 evidence, kept for history)
One game tick = one call of the tick handler, which the main loop runs when the input library's idle event (code 1, `+0x1FDB6`) is returned. The library's timer unit is a decisecond (`VBlankFrequency / 10` frames, `+0x1EFB4`; reload byte 10 at `+0x151(a5)`), but no code in `bcdft`, `bcdfp`, `bcdfq` or `BlackCrypt` loads the countdown byte `+0x150(a5)` with a positive value, so the cadence is set by something outside the overlays (an interrupt server). **Working assumption for the remake: 1 tick = 0.1 s (`TICK_MS = 100`, hyp)**; 0.2 s (10 vblanks at 50 Hz) is the alternative. Every duration below is in ticks so the constant is the only thing to change. Smallest next step: read the `BlackCrypt` executable's `AddIntServer` / `CIA` setup for the 0x150 reload, or time a captured session.

### 8.8 Armour and the two defence bytes (**harness / code**)
* **`+0x62` AC: higher is better.** The monster melee threshold is `AC + 8 - ...` (§8.4): each AC point lowers the monster's hit chance by 5 percentage points; base AC = `T1[DEX] + 6 (+2 at new game)`; worn armour adds its word +0xC low byte, SHIELD / PROTECTION add `n` for 1800 ticks. Minimum hit chance 5 % (threshold clamps at 20), maximum 95 % (clamps at 2).
* **`+0x69` resistance percentage** is used only by spells and special attacks (`rand8(100) < b69` resists), never by melee. Event 0x25 (item routine `+0x78DA`) adds 75 (0x4B) to every living character for 200 ticks.

### 8.9 Character creation (**code**; labels read from the chargen stat-panel bitmap)
* Stat slots, creation order = template word order: **STR, INT, WIS, DEX, CON** stored to record bytes **+0x64, +0x66, +0x65, +0x68, +0x67**. The panel's sixth field is "POOL" (spare points, 25).
* Allocation (bcdfp `+0x1996` raise, `+0x1A46` lower): a stat can be raised while it is below **20** and the pool is above 0 (pool -= 1); lowered while above its class minimum (pool += 1). Class minimums and starts are in §1.3.
* **Class numbering is Fighter 0, Cleric 1, Magic User 2, Druid 3** (template order, record word +0). Item class mask = **low nibble of the loaded item record byte 4** (the high nibble is the placement position on the square: the four Fire Wands all have low nibble 0xF and high nibbles 1, 2, 4, 6), bits `1 << class`: **+1 Fighter, +2 Cleric, +4 Magic User, +8 Druid** (e.g. Robes of the Elders / Wizard Blade carry 4, Robe of the Forest 8, Plate Armor 3, Ogre Blade 1). *This reverses the `+4 Druid, +8 MU` in data-structure.md's item table.*
* Names are limited to 12 characters (bcdfp `+0x1DB6`). Starting food / water / energy 5000 / 5000 / 10000 (§1.3).
* **RNG**: the six-byte state starts as the constant `2D 14 CA 66 59 AF` (S_1 +0x26882) and is advanced by (the sum of the four bytes of `seconds + microseconds` from Intuition `CurrentTime`, mod 256) + 1 steps (S_1 +0xD390 -> +0x26888), once at program start. Remake: seed from any entropy source.

### 8.10 Items and the small open items
* Item use effects 0x80-0x90 (code, `+0x12FEA`): 0x80 light, 0x81 dispel, 0x82 pestilence ray, 0x83 fireball ray, 0x84 healing I, 0x85 stone fire ray, 0x86 healing II, 0x87 chant of orlin ray, 0x88 freeze ray, 0x89 quake ray, 0x8A sustenance (food / water to 5000), 0x8B raise dead, 0x8C boss-killer ray (magnitude 200, only gfx 0x80BE / 0x80C5-class targets, §A.5); **0x8D-0x90** call `+0x78DA` (+75 resistance to every living character for 200 ticks, event 0x25) and `+0x79C2` / `+0x7B2E` / `+0x7C40` (the Ram-boss stage machine on `A4+0x1A1E`, 1 -> 2 -> 3, spawns the stage-2 monster); which index calls which routine, and the item names, are **open** (smallest step: read the dispatch table at `+0x12FEA`).
* **Ogre Blade "life force will slowly drain"**: gfx 140 (0x8C) appears in code only in the weapon-rule table (`+0xBF92`: triple damage against the 0xB2 / 0xBE bosses); the periodic block above has no per-weapon HP loss and the clue text (S_1 +0x1BA6F) is flavour (**negative evidence, code**).
* **Mask of True Sight** (gfx 0xC0, the item at character offset +0x36): without it the weapon bonus against monster type 0xB1 is -10 (`+0xBFFE`, part of the **harness-verified** weapon matrix).
* Counters `+0x89`, `+0x8D`, `+0x8E`: `+0x8D` / `+0x8E` are the ice / fire bolt resist flags (A.4); `+0x89` still **open** (no reader found in the tick, melee or special-attack paths).

> **Correction (2026-11-23, pass 3):** §8.7's "no code loads the countdown byte `+0x150(a5)`" was wrong. The loader is in the input library inside S_1 itself (not in an overlay or an interrupt server of the `BlackCrypt` executable): `SetIdlePeriod` at S_1 `+0x1FF7A` and the reload at `+0x1FF90`. The working assumption `TICK_MS = 100` is replaced by 160 ms (PAL) / 166.7 ms (NTSC); see §10.1.

> **Correction (2026-11-23):** the class restriction line in Appendix B(g) ("class word 0 Fighter, 1 Cleric, 2 Druid, 3 MU") is wrong; see §8.9 (2 = Magic User, 3 = Druid). The "+0x65 = WIS, +0x66 = INT" hypothesis in A.1 is confirmed by the chargen labels (§8.9).

> **Correction (2026-11-23):** monster poison / disease damage is `rand16(10)+1` (not `rand(5)+1` / `rand(6)+1` as written in Appendix B(c)), and disease infection needs `rand16(20)+20-T1[CON] > 30` (Appendix B(c) was right about the roll, wrong about the damage).

> **Correction (2026-11-23):** §2.1's per-tick list is superseded by §8.6 (hunger every 128 ticks, the resting cadences, the whole block gated by `t & 15 == 0` or resting `t & 7 == 0`). Event types 1 and 5 are not the same handler: 1 is the behaviour VM, 5 the attack-animation stepper (§8.2).

> **Correction (2026-11-23):** §2.3 said the monster melee hits iff `rand8(100) >= char[+0x69]`. That is the **spell / special-attack** rule. Melee uses the armour threshold (§8.4). §1.4's XP formula was missing the order of draws: two draws per living character (§8.5).

## 9. Remake-ready combat spec (2026-11-23)

Grades: **H** = harness-verified against the real routine, **C** = read from code, **h** = hypothesis, **O** = open. All times in ticks (§9.1); all random draws use the generator of §1.4 (`rand8(n)` = byte % n, `rand16(n)` = word % n, n = 0 gives 0). Per-spell numbers: `game-rules-spells.json` and Appendix A.3; tables: `rules-tables.json`.

### 9.1 Clock
`TICK_MS = 160` on PAL / `166.7` on NTSC (**H** for the arithmetic, **C** for the wiring; §10.1; the pass-2 value 100 was a hypothesis and is wrong). `tick` is a counter incremented at the start of every tick. Per tick, in order (C): increment; light and hold timers decrement; the periodic block of §9.6; spell recharge; then the due events of the event list (types 1 monster act, 5 animation, 0x14 / 0x15 weapon cooldown, 0x1E / 0x1F / 0x20-0x25 buff expiries). The party is real-time; nothing waits for the player.

### 9.2 Characters (H for the formulas, C for the layout)
* Four fixed characters, slot = class: Fighter, Cleric, Magic User, Druid. Stats STR / INT / WIS / DEX / CON (§8.9), each 1..30 (creation 20 max, items add), `T1[v]` = bonus table (`rules-tables.json`), `T3[v]` speed table.
* HP: start 20 / 20, level-up `hp += rand16(9) + T1[CON] + 7` (cur and max) per level gained; **xp > 2^(level+7)** gains a level, repeated (**H**). Level cap none.
* AC = `T1[DEX] + 6 + 2 + worn armour + buffs`; higher is better (**H**, §8.8). Resistance `+0x69` percent (spells only).
* Food 5000 / water 5000 (max 5000), energy 10000; HUNGRY / THIRSTY below 2000, TIRED below 1000 (STR and DEX -1 while tired, C).

### 9.3 Player attack (H, §2.2)
`strB = T1[STR]` (arithmetic half when bare handed); `thr = clamp(7 - ((L-1)>>1) - strB - 2*toHitBonus + monster.b2, 2, 20)`; `roll = rand8(20) + weaponBonus + 1`; hit iff `roll >= thr` and the weapon is not immune; `dmg = max(1, rand16(sides) + base + strB + weaponBonus)`. Weapon table and the per-monster-type immunity / multiplier rules: §2.2 and `weaponBase` (H, 256 x 256). Cooldown event 0x14 / 0x15 after `max(5, T3[DEX] + weight/23)` ticks (halved + 1 under Haste, C). Cost per swing: energy -4, food -2, water -1 (C).

### 9.4 Monster act (H)
Event 1 `(x, y, id)`: run the VM (§8.3) from `S.pc` with the type's script (`monsterAi` in `rules-tables.json`); reschedule at `tick + delay` (delay from the wait ops, halved + 1 on result 1, none on result 2). Act gates, melee, target selection and damage exactly as §8.4 (H): in particular `m = max(1, S.maxHp/10)`, `hit iff rand8(20)+1 >= clamp(AC + 8 - ((m-1)>>1) - speedIdx, 2, 20)`, `dmg = rand16(4m) + m`. Specials (poison, disease): §8.4 (H for bits 14 / 15; C for possession, stone). Ranged bolts: A.4 (C). Movement / pathfinding / door rules: §8.4 (C; the pathfinder `+0x866C` itself and monster stacking on a square are O). Monsters do not pursue beyond `3*(speedIdx+1)` squares of path.

### 9.5 Damage and death (C, `DamageCharacter +0x17686`)
`DamageCharacter(char, dmg, kind, flag)`: if `dmg < hp` then `hp -= dmg`, last-damage display, per-hit vitals cost energy -3 / food -2 / water -3; else the character dies (`hp = 0`, pack and equipment drop to the square, formation updated, the game is over when none is left). No armour or resistance is applied inside. Kinds: 4 physical / hunger, 5 poison, 6 disease. Monster death: HP < 1 -> carried chain drops, effects cancelled, XP award (H, §8.5), story-boss rules for gfx 0x80C5 (C).

### 9.6 Periodic block (H, §8.6)
Implemented as `vitalsTick` in `rules-monster.ts`: food / water -1 each per 16 ticks (energy +125 resting), regen, resting heal, hazard squares, poison (256), disease (512), hunger (128). AdjustVitals clamps to [0, max] (C, §B.a).

### 9.7 Spells (C; A.1-A.4)
Five memorised slots per character, no mana, no failure roll (anti-magic squares fizzle and still spend the charge); casting rays: `total = magnitude + rand16(damage + 1)` per monster on the target square (up to 2), range as in the table; effects durations in ticks: Shield / Protection 1800, Strength 1800, Compass 3600, Wizard Sight 3600, Detect Traps `D4*360`, Haste `D4*120`, Light +120 per cast, magic resistance item 200. Recharge after memorising `R = (L-1)*540 + 1260`, reduced by 180 per level above the spell level (`L < level + b6B`), minimum 360, scaled by `T2[stat]` percent, clamp [60, 32767] ticks (C). Healing: `2<<n + rand16(16*n)` per A.3.

### 9.8 Loot and the world (C)
Monsters carry one item chain (record word +0xA) dropped on death; no gold, shops or random encounters; the only spawners are generator structures (type 0x2E: spawn when count > 0, cooldown 30 + rand(30) ticks, live monsters in range <= limit, Appendix B e). Items, weights and enchantments: Appendix B(g).

### 9.9 What the spec still lacks (after pass 3; the current list is §11.11)
See §11.11. In short: the real pathfinder search order beyond what §10.3 harnesses, the ranged / spell branch of monster acts as harness, party-side spell effects wired into `combat-sim.ts`, square stacking beyond the cases listed in §10.3, the weight term of the swing cooldown and per-step cost, the Ram-boss stage machine (item effects 0x8E-0x90, gfx 0x80C5), and the generator scan `+0xB614`.

**Status table, pass 4 (current; grades: H harness, C code, h hyp, O open; detail in §11)**

| Area | Done (grade) | Still open |
|---|---|---|
| 1 Character state | record map, creation, level-up, XP, stat tables (H / C) | none blocking |
| 2 Combat | player melee, monster act (melee, bolts, hold, specials), behaviour VM, pathfinder, mover, stacking, activation scan and type-10 switch, pursue / approach / wander, XP, vitals tick (all H); `combat-sim.ts` now runs the real chain (§11.1) | possession / stone not applied in the sim, monster VM `TELEPORT` op, generator half of `+0xB614`, weight term of cooldown and step cost |
| 3 Spells | cast dispatcher for rays and 20 simple spells, memorise, recharge, DISMISS / BINDING / REFRESH, **buff-expiry events 0x1E-0x25 (H, 600 / 600, §11.2)** | RAISE DEAD, TELEPORT, CREATE FOOD, REVEAL TRUTH, REMOVE GLYPH, DISPEL MAGIC, REMOVE TRAP, CREATE WALL, READ RUNE (C only; the `G` harness token of §11.2 makes them cheap) |
| 4 World | vitals, resting, traps, locks, doors (`+0x9056`, C), no random encounters, no shops | A4+0x1A22 / 0x1A24 interaction events, generator structure half of `+0xB614` |
| 5 Boss | **Ram-boss stage machine: PROTECTOR, SOULFREEZER, VORTEX (H, 900 / 900, §11.3)**, FORCEHAMMER (C), hold at 49 hp (H) | FORCEHAMMER animation / ending, boss `TELEPORT` and `TRANSFORM` VM ops in the sim |
| 6 Remake spec | §9 + §11.10 (graded system list) | §11.11 |

## 10. Pass 3 (2026-11-23): real tick length, movement, player spells, specials, combat-sim

Evidence labels: **harness** (diffed against the real 68k in musashi, with null controls), **code**, **hyp**, **open**. New harness files: `rules_oracle/oracle.c` modes `period` / `decay` (vectors in `vectors.json`), `oracle_move.c` (+ `vectors_move.json.gz`, TS `rules-move.ts`), `oracle_spell.c` (+ `vectors_spell.json.gz`, TS `rules-spell.ts`). No protection data was read or recorded.

| Rule | Routine (S_1) | Parity | Null control |
|---|---|---|---|
| Tick period arithmetic (SetIdlePeriod + reload) | +0x1FF7A / +0x1FF90 | 16 / 16 | divisor 50 disagrees on > 4 |
| Stat-enchantment decay in the tick handler | +0x8B2 (block +0xC50..+0xE5A) | 600 / 600 | tick + 1 disagrees on > 100 |
| Square-enter test + position mask | +0x8532, +0x8458 | 1,200 | party shifted: > 100 disagree |
| Pathfinder (BFS) | +0x866C | 1,500 | same |
| Adjacency scan / direction pick | +0x8D7E / +0x937A | 600 / 500 | same |
| Mover + stacking | +0x9116, +0x74, +0xFE | 2,100 (32 door-opens) | > 5 disagree (weak: party rarely adjacent) |
| Ray scan | +0x435C | 1,200 (move) + 1,200 (spell) | same |
| Monster act incl. bolts, hold, special calls | +0x9D28 | 7,500 | > 100 |
| Activation scan, movement type 10 switch | +0xB614 (monster half) | 1,500 | > 100 |
| Pursue / caster approach / wander | +0xA664 / +0x940C / +0x9626 | 1,500 each | > 100 |
| Heals, cures, buffs via dispatcher (20 spells) | +0x7044 | 1,000 | caster level +3: > 30 |
| CastSpellRay with march, target pick, kills, boss hold | +0x6D9A, +0x435C, +0xB308 | 1,200 | range +1: > 20 |
| 26 ray spells (magnitude / damage / pre / range, antimagic, water, lifestealer) | +0x7268..+0x7618 | 1,040 | zeroed stat table: > 100 |
| Memorise click | +0xF548 | 600 | T2 = 0: > 20 |
| Recharge section | +0x10D2 | 200 | no resting double speed: > 20 |
| DISMISS (34) / BINDING (43) / REFRESH (46) | spell handlers | 900 | level +1: > 3 |
| Possession / flesh-to-stone | +0x98A8 bits 12, 13 | 1,600 | protection byte ignored: > 20 |

### 10.1 Tick length (**harness** on the arithmetic, **code** on the wiring)
* The countdown byte `+0x150(a5)` and its reload byte `+0x151` belong to the **input library inside S_1** (data frame `a5`), which pass 2 did not search (it looked at the overlays and the `BlackCrypt` executable). Start-up (S_1 `+0x1A7DE`) calls `SetIdlePeriod(10)` (`+0x1FF7A`): `reload = max(1, d0 * VBlankFrequency / 60)` (`mulu.w` then `divu.w #60`), where `VBlankFrequency` is the byte at ExecBase `+0x212` copied to `+0x154(a5)` by the library init (`+0x1EFAC`). The unit is therefore 1/60 s, and 10 gives **8 vblanks on PAL (160 ms) and 10 on NTSC (166.7 ms)**. Harness: 16 / 16 for hz 50 / 60, d0 in {0,1,3,6,10,12,30,60}.
* The vblank interrupt (the library's level-3 handler `+0x1E928`, chain entry `+0x1F008` -> `+0x1F112`) decrements `+0x150` once per vblank while it is above 0 (code). The idle poll (`+0x1FC72`) returns event 1 when it is 0 and sets it to 0xFF. The tick handler's tail (`+0x1FDA` -> `+0x1FF90`) copies `+0x151` into `+0x150`, so the countdown restarts when the handler has finished: tick = handler run time + 8 (PAL) / 10 (NTSC) vblanks (code). The wait function at `+0x1FD06` uses a separate unit (decisecond = `VBlankFrequency / 10` vblanks) and is not the tick.
* `TICK_MS` for the remake: **160 ms (PAL, default) / 166.7 ms (NTSC)**. The region is not a property of the disk: the code reads the machine's value (§11.5).

### 10.2 Tick handler order (**code**, addresses are S_1 +0x8B2 offsets from the disassembly)
Counter `t++` (+0x80920) -> light timer -> hold timer -> `t & 15 == 0` generator scan (+0xB614) -> per-char periodic block (adjust, rest heal, regen, hazard, resting at `t & 7`) -> **enchantment decay** (`t & 63 == 32`, not resting, +0xC50) -> disease (`t & 0x1FF == 0x100`) -> poison (`t & 0xFF == 0x80`) -> hunger / thirst (`t & 0x7F == 0x40`) -> spell recharge (+0x10D2) -> due events (+0x1312 loop; tie order among equal due times: insertion order, **code** since pass 4, §11.4).
* **Decay (harness, `itemDecay`)**: only when not resting. Every character (**alive or not**, no HP test) is scanned over 3 groups x 6 item words from record `+0x16` (word index = group*6 + slot). An item whose object type (byte `+5`) is in {0,1,2,3,7,8,9,10,11,13,21,25,26,27,28,36,42,45} (measured by running the real routine over types 0..63), with charges (byte `+7`) 1..254 and effect word (`+0xE`) < 0x80, loses one charge; at charges == 1 the enchantment is removed first (`+0x18088`, args char, group, slot). 0xFF charges never decay.

### 10.3 Monster movement (**harness**, `rules-move.ts`)
Directions: 0 = y+1, 1 = x+1, 2 = y-1, 3 = x-1; a cell wall bit `0x1000 << d` blocks leaving in direction d.
* **Stacking.** A square is a chain: the cell's low 12 bits = head object id, next link = object word `+0x12`; add inserts at the head. A monster's position on its square is S byte `+0xB` (0-3 corner, 4 centre). The occupancy mask (`+0x8458`) sets bit n per monster at position n and returns 0x1F (full) if any monster on the square has a different gfx word or sits at the centre: **only same-gfx monsters share a square, in corners**.
* **Enter test `+0x8532`** (0 free, 1 blocked, 2 open the door; walks the chain by type byte `+5`, first non-zero wins; mode 1 = first ring of the search, 0 beyond, 2 = the real move): `0x10` illusion wall blocks while `+0xA == 0`; `0x11` door frame blocks unless monster `b3` bit 4 (pass doors), blocks if `+0xE == 2` (locked), in mode 1 blocks unless door `+0xF` bit 0 (open) or monster `b6` bit 0 (opens doors), in mode 2 with `b6` bit 0 and `+0xE == 0` returns 2; `0x12` blocks while `+0xA == 0` and signed `+0x10 <= 3`; `0x14` pit blocks while `+0xA == 0` and `+0x10 == 0`, flyers (`b3` bit 7) when `+0x10 == 1`; `0x17` pillar blocks while `+0xA == 0`; `0x1F` and `0x2F` always. Items and other monsters do not block here.
* **Pathfinder `+0x866C`**: breadth-first search monster -> party over a 64x64 visited buffer, depth `3 * (speedIdx + 1)` (speedIdx = `b3` bits 2-3). Result `A4+0x1E8F`: 1 adjacent with a direct line, 2 path found (or adjacent after an in-square shift), 3 none. `A4+0x1E90` = mask of first-step directions (OR-ed when several reach the party), candidate list `+0x1E8A..` = set bits ascending (not built on 3), `A4+0x1E91` = path length (unchanged on 3). Corner monsters shift within the square; a non-side direction needs the near corner free and the final approach checks the far corner. The party square can only be entered as the goal. `+0x8D7E` is the one-step variant (result 2 if any direction is open, else 3; distance = manhattan).
* **Facing and step** (`+0x937A`, `+0x9116`): the current facing S.b0C is kept when it is a candidate, else `rand16(count)` picks one (S.b0D, 4 = none). If facing differs from S.b0D and `b3` bit 5 is **set**, the monster turns a quarter per act (opposite: a raw byte > 0x7F turns +1, else +3) and the act returns 1; with bit 5 **clear** it snaps and moves in the same act (this corrects §8.1's "do not turn to face the party"). A corner monster moving along an edge shifts corner; leaving the square sets the new corner first. The move is refused into the party square or when the enter test returns 1; a result of 2 logs "open door" and the move proceeds (door-open routine `+0x9056`: §11.6, code).
* **Pursue `+0xA664`**: path search; none -> retry toward last-seen S.w0/S.w2 with S.b13 = 2; neither -> returns 2. A path sets S.b13 = 1, S.b0E = length, S.w0/S.w2 = party. Result 1: face `list[0]`, attack (flag 1). Else it may cast first (aligned, dist < 4, `b6` bit 2, S.b13 == 1), then picks a facing and steps unless it attacked. **Caster approach `+0x940C`** (mode 0xC): when aligned, 2-3 squares, S.b13 == 1, facing `list[0]`, with charges it acts at once (flag 0), else adjacency scan, prefers directions the search did not offer, steps. **Wander `+0x9626`** (VM op 0x1E): adjacency scan, choose among open directions, step.
* **Monster act `+0x9D28`, full**: gates as §8.4. Wrong facing with a non-zero flag: a clear straight line (ray length == distance) sets S.b0D and steps (output 1), else returns 2. Magic path: needs a clear line equal to the distance; candidate bits from 2 (12 if no charges) up to 11 (15 at distance 1), chosen with `rand16(count)`, gfx 0x80B7 at distance 1 forces bit 12. Fire bolts bits 2-6 (base, range) = (2,4) (4,7) (5,0xB) (0xA,0x10) (0x14,0x1F); ice bolts bits 7-10 = (2,4) (4,7) (0xA,0x10) (0x14,0x1F); `dmg = rand16(range) + base + m`, `m = max(1, maxHp/10)`, kind 4. Draw order per bolt target: `rand16(100)` (unused), if `+0x83` `rand8(100)` (<= 50 skips), skip if the fire (`+0x8E`) / ice (`+0x8D`) flag is set (no draw), `rand8(100) < +0x69` skips, then `rand16(range)`. **Original bug: the second target's shield test reads the first target's `+0x83`.** Bolts cost no charge; hold (bit 11) costs one. Bits 12-15 call `+0x98A8` (§10.5). The ray mode selector reads an uninitialised stack byte (`-0x29(a5)`; 0 in the harness; **hyp**: meant to be S.b0B).
* **Ray `+0x435C`** (monster bolts and player rays share it; **harness** twice, by the movement and the spell harness): a wall bit on the square being left stops the ray before it moves (blocked 2); otherwise it enters the next square and stops (blocked 1) at any monster (mode 2) or, in modes 0/1, a monster at the centre or the two near corners; pillar `0x17` / fountain `0x1F` with state 0, illusion wall `0x10` with `+0xC == 2`, `0x12` with `+0x10 <= 3`, closed door `0x11` (`+0xF` bit 0 clear). **Walls and closed doors block rays; open doors and items do not.**
* **Who switches a monster to movement type 10 (harness, `activationScan`, `+0xB614` monster half)**: every 16 ticks the 7x7 window around the party (squares with x or y <= 0 or >= 63 skipped) is scanned; for each monster with S.b13 == 0 the pathfinder runs. A path shorter than 5 **activates** it (S.b0E = length, S.w0/S.w2 = party, S.b13 = 1, act event type 1 at `tick + rand16(6) + 1`). No path, or length >= 5: unless the movement type is 1 (stationary guard) the monster is **switched to type 10** (S var[2] = old type, var[3] = 150, S.pc = 1, P word `+0xE` = 10, S.b13 = 1, same schedule). gfx 0x804F is always activated as if the length were 2. In type 10 the script's FLEE_TICK (§8.3) re-runs the pathfinder each tick: a path restores the saved type; at counter 0 the monster leaves the event list until the next scan. The generator-structure half of `+0xB614` is **open**.

### 10.4 Player-side spells (**harness**, `rules-spell.ts`)
* **Cast**: `D4 = byte(level + int8(b6A))`, `D5 = D4 > 3 ? 2*D4 - 4 : 2`, `D3 = T1[stat]` (stat `+0x65` for class 1 / 3, else `+0x66`). An antimagic square (cell bit 30 at the party square) fizzles any spell and still spends the charge.
* **Heals / buffs**: HEAL `hp += (2 << n) + rand16(16n)` capped (n = 2 for spell 9, else 1); RESTORE sets max; cures clear the status byte; SUSTENANCE food and water 5000 for living chars. SHIELD / PROTECTION (15, 27): `n = D4 <= 5 ? 1 : ((D4-4)>>1) + 1`, AC += n, counter + 1, event 0x1E at `tick + 1800` (`a3 = n`). STRENGTH: +2 strength, event 0x1F at +1800. Party shields use the plain level: ETHEREAL (45) `n = 2 + (L >= 6 ? (L-5)>>1 : 0)`, SHADOW (56) `n = 1 + (L >= 4 ? (L-3)>>1 : 0)`, one event per living char. WIZARD SIGHT (12) / DETECT TRAP (19): counter + 1 per living char. Event times: WIZARD SIGHT +3600 (type 0x21), COMPASS +3600 (0x20), DETECT TRAP `D4*360` (0x23), HASTE `D4*120` (0x24); LIGHT +120.
* **CastSpellRay `+0x6D9A`**: damage per target `mag + rand16(die + 1)`; up to 2 targets from `+0xB308` (centre first, else the two front corners by facing); a ray with zero steps returns before any pick; every picked target's alert byte S.b12 increments even when spared; fire (pre 0x67) fizzles on a water square (cell bit 31) unless `A4+0x1E5C == 3`. Hurt filter: gfx 0x80B2 never; 0x80B1 only with the item at char `+0x36` of gfx 0xC0; 0x80BE only for pre 0x64; 0x80C5 only for pre 0x65; others only pre 1 / 0x66 / 0x67. gfx 0x80C5 with hp < 50 is held at 49 (stage flag). Lifestealer adds `3*total/10`. The 26 ray spells' (mag, die, pre, range) are `RAY_SPELLS`; they match Appendix A.3.
* **Memorise `+0xF548`**: needs an owned page, timer 0, spell level <= char level, a free slot. `R = (L-1)*540 + 1260`, minus 180 per level that `level + int8(b6B)` exceeds L, floor 360; then `R += R*T2[stat]/100` (truncating; stat `+0x66` for class 2, else `+0x65`), clamp [60, 32767]. **Recharge `+0x10D2`**: each tick every nonzero timer loses 1, or 2 while `A4+0x1746` (resting) and the page owner's state byte == 1; the page open on screen is skipped unless `A4+0x1A18`.
* **DISMISS (34)**: blocked by a wall bit on the party square, skips 0x80B2 / 0x80BE / 0x80C5, `thr = clamp(b2 + 7 - ((level-1)>>1), 2, 20)`, kills (hp 0, XP) iff `rand8(20)+1 >= thr`. **BINDING (43)**: `resist = clamp((S.maxHp/10 - level)*20 + 50, 0, 100)`, bound iff `rand16(100) > resist`; a bound monster's events are cancelled and a type-1 event is scheduled at now + **200**. **REFRESH (46)**: zeroes the timer of every spell of level < 5 on the caster's owned pages.
* Still code-read: RAISE DEAD, REVEAL TRUTH, CREATE FOOD, TELEPORT, REMOVE GLYPH, DISPEL MAGIC, REMOVE TRAP, CREATE WALL, READ RUNE and the recast-cancels-old-buff path (`+0x49B4`). The buff-expiry handlers are harness since pass 4 (§11.2).

> **Correction (2026-11-23, pass 3):** A.3 gave BINDING as `random(100)` vs `HP/10 - level` and +20 ticks. The real code uses a 16-bit draw, the secondary record's max HP, and +200 ticks.

### 10.5 Possession and flesh-to-stone (**harness**, `+0x98A8` bits 12, 13; 1,600 / 1,600)
Common prefix: one-target pick, `rand8(100) < +0x69` resists, then `+0x83 && rand8(100) > 50` resists. **Possession (bit 12)** acts only for gfx 0x80B7: picks the two front targets, swaps when `rand16(100) > 50`, takes the first with `+0x8F == 0`, kills it (DamageCharacter with its full HP, kind 4, flag 0), creates a corpse object linked into the monster's carried chain, turns the monster into gfx 0x80B8 with hp = maxHp = 150 and sets UI flags `A4-0x708E = 0x15`, `A4-0x708A = 10`. **Stone (bit 13)** acts for any monster: the prefix target unless `+0x87 != 0`, same kill, creates a type 0x2F statue at the per-character position table (S_2 `+0x24C`) remembering the character.

### 10.6 Item effects 0x8D-0x90, counter `+0x89`, held-party input, starting vitals
* **Item effects (code from the dispatch jump table at S_1 `+0x136FA`, names from the shipped `bcdfs` item records whose effect word `+0xE` has the value)**: **0x8D PROTECTOR** (map 8) -> `+0x78DA` (event 0x25: +75 resistance `+0x69` to every living character for 200 ticks); **0x8E SOULFREEZER** (map 5) -> `+0x79C2`, **0x8F VORTEX** (map 7) -> `+0x7B2E`, **0x90 FORCEHAMMER** (map 10) -> `+0x7C40`: the three Ram-boss stage-machine routines on `A4+0x1A1E` (decoded in pass 4, §11.3). Other holders seen in the data: 0x8A HORN OF PLENTY, 0x8B ORB OF LIFE / ROD OF RESURRECTION, 0x8C MIRROR SHIELD.
* **Counter `+0x89`** (effect index 0x1B in `+0x82 + (effect - 0x14)`): no direct reader or writer exists in S_1 (searched all `0x17E1(a4)` forms and every constant 0x1B), so it is **unused** (negative evidence, code).
* **Held party** (`+0x1756 > 0`, input dispatcher `+0xD6D8`, "party-click whitelist"): mouse events (event codes 2 and 4) are ignored while held **except** in screen mode 1 (`A4+0x174A == 1`) when the clicked region id `A4+0x1EB4` is 8, 9 or 0x5B (code); keyboard / movement events while held are diverted to `+0x14920(0, 1)` unless the screen mode is 1 (code). What regions 8 / 9 / 0x5B are is **hyp** (the on-screen turn controls); not harnessed.
* **Starting vitals (code, direct instructions in the new-game init, bcdfp)**: `+0x52` food = `0x1388` (5000), `+0x54` water = `0x1388` (5000), `+0x56` energy = `0x2710` (10000), confirmed from the `MOVE.W #imm,disp(A0,D0)` stores (the S_1 routine `+0x5AA6` that also writes 5000 is the refill used by sustenance effects).

### 10.7 Combat sim (`tools/blackcrypt/combat-sim.ts`, tests `combat-sim.test.ts`, 9 tests)
An executable §9: a headless tick loop over a small rectangular map. Composed from **harness** pieces: player melee + weapon rules, monster melee (`monsterMelee`), the behaviour VM (`runBehaviour`, now with a live `onCall` callback that returns the act result and the new position), XP and level-up, the vitals tick, and player ray spells (`castRay` + `RAY_SPELLS`, walls as solid pillars). Marked **code** in the source: `DamageCharacter` / `AdjustVitals` (clamps, tired penalty), event ordering, swing cooldown and costs, per-step costs. Marked **hyp / not modelled**: the monster step is a greedy axis step (the harnessed `rules-move.ts` `pursue` / `pathfind` are **not yet wired in**), ranged monsters do nothing, one monster per square, no party spells besides rays (memorise / recharge / heals exist as harness-verified functions in `rules-spell.ts` but are not wired), no items, no loot, no generator scan, no weight term. Tests: determinism, null control (other seeds diverge), composition (first monster act equals `monsterMelee` on the same RNG stream), XP and level-ups, vitals cadence (food/water every 16 ticks, poison 256, hunger 128), game over, AC null control, blocked squares, ray damage and wall blocking, ray kill XP.

> **Correction (2026-11-23, pass 4):** the scope paragraph above is the pass-3 state. The sim no longer uses a greedy step, ranged monsters act, and the party casts memorised spells: §11.1 has the current scope.

### 10.8 Pass 3 corrections
> **Correction (2026-11-23, pass 3):** §8.1 read `b3` bit 5 as "do not turn to face the party". It means the monster turns one quarter per act (and the act is spent turning) instead of snapping (§10.3).
> **Correction (2026-11-23, pass 3):** §8.4 / §9.4 listed the pathfinder and stacking as open and the ranged branch as code-read; they are now harness (§10.3). Monsters' bolts cost no charge; hold costs one.

### 10.9 What the spec still lacked after pass 3 (superseded by §11.11; kept for history)
1. Combat-sim does not yet use `rules-move.ts` (pursue / activation scan) or the spell memorise / recharge / heal functions.
2. The generator half of `+0xB614`, the door-open routine `+0x9056`, the hold effect `+0x58FA`, the Ram-boss stage machine (`+0x79C2` / `+0x7B2E` / `+0x7C40`, gfx 0x80C5).
3. Buff-expiry event handlers (0x1E-0x24), RAISE DEAD / TELEPORT / CREATE FOOD and the other code-read spells.
4. The real wall-clock region (PAL or NTSC) of the shipped disk; the weight term of cooldown / step cost.
5. The `A4+0x1A26` branches in the pursue routine (`+0x95F7E`, `+0x9642C`, `+0x9653C`).

## 11. Pass 4 (2026-11-23): sim wired to the verified chain, expiry events, Ram-boss stage machine, remake spec completion

Evidence labels as before (**harness**, **code**, **hyp**, **open**). New harness pieces: `oracle_spell.c` gains `G start stop` (run a mid-function range, with `D n v` / `A n v` register presets) so a piece of a big function can be diffed without a call frame; `make_vectors_events.py` / `vectors_events.json.gz`, `make_vectors_boss.py` / `vectors_boss.json.gz`; TS in `rules-spell.ts` (`applyExpiry`, `A4Mem`) and the new `rules-boss.ts`. No protection data was read or recorded.

| Rule | Routine (S_1) | Parity | Null control |
|---|---|---|---|
| Buff-expiry events 0x1E, 0x1F, 0x20, 0x21, 0x23, 0x24, 0x25 (char bytes, counters, global words, redraw flags) | dispatch chain +0x1F34, handlers +0x1968..+0x1F2C | 600 / 600 | dropping the `a2 == 0` gate on the AC subtraction: > 10 disagree |
| Ram-boss item effects PROTECTOR / SOULFREEZER / VORTEX (stage, resistance bytes, alert byte, cleared byte, hook call sequence incl. due tick) | +0x78DA, +0x79C2, +0x7B2E | 900 / 900 | starting one stage later: > 100 disagree |
| Movement and spell sets (unchanged from §10) | | same as the §10 table | |

### 11.1 Combat sim, current scope (`tools/blackcrypt/combat-sim.ts`, `combat-sim.test.ts`, 23 tests)
The sim keeps its own state as the truth and mirrors it into a `MoveWorld` (the object-record layout the 68k routines use: P record `0x14` bytes at id `1 + 2i`, S record at `2 + 2i`, cell chains, wall bits) before each harnessed call and reads it back after. The map is shifted by 8 so that its border stays inside the scan window; border cells carry wall bits, blocked squares are pillars (type 0x17, state 0), anti-magic squares set cell bit 30.
* **Monsters** run the real chain: every 16 ticks `activationScan` (**H**), an act event runs the behaviour VM (**H**) whose calls are `pursue`, `approach`, `wander` and `monsterAct` (**H**: path search, facing, mover, stacking, melee, fire / ice bolts, hold, special calls), the type-10 flee step asks the real pathfinder (**H**), results reschedule at `tick + delay`. The VM and the routines exchange `S.b0E` / `S.vars` / hp live (`VmOnCall` now receives the VM state and may return changed fields). Same-gfx monsters share a square in corners. Player swings use the real target pick `pickSquareTargets` (centre first, else the two near corners).
* **Consequence found while wiring (activation window, H).** A monster further than 3 squares (square window, +-3 in x and y) from the party is never touched by the scan, so it stays asleep, not merely idle; inside the window a path shorter than 5 wakes it, otherwise it is parked in type 10 (guards, type 1, stay put). A remake must not walk monsters towards a distant party.
* **Party spells**: `memorise` (`memoriseClick`), per-tick `rechargeTick`, `cast` (rays and the 20 simple spells through `castSpell`; DISMISS / BINDING via `castFacing`, BINDING's +200 reschedule; REFRESH via `castRefresh`), antimagic squares, slot shift after a spent cast (`+0x4876`: later slots move down, **C**), buff expiry events through `applyExpiry` (**H**), `plotItem` for PROTECTOR / SOULFREEZER / VORTEX (**H**), boss hold at 49 hp and the boss-act stage reset (**H** / **C**).
* **Held party.** A hold bolt calls `+0x58FA` with 18: it adds `n` to the word `A4+0x1756` (**C**), which the tick handler decrements by one per tick; while it is non-zero party input is ignored (§10.6, **C**), the effect also clears `A4+0x1E80 / 0x1E82`, prints a message and sets a redraw flag. The sim blocks all commands while held.
* **Tests** (null controls in brackets): determinism and seed divergence; composition (first act equals `monsterMelee` on the same stream); XP and level-ups; vitals cadence; game over; AC [high AC gives fewer hits]; a wall between monster and party parks the monster [same map without the wall: it hits]; activation window and 16-tick scan; fire-bolt caster hits from range [no spells: no hits]; hold bolt blocks commands then expires; corner stacking and target order; free rays and kill XP; memorise / recharge timing (resting runs it faster); HEAL spends the slot and shifts the rest [empty slot: no heal]; antimagic fizzles and still spends; SHIELD AC rises and the expiry event restores it; ray from a slot [empty slot: no damage]; whole-run determinism with monsters, spells and recharge; the Ram-boss sequence [without PROTECTOR the later steps do nothing], PROTECTOR expiry resets the stage, the frozen boss act resets stages 3-4.
* **Still not in the sim**: possession and flesh-to-stone are logged but not applied (`monsterPossessStone` is harness-verified in `rules-spell.ts`), no doors, items, loot drops, generators, inventory weight, the remaining 9 spells, FORCEHAMMER, monster `TELEPORT` (VM op 0x0A; the VM harness covers the op, but the position change it asks for is an event argument whose consumer is not decoded).

### 11.2 Buff-expiry events (**harness**, `applyExpiry`)
Event node: 12 bytes at `A4+0x1036 + 12*i`: due long, `+4` type, `+5` a1, `+6` a2, `+7` a3, `+8` a4, `+9` next index (0x96 = end), `+0xA` word. Fields: a1 = character, a2 = stat index, a3 = magnitude.
* **0x1E AC buff** (SHIELD / PROTECTION / ETHEREAL / SHADOW): `char[0x82 + a2] -= 1` (byte, wraps, no floor); only when `a2 == 0` also `char[0x62] = (int8)char[0x62] - a3`. **0x1F stat buff** (STRENGTH): `char[0x64 + a2] -= a3`, `char[0x78 + a2] -= 1`. **0x20 compass**: word `A4+0x1E28 -= 1`. **0x21 wizard sight**: each living character (hp > 0) with `+0x85 != 0` loses 1 there and word `A4+0x1E2A -= 1`. **0x23 detect trap**: same with `+0x84` and `A4+0x1E2C`. **0x24 haste**: word `A4+0x1E2E -= 1`. **0x25 PROTECTOR**: every character with signed `+0x69 >= 75` loses 75; then `A4+0x1A1E = 1`. Redraw flags (`A4+0x174C / 0x174D / 0x1748`) follow the screen-mode word `A4+0x174A`; they are UI only.
* The pass-3 spell harness already produced the matching counters (`+0x82`, `+0x78`, `+0x85`, `+0x84` per character), so a cast and its expiry now close the loop (the sim test SHIELD checks AC goes back).
* Event 0x22 (type 34) is not a buff: it looks up a type-0x10 structure at (a2, a1) and resets its state words (mechanism timer, **C**, not decoded further).

### 11.3 Ram-boss stage machine (**harness** for PROTECTOR / SOULFREEZER / VORTEX, **code** for FORCEHAMMER; `rules-boss.ts`)
`A4+0x1A1E` is the stage; the boss is the monster with gfx 0x80C5. Item effect words 0x8D-0x8F are the shipped plot items PROTECTOR (map 8), SOULFREEZER (map 5), VORTEX (map 7), FORCEHAMMER (map 10).
1. **0 -> 1** (monster-death routine `+0x7F2E`, **H** through the ray harness, **C** for melee): the boss never dies below 50 hp; its hp is set to 49 and the stage becomes 1 if it was 0.
2. **PROTECTOR** (`+0x78DA`): needs stage != 0. Every living character whose *signed* resistance byte is below 75 gets +75 (byte add: a start value of 53 or more wraps to a negative resistance, so those characters then resist nothing and the expiry never restores them, a game quirk). Stage 1 becomes 2. Pending type-0x25 events are cancelled and a new one is scheduled at `tick + 200`; its handler (§11.2) removes 75 and sets the stage to 1 **whatever it was**.
3. **SOULFREEZER** (`+0x79C2`): needs stage 2, no wall on the party square towards the facing, and the boss as first target of the front square (`+0xB308`). Stage 3; boss alert byte `S+0x12` += 1; the boss's pending events are cancelled (`+0xB25A`) and an act event is scheduled at `tick + 200`; a non-zero `S+0x0A` is cleared (palette call).
4. **VORTEX** (`+0x7B2E`): needs stage 3, same facing / target test; stage 4; alert += 1.
5. **FORCEHAMMER** (`+0x7C40`, **code**): needs stage 4 and the same test; plays an animation, removes the boss from its square and frees its records, clears the state word (`+0xA`) of the structure that `lookup(x = 0x0C, y = 0x11, type 0x12)` returns, sets stage 5 and runs the ending text.
6. **Reset** (`+0xAB5E`, in the behaviour VM entry): whenever the boss's VM runs while the stage is 3 or more it becomes 2. SOULFREEZER moves the boss's next act 200 ticks out, so SOULFREEZER, VORTEX and FORCEHAMMER must all be used within 200 ticks, and PROTECTOR's own 200-tick expiry (stage -> 1) must not fire first, i.e. all three within PROTECTOR's window.
Rendering side (stage 4: `A4+0x1A20` frame counter advances on the tick for the boss sprite, `+0x2718`, `+0x12A0`) is cosmetic.

### 11.4 Tie order of equal-due events (**code**)
`ScheduleEvent +0x5EA` keeps one list sorted by due time (free list head `A4+0x173E`, active head `A4+0x173F`, 150 nodes, 0x96 = none): it walks the list while `node.due <= new.due` and inserts after the last such node, so **equal due times run in insertion order** (first scheduled, first run). The tick handler pops while `head.due == tick`; events scheduled for the current tick during the pass run in the same pass (the sim does the same). Node exhaustion at 150 live events is not modelled.

### 11.5 PAL or NTSC (**code**, plus emulator-state evidence)
The disk image (`Black Crypt (1992)(Electronic Arts)(Disk 1 of 3)[cp manual code].adf`) carries no region field and none of the executables contains a PAL / NTSC string or a hard-coded refresh: the tick reload is computed from `ExecBase VBlankFrequency` at run time (§10.1), so the tick is **8 vblanks (160 ms) on a 50 Hz machine and 10 vblanks (166.7 ms) on a 60 Hz machine**; both are right. The emulator savestates in `data/blackcrypt/` (parsed statically, no emulation) hold `VBlankFrequency = 60` and `PowerSupplyFrequency = 60` at capture time, i.e. the captured sessions ran NTSC. A remake should expose the region as a setting; defaulting to PAL (160 ms) is a **hyp** (it is the native 50 Hz figure; nothing in the disk prefers it).

### 11.6 Door open (`+0x9056`, **code**) and the monster door rules
Arguments (x, y). It looks up the type-0x11 structure at (x, y) (lookup helper at S_1 `+0x27D28`), sets the structure word `+0xE` to **1**, redraws and calls the UI / sound helper `+0x4AE` (door sound / animation). The enter test (§10.3) then treats the door as passable for the monsters that may use it (`+0xE == 2` stays locked and blocks; `+0xE == 0` returns 2 = open it, for monsters with `b6` bit 0). It does not touch the door's byte `+0xF` (open bit 0), which the mode-1 pathfinder test reads, so a door opened by a monster is passable for later searches only because of `b6` bit 0 (monsters without it never route through a closed door, **C**).

### 11.7 The `A4+0x1A26` branches (**code**)
`A4+0x1A26` is the party's modal-panel state (0 none, 1 / 2 / 3 = three panels; set by the screen routines at S_1 `+0x15F2A`, `+0x1605x`, `+0x164DC` and tested by the input code `+0x1544`, `+0x18D6`, `+0xD6F4`...). The three `jsr` targets named in §10.9 (absolute `0x95F7E`, `0x9642C`, `0x9653C` = S_1 `+0x15F26`, `+0x163D4`, `+0x164E4`) are the **close-panel routines** run at `+0xA08A` after a monster has acted: a monster act closes whichever modal panel is open. No effect on combat numbers; a remake should close open modal panels (inventory / pick-up) when a monster acts on the party.

### 11.8 Hold effect (`+0x58FA`, **code**) and the generator half of `+0xB614`
Hold: §11.1. The generator-structure half of `+0xB614` (type 0x2E: spawn when count > 0, cooldown 30 + rand(30) ticks, range <= limit; Appendix B e) was **not harnessed** in pass 4: **open**; the code summary in Appendix B(e) stays **code** grade.

### 11.9 Housekeeping
Vector sets: §6 (build-time generation, small committed subsets, 91 tests in `tools/blackcrypt` pass on both the subsets and the full sets). `rules-tables.json` gains `spellBook` (page heads, next-page words, per-spell next / level, recharge) which the sim and the spell tests read; `rules_oracle/spellbook.json` is its 0.5 KB test fixture.

### 11.10 Remake-ready combat spec: what is implementable, graded
| System | Grade | Where (spec + TS) |
|---|---|---|
| Clock, tick order, event queue, tie order | H arithmetic, C wiring / ordering | §9.1, §10.1, §10.2, §11.4; `combat-sim.ts` |
| Character record, creation, level-up, XP | H / C | §1, §8.9, §9.2; `rules.ts` |
| Player melee, weapon table, immunities, costs, cooldown | H (formula) / C (costs; weight term O) | §2.2, §9.3; `rules.ts` |
| Monster activation (window, path < 5, type-10 parking) | H | §10.3, §11.1; `rules-move.ts` |
| Monster behaviour VM, 12 scripts | H | §8.3; `rules-monster.ts` |
| Pathfinder, facing, mover, stacking, enter test, door rules | H (door open routine C) | §10.3, §11.6; `rules-move.ts` |
| Monster melee, bolts, hold, poison / disease, target pick | H | §8.4, §10.3; `rules-move.ts`, `rules-monster.ts` |
| Possession / flesh-to-stone | H (functions), not in the sim | §10.5; `rules-spell.ts` |
| Damage, death, XP award, vitals, hunger, poison | C / H | §9.5, §9.6, §8.5, §8.6 |
| Spells: memorise, recharge, rays (26), heals / cures / buffs (20), DISMISS / BINDING / REFRESH, antimagic | H | §10.4; `rules-spell.ts` |
| Buff expiry (7 event types) | H | §11.2; `applyExpiry` |
| Ram-boss stages 0-4 | H, stage 5 C | §11.3; `rules-boss.ts` |
| Held party | C | §10.6, §11.1 |
| 9 remaining spells, recast cancel, generators, doors in the sim, loot, weight | C / O | §11.11 |

### 11.11 What is still not harness-verified, and the smallest next steps
* **Code only (C)**: DamageCharacter and AdjustVitals (the sim's own copies), swing cooldown and per-step costs (formula read, weight term **O**), slot shift after a spent cast, the hold counter, door open `+0x9056`, FORCEHAMMER, the 9 spells (RAISE DEAD `+0x5CFA`, TELEPORT, CREATE FOOD, REVEAL TRUTH, REMOVE GLYPH, DISPEL MAGIC, REMOVE TRAP, CREATE WALL, READ RUNE), the recast-cancels-old-buff path (`+0x49B4`), event 0x22 and the 0x28 / 0x29 handlers, item effects other than 0x8D-0x8F, the click whitelist while held, the generator structures.
* **Open (O)**: generator half of `+0xB614`; the weight term (`weight/23` in the swing cooldown and the per-step cost: needs the inventory weight routine); what the monster VM `TELEPORT` op's event argument moves; possession / stone effects applied in the sim; node-pool exhaustion.
* **Hyp (h)**: PAL as the remake default; the uninitialised ray-mode selector in `+0x9D28` (§10.3).
* **Smallest next steps**: (1) harness the nine code-read spells with the new `G` token: each is a case of the dispatcher `+0x7044` the spell harness already drives, so it needs only world pokes and peeks per spell, 1-2 hours each for the five that touch only party state (CREATE FOOD, REVEAL TRUTH, REMOVE TRAP, READ RUNE, DISPEL MAGIC) and a little more for TELEPORT / CREATE WALL / REMOVE GLYPH / RAISE DEAD (object creation); (2) harness `+0x9056` and `+0x7C40` with the same `G` / hook setup as the boss fixture; (3) the weight routine and the swing-cooldown event 0x14 / 0x15 handler; (4) `+0xB614` generator half, with the activation-scan harness as the template.

## Appendix A — Spells (from the spells analysis; all offsets S_1)

Evidence grades: **code** = read directly from the disassembly (S_1 offset given; Ghidra fn address = same number, 0x-prefixed 8 digits); **hyp** = inference; **open** = not derived (smallest next step given).
Absolute `jsr 0xXXXXX.l` -> S_1 offset = XXXXX-0x80058. Helpers: +0x268CC random(n)=0..n-1 (16-bit rnd % n), +0x268BA random8(n) (8-bit rnd % n), +0x286C0 mul32, +0x287EC signed div32, +0x5EA ScheduleEvent, +0x4960/+0x4876 spell fail/spend, +0x49B4 FindEvent+cancel.

### A. 1. Model: memorised charges, no mana  (code)
* **No spell points, no failure roll.** Casting uses a *memorised slot*: the char record holds 5 spell-id bytes at **char+0x49..+0x4D** (0xFF = empty). `CastSpell(slot)` +0x07044: id = char[+0x49+slot]; jump table (60 words @ +0x07822, base +0x078AC; `CMPI.W #$3C`).
* Return protocol of every handler (checked at +0x078AE): `>0` = success -> `+0x04876` spends the slot (shifts slots down, last = 0xFF, redraw); `<0` (-2 = cancelled target pick, -1 = blocked) -> no spend (`+0x04960`); `0` = handler already spent it (READ RUNE).
* Preconditions (+0x070CA..): square byte flag **0x40** (spell-fail / antimagic square, = bcdfs terrain nibble 4) -> "SPELL FAILED" (S_1 0x1D39E) **and the charge is spent** (returns 1). Fire-style rays (pre-effect arg 0x67) additionally fizzle with the same message (charge spent) if the square flag **0x80** (water) is set and A4+0x1E5C != 3 (+0x06DFA; meaning of 0x1E5C==3 open). Pre-effect 0x66 = screen-shake variant (QUAKE, +0x06DDE).
* **Caster values** (+0x070A0..+0x070D8): `D4 = level(+0x5E) + (signed)byte(+0x6A)` (effective caster level; +0x6A bonus source open); `D5 = D4>3 ? 2*D4-4 : 2`; `D3 = T1[stat]` where T1 = S_2+0x2E4 (31 words: -7,-6,-5,-4,-3,-3,-2,-2,-1,-1,0,0,0,0,0,0,1,1,2,3,4,4,5,5,6,7,7,7,7,7,7), stat byte = char+0x65 if class word is 1 or 3, else char+0x66 (class-name<->word mapping not re-verified; FIGHTER,CLERIC,MAGIC USER,DRUID string order suggests 1=Cleric,3=Druid use +0x65, 2=MU uses +0x66; **hyp**: +0x65=WIS, +0x66=INT, conflicts with the labels in data-structure.md's class table - open).
* **Spell table** S_2+0x12, 60 x 8 bytes (note: starts at +0x12, not +0x0E): `[name char* (S_1 abs, -0x80058)][word recharge timer][byte spellLevel][byte nextInPage (0xFF end)]`. Level 1..10; names at S_1 0x1A7FA. Duplicated names: LIGHT (1,32), DISPEL MAGIC (22,24), CURE POISON (5,54) - separate ids sharing a handler.
* **Spell books** (code): spells are grouped 4 per **page** via the nextInPage chain; 15 page records of 6 bytes at S_2+0x1F2 `[byte pageNo 1..5][byte owned flag][word headSpell][word nextPage(0xFF end)]` = 3 books x 5 pages: book A pages 0-4 (HEALING.. RAISE DEAD.. CHANT OF ORLIN.. RUNE OF PAIN.. SUSTENANCE..; cleric-like), book B pages 5-9 (WIZARD SIGHT.. DEATH STORM.. STRENGTH.. CREATE WALL.. HASTE..; mage-like), book C pages 10-14 (DISPEL MAGIC.. STONE FIRE.. LIGHT.. PESTILENCE.. SHADOW SHIELD..; druid-like). Per-char: +0x45 book selector (cycled mod 3, +0xF1CE), +0x46 first page of char's chain, +0x47 current page, +0x48 page counter (writers: char creation in bcdfp / book UI +0xF548; not re-traced). Only page 0 of each book starts with flag=1.
* **Learning pages**: a *page item* (object type 0x0C, rec word+0xC = page no, rec word+0xE = party slot allowed) used in the book UI: if word+0xE != current char -> "CANNOT USE THIS SPELLBOOK" (S_1 0x1D644, +0x0F194) else `+0x0F3A0` moves that page into the first unowned chain slot and sets its flag=1 (swaps 6-byte records). (code)
* **Memorising** (book UI click handler +0x0F548, click row 0..3 = spell in current page): allowed iff spell recharge timer (rec+4)==0, spellLevel <= char level(+0x5E), free slot among 5. Then timer is set (global, shared by all chars): `R = (L-1)*540 + 1260` (0x21C, 0x4EC); if `L < level + (signed)char[+0x6B]` : `R -= (level + b6B - L)*180`; `R = max(R, 360)`; `R += R*T2[stat]/100` (signed div; T2 = S_2+0x322: 35,30,25,25,20,20,15,10,10,5,0,0,0,0,0,0,-5,-5,-10,-10,-15,-15,-20,-20,-25,-30,...; stat = char+0x66 if class word==2 else +0x65); clamp [60, 32767]; stored to spell rec+4; slot byte = spell id. (code, +0x0F670..+0x0F7E6)
* **Recharge tick**: +0x010D2..+0x011D6 (in tick handler +0x8B2, every call when tick&15!=0 and on its normal path): for each of 15 pages (owned or not) walks the spells, `rec+4 -= 1` if nonzero (twice when A4+0x1746 haste flag matches +0x1A07[...], +0x1138..+0x116C), skipping the page currently shown for the active char unless A4+0x1A18!=0; clamps at 0 and redraws the book if it hits 0. **Tick period in real time: open** (find the caller cadence of +0x8B2, called from +0xD73C/+0x10AAE/+0x10E94/+0x16080).
* **Status bytes (corrected vs NOTES.md)**: char+0x9A = POISONED, +0x97 = DISEASED (status text +0x156D8/+0x15716), +0x52 food (<2000 'HUNGRY'), +0x54 water (<2000 'THIRSTY'), +0x56 energy (<1000 'TIRED'); NOT gold. +0x62 AC (+0x63 base), +0x64..+0x68 current stats, +0x6E.. max stats, +0x69 magic-resist % (signed byte, used by monster spell save).
* **Buff event types** (tick handler +0x8B2 .. +0xAA0, `ScheduleEvent(type, tick, a1=char, a2, a3, a4)`; slot: +4 type +5 a1 +6 a2 +7 a3): 0x1E = AC buff: char+0x82 counter--, if a2==0 char+0x62 -= a3; 0x1F = STR buff: char+0x64 -= a3, char+0x78 counter--; 0x20 = compass off (A4+0x1E28--); 0x21 = wizard sight (char+0x85--, A4+0x1E2A--); 0x22 = remove created wall; 0x23 = detect traps (char+0x84--, A4+0x1E2C--); 0x24 = haste (A4+0x1E2E--); 0x25 = char+0x69 -= 0x4B if >0x4A (cast site +0x079B0 'now+200', routine +0x07904?? open). Durations are ticks (tick counter A4+0x1750).

### A. 2. Ray damage  (CastSpellRay +0x06D9A, code)
`args @8 magnitude, @A damage, @C base effect, @E pre-effect, @10 range`. Targets: `+0x0435C` ray march along facing up to `range` squares, `+0x0B308` returns up to 2 objects on the hit square. For each (second skipped if same record) `total = magnitude + random(damage+1)` (+0x06FD4..) is subtracted from monster HP (rec+8, word); sum kept in A4+0x1E84; killed -> `+0x07ED0` (XP: each living char's XP long (+0xA0) += rec word+6 + two random() terms (args lost), then level check +0x17D2A). Hit filters: gfx 0x80B2 never hurt; 0x80B1 only if the caster's equipped item word (char+0x36) has gfx 0xC0 (**hyp**, +0x06F56); pre-effect 0x64 only hurts gfx 0x80BE, 0x65 only 0x80C5 (used by item effects 0x8C only). LIFESTEALER (+0x076C4): after the ray, A4+0x1E84 = total*3/10 is *added to caster HP* (cap maxHP).

### A. 3. Per-spell table
Columns: idx | name | spellLevel (S_2 table) | book+page | effect | ray formula | grade | jump-table handler / sub-routine. D3,D4,D5 as in section 1.

| idx | name | lvl | page | effect | formula | grade | S_1 addr |
|---|---|---|---|---|---|---|---|
| 0 | POISON CLOUD | 2 | A0 | Per target hit (<=2 monsters on ray target square): dmg = (D3+8) + random(8+1); monster HP(rec+8)-=dmg | mag=D3+8, +rand(8+1), range 3, effect 71, pre 0x1 | code | 0x73e4 |
| 1 | LIGHT | 1 | A0 | Light counter A4+0x1754 += 120 (decremented 1/tick by tick handler +0x8E4; 0 -> redraw flag) |  | code | 0x73c6 / 0x58c6 |
| 2 | REVEAL TRUTH | 2 | A0 | Destroys 'illusion' items (obj type 0x18, word+0xE==1) held in char slots +0x1a/+0x1c of every living char |  | code (item semantics hyp) | 0x7818 / 0x6c92 |
| 3 | HEALING I | 1 | A0 | HP += 2<<n + random(16*n), n=1 (HEALING I); capped at maxHP(+0x50); single target (click) |  | code | 0x71ac / 0x5070 |
| 4 | RAISE DEAD | 6 | A1 | Needs corpse item (obj type 0x26, rec word+0xC<=3 = party slot) in hand slot +0x1c or +0x1a of a living char; picks target; calls revive 5c06: HP=maxHP/10+1, memorised sl |  | code | 0x73d0 / 0x5cfa |
| 5 | CURE POISON | 4 | A1 | Clears poison byte char+0x9a of one target |  | code | 0x720a / 0x52d6 |
| 6 | CURE DISEASE | 3 | A1 | Clears disease byte char+0x97 of one target |  | code | 0x7214 / 0x540e |
| 7 | RESTORE | 7 | A1 | HP = maxHP of one target |  | code | 0x7666 / 0x51de |
| 8 | CHANT OF ORLIN | 2 | A2 | Per target hit (<=2 monsters on ray target square): dmg = (D5+D3) + random(6+1); monster HP(rec+8)-=dmg | mag=D5+D3, +rand(6+1), range 3, effect 21, pre 0x1 | code | 0x7268 |
| 9 | HEALING II | 5 | A2 | HP += 2<<n + random(16*n), n=2 (HEALING II) = 8+rand(32) |  | code | 0x71ac / 0x5070 |
| 10 | CREATE FOOD | 3 | A2 | Creates ((D4+2)/3)*2 food objects (type 0x15, name idx 0x8005, 3 refs) on party square |  | code (obj fields partly decoded) | 0x7670 / 0x5952 |
| 11 | GODS FURY | 9 | A2 | Per target hit (<=2 monsters on ray target square): dmg = (D3+20) + random(60+1); monster HP(rec+8)-=dmg | mag=D3+20, +rand(60+1), range 3, effect 86, pre 0x1 | code | 0x7408 |
| 12 | WIZARD SIGHT | 1 | B5 | Wizard Sight: +1 to each living char's counter +0x85 and party counter A4+0x1e2a; schedules event 0x21 at now+3600 (0xE10) that decrements both; enables teleport + automa |  | code | 0x739a / 0x5b10 |
| 13 | COMPASS | 2 | B5 | Party counter A4+0x1e28++; event 0x20 at now+3600 decrements; compass shown while >0 |  | code | 0x722e / 0x5868 |
| 14 | FIREBALL | 3 | B5 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(6+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(6+1), range 3, effect 15, pre 0x67 | code | 0x728c |
| 15 | SHIELD | 1 | B5 | party-member (click) char+0x62 += n, n = (D4<=5 ? 1 : (D4-4)/2+1); event 0x1E at now+1800 (0x708), a2=0,a3=n reverts; recast cancels old (49b4/b25a) before applying |  | code | 0x7250 / 0x54e2 |
| 16 | DEATH STORM | 9 | B6 | Per target hit (<=2 monsters on ray target square): dmg = (D3+10) + random(90+1); monster HP(rec+8)-=dmg | mag=D3+10, +rand(90+1), range 3, effect 44, pre 0x1 | code | 0x742e |
| 17 | LIFESTEALER | 7 | B6 | Per target hit (<=2 monsters on ray target square): dmg = (D3+8) + random(24+1); monster HP(rec+8)-=dmg; caster HP += 3*total/10 (capped) | mag=D3+8, +rand(24+1), range 3, effect 65, pre 0x1 | code | 0x76c4 |
| 18 | TELEPORT | 4 | B6 | Needs A4+0x1e2a!=0 (Wizard Sight) else 'NEED WIZARD SIGHT'; map-pick UI (3b94); dest must be same level, flag 0xff00000==0xf00000, and no blocking object in chain (type 0 |  | code | 0x7682 / 0x6af0 |
| 19 | DETECT TRAP | 2 | B6 | Detect Traps: event 0x23 at now+D4*360 (0x168); per living char counter +0x84++, party A4+0x1e2c += 1; 0x23 handler decrements; trap markers (effect 89) drawn while party |  | code | 0x76a0 / 0x641e |
| 20 | STRENGTH | 2 | B7 | char+0x64 += 2 (one target); event 0x1F at now+1800 reverts (a3=2); recast cancels/reverts old first |  | code | 0x73a4 / 0x5710 |
| 21 | REMOVE GLYPH | 2 | B7 | Facing square (needs no wall in facing dir): first object with rec word+0xC==3 (glyph) and rec word+0xE<=D4 is deleted; effect 0 |  | code | 0x71f8 / 0x4e0a |
| 22 | DISPEL MAGIC | 2 | B7 | Facing square: object with rec word+0xC==2 (magic field) and strength rec word+0xE<=D4 deleted, then whole stack of such fields |  | code | 0x71e6 / 0x4c46 |
| 23 | FREEZE | 2 | B7 | Per target hit (<=2 monsters on ray target square): dmg = (D3+4) + random(8+1); monster HP(rec+8)-=dmg | mag=D3+4, +rand(8+1), range 3, effect 18, pre 0x1 | code | 0x72b0 |
| 24 | DISPEL MAGIC | 2 | C10 | same as 22 |  | code | 0x71e6 / 0x4c46 |
| 25 | CHAOS | 1 | C10 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(6+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(6+1), range 3, effect 83, pre 0x1 | code | 0x7454 |
| 26 | READ RUNE | 1 | C10 | If byte A4-0x779a==0x6a (looking at a rune) opens rune reader 95dda and spends the spell itself; else returns 1 |  | code (partial) | 0x77ac / 0x655c |
| 27 | PROTECTION | 1 | C10 | same routine/formula as SHIELD (15) |  | code | 0x7238 / 0x54e2 |
| 28 | STONE FIRE | 2 | C11 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(6+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(6+1), range 3, effect 24, pre 0x67 | code | 0x72d4 |
| 29 | FIRE WIND | 3 | C11 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(10+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(10+1), range 3, effect 59, pre 0x67 | code | 0x7478 |
| 30 | FIRE VORTEX | 5 | C11 | Per target hit (<=2 monsters on ray target square): dmg = (D3+5) + random(45+1); monster HP(rec+8)-=dmg | mag=D3+5, +rand(45+1), range 3, effect 56, pre 0x67 | code | 0x749c |
| 31 | FIRE MAELSTROM | 10 | C11 | Per target hit (<=2 monsters on ray target square): dmg = (D3+10) + random(100+1); monster HP(rec+8)-=dmg | mag=D3+10, +rand(100+1), range 3, effect 53, pre 0x67 | code | 0x74c0 |
| 32 | LIGHT | 1 | C12 | same as LIGHT (1) |  | code | 0x73c6 / 0x58c6 |
| 33 | SWARM | 2 | C12 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(6+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(6+1), range 1, effect 27, pre 0x67 | code | 0x731c |
| 34 | DISMISS | 8 | C12 | Facing-square monsters (2 max, not gfx 0x80B2/0x80BE/0x80C5): t=clamp(rec[+2] + 7 - ((level-1)>>1), 2, 20); if random(20)+1 >= t monster HP(rec+8)=0 and dies (7ed0 awards |  | code | 0x780e / 0x6902 |
| 35 | DISRUPT | 9 | C12 | Per target hit (<=2 monsters on ray target square): dmg = (10*D4+D3+20) + random(50+1); monster HP(rec+8)-=dmg | mag=10*D4+D3+20, +rand(50+1), range 3, effect 50, pre 0x1 | code | 0x74e6 |
| 36 | RUNE OF PAIN | 2 | A3 | Per target hit (<=2 monsters on ray target square): dmg = (D3+4) + random(8+1); monster HP(rec+8)-=dmg | mag=D3+4, +rand(8+1), range 3, effect 77, pre 0x1 | code | 0x7514 |
| 37 | RUNE OF DEATH | 9 | A3 | Per target hit (<=2 monsters on ray target square): dmg = (D3+20) + random(80+1); monster HP(rec+8)-=dmg | mag=D3+20, +rand(80+1), range 3, effect 74, pre 0x1 | code | 0x7538 |
| 38 | VORPAL AIR | 5 | A3 | Per target hit (<=2 monsters on ray target square): dmg = (D3+10) + random(15+1); monster HP(rec+8)-=dmg | mag=D3+10, +rand(15+1), range 3, effect 80, pre 0x1 | code | 0x755e |
| 39 | DIETY STRIKE | 7 | A3 | Per target hit (<=2 monsters on ray target square): dmg = (D3+10) + random(40+1); monster HP(rec+8)-=dmg | mag=D3+10, +rand(40+1), range 3, effect 47, pre 0x1 | code | 0x7584 |
| 40 | SUSTENANCE | 4 | A4 | All living chars: food +0x52 and water +0x54 = 5000 |  | code | 0x768c / 0x5a6c |
| 41 | REMOVE TRAP | 2 | A4 | Facing square: first object (a7d80) with rec word+0xC==1 deleted (needs no wall in facing dir); effect 29 |  | code (object type unclear) | 0x73da / 0x60be |
| 42 | POISON PURGE | 5 | A4 | Clears poison byte +0x9a on all living chars |  | code | 0x7696 / 0x53aa |
| 43 | BINDING | 6 | A4 | Facing square, up to 2 monsters: resist%=clamp((rec.HP/10 - level)*20+50,0,100); if random(100) > resist: cancel all its events (b25a) and schedule type-1 event at now+20 |  | code | 0x721e / 0x4a4e |
| 44 | CREATE WALL | 4 | B8 | Needs facing open and square empty (low 12 bits==0): creates obj type 1 (rec byte+5=0x10 structure, word+0xC=1, +0xE=1, +0xA=0) = wall; event 0x22 at now+D4*180 (0xB4) re |  | code | 0x73b4 / 0x4f18 |
| 45 | ETHEREAL SHIELD | 5 | B8 | Ethereal Shield: party-wide, args base=2,minLevel=6: n = base + (L>=min ? (L+1-min)>>1 : 0) (L=caster level byte +0x5e); every living char AC(+0x62) += n, event 0x1E at n |  | code | 0x77c0 / 0x66e2 |
| 46 | REFRESH | 7 | B8 | Resets recharge timer (S_2 spell rec +4) to 0 for every spell with spell-level<5 on every page of caster's book whose page flag (page rec +1) is set |  | code | 0x77b6 / 0x660c |
| 47 | LIGHTNING FIELD | 5 | B8 | Per target hit (<=2 monsters on ray target square): dmg = (D3+5) + random(45+1); monster HP(rec+8)-=dmg | mag=D3+5, +rand(45+1), range 3, effect 12, pre 0x1 | code | 0x72f8 |
| 48 | HASTE | 3 | B9 | Party counter A4+0x1e2e++; event 0x24 at now+D4*120 (0x78); while !=0, char action/attack event delays (types 0x14/0x15) become (d>>1)+1 |  | code | 0x76b2 / 0x6518 |
| 49 | MIND STRIKE | 4 | B9 | Per target hit (<=2 monsters on ray target square): dmg = (D3+D5) + random(18+1); monster HP(rec+8)-=dmg | mag=D3+D5, +rand(18+1), range 3, effect 68, pre 0x1 | code | 0x75aa |
| 50 | DEATH | 8 | B9 | Per target hit (<=2 monsters on ray target square): dmg = (D3+50) + random(20+1); monster HP(rec+8)-=dmg | mag=D3+50, +rand(20+1), range 3, effect 41, pre 0x1 | code | 0x75ce |
| 51 | DISPEL ILLUSION | 3 | B9 | same as REVEAL TRUTH (2) |  | code | 0x7818 / 0x6c92 |
| 52 | PESTILENCE | 4 | C13 | Per target hit (<=2 monsters on ray target square): dmg = (D4<7 ? D3+8 : 3*D4+D3-10) + random(8+1); monster HP(rec+8)-=dmg | mag=D4<7 ? D3+8 : 3*D4+D3-10, +rand(8+1), range 1, effect 28, pre 0x67 | code | 0x7340 |
| 53 | CURE WOUNDS | 2 | C13 | same routine as HEALING I (n=1) |  | code | 0x71d0 / 0x5070 |
| 54 | CURE POISON | 4 | C13 | same as 5 |  | code | 0x720a / 0x52d6 |
| 55 | CHANT OF DOOM | 6 | C13 | Per target hit (<=2 monsters on ray target square): dmg = (D3+40) + random(0+1); monster HP(rec+8)-=dmg | mag=D3+40, +rand(0+1), range 3, effect 9, pre 0x1 | code | 0x75f4 |
| 56 | SHADOW SHIELD | 4 | C14 | Shadow Shield: args base=1,minLevel=4: n = 1 + ((L+1-4)>>1) for L>=4 |  | code | 0x77d4 / 0x66e2 |
| 57 | ICE STRIKE | 7 | C14 | Per target hit (<=2 monsters on ray target square): dmg = (D3+5) + random(70+1); monster HP(rec+8)-=dmg | mag=D3+5, +rand(70+1), range 3, effect 62, pre 0x1 | code | 0x7618 |
| 58 | BLAST OF COLD | 5 | C14 | Per target hit (<=2 monsters on ray target square): dmg = (2*D5+D3+10) + random(30+1); monster HP(rec+8)-=dmg | mag=2*D5+D3+10, +rand(30+1), range 3, effect 38, pre 0x1 | code | 0x763c |
| 59 | QUAKE | 10 | C14 | Per target hit (<=2 monsters on ray target square): dmg = (D3+10) + random(100+1); monster HP(rec+8)-=dmg | mag=D3+10, +rand(100+1), range 1, effect 38, pre 0x66 | code | 0x77e8 |

### A. 4. Monster spells (code, monster attack routine +0x09D28)
* Monster record word **+0x0C** = spell-set bit mask. If rec byte +0x07 != 0 bits 2..11 are eligible (bits 12-15 only when it is 0); at distance (|dx|+|dy|) > 1 the max bit is 11, at distance 1 up to 15 (+0x0A170..+0x0A1BC). One eligible set bit is chosen uniformly (`random(count)`, +0x0A1CA). Bit -> effect (jump table +0x0A2EE, base +0x0A31A):
  bit2..6 FIRE bolt: (min,rand,... ) d5/d4 = (2,4) (4,7) (5,11) (10,16) (20,31), PlayEffect 6, resist-flag index 0xC (char+0x8E);
  bit7..10 ICE bolt: same d5/d4 pairs, PlayEffect 7, resist index 0xB (char+0x8D);
  damage to up to two party chars chosen by `+0x096E8` (e.g. front-row by facing; selection rule open): `dmg = random(d4)+d5+max(1,monsterHP/10)`, DamageCharacter(char,dmg,kind 4,flag 1) (+0x976DE = +0x17686), skipped if char[+0x83]!=0 and random8(100)<=50, or char[+0x82+idx]!=0 (resisting), or random8(100) < char[+0x69] (magic resist %). (+0x0A3AA..+0x0A53C)
  bit11: PARTY HELD: `+0x058FA(0x12)`: A4+0x1756 += 18 ticks, rec[+7]--, string "PARTY HELD";
  bit12..15: sub-handler `+0x098A8` (target/summon style) - **open**: read +0x098A8..+0x09D24.
* gfx 0x80B7 at distance 1 forces bit 12. Monster cast cadence/chance gate (+0x09FC0..+0x0A066) uses byte +3 bits (speed) and rand: open.

### A. 5. Scroll/wand/potion item effects  (code, partial)
Item effect id = obj rec word +0xE (0x80+n, n<0x20) via dispatcher +0x12FEA ("HEAL"/"SPELL FAILED"); item uses the same routines with constant power: n=0 LIGHT(+0x58C6 via abs 0x8591E), 1 DISPEL(D4=6), 2 PESTILENCE-style ray(mag 10, dmg 8, eff 28, pre 0x67, rng 1), 3 FIREBALL ray (16,6,15,0x67,3), 4 HEALING n=1, 5 STONE FIRE ray(16,6,24,0x67,3), 6 HEALING n=2, 7 CHANT OF ORLIN ray(16,6,21,1,3), 8 FREEZE ray(4,8,18,1,3), 9 QUAKE ray(10,100,38,0x66,1), 10 SUSTENANCE (5000), 11 RAISE DEAD, 12 ray(200,1,37,pre 0x64,1) (boss-killer filter), 13-16 routines +0x7932..+0x7C98 (open), 0x16 heal rand(n)+2, 0x17 flag char+0x8C..., 0x96..0xA9 potion/effect group. Item-only routines not in the 60-spell table: +0x061B0 (MAGIC SHIELD marker event 0x1E a2=0x0D, +1800), +0x062D0 (revive/animate object, uses +0x5C06), +0x58FA (hold party).

### A. 6. Open items (smallest next step; status 2026-11-23)
1. ~~Real-time length of a tick~~ narrowed in §8.7 (hyp 0.1 s; evidence and next step there).
2. ~~Class word <-> class name, +0x65 / +0x66~~ **solved** (§8.9): Fighter 0, Cleric 1, Magic User 2, Druid 3; +0x65 WIS, +0x66 INT.
3. ~~AC sign convention~~ **solved** (§8.8, harness): higher AC is better.
4. `+0x098A8` bits 12-15: **read** (§8.4; bits 14 / 15 harness); event 0x25 and item effects 13-16: `+0x78DA` read (§8.10), the three boss-stage routines named but not decoded.
5. ~~XP formula inside +0x07ED0~~ **solved** (§8.5, harness).
6. ~~`+0x435C` ray range / pathing and `+0xB308` target selection~~ **harness** (§10.3, §10.4) (smallest step: harness `+0x435C` on a synthetic map with doors).

## Appendix B — World rules (from the world-rules analysis; static analysis, not harness-verified)

Addresses are S_1 offsets (decompressed bcdft S_1; absolute `jsr 0xXXXXX` = XXXXX-0x80058). Char record = A4+0x1758 + i*0xA8,
object records = A4-0x6E7A + unique*0x14. Grades: **code** (read from disassembly), **hyp** (inferred), **open**.
Machine-readable copy: `world.json`. No emulator/harness was run; everything here is static (asm checked, Ghidra args re-verified).
Copy-protection note: S_1 holds a manual-question table (strings around +0x1B1E6..+0x1B4F9). Not touched, no answers recorded.

Corrections to NOTES.md: status bytes are **+0x9A = POISONED** and **+0x97 = DISEASED** (HUD S_1+0x154C2 tests `tst.b 0x9a` before the POISONED string,
`0x97` before DISEASED). +0x56 is the **energy/TIRED meter** (max 10000), not gold; there is no gold.

### B. (a) Food, drink, tiredness
Counters (words in char record): **+0x52 food, +0x54 water, +0x56 energy**. Max 5000 / 5000 / 10000; floor 0. [code, AdjustVitals +0x17EEA]
Status triggers (HUD +0x154C2, signed word compare): HUNGRY food < 2000, THIRSTY water < 2000, TIRED energy < 1000, POISONED +0x9A != 0, DISEASED +0x97 != 0. [code]
- **AdjustVitals(char, dEnergy, dFood, dWater)** `+0x17EEA` (Ghidra decompile FUN_00017eea; stack order verified in asm: pushes water, food, energy, char). Skips chars with HP<=0. Adds, clamps to [0,max]. If +0x90 (sustenance counter) != 0, dFood becomes (dFood>>1)+1 (so -1/-2 cost nothing). [code]
- Per-action costs (energy, food, water) [code, call sites]:
  - each step (all 4 chars, `+0x16CC4` end): energy = -1 - (carried weight(+0xA4)>>11), food -1, water -1
  - each turn (`+0x1702A`): -1,-1,-1 each char
  - taking damage (`+0x17686`): -3,-2,-3 to the damaged char
  - melee attack (`+0x13768`): -4,-2,-1; door open/close (`+0x1110A`) and key use (`+0x16AA8`): -2,-1,-1 (active char)
  - use item (`+0x12FEA`), pick up/drop (`+0x11D04`,`+0x128F6`), two `+0x11502` actions: energy -1 only
- Tired penalty (inside AdjustVitals): crossing energy 1000 downward: STR(+0x64) and +0x68 stat each -1 (AC re-based by T1[stat+0x68]); crossing upward: +1 each; redraw `+0x170A8`. [code]
- **Eat** (item type 0x0E, held item dropped on a portrait, `+0xECF0`): refused (" IS FULL", S_1 +0x1D60F) if food > 4900 (0x1324). Else food += 2*item.word+0xE, cap 5000; item.word+0x10 (servings) -= 1, item deleted at 0. [code]
- **Drink** (type 0x05): refused if water > 4900 and effect word == 0x9E. Else UseItem (+0x12FEA): effect 0x9E: water += item.word+0x10 (cap 5000); charges byte +7 -= 1 (0xFF = infinite); potion deleted at 0 charges unless gfx==0x12 (empty flask, kept). [code]
- **Fountain / flask** (`+0xDD8E`, structure 0x1F with word+0x0E==0): clicking with held gfx 0x12 flask: flask.charges := flask.byte+0xD (max), flask.effect(+0xE) := fountain.word+0x08 (water 0x9E, or any potion effect), fountain.charges(+7) -= 1 unless 0xFF; message YOU FILL THE CONTAINER. Fountain at 0 -> sentinel 0xFF. [code; sentinel semantics per docs]
- Effect 0x8A: all living chars food=water=5000 ("Create food"/feast style). [code]
- **Starvation/regen damage**: lead (tick +0x08B2; it tests food/water <2000 at +0x1038/+0x108A and +0x10448/+0x10464). Not re-derived here. [open to lead]
- Initial counters for a new party come from bcdfp char-gen, not S_1 (S_1 +0x5C06 only floors energy to 1000 on level reset). [open: bcdfp]

### B. (b) Resting
`+0x1038E` (Ghidra FUN_0001038e). Per-char state byte A4+0x1A07+slot: 1 = may sleep, 2 = cannot, 3 = sleeping. On entry any char in state 3 whose food <= 2000 or water <= 2000 (`cmpi.w #$7D1` blt) is forced to 2. If no char can sleep: message PARTY CANNOT SLEEP (+0x1D6B0). Otherwise `$1746`=1 (some awake) or 2 (all asleep) which the tick handler's resting branch reads; clicking a portrait toggles 1<->3 ("YOU WANT TO WAKE" prompt). While resting each char's +0x62 is temporarily set to T1[stat+0x68]+6 and restored afterwards. [code; heal rate itself = lead's tick branch, open here]

### B. (c) Traps, structures, status effects
- **Pit** (MoveParty result 2, `+0x1734A`): each living char with +0x8A == 0 takes 5 + rand(n) with n = (stat+0x68 > 15 ? stat-10 : stat+5), damage type 4; party moves to the pit record's target (docs). [code]
- **Glyph** (type 0x10 sub-kind 3, `+0x4662`; rec word +0x10 = glyph type, +0x0E = m): type1 and m==0: all chars with HP>1 drop to HP 1; type1 and m!=0: dmg = 0xFFFF (random(0) returns 0), kills all chars with HP>1 (hyp: intended "death rune"); types 2/3: 5 + rand(5*m) each; type 4: poison (+0x9A++ unless +0x8B) plus rand(10)+1 (damage type 5). Each hits only chars with HP>1. [code]
- **Trap damage actions** 0x1C (fire, effect 6) / 0x1D (ice, effect 7): 5 + rand(5*v) per char with HP>1 (v = action value byte). Pressure plates/switches run action chains (`TriggerActionsAt +0xCF34`); no damage in the plate itself. [code]
- **Party held** action 0x13: `$1756 += v` ("PARTY HELD"); tick decrements it; while >0 the click handler (`+0xD6D8`) ignores action clicks except a few ids. [code, exceptions hyp]
- **Spinner/teleport/stairs**: see data-structure.md "MoveParty". Scripted teleports: action 0x15 / 0x1E.
- **Monster status attacks** (`+0x98A8`, spell flag bit n = case n): 0xC possession (target needs +0x8F==0), 0xD flesh-to-stone (needs +0x87==0, char dies, record remembers char), 0xE disease (+0x97++, dmg rand(6)+1, needs +0x88==0, rolls rand+20-T1[+0x67]>30), 0xF poison (+0x9A++, dmg rand(5)+1, needs +0x8B==0). All gated by rand vs +0x69 and, if +0x83 (magic shield) set, a 51% roll. [code, gate hyp]
- Status counters: poison +0x9A and disease +0x97 stack (++ each infliction); cured by effect 0x99/0x9A (set 0) or the spells. Per-tick damage: lead.
- Protection counters (+0x82..+0x90) table: see world.json `counter_bytes`. Icon bar (`+0xE01E`) shows slot1 +0x82 SHIELD, slot2 +0x83 (or +0x69!=0) MAGIC SHIELD, slot3 +0x84 DETECT TRAPS, slot4 +0x85, slot5 +0x86, slot6 gaze (+0x87) / POSSESSION PROTECTION (+0x8F). [code]
- Timed effects expire via ScheduleEvent type 0x1E (counter +0x82+a2 -= 1; invincibility 900 ticks, water breathing 900) and 0x1F (strength potion 1800). [code]

### B. (d) Locks and keys
Key type 0x06 matched to door lock (type 0x22) by word+0x0C; lock word+0x0E turns left must be nonzero; key consumed; else THE KEY DOES NOT FIT. Handler `+0x16AC0` (already in data-structure.md; re-read, consistent). Locked door via action opcodes only otherwise; "THE DOOR IS LOCKED" printed by `+0x1110A` when state is neither open nor closed (word+0xE == 2/3 branch). **No lockpicking** (no PICK/DISARM text, no code path). [code]

### B. (e) Random encounters / respawn
None. The only runtime monster creators: BAA6 `SpawnMonster` (clones a template monster record into a free quarter of a square; refuses and frees if the square is full) reached from (1) scripted action 0x12 and (2) the +-3 square scan `+0xB614`: a type 0x2E generator spawns when rec+0x0C>0 (count, decremented), rec+7==0 (cooldown, set to 30+rand(30), decremented per scan otherwise) and live monsters in range <= rec+0x0E; template = rec word +0x10; new monster gets AI event type 1 at now+rand(6)+1 and flag +0x13=1. Other callers of the object allocator `+0x6` are map/save loaders and the death drop `+0x175C4`. No timer- or step-driven wandering spawn exists. [code; field meanings hyp]

### B. (f) Shops
None: no BUY/SELL/PRICE/COIN strings (GOLD occurs only in key names), no currency field in the char record. [code/negative evidence]

### B. (g) Weight, light, charges, AC, class, enchantments
- **Weight**: item word+0x08 (containers 0x13/0x23: sum of +0x08 over the chained contents, `+0x11992`). Char total at +0xA4. Move/equip check `+0x126D2`: new = total + w(in) - w(out); refused if new > (signed maxSTR byte +0x6E)*1000 with message YOU WOULD BE CARRYING TOO MUCH WEIGHT. Inspect labels: <300 LIGHT, <800 MEDIUM, else HEAVY WEIGHT. Each step costs extra energy weight>>11. [code]
- **Light**: `$1754` (party light timer) +120 per LIGHT use (effect 0x80); decremented in tick (+0x8E4). On squares with map bit 29 (dark) and `$1754`==0 the view is blanked (`+0x35CC`, `+0x16F4E`, `+0x14058`). No torch item. [code]
- **Charges**: item byte +7; 0xFF infinite, decrement per use; 0 on type 0x00-0x03/0x0D/0x29 with effect >= 0x80 gives ITEM IS OUT OF CHARGES (`+0x12BE0`). Use-kind: types 0,1 melee; 2,3 melee/zap; 4 scroll; 0x0D(+0xC==2,+0xE>=0x80) and 0x29 zap; 0x24 bow; 0x25,0x28 throw. [code]
- **AC**: +0x62/+0x63 (printed in LV/AC panel). Base = T1[stat+0x68]+6 (T1 = S_2+0x2E4 table: -7..7, 0 for stat 10-15). Equipping adds the low byte of word+0x0C for types 0x07-0x0B,0x15,0x19,0x1A,0x1B,0x1C,0x2A,0x2D; removing subtracts. [code; label AC hyp-strong]
- **Slots** (S_2+0, rows x cols): row0 Boots(0x0B) Leggings(0x0A) hand hand(shield ok) Helm(0x07) Armor(0x09); row1 pack Pants(0x1C) Bracers(0x2A,2-wide) pack Shirt(0x1B); row2 pack Belt(0x19) Ring(0x15) Ring(0x15) Crown/Mask(0x2D) Amulet(0x1A). `+0x18088`,`+0xE56A`. [code]
- **Class restriction**: usable iff (item byte+4 & (1<<class)) != 0, class word at char+0: 0 Fighter, 1 Cleric, **2 Druid, 3 MU as originally written; wrong, see the correction below: 2 = Magic User, 3 = Druid** (`+0x12B8C`). > **Correction (2026-11-23):** class order is Fighter, Cleric, Magic User, Druid; item mask bits +1 / +2 / +4 / +8 in that order (§8.9). Skipped only for the two hand slots in the equip click; otherwise CANNOT WEAR ITEM. Failing use: "<name> CANNOT USE THIS ITEM". Idols (type 0x2C) and gfx 0xAA/0x1A cannot enter inventory (CANNOT PLACE ITEM IN INVENTORY). [code]
- **Enchantments (effect word +0x0E)**: 0-9 stat idx +value, 0x14-0x22 protection counters, 0x80-0x9F use-effects. Table in world.json. Effects only active while charges != 0. Weapons (types 0-3, 0x24) give +1 (not +value). Type 0x0D = slot-bound charm (word+0xC = row*10+col). Tablets (type 0x30) `+0x16502`. [code]
- **Use-effect map** 0x80-0x9F: decoded potions (0x96-0x9F), LIGHT (0x80), feast (0x8A); the remaining 0x81-0x90 call spell routines (+0x6D9A projectile with 5 params, +0x5070, +0x4C46, +0x5D52, +0x78DA..+0x7C40) - **open**: name them by matching params to spell list at S_1 +0x1A7FA.
- Magic items are blocked on squares with flag bit 6 (SPELL FAILED / anti-magic) before any effect. [code]
- Mask of True Sight: inventory row2 col4 slot gfx 0xC0 is consulted by combat code (+0xBFFE, +0x14710); -10 modifier when absent. [now harness for the weapon rule: §8.10]
- OGREBLADE "slowly drain" text: no equipped-item drain found in tick or elsewhere. [open: smallest step = search tick handler for per-tick HP loss tied to weapon gfx]

### B. Open list (status 2026-11-23)
1. ~~Use-effects 0x8D-0x90 names~~ named (§10.6).  2. ~~Stat index to name map~~ solved (§8.9).  3. ~~Ogreblade curse~~ no mechanical drain found (§8.10).  4. Counter `+0x89` unused (§10.6), `+0x8D` / `+0x8E` = ice / fire resist flags.  5. ~~Starting food/water/energy~~ solved (§1.3).  6. Held-party click whitelist read (§10.6; region meaning hyp).

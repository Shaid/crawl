# Black Crypt (Amiga) — Game Rules

Logic foundation for the browser remake. Derived from the game's own code (decompressed `bcdft` S_1 code / S_2 data, and `bcdfp`); the DOS port was not needed. Offsets: **S_1 +0xNNNN** = offset in `bcdft_decompressed.bin` (also the Ghidra function address); **A4 = S_2 + 0x7FFE**; an absolute `jsr 0xXXXXX.l` targets S_1 offset `XXXXX - 0x80058`. `bcdfp +0xNNNN` = CODE-hunk offset.

Evidence grades: **harness** = diffed against the game's real 68k routine run in a musashi core (`tools/blackcrypt/rules_oracle/`, vectors in `vectors.json`, TS in `tools/blackcrypt/rules.ts`, test `rules.test.ts`, with a null control); **code** = read from disassembly/decompile (address given), not executed; **hyp** = inference; **open** = not derived (smallest next step given).

Companion data: `game-rules-spells.json` (60-spell table, machine readable), `game-rules-world.json` (field maps, vitals constants, item-effect tables). Exported by `buildAssets`: `public/assets/blackcrypt/amiga/data/rules-tables.json` (see §6).

## 2026-11-23 status summary

| Area | Done | Open |
|---|---|---|
| 1 Character state | record field map (§1.1), new-game init, class templates, level-up + XP thresholds (harness), stat tables | chargen point-allocation caps, stat-slot names, class numbering vs item class mask |
| 2 Combat | player melee to-hit/damage (harness), weapon table + monster immunities (harness, 256x256), monster death XP, party damage, monster-vs-party melee hit/damage, monster AI = bytecode VM (dispatcher traced), tick/event model | AI script decode (table located, byte layout unresolved), monster speed -> delay, ranged attacks, tick wall-clock length |
| 3 Spells | model (memorised charges, no mana), all 60 spells, memorising/recharge, monster casts (appendix A) | see appendix A.6 |
| 4 World | vitals, resting, traps, locks, no random encounters, no shops, weight/AC/light (appendix B) | see appendix B.open |

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

Stat slot roles (code): +0x64 melee damage bonus table T1; +0x65/+0x66 spell stat (clerics/druids use +0x65, others +0x66 per spells agent); +0x67 level-up HP bonus (T1) and disease resistance; +0x68 base armour and melee attack delay (T3) and pit-fall damage. **Names (STR/INT/WIS/CON/DEX) are inferred only**: +0x64=STR, +0x67=CON, +0x68=DEX fit the role; +0x65/+0x66 WIS/INT unconfirmed.

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

The party is the fixed four classes; creation edits stats (25 spare points), names and portraits. **Open:** point-allocation upper cap and the per-click rule (bcdfp LAB_0080 region, +0x4F0..). Starting kit: 20 items = 5 per class (`bcdfp` DATA 0x585C, see data-structure.md).

New-game init (code, bcdfp +0x22A..+0x9DA): level 1, HP/max 20, XP 0, food=water 5000, energy 10000, armour +0x62=+0x63 = table[+0x68]+6+2, weight = sum of starting items.

### 1.4 XP and level-up (**harness**, S_1 +0x17D2A, vs `levelUp()`; 240 random cases exact)
* Level L advances while **xp > 2^(L+7)**; the threshold doubles for each level gained in the same call (multiple levels possible). Level 1 needs >256, L2 >512, L3 >1024 ... (no level cap in this routine).
* Per level gained: `hp += rand16(9) + T1[stat+0x67] + 7` added to both HP and max HP. Same for all classes. Nothing else changes (no stat gain, no spell slots) in this routine; the chain afterwards only redraws and prints "GAINED A LEVEL / N LEVELS".
* Spell level gating uses level (appendix A): spell level <= char level.
* XP source (code, S_1 +0x7ED0 / +0x81C4): when a monster dies, **each living character** gets `xp += word(second record +6) + rand16(second +8) + rand16(first record byte +2)`; args in +0x7ED0 not re-read (**hyp** on the exact args; the loop at +0x81C4 shows this form). Tablets (type 0x30) can also give levels/HP (appendix B).
* RNG: **harness** exact. 6-byte state, `new = s1 + s4 + s5 + 1 (+carry)`, shift register; rand8(n)=byte%n, rand16(n)=(hi<<8|lo)%n, lo drawn first, n=0 returns 0 (S_1 +0x26854/+0x268BA/+0x268CC). Seed source not found in S_1 (**open**; bcdfp/BlackCrypt).

## 2. Combat

### 2.1 Time model (code)
Real-time, not turn-based. Tick counter long at A4+0x1750, incremented once per call of the tick handler `S_1 +0x8B2`. Timed things are a sorted list of 12-byte slots at A4+0x1036 (150 slots, free list head A4+0x173E, next A4+0x103F+12*i), created by **ScheduleEvent +0x5EA** `(type, dueTick, a1, a2, a3, a4)`; the handler dispatches due events by type: 0x01 / 0x05 monster act (a1,a2 = x,y), 0x0A/0x0B misc, 0x14/0x15 weapon cooldown ready (hand), 0x16 pain/flash, 0x1E AC buff expiry (900 or 1800 ticks), 0x1F strength buff expiry (1800), 0x20 compass (3600), 0x21 wizard sight (3600), 0x22 create-wall expiry, 0x23 detect-trap (D4*360), 0x24 haste (D4*120), 0x25, 0x28/0x29. **Open:** wall-clock length of one tick (find the caller cadence of +0x8B2; all durations scale with it).

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
* **Monster behaviour is a bytecode VM** (`S_1 +0xAAFC`, called by events 1/5): 6-byte instructions `op,a,w1,w2` per behaviour type; behaviour = record word +0x0E (movement type), script pointers table at `S_2+0x114A` (4 B each, 12 entries; entries 0,4,7,8 share a script). Opcodes seen in the dispatcher: 2,3,4 step/attack, 5 wait w1 ticks, 6 wait speed&0x7F, 9 sidestep, 0xA, 0xB attack (+0x940C), 0xD regenerate (HP += rand + w/2, capped), 0x10 set / 0x12 add / 0x13 sub per-monster variable, 0x16/0x19 (adjacent)/0x1C/0x1D conditions, 0x1E (+0x9626), 0x21, 0x22 transform (set word0, counter 0x14), 0x24 set HP, 0x27 message, 0x28/0x29 state slot write, 0x2B wait 2*speed, 0xFF counter/flee-turn. **Open:** the script byte layout does not decode cleanly from the S_2 image (the pointer table resolves, scripts show the opcode at byte +2 of each 6-byte cell, entries 0-3 do not match); smallest next step: dump the script region from a post-init memory state, or trace the initialiser that builds it.

### 2.4 Monster death (code, S_1 +0x7ED0)
When `HP < 1`: the monster's carried item chain drops to the square, effects/events are cancelled (+0xB25A), the square is redrawn, and **XP is awarded to each living character** (§1.4). Special-type monsters have custom handling (types 0x80B1.. keep HP at 49 / 1 until a flag; 0xC5-type is a story boss: sets A4+0x1A1E).

## 3. Spells: see Appendix A. Rules in one line: five memorised spell slots per char, no mana, no failure roll (only anti-magic squares fail), recharge timers per spell, spell levels 1..10 gated by char level, damage = magnitude + rand(n).

## 4. World rules: see Appendix B. No random encounters (only scripted/generator spawns), no shops, no currency, no lock-picking, keys are consumed.

## 5. Copy protection
S_1 holds a manual-question table (~+0x1B1E6..+0x1B4F9). It was neither read for answers nor recorded.

## 6. Tooling and tables
* `tools/blackcrypt/rules_oracle/oracle.c` (musashi; `build.sh`; builds on `tools/bcdft_decompress/musashi`): loads S_1 at 0x80058 and S_2 at 0xA8BF0, A4 = S_2+0x7FFE, patches every external `jsr abs.l` target to `RTS` (UI/blitter/text) except the real helpers, and runs single routines to a sentinel return. Modes: `rng`, `levelup`, `weapon`, `melee`. `make_vectors.py <s1> <s2>` regenerates `vectors.json` (116 KB, no game data beyond small rule constants).
* Parity: RNG 72 sequences x 24 draws exact; level-up 240/240; weapon lookup 65,536/65,536 type x gfx (fixture stores the base table and the 6 deviating monster types plus the matrix sha1); bare-hand 16/16; melee 500/500. Null control (perturbed base) disagrees on >20 cases.
* `tools/blackcrypt/rules-tables.ts` (wired into `tools/shared/game-config.ts` `buildAssets`) writes `rules-tables.json`: T1/T2/T3, XP thresholds, new-character defaults, class templates, 60-spell table (name, recharge, level, nextInPage), weapon base table decoded statically from the dispatch chain (test confirms it equals the harness table). Needs `build/cache/blackcrypt/bcdft_*.bin` (run `tools/bcdft_decompress/build.sh run`).
* The older `classes.json` export (stat labels str/dex/con/int/wis/cha) is wrong; `rules-tables.json` supersedes it.

## 7. Smallest next steps (ranked)
1. Decode the monster AI scripts (§2.3 open) and monster attack/speed fields; harness the monster-vs-party melee (+0x9D28).
2. Wall-clock tick length (all durations/regen).
3. XP award args in +0x7ED0; verify with a harness case.
4. Chargen allocation rule; class numbering (item class mask bit order conflicts: data-structure says +1 Fighter,+2 Cleric,+4 Druid,+8 MU; code `1<<classIdx` with MU=2 would make bit 4 = MU).
5. Resolve AC (+0x62) semantics vs +0x69.
6. Tick pairing of poison/disease cadences; RNG seed.

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

### A. 6. Open items (smallest next step)
1. Real-time length of a tick (recharge/buff durations): trace caller cadence of +0x8B2 (copper/vblank divisor).
2. Class word <-> class name and which stat (+0x65/+0x66) it is; where char+0x45/+0x46 are initialised: read bcdfp char-creation code (writes to $45/$46(A.) with class).
3. AC sign convention (+0x62 += n is good or bad): read monster-hit routine +0x08532 region.
4. +0x098A8 (monster bits 12-15), +0x07904/+0x079B0 (event 0x25), item effects 13-16.
5. Xp formula inside +0x07ED0 (random args lost by decompiler).
6. FUN_435c ray range/pathing and b308 target selection (walls/doors block?).

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
- **Class restriction**: usable iff (item byte+4 & (1<<class)) != 0, class word at char+0: 0 Fighter, 1 Cleric, 2 Druid, 3 MU (`+0x12B8C`). Skipped only for the two hand slots in the equip click; otherwise CANNOT WEAR ITEM. Failing use: "<name> CANNOT USE THIS ITEM". Idols (type 0x2C) and gfx 0xAA/0x1A cannot enter inventory (CANNOT PLACE ITEM IN INVENTORY). [code]
- **Enchantments (effect word +0x0E)**: 0-9 stat idx +value, 0x14-0x22 protection counters, 0x80-0x9F use-effects. Table in world.json. Effects only active while charges != 0. Weapons (types 0-3, 0x24) give +1 (not +value). Type 0x0D = slot-bound charm (word+0xC = row*10+col). Tablets (type 0x30) `+0x16502`. [code]
- **Use-effect map** 0x80-0x9F: decoded potions (0x96-0x9F), LIGHT (0x80), feast (0x8A); the remaining 0x81-0x90 call spell routines (+0x6D9A projectile with 5 params, +0x5070, +0x4C46, +0x5D52, +0x78DA..+0x7C40) - **open**: name them by matching params to spell list at S_1 +0x1A7FA.
- Magic items are blocked on squares with flag bit 6 (SPELL FAILED / anti-magic) before any effect. [code]
- Mask of True Sight: inventory row2 col4 slot gfx 0xC0 is consulted by combat code (+0xBFFE, +0x14710); -10 modifier when absent. [hyp, lead's area]
- OGREBLADE "slowly drain" text: no equipped-item drain found in tick or elsewhere. [open: smallest step = search tick handler for per-tick HP loss tied to weapon gfx]

### B. Open list
1. Use-effects 0x81-0x90 names/params.  2. Stat index to name map (only idx3 = disease/CON-like, idx4 = DEX-like AC stat are role-confirmed).  3. Ogreblade curse.  4. Counters +0x89,+0x8D,+0x8E.  5. Starting food/water/energy values (bcdfp).  6. Exact held-party click whitelist.

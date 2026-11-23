# Wizardry 6 (Amiga) — Game Rules

Logic foundation for the browser remake, derived from the game's own code (`Bane`, disassembly `data/wizardry6/amiga/disasm/Bane.asm`). The SNES and DOS ports were not used. Written 2026-11-23 following the method of `docs/blackcrypt/amiga/game-rules.md`.

**Address conventions.** `CODE+0xNNNN` = offset in `Bane`'s CODE hunk (the hex column of `Bane.asm`). `A4` = DATA hunk base + 0x7FFE; `-N(A4)` is a SAS/C small-data global. The party's four-to-six character records are 432-byte (`0x1B0`) `pcfile` records, record *i* at `A4-17922 + i*0x1B0` (record offset = displacement + 17922; e.g. `-17886(A4)` = `+36`). Jump-table calls `JSR -N(A4)` go through the 6-byte `JMP.L` entries at `A4-32766..-31926`; the ones used below: `-32652` = `Random` (`CODE+0xb9c`), `-32664` = `ReadSection` (`CODE+0x9fc`), `-32676` = `GetMessage` (`CODE+0x872`), `-32058` = 32-bit signed divide helper (`CODE+0x554d0`).

**Evidence grades** (as in the Black Crypt document):
* **harness** — diffed against the game's real routine run in the Unicorn single-routine core (`tools/wizardry6/oracle/rules.py`, vectors in `tools/wizardry6/oracle/rules-vectors.json`, TypeScript port `tools/wizardry6/rules.ts`, test `tools/wizardry6/__tests__/rules.test.ts`, each with a null control).
* **code** — read from the disassembly with the address given; not executed. The formula is as written in the code; a variable's *name* may still be a hypothesis (stated).
* **data** — checked against the shipped data files.
* **hyp** — inference; **open** — not derived (smallest next step given).

Exported tables (`buildAssets`, `tools/wizardry6/rules-tables.ts`): `public/assets/wizardry6/amiga/data/rules-tables.json` and `messages-full.json`.

## 2026-11-23 status summary

| Area | Solved (grade) | Open |
|---|---|---|
| 0 Foundations | random generator (harness); the real message framing, 5,164 strings, so every class/race/skill/spell/status name is now readable (data + code) | — |
| 1 Character state | record field map for ~45 fields (code); 11 races, 14 classes: base attributes, minimums, HP dice, ranks, XP table mapping (code/data); creation: bonus pool, cap, class eligibility, gender rule, profession change (code); level-up: XP threshold and multi-level loop, HP/stamina, attribute raise, spell tier (harness) | new-character starting HP/stamina/skills, level-up message/skill hooks (`LAB_16AC`, `LAB_16C0`), the unmapped record spans |
| 2 Combat | victory flow: XP pool, share, gold, loot (code, data); treasure-record format (data + code); per-round action planner reads (code); party spell cost/chance formulas (code) | melee to-hit/damage (`CODE+0x1f33e`, 2015 lines), monster attack/AI, order of play, flee/morale, status application, resistance/armour scaling, encounter start |
| 3 Spells and skills | 82-row spell table (realm, level, SP cost, caster mask) and who-can-learn mask (code + data); caster groups; spell tier from skill (`skill/18+1`); SP pools per realm; known-spell bitset; skill array offsets and the 30 skill names | per-spell effects (`CODE+0x289a4`, `0x27b26`, `0x2ebb6`, `0x2ef36`), skill use and skill-point award, mapping of class to caster group |
| 4 World | chest trap names, loot table drives chest contents (code/data) | rest, food, poison, doors/traps beyond movement, the 19 stubbed entity kinds, scripted events (section 6) |

## 2026-11-24 status summary (pass 2: combat)

Pass 2 solved the attack resolver and the status machinery by running the game's own routines in the Unicorn core against synthetic state and diffing **every byte written, every logged call and the generator state** against a TypeScript port. Details in section 7.

| Area | Solved (grade) | Open |
|---|---|---|
| 7.2 Attack resolver `LAB_0CD0` (`CODE+0x1f33e`) | to-hit, AC, fatigue, encumbrance, surprise, strike count, attack kinds, damage, body part, sleep counter, skill-use gain, kill, cast-instead-of-hit (**harness**, 3,000 vectors) | thrown/shot item removal (`CODE+0x22278`), spell effect call (`CODE+0x24ea0`) are recorded, not executed |
| 7.3 Weapon effects `LAB_0CBB`, ApplyStatus `LAB_0E45`, SetStatus `LAB_0E3D`, kill cleanup (**harness**, 3,000 + 1,500 vectors) | status counters, drains, instant death, XP pool credit, kill counter, formation grid | names of the state values; the UI side |
| 7.4 Spell damage engine `LAB_0E4F` (`CODE+0x23366`) (**harness**, 1,500 vectors); dispatcher id to engine map for 35 spells with arguments plus about 25 more routed by engine (**code**) | area selection `CODE+0x23758`, status engines `0x238ac`/`0x23aa0`, healing and buff engines, spell strength | per-spell dice, healing, buffs, duration |
| 7.5 Monster side | record fields the resolver reads (**harness**), XP pool credit (**harness**) | monster AI, flee/morale, encounter generation, group formation |
| 7.6 Skills | skill-use gain rule and the weapon-subtype to skill map (**harness**) | skill points, thief skills |
| 7.7 Simulator | `combat-sim.ts` composes the verified chain; round loop is **hyp** | order of play, targeting, spells, flee |

## 0. Foundations

### 0.1 Random generator (**harness**)
`CODE+0x1728` holds three 16-bit words. `LAB_0148` (`CODE+0x21b6`) advances them as a Wichmann-Hill combiner in 68000 word arithmetic: for each word `s`: `new = 171*(s mod 177) - 2*(s / 177)` (and `172*(s mod 176) - 35*(s/176)`, `170*(s mod 178) - 63*(s/178)`), `+30269 / +30307 / +30323` when negative. `LAB_0147` (`CODE+0x2138`) steps it and returns `(t1 + t2 + t3) & 0x7FFFF`, where each `t` is built from `(s mod m)*10000 / m` with the DIVU remainder's low three bits placed at bit 16. `Random(n)` (`CODE+0xb9c`) returns 0 for `n <= 0`, else `raw % n` taken as a signed-word remainder. Because the three terms are each below about 10,000, the low word is always below 30,000 (never negative) and the distribution is the sum of three uniforms (triangular-like), not flat. TypeScript `W6Rng` matches the game on 30 seeds x 8 raw outputs and 40 seeds x 14 `Random(n)` calls (n in 1..300, 0, -3) including the final state, with a null control. Seed source: **open** (the state lives in the CODE hunk; its initial words and any reseed were not traced; the smallest next step is to grep for writes to `CODE+0x1728`).

### 0.2 Message framing — **Correction (2026-11-23)**
`messages.json` (from `decode-msg-text.ts`) is wrong for most strings. `GetMessage` (`CODE+0x872`) looks an id up in `msg.hdr` (`CODE+0x730`, 6-byte records `firstId, offsetInPage, word`), where the word's high byte is the count of *additional consecutive ids* and its low byte is the page. In the 1024-byte page the strings are packed as `[n][L][n-1 Huffman bytes]`, so the next id is `n+1` bytes on. The old decoder read `n` as the decoded length and `L` as a "mystery compressed length", so it decoded only the first string of each record and cut it at `n` characters (`STRENGTH` came out as `STRENG`). `tools/wizardry6/rules-tables.ts` `decodeAllMessages` follows the game's framing and yields 5,164 strings (`messages-full.json`); `messages.json` is left in place for its consumers but should not be used for text. Three ids (10891, 15672, 16146) decode to control-code runs, which is expected.

Useful id ranges (all **data**): 100-110 races, 120-133 classes, 140-141 gender, 200-217 stat labels, 800-939 rank names (class*10+0..9), 3000-3010 combat menu, 3200-3226 spell/status flavour, 3470-3498 status results, 3700-3710 breath types, 3950-3957 realm names and "COST", 4000-4081 spell names, 5000-5014 victory/level-up text, 5050-5057 attribute names, 5200-5235 chest, 5250-5275 status/drain, 5300-5315 trap names, 5500-5530 skill names.

## 1. Character state

### 1.1 Record (432 bytes, `A4-17922 + i*0x1B0`)
Combines `data-structure.md` §7.3 with this pass. Only offsets this pass confirmed or revised are listed with a grade; the rest of §7.3 stands.

| Off | Size | Meaning | Evidence |
|---|---|---|---|
| +0 | str | name | §7.3 |
| +8 | long | age in days (`/365` shown) | §7.3 (hyp) |
| +12 | long | experience points | code `CODE+0x3ebda`, `0x502d6` adds the victory share |
| +20 | long | gold; each living member gets `gold_pool / living` | code `CODE+0x502e4` |
| +24 / +26 | word | HP current / max; level-up adds the same gain to both | harness |
| +28 / +30 | word | stamina current / max; same | harness |
| +32 / +34 | word | carried weight / capacity (50% and 66% tiers set penalties `+425/+426`) | §7.3 |
| +36 | word | level (no cap; XP loop continues past 16) | harness |
| +40..+63 | 6 x (word cur, word max) | **spell points per realm**: realm *r* current at `+40+4r`, max at `+42+4r`; a cast subtracts `spPerPower*power` from the spell's realm | code `CODE+0x275ac..0x275c4`, `0x35938` |
| +64..+71 | 8 B slots | equipment slot cache (§7.3) | §7.3 |
| +300..+307 | 8 bytes | **attributes** STR INT PIE VIT DEX SPD PER KAR (names msg 5050-5057). Level-up raises one of the first seven. Creation cap 18 | harness (level-up), code (creation) |
| +308..+337 | 30 bytes | **skills**, skill *k* at `+308+k` (names msg 5500+k; see 3.3) | code `CODE+0x356c0`; consistent with §7.3's "homogeneous array" at +316/+320/+321/+323/+333/+337 |
| +392..+402 | 82 bits | **spells known**, bit = spell id (TestBit/SetBit helpers `-32490/-32496`) | code `CODE+0x356c0..0x35816` |
| +412 | byte | portrait (WPORT) | §7.3 |
| +413 | byte | **race** 0..10: passed to the race-apply routine `LAB_14C3` (11 cases) at `CODE+0x38240` | code. **Revises** §7.3 (`+413` "small enum") |
| +414 | byte | gender (0 male, 1 female per msg 140/141) | §7.3, code (`CODE+0x2d732` rule) |
| +415 | byte | **class** 0..13 (= msg 120+class = XP table index) | §7.3; code `CODE+0x3eb44..0x3eb5e` |
| +416 | byte | spell tier counter (0..7), raised by level-up (1.5); consumer not found | harness (writer), open (reader) |
| +417 | byte | condition: 0 = healthy; nonzero is excluded from XP/gold shares and from the "anyone alive" test | code `CODE+0x4ff80`, `0x502ba`. **Revises** §7.3's "race" guess |
| +431 | byte | level held before a profession change; while `level < +431` level-ups give a fixed +1 HP/+1 stamina; cleared when reached | harness + code `CODE+0x381ba..0x381de` |

### 1.2 Races (11) — base attributes (**code**: inline 8-letter strings, `letter - 'A'`, switch at `CODE+0x2d60a`, strings `CODE+0x2d6ce..`)
| id | Race | base STR INT PIE VIT DEX SPD PER KAR | sum |
|---|---|---|---|
| 0 | HUMAN | 9 8 8 9 9 8 8 0 | 59 |
| 1 | ELF | 7 10 10 7 9 9 8 0 | 60 |
| 2 | DWARF | 11 6 10 12 7 7 7 0 | 60 |
| 3 | GNOME | 10 7 13 10 8 6 6 0 | 60 |
| 4 | HOBBIT | 8 7 6 9 10 7 13 0 | 60 |
| 5 | FAERIE | 5 11 6 6 10 14 12 0 | 64 |
| 6 | LIZARDMAN | 12 5 5 14 8 10 3 0 | 57 |
| 7 | DRACON | 10 7 6 12 10 8 6 0 | 59 |
| 8 | FELPURR | 7 10 7 7 10 12 10 0 | 63 |
| 9 | RAWULF | 8 6 12 10 8 8 10 0 | 62 |
| 10 | MOOK | 10 10 6 10 7 7 9 0 | 59 |

The rule `LAB_1198` (`CODE+0x2d732`): when its argument is 1 (gender = female) STR -2, PER +1, KAR +1 (**code**; the gender meaning of the argument is **hyp**). The attribute *maximums* per race were not found; creation uses one cap (1.4).

### 1.3 Classes (14) (**code/data**)
Class byte = the section-0 XP table index (so the long-open class mapping is solved: `ReadSection(0, class)` at `CODE+0x3eb5e`). Class minimum attributes are inline strings at `CODE+0x2d3a4..0x2d419`, switch `CODE+0x2d238`; VALKYRIE additionally requires the gender byte (`-10038(A4)`) = 1 (`CODE+0x2d2d8`). HP per level = `Random(die)+bonus` from the jump table `CODE+0x3dc50` (harness-checked all 14 classes). Rank names are msg `800 + 10*class + n` (n = 0 is NONE).

| id | Class | XP to leave L1 (table[0]) | L15->16 (table[14]) | table[15] | HP/level | min attributes (STR INT PIE VIT DEX SPD PER KAR) | ranks (msg 800+10*id) |
|---|---|---|---|---|---|---|---|
| 0 | FIGHTER | 1000 | 1792000 | 2048000 | Random(5)+6 | 12 0 0 0 0 0 0 0 | JOURNEYMAN, WARRIOR, MARAUDER, GLADIATOR, SWORDSMAN, WARLORD, CONQUERER, *R.GARLAND |
| 1 | MAGE | 1250 | 2515000 | 2890000 | Random(3)+2 | 0 12 0 0 0 0 0 0 | MAGICIAN, CONJURER, WARLOCK, SORCERER, NECROMNCER, WIZARD, MAGUS, *BLK.CLAW |
| 2 | PRIEST | 1250 | 2515000 | 2890000 | Random(4)+4 | 0 0 12 0 0 0 8 0 | ACOLYTE, HEALER, CURATE, DRUID, HIGHPRIEST, PATRIARCH, SAINT, *HOLYCROSS |
| 3 | THIEF | 900 | 1585800 | 1810800 | Random(4)+3 | 0 0 0 0 12 8 0 0 | ROGUE, TRICKSTER, HIWAYMAN, BUSHWACKER, PIRATE, MS.SHADOWS, GUILDMASTE, *EMR.LATCH |
| 4 | RANGER | 1400 | 2791800 | 3206800 | Random(5)+6 | 10 8 8 11 10 8 8 0 | WOODSMAN, SCOUT, ARCHER, PATHFINDER, WEAPONEER, OUTRIDER, RANGERLORD, *ZYNN BOW |
| 5 | ALCHEMIST | 1100 | 2123200 | 2435200 | Random(4)+4 | 0 13 0 0 13 0 0 0 | HERBALIST, PHYSICIAN, ADEPT, SHAMAN, EVOCATUR, MS.ELIXERS, ENCHANTER, *MS.AIR |
| 6 | BARD | 1250 | 2515000 | 2890000 | Random(3)+3 | 0 10 0 0 12 8 12 0 | MINSTREL, CANTOR, SONNETEER, TROUBADOR, POET, MS.LUTES, MUSE, *CP.APOLLO |
| 7 | PSIONIC | 1250 | 2515000 | 2890000 | Random(3)+3 | 10 14 0 14 0 0 10 0 | PSYCHIC, SOOTHSAYER, VISIONIST, ILLUSIONST, MYSTIC, ORACLE, PROPHET, *PSI.CRYS |
| 8 | VALKYRIE (female only) | 1100 | 2123200 | 2435200 | Random(5)+5 | 10 0 11 11 10 11 8 0 | LANCER, WARRIOR, CAVALIER, CHEVALIER, CHAMPION, HEROINE, OLYMPIAN, *DV.AESIR |
| 9 | BISHOP | 1500 | 2993000 | 3438000 | Random(3)+3 | 0 15 15 0 0 0 8 0 | FRIAR, VICAR, CANON, MAGISTRATE, DIOCESAN, CARDINAL, PONTIFF, *DV.MYRMID |
| 10 | LORD | 1400 | 2791800 | 3206800 | Random(5)+6 | 12 9 12 12 9 9 14 0 | SQUIRE, GALLANT, KNIGHT, CHEVALIER, PALADIN, CRUSADER, MONARCH, *R.GARETTE |
| 11 | SAMURAI | 1400 | 2791800 | 3206800 | Random(5)+5 | 12 11 0 9 12 14 8 0 | BLADESMAN, SHUGENJA, HATAMOTO, DAISHOMASTE, DAIMYO, WARLORD, SHOGUN, *MS.SWORDS |
| 12 | MONK | 1400 | 2791800 | 3206800 | Random(4)+4 | 13 8 13 0 10 13 8 0 | INITIATE, BROTHER, DISCIPLE, APOSTLE, MASTER, IMMACULATE, GRANDMASTER, *MS.FLOWER |
| 13 | NINJA | 1500 | 3143000 | 3618000 | Random(5)+4 | 12 10 10 12 12 12 0 0 | GENIN, EXECUTIONER, ASSASSIN, CHUNIN, MASTER, JONIN, GRANDFATHER, *MS.SMOKE |

XP tables are shared: FIGHTER alone (1000..); MAGE = PRIEST = BARD = PSIONIC (1250..); THIEF (900..); RANGER = LORD = SAMURAI = MONK (1400..); ALCHEMIST = VALKYRIE (1100..); BISHOP (1500.. / 2,993,000 at index 14); NINJA (1500.. / 3,143,000).

### 1.4 Creation (**code**, `CODE+0x2fb10` `LAB_123C`)
* Attributes start at the race base (plus the 1.2 gender rule). A **bonus pool** `Random(6)+5` (5..10) is rolled, plus **+8 for each of two independent `Random(20)==0`** rolls (so about a 9.8% chance of at least one +8, 0.25% of both). When flag `-10456(A4) == 1` the pool is fixed at 21 (`0x15`); the flag is **hyp** (a debug/cheat or easy setting; its writer was not traced).
* Each click adds 1 to an attribute only if it is below **18** and the pool is above 0 (`CODE+0x2def2..0x2df28`); removing is allowed only down to what the player added (`CODE+0x2de3e..0x2de6c`), so no attribute can be set below the race base. Cap and per-click rule: **code**.
* Class eligibility (`LAB_1158`, `CODE+0x2d1ac`): for each attribute below the class minimum the deficit is charged to the pool (1 point each); the class is selectable when the pool does not go negative. In apply mode it raises those attributes and spends the pool.
* **Change profession** (`CODE+0x38100..0x3828c`): sets the class byte, stores the old level in `+431` (only when it was below 250), then level = 1, spell tier = 0, XP = 0 and calls the race (`LAB_14C3`) and class (`LAB_14B0`) apply routines. The two apply routines both end in `LAB_1492(char, 8-letter string, mode)` (`CODE+0x37986`, loops the first seven attributes at `rec+300+i`): **mode 1 (race, strings = the 1.2 base values)** sets any attribute *above* the string value down to it; **mode 0 (class, strings = the 1.3 minimums)** raises any attribute *below* the string value up to it (**code**). So a profession change clamps every attribute to at most the race base and then lifts it to the new class minimum. HP and stamina are not touched by this path.
* Where a brand-new character's starting HP/stamina/skills are written was **not** found (**open**; smallest next step: find the writers of `rec+24` outside level-up, e.g. grep `-17898(A4)` stores).

### 1.5 Level-up (**harness**)
`CheckLevelUp` (`LAB_16FE`, `CODE+0x3eade`) loops: while `XP >= threshold(level)` it calls `LevelUp` (`LAB_16F9`, `CODE+0x3e930`), which increments the level. Threshold: for `level < 16`, the class table entry `table[level-1]`; for `level >= 16`, `table[15] + (level-16)*(table[15]-table[14])` (32-bit multiply). The harness ran the real loop through the game's own `ReadSection` with `LevelUp` replaced by a counter: **300/300** (class, level, XP) cases match `levelsGained` (including 30+ levels gained at once and levels past 16), with a null control (an off-by-one table index fails).

`LevelUp` then does, in order (each piece checked as indicated):
1. **HP and stamina** (`LAB_16B3`, `CODE+0x3db86`, **harness 840/840** across all classes, VIT 3..24, with RNG state): `hp = Random(die)+bonus` (class table, 1.3); `stamina = Random(4) + (STR+VIT)/6` (integer division); HP -1 if VIT < 8, +1 if VIT > 15, +1 more if VIT > 17, minimum 1. If the new level is below the saved `+431`, both gains are 1. Both are added to the current and maximum values. The two random draws are always consumed.
2. **Attribute raise** (`LAB_16EA`, `CODE+0x3e688`, **harness 120/120**): up to three `Random(7)` tries to find an attribute (STR..PER; never KAR) that is below 18 and not already raised this level; raise it by 1; then `Random(2)`: nonzero starts another raise (the already-raised list persists). The number of raise rounds is geometric (each round continues with probability 1/2), mean 2 when attributes are below the cap, and fewer when they are near it.
3. **Spell tier** (`LAB_16F1`, `CODE+0x3e86e`, **harness 117/117**): the record's tier byte `+416` becomes the number of thresholds `{2,4,7,10,14,18,24}` that the level has reached, never decreasing.
4. Message and bookkeeping calls: `LAB_16AC` (`CODE+0x3d818`), `LAB_16C0` (`CODE+0x3df40`), `LAB_16D7`: **open** (not read; these may include the skill-point award; see 3.3).

Level-drain is not implemented in this routine; the drain statuses (msg 5265-5269) are read in combat code (open, section 2).

## 2. Combat

### 2.1 What is solved
**Victory flow** (**code**: `CODE+0x503e6` victory entry, `CODE+0x5031a` XP split, `CODE+0x4fdd0` loot). The encounter start (`CODE+0x17fde`) clears the XP pool `-15300(A4)` and loads the group's treasure id from the monster record byte **+162** (`CODE+0x18024`; hyp: the first monster record of the encounter). Each monster removed from a group 1..5 adds its record's `+64` (u32) to the pool (`CODE+0x22e9a`; known). On victory:
* `living` = characters whose `+417` is 0. If the pool is above 0, every living character gets `XP += pool / living` (signed 32-bit divide, `-32058`) and the text `EVERY SURVIVOR EARNS $ EXP` (msg 5001). The loot step sets game state 8 (`-18610(A4)`) when nobody is living (`CODE+0x4ffa2`).
* Then, if the treasure id is not -1, the treasure record (`ReadSection(7, id)`, 40 bytes) is rolled (2.2). Gold and bonus XP are totalled; each living character gets `gold/living` added to `+20` (`EACH SHARE OF LOOT WORTH $ GOLD`, msg 5002) and the full bonus XP added to `+12` (`EVERYONE RECEIVES A $ EXP BONUS`, msg 5003). Items go to the loot-divvy screen (msg 5101-5107).

### 2.2 Treasure record (scenario.dbs section 7: 200 x 40 bytes) (**data + code**)
Six entries of `{u16 A, u16 B, u8 type, u8 pct}` then a four-byte tail. For each entry in order, with `Random(100) < pct`:
* type 1 **gold**: `Random(A-B) + B` (so `A` is the maximum and `B` the minimum; `A == B` is a fixed amount, e.g. `(300,300)`).
* type 2 **item**: item catalogue id `A + Random(B)` (`B` = size of a consecutive id range; `B = 1` is a fixed item).
* type 4 **bonus XP**: `A * B` to each living character.
Across all 200 records: 478 item entries, 86 gold, 11 bonus-XP, `pct` 2..100, no other type values (**data**). Type 3 is never present. The tail byte 39 (1 or 2 on 47 records) gates a pre-step (`LAB_1D5C`, `CODE+0x4fdd0` first lines) that runs before the roll (hyp: chest/trap setup; bytes 36-38 open).

### 2.3 Per-round action planner (**code**, `LAB_0C63` `CODE+0x1e21a`)
Structures: `A4-15266[g]` is a pointer to group *g*'s array of 44-byte member structs (g 0 = party, 1..5 = monster groups); `A4-15294[g]` points to the group's 222-byte monster record (the catalogue entry, see §7.1). Per member: `roll = Random(10) + info.byte[211] + member.signedbyte[41]`, minimum 1; `perAttack = roll / info.byte[213]` (the record's attack count); up to four attack slots `member[24+k]` receive the remaining roll (low byte), each slot reduced by `perAttack`; members that are asleep/paralysed (`member[34] >= 2`) or have `member[16]`/`member[17]` set get zero. Monster spell and breath selection use record bytes `+168` (spell chance percent, tested against `Random(100)`) and `+170` (breath chance percent). A spell is picked by a `Random(100)` roll walked down the monster's spell list at record `+138+i` with cumulative thresholds 5, 10, 15, 25, 35, 45, 55, 70, ... (first entry whose threshold exceeds the roll wins). Its power: `power = clamp(w - spellLevel + 1, 1, 6)` with `w` = the member struct's first word, then decayed by `while Random(w)+1 < power: power--`; the result is stored as the **action word** `(power << 8) + spellId` at member `+10`, which is exactly what the party cast routine (2.4) unpacks. The record offsets `+211`, `+213`, `+138..` match the §7.1 TODO row's "special-attack and spell gates"; the field *names* are **hyp**.

### 2.4 Spell cast resolution (**code**, `LAB_0F72` `CODE+0x27132`; used for both sides)
Action word at `action+10`: `power = word / 256`, `spell id = word % 256`. Cost (party only): realm pool `rec[+40+4*realm] -= spell.spPerPower * power` (`CODE+0x275ac..0x275c4`); the routine returns `Random(power) + spell.level + power` as spell strength. Two flags are built: **fizzle** `F` (`-10482(A4)`) and **backfire** `B` (`-10484(A4)`).
* Gate 1 (both sides): `Random(g + w0 + 1) < g` sets `F`, where `g` = byte `+401` of the actor group struct and `w0` = the action's first word (hyp: an anti-magic/dispel counter; names open).
* Party chance (`CODE+0x2728a..0x272c2`): `chance = 90 + skillByte/3 - spell.level*power`, with `skillByte = rec[+333]` (ALCHEMY) for classes ALCHEMIST(5), RANGER(4), NINJA(13) and `rec[+321]` for all other classes (the +321 slot is skill 13, labelled ORATORY by 3.3; treat that mapping as **hyp**). `Random(100) <= chance` succeeds; otherwise `Random(36)`: if it exceeds `rec[+307] (KAR) + 18` then `B` is set (and `F` cleared), else `F` is set. With KAR >= 17 a failed cast can therefore only fizzle, never backfire (**code**, arithmetic).
* Monster chance (`CODE+0x27376..0x273ca`): `chance = 88 + 3*w - spell.level*power` with `w` = the first word of the member struct; on failure `Random(7) == 0` sets `B` (clearing `F`) else `F` is set.
* Spell-table bits (`CODE+0x2747a..0x274aa`): if `B` is set but `spell.b3` bit 1 is clear, `B` becomes a fizzle; if `F` is set but `b3` bit 0 is clear, `F` is cleared. So **`b3` bit0 = the spell can fizzle, bit1 = it can backfire** (**code**).
* Outcome: if the caster is silenced (`action+14` nonzero, except for the three half-caster classes 4/5/13 which clear that check) message 3200 SILENCED!; else `F` gives 3201 FIZZLE!, else `B` gives 3202 BACKFIRE!, else the effect dispatcher `LAB_0F06` (`CODE+0x24ea0`, 2774 lines: **open**) is run with `(action, spell, power)`.

> **Correction (2026-11-24):** this section (and 2.3's reading of `-15138/-15136(A4)`) had the roles of the two sides backwards. The resolver's **first parameter is the ATTACKER's 44-byte member struct**; its `+0x1f/+0x20` bytes name the **target** group and member. The attacker's own group and index are the globals `-15138(A4)` / `-15136(A4)`. Section 7 supersedes the speculation below; the arithmetic that was read here (`-90`, `-92`, `-94`, `-88`) is real but belongs to different terms than named.

### 2.5 Armour class reads (known) and unresolved melee
Monster AC is record `+190` (signed) per `data-structure.md` §7.1. The resolver `LAB_0CD0` (`CODE+0x1f33e`, 2015 lines, six `Random` calls) is the attack routine for both sides (a side flag at `-78(A5)`). Facts read so far (**code**): it copies a per-hand 16-byte weapon block from `rec+240+16*hand` (`-17682(A4)`) and reads `rec+254+16*hand` (`-17668(A4)`); for the defender it computes `-90(A5)` from the member struct's byte `+38` and a rank/position term, adds the party-wide value `-18124(A4)` when `-18126(A4) > 0`, then `-92(A5) = record.signedbyte[190] + (-90)` and `-94(A5) = record.byte[198 + bodyPart] + (-90)` (per-body-part AC, `CODE+0x1fce2`, `0x1fd08`); the attacker term `-88(A5)` sums several byte terms including `5 * action.byte[39]`. Later in the routine a strike count is drawn: `clamp(Random(rec212 - member.sbyte[41]/10) + 1, 1, 4)` into `-102(A5)` (`CODE+0x2005e..0x200c4`; `rec212` = the group's record byte `+212`, the 4-tier level class of §7.1; which side's struct is meant depends on `-15138(A4)`, hyp), followed by a jump on the attack kind (`14(A5)`: 4 = bash/thrust-style, 8 = ranged, per the case blocks at `CODE+0x200d4..0x20110`) that adjusts `-92/-94(A5)` by -2/-4 and `+1/+2`. The comparison against a `Random` draw, the damage dice (`+20..+23` bonus/count/sides of the weapon) and resistance scaling were **not** decoded. **Open.**

### 2.6 Open (smallest next steps)
1. **Melee/ranged to-hit and damage** — build a combat-state fixture for the harness (fill `A4-15266`/`A4-15294` with one party member and one monster loaded through `LoadMonsterIntoSlot`, `CODE+0x15fee`) and run `LAB_0CD0` with a fixed RNG and UI stubs, logging every `Random` argument and compare; then derive the formula by varying one input at a time.
2. **Order of play and flee/morale** — find the writers of `member[16]/[17]/[34]` and the `RUN`/`HIDE` handlers (msg 3007/3006).
3. **Status application and resistances** — the attack record's seven percentage fields (§7.1) feed a status roll vs the member's resistance bytes; trace `member[34]` writers.
4. **Monster AI** — decide targets and movement (`LAB_0C5B`, `LAB_0C5F` called from 2.3).
5. **Encounter start** — kind 5 entity handler and `-15102(A4)` (the encounter id) setter.

## 3. Spells and skills

### 3.1 Spell table (**code + data**, 82 entries x 6 bytes at `A4-31698` = DATA+0x42c; names msg 4000+id)
Fields: `realm` (0 FIRE, 1 WATER, 2 AIR, 3 EARTH, 4 MENTAL, 5 MAGIC; msg 3950-3955), `level` 1..7, `spPerPower` (SP per power step, 3.2), `b3` (bit0 = may fizzle, bit1 = may backfire, 2.4; the other bits are unused in the 82 rows: values are 0..3), `b4` (0/1/2; semantics open), `casterMask` (who may learn it: 1 alchemist, 2 psionic, 4 priest, 8 mage, per the cast menu at `CODE+0x356c0`: group 0 -> mask 8 THAUMATURGY, group 1 -> 4 THEOLOGY, group 2 -> 1 ALCHEMY, group 3 -> 2 THEOSOPHY, matching msg 704-707 MAGE/PRIEST/ALCHEMIST/PSIONIC). Ids 79-81 (HOLY WATER, HELPFOOD, MAGICFOOD) have level 0 and are item effects. Full machine-readable table: `rules-tables.json` `spells`. Layout by realm and level (SP per power step, casters Ma/Pr/Al/Ps):

FIRE: L1 Energy Blast 2 Ma; L2 Blinding Flash 3 Al; L3 Fireball 6 Ma, Fire Shield 8 Ma; L4 Fire Bomb 8 Al; L5 Lightning 8 Pr, Prismic Missile 9 Ma; L6 Firestorm 12 Ma; L7 Nuclear Blast 16 Ma.
WATER: L1 Chilling Touch 2 Ma, Stamina 2 Pr/Al/Ps, Terror 3 Ma/Ps; L2 Weaken 4 Ma/Ps, Slow 4 Pr/Ps; L3 Haste 5 Pr/Ps, Cure Paralysis 6 Pr/Al/Ps, Ice Shield 8 Ma; L4 Iceball 8 Ma, Paralyze 5 Pr/Ps; L5 Deep Freeze 6 Ma.
AIR: L1 Poison 2 Al; L2 Missile Shield 5 Ma; L3 Stink Bomb 4, Air Pocket 8 (Ma/Al), Silence 4 Pr/Ps; L4 Poison Gas 7 Al, Cure Poison 8 Pr/Al, Whirlwind 8 Pr; L5 Purify Air 10 Pr/Al, Deadly Poison 8 Al, Levitate 12 Ma; L6 Toxic Vapors 8 Al, Noxious Fumes 10 Ma/Al, Asphyxiation 12 Ma/Al; L7 Deadly Air 16 Al.
EARTH: L1 Acid Splash 2 Al, Itching Skin 2 Al, Armor Shield 2 Ma, Direction 3 Ma; L2 Knock-Knock 6 Ma/Ps; L3 Blades 6 Pr/Ps, Armorplate 6 Pr, Web 7 Ma/Al; L4 Acid Bomb 8 Al, Armormelt 8 Ma/Ps; L5 Create Life 10 Al; L6 Cure Stone 18 Pr/Al.
MENTAL: L1 Mental Attack 3 Ps, Sleep 3 Ma/Al/Ps, Bless 4 Pr/Ps, Charm 5 Pr/Al/Ps; L2 Cure Lesser Cnd 4 Pr/Al/Ps, Divine Trap 4 Pr/Ps, Detect Secret 5 Ma/Ps, Identify 8 Pr/Ps; L3 Hold Monsters 6 Pr/Ps, Mindread 8 Ps, Sane Mind 10 Pr/Ps; L4 Psionic Blast 8 Ps, Illusion 10 Ps, Wizard Eye 10 Ma/Ps; L5 Death 10 Pr/Ps; L6 Locate Object 8 Pr/Ps; L7 Mind Flay 18 Ps.
MAGIC: L1 Heal Wounds 4 Pr/Al/Ps, Make Wounds 3 Pr; L2 Magic Missile 4 Ma, Dispel Undead 7 Pr, Enchanted Blade 4 Pr; L3 Blink 7 Ma/Ps; L4 Magic Screen 8 Ma, Conjuration 10 Ma/Pr; L5 Anti-Magic 7 Ma, Remove Curse 10 Pr; L6 Lifesteal 12 Pr/Ps, Astral Gate 8 Ma/Pr; L7 Word of Death 18 Pr, Resurrection 20 Ma/Pr/Ps, Death Wish 20 Pr.

### 3.2 Casting and learning model (**code**)
* SP are per realm (six pools, 1.1). A spell of power `p` costs `spPerPower * p` SP of its realm; `p` is the high byte of the action word (2.4). Spell strength returned is `Random(p) + level + p` (`CODE+0x275c8..0x275e8`).
* **Learn/scribe eligibility** (the new-spell routine `CODE+0x356c0`, group argument 0..3, message 702 `YOU LEARNED A NEW $ SPELL!`, and the spell-list builder `CODE+0x2ccf8`, same filter): spell *i* (0..81) is offered when `casterMask(i) & groupMask != 0`, `level(i) <= tier`, and it is not already in the known set `rec+392`. **tier = skill/18 + 1, forced to 7 when the group's skill byte is 98 or more** (`CODE+0x3577a..0x357a0`). Groups: 0 MAGE -> mask 8, skill THAUMATURGY `rec+336`; 1 PRIEST -> mask 4, THEOLOGY `rec+334`; 2 ALCHEMIST -> mask 1, ALCHEMY `rec+333`; 3 PSIONIC -> mask 2, THEOSOPHY `rec+335`. The scribe screen temporarily sets all six SP pools to 999 for display and restores them (`CODE+0x35938..0x35968`).
* The per-class mapping of who has which group (is it the class, or the skill value?) and what consumes `+416` (the level-based tier of 1.5) were **not** found: **open**; smallest next step: find the callers of `CODE+0x356c0` (its group argument).
* Failure/fizzle/backfire: 2.4.

### 3.3 Skills (**code/data**)
Thirty skills at `rec+308+k`: 0 WAND&DAGGER, 1 SWORD, 2 AXE, 3 MACE&FLAIL, 4 POLE&STAFF, 5 THROWING, 6 SLING, 7 BOWS, 8 SHIELD, 9 HANDS&FEET, 10 SWIMMING, 11 SCOUTING, 12 MUSIC, 13 ORATORY, 14 LEGERDEMAIN, 15 SKULDUGGERY, 16 NINJUTSU, 17 DEFENSE, 18 SPEED, 19 MOVEMENT, 20 AIM, 21 POWER, 22 ARTIFACTS, 23 MYTHOLOGY, 24 SCRIBE, 25 ALCHEMY, 26 THEOLOGY, 27 THEOSOPHY, 28 THAUMATURGY, 29 KIRIJUTSU (msg 5500+k, **data**; the byte offset mapping is **code** for 25..28 only and consistent with the other offsets named in §7.3). A "skill points" pool is shown (msg 5530) and "YOU EARNED A SKILL BONUS!" (msg 605) appears in the skill screen; the award rule and the per-skill use (hit bonus, thief skills, swimming) are **open**: read the skill screen routine (msg 600-610 users) and `LAB_16C0`/`LAB_16AC`.

## 4. World rules

Solved by earlier passes and stays valid: movement, doors, teleports, stairs (`data-structure.md` §4.7.10, parity-tested). New here: chest trap names (msg 5300-5315: NO TRAP, VORPAL BLADES, CLOUD OF FEAR, GUARD ALARM, POISON DAGGER, PRISMIC MISSILE, RAY OF ENFEEBLE, FIZZLE FIELD, ENERGY DRAIN, DIMENSION DOOR, CURSE OF MEDUSA, ARMOR MELT, PHANTASMAL HAND, NOXIOUS VAPORS, FIRE BOMB, KISS OF DEATH), the chest menu (INSPECT / DISARM / OPEN / SPELL / LEAVE, msg 5200-5235) and the loot formula (2.2).

**Open** (none traced this pass): rest, food and poison; disease; the 19 stubbed entity kinds (`OTHER_KIND_HANDLERS` in the oracle) and what scripted events (section 6) trigger; chest trap selection and disarm chance; hunger (the old records `+52/+54/+56` belong to Black Crypt, not this game). Smallest next steps: for rest, grep for the `REST` action (msg 2011) handler; for entities, extend `tools/wizardry6/oracle/oracle.py` `OTHER_KIND_HANDLERS` one kind at a time starting with the messages kind.

## 5. Tooling, vectors and parity

* `tools/wizardry6/oracle/rules.py` — Unicorn harness for the rule routines: `rules.py vectors OUT.json`. UI callees (window/text helpers) are replaced by no-ops; the generator, the 432-byte records, `ReadSection` and the level-up arithmetic are the game's own code.
* `tools/wizardry6/oracle/rules-vectors.json` — committed output: 30 raw-generator seeds, 40 x 14 `Random(n)` calls, 840 HP/stamina level-ups, 120 attribute raises, 117 spell-tier points, 300 `CheckLevelUp` cases.
* `tools/wizardry6/oracle/combat.py`, `tools/wizardry6/combat.ts`, `tools/wizardry6/combat-sim.ts` and `__tests__/combat*.test.ts`: the combat harness, port and simulator (section 7); committed vector subsets in `oracle/combat-*-vectors.json`.
* `tools/wizardry6/rules.ts` and `tools/wizardry6/__tests__/rules.test.ts` — 11 tests, every group with a null control; `rules-tables.test.ts` checks the extractor against the retail data (skips without it).
* `tools/wizardry6/rules-tables.ts` — exporter wired into `tools/shared/game-config.ts` `buildAssets` (wizardry6/amiga).

## 7. Combat resolution, pass 2 (2026-11-24)

Method: `tools/wizardry6/oracle/combat.py` loads `Bane`, replaces presentation, sound, window and delay callees by recording no-ops (the list is `UI_FUNCS`/`LOGGED` in that file), builds a random but plausible party/monster state in the game's own memory layout and runs the real routine. Per vector it records the **input footprint** (every data/heap byte the routine read, with its first value), **every byte written**, the **effect log** (stack arguments of the stubbed logic callees) and the **generator state after**. `tools/wizardry6/combat.ts` is run on a byte map seeded with exactly that footprint and **throws on any read outside it**; its writes, effects and generator state must equal the game's. The game's message buffers (`-10836..-10596(A4)`) are ignored (text, not rules). Null controls change the seed, the dice count or an armour byte and must fail.

### 7.1 Memory model (**harness**: every field below is read by a verified routine)
* `-15266(A4)[g]` -> group *g*'s **member array** of 44-byte structs (g 0 = party, 1..5 = monster groups), with group fields after the nine members: `+0x18c` (byte, used by `LAB_0F06`), `+0x18e` (byte: percent chance a missile at this group is dodged), `+0x19c` (monster record index), `+0x19d` (area-spell target cap).
* `-15294(A4)[g]` -> the group's 222-byte **record** (party group 0: a pseudo record whose resist table is refilled from the member being hit).
* Member struct (offsets in hex): `+0` word (a level-like strength: feeds `pow = word/3 + 1` in weapon effects, `word/4` in the defend case, the resist modifier), `+2` HP, `+4` second HP word (**hyp**: max or temp; `LAB_0CBB` case 11 lowers it with HP), `+6/+8` stamina current/max, `+0xa` word chosen action, `+0xe..+0x15` status counters (slot = `+0xe+k`, capped 250, `0xff` permanent), `+0x10 +0x11 +0x12 +0xf +0x16 +0x17` status bytes tested by the resolver (`+0x11` is a counter that each hit reduces by `Random(3)+2`), `+0x18..+0x1b` attack slots, `+0x1e` stance (1 = defending, 7 = another special), `+0x1f/+0x20` target group/member, `+0x22` state (0 ok, 1-2 impaired, 3 dead; semantic names **open**), `+0x23` magic-type byte, `+0x26` armour byte (signed), `+0x27` to-hit mod (x5), `+0x28` damage mod, `+0x29` signed byte (strikes), `+0x2a` formation cell (`0xff` none), `+0x2b` surprise flag (0, 1, `0xff` = consumed).
* Monster record fields the resolver reads: `+0x40` XP (u32), `+0x44+16h` attack block h (word base, byte dice count, byte sides, bytes `+4..+11` eight proc percents, byte `+12`, byte `+14` signed to-hit bonus), `+0x80+h` slot-valid byte (< 4), `+0x83+h` attack kind byte (`0x20` = casts the word at block `+2`), `+0x86` attack bonus (>15: +1, >17: +2 damage), `+0x87..+0x89` power bytes (their sum difference / 2 shifts to-hit), `+0x94+i` resist percentages (**harness**: indices 4, 6, 9, 11, 13 used by weapon effects; 0..13 by spells), `+0xa1` life-drain gate, `+0xae` / `+0xb6` eight body-part weights (monster's own / used when it hits a party member), `+0xbe` base AC (signed), `+0xc6+k` per attack-kind AC adjustment (signed), `+0xd0` special type (`0x16` = only item 458 hurts it, **harness**), `+0xd9` drain type (3 stamina, 11 life), `+0xda/+0xdc` unique-monster slain bit, `+0xd4` (212) level class (strike count).
* Party record fields (A4 displacements from game-rules 1.1 plus): `+32/+34` carried weight / capacity, `+240` weapon block hand 0, `+256` hand 1 (= the missile/ammo block), `+254` / `+270` / `+430` signed to-hit bonuses, `+272/+273` equipped item slots (0xff none), items at `+64+8s` (word id, `+4` type byte, `+5` subtype byte, `+6` quantity byte), `+308+k` skills, `+338..+351` the member's resist bytes, `+425/+426` encumbrance counts (clamped by the tier), `+428` item count.

### 7.2 The attack resolver, `LAB_0CD0` (`CODE+0x1f33e`) (**harness**)
Signature `Attack(A: member*, hand: word, kind: word)`. `kind`: 0 swings, 1 thrusts, 2 bashes, 3 melees, 4 throws, 5 punches, 6 kicks, 7 lashes, 8 shoots (messages 3350-3358). Let `ag/ai` = attacker group/index, `tg/ti` = `A[0x1f]/A[0x20]`, `D` = defender struct, `MR(g)` = record, `rnd(n)` = `Random(n)`. All arithmetic is signed 16-bit.

1. `-10488(A4) = 4`. **Surprise text**: if `A[0x2b] != 0` and `kind` is not 4/8, `rnd(2)` is drawn (BACKSTAB / SURPRISE, messages 3385/3386); this consumes the generator. A party attacker with kind 4 reads the item's cast word (scenario section 1 record, word at `+28`; **harness**); non-zero makes the attack cast that spell instead of hitting. A monster attacker whose `+0x83+h` is `0x20` casts word `block[+2..+3]` for kinds 4 and 8. The cast word is `(power << 8) + spellId`.
2. `d = trunc((sum(MR(tg)+0x87..0x89) - sum(MR(ag)+0x87..0x89)) / 2)`; `dmg_bonus = A[0x28]` (signed); `fa = Fatigue(0, A[6], A[8])`.
3. **To-hit threshold `T`** (a *miss* threshold: higher is worse for the attacker):
   * monster attacker: `T = d + MR(ag)[0x52+16h] + 5*A[0x27] + fa`; damage block = `MR(ag)+0x44+16h`; if kind 4/8 the damage bonus is 0.
   * party attacker: skill index `s` = 5 for kind 4, 9 (HANDS&FEET) with no weapon, else `WeaponSkill(item.subtype)` (7.6). `SkillUse(ai, s, 2)` runs first unless `s == 9` and HANDS&FEET is 0 and the class is not 12/13. `T = pen + d + rec[254+16h] + rec[430] + 5*A[0x27] + fa - skill[s]/3`, where `pen` is the encumbrance penalty for the hand (7.3). A kind-8 shot with a type-4 ammo item in slot `+273` uses the hand-1 block, adds `rec[270]` to `T`, zeroes the damage bonus and records `use_ammo`; a kind-4 throw marks the thrown item's quantity (`+6` = 1 for types 14 or below 12 except 2), zeroes the bonus and records `use_ammo`.
4. **Defender armour**: `ac0 = Fatigue(1, D[6], D[8]) + D[0x26]`; for a party defender and a monster attacker `ac0 -= word(-18132(A4))` when `-18134(A4) > 0`, for a party attacker `ac0 += word(-18124(A4))` when `-18126(A4) > 0` (party-wide armour effects, writers **open**); a party defender also adds the encumbrance armour term. `AC = ac0 + MR(tg)[0xbe]`, `AC2 = ac0 (+ MR(tg)[0xc6+k] for a monster defender)`.
5. **Shared modifiers**, in order: surprise (`A[0x2b] != 0`): `AC = max(AC, 10)`, damage x2. `A[0x12] != 0`: `T = max(T, 90)`, `AC = min(AC, 0)`. `A[0x16] || A[0x0f] || A[0x17]`: `T += 25`. Defender with a status byte set (`D[0x12] || D[0x10] || D[0x11] || D[0x22] == 2`; the names of these bytes are open): `AC = 15`, x2. `D[0x16] || D[0x0f]`: `AC += 4`. Attacker record `+0x86` bonus added to the damage bonus. **Strike count** `n = clamp(rnd(MR(ag)[212] - trunc(D[41]/10)) + 1, 1, 4)`. By kind: 1: `AC -= 2`, `AC2 += 1`, dmg +1; 2: `AC2 -= 2`, dmg += bonus+2; 3: `AC -= 4`, `AC2 -= 4`, x2; 4: one strike, x1, `AC -= 1`, `AC2 += 1`; 5: `AC += 1`, `AC2 -= 1`; 6: `AC -= 2`, dmg += bonus+2; 7: `AC += 2`, `AC2 -= 2`, x1; 8: one strike, x1, `AC2 += 2`. Defender stance 7: `AC = max(AC, 10)`, x2. Defender with no status and stance 1 (defending): action 0 lowers AC by its Defense/shield skill `/10 + 1` (party, and trains SHIELD, `SkillUse(ti, 8, 2)`) or by `word0/4 + 1` (monster) and cancels doubling; action 1 lowers AC by 2; action 2 ends the stance (rebuilds the member's next action from the lowest set bit of the action mask, party `rec+255`, monster `rec+83`); action 3 sets AC 15.
6. **Per strike** while `D[0x22] < 3`: `r = rnd(100)` (0 if `-18606(A4) != 0`), then a **body part** `part = BodyPart(weights)` (`Random(100)` walked down eight weights, default 4); `AC3 = AC2 + MR(tg)[0xbe+part]` (0 if the defender is state 2 and `AC3 > 0`). If the defender is type `0x16` and the attack is physical: a party attacker needs item 458 (and `-15126(A4) != 0`) else `r = 0` (so it misses); monsters always miss it. A missile (kind 4/8) is first dodged if `rnd(100) < MB(tg)[0x18e]`. **Miss** if `r < 5` or (`r < 95` and `r <= T - 5*AC` and the attack is physical). Otherwise a hit: if `A[0x2b] == 1` it becomes `0xff`; `damage = (dmgBonus + Dice(block)) * mult`; a **glancing blow** (no damage) if `damage < 1` or (`r < 95` and `r <= T - 5*AC3`). A damaging hit: `HP -= damage`, `D[0x10] = 0`, `D[0x11] = max(0, D[0x11] - (rnd(3)+2))`; `HP < 1` calls SetStatus(3) and sets `A[0x2b] = 1` if it was `0xff`, else the weapon effects run (7.3) unless the defender is type `0x16`. Spell attacks call `24ea0(A, id, power)` after setting `-10484(A4) = 1`. After the loop `A[0x2b] == 0xff` becomes 0.

So a physical blow connects when `r >= 5` and (`r >= 95` or `r > T - 5*AC`); with Random(100) roughly uniform that is a 5 percent floor miss, a 5 percent always-hit, and a threshold that moves by 5 percentage points per armour point and 1 point per `T` point. **Grade: harness**, 3,000 random states over party-vs-monster, monster-vs-party and monster-vs-monster, all nine kinds, 0 mismatches.

### 7.3 Helpers and status machinery (**harness** unless stated)
* **Fatigue** `LAB_0CA3` (`CODE+0x1eba2`): `f = 100 - cur*100/max` (signed divide); `f <= 50`: 0; to-hit penalty (`flag 0`) 5, 10, 20, 40 at `f <= 66, 75, 90, above`; AC penalty (`flag 1`) 0, 1, 2, 4. Applies to the **attacker's** stamina as a to-hit penalty and the **defender's** as an armour penalty.
* **Encumbrance** `LAB_0CB1` (`CODE+0x1ec26`): `pct = weight*100/capacity` (record `+32/+34`): `<= 50` none; `<= 66` hand-0/hand-1 to-hit penalty 5/10; `<= 75` armour 1, penalty 10/20; `<= 90` armour 2, 20/40; above armour 4, 40/80. Also writes seven words at `-30370(A4)` (clamped carry counts, `weight/100|50|25`).
* **SkillUse** `LAB_0E28` (`CODE+0x22b90`): `if skill < 100 and Random(skill) - level*mult <= 0 then skill += 1` (level = record `+36`). Called with mult 2 on every attack with the weapon's skill, with 2 for a defender's SHIELD skill when its action is Defend, and with 0 when it holds a type-11 item.
* **Dice** `LAB_0D66` (`CODE+0x20b9e`): `base + n x (Random(sides)+1)`, base a signed word. `LAB_0D69` first writes `(c, a, b)` into `-30356(A4)`.
* **Weapon effects** `LAB_0CBB` (`CODE+0x1ede0`): for each of eight bytes `p[k]` at block `+4+k`, if `Random(100) < p[k]` the effect fires, with `pow = word0(A)/3 + 1` and resist modifier `mod = (word0(A) - word0(D)) * 3`. 0: status slot 2 (resist 9, dice `pow + pow x (Random(2)+1)`); 1: slot 3 (resist 4, `2*pow^2` dice of 5); 2: slot 5 (resist 6, base block `+12`, `pow*10` dice of 2; sets `D[0x23]`); 3: SetStatus state 2 vs resist 11; 4: nothing; 5 (monster attackers only): stamina drain (record `+0xd9 == 3`: `3*pow + 2*pow` d5, stamina floors at 0) or life drain (`== 11` and `Random(100) > rec[+0xa1]`: d4 off HP and `+4`, `+4` floors at 1, party HP copied back to the record); SetStatus 3 if HP <= 0; 6: instant death if `Random(100) > resist[11 or 13] - mod`; 7: slot 2 (resist 9, `2*pow` dice of 3).
* **ApplyStatus** `LAB_0E45` (`CODE+0x23154`): skip if the defender is state >= 2 or flagged; `mag = Dice`, then **ResistScale** `LAB_0E3A`: `v = clamp(mag*(resist-mod)/100, 0, mag)`, `mag' = mag - Random(v+1)`; if `mag' > 0` and `Random(100) > resist - mod` the counter `D[0xe+slot]` rises by `mag'` (cap 250; base `0xff` = permanent). (For a party defender the member's resist bytes are first copied into the pseudo record.)
* **SetStatus** `LAB_0E3D` (`CODE+0x2300c`): `(grp, idx, msg, resist, state, mod, ...)`: unless the defender is already at `state` or higher or flagged, a nonzero resist index needs `Random(100) > resist - mod` to land; then `D[0x22] = state`, and state >= 3 runs the **kill cleanup** (`CODE+0x22c36`): for a monster credit the attacker's kill counter (`rec -17906(A4)+i*432`, long), set the unique-monster bit (`-30150(A4)`, bit = record `+0xda`, LSB first), clear its cell in the formation grids (`-15160`, `-15124`, `-15114`, `-10478`, `-11734(A4)`), add record `+0x40` to the XP pool `-15300(A4)`; always zero HP/stamina and the four action slots, `D[0x2a] = 0xff`, state 3.
* **Spell damage engine** `LAB_0E4F` (`CODE+0x23366`): `(grp, idx, dice1, sides, dice2, resist, mod)`: skip dead/flagged; `total = sum of dice2 x dice1 dice`; if `Random(100) <= resist - mod` the target saves for 0, else `ResistScale(total)`; `HP -= result`; HP <= 0: SetStatus 3.

### 7.4 Spells: dispatcher map (**code**, except the engine above)
The dispatcher `LAB_0F06` (`CODE+0x24ea0`, `(A, spellId, power)`) is a switch on spell id. It does not hold 82 formulas; it routes to a handful of generic engines with fixed arguments. `local_e = Level-gap + (word0(A) - word0(target))`-style spell strength is computed first (`CODE+0x22c08` table at `-31699(A4)+..` plus the caster/target word0 difference); that, the dice arguments and the area selection (`CODE+0x23758`: negative target = an area of `min(|n|, MB[0x19d])` targets starting at a random one) are **open**. The id to engine map with arguments for 35 of the 82 spells is exported as `combat.spellEngines` in `rules-tables.json`; the rest are listed below:
* single/area **damage** through `0x23758` (calls `0x23366` per target), resist index in brackets: ENERGY BLAST [7], FIREBALL [5], FIRE BOMB [3], LIGHTNING [10], FIRESTORM [4], CHILLING TOUCH [6], ICEBALL [4], DEEP FREEZE [10], WHIRLWIND [7], ACID SPLASH [7], BLADES [4], ACID BOMB [6], MAKE WOUNDS [8], MAGIC MISSILE [7]; LIFESTEAL calls `0x23366` directly [4].
* **status / kill with a save** through `0x238ac` (ids 1, 11, 18, 24, 36, 42, 48, 50, 55, 61, 67, 75) and `0x23aa0` (20, 22, 25, 29, 31, 32, 47, 58): these end in SetStatus or ApplyStatus (7.3).
* `0x23ff0` (the **group-buff engine**, writes group bytes `+0x18c..+0x196`): FIRE SHIELD 3, HASTE 14, ICE SHIELD 16, MISSILE SHIELD 21, AIR POCKET 23, ARMOR SHIELD 37, ARMORPLATE 41, ARMORMELT 44, BLESS 49, DETECT SECRET 53, ENCHANTED BLADE 68, MAGIC SCREEN 70, ANTI-MAGIC 72 (**code**; ARMORMELT also calls `0x22f9e`). Their per-id arguments are **open**.
* `0x23d38` (element, power; **hyp**: a whole-group drain/kill): NUCLEAR BLAST 8 (element 5), DEADLY AIR 34, MIND FLAY 63, WORD OF DEATH 76 (element 4). `0x24054`: WEAKEN 12, SLOW 13. `0x244ae`: PRISMIC MISSILE 6. `0x24940` (animation heavy): CREATE LIFE 45, ILLUSION 59, CONJURATION 71. Dice healing handlers: STAMINA 10 (`dice(8)` onto stamina, capped at max), HEAL WOUNDS 64, HELPFOOD 80, MAGICFOOD 81. These are **open** apart from the dispatch itself.

### 7.5 Monster side
Solved (**harness**): everything in 7.1 that a monster record contributes to an attack, the proc-block meaning, the drain/death branches, XP pool credit and unique-monster bit. **Open**: choosing the action (`LAB_0C63` planner is partly read in 2.3), the AI that picks targets and spells, group formation and encounter generation (`CODE+0x17fde`), flee and morale, treasure choice (2.2). The scenario monster table is documented in `data-structure.md` 7.1.

### 7.6 Skills (**harness** for what is listed)
`SkillUse` (7.3) is the whole advancement rule for a skill used in combat: chance about `level*2/skill`, +1 per success, hard cap 100. The weapon subtype (item byte `+5`) to skill index map (`WeaponSkill`, `combat.weaponSkillBySubtype`): subtype 0, 18, 89 -> 0 WAND&DAGGER; 1, 14, 15, 16, 51, 53, 55, 58, 59 -> 1 SWORD; 2, 3, 20 -> 2 AXE; 4, 5, 6, 52, 54, 56, 98 -> 3 MACE&FLAIL; 7, 8, 9, 10, 17, 19, 57, 90 -> 4 POLE&STAFF; 11, 12 -> 7 BOWS; 13 -> 6 SLING; 24, 38 -> 8 SHIELD; anything else -> 0. Kind 4 (throw) always trains THROWING (5). The skill's to-hit value is `skill/3` (higher skill lowers `T`). **Open**: skill points, scouting/music/legerdemain/skulduggery/ninjutsu uses, swimming, the skill screen award.

### 7.7 The simulator and how to build the remake's combat core
`tools/wizardry6/combat-sim.ts` (`CombatWorld`) builds a party and monster groups into the game's memory layout (`Mem` in `combat.ts`, `LAYOUT` constants) and runs the verified chain through `resolveAttack(..., {exec: true})`, which executes weapon effects, SetStatus and the kill cleanup inline so the shared random stream is consumed in the game's order. Tests (`__tests__/combat-sim.test.ts`): determinism (same seed, same fight byte for byte), a null control (another seed differs), a strong party wins and the XP share equals `pool / living`, a weak party loses, skill-use gains over many attacks, and a composition check replaying 90 recorded game states through the same inline path. The **round loop is hyp**: order is `Random(10)+1` descending, party members swing at the first living monster, monsters at a random party member; spells, defend, run and the real planner are not wired.

To build the remake's combat core: keep state in the game's layout (or a typed view over it), call `resolveAttack` for every blow and `spellDamage` for a damage spell target, feed it the one shared `W6Rng` (a different generator breaks every verified ordering), and put the planner, targeting and AI on top once they are harnessed. Presentation is entirely the callees listed as `UI_FUNCS` in `combat.py`.

### 7.8 Parity and how to rerun
| Check | Vectors (generated) | Mismatches | Committed subset |
|---|---|---|---|
| attack resolver (`combat.py vectors`, seed 7) | 3,000 | 0 | `oracle/combat-vectors.json` (110) |
| weapon effects + ApplyStatus (`proc`, seed 9) | 3,000 | 0 | `combat-proc-vectors.json` (80) |
| SetStatus + kill cleanup (`setstatus`, seed 3) | 1,500 | 0 | `combat-setstatus-vectors.json` (60) |
| spell damage engine (`spelldmg`, seed 5) | 1,500 | 0 | `combat-spelldmg-vectors.json` (60) |
| composed chain, game runs it all for real (`vectors --full`, seed 11) | 3,000 | 0 | `combat-full-vectors.json` (90) |

Generate big sets into a gitignored place and point the test at them: `python3 -m venv /tmp/w6venv && /tmp/w6venv/bin/pip install unicorn numpy`, then `/tmp/w6venv/bin/python tools/wizardry6/oracle/combat.py vectors OUT.json --n 3000 --seed 7` and `W6_COMBAT_VECTORS=OUT.json npx vitest run tools/wizardry6/__tests__/combat.test.ts` (likewise `W6_PROC_VECTORS`, `W6_SETSTATUS_VECTORS`, `W6_SPELLDMG_VECTORS`, `W6_FULL_VECTORS`). The vectors are random but structured; they do not reach every state (for example the stance-reset branch is hit about 0.2 percent of the time, spell-casting weapons about 1 percent), see 7.9.

### 7.9 Not verified
* The round loop of the simulator and everything it stands in for (7.7).
* Spell strength, dice and area selection of the spell dispatcher (7.4), healing, buffs, duration and decay.
* Thrown/shot item removal `CODE+0x22278` and the party UI sync after a hit are logged, not executed.
* Random state coverage: fixtures randomise the fields the routines read but not the whole game state (for example items flagged cursed, real equipment).
* Evidence grade for `+4`, state names, stance names: **hyp**.

### 7.10 Smallest next steps
1. Harness the planner `LAB_0C63` (`CODE+0x1e21a`): it decides order of play and the action word; its inputs are all in the member structs this pass mapped.
2. Harness `LAB_0F06` per engine with the fixture generator in `combat.py` (`run_call` already runs any routine): start with `0x23758` (area selection), then `0x238ac`/`0x23aa0`, then spell strength (`CODE+0x22c08`).
3. Find the flee (`RUN`, msg 3007) and hide handlers, then morale; then the monster AI callees `LAB_0C5B`/`LAB_0C5F`.
4. Port `CODE+0x22278` (item removal) so `use_ammo` can execute; then a spell-casting round in the simulator.

## 6. Hypotheses to treat with care
Anything marked **hyp** above (and in section 7: member `+4`, the names of `+0x22` states and `+0x1e` stances, the simulator round loop). In particular: `-10456(A4)` flag, byte meanings of treasure tail bytes 36-38, `+321` skill mapping in 2.4, record `+162` as treasure id, and the group/member struct field names in 2.3.

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

## 2026-11-25 status summary (pass 5)

Item use, party swap, post-combat outcome, the per-step world tick (hunger, regeneration, poison, forced camp, wipe), camp, the random-encounter pick and the chest-disarm decision are harness-verified (section 10); two earlier claims were corrected (the "call for help" action is a banner; the `+412` "engaged" flag is a name-identification flag).

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

**2026-11-25 update (section 10):** camp, hunger, the per-step clock, poison/disease/regeneration, wandering encounters and the chest-disarm decision are now **harness**; the remainder below still stands.

**Open** (none traced this pass, apart from the part moved to section 10): rest, food and poison; disease; the 19 stubbed entity kinds (`OTHER_KIND_HANDLERS` in the oracle) and what scripted events (section 6) trigger; chest trap selection and disarm chance; hunger (the old records `+52/+54/+56` belong to Black Crypt, not this game). Smallest next steps: for rest, grep for the `REST` action (msg 2011) handler; for entities, extend `tools/wizardry6/oracle/oracle.py` `OTHER_KIND_HANDLERS` one kind at a time starting with the messages kind.

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

> **Correction (2026-11-24, pass 3):** items 1, 2 and 4 below are now done (section 8); the planner, spell engines and item removal are harness-verified. Items 3 (flee, hide, morale) and the encounter start remain.

### 7.10 Smallest next steps
1. Harness the planner `LAB_0C63` (`CODE+0x1e21a`): it decides order of play and the action word; its inputs are all in the member structs this pass mapped.
2. Harness `LAB_0F06` per engine with the fixture generator in `combat.py` (`run_call` already runs any routine): start with `0x23758` (area selection), then `0x238ac`/`0x23aa0`, then spell strength (`CODE+0x22c08`).
3. Find the flee (`RUN`, msg 3007) and hide handlers, then morale; then the monster AI callees `LAB_0C5B`/`LAB_0C5F`.
4. Port `CODE+0x22278` (item removal) so `use_ammo` can execute; then a spell-casting round in the simulator.

## 8. Combat, pass 3 (2026-11-24): planner, round, spells, cast gate, item removal

Method as in section 7 (footprint-diff parity under Unicorn: the TS port runs on exactly the bytes the game read, throws on any other read, and the writes, logged calls and RNG state are diffed; every test has null controls). All new routines live in `tools/wizardry6/`; generator `oracle/combat3.py <planner|monsters|round|spells|engines|cast|remove>`.

| System | Code | Grade | Parity (generated, 0 mismatches) | Committed subset |
|---|---|---|---|---|
| Monster round planner `LAB_0C63` (`CODE+0x1e21a`) with `LAB_0C5B/0C5F/0C00` | `planner.ts` `planGroup` | **harness** | 3,000 | `planner-vectors.json` (60) |
| Round entry `LAB_0C96` (`CODE+0x1e96c`): which group a monster group targets, ally group | `planMonsters` | **harness** | 1,500 | `planner-monsters-vectors.json` (25) |
| Round driver `LAB_102D` (100-tick order of play) + executor `LAB_0FF9` + retargeting `LAB_0FE6/0FEE`, action callees logged | `round.ts` | **harness** | 1,500 | `round-vectors.json` (14) |
| Spell dispatcher `LAB_0F06`: id -> engine calls, strength = d + 3(level-1) + 3(power-1), buffs, clouds, heals | `spells.ts` `castEffect`, `spell-recipes.json` | **harness** (calls and bytes); recipes fitted from the game's own call log | 3,000 | `spell-vectors.json` (158) |
| Area/status engines `LAB_0E6C/0E7C/0E90`, shield trim `LAB_0E62/0E66`, group wrappers `LAB_0EA8/0EAD/0EB5` | `engines.ts` | **harness**, SetStatus and kill cleanup real | 2,000 | `engine-vectors.json` (100) |
| Cast gate `LAB_0F72` (`CODE+0x27132`): anti-magic, success chance, fizzle/backfire, silence, SP cost, stamina | `spells.ts` `castSpell` | **harness** | 3,000 | `cast-vectors.json` (60) |
| Item removal `LAB_0DE6` (`CODE+0x22278`) | `inventory.ts` | **harness** | 500 | `remove-vectors.json` (45) |

### 8.1 Planner (harness)
`planGroup(c, g, tg)` gives every member: initiative `roll = max(1, Random(10) + R[211] + s8(A[41]))`, attack times `A[24..27]` (roll, then minus `roll / R[213]` per further attack), two distinct attack slots `A[28]/A[29]`, a target (retry while the target state is >= 3), then in order: spell (`Random(100) < R[168]`; spell picked by a rising threshold ladder 5,10,15,25..55,70,85 over `R[138..]`, a heal spell with nothing wounded falls back), breath (`Random(100) < R[170]`), melee (reach from the attack record: 3 front, 6 deep, 9 for allies, capped by group size; `A[30]` = action 0, kind mask via `LAB_0C00`). `A[10]/A[12]` are the action words (kind, or `(power<<8)+spell`). The round driver then fires an action when `A[24+A[33]]` equals the current tick; blink (`A[36]/A[37]/A[43]`) delays it.

### 8.2 Round driver and executor (harness)
Ticks 100..1; per tick groups 0..6, members in order. Executor pre-checks (paralysis, sleep, fear, charm...: status bytes `A[15..22]`) can swallow the action or turn it on the actor; a dead or blinked target is retargeted; the party pseudo-record is synced; then the action dispatch (0 attack, 1 rest, 2 equip, 3 cast, 4 use item, 5 swap, 6 hide, 7 run, 8 breath) and a stamina cost. Lingering group clouds (firestorm, poison gas, toxic vapors, acid) fire at their stored tick. Combat ends when game state `-18610(A4)` leaves 0xd. Callees not ported (hide, run, swap, equip, use item, breath) are logged with their exact stack words.

### 8.3 Spells (harness for the dispatch, engines and gate)
`castEffect` reproduces the dispatcher's engine calls for 79 of 82 ids; summon spells 45, 59 and 71 throw (not harnessed). Group trailer bytes written: `+396..401` shields/buffs (fire, cold, ?, air, all, anti-magic), `+402..405` cloud durations, `+406..409` cloud ticks. Engines: area damage picks `min(|t|, count)` consecutive members from a random start for a negative target; shield trim (`LAB_0E62`: with probability s/10 reduce the dice by `val*s/100` coin flips, min 1). Cast gate: the anti-magic byte (`+401`) can fizzle first, then the caster's chance `skill/3 + 90 - level*power` (party; casters of class 4, 5, 13 use another skill byte) or `3*level + 88 - level*power` (monsters); failure splits into backfire (aimed at the caster) or fizzle by the spell's flag bits; party casters pay `SP per power * power`; the return is the stamina cost `Random(power) + level + power`. Recipes are exported in `rules-tables.json` (`spellEffectRecipes`).

### 8.4 The simulator now runs the game's round
`CombatWorld.enableGameRound()` + `gameRound()`/`runGame()` run `planMonsters`, then `runRound` with attacks executed inline through `resolveAttack` (shared `W6Rng`), replacing the `Random(10)+1` stand-in (which stays as `round()`). The party plan is a policy (the game reads it from the menus). `__tests__/combat-playthrough.test.ts` is a scripted multi-round reference fight (4 fighters vs two kobold groups, plus a losing control); it pins composition behaviour, it is not a game recording.

### 8.5 Not verified after this pass
* Engines `LAB_0EC0` (weaken/slow) and `LAB_0ED3` (prismic missile); summon spells 45, 59, 71; recipe cases for non-affine ids were written by hand from the call logs.
* Action callees not ported: use item `LAB_0F8A`, breath `LAB_0FB1`, equip `LAB_0FC4`, hide `LAB_0FC5`, run `LAB_0FD2`, swap `LAB_0FDB`; monster spell/breath rounds are not wired into the sim (`gameRound` casts nothing).
* Encounter start (`CODE+0x17fde`: surprise, formation, group count, tables, XP and loot), flee/morale, resting, food and time, chest traps, searching, find traps, pick locks, per-turn status effects and cloud decay: untouched this pass (priorities 3 to 6).
* The party's plan and the real UI order are a policy; the pseudo-record write-back only in the cases the vectors reach.

### 8.6 Can the combat core be built from the spec?
For fights in which the party attacks and monsters melee: yes. Keep state in the game's layout, call `planMonsters`, then `runRound(ctx, ret, on)` with `on` executing `attack` effects through `resolveAttack` and `cast` effects through `castSpell(c, A, effect)` + `castEffect` + `engines.ts` (set `ret.cast` from `castSpell`'s return before the stamina charge, as `gameRound` does for attacks). Everything shares one `W6Rng`. The open list in 8.5 is what remains before a complete remake loop.

### 8.7 Rerun
`W6_PLANNER_VECTORS`, `W6_ROUND_VECTORS`, `W6_SPELL_VECTORS`, `W6_ENGINE_VECTORS`, `W6_CAST_VECTORS`, `W6_REMOVE_VECTORS` point the tests at large sets generated with `combat3.py ... --n 3000`.

## 9. Combat, pass 4 (2026-11-24): casts in the sim, summons, hide/run, breath, encounter start

Method as before: the routine runs under Unicorn on synthetic state, the TypeScript port runs on exactly the bytes the game read (any other read throws), and writes, logged calls and RNG state are diffed. Every check has a null control.

### 9.1 Status

| System | Port | Grade | Parity |
|---|---|---|---|
| Casting in the round (`castSpell` + `castEffect` through `gameRound`, cost charged after `ret.cast`) | `spellrun.ts`, `combat-sim.ts` | harness parts + sim tests | 9 sim tests (damage, status, group buffs, fizzle, anti-magic, silence, SP exhaustion) |
| Group weaken/slow `LAB_0EC0`, prismic missile `LAB_0ED3` | `engines.ts` | **harness** | 2,800 vectors, 0 mismatches (committed subset 140 over 7 engines) |
| Summon `LAB_0EEE` (CODE+0x24940) behind spells 45, 59, 71 | `encounter.ts` `summon`, `spells.ts` | **harness** | 2,500 vectors, 0 mismatches; spell dispatcher 3,000 vectors incl. 45/59/71, 0 mismatches |
| Hide and run (`hide`, `run`) | `flee.ts` | **harness** | flee vectors, 0 mismatches (committed subset 60) |
| Breath (twelve types) | `breath.ts` | **harness** | breath vectors, 0 mismatches (subset 42) |
| Encounter start `LAB_0A31` (CODE+0x17fde): group clear, add-group, companion chain, party structs, evasion | `encounter.ts` | **harness** | encounter vectors, 0 mismatches (subset 14); loader, formation and picture are replayed from the game's logged results |

### 9.2 Rules recovered

* **Companion chain** (**harness**): group g gets a companion only if `g < min(5, (level+1)/2 + 1 (+1 if scripted))`. Candidates k = 0, 1 try monster id `rec[164+k]` with percent `rec[166+k]`; the first success wins.
* **Group size**: dice in the record at `+0x74`, clamped 1..9. Member HP dice `+0x78`, stamina dice `+0x7c`. Treasure id is record `+162`, XP is `+0x40`.
* **Evasion** (LAB_09D0, **harness** for the arithmetic, name **hyp**): `skill23 - 3*level` compared unsigned; a group that fails is left unengaged (`+412 = 0`).
* **Hide** (**harness**): party member chance `P+36 + P+324 + 50 - sum over monster groups (count + rec[122] + rec[135])`; monster chance `word0*5 + 50 - sum over the first three party members (P+36 + P+301)`. Success sets member `+43 = 1` (party members also train skill 16).
* **Run** (**harness**): chance `word0 + 90 - sum (rec[122]*count + 2*(rec[137] - rec_ag[137]))`; zero when the "cannot flee" flag `-15128` is 1. Success sets `+43 = 2`; when all of the party has fled game state is 0x17 (the sim reports `winner: fled`).
* **Breath** (**harness**): strength K = number of doublings of 25 against the breather's HP scaled by stamina/max, clamped 1..6; magnitude 4K. Twelve types map to the area damage / status / status2 engines. Types 10-12 are silence gated.
* **Summons** (**harness**): six candidate ids and the power n. The run counter grows while n stays above 0 and Random(3) is 0 (max 3); the candidate is `ids[n]` (ids[0] when n >= 6). Party side summons use the single ally group 6 and are refused while it is occupied; monster side adds a group (max five). Candidate lists: 45 party 0xd4..0xd9, monster by dungeon level 10/11/12; 59 party 0xda..0xdf, monster levels 9..12; 71 party random half (0xc8..0xcd or 0xce..0xd3), monster levels 9..12, or a single 0xd3 when the summoner is monster 0x96 or 0x99. Other levels call the routine with all zero arguments (a no-op).
* **XP pool and treasure**: unchanged from section 2.1 (pool from each kill, divided by living characters; treasure record per section 2.2).

### 9.3 The simulator

`CombatWorld.fromEncounter(party, id, seed, {scenario, level, scripted})` runs the verified encounter start on real `scenario.dbs` monster records. `gameRound` handles party plans attack/cast/run/hide, monster casts and breath, and summons (through `EncounterIO`). `encounter-playthrough.test.ts` (skips without the data file) pins a fixed-seed timeline: encounter generation, party casts, monster casts and breath, a party run.

### 9.4 Not verified or not found

* Monster AI beyond the planner: the "call for help" action (message 3512 near CODE+0x19542 inside LAB_0AB5) and monster flee/morale were **not** located or harnessed (open).
* The use-item (`LAB_0F8A`, CODE+0x275f0), swap (`LAB_0FDB/0FDA`), equip (`LAB_0FC4`) action callees and the party-order sort in `LAB_0A03`: not ported; the sim treats them as no-ops.
* Surprise determination and where the encounter id comes from (a map script operand): open. Loot award beyond the XP pool and treasure record: not harnessed.
* World rules (rest and healing, food and time, chest traps and disarm, searching, thief skills, per-turn status ticks, cloud decay): **not started** this pass; the section 4 status stands.
* The evasion check semantics and the formation slots are presentation or **hyp**.

### 9.5 Can the combat core be built from the spec?

For a fight the player starts and drives through attack, cast, hide, run and ammo use: yes. Every routine on that path has a verified port, and the sim composes them on real monster records. The remake still needs: monster AI extras (call for help, morale/flee), the item swap/equip/use actions (inventory UI semantics), surprise and the encounter-table source, and loot distribution. Until then use the sim's attack/cast/breath choices as the monster policy.

### 9.6 Rerun

Large vector sets are not committed. Generate with `tools/wizardry6/oracle/combat3.py <maker> out.json --n N --seed S` for makers `summon`, `flee`, `encounter`, `breath`, `engine`, `spells`, then run the tests with `W6_SUMMON_VECTORS`, `W6_FLEE_VECTORS`, `W6_ENCOUNTER_VECTORS`, `W6_BREATH_VECTORS`, `W6_ENGINE_VECTORS`, `W6_SPELL_VECTORS` set to the file. Encounter sets are large (about 40 KB per vector); generate in the background.

## 10. Pass 5 (2026-11-25): item actions, party order, the world clock, camp, wandering encounters, chest disarm

Method as before (`oracle/combat4.py`): the routine runs under Unicorn on synthetic state with presentation stubbed and the C-runtime exchange helper (`-32124(A4)`) and the bit-field reader (`-32478(A4)`) running for real; the TypeScript port (`itemuse.ts`, `randenc.ts`) runs on exactly the bytes the game read and throws on any other read; writes, logged callees and the generator state are diffed. Every group has null controls. Where a routine is only half harnessable (the front half is a menu), the harness enters it mid-function with a fake `LINK` frame (`run_mid`) and says so.

> ### W6 rules status (2026-11-25, after pass 6; the clean build guide for sections 7-11)
> **Verified against the game (harness: the real routine run under Unicorn, a TypeScript port diffed on bytes, RNG state and logged calls, null controls):** the random generator; character record, level-up, creation arithmetic; attack resolver, weapon effects, SetStatus and kill cleanup; monster planner, round driver and executor; the cast gate and all spell engines (82 of 82 ids, 79 with a combat effect); summons; hide, run, breath; encounter start (group build, companion chain); use item, party swap; **end of fight** (party upkeep with poison deaths, group compaction with monster regeneration, buff and cloud decay, record write-back, XP split, treasure roll, item list: section 11); the world clock, camp, hunger, wandering encounters; the **scripted-spot trigger** (region flood, exploration entry and per-move test, entity kinds 4 and 5, zone indicator: section 11); chest disarm decision.
> **Read from code, not executed:** the chest trap effect catalogue (11.5), the chest menu, the out-of-combat cast LAB_1D0D, the pre-roll chest step LAB_1D5C, group renumbering and the mist transformation in LAB_09DC, thief skills other than disarm, inspect.
> **Established absent (code census, 11.3):** monster flee, monster morale, encounter-start surprise rolls, monsters using hide or run.
> **Open:** spells 26, 28, 29, 44, 54, 69, 74, 79 are code cases in `spells.ts` (verified, not yet table data); the other 19 entity kinds of LAB_06B6 (11.5); map-side cloud decay; the encounter treasure id source (`record +162`, hyp); LAB_09DC's second half; the item divvy screen LAB_1D2D (UI); the generator seed. TODO ids: `w6-victory-flow`, `w6-world-rules`, `w6-stubbed-entity-kinds`, `w6-rng-seed`.

### 10.1 Status

| System | Code | Grade | Vectors generated (0 mismatches) | Committed subset |
|---|---|---|---|---|
| Use item `LAB_0F8A` (`CODE+0x275f0`) | `itemuse.ts` `useItem` | **harness** | 300 | `useitem-vectors.json` (90) |
| Party swap `LAB_0FDB` / `LAB_0FDA` (`CODE+0x286c0` / `0x285be`) | `swapParty` | **harness** | 300 | `swap-vectors.json` (24) |
| Post-combat sort and outcome `LAB_0A03` (`CODE+0x17814`) | `postCombat` | **harness** | 300 | `postcombat-vectors.json` (24) |
| Member time tick `LAB_07FA` (`CODE+0x120da`) | `tickMember` | **harness** | 400 | `tick-vectors.json` (60) |
| Camp `LAB_0808` (`CODE+0x12456`) with `LAB_07A0` (minute timers) | `restParty`, `tickTimers` | **harness** (the tick inside is the verified one) | 200 | `rest-vectors.json` (20) |
| Per-step world tick, `LAB_08AE`..`LAB_08BD` (`CODE+0x13d60`..`0x13f1c`, entered mid-function) | `stepTick` | **harness** | 300 | `steptick-vectors.json` (24) |
| Random-encounter pick `LAB_0732` / `LAB_072E` (`CODE+0x1017a` / `0x1010a`) | `randenc.ts` | **harness** | 400 | `encpick-vectors.json` (60) |
| Chest disarm decision (`LAB_1C5B` from `CODE+0x4ca82`, entered mid-function) | `disarmChest` | **harness** | 300 | `disarm-vectors.json` (40) |

Null controls (all in `__tests__/itemuse.test.ts`, `randenc.test.ts`): another generator state, a wrong item kind, a wrong swap target, an unsorted party, a different elapsed time, another class slot, another level or tier threshold. Each fails as it should. The simulator also takes the actions: `PartyPlan` `useitem` and `swap` (`item-sim.test.ts`, with nulls: an inert item, no swap), and `hasFled()` now runs the verified `postCombat`.

### 10.2 Item and order actions (**harness**)
* **Use item.** Only a party member does anything (a monster's use is a delay). The item id is the member's slot `A[10]`. Item record (scenario section 1, 74 bytes at `0x380 + id*74`, **data**): word `+28` = `(power << 8) | spell`, byte `+60` = kind, byte `+69` = subkind. Word 0: nothing happens (message only, the item stays). Otherwise the item is **always used up** (`use_ammo`, `inventory.ts` `removeItem`). Kind 13 casts with training skill `0x18`; kinds 12 and 16 cast untrained; any other kind with a spell id below `0x50`: a non-zero power byte casts trained on skill `0x16`; a zero power byte lets a class-6 member derive `power = skill(+320)/15 + 2 - spell level` (clamped 0..6, trains skill 12 x1), anyone else gets power 0 (no cast). Subkind 7 sets `-15126 = 1` and cancels the training. Cast roll `r = Random(level*10 + power*5) - 10` (unsigned word: a negative value always counts as above the skill); trained skill `S` (record `+308+k`): `r > S` then `Random(36) > luck(+307) + 18` is a backfire (`-10484 = 1`), otherwise a fizzle (`-10482 = 1`); the spell row's flag byte (`+3`) bit 1 lets a backfire stand (else it becomes a fizzle) and bit 0 lets a fizzle stand (else it is forgiven). A fizzle ends it; a backfire retargets the user; then `LAB_0F06(A, spell, power)` (`castEffect`).
* **Swap `LAB_0FDB(a, b)`.** Moves member `a` to position `b` by exchanging records two places apart (rows alternate by index parity) plus one neighbour exchange when the parities differ. `LAB_0FDA(x, y)` swaps the 432-byte record, the 44-byte combat struct and the two word tables at `-15330` / `-15318`.
* **Equip `LAB_0FC4`** is only a screen change (game state `0x11`, return `0xd`); the executor already does that. **code**: no rule.
* **Post-combat `LAB_0A03`.** Sorts the party ascending by record byte `+417` (condition; exchange sort, records, structs and word tables together), then: every member `>= 2` sets `-18608 = 8` (the party is lost); otherwise any combat struct `+43 == 2` (a successful run) sets `0x17`; both set `-15130 = 1`.

### 10.3 The world clock, hunger, camp (**harness**)
* **`tickMember(i, hpDie, stamMult, dt, spFlag)`** (`LAB_07FA`): skipped at condition `>= 3`. `HP += Random(hpDie) + regen(+418)*dt - poison(+419)*dt - disease(+420)*dt`, capped at max (`+26`); `HP <= 0` kills (condition 3, stamina 0, game message). `stamina <= 0` sets the exhaustion counter `+292 = Random(6)+6`. With `stamMult > 0`: `v = max(+30) * stamMult / 100`, stamina `+= Random(v/2) + v/2 + 1`, capped. The ten status timers `+290..+299` fall by `dt` (255 = permanent, floored at 0). Disease byte `+420` and `+295` clear together when either is 0. With `spFlag`, each of six spell-point pools gains `Random(rate(+284+k) + 1)`, capped at its max.
* **Per step `stepTick`**: the clock `-18302` advances 1. At `clock % 10 == 5` every living member ticks (dt 1, no dice) and the one whose index equals `(clock % 60) / 10` also pays hunger (stamina `-= encumbrance byte(+421) + 1`, floored 0) and regains spell points. No member at condition 0: state 8 (the party is lost). Every member with an exhaustion counter (`+292` or `+293`): the party camps by force (`restParty`); an interrupted camp starts an encounter. Otherwise **`Random(1000) >= 995` (0.5 percent per step) starts a wandering encounter** (the id from 10.4, `-15100 = 0`, state 10).
* **Camp `restParty`**: up to 8 rest minutes. Each: exhaustion counters set to 10, the clock `+60`, the six party-wide minute timers (`-18138 + 4k`: light and the like; the paired word at `-18136 + 4k` clears at 0 for `k > 0`) fall by 60, every member ticks (dt 6, spell points on, stamina regeneration = record `+423` percent, hit-point die = `+422 + 1` only while "4-minute chunks" owed since the last camp remain: `acc += clock - lastClock`, one chunk per 240 of `acc/60 >= 4`), exhaustion counter re-rolled `Random(5)`, disease `-1`, one random member's counter zeroed; then **`Random(1000) >= 975` (2.5 percent) interrupts the camp** (returns 1). At the end a member above 3/4 of max stamina loses the exhaustion counter. A key press aborts in the game; the harness holds the key check at "none".

### 10.4 Random encounters (**harness** for the pick, **code** for the trigger)
* **Pick.** `LAB_0732(level)`: `pick = Random(100) >= chance(level)` (byte `block+1334+level`); the group nibble is 4-bit field `level*2 + pick` of the array at `block+1322` (packed little-endian, `getField`). `LAB_072E(group)`: column `Random(100) % 4`, tier by `Random(100)` (`< 74` tier 0, `< 92` tier 1, else 2); monster id = `block[group*12 + column*3 + tier]`. The block is the level table behind `-18462(A4)` (`data-structure.md` already locates these fields). Wandering encounters write the id to the word the pointer at `-18306(A4)` names, with `-15100 = 0` (not scripted).
* **Scripted spots (code).** At level load (`LAB_073F`, `CODE+0x103e8`) the bit-map at `-18018(A4)` is cleared and each of five per-level spots (3-bit x/y fields at block `+1274` / `+1298`) arms a region by flood fill (`LAB_0735`, over open edges, `CODE+0x101ca`). After a step (`LAB_08A7`, `CODE+0x13c54`) the cell's bit starting an encounter uses the same pick with `-15100 = 1` (scripted). **Resolved in pass 6 (section 11.2, harness):** the clear at `CODE+0x13ca4` is an entry action; the bit test at `0x13ce8` repeats in the exploration loop after every move.

### 10.5 Chest disarm (**harness** for the decision)
The player names the trap among a menu of 16 (`LAB_1C5B`, the menu is UI); a wrong name springs it. Otherwise chance `= level(+36) + (+323)/2 + (+304)/2 - 2*dungeon level`, `+ (+304)*3` for class 3 (trains skill 15 x3) or `+ (+304)*2` for classes 4, 6, 13 (trains skill 15 x2), clamped 5..95. `Random(100)`: below the chance, disarmed; above `100 - (100 - chance)/3`, the trap goes off; between, nothing (retry). **Open:** the trap effect on opening (`LAB_1D0D`) and the trap types' effects (names in section 4), inspect.

### 10.6 Corrections (2026-11-25)
> **Correction (2026-11-25):** section 9.4 said message 3512 ("CALLS FOR HELP!", `CODE+0x19542`) was a monster **call-for-help action**. It is not. It is the banner `LAB_0AB5` (`CODE+0x1934a`) prints when a fight starts with more than one group and the return state `-18608` is `0x12` (a maze-launched encounter): "<first group> CALLS FOR HELP!" announces the companion groups, which `LAB_0A31`'s companion chain (section 9.2, **harness**) already creates. No separate monster AI exists there; the call also sets presentation flags `-10862 = (state != 0x12)`, `-10840 = (state == 0x12)`. **code**.
> **Correction (2026-11-25):** group trailer byte `+412` (called the "engaged flag" in section 9.2 and `encounter.ts`) is an **identified flag**: every consumer (`CODE+0x1999a`, `0x1ad02`, `0x21c34`, `0x173fe`, `0x197ce`) uses it as `record + (flag << 5) + (count == 1 ? 0 : 16)`, the name string to display (unidentified vs real, singular vs plural). `LAB_09D0` is therefore the party's **monster-identification check**; groups it leaves at 0 still fight. The simulator's `evaded` field is that set. The arithmetic stays **harness**.
> **Correction (2026-11-25):** member byte `+0x2b` (section 7.1 "surprise flag"): the same byte is the hide / run / blink state used by the executor (`+43`: 1 hidden, 2 fled, 3 blinked) and the attack resolver's "surprise" bonus is the **hidden attacker** bonus (value 1 is consumed to `0xff` by the attack and restored to 1 afterwards, `CODE+0x208c2`, `0x20a72`). No party-surprised / monsters-surprised roll was found at encounter start; none exists in `LAB_0A31`, `LAB_09D0` or `LAB_0AB5` (**code**, absence argued from those three routines). `hasFled()` is now the harness-verified `postCombat`.
> **Correction (2026-11-25):** section 8.2 listed "hide, run, swap, equip, use item" as not ported: hide and run were ported in pass 4, and use item and swap now are; equip is a screen change.

### 10.7 Morale, flee, loot (**open**)
No HP-based monster morale or flee exists in the harnessed planner (`LAB_0C63`/`0C96`), executor (`LAB_0FF9`) or round driver (`LAB_102D`); monsters leave only by death, by the mist transformation (record `+220` bit 2 against a statused target, message 3218) and by the status effects. **Established absent in pass 6 by a writer census (section 11.3); loot is harness-verified (11.4).**

### 10.8 Not done
* Searching, thief skills (inspect, pick locks, find traps), per-turn status effects beyond `tickMember`, cloud decay on the map, doors and traps beyond movement (TODO `w6-world-rules`).
* The hand-written non-affine spell cases in `spells.ts` remain code, not exported tables (`rules-tables.ts` exports the affine recipes only).
* (Pass 6: the scripted-spot trigger and the zone code are done, section 11.)

### 10.9 Rerun
`tools/wizardry6/oracle/combat4.py <useitem|swap|postcombat|tick|rest|steptick|encpick|disarm> out.json --n N --seed S`, then the tests with `W6_USEITEM_VECTORS`, `W6_SWAP_VECTORS`, `W6_POSTCOMBAT_VECTORS`, `W6_TICK_VECTORS`, `W6_REST_VECTORS`, `W6_STEPTICK_VECTORS`, `W6_ENCPICK_VECTORS`, `W6_DISARM_VECTORS`. Use item needs the scenario file (read through the game's `ReadSection` by the harness).

## 11. Pass 6 (2026-11-25): the scripted trigger, absence of morale and surprise, the end of a fight, loot, the world remainder

> ### W6 rules status (pass 6): see the block at the top of section 10. This section adds what pass 6 verified or established.

Method as passes 2-5 (`oracle/combat5.py`, same footprint rule: the port throws on a read outside what the game read; every group has null controls). `-18330(A4)` is the **region** (a 0-based 8 x 8 window, 12 per level) inside the loaded level `-18340(A4)`; `-18334` / `-18332` are the party x / y inside the region. Earlier sections called `-18330` the level.

### 11.1 Status

| System | Code | Grade | Vectors generated (0 mismatches) | Committed subset |
|---|---|---|---|---|
| Region set / clear flood `LAB_0735` (`CODE+0x101ca`) | `scripted.ts` `setRegion` | **harness** | 300 | `region-vectors.json` (40) |
| Exploration entry `LAB_08A7` (`CODE+0x13c54`..`0x13d26`) | `exploreEntry` | **harness** | 300 | `entry-vectors.json` (40) |
| Per-move scripted test `LAB_08AA` (`CODE+0x13cc4`) | `scriptedTest` | **harness** | 300 | `loop-vectors.json` (40) |
| Entity kind 4 `LAB_062F` (`CODE+0xcf1c`) | `entityKind4` | **harness** | 300 | `kind4-vectors.json` (40) |
| Entity kind 5, inline in `LAB_06B6` (`CODE+0xea30`) | `entityKind5` | **harness** | 300 | `kind5-vectors.json` (40) |
| Zone indicator after `LAB_08BD` (`CODE+0x13f1c`..`0x13fde`) | `zoneIndicator` | **harness** | 300 | `zone-vectors.json` (40) |
| Member upkeep `LAB_09BA` (`CODE+0x1693e`) | `endcombat.ts` `memberUpkeep` | **harness** | 300 | `upkeep-vectors.json` (40) |
| Group compaction `LAB_09C8` (`CODE+0x16be2`) | `compactGroup` | **harness** | 300 | `compact-vectors.json` (16) |
| Buff and cloud decay `LAB_0AA2` (`CODE+0x19144`) | `decayBuffs` | **harness** | 300 | `decay-vectors.json` (20) |
| Record write-back `LAB_0A02` (`CODE+0x1775e`) | `writeBack` | **harness** | 300 | `writeback-vectors.json` (20) |
| Post-combat `LAB_0A03` with the real `LAB_09BA` / `LAB_0A02` | `postCombatFull` | **harness** | 300 | `postfull-vectors.json` (10) |
| Victory XP split `LAB_1D9A` (`CODE+0x5031a`) | `xpSplit` | **harness** | 300 (vectors with nobody living are skipped: the game divides by zero) | `xpsplit-vectors.json` (30) |
| Treasure roll `LAB_1D76` from `CODE+0x4fe28` | `lootRoll` | **harness** | 300 | `loot-vectors.json` (40) |
| Spell dispatcher after moving the hand cases into `spell-cases.json` | `spells.ts` | **harness** | 1,500 fresh + the committed set | `spell-vectors.json` |

Null controls (`scripted.test.ts`, `endcombat.test.ts`, `spell-tables.test.ts`): clearing with the wrong value or the wrong cell; testing the spot before the clear; ignoring the 0x17 skip; another generator state; forcing the group pick for entity kind 4; a wrong cursor; another map number; no poison; keeping the dead; a flat buff decay; another member; the wrong divisor; an inverted treasure percentage. Each fails as it should. The simulator has `CombatWorld.finishFight` (`finish-sim.test.ts`) composing the end-of-fight pieces on a won fight.

### 11.2 The scripted-spot trigger (**harness**) - resolves `w6-encounter-trigger`
The region clear at `CODE+0x13ca4` does precede the armed-bit test, and that is the design. The state machine runs `LAB_0722` for the states 5, 6 and 0x17 (switch table at `CODE+0x1528`). `LAB_08A7` is the **whole exploration routine**, not a post-step hook: its first half (`CODE+0x13c54..0x13cc2`) runs once on entry, then a loop starts at `LAB_08AA` (`CODE+0x13cc4`), and every movement or turn command branches to `LAB_08CD`, which jumps back to `LAB_08AA` while the state is still 5 (`CODE+0x14292`). So:
* **Entry** (arrival on a level, return from a fight, a spell, a menu): raise `-18148` to the region's first entity index (`block B + 1728 + region`); unless the return state `-18608` is 0x17, `LAB_0735(region, x, y, 0)` clears the bit of the party's region and erases every scripted spot (block `+1274` / `+1298`, five 3-bit x/y fields per region) on the cell; redraw; set `-18608 = -18610 = 5`.
* **Per move** (`LAB_08AA`..`LAB_08AB`, no clear): bit `region*64 + y*8 + x` of the bit-map at `-18018(A4)` (96 bytes). Set: pick `group = encounterGroup(region)`, `id = encounterMonster(group)` (`randenc.ts`), store `id` through the pointer at `-18306(A4)` (which is `-15102(A4)`, the encounter id word), `-15100 = 1` (scripted), `-15128 = 0`, state 10.
* The bits are armed at level load (`LAB_073F`, `CODE+0x103e8`): bit-map zeroed, then `LAB_0735(region, x, y, 1)` for each spot with `x + y > 0`, flooding over open edges (the 2-bit edge fields at block `+96` and `+288`: field 0 = open; recursion south / east / north / west, bounded by 8). A scripted fight fires once: after it, the next entry clears the region and its spots.
* **Why 0x17 matters:** return state 0x17 is a successful flee (`LAB_0A03` sets it; the retreat `LAB_08E4` walks the party back along its path). The entry then skips the clear so the retreating party does not erase the region it fled from, and the per-move test can fire again. In all other states a region's bits survive only until the next entry; the harness shows: entry fires only from 0x17 or never at the entry itself (the bit is cleared first), while the loop test fires from any state.
* The earlier reading "after a step `LAB_08A7` ..." was imprecise: the clear is an *entry* action.
**Encounter id sources (code, kinds 4 and 5 harness):** a wandering encounter (0.5 percent per step, camp interruptions) uses the random pick (10.4). A scripted spot uses the same pick with the scripted flag. **Entity kinds 4 and 5** (the arrival dispatcher `LAB_06B6`, jump table `CODE+0xeafc`; kind = byte `+864` of the level block, cursor `-18148` = entity index) carry the id in their **operand byte** (`B + 1584 + index`, `B` = `-18458(A4)`): kind 4 (`LAB_062F`) uses it as a monster id, or as a group for the random pick when bit 3 of the entity word `B + 576 + 2*index` is set; it shows message `(word >> 4) & 3`, sets `-15100 = 1`, `-15128 = 1` (no fleeing), state 10 and advances the cursor. Kind 5 uses the operand as the id, sets `-15100 = 1`, state 0x12 (the maze-launched encounter path of 10.6) and advances the cursor. Others that set `-15102`: the NPC reaction (`CODE+0x422a6`, `0x47594`, `0x476f6`: byte `-8824(A4)`, the NPC's monster id, after a refused or hostile talk; state 10, return state 0x12). The "map-script operand" of the old TODO is this operand byte.

### 11.3 Monster morale, flee and surprise: established absent (**code**, whole-code census)
Done as a census of every writer of the relevant bytes in `Bane.asm` (grep of the displacement forms plus the block copies) rather than a search by name. Findings:
* **Member state byte `+34`** (0 ok, 1-2 impaired, 3 dead): writers are `CODE+0x16a46` (death in the upkeep `LAB_09BA`), `0x22dc6` (kill cleanup), `0x230d8` (SetStatus with its argument), `0x28d32` (the executor's **mist transformation**: a monster whose record `+220` bit 2 is set that acts against a statused target removes *itself* afterwards, state 3 and its formation cell freed; the one way a monster leaves without being killed, already in 10.7) and the party-record load `0x164c4` (record `+417` to the member); every other write is a 44-byte block copy (compaction, swap). There is **no fled state**.
* **Hide / run byte `+43`** (1 hidden, 2 fled, 3 blinked): set at `0x28418` (hide), `0x2857c` (run), `0x28b84` and `0x2978a` (blink); consumed and restored by the resolver (`0x208c2`, `0x20a72`, `0x20b84`); cleared at `0x16bd6`, `0x2980c`, `0x2988a`. Hide and run are executor actions 6 and 7 (`A[30]`); the only writers of `A[30]` are the party command code (`0x1dc6a`, `0x1e012` = 7) and the monster planner `LAB_0C63` (`0x1e47e` = 3 spell, `0x1e61a` = 8 breath, and 0 = melee). **Monsters never plan hide or run.**
* **Group count `+413`** (members present): writers are the group build (`0x160d8`), the clears at encounter start and group removal (`0x15e6a`, `0x16f62`), the party count, the summons (`0x24b06`..`0x24b60`, clamped 1..9) and **the compaction `LAB_09C8` (`0x16cd6`), which keeps only members below state 3**. Nothing decrements it for a monster that left alive.
* **Initiative byte `+41`**: writers are the per-fight decay (`0x16bb0`) and two spell engines (`0x24316`, `0x25330`). No surprise write exists; `LAB_0A31`, `LAB_09D0` and `LAB_0AB5` (encounter start) contain no surprise roll (also section 10.6).
* Monster HP (`+2`) is written by the resolver and kill path, the upkeep `LAB_09BA` (regeneration, poison) and healing spells; no routine compares a monster's HP with a fraction of its maximum to change its behaviour.
Conclusion: **the game has no monster flee, morale or surprise rule**; a remake must not invent one. The 100 percent evidence for the compaction and upkeep is the harness in 11.4; the census itself is **code** (static, complete for the displacement forms searched; computed addressing through an index register would not show up, which is why the group-count and state writers were cross-checked through the compaction).

### 11.4 The end of a fight (**harness**)
The victory handler `LAB_0AB0` (`CODE+0x192c2`) runs: `LAB_0A03` (party), `LAB_09DC` (monster groups 1..), `LAB_09C8(6)` (allies), `LAB_0AA2` (decay), the death handlers when the party fled or lost (`-15130 = 1`), else state 0xb; the victory screen then runs `LAB_1DA1` (XP split, treasure).
* **Member upkeep `LAB_09BA(group, i, a, b)`, once per member per fight** (party in `LAB_0A03` with `a = record +418`, `b = record +419`; monsters in `LAB_09C8` with `a = monster record +215`, `b = 0`): while the exhaustion counter `+16` is set, stamina regenerates `Random(max*5/100) + 1` (capped); stamina at or below 0 becomes 0 and sets `+16 = Random(6) + 6`; HP changes by `a - b - poison(+35)`, capped at the maximum; at or below 0 the member dies (HP 0, stamina 0, state 3, returns 1). A dead monster frees its formation cell (`+42`: three tables at `-15124`, `-15114`, `-15160`) and, if its record's `+220` bit 0 is set, sets the unique-slain bit `record[+218]` in the array at `-30150(A4)`. Then the ten status counters `+14..+23` fall by one (0xff permanent), poison `+35` clears when counter `+19` is 0, initiative `+41` moves one step to 0, blink `+36` falls, hide state 3 clears. **Monster record `+215` is a per-fight hit point regeneration** (open item `+0xd7` of `monster-stat-block` answered); poison and the party's `+418` / `+419` drains are applied here for a whole fight at once.
* `LAB_0A03` (`postCombatFull`): upkeep for every member below state 3, the death handler `LAB_0A1E` for those that died (UI, recorded), write-back `LAB_0A02` for all, then the sort and the wiped (8) / fled (0x17) decision of 10.2. A poison death after the last blow can therefore wipe the party.
* `LAB_09C8` (`compactGroup`): upkeep of every member below 3, then the survivors are packed to the front in order and `+413` is the new count.
* `LAB_0AA2` (`decayBuffs`): group trailer `+396..+401` lose `max(1, v / d)` with `d` = 10, 10, 12, 12, 20 and a flat 1; `+402..+405` (clouds) lose 1; `-18120` follows the party's `+400` while `-18122 > 0`.
* `LAB_0A02`: HP `+2` to record `+24`, stamina `+6` to `+28`, state `+34` to `+417`, counters `+14..+23` to `+290..+299`, poison `+35` to `+420`.
* **XP split `LAB_1D9A`:** pool `-15300` divided (signed 32-bit) by the number of members with `+417 == 0`; each gets it added at `+12`. No living member divides by zero (not reached in play after the wipe check, except an all-impaired party: unverified).
* **Treasure roll `LAB_1D76`:** after the chest pre-step `LAB_1D5C` (UI), the record (`ReadSection(7, id)`, 40 bytes: six `{A u16, B u16, type u8, pct u8}`) is rolled per entry with `Random(100) < pct`: type 1 gold `Random(A - B) + B`, type 2 item `A + Random(B)` (kept when > 0), type 4 bonus XP `A * B`, anything else nothing. Nobody living: state 8. Gold is divided among the living (signed); each listed item reads its record (`ReadSection(1)`): kinds the table at `-31716(A4)` marks 1 roll `base + count` dice of `sides` (bytes `+20..+23`) for a quantity, else 1; per item `-8674` quantity, `-3112` quantity times the record word `+30` (value), `-8464` record byte `+61`, `-3100` record bit 1 of `+59`; the living gain the bonus XP at `+12` and the gold share at `+20`. The loot-divvy screen `LAB_1D2D` (giving items to characters) is UI and stays open (`w6-victory-flow`).
* **Not ported:** `LAB_09DC`'s second half (moving later groups down when a group empties, and the formation-cell values 0x0b / 0x0c that become 3 / 4 and set `-15154` / `-15152`: the mist transformation bookkeeping, **code**), and `LAB_1DA4`, the chest variant of the treasure routine (return state 0x15, raises `-18148`).

### 11.5 World rules, what is read and what is open
* **Zone indicator (harness):** on level 5, and level 12 above region 8, a set bit at the party's cell in the zone bit array (block `+1082`) shows message 2023 and sets `-10894 = 1`; on level 8 with `-18136 = 1` (flying, set by the water-crossing state) message 2054; otherwise the flag clears. The bit-map clear and flood is 11.2.
* **Chest menu (code):** `CODE+0x4fb10` (open), `0x4fb60` (inspect: trap id `-3236(A4)` shown through `LAB_1D56`, then `LAB_1C4B`), `0x4fbc4` (disarm; decision in 10.5), `0x4fd08` (cast a spell: `LAB_1D0D`). `-3132 = 1` after a spell means opened, `-1` means the trap fired.
* **Correction (pass 6): `LAB_1D0D` (`CODE+0x4e870`) is not a trap effect.** It is the out-of-combat cast: the chosen spell (`LAB_1CCB`) costs the caster `spPerPower * power` of the pool at record `+40+4*realm`, runs the effect through `LAB_1C80`, then charges stamina `Random(power) + spellLevel + power` (an exhaustion counter `+292 = Random(6) + 6` when it falls below 0). It repeats the cast gate's cost rules.
* **Chest trap effects (code, `LAB_1C0D` at `CODE+0x4ba56`, called with the trap id from `-3236(A4)` and the opener):** 15 types, each an animation id (`LAB_1C0B`) and presentation helpers `LAB_1BFC(member, dice, sides)` (damage), `LAB_1C02(member, msg, ...)` (status application with percentages 50 / 10 / 10), `LAB_1BF8(member, msg, kind, n)` (instant condition). By id: 1 every member takes `(level + 1)d8`; 2 paralysis gas (message 5253) on all; 3 and 9 nothing (alarm-class); 4 poison needle on the opener (1d6 and POISONED); 5 a per-member crossbow: blinding and damage; 6 weakness (a strength point lost, 75 + record `+x` percent); 7 no effect beyond the animation; 8 vitality or hit point loss `Random(4) + 1`; 10 petrification of all (message 5263); 11 animation only; 12 the phantasmal hand: one random member beaten for `(level + 1)d8` twice, a choke message; 13 every member `(level + 1)d8` and nauseated (5275); 14 `(level + 1)d10` to all; 15 everyone slain (message 5260, kind 3). This is a **code** catalogue; the arguments were read, not harnessed (`w6-world-rules`).
* **Open, with the smallest next step:** thief skills other than disarm (inspect: `LAB_1D56`, `LAB_1C4B`) and pick locks; the 19 other entity kinds of `LAB_06B6` (kinds 1, 2, 3 teleport / stairs / messages: `LAB_05D4`, `LAB_05BB`, `LAB_05DA`; kind 6 `LAB_05EA`...) - each is a mid-function harness like kind 4; cloud decay on the map (no routine found: the clouds the game decays are the group clouds of 11.4); per-turn status effects other than the ones in the upkeep and `tickMember` (none found beyond them).

### 11.6 Spell tables
The hand-written cases of the dispatcher that only write state are now data: `tools/wizardry6/spell-cases.json` (ordered operations per spell id; the same file `spells.ts` interprets), exported in `rules-tables.json` as `spellDirectCases` next to `spellEffectRecipes`. 28 ids are table data (3, 7, 10, 14, 15, 16, 21, 23, 25, 30, 31, 37, 38, 41, 43, 49, 51, 53, 57, 64, 67, 68, 70, 72, 75, 80, 81 plus the recipe spells); eight remain code because they depend on engine results or several unrelated writes (26 poison and disease, 28 dispel clouds, 29, 44, 54, 69, 74, 79). `spell-tables.test.ts` pins that every id is a recipe, a data case, a summon, a no-effect id or one of the eight.

### 11.7 Corrections
> **Correction (2026-11-25, pass 6):** `LAB_09BA` is **not** a portrait redraw (section 10.2/`itemuse.ts` comments, pass 5). It is the per-member upkeep (11.4). Pass 5's `postCombat` harness stubbed it with return 0, so the poison-death branch of `LAB_0A03` was never exercised; `postCombatFull` runs it for real. The pass-5 `postCombat` and its vectors stay as the stubbed variant.
> **Correction (2026-11-25, pass 6):** the 10.4 remark that `LAB_08A7` runs "after a step" and that the clear "precedes" the test as an unresolved ordering was wrong: the clear is an entry action and the test is repeated in a loop (11.2). `-18330(A4)` is the region, not the level.
> **Correction (2026-11-25, pass 6):** `LAB_1D0D` is the out-of-combat cast, not the chest trap effect (11.5); the trap effects are `LAB_1C0D`.
> **Correction (2026-11-25, pass 6):** section 10.7 said monster morale and flee were "not proven absent in the 80 KB of code": 11.3 now establishes it by writer census.

### 11.8 Rerun
`tools/wizardry6/oracle/combat5.py <region|entry|loop|kind4|kind5|zone|upkeep|compact|decay|writeback|xpsplit|loot|postfull> out.json --n N --seed S`, then the tests with `W6_REGION_VECTORS`, `W6_ENTRY_VECTORS`, `W6_LOOP_VECTORS`, `W6_KIND4_VECTORS`, `W6_KIND5_VECTORS`, `W6_ZONE_VECTORS`, `W6_UPKEEP_VECTORS`, `W6_COMPACT_VECTORS`, `W6_DECAY_VECTORS`, `W6_WRITEBACK_VECTORS`, `W6_XPSPLIT_VECTORS`, `W6_LOOT_VECTORS`, `W6_POSTFULL_VECTORS`. The loot maker reads the scenario file through the game's own `ReadSection`.

## 6. Hypotheses to treat with care
Anything marked **hyp** above (and in section 7: member `+4`, the names of `+0x22` states and `+0x1e` stances, the simulator round loop). In particular: `-10456(A4)` flag, byte meanings of treasure tail bytes 36-38, `+321` skill mapping in 2.4, record `+162` as treasure id, and the group/member struct field names in 2.3.

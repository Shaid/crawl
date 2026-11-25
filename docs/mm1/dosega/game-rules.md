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
| Overlay execution: header, special-cell dispatcher CS:0xF4A1 (cell, facing, miss, no-mask, handler), 300 whole special-cell runs through real handlers + MM.EXE helpers (`stanp`, `erase`, `random`, `encountr` ...) | `tools/mm1/ovr.ts` + `x86.ts` (8086 interpreter run on the executed bytes) | harness (ovdisp 300, ovcell 300 vectors, 54 of 55 overlays; null controls) |
| Per-map special-cell event table (55 overlays, 816 dispatched cells, 628 handlers, 55 miss paths) | `tools/mm1/export-events.ts` -> `public/assets/mm1/dosega/data/ovr-events.json` | harness exploration (85.8 % of reachable handler instructions executed) + TS re-derivation of dispatch / texts / destinations / flag cross-check (0 disagreements) |
| Town services run from the game's bytes: food 0x1DF3, general store `blacks` 0x2196, temple 0x1F2D, tavern 0x2544, training hall 0x1B08, trap effect 0x3D65 | `x86.ts` replay (`runTown`) | harness (200-300 vectors each, strict reads/writes/UI log; null controls) |
| Loader pieces: screen key `loadmaze` 0xD71, cell loader `draw` 0xF45..0xFA3 (cell id quirk, dark rule) | `ovr.ts` `screenKey`, `cellLoad` | harness (100 / 600) |
| Chest-open flow 0x3740/0x3749 -> 0x3752 (trap roll, open / find-remove trap / detect, payout, class gate `trap` 0x3BE7) | `x86.ts` replay (`runTown`), section 6.1 | harness (3000 + 300 vectors; null controls) |
| Inventory commands equip 0x7A67 / remove / trade / discard, combat option line `poption` 0xBE00 (class and alignment masks, equip slots) | `x86.ts` replay, section 6.2 | harness (3000 / 1500 / 1500 / 600 / 600 vectors; class-byte null controls) |
| Still open: thievery/skills beyond lock/bash/search, class-specific rules beyond the inventory in section 5, internals of the terminal screens (`statue` 0x276C, `loadnext` chain, `encounter` 0x2F87 wrapper, `getinfo` 0x46CB, `gatgold` 0x7636), handlers' unreached 14 % | **open** | `mm1-rules-world`, `mm1-ovr-code` |

### Build guide (what a remake takes from this)

| Need | Take | How it is verified |
|------|------|--------------------|
| Combat, spells, damage, XP, training, creation | `tools/mm1/rules.ts`, `spells.ts`, `after.ts` (hand ports, byte-for-byte read/write footprint) | `npx vitest run tools/mm1` against `rules_oracle/vectors/*.json.gz` (full sets: `rules_oracle/gen_vectors.sh`, needs a venv with unicorn + capstone, MM.EXE under `data/mm1/dosega/`) |
| Movement, doors, rest, pooling, greeting, search/lock/bash | `tools/mm1/world.ts` | same |
| Cell loading (cell id, wall/layer byte, dark rule), screen-key (`loadnext` destination) | `ovr.ts` `cellLoad`, `screenKey`, `dispatch` | same (`ovr.test.ts`) |
| What each special cell does on each map | `public/assets/mm1/dosega/data/ovr-events.json` (made by `buildAssets` from `tools/mm1/rules_oracle/ovr-events.json.gz` + the game files; per-map `cells` x `facings` -> `handlers` -> `outcomes`, `missPath`, `flaggedNoHandler` = encounter squares) | `export-events.test.ts` (0 disagreements) |
| Anything the tables do not say (gated outcomes, town screens, trap effect) | run the real bytes: `x86.ts` + `ovr.ts` `runOverlay` / `runTown` with your own stubs for the screen layer | replay of recorded executed bytes, strict memory |
| Town prices / stock / temple costs | `town-tables.json` | read from MM.EXE tables; flows replayed |

Rules not yet covered are listed in `docs/mm1/TODO.md` (`mm1-rules-world`, `mm1-ovr-code`).

Addressing: image = `MM.EXE[0x200:]`; CS base = image 0; DS = CS+0x107B
paragraphs (DS:0 = image 0x107B0), SS = DS. Overlay code (CS:0xF48F) is now executed (section 5); overlay *data* (DS:0xC940, read through the pointer DS:0x132 as `getod(n)`) is modelled by random bytes in the units of passes 1-3, which is enough for every unit above that only reads it. The game code is hand-translated
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
- **Overlays** (see the 2026-11-26 correction in section 5.1 for the table layout): `.OVR` = 7 LE words (magic 0xF2, code load 0xF48F, code size, data load 0xC940, data size, bss, entry); entry installs the special-cell dispatcher into DS:0x134 and sets DS:0x132=0xC940; dispatch reads cell table at data+0x33 (count data+0x32), direction masks, word handler table; a miss goes to `erase` then `encountr`. 55 overlays / 886 special cells censused with `rules_oracle/ovr_census.py` (handlers call stanp, wait_, erase, clrbtm2, encountr, ph2, random, loadnext, blacks/food/tavern/temple/training...). 77 table entries fall outside the code (DEMON, part of PP4/AREAE2: different table layout, not analysed). (code-read, census)

> **Correction (2026-11-26):** `.OVR` header word +0x00 is the magic 0xF2 (not an entry offset), +0x02 is the code load offset, +0x0C is the real entry offset. The opcodes are now disassemblable (`rules_oracle/lst_ovr.py`). Pass 2's "qcast is code-read only" is closed.

## Open (all listed in `docs/mm1/TODO.md`)

- `mm1-rules-world`: thievery/skills beyond lock/bash/search, the chest-open flow CODE+0x3752 (disarm / open / force; needs a richer harness state), class-dependent sites listed in 5.5, the terminal screens' internals (`statue` 0x276C, `getinfo` 0x46CB, `gatgold` 0x7636).
- `mm1-ovr-code`: 14 % of reachable handler instructions never executed by the fuzz (gated paths, 5.2); the event table is a behaviour census, not a scripted-event language: a remake that wants the gated outcomes can run the handler code with `x86.ts`.

Paths tried: r2 listing (misaligned) -> custom capstone lister; first RSM parse
paired addresses with the wrong names -> re-derived and checked against code. Pass 4: translated-block cache staleness (Unicorn kept code from the previously loaded overlay and TBs built without hooks recorded no reads -> `ctl_flush_tb`); sorting the dispatcher's table addresses by a fixed data+0x33 layout (wrong, see correction); fixed 40 M-instruction run limit on runaway handler loops (hung generation -> 60 k limit, such runs are dropped).

## 5. Pass 4 findings (overlay execution, event table, town services)

Grades as in section 3. "x86 replay" = the TypeScript interpreter `tools/mm1/x86.ts` re-executes the *exact instruction bytes* the oracle executed (recorded in each vector's `code` map) over strict memory: an extra read, a different write set / value, register or UI-call log fails; every flow has null controls (shifted key script, ADC without carry-in). This replaces hand-translation for the long UI-driven routines; the formulas below are code-read summaries of those bytes, the replay is the evidence.

### 5.1 Executing `.OVR` code

- Memory model: overlay code at CS:0xF48F (inside the code segment, below DS), overlay data at DS:0xC940 (`getod(n)` = byte at `[DS:0x132] + n`, `putod` writes). The overlay's code start (CS:0xF48F) installs `DS:0x134 = 0xF4A1` (the dispatcher) and `DS:0x132 = 0xC940`; the header `entry` (+0x0C) is a C-runtime stub that zero-fills bss and calls the code start (confirmed by listing, `lst_ovr.py`).
- The game calls `special` (CODE+0xD2E: `call [DS:0x134]`) from `stclr` (CODE+0x11D3) when **bit 7 of the page-1 maze byte** (`DS:3C10`, = MAZEDATA page 1 `+0x100 + cell`) is set; `erase` (CODE+0x4449) clears that bit in `DS:3C10` and in the maze buffer `DS:3DFA + cell` (the special mark is one-shot). (code-read)
- Cell id = `y*16 + x` (`draw` CODE+0xF45; `DS:3C39` = y, `DS:3C38` = x; a `shl al,4` leaves y bit 4 in CF and the following `adc` adds it, so y >= 16 would shift the id by one - never happens in the shipped maps). The maze buffer is the 512-byte MAZEDATA record read to `DS:0x3CFA` (page 0, wall byte -> `DS:3C3C`) and `DS:0x3DFA` (page 1 -> `DS:3C10`); the same address is the roster buffer when a roster is loaded. Cell loader rule (harness, 600 vectors): a cell flagged dark (page-1 bit 0x20) shows the dark view when the light counter `DS:3C9C` is 0, otherwise decrements it; an overlay flag `getod(0x2E) & 1` also forces the dark view when `DS:3C9C` is 0 (stops 0xFA3 lit / 0x11F8 dark).
- **Dispatcher** (CS:0xF4A1, same code shape in 54 overlays, absolute table addresses patched by the assembler per overlay - read them from the instructions, `ovr.ts tableLayout`): scan bytes `cells[0..count)` for the cell id (count byte `DS:0xC972`), `facing & masks[i]` (`DS:3C3D` = 0xC0 N / 0x30 E / 0x0C S / 0x03 W) must be non-zero or the call returns through `wait1`, then `clrbtm2; call handlers[i]; clrbtm2; jmp inwait` (the handler's AL is a pending movement key). A cell not found falls to the **miss path** at CS:0xF4B5 (same address in every overlay): `erase` then `encountr` (CODE+0x45FD, sound + three text prints + `encounter` 0x2F87 whose group builder is `encGen`), or a custom jump (18 overlays) / inline block (10) in 28 overlays, and a plain `wait1` in 2. (harness: `ovdisp` 300 vectors incl. PP4/AREAE2; `dispatch()` in `ovr.ts` agrees with the real dispatcher on every vector; null control = wrong count byte)
- Handlers share MM.EXE helpers: `stanp` 0x4436 (sound 2 + text at `DS:3BD4`, row 0x15), `ph2` 0x40E1 / `ph2one` print, `wait_` 0x4582 (key), `erase`, `random` 0x451B, `loadnext` 0x509D, `statue` 0x276C (bp = statue number, the overlay stores it in its own data), shop/temple/tavern/training/food entries. Executed for real in the harness; only the screen/file layers and the terminal flows (`loadnext`, `retfmaze`, `loadgo`, `statue`, shops, `encounter`, `getinfo`, `wait1`, `inwait`) are stubbed and logged.
- The 886 "special cells" of pass 3 were `sum(count byte)` over all overlays read as `[data+0x33..]` tables. The real dispatcher reaches **821 scanned entries = 816 distinct cells** (first match wins) in the 54 table overlays; the 77 "outside the code" entries were the wrong table layout of DEMON/PP4/AREAE2 (below).

> **Correction (2026-11-26):** pass 3 said "77 table entries fall outside the code (DEMON, part of PP4/AREAE2: different table layout)" and counted 886 cells. The cell/mask/handler table bases are *per-overlay immediates of the dispatcher* (not fixed at data+0x33), and three overlays are special: **DEMON has no table** - its `DS:0x134` handler (CS:0xF4A1) is one table-less routine (a typed-word gate: 15 keystrokes compared against a short obfuscated word in the overlay data; success `loadnext`s to Sorpigal 8,5; the word itself is deliberately not recorded here) and its `data+0x32` byte is text; **PP4's count byte (20) exceeds its real table (15 entries)**, so the scan runs on into the mask bytes (`0xFF`) and the handler table: two junk "handlers" `0x2021` / `0x5245` (ASCII words) are reachable only for cells whose id equals those bytes (cells 12 and 204), which the maze does not flag special; **AREAE2's count byte (5) is smaller than its 7-entry table**, so the last two entries are dead. (harness + TS decode, `export-events.test.ts`)

### 5.2 Per-map event table (`mm1-ovr-code`)

`rules_oracle/ovr_events.py` runs every distinct handler 150 times against randomised party/map state, scripted keys and mutated overlay-data flag bytes (the bytes the handler actually reads), and records the distinct behaviours (UI/terminal call sequence, overlay-data writes, party position writes, character fields touched, maze-flag writes) with the keys that select each. Result `rules_oracle/ovr-events.json.gz` (committed, deterministic, 112 KB); `tools/mm1/export-events.ts` re-derives from the game files and **fails on any disagreement**: dispatch for all 256 cells x 4 facings, every logged text pointer -> string (each harness text must exist NUL-terminated in the overlay data / MM.EXE), every `loadnext` destination -> screen (loadmaze key tables), the special-flag cross-check. Export: `public/assets/mm1/dosega/data/ovr-events.json` (via `buildAssets`) + `town-tables.json`.

| Quantity | Value |
|----------|-------|
| overlays / dispatched cells / handlers explored | 55 / 816 / 628 (+ 55 miss paths) |
| handler kinds (by reached terminal call) | encounter 195, teleport (`loadnext`) 101, text/flag/sound only 298, statue 8, exit-to-map (`retfmaze`) 5, and 5 each of shop (`blacks`), food, tavern, temple, training |
| special-flagged cells (page 1 bit 7) | 3090 in the 55 screens: 812 have a dispatcher entry, **2278 have none and take the miss path**; 4 table entries sit on unflagged cells (dead) |
| miss paths | `erase`+`encountr` 24 overlays; custom jump 18; inline block 10; `wait1` (nothing happens) 2 (ASTRAL, ENF1); DEMON none |
| instruction coverage of reachable handler code | 15,336 / 17,872 (85.8 %) |
| `loadnext` destinations | 206 distinct executed (al,bl,bp) triples: 31 are immediate-encoded and match a static site decoded without the emulator, 175 are register-computed (table-driven teleporters) |

Destination decode (`loadmaze` CODE+0xD35/0xD71, harness `scrkey` 100 vectors): `loadnext(AL, BL, BP)` with BP = area class 0..3: `DS:0x173[BP]` is the start offset into the key-word table `DS:0x17B` (55 words `(BL<<8)|AL`), scanned unbounded; the match position is the **MAZEDATA screen index** (the same index selects the colour-set byte `DS:0x13C[i]`, the overlay file name `DS:0x1E9[i]` and the record offset `i*512`). Teleport handlers write the arrival position into `DS:3C38/3C39` first (stairs and trap doors keep the current x,y: `keepPosition`). The facing is kept.

Coverage gaps (honest): 48 of 628 handlers have unreached code, mostly the paths behind a password (DEMON), a multi-step story flag chain (ALAMAR f56c, ASTRAL f5EA, BLACKRN f710, BLACKRS f718, WHITEW f767: the 100 %-unreached ones) or specific party contents (item / class gates). Those outcomes are not in the table; the handler code itself is executable with `x86.ts` for anyone who needs them.

### 5.3 Town services (`mm1-rules-world`, partly closed)

Common: `deduct` CODE+0x2ED7 subtracts a 16-bit cost (`DS:175A/175B`) from the member's 24-bit gold (+0x39) and, on borrow, prints "no gold" (CODE+0x2437) and returns CF; a town service is entered with the town number `getod(0)` 1..5 (Sorpigal, Portsmith, Algary, Dusk, Erliquin; anything else is treated as 1). `gatgold` (G key) is the pooled gather of pass 3. Leaving (`outbl2` CODE+0x29F4) turns the party round 180 degrees (swaps the facing masks).

- **Food** (0x1DF3): Y/N; price per member `DS:0x13D6[town-1]` = 5, 10, 20, 200, 50 gold; each member who can pay gets food set to 40 (+0x3E = 0x28), others are skipped; the closing text depends on whether anyone paid. (code-read, x86 replay 200)
- **General store** (`blacks` 0x2196): keys A/B/C buy from stock list A/B/C (6 item ids per town, `DS:0x1538/0x1542/0x154C`, exported in `town-tables.json`), D sells, 1-6 pick the member, G gathers gold, ESC leaves. Buy: `getinfo` fills the item record at `DS:3CEA..`; price = 16-bit word `DS:3CEF`; needs a free slot among +0x46..+0x4B (else "pack full"), gold -= price (borrow -> no-gold), item id goes in the slot and the item's initial charge byte `DS:3CEE` into the parallel slot +0x0C. Sell: the price is halved once (`rcr`), halved again when the member's charge byte for the slot is 0 and the item has charges; gold += result; slot and charge cleared. (code-read, replay 200)
- **Temple** (0x1F2D, `right7` 0x2CC6 prices): heal cost by the member's condition byte +0x3F: eradicated (0xFF) `DS:0x1731[town]` = 2000, 5000, 5000, 2000, 8000; any other value with bit 7 set `DS:0x1727` = 200, 500, 500, 200, 1000; any other non-zero condition or HP below max `DS:0x171D` = 25, 50, 50, 25, 100; healthy members cannot buy a heal (cost 0 = menu ignores the key). Paying clears +0x3F, restores HP (+0x33/34 = max +0x35/36); resurrecting an eradicated member also adds 10 to +0x25 (age) and drops +0x1B/+0x1C (endurance) by one. Uncurse `DS:0x173B` = 500, 1000, 1000, 1012, 1500: clears every equipped slot (+0x40..+0x45, and its +0x0C twin) whose item info byte `DS:3CEA` is 0xFF. Third service `DS:0x1745` = 250, 200, 200, 200, 250 (8-bit cost; copies +0x11 to +0x12). (code-read, replay 200)
- **Tavern** (0x2544): A drink and B tip cost 1 gold each; a member with a condition (+0x3F != 0) is refused; per-member drink counter `DS:0xDA8[m]`: from the third drink on, `random(count+10) >= member +0x1C` sets condition bit 0x10 in +0x3F (unless bit 7 is already set); a tip needs a prior drink and yields the town's rumour (pointer table `DS:0xE45`, entry `count>>2`) only on `random(3) == 3`; C and G (gather) as in the other services. (code-read, replay 200)
- **Training hall** (0x1B08): A trains the selected member through the level-up commit already ported (`levelup` 0x1B68, `xpthr`/`xpcmp`/`traingold`), 1-6 select, G gathers, ESC leaves. (replay 200 incl. the commit)
- **Trap effect** (CODE+0x3D65, called by `trap` 0x3749 and the chest flow): type = `random(11)` picks one of 11 messages; base damage b = 4 << (L-1) for trap level L = `DS:3C79` (b = 4 for L <= 1), damage = random(b) + b with one discarded draw first; types 1..6 use resist byte tables `DS:0x1ACE..` by level band (L < 2: none; 2-5, 6-9, 10+); a party-wide resistance percentage `DS:3C95+k` halves the damage on `random(100) < pct`; every member then takes it through the shared damage path (`0x3EA0`, as `apdmch`), followed by the screen delay. (code-read, replay 300)

### 5.4 The bit-7 touch-effect question (`mm1-rules-world`, closed)

Monster `+0x1B` is read in exactly two places in MM.EXE: `monbon` (CODE+0xA60F: bit 7 set -> `savechar` 0xA655 and return; bit 7 clear -> handler `+0x1B & 0x7F` through `DS:0x3229`) and the monster-info screen (CODE+0xD5D6, prints Y when non-zero). With bit 7 set the effect handler is **never called**: the routine only rolls the saving throw (one `random(100)`), stores the result in `DS:0x31B1` (`csave`) and returns it in AL; the sole caller (CODE+0x9DA2, monster attack) ignores AL, and the only reader of `csave` (CODE+0xB601, the spell/ability resist path) re-runs `savechar` immediately before reading it. 96 of the 195 monsters carry bit 7 (values 129..151 = `0x80|N`, N = 1..23): their touch effect is a **no-op that consumes one RNG draw**. Other `[bp+0x1b]` hits in MM.EXE/overlays (0x1C01, 0x200C, 0x72F9, 0x8FDF, AREAA1) address character records (endurance), not monster records. (code-read; `monbon` harness already replays the save path)

### 5.5 Class-dependent code inventory (`mm1-rules-world`, partial)

Sites that read the class byte (+0x14, `mov bp,0x14`): `training` 0x1BE2 (cmp 7), `right6` 0x2AA2, `right7` 0x2EAB, `trap` 0x3BE7 (class 2), `viewall` 0x5D9D, `quickr` 0x68D4, `okrest` 0x7202/0x7224 (classes 4/5, 2), `equip` 0x7B0E, `qcast` 0x8844 (3/5), `frommiss` 0x9CFC, `attackp` 0xA3B3/0xA448/0xA54D (4/3), `savechar` 0xA670 (class 2 +20), `poption` 0xBEC0, `comcast` 0xC852 (3/5), `goz34` 0xD603. The ones with rules content (spell lists, save bonus, rest, attack) are ported; `trap` (disarm), `equip` (class restriction masks), `frommiss` and `poption` are not analysed yet.

## 6. Pass 5 findings (chest flow, class sites, thief skills, terminal screens, gated handlers)

Grades as in section 3; "x86 replay" as in section 5. Sections are appended unit by unit.

### 6.1 The chest flow CODE+0x3740 / 0x3749 -> 0x3752 (`mm1-rules-world`, closed; also closes the `trap` 0x3BE7 class site)

Run whole from the game's bytes: 3000 vectors for the flow (`chest`, entry 0x3740) and 300 for the bare trap entry (`chesttrap`, 0x3749 = trap effect 0x3D65 + `chkall`), random party / chest state / key script, strict reads, writes, UI call log, registers; null controls (key script shifted by one, ADC without carry-in) fail. (harness; replay by `runTown`). The vectors reach the open, disarm, detect, trap-fires, gold/gem/item distribution, no-room and party-wipe (`alldead`) paths (900 distinct instruction addresses over 600 sampled runs).

State bytes: chest state `DS:3C78` (0 not rolled, 1 trapped, 2 no trap), chest level `DS:3C79` (0 = cloth sack), three item ids `3C7A..3C7C`, gold word `3C7D/3C7E`, gem byte `3C7F`; overlay byte `getod(0x30)` is the map's trap-sense modifier. The party table is `DS:3CA8` (word pointers).

- **Trap roll on first sight** (state 0): `thr = min(255, 8*level + getod(0x30))` (the `shl ah` leaves `8*level` in AH, 8-bit); state becomes 1 (trapped) when `random(100) < thr`, else 2. The chest picture and the level-th 13-byte name from the table at `DS:0x1A3D` are shown.
- **Menu**: `1` open it, `2` find/remove trap, `3` detect magic/trap, ESC leaves (clear text, `chkall`, redraw).
- **Who tries** (0x3CC6): a one-member party uses member 1; otherwise the prompt asks for `1..n`, ESC returns to the menu; a member with `(condition +0x3F) & 0xE1 != 0` (dead/stoned/paralysed/... bit set) is refused with a noise and the prompt repeats.
- **`1` open** (0x3BAB): only a trapped chest (state 1) can bite: the trap fires (trap effect 0x3D65 then `chkall`) when `random(t + 5) < t` with `t = getod(0x30) + (AH << 3) + carry`, where AH is whatever the preceding code left in it (the code reads the level into AL by mistake where the first roll loads AH - **quirk: not a pure function of the level**, it is the stale AH of the member prompt, so the chance is high). Then the loot is paid out whether or not the trap fired (state is not tested again).
- **`2` find/remove trap** (0x3821): only for state 1: skill `s = member +0x6C`; `s < 100`: the trap fires when `random(100) >= s`; `s >= 100`: fires when `random(s + 5) >= s`. A disarm that does not fire the trap falls into the same loot payout ("it opens").
- **`3` detect** (0x3BE4 -> 0x3BE7): class byte +0x14 equal to 2 or 4 prints the bad-class message (noise 2, delay) and returns to the menu; otherwise a member with both spell-point bytes (+0x2B, +0x2C) zero gets the no-spell-points message; else one spell point is taken (16-bit decrement), the screen shows "magic / trap" with a `Y` marker at column 12 when any of items / gold / gems is non-zero and a `Y` at column 22 when the state is 1, then the menu is redrawn (nothing is opened).
- **Payout** (0x3864): gold = `3C7D/3C7E` divided by the party size by a 32-iteration shift-subtract loop (0x3B49), each member gets the quotient added to its 24-bit gold (+0x39, top byte saturates at 0xFF), the remainder is discarded and the chest gold zeroed; gems go whole to one random member (16-bit +0x31, high byte saturating); the first non-zero chest item goes to the first member (party order) with a free slot in +0x46..+0x4B, with `getinfo`'s charge rule (a charged item gets `random(..)` charges in the parallel byte slot +0x0C+k, else 0); the item id is cleared from the chest *before* the search, so when nobody has room the item is gone. Then the screen delay and `chkall`.
- Delay helper 0x3FEA is `bx * DS:0x1938` into `machdelay` (stubbed, logged).

### 6.2 Inventory commands and the class sites `equip` 0x7B0E, `poption` 0xBEC0, `frommiss` 0x9CFC (`mm1-rules-world`, closed)

Run whole from the game's bytes like the town flows (key script via stubbed `wait_`, screen layer stubbed and logged, `getinfo` and `resetsts` / `resetac` / `resetres` executed for real): `equip` 0x7A67 (3000 vectors), `remove` 0x7E7B (1500), `trade` 0x8027 (1500), `discard` 0x7428 (600), `poption` 0xBE00 (600). Strict reads, writes, UI call log, registers (harness). `equip` executes 377 of its 385 instructions (the 8 never reached are the "class not 1..6" / "alignment not 1..3" fall-throughs, which the generator also feeds with 0/4/7/random bytes without reaching them: the earlier jump tables treat them as the same refusal). The prose below is a code-read summary of the replayed bytes (details such as the exact message texts are not restated). Null controls: key script shifted by one and ADC without carry-in (equip, remove, trade, discard) and a **wrong class byte** (class gates of `equip`, `poption` and the chest `3` key must change the run).

- **equip** (0x7A67): item letter A..F picks a pack slot (+0x46..+0x4B, empty slots are skipped when counting); `getinfo` fills the item record at DS:3CE9..; the class restriction byte is DS:3CE9 and **the item is refused (noise, delay) when `class bit & DS:3CE9 != 0`** with the class bits Knight 0x20, Paladin 0x10, Archer 0x08, Cleric 0x04, Sorcerer 0x02, Robber 0x01 (class byte +0x14; any other class value is refused too). Alignment (+0x12: 1 good = 0x80, 2 neutral = 0xC0, 3 evil = 0x40) is ANDed with the same byte: a result of 0 or exactly 0xC0 is accepted, anything else refused. Item id categories decide the equip slot class: 1..0x3C weapons, 0x3D..0x55, 0x56..0x78, 0x79..0x9B, 0x9C..0xAA armour groups, 0xAB..0xFE misc (one item of each group at a time in the six equip slots +0x40..+0x45; a conflicting item prints a message; misc items conflict only with the same id). The item is moved out of the pack slot (with its charge byte from +0x0C further) into a free equip slot, DS:3CEA/3CEB add a stat bonus to the stat pair named by DS:3CEA (skipped for 0 / 0xFF; value 1 takes a separate path), weapons write +0x68/+0x69 and armour +0x6A/+0x6B from DS:3CF1/3CF2, then `doneequ` runs the recalculation (resetsts, resetac, resetres).
- **remove / trade / discard**: the mirror commands (equip slot -> pack, pack -> another member with the same free-slot / charge-byte move, pack slot cleared).
- **poption** (0xBE00, the combat option line): prints the character name, picks the option letters for the current member: attack always (`A` at DS:38B7 when the member's rank flag DS:3C08+index is set), fight `F`, shoot `S` (DS:38B5) when class is 3 (Archer) **or** the character's +0x6A is non-zero, cast `C` (DS:38B6) when either spell-point byte +0x2B/+0x2C is non-zero. The site 0xBEC0 is that class-3 test.
- **frommiss 0x9CFC is not a class site**: `bp = 0x14` there indexes the *monster* record (+0x14 attack count, +0x13 damage die, through DS:3CB4), not a character. The routine (monster attack setup) is already ported and verified as `monhit` (`rules.ts`, with the missile flag DS:3189 selecting the missile damage / single attack branch). > **Correction (2026-11-26):** section 5.5 listed `frommiss` 0x9CFC as a class-reading site; it is not.

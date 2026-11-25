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
| Spells, post-combat XP/loot, flee, monster upkeep/ability, world rules | **open** | see TODO `mm1-rules-*` |

Addressing: image = `MM.EXE[0x200:]`; CS base = image 0; DS = CS+0x107B
paragraphs (DS:0 = image 0x107B0), SS = DS. Overlay code (CS:0xF48F) and data
(DS:0xC940) were not executed in this pass. The game code is hand-translated
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

## Open (all listed in `docs/mm1/TODO.md`)

- **Spells** (`mm1-rules-spells`): `comcast` CODE+0xC7C7 reads class `[ch+0x14]`
  3/5 as casters, spell index from the menu (level 1-7 x slot 1-8), validates
  SP (`+0x2B/+0x2C`) and gems (`+0x31/+0x32`), dispatches via the word table at
  DS:0x39E2 (110 entries; first entries 0xCDD4, 0xCE02, ...), gates monsters
  through `monresma` + `savemons` and a per-spell `mresl` table at DS:0x318A.
  Disassembled, not ported.
- **After combat** (`mm1-rules-aftercombat`): `resout` 0xA1EA, `treas` 0xC3AD
  (treasure from monster +0x18 bits), `treitem` 0xC422, `divide` 0x8386
  (32-bit XP / survivors). Listed only.
- **World** (`mm1-rules-world`): rest, food, shops, share gold, traps — not started.

Paths tried: r2 listing (misaligned) -> custom capstone lister; first RSM parse
paired addresses with the wrong names -> re-derived and checked against code.

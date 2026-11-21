# Evil's Doom — plan

Spec: `docs/evilsdoom/amigaaga/data-structure.md`. Status: `docs/evilsdoom/TODO.md`.
Recon 2026-11-21.

## Phase 0 — scaffold

- Promote `data/_unexplored_/EvilsDoomAGA/` to `data/evilsdoom/amigaaga/`
  (user's call; recon did not move it).
- Register `evilsdoom` in `src/game-id.ts` (platform `amigaaga` already
  exists) and add a `defineGameConfig` entry.
- Depack layer: every file is RNC1 (`@seer-project/pipeline`
  `decompressRnc1`) except `OMD/PCH.DAT` (CrM2 — `ancient`, or upstream a
  CrM2 decoder). Unpacked cache → `build/cache/evilsdoom/`.

## Phase 1 — dungeon map (walker blocker) · `evilsdoom-map-record`

Spec § "Dungeon maps". Walk the state block's record framing from the code
that indexes `A6+$455C` (in `PRG/BEL.dat`, raw module, A6 globals; IRA
`-M68020` on the module bytes from `+0x744`, or `amiga-disasm`). Goal: level
count per dungeon, grid offset per level, the meaning of the pre-grid word
lists, bit 7 / low-bit cell codes, party start position.
Oracle: structural (borders, 5 dungeons × pristine saves, sizes summing),
`FAQ` walkthrough + `Guide_*` text files (level descriptions, stairs), the
user's in-game magic map (`M` key). Pitfalls:
`fixed-stride-record-count-unverified.md`, `tracker-prose-is-not-evidence.md`.

## Phase 2 — view slots and wall art · `evilsdoom-view-slots`, `evilsdoom-wal`

Spec § "First-person view". Decode the 14-B descriptor table at
`BEL.dat+0x16834` (and siblings in the other 4 modules), settle plane count
and mask layout, then render `WAL/*.DT0/DT1` and `DOR/*` through it. Then
`EVE/*` decorations (same record shape). Oracle: tiling (descriptors must
cover DT0/DT1 exactly — the Black Crypt `bcdfx` move), mirror symmetry,
the user's screenshots. Palette: CMAP-shaped data in the module or `.chip`
copper list (`COLOR`/`BPLCON3` banks) — find before colouring; greyscale
first. Pitfalls: `one-bitplane-or-equal-stride-reading-renders-plausible-art.md`,
`file-offsets-vs-segment-relative.md`.

## Phase 3 — walker

Type-derived → per-cell conversion (existing rule), slot-table composite via
`@seer-project/dungeon` `DrawItem` like Black Crypt.

## Phase 4 — pictures, monsters, UI

`PIC/*` (headerless CMAP+BODY; geometry/codec from the reader), `MON/*`,
`DMD`/`OMD` icon banks, `DUNDAT` panels, intro `INT/*.bin`.

## Phase 5 — audio, text

`MUZ/P60.*` = P60A (reuse hunter's structural decode / libxmp). `OMD/TXT.DAT`
+ `CT/*` text. `DMD/SAMPLES.*.CHIPMOD` sample banks.

## Seer packages

`@seer-project/pipeline` (RNC1), `@seer-project/iff` (ILBM/ANIM; maybe the
PIC chunks), `@seer-project/amiga` (HUNK for `INT.DAT`), `@seer-project/tracker`
(check for P60A), `@seer-project/dungeon`. Upstream candidates: CrM2 decoder,
P60A reader if hunter's isn't upstream yet.

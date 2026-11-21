# Hired Guns — plan

Format detail lives in [`amiga/data-structure.md`](amiga/data-structure.md).
Open items live in [`TODO.md`](TODO.md). This file only orders the work.

## Phase 0 — scaffold

- Register `hiredguns` / `amiga` in `src/game-id.ts` and add a `defineGameConfig`
  entry in `tools/shared/game-config.ts`. Recon did not touch code.
- The data currently lives at `data/hiredguns/amiga/`. When the title is
  promoted, move it to `data/hiredguns/amiga/` (the user decides).
- Add a pipeline step that unpacks RNC1 with `ancient` into `build/cache/hiredguns/`
  (all 108 RNC files unpack cleanly). Check whether `@seer-project/*` already has
  RNC1 before writing a TS decoder (ask `seer-guide`).
- **Ask the user for the 2021 dev archive** (Internet Archive). It contains source
  for the game and the map editor, and would settle phases 2–4 outright.

## Phase 1 — cheap standard wins

- Character ILBMs → PNG (`tools/shared/ilbm.ts`). This is a standard format.
- `Atmos/*.sfx` 8SVX, `World.dat` + `StaticNN.mod` MMD0 → `audio/` as-is.
- Text banks (`Items.*`, `Messages.*`, `Phrasebook.*`, map briefings): the
  `FB yy xx FC` record grammar.
- Oracle: the files' own structure. These are standard formats.

## Phase 2 — map voxel cube (walker-critical) · TODO `hg-map-planes`

- Geometry is already known: 3 planes × (20×23×23 × 4 B) at `+0x6F40`, with
  `0xA8E8` between planes. Next, decode the cell fields by tracing the exe sites
  listed in the spec (`+0x1629C`, `+0x783E`, `+0x8518`, …) with `amiga-disasm` on
  the RNC-unpacked exe. Then pin which way z runs and what bits 0x02/0x40 mean.
- Oracle: the walk/climb code, plus the map's own redundancy (vertical stairs/lift
  pairs must line up across layers). Final check is a user screenshot of map 01's
  start position.
- Pitfalls: `fixed-stride-record-count-unverified.md`,
  `check-that-cannot-fail-is-not-evidence.md` (run null controls on every
  "functional" fit).

## Phase 3 — figure packer + figure records · TODO `hg-gfx-packer`, `hg-figure-records`

- Solve the `0x7790`-prefixed packer: find the unpacker in the game exe (callers
  of the `CharactersGfx` loader), or trace `C/Crunch`. If it resists, emulate the
  game's own routine (`scripts/m68k_emu.py` / musashi, the Black Crypt `bcdft`
  pattern).
- **Oracle: byte/pixel-exact.** Decoded `.gfx` frames must equal the ILBM regions
  that `MakeFigure/Filters` lists.
- Then the shared figure-record grammar (`Figure.dump`, Styles, Misc, Items).
- Escalation trigger: two distinct packer hypotheses that fail against the ILBM
  oracle → `re-codebreaker`.

## Phase 4 — Styles + view renderer · TODO `hg-view-renderer`

- Decode `Styles/StyleNN.gfx` (48-entry offset table → figure records with
  placement). Trace the view routine to get the slot table: which cell offsets
  (including z±1) map to which Style record.
- Oracle: user screenshots, one per style.

## Phase 5 — object tables, monsters, walker

- Map `+0x22EC` object/event records (internal offsets), monster placement,
  walker build (`tools/walker/`), and a per-cell converter. Add a z-adjacency plane
  for stairs/lifts.

## Seer packages / upstream candidates

- RNC1 decoder (if `@seer-project/*` lacks one), MMD0 passthrough, `@seer-project/iff`
  for ILBM/8SVX.
- The walker schema needs multi-layer levels with vertical links. This is new
  for crawl, so raise it in `docs/walker-map-format-future-decision.md` when
  phase 5 starts.

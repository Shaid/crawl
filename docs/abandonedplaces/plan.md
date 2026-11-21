# Abandoned Places (Amiga) — plan

Spec: `docs/abandonedplaces/amiga/data-structure.md`. Open work: `docs/abandonedplaces/TODO.md`.
Sibling: Abandoned Places 2 (`docs/abandonedplaces2/plan.md`) shares the container and
packer. Build both games' unpacker once, as one shared tool.

## Phase 0 — scaffold (not done by recon)
- Register the game id `abandonedplaces` (platform `amiga`) in `src/game-id.ts` and the
  game config, when the first extractor lands.
- The data stays under `data/_unexplored_/abandonedplaces/` until the user moves it to
  `data/abandonedplaces/amiga/`. Extractors should take the directory as an argument.

## Phase 1 — container + packer (easy; the spec is complete)
- Commit one shared ArtGame directory parser + unpacker, e.g.
  `tools/shared/artgame-kernel.ts` (+ a Python twin only if a Python pipeline needs
  it), used by both games. Spec §2–§3.
- Oracle: the packer's own XOR checksum, plus input consumption, plus the directory's
  unpacked size. 427/427 already pass in the recon probe. Regression-test against those
  counts. Pitfall: `decoder-output-length-check-is-tautological-assert-input-consumption.md`.
- Output: unpacked files into `build/cache/abandonedplaces/` (intermediates, not web assets).

## Phase 2 — palettes
- Look for 64-B palette files (`ABIC.*DATA`, `ABIC.STARTDAT`) and the in-code
  palettes in `code`/`module`. Find the in-dungeon palette per wallset; it may be in
  `moduleN`. Oracle: public screenshots or longplay stills of the Amiga version, or
  the manual's colour plates.

## Phase 3 — dungeon levels + walker map (medium)
- Decode the 10,916-B level record past the grid: objects, monsters, events, start
  pose. Spec §5. Find the reader in `module` (HUNK; `amiga-disasm`). Confirm that the
  word at +2048 is the wallset id from the loader.
- The wall model is type-derived. Convert to per-cell faces on import, as
  `docs/walker-map-format-future-decision.md` § "2026-11-21 review" says.
- Oracle: 44/44 solid borders, the wallset ↔ disk split, and in-game automap
  screenshots (user).

## Phase 4 — first-person art + renderer (medium-hard)
- Find the slot table: AP1 art files are headerless, so the slot geometry is in
  `module` or `moduleN`. Use AP2's `.def` geometry (spec of AP2 §5) as a strong prior
  for the slot set and sizes. Spec §6.
- Oracle: screenshots, plus AP2's self-describing geometry for the shared slot set.

## Phase 5 — monsters, town screens, cut-scene `ABIC.*`, fonts
- `monsterN` (22,040), `bpl.*` (small header), `ABIC.*` (palette + planar?). Spec §4.

## Phase 6 — audio (standard)
- TFMX `mdat.*`/`smpl.*` pairs: keep the original containers in `audio/`. Pitfall: TFMX
  needs mdat and smpl paired by name.

## seer packages
- `@seer-project/amiga` (HUNK parsing for `code`/`module`), `@seer-project/gfx` (planar).
- Upstream candidate: none yet. The ArtGame packer is studio-specific; keep it in
  crawl `tools/shared/`.

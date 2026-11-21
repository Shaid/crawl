# Crystal Dragon (Amiga) — plan

Spec: `docs/crystaldragon/amiga/data-structure.md`. Open work:
`docs/crystaldragon/TODO.md`. This file holds the order of work and never
restates format detail.

Retail files stay at `data/crystaldragon/amiga/` (WHDLoad install) until
the user promotes the title.

## Phase 0 — scaffold

- When the user promotes the title, move or copy `data/crystaldragon/amiga/data/*`
  to `data/crystaldragon/amiga/`.
- Register `crystaldragon` in `src/game-id.ts` and add a `defineGameConfig`
  entry. Recon leaves this undone on purpose.
- Shared lib: create `scripts/cdlib/` (Python) following the `scripts/bclib/`
  pattern. Planar decode goes through `@seer-project/gfx` /
  `tools/shared/amiga-planar.ts`.

## Phase 1 — container codecs (everything depends on this)

1. **`SF` decoder → committed** (`cd-sf-codec`). It is already ported in a
   scratch probe and holds 31/31 exact. Commit it to the shared lib, add a
   regression check (exact size plus 0 bytes left over), and dump every `SF`
   file to `build/cache/crystaldragon/`. Easy.
2. **`SA`/`SP`/`SC` image codec via emulation** (`cd-sa-codec`). Run
   `Crystal_Dragon` hunk 0 `+0x0004` (`Unpack`) under musashi. Reuse the
   `tools/bcdft_decompress/` harness pattern (C + musashi) or
   `scripts/m68k_emu.py`. Load hunk 0 at its base, workspace at `$70E`; inputs
   a0=src, a1=dst, d0=size, d1=palette dest. Validate with byte-exact output
   size per frame header, then render greyscale. Medium. Escalate to
   re-codebreaker only if the emulated routine itself misbehaves (2+ distinct
   failures in paths-tried).
3. **`SQ`** (`cd-sq-codec`): same emulator run. It is small (`+0x746…+0x810`).
   Identify audio vs. data afterwards.

Pitfalls: `compressed-stream-start-offset.md` (the SF payload is shifted 10
bytes before the backward read), `file-offsets-vs-segment-relative.md` (hunk 0
code starts at file `+0x24`), `check-that-cannot-fail-is-not-evidence.md`.

## Phase 2 — palette

`cd-palette`: the `SC` path carries a palette, but no `SC` file ships. Find
the dungeon palette in the exe or in the level tail (grep for 32-word 12-bit
tables) or in an overlay. Oracle: public Amiga screenshots of Crystal Dragon
(MobyGames, Hall of Light), compared by colour set.

## Phase 3 — maps (walker question 1)

`cd-map-grid`: pin the grid geometry from the code. Find the `MULU` by a
stored width in the move/view routines that index `$3140`+8·(y·W+x), and say
which header word holds W. Then decode cell `word0` type/flags and words 1–3.
Oracles: the 23 levels' structural closure (solid border, paired door cells,
stairs linking level N↔N+1 at matching coordinates) and the `Solution`
walkthrough. Agent: `amiga-disasm` on `Crystal_Dragon`.

## Phase 4 — view renderer (walker question 2)

`cd-view-slots`: confirm that the `.SCR` companion tables are view-slot tables
(slot → frame, x, y) by tracing the draw loop that reads the level name table
→ SA set → table. Then build a 3D-view compositor and compare against public
in-game screenshots.

## Phase 5 — the rest

Monster sets (`cd-monster-sets`), SFX `88`–`91` plus music `12`
(`cd-audio`), overlays `0a`/`c0` (`cd-overlays`), and the 32-byte record
lists in the level file (`cd-level-objects`).

## seer packages

- `@seer-project/gfx` for planar decode, `@seer-project/amiga` for HUNK parsing.
- Upstream candidate: none yet. The `S?` codecs look private to this engine.

# Liberation: Captive II — plan

Spec: [`cd32/data-structure.md`](cd32/data-structure.md). Open items:
[`TODO.md`](TODO.md). This file only orders the work.

## Step 0 — scaffold
- Done (commit 59b2d29): files at `data/liberation/cd32/` (game files under
  `data/`), already a plain file tree (WHDLoad install) — no disk-image
  extraction needed; `liberation` / `cd32` registered in `src/game-id.ts` and
  `tools/shared/game-config.ts`.

## Phase 1 — generators → map grid (the walker blocker)
The world is not stored; `CityGen`/`BuildingGen`/`PlotGen` build it from
`(world, zone[, building])`. Spec § "1. How is the map stored?".
1. **Emulate, don't re-implement.** Each generator is a small 68020 HUNK
   (11–23 KB code, BSS only) entered with A0 = a parameter block. Load it
   into the musashi harness (`tools/bcdft_decompress/` pattern, or
   `scripts/m68k_emu.py`), stub `OpenLibrary` (CityGen opens `dos.library`
   for nothing visible) and the param block (`+0/+2` world/zone, `+12` 12 KB
   grid buffer, `+16/+20/+24/+28` tables, `+1066..1072` state), run, dump the
   three 4 KB planes. Oracle: determinism (same seed ⇒ byte-identical
   output), plus the manual's zone layout and later the user's in-game map.
2. **Decode the three planes** from the generator's writes + the main exe's
   movement/render reads (`captiveII` uses `(12,A0)` grid via `0x1D96(A5)`
   tables). Answer per-cell vs shared-edge vs type-derived walls.
3. Same for **BuildingGen** (interiors written into the same buffer, variable
   row width, multiple floors).
4. Trace where the 14-bit `world` value at `A5+0x626C` is first set
   (new-game path) — fixed level list or random seed.
Agent: `amiga-disasm` for the traces; `game-re` owns the harness.
Pitfalls: `seeded-prng-stable-not-random.md`,
`walker-movement-rule-must-port-games-move-routine.md`,
`ira-label-name-is-not-a-literal-address.md`,
`file-offsets-vs-segment-relative.md` (CODE body = file `+0x2C`).

## Phase 2 — wall art (`AmSp` / `.VGM`)
Container is solved structurally (spec § `AmSp`). Remaining: the 16-colour
palette(s) for 4-plane art and the slot table mapping the 152 pieces to
view positions (render routine reached from the VGM loader at
`captiveII +0x250D6`/`+0x251DE`). Oracle: composite view must tile
seamlessly; user screenshot for colour.

## Phase 3 — vector objects (`FORM O3DG`)
Decode `EXVL`/`PLST`/`VSPR`/`VFTX` against `vector.library`/`tridee.library`
(small, self-contained). Oracle: closed meshes, symmetric droids/people,
`.x3d` single-object files as test cases.

## Phase 4 — the rest
`ImgA` UI banks, `.FNT`, 8SVX audio (standard), RNC2 `.asp`/`.sty` ANIM
(low priority), text macro language (PlotGen-driven).

## Seer packages
`@seer-project/iff` (O3DG/8SVX/ANIM chunk walk), `@seer-project/gfx`
(planar decode), `@seer-project/amiga` (HUNK). An RNC2 codec would be an
upstream candidate if `@seer-project/*` lacks one (ancient has it).

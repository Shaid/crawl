# Ishar-engine family — open work

Single status surface for **Crystals of Arborea, Ishar 1, Ishar 2, and
Ishar 3** (all share one container/codec family — see
`docs/ishar-container-format.md`). This is still an exploratory pass
(started 2026-08-30) — the container/compression layer is now fully
confirmed via real prior art (`github.com/maestun/silm-depack`/`alis`);
per-title content semantics (overworld/dungeon-view mechanism) remain a
from-scratch investigation.

See `docs/ishar-container-format.md` for the shared container spec,
`docs/ishar/amigaaga/data-structure.md` / `docs/ishar2/amigaaga/
data-structure.md` / `docs/ishar3/amigaaga/data-structure.md` /
`docs/crystalsofarborea/amiga/data-structure.md` for per-title findings.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ishar-main-manifest-structure | open | `MAIN.DO`'s content is now fully readable in all 3 Ishar titles (resource manifest + monster roster + level-editor strings — the earlier "Ishar 2/3 don't show readable strings" note was a false negative from checking pre-decompression bytes, corrected this session), but its *binary record structure* (per-scene resource lists as actual records with offsets/counts, not just repeated substrings found via `strings`) is still not decoded | `docs/ishar-container-format.md` §3, `docs/ishar/amigaaga/data-structure.md` §4, `docs/ishar2/amigaaga/data-structure.md` §3, `docs/ishar3/amigaaga/data-structure.md` §2 | 2026-08-30 |
| ishar-cell-value-semantics | open | The region-grid cell-value alphabet (§9.2: `0x00` void, low codes = terrain/feature, high-bit `0x9D`/`0xCC-0xCE`/`0xE1`/`0xE5-0xE6` = obstacle classes; cells read sign-extended so `< 0` is the natural blocked test — HYPOTHESIS) needs its value→walkability and value→scene-script dispatch decoded (very likely the `cswitch` streams around `MAIN.bin+0x18e8..0x1c74` where all the location `.AO` names sit) | `docs/ishar-container-format.md` §9.2 | 2026-09-01 re-oracle |
| ishar-fic-semantics | open | Remaining `.FIC` semantics now that the format layer is solved (§9): the role split between the two region-grid buffers (`basemain+0x80` vs `+0x234a` — adjacent-region staging vs pristine-copy both fit the paired reads); `EN1.FIC`'s 28/29 per-array record layouts (sizes byte-exact from bytecode, content undecoded); `TAB1.FIC`'s 19×19 {1..4} grid's role; Ishar 2/3's second grid layer's meaning | `docs/ishar-container-format.md` §9.1-9.3 | 2026-09-01 re-oracle |
| ishar-sprite-palette | open | The real AGA colour palette for decoded sprites (§7/`docs/ishar-sprite-format.md`) is not yet recovered — `topalette()` resolves a palette resource via the same `adresdes()` directory mechanism as bitmaps, but the specific directory INDEX that is "the palette for this scene" is chosen by VM bytecode at runtime, not by any static marker. All shipped sprite renders are greyscale (RENDERED, not CONFIRMED colour) | `docs/ishar-sprite-format.md` §5 | 2026-08-31 |
| ishar-scene-header-subtype-byte | open | The shared 16-byte scene header (§6's evidence) has a varying byte at offset 21 (`0x0a` graphics/Ishar-1 caves, `0x47` Ishar-2 dungeon files, `0x1e` a third subgroup) that looks like a content-subtype discriminator — not traced to any consumer code. (Note: this header is the ALIS *script* header — `id@0`, `code_loc@+4`→bytecode entry, `dirOff@+0x0e` — per §9's `script.c` layout, so the "subtype byte" is a script-header field, likely `vram_alloc`-adjacent) | `docs/ishar-container-format.md` §6, §9 | 2026-09-01 re-oracle |
| ishar-firstperson-generalize | open | The first-person renderer now executes FIVE Ishar 1 location scripts (`FORET.bin`, `VILLAGE.bin`, `PLAINE.bin`, `RAMPART.bin`, `TEMPLE.bin` — all RENDERED, wired into the walker's `KeyC` cycle; `TEMPLE.bin` supersedes an earlier INCONCLUSIVE verdict, see the correction in `docs/ishar-container-format.md` §8.7) plus TWO Ishar 2 location scripts (`FORET1.bin`, `VILLE.bin` — RENDERED, wired, per-location backdrop convention) — `ORC.bin` (Ishar 1 monster placement) deliberately not wired (no real per-frame encounter data to drive it honestly). Ishar 3 attempted and NOT achieved: globals/facing table/screen constants ARE confirmed, but its outdoor scripts (`FORET.bin`/`JUNGLE.bin`) execute an unconditional 4-quadrant "diamond scan" (not a facing-selected forward scan like Ishar 1/2) whose per-cell screen-projection produces wildly out-of-range x-offsets — root-caused to a specific outer ring-loop lateral-bound issue, not yet fixed | `docs/ishar-container-format.md` §8.6 (Ishar 3), §8.7 (TEMPLE) | 2026-09-02 |
| ishar-cavint-sceneLayer-writer | open | `CAVINT.bin`'s own real cell-value alphabet is now confirmed to live in `INIT.FIC`'s Z=1 sub-array (not Z=0), meaning the real game must set `omainb(0x2b3c)` to 1 somewhere in `CAVINT`'s own launch path (most likely `MAIN.CO`'s scene/location dispatcher) — that write site was not located this session (the walker forces `sceneLayer=1` as a wired, RENDERED-not-CONFIRMED convention) | `docs/ishar-container-format.md` §8.5, `docs/crystalsofarborea/amiga/data-structure.md` §8 correction block | 2026-09-02 |
| ishar-firstperson-backdrop-anchor | open | `FOND.bin`'s backdrop-panel anchor/tiling/parallax convention is UNVERIFIED against any real screenshot — panels resolve to large (up to 96×85px) composites anchored base-at-horizon, plausible as "distant hill/cloud silhouette" but two panels don't tile to cover the full 255px screen width, leaving flat placeholder sky visible at the frame edges (may be correct, may indicate a missing repeat rule) | `docs/ishar-container-format.md` §8.2 | 2026-09-01 |
| ishar-greyscale-atlas-normalize | open | The already-shipped sprite atlas (`ishar-sprite-atlas.ts`) still uses the fixed-0-255-scale `isharBitmapToGreyscaleRGBA()`, which silently renders any bitmap with `palOffset` above ~40 as a near-flat block even though the real decoded indices vary normally (confirmed via a histogram on two `FOND.bin` sprites this session). A per-bitmap-normalized version now exists (`isharBitmapToNormalizedGreyscaleRGBA()`) and is used by the first-person renderer, but the corpus-wide atlas pipeline was not re-run with it | `tools/shared/ishar-sprites.ts` module doc | 2026-09-01 |
| ishar-t3-crystals-executable-trace | deferred | Ishar 3's `START` and Crystals' `T.X` were not disassembled this pass (only Ishar 1's `T.X` was traced) — the `0xA1`/`0x81` codec port is now verified corpus-wide by output self-consistency + readable content instead, which is strong enough evidence to not require this, but a direct trace on a second title's executable would still strengthen the "one shared codec" claim further | `docs/ishar-container-format.md` §1, §2.5 | 2026-08-30 |
| crystals-carte-array-role | open | `CARTE.CO`'s two confirmed 8-element scratch arrays (`0x3c`/`0x46`) match the 8 confirmed UI strings `JON/ZACH/IRVAN/AKEER/OLBAR/THORM/ALL/NONE` in count+order (STRUCTURAL), but which array means "currently selected" vs. some other axis, and what index 0's un-written default value really is, is not decoded | `docs/crystalsofarborea/amiga/data-structure.md` §3.5 | 2026-09-01 |
| crystals-carte-destination-mechanism | open | The real "travel to a location" mechanism: a confirmed consumer region hit-tests the 8 checklist rows (`cftstset`+"forme" collision test) and calls `clive` (load-and-run-another-script-by-id) on confirmation, but the literal script id(s) `clive` loads, and any per-location map hotspot/placement table (for "click a place on the map"), were not found this session | `docs/crystalsofarborea/amiga/data-structure.md` §3.5 | 2026-09-01 |

## Session log

- **2026-09-01 (thirteenth pass — Ishar 2 first-person CONFIRMED (two
  scripts), Ishar 3 attempted and left OPEN with a well-scoped negative)**:
  Generalized the proven Ishar 1 mechanism (§8.2-8.5) rather than
  reinventing it. Tried Ishar 2's dungeon files (`DJ*.DO`) first per the
  task's own initial suggestion — rejected (`DJ1.bin` is a 100 KB,
  1,303-instruction script with a genuinely different rectangular-area-scan
  structure). Pivoted to outdoor scripts: **Ishar 2's `FORET1.bin`+
  `FOND1.bin` and `VILLE.bin`+`FVILLE.bin` both RENDER end-to-end**
  (structural-correspondence global derivation against Ishar 1's own
  confirmed shell — `partyX=0x2ab4`, `partyY=0x2ab5`, `partyFacing=0x2ab6`,
  same `+1` facing convention), verified against real `CONT1.FIC`/
  `CONT3.FIC` cells: 9 real position/facing renders, all visually distinct
  and non-degenerate (coherent tree/root structures for FORET1; recognizable
  building rooflines/walls for VILLE, each facing showing a different
  silhouette). Shipped `tools/shared/ishar2-firstperson.ts`,
  `tools/ishar2/amigaaga/scripts.ts`, and generalized
  `tools/walker/games-ishar.ts` (`LOCATION_SCRIPTS`/`RENDER_FRAME` now keyed
  by game id, `IsharLocation` carries its own optional per-location backdrop
  for Ishar 2's convention) — `KeyF`/`KeyC` now work for Ishar 2 exactly as
  they already did for Ishar 1. **Ishar 3 attempted, NOT achieved.** Globals
  (`partyX=0x14b6`, `partyY=0x257`, `partyFacing=0x14b7`) and screen
  constants ARE confirmed by disassembly, and a facing raw-value table
  (`[-2,-1,2,1]`) was derived by tracing per-block world-coordinate updates
  — but rendering `FORET.bin` against real `CONT4-3.FIC` cells produces
  noisy, non-forest output at every position/facing tried (5 combinations,
  2 test cells including one edge and one interior, ruling out a clamp
  artifact). Root-caused via direct disassembly of the shared per-cell
  subroutine chain: Ishar 3's outdoor scripts execute an unconditional
  4-quadrant "diamond scan" (4 separate `cjsr` call sites, none gated by the
  facing dispatch) rather than Ishar 1/2's single facing-selected forward
  scan, and the outer ring loop's lateral-bound narrow/widen logic lets the
  effective lateral magnitude reach ~28-49 (not the ~7 the initial clamp
  suggests), producing screen x-offsets from -9,408 to +1,197 against a
  255px screen. Confirmed NOT script-specific (`JUNGLE.bin` shares the
  identical 4x-`cjsr` shell). Not escalated to `re-oracle` — the negative is
  well-scoped with concrete file offsets and a specific structural
  difference identified, and the task explicitly permitted leaving one
  title as a scoped follow-up. `ishar3-firstperson.ts`'s module doc
  corrected to state this honestly (no working render claimed); NOT wired
  into the walker (`LOCATION_SCRIPTS.ishar3 = []`). No amiberry/emulator
  use — static disassembly + real-cell scanning + `Read`-based visual
  inspection only. `npx tsc --noEmit -p .`/`npx eslint` clean on all
  changed/new files; `npm test` still 370/370 (no regressions). Full
  evidence: `docs/ishar-container-format.md` §8.6 (including the full
  paths-tried table for Ishar 3).

- **2026-09-02 (twelfth pass — RAMPART/PLAINE (Ishar 1) and PLAGES/CAVINT
  (Crystals) all RENDERED, by disassembling each script's own cell-value
  dispatch instead of guessing test positions)**: The prior pass left
  `RAMPART.bin`/`PLAINE.bin` at "disassembles clean, not traced" and
  `PLAGES.bin`/`CAVINT.bin` at "tried at the wrong (ARBRE-borrowed) test
  position, blank frame." This pass disassembled each of the four scripts'
  own `cswitch1`/`cswitch2` cell-value dispatch directly
  (`tools/shared/alis-disasm.ts`, no new tooling) to get each script's real
  accepted cell-value set, then scanned the real data source (`CONT*.FIC`
  for Ishar, `INIT.FIC` for Crystals) for matching cells — the same method
  §8.3/`docs/ishar-container-format.md` used for `VILLAGE.bin`, generalized.
  **`PLAINE.bin`** (`cswitch1`, 20-value set) found 1,039 matching cells in
  `CONT1.FIC`; 4 rendered poses show a wide grass-field texture band with
  foreground shrub clumps. **`RAMPART.bin`** (`cswitch2 base=-100 count=11`,
  values `100..111`) found 101+58 matching cells in `CONT3`/`CONT4.FIC`
  forming a real closed fortress-perimeter polygon (no other rendered
  script's cluster is a closed ring); 3 of 4 rendered poses show tall
  tower/wall silhouettes rising above the horizon, visually distinct from
  every other script. **`PLAGES.bin`** (`cswitch1`, `{-25..-20,50}`) found
  787 matching Z=0 cells in `INIT.FIC`, densely clustered along the map's
  `x=94` edge; 4 rendered poses show a rocky/dune coastal texture.
  **`CAVINT.bin`** (`cswitch1`, `{-94..-90,-79..-70,80..85}`) found ZERO
  matches in `INIT.FIC`'s Z=0 sub-array despite reading the identical
  default-0 `sceneLayer` global as `PLAGES`/`ARBRE` — but 1,947 matches in
  the Z=1 sub-array, forming real closed room/wall outlines. This is a real
  **correction**: the previous session's "tested with `sceneLayer=1`, blank
  frame, inconclusive" was a wrong TEST POSITION, not a wrong layer guess —
  Z=1 really is `CAVINT`'s content, confirmed by disassembly + real cell
  matching this time, and the real game must set the `sceneLayer` global to
  1 somewhere in `CAVINT`'s own launch path (new open row
  `ishar-cavint-sceneLayer-writer`, since that write site itself wasn't
  located). 4 rendered `CAVINT` poses (forced `sceneLayer=1`) show dense,
  mostly-enclosed interior frames, visually distinct from every outdoor
  script. All 4 scripts shipped: `tools/ishar/amigaaga/scripts.ts` (+
  `plaine`/`rampart`), `tools/crystalsofarborea/amiga/scripts.ts` (+
  `plages`/`cavint`), and wired into their respective walkers' `KeyC`
  cycles (`tools/walker/games-ishar.ts` — `firstPersonAvailable`'s region
  gate widened from `CONT1`-only to `CONT1|CONT3|CONT4` since `RAMPART`'s
  real cluster spans `CONT3`/`CONT4`; `tools/walker/
  games-crystalsofarborea.ts` — added a per-script `sceneLayer` field so
  `CAVINT` renders with `sceneLayer=1` while every other script keeps the
  default 0). `npx tsc --noEmit -p .` and `npx eslint` clean on all
  changed/new files; `npm test` still 370/370 (no regressions). No
  amiberry/emulator use — static disassembly + real-cell scanning +
  `Read`-based visual inspection only, per this session's constraints. Full
  evidence: `docs/ishar-container-format.md` §8.4-8.5,
  `docs/crystalsofarborea/amiga/data-structure.md` §8's second correction
  block. Rows closed: `crystals-plages-cavint-position`,
  `crystals-scene-layer-selector-role` (superseded by the narrower
  `ishar-cavint-sceneLayer-writer`); `ishar-firstperson-generalize`'s text
  updated (not closed — Ishar 2/3 and `ORC.bin` remain out of scope).

- **2026-09-02 (eleventh pass — Crystals of Arborea's local-scene-array
  indexing SOLVED, `ARBRE.CO` renders a real forest first-person view)**:
  Closed `crystals-local-scene-array-indexing` (previous pass's open item).
  Re-derived the real `tabchar()` push/pop semantics directly from the
  vendored `github.com/maestun/alis` source (`alis.c:1431`'s `*acc++` reads
  the SAME direction `opushacc`/`opile` push/pop the VM eval stack, i.e.
  LIFO) and found the previous pass's best-effort formula had the right
  shape but the wrong pop order (FIFO instead of LIFO). Real formula:
  `index = direct + 2*pop() + 114*pop()`, `direct = omainb(0x2b3c)`
  (defaults to 0, no writer found), first `pop()` = last-pushed
  (`odirb(0x25)`), second `pop()` = first-pushed (`odirb(0x24)`). Verified
  three independent ways: (1) the formula's implied bounds tile
  `INIT.FIC`'s real 10,830-byte size with ZERO remainder (`95*114=10,830`
  exactly); (2) a whole-array visual render at `Z=0`/`Z=1` shows two
  different coherent maps (a sparse terrain-feature map matching Ishar 1's
  `CONT1.FIC` alphabet shape, and a dense room/building-outline grid,
  matching `MANUEL.CO`'s own "THE MAP"/"3D MODE" distinction); (3) feeding
  the formula real bytes into `alis-interp.ts` and running `ARBRE.bin`'s
  actual bytecode for 4 real positions/facings produces frames that are,
  via `Read`, unambiguously forest scenes (multiple distinct trees,
  responsive to position/facing) — `ARBRE` being French for "tree".
  `NPLAINE.bin` ("plain") independently renders a semantically different
  sparse low-vegetation band at the same position. `PLAGES.bin`/
  `CAVINT.bin` were tried with the same formula/position and produced
  non-trivial placement counts but blank frames (expected — wrong test
  position for either script's own cell range, not a formula failure; new
  open item `crystals-plages-cavint-position`). `CAVINT.bin` was also found
  to use the same formula for a second, structurally distinct purpose (8
  call sites with `+1`/`-1` neighbour-offset arithmetic — a movement/
  collision test analogous to `GERDEP.bin`, not traced further). Shipped:
  `tools/shared/crystals-firstperson.ts` (new), a `fillPlaceholderSkyGround()`
  helper factored out of `ishar-firstperson.ts` (regression-verified: FORET
  still produces its expected non-zero placement count unchanged),
  `tools/crystalsofarborea/amiga/scripts.ts` (exports `ARBRE.bin`/
  `NPLAINE.bin` + raw `INIT.FIC` as browser assets, not wired into
  `package.json`), and a `KeyF`/`KeyC`/`WASD` first-person test-bench mode
  added to `tools/walker/games-crystalsofarborea.ts` (the existing
  checklist-screen mode is unchanged and still the default). New open item
  `crystals-scene-layer-selector-role` (what sets `omainb(0x2b3c)`, and
  whether `Z=1` is really the indoor layer). `npx tsc --noEmit -p .` and
  `npx eslint` clean on all changed/new files; `npm test` still 370/370 (no
  regressions). Full evidence: `docs/ishar-container-format.md` §8.3
  (correction block), `docs/crystalsofarborea/amiga/data-structure.md` §8
  (correction block), `tools/shared/crystals-firstperson.ts`'s module doc.

- **2026-09-02 (tenth pass — generalization: a second Ishar 1 location
  RENDERED, a third attempted, a real N-ary indexing mechanism found in
  Crystals of Arborea)**: Following §8.2's single-script proof of concept,
  generalized `renderIsharForestFrame()` -> `renderIsharLocationFrame()`
  (no behavior change, regression-checked). **`VILLAGE.bin` now RENDERS
  end-to-end** — shares `FORET.bin`'s exact facing/ring-loop shell
  byte-for-byte but dispatches cell value via a building-style `cswitch2`
  (base=0x19, count=0x18, values `-25..-1`); verified against a REAL
  `CONT1.FIC` cluster (`x=52-56,y=14-20`, matching this project's own
  earlier visual note of "building/compound rectangles" in that exact
  area) — 4 test poses all show a coherent, recognizable timber-framed
  building (roof trusses, support beams), a stronger visual result than
  FORET's abstract band. Exported as `scripts/village.bin` and wired into
  `tools/walker/games-ishar.ts` via a new `KeyC` cycle-location control
  (honestly labeled as a manual test-bench selector, not the real
  undecoded region-to-scene dispatch). **`TEMPLE.bin` attempted, result
  INCONCLUSIVE**: disassembles clean under the same shell, real matching
  cell found and rendered, but only 7 placements resulted with no visible
  foreground structure — reported honestly as a partial result, NOT wired.

  > **Correction (2026-09-02 follow-up pass)**: this INCONCLUSIVE verdict
  > was caused by a sign error, not a real absence of data. `TEMPLE.bin`'s
  > `cswitch2 base=-10 count=6` dispatch was scanned as accepted value
  > range `[-10,-4]`, found only 4 matching cells corpus-wide. Re-deriving
  > the formula directly from `alis`'s `opcodes.c` source (`index = value +
  > base`, so `value = index - base`) gives the real range `[10,16]` —
  > hundreds of real matches in `CONT3`/`CONT4`/`CONT6`. Rendered 6 test
  > poses at real clusters: values 11/12 place a MIRRORED PILLAR PAIR
  > (`dx=∓99`/`dx=∓113`) when facing N/S (looking down a colonnade) and a
  > smaller facade sprite facing E/W — a coherent, distinctly
  > temple/architectural composition, visually confirmed via `Read` across
  > all 6 renders (symmetric paired columns, a stone-arch backdrop). Also
  > found: `MAIN.bin`'s resource manifest has a straight-line
  > `cload("ftemple.AO"); cload("temple.AO")` pair (byte-exact instruction-
  > length apart, no branch between) — TEMPLE's real companion backdrop is
  > its own `FTEMPLE.bin` (a stone-arch texture), not the shared `fond.bin`
  > every other Ishar 1 script here uses. Both backdrops render plausibly;
  > `FTEMPLE.bin` was shipped as the default since it's the location's own
  > confirmed asset. `TEMPLE.bin` is now wired into `LOCATION_SCRIPTS`
  > (`tools/walker/games-ishar.ts`) with `fondKey: 'ftemple'`, regions
  > `CONT3`/`CONT4`/`CONT6`. The `ishar-firstperson-generalize` row above
  > is updated accordingly (it stays open — Ishar 3 and `ORC.bin` remain
  > unresolved). `RAMPART.bin`/`PLAINE.bin` were already RENDERED in the
  > §8.4 pass; this correction did not touch them.

  `RAMPART.bin`/`PLAINE.bin` disassemble clean (same shell) but weren't
  traced further; Ishar 2/3 not attempted (time-budget triage, not a
  blocker). **Crystals of Arborea investigation**: found several outdoor
  scripts (`ARBRE.CO`/`PLAGES.CO`/`NPLAINE.CO`/`CAVINT.CO`) sharing Ishar
  1's exact scene-compositor shell (different global offsets), plus a real
  previously-undocumented content-load mechanism (`MAIN.CO` loads the real
  `INIT.FIC` file, 10,830 bytes byte-exact, into `basemain+0x7c` in one
  `cfreadb`, spanning several `cdim`-declared arrays — a parallel to Ishar
  1's `EN1.FIC` scatter convention). Tracing `github.com/maestun/alis`'s
  real `tabchar()` (`alis.c:1431`) and `cdim` (`opcodes.c:613`) found
  `omaintc` is genuinely **N-ary** (not the fixed 2-value `(x,y)` read this
  project's interpreter hardcoded) — generalized `alis-interp.ts`'s
  `SceneEnv.readGrid` to the real formula (a `pop()` closure), with Ishar
  1's own callers updated to reproduce the previously-verified 1-pop
  behavior exactly (regression-checked via VILLAGE's unchanged placement
  count). A best-effort Crystals-specific formula was tried against
  `ARBRE.bin` with real `INIT.FIC` bytes — produced a clearly-wrong result
  (600 placements, all off-screen), so this is reported as an open,
  NOT-shipped finding (new row `crystals-local-scene-array-indexing`) —
  the mechanism itself is solid and traced to source, only the final
  per-title constant assignment is unresolved. `npx tsc --noEmit -p .`/
  `npx eslint` clean on all changed files; `npm test` still 370/370 (no
  regressions). Full evidence: `docs/ishar-container-format.md` §8.3,
  `docs/crystalsofarborea/amiga/data-structure.md` §8.

- **2026-09-01 (ninth pass — first-person renderer implemented: ONE Ishar 1
  location working end-to-end, real ALIS bytecode executed)**: Following
  §8/§8.1's finding that a location script's own compiled bytecode IS the
  first-person renderer, built the minimum tooling to actually run one and
  produce real frames. New: `tools/shared/alis-disasm.ts` (a real, general
  ALIS bytecode disassembler — closes `ishar-alis-bytecode-disassembler`,
  verified 256/256 instructions against a prior session's hand-checked
  `foret.dis` reference disassembly, 0 diffs), `tools/shared/alis-interp.ts`
  (a scoped interpreter that executes a script's placement logic against
  real region-grid + party-pose inputs), `tools/shared/ishar-firstperson.ts`
  (orchestration: runs `FOND.bin`+`FORET.bin`, resolves placements through
  the already-confirmed sprite directory, composites a frame), and
  `tools/shared/ishar-script-export.ts` + `tools/ishar/amigaaga/scripts.ts`
  (ships the two scripts' decompressed bytes as browser-fetchable binary
  assets, sidestepping `silmarils-unpack.ts`'s Node-`Buffer` dependency in
  the browser). Found and fixed 3 real bugs while diffing against the
  reference disassembly (`cswitch1`/`cswitch2` target address off by 2,
  their "no-match" fallthrough address captured before vs. after the jump
  table, `oimmb`/`oimmw` needing sign-extension unlike structurally similar
  address-operand tokens) plus one empirically-derived finding (the raw
  facing byte is `compassIndex + 1`, not `compassIndex`) and one corrected
  byte-offset transcription from the original `re-oracle` brief (Ishar 1's
  `cscreen 0x000e` field offsets — values were right, positions were off by
  a constant 5). Also found and fixed a real VISUALIZATION bug (not a
  decode bug) in the already-shipped `isharBitmapToGreyscaleRGBA()`: its
  fixed 0-255 grey scale silently renders any `palOffset`-shifted bitmap as
  a near-flat block; added `isharBitmapToNormalizedGreyscaleRGBA()`
  (per-bitmap min-max stretch) and used it in the new renderer (new open
  row `ishar-greyscale-atlas-normalize` for applying it corpus-wide).
  Verified: disassembly match (above); numeric sanity (depth/elevation/LOD
  values all in-range and matching independently-derived formulas); real
  position-and-facing-responsive behaviour (9-21 placements varying across
  4 test poses, and a closer-vs-farther pose pair showing the expected
  taller/more-prominent near silhouette); visual inspection via `Read`
  (greyscale, no palette) shows a coherent three-band outdoor scene —
  honestly characterized as stylized/textured bands, not individually
  legible tree sprites. Wired into `tools/walker/games-ishar.ts`: a `KeyF`
  toggle switches Ishar 1's `CONT1` region between the existing top-down
  view (unchanged default, and still the ONLY view for every other
  region/game) and the new first-person render, cached by pose and
  recomputed only on movement. `npx tsc --noEmit -p .`/`npx eslint` clean
  on all new/changed files; `npm test` (370 tests) unaffected; a live
  browser check was NOT performed (no Playwright install available, and
  installing one was out of scope — package.json edits were disallowed
  this session). Closed `ishar-alis-bytecode-disassembler` and
  `ishar-walker-topdown-only` (superseded by the two new, narrower rows
  below). New rows: `ishar-firstperson-generalize`,
  `ishar-firstperson-backdrop-anchor`, `ishar-greyscale-atlas-normalize`.
  Full evidence: `docs/ishar-container-format.md` §8.2.

- **2026-09-01 (eighth pass — Crystals of Arborea's `CARTE.CO` overworld
  cracked: no region grid, no destination graph — a party-roster bytecode
  UI)**: Crystals has no `CONT*.FIC` files at all (confirmed: only
  `INIT.FIC` exists on disk), so the Ishar region-grid walker technique
  doesn't apply. Found and fixed a real, generalizable pipeline bug along
  the way: `silmarils-unpack.ts`'s `unpackSilmarilsScript()` only recognized
  the two compressed packer kinds, silently skipping every `classByte==0x01`
  ("stored") file — including `CARTE.CO` itself — in the sprite-atlas
  pipeline (added a `PACKER_KIND_STORED` branch; Crystals now 33/42 files
  with a decodable sprite directory, 931 sprites, up from 31/36 and 905;
  Ishar 1/2/3 re-verified byte-identical, confirming no regression). With
  `CARTE.CO`'s own sprite directory now reachable, resolved its confirmed
  map picture (an island/coastline silhouette). Then built a from-scratch
  mini ALIS interpreter (covering just the opcodes/opernames/storenames
  involved — `cscmov`/`cstore`/`oimmb`/`ofin`/`odirtc`/`sdirtc`/`seval`)
  and used it to fully resolve the previously-"structural, unclear" 8-entry
  byte-record array found in the first pass: it is real, self-terminating
  bytecode (1×`cscmov` + 15×`cstore`, ending exactly at the expected
  boundary on an unrelated opcode) that initializes two 8-element scratch
  arrays whose index order matches, exactly, 8 confirmed UI strings found
  later in the file — `JON/ZACH/IRVAN/AKEER/OLBAR/THORM/ALL/NONE` — a
  **correction** of the original "8-directional adjacency table" hypothesis
  to a **party-roster/companion-selection checklist**. Found a real
  consumer region (`cftstset` hit-test + `cboxf` highlight-draw + `clive`
  script-launch-by-id) implementing click-to-toggle interaction, confirming
  the screen is mouse-driven UI, not a walked space. Built
  `tools/walker/games-crystalsofarborea.ts` (`CrystalsOfArboreaView`): a
  menu/checklist `GameView` (map picture backdrop + 8 togglable rows +
  MOVE/EXIT), explicitly NOT a grid walker or first-person view, matching
  what's actually confirmed. `npx tsc --noEmit -p .`/`npx eslint` clean,
  `npm test` (370 tests) unaffected. New open rows:
  `crystals-carte-array-role`, `crystals-carte-destination-mechanism`. See
  `docs/crystalsofarborea/amiga/data-structure.md` §3.5, §7.

- **2026-09-01 (seventh pass — walker built on the confirmed region grids,
  re-oracle's claims independently re-verified)**: Before trusting the
  escalation's report, independently re-verified its two most falsifiable
  claims with this project's own tools: (1) rendered `CONT1.FIC` (Ishar 1)
  as a 90×54 ASCII/pixel grid — unmistakably coherent (closed building/
  compound rectangles, road lines, a bordered coastline blob), and Ishar
  2's `CONT1.FIC` at 60×90 similarly shows a smooth closed coastline
  outline; (2) re-decoded `MAP.DO` with this project's own (already-correct,
  +2/+4 offset) sprite decoder — resolves to exactly the claimed single
  320×126 type-0x12 bitmap, and its shipped greyscale render legibly shows
  the title "RENDORIA" over map artwork. Both independent checks passed
  decisively, so the escalation's report is treated as CONFIRMED per this
  project's verification bar (not just accepted on narrative). Built
  `tools/shared/ishar-regions.ts` (decoder + the HYPOTHESIS-labeled
  `isBlocked()` walkability rule) and a batch export pipeline
  (`tools/shared/ishar-region-export.ts`, per-title CLI wrappers) writing
  `public/assets/<game>/amigaaga/data/regions.json` — all 19 region grids
  (6+7+6) decode cleanly. Built `tools/walker/games-ishar.ts` (`GameView`
  for Ishar 1/2/3): a TOP-DOWN region-grid explorer (party dot + facing
  arrow over a colour-classified cell render), not a first-person view —
  honestly scoped to what's actually confirmed (`ishar-walker-topdown-only`,
  new row, supersedes the now-closed `ishar-walker-view`). `npx tsc --noEmit`
  (whole project) and `npx eslint` (all new files) both clean; a Node smoke
  test (fetch stubbed to local files) confirmed region loading, level
  listing, and movement/blocking logic all behave correctly.

- **2026-09-01 (sixth pass — `re-oracle` escalation returned: premise refuted, world grids SOLVED)**:
  The escalation succeeded by dissolving the wall rather than crossing it.
  (1) **Premise correction**: `render3d.c`'s raycaster is version-gated
  (`opcodes.c:1409` `if (alis.platform.version >= 31)`) and per
  `script.c`'s own version table Ishar 1/2/3 are v20/21/30 — **no Ishar
  title ever executes the heightfield renderer**; it's Robinson's
  Requiem's (v31). The "oracle gap" (`cdefmap` unimplemented for Ishar)
  was no gap: Ishar never issues those opcodes. Ishar's first-person view
  is generic VM sprite compositing. (2) **The real world data found and
  solved**: `CONT<n>.FIC` = raw row-major byte region grids (Ishar 1:
  90×54; Ishar 2: 2 layers 60×90; Ishar 3: 2 layers 57×82), loaded by
  `cfopen`/`cfreadb` bytecode in `MAIN.DO` (all call sites hand-decoded,
  every length byte-exact vs file sizes: 4860/2×5400/2×4674, EN1
  3640/6050/6050, TAB1 361), dimensions declared by the games' own `cdim`
  array headers (stride 90/60/57), grid at runtime `basemain+0x80`
  (+`0x234a` twin), consumers censused (`omaintc 0x0080` in GERDEP/
  RPLAINE/ENCONT + every location script), party-position globals
  identified (`basemain+0x137d`/`+0x3fd0`), and a 90×54 ASCII render of
  CONT1 shows a real coherent region map. `MAP.DO` resolved as the
  320×126 auxiliary map *picture* (a sprite-doc prose error +1/+3 vs real
  +2/+4 header offsets corrected along the way). Rows closed:
  `ishar-firstperson-view-mechanism`, `ishar-overworld-representation`,
  `ishar-fic-files`, `ishar-map-grid-geometry`. New:
  `ishar-cell-value-semantics`, `ishar-fic-semantics`,
  `ishar-alis-bytecode-disassembler`; `ishar-walker-view` unblocked.
  Full evidence: `docs/ishar-container-format.md` §8 correction blocks +
  §9.

- **2026-08-31 (fifth pass — terrain-anchor mechanism traced to a real oracle gap, escalated)**:
  Pursued both concrete next steps named by the fourth pass. (1) Applied the
  sprite-directory technique's spirit to `MAIN.DO`'s own internal
  scene-table: found (via `copensc`, opcode 0x4e) that scene-id values are
  literal bytecode immediates, not static data — so a byte-pattern struct
  scan can't find real instances; ran one anyway across all 4 titles'
  `MAIN.bin` as a due-diligence check, got only weak/non-independent hits
  (a real negative, not under-effort). (2) Traced `calloctab` (0xe9, a
  generic lazy-allocator for VM scratch tables, not terrain-specific) and,
  more importantly, `cdefmap` (0xe3) — the actual writer of the
  `scene_addr+0x40`/`+0x42` fields `render_context` is built from. Found
  the exact mechanism (bytecode-embedded self-relative offset -> raw
  dimension bytes stored just before it, in the terrain-owning file's own
  bytes) but also found `opcodes.c`'s own dispatch table stubs opcode 0xe3
  (and its siblings 0xe4/0xe5/0xe8/0xf7/0xf8/0xfd) to a no-op for every
  game except Transarctica/Robinson's Requiem — **the reference oracle's
  own authors never reverse-engineered this for Ishar**. This is a genuine
  gap in the ground-truth oracle, not a search failure — escalated to
  `re-oracle` (process update this session: escalate directly to
  `re-oracle`, skip `re-codebreaker`) with a full self-contained brief.
  Result pending. See `docs/ishar-container-format.md` §8.1.

- **2026-08-31 (fourth pass — sprite format CONFIRMED, renderer architecture identified)**:
  Closed Priority 1 of the task brief (`ishar-png-render`, row removed —
  solved). Found and ported the per-script resource-directory mechanism
  (`adresdes()`, 2-level self-relative indirection) and 6 bitmap
  pixel-encoding types (raw/banked 4-bit, direct 8-bit, each masked/opaque)
  from `github.com/maestun/alis` (MIT), a real source-available ALIS-VM
  reimplementation documented "Playable" for exactly these titles/platform.
  Applied blind to real corpus bytes: 74/98, 119/137, 113/136, 31/36 files
  (Ishar 1/2/3/Crystals) have a valid directory, decoding 1,608/2,244/2,744/
  905 sprites respectively. Verified via genuinely recognizable rendered art
  (barbarian warriors, a dragon, a tree, an orc, a skeleton) — see
  `docs/ishar-sprite-format.md`. New module `tools/shared/ishar-sprites.ts`
  + batch pipeline `tools/shared/ishar-sprite-atlas.ts` + 4 per-title CLI
  wrappers. Real AGA colour palette resolution remains open
  (`ishar-sprite-palette`, new row) — bytecode-selected, not statically
  located.
  Made real progress on Priority 2 (the first-person mechanism question):
  `alis`'s `render3d.c`/`render3d_68k.c` implement a real heightfield/
  voxel-column terrain raycaster — a decisive qualitative answer (not a
  wall-tile compositor, more specific than a generic vector/placement-list
  format), grounded in source-available VM code for exactly this
  game+platform. The exact on-disk terrain-grid location remains open; an
  earlier numeric claim this session (`fileOffset18==0x0020` in 226/235
  files) was explicitly WITHDRAWN after finding its field-offset semantics
  apply to MAIN's own script data, not each file's own bytes — a real
  self-caught category error, documented as a correction rather than
  silently dropped. Priorities 3 (`MAP.DO` grid geometry) and 4 (walker
  `GameView`) were deliberately NOT attempted, since the terrain-geometry
  decode isn't yet at extractable-per-location confidence (new
  `ishar-walker-view` row, deferred). See
  `docs/ishar-container-format.md` §7-8.

- **2026-08-30 (third pass — user-confirmed game structure)**: the user
  (who has played these games) confirmed Ishar 1/2/3 are "completely
  first-person crawlers, except you spend a lot of time outdoors exploring
  islands and so on, still in first-person" — there is no separate top-down/
  node-graph overworld mode. This reframes (doesn't refute) the second
  pass's two open mechanism items: `ishar-overworld-representation` is now
  "what does the auxiliary map screen show", not "what does the player
  navigate through" (always first-person, indoors and out); it also
  *strengthens* `ishar-firstperson-view-mechanism`'s "one shared scene
  format" reading, since outdoor and indoor content sharing an identical
  header shape is exactly what one shared first-person compositor predicts.
  See the correction block in `docs/ishar-container-format.md` §6 and both
  rows' updated text below.

- **2026-08-30 (second pass — compression cracked)**: Closed 3 items from the
  first pass. **`ishar-compression-codec`**: found real open-source prior
  art for this exact engine (`github.com/maestun/silm-depack`,
  `github.com/maestun/alis`, both MIT) via `WebSearch`; ported both codecs
  (old PackBits-style RLE `0x81`/`0x80`, new LZ77-style bitstream `0xA1`)
  faithfully to `tools/shared/silmarils-unpack.ts`. Verified two ways:
  corpus-wide packed-byte-consumption self-consistency (83/97 exact for the
  new codec, all off-by-exactly-1 for the old codec — explained precisely
  by the reference's loop structure) and real readable decoded content
  (`MANUEL.CO`'s English manual table of contents, `MESSAGE2.CO`'s NPC
  dialogue). Full-corpus batch decompression now runs clean:
  ishar/amigaaga 98/98, ishar2/amigaaga 137/137, ishar3/amigaaga 136/136,
  crystalsofarborea/amiga 42/42 — see `tools/shared/ishar-decompress.ts`,
  `npm run <game>:decompress`. **`ishar-header-boundary`**: resolved as part
  of the codec crack — the "near-constant offset 17-22" bytes are the tail
  of the LZ77 dictionary, not unexplained padding (see
  `docs/ishar-container-format.md` §2.4). **`ishar-prior-art-search`**:
  done, found real prior art (above).
  Also made real progress on the two open content questions: `MAIN.DO`
  fully decoded (30-name monster roster, full location-name list, embedded
  level-editor debug strings implying a hierarchical country/region/zone
  coordinate model for the overworld) and a new cross-title structural
  finding — `MAP.DO`, all of Ishar 1's `*CAVE*.DO` files, several outdoor/
  monster graphics, AND Ishar 2's `DJ*.DO` dungeon files all share one
  identical 16-byte "scene/resource header" shape, arguing for one generic
  engine-wide scene descriptor format rather than separate tile-grid and
  wall-compositor formats. Both are STRUCTURAL/HYPOTHESIS, not yet code-
  confirmed (no disassembly trace of the renderer this session) — see the
  new `ishar-overworld-representation` and `ishar-firstperson-view-mechanism`
  rows. Fixed a real bug in `ishar-decompress.ts`'s handling of `classByte
  == 0x01` (stored) files, which were returning the whole raw buffer
  including the 6/22-byte container header as "content" — corrected to
  skip the header like every other class. `npx eslint`/`npx tsc --noEmit`
  clean on all new/changed files (4 real lint findings from a `reviewer`
  agent pass fixed: an unused catch binding, 3 `let`-should-be-`const`).

- **2026-08-30 (first pass)**: Container format cracked structurally across
  all 4 titles (16-byte header, `classByte`/24-bit decompressed-size
  field, two compressed sub-classes + one stored class — see
  `docs/ishar-container-format.md`). Confirmed `T.X`/`START` are real
  AmigaOS executables (a correction to the original task brief, which
  believed no executable existed for 3 of the 4 titles). Escalated the
  compression codec itself to the `amiga-disasm` agent (Ishar 1's `T.X`).
  Found `MAIN.DO`/`MAIN.CO` is a resource manifest via readable `.AO`
  filename strings. Found Crystals' `CARTE.CO` is uncompressed and
  contains real NPC names + travel UI text + a structural 8-entry record
  array. Built `tools/shared/ishar-container.ts` +
  `tools/shared/ishar-inventory.ts` and four per-title inventory CLI
  scripts, all run and verified against the real corpora (413 compressed
  + 6 stored + non-container files, 0 parse failures). File-role catalogs
  written for all 4 titles from filename evidence (French-language
  reading), confirming the overworld/outdoor vs. first-person-cave/dungeon
  split the task asked about exists as a real file-naming distinction —
  but no pixel/geometry content has been decoded yet, so the *mechanism*
  question for both remains open.

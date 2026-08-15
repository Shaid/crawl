# Might & Magic I + II + III — Maze Walkers

The MM1, MM2, and MM3 first-person walkers are games in the **shared
Dungeon Walker** (`tools/walker/index.html`, the dev-server default page,
`npm run dev`), alongside Black Crypt and Wizardry 6 — pick them from the
game dropdown. The old `tools/walker-mm/` page now redirects there (it
remains the home of the shared frustum engine).

All three MM walkers render through the **ASM-faithful frustum engine**
(`tools/walker-mm/maze3d.ts`, a TS port of the shared core of Vairn/MM2's
wiki walkers — traced from the games' own 3D-view code). The MM1/MM2 views
live in `tools/walker/games-mm.ts`, MM3's in `tools/walker/games-mm3.ts`,
all as `GameView` implementations that draw the whole main canvas
themselves (`GameView.renderCanvas`) and their own minimap
(`GameView.renderMinimap`) — the MM art is full-colour (or, for MM3,
flat-shaded — see below), so they bypass the DrawItem/IndexedSurface
composite path the BC/W6 views use.

| | MM1 (`mm1`) | MM2 (`mm2`) | MM3 (`mm3`) |
|---|---|---|---|
| Wall art | **Real `WALLPIX.DTA` slices** (18 sets × 12 frustum slices) — each screen's near/mid/far frustum depth lanes each pick their own set from the decoded `.OVR` selection fields (`wallEntries[0..2]`; overland lanes are biome entries, e.g. AREAA1 = near/mid/far wall07/wall14/wall13) | Authentic `.32` sheets per env (`town`/`cave`/`castle` wall, floor, torch, sky) | **Real art on every visible face** — front, both sides, floor, and ceiling — through MM3's own real 44-slot indoor 3-D view (`tools/walker/mm3-indoor-view.ts`, ported from the disassembly-decoded `scripts/mm3lib/dos_indoor_view.py`), not the borrowed MM1/MM2 frustum. Each maze's environment (`twn`/`cav`/`dun`/`cas`/`sci`, resolved from a 40-byte constant table in the game's own code) picks its `<series>wl{1,2,3,4}.vga` + `<series>.sky` sprites; every wall's real per-position frame (door/torch/grate/opening/post) renders, not just a plain wall. Falls back to the older, partial depth-0-only MM1/MM2-frustum renderer if the real table/sprites fail to load |
| Torch overlays | **none** — MM1 renders no torch overlay (the reference implementation draws code-3 faces as plain walls; WALLPIX has no torch frames) | authentic `*t.32` with 3-phase flicker | none — MM3 doesn't distinguish door/torch from plain wall yet |
| Floor/sky bands | simple dark band | `*f.32` floor + `sky.32` (roof bit flips the sky frame) | simple dark band |
| Screens | all 55 (indoor frustum everywhere; overland uses its biome wall art) | indoor: 0–4 town, 17–32 cavern, 45–59 castle; **overland (5–16, 33–44) renders the outdoor scene** (`outdoor3d.ts` port: outdoor1-3 horizon lanes + desert/ocean/swamp/tundra decor bands from the terrain ids, terrain minimap from `outb.32`) | the 81 **indoor** mazes only (ids 1-103/105/106 minus the 24 outdoor ids 41-64, which use the wall word as terrain layers, not walls — not supported by this indoor-only view yet) |
| Cross-screen stepping | none (edges clamp; level selector jumps) | yes — attrib `neighbours` links (indoor + overland) | yes — each maze's trailer stores its N/E/S/W neighbour maze id directly (`docs/mm3/dosvga/data-structure.md` "Maze records") |

Controls: **WASD/arrows** move/turn, **Q/E** turn, noclip checkbox, Tab
zooms the automap (BC/W6). URL params: `?game=mm1&map=5&x=4&y=2&facing=0`
(partial params allowed — `?game=mm2` alone works; missing pose fields use
the map's entrance cell; `?game=mm3&map=33` opens Castle Blackwind, the
maze independently verified against its own hand-drawn route map — see
`docs/mm3/TODO.md` `mm3-cur-format`).

## MM3: movement is not reused from MM1/MM2

MM3's maze records (`data/mazes.json`, decoded from `MM3.CUR`) pack each
cell's 4 walls as 4-bit fields (3-bit graphic index + 1 blocking bit) in a
16-bit word — a different shape than MM1/MM2's 2-bit page-0 codes. Two
consequences, both documented in `tools/walker/games-mm3.ts`:

- **Rendering** reduces each wall to plain code `1` and packs it into the
  same byte shape `buildIndoorScene`/`StitchedVisual` already expect — but
  **not** in compass-literal `N,E,S,W` order. The correct bit-slot order
  (`W,S,E,N`) was found empirically (a 24-permutation brute-force search
  against MM3's own disassembly-confirmed wall-blocking oracle), not
  assumed — the naive compass-literal packing renders ~40% of walls in the
  wrong screen position. `tools/walker/__tests__/games-mm3.test.ts` pins
  this exhaustively (every indoor maze × every cell × every facing) as a
  regression guard.
- **Movement** does not call `movementBlocked`/`stepParty` at all — those
  are wired to MM1/MM2's differently-shaped *collision* page, whose
  internal field-to-direction mapping isn't a simple mirror of the visual
  page either (also confusing enough to be a real footgun). MM3 has its
  own small, independent step/cross-maze implementation reading the wall
  word's blocking bit directly.

## Data plumbing

- MM1: `public/assets/mm1/dosega/data/maps.json` (55 decoded screens) +
  `data/ovr.json` (per-screen WALLPIX entry) + `textures/wallpix.*`. The
  raw page bytes are reconstructed from the decoded cells (byte-exact
  inverse of the codecs).
- MM2: `public/assets/mm2/amiga/data/map.json` + `attrib.json`
  (`neighbours`, `roofBits`; env by screen range: 0–4 town, 17–32 cavern,
  45–59 castle, else overland) + `textures/{town,cave,castle}{,f,t}.png`
  and `sky.*`. Note `map.json` is a **bare array** (not `{screens}`) and
  `roofBits` serialized as a string-keyed object (Uint8Array→JSON) — the
  loader handles both.
- MM3: `public/assets/mm3/dosvga/data/mazes.json` (all 105 decoded maze
  records; the walker filters to the 81 `kind: 'indoor'` ones). Each
  record's `walls` (256 × u16), `surrounding` (N/E/S/W neighbour maze
  ids), `runPosition` (per-maze start cell), and `graphics.wallSeries`/
  `.sky` (which texture set the maze uses) are used directly. Plus
  `data/indoor-view.json` — the static 44-slot view geometry/dispatch
  table (same for every maze; not maze-specific data), and
  `sprites/walls/<series>wl{1,2,3,4}.vga.*` + `sprites/skies/<series>.sky.*`
  for the real art.

## Page-0 wall codes (corrected)

The frustum engine treats page-0 codes as `1` wall, `2` **door**, `3`
**wall+torch** — see the Correction blocks in `docs/mm1/dosega/
data-structure.md` / `docs/mm2/amiga/data-structure.md` (the earlier
"2=torch, 3=door" prose was wrong).

## Verification

Headless playwright run (MM1/MM2, predates MM3): the redirect lands on the
integrated walker with MM1 selected; all games in the dropdown; MM1
renders Sorpigal (entry cell (4,2), matching the OVR data) with white town
walls and **no torch overlay**; MM2 renders town/cave/castle `.32` art
with sky/floor bands and **overland screens render the outdoor scene**
(horizon + biome decor) with a terrain minimap; switching games leaves no
stale pixels (the canvas is cleared in full); level switching, movement
and URL pose params work; zero console errors. `tools/walker-mm/__tests__/`
pins the frustum engine and the outdoor scene builder (terrain lookup,
biome mapping, neighbour stitching).

MM3 verification (no browser available when it was built, so this is
numeric + a mocked-canvas smoke test rather than a live Playwright pass —
**still open** as a follow-up, see TODO `mm3-maze-viewer`): the wall bit
packing is checked exhaustively against MM3's own disassembly-confirmed
`wallBlocked` oracle (81 indoor mazes × 256 cells × 4 facings = 82,944
cases, 0 mismatches — `tools/walker/__tests__/games-mm3.test.ts`), and a
mocked-`CanvasRenderingContext2D` smoke test confirms `renderCanvas`
actually produces sensible draw calls (correct tile dimensions at the
expected screen positions, wall-rect counts varying sensibly by facing).

A first live Playwright pass (2026-08-15, in response to user play-testing
reports — see below) confirmed real indoor-view rendering in a browser for
several mazes/positions/facings, including stepping through a corridor —
still not a full sweep, but no longer purely numeric.

## Known issues (user-reported, 2026-08-15)

The user flagged real issues with the MM1 and MM2 walkers from actually
using them, without specifics yet — **still open**, no repro details given.
When specifics come in, reproduce live in the browser (not just the unit
tests above, which cover specific mechanisms, not a full play-through)
before making changes.

The user also reported two MM3 issues from actually playing it:

- **"doors, walls, pillars all keep mirroring"** — **fixed**. The
  side-wall alternation (`alt` in `buildWallList`, DS `0x185` in the real
  game — see "Indoor 3-D view" above) was tied to wall-clock time
  (`Math.floor(tick / 220) % 2`, flipping ~4.5×/second even while
  standing still) instead of the real game's own cadence, "flipped
  roughly once per redraw". Now tied to a `redrawCount` incremented once
  per accepted turn/step (`tools/walker/games-mm3.ts` `MM3View.update`),
  matching the documented "corridor slides past you as you walk" effect
  instead of flickering continuously.
- **"the right-hand side-walls render as open corridors when they should
  be closed"** — **fixed** (root cause found, not in the 3-D view). First
  checked the underlying wall data/algorithm exhaustively (a synthetic
  single-wall probe symmetric left/right at every depth and facing; a
  corpus-wide real-data sweep across all 81 indoor mazes, filtered to
  genuinely unobstructed corridors so occlusion doesn't confound the
  count, showing 0% missing draws on either side at every depth) and a
  live spot-check render — all correct, so the 3-D view itself was never
  the bug. The user then supplied a screenshot: an east-facing position
  where the **minimap** was being read as "closed" on a side the 3-D view
  correctly rendered open. The bug was in `MM3View.renderMinimap`
  (`tools/walker/games-mm3.ts`): maze `y` increases **north** (confirmed
  by `STEP_DY`), but the minimap drew row `y` at canvas row `y` directly
  — self-consistently south-up (drawing each cell's north wall at its own
  *bottom* edge), while the facing-direction arrow a few lines later
  assumed the ordinary north-up convention (`dy=-1` = up = facing N). The
  two halves of the same function disagreed about which way was up. For
  an E/W-facing party the minimap's up/down axis maps to the first-person
  view's left/right, so the mismatch reads exactly as "the map shows this
  side closed, the view shows it open" — on whichever side is actually
  correct. Fixed by drawing row `y` at `MAP_GRID-1-y` (north-up, matching
  the arrow) instead of changing the arrow. Verified live: a party at the
  maze's northernmost row (`y=15`) now renders at the top of the minimap,
  not the bottom.

# Might & Magic I + II — Maze Walkers

The MM1 and MM2 first-person walkers are games in the **shared Dungeon
Walker** (`tools/walker/index.html`, the dev-server default page, `npm run
dev`), alongside Black Crypt and Wizardry 6 — pick them from the game
dropdown. The old `tools/walker-mm/` page now redirects there (it remains
the home of the shared frustum engine).

Both walkers render through the **ASM-faithful frustum engine**
(`tools/walker-mm/maze3d.ts`, a TS port of the shared core of Vairn/MM2's
wiki walkers — traced from the games' own 3D-view code). The MM views live
in `tools/walker/games-mm.ts` as `GameView` implementations that draw the
whole main canvas themselves (`GameView.renderCanvas`) and their own
minimap (`GameView.renderMinimap`) — the MM art is full-colour, so they
bypass the DrawItem/IndexedSurface composite path the BC/W6 views use.

| | MM1 (`mm1`) | MM2 (`mm2`) |
|---|---|---|
| Wall art | **Real `WALLPIX.DTA` slices** (17 sets × 12 frustum slices) — each screen picks its set from the decoded `.OVR` selection fields (`wallEntries[0]`; overland uses its biome entry) | Authentic `.32` sheets per env (`town`/`cave`/`castle` wall, floor, torch, sky) |
| Torch overlays | **none** — MM1 renders no torch overlay (the reference implementation draws code-3 faces as plain walls; WALLPIX has no torch frames) | authentic `*t.32` with 3-phase flicker |
| Floor/sky bands | simple dark band | `*f.32` floor + `sky.32` (roof bit flips the sky frame) |
| Screens | all 55 (indoor frustum everywhere; overland uses its biome wall art) | indoor: 0–4 town, 17–32 cavern, 45–59 castle; **overland (5–16, 33–44) renders the outdoor scene** (`outdoor3d.ts` port: outdoor1-3 horizon lanes + desert/ocean/swamp/tundra decor bands from the terrain ids, terrain minimap from `outb.32`) |
| Cross-screen stepping | none (edges clamp; level selector jumps) | yes — attrib `neighbours` links (indoor + overland) |

Controls: **WASD/arrows** move/turn, **Q/E** turn, noclip checkbox, Tab
zooms the automap (BC/W6). URL params: `?game=mm1&map=5&x=4&y=2&facing=0`
(partial params allowed — `?game=mm2` alone works; missing pose fields use
the map's entrance cell).

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

## Page-0 wall codes (corrected)

The frustum engine treats page-0 codes as `1` wall, `2` **door**, `3`
**wall+torch** — see the Correction blocks in `docs/mm1/dosega/
data-structure.md` / `docs/mm2/amiga/data-structure.md` (the earlier
"2=torch, 3=door" prose was wrong).

## Verification

Headless playwright run: the redirect lands on the integrated walker with
MM1 selected; all four games in the dropdown; MM1 renders Sorpigal (entry
cell (4,2), matching the OVR data) with white town walls and **no torch
overlay**; MM2 renders town/cave/castle `.32` art with sky/floor bands and
**overland screens render the outdoor scene** (horizon + biome decor) with
a terrain minimap; switching games leaves no stale pixels (the canvas is
cleared in full); level switching, movement and URL pose params work; zero
console errors. `tools/walker-mm/__tests__/` pins the frustum engine and
the outdoor scene builder (terrain lookup, biome mapping, neighbour
stitching).

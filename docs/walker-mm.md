# Might & Magic I + II — Maze Walkers

Interactive first-person 3D explorers for both games, served by the dev
server at **`/tools/walker-mm/`** (vite dev server, `npm run dev`).

Both walkers run the **same ASM-faithful frustum engine**
(`tools/walker-mm/maze3d.ts`), a TS port of the shared core of Vairn/MM2's
`wiki/{maze-walker,mm1-maze-walker}/view3d.js` (itself traced from the
games' own 3D-view code — `buildFrustum`/`collectBlits`/`torchBlitFor`/
`StitchedVisual`). The art sources differ per game:

| | MM1 (`mm1`) | MM2 (`mm2`) |
|---|---|---|
| Wall art | **Real `WALLPIX.DTA` slices** (17 sets × 12 frustum slices, `textures/wallpix.*`) — each screen picks its set from the decoded `.OVR` selection fields (`wallEntries[0]`; overland uses its biome entry) | Authentic `.32` sheets per env (`town`/`cave`/`castle` wall, floor, torch, sky) |
| Wall-set override | toolbar dropdown (auto / wall 00–16) | — |
| Torch overlays | MM2 torch sheets as stand-ins (MM1 WALLPIX has no torch frames — same choice Vairn made) | authentic `*t.32` with 3-phase flicker |
| Floor/sky bands | simple dark band | `*f.32` floor + `sky.32` (roof bit flips the sky frame) |
| Screens | all 55 (indoor frustum everywhere; overland uses its biome wall art) | indoor: 0–4 town, 17–32 cavern, 45–59 castle; **overland (5–16, 33–44) shows a placeholder** (terrain-id pages — horizon renderer is future work) |
| Cross-screen stepping | none (edges clamp; screen selector jumps) | yes — attrib `neighbours` links |

Controls: **WASD/arrows** move/turn, **Q/E** turn, **N** noclip, **Tab**
zooms the minimap. Toolbar: game, screen, wall-set (MM1), noclip.

## Data plumbing

- MM1: `public/assets/mm1/dosega/data/maps.json` (55 decoded screens) +
  `data/ovr.json` (per-screen WALLPIX entry) + `textures/wallpix.*`. The
  raw page bytes are reconstructed from the decoded cells (byte-exact
  inverse of the codecs).
- MM2: `public/assets/mm2/amiga/data/map.json` + `attrib.json`
  (`neighbours`, `roofBits`; env by screen range: 0–4 town, 17–32 cavern,
  45–59 castle, else overland) + `textures/{town,cave,castle}{,f,t}.png`
  and `sky.*`. Note `map.json` is a **bare array** (not `{screens}`) and
  `roofBits` serialized as a string-keyed object (Uint8Array→JSON) —
  the loader handles both.

## Page-0 wall codes (corrected)

The frustum engine treats page-0 codes as `1` wall, `2` **door**, `3`
**wall+torch** — see the Correction blocks in `docs/mm1/dosega/
data-structure.md` / `docs/mm2/amiga/data-structure.md` (the earlier
"2=torch, 3=door" prose was wrong).

## Verification

Headless playwright run (via the middilgard checkout's `playwright`): both
games load, screens switch, movement/override/noclip work, zero console
errors. Rendered canvases match the expected art palettes — MM1 Sorpigal
(entry 0) shows white/stone walls, Cave 1 (entry 3) shows green walls, MM2
town/cave/castle screens show their `.32` wall art with sky/floor bands.
`tools/walker-mm/__tests__/maze3d.test.ts` pins the frustum engine
(determinism, movement blocking, torch placement, slice-name mapping).

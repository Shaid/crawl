# MM1 (DOS) — MAZEDATA.DTA

**Game:** Might & Magic: The Secret of the Inner Sanctum (New World
Computing, 1986) — MS-DOS release (GOG build, `data/mm1/dosega/`).

**Source of truth:** Vairn/MM2 `EXTRACTED/docs/22-mm1-mazedata-format.md`
plus ScummVM `engines/mm/mm1` (MM1's map loader is ScummVM-supported, so the
"MapWalls" bit layout below is independently implemented there).

All file offsets in this doc are **file-relative**.

---

## Container — `MAZEDATA.DTA` (28,160 B)

The whole geometry file is a flat array of **55 screens × 512 B** — the same
layout as MM2 `map.dat` (60 × 512), so the per-cell decode is shared with the
MM2 codec (`tools/mm2/map.ts` → `tools/mm1/map.ts`).

| Offset | Size | Page |
|--------|------|------|
| `0x000` | 256 | **Visual** — four 2-bit wall fields per cell (N/E/S/W): `0` open, `1` wall, `2` wall+torch, `3` door |
| `0x100` | 256 | **Collision** — per direction `(dark<<1)\|wall`; bit `0x80` = event flag |

Cell packing (both pages): `N = byte&3`, `E = (byte>>2)&3`, `S = (byte>>4)&3`,
`W = (byte>>6)&3`. Grid is 16×16, row 0 on disk = **south** (automap renders
north-up).

### Overland caveat (screens 14–33, `area*`)

Overland sectors still use the same MapWalls page-0 encoding in the original
game (not MM2's terrain ids). Cells whose four 2-bit fields are all `3`
(`0xFF` byte) are **border/edge cells**, not doors — Vairn's MM1→MM2 outdoor
converter treats them as template edge tiles (see Vairn's
`23-mm1-to-mm2-outdoor.md`). The JSON output stores raw codes; consumers
interpreting overland should not read code 3 as "door" there.

## Screen names — `MM.EXE` slug table

`MM.EXE` embeds a null-terminated slug table at **file offset `0x10C07`**
(55 entries, MAZEDATA order):

`sorpigal portsmit algary dusk erliquin cave1…cave9 areaa1…areae4 doom
blackrn blackrs qvl1 qvl2 rwl1 rwl2 enf1 enf2 whitew dragad udrag1…udrag3
demon alamar pp1…pp4 astral`

Each slug names a companion **`*.OVR`** map-script overlay in the same
directory (55 files), which is how the order and the screen count are
independently cross-verified. `tools/mm1/map.ts` exposes the table as
`MM1_MAP_SLUGS` and can re-parse it from the executable with
`parseMapSlugsFromExe` (searches for the first `"sorpigal\0"`, reads
consecutive lowercase alphanumeric strings until 55 are found).

## Verification (all against real retail bytes)

| Check | Result |
|-------|--------|
| File size | 28,160 B = 55 × 512 exactly |
| TS round-trip (decode → encode vs disk) | byte-exact, 0 deviations |
| TS decode vs Vairn's independent Python decoder (`mm1_maps.py`) | byte-exact, 55/55 screens |
| MM.EXE slug table @ `0x10C07` vs documented table | byte-exact, 55 slugs |
| `*.OVR` filenames vs slug table | set-equal, 55/55 |
| Minimap atlas (11×5, 2 px/cell, north-up) | 53,230/53,230 non-dot pixels exact + 3,090/3,090 event-dot pixels exact |

## Outputs (`public/assets/mm1/dosega/`)

| Path | Contents |
|------|----------|
| `data/maps.json` | `{game, file, size, screenSize, pageSize, grid, screens:[{index, slug, title, env, entry, stats, cells}]}` — every screen fully decoded; `env` = `town`/`cavern`/`outside`; `entry` = first fully-open collision cell (walk-in point) |
| `screens/mm1-maps.png` | 55 north-up minimaps, 11×5 atlas, 352×160; colours: floor `#181820`, wall `#a8a8b0`, torch `#f8c850`, door `#e07048` (overland border cells render as doors by code), dark cells dimmed, event cells get a red dot |
| `screens/mm1-maps.json` | atlas sidecar, frame names = slugs |

## `.DTA` graphics container — `WALLPIX.DTA` / `MONPIX.DTA` (**solved**)

Both files use one shared container + image format, ported directly from
ScummVM's `engines/mm/mm1` (`gfx/dta.cpp`, `gfx/screen_decoder.cpp`; GPL
oracle — same strategy as the EOB/LoL kyralib pass). Decoders:
`scripts/mm1lib/dta.py` + `scripts/mm1lib/wallpix.py`, extractor
`scripts/extract_mm1_gfx.py` (`npm run mm1:gfx`).

### DTA container (both files)

| Offset | Size | Field |
|--------|------|-------|
| `0x000` | 2 | `u16LE` index byte-size (multiple of 4) |
| `0x002` | index_size | `u32LE` offset table: one entry offset per entry **plus a sentinel** (last = payload end) |
| after | — | entry payloads, back to back |

`WALLPIX.DTA` has **17 entries**, `MONPIX.DTA` **75**. Each entry payload
begins with its own `u16LE` size word (the compressed byte count of the
rest of the entry — validated: holds 92/92 entries).

### ScreenDecoder image format (per tile / per image)

The entry body is an RLE stream the decoder consumes into a `w/4 × h` grid
of 2bpp cells, then expands MSB-first into 4 CLUT8 pixels per cell byte via
a 4-entry `_indexes[]` remap, then the caller maps those through the
standard 16-colour EGA palette:

- RLE: literal byte, or `0x7B <len-1> <value>` = run of `len` bytes. A
  literal `0x7B` cannot occur in the stream.
- **Column-major fill** — the C++ fill advances a base pointer once per
  completed column (`destP[index]` with a moving `destP`), i.e. write
  position = `col + row*stride`, NOT `idx += stride` with `idx` reset to 0.
  Porting it the naive way still consumes the stream exactly (the loop
  structure is unchanged) but silently overwrites column 0 and renders
  single-colour images — this bit us mid-pass and is why the ported
  `decode_screen` explicitly tracks `(row, col)`.
- Runs may overrun a tile's cell grid; excess bytes are discarded (the game
  never stores data that triggers the C++ out-of-bounds path).

### WALLPIX — 17 wall sets, 12 frustum slices each

`Maps::loadTile()` (`maps/maps.cpp`): each entry skips its size word, then
holds **12 sequential tiles** at fixed sizes — 4 left-wall slices near→far,
4 right-wall, 4 front/mid:

| Slice | Size | Role |
|-------|------|------|
| 0–3 | 32×128, 40×96, 24×64, 16×32 | left wall column, near → far |
| 4–7 | same | right wall column |
| 8–11 | 176×96, 96×64, 48×32, 16×16 | front wall column |

Per-entry colour remap: `TILE_COLORS[entry]` → `_indexes = [0, colors&0xf,
colors>>4, 15]`. Overland biome labels (Vairn doc 24: entry+1 = wallNN):
entries 6–13 = trees/mountains/lava/swamp/water/thick-forest horizons.
Screens select their set via `TILE_AREAS`/`TILE_OFFSET` (towns/caves →
entries 0–5; overland → 6–13; area 3 → 14–16).

### MONPIX — 75 monster portraits

`Monsters::getMonsterImage()` (`data/monsters.cpp`): each entry decodes to a
single **104×96** image. Per-image remap: `PALETTE[imgNum]` u16 →
`_indexes = [pal&0xf, pal>>4&0xf, pal>>8&0xf, pal>>12&0xf]`. Monster names
from ScummVM's static `monsters.txt` (195 monsters, last field = `_imgNum`);
~69 distinct images are shared by multiple monsters. All aquatic monsters
(Giant Leech, Crocodile, Barracuda, Giant Squid, Electric Eel, Shark, Great
Sea Beast) map to **imgNum 75, which has no MONPIX entry** (they get no
portrait; ScummVM tolerates the empty stream).

### Verification (real retail bytes)

| Check | Result |
|-------|--------|
| Container: index sizes 72/304, entry counts 17/75 | exact |
| Per-entry `u16LE` size word vs payload length | 92/92 match |
| Decode consumption vs payload length | **92/92 entries, 0 remainder** (every byte accounted) |
| WALLPIX symmetric wall sets (entries 0/2/9/14/15/16) | L/R agreement 0.65–0.93 |
| WALLPIX asymmetric sets (overland horizons 3–6/8/10/12) | low L/R agreement — correct, landscapes aren't mirrored |
| Biome-consistent colours | towns bright white/stone; entry 11 blue sky+yellow; entries 12/13 cold cyan/white; entry 6 green/brown |
| MONPIX multi-colour content | 75/75 images use ≥2 of their 4 remap colours |
| Monster names | Flesh Eater→img4, Mummy→img61, Demon King→img73, Succubus Queen→img74 |

Outputs (`public/assets/mm1/dosega/`): `textures/wallpix.png` (204-slice
atlas + sidecar), `data/wallpix.json`, `sprites/monpix.png` (75-portrait
atlas + sidecar), `data/monpix.json`.

## Still open (not part of this pass)

- `ROSTER.DTA`, `GACARD.DTA`, `SCREEN0`–`9`, `MM.RSM` — untouched (roster
  format has a ScummVM oracle in `data/roster.cpp`).
- Items / monsters / spells / `*.OVR` event scripts — Vairn explicitly did
  **not** decode these (doc 52). Likely sources: `MM.EXE` tables + per-map
  OVR code/data segments. Oracle: ScummVM `engines/mm/mm1`.
- `FLOORPIX.DTA`/`OBJPIX.DTA` — absent from this GOG install.
- A live-game (DOSBox) screenshot comparison for the WALLPIX/MONPIX renders
  would be a stronger visual oracle than the structural checks above — not
  yet performed (no DOSBox in this environment).

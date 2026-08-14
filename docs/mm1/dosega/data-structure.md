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

## Still open (not part of this pass)

- `WALLPIX.DTA` pixel format — Vairn has only *partial* coverage (496×128
  composites sliced into 12 frustum pieces; his exports came from lagdotcom's
  external RE, not shipped). The per-sector lane→biome tables are decoded
  (Vairn's doc 24).
- `MONPIX.DTA` (81,872 B monster portraits), `ROSTER.DTA`, `GACARD.DTA`,
  `SCREEN0`–`9`, `MM.RSM` — untouched.
- Items / monsters / spells / `*.OVR` event scripts — Vairn explicitly did
  **not** decode these (doc 52). Likely sources: `MM.EXE` tables + per-map
  OVR code/data segments. Oracle: ScummVM `engines/mm/mm1`.
- `FLOORPIX.DTA`/`OBJPIX.DTA` — absent from this GOG install.

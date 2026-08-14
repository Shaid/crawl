# Might & Magic: The Secret of the Inner Sanctum — integration plan

## Ground truth

Like MM2, this game's reverse engineering is treated as a **finished project**
rather than re-derived: Vairn/MM2 (https://github.com/Vairn/MM2) contains a
dedicated MM1 (DOS) section — docs `50-mm1-overview.md`,
`51-mm1-art-and-graphics.md`, `52-mm1-items-monsters-events.md`,
`22-mm1-mazedata-format.md`, `23-mm1-to-mm2-outdoor.md`,
`24-mm1-outdoor-wallpix-by-sector.md`, plus `tools/mm1_*.py` and an
interactive 3D maze walker (`wiki/mm1-maze-walker/`). MM1 shares the same
overland grid and nearly identical maze geometry with MM2, which is why Vairn
documented it at all.

Additional authoritative oracle: **ScummVM `engines/mm/mm1`** (loaders for the
undecoded item/monster/spell/OVR-script data).

## Data

Retail GOG DOS files (gitignored) live at `data/mm1/dosega/` — `MAZEDATA.DTA`,
`WALLPIX.DTA`, `MONPIX.DTA`, `ROSTER.DTA`, `GACARD.DTA`, `MM.EXE`, `MM.RSM`,
`SCREEN0`–`SCREEN9`, and all 55 `*.OVR` map-script overlays. (Note:
`FLOORPIX.DTA`/`OBJPIX.DTA` are absent from this GOG install.)

## What this pass integrated

| Area | Deliverable |
|------|-------------|
| Layout | `data/mm1/dosega/`, `public/assets/mm1/dosega/`, `docs/mm1/` |
| Framework registration | `src/game-id.ts`, `tools/shared/game-config.ts`, `tools/shared/viewer-config.ts` |
| Codec | `tools/mm1/map.ts` — MAZEDATA codec (shares the cell decode with `tools/mm2/map.ts`), slug/title/env tables, MM.EXE slug parser, entry-point finder |
| CLI | `tools/mm1/export-maps.ts` — 55 screens → `data/maps.json` + 11×5 minimap atlas |
| Verification | 14 mm1 tests (9 unit + 5 real-data); decode is byte-exact against Vairn's independent Python decoder and against the disk file |

## Quickstart

```bash
npm run mm1:maps            # decode data/mm1/dosega → public/assets/mm1/dosega/
```

## What's still open

Items, monsters, spells, `*.OVR` event scripts, and MM1's own graphics
(WALLPIX/MONPIX pixel formats) are **not decoded** — by Vairn or by us. See
`docs/mm1/TODO.md` and `docs/mm1/dosega/data-structure.md` (Vairn's doc 52
records the expected file sources; ScummVM's `mm1` engine is the oracle to
port from).

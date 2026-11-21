---
title: Crystal Dragon — Status & Open Work
description: What is solved and what is open for Crystal Dragon (Amiga) — SF codec and level regions done; image codec, palette and renderer open.
---

One codec and the level-grid geometry are solved. Everything visual is blocked
on the `SA` image codec and the palette, so nothing is published as an asset
yet. Source: [`docs/crystaldragon/TODO.md`](https://github.com/Shaid/crawl/blob/main/docs/crystaldragon/TODO.md).

| Area | Status | Evidence |
|---|---|---|
| File naming | **Confirmed.** Hex file ids built by `BuildFileName` (hunk 0 `+0x388A`); levels at `level × 9 + 0xCC` | data-structure.md § File naming |
| `SF` codec | **Decoded and committed.** 31/31 files exact size, 0 bytes left over, null controls 31/31 | `scripts/cdlib/sf.py`, `test_sf.py` |
| Level region table and grid | **Confirmed.** 23/23 levels, 83 regions, tile with 0 gap; width ±1 null control fails on every non-last region | `scripts/cdlib/level.py`, `test_level.py` |
| Cell semantics | Partial. Type = `word0 & 7`, 5 = wall, from code; bit 7, high bits and words 1–3 open | `cd-map-grid` |
| `SA` / `SP` / `SC` image codec | Open. Plan: emulate `Unpack` under musashi | `cd-sa-codec` |
| `SQ` codec | Open | `cd-sq-codec` |
| Palette | Open. No `SC` file ships | `cd-palette` |
| First-person renderer | Hypothesis: slot-table blitter | `cd-view-slots` |
| Level object lists and tail | Hypothesis | `cd-level-objects` |
| Audio | Hypothesis | `cd-audio` |
| Overlays `0a`, `c0`, `c1` | Hypothesis | `cd-overlays` |

## Open questions

- `cd-sa-codec`: Does emulating `Unpack` (hunk 0 `+0x0004`) decode the `SA`/`SP`/`SC` context-modelled planar codec (`+0x86`/`+0x296`) to the frame headers' exact sizes?
- `cd-sq-codec`: What do `SQ` files `01`, `06` and `0b` hold once the backward bit-stream and delta modes 1–3 (`+0x746`) are undone?
- `cd-palette`: Where are the dungeon and UI palettes, given that no `SC` file ships?
- `cd-map-grid`: What do bit 7, the high bits of `word0` and words 1–3 mean; is a region's `id`/`x0,y0` an area id or a world offset; and is level `15c` really a ring of nested rectangles?
- `cd-level-ids`: What are the never-shipped ids `level × 9 + 0xCD` … `+0xD4` — save or runtime slots?
- `cd-view-slots`: Are the `.SCR` companion tables view-slot → frame/x/y tables, and which `.SCR` name does each `SA` id carry?
- `cd-level-objects`: What are the 32-byte records at level `0x0B00`–`0x2B00` and the tail at `0xB140`?
- `cd-audio`: Are `88`–`91` id + length + PCM sound effects, and is `12` music?
- `cd-overlays`: What do overlays `0a`, `c0` and `c1` do, and what are their embedded `SF`/`SA` blocks?

## Corrections published

- The "single 64×64 grid, width from `+0x3136`" model is **retracted**; a level
  is several regions. See [Level maps](../#correction-the-single-grid-model-was-wrong).

## Checking in-game

The notes list no in-game checks yet. The plan's oracles for the maps are
structural (solid borders, paired door cells, stairs linking level N to N+1)
plus the shipped `Solution` walkthrough; for the view, public screenshots.

Full evidence: [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/crystaldragon/TODO.md).

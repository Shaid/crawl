---
title: Palettes
description: The extracted palette files from the game.
---

# Palettes

The extracted palettes, served from `/assets/blackcrypt/amiga/palettes/`. Each
is a JSON file describing the 12-bit → RGB colour table.

## Dungeon / game palettes

- `game.json` — the main dungeon EHB palette (indices 0–25 fixed core, 26–31
  accent ramp).
- `ui.json` — the UI chrome palette.
- `automap.json` — the automap view palette.

## Title / intro palettes

- `raven.json` — the Raven logo palette (16-colour, from `bcdfq` `0x0266`).
- `title.json` — the title screen palette (from `bcdfq` `0x0286`).

## Ending palettes

- `ending-congrats.json` — the congratulations screen.
- `ending-crypt.json` / `ending-crypt-lit.json` / `ending-crypt-ruin.json` —
  the Black Crypt facade variants.
- `ending-panel-a.json` … `ending-panel-e.json` — the narrated panels.

## DOS palettes

The Windows version's seven palettes live under
`/assets/blackcrypt/dosvga/palettes/` — `Palette.json`, `Automap_Palette.json`,
`Character_Gen_Palette.json`, `Options_Palette.json`, and three `Title_Palette`
variants.

## Reading them

See [palettes & accent ramps](/blackcrypt/graphics/palettes/) for how the EHB
palette works and how the accent ramp varies per dungeon level.
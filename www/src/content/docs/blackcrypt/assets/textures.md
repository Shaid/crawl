---
title: Dungeon Textures
description: The three dungeon tilesets, rendered as composite viewports.
---

# Dungeon Textures

The three dungeon tilesets (`bcdfx`, `bcdfy`, `bcdfz`), rendered as composite
208×140 views from the game's own blit descriptors. Served from
`/assets/blackcrypt/amiga/textures/`.

Each tileset is shown at its accent ramp. These are actual composited views,
not the raw sprite atlases:

![bcdfx — levels 1–4 & 12–13 (tan / grey)](/assets/blackcrypt/amiga/textures/dungeon-bcdfx-view.png)

![bcdfy — level 5 (violet)](/assets/blackcrypt/amiga/textures/dungeon-bcdfy-view.png)

![bcdfz — levels 6–11 (bone/cream)](/assets/blackcrypt/amiga/textures/dungeon-bcdfz-view.png)

The [raw atlas PNGs](/blackcrypt/files/bcdfxyz/) remain available in the
repository's extracted assets for inspecting individual sub-images.

## Reading the tilesets

Each tileset is a bare concatenation of chunks whose directory lives in the
executable, not the file. The 84 named sub-images (47 for `bcdfy`) include side
walls, front walls, ceiling, floor, doors, pits, pillars, alcoves, plaques,
stairs, pull chains, panels, fountains and wall buttons. See
[bcdfx/bcdfy/bcdfz](/blackcrypt/files/bcdfxyz/).

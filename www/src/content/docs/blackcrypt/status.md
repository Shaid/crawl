---
title: Status & Open Work
description: What's solved and what's still open.
---

# Status & Open Work

This page mirrors the repo's single status surface, `docs/blackcrypt/TODO.md`.
Every genuinely open item gets one row here; the full evidence and paths-tried
tables live in the raw notes.

## Open items

| ID | Status | Question (one line) |
|----|--------|---------------------|
| `automap-trap-tile` | open | Automap tile 14 (a visible trap) is only selected when a type-`0x1E` record has `byte +0x07 == 0` **and** `word +0x0E != 0`, but all 41 trap records ship with `+0x07 = 1` ("inviso"), so the tile is never drawn from on-disk state. Does anything clear `byte +0x07` at runtime (trap detection/disarm)? |
| `bcdfa-eff-spell-map` | open | 92 of 95 effects are now attributed to spells, but effects **31, 32, 34** have no identified consumer anywhere, and `bcdfs` type-`0x10` sub-kind 2's `word +0x10` (54/56/57) and `byte +0x07` (7/8/9) on 5 map-2 records are read by neither traced consumer. |
| `door-frame-w0c-meaning` | open | The word `+0x0C` of a Door-frame (`0x11`) record is unmapped. The old "structure-present / occupancy flag" reading was wrong; no consumer of the frame's own `+0x0C` has been traced. |
| `viewport-kind-handler-bodies` | open | All 14 kind-handler bodies are traced and the `objRec[+4] & 0xF0` switch is fully mapped — but three residuals remain: (a) which container fills slot `$00` (floor plates/traps), (b) slot `$C8`'s "special panel" body past the chunk's declared end, (c) `$51A(A5)` has no traced write site. |

## Closed (accepted as final)

| Item | Result |
|------|--------|
| `monster-boss-names` | All 6 named epilogue bosses confirmed (Ogre, Dragonlich, Possessor Demon, Ram Demon, Ram Lord, Great Waterlord, Medusa) plus Estoroth Paingiver and Statue. 90/204 sprites named; the remaining 114 are ordinary unnamed monster types — an exhaustive search confirmed **no indexed bestiary table exists** in the game's data. |

## Where to read the full evidence

Every row above links to a section of the raw notes:

- `docs/blackcrypt/amiga/data-structure.md` — the Amiga formats.
- `docs/blackcrypt/dos/data-structure.md` — the Windows VGA formats.
- `docs/blackcrypt/TODO.md` — the single status surface.

The raw notes carry the full evidence, paths-tried tables, and corrections that
these pages summarise.
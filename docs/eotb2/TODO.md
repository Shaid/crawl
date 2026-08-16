# Eye of the Beholder II (EOB2) — open work

Single status surface for EOB2. See `docs/eotb2/dosvga/data-structure.md`
(DOS/VGA port, verified) and `docs/eotb2/eotb2-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence. This file is pointers only.

Note: `data/eotb2/amiga/` (with `Manual/`, `Maps/`, `Solution/` reference
material) was not touched this session — DOS/VGA was the priority per the
task brief. An Amiga EOB2 doc/extractor is future work, not yet started.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb2-pipeline-wiring | open | 6 formats (`.DCR`, `.DEC`, `.EGA`-as-palette, `ITEM.DAT`, `ITEMTYPE.DAT`, `TEXT.DAT`) are now fully format-confirmed (byte-exact, zero residue) but not yet emitted as JSON by `scripts/extract_eotb2_dosvga.py` | `dosvga/data-structure.md` §§ ".DCR", ".DEC", ".EGA files", "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT" | 2026-08-02 game-re |
| eotb2-dos-cps-palette-second-field | open | EOB2's INF format has an optional *second* wall-set-name field (for a second palette) that's confirmed to exist from source but not decoded/verified against real INF bytes, and per-file (non-wall-set) palette selection for the 110 `PALETTE0.PAL`-fallback CPS screens isn't individually traced | `dosvga/data-structure.md` § "Palette resolution (per-CPS)" → "Confirmed mechanism" | 2026-08-02 game-re |
| eotb2-amiga-not-started | deferred:out-of-scope | `data/eotb2/amiga/` (incl. Manual/Maps/Solution reference material) not yet reverse-engineered — DOS/VGA was this session's priority | (no doc yet) | 2026-08-02 game-re |
| eotb2-dos-inf-header-offsets-dont-match | open | **A real playable EOB2 (DOS/VGA) first-person walker is shipped** (`tools/eotb2/`, wired into the shared browser walker as game `eotb2`) — see the "EOB2 (DOS/VGA) walker" closed-items block below for what it confirmed, including that the renderer-family question this game was untested for is now answered (slot-table family refuted, same as EOB1). **Left open by this session**: `docs/eotb/dosvga/data-structure.md` § "INF" → "Decompressed buffer layout"'s fixed byte offsets (`mazStem` at 0x002, `wallSetStem` at 0x00E) do **not** reproduce against any of EOB2's 16 real `LEVELn.INF` files once LCW-decompressed — the real `"levelN.maz"` string starts 3 bytes later (0x005) and `wallSetStem` doesn't follow at a clean +12 stride either. The walker works around this with a token scan (`tools/eotb2/decode-inf.ts`) rather than trusting the offsets, verified against all 16 files including both documented maze-reuse cases. Root cause not chased down (genuinely different EOB2 header preamble vs. a copy-paste offset error in the doc — unknown). **Bonus finding, also unconfirmed further**: the scan incidentally shows the string `"azure"` appearing in `LEVEL10-13.INF`'s scanned window *after* their real (`mezz`) wall-set name — plausibly the EOB2-specific optional *second* wall-set-name field `eotb2-dos-cps-palette-second-field` (below) already flags as unverified; worth checking together if either is picked up again | `tools/eotb2/decode-inf.ts` module doc | 2026-08-16 game-re |

## Closed this session (2026-08-02, ScummVM source + byte-exact verification)

- **`eotb2-dos-dcr-format`** — confirmed via `DarkMoonEngine::
  loadMonsterDecoration` (`engine/darkmoon.cpp:310-336`): per-facing
  sprite-decoration shape/offset tables, `2 + setCount*36` bytes. Verified
  byte-exact against **all 9** `.DCR` files in the corpus, zero residue.
  See `dosvga/data-structure.md` § ".DCR — monster decoration parameters".
- **`eotb2-dos-dec-format`** — confirmed identical to the already-decoded
  EOB1/DOS format (shared `getDecDefinitions`, forced-LE reader). Verified
  byte-exact against **all 6** `.DEC` files, zero residue. See
  `dosvga/data-structure.md` § ".DEC — level decoration placement".
- **`eotb2-dos-ega-files`** — premise corrected: EOB2's 8 `.EGA` files are
  **alternate 768-byte VGA-style palettes** (not compressed graphics like
  EOB1's `.EGA`) — `Screen::loadPalette`'s EGA branch decodes a file-based
  `.EGA` with the ordinary VGA-palette reader, confirmed from source and
  from every file being exactly 768 bytes. Decodes with existing
  `scripts/kyralib/palette.py` code, zero new format work. See
  `dosvga/data-structure.md` § ".EGA files — confirmed: alternate
  palettes, NOT graphics".
- **`eotb2-dos-azure-vcn-missing`** — confirmed by design, not a naming
  mismatch: all 16 `LEVELn.INF` files were decoded and their embedded
  wall-set-stem fields checked exhaustively — `"azure"` never appears as a
  wall-set reference anywhere. Azure is CPS-backdrop-only because no level
  ever asks for an Azure 3D tileset. Bonus: also confirms `LEVEL16.MAZ`'s
  absence is because `LEVEL16.INF` reuses `LEVEL15`'s maze (and similarly
  `LEVEL6`→`LEVEL5`, `LEVEL14`→`LEVEL12`), not a missing file. See
  `dosvga/data-structure.md` § "VCN / VMP — Wall tilesets".
- **`eotb2-dos-item-text-dat`** — `ITEM.DAT`/`ITEMTYPE.DAT` confirmed
  byte-exact using the same record layout discovered for EOB1
  (`items_eob.cpp` is shared code); `TEXT.DAT` decoded as a new, simpler
  offset-table + NUL-terminated-string-pool format, verified against all
  122 entries (monotonic offsets, first string starts exactly at the
  table's own end, fully legible EOB2 NPC dialogue text). See
  `dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT".
- **`eotb2-dos-cps-palette-heuristic`** — mechanism confirmed identical to
  EOB1's for wall-set/dungeon screens (shared `initLevelData` code,
  `setLevelPalettes` is a no-op for DOS). Narrowed rather than fully
  closed — see `eotb2-dos-cps-palette-second-field` above for what's left.

## EOB2 (DOS/VGA) walker — closed this session (2026-08-16, game-re)

Phase 2 of the EOB1/EOB2/Lands of Lore family (`tools/eotb/`'s EOB1
walker, `docs/walker-map-format-future-decision.md`, shipped first).
Reused directly rather than re-derived, per format confirmed
byte-identical to EOB1: `.MAZ` decode (`tools/eotb2/decode-maze.ts` is a
thin re-export of `tools/eotb/decode-maze.ts`), the 25-slot render
geometry and pose-dispatch logic (`tools/eotb2/view-model.ts` re-exports
`tools/eotb/view-model.ts`'s `WALL_RENDER_SLOTS`/`CELL_OFFSETS`/
`resolveWallTypes`/`canStepForward` wholesale, including their existing
documented caveats), the LCW ("Format 80") decompressor
(`tools/eotb/lcw.ts`, confirmed identical between EOB1/EOB2/DOS/Amiga),
and the slot-table-family-doesn't-fit finding (EOB's `.VMP` is a
per-8x8-tile mosaic per screen position, not a placeable compose-list
piece — ships as a bespoke `IndexedSurface` compositor via
`GameView.renderCanvas`, same as EOB1).

**Genuinely new for EOB2 DOS/VGA** (a real second decode, not a port):
`.CPS`/`.VCN`/`.INF` are Kyra-bitmap-header + LCW-compressed (same
container as EOB1's *DOS* port, but structurally different from EOB1's
*Amiga* port this repo's existing `tools/eotb/` targets — chunky 8bpp
pixels not 5-bitplane, 4bpp/8x8 `.VCN` tiles with a `colMap` nibble-remap
not Amiga's 5-colour palette patch, and a real `<STEM>.PAL` file per wall
set instead of a `.CPS`-embedded base palette). New decoders:
`decode-vcn.ts`, `decode-vmp.ts` (LE, reuses EOB1's `WALL_RENDER_SLOTS`/
`CELL_OFFSETS` constants directly), `decode-inf.ts` (see the
`eotb2-dos-inf-header-offsets-dont-match` row above — the cited doc's
fixed offsets didn't hold, worked around with a token scan), `palette.ts`
(DOS VGA 6-bit-to-8-bit `.PAL` reader).

**All 5 real wall sets exported and walkable, including FOREST** (closed
this follow-up session, 2026-08-16): the "FOREST is non-standard" premise
above was wrong, not just under-implemented. `tools/landsoflore/decode-
vmp.ts` (written in the Lands of Lore session, same day) found the real
pattern for its own varying wall-type counts: `count` is `330 + N*431`,
`N` derived from the file's own byte size, not a hardcoded 6.
`1192 - 330 = 862 = 2*431` divides exactly — FOREST is just an `N=2` set
(fewer distinct wall appearances needed for outdoor terrain), the same
shape as LoL's own `FOREST1` (identical 1192-entry count, already
confirmed rendering correctly there). `tools/eotb2/decode-vmp.ts` now
uses the same derivation; `tools/eotb2/renderer.ts`'s `drawWallSlot`
bound-checks against `vmp.wallTiles.length` instead of a hardcoded 6.
Verified: `LEVEL4` (the one level using FOREST) renders coherent
green vine/foliage textures (`render-through-dungeon.ts`, visually
inspected, not garbage), full repo test suite green. **AZURE remains
skipped**, for its own separate, unrelated, already-settled reason
(confirmed by the existing `eotb2-dos-azure-vcn-missing` closed item: no
`.VCN`/`.VMP` pair exists for it at all — not another instance of this
bug).

**Verified**: 15 new unit tests (`tools/eotb2/__tests__/eotb2.test.ts`),
including real-corpus oracle checks against `docs/eotb2/dosvga/
data-structure.md`'s own published invariants (CRIMSON: numTiles=1132,
VMP max index=1131, both exact matches) and the two documented
maze-reuse cases (`LEVEL16`→`level15.maz`, `LEVEL14`→`level12.maz`,
both reproduced from real `.INF` decode, not hardcoded). Multiple real
poses across 3 different wall sets rendered offline and visually
inspected — coherent, recognisable brick/stone/masonry first-person
corridor views, correct per-wall-set colouring (warm brown DUNG,
cool blue-grey SILVER, red-orange CRIMSON). Verified live in the browser
(Playwright): the `eotb2` game entry loads with 0 console errors, the
level dropdown lists all non-skipped levels labelled by wall set, and
both forward/backward movement and turning genuinely change the tracked
pose and re-render (confirmed by screenshot comparison before/after
movement, including a real wall-collision stop). Full repo `vitest`
(256/256), `tsc --noEmit`, and `lint` all clean with this in the tree —
EOB1's own walker and both Wizardry 6 walkers unaffected (no shared files
touched besides `tools/walker/walker.ts`'s `GAMES` list, an additive
change).

**Not attempted this session, honestly flagged**: Lands of Lore (phase
3) — EOB2 alone used the full session; its `.CMZ`-is-EOB's-`.MAZ`-format
hypothesis (`docs/landsoflore/landsoflore-formats-research.md:10-11`)
and EOB1's `lcw.ts` are both real, ready-to-reuse starting points for
whoever picks it up next.

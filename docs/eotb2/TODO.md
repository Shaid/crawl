# Eye of the Beholder II (EOB2) — open work

Single status surface for EOB2. See `docs/eotb2/dosvga/data-structure.md`
(DOS/VGA port, verified) and `docs/eotb2/eotb2-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence. This file is pointers only.

See `docs/eotb2/amiga/data-structure.md` for the Amiga port (solved
2026-09-02 — container/VCN/CPS/VMP/MAZ/PAL/INF/DEC/DCR/ITEM.DAT/
ITEMTYPE.DAT/TEXT.CPS all confirmed, 16/16 levels walkable in the browser
walker as `eotb2amiga`).

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb2-amiga-finale-pal | open | `FINALE.PAL` (384B = 6x64B palettes) not wired up — format obvious from the single-palette `.PAL` reader, just not decoded | `amiga/data-structure.md` § "Not extracted this session" | 2026-09-02 game-re |
| eotb2-amiga-levelstmp | open | `LEVELS.TMP` (36,210B, same size as DOS's own but not byte-identical) — likely a savegame/scratch buffer, format not decoded | `amiga/data-structure.md` § "Not extracted this session" | 2026-09-02 game-re |
| eotb2-amiga-exe-disasm | deferred:not-needed | `EOBII` executable never disassembled — every finding this session came from corpus byte inspection + ScummVM source, not runtime tracing; only matters if a future item needs a runtime oracle | `amiga/data-structure.md` § "Not extracted this session" | 2026-09-02 game-re |
| eotb2-dos-monster-cps-palette-remaining | open | 7 of 36 monster-shaped CPS files (`MMOUTH1`/`2`, `STONEGIA`, `TANGLOR`, `AIRSEAL`, `BADMOOD`, `CRIMRING`) aren't referenced by any `LEVELn.INF` monster-shape slot on any sub-level — still use the `PALETTE0.PAL` fallback, not confirmed correct | `dosvga/data-structure.md` § "Palette resolution (per-CPS)" → Correction block | 2026-09-02 game-re |
| eotb2-dos-inf-sublevel-decoration-coverage | open | `.INF` sub-level chaining (found this session, `scripts/kyralib/inf.py::parse_inf2_sublevels`) is only ported far enough to reach monster-shape slots; `tools/eotb2/decode-inf.ts`'s wall-decoration renderer (`resolveWallDecorationAssignments`) stays sub==0-scoped, so it's unknown whether real decoration assignments exist only in a level's later sub-levels | `dosvga/data-structure.md` § "INF — Level configuration" → "Sub-level chaining" | 2026-09-02 game-re |

## Closed this session (2026-09-02, EOB2 DOS/VGA — monster CPS palette fix)

Closed `eotb2-dos-cps-palette-heuristic`'s remaining monster-art gap
(previously narrowed but not closed — see that item below). A confirmed,
real colour bug: monster CPS screens (`ant.png`, `basilisk.png`,
`beholder.png`, etc.) rendered with garish, level-palette-mismatched
colours under the `PALETTE0.PAL` (menu/UI) fallback. Ported EOB1's
`build_monster_wallset_palette` pattern
(`scripts/extract_eotb_dosvga.py`) to EOB2: a monster CPS is composited
over the already-loaded dungeon view, so its real palette is whatever
wall-set `.PAL` is active for the level it appears on. Found and used a
genuinely new mechanism along the way — EOB2 `.INF` files chain to a
second (sometimes third+) "sub-level" block-properties record, which
`tools/eotb2/decode-inf.ts`'s existing parser explicitly scopes out
(sub==0 only); several real monster stems (`ant` among them) live only in
a level's second sub-level. New `scripts/kyralib/inf.py::
parse_inf2_sublevels` walks the full chain. **Verified**: 29/36
monster-shaped CPS files now resolve to a real, INF-derived wall-set
palette (up from 0); `ant.png`/`basilisk.png`/`beholder.png` and 5 more
spot-checked by `Read`-ing the regenerated PNGs directly, all now
coherent (dark-red ants, tan basilisk, brown beholder, blue-grey spider,
a red dragon with a fire-breath frame, grey wolf, a silver-armoured
guard). One conflict found and documented (`cleric1` appears on two
different wall sets; resolved first-occurrence-wins). Also fixed an
unrelated pre-existing `ImportError` (`kyralib.items` was missing
`item_dat_to_json`/`itemtype_dat_to_json`, which `extract_eotb2_dosvga.py`
already imported — blocked the extractor from running at all) by adding
the two small JSON-shape adapters. See `dosvga/data-structure.md` §
"Palette resolution (per-CPS)" → Correction block and § "INF — Level
configuration" → "Sub-level chaining".

## Closed this session (2026-09-02, EOB2 Amiga — full container/format survey + walkable levels)

Closed `eotb2-amiga-not-started`. First real pass at `data/eotb2/amiga/`
(previously untouched, `deferred:out-of-scope`). Confirmed the predicted
"EOB1-Amiga encoding x EOB2-DOS mechanism" hybrid holds for `.VCN`/`.CPS`/
`ITEM.DAT`/`ITEMTYPE.DAT`, but **not uniformly**: `.VMP` matches EOB2 DOS's
encoding too (little-endian, contradicting EOB1 Amiga's own big-endian
`.VMP`), and `.DEC`/`.DCR`/`TEXT*.CPS` turned out to be literally
md5-byte-identical to EOB2 DOS's own files, not just structurally similar.
Full evidence and byte-level tables: `docs/eotb2/amiga/data-structure.md`.

- **Container + `.VCN`/`.CPS`/`.INF`**: all LCW-compressed behind the
  shared 10-byte Kyra-bitmap header (`compType=4` in every real file) —
  a real structural departure from EOB1 Amiga's own uncompressed `.VCN`.
  Decompressed `.VCN` payload is byte-for-byte EOB1 Amiga's own raw
  layout (verified 0 residue, all 5 wall sets); `.CPS` is Amiga 5bpp
  planar pixels (EOB1-style) with EOB2's header-embedded-palette
  convention (EOB2-style) — a genuine per-format hybrid.
- **`.VMP` genuinely matches EOB2 DOS, not EOB1 Amiga**: confirmed
  little-endian + the `330+N*431` derivation, contradicting EOB1 Amiga's
  documented big-endian convention — see the doc's "VMP" section for the
  full ascending-run-vs-multiples-of-256 evidence.
- **`.INF`**: byte-identical header+record-stream shape to EOB2 DOS.
  16/16 real `LEVELn.INF` files parse with 0 errors, 308/308
  wall-decoration assignments resolve in-range (same total as DOS). One
  new maze-reuse pair found, not in DOS's list: `LEVEL15.INF` ->
  `level14.maz` (Amiga-only; DOS's own LEVEL15 uses `level15.maz`).
- **`.PAL`**: standalone 64-byte/32-colour Amiga-native file (EOB1-Amiga
  encoding) delivered via EOB2's own standalone-per-wall-set-file
  mechanism.
- **`.DEC`/`.DCR`**: confirmed **md5-byte-identical** to EOB2 DOS's own
  files.
- **`ITEM.DAT`/`ITEMTYPE.DAT`**: same size and same record layout/counts
  as DOS (434 items/123 names/64 types, all landing exactly on EOF) but
  **big-endian fields**, not little-endian — a genuine, resolved
  byte-order finding (not identical files, unlike `.DEC`/`.DCR`). New
  module `tools/eotb2/amiga/decode-items.ts`.
- **`TEXT.CPS`/`TEXT2.CPS`/`TEXT4.CPS`**: despite the `.CPS` extension,
  these are NOT images — no `TEXT.DAT` exists in this corpus at all. All
  three LCW-decompress to bytes **md5-identical to EOB2 DOS's own
  `TEXT.DAT`** (122 dialogue strings, byte-exact). New module
  `tools/eotb2/amiga/decode-text.ts`.
- **Wall-decoration overlay rendering** (front/"Down" role) and the
  **LEVEL10-14 mezz+azure palette-override mechanism** both confirmed
  working end-to-end, reusing DOS's `renderer.ts`/DSC tables unmodified —
  visually confirmed via 6 real rendered poses across 5 wall sets
  (`tools/eotb2/amiga/render-through-dungeon.ts`).
- **Browser walker**: new `GameId` `eotb2amiga` registered
  (`src/game-id.ts`, `tools/walker/walker.ts`, `tools/shared/
  viewer-config.ts`), reusing `loadEotb2View`/`eotb2LevelList`
  (`tools/walker/games-eotb2.ts`) and `renderView`
  (`tools/eotb2/renderer.ts`) **completely unmodified** — every
  platform-specific decode lives in `tools/eotb2/amiga/`'s new modules,
  none in the walker/render chain, confirming that layer really is
  platform-agnostic once assets are exported to flat JSON.
- 16 new unit tests (`tools/eotb2/amiga/__tests__/eotb2-amiga.test.ts`),
  all passing against real corpus data. Full repo `vitest` (383/383),
  `tsc --noEmit`, and `lint` all clean with this in the tree. No existing
  `tools/eotb/` or `tools/eotb2/` DOS file was modified — only additive
  registration edits to the 3 shared config files above.
- **Left open** (all low-priority/out-of-scope, see rows above):
  `FINALE.PAL` (6-palette variant, structure obvious, not wired up),
  `LEVELS.TMP` (savegame/scratch buffer, not decoded), `EOBII` executable
  (never disassembled — nothing needed it), `.OUT`/`.SAM` audio (IFF
  FORM/SMUS, identified by magic bytes, not decoded), fonts/CREDITS.TXT
  (identified, out of scope). Side-role wall decorations and per-CPS
  palette selection for non-wall-set screens are inherited gaps already
  open for DOS/EOB1, not new to this platform.

## Closed this session (2026-08-29b, wall-decoration overlay port from EOB1 + INF record-stream decode)

- **`eotb2-inf-second-wallset-runtime-consumer`** — traced and confirmed:
  `EoBCoreEngine::initLevelData` reuses one `tmpStr` variable for the
  level's palette filename throughout the function, and the second
  wall-set field's assignment unconditionally **overwrites** (not
  merges) the primary `wallSetStem`'s own value, since it runs after it.
  For `LEVEL10`-`LEVEL14` this means the level's real active palette is
  `AZURE.PAL`, not `MEZZ.PAL` (the navigable tileset's own stem) — a
  genuine, visually real override (`MEZZ.PAL`/`AZURE.PAL` differ in 73 of
  768 bytes). Implemented in `tools/eotb2/export-dungeon.ts`: wall-set
  asset bundles now combine the navigable tileset's VCN/VMP with the
  palette-stem's `.PAL` (`secondWallSetStem ?? wallSetStem`), producing a
  distinct `mezz+azure` bundle for the 5 affected levels. See
  `dosvga/data-structure.md` § "Palette resolution (per-CPS)" → runtime
  consumer paragraph.
- **Ported EOB1's wall-decoration-overlay renderer to EOB2** (new work,
  not a previously-open TODO row): `tools/eotb2/decode-inf.ts` gained a
  full `.INF` record-stream parser past the fixed header (door-shapes,
  monster-shapes, monster-properties, then the wall-mapping/decoration-
  load stream — none of this was previously decoded for EOB2), verified
  byte-exact against all 16 real `LEVELn.INF` files with 0 parse errors
  and 308/308 real wall-decoration assignments resolving cleanly
  (cross-checked against real `.DEC`/`.DCR` filenames, 0 mismatches). New
  `tools/eotb2/decode-cps.ts` decodes EOB2's chunky-8bpp decoration shape
  sheets (confirmed structurally distinct from EOB1 Amiga's planar
  `.CPS`). `tools/eotb2/renderer.ts`'s `drawWallDecorations` reuses
  EOB1's `decodeDecorations`/`decorationChain` (`tools/eotb/decode-
  decorations.ts`, read-only) and EOB1's DSC render-geometry tables
  (`tools/eotb/dsc-tables.ts`, read-only — confirmed byte-identical to
  EOB2's own `eob2_dos.h` values, 36/18/12 entries, 0 deviations) with one
  real, deliberate EOB2-specific deviation: decoration data/sheets are
  keyed by `decFile`/`cpsFile` string rather than one shared table, since
  EOB2's LEVEL10-14 genuinely decorate with `azure.dec` while navigating a
  `mezz` tileset (no EOB1 equivalent). Front/"Down" role only, matching
  EOB1's own current scope. Verified: two real decorated poses rendered
  with/without the overlay and diffed — 204/21120 and 124/21120 pixels
  changed respectively, each forming a compact, distinctly-shaped,
  correctly-localized region (not noise, not identical between the two
  different `decIndex` values tested). 25/25 `tools/eotb2` unit tests
  passing (7 new). Full repo `vitest`, `tsc --noEmit`, `lint` all clean.
  See `dosvga/data-structure.md` § "Wall decoration overlay rendering
  (INF wall-mapping/decoration-load record stream, 2026-08-29)".

## Closed this session (2026-08-29, ScummVM source + byte-exact verification against all 16 LEVELn.INF)

- **`eotb2-pipeline-wiring`** — wired all 6 previously-format-confirmed
  formats (`.DCR`, `.DEC`, `.EGA`-as-palette, `ITEM.DAT`, `ITEMTYPE.DAT`,
  `TEXT.DAT`) into `scripts/extract_eotb2_dosvga.py`, backed by new shared
  decode modules `scripts/kyralib/{items,decorations,dcr,textdat}.py`.
  Verified: 434/123 items+names, 64 item types, 122 dialogue strings, 9/9
  `.DCR` and 6/6 `.DEC` files — all matching the doc's own already-
  published invariants exactly, zero residue. See `dosvga/data-structure.md`
  § "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT" and § ".EGA files".
- **`eotb2-dos-inf-header-offsets-dont-match`** and
  **`eotb2-dos-cps-palette-second-field`** — root-caused together, exactly
  as suspected they'd be the same discovery. Fresh-fetched
  `engines/kyra/engine/scene_eob.cpp`'s `EoBCoreEngine::initLevelData`
  shows EOB2 genuinely uses a different, longer INF header preamble than
  EOB1 (a `slen` field width of 13 bytes vs. EOB1's 12, plus a 3-byte
  tag/sub-chain preamble EOB1's code path discards): real EOB2 offsets are
  `mazStem`@0x005 (13B), `wallSetStem`@0x012 (13B), an optional
  `secondWallSetStem`@0x020 (13B, gated by a flag byte @0x01F). Verified
  byte-exact against **all 16** real `LEVELn.INF` files: tag byte `0xEC`
  in all 16, `mazStem`/`wallSetStem` reproduce the previously-shipped
  token-scan output exactly, and the second field is present (decoding to
  `"azure"`) on exactly `LEVEL10`-`LEVEL14` and absent on all other 11 —
  the "azure" bonus finding from the prior session was indeed this same
  field. `tools/eotb2/decode-inf.ts` now uses the real fixed-offset struct
  as its primary decoder (token scan kept only as a fallback), with 2 new
  regression tests (17 total in `tools/eotb2/__tests__/eotb2.test.ts`, all
  passing). Full repo `vitest` (284/284), `tsc --noEmit`, and `lint` all
  clean; `export-dungeon.ts` re-run and a real pose re-rendered
  (`level1-16-16-f0.png`, `level10-16-16-f0.png`) — both still coherent,
  correctly-coloured corridor views, confirming no regression from the
  offset-parsing switch. See `dosvga/data-structure.md` § "INF — Level
  configuration (EOB2 header preamble, root-caused 2026-08-29)". Left
  open: what in-game code *consumes* the second wall-set string beyond the
  one `format()` call (`eotb2-inf-second-wallset-runtime-consumer`,
  above).

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
  > **Correction (2026-09-02):** the monster-art portion of this gap was
  > confirmed as a real, garish colour bug (not just "unverified"), and
  > closed for 29/36 monster CPS files — see "Closed this session
  > (2026-09-02, EOB2 DOS/VGA — monster CPS palette fix)" above and the
  > new `eotb2-dos-monster-cps-palette-remaining` row for the 7 that
  > still aren't resolved.

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

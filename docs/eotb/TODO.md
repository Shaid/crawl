# Eye of the Beholder (EOB1) — open work

Single status surface for EOB1. See `docs/eotb/amiga/data-structure.md`
(Amiga port) and `docs/eotb/dosvga/data-structure.md` (DOS/VGA port) for
full evidence and paths-tried tables — this file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb1-dos-ega-pipeline | open | `.EGA`/`.ECN`/`.EMP` format is now fully confirmed (same container/codec as `.CPS`/`.VCN`, EGA-index palette) but not yet wired into the extractor pipeline | `dosvga/data-structure.md` § "EGA render mode" | 2026-08-02 game-re |
| eotb1-dos-inf-opcode-operands | open | `.INF` event-script bytecode dispatcher and ~30 opcode names are confirmed from source; individual opcode operand byte-widths not exhaustively decoded | `dosvga/data-structure.md` § "INF — Level configuration" → "Event script" | 2026-08-02 game-re |
| eotb1-dos-item-dat-pipeline | open | `ITEM.DAT`/`ITEMTYPE.DAT` byte layout is fully confirmed (byte-exact, zero residue) but not yet wired into `scripts/extract_eotb_dosvga.py` as JSON output | `dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT" | 2026-08-02 game-re |
| eotb1-dos-monster-cps-palette | open | Monster CPS files render with a `EOBPAL.COL` fallback that's now known to likely be wrong — the game shows them over the owning level's wall-set palette (e.g. `KOBOLD.CPS` should use `BRICK.PAL`, not `EOBPAL.COL`); needs a monster→level→wall-set lookup (buildable from the now-decoded INF monster-shape fields) wired into the extractor | `dosvga/data-structure.md` § "VGA palette" → "Monster CPS files: heuristic refined, not fully confirmed" | 2026-08-02 game-re |
| eotb1-amiga-dec-verify | open | `.DEC` format confirmed from source (shared byte-exact layout with DOS, forced-LE reader) but not independently byte-verified against a real Amiga `.DEC` file (none in this corpus to cross-check against DOS either) | `amiga/data-structure.md` § "DEC Files" | 2026-08-02 game-re |
| eotb1-amiga-savegame-port | open | `EOBDATA.SAV` structure fully confirmed from source and platform-detection heuristic spot-verified against the real file; full record layout not ported to a standalone decoder/extractor | `amiga/data-structure.md` § "EOBDATA.SAV — Save game" | 2026-08-02 game-re |
| eotb1-amiga-multipalette-cps-callsite | open | Multi-palette CPS mechanism confirmed (`setDualPalettes` = horizontal split-screen dual palette, not fade/animation) but the specific screen/context that calls it (`eobcommon.cpp:1783`) not traced to find which CPS files actually use it | `amiga/data-structure.md` § "Palette Locations" → "Multi-palette CPS — mechanism confirmed" | 2026-08-02 game-re |
| eotb1-amiga-special-cps-codec | open | Bonus finding (not originally an open item): a second Amiga-only compression codec (`loadSpecialAmigaCPS`, backwards-reading bit-level LZ) used for Amiga `.INF`-equivalent files and `TEXT.CPS` — confirmed and cited from source, not implemented as a decoder | `amiga/data-structure.md` § "A second, distinct Amiga-only codec" | 2026-08-02 game-re |
| eotb1-amiga-walker-wallmapping | open | **A real playable EOB1 (Amiga) first-person walker is shipped** (`tools/eotb/`, wired into the shared browser walker as game `eotb`) — see the "EOB1 (Amiga) walker" closed-items block below for what it confirmed. **Still open, but the real mechanism is now identified (this follow-up session, 2026-08-16, ScummVM source)**: the `.MAZ` per-side byte is not always a direct 0-6 wallType (most of the corpus is clean 0/1/2, but some cells carry much larger values, e.g. 58/62 seen in `LEVEL1.MAZ`). Pulled and read the actual engine source (`engines/kyra/engine/scene_eob.cpp`, function `EoBCoreEngine::initLevelData`, shared by EOB1 and EOB2 at this point — not gated by `gameID`): `resetWallData()` seeds a *default* raw-wallType→vmpRunIndex table (`_wllVmpMap[1]=1, [2]=2, [3..22]=3` (all 20 collapse to one shared generic run), `[23]=4, [24]=5`, everything else including 0 defaults to run 0), and each level's `.INF` decoration-command stream can then override individual entries via `assignWallsAndDecorations(wallIndex, vmpIndex, decIndex, specialType, flags)` — a plain 5-byte record `[wallIndex][vmpIndex][decIndex:int8][specialType][flags]`, inside a `u16 LE`-count-prefixed loop where a `0xEC` marker byte instead means a different (2-string) decoration-load record. This is exactly the mechanism `docs/eotb/amiga/eotb-inf-spec.md`'s `WallMapping`/`0xFB` struct hypothesis pointed at, now with real field order/widths. **Why this isn't implemented yet**: reaching this record stream requires sequentially replicating everything `initLevelData` consumes before it — door-shape params, script-timer fields, monster-shape loads, and critically `loadActiveMonsterData` (`sprites_eob.cpp`, EOB1: a variable-length `(type,interval)` pair list terminated by `0xFF`, then a fixed 420 bytes — tractable) — and a first attempt at walking this by hand against a real file (`data/eotb/amiga/LEVEL1.INF`, hexdump-verified) drifted out of alignment with known string anchors (`"kobold\0"`/`"leech\0"`, the monster-shape filenames) by a few bytes partway through, most likely because the Amiga port's on-disk `.INF` layout diverges from ScummVM's DOS-oriented struct reads in ways not yet pinned down (same category of divergence this doc's own `mazStem`/`wallSetStem` findings already hit for this port) — rather than ship a guessed offset table that could silently mis-map wall art (the exact failure mode this whole project tries to avoid), this is left as real, well-scoped follow-on work: either trace the Amiga executable's own disassembly (`amiga-disasm` agent / `ira-disasm`/`radare2-amiga` skills — a more reliable oracle for Amiga-specific layout than DOS-oriented ScummVM source) or very carefully re-verify each intervening field against real file bytes one at a time. Current walker still clamps anything above 6 to a generic solid wall (correct topology, approximate art for doors/stairs/decorated cells) — unchanged, still the safest fallback. Also open: the render rotation for facing != North (`tools/eotb/view-model.ts`'s `roleSide`) is a self-consistent extrapolation of the (facing-North-only) ModdingWiki diagram, not independently verified — no oracle in this corpus to check it against; VMP's per-tile `zMask` flag ("seam" hint) isn't modelled; door open/closed state is static (from the `.MAZ` snapshot only, `.INF` event-script mutation not applied) | `tools/eotb/view-model.ts` (`clampWallType`, `roleSide` doc comments); `tools/eotb/decode-inf.ts`; ScummVM `engines/kyra/engine/scene_eob.cpp` (`initLevelData`, `assignWallsAndDecorations`, `resetWallData`), `engines/kyra/engine/sprites_eob.cpp` (`loadActiveMonsterData`) | 2026-08-16 game-re |

## Closed this session (2026-08-02, ScummVM source)

- **`eotb1-dos-eye-pak`** — confirmed genuinely unused: `resource.cpp:153`
  explicitly skips it (`// No PAK file`) with no fallback loader anywhere
  in the engine (unlike `TWMUSIC.PAK`, which is skipped from PAK-parsing
  but still opened raw elsewhere). See `dosvga/data-structure.md` § "PAK
  — Container format".
- **`eotb1-dos-cps-palette-heuristic`** — confirmed identical to the
  game's own logic for wall-set/dungeon screens (`initLevelData`
  name-matches the INF's embedded wall-set stem to `<stem>.PAL`, and
  `setLevelPalettes` is a no-op for DOS/Amiga, so there's no further
  per-level patch step). Narrowed to a smaller remaining question, see
  `eotb1-dos-monster-cps-palette` above. See `dosvga/data-structure.md` §
  "VGA palette".
- **`eotb1-amiga-vcn-palette`** — confirmed: 5 colours (not 32), Amiga
  12-bit RGB (u16 BE), scaled via `(nibble*0x3F)/0xF`. See
  `amiga/data-structure.md` § "Palette (VCN offset 0x02...)".
- **`eotb1-amiga-vcn-decompress`** — confirmed there is no compression at
  all; Amiga `.VCN` tile data is read raw. See `amiga/data-structure.md`
  § "Structure — confirmed, and simpler than the previous guess".
- **`eotb1-amiga-dcr-format`** — confirmed EOB1 never loads `.DCR` files
  at all (`hasDecorations` hardcoded `false` in every EOB1 call site);
  the format itself (EOB2-only) is documented in
  `docs/eotb2/dosvga/data-structure.md` instead. See
  `amiga/data-structure.md` § "DCR Files".

Every remaining Amiga item was **narrowed** (spec now known from source,
often byte/spot-verified) rather than fully closed, because turning each
into pixel-exact rendered assets or a committed extractor was out of this
pass's time budget — see the table above and the cited doc sections for
exactly what's left to *implement* versus what's left to *discover* (in
every remaining case: implement, not discover).

## EOB1 (Amiga) walker — closed this session (2026-08-16, game-re)

Tests this hypothesis, from `docs/walker-map-format-future-decision.md`'s
"Eye of the Beholder 1/2 and Lands of Lore — confirmed, already this
repo's tier 1" section: EOB's per-cell wall storage + door/decoration-as-
separate-flag model would fit `@seer-project/dungeon`'s slot-table family
(the Black Crypt/Wizardry 6 renderer). **Refuted, for a specific reason**:
the low-level raster primitive (`IndexedSurface`, `blend: 'mask'` blits)
generalises fine and is reused directly; the HIGH-level
`SlotTableFile`/`compositeDrawList` schema does not fit, because EOB's
`.VMP` format is a **per-8x8-tile mosaic** — each of the 25 fixed screen
positions is itself built from a small grid of individually-indexed
tiles, not one placeable image the way BC/W6's compose-list pieces are.
Ships instead as a bespoke `IndexedSurface`-based compositor
(`tools/eotb/renderer.ts`) wired into the walker via `GameView.renderCanvas`
(same integration shape as the MM1/MM2 and new SNES-W6 views) — see that
file's module doc for the full reasoning.

**`eotb1-amiga-vcn-render` closed**: the texture atlas now renders
correctly. Two real decode bugs were found and fixed in the process (both
produced structurally-plausible-looking-but-pixel-garbled output, not
obvious crashes — worth flagging for whoever touches this format again):

- **VCN tile plane layout is row-interleaved, not plane-sequential.**
  `data-structure.md`'s "8 rows x 1 byte/row x 5 planes = 40 bytes/tile"
  phrasing is agnostic about which dimension varies fastest; a first pass
  assumed plane-sequential (the convention full-screen Amiga bitmaps —
  and this game's own `.CPS` — use), which decoded real-looking *index
  sequences* from `.VMP` into visual noise once rendered as pixels.
  Row-interleaved (`tools/shared/amiga-planar.ts`'s existing
  `decodePlanarRowInterleaved`, built for a different game, reused as-is)
  produces a decisive, legible brick-coursing stone texture instead.
- **`eotb-vmp-spec.md`'s `drawWall` pseudocode's `flipX` sense is
  inverted from a literal reading** — it reassigns a local `flipX =
  flipFlag ? 0 : 0x4000` and branches on *that*, so `flipFlag == true`
  actually selects the simple (non-mirrored) placement formula, the
  opposite of the natural reading of the field name. See
  `tools/eotb/renderer.ts`'s `drawWallSlot` doc comment.
- Also confirmed empirically (no citable source either way): the
  `.VMP`'s 22x15 backdrop block has **no 101-word padding** before the
  first wall-type block, contra the ModdingWiki PC-era spec's
  `padding[101]` field — every real `.VMP` in this corpus is exactly
  5834 bytes (2 header + (330 + 6*431) words), and reading it that way
  gives a clean ascending 1..15 run for the backdrop's first column,
  which is what settled a real BE-vs-LE endianness question for this
  format too (Amiga `.VMP`, unlike the PC version, is big-endian —
  consistent with every other confirmed-Amiga field in this family).

Shipped: `tools/eotb/{lcw,palette,decode-cps,decode-vcn,decode-vmp,
decode-maze,decode-inf,view-model,renderer,export-dungeon,
render-through-dungeon}.ts` + `__tests__/eotb.test.ts` (22 tests);
`tools/walker/games-eotb.ts` (`Eotb1View`) wired into
`tools/walker/walker.ts`'s `GAMES` list as `eotb`. Verified: real levels
1-12 export cleanly (`npx tsx tools/eotb/export-dungeon.ts data/eotb/amiga`,
all 5 wall sets' `.VMP` oracle checks pass); multiple real poses render
coherent brick/stone dungeon views (`render-through-dungeon.ts`); live in
the browser walker via Playwright — game/level selectors populate, WASD
movement and Q/E turning both change the tracked pose correctly (checked
via the status-bar text, not just a screenshot diff), 0 console errors.
`npx vitest run`, `tsc --noEmit`, `npm run lint` all clean across the
whole repo with this change in the tree.

**Not attempted this session** (see `eotb1-amiga-walker-wallmapping`
above and `docs/eotb2/TODO.md`/`docs/landsoflore/TODO.md` for their own
status): EOB2 and Lands of Lore. Both are documented as sharing EOB1's
per-cell `.MAZ`-family map format (LoL's `.CMZ` is confirmed to be "just
an LCW-compressed copy of the same MAZ grid format EOB uses"), so
`tools/eotb/decode-maze.ts`'s decoder and `view-model.ts`'s rotation
logic are real candidates to extend rather than rewrite — but EOB2's
`.INF`/wall-set format and Lands of Lore's `.VCN`/`.CMZ` specifics
(128-colour extended VCN, LCW-compressed maze) are each a real decode
pass of their own, not done here. `tools/eotb/renderer.ts`'s per-tile
compositor and the `wallMappingIndex` gap above are the two things
whoever picks this up should read first.

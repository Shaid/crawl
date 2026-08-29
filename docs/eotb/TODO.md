# Eye of the Beholder (EOB1) — open work

Single status surface for EOB1. See `docs/eotb/amiga/data-structure.md`
(Amiga port) and `docs/eotb/dosvga/data-structure.md` (DOS/VGA port) for
full evidence and paths-tried tables — this file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb1-dos-inf-opcode-operands | open | `.INF` event-script bytecode dispatcher and ~30 opcode names are confirmed from source; individual opcode operand byte-widths not exhaustively decoded | `dosvga/data-structure.md` § "INF — Level configuration" → "Event script" | 2026-08-02 game-re |
| eotb1-dos-ega-comptype1-variant | open | A `compType=1` `.EGA` variant (`BRICK1/2/3.EGA`, `BLUE.EGA`, `DROW.EGA`, plus `ITEMRMP.EGA`'s empty-file case — 6 files total) was found while wiring the mainline `compType=4` `.EGA`/`.ECN`/`.EMP` pipeline and is skipped by the extractor; not yet decoded | `dosvga/data-structure.md` § "EGA render mode" → "Not extracted this session (open items)" | 2026-08-29 game-re |
| eotb1-amiga-walker-wallmapping-decorations | open | The wall-mapping override table (`wallIndex`->`vmpIndex`) itself is now closed (see closed-items block below) and implemented. Still open, real but out of this pass's scope: `decIndex`-driven decoration overlays (`assignWallsAndDecorations`'s `_levelDecorationData`/`_levelDecorationRects` do-while chain, fed by the `0xEC` decoration-load records `parseInf` already exposes as `decorationLoads`), `specialType`/`flags` (door/stairs/special-tile behaviour beyond wall art), the render rotation for facing != North (`tools/eotb/view-model.ts`'s `roleSide`, a self-consistent extrapolation not independently verified — no oracle in this corpus to check it against), VMP's per-tile `zMask` flag ("seam" hint, unmodelled), and door open/closed state (static from the `.MAZ` snapshot only, `.INF` event-script mutation not applied) | `tools/eotb/decode-inf.ts` (`parseInf`'s `decorationLoads`/`specialType`/`flags` fields, unused downstream); `tools/eotb/view-model.ts` (`roleSide` doc comment) | 2026-08-29 amiga-disasm |

## Closed this session (2026-08-29, game-re — DOS pipeline wiring + Amiga savegame/special-codec/multipalette)

- **`eotb1-dos-ega-pipeline`** — **closed.** `.EGA`/`.ECN`/`.EMP`
  (`compType=4`) wired into `scripts/extract_eotb_dosvga.py` via new
  `extract_ega_screens`/`extract_ecn_wallsets` functions and new shared
  modules `scripts/kyralib/ega_palette.py` (EGA 16-colour default palette)
  and `scripts/kyralib/inf.py` (`.INF` header parse for wall-set stems).
  42/48 candidate files extracted successfully (6 skipped, each with a
  documented reason — see the new `eotb1-dos-ega-comptype1-variant` row
  above). Verified by rendering: `screens/door_ega.png` (14 unique
  colours, legible door art) coexists correctly with the pre-existing VGA
  `screens/door.png` (57 unique colours) after fixing a real filename
  collision bug (both extractors initially wrote to the same `screens/door`
  manifest key). `textures/brick_ecn.png` required bypassing `.VCN`'s
  `col_map` remap (confirmed vestigial/all-zero for every real `.ECN` in
  the corpus, unlike meaningful VGA `.VCN` maps) via a new
  `decode_ecn_tile_raw`; before the fix it rendered fully transparent
  (every tile decoding to index 0), after the fix it shows a legible red
  brick texture with a blue/black sky band. See `dosvga/data-structure.md`
  § "EGA render mode".
- **`eotb1-dos-item-dat-pipeline`** — **closed.** Wired into
  `scripts/extract_eotb_dosvga.py`'s new `extract_item_data`, writing
  `data/item.json` (448 items, 95 names) and `data/itemtype.json` (57
  types) via the already byte-exact `scripts/kyralib/items.py`. See
  `dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT".
- **`eotb1-dos-monster-cps-palette`** — **closed.** Built
  `build_monster_wallset_palette()` in `scripts/extract_eotb_dosvga.py`,
  parsing all 12 `LEVELn.INF` headers' monster-shape slots (via the new
  `scripts/kyralib/inf.py`) into a monster-CPS-filename -> wall-set-stem
  map, and wired it into `extract_cps_screens` so monster CPS files
  resolve to `<WALLSET>.PAL` instead of the wrong `EOBPAL.COL` fallback —
  also fixing/confirming the `<STEM>.CPS` vs `<STEM>1.CPS` fallback naming
  rule from ScummVM's `loadEoBBitmap` source along the way. See
  `dosvga/data-structure.md` § "VGA palette" → "Monster CPS files".
- **`eotb1-amiga-dec-verify`** — **closed as a confirmed, honest
  negative.** No `.DEC` file exists anywhere in EOB1's corpus, DOS or
  Amiga — the format (shared byte-exact layout, forced-LE reader) is
  fully confirmed from source but has zero real files in this project to
  verify it against, and this is reported plainly rather than fabricating
  a check. See `amiga/data-structure.md` § "DEC Files".
- **`eotb1-amiga-savegame-port`** — **closed.** New
  `tools/eotb/decode-savegame.ts` (`decodeSavegame`,
  `detectAmigaSaveFile`) fully implements `EoBCoreEngine::
  readOriginalSaveFile`'s layout, verified byte-exact against the real
  `data/eotb/amiga/EOBDATA.SAV` (33,107 bytes) — parsing lands exactly on
  EOF with zero residue. One genuine discrepancy from ScummVM's literal
  source was found and documented: the temp-data-parts loop must run
  `numParts` (12) times, not the source's literal `numParts + 1` (13) —
  the byte-exact-EOF oracle was used as the tiebreaker. 4/4 tests passing
  in `tools/eotb/__tests__/eotb-savegame.test.ts`. See
  `amiga/data-structure.md` § "EOBDATA.SAV".
- **`eotb1-amiga-multipalette-cps-callsite`** — **closed, strongly
  narrowed rather than airtight-proven.** Traced `setDualPalettes`'s call
  site up to the data-driven `oeob_dialogue` event-script opcode and the
  hardcoded-`"MAP"` `displayParchment` path; scanned all 12 decompressed
  `LEVELn.INF` event-script regions for any `.CPS` filename operand —
  zero found — and confirmed no `MAP.CPS`/`MAP1.CPS` exists anywhere in
  this corpus. Conclusion: no data in this EOB1 Amiga corpus reaches
  `setDualPalettes`, though this is a data-flow negative (no CPS operand
  strings, no MAP file), not a full opcode-by-opcode script interpreter
  proof. No extractor work was needed since there's nothing in the corpus
  to extract multi-palette output from. See `amiga/data-structure.md` §
  "Palette Locations" → "Multi-palette CPS".
- **`eotb1-amiga-special-cps-codec`** — **closed on the implementation
  side; verification side an honest negative.** New
  `tools/eotb/decode-special-cps.ts` (`usesSpecialAmigaCodec`,
  `decodeSpecialAmigaCps`) ports `loadSpecialAmigaCPS` byte-for-byte,
  including the bit reader's 31-usable-bits-per-32-bit-word behaviour. A
  whole-corpus gate scan (`tools/eotb/__tests__/eotb-special-cps.test.ts`)
  found **zero files** in `data/eotb/amiga/` (including all 12
  `LEVELn.INF` and `TEXT.CPS`) that take this codec's branch — every one
  uses the ordinary `compType=4` LCW path instead, consistent with the
  source's own note that this is chiefly an EOB2-Amiga-German fallback.
  Verified instead against a from-first-principles hand-built 16-byte
  synthetic test vector (drives the literal-byte decode path to emit
  `0x41` with a self-consistent XOR checksum) plus a checksum-rejection
  test; the match-copy branches remain source-ported-only with no
  corpus oracle to exercise them. 5/5 tests passing. See
  `amiga/data-structure.md` § "A second, distinct Amiga-only codec".

## Closed this session (2026-08-29, amiga-disasm — real `.INF` wall-mapping table)

- **`eotb1-amiga-walker-wallmapping`** — **closed.** The real `.MAZ` raw
  `wallIndex` -> render `vmpIndex` mapping is implemented and verified:
  `tools/eotb/decode-inf.ts`'s `buildWallTypeMap`/`parseInf`,
  `tools/eotb/view-model.ts`'s `resolveWallTypes` (now takes a
  `wallTypeMap` parameter instead of the old `clampWallType`
  approximation), `tools/eotb/renderer.ts`'s `renderView`, and
  `tools/eotb/export-dungeon.ts` (embeds each level's `wallTypeMap` in its
  exported JSON, consumed by `tools/walker/games-eotb.ts` at runtime).
  **Root cause of the previous session's failed hand-walk, now
  identified**: `.INF` genuinely *is* LCW-compressed (a standard CPS-style
  header, `CompressionType=4`) — the previous session concluded it was
  plain-text because `strings` shows readable names directly in the raw
  file, but LCW's own literal-copy command preserves short ASCII runs
  verbatim, so that observation doesn't distinguish compressed from
  uncompressed. The previous attempt was walking the *never-decompressed*
  compressed bytes against decompressed-buffer struct offsets and was
  guaranteed to drift; it was not, as suspected, a real DOS-vs-Amiga
  struct-layout divergence — once real decompression (`tools/eotb/lcw.ts`,
  already verified against 62 real `.CPS` files) is applied, the Amiga
  on-disk layout matches ScummVM's own `gameID == GI_EOB1`/
  `kPlatformAmiga` source branches (`engines/kyra/engine/scene_eob.cpp`,
  `engines/kyra/engine/sprites_eob.cpp`) byte for byte, with **zero
  drift**, across the whole `LEVEL{1..12}.INF` corpus — every parsed
  monster-shape name matches a real `<name>.CPS` file, every `wallSetName`
  matches the known wall-set corpus, and the parse terminates cleanly well
  inside the decompressed buffer. A from-scratch disassembly of the real
  Amiga executable (`data/eotb/amiga/eob2`, the 190 KB binary confirmed
  via `strings` to embed the level filename table) was also attempted;
  the level table itself was located (`HUNK_DATA` module 12, file offset
  162732), but the surrounding function-shaped bytes weren't resolved
  further given the time budget — not needed, since the file-level
  verification above is already decisive. Visually confirmed:
  `public/assets/eotb/amiga/renders/level1-22-10-f0.png` (`LEVEL1.MAZ`
  cell (22,9) side N, raw `wallIndex=25`, overridden by `LEVEL1.INF` to
  `vmpIndex=0` i.e. no wall) now shows an open passage where the old
  clamp rendered a solid brick wall. Full field-offset table and citations:
  `docs/eotb/amiga/data-structure.md` § "INF — Level Configuration".
  Remaining, genuinely separate open work (decoration overlays,
  `specialType`/`flags`, facing rotation, `zMask`, door state): see
  `eotb1-amiga-walker-wallmapping-decorations` above.

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

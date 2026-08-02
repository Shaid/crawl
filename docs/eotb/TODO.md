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
| eotb1-amiga-vcn-render | open | Amiga VCN palette (5 colours, offset 0x02, corrected scaling formula) and decompression (confirmed: none — raw tile data) are now fully confirmed from source; texture atlas not yet re-rendered with the corrected offset | `amiga/data-structure.md` § "VCN — Wall View Data" → "Structure — confirmed" and "Palette (VCN offset 0x02...)" | 2026-08-02 game-re |
| eotb1-amiga-dec-verify | open | `.DEC` format confirmed from source (shared byte-exact layout with DOS, forced-LE reader) but not independently byte-verified against a real Amiga `.DEC` file (none in this corpus to cross-check against DOS either) | `amiga/data-structure.md` § "DEC Files" | 2026-08-02 game-re |
| eotb1-amiga-savegame-port | open | `EOBDATA.SAV` structure fully confirmed from source and platform-detection heuristic spot-verified against the real file; full record layout not ported to a standalone decoder/extractor | `amiga/data-structure.md` § "EOBDATA.SAV — Save game" | 2026-08-02 game-re |
| eotb1-amiga-multipalette-cps-callsite | open | Multi-palette CPS mechanism confirmed (`setDualPalettes` = horizontal split-screen dual palette, not fade/animation) but the specific screen/context that calls it (`eobcommon.cpp:1783`) not traced to find which CPS files actually use it | `amiga/data-structure.md` § "Palette Locations" → "Multi-palette CPS — mechanism confirmed" | 2026-08-02 game-re |
| eotb1-amiga-special-cps-codec | open | Bonus finding (not originally an open item): a second Amiga-only compression codec (`loadSpecialAmigaCPS`, backwards-reading bit-level LZ) used for Amiga `.INF`-equivalent files and `TEXT.CPS` — confirmed and cited from source, not implemented as a decoder | `amiga/data-structure.md` § "A second, distinct Amiga-only codec" | 2026-08-02 game-re |

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

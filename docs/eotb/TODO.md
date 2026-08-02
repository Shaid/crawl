# Eye of the Beholder (EOB1) — open work

Single status surface for EOB1. See `docs/eotb/amiga/data-structure.md`
(Amiga port) and `docs/eotb/dosvga/data-structure.md` (DOS/VGA port) for
full evidence and paths-tried tables — this file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb1-dos-eye-pak | open | `EYE.PAK` (1.75 MB) doesn't parse as a Kyra PAK and is never referenced by `EOB.EXE`/`INTRO.EXE`/`START1.EXE` — confirm whether it's CD-installer-only or genuinely unused | `dosvga/data-structure.md` § "PAK — Container format" | 2026-08-02 game-re |
| eotb1-dos-ega-files | open | `.EGA`/`.ECN`/`.EMP` (EGA render-mode graphics) not decoded — VGA/MCGA was the primary target this pass | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| eotb1-dos-inf-format | open | `.INF` level-config records (monster spawns, decoration commands, event scripts) located but not field-decoded | `dosvga/data-structure.md` § "INF — Level configuration (open)" | 2026-08-02 game-re |
| eotb1-dos-item-dat | open | `ITEM.DAT`/`ITEMTYPE.DAT` field layout — same size as the verified Amiga tables, byte-swap (LE vs BE) hypothesis only, record stride not resolved | `dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT (open)" | 2026-08-02 game-re |
| eotb1-dos-cps-palette-heuristic | open | Per-CPS palette selection for screens with no embedded palette and no name-matched `.PAL`/`.COL` (falls back to `EOBPAL.COL`) is a name-matching heuristic, not traced through the level-load code | `dosvga/data-structure.md` § "VGA palette" → "Per-file palette selection is a hypothesis" | 2026-08-02 game-re |
| eotb1-amiga-vcn-palette | open | Amiga VCN palette encoding (24-bit RGB at offset 0x40) doesn't map cleanly to 12-bit Amiga colours — exact scaling factor/bit depth unknown | `amiga/data-structure.md` § "VCN — Wall View Data" → "Palette (VCN offset 0x40)" | pre-existing |
| eotb1-amiga-vcn-decompress | open | Amiga VCN tile decompression algorithm not implemented (tile data after the palette may be compressed) | `amiga/data-structure.md` § "VCN — Wall View Data" | pre-existing |
| eotb1-amiga-dec-format | open | Amiga `.DEC` decoration-data structure documented externally (Shikadi wiki) but not verified against the actual data files | `amiga/data-structure.md` § "EOB2 — Additional Formats" → "DEC Files" | pre-existing |
| eotb1-amiga-dcr-format | open | Amiga `.DCR` creature/decoration resources undocumented and not analyzed | `amiga/data-structure.md` § "EOB2 — Additional Formats" → "DCR Files" | pre-existing |
| eotb1-amiga-savegame | open | Amiga `EOBDATA.SAV` save-game structure documented but not verified against the actual file | `amiga/data-structure.md` § "File Types" → `EOBDATA.SAV` row | pre-existing |
| eotb1-amiga-multipalette-cps | open | Some EOB2 CPS files contain multiple palettes for different screen quadrants/effects (e.g. lightning flashes) — multi-palette rendering logic not implemented. (EOB2-specific; tracked here since it was raised in this doc — also relevant to `docs/eotb2/TODO.md` if an Amiga EOB2 doc is written later.) | `amiga/data-structure.md` § "Palette Locations" → "EOB2 style" | pre-existing |

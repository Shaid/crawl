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
| eotb2-dos-dcr-format | open | `.DCR` files (9 total, e.g. `BEHOLDER.DCR` = 38 bytes) — likely creature/decoration parameters, not graphics; not traced | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| eotb2-dos-dec-format | open | `.DEC` decoration-placement files (6 total) not verified against these DOS files | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| eotb2-dos-ega-files | open | `.EGA` secondary render-mode graphics (8 total) not decoded | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| eotb2-dos-azure-vcn-missing | open | `AZURE.VCN` doesn't exist in this corpus (only `AZURE1/2.CPS` full-screen renders) — confirm whether Azure is genuinely CPS-backdrop-only or the VCN uses an unidentified name | `dosvga/data-structure.md` § "VCN / VMP — Wall tilesets" | 2026-08-02 game-re |
| eotb2-dos-item-text-dat | open | `ITEM.DAT`/`ITEMTYPE.DAT`/`TEXT.DAT` present but not decoded (same open item as EOB1) | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| eotb2-dos-cps-palette-heuristic | open | Per-CPS palette selection for the 110 `PALETTE0.PAL`-fallback screens is a heuristic (name-match, else PALETTE0), spot-checked on 4 files only, not traced through the level-load code | `dosvga/data-structure.md` § "Palette resolution (per-CPS)" | 2026-08-02 game-re |
| eotb2-amiga-not-started | deferred:out-of-scope | `data/eotb2/amiga/` (incl. Manual/Maps/Solution reference material) not yet reverse-engineered — DOS/VGA was this session's priority | (no doc yet) | 2026-08-02 game-re |

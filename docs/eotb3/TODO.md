# eotb3 — open work

Single status surface for Eye of the Beholder III (DOS/Windows,
`data/eotb3/dosvga/`). See `docs/eotb3/dosvga/data-structure.md` for full
evidence and paths-tried tables — this file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb3-bitmap-palette | open | Which named palette resource pairs with which `EYE.RES` "1.10" VFX-shape bitmap resource? | data-structure.md § "4.2 AESOP/16 '1.10' VFX shape table" and § "Still open" | 2026-08-02 game-re |
| eotb3-gff-fallback-palette | open | Confirm/replace the CHARGEN-palette fallback used for `DARK.GFF`/`LICH.GFF` (no embedded PAL block) | data-structure.md § "5. GFF/GFFI — cinematic container" and § "Still open" | 2026-08-02 game-re |
| eotb3-res-nonbitmap | open | Extract `EYE.RES` non-bitmap resource types (sounds, maps, strings) — only the VFX-shape subset was batch-decoded this pass | data-structure.md § "Still open"; full manifest at `public/assets/eotb3/dosvga/data/resources.json` | 2026-08-02 game-re |
| eotb3-gff-seq-tags | deferred:out-of-scope | Decode GFF `ACF`/`MERR`/`*SEQ` tag blocks (error tables + cutscene playback sequencing) | data-structure.md § "Still open" | 2026-08-02 game-re |
| eotb3-savegame-extractor | deferred:not-an-asset | Write a committed `SAVEGAME/` extractor (format documented + spot-verified, no extractor written — it's player save state, not shipped game data) | data-structure.md § "8. SAVEGAME/" | 2026-08-02 game-re |
| eotb3-aesop-bytecode | deferred:out-of-scope | AESOP bytecode (376 SOP code objects in `EYE.RES`) — game logic, not asset data; ThirdEye's `daesop` already covers this | data-structure.md § "Still open" | 2026-08-02 game-re |

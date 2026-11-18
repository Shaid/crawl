# Eye of the Beholder (EOB1) — open work

Single status surface for EOB1. See `docs/eotb/amiga/data-structure.md`
(Amiga port) and `docs/eotb/dosvga/data-structure.md` (DOS/VGA port) for
full evidence and paths-tried tables — this file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb1-dos-inf-opcode-operands | open | `.INF` event-script bytecode dispatcher and ~30 opcode names are confirmed from source; individual opcode operand byte-widths not exhaustively decoded | `dosvga/data-structure.md` § "INF — Level configuration" → "Event script" | 2026-08-02 game-re |
| eotb1-dos-ega-comptype1-variant | open | A `compType=1` `.EGA` variant (`BRICK1/2/3.EGA`, `BLUE.EGA`, `DROW.EGA`, plus `ITEMRMP.EGA`'s empty-file case — 6 files total) was found while wiring the mainline `compType=4` `.EGA`/`.ECN`/`.EMP` pipeline and is skipped by the extractor; not yet decoded | `dosvga/data-structure.md` § "EGA render mode" → "Not extracted this session (open items)" | 2026-08-29 game-re |
| eotb1-amiga-vmp-zmask | open | VMP's per-tile `zMask` flag ("seam" hint) is decoded but unmodelled by the renderer | `amiga/data-structure.md` § "VMP — Wall View Mapping Table" | 2026-08-02 game-re |
| eotb1-amiga-wallflags-untraced-bits | open | `specialType`/`flags` dispatch and 4 of 8 `flags` bits are traced from source (door/lever/niche semantics); bits `0x01`/`0x10`/`0x40`/`0x80` and the exact semantic role of the `flags^4` load-time inversion (bit `0x04`) not traced — not blocking (no rendering behaviour depends on them) | `amiga/data-structure.md` § "`specialType` / `flags` semantics" | 2026-08-29 amiga-disasm |
| eotb1-amiga-level1-wall53 | open | `LEVEL1.MAZ` has one side with raw wall value 53 that `LEVEL1.INF` maps nowhere (EOB1 has no sub-levels); walker draws no wall there. Engine behaviour for an unmapped value (stale `_wllVmpMap`/default) not checked | `audit-2026-11-13.md` finding 3 table | 2026-11-18 game-re |
| eotb1-level3-maz-4-30-xport | open | `LEVEL3.MAZ` cell (4,30) differs between DOS and Amiga (E/W sides 13/18 vs 3/8); same VMP either way but the door shape set differs (`_wllShapeMap` -1 for 3-7 / 13-17). Which port is canonical for the door shape? | `dosvga/data-structure.md` § MAZ (cross-port note, 2026-11) | 2026-11-18 game-re |
| eotb-build-cache-migration | deferred:out-of-scope | `data/eotb/amiga/LEVEL1.INF.dec` is a derived file in the original-data zone (nothing references it); should live under `build/cache/` | `audit-2026-11-13.md` finding 11 | 2026-11-18 game-re |

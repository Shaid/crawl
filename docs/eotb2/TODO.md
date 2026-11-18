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
| eotb2-sublevel-wall-layers | open | EOB2 sub-levels are **cumulative wall-mapping layers** (`loadLevel(level, sub)` runs `resetWallData` then `initLevelData(0..sub)`, `scene_eob.cpp:35-53`; `sub` comes from the level-change opcode, `script_eob.cpp:1288-1319`). Levels 1,3,7,8,11,16 have a second block (5-24 wall-mapping records + extra decoration loads: `brown3` on L3, `crimson2` on L16); on L3 six wall indices are remapped in sub 1. `tools/eotb2/decode-inf.ts` + exporter model sub 0 only; export the sub 0 and sub 0+1 wall maps and let the walker pick | `audit-2026-11-13.md` finding 3; `dosvga/data-structure.md` § "INF" → "Sub-level chaining" | 2026-11-18 game-re |
| eotb2-level5-maz-shared-mapping | open | `level5.maz` is shared by LEVEL5 and LEVEL6 (`LEVEL6.INF` -> level5.maz) and 14 raw wall values (~100 sides) have no mapping in LEVEL5.INF; only LEVEL6.INF maps them. Walker for level 5 shows them as no-wall; check what the engine shows (level 5 is never loaded with LEVEL6's mapping) | `audit-2026-11-13.md` finding 3 table | 2026-11-18 game-re |

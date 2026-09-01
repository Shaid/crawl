# Treasures of the Savage Frontier — open work

Single status surface for this game (Amiga only). See
`docs/treasureofthesavagefrontier/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Sixth GLIB-format sibling title staged in this repo, direct sequel to
Gateway to the Savage Frontier. Opened in the same pass as The Dark Queen of
Krynn and Gateway, extending the decoders first built for Curse of the
Azure Bonds / Secret of the Silver Blades / Pools of Darkness.

## 2026-09-01 — container/GEO/WALLDEF confirmed unchanged; ECL fully SOLVED via `re-oracle` escalation

- Container, `WALLDEF.GLB`-equivalent geometry, and `GEO.GLB`'s fixed
  1024-byte/16x16 shape all transfer unchanged: 25/25 GLIB files OK, 41/41
  GEO levels (the largest level count in the corpus), 60+60 wall-texture
  PNGs rendered with 0 skips in either tile-bank scheme.
- `ECL.GLB` needed a new opcode-table variant (`OPCODE_TABLE_TREASURE_V13X`
  — Pools of Darkness's v1.3 table plus 3 new opcodes, `0x42`-`0x44`) on top
  of the already-found constant 2-byte `0x8813` block prefix. **Escalated
  to `re-oracle`** after 2 genuinely distinct failed hypotheses; the
  escalation found the fix via a headless-Ghidra disassembly of this
  title's own executable, and it was **independently re-verified against
  real bytes this session** (0 unknown opcodes / 0 desyncs across 30,338
  instructions, reproduced exactly; the exe-derived wallset table's 87
  values checked 87/87 inside `WallDef.glb`'s real directory).
- **A second, bigger finding came with it**: for this title's dungeon geos
  (16-50), the ECL bytecode's own wallset-slot operands are dead data — the
  Amiga executable's `getAreaWallsets` unconditionally overwrites them from
  a hardcoded per-geo table. Wired in as a `wallsetOverride`
  (`tools/shared/goldbox-glib-export.ts`) that replaces ECL's own
  resolution for those 29 geo ids. Final: ECL bytecode alone resolves
  24/41 levels (72 slots); the override then correctly replaces 29/41
  levels (87 slots) — exactly the corpus's geo ids inside the executable's
  `[16,50]` table range.
- A resolved dungeon cell (level 16, cell (0,0) facing North) was traced
  end-to-end to its real texture (`walldef2-9-wall0-view6.png`) and
  visually confirmed non-degenerate.
- The walker (`tools/walker/walker.ts`, id `treasureofthesavagefrontier`)
  now renders real per-cell wall art for every dungeon-geo level in this
  corpus.

### Paths tried

See `amiga/data-structure.md` §4's table (kept there since it's evidence,
not status, per this project's documentation convention).

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| tsf-wilderness-renderer | open | Wilderness geos 51-62 have NO executable-hardcoded wallset table at all (confirmed via disassembly, not just "outside the table's key range") — `Sky.tlb`/`wildcom.tlb`/`randcom.tlb` are confirmed real GLIB/TILE containers, likely feeding a separate overland renderer, but the code that reads them hasn't been located | `amiga/data-structure.md` §4 correction block, `tools/shared/goldbox-ecl.ts` module doc | 2026-09-01 |
| tsf-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, sprites, portraits, dungeon commands, strings, sounds) not catalogued — only outer container structure validated | `amiga/data-structure.md` §6 | 2026-09-01 |

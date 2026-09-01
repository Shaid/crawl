# Gateway to the Savage Frontier — open work

Single status surface for this game (Amiga only). See
`docs/gatewaytothesavagefrontier/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Fourth GLIB-format sibling title staged in this repo. Opened in the same
pass as The Dark Queen of Krynn and Treasures of the Savage Frontier,
extending the decoders first built for Curse of the Azure Bonds / Secret of
the Silver Blades / Pools of Darkness.

## 2026-09-01 — full format stack confirmed unchanged from sibling titles; walker built

- Container/codec, `WALLDEF.GLB` geometry, the 8x8 tile-bank schemes,
  `GEO.GLB`'s fixed 1024-byte/16x16 record shape, and `ECL.GLB`'s v1.1
  opcode table all transfer **completely unchanged** — no adaptation needed
  anywhere in the format stack for this title. 27/27 GLIB files OK, 30/30
  GEO levels, 22/30 ECL levels resolved (64 slots, 0 unknown opcodes/0
  desyncs corpus-wide).
- 95 scheme-1 + 65 scheme-2 wall-texture PNGs rendered and visually
  spot-checked (non-degenerate, structured — see `amiga/data-structure.md`
  §2). A resolved dungeon cell (level 3, cell (2,0) facing North) was traced
  end-to-end to its real texture (`walldef2-12-wall0-view6.png`).
- A real interactive walker exists (`tools/walker/walker.ts`, id
  `gatewaytothesavagefrontier`) with confirmed maze connectivity + per-cell
  wall art for 22/30 levels, falling back to the standard per-level
  placeholder for the other 8.

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Assume the v1.1 ECL opcode table might need adaptation (per the task's explicit instruction to verify, not assume) | 0 unknown opcodes, 0 desyncs across the whole corpus with the table unchanged | No adaptation was needed — confirmed, not assumed |

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| gsf-ecl-8-unresolved | open | 8/30 levels have no reachable static wallset-load hit and no `NEWECL` chase target (same "script-less" shape as PoR 30/31/32) | `amiga/data-structure.md` §4 | 2026-09-01 |
| gsf-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, sprites, portraits, dungeon commands, strings, sounds) not catalogued — only outer container structure validated | `amiga/data-structure.md` §6 | 2026-09-01 |

# Treasures of the Savage Frontier — open work

Single status surface for this game (Amiga only). See
`docs/treasureofthesavagefrontier/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Sixth GLIB-format sibling title staged in this repo, direct sequel to
Gateway to the Savage Frontier. Opened in the same pass as The Dark Queen of
Krynn and Gateway, extending the decoders first built for Curse of the
Azure Bonds / Secret of the Silver Blades / Pools of Darkness.

## 2026-09-01 — container/GEO/WALLDEF confirmed unchanged; ECL prefix tag found; opcode table escalated to `re-oracle`

- Container, `WALLDEF.GLB`-equivalent geometry, and `GEO.GLB`'s fixed
  1024-byte/16x16 shape all transfer unchanged: 25/25 GLIB files OK, 41/41
  GEO levels (the largest level count in the corpus), 60+60 wall-texture
  PNGs rendered with 0 skips in either tile-bank scheme.
- Found a genuinely new container-level detail: `ECL.GLB` blocks carry a
  constant 2-byte `0x8813` prefix tag (matching Pool of Radiance's own
  `.dax`-family prefix convention, but never seen before on a GLIB-family
  title's `ECL.GLB`). Stripping it is necessary but not sufficient — a
  corpus-wide reachability walk under the v1.1 opcode table (used unchanged
  by Curse/Secret/PoR/Gateway) still desyncs on ~10% of visited opcodes,
  resolving only 1/41 levels (that resolution's own slot value, `33104`, is
  implausible — a desync artifact).
- **Escalated to `re-oracle`** after 2 genuinely distinct failed hypotheses
  (table unchanged + no prefix; prefix stripped + v1.1 table still desyncs
  at full-corpus scale). Interim finding: strip + the v1.3 table
  (`OPCODE_TABLE_POOLS_V13`) + two new opcodes (`0x42`/`0x43`, 4 plain
  operands each) gives 0 unknown opcodes / 0 desyncs across the whole
  corpus (20,588 instructions, 30 blocks) — the wallset-load call is `0x42`
  here, not `0x21` (Pools) or `0x37` (v1.1). One puzzle remains open inside
  the escalation itself: resolved slot values cluster in `{7..16}`, not
  matching `WALLDEF.GLB`'s own sparse id list (`{2,4,5,6,7,8,9,13,30,31,32,
  36}`) directly — a remap layer or different id convention, being traced
  against this title's own AmigaOS executable (has a `HUNK_SYMBOL` block).
  **Not yet independently re-verified by this pass** — see
  `amiga/data-structure.md` §4 for the full paths-tried table and caveats.

### Paths tried

See `amiga/data-structure.md` §4's table (kept there since it's evidence,
not status, per this project's documentation convention).

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| tsf-ecl-opcode-table | escalated:re-oracle | Full ECL opcode table + wallset-slot-id remap not yet confirmed (interim: prefix+v1.3 table+2 new opcodes gives 0 desyncs corpus-wide, but resolved slot ids `{7..16}` don't match `WALLDEF.GLB`'s own id list `{2,4,...,36}` — escalation tracing the executable) | `amiga/data-structure.md` §4 | 2026-09-01 |
| tsf-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, sprites, portraits, dungeon commands, strings, sounds) not catalogued — only outer container structure validated | `amiga/data-structure.md` §6 | 2026-09-01 |

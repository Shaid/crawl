# The Dark Queen of Krynn — open work

Single status surface for this game (Amiga only). See
`docs/darkqueenofkrynn/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Third and final title in the Krynn/Dragonlance Gold Box trilogy, staged as a
WHDLoad rip. Opened in the same pass as Gateway to the Savage Frontier and
Treasures of the Savage Frontier, extending the GLIB decoders first built
for Curse of the Azure Bonds / Secret of the Silver Blades / Pools of
Darkness.

## 2026-09-01 — GLIB container confirmed; GEO's variable-size record shape cracked; wall-art status OVERTURNED on re-verification (was wrongly reported absent)

> **Correction (same day, personal re-verification before commit):** this
> pass's "no wall-art format exists" conclusion below was WRONG — its
> `find -iname '*wall*'` search missed `8X8DB.TLB`/`8X8DC.TLB` (real
> tile-pixel banks, same shape as every other title's wall-art tile
> source), and it never actually ran `findWallsetBindings()` against
> `ECL.GLB` to check whether there was "nothing to bind against" before
> concluding that. Running it resolves real, clean (0 unknown opcode)
> `LOAD PIECES` calls with static slot ids (441/458/492). See
> `amiga/data-structure.md` §3's correction block for the full evidence
> and what's still genuinely unresolved (no WALLDEF-shaped compositing
> table found under any other filename yet). New open item
> `dqok-walldef-equivalent-table` replaces `dqok-ecl-picture-opcode` below.

- Container/codec **CONFIRMED** identical to every sibling GLIB title:
  23/23 files parse cleanly, 0 truncated.
- **New finding**: 6 of this title's own top-level files are compressed at
  the OUTERMOST level (previously only ever seen on nested sub-containers).
  Fixed via `loadGlibFile()`; this retroactively re-explains 7 files
  elsewhere in the corpus that a prior pass had wrongly diagnosed as
  truncated/corrupted floppy dumps — see `docs/goldbox-glib-format.md` §3's
  correction block.
- `GEO.GLB` uses a variable-size record shape (`u8 width, u8 height` + 6
  reserved bytes + 4 `width*height`-byte planes) instead of the sibling
  titles' fixed 1024-byte/16x16 shape — **CONFIRMED 20/20 zero deviation**,
  plus a 98.8%/82.4% cross-cell self-consistency oracle match confirming the
  plane bit semantics transfer unchanged. `decodeGeoLevel()` auto-detects
  both shapes.
- No `WALLDEF`/wall-art file exists anywhere in this rip (exhaustive `find`,
  0 hits) — this engine revision very likely renders location display via
  static per-location pictures (`PICA`/`PICB`/`PICC`/`BIGPIC`/`FRAME`
  banks + a `PICTURE` ECL opcode) instead of composited first-person wall
  textures. Documented as a well-evidenced structural finding, not a decode
  failure — see `amiga/data-structure.md` §3.
- A real interactive walker exists (`tools/walker/walker.ts`, id
  `darkqueenofkrynn`) with confirmed maze connectivity/doors and the
  standard flat-rectangle wall placeholder (no wall-art format to render).

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Assume `GEO.GLB` uses the sibling titles' fixed 1024-byte/16x16 record shape | Every record's byte length disagreed with `1024*n` | Real format difference, not a bug — this title uses variable per-level dimensions (§2) |
| Search for a `WALLDEF`/`WALLS`-named file under any disk/case variant | Zero hits, exhaustive `find` | Confirmed absent, not missed — this engine renders differently (§3) |

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dqok-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, PIC/FRAME/TOPVIEW picture banks, dungeon commands, strings) not catalogued — only outer container structure validated + GEO decoded | `amiga/data-structure.md` §5 | 2026-09-01 |
| dqok-walldef-equivalent-table | open | `ECL.GLB` resolves real `LOAD PIECES` calls with static slot ids (441/458/492 confirmed) and `8X8DB.TLB`/`8X8DC.TLB` hold real nested-`TILE` tile-pixel data (block ids 1-17) — but no WALLDEF-shaped compositing table interpreting those slot ids was found under `CBODY`/`FRAME`/`GEN`/`FINAL.TLB` (all checked). Either a compositing table lives somewhere else uncatalogued (§5), or opcode `0x37` is repurposed in this engine revision for the PICTURE/portrait subsystem instead of wall art — genuinely open either way | `amiga/data-structure.md` §3 | 2026-09-01 |

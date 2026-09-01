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

## 2026-09-01 — GLIB container confirmed; GEO's variable-size record shape cracked; wall-art absence CONFIRMED via disassembly (after a brief false-positive detour)

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
| Run `findWallsetBindings()` (standard v1.1 3-operand table) against `ECL.GLB` | "Resolved" clean, non-degenerate opcode-`0x37` hits (441/458/492) | **Misparse, not a real finding** — disassembly later confirmed opcode `0x37` takes 2 operands in this engine revision, not 3; the clean 0-unknown-opcode walk was a coincidental re-sync, not evidence of a correct parse (§3's second correction) |
| Check `Disk3/ECL.GLB`'s own directory for a hidden non-script/compositing block type | 47 data blocks, all ordinary script blocks (ids form a strict superset of `GEO.GLB`'s 20 level ids — same "extra blocks are non-dungeon scripts" pattern every sibling title shows) | No hidden table exists in this container |
| Disassemble the executable's ECL opcode-dispatch tables + opcode `0x37`'s real handler (`amiga-disasm` pass) | Opcode `0x37` = 2-operand linked-list/flag-search routine, NOT `LOAD PIECES` | Confirms the ECL "hits" above were a misparse artifact |
| Disassemble the one function that looked most like a 3-slot `LoadWalldef` equivalent (a `0xFF`-sentinel loader building `8x8d%c%d` filenames against the same `8X8DB`/`8X8DC` tile banks) | Its 3 inputs are the party's (facing, X, Y) map position, not wallset slot ids — confirmed via `MapDirectionXDelta`/`YDelta`-style tables and GEO's own `width`/`height` wraparound; the function is a topview map-glyph redraw. Its loader has exactly 3 callers, all internal to itself (exhaustive JSR/BSR/A4-trampoline scan) — a clean single-consumer negative | Definitively refutes this as the missing wallset loader; no second candidate found in the executable |

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dqok-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, PIC/FRAME/TOPVIEW picture banks, dungeon commands, strings) not catalogued — only outer container structure validated + GEO decoded | `amiga/data-structure.md` §5 | 2026-09-01 |

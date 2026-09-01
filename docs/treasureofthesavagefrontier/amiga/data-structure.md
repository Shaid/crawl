# Treasures of the Savage Frontier (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1992. Sixth sibling GLIB-format title
staged in this repo (alongside Curse of the Azure Bonds, Secret of the
Silver Blades, Pools of Darkness, The Dark Queen of Krynn, and Gateway to
the Savage Frontier — its own direct predecessor). Real title confirmed
from the WHDLoad rip's own `ReadMe`/`.info` files: "Treasures of the Savage
Frontier".

Container format: **`docs/goldbox-glib-format.md`** (shared by every GLIB
title — read that doc first; this page covers only what's specific to this
title). Implementation: `tools/shared/goldbox-glib.ts` (container),
`tools/shared/goldbox-walltiles.ts` (wall geometry + tile decode),
`tools/shared/goldbox-geo.ts` (GEO), `tools/shared/goldbox-ecl.ts` (ECL
bytecode VM). Extractor:
`tools/treasureofthesavagefrontier/amiga/export-data.ts`. Session history
and open items: `docs/treasureofthesavagefrontier/TODO.md`.

Raw data: `data/ssi/TreasureSavageFrontNTSC/data/diska`, `.../diskb`,
`.../DiskC` (a WHDLoad-staged install; `.Slave`/`.info` files and
`Docs/`/`Journal`/`ReadMe`/`Solution` content are out of scope per this
pass's task).

---

## 1. Container — CONFIRMED, 25/25 real GLIB files, no top-level compression

All 25 `.GLB`/`.TLB` files across the 3 disks parse as the standard GLIB
container (`docs/goldbox-glib-format.md` §1-§2) with zero deviation
(`container-directory.json`'s `structurallyOk: 25`, `0`
top-level-compressed, `0` truncated).

## 2. `WALLDEF.GLB` and 8x8 tile bank — CONFIRMED, byte-for-byte identical scheme

`DiskC/walls.tlb` is this title's `WALLDEF.GLB`-equivalent — same 156-byte
wall-slice/10-view geometry, confirmed via the exact-multiple-of-156
byte-length check (`walldef-geometry.json` reports `allMultipleOf156:
true`). Tile banks: `diska/Walls.tlb` for the flat universal+specific
scheme (scheme 1), paired with `DiskC/walls.tlb`'s own per-wall-id nested
buckets for scheme 2, using the same `decodeGlibTileBucket` +
`buildWallSpecificTileBank` machinery every sibling title reuses unmodified.

**Rendered output**: 60 scheme-1 PNGs and 60 scheme-2 PNGs, **0 skipped in
either scheme** — every WALLDEF entry in this title has a matching
scheme-2 bucket, unlike Gateway's 30 misses. Visually inspected (4x
nearest-neighbor upscale): `walldef2-13-wall0-view6.png` shows a distinct
gate/opening-shaped feature; `walldef2-2-wall0-view6.png` shows a clean
repeating vertical-column pattern; `walldef2-2-wall3-view6.png` shows an
arched/doorway motif with fine detail — all non-degenerate and consistent
with the established Gold Box wall-art visual grammar.

## 3. `GEO.GLB` — CONFIRMED, standard fixed 1024-byte/16x16 shape, 41/41 levels

`diskb/geo.glb` decodes with the standard fixed-size decoder unchanged — no
variable-size adaptation needed (unlike The Dark Queen of Krynn) — 41/41
levels, zero deviation. This is the largest level count of any GLIB title
in this corpus.

## 4. `ECL.GLB` — a new constant 2-byte block-prefix tag CONFIRMED; opcode table OPEN, escalated to `re-oracle`

`diskb/ecl.glb` decodes as a standard GLIB container (30 blocks — fewer
than GEO's 41 levels; extra GEO levels with no matching ECL block are a
known, non-error shape already established on sibling titles). Unlike every
other GLIB title's `ECL.GLB`, this title's blocks each carry a **constant
2-byte `0x8813` prefix tag** before the real bytecode stream starts —
identical in both VALUE and ROLE to Pool of Radiance's own `.dax`-family
`ecl.dax`/`geo.dax` block prefix (`docs/goldbox-glib-format.md` §7.4's
container bullet), but this is the first title in the GLIB container family
observed to carry it. Stripping it
(`eclBlockPrefixLength: 2` in this title's `export-data.ts`) is confirmed
necessary: without the strip, even short hand-traced instruction sequences
misparse immediately; with it, individual block headers and short traces
decode cleanly.

**A residual opcode-table mismatch remained after the prefix fix** — a
corpus-wide reachability walk under the v1.1 table (`OPCODE_TABLE`, the
table Curse/Secret/PoR/Gateway all use unchanged) still desyncs on unknown
opcodes for roughly 10% of visited instructions, resolving only 1/41 levels
(and that one resolution's own slot value, `33104`, is far outside any
plausible WALLDEF id range — a desync artifact, not real data). This is
qualitatively different from Gateway's clean 0-unknown-opcode result under
the identical table, despite both titles sharing the v1.1 engine lineage —
strong evidence of a genuine, title-specific opcode-table or operand-shape
variant, not a leftover prefix/base error.

**Escalated to `re-oracle` (2026-09-01)** with the full paths-tried table
below. Interim finding from the escalation (session in progress at time of
writing): the real recipe is **the 2-byte `0x8813` strip + the ALREADY-KNOWN
v1.3 opcode table (`OPCODE_TABLE_POOLS_V13`, previously only used for Pools
of Darkness) + two previously-undocumented opcodes, `0x42` and `0x43`, both
taking 4 plain operands with no dynamic tail** — this combination gives
**0 unknown opcodes and 0 desyncs across all 20,588 visited instructions in
the full corpus-wide reachability walk (30 ECL blocks)**. Wallset-load
semantics differ from Pools' own `0x21` remap: opcode `0x42` is the real
wallset-load call here, `0x42(geoId, slot1, slot2, slot3)`, where operand 1
is confirmed (at 22/23 call sites) to be the block's own geo id, and a
`0xff` sentinel in `slot3` correlates with levels whose GEO data uses no
type-11..15 walls. One puzzle is still open inside the escalation itself:
the resolved slot values cluster in `{7..16}`, which doesn't directly match
`WALLDEF.GLB`'s own sparse id list (`{2,4,5,6,7,8,9,13,30,31,32,36}`) —
either a remap layer or a different id convention than the sibling titles
use. The escalation is tracing this title's own AmigaOS executable (which
carries a `HUNK_SYMBOL` block) to settle it. **This finding is not yet
independently re-verified against real bytes by this pass** — treat the
opcode-table/prefix combination as a strong, promising lead, and the
slot-id resolution as still open, until the escalation's full report lands
and is cross-checked (per this project's standing rule: treat specialist
output like any other hypothesis, verify before marking confirmed).

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Apply the v1.1 opcode table unchanged, no prefix strip (the Gateway/Curse/Secret/PoR recipe) | Immediate desync, near-0% resolution | This title's blocks carry a leading 2-byte tag the others don't |
| Strip the 2-byte `0x8813` prefix, then apply the v1.1 table | Individual block headers and short hand-traces decode cleanly; but a full corpus-wide reachability walk still desyncs on ~10% of visited opcodes, 1/41 levels resolved (that one resolution's slot value is implausible, `33104`) | Short traces don't exercise every opcode a real reachability walk visits — the real mismatch was only visible at full-corpus scale |
| Strip the prefix, apply the v1.3 table (`OPCODE_TABLE_POOLS_V13`) WITHOUT re-checking for title-specific opcode additions | (per the `re-oracle` escalation's own report) run without the strip initially, so it "nearly worked immediately" once combined with the strip — not independently re-tried by this pass before escalating | Two genuinely different hypotheses (table alone, prefix alone) had already failed by the time this was tried; escalating was the right call once both were exhausted |
| Escalated to `re-oracle` (2026-09-01): 2 distinct failed hypotheses (table swap alone; prefix strip alone) met the escalation bar | **Interim: opcode-table-level SOLVED** — 2-byte prefix strip + v1.3 table + two new opcodes (`0x42`/`0x43`, n=4 plain operands) gives 0 unknown opcodes / 0 desyncs across the whole corpus. Slot-id semantics (why resolved values `{7..16}` don't match `WALLDEF.GLB`'s own `{2,4,...,36}` id list) still open, escalation tracing the executable to resolve it. | See the interim-finding paragraph above; full report pending at time of writing |

## 5. Extractor and outputs

Run from the repo root:

```
npx tsx tools/treasureofthesavagefrontier/amiga/export-data.ts
```

(defaults to `data/ssi/TreasureSavageFrontNTSC/data`). Writes to
`public/assets/treasureofthesavagefrontier/amiga/`:

- `data/container-directory.json` — 25/25 GLIB files OK, 0
  top-level-compressed, 0 truncated.
- `data/walldef-geometry.json` — all entries confirmed multiples of 156.
- `textures/walldef-<id>-wall<n>-view6.png` — 60 scheme-1 renders (0
  skipped).
- `textures/walldef2-<id>-wall<n>-view6.png` — 60 scheme-2 renders (0
  skipped).
- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 41 decoded GEO levels; wallset-binding data
  currently resolves only 1/41 levels pending the opcode-table fix above
  being integrated and re-verified, so the walker for this title falls back
  to the standard per-level placeholder for effectively every level today.

## 6. Full file catalog — not attempted this pass

Per this task's scope, the remaining `.GLB`/`.TLB` files' semantic content
(items, monsters, sprites, portraits, dungeon commands, strings, sounds) is
NOT catalogued — only the outer GLIB container structure is validated (§1).
See `docs/treasureofthesavagefrontier/TODO.md`.

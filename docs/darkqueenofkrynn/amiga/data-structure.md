# The Dark Queen of Krynn (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1992. The third and final title in the
Krynn/Dragonlance Gold Box trilogy (Champions of Krynn and Death Knights of
Krynn — both `.dax`-format, a different agent's scope — come first). Real
title confirmed from the WHDLoad rip's own `ReadMe`: "The Dark Queen of
Krynn".

Container format: **`docs/goldbox-glib-format.md`** (shared by every GLIB
title — read that doc first; this page covers only what's specific to this
title, including a real container-level discovery this title's own corpus
surfaced). Implementation: `tools/shared/goldbox-glib.ts` (container),
`tools/shared/goldbox-glib-codecs.ts` (`loadGlibFile`), `tools/shared/
goldbox-geo.ts` (GEO decoder). Extractor:
`tools/darkqueenofkrynn/amiga/export-data.ts`. Session history and open
items: `docs/darkqueenofkrynn/TODO.md`.

Raw data: `data/ssi/DarkQueenOfKrynn/data/Disk1`, `.../Disk2`, `.../Disk3`
(a WHDLoad-staged install; `.Slave`/`.info` files and `Docs/`/`Journal`/
`ReadMe`/`Solution` content are out of scope per this pass's task).

---

## 1. Container — CONFIRMED, 23/23 real GLIB files, 6 of them TOP-LEVEL COMPRESSED

All 23 `.TLB`/`.GLB` files across the 3 disks parse as the same "GLIB"
container documented in `docs/goldbox-glib-format.md` §1-§2, with **zero**
truncated/corrupted entries (`container-directory.json`'s
`structurallyOk: 23`). This retroactively confirms the container/codec is
identical across all six GLIB-family titles now staged in this repo.

**New finding for this title**: 6 of its own top-level files (`ALWAYS.TLB`,
`COMSPR.TLB`, `TOPVIEW.TLB`, `GEN.TLB`, `CBODY.TLB`, `FRAME.TLB`) are
themselves compressed at the OUTERMOST level — every prior GLIB title in
this corpus only ever showed `flags >> 8` compression on NESTED
sub-containers, never on a freshly-read top-level file. `loadGlibFile()`
(`tools/shared/goldbox-glib-codecs.ts`) checks a top-level file's own
compression method before parsing and decompresses first when it's nonzero,
handling this transparently — `container-directory.json` reports
`6 top-level-compressed` for this title, `0` for every sibling checked
before this pass.

This finding **retroactively re-explains a standing "truncated/corrupted
floppy dump" diagnosis** against 7 files across the Curse/Secret/Pools
corpus (`docs/goldbox-glib-format.md` §3's correction block): those files
were never damaged, they were compressed top-level files nobody had tried
decompressing before parsing. Re-running Secret's and Pools' own extractors
after the `loadGlibFile` fix reports `2` and `5` "top-level-compressed"
files respectively (matching that table's 7-file total exactly), 0
truncated, with all downstream numbers unchanged from before the fix (the
files' actual content was never touched by prior extractors — they simply
never emitted GEO/wall data derived from them, since none of those 7 files
happen to be `GEO.GLB`/`ECL.GLB`/`WALLDEF.GLB`).

## 2. `GEO.GLB` — variable-size record shape, CONFIRMED 20/20 zero deviation

`Disk3/GEO.GLB` holds 20 levels, but — unlike every sibling title's fixed
1024-byte/16x16 record — **this title's records vary in size**. Byte-length
sweeps against the fixed 1024-byte shape failed for every entry; the real
shape (found by inspecting the leading bytes for a plausible dimension pair)
is:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `width` (u8) |
| 1 | 1 | `height` (u8) |
| 2 | 6 | reserved (always `0` in this corpus) |
| 8 | `width*height` | Plane 0 (wall-art type, N/E) |
| 8+`w*h` | `width*height` | Plane 1 (wall-art type, S/W) |
| 8+2`w*h` | `width*height` | Plane 2 (special/roof) |
| 8+3`w*h` | `width*height` | Plane 3 (wall/door/passability code) |

Confirmed **20/20 zero deviation**: every record satisfies
`8 + 4*width*height === payload.length` exactly, with observed dimensions
ranging from small (city blocks) to as large as 24x20 (real dungeon
levels) — no fixed 16x16 assumption anywhere in this title's data. Plane
semantics/order are unchanged from the fixed-size format (same 2-bit
N/E/S/W wall-type nibbles, same door/passability code in plane 3) — verified
via the same cross-cell wall-presence self-consistency oracle used
corpus-wide: **98.8%/82.4%** horizontal/vertical agreement, comparable to
every sibling title's confirmed grid, and strong evidence the bit-packing
transfers unchanged despite the new variable header.

Implementation: `decodeGeoLevel()` (`tools/shared/goldbox-geo.ts`)
auto-detects fixed-vs-variable by checking `payload.length ===
GEO_RECORD_SIZE` (1024) first, falling back to `decodeVariableGeoRecord()`
otherwise — every sibling title's own extractor call is unaffected by this
addition.

## 3. `WALLDEF`/wall-art format — CONFIRMED ABSENT (see the two corrections below for the full history — an intermediate pass wrongly reopened this, then a disassembly pass closed it definitively)

> **Correction (2026-09-01, personal re-verification before commit):** this
> section originally claimed "CONFIRMED ABSENT" on the strength of a `find
> -iname '*wall*'` search turning up nothing, and concluded `ECL.GLB` had
> "nothing to bind against" so wasn't worth decoding. Both claims are
> **wrong**. `Disk2/8X8DB.TLB`/`8X8DC.TLB` (missed by the `*wall*` filename
> search — they don't have "wall" in the name) are real GLIB containers
> whose data blocks are nested `TILE`-tagged sub-containers, structurally
> identical to the `8x8d.dax`/`8X8D1.DAX`-style raw tile-pixel banks used
> for wall art in every other title in this corpus (PoR, Champions of
> Krynn, Death Knights of Krynn). And running `findWallsetBindings()`
> (`tools/shared/goldbox-ecl.ts`) against `Disk3/ECL.GLB` directly — which
> this pass never actually tried — resolves real, non-degenerate `LOAD
> PIECES` calls with 0 unknown opcodes (e.g. block ids 26/28 -> `slot1:
> 458`, block ids 38/41/43 -> `slot1: 492`, block ids 58/59 -> `slot1:
> 441`). There plainly IS something for ECL to bind against.
>
> What's still genuinely unresolved: no `WALLDEF`-shaped compositing table
> (a flat array of small fixed-size wall-geometry records, the way every
> other GLIB title's `WALLDEF.GLB` works) was found under any of this
> title's other TLB names — `CBODY.TLB` (character body sprite pairs, ids
> 1-48 mirrored at +128, not wall-shaped), `FRAME.TLB`, `GEN.TLB`, and
> `FINAL.TLB` were all checked and none has a record shape resembling
> WALLDEF's per-wallset-block layout. The resolved ECL slot ids (441/458/
> 492) are also far larger than the `8X8DB`/`8X8DC` block id range (1-17),
> so they aren't raw tile indices either — they most likely index a
> WALLDEF-equivalent table this pass hasn't located, OR (can't yet rule
> out) opcode `0x37` "LOAD PIECES" is genuinely repurposed in this title's
> engine revision for a different composited-graphics subsystem (portraits/
> location pictures) that happens to share the same generic VM opcode,
> given this title's much larger location-picture asset family (`PICA/B/C.
> TLB`, `BIGPIC.TLB`) and its variable-size, city/wilderness-shaped GEO
> grids (§2). **Genuinely open, not confirmed either way** — see
> `docs/darkqueenofkrynn/TODO.md`.
>
> The GEO-grid/PICTURE-opcode/variable-size-map circumstantial evidence
> originally cited below may still turn out to be right that this title
> leans on static location pictures more than composited wall textures —
> that structural observation isn't retracted — but it no longer supports
> "there is no wall-art format," since real tile-pixel data and real
> resolved wallset-binding calls both exist.

> **Second correction (2026-09-01, `amiga-disasm` pass against `data/ssi/
> DarkQueenOfKrynn/data/The Dark Queen of Krynn`, the title's own executable
> — this SUPERSEDES the previous correction's "genuinely open" framing with
> a definitive negative):** the `findWallsetBindings()` hits cited above
> (441/458/492) are **not real wallset bindings — they're a misparse**.
> Direct disassembly of both this executable's ECL VM dispatch tables
> (operand-count table at CODE+0x13e64/guard CODE+0x13ee8; the real
> per-opcode handler table at CODE+0x25b34/guard CODE+0x25bb8, 66 opcodes
> `0x00`-`0x41`) confirms **opcode `0x37` takes 2 operands in this engine
> revision, not 3** — its handler (CODE+0x158f4) walks a linked list
> testing a flag bit, then tail-calls a generic "set VM global by slot
> number" dispatcher (CODE+0x13186). This is an NPC/location
> search-and-flag opcode (structurally the same kind of correction Pools of
> Darkness's own v1.3 table needed for its own opcode `0x37`), not `LOAD
> PIECES` — so parsing this title's ECL bytecode with the standard v1.1
> 3-operand table for opcode `0x37` silently over-reads one operand group
> from the following instruction. That the resulting walk still reported
> "0 unknown opcodes" was a coincidental clean re-sync, not evidence the
> parse was correct — the 441/458/492 values are misparsed byte garbage,
> not real slot ids. (No degenerate/repeated value tipped this off the way
> `uniform-degenerate-hit-value-signals-wrong-decode-config.md` describes;
> the wrong-table hits here were varied-but-wrong, a related but distinct
> trap worth flagging for future passes.)
>
> A second, independent trace (of a 3-input `0xFF`-sentinel loader at
> CODE+0x4206a that builds `"8x8d%c%d"` filenames — initially mistaken for
> a real `LoadWalldef(slot,id)` equivalent, since it consumes the SAME
> `8X8DB`/`8X8DC` tile banks and the same "don't touch this slot" sentinel
> convention every sibling title's real wallset loader uses) was also
> refuted: its 3 inputs are proven (via `MapDirectionXDelta`/`YDelta`-style
> tables at CODE+0x3277e-0x32820, added with wraparound against the live
> GEO record's own `width`/`height` header fields at `-0x108c(a4)`) to be
> the party's **(facing direction, X, Y) map position**, not 3 wallset
> slots — this function is a **topview/overhead map-glyph redraw around the
> party's current position**, not a first-person wall-texture compositor.
> Its loader (CODE+0x42a3c) has exactly 3 call sites, all from inside
> CODE+0x4206a itself (exhaustive JSR/BSR/A4-trampoline scan) — a clean,
> single-consumer negative, ruling out a second, still-undiscovered
> first-person caller of the same tile banks.
>
> A third check this pass ran (per the original task brief, "check whether
> `ECL.GLB`'s own directory has extra non-script blocks"): `Disk3/ECL.GLB`
> has 47 data blocks (ids `1-67`, sparse) against `Disk3/GEO.GLB`'s 20
> level ids (`2,4,10,14,18,22,26,30,34,38,42,46,47,50,54,58,62,63,66`) — a
> superset, same "extra ECL blocks are non-dungeon (town/combat/story)
> scripts" pattern every sibling title already shows, confirmed by id-set
> containment alone (every GEO level id present in ECL's id list). No
> separate non-script/compositing-table block type exists in this
> container — the directory holds nothing but ordinary script blocks.
>
> **Final verdict**: no `WALLDEF`-equivalent (a real per-level 3-slot
> first-person wall-texture binding, wherever it might live) was found
> anywhere in this executable after tracing its ECL opcode dispatch tables,
> the one function that looked most like a slot loader, and that function's
> own complete caller list — nor in any of this title's data files (§0
> "container" survey), nor as a hidden block type inside `ECL.GLB`. This
> is now a well-evidenced (not merely un-searched-for) negative: **The Dark
> Queen of Krynn's Amiga engine has no first-person wall-art compositing
> mechanism**, and instead renders dungeon/location display through its
> overhead/topview picture system (`TOPVIEW.TLB`, built from the same
> `8X8DB`/`8X8DC` glyph banks) and its static `PICA`/`PICB`/`PICC`/
> `BIGPIC` location-picture banks (via the `PICTURE` opcode `0x0e`) — the
> original (pre-first-correction) structural hypothesis was right, just
> under-evidenced at the time. Confidence: moderate-high (full coverage of
> every function in a 343KB CODE hunk was not attempted, so a residual
> chance of a not-yet-found third mechanism remains, but two independent,
> plausible-looking candidates were both traced to conclusive negatives).
> `walldefPath`/`eclPath` remain correctly omitted from this title's
> extractor config — no code change needed. See
> `docs/darkqueenofkrynn/TODO.md` (item closed this pass).

The original (superseded) reasoning, kept for reference: this title ships
`PICA.TLB`, `PICB.TLB`, `PICC.TLB`, `BIGPIC.TLB`, `FRAME.TLB`, `TOPVIEW.TLB`
(location-picture banks + a border-frame asset + an overhead/topview
picture bank), plus a dedicated `PICTURE` ECL opcode (`0x0e`, present in
this title's opcode table per the decompiled DOS source already trusted for
the sibling titles' ECL work) — cited as evidence this engine revision
might render location display via static per-location pictures rather than
composited first-person wall textures.

Consequently `walldefPath` is currently omitted from this title's extractor
config, and `ECL.GLB` is not yet wired into the extraction pipeline for
wallset-binding purposes — a real gap to close in a follow-up pass, not a
structural non-issue. GEO connectivity/doors still decode fully and drive
the walker's movement/minimap exactly like every sibling title; first-person
wall-texture rendering is unavailable FOR NOW, and the walker's existing "no
rendered wall texture" placeholder (a flat tinted rectangle, the same
fallback used for any level with an empty `wall-index.json`) covers this
gracefully with zero code changes in the meantime.

## 4. Extractor and outputs

Run from the repo root:

```
npx tsx tools/darkqueenofkrynn/amiga/export-data.ts
```

(defaults to `data/ssi/DarkQueenOfKrynn/data`). Writes to
`public/assets/darkqueenofkrynn/amiga/`:

- `data/container-directory.json` — 23/23 GLIB files structurally OK (6
  top-level-compressed), 0 truncated.
- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 20 decoded GEO levels (§2), an empty wall
  index (0 entries — NOT confirmed correct, see §3's correction: ECL/tile
  decoding for this title simply isn't wired into the extractor yet).

No `textures/` PNGs are produced for this title (0 wall textures — a real
gap, not a confirmed-correct absence; see §3). `manifest.json` carries the
container-directory data record only; the `dungeon/` outputs are consumed
directly by the walker.

## 5. Full file catalog — not attempted this pass

Per this task's scope, the remaining files' semantic content (items,
monsters, sprites, the PIC/FRAME/TOPVIEW picture banks themselves, dungeon
commands, strings, sounds) is NOT catalogued — only the outer GLIB container
structure is validated (§1) and GEO is decoded (§2). See
`docs/darkqueenofkrynn/TODO.md`.

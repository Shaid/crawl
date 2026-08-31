# Curse of the Azure Bonds (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1989. Second of four sibling Gold Box titles
staged in this repo (Pool of Radiance is the first and only one previously
opened — `docs/poolofradiance/amiga/data-structure.md`; Secret of the Silver
Blades and Pools of Darkness are the other two siblings opened in this same
pass — `docs/secretofthesilverblades/amiga/data-structure.md`,
`docs/poolsofdarkness/amiga/data-structure.md`).

Container format: **`docs/goldbox-glib-format.md`** (shared by all three
sibling titles — read that doc first; this page only covers what's specific
to Curse). Implementation: `tools/shared/goldbox-glib.ts` (container),
`tools/shared/goldbox-walltiles.ts` (wall-slice geometry + tile decode).
Extractor: `tools/curseoftheazurebonds/amiga/export-data.ts`. Session
history and open items: `docs/curseoftheazurebonds/TODO.md`.

Raw data: `data/curseoftheazurebonds/amiga/DISKA/`, `.../DISKB/`, plus a
`SAVE/` directory (save games, out of scope) and the two disks' own
executables (`Curse`, an AmigaOS loadseg()able binary — not opened this
pass).

---

## 0. Container/codec CONFIRMED DIFFERENT from Pool of Radiance's `.dax`

Every file in `data/curseoftheazurebonds/amiga/DISKA/` and `DISKB/` uses the
same base filenames as Pool of Radiance's `.dax` files, but with `.TLB`
("tile library") or `.GLB` ("global") extensions instead:
`WALLDEF.GLB`, `8X8D.TLB`, `ALWAYS.TLB`, `COMSPR.TLB`, `BIGPIC.TLB`,
`BODY.TLB`, `CBODY.TLB`, `CHEAD.TLB`, `CPIC.TLB`, `DUNGCOM.TLB`, `ECL.GLB`,
`GEO.GLB`, `HEAD.TLB`, `ITEM.GLB`, `MONCHA.GLB`, `MONITM.GLB`, `MONSPC.GLB`,
`PIC.TLB`, `RANDCOM.TLB`, `SKY.TLB`, `SOUNDS.GLB`, `SPRIT.TLB`, `STRINGS.GLB`,
`TILES.TLB`, `TITLE.TLB`, `WILDCOM.TLB`, plus a loose `ITEMS.DAT`.

**This is a genuinely different container AND codec from PoR's `.dax`** —
checked directly against real bytes (see `docs/goldbox-glib-format.md` §0 for
the full comparison table). Headline finding: **no compression at all**.
Every payload in this corpus is raw, uncompressed bytes — confirmed by
exact-multiple-of-known-stride byte-length checks (§2 below), not assumed.
PoR's own backward-reading LZ77 codec (`tools/poolofradiance/amiga/dax.ts`)
does not apply here and was not needed.

## 1. "GLIB" container — CONFIRMED, 27/27 real `.GLB`/`.TLB` files

See `docs/goldbox-glib-format.md` §1-§2 for the full container/directory
layout. All 27 `.GLB`/`.TLB` files across both of Curse's disks chain with
zero deviation (`container-directory.json`'s `structurallyOk: 27` field,
`totalGlibFiles: 27`) — **no truncated/corrupted files in this title's own
corpus** (unlike Secret and Pools, both of which have some — see
`docs/goldbox-glib-format.md` §3).

Non-`GLIB` files, confirmed by magic-byte inspection (out of scope, listed
for completeness): `CURSE.FON` (raw font, no header), `CURSE.SLB` (magic
`"SLBR"` — a title-library/music format, not opened), `ITEMS.DAT` (a flat
record table, no container header, not opened).

## 2. `WALLDEF.GLB` — 156-byte wall-slice geometry CONFIRMED, byte-for-byte identical to Pool of Radiance's `walldef.dax`

`DISKB/WALLDEF.GLB` — 17 blocks total (1 index block + 16 real wall-type
data blocks). Every one of the 16 real entries' RAW (uncompressed — see §0)
byte length is an **exact multiple of 156 bytes**, zero remainder, matching
Pool of Radiance's `WALL_SLICE_SIZE` and its 10-view sub-array layout
(`VIEW_OFFSET`/`VIEW_COLS`/`VIEW_ROWS` in
`tools/poolofradiance/amiga/walldef.ts`, reused here unmodified via
`tools/shared/goldbox-walltiles.ts`):

| id | byte length | slice count |
|---|---|---|
| 1-13, 16 | 780 | 5 |
| 14, 17 | 1,560 | 10 |

(`docs/curseoftheazurebonds/TODO.md`'s companion `walldef-geometry.json`
output has the full per-id table — 16/16 entries pass the multiple-of-156
check with zero deviation.)

The index block's own `(id, blockIndex)` pairs give ids `1-14, 16, 17` —
sparse (skips 15) and exactly matching PoR's own `walldef.dax` id-space
shape (PoR's ids ran `0-9, 17-21, 23, 24`, a similarly sparse small-integer
range in the same general magnitude).

## 3. `8X8D.TLB` — TWO DISTINCT tile-bank organizations exist in this corpus

Curse ships **two different files both named `8X8D.TLB`**, one per disk,
with genuinely different internal schemes:

### 3a. `DISKA/8X8D.TLB` — the "flat universal+specific" scheme (CONFIRMED, rendered)

Outer container: `flags=1` (has index), tag `"HLIB"`, 3 blocks (1 index + 2
data). Index: `{id: 202, blockIndex: 1}, {id: 203, blockIndex: 2}` — a
simple 2-bucket scheme, NOT keyed by `WALLDEF.GLB`'s own wall-type ids.
Both id-202 and id-203 blocks are themselves nested `"TILE"`-tagged GLIB
sub-containers (tag `"HLIB"` at the outer level = "each block nests another
GLIB container", confirmed one level deep — see
`docs/goldbox-glib-format.md` §2).

Each nested `"TILE"` sub-container's OWN blocks are raw, header-less,
**exact multiples of 8 bytes** (40 = 5×8 for id 202's 20 sub-blocks; 48 = 6×8
for id 203's 45 sub-blocks — zero remainder on every sample checked), decoded
as 8-byte, 1-bit-per-pixel, MSB-first tiles — identical pixel format to Pool
of Radiance's `8x8d.dax`, **minus PoR's 4-byte per-block header** (PoR's own
dax-compressed blocks were always 4 bytes short of a clean multiple of 8;
GLIB's raw blocks need no such skip — a genuine, minor format divergence
from PoR, not a bug in either decoder). Total flat bank: 1 grey placeholder +
270 universal (id 203) tiles + 100 specific (id 202) tiles = **371 tiles**.

**Rendered evidence**: applying this flat bank to `DISKB/WALLDEF.GLB`'s own
real wall-slice tile-index grids (§2) produces 90 non-degenerate PNGs in
`public/assets/curseoftheazurebonds/amiga/textures/` — every one of the 16
wall ids' tile indices (max observed: 185) falls inside this 371-tile bank
with **zero out-of-range indices**. Several renders show clear, non-random
structure matching Pool of Radiance's own established visual grammar for
this exact composited-render mechanism:

- `walldef-16-wall0-view6.png`: a symmetric checkerboard/diagonal feature —
  visually similar in character to PoR's own door/torch-recess composite
  (`walldef-0-wall0-view6.png` in the PoR corpus).
- `walldef-1-wall0-view6.png`: a bordered corridor-void pattern.

**Caveat on confidence**: `DISKA/8X8D.TLB` is NOT the file `DISKB/
WALLDEF.GLB` is paired with by the real game at runtime (it lives on the
OTHER disk, alongside `ALWAYS.TLB`/`SKY.TLB`/other likely-overland-specific
assets, not alongside `WALLDEF.GLB`/`DUNGCOM.TLB`/the other dungeon-specific
files on DISKB). The render above is real, non-degenerate evidence that (a)
the 8x8 tile PIXEL FORMAT and (b) the wall-slice VIEW-GEOMETRY compositor
mechanism both transfer correctly from Pool of Radiance — but it is **not**
confirmed to be exactly what a given wall id looks like in the real game,
since the specific tile source is a plausible-but-unconfirmed substitute.
Labeled **rendered, not confirmed**, same confidence tier as PoR's own
`8x8d.dax` pixel-format finding.

### 3b. `DISKB/8X8D.TLB` — the per-wall-id nested scheme (SOLVED — the payload is compressed)

> **Correction (2026-08-30, `re-codebreaker`):** the two hypotheses recorded
> below were both defeated by one wrong shared premise — that a nested
> sub-container's bytes on disk *are* its container image. They are not.
> **The nested payload is compressed**, and the "boilerplate" 16-byte header
> is genuine, correct and read by the game: it describes the container
> *after* decompression, which is why one file's entries all declare the
> same `totalSize`/`blockCount` (every wall bank in a given game has the
> same decompressed shape) and why that size exceeds several entries'
> on-disk allocation (compression ratios here run 1.8x-3.5x). The
> compression method is the **high byte of the `flags` word** — the very
> field §1 previously recorded as "varies corpus-wide with no confirmed
> meaning". Full spec: `docs/goldbox-glib-format.md` §5; implementation:
> `tools/shared/goldbox-glib-codecs.ts` (`decompressGlibBlock`).
>
> For this file every entry is method **3** (10-bit LZW). Decompressing
> first and then applying `parseGlibContainer` unchanged yields, for all 18
> entries, a textbook GLIB body — `offsets[0] == 16 + 4*(blockCount+1)`,
> `offsets[70] == 3660`, monotonic, and **every** one of the 70 blocks
> exactly 48 bytes = 6 raw 8-byte 1bpp tiles, zero remainder. Wall id 1's
> view grids render as a clean, regular, repeating decorative wall pattern
> (see "Verification" in `goldbox-glib-format.md` §5) — decisively unlike
> the salt-and-pepper noise the refuted N=16 hypothesis produced.
>
> One downstream question is now open in its place: whether the walldef
> tile byte indexes a single 8x8 tile or a whole 48-byte block — see
> `docs/curseoftheazurebonds/TODO.md` (`caob-tile-bank-index-unit`).

> **Update (2026-08-30, same session): wired into the extractor and
> rendered — 90/90 wall-view PNGs, using this file (not §3a's cross-disk
> substitute).** `decodeGlibTileBucket` (`goldbox-walltiles.ts`) makes
> `buildFlatTileBank` compression-aware for free; a new
> `buildWallSpecificTileBank` + `resolveCompositeWallId` pair composes
> `[placeholder, ...universal(id 203, from DISKA), ...specific(this wall's
> own id, from DISKB, decompressed)]` — the same 3-part structure Pool of
> Radiance's own `buildTileBank` already uses. Written as
> `public/assets/curseoftheazurebonds/amiga/textures/walldef2-<id>-wall<n>-
> view6.png`, alongside (not replacing) §3a's original `walldef-*` renders.
>
> **A real integration bug was caught and fixed along the way**: the naive
> reading of the composite-id arithmetic (one composite id per raw wall
> *slice*) is wrong. A composite id covers a fixed run of **5** slices (one
> wallset), not one slice each — confirmed by requiring every WALLDEF entry
> to resolve with **zero** "no scheme-2 entry" misses, which only holds once
> (a) the WALLDEF id is tried directly FIRST (covering single-wallset ids,
> and generalizing cleanly to Pools of Darkness's own direct-1:1
> simplification — see its own data-structure.md §2/§3) and (b) the
> fallback composite id is computed from `wallsetIndex = floor(wallNumber /
> 5)`, not `wallNumber` itself. 90/90 entries now resolve with 0 skips (0
> "no entry", 0 "index out of range"); 90/90 are non-degenerate (not
> all-placeholder) by a flat pixel-value check, and `walldef2-1-wall0-
> view6.png` shows clear, structured horizontal-band + doorway-style
> content, not noise. See `tools/shared/goldbox-glib-export.ts`'s
> `SLICES_PER_WALLSET` constant for the derivation.

The original (now superseded) write-up follows.

### 3b-old. `DISKB/8X8D.TLB` — the per-wall-id nested scheme (structurally confirmed, PIXEL LAYOUT UNRESOLVED — open)

`DISKB/8X8D.TLB` (co-located with `WALLDEF.GLB`) uses a completely
different, and clearly semantically-intended, organization: its index block
gives ids `1-13, 16, 141, 142, 171, 172` — an **exact match** to
`WALLDEF.GLB`'s own wall ids (`1-13, 16` direct; `14`/`17` need 2 wallsets
each, matching their 10-slice/1560-byte entries in §2) via Pool of
Radiance's own confirmed **`10*id + n` multi-wallset composite-id
arithmetic** (id 14 → 141/142; id 17 → 171/172 — the identical formula PoR
used for its own ids 0/21/24). This id-arithmetic match, independently
confirmed by comparing the two files' index tables byte-for-byte, is a
strong structural signal this scheme (not 3a's) is the real intended tile
source for the dungeon wall renderer.

**However, the exact per-entry byte layout inside this scheme's nested
sub-containers is NOT solved this pass.** Every one of the 18 nested
sub-containers' own header (`totalSize`, `blockCount`) is byte-identical —
`totalSize=3660, blockCount=70` for EVERY entry, regardless of the outer
directory's own (varying, 1490-5017 byte) allocated span for that entry.
This "boilerplate" header cannot be a real per-entry offset table (following
its own declared `blockCount=70` implies an offset table that reads as
non-monotonic garbage — see paths-tried below) — it is some kind of shared
template value whose real meaning is unresolved.

**Paths tried (both refuted with concrete evidence):**

| Approach | Result | Why it failed |
|---|---|---|
| Treat the 16-byte "GLIB/totalSize/blockCount/flags/TILE" header at face value as a self-describing nested container (per `parseGlibContainer`) | Nested container's own declared `totalSize` (3660 B) exceeds the OUTER directory's allocated span (as little as 1490 B) for the same entry; identical `totalSize`/`blockCount` values repeat verbatim across all 18 entries despite differing outer gaps | Internally inconsistent — a real per-entry directory would not declare more bytes than its own container allocates, nor would 18 independent wall types share one byte-identical declared size |
| Skip a fixed N-byte "boilerplate" header (tried N = 0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 96, 128, 160, 200, 256, 300) and read the REMAINDER as raw, contiguous 8-byte tiles | At N=16, every wall id's resulting tile-index range fits cleanly inside the resulting bank size (no out-of-range indices — see e.g. wall id 1: max index 112 < bank size 203) | Despite the sane INDEX RANGE, the rendered pixels are visual noise (a "salt and pepper" scatter with only a partial crenellation-like top border), not a coherent brick/wall texture — confirmed by rendering wall ids 1, 5, 13 at several N values and comparing against the CONFIRMED-clean §3a renders. A correct byte alignment should look at least as structured as those; none of the 18 tested N values do. |

| Escalated to `re-codebreaker` 2026-08-30 | **SOLVED** — the payload is compressed; `flags >> 8` is the method id; method 3 = 10-bit LZW, method 5 = byte-oriented LZ77, both traced in the games' own 68000 loaders | See the Correction block at the top of §3b and `docs/goldbox-glib-format.md` §5 |

**Both original hypotheses shared one wrong premise** — "the bytes at a
nested sub-container's start are its container image". Neither could
succeed: no fixed-offset skip and no re-read of the on-disk offset table can
work when the table itself only exists after decompression. The lesson
`identical-nested-header-across-varying-allocations-is-inert-boilerplate.md`
(written from the failed pass) is **wrong and should be superseded**: an
identical nested header across varying outer allocations is not inert
boilerplate, it is a correct header describing a *decompressed* image, and
the right next move is to look for a compression-method field in the
header's own already-parsed-but-unexplained bits.

## 4. Full file catalog — not attempted this pass

Per this task's explicit scope (container+codec confirmation and the
wall-renderer question), the remaining `.GLB`/`.TLB` files' semantic content
(items, monsters, sprites, portraits, dungeon commands, strings, sounds) is
NOT catalogued — only their outer GLIB container structure is validated
(§1). See `docs/curseoftheazurebonds/TODO.md`.

## 5. `GEO.GLB` — the dungeon/city 16x16 square grid (the maze data)

**CONFIRMED for wall/door connectivity, OPEN for wall-art selection.** 16
levels, each a 1024-byte record (four 256-byte planes over a 16x16 grid).
Plane 3 is a confirmed 2-bit-per-direction (N/E/S/W) wall/door/other code,
verified via a cross-title shared-wall self-consistency oracle at
90.8%/91.6% (horizontal/vertical agreement) on this title specifically —
vastly above every wrong bit-permutation tried. Planes 0/1 (candidate
wall-art selectors) remain open, escalated to `re-oracle`. Full writeup and
cross-title verification table: `docs/goldbox-glib-format.md` §7 (this
format is shared byte-for-byte with Pool of Radiance's `geo.dax` and the
other two GLIB titles, so it's documented there rather than four times).
Implementation: `tools/shared/goldbox-geo.ts`; extractor wiring:
`tools/shared/goldbox-glib-export.ts`'s `geoPath` option (this title passes
`DISKB/GEO.GLB`). See `docs/curseoftheazurebonds/TODO.md`.

> **Correction (2026-08-31, `re-oracle` escalation):** planes 0/1 are now
> CONFIRMED (wall-art TYPE per direction, 0-15, indexing a level-scoped
> ECL-loaded wallset table) and plane 3's value labels were corrected
> (0=solid/blocked, 1=passable, 2/3=locked door — the original 0=open/
> 1=wall/2=door guess had the right bit layout but backwards meanings). See
> `docs/goldbox-glib-format.md` §7.2's correction block for the full
> source-cited derivation.

## 6. Extractor and outputs

Run from the repo root:

```
npx tsx tools/curseoftheazurebonds/amiga/export-data.ts data/curseoftheazurebonds/amiga
```

Writes to `public/assets/curseoftheazurebonds/amiga/`:

- `data/container-directory.json` — every `.GLB`/`.TLB` file's GLIB header
  fields + structural-OK/truncated status (27/27 OK, 0 truncated).
- `data/walldef-geometry.json` — `WALLDEF.GLB`'s per-id byte length + slice
  count, all confirmed multiples of 156 (16/16).
- `textures/walldef-<id>-wall<n>-view6.png` — 90 composited wall-view
  renders using §3a's confirmed 8x8-tile flat bank (view 6 = the 8×7 "front
  face", same view PoR's own extractor renders).
- `textures/walldef2-<id>-wall<n>-view6.png` — 90 composited wall-view
  renders using §3b's now-decodable per-wall-id scheme, the pairing WALLDEF
  is actually keyed to at runtime (0 skips: every entry resolves). Higher
  confidence than the `walldef-*` set above, though still RENDERED not
  CONFIRMED pending §3b's own open tile/block index-unit question.

- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 16 decoded GEO levels (§5) + the level list and
  wall-texture index the walker (`tools/walker/games-goldbox.ts`) loads.

`manifest.json` carries 182 entries (180 texture PNGs + 2 data JSON
records) after a clean rebuild; the `dungeon/` outputs are consumed
directly by the walker and are not part of `manifest.json`.

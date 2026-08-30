# Curse of the Azure Bonds — open work

Single status surface for this game (Amiga only). See
`docs/curseoftheazurebonds/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Second of four sibling Gold Box titles staged in this repo. Pool of Radiance
(first, `.dax` format) was opened in an earlier pass. This pass opened Curse,
Secret of the Silver Blades, and Pools of Darkness together, confirming they
all share one container format ("GLIB") different from PoR's `.dax`.

## 2026-08-30 — GLIB container confirmed; wall-slice geometry confirmed; tile-bank pixel layout partially open

- "GLIB" container format **CONFIRMED**, shared with Secret and Pools, and
  confirmed DIFFERENT from Pool of Radiance's `.dax` (no compression at
  all; a cumulative-offset directory instead of per-entry length fields —
  `docs/goldbox-glib-format.md` §0-§1). 27/27 real `.GLB`/`.TLB` files in
  this title's own corpus chain with zero deviation, 0 truncated.
- `WALLDEF.GLB`'s 156-byte wall-slice / 10-view-sub-array geometry
  **CONFIRMED** byte-for-byte identical to Pool of Radiance's `walldef.dax`
  — 16/16 real entries are exact multiples of 156 bytes
  (`amiga/data-structure.md` §2).
- The 8x8 tile pixel format (1bpp MSB-first, 8 bytes/tile, no header) is
  **CONFIRMED** via a "flat universal+specific" tile-bank scheme found on
  `DISKA/8X8D.TLB`, with real visual render evidence (90 PNGs,
  non-degenerate, matching PoR's own established visual grammar —
  `amiga/data-structure.md` §3a).
- A SECOND, per-wall-id nested tile-bank scheme (`DISKB/8X8D.TLB`,
  co-located with `WALLDEF.GLB`) is structurally confirmed to be the
  semantically-intended pairing — its ids match `WALLDEF.GLB`'s own ids
  exactly, including Pool of Radiance's `10*id+n` multi-wallset composite
  arithmetic. Its byte layout is now **SOLVED** (2026-08-30,
  `re-codebreaker`): the nested payload is compressed, `flags >> 8` selects
  the codec, and after decompression it is an ordinary GLIB body of raw
  8-byte 1bpp tiles. See `docs/goldbox-glib-format.md` §5 and the Correction
  block in `amiga/data-structure.md` §3b.

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Assume Pool of Radiance's `.dax` container/codec applies directly (per the task's core hypothesis to test) | Refuted immediately — different magic (`"GLIB"` vs a bare `headerSize` word), different directory shape, no compression | Real, useful negative — answers the task's central question. See `docs/goldbox-glib-format.md` §0. |
| Treat `DISKB/8X8D.TLB`'s per-wall-id nested sub-containers as self-describing GLIB containers (trust their own `totalSize`/`blockCount` fields) | Declared `totalSize` (3,660 B, constant across all 18 entries) exceeds the outer directory's own allocated span for most entries | Internally inconsistent — see `amiga/data-structure.md` §3b table |
| Skip a fixed N-byte boilerplate header (18 values tried, 0-300) and read raw 8-byte tiles for the remainder | Index ranges become sane at N=16, but rendered pixels are visual noise, not coherent wall art, at every N tested | Confirmed via direct visual comparison against the working §3a renders |
| Escalated to `re-codebreaker` (2 distinct failed hypotheses across 3 independently-titled instances met the escalation bar) | **SOLVED 2026-08-30** — the nested payload is COMPRESSED; `flags >> 8` is the compression method id (0 stored / 3 = 10-bit LZW / 5 = byte LZ77), both codecs traced in the games' own 68000 loaders. The "boilerplate" header is genuine and describes the DECOMPRESSED container. | 326/326 nested sub-containers corpus-wide decode to exactly `totalSize-16` bytes with a self-consistent GLIB body; Secret's compressed id-202 bank is byte-identical (884/884) to Curse's uncompressed copy. `docs/goldbox-glib-format.md` §5; `tools/shared/goldbox-glib-codecs.ts` |

## 2026-08-30 (same day, follow-up) — scheme-2 tile bank wired into the extractor and rendered

- `decodeGlibTileBucket` (compression-aware), `resolveCompositeWallId`, and
  `buildWallSpecificTileBank` added to `tools/shared/goldbox-walltiles.ts`;
  wired into `tools/shared/goldbox-glib-export.ts` and this title's own
  extractor. 90/90 `WALLDEF.GLB` entries now render via the semantically-
  correct scheme-2 pairing (`walldef2-<id>-wall<n>-view6.png`), 0 skips.
  Independently re-verified the escalation's own codec claims against real
  bytes before integrating (329 nested `"TILE"` buckets corpus-wide, 0
  decode errors, cross-title id-202 byte match modulo the expected
  compression-method header-flag difference).
- Fixed a real bug found during integration: a composite id covers a run of
  5 raw wall slices (one wallset), not one slice each — see
  `docs/goldbox-glib-format.md` §5.7.
- `buildFlatTileBank`'s own compression bug (it called `parseGlibContainer`
  directly on possibly-compressed on-disk bytes) is fixed as a byproduct.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| caob-tile-bank-index-unit | open | Does a `WALLDEF.GLB` tile byte index one 8x8 tile or a whole 48-byte (6-tile) block? Block-count arithmetic (1+45+70*n) fits exactly for Curse; PoR's confirmed geometry says single tile | `docs/goldbox-glib-format.md` §5.6 | 2026-08-30 re-codebreaker |
| caob-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, sprites, portraits, dungeon commands, strings) not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-08-30 |

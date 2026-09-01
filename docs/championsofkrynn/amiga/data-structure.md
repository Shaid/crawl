# Champions of Krynn (Amiga) — data structure

Champions of Krynn is an SSI Gold Box title, same engine family as Pool of
Radiance / Curse of the Azure Bonds / Secret of the Silver Blades / Pools of
Darkness / Dark Queen of Krynn / Gateway & Treasures of the Savage Frontier
(see `docs/goldbox-glib-format.md` and `docs/poolofradiance/amiga/data-structure.md`
for the shared GEO/ECL background this doc builds on). The game ships **two**
campaign banks — bank 1 (`GEO1.DAX`/`ECL1.DAX`/`WALLDEF1.DAX`) and bank 2
(`GEO2.DAX`/`ECL2.DAX`/`WALLDEF2.DAX`).

## 1. Container — CONFIRMED, "DOS DaxFile", NOT Pool of Radiance's own `.dax`

Despite sharing the `.DAX` extension and base filenames (`GEO`, `ECL`,
`WALLDEF`, `ITEM`, `MON*`) with Pool of Radiance, this title's `.DAX` files
use a **completely different container and codec** — confirmed by
exhaustively brute-forcing every plausible directory layout against PoR's own
scheme (zero matches), then matching CodePlex/GitHub
`simeonpilgrim/goldboxexplorer`'s DOS-side `Common/Plugins/Dax/DaxFile.cs`
exactly. Full spec + verification: `tools/shared/goldbox-dosdax.ts`'s module
doc. Summary:

- 9-byte little-endian directory entries: `{id: u8, offset: i32 LE, rawSize:
  u16 LE, compressedSize: u16 LE}` — note field order is `rawSize` (decompressed
  length) THEN `compressedSize`, the opposite of PoR's own `.dax`.
- Codec: a PackBits-style byte-oriented RLE (signed lead byte: `>=0` copies
  `n+1` literal bytes, `<0` repeats one byte `-n` times) — NOT PoR's backward
  bit-level LZ77.
- **Verified**: 239/239 directory entries across every `.DAX` file in
  `data/ssi/ChampionsOfKrynn/data/` decompress to their exact declared
  `rawSize`, chain byte-exactly (`offset[n+1] == offset[n] + compressedSize[n]`),
  and the final entry's end equals the real file size — zero deviations.
- **Independently corroborated by disassembly** (a same-session `amiga-disasm`
  subagent, working with a from-scratch Python HUNK parser since IRA/radare2
  weren't actually installed in its sandbox): `data/ssi/ChampionsOfKrynn/data/game`
  hunk 11 (file offset 78,696) contains literal C strings `"WALLDEF"`, `".dax"`,
  `"Unable to load "`, `" from "`, `"GEO"`, `"Unable to load geo in
  Load3DMap."` — `Load3DMap` is the exact function name the GLIB-format doc's
  own `re-oracle` escalation already identified from the `simeonpilgrim/coab`
  DOS decompile, confirming direct code lineage, not just a filename
  coincidence. The agent independently re-derived the same 9-byte/LE/
  `id,offset,rawSize,compressedSize` field layout from raw bytes (it did not
  pin down the exact codec instruction sequence — this project's own
  externally-sourced GBE codec already produces zero-deviation byte-exact
  decompression across the whole corpus, so no `re-codebreaker` escalation
  was needed for the codec specifically).

## 2. GEO — CONFIRMED, unchanged from Pool of Radiance/GLIB

Every GEO entry decompresses to exactly 1026 bytes = a 2-byte prefix
(constant `0x0004`, same as PoR/GLIB corpus-wide) + the confirmed 1024-byte
4-plane 16x16 grid (`tools/shared/goldbox-geo.ts`'s `decodePorGeoEntry`,
reused with zero changes). Bank 1: 5 levels (GEO ids 32/34/48/49/50). Bank 2:
10 levels (64/66/67/68/80/81/82/96/97/99).

Level ids in this corpus's own asset output are namespaced
`bank*1000 + geoId` (e.g. bank 1 id 32 -> level id `1032`) so both banks'
levels coexist in one `dungeon/levels-index.json` — see
`tools/championsofkrynn/amiga/export-data.ts`.

## 3. WALLDEF wall-slice geometry — CONFIRMED

`WALLDEF1.DAX` (6 entries: ids 1/3/5/7/8/23) and `WALLDEF2.DAX` (9 entries:
19/21/10/11/23/13/14/15/17) both decompress to exact multiples of 156 bytes
(780 = 5 slices, or 1560 = 10 slices) — the confirmed corpus-wide wall-slice
size. `tools/poolofradiance/amiga/walldef.ts`'s `decodeWallSlices`/`renderView`
apply unchanged.

## 4. 8x8 tile pixel format — CONFIRMED for `8X8D1.DAX` AND for the
separate `8X8D0/1/2.DAA` files (SOLVED 2026-09-02, see correction below)

`8X8D1.DAX` is itself a DOS-DaxFile container (8 entries: 201/202/203/11/12/
31/32/23). Its tiles decode with the **headerless** GLIB-style convention
(`decode8x8Tiles`, 8 bytes/tile, MSB-first 1bpp) — NOT PoR's own 4-byte-
per-block-header convention (rawSizes don't share a uniform remainder mod 8
under any single header-length hypothesis 0-16, ruling that out structurally;
the headerless reading, by contrast, renders recognizable brick/stone wall
texture — see below).

Id 203 is the "universal" tile bucket (present corpus-wide in this engine
family); wall-specific tiles resolve via Pool of Radiance's own confirmed
`10*wallId + wallsetNumber` composite-id arithmetic
(`resolveCompositeWallId`/`buildWallSpecificTileBank`, reused unchanged),
falling back to the wall id directly when no composite entry exists (wall id
23's own case — matches the direct-id fallback GLIB titles' scheme 2 also
uses).

**Visual confirmation** (RENDERED, cross-checked by eye — see
`public/assets/championsofkrynn/amiga/textures/walldef-1001-wall5-view6.png`):
a clean composited wall view showing a crenellation-style top border and a
door/torch-style feature, matching this corpus's own established Gold Box
wall-art visual grammar.

> **Correction (2026-09-01, `re-oracle` escalation + independent
> re-verification): the container is now CONFIRMED — the pixel payload
> remains OPEN, and is a genuinely different, more complex shape than the
> container-level fix might suggest.** The escalation found `8X8D0/1/2.DAA`
> use the SAME big-endian DaxFile sibling container as Death Knights of
> Krynn's `8x8d1.daa` (`readAmigaDaaDirectory`/`decodeAmigaDaaFile` in
> `tools/shared/goldbox-dosdax.ts` — BE fields, `dataOffset = headerLen`
> exactly). **Independently re-verified this session**: `8X8D0.DAA` and
> `8X8D1.DAA` (byte-identical, 25,916 B each) — 12/13 entries decode
> byte-exact (id 201's compressed block is genuinely all-zero bytes, a
> deliberately blanked stub, not a decode failure); `8X8D2.DAA`
> (28,734 B) — 13/13 entries decode byte-exact; both files' chains are
> contiguous and end exactly at EOF.
>
> **However, the inner 8x8-tile PIXEL payload does NOT match Death
> Knights' shape** (`tools/shared/goldbox-daa-tiles.ts`'s "9-byte header +
> 64-byte palette + planeCount x tileCount x 8 bytes" model): every
> Champions `.DAA` entry's own header `tileCount` field (offset 2, u16 BE)
> reads a uniform, implausible `1` regardless of the entry's real
> decompressed length (2249 B for most entries — far too large for "1
> tile"), so `(bodyLen - 64) / (tileCount*8)` doesn't divide evenly
> (272.0-ish, not an integer relationship that pins a plane count the way
> it does for every Death Knights entry). Each entry's putative "palette"
> region (bytes 9-73) IS non-zero for every entry here (unlike Death
> Knights, where only the universal id has real colours) — but whether
> that's really a palette, a different sub-header for a differently-shaped
> payload, or something else entirely, is not established. **This is a
> real but only PARTIAL advance**: the container/codec problem this title
> shared with Death Knights is solved, but Champions' own pixel payload is
> a distinct, still-open sub-problem — not a simple reapplication of the
> Death Knights model. See `docs/championsofkrynn/TODO.md`.
>
> **A related, unrelated-format confusion to flag and correct**: an
> earlier pass in this investigation chain characterized the *already-
> shipped* `walldef-1001-*.png` renders (below) as "wrong — produced by a
> 1bpp misreading of the `.DAA` files." That claim does not hold up: those
> renders come from `8X8D1.DAX` (the LE, DOS-DaxFile-container, 1bpp-tile
> format, confirmed independently of anything discussed in this section) —
> `tools/championsofkrynn/amiga/export-data.ts` never reads any `.DAA` file
> at all. The confusion was a same-basename collision (`8X8D1.DAX` vs.
> `8X8D1.DAA`), not a real bug in the shipped renders; they stand as
> originally confirmed below.

> **Correction (2026-09-02, this session): the pixel payload is now
> SOLVED, and so is the WALLDEF addressing model that consumes it — the
> "genuinely open sub-problem" framing above no longer applies.**
>
> **Pixel payload shape** — the "9-byte header + 64-byte palette +
> planeCount x tileCount x 8 bytes" Death Knights model was the wrong
> shape to apply here, not a close-but-broken guess. The fix: re-test
> the header's OTHER fields against the body-length divisibility oracle
> instead of assuming offset-2 (which reads a constant, uninformative `1`
> in every Champions entry — never the tile count, unlike Death Knights)
> was necessarily `tileCount` just because it plays that role in Death
> Knights' own header. The real tile count is the header's offset-8 BYTE
> field, and the body has **no embedded palette at all** — plane data
> starts immediately after the 9-byte header. `(bodyLen - 9) / (4*8)`
> (4 planes = 16-colour tiles) matches the header's offset-8 byte exactly
> for **24/25 real entries** across `8X8D0.DAA` (11/11) and `8X8D2.DAA`
> (13/13) — the sole exception, id 203, is off by exactly one (header
> says 45, body-length division says the real value is 46), the SAME
> class of single-entry off-by-one anomaly Death Knights' own id 202 has.
> This also fully explains the "every entry's palette-shaped region is
> non-zero" observation flagged above as a real structural puzzle: that
> region was never a palette, it's just the first 64 bytes of real plane
> data (naturally non-zero). Full derivation, with the off-by-one and
> the corrected decoder (`decodeChampionsWallTileSurface`): `tools/shared/
> goldbox-daa-tiles.ts`'s module doc.
>
> **Addressing model** — RENDERED, not CONFIRMED (the same open question
> `docs/goldbox-glib-format.md` already flags for the GLIB titles' scheme
> 1 vs. scheme 2, hit again here in a different container). A first
> attempt built one small per-wall bank via the `10*wallId+wallset`
> composite-id arithmetic (mirroring the GLIB titles' own scheme 2) — this
> only covered 60/115 WALLDEF view slices across both banks (view-index
> bytes go up to `233`, vs. each per-wall bank's own ~70-116-tile size),
> silently falling back to a placeholder tile for the rest (a render-time
> fallback, not a crash, so this failure mode is easy to miss without
> explicitly counting it). `buildChampionsFlatTileBank` instead builds
> ONE flat, whole-file bank per `8X8D<bank>.DAA` file — `[placeholder,
> ...universal(id 203), ...every other entry's tiles, in directory
> order]` — the exact structure `buildFlatTileBank` already uses for the
> GLIB titles' scheme 1. This fits **every** view slice with 0
> out-of-range indices (**115/115** across both banks) and renders
> coherent, non-degenerate wall art (door/gate-frame borders, brick
> patterns, a diamond/checkerboard motif) for slices that previously fell
> back to a blank placeholder.
>
> **Practical impact**: bank 1 now renders **50/50** wall views (was
> 25/50) and bank 2 renders **65/65** (was 10/65, via coincidental id
> overlap with bank 1's `8X8D1.DAX`) — both banks now use their own real
> `8X8D<bank>.DAA` tile source, 0 skipped in either bank. Rendered in
> greyscale (a synthetic 16-step grey ramp) — **no real colour palette
> for these tiles has been located** (a secondary, lower-priority open
> item; would need a further disassembly pass for a boot-time `LoadRGB4`-
> style call, not attempted this session). Visually confirmed via `Read`
> at multiple ids in both banks (e.g. `walldef-1001-wall5-view6.png`,
> `walldef-2019-wall2-view6.png`) — real, structured, non-degenerate
> geometric wall art, not noise.

**`8X8D0.DAA`, `8X8D1.DAA` (byte-identical to each other), and `8X8D2.DAA`'s
PIXEL PAYLOAD is now SOLVED** (see correction immediately above). Bank 1
and bank 2 both render 100% of their own wall views from their own real
`8X8D<bank>.DAA` tile source.

**Paths tried on `8X8D*.DAA`** (all against `8X8D0.DAA`, 25916 bytes, and/or
`8x8d1.daa` from the sibling Death Knights title, 63376 bytes):

| Approach | Result | Why it failed |
|---|---|---|
| DOS-DaxFile directory (this doc's §1 format) | No match | `headerLen16` gives a non-integer entry count under stride 9 (and 8/10/11/12 tried too, both 1-byte and 2-byte id widths) |
| Pool of Radiance's own `.dax` (10-byte BE entries) | Parses "successfully" but garbage | `dataOffset` values land far outside the file (e.g. `3372819999`); 2/12 or 3/29 entries "decompress" only by coincidence, rest throw/produce wrong lengths |
| Inline self-describing chain (`{id, rawSize, compressedSize}` repeated, no upfront directory table) | No match | Even the very first candidate header at offset 0 fails a strict decode-consumes-exactly-`compressedSize`-and-produces-exactly-`rawSize` check, both `u8` and `u16` id widths |
| Headerless raw 1bpp tiles (GLIB `decode8x8Tiles` convention, H=0) | Renders as uniform noise | No tile-shaped structure at any scale; file size doesn't divide evenly by 8 for Champions' own `.DAA`s (remainder 4 or 6) though Death Knights' `8x8d1.daa` does divide evenly (7922 tiles) and STILL renders as pure noise |
| PoR 4-byte-per-block header (H=4) | Renders as uniform noise | Same as above, no improvement |
| Whole-file PackBits decode with no directory (apply this doc's own §1 codec starting at byte 0, no length cap) | Short (~30-40 tile) recognizable region at the very start, then degrades into noise | Consistent with a real per-block directory existing that this approach doesn't have, causing desync once decode runs into the next block's own header bytes misread as compressed data — but no directory shape tried so far (see above) reproduces this |
| **`re-oracle` escalation: BE DaxFile sibling container** (`readAmigaDaaDirectory`, BE fields, `dataOffset = headerLen` exact) | **CONTAINER SOLVED** — 12/13 (`8X8D0/1.DAA`) and 13/13 (`8X8D2.DAA`) entries byte-exact, chain contiguous, EOF exact | This resolves the container/codec question (shared with Death Knights' `8x8d1.daa` — see correction above), but the inner 8x8-tile pixel payload does NOT match Death Knights' 9-byte-header+64-byte-palette+plane-data shape (`tileCount` field reads a uniform, implausible `1`) — genuinely still open, see correction above |
| Re-test EVERY header field (not just offset 2) against the `(bodyLen-headerLen)/(planeCount*8)` divisibility oracle, sweeping `planeCount` and header length | **PIXEL PAYLOAD SOLVED** — offset-8 byte = real tile count, `planeCount=4` fixed, NO embedded palette (plane data starts right after the 9-byte header) — matches 24/25 entries exactly across `8X8D0.DAA`+`8X8D2.DAA` (the 1 exception, id 203, off by exactly one, same anomaly class as Death Knights' id 202) | Greyscale render of every sampled id (11, 202, 10, 13, 14, 23, 191, 192) shows real, structured, non-degenerate brick/door/panel/diamond-motif tile art |
| Per-wall composite-id tile bank (`10*wallId+wallset` arithmetic, mirroring GLIB scheme 2) for the render step, once the pixel shape was solved | Only 60/115 WALLDEF view slices across both banks land in-bounds (view-index bytes go up to 233, bank size ~70-116) — the rest silently fall back to a placeholder tile | WALLDEF's raw view-index bytes don't address a per-wall-local tile space |
| ONE flat, whole-file tile bank per `8X8D<bank>.DAA` (`buildChampionsFlatTileBank`: `[placeholder, universal(203), every other entry in directory order]`) — mirroring GLIB's own scheme 1 | **SOLVED** — 115/115 view slices in-bounds (50/50 bank 1, 65/65 bank 2), coherent non-degenerate art (door/gate frames, brick, diamond motifs) | This is the real addressing model (RENDERED-grade evidence — not yet disassembly-confirmed, same open-question class as the GLIB titles' own scheme-1-vs-2 ambiguity) |

Both the pixel-payload shape and the render-time addressing model are now
solved to RENDERED/CONFIRMED-structural confidence; see the correction
block above for the full split. The one remaining open item for this
resource is a real colour palette (currently rendered in synthetic
greyscale) — not escalated, a secondary/cosmetic concern relative to the
geometry decode.

## 5. ECL wallset-slot bindings — CONFIRMED, v1.1 engine revision (same as
Pool of Radiance/Curse/Secret, NOT Pools of Darkness's v1.3)

ECL blocks begin with the same constant `0x8813` 2-byte tag PoR's own
`ecl.dax` uses (`POR_ECL_PREFIX_LENGTH`, unchanged). VM address **base is
`0x8000`** (NOT PoR's own `0x9900`) — determined by an unknown-opcode/
visited-instruction ratio sweep requiring a real minimum visited count (to
rule out false positives from out-of-range starting addresses silently
producing `unknown=0`): base `0x8000` gave visited counts 6788/9301 across
the two banks with unknown-opcode ratios of 0.0018/0.0024, decisively better
than every other candidate.

Opcode table: the **standard v1.1** `OPCODE_TABLE` (default), wallset load
via opcode `0x37` "LOAD PIECES" (default `wallsetLoad` config) — i.e. NO
engine-revision options need overriding at all; `findWallsetBindings(buf,
{ base: 0x8000, resolveBlock })` is the whole per-title config.

**Verified**: 15/15 levels across both banks resolve at least one
statically-known wallset slot (5/5 bank 1, 10/10 bank 2), with real, varied,
non-degenerate values (e.g. bank 1 resolves to slot triples like
`{1,2,255}`, `{3,4,23}`, `{19,20,255}` — `255`/`0xff` and `127`/`0x7f` are
the module's own documented "don't touch this slot" sentinels, not decode
errors).

## 6. Verification summary

| Component | Status | Evidence |
|---|---|---|
| Container/codec | CONFIRMED | 239/239 entries, chain + exact rawSize, corpus-wide; disassembly-corroborated (`Load3DMap`/`"WALLDEF"`/`"GEO"` strings) |
| GEO | CONFIRMED | Unchanged decoder; 15/15 levels decode, 1026-byte entries corpus-wide |
| WALLDEF geometry | CONFIRMED | 15 entries, all exact multiples of 156 bytes |
| 8x8 tiles (`8X8D1.DAX`) | CONFIRMED | Visual: recognizable crenellation/door composite render |
| 8x8 tiles (`8X8D*.DAA`) container | CONFIRMED | BE DaxFile sibling container, 12/13 + 13/13 entries byte-exact (id 201 is a genuine all-zero stub) |
| 8x8 tiles (`8X8D*.DAA`) pixel payload | CONFIRMED | 24/25 entries' offset-8 tile count matches body-length division exactly (1 off-by-one, see §4); greyscale renders show real structured tile art |
| 8x8 tiles (`8X8D*.DAA`) addressing model | RENDERED | Flat whole-file bank fits 115/115 view slices (0 out-of-range) vs. 60/115 for a per-wall composite bank; not disassembly-confirmed |
| 8x8 tiles (`8X8D*.DAA`) colour palette | OPEN | No embedded or external palette source located; rendered in synthetic greyscale |
| ECL wallset bindings | CONFIRMED | 15/15 levels, base 0x8000, v1.1 table, real varied slot values |

See `docs/championsofkrynn/TODO.md` for the remaining open item (colour palette only — the pixel payload and addressing model that were previously open are now solved).

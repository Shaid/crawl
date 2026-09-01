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

## 4. 8x8 tile pixel format — CONFIRMED for bank 1's `8X8D1.DAX`; the
separate `8X8D0/1/2.DAA` files are OPEN (undecoded)

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

**`8X8D0.DAA`, `8X8D1.DAA` (byte-identical to each other), and `8X8D2.DAA`
remain UNDECODED.** These are NOT DOS-DaxFile containers (directory parse
fails outright), NOT Pool of Radiance's own `.dax` codec (garbage
`dataOffset`/near-total decompress failure), and NOT a simple inline
per-block header+PackBits chain (tested `{id:u8,rawSize:u16,compressedSize:u16}`
and `{id:u16,...}` inline-chain hypotheses — both fail to decode even the
first candidate block). Plain headerless 1bpp interpretation renders as
uniform noise with no tile-shaped structure, at every header-skip amount
0-16 tried. See `docs/championsofkrynn/TODO.md`. Practical impact: bank 2's
own wall-specific tiles (its real source is presumably `8X8D2.DAA`) are not
decoded — 10/65 of bank 2's wall views render, reusing bank 1's tile bank
via coincidental id overlap (wall ids 11/23 happen to also exist in
`8X8D1.DAX`); the other 55 skip with "no tile-bank entry" rather than
rendering wrong art.

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

Given two structurally distinct approaches (directory-based and inline-chain)
failed with concrete, different reasons, plus the whole-file-decode partial
success suggesting a real but differently-shaped container, this is a
genuine candidate for `re-codebreaker`/`re-oracle` escalation if wall-art
completeness for bank 2 (and Death Knights' title generally, which has no
alternative tile source at all) becomes a priority — not yet escalated this
pass since the walker already has a working, honestly-labelled fallback.

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
| 8x8 tiles (`8X8D*.DAA`) | OPEN | 3 independent format hypotheses tried and refuted (see TODO) |
| ECL wallset bindings | CONFIRMED | 15/15 levels, base 0x8000, v1.1 table, real varied slot values |

See `docs/championsofkrynn/TODO.md` for the open item.

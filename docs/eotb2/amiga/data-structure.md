# Eye of the Beholder II (EOB2) — Amiga Data Structures

**Source data:** `data/eotb2/amiga/data/` — 231 loose files (`.CPS`, `.PAL`,
`.INF`, `.MAZ`, `.SND`-equivalent (`.SAM`/`.OUT` IFF music), `.DCR`, `.DEC`,
`.DAT`, `.VMP`, `.VCN`, plus `Manual/`/`Maps/`/`Solution/` reference
material at `data/eotb2/amiga/`). The `EOBII` file is the AmigaOS
`loadseg()`-able game executable (not disassembled this session).

**Sibling ports already solved, reused rather than re-derived:**
`docs/eotb/amiga/data-structure.md` (EOB1 Amiga — VCN raw payload layout,
5-bitplane pixel decode, BE Amiga palette-word encoding, `.DEC`/decoration
overlay rendering, LCW decompressor) and `docs/eotb2/dosvga/data-structure.md`
(EOB2 DOS/VGA — container/`.INF` header shape, `.VMP` derivation formula,
`.MAZ`, wall-decoration record-stream grammar, ITEM.DAT/TEXT.DAT record
layout). This doc only documents what's genuinely new or different for this
platform+game combination — see those two docs for the parts reused
unmodified.

**Headline finding, confirmed against every real file rather than assumed:**
EOB2 Amiga is a real hybrid, but *not uniformly* — different formats mix
EOB1-Amiga's encoding with EOB2-DOS's mechanism in different ways, and one
format (`.VMP`) sides with DOS's *encoding* too, contradicting the naive
"Amiga encoding + EOB2 mechanism" prediction. See the per-format sections
below for the evidence.

| Format | Container/compression | Encoding | Matches |
|---|---|---|---|
| `.VCN` | LCW-compressed (EOB2-style) | EOB1-Amiga raw payload, 5bpp planar | Hybrid |
| `.CPS` | LCW-compressed (EOB2-style), header-embedded palette (EOB2-style) | Amiga 5bpp planar (EOB1-style) | Hybrid |
| `.VMP` | — | **Little-endian**, `330+N*431` derivation | **EOB2 DOS**, not EOB1 Amiga (which is BE) |
| `.INF` | LCW-compressed (EOB2-style) | EOB2 DOS's header+record-stream shape | EOB2 DOS |
| `.MAZ` | — | Unchanged | Both (universal) |
| `.PAL` | — | Amiga-native 64B/32-colour BE words | EOB1 Amiga |
| `.DEC` / `.DCR` | — | Forced-LE, byte-identical bytes | EOB2 DOS (literally, md5-identical files) |
| `ITEM.DAT` / `ITEMTYPE.DAT` | — | Same record layout/counts as DOS, but big-endian fields | Hybrid |
| `TEXT.CPS`/`TEXT2.CPS`/`TEXT4.CPS` | LCW-compressed (EOB2-style) | Decompresses byte-identical to EOB2 DOS's `TEXT.DAT` | EOB2 DOS (literally) |

---

## Container: none — loose files, same as EOB2 DOS

No `.PAK`/archive step; every asset is a standalone file in
`data/eotb2/amiga/data/`, matching EOB2 DOS's own loose-file layout (see
`dosvga/data-structure.md` § "Container"), not EOB1 Amiga's PAK-based
floppy distribution.

---

## The shared "Kyra bitmap" container + LCW, confirmed used by `.VCN`/`.CPS`/`.INF`/`TEXT*.CPS`

Every one of these file types opens with the same 10-byte header already
documented for both sibling ports:

| Offset | Size | Field |
|---|---|---|
| 0x00 | u16 LE | `fileSizeField` (file size minus these 2 bytes) |
| 0x02 | u16 LE | `compType` (0 = raw, 4 = LCW "Format 80") |
| 0x04 | u32 LE | `imgSize` (decompressed payload size) |
| 0x08 | u16 LE | `palSize` (bytes of embedded palette right after this header, before the body) |

`compType` is **4 (LCW)** in every real `.VCN`/`.INF`/`TEXT*.CPS` file in
this corpus, and in most `.CPS` files (one exception found and confirmed
harmless: `LEVEL1.SAM`, an unrelated `.SAM` IFF-audio file, uses `compType
0`/raw — not part of the `.VCN`/`.CPS`/`.INF` family this section covers).
LCW decompression reuses `decompressLCW` (`tools/eotb/lcw.ts`) — the same
decompressor already confirmed byte-exact across EOB1 and EOB2, both
platforms, unmodified again here.

`tools/eotb2/amiga/decode-vcn.ts` exports `decompressKyraContainer()`, the
one shared implementation of this header-strip-and-decompress step reused
by `decode-cps.ts` and `decode-text.ts` in the same directory (`decode-
inf.ts` re-exports EOB2 DOS's own `decompressInf`, which already implements
the identical generic container).

---

## `.VCN` — Wall tile pixel data (hybrid: EOB2 container, EOB1-Amiga payload)

**Confirmed (2026-09-02)** against all 5 real wall-set `.VCN` files
(`CRIMSON`, `DUNG`, `FOREST`, `MEZZ`, `SILVER` — `AZURE.VCN` does not
exist, see "AZURE" below).

The on-disk *container* is the shared Kyra-bitmap-header + LCW scheme above
— a real structural departure from **EOB1 Amiga's own `.VCN`**
(`tools/eotb/decode-vcn.ts`: raw/uncompressed, no header at all). EOB2
Amiga compresses its `.VCN`; EOB1 Amiga does not.

Once decompressed, the payload is byte-for-byte **EOB1-Amiga's own raw VCN
layout** (`docs/eotb/amiga/data-structure.md` § "VCN — Wall View Data"):

| Offset | Size | Field |
|---|---|---|
| 0x00 | u16 LE | `numTiles` |
| 0x02 | 5×u16 BE | Palette-patch words for slots 1–5 |
| 0x0C | 22 bytes | Reserved |
| 0x22 | `numTiles`×40 bytes | Row-interleaved 8×8×5bpp tiles |

Verified byte-exact for all 5 wall sets: decompressed length ==
`0x22 + numTiles*40` with **zero** residue —

| Wall set | numTiles | Decompressed size |
|---|---|---|
| CRIMSON | 1138 | 45,554 |
| DUNG | 1448 | 57,954 |
| FOREST | 904 | 36,194 |
| MEZZ | 1193 | 47,754 |
| SILVER | 1115 | 44,634 |

**The 5-colour palette patch is real bytes but reads as all-zero across
every wall set in this corpus** (all 5 BE words are `0x0000`) — confirmed
by direct inspection, not a decode bug: the field exists in the shared
container (EOB1 Amiga populates it), but EOB2 ships a standalone,
full-32-colour `.PAL` per wall set (see below) and evidently never needs
the patch. `applyVcnPalette` is exported for API symmetry with EOB1's
module but is a documented no-op against this real corpus.

Tile pixel decode reuses `decodePlanarRowInterleaved`
(`tools/shared/amiga-planar.ts`) unmodified — the same row-interleaved
8×8×5bpp convention already confirmed for EOB1 Amiga. **Visually
confirmed**: a rendered atlas of every `CRIMSON.VCN` tile through
`CRIMSON.PAL` shows a coherent, legible red/brown brick-masonry texture
sheet, not noise.

Module: `tools/eotb2/amiga/decode-vcn.ts`.

---

## `.CPS` — Full-screen bitmaps and decoration sheets (hybrid: EOB1-Amiga pixels, EOB2 palette convention)

**Confirmed (2026-09-02).** Every sampled `.CPS` decompresses to exactly
**40,000 bytes** (320×200/8×5 planes — Amiga 5-bitplane, NOT EOB2 DOS's
chunky `64,000`-byte 8bpp `tools/eotb2/decode-cps.ts`).

The container/header shape is the shared 10-byte header above; `palSize`
is **not zero** for some files (`DARKMOON.CPS`, `MENU.CPS`, `HEROES.CPS`
all have `palSize=64`), and those 64 bytes sit **right after the 10-byte
header, before the (possibly LCW-compressed) body** — EOB2's own
"`palSize>0`, embedded in the file header" convention
(`docs/eotb/amiga/data-structure.md` § "Palette Locations" → "EOB2
style"), **not** EOB1 Amiga's "trailing 64 bytes after decompression when
`uncompressedSize==40064`" convention (`tools/eotb/decode-cps.ts`) — EOB1's
own reader only *skips* those header-`palSize` bytes without parsing them
into a palette, since EOB1 never needs to; this game does.

64 bytes / 2 = 32 colours, same BE-Amiga-12-bit-word encoding as the
standalone `.PAL` files below and EOB1's `.VCN` patch words — reuses
`eobAmigaWordToRGB`/`readBEWords` directly (`tools/eotb/palette.ts`).

Decoration-sheet `.CPS` files (`BROWN1.CPS`, `CRIMSON.CPS`, `SILVER1.CPS`,
etc — the EOB2-specific per-wall-set shape sheets
`resolveWallDecorationAssignments` resolves against) have `palSize=0` —
they use the wall set's own `.PAL`, the same convention already confirmed
for EOB1 Amiga's decoration sheets.

**Verified:** `DARKMOON`/`MENU`/`HEROES.CPS` all decode to 320×200 with a
real 32-colour embedded palette; `CRIMSON`/`BROWN1`/`SILVER1.CPS` decode
cleanly with `palette: null` as expected.

Module: `tools/eotb2/amiga/decode-cps.ts`.

---

## `.VMP` — Wall-view mapping table (matches EOB2 DOS, NOT EOB1 Amiga — genuine divergence)

**Confirmed byte-identical in structure/endianness to EOB2 DOS/VGA's
`.VMP`, not to EOB1 Amiga's.** This is a real, checked finding, not an
assumption made from either sibling port, and it directly contradicts the
otherwise-consistent "EOB1-Amiga encoding" pattern seen in `.VCN`/`.CPS`
above.

`docs/eotb/amiga/data-structure.md`'s own module comment for EOB1's
`decode-vmp.ts` states EOB1 Amiga's leading header word and tile-index
words are **big-endian** (reasoned from a plausible ascending run under BE
vs. implausible multiples-of-256 under LE). EOB2 Amiga's real `.VMP` bytes
go the *other* way: reading `CRIMSON.VMP`'s leading `u16` as
**little-endian** gives `2916` — exactly `330 + 6*431`, the same
self-describing entry-count value EOB2 DOS's `.VMP` stores in that
position (`tools/eotb2/decode-vmp.ts`'s module doc) — while big-endian
gives `25611` (meaningless). The following words, read LE, form a
plausible ascending-then-mirrored run (`1,2,3,4,5,6,5,7,8,9,10,10
(mirror),9(mirror),8(mirror),7(mirror)...`); read BE they're uniform
multiples of 256 (implausible, the same tell EOB1's own doc uses).
`FOREST.VMP`'s LE header is `1192 = 330 + 2*431`, matching DOS FOREST's
own count exactly.

So `tools/eotb2/amiga/decode-vmp.ts` re-exports EOB2 DOS's decoder
unmodified rather than porting EOB1 Amiga's BE one. Verified against all 5
real wall-set `.VMP` files with their real `numTiles` (from `decode-
vcn.ts`): **0 oracle-check failures**, correct wall-type-run count per set
— CRIMSON/DUNG/MEZZ/SILVER: 6 runs, FOREST: 2 runs (same `330+N*431`
derivation already confirmed for DOS, `N` derived from the file's own byte
size, not hardcoded).

Structure recap (unchanged from DOS): a 22×15 backdrop (330 entries) + N×431
wall-type runs; each entry is a 14-bit tile index + bit14 h-flip + bit15
z-mask.

---

## `.MAZ` — Maze/level grid (unchanged, universal)

**Confirmed byte-identical** to both sibling ports: 6-byte header
`(width, height, ?)` + `width*height*4`-byte cell array. Spot-checked
`LEVEL1.MAZ`: header `(32, 32, 4)`, file size 4,102 bytes exactly matching
`6 + 32*32*4`. `tools/eotb2/amiga/decode-maze.ts` re-exports `tools/eotb2/
decode-maze.ts` (itself a re-export of EOB1's own module) directly.

---

## `.PAL` — Standalone wall-set palette (EOB1-Amiga encoding, EOB2's standalone-per-file mechanism)

**Confirmed** as a real hybrid: every wall-set `.PAL` (`AZURE`, `CRIMSON`,
`DUNG`, `FOREST`, `MEZZ`, `SILVER`) is exactly **64 bytes = 32 colours ×
2 bytes**, the same 12-bit-Amiga-word big-endian encoding already
confirmed for EOB1 Amiga's `.VCN`-embedded palette patch — but delivered
as EOB2's own **standalone per-wall-set file** mechanism
(`EoBCoreEngine::initLevelData` name-matches the level's `.INF`
wall-set stem to `<stem>.PAL`, same runtime mechanism already confirmed
for DOS) rather than embedded in a bitmap. Same game, same mechanism, two
different concrete on-disk encodings (DOS's 768-byte VGA format vs. this
64-byte Amiga-native one) — exactly the hybrid this project's
platform-crossing pattern predicts.

Verified: first colour black `[0,0,0]`, last colour white `[255,255,255]`
for all 6 real `.PAL` files.

`FINALE.PAL` is 384 bytes (6×64-byte palettes back to back) — not decoded
this session (out of scope for wall rendering; see "Not extracted" below).

Module: `tools/eotb2/amiga/palette.ts`.

---

## `.INF` — Level configuration (matches EOB2 DOS's header+record-stream shape)

**Confirmed byte-identical record shape to EOB2 DOS/VGA's `.INF`**
(container AND every field past it), not derived from EOB1 Amiga's own
`.INF`. The only container-level difference from DOS is one already
shared with every other Amiga file above: `.INF` is LCW-compressed behind
the shared 10-byte header (`compType=4` in every real file) —
`tools/eotb2/decode-inf.ts`'s own `decompressInf`/`decodeInf`/`parseInf`
already implement exactly this generic container without special-casing
DOS, so `tools/eotb2/amiga/decode-inf.ts` re-exports them unmodified.

Header layout (same as DOS, `dosvga/data-structure.md` § "INF"):

| Offset | Size | Field |
|---|---|---|
| 0x004 | 1 byte | Tag byte, `0xEC` |
| 0x005 | 13 bytes | `mazStem` (cstring) |
| 0x012 | 13 bytes | `wallSetStem` (cstring) |
| 0x01F | 1 byte | `secondWallSetFlag` |
| 0x020 | 13 bytes | `secondWallSetStem` (cstring, present iff flag set) |

**Verified against all 16 real Amiga `LEVELn.INF` files** (`n`=1–16;
`LEVEL5` is on disk as lowercase `level5.inf`): the fixed-offset header
decodes cleanly for all 16, `secondWallSetStem` is present (`"azure"`) on
exactly `LEVEL10`–`LEVEL14` (same 5 levels as DOS), and the full
record-stream walk (door-shapes, monster-shapes, monster-properties, then
the wall-mapping/decoration-load stream) parses with **0 errors** across
all 16 files, resolving **308** total wall-decoration assignments — the
exact same total DOS resolves — with every `decIndex` in-range against a
real, byte-identical `.DEC` file.

**One new maze-reuse pair found this session, not present in the DOS
corpus's documented list:** `LEVEL15.INF`'s `mazStem` is `"level14.maz"`,
not `"level15.maz"` — a genuine Amiga-specific data variant (DOS's own
`LEVEL15.INF` references its own `level15.maz`). The other three reuse
pairs match DOS exactly:

| INF | mazStem | Note |
|---|---|---|
| LEVEL16 | `level15.maz` | Same as DOS |
| LEVEL6 | `level5.maz` | Same as DOS |
| LEVEL14 | `level12.maz` | Same as DOS |
| **LEVEL15** | **`level14.maz`** | **Amiga-only — DOS's LEVEL15 uses its own level15.maz** |

Module: `tools/eotb2/amiga/decode-inf.ts`.

---

## Second-wall-set palette-override mechanism (confirmed, same as DOS)

`LEVEL10`–`LEVEL14` navigate on the `mezz` tileset's own `.VCN`/`.VMP`
geometry but render with `azure`'s `.PAL` (the `secondWallSetStem`
overrides the primary `wallSetStem`'s palette, same runtime mechanism
already root-caused for DOS — `dosvga/data-structure.md` § "Palette
resolution (per-CPS)"). `tools/eotb2/amiga/export-dungeon.ts` bundles the
navigable tileset's VCN/VMP with the palette-stem's `.PAL`
(`secondWallSetStem ?? wallSetStem`), producing a distinct `mezz+azure`
wall-set bundle for the 5 affected levels — **verified visually**: a
rendered LEVEL10 pose (`level10-16-16-f1.png`) shows a cool blue-grey
colour scheme, clearly distinct from LEVEL1's warm brown DUNG corridor and
LEVEL15's red/orange CRIMSON masonry.

---

## `.DEC` / `.DCR` — Decoration data (md5-byte-identical to EOB2 DOS)

**Confirmed** (2026-09-02): all 6 real `.DEC` files
(`AZURE`/`BROWN`/`CRIMSON`/`FOREST`/`MEZZ`/`SILVER.DEC`) hash **identically**
to `data/eotb2/dosvga/`'s own same-named files — expected, since
`EoBCoreEngine::getDecDefinitions` reads via
`createEndianAwareReadStream(decFile, Resource::kForceLE)`, forced
little-endian regardless of platform (already confirmed for EOB1 Amiga).
`.DCR` (monster decoration parameters, per-facing sprite tables) is the
same forced-LE format, previously confirmed for both sibling ports; not
re-verified byte-for-byte against DOS this session (no per-file diff run)
but structurally identical and used unmodified.

Modules: `tools/eotb2/amiga/decode-decorations.ts` (re-export of EOB1's
`tools/eotb/decode-decorations.ts`).

---

## Wall decoration overlay rendering (confirmed working, front/"Down" role)

Reuses `tools/eotb2/renderer.ts`'s `drawWallDecorations` and EOB1's DSC
render-geometry tables unmodified — the whole render pipeline is
platform-agnostic once assets are exported to flat JSON (see "Export
pipeline" below). **Verified**: searching for the maximum-pixel-diff pose
(with vs. without `decorationParams`) across 10 levels found real,
well-formed nonzero diffs (88–474 pixels, forming compact, correctly
localized regions, not noise). Two poses rendered to PNG and visually
confirmed as clear torch/sconce decorations:
`level7-2-5-f2.png` (SILVER wall set) and `level11-1-20-f1.png`
(MEZZ+AZURE wall set).

(A first search pass found 3 poses all showing exactly 0 diff pixels,
which looked like a possible bug — investigated and resolved: the CPS
decoration sheet at that slot genuinely does have real pixel content, but
the DSC render-geometry math places that specific slot/cell combination's
decoration fully off-screen — `finalX == VIEWPORT_W` exactly — a real
architectural edge case matching DOS's own documented "some cells
legitimately draw nothing" caveat, not a decode bug.)

---

## `ITEM.DAT` / `ITEMTYPE.DAT` — same record layout as DOS, big-endian fields

**Confirmed (2026-09-02), a genuine byte-order finding, not identical
files.** Both files are exactly the same *size* as EOB2 DOS's own copies
(10,385 and 1,026 bytes respectively) but **not** md5-identical (unlike
`.DEC`/`.DCR`) — a naive little-endian parse (DOS's own reader,
`scripts/kyralib/items.py`, ported field-for-field from
`EoBCoreEngine::loadItemDefs`) does not land cleanly on EOF. Reading the
identical field layout **big-endian** instead resolves it completely:

- `ITEM.DAT`: `numItems=434` (BE) — matches DOS's own count exactly — item
  table ends at `2+434*14=6078`; `numNames=123` (BE) at that offset — also
  matches DOS exactly — name table `6078+2+123*35=10385` = file size
  exactly, **zero residue**. First name decodes to `"Mouse Pointer"`,
  matching both EOB1 and EOB2 DOS's own convention.
- `ITEMTYPE.DAT`: `numTypes=64` (BE) — matches DOS exactly —
  `2+64*16=1026` = file size exactly, **zero residue**.

Record layout (14 bytes/item, matching DOS's `EoBItem` field-for-field,
just read big-endian): `nameUnid`(u8) `nameId`(u8) `flags`(u8) `icon`(s8)
`type`(s8) `pos`(s8) `block`(s16 BE) `next`(s16 BE) `prev`(s16 BE)
`level`(u8) `value`(s8). `ITEMTYPE.DAT` (16 bytes/type): `invFlags`(u16 BE)
`handFlags`(u16 BE) `armorClass`(s8) `allowedClasses`(s8)
`requiredHands`(s8) 6× damage-dice s8 fields `unk1`(u8)
`extraProperties`(u16 BE).

Module: `tools/eotb2/amiga/decode-items.ts`. Not wired into
`export-dungeon.ts` (out of scope for wall rendering — item/monster stat
data plays no role in the first-person dungeon view).

---

## `TEXT.CPS` / `TEXT2.CPS` / `TEXT4.CPS` — NOT images, the Amiga `TEXT.DAT` equivalent

**A genuine, decisive find (2026-09-02): despite the `.CPS` extension**
(every other `.CPS` in this corpus is a bitmap, see above) **these three
files are the Amiga port's `TEXT.DAT` equivalent — no `TEXT.DAT` file
exists anywhere in this corpus.** `Screen::loadBitmap`/`decodeFrame4`
never get near these files at runtime; they hit them purely because
`.CPS` is this whole corpus's blanket "goes through the shared Kyra
bitmap header + LCW" container, reused here for a wholly different
payload type — see
`~/.claude/agents/game-re-lessons/familiar-extension-not-proof-of-
standard-format.md` for the general pitfall this is a fresh instance of,
at the whole-file-extension level rather than a chunk-tag level.

Confirmed by decoding, not guessed from the extension:

- LCW-decompressing any of the three yields exactly **22,463 bytes** —
  byte-for-byte the same size as EOB2 *DOS*'s own `TEXT.DAT`.
- That payload is the identical **offset-table + NUL-terminated
  string-pool** format already confirmed for DOS's `TEXT.DAT`: `u16 LE
  offsets[N]` (`N = offsets[0]/2`), followed immediately by the string
  pool. `offsets[0]=244` → `N=122`, matching DOS's own count exactly.
- **The decompressed bytes of all three files are md5-identical to each
  other AND to EOB2 DOS's real `TEXT.DAT`** (`438534e7ba748251c5ac24
  b4d6654c88`, all four) — the strongest possible confirmation: this is
  the exact same string data, just LCW-compressed and duplicated across 3
  identical copies (presumably one per some UI/language-selection hook —
  not investigated further) instead of DOS's one raw file.

Every one of the 122 strings decodes to fully legible EOB2 NPC dialogue
text, e.g. `"Oh great heroes, thank you for your timely rescue. I am
Insal the quick..."`.

Module: `tools/eotb2/amiga/decode-text.ts`. Not wired into
`export-dungeon.ts` (out of scope — dialogue text plays no role in the
first-person dungeon view).

---

## Export pipeline and walker

`tools/eotb2/amiga/export-dungeon.ts` decodes all 16 levels + the 6 wall
sets (5 navigable + the `azure` palette-only bundle for LEVEL10–14) to
`public/assets/eotb2/amiga/{dungeon,wallsets}/`, reusing the DOS pipeline's
output *shape* exactly (`../export-dungeon.ts` as the structural template)
so the DOS renderer/loader code needs zero platform-specific branches.
Verified run: 16 levels, 308 total decoration assignments, **0 errors**.

`tools/eotb2/amiga/render-through-dungeon.ts` renders one pose to PNG for
offline verification — it imports `../renderer.ts`'s `renderView`
**unmodified** (the render step only ever reads plain arrays out of the
exported JSON, never a raw file format, so it is genuinely
platform-agnostic once export has run). Verified poses, all visually
inspected as coherent, recognizable first-person dungeon views:

| Render | Level / wall set | What it confirms |
|---|---|---|
| `level1-16-16-f0.png` | LEVEL1, DUNG | Warm brown corridor |
| `level4-8-8-f0.png` | LEVEL4, FOREST | Green foliage (2-run VMP) |
| `level10-16-16-f1.png` | LEVEL10, MEZZ+AZURE | Cool blue-grey — palette override |
| `level15-16-16-f2.png` | LEVEL15, CRIMSON | Red/orange masonry |
| `level7-2-5-f2.png` | LEVEL7, SILVER | Visible torch decoration |
| `level11-1-20-f1.png` | LEVEL11, MEZZ+AZURE | Visible torch decoration |

**Browser walker**: registered as a new `GameId`, `'eotb2amiga'`
(`src/game-id.ts`), reusing `loadEotb2View`/`eotb2LevelList`
(`tools/walker/games-eotb2.ts`) **completely unchanged** — the only
platform-specific code anywhere in the walker chain lives in the export
step, exactly as intended by the flat-JSON asset shape. Wired into
`tools/walker/walker.ts`'s `GAMES` list and `listLevels()` dispatch, and
`tools/shared/viewer-config.ts`'s `VIEWER_CONFIGS`.

---

## Not extracted this session (identified but out of scope)

| Item | Notes |
|---|---|
| `.OUT` (6 files, one per wall set) | Kyra-bitmap-header + LCW wrapping a standard IFF `FORM`/`SMUS` (Amiga "Simple Musical Score") container — confirmed by magic bytes after decompression, not decoded further. Ambient music, out of scope. |
| `.SAM` (per-level + `INTRO.SAM`/`FIN.SAM`) | Also IFF `FORM`-based (some raw/`compType 0`, some LCW-compressed) — audio, out of scope, matching DOS's own `.SND`/`.ADL` "out of scope" treatment. |
| `fonts/` (`EOBF6.FONT`, `EOBF8.FONT` + bitmap dirs) | Standard AmigaOS bitmap fonts (`file` identifies them directly) — UI text rendering, not the dungeon view. |
| `libs/diskfont.library` | Bundled AmigaOS system library, not game data. |
| `CREDITS.TXT` | Plain ASCII credits text. |
| `FINALE.PAL` | 384 bytes = 6×64-byte palettes — not decoded (structure obvious from the single-palette `.PAL` format above, just not wired up). |
| `LEVELS.TMP` | Same size as DOS's own `LEVELS.TMP` (36,210 bytes) but not byte-identical — likely a savegame/scratch buffer (matches EOB1's own `LEVELS.TMP` role, `docs/eotb/amiga/data-structure.md` § "Savegame"). Not decoded. |
| `EOBII` executable | AmigaOS `loadseg()`-able binary, not disassembled this session — all findings above came from byte-level corpus inspection and ScummVM source cross-reference, not executable tracing. |
| Wall-decoration side roles (`-east`/`-west` slots) | Front/"Down" role only — matches both EOB1's and EOB2 DOS's own current scope, not a new gap. |
| Per-CPS palette selection for non-wall-set screens | Mechanism confirmed (same wall-set-stem match as DOS/EOB1); which specific monster/UI `.CPS` files need a level-specific palette vs. a game-wide fallback not individually traced. |

---

## Verification summary

- `tools/eotb2/amiga/__tests__/eotb2-amiga.test.ts` — 16 tests, all real
  corpus data, all passing: VCN (5/5 wall sets, 0 residue), VMP (5/5, 0
  oracle failures), PAL (6/6), MAZ (LEVEL1 header+size), CPS (both
  embedded-palette and no-palette variants), INF (16/16 levels resolve,
  second-wall-set flag on exactly LEVEL10–14, all 4 maze-reuse pairs
  including the newly-found Amiga-only LEVEL15→level14.maz), decoration
  resolution (308/308 in-range against real `.DEC` files), `buildWallTypeMap`,
  `ITEM.DAT`/`ITEMTYPE.DAT` (big-endian, matches DOS's counts exactly), and
  `TEXT*.CPS` (byte-identical to DOS's `TEXT.DAT`).
- Full repo `npx vitest run`: 383/383 tests passing.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean for all files touched this session (2 pre-existing
  errors in unrelated `tools/.scratch/` files from prior sessions, not
  touched).
- 6 real poses rendered to PNG and visually inspected (see table above).

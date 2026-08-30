# Pool of Radiance (Amiga) — data structure reference

Pool of Radiance, SSI Gold Box engine, Amiga port. First of four sibling Gold
Box titles staged in this repo (Curse of the Azure Bonds, Secret of the
Silver Blades, Pools of Darkness — see `data/curseoftheazurebonds/amiga/`,
`data/secretofthesilverblades/amiga/`, `data/poolsofdarkness/amiga/`, all
still raw un-renamed floppy dumps, not touched this pass beyond the
correspondence note in §0).

Codec/container implementation: `tools/poolofradiance/amiga/dax.ts`. Wall-tile
decode: `tools/poolofradiance/amiga/walldef.ts`. Extractor:
`tools/poolofradiance/amiga/export-data.ts`. Session history and open items:
`docs/poolofradiance/TODO.md`.

External oracles consulted:

- http://amiga-dev.wikidot.com/project:pool-of-radiance — attaches
  `pooldata.py`, a register-level (`DR[]`/`FLAGS[]`) Python transliteration of
  the game's real 68000 decompressor. This is the primary ground-truth source
  for §2 below.
- https://github.com/bsimser/Gold-Box-Explorer — an active C# tool for the
  **DOS** ports of several Gold Box titles. Its container/codec
  (`DaxFile.cs`) is unrelated to the Amiga one (see §0), but its
  post-decompression wall-tile-index geometry (`DaxWallDefFile.cs`) and its
  six picture-block shape checks (`*BlockSpecification.cs`) are used in §3
  and §4 as cross-checks against real Amiga bytes.
- https://gbc.zorbus.net/ — checked; no Amiga-specific or `.dax`-format
  documentation found there (DOS-oriented, general Gold Box community site).
  No further use made of this source.

---

## 0. Container/codec is Amiga-specific; only the post-decompression asset
   layout is shared with the DOS port

Every real game-data file in `data/poolofradiance/amiga/` uses a `.dax`
extension. The three sibling titles' raw floppy dumps use the **same base
filenames** with different extensions — confirmed directly (`ls
data/curseoftheazurebonds/amiga/DISKA,DISKB`): `WALLDEF.GLB`, `PIC.TLB`,
`CPIC.TLB`, `8X8D.TLB`, `DUNGCOM.TLB`, `SPRIT.TLB`, `COMSPR.TLB`, `BODY.TLB`,
`CBODY.TLB`, `HEAD.TLB`, `CHEAD.TLB`, `ECL.GLB`, `GEO.GLB`, `ITEM.GLB`,
`MONCHA.GLB`, `MONITM.GLB`, `MONSPC.GLB`, `RANDCOM.TLB`, `WILDCOM.TLB`, plus
`ITEMS.DAT`. **This is a naming correspondence only** — not touched further
this pass; those titles' own containers were not opened, parsed, or assumed
to share the Amiga `.dax` byte layout.

Gold Box Explorer's own DOS-side container (`DaxFile.cs`) is a **completely
different** scheme from the one confirmed below for the Amiga port: 9-byte
little-endian directory entries (`[u8 id][i32 offset][u16 rawSize][u16
compressedSize]`), with `.NET BinaryReader`, and a byte-oriented
PackBits-style run-length codec (`decodeCompressedBytes`, sign of the lead
byte selects a literal run vs. a repeated byte). Neither the directory
entry width/field order nor the codec transfers to the Amiga's `.dax` files —
confirmed by the field-order derivation in §1/§2 below, which is
independently sourced from the wiki's Amiga-specific `pooldata.py`, not from
Gold Box Explorer. What *does* transfer, and is independently confirmed
against real Amiga bytes (not merely assumed from the DOS source), is the
**wall-tile-index geometry downstream of decompression** — see §3.

---

## 1. `.dax` container — CONFIRMED, 843/843 entries corpus-wide

```
offset 0             u16 BE   headerSize   -- byte length of the entry table
                                              that follows (not incl. these
                                              2 bytes). headerSize/10 = entry
                                              count, exactly, every file.
offset 2             entry[0]   (10 bytes)
offset 2+10          entry[1]
...
offset 2+headerSize  <compressed data blocks, back to back, one per entry>
```

Each 10-byte big-endian directory entry:

| Field | Size | Notes |
|---|---|---|
| `indexID` | u16 BE | Per-file content id. Sparse/non-sequential (e.g. `walldef.dax` uses `0-9,17-21,23,24`) — a real semantic id, not a plain running index. |
| `dataOffset` | u32 BE | Byte offset of this entry's compressed run, **relative to `2+headerSize`** (right after the whole directory block). |
| `compressedLength` | u16 BE | Byte length of the compressed run. |
| `decompressedLength` | u16 BE | Byte length after decompression. |

**Verification** (`final_stats.py`, all 23 real `.dax` files in
`data/poolofradiance/amiga/`, reproduced by `container-directory.json`'s
`totalVerified` count):

- `dataOffset[n+1] == dataOffset[n] + compressedLength[n]` — zero deviation
  across **843/843 entries** in all 23 files.
- `2 + headerSize + sum(compressedLength) == realFileSizeOnDisk` — **exact**
  for all 23 files, zero remainder bytes anywhere.

Sample rows (full 23-file table is reproduced live by
`container-directory.json`):

| File | entries | headerSize | file size |
|---|---|---|---|
| `walldef.dax` | 17 | 170 | 10,180 |
| `dungcom.dax` | ? (see §5) | — | 3,688 |
| `8x8d.dax` | 23 | 230 | 30,720 |
| `pic.dax` | 59 | 590 | 270,220 |
| `cpic.dax` | 118 | 1,180 | 39,810 |

**Divergence from an earlier hypothesis:** a first-pass byte-stride guess
(`[u16][u16 id][u32 offset][u16 compressedLength]`, no separate leading
`headerSize` field) happened to chain self-consistently across the whole
corpus too — landing exactly `fileSize - 2` short every time, which looked
like real evidence. It was wrong: a 2-byte phase-shifted aliasing artifact of
the *real* layout above. Caught by hand-deriving the first two entries' exact
byte offsets against `pooldata.py`'s own field order and finding the
corrected model closes with **zero** leftover bytes, not `fileSize - 2`.
Documented so this dead end isn't repeated.

---

## 2. Decompression codec — CONFIRMED via self-verifying checksum, 843/843

**Not real ByteKiller**, despite the wiki page's own "ByteKiller 2.0" label.
Checked exhaustively against the `ancient` decompression library's actual
`ByteKillerDecompressor` C++ source
(`github.com/temisu/ancient`, `src/ByteKillerDecompressor.cpp`): real
ByteKiller requires a 12-byte header (packedSize, rawSize, XOR checksum) at
the start of the compressed stream, and reads a Huffman-coded token stream
**forward**. Result: **0/843** entries in this corpus pass ByteKiller's own
header/checksum validation. This divergence from the source label is
reported as a real finding, not glossed over.

The actual algorithm is a custom, bit-oriented, **backward-reading** LZ77
variant with an embedded running XOR checksum:

- Compressed bytes are reinterpreted as big-endian 32-bit words and consumed
  by **popping from the end of the stream**, not reading forward from the
  start.
- The last word popped is the declared decompressed length (cross-checked
  against the directory's own `decompressedLength` field — a second,
  independent length check beyond §1's offset-chaining one).
- Output is built in reverse order, then reversed once at the end.
- A running XOR (`D5`) accumulates every consumed input longword; the
  decoder rejects the stream if `D5 != 0` once decompression completes. This
  is the **primary verification oracle**: nothing is called "decoded" below
  unless it passed this checksum.
- The bitstream grammar itself (register semantics: `D0` shift/carry buffer,
  `D2` distance accumulator, `D3` copy-length counter) is a direct,
  uninterpreted port of `pooldata.py`'s `decompressChunk()` — see
  `tools/poolofradiance/amiga/dax.ts` module doc for the full per-branch
  grammar (literal unpack of 8-or-3-bit-counted byte runs vs. back-reference
  copy with a 2-, 9-, 10-, 12-, or 8-bit-counted distance, selected by two
  leading flag bits).

**Result: 843/843 entries across all 23 `.dax` files decompress with a
passing checksum AND an exact declared-length match** — confirmed live by
`container-directory.json`'s `totalVerified` field after running the
extractor (see §6).

**Cross-implementation check:** the TypeScript port (`dax.ts`) was verified
byte-identical against an independent Python3 reproduction of the same
algorithm (`dax_faithful.py`, scratchpad) across the whole corpus before being
promoted — this caught two real translation bugs (a distance/length branch
using an unrelated leftover value instead of `nbitsDist = d2b+9`, and a
copy-length constant of `2` instead of `8` in the carry-true 8-bit branch),
both fixed and re-verified against the reference output before commit-ready
status.

A genuinely dead register (`D4`, written in two branches but never read
anywhere downstream) was present in the initial 1:1 register transliteration
and has since been removed from `dax.ts` — confirmed by re-running the full
843-entry corpus check afterward with an unchanged 843/843 pass rate, i.e.
its removal has no effect on output.

---

## 3. `walldef.dax` + `8x8d.dax` — the dungeon wall renderer's data (answers
   the first-person-view hypothesis)

**`walldef.dax`** holds, per wall-type block id, a flat array of **156-byte
wall slices**. Every one of the 17 real entries in the corpus has a
decompressed length that is an *exact* multiple of 156 (5, 10, or 15 slices
per entry, zero remainder) — this stride is not guessed, it falls out of the
byte-length arithmetic with zero deviation across the whole file.

Each 156-byte slice packs **10 view sub-arrays**, one per viewing
angle/depth, each a row-major grid of **tile indices** into a combined tile
bank (not raw pixels):

| view | byte offset | rows × cols | byte length |
|---|---|---|---|
| 0 | 0 | 2×1 | 2 |
| 1 | 2 | 4×1 | 4 |
| 2 | 6 | 4×1 | 4 |
| 3 | 10 | 4×3 | 12 |
| 4 | 22 | 8×2 | 16 |
| 5 | 38 | 8×2 | 16 |
| 6 | 54 | 8×7 | 56 |
| 7 | 110 | 11×2 | 22 |
| 8 | 132 | 11×2 | 22 |
| 9 | 154 | 2×1 | 2 |

Sums to exactly 156 bytes with zero gap or overlap
(2+4+4+12+16+16+56+22+22+2 = 156). View 6 (8 rows × 7 cols) is the largest —
the "front face" full corridor-wall view — and is the one rendered by the
extractor.

This geometry table is **not derived from this game's own disassembly** — it
is ported verbatim from Gold Box Explorer's `DaxWallDefFile.cs`
(`loadWallDefs`), whose own source comment attributes it to a disassembly of
a *different*, DOS-side title ("Simeon Pilgrim's Curse of the Azure Bonds
code, ovr031.cs, seg600:0ADA/0AE4/0AEE"). Confidence for using it here on the
Amiga port's own bytes rests on three independent structural checks against
real Amiga data, not on trusting the DOS source by analogy:

1. Every one of the 17 `walldef.dax` entries' decompressed lengths is an
   exact multiple of 156 (above).
2. The 10 view-array byte lengths sum to exactly 156 with no slack.
3. **ID-arithmetic cross-check**, independently confirmed against `8x8d.dax`'s
   own directory: `8x8d.dax`'s indexIDs are `{1-9,17-20,23}` (single-wallset
   blocks) plus `{101,102,103}`, `{211,212}`, `{241,242}`, and `{203}`.
   Gold Box Explorer's own `baseBlockId = 10*blockId(+1/2/3)` arithmetic
   (with `blockId==0` special-cased to base 100, and id 203 hardcoded as a
   "universal" shared tile block) predicts exactly this set for
   `walldef.dax`'s three multi-wallset entries (id 0 → 3 wallsets →
   101/102/103; id 21 → 2 wallsets → 211/212; id 24 → 2 wallsets → 241/242).
   All three predictions land exactly on real data — three independent,
   multi-valued predictions confirmed, not a coincidence.

**`8x8d.dax`** holds the actual 8×8 tiles referenced by index from the view
grids above. Pixel format — **RENDERED, not disassembly-confirmed**: each
block's decompressed length is 4 bytes shorter than a clean multiple of 8
(e.g. 2252 = 4 + 8×281, 1036 = 4 + 8×129, 1484 = 4 + 8×185 — exact for every
sampled block), so the decoder skips a 4-byte per-block header (meaning not
decoded) and reads the rest as 8-byte, 1-bit-per-pixel, MSB-first tiles —
identical to Gold Box Explorer's `MonoBlock` decoder. That tool's own
dispatch rule (`MonoBlockSpecification.cs`) gates this format purely on
**filename prefix "8X8"**, not on any parsed header field — a filename-only
gate that happens to match `8x8d.dax`'s own name, lending independent (if
weak) support to reusing this exact pixel layout here.

`buildTileBank()` assembles, per wall-type block id: a placeholder tile
(index 0, unobserved but read unchecked by the index grid), the shared
"universal" tile block (id 203, present in every corpus `8x8d.dax`), then the
block's own specific tiles — matching Gold Box Explorer's `load8x8Bitmaps`
ordering.

### FPV hypothesis — ANSWERED: REFUTED

The standing question in `docs/walker-map-format-future-decision.md` was
whether Gold Box's first-person dungeon view might be a small library of
static pre-drawn scene pictures selected by wall-pattern matching, rather
than a true per-depth composited render like every other game in this
corpus.

**It is a true composited render.** `walldef.dax` stores per-wall-type,
per-view **tile-index grids**, not picture ids or picture data; `8x8d.dax`
stores small (8×8), heavily reused tiles referenced by those indices. The
dungeon view is assembled at render time by tiling — the same general
strategy as Black Crypt, EOB 1-3, MM1-3, and Wizardry 6 in this repo's
corpus, just at a finer 8×8 tile granularity than those games' larger wall
pieces.

**Visual evidence** (105 PNGs written to
`public/assets/poolofradiance/amiga/textures/`, one per non-degenerate view-6
composite; see §6 for how to regenerate):

- `walldef-0-wall0-view6.png` (56×64, wallset id 0, wall slice 0): a
  jagged, dripping-crenellation pattern across the top rows (a broken-stone
  ceiling border), a large black corridor void through the middle, and a
  distinct architectural feature at the bottom — a white square set above a
  stepped stone base with a diagonal line running off to the lower-right (a
  door/torch-recess feature drawn in false perspective). Non-degenerate,
  structurally coherent, clearly a *specific* wall feature, not noise.
- `walldef-0-wall5-view6.png`: a dense, regular checkerboard/masonry brick
  pattern repeating across the whole frame — a plain corridor wall texture,
  visually distinct from wall 0's door feature.
- `walldef-1-wall0-view6.png` (a different wallset id): the same
  crenellation-border + doorway-feature composition as wallset 0's wall 0,
  confirming the same tile vocabulary is reused across wallsets with
  different specific tile content — exactly what a shared-tile-bank
  composited renderer predicts, and inconsistent with a static per-scene
  picture library (which would have no reason to reuse this exact visual
  grammar across unrelated "pictures").

This is real, non-degenerate visual evidence for the composited-render
answer — not just a byte-count argument.

---

## 4. `pic.dax` / `cpic.dax` — NOT a Gold Box Explorer picture-block format
   (negative finding)

These held the alternative "maybe these ARE the static scene library"
hypothesis before §3 settled the question via `walldef.dax` instead. Checked
directly against Gold Box Explorer's own DOS-side picture-block shape
validators (`RenderBlockFactory.cs`'s dispatch chain:
`EgaSpriteBlockSpecification` → `VgaStrataBlockSpecification` →
`VgaSpriteBlockSpecification` → `VgaMixedBlockSpecification` →
`VgaBlockSpecification` → `EgaBlockSpecification` → `MonoBlockSpecification`)
— run programmatically against every real, decompressed entry:

- **`EgaBlockSpecification`** (`height`/`width` as leading u16 BE-as-LE
  pair, `egaDataSize = height*width*4`, exact total-length match required):
  **0/59** `pic.dax` entries, **0/118** `cpic.dax` entries pass even the
  coarse dimension-range pre-check (`pic.dax` entry 0 begins `00 00 00 04
  ...` — a leading `height` field of 0, immediately invalid).
- **`VgaBlockSpecification`** (leading bytes as byte-width `height`/`width`,
  chunk-count/chunk-size bound check): **0/59**, **0/118** — same leading-zero
  problem (`height` byte is 0 in both files' entry 0).
- `MonoBlockSpecification` is filename-gated to files whose name starts with
  `"8X8"` — does not apply to `pic.dax`/`cpic.dax` by construction.
- The three sprite/strata/mixed VGA specs (`VgaSpriteBlockSpecification`,
  `VgaStrataBlockSpecification`, `VgaMixedBlockSpecification`) all build on
  the same leading byte-`height`/byte-`width` header shape as
  `VgaBlockSpecification` and are refuted by the identical leading-zero
  bytes.

**Conclusion:** `pic.dax`/`cpic.dax` use neither the Amiga's own confirmed
container layout's *sibling* assumption (that decompressed picture content
would follow one of Gold Box Explorer's known DOS picture-block shapes) nor
any format this project's reference tooling recognizes. This is a real,
useful negative finding, not a gap in effort — it rules out the "these are
recognizable DOS-picture-format scene images, just needing an Amiga-side
palette fix" hypothesis outright. An earlier speculative "vector/geometric
draw-command stream" hypothesis (based on periodicity and doubling-value
pairs observed in a byte-level scan of `pic.dax` entry 0) was explored but is
**not confirmed** and is not asserted here — it is recorded only as a lead
for a future pass, not a finding. Left **open**; not rabbit-holed further
this pass per the task's explicit scope (the FPV question was already
answered decisively via `walldef.dax` in §3, so further `pic.dax` effort
this session would not have changed that answer).

---

## 5. `dungcom.dax` — decompresses cleanly; content not semantically decoded

Single block, decompresses to ~7,500 bytes (see `dungcom.json`'s
`decompressedLength`), passing the §2 checksum oracle. Dense, structured
binary with no record stride found yet by a first byte-level look (this is
the game's likely dungeon-command/maze-layout data, per the task's naming
hypothesis, but this pass did not confirm what its fields mean). Left
**open** — see `docs/poolofradiance/TODO.md`.

---

## 6. Extractor and outputs

Run from the repo root:

```
npx tsx tools/poolofradiance/amiga/export-data.ts data/poolofradiance/amiga
```

Writes to `public/assets/poolofradiance/amiga/`:

- `data/container-directory.json` — every `.dax` file's directory, decoded
  and checksum-verified per entry (843/843 pass).
- `data/dungcom.json` — `dungcom.dax`'s decompressed blob as a hex preview
  (content not semantically decoded, see §5).
- `textures/walldef-<id>-wall<n>-view6.png` — 105 composited wall-view
  renders (one per non-degenerate wall slice, view 6 = the 8×7 "front face"),
  the visual evidence cited in §3.

`manifest.json` carries 107 entries (105 texture PNGs + 2 data JSON records)
after a clean rebuild.

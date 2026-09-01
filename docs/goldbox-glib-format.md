# "GLIB" container — SSI Gold Box (Amiga), Curse of the Azure Bonds / Secret of the Silver Blades / Pools of Darkness

Shared container format used by the Amiga ports of three sibling SSI Gold Box
titles staged in this repo: **Curse of the Azure Bonds** (1989,
`data/curseoftheazurebonds/amiga/`), **Secret of the Silver Blades** (1990,
`data/secretofthesilverblades/amiga/`), and **Pools of Darkness** (1991,
`data/poolsofdarkness/amiga/`). Cracked once here; each title's own
`docs/<game>/amiga/data-structure.md` references this doc rather than
re-explaining it.

Implementation: `tools/shared/goldbox-glib.ts` (container/directory),
`tools/shared/goldbox-glib-codecs.ts` (the two payload compression codecs,
§5) and `tools/shared/goldbox-walltiles.ts` (wall-slice geometry + 8x8 tile
decode, built on top of them). Per-title extractors:
`tools/curseoftheazurebonds/amiga/export-data.ts`,
`tools/secretofthesilverblades/amiga/export-data.ts`,
`tools/poolsofdarkness/amiga/export-data.ts`.

## 0. Relationship to Pool of Radiance's `.dax`

**This is a genuinely different container AND codec from Pool of Radiance's
`.dax`** (`docs/poolofradiance/amiga/data-structure.md`), despite the four
titles sharing an engine lineage and identical base filenames
(`WALLDEF`, `8X8D`, `PIC`, `CPIC`, `DUNGCOM`, `SPRIT`, `BODY`, `HEAD`, `ECL`,
`GEO`, `ITEM`, `MONCHA`, `MONITM`, `MONSPC`, etc — PoR uses `.dax` for all of
these; the three sibling titles use `.GLB`/`.TLB` extensions per-file, see
each title's own §0). **This was directly checked against real bytes, not
assumed to differ (or match) from the filename correspondence alone**:

| | Pool of Radiance `.dax` | GLIB (this doc) |
|---|---|---|
| Header | 2-byte BE `headerSize` | 4-byte magic `"GLIB"` + 4-byte BE `totalSize` |
| Directory entry | 10 bytes: `[u16 id][u32 relOffset][u16 compressedLen][u16 decompressedLen]` | cumulative `u32` BE **absolute** offsets, no separate length fields |
| Compression | custom backward-reading bit-oriented LZ77, XOR-checksummed | **per-container, selected by `flags >> 8`** — see §5. Top-level containers are always stored (method 0); *nested* sub-containers are usually compressed (method 3 = 10-bit LZW, method 5 = byte LZ77) |
| Content-type tag | none (id ranges imply role) | explicit 4-byte ASCII tag per container (`"DATA"`, `"TILE"`, `"TEXT"`, `"DIG8"`, `"GLIB"`/`"HLIB"` for nesting) |

The container divergence is real, but the compression row above was
originally recorded as "none — every payload is raw" and **that was wrong**:
top-level containers are stored, which is what a first-pass survey sees, but
their *nested* sub-containers are usually compressed with one of two codecs
of their own. See §5 — this cost a whole pass, because the nested payload
looks like a container with a broken header rather than like compressed data.

## 1. Container layout — CONFIRMED, 65/72 real `.GLB`/`.TLB` files corpus-wide

(the remaining 7 are real truncated/corrupted floppy dumps, not a format
divergence — see §3)

```
offset 0   magic        "GLIB" (4 bytes)
offset 4   u32 BE       totalSize    -- equals the file's own real byte
                                        length for every healthy file.
offset 8   u16 BE       blockCount   -- number of blocks in the offset table
                                        that follows, INCLUDING the
                                        directory/index block itself
                                        (block 0).
offset 10  u16 BE       flags        -- LOW byte: bit 0 set = block 0 is an
                                        (id, blockIndex) remap table (§2).
                                        HIGH byte: compression method id for
                                        this container's own payload (§5) --
                                        0 = stored, 3 = 10-bit LZW,
                                        5 = byte-oriented LZ77. CONFIRMED
                                        from the games' own loaders; see §5.
offset 12  tag          4-byte ASCII content-type tag.
offset 16  u32 BE[blockCount+1]      cumulative ABSOLUTE file offsets.
                                        offsets[0] == 16 + 4*(blockCount+1)
                                        (right after this table);
                                        offsets[blockCount] == totalSize.
                                        Block i spans [offsets[i], offsets[i+1]).
```

**Verification** (`tools/shared/goldbox-glib-export.ts`'s
`container-directory.json` output, run per title): across all `.GLB`/`.TLB`
files in all three titles' raw floppy dumps (72 files total), **65/72**
(90.3%) chain with zero deviation — `offsets[0]` matches the predicted
header-end position and the offset table is monotonically non-decreasing,
in every one. The other 7 are a real, diagnosable data-integrity issue (§3),
not a format variant.

A benign, non-fatal 1-byte edge case exists on a couple of files (Curse's
`STRINGS.GLB`, Secret's `MONCHA.GLB`): their last cumulative offset is
exactly 1 byte short of `totalSize` (e.g. `3717` vs `totalSize=3718`). This
looks like a single unused trailing pad byte, not corruption — every other
offset in both files chains perfectly, and `totalSize == fileSize` exactly
in both cases.

## 2. The index/directory block (`decodeGlibIndex`)

When `flags & 1`, block 0 (i.e. `blocks[0]`, the span
`[offsets[0], offsets[1])`) holds:

```
u16 BE  numEntries
numEntries x {
  u16 BE  id           -- sparse; NOT required to be ascending (Secret's
                           WALLDEF.GLB index lists ids in file order
                           7,10,21,19,1,6,9,15,3,13 — confirmed directly,
                           not assumed sorted).
  u16 BE  blockIndex    -- 1-based index into the SAME container's own
                           `blocks` array (i.e. `blocks[blockIndex]` is
                           this id's real data span).
}
```

Files with `flags & 1 == 0` (e.g. `ALWAYS.TLB`, `DUNGCOM.TLB` in some disk
images, `SOUNDS.GLB`) have no index block — their entries are referenced by
plain sequential position instead.

Nested containers exist: a top-level container whose own tag is `"GLIB"` or
`"HLIB"` (rather than `"DATA"`/`"TILE"`/`"TEXT"`/`"DIG8"`) means each of its
blocks is itself another GLIB container — confirmed one level deep on every
file sampled (`8X8D.TLB`'s outer id-buckets each nest a `"TILE"`-tagged
sub-container of raw tile-group blocks; `PIC.TLB`/`CPIC.TLB`/`SPRIT.TLB`/
`BIGPIC.TLB` also use this nesting for their own still-uncatalogued payload
kinds — see the per-title TODOs).

**A nested sub-container's payload is usually compressed**, so
`parseGlibContainer(data, block.start)` is only valid when
`glibCompressionMethod(data, block.start) === 0`. The general call is
`parseGlibContainer(decompressGlibBlock(data, block), 0)` — see §5.
Corpus-wide, 318 of 326 nested `"TILE"` sub-containers are compressed.

## 3. Truncated/corrupted files — a real dump-integrity finding, not a format variant

7 files across the whole corpus have a `totalSize` field far exceeding the
file's real on-disk length, and a garbage (non-monotonic, wildly
out-of-range) offset table past the 16-byte header:

| File | declared `totalSize` | actual file size |
|---|---|---|
| `secretofthesilverblades/amiga/DISK1/ALWAYS.TLB` | 31,226 | 18,426 |
| `secretofthesilverblades/amiga/DISK2/TITLE.TLB` | 69,278 | 53,674 |
| `poolsofdarkness/amiga/DISK1/ALWAYS.TLB` | 4,400 | 2,010 |
| `poolsofdarkness/amiga/DISK1/COMSPR.TLB` | 19,306 | 8,538 |
| `poolsofdarkness/amiga/Disk3/CBODY.TLB` | 57,370 | 14,914 |
| `poolsofdarkness/amiga/Disk3/CHEAD.TLB` | 5,010 | 1,270 |
| `poolsofdarkness/amiga/Disk3/GEN.TLB` | 10,890 | 3,254 |

**An earlier hypothesis — that the `flags` field's non-`0`/`1` high bits
(all 7 of these show `0x0500` or `0x0501`) signal this — was tested and
REFUTED.** The `totalSize`-vs-`fileSize` mismatch is the correct and
sufficient signal for truncation.

> **Correction (2026-08-30):** the refutation's *conclusion* stands but its
> *reasoning* was wrong, and the wrongness mattered. It argued that
> `0x0500` "also occurs on files that decode perfectly cleanly, e.g.
> Secret's `DISK1/8X8D.TLB`'s nested `"TILE"` sub-containers … with a clean,
> self-consistent offset table". Those sub-containers do **not** have a
> clean offset table on disk — they are LZ77-compressed, and their table
> only appears after decompression. `flags >> 8` is a real, meaningful
> field: the compression method (§5). It is unrelated to truncation, so the
> conclusion survives; the "these bits mean nothing" gloss it left behind is
> what kept the nested tile-bank layout unsolved for a whole pass.

Every one of the 7 affected files is a large `"TILE"`-tagged sprite/portrait
bank (combat body/head art, the "always visible" sprite set, a title-screen
asset, a general sprite bank) — content that would span many floppy sectors.
The same base filename (`CBODY.TLB`, `TITLE.TLB`, `ALWAYS.TLB`) decodes
perfectly cleanly in OTHER disk images across this same 3-title corpus (e.g.
Curse's and Secret's own `CBODY.TLB` copies are both structurally healthy),
which rules out a per-content-type format quirk — this is diagnosed as real,
per-disk-image floppy dump truncation/corruption (a bad read on specific
physical media, most likely), not a second container variant. Left as a
genuine data-quality caveat, not re-derived further; no static analysis can
recover bytes that were never captured.

> **Correction (2026-09-01, Dark Queen/Gateway/Treasure pass): this whole
> diagnosis was wrong for all 7 files — they are not truncated, they are
> legitimately COMPRESSED at the TOP LEVEL.**
>
> Until this pass, `flags >> 8` compression (§5) was only ever observed on
> NESTED sub-containers one level inside an outer, always-uncompressed
> top-level GLIB file. The Dark Queen of Krynn corpus breaks that pattern:
> several of its own top-level `.TLB` files (`ALWAYS`, `COMSPR`, `TOPVIEW`,
> `GEN`, `CBODY`, `FRAME`) are compressed at the OUTERMOST level too — the
> file's own leading 16-byte header describes the container **after**
> decompression, exactly as §5 already established for nested blocks, just
> one level shallower than anyone had checked. Once that possibility was
> considered, it retroactively re-explains all 7 files above without
> exception: each one's declared `totalSize`/garbage offset table is not
> corruption, it's the correct decompressed-image header sitting on top of a
> real compressed payload nobody had tried decompressing, because the whole
> file was assumed to already be a plain (method-0) container.
>
> `loadGlibFile()` (`tools/shared/goldbox-glib-codecs.ts`) is the fix: it
> checks a freshly-read top-level file's own `flags >> 8` BEFORE calling
> `parseGlibContainer`, and decompresses first when it's nonzero. Every
> extractor (`goldbox-glib-export.ts` and all six per-title `export-data.ts`
> scripts) now reads top-level files exclusively through this function. The
> "truncated" diagnosis is retired; `isTruncated()` still exists (a
> `totalSize !== data.length` check makes sense as a post-decompression
> sanity check) but nothing calls it to explain missing bytes as damage
> anymore. See `docs/darkqueenofkrynn/amiga/data-structure.md` §1 for the
> per-file confirmation on the title that surfaced this.

## 4. Wall-slice geometry and 8x8 tile format — see `tools/shared/goldbox-walltiles.ts`

The 156-byte wall-slice / 10-view-sub-array geometry (Pool of Radiance's
`walldef.dax` format) transfers **unchanged, byte-for-byte** to all three
sibling titles' own `WALLDEF.GLB` files, and their per-wall-id 8x8 tile-bank
schemes reuse PoR's exact `10*id + n` multi-wallset composite-id arithmetic.
See each title's own `data-structure.md` §2/§4/§5 for the full per-title
verification counts and the still-open per-wall-id tile-pixel-layout puzzle.

## 5. Compression — `flags >> 8` selects the codec (CONFIRMED, code-derived + byte-exact oracle)

**This section supersedes §0's earlier "no compression at all" claim and the
per-title "the nested tile-bank sub-container header is inert boilerplate"
finding.** A nested sub-container's 16-byte header is genuine and is read by
the game — it describes the container **after decompression**. That is why,
inside one `8X8D.TLB`, every per-wall-id entry declares the same
`totalSize`/`blockCount` (every wall bank in a given game has the same
decompressed shape) while the outer directory allocates each of them a
different, smaller span.

Implementation: `tools/shared/goldbox-glib-codecs.ts` (`decompressGlibBlock`,
`glibCompressionMethod`), which returns the sub-container's full in-memory
image (its own unmodified 16-byte header + decompressed body) so
`parseGlibContainer` / `readBlock` apply to it unchanged.

### 5.1 Where the method id lives

The **high byte of the `flags` word** (container + 10) is the compression
method. Confirmed by disassembly of Curse's own container reader:

| Site | Instruction | Meaning |
|---|---|---|
| `Curse` CODE+0x3D2F6 | `tst.b -0x6(a5)` | tests that byte of the 16-byte header just read into `-0x10(a5)` |
| `Curse` CODE+0x3D300 | `move.b -0x6(a5),d0` … `jsr` CODE+0x3D1B6 | passes it, sign-extended, as the decompress driver's last argument |
| `Curse` CODE+0x3D292 | `subq.w #1,d0 / beq …` ×3 | dispatches methods 1, 2, 3; anything else is a no-op |
| `Secret` CODE+0x418CE | `cmpi.w #6,d0 / move.w 0x418C2(pc,d0.w),d0 / jmp 0x418DC(pc,d0.w)` | 6-entry word jump table at CODE+0x418C2 = `0002 ff7c ff8e ffa4 ffbc ffd4`, i.e. methods 0..5 |

(All addresses are **CODE-hunk-relative**: `fileOffset − 40` for all three
executables, whose single `HUNK_CODE` payload starts at file offset 40.)

Methods actually used by shipped data, across all 326 nested `"TILE"`
sub-containers in the three titles: **0** (stored, 8×), **3** (10-bit LZW,
102×), **5** (byte LZ77, 216×). Methods 1 (plain `memcpy`), 2 and 4 exist in
code but no shipped file selects them. Curse's executable implements 1/2/3
only — consistent with Curse being the only title whose data uses method 3,
and Secret/Pools being the only ones that use method 5.

### 5.2 Framing shared by every compressed method

From the driver at `Curse` CODE+0x3D1B6 (`Secret` CODE+0x417AE is the same
routine):

```
payload      = the sub-container's bytes AFTER its 16-byte header
slack        = BE u16 at payload[0..2)
stream       = payload[2..]                 <- codec input starts here
outputLength = header.totalSize - 16        <- codec output length
```

The game decompresses **in place**. It grows the buffer by
`totalSize − allocatedSize + slack` bytes at the payload start (`Curse`
CODE+0x3D1F6 reads the slack word; CODE+0x3D20A performs the insert), which
slides the compressed bytes to the end of the enlarged region, then runs the
codec forward with the read pointer permanently ahead of the write pointer
(`a2 = a3 + d4 + 2` at CODE+0x3D21E). `slack` is the head-room the compressor
measured as necessary to keep the writer from catching the reader — it is not
part of the codec.

Output is produced in chunks of at most `0x2000` bytes (CODE+0x3D23E); each
chunk is an independently framed codec call. Method 3 re-primes its bit
register per chunk but its dictionary persists across chunks of the same
block (saved to / restored from workspace offset `0x1002`); method 5 ends
each chunk with an explicit terminator token.

### 5.3 Method 3 — 10-bit LZW

Entry `Curse` CODE+0x3D55E; main loop CODE+0x3DAE2; string expansion
CODE+0x3DA8C; workspace init CODE+0x3D4F0; dictionary prune CODE+0x3D472.

Codes are **fixed 10 bits**, MSB-first, packed continuously (4 codes per 5
bytes). The bit reader keeps a 16-bit shift register:

```
reg   = BE16(stream[0..2]); pos = 2      // first code = reg >> 6
shift = 6
loop:
  if shift != 0: reg = ((reg << 8) | stream[pos++]) & 0xFFFF; shift -= 2
  else:          reg = BE16(stream[pos..pos+2]); pos += 2; shift = 6
  code = (reg >> shift) & 0x3FF
```

The dictionary lives in a 0x1004-byte workspace:

| Offset | Size | Field |
|---|---|---|
| `0x0000` | `u8[1024]` | slot state: `0` free, `1..0x7F` referenced, `0x80..0xFF` in use |
| `0x0400` | `u8[2]` | always `0` — sentinel that terminates the free-slot scan at 0x400 |
| `0x0402` | `u8[1024]` | suffix byte per code; `0..255` initialised to identity |
| `0x0802` | `u16[1024]` | prefix code per code; `0..255` initialised to `0xFFFF` |
| `0x1002` | `u16` | next free code, initialised to `0x100` |

Per code: expand it (recursively walk `prefix`, emitting `suffix` bytes,
root first), remember the expansion's **first** byte, then add a new entry
`(prefix = previous code, suffix = that first byte)` at the next free slot
and advance the free-slot scan.

Unusually, the dictionary is **never cleared**. When the scan reaches `0x400`
the prune routine runs: repeatedly free every in-use entry that no surviving
entry references as a prefix (i.e. every leaf), never freeing the code just
emitted, until at least `0x55` slots are free; allocation then resumes from
the lowest freed slot. Because slots are recycled, code numbers are not
monotonic after the first prune.

### 5.4 Method 5 — byte-oriented LZ77

Entry `Secret` CODE+0x41798 → CODE+0x454FC. The output-length argument the
caller passes is ignored; the stream ends on its own terminator.

| Lead byte | Token size | Meaning |
|---|---|---|
| `0x00-0x7F` | 2 | short match: emit `(b1>>3)&3` literals, then copy `(b1&7)+3` bytes from `dst − dist − 1` where `dist = ((b1<<2)&0x380) \| b0` |
| `0x80-0xBF` | 3 | long match: emit `b2&3` literals, then copy `(b1&0x1F)+3` bytes from `dst − dist − 1` where `dist = (b0&0x3F) \| ((b1&0xE0)<<1) \| ((b2<<7)&0x7E00)` |
| `0xC0-0xCF` | 1 | literal run of `((b0&0xF)+1)*4` bytes |
| `0xD0-0xDF` | 1 | literal run of `b0&0xF` bytes |
| `0xE0-0xFF` | 1 | end of chunk |

A match's literals are emitted **before** the copy, and the copy source is
measured from the write cursor *after* those literals, so a match may overlap
the cursor — copy one byte at a time (run-length semantics). Maximum
distances are 1024 (short) and 32768 (long); lengths 3-10 and 3-34.

### 5.5 Verification

| Oracle | Result |
|---|---|
| Declared decompressed length | **326/326** nested `"TILE"` sub-containers across all three titles produce exactly `totalSize − 16` bytes. 0 failures. |
| Decompressed body is a well-formed GLIB body | **326/326**: `offsets[0] == 16 + 4*(blockCount+1)`, `offsets[blockCount] == totalSize`, monotonic throughout. This is the container's own redundant self-description, checked against the decoder's output — it cannot pass by accident. |
| Input fully consumed | **318/318** compressed sub-containers leave **0 or 1** unconsumed input bytes (never more), matching the stream's own declared `slack` head-room. |
| **Byte-exact cross-title oracle** | Secret's `DISK1/8X8D.TLB` id 202 — 242 compressed bytes, method 5 — decompresses to 884 bytes that are **identical, 884/884, zero deviation**, to Curse's `DISKA/8X8D.TLB` id 202, which the same corpus stores **uncompressed** (method 0). The two games ship the same universal tile bank, one packed and one not. Its sibling id 203 decodes to exactly 2344/2344 bytes with 854/854 input consumed and differs from Curse's copy in only 40 bytes of tile pixels — genuine per-game content difference, not decode drift. |
| Independent reimplementation | A from-scratch Python reference and the committed TypeScript port produce **SHA256-identical** output for all 326 containers. |
| Render | Curse `DISKB/8X8D.TLB` id 1 (method 3) decompresses to 70 blocks of exactly 48 bytes = 6 raw 8-byte 1bpp tiles each, zero remainder, and `WALLDEF.GLB` wall 1's view grids render as a clean, regular, repeating decorative wall pattern across all 5 slices — decisively unlike the "salt and pepper" noise every pre-decompression hypothesis produced. |

### 5.6 Still open — the tile-bank index unit

Decompression settles the byte layout; one downstream question remains.
Every per-wall-id bank has a striking uniform block structure — Curse and
Secret: **70 blocks of exactly 48 bytes** (6 tiles); Pools of Darkness:
**256 blocks of exactly 56 bytes** (7 tiles) plus one 104-byte block 0 — and
the universal id-203 bank in both Curse and Secret is **45 blocks of 48
bytes**. Against that, `WALLDEF.GLB`'s tile bytes give a maximum index of
115 for 1-wallset walls, 185 for 2-wallset walls and 255 for 3-wallset
walls, with index 0 never used on walls that have no blank cells.

`1 + 45 + 70 = 116`, `1 + 45 + 70*2 = 186`, `1 + 45 + 70*3 = 256` — an exact
fit for "index 0 = blank, then the universal bank's 45 **blocks**, then each
wallset's 70 **blocks**", and Pools' 256 blocks against a byte index is the
same story. That argues the walldef byte selects a whole 48/56-byte block,
not one 8x8 tile. Against it: Pool of Radiance's own confirmed geometry
treats each view-grid cell as a single 8x8 tile, and Secret's walls 7/13
(max index 236) and 15 (193) do not fit the arithmetic with the wallset
counts their slice counts imply. Both readings render as plausible art
(rendering the flat tile bank at index face value already gives coherent,
repeating wall texture). Tracked as `caob-tile-bank-index-unit`.

### 5.7 Integration (2026-08-30, same session): scheme 2 wired up and shipped, using the "index = one 8x8 tile" reading

`decodeGlibTileBucket`, `resolveCompositeWallId`, and
`buildWallSpecificTileBank` (`tools/shared/goldbox-walltiles.ts`) compose the
per-wall-id scheme-2 tile bank; `tools/shared/goldbox-glib-export.ts` wires
it into all three titles' extractors, writing `walldef2-<id>-wall<n>-
view6.png` renders (Curse 90/90, Secret 95/95, Pools 90/90 — 0 "no scheme-2
entry" misses, 0 out-of-range skips, all three corpora). This also fixed a
real bug in `buildFlatTileBank` itself: it previously called
`parseGlibContainer` directly on a nested block's on-disk bytes, which
"succeeds" (the 16-byte header parses fine) but silently misreads the
still-compressed offset table as real offsets on any bucket that isn't
method 0 — `decodeGlibTileBucket` fixes this for both scheme 1 and scheme 2
callers by always decompressing first.

**One further composite-arithmetic subtlety found during integration, not
previously documented**: a composite id covers a fixed run of **5** raw wall
slices (one wallset), not one slice each. A WALLDEF entry with N slices has
`N/5` wallsets; wallset `w` (0-based) maps to `10*baseId + (w+1)` only when
no *direct* `baseId` entry exists in the scheme-2 file. Trying the direct id
first — rather than branching on title — is what lets one code path cover
Curse/Secret's composite ids AND Pools of Darkness's own direct-only
simplification (§2) without special-casing either.

The tile-vs-block index-unit question (§5.6) is genuinely still open — these
renders use the tile reading (matching Pool of Radiance's own confirmed
convention) and are labelled RENDERED, not CONFIRMED. Non-degeneracy
checked by a flat-pixel-value scan (Curse 90/90, Secret 90/95, Pools 83/90
non-degenerate; the remainder are legitimate all-placeholder "nothing to
draw" views, not errors) and spot-checked visually (clear structured
horizontal-band/doorway and diagonal/herringbone patterns, not noise).

> **Correction (2026-08-31, `re-oracle` escalation):** `caob-tile-bank-index-unit`
> (§5.6) is now CONFIRMED, resolved as a byproduct of the GEO plane-0/1
> escalation (§7.2). The decompiled DOS *Curse of the Azure Bonds* source's
> `Put8x8Symbol` (`ovr038.cs`) defines a global 8x8-glyph symbol-id space —
> id 0 invalid, ids 1-0x2D (45) universal, then 70 ids per wallset slot
> (`0x2E-0x73`, `0x74-0xB9`, `0xBA-0xFF`) — matching this section's
> `1 + 45 + 70k` block arithmetic exactly. A WALLDEF tile byte indexes one
> whole bank BLOCK (= one glyph/symbol), not a single raw 8x8-tile-plane
> byte; the "index = one 8x8 tile" reading this repo shipped happens to
> coincide with the correct one for PoR's own simpler (single-scheme, no
> wallset banking) `WALLDEF` geometry, which is why its renders were never
> wrong — but the general rule for the GLIB titles' per-wall-id banked
> scheme is "one byte = one glyph block", confirmed, not merely a coincident
> plausible render. See §7.2 for the source citation and file offsets.

## 7. GEO — the dungeon/city 16x16 square grid (2026-08-31)

This section applies to **all four** sibling titles, including Pool of
Radiance — GEO's record shape is byte-for-byte identical whether it arrives
via PoR's `.dax` (`geo.dax`) or the GLIB container (`GEO.GLB`), so it is
documented once here rather than four times. Implementation:
`tools/shared/goldbox-geo.ts` (decoder) + `tools/shared/goldbox-dungeon-export.ts`
(shared extractor step, wired into `tools/poolofradiance/amiga/export-data.ts`
directly and into `tools/shared/goldbox-glib-export.ts`'s `geoPath` option for
the other three). This is the format the task's standing "no dungeon maze
grid exists yet" gap needed — see each title's own `TODO.md`.

### 7.1 Container — CONFIRMED, one fixed-size record per level

`GEO.GLB`/`geo.dax` holds one record per playable map/level, keyed by the
container's own id (PoR: `geo.dax`'s directory `indexID`; the GLIB titles:
`GEO.GLB`'s index-block `id` — GEO.GLB is always a top-level, uncompressed
"DATA"-tagged container, so `readBlock` gives the record bytes directly with
no decompression step, per §0/§5 above). Every record is **exactly 1024
bytes** (PoR: 1026 bytes decompressed, of which the leading 2 bytes are a
CONSTANT `0x0004` tag on literally every one of its 29 entries — not
per-level data — followed by the same 1024-byte record). Verified
corpus-wide, zero deviation: PoR 29/29 entries, Curse 16/16 blocks, Secret
17/17, Pools 32/32, every one exactly 1024 (+2 for PoR) bytes.

> **Update (2026-09-01): The Dark Queen of Krynn uses a VARIABLE-size record
> shape instead of the fixed 1024-byte record above.** Its own `Disk3/GEO.GLB`
> records don't divide evenly by 1024/256; each one instead opens with an
> 8-byte header — `u8 width, u8 height`, 6 reserved bytes (always `0` in this
> corpus) — followed by 4 planes of `width*height` bytes each (the same
> plane semantics/order as the fixed-size format, just non-16x16 grids: real
> dimensions observed range roughly 8x8 to 24x20). Confirmed **20/20 zero
> deviation**: every one of this title's records satisfies
> `8 + 4*width*height === payload.length` exactly, and the same cross-cell
> wall-presence self-consistency oracle §7.2 uses agrees at 98.8%/82.4%
> (horizontal/vertical), comparable to the other titles' confirmed grids —
> strong evidence plane 3's bit semantics transfer unchanged despite the new
> variable header. `decodeGeoLevel()` (`tools/shared/goldbox-geo.ts`)
> auto-detects fixed-vs-variable by checking `payload.length ===
> GEO_RECORD_SIZE` first and falling back to the variable-size decoder
> (`decodeVariableGeoRecord`) otherwise, so every existing sibling title's
> extractor call is unaffected. See
> `docs/darkqueenofkrynn/amiga/data-structure.md` §2 for the per-title
> writeup.

### 7.2 Record layout — CONFIRMED end-to-end (2026-08-31, `re-oracle` escalation)

> **Correction (2026-08-31, `re-oracle` escalation):** everything in this
> section below the correction notice describes the FIRST-PASS findings
> (plane 3 CONFIRMED but with backwards value labels; plane 2 a plausible
> guess; planes 0/1 fully open). The escalation found the actual DOS *Curse
> of the Azure Bonds* executable decompiled by the `simeonpilgrim/coab`
> project (same author/technique already trusted for `pooldata.py`) and
> confirmed the Amiga ports run the same engine by locating 4 of its
> constant tables **byte-exact** inside `data/poolofradiance/amiga/program`
> (file-relative offsets): `symbol_set_fix` at `+0x6D53E`,
> `MapDirectionXDelta`/`MapDirectionYDelta` at `+0x6D552`/`+0x6D55B`, and the
> 3D renderer's 10-view `idxOffset` table at `+0x40E8B`. This is strong,
> code-level ground truth, not a fan-doc guess — sources cited:
> `Classes/GeoBlock.cs` (`MapInfo`), `engine/ovr031.cs`
> (`draw_3D_8x8_titles`, `WallDoorFlagsGet`, `getMap_wall_type`,
> `LoadWalldef`, `Load3DMap`), `engine/ovr015.cs` (`MapSetDoorUnlocked`,
> move/bash handlers), `engine/ovr008.cs:655-684` (ECL wallset-slot
> globals), `engine/ovr038.cs` (`Put8x8Symbol`/`Load8x8D`).
>
> **The corrected model, superseding everything below:**
>
> - **Planes 0/1 are wall-art TYPE per direction (0-15), not an ambient
>   per-square property.** Plane 0's high nibble = North wall type, low
>   nibble = East; plane 1's high nibble = South, low nibble = West (same
>   N/E/S/W convention as plane 3). Value 0 = no wall drawn (always
>   passable). Value 1-15 indexes a **level-scoped** 3-slot x 5-slice
>   wallset table: `wallsetSlot = floor((n-1)/5)`, `slice = (n-1)%5)` —
>   which WALLDEF resource occupies each of the 3 slots is written at
>   runtime by that level's ECL bytecode (VM globals `0x322/0x324/0x326`,
>   `ovr008.cs:655-684`), **not present in the GEO record itself**. This is
>   exactly the missing indirection layer that defeated all three static
>   hypotheses below: the nibble names a SLICE, not a resource id, so no
>   direct nibble->WALLDEF mapping can exist without also decoding each
>   level's ECL script (not done this pass). This also explains why the
>   first-pass "populated on fully-open cells too" observation was true and
>   not a refutation of anything — it was testing the wrong semantics
>   (id-space membership) against the right field (wall-art type), not
>   because wall type is unrelated to walls.
> - **Plane 3's bit LAYOUT was right, its VALUE labels were backwards.**
>   Per `WallDoorFlagsGet` (`ovr031.cs:181`) and `MapSetDoorUnlocked`
>   (`ovr015.cs:7`, which WRITES 1 to unlock): `0`=solid/blocked (not
>   "open"), `1`=passable/open arch or unlocked door (not "wall"),
>   `2`=locked door (Bash/Pick/Knock), `3`=locked door, unpickable
>   (Bash/Knock only). Critically, this code is **only consulted where the
>   matching direction's wall type (planes 0/1) is non-zero** — corpus-wide,
>   a plane-3 code != 0 with no matching wall art is near-nonexistent
>   (88/16,896 fields in PoR, 3/5,168 in Secret, 13 in Pools, 59 in Curse).
>   The original self-consistency oracle (§ below) is unaffected — it tested
>   shared-wall PRESENCE agreement, which is value-symmetric and blind to
>   which value means what; only the 0/1/2/3 *meaning* was inverted, not the
>   N/E/S/W bit assignment. See
>   `game-re-lessons/format-doc-semantic-labels-swapped.md`.
> - **Plane 2 is CONFIRMED (source-backed), not just a plausible guess**: the
>   `mapWallRoof` byte, read verbatim by ECL bytecode (VM read location 4).
>   Bit 7 = roofed/indoor (selects indoor vs outdoor sky colour,
>   `ovr029.cs:21-32`), bit 6 = city special-tile flag (`ovr011.cs:518`), low
>   bits = zone/special-square id consumed by ECL scripts. Still not used by
>   the walker (no lighting/sky-colour distinction implemented).
>
> `tools/shared/goldbox-geo.ts` implements the corrected model (`GeoCell`
> now exposes `wallN/E/S/W` — the 0-15 type — and `doorN/E/S/W` — the
> corrected 0-3 code — plus `isBlocked()`/`isDoor()`/`wallSlotSlice()`
> helpers); `tools/walker/games-goldbox.ts` was updated to collide on
> `isBlocked()` (wall type != 0 AND door code == 0) instead of the old,
> backwards `code===0||code===2` rule, which silently treated ~75-87% of
> real solid walls as passable. Re-verified corpus-wide after the fix: all
> four extractors still decode their full level counts (PoR 29/29, Curse
> 16/16, Secret 17/17, Pools 32/32) with the corrected field shape, and the
> proportion of wall-drawn sides that are solid (door code 0) is 70-87%
> across all four titles' first levels — a sane, non-degenerate rate.
> `caob-tile-bank-index-unit` (§5.6) was resolved as a byproduct — see the
> correction note there. The `*-geo-plane01` TODO rows are now CLOSED.
>
> Everything below this notice is the first-pass write-up, kept for its
> still-valid evidence (the self-consistency oracle numbers, the corpus
> statistics that motivated each refuted hypothesis) — read it as history,
> not as the current model.

### 7.2 (first-pass, corrected above) Record layout — CONFIRMED for plane 3 bit layout, STRUCTURAL for plane 2, OPEN for planes 0/1

The 1024-byte record is **four consecutive 256-byte planes** over a 16x16
grid (256 cells, `y*16+x` row-major) — NOT four interleaved bytes per cell.
This was itself an empirical finding: interleaving the 4 bytes per cell
produces spatially incoherent byte grids (no border/room coherence); slicing
into four 256-byte planes instead produces four clearly distinct, spatially
coherent data classes.

**Plane 3 (bytes 768-1023) — CONFIRMED wall/door connectivity code.** Each
byte packs four 2-bit fields: bits[0:2]=North, bits[2:4]=East,
bits[4:6]=South, bits[6:8]=West. Field values: `0`=open, `1`=wall, `2`=door,
`3`=a third, much rarer type (plausibly a secret door — no further evidence
this pass). This is the maze grid the walker (`tools/walker/games-goldbox.ts`)
is built on.

Verified via a self-consistency oracle, not disassembly, since no ground
truth beyond the games' own bytes was available: a wall shared by two
adjacent cells should agree on "wall present" from both sides — cell
`(x,y)`'s East field should agree with cell `(x+1,y)`'s West field, and cell
`(x,y)`'s South field with cell `(x,y+1)`'s North field. All 24 permutations
of which 2-bit field is which compass direction were tried (`itertools.
permutations` over `{0,2,4,6}`, both a horizontal-neighbour and a
vertical-neighbour agreement rate computed for each). The assignment above
scored decisively above every other permutation, on **every** title:

| Title | Horizontal agreement | Vertical agreement | Best of the other 23 permutations |
|---|---|---|---|
| Pool of Radiance | 95.3% | 95.4% | 55.7% |
| Curse of the Azure Bonds | 90.8% | 91.6% | 55.7% |
| Secret of the Silver Blades | 96.5% | 97.5% | ~55% |
| Pools of Darkness | 96.6% | 95.1% | ~55% |

The residual few percent disagreement is attributed to genuine one-way
features (secret doors, map-edge boundaries where the neighbour is off the
16x16 grid's used area) rather than a decode error — it is not remotely close
in magnitude to the wrong-permutation baseline.

**Plane 2 (bytes 512-767) — STRUCTURAL hypothesis: special-square/event
index.** Mostly `0x00` (no special content on this square); sparse nonzero
values cluster into small indices (1-4, 8, 25, 26 observed on Pool of
Radiance) and high-bit-set indices (`0x80`-`0xa3`ish observed). This matches
the Gold Box engine's well-documented "special square" (SS) mechanism
described in the Digital Antiquarian's "Opening the Gold Box" series (each
16x16 map may flag specific squares to run a scripted event on entry, and
the total script-space budget for a map's special squares was a real,
period-documented design constraint) — plausibly cross-referencing the
per-title `ECL` bytecode resource (`ecl.dax`/`ECL.GLB`), which is
container-decoded in this corpus (an offset/jump table followed by a
bytecode stream — see `docs/poolofradiance/amiga/data-structure.md` for
PoR's own `ecl.dax` container layout notes) but not disassembled or
interpreted this pass. NOT used by the walker.

**Planes 0 and 1 (bytes 0-511) — OPEN**, escalated to `re-oracle`. Real,
non-degenerate, spatially-coherent per-square data present on EVERY cell,
including fully open floor cells with no walls at all in any direction —
this alone refutes "these are wall-art ids, silent where no wall exists".
Three genuinely different hypotheses were tried on Pool of Radiance's own
`geo.dax` corpus (7424 cells across all 29 levels) and none of them closed
the question:

| Approach | Result | Verdict |
|---|---|---|
| Raw byte value IS the WALLDEF wall-art id directly (WALLDEF's own confirmed id space is `0-9,17-21,23,24`) | Only 34.3% (767/2233) of cells with any confirmed wall/door present have a plane-0 byte value inside that id set | REFUTED as "the id directly" — too weak a fit to be the whole story |
| Populated only where a wall exists (silent/zero on fully-open cells) | The single MOST common `(anyWall, plane0!=0, plane1!=0)` combination across the whole corpus is `(false, true, true)` — fully open cells with both planes nonzero, 1480/7424 cells, the largest bucket of all | REFUTED — planes 0/1 look like an ambient per-square property independent of wall presence (candidate: floor/ceiling texture id, room/region id, lighting zone) |
| Nibble-halves correlate with wall style by axis, using the SAME adjacency-agreement oracle that solved plane 3, but testing nibble EQUALITY between neighbours restricted to edges plane 3 confirms are walled (739 horizontal / 800 vertical edges) | Plane 0's HIGH nibble matches between horizontally-adjacent walled cells 43.6% of the time (vs 17.4% on the wrong axis; ~6.25% chance for 16 possible values); its LOW nibble matches vertically-adjacent walled cells 41.6% of the time (vs 19.2% wrong-axis). Plane 1 shows the identical axis split (41.9%/44.0%). | INCONCLUSIVE — well above chance and axis-consistent (high nibble ~ E/W, low nibble ~ N/S), but far below the ~95% a "same physical wall stores the same id on both sides" model would need. Suggestive of a real but INDIRECT relationship (e.g. a shared room/area id, or an index into a level-local sub-table) rather than the id itself |

A structural fact from the first hypothesis's failure, not yet reconciled
with anything above: across the whole PoR `geo.dax` corpus, plane 0's low
nibble (`value & 0x0F`) is **NEVER** `0x0F` (15) — every observed value's
low nibble is in `0-14`. This is suggestive given WALLDEF entries have
exactly 5, 10, or 15 "wallset" slices (§5.6-5.7 above) — a 0-based
slice-index field capped at 14 would produce exactly this signature — but no
attempt to test a two-level "(id or area) + slice index" hypothesis against
real rendered wall-art coherence was made this pass.

This item was escalated to `re-oracle` (2026-08-31) with the full evidence
above plus pointers to PoR's own unopened `program` executable and the
already-successful CODE-hunk-relative disassembly technique used for §5.1's
compression-method dispatch. See the per-title `TODO.md` `*-geo-plane01`
rows for the outcome once it lands.

### 7.3 Walker integration — CONFIRMED connectivity + passability, wall art PER-CELL where §7.4 resolves it

`tools/walker/games-goldbox.ts` implements one shared `GameView` for all
four titles, built on the CORRECTED model from §7.2's escalation:
`isBlocked(cell,dir)` (wall type != 0 AND door code == 0) gates movement,
`hasWall`/`isDoor` drive the minimap and the first-person side/front hints.
Wall-art SELECTION (which specific WALLDEF texture a 1-15 wall type names)
is now resolved per-cell for levels whose ECL script statically names its
wallset bindings — see §7.4. For every other level (or any cell whose
resolution fails, e.g. a dynamic slot or a `0x7f`/`0xff` sentinel), the view
falls back to its original behaviour: one deterministically-chosen,
already render-confirmed WALLDEF wall texture per level (from that title's
own `dungeon/wall-index.json`, itself built by scanning the extractor's own
already-written `walldef*-<id>-wall<n>-view6.png` files) wherever the
confirmed grid says a wall is drawn in that direction — a real Gold Box
wall texture in the right place, not proven to be the *specific* texture
the original game would draw there. Locked doors (code 2/3) get a distinct
tint but are treated as passable (no key/lock mechanic implemented in the
walker).

### 7.4 Wallset-slot binding — ECL bytecode CONFIRMED for all four titles (2026-09-01)

§7.2 identified the missing indirection: a 1-15 wall-art TYPE names a
level-scoped `(wallsetSlot 0-2, slice 0-4)` pair, and which WALLDEF
resource occupies each of the 3 runtime slots is written by that level's
own ECL bytecode at area-setup time (`LoadWalldef(slot, id)`,
`ovr008.cs:655-684`/`ovr003.cs:501-587`). This session decoded the ECL
container + bytecode VM and used it to resolve real per-level bindings.
Full writeup, VM opcode table, and verification evidence:
`tools/shared/goldbox-ecl.ts`'s module doc. Summary:

- **Container**: PoR's `ecl.dax` is the SAME `.dax` directory format as
  `geo.dax` (29 entries, `indexID` = level id), with the SAME kind of
  constant 2-byte prefix tag GEO's PoR entries carry (`0x8813` here,
  confirmed constant across all 29 entries). The three GLIB titles'
  `ECL.GLB` is the SAME GLIB container as `GEO.GLB` (top-level, stored, no
  prefix needed).
- **Bytecode VM**: CONFIRMED end-to-end against the `simeonpilgrim/coab`
  decompile (`ovr008.cs`, `ovr003.cs`, `Classes/Opperation.cs`,
  `Classes/EclBlock.cs`) — a flat command stream over a 16-bit-address-space
  buffer, opcode + N typed operand groups, 65 opcodes. Opcode `0x37` ("LOAD
  PIECES") directly calls `LoadWalldef(slot, id)` for all 3 slots from its
  3 operands — simpler than the `vm_SetMemoryValue`-intercepted
  `0x322/0x324/0x326` path §7.2 originally cited (that path — opcode `0x09`
  "SAVE" to those addresses — is also detected, but never observed to fire
  in this corpus; every real hit came from `0x37` directly).
- **Verification oracle**: a worklist-based reachability walk (following
  `GOTO`/`GOSUB`/`ON GOTO`/`ON GOSUB` targets, not just linear fallthrough)
  from each of a level's 5 header addresses, with **zero unknown opcodes
  and zero desyncs among the visited set** as the self-consistency check.
  Curse of the Azure Bonds' block 1 disassembles perfectly clean for 700+
  instructions and resolves `LOAD PIECES(1,2,3)` immediately after its own
  `LOAD FILES` call — all 3 ids exist in Curse's own `WALLDEF.GLB`
  directory. Cross-checked further: two of Curse's resolved values (`15`,
  `18`) do NOT appear in `WALLDEF.GLB`'s own sparse id list (`1-14,16,17`)
  — these are not a decode error but the SAME multi-wallset-entry
  phenomenon §5.6/§5.7 already established (`resolveCompositeWallId`'s
  `10*id+n` scheme for the *texture* lookup): ids `14` and `17` are exactly
  the two entries with `wallsetCount===2` (raw length `1560 = 2*780`), and
  `15`/`18` land exactly one past them. `resolveFlatWalldefId`
  (`goldbox-walltiles.ts`) generalizes this into a "flat id space is
  contiguous across a multi-wallset entry's own span" resolver, used by
  both the wallset-binding consumer and (implicitly, by construction) the
  already-shipped composite-id texture lookup.
- **Coverage** (levels with a matching GEO entry; a title's ECL.GLB can
  have more blocks than GEO has levels — those extras are presumably
  non-dungeon scripts, not resolved or needed here):

  | Title | Levels with >=1 resolved slot | Total slots resolved |
  |---|---|---|
  | Curse of the Azure Bonds | 16/16 | 48 |
  | Secret of the Silver Blades | 17/17 | 51 |
  | Pool of Radiance | 26/29 | 78 |
  | Pools of Darkness | 32/32 | 96 |

  Every level that resolves at all resolves ALL 3 slots (this format never
  produces a partial 1- or 2-slot binding in practice). PoR's 3 unresolved
  levels (`30`/`31`/`32`) simply have no matching `ecl.dax` entry at all
  (its `indexID` space tops out at `29`) — not a decode failure.

> **Correction (2026-09-01, `re-oracle` escalation, THIS SECTION):** the
> original pass above (10/16, 5/17, 0/29, 0/32) undercounted every title
> for three DIFFERENT, now-fixed reasons — none of them the genuine
> engine-revision dead ends first reported. The corrected verdicts:
>
> **1. A corpus-wide CFG-walk bug affected all four titles.**
> `reachabilityScanWallsets`'s worklist walk was missing the IF-FALSE skip
> edge: opcodes `0x16`-`0x1b` (IF =/<>/</>/<=/>=) consume exactly their own
> 1-byte opcode, and the VM's `SkipNextCommand` skips the FOLLOWING command
> entirely when the condition is false — but the old walk only ever visited
> that following command's TRUE-path successors (parse it normally, follow
> ITS jump target if it's a `GOTO`/etc). An unconditional `GOTO` immediately
> after an `IF` has a real "condition false, goto never runs, execution
> resumes right after it" successor at that `GOTO`'s own `nextPos`, which
> was never pushed. Fixed by explicitly parsing the following instruction
> when an `IF` is visited and pushing its `nextPos` too (see
> `tools/shared/goldbox-ecl.ts`'s module doc for the exact mechanism).
> Verified impact (re-derived this session): took Curse from 10/16 to
> 16/16 levels and Secret from 5/17 to 17/17.
>
> **2. Pool of Radiance uses ECL address base `0x9900`, NOT `0x8000`** —
> the "header fields point outside the block" / "operands are memory-
> dereferenced" verdict was a wrong-base artifact, not a real
> engine-revision difference. Re-derived this session: the minimum header
> word across all 29 PoR levels is exactly `0x9914` (`= 0x9900 + 20`, the
> 5-word header size) — impossible under base `0x8000` (would need an
> in-header address) and exact under `0x9900`; a base sweep from `0x98fe`
> to `0x9910` shows `0x9900` is a sharp, unique minimum for total
> unknown-opcode count across all 29 levels' reachability walks (`4` at
> `0x9900` vs `221` at the old `0x8000` guess and `196`-`681` at every
> other base tried). `eclAddrToPos`/`reachabilityScanWallsets`/
> `findWallsetBindings` now take `base` as a parameter (default `0x8000`)
> instead of hardcoding it.
>
> **3. Pools of Darkness runs a v1.3 engine revision with a DIFFERENT
> opcode table** — the "every LOAD PIECES operand is memory-dereferenced"
> verdict was a misparse under the wrong (v1.1) table, not a genuine
> runtime-computed-id design. `SetupCommandTable` registers several
> opcodes with different operand counts in this revision
> (`OPCODE_TABLE_POOLS_V13` in `goldbox-ecl.ts`), and critically, wallset
> loading moved from opcode `0x37` (now an unrelated 2-operand NPC-by-name
> query) to opcode `0x21` ("LOAD FILES"), which in this revision takes only
> 2 operands `(geoId, walldefId)` — the 2nd operand IS the wallset id,
> filling ALL 3 runtime slots at once (confirmed against this title's own
> `WALLDEF.GLB`: its entries run 15 slices, a whole 3-slot x 5-slice
> wallset per id). Parsing with the wrong table desyncs the byte stream
> almost immediately, which is why every "hit" the old table found looked
> dynamic — it was reading garbage operand bytes, not a real
> memory-dereferenced operand. Re-derived this session directly from real
> `Disk3/ECL.GLB` bytes (not copied from the escalation's report): with the
> corrected table + `0x21` remap, resolved ids land in `{1-6}` — exactly
> Pools' own `WALLDEF.GLB` id space — and cluster thematically by geo id
> range (geo `1`/`16-22` -> walldef `1`, `32-38` -> `2`, `48-50`/`54` -> `3`,
> `39`/`64-71`/`74` -> `4`, `69`/`81-84` -> `5`, `52-53` -> `6`).
>
> **A fourth mechanism, found this session (not in the original escalation
> report), closed the remaining gaps for both Pools and PoR: `NEWECL`
> (opcode `0x20`) cross-block chaining.** Several levels' own reachable
> code has no wallset-load call at all, but DOES contain a `NEWECL`
> instruction — which literally hands the running script to a DIFFERENT
> ECL block's own entry points (this is a real VM mechanism, not a guess:
> `CMD_NewEcl`-shaped "switch scripts" semantics). `findWallsetBindings`
> now accepts a `resolveBlock(id)` callback and, when a block's own
> reachable code resolves no slot, chases every `NEWECL` target it found
> (cycle-guarded, first successful chase wins) — that target block's own
> binding becomes this level's binding, since it's executing that block's
> own code. On Pools of Darkness this resolved ALL 4 remaining GEO levels
> (`17`/`49`/`71`/`84`, chaining to `33-or-36`/`48`/`68`/`82` respectively)
> for a clean **32/32**, actually BETTER than the escalation's own reported
> 31/32 (which proposed inferring geo `49`'s binding from its neighbors —
> `NEWECL` chaining instead DERIVES it directly: `49` really does execute
> `48`'s own script, and `48` resolves to walldef `3`, matching the
> escalation's inference exactly, but as a measured fact rather than a
> fallback guess). On Pool of Radiance this resolved geo ids `5` and `7`
> (previously the only two of the 26 in-corpus levels with no direct hit)
> — the escalation's reported "levels 5/7/19 have no reachable static hit"
> was itself imprecise: `19` isn't even a GEO level id in this title (GEO's
> id space and `ecl.dax`'s `indexID` space are NOT identical — GEO runs
> `{0-7,9,10,13-18,20-32}`, `ecl.dax` runs `{0-11,13-29}` — so `19` never
> counted against coverage at all), and `5`/`7` DO resolve once `NEWECL`
> chaining is added, leaving only PoR's genuinely script-less
> `30`/`31`/`32` unresolved.
>
> **Paths tried before finding fix #4** (documented since it's the one
> mechanism not in the original escalation brief): a plain per-block
> reachability walk alone (with fixes #1-3 applied) already leaves
> Curse/Secret at their full 16/16 and 17/17, but only reaches PoR 24/29
> (missing `5`/`7` in addition to the genuinely script-less `30`/`31`/`32`)
> and Pools 28/32 (missing `17`/`49`/`71`/`84`) — tracing those 4 Pools
> blocks' own diagnostics showed near-zero unknown-opcode/desync counts
> (0-4) but genuinely zero wallset-load hits, which is what motivated
> checking for a `NEWECL` call in their reachable code instead of assuming
> they were truly script-less like PoR's `30`/`31`/`32`.
- **Wired end-to-end**: `GeoLevel.wallsetBinding` (flat ids per slot,
  `goldbox-geo.ts`), `resolveWallFlatId` (cell+dir -> flat id + slice),
  `resolveFlatWalldefId` (flat id -> real WALLDEF id + wallset index,
  `goldbox-walltiles.ts`), and `GoldBoxView.wallTextureForCell`
  (`tools/walker/games-goldbox.ts`) resolve a real per-cell texture when
  possible, falling back to the existing per-level placeholder otherwise.
  Example resolutions (Curse block 1, `wallsetBinding = {slot1:1,
  slot2:2, slot3:3}`): cell `(2,12)` facing East has wall type `1` ->
  `(slot 0, slice 0)` -> `slot1` = flat id `1` -> WALLDEF id `1`,
  wallsetIndex `0` -> `walldef2-1-wall0-view6.png`; cell `(0,0)` facing
  North has wall type `6` -> `(slot 1, slice 0)` -> `slot2` = flat id `2`
  -> `walldef2-2-wall0-view6.png`. Composite case (Curse block 64,
  `{slot1:17, slot2:18, slot3:16}`): cell `(8,2)` facing South has wall
  type `6` -> `(slot 1, slice 0)` -> `slot2` = flat id `18` ->
  `resolveFlatWalldefId` finds WALLDEF id `17`'s span covers `[17,19)` ->
  wallsetIndex `1` -> wallNumber `1*5+0=5` -> `walldef2-17-wall5-view6.png`
  (id 17's own directory entry has exactly `wallNumber` 0-9, confirming
  the 2-wallset span).

> **Update (2026-09-01, Dark Queen/Gateway/Treasure pass): extended to two
> more titles, with one new ECL prefix-tag finding and one open item.**
>
> **Gateway to the Savage Frontier uses the v1.1 opcode table (`OPCODE_TABLE`)
> completely unchanged** — no adaptation needed. A corpus-wide reachability
> walk over `DiskC/ECL.glb` (default `base=0x8000`, the same base Curse/
> Secret/PoR use) produced **0 unknown opcodes and 0 desyncs**, resolving
> 22/30 levels (64 slots); the remaining 8 levels have no reachable static
> wallset-load hit and no successful `NEWECL` chase target, the same
> "genuinely script-less" shape PoR's `30`/`31`/`32` already established as
> a real, non-error outcome for this engine family.
>
> **Treasures of the Savage Frontier needed one real new finding — a
> constant 2-byte `0x8813` prefix tag on every `ECL.GLB` block** (identical
> in VALUE and ROLE to Pool of Radiance's own `ecl.dax`/`geo.dax` block
> prefix — see the container bullet earlier in this section — but this is
> the first GLIB-family title observed to carry it; Curse/Secret/Pools/
> Gateway's own `ECL.GLB` blocks all have none). Stripping it
> (`eclBlockPrefixLength: 2` in `tools/treasureofthesavagefrontier/amiga/
> export-data.ts`) makes individual block headers and short hand-traced
> sequences decode cleanly under the v1.1 table. **However, a corpus-wide
> reachability walk still desyncs on unknown opcodes for roughly 10% of
> visited instructions**, resolving only 1/41 levels — far below Gateway's
> clean result despite the identical table and prefix fix. Every short
> hand-trace attempted (including manually re-deriving `ON GOTO`/`ON GOSUB`
> operand-group counts against `parseInstr`'s own logic) decoded cleanly
> wherever followed, which is what rules out a further prefix/base
> off-by-one and points instead at a genuine, not-yet-identified opcode-table
> or operand-shape variant reachable only via specific control-flow paths a
> short manual trace doesn't happen to hit. **Escalated to `re-oracle`**
> (2026-09-01) with the full paths-tried table; see
> `docs/treasureofthesavagefrontier/amiga/data-structure.md` §5 and
> `docs/treasureofthesavagefrontier/TODO.md` for the brief and outcome.
>
> Updated coverage table:
>
> | Title | Levels with >=1 resolved slot | Total slots resolved |
> |---|---|---|
> | Curse of the Azure Bonds | 16/16 | 48 |
> | Secret of the Silver Blades | 17/17 | 51 |
> | Pool of Radiance | 26/29 | 78 |
> | Pools of Darkness | 32/32 | 96 |
> | Gateway to the Savage Frontier | 22/30 | 64 |
> | Treasures of the Savage Frontier | 1/41 | 1 (open, escalated) |

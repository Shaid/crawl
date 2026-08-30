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

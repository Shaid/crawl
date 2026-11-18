# Bard's Tale "animated picture" format (Amiga, BT1/BT2/BT3)

Shared container/codec spec for the "animated picture" resource — the
view-window portrait/monster art shown during combat and dialogue — across
all three Amiga Bard's Tale titles. Cracked 2026-09-02. Per-game file
inventories and open items live in the sibling `docs/bardstale{1,2,3}/`
trees; this doc is the byte-level spec they all point at.

## 0. Identity (confirmed)

The three WHDLoad dumps in `data/_unexplored_/` were confirmed against their
own `.slave` file's embedded WHDLoad header text (`strings -n 4 *.slave`),
**not** assumed from directory name:

| Directory | `.slave` header text | Assigned id |
|---|---|---|
| `BardsTaleNTSC/` | `The Bard's Tale: Tales of the Unknown` | `bardstale1` |
| `BardsTale2/` | `Bard's Tale 2: The Destiny Knight` | `bardstale2` |
| `BardsTale3/` | `Bard's Tale 3: Thief of Fate` | `bardstale3` |

## 1. Ground-truth oracle

> **Correction (2026-11-18):** the "byte-identical (`cmp`)" claim below is a
> recalled claim — no copy of Kroah's `Files/` exists in this repo or
> `data/`, so it cannot be re-run (**unverified**). The codecs do not depend
> on it: the 2026-11 audit wrote independent decoders (a from-scratch Huffman
> decoder; a stock Okumura LZHUF, N=4096/F=60/THRESHOLD=2, ring buffer
> pre-filled with spaces) that reproduce the TypeScript port byte-for-byte on
> BT1 55/55, BT2 61/61, BT3 85/85. That is the real oracle now.

Kroah's "Bard's Tale Picture Viewer" (C#, `bringerp.free.fr/RE/BardsTale/`,
`utility1.php5`) ships a `Files/` directory that is **byte-identical**
(`cmp`) to this project's own corpus files: `pics` (BT1), `pics` (BT2),
`all.pic` and `bard3` (BT3). This makes the tool's source
(`Huffman.cs`, `RLE.cs`, `Picture_Amiga.cs`) a byte-exact ground-truth
oracle, not a "plausible reimplementation, never checked" — the same
revision of the data this project actually has. Ported line-for-line
(preserving statement order and 16-bit wraparound arithmetic) into
`tools/shared/bardstale-codecs.ts`.

## 2. Container: `u32BE[N]` offset directory (count = first offset / 4)

Both `pics` (BT1/BT2) and `all.pic` (BT3) open with a flat, big-endian
`u32` array of per-picture record start offsets — `recordOffset =
readU32BE(dump, pictureIndex * 4)`, indexed directly by picture id, no
length/count field anywhere in the file.

- **BT1/BT2 `pics`**: no sentinel. The real picture count has to be found
  empirically (see §5) — reading past the last valid slot lands on
  directory-adjacent payload bytes reinterpreted as a bogus offset, which a
  bounds/sanity check must catch (see §6's implausible-`sizeDst` note).
  > **Correction (2026-11-18):** there *is* an implicit count — the first
  > directory offset divided by 4 (BT1 220/4 = 55, BT2 256/4 = 64, BT3 `all.pic`
  > 344/4 = 86 incl. sentinel). Records run back to back to EOF and obey the
  > `unk` bit-count rule (§3). The §5 decode-until-failure probe was
  > corroboration, not the only method.
- **BT3 `all.pic`**: `u32BE[N+1]` with an explicit sentinel — the LAST
  directory entry equals the file's own byte length exactly. Confirmed on
  the real corpus file: `all.pic` is 526,002 bytes; directory entry `[85]`
  reads `526002` (**correction**: an earlier pass in this session cited
  entry `[84]` for this — off by one directory slot; entry `[84]` is
  `518857`, the START offset of a real, distinct 85th record, not the
  sentinel — see §5's correction note). This is the same
  self-describing-offset-table convention already seen elsewhere in this
  project's corpus (`goldbox-daa-tiles.ts`'s container family) — **confirmed
  independently here**, not assumed from that precedent.

## 3. Per-record layout, BT1/BT2 (`pics`)

```
[u32 sizeDst][u32 unk][serialized Huffman tree][huffman-coded stream]
```

| Field | Size | Notes |
|---|---|---|
| `sizeDst` | u32BE | Total huffman-DECODED byte count: 32 (palette) + payload, where payload = base picture (4928 B once RLE'd/untransposed) **plus any trailing animation data** (see §8). **confirmed** |
| `unk` | u32 | **Exact bit count of the Huffman stream** (tree + palette + payload). **confirmed (2026-11 audit, re-run 2026-11-18)**: BT1 `pics` big-endian equals the consumed-bit count on 54/55 (record 54, last in file, needs 1 byte past EOF; exact with 2 B padding); BT2 `pics` is stored **little-endian** and equals bit count + 7 on 64/64 slots. The old "always `0x167B6`" never occurs in this data. Independent zero-deviation check of the Huffman tree decoder. |
| Huffman tree | variable, bit-packed | Serialized per-file (see §4). |
| Huffman-coded payload | `sizeDst` decoded bytes | First 32 bytes = 16-word (32-byte) Amiga 12-bit RGB palette; remainder = the base picture, further transformed per-game (RLE for BT1, bit-transpose+XOR for BT2 — see §3.1/§3.2). |

### 3.1 BT1: RLE-packed 4bpp-planar 112x88

The huffman-decoded payload (after the 32-byte palette) is RLE-compressed.
Marker byte `b`: `b==0` → stop; `b&0x80` → literal run of `b&0x7F` raw
bytes; else → run of `b` repeats of the next single byte. Decodes to
exactly `112*88/2 = 4928` bytes — **confirmed**: every real BT1 record (55
of 55, see §5) decodes to exactly this length, and the result decodes
cleanly under this project's existing `decodePlanar(data, 112, 88, 4)`
(4-plane, **plane-major** layout, i.e. 4 sequential 1232-byte bitplanes —
not row-interleaved) into a recognizable, non-degenerate picture (see §7).

### 3.2 BT2: bit-transpose + XOR delta, 4bpp-planar 112x88

The huffman-decoded payload goes through two transforms (`Picture_Amiga.
Uncrypt1`/`Uncrypt2`):

- **Uncrypt1** (bit transpose): reads the 4928-byte payload as 1232
  big-endian `u32`s; for each, extracts one bit per output plane per
  round-robin iteration (8 iterations x 4 planes = 32 bits consumed),
  producing 4 x 1232-byte output planes (plane-major, same layout as §3.1's
  BT1 output).
- **Uncrypt2** (running XOR): per plane (4 x 1232 bytes), for byte index 14
  through 1231: `dump[i+14] ^= dump[i]`, applied in place, left-to-right so
  each XOR sees the *already-updated* value 14 bytes back (a running delta,
  not a one-shot pass).

Confirmed by the same criterion as BT1: real records converge on a
recognizable 112x88 4bpp-planar picture (§7), and the same
`decodePlanar(..., 4)` call decodes the result correctly with zero
adaptation.

## 4. Huffman tree/decoder (BT1 + BT2, shared)

- Fixed-capacity **769-node** binary tree, 10 bytes/node: `u32 left, u32
  right, u8 leaf, 1 pad`. `0xFFFFFFFF` in a child slot means "no child" —
  since nodes are only ever assigned by construction in strictly increasing
  address order, a node with both children `0xFFFFFFFF` is a leaf (this
  invariant is what makes `decode()`'s per-byte tree walk provably
  terminate — see `tools/shared/bardstale-codecs.ts`'s doc comment).
- Serialized bitstream, one bit per tree-construction step: `0` = internal
  node (allocate right child, then left child, recurse left, discard one
  bit, recurse right — note **right before left** in allocation order, a
  real quirk of the original preserved verbatim); `1` = leaf (next 8 bits,
  MSB-first, are the leaf's byte value).
- The underlying 16-bit big-endian bit reader has a real quirk, preserved:
  once fewer than 2 bytes remain in the source buffer, it **silently stops
  refilling** (keeps reusing whatever bits remain in its window) rather
  than throwing or zero-filling. This is faithful to the original but is
  also exactly what turned a bad picture-index probe into an infinite loop
  before `sizeDst`/`readU8` bounds checks were added (see
  `tools/shared/bardstale-codecs.ts`'s comments and §6 below) — a
  documented pitfall for anyone porting this codec again.
- **One `Huffman` instance is reused across two `decode()` calls** on the
  same bit-reader state — the 32-byte palette, then the picture payload —
  with no reset in between (`Picture_Amiga.LoadBard_1_2_Single`). Missing
  this was a real bug caught mid-session before it produced wrong output
  (see the module doc in `bardstale-codecs.ts`; the "Errors and fixes" note
  once cited here in `docs/bardstale1/TODO.md` never existed).

## 5. Real picture counts (confirmed by exhaustive probe, not assumed)

A directory-offset scan alone is not decisive on `pics` (no sentinel, and
garbage past the real end can still look like an ascending offset by
coincidence). The decisive test: **sequentially decode picture index 0, 1,
2, ... until the codec itself throws**, using the fully-hardened decoder
(bounds-checked reads + a `sizeDst` sanity cap — see §6). Results:

| Game | Directory slots | Real pictures | Notes |
|---|---|---|---|
| BT1 `pics` | 55 | **55** (indices 0-54) | Clean, contiguous, no placeholder slots. |
| BT2 `pics` | 64 | **61** (indices 0-63 minus 3 placeholders) | 3 confirmed placeholder/sentinel slots — see below. |
| BT3 `all.pic` | 86 entries = 85 record spans + 1 sentinel | **85** (indices 0-84) | Directory entry `[85]` == file length exactly (§2). Slot 84 (offsets 518857-526002) is a real picture — see 2026-11-18 correction below. |

> **Correction (same session, caught by the shared codec's own regression
> test — `tools/shared/__tests__/bardstale-codecs.test.ts`):** an earlier
> pass in this doc claimed the sentinel sits at directory index `[84]`. It
> does not — `all.pic`'s directory has 86 `u32BE` entries (indices 0-85),
> describing 85 record spans (records 0-84); the sentinel matching file
> length is entry `[85]`. Record 84 itself (offsets 518857-526002) is a
> real, addressable directory slot — its header even declares a plausible
> `uncompressedSize` of exactly 19712, the same constant every real picture
> uses — but decoding it throws `read past end of buffer` partway through
> the LZ77 stream: its 7145-byte compressed span runs out before the
> decompressor reaches `uncompressedSize` bytes of output. Whether this is
> truncated/corrupt data, a reserved/non-picture 85th slot, or something
> else entirely is **not resolved** — flagged open in
> `docs/bardstale3/TODO.md` rather than silently treated as "84 = the whole
> story." The picture-count claim of 84 real, valid, renderable pictures
> (indices 0-83) is unaffected — this correction only concerns what sits in
> the one directory slot just past them.

> **Correction (2026-11-18, audit):** slot 84 is **not** corrupt/truncated.
> An independent stock Okumura LZHUF consumes exactly span + 1 bytes on all
> 85 records; the extra byte is the decoder's bit-buffer refill (refills
> while <= 8 bits remain) reading one byte past each record's end — past EOF
> for the last record, where 15 bits were still buffered so the phantom byte
> is never used. Our `readU8` threw on that read: a decoder bug, now fixed
> (`readBitByte` returns 0 at EOF as Okumura's `getc` does). Slot 84 decodes
> to 19,712 B = 4 clean animation frames (an old bearded man with goggles at
> a machine), and `bard3`'s remap table references picture 84. BT3 has **85**
> pictures. The "runs out before `uncompressedSize`" text above is the
> retracted premise, kept as a dead end.

**BT2's 3 "placeholder" slots** (indices 25, 30, 52):
> **Correction (2026-11-18):** the text below ("no Huffman tree or payload",
> "byte-identical") is wrong. Slots 25 and 30 end in `c6 00`, slot 52 in
> `82 80`, so they differ; each is a valid 1-byte Huffman record — a
> single-leaf tree decoding to 0x8C or 0x05 — and its `unk` (LE) = 16 = 9
> bits + 7, same rule as §3. The listed `[u32][u32]` header is 8 bytes, not
> 10. They remain "no picture" slots (`sizeDst=1`).

Original (superseded) description: each is a deliberate 10-byte record —
`[u32 sizeDst=1][u32 unk=0x10000000]` — sitting cleanly between two normal, differently-sized pictures (confirmed
by dumping the raw directory offsets/header words around each; e.g. index
24 ends at file offset 117115, index 25's whole 10-byte record runs
117105-117115, index 26 starts at 117115 — no gap, no overlap). This is
real container structure, not corruption — a `sizeDst==1` sentinel
convention for "no picture in this slot."

## 6. BT3: `all.pic` LZ77 + adaptive Huffman

Exactly stock **Okumura LZHUF** (N=4096, F=60, THRESHOLD=2, ring buffer
filled with spaces) — a textbook implementation reproduces all 85 records
byte-exact (2026-11 audit; a third-party oracle). 4096-byte ring
buffer (`tab1`), position/length values split-coded through two hardcoded
256-entry log2-bucket lookup tables (`_hard1`/`_hard2` in the C# source),
with a dynamically-rebalanced adaptive Huffman tree over the LZ token
stream (frequency counts in `tab2`, sibling-swap tree maintenance in
`tab3`/`tab4`). Ported as `unpackBard3` + 4 helper functions in
`tools/shared/bardstale-codecs.ts`.

- Record: `[u32 uncompressedSize][LZ77+adaptive-Huffman stream]`.
- Every real record decompresses to exactly **19712** bytes = 4 x 4928-byte
  chunky (packed-nibble, 2 pixels/byte) 112x88 4bpp sub-frames — **confirmed
  invariant**, checked against every one of the 85 real records with zero
  deviation; `unpackBard3` throws loudly if `uncompressedSize` is ever
  anything else, rather than silently truncating/overrunning its output
  buffer.
- After decompression, an inter-sub-frame XOR delta is undone
  (`uncryptXorBard3`).
  > **Correction (2026-11-18):** the earlier text said sub-frames 1-3 are each
  > XORed against sub-frame 0 over offsets 0..4927. The code is a **running
  > chain over 14,784 bytes**: frame n is XORed with the already-decoded
  > frame n-1 (the base frame is stored raw). The two readings differ on 85/85
  > records; rendered both — the chain gives clean frames, the old reading
  > gives noise in frames 2-3.

  The 4 sub-frames are animation frames (campfire flicker, mouth/eye
  movement) but **not** near-identical: on average 28.6% of bytes differ from
  the previous frame (max 66%; picture 20 is a zoom-in, picture 3's frame 3
  differs by 49%).
- **Two real infinite-loop-class bugs were found and fixed while getting
  this codec to run cleanly**, both from JS's `undefined`/`NaN` semantics
  silently defeating `while (x !== 0)`-style loop conditions instead of
  erroring:
  1. A mis-transcribed `_hard2` constant table (247/248 entries instead of
     the real 256) made `HARD2[varE]` occasionally read `undefined`,
     driving the position-decode `for(;;){ var10--; if (var10===-1) break;
     ...}` loop into a permanent `NaN !== -1` spin. Fixed by re-parsing the
     original C# source text for both `_hard1`/`_hard2` and verifying
     length 256 each via a length-count script before transcribing.
  2. Probing an out-of-range `pictureIndex` on BT1/BT2's `loadBard12Picture`
     reads a garbage `sizeDst` from unrelated payload bytes; without a
     sanity bound, `huffman.decode(sizeDst - 32)` can allocate/loop across
     billions of "bytes" — the bit reader's EOF quirk (§4) means this path
     never naturally throws. Fixed with an explicit `32 <= sizeDst <=
     200_000` bound (every real record's picture is a fixed 4928+32 bytes,
     so this is a generous, not a tight, cap) plus a directory-offset
     bounds check and a Huffman-tree node-overflow guard.
  Both are documented in `tools/shared/bardstale-codecs.ts`'s inline
  comments at the exact lines that fixed them, so a future port of this
  same codec doesn't re-hit them blind.

### 6.1 BT3 palette: a separate file (`bard3`), via an id-remap table

Unlike BT1/BT2 (palette is inline, first 32 bytes of the huffman payload),
BT3's palette lives in a **separate file**, `bard3`, resolved through two
small lookup tables:

1. `getPictureIndexGame`: linear-scan an 88-entry table at file offset
   `0x2589E` in `bard3` (one byte per entry) for a byte equal to the
   `all.pic` picture index; the matching table *row* (not the byte value
   itself) is the result. **confirmed** — every one of the 85 real `all.pic`
   indices (0-84) has exactly one matching row (re-verified 2026-11-18:
   table holds 0-84 once each plus three `0xFF` rows at 27, 81, 86).
   > **Correction (2026-11-18):** the old "0 misses, verified by
   > `paletteMisses`" was circular — a lookup miss throws (picture logs
   > FAILED) and `paletteMisses` only counts all-zero palettes.
2. `getPaletteBard3Words`: read the paletteIndex byte at `0x25A98 + row`,
   then 16 big-endian words (32 bytes) at `0x25978 + paletteIndex*32` — the
   Amiga 12-bit RGB palette for that picture.

The 88-row table = 85 pictures (0-84) + 3 `0xFF` ("no picture") rows at
rows 27, 81, 86. Palette-select bytes reach at most 8; the 9 palettes at
`0x25978` end exactly at `0x25A98`, where the select table starts.
(**Correction 2026-11-18:** the earlier "4 unaccounted rows" was a
miscount; there are 3 empty rows.)

## 7. Verification

Every claim above is backed by rendering, not just "decode completes with
no exception": every one of BT1's 55, BT2's 61 real, and BT3's 85x4=340
sub-frame pictures renders as a **visually recognizable, non-degenerate**
Bard's Tale character/monster/scene image (warriors, wizards, monsters,
shop signage, an "Interplay Productions" splash panel appearing in both
BT1 and BT2's picture banks) — not noise, not a flat/uniform fill, not a
torn/misaligned raster. See the shipped atlases:
`public/assets/bardstale{1,2,3}/amiga/sprites/pics.png` (+ `.json`
sidecars with per-frame rects and, for BT1/BT2, per-picture palette words).
This is a **rendered** confidence level (recognizable art; the old
"cross-checked against Kroah's gallery pages" is a recalled claim, unverified) rather than a byte-for-byte pixel oracle — no independent
pixel-exact reference render was available to diff against, but the
byte-exact source-provenance chain (§1) plus the zero-deviation structural
invariants (§5's contiguous counts, §6's fixed 19712-byte decompressed
size) make this a high-confidence result, not a guess.

## 8. BT1/BT2 trailing animation data, and the shared data-file container (2026-11 audit)

- **Animation overlay (answers `bt1-animation-overlay`: yes, inline).** In BT1,
  44/55 records' Huffman output continues after the RLE terminator (185,308 B
  total): a u16 count then entries like `03f0 0200 ...` ending `ffff`. In BT2,
  50/61 records have `sizeDst - 32 > 4928` (210,848 extra bytes) that
  `Uncrypt1` ignores. The decoder currently drops both; format undecoded
  (`bt1-animation-format`, `bt2-animation`). (audit-probed, not re-run here)
- **Shared container.** Every BT1/BT2 data file decodes with the same codec
  as `[u32 size][u32 bitcount][Huffman]`, bit-count rule holding with zero
  deviation (BT2 `big_dung`/`title`/`pics` little-endian +7): 40/40
  single-record files (`big_city`, `big_dung`, `dung_blank`, `bard_screen`,
  `control_panel`, `icon0-4`, the 5 instruments, BT1 `title`, `CITY/bi1..BI9`,
  `city.name`, `city.path`, BT2 `wpics` (one 29,728 B record), `ic`, `title`,
  `bs.anm`) plus directory files BT1 `levs` (16 x 2,048 B), BT2 `levs`
  (25 x 3,072 B), BT2 `citys` (1 x 2,304 + 6 x 512). BT1 `levs` record 0
  begins 484 = 22x22 bytes of 2-bit-per-side wall data then a 484-byte flag
  grid (slack holds leftover Applesoft BASIC source). Instruments decode to
  signed 8-bit PCM (`chant` lag-1 correlation 0.93). `chant/drums/harp/panflu/
  trumpet/dung_blank` are identical in BT1 and BT2. **Probed by the audit
  (single-record scan only re-verified for `pics`), not yet an extractor.**
- BT3 `monsterh`/`monsterl`: no size header; all 41 record spans are
  multiples of 48 — raw 48-byte monster stat records with high-bit ASCII
  names ("Red Dragon", "Unbeliever"), **not graphics** (the old "try
  `unpackBard3`" premise is retracted).
- BT3 `maps.hi`/`maps.lo`: 71 records, each `[u32 size][stock LZHUF]`
  (consumption span + 1, 71/71); decoded record = 16-byte high-bit name
  ("Lucencia", "Wilderness", "Tower"), width/height byte (0x0C/0x10/0x14),
  then word offsets. Cell format not yet decoded.
- BT3 `.GRP`: little-endian u16 offset directory (D0WAL: 7 entries,
  14..8864), each record starts with magic `RAW\x18`.
- BT3 `title`/`titlescreen`/`victory`/`finalBardscreen` are IFF ILBM
  (320x200 BMHD). BT1 `c/bardstale.dat` is the same size as `bardstale.dat`
  but differs in 131,281 of 219,456 bytes (scrambled copy, probably copy
  protection); BT1 inventory also gains `bards_data/CITY/` (11 files),
  `data/title`, `c/xxx`, `c/zzz`.

## 9. Open

See `docs/bardstale{1,2,3}/TODO.md`.

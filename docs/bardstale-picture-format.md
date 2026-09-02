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

Kroah's "Bard's Tale Picture Viewer" (C#, `bringerp.free.fr/RE/BardsTale/`,
`utility1.php5`) ships a `Files/` directory that is **byte-identical**
(`cmp`) to this project's own corpus files: `pics` (BT1), `pics` (BT2),
`all.pic` and `bard3` (BT3). This makes the tool's source
(`Huffman.cs`, `RLE.cs`, `Picture_Amiga.cs`) a byte-exact ground-truth
oracle, not a "plausible reimplementation, never checked" — the same
revision of the data this project actually has. Ported line-for-line
(preserving statement order and 16-bit wraparound arithmetic) into
`tools/shared/bardstale-codecs.ts`.

## 2. Container: `u32BE[N]` offset directory, no explicit count

Both `pics` (BT1/BT2) and `all.pic` (BT3) open with a flat, big-endian
`u32` array of per-picture record start offsets — `recordOffset =
readU32BE(dump, pictureIndex * 4)`, indexed directly by picture id, no
length/count field anywhere in the file.

- **BT1/BT2 `pics`**: no sentinel. The real picture count has to be found
  empirically (see §5) — reading past the last valid slot lands on
  directory-adjacent payload bytes reinterpreted as a bogus offset, which a
  bounds/sanity check must catch (see §6's implphausible-`sizeDst` note).
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
| `sizeDst` | u32BE | Total huffman-DECODED byte count: 32 (palette) + payload. **confirmed** — real records cluster in the low thousands (e.g. BT1 record 0: matches `112*88/2 + 32` after RLE). |
| `unk` | u32BE | Always `0x167B6` in every C# source sample cited in the oracle; role **not confirmed** here either — no consumer traced. |
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
  (see `docs/bardstale1/TODO.md`'s "Errors and fixes" note, or the module
  doc in `bardstale-codecs.ts`).

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
| BT3 `all.pic` | 86 entries = 85 record spans + 1 sentinel | **84** (indices 0-83) | Directory entry `[85]` == file length exactly (§2). Slot 84 (the 85th span, offsets 518857-526002, 7145 bytes) is real, distinct directory content — NOT the sentinel — but fails to decode (see correction below). |

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

**BT2's 3 placeholder slots** (indices 25, 30, 52): each is a real,
deliberate 10-byte record — `[u32 sizeDst=1][u32 unk=0x10000000]`, no
Huffman tree or payload at all — byte-identical at all 3 occurrences and
sitting cleanly between two normal, differently-sized pictures (confirmed
by dumping the raw directory offsets/header words around each; e.g. index
24 ends at file offset 117115, index 25's whole 10-byte record runs
117105-117115, index 26 starts at 117115 — no gap, no overlap). This is
real container structure, not corruption — a `sizeDst==1` sentinel
convention for "no picture in this slot."

## 6. BT3: `all.pic` LZ77 + adaptive Huffman

Structurally the classic **Okumura LZHUF/LHarc family**: 4096-byte ring
buffer (`tab1`), position/length values split-coded through two hardcoded
256-entry log2-bucket lookup tables (`_hard1`/`_hard2` in the C# source),
with a dynamically-rebalanced adaptive Huffman tree over the LZ token
stream (frequency counts in `tab2`, sibling-swap tree maintenance in
`tab3`/`tab4`). Ported as `unpackBard3` + 4 helper functions in
`tools/shared/bardstale-codecs.ts`.

- Record: `[u32 uncompressedSize][LZ77+adaptive-Huffman stream]`.
- Every real record decompresses to exactly **19712** bytes = 4 x 4928-byte
  chunky (packed-nibble, 2 pixels/byte) 112x88 4bpp sub-frames — **confirmed
  invariant**, checked against every one of the 84 real records with zero
  deviation; `unpackBard3` throws loudly if `uncompressedSize` is ever
  anything else, rather than silently truncating/overrunning its output
  buffer.
- After decompression, an inter-sub-frame XOR delta is undone
  (`uncryptXorBard3`): for `offset` 0..4927, `subFrame[1][offset] ^=
  subFrame[0][offset]` — i.e. only sub-frames 1-3 are XORed against
  sub-frame 0 (the base frame is stored raw). The 4 sub-frames per picture
  are near-identical with small local differences (visually confirmed —
  animation frames, e.g. a campfire scene's flame flicker, a creature's
  mouth/eye movement — see §7's atlas).
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
   itself) is the result. **confirmed** — every one of the 84 real `all.pic`
   indices (0-83) has exactly one matching row (0 misses across the whole
   corpus, verified by the extractor's own `paletteMisses` counter).
2. `getPaletteBard3Words`: read the paletteIndex byte at `0x25A98 + row`,
   then 16 big-endian words (32 bytes) at `0x25978 + paletteIndex*32` — the
   Amiga 12-bit RGB palette for that picture.

Not every `bard3` table row need be used by every `all.pic` index (the
table has 88 rows for 84 real pictures) — the extra 4 rows are unaccounted
for (see `docs/bardstale3/TODO.md`).

## 7. Verification

Every claim above is backed by rendering, not just "decode completes with
no exception": every one of BT1's 55, BT2's 61 real, and BT3's 84x4=336
sub-frame pictures renders as a **visually recognizable, non-degenerate**
Bard's Tale character/monster/scene image (warriors, wizards, monsters,
shop signage, an "Interplay Productions" splash panel appearing in both
BT1 and BT2's picture banks) — not noise, not a flat/uniform fill, not a
torn/misaligned raster. See the shipped atlases:
`public/assets/bardstale{1,2,3}/amiga/sprites/pics.png` (+ `.json`
sidecars with per-frame rects and, for BT1/BT2, per-picture palette words).
This is a **rendered** confidence level (recognizable art, visually
cross-checked against Kroah's own gallery pages for BT1/BT2 where
available) rather than a byte-for-byte pixel oracle — no independent
pixel-exact reference render was available to diff against, but the
byte-exact source-provenance chain (§1) plus the zero-deviation structural
invariants (§5's contiguous counts, §6's fixed 19712-byte decompressed
size) make this a high-confidence result, not a guess.

## 8. Open (not yet decoded — see per-game `TODO.md` for the full paths-tried table)

- The `unk` field's role (§3) — always `0x167B6` in the source, never
  traced to a consumer.
- BT2's `wpics` (a second, differently-named picture-like file, not yet
  touched — possibly a wilderness/overland variant).
- BT3's `.GRP` files (`D0WAL.GRP`, `GDUNG.GRP`, `SKARA.GRP`,
  `WILDWAL.GRP`) — likely first-person wall/dungeon-view graphics, not yet
  investigated.
- BT3's `maps.hi`/`maps.lo` — same `u32BE[N+1]`-directory container
  convention as `all.pic` (confirmed structurally), content not decoded;
  likely dungeon/level layout data.
- BT3's `monsterh`/`monsterl` — same container convention; an earlier
  attempt assuming raw planar/chunky pixel data (before this LZHUF codec
  was known) found no recognizable image via a `seer-probe gfx` parameter
  sweep (best candidate score 0.68/1.0, visually noise) — now understood to
  likely need `unpackBard3`'s codec instead, not yet re-attempted.
- BT3's `driver` file — raw 68k code, not disassembled.
- Animation-overlay data that follows each base picture in the real game
  (mouth movement during dialogue, etc.) — the 4 BT3 sub-frames are
  themselves confirmed real animation content (§6), but BT1/BT2's
  equivalent overlay mechanism (if any exists beyond the single static
  picture decoded here) has not been investigated.
- 4 unaccounted-for rows in `bard3`'s 88-row id-remap table (§6.1).

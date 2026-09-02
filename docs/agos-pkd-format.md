# AGOS "old bundle" `.pkd`/`.out` resources — Elvira, Elvira II, Waxworks (Amiga)

Shared container + codec used by the Amiga ports of three Horrorsoft/
Adventure Soft titles staged in this repo: **Elvira: Mistress of the Dark**
(`data/elvira/amiga/`), **Elvira II: The Jaws of Cerberus**
(`data/elvira2/amiga/`), and **Waxworks** (`data/waxworks/amiga/`). All
three run on the engine ScummVM calls **AGOS** (`GType_ELVIRA1`,
`GType_ELVIRA2`, `GType_WW`) — the same lineage as Simon the Sorcerer.
Cracked once here; each title's own `docs/<game>/amiga/data-structure.md`
references this doc rather than re-explaining it.

Implementation: `tools/shared/agos-vga.ts` (LZ77 decompression, palette
load, picture decode), `tools/shared/agos-vga-export.ts` (per-game export
orchestration). Per-title extractors: `tools/elvira/amiga/export-data.ts`,
`tools/elvira2/amiga/export-data.ts`, `tools/waxworks/amiga/export-data.ts`.

Ground truth: **ScummVM's `engines/agos/` source** (GPLv3), read directly
(cloned to a scratch dir this session, not reimplemented from a fan doc or
paraphrase), plus **`scummvm-tools/engines/agos/extract_agos.cpp`** (the
project's own standalone Amiga/AtariST `.pkd` extractor). Both fetched from
`github.com/scummvm/scummvm` and `github.com/scummvm/scummvm-tools`
(`master`, fetched 2026-09-02).

## 0. Probe recon was wrong about Elvira 2's `.pkd` being a different format

The prior triage pass (`docs/_unexplored_/probe-recon.md`, superseded by
this doc + the per-game specs) recorded Elvira 2's `.pkd` files as having "a
different header than Elvira 1" and hypothesized "likely a later revision
of the same packer." **This is refuted**: the exact same decompressor
(`simonDecr`, §1) decodes every `.pkd` file in all three games' corpora with
zero errors — 130/130 Elvira 1, 200/200 Elvira 2, 298/298 Waxworks. The
"different header" was normal compressed-content byte variance (the first
few bytes of an LZ-compressed stream have no fixed magic at all — they're
just whatever the bitstream's first control codes happen to be), not a
different container. Elvira 1 and Waxworks really do share this format
exactly as hypothesized; **Elvira 2 also does**, it just wasn't confirmed
until real bytes were decoded.

## 1. Container — `simon_decr`, a backward-reading bit-oriented LZ77

**CONFIRMED**, byte-exact clean decode (no bounds errors — the format has
no checksum, so "decodes without a bounds violation and produces the
declared byte count" is the whole verification the algorithm itself
offers) across all three corpora (628/628 `.pkd` files total). Ported 1:1
from `extract_agos.cpp`'s `simon_decr`/`simon_decr_length` — the tool whose
own doc comment says it "extracts the packed files used in the Amiga and
AtariST versions" of Elvira 1/2, Waxworks, and Simon 1.

Structure (all multi-byte values big-endian):

- The **last 4 bytes** of the compressed file are a `u32` giving the exact
  decompressed length.
- Decoding writes the output buffer **backward from its end**; the
  compressed bitstream is also **consumed backward**, starting 8 bytes
  before EOF (4 bytes for the length field, then a 4-byte word used to
  seed the bit buffer — its highest set bit is a sentinel marking how many
  of its low bits are valid, a classic "load a full word, count leading
  bits" bitstream-init trick).
- Each token starts with 1-2 flag bits selecting a **literal** (raw byte
  run) or **match** (LZ back-reference) type, each with its own
  fixed base length + extra-bits-read count:

  | Flag bits | Type | Extra length bits | Base length | Offset bits |
  |---|---|---|---|---|
  | `1,00` | match | 8 (extra length) | 2 | 9 |
  | `1,01` | match | 8 | 3 | 10 |
  | `1,10` | match | (none — 8 bits read directly as length) | 12 | 12 |
  | `1,11` | literal | 8 | 8 | — |
  | `0,1` | match | (none) | 1 | 8 |
  | `0,0` | literal | 3 | 0 | — |

  A literal run reads `(baseLength + extraBits)` additional bytes directly
  from the bitstream (8 bits each) and writes them backward. A match reads
  an offset (width per the table above) and copies `(baseLength + extra)`
  bytes from `dest[d + offset]` (an address **closer to the end** of the
  already-written output, since the buffer fills backward) to `dest[d]`,
  decrementing `d` each byte — this is why matches can have offset `0`
  (repeat the immediately-following byte) and why the offset-overflow
  check is `d + offset > destlen`, not `< 0`.
- Loop terminates when the output cursor reaches the start of the buffer
  (`d === 0`).

No compression-method flag, no per-block boundaries, no XOR checksum — this
is a much simpler codec than Pool of Radiance's `.dax`
(`docs/goldbox-glib-format.md` §0's comparison table) or GLIB's nested
LZW/LZ77, despite superficially resembling both (backward-reading LZ77 is a
common Amiga-era "cruncher" shape).

### Filename convention (`loadVGAVideoFile`, `res.cpp`, `GF_OLD_BUNDLE` Amiga branch)

Each in-game "zone" (roughly: one room/screen/scene) has up to 3 files, all
sharing a numeric zone id:

| Type | Role | Elvira 1/2 filename | Waxworks filename |
|---|---|---|---|
| 1 | `vga1` — palette table + object/script data | `%02d1.pkd` | `%03d1.pkd` |
| 2 | `vga2` — picture animation table + pixel data | `%02d2.pkd` | `%03d2.pkd` |
| 3 | sound effects (`.out`, not `.pkd` — see §4) | `%02d3.out` | `%03d3.OUT` |

(`%02d`/`%03d` = zero-padded zone id, 2 digits for Elvira 1/2, 3 for
Waxworks — confirmed directly from `res.cpp:936-946`'s
`GType_ELVIRA1||GType_ELVIRA2` vs. the `else` default branch, and matches
every filename actually present in all three corpora: Elvira "011.pkd" =
zone 1 type 1, Waxworks "0011.pkd" = zone 1 type 1.)

`tools/shared/agos-vga.ts`'s `discoverZones()` groups files by zone from
this convention alone (a regex per `AgosNamingScheme`), needing no directory
listing or index file — the numbering is purely positional in the
filename.

## 2. Palette — CONFIRMED via two independent live (non-debug) code paths

16 colours per "slot", stored as consecutive big-endian `u16` Amiga 12-bit
RGB words (`0xRGB`, 4 bits/channel) inside `vga1`, starting at
`vga1 + BE16(vga1 + 6)`. Read via `tools/shared/agos-vga.ts`'s
`loadPalette(vga1, bank, count)`.

**Scale: `channelNibble * 32`, truncated to a byte (NOT the more "obvious"
linear `nibble * 17` 4-to-8-bit expansion).** This looked suspicious at
first — for `nibble >= 8` it wraps past 255 (e.g. nibble `9` -> `288 mod
256 = 32`, much darker than the `9*17=153` a naive reader would expect) —
so it was checked against real ScummVM source in **two separate,
genuinely-live (not debug-only) code paths**, not just trusted from one
reading:

- `vga_e2.cpp`'s `setPaletteSlot()` — the handler for VC opcodes 46/47/48
  (`vc46_setPaletteSlot1`/`2`/`3`), which real Elvira 2 gameplay scripts
  call to load a palette slot. Non-AtariST branch: `palptr[0] =
  ((color & 0xf00) >> 8) * 32;` — literally the same formula.
- `debug.cpp`'s `palLoad()` (used by the debug-only `dumpVgaBitmaps`
  bitmap dumper) — same formula, same `GType_ELVIRA1||ELVIRA2||WW||PN`
  branch, independently.

Both agree, so this isn't a debug-tool-only quirk (see
`reference-tool-incompleteness-mistaken-for-game-ambiguity.md`'s
sibling pitfall about not trusting an unexercised code path — here the
opposite risk was checked and ruled out: `setPaletteSlot` genuinely is
exercised by real VC opcode dispatch).

**Visually verified**: rendered a real zone's picture (Elvira 1, zone 64,
a jungle/swamp scene) with both `nibble*32-truncated` and `nibble*17`
scaling side by side — both are close for this particular scene's largely
dark, desaturated palette (a swatch comparison of the SECOND 16-colour
bank, which happens to include a brighter `0xF96` salmon tone, showed the
two diverging sharply — `*32-truncated` gives a garish magenta, `*17`
gives a plausible warm salmon — but the source-code evidence above settles
which is correct even where a single render can't discriminate; darker
horror-game palettes rarely exercise nibble values >= 8 in the primary
16-colour bank actually used for pixel indices 0-15).

Only the first 16 entries (bank 0) matter for rendering, since every
picture in this era of AGOS uses `colorDepth = 4` (16 colours) — the
5-plane 32-colour path in `convertAmigaImage` (`res_ami.cpp`) is gated on
`GType_SIMON1` only.

## 3. Picture — animation table + VC10 planar->chunky codec, CONFIRMED

**Container**: `vga2` (a decompressed "type 2" resource) opens with an
array of 8-byte big-endian entries:

```
offset 0   u32   pixel data offset (relative to vga2 start)
offset 4   u8    flags (bit 0x80 = RLE-compressed bitplanes)
offset 5   u8    height (pixels)
offset 6   u16   width field — pixel width = floor(field / 16) * 16
```

Entry **index 0 is always reserved** (all-zero placeholder — real images
start at index 1). Entry 1's own `offset` field doubles as the table's
total byte span: the first real image's pixel data always begins
immediately where the last table entry ends, so there is no separate
"table length" field — `dumpVgaBitmaps` (`debug.cpp:658`) reads this
value from `vga2+8` (= entry 1's `offset` field) before the loop even
starts iterating at index 1, which only makes sense under this
convention. The walk stops at the first entry whose offset is
out-of-bounds or whose width/height is 0.

`tools/shared/agos-vga.ts`'s `readAnimTable()` implements this.

**Pixel decode** (`convertAmigaImage`/`convertCompressedImage`/
`uncompressPlane`/`bitplaneToChunky`, `res_ami.cpp`) — `colorDepth = 4`
(16 colours, 4 bitplanes) for all three games. Two distinct source
layouts depending on the `flags & 0x80` bit:

- **Compressed** (the large majority of real images — every Elvira 1
  zone-64 image and every screen sample this pass rendered had
  `flags=0x80`): a 4-entry pointer table (`[u16, u16]` per plane, summed
  to a byte offset) points at 4 independently PackBits-style
  run-length-compressed bitplanes (`uncompressPlane` — a *word*-granular
  RLE: a signed control byte `n>=0` repeats the next big-endian `u16`
  `n+1` times, `n<0` copies `-n` literal `u16`s). The four planes'
  decompressed words are combined 8-pixels-at-a-time
  (`bitplaneToChunky`, nibble-packed 2px/byte) into 8-byte blocks, then
  **reassembled in COLUMN-MAJOR order** — outer loop over 16-pixel-wide
  vertical strips, inner loop over rows — **not** plain row-major. This
  is the same "moving base pointer" gotcha as MM1's WALLPIX RLE (see
  `ported-fill-loop-moving-base-pointer.md`): a naive row-major port
  consumes the RLE stream with zero remainder (looks correct) but
  renders a scrambled/striped image.
- **Uncompressed** (rare in the sampled corpus, e.g. Elvira 1 zone 1's
  small `32x17` down-arrow icon): the 4 planes' words are stored
  **interleaved per source position** (plane0-word0, plane1-word0,
  plane2-word0, plane3-word0, plane0-word1, ...) rather than as 4
  contiguous blocks, and written **plain row-major** with no
  reassembly pass at all — genuinely a different byte layout from the
  compressed case, not just "skip the RLE step."

Output is row-major, 2 pixels/byte (**high nibble = left pixel** — traced
from the real on-screen blit, `drawVertImageUncompressed` in `gfx.cpp`:
`color = src[count]/16` written to the even destination x, `src[count]&15`
to the odd one).

`tools/shared/agos-vga.ts`'s `decodeImage()` implements both branches;
`unpackIndices()` expands to 1 byte/pixel; `indicesToRGBA()` applies the
palette.

### Verification

- **Structural**: `readAnimTable` + `decodeImage` ran with zero bounds
  errors across 5,745 images decoded corpus-wide (1,124 Elvira 1, 2,303
  Elvira 2, 2,318 Waxworks).
- **Visual — the framework's real bar, not just "no crash"**: rendered 84
  screen samples (the single largest image from the 40 biggest zones per
  game) plus every image in every zone's atlas. Every sample checked by
  eye is a coherent, thematically-correct scene, not noise:
  - Elvira 1 zone 22/23: a garden path and a flowerbed courtyard —
    matches Elvira's gothic-mansion-and-grounds setting.
  - Elvira 2 zone 21: a snarling blue-furred werewolf/bat creature close-up.
  - Elvira 2 zone 78: a fiery, organic (heart/hellscape) scene.
  - Waxworks zone 64: a gold-and-marble Egyptian tomb chamber with
    sarcophagi and statues — Waxworks' well-known Egyptian exhibit.
  - Waxworks zone 147: a prison/dungeon wall with a barred window.

  See `public/assets/{elvira,elvira2,waxworks}/amiga/screens/` for the
  full set.

## 4. Still open

- **`.out`/`.OUT` "type 3" sound-effect resources are undecoded.** They do
  **not** run through `simonDecr` — verified directly: `simonDecr()` on
  Elvira 1's `013.out` and `093.out` both throw `match offset overflow`
  within the first few tokens, i.e. these are not `simon_decr`-compressed
  at all. The first several header bytes look like `[u32 someLength][u32
  0][u32 someOffset]...`, suggesting a distinct, probably-uncompressed
  sample/envelope format, not yet reverse-engineered. See each game's
  `TODO.md`.
- **`vga1`'s own non-palette content** (the bulk of the file past the
  16-32 colour table — object definitions, room text, VC opcode scripts)
  is undecoded. The palette-table-pointer convention (`BE16(vga1+6)`)
  is confirmed; nothing else in `vga1` has been traced.
- **`*tune` files** (Elvira 1's `1tune`, `10tune`, `14tune`, ...) —
  un-probed; likely a tracker-module-family music format, not `.pkd`
  (they don't match the naming convention and weren't attempted this
  pass).
- **Palette bank selection beyond bank 0** — `setPaletteSlot`'s
  `dstOffs`/multi-slot windowed-compositing scheme (used by Elvira 2/
  Waxworks for simultaneous multi-region palettes) is not replicated;
  every render here uses the static bank-0 16-colour table, which is
  sufficient for a coherent single-picture export but not for exact
  runtime on-screen compositing fidelity.

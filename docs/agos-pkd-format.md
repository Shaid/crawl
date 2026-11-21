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
zero errors — 130/130 Elvira 1, 200/200 Elvira 2, 298/298 Waxworks
(`.pkd` counts as originally recorded; the audit's 628 total is the corrected
full count — see §1). The
"different header" was normal compressed-content byte variance (the first
few bytes of an LZ-compressed stream have no fixed magic at all — they're
just whatever the bitstream's first control codes happen to be), not a
different container. Elvira 1 and Waxworks really do share this format
exactly as hypothesized; **Elvira 2 also does**, it just wasn't confirmed
until real bytes were decoded.

## 1. Container — `simon_decr`, a backward-reading bit-oriented LZ77

**CONFIRMED**. Stronger check (2026-11-18 audit, independent Python
re-implementation): on all 628 `.pkd` files (plus the 28 `*tune` files,
Waxworks `gameamiga` and `icon.pkd`) the backward decode finishes with the
read pointer at file offset 0 and 0 bits left over; plain files (`text*`,
`tables*`) fail the same check (null control). Originally: byte-exact clean decode (no bounds errors — the format has
no checksum, so "decodes without a bounds violation and produces the
declared byte count" is the whole verification the algorithm itself
offers) across all three corpora (628/628 `.pkd` files total: 130 + 200 + 298 as first counted; Waxworks's
298 is really 297 zone `.pkd` + `icon.pkd`, and the Elvira 1 "130" is 130
`.pkd` + 19 separate `.out`). Ported 1:1
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
> **Correction (2026-11-18):** the match rows previously claimed 8 extra
> length bits for `1,00`/`1,01` and base 12 for `1,10`. Per
> `extract_agos.cpp:104-136`, `1,00`/`1,01` are fixed-length matches (2, 3)
> with no extra bits, and `1,10` reads its length as 8 bits with 12 offset
> bits. The code (`agos-vga.ts` `simonDecr`) was always right; only this
> table was wrong.

- Each token starts with 1-2 flag bits selecting a **literal** (raw byte
  run) or **match** (LZ back-reference) type, each with its own
  fixed base length + extra-bits-read count:

  | Flag bits | Type | Extra length bits | Base length | Offset bits |
  |---|---|---|---|---|
  | `1,00` | match | none (fixed length 2) | 2 | 9 |
  | `1,01` | match | none (fixed length 3) | 3 | 10 |
  | `1,10` | match | (none — 8 bits read directly as length) | — | 12 |
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

## 2. Palette — scale CONFIRMED; bank-0-is-all-that-matters OVERSTATED

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

> **Correction (2026-11-18):** three claims in this section were
> overstated or wrong.
> 1. **Not every zone has a palette.** `vga1` word `+2` is the bank count and
>    equals `(BE16(+10) - BE16(+6)) / 32` in 321/321 files. 49 zones declare
>    **0 banks** (46 Waxworks + 3 Elvira II); the bytes at `BE16(+6)` there are
>    header, not colours. The exporter used to emit noise-coloured
>    `palettes/zoneNNN.json` for 39 Waxworks zones and Elvira II zone 80;
>    it now emits no palette file for them (`zones.json` records
>    `hasPalette:false`) and renders their atlases in a greyscale ramp. The
>    real palette source for those zones is open (`agos-paletteless-zones`).
> 2. **The main palette load is `vc22_setPalette`** (`vga.cpp:1152-1235`),
>    not `setPaletteSlot`. For Elvira 1 with an argument < 1000 it loads only
>    **13** colours from the zone; colours 13-31 come from a hard-coded
>    `extraColors` table, and zones' own colours 13-15 disagree with it
>    (most often `500/332/777` vs the engine's `500/332/665`). Icons below
>    y=133 get `paletteMod=16` (`gfx.cpp:971-973`); in Elvira II/Waxworks the
>    slot comes from the existing pixel's high nibble (`gfx.cpp:975-976`).
>    Scripts select banks other than 0 often (Elvira 1 `vc22` args 1-16:
>    168 times vs 229 for bank 0). So the per-zone bank-0 palette is
>    **rendered (unverified against scripts)**, not CONFIRMED for rendering.
> 3. **The "0xF96 salmon" anecdote is retracted** — it is not reproducible.
>    Palette nibbles are 0-7 in every Elvira 1 palette and in all but a few
>    Elvira II/Waxworks banks (including zone 64's four banks); at nibble 7
>    `*32` gives 224 vs `*17` 119, so "both are close" was also false.
>    The `*32` scale itself is correct per the source. Waxworks `0391.pkd`
>    bank 0 has genuine 4-bit values (`01a1`, `034c`) that `*32` wraps — flagged.

**Visually verified (superseded by the correction above for the 0xF96 claim)**: rendered a real zone's picture (Elvira 1, zone 64,
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
start at index 1). The table ends where the first image's pixel data begins,
i.e. at the **lowest non-zero data offset** of any entry; there is no
separate "table length" field. The walk **skips 0x0 entries (keeping their
indices)**; `drawImage_init` (`vga.cpp:861-874`) indexes `vga2 + image*8`
directly and merely returns on a 0x0 entry.

> **Correction (2026-11-18):** this section used to say "entry 1's offset
> doubles as the table span" and "the walk stops at the first entry whose
> width/height is 0". Both wrong: the early stop was copied from the
> debug-only `dumpVgaBitmaps` (`debug.cpp:659-677`), and entry 1's offset is 0
> whenever entry 1 is itself a placeholder. 0x0 placeholders sit mid-table
> (189 / 198 / 1,061 in Elvira 1 / II / Waxworks). Full walk: **9,307**
> decodable images (1,654 + 3,272 + 4,381) vs the 5,745 first reported —
> every zone with a type-2 file has pictures except Elvira II zone 99 (one
> junk entry, 10240 px wide, rejected as overrunning the resource) and one
> Waxworks zone; the 15 Waxworks type-1-only zones use shared maze graphics. Checks: 6,822 compressed images' per-plane RLE
> decode without overrun (0 failures); uncompressed images fill exactly the
> gap to the next image's start (473/473, 855/856, 1,153/1,157; misses are
> junk entries); of the image numbers the vga1 VC scripts pass to `vc10_draw`,
> 612 / 1,625 / 2,067 land on valid entries. Regression:
> `tools/shared/__tests__/agos-vga.test.ts` (real data, with a stop-at-first-0x0
> null control).

`tools/shared/agos-vga.ts`'s `readAnimTable()` implements this.

**Pixel decode** (`convertAmigaImage`/`convertCompressedImage`/
`uncompressPlane`/`bitplaneToChunky`, `res_ami.cpp`) — `colorDepth = 4`
(16 colours, 4 bitplanes) for all three games. Two distinct source
layouts depending on the `flags & 0x80` bit:

- **Compressed** (the large majority of real images — every Elvira 1
  zone-64 image and every screen sample this pass rendered had
  `flags=0x80`; 71% overall): a 4-entry pointer table (`[u16, u16]` per plane, summed
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
- **Uncompressed** (29% of Elvira 1 images — 473/1,654 — 856/3,273 in
  Elvira II and 1,157/4,381 in Waxworks; the "rare" wording was a sampling
  artefact, corrected 2026-11-18; e.g. Elvira 1 zone 1's
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

Column-major order now has a quantified null (2026-11-18): over 6,111
compressed images, vertical-neighbour agreement is 0.719 for column-major
vs 0.603 for row-major; 90.6% vs 69.3% of images reach >= 0.5.

`tools/shared/agos-vga.ts`'s `decodeImage()` implements both branches;
`unpackIndices()` expands to 1 byte/pixel; `indicesToRGBA()` applies the
palette.

### Verification

- **Structural**: `readAnimTable` + `decodeImage` run with zero bounds
  errors across 9,307 images decoded corpus-wide (1,654 Elvira 1, 3,272
  Elvira 2, 4,381 Waxworks). *Superseded count — the first pass reported
  5,745 (1,124 / 2,303 / 2,318) from the truncated early-stop walk, see
  the §3 correction.*
- **Visual — the framework's real bar, not just "no crash"**: rendered 120
  screen samples (the first pass said 84; 40 per game x 3 = 120 are written,
  124 on disk counting the 4 `Pics/` renders) (the single largest image from the 40 biggest zones per
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

## 4. Still open / re-scoped (2026-11-18 audit)

Status of each item is tracked in the per-game `TODO.md`; evidence below.
ScummVM's detection tables list these exact retail files (MD5 + size match),
so ScummVM is a valid reference for all of them.

- **`.out`/`.OUT` sound files — format identified, extractor pending.** No
  compression (they are not `simon_decr` — the earlier "throws on
  `013.out`" observation was correct but incomplete). Per
  `loadVGASoundFile`/`loadSound` (`res_snd.cpp:719-756,894-957`): signed 8-bit
  PCM, default 8000 Hz (`playRawData`, `sound.cpp:613-622`).
  Elvira 1: 12-byte BE records `[u16 0][u16 size][u16 0][u16 id][u32 offset]`.
  Elvira II: 12-byte records `[u32 size][u32 id][u32 offset]` (only one shared
  `013.OUT` exists, because `loadZone` always loads (1,3), `zones.cpp:96-101`).
  Waxworks: a chain of `[LE16 size][u16 ?]` + data; the second u16 (values
  5,7,8,9,10,16) is probably a rate code (open). All 79 files tile exactly to
  EOF (19/19, 1/1, 59/59).
- **`*tune` files — SOLVED format.** All 28 are `simon_decr`-compressed
  ProTracker modules: decompress with full consumption and carry `M.K.` at
  offset 1080; size == `1084 + patterns*1024 + sample bytes` exactly in
  24/28. The other 4 (Waxworks `2tune`/`8tune`/`9tune`/`10tune`) hold more
  than one module: first module ends at 50,980 / 51,156 / 47,244 / 42,054 =
  ScummVM's `amigaWaxworksOffs` sub-tune offsets (`res_snd.cpp:350-379`).
  Song names present ("elvira loader", "catacombs", "pyramid-theme").
  Extractor pending (`*-tune-music`).
- **`gameamiga` is the game database, not the AmigaOS executable** (decoded for Waxworks + Elvira II 2026-11-21: `docs/waxworks/amiga/data-structure.md` §5). It is
  `GAME_BASEFILE` (`res.cpp:107-145,183-209`, `loadGamePcFile` /
  `allocGamePcVars`); headers carry the "runtime database" marker `0x80`
  (Elvira 1 `36b 80 … 2b1`, Elvira II `355 80 … 45c`, Waxworks
  `6df 80 6df 29d`, the Waxworks one `simon_decr`-compressed 43,392 ->
  101,522 B). The text block's NUL-terminated string count equals the
  header's string-table count (689/689, 1,116/1,116, 669/669); strings are
  real game text. This holds items, rooms, exits and subroutines
  (`readItemFromGamePc` / `readSubroutineBlock`) — the room/exit data a
  walker needs (`*-gamepc`). The executable is `runit` (hunk header
  `000003F3`); `start` is `GAME_RESTFILE`; `icon.dat`/`icon.pkd` is
  `GAME_ICONFILE` (Waxworks's is `simon_decr`-compressed); `stripped.txt` is
  the TEXT index (9-byte entries: 8 for Elvira II, 25 for Waxworks);
  `tbllist`/`xtbllist` index `tables*`/`xtable*`.
- **`vga1` is not "object definitions / room text / scripts".** Those live in
  `gameamiga`. `vga1` = palette banks, then the image and animation tables
  (header at `BE16(+10)+20`, `vga.h:85-95`), then VC scripts. Walking the
  scripts with ScummVM's parameter-length tables (`vga.cpp:310-330`) gives
  815 / 1,368 / 3,652 scripts with 0 bad opcodes; id/100 = zone holds for
  5,831/5,835 table entries. Open work is VC script *semantics*
  (`*-vga1-scripts`).
- **Palette banks** — `*-palette-slots` is OPEN, not deferred: see the §2
  correction (`vc22_setPalette`, Elvira 1 13-colour / `extraColors`,
  `paletteMod`, script-selected banks) and `agos-paletteless-zones`.

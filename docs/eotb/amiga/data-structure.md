# Eye of the Beholder — Amiga Data Structures

## Overview

Eye of the Beholder (1991, Westwood Associates / SSI) and Eye of the Beholder II
(1992) are first-person dungeon crawlers for the Amiga using the AD&D ruleset.
Both use Westwood's proprietary file formats built around CPS (Compressed Picture
System) images and LCW compression.

**EOB1:** 158 files in `data/eotb/amiga/`
**EOB2:** 261 files in `data/eotb2/amiga/data/` (WHDLoad installation)

**Note on DOS versions as format oracle:** Both EOB1 and EOB2 DOS versions are fully
supported by [ScummVM's KYRA engine](https://www.scummvm.org/compatibility/2.7.0/kyra:eob/).
The ScummVM source code (`engines/kyra/`) provides a byte-accurate reference implementation
for format parsing and can be used to cross-validate Amiga format structures. See
`docs/eotb2/eotb2-formats-research.md` for links to ScummVM source files.

**Confirmed (2026-08-02): ScummVM's Kyra engine has full, first-class Amiga
support, not just DOS.** `engines/kyra/detection_tables.h` lists real
`kPlatformAmiga` detection entries for both `"eob"` (EOB1, EN/DE/FR/IT) and
`"eob2"` (EOB2, EN/DE), and there's a dedicated
`engines/kyra/graphics/screen_eob_amiga.cpp` plus `kPlatformAmiga`
branches throughout `engine/eob.cpp`, `engine/eobcommon.cpp`,
`engine/scene_eob.cpp`, `engine/sprites_eob.cpp`, `engine/magic_eob.cpp`,
`gui/gui_eob.cpp`, `gui/saveload_eob.cpp`, `script/script_eob.cpp`,
`sequence/sequences_eob.cpp`, `resource/staticres_eob.cpp`. This settles
the standing question for every Amiga-specific TODO item in this doc: an
authoritative oracle **does** exist for all of them (no "real
disassembly required, no oracle available" re-flagging needed) — see each
section below for what was traced this pass.

---

## File Types

| Extension | Content                              | Size Range  |
|-----------|--------------------------------------|-------------|
| `.CPS`    | Compressed images (walls, monsters, UI) | 1–60 KB   |
| `.VCN`    | Wall view tile data + palette         | 55–61 KB    |
| `.VMP`    | Wall view tile mapping table          | 5.7 KB      |
| `.MAZ`    | Maze / dungeon layout                 | 4.1 KB      |
| `.INF`    | Level configuration (monsters, items) | 2–5 KB      |
| `.DAT`    | Wall parameters, items, text          | 1–16 KB     |
| `.PAL`    | Standalone palettes (EOB2 only)       | 64 B        |
| `.DEC`    | Decoration data (EOB2)                | varies      |
| `.OUT`    | Overhead map data (EOB2)              | varies      |
| `.DCR`    | Creature/decoration resources (EOB2)  | varies      |
| `.SAM`    | Sound samples (EOB2)                  | varies      |
| `EOBDATA.SAV` | Save game                         | —           |

---

## CPS — Compressed Picture System

The primary image format. All CPS files are 320×200 pixels, 5 bitplanes
(32 colors), 40,000 bytes when uncompressed. Used for wall sets, monster
sprites, UI screens, title screens, and item icons.

### Header (little-endian)

| Offset | Size | Type     | Description                                |
|--------|------|----------|--------------------------------------------|
| 0x00   | 2    | UINT16LE | FileSize — bytes after this field           |
| 0x02   | 2    | UINT16LE | CompressionType (4 = LCW)                   |
| 0x04   | 4    | UINT32LE | UncompressedSize (40000 or 40064)           |
| 0x08   | 2    | UINT16LE | PaletteSize (0 = none, or multiple of 64)   |
| 0x0A   | —    | —        | Compressed data (or palette if PaletteSize>0) |

**Compression types:**
- `0x0000` — Uncompressed
- `0x0001` — LZW-12
- `0x0002` — LZW-14
- `0x0003` — RLE (with 16-bit LE long-repeat commands on Amiga)
- `0x0004` — **LCW** (used by all EOB1/EOB2 Amiga files)

**FileSize note:** For types 0 and 4, FileSize counts bytes behind itself,
making it 2 less than the actual file size.

### Palette Locations

**EOB1 style:** When `UncompressedSize == 40064`, the final 64 bytes of the
uncompressed data contain a 32-color Amiga palette (16-bit big-endian, 0x0RGB
format). Used by: `TITLE.CPS`, `CHARGEN.CPS`, `INVENT.CPS`, `TOWRMAGE.CPS`,
`KING.CPS`, `ORB.CPS`, `WTRDP1.CPS`.

**EOB2 style:** When `PaletteSize > 0`, the palette is embedded in the file
header at offset 10, before the compressed data. `PaletteSize` is typically 64
(one palette) or a multiple of 64 for multi-palette files. Palette entries are
16-bit big-endian Amiga color registers.

**Multi-palette CPS — mechanism confirmed (2026-08-02, ScummVM source).**
`Screen_EoB::setDualPalettes` (`graphics/screen_eob_amiga.cpp:156-163`) is
the real handler: it composites two independently-loaded 32-colour
palettes into one 64-colour combined palette (`_palettes[0]`, copying the
"top" palette into slots 0-31 and the "bottom" palette into slots 32-63),
then calls `Screen::enableDualPaletteMode(splitY=120)`
(`graphics/screen.cpp:1004`) which makes the renderer use the top-half
palette for scanlines above `splitY` and the bottom-half palette below it
— **a horizontal screen-split effect (distinct top/bottom colour sets),
not a fading/flash effect**. Only one call site:
`EoBCoreEngine::???` via `_screen->setDualPalettes(_screen->getPalette(amigaPalIndex),
_screen->getPalette(7))` (`engine/eobcommon.cpp:1783`) — not traced
further to find which specific screen/context calls this (time budget);
this settles the previous open question of "how" (confirmed: split-screen
dual palette, not multi-frame animation) even though "which CPS files use
it and when" wasn't individually re-verified against real files this pass.
This narrows `eotb1-amiga-multipalette-cps` from "logic not implemented"
to "logic identified and cited, not yet ported to the extractor."

**Call site traced (2026-08-29) — very likely unreachable in EOB1's shipped
data.** Followed `engine/eobcommon.cpp:1783` up its caller chain to find
which real CPS files (if any) actually exercise `setDualPalettes`:

- The enclosing function is `EoBCoreEngine::???` — actually
  `Screen_EoB::loadEoBBitmap`'s caller context resolves to
  `displayParchment()`/the "dialogue" text-box drawer, entered via the
  event-script opcode `oeob_dialogue` (`engine/script_eob.cpp`, case
  `-45`/`op_45`). Its CPS filename argument is **data-driven** — it comes
  from the currently-running `.INF` event script's own operand bytes, not
  a hardcoded string.
- Decompressed all 12 `LEVELn.INF` files (via the existing
  `scripts/kyralib/format80.py` LCW decoder) and scanned their event-script
  bytecode regions for any embedded ASCII string ending in `.CPS` that
  could be a `oeob_dialogue` argument. **Zero CPS filenames found in any of
  the 12 files** — EOB1's shipped level scripts never invoke the dialogue
  opcode with a bitmap argument that would reach `setDualPalettes`.
- A second candidate call path, `displayParchment()`'s own hardcoded
  `"MAP"` bitmap stem (used for the parchment/map screen), was also
  checked: no `MAP.CPS`/`MAP1.CPS` exists anywhere in this EOB1 (English,
  Amiga) corpus's PAK directories, and no caller of `displayParchment` was
  found to pass an `amigaPalIndex` that would make it take the dual-palette
  branch rather than the ordinary single-palette one.
- **Conclusion**: the mechanism is real, correctly identified (a
  split-screen dual-palette blit, not a fade), and cited to exact source
  lines — but there is no evidence any real file in this project's EOB1
  Amiga corpus (`data/eotb/amiga/`) actually drives it. This is a
  structural/data-flow negative (zero `.CPS` operand strings across the
  full event-script corpus, zero matching `MAP.CPS` file), not a full
  opcode-by-opcode interpreter trace of every `.INF`'s script — so it is
  reported as **strongly narrowed, not airtight-closed**: "no data in this
  corpus reaches `setDualPalettes`," rather than "provably impossible."
  No extractor work was done for this item since there is nothing in the
  corpus to extract multi-palette output from.

**Standalone (.PAL files, EOB2 only):** 64-byte files containing 32 × 16-bit
big-endian colors. Wall sets: `AZURE.PAL`, `CRIMSON.PAL`, `DUNG.PAL`,
`FOREST.PAL`, `MEZZ.PAL`, `SILVER.PAL`. `FINALE.PAL` is 384 bytes (6 palettes).

**VCN-embedded (EOB1 wall sets):** Each `.VCN` file contains a 32-color palette
at offset 0x40 stored as 24-bit RGB (3 bytes per color, 96 bytes total). The
first 3 colors are always black (RGB 0,0,0). This palette format uses 8-bit
per channel values that need the correct interpretation (not yet fully decoded).

**Palette structure** (shared across all EOB palettes):
- Colors 0–5: Wall-set or image-specific
- Colors 6–7: Shared UI elements (`0x0A0A`, `0x0DC2`)
- Colors 8–10: Grayscale ramp
- Colors 11–25: Mixed shared colors
- Colors 26–30: Highlight ramp
- Color 31: White (`0x0FFF`)

### LCW Decompression

Westwood's proprietary "Format 80" compression (internally called LCW).
Five command types, 1–5 bytes each:

**Command 1 — Short literal copy** (1 byte): `10xxxxxx`
Copy next `xxxxxx` bytes literally. A value of 0x80 (`10 000000`) marks EOF.

**Command 2 — Existing block copy** (2 bytes): `0xxxyyyy yyyyyyyy`
Copy `xxx + 3` bytes from `Dest[current - (yyyy|yyyyyyyy)]`.

**Command 3 — Medium copy** (3 bytes): `11xxxxxx yyyyyyyy yyyyyyyy`
Copy `xxxxxx + 3` bytes from absolute or relative position.

**Command 4 — Fill** (4 bytes): `11111110 cccccccc cccccccc vvvvvvvv`
Write byte `vvvvvvvv` repeated `cccccccc|cccccccc` times.

**Command 5 — Long copy** (5 bytes): `11111111 cccccccc cccccccc pppppppp pppppppp`
Copy `cccccccc|cccccccc` bytes from position `pppppppp|pppppppp`.

Pseudo-code for decompression:

```
sp = 0; relative = (src[sp] == 0); if relative: sp += 1
while sp < len(src):
    cmd = src[sp++]
    if (cmd & 0x80) == 0:        # Command 2
        count = ((cmd >> 4) & 7) + 3
        pos = ((cmd & 0x0F) << 8) | src[sp++]
        copy count bytes from dst[len(dst) - pos]
    elif (cmd & 0x40) == 0:       # Command 1
        count = cmd & 0x3F
        if count == 0: break      # EOF
        copy count literal bytes
    else:                          # Commands 3/4/5
        count = cmd & 0x3F
        if count == 0x3E:          # Command 4 (fill)
            count = src[sp] | (src[sp+1] << 8); sp += 2
            val = src[sp++]
            fill count bytes with val
        elif count == 0x3F:        # Command 5 (long copy)
            count = src[sp] | (src[sp+1] << 8); sp += 2
            pos = src[sp] | (src[sp+1] << 8); sp += 2
            copy count bytes from position
        else:                      # Command 3 (medium copy)
            count += 3
            pos = src[sp] | (src[sp+1] << 8); sp += 2
            copy count bytes from position
```

### A second, distinct Amiga-only codec (`loadSpecialAmigaCPS`) — bonus finding

Not one of this pass's requested items, but discovered while tracing
Amiga `.INF`-equivalent level loading and worth recording: some Amiga
files are **not** LCW at all. `Screen_EoB::loadSpecialAmigaCPS`
(`graphics/screen_eob_amiga.cpp:62-154`) implements a second, unrelated
compression scheme — a **backwards-reading bit-level LZ variant with an
XOR checksum**, reading both the compressed input and the decompressed
output from high addresses down to low:
```cpp
// graphics/screen_eob_amiga.cpp:36-60 (bit reader) + 62-154 (decoder)
// input header: u32 BE inSize, u32 BE outSize, u32 BE chk (running XOR checksum, must == 0 at end)
// reads a 32-bit "code" register 1 bit at a time, refilling 4 bytes (BE) from
// `pos -= 4` whenever exhausted -- both pos (input) and dst (output) count DOWN
```
Used for: the Amiga equivalent of `readLevelFileData`'s DOS `.INF` LCW
branch (`engine/scene_eob.cpp:144-145`, gated on
`s->readSint32BE() + 12 == s->size()`), `TEXT.CPS`
(`engine/eobcommon.cpp:1406,1721,1972`), and as an EOB2-Amiga-German
fallback for `.CPS` files whose header size doesn't match the normal LCW
convention (`graphics/screen_eob.cpp:492-499,516-517` — "some localized
versions... simply check for certain file names which aren't actual CPS
files"). Also carries its own 32-colour palette (64 raw bytes, Amiga
12-bit RGB, loaded via the same `loadAmigaPalette` as VCN) **before** the
compression header, but only when a size-check fails
(`screen_eob_amiga.cpp:75-79`) — "unlike normal CPS files these files
never have more than one palette" (source comment).

**Implemented and tested (2026-08-29), but unverifiable against real
corpus data.** Ported byte-for-byte to `tools/eotb/decode-special-cps.ts`
(`usesSpecialAmigaCodec()` implementing the exact
`stream.readSint32BE() + 12 === stream.size()` gate the outer call sites
use, and `decodeSpecialAmigaCps()` implementing the bit reader + decode
loop). Working through the bit-reader arithmetic by hand established that
each refilled 32-bit word contributes exactly **31** usable bits, not 32
— the 32nd `readNextBit()` call against any freshly-loaded word always
lands on the `val === 0` refill branch and its own extracted bit is
discarded, regardless of the word's actual top-bit value (documented in
the file's module doc).

Verification:
- **Whole-corpus gate scan** (`tools/eotb/__tests__/eotb-special-cps.test.ts`):
  ran `usesSpecialAmigaCodec()` against every file in `data/eotb/amiga/`
  including all 12 `LEVELn.INF` and `TEXT.CPS` — **zero matches**. Every
  one of these files has an ordinary `compType=4` Kyra-bitmap (LCW) header
  instead, confirming this EOB1 (English) Amiga corpus never takes this
  branch — consistent with the source's own comment that it's chiefly an
  EOB2-Amiga-German fallback path. Same honest-negative shape as
  `eotb1-amiga-dec-verify`'s "no `.DEC` file exists in this corpus either."
- **Hand-built synthetic test vector**, since no real file exercises the
  codec: a 16-byte file (`inSize=4, outSize=1`) with one compressed word
  chosen bit-by-bit (worked out by hand from the decode loop's own branch
  structure) to drive the literal-byte path and emit exactly `0x41` (`'A'`),
  with the header `chk` field set so the format's own self-check (running
  XOR checksum, `error("checksum error")` in the source) lands on exactly
  0 at EOF. This exercises the bit reader and the literal-byte decode path
  for real. A second test confirms a deliberately-corrupted checksum is
  correctly rejected. The match-copy branches (`code<2`/`code===2`/
  `code===3`) remain ported-from-source only, with no oracle available in
  this corpus to exercise them — labelled **source-confirmed, not
  data-verified** for those specific branches.
- 5/5 tests passing in `tools/eotb/__tests__/eotb-special-cps.test.ts`.

This closes the *implementation* half of `eotb1-amiga-special-cps-codec`
(a working, tested decoder exists and is committed) while leaving the
*real-file verification* half an honest negative — there is no `TEXT.CPS`
or any other file in this project's data directory that actually needs
this codec.

### Image Data

After decompression: 40,000 bytes = 5 bitplanes × 8,000 bytes each.
Each bitplane is 320×200 pixels (320/8 = 40 bytes per row).

Pixel at (x, y) color index:
```
byte_pos = y * 40 + x // 8
bit_pos = 7 - (x % 8)
color = 0
for plane in 0..4:
    color |= ((bitplane[plane][byte_pos] >> bit_pos) & 1) << plane
```

**Verified:** 62 CPS files rendered correctly at 320×200 5bpp including all
wall sets, UI screens, and 48 monster/animation files.

---

## VCN — Wall View Data

Pre-rendered wall graphics organized as 8×8 pixel tiles indexed by the VMP
mapping table. Each VCN file contains a tileset for one wall theme.

**EOB1 wall sets:** BLUE, BRICK, DROW, GREEN, XANATHA
**EOB2 wall sets:** AZURE, CRIMSON, DUNG, FOREST, MEZZ, SILVER

### Structure — confirmed, and simpler than the previous guess (2026-08-02, ScummVM source)

Port of `EoBEngine::loadVcnData` (`engine/eob.cpp:693-715`, the
`kPlatformAmiga` branch). The previous "0x40 header, compressed tile data"
description was a guess from generic CPS-file conventions and is
**superseded** — the real Amiga VCN layout is different and,
importantly, **entirely uncompressed**:

```cpp
Common::SeekableReadStream *in = _res->createReadStream(fn);
uint32 vcnSize = in->readUint16LE() * (_vcnSrcBitsPerPixel << 3);  // bitsPerPixel=5 on Amiga -> 40 bytes/tile
_vcnBlocks = new uint8[vcnSize];
_screen->getPalette(1).loadAmigaPalette(*in, 1, 5);   // 5 colours, into palette slots [1..5]
in->seek(22, SEEK_CUR);                                // skip 22 reserved bytes
in->read(_vcnBlocks, vcnSize);                          // raw tile data, NO decompression
```

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 2 | `numTiles` (u16 LE) | tile data size = `numTiles * 40` bytes (5 bitplanes × 8 bytes/plane per 8×8 tile) |
| 0x02 | 10 | 5 Amiga palette colours (u16 BE each) | loaded into **palette slots 1-5** (not 0-4) — a small palette *patch*, not the full 32-colour wall-set palette (see below) |
| 0x0C | 22 | reserved, skipped | unread/unaccounted — same total header size (34 = `0x22`) as the DOS `.VCN` header (`numTiles` u16 + 32-byte colMap), just Amiga substitutes 10 bytes of palette + 22 bytes reserved for DOS's 32-byte colMap — a structural echo, not yet explained further |
| 0x22 | `numTiles*40` | tile data | **raw, uncompressed** — 8×8 tiles, 5 bitplanes, standard Amiga planar (8 rows × 1 byte/row × 5 planes = 40 bytes/tile) |

**This closes `eotb1-amiga-vcn-decompress` as "no algorithm exists to
implement" — Amiga `.VCN` tile data is never compressed on this platform.**
(The earlier open item's premise — "tile data after the palette may be
compressed" — is refuted directly by the reader code: it's a straight
`stream->read()` into the tile buffer, no decode step at all.)

### Palette (VCN offset 0x02, not 0x40 — supersedes the earlier guess)

**Confirmed.** `Palette::loadAmigaPalette` (`graphics/screen.cpp:4193-4202`):
each colour is a **16-bit big-endian Amiga colour register**, `0x0RGB`
(4 bits per channel, top nibble unused), scaled to the engine's internal
6-bit (0-63) palette range via `(nibble * 0x3F) / 0xF` — **not** a naive
left-shift/multiply-by-17:
```python
def amiga12_to_6bit(nibble):  # e.g. 0xF -> 63, 0x8 -> 33 (not 0x88=136 or 8*17=136)
    return (nibble * 0x3F) // 0xF
```
This closes `eotb1-amiga-vcn-palette`. Correction to the earlier text: the
VCN file does **not** carry a full 32-colour palette at offset 0x40 in
8-bit RGB — it carries only **5** colours (12-bit Amiga RGB, u16 BE) at
offset 0x02, loaded into palette slots 1-5 as a small patch on top of
whatever 32-colour palette is already active (the wall-set's `.PAL`,
loaded separately — same "name-matched `<wallStem>.PAL`" mechanism
confirmed for DOS in `docs/eotb/dosvga/data-structure.md` § "VGA palette";
not independently re-traced for the Amiga palette-load call site this
pass, but the DOS mechanism's structural analogue — `.INF`'s embedded
wall-set stem — is shared code, `EoBCoreEngine::initLevelData`, so very
likely identical). Not yet re-rendered with the corrected offset/scaling
this pass — logged as confirmed-from-source, re-render is a follow-up.

---

## VMP — Wall View Mapping Table

5,834 bytes. Maps VCN tile indices to viewport positions. Identical across all
wall sets within each game (BRICK.VMP = BLUE.VMP, etc.).

Organizes the 22×15 tile viewport into 5 layers:
- 330 backdrop tile indices
- 431 indices per wall type (6 types × 431)
- Each 16-bit entry: 14-bit VCN tile index + 1-bit z-mask + 1-bit horizontal flip

---

## MAZ — Maze Layout

~4,102 bytes per level. Defines a 32×32 grid with 4 sides (N/E/S/W) per cell.

### Header

| Offset | Size | Description                    |
|--------|------|--------------------------------|
| 0x00   | 2    | Width (always 32)              |
| 0x02   | 2    | Height (always 32)             |
| 0x04   | 2    | Tile size flag (always 4)      |

### Cell Data

1,024 cells × 4 sides = 4,096 bytes. Each side encodes:
- Wall type (0 = none, other values for solid/door/stairs/etc.)
- Decoration count
- Click event index
- Passability bitflags

### Additional Data

After the cell grid:
- Door state sequences (3–7, 8–12, etc.)
- Stair connections
- Pit/teleport destinations
- Event scripts

---

## INF — Level Configuration

**Confirmed (2026-08-29, `tools/eotb/decode-inf.ts`): the file IS LCW-compressed,
using the same standard CPS header this doc already documents** (`FileSize`/
`CompressionType=4`/`UncompressedSize`/`PaletteSize`) -- a previous session's
"not compressed, plain-text-embedded" conclusion was wrong, and its root
cause is now understood: `strings LEVEL1.INF` shows readable
`level1.maz`/`brick`/`kobold`/`leech` directly in the raw file bytes, but
this is exactly what LCW's own "Command 1" (short literal copy) produces
for any string under 64 bytes -- it copies source bytes verbatim into the
compressed stream. Seeing plaintext strings in the compressed bytes is not
evidence against compression. Real LCW decompression (`tools/eotb/lcw.ts`'s
`decompressLCW`, the same decoder already verified against 62 real `.CPS`
files) applied to every real `data/eotb/amiga/LEVEL{1..12}.INF` succeeds
with **zero drift**, landing on real, sensible field values end to end (see
below).

### Decompressed field layout (EOB1, `slen=12`)

Verified by simulating `EoBCoreEngine::initLevelData`'s `gameID == GI_EOB1`
control flow byte-for-byte (`engines/kyra/engine/scene_eob.cpp:155-310`,
fetched from `github.com/scummvm/scummvm` -- these are the engine's own
**Amiga**-platform branches, e.g. line 233's `_flags.platform ==
Common::kPlatformAmiga` block, not a DOS-generic struct) plus
`EoBCoreEngine::loadActiveMonsterData` (`engines/kyra/engine/
sprites_eob.cpp:62-95`), against the real decompressed bytes:

| Offset (decompressed) | Size | Field |
|---|---|---|
| 0 | 2 | `triggersOffset` (u16 LE, unused by this parser) |
| 2 | 12 | `mazeName` (NUL-terminated) |
| 14 | 12 | `wallSetName` (NUL-terminated -- also reused verbatim by the engine to build `<name>.PAL`; EOB1 has **no separate on-disk palette-name field**) |
| 26 | 12 | reserved, read but never used by the EOB1 code path |
| 38 | 4 | door-shape params (raw bytes -> `loadDoorShapes`) |
| 42 | 1 | `scriptTimersMode` |
| 43 | 2 | script timer 0 ticks (u16 LE) |
| 45 | 2 | `stepsUntilScriptCall` (u16 LE) |
| 47 | 13 | monster shape 1: 1 compression/type byte (`0xFF`=none) + up to 12-byte name |
| 60 | 13 | monster shape 2: same shape |
| 73 | variable | `(type, interval)*` pairs, terminated by a `0xFF` type byte |
| (follows) | 420 | fixed 30-slot x 14-byte monster-placement array |
| (follows) | 1 + 2 | 1 unused discriminator byte + `num` (u16 LE) decoration/wall-mapping record count |
| (follows) | variable | `num` records: `0xEC` + two 12-byte names = decoration-load (25 bytes); anything else = **wall-mapping override** (6 bytes: 1 unused discriminator + `[wallIndex][vmpIndex][decIndex:int8][specialType][flags]`) |

**Verified against the real corpus:** every one of `LEVEL{1..12}.INF`
decompresses and parses with no out-of-range read, `mazeName`/`wallSetName`
match the known corpus, and every monster-shape name resolves to a real
`<name>.CPS` file in `data/eotb/amiga/` (level 1: `kobold`/`leech`; level 2:
`zombie`/`skeleton`; level 3: `kuotoa`/`flind`; level 4: `spider`/none;
level 5: `dwarf`/`spider`; level 6: `kenku`/`mage`; level 7: `drowelf`/
`skelwar`; level 8: `drider`/`hellhnd`; level 9: `rust`/`disbeast`; level
10: `shindia`/`mantis`; level 11: `xorn`/`mflayer`).

### Wall-mapping override table -- the `eotb1-amiga-walker-wallmapping` fix

`docs/eotb/TODO.md`'s open item is now closed. The wall-mapping override
record's fields exactly match `assignWallsAndDecorations`'s own signature
(`engines/kyra/engine/scene_eob.cpp:466`): `assignWallsAndDecorations(int
wallIndex, int vmpIndex, int decIndex, int specialType, int flags)`. The
real per-level lookup is: `EoBCoreEngine::resetWallData`'s default table
(`scene_eob.cpp:542-548`: `{1:1, 2:2, 3..22:3, 23:4, 24:5}`, everything
else -- including raw 0 -- defaults to vmpIndex 0, "no wall") with each
level's `.INF` wall-mapping records overriding individual `wallIndex`
entries on top. `tools/eotb/decode-inf.ts`'s `buildWallTypeMap(infData)`
builds this 256-entry table directly; `tools/eotb/view-model.ts`'s
`resolveWallTypes` now takes it as a parameter instead of the old
`clampWallType` approximation (raw > 6 -> generic solid wall 1).

Confirmed real `LEVEL1.INF` records include the exact `wallIndex` values a
previous session flagged as anomalous (`58`, `62` -- both real raw bytes in
`LEVEL1.MAZ`): `wallIndex=58 -> {vmpIndex:1, decIndex:35, specialType:0,
flags:4}`, `wallIndex=62 -> {vmpIndex:1, decIndex:23, specialType:2,
flags:4}`. A visually decisive case (rendered, see below): `LEVEL1.MAZ`
cell `(22,9)` side N has raw `wallIndex=25`, which `LEVEL1.INF` overrides to
`vmpIndex=0` (**no wall at all** -- an open passage) -- the old clamp
rendered this as a solid brick wall (vmpIndex 1), completely blocking a
passage that is actually open. Verified visually:
`public/assets/eotb/amiga/renders/level1-22-10-f0.png` (after the fix, at
pose x=22,y=10,facing=North, looking at that cell) now shows an open dark
corridor instead of a solid wall.

**Root cause of the previous session's failed hand-walk, now identified.**
It was not a real DOS-vs-Amiga struct-layout divergence (the Amiga on-disk
layout matches ScummVM's own `GI_EOB1`/`kPlatformAmiga` branches exactly,
byte for byte) -- the previous attempt simply never LCW-decompressed the
file, so it was walking compressed bytes against decompressed-buffer
offsets and was guaranteed to drift.

**Disassembly note.** A from-scratch trace of the Amiga executable's own
`.INF`-loading code was also attempted this session against
`data/eotb/amiga/eob2` (190,400 bytes; confirmed via `strings` to be the
one of this directory's three executables -- `eob` at 5,856 bytes, `EOB1`
at 40,508 bytes, `eob2` at 190,400 bytes -- that actually embeds the
`LEVEL*.INF`/`LEVEL*.MAZ`/monster-name literal strings, i.e. the main
game/dungeon binary; the other two's exact roles in the disk-swap chain
weren't investigated this pass), via IRA `-preproc`. The level-name
resource table (containing
literal strings like `LEVEL1.INF`) was located at `HUNK_DATA` module 12
(file offset 162732, 2600 bytes; the specific `LEVEL1.INF` pointer sits at
cumulative address `0x27b14`), but that same hunk's bytes disassemble as
plausible-looking 68k function prologues/epilogues that IRA doesn't
classify as code -- not resolved further given the time budget, since the
file-level verification above is already byte-exact and non-drifting
across the whole `LEVEL{1..12}.INF` corpus, using the Amiga port's own
real files and this repo's already-oracle-checked LCW decoder rather than
a DOS-oriented guess.

### Facing rotation for non-North poses — CONFIRMED (2026-08-29)

`docs/eotb/TODO.md`'s "facing rotation for non-North, unverified" item is
closed. `view-model.ts`'s `rotateOffset` (cell-offset rotation) and
`roleSide` (which absolute `.MAZ` side-byte a screen role reads) were
self-consistent by construction but never checked against a real oracle for
facings 1-3 (only facing 0/North was diagrammed from the VMP spec).

**Oracle: ScummVM's own `devtools/create_kyradat/resources/eob1_amiga.h`**
(fetched from `github.com/scummvm/scummvm`) — not the engine C++ source
itself, but the literal, per-platform static-data tables the ScummVM team
reverse-engineered from the real games and ships as readable C arrays,
registered specifically for `{ kEoB1, kPlatformAmiga }`
(`kEoB1DscBlockIndexAmigaProvider`, `kEoB1DscBlockMapAmigaProvider`, etc.) —
i.e. this exact game and platform, not a DOS/PC98/FMTowns/SegaCD sibling's
values. Transcribed into `tools/eotb/dsc-tables.ts`.

- **`DSC_BLOCK_MAP`** (`kEoB1DscBlockMapAmiga`, `eob1_amiga.h:1420`, 12
  bytes) drives `KyraRpgEngine::generateBlockDrawingBuffer`
  (`scene_rpg.cpp:128-131`): `_sceneDrawVarDown = _dscBlockMap[dir]`,
  `_sceneDrawVarRight = _dscBlockMap[dir+4]`, `_sceneDrawVarLeft =
  _dscBlockMap[dir+8]`. Decoding this and comparing against
  `roleSide(role, facing)`'s numeric side index for all 4 facings x 3 roles
  (`front`~"Down", `left`~"Right", `right`~"Left" — `generateBlockDrawingBuffer`'s
  own hardcoded call sites always pair the screen-far-left cell with
  `_sceneDrawVarRight` and the screen-far-right cell with
  `_sceneDrawVarLeft`, unconditional on facing) gives **zero mismatches
  across all 12 combinations**.
- **`kEoB1DscBlockIndexAmiga`** (`eob1_amiga.h`, 72 `int8` entries: 18 cells
  x 4 facings) drives `KyraRpgEngine::assignVisibleBlocks`
  (`scene_rpg.cpp:313-320`): `t = (block + _dscBlockIndex[direction*18+i]) &
  0x3FF`. Decoding each signed offset as `(dy, dx) = (offset >> 5 [floor
  division], offset - dy*32)` (32 = the `.MAZ` row stride) and comparing
  against `rotateOffset(dxRel, dyRel, facing)` for the matching
  `CELL_OFFSETS` letter gives **zero mismatches across all 68 populated
  `(facing, cell)` pairs** (17 named cells x 4 facings; `_visibleBlocks[16]`,
  the player's own cell, has no `CELL_OFFSETS` entry and isn't checked).

This is a real, independent, byte-exact ground truth for facings 1-3 — not
just self-consistency. Neither table is re-exported in this codebase since
nothing here reads raw block-index arithmetic directly; `CELL_OFFSETS`/
`rotateOffset`/`roleSide` remain the implementation, now confirmed correct.

### Decoration overlays (`decIndex`) — real format, partial render (2026-08-29)

**Confirmed: EOB1 Amiga's `decIndex` resolves against the wall-set's own
`.DAT` file** (`BRICK.DAT`, `BLUE.DAT`, etc — see "Wall Set DAT Files"
below for the byte format), which is **the same `LevelDecorationProperty` +
`EoBRect8` layout as EOB2's `.DEC` files** — EOB1 just names the container
differently and points it at a different filename per level. This refines
(does not overturn) the project's earlier "EOB1 has no `.DCR`" finding,
which is still correct and about a different, unrelated format (`.DCR` is
EOB2's *monster*-decoration format; EOB1 never uses it).

**Resolution requires walking `.INF`'s record stream in real on-disk
order**, not just indexing the parsed `wallMappings`/`decorationLoads`
arrays independently. `EoBCoreEngine::assignWallsAndDecorations` is called
once per record in file order during `initLevelData`, and each `0xEC`
decoration-load record repoints which `.DAT` (`_levelDecorationData`) is
currently active for every wall-mapping record that follows it, until the
next decoration-load record. `LEVEL1.INF` interleaves 3 decoration-loads
(`brick1`/`brick2`/`brick3`, all against `brick.dat`) with its wall-mapping
records — a wall-mapping's `decIndex` only resolves correctly against the
**closest preceding** decoration-load. `tools/eotb/decode-inf.ts`'s
`resolveWallDecorationAssignments(infData)` implements this by walking a new
`records: InfRecord[]` array (both record kinds, real file order) and
tracking the currently-active decoration-load, returning a `Map<wallIndex,
{cpsFile, decFile, decIndex}>`. Verified: `LEVEL1.INF` wallIndex 39 resolves
to `{cpsFile:'brick1', decIndex:0}` (against the *first* decoration-load),
while wallIndex 58 resolves to `{cpsFile:'brick2', decIndex:35}` (after the
*second*) — both confirmed against the real interleaved record order, and
covered by `tools/eotb/__tests__/eotb-decorations.test.ts`.

**Render mechanism implemented: front/"Down" role only
(`tools/eotb/renderer.ts`'s `drawWallDecorations`).**
`EoBCoreEngine::drawDecorations(index)` (`scene_eob.cpp:667-716`) loops `i`
from 1 down to 0 (side role, then front role) and, for each, checks a
36-entry table `_dscWallMapping[s]` (`s = index*2 + i`,
`eobcommon.cpp:267-280`) that's either null (no decoration drawn for that
role at this cell) or a pointer to `_sceneDrawVarDown`/`Right`/`Left`. For
`i=0` (front role) this pointer is `&_sceneDrawVarDown` for every cell
**except** cellIndex 6 (`G`) and cellIndex 17 (`Q`), where it's null — i.e.
ScummVM itself never draws a front-role decoration for those two cells.
This exactly matches an independent, pre-existing fact about this project's
own `WALL_RENDER_SLOTS` diagram (`decode-vmp.ts`): there is no `G-south` or
`Q-south` slot at all, only `G-west`/`Q-west` — a real cross-check that this
port's slot geometry and ScummVM's `_dscWallMapping` agree on which cells
carry a front wall (and therefore a front-role decoration) with zero prior
knowledge of `_dscWallMapping` when the slot diagram was built. `_dscWallMapping`
is not re-exported as a table since this project's `-south`-suffix filter on
`WALL_RENDER_SLOTS` already reproduces its exact effect for `i=0`.

For a `-south` slot's cellIndex, `shpIx = ABS(_dscShapeIndex[cellIndex*2]) -
1` selects which of a `LevelDecorationProperty`'s 10 screen-depth slots
applies (`DSC_SHAPE_INDEX` in `dsc-tables.ts`, from `kEoB1DscShapeIndexAmiga`,
`eob1_amiga.h:1262`); final on-screen X = `shapeX[shpIx] +
DSC_SHAPE_X[cellIndex]` (`DSC_SHAPE_X`, from `kEoB1DscXAmiga`,
`eob1_amiga.h:1272`); Y = `shapeY[shpIx]` directly — decorations are
pre-authored at final on-screen pixel size per depth slot, no scaling.
`decorationChain` follows each property's own `next` byte (terminates at
`next === 0`) to draw every decoration stacked at that wall.

**Explicitly not ported (documented gap, not silently dropped):**
- `i=1` (side/"Right"/"Left" role) decorations — the other half of
  `drawDecorations`'s loop; `_dscWallMapping`'s side-role entries are real
  and decoded (see the table above) but no renderer code consumes them yet.
- The `ix < 0` mirror-flip path (`flg & 1`, or `flg & 2` combined with the
  runtime `_wllProcessFlag`) — real property records do carry `flags=1`
  entries (confirmed: `BRICK.DAT` property 51) but the flip isn't applied.
- The `flg & 4` alternate-coordinate path (`_dscShapeCoords`, a separate
  per-cell table not yet decoded).

**Verified via a pixel-exact diff, not just a visual glance.** Rendering
`LEVEL1` pose x=6,y=4,facing=1 with vs. without `decorationParams` differs
in exactly 193 pixels, whose bounding box `(65,32)-(73,56)` matches the
hand-computed expected placement from `wallDecorations`/`DSC_SHAPE_X` for
that pose's `wallIndex=39 -> decIndex=0 -> rect[0]` (9x25px) to the pixel —
see `public/assets/eotb/amiga/renders/` for the rendered PNG. The shape
renders as a real, coherent (non-garbled) decoration silhouette, not noise.

> **Correction (2026-08-29, side-role session):** the specific historical
> pose cited above (`LEVEL1` x=6,y=4,facing=1 -> `wallIndex=39`) could not
> be reproduced against this session's regenerated
> `public/assets/eotb/amiga/dungeon/level1.json` (gitignored build
> output) -- `resolveWallTypes` at that exact pose no longer resolves any
> slot to `rawWallIndex=39` (it resolves `O-south -> wallIndex=29` and
> `N-south -> wallIndex=60` instead). This is very likely a stale
> citation from before some unrelated later regeneration of the build
> output, not a decode regression: the underlying mechanism this
> citation was verifying (`decIndex` resolution + front-role placement)
> is untouched by anything in this project's history since, and a fresh
> search this session re-confirmed `wallIndex 39 -> decIndex 0` is real
> and still resolves correctly at other real poses (e.g. `LEVEL1`
> x=21,y=19,facing=3, slot `B-south`) -- see "Both roles implemented and
> verified" below for the current, reproducible evidence. Recorded here
> per this project's "supersede in place, don't silently delete"
> convention rather than editing the stale numbers away.

### Both roles implemented and verified (2026-08-29, side-role session)

**`i=1` (side/"Right"-or-"Left" role) decorations, the `ix<0` mirror-flip,
and the `flg&4` alternate-coordinate path are now all implemented** in
`tools/eotb/renderer.ts`'s `drawWallDecorations`, in one unified pass over
`resolved` covering both roles (`decorationRole(slot.label)` maps a
resolved slot's `-south`/`-east`/`-west` suffix to `i=0`/`i=1`). Real
source refetched fresh this session (`scene_eob.cpp:667-716`, verbatim
excerpt in `dsc-tables.ts`'s module doc) and re-verified line-by-line, not
trusted from the prior session's paraphrase.

**Correction to this session's own starting assumption** (the task brief
that opened this work item assumed side roles need the flag-driven
mirror-flip since "they're mirrored for left vs. right sides"): the real
source gates `ix = -ix` with `(i == 0) &&` — this flip is FRONT-role-only.
Side-role mirroring is carried entirely by `DSC_SHAPE_INDEX`'s own static
sign at odd (`i=1`) table entries instead: negative for every
`-west`-suffixed cell (E,F,K,L,O,Q), positive for every `-east`-suffixed
one (A,B,C,H,I,M,P) — confirmed by cross-checking every cell's sign
against its real `WALL_RENDER_SLOTS` suffix, zero mismatches. The `ix<0`
mirrored-draw formula itself (`x = 176 - shapeX[shpIx] - shapeWidthPx`,
drawn horizontally flipped) is unconditional on `i`; only the extra
flag-driven negation is front-role-only.

**`_wllProcessFlag` (gating `flg & 2`) is confirmed moot for this whole
game, not modelled at all.** A whole-corpus census of all 5 real `.DAT`
files' `DecorationProperty.flags` (198 properties total: BRICK 60, BLUE
40, DROW 35, GREEN 36, XANATHA 27) found bit `0x02` set on **zero**
records (bit `0x01`: 18/198 — BRICK 10, BLUE 3, DROW 1, GREEN 0, XANATHA
4; bit `0x04`: 21/198 — BRICK 6, BLUE 4, DROW 3, GREEN 2, XANATHA 6). Since
`flg & 2` can never fire on any real EOB1 Amiga decoration, it's omitted
from the port entirely rather than defaulted to a guessed value.

**`_dscShapeCoords` (the `flg & 4` table) is now decoded**, as
`dsc-tables.ts`'s `DSC_SHAPE_COORDS` — ScummVM's own literal
`kEoB1DscShapeCoordsAmiga` (180 `uint16`/signed entries, `eob1_amiga.h:
906-931`), 18 cellIndex groups of 5 signed `(x,y)` pairs; only each
group's 5th pair's X word (`cellIndex*10+8`, matching the real source's
`(index*5+4)<<1` byte-for-byte) is consumed by this decoration path.

**A shape's real pixel width, for the mirrored-draw formula.** The real
source computes `176 - shapeX[shpIx] - (shapeData[2] << 3)`, where
`shapeData[2] << 3` is a runtime encoded-shape's own header field. This
port never builds that runtime `shapeData` at all (it blits straight from
the decoded `.CPS` canvas using each `DecorationRect`'s own `w`/`h` as
literal pixel dimensions — already independently verified pixel-exact for
the non-mirrored case, see above), so `rect.w` is substituted directly:
both quantities necessarily name the same real shape pixel width.

**Verified against the real corpus, all four newly-implemented paths,
each with a real reachable case (not a synthetic fixture):**

| Mechanism | Real case | Result |
|---|---|---|
| Side role, non-mirrored (`-east`) | `LEVEL1` x=6,y=4,facing=2, `M-east`, `decIndex=32`, `shpIx=5` | 31 differing pixels, bbox `(31,33)-(32,52)` — matches the `w=2,h=20` source rect exactly |
| Side role, non-mirrored, small rect | `LEVEL1` x=6,y=2,facing=2, `I-east`, `decIndex=36`, `shpIx=6` | 4 differing pixels, bbox `(57,39)-(57,42)` — matches the `w=1,h=4` source rect exactly |
| Side role, mirrored (`-west`) | `LEVEL1` x=5,y=7,facing=0, `L-west`, `decIndex=32`, `shpIx=8` | 24 differing pixels, bbox `(174,36)-(175,47)` — matches the `w=2,h=12` source rect exactly, landing fully in-bounds near the right edge as the `176 - x - w` formula predicts |
| `flg&1` mirror-flip (front role) | `LEVEL12` x=0,y=0,facing=1, `E-south`, `decIndex=12` (XANATHA wall set) | 26 differing pixels, bbox `(120,45)-(135,59)`, in-bounds |
| `flg&4` alternate-coordinate (front role) | `LEVEL1` x=20,y=11,facing=2, `B-south`, `decIndex=29` | 74 differing pixels, bbox `(74,55)-(77,73)`, in-bounds |
| Front-role regression (unchanged formula path) | `LEVEL1` x=21,y=19,facing=3, `B-south`, `wallIndex=39 -> decIndex=0` (the same chain the original front-role work verified) | 9 differing pixels, bbox `(106,37)-(172,63)`, in-bounds — confirms the front-role path is unchanged: for a property with `flags===0` the new unified formula is algebraically identical to the prior front-role-only code (same `s`, same `ix` sign, same `x` sum, `mirror=false`) |

All four full-scene renders (`public/assets/eotb/amiga/renders/level1-6-4-f2.png`,
`level1-5-7-f0.png`, `level12-0-0-f1.png`, `level1-20-11-f2.png`) show
coherent, non-garbled dungeon views with a small, plausibly-placed
decoration element visible on the relevant wall — not noise. One
mirrored side-role candidate found during the search (`LEVEL1` x=19,y=11,
facing=1, `O-west`, `decIndex=22`, `shpIx=5`) legitimately produces **0**
differing pixels: its resolved source rect (`{x:34,y:138,w:1,h:25}`) is
confirmed, by directly sampling the decoded `.CPS` sheet, to be entirely
palette index 0 (transparent) at every one of its 25 pixels — a real
"this specific depth slot has no authored content" case, not a bug (the
masking logic correctly draws nothing).

**Still not modelled, narrower than the original 3-item gap:** none of
the three items in this section's original "explicitly not ported" list
remain open. The only residual gap in this rendering path is unrelated to
this session's work: `_sceneShpDim` clipping (a rectangular dim region
the real engine passes to `drawBlockObject`) is not modelled by this
port's `blit`, matching the pre-existing, separately-documented lack of
per-slot clipping elsewhere in this renderer.

### `specialType` / `flags` semantics — traced (2026-08-29)

**`specialType` is a dispatch selector for click-driven wall interactions**,
named by `EoBCoreEngine::specialWallAction` (`scene_eob.cpp:869-899`), which
switches on `_specialWallTypes[wallIndex]` (seeded at level load directly
from a wall-mapping record's `specialType` field, `assignWallsAndDecorations`
`scene_eob.cpp:480`):

| `specialType` | Handler | Meaning |
|---|---|---|
| 1 | `clickedDoorSwitch` | a door switch/button |
| 2, 8 | `clickedWallShape` | a clickable wall shape (e.g. secret-wall trigger) |
| 3 | `clickedLeverOn` | a lever, sets state ON |
| 4 | `clickedLeverOff` | a lever, sets state OFF |
| 5 | `clickedDoorPry` | a stuck door, forceable open (strength check) |
| 6 | `clickedDoorNoPry` | a door that cannot be pried (prints a message, no effect) |
| 7, 9 | `clickedWallOnlyScript` | runs a level script only, no other effect |
| 10 | `clickedNiche` | an item niche/alcove (put/take items) |
| 0 (default) | — | no special interaction |

`EoBCoreEngine::resetWallData` (`scene_eob.cpp:552-557`) seeds two default
groups before any `.INF` override is applied: wallIndex 3-7 and 13-17 as
type 1 (door switch), and wallIndex 8/18 as type 6 (no-pry door) — these are
the two "niche/door" wallIndex clusters this project's own `LEVEL2.INF`
sample data already showed as anomalous (`wallIndex=30, specialType:5,
flags:12` — a real pryable-door record).

**`flags` seeds `_wllWallFlags[wallIndex]` directly, with one bit inverted**
(`assignWallsAndDecorations`: `_wllWallFlags[wallIndex] = flags ^ 4`).
Confirmed bit roles from real consumers:

| Bit | Meaning | Consumer |
|---|---|---|
| `0x08` | "this wall is a door" — gates `drawDoor` | `drawSceneShapes`, `scene_eob.cpp:646`: `if ((drawFlags & 0x04) && (w & 8)) drawDoor(t)` — unaffected by the `^4` inversion (different bit) |
| `0x02` | "door currently open" (dynamic, runtime-toggled) | `toggleWallState(wall, toggle)` (`scene_eob.cpp:560-571`) sets/clears this bit across a 9-wide sub-wall-index group (`wall*10+3 .. wall*10+11`, skipping `+4`) — called from `.INF`'s embedded event-script opcode stream (`scene_eob.cpp:262`: `toggleWallState(pos[13], a); _doorType[pos[13]] = pos[14];`), not from any static per-level table |
| `0x04` | inverted by `^4` at load — i.e. a bit that's normally **set** in `.wllFlagPreset`'s defaults gets **cleared** for any wall a `.INF` record explicitly assigns (or vice versa); exact semantic role not traced further this session | `assignWallsAndDecorations` only |
| `0x20` | "cannot be pried open" | `clickedDoorNoPry`/`clickedDoorPry`, `scene_eob.cpp:862`: `if (!(_wllWallFlags[...] & 0x20)) return 0;` |
| `0x01`, `0x10`, `0x40`, `0x80` | not traced this session | — |

This is real, cited, and sufficient to label most wallIndex records
semantically (door/lever/niche/plain) — a full per-bit trace of the
untraced flag bits above is left open (not blocking, no rendering behaviour
depends on them for a static geometry walker).

### Door open/closed state — left static, by deliberate decision (2026-08-29)

**Door state is genuinely runtime/event-script-driven, not stored
per-level anywhere the walker parses.** `toggleWallState` (see the `0x02`
row above) is only ever called from `.INF`'s embedded event-script
bytecode (a distinct sub-format inside `.INF`, not yet decoded by this
project — different from the wall-mapping/decoration-load record stream
this session's work covers), itself triggered by gameplay actions (levers,
switches, plot flags) this project's static walker has no state model for
(no save-driven or party-action-driven game-state simulation exists).

**Decision: leave doors rendered statically from each level's `.MAZ`
snapshot**, which is what this project already does. This is defensible,
not a gap papered over: `.MAZ`'s baked-in wallIndex values already reflect
a real, well-defined door state — the level's default/initial state before
any script has run, i.e. exactly what ScummVM itself would render on a
fresh level load. Implementing dynamic door state would require decoding
`.INF`'s event-script opcode stream (a real, nontrivial reverse-engineering
project on its own) AND giving the walker some notion of game/plot state to
drive it — both out of scope for a static level-geometry viewer. Recorded
here explicitly per this session's brief, rather than left undocumented.

---

## DAT — Data Files

### ITEM.DAT (9,601 bytes, EOB1)

Doubly-linked list of item instances. Each entry: 15 bytes with identified/
unidentified name indices, bitflags (glow, identified, cursed, life-drain),
icon index, type (0–56), sub-position, x/y position, level, value. Ends with
a name string table (35 characters per name).

**Verified item names:** Leather armor, Robe, Staff, Dagger, Short sword,
Lock picks, Spellbook, Cleric Holy symbol, Leather boots, Iron Rations,
Jeweled Key, Potion, Wand, Scroll, Ring, Severious, Backstabber,
Drow Cleaver, Slicer, Flicka, and many more.

### ITEMTYPE.DAT (914 bytes, EOB1)

Item type templates. Each entry: inventory slot bitmask (quiver, armour,
bracers, backpack, boots, helmet, necklace, belt, ring), hand usage,
AC modifier, class permissions (fighter/mage/cleric/thief), damage dice
(rolls/sides/base) for small and large targets. 57 item types total.

### TEXT.DAT (16 KB, EOB1)

Game narrative text, UI strings, and system messages. Null-terminated strings
organized in a lookup table.

### Wall Set DAT Files (EOB1) — decoration data, confirmed byte-exact (2026-08-29)

`BLUE.DAT`, `BRICK.DAT`, `DROW.DAT`, `GREEN.DAT`, `XANATHA.DAT`. **This is
the same `LevelDecorationProperty` + `EoBRect8` container EOB2 ships as
`.DEC`** (`EoBCoreEngine::getDecDefinitions`, `scene_eob.cpp:421-464`),
forced little-endian regardless of platform, decoded by
`tools/eotb/decode-decorations.ts`'s `decodeDecorations`:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | `numProperties` (u16 LE) |
| 2 | `numProperties * 52` | `LevelDecorationProperty[]` — see below |
| (follows) | 2 | `numRects` (u16 LE) |
| (follows) | `numRects * 8` | `EoBRect8[]` — `{x:u16, y:u16, w:u16, h:u16}`, all LE |

Each 52-byte `LevelDecorationProperty`:

| Offset | Size | Field |
|---|---|---|
| 0 | 10 | `shapeIndex[10]` (u8 each; `0xFF` is a sentinel meaning "no shape at this depth slot", widened to `0xFFFF` on decode to distinguish from a real rect index 0-254) |
| 10 | 1 | `next` (u8 — index of the next chained property, or `0` to terminate; see the `decorationChain` caveat below) |
| 11 | 1 | `flags` (bit0/bit1 gate the `ix<0` mirror-flip in `drawDecorations`; bit2 selects the `_dscShapeCoords` alternate-coordinate path — none of the three are applied by this port's renderer yet) |
| 12 | 20 | `shapeX[10]` (s16 LE each) |
| 32 | 20 | `shapeY[10]` (s16 LE each) |

**Verified: all 5 real `.DAT` files parse with zero residue** (the decoder
throws if the final read position doesn't land exactly on EOF) — `BRICK.DAT`
alone: 60 properties, 177 rects. Every non-sentinel `shapeIndex` value
across all decoded properties resolves to a real rect with `w>0, h>0` (no
degenerate/zero-area entries). See `tools/eotb/__tests__/eotb-decorations.test.ts`.

**`next`-chain caveat:** `next == 0` always terminates a chain, even though
0 is itself a valid absolute index for the *first* property in the array —
this matches `assignWallsAndDecorations`'s own `do { ... } while (decIndex
!= -1)` loop, which treats a `next` of 0 as "stop" unconditionally
(`scene_eob.cpp:508-512`: `decIndex = ...next; if (decIndex) ... else
decIndex = -1;`). `decorationChain` reproduces this exactly, plus a
cycle-guard as defensive programming (not needed by any real file so far).

The rects are the actual `encodeShape(x, y, w, h, ...)` source regions in
the wall set's shape sheet (`BRICK1.CPS`/`BRICK2.CPS`/`BRICK3.CPS` for
`BRICK`, one `.CPS` per other wall set — see "Decoration overlays" above
for how a wall-mapping's `decIndex` picks which sheet is active). Palettes
for the shape sheets are the wall set's own `.VCN`-derived palette (same
palette already used for wall rendering — no separate decoration palette).

---

## EOBDATA.SAV — Save game (confirmed, ported, byte-exact verified — 2026-08-29)

**`eotb1-amiga-savegame-port` closed.** The full record layout below was
ported to `tools/eotb/decode-savegame.ts` (`decodeSavegame`) and verified
against the real `data/eotb/amiga/EOBDATA.SAV` (33,107 bytes): the decoder
throws unless its cursor lands **exactly** on EOF after walking every
character record, party field, INF-processor flag state, all 500 item
slots, all 12 per-level temp-data blocks, and the 6 `EoBItemType`
overrides — and it does, with **zero residue**. Along the way it decoded
plausible, semantically correct content with no further oracle needed:
4 active party members with legible AD&D-style names (`ALLABAR`, `ARIEL`,
`VALANAU`, `TENMIYANA`), in-range HP (`cur <= max` for every character and
every decoded monster-in-play record), party at dungeon level 1, and
exactly 1 of 12 level temp-data slots flagged active (`hasTempDataFlags =
0x0001`), matching a party that has only ever visited level 1.

**One confirmed discrepancy from a literal reading of the ScummVM
source, resolved empirically.** `readOriginalSaveFile`'s per-level
temp-data loop is written as `for (i = 0; i < numParts + 1; i++)` with
`numParts = 12` for EOB1 (13 fixed 2040-byte blocks). Walking the real
file with 13 blocks overshoots it by exactly one block (2040 bytes);
walking it with **12** blocks (`numParts`, not `numParts + 1`) lands the
cursor on the file's last byte exactly. Every other section (character
records, item table, the 6 `EoBItemType` overrides) verified size-exact
against the literal source reading with no adjustment needed — this
discrepancy is isolated to that one loop bound. See
`tools/eotb/decode-savegame.ts`'s module doc for the full byte-accounting
derivation that pinned this down (each of: character-record size,
party-field size, INF-processor state size, and the item table's 14-byte-
per-record layout, cross-checked field-by-field against the source before
concluding the loop bound itself was the discrepancy, not a miscounted
field elsewhere).

Also newly load-bearing for this decode: `EoBInfProcessor::loadState`
(`script/script_eob.cpp:215-220`) for the `origFile`+EOB1 case reads **no**
`_preventRest` byte (unlike EOB2/non-`origFile`), then exactly 12 `u32`
flags, then one more `u32` merged into `_flagTable[17]` — 52 bytes total,
not documented anywhere before this pass since it sits between the
already-documented party fields and the item table.

Tests: `tools/eotb/__tests__/eotb-savegame.test.ts` (4 tests, real-file-
gated — skips cleanly if the corpus file isn't present).

### Original text (superseded by the above, kept for the historical
record of what this item looked like before this pass)

**Confirmed: a byte-exact, source-derived spec exists** in
`GUI_EoB::loadGameOld`/related (`gui/saveload_eob.cpp:690-780+`), including
a platform **auto-detection heuristic** the engine itself uses to load
save files from any of DOS/Amiga/FM-Towns without a format flag:
```cpp
test.seek(_flags.gameID == GI_EOB1 ? 39 : 61);
uint32 exp = test.readUint32LE();
test.seek(_flags.gameID == GI_EOB1 ? 61 : 27);
bool padding = !test.readByte();
if (sourcePlatform == DOS && padding && (exp & 0xFF000000))
    sourcePlatform = Amiga;
```
**Verified against the real `data/eotb/amiga/EOBDATA.SAV` (33,107 bytes):**
applying this exact heuristic to the real file — `byte[61] == 0` (padding
true) and `u32_LE(bytes[39:43]) & 0xFF000000 == 0x13000000` (nonzero) —
correctly identifies it as Amiga-sourced, matching its known origin
(it's in the Amiga data directory). This is a clean, cheap, real-data
confirmation that the detection logic and byte offsets are right for this
project's actual file.

The subsequent per-character record (`saveload_eob.cpp:730-780+`) is
fully byte-exact from the reader (id, flags, name[11 or 21 depending on
platform], 7 stat pairs (cur/max) as signed bytes, HP as byte (EOB1) or
u16 (EOB2), AC, disabledSlots, raceSex, class, alignment, portrait, food,
level[3], experience[3] as u32, spell slots, etc.) with explicit
Amiga-vs-DOS field-width differences already handled in the reader (e.g.
`if (_flags.gameID == GI_EOB2 && sourcePlatform == Amiga) in.skip(1);` at
`saveload_eob.cpp:751-752`). This is well past "documented but not
verified" — the full record layout is directly readable from
`saveload_eob.cpp:690-900+`ish and the platform-detection prefix is now
byte-verified against the real file. Not ported into a standalone
Python decoder this pass (the source itself is the practical reference;
committing a full port of this ~200-line reader was deprioritized in
favour of closing the remaining unopened-format items) — narrows
`eotb1-amiga-savegame` from "structure unknown, needs verification" to
"structure fully known and spot-verified, extractor not yet written."

---

## Monster Graphics

Monster sprites are stored as standard CPS files at 320×200 5bpp. Each file
contains one or more animation frames arranged within the 320×200 canvas.

**EOB1 monsters (22 types):** KENKU, KOBOLD, KUOTOA, LEECH, GOLEM, SKELETON,
SKELWAR, ZOMBIE, SPIDER1, MANTIS1, DRIDER1, HELLHND, FLIND, DROWELF, DWARF,
MAGE, WIZARD, XANATH1, XORN1, HUM1, MFLAYER, KING.

**EOB1 attack animations (8):** BEASTATK1, FLAYERATK1, HOUNDATK1, RUSTATK1,
BLADE1, SCREAM1.

**EOB1 movement animations (4):** LEECHMOV1, KUOTOAMOV1, SPIDERMOV1,
MANTISMOV1, SLOSHSUCK1.

**EOB1 special effects (3):** WTRDP1, WTRDP2, WTRDP3 (water drop effects).

**EOB2 monsters (8):** BEHOLDER, DRAGON, WOLF, ANT, MEDUSA, GARGOYLE,
BASILISK, BULETTE.

Most monster CPS files use the INVENT palette or their wall-set palette.
A few (TOWRMAGE, KING, ORB, WTRDP1) have embedded palettes.

---

## EOB2 — Additional Formats

### PAL Files

Standalone palette files (64 bytes = 32 × 16-bit big-endian Amiga colors).
`FINALE.PAL` is 384 bytes containing 6 palettes.

### DEC Files

**Confirmed, format shared with DOS.** `EoBEngine::getDecDefinitions` has
no Amiga-specific override (only SegaCD overrides it) — it falls straight
through to the base `EoBCoreEngine::getDecDefinitions`
(`engine/scene_eob.cpp:420-422`), which reads via
`createEndianAwareReadStream(decFile, Resource::kForceLE)` — **forced
little-endian regardless of platform**. So `.DEC` on Amiga uses the exact
same byte layout as DOS. See `docs/eotb/dosvga/data-structure.md` § "INF —
Level configuration" → ".DEC — decoration definitions" for the full
confirmed record layout (52-byte `LevelDecorationProperty` records + an
8-byte `EoBRect8` array). This closes `eotb1-amiga-dec-format` — the
Shikadi-wiki-derived description can be replaced by this source-confirmed
one; not independently re-verified against a real Amiga `.DEC` file this
pass (the DOS-side verification target didn't exist in this corpus either
— logged as confirmed-from-source only).

**`eotb1-amiga-dec-verify` — checked exhaustively (2026-08-29), genuinely
unverifiable, not just "not attempted".** `find data -iname '*.dec'`
across the *entire* repo's `data/` tree returns **zero** hits under
`data/eotb/amiga/` or `data/eotb/dosvga/` — this corpus contains no `.DEC`
file for EOB1 at all, DOS or Amiga. This is not a gap in this pass's
search; it's the expected, consistent consequence of an already-confirmed
fact one section up ("Monster Graphics" / the DOS doc's INF section):
`hasDecorations` is hardcoded `false` at every EOB1 call site
(`scene_eob.cpp:275`), so the shipped EOB1 game never needed to ship any
`.DEC` files in the first place — the only `.DEC` files that exist
anywhere in this project's data are EOB2's (`data/eotb2/dosvga/*.DEC`,
`data/eotb2/amiga/data/*.DEC`), a different game with its own already-
documented format doc. **This item stays closed as "format confirmed from
source, byte-verification against real Amiga bytes is not possible in
this corpus because no such file exists for this game"** — a real, honest
negative, not a deferred task.

### OUT Files

Overhead map data for outdoor areas. References wall sets and defines the
outdoor terrain layout. Not traced this pass (not in the requested item
list — EOB2-specific, `docs/eotb2/TODO.md` doesn't carry an OUT item
either).

### DCR Files

**Confirmed structure (EOB2 only — genuinely does not apply to EOB1).**
`EoBCoreEngine::loadMonsterShapes` (`engine/sprites_eob.cpp:34-51`) only
opens a monster's `.DCR` file when its `hasDecorations` parameter is
`true`; tracing every call site (`engine/scene_eob.cpp:275,280`) shows
**EOB1 always passes `false`** (`if (*pos != 0xFF) loadMonsterShapes(...,
false, ...)`, `scene_eob.cpp:275`) while **EOB2 passes it per-monster from
the `.INF` data** (`pos[15] ? true : false`, `scene_eob.cpp:280`). This
matches the corpus directly: `data/eotb/amiga/` (and DOS `data/eotb/dosvga/`)
contain **zero** `.DCR` files, while EOB2 does (`docs/eotb2/dosvga/`'s
`BEHOLDER.DCR` etc.). **`eotb1-amiga-dcr-format` is closed as "does not
apply to EOB1" rather than "undecoded"** — the real format (for EOB2) is
now documented in `docs/eotb2/dosvga/data-structure.md`, decoded from
`DarkMoonEngine::loadMonsterDecoration` (`engine/darkmoon.cpp:310-336`):
```
u16 LE  setCount
repeat setCount:
    repeat 6:                    # one per facing/pose variant
        u8[6]  dc = [encX, encY, encW, encH, s8 offsetX, s8 offsetY]
        # dc[2]==0 or dc[3]==0 -> this slot is inactive/unused, skipped
```
i.e. `setCount * 36 + 2` bytes total. Verified against the EOB2 DOS
`BEHOLDER.DCR` (38 bytes, per `docs/eotb2/dosvga/TODO.md`):
`2 + 1*36 = 38` — **exact match, zero residue**, for `setCount=1`.

### SAM Files

Raw 8-bit PCM audio samples. Level-specific sounds: `LEVEL1.SAM` through
`LEVEL16.SAM`, plus `INTRO.SAM`, `FINALE.SAM`.

---

## File List — EOB1

| Category | Files |
|----------|-------|
| Wall CPS | BLUE, BRICK1, BRICK2, BRICK3, DROW, GREEN, XANATHA (BRICK is the one wall set split across 3 shape sheets, referenced by name in `.INF`'s decoration-load records — see "Wall Set DAT Files" below; the other 4 sets each have a single same-named `.CPS`) |
| Wall VCN | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall VMP | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall DAT | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall samples | LEVELSAM1–LEVELSAM12 |
| Maze | LEVEL1–LEVEL12.MAZ |
| Info | LEVEL1–LEVEL12.INF |
| Monsters | KENKU, KOBOLD, KUOTOA, LEECH, GOLEM, SKELETON, SKELWAR, ZOMBIE, SPIDER1, MANTIS1, DRIDER1, HELLHND, FLIND, DROWELF, DWARF, MAGE, WIZARD, XANATH1, XORN1, HUM1, MFLAYER, TOWRMAGE, KING, DAND, SHINDIA |
| Animations | BEASTATK1, FLAYERATK1, HOUNDATK1, RUSTATK1, BLADE1, SCREAM1, LEECHMOV1, KUOTOAMOV1, SPIDERMOV1, MANTISMOV1, SLOSHSUCK1, WTRDP1–3 |
| UI | TITLE, CHARGEN, CHARGENA, CHARGENB, INVENT, ITEMICN, ITEML1, ITEMS1, DOOR, PLAYFLD |
| Cutscenes | INTRO1–5, FINALE1–2, OUTTAKE, PRESENT, WESTWOOD, SSI, COUNCIL, COUNCILA–B |
| Effects | ORB, PORTALA, PORTALB, TUNNEL, ZOOMTUNL, AVALANCH, DECORATE, SFX1–4 |
| Data | ITEM.DAT, ITEMTYPE.DAT, TEXT.DAT, EOBDATA.SAV, LEVELS.TMP |
| Executables | eob, EOB1, eob2 |

---

## Open Questions

See `docs/eotb/TODO.md`.

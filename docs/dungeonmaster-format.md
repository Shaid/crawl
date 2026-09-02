# Dungeon Master family — shared container/codec formats

Covers the file-container and pixel/compression codecs shared by Dungeon
Master (1987), Chaos Strikes Back (1990), and Dungeon Master II: Skullkeep
(1995), all Amiga releases in this repo:

- `docs/dungeonmaster/amiga/data-structure.md`
- `docs/chaosstrikesback/amiga/data-structure.md`
- `docs/dungeonmaster2/amiga/data-structure.md`

Shared code: `tools/shared/dungeonmaster-container.ts` (data-file container),
`tools/shared/dungeonmaster-codec.ts` (pixel codecs + dungeon compression),
`tools/shared/dungeonmaster-dungeon.ts` (dungeon-file parser),
`tools/shared/dungeonmaster-render.ts` (top-down map + greyscale-atlas
rendering).

## Provenance

Primary source: the **Dungeon Master Encyclopaedia** community
documentation project, http://dmweb.free.fr/community/documentation/
file-formats/ (fetched 2026-09-02):

- "Data Files" — http://dmweb.free.fr/community/documentation/file-formats/data-files/
  — the `GRAPHICS.DAT`/`ANIM.DAT`/etc. container header shapes and the
  `IMGx` pixel-codec family (`IMG1`-`IMG9`+`IMGA`), plus a per-game,
  per-platform item-type table.
- "Dungeon Files" — http://dmweb.free.fr/community/documentation/file-formats/dungeon-files/
  — `DUNGEON.DAT` header, map definitions, square-grid layout, and the
  `0x8104` dungeon-compression scheme.
- "Saved Game Files" — the saved-game envelope format, confirming CSB's
  save files embed an uncompressed, plaintext "Dungeon Data" section
  (used to locate CSB's real 11-map dungeon inside `disk2/MINI.DAT`,
  since no standalone `Dungeon.DAT`-equivalent ships for it on Amiga).

Secondary source (DM2 image codec only): "Dungeon Master II Data Files
Notes" (fan analysis by "kentaro.k-21"),
http://dmweb.free.fr/community/documentation/file-formats/dungeon-master-ii-data-files-notes/
— describes DM2's `IMG3`/`IMG4`/`IMG7`/`IMG8` local-palette RLE grammar in
more implementation-level detail than the primary docs, plus a "how to
read some messed up images" worked example of the differential/overlay
compositing scheme (`IMG7`/`IMG8`) used by a minority of DM2 images. This
page is explicitly hedged by its own author on some points (e.g. "I tried
and decided the colors with my feeling") — treated as a lead, not ground
truth; only the parts independently confirmed against real corpus bytes
(the base `IMG3`/`IMG4` grammar) are implemented and shipped.

None of these docs are Amiga-specific — they cover DOS, Atari ST, FM-Towns,
PC-98, and Amiga together with per-platform notes. Every claim below was
re-verified against this repo's real Amiga corpus bytes rather than trusted
from prose alone; see each per-game doc's evidence sections.

## Data-file container (`GRAPHICS.DAT`, `ANIM.DAT`, `HCSB.DAT`, ...)

Three header shapes, auto-detected from the first big-endian `u16`:

| Format | Signature | Used by (this corpus) | Header layout |
|---|---|---|---|
| `DMCSB1` | none (word0 = item count directly) | supported by the reader; no file in this corpus actually uses it (see below) | `u16 itemCount`, then `itemCount` × `u16` compressed size, then `itemCount` × `u16` decompressed size |
| `DMCSB2` | `0x8001` | **both** DM1's `Graphics.DAT` and CSB's `disk1/Graphics.DAT` (749 items each) | `u16 sig`, `u16 itemCount`, `itemCount`×`u16` compSize, `itemCount`×`u16` decompSize, `itemCount`×`[u16,u16]` attribute words |
| `DMII` | `0x8005` (`0x8004` on FM-Towns, not this corpus) | DM2 `GRAPHICS.DAT` (4,630 items) | `u16 sig`, `u16 itemCount`, `u32` size of item 0, then `itemCount-1`×`u16` sizes |

All three: item payloads follow the header back-to-back in item order, sized
by the header's own per-item size field(s) — no padding/alignment observed.

Real-corpus correction: an earlier pass of this doc assumed DM1's Amiga
release used the signature-less `DMCSB1` shape (reasoning by community-docs
version-number analogy, not from real bytes) — checking the actual file
shows DM1's `Graphics.DAT` starts with `8001 02ed ...`, i.e. it's `DMCSB2`
(0x8001 signature, 749 items), byte-for-byte the same container shape as
CSB's. `DMCSB1` support stays in the reader (it's a small, harmless extra
branch, and other DM1 `.DAT`/`.FTL` files in this corpus weren't all
checked), but no file actually decoded this pass used it.

**Verified** (0 residue): for every `DataFile` parsed in this corpus,
`Σ item.size === payload region length` (header dataStart to EOF) — see each
extractor's item-count/size log lines.

**Verified**: the community docs' claim that some Atari ST files carry an
optional secondary LZW wrapper does not apply to any Amiga file in this
corpus — `compressedSize === decompressedSize` for every `DMCSB2` item
checked (DM1 + CSB `Graphics.DAT`, 683 image-shaped items of 749 total each).
Each item's bytes may still be internally RLE-encoded — that's the separate
`IMGx` pixel codec, not this container's own (unused-here) LZW layer.

## `IMGx` pixel codec family

A 4-bit-per-pixel indexed codec, big/little-endian-header sibling pairs. The
raw payload after the header is a stream of 4-bit **nibbles**, read
high-nibble-first per byte (`NibbleReader` in `dungeonmaster-codec.ts`).

### `IMG1`/`IMG2` — no local palette (confirmed: DM1, CSB)

Header: `u16 width`, `u16 height` (`IMG1` = big-endian, used by every Amiga
file in this corpus; `IMG2` = little-endian, DOS/PC-98/FM-Towns, not needed
here but the RLE stream itself is endian-agnostic past the header).

Control grammar, read as nibble pairs `(n1, n2)`:

| `n1` | Meaning |
|---|---|
| `0x0`-`0x7` | Solid run: `n1+1` pixels of colour `n2` |
| `0x8` | Solid run: `byte()+1` pixels of colour `n2` |
| `0xc` | Solid run: `word()+1` pixels of colour `n2` |
| `0xb` | Copy `byte()+1` pixels from the line above, then 1 solid pixel of `n2` |
| `0xf` | Copy `word()+1` pixels from the line above, then 1 solid pixel of `n2` |
| `0x9` | `b=byte()`: if even, 1 solid pixel of `n2` then `b` literal nibbles; if odd, `b+1` literal nibbles |
| `0xd` | Same as `0x9` but count is a `word()` |
| `0xa` | Transparent run: `n2+1` pixels |
| `0xe` | Transparent run, extended: `n2<=0xc` → `n2+17`; `n2==0xd` → `byte()+1`; `n2==0xe` → `byte()+257`; else → `word()+1` |

**Verified**: every `Graphics.DAT` item classified as image-shaped (header
`width*height` in `[1, 40000]`) decodes with **0 residue** (RLE stream
consumes to exactly `width*height` pixels, no overrun/underrun) across
**683/683** items in both DM1's and CSB's `Graphics.DAT` (byte-identical
item counts and — spot-checked — several byte-identical item payloads,
consistent with CSB reusing DM1's asset base). Rendered as a greyscale atlas
(`public/assets/dungeonmaster/amiga/sprites/graphics-sample.png` and the
`chaosstrikesback` equivalent), the output is unmistakably real: "The End"
title text, a legible on-screen alphabet keyboard, champion portrait
thumbnails, brick/stone wall textures, staircases, torches, doors, food/water
status icons.

### `IMG3`/`IMG4` — 6-nibble local palette (confirmed: DM2)

Header: `u16 width`, `u16 height`, then **6 nibbles** (3 bytes) — a local
palette of 6 absolute colour indices, in most-used-first order. `IMG3` =
little-endian header (not needed here), `IMG4` = big-endian (DM2 Amiga).

Control grammar: one **control nibble** per run, `bit3` = single(0)/multi(1)
pixel, `bits2-0` = colour selector:

| `bits2-0` | Colour |
|---|---|
| `0`-`5` | `localPalette[sel]` |
| `6` | Copy from the line above (no local-palette entry) |
| `7` | Absolute colour: read one more nibble as the literal 0-15 index |

Run length (only when `bit3` set; otherwise implicitly 1):

- `n1 = nibble()`; if `n1 < 0xf`: count = `n1+2`.
- else `n2,n3 = nibble(),nibble()`; `v=n2*16+n3`; if `v<0xff`: count = `v+17`.
- else `n4..n7 = nibble()×4`; count = `n4*4096+n5*256+n6*16+n7`.

**Verified**: applied to DM2's `GRAPHICS.DAT` (`DMII` container, 4,630
items), of 2,263 items with a plausible image-shaped header, **2,237
(98.9%)** decode to ≥95%-filled pixel buffers with zero decode exceptions.
Rendered as a greyscale atlas
(`public/assets/dungeonmaster2/amiga/sprites/graphics-sample.png`), the
output is unmistakably real and includes **multi-language status-bar UI
text** baked into the bitmap art itself: `HEALTH/STAMINA/MANA` (English),
`GEZOND/KRAFT/MANA` (Dutch), `SANTE/VIGUEUR/MANA` (French),
`FOOD SPEISE PROVISIONS`, `POISONED VERGIFTET VENENEUX`,
`WATER WASSER EAU`, plus clearly-drawn weapons (axes, swords, spears,
daggers) and wall/floor texture swatches.

This directly supersedes an initial finding that DM2 Amiga's images use
`IMG1` (the DM1/CSB codec) — that decode produced visual garbage (flat
black rectangles, vertical-stripe noise). The primary "Data Files" doc's own
per-file item-type table (for the exact `DMII`/Amiga/`GRAPHICS.DAT` row)
lists almost the entire item population as `RAW1` ("not yet decoded"), which
was the tell that a different codec was needed; the fan-analysis secondary
source named it as `IMG4`.

**Open**: the remaining ~11% of image-shaped items that don't reach the
≥95%-filled threshold are (per the fan analysis) the "differential"/overlay
sub-format `IMG7`/`IMG8` — 5-nibble local palette, composited over a
separately-stored base image via a second colour-selector role
("Transparent color" = copy same position from a different, previously
decoded image). This compositing scheme is not implemented — the fan
source's own worked example hedges its colour-role assignment ("I tried and
decided... with my feeling"), so it needs independent verification before
being trusted as a decoder rather than left as a documented lead. See
`docs/dungeonmaster2/TODO.md`.

## Dungeon compression (`0x8104` signature)

`DUNGEON.DAT`/`DUNGEONF.DAT`/`DUNGEONG.DAT` may be stored compressed with a
fixed-table Huffman-style bit-packed scheme:

```
offset 0   u16 signature (0x8104)
offset 2   u32 uncompressedSize
offset 6   u16 dungeonId
offset 8   4 bytes  "most common" byte table
offset 12  16 bytes "less common" byte table
offset 28  compressed bitstream, MSB-first
```

Per output byte, read bits until a symbol resolves:

- `0` → next 2 bits index the 4-entry "most common" table.
- `10` → next 4 bits index the 16-entry "less common" table.
- `11` → next 8 bits are the literal byte value.

**Verified**: `decompressDungeon()` reproduces exactly the header-declared
`uncompressedSize` for every compressed dungeon file in the corpus (DM1
`Dungeon.DAT`, CSB `disk1/Dungeon.DAT`) with 0 deviation, and the resulting
buffer parses cleanly under the (independently verified — see below)
dungeon-file structure with no dangling/negative offsets.

## Dungeon file (`DUNGEON.DAT`)

```
offset 0   u16 ornamentSeed
offset 2   u16 mapDataSize        (bytes)
offset 4   u8  mapCount
offset 5   u8  padding (0)
offset 6   u16 textDataSizeWords
offset 8   u16 startPosition (bits: x[0:5) y[5:10) direction[10:12))
offset 10  u16 objectListSizeWords
offset 12  13× u16 section counts (doors, teleporters, texts, sensors,
                    creatures, weapons, armours, scrolls, potions,
                    containers, misc, [3 unused words], projectiles,
                    explosions)
offset 44  mapCount × 16-byte map definitions
...        (per-map object/door/teleporter/text/sensor/creature/item lists —
            documented in the source but not parsed by this reader)
...        Map Data (see below) — always the LAST content section, exactly
            mapDataSize bytes, per-map
...        optional 2-byte checksum (save-embedded dungeons always have one;
            standalone files: both are seen, detected structurally)
```

Each 16-byte map definition:

```
offset+0   u16 mapDataOffsetWords
offset+6   u8  offsetX
offset+7   u8  offsetY
offset+8   u16 sizeWord: height=[11:16)+1, width=[6:11)+1, level=[0:6)
offset+10  u16 graphicsWord: floorRandomCount[12:16) floorCount[8:12)
                             wallRandomCount[4:8) wallCount[0:4)
offset+12  u16 miscWord: difficulty[12:16) creatureTypesCount[4:8)
                         doorDecoCount[0:4)
offset+14  u16 doorWord: doorType1Index[12:16) doorType0Index[8:12)
                         mapGraphicsStyle[4:8) floorCeilingStyle[0:4)
```

Map Data, per map: a `width*height` byte grid, **column-major** (column 0
top-to-bottom, then column 1, ...), one byte per square:

```
bits[7:5) squareType (0=wall 1=floor 2=pit 3=stairs 4=door 5=teleporter
                       6=trickwall 7=empty [DM2-only])
bit[4]    hasObject
bits[3:0) type-dependent attribute nibble
```

immediately followed by 4 small per-map trailer arrays (each 1 byte per
entry, from the map definition's own counts): creature-type graphics
indices, wall-decoration graphics indices, floor-decoration graphics
indices, door-decoration graphics indices.

**Verified — locating Map Data without guessing every preceding section's
width**: rather than summing every list-section byte width (some, like
Projectiles/Explosions, have no fixed record size documented and can be
non-empty in save-embedded dungeons), the reader works backward from EOF
using the header's own `mapDataSize` field, since Map Data is always the
last content section. Cross-checked forward (summing every known
fixed-width section) for files where the community docs guarantee
Projectiles/Explosions are empty (every standalone `.DAT` in this corpus):
the forward-computed offset matches the backward-computed one **exactly**,
with 0 deviation, for DM1's 3 dungeon files and CSB's Prison dungeon.

**Verified — square-grid coherence**: rendered top-down (see
`renderMapTopDown`), every decoded map produces a visually coherent maze —
connected corridors, wall placement forming enclosed rooms, doors/stairs/
teleporters appearing as isolated markers at plausible positions, not
uniform noise — across all maps in DM1 (English/French/German dungeon
files, 14 maps each), CSB's Prison (2 maps) and main dungeon (11 maps,
located inside `disk2/MINI.DAT`, see below), and DM2 (44 maps, including the
DM2-only `empty` square type appearing as real observed data, and map 0's
declared `level=7` matching the community docs' own independently-stated
"Level 7 — Sun Clan / Hall of Champions").

### Locating CSB's dungeon inside a saved-game file

Chaos Strikes Back does not ship a standalone `Dungeon.DAT`-equivalent for
its own (non-Prison) 11-map dungeon on Amiga — per the "Saved Game Files"
docs, the full Dungeon Data section is embedded, uncompressed, inside every
save file. `findDungeonDataOffsets()` (`dungeonmaster-dungeon.ts`) locates
it by scanning for the header shape rather than trusting a hardcoded offset:

1. `ornamentSeed` (u16 at scan position) is a member of the small set of
   values documented/observed across this corpus (`{99,8,13,0,5,6}`).
2. `mapCount` (byte at +4) is one of the known real map counts for this
   family (`{2,11,14,44}`).
3. Padding byte (+5) is `0`.
4. `mapDataSize` (+2) is in a plausible byte range.
5. Map definition 0 (right after the 44-byte header) decodes to a
   plausible width (1-32), height (1-32), and level (≤63), and its own
   `mapDataOffsetWords*2` fits inside the declared `mapDataSize`.

An earlier, weaker version of this scan (checks 2-4 only) produced **97**
false-positive matches inside `disk2/MINI.DAT`'s encrypted/binary
saved-game payload. Adding checks 1 and 5 reduced this to **exactly 1**
match, at file offset **10098** — matching a hand-derived value found via
an independent manual scan during development. The extractor asserts
`offsets.length === 1` and throws otherwise, so this stays a verified
invariant rather than a silent best-guess.

## Palette — open

No Amiga IRGB/colour-register palette has been recovered from the
executable for any of the three games yet. All rendered `IMGx` output ships
as a 16-level greyscale ramp over the real decoded pixel *indices*
(`packGreyscaleAtlas`) — the indices themselves are confirmed real data, the
colours are a placeholder. The DM2 fan-analysis doc names several
scene-dependent palette tables (`Inventory`, per-graphics-style Dungeon
viewport palettes for styles 0-5, creature-specific colour swaps) as a lead
for a future pass but none have been located/verified in this corpus's own
executable yet.

## Music — `P41A` module packer (confirmed: DM2)

DM2's `music/*.MOD` (×10) are **not** standard ProTracker modules despite the
extension — all 10 real files carry the magic `P41A` ("The Player 4.1A"), a
proprietary Amiga module packer by Jarno Paananen ("Guru"/Sahara Surfers)
never publicly released standalone but licensed/leaked to game studios (a
common packed-module family in commercial Amiga games generally, not
specific to this engine). DM1/CSB were not checked for this format — their
music files were out of scope for this pass.

Decoder: `tools/shared/amiga-player4x.ts` — a faithful statement-by-statement
TypeScript port of libxmp's public reference unpacker
(`src/loaders/prowizard/p40.c`'s `depack_p4x()`,
`github.com/libxmp/libxmp`), covering `P40A`/`P40B`/`P41A` variants. Outputs
a byte-exact standard `M.K.`-tagged ProTracker `.mod`. See
`docs/dungeonmaster2/amiga/data-structure.md` for the full verification
evidence (all 10 files decode with 0 exceptions; RMS + lag-1 autocorrelation
confirms real, non-degenerate decoded audio).

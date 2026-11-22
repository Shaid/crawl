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

> **Correction (2026-11-18):** the "0 residue across 683/683" claim below was
> circular. The tests asserted `pixels.length === width*height`, but the
> decoder allocates exactly that many pixels up front, so the assertion could
> never fail; and the `w<=350 && h<=220 && w*h<=40000` classifier both
> admitted a non-image and dropped real images. Re-derived with an
> **exact-consumption** check (the run stream must end on the item's last
> nibble, `decodeImg1Checked`/`isImg1Image`): **687 real images** in both DM1's
> and CSB's `Graphics.DAT`. Item **672** (header reads "130x11", 132 B) is a
> length-prefixed data item (the run stream fills 1,430 px after 18 nibbles and
> leaves 238 unread), not an image. The filter wrongly excluded five
> full-screen images: items **1** (320x153) and **4, 5, 728, 738** (320x200);
> all five consume exactly. The old 683 = 682 real images + item 672, so the
> true count is 682 + 5 = 687. The DMCSB2 attribute words equal the item's first two
> words in 731/749 items (data items included), so they are a header copy, not
> an image/non-image oracle. Null control: the IMG4+trailer grammar tiles
> <5% of the 687. Old text kept below as the superseded claim.

**Superseded claim (circular):** every `Graphics.DAT` item classified as image-shaped (header
`width*height` in `[1, 40000]`) decodes with **0 residue** (RLE stream
consumes to exactly `width*height` pixels, no overrun/underrun) across
**683/683** items in both DM1's and CSB's `Graphics.DAT` (byte-identical
item counts and — spot-checked — several byte-identical item payloads,
consistent with CSB reusing DM1's asset base). DM1 vs CSB: 669/749 items
byte-identical, 80 differ (2-5, 11, 26, 42-47, 329-378, 504, 550, 588-650, ...). Rendered as a greyscale atlas
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

> **Correction (2026-11-18):** the "2,237 (98.9%) decode to >=95%-filled"
> metric measured nothing. The decoder loops until `pos >= width*height` and
> its nibble reader returns 0 past end-of-item, so nearly every item "fills"
> whether or not it parsed. Under the 6-nibble grammar as first shipped only
> 5/2,263 candidates consumed their item exactly, 415 overran it, and the rest
> left a dominant leftover of exactly 32-33 nibbles: a **fixed 16-byte
> trailer** (one pad nibble when the run stream ends on an odd nibble, plus 16
> bytes). Corrected grammar (`decodeImg4Checked`): `u16 w, u16 h,` a **6- or
> 5-nibble local palette**, the run stream, an optional pad nibble, a 16-byte
> trailer. Tiling the item exactly: **1,533** under the 6-nibble variant,
> **727** under the 5-nibble variant (all 727 use selector 5, which is not a
> palette slot there), **3** unexplained, of 2,263 plausible-header items
> (2,260 tile). Trailer bytes are values up to 0xFF (782 distinct trailers;
> common maxima 0xEF/0xFF/0xFD), so they cannot be nibbles. Hypothesis, not
> confirmed: a per-image 16-entry nibble-to-global-colour map, i.e. the real
> palette mechanism (the global palette is therefore not a 16-colour table).
> Caveat: **179 items parse exactly under both variants** (a one-nibble shift
> self-synchronises), so tiling alone does not decide 5 vs 6 for them; the
> decoder prefers 6, and no first-palette-nibble discriminator was found.
> Also ~751 "non-candidate" items tile as images once the top 6 bits of the
> width/height words are masked as flags (533 six-nibble, 218 five-nibble),
> so the dimension words carry flags and the earlier "~2,367 non-image
> items" is overstated.

**Superseded claim (vacuous metric):** applied to DM2's `GRAPHICS.DAT` (`DMII` container, 4,630
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

**Open** (reframed 2026-11-18: the *grammar* is solved, see the correction
above; what remains is the meaning of selector 5 / compositing and the 5-vs-6
variant flag): the 5-nibble items (727 + up to 179 ambiguous) are (per the fan analysis) the "differential"/overlay
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
...        per-column cumulative thing counts (sum of widths, u16 each)
...        object list (objectListSizeWords u16: first-thing-on-square list)
...        text data (textDataSizeWords u16)
...        16 thing-type lists, record sizes {4,6,4,8,16,4,4,4,4,8,4,0,0,0,8,4}
            (doors, teleporters, texts, sensors, creatures, weapons, armours,
            scrolls, potions, containers, misc, 3 unused, projectiles = 8,
            explosions = 4) — contents not parsed by this reader
...        Map Data (see below) — always the LAST content section, exactly
            mapDataSize bytes, per-map
...        optional 2-byte trailer = 16-bit big-endian sum of every preceding
            byte (present: DM1 EN, CSB Prison EN, DM2, MINI; absent: DM1 FR/DE,
            CSB Prison FR/DE)
```

> **Correction (2026-11-18):** (1) The per-map `mapDataOffset` field is a
> **byte** offset, not words (14/14 DM1, 2/2 CSB Prison, 44/44 DM2, 11/11
> MINI maps equal the cumulative byte cursor); the field was previously named
> `mapDataOffsetWords` and `findDungeonDataOffsets` multiplied it by 2.
> (2) Projectile/explosion record sizes are **8 and 4** bytes (the older text
> says "not documented"): MINI.DAT has 60 projectiles + 50 explosions and
> tiles exactly at those sizes; the same size table appears as data in DM1
> `KAOS.FTL`+5346, CSB `KAOS.FTL`+5448 and DM2 `SKUL.FTL`+3830 (`04 06 04 08
> 10 04 04 04 04 08 04 ...`). (3) The "optional checksum" is the byte-sum
> trailer above (4/4 exact: 0x2853 DM1 EN, 0x939F CSB Prison, 0x3D9F DM2,
> 0x7CC6 MINI), now verified by `parseDungeon().checksum`.

Each 16-byte map definition:

```
offset+0   u16 mapDataOffsetBytes   (BYTE offset into Map Data, not words; see correction)
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

**Verified — forward section tiling (2026-11-18, supersedes the
back-from-EOF placement)**: walking header -> map defs -> per-column counts ->
object list -> text -> 16 thing-type lists -> Map Data lands exactly on EOF
(or EOF-2 with the trailer) for DM1 EN/FR/DE, CSB Prison EN/FR/DE, DM2 and
the `MINI.DAT`-embedded dungeon (8/8), with the declared `mapDataSize` as an
independent cross-check. Earlier text said projectile/explosion sizes were
undocumented and so worked backward from EOF; that is now only a fallback.
CSB `disk1` also ships `DungeonF.DAT`/`DungeonG.DAT` (French/German Prison,
2 maps, dungeon id 12), both tiling exactly.

**Verified — column-count oracle (2026-11-18)**: the per-column cumulative
thing-count table matches the number of `hasObject` squares per column in the
column-major grid: DM1 412/412, CSB Prison 41/41, MINI 296/296, DM2 725/725
columns. Null control (reading the grid row-major): 40/412, 7/41, 26/296,
122/725. This confirms grid orientation, dimensions and the hasObject bit,
and replaces the visual argument below as the evidence.

**Visual corroboration (weak, kept for context)**: rendered top-down (see
`renderMapTopDown`), every decoded map produces a visually coherent maze —
connected corridors, wall placement forming enclosed rooms, doors/stairs/
teleporters appearing as isolated markers at plausible positions, not
uniform noise — across all maps in DM1 (English/French/German dungeon
files, 14 maps each), CSB's Prison (2 maps) and main dungeon (11 maps,
located inside `disk2/MINI.DAT`, see below), and DM2 (44 maps, including the
DM2-only `empty` square type appearing as real observed data, and map 0's
declared `level=7` matching the community docs' own independently-stated
"Level 7 — Sun Clan / Hall of Champions"; weak, since DM2 has several maps
per level — maps 2/3, 4/5 share levels — so a level number alone is not
corroboration). DM2 square type 7 covers 4,320/12,192 cells and type 2 only
576; whether DM1 type semantics carry over to DM2 is unverified.

### Locating CSB's dungeon inside a saved-game file

Chaos Strikes Back does not ship a standalone `Dungeon.DAT`-equivalent for
its own (non-Prison) 11-map dungeon on Amiga — per the "Saved Game Files"
docs, the full Dungeon Data section is embedded, uncompressed, inside every
save file. `findDungeonDataOffsets()` (`dungeonmaster-dungeon.ts`) locates
it without any hardcoded offset or seed list:

> **Correction (2026-11-18):** the earlier scan whitelisted ornament seeds
> `{99,8,13,0,5,6}` and map counts `{2,11,14,44}`. The seed whitelist already
> contained the answer's own seed (13), and the "independent manual scan" was
> not independent, so the "unique hit at 10098" evidence was circular (the
> answer was right). Replaced by a seed-agnostic scan: a candidate is accepted
> only if the header/map definitions are plausible, the forward section walk
> (`mapDataStart = front matter`; `mapDataSize` must equal the sum over maps
> of cells + creature/wall/floor/door-deco entry counts) ends inside the
> buffer, and the 2-byte trailer after Map Data equals the 16-bit sum of every
> byte from the candidate start. On the real `MINI.DAT` this finds a **unique**
> hit at **10098**, ending exactly at EOF (42,786), with a valid checksum
> (0x7CC6). Null control: flipping one byte inside the dungeon removes the hit.
> The older heuristic (97 false positives with a weaker version) is retired.

## Palette — dungeon view SOLVED (2026-11-21); others open

> **Correction (2026-11-21):** the `KAOS.FTL`+0x79A lead below is the real
> dungeon-view palette. The table is at +0xFBC / +0x79A (entry 0 is the
> preceding zero word); it is light level 0 of a six-level table in the
> module's data block (A5-0x36BA DM, A5-0x3A5C CSB; decoded by
> `tools/dungeonmaster/amiga/ftl.ts`); CSB `disk1/KAOS.FTL`+0x100A likewise. See
> `docs/dungeonmaster/amiga/data-structure.md` § "Viewport composition". Only
> the non-dungeon-view palettes remain open (`dm1-palette`).


> **2026-11-18 leads (hypothesis, not yet rendered/verified):** (a) DM1
> `KAOS.FTL` holds a run of 15-16 words at about +0x79A (`0666 0888 0620
> 00CC 0840 0080 00C0 0F00 0FA0 0C86 0FF0 0444 0AAA 000F 0FFF`), with a
> variant table at about +0x7BC (entries 12/13 differ); CSB `disk1/KAOS.FTL`
> has the same tables at about +0x100A. Plausibly the dungeon-view palette
> (the community "G0021"); the preceding word `0020` may be a separate
> field. Next step: re-render an atlas with it and compare against a public
> Amiga screenshot. (b) The Amiga `TITL.DAT`/`ENDA.DAT`/`ANIM.DAT`/`SWSH.DAT`
> files carry `PL` chunks holding 16-colour palettes as (index, r, g, b)
> nibbles (CSB TITL/ENDA, DM2 SWSH/ENDA). (c) DM2 `IMG4` items carry a
> per-image 16-byte trailer (see above). (d) DM2's `sample_palette.IFF` is a
> 320x200 4-plane ILBM with a 16-entry CMAP (`000000 707070 909090 703000
> ...`), provenance unknown (not a retail-style filename), and cannot be the
> DM2 global palette if image trailers index up to 255.

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


## FTL `AN`-chunk animation files (`TITL.DAT`, `ENDA.DAT`, `ANIM.DAT`, `SWSH.DAT`) — lead (2026-11-18)

These are **not** DMCSB containers. Every one starts with `AN` + `0140 00C8
0004` (320x200, 4 planes) and is a tagged-chunk stream. Tags seen: `AN`, `BR`,
`P8`, `PL`, `SD`, `SF`, `MF`, `EN`, `SO`. `PL` chunks hold 16-colour palettes
as (index, r, g, b) nibbles. Files: DM1 `TITL.DAT`, CSB `TITL.DAT` (identical
on disk1 and disk2), CSB `ENDA.DAT`, CSB `ANIM.DAT`, DM2 `TITL.DAT`/`ENDA.DAT`/
`SWSH.DAT`. The audit's quick walk did not resolve the chunk length semantics
and stopped early; **hypothesis-grade**. Tracked as `dm1-titl-dat`.

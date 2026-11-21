# Dungeon Master II: Skullkeep (Amiga) — data structure

FTL Games, 1995 (this corpus: the Amiga release). Source:
`data/dungeonmaster2/amiga/` (copied from `data/_unexplored_/DungeonMaster2/`).

Shared container/codec formats are documented once in
[`docs/dungeonmaster-format.md`](../../dungeonmaster-format.md) — this file
covers what's specific to DM2.

Shared code: `tools/shared/dungeonmaster-{container,codec,dungeon,render}.ts`.
Extractor: `tools/dungeonmaster2/amiga/export-data.ts`.

## Files

| File | Role | Status |
|---|---|---|
| `DUNGEON.DAT` | Dungeon (44 maps) | **confirmed**, decoded end-to-end |
| `GRAPHICS.DAT` | Wall/UI/item bitmaps, `DMII` container | **confirmed** (exact tiling, 2,260/2,263 plausible-header items) for the `IMG4` grammar incl. the 5-nibble variant and 16-byte trailer (see Correction in § `IMG4` confirmed); **open**: the meaning of selector 5 / the differential compositing, and the 5-vs-6 variant flag |
| `sample_palette.IFF` | A real ILBM (per the task brief) | not opened this pass — see TODO |
| `music/*.MOD` (×10) | **`P41A`-packed modules, not standard ProTracker** despite the `.MOD` extension | **confirmed and decoded** — see below |
| `save/*.DAT` | Saved games | not investigated |
| Other `.dat`/`.ftl` files (44 total in the corpus) | Executable/support data | not investigated — out of scope for this pass |

## `DUNGEON.DAT`

Uncompressed (no `0x8104` signature observed). Parses under the shared
dungeon-file reader unchanged — **44 maps**. This is the first corpus file
to exercise the DM2-only square type `empty` (type value 7): confirmed
present as real, non-degenerate observed data in the decoded grid (not
merely "in range" — visually distinct dark cells at plausible positions in
the rendered top-down diagrams, consistent with unused/void dungeon
regions). Map 0's decoded `level` field is `7`, matching the community
docs' own independently-stated in-game location for this dungeon's first
map ("Level 7 — Sun Clan / Hall of Champions") — a second, independent
piece of corroborating evidence for the header/map-definition byte layout
beyond the shared "coherent maze" visual check.

> **Correction (2026-11-18):** the "level 7" match is weak corroboration (DM2
> has several maps per level; maps 2/3, 4/5, ... share levels) and the
> "coherent maze" check is visual. The real evidence is structural: the
> forward section walk (header, 44 map defs, column counts, object list, text,
> 16 thing lists, Map Data) lands exactly on EOF-2; the 2-byte trailer is the
> 16-bit byte sum (0x3D9F, verified); the per-column thing-count table equals
> the `hasObject` squares of the column-major grid on 725/725 columns (row-major
> null control: 122/725); and all 44 per-map byte offsets equal the cumulative
> cursor. Square type 7 is 4,320 of 12,192 cells and type 2 only 576; whether
> DM1's type semantics carry over to DM2 is unverified. `sample_palette.IFF`
> is a 320x200 4-plane ILBM with a 16-entry CMAP (`000000 707070 909090
> 703000 ...`) of unknown provenance (not a retail-style filename); it cannot
> be the DM2 global palette if the image trailers index up to 255.

Exported: `public/assets/dungeonmaster2/amiga/data/dungeon.json` (full
header + all 44 map definitions + square grids), 44 top-down PNGs under
`public/assets/dungeonmaster2/amiga/screens/dm2-mapNN-lvlL.png`.

## `GRAPHICS.DAT`

`DMII` container (`0x8005` signature), **4,630 items**.

### The image codec is NOT `IMG1`

An initial pass decoded this file with the same `IMG1` codec used
successfully for DM1/CSB, since the container header and the general
"`IMGx` family, nibble RLE" shape looked identical. The result was visual
garbage — flat black rectangles and vertical-stripe noise, unlike DM1/CSB's
immediately-recognizable output. Cross-checking the community docs' own
per-file item-type breakdown table for exactly this file
(`GRAPHICS.DAT`, `DMII`, Amiga) confirmed why: **almost the entire item
population (~4,521 of 4,630) is documented as `RAW1`** — the docs' own
definition of `RAW1` is "items that are not yet decoded (unknown content)."
Only 107 items are `SND5`, 1 is `TXT2`, 1 is `FNT1`. In other words, the
primary community documentation itself does not claim `IMG1` (or any
decoded image format) applies to this file at all.

### `IMG4` confirmed instead

A secondary fan-analysis source ("Dungeon Master II Data Files Notes",
cited in the shared doc) names DM2's real image codec as the `IMG3`
(little-endian)/`IMG4` (big-endian) family: a 4bpp nibble-RLE stream with a
**6-nibble local palette** prefix and a different control-nibble grammar
than `IMG1` (see the shared doc for the full byte-level spec). Implemented
as `decodeImg4()` in `tools/shared/dungeonmaster-codec.ts` and applied to
this file directly:

- **2,263** items have a plausible image-shaped header (`width*height` in
  `[1,40000]`, both dimensions ≤350/220).
- ~~**2,237 (98.9%)** decode to ≥95%-filled pixel buffers with **zero** decode
  exceptions.~~ **Vacuous — see the Correction below.**
- Rendered as a greyscale atlas, the output is unmistakably real:
  **multi-language status-bar text baked directly into the bitmap art** —
  `HEALTH/STAMINA/MANA` (English), `GEZOND/KRAFT/MANA` (Dutch),
  `SANTE/VIGUEUR/MANA` (French), `FOOD SPEISE PROVISIONS`,
  `POISONED VERGIFTET VENENEUX`, `WATER WASSER EAU` — plus clearly-drawn
  weapon icons (axes, swords, spears, daggers, arrows) and wall/floor
  texture swatches recognizable from the DM1/CSB atlas's own style.

Exported: `public/assets/dungeonmaster2/amiga/sprites/graphics-sample.png`
(400-item sample of the 2,237 successfully-decoded items) + `.json`
sidecar.

> **Correction (2026-11-18, supersedes the 98.9% claim above and the 6-nibble-only
> grammar):** the "≥95% filled" gate measured nothing (the decoder loops to
> `w*h` and reads zeros past end-of-item). Exact-consumption check: only 5/2,263
> candidates consumed their item exactly under the 6-nibble grammar as shipped.
> The leftover was a constant 32-33 nibbles = a **16-byte trailer**. Real
> grammar: `u16 w, u16 h,` 6- or 5-nibble local palette, run stream, optional pad
> nibble, 16-byte trailer. Result (`decodeImg4Checked`, test
> `dungeonmaster2-amiga.test.ts`): **1,533** tile as 6-nibble, **727** as
> 5-nibble (all use selector 5), **3** unexplained (2,260/2,263). Null controls:
> pre-audit grammar (no trailer) <30 tile, IMG1 <100. 179 items tile under both
> variants (a one-nibble shift self-synchronises), so tiling does not fix 5 vs 6
> for those; no discriminator found in the first palette nibble. Trailer bytes
> reach 0xFF (782 distinct): hypothesis, a per-image 16-entry nibble->global
> colour map (the palette mechanism; `dm2-palette` is therefore not a 16-colour
> table). ~751 further "non-candidate" items tile as images when the top 6 bits
> of the width/height words are masked, so those words carry flags (533
> six-nibble, 218 five-nibble; `dm2-gfx-dimension-flags`). GRAPHICS.DAT item 0
> (80,380 B) begins `0x8001`, likely a nested index (`dm2-gfx-item0-index`).
> The atlas exporter now ships exact-tiling items without selector 5.

### Open: the differential/overlay sub-format

> **Correction (2026-11-21): solved.** The base image is named by the underlay table (GRAPHICS.DAT item 1), selector 5
> keeps the underlay pixel, and the 5-vs-6 flag is membership in that table (3,011/3,011 images tile). See
> "`IMG4` codec -- the open items are solved" under Viewport. The shared `decodeImg4Checked` still guesses the
> variant by tiling; `tools/dungeonmaster2/amiga/gdat.ts` `PictureBank` is the exact decoder.

> Reframed 2026-11-18: the grammar is solved (see Correction above). What is
> open is the meaning of selector 5 (compositing source) and the variant flag.

The remaining ~11% of image-shaped items (26/2,263 candidates fell below
the 95%-filled threshold, and an unknown further fraction of the corpus's
other 2,367 non-"plausible-header" items may also be this sub-format) are,
per the fan-analysis source, `IMG7`/`IMG8` — a **5-nibble** local-palette
variant used for images that are actually a composite of 2-3 separately-
stored source images (one worked example in the source: items #4537 +
#4539 + #4540 combine into a final #4540). This needs:

1. A second colour-selector role beyond `IMG4`'s "copy from the line
   above" — a "copy from the same position in a *different*, previously-
   decoded image" mechanism (cross-image compositing).
2. Correctly identifying which local-palette slot(s) carry this special
   role — the fan source's own worked example hedges this
   ("I tried and decided the colors with my feeling... I may need the
   correct expression").
3. A way to know, for a given item, which other item(s) it composites
   over — not obviously encoded in the item's own header bytes as read so
   far.

Not implemented this pass: the scheme is speculative even by its own
source's admission, and verifying it properly (byte-exact against known
composited output, not just "renders something plausible") would need
substantially more investigation than the time available. Left as an
explicitly open item — see `docs/dungeonmaster2/TODO.md`. The current
extractor simply skips these items (the `>=95% filled` gate) rather than
shipping a partially-garbage render.

## `music/*.MOD` — actually `P41A`-packed, not standard ProTracker

The task brief initially assumed these were plain, playable-as-is ProTracker
modules on the strength of the `.MOD` extension alone — **wrong**. Real bytes
show all 10 files start with the 4-byte magic `P41A` ("The Player 4.1A"), a
proprietary Amiga module packer by Jarno Paananen ("Guru"/Sahara Surfers)
never publicly released standalone but licensed/leaked to game studios. A
standard MOD player fed these files directly would not decode them
correctly (wrong sample-header layout, wrong pattern-data encoding).

Confirmed via a real, public reference decoder rather than derived from
scratch — libxmp's ProWizard loader collection ships a faithful `P40A`/
`P40B`/`P41A` unpacker (`src/loaders/prowizard/p40.c`'s `depack_p4x()`,
fetched from `github.com/libxmp/libxmp` 2026-09-02). Ported statement-by-
statement to TypeScript (preserving the reference's exact loop/branch
structure to avoid the `decompressor-port-loop-condition-iteration-shift.md`
pitfall) as `tools/shared/amiga-player4x.ts`:
`decodePlayer4x()`/`player4xToProtrackerMod()`/`convertPlayer4xToMod()`/
`isPlayer4x()`.

Verification, all 10 real files:

- All 10 are `P41A`-signed (0 false negatives against `isPlayer4x`).
- Every file decodes with **0 exceptions** to a well-formed module: song
  length and sample count both land in-range (`[1,127]` / `[1,31]`), and
  re-encoding to a standard `M.K.`-tagged ProTracker `.mod` produces a
  byte-exact total size matching the computed header+pattern+sample-data
  structure (`1084 + patternBytes + sampleBytes`), with the `M.K.` magic
  landing at the standard offset `0x438`.
- Decoded PCM is real, non-degenerate audio, not silence or decoder
  garbage: a quantitative RMS + lag-1 sample-autocorrelation check (this
  project's standard "real audio vs noise" oracle, see the agent method
  doc) found **29/30 samples with strong self-correlation** (`r1` in
  `[0.57, 0.99]`); the one exception has a non-degenerate amplitude range
  consistent with a percussive/noise instrument rather than a decode bug.
- Not verified by ear — no audio player available in this environment.

Exported: `public/assets/dungeonmaster2/amiga/audio/SK00.mod`..`SK09.mod`
— real, standard `M.K.`-tagged ProTracker files, playable in any generic
tracker/player.

Test coverage: `tools/shared/__tests__/amiga-player4x.test.ts` (a hand-built
minimal synthetic `P41A` fixture decoded and re-encoded byte-exact, plus
`describe.skipIf`-gated real-corpus checks reproducing the above).


## Walker findings (2026-11-21)

Walker: `tools/walker/games-dungeonmaster2.ts` (+ `tools/dungeonmaster2/amiga/{model,render,export-walker}.ts`,
`npm run dungeonmaster2:walker` -> `data/walker-maps.json`). Map, collision, doors and teleporter travel are real.
~~The first-person picture is a flat-colour placeholder raycast.~~ Since 2026-11-21 the view is composed from
GRAPHICS.DAT (floor, ceiling, walls, door panels) -- see "Viewport" below; the raycast is only a fallback.

### Square semantics (verified structurally; tests in `tools/walker/__tests__/games-dungeonmaster2.test.ts`)

| Claim | Evidence | Confidence |
|---|---|---|
| Door attr bit 3 = N-S passage axis | corridor continues along that axis on 53/53 doors, across it on 0/53 | **confirmed** (structural) |
| Door state = attr bits 0-2 (0 open, 4 closed) | 48 doors are 4, 5 are 0, no others | rendered/consistent with DM1, not proven |
| Type 7 `empty` is solid filler | 0 of ~13.8k floor-cell edges touch an `empty` cell (walls: 3,521) | **confirmed** (non-adjacency) |
| Levels connect through teleporters, not stairs | only 4 stairs squares in 44 maps vs 216 teleporter squares | **confirmed** (counts) |
| Teleporter record (thing type 1, 6 B): word1 bits 0-4 X, 5-9 Y, 10-11 rotation, 12 rot-type; word2 bits 8-15 target map | 216/216 destinations land on enterable cells of the target map; swapped X/Y control 53/216 | **confirmed** for X/Y/map; rotation + rot-type bit **hypothesis** |

Resolved by `resolveTeleporters` (`tools/shared/dungeonmaster-dungeon.ts`), same per-square thing-chain walk as `resolveDoors`.

### `GRAPHICS.DAT` item 0 is a resource catalogue (answers `dm2-gfx-item0-index`)

Item 0 (80,380 B) = `u16 0x8001, u16 10045 (records), u16 7 (fields)`, then 7 (name, width) byte pairs
`T1 I1 D1 S1 F1 G1 P2` (the ASCII letters `TIDSFGP` are visible in the header), then 10,045 x 8-byte records
`{T,I,D,S,F,G,P}` (20 + 10,045 x 8 = 80,380 exactly). `P` is the GRAPHICS.DAT item number (or a literal value for
`D` = 11/12/14 kinds). Observed structure (**hypothesis on field names, confirmed on the arithmetic**):

* `D=1` records point at `IMG4` images; `D=5` records point at a **non-image, ~3-40 byte item class** (first bytes
  0x8d-0xdf, last byte `0xf0|k` with `k = 15 - n` where `n` = count of the leading 0xa0-0xbf bytes, 7/7 checked;
  looks like per-distance wall/floor *shape* descriptors, undecoded); `D=2/11/12/14` are parameters/other.
* ~~`T=26` = **viewport scenes**~~ -- **wrong, see the Correction below.** `T=23` `I`=1-5 = 224-wide horizon strips
  (20/30/62/71 px high) matching `mapGraphicsStyle` 1-5 (outdoor layers). `T=15` = creature sprites (`I` = the ids in
  each map's `creatureGraphics`), `T=16-21` = 16x16 item icons, `T=7` = UI.

> **Correction (2026-11-21):** `T=26` is **not** the viewport. `D=5` items are **text**: byte `i` stores
> `(0xFF - ch - i) & 0xFF`, NUL-terminated (which is where the "last byte `0xf0|(15-n)`" pattern came from), and `F`
> is the language (16 English, 48 German, 64 French). `T=26` decodes to the disk/save dialog messages
> ("THAT'S NOT THE MASTER DISK!" / "DAS IST NICHT DIE MASTER-DISKETTE!" / ...), drawn over the 224x136 dialog
> backdrop. The viewport art is category **8** (wallsets), positioned by the rect table -- see "Viewport" below.
> Test: `tools/dungeonmaster2/amiga/__tests__/gdat.test.ts`.

## Viewport (2026-11-21)

Method: the routines were found and read in a relocated flat image of SKUL.FTL (Ghidra headless + radare2);
a public DM2 PC reimplementation was consulted only to know which routines to look for (no code or tables taken
from it). Every table the walker uses is read from the game's own files at the offsets cited.

Code: `tools/dungeonmaster2/amiga/{gdat,skul-ftl,export-viewport,viewport}.ts`; asset
`public/assets/dungeonmaster2/amiga/data/viewport.json` (`npx tsx tools/dungeonmaster2/amiga/export-viewport.ts`,
wired into `game-config.ts` `buildAssets`). Frames: `npx tsx tools/dungeonmaster2/amiga/render-walker-frames.ts`.

### Catalogue data types (`D`)

1 image, 2 sound, 4 rectangle table, 5 text, 7/8 raw (category 0 `D=8` = the underlay table), 9 IRGB palette,
11 word value, 12 image offset (`x<<8 | y`, signed bytes), 14 16-nibble remap string. Category numbers that matter
here: 1 interface (item 0: rect table `D=4`, palettes `D=9`), 8 wallsets (`I` = a map's `mapGraphicsStyle`), 9 wall
ornaments, 10 floor ornaments, 14 doors (`I` = a map's door type), 15 creatures, 16-21 items, 22 champions,
23 outdoor horizon strips, 26 dialog texts.

### `SKUL.FTL` (confirmed)

A Mac-style A5-world module: section `0x10` = jump-table header (above-A5 0x1460, below-A5 0x617e, 648 entries; the
JMP of entry k is at A5+0x22+8k), `0x11` = initialised data (`u16 1, u32 dataLen, u32 drelLen`; words copied, a zero
word is followed by a count of extra zero bytes; expands to exactly 0x617e; then 740 u16 A5 offsets of longs that
get A5 added -- all 740 targets hold valid A5-relative values), `0x12` = code. `parseSkulFtl` in `skul-ftl.ts`.
Function addresses below are CODE offsets.

| Routine | CODE offset | What it established |
|---|---|---|
| draw wall | `0x17e4a` | piece = cell+0x22 (0x32 for D4), rect = cell+0x2be (702), mirror for x>0, flipped squares use the partner cell's piece |
| tile loop | `0x18006` | 20-cell draw order at A5-0x4086; cell records 18 bytes, class word at +2 |
| floor / ceiling | `0x18bb0` | floor S=0 at rect 701, ceiling S=1 at rect 700, opaque, mirror from flip routine |
| flip parity | `0x187d0` | `(x + y + facing + mapdef[6] + mapdef[7] + (mapdef[9] & 0x3f)) & 1`; floor/ceiling variants by scene flags (wallset word S=101) |
| door tile / panel | `0x17c50` / `0x178d8` | door-visible bytes at A5-0x4164, panel rect words at A5-0x4184, panel image = door type `S = distance-1`, colour key word S=4 (10 if 0) |
| map load | `0x20576` | the two door types (A5-0x5162) = map-def byte 14 low / high nibble (gated by map-def byte 3 bit 7 / byte 2 bit 0, else 0xff), i.e. the parser's `doorType0Index`/`doorType1Index`; the door record's bit 0 picks one |

Cell tables (A5 offsets, read by `readViewportTables`): lateral distance -0x462a, forward distance -0x4612, flip
partner -0x45fa, ornament class -0x409e. Cells: 0 party square, 1/2 D0 left/right, 3 D1, 4/5 D1 sides, 6-10 D2,
11-15 D3, 16-20 D4 (21/22 unused by the walls).

### Rectangle table (category 1, item 0, `D=4` = GRAPHICS.DAT item 243) -- confirmed (tiles exactly)

`u16 0xfc0d, u16 30` id ranges `(first,last)`, then one `{u16 kind, u16 parent, i16 a, i16 b}` per id: 2,183 records,
17,588 bytes exactly. Kind 9 = a size box `a x b`; kind 0-8 = anchor code (0 centre, 1 TL, 2 TR, 3 BR, 4 BL, 5 top,
6 right, 7 bottom, 8 left) at `(a,b)` in the parent frame; kind 10-18 = anchor `kind-10` placed on the same anchor of
the parent box, offset `(a,b)`. Rect 3 = the 224x136 viewport, 700 ceiling, 701 floor, 702-722 the wall cells,
3700-3810 door panels. Image offsets (header top bits, `D=12` entries, the set-wide `D=12 S=0xFE`) are added to the
anchor point; mirroring negates the x offset.

### `IMG4` codec -- the open items are solved (confirmed)

* **5- vs 6-nibble palette:** an image is an *overlay* (5-nibble palette; selector 5 = keep the underlay pixel) exactly
  when it appears in the **underlay table**, category 0 `D=8` = GRAPHICS.DAT item 1: 1,010 sorted `(overlay, underlay)`
  u16 pairs; underlays can chain. With that rule **3,011/3,011** catalogued images tile their item exactly (stream +
  0-1 pad nibble + 16-byte trailer). Null control: only 65/1,010 overlays tile as 6-nibble images.
* **Width/height top 6 bits** are signed draw offsets (x, y); x = -32 means "offset is in the `D=12` entry for this
  picture" (155 images).
* **Palette:** on the Amiga the colour nibbles index a **16-entry IRGB palette** directly: `D=9` items are 4-byte
  `(index, r, g, b)` entries, 64 bytes per bank (wallsets have 6 banks: light levels, bank 0 = full light; the title
  screens have one each). The 16-byte image trailer is a 16->256 colour map for the PC build and is not used here.
  Evidence: the 320x200 title/credits image (item 207) renders correctly with palette item 214, and all six wallsets
  render coherent scenes with their bank 0. **Rendered**, not traced to the Amiga palette-load code.

### Square classes (the subset drawn)

Wall (type 0, or trickwall with attr bit 2 clear, or outside the map) -> wall piece. Door square: if
`(attr bit 3) == (facing & 1)` it is seen along the wall (frame only, not drawn yet), otherwise its door panel is
drawn when closed (state != 0). Everything else draws nothing over the floor/ceiling for now.

## TODO

See `docs/dungeonmaster2/TODO.md`.

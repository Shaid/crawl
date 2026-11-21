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
`npm run dungeonmaster2:walker` -> `data/walker-maps.json`). Map, collision, doors and teleporter travel are real;
the first-person picture is a **flat-colour placeholder raycast** (no DM2 art).

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
* `T=26` = **viewport scenes**: per `I` (scene id, 0-135) one `D=1,S=0` full 224x136 backdrop image plus `D=5` shapes
  keyed by `S` (0, 1, 20-41, 60-62) x `F` in {16, 48, 64} (three view distances) -- the DM2 equivalent of DM1's
  Graphics.DAT item-696 zone layout. `T=23` `I`=1-5 = 224-wide horizon strips (20/30/62/71 px high) matching
  `mapGraphicsStyle` 1-5 (outdoor layers). `T=15` = creature sprites (`I` = the ids in each map's `creatureGraphics`),
  `T=16-21` = 16x16 item icons, `T=7` = UI.
* What is **not** known: how a map picks its `T=26` scene id, the `D=5` shape codec, the palette. See TODO
  `dm2-viewport-scenes`.

## TODO

See `docs/dungeonmaster2/TODO.md`.

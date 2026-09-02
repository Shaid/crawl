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
| `GRAPHICS.DAT` | Wall/UI/item bitmaps, `DMII` container | **confirmed** for the `IMG4` "full"/base sub-format (98.9% of image-shaped items); **open** for the `IMG8` differential/overlay sub-format (~11%) |
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
- **2,237 (98.9%)** decode to ≥95%-filled pixel buffers with **zero** decode
  exceptions.
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

### Open: the differential/overlay sub-format

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

## TODO

See `docs/dungeonmaster2/TODO.md`.

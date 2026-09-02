# Elvira II: The Jaws of Cerberus (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1991. AGOS-family engine (ScummVM `GType_ELVIRA2`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first, including §0's correction of the
prior triage pass's "different header" hypothesis). Implementation:
`tools/shared/agos-vga.ts` + `tools/shared/agos-vga-export.ts` (`.pkd`),
`tools/shared/ilbm.ts` (`Pics/`). Extractor:
`tools/elvira2/amiga/export-data.ts`. Open items: `docs/elvira2/TODO.md`.

Raw data: `data/elvira2/amiga/data/` (200 `.pkd` files, zones 0-99),
`data/elvira2/amiga/Pics/` (4 plain IFF `ILBM` files), plus `Docs`,
`ReadMe` (out of scope) and `Elvira2.slave` (WHDLoad slave).

## 1. `.pkd` zones — CONFIRMED, same container/codec as Elvira 1

100 zones, ids 0-99 fully contiguous — a cleaner numbering than Elvira 1's.
All 100 have both a type-1 and type-2 file; 93 decode with at least one
real picture (7 zones' `vga2` tables are empty).

2,303 images decoded corpus-wide. Sizes range from small UI icons up to
full scene pictures; the largest sampled screen (zone 78) is a 224x127
picture. **`colorDepth = 4` throughout, palette scale confirmed identical
to Elvira 1** (`docs/agos-pkd-format.md` §2) — no Elvira-2-specific
palette-load code path was needed for a static per-picture render (the
VC-opcode multi-slot compositing scheme in `vga_e2.cpp`'s `setPaletteSlot`
is real but not required to recover a coherent single image).

**Visual verification** (`public/assets/elvira2/amiga/screens/`):
- `zone021_img1.png` — a snarling blue-furred werewolf/creature close-up.
- `zone078_img36.png` — a fiery, organic (heart/hellscape-looking) scene.
- `zone005_img1.png`, `zone006_img1.png`, `zone031_img1.png` — additional
  coherent scene renders among the 40 screen samples.

## 2. `Pics/` — plain IFF `ILBM`, CONFIRMED byte-exact

4 files, no `.pkd` wrapping at all (the probe recon's "plain ILBMs hiding
in odd places" finding, confirmed and decoded this pass):
`SpiderCavesLevelA`-`D`. Each is a standard EA IFF-85 `FORM ILBM`: `BMHD`
(640x400, 4 planes = 16 colours, ByteRun1 compression), `CMAP` (16 x RGB),
`BODY` (row-interleaved planar, ByteRun1-compressed). Decoded with
`tools/shared/ilbm.ts` (new this pass — generic EA IFF-85 BMHD/CMAP/BODY
reader composed from `@seer-project/iff`'s chunk walker + `decodeByteRun1`,
and this repo's own `decodePlanarRowInterleaved`).

**Byte-exact verification**: the rendered picture is a fully legible
dungeon-level cheat-map — readable room labels ("Spider Caves Level 'A'"),
a legend ("Down to level below" / "Up to next level" / "Poison mushroom" /
"Room 1-5"), room numbering (I-V), and even the "SKID ROW" release-group
credit baked into the original scanned map graphic — every character
crisp with zero garbling. See
`public/assets/elvira2/amiga/screens/pics-SpiderCavesLevelA.png` (and
`-B`/`-C`/`-D`).

These are almost certainly manual/cluebook-style player reference maps
for the "Spider Caves" dungeon level, not in-engine room backgrounds
(640x400 is far larger than any `.pkd` picture in the corpus, and the
content is diagrammatic, not a rendered scene).

## 3. Output

```
public/assets/elvira2/amiga/
  textures/zoneNNN.png + .json    -- pkd zone atlases (as Elvira 1)
  screens/zoneNNN_imgI.png        -- 40 largest-picture samples
  screens/pics-<Name>.png         -- the 4 Pics/ ILBM level maps
  palettes/zoneNNN.json
  data/zones.json
```

## 4. Still open

See `docs/agos-pkd-format.md` §4 for the shared open items (`.out`/sound,
`vga1` non-palette content, palette multi-slot compositing). Elvira 2's
`data/` directory also has only a single `013.OUT` (vs. Elvira 1's ~19) —
plus several files entirely unexamined this pass: `0tune`-`9tune` (music,
same un-probed family as Elvira 1's `*tune`), `ICON.DAT`, `menus.dat`,
`tables01`/`03`/`04`, `gameamiga` (likely the AmigaOS executable),
`runit`/`start` (likely launch scripts), `stripped.txt`. `Docs/` directory
content also unexamined.

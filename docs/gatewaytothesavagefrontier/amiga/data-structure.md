# Gateway to the Savage Frontier (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1991. Fourth sibling GLIB-format title
staged in this repo (alongside Curse of the Azure Bonds, Secret of the
Silver Blades, Pools of Darkness, and — same pass — The Dark Queen of Krynn
and Treasures of the Savage Frontier). Real title confirmed from the WHDLoad
rip's own `ReadMe`/`.info` files: "Gateway to the Savage Frontier".

Container format: **`docs/goldbox-glib-format.md`** (shared by every GLIB
title — read that doc first; this page covers only what's specific to this
title). Implementation: `tools/shared/goldbox-glib.ts` (container),
`tools/shared/goldbox-walltiles.ts` (wall geometry + tile decode),
`tools/shared/goldbox-geo.ts` (GEO), `tools/shared/goldbox-ecl.ts` (ECL
bytecode VM). Extractor:
`tools/gatewaytothesavagefrontier/amiga/export-data.ts`. Session history and
open items: `docs/gatewaytothesavagefrontier/TODO.md`.

Raw data: `data/ssi/GatewayToSavageFrontier/data/DiskA`, `.../DiskB`,
`.../DiskC` (a WHDLoad-staged install; `.Slave`/`.info` files and
`Docs/`/`Journal`/`ReadMe`/`Solution` content are out of scope per this
pass's task).

---

## 1. Container — CONFIRMED, 27/27 real GLIB files, no top-level compression

All 27 `.GLB`/`.TLB` files across the 3 disks parse as the standard GLIB
container (`docs/goldbox-glib-format.md` §1-§2) with zero deviation
(`container-directory.json`'s `structurallyOk: 27`, `0 top-level-compressed`,
`0 truncated`). This title needed no adaptation at the container level at
all — the format transfers completely unchanged from Curse/Secret/Pools.

## 2. `WALLDEF.GLB` and 8x8 tile bank — CONFIRMED, byte-for-byte identical scheme

`DiskC/WallDef.glb` — the same 156-byte wall-slice/10-view geometry as every
sibling title, confirmed via the exact-multiple-of-156 byte-length check
(`walldef-geometry.json`: 19 real entries, `allMultipleOf156: true`).

Tile banks: `DiskA/Walls.tlb` supplies the "flat universal+specific" scheme
(scheme 1) and also, paired with `DiskC/Walls.tlb`'s per-wall-id nested
buckets, the compression-aware scheme-2 lookup (same `decodeGlibTileBucket`
+ `buildWallSpecificTileBank` machinery `curseoftheazurebonds`'s own §3
established) — both wired via the same `tilesPath`/`specificTilesPath`/
`universalTilesPath` triple every sibling extractor uses.

**Rendered output**: 95 scheme-1 PNGs (0 skipped — every WALLDEF tile index
falls inside the flat bank) and 65 scheme-2 PNGs (30 skipped — those 30
WALLDEF entries have no matching scheme-2 bucket in `DiskC/Walls.tlb`, the
same "not every wall id has a per-id bucket" shape already seen on other
titles, not a decode error). Visually inspected (4x nearest-neighbor
upscale) several scheme-2 renders — `walldef2-12-wall0-view6.png` shows a
clear, structured repeating grid with sconce/torch-like features;
`walldef2-15-wall1-view6.png` shows a distinct vertical-bar/portcullis
pattern; `walldef2-12-wall3-view6.png` shows an arched-column motif — all
non-degenerate and consistent with the established Gold Box wall-art visual
grammar from the sibling titles.

## 3. `GEO.GLB` — CONFIRMED, standard fixed 1024-byte/16x16 shape, 30/30 levels

`DiskC/Geo.glb` decodes with the standard fixed-size decoder unchanged (no
variable-size adaptation needed, unlike The Dark Queen of Krynn) — 30/30
levels, zero deviation.

## 4. `ECL.GLB` wallset-slot binding — CONFIRMED, v1.1 opcode table UNCHANGED

`DiskC/ECL.glb` uses the **v1.1 opcode table (`OPCODE_TABLE`) with no
adaptation at all** — the same table Curse/Secret/Pool of Radiance use, at
the standard `base=0x8000`. A corpus-wide reachability walk (worklist-based,
following `GOTO`/`GOSUB`/`ON GOTO`/`ON GOSUB`/`NEWECL` targets) produced
**0 unknown opcodes and 0 desyncs** across every visited instruction.

**Result: 22/30 levels resolved, 64 slots total.** Every level that resolves
at all resolves all 3 slots (the same pattern established on every sibling
title). The remaining 8 levels have no reachable static wallset-load hit and
no successful `NEWECL` chase target — the same "genuinely script-less"
outcome Pool of Radiance's levels 30/31/32 already established as real, not
an error.

**Verified resolved-cell example** (level 3, `wallsetBinding = {slot1: 12,
slot2: 15, slot3: 5}`): cell `(2,0)` facing North has wall type `1` ->
`(slot 0, slice 0)` -> `slot1` = flat id `12` -> WALLDEF id `12`, wallset
index `0` -> `walldef2-12-wall0-view6.png` — the same non-degenerate,
structured render inspected in §2.

## 5. Extractor and outputs

Run from the repo root:

```
npx tsx tools/gatewaytothesavagefrontier/amiga/export-data.ts
```

(defaults to `data/ssi/GatewayToSavageFrontier/data`). Writes to
`public/assets/gatewaytothesavagefrontier/amiga/`:

- `data/container-directory.json` — 27/27 GLIB files OK, 0
  top-level-compressed, 0 truncated.
- `data/walldef-geometry.json` — 19/19 entries confirmed multiples of 156.
- `textures/walldef-<id>-wall<n>-view6.png` — 95 scheme-1 renders.
- `textures/walldef2-<id>-wall<n>-view6.png` — 65 scheme-2 renders (30
  entries skipped, no scheme-2 bucket).
- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 30 decoded GEO levels + wallset-binding data
  for 22 of them, consumed by the walker.

## 6. Full file catalog — not attempted this pass

Per this task's scope, the remaining `.GLB`/`.TLB` files' semantic content
(items, monsters, sprites, portraits, dungeon commands, strings, sounds) is
NOT catalogued — only the outer GLIB container structure is validated (§1).
See `docs/gatewaytothesavagefrontier/TODO.md`.

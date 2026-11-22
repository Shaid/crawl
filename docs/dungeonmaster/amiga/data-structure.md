# Dungeon Master (Amiga) — data structure

FTL Games, 1987 (this corpus: the Amiga release). Source data:
`data/dungeonmaster/amiga/` (copied from `data/_unexplored_/DungeonMaster/`).

Shared container/codec formats (data-file container, `IMGx` pixel codec,
dungeon compression, dungeon-file layout) are documented once in
[`docs/dungeonmaster-format.md`](../../dungeonmaster-format.md) — this file
only covers what's specific to this game's files.

Shared code: `tools/shared/dungeonmaster-{container,codec,dungeon,render}.ts`.
Extractor: `tools/dungeonmaster/amiga/export-data.ts`.

## Files

| File | Role | Status |
|---|---|---|
| `Dungeon.DAT` / `DungeonF.DAT` / `DungeonG.DAT` | English/French/German dungeon (14 maps each) | **confirmed**, decoded end-to-end |
| `Graphics.DAT` | Wall/UI/item bitmaps, `DMCSB1` container + `IMG1` codec | **confirmed** by exact stream consumption: 687 image items (not 683; see Correction in § `Graphics.DAT`) |
| `TITL.DAT` | Title screen | not decoded. **Correction (2026-11-18):** not a DMCSB container; an `AN`-chunk tagged stream (`AN 0140 00C8 0004`, tags `BR`/`P8`/`PL`/`SD`/...; `PL` = 16-colour palette). See `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" |
| `ANIM.FTL`, `APPA.FTL`, `APPB.FTL`, `CNFG.FTL`, `GRF1.FTL`, `KAOS.FTL`, `MEM1.FTL`, `SWSH.FTL`, `USIO.FTL`, `VDEO.FTL` | Executable overlay/code segments (`.FTL` = FTL's own loader convention, not a data container) | not investigated — code, out of scope for this pass |
| `BJELoad_R` | Boot loader | not investigated |
| `save/` | Saved games | not investigated (see the shared doc's "Saved Game Files" citation, used for CSB instead since DM1 didn't need it) |

## Dungeon files

All three (`Dungeon.DAT`/`DungeonF.DAT`/`DungeonG.DAT`) are stored
**compressed** (`0x8104` signature — see the shared doc). Each decompresses
to exactly its header-declared `uncompressedSize` with 0 deviation, and
parses to **14 maps** each under the shared dungeon-file reader.

Exported: `public/assets/dungeonmaster/amiga/data/dungeon-{en,fr,ge}.json`
(full header + per-map definitions + square-type grid), plus one top-down
PNG per map per language variant under
`public/assets/dungeonmaster/amiga/screens/{en,fr,ge}-mapNN-lvlL.png`
(42 PNGs total). **Rendered**: every map is a visually coherent maze
(connected corridors, enclosed rooms, isolated door/stair/teleporter
markers) — see the shared doc's verification section.

The English/French/German files are independent dungeon-data copies (same
maps, localisation lives in the separate text-list section this reader
doesn't parse) — not byte-identical, but structurally identical (same
`mapCount=14`, same per-map dimensions/levels observed while spot-checking).

## `Graphics.DAT`

`DMCSB2` container (`0x8001` signature — the same container variant used by
CSB's `disk1/Graphics.DAT`, not the signature-less `DMCSB1` shape an earlier
pass of this doc incorrectly assumed by community-docs analogy rather than
real bytes), **749** total items, of which **683** are image-shaped
candidates (header `width*height` in `[1,40000]`). Exported as a greyscale-ramp atlas (real pixel
*indices*, palette not yet recovered — see the shared doc):
`public/assets/dungeonmaster/amiga/sprites/graphics-sample.png` +
`.json` sidecar (400-item sample of the 683; every item decodes cleanly per
the extractor's self-check, the cap is only to keep the shipped PNG a
reasonable size).

> **Correction (2026-11-18):** the "683 image items, 0 residue" statement was
> circular (the test asserted `pixels.length === w*h`, true by construction)
> and the size-filter classifier was wrong in both directions. By exact stream
> consumption there are **687** images: item 672 (header "130x11") is a
> length-prefixed data item and is excluded; five full screens (items 1, 4, 5,
> 728, 738; 320x153/320x200) were dropped by the `w<=350, h<=220` filter and
> are now included. Items 671-693 (and ~60 items 671-748) are length-prefixed
> non-image data (several with PCM-like lag-1 correlation: items 675, 687, 711,
> r1 0.90-0.96; item 694 starts "COMPAS"); sound may live there, contrary to
> `dm1-music-sfx`'s "no sample files evident" (tracked as
> `dm-graphics-nonimage-items`). See `docs/dungeonmaster-format.md`. The
> shipped atlas now uses `isImg1Image`.

**Rendered, unmistakably real content** (visually confirmed): "The End"
title text, a legible on-screen alphabet keyboard/name-entry UI, champion
portrait thumbnails (a row of distinct character faces), health/food/water
status icons with "FOOD WATER POISONED" text, brick and stone wall textures,
staircases, wooden doors, torches, weapon icons, and a compass/direction
indicator.

## Viewport composition (walker, 2026-11-21; rewritten 2026-11-22)

> **Provenance (2026-11-22):** the walker's compositor, map model and palette
> table were rewritten as original code from the game's own `KAOS.FTL`
> (DM Amiga), replacing the 2026-11-21 port of ScummVM `engines/dm`
> (`gfx.cpp` getCoord / draw order / mirror parity, the stairs-exit rule and
> the G0021 palette table). Nothing from ScummVM, CSBwin or ReDMCSB is used;
> the old walker's frames served only as a behaviour oracle (see
> "Parity with the 2026-11-21 walker" below). Offsets are "K+0x....": into the
> decompressed `KAOS.FTL` code block, and "A5-0x....": the game's own address
> into the module's initialised-data block.

> **Correction (2026-11-21):** `Graphics.DAT` here is **DOS-numbered**, not
> the ST numbering. Evidence: item dims match (floor 78 = 224x97, ceiling
> 79 = 224x39, which sum to the 136-row viewport; wall set 86-107; stairs
> 108-125; door sets 246-257 = 44x38 / 64x61 / 96x88 per set; pits 50-69).
> The game's own loaders confirm the numbering: wall set `86 + 40*set`
> (K+0x12862), floor/ceiling `78 + 2*set` (K+0x1277E), stairs `108 + 40*set`
> (K+0x12AF8), door sets `246 + 3*set` (K+0x12D3A). **confirmed**.

* **`KAOS.FTL` module format** (`tools/dungeonmaster/amiga/ftl.ts`), from the
  loader `BJELoad_R` (hunk executable, CODE+0x34C): 20-byte header (`0x6160`,
  entry count at +18), 12-byte chunk entries `{tag, 1, offset, size}`; tag
  `0x10` = 40-byte module header + export table, `0x11` = initialised data
  (zero-run packed, CODE+0x75A), `0x12` = code. The code is packed with a
  nibble-dictionary scheme (magic `0x5223`, 0x780-word dictionary, implemented
  in `APPA.FTL` code +0x22A). **confirmed**: the decoded code's byte-sum equals
  the module header's own check word (DM 0x4E23, CSB 0x413A; the loader tests
  it at CODE+0x840); a one-bit corruption breaks it (test null control).
* **Item 696 = zone layout** (`0xFC0D`, ranges, 8-byte `{type,parent,d1,d2}`
  records; parsed like K+0x11AEC): 23 ranges, 1,135 records, 9,176/9,176
  bytes. Resolved by the game's K+0x1142E (`resolveZone`): anchor codes 0-8
  (centre/corners/edge midpoints), types 10-18 = anchored inside a parent box,
  type-9 parents clip, type-1 parents offset. Zones 700-749 viewport, 800-833
  stairs, 850-872 pits, 3700-3809 doors. **confirmed** (same output as the
  old resolver for all 1,135 zones x 14 sizes, 15,890/15,890).
* **Draw order** K+0x16846: floor/ceiling, then (after four object-only D4
  calls) D3L2, D3R2, D3L, D3R, D3C, D2L2, D2R2, D2L, D2R, D2C, D1L, D1R, D1C,
  D0L, D0R, D0C (K+0x151F2 ... K+0x166CE). Each routine switches on the
  element from K+0x6784 (wall 0, corridor 1, open pit 2, teleporter field 5,
  door side 16 / front 17, stairs side 18 / front 19).
* **Mirroring**: parity `(x+y+dir)&1` (K+0x16896) picks which of ceiling /
  floor is drawn mirrored (K+0x136B0) vs opaque (K+0x13638). With option flag
  `W` (A5-0x3F8B, set from the option byte list parsed at K+0x22D3E) the odd
  parity also swaps in 15 mirrored wall handles (K+0x168C2; built at
  K+0x129EE as the mirror of each wall's left/right partner, restored at
  K+0x16C4E). The walker turns `W` on. **rendered** (`build/cache/.../walker-frames`).
* **Bitmap handles**: handles at A5-0x173E..-0x16E4 map to items (init
  K+0x22480 + the set loaders); negative handles index the 14-byte
  sub-rectangle table at A5-0x1B6E `{type, -, x, y, w, h, ptr}` (getter
  K+0x112C8): stairs slots -33..-36 (x 50/6/62/6, w 7), door-frame slots
  -37/-38 (item 90, x 7/6, w 4), -45/-47 (item 92, x 16, w 60), -48/-50
  (item 91, x 16, w 32). Transparent key = colour 10 (literal pushed at
  K+0x13600).
* **Doors** K+0x13EEC: state 0 not drawn; 4 (closed) and 5 (destroyed; the
  mask K+0x13D9E is not drawn) at the zone; vertical doors (record bit 5) at
  zone+state; horizontal: right half at zone+6+state (source x + w/2),
  left half at zone+3+state (K+0x13938 with the `0x4000` half-width flag).
  Door types with flag bit 2 (A5-0x2494) get a random flip per frame in the
  game (K+0x13F50); the walker never flips (gap).
* **Ceiling pits** K+0x14046: an open pit on the level above at the same
  absolute square (map lookup K+0x5BA4) draws items 64-69.
* Map model (`model.ts`): faces derived from the game's party-step test
  (K+0x1CDF6): walls, out-of-map squares (K+0x5A44 reads them as wall) and
  solid fake walls block; a fake wall is passable when open (bit 2) or
  imaginary (bit 0, K+0x1CF36); doors pass in states 0, 1 and 5; stepping
  onto stairs (or backward off them) takes them (K+0x1CCFC): same absolute
  square one level up/down, landing **on** the stairs, facing per K+0x5C6A
  (E-W stairs face east unless the east neighbour is wall/stairs, N-S stairs
  north likewise); open non-imaginary pits drop the party, chained up to 100
  levels (K+0x18FA8). The `SIDE` face (no entering a door/stairs square from
  its flank) is a walker policy, not a game rule; no shipped map exercises it.
* **Palette (dungeon view)** — **confirmed**: six 16-word light-level tables
  in `KAOS.FTL`'s data block, DM at A5-0x36BA (selected `light*32` at
  K+0x13466), CSB at A5-0x3A5C (K+0x1599A of CSB's code); the two games'
  tables are identical. Level 0 is `0000 0666 0888 0620 00CC 0840 0080 00C0
  0F00 0FA0 0C86 0FF0 0444 0AAA 000F 0FFF`, also stored verbatim in the packed
  file at +0xFBC (DM) / +0x100A (CSB). All six levels are now game-derived
  (previously levels 1-5 were prior art); they reproduce the old shipped table
  exactly. Credits palette also located at `KAOS.FTL`+0xF54.
* CSB: items 49-125, 246-257 and 696 are byte-identical to DM's.
* Not drawn: see `dm1-walker-ornaments`; also item 49 (the D3L2/D3R2 pit,
  K+0x152B4) is not shipped, so those two squares show no pit.

### Parity with the 2026-11-21 walker (2026-11-22)

Sweep: every non-wall cell (walls on a 1/7 sample) x 4 facings x 7 door
variants (as authored, and all doors forced to each state 0-5), DM 14 maps
(194,880 frames) + CSB 13 maps (148,820), plus a party step and a side step
from every cell/facing/variant. The new code does not match the old frames
pixel for pixel, and every difference traced so far is a place where the
old ScummVM-derived compositor differs from the Amiga code; they are kept
on the game side:

| Old behaviour | Game (new) | Evidence |
|---|---|---|
| D0L / D0R walls (33 px) cropped to 31 columns | full 33 columns, overlapping D1 by one | K+0x135C0 passes the bitmap width (header word -4) to K+0x1142E |
| D3L2 always item 104, D3R2 always mirror(104) | D3R2 = item 103; both swap to their partner's mirror on odd parity | handles A5-0x1726/-0x1724, swap K+0x168C2, mirrors K+0x12A72/K+0x12A7E |
| D1/D2 side door-frame tops show the near end of items 91/92 | source x 16 (slots -45..-50) | A5-0x1B6E table, srcX = slot x + clip (K+0x13600) |
| D3 side door frames drawn whole (16 px) | 4-px slices x 7 / x 6 | slots -37/-38 |
| runtime-mirrored odd-width bitmaps / mirrored pits 1 px off | exact mirror (`16-(w&15)` pad skip) | K+0x136B0, K+0x139A4 |
| no D3L2/D3R2 doors or stairs | drawn (zones 3700/3710, 800/801/813/814) | K+0x151F2, K+0x1533E |
| partial horizontal doors: each half one column off | half-width resolve, source x + w/2 for the right half | K+0x13FC4..K+0x14038 |

Frames identical to the old walker: DM 62,007 / 194,880, CSB 43,557 /
148,820. With the first four rows of the table re-applied as scratch-only
compatibility switches (never committed): DM 190,559 / 194,880 (97.8%), CSB
133,911 / 148,820 (90.0%); the remainder falls into the last three rows
(mirrored pits are most of CSB's remainder). Null control: the same
compatibility build with the wall flip switched off drops to DM 98,925 and
CSB 68,567, so the sweep does detect a rule change.

Steps (party step + side step, every cell x facing x door variant):
DM 337,023 / 338,436 and CSB 250,324 / 256,984 identical. Every difference is
a game rule: stairs land on the destination stairs square (the old walker
used the square beyond it); door state 1 is passable; imaginary fake walls
(bit 0) are passable; pits chain through several levels (CSB).

## TODO

See `docs/dungeonmaster/TODO.md`.

# The Bard's Tale: Tales of the Unknown (Amiga)

Source: `data/_unexplored_/BardsTaleNTSC/` — a WHDLoad dump (`BardsTaleNTSC.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTaleNTSC.slave`'s embedded WHDLoad header text reads `The Bard's
Tale: Tales of the Unknown` (`strings -n 4 BardsTaleNTSC.slave`) — confirmed
as game 1, not assumed from the directory name.

## 1. File inventory

```
BardsTaleNTSC.slave        WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution WHDLoad-extracted reference text (no format work needed)
data/bardstale, data/bardstale.dat, data/c/*   68k executable + overlay-ish files, not yet disassembled
data/bards_data/pics       "animated picture" bank — CONFIRMED, see §2
data/bards_data/big_city, big_dung, dung_blank, bard_screen, control_panel, icon0-4
                            likely other screen/UI graphics banks, not yet investigated
data/bards_data/levs       likely dungeon/maze level data, not yet investigated
data/bards_data/chant, drums, harp, panflu, trumpet
                            almost certainly audio/instrument data (thematic — Bard's Tale's bard-song
                            mechanic), not yet investigated
data/members/*             character save-file-shaped data (`TPW.*`), out of scope per
                            save-file-not-asset.md — these are player state, not shipped assets
data/fonts/narrow.font, data/libs/diskfont.library
                            standard Amiga system font/library, not game-specific
```

## 2. `pics` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` (shared across all
3 games) §3.1 (BT1-specific RLE step) + §4 (Huffman) + §5 (BT1 has **55**
real pictures, indices 0-54, no placeholder slots).

Verification: all 55 render as recognizable, non-degenerate character
portraits and monster art (warrior in armor, paladin with sword/robes,
skeleton, various monsters, a castle/gate scene, an "Interplay
Productions" splash panel) — see
`public/assets/bardstale1/amiga/sprites/pics.png`.

Extractor: `tools/bardstale1/amiga/export-data.ts` (`npx tsx
tools/bardstale1/amiga/export-data.ts`).

## 3. Dungeon (walker, 2026-11-21)

Source of truth for the semantics below: the game's own code, `bardstale.dat`
(HUNK overlay executable: 144 root hunks, then a `HUNK_OVERLAY` table and 3
overlay groups; group 2 = the dungeon loop, loads `big_dung`/`dung_blank`).
Addresses below are in the flattened overlay-2 image (root hunks at 0x10000,
overlay group 2 at 0x80000; reproducible with a ~60-line hunk flattener).
Confidence: **confirmed from code** unless marked.

### `levs` record (2,048 B decoded; 16 records via the u32BE directory at file+0)
| Offset | Size | Field |
|---|---|---|
| 0x000 | 484 | wall grid, index `a*22+b`; 2 bits per face: bits0-1 = +a (N), 2-3 = -a (S), 4-5 = +b (E), 6-7 = -b (W); 0 open, 1 wall, 2 door, 3 secret door (`0x813aa`) |
| 0x1E4 | 28 | zero pad |
| 0x200 | 484 | cell flags, index `a*22+b` (`0x8142c` reads `+0x200`). `0x20` floor mark, `0x40` ceiling mark (drawn by the view: `0x82b9e`); `0x80`, `0x08`, `0x04`, `0x10`, `0x01`, `0x02` unresolved (event/special bits, **hypothesis**) |
| 0x3E4.. | | zero pad to 0x400 |
| 0x400 | 22 | header (monster-type ids `00 01 02 03 ff..`, other bytes unresolved) |
| 0x416 | var | level-entry message, high-bit ASCII ending `\` (`0x5c`), e.g. "Cellars" (loop at overlay+0x800a2) |
| 0x430.. | | special-square list (pairs/triples, unresolved) |

> **Correction (2026-11-21):** the flag grid is at `+0x200`, not immediately after the wall grid (`+484`);
> the earlier "484 B flag grid + slack" layout histogrammed 28 pad bytes of shifted data.
> Neighbour reciprocity of the wall grid with this face assignment: 99.44% of 12,928 pairs across 16 levels
> (best of 48 permutations x 2 orientations; next best 75.9%; the 83 mismatches are 1-vs-2 pairs, i.e. one-way doors).
> **Correction:** `0x21022`/`0x21026` are the (row, column) = (a, b) pair, cell = `a*22+b` (`mulu #22` on the first coordinate).

### Movement (overlay+0x802c4..)
Facing word `0x2102a`: 0 = +a, 1 = +b, 2 = -a, 3 = -b (N, E, S, W if +a is north; the orientation is inferred
from the BT map convention, **hypothesis**). Forward: blocked iff `view[0][3] & 3 == 1` (the party cell's front face is a
plain wall); doors and secret doors pass (secret door appears as a wall); coordinates wrap at 22. Keys: `1` = U-turn,
`2` = facing+1, `3` = facing+3 (which of these is on-screen "right" is **hypothesis**: facing+1 = clockwise if +a = north).
Default arrival is (0,0) facing north (`0x80042`), (16,17) in a special case on one level (`[0x20857]==4`).

### View (`0x80dea` row builder, `0x814a0` draw loop)
5 rows (distance 0..4) x 7 columns; each byte: low 2 bits face value, `0x80` = front-face entry, `0x20`/`0x40` flag marks.
Col c<3: side wall (face of cell c+1 toward c) else front face of cell c; col 3: front face of the centre cell; col>3 mirrored.
Draw: k = first row <4 whose centre byte `& 0x9f` is nonzero, clamped to visibility-1 (`0x20492`); rows k..0 far-to-near; per row
columns 2,1,0 then 3 then 4,5,6; a side wall (function C) stops that side's loop (occlusion).
Ported as `tools/bardstale1/amiga/dungeon.ts` (`buildViewRows`, `renderView`).

### `big_dung` (30,304 B) piece layout (loader `0x8277a`, carve-up `0x8226c`)
All pieces are 4 sequential bitplanes (plane size = bytesPerRow*rows), opaque rectangles, palette = first 16 words of `dung_blank`;
blit = BltBitMapRastPort minterm 0xC0. Front walls (and door variant): 96x83, 64x53, 48x32, 32x17 at depths 0-3;
side walls at depth 0-4 (w x h: 10x89, 19x83, 11x51, 8x30, 4x16) and off-centre depth 2/3 (33x47, 24x30), each as
left/right x wall/door; floor/ceiling marks 11/26/13 x 7, 13/12/14 x 3 (+ unfilled 5x1). The table tiles the file with
0 gap and 0 overlap (checked on every export). `dung_blank`: 32 B palette + RLE -> 4,928 B (112x88x4 background).
Screen positions: tables at overlay `0x831dc`/`0x83392`/`0x833ca` (see `dungeon.ts` constants).

### Paths tried
| Approach | Result |
|---|---|
| Render big_dung as 1bpp at width 12 | Showed brick/door art but no structure; 4-plane reading from the loader's buffer carve-up is the right one |
| Hand-guess piece geometry | Not needed: carve-up sizes and `BitMap` structs in the overlay data give exact bpr/rows |

## 4. Open

See `docs/bardstale1/TODO.md`.

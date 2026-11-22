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

## 4. Skara Brae, the city (walker, 2026-11-22)

Source of truth: overlay group 1 of `bardstale.dat` (the only overlay naming `big_city`; flattened like group 2:
root hunks at 0x10000, group 1 at 0x80000; code hunks 144/147/151 at 0x80000/0x85be4/0x87484). Confidence:
**confirmed from code** unless marked. Port: `tools/bardstale1/amiga/city.ts`; export `export-city.ts`.

> **Correction (2026-11-22):** `bards_data/CITY/` is not an unexplained extra: the city overlay opens
> `CITY/CITY.PATH` and `CITY/CITY.NAME` (strings 0x84800/0x8480f) and the building handlers show
> `city/BI1`..`city/bi9` as interior pictures (shop BI1, review board BI2, the two towers BI3, Mad God BI4,
> Roscoe's BI5, castle BI6, empty building bi7, taverns bi9). `CITY/icon3` is not named by the overlay.

### Grids
`CITY.PATH` and `CITY.NAME` each decode to 900 B = 30x30, index `row*30+col` (`muls #30`); loaded to 0x208f8 and
0x20c7c, back to back, and **nothing bounds-checks**: row 30.. of the path grid reads the name grid (the walker
reproduces this; reads before row 0 are treated as a plain house, **hypothesis**, only reachable looking off the
closed north edge). Path cell: 0 = street; else `(type << 3) | facade`, facade 1..4 = which `big_city` house art
(0 = invisible, e.g. statues `0x60` and iron gates `0x68`). Name cell: street index into the 20-name table 0x845d8
("Alley", "Rakhir", ... "Death Archer") when <= 0x13, else "You're in the Grand Plaza" (`0x804c6`).

### Pose and movement (`0x8021c`)
Row 0x20834, column 0x20838, facing 0x2083c; facing 0..3 = north, east, south, west (the game's own
"facing north." table 0x84642), north = row-1, east = col+1. New game (root 0x13bbc): (14,25) facing north, the
guild one square west. Keys: forward / 1 U-turn / 2 facing+1 / 3 facing+3 (same codes as the dungeon). Forward
into a street moves (into (27,25) puts the party on row 22, `0x802b0`); into anything else runs the handler for
`type = byte >> 3` (`0x80650`, jump table 0x8073e): result 1 = move in, >2 = leave the city (0xff guild, 3 dungeon),
otherwise the party turns round. Types: 0 empty building (1 in 4 an encounter), 1 Adventurers' Guild (leave),
2 tavern (name by 29-row, 0x80ef2; only the Scarlet Bard at (24,28) offers wine, which goes to the cellar),
3 Garth's shop, 4 temple, 5 review board, 12 guardian statue (free direction 0x22b82 per statue 0x22b64, else a
fight), 13 iron gate (one-way free direction 0x84fd8/0x84fe0, else needs item 0x8078), 14 Mad God temple ->
catacombs, 15 sewer portal (sets the city return square (24,27)), 16 bard hall, 17 Roscoe's, 18 Kylearan's tower,
19 Harkyn's castle, 20 Mangar's tower, 21 city gate (snow-blocked).

Dungeon entries store a dungeon id in 0x20824 and a level in 0x20857; root `0x17260` loads `levs` record
`0x17492[id] + level - 1` (bases 0,0,1,4,7,10,11). Arrival (dungeon overlay 0x80042): (0,0) facing 0, or (16,17)
for dungeon 1 level 4 (the sewer portal). Walker links: Scarlet Bard -> 0 (Cellars), sewer portal -> 3, Mad God
-> 4, Harkyn -> 7, Kylearan -> 10, Mangar -> 11.

### View (`0x85dce` -> `0x85ed8`, compositor `0x85fea`)
View table 0x20840: 5 distances x (left, centre, right). Two patches: facing south at (26,25) forces distance 4 to
(3, 0, 4); facing west on row 14 near the gate clears off-map distances (`0x85e88`). Compositor at walk frame 0
(frames 1..3 animate a step forward and are not ported): fill rows 0..45 colour 1 / 46..87 colour 2 (`0x8694c`).
A building straight ahead (distance 1, facade != 0) fills the view: a special type shows its `pics` picture
(`0x86504`, table 0x8729a: guild 52, tavern 43, shop 45, temple / Mad God 42, castle 35, gate 38), else the
front image (`0x863a8`). Otherwise front at distance 2 (or 3), then side cells far to near: a side cell whose nearer
neighbour is empty first gets its cross-street side face (`0x86552`), then its street-wall slice (`0x86366` ->
`0x87484`: columns of a 56x88 half image; from x 56 on the image is drawn mirrored, screen x <- source 112-x).
Column boundaries 0x8715c = 0/34/44/51/61/68/78/111.

### `big_city` (136,000 B, loader `0x869bc`)
32 B palette, 16 x 2,464 B street-wall halves (56x88, 4 sequential planes, `[facade-1][walk frame]`), 4 x 9,480 B
fronts, 4 x 14,656 B side faces (fronts/sides word-interleaved: per row, per 16-px column, 4 plane words). Front
rects 0x22002 / offsets 0x21ff0 and side rects 0x8719e / offsets 0x8718c tile their images exactly, except front
rect 1 (distance 3, walk frame 1), drawn one word wide but stored two wide (128 words; checked by the exporter).

Checked: the guild picture (pic 52, "AG") appears facing west at the new-game square and the tavern goblet (pic 43)
facing east at (24,27); street views render as continuous street walls with cross-street gaps
(`build/cache/bardstale1/walker-frames/city-*.png`). Not checked against the running game.

## 5. Open

See `docs/bardstale1/TODO.md`.

# Bard's Tale II: The Destiny Knight (Amiga)

Source: `data/_unexplored_/BardsTale2/` — a WHDLoad dump (`BardsTale2.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTale2.slave`'s embedded WHDLoad header text reads `Bard's Tale 2: The
Destiny Knight` (`strings -n 4 BardsTale2.slave`) — confirmed as game 2, not
assumed from the directory name.

## 1. File inventory

```
BardsTale2.slave           WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution WHDLoad-extracted reference text (no format work needed)
data/bard                  68k executable, not yet disassembled
data/bs.anm                unidentified, name suggests animation, not yet investigated
data/bards_data/pics       "animated picture" bank — CONFIRMED, see §2
data/bards_data/wpics      a SECOND, differently-named picture-like file — NOT yet
                            investigated (possibly a wilderness/overland variant, unconfirmed)
data/bards_data/big_city, big_dung, dung_blank, bard_screen
                            likely other screen/UI graphics banks, not yet investigated
data/bards_data/levs       likely dungeon/maze level data, not yet investigated
data/bards_data/citys, ic  unidentified, not yet investigated
data/bards_data/chant, drums, harp, panflu, trumpet
                            almost certainly audio/instrument data, not yet investigated
data/title                 unidentified, name suggests a title screen, not yet investigated
data/members/*             character save-file-shaped data — out of scope (save-file-not-asset.md)
data/fonts/narrow.font, data/libs/diskfont.library
                            standard Amiga system font/library, not game-specific
```

## 2. `pics` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` §3.2 (BT2-specific
bit-transpose+XOR steps) + §4 (Huffman) + §5 (BT2 has 64 directory slots,
**61 real pictures** — indices 0-63 minus 3 "no picture" slots at 25, 30,
52; these are valid 1-byte Huffman records, not payload-less and not
byte-identical — see the 2026-11-18 correction in §5 of the shared doc).

Verification: all 61 render as recognizable, non-degenerate character
portraits and monster art (a Conan-style barbarian, a knight/paladin, a
"Garth's" shop sign, gates/dungeon doors, a second "Interplay Productions"
splash panel) — see `public/assets/bardstale2/amiga/sprites/pics.png`.

Extractor: `tools/bardstale2/amiga/export-data.ts` (`npx tsx
tools/bardstale2/amiga/export-data.ts`).

## 3. Dungeon (walker, 2026-11-21)

Source of truth: the game's own code, `data/bard` (HUNK executable: 150 root hunks, `HUNK_OVERLAY`, 4 overlay
groups; **group 4** = the dungeon loop, its data hunk holds the eight `big_dung` filename slots). Addresses are in a
flattened image (root hunks at 0x10000, overlay groups appended; the hunk flattener is the same ~60-line script as
BT1's). The executable carries `HUNK_SYMBOL` blocks, but only for the music/sfx library (`_mm_*`, `sfx_*`).
Table "file offsets" below are `data/bard` offsets (`flat - 0x60e00 + 0x355f0`). Confidence: **confirmed from code**
unless marked.

### What carries over from BT1 (verified instruction-by-instruction, not assumed)
| Item | BT2 location | Result |
|---|---|---|
| Level cell model: `a*22+b` (`muls #22`), 2 bits/face N,S,E,W (shift 0,2,4,6), 0 open / 1 wall / 2 door / 3 secret | `0x5f32c` (face value), `0x5f3ae` (flags: byte@+0x200 | byte@+0x400<<8) | identical; flags grid again at `+0x200` |
| View-row builder (5 rows x 7 cols, `0x80`-front flag, `0x60` marks, facing params A/B/p10/p14/p18) | `0x5ec76` (+`0x5ec00` facing dispatch) | identical to BT1 `0x80dea`, facings 1/2/3 checked field by field; BT1's `buildViewRows` is reused unchanged |
| Move rule: forward blocked iff `view[0][3] & 3 == 1`; coordinates wrap at 22 | `0x5e0de`..`0x5e1d2`, wrap `0x131a0` | identical (facing word `0x22ce4`, row `0x22ce0`, col `0x22ce2`) |
| Draw loop | `0x5f49a` | same occlusion rule (a side wall stops that side's column loop, k clamped by visibility `0x21ed2`) but **different order**, see below |
| Face-value extras | `0x5f32c` | two transient overrides absent in BT1: if `[0x21ed3]` a secret door (3) shows as a door (2); if `[0x21f90]` wall and door (1/2) swap -- not modelled |

Neighbour reciprocity of the wall grid (north face of `(a,b)` vs south face of `(a+1,b)`, east vs west), all 25 levels,
24,200 pairs: **98.98 %** agree; null control (pair with the cell two away) **52.2 %**; wrong-orientation control (pair with
the neighbour on the other side) **57.2 %**. The 248 mismatches are wall-vs-open (167) and wall-vs-door (75): one-sided
walls/doors, as in BT1 (99.44 %). Test: `tools/walker/__tests__/games-bardstale2.test.ts`.

### `levs` record (3,072 B decoded; 25 records, directory = 25 u32BE record offsets at file+0)
| Offset | Size | Field |
|---|---|---|
| 0x000 | 484 | wall grid (as BT1) |
| 0x200 | 484 | cell flags (bits seen: 0x80, 0x08, 0x04, 0x10, 0x01, 0x02, 0x20 rare, 0x40 rare; special squares, **unresolved**; only 0x20/0x40 reach the view) |
| 0x400 | 484 | second per-cell byte grid, read with the flags by `0x5f3ae` (high byte; the view masks it out; **unresolved**) |
| 0x600 | 16 | level name, high-bit ASCII, `0xff`-terminated ("Dark Domain" x3, "The Tombs", "The Tower", "Destiny Stone", ...) |
| 0x610.. | | header bytes, then 32-byte message/special records (text with `0xff` ends), **unresolved** |

> **Correction (2026-11-21):** the old open row "`levs` (25 x 3,072 B)" is now decoded as above; the earlier guess
> that the grid size is 30x30 never applied -- every level is 22x22 (BT1 geometry).

### `big_dung` (22,424 B decoded) -- different layout from BT1's 30,304 B
`[0x00,0x20)` 16-word palette (**this is the dungeon palette**: `dung_blank` has no reference anywhere in `data/bard`, so
it is a leftover; its different palette/background are not used) + `[0x20,0x9C0)` background = 56x88x4 planar half view
(7 B rows; `0x5f7a0` copies each 7-byte group to bytes 0..6 and 7..13 of the 14-byte row, i.e. the 112-wide background is
the left half twice, then the right half is flipped) + piece bitmaps carved sequentially from file `0x9C0` by `0x60a32`:
each piece bitmap is 4 sequential planes, `bytesPerRow = ((x1 + pad + 16) / 16) * 2`, `rows = y1 + 1`, with `pad` the
second table below; order front (4), marks (6), side (8); further pieces alias an earlier bitmap (`0x60b12`: front
8->2, 9->3, 10->3, 4..7->0..3; `0x60c6c`: side 8->5, 9->6). The carve-up ends at exactly 22,424 B (0 gap, 0 overlap; checked
by `verifyTiling` at export and by test). Each wall bitmap holds **door at x=0 and wall at x=pad** side by side (front 192/128/80/48 px wide).

Tables (overlay data hunk, 5-word rows `[col'][depth]`, col' = 0..3 = distance from the centre column; `-1` = nothing):
marks `0x60e68` / dest `0x60e90` / src `0x60ec0` / pad `0x60ef0` / ceiling y-shift `0x60efc`; front `0x60f08` / dest `0x60f30` /
src `0x60f88` / pad `0x60fe0`; side `0x60ff6` / dest `0x6101e` / src `0x6106e` / pad `0x610be`. Ported literally into
`tools/bardstale2/amiga/dungeon.ts`.

### Draw order and the right-half mirror (`0x5f49a`, `0x44ee0`)
Rows far to near. Per row: left columns 2..0 then right columns 4..6, each column drawing its mark (`v & 0x60`), then its front wall
(`v & 0x80`) or its side wall; a side wall ends that side. Right-hand columns (col > 3) are drawn **unmirrored at x+56** with
`col' = 6 - col`; after the row loop `0x44ee0` flips the right half (x 56..111) in place (bit-reversal LUT `0x3d9ca`, bytes 7..13
swapped), which puts them on the right, mirrored. The **centre column** (col 3) is drawn after the flip, rows k..0. Blit = `0x44e00`
(BltBitMapRastPort minterm 0xC0, opaque rect copy). Variant selection: door when `(v & 0xf) == 2`.

### Paths tried
| Approach | Result |
|---|---|
| Render big_dung head (`+0x20`) as 112x44x4 | garbage; it is a 56x88 half background (7 B rows) |
| Use `dung_blank` (decoded by BT1's RLE, 112x88) as palette/background | it renders a teal theme and is never referenced by `bard`; big_dung's own header palette + half-background give the consistent green set |
| Draw right-hand pieces literally at x+56 | right wall missing/overlapping the centre; resolved by the `0x44ee0` right-half flip |

## 4. Cities (walker, 2026-11-22)

Source of truth: `data/bard` overlay group 2 (code 0x54100 / 0x59300, data 0x57800 / 0x5a100 in the flattened
image; `data/bard` file offset of the 0x5a100 hunk = flat - 0x5a100 + 0x2d818). Port: `tools/bardstale2/amiga/city.ts`;
export `export-city.ts`. Confidence: **confirmed from code** unless marked.

> **Correction (2026-11-22):** `citys` is a 7-entry directory: record 0 (2,304 B) is the 48x48 wilderness grid
> (group 3, art from `wpics`), records 1..6 (512 B) are the cities in the order of the name table 0x3a27a:
> Tangramayne, Ephesus, Philippi, Colosse, Corinth, Thessalonica.

### Grid, pose, movement (`0x542ce`)
City record -> 0x224de: 16x16 cells (`row*16+col`) then 16x16 street names (row+16; index into the 44 names at
0x3c46a when <= 0x2b, else "the Plaza"). Cell: high nibble = type, low nibble = facade (1..4, >4 -> (v&3)+1, 0 =
invisible). Row 0x22346, column 0x22348, facing 0x2234a (north = row-1, tables 0x3daf6/0x3dafe), city 0x22337.
Stepping off the grid exits to the wilderness (square 0x3bd24/0x3bd2b). 0 = street. Else handler `0x54834` by
type: 0 empty building, 1 tavern, 2 temple, 3 guild (leaves the city), 4 review board, 5 Roscoe's, 6 iron gate
(opens for item 0x6e), 8 shop, 9 casino (closed), 10 bank, 12/14/15 the city's dungeon (`0x549c0`: dungeon id
0x57800[city] = 1,2,4,8,6,5; returns 4). Result 1 = move in, 0 = turn round. `levs` record = 0x18b5c[id] + level - 1
(bases 0,0,4,7,8,13,16,20,22, root 0x1881c); the dungeon overlay starts at (0,0) facing 0 (0x5de2e). Guild-exit pose
per city: 0x3bd40/0x3bd47/0x3bd4e (always facing away from the guild); wilderness arrival square 0x3bd32/0x3bd39.

### View (`0x5956e` -> `0x595ee`, compositor `0x59826`)
Same view table as BT1 but bounds-checked (outside = 0) and sides masked to the facade. Frame 0: sky/ground fill
(`0x59ba8`, as BT1); left cells, then right cells drawn unflipped at x+56; d2 and d1 cells get a cross-street side
face (`0x59300`, 9 slots, rects 0x5a148 / dest 0x5a100) when the nearer neighbour is empty, then their street-wall
slice (`0x593b2`, 13 slots, 0x5a2d0 / 0x5a268); right half flipped (`0x44ee0`); then the centre: special building
ahead -> `pics` picture (0x5a5b0: tavern 17, temple 16, guild 21, review 51, Roscoe 44, shop 18, type 12 16,
type 13 15), else the front (`0x59464`, 8 slots, 0x5a4b0 / 0x5a470) at distance 1, 2 or 3. Each slot rect has four
facade variants side by side in one bitmap.

### `big_city` (92,744 B, loader `0x59c10`)
32 B palette, then 0xe318 B carved into 13 slice + 9 side bitmaps, then 0x8710 B into 8 front bitmaps; bitmap =
4 sequential planes, bpr = ((x1 of the 4th variant) + 16) / 16 * 2, rows = y1 + 1. The carve-up fills the file to
the byte (checked by `bigCityLayout`).

Checked: in every city the guild-exit pose faces away from a type-3 cell and turning round shows the guild picture
(pic 21); street frames in `build/cache/bardstale2/walker-frames/`. Not checked against the running game.

## 5. Open

See `docs/bardstale2/TODO.md`.

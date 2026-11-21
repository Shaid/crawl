# Crystal Dragon (Amiga) — data structure

Recon 2026-11-21 (re-recon). Everything below is **hypothesis** unless marked
otherwise. Format details live here; status lives in `docs/crystaldragon/TODO.md`.

## Title / version

| Item | Value |
|---|---|
| Title | Crystal Dragon (Black Legend, 1994; developer credited as Magnetic Fields in the project triage — **not** confirmed from the files, which carry no credits string) |
| Platform | Amiga OCS/ECS (A500, KS 1.3; up to 6 bitplanes) |
| Language | English (`Crystal_Dragon` text strings); the WHDLoad slave also supports a German version, not present here |
| Media | WHDLoad install v1.3 (Psygore, 2012) at `data/crystaldragon/amiga/` (slave + docs); the game files are flat under its `data/` subfolder (`data/crystaldragon/amiga/data/`). Original disks were a trackloader-free AmigaDOS game |
| Protection | Removed by the slave (disk check; level-10 "reset level number" check). The data files are unaffected |

sha1 (file-relative, whole file):

| File | Size | sha1 |
|---|---|---|
| `CrystalDragon.Slave` | 4,972 | `c825da495eae697f09695cdd87d3a2b3c4d58e40` |
| `data/Crystal_Dragon` (main exe) | 248,836 | `b6ee25e070c3fd16cf33e1e6e7666b73db28d92f` |
| `data/0a` (overlay exe) | 246,008 | `d6e97398aee593dd2e167865e9228b0a2dff7052` |
| `data/c0` (overlay exe) | 212,480 | `c3b34c70b8b6168441b421132a5f9ec1f0f6f905` |
| `data/c1` (overlay exe) | 2,264 | `60ad755df0751cba38d6300d2bf24c0ed5c31599` |
| `data/cc` (level 0 map) | 3,364 | `7019a371c5d3724a47003e4fb5e27068edbca0ea` |
| `data/06` (largest SQ) | 123,966 | `1c0039157ea84c2de27c4e3699028c032eb2673a` |
| `data/01` | 65,234 | `0f50034b93a7399678c15e0bf3c82b2df7944552` |
| `data/0b` | 55,086 | `8c704337e6794161f6521267be0ccaacbb0cadc5` |
| `data/12` | 61,858 | `7912f4e763865cd8465eaa43f52f18664c5f5740` |

`ReadMe` and `Solution` (a walkthrough of the starting party and items) are
plain text, useful as naming oracles.

## File naming — the game's own, not WHDLoad's (confirmed)

The 220 data files are named by **file number in lowercase hex**, with no
leading zero below 0x100 and a literal `1` prefix at or above it. That name is
built by the game itself: `BuildFileName` at `Crystal_Dragon` hunk 0 `+0x388A`
(file `+0x38AE`; hunk 0 data starts at file `+0x24`) writes `'1'` if
`d0 >= 0x100`, then two hex nibbles (`+0x30`, `+0x27` above 9) into `$4DC(A5)`.
So file ids are an engine concept. Look for id arithmetic in code, not a
directory.

Level maps: `id = level * 9 + 0xCC` (`MULU.W #9` / `ADDI.W #$CC` at hunk 0
`+0x3222`, `+0x3FE4`, `+0xEF8A`, plus more `MULU #9` sites at `+0x403A`,
`+0xF06C`… and `+0x21A7C`…). That gives the 23 files `cc, d5, de, … 192`. The
eight ids between each pair are never shipped. They are probably runtime or
save slots, which is open. After loading, the game `Open()`s the name at
absolute `$22EC0` with `MODE_NEWFILE` and `Write()`s `0xB4AE` bytes: it keeps a
working copy of the level.

## Container / compression layer — `S?` packed files

Every packed file starts with a 2-byte ASCII tag that `Unpack` at hunk 0
`+0x0004` (file `+0x28`) dispatches on: `SQ`→`+0x746`, `SA`→`+0x86`,
`SP`→`+0x296`, `SC`→`+0x29C`, `SF`→`+0x5F2`. Any other tag is a raw copy of
`0xC(a3)` bytes. The routine is position-independent apart from a workspace at
absolute `$70E`. `ancient identify` rejects all of them as unknown
(`renamed-magic-container.md` does not apply).

| Tag | Count | Header (big-endian) | Role (hypothesis) | Status |
|---|---|---|---|---|
| `SF` | 31 | `'SF'` u32 unpacked, u32 packed, then payload | generic file: backward bit-stream LZ77 | **decoded, structural invariant** (`scripts/cdlib/sf.py`, below) |
| `SA` | 86 | `'SA'` u16 planes, u16 frameCount, u32 unpacked, u32 packed, then frameCount × variable frame headers, then a backward bit-stream | `.SCR` graphic sets (walls, floors, doors, monsters) | **decoded, byte-exact vs the game's own code** (`tools/crystaldragon/amiga/codec.ts`, below) |
| `SP` | 2 (`09`, `0d`) | `'SP'` u16 planes, u32 bytesPerPlane (`0x1F40` = 8,000 = 320×200/8), u32 packed | full-screen picture, same image codec as `SA` | opaque |
| `SC` | 0 in data | as `SP` plus `2^planes` palette words copied to `d1` | picture plus palette | — |
| `SQ` | 3 (`01`, `06`, `0b`) | `'SQ'` u32 unpacked, u32 = `mode<<24 \| packedLongs`, then a backward bit-stream, then delta-undo mode 1/2/3 (`+0x7A6`…) | delta-coded 8-bit data, most likely sample banks or music | opaque, small routine |

### `SF` codec — decoded (confirmed structural)

> **Update (2026-11-21):** committed as `scripts/cdlib/sf.py` (`unsf`, plus `file_name`/`level_id`/`level_of_id`); `scripts/extract_cd_sf.py` dumps all 31 to `build/cache/crystaldragon/`; tests `scripts/cdlib/test_sf.py` (31/31 header size, 0 left over; null controls: flipped byte 31/31 differ or error, payload shifted by one byte 31/31 differ or error, extra byte at the decode start 31/31 differ or error). Note: dropping the *last* payload byte still decodes identically on 16/31 files with 0 left over, so the first-read byte can be redundant — the exact-consumption check constrains the stream front, not that byte.

A probe port of `+0x5F2…+0x708` decodes
**31/31** `SF` files to exactly the header's unpacked size. In every one the
backward reader consumes **exactly** the packed payload, with 0 bytes left over.
That double-exact invariant would not hold under a wrong bit grammar.

Grammar: the payload is first shifted down 10 bytes, over the header. The
reader goes **backward** from the payload end and fills the output backward
from `dst+unpacked` down to `dst`. The bit buffer is a byte refilled with
`move.b -(a0)` and a sentinel (`add.b; bne; addx`). Literal bytes come from the
same `-(a0)` stream.

- bit `0` → literal run. The count uses a gamma-like code: start at n=1, read
  k bits (k=1 first) and add them; if all k bits were 1, k++ and repeat.
  Then copy n bytes.
- bits `1 0` → match, length 2, 9-bit offset.
- bits `1 1 0` → length 3, 10-bit offset.
- bits `1 1 1 0` → length 4, 12-bit offset.
- bits `1 1 1 1 b` → offset width 9 if b=1 or 14 if b=0, then the length by
  the same gamma code starting at 5.
- Match copy: `src = out_pos + offset`, then copy bytes pre-decrementing both
  pointers.

`SF` decoded sizes: `00`/`02`/`1a`/`c2` = 40,000 (320×200×5 raw screens,
unrendered); `03` 6,210; `0c` 2,678; `1b` 8,366; `c4` 41,314; the 23 level maps
= 46,254 (`0xB4AE`) each.

## Level maps — `cc, d5 … 192` (SF → 46,254 B)

Loader: hunk 0 `+0x3206…+0x325E` (id → name → read). Decoded layout, from
level `cc`:

| Offset | Size | Field | Confidence |
|---|---|---|---|
| `0x0000` | 27 × 32 | Graphic-set name table: NUL-padded 32-byte slots. Some slots are empty. `WALL1.SCR`, `pillar1.scr`, `FLOOR1.1-3.SCR`, `CEILING1.1-2.SCR`, `DOORFRAME1.1.SCR`, `DOOR1-3.SCR`, `DOOR4.1.SCR`, `STAIRS1.SCR`, `BARRIER.SCR`, `TELEPORT.SCR`, `PASTEONS.WALL1/FLOOR1.1/DOOR1.1.SCR`, `LOCKS.SCR`. The slot order varies per level (`14a` inserts `SPWALL2.SCR`). The exe holds a default copy at hunk 0 `+0x23390` | rendered |
| `0x0360` | ~10 | small flag block (`0000 ff04 00c4 0901 07e3` in `cc`; varies) | hypothesis |
| `0x0B00`–`0x2B00` | | 32-byte records (`0b01 1700 …`, `0c02 …`, `1018 …`); probably the object, door and event lists | hypothesis |
| `0x3000`–`0x313E` | | **Region table**: 12-byte records `[off, H, W, y0, x0, id]` (BE words, `y0`/`x0` signed) stored just *before* the base word at `0x313E`, read backward from it; `0x313E` holds the record count minus 1 (one extra all-zero record is read and skipped). Hunk 0 `+0xC1C6…+0xC1F8` | **confirmed** (below) |
| `0x313E` | 2 | Grid base word (count) = `0x6E8(A5)`: `0x990(A5)` + `0x2DDE` with the block copied from `+0x360` (loader `+0x3D2E`; allocation `+0x2FF8`) | confirmed |
| `0x3140` + … | up to `0x8000` | **Map grid**: each region is a `W×H` row-major array of 8-byte cells at byte `0x313E + off` (first region `off=2` = `0x3140`). Cell address `((y-y0)*W + (x-x0))*8 + off` (`+0xC4FE`) | **confirmed** |
| `0xB140` | ~0x150 | level tail: `00ff ffff …`, then a word table (`0x32`/`0x64`/`0x3C` values; probably monster or level stats) | hypothesis |

**Cell record (8 bytes):** word 0 = cell type and flags; words 1–3 are mostly
zero (per-cell extras: decorations, items, events). The census below covers
all 23 levels, 40,183 non-empty cells, and uses `word0 & 0x7F` plus bit 7:

- type 5 = solid wall (22,876 cells), type 1 = floor (10,943), type 0 = void or
  open (1,511);
- type 6 (504) is split **249/255 on bit 7**, which is what a door with an
  orientation bit looks like;
- types 2/3/4/7/8/15/16 are rarer, plausibly stairs, pits, teleports, barriers
  and pillars, matching the level's `.SCR` slot names;
- wall-type cells sometimes carry high bits (`0x02D5`, `0x01F5`…). These are
  probably the `PASTEONS.WALL` decoration index.

> **Correction (2026-11-21):** this census keys on `word0 & 0x7F`, but the
> game reads the cell type as `word0 & 7` (see the region-table Correction
> below), so "types" 8/15/16/21/53/… are low-3-bit types plus flag bits, not
> distinct types (15 → 7, 8/16 → 0, 21/53/85/117 → 5). Re-counted with `& 7`
> over the 83 decoded regions (`scripts/cdlib/level.py`, 47,602 region
> cells, 36,896 with a non-zero `word0`): 5 = 23,773, 0 = 11,280, 1 = 10,943, 2 = 659, 6 = 506, 3 = 259,
> 7 = 165, 4 = 17. The old 40,183 figure counted the whole 32 KB grid area,
> not just region cells.

> **Correction (2026-11-21):** the type *meanings* above are wrong. From the view builder and
> renderer (hunk 0 `+0x146C8`, `+0x1E234`, `+0x1E518`): **type 0 = open floor** (the floor and
> ceiling are drawn only for these), **type 1 = wall** (the face variants live in bits 8-15, two
> bits per absolute face N/S/E/W; bit 7 set = a see-through "pillar" cell, e.g. word0 `0x5581`
> draws `pillar1.scr` on every face), **word0 == 5 exactly = plain solid rock** (the lookup returns
> no cell, drawn as wall variant 0), and **word0 & 7 == 5 with other bits = a redirect**: word1 is a
> signed offset from the grid base `+0x313E` to the real 8-byte record in the object area
> (`0x0B00`-`0x2B00`); all 897 redirects land there and resolve to types 0 (834), 2 (20), 6 (43).
> Effective census over the 83 areas: rock 22,876, type 0 = 12,114, type 1 = 10,943, 2 = 679,
> 3 = 259, 4 = 17, 6 = 549, 7 = 165. Types 2/3/4/6/7 (stairs/teleport/door/barrier by the slot
> names) are not traced yet (`cd-cell-types`).

Rendering `cc` at width 47 from `0x3140` gives a clean dungeon: rooms,
corridors, door pairs, and a solid `#` border with no shear for 33+ rows (see
the TODO evidence). Other levels shear at their header width — superseded:
each region carries its own `W`,`H` in the region table (Correction below).

> **Correction (2026-11-21):** the "single 64×64 grid, width from header `+0x3136`" model was wrong. A level is **several regions** (sub-maps, e.g. `cc` = 47×33 + 16×9 + 3×3) packed back to back in the 32 KB grid, each with its own `W`,`H`; the old "header (rows,width)" was just the *last* region's `H,W`, which is why it fitted ~half the levels. Evidence: `scripts/cdlib/level.py`, `scripts/cdlib/test_level.py` — over 23/23 levels (83 regions, widths 3…66, `H` up to 91) the regions tile from `off=2` with **0 bytes of gap**, each ending exactly at the next offset; changing any non-last region's width by 1 breaks the tiling (null control, all regions). Cell type is `word0 & 7` (`+0xC8C8`/`+0xC4FE`: 5 = wall, bit 7 = a flag the door/blocked tests read). Quick-look renders: `scripts/render_cd_maps.py` → `build/cache/crystaldragon/maps/` (`102` renders as a clean cave system; `15c` as nested rectangles — still unconfirmed against the game, view only).

**How the regions relate (2026-11-21, confirmed from code):** each region is a separate sub-map
("area"), selected by its `id`. The party position is (area id `4310(A5)`, x `4312(A5)`,
y `4314(A5)`); the cell lookup `+0x146C8` scans the region records for a matching id and only
then range-checks x/y against `x0`,`y0`,`W`,`H`, and the automap `+0xC19A` loads the bounds of the
record whose id equals `4310(A5)`. x/y are absolute (`x0`/`y0` are often negative) and areas of
one level overlap in that frame (level 4 `f0` has ten areas at nearly the same origin; level 22
`192` has six 3×3 areas at (45,-41)), so they cannot be one coordinate space: they are layers
linked by stairs/teleports that keep the absolute x/y. North is **+y** (row index grows north).

### Paths tried (grid geometry)

| Approach | Result | Why it isn't enough |
|---|---|---|
| Fixed width 48 from `0x3140` | `cc` sheared by −1 column per row | true `cc` width is 47 |
| Header `+0x3136` as width | `cc`, `de`, `10b`, `11d`, `12f`, `165`, `16e`, `177`, `189` coherent | `d5`, `f9`, `102`, `141`, `14a`, `192` disagree with autocorrelation. Either a different field holds the width or rows are padded |
| Lag autocorrelation of `word0` (superseded, see Correction above) | picks 47 for `cc`, matches the header on about half the levels | not an oracle; need the game's grid-index code (`y*W+x` with a `MULU` by a stored width) |

## `.SCR` graphic sets — `SA` files + companion slot tables

Most `SA` files are followed, at id+1, by a small raw file of 16-bit words: 92,
146, 260, 308, 470, 1,196 or 2,392/2,576 B. The first words are frame
offsets (`frame*4`) or `-1`, indexed by a fixed slot number. Coordinate-like
words follow (`9, 6, 151, 6, 0, 0, 41, 12…` in `21`). The table length depends
on the class:

| Group (ids) | SA planes / frames | Table | Likely class (by name-table order) |
|---|---|---|---|
| `32`, `4c`, `78` | 4 / 78, 42, 44 | 470 B (235 w) | `WALL1/2/3.SCR` |
| `34`–`3c`, `50`–`58`, `7a`–`82` (5 each) | 4 / ~24 | 146 B (73 w) | `FLOOR n.1-3` + `CEILING n.1-2` |
| `1e`, `3e` | 4 / 27 | 308 B | `DOORFRAME` |
| `20`–`26`, `40`–`46`, `5a`–`6a` | 4–5 / 9 | 92 B (46 w; first 16 = slot→frame) | `DOOR1…15` |
| `92`–`be` (even) | 5–6 / 13–17 | 260 B | probably monsters or large features |
| `13`/`14`/`16`/`19`, `2e`, `48`, `6c`–`74`, `84` | 5–6 / 100–180 | 1,196–2,576 B | monster or animation sets (larger frame tables) |

### `SA` codec — decoded (2026-11-21, byte-exact)

Port: `tools/crystaldragon/amiga/codec.ts` `unSA` (original TypeScript written from `+0x086`…
`+0x250`, `+0x360`…`+0x5EE`). Oracle: the game's own `Unpack` run under musashi
(`tools/crystaldragon/amiga/emu/`): **86/86 `SA` files byte-identical**, every stream consumed to
the exact byte (0 left over), every set's frames tile the output from `2 + 4·frames` to the end.
Null control: one flipped byte in `32`'s stream breaks it (test
`tools/walker/__tests__/games-crystaldragon.test.ts`).

- Header: `'SA'`, u16 planes P (3-6), u16 frames F, u32 unpacked, u32 packed, then F frame headers
  `u16 w, u16 h, u32 flags, extra bytes, u16 extraLen` (extraLen = -1 → 0), then the packed stream,
  read **backward** with a 32-bit sentinel bit buffer (`ADD.L D0,D0`, refill `-(A0)` with X=1).
- Frames decode last to first into a 16 KB chunky history ring (written downward, `& $3FFF`).
  4-bit token (`+0x360` table): 0-5 match length = code; 6/7/8/9/10/11 = 6+1b, 8+1b, 10+2b,
  14+3b, 22+5b, 54+8b; plus a per-P base (`+0x6A`: P 4 → 5, 5/6 → 4); then 1 bit picks a 14- or
  9-bit distance, copy from ring[pos+dist-1] downward. 12 = run of 4 bits, 13 = run of 16+8 bits
  (+ base `+0x78`: P 4 → 4, 5/6 → 3) of one literal pixel; 14 = 1 literal, 15 = 2+3b literals. A
  literal pixel is P bits rotated in from the top of a byte (`ROXR.B`).
- Every 16 ring bytes → one word per stored plane (`+0x498` handler for n planes: byte bit 7-k →
  plane k), written backward. The ring, its block pointer and the pending-pixel count carry over
  between frames.
- Decoded layout: u16 P; u32 frameOffset[F]; per frame `u16 w, u16 h, u16 bytesPerPlane, u32 flags,
  extra, stored planes` (plane-major, `bytesPerPlane = ((w+15)>>4)·2·h`).
- Stored plane count (`+0x252`): 1 for the mask when `flags>>24 & 7 == 0`, plus one per distinct
  source nibble < 7 not marked shared.

**Frame flags (draw routine `+0x14384`, plane setup `+0x133A2`; same logic at `+0x4C44`):**
bits 0-23 = six nibbles, one per screen bitplane (5 blitted): n<7 = stored plane n, 7 = clear,
15 = set, 8+n = inverted plane n. Bits 24-25: 0 = cookie-cut with the mask plane (minterm `$FCA`),
1/2 = opaque with 1/2 edge-mask words (BLTAFWM/LWM), 3 = opaque. Bit 26: the mask is a reference;
bits 27-31: stored plane 0-4 is a reference — a signed u32 offset relative to the byte after it,
into another frame of the same set. `tools/crystaldragon/amiga/sets.ts` `composeFrame`.
A set whose name repeats an earlier slot of the same level is stored once and drawn with a plane
remap (`+0x14446`: p0,p1 kept, p2 ← p3, p3 = 0, p4 = 1, i.e. colours 16-23).

### Name → file id and slot tables (confirmed)

The level's 27 slot names resolve through a lowercase name list at hunk 0 `+0x25176`
(`+0x41D0`…`+0x41F8`): **id = 0x1C + 2·index** (`pillar1.scr` = `1c`, `wall1.scr` = `32`,
`floor1.1.scr` = `34` …, 54 names up to `86`); the companion table is file id+1. The loader
(`+0x412E`) stores slot pointers at `2340+4k(A5)` and table pointers at `3340+4k(A5)` and checks
each table's size by slot class: slots 0-3 (walls/pillars) 470 B (or 236 if the header's low byte
≠ 0), 4-11 (floor/ceiling) 146, 12-15 (door frames) 308, 16-19 (doors) 92, 20 (stairs) 182,
21-22 (barrier/teleport) 74.

Slot table (read by `+0x14290`): u16 header; low byte 0 = **two alternating views**, chosen by the
step parity `1158(A5) = (facing>>1 + area id + x + y) & 1` (`+0x1E1A0`); then npos·sets s16 frame
words (`frame·4`, -1 = none), then npos·sets `(x, y)` pairs. npos = 39 for walls, 12 for
floor/ceiling. Draw position: `screen + y·40 + 0x32 + x/8` (the view starts at screen x 80,
row 1); frames span x 9…155, y 0…115.

## First-person renderer (2026-11-21)

Traced from `+0x1E172` (`LAB_15A0`) onward; ported in `tools/crystaldragon/amiga/view-model.ts`.

- **View cells** (`+0x1E0B4`): 12 cells, 3 wide × 4 deep, index = row·3 + column, row 0 = the
  party's row, column 0 = left. Facings 0-3 = **N, S, E, W**; forward N = +y, left of N = -x
  (`+0x1E12E`…`+0x1E170`).
- **Floor/ceiling** (`+0x1E516`): cells 11…0 that are open: floor slot `4 + ((w0>>3)&3)`, ceiling
  slot `8 + ((w0>>5)&3)`, position = cell index; an empty slot falls back to the class's first
  slot (`+0x1429C`).
- **Walls**: wall position → (cell, relative side) table at `+0x205EC` (17 primary positions);
  absolute face = `side ^ facing`, bit 0 flipped when `side & facing & 2` (`+0x1F988`);
  variant = `(w0 >> (8 + 2·face)) & 3` → slot 0-3. Positions 17-38 are clipped alternates of the
  primary ones (called with an explicit cell at `+0x1E5AA`…`+0x1E7D8`) used by the game's occlusion
  logic (`+0x1E3EC`…`+0x1E516`, tables `+0x21388`/`+0x21400`).
- **Palette**: the dungeon view uses the 32 words at `A5+500` (A5 = hunk 0 `+0x229E4`), copied to
  COLOR00-31 by `+0x1378` and faded to by `+0x111C` from the dungeon code. Walls/floors use
  colours 1-7, doors 17-31. Colours 12-15 hold `$00F` placeholders in the shipped executable
  (nothing in the view sets observed uses them). Other tables at `A5+68/132/196/…/692` are the
  intro, menu and automap (`+564`, `+0x9EF8`) palettes.

The walker draws back to front (painter order) instead of reproducing the occlusion bitmasks,
and does not use the clipped alternates; it draws nothing beyond row 3.

### Paths tried

| Approach | Result | Why it failed |
|---|---|---|
| `ancient identify` on `SA`/`SP`/`SQ` | unknown | custom codec |

## Raw (unpacked) files

| Ids | Notes (hypothesis) |
|---|---|
| `05`, `07`…, `0f`, `11`, `15`, `18`, `1d`, `1f`, `29`, `2b`, `2f`, `31`, `33`… | slot or coordinate tables and small parameter blocks next to `SA` sets (see above); `15` (640 B, bytes `0x71`–`0x75`) maybe a colour or shade table |
| `88`–`91` (10 files, 992–4,966 B) | header `u16 id (0x15…0x27)`, `u16 length`, then signed-8-bit-looking data: **sound effects** |
| `12` (61,858 B) | `0000 0398 fe02 07fd …`, small signed deltas; music, or a sample bank |
| `cc`-family siblings absent | see "File naming" |

## Executables

- `Crystal_Dragon`: HUNK, 2 hunks. Hunk 0 = CODE+DATA, 0xE120 longs; hunk 1 =
  CHIP BSS, 0xD8D longs. Not crunched; it holds the unpacker, the file loader,
  the game text and the default `.SCR` names. **No `HUNK_SYMBOL`** was checked
  for; do that first in the disasm phase.
- `0a`, `c0`: single-hunk overlays (entry code uses the main program's `A5`).
  They are high-entropy and contain embedded `SF`/`SA` blocks: probably the
  intro, character generator and ending.
- `c1` (2,264 B): tiny single hunk that hooks a CPU vector (`$10` = illegal
  instruction). It is probably the slave-patched protection, called "CDFC" in
  the ReadMe.

## First-person view (walker question 2) — superseded

> **Correction (2026-11-21):** confirmed and traced; see "First-person renderer" above. The
> slot-table premise holds; the frame numbering is per view position, not per `.SCR` name order.

The renderer looks like a **slot-table blitter**: each `.SCR` set holds
pre-drawn frames for each visible view position. Its companion table maps
`slot → frame` (or `-1`) plus screen x/y, and the level's name table picks
which sets are live, with the per-tileset numbering `WALL1/2/3`, `FLOOR n.k`.
This is the EOB/Black Crypt family of renderer, not vector or tile mosaic.
`PASTEONS.*` are overlay decorations drawn on top of wall, floor and door
slots. Not yet confirmed from the render code.

# Crystal Dragon (Amiga) — data structure

Recon 2026-11-21 (re-recon). Everything below is **hypothesis** unless marked
otherwise. Format details live here; status lives in `docs/crystaldragon/TODO.md`.

## Title / version

| Item | Value |
|---|---|
| Title | Crystal Dragon (Black Legend, 1994; developer credited as Magnetic Fields in the project triage — **not** confirmed from the files, which carry no credits string) |
| Platform | Amiga OCS/ECS (A500, KS 1.3; up to 6 bitplanes) |
| Language | English (`Crystal_Dragon` text strings); the WHDLoad slave also supports a German version, not present here |
| Media | WHDLoad install v1.3 (Psygore, 2012) at `data/_unexplored_/CrystalDragon/` (not moved into `data/`). Original disks were a trackloader-free AmigaDOS game; files are flat under `data/` |
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
| `SF` | 31 | `'SF'` u32 unpacked, u32 packed, then payload | generic file: backward bit-stream LZ77 | **decoded by probe, structural invariant** (below) |
| `SA` | ~110 | `'SA'` u16 planes, u16 frameCount, u32 unpacked, u32 packed, then frameCount × variable frame headers, then a planar image codec | `.SCR` graphic sets (walls, floors, doors, monsters) | opaque, needs the reader |
| `SP` | 2 (`09`, `0d`) | `'SP'` u16 planes, u32 bytesPerPlane (`0x1F40` = 8,000 = 320×200/8), u32 packed | full-screen picture, same image codec as `SA` | opaque |
| `SC` | 0 in data | as `SP` plus `2^planes` palette words copied to `d1` | picture plus palette | — |
| `SQ` | 3 (`01`, `06`, `0b`) | `'SQ'` u32 unpacked, u32 = `mode<<24 \| packedLongs`, then a backward bit-stream, then delta-undo mode 1/2/3 (`+0x7A6`…) | delta-coded 8-bit data, most likely sample banks or music | opaque, small routine |

### `SF` codec — decoded (confirmed structural)

A probe port of `+0x5F2…+0x708` (scratch `probe/sf.py`, not committed) decodes
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
| `0x3128` | 8 words | level header. The last two words (`+0x3134`, `+0x3136`) = (rows?, **width**) — `cc` (33, 47). The width matches the autocorrelation-best stride on about 12 of 23 levels, but not all (`d5` hdr 18 vs best 21; `102` 30 vs 60; `14a` 66 vs 64) | hypothesis |
| `0x3140` | 0x8000 | **Map grid: up to 64×64 cells × 8 bytes, row-major.** The region ends exactly at `0xB140`, where the next block starts | rendered (below) |
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

Rendering `cc` at width 47 from `0x3140` gives a clean dungeon: rooms,
corridors, door pairs, and a solid `#` border with no shear for 33+ rows (see
the TODO evidence; reproduce with the probe). Other levels shear at their
header width, so the true width/height source is still open.

### Paths tried (grid geometry)

| Approach | Result | Why it isn't enough |
|---|---|---|
| Fixed width 48 from `0x3140` | `cc` sheared by −1 column per row | true `cc` width is 47 |
| Header `+0x3136` as width | `cc`, `de`, `10b`, `11d`, `12f`, `165`, `16e`, `177`, `189` coherent | `d5`, `f9`, `102`, `141`, `14a`, `192` disagree with autocorrelation. Either a different field holds the width or rows are padded |
| Lag autocorrelation of `word0` | picks 47 for `cc`, matches the header on about half the levels | not an oracle; need the game's grid-index code (`y*W+x` with a `MULU` by a stored width) |

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

The SA decoder (`+0x86…+0x250`) walks `frameCount` variable-size frame headers.
Each has a flags byte whose low 2 bits and bit count set the header length, and
`w`, `h` words (plane bytes = `((w+15)/16)*2*h`). It then decodes the pixels
through a jump-table, context-modelled bitplane codec (`+0x360`, `+0x498`
tables, `andi.w #$3FF0`-masked history at `a2`). This is **not** worth
hand-porting first: emulate it.

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

## First-person view (walker question 2) — hypothesis

The renderer looks like a **slot-table blitter**: each `.SCR` set holds
pre-drawn frames for each visible view position. Its companion table maps
`slot → frame` (or `-1`) plus screen x/y, and the level's name table picks
which sets are live, with the per-tileset numbering `WALL1/2/3`, `FLOOR n.k`.
This is the EOB/Black Crypt family of renderer, not vector or tile mosaic.
`PASTEONS.*` are overlay decorations drawn on top of wall, floor and door
slots. Not yet confirmed from the render code.

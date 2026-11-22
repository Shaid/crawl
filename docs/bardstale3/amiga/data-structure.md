# Bard's Tale III: Thief of Fate (Amiga)

Source: `data/_unexplored_/BardsTale3/` — a WHDLoad dump (`BardsTale3.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTale3.slave`'s embedded WHDLoad header text reads `Bard's Tale 3:
Thief of Fate` (`strings -n 4 BardsTale3.slave`) — confirmed as game 3, not
assumed from the directory name.

## 1. File inventory

```
BardsTale3.slave           WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution / Spells   WHDLoad-extracted reference text (no format work needed)
data/driver                 title/sound loader blob (no HUNK header; strings Thief:title...). NOT the game -- see §4
                             (2026-11-21 correction: the game program is `bard3`)
data/all.pic                "animated picture" bank — CONFIRMED, see §2
data/bard3                  THE GAME PROGRAM (3-hunk HUNK executable: CODE 0x1eb00 B, DATA, BSS); also holds
                             all.pic's palette tables (§2) and every map/view table (§4)
data/D0WAL.GRP, GDUNG.GRP, SKARA.GRP, WILDWAL.GRP
                             LE u16 offset directory (D0WAL: 7 entries, 14..8864), records start
                             with magic RAW\x18 — NOT yet decoded
data/maps.hi, maps.lo       71 records of [u32 size][stock LZHUF] (decodes, 71/71); record = 16-byte
                             name + w/h + word-offset table; cell format NOT yet decoded
data/monsterh, monsterl     NOT graphics: no size header, 41 record spans all multiples of 48 =
                             raw 48-byte monster stat records with high-bit ASCII names
                             (the "try unpackBard3" premise is retracted; the earlier planar sweep
                             failing was correct)
data/icons.bin               unidentified, not yet investigated
data/title, titlescreen, victory, finalBardscreen
                             confirmed (via container triage) to be real IFF ILBM screens —
                             trivially decodable with @seer-project/iff, NOT yet done this session
data/game.sav, parties.inf, thieves.inf, inventor.stf, Some.stuff
                             save/state-shaped files — out of scope (save-file-not-asset.md)
data/fonts/bards.font, data/libs/*
                             standard Amiga system font/libraries, not game-specific
```

## 2. `all.pic` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` §2 (sentinel-
terminated directory) + §6 (LZ77+adaptive-Huffman codec) + §6.1 (palette
via `bard3`'s id-remap table).

- **85 real pictures** (indices 0-84), directory sentinel at entry **85**
  == file length (526,002 bytes) exactly.
  > **Correction (2026-11-18):** this previously said 84 pictures and that
  > slot 84 "fails to decode". It decodes fine; the failure was our decoder
  > throwing on LZHUF's one-byte bit-buffer read-ahead past EOF (fixed). See
  > bardstale-picture-format.md §5.
- Every record decompresses to exactly 19712 bytes = 4 x 4928-byte chunky
  112x88 4bpp sub-frames — confirmed zero-deviation across all 85 records.
- All 85 x 4 = 340 sub-frame cells resolved a palette via `bard3`'s id-remap
  table (all 85 indices present once; 3 `0xFF` rows = no picture). The old
  "0 misses" metric was circular (see picture-format §6.1).

Verification: all 340 sub-frame cells render as recognizable,
non-degenerate monster/character/scene art (campfire scene with hooded
figures, orcs, wolves, gargoyles, sharks, an octopus, a mind-flayer-like
creature, a minotaur, a tree, warrior women, skeletons, robots, a giant
bloodshot eye, a demon) with visible small frame-to-frame variation within
each picture's 4 sub-frames (consistent with real animation content, e.g.
campfire flame flicker) — see
`public/assets/bardstale3/amiga/sprites/pics.png`.

Extractor: `tools/bardstale3/amiga/export-data.ts` (`npx tsx
tools/bardstale3/amiga/export-data.ts`).

## 3. Maps and wall art (2026-11-21, walker attempt -- partial)

### `maps.hi` / `maps.lo` container (confirmed)
u32BE directory of record offsets (entry 0 = directory length, so 37 / 36 entries; last entry = file length), each
record `[u32 BE decodedSize][Okumura LZHUF stream]` (N=4096 spaces-filled, F=60, THRESHOLD=2; a fresh decoder,
`tools/bardstale3/amiga/lzhuf.ts`). **71/71 records decode and the stream consumes exactly `span - 3` bytes
(= span - 4 + 1 read-ahead byte) for every record** -- the same invariant the picture codec shows; a decoder started
one byte late breaks it (null control in `tools/walker/__tests__/bardstale3-maps.test.ts`). Extractor:
`tools/bardstale3/amiga/export-maps.ts` -> `data/maps.json`. (The earlier "71 records of `[u32 size][LZHUF]`" scan treated
the files as a flat sequence; they have the directory above.)

### Decoded record
16-byte high-bit ASCII name (`0xff` padded: "Lucencia", "Wilderness", "Tower", "Cyanis' Tower"), then two families:
| Family | Maps | Layout |
|---|---|---|
| **grid** (10: Lucencia, Celaria Bree, Nowhere, Dark Copse, Black Scar in `hi`; Wilderness, Skara Brae, Arboria, Ciera Brannia, Gelidia in `lo`) | cities/overland, 11..20 square | `[0x10]=w [0x11]=h`, 2 flag bytes (`0x9f 0x11` ...), `(h+2)` u16BE words (word 0 unresolved; words 1..h = row start - 1, rows listed last to first), then **h rows of w cell bytes at `0x14 + 2(h+2)`** (Lucencia: 12x12 at 0x30), then a tail of 3-5-byte records (events/specials, unresolved) |
| **dungeon** (61) | towers, tombs, mountains, catacombs ... one record per level | `[0x10]` = size-1 (0x13 = 20 wide), `[0x11]` = level index 0..3, link bytes (`03 04 05 06 ff ff ff ff ...`), a u16BE word table with only ~7 entries stepping 0x19, then a compact (RLE/sparse?) cell stream -- **not decoded** |
Cell bytes of the grid family (Lucencia): `00` open (90 of 144), `e3` (37) / `e2` (7) wall-like blocks, `f8`, `f1`, `f2`, `04`, `0f` singletons
(specials). **Hypothesis**: a cell is either a solid block or open (the BT3 city/wild maps are not per-face like BT1/BT2);
no consumer in `driver` was traced, orientation (row order, which edge is north) is unconfirmed, so no walker was built.

### `.GRP` wall art (container confirmed, 32/32 non-empty records)
LE u16 offset directory (entry 0 = directory length), record = `"RAW"`, `w` px (1 byte), `00 00 00 00`, `bytesPerRow` u16BE (= w/2),
`h` (1 byte), key colour (1 byte = 5), `bytesPerRow*h` **chunky 4bpp** bytes (high nibble first), 1 trailing byte; span =
`12 + bpr*h + 1` for every non-empty record (`decodeGrp` throws otherwise). Entry sizes alternate: **24x97 side-wall** and
**64x55 front-wall** (`D0WAL` 7 records, `SKARA` 8, `GDUNG` 10 incl. two 112x44/112x45 pieces = floor/ceiling halves?, `WILDWAL` 11 incl.
4 empty 22-byte placeholders and one 65x55). Greyscale render of `D0WAL` records 0/1 shows a skewed side wall and a flagstone front wall,
i.e. the decode is right; **palette not located** (bard3's picture palettes are for `all.pic`; the dungeon/wild palette source is
unknown) and the which-record-is-which-depth mapping is not traced (needs `driver`). `data/grp-wall-art.json` holds raw indices.

### Why there was no BT3 walker yet (superseded 2026-11-21, see §4)
Missing, in order: (1) the cell semantics of the grid family and the whole dungeon-record layout (a `driver` trace of the
map-load + move routine), (2) the palette for the wall art, (3) the view geometry / record-to-depth mapping. Smallest next step:
disassemble `driver`'s map loader (search for the `maps.hi`/`maps.lo` open + LZHUF call) and follow the buffer to the move routine.

## 4. Dungeon walker trace (2026-11-21, bard3 -- CONFIRMED from code)

> **Correction (2026-11-21):** the map/view code is not in `driver`. `driver` is a small title/sound loader;
> the game is `bard3` (`0x3F3` HUNK file; it even contains the string `Thief:driver`). `bard3` opens
> `Thief_data:maps.lo` / `maps.hi` / `wildwal.grp` / `skara.grp` / `gdung.grp` / `dung.tst` by table
> (DATA 0x20698..). Addresses below are flat: CODE at 0, DATA at 0x1eb00 (file offset = addr - 0x1eb00 + 0x23c10),
> BSS at 0x267b4. Disassembled with IRA (`-a -LABEL=1`), labels = addresses.

**Map loader** 0x9634(map, buf): map index -> (file 1 = maps.lo / 2 = maps.hi, record) via DATA 0x206ed, then the
u32 directory + `[u32 size][LZHUF]` record (LZHUF at 0x0748). Maps 0-9 are the ten cities/wilderness grids;
dungeon index d (global 0x268da) = map - 10, so the 61 dungeon records are d = 0..60. Dungeon entry 0x1cb2.

**Dungeon record** (all offsets confirmed by their consumers): `0x10` flags (bits 0-2 encounter level, bit 4 stairs
prompt sense, bits 6-7 wall set: filename table index 3+v -> 0,1,2 = gdung.grp, 3 = `dung.tst` which is not
shipped and never selected), `0x11` level index in the dungeon, `0x12..0x19` dungeon index of each level
(0xff none), `0x1a/0x1b/0x1c` exit y/x/city, `0x1d` monster set, `0x1e` W, `0x1f` H, `0x20/0x21` signed x/y offset of
the level (stairs keep the party at the same frame position: y += old[0x21] - new[0x21], 0xcdf0 + 0x1d6a),
`0x22` u16**LE** special-list offset, `0x24` u16LE[H] row offsets (row y; stored last row first).
> **Correction (2026-11-21):** the old note "[0x10] = size-1, [0x11] = level index ... u16BE word table stepping 0x19"
> misread this header: 0x19 = 5 x W; the words are little-endian; size is at 0x1e/0x1f.

**Cell = 5 bytes**: `[0]` E | N<<4, `[1]` W | S<<4 (one 4-bit value per face; word = b1<<8|b0, rotated left by
4*facing at 0x01c8 so the front face is bits 4-7), `[2]` 0x80 random encounters, 0x40 portal up, 0x20 portal down
(both drawn), 0x10 fixed encounter, 0x08 darkness; `[3]` traps (0x01 spinner, 0x10 silence, 0x40 damage ...);
`[4]` automap (0x01 seen, 0x08 visited). Per-flag handlers: table DATA 0x25a78/0x25ab8/0x25ac8. Orientation check:
the shared face of neighbours agrees on 99.0 % of faces over the large maps (wrong orientation: < 80 %).
Face values: 0 open, 1/9 wall (two art sets), 2,3,4 / 10,11,12 door, 5/13 invisible wall, 6,14 and 8 walls, 7,15
doors (nibble -> piece table 0x20d72, nibble -> move class 0x20c32).

**Movement** (0x20a8 / 0x2018 -> 0x22ba): forward = (x,y) + (0,1)/(1,0)/(0,-1)/(-1,0) for N/E/S/W, wrap mod W/H
(0x2d7a). The forward key (0x4800) only passes class 0; the `0x4b` command ('K', kick) also passes door classes 1/2.
Turns: 0x4b00 left, 0x4d00 right, 0x5000 U-turn; no back-step.

**Stairs / teleport**: special list = count + 4-byte entries `[y (0x7f any)] [x (0xff any)] [u16LE script]`;
scripts are bytecode (71 opcodes, handler table DATA 0x222cc, high bit = continue). Opcode 0 = level index -1
(below 0 leaves to the city at 0x1a..0x1c), 1 = +1 (0xce92 / 0xcefc, after a yes/no prompt); opcode 3 = teleport
(y, x, target; in a dungeon target bit 7 = city, else dungeon index). Check: 42 of 47 stairs squares land exactly on a
reverse-stairs square of the target level (the 5 others are in White Tower / Ice Keep).

**View** (0x29dc): 34 view cells per facing (DATA 0x20d62 -> 4 x 34 (dx,dy)); cells 0-24 = wall words, 25-33 =
portal words (0x1f238). 61 draw slots (cell 0x20e02, nibble shift 0x20e3f, enable 0x20ef6, x/y 0x20e7c with x in
bytes, width-1 0x20b6a, GRP directory byte offset 0x20be4, scale 0x20ba7 (64 = 1:1), mirror 0x20dc5); first slot by
light level 0x20d82. Only the 22 slots with enable set are ever drawn (a 3-wide, 3-deep view). Piece p (1..4) in slot s
= GDUNG directory entry slotGrp/2 + 2(p-1) (even = 24x97 side, odd = 64x55 front; limit 16 bytes in a dungeon);
entries 8/9 (112x44 + 112x45) are the ceiling / floor background halves (0x9d12, 2464 B each). Blitter 0x0062:
scaled chunky copy, accumulator decimation (-scale per pixel/row, emit on <0, +64), mirror, colour 5 transparent
(mask table built from 0x55 at 0x0aa6). Light < 4 blanks part of the view (0x20fd6 / 0x20fe0).
**Palette**: the view routine loads DATA 0x20868 (= bard3 file 0x25978, palette 0 of the all.pic table) via SetRGB4
(0x2bdc -> 0x1268); DATA 0x208c8 when flag 0x28c36 is set (unidentified).
> **Correction (2026-11-21):** `.GRP` pixels start at record+13 (13-byte header, last byte 0), not +12.

Unreferenced: `D0WAL.GRP` (no name string in bard3). Extractor: `tools/bardstale3/amiga/export-dungeon.ts`
(tables read from bard3, never typed in) -> `public/assets/bardstale3/amiga/data/dungeon/`; logic
`tools/bardstale3/amiga/dungeon.ts`; walker `tools/walker/games-bardstale3.ts`.

## 5. City / wilderness walker trace (2026-11-22, bard3 -- CONFIRMED from code)

> **Correction (2026-11-22):** the §3 "grid" header reading (`2 flag bytes, (h+2) u16BE words, word 0 unresolved,
> rows at 0x14 + 2(h+2)`) was off by one field. The layout below is read off the loader at 0x2332; the row table is
> u16**LE** at 0x17 (so the first row byte lands at 0x17 + 2H, which is what the old formula happened to hit).
> The "solid block or open" cell hypothesis is replaced by the cell byte below.

**Loader** 0x2332 (state 2 of the main loop 0x1c28; dungeons are state 4, 0x1cb2): map index 0x268d8 -> 0x9634, then

| Offset | Meaning | Consumer |
|---|---|---|
| 0x10 / 0x11 | width W / height H | 0x28c32 / 0x28c33 |
| 0x12 | bit 0 random encounters (1/32 per step), bit 1 coordinates wrap (else the edge stops the party) | 0x2464, 0x28c34 -> 0x2cec / 0x25ec |
| 0x13 | monster set | 0x97d2 |
| 0x14 | bits 6-7 wall-art file `DATA 0x20698[v]` (0 wildwal.grp, 1/2 skara.grp, 3 gdung.grp); bits 0-2 encounter level | 0x9754, 0x26947 |
| 0x15 | u16LE special-square list (same `count + [y][x][u16LE script]` layout as the dungeons, matched every step by 0xe9b6; y = 0x7f any row, x = 0xff any column, y bit 7 = only the other pass) | 0x24a6 |
| 0x17 | u16LE[H] row offsets, row 0 stored last; **cell = 1 byte** at row[y] + x | 0x23ea, 0x2cec |

Shipped values: Wilderness/Arboria/Gelidia/Lucencia/Nowhere/Dark Copse use wildwal.grp and wrap; Skara Brae, Ciera
Brannia, Celaria Bree and Black Scar use skara.grp and are bounded.

**Cell byte**: low nibble = art piece (0 none; n -> piece n-1); high nibble = function. Passability 0x2736: high
0 -> passable (whatever the piece -- the wilderness `0x04` trees and Gelidia's `0x04` are walk-through), 0xe -> solid,
0xf -> passable special (9 of the 11 dungeon exits sit on `0xf?` cells: the entrances), 1..9 -> passable only with
piece 0. High 1..9 is a building entered from the front (0x2780 jump table): 1 Camp (0x4e62, "Thou art in the Camp of
Skara Brae"), 2 tavern 0x5468, 3 temple 0x5c00, 4 empty building 0x65a6 (1/4 encounter), 5 none, 6 storage building
0x6626, 7 guild elder / review 0x177b0, 8 hall of wizards 0x19312, 9 Bard's Hall 0x1b37c; every handler ends with the
U-turn 0xcd58.

**Movement** (0x257c / 0x259c): position = row 0x268de, column 0x268e0 (so the special list's [y][x] is [row][col]);
forward = row - `DATA 0x20aa2[f]`, column + `DATA 0x20aaa[f]` (N = +row, E = +col, the dungeon frame). The 0x4800 key
only checks 0x2736 on the cell ahead; the 0x4b / 0x4c00 commands run the building handler first (0x2780). Turns
0x4b00 / 0x4d00 / 0x5000 as in the dungeon. Opcode 3 (0xcff2) in a city: target bit 7 = dungeon index, else city
map (in a dungeon it is the other way round). New game (0x2dda): map 0 (Wilderness), row 11, column 15, facing N.
Orientation check: all 16 dungeon exits + city teleport arrivals land on passable cells (mirrored rows: 10/16).

**View** 0x287e: 21 view cells per facing (`DATA 0x20b5a` -> 4 x 21 (dcol, drow)); the 112x88 buffer is cleared to
byte 0xbb for 0xa10 bytes (sky, colour 11) and 0x44 for 0x930 bytes (ground, colour 4) (immediates at 0x28fc / 0x2900,
lengths in 0x1d040); then 17 draw steps, far to near: view cell `DATA 0x20c21[s]`, slot `DATA 0x20f33[s]` (slots
30-34, 42/43, 45-47, 54-58, 59/60 of the shared 61-slot geometry, §4; the dungeon's enable table is not consulted),
piece = cell & 15 drawn by the same 0x9b92 with a 20-byte directory limit (entries slotGrp/2 + 2(piece-1)). No
ceiling/floor bitmaps, no light level. **Palette**: DATA 0x20868 by day, DATA 0x208c8 by night (flag 0x28c36 = hour
0x2693c < 6 or > 18, 0x35e2 / 0x728a). Art: wildwal.grp = tree (side + front), 2 more front-only pieces, and the
65x55 Camp tent (piece 4, the Wilderness `0x15` square); skara.grp = 4 half-timbered house facades (side + front).
**BT1/BT2's `big_city` model is not involved**: BT3 has no `big_city`/`citys` bank; its towns are drawn from GRP
pieces through the same slot geometry as its dungeons.

Extractor `tools/bardstale3/amiga/export-city.ts` -> `public/assets/bardstale3/amiga/data/city/`; logic
`tools/bardstale3/amiga/city.ts`; frames `tools/bardstale3/amiga/render-city-frames.ts` ->
`build/cache/bardstale3/walker-frames/city*.png`.

## 6. Open

See `docs/bardstale3/TODO.md`.

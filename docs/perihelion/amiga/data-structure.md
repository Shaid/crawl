# Perihelion: The Prophecy (Amiga) — data structure

Recon 2026-11-21 (re-recon). Nothing here is decoded by a committed extractor yet; confidence labels are per claim.

## Title / version

| | |
|---|---|
| Game | Perihelion: The Prophecy, Morbid Visions (Sweden) / Psygnosis, 1993, Amiga OCS, 4 disks, 1 MB chip |
| Media | **WHDLoad install** (Dark Angel & Wepl, slave V1.3/1.4 2009), not disk images. Retail files live at `data/perihelion/amiga/`, game files under `PerihelionData/` |
| `Perihelion.Slave` | sha1 `6cac8e50c9d01c8c7b40fedd73bb4390742b69af` |
| `PerihelionData/Boot.Exe` | sha1 `792717e8b6d9d975006f7f1ea8be7f12e844ca5b` — the game's own boot loader (strings: "please wait ... loading prophecy-sequence / intro-sequence / game") |
| `PerihelionData/Table.Dat` | sha1 `63d156ffc5dde0a1f9485a066a21493df73bc944` — on-disk file directory (below) |
| main program `000316B00105D570` | sha1 `536556e619ff07421625bbd7fe50e3851bed349e` |
| intro bank `010100060106A60E` | sha1 `10116e1e4052592d0e6ded2531590edada19ae95` |
| `01640A960105970A` | sha1 `17b6f2a79617455ceda34cc976ba1afac80ce03a` |
| `014613080102D68E` | sha1 `d58a2ba1eb5ac2fc93d285a2e635954313082a84` |
| `004515BC0101CCBE` (map.wind) | sha1 `f699865f411ad756a4614b28f7baa8246975179a` |
| wall atlas `023808FC01009834` | sha1 `d6b2cf9d1771b7b476f4785ae9612c52b1f33c09` |

`Docs/` holds 1994 fan material (BeeBuB / The Beer Connection): plain-text briefings plus four **ILBM 640×256×3bpp hand-drawn level maps**
(`CityOfMidlight`, `SecurityZone`, `WatchtowerColony1`, `WatchtowerColony2`, ByteRun1) — a ground-truth oracle for dungeon grids (see § Dungeon maps).

## Game shape (answers the walker questions)

Perihelion has **two exploration modes**, both confirmed from the data:

1. **Overhead tile maps** (outdoor/city locations): 40×40 cells of 16×16 tiles, plus a parallel 40×40 passability layer. **rendered + structural invariant** (§ Overhead maps).
2. **First-person dungeons** (`inside.*` locations — colony, mine, farm, tower): drawn by blitting pre-drawn wall pieces (front faces at several depths, slanted side walls, doors, ladders, ceiling/floor) from one 352×364 atlas per dungeon. **rendered** (§ Wall atlases). The slot/rectangle table that places them is not located yet.

Walker Q1 (wall storage) — **answered 2026-11-21: type-derived, one byte per cell** (§ First-person dungeons). Original recon text: the dungeon grid is **not located with certainty**. The fan maps draw dungeons as block maps (corridor squares vs solid), and a candidate ~4 KB region of 0/1 cells sits in the main program (§ Dungeon maps), which points to **type-derived** (solid/open cell) storage. That is a **hypothesis**. The overhead maps' passability layer is per-cell 0/1/2, confirmed by structure.
Walker Q2 (view drawing): **frustum/slot blits from a per-dungeon piece atlas**, like Black Crypt / EOB. The atlas is **rendered**; the slot table is still open.

## File naming scheme — SOLVED (confirmed)

Every file in `PerihelionData/` except `Boot.Exe`, `Table.Dat` and `SaveDisk.Dat` is named by the **8-byte `Table.Dat` record that describes it, printed as 16 hex digits**. The slave carries the template string `aabbccccdddddddd`.

| Bytes | Field | Notes |
|---|---|---|
| `aa` | disk 0–3 | 4 original disks |
| `bb` | track | custom track, ≤0x1880 B (`Table.Dat` is itself 6,272 = 0x1880 B) |
| `cccc` | byte offset inside the track | max seen 0x1874 |
| `dd` | type | 0 = stored raw, 1 = packed on disk, 2 = writable/save area (file absent) |
| `dddddd` | length on disk | type 0: equals the HD file size (5/5); type 1: **packed** length (HD file is larger, ratio 1.03–9.3) |

**`Table.Dat`**: `"PHLN"` + 2 bytes `0000` + **99 × 8-byte records** at file+0x06..0x31E, then `0xFF` fill containing a few cleared bits (`FB`/`7F`/`FE`/`BF`; likely the disk block-allocation bitmap, **hypothesis**), zeros from 0xFFC.
96 records map 1:1 to the 96 hex-named files (0 orphans either way). The 3 type-2 records (`004015A002007A9C`, `01460B9402000774`, `019E14A002000228`, i.e. 31,388 / 1,908 / 552 B) have no file; they are presumably save-game areas that the slave redirects to `SaveDisk.Dat` (6,492 B of `0xDD`). **hypothesis**

**The HD files are already depacked.** The installer decrunched every type-1 file, so there is no codec to crack for them. Evidence: 14 of the 15 ProTracker modules close exactly (`1084 + patterns×1024 + Σ sample bytes == file size`). The 15th, `map.wind`, has data appended (below). The one exception is `005810FA00005344` (type 0, 21,316 B, entropy 7.53): it carries its own header `0000 9C40 0000 5343` (unpacked 40,000 = 320×200×5 planes, packed 21,315), so it is a **self-packed full-screen picture** and needs the game's decruncher (probably in `Boot.Exe`).

## Inventory by family

Offsets are file-relative. "Disk/track" come from the name.

| Family | Files | Size | Status | Role |
|---|---|---|---|---|
| ProTracker MODs (`M.K.`) | 15 (`map.wind`, `over.positive`, `over.negativ2`, `event.{city,village,mine,farm,tower,steelfortress}`, `innercity`, `inside.{colony,mine,farm,tower,vulkan}`) | 32–198 KB | **confirmed** standard (14/15 size closure) | music per location type; `@seer-project/tracker` |
| IFF 8SVX | 5 standalone (`0237…`, `0244…`, `0250…`, `025E…`, `0321…`) + 8 inside the main program | 5–8 KB | **confirmed** standard | one ambient/sfx sample per dungeon group; `@seer-project/iff` |
| IFF ANIM | `034117D2…` (174 KB), `035C178C…` (86 KB), 4 inside the intro bank | | standard | cut-scenes |
| Intro bank | `010100060106A60E` (520 KB) | | `JMP $0F9B60` + 7 ILBM + 4 ANIM (96% IFF coverage) + code at the tail | intro/prophecy sequence |
| Main program | `000316B00105D570` (520 KB, disk 0) | | `JMP $0B7454` at +0; 8 8SVX + 3 ILBM (two 112×150×5 with 32-entry CMAPs, one 1120×75×1 font strip) in the first ~0x35000 B, 68k code ≈ +0x60000…+0x7FFFF, game text ("SECURITY PASSWAY", "MIDLIGHT I.S.") | engine + dungeon data candidates |
| `01640A960105970A` | 405 KB, disk 1 | | high entropy (~7), `JMP $073536`, code only at the tail | likely the packed "prophecy-sequence" / second program; **hypothesis** |
| **Portraits / document pictures** | 28 × 10,500 B (`025F…`–`0275…`, `0322…`–`0328…`) | | **rendered**: 112×150, 5 planes, **row-interleaved** (14 B/plane-row, 70 B/row) | NPC talk portraits + in-game documents |
| **Location pictures** | 6 × 19,500 B (`0201…`, `020C…`, `0215…`, `021F…`, `0301…`, `030A…`) | | **rendered**: 240×130, 5 planes, row-interleaved (30 B/plane-row) | establishing shots (city skyline, fortress, forest, ruins, tower, cave) |
| **Wall atlases** | 4 × 80,080 B (`0238…`, `0246…`, `0252…`, `0314…`) | | **rendered**: 352×364, 5 planes, row-interleaved (44 B/plane-row, 220 B/row) | first-person piece sheets, one per `inside.*` dungeon (§ Wall atlases) |
| **Overhead tilesets** | 6 (`0281…` 24,000; `02830E0A` 16,960; `02850F1C` 15,680; `02870728` 16,000; `033405CE` 16,160; `03360514` 20,960) | | **confirmed (structural)**: N × 160 B, 16×16×5 planes row-interleaved | tile graphics for the overhead maps |
| **Overhead maps** | 16 × 3,200 B | | **confirmed (structural)**: 2 × 40×40 bytes | § Overhead maps |
| SFX bank | `0277022E…` ≡ `032915BA…` (byte-identical, 89,040 B, disks 2+3) | | structured-unknown; name strings `gun.doomos.1`, `gun.single.shot`, `magicchip`, `csapas.1` | combat sound bank |
| `map.wind` tail | `004515BC…` +8,758 → EOF (188,986 B) | | structured-unknown; bitplane-like, 4-byte periodicity | overworld map / UI graphics appended after a 1-pattern MOD |
| `014613080102D68E` | 249,804 B, disk 1 | | structured-unknown; first 0x5600 B are words with low byte 0; contains "intro.perihelion", "three gods rule the universe" | intro text + font/graphics; **hypothesis** |
| `00770EA40100BAE8` | 66,120 B, disk 0 | | structured-unknown; row stride 180 suggests 288-px-wide 5-plane interleaved art | UI/sprite bank; **hypothesis** |
| `022917F60100D8A0` | 93,600 B, disk 2 | | structured-unknown, entropy 4.9 | sprites (monsters?) **hypothesis** |
| `0002000001002F30` | 17,610 B, disk 0 track 2 | | bitmap rows at 70-byte stride, then raw signed PCM from ~+0x4200 | boot-time graphics + sample |
| `005810FA00005344` | 21,316 B | | self-packed (see above) | 320×200×5 picture (title?) |

### Overhead maps (confirmed, structural)

Each 3,200 B file holds two 40×40 byte planes:
- **plane 0** (`+0x000`): tile index into a tileset. Indices are assigned in first-appearance order (0,1,2,3 … reading row-major), the signature of a tool that de-duplicated a painted picture into tiles.
- **plane 1** (`+0x640`): passability, values `0`/`1` (one map, `028905DA…`, also has two cells of `2`).

**Map → tileset pairing**: disk order puts each tileset file before its maps. In every group, the maps' largest tile index is below the tileset's tile count, and the last map of each group uses **exactly** `count−1`. 16/16 maps fit, 6/6 groups:

| Tileset (tiles) | Maps (max index) |
|---|---|
| `02810AC2` (150) | `02830A9E` (149) |
| `02830E0A` (106) | `02850774` (91), `02850A2A` (102), `02850CE8` (105) |
| `02850F1C` (98) | `02861518` (55), `02861770` (67), `0287015A` (93), `02870512` (97) |
| `02870728` (100) | `02890182` (74), `02890414` (84), `028905DA` (90), `0289084A` (99) |
| `033405CE` (101) | `0335166E` (83), `0336002A` (88), `03360286` (100) |
| `03360514` (131) | `0338020A` (130) |

Composing `02830A9E` from `02810AC2` gives a coherent 640×640 town (buildings, windows, streets). Pixel continuity across horizontal tile seams is 0.590 against a 0.349 shuffled-tile null; `02850CE8` gives 0.648 against 0.347. **Palette not found** (greyscale only).
The passability plane, viewed on its own, is a clean corridor layout matching the tile art.

### Wall atlases (rendered)

The 80,080 B files are 352×364, 5 planes, row-interleaved (byte autocorrelation peaks at 44 and 176). Rendered greyscale, the sheet shows: ceiling+floor panorama, slanted side-wall strips at 3–4 depths, front walls at 3 depths, a dark doorway, doors, ladder walls, a hatch/radiation-symbol door, and a panel at 2 sizes. This is the classic slot-blit first-person kit.
Each atlas sits on disk directly before its dungeon's MOD and 8SVX: `0237` 8SVX → `0238` atlas → `023E` `inside.colony`; `0244` → `0246` → `024B` `inside.mine`; `0250` → `0252` → `0258` `inside.farm`; `0321`/`0314` → `031B` `inside.tower`. `inside.vulkan` has no atlas; it sits with the overhead group `03360514`/`0338020A`.
Open: the piece rectangles and screen positions (a table in the main program), and the palette.

### Dungeon maps (superseded — see § First-person dungeons)

> **Correction (2026-11-21):** solved. The span at file +0x72D80… is the five dungeon grids back to back (one byte per cell), located through the map loader's own table; the "several maps of different widths" reading was right, the widths are 20/32/30/20/30. The ~0x370 bytes after grid 5 are door-lock and event tables, not map. Details in § First-person dungeons below.


No per-dungeon map file exists on disk, so the grids must live inside a program image.
**Lead**: main program `000316B00105D570` file+0x72D80…+0x73DC0 (~4 KB) holds almost only values 0/1 (≈1,580 ones / 1,380 zeros), with a few 2–6 and isolated larger codes. Local row-period estimates change along the span (20/40 near +0x72D80, 64 around +0x73080–0x73380, 60 near +0x73A80, 12 at the end), so it is **several maps of different widths**, not one 64×64 grid; a forced 64-wide render is not coherent. A small record table precedes it at +0x72C20…+0x72D4A (`0001 0005 … 012C 003C`, then `0100 0200 0300 330F 3A0F …`).
Oracle: the fan maps in `Docs/` (block-style corridors) and `SecurityZone`'s one-way-arrow cells.

#### Paths tried

| Approach | Result | Why it isn't enough |
|---|---|---|
| Small-alphabet 2-D autocorrelation scan (2 KB windows, widths 8–128) over the 6 large non-IFF files | Only the main-program +0x72D80 span reads as a grid; `014613080102D68E` hits are word-padded bitmap data | finds the region, not the per-map header/width |
| Forced 62–66-wide renders of the span | slanted/incoherent | the span holds several maps of different widths |

## Palettes

> **Correction (2026-11-21):** the in-game palette is found: 32 `$0RGB` words at runtime `$E7BDE` (file +0x67BDE), faded into the copper list by `$B7344`. See § First-person dungeons → Palette. The notes below predate that.


Only ILBM `CMAP`s are known so far: the two 112×150 pictures in the main program (+0x32A9A, +0x33AFE; 32 entries each, same size as the 10,500 B portraits) and the intro-bank ILBMs. Palettes for tiles, walls and pictures are presumably word tables in the main program. Not searched yet.

## First-person dungeons (decoded 2026-11-21)

Source: the main program `000316B00105D570`, disassembled with capstone (linear sweep + targeted decodes).
Extractor: `tools/perihelion/amiga/export-walker.ts` (readers in `exe.ts`, view port in `view-model.ts`); walker `tools/walker/games-perihelion.ts`.

### Load address — confirmed

The main program is an absolute image loaded at **`$80000`**: the slave's last instruction is `JMP $80000`, and the image's own `JMP $0B7454` (file +0) lands on `MOVE.L #$B74D8,$80 / TRAP #0` (file +0x37454), whose supervisor code continues cleanly at `$B74D8`. File offset = address − `$80000` for everything below. `$EE27C` is the file loader (`A0` = buffer, `D0` = **Table.Dat record index**); the slave patches it.

### Dungeon set-up — confirmed

`$F2C1E` = dungeon number 1..5. `$BED5A` loads three files per dungeon from long tables (Table.Dat record indices):

| Dungeon | Atlas (`$BEDD6`) → `$25FB0` | Music (`$BEDEA`) | 8SVX (`$BEDFE`) → `$44D58` | Grid | Start x,y,facing (`$BEE48/52/5C`) |
|---|---|---|---|---|---|
| 1 | 0x14 `022917F6` (416×360) | 0x15 `innercity` | 0x16 `0237…` | 20×20 @ `$F2E14` | 10,1,0 |
| 2 | 0x17 `023808FC` (352×364) | 0x18 `inside.colony` | 0x19 | 32×44 @ `$F2FA4` | 6,39,2 |
| 3 | 0x1A `0246003C` | 0x1B `inside.mine` | 0x1C | 30×27 @ `$F3524` | 1,22,2 |
| 4 | 0x1D `02520184` | 0x1E `inside.farm` | 0x1F | 20×22 @ `$F384E` | 1,17,2 |
| 5 | 0x4E `03141714` | 0x4F `inside.tower` | 0x50 | 30×32 @ `$F3A06` | 23,27,2 |

> **Correction (2026-11-21):** `022917F6…` (93,600 B, "sprites?") is dungeon 1's view atlas, 416×360×5 row-interleaved (260 B/row, the stride of the `$C3332` blitter). Dungeon 1 is the inner city (street views, opaque panels), not an `inside.*` dungeon.

`$C4B22` copies one column of the table at `$C4B8C` into the live struct `$C4C86`: word = grid width (the `MULU $C4C86` row stride of every map access), then 11 lists of 5 longs (`$C4C88` grid pointer; `$C4C94` music/ambient zones; `$C4C98` door-lock table, 12-B records; `$C4CA0` teleport/ladder table; others are event lists — not decoded). Grid heights follow from the pointer spacing (grid 5 ends where list `$C4C98`[0] = `$F3DC6` begins): 400, 1,408, 810, 440, 960 bytes, each an exact multiple of its width. Every start cell is 0 with the exit (6) behind it.

### Cell values — confirmed from the move/use handlers

| Value | Meaning | Evidence |
|---|---|---|
| 0 | floor | |
| 1 | wall | blocks (`$BCF94`); drawn as wall in every slot |
| 2 | closed door | blocks; use-command (`$BD30A`, command 5) on the cell ahead sets it to 3 after the `$C4C98` lock check |
| 3 | open door | passable; use sets it back to 2. Dungeon 1: a building doorway — standing on it, w/a/d do nothing, s returns to the previous square (`$BD08A`), the view is one full interior picture (`$C3960`) |
| 4, 5 | ladder / hatch walls (two variants) | block only in dungeon 4 (`$BCFA4`); door frame + piece 20/21 |
| 6 | exit | stepping on it opens the leave prompt `$BDF52` (n → back to the dungeon start, y → overworld) |

### Movement — confirmed

Facing `$F2C0E`: 0 = +y, 1 = −x, 2 = −y, 3 = +x (step routines `$C2688..$C2694`). Keys (`$BCE8A`): w forward, s back, a/d strafe (`$C2640` with relative 0/2/3/1, direction = facing + rel), q = facing−1 (`$C21DA`), e = facing+1 (`$C2202`). With y growing downwards that is 0 S, 1 W, 2 N, 3 E (turning right from S gives W). Previous position is kept in `$F2C08/$F2C0C`.

### View window and composers — confirmed

`$C26B2` copies the 7×7 cells around the party into `$C28D2`, rotated per facing (four copy loops `$C26F4/$C271C/$C2758/$C2786`), returning A0 = `$C28EA` (the party cell): **window +7 = one forward, +1 = one to the left**.
`$C2A2E` clears the view buffer `$1BAE8` (432×120, 54 B × 5 interleaved planes per line; the 176-px view starts 16 bytes in at `$1BAF8`), sets the checkerboard parity `$C3426 = (x ^ y ^ facing) & 1`, then:

- **far composer `$C2A94` (dungeons 2–5)** — background piece 0 (176×120 floor+ceiling) mirrored when parity = 0; cells two aside on rows 3/2; then 15 slot bytes `$C2F90..$C2F9E` gathered from rows 0–3 with occlusion (a wall one ahead stops rows 2–3; per side only the nearest of rows 1/2/3 gets a front face), drawn far to near. Each (slot, value) calls a leaf routine that sets piece `$C3420`, destination `$C3422`, mirror `$C3424` (often from the parity) and calls the masked blitter `$C30F4` (colour 0 transparent). Piece table `$C45A4` (25 × {src x bytes, src y, h, w bytes}), destination table `$C466C` (26 × {signed x bytes, y}).
- **near composer `$C2FA0` (dungeon 1)** — three opaque panels (left 48 / centre 80 / right 48 px) from rows 0–2 via `$C3332`; piece table `$C397E` (19), destinations `$C3A16` (5).

The extractor decodes every leaf (74, both parities) straight from the code and refuses any instruction outside the known leaf shape; the closed-door leaves (`$C3F3C` …) also contain a raw blitter copy that saves the doorway behind the door (`$1C9C0` → `$1763C`, for the opening animation) which draws nothing into the view and is stepped over.

### Palette — confirmed (as the in-game screen palette)

`$E7BDE`: 32 words, `000 FFF FED EDC … 210` (warm grey ramp) + `FEC … 310` (amber ramp). Faded into the copper list's COLOR00–31 (`$7D8DC`) by `$B7344` at game start (`$B768C`) and after interludes (`$C0E74`); the copper list has no mid-screen colour changes and no dungeon code loads another palette. Renders of all 5 atlases and an overhead town (`02830A9E` with tileset `02810AC2`) are coherent with it. `$E7B9E` is the title variant (pure grey ramp), `$E7B5E`/`$E7C1E` all-black / all-white fade targets.

### In-game checks (for the user; x/y = grid column/row, y grows southwards; game facing 0 = S, 1 = W, 2 = N, 3 = E)

1. Dungeon 2 (`inside.colony`) start (6,39) facing N: corridor walls both sides on the near square, then a wider room; turn round (S): a closed door with a red glyph, centred, filling the front-wall frame.
2. Dungeon 3 (`inside.mine`) start (1,22) facing N: straight corridor, walls on both sides for three squares, gravel floor, black beyond.
3. Dungeon 4 (`inside.farm`) at (2,14) facing W: a metal hatch/ladder wall directly ahead.
4. Dungeon 1 (`innercity`) start (10,1) facing S: a street running away between building fronts; facing W from the same square: a building front filling the view.
5. Step forward one square anywhere: the floor/ceiling texture and wall bricks should flip left-right (the parity mirror).

Frames rendered for these: `build/cache/perihelion/walker-frames/` (`npx tsx tools/perihelion/amiga/render-frames.ts`).

### Open

The door-lock records (`$C4C98` list), teleport/ladder records (`$C4CA0`), event/zone lists, and what the overhead 40×40 maps connect to are not decoded. See `docs/perihelion/TODO.md`.

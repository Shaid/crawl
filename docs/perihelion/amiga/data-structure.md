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

Walker Q1 (wall storage): the dungeon grid is **not located with certainty**. The fan maps draw dungeons as block maps (corridor squares vs solid), and a candidate ~4 KB region of 0/1 cells sits in the main program (§ Dungeon maps), which points to **type-derived** (solid/open cell) storage. That is a **hypothesis**. The overhead maps' passability layer is per-cell 0/1/2, confirmed by structure.
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

### Dungeon maps (open — hypothesis)

No per-dungeon map file exists on disk, so the grids must live inside a program image.
**Lead**: main program `000316B00105D570` file+0x72D80…+0x73DC0 (~4 KB) holds almost only values 0/1 (≈1,580 ones / 1,380 zeros), with a few 2–6 and isolated larger codes. Local row-period estimates change along the span (20/40 near +0x72D80, 64 around +0x73080–0x73380, 60 near +0x73A80, 12 at the end), so it is **several maps of different widths**, not one 64×64 grid; a forced 64-wide render is not coherent. A small record table precedes it at +0x72C20…+0x72D4A (`0001 0005 … 012C 003C`, then `0100 0200 0300 330F 3A0F …`).
Oracle: the fan maps in `Docs/` (block-style corridors) and `SecurityZone`'s one-way-arrow cells.

#### Paths tried

| Approach | Result | Why it isn't enough |
|---|---|---|
| Small-alphabet 2-D autocorrelation scan (2 KB windows, widths 8–128) over the 6 large non-IFF files | Only the main-program +0x72D80 span reads as a grid; `014613080102D68E` hits are word-padded bitmap data | finds the region, not the per-map header/width |
| Forced 62–66-wide renders of the span | slanted/incoherent | the span holds several maps of different widths |

## Palettes (open)

Only ILBM `CMAP`s are known so far: the two 112×150 pictures in the main program (+0x32A9A, +0x33AFE; 32 entries each, same size as the 10,500 B portraits) and the intro-bank ILBMs. Palettes for tiles, walls and pictures are presumably word tables in the main program. Not searched yet.

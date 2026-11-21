# Abandoned Places: A Time for Heroes (Amiga) — data structure

Recon, 2026-11-21. Retail files stay where they are, at
`data/abandonedplaces/amiga/`. All file offsets below are **byte offsets into
the `Disk.N` image file**, unless a line says otherwise.

This doc also holds the **ArtGame kernel container + packer spec** (§2–§3). Abandoned
Places 2 uses the same container and packer:
`docs/abandonedplaces2/amiga/data-structure.md` points here, so this is the only
copy.

## 0. Identification

| Item | Value |
|---|---|
| Title | Abandoned Places: A Time for Heroes (EN; the WHDLoad ReadMe says DE was tested too) |
| Developer / publisher | ArtGame (Hungary) / Electronic Zoo, 1992 |
| Engine | **ArtKernal V1.1** ("Developed & (C)by Steve Fabian", string at `Disk.1+0x554`). It is a bootblock-launched trackloader kernel with its own file directory |
| Media | WHDLoad install by Wepl (slave v1.3, 1998). `Disk.1`–`Disk.5` are **DIC sector images**, 901,120 B each. They are *not* AmigaDOS volumes: only `Disk.1` has a `DOS\0` bootblock, and no disk has a root block at 880 |
| Manual (naming oracle) | `~/Development/amigadocs/game-manuals/Abandoned Places - A Time for Heroes (1992)(Electronic Zoo)[1000].pdf` (+ DE edition `[0999]`) |

| File | Size | sha1 |
|---|---|---|
| `Disk.1` | 901,120 | `c455a6e7453eb741d08d29106434f41b995c946e` |
| `Disk.2` | 901,120 | `386ec2a3b5f294f5a00f45f16210bbc0b363f48b` |
| `Disk.3` | 901,120 | `2e9d37ba1bc774e91fc76f242d0979ac215fa78c` |
| `Disk.4` | 901,120 | `986d40f284ee430823e136e3a219d992bb18eb8f` |
| `Disk.5` | 901,120 | `48d327095de60797253b751df0db2daee067501c` |
| `AbandonedPlaces.slave` | 3,344 | `86ad177fc24270580b9da6bb53f0f7cfc72f73e7` |
| unpacked `code` (dir sec 1) | 68,380 | `ac0b3859b4b55676e6d6888619a16214f5658d5b` |
| unpacked `module` (dir sec 2) | 120,104 | `f98f69e86acdb4f4c27ab1749d5ee40a5f6ce698` |
| unpacked `dungeon1`/`2`/`3` | 131,072 each | `b97c7fa5…`, `10c312be…`, `c1d1bfae…` |

## 1. Disk layout — **confirmed** (structural)

| Disk offset | Content | Confidence |
|---|---|---|
| `Disk.1+0x000` | Bootblock (`DOS\0`, "BOOT BY ARTGAME...") | confirmed |
| `Disk.N+0x400` | 4-byte disk tag `AP1n` (n = `0`–`4` for Disk.1–5) | confirmed 5/5 |
| `Disk.1+0x404` | Kernel: a HUNK_HEADER whose `0x3F3` magic is replaced by the tag (1 hunk, `0x1452` longs = 20,808 B of code; the code body starts at `Disk.1+0x420`) | rendered |
| `Disk.1+0x5800`–`0x90C8` | **File directory** (§2). The kernel reads it as the file `"DIRECTORY OF AP1"` (string at `Disk.1+0x1164`) | confirmed |
| `Disk.1+0x9800`… / `Disk.2–5+0x404`… | File bodies, packed back to back | confirmed |
| sectors filled with `DOS DOS!DOS"…` | Unused filler (11 sectors on Disk.2, 2 each on Disk.3/4) | hypothesis |

`Disk.3` and `Disk.4` share 611 identical 512-B sectors. That is expected, because the
directory places several identical files on more than one disk (`smpl.effect`,
`mdat.effect`, `block1.1`).

## 2. ArtGame kernel directory (shared with AP2) — **confirmed**

The directory is a list of 32-byte big-endian records. A 2-byte `0000` separator
starts each new disk section.

| Offset | Size | Field | Notes |
|---|---|---|---|
| +0x00 | 16 | name | ASCII, NUL-padded (e.g. `bpl.city0`, `monster26`, `ABIC.CASTLE`) |
| +0x10 | 4 | offset | Byte offset into **that section's disk image** |
| +0x14 | 4 | stored size | |
| +0x18 | 4 | unpacked size | Equals the stored size when not packed |
| +0x1C | 2 | packed flag | `1` = ArtGame packer (§3), `0` = stored |
| +0x1E | 2 | group | AP1: 0–9. It looks like a load/purge class (9 = intro/cut-scene `ABIC.*`, 1 = wallset art, 2 = monsters/walls/stairs, 4/5 = TFMX audio). Hypothesis. AP2 has 0 in every record |

AP1 has **454 records in 5 sections** (90 / 96 / 76 / 92 / 100). Section *k* is
`Disk.(k+1)`. Every section is contiguous: each `offset` equals the previous
`offset + stored`, with 0 breaks. Each section's last byte falls inside its disk.
Sections 1–4 start at `+1028` (= 0x404, just after the tag). Section 0 starts at
`0x9800` (38,912), after the kernel and the directory.

**Verification:** every one of the 427 packed records unpacks with checksum 0, input
fully consumed and output size exact (§3). The 27 stored records have
stored = unpacked. This is 454/454, which only works if the offsets are disk-image
byte offsets and the section-to-disk mapping is right.

## 3. ArtGame packer (shared with AP2) — **confirmed**

**Reader:** `AP2` kernel hunk 0 `+0x22BE` (`LAB_01C2` in an IRA dump of
`data/abandonedplaces2/amiga/data/AP2`; file offset `+0x22E6`). AP1's kernel
has an older implementation of the same grammar at about `Disk.1+0xA20` (a dispatch
on `D3>>3` through a byte table, without the Duff's-device copy). This is a
**backward** byte-oriented LZ: it reads from the end of the packed data and writes
from the end of the output.

**Trailer** (last 4 bytes of the stored data): `chk`, then the unpacked size as a
24-bit **little-endian-ordered** value (`size = b[n-1]<<16 | b[n-2]<<8 | b[n-3]`).
`chk` is XORed with every control byte. A valid stream ends with `chk == 0` (the
kernel otherwise returns 0 = failure).

**Loop:** peek the next control byte `c` and up to 3 operand bytes `d4 d5 d6`. Read
them backward, from just below the current source pointer, after any pending
literals. Select the handler with `c>>3`:

| `c` | consumes | match length | distance−1 | literals after the match |
|---|---|---|---|---|
| `00–1F` | 1 | — | — | `(c&0x1F)+1` |
| `20–3F` | 2 | — | — | `((c&0x1F)<<8 \| d4) + 0x21` |
| `40–5F` | 2 | `((c>>2)&7)+3` | `(c&3)<<8 \| d4` | 0 |
| `60–6F` | 1 | 2 | `c&0xF` | 0 |
| `70–77` | 3 | `(c&7) + (d4&0x80 ? 12 : 4)` | `(d4&0x7F)<<8 \| d5` | 0 |
| `78–7F` | 4 | `((c&7)<<8 \| d4) + 5` | `d5<<8 \| d6` | 0 |
| `80–BF` | 2 | `((c>>2)&3)+3` | `(c&3)<<8 \| d4` | `((c>>4)&3)+1` |
| `C0–FF` | 3 | `((c&3) \| ((d4&0xC0)>>4)) + 4` | `(d4&0x3F)<<8 \| d5` | `((c>>2)&0xF)+1` |

The match is copied first, `out[p] = out[p + dist]` with the output written
downward, and then the literals, copied byte by byte downward from the source. The
loop stops when the output pointer reaches the start of the buffer.

> **Committed (2026-11-21):** `tools/shared/artgame-kernel.ts` (`parseArtDirectory`,
> `unpackArtGame`, `unpackArtGameStrict`, `loadArtVolume`), test
> `tools/shared/__tests__/artgame-kernel.test.ts`, CLI `tools/abandonedplaces/unpack.ts`
> (→ `build/cache/<game>/`: AP1 443 files / 8.7 MB, AP2 593 files / 5.9 MB; the 11 AP1
> names repeated across disks are byte-identical). AP1's directory is parsed from
> `Disk.1+0x5800` up to `0x9800`; AP2's `ap2.dir` starts with a record (no leading
> separator); AP2 section 4 (save files) has no shipped image and is skipped.
> AP2 totals: 617 shipped records in sections 0–3 (63/160/194/200). Null controls in the
> test: flipping the first control byte, or dropping the last byte (trailer shift), fails
> every sampled record. (Flipping a *literal* byte is not detectable — chk covers
> control bytes only.)

**Verification:** the port decodes **427/427 AP1 and
262/262 AP2** packed records. Each passes with `chk == 0`, all stored bytes consumed
and output length equal to the directory's unpacked size. Null controls: flipping
one byte gives `chk = 0x55`, and shifting the stream by one byte leaves input
unconsumed; both fail. `ancient` does not recognise the format ("Unknown").

## 4. Inventory by family (unpacked contents)

Sizes are unpacked. "sec" is the directory section, so the disk is sec+1.

| Family | Members | Evidence | Status |
|---|---|---|---|
| Code | `code` (sec1, HUNK 68,380), `module` (sec2, HUNK 120,104, probably the dungeon engine), `intro`/`title`/`start`/`main`/`selection`/`gameover`/`theend`/`templeruins`/`vulcan`/`crown`/`*assem` (small HUNKs; cut-scene players) | `000003F3` at +0 | standard (HUNK) |
| **Dungeon levels** | `dungeon1`/`2`/`3` (sec2, 131,072 each = **12 × 10,916-B level records** + 80 zero bytes), `level_forest1`–`8` (10,916 each) | §5 | structured-unknown |
| Wallset art, per set N = 1–11 | `wallN.M` (12,215), `blockN.M` (18,490), `doorN.M` (9,120), `gateN` (10,040), `stairsN` (42,890), `switchN` (6,550), `buttonN` (1,200), `carpetN.M` (5,595), `cupboardN` (14,470), `backgndN` (13,824 = 192×144×4 planes?), `moduleN` (21,330, unknown — geometry table?) | Headerless (leading zero rows); every member of a family has the same size | structured-unknown |
| Monsters | `monster1`–`38` (22,040 each, spread over sec2–4) | Fixed size | structured-unknown |
| Town / UI | `bpl.city0–12`, `bpl.village0/1`, `bpl.tower0/1`, `bpl.church0–2`, `bpl.graveyard` (25,606 each), `bpl.council`/`herbal`/`pub`/`smith`/`train`/`jewelry`/`shop`/`temple` (12,006 each), `bpl.panel`, `bpl.map` (204,806), `bpl.pergamen`, `bob.*`, `spr.*`, `icon0/1`, `sp0`–`sp20` (10,336), `dat.font*` | `bpl.city0` starts `0480 0014 0080 …` — a small header | structured-unknown |
| Intro/cut-scene images | `ABIC.*` / `abic.*` (77 records, sec0/1/4; many 40,064 = 64 + 40,000 = palette + 320×200×5?) | `ABIC.CHURCHDATA`/`crowndata`/`STARTDAT` = 64-B palettes stored beside the picture | hypothesis |
| Text | `ABIC.TXTTITLE` ("A Time for Heroes"), `ABIC.OLDMANTXT*`, `ABIC.STARTTXT*`, `ABIC.DEATHTXT0` | Plain ASCII once unpacked | standard |
| Music / SFX | `mdat.*` + `smpl.*` pairs (L1–L6, city1–3, outer1/2, part1.x/2.x, Temple, effect, encounter) | `TFMX-SONG ` magic: Chris Hülsbeck TFMX (libxmp/uade play it) | standard |
| Map item | `map` (640 B) | Looks like 8×8 1bpp tiles (automap glyphs) | hypothesis |

## 5. Dungeon level record (10,916 B) — **rendered**

| Offset | Size | Field | Notes |
|---|---|---|---|
| +0 | 2048 | grid | **32 × 32 big-endian words**, row-major. `0x0001` = solid wall square, `0x0000` = open. `0x4000`, `0x2000` and `0x4001` are the only other values seen across all 44 records |
| +2048 | 256 | **4 theme areas x 0x40 B** | **confirmed (2026-11-21), see section 7.** Each area = 17 words: 1-based picks into the per-family file-name lists (`backgnd`, `monster` x2, `module`, `door` x2, `carpet` x2, `cupboard`, `stairs`, `block` x2, `wall`, `switch`, `button`, `gate`, music). A level has up to 4 areas; teleports carry the destination area |
| +2304 (0x900) | 8,612 | 10 object lists | **confirmed (2026-11-21):** records of 0xA/0xE/0xC/0xC/0xA/0x10/0xA/0x40/0x20/0x14 bytes, each list ends with a `0xFFFF` word; the walk lands exactly on 10,916 for 36/36 dungeon levels (loader `module` 0x10D76) |

Evidence:
- All 44 records (36 dungeon + 8 forest) have a fully solid border (124/124 cells).
- Rendering at width 32 gives coherent corridors and rooms. Width 64 shears them.
- The wallset-id ↔ disk split holds for 36/36 dungeon levels.

**Wall model:** type-derived (solid squares, like Dungeon Master). A face is a wall
when the neighbouring square is solid. The `0x4000` cells line room edges and pillar
rows (the `H` runs in renders), so they are probably a per-square decoration or
feature flag (hypothesis).

### Paths tried
| Approach | Result | Why it failed / status |
|---|---|---|
| Word grid at width 64 | Two half-mazes per line | Wrong width; 32 is right |

> **Correction (2026-11-21):** the row "+2048 wallset id" above was a misreading of the first word of the 256-byte
> theme-area header; the hypothesis "second word looks like a start position" is wrong too (the words at +2048 are
> file picks, not coordinates). Section 7 holds the confirmed layout. The cell value set is confirmed as
> `0x0001` solid / `0x2000` illusory / `0x4000` monster-only barrier (the loader masks every stored cell with
> `0x6001`, `module` 0x11290).

## 6. First-person renderer — superseded by section 7

The art is prepared per wallset, per depth and per side (`wallN.1–.4`, `blockN.1–.3`,
`doorN.1/.2`, `carpetN.1/.2`, plus single-file `gateN`/`stairsN`/`switchN`/`buttonN`/
`cupboardN`), over a `backgndN` 192×144 backdrop. AP1 files carry **no geometry
header**, so the slot positions must come from code (`module`) or from the
21,330-byte `moduleN` files. The working assumption is a **slot table** (pre-drawn
bitmaps blitted at fixed positions, like Black Crypt/DM), by analogy with AP2, whose
`.def` files carry the geometry explicitly. Confidence: medium-low until the `module`
reader is traced.

## Open families — paths tried (empty until game-re works them)

| Family | Approach | Result | Notes |
|---|---|---|---|
| wallset art geometry | — | — | |
| `bpl.*` header | — | — | |
| `ABIC.*` pictures | — | — | |
| palettes | — | — | |


## 7. Dungeon renderer (2026-11-21) — from disassembly of `module`

Offsets are **hunk offsets in `module`** (= unpacked file offset − 0x20; absolute operands equal hunk offsets).
Disassembly = r2 linear sweep of the flat image (scratch only). Extractor
`tools/abandonedplaces/amiga/export-walker.ts`, port `view-model.ts`, view `tools/walker/games-abandonedplaces.ts`.
`module` is the dungeon engine (the file names it loads sit at +0x11CE6..+0x12730; lists at 0x11C22 simple /
0x11CE6 themed: `(name-list ptr, destination variable)`).

### 7.1 Theme loading — **confirmed** (structure)
Loader `0x1150A`: per area (d4 = 0..3) reads the 17-word header words in the order of the table at `0x11CE6`:
backgnd, monster1, monster2, **module**, door1, door2, carpet1, carpet2, cupboard, stairs, block1, block2, wall,
switch, button, gate; word 17 picks the music pair. Value = 1-based index into the name list (`word-1`).
`moduleN`/`backgndN` file number = the word (lists are in numeric order).

### 7.2 Art formats — **confirmed** (renders; pieces self-consistent)
| File | Format |
|---|---|
| `moduleN` (21,330 B) | **25 wall pieces**, geometry table in `module`: width bytes/height words at `0xD5DE` (25 x `w,h`), screen x / y at `0xD642` (y gets +4 at draw, 0xD5D4), source offset longs at `0xD6A6`. Each piece = 4 colour planes then 1 mask plane, `w*h` bytes each (blitter 0xD740: minterm 0x0FCA, A = mask, B = planes). The pieces tile the file **exactly** (last ends at 21,330; three pieces share offsets 16570 / 19330). |
| `backgndN` (13,824 B) | **two** 144x96 4-plane images (6,912 B each, plane stride 1,728, 18 B/row): ceiling + floor perspective. Blit 0xDDE4 to screen (32,4); half chosen by table `0xDE96[(x&1)+2*(y&1)+4*facing]` = `((x^y)&1) ^ (facing&1)`. |
| other wall-set files | `wallN.M`/`blockN.M`/`doorN.M`/`stairsN`/`gateN`/`switchN`/`buttonN`/`carpetN.M`/`cupboardN`: **not decoded** (`wallN.M` is NOT the wall; see 7.4) |

Screen = 320x198, 5 planes (plane stride 7,920). View window (32,4)-(176,100): `display1` (4 planes, 31,680 B) shows it empty.
**Palette** (confirmed): one 16-colour table for all sets, the final step of the fade table at `0xDBE4` (16 colours x 16
steps; fade-in routine 0xDBC0 runs steps 0..15): `000 cff 9bb 687 344 520 0d0 080 ff0 f80 465 c02 830 0cf 00f b50`
(Amiga 12-bit). Colours 17..31 (sprites / 5th plane) are the copper-list constants at `0x101A2` and agree on 12 of 15 entries.
Indices 5/8/15 differ between the two tables (`520`/`ff0`/`b50` vs `000`/`dd0`/`d50`); which applies to the 5th plane is untested.

### 7.3 View — **confirmed** (reader) / **rendered** (pixels)
Entry `0xAE3A` (called from the main loop at 0x31C). View = 4 rows x (7,5,3,3) cells = 18 cells; per-facing (dx,dy) signed-byte
tables via pointer table `0xAF54` (facing 0 = north = -y, 1 = east): row -3 x -3..3, row -2 x -2..2, row -1 x -1..1, row 0 x -1..1.
Draw list `0xAFF4`: 41 entries of 2 bytes, far -> near. `byte0 < 0x80`: `(piece, cell-index 1..18)` — piece drawn when the
cell word is solid (`bit0`) or illusory (`bit13` = 0x2000, skipped when flag `0x8ED8` is set); `byte0 = 0xFF`: an *object group*
entry (calls the handler table `0xB046`: wall-mounted objects, doors, monsters, items — not decoded). There are no mirrored pieces:
left and right walls are separate pieces. Out-of-map cells read as 0.
Cell address `0x5DA4`: `base + (y*32 + x)*2` (32 x 32 words). Movement (`0x5C0C`): blocked by runtime flags solid (word bit 0) and
monster (bit 3); bit 7 = teleport record, bit 4 = closed door (`list6.state & 7 < 2`). `0x2000` and `0x4000` do **not** block the
party; monsters are blocked by `0x4000` always and by `0x2000` unless the monster flag `0x16(a0)&0x10` (0x6890).
Move tables `0xAD62/72/82/92` = forward / strafe right / back / strafe left, `(dx,dy)` per facing N,E,S,W; turn left = facing-1 (0x5BC0).
Pose variables: x `0x1072E`, y `0x10730`, facing `0x10732`.

### 7.4 Object lists (level +0x900) — partly decoded
| List | Record | Runtime flag set (0x112A0..) | Notes |
|---|---|---|---|
| 0 | 0xA | low byte bit 6 | wall-mounted objects (`x@2 y@4 side@6 slot@7`), art from `item` (54 x 1,330 B) via table `0xB349` |
| 1 | 0xE | low bit 5 | ? |
| 2 | 0xC | high bit 1 | ? |
| 3 | 0xC | high bit 0 | draws via 0xB1F8 only on solid cells |
| 4 | 0xA | high bit 2 | ? |
| 5 | 0x10 | low bit 2 | ? |
| 6 | 0xA | low bit 4 | **doors**: `type,x,y,orient,state` (closed when `state&7 < 2`, moving party is blocked) |
| 7 | 0x40 | low bit 7 | **teleports / events**: types 5/6 = `x@2 y@4 side@6 dest x@8 y@10 facing@12 (4 = keep) area@14 level@16 (0 = same, -1 = leave dungeon)` (loader 0x5C7A); types 1-4/7 = other triggers |
| 8 | 0x20 | low bit 3 | monsters (block movement) |
| 9 | 0x14 | high bit 3 | ? |

Verification: 146/146 teleport source cells are open; 110/122 destinations are open on the *same* level and, for the 24
cross-level records, `level-1` lands on an open cell 23/24 times (null control: `level` as index 7/24). One shipped record
(dungeon1 level 6 -> 5, dest 26,18) lands on a wall.
The dungeon entrance is level 1's `level = -1` record: dest (2,25) facing 0, area 0 (used as the start pose; hypothesis).

### 7.5 Paths tried
| Approach | Result | Why |
|---|---|---|
| `wallN.M` as the wall art | Wrong | The `0xC41A` table indexes var `0x1DC` (wall file) from the *object* draw (type 6, `8(a3)` 0/1): it is an on-wall decoration bank; the walls are `moduleN` |
| `icons` bank 0x81 as palette | Wrong | Sprite data (0x102AC copies 4 sprite sets); palette is the fade table at 0xDBE4 |
| Window 192x144 (from `backgndN` size guess) | Wrong | 144x96 at (32,4): backdrop blit BLTSIZE 0x1809 + `display1` layout |

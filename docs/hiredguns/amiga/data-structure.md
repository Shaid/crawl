# Hired Guns (Amiga) — data structure

**Status: recon only (2026-11-21).** Nearly everything below is a **hypothesis**
from cheap probes. The exceptions are labelled. Open work is tracked in
[`../TODO.md`](../TODO.md).

## Title / version

- **Hired Guns**, DMA Design / Psygnosis, 1993, Amiga OCS (PAL). This is the
  WHDLoad install by Psygore (v1.0, 2004, `ReadMe`), with the game tree under `game/`
  and the files already unpacked from the floppies. WHDLoad says it supports
  both the full game and the demo, and this tree is the full game: it has 41 maps and 5
  languages.
- Retail files live at `data/hiredguns/amiga/` (gitignored; moved there in commit 59b2d29).

| File | Size | sha1 |
|---|---|---|
| `game/Hired Guns` (main exe, RNC1-packed HUNK) | 67,809 | `cb13148b92611b27a1a592529da47781eb34de0a` |
| `HiredGuns.Slave` | 1,112 | `18f8ad2905dd2289addcbe68ab579e5f70bd425e` |
| `game/World/World.dat` | 226,221 | `e4f4145b34a795f80fee502094bbade70cbb8b26` |
| `game/Maps/01.map` | 6,782 | `0ccdbc299e774ebc9895256fb6bbdbcad24e9e9f` |
| `game/Styles/Style00.gfx` | 85,959 | `cfe7948af6516152d65a6261b5eedae0b57d451e` |
| `game/Game/GameFast.dat` | 75,817 | `9838169205ba2bfc4ebf65a728f6c32fa0a13d9f` |
| `game/Game/GameChip.dat` | 26,747 | `c59a535bb34fbe1251b0b071229e92bbe723bc3b` |
| `game/MonstersGfx/Monster01.gfx` | 10,217 | `e04fb51bb57a55497111bf604e1f281cb69f5436` |
| `game/CharactersGfx/Adele.gfx` | 6,620 | `96ce601a83ec67afb86bfd31a8d5e2c58be8ea75` |
| `game/MakeFigure/MakeFigure` (dev tool) | 11,284 | `9b67b60f7be5505fe4215f3c8f8c95c95b32574b` |
| `game/C/Crunch` (dev tool) | 3,808 | `47ab045ded66ddfad6e4f50736cd00d0508be990` |

## Compression layer — RNC1 (confirmed)

108 of the files under `game/` start with `RNC\x01` (Rob Northen method 1),
including the main executable. `ancient decompress` unpacks **all 108 without
error**. Each output length equals the header's unpacked-size field. The
exceptions are the 31 `CharactersGfx/*.gfx` + `MonstersGfx/*.gfx` files (a second,
custom packer, see below), the IFF ILBMs, the `.info` icons and the dev tools.
Everything below describes the **decompressed** images.

The decompressed exe holds the path templates `Maps/xx.map` and
`Styles/Stylexx.gfx`. The game patches the digits at runtime (same idea as Black
Crypt's `"bcdf?"`), so the exe has no literal `01.map` string.

## Inventory by family

| Family | Files | Unpacked | Role (hypothesis unless noted) |
|---|---|---|---|
| `Maps/NN.map` | 41 (01–47, gaps at 13/16/22/24/32/36) | **157,738 B each**, all identical | Level: briefing text + object tables + 3 voxel planes. See [Maps](#maps-mapsnnmap) |
| `World/Locations.dat` | 1 | 25,474 B | Starts with the same header and briefing grammar as the maps (`LAT 01.69] LGN 37.83]`). Probably the location-select/briefing bank |
| `World/WorldForeign.dat` | 1 | 74,636 B | Foreign-language briefing text (`0xFB yy xx 0xFC` text records) |
| `World/World.dat`, `Static/StaticNN.mod` | 1 + 5 | — | **MMD0** (OctaMED) modules: the magic `MMD0` is at offset 0 |
| `Styles/StyleNN.gfx` | 5 | 217–235 KB | Wall/scenery "style" banks. A 48-longword offset table at +0, then figure records (see [Figure records](#figure-records-shared-grammar)). Header word 4's high byte (1..4) in each map is probably the style number |
| `CharactersGfx/*.gfx` | 12 | 15,350 B each (header) | Party-member figures. Custom packer (see below) |
| `MonstersGfx/MonsterNN.gfx` | 19 | 19,302 B each (header) | Monster figures. Same custom packer |
| `Characters/*` | 12 | — | **Plain IFF ILBM**, 320×256×5, ByteRun1, `CRNG`/`DPPS`/`CAMG`. These are the *source art* for `CharactersGfx` (see MakeFigure) |
| `Game/Items.gfx`, `Game/Misc.gfx` | 2 | 34,660 / 128,860 B | Offset-table banks of figure records (`Misc` table: 0x104, 0xEE8, … stride 0xDE4 at first) |
| `Game/Items.{fre,ger,ita,spa}`, `Messages.*`, `Languages/Phrasebook.*`, `Front/Outro.*` | 21 | — | Text: item names, messages, phrasebook, per language (English is presumably inside the exe or `GameFast.dat`) |
| `Game/GameFast.dat`, `GameChip.dat`, `ExtraSfx.dat` | 3 | 155/39/414 KB | Offset-table banks holding IFF `FORM`s (sound and graphics; fast/chip split) |
| `Atmos/*.sfx` | 9 | — | IFF **8SVX** ambient loops |
| `Front/{Front,Intro,Outro,Death,Mesg,SmallMesg}.dat`, `ChSelect/*.dat`, `Static/Static.dat`, `Static/StaticNN.pic` | — | — | Front-end screens. Most start with a copper list (`0x0F01 FFFE`, `0x0001 FFFE …`). `StaticNN.pic` = 48,032 B each (a fixed screen) |
| `Game/Game.cpr`, `Game3.cpr` | 2 | 4,524 B | Raw copper lists (`0x0096 8020` DMACON …) |
| `Game/Foreign.font` | 1 | 1,676 B | Bitmap font |
| `MakeFigure/` (`MakeFigure`, `Filters`, `Face.dump`, `Figure.dump`), `C/Crunch`, `C/Display`, `Convert/*` | — | — | **DMA's own figure-conversion toolchain shipped on the disk.** It is a ground-truth oracle (see below) |

## Maps (`Maps/NN.map`)

Each map is a fixed 157,738-byte memory image. The layout is identical across all
41 files: the same zero/nonzero span boundaries to the byte.

| File offset | Size | Content | Confidence |
|---|---|---|---|
| `+0x0000` | 10 | 5 BE words. `w0,w1` vary per map (57,142 / 256,194 …). `w2=w3=10`. `w4` = `0x0100`, `0x0201` … `0x0401` (high byte probably = style number) | hypothesis |
| `+0x000A`… | ~0x1AE6 | Briefing/log text records: `FB 00 yy 00 xx FC <text>`, `~` padding. Plus a 26-word block at `+0x20A` | rendered |
| `+0x22EC`–`+0x65F7` | 17 KB | Object/event tables: 28-byte records such as `FF 0C 0C 00 0000 244E 0000 244E`, whose long fields look like **offsets into the map image itself** (all < 0x2682A) | hypothesis |
| `+0x6F40` | 42,320 | **Voxel plane 0**: 20 × 23 × 23 cells × 4 B | **structural-confirmed** (see below) |
| `+0x11828` | 42,320 | **Voxel plane 1** (= plane 0 + `0xA8E8`) | structural-confirmed |
| `+0x1C110` | 42,320 | **Voxel plane 2** (= plane 0 + 2×`0xA8E8`) | structural-confirmed |

The planes sit 43,240 B (`0xA8E8`) apart. That is 42,320 B of cells plus 920 B
(= 10 rows × 92) that are zero in all 41 maps.

### The grid is genuinely 3D (structural, from code)

The decompressed exe addresses cells as **`z·0x844 + y·0x5C + x·4`**, i.e. layer
2,116 B = 23×23×4, row 92 B = 23×4, cell 4 B. It reaches the sibling planes of the
same cell with `ADDA.L #$0000A8E8` (41 hits in the exe). Examples, all
file-relative to the decompressed `Hired Guns` image (HUNK header included):

- `+0x1629C`: `MULS #4,D1 / MULS #$5C,D2 / MULS #$844,D3 / ADDA D1,D2,D3`, a
  full (x,y,z) → offset computation.
- `+0x783E`, `+0x165C0`, `+0x17382`: `MOVE.B 4(A0),D0 / MULU #$844,D0` followed by
  `MOVE.B 3(A0)|1(A0) … MULU #$17|#$5C`. An entity record carries its z/y/x as bytes.
- `+0x8518`: `ADDA.L #$A8E8,A4 / MOVE.W #$42,D0`. This steps to plane 1 and tests
  the `0x42` value that fills solid rock in plane 0.

The data agrees. Reshaping plane 0 as `(20,23,23)` gives the highest neighbour
agreement of all candidate shapes (0.72 / 0.84 / 0.84 per axis, mean over 41
maps). Each of the upper layers in map 01 is a 23×23 square framed by `0x40` on
all four edges. The lower layers are `0x42` rock with carved cavities. On the
outer axis, 143,802 of 188,460 open cells (all maps) sit directly above or below
another open cell. **Answer to the "2D-per-floor vs 3D" question: one 23×23×20
voxel cube per map. Floors are z-layers of a single array and the engine indexes
z directly. It is not a stack of separate 2D floor maps.** Which way z runs
(index 0 = top or bottom) is **not yet known**.

### Cell words (hypothesis)

- **Plane 0**, 4 B: byte 1 is a flag/type byte. `0x42` = solid rock (179,694 cells
  where plane 1 = `0x0C`), `0x40` = layer frame / open air, `0x00` = empty, plus
  low values (`0x01`–`0x05`, `0x20`, `0x21`, `0x43`, `0x4A`, …). Byte 0 and bytes 2–3
  carry more fields (`0x2003 0000`, `0x0601 0000`, `0x0004 0006` …), probably object
  and door links.
- **Plane 1**, 4 B: byte 1 takes 53 values, `0x0C` = solid interior. Around open
  space it takes distinct values on each side of a void (`0x0D` west of an opening,
  `0x0B` east, `0x14` north, `0x04` south, `0x01/0x02/0x08/0x09/0x10/0x13/0x16` …).
  This looks like a **per-cell block-shape/graphic index**, i.e. which
  Style figure to draw for this block. It is **not** a pure function of the
  4- or 8-neighbour solid mask (best fit 0.86 functional across 41 maps), so it
  is authored data, not derivable. Some cells have a high nibble `0xF0` in byte 0.
- **Plane 2**, 4 B: mostly `0x0000 0F00` / `0`, with sparse other values.
  Possibly lighting or a second graphic layer.

**Wall-storage model (walker question 1): a fourth kind for the survey,
"voxel block + per-cell shape code".** A cell is a solid or open block in 3D, so
whether a face exists is type-derived, as in Dungeon Master but in three
dimensions. In addition, each block carries an authored shape/graphic index (plane
1) that picks its artwork. Converting to the per-cell internal model is
mechanical for each z-layer (face = neighbour solid). The vertical links (stairs,
lifts, holes) need a z-adjacency plane that the current walker schema has no slot
for. Confidence: the geometry is **structural-confirmed**, the face semantics are a
**hypothesis**.

### Paths tried — map cell semantics

| Approach | Result | Why it isn't an answer |
|---|---|---|
| Plane-1 byte 1 as a function of the 4-/8-neighbour solid mask (bits `0x02`, `0x40`, `==0x42`) | 0.86 / 0.86 / 0.79 functional | Too low to call derived, and no null control was run. Treat the value as authored |

## Figure records (shared grammar)

`MakeFigure/Figure.dump`, `Face.dump`, the per-record headers inside
`Styles/*.gfx` and `Game/Misc.gfx` all share one header shape:

```
+0  long  data size/offset      (Figure.dump: 0x0003822C)
+4  word  w? (0x10, 0x30)       +6 word h? (0x14, 0x1A, 0x0B)
+8  word  4 (planes?)           +10 word 0/1
+12 bytes 01 01 01 01 02 00 …
then 12-byte frame entries: w, h, x, y, 0, 0, data-offset  (e.g. 0010 0014 0018 000E 0000 0000 0D1C)
```

This is a hypothesis. The frame entries carry their own width, height and
placement, so a fixed-stride scan would miss them
(`fixed-stride-record-count-unverified.md`).

## Character/monster `.gfx`: custom packer + ground truth on disk

Header: `+0 word ?` (varies), `+2 long` unpacked size (0x3BF6 = 15,350 for every
character, 0x4B66 = 19,302 for every monster), `+6 long` packed size (= file
length, 31/31), then a packed stream that always begins `0x7790 …`. `ancient`
does not recognise it. The likely packer is DMA's own `C/Crunch` (shipped).

`MakeFigure/Filters` is the **cut list** that turns a `Characters/<name>` ILBM
into its `.gfx`. It is plain text:

```
:Left   -f0,11,32,64   -f0,75,32,42   -f0,117,16,28  -f0,145,16,20
:Right  -f96,…   :Front -f64,…   :Back -f32,…
:Dead   -f0,165,48,25 … (4 sizes)   :Face -f0,165,48,26  -f0,191,48,10
```

Each figure therefore comes in **4 facings × 4 pre-scaled depth sizes** (32×64,
32×42, 16×28, 16×20), plus a Dead pose and a face. That fixes the renderer's depth
steps at 4. It also gives a byte-exact oracle: once the packer is solved, the
decoded `.gfx` frames must equal these rectangles cut from the ILBM.

**First-person view (walker question 2): slot/frustum blits of pre-scaled
artwork** (hypothesis, medium confidence). Figures exist at exactly four
pre-drawn sizes, and the Style banks hold figure records that carry their own
x/y placement. That is the same family as Black Crypt / Dungeon Master
(depth-slot composites from pre-drawn per-depth pieces), not texture mapping or
vectors. The open part is how the renderer handles the third dimension. It may
draw blocks above and below the eye layer (ceiling holes, ledges, stairs) as
extra slots. That needs the view routine traced in the exe.

## Prior art (leads, not verification)

- **Original development archive (July 2021, Internet Archive)**: per The
  Cutting Room Floor, it holds Amiga game source, Map Editor builds + source, the
  empty editor map and three Amiga Format demo levels. If the user can supply it,
  it is the authoritative oracle for every format here. Fetched 2026-11-21
  (see the Update below and TODO `hg-dev-archive`).
- A community map viewer ("Hired Guns Map Viewer", PlayCanvas, forum post 22102)
  and an EAB thread (p=1514678) both claim to have decoded the full map
  structure. Neither publishes a spec that this session could read.
- No sibling seer corpus covers DMA Design. `RNC1` is standard (`ancient`).
  Character source art is plain ILBM (`tools/shared/ilbm.ts`, `@seer-project/iff`).
  The music is MMD0 (OctaMED; Black Crypt's `bcdfq` also uses OctaMED).


> **Update (2026-11-21):** the DMA development archive is now on disk at
> `data/hiredguns/devarchive/` (gitignored): Internet Archive item
> `hired-guns-cd-32-dev-files` ("Hired Guns Amiga CD32 Beta and Development Files",
> uploaded 2021-07-21, public-domain mark), files `HiredGunsCD32_DevFiles.tar.xz`
> (sha1 `621d17bf34a9d60387dc5f6b529efc4058e05c12`) and `HiredGunsCD32_Beta.iso`
> (sha1 `cc44afbe5b637256bbf3bddbbf53f3a2a0e20131`), both matching the item's own
> checksums, extracted under `extracted/HiredGunsCD32_DevFiles/`. It holds the game's
> `Sources/` (≈300 `.s`/`.i`/`.c` files), `MapEditor/` and `Maps/`.
> `MapEditor/HGmapstructure.h` defines `MAP_HEIGHT 20`, `MAP_WIDTH 23`, `MAP_DEPTH 23`,
> `FLOOR_SIZE 529` and the per-cell bitfields (floor, block, water, panel, explosion,
> variant, aux) — independent confirmation of the grid shape above. It is the
> unreleased CD32 build, so treat it as a strong guide, not proof, for the floppy
> retail files.

> **Correction (2026-11-21):** `Sources/` does not hold ≈300 source files. The
> archive as a whole holds **301** `.s`/`.i`/`.c` files (288 / 8 / 5, plus 6
> `.h`); only 34 of them sit under `Sources/` — the rest are mostly under
> `Graphics/` (175), `Data/` (53), `Takeover/` (24) and `MapEditor/` (12).
> Counted with `find` over `extracted/HiredGunsCD32_DevFiles/`.

## Paths tried — packer (`CharactersGfx` / `MonstersGfx`)

| Approach | Result | Why it failed |
|---|---|---|
| `ancient identify` | "Unknown or invalid compression format" | Not a known packer. Reader is `C/Crunch` (packer) and the game exe (unpacker) |

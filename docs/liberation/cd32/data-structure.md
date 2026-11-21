# Liberation: Captive II — CD32 — data structure (recon)

**Title:** Liberation: Captive II (a.k.a. "CaptiveII"), Mindscape 1994, Tony
Crowther & Ross Goodley ("The Byte Engineers"). CD32 release, as shipped in the
JOTD WHDLoad install v1.0 (2020, "floppy & cd32 versions supported").
**Source tree:** `data/liberation/cd32/` (moved there in commit 59b2d29; 179 files,
15.4 MB). Game files under `data/`, WHDLoad slave + `Manual` (plain-text CD32
manual) + `ReadMe` at the root.
**Recon date:** 2026-11-21. Everything here is **hypothesis** unless marked
**confirmed** (structural invariant across the whole family, or the game's own
reader).

| File | Size | sha1 | Role |
|---|---|---|---|
| `data/captiveII` (= `backup/CaptiveII`) | 245,628 | `cdce4d20a1c32c816485b6e27768b22434f8d88c` | Main exe. `$VER: Liberation : Ratt V2.02 : Wyvern V2.00c`, built 08-Apr-94 |
| `data/CityGen` (= backup) | 10,896 | `2592f27f6700762dba024b69279f62dfbf3c85bd` | City-zone map generator, `CityGen 1.12 (03-Jan-94)` |
| `data/BuildingGen` (= backup) | 23,324 | `880fff45d1048ff075b3a2a805766ff70d30295a` | Building-interior generator, `BuildingGen 1.3 (12-Jan-94)` |
| `data/PlotGen` (= backup) | 12,476 | `5fe49f47a677e01e0226df6df14d9e4d5974a20e` | Plot/mission generator; opens `PGE.TXT`/`DTE.TXT`/`CTE.TXT` |
| `data/libs/{math,tridee,vector}.library` | 3,724 / 7,232 / 11,236 | `ef75858b…` / `a75ec25e…` / `d5e98ff8…` | Crowther's 3D maths / polygon libraries |
| `data/c/Liberation` | 1,984 | `ad362c78a5b4045bee4d8634221c5dda222ad93f` | CD launcher: plays `StartUp.asp`+`Intro.sty` via `c/PlayASP`, then runs `CaptiveII` |
| `data/Wall01.VGM` | 167,766 | `fee5b2d76e0ac8d31537d8c5a266cc13a29323ba` | Wall set 1 of 71 |
| `data/0CityVectors.x3g` | 24,702 | `9745c4c56a2d94f7ba0959d34d78e765e35bcc8e` | City vector objects, style 0 |
| `data/intro.sty` | 526,285 | `f52bb4e0578efe626111f1a1a4981e16b19091ac` | Intro animation story |
| `data/MainSp.img` | 65,818 | `46f9b9a24d751336d9386997de946a0c99108e08` | UI sprite bank |
| `data/3dView.img` | 11,758 | `41645824ff5befe7295b9f2149f406808704dbfa` | 3D-view frame/UI sprites |

All four HUNK executables (`captiveII`, `CityGen`, `BuildingGen`, `PlotGen`)
are plain `HUNK_HEADER` + CODE/DATA/BSS, **no `HUNK_SYMBOL`/`HUNK_DEBUG`**
(own hunk walker, recon scratch). IRA 2.11 `-a` aborts on them with
"ReadSymbol error"; plain `ira -M68020 <exe> <out>` works.

## The two walker questions (recon answers)

### 1. How is the map stored? — it isn't; it is generated
**No map files ship.** The world is regenerated on demand by three
separately-`LoadSeg`'d generator executables, called with a shared parameter
block:

- **Offset convention:** every `captiveII +0x…` below is relative to the
  CODE hunk body (file offset = `0x2C` + value).
- `captiveII +0x22B90` `LoadSeg`s `:CityGen` (fallback `:backup/CityGen`), calls its
  entry (`jsr 6(a6)`) with **A0 = A5+0x1D7A**. PlotGen is called the same way
  at `+0x22C46` with A0 = a buffer stamped `'MM'`, word 2 = `(0x1D7A,A5)`,
  word 4 = `(0x1D7E,A5)`. **confirmed** (disassembly).
- CityGen entry (`LAB_0000`, its `cg.asm`): `(A0).w` → `(62,A5)`,
  `(2,A0).w` → `(64,A5)`; skips regeneration if `(2,A0) == (1072,A0)` (cache);
  output buffer `(12,A0)` cleared as `$3000` bytes = **three 4,096-byte
  planes**. City coordinates are masked `ANDI #$3F` / `ASL #6` throughout →
  **64×64 grid per zone, 3 byte-planes** (hypothesis, strong; ties to the
  manual's three levels per zone: underworld / street / roof tops).
- **PRNG:** a 16-bit LCG, `s = s*0x05E5 + 0x0029 (mod 2^16)` (CityGen
  `LAB_01AC`, BuildingGen `LAB_0060`, PlotGen line ~1233, and ≥6 sites in
  `captiveII`). CityGen's seed (`LAB_0014`) is
  **`(A0).w * 16 + (2,A0).w`** = `world * 16 + zone`. **confirmed**
  (disassembly) — the city is a pure function of two small integers
  (see lesson `seeded-prng-stable-not-random.md`: stable, not random).
- `world` = `(0x1D7A,A5)` is unpacked at `captiveII +0x12E6` from the game
  record at `A5+0x626C`: word 0 & `$3FFF` (bit 15 → flag `0x7CEB`, bit 14 →
  flag `0x7CEC`); `zone` = byte 2 & `$0F` → `(0x1D7C,A5)`. The same `world`
  value seeds the main exe's own LCG (state `0x5A66(A5)`) at five sites
  (`+0x69EE`, `+0x9FD8`, `+0x9FFA`, `+0xDFDA`, `+0xE752`). Where the record is
  first filled (new-game: fixed per level, or player-random?) is **open**.
- **BuildingGen** reuses the same block: it reads the city cell at
  `(12,A0)+(32,A0)` — plane 1 high nibble +2 = floor count, plane 2 byte =
  building index into a 4-byte table at `(16,A0)` — seeds its LCG from that
  entry and index, then **writes the interior into the same `(12,A0)` buffer**
  with a variable row width `(12,A5)`; player cell → `(32,A0)`, facing →
  `(34,A0)` (`EORI #2` = turn around ⇒ facing 0–3). Hypothesis (one read of
  the entry code).

> **Correction (2026-11-21):** the three 4 KB planes are **not** three
> height layers. They are three attribute planes of **one** 64x64 cell grid
> (index `y*64+x`): plane 0 = cell type (`& 0x3F`, 1..27 seen) + 2 flag bits
> (`& 0xC0`), plane 1 = per-type aux (for buildings: high nibble = floors - 2),
> plane 2 = per-type aux (building index into the `(16,A0)` table). The
> underworld / street / roof layers are **derived** per view from the same
> cell by four 28-byte tables and the building-height rule (see "City view
> composer" below). Street = layer z=1 (CityGen's start word has `z<<12` = 1).
> Confirmed by running CityGen under musashi (byte-identical on repeat runs,
> TS consumers byte-exact against the game's own decode).

So the walker grid is **"something new" for this corpus**: a byte-plane
cell grid (3 planes) produced by code, not a file. Per-cell faces vs.
shared-edge vs. type-derived is **not yet known** — that is the first job of
the generator trace (TODO `lib-gen-grid-format`). Reproduction route is the
Dungeon Hack one from `docs/walker-map-format-future-decision.md`, but better
placed: the generators are tiny, self-contained, position-independent
68020 blobs with a documented in-register parameter block, so running them
under the project's 68k emulator (`scripts/m68k_emu.py` /
`tools/bcdft_decompress/` pattern) is a cheap, exact oracle.

### 2. How is the first-person view drawn? — a mix
- **Bitmap wall slots** for walls/floors/ceilings: `Wall01..71.VGM` are banks
  of pre-perspective wall pieces (see `AmSp` below) — trapezoidal side walls,
  floor/ceiling wedges and front faces at several depths, each with its own
  mask. Strongly suggests a **slot-table** renderer like Black Crypt's.
  The loader (`captiveII +0x250D6`) builds `:WALLnn.VGM` from the wall-set byte
  `0x2C92(A5)` and splits the file into **4 banks at +0, +0xA226, +0xEC0A,
  +0x70BA** (= 41,510 / 60,426 / 28,858, the exact bank sizes the structural
  walk finds), then builds a per-bank sprite table (`+0x251DE`). **confirmed**.

  > **Correction (2026-11-21):** `+0xA226`, `+0xEC0A`, `+0x70BA` are bank
  > **sizes**, not offsets (the parenthesis above already gives them as
  > sizes). Re-scanned `data/Wall01.VGM` (167,766 B): the four `AmSp` headers
  > sit at **0 / 41,510 / 101,936 / 130,794** (`0x0`/`0xA226`/`0x18E30`/
  > `0x1FEEA`), holding 42/45/24/41 sprites; the fourth bank is **36,972 B**
  > (`0x906C`) and ends at EOF.
- **Vector/polygon objects** for everything else: `*.x3g` = IFF `FORM O3DG`
  banks of `FORM VCDO` objects (bank, bar, shop, room furniture, city
  buildings in 4 architectural styles `0`–`3`, droids, monsters, people,
  police), drawn by `tridee.library`/`vector.library`. The manual's "Vector
  Preferences → Reduce points / Reduce fill — a special textured fill is used
  on many 3D objects" matches the `VFTX` chunk.
> **Correction (2026-11-21):** the outdoor city **does** use `.VGM` wall art:
> `+0x36A0E` picks the city wall set from the list at `+0x37010`
> (`Wall01`..`Wall10`, LCG on world/zone), and the static view draws bank 0
> through the slot table at `+0x2B22E`. Vector objects come on top (doors,
> signs, people, droids). See "City view composer".

- Which of the two the **outdoor city** uses (vector buildings only, or VGM
  pieces too) is **open** — `0CityVectors` has 33 objects, which reads like
  building façades. Hypothesis: interiors = VGM slots + vector props; city =
  vector buildings + ground.

## Families

### `AmSp` — planar sprite banks (`Wall*.VGM` ×71, `gamemenu.spr`)
**confirmed** (structural walk, 72/72 files):
```
'AmSp'  u16 count
count × { u16 w, u16 h, u16 planes, u16 flags, u16 zero, pixels }
```
- `w` = width in words; **bit 15 set ⇒ row is one byte short**:
  `bytesPerRow = (w & 0x7FFF)*2 - (w>>15)`.
- `flags & 0x8000` ⇒ one extra mask plane. Pixel block =
  `bytesPerRow * h * (planes + mask)`, padded to an even length.
- Planes are **sequential** (plane-major), **colour planes 0..3 first, mask
  last**: across Wall01's 152 sprites the last plane is a strict superset of
  every colour bit (0 violations); planes 0–3 each have 85K–144K bits outside
  their own extent. Row-interleaved order renders as garbage.
- **Every `.VGM` is 4 `AmSp` banks back to back** — 42 + 45 + 24 + 41 = 152
  sprites — ending exactly at EOF (167,766 B), **71/71 files, identical
  geometry in all 71** (only the pixels differ: 71 wall styles).
- `gamemenu.spr`: 1 sprite, 320×109×5 planes, no mask, followed by a 64-byte
  trailer = 32 × `0RGB` palette words (hypothesis: its palette).
- The palette for the 4-plane wall art is **not found** (16 colours; likely in
  `captiveII` DATA or per wall-set). Greyscale render shows coherent
  stone/panel textures with heavy ordered dither.

| Approach | Result | Why it failed |
|---|---|---|
| | | |

### `ImgA` — indexed sprite banks (`*.img`: MainSp, MainSp16, 3dView, taxi, backpack)
`'ImgA'` + u16 count + u16 0 + count × u32 offsets (MainSp 158, 3dView 23,
taxi 4, backpack 176). Entries not yet decoded; taxi shows an embedded
`0x0fff…` palette-like run. Hypothesis: same per-entry header as `AmSp`.

| Approach | Result | Why it failed |
|---|---|---|
| | | |

### `FORM O3DG` — 3D object banks (`*.x3g` ×38) and `FORM VCDO` (`*.x3d` ×2)
**confirmed** IFF tiling (chunk walk ends exactly at EOF):
`FORM O3DG { OFFS, n × FORM VCDO { EXVL, PLST, [VSPR] }, VFTX }`.
`.x3d` files are a single bare `FORM VCDO`. `Demo.vfx` starts `VFTX` (a
standalone fill-texture table). Prefix digit `0`–`3` = architectural style
(`captiveII` opens `:%Liberation.FNT`, `:0CityVectors.x3g` etc. with the digit
substituted). Chunk semantics (vertex list, polygon list, sprite attachments,
fill textures) are hypotheses from the names.

### Audio
- `Samples.BIN`, `Samples0/1.BIN`: u16 count + count × `FORM 8SVX`
  (standard). `EndGame/*/Voice*.SAM`: concatenated `FORM 8SVX` (standard), with
  28-byte `.LOG` sidecars. `mod.ingame` is referenced but **absent** (CD audio
  or cut).

### Animation (`*.sty`, `*.asp`)
- `.asp` = **RNC2** (`ancient` decodes) → custom `FORM ANIM` with `NAME`,
  `BUFF` (320×200×6) chunks. Player: `c/playasp`.
- `.sty` = `FORM HEAD` + `STRY` directory of named sub-ASPs
  (`INTRO.ASP`, `Medal.ASP`, …) each RNC2-packed. Not needed for the walker.

### Text
`ObjText.txt`, `Dossier.txt`, `PGE.txt` (translator notes + plot generator
script), `DTE.txt` (location descriptions), `CTE.txt` (conversation) — plain
text with a `^X…[ ]` macro/condition language consumed by PlotGen and the
main exe. `*Liberation.FNT` = `'CHAR'` bitmap font.

## City generation oracle (2026-11-21) — **confirmed**

`tools/liberation/cd32/emu/gen.c` (musashi; `emu/build.sh` -> `build/cache/liberation/gen`)
loads `captiveII`, `PlotGen`, `CityGen`, `BuildingGen` with their own HUNK
relocations, stubs exec (AllocMem, OpenLibrary) and dos (Open/Read/Lock/
Examine for PlotGen's `PGE.TXT`/`DTE.TXT`/`CTE.TXT`), and runs:

| Step | Code | Shape |
|---|---|---|
| PlotGen | entry hunk+2 | A0 = `'MM'`, world, flag block; A1 = `+0x3365E`; D0 = 0 (`+0x22C46`) |
| param block | `+0x22AAC` | A5+0x1D7A: `+12` grid (`(1986,A5)`), `+16` = grid+0x3000, `+20` = +0x31CC, `+24` = `+0x3365E`, `+28` = plot, `+72/76` = callback `+0x5FC0` / main A5 |
| CityGen | entry hunk+2 | A0 = A5+0x1D7A (`+0x22BBA`); `(1066,A0)` = -1 (no saved cell) -> CityGen picks the start cell `(32,A0)` and facing `(34,A0)` |
| wall set | `+0x36A0E` | D0 = city VGM number |
| wall CMAP | `+0x36A68` | `(32302,A5)` -> one of the 18 CMAPs at `+0x36AAE` |

- **CityGen depends on PlotGen's output** (`(28,A0)`, read at CityGen `+0x2A28`)
  and on the main exe's callback (game time/state bytes; zero for a new game).
- Zones **0..8** generate; zone 9+ does not terminate (CityGen's 9-entry zone
  tables at its `LAB_1186`). A new game starts in **zone 8** (`+0x227A0`) with
  world = the BSS default 0 unless the `(12944,A5)` restore path loads one.
- Determinism: same (world, zone) -> byte-identical grid (checked).
- **Exported zones** (walker): world 0, zones 0..8 (walls 3,4,5,6,7,9,10,1,2).

## City view composer (2026-11-21) — **confirmed** (byte-exact port)

Ported to `tools/liberation/cd32/view-model.ts`; tables read by
`engine-tables.ts`. `verify-view.ts` compares the TS window and the full
6 x 2400-byte planar view against the game's code run in the harness:
**3,300+/3,300+ poses byte-exact over 10 zones** (world 0 zones 0-8,
world 1 zone 0, world 37 zone 4), vector objects disabled on both sides.

- View: **192x100, 6 sequential planes of 2400 B** (24 B/row), `(1198,A5)`.
- **Backdrop**: `+0x1D794` copies the DATA hunk's own AmSp sprite (DATA +0,
  192x100x6, pixels at DATA+0x10) into the view first (+12 B when turning).
- **Window** (`+0x27F8E`): 3 layers (z-1, z, z+1) x 5x5 cells, index
  `row*5+col` with the player at row 4 col 2; per facing origin/steps:
  f0 N (x-2,y-4,+1,+5), f1 E (x,y-2,-5,+1), f2 S (x-2,y,-1,-5), f3 W
  (x-4,y-2,+5,-1). Out-of-map cells = 0x06. Standing on 0x1A (z=0) / 0x1B
  (z=1) raises the layer base by one.
- **Cell decode** (`+0x2835A`): layer -1 table `+0x285BA`; layer 0 `+0x285D6`,
  layer 1 `+0x285F2`, layer 2 `+0x2860E`, >=3 `+0x2862A`. Table bit 7 = special
  (bit 6 sub-cases: 6 -> 21 if plane1 bit 7, 0x18 -> 0x18+(p1&3), 0x0B and
  plain -> building height `floors = (p1>>4)+2` -> 12/15/16). Non-special
  entries get plane 0's `& 0xC0` bits.
- **Visibility** (`+0x28646`): script at slot table + word 0: `0` end; `b>=0x80`
  -> next `(~b)+1` indices := 8; else `idx, n`: skip `n` bytes when that cell is
  open (> 8) in a pre-pass copy.
- **Slot walk** (`+0x2564E`, static view uses bank 0 + table `+0x2B230`):
  `{idx, occluder, s16 rel}`; rel < 0 = vector-object handler (via `(2012)`
  table `+0x26C16`); else drawn when `win[idx] <= 7` and (occluder < 0 or
  `win[occ] > 8`). Moving/turning frames use banks 1-3 (`+0x2BC62`,
  `+0x2C58A`, `+0x2CC84`) — not needed for a step walker.
- **Type handlers** (`+0x27BBA`, city): 1 -> mode 0 (+ door/sign objects),
  6 -> texture mode via `+0x27DF2` (cell table at slot table + word 4;
  textures `+0x2E220` / `+0x2D5D0`, 6 planes x 512 B, 8 rows x 4 B, animated
  by the frame counter `(2836,A5)`), others -> mode -1.
- **Draw record** (4 B): x byte, y row, sprite (`& 0x3F`, top 2 bits = facing
  hint), flags: bit 3 mirror (bit-reverse table `+0x2542E`), bits 0-2 vertical
  code (0 normal; 1-6 = flipped, rows `h - {1,3,4,6,10,11}[c] + 1`, table
  `+0x25A62`; 7 = flipped from row 99-y), bit 4 = row runs (+4 count, then
  count+1 bytes; bit 7 = masked rows, else opaque), bit 5 byte/word path
  (same pixels).
- **Colour modes**: AmSp colour planes 0-3 go to view planes 0,1,2,5; mode 0
  sets planes 3+4 (colours 24-31 / 56-63), mode -1 clears them (0-7 / 32-39).
- **Palette** (`+0x1CA8A`, AGA path): base CMAP body at DATA +0x389C (64 x
  RGB8) for 0-23 / 32-55; the wall CMAP's 2 x 24 B (CMAP + 12) for 24-31 /
  56-63. Closes TODO `lib-vgm-palette` for the city.
- **Collision** (`+0x24628` / `+0x282DA`): flags word = `(2012)` table +2 for
  the cell's window value at the player's layer: bits 1-2 solid, bit 3
  stairs/ramp (layer change), bit 4 drop (refused unless a ramp below), value
  bit 7 = door/object cell (`+0x246F4`).

| Approach | Result | Why it failed |
|---|---|---|
| TS window without the `+0x28646` visibility pass | windows 0/5 | the game blanks hidden cells to 8 after the fill |
| texture mode bit-reversing texture bytes when mirrored, phase from x | 6/40 views off | mirrored path reverses only the mask; phase starts at x+width |

# Evil's Doom (Amiga AGA) — data structure

Recon 2026-11-21. Almost everything here is **hypothesis** from cheap structural
probes; only the RNC/CrM2 packing, the three plain ILBMs and the WHDLoad slave
identity are **confirmed**. Open work: `docs/evilsdoom/TODO.md`.

## Title / version

| Field | Value |
|---|---|
| Title | Evil's Doom (1996), Olympia Software / Olympia Team + Titan Computer (Croatia) |
| Credits | Code Mladan Tripalo; graphics Hrvoje Colic, Tripalo, Bernard Kos, Bojan Pecnik; music Vlado Tomic, Tripalo (`InfoVersion`) |
| Build | **fan-fixed "final CD version 1.8"** (based on 1.0/1.7/1.7b, protection removed, bugs fixed, savegames for all levels added — `InfoVersion`). Not a pristine retail build. |
| Install | WHDLoad, Psygore v1.1 (12 Oct 2025); slave loads `prg/int.dat` first; refuses a depacked `OMD/PCH.DAT` |
| Chipset | AGA (copper lists write `FMODE` `$1FC` and `BPLCON3` `$106`; 768-B CMAPs = 256 colours) |
| Language of internal names | Croatian (`PATULJAK` dwarf, `ROGATI DEMON` horned demon, `KNJIZNICA` library, `BUSOLA` compass, `KOCKICE` cubes, `SPILJAROK`, `ANIMACIJA`); some save names Czech (testers) |
| Location | `data/evilsdoom/amigaaga/` (moved there in commit 59b2d29; game files under `data/`) |

sha1 (packed, as shipped):

| File | sha1 |
|---|---|
| `EvilsDoomAGA.slave` | `9be35026275456b32562fe8bd6147d8a2822f114` |
| `data/PRG/INT.DAT` (HUNK boot exe) | `db359ed312a1aa1bee299d67837de485d1844365` |
| `data/PRG/OUT.DAT` (overland) | `8199e8af80d3946ddeac422689411882cc31e649` |
| `data/PRG/BEL.dat` | `580590f7a984ae1a4794fc9dc9ef9eb9fa74a7e6` |
| `data/PRG/CLL.dat` | `6f239f4be160959c4201fc4beba587c921268902` |
| `data/PRG/IOW.dat` | `fb9cc54c87833e8e6a831cfea77119874a6835bb` |
| `data/PRG/MIN.dat` | `6f5d4d45ee57e163461f0362f0f8e730a002abb3` |
| `data/PRG/MYT.dat` | `d24dc0efbc393da1e48e81597bf71158d15c9a5b` |
| `data/X/FAILED.BIN` | `1d560c5a291caf6c01b55816f493800054e12663` |
| `data/OMD/PCH.DAT` (CrM2) | `611e43b4ab0bf8a5858a6b78b351440819f6beec` |
| `data/SAVE/B/.BEL` (pristine dungeon state, 12 slots identical) | `63eeda17daba665fda735559502e509af5a0f5fa` |
| `data/SAVE/B/.IOW` / `.MIN` / `.MYT` (pristine, 12/11/10 slots identical) | `7b232546…a4` / `cfe4beb2…e0` / `1aa26cd1…dd` |
| `Runecasting` / `Secret` / `Spells` (ILBM) | `1c4c78bb…86` / `05ff5589…df` / `1c7c5000…f3` |

## Layer 0 — packing (confirmed)

Every file under `data/` except `SAVE/` and `OMD/PCH.DAT` is **RNC ProPack
method 1** (`RNC\x01`, BE unpacked size, BE packed size). `OMD/PCH.DAT` is
**Crunch-Mania `CrM2`**. `ancient decompress` unpacked all 236 files with zero
failures (14.8 MB out). `@seer-project/pipeline` already has
`decompressRnc1`; CrM2 needs `ancient` (or an upstream decoder). Everything
below describes the **unpacked** bytes.

## Inventory by family (unpacked)

| Dir | Files | Role guess | Magic / evidence | Status |
|---|---|---|---|---|
| `PRG/INT.DAT` | 1 | Boot/intro program | HUNK `000003F3`, 5 hunks; opens `int/*.bin`, `PRG/OUT.DAT` | standard (HUNK) |
| `PRG/{BEL,CLL,IOW,MIN,MYT}.dat` | 5 | **Per-dungeon program module**: code + strings + view tables | `DCLL` header + 10 BE longs (entry offsets), code from `+0x744`, A6-relative globals | structured-unknown |
| `PRG/OUT.DAT` | 1 | Overland/town program module | magic `12345678` | structured-unknown |
| `PRG/*.chip`, `GO.chip` | 7 | Chip-RAM part of each module (copper lists etc.) | `0C01 FFFE 01FC 0000 0106 …` = copper `WAIT`/`MOVE` | structured-unknown |
| `SAVE/<slot>/.{BEL,CLL,IOW,MIN,MYT}` | 5 × 18 slots | **Dungeon map state** (memory dump), the map source for us | see § Dungeon maps | structured-unknown (grid visible) |
| `SAVE/<slot>/{CHAR,DATA,FACE}` | 3 × 18 | Party records (10,060 B), game state (4,208 B), portraits (10,240 B) | — | structured-unknown |
| `SAVE/Dir` | 1 | 16 × 44-byte slot names (704 B exactly; names start at every 44-byte boundary), against 18 `SAVE/<slot>/` directories (`-jsa/beginning`, `-ufo.belcoon2` …). An earlier reading of 22 × 32 B also totals 704 B but puts names mid-record | ASCII | trivial |
| `WAL/<dungeon>.DT0` / `.DT1` | 5 + 5 | Wall art banks, **fixed sizes in every dungeon** (63,072 / 26,910 B) | no header; raw planar | structured-unknown |
| `DOR/*` | 6 | Door art, each exactly 24,536 B | no header; raw planar | structured-unknown |
| `EVE/<dng>.<n>`, `<dng>.MAIN` | 10 | Per-level wall-decoration ("event") banks: 14-B blit descriptors then pixels; `.MAIN` per-dungeon | § View | structured-unknown |
| `MON/*` | 24 | Monster sprite banks | word `$8003`/`$8004` then counts/offsets | structured-unknown |
| `PIC/*` | 36 | Location / shop / NPC pictures (256 colours) | headerless IFF chunks: `CMAP`(768) + `BODY` — **no FORM, no BMHD** | variant (ILBM pieces) |
| `INT/*.bin`, `X/FAILED.BIN`, `THEEND/ENDPIC.BIN` | 15 | Intro/end screens (most unpack to 286,720 B) | raw | structured-unknown |
| `THEEND/ANIMACIJA1-3` | 3 | End animations | `FORM ANIM` / `ILBM` | standard (IFF ANIM) |
| `THEEND/PLAYER*.BIN`, `*.MOD`, `DMD/*.MOD`, `OMD/P60PLAYmod.dat`, `PROPLAYmod.dat` | ~8 | Replay code (68k, `4DFA …`) and small modules | code | low value |
| `MUZ/P60.*` | 31 | Music: **The Player 6.0A (P60A) modules, no signature** | packed header words, cf. hunter | variant (sibling-solved) |
| `DMD/SAMPLES.*.CHIPMOD` | 3 | Sample banks with replay stub (`6002 …` BRA) | code+PCM | structured-unknown |
| `DMD/*.DAT`, `*.CRM` | ~14 | UI: icons (colour/BW, offset tables), fonts, inventory pages, compass (`BUSOLA`) | offset tables / raw planar | structured-unknown |
| `DUNDAT/*` | 9 | In-dungeon full-panel art (stairs, scroll, rope, `.NOTE` pages, 12,604 / 37,812 / 50,416 B) | raw planar | structured-unknown |
| `OMD/*` | 12 | Overland data: `TXT.DAT` (offset table + text), `MapPointer.DAT`, faces, icons, `PCH.DAT` | offset tables | structured-unknown |
| `CT/CT01-46` | 44 | Small text/script records (1–5 KB unpacked) | not probed | structured-unknown |
| `Runecasting`, `Secret`, `Spells` (root) | 3 | Manual pages | **FORM ILBM** 640×400×3, 640×200×8, 640×512×3 | **standard, confirmed** |

## Dungeon maps (the walker question 1)

**No map file is opened by name.** The dungeon module's file table
(`BEL.dat+0x12E18`…`+0x13237`, `EVIL:`-prefixed strings) lists art, monsters,
doors, `EVE`, `WAL`, music and the other modules — nothing map-shaped. A
direct and a masked (`&0x80`, `&0x7F`, `&0xFF`) sliding search for the save
grid below against every unpacked file found nothing above chance
(best 0.69 / 0.62 / 0.95 for masks that are mostly-zero anyway).

The map lives in the **per-dungeon state block**, saved verbatim as
`SAGA:SAVE/<slot>/.BEL` etc. Code evidence (`BEL.dat`, file offsets = module
offsets, no hunk header):

- `+0xF0D4`: `LEA $455C(A6),A0` / `MOVE.L #'.BEL',(A3)` / `MOVE.L #$3B18,D0` /
  `BSR` write — the `.BEL` file is the 15,128-byte (`$3B18`) block at
  `A6+$455C`.
- `+0x1308`: `MOVEA.L 8(A6),A0` / `ADDA.L #$EB38,A0` / copy `$3B18` bytes to
  `A6+$455C` — on module entry the state is copied in from a cross-module
  buffer (`8(A6)`, which also holds party data at `+$1070`, `+$37BC`). Exit
  path `+0x1326` copies it back.
- `SAGA:SAVE/` (`+0xEEA2`) and `SAGA:SAVE/DIR` (`+0xF3F0`) are the save paths.

**Which file seeds a new game is not yet known** (`evilsdoom-newgame-state`).
For decoding, the pristine copies are enough: 12 of 18 slots carry a
byte-identical `.BEL` (sha1 `63eeda17…`), likewise `.IOW` 12, `.MIN` 11,
`.MYT` 10 — those slots never entered the dungeon. `.CLL` has **no** such
majority copy: its largest byte-identical group is 6 of 18 slots
(`a`/`G`/`J`/`K`/`L`/`n`, sha1 `777fe544…`), and slot `B`'s `.CLL` is unique,
so no `.CLL` can be called pristine from slot agreement alone (counted
2026-11-21 over `data/SAVE/*/.CLL`, packed-file sha1).

### Grid (rendered, semantics hypothesis)

- **30 × 30 cells, 1 byte per cell, row-major.** Wall-bit autocorrelation
  peaks at lag 30/60/120; every grid has a solid border on all four sides.
- **Bit 7 = solid block.** `0x80` in BEL/CLL/IOW; `0xAE` in MIN/MYT (with
  `0x20` filling unused rock), so the low 7 bits of a solid cell are a
  type/texture/decoration code, not padding.

> **Correction (2026-11-21):** `0x20` cells are not rock: bit 7 is clear, so
> the movement test (BEL `+0x9BCE`) and the view builder treat them as open
> floor (Castle Mythil's courtyard, the Mine's galleries).
- Open cells are mostly `0x00` with sparse `0x02`/`0x04`/`0x08`/`0x40`
  (1/2/4/8 look like a direction or feature code — doors, stairs, levers?).
  Solid cells also carry `0x10`/`0x20`/`0x40` (`0x90`/`0xA0`/`0xC0`) —
  plausibly a decorated face (`EVE` bank entry) or secret wall.
- Several grids per file, each preceded by a variable-length list
  (records of words, `FFFF FFFF` terminated, zero padded): the bordered-grid
  scan finds BEL ≥ 6, CLL 10, IOW 4, MIN 9, MYT 5 (BEL also has an unbordered
  one at `+0xAE4`). Record framing, level count and the role of the lists
  (objects? monsters? events?) are open (`evilsdoom-map-record`).

> **Correction (2026-11-21):** the level count and grid offsets are now read
> from the module code (§ "Dungeon state block — framing (2026-11-21)"):
> CLL 10, BEL 7, MIN 9, MYT 6, IOW 4 levels. BEL's "unbordered one at
> `+0xAE4`" is level 2 at `+0xAE6` (its row 29 is unused zeros); MYT's sixth
> grid was missed by the scan because its open cells are `0x20`, not `0x00`.

First grid of pristine `.BEL` (`SAVE/B/.BEL+0x418`, `#`=`0x80`, `+`=other
bit-7 value, `o`=non-zero open, `.`=`0x00`), rows 0–9:

```
##############################
#...........#o....#..#+..#...#
#..........#.#..o.oo.+...#...#
#.........#.+.#####..#.#o#...#
#.........###.o.o.o..+.#.#...#
#........#...##.###...o#.#...#
#.......##o#.##+o.o..+.#.#...#
#..##.##...#.####o#..#.#.#...#
#.#..#..o..#o#+##.######o#...#
#+.o.o....+......####.....#..#
```

**Walker answer (1): type-derived** — a face is a wall because the neighbour
cell is solid (the Dungeon Master model), with extra per-cell type bits.
Confidence: **rendered** for the grid shape and the bit-7-solid reading
(clean borders and corridors in all 5 dungeons); **hypothesis** for whether
open-cell codes 2/4/8 add thin per-cell faces (doors) on top. Converts to the
repo's per-cell model by the existing type-derived rule
(`docs/walker-map-format-future-decision.md` § 2026-11-21 review).

| Approach | Result | Notes |
|---|---|---|
| Exact 32-B windows of save `.BEL` in `PRG/BEL.dat` | only header-like hits (3 windows) | map is not a static table in the module |
| 30-B grid rows vs every unpacked file | 0 hits (2 in `MON/WORM` on all-`0x80` rows) | no packed/raw map file on disk |
| Masked sliding match (`&0x80/&0x7F/&0xFF`) vs `BEL.dat`, `BEL.chip`, `EVE/BEL.MAIN` | ≤ chance | — |

## First-person view (the walker question 2)

**Slot-table renderer** (like Black Crypt), not a mosaic or per-location
picture. Evidence:

- `WAL/*.DT0` (63,072 B) and `.DT1` (26,910 B) and `DOR/*` (24,536 B) have
  **identical sizes in every dungeon** → a fixed set of pre-drawn pieces at
  fixed geometry, re-skinned per dungeon.
- A self-validating scan for 7-word blit records
  `(src, src2, x, y, words, h, flags)` with `src2-src == 3·words·2·h`
  finds a **mirrored view-slot table in `BEL.dat+0x16834`**:
  `(0,3348, x64,y38, 3w,186)`, `(4464,5820, x112,y70, 2w,113)`,
  `(6272,7232, x134/28/240, y84, 2w,80)` …, and the mirror block at
  `+0x168D4` with x = 256/224/218/112/325 — near/mid/far side walls left,
  centre, right. A second cluster at `+0x16AEE` (x 128/0/272, y 172/56) is
  likely floor/ceiling or a UI strip.
- `EVE/BEL.0` opens with the same 14-B record shape at file offset 6
  (`(9064,10804, x144,y88, 80×58)`, `(11384,12464, x144,y98, 80×36)`,
  `(12824,14720, x56,y81, 64×79)` …, x = 0/320 entries = off-screen
  halves): per-level wall-decoration pieces positioned per view slot.
- The `src2-src = 3 × plane` relation suggests src→src2 spans 3 planes, or
  that `src2` is a mask after a colour block — open
  (`evilsdoom-view-slots`). AGA depth (8 planes? 5?) is not yet pinned.

Confidence: **hypothesis, strong** (descriptor self-consistency + fixed
file sizes + mirrored X coordinates); not rendered yet.

> **Correction (2026-11-21):** the 14-B records at `BEL.dat+0x16834` are
> **not** the wall slots. They are the masked-sprite descriptor family
> (colour planes + mask, `x, y, w, h, pad`) used by draw-list cmds 2/6/7/8
> for doors and wall decorations (`+0xCF12`, `+0xD002`, `+0xD05C`). Walls use
> a separate 25-entry, 16-B table at A6+`$15DE` (§ "First-person view —
> walls (2026-11-21)"). The view is **4 bitplanes**; wall pieces are 3.

## PIC — headerless ILBM pieces

`CMAP` (768 B) then `BODY` chunk, no `FORM`/`BMHD`; chunk walk ends exactly
at EOF for 36/36 files. A plain ByteRun1 unpack of `BODY` gives
103,692–106,187 B (inconsistent, FRAME 175,272) — so either the body is not
ByteRun1, or BODY is ByteRun1 per row with geometry from code. Geometry
(320×? × 8 planes?) must come from the reader in `OUT.DAT`/`*.dat`.

| Approach | Result | Notes |
|---|---|---|
| Whole-BODY ByteRun1 | sizes vary per file, no common W×H×planes | wrong codec or wrong unit |

## Other families (unprobed beyond magic)

`MON/*` (monster banks, header `$8003 0000 0000 00nn …`), `DMD/ICONS*.CRM`
(offset tables `000000FC 000002D6 …`), `OMD/TXT.DAT` (offset table
`00000FA0 000010A2 …` → text), `CT/*`, `INT/*.bin` (mostly 286,720 B =
not a clean 320×256 multiple: 3.5 × 81,920), `EVE/*.MAIN`, `SAVE` `CHAR`/
`DATA`/`FACE`: see `docs/evilsdoom/TODO.md` rows.

## Prior art

- No public RE, no sibling corpus for Olympia Software (grep of every
  `game-re-corpora` file and sibling `docs/`).
- **P60A modules:** hunter's Embryo recon decoded signature-less P60A
  structurally (`~/Development/hunter/docs/explore/EmbryoHr/data-structure.md`
  § "p60"); libxmp/ProWizard also read P60A.
- **RNC1:** `@seer-project/pipeline` `decompressRnc1`; CrM2: `ancient`.
- Type-derived grid: same model as Dungeon Master (`docs/dungeonmaster-format.md`).

## Dungeon state block — framing (2026-11-21)

All offsets are `PRG/BEL.dat` file offsets (raw module, file offset = load
offset). **A6 = file `+0x12D26`** (`LEA d16(PC),A6 / RTS` at `+0xFB8E`, the
target of the module's first `BSR`); the other modules: CLL `+0x12BDA`, IOW
`+0x12168`, MIN `+0x12B68`, MYT `+0x12AEE`. The A6 layout shifts per module,
so `tools/evilsdoom/amigaaga/module.ts` finds every table by instruction
pattern. **Confirmed** (read from code, all five modules, sizes check against
the saves).

| | BEL | CLL | IOW | MIN | MYT |
|---|---|---|---|---|---|
| state base (A6+) / size | `$455C` / 15,128 | `$4590` / 21,248 | `$450A` / 8,460 | `$462C` / 19,440 | `$4566` / 14,460 |
| levels (slots 0-9) | 7 | 10 | 4 | 9 | 6 |
| pose words (state +) | `$278` | `$244` | `$26A` | `$25E` | `$290` |

- **Level setup:** a `BRA` table at `+0x80A4..+0x80C8` (10 entries) jumps to
  one routine per level (`+0xE3AA`, `+0xE3F6`, …) that stores five pointers:
  the **30×30 grid** (A6+`$450E`, read by the accessor `+0x9CCA`:
  `grid + y*30 + x`) and four per-level lists (A6+`$4512/$4516/$451A/$451E`).
  Levels 0-6 use `LEA d16(A6),A0`, levels 7-9 `LEA (A6),A0 / ADDA.L #d32,A0`.
  A level whose five pointers are equal is a dummy (BEL 7-9 → `$8072`).
  Grid offsets in the state block (`state + `): BEL `418 AE6 117A 19FA 203E
  271E 2FB6`; CLL `39C A1C 1050 1812 2042 282A 2DD8 35FE 3D18 471E`; IOW
  `362 A26 10BA 15A0`; MIN `3B6 A5A 1192 1824 1F68 25FC 2DE2 36FE 3CCA`; MYT
  `40C B9E 1582 1DB4 241C 2B42`. Counts match the guides (Lost Legions 10,
  Belcoon 7, Mine 7 + "levels 8 and 9 added", Mythil towers, Wisdom "3/4").
- **Party pose:** four words `level, facing, x, y` (BEL A6+`$47D4..$47DA`).
  Facing 0=N(−y) 1=E(+x) 2=S(+y) 3=W(−x): turn keys `$81` = +1, `$85` = −1
  (`+0x91AE..+0x91D4`); monster steps use the same deltas (`+0x2B66`).
  Saved poses (slot B): CLL L0 (9,16) N; BEL L0 (14,13) N; MIN L0 (1,1) E;
  MYT L1 (15,28) N (at the castle gate, a gap in row 29); IOW L0 (14,14) N.
- **Cell bits as the engine reads them** (movement `+0x9BCE/+0x9C0E/
  +0x9C4A/+0x9C80`, view builder `+0xAB72`):
  bit 7 solid; bit 7 + bit 6 = **illusory wall** (drawn, passable, message
  `$146`); open cell bit 1 = blocks (object drawn by `+0xBB56`); bit 3 =
  **door** (blocks unless its door object, looked up via `+0x4B2C`, has
  byte `+3 == $0A`); bit 2 = looked up in a per-level list at A6+`$791A`
  (`+0xBA0C`, 10-B records). Bit-2 cells coincide between consecutive levels
  of a dungeon far above chance (test `games-evilsdoom.test.ts`) — **stairs,
  hypothesis**. Bits 4/5/6 on open cells and 4/5 on solid cells select
  floor items / wall decorations (cmds 2/8; not decoded).
- **Which slot is pristine:** BEL/IOW/MIN/MYT slot B (byte-identical in
  12/12/11/10 slots). CLL has no pristine copy; slots B/C/X/Y share the
  highest solid-cell count (5,607; switches remove walls) and the party on
  L0, so the walker uses slot B and labels CLL "max-wall, not byte-pristine".
- Still open: the four per-level lists (`evilsdoom-level-lists`), what
  seeds a new game (`evilsdoom-newgame-state`).

## First-person view — walls (2026-11-21)

**Confirmed from code; rendered** (`build/cache/evilsdoom/walker-frames/`).

- **View buffer:** 368 × 274, 46 B/row, **4 planes**, plane stride `$313C`
  (clear loop `+0xBFB8`; cmd-3 blit dest modulo `$2E − 2w`). Rows 84-162
  are cleared every frame, so beyond depth 3 is colour 0.
- **View gather** (`+0xBFF6`, one branch per facing): 17 cells to
  A6+`$1872` as (right, forward): depth 3 −2..+2, depth 2 −2..+2, depth 1
  −1..+1, left, right, behind, self. Movement reads the same buffer
  (forward = cell 11, back 15, left 13, right 14).
- **Draw list** (`+0xAB72`, double-buffered A6+`$1584/$1588`, run by the
  interpreter `+0xC55C`): word commands 1-9, painter's order far → near.
  **cmd 3 = wall piece**; the 23 wall emits and their tests are transcribed
  in `tools/evilsdoom/amigaaga/view-model.ts` `wallSlots` (same emit order in
  all five modules). E.g. depth-1 centre solid → slot 0; else left solid →
  slot 5 (its right face), right solid → slot 6.
- **Wall slot table:** A6+`$15DE` (`BEL.dat +0x14304`), 25 × 16 B:
  `src.L, dst.W (byte offset in the view), w.W (words), h.W, mod.W, 4 pad`.
  Identical in all five modules. Slots 0/1/2 = front faces at depth 1/2/3
  (304/176/112 px), 3/4 depth-0 side walls, 5-14 deeper side faces, 15
  ceiling (y 0, 84 rows), 16 floor (y 163, 111 rows), 17-24 left/right
  neighbours' front faces cut from slots 0-2 by `src` + modulo. Not in the
  draw list: 15/16 (background).
- **WAL/<dng>.DT0 + .DT1** are loaded back to back (A6+`$9DE`, `$9E2`) and
  are exactly tiled by slots 0-16 at **3 planes**, plane-major per slot
  (`src(i+1) = src(i) + 3·2w·h`; DT0 ends at slot 14, DT1 = slots 15-16;
  2 or 4 planes fail the tiling). The cmd-3 blit is A→D copy into planes
  0-2 and clears plane 3, so wall pixels are colour indices 0-7.
- **Step mirroring:** `+0xD5C4` builds a mirror of the art (A6+`$9E6`,
  rows byte-reversed + bit-reversed, slots 0-16). After every successful
  move or turn (`bset #6,$15(A6)`), `+0x9CE0` swaps the two art buffers and
  swaps the `src` of slot pairs 3/4 … 13/14. Module entry forces the
  unmirrored phase (`+0x0CF0`). The walker uses `(x+y+facing)` parity
  relative to the level's start pose — exact for walking, but the game's
  phase also depends on history before the start pose (hypothesis).
- **Palette:** 16 × `$0RGB` words, `$7890`-terminated, at A6+`$77E`
  (`BEL.dat +0x134A4`): `000 765 654 543 432 321 210 100 a80 740 400 351
  230 023 046 a10`. Selected every frame at `+0x721A`; a timed spell
  (A6+`$4644`, set at `+0x5D0E`) swaps in `$7A0` (levels 0-1) or `$8B0`
  (`+0xA9EA`). Identical in all five modules. Colours are 12-bit (nibble
  × 17); BPLCON3 `$0040` in the `.chip` copper list, no LOCT writes.
- Not drawn by the walker: cmds 1/2/4-9 (doors: DOR banks through the 14-B
  descriptors at A6+`$3C4C`/`$3CF0`/`$3B04`; decorations from `EVE/*`;
  objects, floor items, monsters).

# Might & Magic III (Amiga) — data structure

Format documentation for `data/mm3/amiga/`. The Amiga port is a separate
codebase from the DOS original (same asset names, different encodings). All
binary offsets below are file-relative.

## Inventory

| File | Size | Role |
|------|------|------|
| `Might&MagicIII` | 272,088 | main executable (overlay-linked: root CODE 86,512 B + DATA 25,156 B + 8 overlay CODE segments) |
| `MM3-Intro` | 34,204 | intro executable (loads `MM3-04:intro.cc`) |
| `game.cc` | 164,597 | game data container |
| `global.cc` | 291,394 | global data container |
| `intro.cc` | 327,239 | intro data container |
| `mm3-01..05.cc` | 576–694 KB | per-disk data containers |
| `*.mx` (14) | 10–46 KB | music files (`MXTX` magic — format open) |
| `tmp.scr` | 40,000 | saved 320×200 5-plane screen dump |
| `fonts/mm3*` | | AmigaOS bitmap font |
| `libs/diskfont.library` | | Amiga library |

The exe's own strings give the data model: `MM3-GAMES:game.cc`,
`MM3-PLAY:global.cc`, `MM3-PLAY:mm3.cur`, per-disk `MM3-%s:` assigns
(`MM3-04:intro.cc`, `mm3-00:mm3-00.cc`), `maze%02u.dat`/`maze%02u.bin`
per-maze files, `MM3-GAMES:save%02u.mm3` savegames, plus `.raw`/`.bin`/
`.pic` assets that live on the floppies (not in our folder).

## The .cc container — confirmed

Loader: `initcc` (CODE payload 0x58EA) opens the file (`Open` mode
0x3ED = ACCESS_READ), reads `u16` at offset 0, computes `count*10+2`,
`Seek(fh, 0, -1)` (AmigaDOS `OFFSET_BEGINNING` = −1 — not "end"!), then
`Read(fh, buf, count*10+2)` from offset 0. Directory lookup `0x56A2`
walks 10-byte entries comparing a key. `loadseg` (0x5DAC) seeks to
`offset+4`, reads the 4-byte header, `Seek(fh, -8, 0)` (the `moveq #-8`
is the `0xF8` byte **signed** — seek back over the header), then reads
the whole entry and calls the decompressor at `0x55C4`.

```
cc file:
  u16 BE count
  count × { u16 BE key; u32 BE offset; u32 BE size }      ; 10-byte entries
  payload entries at `offset`, exactly `size` bytes each (entries tile,
  zero gap — verified 553/553)

entry payload (all but one):
  u32 BE = size - 8              ; compressed stream length (redundant)
  u32 BE = decompressed size
  LZ77 stream                   ; exactly size-8 bytes

special case: global.cc entry 0 is NOT compressed — a raw text string
("There are only %lu bytes free of ...") detected by u32@+0 != size-8.
```

### Filename key — confirmed

`key = amiga_hash(name)`, the in-exe routine at CODE payload 0x567A:
`fold16(rotl32(h, 5) + upper(c))` where `upper` uppercases chars > 0x60,
`fold16(x) = (x & 0xFFFF) + (x >> 16)`. Verified: 420 of 449 distinct keys
across the 8 files resolve to real filenames from the DOS name list (the
Amiga port kept the original filenames); the 29 unresolved are Amiga-only
additions (intro screens, `mm3.cp`, `.clp` palette/clip files, extra
`.raw`/`.vga`).

### LZ77 — confirmed

The game's decompressor at CODE payload 0x55C4 (ported to
`mm3lib/amiga_cc.py::lz_decompress`):

- Ring buffer 4096 bytes, pre-filled 0x20; write index starts 0xFEE,
  wraps `& 0xFFF`. The routine itself only pre-fills ring indices
  0x000–0xFED (4078 of 4096 bytes); indices 0xFEE–0xFFF and the whole
  "negative half" (0x800–0xFFF) start as caller-stack garbage.
  **Ring index is sign-extended `.w`**: `(a2, dX.w)` with dX in
  0x800–0xFFF addresses *below* `a2 = a6-0x1012` (into the caller's
  stack region, which also contains the routine's saved registers at
  indices 0xFCC–0xFFF). The Python port's flat `bytearray([0x20]*4096)`
  ring is behaviorally equivalent to the game's: the write cursor starts
  at 0xFEE and the first 18 writes land in the unfilled tail (0xFEE–0xFFF),
  and the byte-exact oracle below proves that initialising every ring slot
  to 0x20 (including the negative half) reproduces the game's output
  identically.
- Flag-byte bitstream, LSB-first. Bit 1 → literal byte follows; bit 0 →
  match: two bytes `{lo, hi}`: `dist = (((hi & 0xF0) << 4) | lo) & 0xFFF`
  (absolute ring position), `len = (hi & 0x0F) + 3` (the C loop
  `cmp.w d5,d4; bge` runs nibble+3 iterations).
- Loop until the declared decompressed size is reached.

**Verification — byte-exact oracle (confirmed):** the game's own routine
was run under musashi (68k emulator) in `tools/mm3_lz_harness/`
(`emu_lz.c`, pattern after the project's `tools/bcdft_decompress/`
precedent) against every LZ entry in the corpus: **552/552 entries
decode byte-identical to the Python port, 0 mismatches, 0 non-returns**
(the one raw entry, global.cc e00, is excluded). Register-level layout
notes in the harness header explain why the ring's negative half must be
pre-filled 0x20 and every register set to 0x20202020 to reproduce the
Python ring semantics. Structural invariant for reference: every LZ
entry also consumes exactly `size-8` input bytes and produces exactly the
declared output size (552/553 with the raw entry excluded).

## Screens — 320×200 5-plane (32-colour) — confirmed

40000-byte payloads (13 across the corpus) are 5 sequential bitplanes of
8000 bytes each (320×200/8), standard Amiga planar order, bit 7 = leftmost
pixel. `tmp.scr` is a saved screen of the same format.

**Palette per screen (2026-08-13).** The 7 named screens (control/create/
back/stars/computer/front/take.raw) are in-game UI/ending screens → the
static 32-word 0RGB game palette at executable DATA+0x4A62. The 6 unnamed
40000-B entries are not game-palette screens:
- `intro.cc_e1`/`intro.cc_e2` are the intro's title screens → **intro-0 /
  intro-1** (code-confirmed: the intro exe installs intro-0 at
  `intro_code1.bin+0x3CF6` and intro-1 at `+0x3E10`, each immediately
  before its screen display `jsr 0x4B6E`; screens load in file order).
- `mm3-05.cc_e2/e16/e22/e28` are ending screens → **credits-1 / credits-0 /
  credits-0 / credits-3** (best-fit by colour-smoothness heuristic —
  **hypothesis**, the exact mapping needs the main exe's ending/credits
  overlay sequence traced; the credits palettes live at DATA+0x48E0..0x49E0
  and are referenced from ovl2).

`scripts/extract_mm3_amiga_screens.py` renders all 13 with their assigned
palettes (manifest `screens/*.png` → the matching `palettes/*.json`).

## Executables — standard AmigaOS hunk format — confirmed

Both `Might&MagicIII` and `MM3-Intro` are standard LoadSeg hunk
executables (parsed with amitools `HunkReader`; same family as
`data/blackcrypt/amiga/bcdft`):

- **HUNK_HEADER** magic `0x3F3` at file 0x0. Layout (from amitools
  `HunkBlockFile.parse`): resident-lib names as `[num_longs][bytes]`
  entries terminated by a 0 long; then `table_size`, `first_hunk`,
  `last_hunk`, then `(last-first+1)` hunk sizes in longwords (upper bits
  masked — memory-type flags). (Note: `0x3F3` is amitools' HUNK_HEADER
  tag; the "0x3F3 = HUNK_SYMBOL" value from some older RKM tables does
  not match what real executables in this family use.)
- **`Might&MagicIII`**: root `HUNK_CODE` 86512 B at file 0x28, then
  `HUNK_DATA` (stored 25156 B, declared 62072 B — BSS tail), `HUNK_BSS`
  (4 B), then **9 overlay segments**, each `HUNK_HEADER → HUNK_CODE →
  HUNK_END → HUNK_BREAK` (CODE payloads 1620/6356/7092/85452/12124/
  6020/22172/11964 B). 11 hunks total, file accounted 0 → 0x426D8.
- **`MM3-Intro`**: single `HUNK_CODE` 27964 B (payload at file 0x28),
  `HUNK_DATA` (stored 4940 B, declared 7952 B), `HUNK_BSS` 4 B, then
  `HUNK_OVERLAY`. File accounted exactly.
- **SAS/C small-data model (confirmed):** `LEA $7FFE.L, A4` in both
  executables (intro CODE payload 0x5720; main root CODE payload
  0x130D6), with the operand in the RELOC32 table (reloc'd by
  `+base(hunk 1 = DATA)`), so `A4 = DATA_base + 0x7FFE`. Globals are
  `d16(A4)` displacements; library calls are `JSR d16(A6)` after loading
  the library base from an A4-relative slot (`-0x6B7A(a4)` =
  graphics.library in the intro; `-0x1CC0(a4)` etc. in the main exe).

## Music (.mx)

`MXTX` magic + note data. Format open (see TODO `mm3-mx-music`).

## Still open / paths tried

See `docs/mm3/TODO.md`.

## Amiga sprite cells — CONFIRMED (container + body, all extensions)

Monster/face/icon/pic/out files (`.mon/.fac/.icn/.pic/.out` inside the .cc
containers) share a common **container**:

```
u16 BE frameCount
frameCount × { u32 BE cellA; u32 BE cellB }      ; cellB = 0 = none
cell:
  u16 BE x; u16 BE y; u16 BE h; u16 BE w          ; NOTE: third = height!
  body (record stream, below)
```

> **Correction (2026-08-13): the cell header is `{x, y, h, w}` — the THIRD
> field is height and the FOURTH is width.** The game's geometry code reads
> field 2 as the row-count multiplier and field 3 as the row width
> (`code1.bin+0x1FE4` stores field 2 → `0x1442`, field 3 → `0x1444`;
> `mulu.w 0x1442` at +0x201A). The previous `{x,y,w,h}` reading swapped
> them, which combined with the column-major plane misread produced a 90°
> rotation in the rendered sprites (archer rendered 86×76 instead of the
> true 76×86). Fixed 2026-08-13; renders are now upright.

**Body format — record stream, extension-independent (CONFIRMED):**

```
[count u16 BE][count × u16 BE]   literal run (count < 0x8000)
[marker u16 BE]                  skip (~marker & 0xFFFF) words of zeros in
                                 dest: 0xfffe→1, 0xfffd→2, 0xfffb→4,
                                 0xfff7→8; 0xffff alone = end of stream
... until a 0xffff terminator
```

The decode loop is the game's own code: **root CODE hunk `code1.bin+0x209E`
(cellA body), `+0x20C2` (cellB body)**, reached via the A4 trampoline stub
`data4.bin+0x3C` → `JMP 0x1F64.l` (display-list sprite processor, driven
from `code1.bin+0x943C`). Found via amiga-disasm escalation (2026-08-13),
then independently re-verified from scratch (see verification below).

**Decoded bitmap layout (verified byte-exact, corpus-wide):**

- Size: exactly **6 · ceil(w/16) · h** u16 words — every frame fills the
  buffer exactly, 0 slack, 0 overflow (1811/1811 frames across all 5
  extensions).
- Plane-major: **plane 0 = 1-bit mask**, planes 1-5 = colour
  (5-bit index, contribution 1 << (p-1)).
- Within a plane: **row-major** — ceil(w/16) words per row × h rows;
  pixel (x,y) = `plane[p·ceil(w/16)·h + y·ceil(w/16) + x//16]`,
  bit `15 - (x%16)` (bit 15 = leftmost pixel of the word).
  (The earlier "column-major" description was wrong — the game computes
  `bytes_per_row = ceil(w/16)*2` from the width field and multiplies by the
  height, i.e. a standard row-major plane; see the correction above.)

**frame N = cellA OR cellB.** Both cells decode into the same 6-plane
buffer at the same (x,y,w,h) rect; the per-frame overlay (cellB) is OR-ed
on top. Confirmed by composition: spider.mon's legs live in cellB (cellA =
body outline, 1154 px; cellB = legs, 225 px; OR = full spider 1335 px);
demon.mon's wings/claws are cellB animation deltas (cellA = 4646 px body,
cellB = 0-1380 px per frame); ballface.mon's cellB is empty except a 37 px
f4 delta. cellB may be 0 (no overlay). Both cells are exactly
`6·ceil(w/16)·h` words.

**Animation frames — deduplicated in extraction.** The frame table can point
several frame indices at the same (cellA, cellB) pair (idle holds,
mirrored pairs, `.icn` UI states), so multiple frames decode to identical
(mask, colour). The extractor emits **distinct frames only** (dedupe by
mask+colour; e.g. archer 6→5, shield 6→1, `view.icn` 50→3). The game's
frame-ORDER/selection table (which sequence plays) is not decoded — see
TODO `mm3-amiga-sprite-anim`.

> **Correction (2026-08-13) — this section supersedes BOTH prior readings.**
> 1. The old ".fac/.out = raw planes, .mon/.icn/.pic = different token
>    encoding" split is **wrong**: all five extensions use the same record
>    stream. The raw-plane decode of `.fac` "worked" only because the first
>    64 words of a 32×32 face happen to be a near-solid mask rectangle —
>    the markers/records that follow were silently ignored.
> 2. The old "frame 0 = first h records" model (which passed a coherence
>    gate on 9 monsters + 1 pic) was a coincidence of row-major reading;
>    the real decode is row-major with literal/skip RLE, and it works
>    on **all** files. The old ".fac raw planes" extractor path was
>    coincidentally coherent but produced no colour and ignored most of
>    the body.
> 3. The old "cellB = [marker][count][count × u16 0RGB colour] overlay"
>    reading is retracted — cellB is the same literal/skip record stream,
>    OR-ed into the shared buffer.

**Verification (independent re-derivation, 2026-08-13):**

- **1811/1811 frames across .mon/.fac/.icn/.pic/.out decode to exactly
  `6·w·ceil(h/16)` u16 words** — zero deviation, zero overflow (structural
  invariant, blind parse).
- **All 466 monster frames render as coherent silhouettes (100 %)**, e.g.
  archer (head, bow + separate bowstring, torso, legs, boots), ballface
  (antennae + limbs), spider (body + 8 legs, OR of cellA|cellB),
  head/wizard/demon all single-blob; faces 153/153, outs 179/179, pics
  168/178, icons 373/404 coherent (remainder = legitimately multi-part
  spell/floor-trap particle effects, e.g. pow/spfx/FLR*).
- 0 mask-vs-PNG mismatches across all 1,380 rendered frames.
- Decode loop located and algorithm confirmed by amiga-disasm agent:
  `code1.bin+0x209E` (see `brief2.md`/`findings.md` in the session
  scratchpad for the full disassembly excerpts).

Extractor: `scripts/extract_mm3_amiga_sprites.py` →
`public/assets/mm3/amiga/sprites/{monsters,pics,icons,faces,outs}/` (PNG
strips, one per picture file, frames side by side) + per-file JSON
(`frames` atlas sidecar + `rawFrames` with base64 mask/colour) +
`data/sprite-catalog.json`. All 350 picture files (126 monsters, 115 pics,
42 icons, 31 faces, 36 outs) render.

### Palette — SOLVED (static tables, code-confirmed)

The sprites and screens use 5-bit colour (32 entries). The palette is
**static in the executables' DATA hunks** — the earlier "runtime-loaded,
not static" conclusion was wrong (see the correction block at the end).

**The game palette (confirmed):** 32 words of 0RGB at
`Might&MagicIII` DATA hunk payload `+0x4A62`:
`0000 0FFF 0000 0035 0531 0306 0080 0008 0742 0555 0277 005A 0963 02B2 0970
0C00 0777 0B74 05AA 000F 0044 0999 0CB0 045F 0E66 090E 029E 0E85 0BBB 0D7F
0FF1 0050`. The same table is byte-identical (32/32 words) at
`MM3-Intro` DATA payload `+0x0FB6` — **two independently-linked executables
agree**, which is the cross-exe confirmation.

**How it's installed (code-confirmed, `Might&MagicIII`):**
- Overlay seg 11 init copies it 32 words at a time into the runtime palette
  table at `A4-0x12DC` (= DATA+0x6D22, in the DATA hunk's BSS tail):
  seg 11 `0x26` `lea -0x359C(a4),a0` (source = DATA+0x4A62),
  `0x30` `lea -0x12DC(a4),a1` (dest), `0x34` `move.w (a0,d0.l),(a1,d1.l)`
  in a `d4 < 0x20` loop. Seg 15 and seg 19 copy the same table.
- LoadRGB4 (`jsr -0xC0(a6)`) installs it as screen colours: seg 1 `0x9304`
  `lea -0x12DC(a4),a0` (colors), `d0 = 0x20` (count), viewport from
  `[A4-0x1A90]+0x2C`.
- MM3-Intro does the same: its copy loop at `0x3D06` sources
  `DATA+0x0FB6` (disp `-0x713C`) into `A4-0x689A` (BSS tail, = its runtime
  table), and its LoadRGB4 at `0x5410` reads `A4-0x689A` as colors.

**Other static palettes found in the same DATA hunks:**
- Main exe DATA `+0x48E0/0x4920/0x4960/0x49A0/0x49E0` (64-byte stride =
  32 words apart) — the credits/ending overlay's 5 palettes (seg 15 uses
  them; each seg-15 write-loop has its own source, see the copy-loop table
  below).
- Intro exe DATA `+0x0EC2/0x0F02/0x0F42` — intro/title screen palettes
  (0x0FB6 is the shared game palette above).

Copy-loop source table (all `lea disp(a4),a0` → `lea -0x12DC(a4),a1` →
`move.w` ×32; `DATA off = 0x7FFE + disp`):

| Executable | seg | copy @ | source disp | source DATA+ |
|---|---|---|---|---|
| main | 11 | 0x30 | -0x359C | 0x4A62 (game) |
| main | 1 | 0x903C | -0x359C | 0x4A62 (game) |
| main | 19 | 0x376 | -0x359C | 0x4A62 (game) |
| main | 15 | 0x030/0x378 | -0x371E | 0x48E0 (credits-0) |
| main | 15 | 0x480 | -0x36DE | 0x4920 (credits-1) |
| main | 15 | 0xD66 | -0x369E | 0x4960 (credits-2) |
| main | 15 | 0xFB8 | -0x365E | 0x49A0 (credits-3) |
| main | 15 | 0x1224 | -0x361E | 0x49E0 (credits-4) |
| intro | — | 0x3D06 | -0x713C | 0x0EC2 (intro-0) |
| intro | — | 0x3E1A | -0x70FC | 0x0F02 (intro-1) |
| intro | — | 0x3E7C | -0x70BC | 0x0F42 (intro-2) |
| intro | — | 0x52C2 | -0x7048 | 0x0FB6 (game) |

**Screens rendered:** `scripts/extract_mm3_amiga_screens.py` writes the 10
palettes to `palettes/*.json` and renders all 13 40000-byte screens
(320×200 5-plane) with the game palette to `screens/*.png`, plus
`data/screens.json` and a 32-colour swatch strip. All are in the viewer
manifest (279 entries total). Palette assets render as data tables; screens
as 320×200 atlases with a 32-swatch palette bar.

> **Correction:** the previous version of this section said the palette
> values are "loaded at runtime from `.vga`/`.raw`/`.clp` files into heap
> buffers, not static in the executables". That was wrong. The palette is
> static at DATA+0x4A62 (main) / DATA+0x0FB6 (intro); what is runtime-loaded
> is only the *copy* into the BSS-tail runtime table (`A4-0x12DC`) and the
> `AllocMem` viewport buffers `[A4-0x1A90]+0x2C` / `[A4-0x6A96]+0x2C` (those
> hold a ViewPort/copper struct, not the palette words). The earlier
> `palette-candidates.json` (0x4AC0/0x4B1C/0x4B8A) and the 0x48E0/0x4B5A
> "warm/cold" readings are still retracted — 0x48E0 *is* a real palette
> (credits-0), but 0x4B1C/0x4B8A/0x4AC0 are not palettes.

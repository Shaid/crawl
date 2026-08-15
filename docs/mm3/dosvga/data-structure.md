# Might & Magic III (DOS/VGA) — data structure

Format documentation for `data/mm3/dosvga/`. All offsets file-relative.

## Inventory

| File | Size | Role |
|------|------|------|
| `MM3.CC` | 3,430,389 | the game data archive (558 entries) |
| `MM3.EXE` | 280,032 | packed executable (Executrix by Knowledge Dynamics + Borland TLINK; uncompressed FBOV overlay at 0x286C0) |
| `MM3.CUR` | 207,551 | current-game data — **CC archive**, the maze/wall-layout archive (240/240 entries named: `maze<N>.dat`/`.bin`/`.evt` + `maze.nam`/`.chr`/`.pty`) — **SOLVED**, see "Maze records" below |
| `MM3.CFG` | 4 | `00 01 20 02` (sound config) |
| `Mm3.com` | 776 | copy-protection loader: hooks `INT 21h`, patches a far call in the loaded MM3.EXE to a short jump on file-close — not a plain overlay stub |
| `MM3.$$$` | 28,600 | 8-bit PCM scratch (byte histogram clustered 0x97–0xD8) — not a CC archive |
| `Manual.pdf` / `keys_3_5.pdf` | | manual + key chart (naming oracle) |

## MM3.CC container — confirmed

Same container family as MM4/5 (`Xeen`) but with MM3-specific filename
hash, header cipher and compression. Documented by ReWolf
(`https://github.com/rwfpl/rewolf-mm3-dumper`,
`http://blog.rewolf.pl/blog/?p=1202`); this project's Python port
(`scripts/mm3lib/dos_cc.py`) is verified byte-exact against the compiled
reference on **all 556 compressed entries**.

```
FileHeader { u16 LE numEntries; FileEntry entries[numEntries]; }   ; 8-byte entries
FileEntry  { u16 hash; u16 offsetLo; u8 offsetHi; u16 compressedSize; u8 pad; }
             offset = (offsetHi << 16) | offsetLo (file-relative)

Header cipher (decrypt): key = 0xAC; per byte: b = rotl8(b,2) + key; key += 0x67
Filename hash: h = rotl16(h, 9) + upper(c)   ; upper: (c & 0x7F) < 0x60 ? c : c - 0x20

Entries 0 and 1 are special (uncompressed strings — copy-protection text).
All other entries: 4-byte descriptor { u8 init; u8 init; u16 BE decSize }
followed by an LZHUF stream (canonical lzhuf.c with per-stream dictionary
init byte = most-common byte of the output).
```

**Verification:** 541/558 entries resolve to real filenames; 556/556
compressed entries decode byte-identical to the reference C++ output
(0x00-padded stream tails, matching the C reference's past-end reads).

## Asset formats (by extension)

| Ext | Count | Format | Status |
|-----|-------|--------|--------|
| `.raw` | 12 | 64000 B = 320×200 raw 8-bit VGA screen (no palette in file) | **confirmed** geometry + palette (see "DOS 256-colour palette" below) |
| `.vga` | 120 | sprite container (wall/terrain/UI animation frames) | **confirmed** — container, cells, and scanline RLE (see "Scanline opcode grammar") |
| `.mon` | 81 | monster sprites, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.fac` | 31 | character faces, same container (32×32 cells) | **confirmed** — container, cells, and scanline RLE |
| `.icn` | 52 | UI icons (36×20 cells) | **confirmed** — container, cells, and scanline RLE |
| `.pic` | 63 | object/screen art, same container | **confirmed** — container, cells, and scanline RLE |
| `.out` | 42 | full-screen UI art, same container | **confirmed** — container, cells, and scanline RLE |
| `.maz` | 64 | map-section text: small records `\x02 <name> \x01\x00` (location names) + big records `\x03 <section> (\x0b <3-digit index>)? <description> \x00...` (area descriptions) | **confirmed** framing + text extracted to `maze-text.json` |
| `.dat` | 22 | monster stat tables, **90 values each** (90 = monster-type count; per-field width inferred from payload length: `MonHP.dat`/`MonGems.dat` = u16 LE, `MonExp.dat`/`MonGold.dat` = u32 LE, the rest u8) | **confirmed** shapes + counts + widths; monster-id order is the game-internal table order, **61/90 ids name-mapped** (see below) |
| `.s` | 7 | unsigned 8-bit PCM speech, 8000 Hz | **confirmed** (ModdingWiki + byte histogram); converted to WAV |
| `.m` | 15 | music (format open) | open |
| `.til` | 6 | minimap tile sets, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.sky` | 3 | sky images, same sprite container | **confirmed** — container, cells, and scanline RLE (not raw 320×200 as earlier guessed) |
| `.brd` | 4 | battle-board layouts, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.spl` | 4 | special screens | open — **not** the sprite container (unlike `.til`/`.sky`/`.brd`) |
| `.drv` | 8 | per-sound-card drivers (incl. embedded SFX) | open |
| `.bin` | 6 | text data (`spldesc`, `jester`, `award`, `tavern`, `quest`, `copy`) | **confirmed** null-separated text |

Unnamed entries (16) identified by content: 2 copy-protection strings,
intro text ("In the days when Fountain Head..."), 4 map-text files
("The Arena", "No text in this file."), 7 extra speech files
(0x8631–0x8637, 80-centered PCM), 1 object sprite (0x7A39). Entry `0x8F99`
is now named — it's `vga`, the VGA display driver (x86 code; see "DOS
256-colour palette" below) — retracting the earlier "1 monster sprite"
classification.

### `.dat` monster id → name mapping — **61/90 confirmed**

The internal monster-id order (index into every `Mon*.dat` table) isn't
shipped with a name table anywhere in the game data. Resolved by
cross-referencing each id's decoded `(HP, AC, Speed, NumAttacks)` 4-field
fingerprint against the community bestiary at
[shrines.rpgclassics.com/pc/mm3/monsters.shtml](https://shrines.rpgclassics.com/pc/mm3/monsters.shtml)
(89 monsters, alphabetical, itself sourced from the game). 61/90 ids
matched a unique name with all 4 fields exact and **zero ambiguity** — no
name matched more than one id, no id matched more than one name (e.g. id
56 = `333/16/33/6` = Major Demon, id 66 = `666/33/66/4` = Major Devil).

8 more ids have a plausible 3-of-4-field near match (Goblin, Cryo Spore,
Castle Guard, Gargoyle, Cult Leader, Mummy, Rat Overlord, Mummy King) —
each differs from its candidate in exactly one field (usually Speed or
NumAttacks), which could be a genuine game-version stat revision or a
bestiary transcription error; **not** included in the confirmed mapping.
21 ids have no candidate at all — the bestiary lists 89 names against 90
internal ids, so at least one monster is unlisted there.
→ `scripts/mm3lib/mm3_monster_names.json` (mapping + evidence),
`data/monster-stats.json` (`names` array, extractor-attached).

## Sprite container — **SOLVED** (container, cells, scanline RLE)

```
u16 frameCount
frameCount × { u16 cell1Offset; u16 cell2Offset }     ; cell2 = 0 = none
cells at offsets: { u16 xoff; u16 w; u16 yoff; u16 h } + scanline RLE
```

Shared by `.vga/.mon/.fac/.icn/.pic/.out/.til/.brd/.sky` (`.spl` is a
different, still-open format). A frame is cell1 drawn, then cell2 drawn
over it where present. Cell geometry verifies across hundreds of files
(e.g. `caswl1.vga`: 13 frames, 168-wide wall cells; `dwarf1.fac`: 32×32
face cells; `cast.icn`: 36×20 icons). This container is only
superficially "Xeen-style" (MM4/5) — the frame/cell headers match, but
the scanline opcode grammar below **does not**; see the correction.

### Line framing — **confirmed**

```
cell at offset: { u16 xoff; u16 w; u16 yoff; u16 h }
per row:        u16 LE lineLength        ; 0 = blank (fully transparent) row, 2 bytes total
                u16 LE xSkip              ; starting x within the cell — a real u16,
                                          often non-zero (only its high byte is always 0)
                opcode stream             ; lineLength = 2 + nopcode bytes
```

The row loop terminates only on landing **exactly** at `lineLength` — an
opcode stream that overran the line would run the decoder away, so the
encoder can never emit one (confirmed from the driver's `cmp si,bp / je`
exit condition, not inferred). Cell `width` is **not** a scanline bound:
the non-mirrored blit path skips the width field entirely
(`vga`+0x1DAE `inc si; inc si`) — only the horizontal-mirror variant
reads it, for its right-to-left origin. A line legitimately emits fewer
than `width` pixels; trailing transparent pixels simply aren't encoded.

### Scanline opcode grammar — **SOLVED**

MM3 is **not** the MM4/5 Xeen grammar (3-bit cmd + 5-bit len, 8 opcode
classes, pattern/ramp + stream-copy commands) — that earlier assumption
only coincidentally decoded 76–93% of lines per extension, then desynced.
The real grammar has three commands, found by disassembling the game's
own blitter (below):

| Opcode | Bytes | Meaning |
|--------|-------|---------|
| `0x00`–`0x7F` | `1 + (op+1)` | **literal run**: next `op+1` bytes are palette indices (1–128 px) |
| `0x80`–`0xBF` | `1` | **transparent skip** of `(op & 0x3F) + 1` px (1–64) — destination advances, source untouched |
| `0xC0`–`0xFF` | `2` | **run**: next byte is a palette index, drawn `(op & 0x3F) + 3` times (3–66) |

There is no fill/stream-copy/pair/pattern command and no ramp table (a
corpus-wide byte search for Xeen's `PATTERN_STEPS` table returns zero
hits anywhere in `MM3.EXE`, the reconstructed exe, the `vga` driver, or
any of the 558 `MM3.CC` entries). The end-of-line-truncation hypothesis
from the earlier pass is **refuted** — there is no clamp anywhere in the
decoder; every opcode always lands exactly on the line boundary.

**Decoder location** (not in `MM3.EXE` — same pattern as the palette):
the blitter lives in the `MM3.CC` VGA display driver (entry hash
`0x8F99`, filename `vga`, see "DOS 256-colour palette" below). API
jump-table entry 7 (`vga`+0x0E92, called with `[bp+8]`=sprite-file
segment, `[bp+0xA]`=frame index, `[bp+0xC/0xE]`=dest x/y, `[bp+0x10]`=flags
— flag bit 0 selects horizontal mirror) → dispatcher `vga`+0x1D70 → row
loop `vga`+0x1DC2–0x1E20 (mirrored variant at `vga`+0x1E22–0x1E36; the
mirror's `std`/`dec di` confirms it's real, not a decode artifact). 9
total blit variants share the byte-identical opcode core (`and cl,0x3f /
add cl,0x3` and `and ax,0x3f / inc ax`, verified at all 18 call sites);
the 4 non-mirror variants (shadow/translucent/scaled draws?) are
unidentified — see TODO `mm3-dos-blit-variants`.

**Verification** — two independent whole-corpus invariants, **zero
deviation** across all 402 sprite-container files:
- **Byte-framing**: every cell ends exactly at the next cell offset from
  the frame table, and every line's opcode stream lands exactly on its
  declared `lineLength` — **3,823/3,823 cells, 157,330/157,330 lines**
  (`scripts/verify_mm3_dos_sprites.py`).
- **Pixel-bound**: every line's `xSkip + pixels-emitted ≤ cell width` —
  **0/157,330 overruns** (vs. 17,664 overruns, 14% of "exact" lines,
  under the old Xeen grammar).
- **Cross-port mask check** against the byte-exact-verified Amiga port:
  `archer.mon` 5/5 frames, 0 mask mismatches; corpus-wide 821/1,292
  shared frames pixel-exact, DOS-only (possibly-spurious) pixels
  0.58% and one-sided (the DOS mask is a strict subset of Amiga's in
  1,062/1,292 frames — cross-port art differences, not a DOS decode bug).
  Independent re-check on the 32×32 `.fac` faces: 32/33 face cells
  decode with every row filling exactly `width` px (the lone exception,
  `elf3.fac` row 13, has one genuine transparent pixel — a skip opcode in
  the art), and the DOS decode's palette-index colours map 1:1 onto the
  Amiga face colours (e.g. DOS index 11 → `(161,161,161)` vs Amiga
  `(153,153,153)` — the ports' own 6-bit vs 5-bit palettes), confirming
  both the grammar and the palette from the data side.
- Renders (`build/cache/mm3/dos-sprite-renders/`) at the confirmed
  256-colour palette: `archer.mon` (blue-tunic archer drawing a bow),
  `beholder.mon`, `bank.out`, `caswl1.vga`, `castle.til`, `dwarf1.fac` —
  all coherent, recognisable art.

→ `scripts/mm3lib/dos_sprite.py` (decoder, every rule cites its `vga`+
offset), `scripts/verify_mm3_dos_sprites.py` (corpus verifier). Wired into
the extractor/viewer pipeline via `scripts/extract_mm3_dos_sprites.py`
(`mm3-dos-sprite-pipeline` closed) — every sprite-container file renders
to a PNG strip + JSON sidecar under `public/assets/mm3/dosvga/sprites/`,
hooked into `tools/shared/game-config.ts`'s mm3/dosvga `buildAssets`.

## Maze records — **SOLVED** (`MM3.CUR`)

The dungeon/town wall-layout data — what MM1 calls `MAZEDATA.DTA` and MM2
calls `map.dat` — is **not** in the read-only `MM3.CC`. It's in
`MM3.CUR`, the "current game" archive, because the game mutates it at
runtime (doors opened, walls destroyed, visited-cell tracking) and writes
it back — `MM3.CUR` is simultaneously the pristine static layout *and*
the save state. `MM3.CC` has zero maze records; `MM3.CUR` parses with the
same `dos_cc` container reader into **240 entries, 240/240 now named**:

| Entries | Names | Contents |
|---|---|---|
| 3 | `maze.nam`, `maze.chr`, `maze.pty` | misc (31/9090/918 B) |
| 105 | `maze1.dat`…`maze103.dat`, `maze105.dat`, `maze106.dat` | **832 B each, raw (not LZHUF)** — wall/cell grid, id 104 absent |
| 66 | `maze1.bin`…`maze64.bin`, `maze105/106.bin` | object + monster placement |
| 66 | `maze1.evt`…`maze64.evt`, `maze105/106.evt` | Xeen-format event records |

`832` is the game's own constant (`muls.w #0x340` at the loader and 63
other sites in the Amiga executable). Filenames beyond `maze99` render
with 3 digits, which is why an earlier `maze%02u` (2-digit) filename-hash
sweep against `MM3.CC` and the Amiga `.cc` files found nothing real — it
was searching the wrong container *and* missing the 3-digit ids. (Two
false-positive hash collisions were caught and discarded along the way:
`MAZE72/73.DAT`'s hash collides with the real `takb1.vga`/`takb2.vga`,
and `MAZE95-98.DAT`'s collides with `elf1-4.fac` — the 16-bit hash is
known to collide freely, so a name match alone is never sufficient
evidence; see the "MM3.CC container" section above.)

### `maze<N>.dat` — 832 B (confirmed)

```
0x000  512 B  wall grid  : 16x16 u16 LE, index = y*16 + x
0x200  256 B  cell grid  : 16x16 u8,     index = y*16 + x
0x300   64 B  trailer
```

The loader keeps 4 records resident at a time (`cmpi.w #4` in the Amiga
exe) — a 2x2 block forming one 32x32 area, which is why event coordinates
run 0..31 rather than 0..15.

**Orientation: x increases EAST, y increases NORTH** (y = 0 is the south
edge; renders here flip y so north is up, matching the game's own maps).

**Wall u16 — four 4-bit sides, each = 3-bit graphic index + 1 blocking
bit** (word reads N E S W left-to-right in hex):

| Bits | Side | graphic-index mask | blocking-bit mask |
|---|---|---|---|
| 0–3 | West | `0x0007` | `0x0008` |
| 4–7 | South | `0x0070` | `0x0080` |
| 8–11 | East | `0x0700` | `0x0800` |
| 12–15 | North | `0x7000` | `0x8000` |

`0x9999` = solid rock on all four sides; `0x0000` = fully open. The 3+1
split (never a full 4-bit wall-type value) is confirmed from all 16 call
sites of the wall accessor, each passing exactly one of
`0x7/0x70/0x700/0x7000` or `0x8/0x80/0x800/0x8000`, and the
direction↔mask mapping is confirmed from the line-of-sight/step-check
code: stepping east tests the target cell's `0x0008` (its **west** wall),
stepping west tests `0x0800` (its **east** wall), stepping north tests
`0x8000` (its **north** wall), stepping south tests `0x0080` (its
**south** wall) — i.e. you always test the wall facing back at you.
Accessor: `addr = mazeRecord[slot] + ((y&0xF)<<5) + ((x&0xF)<<1)`, returns
`u16 & mask`, or `0x1111` (all sides blocked) if off-map.

This is **not** Xeen's (MM4/5) `MazeData` — MM3's nibble→direction order
is the reverse of Xeen's (Xeen: bits 0–3 = North; MM3: bits 0–3 = West),
and Xeen uses a full 4-bit wall-type value where MM3 splits 3+1.
Assuming Xeen-compatibility here would silently produce a
plausible-looking but 90°-rotated decode.

**Outdoor mazes (ids 41–64) are a different union member**: the same u16
is terrain layers (low nibble = surface variant, the other three =
overlay/sprite layers), not per-side walls — detected via "graphic-set
table at trailer +0x00 is nonzero" (true for exactly those 24 ids and no
others). The 6x4 outdoor grid tiles as `section = 41 + 4*col + row`
(A1=41 … F4=64), matching the world's `n+4 = east, n+1 = south` layout —
see the world-map verification below. The individual overlay-layer roles
(surface vs. the 3 higher layers) aren't code-traced yet — see TODO
`mm3-maze-outdoor-layers`.

### Trailer `0x300..0x33F` (confirmed unless noted)

Every byte in `0x300..0x31E` is referenced by name at a specific code
site in the Amiga executable (full census, 68 sites) — no unexplained
bytes in the header half.

| Off | Field |
|---|---|
| +0x00..06 | 7 x graphic-set id; a wall's 3-bit index N (1..7) selects entry N−1, looked up 1-based in a global name table and loaded as `<name>.vga` |
| +0x07 | percentage-chance field |
| +0x08/09/0A/0B | surrounding maze id: **North / East / South / West** (used when stepping off the 16x16 edge) |
| +0x0C | saving allowed ("…no saving in this maze.") |
| +0x0D | flag, map-timer related |
| +0x0E | resting allowed ("Too dangerous to rest here!") |
| +0x0F | dismiss allowed ("Too dangerous to dismiss here!") |
| +0x10 | 0 in all 105 records |
| +0x11/0x12 | percentage-chance fields |
| +0x13 | **run/start position**: low nibble = x, high nibble = y |
| +0x14..1A | 7 x 0/1 permission flags |
| +0x1B..1E | 4 percentage-chance fields |
| +0x1F | **maze number** (u8) — matches the filename id in 104/105 records (`maze89.dat` stores 0 in its own number byte; its neighbours reference it correctly and its wall grid is unique, so this is an original-data quirk, not a decode bug) |
| +0x20..3F | **256-bit seen/visited bitmap**, bit index = y\*16+x (all-zero in the shipped file — the game sets bits as the party explores, then writes the record back) |

### `maze<N>.evt` — event records (confirmed framing)

`[len][x][y][direction][line][opcode][params…]`, record size = `1+len`,
`len` = 5 + params. x/y run 0..31 (the 2x2-block coordinate space).
11,028 records parse across the 66 files.

### `maze<N>.bin` — objects + monsters (**partial**, 59/66 files)

```
[{x, y, packed}]*   3-byte object records; packed&3 = facing, packed>>2 = sprite type
0xFF                record-aligned terminator (only tested at record boundaries)
[5 bytes]           the maze's 5 monster-type ids, 0xFF = unused slot
[{x, y, typeIdx}]*  3-byte monster records; typeIdx 0..4 indexes those 5 ids
```

Object slots with `x == 128` are unused. Two corpus-wide invariants hold
across the 59 clean files: **0 monster records reference an unused
(0xFF) type slot**, and **1357/1357 resolved monster type ids are valid
0..89 indices into the already-decoded `Mon*.dat` stat tables** — `.bin`
links placement directly to the monster-stats work earlier in this doc.
The 7 stragglers desync in the object list (not the monster list) — the
reader has a conditional branch implying some object records aren't a
flat 3 bytes; see TODO `mm3-maze-bin`.

### Graphics environment — which wall/tile/sky/music a maze uses — **SOLVED**

Not a maze-record field at all — **the trailer's 7-entry graphic-set
table (above) is outdoor-terrain-only** (all-zero for every one of the 81
indoor mazes; only the 24 outdoor mazes populate it, values 1–18, used
for terrain/overlay sprite layers per the outdoor union member). Indoor
wall/tile/sky/music selection is a **40-byte constant table inside the
game's own code**, indexed by `mazeId - 1`, read by `LoadMazeGraphics()`
— confirmed byte-identical between both ports:

| | Amiga (`Might&MagicIII`) | DOS (`MM3_original_reconstructed.exe`) |
|---|---|---|
| `LoadMazeGraphics` routine | file 0x8D66–0x8FC2 (via A4 jump-table stub file 0x15C9C) | file 0x34768–0x34978, an **FBOV overlay segment** (not root code — why a root-code string search for `%swl%u.vga` finds nothing) |
| `ENV[40]` table | file 0x1A06B | file 0x1B9D2 |
| `LOAD_ORDER[4]` = `{1,2,4,3}` | file 0x186E4 | file 0x1B9FA |
| prefix/tile/terrain name tables | file 0x19734 | file 0x1E324 |
| maze name table (65+ entries, index `mazeId-1`) | — | file 0x1E074 |

`ENV[mazeId-1]` (0–4) selects a 5-entry prefix table `twn/cav/dun/cas/sci`
and sprintfs `"%swl%u.vga"` (the 4 distance-variant wall files),
`"<prefix>.til"` (minimap tileset) and `"<prefix>.sky"` (ceiling —
`twn`/`cas` ship no `.sky`, per retail data). Outdoor mazes (`idx >= 40`,
i.e. mazeId ≥ 41 — exactly the 24 world-map sections) instead load the
trailer's 7 graphic-set ids through `TERRAIN_NAMES[18]` (`mount, ltree,
dtree, higrass, snotree, snomtn, swmtree, mount, lavamtn, palms, mount,
grass, dirt, snow, swamp, lava, desert, road`, index = id−1) plus
`water.vga`.

**Mapping** (`ENV` value → ids → series):

| mazeId | env | wall series | tile | sky | music |
|---|---|---|---|---|---|
| 1–5 | 0 | `twn` (town) | `town.til` | *(none shipped)* | `medieval.m` |
| 6–15 | 1 | `cav` (cavern) | `cave.til` | `cav.sky` | `caves.m` |
| 16–23 | 2 | `dun` (dungeon) | `dung.til` | `dun.sky` | `eerie.m` |
| 24–28 | 3 | `cas` (castle) | `castle.til` | *(none shipped)* | `city.m` |
| 29–33 | 2 | `dun` (castle dungeons) | `dung.til` | `dun.sky` | `eerie.m` |
| 34–40 | 4 | `sci` (spaceship sectors) | `scifi.til` | `sci.sky` | `cyber.m` |
| 41–64 | — | *(outdoor, no walls)* | `out.til` | `day`/`night.vga` | `venture.m` |
| 105, 106 | 2 | `dun` | `dung.til` | `dun.sky` | `eerie.m` |

Mazes 65–103 (the extra 2×2-block quadrants of the 13 multi-block caverns
and dungeons, ids 11–23) inherit their **primary** id's series — the
engine only ever calls `LoadMazeGraphics` with the primary. `mazeId` 105
and 106 are remapped to `mazeId` 16 (`dun`) by an explicit
`idx==104||idx==105 → idx=15` special case in the loader (the only two
ids shipped above the 1..103 run — there is no maze 104).

**Verification, three independent encodings of the same six groups:**
all six `ENV` run boundaries (5, 15, 23, 28, 33, 40) coincide exactly with
(a) the engine's own maze-name-table group boundaries (e.g. entries
16–23 are all named like dungeons: "Ancient Temple of Moo" … "The Maze
From Hell"; 24–28 are "Castle Whiteshield" … "Castle Blackwind"), and (b)
independently with the **music** table's range boundaries
(`medieval → caves → eerie → city → eerie → cyber → venture`). Every
`wallFiles` entry the resolved mapping emits is checked against the
already-extracted sprite catalog — 0 missing across all 81 indoor mazes.
→ `scripts/mm3lib/dos_maze.py` `resolve_graphics()`, output in
`data/mazes.json` per-maze `.graphics` (`wallSeries`, `wallFiles`, `tile`,
`sky`, `music`, `areaName`). Wired into the walker
(`tools/walker/games-mm3.ts`).

### Indoor 3-D view — which wall file/frame renders at each screen position — **SOLVED**

A three-stage pipeline, all confirmed by disassembly and render-verified
against real `MM3.CUR` data. All offsets are file offsets into
`build/cache/mm3/MM3_original_reconstructed.exe` unless prefixed `vga+`
(offsets into the decompressed `MM3.CC` `vga` driver, entry hash `0x8F99`
— see "DOS 256-colour palette" above).

**Stage 1 — `BuildWallFlags`, file `0xC395`–`0xDD3C`.** 44 hand-unrolled
*view slots* (not the same slot numbering as this project's own
MM1/MM2-derived frustum engine, `tools/walker-mm/maze3d.ts` — MM3's
internal geometry is its own, richer system). Per slot: read a fixed
`(dx, dy)` offset from the party's position (tables at file `0x12C8`
dx / `0x1380` dy, indexed `facing*0x2E + slot`, facing order **N, S, E,
W** — not the usual N,E,S,W), sample that cell's wall word with a
per-slot mask/shift (`0x1438`/`0x1598`), and dispatch the wall's 3-bit
graphic index (1–7) through a **per-slot** 7-arm jump table (44 separate
tables, `0xDD2F` down to `0xDAD5`, step −14 — an earlier pass mistook
slot 0's table for the only one). Each arm just sets small flag globals;
nothing is drawn yet.

**Stage 2 — `BuildWallList`, file `0xE607`–`0x105FD` (+`0xDD3D`–`0xE606`).**
Turns the flags into a **variable-length command stream** in a BSS buffer
at DS `0xD66E` (4000 B — name and capacity from the game's own overflow
message, `"…WallList New Max = %u - %u"`, DS `0x125B`):

```
0xFFFF, ptrOff, ptrSeg     ; set current sprite (ptrSeg == 0 ends the list)
x, y, flags, frame         ; blit current sprite (screen-absolute x/y)
```

**Stage 3 — the walker, `vga`+0x1BB8** (API entry 0, `vga`+0x0F3C
`drawWallList(far*)` — **not in the exe at all**, which is why a
whole-exe search for the list grammar found nothing). Reads the stream
exactly as above; `frame*4 + 2` lands on the sprite container's own
`cell1Offset` field (an independent cross-check of the container format
documented above). Dispatches to the already-documented blit routine
(`vga`+0x1D70) with `flags` bit 0 = horizontal mirror, bit 1 = **clip to
the 3-D view window** (`vga`+0x2158, hard-codes x ∈ [8, 224) — 216 px —
partially answers `mm3-dos-blit-variants`; bits 8–9/15 remain
unidentified).

**wl4 usage** (`<series>wl4.vga` — every series has 31 frames, not one
216×71 sprite as an earlier pass's bounding-box read implied): frame 29
(the only 216×71 cell) draws **once per screen** at (8, 67) as the floor
backdrop, under a `<series>.sky` ceiling at (8, 8) (absent for `twn`/`cas`,
which ship no `.sky`). wl4 is *also* the sprite for the two farthest view
rows' oblique side pieces (25 more per-slot draws, small frames) — left
and right are the same frames mirrored via flags bit 0.

**Graphic index → frame**, front-facing walls (wl1 depth-0 / wl2 depth-1 /
wl3 depth-2+3 / wl4 depth-3+4 oblique):

| index | meaning | wl1 | wl2 | wl3 | wl4 |
|---|---|---|---|---|---|
| 1 | plain wall | 0 | 0 | 0 | 0 |
| 2 | barred wooden door | 6 | 6 | 7 | 14 |
| 3 | wall torch (animated, cycles 3 frames) | 1–3 | 1–3 | 1–3 | 1–3 |
| 4 | studded door / grate | 8 | 8 | 9 | 16 |
| 5 | cave mouth (never occurs in shipped indoor data) | 9 | 9 | 10 | 17 |
| 6 | open doorway | 7 | 7 | 8 | 15 |
| 7 | post / pillar | 10 | 10 | 11 | 18 |

Side-wall slots (not front-facing) use a **2-entry alternating pair**
instead of a fixed frame per index, indexed by a 1-bit toggle at DS
`0x185` (flipped roughly once per redraw) — this is what makes a corridor
wall appear to "slide past" as you walk. Right-side slots read the
opposite bit (`1 - [0x185]`) from left, so the two sides alternate out of
phase.

**Verified**: reimplemented both builders directly from the binary and
simulated all 81 indoor mazes × 256 cells × 4 facings × 2 alternator
states × 3 torch phases (497,664 views) → 8,248,236 draw commands, **0
out-of-range frame references** against the real sprite containers; 178
of 178 kind-arm draw blocks matched to a slot with 0 unmatched. Rendered
real positions from real `MM3.CUR` data with the confirmed palette and
scanline decoder: a barred door, a studded door, a colonnaded post hall
with correct depth progression, lit cave torches, and full castle/town/
sci-fi/cave interiors — all coherent. Independently confirmed end-to-end
in the walker itself: maze 16 ("Ancient Temple of Moo") cell (13,5)
facing east has graphic index 2 and renders `dunwl1.vga` frame 6 (the
barred-door frame), matching the table above exactly
(`tools/walker/__tests__/games-mm3.test.ts`).

**Wired into the walker** (`tools/walker/games-mm3.ts`) for **depth-0
front walls only** — that position is exhaustively confirmed to
correspond exactly to `wallBlocked`/`wallGraphicIndex` on the party's
current cell, so there's no ambiguity about which cell/direction it
represents. Depths 1–3 front, and all side walls, are not wired to this
table yet: doing so means porting MM3's own 44-slot geometry (Stage 1
above) instead of reusing the shared MM1/MM2 frustum engine, since that
engine doesn't expose "which cell and direction does this particular
screen slot sample" per blit the way MM3's own `dx`/`dy` tables do — see
TODO `mm3-maze-wall-frames`.

### Verification

`scripts/verify_mm3_dos_mazes.py` (corpus invariants) and
`scripts/verify_mm3_blackwind_route.py` (an independent human-authored
oracle), both reproduced independently:

| Check | Result |
|---|---|
| `MM3.CUR` entries resolved to a name | 240/240 |
| 832-byte raw records | 105/105 |
| stored maze number (+0x1F) == filename id | 104/105 (`maze89` quirk above) |
| wall blocking-bit symmetric across every interior wall (81 indoor mazes) | 38,878/38,880 (99.995%) |
| surrounding-maze links reciprocal | 178/186 (95.7%; failures confined to 2 of 14 castle 2x2 blocks — original-data errors) |
| open map edge <-> surrounding-maze link agrees | 309/324 (95.4%) |
| surrounding table agrees with the 6x4 world tiling | 24/24 |

Two independent shipped-art oracles, both reproduced:

- **The world map poster** (`data/mm3/amiga/Docs/World Map.jpg`, a
  hand-illustrated 6x4 lettered A1..F4 grid). Rendering the 24 outdoor
  sections with the decoded terrain nibble reproduces the poster
  section-for-section — visually confirmed: the isolated diamond-shaped
  "Isle of Fire" island, the Frozen Isles as separate pale blobs, the
  large forested western continent, and — the most specific match — a
  literal checkerboard-textured "Thorn Blossom Orchard" in the reference
  art landing in the exact same grid cell in the render. →
  `public/assets/mm3/dosvga/maps/world.png`.
- **The Castle Blackwind route map**
  (`data/mm3/amiga/Docs/mm3-map-castleblackwind.gif`, a hand-drawn
  16x16 arrow path, 109 arrows). Testing whether each arrow's indicated
  step crosses a blocking wall: **maze33 scores 108/109** (the one
  "failure" is the arrow walking off the map's south edge, i.e. the
  exit) against a **31.4% corpus mean** across the 81 indoor mazes — and
  `maze33` is independently confirmed as Castle Blackwind by its own
  `.maz` text ("A ladder up to Castle Blackwind…", "The statue of Hamon
  Othreute, Warlord of Castle Blackwind").

→ `scripts/mm3lib/dos_maze.py` (decoder, every field cites its Amiga
file offset), `scripts/extract_mm3_dos_mazes.py` (wired into
`tools/shared/game-config.ts`'s mm3/dosvga `buildAssets` —
`data/mazes.json`, `maps/maze<NN>.png` for the 81 indoor mazes,
`maps/world.png` for the outdoor composite). Not yet consumed by any
viewer/walker — see TODO `mm3-maze-viewer`.

## MM3.EXE / palette

MM3.EXE is Executrix-packed; the uncompressed FBOV overlay (46 segments,
`ovrsize` 0x1BF10) holds game code.

### DOS 256-colour palette — **SOLVED**

The palette is **not in MM3.EXE**. MM3.EXE never touches the VGA DAC and
never calls `INT 10h AH=10h`; all VGA work lives in a display driver
loaded from `MM3.CC`.

| | |
|---|---|
| Driver | `MM3.CC` entry hash `0x8F99`, filename **`vga`**, CC offset `0x04063F`, 8,683 B → 15,570 B (LZHUF) |
| Palette | **`vga`+0x39C, 768 B, 256 × `{u8 r,g,b}` 6-bit (0–63)** |

Driver layout: `0x000–0x035` 18-entry API jump table · `0x036–0x335`
working palette (DAC upload source) · `0x336–0x39B` six 17-byte EGA/CGA
attribute blocks (`INT 10h AX=1002h`) · **`0x39C–0x69B` master 256-colour
palette** · `0x9BE` display-mode index.

Install (API entry 5, `vga`+0x0F → `0x1138`): if `[0x9BE]==0` (VGA mode
13h), scale `master[i]*f/128` into `0x36` for `f` stepping `0x80→0`
(fade), then `0x11E4` writes DAC index 0 to port `0x3C8` and shifts all
768 bytes to port `0x3C9` via a **fully unrolled** `lodsb; out dx,al` ×768
(`0x11F8`–`0x17F7`). Note `mov **bx**,0x3C8` at `0x11EA` — not `mov dx` —
which is why byte-scanning for `mov dx,imm` port constants found nothing.

**There is exactly one palette.** Nothing writes `0x39C` in VGA mode and
no file is ever loaded into it; the only runtime variation is the global
fade brightness. `[0x9BE]` selects the *path* (0 = VGA 256-colour, 1–5 =
Tandy/EGA/CGA via the `0x336` tables), and only VGA uses this table. Mode
13h is set by an obfuscated `mov ax,0xFE58; add ax,dx; int 10h` where `dx`
is a self-checksum of the driver (`dx = 0x01BB`, giving `AX=0x0013`) — an
anti-tamper check.

**Verification:** invoking the driver's own routine under Unicorn and
capturing port `0x3C9` yields **768/768 bytes identical** to `vga`+0x39C.
All 12 `.raw` screens render as coherent artwork; the Amiga port ships the
same `.raw` screens pixel-aligned (DOS index → Amiga colour consistency
1.00 across 7 screens), and nearest-colour re-quantisation of the DOS
render reproduces the Amiga `create.raw` for 77.4 % of pixels vs 29.9 %
for the VGA BIOS default and 1.1 % for random.
→ `build/cache/mm3/palette/mm3_dos_palette.json` (256 × `{r,g,b}`, 0–63,
the original emulation-derived artifact). No emulation is actually needed
to *extract* the table, only to have discovered where it lives — it's a
static byte range inside a normally LZHUF-decompressed `MM3.CC` entry, so
`scripts/mm3lib/dos_palette.py` reads it directly via the existing
`dos_cc` container reader (confirmed byte-identical to the artifact
above) and is what the extraction pipeline actually runs.

### Executrix self-unpacking — **SOLVED** (`tools/mm3_executrix_unpack/run.py`)

The packed exe's stub (MZ entry CS:IP = 0x0000:0x0000; file 0x200 =
`e9 99 00` jmp 0x29C) was traced and emulated under Unicorn
(`tools/mm3_executrix_unpack/run.py`): it reads the embedded original MZ
header at file 0x699 (37 bytes into its own data area), seeks to the
compressed image at `[0x48c]<<4 + 0x699` = 0x899, copies itself high
(`ES = [0x49a]-[0x492]-0x300`), and runs an adaptive-Huffman LZ
decompressor (3-byte table entries, 8-entry jump table at 0x27E, code
length in `[0x90]` starting at 9, tree at `[0x4a2]:bp*3`, mask table at
0x270).

The old "~31 KB fault" was **an emulator setup artifact, not a decoder
bug.** The stub computes its in-memory layout from the *original* load
segment:

    [0x492] = 0x4c2 - CS_original   (stub 0xb4, after entry)
    tree    = CS_high + [0x492]     (stub 0x278, after self-copy-high)
    input   = CS_high:0x4d1         (stub 0x28a, 0x2000-byte refill buf)

The input buffer spans `[high_CS*16+0x4d1, high_CS*16+0x24d1)`, and the
tree base is `(high_CS + [0x492])*16`. They overlap iff

    [0x492]*16 - 0x4d1 < 0x2000  ⇔  [0x492] < 0x24e
    ⇔  CS_original > 0x4c2 - 0x24e = 0x274

PSP=0x300 gives CS_original = 0x310 > 0x274 → overlap → the tree (which
grows at `es:[bp*3]`, bp up to 0x1000+) clobbers buffered input / the
walk runs past the tree → the old fault. With **PSP ≤ 0x200** (CS_original
≤ 0x210) there is no overlap and the decompressor runs to completion, then
the relocation fixup pass runs (visible as the +LOAD_SEG delta on the
first instructions). A PSP sweep confirms the clean threshold exactly at
CS_original = 0x274 (PSP=0x264): PSP 0x80–0x250 → CLEAN, 0x274+ → FAULT.
The doc's "different top-of-memory value" experiments changed TOP_SEG,
which cancels out of the layout — the load segment is the variable that
matters.

Verified: the decompressed body begins `ba 7f 1a 2e 89 16 3c 02 b4 30
cd 21 ...` = the doc's pre-relocation `ba 6f 18 ...` plus LOAD_SEG 0x210
relocation delta. Output:
`build/cache/mm3/MM3_original_reconstructed.exe` (279,985 B =
0x200 embedded header + 0x443b1 decompressed body). This makes the
game's code+data statically inspectable.

**Caveat (see TODO `mm3-recon-exe-extent`):** the reconstruction is genuine
only to file `~0x288F0` (root code `0x200–0x18120`; overlay `INT 3F` stub
area `0x18120–0x188F0`, 311 stubs; DGROUP `0x188F0–0x288F0`, exactly
64 KB) — bytes beyond that are stale packed-file content left over from
`run.py`'s trailing-zero trim, not decompressed output. The palette table
turned out to live in `MM3.CC`, not this exe (see "DOS 256-colour palette"
above); the FBOV overlay's own segment operands don't resolve with any
single relocation delta and need reading from a live memory dump, not the
static file.

### Runtime loading architecture — how the `vga` driver gets loaded and called

The "segment operands don't resolve statically" caveat above is explained
by the loader machinery, traced by booting the real packed `MM3.EXE` under
a Unicorn harness (DOS/BIOS int stubs + a real memory allocator + VGA
port/vblank emulation). Body offsets below are in the decompressed body
(loaded at LOAD_SEG `0x210`, DS `0x1A7F` = body `0x186F0`):

1. **FBOV loader** — segment `0x18A9`, body `0x169A9`. Opens the game's
   own `MM3.EXE`, reads the **packed** MZ header (20 B), and recovers the
   FBOV offset from its size fields: `e_cp=324, e_cblp=192` →
   `(324-1)*512+192 = 0x286C0` (Executrix crafted these fields so the
   arithmetic lands on the overlay). Seeks there, verifies `'FBOV'`
   (`cmp word [bp-0x14],0x4246` at body `0x16A4B`), saves the region end
   (`0x286D0`) at DS `0x114/0x116`, then loads the 46 segments
   (`0x16CB4`, `0x16D81`).
2. **Segment map** — DS `0x19D0:0x1A0`, 46 × 8-byte entries
   `{u16 seg; u16 size; u16 flags; u16 w4}`, read by `0x16C34` (which
   walks it from `0x1A0` to `0x310`, step 8, and patches each loaded
   segment: `[seg+4:6] += FBOV_base`, `[seg+0x18] = 0x4CF`). The image's
   own segments (root `0x210` … data `0x1A7F`) are listed first; the
   loader reads them from the file back into their in-image positions
   (self-load). This table is the FBOV `seginfo`; it lives in the image,
   not the file (the game never seeks to the MZ-relative `exeinfo`).
3. **CC code overlays** — the display driver and other loadable modules
   come from `MM3.CC` entries (the `vga` driver = entry `0x8F99`; also the
   PIT/timer driver entry 33, etc.). The boot loads them via the CC reader
   (`0x145F` segment, body `0x12636` = the documented CC open/decrypt) into
   allocated memory, and the game calls them through **far-branch-table
   stubs** that are runtime-patched.
4. **FBT dispatch** — segment `0x145F`'s stub table at body `0x14F53+`
   (`push word cs:[0x2A73]; mov ax,ID; push ax; retf`, 10 B each, IDs
   `0x03/0x06/0x0C/…/0x30`). The loader writes the driver's runtime
   segment into `[0x145F:0x2A73]`; each stub then jumps to
   `[driver_seg]:ID`. In the boot harness the driver loaded at segment
   `0x92FC`, and `[0x145F:0x2A73] = 0x92FC` — the IDs are indices into the
   driver's own API jump table (`0x000–0x035`), confirming the driver's
   entry points (`0x03→0x1498`, `0x06→0x3624`, `0x0C→0x1256`,
   `0x2D→0x15A9`, `0x30→0x2812`, …). This is why the far-call segment
   operands in the static image don't resolve — the target segment is a
   runtime allocation, written into the stub table at load time.

The harness run (DOS/BIOS stubs, allocator, port 0x3DA vblank, AdLib
0x330/0x331, keyboard) boots the packed exe to mode 13h, through the
resource-table sort, and into the driver's screen/palette code — the same
driver path independently confirmed by the palette and blitter traces.


## Still open / paths tried

See `docs/mm3/TODO.md`.

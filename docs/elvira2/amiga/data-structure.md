# Elvira II: The Jaws of Cerberus (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1991. AGOS-family engine (ScummVM `GType_ELVIRA2`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first, including §0's correction of the
prior triage pass's "different header" hypothesis). Implementation:
`tools/shared/agos-vga.ts` + `tools/shared/agos-vga-export.ts` (`.pkd`),
`tools/shared/ilbm.ts` (`Pics/`). Extractor:
`tools/elvira2/amiga/export-data.ts`. Open items: `docs/elvira2/TODO.md`.

Raw data: `data/elvira2/amiga/data/` (200 `.pkd` files, zones 0-99, + one shared `013.OUT`; also `text02`-`text09`,
`tables01` + `tables03`-`tables09`),
`data/elvira2/amiga/Pics/` (4 plain IFF `ILBM` files), plus `Docs`,
`ReadMe` (out of scope) and `Elvira2.slave` (WHDLoad slave).

## 1. `.pkd` zones — CONFIRMED, same container/codec as Elvira 1

100 zones, ids 0-99 fully contiguous — a cleaner numbering than Elvira 1's.
All 100 have both a type-1 and type-2 file; 99 decode with at least one
real picture (zone 99 has only one junk table entry).

> **Correction (2026-11-18):** previously "93 zones / 7 empty / 2,303 images"
> — truncated by the early-stop table walk (`docs/agos-pkd-format.md` §3).
> Full walk: **3,272 images in 99 zones** (3,273 table entries incl. the junk
> one). Also: zones 80 and 99 plus one more declare **0 palette banks**
> (`vga1` word +2); zone 80's old `palettes/zone080.json` was read from header
> bytes and is removed (§2 correction in `docs/agos-pkd-format.md`).

3,272 images decoded corpus-wide. Sizes range from small UI icons up to
full scene pictures; the largest sampled screen (zone 78) is a 224x127
picture. **`colorDepth = 4` throughout, palette scale confirmed identical
to Elvira 1** (`docs/agos-pkd-format.md` §2) — no Elvira-2-specific
palette-load code path was needed for a static per-picture render (the
VC-opcode multi-slot compositing scheme in `vga_e2.cpp`'s `setPaletteSlot`
is real but not required to recover a coherent single image).

**Visual verification** (`public/assets/elvira2/amiga/screens/`):
- `zone021_img1.png` — a snarling blue-furred werewolf/creature close-up.
- `zone078_img36.png` — a fiery, organic (heart/hellscape-looking) scene.
- `zone005_img1.png`, `zone006_img1.png`, `zone031_img1.png` — additional
  coherent scene renders among the 40 screen samples.

## 2. `Pics/` — plain IFF `ILBM`, CONFIRMED byte-exact

4 files, no `.pkd` wrapping at all (the probe recon's "plain ILBMs hiding
in odd places" finding, confirmed and decoded this pass):
`SpiderCavesLevelA`-`D`. Each is a standard EA IFF-85 `FORM ILBM`: `BMHD`
(640x400, 4 planes = 16 colours, ByteRun1 compression), `CMAP` (16 x RGB),
`BODY` (row-interleaved planar, ByteRun1-compressed). Decoded with
`tools/shared/ilbm.ts` (new this pass — generic EA IFF-85 BMHD/CMAP/BODY
reader composed from `@seer-project/iff`'s chunk walker + `decodeByteRun1`,
and this repo's own `decodePlanarRowInterleaved`).

**Byte-exact verification**: the rendered picture is a fully legible
dungeon-level cheat-map — readable room labels ("Spider Caves Level 'A'"),
a legend ("Down to level below" / "Up to next level" / "Poison mushroom" /
"Room 1-5"), room numbering (I-V), and even the "SKID ROW" release-group
credit baked into the original scanned map graphic — every character
crisp with zero garbling. See
`public/assets/elvira2/amiga/screens/pics-SpiderCavesLevelA.png` (and
`-B`/`-C`/`-D`).

These are almost certainly manual/cluebook-style player reference maps
for the "Spider Caves" dungeon level, not in-engine room backgrounds
(640x400 is far larger than any `.pkd` picture in the corpus, and the
content is diagrammatic, not a rendered scene).

## 3. Output

```
public/assets/elvira2/amiga/
  textures/zoneNNN.png + .json    -- pkd zone atlases (as Elvira 1)
  screens/zoneNNN_imgI.png        -- 40 largest-picture samples
  screens/pics-<Name>.png         -- the 4 Pics/ ILBM level maps
  palettes/zoneNNN.json
  data/zones.json
```

## 4. Still open

See `docs/agos-pkd-format.md` §4 for the shared open items (`.out`/sound,
`vga1` VC-script semantics, palette banks). Elvira 2's
`data/` directory also has only a single `013.OUT` (vs. Elvira 1's ~19) —
plus several files entirely unexamined this pass: `0tune`-`9tune` (music,
same un-probed family as Elvira 1's `*tune`), `ICON.DAT`, `menus.dat`,
`tables01`/`03`-`09` and `text02`-`text09` (plain text + `stripped.txt`
index — the same lead as Waxworks's `text*`/`table*`), `gameamiga` (the
game database, **not** the executable; `runit` is the executable),
`start`, `stripped.txt` (TEXT index, 8-byte entries). `Docs/` directory
content also unexamined. `0tune`-`9tune` are ProTracker modules (solved
format, extractor pending). The `Pics/` ILBMs carry a "SKID ROW" credit and
are not in ScummVM's file list: release-group add-ons, not retail data.


## 5. `gameamiga` room database, VC dialect and the walker (2026-11-21)

Reader: `tools/shared/agos-gamepc.ts` (shared with Waxworks, `variant 'elvira2'`;
see `docs/waxworks/amiga/data-structure.md` §5). Elvira II's `gameamiga` is
**stored plain** (Waxworks' is `simon_decr`-packed; `simonDecr` on it throws).
**Confirmed:** 853 items, 167 rooms, 2 super-rooms; the 184-entry opcode
grammar is read from Elvira II's own `runit`; `gameamiga` + `tables01/03-09`
(777 subroutines) consume to EOF. **Exits:** 283 room-to-room exits, 280
reciprocal under `BACK = [2,3,0,1,5,4]` (rotated mapping: 0 of 248), 23 more
exits lead into super-room items (744, 760). Door states 2 bits/direction
(210 open, 90 closed, 6 locked). Movement op 54 (`moveDirn`, grammar `B`) with
operand "variable 150" (verb 200) = exit[facing]; verb 205/206 = up/down (b4/b5)
**confirmed from sub 0**. Turning: the super-room script computes right =
facing+1, left = facing+3 (mod 4) (sub 1300) -- left/right *labels* and
compass names stay conventions.

**VC dialect differs from Waxworks.** Elvira II's VC opcode lengths
(`ELVIRA2_VC_PARAM_BYTES`, `tools/shared/agos-vc.ts`) were derived the way
Waxworks' were: coordinate ascent for the table under which every script ends
(opcode 0) exactly at its successor's start. **1,268/1,268** segments (100 zones);
the Waxworks table gives 1,237/1,268 and a wrong draw length collapses to 711
(tests). Differences are on rare opcodes (17/32/37/41/46/47/53/55/59); ops never
seen stay unknown (raise). `draw` (op 10), `setPalette` (22), calls and the
conditionals have the same operands, and composed pictures are visually correct
(`build/cache/elvira2/walker-frames/`: studio corridor doors, porch, kitchen,
hotel door, bone cave).

**Rooms:** each room's script (`room.subroutineId`) runs `picture <VC id> <window 4>`
selected by `b150` (facing), VC id/100 = zone, the zone's *own* type-2 bank
(no shared bank in this game). Static background only: `107` (animated
actor/object sprites) is not drawn. Evaluator and exporter are the Waxworks ones
(`tools/waxworks/amiga/{room-script,export-maze}.ts`, `MazeSpec`):
`tools/elvira2/amiga/export-maze.ts` -> `public/assets/elvira2/amiga/data/maze.json`
+ `maze/z<zone>.png`. 3 connected areas (118 / 22 / 4 rooms), 545/549 room
pictures rendered, 331 distinct pictures, **every picture's script runs
`setPalette`** (0 pictures fall back to a guessed bank, so the
`elvira2-paletteless-zones` gap does not touch the walker). 19 rooms have a
picture-bearing line aborted by an unmodelled condition (ops 148/149/125/76/77/27,
default state shown). Walker: `tools/walker/games-elvira2.ts` (reuses `WaxworksView`).

> **Correction (2026-11-21, later):** the super-room grids are now walkable -- see section 6. The paragraph below is the earlier (pre-decode) state.

**Not covered (superseded by section 6):** the two super-room grids -- items 744 (30x30x4, script 1300) and
760 (20x20x6, script 1499), reached through 23 exits. Their `kSuperRoom`
child is `u16 subroutine, x, y, z`, then x*y*z state words (two bits/direction,
e.g. 17 = N+S corridor, 68 = E+W, 80 = S+W corner). Their pictures are *not* one
script per cell: script 1300 builds the view from op 171 (`INB`, per-cell
exit test) and wall-flag variables, then draws `picture 30000+var`; an
interpreter for those ops is needed (`elvira2-superrooms`). The start room is
not decoded (sub 100 branches on player-in-760/744) -- the walker starts at the
first pictured room (`elvira2-start-room`).


## 6. Super-room grid mazes (items 744 and 760) -- walker, 2026-11-21

Code: `tools/elvira2/amiga/superrooms.ts` (worlds), the extended op set in
`tools/waxworks/amiga/room-script.ts` (`SuperRoomEnv`), exporter hook
`MazeSpec.superRooms`; tests `tools/walker/__tests__/games-elvira2-superrooms.test.ts`.

**Grid -- confirmed.** `superroom` child = `u16 subroutine, W, H, Z`, then W*H*Z
`u16` state words, index `(z*H + row)*W + col`; direction `d` = bits `2d..2d+1`
(0 N, 1 E, 2 S, 3 W, 4 up, 5 down); N = row-1, E = col+1 (sub 1305: facing
0/1/2/3 -> `v0 -= 30 / += 1 / += 30 / -= 1`). Oracle: horizontal exits are
reciprocal (all six directions) for 2,378 of 2,452 in-grid exits in 744 (and 2,584/2,641 in 760);
the column-major reading of the same words scores < 0.3 (test). State 1 =
open, 2/3 = closed/locked door (ops 172/173); `down` state 3 (98 cells in 744)
is a pit (sub 1315 tests `173 ... 5`; fall landing not decoded); up/down
state 1 (12 pairs in 760) are stairs.

> **Correction (2026-11-21):** script **cell numbers are 1-based**: cell `n` is
> `states[n-1]`. The 22 doorway cells of sub 1286 are all non-empty only under
> that offset (22/22; offsets 0, +-2, 19, 20, 21 give 8-16), and in every one the
> door's own direction is a wall (state 0) -- the doors are embedded in walls.
> Also sub 1300 line 5 computes the floor as `(v0 - 1) / 900`. Without the offset
> the dev start cell 193 of maze 760 is an empty cell.

**Script ops (inferred from use, then checked against the grid).** `166 B` reads
the player's cell into variable B, `165 N` sets it; `71 N` runs subroutine N
(`71 w:30006` = indirect: sub 1313 computes `1377 + (cell % 10)` -- the
special-cell pictures in subs 1377-1386 are keyed by the cell's last digit);
`36 a b` copies variable a to b; 47/48/49/50/52 = mul/div/mulf/divf/modf;
`171/172/173 (item, cell, dir)` are conditions: door state of that cell in that
direction is 1/2/3 (`-9` = the player's current super-room). Sub 1304 turns the
neighbourhood into flag bits (60-63 left openings at steps 0-3, 64-67 right
openings, 68-71 wall ahead at distance 0-3 -- script and grid agree on 556/556
plain cells, test), and the zone-30 / 69 / 11 VC picture scripts read those
bits. Pictures: zone 30 = cave tunnel views (maze 744), 69 = halls, 11 =
760's arched-door tunnel; frames in `build/cache/elvira2/walker-frames/`.
Walker: one level per floor (744: 4, 760: 6), 2,308 cells.

**Doorways (confirmed for 22 rooms).** Sub 1286 (called by verb 547) lists
`13 v0 <cell>` / `55 <room>` for the 22 cave rooms 344-364 and 455; subs
1250-1255 give the facing (`13 v150 <facing>` ... `141 b2 <room>`). In all 22
the room's exit into the maze is `(facing + 2) % 4` (null control: facing+3
matches < 5). Rule used: at that cell, facing `F` and moving forward enters the
room facing `F`; leaving the room by its exit `d` arrives at the cell facing
`d`. Eight of the 22 doorway cells have an all-zero state word (isolated one-cell
niches in the grid); they are exported as one-cell nodes reached from their room.

**Start/entry (labelled).** `sub 0` verb lines 36/37 (verbs 281/274, no
nouns -- probably the game's own debug/teleport commands) are `165 3240; 43
b150 1; 55 i744` and `165 193; 42 b150 2; 55 i760`; those cells/facings are the
worlds' default poses. Room 452's open `up` exit into 744 arrives at cell 3240
(**hypothesis**: the only cell the scripts name for 744; its own special picture
is scripted in sub 1377 line 17).

**Still open:** the real game start (sub 101 ends `55 i:854` -- item 854 is a
room holding the starting objects -- and the opening sequence moves the
player on from there), the maze-pit landing cell (sub 1368), the closed/locked
maze doors' opening scripts, and the ~0.3% of cell/facing pictures drawn by a
line gated on an unmodelled condition (ops 77, 80 with item -1/-3, 125/148).

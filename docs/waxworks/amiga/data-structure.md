# Waxworks (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1992. AGOS-family engine (ScummVM `GType_WW`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first). Implementation:
`tools/shared/agos-vga.ts` + `tools/shared/agos-vga-export.ts`. Extractor:
`tools/waxworks/amiga/export-data.ts`. Open items: `docs/waxworks/TODO.md`.

Raw data: `data/waxworks/amiga/data/` (297 zone `.pkd` + `icon.pkd` + 59 `.OUT`, zones
0-155, 4-digit filenames — `NNN1.pkd`/`NNN2.pkd`/`NNN3.OUT`), plus
`Manual`, `Solution`, `ReadMe` (out of scope) and `Waxworks.Slave`
(WHDLoad slave).

## 1. Zone inventory — the largest corpus of the three games

156 zones, ids 0-155 fully contiguous. **15 zones have only a type-1
file** (zones 10, 20, 21, 22, 24, 32, 34, 35, 85, 89, 91, 92, 93, 95, 96).
Of the remaining 141 with both files, 140 decode with real pictures (one has
no valid table entry).

> **Correction (2026-11-18):** (a) the type-1-only zones are **not**
> "pure-text/dialogue" zones. They are exactly the zones where ScummVM's
> `zoneTable[]` = 3 (`zones.cpp:43-86`): they load their `vga2` from zone 18
> (zones < 85) or zone 94 (zones >= 85), the shared first-person **maze**
> graphics. Their scripts draw 1,016 image numbers, all resolving to valid
> entries in `0182.pkd`/`0942.pkd`; zone 41's atlas is first-person corridor
> views. (b) the "15 more have empty `vga2` tables" claim came from the
> truncated table walk. (c) 46 zones declare 0 palette banks; 39 were
> previously exported with noise palettes from header bytes (now greyscale,
> no palette file). (d) the cited path `data/agos-pkd-format.md` never
> existed (it is `docs/agos-pkd-format.md`).

4,381 images decoded corpus-wide (first pass: 2,318 — truncated walk) — the largest single-game count of the
three. Container/codec/palette all identical to Elvira 1
(`docs/agos-pkd-format.md` §§1-3); filename digit width is the only real
difference (`pkdFilename('waxworks', ...)`, 3-digit zone id vs. Elvira's
2-digit).

> **Correction (2026-11-21):** the type-1-only zones' pictures are composed by `picture` VC scripts (see §6); the room/exit database is decoded (§5); a maze walker exists (§7).

**Visual verification** (`public/assets/waxworks/amiga/screens/`):
- `zone064_img3.png` — a gold-and-marble Egyptian tomb chamber with two
  sarcophagi/statues and a central altar — matches Waxworks' well-known
  Egyptian wax-exhibit setting.
- `zone147_img3.png` — a stone dungeon/prison wall with a barred window.
- `zone068_img3.png`, `zone044_img1.png`, `zone062_img4.png` — additional
  coherent scene renders among the 40 screen samples.

## 2. Additional un-probed resources

Waxworks' `data/` directory has a much richer non-`.pkd` file set than
Elvira 1/2, not examined this pass:

- `text01`-`text25` — plausibly dialogue/narrative text tables (the
  filename pattern strongly suggests this, but no format/encoding was
  checked).
- `tables01`-`tables16`, `xtable01`-`xtable04`, `tbllist`, `xtbllist` —
  plausibly index/lookup tables paired with the `text*`/`table*` files
  (the `tbllist`/`xtbllist` naming suggests a directory-of-directories).
- `MENUS.DAT`, `stripped.txt` (TEXT index, 25-byte entries) — un-probed.
- Music: `0tune`-`2tune`, `7tune`-`10tune`, `23tune`-`26tune` —
  `simon_decr`-compressed ProTracker modules (solved format; `2tune`/`8tune`/`9tune`/`10tune`
  hold several modules at ScummVM's `amigaWaxworksOffs` offsets).
- `gameamiga` (`simon_decr`-compressed game database: items/rooms/exits/
  subroutines — **not** the executable; `runit` is), `start`, `icon.pkd`, `saves/` (save games, out of scope).

This is the single most promising lead for a follow-up pass — a
`text*`/`table*` pair is a classic string-table + index-table shape, and
Waxworks' dialogue/narration would be genuine, well-documented-horror-genre
game content (a strong `domain-archetype-plausibility-oracle.md`-style
verification target once decoded).

## 3. Output

```
public/assets/waxworks/amiga/
  textures/zoneNNN.png + .json    -- pkd zone atlases (as Elvira 1)
  screens/zoneNNN_imgI.png        -- 40 largest-picture samples
  palettes/zoneNNN.json
  data/zones.json
```

## 4. Still open

See `docs/agos-pkd-format.md` §4 for the shared open items. Waxworks-
specific: the whole `text*`/`table*` family (§2) — the single largest
undecoded lead (Elvira II has the same `text*`/`tables*` family); `.OUT` sound
files (format identified, extractor pending — see `docs/agos-pkd-format.md` §4).

## 5. `gameamiga` — the game database (rooms, exits, subroutines) — **confirmed** (2026-11-21)

Reader: `tools/shared/agos-gamepc.ts` (`readGamePc`, `readSubroutineBlock`,
`readGrammarFromExe`). Original code; ScummVM's `res.cpp`/`subroutine.cpp`/
`rooms.cpp` were a behaviour oracle only. `gameamiga` is `simon_decr`-packed
(43,392 -> 101,522 B); all big-endian. Same loader as Elvira II (differences
below).

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | u32 | item count - 2 | 0x6DF |
| 0x04 | u32 | marker | `0x80` = runtime database |
| 0x08 | u32 | inited item count - 2 | 0x6DF (Elvira II ignores it) |
| 0x0C | u32 | string count | 0x29D = 669 |
| 0x10 | u32 | text size | 0x4669, then that many bytes of NUL-terminated strings |
| next | items | 1,759 item records (ids 2..), then the subroutine block | ends exactly at EOF (101,522) |

Item record (Waxworks): `u16 adjective, u16 noun, u16 state, u32 next, u32
child, u32 parent` (item refs: `0xFFFFFFFF` = none else `+2`), `u16 unused, u16
classFlags`, then a `u32` (non-zero iff children follow) and `u16 type` child
blocks until type 0:

| Type | Child | Layout |
|------|-------|--------|
| 1 | room | `u16 subroutineId` (the room script), `u16 exitStates` (2 bits per direction x6: 0 none, 1 open, 2 closed, 3 locked), then one `u32` item ref per direction with a non-zero state, in direction order |
| 2 | object | `u32 flags`; bit 0 -> `u32` value; bits 1..15 -> `u16` each; then `u32 name` (Waxworks only) |
| 4 | super-room | Elvira II only (`id,x,y,z` + x*y*z state words) |
| 7 / 8 / 9 / 255 | container / chain / user flags (4 x u16) / inherit | |

**Verification:** 1,396 rooms; **2,890 / 2,890 exits are reciprocal** (direction
`d` <-> `BACK[d]`, `BACK = [2,3,0,1,5,4]`; a rotated-destination null control
gives < 2%). Directions 0..3 are the compass sides in *facing order* (forward =
exit[facing]), 4/5 are up/down. 4 of 5 room-graph components lay out on the
(x,y,z) lattice with 0 conflicts (386-room world: 2 collisions = non-Euclidean
links).

### Subroutine block and the opcode grammar

`u16 0, u16 id` per subroutine, then lines (`u16 0` ... ), a line being
`opcode bytes ... 0xFF`; subroutine id 0 (the verb table) prefixes each line with
`u16 verb, noun1, noun2`. Opcode 87 swallows one word; opcode 0 inverts the next
condition. Operand layout is one letter per operand: `B` byte (0xFF escape + var
number), `I` item (`u16` 1/3/5/7/9 = special marker, else + `u32` item ref), `T`
text (`u16` 0/3 special else + `u32` string id), everything else a raw `u16`.

> The per-opcode operand grammar is **read from the game's own executable**
> (`runit`): 191 NUL-terminated strings ("IB \0", padded to even length) starting at
> the run `" \0I \0\0I \0\0I \0..." (opcode 0..)`. Elvira II's `runit` holds its own
> 184-entry table (read the same way).

**Verification:** gameamiga's subroutine block (76 subs) plus 20 files
(`tables01-16`, `xtable01-04`, 1,422 + 459 subs) all consume **to exactly their last byte**;
a wrong grammar entry (`eq` BN -> B) desynchronises the walk (null control, in the test).
`tbllist`/`xtbllist` = NUL-terminated file name + (u16 min, u16 max) id ranges, 0-terminated.

### Room scripts and facing

A room's subroutine (`room.subroutineId`) is run to redraw the view. It is a
list of lines gated by `eq b150 N` / `zero b150`, each doing `picture <VC script> <window 4>`.
Variable **150 is the facing** (0..3): subroutines 24/25 do `add b150 1|3`,
`op51 b150 4` (mod 4), `process 7`; `moveDirn(b150)` (indirect `0xFF96`) walks
through exit[facing]. Elvira II note: item/exit reader works; see the Elvira II
paragraph in section 8.

## 6. `vga1` VC scripts and how a maze picture is composed — **confirmed** (2026-11-21)

Reader/compositor: `tools/shared/agos-vc.ts`. `vga1` header: `+6` palette offset,
`+2` bank count; at `H = BE16(+10) + 20`: `H+2` image count, `H+6` animation count,
`H+10` image table, `H+14` anim table; 8-byte entries `{id, colour, ?, scriptOffset}`.
Scripts are **packed back to back**, each ending with opcode 0 exactly at its
successor's start. Opcodes are `u16`.

`picture <id> <mode 4>` runs the script of zone `id/100` into the 224x127
scene window (screen (48,3)); the window is first cleared to the entry's
`colour` (all 0 in the maze zones). `draw image, x, y, flags`: image index into the
zone's `vga2` table (negative = value of a variable), **x in 8-pixel units**, y in rows,
flags bit 0 = horizontal flip, bit 1 = also draw colour 0. Maze zones draw ~25
pieces per picture; the **15 type-1-only zones draw from zone 18's bank
(zones < 85) or zone 94's (>= 85)** with their own `vga1` palette (1 bank each, `nibble*32`).
Other ops used in picture scripts: `setPalette`, `fadeIn`, `resetSprite` (no effect on the still),
`ifVarNotZero`/`ifEqual`/`ifBitSet`/`ifBitClear` (skip the next op), `call` (nested script, also
by variable), `setVar`, `loadSprite` (an animated sprite: **not drawn**), `setWindow`.

**Operand lengths are inferred from the data**, not copied: a neutral hill-climb for the
table under which all 3,207 distinct scripts end on their successor's start reached 3,207/3,207
(a perturbed table collapses; the test pins 3,496/3,496 script segments). The data cannot tell
`fadeIn` = 4 params + a following `op 1` (0 params) from 6 params; both fit (walking is identical).

**Visual verification** (looked at, not byte-exact): `build/cache/waxworks/walker-frames/` -
London streets (zones 10-35), the shared-graphics zones' corridors and a walled graveyard (85-96), pub, crypt,
Egyptian exhibit all recognisable. **Orientation oracle:** for the 359 maze rooms the picture for facing `f`
is flatter/darker in the centre exactly when exit `f` is open: AUC 0.12 (|AUC-0.5| = 0.38) for
the game's `facing == exit index`, vs 0.71 / 0.34 / 0.72 for the mapping rotated by 1/2/3 (null controls).
It cannot distinguish the E/W labelling (a mirror), so the compass names are a convention.

## 7. Maze/room export and the walker (2026-11-21)

`tools/waxworks/amiga/export-maze.ts` -> `public/assets/waxworks/amiga/data/maze.json` +
`maze/z<zone>.png` (picture sheets, 224x127 cells). Rooms form 5 connected worlds (579 / 386 / 217 / 180 / 21 rooms);
the 15 maze zones' 359 rooms live in world 2 (London, zones 10-35 + shops) and world 4 (graveyard, 85-96);
all but 4 of them have a picture for every facing. World 5 (21 rooms, zones 23/126) holds the start room
(item 311, `goto i311` in subroutine 101). Worlds 1 (zone 50) and 3 (zone 40) draw scenery into
`setWindow(16)` sub-windows that are not modelled (2% / 39% of rooms fully pictured) - bonus, partial.
Walker: `tools/walker/games-waxworks.ts` (W forward, A/D turn, S about, R/F up/down; only door state 1 passes).

## 8. Elvira 1 / 2 reuse

> **Update (2026-11-21):** Elvira II now has its own walker on this pipeline, with its own VC opcode-length table (`ELVIRA2_VC_PARAM_BYTES`) and a *plain* (unpacked) `gameamiga` -- see `docs/elvira2/amiga/data-structure.md` §5. The `kSuperRoom` children exist (2 items, 30x30x4 and 20x20x6) and are not walked.

The `gameamiga` room/exit reader works unchanged on **Elvira II** (`readGamePc(..., 'elvira2', grammarFromItsRunit)`: 853 items, 167 rooms; all
449 `tablesNN` subroutines consume to EOF; the file continues past the subroutine block with a name list that is not parsed;
`kSuperRoom` children are read but no Elvira II file has been checked for them). Elvira 1 is **not** covered: its items have a different
record (`GenExit` type 4, 16-bit opcodes, `10000` line terminator, a different operand table).


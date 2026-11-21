# Abandoned Places 2 (Amiga) — data structure

Recon, 2026-11-21. Retail files stay where they are, at
`data/abandonedplaces2/amiga/`. Offsets are **byte offsets into the named
file**, unless a line says otherwise.

**Shared with AP1:** the kernel directory record and the packer are specified once,
in `docs/abandonedplaces/amiga/data-structure.md` §2–§3. This file covers only what
differs.

## 0. Identification

| Item | Value |
|---|---|
| Title | Abandoned Places 2 (EN/DE), ICE Ltd 1993; ArtGame lineage (§4) |
| Media | JOTD WHDLoad install v2.0 (2006), built with RawDIC. `data/ap2.000`–`ap2.003` are **one file blob per original disk**, not disk images. `data/ap2.dir` is the kernel directory. `data/AP2` is the kernel, a standard AmigaDOS HUNK |
| Manual | Plain-text `Manual` in the install, plus `~/Development/amigadocs/game-manuals/Abandoned Places 2 (1993)(I.C.E.)(en-de)[2000].pdf`. `Codes` = copy-protection table |

| File | Size | sha1 |
|---|---|---|
| `data/AP2` (kernel HUNK) | 10,676 | `94609479402a729dfeaff5535ed97440e066ff41` |
| `data/ap2.dir` | 19,820 | `8437d2486816563a06e39722e5b60670bf6cce36` |
| `data/ap2.000` | 861,872 | `f2384845ef03fbf76244f4da1dc2d19bb2a604ce` |
| `data/ap2.001` | 878,337 | `e162dfcf45d16a06662652802f1d1504f422382f` |
| `data/ap2.002` | 704,375 | `9bc4815925c463d8662ffe5c2b0f10c082dc4e16` |
| `data/ap2.003` | 815,986 | `95c56e79207e9800a968bdb1ebaa8c0b781fc5bf` |
| `AbandonedPlaces2.Slave` | 4,640 | `4f161036d9dc93b5e8ccf4160cf2ec7fb9d7e314` |
| unpacked `main` (game code, in `ap2.001`) | 104,416 | `4aa6c370c84f8716add21cba924b52f3262fd52b` |

## 1. `ap2.dir` — **confirmed**

The record format is the same as AP1's (32 B: name[16], offset, stored, unpacked,
u16 packed flag, u16 group = 0). There are 5 sections, each starting with a 2-byte
`0000`, and the file ends with 4 zero bytes.

> **Correction (2026-11-21):** section 0 has **no** leading `0000` — `ap2.dir` starts
> with a record (`mod.ab2v2` at byte 0); the 2-byte `0000` separates sections, so
> there are 4 separators (619 × 32 + 4 × 2 + 4 = 19,820 B, walked 2026-11-21). This
> agrees with the AP1 note's "AP2's `ap2.dir` starts with a record".
> The 617 shipped records carry **593 distinct names**: 12 names
> (`chtin.bpl`, `sp_00`–`sp_07.ani`, `obj_99.bpl/.def/.ofs`) appear once in each of
> sections 1–3, with byte-identical stored data, so the unpacker's 593 files in
> `build/cache/abandonedplaces2/` are the 617 records minus 24 repeats. Sections 0–3 hold 63 / 160 / 194 / 200
records, and **each section ends exactly at the size of `ap2.00k`** (861,872 /
878,337 / 704,375 / 815,986; 4/4, zero deviation, 0 breaks in contiguity). Offsets
are byte offsets into `ap2.00k`. Section 4 lists `save_00.dat` and `save_01.dat`
(401,408 B each), which live on the save disk and are not shipped.

**Verification:** 262/262 packed records unpack with checksum 0, input fully
consumed and size exact. The 355 stored records (including 0-byte `*_99.bpl`
placeholders) have stored = unpacked.

## 2. Inventory by family (unpacked)

| Family | Members | Evidence | Status |
|---|---|---|---|
| Code | `main` (104,416), `boot`, `language`, `menu`, `chargen`, `intro`, `gameover`, `theend` | HUNK | standard |
| **Dungeon levels** | `dng_00`–`dng_27.dat` (28 levels, 8.5–15 KB, in `ap2.000`) | §3 | structured-unknown |
| Tileset triplets per set NN | `wl_` (walls), `onwl_` (on-wall decorations), `fl_` (floor/ceiling 192×135), `strd_`/`stru_` (stairs down/up), `gt_` (gates), `pit_`, `swg_`/`swp_`/`sww_` (switches?), `obj_`, `mon_`, each as `.bpl` + `.def` + `.ofs`, plus `set_NN.clr`. Sets 00–07 are on `ap2.002`/`.003`; 50–53 and 99 are on `ap2.001` (`_99` = empty placeholder geometry) | §5 | structured-unknown (self-describing) |
| Palettes | `set_NN.clr`, `menu.clr`, `display.clr`, `pic_NN.clr` (64 B = 32 × Amiga `0RGB` words) | `set_50.clr` = `0000 06AC 05C5 …` | variant (standard 12-bit) |
| Pictures | `pic_00`–`07.bpl` (19,440), `chtin.bpl`, `gendispl.bpl` (40,000 = 320×200×5), `banki_0x.bpl` + `.cfs`, `bankg_00`, `bankt_00` | Sizes; `.cfs` holds 48–336 B of colour/frame tables? | hypothesis |
| Animations | `sp_00`–`07.ani` (37,260 each) | Fixed size | structured-unknown |
| Items | `item.dat` (40,960), `itemdesc.dat` (38,912), `items.bpl`/`.def`/`.ofs` | | structured-unknown |
| Text | `Game_0x.txt`, `Play_0x.txt`, `Gen_0x.txt`, `menu_0x.txt` (x = language 0/1/2) | Plain ASCII with `\l` line codes | standard |
| Fonts | `chrset0/1.bpl` + `.def`, `chrset1.fnt` | | structured-unknown |
| Music / SFX | `mod.ab2v2`, `mod.GameOver2`, `mod.win` (ProTracker `M.K.`); `mdat.effects` + `smpl.effects` (TFMX), `tfmx.dat` | Magic | standard |
| Misc tables | `rnd.dat` (512), `mirror.dat` (256: a bit-reverse table for mirrored blits?), `dseffect.dat`, `button.dat` | | hypothesis |

## 3. Dungeon level `dng_NN.dat` — **rendered**

| Offset | Size | Field | Notes |
|---|---|---|---|
| +0 | 2 | width | `0x20` in 28/28 |
| +2 | 2 | height | `0x20` in 28/28 |
| +4 | 40 | 10 × u32 block offsets | `offs[0] = 0x2C` and `offs[1]-offs[0] = W·H·8` in 28/28; `offs[9] = file size − 2` in 28/28 |
| +0x2C | 8192 | cell grid | 32 × 32 cells × **8 bytes**, row-major. **byte 5 bit 0 = solid wall square**. Bytes 0–4 and the rest of byte 5 (`0x40`/`0x80`) carry per-cell features (doors/decorations/objects?), unknown |
| offs[1]… | var | 8 more blocks | Lists (objects, monsters, events?); `offs[3]`/`offs[6]` blocks are 2-B `FFFF` terminators |

Evidence: dng_00 renders as a coherent 32×32 maze with a solid border. 11 of 28
levels have a fully solid border. The others (11–15, 24–27, plus near-misses) have
open edges, which fits outdoor or edge-connected areas (hypothesis).

**Wall model:** type-derived (solid squares), the same family as AP1. The cell is
4× bigger (8 B vs 2 B) and carries more per-cell state.

### Paths tried
| Approach | Result | Why it failed / status |
|---|---|---|
| — | — | |

## 4. Relationship to AP1 (hash/substring join)

- **Identical:** the directory record format, the per-disk section separators and the
  packer grammar. One decoder unpacks both games.
- **No identical files:** 0 cross-game sha1 matches over every unpacked file ≥ 64 B.
- **Shared code:** 184 shared 32-byte windows between the AP1 kernel and the `AP2`
  kernel, 211 between AP1 `code` and AP2 `main`, and 63 between the AP1 kernel and
  AP2 `main`. So the code lineage is shared (kernel, I/O, packer, some engine
  routines), but the game engine was substantially rewritten.
- **Different asset grammar:** AP2 moved slot geometry *into data*
  (`.def`/`.ofs` beside every `.bpl`), while AP1 art files are headerless. The level
  cell grew from 2 B to 8 B, with the same 32×32 grid.

## 5. Tileset triplets (`.bpl` / `.def` / `.ofs`) — **rendered** (structural)

`.def` = N × 28-byte records (14 BE words). `.ofs` = N × u32 offsets into `.bpl`.
The N values are constant per family across every set: wl 15, onwl/strd/stru/swg 9,
gt 7, obj 11, mon 14, pit 16, swp 20, sww 36, fl 2.

| Word | Field | Notes |
|---|---|---|
| 0 | w | pixels |
| 1 | h | |
| 2 | x offset inside the slot frame | `0xFF..` values = empty slot |
| 3 | y offset | |
| 4 | slot frame width | e.g. wl: 140/74/46 front walls by depth, 27/34/15/8 sides, mirrored pairs |
| 5 | slot frame height | 135 = view height |
| 6 | flags | High byte + 1 = colour planes (`0x0307` = 4, `0x0407` = 5, `0x0302` floor) |
| 7 | bytes per row | |
| 8 | words per row | |
| 9–10 | 0 | |
| 11 | plane size | `= bytes/row × h` (e.g. 18 × 115 = 2070) |
| 12 | 0 | |
| 13 | colour data size | `= planes × plane size`. The stored image is one plane larger (a **mask plane**): `ofs[i+1]-ofs[i] = (planes+1) × plane size` (wl_00: 10,350 = 5 × 2070) |

The view is 192×135 (`fl_*` = 2 full-frame floor/ceiling images). Wall records come
as near/mid/far front faces plus left/right side faces in mirrored pairs.
**Renderer = slot table** (pre-drawn bitmaps per view position, cookie-cut with
their mask). The slot destination tables are decoded: see §6.

> **Correction (2026-11-21):** the slot destination table is solved (§6); the walker consumes it.

> **Correction (2026-11-21):** the recon's "1,476/1,520, 44 UI failures (presumably no
> mask plane)" is now explained and closed. **Flags word 6**: high byte + 1 = colour
> planes; **bit 0 = a mask plane follows** (`0x0307`/`0x0407`/`0x0405`/`0x0403` masked;
> `0x0302` floor, `0x0402` `plheads`/`menu`/`dispadd`'s two, and `0x0000` `chrset1` are
> unmasked). Unmasked records store `colour size = 0` (word 13) and step
> `planes × plane size`, which is what the old check mis-flagged. Also: `fl_01`–`fl_07`,
> `fl_50`, `chrset0/1` and `icons` have **no `.ofs`** — offsets are implicit (records back to
> back), and `chrset0/1` + `icons` carry a **single `.def` record describing one cell
> repeated** through the whole `.bpl` (128 glyphs 8×13×(3+mask), 128 glyphs 8×10×1,
> 168 icons 16×16×(3+mask); sizes divide exactly). With these, **1,962/1,962** non-empty
> records pass (`plane size = bpr×h`, `colour size ∈ {0, planes×plane size}`,
> `bpr×8 ≥ w`, and next offset − offset = stride; `.bpl` end = last record end for every
> triplet). Code: `tools/shared/artgame-tileset.ts` (`checkGeometry`), test
> `tools/shared/__tests__/artgame-tileset.test.ts`.

### Export + palettes (2026-11-21) — **confirmed** (layout), **hypothesis** (colours)

- **Plane layout: sequential planar, colour planes first (plane 0 = bit 0), mask plane
  last — confirmed.** Null control: across wl/mon/obj/gt/strd_00 (≈110k px outside the
  mask), **0** non-zero colour pixels fall outside the mask with mask-last, while
  treating plane 0 as the mask leaks 25–85 % of pixels per family.
- `npx tsx tools/abandonedplaces2/amiga/export-tilesets.ts` (also `buildAssets`,
  `supported: true`) writes **149 atlases / 1,962 frames** to
  `public/assets/abandonedplaces2/amiga/sprites/<triplet>.png|json`: every triplet (sets
  00–07 and 50–53 of wl/onwl/fl/strd/stru/gt/pit/swg/swp/sww/obj/mon, plus `chest`, `fire`,
  `fspells`, `items`, `icons`, `chrset0/1`, `plheads`, `menu`, `dispadd`, `pleffect`).
  Sidecars list per frame `x,y,w,h` (atlas) plus `slotX/slotY/slotW/slotH` (def words 2–5),
  `planes`, `masked`, and the palette used. `data/tileset-geometry.json` has the per-triplet
  check.
- Palettes: `set_NN.clr` (32 × 0RGB). Dungeon-set families (4-plane) use indices 0–15 of
  their own `set_NN`; `set_NN` upper halves are black but for 16–18, so 5-plane images
  borrow `display.clr[16..31]` (the shared UI half) — **hypothesis, and the skeleton
  monster comes out with odd orange/blue bones, so it is probably wrong**. `mon_NN`/`obj_NN`
  are not tied to a set (mon goes to 17/53); they are rendered with `set_NN` when
  NN < 8, else `set_00`. Indices 12–15 of the set palettes are a lime→teal ramp; walls
  render with lime speckle that is probably a per-depth/torch ramp rewritten at run time
  (cf. Black Crypt COLOR26–31). Tracked as `ap2-image-palettes`.
> **Correction (2026-11-21, palette pass):** both palette hypotheses above are replaced by §5.1. Colours
> 16–31 really are `display.clr[16..31]` (now confirmed from code), but 5-plane dungeon images do **not**
> index them: their 5th plane is the EHB half-bright plane. And the lime→teal "ramp" 12–15 is not a
> runtime ramp — wall pixels never reach those registers, because a 4-plane wall's plane 3 is the EHB
> plane too. Wall value 12 shows as half-bright colour 4 (`555`→`222`), 14 as half-bright 6.

- **In-game checks (user):** (1) a first-person corridor view in dungeon 0 (set 00): wall
  front/side tints at each depth, floor/ceiling colours and whether the lime pixels are
  real; (2) a corridor in a level using another set (e.g. set 03, whose palette is the
  only one using indices 16–31) to compare tints; (3) any skeleton (`mon_00`) at near
  range for the true monster colours; (4) a door/gate (`gt_`), stairs (`strd_`/`stru_`),
  a pit and an on-wall decoration to confirm slot placement against `slotX/slotY`
  (x offset inside the frame, y measured from the top of the 135-row view).

### 5.1 Screen palette and plane remap (2026-11-21) — **confirmed** (code), **rendered**

Offsets are hunk offsets in `main` (= file offset − 0x20). Code: `tools/abandonedplaces2/amiga/screen-palette.ts`.

- **The screen is 6 planes, EHB.** One copper list for the game (`+0x14E80`, copied by `+0x3C3E`):
  BPLCON0 = `0x6200` (6 planes, no HAM, no dual playfield = Extra Half-Brite), interleaved (BPL1MOD 200),
  no mid-screen WAITs (the list ends after the 32 colour MOVEs). So screen values 32–63 show colour
  `v−32` with each 4-bit gun shifted right by one.
- **Colour registers 0–31 = buffer `$5346`.** The startup loader (names `+0x168B6`, destinations `+0x16A66`)
  reads `display.clr` into `$5346`. The level loader (`+0x12396`, theme → set via `+0x17088`) reads
  `set_NN.clr` into `$5342` (or `$534E` for levels ≥ 28). `+0x47E4` copies **16 words** `$5342 → $5346`
  (`move.w #15,d0` loop), then `+0x486E` fades from black to `$5346` (`+0x4944`, linear, `+0x13E24`;
  the last step equals the target). Copper colours are written only by `+0x5848` (from `$5346`/`$534A`).
  Result: **0–15 = `set_NN[0..15]`, 16–31 = `display.clr[16..31]`**; `set_NN[16..31]` is never shown in
  the dungeon. No code rewrites individual registers (every reference to `$5342/$5346/$534A/$534E` and
  every `$DFF18x` write checked; the four `move.w d0,$DFF180` are debug flashes).
- **Images are drawn through view-buffer descriptors with swapped plane pointers.** Bitmap descriptors
  (`$628E` table, 0x2C B each, selected by `+0x56F6`) hold a plane-pointer list at +0x14; the blitter
  `+0x5F6E` writes image plane *k* through pointer slot *k* and fills the remaining slots under the mask
  from def word 9 (0 for every dungeon family). The set-up code swaps pointers right after building three
  192×135×6 view descriptors over the same buffer:

  | Descriptor | Swap | Set-up | Used by |
  |---|---|---|---|
  | 4 | slots 3 ↔ 5 | `+0x3A84` | walls `+0x7D2C`, floor/ceiling `+0x7282`, pits `+0x68EE/+0x6928`, ceiling objects `+0x6A34`, gates `+0x6B14`, stairs `+0x6CC6`, `+0x6D4C`, `+0x6E1E`, `+0x6E88` |
  | 8 | slots 4 ↔ 5 | `+0x3AE4` | on-wall decorations `+0x6C4C`, `+0x6E9A` |
  | 9 | slots 4 ↔ 5 | `+0x3B44` | water `+0x68B2`, chests `+0x6962`, fire `+0x699C`, monsters `+0x70CA`, `+0x6FA0/+0x700E/+0x71C0` |
  | 2 | none | `+0x3972` | the same buffer, used to copy the finished view to the screen |

  So a 4-plane wall/floor/pit/gate/stairs/object value *v* lands on screen as `(v & 7) | (v & 8 ? 32 : 0)`
  (values 8–15 = half-bright 0–7), and a 5-plane monster/decoration/chest/fire value as
  `(v & 15) | (v & 16 ? 32 : 0)` (values 16–31 = half-bright 0–15).
- **Evidence beyond the code:** `onwl_00` uses values 0–6 and 18–22 = the wall greys and their half-bright
  copies, and renders as a shaded stone wall; the `mon_00` skeleton uses 7–11 (`set_00`'s tan ramp) and
  22–27 (its halves) and renders as one coherent bone ramp; level-0 corridors are grey stone with depth
  shading. The old pipeline (raw `set_00` + `display.clr[16..31]`) put 17–50 % lime/teal on walls and
  orange/blue on the skeleton. Pinned by `tools/walker/__tests__/games-abandonedplaces2.test.ts`
  (byte signatures of the swaps/BPLCON0/16-word copy, plus a no-lime check with a raw-palette null control).
- **Exports:** the walker's `pal/set_NN.json` is now the 64-entry screen palette and `res/*.json` stores
  screen values; the atlases under `sprites/` are rendered the same way. UI-only images (`items`, `icons`,
  `fspells`, fonts, `menu`, `dispadd`, `plheads`, `pleffect`) keep the identity plane map — their
  in-inventory draw descriptors are not traced (`ap2-ui-palettes`).

## Open families — paths tried

| Family | Approach | Result | Notes |
|---|---|---|---|
| dng cell bytes 0–4 | — | — | |
| `.def` word 6 low byte, slot dest coords | — | — | |
| `.ani`, `.cfs`, `bank*` | — | — | |

## 6. Renderer, level cells and theme selection (2026-11-21) — from disassembly of `main`

Offsets below are **hunk offsets in `main`** (= file offset − 0x20; the hunk base is 0, so absolute
`$xxxx` operands equal these). Code starts at +0x1B0 (the first 0x1B0 bytes are an allocation/size
table beginning `EXEC`). Disassembly lives in gitignored scratch only; it was r2 linear-sweep of the
flat code image. Extractor: `tools/abandonedplaces2/amiga/export-walker.ts` (tables read from the
shipped file at the offsets cited); port: `tools/abandonedplaces2/amiga/view-model.ts`.

### 6.1 Level → tileset (**confirmed** structure, loader at +0x12214)
- `+0x170A4`: 28 words, level → theme (`0,0,3,3,3,3,1,1,1,5,5,4,4,7,7,7,6,6,6,2,2,8,8,9,12,10,11,13`).
- `+0x17088`: theme → palette set (`set_NN.clr`): `0,1,2,3,4,5,5,6,7,7,50,50,50,50`.
- `+0x16EC8`: 14 rows × 16 words (theme → file number per family). Column order (matches the name list at
  `+0x16B64..`): wl, fl, pit, obj1, obj2, obj3, onwl1, onwl2, stru, strd, mon1, mon2, gt, sww, swg, swp.
  The loader (`+0x1247A`) patches the two digits of each `xx` in the name; `99` = empty placeholder
  (outdoor themes 10–13 use `wl_99`, i.e. no walls). Level 24–27 are themes 12/10/11/13.
- Destination variables per family: wl ofs/def/bpl = `$535E/$5362/$5366`, fl def/bpl `$5356/$535A`
  (fl ofs = literal `fl_00.ofs`, `$5352`), pit `$540E/$5412/$5416`, obj1–3 `$541A..$543A`,
  onwl1 `$543E/5442/5446`, onwl2 `$544A/544E/5452`, stru `$5456/545A/545E`, strd `$5462/5466/546A`,
  mon1/2 `$5486..`/`$5492..`, gt `$549E/54A2/54A6`, sww `$54AA..`, swg `$54B6..`, swp `$54C2..`;
  fixed resources: `grounda.def/.ofs` + `water.bpl` (`$53E6/$53E2/$53EA`), chest `$53FA..`, fire `$53EE/53F2/53F6`,
  items `$547A..`, fspells `$546E..`, spani `$5406/$540A`.

### 6.2 Level file blocks (**confirmed** for 3 of 10; others rendered)
`dng_NN.dat` header offsets map to runtime vars in the loader at +0x949A: offs[0] cells (`$968E`),
offs[1] list `$9692` (30-B records, x@+0x12 y@+0x14; set by cell byte5 bit7), offs[2] `$9696` (36-B, x@+0x16
y@+0x18; byte5 bit6), offs[3] `$969A`, offs[4] **gates** `$969E` (10-B: type, x, y, state, orient),
offs[5] **wall decorations** `$96A2` (8-B: type 1/2 = onwl1/onwl2, x, y, side 0..3 absolute N,E,S,W),
offs[6] `$96A6`, offs[7] **stairs/teleports** `$96AA` (12-B: kind 1/2, x, y, destX, destY, destLevel), offs[8]/[9] unknown.
Lists are terminated by a word `0xFFFF`; a word `0` is an empty slot. Evidence: 29/29 decor entries in
dng_00 sit on cells with byte3 bit3 set (null control: shuffled coordinates fail); block lengths are
`10n+2` (gates), `8n+2` (decor), `12n+2` (stairs).

Cell bytes (8 per cell, row-major `y*W+x`):

| Byte.bit | Meaning | Evidence |
|---|---|---|
| 5.0 | wall; blocks movement | 0x9A42, draw 0x7980 |
| 5.1 | illusory wall: drawn as wall unless flag `$49A6`, does **not** block party | 0x7980/0x9A2E; toggled by event at 0xB294 |
| 5.7 | monster present (list offs[1]); blocks party | 0x79D2, 0x9A4C |
| 5.3/4/5/6 | presence flags for entity lists (`$96BE`/`$96BA`/`$96C2`/`$9696`) | 0x7A22–0x7B8C (hypothesis: items/monsters) |
| 0.0 / 0.1 | fire (animated, two flicker frames) / water | 0x698E, 0x68A4 |
| 1.0 | ceiling-hung `obj_` object; blocks party | 0x6A32, 0x9A6A |
| 3.1 | chest (`chest.def`); blocks party | 0x6952, 0x9A56 |
| 3.2 | blocks party (not drawn by any routine found) | 0x9A60 |
| 3.3 | has on-wall decoration(s) in offs[5] | 0x78A8 |
| 4.2 / 4.3 | pit B (ceiling, pit recs 8–15) / pit A (floor, recs 0–7) | 0x6918 / 0x68DE |
| 4.4 / 4.5 | stairs/teleport kinds 2 / 1 (offs[7]) | 0x9AB8 / 0x9AC0, 0x6CC4 |
| 4.6 | gate (offs[4]); blocked while `state` bit0 clear | 0x6B04, 0x9B4A (bit0 set = open) |

Facing: 0 = north (−y), 1 = east, 2 = south, 3 = west; step deltas at `+0x115CA` = `(0,-1),(1,0),(0,1),(-1,0)`.

### 6.3 View renderer (**confirmed** by disassembly; entry +0x66CC, frame loop +0x6766)
- View = 192×135, 4 depth rows × 5 lateral cells (lateral 0 centre, 1 left1, 2 left2, 3 right1, 4 right2).
  Cell offsets: `+0x15806` `[row][lat][facing][dx,dy]` signed bytes (built per frame by +0x758C).
  Face rotation `+0x158A6`: `rot[facing][side] = (side − facing)&3`.
- Order: floor/ceiling `fl[(x^y^facing)&1]` at (0,0) (+0x7280; parity makes the floor chequer alternate per step),
  then cells far→near (rows 3..0), lateral 4,3,2,1,0.
- **Solid cell** (+0x7D2A): draws the four entries `+0x15EB6[cell*4..]` (255 = none) of a 72-slot face table.
  Template `+0x15F06` (72×`kind,id1,id2`), destination `+0x15FDE` (72×`x,y` int16), `.def` record fields add their
  own x/y (+0x5D3C). `kind 1`: `wl[id1]` plain; `kind 2`: parity `(cx^cy)&1` = 0 → `wl[id1]` plain, else `wl[id2]` **flipped**.
  Flipped x = `x − 2·xoff + frameW − 8·bytesPerRow` (bit-reversed rows via `mirror.dat`).
- **Occlusion** (+0x76C0/+0x7734/+0x77A2): per lateral line 0/1/3, if the cell one row nearer is solid, entries
  `{0,32,8}+r` / `{16,56}+r` / `{24,64}+r` are cleared.
- **On-wall decoration** (+0x78A8/+0x7932, draw +0x6C4A→+0x7C6E): slot = `+0x160FE[cell*4 + rot(side)]` (−1 none),
  `(kind,rec)` = `+0x1614E[slot]`, kinds 0 none / 1 plain / 2 flipped / 3 flipped iff parity 0. A decoration with a
  non-empty record **replaces** the wall face of that slot (onwl pieces are full wall pictures).
- **Pits**: `(action,rec)` pairs per cell `+0x16446` (A) / `+0x1646E` (B), dest `+0x16676` / `+0x166C6`.
- **Stairs**: cell flag + offs[7]; drawn through the decoration path on `rot = 2` (near face), `strd` for kind 1, `stru` for kind 2.
- **Gates**: orientation test `+0x6BD4[orient*4+facing]`; face-on uses `+0x16496`/`+0x16766` (recs 0–2) plus bars `+0x164E6`/`+0x16806`
  (recs 3–5) while `state==0`; edge-on `+0x164BE`/`+0x167B6` (rec 6). The opening animation (state ≠ 0, high byte) is not ported.
- Not ported (draw routines located, tables not decoded): monsters/items/objects/chests/water/fire/switches (`ap2-entities`).

### 6.4 Paths tried / honesty
| Item | Result |
|---|---|
| Palette indices 12–15 (lime/teal in `set_00`) | wl records use 12/14 for 17–50 % of pixels (far walls mostly 14); no routine found that rewrites them (the `$3584` writes are UI rectangles, not colours). Still `ap2-image-palettes`. **Solved 2026-11-21 (§5.1):** nothing rewrites them — walls never index them; plane 3 of a wall is the EHB plane (view descriptor 4 swaps plane pointers 3↔5). |
| Level 0 (16,12) N "scrambled" front wall (2026-11-21 re-check) | Not a renderer bug: slot 33 (kind 2, id 0/0, parity flip) draws `wl_00[0]` flipped, 16100/16100 pixels match; neighbours (15,11)/(17,11) draw the same record unflipped, so mirrored seams + `set_00` lime/teal 12/14 speckle make the stone look noisy. Level 2 (11,2) N draws a coherent stone wall. |
| Level 13 (16,17) N black band | Not a bug: every standard `fl_NN` image has an all-index-0 horizon band (rows 38–63); with 8 open cells ahead nothing covers it. |
| IRA on `main` | `ReadSymbol error` on this HUNK; used a flat-image r2 sweep (entry +0x1B0). |

### 6.5 What transfers to AP1 (hypothesis, not checked)
Same kernel lineage (§4): the 4×5 view-cell scheme, `rot[facing][side]`, the 72-slot face-template idea,
per-cell parity flipping, `mirror.dat` bit reversal, the `0x1C`-byte-record style blit and the
"decoration replaces wall face" rule are engine-level and likely carry over; AP1's headerless art needs its
geometry from its own tables (offset/size per piece) rather than `.def`, and its 2-byte cells carry fewer
flags. Locate AP1's equivalents by searching its `code` for the `mulu #0x1C`-style record stride and a `(side-facing)&3` table.

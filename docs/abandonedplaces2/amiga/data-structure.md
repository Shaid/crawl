# Abandoned Places 2 (Amiga) — data structure

Recon, 2026-11-21. Retail files stay where they are, at
`data/_unexplored_/abandonedplaces2/`. Offsets are **byte offsets into the named
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
`0000`, and the file ends with 4 zero bytes. Sections 0–3 hold 63 / 160 / 194 / 200
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
their mask). **Invariant check:** `plane size = bytes/row × h`, `colour size =
planes × plane size`, and `ofs[i+1]−ofs[i] = (planes+1) × plane size` (or 0) hold for
**1,476/1,520** non-empty records across every `.def`/`.ofs`/`.bpl` triplet. All 44
failures are UI triplets (`plheads` 40, `dispadd` 2, `menu` 2), which presumably have
no mask plane; every dungeon tileset triplet passes. Confidence: rendered (structural). The slot destination table itself
is still to be found in `main`.

## Open families — paths tried

| Family | Approach | Result | Notes |
|---|---|---|---|
| dng cell bytes 0–4 | — | — | |
| `.def` word 6 low byte, slot dest coords | — | — | |
| `.ani`, `.cfs`, `bank*` | — | — | |

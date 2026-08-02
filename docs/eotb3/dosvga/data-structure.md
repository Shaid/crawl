# Eye of the Beholder III: Assault on Myth Drannor — DOS/Windows port

Source data: `data/eotb3/dosvga/` (a 1993 SSI/Westwood DOS release; `EYE.BAT`
launches `aesop eye start`).

## Provenance and how this doc was built

EOB3 does **not** use Westwood's Kyra engine (the one ScummVM's `engines/kyra/`
implements for EOB1/EOB2/Lands of Lore). It runs on **AESOP**, a bytecode VM
written by John Miles, used only by EOB3 and SSI's *Dungeon Hack*. ScummVM has
no AESOP support, so there is no ready-made reference decoder the way there is
for the Kyra games.

There is, however, a very strong ground-truth oracle: **ThirdEye**
(`github.com/psi29a/thirdeye`), an open-source (GPL) from-scratch AESOP
reimplementation that boots EOB3 from the original data files and renders its
menus and dungeon. Every format below was cross-checked against ThirdEye's C++
source (`apps/thirdeye/resources/*.cpp`, `apps/thirdeye/graphics/*.cpp`) and,
where ThirdEye has its own research notes, its `docs/*.md`. Two independent
checks matter here:

1. **This project's from-scratch Python parser reproduces ThirdEye's
   independently-derived `EYE.RES` counts byte-exact** (§1) — strong evidence
   the container format is right, not just that both projects made the same
   assumption.
2. **One outright error in ThirdEye's own docs was found and corrected** here
   (§6, `ITEMTYPE.DAT` field offsets) by cross-checking many known AD&D 2e
   values directly against the real file bytes — so "cross-checked against
   ThirdEye" always means "and independently verified against real bytes,"
   not "trusted at face value."

`docs/eotb3/eotb3-formats-research.md` (an earlier internet-research pass,
explicitly marked unverified) claimed EOB3 uses "AESOP/32" bytecode and that
"CPS is replaced with packed BMP." Both claims are **refuted** by the actual
file header (`EYE.RES` begins `AESOP/16 V1.00` — AESOP/**16**, not 32) and by
the presence of working, standard Westwood CPS files in `CHARGEN/` (§2). See
the correction note in that file's history for detail; this doc is the
current source of truth.

Confidence key: **confirmed** (verified against ground truth — byte-exact
structural invariant, clean recognizable render, or independent reimplementation
cross-reference with our own re-derivation), **rendered** (plausible decode,
not independently verified), **hypothesis** (structurally plausible, unverified).

---

## 1. `EYE.RES` — AESOP/16 resource container — confirmed

The single container holding almost everything the running game needs:
bytecode ("SOP") objects, bitmaps, palettes, fonts, sounds, maps, and strings,
addressed by name through an on-disk hash-dictionary directory. 6,845,522
bytes. Parser: `scripts/eotb3lib/res.py`.

### 1.1 `GlobalHeader` (36 B, file offset 0)

| Offset | Size | Field | Notes |
|---|---|---|---|
| `0x00` | 16 | `signature` | `"AESOP/16 V1.00\0"` + 1 pad byte |
| `0x10` | 4 | `file_size` | u32 LE. **Verified byte-exact**: `6845522` == actual file size |
| `0x14` | 4 | `lost_space` | u32 LE (`0` observed) |
| `0x18` | 4 | `first_directory_block` | u32 LE, file offset. `0x24` (=36, right after this header) |
| `0x1C` | 4 | `create_time` | u32 LE, DOS packed datetime |
| `0x20` | 4 | `modify_time` | u32 LE, DOS packed datetime |

### 1.2 `DirectoryBlock` (644 B: `4 + 128 + 128*4`), linked list

One block indexes up to 128 resource slots; `next_directory_block` (u32 LE,
file offset, `0` = last block) chains to the next.

| Offset | Size | Field |
|---|---|---|
| `+0` | 4 | `next_directory_block` (u32 LE, 0 = end of chain) |
| `+4` | 128 | `data_attributes[128]` (u8 each; `1` = slot unused) |
| `+132` | 512 | `entry_header_index[128]` (u32 LE each; file offset of that slot's `EntryHeader`, `0` = slot not present) |

**Confirmed**: walking this chain from `first_directory_block` on the real
file terminates after exactly **20 blocks** — identical to the count
ThirdEye's independent C++ parser reports for the same file.

### 1.3 `EntryHeader` (12 B) + resource data

Immediately followed by the resource's raw bytes.

| Offset | Size | Field |
|---|---|---|
| `+0` | 4 | `storage_time` (u32 LE) |
| `+4` | 4 | `data_attributes` (u32 LE) |
| `+8` | 4 | `data_size` (u32 LE) |

Resource slot ids are assigned sequentially by walking every directory
block's `entry_header_index[]` in order (stopping a block's scan at the
first `0` entry). **Confirmed**: this produces exactly **2449 entries** —
again identical to ThirdEye's independently-reported count.

### 1.4 Special tables 0–4 and the name dictionary

The first 5 slots (ids 0–4) in the first directory block are themselves
resources holding **AESOP dictionaries** rather than asset data:

| id | Contents |
|---|---|
| 0 | resource name → resource-id-as-decimal-string (**2444 entries, confirmed** — matches ThirdEye) |
| 1, 2 | secondary name tables (object/source-file names) |
| 3 | low-level runtime function catalog (135 entries per ThirdEye) |
| 4 | message ("SEND" vocabulary) names (407 entries per ThirdEye) |

**Dictionary blob format** (same shape for tables 0–4 and for a code
object's `<name>.EXPT`/`<name>.IMPT` export/import resources):

```
u16 bucket_count
bucket_count x u32 chain_offset      (relative to blob start; 0 = empty bucket)
```
Each non-zero chain is a run of length-prefixed strings, alternating
key/value, terminated by a zero-length entry:
```
repeat: u16 length (includes trailing NUL), then `length` bytes (last byte NUL)
until: u16 length == 0
```

**Verification**: parsing table 0 on the real `EYE.RES` and resolving every
name → id round-trips cleanly (e.g. `"WDDOOR1"` → 494, `"Wight"` → 226); the
resolved ids' `EntryHeader.data_size` values are all in-bounds and every
name we spot-checked against ThirdEye's `game_data.md` narrative (e.g. "376
SOP code objects... weapons/armor (axe, long sword, spellbook, holy
symbol)") is present in our own independently-parsed table 0.

Extractor: `scripts/extract_eotb3_res.py` → `public/assets/eotb3/dosvga/data/resources.json`
(all 2449 entries: id, name, size, offset, attributes).

---

## 2. `CPS` — Westwood indexed-bitmap format — confirmed

Used for `CHARGEN/CHARGEN.CPS` (title backdrop), `CHARGEN/CHARGENB.CPS`
(second backdrop), `CHARGEN/ITEMICN.CPS` (item icon sheet). A 320x200
full-screen indexed image, standard across Westwood's DOS catalogue (also
used by e.g. Dune II). Decoder: `scripts/eotb3lib/cps.py`.

### 2.1 File layout

| Offset | Size | Field | Notes |
|---|---|---|---|
| `0x00` | 2 | `fileSize` | u16 LE, byte count after this field |
| `0x02` | 2 | `compression` | u16 LE. `0` = raw, `4` = LCW/Format80 |
| `0x04` | 4 | `uncompressedSize` | u32 LE. `64000` in all 3 files (`320*200`) |
| `0x08` | 2 | `paletteSize` | u16 LE. `0` (no embedded palette) in all 3 files |
| `0x0A` | `paletteSize` | `palette` | present only if `paletteSize != 0` |
| — | rest | `data` | raw or LCW-compressed indexed pixels |

**Confirmed**: `fileSize` field matches actual file size minus 2 exactly for
all three files; `compression == 4` (LCW) in all three; decompressed output
length matches `uncompressedSize` exactly (`64000`) with **zero** truncation
or overflow across all three files.

### 2.2 LCW (Format80) decompression

Four command families dispatched on the top bits of each command byte:

| Pattern | Meaning |
|---|---|
| `0xxxxxxx <b1>` | short relative copy from output; `count = ((c>>4)&7)+3`, `offset = ((c&0x0F)<<8)\|b1` (1..4095 bytes back) |
| `10xxxxxx` | literal run of `c & 0x3F` bytes; `0x80` alone = end of stream |
| `11xxxxxx` (`c < 0xFE`) | medium copy from absolute output position (u16 LE follows); `count = (c&0x3F)+3` |
| `0xFE` | large fill: `u16 count`, `u8 colour` |
| `0xFF` | large copy from absolute output position: `u16 count`, `u16 pos` |

**Verification**: decoded `CHARGEN.CPS` renders as a clean, fully legible
"Character Generation" title screen (readable embossed title text, stone
UI-panel borders); `ITEMICN.CPS` renders as a clean grid of ~110 distinct,
individually-recognizable item icons (weapons, armour, potions, scrolls) with
**zero** visible corruption or misalignment. See
`public/assets/eotb3/dosvga/screens/chargen.png` and
`public/assets/eotb3/dosvga/sprites/item-icons.png`.

### 2.3 `ITEMICN.CPS` icon grid — confirmed

16x16-pixel cells, 20 columns (only the top ~6 rows are populated: content
occupies rows 0–95 of the 200-row canvas). Confirmed by overlaying a 16px
grid on the decoded sheet: every icon aligns cleanly inside its cell with no
bleed across a boundary, and `CHARGEN/ITEM.DAT`'s `pic` field (icon index)
never exceeds 111 — comfortably inside the 20x6=120-cell grid.

Extractor: `scripts/extract_eotb3_chargen.py` → `screens/chargen.png`,
`screens/chargen-b.png`, `sprites/item-icons.{png,json}`.

---

## 3. Palettes — confirmed

Two on-disk shapes, both confirmed against real files. Decoder:
`scripts/eotb3lib/palette.py`.

### 3.1 Raw palette (`CHARGEN/PALETTE.COL`, GFF `PAL` blocks, CPS-embedded)

`N * 3` bytes, no header — each byte a 6-bit (0..63) VGA DAC value.
`PALETTE.COL` is exactly 768 B = 256 colours. Scale to 8-bit: `v << 2`
(matches ThirdEye's `palette.cpp` exactly, including the resulting max
value of 252 rather than 255).

### 3.2 Resource palette (`EYE.RES` palette resources — e.g. `"Human paladin
palette"`)

26-byte header, then `numColours * 3` bytes of 6-bit RGB at offset 26:

| Offset | Size | Field |
|---|---|---|
| `+0` | 2 | `numColours` (u16 LE) |
| `+2` | 2 | `colorArrayOffset` (u16 LE) |
| `+4` | 2 | `fadeIndexArray00` (u16 LE) |
| `+6..25` | 20 | further fade-index-array offsets (not decoded) |
| `+26` | `numColours*3` | 6-bit RGB triples |

**Verified**: `"Human paladin palette"` resource decodes to `numColours=80`,
and applying it (via the VFX shape decoder, §4.2) to the `"Wight"` monster
bitmap resource produces a clean, correctly-shaped monster silhouette (see
§4.2) — i.e. the palette resource and a real bitmap resource decode
consistently against each other, not just internally.

Extractor output: `palettes/chargen.json` (256 colours, `PALETTE.COL`);
`palettes/<gff>-N.json` (per embedded GFF `PAL` block, see §5).

---

## 4. Bitmap sub-formats

Three distinct on-disk pixel encodings share the "AESOP bitmap" umbrella.
All three decode cleanly; none share a byte layout with each other beyond
loose family resemblance. Decoder: `scripts/eotb3lib/bitmap.py`.

### 4.1 "Old format" row/span RLE — confirmed

Used by GFF `BMP`/`BMA` cutscene frames (§5) and `CHARGEN/CHARPICS.BMP`
portraits (§4.3).

```
u16 fileSize-ish / unused
u16 unknown1
u16 numSubBitmaps          @ offset 4
u16 offsetTable[numSubBitmaps]   4-byte stride; only the first 2 bytes of
                                  each 4-byte slot is the sub-bitmap's file
                                  offset (offset table starts @ offset 6)
```
Per sub-bitmap, at its offset:
```
u16 width, u16 height
then a scanline stream:
    byte y                     (0xFF = end of image)
    repeat:
        u16 x_and_islast       (low 15 bits = x; bit 15 = "last span this row")
        u8  span_width         (pixel count for this span)
        (4th header byte unused by the decode)
        while span_width > 0:
            byte token          bit0 = mode (0 = copy literal bytes that
                                 follow, 1 = fill — next byte is the value,
                                 repeated); bits 1-7 = amount-1
        until span consumed; if not islast, loop for a new x/span; if
        islast, read the next byte as a new row's `y` (or 0xFF to end)
```

**Confirmed**: `INTRO.GFF`'s `BMP` frames decode to fully clean, professional
cutscene art (a lit night-time town street; a tavern interior with a seated
figure, candle, and window) — zero visible corruption across all 20 frames
tested. See `public/assets/eotb3/dosvga/screens/intro-bmp-*.png`.

`BMA` ("bitmap animation") uses the **exact same format**, just with many
sub-bitmaps in one blob — e.g. one `INTRO.GFF` `BMA` resource has
`numSubBitmaps = 66`, and every one of those 66 offsets decodes to a valid
320x200 frame. (An earlier draft of this doc/extractor assumed `BMA` frames
were chained end-to-end via a "next frame starts right after this one"
scheme with no directory — that was wrong; the directory is already there,
identical in shape to the single-image case.) Most animation frames are
near-empty (only a handful of non-background pixels) because they encode a
**delta** — e.g. a twinkling-stars overlay redrawn each tick over a static
background image that the sub-bitmap doesn't repaint. This is consistent
with how the "old format" scanline stream naturally represents a mostly-
unpainted frame (very few row/span tokens) and is the expected shape for
an animation-overlay asset, not a decode bug.

### 4.2 AESOP/16 "1.10" VFX shape table — confirmed

Every bitmap resource embedded directly in `EYE.RES` (monsters, items, UI
elements, decorations) uses this format.

```
4-byte version tag "1.10"
u32 shapeCount
shapeCount x 8-byte directory entries {u32 offset, u32 colour}
```
Each entry's `offset` points at a 24-byte per-shape header (only the first
4 bytes are decoded: `boundsy = height-1` @ +0, `boundsx = width-1` @ +2;
the remaining 20 bytes are unidentified), followed by a per-line token
stream:

| Marker | Meaning |
|---|---|
| `0` | end of line |
| `1 <n>` | skip `n` transparent pixels |
| even `>= 2` | run: `amount = marker>>1`, next byte = pixel value repeated `amount` times |
| odd `>= 3` | string: `amount = marker>>1`, then `amount` literal pixel bytes |

There is exactly one end-of-line marker per row, `height` rows total. Pixels
never explicitly touched by a token are transparent (tracked via a separate
mask array — palette index 0 is a real, paintable colour in this format, not
an implicit colour-key, matching ThirdEye's `decodeVFXShapeMasked` comment).

**Confirmed** at scale: scanning all 2449 `EYE.RES` resources for the `"1.10"`
tag found **312 bitmap resources / 3528 individual shapes**, every one
decoding without a single bounds/format error. Spot-rendered output is
unambiguous: the `"Wight"` resource (6 shapes, 80x88) renders as a
recognizable hunched-zombie silhouette; a full atlas batch shows doors (in
multiple open/closed animation states), free-standing statues, trees,
wall reliefs/tapestries, and small "postcard" vignette scene pictures — see
`public/assets/eotb3/dosvga/sprites/res/batch-*.png`.

**Open**: which named palette resource (§3.2) pairs with which bitmap
resource is not yet resolved (no direct id cross-reference found in the
container structure itself — likely resolved by the AESOP bytecode at
runtime, e.g. a SOP object property naming both its bitmap and its
palette). The batch atlases in `sprites/res/` are therefore rendered in a
**neutral greyscale ramp** (index value stretched across 0–255), not final
game colours — shape/structure confirmed, colour not yet confirmed for the
general case (the "Wight" + "Human paladin palette" pairing above is a
manually-chosen spot-check, not a general resolution mechanism).

### 4.3 `CHARGEN/CHARPICS.BMP` portrait directory — confirmed

```
u32 fileSize        (== actual file size)
u16 count
u16 tableEnd         (file offset where portrait 0's 4-byte sub-header starts)
u16 zero
u32 offsets[count-1]  (offsets[i] = start of portrait i+1's sub-header)
```
Each portrait: `u16 width-1, u16 height`, then the same scanline-RLE stream
as §4.1 (§4.1's row/span format, single image — no outer y/islast wrapper
needed beyond the per-row loop already in that format).

**Confirmed byte-exact**: `count = 90`, matching ThirdEye's independently-
reported portrait count for this exact file. All 90 portraits decode to
32x32 images; a contact sheet of the first 12 shows fully clean, individually
distinct fantasy character faces (wizard, dwarf, knight, ...) with zero
corruption. See `public/assets/eotb3/dosvga/sprites/portraits.png`.

Extractor: `scripts/extract_eotb3_chargen.py` (§4.3),
`scripts/extract_eotb3_gff.py` (§4.1/§5), `scripts/extract_eotb3_res.py` (§4.2).

---

## 5. `GFF`/"GFFI" — cinematic container — confirmed

`INTRO.GFF`, `DARK.GFF`, `FINALE.GFF`, `LICH.GFF` — cutscene asset bundles
for `CINE.EXE`, the separate cinematic player `AESOP.EXE` launches. Made by
Miles Design Inc (a "Copyright (C) 1991,1992 Miles Design..." string sits
right after the header). Parser: `scripts/eotb3lib/gffi.py`.

### 5.1 `GFFIHeader` (28 B)

| Offset | Size | Field |
|---|---|---|
| `+0` | 4 | `signature` = `"GFFI"` |
| `+4` | 2 | `unknown1` (`0` observed) |
| `+6` | 2 | `unknown2` (`3` observed) |
| `+8` | 4 | `header` (`0x1C` observed — offset where the copyright text starts) |
| `+12` | 4 | `directory_offset` |
| `+16` | 4 | `directory_size` |
| `+20` | 4 | `unknown3` (`0` observed) |
| `+24` | 4 | `unknown4` |

### 5.2 Directory, at `directory_offset`

```
GFFIDirectoryHeader (10 B):
    u32 unknown1          (8 observed)
    u32 directory_size     size of the tag-block area that follows (NOT
                            counting this 10-byte header) — distinct from
                            GFFIHeader's own directory_size field (the two
                            differ; **the trailer offset must use THIS one**,
                            not the header's — an early draft of the parser
                            used the wrong field and mis-located the trailer
                            by a few bytes on every file)
    u16 number_of_tags
```
Then `number_of_tags` tagged blocks back to back:
```
GFFIBlockHeader (8 B): char tag[4]; u32 number_of_elements
    number_of_elements x GFFIBlock (12 B): u32 unique; u32 offset; u32 size
```
Directory ends with a `u16` trailer that must be `0`, at
`directory_offset + (inner) directory_size`.

**Confirmed**: parses cleanly on all 4 files with the trailer check passing;
tag inventory is sane and consistent across files: `PAL` (0–2 per file),
`BMP` (0–20), `BMA` (2–6), `ACF`, `MERR` (constant 27 across every file —
almost certainly a shared error-message table), `CSEQ`/`PSEQ`/`FSEQ`/`LSEQ`
(sequencing data, sizes scale with cutscene complexity), `ADV` (4 entries,
byte-identical in size to the top-level `.ADV` Miles AIL sound-driver files
— confirmed **not** unique game content, just bundled driver copies).

`DARK.GFF` and `LICH.GFF` have **no** `PAL` tag at all; `screens/dark-bmp-*.png`
and any `LICH.GFF`-sourced sprites fall back to the `CHARGEN/PALETTE.COL`
global palette. That render looks plausible (readable dialogue-scene art,
a green-hued robed antagonist) but is **not independently colour-verified**
for those two files — flagged `rendered`, not `confirmed`, for palette
accuracy specifically (the pixel/shape decode itself is confirmed).

Extractor: `scripts/extract_eotb3_gff.py`.

---

## 6. `CHARGEN/ITEM.DAT` + `CHARGEN/ITEMTYPE.DAT` — confirmed

Decoder: `scripts/eotb3lib/itemdat.py`.

### 6.1 `ITEM.DAT` — 10385 B, 434 items + 123 names — confirmed

```
u16 numItems              (434)
434 x 14-byte item records
u16 numNames               (123)
123 x 35-byte NUL-padded name strings
```
`2 + 434*14 + 2 + 123*35 = 10385` — **verified**: parsed `consumedBytes ==
totalBytes` exactly.

This is the **same 14-byte-record EOB1 format** documented in
`docs/eotb/amiga/eotb-item-dat-spec.md` (ModdingWiki) — confirmed
field-for-field identical, and the decoded name table (`"Mouse Pointer"`,
`"Leather armor"`, `"Robe"`, `"Cleric Holy symbol"`, ...) matches ThirdEye's
independently-produced dump of the same file exactly.

| off | size | field |
|---|---|---|
| `+0` | u8 | `unid` — name-string index when unidentified |
| `+1` | u8 | `id` — name-string index when identified |
| `+2` | u8 | `bits` — `0x80` glow-magic, `0x40` identified, `0x20` cursed, `0x08` life-drain |
| `+3` | u8 | `pic` — inventory icon index into `ITEMICN.CPS`'s grid (§2.3) |
| `+4` | u8 | `type` — index into `ITEMTYPE.DAT` (§6.2) |
| `+5` | u8 | `subpos` — placement (floor/wall dir 0..7, inventory slot 0..26, container compartment 8) |
| `+6` | i16 | `pos` — `x + y*32` on the dungeon level; `<=0` = consumed/carried |
| `+8` | i16 | `next` — next item id in chain (`-1` = tail) |
| `+10` | i16 | `prev` — previous item id (`-1` = head) |
| `+12` | u8 | `level` — dungeon level the item lives on |
| `+13` | i8 | `value` — type-dependent bonus/charge/key-kind byte |

### 6.2 `ITEMTYPE.DAT` — 1026 B, 64 type templates — confirmed (offsets
corrected from ThirdEye's own docs)

```
N x 16-byte type records     N = (filesize - 2) / 16 = 64; no count header
u16 trailer                   (0x0004 in the bundled file)
```

> **Correction applied here**: ThirdEye's `docs/item_dat_format.md` documents
> this record with `AC_bonus`@+4, `class_use_mask`@+5, `flag_x`@+6, damage
> dice starting @+7. Cross-checking that doc's own cited AD&D 2e values
> (axe 1d8/1d10, banded mail AC −6, spellbook Mage-only 0x02, ...) against
> the real file bytes for 27 named type records shows the **actual** offsets
> are each 2 bytes later — `AC_bonus`@+6, `class_use_mask`@+7, dice starting
> @+9. At the corrected offsets, `ac_bonus` and every dice field match the
> cited value exactly for all 27 records except `staff` (doc claims 2d6/1d6;
> our decode reads 1d6/1d6, which is the canonical AD&D 2e quarterstaff
> damage — this looks like a doc typo, not a decode error). `class_use_mask`
> matches for 26 of 27 — the one disagreement is `shield`: the doc claims
> `0x35` (Fighter+Cleric+Paladin+Ranger), the real byte at the corrected
> offset is `0x3d` (adds Thief). Both readings are individually plausible
> AD&D 2e rule variants (some editions restrict thief shield use, some
> don't); recorded here as an open discrepancy rather than resolved either
> way. See `scripts/eotb3lib/itemdat.py` reproduction below.

| off | size | field | verified against |
|---|---|---|---|
| `+0` | u16 | `mask_A` | unknown — correlates with equip slot but not cleanly decoded |
| `+2` | u16 | `mask_B` | unknown |
| `+4` | u16 | `field3` | unknown (icon dims? weight?) |
| `+6` | i8 | `ac_bonus` | **signed**. banded −6, chainmail −5, platemail −7, scalemail −4, helmet/leather armour/shield −1/−2, 0 for all weapons |
| `+7` | u8 | `class_use_mask` | bit0 Fighter, bit1 Mage, bit2 Cleric, bit3 Thief, bit4 Paladin, bit5 Ranger. lock picks=0x08 (Thief-only), spellbook=0x02 (Mage-only), holy symbol=0x14 (Paladin+Cleric), staff/rations/boots/robe/ring/bracers=0x3f (all six) |
| `+8` | u8 | `flag_x` | small (0..2), roughly tracks weapon reach/class — hypothesis |
| `+9` | u8 | `sm_dice_count` | axe/longsword=1, dagger=1, polearm=1... |
| `+10` | u8 | `sm_dice_sides` | axe=8 (1d8), shortsword=6 (1d6), dagger=4 (1d4) — PHB exact |
| `+11` | u8 | `sm_dmg_plus` | mace/flail=+1, others +0 |
| `+12` | u8 | `lg_dice_count` | |
| `+13` | u8 | `lg_dice_sides` | axe=10 (1d10), longsword=12 (1d12), shortsword=8 (1d8) — PHB exact |
| `+14` | u8 | `lg_dmg_plus` | |
| `+15` | u8 | `_pad` | `0` in every bundled record |

Full verification table (27 named types, 26/27 exact — see §6.2 note above)
is reproducible via `scripts/eotb3lib/itemdat.py` + the cross-check script
used during this pass (not committed — a one-off comparison against the
table above).

Extractor: `scripts/extract_eotb3_chargen.py` → `data/item.json`, `data/itemtype.json`.

---

## 7. `CHARGEN/FONT6.FNT` + `CHARGEN/FONT8.FNT` — confirmed

Bit-packed 8-column bitmap fonts. Decoder: `scripts/eotb3lib/font.py`.

```
u16 fileSize - 2                (sanity-check value)
u16 offsets[128]                one per ASCII 0..127, file-relative
u8  glyphData[]                 8-column bitmap rows, 1 byte/row, bit 7 =
                                 leftmost pixel
```
Glyph height for character `i` = `offsets[i+1] - offsets[i]` (or
`fileSize - offsets[i]` for `i == 127`); width is fixed at 8px.
`FONT6.FNT` glyphs are 6 rows tall, `FONT8.FNT` glyphs are 8 rows tall —
consistent with the filenames, but a consequence of the offset deltas, not
a declared field.

**Confirmed**: `sizeCheck` field matches `filesize - 2` exactly for both
files; rendered glyph atlas for `FONT8.FNT` is a fully legible, correctly-
spaced printable ASCII set (verified by eye against the standard ASCII
table, `!"#$%&'()*+,-./0123456789...ABCDEFGHIJKLMNOPQRSTUVWXYZ...abcdefg...`).

Extractor: `scripts/extract_eotb3_chargen.py` → `sprites/font6.{png,json}`,
`sprites/font8.{png,json}`.

---

## 8. `SAVEGAME/` — spot-verified against ThirdEye, not independently re-derived

ThirdEye's `docs/eob3_savegame_format.md` documents this format exhaustively
(header, per-character 627-byte records, item-object CDESC stream, and
`LVLnn.TMP`'s variable-length level-object records) from its own RE pass —
not re-derived from scratch here. Two targeted spot-checks against our own
`data/eotb3/dosvga/SAVEGAME/` files, independent of ThirdEye's bundled save,
confirm the documented offsets hold on **our** data too:

- **`ITEMS_00.BIN`** (20495 B): bytes `252..255` (party X, Y, facing,
  dungeon) read `7, 24, 1, 3` — this is a *different* save than ThirdEye's
  documented "Quick Start Party" example (our character names at the
  documented `+155` offset from the first two 627-byte character records
  are `"THELMA"` / `"LOUISE"`, not `"Sir Mikeal"` / `"Stonebeard"") — yet the
  position fields land exactly where documented, confirming the offset
  table generalizes across different save content, not just the one file
  ThirdEye analyzed.
- **`LVL03_00.BIN`** (13436 B): applying ThirdEye's documented level-object
  scan heuristic (an object record starts wherever `id@+1` falls in
  1000–4999 **and** `class@+3` falls in 1300–2450) finds 350 candidate
  record starts — a plausible object count for a populated dungeon level,
  consistent with ThirdEye's own report of "LVL01 loads 231 objects."

No extractor was written for `SAVEGAME/` this pass — it's player save state,
not a fixed game asset (see `game-re-lessons/save-file-not-asset.md`), and
ThirdEye's existing documentation already covers it well. Flagged **open**
below only in the sense that this project hasn't independently re-derived
or extracted it; the format itself is not in doubt.

---

## Still open

| Item | Status | Notes |
|---|---|---|
| EYE.RES bitmap ↔ palette resolution | open | §4.2 — 312 bitmap resources decode correctly in shape/mask but render in neutral greyscale; no cross-reference to the correct named palette resource found in the container structure itself. Likely resolved by AESOP bytecode (SOP object properties) at runtime — would need to disassemble at least one drawing routine's bytecode to confirm the mechanism generally, not just spot-check one pairing by hand. |
| DARK.GFF / LICH.GFF colour accuracy | rendered, not confirmed | §5 — no embedded PAL block; extractor falls back to the CHARGEN.PALETTE.COL global palette, which renders plausibly but is unverified for these two files specifically. |
| AESOP bytecode (SOP code objects) | not attempted | 376 code objects live inside EYE.RES (per ThirdEye); this is game logic, not asset data, and out of scope for an asset-extraction pass — ThirdEye's `daesop` disassembler already covers this ground. |
| GFF `ACF`/`MERR`/`*SEQ` tag blocks | not decoded | Likely error-message tables + cutscene playback sequencing (ThirdEye's `gffi.cpp getSequence()` hand-codes INTRO.GFF's sequence rather than parsing a `*SEQ` block, suggesting these aren't a generic data format ThirdEye itself fully cracked either). Out of scope this pass — not visual/audio asset content. |
| `EYE.RES` non-bitmap resource types (sounds, maps, strings) | not extracted | Only the `"1.10"` VFX-shape subset (§4.2) was batch-decoded. `resources.json` (§1.4) has the full name/size/offset manifest for follow-up work. |
| `CHARGEN/EOSPREFS.DAT` (6 B) | not decoded | Too small/low-value to prioritize (`03 00 00 00 01 00` — plausibly two u16/u32 fields; not attempted). |
| `SAVEGAME/*.TMP`/`*.BIN` extractor | not written | Format is documented (§8, citing ThirdEye) and spot-verified against our files, but no committed extractor — this is save state, not a shipped asset. |

---

## Paths tried (for the items above)

| Approach | Result | Why it stopped there |
|---|---|---|
| Search `EYE.RES` container structure for a bitmap→palette id field | No direct field found in `EntryHeader`/dictionary structures | The container's own metadata (storage time, attributes, size) carries no cross-reference; attributes field wasn't decoded bit-by-bit against a large enough resource-type sample to rule out a hidden reference there — see next row |
| Bit-decode `EntryHeader.data_attributes` across resource types | Not attempted this pass | Would need to correlate `data_attributes` values against resource *content* (VFX bitmap vs SOP code vs string) across a large sample to see whether it's a type tag or something else — the natural next step, not started for lack of time budget |
| Manual palette pairing (`"Human paladin palette"` + `"Wight"`) | Renders a recognizable, correctly-shaped silhouette | Confirms VFX shape decode is correct; does **not** establish a general pairing rule (the palette name was chosen by inspection, not derived) |

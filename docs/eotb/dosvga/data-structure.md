# Eye of the Beholder (EOB1) — DOS/VGA Data Structures

**Source data:** `data/eotb/dosvga/` — `EOBDATA1-6.PAK`, `EYE.PAK`, `FONT6/8.FNT`,
`CGA/EGA/MCGA/TGA.OVL`, `EOB.EXE`, `INTRO.EXE`, `START1.EXE`.

**Engine:** Westwood's "Kyra" engine, fully reimplemented in
[ScummVM](https://github.com/scummvm/scummvm) (`engines/kyra/`). Every format
below was cross-checked against that source (fetched 2026-08-02, `master`
branch) rather than re-derived from scratch — file/line references are given
per section. This supersedes `docs/eotb/eotb2-formats-research.md`'s EOB1
claims where they differ (none did, in the end — the internet-research doc's
EOB1-inherited details all checked out).

**Note:** this doc is independent of `docs/eotb/amiga/data-structure.md` —
the Amiga port uses different file formats (Amiga bitplane CPS, 12-bit
palettes, individual loose files). Where the two share a concept (CPS
header shape, VCN/VMP/MAZ existence) the byte-level encoding differs and is
documented separately in each file; do not assume Amiga offsets apply here.

---

## PAK — Container format

**Confirmed.** Byte-exact port of ScummVM's `ResLoaderPak::load`
(`engines/kyra/resource/resource_intern.cpp:292-383`). Implementation:
`scripts/kyralib/pak.py`.

The file opens directly on its directory — no magic, no header. Each record
is a NUL-terminated filename followed by a `u32 LE` offset that is BOTH the
*next* record's data-start offset and the *current* record's data-end
offset (the very first offset, read before the loop, is the first record's
start). The directory ends at an empty filename or when the offset reached
equals the file size.

```
u32 LE          first_data_offset
repeat:
    cstring     filename (NUL-terminated; empty string = end of directory)
    u32 LE      next_data_offset (this entry's data = [prev_offset, this))
```

A `LINKLIST` pseudo-file (SCVM-tagged alias table) is part of the upstream
format but was not observed in any file in this corpus — not implemented.

**Verified:** all 6 `EOBDATA{1..6}.PAK` files parse cleanly end-to-end (no
corruption raised, final offset lands exactly on EOF) for a combined 185
entries. Cross-platform structural check: `ITEM.DAT` and `ITEMTYPE.DAT`
extracted from `EOBDATA6.PAK` are the exact same byte length (9,601 and 914
bytes respectively) as the already-verified Amiga versions
(`data/eotb/amiga/ITEM.DAT`/`ITEMTYPE.DAT`), and differing bytes follow a
16-bit-swap pattern at record boundaries (`dos[0:2] == amiga[0:2][::-1]`,
repeated at several other offsets) — strong evidence the two are the same
table, DOS little-endian vs. Amiga big-endian. Full field-level layout not
re-derived (inherited as **hypothesis** from the Amiga doc, endianness
flipped) — see "Open items" below.

**`EYE.PAK` (1,753,104 bytes) does NOT use this format** — its first `u32`
fails the directory bounds check in both endiannesses (offsets exceed the
file size either way). It is also never referenced by name in `strings`
output from `EOB.EXE`, `INTRO.EXE`, or `START1.EXE` (which all only
reference `eobdata1.pak`...`eobdata6.pak`). `INSTALL.BAT` states the game
"must be run from the Eye of the Beholder CD only" — `EYE.PAK` is most
likely a CD-distribution artifact (e.g. a separate installer payload) not
loaded by the shipped executables at all. Left unparsed; see "Open items".

### PAK directory listing (this corpus)

| PAK | Entries | Contents |
|-----|---------|----------|
| `EOBDATA1.PAK` | 17 | Sound `.DAT`s, cutscene/effect `.CMP` (adventure text intro, avalanche, hands, king, orb, text, title, tower mage, tunnel, water-drop x3, zoom-tunnel) |
| `EOBDATA2.PAK` | 2 | `DOOR.EGA`, `EOBPAL.COL` (main VGA palette) |
| `EOBDATA3.PAK` | 40 | BRICK wall set (CPS/EGA/DAT/VCN/VMP/ECN/EMP/PAL), levels 1-3 (`.INF`/`.MAZ`), monsters (kobold/leech/skeleton/zombie/flind/kuotoa), `INVENT.CPS`, `TEXT.DAT`, intro/outtake/chargen screens |
| `EOBDATA4.PAK` | 54 | BLUE wall set, levels 4-6, monsters (spider/dwarf/kenku/mage), death animations, chargen A/B, 14 `.COL` standalone palettes (some duplicated), `SOUND.DAT`, title/credits `.CMP` |
| `EOBDATA5.PAK` | 36 | GREEN wall set, levels 10-12, monsters (shindia/mantis/mflayer/xorn/xanath/golem), XANATHA wall set (2nd), `PLAYFLD.CPS` |
| `EOBDATA6.PAK` | 44 | DROW wall set, levels 7-9, monsters (drowelf/skelwar/hellhound/drider/rust/disbeast), item icon sheets, `ITEM.DAT`/`ITEMTYPE.DAT`, portal CPS |

All CPS graphics files use the `.CPS` extension for VGA/MCGA (chunky 8bpp)
and a parallel `.EGA` file (EGA/4bpp, not decoded by this extractor — see
"Open items") for the EGA render mode; `.ECN`/`.EMP` are the EGA-mode
equivalents of `.VCN`/`.VMP`.

---

## Kyra shared bitmap header (CPS/CMP/VCN)

**Confirmed.** Port of `Screen::loadBitmap`
(`engines/kyra/graphics/screen.cpp:3430-3477`). Implementation:
`scripts/kyralib/format80.py`.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 2 | `fileSizeField` | = file size − 2; unused by the decoder |
| 0x02 | 2 | `compType` | `0` = raw, `4` = LCW (only two values seen in this corpus) |
| 0x04 | 4 | `imgSize` | uncompressed payload size (always exactly `64000` = 320×200×1 for `.CPS`/`.CMP` in this corpus) |
| 0x08 | 2 | `palSize` | 0, or an embedded-palette byte count |
| 0x0A | `palSize` | `palette` | present iff `palSize > 0` (none observed for `.CPS`/`.CMP` in this corpus — all use a separately-named `.PAL`/`.COL`) |
| 0x0A+palSize | — | `payload` | raw or LCW-compressed |

**Verified:** decompressing every `.CMP` in `EOBDATA1.PAK` and every `.CPS`
across all 6 PAKs reproduces `imgSize` bytes exactly (67/67 files, zero
length mismatches, zero decode exceptions).

### LCW (Format80) decompression

Byte-exact port of `Screen::decodeFrame4`
(`engines/kyra/graphics/screen.cpp:2560-2607`) — the same "Format 80"
algorithm documented for the Amiga port
(`docs/eotb/amiga/data-structure.md`), confirmed identical between
platforms. Independently cross-checked against a second, unrelated
reimplementation already in this repo (`scripts/eotb3lib/cps.py`, itself
checked against the open-source "ThirdEye" EOB3 port) — both produce the
same opcode semantics.

```
while dst not full:
    code = next byte
    if code & 0x80 == 0:                    # short relative copy
        len = min(remaining, (code>>4) + 3)
        offs = ((code & 0xF) << 8) | next byte
        copy len bytes from dst[dst_pos - offs]
    elif code & 0x40:                        # 0xC0-0xFF
        if code == 0xFE:                     # fill
            len = u16 LE; val = next byte; fill len bytes with val
        else:
            if code == 0xFF: len = u16 LE     # long copy, else len = (code&0x3F)+3
            offs = u16 LE (absolute dst position)
            copy len bytes from dst[offs]
    elif code != 0x80:                        # 0x80 < code < 0xC0: literal run
        copy (code & 0x3F) bytes verbatim
    else:                                      # code == 0x80: EOF
        break
```

**Verified:** 67/67 `.CPS`/`.CMP` files decode to exactly the header's
declared `imgSize` with no truncation/overrun; `BRICK1.CPS` and
`BRICK.VCN` (below) both render as legible, recognisable content (see
"Rendering verification").

### Pixel layout (CPS/CMP)

Chunky (not planar) 8bpp, 320×200: `pixel(x, y) = payload[y*320 + x]`, a
direct palette index. This differs from the Amiga port, which is 5-bitplane
(32-colour) — DOS/VGA is a straightforward VGA Mode 13h dump.

---

## VGA palette (.PAL / .COL, and any embedded CPS palette)

**Confirmed.** Port of `Palette::loadVGAPalette`
(`engines/kyra/graphics/screen.cpp:4161-4167`) plus the 6-to-8-bit expansion
actually used when painting (`screen.cpp:4258-4260`). Implementation:
`scripts/kyralib/palette.py`.

Each colour is 3 raw bytes (R, G, B), each masked to the low 6 bits (VGA DAC
range 0-63 — the top 2 bits, if set, are noise/reserved and must be
discarded, not merely happen to be zero). Expansion to 8-bit is
`(v << 2) | (v & 3)` — NOT a naive `v * 4` (they agree except in the low 2
bits, e.g. `v=63` → `252|3=255` correctly, vs. `63*4=252` incorrectly
clipped).

768-byte files (256 colours) are the norm: `EOBPAL.COL`, `PALETTE.COL`, each
wall set's `<NAME>.PAL`, and 7 other named `.COL` files
(`ORB`, `TITLE-V`, `TOWRMAGE`, `WESTWOOD`, `WTRDP2`, `ZOOMTUNL`, plus a
second `EOBPAL.COL`/`PALETTE.COL` copy — `EOBDATA4.PAK` lists each of these
7 names twice; only the first occurrence is used, matching how a real
filename-keyed loader would resolve it).

**Per-file palette selection is a hypothesis, not confirmed:** the actual
game logic that picks which palette a given `.CPS`/`.CMP` uses at runtime is
data-driven (level `.INF` files reference a palette by name for wall-set
screens; UI/cutscene screens are loaded by hardcoded filename in the
executable) and was not traced screen-by-screen. This extractor uses a
simple, effective substitute: name-match `<STEM>.PAL` then `<STEM>.COL`
across the merged directory of all 6 PAKs, falling back to `EOBPAL.COL`.
This reproduced the exact known title screen and Westwood/SSI logo screens
correctly (see below), so it is very likely right for anything with a
same-named `.COL`/`.PAL`; screens using the `EOBPAL.COL` fallback (most
monster CPS files, which have no matching `.COL`) are **rendered, not
confirmed** — colours may be off from what the game actually shows in
context (e.g. a monster palette swap for a special encounter).

### Rendering verification

- `screens/title-e.png` (`TITLE-E.CMP` + `EOBPAL.COL` fallback) reproduces
  the well-known "Eye of the Beholder / A Legend Series" DOS title screen
  exactly — readable text, correct gold/black/blue colour scheme.
- `screens/westwood.png` (`WESTWOOD.CMP` + name-matched `WESTWOOD.COL`)
  reproduces the Westwood Associates logo screen exactly.
- `screens/chargen.png` (`CHARGEN.CPS` + `EOBPAL.COL` fallback) is a clean,
  fully legible "Character Generation" UI screen.
- `screens/kobold.png` (`KOBOLD.CPS` + `EOBPAL.COL` fallback) shows 6 clearly
  recognisable kobold sprite-animation frames (idle/walk/attack poses) laid
  out left-to-right/wrapped within the 320×200 canvas.

This is byte-exact-oracle-strength verification for the CPS+LCW+PAK pipeline
(known, recognisable screens reproduced exactly) even though individual
monster-CPS palette choices remain a "rendered" hypothesis.

---

## VCN — Wall tileset

**Confirmed** (structural + visual). Port of
`EoBCoreEngine::loadVcnData` (`engines/kyra/engine/scene_eob.cpp:322-361`)
and `KyraRpgEngine::vcnDraw_fw_4bit`
(`engines/kyra/engine/scene_rpg.cpp:456-462`). `_vcnSrcBitsPerPixel` = 4 for
DOS VGA/EGA (`engine/kyra_rpg.cpp:54`; Amiga uses 5, FM-Towns uses 8 — this
doc is DOS-only). Implementation: `scripts/kyralib/vcn.py`.

A `.VCN` file is a standard Kyra bitmap (above) — `BRICK.VCN`: `compType=4`,
`imgSize=50434`, `palSize=0`, LCW-compressed. **Not** loaded with the
`skip=true`/4-byte-prefix-skip flag that `loadVcnData`'s call site implies —
parsing the header directly at offset 0 (no skip) is what produces
self-consistent numbers (`compType` in {0,4}, plausible `imgSize`); with the
skip applied, header fields come out nonsensical (`imgSize` in the hundreds
of millions). This project's PAK-extracted files evidently don't carry
whatever 4-byte prefix the live `skip=true` call path expects (possibly a
`Resource::fileData` return-size prefix baked in only for that code path,
not present in the raw archived bytes) — noted as a discrepancy from the
naive source reading, resolved empirically.

Decompressed payload layout:

| Offset | Size | Field |
|--------|------|-------|
| 0x00 | 2 | `numTiles` (u16 LE) |
| 0x02 | 32 | `colMap` — per-nibble palette-index remap; only `colMap[0:16]` used by the static (no dynamic lighting) render this extractor produces |
| 0x22 | `numTiles*32` | tile data: 8×8 tiles, 4 bits/pixel, packed 2 px/byte (high nibble first), 8 rows × 4 bytes/row |

Pixel decode per tile, per `vcnDraw_fw_4bit`: for each of 8 rows, 4 bytes;
each byte's high nibble is the even-x pixel, low nibble the odd-x pixel;
each nibble is looked up as `colMap[nibble]` to get the true palette index
(the live game additionally ORs in a brightness/light-level shift value —
not modelled here, so tiles render at the game's "base" light level only).

**Verified:**
- `BRICK.VCN`: `numTiles=1575`, tile-data length is **exactly**
  `1575 * 32 = 50400` bytes with zero remainder (matches `imgSize - 34`
  exactly).
- `BRICK.VMP`'s masked tile-index entries (`entry & 0x3FFF`) top out at
  **exactly** `1574` — `numTiles - 1` — across all 2916 entries, zero
  out-of-range references. This is a strong cross-file structural
  invariant (VCN tile count and VMP's tile-index domain agree exactly).
- `textures/brick_vcn.png` (BRICK.VCN + BRICK.PAL) renders as a visually
  coherent, recognisable brick-wall-and-mossy-floor texture sheet — masonry
  coursing and mortar lines are clearly legible per-tile.

All 5 EOB1 wall sets extracted: BLUE, BRICK, DROW, GREEN, XANATHA.

---

## VMP — Viewport tile-index map

**Confirmed.** Port of `EoBCoreEngine::getVmpData`
(`engines/kyra/engine/scene_eob.cpp:364-366`) and its EOB1 read loop
(`engine/scene_eob.cpp:173-182`). Uncompressed, no header beyond a count:

| Offset | Size | Field |
|--------|------|-------|
| 0x00 | 2 | `count` (u16 LE) — `2916` for every EOB1 wall set |
| 0x02 | `count*2` | `entries[count]`, u16 LE each |

**Verified:** `2 + 2916*2 = 5834` matches the file size exactly for every
wall set's `.VMP`. Each entry's low 14 bits are a VCN tile index (bit 14 =
horizontal flip, bit 15 = floor/ceiling-overlay flag, per
`engine/scene_rpg.cpp:389-413`) — masked values stay within
`[0, numTiles-1]` with zero exceptions (see VCN section above). Not yet
turned into a rendered viewport image (that requires combining VMP + VCN +
the 22×15 layer layout) — logged as an open item, low priority since the
per-tile texture atlas is already extracted.

---

## MAZ — Dungeon level grid

**Confirmed.** Port of `EoBCoreEngine::loadBlockProperties`
(`engines/kyra/engine/scene_eob.cpp:368-381`) — raw file, no LCW. 6-byte
header + flat 1024×4-byte cell array, no trailing data (unlike this
project's earlier Amiga-doc guess of "door state sequences" etc. appended
after the grid — DOS's `LEVEL1.MAZ` is `4102` bytes total, and
`6 + 1024*4 = 4102` accounts for every byte with zero residue, so DOS MAZ
carries no additional trailing structure).

| Offset | Size | Field |
|--------|------|-------|
| 0x00 | 2 | width (u16 LE) — `32` in every level |
| 0x02 | 2 | height (u16 LE) — `32` |
| 0x04 | 2 | tile-size flag (u16 LE) — `4` |
| 0x06 | 4096 | 1024 cells × 4 wall bytes (N, E, S, W order, per `walls[4]`) |

**Verified:** header decodes to exactly `(32, 32, 4)` for `LEVEL1.MAZ`
(spot-checked); `6 + width*height*4` equals the file's actual size exactly
for all 12 `LEVELn.MAZ` files (extractor raises on any mismatch — none
raised). Cell content for LEVEL1's border cells shows the expected
alternating `01 01 02 02` / `02 02 01 01` pattern consistent with a
perimeter-wall ring. Wall-type-byte semantics (what `1` vs `2` render as)
not decoded — that requires cross-referencing the level's `.DAT`
wall-parameter table, an open item.

All 12 `LEVELn.MAZ` extracted to `public/assets/eotb/dosvga/data/levelN_maz.json`.

---

## INF — Level configuration (open)

**Not decoded this session.** Structurally located and loaded (`readLevelFileData`,
`engines/kyra/engine/scene_eob.cpp:34-152`), but its record layout
(monster spawns, decoration commands `0xEC`/`0xFB`, event-script bytecode)
was not traced field-by-field — deprioritized in favour of breadth across
all 3 games. The Amiga doc's INF description likely transfers with
different offsets (the DOS loader path in `initLevelData`,
`scene_eob.cpp:154-309`, shows byte-for-byte structure but wasn't ported to
a decoder here). See TODO.

---

## ITEM.DAT / ITEMTYPE.DAT (open — endianness-flipped hypothesis)

Same size as the already-verified Amiga tables (9,601 / 914 bytes). A
byte-diff against `data/eotb/amiga/ITEM.DAT` shows the two are related but
not identical — several diffs are exact adjacent-byte swaps (e.g. DOS bytes
`[0xC0, 0x01]` where Amiga has `[0x01, 0xC0]`), consistent with the same u16
fields stored little-endian (DOS) vs. big-endian (Amiga). A full
byte-swap-and-diff pass (attempting several record-stride hypotheses: 8,
10, 12, 15, 16, 20, 24, 25, 30 bytes) did not land on one that divides
`9601` evenly (`9601` doesn't factor into any of the Amiga doc's candidate
15-byte-record layout either — the Amiga doc itself notes the file "ends
with a name string table" appended after a variable-length record region,
so a flat `size / stride` count isn't meaningful without first locating
that boundary). Left as **hypothesis**, not extracted as structured JSON
this session — the raw bytes are in `public/assets/eotb/dosvga/data/pak_directory.json`'s
listing (offset/size only, not content) for a follow-up pass to pull from
`EOBDATA6.PAK` directly.

---

## Not extracted this session (open items)

| Item | Why deferred | Where to pick up |
|------|---------------|-------------------|
| `EYE.PAK` contents | Doesn't parse as a Kyra PAK; not referenced by any shipped .EXE — likely CD-installer artifact, not game data | Confirm via `strings`/entropy whether it's a self-extracting archive; if genuinely unused by the game, may not be worth pursuing |
| `.EGA` / `.ECN` / `.EMP` files (EGA render-mode graphics) | VGA/MCGA (`.CPS`/`.VCN`/`.VMP`) is the primary target; EGA is a secondary 16-colour render path for lower-end hardware | `Palette::loadEGAPalette` (`screen.cpp:4175-4185`) + a 4bpp-planar-or-packed pixel format guess would need the same treatment as `.CPS`/`.VCN` |
| `INF` level-config records | Structurally located, not field-decoded | `engine/scene_eob.cpp` `initLevelData`/`loadActiveMonsterData`/`loadDecorations` |
| `ITEM.DAT` / `ITEMTYPE.DAT` field layout | Same size as Amiga, byte-swap hypothesis only, record stride not resolved | `engines/kyra/engine/items_eob.cpp` (not yet fetched) |
| `ADLIB.DAT` / `PCSOUND.DAT` / `SOUND.DAT` | Audio, out of scope for palette/sprite/container breadth pass | `engines/kyra/sound/` |
| VMP-driven full-viewport render (VMP+VCN combined 22×15 scene) | Per-tile atlas already extracted; full composite is a nice-to-have | `engine/scene_rpg.cpp` `generateBlockDrawingBuffer` |

---

## Files

- **Library:** `scripts/kyralib/{pak,format80,palette,vcn,maze}.py` (shared
  across all 3 Kyra-engine games this session — see `docs/eotb2/dosvga/`
  and `docs/landsoflore/dosvga/` for how EOB2/LOL reuse or diverge from
  these modules)
- **Extractor:** `scripts/extract_eotb_dosvga.py`
- **Assets:** `public/assets/eotb/dosvga/{palettes,screens,textures,data}/`
  — 14 palettes, 67 CPS/CMP screens, 5 VCN wall texture atlases, 12 MAZ
  level grids, 1 PAK directory listing

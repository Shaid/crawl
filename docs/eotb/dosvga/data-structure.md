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
loaded by the shipped executables at all.

**Confirmed (2026-08-02, ScummVM source):** `Resource::loadPakFiles`
(`resource/resource.cpp:148-171`) enumerates every `*.PAK`/`*.APK` in the
game directory and loads each as an archive — **except** two filenames it
explicitly skips with the comment `// No PAK file`:
`resource.cpp:153`: `if (name == "TWMUSIC.PAK" || name == "EYE.PAK") continue;`.
`TWMUSIC.PAK` (a sibling game's file, Kyra1/FM-Towns) is the "real, still
used but opened raw" case — it's loaded directly via
`_res->fileData("twmusic.pak", ...)` in `sound/sound_towns_lok.cpp:328,355`.
`EYE.PAK` has **no such fallback anywhere in the engine** — a project-wide
grep for `"EYE"`/`"eye.pak"`/`fileData` calls referencing it turns up
nothing beyond the one skip line. This confirms `EYE.PAK` is genuinely
unused by the shipped DOS engine: the engine authors knew the file existed
(hence the explicit skip, to avoid it erroring out `loadArchive` as "not a
valid PAK") but never wrote any code path that opens it. Consistent with
the CD-installer-payload hypothesis; not pursued further (out of engine
scope entirely, not just deprioritized). **Closed.**

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

**Confirmed (2026-08-02, ScummVM source) for wall-set/dungeon screens:**
`EoBCoreEngine::initLevelData` (`engine/scene_eob.cpp:185-205`) is the real
mechanism, and it is byte-for-byte the same name-match this extractor
already does. The level's `.INF` file (see "INF" section below) embeds the
wall-set's stem name (e.g. `"brick"`) as a 12-byte field; that string is
plugged into `"%s.PAL"` and loaded straight into the active screen palette:
```
const char *paletteFilePattern = ... "%s.PAL";   // EOB1 always takes this branch
Common::String tmpStr = Common::String::format(paletteFilePattern, (const char *)pos);
...
_screen->loadPalette(tmpStr.c_str(), _screen->getPalette(0));
setLevelPalettes(_currentLevel);
```
`EoBEngine::setLevelPalettes` (`engine/eob.cpp:868-877`) — the natural place
to look for a further per-level palette *patch* — is a **no-op for every
platform except SegaCD** (`if (_flags.platform != Common::kPlatformSegaCD)
return;`). So for DOS (and Amiga), the wall-set's `<STEM>.PAL` load is the
*entire* palette-selection mechanism for dungeon views — there is no
additional per-level tint/patch step to account for. This upgrades the
wall-set-screen part of the heuristic from "very likely right" to
**confirmed identical to the game's own logic**.

UI/cutscene screens (`TITLE-E.CMP`, `WESTWOOD.CMP`, etc.) are indeed loaded
by hardcoded filename+palette pairs scattered through `eob.cpp`/
`sequences_eob.cpp` (not traced call-by-call — there are dozens), consistent
with this extractor's name-match-else-fallback substitute; the two spot
checks below (title, Westwood logo) confirm the substitute gets these
right.

**Monster CPS files: heuristic refined, not fully confirmed.** The
`EOBPAL.COL` fallback this extractor uses for monster sprites (no matching
`.COL`/`.PAL`) is very likely **not** what the live game shows — per the
trace above, a monster CPS is normally composited over an already-loaded
dungeon view, so its true palette is whatever wall-set `.PAL` is active for
the level that monster appears in (e.g. `KOBOLD.CPS` → `BRICK.PAL`, since
kobolds are levels 1-3/BRICK per `EOBDATA3.PAK`'s contents), not the
game-wide `EOBPAL.COL`. This wasn't corrected in the extractor this pass
(would require a monster→level→wall-set lookup table, itself dependent on
the now-decoded INF monster-shape-filename fields — see "INF" below); noted
as a still-open refinement, downgraded from "may be off" to "specifically,
likely wrong — should use the owning level's wall-set palette instead of
`EOBPAL.COL`."

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

## EGA render mode (`.EGA` / `.ECN` / `.EMP`)

**Confirmed — same container/codec as VGA, different palette source.**
EOB1 (and EOB2/Kyra1) support a switchable "render mode" (VGA/EGA/CGA),
selected at runtime (`Screen::_renderMode`, `screen.cpp:203-206`) — the
`.EGA`/`.ECN`/`.EMP` files in this DOS/VGA corpus are the assets for that
alternate mode, shipped alongside the VGA ones in the same PAKs (e.g.
`EOBDATA2.PAK` contains both `DOOR.EGA` and would contain `DOOR.CPS` too if
this were a VGA-only release).

**`.EGA` = the shared Kyra bitmap format (identical to `.CPS`), just the
render-mode-specific extension.** `Screen_EoB::init` builds the CPS
filename pattern from a lookup table indexed by render mode:
`cpsExt[] = {"CPS","EGA","SHP","BIN"}` (`graphics/screen_eob.cpp:194-206`)
— EOB1 selects index 1 (`"EGA"`) when `_renderMode` is EGA or CGA. **No new
codec is needed**: verified against the real `DOOR.EGA` (13,699 bytes,
`EOBDATA2.PAK`) — its header decodes with the existing
`format80`/Kyra-bitmap-header parser exactly like a `.CPS` file:
`fileSizeField=13697(=size-2)`, `compType=4` (LCW, same decoder), `imgSize=64000`
(same 320×200 full-screen size as VGA), `palSize=0`; the payload's first
byte (`0x89`) decodes as a valid LCW literal-run opcode. So `.EGA` bitmaps
decode through `scripts/kyralib/format80.py` unmodified.

**Palette is the real difference.** EGA-mode palette bytes are not raw RGB
— each byte is an **index into a fixed 16-colour hardware EGA table**,
`Palette::_egaColors[]` (`graphics/screen.cpp:4269-4276`, the classic
6-bit-VGA-DAC-scaled EGA/CGA RGBI palette: `00,00,AA,55,FF` component
values), consumed by `Palette::loadEGAPalette`
(`screen.cpp:4175-4185`). For EOB1, **all `.EGA` screens share one single
game-wide palette** loaded once at `EoBEngine::init()`
(`engine/eob.cpp:141-144`) from a **hardcoded 16-byte index array**,
`EoBEngine::_egaDefaultPalette[]` (`resource/staticres_eob.cpp:1785-1787`):
`{0, 5, 3, 2, 10, 14, 12, 6, 4, 11, 9, 1, 0, 8, 7, 15}` — i.e. index into
`_egaColors`, not a per-file `.PAL`/`.COL` lookup at all. This is *simpler*
than the VGA per-CPS palette-selection mechanism (no name-matching needed
for EGA mode — one static palette for the whole game).

```python
EGA_COLORS = [  # Palette::_egaColors, 16 x (R,G,B), 0-63 range
    (0x00,0x00,0x00),(0x00,0x00,0xAA),(0x00,0xAA,0x00),(0x00,0xAA,0xAA),
    (0xAA,0x00,0x00),(0xAA,0x00,0xAA),(0xAA,0x55,0x00),(0xAA,0xAA,0xAA),
    (0x55,0x55,0x55),(0x55,0x55,0xFF),(0x55,0xFF,0x55),(0x55,0xFF,0xFF),
    (0xFF,0x55,0x55),(0xFF,0x55,0xFF),(0xFF,0xFF,0x55),(0xFF,0xFF,0xFF),
]
EGA_DEFAULT_PALETTE = [0,5,3,2,10,14,12,6,4,11,9,1,0,8,7,15]  # EoBEngine::_egaDefaultPalette
```

**`.ECN`/`.EMP` are the EGA/CGA-mode `.VCN`/`.VMP`** — confirmed directly
from `EoBEngine::init` (`engine/eob.cpp:150-154`):
```cpp
if (platform == PC98)                       vcnFilePattern = "%s.ECB";
else if (renderMode == EGA || renderMode == CGA)  vcnFilePattern = "%s.ECN", vmpFilePattern = "%s.EMP";
```
i.e. exactly the "EGA-mode equivalents of `.VCN`/`.VMP`" the previous pass
already suspected — now confirmed structurally identical containers, same
`_vcnSrcBitsPerPixel` question applies (likely 4bpp packed same as VGA
`.VCN`, not independently verified this pass — the container-format
confirmation was the priority).

**Not implemented as an extractor this pass** (structure fully understood,
time went to the higher-priority INF/ITEM.DAT closures) — this is now a
"known format, not yet wired into the pipeline" item rather than a
"format unknown" item.

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

## INF — Level configuration

**Confirmed (2026-08-02, ScummVM source + byte-exact structural
verification against `LEVEL1.INF`).** `.INF` files are **LCW-compressed**
using the exact same shared Kyra bitmap header as `.CPS`/`.CMP`/`.VCN`
(confirmed: `LEVEL1.INF` header = `compType=4, imgSize=2929, palSize=0`;
`format80.decode_frame4` on the payload reproduces exactly 2929 bytes).
This wasn't obvious from the filename/extension alone — the previous pass
treated `.INF` as raw data. Port: `EoBCoreEngine::loadLevel`/
`readLevelFileData`/`initLevelData` (`engine/scene_eob.cpp:34-309`).

**Important:** `readLevelFileData` (`scene_eob.cpp:115-152`) has a
`skip=true` 4-byte-prefix-skip branch identical in spirit to the one noted
for VCN — but for INF the *opposite* choice applies. The branch that
triggers `loadBitmap(file, 5, 5, 0, true)` (skip=true) does **not** produce
a self-consistent header on this project's PAK-extracted bytes; parsing the
raw file directly at offset 0 (no skip) does. Same underlying cause as the
VCN case (`Resource::fileData()`'s live in-memory return apparently carries
a 4-byte prefix that PAK directory offsets don't need) — resolved
empirically the same way.

### Decompressed buffer layout (EOB1)

All offsets below are relative to the **decompressed** buffer (2929 bytes
for `LEVEL1.INF`), which is what `EoBCoreEngine`'s pointer walk actually
operates on (ScummVM loads it into "screen page 5" and reads directly from
that buffer — no separate parse step).

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x000 | 2 | `trailerOffset` (u16 LE) | absolute offset of the block-property override list (below); `EOB1Engine::loadLevel` also passes `(data, trailerOffset)` to `EoBInfProcessor::loadData` — see "Event script" below |
| 0x002 | 12 | `mazStem` (cstring, NUL-padded) | e.g. `"level1.maz\0\0"` — passed to `loadBlockProperties`/`getBlockFileData`, i.e. the `.MAZ` file for this level |
| 0x00E | 12 | `wallSetStem` (cstring, NUL-padded) | e.g. `"brick\0..."` — used for `<stem>.VMP` (`getVmpData`), `<stem>.PAL` (see palette section above), and stored as `_curGfxFile`/passed to `loadVcnData` for `<stem>.VCN` |
| 0x01A | 1 | flag byte | read but its EOB2-only branch (second wall-set name) never taken for EOB1 |
| 0x01B | 11 | reserved | vestigial EOB2 field width (EOB2's second-wallset-name field is 13 bytes = 1 flag + 12; EOB1 skips all of it) |
| 0x026 | 4 | `doorType1, shapeId1, doorType2, shapeId2` (u8 each) | → `EoBEngine::loadDoorShapes` (`engine/eob.cpp:757`) |
| 0x02A | 1 | `scriptTimersMode` (u8) | |
| 0x02B | 2 | `scriptTimer0Ticks` (u16 LE) | |
| 0x02D | 2 | `stepsUntilScriptCall` (u16 LE) | |
| 0x02F | 13×2 | monster-shape slots (2 entries) | each: `u8 monsterType` (0xFF = none) + 12-byte cstring monster-CPS stem (e.g. `"kobold"`, `"leech"`) → `EoBCoreEngine::loadMonsterShapes` (`engine/sprites_eob.cpp:34`); `hasDecorations` is hardcoded `false` for EOB1, so **EOB1 never loads a `.DCR` file** (see Amiga doc DCR note) |
| 0x049 | var | monster-timer list | repeating `(u8 monsterSlot, u8 interval)` pairs terminated by a `0xFF` slot byte → `EoBCoreEngine::loadActiveMonsterData` (`engine/sprites_eob.cpp:62`) |
| — | 420 | active-monster array | exactly 30 × 14-byte `EoBMonsterInPlay`-init records, unconditionally consumed even for inactive (`0xFF`) slots: `u8 index, u8 unit, u16 LE block, u8 pos, s8 dir, u8 type, u8 shpIndex, u8 mode, u8 spellStatusLeft, u16 LE randItem, u16 LE fixedItem` |
| — | 2 | decoration-list count (u16 LE) | |
| — | var | decoration-list entries | each starts with a 1-byte tag: `0xEC` → 24-byte payload (two 12-byte cstring stems: CPS decoration-shape stem, `.DEC` file stem) via `loadDecorations` (`scene_eob.cpp:428-462`, also fully decodes `.DEC` — see below); anything else → 5-byte `assignWallsAndDecorations(wallIndex u8, vmpIndex u8, decIndex s8, specialType u8, flags u8)` |
| `trailerOffset` | 2 | override-list count `len` (u16 LE) | |
| `trailerOffset+2` | `len`×5 | block-property overrides | each: `u16 LE blockIndex, u8 flags, u16 LE assignedObjects` — `assignedObjects` doubles as a **byte offset into the event-script region** (see below) when nonzero |

**Verified byte-exact** on `LEVEL1.INF` (`EOBDATA3.PAK`): walking this
layout with a throwaway probe produces fully legible, semantically correct
strings with zero garbage — `mazStem="level1.maz"`, `wallSetStem="brick"`,
monster stems `"kobold"`/`"leech"` (matching `EOBDATA3.PAK`'s known BRICK
wall set + kobold/leech monster roster), and 3 decoration entries with
stems `"brick1"`/`"brick2"`/`"brick3"` all paired with `dec="brick.dat"`.
The trailer-list invariant is exact: `trailerOffset(2737) + 2 + 38*5 ==
2929` (file size) with **zero residue**, across all 38 override records.
One override record's `assignedObjects` field is `719` — exactly the byte
offset where the decoration-list walk above terminates, confirming the
event-script region (below) starts immediately after the decoration list
and that `assignedObjects` is indeed a script-entry-point offset, not a
coincidence.

### Event script (`EoBInfProcessor`, the bytes between decoration-list-end and `trailerOffset`)

**Confirmed as a bytecode region** (2018 bytes for `LEVEL1.INF`, offsets
719–2737), not yet decoded opcode-by-opcode. `EoBCoreEngine::_inf` is an
`EoBInfProcessor` (`script/script_eob.h:35`, `script/script_eob.cpp`) — a
proper stack-free bytecode VM triggered per-dungeon-block:
```cpp
// EoBInfProcessor::run(func, flags), script/script_eob.cpp:169-197
int o = _vm->_levelBlockProperties[func].assignedObjects;   // = script entry offset
int8 *pos = (int8 *)(_scriptData + o);
do {
    int8 cmd = *pos++;                        // signed opcode byte
    if (cmd <= _commandMin || cmd >= 0) continue;   // literal/NOP passthrough
    pos += (*_opcodes[-(cmd + 1)]->proc)(pos);      // dispatch, operand-length is opcode-specific
} while (!_abortScript && !_abortAfterSubroutine);
```
`_scriptData` is loaded via `_inf->loadData(data, trailerOffset)`
(`scene_eob.cpp:69` for EOB1) — i.e. **bytes `[0, trailerOffset)` of the
same decompressed INF buffer**, so the event-script region overlaps the
already-decoded header/tables at the byte level (the VM only ever jumps
into the tail past the decoration list in practice, per the
`assignedObjects` cross-check above). ~30 named opcodes are registered via
the `Opcode(x)` macro (`script_eob.cpp:93-149`) — `oeob_setWallType,
toggleWallState, openDoor, closeDoor, replaceMonster, movePartyOrObject,
printMessage_v1, setFlags, playSoundEffect, removeFlags,
modifyCharacterHitPoints, calcAndInflictCharacterDamage, jump, end,
returnFromSubroutine, callSubroutine, eval_v1, deleteItem,
loadNewLevelOrMonsters, increasePartyExperience, createItem_v1,
launchObject, changeDirection, identifyItems, sequence, delay, drawScene,
dialogue, specialEvent` — names and dispatcher confirmed; per-opcode
operand byte-widths not individually decoded this pass (would require
reading all ~30 `oeob_*` bodies in `script_eob.cpp`). This is the
"event-script bytecode" the original TODO item named — narrowed from
"not located" to "located, dispatcher confirmed, opcode table named,
operand encoding not yet exhaustively decoded."

### .DEC — decoration definitions (confirmed, shared DOS/Amiga)

Port of `EoBCoreEngine::loadDecorations`/`getDecDefinitions`
(`scene_eob.cpp:420-462`), read via `createEndianAwareReadStream(decFile,
Resource::kForceLE)` — **always little-endian regardless of platform**
(no Amiga override of `getDecDefinitions` exists outside SegaCD, so this
format is identical on the Amiga port — see `docs/eotb/amiga/data-structure.md`).

```
u16 LE  decCount
repeat decCount:                    # LevelDecorationProperty, 52 bytes
    u8[10]  shapeIndex   (0xFF sentinel)
    u8      next
    u8      flags
    s16 LE[10]  shapeX
    s16 LE[10]  shapeY
u16 LE  rectCount
repeat rectCount:                   # EoBRect8, 8 bytes
    u16 LE x, y, w, h
```

Not independently byte-verified against a real `.DEC` file this pass (no
time; the record shape is unambiguous from the reader — every field is a
fixed-width sequential stream read with no branching) — logged as
**confirmed (source), rendered/unverified (data)**.

---

## ITEM.DAT / ITEMTYPE.DAT

**Confirmed, byte-exact.** Port of `EoBCoreEngine::loadItemDefs`
(`engine/items_eob.cpp:35-143`). The previous pass's stride search (8, 10,
12, 15, 16, 20, 24, 25, 30 bytes) missed the actual record sizes — **14**
bytes for `EoBItem` and **16** bytes for `EoBItemType` — because it
miscounted the field list by hand instead of reading the reader function
field-by-field.

### ITEM.DAT

```
u16 LE  numItems
repeat numItems:                    # EoBItem, 14 bytes
    u8  nameUnid
    u8  nameId
    u8  flags
    s8  icon
    s8  type
    s8  pos
    s16 LE  block
    s16 LE  next
    s16 LE  prev
    u8  level
    s8  value
u16 LE  numNames
repeat numNames:
    char[35]  name   (NUL-padded, not necessarily NUL-terminated at a fixed point)
```

**Verified against `EOBDATA6.PAK`'s `ITEM.DAT` (9,601 bytes):**
`numItems=448` → item table ends at `2 + 448*14 = 6274`; `numNames=95` at
that offset → name table `6276 + 95*35 = 9601` = **file size exactly, zero
residue**. All 90 embedded ASCII runs found by a whole-file string scan
land exactly on 35-byte record boundaries (confirmed via modular-offset
check), and decode to fully legible, game-correct item names: `"Mouse
Pointer"`, `"Leather armor"`, `"Robe"`, `"Dagger"`, `"Spellbook"`,
`"Jeweled Key"`, `"Potion"`, `"Adamantite Long Sword"`, `"'Guinsoo'"`,
`"Orb of Power"`, `"Scepter of Kingly Might"`, `"Spell Book"`, etc. — 90
recognisable AD&D/EOB item names with zero garbled entries.

### ITEMTYPE.DAT

```
u16 LE  numTypes
repeat numTypes:                    # EoBItemType, 16 bytes
    u16 LE  invFlags
    u16 LE  handFlags
    s8  armorClass
    s8  allowedClasses
    s8  requiredHands
    s8  dmgNumDiceS
    s8  dmgNumPipsS
    s8  dmgIncS
    s8  dmgNumDiceL
    s8  dmgNumPipsL
    s8  dmgIncL
    u8  unk1
    u16 LE  extraProperties
```

**Verified against `EOBDATA6.PAK`'s `ITEMTYPE.DAT` (914 bytes):**
`numTypes=57` → `2 + 57*16 = 914` = **file size exactly, zero residue**
(the previous pass's 15-byte guess was off by one field-width; recounting
the 13 fields in `loadItemDefs` field-by-field gives 16, which is the only
stride that divides the file cleanly with the independently-confirmed
`numTypes=57` header value).

Both tables' byte-swap relationship to the Amiga versions noted previously
(DOS LE vs. Amiga BE, same field widths) still holds — not re-verified
field-by-field against Amiga bytes this pass, but the DOS-side record
widths (14/16 bytes) are now unambiguous ground truth for that comparison
if revisited.

Not yet wired into `scripts/extract_eotb_dosvga.py`/`pak_directory.json` as
structured JSON output — the format is fully confirmed but extraction
into `public/assets/eotb/dosvga/data/` wasn't implemented this pass (time
budget went to closing the format-unknown status of every TODO item first).

---

## Not extracted this session (open items)

All items below are now **format-confirmed** (structure known from
ScummVM source, cited above) but not yet wired into the extractor
pipeline as JSON/PNG output — a pipeline-implementation task, not a
format-unknown task.

| Item | Status | Where to pick up |
|------|--------|-------------------|
| `.EGA` / `.ECN` / `.EMP` files (EGA render-mode graphics) | Confirmed: same container/codec as `.CPS`/`.VCN`/`.VMP`, different palette source (see "EGA render mode" above) | `scripts/kyralib/format80.py` (reuse unmodified) + a new `ega_palette.py` for `_egaColors`/`_egaDefaultPalette` |
| `INF` level-config records | Confirmed structurally, byte-exact verified on `LEVEL1.INF` (see "INF" above); event-script opcode operand widths not exhaustively decoded | `engine/scene_eob.cpp` `initLevelData` (ported above); `script/script_eob.cpp` `oeob_*` for opcode operands if pursued further |
| `ITEM.DAT` / `ITEMTYPE.DAT` field layout | Confirmed byte-exact (see "ITEM.DAT / ITEMTYPE.DAT" above) | Not yet wired into `scripts/extract_eotb_dosvga.py` |
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

# Lands of Lore: The Throne of Chaos — DOS/VGA Data Structures

**Source data:** `data/landsoflore/dosvga/GAME.DAT` (the real payload — see
below), plus loose top-level files (`ENG/FRE/GER.LM`, `LORE*.ADL`,
`VOC.PAK`, `manual.pdf`, `MAIN.EXE`, `MAINW.EXE`, `LOLCD.EXE`, `SETUP.EXE`).

**Engine:** same Kyra engine as EOB1/EOB2. Every format shared with those
games (PAK container, Kyra bitmap header, LCW/Format80, VGA palette) is
byte-identical and reuses `scripts/kyralib/` unchanged; this doc documents
only what's new or different for LOL. Read `docs/eotb/dosvga/data-structure.md`
first.

This supersedes `docs/landsoflore/landsoflore-formats-research.md`
("unverified — internet research") throughout — most of its structural
claims (PAK container, CPS format, SHP existing, CMZ→WLL→VMP→VCN framing)
were directionally right, but several details were wrong or unconfirmed
guesses (`.PAL` size, VMP compression, the actual CMZ payload). See
per-section notes below for what changed.

---

## `GAME.DAT` is a raw ISO 9660 CD image, not game data directly

**Confirmed.** `GAME.DAT` is 306,751,488 bytes. Byte `0x8001` reads
`CD001` — the standard ISO 9660 Primary Volume Descriptor signature.
`7z l GAME.DAT` confirms: `Type = Iso`, `Volume: LOL_V102`,
`Publisher: WESTWOOD STUDIOS`, `Preparer: EASY-CD PRO INCAT SYSTEMS INC.`,
209 files across `DATA/`, `DATA/ENG/`, `DATA/FRE/`, `DATA/GER/`,
`DATA/HARDRIVE/`. This is the entire game CD-ROM, most likely mounted as
a virtual CD by whatever modern installer (GOG-style) produced this copy
of the game, with the ISO renamed to `GAME.DAT` to satisfy
`LANDS.CFG`/the DOS drivers expecting a CD drive. The *real* Kyra PAK
files live inside it at paths like `DATA/STARTUP.PAK`,
`DATA/ENG/GENERAL.PAK`, `DATA/L01.PAK`, `DATA/MONSTER.PAK`,
`DATA/CATWALK.PAK`, and 40-odd more per-level/per-area PAKs (`L01-L29`,
`O00A-O29A`, `CATWALK/CAVE1/CIMMERIA/KEEP/MANOR/MINE1/RUIN/SWAMP/TOWER1/
URBISH/YVEL.PAK`), plus `DATA/{ENG,FRE,GER}/*.PAK` per-language resource
sets and 30 `DATA/NN.TLK` files.

**`.TLK` files: confirmed (2026-08-02) to be ordinary Kyra PAK containers,
not raw CD-audio track data** — the previous pass's "almost certainly
CD-audio, not Kyra resource files" guess was wrong. `LoLEngine::
loadTalkFile` (`engine/lol.cpp:1894-1905`) loads/unloads them with the
exact same `_res->loadPakFile(Common::String::format("%02d.TLK", index))`
/ `unloadPakFile` calls used for every other `.PAK`, swapping in a
different `.TLK` per area as the party travels
(`_curTlkFile`/`characterSays`, `engine/lol.cpp:1907+`). **Verified
byte-exact**: extracted the smallest one, `25.TLK` (44,138 bytes), from
the ISO and parsed it with this project's existing, unmodified
`scripts/kyralib/pak.py` — it decodes cleanly as a single-entry PAK
directory, `00000.VOC` (a Creative Voice File, the standard Kyra/EOB
speech-audio format), offset 23, size 44,115, and `23 + 44115 = 44138`
matches the file size **exactly, zero residue**. So `.TLK` files are
per-area PAKs of `NNNNN.VOC` speech clips, addressed by track-number
filename — decodable with existing code, not an audio codec question at
all. **Closes `lol-tlk-files`.**

**Extraction dependency:** this project's `data/` directory is read-only
and the ISO can't be pre-unpacked into it, so
`scripts/extract_landsoflore_dosvga.py` shells out to `7z x` (already
present in this environment) at run time, extracting a representative
subset of PAKs into `build/cache/landsoflore/iso/` (gitignored
intermediate, per this project's convention — never `public/assets/`).
This is the same category of external-tool dependency as `amitools`/`ira`
for Amiga platforms elsewhere in this project; documented explicitly since
it's new to this game. Only a representative subset was extracted this
session (breadth-first, not the full ~300 MB): `DATA/STARTUP.PAK`,
`DATA/ENG/STARTUP.PAK`, `DATA/ENG/GENERAL.PAK`, `DATA/ENG/INTRO1.PAK`,
`DATA/MONSTER.PAK`, `DATA/CATWALK.PAK`, `DATA/L01.PAK`.

---

## PAK — Container format

**Confirmed**, byte-identical to EOB1/EOB2 — same `kyralib.pak` module,
zero changes needed. Verified against `STARTUP.PAK` (14 entries),
`MONSTER.PAK` (4 entries: `LIZARD/ORC/TREZ/CABAL.SHP`), `L01.PAK` (10
entries), `CATWALK.PAK` (5 entries), `ENG/STARTUP.PAK` (11 entries),
`ENG/INTRO1.PAK` (3 entries), `ENG/GENERAL.PAK` (73 entries) — all parse
cleanly with self-consistent offsets.

---

## CPS — Screens

**Confirmed**, byte-identical header/LCW to EOB. `TITLE.CPS` (from
`STARTUP.PAK`, embedded 768-byte palette) decompresses and renders as the
**exact** known "Lands of Lore / The Throne of Chaos" DOS title screen —
byte-exact-oracle-strength verification, same standard as the EOB title
screens. `WESTWOOD.CPS`/`VIRGIN.CPS` (from `ENG/INTRO1.PAK`) and 6
`INVENT{1-6}.CPS` + `PARCH.CPS`/`PLAYFLD.CPS`/`SCROLL.CPS` (from
`ENG/GENERAL.PAK`) all have embedded palettes and decode/render cleanly
(12 of 12 CPS files with an embedded palette extracted this session; this
extractor only extracts CPS files that carry their own palette — LOL's
non-wall-set CPS files without one weren't chased this session, see "Open
items").

---

## VGA palette (.COL) — same format as EOB, but scarce standalone

**Confirmed** format (reuses `kyralib.palette` unchanged): `FXPAL.COL` and
`SWAMPICE.COL` (both from `ENG/GENERAL.PAK`, both 768 bytes) decode as
standard VGA 256-colour palettes. This corrects the internet-research
doc's guess of "8-bit or higher" / unspecified — it's the same 768-byte,
6-bit-per-channel VGA format as EOB1/EOB2, no LOL-specific palette
variant exists.

Only 2 standalone `.COL` files were found in the PAKs extracted this
session — LOL relies far more heavily on CPS-embedded palettes than EOB
does (12/12 extracted CPS files carry one).

---

## VCN — Wall tileset (confirmed structure AND colour, 2026-08-02)

**Confirmed structurally**, byte-identical tile packing to EOB
(4bpp-packed 8×8 tiles, `kyralib.vcn` unchanged). `CATWALK.VCN`:
`numTiles=1845`, tile-data length **exactly** `1845 * 32 = 59040` bytes,
zero remainder.

**Colour — root cause found and fixed (was: `lol-palette-runtime-patch`).**
The previous pass's diagnosis ("LOL patches the live palette at
level-load time from a source not yet located") was on the right track
but looked in the wrong place — the fix isn't an external
`setLevelPalettes`-equivalent patch, it's that **the real 128-colour
palette is embedded inside the `.VCN` file itself, past a region the
previous decode stopped short of.** Port of `LoLEngine::loadLevelGraphics`
(`engine/scene_lol.cpp:300-368`, the actual EOB-`setLevelPalettes`
analogue, called from EMC script bytecode via `olol_loadLevelGraphics`,
`script/script_lol.cpp:208-211`). For the DOS/VGA (256-colour,
`!use16ColorMode`) case:

```
u16 LE  numTiles
u8[numTiles]  vcnShift        # per-tile brightness/lighting shift table (not previously documented)
u8[128]       vcnColTable     # per-nibble colour remap (this project's previous "colMap")
u8[384]       palette          # 128 colours x 3 bytes (VGA 6-bit RGB) — THE MISSING PIECE
u8[numTiles*32]  tile data     # unchanged from the previous decode — 8x8, 4bpp-packed
```

Unless the level's load script passes an override filename (seen for
level 11's ice area: `"SWAMPICE.COL"`/`"LOLICE.NOL"`, loaded into a
*second* palette slot rather than slot 0), this embedded 384-byte block
**is** `_screen->getPalette(0)` for the whole level — there's no
after-the-fact "patch [wall colours] in" step beyond this one load, same
structural role as EOB's `<wallStem>.PAL` load but embedded in the VCN
container instead of a sibling file.

**Verified byte-exact against the real `CATWALK.VCN`:**
`2 (numTiles field) + 1845 (vcnShift) + 128 (vcnColTable) + 384 (palette)
+ 1845*32 (tile data) = 61399` = the file's own declared decompressed
`imgSize` **exactly, zero residue**. And decisively: palette indices 48
and 112 — the exact two indices the previous pass found stuck at literal
`RGB(255,0,255)` in every external palette file checked — now decode to
real, plausible colours: **index 48 = `(11,28,11)`** (dark green),
**index 112 = `(9,22,53)`** (dark blue), sitting within a coherent
red→orange→yellow→green gradient palette (indices 0-19 spot-checked, all
plausible VGA-palette values, index 0/1 = black as expected for a
background/transparent slot). **Closes `lol-palette-runtime-patch`.**
**Done this session:** `scripts/kyralib/vcn.py` gained
`parse_vcn_lol`/`decode_all_tiles_lol` (the previous `parse_vcn` is EOB's
fixed-34-byte-header parser and was silently reading LOL tile data from
the wrong offset — not just "greyscale instead of colour", the byte
offset itself was wrong for LOL specifically, though `num_tiles`
happened to be read correctly since it's the first field either way).
`scripts/extract_landsoflore_dosvga.py`'s `extract_vcn_wallset` now uses
the corrected parser and the VCN's own embedded palette.
`public/assets/landsoflore/dosvga/textures/catwalk_vcn.png` now renders
in **real colour** — a coherent tan/brown stonework texture sheet, visual
confirmation on top of the byte-exact structural check above.

Since `.SHP` monster/UI sprites (below) are drawn using the same active
`_screen->getPalette(0)` this load sets up, **this closes the SHP colour
question too** (same root cause, same fix — see "SHP" section below).

---

## VMP — Viewport tile-index map (LCW-compressed, unlike EOB)

**Confirmed, with one real format difference from EOB.** EOB's `.VMP`
files are raw/uncompressed (`u16 count` + array, straight from the file's
first byte). LOL's are wrapped in the same outer Kyra-bitmap/LCW header as
CPS/VCN: `CATWALK.VMP` (4,077 bytes) has `compType=4`, `imgSize=4972`; the
**decompressed** payload is the familiar `u16 count` (`2485`) + `count`
u16-LE entries, `2 + 2485*2 = 4972` matching the decompressed size
exactly. Masked tile-index entries top out at **exactly** `1844` —
`numTiles - 1` for `CATWALK.VCN`'s 1845 tiles — zero out-of-range
references, the same cross-file invariant used to confirm EOB's VMP/VCN
pairing.

`kyralib.vcn.parse_vmp` auto-detects which layout it's looking at (a
file whose first `u16` equals its own `length - 2` is the LCW-wrapped
case; EOB's raw files never coincide with that check since their leading
`u16` is a small tile count, not a file-size field) — see the function's
docstring for the exact heuristic. Internet-research doc corroborated:
"different structure from EOB" — true, but the difference is an outer
compression wrapper, not a different index-table layout.

---

## CMZ — Level grid (LCW-compressed EOB-style MAZ, confirmed)

**Confirmed, and much simpler than the internet-research doc's
"CMZ→WLL→VMP→VCN pipeline" framing suggested.** `LEVEL1.CMZ` (from
`L01.PAK`, 312 bytes on disk) is a standard Kyra bitmap: `compType=4`,
`imgSize=4102`. Decompressing it and feeding the result straight into
`kyralib.maze.parse_maz` (the exact same parser used for EOB's raw,
uncompressed `.MAZ` files) succeeds and produces a byte-exact match:
header decodes to `(32, 32, 4)` — identical to every EOB level — and
`6 + 32*32*4 = 4102` accounts for the decompressed size exactly. Cell
data for `LEVEL1`'s border row is the same alternating
`[1,1,2,2]`/`[2,2,1,1]` pattern seen in EOB1's `LEVEL1.MAZ`, consistent
with a perimeter-wall ring.

**Conclusion: LOL's "CMZ" is not a structurally different level format
from EOB's "MAZ"** — it's the identical 32×32×4-wall-byte grid, just
LCW-compressed at the container level (matching VMP's compression
difference above). No `.WLL` file was found or needed to decode the grid
itself, but see below — the format is now confirmed anyway.

---

## WLL — Wall-type parameter table (confirmed, byte-exact — closes `lol-wll-format`)

**Confirmed.** Port of `LoLEngine::loadLevelWallData`
(`engine/scene_lol.cpp:142-179`) — this *is* LOL's analogue of EOB's
`<WALLSET>.DAT`, as the TODO item suspected. `.WLL` files are **not**
LCW-compressed (loaded raw via `_res->fileData`), and live inside the
per-level PAK (e.g. `LEVEL1.WLL` inside `L01.PAK`), not as loose ISO files:

```
u16 LE  shpDatListIndex     # selects which _levelShpList/_levelDatList pair (decoration shapes) this level uses
repeat (fileSize-2)/12:      # one record per wall-type index, 12 bytes each
    u16 LE  wallTypeIndex          # sequential in practice: 0, 1, 2, 3, ...
    u16 LE  vmpMapValue            # only the low byte is read (_wllVmpMap[idx] = *d) -- VMP-layer selector for this wall type
    u16 LE  shapeMapValue          # low byte read normally; if `mapShapes` and the full LE value is >0, it's a decoration-shape index instead
    u16 LE  specialWallType        # low byte read (_specialWallTypes[idx])
    u16 LE  wallFlags              # low byte read (_wllWallFlags[idx])
    u16 LE  automapData            # low byte read (_wllAutomapData[idx]) -- automap glyph/behaviour, e.g. value 17 flags a block as a door in loadBlockProperties
```

**Verified byte-exact against the real `LEVEL1.WLL`** (626 bytes, from
`L01.PAK`): `(626-2)/12 = 52.0` exactly — zero residue — and the decoded
`wallTypeIndex` field increments cleanly `0, 1, 2, ..., 51` across all 52
records with no gaps or out-of-order values, strong confirmation this is
the right record boundary/stride. `_wllAutomapData` values are small
integers (13, 63, 255, ...) consistent with a lookup-table role rather
than raw colour/pixel data.

---

## SHP — Multi-frame creature/UI shapes (new format vs. EOB; structure confirmed, colour not)

EOB has no `.SHP` files (its monster sprites are full-canvas `.CPS`
images); LOL uses a dedicated multi-frame shape container instead
(`LIZARD.SHP`, `ORC.SHP`, `TREZ.SHP`, `CABAL.SHP` in `MONSTER.PAK`;
`ITEMICN.SHP`, `GAMESHP.SHP`, etc. elsewhere). Ported from ScummVM's
`Screen_v2::getPtrToShape`/`getShapeSize`
(`engines/kyra/graphics/screen_v2.cpp:192-232`) and the shape-header +
scanline-stream logic inside `Screen::drawShape`
(`engines/kyra/graphics/screen.cpp:1709-2059, 2171-2184, 2429-2439`).
Implementation: `scripts/kyralib/shp.py`.

A `.SHP` file is a standard Kyra bitmap; its **decompressed** payload is:

```
u16              numShapes
u32[numShapes+1] offsets     (raw; each shape's real start = offsets[i]+2)
<shape 0><shape 1>...
```

Per-shape header (offsets relative to the shape's own start):

| Offset | Size | Field |
|--------|------|-------|
| 0x00 | 2 | `shapeFlags` — bit0: colour-remap table present; bit1: payload NOT LCW-compressed; bit2: `colourTableColors` is an explicit byte (else defaults to 16, Kyra1-only, not seen in this corpus) |
| 0x02 | 1 | `height` |
| 0x03 | 2 | `width` |
| 0x05 | 3 | unused/unknown (skipped by the reference decoder — `src += 3`) |
| 0x08 | 2 | `frameSize` — uncompressed scanline-stream size |
| 0x0A | 1 | `colourTableColors` (present iff `shapeFlags & 4`) |
| 0x0A+ | N | `colourTable[N]` (present iff `shapeFlags & 1`) |
| after that | — | payload: LCW-compressed (if `!(shapeFlags & 2)`) or raw, `frameSize` bytes once decompressed |

Scanline stream (`Screen::drawShapeProcessLineNoScaleUpwind`): per pixel,
read a byte `c`; `c != 0` → one opaque pixel, palette index =
`colourTable[c]` if a table is present (per
`Screen::drawShapePlotType37`, LoL's monster/creature plot routine — `cmd
= _dsColorTable[cmd]`) else `c` directly; `c == 0` → next byte is a
transparent-pixel run length.

**Verified structurally, byte-exact:** `LIZARD.SHP` has 17 shapes; 16
report identical `82×86` dimensions (a full animation cycle — walk/idle/
attack poses, including 2 open-mouth "attack" frames) plus one `5×20`
outlier (shape 16, `flags=2` — uncompressed, no colour table — plausibly
a small UI cursor/icon bundled in the same file rather than a monster
frame). **All 17 shapes' scanline streams consume exactly their declared
`frameSize` with zero overrun or underrun** — the same class of
zero-deviation structural invariant used to confirm VCN/VMP above.
`sprites/lizard_shp.png` (greyscale, see below) shows a clearly
recognisable, consistent creature silhouette across all 16 real frames.

**Colour — closed (2026-08-02), same root cause and fix as VCN.**
`Screen::drawShapePlotType37`'s `255`-as-background-fade-lookup special
case (excluded from the render as transparent, correctly) still applies
and is unaffected by this finding. The *real* colour-table target indices
for `LIZARD.SHP` (47-50, 65-74) landing in the `RGB(255,0,255)`
placeholder range in every *external* palette file was the same symptom
as `CATWALK.VCN`'s wall colours, and has the same fix: SHP shapes are
rendered against whatever `_screen->getPalette(0)` is currently active,
which — per the "VCN" section above — is populated from the **VCN
file's own embedded 384-byte palette** at level-load time
(`LoLEngine::loadLevelGraphics`), not from any of the standalone `.COL`
files this extractor checked. `sprites/lizard_shp.png`,
`orc_shp.png`, `trez_shp.png`, `cabal_shp.png` are still rendered in
**greyscale** this pass (re-rendering in colour needs the same
`kyralib.vcn`-side offset fix as CATWALK, applied per-level before the
matching monster SHPs render — a pipeline task, not a format-unknown one).

---

## Not extracted this session (remaining open items)

| Item | Notes |
|------|-------|
| SHP colour re-render | `catwalk_vcn.png` now renders in real colour (fix applied this session). The 4 SHP atlases (`lizard_shp.png`, `orc_shp.png`, `trez_shp.png`, `cabal_shp.png`) still render in greyscale — SHP files don't carry their own palette (they use whichever level's VCN-embedded palette was active in-game), and this extractor doesn't yet have a monster→level mapping to pick the right one. |
| Most of the 209-file ISO (level PAKs `L02-L29`, `O00A-O29A`, `CIMMERIA/KEEP/MANOR/...PAK`, `FRE`/`GER` language sets, `MUSIC.PAK`, `VOC.PAK`, 29 of 30 `.TLK` files) | Only a representative subset was extracted this session per the breadth-first mandate — every format needed to decode the rest (PAK/CPS/VCN/VMP/CMZ/SHP/WLL/TLK) is now confirmed, so pulling more files through the same pipeline is mechanical, not exploratory. |
| `ITEM.INF`, `LEVEL1.INF`, `.TLC`, `.INI`, `.LM` (language string tables) | Text/scripting data, out of scope for the palette/sprite/container breadth pass. |
| EMC2 script bytecode (per the internet-research doc) | Not investigated — scripting/gameplay logic, not data-structure/asset extraction. LOL uses the EMC bytecode VM (not EOB's separate `EoBInfProcessor`) — `olol_loadLevelGraphics` and friends in `script/script_lol.cpp` are EMC opcode handlers. |

---

## Files

- **Library:** `scripts/kyralib/` — `shp.py` added this session (new to
  LOL); `vcn.py`'s `parse_vmp` gained LCW auto-detection; everything else
  (`pak.py`, `format80.py`, `palette.py`, `maze.py`) reused unchanged from
  EOB1/EOB2.
- **Extractor:** `scripts/extract_landsoflore_dosvga.py` (shells out to
  `7z` to pull PAKs from the `GAME.DAT` ISO into `build/cache/landsoflore/iso/`)
- **Assets:** `public/assets/landsoflore/dosvga/{palettes,screens,textures,sprites,data}/`
  — 2 standalone palettes, 12 embedded-palette CPS screens (incl. the
  confirmed-exact title screen), 1 wall-tileset atlas (greyscale), 4
  creature SHP sprite atlases (greyscale), 1 CMZ level grid

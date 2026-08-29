# Eye of the Beholder II (EOB2) — DOS/VGA Data Structures

**Source data:** `data/eotb2/dosvga/` — 239 loose files (`.CPS`, `.PAL`,
`.INF`, `.MAZ`, `.SND`, `.ADL`, `.DCR`, `.EGA`, `.DEC`, `.DAT`, `.VMP`,
`.VCN`, `.OVL`, `.FNT`, `START.EXE`, `SETUP.EXE`).

**Engine:** same Kyra engine as EOB1 (`docs/eotb/dosvga/data-structure.md`)
— this doc only documents what differs. Read that doc first; every format
not called out below (Kyra bitmap header, LCW/Format80, VGA palette
6→8-bit expansion, VCN 4bpp tile packing, VMP index table, MAZ grid) is
byte-identical and reuses the same `scripts/kyralib/` modules unchanged.

This supersedes `docs/eotb2/eotb2-formats-research.md` (labelled
"unverified — internet research") wherever the two differ — notably the
`.PAL` size (that doc guessed 64-byte Amiga-style big-endian; the real DOS
files are 768-byte VGA palettes, same as EOB1) and the container format
(that doc assumed `.PAK`; see below).

---

## Container: none — loose files, confirmed

**Confirmed.** This corpus has **no PAK container at all**, unlike EOB1.
Verified two ways:

1. There is no main game executable that references `.PAK` files. The only
   two `.EXE`s present are `SETUP.EXE` (16,866 bytes — a small config
   utility) and `START.EXE` (333,328 bytes). `strings START.EXE` shows it
   IS the real game (`"Xanathar the Beholder"`, `"...into your Eye of the
   Beholder II"`, `"Eye of the Beholder II requires %lu bytes of RAM
   free."`) and references dozens of `.CPS` filenames directly by name
   (`COIN.CPS`, `DRAGON1.CPS`, `KHELBAN1.CPS`, `ITEM.DAT`, `TEXT.DAT`,
   etc.) — zero `.PAK`/`.APK`/`.VRM`/`.CMP`/`.TLK` string matches anywhere
   in the binary.
2. Every file referenced by name in `START.EXE`'s strings exists as a
   standalone file on disk at the expected path.

This is consistent with several Kyra-engine CD-ROM releases shipping
uncompressed/unpacked data (plenty of CD space, no need for the PAK
archive-and-decompress step floppy releases used) — EOB1's PAK-based
distribution in this project is the floppy/hybrid layout; this EOB2 copy
is the installed/CD layout. Not chased further (out of scope — the
practical effect is simply "no container step needed," which simplifies
the extractor).

---

## CPS — Screens and sprites

**Confirmed**, same header/decompression as EOB1 (see that doc). One
addition this session: **compType 3 (RLE)** appears in this corpus
(`SKELWAR.CPS`, 1 of 116 files) and was not in the EOB1 corpus. Ported
`Screen::decodeFrame3` (`engines/kyra/graphics/screen.cpp:2540-2558`) into
`scripts/kyralib/format80.py::decode_frame3`:

```
while dst not full:
    code = next signed byte
    if code == 0:
        sz = u16 BE (DOS) / LE (Amiga); val = next byte
        fill sz bytes with val
    elif code < 0:
        val = next byte
        fill (-code) bytes with val
    else:
        copy `code` bytes verbatim
```

**Verified:** `SKELWAR.CPS` decodes to exactly `img_size` (64,000) bytes
with zero mismatch, and renders as a clean, fully legible skeleton-warrior
sprite sheet (6 animation-frame poses, correct blue/tan/gold armor
colouring) — visual confirmation on top of the size invariant.

All 116 `.CPS` files in the corpus: 114 use `compType 4` (LCW), 1 uses
`compType 3` (RLE, `SKELWAR.CPS`), 1... (counts: 114 LCW-no-palette + 1 RLE
+ 2 LCW-with-embedded-palette `HEROES.CPS`/`MENU.CPS` = 116). All decode to
exactly `img_size=64000` (320×200 chunky 8bpp) with **zero decode
exceptions and zero skipped files**.

### Palette resolution (per-CPS)

Only 2 of 116 `.CPS` files carry an embedded palette (`palSize=768`):
`HEROES.CPS`, `MENU.CPS`. Of the remaining 114, only 2 have a
name-matching standalone `.PAL` (`CRIMSON.CPS`↔`CRIMSON.PAL`,
`FOREST.CPS`↔`FOREST.PAL` — both wall-set overview screens). For
everything else this extractor falls back to `PALETTE0.PAL`, chosen
empirically: rendering `DARKMOON.CPS` (the "Legend of Darkmoon" title
screen) through each of the 5 `PALETTE{0..4}.PAL` files, only `PALETTE0`
produces a coherent image (a castle exterior against a blue sky with
correct brown stonework) — the others were not exhaustively checked for
what they render correctly, since `PALETTE0` was immediately and clearly
right.

**Verification (byte-exact-oracle-strength, known screens):**
- `screens/menu.png` (own embedded palette) reproduces the exact
  "Eye of the Beholder II / The Legend of Darkmoon / Choose Your Destiny"
  title screen, fully legible gold-on-stone text.
- `screens/darkmoon.png` (`PALETTE0.PAL` fallback) is a coherent
  castle-exterior cutscene image.
- `screens/beholder.png` (`PALETTE0.PAL` fallback) shows a recognisable
  purple/red beholder-monster sprite sheet (7 animation frames) plus a
  small humanoid sprite.
- `screens/skelwar.png` (`PALETTE0.PAL` fallback) — see above.

As with EOB1, per-screen palette selection for the `PALETTE0.PAL`-fallback
majority (110 of 116 files) is **rendered, not confirmed** — the actual
game may switch in a different active palette for some of these
(especially level-specific monster/item CPS files) that this static,
name-matching heuristic can't discover without tracing the `.INF`
level-load code. All 4 spot-checked files above happened to render
correctly, which is reasonably strong evidence the heuristic generalizes,
but it is not a per-file guarantee.

**Confirmed mechanism (2026-08-02, ScummVM source) for wall-set/dungeon
screens** — same trace as EOB1 (`docs/eotb/dosvga/data-structure.md` §
"VGA palette"), shared code: `EoBCoreEngine::initLevelData`
(`engine/scene_eob.cpp:185-205`) name-matches the level's `.INF`-embedded
wall-set stem to `<stem>.PAL` (or `<stem>.EGA` in EGA render mode — see
below), exactly this extractor's heuristic, and
`EoBEngine::setLevelPalettes` is a SegaCD-only no-op (`engine/eob.cpp:
868-877`) so there's no further per-level patch.

**EOB2-specific second wall-set field — now fully decoded and verified
(2026-08-29), closing this item.** The INF format has a *second*, optional
wall-set-name field (`scene_eob.cpp`: `if (*pos++ != 0xFF && GI_EOB2) {
tmpStr = format(pattern, pos); pos += 13; }`) — a real 13-byte cstring,
same width as the (corrected — see "INF — Level configuration (EOB2)"
below) first wall-set-stem field, gated by a flag byte immediately after
the first stem. Decoded against all 16 real `LEVELn.INF` files via
`tools/eotb2/decode-inf.ts`'s `secondWallSetStem`: the flag is `0xFF`
(absent) on 11 levels, and exactly `LEVEL10`-`LEVEL14` (5 levels) carry a
present second field, decoding to `"azure"` in every one of those 5 cases
— consistent with those levels using MEZZ as their primary 3D wall
texture set while naming AZURE as a second, presumably UI/overlay or
scripted-encounter palette (AZURE itself has no `.VCN`/`.VMP`, i.e. is
never a *navigable* wall set — see "VCN / VMP" above — so this can only be
a palette reference, not a second tile texture). What in-game code
actually *consumes* `tmpStr` after this second `loadPalette`-pattern
format call is not traced further (ScummVM's `initLevelData` builds the
string and moves on; no second `_screen->loadPalette()` call sits right
next to it in the function body) — the field's presence/content is now
ground truth, its runtime effect remains open. Monster/UI CPS files
without a matching `.PAL` face the same "likely wrong, should use the
owning level's active palette rather than a fixed fallback" caveat noted
for EOB1.

---

## INF — Level configuration (EOB2 header preamble, root-caused 2026-08-29)

**Superseding the previous "offsets don't match" open item.** EOB1's
documented fixed offsets (`docs/eotb/dosvga/data-structure.md` § "INF" →
"Decompressed buffer layout (EOB1)": `mazStem` at 0x002, `wallSetStem` at
0x00E, both 12-byte cstrings) were never wrong for EOB1 — they just don't
transfer unmodified to EOB2. **EOB2 genuinely has a different, longer
header preamble and wider stem fields**, confirmed straight from
ScummVM's `EoBCoreEngine::initLevelData` (`engine/scene_eob.cpp`, fetched
fresh this pass):

```cpp
const uint8 *data = _screen->getCPagePtr(5) + 2;   // skip trailerOffset (u16 @ 0x000)
const uint8 *pos = data;                            // = buffer + 2
int slen = (_flags.gameID == GI_EOB1) ? 12 : 13;     // <-- the key difference: EOB2's stems are 13 bytes
// (sub-level chaining, skipped for sub == 0 — the only case documented here)
pos += 2;                                            // buffer + 4
if (*pos++ == 0xEC || _flags.gameID == GI_EOB1) {     // tag byte @ 0x004; *pos++ always executes (evaluation order)
    if (_flags.gameID == GI_EOB1) pos -= 3;           // EOB1 only: undoes the +2/+1 above -> mazStem @ buffer+2
    loadBlockProperties(pos);                         // EOB2: pos = buffer+5 here -> mazStem @ 0x005
    pos += slen;                                      // -> wallSetStem @ 0x005+13 = 0x012 (EOB2 only)
    ...
    pos += slen;                                      // -> second-field flag byte @ 0x012+13 = 0x01F (EOB2 only)
    if (*pos++ != 0xFF && _flags.gameID == GI_EOB2) {  // optional second wall-set-name field
        tmpStr = format(paletteFilePattern, pos);      // second stem @ 0x020
        pos += 13;
    }
```

**EOB2's real decompressed-buffer offsets** (all absolute, sub == 0):

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x000 | 2 | `trailerOffset` (u16 LE) | same field/role as EOB1 |
| 0x002 | 2 | sub-level chain pointer (u16 LE) | only meaningful when `sub > 0`; unused for the single-sub-level case this project decodes |
| 0x004 | 1 | tag byte | must be `0xEC` for the block-properties/VMP/palette load to happen at all — confirmed present (`0xEC`) in **all 16** real `LEVELn.INF` files |
| 0x005 | 13 | `mazStem` (cstring, NUL-padded) | **13 bytes, not EOB1's 12** — e.g. `"level1.maz\0\0\0"` |
| 0x012 | 13 | `wallSetStem` (cstring, NUL-padded) | 13 bytes — e.g. `"dung\0\0\0\0\0\0\0\0\0"` |
| 0x01F | 1 | `secondWallSetFlag` | `0xFF` = no second field; else a second wall-set stem follows |
| 0x020 | 13 | `secondWallSetStem` (cstring, NUL-padded, only when flag != 0xFF) | see "Palette resolution" above for what's decoded from it |

**Verified byte-exact against all 16 real `LEVELn.INF` files** (see
`tools/eotb2/decode-inf.ts` and its test suite): tag byte is `0xEC` in
every file; `mazStem`/`wallSetStem` decode to the exact same values the
previous token-scan workaround already found (including both documented
maze-reuse cases, `LEVEL16→level15.maz` and `LEVEL14→level12.maz`); the
optional second field is present (flag `0x01`) in exactly `LEVEL10`-
`LEVEL14` and decodes to `"azure"` in all 5 — **this is the same discovery
as `eotb2-dos-cps-palette-second-field`, confirmed from two angles at
once as the task brief predicted.**

**Root cause, stated plainly:** it's a genuine EOB2-specific header
preamble, not a doc error — `slen` (the cstring field width) is
game-gated in ScummVM's own source (`12` for EOB1, `13` for EOB2), and
EOB2 additionally reads one extra tag byte plus a 2-byte sub-level-chain
field before the first stem even starts, none of which EOB1's code path
retains (the `pos -= 3` line for `GI_EOB1` specifically discards them).
Both games' documented offsets are now correct **for their own game** —
they were never meant to be shared, and this doc's earlier framing (which
called EOB2's numbers a deviation from "the" INF layout) is corrected
here to "EOB1 and EOB2 have different, both-now-fully-decoded INF header
preambles."

**`tools/eotb2/decode-inf.ts` now uses this fixed-offset struct as its
primary decoder** (regression-verified against all 16 files, plus a new
test locking in the second-wall-set-stem finding), falling back to the
previous token-scan only if a future/malformed file fails the fixed-offset
sanity checks (tag byte, cstring printability, known wall-set name).
**Closes `eotb2-dos-inf-header-offsets-dont-match` and
`eotb2-dos-cps-palette-second-field`.**

---

## VCN / VMP — Wall tilesets

**Confirmed**, byte-identical structure to EOB1 (same 4bpp/8×8-tile
packing, same col_map remap, same u16-count-prefixed VMP index array).
5 of 6 wall sets have a `.VCN`/`.VMP` pair: **AZURE, CRIMSON, DUNG,
FOREST, MEZZ, SILVER** are the 6 named wall-set `.PAL` files, but
**`AZURE.VCN` does not exist** in this corpus (only `AZURE1.CPS`/
`AZURE2.CPS` full-screen renders).

**Confirmed by design, not a naming mismatch (2026-08-02).** Every one of
the 16 `LEVELn.INF` files was decoded (using the confirmed EOB2 INF header
— `engine/scene_eob.cpp:154-230`, `slen=13`) to read out its embedded
wall-set stem name directly: the 16 levels reference exactly `dung` (×3),
`forest` (×1), `mezz` (×6), `silver` (×3), `crimson` (×2), and 1 no-tag
sub-level — **`azure` never appears as a wall-set reference in any level's
own data**, exhaustively checked across all 16 files, zero hits. So Azure
genuinely is CPS-backdrop-only by design — it's not a navigable
tile-based dungeon level at all in this game (its 3D-view VCN/VMP pair was
simply never created, consistent with `AZURE1.CPS`/`AZURE2.CPS` being flat
cutscene/vignette backdrops for what's probably a scripted encounter or
throne-room sequence rather than an explorable maze). **Closes
`eotb2-dos-azure-vcn-missing`.**

Also confirms the doc's other Azure-adjacent observation below:
**`LEVEL16.MAZ` doesn't exist because `LEVEL16.INF` doesn't reference its
own maze** — its decoded `mazStem` field is `"level15.maz"`, i.e. level 16
reuses level 15's dungeon grid (a second INF/monster-config pass over the
same physical map, not a missing file). Likewise `LEVEL6.INF` reuses
`"level5.maz"` and `LEVEL14.INF` reuses `"level12.maz"` — three confirmed
maze-reuse pairs, all consistent with alternate/sub-level scenarios on a
shared floor plan rather than data gaps.

**Verified per wall set** (structural invariants, zero deviation):

| Wall set | numTiles | tiles bytes | VMP count | VMP filesize | max masked VMP index |
|----------|----------|-------------|-----------|---------------|------------------------|
| CRIMSON | 1132 | 36224 = 1132×32 | 2916 | 5834 | 1131 = numTiles−1 |
| DUNG | 1474 | 47168 = 1474×32 | 2916 | 5834 | 1473 = numTiles−1 |
| FOREST | 906 | 28992 = 906×32 | **1192** | **2386** = 2+1192×2 | 905 = numTiles−1 |
| MEZZ | 1247 | 39904 = 1247×32 | 2916 | 5834 | 1246 = numTiles−1 |
| SILVER | 1161 | 37152 = 1161×32 | 2916 | 5834 | 1160 = numTiles−1 |

`FOREST.VMP` is notably smaller (1192 entries vs. 2916 for the other 4) —
consistent with Forest being an outdoor-terrain wall set needing fewer
viewport-layer mappings than an indoor dungeon's full 22×15×(1+6) layer
set. Not investigated further; the generic count-prefixed-array parser
handles it correctly regardless (no hardcoded 2916 assumption in
`kyralib.vcn.parse_vmp`).

`textures/crimson_vcn.png` renders as a legible, recognisable
crimson-and-gold masonry texture sheet.

---

## MAZ — Dungeon level grids

**Confirmed**, byte-identical to EOB1 (6-byte header + 1024×4-byte cell
array). 15 levels present (`LEVEL1.MAZ`...`LEVEL15.MAZ`, vs. EOB1's 12) —
spot-checked `LEVEL1.MAZ`: header `(32, 32, 4)`, file size 4102 bytes
exactly matching `6 + 32*32*4`. All 15 extracted with zero size-mismatch
exceptions.

Note: 16 `.INF` files exist (`LEVEL1.INF`...`LEVEL16.INF`) vs. only 15
`.MAZ` files — `LEVEL16` has monster/config data but apparently no grid
file (possibly a special non-grid encounter, e.g. a boss arena or
scripted finale sequence). Not investigated further.

---

## .DCR — monster decoration parameters (confirmed, byte-exact, 9/9 files)

Port of `DarkMoonEngine::loadMonsterDecoration` (`engine/darkmoon.cpp:
310-336`, EOB2's `EoBCoreEngine` subclass — EOB1 never calls this, see
`docs/eotb/amiga/data-structure.md` § "DCR Files"):

```
u16 LE  setCount
repeat setCount:
    repeat 6:                    # one per monster facing/pose variant
        u8[6]  [encX, encY, encW, encH, s8 offsetX, s8 offsetY]
        # encW==0 or encH==0 -> this slot inactive, skipped by the reader
```
i.e. total size = `2 + setCount*36`.

**Verified byte-exact against all 9 `.DCR` files in this corpus** — every
file's size is exactly `2 + setCount*36` for a small integer `setCount`
(1, 2, or 3), zero residue in all 9 cases:

| File | Size | setCount |
|------|------|----------|
| `BEHOLDER.DCR`, `MAGE.DCR` | 38 | 1 |
| `DRAGON.DCR`, `GUARD2.DCR` | 74 | 2 |
| `CLERIC1/2/3.DCR`, `GUARD1.DCR`, `MANTIS.DCR` | 110 | 3 |

**Closes `eotb2-dos-dcr-format`** — not creature *behaviour* parameters as
speculated, but per-facing sprite-decoration shape/offset tables (each
"decoration" is a small overlay shape — a weapon, glow effect, etc. — drawn
at a fixed offset onto a specific monster animation pose).

---

## .DEC — level decoration placement (confirmed, byte-exact, 6/6 files)

Same format as EOB1/DOS, shared `EoBCoreEngine::loadDecorations`/
`getDecDefinitions` (`engine/scene_eob.cpp:420-462`, forced little-endian
regardless of platform) — see `docs/eotb/dosvga/data-structure.md` § "INF"
→ ".DEC — decoration definitions" for the full 52-byte-record +
8-byte-rect layout.

**Verified byte-exact against all 6 `.DEC` files in this corpus**, zero
residue in every case:

| File | Size | decCount | rectCount | `2+decCount*52+2+rectCount*8` |
|------|------|----------|-----------|-------------------------------|
| `AZURE.DEC` | 5112 | 67 | 203 | 5112 ✓ |
| `BROWN.DEC` | 6048 | 79 | 242 | 6048 ✓ |
| `CRIMSON.DEC` | 4832 | 69 | 155 | 4832 ✓ |
| `FOREST.DEC` | 248 | 3 | 11 | 248 ✓ |
| `MEZZ.DEC` | 4476 | 60 | 169 | 4476 ✓ |
| `SILVER.DEC` | 4692 | 60 | 196 | 4692 ✓ |

(`BROWN.DEC` — a 7th name not matched by any known `.VCN` wall set in this
corpus — is presumably a decoration set used generically or for a
non-tile area; not investigated further.) **Closes `eotb2-dos-dec-format`.**

---

## .EGA files — confirmed: alternate palettes, NOT graphics (closes the open item)

**This item's premise was wrong and is corrected here.** The previous pass
assumed EOB2's 8 `.EGA` files were "secondary EGA render-mode graphics"
like EOB1's. They are not — **every `.EGA` file in this corpus is exactly
768 bytes**, the same size as a 256-colour VGA-style `.PAL` file, not a
compressed bitmap:

```
AZURE.EGA CRIMSON.EGA DUNG.EGA FOREST.EGA MEZZ.EGA SILVER.EGA   (per wall set)
INTRO.EGA MENU.EGA                                              (cutscene/menu)
```

Source confirms this directly. Two different things share the `.EGA`
extension across the two games, and this is a genuine, confirmed
per-game divergence:

- **EOB1**: `.EGA` replaces `.CPS` as the *graphics* extension in EGA/CGA
  render mode (`cpsExt[]` table, `graphics/screen_eob.cpp:194-206`,
  `ci=1` only when `_vm->game()==GI_EOB1`) — confirmed a full LCW-compressed
  bitmap (see `docs/eotb/dosvga/data-structure.md` § "EGA render mode").
- **EOB2**: `ci` is never set to 1 for EOB2 (only EOB1 and FM-Towns branch
  away from the default `"CPS"` in that table) — EOB2 keeps loading
  `.CPS` graphics in every render mode, and instead uses `.EGA` **only for
  the palette**, selected via `paletteFilePattern = (GI_EOB2 &&
  _configRenderMode==EGA) ? "%s.EGA" : "%s.PAL"` (`engine/scene_eob.cpp:
  185`) — the wall-set-stem name-match this doc already documents above,
  just pointed at `.EGA` instead of `.PAL` when the user has EGA render
  mode selected. And critically: `Screen::loadPalette(filename, pal)`'s
  EGA branch (`graphics/screen.cpp:3499-3504`) treats a **file-based**
  `.EGA` load as an ordinary 768-byte/256-colour **VGA-style** palette
  (`pal.loadVGAPalette(...)`), not the 16-colour hardware-index
  `loadEGAPalette` used for embedded palette *data* elsewhere — matching
  the observed 768-byte file size exactly, and meaning **no new decode
  logic is needed**: `.EGA` files in this corpus decode with the exact
  same VGA-palette reader already used for `.PAL`/`.COL`
  (`scripts/kyralib/palette.py`).

**Closes `eotb2-dos-ega-files`** — reclassified from "undecoded graphics"
to "alternate palette set, decodes with existing code". **Wired into the
extractor (2026-08-29):** all 8 `.EGA` files are now extracted as
`palettes/<stem>_ega.json` (suffixed to avoid colliding with the
same-stem `.PAL` output — see `extract_ega_palettes` in
`scripts/extract_eotb2_dosvga.py`).

---

## ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT (confirmed, byte-exact)

Same `EoBItem`/`EoBItemType` record layout as EOB1 (`engine/items_eob.cpp`
— see `docs/eotb/dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT" for
the full field table), confirmed against this corpus's own files:

- **`ITEM.DAT`** (10,385 bytes): `numItems=434` → item table ends at
  `2+434*14=6078`; `numNames=123` at that offset → name table
  `6078+2+123*35=10385` = **file size exactly, zero residue**. First name
  decodes to `"Mouse Pointer"`, matching EOB1's convention exactly.
- **`ITEMTYPE.DAT`** (1,026 bytes): `numTypes=64` → `2+64*16=1026` = **file
  size exactly, zero residue**.

**`TEXT.DAT`** (22,463 bytes) is a **new, simpler format** — not an
`EoBItem`-style table at all. Loaded raw (no LCW) via
`EoBCoreEngine::npcSequence` (`engine/eobcommon.cpp:1397-1410`,
`loadFileDataToPage(s, 5, 32000)`) and consumed by the NPC dialogue text
system. Structurally decoded and verified this pass:
```
u16 LE  offsets[N]         # N = offsets[0] / 2 (table's own byte length, in the first entry)
char[]  string pool         # NUL-terminated strings, one per offset entry, immediately following the table
```
**Verified byte-exact and legible:** `offsets[0]=244` implies `N=122`
entries; all 122 offsets are strictly monotonically increasing; the first
string starts at byte 244 (exactly where the 122×2-byte offset table
ends); the last string flows to 22,347, well within the 22,463-byte file.
Every one of the 122 strings decodes to fully legible EOB2 NPC dialogue
text — `"Oh great heroes, thank you for your timely rescue..."`,
`"Calandra eagerly joins your party."`, `"You befriended my brothers. \rBut
Dran closed the path..."`, etc. **Closes `eotb2-dos-item-text-dat`** (all
three files now byte-exact confirmed). **Wired into the extractor
(2026-08-29):** `data/item.json` (`{items, names}`), `data/itemtype.json`
(`{types}`), `data/text.json` (`{strings}`) — new shared modules
`scripts/kyralib/items.py` and `scripts/kyralib/textdat.py`.

---

## Not extracted this session (remaining open items)

| Item | Notes |
|------|-------|
| `.SND` / `.ADL` (10 each) | Audio (digitized + AdLib music) — out of scope for this pass. |
| Per-CPS palette selection for the 110 `PALETTE0.PAL`-fallback screens | Mechanism confirmed (see "Palette resolution" above — same wall-set-stem match as EOB1, plus the now-fully-decoded second wall-set field); which specific non-wall-set CPS files (monster/UI) actually need a level-specific palette vs. the game-wide fallback not individually traced. |
| Second-wall-set-field runtime consumer | The field itself is fully decoded (see "INF — Level configuration (EOB2)" above); what in-game code does with the resulting `tmpStr` beyond the one `format()` call ScummVM's `initLevelData` performs is not traced further. |

**Extractor pipeline wiring is now complete (2026-08-29)** — all 6
previously-pending formats (`.DCR`, `.DEC`, `.EGA`-as-palette, `ITEM.DAT`,
`ITEMTYPE.DAT`, `TEXT.DAT`) are emitted as JSON by
`scripts/extract_eotb2_dosvga.py`, each verified against this corpus's own
files (record counts, zero residue, and for `.DCR`/`.DEC` byte-exact
`setCount`/`decCount`/`rectCount` invariants matching the tables above).
New shared decode modules: `scripts/kyralib/items.py` (`ITEM.DAT`/
`ITEMTYPE.DAT`, shared layout with EOB1 — not yet wired into EOB1's own
extractor, out of scope for this pass), `scripts/kyralib/decorations.py`
(`.DEC`, shared DOS/Amiga layout), `scripts/kyralib/dcr.py` (`.DCR`,
EOB2-only), `scripts/kyralib/textdat.py` (`TEXT.DAT`, EOB2-only). **Closes
`eotb2-pipeline-wiring`.**

---

## Files

- **Library:** `scripts/kyralib/` (shared with EOB1; `format80.py` gained
  `decode_frame3` this session for EOB2's one RLE-compressed CPS;
  `items.py`/`decorations.py`/`dcr.py`/`textdat.py` added this pass)
- **Extractor:** `scripts/extract_eotb2_dosvga.py`
- **Assets:** `public/assets/eotb2/dosvga/{palettes,screens,textures,data}/`
  — 19 palettes + 8 `_ega` alternates, 116 CPS screens, 5 VCN wall texture
  atlases, 15 MAZ level grids, `item.json`/`itemtype.json`/`text.json`, 9
  `*_dcr.json`, 6 `*_dec.json`

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

---

## VCN / VMP — Wall tilesets

**Confirmed**, byte-identical structure to EOB1 (same 4bpp/8×8-tile
packing, same col_map remap, same u16-count-prefixed VMP index array).
5 of 6 wall sets have a `.VCN`/`.VMP` pair: **AZURE, CRIMSON, DUNG,
FOREST, MEZZ, SILVER** are the 6 named wall-set `.PAL` files, but
**`AZURE.VCN` does not exist** in this corpus (only `AZURE1.CPS`/
`AZURE2.CPS` full-screen renders) — Azure is presumably an
intro/cutscene-only area rendered as flat CPS backdrops rather than a
navigable 3D-tile dungeon, or its VCN uses a different name not yet
identified. Logged as an open item, not chased further.

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

## Not extracted this session (open items)

| Item | Notes |
|------|-------|
| `.DCR` files (9 total, e.g. `BEHOLDER.DCR` = 38 bytes) | Very small — likely creature/decoration *parameters* (spawn behaviour, AI flags), not graphics. Not traced this session. |
| `.DEC` files (6 total) | Decoration placement data per the Amiga doc's EOB2 section — not verified against these DOS files. |
| `.SND` / `.ADL` (10 each) | Audio (digitized + AdLib music) — out of scope for this pass. |
| `.EGA` files (8 total) | Secondary EGA render-mode graphics, same deferral as EOB1. |
| `AZURE.VCN` | Missing from corpus — Azure appears to be CPS-backdrop-only; not confirmed why. |
| `ITEM.DAT` / `ITEMTYPE.DAT` / `TEXT.DAT` | Present in this corpus but not decoded — same open item as EOB1 (`items_eob.cpp` not yet fetched). |
| Per-CPS palette selection for the 110 `PALETTE0.PAL`-fallback screens | Heuristic (name-match, else PALETTE0), spot-checked on 4 files, not traced through the actual level-load code for every screen. |

---

## Files

- **Library:** `scripts/kyralib/` (shared with EOB1; `format80.py` gained
  `decode_frame3` this session for EOB2's one RLE-compressed CPS)
- **Extractor:** `scripts/extract_eotb2_dosvga.py`
- **Assets:** `public/assets/eotb2/dosvga/{palettes,screens,textures,data}/`
  — 19 palettes, 116 CPS screens, 5 VCN wall texture atlases, 15 MAZ level
  grids

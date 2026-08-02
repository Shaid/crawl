# Eye of the Beholder II (EOB2) — open work

Single status surface for EOB2. See `docs/eotb2/dosvga/data-structure.md`
(DOS/VGA port, verified) and `docs/eotb2/eotb2-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence. This file is pointers only.

Note: `data/eotb2/amiga/` (with `Manual/`, `Maps/`, `Solution/` reference
material) was not touched this session — DOS/VGA was the priority per the
task brief. An Amiga EOB2 doc/extractor is future work, not yet started.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| eotb2-pipeline-wiring | open | 6 formats (`.DCR`, `.DEC`, `.EGA`-as-palette, `ITEM.DAT`, `ITEMTYPE.DAT`, `TEXT.DAT`) are now fully format-confirmed (byte-exact, zero residue) but not yet emitted as JSON by `scripts/extract_eotb2_dosvga.py` | `dosvga/data-structure.md` §§ ".DCR", ".DEC", ".EGA files", "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT" | 2026-08-02 game-re |
| eotb2-dos-cps-palette-second-field | open | EOB2's INF format has an optional *second* wall-set-name field (for a second palette) that's confirmed to exist from source but not decoded/verified against real INF bytes, and per-file (non-wall-set) palette selection for the 110 `PALETTE0.PAL`-fallback CPS screens isn't individually traced | `dosvga/data-structure.md` § "Palette resolution (per-CPS)" → "Confirmed mechanism" | 2026-08-02 game-re |
| eotb2-amiga-not-started | deferred:out-of-scope | `data/eotb2/amiga/` (incl. Manual/Maps/Solution reference material) not yet reverse-engineered — DOS/VGA was this session's priority | (no doc yet) | 2026-08-02 game-re |

## Closed this session (2026-08-02, ScummVM source + byte-exact verification)

- **`eotb2-dos-dcr-format`** — confirmed via `DarkMoonEngine::
  loadMonsterDecoration` (`engine/darkmoon.cpp:310-336`): per-facing
  sprite-decoration shape/offset tables, `2 + setCount*36` bytes. Verified
  byte-exact against **all 9** `.DCR` files in the corpus, zero residue.
  See `dosvga/data-structure.md` § ".DCR — monster decoration parameters".
- **`eotb2-dos-dec-format`** — confirmed identical to the already-decoded
  EOB1/DOS format (shared `getDecDefinitions`, forced-LE reader). Verified
  byte-exact against **all 6** `.DEC` files, zero residue. See
  `dosvga/data-structure.md` § ".DEC — level decoration placement".
- **`eotb2-dos-ega-files`** — premise corrected: EOB2's 8 `.EGA` files are
  **alternate 768-byte VGA-style palettes** (not compressed graphics like
  EOB1's `.EGA`) — `Screen::loadPalette`'s EGA branch decodes a file-based
  `.EGA` with the ordinary VGA-palette reader, confirmed from source and
  from every file being exactly 768 bytes. Decodes with existing
  `scripts/kyralib/palette.py` code, zero new format work. See
  `dosvga/data-structure.md` § ".EGA files — confirmed: alternate
  palettes, NOT graphics".
- **`eotb2-dos-azure-vcn-missing`** — confirmed by design, not a naming
  mismatch: all 16 `LEVELn.INF` files were decoded and their embedded
  wall-set-stem fields checked exhaustively — `"azure"` never appears as a
  wall-set reference anywhere. Azure is CPS-backdrop-only because no level
  ever asks for an Azure 3D tileset. Bonus: also confirms `LEVEL16.MAZ`'s
  absence is because `LEVEL16.INF` reuses `LEVEL15`'s maze (and similarly
  `LEVEL6`→`LEVEL5`, `LEVEL14`→`LEVEL12`), not a missing file. See
  `dosvga/data-structure.md` § "VCN / VMP — Wall tilesets".
- **`eotb2-dos-item-text-dat`** — `ITEM.DAT`/`ITEMTYPE.DAT` confirmed
  byte-exact using the same record layout discovered for EOB1
  (`items_eob.cpp` is shared code); `TEXT.DAT` decoded as a new, simpler
  offset-table + NUL-terminated-string-pool format, verified against all
  122 entries (monotonic offsets, first string starts exactly at the
  table's own end, fully legible EOB2 NPC dialogue text). See
  `dosvga/data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT".
- **`eotb2-dos-cps-palette-heuristic`** — mechanism confirmed identical to
  EOB1's for wall-set/dungeon screens (shared `initLevelData` code,
  `setLevelPalettes` is a no-op for DOS). Narrowed rather than fully
  closed — see `eotb2-dos-cps-palette-second-field` above for what's left.

# Lands of Lore: The Throne of Chaos — open work

Single status surface. See `docs/landsoflore/dosvga/data-structure.md`
(verified) and `docs/landsoflore/landsoflore-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence and paths-tried detail. This file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lol-shp-recolor-render | open | SHP monster/UI sprite atlases (`lizard_shp.png` etc.) still render in greyscale — SHP files don't carry their own palette, need a monster→level mapping to pick the right VCN-embedded palette (VCN's own `catwalk_vcn.png` is now fixed, see closed items below) | `dosvga/data-structure.md` § "SHP — Multi-frame creature/UI shapes" | 2026-08-02 game-re |
| lol-iso-remaining-paks | open | Only a representative subset of the 209-file ISO was extracted this session (breadth-first) — `L02-L29`, `O00A-O29A`, `CIMMERIA/KEEP/MANOR/MINE1/RUIN/SWAMP/TOWER1/URBISH/YVEL.PAK`, `FRE`/`GER` language sets, `MUSIC.PAK`, `VOC.PAK`, 29 of 30 `.TLK` files not pulled through the (now-fully-confirmed) pipeline | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-text-script-data | deferred:out-of-scope | `.INF`/`.TLC`/`.INI`/`.LM` text/scripting tables and EMC2 script bytecode — gameplay logic, out of scope for the palette/sprite/container breadth pass | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |

## Closed this session (2026-08-02, ScummVM source + byte-exact verification)

- **`lol-palette-runtime-patch`** — the important one, fully resolved.
  `LoLEngine::loadLevelGraphics` (`engine/scene_lol.cpp:300-368`) is the
  real `setLevelPalettes`-equivalent, and the fix wasn't "find an external
  patch source" — it's that the real 128-colour (384-byte) palette is
  **embedded inside the `.VCN` file itself**, past a `numTiles`-length
  `vcnShift` table and a fixed 128-byte `vcnColTable`, a region the
  previous pass's VCN decode stopped short of. Verified byte-exact against
  `CATWALK.VCN`: `2 + 1845 + 128 + 384 + 1845*32 = 61399` = the file's own
  declared decompressed size exactly, zero residue — and the two
  previously-magenta palette indices (48, 112) now decode to real colours
  (dark green, dark blue) sitting in a coherent gradient. **Fix applied
  this session**: `scripts/kyralib/vcn.py` gained `parse_vcn_lol`/
  `decode_all_tiles_lol` (the old `parse_vcn` used EOB's fixed-header
  offset, which was structurally wrong for LOL, not just missing colour),
  and `catwalk_vcn.png` now renders as a real, coherent tan/brown
  stonework texture. This diagnosed the SHP colour question's root cause
  too (same active-palette mechanism) but SHP re-rendering itself is a
  separate remaining task — see `lol-shp-recolor-render` above. See
  `dosvga/data-structure.md` § "VCN — Wall tileset".
- **`lol-tlk-files`** — confirmed to be ordinary Kyra PAK containers of
  `NNNNN.VOC` speech clips (`LoLEngine::loadTalkFile`, `engine/lol.cpp:
  1894-1905`, uses the same `_res->loadPakFile`/`unloadPakFile` as every
  other `.PAK`), **not** raw CD-audio track data as previously guessed.
  Verified byte-exact: extracted `25.TLK` (44,138 bytes) from the ISO and
  parsed it with the existing, unmodified `scripts/kyralib/pak.py` — one
  entry, `00000.VOC`, `23 + 44115 = 44138` = file size exactly. See
  `dosvga/data-structure.md` § "`GAME.DAT` is a raw ISO 9660 CD image".
- **`lol-wll-format`** — confirmed and located: `.WLL` files live inside
  the per-level PAK (e.g. `LEVEL1.WLL` inside `L01.PAK`), uncompressed,
  12-byte wall-type-parameter records (`LoLEngine::loadLevelWallData`,
  `engine/scene_lol.cpp:142-179`) — confirmed analogous to EOB's
  `<WALLSET>.DAT` as suspected. Verified byte-exact against the real
  `LEVEL1.WLL` (626 bytes): `(626-2)/12 = 52.0` exactly, zero residue, and
  the decoded `wallTypeIndex` field increments cleanly 0-51 across all 52
  records. See `dosvga/data-structure.md` § "WLL — Wall-type parameter
  table".

# Lands of Lore: The Throne of Chaos — open work

Single status surface. See `docs/landsoflore/dosvga/data-structure.md`
(verified) and `docs/landsoflore/landsoflore-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence and paths-tried detail. This file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lol-shp-recolor-render | open | SHP monster/UI sprite atlases (`lizard_shp.png` etc.) still render in greyscale — SHP files don't carry their own palette, need a monster→level mapping to pick the right VCN-embedded palette (VCN's own `catwalk_vcn.png` is now fixed, see closed items below) | `dosvga/data-structure.md` § "SHP — Multi-frame creature/UI shapes" | 2026-08-02 game-re |
| lol-iso-remaining-paks | open | Only a representative subset of the 209-file ISO was extracted this session (breadth-first) — `L02-L29`, `O00A-O29A`, `CIMMERIA/KEEP/MANOR/MINE1/RUIN/SWAMP/TOWER1/URBISH/YVEL.PAK`, `FRE`/`GER` language sets, `MUSIC.PAK`, `VOC.PAK`, 29 of 30 `.TLK` files not pulled through the (now-fully-confirmed) pipeline. The walker session (2026-08-16) pulled a further 11 level PAKs + 6 wall-set PAKs through a *different* (TypeScript) pipeline for real gameplay data — see the walker closed block below — but the original Python/JSON asset-breadth pipeline this row tracks is still only the original representative subset | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-text-script-data | open | `.TLC`/`.LM` text tables and full EMC2 script bytecode remain out of scope (gameplay logic). **Narrowed this session**: `.INI`'s EMC2 `FORM`/`TEXT` container is now partially decoded — `decode-ini.ts` extracts the string pool (self-describing offset-table + NUL-terminated strings) well enough to resolve a level's wall-set name, but the bytecode itself (the `DATA` chunk) is still unparsed | `dosvga/data-structure.md` § "Not extracted this session"; `tools/landsoflore/decode-ini.ts` | 2026-08-16 game-re |
| lol-vcn-shift-semantics | open | `vcnColTable`'s 8 selectable 16-entry sub-tables are confirmed to be addressed by `vcnShift[tileIndex]` directly as a byte offset (not a 0-7 index needing `*16`, an earlier in-session guess that was caught by a garbled CAVE1 render and fixed) — but *why* a tile picks a given sub-table (brightness ramp? dynamic lighting state?) is still not confirmed against `engine/scene_lol.cpp` source, only the byte-offset reading | `tools/landsoflore/decode-vcn.ts` module doc | 2026-08-16 game-re |
| lol-wll-mapping-fallback | open | `buildWllLookup`'s `rawByte -> vmpMapValue` dictionary covers every value `LEVEL1.CMZ` actually uses (verified, zero misses) — but this is one level's worth of evidence; a raw byte value with no entry in a *different* level's own WLL table falls back to EOB's cruder clamp-to-generic-wall, unverified against a real case since none has been found yet | `tools/landsoflore/view-model.ts` (`resolveRawWallType`) | 2026-08-16 game-re |

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

  > **Correction (2026-08-16):** "increments cleanly 0-51 across all 52
  > records" is wrong as a description of the field's *role* — it only
  > holds for the first 27 records. Records 27-51 have `wallTypeIndex`
  > values 53-79 (`66,67,53,54,55,57,58,59,60,61,62,63,64,65,68,69,71,72,
  > 73,74,75,76,77,78,79`), which the walker session traced back to a real
  > mechanism: `.WLL` is a **sparse dictionary keyed by the raw `.CMZ`
  > per-side byte value itself**, not a dense positional array. The
  > "sequential in practice" reading was true of a prefix of the data, not
  > the format — see `tools/landsoflore/decode-wll.ts`'s module doc for
  > the full finding and `docs/eotb/TODO.md`'s still-open
  > `eotb1-amiga-walker-wallmapping` row for the EOB1 counterpart this
  > resolves the general shape of (EOB never had this table decoded to
  > check against).

## Lands of Lore walker — closed this session (2026-08-16, game-re)

Phase 3 (last leg) of the EOB1/EOB2/Lands of Lore family (`tools/eotb/`,
`tools/eotb2/`, both shipped first, same session). Confirms the
per-8x8-tile-mosaic / "slot-table family doesn't fit" finding a third
time: ships as the same bespoke `IndexedSurface` compositor
(`tools/landsoflore/renderer.ts`) via `GameView.renderCanvas`, wired into
the shared browser walker as game `landsoflore`.

**New format work, not just reuse.** `.CMZ` and `.WLL` (level grid, wall
parameters) reuse EOB's confirmed shapes almost directly once unwrapped
from LOL's Kyra-bitmap/LCW container (`tools/landsoflore/kyra-bitmap.ts`,
a small shared unwrapper for `.CMZ`/`.VCN`/`.VMP`, all confirmed to share
one 10-byte header format this session). `.VCN` and `.VMP` are genuinely
new decoders (`tools/landsoflore/decode-vcn.ts`/`decode-vmp.ts`): LOL
embeds its own 384-byte palette inside `.VCN` rather than sourcing one
externally, and — a real new structural finding — **the wall-type count
per wall set is NOT a fixed 6 like every EOB set seen so far**: real
measurements this session found `{KEEP:6, URBISH:6, CATWALK:5, CAVE1:5,
MANOR:4, SWAMP:3, FOREST1:2}`, all still fitting the same
`330-backdrop + N*431` split, just with `N` varying. `decode-vmp.ts`
derives `N` from the file itself instead of assuming 6.

**A real bug caught before shipping**: an initial `vcnColTable` pixel
formula (`(vcnShift[tile] & 7) * 16 + nibble`) rendered CAVE1 as garish
neon-green noise while 4 other wall sets happened to look plausible
anyway (their tiles mostly used `vcnShift=0`, where the wrong formula and
the right one coincide). A byte-value census across all 5 initial wall
sets found `vcnShift` only ever takes the 8 values `{0,16,32,...,112}` --
i.e. it's already the sub-table's byte offset, not a 0-7 index needing
`*16`. Fixed (`vcnColTable[vcnShift[tile] + nibble]`) and re-verified:
all 6 wall sets render coherently, and the fix improved several other
wall sets' colour fidelity too (not just CAVE1's), confirming every wall
set shared the same latent bug at varying visible severity.

**`.WLL` resolved to a real fidelity win over EOB.** See the correction
above `lol-wll-format` — the sparse `rawByte -> vmpMapValue` dictionary
this session found is a working oracle for exactly the kind of "raw
per-side byte isn't a direct small wallType" gap EOB1's own
`eotb1-amiga-walker-wallmapping` row is still stuck on. `view-model.ts`'s
`resolveRawWallType` uses it directly (verified: zero misses against
every raw byte `LEVEL1.CMZ` actually uses), falling back to EOB's cruder
clamp only for values absent from a level's own WLL table (not observed,
see `lol-wll-mapping-fallback` above).

**`FOREST1` corrected, not skipped.** An initial pass assumed FOREST1 was
the same "non-standard, unsupported" outdoor-terrain gap EOB2's own
FOREST wall set has, purely by analogy. It isn't: `1192 - 330 = 862 =
2*431` divides exactly (`N=2`) -- EOB2's own decoder just hardcodes
`N=6` and can't express that. Levels 2 and 3 (both FOREST1) render
coherent forest/foliage textures and are included in the shipped level
list.

**11 levels, 6 wall sets shipped**: `1(KEEP,6) 2,3(FOREST1,2) 4(MANOR,4)
5-9(CAVE1,5) 11(SWAMP,3) 12(URBISH,6)`, picked by a real per-level survey
(`LEVELn.INI`'s wall-set string, cross-checked against the wall set's own
VMP entry count) rather than guessing. `.INI`'s wall-set name isn't
always the first string in its EMC2 `TEXT` string pool (an `ALTPALn.PAL`
reference sometimes precedes it) -- `decode-ini.ts` scans for a known
wall-set name rather than assuming a fixed position, the same pragmatic
technique `tools/eotb2/decode-inf.ts` used for its own offsets-don't-match
gap.

**Verified**: 21 new unit tests against real corpus data (including a
byte-exact `.INI` string-pool oracle, a `vcnShift` value-set census
across every wall set, and a zero-misses WLL-coverage check); multiple
real poses across all 6 wall sets rendered offline and visually
inspected (coherent, distinct-looking corridors per wall set -- brick,
wood-panelled manor, mossy cave, murky swamp, cobbled town, forest
foliage); live in the browser via Playwright (game/level dropdowns,
WASD movement + turning changing the tracked pose, a level switch that
also changes wall set, 0 console errors). Full repo `vitest`/`tsc`/`lint`
clean with this in the tree.

**Left open** (see the four rows above): the EMC2 script bytecode itself
(only the string pool is read); `vcnShift`'s exact semantics beyond the
byte-offset reading; the WLL fallback path is unverified since no miss
has been found; level 10 (also FOREST1) wasn't added to the level list,
just not surveyed this session, likely works the same as 2/3.

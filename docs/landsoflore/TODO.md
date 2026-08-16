# Lands of Lore: The Throne of Chaos — open work

Single status surface. See `docs/landsoflore/dosvga/data-structure.md`
(verified) and `docs/landsoflore/landsoflore-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence and paths-tried detail. This file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lol-shp-recolor-render | open | SHP monster/UI sprite atlases still render in greyscale. **Narrowed this session (real ScummVM source, `LoLEngine::loadMonsterShapes`, `engine/sprites_lol.cpp:27-108`)**: the original "needs a monster→level→VCN-palette mapping" framing is **refuted** — each monster's own `.SHP` bundle is self-contained. Shape index 16 in every monster `.SHP` (confirmed against real `LIZARD.SHP`: 17 shapes total, shape 16 is a distinct 5×20 "palette strip" image, shapes 0-15 are the 82×86 animation frames) is drawn onto a screen page and its pixels sampled to build a 64-entry base colour table (`tmpPal1`), then each animation frame's own embedded colour table (already decoded by `tools/landsoflore/`'s existing `parse_shp_container`/`ShpShape.color_table`) is remapped through it across **8 brightness levels** into `_monsterPalettes[]` — the same 8-level brightness-ramp shape as `lol-vcn-shift-semantics` below, a real cross-confirming pattern, not a coincidence. **Not implemented**: the remap depends on `Screen::getCPagePtr`/`drawShape`/`clearPage`'s page-buffer semantics (which page number holds what, and why `clearPage(3)` precedes a `drawShape(2, ...)`), not fully traced from `engines/kyra/graphics/screen.cpp` this session — shipping a guess here risks the exact "plausible but wrong colour" failure this project explicitly guards against, so this stays greyscale rather than risk it | `engine/sprites_lol.cpp:27-108` (`LoLEngine::loadMonsterShapes`); `dosvga/data-structure.md` § "SHP — Multi-frame creature/UI shapes" | 2026-08-16 game-re |
| lol-iso-remaining-paks | open | Only a representative subset of the 209-file ISO was extracted (breadth-first) — `L02-L29`, `O00A-O29A`, most named wall-set/language/audio `.PAK`s, 29 of 30 `.TLK` files not pulled through the pipeline. **Not attempted this session** (explicitly lower priority than the other rows here — mechanical extraction breadth, not a research question) | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-text-script-data | narrowed | `.TLC`/`.LM` text tables and EMC2 bytecode *execution* remain out of scope. **This session: real EMC2 bytecode *disassembly* shipped** (`tools/landsoflore/decode-emc.ts`), ported directly from `engines/kyra/script/script.cpp`'s `EMCInterpreter::run` (the exact per-instruction bit-packing: `opcode=(code>>8)&0x1F`, then `code&0x8000`→forced `jmp`+15-bit param, `code&0x4000`→sign-extended int8 param, `code&0x2000`→next word as a wide immediate) and `script_lol.cpp:2682-2875`'s `LoLEngine::setupOpcodeTable` (the real, complete 190-entry `sysCall` id→`olol_*` name table, extracted verbatim including its real `OpcodeUnImpl()` reserved gaps). Verified against real `LEVEL1.INI`: all 259 `DATA`-chunk words decode to valid opcodes with zero truncation, and sysCall names resolve to a coherent level-init script (`olol_loadLevelGraphics`, `olol_loadMonsterShapes`, `olol_makeItem`, `olol_rollDice`, `olol_setGameFlag`, ...) — caught and fixed one real bug in the process (`sysCall`'s id must be reinterpreted as an unsigned byte, `const uint8 id = _parameter` in the real engine, not kept signed like every other opcode's param). This decodes control flow and named engine calls; it does not *execute* scripts (no stack/register simulation) — a real interpreter is separate follow-on work if ever wanted | `engine/script.cpp:29-56,187-219`; `script/script_lol.cpp:2682-2875`; `tools/landsoflore/decode-emc.ts`; `tools/landsoflore/decode-ini.ts` | 2026-08-16 game-re |
| lol-vcn-shift-semantics | open | `vcnColTable`'s 8 selectable 16-entry sub-tables are confirmed addressed by `vcnShift[tileIndex]` as a byte offset; *why* a tile picks a given sub-table is still not confirmed. **Narrowed this session**: found `_blockBrightness` (`engine/scene_lol.cpp`, consumed in `use16ColorMode`'s decoration-overlay index adjustment, `bb = _blockBrightness >> 4`) as a real, sourced signal supporting the "brightness ramp" hypothesis, reinforced by `lol-shp-recolor-render`'s independent finding of the *same* 8-brightness-level remap shape in the monster-palette mechanism. But the actual wall-tile consumer — `generateBlockDrawingBuffer()`, declared in `engine/kyra_rpg.h:310` and called from both `scene_lol.cpp:1221` and `scene_eob.cpp:574` — is not implemented in any of the ~20 `engines/kyra/{engine,graphics,script}/*.cpp` files fetched this session (checked `screen.cpp`, `screen_lol.cpp`, `kyra_rpg.cpp`, every `scene_*.cpp`/`sprites_*.cpp`); GitHub's code-search API requires authentication this session doesn't have, so its body couldn't be located. Two consistent, real 8-level-brightness findings, but the exact per-tile selection formula remains unconfirmed | `engine/scene_lol.cpp` (`_blockBrightness`); `engine/kyra_rpg.h:310` (`generateBlockDrawingBuffer` declaration, body not found); `tools/landsoflore/decode-vcn.ts` module doc | 2026-08-16 game-re |
| lol-wll-mapping-fallback | closed | `buildWllLookup`'s dictionary covers every raw byte `LEVEL1.CMZ` uses (zero misses) — is the clamp-to-generic-wall fallback for an uncovered value correct? **Confirmed this session, real ScummVM source (`LoLEngine::loadLevelWallData`, `engine/scene_lol.cpp:142-179`; `_wllVmpMap`'s allocation, `engine/kyra_rpg.cpp:191`)**: the real engine has **no fallback mechanism at all** for this case. `_wllVmpMap` is one 256-byte array, zero-initialized once (`new uint8[256]()`) at startup, and is **never reset between level loads** — `loadLevelWallData` just overwrites whatever entries its own 12-byte `.WLL` records cover, on top of whatever was left from the *previous* level. A raw `.CMZ` byte with no entry in the current level's own `.WLL` table isn't handled by a designed clamp; it silently reads stale data from a prior level (or 0 at first boot) — undefined by design, not a documented safety net. Each level's `.WLL` table is simply expected to be complete for that level's own `.CMZ` usage by authoring convention. This port's clamp-to-generic-wall fallback is therefore a **defensive choice stricter than the original** (which has no real fallback to match), not a divergence from confirmed behavior — safe to keep as-is | `engine/scene_lol.cpp:142-179` (`loadLevelWallData`); `engine/kyra_rpg.cpp:191` (`_wllVmpMap` allocation); `tools/landsoflore/view-model.ts` (`resolveRawWallType`) | 2026-08-16 game-re |

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

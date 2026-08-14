# MM1 (DOS) — MAZEDATA.DTA

**Game:** Might & Magic: The Secret of the Inner Sanctum (New World
Computing, 1986) — MS-DOS release (GOG build, `data/mm1/dosega/`).

**Source of truth:** Vairn/MM2 `EXTRACTED/docs/22-mm1-mazedata-format.md`
plus ScummVM `engines/mm/mm1` (MM1's map loader is ScummVM-supported, so the
"MapWalls" bit layout below is independently implemented there).

All file offsets in this doc are **file-relative**.

---

## Container — `MAZEDATA.DTA` (28,160 B)

The whole geometry file is a flat array of **55 screens × 512 B** — the same
layout as MM2 `map.dat` (60 × 512), so the per-cell decode is shared with the
MM2 codec (`tools/mm2/map.ts` → `tools/mm1/map.ts`).

| Offset | Size | Page |
|--------|------|------|
| `0x000` | 256 | **Visual** — four 2-bit wall fields per cell (N/E/S/W): `0` open, `1` wall, `2` door, `3` wall+torch |
| `0x100` | 256 | **Collision** — per direction `(dark<<1)\|wall`; bit `0x80` = event flag |

> **Correction:** earlier text (and Vairn's `21/22-map-dat-format` prose)
> said `2`=wall+torch, `3`=door. That is **wrong** — the ASM-traced walker
> implementations (Vairn's own `view3d_indoor.py` legend: "code=2 door,
> code=3 torch") and the collision page both confirm `2`=door (passable
> doorway faces: 30 walkable vs 12 blocked in Sorpigal) and `3`=torch
> (wall-mounted, blocked faces: 68 blocked vs 4 walkable). On overland,
> cells whose four fields are all `3` (byte `0xFF`) are border/edge cells
> (Vairn doc 23).

Cell packing, **visual page**: `N = byte&3`, `E = (byte>>2)&3`,
`S = (byte>>4)&3`, `W = (byte>>6)&3` (four 2-bit fields).

Cell packing, **collision page**: `N/E/S` are 2-bit `(dark<<1)|wall`
(`N = byte&3`, `E = (byte>>2)&3`, `S = (byte>>4)&3`), but `W` is a single
wall-only bit (`W = (byte>>6)&1`, i.e. `byte & 0x40`) — its dark slot is
reused as the event flag (`byte & 0x80`). `W` is **not** a 2-bit field on
this page, unlike the visual page (`tools/mm2/map.ts` `decodeMapCell`,
shared by MM1).

Grid is 16×16, row 0 on disk = **south** (automap renders north-up).

### Overland caveat (screens 14–33, `area*`)

Overland sectors still use the same MapWalls page-0 encoding in the original
game (not MM2's terrain ids). Cells whose four 2-bit fields are all `3`
(`0xFF` byte) are **border/edge cells**, not doors — Vairn's MM1→MM2 outdoor
converter treats them as template edge tiles (see Vairn's
`23-mm1-to-mm2-outdoor.md`). The JSON output stores raw codes; consumers
interpreting overland should not read code 3 as "door" there.

## Screen names — `MM.EXE` slug table

`MM.EXE` embeds a null-terminated slug table at **file offset `0x10C07`**
(55 entries, MAZEDATA order):

`sorpigal portsmit algary dusk erliquin cave1…cave9 areaa1…areae4 doom
blackrn blackrs qvl1 qvl2 rwl1 rwl2 enf1 enf2 whitew dragad udrag1…udrag3
demon alamar pp1…pp4 astral`

Each slug names a companion **`*.OVR`** map-script overlay in the same
directory (55 files), which is how the order and the screen count are
independently cross-verified. `tools/mm1/map.ts` exposes the table as
`MM1_MAP_SLUGS` and can re-parse it from the executable with
`parseMapSlugsFromExe` (searches for the first `"sorpigal\0"`, reads
consecutive lowercase alphanumeric strings until 55 are found).

## Verification (all against real retail bytes)

| Check | Result |
|-------|--------|
| File size | 28,160 B = 55 × 512 exactly |
| TS round-trip (decode → encode vs disk) | byte-exact, 0 deviations |
| TS decode vs Vairn's independent Python decoder (`mm1_maps.py`) | byte-exact, 55/55 screens |
| MM.EXE slug table @ `0x10C07` vs documented table | byte-exact, 55 slugs |
| `*.OVR` filenames vs slug table | set-equal, 55/55 |
| Minimap atlas (11×5, 2 px/cell, north-up) | 53,230/53,230 non-dot pixels exact + 3,090/3,090 event-dot pixels exact |

## Outputs (`public/assets/mm1/dosega/`)

| Path | Contents |
|------|----------|
| `data/maps.json` | `{game, file, size, screenSize, pageSize, grid, screens:[{index, slug, title, env, entry, stats, cells}]}` — every screen fully decoded; `env` = `town`/`cavern`/`outside`; `entry` = first fully-open collision cell (walk-in point) |
| `screens/mm1-maps.png` | 55 north-up minimaps, 11×5 atlas, 352×160; colours: floor `#181820`, wall `#a8a8b0`, torch `#f8c850`, door `#e07048` (overland border cells render as doors by code), dark cells dimmed, event cells get a red dot |
| `screens/mm1-maps.json` | atlas sidecar, frame names = slugs |

## `.DTA` graphics container — `WALLPIX.DTA` / `MONPIX.DTA` (**solved**)

Both files use one shared container + image format, ported directly from
ScummVM's `engines/mm/mm1` (`gfx/dta.cpp`, `gfx/screen_decoder.cpp`; GPL
oracle — same strategy as the EOB/LoL kyralib pass). Decoders:
`scripts/mm1lib/dta.py` + `scripts/mm1lib/wallpix.py`, extractor
`scripts/extract_mm1_gfx.py` (`npm run mm1:gfx`).

### DTA container (both files)

| Offset | Size | Field |
|--------|------|-------|
| `0x000` | 2 | `u16LE` index byte-size (multiple of 4) |
| `0x002` | index_size | `u32LE` offset table: **one start offset per entry**, `index_size / 4` entries — no sentinel |
| after | — | entry payloads, back to back |

`WALLPIX.DTA` has **18 entries**, `MONPIX.DTA` **76**. Each entry's end is
the next entry's start offset, except the *last* entry, whose end is
end-of-file (ported from ScummVM's `Gfx::DTA::load()`, `gfx/dta.cpp`). An
earlier port read `index_size / 4` offsets as "N-1 entries + 1 end
sentinel", silently dropping the true last entry of every `.DTA` file —
that entry decodes byte-exact once the boundary is fixed (see `dta.py`'s
`DtaContainer` docstring). Each entry payload begins with its own `u16LE`
size word (the compressed byte count of the rest of the entry — validated:
holds 92/92 entries).

### ScreenDecoder image format (per tile / per image)

The entry body is an RLE stream the decoder consumes into a `w/4 × h` grid
of 2bpp cells, then expands MSB-first into 4 CLUT8 pixels per cell byte via
a 4-entry `_indexes[]` remap, then the caller maps those through the
standard 16-colour EGA palette:

- RLE: literal byte, or `0x7B <len-1> <value>` = run of `len` bytes. A
  literal `0x7B` cannot occur in the stream.
- **Column-major fill** — the C++ fill advances a base pointer once per
  completed column (`destP[index]` with a moving `destP`), i.e. write
  position = `col + row*stride`, NOT `idx += stride` with `idx` reset to 0.
  Porting it the naive way still consumes the stream exactly (the loop
  structure is unchanged) but silently overwrites column 0 and renders
  single-colour images — this bit us mid-pass and is why the ported
  `decode_screen` explicitly tracks `(row, col)`.
- Runs may overrun a tile's cell grid; excess bytes are discarded (the game
  never stores data that triggers the C++ out-of-bounds path).

### WALLPIX — 18 wall sets, 12 frustum slices each

`Maps::loadTile()` (`maps/maps.cpp`): each entry skips its size word, then
holds **12 sequential tiles** at fixed sizes — 4 left-wall slices near→far,
4 right-wall, 4 front/mid:

| Slice | Size | Role |
|-------|------|------|
| 0–3 | 32×128, 40×96, 24×64, 16×32 | left wall column, near → far |
| 4–7 | same | right wall column |
| 8–11 | 176×96, 96×64, 48×32, 16×16 | front wall column |

Per-entry colour remap: `TILE_COLORS[entry]` → `_indexes = [0, colors&0xf,
colors>>4, 15]`. Overland biome labels (Vairn doc 24: entry+1 = wallNN):
entries 6–13 = trees/mountains/lava/swamp/water/thick-forest horizons.
Screens select their set via `TILE_AREAS`/`TILE_OFFSET` (towns/caves →
entries 0–5; overland → 6–13; area 3 → 14–17).

### MONPIX — 76 monster portraits

`Monsters::getMonsterImage()` (`data/monsters.cpp`): each entry decodes to a
single **104×96** image. Per-image remap: `PALETTE[imgNum]` u16 →
`_indexes = [pal&0xf, pal>>4&0xf, pal>>8&0xf, pal>>12&0xf]`. Monster names
from ScummVM's static `monsters.txt` (195 monsters, last field = `_imgNum`);
~69 distinct images are shared by multiple monsters. All aquatic monsters
(Giant Leech, Crocodile, Barracuda, Giant Squid, Electric Eel, Shark, Great
Sea Beast) map to **imgNum 75**, which **does** have a MONPIX entry — a
real 104×96 portrait, decodes byte-exact with 0 remainder (see the DTA
container note below; an earlier off-by-one made this entry look absent).

### Verification (real retail bytes)

| Check | Result |
|-------|--------|
| Container: index sizes 72/304, entry counts 18/76 | exact |
| Per-entry `u16LE` size word vs payload length | 94/94 match |
| Decode consumption vs payload length | **94/94 entries, 0 remainder** (every byte accounted) |
| WALLPIX symmetric wall sets (entries 0/2/9/14/15/16) | L/R agreement 0.65–0.93 |
| WALLPIX asymmetric sets (overland horizons 3–6/8/10/12) | low L/R agreement — correct, landscapes aren't mirrored |
| Biome-consistent colours | towns bright white/stone; entry 11 blue sky+yellow; entries 12/13 cold cyan/white; entry 6 green/brown |
| MONPIX multi-colour content | 76/76 images use ≥2 of their 4 remap colours |
| Monster names | Flesh Eater→img4, Mummy→img61, Demon King→img73, Succubus Queen→img74 |

Outputs (`public/assets/mm1/dosega/`): `textures/wallpix.png` (216-slice
atlas + sidecar), `data/wallpix.json`, `sprites/monpix.png` (76-portrait
atlas + sidecar), `data/monpix.json`.

## Misc data files — `ROSTER.DTA`, `SCREEN0-9`, `MM.RSM`, `GACARD.DTA` (**solved / documented**)

Extractor `scripts/extract_mm1_misc.py` (`npm run mm1:misc`).

### `ROSTER.DTA` — 18 starting characters (2304 B, **confirmed**)

18 × **127-byte** records + 18 town bytes = 2304 B exactly. Layout ported
from ScummVM `data/roster.cpp` (`Roster::synchronize`, 18 `Character`s) +
`data/character.cpp` (`Character::synchronize`). Record:

| Offset | Size | Field |
|--------|------|-------|
| +0x00 | 16 | name (padded; stored uppercase) |
| +0x10 | 5 | sex, alignmentInitial, alignment, race, class (1 B each) |
| +0x15 | 16 | 8 × `(base, current)` AttributePairs: intelligence, might, personality, endurance, speed, accuracy, luck, level |
| +0x25 | 2 | age, ageDayCtr |
| +0x27 | 4 | experience `u32LE` |
| +0x2B | 4 | `sp.current`, `sp.base` (`u16LE` each) |
| +0x2F | 2 | spellLevel `(base, current)` |
| +0x31 | 2 | gems `u16LE` |
| +0x33 | 6 | `hpCurrent`, `hp`, `hpMax` (`u16LE` each) |
| +0x39 | 3 | gold: `u16LE` lo + 1 byte hi |
| +0x3C | 2 | AC `(base, current)` |
| +0x3E | 2 | food, condition |
| +0x40 | 24 | 4 × 6-byte inventory pass (equipped ids, backpack ids, equipped charges, backpack charges) |
| +0x58 | 16 | 8 × resistances `(base, current)`: magic, fire, cold, electricity, acid, fear, poison, psychic |
| +0x68 | 4 | physical, missile `(base, current)` pairs |
| +0x6C | 4 | trapCtr, quest, worthiness, alignmentCtr |
| +0x70 | 14 | `_flags[14]` |
| +0x7E | 1 | portrait |

Then 18 town bytes (1 = Sorpigal; the shipped party all start in Sorpigal).
Decoded record 0 = **"CRAG THE HACK"** (Knight, lvl 1, 14/14 HP, 60 XP, 200
gold) — the canonical MM1 starter party (Crag the Hack, Sir Galand =
Paladin, Zenon III = Archer, Swifty Sarg = Robber, Serena = Cleric, Wizz
Bane = Sorcerer), all 6 town bytes = Sorpigal. Note the on-disk portrait
bytes 0–5 are remapped at load to ScummVM's `DEFAULT_PORTRAITS
{0,11,9,7,4,3}` — the stored values are sequential, the remap is the
canonical character-creation portraits. → `data/roster.json`.

### `SCREEN0-9` — title/menu screens (**confirmed**)

Each = `u16LE` size word + ScreenDecoder RLE stream at **320×200**, 0
remainder on all 10. Colour remap `_indexes = [0,2,4,15]` (screen 2 uses
`[0,3,5,15]`) — `views/title.cpp` `Title::msgFocus`. → `screens/title-*.png`.

### `MM.RSM` — overlay-loader symbol table (6656 B, **hypothesis**, observed)

Not consumed by ScummVM. `parse_rsm_symbols()` (`scripts/extract_mm1_misc.py`)
scans null-terminated names, each followed by a 4-byte address field
(`seg-byte, 0x28, u16LE offset`) — **412 symbols**, offsets 0x22–0x1281,
all identifier-shaped (letters/digits/underscore): `$ovbgn`, `main_`,
`ovloader_`, `loadabort_`, `readmaze_`, `readrost_`, `writrost_`,
`chkopen_`, `readwall_`, `readmon_`, `readpix_`, `readscr_`, `mykbhit`,
`clearkey`, `crit_err`, `cga_movsw`, `ega_movsw`, `to_ega`, `loadmaze`,
… `machtype`, `gostartaddr`, `errad`, `esflag`, `swim1`, etc. — the game's
own internal I/O + video-driver routines, so the file is the `.OVR`
overlay system's symbol/relocation table (MM1 loads its per-map scripts
as overlays).

An earlier pass under-counted this at 22: after matching a symbol, the
scanner resumed right after the name's null terminator instead of
skipping the 4-byte address field, so it re-scanned those (mostly binary)
bytes looking for the next null — usually desyncing from the true
name/address boundary and missing most of the table. Fixed by advancing
past the address field on every successful match.

The full address encoding is **not** confirmed (the `0x28` constant byte's
role is unclear) — the symbol list itself is solid.
→ `data/mm-rsm-symbols.json` (will inform the `*.OVR` script work).

**Oracle check (both come up empty):** neither external source has this.
Vairn/MM2 — `grep -rli rsm EXTRACTED/docs/` across the whole doc tree
returns **zero hits**; its only overlay-loader discussion (`08-event-runtime.md`
`-$7DFA`/`event_dat_loader`) is MM2 Amiga's `event.dat` runtime, an
unrelated system. ScummVM — `engines/mm/mm1/maps/map.cpp`
`Map::loadOverlay()` (see `.OVR` section above) reads the container header
and data segment directly and **skips the code segment entirely**, so
structurally it never needs an overlay-loader symbol table at all; there
is no `.rsm`/RSM-named file in `engines/mm/mm1/`'s directory listing or the
`dists/engine-data/mm1` manifest (checked via the GitHub contents API — a
full source-wide code search wasn't available in this environment:
`api.github.com/search/code` requires auth, `grep.app` returned no usable
response for either `RSM` or a known-present control string). Given the
self-contained loader shown above and zero hits in every check that did
work, `mm1-rsm-encoding` is **answered-by-neither** — the `0x28`-byte
address encoding remains genuinely open and would need manual analysis
(the overlay-loader routines the symbol table names — `ovloader_`,
`loadmaze`, `readwall_`, etc. — are themselves inside `MM.EXE`, not
reimplemented by any oracle we have access to).

### `GACARD.DTA` — copy-protection card state (**hypothesis**)

1 byte (`0x03`). MM1's copy protection is the "Game Access Card" grid;
this file likely stores the card variant the install uses. No consumer
found in ScummVM (it bypasses the protection). No decode attempted.

## Items / Monsters / Spells tables (**solved / documented**)

`scripts/extract_mm1_tables.py` (`npm run mm1:tables`). MM1 has **no**
items.dat/monsters.dat — the tables are embedded in **MM.EXE**. Both were
located by searching the exe for known item/monster names, then verified
byte-exact against ScummVM's static transcriptions (`devtools/create_mm/
files/mm1/items.txt` 255/255, `monsters.txt` 195/195).

### Items — MM.EXE file offset `0x19B2A`, 255 × 24 B (**confirmed**)

| Offset | Size | Field |
|--------|------|-------|
| +0x00 | 14 | name (uppercase, space-padded; e.g. `CLUB`, `BROAD SWORD +1`, `(USELESS ITEM)`) |
| +0x0E | 1 | disablements (class/alignment bitmask) |
| +0x0F | 1 | constBonus_id (stat id, or EquipMode specials 1/0xFF) |
| +0x10 | 1 | constBonus_value |
| +0x11 | 1 | tempBonus_id (0xFF = spell item) |
| +0x12 | 1 | tempBonus_value / spellId |
| +0x13 | 1 | maxCharges |
| +0x14 | 2 | cost `u16` **big-endian** (the one non-LE field — reading it LE gives cost×256) |
| +0x16 | 1 | damage |
| +0x17 | 1 | AC_Dmg (AC bonus for armor, extra damage for weapons) |

Category ranges: 1–60 weapon, 61–85 missile, 86–120 two-handed, 121–155
armor, 156–170 shield, 171–255 special/quest. → `data/items.json`.

### Monsters — MM.EXE file offset `0x1B312`, 195 × 32 B (**confirmed**)

| Offset | Size | Field |
|--------|------|-------|
| +0x00 | 15 | name — **15 bytes**, not 14: for 15-char names the 15th byte is the real last letter (e.g. `12 HEADED HYDRA`), otherwise a space pad. Reading 14+10 misaligns every record by one field |
| +0x0F | 1 | count |
| +0x10 | 1 | fleeThreshold |
| +0x11 | 1 | defaultHP |
| +0x12 | 1 | defaultAC |
| +0x13 | 1 | maxDamage |
| +0x14 | 1 | numberOfAttacks |
| +0x15 | 1 | speed |
| +0x16 | 2 | experience `u16` **little-endian** |
| +0x18 | 1 | loot |
| +0x19 | 1 | resistUndead |
| +0x1A | 1 | resistances |
| +0x1B | 1 | bonusOnTouch |
| +0x1C | 1 | specialAbility |
| +0x1D | 1 | specialThreshold |
| +0x1E | 1 | counterFlags |
| +0x1F | 1 | imgNum (MONPIX portrait index) |

→ `data/monsters.json`. `imgNum` links each monster to its MONPIX portrait.

### Spells — no binary table (**documented**)

MM1's spells are **code + string pool**, not a table: combat-effect strings
(`A FIERY EXPLOSION ENGULFS...`, `LIGHTNING BOLT` etc.) are confirmed in
MM.EXE's string pool (~0x12580–0x12780, 0x129E0–0x12A50), spell names are
scattered UI/effect strings, and the SP cost is a formula (spell level,
`spell_casting.cpp`). The canonical 47 cleric + 47 wizard + 32 monster spell
lists are transcribed in `scripts/mm1lib/mm1_spells.json` (ScummVM
`strings_en.yml` + `spells_monsters.cpp` SPELLS[] names) → `data/spells.json`.

## `.OVR` map-script overlays — container, selection fields, and text (**solved**; script *behavior* answered by ScummVM, raw 8086 opcodes still undecoded)

55 files, one per MAZEDATA screen, named by the slug table (SORPIGAL.OVR,
AREAA1.OVR, ...). `scripts/mm1lib/ovr.py` + `scripts/extract_mm1_ovr.py`
(`npm run mm1:ovr`).

### Container (**confirmed**, 55/55: `14 + code_sz + data_sz == file size`, 0 deviation)

| Offset | Size | Field |
|--------|------|-------|
| +0x00 | 2 | entry offset into the code segment (242 in all 55 files) |
| +0x02 | 2 | far-data constant 0xF48F (all files) |
| +0x04 | 2 | `code_sz` |
| +0x06 | 2 | far-data constant 0xC940 (all files; the code entry writes it — `MOV AX,0xC940` / `MOV [0x132],AX`) |
| +0x08 | 2 | `data_sz` |
| +0x0A | 2 | 0 |
| +0x0C | 2 | per-file value (candidate: overlay runtime load segment) |
| +0x0E | code_sz | **compiled 8086 machine code** — not a custom bytecode. Position-bound: references absolute game memory addresses (0xC973, 0x3C3A, ...), i.e. the game's fixed data layout (MM.RSM's territory) |
| +0x0E+code_sz | data_sz | data segment: selection tables + the map's text |

Independent cross-check, ScummVM `engines/mm/mm1/maps/map.cpp`
`Map::loadOverlay()`: reads and validates the exact same 14-byte header
(field names differ but offsets/sizes match byte-for-byte — `magicId` @
+0x00 must be `0xF2` = 242 decimal, `codePtr` @ +0x02 must be `0xF48F` **or**
`0xF47C`), then **skips the code segment outright** (`f.skip(codeSize)`)
and reads only the data segment into `_data[]`. Comment in the source:
*"Skip over code segment, since each map's code is going to be
reimplemented in C++"* — i.e. ScummVM never disassembled the 8086 either;
it re-derived each map's behavior independently (design docs / manual
replay) and hard-coded it in C++. `0xF47C` as an alternate +0x02 constant
is new information vs. our "0xF48F all files" note — not a contradiction
(our 55/55 GOG files are all `0xF48F`), just evidence ScummVM's engine also
targets a variant release where it differs.

### Data segment (**confirmed header fields**, via ScummVM `maps/map.h` `DataOffset` enum — a byte-exact independent decode of the same struct)

`Map::_data[]` in ScummVM is loaded directly from our `+0x0E+code_sz`
data-segment bytes (`loadOverlay()`: `_data.resize(dataSize); f.read(&_data[0], dataSize)`),
and `maps/map.h` names every field up to offset 50 via its `DataOffset` enum:

| Offset | Size | Field | ScummVM name |
|--------|------|-------|--------------|
| +0x00 | 1 | map id/code: towns 1–5, caves 6–14 (screen index+1), overland 0x81–0x94 (0x80\|(index−13)), dungeons 0x20–0x40 (doom 0x20, alamar 0x22, demon 0x40, astral 0x39) | `MAP_ID` |
| +0x01 | 1 | WALLPIX area table (1–3 → `maps.cpp` TILE_AREAS) | `MAP_1` |
| +0x02 | 6 | 3 × `u16` wall/lane ids (near/mid/far frustum lanes or overland horizons) | `MAP_2`/`MAP_4`/`MAP_6` |
| +0x08 | 3 | **north exit**: `u16` dest map id, 1-byte dest section | `MAP_NORTH_EXIT_ID`/`_SECTION` |
| +0x0B | 3 | **east exit**: `u16` dest map id, 1-byte dest section | `MAP_EAST_EXIT_ID`/`_SECTION` |
| +0x0E | 3 | **south exit**: `u16` dest map id, 1-byte dest section | `MAP_SOUTH_EXIT_ID`/`_SECTION` |
| +0x11 | 3 | **west exit**: `u16` dest map id, 1-byte dest section | `MAP_WEST_EXIT_ID`/`_SECTION` |
| +0x14–0x15 | 2 | unlabeled | `MAP_20`/`MAP_21` |
| +0x16 | 1 | flee threshold | `MAP_FLEE_THRESHOLD` |
| +0x17–0x18 | 2 | flee-to (x, y) | `MAP_FLEE_X`/`_Y` |
| +0x19 | 1 | surrender threshold | `MAP_SURRENDER_THRESHOLD` |
| +0x1A–0x1B | 2 | surrender-to (x, y) | `MAP_SURRENDER_X`/`_Y` |
| +0x1C | 1 | bribe threshold | `MAP_BRIBE_THRESHOLD` |
| +0x1D–0x21 | 5 | unlabeled | `MAP_29`..`MAP_33` |
| +0x22 | 1 | max monsters (encounter cap) | `MAP_MAX_MONSTERS` |
| +0x23–0x24 | 2 | sector1/sector2 (overland grid coords) | `MAP_SECTOR1`/`_2` |
| +0x25 | 1 | map type | `MAP_TYPE` |
| +0x26 | 1 | dispel threshold | `MAP_DISPEL_THRESHOLD` |
| +0x27 | 5 | surface exit: `u16` id, section, x, y | `MAP_SURFACE_ID`/`_SECTION`/`_X`/`_Y` |
| +0x2C–0x2D | 2 | unlabeled | `MAP_44`/`MAP_45` |
| +0x2E | 1 | state flags | `MAP_FLAGS` |
| +0x2F | 1 | unlabeled | `MAP_47` |
| +0x30 | 1 | trap threshold | `MAP_TRAP_THRESHOLD` |
| +0x31 | 1 | unlabeled | `MAP_49` |
| +0x32 (=51) | N | **special-cell map-offset table** (see below) | — |
| +0x32+N (≈74/75) | N | **special-cell direction-mask table** (see below) | — |
| after | … | further per-map data, then the map's text strings (null-separated, `\r\n` line breaks) | — |

> **Correction vs. earlier text**: `+0x08 | 12 | 4 × 3-byte event records
> (x, y, kind)` was a guess. ScummVM's `DataOffset` enum shows those 12
> bytes are actually the **4-directional exit table** (N/E/S/W, each a
> `u16` destination map id + 1-byte destination section) — the exact
> `(id, section)` pair pattern already independently observed in
> `Maps::step()` (`mm/mm1/maps/maps.cpp`), which reads `MAP_NORTH_EXIT_ID`
> etc. when the party walks off a map edge.

**Special-cell dispatch (the actual "map script" mechanism, confirmed
identical in every sampled map — Map00/Map05/Map34/Map49/Map54):** each
map keeps a small fixed table of "special" cells starting at data-segment
offset 51: one map-offset byte per cell (offset 51+i) and one direction
bitmask byte per cell later in the table (`DIRMASK_N/E/S/W` =
`0xC0/0x30/0xC/0x03`, offset 74 or 75+i depending on the map's special-cell
count). `Map::special()` (each `mapNN.cpp`'s override) scans that table
for `party_offset == special_offset[i]`; if the party is also facing the
cell's required direction it calls a per-map `specialNN()` handler
(door/sign/exit/statue/plot logic); every other cell — the overwhelming
majority of the 256 — falls through to a **generic monster encounter roll**
(`g_globals->_encounters.execute()`). This *is* what the compiled 8086
code segment does per map; ScummVM's C++ is a clean-room behavioral
reimplementation of it, not a decode of the actual opcodes.

Wall/lane resolution cross-checks: towns → WALLPIX entries 0–2, caves → 3–5,
overland → 6–13 with **AREAA1 = entries 6/13/12 (wall07/wall14/wall13),
byte-for-byte matching Vairn/MM2 doc 24**; dungeons via area table 3.
→ `data/ovr.json` (per-map header/fields/events) and `data/ovr-text.json`
(**387 text strings** — the actual in-game dialogues/descriptions per screen,
e.g. Sorpigal's "EULARDS FINE FOODS", "THE INN OF SORPIGAL").

### Code-segment semantics — answered-by-ScummVM (behavior), not by disassembly

**Verdict:** the open question "what do the `.OVR` code segments do —
encounters, doors, exits, text dispatch" is **answered at the behavioral
level** by ScummVM's `engines/mm/mm1/maps/mapNN.cpp` (one C++ file per
map, `map00.cpp`..`map54.cpp`, 55 files — `map55.cpp` is a ScummVM-only
"Secret ScummVM" easter-egg map with no `.OVR` counterpart). It is **not**
answered at the opcode level: ScummVM's own loader explicitly skips the
code segment (see container note above) and reimplements behavior from
other sources, so there is no disassembly or opcode table to import —
only ground-truth *behavior*, which is what the open TODO item actually
needed (encounter/door/exit/text-dispatch semantics), just not via
disassembly.

**`.OVR` file ↔ `mapNN.cpp` mapping is solved and complete, not just
sampled:** each `MapNN` constructor passes the exact slug string as its
overlay filename base (used by `loadOverlay()` as `<name>.ovr`), and
`Maps::Maps()` (`maps.cpp`) constructs `Map00()..Map54()` in exactly
MAZEDATA/slug-table order. Confirmed directly:

| Index | Constructor | Slug in our table |
|-------|-------------|--------------------|
| 0 | `Map00() : MapTown(0, "sorpigal", 0x604, 1)` | `sorpigal` |
| 1 | `Map01() : MapTown(1, "portsmit", 0xc03, 1, "Portsmith")` | `portsmit` |
| 5 | `Map05() : Map(5, "cave1", 0xa11, 1)` | `cave1` |
| 34 | `Map34() : Map(34, "doom", 0x706, 3, "Castle Doom")` | `doom` |
| 49 | `Map49() : Map(49, "alamar", 0xb07, 3, "Castle Alamar")` | `alamar` |
| 54 | `Map54() : Map(54, "astral", 0xb1a, 3, "The Astral Plane")` | `astral` |

i.e. `mapNN.cpp` for `NN = 00..54` is `screens[NN]` in our slug table,
**no MM.RSM or id-byte cross-referencing needed** — the future-pass idea
of matching via the data-segment `MAP_ID` byte + `maps.cpp` town-id
constants turned out to be unnecessary; the literal filename string
already gives a complete 1:1 mapping.

**Concrete examples of what a map's compiled routine does:**

- **Locked door, `map34.cpp` (Doom) `special07()`:** `if
  (g_globals->_party.hasItem(GOLD_KEY_ID)) { checkPartyDead(); } else {
  send(SoundMessage(STRING["maps.map34.door"])); g_maps->_mapPos.y--;
  updateGame(); }` — classic gated-door check: has the required key →
  proceed (just re-check death state); otherwise show a door message and
  bounce the party back one tile.
- **Overland exit, `map34.cpp` `special01()`:** `visitedExit();
  send(SoundMessage(STRING["maps.passage_outside1"], []() {
  g_maps->_mapPos = Common::Point(7, 15); g_maps->changeMap(0xf01, 2); }));`
  — mark the cell visited-as-exit, show a transition message, then jump to
  map id `0xf01` section 2 at position (7,15).
- **Flag-gated encounter, `map34.cpp` `special20()`:** `if (_data[VAL1])
  { g_maps->clearSpecial(); g_globals->_encounters.execute(); } else {
  none160(); }` — an encounter that only fires if a data-segment flag
  (set earlier by `special17()`, a "box" event) was previously written.
- **Sign / static text, `map00.cpp` (Sorpigal) `special01()`:** dispatches
  on the party's facing direction (`DIRMASK_E`/`DIRMASK_W`/default) to
  show one of three different shop-sign strings at the same cell.
- **Default case, every map:** `g_maps->clearSpecial();
  g_globals->_encounters.execute();` — any cell not in the special-cell
  table just rolls a monster encounter.

**Genuinely still open:** the raw 8086 opcode bytes of the `.OVR` code
segment have not been disassembled or mapped instruction-by-instruction
to these behaviors — what's answered is "what each map's script *does*"
(via a trusted clean-room reimplementation), not "which bytes at which
`.OVR` code-segment offset implement which special-cell handler." Closing
that opcode-level gap would still require hand disassembly against
MM.RSM/the exe's overlay loader, which remains unattempted (and is a much
lower-value exercise now that behavior is independently known).

## Still open (not part of this pass)

- `FLOORPIX.DTA`/`OBJPIX.DTA` — absent from this GOG install.
- A live-game (DOSBox) screenshot comparison for the WALLPIX/MONPIX/title
  renders would be a stronger visual oracle than the structural checks
  above — not yet performed (no DOSBox in this environment).
- `MM.RSM` address-field encoding — observed but not fully decoded; checked
  against both external oracles (Vairn/MM2, ScummVM), neither has it (see
  § "MM.RSM" above). Would need manual analysis.
- `.OVR` code segment, opcode level — script *behavior* is answered by
  ScummVM's `mapNN.cpp` reimplementation (see § ".OVR map-script overlays"
  above), but the raw 8086 bytes are still undisassembled and unmapped to
  that behavior instruction-by-instruction.

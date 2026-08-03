# Black Crypt — Windows VGA Data Structures

## Overview

Black Crypt (1992, Raven Software / Electronic Arts) was ported to Windows
by Rick Johnson starting October 21, 1995, using DirectX 3.0 (GameSDK). The
Windows version uses DirectDraw for graphics and DirectSound for audio.

The demo contains a subset of the full game's data, with a resource archive
format (`clipper.clp`) that stores images, palettes, and sound effects in a
structured container.

**Note:** The data files live in `data/blackcrypt/dosvga/` but the executable
is a PE32 Windows GUI application (not DOS). It requires DirectX 3.0+ and
runs on Windows 95/98/NT 4.0.

---

## File Inventory

| File          | Size       | Description                            |
|---------------|------------|----------------------------------------|
| `crypt.exe`   | 253,952 B  | Windows PE32 GUI executable (DirectX 3.0) |
| `clipper.clp` | 1,151,267 B| Resource archive (images, palettes, sounds) |
| `maindung.gam`| 15,099 B   | Dungeon/map data (demo subset)         |
| `Config.dat`  | 14 B       | Configuration file                     |

---

## clipper.clp — Resource Archive

### Format

The archive uses a simple directory + raw data layout:

```
[2 bytes]   Entry count (uint16 LE) → 816
[816 × 56 bytes]  Directory entries
[Raw data...]
```

### Directory Entry (56 bytes)

| Offset | Size | Type    | Description                              |
|--------|------|---------|------------------------------------------|
| 0x00   | 40   | char[]  | Null-terminated name string              |
| 0x28   | 1    | uint8   | Entry type (see below)                   |
| 0x2A   | 4    | uint32  | Data size (bytes)                        |
| 0x2E   | 4    | uint32  | Data offset (from start of file)         |
| 0x34   | 2    | uint16  | Width (images only)                      |
| 0x36   | 2    | uint16  | Height (images only)                     |

### Entry Types

| Type Code | Count | Description                               |
|-----------|-------|-------------------------------------------|
| 0x01      | 34    | Markers (separator/navigation entries)    |
| 0x02      | 751   | Images (raw 8-bit indexed, no compression)|
| 0x03      | 7     | Palettes (256 × 3 bytes RGB, 768 bytes)   |
| 0x04      | 22    | Sound effects (raw IFF or WAV format)     |
| 0x05      | 2     | Speed effects (unknown format)            |

### Image Format

Images are stored as raw indexed pixel data:
- 1 byte per pixel (8-bit indexed)
- Dimensions vary per entry (width/height stored in directory)
- No compression — raw pixel data
- Palette is determined by image name context (see `pick_palette()` in `scripts/extract_clipper.py`)
- Transparency uses two known background colors: brown (95,67,51 = palette ~idx 33)
  and cyan (0,255,255). These are detected and made fully transparent.
- 751 images, 0 remaining cyan pixels. Verification: `scripts/extract_clipper.py`

### Palette Format

Each palette is 768 bytes: 256 entries × 3 bytes (R, G, B).
Seven palette variants:

| Palette Name       | Usage                            |
|--------------------|----------------------------------|
| Palette             | Default/dungeon rendering        |
| Automap Palette     | Automap view                     |
| Character Gen Palette | Character generation screen    |
| Options Palette     | Options/UI screens               |
| Title Palette       | Title screen                     |
| Title Palette 2     | Title screen variant             |
| Title Palette 3     | Title screen variant             |

### Extraction Script

```bash
python3 scripts/extract_clipper.py
```

Output: `data/blackcrypt/extracted/clipper/`
- `images/` — 745 PNG files (name matches direction/size from entry name)
- `palettes/` — 7 `.pal` raw palette files + PNG palette swatches
- `sounds/` — 22 sound files (`.wav`, `.iff`, or `.raw`)

Packed atlases (the pipeline's actual output, at
`public/assets/blackcrypt/dosvga/sprites/*.png`) group entries by
`group_for()` in `scripts/extract_clipper.py`: name-keyword matches first
(`dungeon`, `monsters`, `ui`), then unmatched **named** entries become
`items`, and unnamed (empty-name or purely-numeric) entries fall through to
a **dimension-based** classification before landing in `misc` as a last
resort — see the next section.

#### Item icons and other unnamed entries (corrected classification)

> **Correction:** this project previously dumped every image entry with no
> name string straight into a single `misc` bucket — 505 of the 751 images
> (67%), reported without further comment. That bucket was never actually
> "uncategorizable junk": clipper.clp simply gives these entries **no name
> field at all** (empty string), so the keyword-matching classifier could
> never have sorted them regardless of what they show. Rendering every
> unnamed entry grouped by its own `(width, height)` — the only structural
> signal clipper.clp's own directory still gives these entries — shows each
> size cluster is visually one coherent category:
>
> | Size | Count | Content (visually confirmed) | New bucket |
> |------|-------|-------------------------------|------------|
> | 24×24 | 180 | Weapon/armor/food/jewelry/container icons — same visual language as the 48 explicitly-named `items` entries (Sword, Dagger, Potion, Helmet, ...), just missing name strings | `items` |
> | 16×16 | 73 | Coloured starburst/orb icons — spell effects, not equipment | new `spell-effects` bucket |
> | 32×29 | 19 | **Chest armor icons** (ornate breastplates/chainmail/scale patterns) — equipment, not decorative heraldry | `items` |
> | various (16×11, 16×15, 8×14, 16×2–16×10, 32×5–32×8, ...) | 233 remaining | Still visually plausible small item/key/UI fragments on a spot check, but not confidently size-clustered into one category each | stays in `misc` |
>
> This moved 272 of the 505 previously-dumped entries into their real
> categories, none of it code-traced (no source in `crypt.exe` was consulted
> — this is a purely visual/structural reclassification of the same archive
> the game already ships and the format doc already fully decodes). `items`
> is now **48 (named) + 180 (24×24) + 19 (32×29) = 247** total. The
> remaining 233 in `misc` were not further split in this pass — some still
> look like items or key icons on inspection, they just didn't cluster
> cleanly enough by size alone to commit to a label; a follow-up spot check
> on the `spell-effects` bucket (73 entries, all clearly glowing
> particle-burst/orb graphics) and a skim of the remaining `misc` entries
> found nothing else that looked like a mislabeled equipment subtype.
>
> **Correction:** the 32×29 entries were first classified as a separate
> `heraldry` bucket ("coloured heraldry/shield-crest emblems") — wrong. On a
> closer look they're plainly chest armor art (breastplate/chainmail/scale
> patterns in the same style as the 24×24 armor icons, just larger), so
> they've been folded into `items` rather than kept as their own category.
> There is no `heraldry` bucket in the current pipeline output.

#### Amiga item-name cross-reference (count corroboration, not a 1:1 mapping)

The Amiga `bcdft` overlay's decompressed data (`docs/blackcrypt/amiga/data-structure.md`'s
`bcdft` section) carries a clean null-terminated item-name string table at
decompressed offset **115,972–121,318**, immediately before the string
stream turns into player-facing dialogue text (`CLICK ON THE PERSON YOU
WANT TO ...`). Extracting every string in that range gives **254 distinct
item names** ("GAUNTLETS", "BELT", "OGRE BLADE", "POTION OF HEALING",
"IDOL OF TEMIN", ... down to "SYMBOL OF PIETY").

**254 Amiga item names vs. 247 DOS item icons** (48 named + 180 reclassified
24×24 icons + 19 reclassified 32×29 armor icons) is the same order of
magnitude and a plausible match for the same underlying item catalog — the
247/254 gap barely moved with the heraldry→armor correction (228→247, still
7 short of 254), which if anything makes the two counts line up slightly
better. There is still no shared index
or ID field connecting `clipper.clp`'s entry order to `bcdft`'s string
order, so this is **corroborating evidence that both counts describe
roughly the same item roster, not a verified index-for-index name↔icon
mapping**. Building an exact mapping would need either a DOS-side name table
analogous to the Amiga one (not found — clipper.clp's unnamed image entries
carry no text at all) or a shared numeric item ID cross-referenced against
both the Amiga `bcdfs` item bytecode's `gfxNumber` field and something
DOS-side that hasn't been located. The DOS and Amiga
item icon sets are visually similar in spirit (both draw the same weapons/
armor/potions) but are separately-authored, platform-native art, not a
shared asset.

> **Correction:** this paragraph used to add "This does **not** locate the
> Amiga's own item *sprite* graphics (still open, see `AGENTS.md`)". Both
> Amiga item-graphics classes are now solved — the 180 inventory icons
> (`bcdfa+0x1B5B3` / `+0x2FE5C`) and the 147 dungeon-floor sprites
> (`bcdfa+0x270C4`, 49 items × 3 view depths). See
> `docs/blackcrypt/amiga/data-structure.md`.
>
> Relatedly, the "233 remaining `misc` entries … the four large size clusters
> are **door graphics at four view depths**" claim above is now doubtful:
> three of those four clusters (16×11, 16×15, 16×20) are exactly the Amiga's
> confirmed *wall-decoration* sizes, and 105 of the Amiga's 147 floor-sprite
> sizes also occur in this same pool. The bucket has **not** been
> re-classified here — this is a flag, not a fix.

> **Correction — the Amiga floor-item bank's DOS equivalent was never in
> `misc` at all.** `clipper.clp`'s own directory carries an explicit
> `Start Floor Items` / `End Floor Items` marker pair (entry type `0x01`,
> indices **651** and **799**), delimiting **exactly 147 entries** (652–798):
> 49 named groups (`Hammer`, `Belt`, `Apple`, … — every 3rd entry) × 3
> unnamed depth variants each, monotonically non-increasing in width/height
> per group (near → far) — the same shape as the Amiga bank, entry for
> entry. Matched against the Amiga descriptor table at the *same* group
> index: **147/147 (w, h) pairs exact, 0 deviation**, and per-pixel
> silhouette agreement of **35,869/35,872 (99.992%)** across the whole bank.
> This gives a **confirmed, exhaustive** name for all 49 Amiga floor-item
> groups — see `docs/blackcrypt/amiga/data-structure.md`, "Dungeon-floor item
> sprites" § "DOS cross-check and group naming", and
> `scripts/verify_floor_item_dos_names.py`.
>
> The current DOS pipeline (`extract_clipper.py`'s `group_for()`) does not
> single out this block — it has no `floor items` keyword bucket, so these
> 147 entries currently fall through into `items` (the 49 named ones) and
> `misc` (the 98 unnamed depth-2/3 variants) alongside unrelated content.
> That bucketing was not changed as part of this finding (out of scope: the
> Amiga-side naming question is answered either way); a follow-up could add
> a `floor-items` bucket driven by the `Start Floor Items`/`End Floor Items`
> markers the same way `scripts/verify_floor_item_dos_names.py` already
> locates them.

> **Correction — the follow-up above is done, and the "flag, not a fix" note
> two blocks up is now a fix.** `extract_clipper.py` now resolves
> `MARKER_GROUPS` — index ranges bounded by `clipper.clp`'s own type-`0x01`
> `Start X`/`End X` markers — **before** the keyword/dimension classifiers,
> for three brackets:
>
> | Bracket | Entries | New bucket | Evidence |
> |---------|---------|------------|----------|
> | `Start Keys` … `End Keys` (313–341) | 29, all 8×14, unnamed | `keys` | **Confirmed** — byte-identical to the Amiga `bcdfa` key-icon bank (`bclib.bcdfa.key_icon_sprites`, `SLOT_TEXT_RESOURCE` chunk offset `0x7CA0`): 3,248/3,248 opaque px agree (100.000%), 29/29 frames individually perfect. See `docs/blackcrypt/amiga/data-structure.md`, "the 29 key icons" |
> | `Start Key Holes` … `End Key Holes` (344–430) | 87 = 29 × 3 depths, 16×20/16×15/16×11, unnamed | `key-holes` | **Confirmed** — this is exactly the flag two blocks up, now checked pixel-for-pixel rather than by size alone: a greyscale correlation of every DOS entry against every Amiga `bcdfb`–`bcdfn` wall-decoration frame of the same depth finds a match ≥ 0.95 for **29/29** DOS entries, at **all three depths** independently (one full triple spot-checked at 0.9998/0.9964/0.9879 near/mid/far). Several Amiga (map, decoration) pairs share the same art, which is why more than 29 Amiga frames correlate in total — the wall-decoration bank's contents (lock plates, a red-cross panel, a gargoyle face) *are* keyhole surrounds; DOS names the category outright |
> | `Start Floor Items` … `End Floor Items` (652–798) | 147 = 49 groups × 3 depths, 49 named + 98 unnamed | `floor-items` | Already **confirmed** two blocks up — this only changes the *bucket*, uniting all 147 (previously split 49/`items` + 98/`misc`) the way the Amiga side's own `sprites/floor-items.*` already does |
>
> This drops the `misc` bucket from 233 to **19** entries (11 × 8×7 inside
> `Start`/`End CG Numbers`, no Amiga cross-reference attempted; 8 unnamed
> depth-2/3 `Sword`/`Hammer` variants inside `Start`/`End Throwing Items` —
> **no Amiga counterpart exists** for these two weapons, since the Amiga
> throwing-items bank (`bcdfa` container-directory entry 12) is independently
> confirmed closed at exactly 2 weapons × 3 depths × 2 facings with 0 spare
> bytes; see `docs/blackcrypt/amiga/data-structure.md`'s "`0x300C2`-EOF
> tail"). `sprites/misc.{png,json}` now has 19 frames, `sprites/keys.*` 29,
> `sprites/key-holes.*` 87, `sprites/floor-items.*` 147, `sprites/items.*`
> 205 (was 247 — the 49 floor-item names moved out, plus a handful of
> keyword collisions like `Arrow` no longer landing in `ui`).
>
> The `Start Throwing Items` bracket (433–444, 12 entries) was **not**
> given its own bucket — only 4 of its 12 entries are named (`Arrow`,
> `Dagger`, `Sword`, `Hammer`, the near-depth of each weapon only, same
> "name the first of 3" convention), and this doc previously implied all six
> Arrow/Dagger *depth* entries were individually named; they are not — see
> `docs/blackcrypt/amiga/data-structure.md`'s "`0x300C2`-EOF tail" §
> "Verification" for the corrected accounting.

#### The marker brackets classify the archive completely — `misc` is now empty

> **Correction — supersedes every "not confidently classified", "stays in
> `misc`", "confirmed by eye, not from any clipper.clp metadata" and
> "dimension-based classification" statement above.** The dimension
> clustering was never needed. `clipper.clp`'s 34 type-`0x01` marker entries
> form 17 `Start X` / `End X` brackets, and `crypt.exe` looks those bracket
> names up **by string** at runtime (`strings crypt.exe` → `Start Items`,
> `Start Chest`, `Start Throwing Items`, `Start CG Numbers`, …), so they are
> the game's own resource taxonomy, not incidental separators.
>
> Full bracket census (`index` columns are directory entry indices; the
> markers themselves are the bounds and are not counted):
>
> | Bracket | Range | Entries | Type | Geometry | Named |
> |---------|-------|---------|------|----------|-------|
> | Level Specifics | 77–78 | 0 | — | — | — |
> | Hi Spell Levels | 136–142 | 5 | image | all 16×11 | 5 |
> | Spell Book Numbers | 148–154 | 5 | image | all 16×8 | 5 |
> | Attack Sounds | 168–171 | 2 | sound | — | 0 |
> | Movement Sounds | 172–179 | 6 | sound | — | 0 |
> | System Sounds | 180–195 | 14 | sound | — | 0 |
> | **CG Numbers** | 208–220 | **11** | image | all 8×7 | 0 |
> | Speed Graphics | 227–301 | 73 | image | all 16×16 | 0 |
> | Faces | 302–311 | 8 | image | 4 × 111×90, 4 × 31×24 | 8 |
> | Keys | 312–342 | 29 | image | all 8×14 | 0 |
> | Key Holes | 343–431 | 87 | image | 29 each of 16×20 / 16×15 / 16×11 | 0 |
> | **Throwing Items** | 432–445 | **12** | image | 4 weapons × 3 depths | 4 |
> | Items | 446–622 | 175 | image | all 24×24 | 0 |
> | Misc | 623–629 | 5 | image | all 24×24 | 0 |
> | Chest | 630–650 | 19 | image | all 32×29 | 0 |
> | Floor Items | 651–799 | 147 | image | 49 groups × 3 depths | 49 |
> | Monsters | 800–815 | 14 | image | mixed | 14 |
>
> **Zero-deviation invariant:** every one of the **505/505** image entries
> `clipper.clp` gives no name to falls inside one of these brackets. There is
> no unnamed residue anywhere in the archive, so `group_for()`'s
> dimension fallback is now unreachable and `sprites/misc.*` no longer
> exists — the `misc` bucket went 505 → 233 → 19 → **0**.
>
> Three brackets independently confirm reclassifications this doc had
> previously made **by eye only**, each matching its size cluster exactly and
> containing nothing else:
>
> | Earlier visual call | Bracket that confirms it |
> |---------------------|--------------------------|
> | "24×24 (180) = item icons" → `items` | `Start Items` (175) + `Start Misc` (5) = **180**, all 24×24 |
> | "16×16 (73) = spell-effect orbs" → `spell-effects` | `Start Speed Graphics` = **73**, all 16×16 (the DOS name for the same SPEED effects engine whose script data is `bcdfa` entry 6 / `"Speed Effects"`) |
> | "32×29 (19) = chest armor, **not** heraldry" → `items` | `Start Chest` = **19**, all 32×29. `Chest` is the equipment slot — the heraldry→armor correction was right |
>
> The only 24×24 / 16×16 / 32×29 entries outside those brackets are seven
> explicitly-**named** ones the keyword classifier already handles
> (`Ghost`, `Weapon Hit`, `Mouse Arrow`, `Normal Button 1 In`/`Out`,
> `Down Arrow Left`/`Right`).

##### Residue 1 — `Start CG Numbers` (11 × 8×7) = the chargen numeral font, **confirmed byte-exact**

The 11 unnamed 8×7 entries at indices **209–219** are the
character-generation numeral font, and they are **byte-identical to the
Amiga's**. The Amiga bank is `bcdfo` `0xF286`–`0xF622` (11 glyphs × 16×7 ×
7 planes, 84 B each) with a *shared* 1-bit mask at `0xF278`; that mask is
`11111111 00000000` on all 7 rows, so the Amiga glyph only ever occupies its
**left 8 columns**. Cropping there reproduces the DOS entry's palette
indices exactly.

| Check | Result | Oracle |
|-------|--------|--------|
| Palette-index equality, DOS 8×7 vs Amiga 16×7 cropped to `x < 8` | **616/616 px (100.000%)**, 11/11 glyphs individually perfect | Amiga `bcdfo` numeral bank |
| Ink registers | identical on both platforms — 27 / 28 (+ a single 29 px in glyph `3`) on background 30 | — |
| Slot roster | slot 0 = **blank** glyph (all 56 px = index 30), slots 1–10 = digits `0`–`9` | matches the Amiga bank's documented "one blank slot + digits `0`–`9`" |

Routed to the `ui` atlas, next to `CG Font` / `CG Options` / `CG Guild N`.

> **Palette bug fixed while confirming this.** These entries are unnamed, so
> `pick_palette()` fell through to the default `Palette`, where registers
> 27–30 are a muddy brown ramp (83,67,35 → 131,115,83); the glyphs are
> authored against `Character Gen Palette`, where the same ramp is orange
> (192,64,0 → 240,112,48). `extract_clipper.py` now carries a
> `MARKER_PALETTES` table (bracket → palette) resolved before the name hints,
> and `pick_palette()` matches a `cg ` prefix ahead of its `options` rule so
> `CG Options` stops taking the standalone options-screen palette.
>
> Corroboration found in passing: **DOS `Character Gen Palette` *is* the
> Amiga chargen palette**, re-scaled. Both store the same 4-bit component
> `n`; Amiga renders it `n × 17`, DOS `n × 16` — **94/96 components of base
> registers 0–31 (97.9%)**, the sole content difference being register 19
> (Amiga dark green `(0,34,0)` vs DOS yellow `(240,208,0)`). Registers 32–63
> diverge only by EHB half-bright rounding (Amiga `7×17 = 119` vs DOS
> `15×16/2 = 120`).

##### Residue 2 — `Start Throwing Items` (12 entries) = four in-flight projectiles × 3 depths

> **Premise correction:** the 8 unnamed entries here are **not** "depth-2/3
> variants of `Sword`/`Hammer`". They are the depth-2 and depth-3 entries of
> **all four** weapons in the bracket — the named entry of each triple is
> only its near depth, the archive's usual "name the first of N" convention.
> The four *named* siblings were never in `misc` at all: `Arrow` was landing
> in `ui` (keyword `arrow`) and `Dagger`/`Sword`/`Hammer` in `items`, so the
> bracket was scattered across three buckets.

| # | Index | Name | Near | Mid | Far |
|---|-------|------|------|-----|-----|
| 0 | 433–435 | `Arrow` | 16×11 | 16×8 | 16×5 |
| 1 | 436–438 | `Dagger` | 16×7 | 16×5 | 16×3 |
| 2 | 439–441 | `Sword` | 32×15 | 16×10 | 15×7 |
| 3 | 442–444 | `Hammer` | 16×13 | 16×11 | 16×8 |

All twelve are compact, edge-on, right-pointing **projectile** sprites
(arrowhead + fletching; blade + crossguard; hammer head + haft), shrinking
monotonically in both axes near → far. They are **not** extra depths of the
same weapons' `floor-items` sprites, which are a different, much wider art
set drawn lying on the ground (floor `Sword` is 80×9 vs thrown 32×15; floor
`Hammer` 48×10 vs thrown 16×13; floor `Arrow` 32×6 vs thrown 16×11), and not
combat/animation frames — there is exactly one frame per depth.

**Verification.** The first six shapes are the DOS counterpart of the Amiga
`bcdfa` container entry 12 bank (`SLOT_THROWING_ITEMS`, `0x300C2`):
silhouette (DOS `!= 33` vs the Amiga record's 1-bit mask plane) agrees on
**624/624 px (100.000%)** across all 6 shapes — `arrow_near` 176/176,
`arrow_mid` 128/128, `arrow_far` 80/80, `dagger_near` 112/112, `dagger_mid`
80/80, `dagger_far` 48/48, and the opaque-pixel counts match exactly
(63/35/18 and 56/15/11). This independently confirms the depth ordering and
that 434/435/437/438 really are the mid/far depths of their named
predecessors — extending the earlier check, which had only covered the two
**named** near-depth entries.

**`Sword` and `Hammer` are DOS-exclusive projectiles — a real content
difference, not a decode error.** The Amiga bank is closed at two weapons on
three independent counts: its 12 descriptors tile the 1,092-byte chunk with
zero gap and zero overlap; the flight animator (S_1 `+0x21A78`) tests weapon
type with a **two-way** `TST.W D0` / `BNE`; and its hot-spot table
(S_1 `+0x21C6C`) is 12 B per weapon with exactly **two** rows. Four weapons
would need 48 B there and a 4-way dispatch. So the Windows port added
throwable Sword and Hammer art that the Amiga original never had. (The Amiga
also stores each shape twice — facing 0 and its exact horizontal mirror —
where DOS stores one facing and presumably mirrors at blit time: 2 × 3 × 2 =
12 Amiga records vs 4 × 3 × 1 = 12 DOS entries, the same count for different
reasons. Reading "12 = 12" as "same bank" is the trap this bracket sets.)

Routed to a `throwing-items` bucket, mirroring the Amiga side's own
`sprites/throwing-items.*`.

##### Derived frame labels

Both brackets' unnamed entries would otherwise land in the atlases as
`434_entry_0434`, discarding everything above. `extract_clipper.py`'s
`derived_labels()` now names them from the confirmed findings:
`433_Arrow_near` … `444_Hammer_far` (the near name propagating forward with a
`near`/`mid`/`far` suffix, which is exactly the archive's "name the first of
N" convention read in reverse) and `209_CG Number blank`, `210_CG Number 0` …
`219_CG Number 9`. The `Start Floor Items` bracket follows the same
convention for its 98 unnamed depth entries and could be labelled the same
way; it was left alone here to avoid churning an already-confirmed atlas.

---

## maindung.gam — Dungeon Data

### Format

The Windows dungeon format is **structurally identical** to the Amiga `bcdfs` format,
with the only difference being CPU endianness (little-endian on Windows vs big-endian
on Amiga).

**Confirmed identical:**
- Offset table: 13 slots, same layout as the Amiga's 13-map table
- Map 1 header: `00 00 00 00 1d 00 39` — byte-identical between platforms
- Square data: stored as native-endian 32-bit values

> **Correction — the demo ships exactly one map, not two.** The offset
> table entry for "map 2" (`0x00003AC7`) is a dangling leftover copied
> verbatim from the full game's table — it is numerically identical to the
> Amiga `bcdfs` map-2 offset, but no map-2 data exists in the file: `Map
> 1's body ends at 11,099; + 3,948 B tail padding = 15,047 = 0x3AC7`, which
> is exactly the map-2 offset, and `15,099 (file size) − 15,047 = 52` —
> the file simply stops 52 bytes after that offset, the length of one
> zeroed offset-table block. `crypt.exe`'s own embedded text — "Demo
> contains only the first dungeon map (two playable levels)" — is accurate
> once read correctly: **map 1** on its own already spans **two**
> manual-numbered dungeon *levels* (1 and 2), per this project's
> map↔dungeon-level correspondence established on the Amiga side (see
> `amiga/data-structure.md` § "Map ↔ dungeon-level mapping"). "Two
> playable levels" describes map 1's own content, not "maps 1 and 2."
> Maps 3–13 all have offset `0x00000000` and are genuinely absent.

### Square Format (4 bytes, same as Amiga)

```
Byte 0: [type:4b][0xF]
Byte 1: [0xF][level:4b]
Byte 2: [wall_flags:4b][uniq_hi:4b]
Byte 3: [uniq_lo:8b]
```

### Endianness Difference

A square `0x00001FF1` is stored as:
- Amiga (big-endian): `00 00 1F F1`
- Windows (little-endian): `F1 1F 00 00`

### Record byte-swap is not a blanket word-swap — **confirmed, field-dependent**

Cross-checking every byte span of the Amiga's map-1 walk (`scripts/bclib/bcdfs.py`)
against the demo's `maindung.gam` at the same file offsets: **1,530/1,530
squares** are an exact 4-byte reversal (mechanical), and the 5-byte map
header, all row headers, and all 45 action records (8 B each) are
**byte-identical, no swap at all**. The only mismatches are in the 20-byte
item/monster/structure records (225 of them in map 1), and the swap is a
**per-field 16-bit swap whose field boundaries depend on the record's
`itemType` byte** (`+0x05`) — not a fixed pattern applicable to every
record kind. Example, a monster record: `80 b3 | 02 75 | f0 84 …` (Amiga)
→ `b3 80 | 02 75 | f0 84 …` (DOS) — only `+0x00/+0x01` swaps (it's a
`word`); `+0x02/+0x03` do not, because those are two separate bytes on
both platforms. **Consequence: on DOS the monster marker `0x80` lives at
byte `+0x01` of the record, not `+0x00`.** See
`docs/blackcrypt/dos/full-game-restoration-plan.md` § "Phase 2" for the
full per-itemType field map (39 of 48 record kinds have a byte-exact
oracle from map 1 alone; 9 kinds — `0x00`, `0x0B` Boots, `0x1A` Amulet,
`0x1B` Shirt, `0x1C` Pants, `0x27` Other/Skull, `0x2B` Panel Item, `0x2C`
Idol, `0x2F` Statue — never appear in map 1 and have no oracle yet).

> **Correction — "field boundaries depend on `itemType`" was the right
> observation from the wrong lens; the real rule is itemType-*independent*,
> and a working converter now exists (`scripts/bclib/maindung.py`, verified
> below).** Reframing "which itemType maps to which boundary" as "which
> single boundary pattern is consistent with every observed itemType"
> collapses the problem: an exhaustive search over every way to partition
> the 13-byte itemType-specific span (`+0x07..+0x13`) into runs of 1 or 2
> bytes, checked against every map-1 example of each type, finds that
> composition **`(1,2,2,2,2,2,2)`** — one unswapped byte at `+0x07`, then
> six swapped 16-bit words at `+0x08/0x0A/0x0C/0x0E/0x10/0x12` — is
> consistent with **all 39** itemType values observed in map 1 with zero
> counterexamples, and is the *unique* fit for the 5 types with enough
> instances to fully disambiguate it (`0x04` Spell Scroll n=7, `0x05`
> Potion n=6, `0x12` Stairs/Teleport n=16, `0x13` Container n=7, `0x23`
> Chest n=3). No type excludes it. This is exactly what a mechanical,
> semantics-oblivious porting tool would produce: it re-encodes the record
> shape, not the record's meaning.
>
> The only thing that genuinely varies is whether the record is a
> **monster** (byte `+0x00` bit `0x80` on the Amiga source), not what its
> itemType is:
>
> | Offset | Item/structure record | Monster *first* record |
> |---|---|---|
> | `+0x00/+0x01` | word, swapped (gfxNumber) | word, swapped (gfxNumber / monster marker) |
> | `+0x02/+0x03` | word, swapped (name reference) | **two independent bytes, not swapped** (hit-chance, door/attack-speed nibbles) |
> | `+0x04`..`+0x06` | 3 unswapped bytes | 3 unswapped bytes (`0xF0` marker, move-speed nibbles, attack-method) |
> | `+0x07`..`+0x13` | composition `(1,2,2,2,2,2,2)` | **same** composition `(1,2,2,2,2,2,2)` |
>
> Confirmed globally: applying `(1,2,2,2,2,2,2)` plus the swapped `+0x00/+0x01`
> and *unconditionally*-swapped `+0x02/+0x03` to all 211 map-1 records leaves
> exactly 14 mismatches — and all 14 are monster records, whose *only* wrong
> bytes are `+0x02/+0x03`. That one conditional (swap `+0x02/+0x03` unless
> the record is a monster) is the entire correction needed; nothing about
> `+0x07..+0x13` depends on itemType at all.
>
> **Spot-confirmed against `crypt.exe` for one of the 9 map-1-absent
> kinds** — Panel Item `0x2B`. `fcn.0041c220` (the container/panel item-fill
> handler) at `0x41c452` does `cmp bl, 0x2b` against the live record array's
> itemType byte (`[eax+0x46bd6d]`, i.e. live-array offset `+0x05` — same
> relative position as on-disk, confirming the common prefix is unaffected
> by itemType), then at `0x41c458` does `cmp word [eax+0x46bd74], cx` — a
> **word**-width compare at live-array offset `+0x0C` (`0x46bd74 −
> 0x46bd68`), matching the universal composition's word boundary there
> exactly. The same block also touches `+0x07` (`[...+0x46bd6f]`) and
> `+0x08` (`[...+0x46bd70]`) as, respectively, a byte and a word — again
> matching the rule.
>
> **The other 8 kinds were not each individually traced** — a byte-width
> justification beyond the universal-composition argument above was sought
> for all 9, but 8 of them (`0x00`, `0x0B` Boots, `0x1A` Amulet, `0x1B`
> Shirt, `0x1C` Pants, `0x27` Other/Skull, `0x2C` Idol, `0x2F` Statue) never
> appear as the operand of a `cmp` against the itemType byte anywhere in
> `crypt.exe` (checked via an xref census on every access to the live
> record array's itemType byte, `[reg+0x46bd6d]` — 53 xrefs total; the
> literal comparison constants that *do* appear are `0x06`, `0x0C`,
> `0x12`, `0x14`, `0x16`, `0x18`, `0x25`, `0x26`, `0x2B`, `0x2C`, `0x2E`,
> `0x30` — none of the other 8 gap kinds). That absence is itself evidence,
> not a gap: `0x0B`/`0x1A`/`0x1B`/
> `0x1C` share the exact same named-field list as the already-traced
> equip-family types (`0x07` Helm, `0x08` Shield, `0x09` Armor, `0x0A`
> Leggings, `0x15` Ring, `0x19` Belt, `0x2A` Bracers, `0x2D` Crown — all
> `charges, weight, size, AC, effect, value`), and the "CANNOT WEAR ITEM"
> equip-compatibility check (`fcn.0041c940`, called from the general
> "wear item" dispatch `fcn.0041c5f0`) validates wearability through a
> **generic, itemType-oblivious class/slot compatibility table**
> (`0x434b78`, indexed by class and slot, not by itemType) rather than a
> per-type branch — there is no code path left over that *could* apply a
> different field layout to Boots/Amulet/Shirt/Pants than to their already-
> confirmed siblings, because it is the same code. `0x2C` (Idol) is
> explicitly excluded from wearability by that same function
> (`cmp byte [...+0x46bd6d], 0x2c` at `0x41c966`) rather than given its own
> field-reading path. `0x00`, `0x27` and `0x2F` were not found in any
> itemType-keyed branch at all in the time spent looking; their swap
> boundaries rest on the universal-composition argument alone.
>
> | itemType | Evidence | Confidence |
> |---|---|---|
> | `0x2B` Panel Item | Direct `crypt.exe` trace, `fcn.0041c220` @ `0x41c452`/`0x41c458` (above) | Confirmed |
> | `0x0B`/`0x1A`/`0x1B`/`0x1C` (Boots/Amulet/Shirt/Pants) | Same field list + same generic table-driven code path as 8 already-confirmed equip siblings; no itemType-specific branch exists for any of them | High |
> | `0x00`, `0x27`, `0x2C`, `0x2F` | Universal-composition argument only (unique fit for 5 other types, consistent with all 39); no itemType-keyed code found | Medium-high — consistent with everything else observed, not independently code-traced |
>
> A monster's **second** (stat-continuation) record — never exposed by
> `bcdfs.py`'s `on_record` hook, so not part of the original 225-mismatch
> count at all — is a *different* layout with no name/gfx prefix: bytes
> `+0x00..+0x03` unswapped (always `0` in the shipped data, so unverifiable
> either way), three swapped words at `+0x04/+0x06/+0x08`, ten unswapped
> bytes at `+0x0A..+0x13`. Found the same way (exhaustive composition
> search) and hand-verified against all 14 of map 1's monster pairs, e.g.
> `00 00 00 00 00 01 00 28 00 19 00 04 00 04 ff 00 00 00 00 00` (Amiga) →
> `00 00 00 00 01 00 28 00 19 00 00 04 00 04 ff 00 00 00 00 00` (DOS): the
> `0x0001` constant at `+0x04/0x05`, XP gain at `+0x06/0x07`, attack
> strength at `+0x08/0x09` all swap; everything from `+0x0A` on (a `0xFF`
> marker, a `0x04` marker, more zero bytes) does not. The optional 4-byte
> monster extension (read when the second record's `+0x13` is non-zero)
> never fires in any of the 13 shipped maps (0/265 monster pairs) — its DOS
> encoding is genuinely undetermined, and `maindung.convert()` raises
> rather than guessing if it's ever encountered.
>
> **The `bcdft` name-reference word (`+0x02`, non-monster records) needs no
> remap beyond the ordinary word swap.** The concern was that DOS's own
> string storage might not share Amiga `bcdft`'s layout, requiring a table
> remap. It doesn't: `crypt.exe` (file offset `0x37A28`) embeds the exact
> same string block byte-for-byte — `data[0x37A28:0x37A28+15] ==
> b'WAR HAMMER\x00MEAT\x00'`, matching decompressed `bcdft` S_1 `+0x1C4E2`
> verbatim, offset for offset (`"GAUNTLETS"` sits at relative offset `+34`
> in both). So the reference number itself is already correct after the
> standard word byte-swap; nothing project-wide needs re-mapping, and all
> ~685 references convert automatically as part of the ordinary record
> transform.
>
> **The converter: `scripts/bclib/maindung.py`.** Mirrors `bcdfs.py`'s
> walker (imports it; does not reimplement traversal) and rewrites each
> span into DOS encoding per the rules above. Verified
> (`scripts/verify_maindung.py`):
>
> | Check | Result |
> |---|---|
> | Byte-exact round-trip vs. the real `maindung.gam` (all 15,099 B, after trimming the full output to what the demo itself contains — its own offset-table slots 2-12 are deliberately zeroed, see the "exactly one map" correction above) | **15,099/15,099 bytes match, zero deviation** |
> | Full 13-map conversion size | **171,005 B**, matching `bcdfs`'s own size exactly |
> | Monster-extension guard | 0/265 monster pairs trigger it, confirming `convert()`'s "raise rather than guess" branch is unreachable on real data |
> | Action-chain opcode range, all 13 maps (668 actions total, not just map 1's 45) | Every opcode falls in `0x00-0x22`, inside the documented 36-entry `0x00-0x23` table; the whole file parses end to end under `bcdfs.walk_all()`'s built-in tail-padding invariant with zero errors — the strongest generalization check available without a maps 2-13 DOS oracle, since a wrong action-chain assumption would desynchronise the walk immediately (as it does for unsigned row headers on maps 11-13) |
> | "Unique" IDs (per-map 12-bit square field) | Confirmed needing no renumbering — the converter never touches ID values, only byte order, and the round-trip is still byte-exact |
>
> Converted output is derived game data, gitignored (`build/` is already
> covered by `.gitignore`); nothing under `build/cache/blackcrypt/maindung/`
> is committed, only the scripts that produce it.

---

## crypt.exe — Windows Executable

PE32 Windows GUI executable (253,952 B). Imports: DDRAW.dll (DirectDraw),
DSOUND.dll (DirectSound), WINMM.dll (Windows Multimedia), GDI32.dll,
USER32.dll, KERNEL32.dll.

Contains embedded text by Rick Johnson describing the port:
- Original Amiga version by Raven Software (Brian Raffel, Steve Raffel,
  Ben Gokey, Rick Johnson), released March 20, 1992
- Windows port started October 21, 1995 using DirectX (GameSDK)
- Requires DirectX 3.0+, runs on Windows 95/98/NT 4.0
- Demo contains only the first dungeon map (two playable levels) — see the
  correction above; this describes map 1's own two dungeon levels, not
  "maps 1 and 2"

References `clipper.clp` for resource loading and `MainDung.gam` for
dungeon data. Character files use `char%d.dat` pattern (same as Amiga).

### First disassembly pass — confirmed: a full-game build with only data trimmed

`crypt.exe` had never been disassembled in this project until a planning
pass for a possible demo→full-game restoration (see
`docs/blackcrypt/dos/full-game-restoration-plan.md` for the complete
writeup and the actual restoration plan). Headline findings, each cited to
an address:

- **The map-switch routine is absent from the binary, not gated by data.**
  `fcn.00401fa0` (the `MainDung.gam` loader) reads up to 220,000 B into
  the dungeon buffer and copies all **13** offset-table slots — both
  full-game-sized. But `0x43c424` (the in-memory offset table) has
  exactly two cross-references in the whole binary — the loader filling
  it, and the save serializer copying it verbatim — and **nothing ever
  indexes it by map number**. `fcn.00423b50`, a 12-byte stub reached from
  both level-transition call sites (`MoveParty` and a second dispatch
  case), takes the destination map, discards it, and prints "YOU HAVE
  REACHED THE END OF THE TEST LEVEL". Injecting maps 3–13 into
  `maindung.gam` alone changes nothing — the data loads, but nothing ever
  reads past map 1.

  > **Correction — only the *call* was removed, not the routine.** The
  > `0x43c424` xref census above is accurate but was pointed at the wrong
  > global: `0x43c424` holds the *file's* offset table purely so it can
  > be written into `char%hu.dat`. The **runtime** table is a separate
  > copy at **`0x4738b4`** (indexed 1..13, slots `0x4738b8`–`0x4738e8`),
  > rebuilt from the save file by `fcn.00426390` at `0x426787`, and it is
  > indexed by map number in two places:
  >
  > | Function | Role | Where it indexes the table |
  > |---|---|---|
  > | `fcn.00425350` | `LoadDungeon` — parses one map from `tempdung.gam` into the live arrays | `0x425371` (seek), `0x42539b` (length) |
  > | `fcn.004258d0` | `SaveDungeon` — re-serializes the live arrays back over that map's bytes | `0x425c23` |
  > | `fcn.00426880` | `SwitchMap(fromMap, toMap)` — composes the two, reselects the tileset group, loads per-map resources | drives both via `word[0x47481a]` |
  >
  > Both are parameterized entirely by `word[0x47481a]` (current map,
  > 1-based); neither contains an inlined map-1 constant. Map 1 works
  > because `offsetTable[1] == 0` — data, not code. `SwitchMap` still has
  > a live caller (`fcn.00426390` at `0x426867`, as `SwitchMap(-1,
  > curMap)`), so the demo executes the full map-switch path on every
  > game load. The deleted thing is the 12-byte body of `fcn.00423b50`,
  > which used to call `SwitchMap`. Restoring it is ~20 bytes of x86.
  > Full trace, calling conventions and verification:
  > `full-game-restoration-plan.md` § "1A".

- **`fcn.00425350` is the byte-exact DOS counterpart of the Amiga map
  walker** (`scripts/bclib/bcdfs.py`'s `walk_map`), with its sub-readers
  `fcn.00425120` (container/monster sub-chain) and `fcn.00425250`
  (action chain). Every structural constant matches the confirmed Amiga
  loader: container types `0x13`/`0x23`, action types
  `0x0F 0x16 0x1D 0x1E 0x1F 0x21`, sub-chain heads at word `+0x0A`
  (monster) / `+0x0C` (container), monster continuation as a second
  20-byte record with `+0x13` nonzero ⇒ 4 more bytes, chain-next at word
  `+0x12`, 8-byte action records whose `+0x07` is the next action id.
  The **only** divergence is endianness-induced: the first action's id is
  byte `+0x0C` on DOS vs `+0x0D` on Amiga — the two halves of the same
  word `+0x0C`. Transcribing it and walking `maindung.gam` blind
  reproduces **1,530/1,530 squares**, **45/45 action records**, and the
  tail-padding invariant with zero deviation (DOS `4,000` = Amiga's
  confirmed `3,948` + the 52-byte block DOS offsets are pre-shifted
  past). Live arrays: 64×64 squares at `0x46f8b4` (empty = `0x0FF00000`),
  **700** × 20-byte records at `0x46bd68`, 256 × 8-byte action slots at
  `0x4738f0`; all three zeroed by `fcn.0041b9a0` and re-initialised by
  `fcn.00411350`.

- **Type-`0x12` (Stairs / Teleport / Spinner) record field map —
  confirmed.** Read by `fcn.00410d10` (`ResolveTargetSquare`) and
  `fcn.00410f60` (`FindRecordAt(x, y, itemType)`):

  | Offset | Size | Field | Consumer |
  |---|---|---|---|
  | `+0x00` | 1 | gfxNumber — `0x40`/`0x41` teleport, `0x43` stairs up, `0x44` stairs down, `0x1E` spinner | render |
  | `+0x01` | 1 | bit 7 = monster marker (DOS position; Amiga `+0x00`) | `0x410d5e` |
  | `+0x05` | 1 | itemType = `0x12` | `0x410fa5` |
  | `+0x07` | 1 | **destination map** (0 = same map) | `MoveParty` `0x423ce3`, teleport case `0x41b39e` |
  | `+0x08` | 2 | destination facing | `0x410dee` / `0x410e70` |
  | `+0x0C` | 2 | **destination X** | `0x410dd5` / `0x410e3f` |
  | `+0x0E` | 2 | **destination Y** | `0x410de1` / `0x410e49` |
  | `+0x10` | 2 | sub-kind — `0`/`1` teleport, `2` stairs up, `3` stairs down, `4` spinner | `0x410dc2` / `0x410e35` |

  `+0x10`'s values reproduce the Amiga's already-confirmed sub-kind
  table exactly, and map 1's staircase pair verifies `+0x0C`/`+0x0E`
  reciprocally: the down-stairs at (5, 18) sends the party to (37, 27),
  adjacent to the up-stairs at (37, 28), which sends them back to
  (5, 19), adjacent to the down-stairs. Spinners carry destination
  (0, 0) and do not move the party — matching the Amiga finding that
  code 4 applies only a facing rotation. **Map 1 contains exactly one
  cross-map transition:** the stairs at (col 49, row 23),
  `maindung.gam+0x0272D`, destination map **2** at (27, 20) — this is
  the record that triggers the "TEST LEVEL" message today, and the
  natural first test for the Phase 4 patch.
- **Missing `clipper.clp` resources fail gracefully and self-report.**
  Entries resolve by name string via a linear scan (`fcn.00402650`), not
  numeric ID. A miss logs `"** Could not find Clip '%s' **"` to an
  in-memory message log (`0x4699ac`) and returns `-1`; 181 call sites all
  check for that sentinel and skip the draw. No crash, no OOB read.
- **The binary is sized for the full game.** The dungeon read buffer
  (220,000 B) and offset table (13 slots) are both full-size; the
  in-memory `clipper.clp` directory is constructed for **2000** entries
  against the demo archive's 816; the creature sprite-name table
  (`0x430800`–`0x431b00`) lists all **26** creatures from the full 13-map
  roster (Estoroth, Lich Dragon, Medusa, Ram Demon/Lord, Possessor,
  Water Lord, …) though `clipper.clp` only has art for 2 of them (Two
  Head, Rock Eye); and `clipper.clp`'s `Start/End Level Specifics`
  bracket exists but is empty — a hole where per-map resources were
  removed.
- **Game logic is intact.** `fcn.00410d10` (`ResolveTargetSquare`) returns
  the same result codes documented on the Amiga side; `fcn.00423b60`
  (`MoveParty`) is a structural 1:1 with its Amiga counterpart. Spellbook,
  chargen, automap, save/restore, throwing items, all 180 item icons, all
  49 floor-item groups, all 29 keys + 87 keyholes are present. The smaller
  executable size vs. the Amiga's executable+overlays is compiler output,
  not a missing subsystem.

---

## Cross-Platform Comparison

### Resource Mapping

The Amiga version stores game resources across 26 `bcdf*` files, while the
Windows version consolidates most resources into `clipper.clp`. The mapping is not
1:1 — the Windows version has 751 images and 22 sounds vs the Amiga's distributed
file structure.

### Rendering Differences

| Property     | Amiga                    | Windows VGA                 |
|-------------|--------------------------|-----------------------------|
| Display     | EHB (64 colors)          | VGA (256 colors)            |
| Color depth | 6 bitplanes              | 8 bits/pixel                |
| Resolution  | 320×200                  | 320×200                     |
| Compression | RLE (custom scheme)      | None (raw indexed)          |
| Palette     | 32 × 16-bit + half-bright | 256 × 8-bit RGB            |
| Graphics API| Custom blitter           | DirectDraw                  |
| Audio       | 4-channel Paula          | DirectSound                 |

### File Size Comparison

| Data Type       | Amiga Source       | Amiga Size  | Windows Source   | Windows Size  |
|-----------------|--------------------|-------------|------------------|---------------|
| Dungeon maps    | bcdfs              | 171,005 B   | maindung.gam     | 15,099 B      |
| All resources   | bcdfa–bcdfz        | ~3.5 MB     | clipper.clp      | 1,151,267 B   |
| Executable      | BlackCrypt + overlays | ~600 KB  | crypt.exe        | 253,952 B     |

The Windows demo contains only **1** map (vs 13 in the full game — see the
correction under "maindung.gam" above), explaining the small `maindung.gam`
size. `crypt.exe`'s dungeon buffer and offset table are both full-game-sized
regardless (see "crypt.exe" below) — the file is small because the *data*
was trimmed, not because the engine only supports one map.

---

## Extracted Assets

The current, regenerable pipeline output (`scripts/extract_clipper.py`) is
packed atlases under `public/assets/blackcrypt/dosvga/` (gitignored — rebuild
with `python3 scripts/extract_clipper.py`), by category per `group_for()`:

```
public/assets/blackcrypt/dosvga/
  sprites/dungeon.{png,json}         76 frames — wall/floor/door/structure textures
  sprites/monsters.{png,json}        14 frames — Start/End Monsters bracket (Rock Eye, Two Head)
  sprites/ui.{png,json}              107 frames — fonts, bars, HUD chrome, + the 11 CG numerals
  sprites/items.{png,json}           202 frames — Start/End Items (175) + Misc (5) + Chest (19) brackets, plus named item entries
  sprites/spell-effects.{png,json}   73 frames — Start/End Speed Graphics bracket (all 16x16)
  sprites/keys.{png,json}            29 frames — Start/End Keys marker bracket; confirmed = Amiga bcdfa key-icon bank
  sprites/key-holes.{png,json}       87 frames — Start/End Key Holes bracket (29 x 3 depths); confirmed = Amiga bcdfb-bcdfn wall-decoration bank
  sprites/throwing-items.{png,json}  12 frames — Start/End Throwing Items bracket (4 weapons x 3 depths); Arrow+Dagger confirmed = Amiga bcdfa entry 12, Sword+Hammer DOS-exclusive
  sprites/floor-items.{png,json}     147 frames — Start/End Floor Items bracket (49 x 3 depths); confirmed = Amiga bcdfa floor-item bank
  screens/title.{png,json}           4 frames — the "Title N" full-screen entries
  palettes/*.json                    7 palettes
  audio/*.{wav,iff,raw}              22 sounds
```

76 + 14 + 107 + 202 + 73 + 29 + 87 + 12 + 147 + 4 = **751**, the archive's
full image count. **There is no `sprites/misc.*` any more** — see "The marker
brackets classify the archive completely" above; every entry now reaches its
atlas through one of `clipper.clp`'s own `Start X`/`End X` brackets or an
explicit name, and the old dimension-guessing fallback is unreachable. (An
even earlier pass also split out a `heraldry` bucket for the 32×29 entries —
retracted, they are the `Start Chest` bracket, i.e. chest armor, and are part
of `items`; there is no `heraldry` category in the current output.)

Older ad-hoc extraction output (individual PNGs from earlier probe scripts,
not the current pipeline) may still exist at `data/blackcrypt/bcdf_images/`
and `data/blackcrypt/extracted/` — those are historical/debug output, not
regenerated by `extract_clipper.py`, and should not be treated as more
authoritative than the `public/assets/` atlases above.

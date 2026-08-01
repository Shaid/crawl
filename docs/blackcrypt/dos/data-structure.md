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

---

## maindung.gam — Dungeon Data

### Format

The Windows dungeon format is **structurally identical** to the Amiga `bcdfs` format,
with the only difference being CPU endianness (little-endian on Windows vs big-endian
on Amiga).

**Confirmed identical:**
- Offset table: Map 1 = `0x00000000`, Map 2 = `0x00003AC7`
- Maps 3–13 have offset 0 in the Windows file (demo only has 2 maps)
- Map 1 header: `00 00 00 00 1d 00 39` — byte-identical between platforms
- Square data: stored as native-endian 32-bit values

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
- Demo contains only the first dungeon map (two playable levels)

References `clipper.clp` for resource loading and `MainDung.gam` for
dungeon data. Character files use `char%d.dat` pattern (same as Amiga).

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

The Windows demo contains only 2 maps (vs 13 in the full game), explaining the
small `maindung.gam` size.

---

## Extracted Assets

The current, regenerable pipeline output (`scripts/extract_clipper.py`) is
packed atlases under `public/assets/blackcrypt/dosvga/` (gitignored — rebuild
with `python3 scripts/extract_clipper.py`), by category per `group_for()`:

```
public/assets/blackcrypt/dosvga/
  sprites/dungeon.{png,json}         76 frames — wall/floor/door/structure textures
  sprites/monsters.{png,json}        14 frames — Rock Eye, Two Head
  sprites/ui.{png,json}              97 frames — fonts, bars, HUD chrome
  sprites/items.{png,json}           205 frames — 48 named + 180 reclassified 24x24 + 19 reclassified 32x29 armor icons, minus the 49 floor-item names now in floor-items
  sprites/spell-effects.{png,json}   73 frames — reclassified 16x16 spell icons
  sprites/keys.{png,json}            29 frames — Start/End Keys marker bracket; confirmed = Amiga bcdfa key-icon bank
  sprites/key-holes.{png,json}       87 frames — Start/End Key Holes bracket (29 x 3 depths); confirmed = Amiga bcdfb-bcdfn wall-decoration bank
  sprites/floor-items.{png,json}     147 frames — Start/End Floor Items bracket (49 x 3 depths); confirmed = Amiga bcdfa floor-item bank
  sprites/misc.{png,json}            19 frames — unnamed, not confidently classified (CG Numbers + unnamed Sword/Hammer depths)
  screens/title.{png,json}           4 frames — the "Title N" full-screen entries
  palettes/*.json                    7 palettes
  audio/*.{wav,iff,raw}              22 sounds
```

See the "Item icons and other unnamed entries" section above for how
`items`/`spell-effects` were split out of what used to be one 505-entry
`misc` bucket. (An earlier pass also split out a `heraldry` bucket for the
32×29 entries — retracted, they're chest armor and now part of `items`;
there is no `heraldry` category in the current output.)

Older ad-hoc extraction output (individual PNGs from earlier probe scripts,
not the current pipeline) may still exist at `data/blackcrypt/bcdf_images/`
and `data/blackcrypt/extracted/` — those are historical/debug output, not
regenerated by `extract_clipper.py`, and should not be treated as more
authoritative than the `public/assets/` atlases above.

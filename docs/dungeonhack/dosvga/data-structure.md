# Dungeon Hack (DreamForge Intertainment / SSI, 1993) — DOS/Windows port

Source data: `data/dungeonhack/dosvga/` (extracted from the CD image at
`data/dungeonhack/dosvga/cdimage/` via bchunk → ISO → ARJ installer). `HACK.BAT`
launches the game: `checksys` (memory check) → `aesop open opening` (intro,
only if `OPEN.RES` present) → `aesop hack phase-one` → `..\maze %1 %2` (a
**separate executable**, run from the `SAVEGAME/` directory) → `aesop hack
phase-two` → loop back to `phase-one`.

## Provenance and how this doc was built

Dungeon Hack runs on **AESOP/16**, the exact same bytecode VM and container
format as Eye of the Beholder III (`HACK.RES`'s first 16 bytes read
`"AESOP/16 V1.00\0"`, byte-identical to EOB3's `EYE.RES`) — see
`docs/eotb3/dosvga/data-structure.md` for that pass's findings. This doc
does not re-derive the shared container/bitmap/palette/font mechanics from
scratch; it reuses `scripts/eotb3lib/` directly and documents what's new or
different for Dungeon Hack specifically.

This pass had a **much stronger oracle than EOB3's** (which only had
ThirdEye, a from-scratch reimplementation): John Miles (AESOP's original
author) publicly released the actual interpreter source. From the VOGONS
thread (`https://www.vogons.org/viewtopic.php?t=20601`), this pass
downloaded and extracted:

- **`AESOP_INTERPRETER_BUILD_2a.zip`** — a buildable Open Watcom project for
  the real AESOP/32 interpreter, including `RTRES.C`/`.H` (resource file
  reader), `GRAPHICS.C`/`.H` (bitmap/palette runtime), `SOUND32.C`/`SOUND.H`
  (sound), `EYE.C` (EOB3-specific glue). Despite the "/32" name this is the
  direct successor to the "/16" engine Dungeon Hack and EOB3 both actually
  ship — same container/header struct layouts, confirmed byte-exact below.
- **`DAESOP_0_85.zip`** — Mirek Luza's independent AESOP resource
  extractor/replacer + bytecode disassembler + `EYE.RES`→AESOP/32 converter
  (`convert.c`), including explicit `OLD_FONT_HEADER`/old-bitmap conversion
  code that **independently reverse-engineered several of the same formats
  this pass derived from scratch**, letting each be cross-checked field-for-
  field against a second, independently-produced implementation.
- **`ADDITIONAL_DH_RUNTIME_FUNCTIONS.TXT`** — a community catalogue (also by
  Luza) of AESOP runtime functions Dungeon Hack's bytecode calls that aren't
  in the shared EOB3/AESOP-32 base, each annotated with which named resource
  calls it — independent corroboration that the large "SOP class object"
  resource bucket (see §2.6) really is Dungeon Hack's game-logic/procedural-
  generation code, not overlooked asset data.

Every format below cites the exact source file/struct where source-level
confirmation was found, not just "looks structurally similar."

Confidence key: **confirmed** (byte-exact structural invariant across the
whole corpus, a clean recognizable render, and/or matched against real
interpreter/tool source), **rendered** (plausible decode, colour or full
resolution not independently verified), **hypothesis** (structurally
plausible, unverified).

---

## 1. Two `AESOP/16` resource containers — confirmed

`HACK.RES` (7,083,229 B, the game proper) and `OPEN.RES` (1,592,336 B, the
intro/menu bank — run via `aesop open opening`) are **structurally identical
containers** to EOB3's `EYE.RES`. `scripts/eotb3lib/res.py` (EOB3's
confirmed byte-exact parser) works against both **completely unmodified** —
no adaptation needed.

**Confirmed against real interpreter source**, not just structural
inference: `RTRES.H` (`AESOP_INTERPRETER_BUILD_2a/arun/src/RTRES.H`)
declares the exact same structs our parser already assumed:

```c
typedef struct { BYTE signature[16]; ULONG file_size; ULONG lost_space;
                 ULONG FOB; ULONG create_time; ULONG modify_time; }
RF_file_hdr;                     // == our GlobalHeader, byte-for-byte

typedef struct { ULONG timestamp; ULONG data_attrib; ULONG data_size; }
RF_entry_hdr;                    // == our EntryHeader, byte-for-byte

#define OD_SIZE 128               // == our DIR_BLOCK_ITEMS
typedef struct { ULONG next; UBYTE flags[OD_SIZE]; ULONG index[OD_SIZE]; }
OD_block;                        // == our DirectoryBlock, byte-for-byte
```

| File | `file_size` field | actual size | match | dir blocks | entries | named |
|---|---|---|---|---|---|---|
| `HACK.RES` | 7,083,229 | 7,083,229 | exact | 24 | 2,963 | 2,958 |
| `OPEN.RES` | 1,592,336 | 1,592,336 | exact | 2 | 194 | 189 |

Extractor: `scripts/extract_dungeonhack_res.py` →
`public/assets/dungeonhack/dosvga/data/{hack,open}-resources.json`.

### 1.1 `HACK.TBL` / `OPEN.TBL` — confirmed, redundant directory cache

A sidecar pair not present for EOB3. Byte-exact identical to the flat
concatenation of every directory block's `entry_header_index[128]` array (in
block order), plus a fixed 9-`u32` (36-byte) all-zero trailer:

| File | total `u32` slots | nonzero (matches entry count) | trailing zero pad |
|---|---|---|---|
| `HACK.TBL` | 3,081 = 24×128 + 9 | 2,963 | 118 |
| `OPEN.TBL` | 265 = 2×128 + 9 | 194 | 71 |

**Confirmed two ways**: (1) every nonzero `u32` in each `.TBL` matches an
`EntryHeader` file offset from independently walking the corresponding
`.RES`'s directory-block chain, position-for-position, zero mismatches; (2)
DAESOP's own `readme.txt` documents a `/create_tbl` command with the note
*"create a TBL file for the specified RES file (the 'Dungeon Hack' engine
needs TBL files)"* — direct confirmation this is a flat-index **read
optimization Dungeon Hack's own loader requires** (skip walking the linked
directory-block chain at startup), not unique or derivable-only-from-TBL
content. No extractor needed — it carries no information `res.py` doesn't
already recover from the `.RES` file itself, so it isn't a distinct asset
format, just documented here for completeness.

---

## 2. Resource classification — reused + extended from EOB3

`scripts/dungeonhacklib/classify.py` reuses every one of EOB3's structural
checks (`eotb3lib/classify.py`'s dictionary/palette/string/map32x32/pcm_sound/
iff_cue detectors, imported directly) and adds two new ones, at higher
priority than the sound/unknown fallback (see §2.5 for why priority order
matters here specifically):

| Type | `HACK.RES` | `OPEN.RES` | Confidence |
|---|---|---|---|
| `string` | 1,128 | 78 | confirmed (§2.1) |
| `sop_dict` | 675 | 39 | confirmed (inherited from EOB3, unchanged mechanism) |
| `old_format_bitmap` | 632 | 15 | confirmed (§3) |
| `unknown` (SOP class objects) | 334 | 17 | confirmed (§2.6) |
| `pcm_sound` | 144 | 34 | rendered (§2.4 — sample rate not independently confirmed for DH) |
| `palette` | 47 | 3 | confirmed (§4) |
| `resource_font` | 3 | 1 | confirmed (§5) |
| `iff_cue` | 0 | 7 | confirmed as **music**, not dialogue cues (§2.7) |

### 2.1 Strings — confirmed

Same `"S:<text>\0"` convention as EOB3, unchanged. `"map border top"` etc.
resources hold literal CP437 box-drawing characters (`\xc9\xcd\xcd...`) —
ASCII-art UI borders, not just plain prose text.

Extractor output: `data/{hack,open}-strings.json`.

### 2.2 `sop_dict` — inherited, unchanged

AESOP dictionary blobs (special tables 0–4, `<name>.IMPT`/`.EXPT`), same
bucket/mechanism as EOB3 §1.4. Not re-verified in detail this pass beyond
confirming the container parses cleanly (§1) — no reason to expect a
different mechanism since it's the same container format.

### 2.3 `palette` — see §4.

### 2.4 `pcm_sound` — rendered, sample rate not independently confirmed for DH

Same headerless-bell-curve-histogram classifier as EOB3. Extracted as
8-bit unsigned mono WAV @ 8000 Hz, same as EOB3 — but note the **provenance
is weaker here**: EOB3's rate was confirmed against ThirdEye's own
`sound.cpp` (`SOUND_RATE=8000`) *and*, this pass, against the real
interpreter source's `MODSND32.C` comment `"(Eye III sound samples at 8.000
kHz.)"` — but that comment is explicitly about *Eye III* (EOB3)'s own
compiled build, not a generic engine constant, and this archive doesn't
include Dungeon Hack's own compiled `MODSND32.C`. Dungeon Hack's
`README.TXT` confirms the same underlying stack ("Sound via Miles Design's
IBM Audio Interface Library and The Audio Solution's DIGPAK interface"),
and the byte-histogram shape (peak near 128, the 8-bit-unsigned-PCM silence
level) is consistent — but the exact numeric rate is a carried-over
assumption, not confirmed for this game's own build. Flagged accordingly in
the extractor's own JSON output (`format:
"pcm_u8_mono_8000hz_hypothesis"`).

### 2.5 `old_format_bitmap` vs `pcm_sound` — classifier ordering matters here

EOB3 never embeds an "old format" bitmap (see §3) directly in its own
`EYE.RES` — every bitmap resource there uses the "1.10" VFX shape format
instead, confirmed this pass by checking EOB3's own `pcm_sound`/`unknown`
buckets for old-format-bitmap-shaped false positives (found **zero** across
both). Dungeon Hack is different: `old_format_bitmap` **is** used directly
in the main container, and several of those resources (e.g. "Floor Deco 08",
"Portrait 2", "Door-12") coincidentally pass EOB3's `looks_like_pcm_sound`
byte-histogram heuristic too (varied graphics bytes can look bell-curved).
`dungeonhacklib/classify.py` checks `looks_like_old_format_bitmap` (a strict
full-decode structural check — every declared sub-bitmap must have an
in-bounds offset, plausible dimensions, and decode without error) **before**
the sound heuristic; without this ordering fix, `pcm_sound` over-counts by
4/148 (HACK.RES) and 1/35 (OPEN.RES), and `unknown` by hundreds.

### 2.6 `unknown` (334 in `HACK.RES`, 17 in `OPEN.RES`) — SOP class objects, confirmed

Same conclusion as EOB3 §9.5: this bucket is the game's AESOP bytecode
class hierarchy (monster types, item types, spell classes, dungeon-feature
classes, unique artifacts), not overlooked asset data — e.g. `"kernel"`,
`"dungeon"`, `"camp"`, `"cgen"`, `"PC"`, `"NPC"`, `"phase-one"`/`"phase-two"`
(matching `HACK.BAT`'s own `aesop hack phase-one`/`phase-two` calls
literally), and hundreds of AD&D-canon item/monster/spell names (`"long
sword"`, `"bugbear"`, `"fireball"`, `"gauntlets of fire giant strength"`,
`"mordenkainen's sword"`). **Independently corroborated** by
`ADDITIONAL_DH_RUNTIME_FUNCTIONS.TXT`, a community catalogue of AESOP
runtime functions specific to Dungeon Hack, each annotated with which named
resource calls it (e.g. `load_level_map`/`load_visibility`/`seed_random`
called from `dungeon`; `refresh_main_text_window` called from `kernel,
camp`) — every resource name that document cites as a bytecode caller is
one of this bucket's `unknown`-classified names, confirming the bucket is
exactly the code side of the engine. In `OPEN.RES`, this same bucket
includes `"opening"` — the literal object name `HACK.BAT` invokes
(`aesop open opening`).

### 2.7 `iff_cue` in `OPEN.RES` — confirmed as music, refining EOB3's guess

Same `FORM....XDIR` EA-IFF-85 wrapper EOB3 found in `EYE.RES` (66 resources
there, left as "likely dialogue/outtake cue bundles" — unresolved). Here all
7 instances are explicitly named `"Music Scene One Adlib"`, `"Music Scene
One Roland"`, `"Music Scene One Pc"`, `"Music Scene Two Adlib/Pc"`, `"Music
Scene Two Roland"`, `"Music End Adlib/Pc"`, `"Music End Roland"` — i.e. this
wrapper is a **generic Miles AIL music/sequence container** reused across
device targets (Adlib/Roland MT-32/PC speaker), not something specific to
dialogue. Still not decoded (inner `CAT ` chunk payload) — playback data,
same "out of scope, not renderable/playable asset content" treatment as
EOB3's GFF `*SEQ` tags.

---

## 3. "Old format" row/span RLE bitmaps — confirmed, used directly (not GFF-wrapped)

Dungeon Hack has **no `.GFF` cutscene files at all** — every screen, sprite,
and wall/decoration LOD tile-set uses `eotb3lib/bitmap.py`'s already-confirmed
"old format" decoder (EOB3 §4.1), embedded **directly** in `HACK.RES`/
`OPEN.RES` instead of inside a separate `GFFI` container. This is the
dominant graphics format in both files (632/2963 in `HACK.RES`, 15/194 in
`OPEN.RES`).

### 3.1 Bug found and fixed: the sub-bitmap offset table is `u32`, not `u16`

EOB3's `EYE.RES` never has a resource bigger than 64 KB using this format,
so the offset table's top 16 bits always read `0` there and an earlier
version of `eotb3lib/bitmap.py` read only the low `u16` of each 4-byte
table slot. Dungeon Hack's `"Drawbridge"` resource (130,544 B, 6 sub-frames)
exposed this: entries 3–5 need offsets past 65,535 (83,010 / 110,175 /
117,929), and the old `u16` read produced garbage dimensions (`1544×1285`,
`56025×1499`, ...). Fixed in `eotb3lib/bitmap.py` to read the full `u32` LE
value.

- **Regression-verified against EOB3**: re-ran `extract_eotb3_gff.py` +
  `extract_eotb3_chargen.py` + `extract_eotb3_res.py` after the fix and
  diffed the entire `public/assets/eotb3/` output tree against a pre-fix
  copy — **zero byte differences**, confirming every EOB3 offset really was
  `< 65536` and the fix is a strict no-op there.
- **Independently confirmed against DAESOP's own converter**
  (`convert.c`'s `getNewBitmapForOldBitmap()`):
  ```c
  loOldBitmapHeaderSize = aOldResourceBuffer[0] | (aOldResourceBuffer[1]<<8) |
      (aOldResourceBuffer[2]<<16) | (aOldResourceBuffer[3]<<24);   // u32
  ...
  loOldPictureStart = aOldResourceBuffer[6+i*4+0] | (aOldResourceBuffer[6+i*4+1]<<8) |
      (aOldResourceBuffer[6+i*4+2]<<16) | (aOldResourceBuffer[6+i*4+3]<<24);  // u32
  ```
  Both the leading total-size field and every offset-table entry are read
  as full 4-byte values — exactly the fix applied here, from an
  independent, real-source-informed implementation.
- **Structural invariant, corpus-wide**: after the fix, all 6 of
  `"Drawbridge"`'s sub-bitmaps decode to `320×200` with the **last frame's
  `next_pos` landing exactly on the resource's total size** (130,544 ==
  130,544) — a clean self-consistency check with zero slack.

### 3.2 Screen vs. sprite classification

No on-disk flag distinguishes a full-screen backdrop from a transparent
sprite; this pass uses "does any sub-bitmap measure exactly 320×200" as the
split (11/632 `HACK.RES` resources qualify, e.g. `"Main Screen"`,
`"Drawbridge"`, `"Generating"`, `"Customize Screen"`; 11/15 in `OPEN.RES`).
Screens are rendered opaque; everything else treats palette index 0 as
transparent (standard sprite convention, matches how EOB3's own VFX shapes
handle background).

### 3.3 Colour resolution — same DAC-region mechanism as EOB3, confirmed against source, re-tuned per game

**Confirmed against the real interpreter source** (`GRAPHICS.C`): Dungeon
Hack uses the identical runtime mechanism EOB3 does (documented in
`docs/eotb3/dosvga/data-structure.md` §4.2, there inferred from ThirdEye's
reimplementation) — a small number of fixed windows into the 256-colour VGA
DAC, each loaded independently by bytecode calling `set_palette(region,
resource)`. The mechanism is compiled directly into the engine:

```c
UWORD first_color[5] = { 0x00, 0xb0, 0xc0, 0xe0, 0xb0 };   // EOB3's own build
UWORD num_colors[5]  = {  256,  16,   32,   32,   80  };   // (Project: "Eye III")
UBYTE  F_fade[11][256];   // fixed    00-AF (also initializes B0-FF)
UBYTE  W_fade[11][16];    // wallset  B0-BF
UBYTE M1_fade[11][32];    // monster #1 C0-DF
UBYTE M2_fade[11][32];    // monster #2 E0-FF
```

This is **EOB3's own hardcoded build** (`GRAPHICS.C`'s file banner reads
"AESOP graphics interface for Eye III engine") — the exact numeric windows
differ per game (each game's build compiles its own `first_color`/
`num_colors` tuned to its asset budget), but the **mechanism** (a handful of
DAC windows, each independently palette-loadable, with 11 pre-baked
brightness/fade steps per window) is confirmed identical. Also directly
explains EOB3's own still-open "outtake" 80-colour palette mystery
(`docs/eotb3/dosvga/data-structure.md` §4.2's "Still open" note) as a
bonus, unprompted finding: `num_colors[4] = 80` at `first_color[4] = 0xb0`
— a **5th region, same base as the wallset window but spanning the full
0xB0-0xFF range** (wallset+M1+M2 combined) for full-scene "outtake" story
art. Not corrected in EOB3's own docs this pass (out of scope — this doc
only touches Dungeon Hack), but recorded here since it fell directly out of
this pass's source access.

**Dungeon Hack's own windows, measured empirically** (no equivalent source
file for DH's own build was in the downloaded archive, so these are derived
from the real, on-disk palette resources rather than a compiled constant
table — but the *mechanism* match above gives strong structural backing):

| Region | Measured pixel range | Matching palette resource(s) | Width |
|---|---|---|---|
| fixed | 1–224 | `"Fixed palette"` | 225 |
| sel | 225–239 | `"Sel-0"`..`"Sel-13"` (14 candidates) | 14 |
| wall | 240–255 | `"wall/floor palette 00"`..`"20"` (21 candidates) | 16 |

Corpus-wide classification of all 632 `HACK.RES` `old_format_bitmap`
resources by their own nonzero pixel-index range (analogous to EOB3 §4.2's
per-resource pixel-range check):

| Bucket | Count | Resolution |
|---|---|---|
| `fixed` (≥98% of nonzero pixels in 1–224) | 535 | **confirmed, real colour** — unambiguous single `"Fixed palette"` resource |
| `wall`-dominant (≥90% in 240–255) | 41 | rendered greyscale — 21 same-shaped candidate palettes, no name/index correlation found to pick one |
| `sel`-dominant (≥90% in 225–239) | 11 | rendered greyscale — likely a time-multiplexed UI highlight/shimmer cycle (`"Floor-N"`/`"Ground-N"` names), which of 14 phases applies not resolved |
| `mixed` (spans 2+ regions) | 44 | rendered greyscale — composite screens needing simultaneous multi-palette compositing, not attempted |
| `empty` (no nonzero pixels) | 1 | n/a (`"Shadow"`) |

**Verification for the resolved 535/632 (85%)**: rendered output is
unambiguous — the `"Main Screen"` title card (`"DUNGEON HACK"` logo, full
AD&D/TSR/SSI copyright text, `"Forgotten Realms"` banner, all legible),
`"Char_gen"` (a `"Create Character"` UI screen with class/race/sex/alignment
buttons), and a batch atlas of ~400 fully-recognizable, correctly-coloured
monster/item/UI sprites (cobras, minotaurs, gargoyles, fire elementals,
ghosts, dark knights, wizards in full canon colouring) — see
`public/assets/dungeonhack/dosvga/screens/hack-Main_Screen.png`,
`screens/hack-Char_gen-00.png`, `sprites/dh-hack/batch-000.png`.

`OPEN.RES` has no single named `"Fixed palette"` — it uses full 256-colour
per-scene palettes instead (`"Scene One Palette"`, `"Scene Two Palette"`,
`"Ending Palette"`, each 3,610 B = same 26+14×256 layout as §4). The
extractor falls back to the largest available (`"Scene One Palette"`) for
every screen, **unverified per-screen** (no cross-reference exists to say
which of the 11 screen resources wants which scene palette) — but spot
checks render correctly regardless: `"DreamForge"` frame 15 is the
unmistakable, fully-coloured DreamForge Intertainment Inc. developer-logo
splash (orange/navy), and `"Mage"` frame 5 shows a fully-coloured fairy/pixie
character floating cross-legged. Flagged **rendered**, not confirmed, for
the screens that don't independently corroborate the guess.

Extractor: `scripts/extract_dungeonhack_res.py` (`extract_bitmaps`), region
logic in `scripts/dungeonhacklib/oldbitmap.py`. Output:
`screens/{hack,open}-<name>[-NN].png`,
`sprites/dh-{hack,open}/batch-NNN.{png,json}`,
`data/{hack,open}-bitmap-regions.json` (per-resource region + pixel range).

---

## 4. Palette resources — confirmed against real interpreter source

**Fully confirmed, source-verified** (not just structurally inferred, as
EOB3's original pass had to do). `DEFS.H` declares the exact palette-resource
header struct:

```c
typedef struct { UWORD ncolors; UWORD RGB; UWORD fade[11]; } PAL_HDR;
```

= `numColours`(u16) + `colorArrayOffset`(u16, always 26) + 11×`fadeIndexArray`
(u16 each) = 2+2+22 = **26 bytes**, byte-exact match to what both this pass
and the original EOB3 pass already derived structurally. `GRAPHICS.C`'s
`set_palette()` confirms the semantics:

```c
PHDR = RTR_addr(handle);
for (i=0;i<11;i++) {
    fade = add_ptr(PHDR, PHDR->fade[i]);
    for (j=0;j<PHDR->ncolors;j++)
        fade_tables[region][i][j] = first_color[region] + fade[j];
}
array = add_ptr(PHDR, PHDR->RGB);
for (i=0;i<PHDR->ncolors;i++) VFX_DAC_write(i+first_color[region], &array[i]);
```

I.e. `PHDR->RGB` (always 26) points at `numColours` consecutive 3-byte 6-bit
RGB triples, and `PHDR->fade[k]` are **literal file offsets** to 11 separate
`numColours`-byte brightness-lookup tables (not a fixed-size trailer, as an
earlier read of the *structure* alone might suggest) — each entry `j` in
fade level `i` gives the raw DAC index `first_color[region] + fade[i][j]`
that base colour `j` maps to at brightness level `i`.

**Confirmed byte-exact, zero deviation**, across every palette resource in
both `HACK.RES`/`OPEN.RES` **and** re-checked against EOB3's `EYE.RES`:
`fadeIndexArray[k] == colorArrayOffset + numColours*3 + k*numColours` for
`k=0..10`, and total resource size `== 26 + numColours*14` exactly (e.g.
Dungeon Hack's `"Main Base Palette"`: `numColours=256`,
`26+256*14=3610==` actual size; EOB3's `"Human paladin palette"`:
`numColours=80`, `26+80*14=1146==` actual size). **This corrects/extends
both games' docs**: an earlier read (before this pass had source access)
assumed the RGB array was followed only by a truncated/unexplained tail;
it's actually 11 well-formed per-colour brightness tables, confirmed by
structure, by a clean corpus-wide arithmetic invariant, and now by the
literal source code.

Spot-checked semantics: `"Main Base Palette"`'s fade level 0 is **constant**
(every one of 256 colours maps to a single dark index, `253`) and fade
level 10 is **near-identity** (`level10[i] == i` for most `i`) — consistent
with "level 0 = fully dark, level 10 = full brightness," an 11-step light
falloff table, matching Dungeon Hack's dungeon torch-light rendering.

`load_resource_palette()` (unchanged, RGB-only) and the new
`resource_palette_fade_tables()` helper both live in `scripts/eotb3lib/palette.py`.
The extractor emits only the RGB array to `palettes/{hack,open}-<name>.json`
(the fade tables aren't separately emitted this pass — they're runtime
lighting data, not a distinct visual asset).

---

## 5. `resource_font` — confirmed, cracked this pass, independently corroborated

A proportional-width, fixed-row-height font format embedded directly in
`HACK.RES` (`"8x8 font"`, `"6x8 font"`, `"Ornate font"`) and `OPEN.RES`
(`"Font"`) — **left open by the EOB3 pass** (`docs/eotb3/dosvga/
data-structure.md` §9.5 notes 3 same-named EOB3 resources that didn't match
any known layout). EOB3's own same-named resources still don't match this
layout either (a constant `count=11826`-shaped header regardless of file
size) — a different, still-unidentified format there; genuinely
Dungeon-Hack-specific despite living in the shared `eotb3lib/font.py`.

```
u16 count                    charset slots (<=256; not all populated)
u16 rowHeight                fixed glyph height for every glyph
u16 reserved0, reserved1     0 observed
u8  charRemap[256]           byte -> glyph index map (identity in every
                              resource seen; present regardless of `count`)
u16 offsets[count]           file-relative glyph record offsets, starting
                              right after the remap table (offset 264)
per glyph: u16 width (0 = unused slot), then width*rowHeight pixel bytes
           (1 byte/pixel; small palette indices, e.g. 0=bg/15=fg observed)
```

**Derivation**: `count`/`rowHeight` read directly; a byte-ramp scan found
the 256-byte remap table is fixed-size regardless of `count` (confirmed
against `OPEN.RES`'s `"Font"`, `count=123`, same 256-byte table); the
offset-table stride (`count` × u16, starting at 264) was confirmed by its
values landing exactly on the resource's own size at the tail and its
deltas correlating cleanly with real per-character width once decoded
(space/`.`/`:` narrow, `M`/`W`/`@` wide — an unmistakable proportional-font
signature, not degenerate/coincidental data).

**Independently corroborated field-for-field** against DAESOP's own
converter (`convert.h`'s `OLD_FONT_HEADER` struct — `char_count`/
`char_height` + 4 reserved bytes, exactly this format's first 8 bytes;
`convert.c`'s `readOldCharacterDefinition()` — glyph pointer at
`0x108 + char*2` (`0x108 == 264`, exact match), reading `columns` as a full
`u16`, and `size = 2 + columns*height` matching this format's per-glyph
span formula exactly). DAESOP's own header comment flags it "almost
certainly incomplete" and its converter blindly skips the 256-byte remap
table without using its content — this pass's derivation goes one step
further than that independent tool did.

**Verified visually, unambiguous**: `"8x8 font"` renders full legible ASCII
(`!"#$%&'()*+,-./0123456789:;<=>?@ABC...`); `"Ornate font"` renders a
decorative gothic/blackletter display face including a `TH` ligature;
`OPEN.RES`'s `"Font"` (17px-tall, count=123) renders a larger decorative
title face. See `public/assets/dungeonhack/dosvga/sprites/dh-hack-font-*.png`.

Extractor: `scripts/extract_dungeonhack_res.py` (`extract_fonts`), decoder:
`scripts/eotb3lib/font.py` (`load_resource_font`/`looks_like_resource_font`).

---

## 6. `MAZE.EXE` — confirmed: the standalone procedural dungeon generator

**Fully identified, no deep disassembly needed** — `strings` on the binary
alone settles it:

```
Random Dungeon Generator v1.0/386  Event Horizon Software Inc.
Seed=%08lX Settings=
SEED.TXT
FREQ_MONSTERS  FREQ_TREASURE  FREQ_ILLUSIONARY_WALLS  FREQ_FOOD
FREQ_KEYS  FREQ_TRAPS  FREQ_PITS  HINT_SHEET_FREQ
ZONES_ON  WATER_ON  MULTI_LEVEL_PUZZLES_ON
settings.dat  ITEMS.DAT  FEA%02d.DAT  LEVELS.DAT
```

`MAZE.EXE` (a separate Borland C++-compiled, `.386`-suffixed executable —
plausibly using a DOS extender for the generation algorithm's memory needs,
consistent with `HACK.BAT`'s `checksys 56 640` memory check and running it
as a *swapped-out* separate process rather than a function AESOP.EXE calls
in-process) is **"Random Dungeon Generator v1.0/386" by Event Horizon
Software Inc.** — a credited sub-contractor distinct from DreamForge
Intertainment, confirming Dungeon Hack's famous procedurally-generated
dungeons are built by a wholly separate tool, not AESOP bytecode. It:

1. Reads `SETTINGS.DAT` for frequency/difficulty knobs (monster/treasure/
   trap/pit/key density, illusionary-wall frequency, zones/water/multi-level
   puzzles on/off) — these are almost certainly the "Set to Easy/Moderate/
   Hard" difficulty presets referenced by `HACK.RES`'s own string resources
   (`"Set To Easy"`/`"Set To Moderate"`/`"Set To Hard"`, visible in
   `sprites/dh-hack/batch-000.png`'s UI banner row).
2. Seeds a PRNG (`seed_random`, `SEED.TXT`, `Seed=%08lX` banner) and
   generates a level.
3. Writes `LEVELS.DAT` (the generated maze), `FEA%02d.DAT` (per-level
   feature records), `ITEMS.DAT` (placed items) into the working directory
   — `HACK.BAT` runs it from inside `SAVEGAME/`, so these are per-save
   session state, not shipped assets (matches
   `game-re-lessons/save-file-not-asset.md` — none of these files exist in
   the shipped `SAVEGAME/` snapshot, confirming they're session-generated,
   not present pre-first-launch).

**Cross-confirmed against `HACK.RES`'s own content**: `MAZE.EXE`'s embedded
dungeon-feature name table (`"current door"`, `"door frame button"`,
`"illusionary wall"`, `"regular button"`, `"hidden button"`, `"current
lever"`, `"gem hole"`, `"solid wall"`, `"spike trap"`, `"floor pit"`,
`"ceiling pit"`, `"magical teleporter"`, `"current arch"`/`"window"`/
`"pillar"`/`"shelf"`, `"floor decoration"`, ...) matches **1:1** against
`HACK.RES`'s own `unknown`-classified (SOP class object) resource names
(§2.6) — i.e. the generator places features by these exact type names, and
`AESOP.EXE`'s `"dungeon"` class instantiates the matching SOP class object
by name when loading `FEA%02d.DAT`/`LEVELS.DAT`. This confirms the overall
two-process architecture (`ADDITIONAL_DH_RUNTIME_FUNCTIONS.TXT`'s
`load_level_map`/`get_feature_record`/`open_feature_file` functions, called
from the `"dungeon"` class, are the AESOP-side consumers of exactly these
files) without needing to disassemble the generation algorithm itself.

**Not attempted this pass** (genuinely out of scope for an asset-extraction
pipeline): the maze generation algorithm's internals, `SETTINGS.DAT`'s exact
byte layout, `LEVELS.DAT`/`FEA*.DAT`/`ITEMS.DAT`'s record formats — all
session-generated data with no fixed shipped instance to decode against.

---

## 7. `CHECKSYS.EXE` / `SOUND.EXE` / `NEWSCORE.EXE` — utility binaries, not decoded

`CHECKSYS.EXE` (memory checker, invoked by `HACK.BAT`), `SOUND.EXE` (sound
config utility, run standalone per `README.TXT`), `SAVEGAME/NEWSCORE.EXE`
(high-score utility, matching `SAVEGAME/HISCORE.DAT`/`HISCORE.DEF`) are
auxiliary tools, not game-data containers — not investigated this pass, no
asset content expected.

---

## Still open

| Item | Status | Notes |
|---|---|---|
| `old_format_bitmap` wall/sel region colour resolution — 97/632 (15%) | rendered (greyscale) | §3.3 — DAC mechanism and windows confirmed; no name/index cross-reference found to pick 1-of-21 wall/floor palettes or 1-of-14 Sel palettes per resource. Needs a bytecode trace of `set_palette` call sites (376+ SOP code objects, out of scope this pass — same boundary EOB3 drew around its own bytecode). |
| `OPEN.RES` screen→scene-palette assignment | rendered, spot-verified not exhaustive | §3.3 — no `"Fixed palette"` in `OPEN.RES`; falls back to `"Scene One Palette"` for every screen. Spot checks (DreamForge logo, Mage) render correctly; not checked resource-by-resource. |
| `pcm_sound` sample rate for Dungeon Hack's own build | hypothesis (8000 Hz) | §2.4 — inherited from EOB3/ThirdEye/MODSND32.C's "Eye III"-specific comment; Dungeon Hack's own compiled sound module wasn't in the downloaded archive. |
| `iff_cue` (`OPEN.RES`, 7 music resources) inner `CAT ` payload | not decoded | §2.7 — confirmed these are Adlib/Roland/PC music variants (not dialogue, correcting EOB3's guess), but the sequence data itself isn't decoded — playback data, same scope boundary as EOB3's GFF `*SEQ` tags. |
| `MAZE.EXE`'s generation algorithm, `SETTINGS.DAT`/`LEVELS.DAT`/`FEA*.DAT`/`ITEMS.DAT` record formats | not attempted | §6 — session-generated data, no fixed shipped instance; out of scope for an asset-extraction pipeline. |
| AESOP bytecode (SOP class objects) | not attempted | §2.6 — same boundary as EOB3; DAESOP's disassembler already covers this ground for anyone who wants to go further. |
| `sop_dict` bucket re-verification | inherited, not re-checked | §2.2 — assumed identical mechanism to EOB3 on the strength of the identical container format; not independently re-derived. |

---

## Paths tried

| Approach | Result | Why it stopped there |
|---|---|---|
| Try `eotb3lib/res.py` directly against `HACK.RES`/`OPEN.RES` before adapting anything | Worked completely unmodified — `file_size` field byte-exact, directory chain walks cleanly | Confirmed the container format needs zero adaptation; moved straight to content classification |
| Classify `HACK.RES` with EOB3's unmodified `classify.py` | `vfx_bitmap` count = 0 (unlike EOB3's 312); large `unknown`/`pcm_sound` buckets | EOB3's classifier has no detector for the "old format" bitmap directly inside the main container (EOB3 only ever sees that format inside GFF files) — led to §3's investigation |
| Decode `"Drawbridge"` sub-bitmap offset table as `u16` (EOB3's original field width) | First 3/6 sub-frames decode correctly (320×200); frames 3-5 produce garbage dimensions (1544×1285 etc.) | Offsets 3-5 exceed 65,535 — found the u16-vs-u32 bug (§3.1), fixed, regression-checked against all of EOB3's output (zero diff) |
| Blindly extend EOB3's `looks_like_pcm_sound`/`unknown` classification priority to Dungeon Hack unchanged | Several named graphics resources ("Floor Deco 08", "Portrait 2") misclassified as `pcm_sound` | Added `looks_like_old_format_bitmap` at higher priority in a new `dungeonhacklib/classify.py` (§2.5) rather than editing EOB3's own classifier (verified EOB3's own buckets have zero such false positives, so no fix needed there) |
| Interpret the `"8x8 font"`/`"6x8 font"`/`"Ornate font"` resources using EOB3's confirmed `CHARGEN/FONT6.FNT`/`FONT8.FNT` bit-packed layout (inherited assumption from EOB3's own "still open" note) | Header field (`sizeCheck = filesize-2`) doesn't match | Byte-ramp scan of the region after the 8-byte header found a fixed 256-byte identity table, then a second regular-looking `u16` table — decoded as remap-table + offset-table + proportional glyph records instead (§5), confirmed by rendering legible fonts and independently corroborated against DAESOP's `convert.c` |
| Assume `EYE.RES`'s DAC-region palette mechanism was EOB3-specific, requiring re-derivation from scratch for Dungeon Hack | N/A — found the real interpreter source instead | `GRAPHICS.C`'s `first_color[5]`/`num_colors[5]`/`fade_tables` confirmed the *mechanism* is shared engine code, just re-compiled per game; measured Dungeon Hack's own window boundaries empirically from its palette resources' pixel ranges instead of guessing |

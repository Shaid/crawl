# Ishar-engine sprite/image format (Silmarils "ALIS" VM)

Shared by all four titles in this corpus: Crystals of Arborea (1990),
Ishar 1 (1992), Ishar 2 (1993), Ishar 3 (1994) — all Amiga. Applies to the
**decompressed payload** of a `.DO`/`.CO` resource, once
`unpackSilmarilsScript()` (`tools/shared/silmarils-unpack.ts`,
`docs/ishar-container-format.md` §2.5) has stripped the container header.
Implemented in `tools/shared/ishar-sprites.ts`, batch pipeline in
`tools/shared/ishar-sprite-atlas.ts`.

**Confidence: CONFIRMED** — every mechanism below is ported directly from
`github.com/maestun/alis` (MIT), a real, source-available, from-scratch
reimplementation of the ALIS VM that the project's own README documents as
"Playable" for Ishar 1/2/3 on Amiga AGA specifically (the exact game+platform
combination in this corpus) — a Method §4 third-party-reimplementation
oracle. Applied blind to real corpus bytes with zero hand-tuning beyond the
ported formulas, and verified by genuinely recognizable rendered game art
(Method §4's "recognizable non-noise art" bar) — see §4 below.

## 1. Per-script resource directory (`adresdes()` in `alis.c`)

Every script's own decompressed bytes carry a small internal resource
directory, resolved via 2-level self-relative indirection:

```
offset 0x0E   u32 BE   dirOff        -- self-relative delta from FILE OFFSET 0
                                          to the directory header
--- at dirOff ---
offset +0     u32 BE   baseDelta     -- self-relative delta from `dirOff` to
                                          the slot array (see corpus values below)
offset +4     u16 BE   length        -- resource count
--- per-index slot, at dirOff + baseDelta + idx*4 (idx = 0..length-1) ---
offset +0     s32 BE   slotDelta     -- self-relative delta FROM THE SLOT'S OWN
                                          ADDRESS to the real bitmap header
```

`headerOffset = (dirOff + baseDelta + idx*4) + slotDelta`. This is a genuine
2-level indirection (slot address -> stored delta -> real header address),
not a flat pointer table — ported verbatim from `adresdes()`.

**The directory header holds more than the bitmap table** (2026-09-01
addition, from `alis.c`): `dirOff+0x00`/`+0x04` are the bitmap slot-array
delta + count used here, but `dirOff+0x06` (u32 BE, self-relative from
`dirOff`) + `dirOff+0x0a` (u16 BE count) are a second table of **"formes"**
(`adresform()` — collision/test shapes used by `cforme`/`ctstmov`-family
opcodes; a flat u16-offset array, one level of indirection, not two), and
further tables (music via `adresmus()`, etc.) follow the same pattern. Not
yet decoded for this corpus — noted so the "1144-byte gap" between the
directory header and the slot array isn't mistaken for padding.

**`baseDelta` corpus values**: observed as one of exactly two constants,
1144 or 88, across all four titles — consistent with a real, engine-fixed
directory-header size (not per-file tuning). `findIsharDirectory()` accepts
any `baseDelta` the file actually declares (no hardcoded allowlist); the two
recurring values are an empirical observation, not an enforced constraint.

**Rejection criteria** (`findIsharDirectory()`): `dirOff` must be in-range,
`length` must be `0 < length < 4096`. Per-slot, `resolveIsharSlot()` requires
the resolved `headerOffset` to be in-range; `decodeIsharBitmap()` additionally
requires `0 < width,height <= 2000` and the bitmap `type` byte to be one of
the six supported values (§2). Files/slots failing any of these are treated
as "no directory" / "unsupported entry", not an error — many `.DO` files are
scripts or tables with no image directory at all, and many directory slots
are placeholder (`type=0xff`) or genuinely-unimplemented-type entries.

## 2. Bitmap header + pixel encoding (`image.c`)

A resolved bitmap header:

```
offset +0   u8       type          -- see table below
offset +1   u8       (pad/flags, not part of the dimensions)
offset +2   s16 BE   storedWidth   -- real width  = storedWidth + 1
offset +4   s16 BE   storedHeight  -- real height = storedHeight + 1
```

> **Correction (2026-09-01):** this doc originally placed
> `storedWidth`/`storedHeight` at header+1/+3. The reference source reads
> them at **+2/+4** everywhere (`image.c:665-666` `read16(bitmap + 2)` /
> `read16(bitmap + 4)`, `image.c:1908-1909`, `script.c`'s Atari conversion
> loop), and the shipped decoder `tools/shared/ishar-sprites.ts` was
> already correct (`i16(data, headerOffset + 2)` / `+ 4`) — the error was
> prose-only. It bit for real once: a probe transcribed from this doc's
> +1/+3 misparsed `MAP.bin`'s 320×126 map image as "w=2, h=16129" (see
> `docs/ishar-container-format.md` §9.4).

Six supported `type` values, all confirmed present in this corpus:

| type | Reference name | Bank byte? | Pixel data starts at | Bits/pixel | Masked (idx 0 = transparent)? |
|---|---|---|---|---|---|
| `0x00` | `draw_st_4bit_0` | no | header+6 | 4 (nibble-packed) | yes |
| `0x02` | `draw_st_4bit_2` | no | header+6 | 4 (nibble-packed) | no (opaque) |
| `0x10` | `draw_4to8bit_0` | yes (`palOffset` @ header+6, +1 reserved) | header+8 | 4 (nibble-packed) | yes |
| `0x12` | `draw_4to8bit_2` | yes | header+8 | 4 (nibble-packed) | no (opaque) |
| `0x14` | `draw_8bit_0` | no (2 reserved bytes @ header+6-7) | header+8 | 8 (index/pixel) | yes |
| `0x16` | `draw_8bit_2` | no | header+8 | 8 (index/pixel) | no (opaque) |

- **4-bit rows** are `width/2` bytes; high nibble = first pixel, low nibble
  = second. Decoded index = `nibble == 0 ? 0 : palOffset + nibble` (types
  `0x10`/`0x12`) or the raw nibble (types `0x00`/`0x02`, no bank).
- **8-bit rows** are `width` bytes, one palette index per pixel, used as-is.
- **Masked types** (`0x00`/`0x10`/`0x14`) treat decoded index 0 as
  transparent (the reference draw routine never writes it — a real
  background-cutout convention for compositing sprites over scenery).
  **Opaque types** (`0x02`/`0x12`/`0x16`) draw index 0 like any other index.
- `0x00`/`0x02` ("raw 4-bit", no palette-bank byte) is the dominant type in
  **Crystals of Arborea** (an older/related-but-not-identical engine
  revision — Ishar 1-3 use it only for a small minority of entries).
  `0x10`/`0x12` (banked 4-bit) is the dominant type across **Ishar 1-3**.
  `0x14`/`0x16` (direct 8-bit) is common in **Ishar 3** specifically.

**Not implemented** (present in the reference source, not observed — or not
yet confirmed present — in this corpus): rectangle-fill types, Macintosh
1-bit mono, DOS CGA 2-bit, FLI-style video-frame delta types, and a
Transarctica/Robinson's-Requiem-specific map-tile renderer. Any bitmap
header with one of these type bytes, or a type byte not in the table above,
is skipped (`decodeIsharBitmap()` returns `null`) rather than misdecoded.

## 3. Batch pipeline

`extractSpriteAtlases(dataDir, game, platform)`
(`tools/shared/ishar-sprite-atlas.ts`): for every `.DO`/`.CO` file, decodes
the script, walks its directory (`decodeIsharDirectory()`), shelf-packs
every resolved bitmap into one atlas PNG (Method §3: greyscale render — see
§5, no real palette recovered), and writes:

- `public/assets/<game>/<platform>/sprites/<basename>.png` + `.json` sidecar
  (`{frames: [{name, x, y, w, h}], width, height}`)
- `manifest.json` upsert (`kind: 'atlas'`)
- `public/assets/<game>/<platform>/data/sprite-atlas-report.json` — per-file
  `{ok, decodedCount}` summary

CLI wrappers: `tools/ishar/amigaaga/sprites.ts`,
`tools/ishar2/amigaaga/sprites.ts`, `tools/ishar3/amigaaga/sprites.ts`,
`tools/crystalsofarborea/amiga/sprites.ts`.

## 4. Verification — corpus-wide results, confirmed by real recognizable art

| Title | Files with a valid directory | Sprites decoded |
|---|---|---|
| Ishar 1 | 74/98 | 1,608 |
| Ishar 2 | 119/137 | 2,244 |
| Ishar 3 | 113/136 | 2,744 |
| Crystals of Arborea | 31/36 | 905 |

Files without a valid directory are predominantly scripts/tables/text
resources with no image content at all (expected — not every `.DO`/`.CO`
file is a graphics resource, see `docs/ishar-container-format.md` §3).

**Visual confirmation** (Method §4's decisive bar — genuinely recognizable
art, not "looks structured"), via `Read` on the rendered PNGs:

- `public/assets/ishar/amigaaga/sprites/barbare.png` — clearly recognizable
  humanoid barbarian-warrior figures in multiple poses, carrying weapons.
- `public/assets/ishar/amigaaga/sprites/dragon.png` — clearly recognizable
  winged dragon creatures.
- `public/assets/ishar/amigaaga/sprites/arbre.png` (tree) and `orc.png` —
  a tree canopy+trunk silhouette and a hunched humanoid/monster silhouette
  respectively (both cited in the module's own doc comment from an earlier
  probe pass).
- `public/assets/crystalsofarborea/amiga/sprites/orc_elf.png` — clearly
  recognizable skeleton and humanoid figures (confirms the `0x00`/`0x02`
  raw-4-bit type, unique to this title's corpus).
- `public/assets/crystalsofarborea/amiga/sprites/arbre.png` — recognizable
  tree and bush silhouettes (a direct cross-title comparison point with
  Ishar 1's own `arbre.png`, both titles independently rendering
  recognizable trees from the same decoder).

This is real, decisive, non-statistical confirmation: the decode chain
(directory resolution -> bitmap header -> pixel unpack) is CONFIRMED for all
six supported types, across all four titles.

## 5. Real AGA colour palette — CONFIRMED (2026-09-01)

> **Correction:** superseding the "not yet recovered" verdict below (kept
> as the paths-tried record) — a real AGA colour palette IS now recovered
> and applied, for Ishar 1 CONFIRMED end-to-end and generalized (RENDERED)
> across all four titles. See `tools/shared/ishar-palette.ts` for the full
> derivation/implementation and its module doc for the exact source-level
> citations.

**The blocking question was never "what does a palette resource look
like"** (§5's old "paths tried" table already had that from `topalette()`'s
source) **— it was "which directory index holds it," which this session
sidestepped entirely** rather than tracing bytecode: every real palette
resource in this corpus carries a dedicated marker byte, `0xFE`, at its
resolved header offset (`paldata[0]`) — distinct from all six bitmap `type`
bytes (§2) and the `0xFF` placeholder marker. `findIsharPaletteSlotIndex()`
(`tools/shared/ishar-palette.ts`) scans a script's own directory for it
directly; no runtime index ever needs resolving. Confirmed empirically: 62
hits across Ishar 1's `.DO` corpus alone, 0 false positives against known
bitmap-type bytes, and every decoded result is a plausible, non-random RGB
table (see below) — including 15 monster/portrait scripts (`DRAGON.DO`,
`GEANT.DO`, `SKELET.DO`, `ZOMBI.DO`, ...) whose own `cpalette` call sites
disassemble to a literal `oimmb` operand landing EXACTLY on their own
`0xFE` slot (e.g. `DRAGON.DO 0x47 cpalette expr=oimmb(0x11)` → directory
index 17 → the `0xFE`-marked resource at file offset `0x3f3e`), which is
independent, disassembly-level confirmation that the marker-byte shortcut
finds the SAME resource the real VM's bytecode would.

**On-disk format** (`decodePaletteChunk()`, ported from `topalette()`'s
AmigaAGA branch, `image.c:254-331`): `paldata[1]` (`colors`) selects one of
two encodings. `colors === 0` → 16-colour Amiga/AmigaAGA-native nibble-packed
format (`paldata[2..2+32)`, byte0 low nibble = R, byte1 high/low nibbles =
G/B, each `<<4` to 8-bit — the classic Amiga 12-bit `$0RGB` colour-register
word). `colors !== 0` → AmigaAGA's own 24-bit RGB-triplet format:
`paldata[2]` = starting palette slot (`offset`), `count = colors + 1` raw
`(r,g,b)` byte triplets from `paldata[4]` onward, written to slots
`offset..offset+count-1` INCLUSIVE (an off-by-one trap if read as
`count = colors`).

**Which resource is "the" world palette**: `FOND.DO`'s own directory slot 8
(header offset `0x2f4e`, `0xFE`-marked) is a FULL 256-entry, 24-bit AGA
palette (`offset=0, count=256`) organized as 16 banks of 16 colours each —
a base UI bank, then material ramps for wood/ground (browns), foliage
(greens), fire/blood (a genuine 16-step red-to-orange gradient at bank 10),
magic/energy (a magenta-purple ramp at bank 11), sky/water (teal/blue
ramps), and more. This is a STRUCTURAL match for the "banked 4-bit" bitmap
convention (§2's `palOffset` field selects a 16-colour bank), and it is
near-identical to several OTHER location scripts' own embedded `0xFE`
copies — `GERDEP.DO`'s copy differs in only 6/256 entries, `FVILLE.DO`'s in
82/256 (plausibly a location-specific variant of the same base table) —
strong corroborating evidence this is the shared, engine-wide default
outdoor/interior palette, not a `FOND`-specific one-off. Every outdoor
location script (`FORET.bin`, `VILLAGE.bin`, `PLAINE.bin`, `RAMPART.bin`,
`TEMPLE.bin`) carries ZERO `0xFE` slots of its own (confirmed by directory
census) — they render entirely off this shared resource, consistent with
`docs/ishar-container-format.md`'s already-established convention that
`FOND.bin` is these scripts' one shared companion asset.

**Persistent-buffer semantics, confirmed from source and reproduced
faithfully**: `image.atpalet` (the VM's live palette buffer) is never
cleared between `topalette()` calls — each call only overwrites its own
`offset..offset+count-1` sub-range. `mergeIsharPalettes(own, fallback)`
reproduces this exactly: `FOND.bin`'s 256-entry world palette is the base,
and a script's own dedicated palette (e.g. a monster's 16-colour portrait
bank) overlays on top where it applies — this is a real simulation of what
the engine's palette buffer would hold at that moment, not a rendering
convenience.

**Applied and shipped**:
- `tools/shared/ishar-sprite-atlas.ts` (batch atlas pipeline, all 4 titles):
  resolves each file's own `0xFE` palette, falls back to a sibling
  `FOND.DO`/`FOND.CO`'s world palette, falls back to the existing
  normalized-greyscale render only if NEITHER resolves (no file's render
  regresses). Same decode counts as before (1608/2244/2744/931 sprites) —
  purely a rendering change. Result: **74/74 Ishar 1 atlases**,
  **74/119 Ishar 2**, **64/113 Ishar 3**, **12/33 Crystals of Arborea**
  atlases now render in real colour (`manifest.json`'s `hasPalette: true`).
  Ishar 2/3/Crystals don't ship a single shared `FOND.DO`/`FOND.CO` file
  (per-location backdrops instead, or none for Crystals), so only files
  with their OWN `0xFE` slot get colour there — a full world-palette
  fallback for those titles is unexplored, out of this session's scope
  (Ishar 1 was the target per the task brief).
- `tools/shared/ishar-firstperson.ts`: `LocationFrameOptions.palette`
  (optional, `IsharPalette` from `ishar-palette.ts`) threads through
  `compositeFrame()`/`blit()`; omitting it renders exactly as before (no
  regression to any existing caller, including the interactive walker,
  which is NOT yet wired to pass a palette — out of this session's scope).
- `tools/ishar/amigaaga/firstperson-preview.ts` (new, committed): renders
  one real `FORET.bin` frame (196 real sprite placements, the richest of
  every `CONT1` interior cell tried) with `FOND.bin`'s resolved world
  palette, shipped as `public/assets/ishar/amigaaga/screens/foret-color.png`
  + `.json` sidecar + manifest entry.

**Visual confirmation** (Method §4's bar — via `Read` on the rendered
PNGs, all genuinely plausible, none garish/random-looking):
- `sprites/dragon.png` (Ishar 1): a red/dark-red dragon — a real fire/scale
  colour scheme, not noise.
- `sprites/arbre.png` (Ishar 1, tree): green foliage canopies over brown
  trunks.
- `sprites/orc.png`/`sprites/barbare.png` (Ishar 1): tan/brown skin tones,
  dark leather/armor accents — real, plausible humanoid figure colouring.
- `sprites/dragon5.png` (Ishar 2): an orange/tan dragon amid yellow-orange
  fire/explosion frames.
- `sprites/death.png` (Crystals of Arborea): a dramatic burning-forest death
  screen — a skeletal figure rising against an orange/red fire sky, dark
  silhouetted trees — clearly deliberate, evocative artwork, not an
  arbitrary palette assignment.
- `screens/foret-color.png` vs. the same frame rendered greyscale
  (`tools/.scratch/foret-preview-grey.png`, not shipped): the greyscale
  version is illegible static noise for the backdrop panels; the colour
  version immediately reads as a blue sky with white clouds over a green
  grass field — a decisive readability improvement, not just "different
  colours."

**Confidence**: CONFIRMED for the on-disk format (direct source port) and
for the `0xFE` marker mechanism (corpus census + independent disassembly
cross-check on 15+ monster scripts' own literal `cpalette` operands).
RENDERED for the specific claim that `FOND.DO`'s slot 8 is THE single
canonical world palette used by every outdoor scene (strong circumstantial
evidence — near-identical embedded copies elsewhere, correct `palOffset`
alignment, decisive visual plausibility — but no bytecode trace pins a
`cpalette` call site loading this exact resource for `FORET.bin`
specifically, since outdoor scripts issue no `cpalette` call of their own
at all).

## Remaining open items

| Item | Status |
|---|---|
| Unimplemented bitmap types | Rect-fill, Mac 1-bit, DOS CGA, FLI-video-delta, and the Transarctica/RR map-tile renderer types (see §2) are not ported. Not confirmed present in this corpus, but not exhaustively ruled out either — the 82-90%-of-slots-resolve figure (module doc) suggests a real minority of directory entries use a type not implemented here, or are placeholder (`0xff`) slots. |
| Raw Amiga planar variant (`draw_ami_5bit_*`) | Named in the reference source's function list but not traced or tested against this corpus — not confirmed present or absent. |
| Ishar 2/3/Crystals world palette | No single shared `FOND`-equivalent file was checked for these titles (Ishar 1 was the task's target) — a full colour pass for them needs finding their own per-region/per-location world-palette convention, likely each location's own backdrop file's `0xFE` slot rather than one shared resource. |
| Interactive walker colour wiring | `ishar-firstperson.ts`'s `palette` option is implemented but not yet passed from `tools/walker/games-ishar.ts` (the live browser walker still renders first-person frames in greyscale) — deliberately out of scope this session to avoid touching a type shared across all 4 titles' walker wiring without re-verifying each one. |

### Paths tried (palette recovery)

| Approach | Result | Why it stalled / superseded |
|---|---|---|
| Static byte-pattern scan for a palette-shaped resource (16 or 256 RGB triplets) | Not attempted in the original session | Lower priority than pixel-format cracking per that session's brief; deferred |
| Reading `topalette()`'s AmigaAGA branch | Confirmed the FORMAT (`paldata[1]`=count, `paldata[2]`=bank offset, RGB triplets from `paldata[4]`) but not WHICH directory index holds it for any given scene | Superseded below — the index question turned out to be avoidable, not just traceable |
| Disassembling `cpalette`/`ctopalet` call sites across the Ishar 1 `.DO` corpus (`tools/shared/alis-disasm.ts`) | Found 38 real call sites; most in monster/portrait scripts resolve to a literal `oimmb` operand (directly usable), but `MAIN.DO`'s own 12 call sites resolve to a `basemain`-relative global byte (`omainb(0x21)`) or a runtime boolean condition (`odiff(oimmb(-1))`, `oegal(oimmb(-1))` choosing between "restore" and a literal slot) with no static write to that global found in this session's reached CFG | Correctly diagnosed as "runtime-computed for outdoor scenes specifically" — but turned out to be the wrong question to chase, since NO outdoor location script issues a `cpalette` call at all (see below) |
| Scanning every directory slot's resolved header for a palette-shaped signature (byte0, count/RGB-triplet sanity) instead of tracing bytecode | **SUCCEEDED** — `paldata[0] === 0xFE` is a clean, universal, zero-false-positive marker (62 hits, cross-checked against all known bitmap types) | This is the shipped mechanism — see the CONFIRMED section above |

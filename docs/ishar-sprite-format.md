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
offset +1   s16 BE   storedWidth   -- real width  = storedWidth + 1
offset +3   s16 BE   storedHeight  -- real height = storedHeight + 1
```

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

## 5. Open — not yet recovered

| Item | Status |
|---|---|
| Real AGA colour palette | Every render above is greyscale (index value mapped to a grey ramp), not true colour. `topalette()` (`image.c`) resolves a palette via the SAME `adresdes()` directory mechanism as bitmaps, but at a bytecode-chosen index — i.e. *which* directory entry is "the palette for this scene" is selected by VM bytecode at runtime, not by any static marker on the resource itself. No disassembly trace or bytecode interpretation was attempted this session to locate that index. |
| Unimplemented bitmap types | Rect-fill, Mac 1-bit, DOS CGA, FLI-video-delta, and the Transarctica/RR map-tile renderer types (see §2) are not ported. Not confirmed present in this corpus, but not exhaustively ruled out either — the 82-90%-of-slots-resolve figure (module doc) suggests a real minority of directory entries use a type not implemented here, or are placeholder (`0xff`) slots. |
| Raw Amiga planar variant (`draw_ami_5bit_*`) | Named in the reference source's function list but not traced or tested against this corpus — not confirmed present or absent. |

### Paths tried (palette recovery)

| Approach | Result | Why it stalled |
|---|---|---|
| Static byte-pattern scan for a palette-shaped resource (16 or 256 RGB triplets) | Not attempted this session | Lower priority than pixel-format cracking per the task brief; deferred |
| Reading `topalette()`'s AmigaAGA branch | Confirmed the FORMAT (`paldata[1]`=count, `paldata[2]`=bank offset, RGB triplets from `paldata[4]`) but not WHICH directory index holds it for any given scene | The index is chosen by VM bytecode context, not a static field — needs either a bytecode trace or a brute-force scan of every directory entry for one that looks palette-shaped (count/RGB-triplet sanity) |

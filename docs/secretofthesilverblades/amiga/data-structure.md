# Secret of the Silver Blades (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1990. Third of four sibling Gold Box titles
staged in this repo — see `docs/poolofradiance/amiga/data-structure.md` (the
original `.dax` format), `docs/curseoftheazurebonds/amiga/data-structure.md`
(the first sibling opened this pass, and the fuller writeup of the shared
"GLIB" container and its open per-wall-id tile-bank puzzle), and
`docs/poolsofdarkness/amiga/data-structure.md`.

Container format: **`docs/goldbox-glib-format.md`** (read that first).
Implementation: `tools/shared/goldbox-glib.ts`,
`tools/shared/goldbox-walltiles.ts`. Extractor:
`tools/secretofthesilverblades/amiga/export-data.ts`. Session history:
`docs/secretofthesilverblades/TODO.md`.

Raw data: `data/secretofthesilverblades/amiga/DISK1/`, `.../DISK2/`, plus a
`SAVE/` directory (out of scope) and the disk's own executable (`Secret`, not
opened this pass).

---

## 0. Container/codec CONFIRMED SAME AS Curse of the Azure Bonds, DIFFERENT from Pool of Radiance

Same base-filename correspondence as Curse (`WALLDEF.GLB`, `8X8D.TLB`,
`ALWAYS.TLB`, `COMSPR.TLB`, `BIGPIC.TLB`, `CBODY.TLB`, `CHEAD.TLB`,
`CPIC.TLB`, `DUNGCOM.TLB`, `ECL.GLB`, `GEO.GLB`, `ITEM.GLB`, `MONCHA.GLB`,
`MONITM.GLB`, `MONSPC.GLB`, `PIC.TLB`, `SKY.TLB`, `sounds.glb`, `SPRIT.TLB`,
`TITLE.TLB`, plus `ITEMS.DAT`, `SECRET.FON`, `SECRET.MX`, `SECRET.SLB`), and
the same "GLIB" container confirmed byte-for-byte identical to Curse's (see
`docs/goldbox-glib-format.md` for the shared format and its comparison
against Pool of Radiance's `.dax`). No new container/codec work was needed
for this title — it reuses `tools/shared/goldbox-glib.ts` unmodified.

## 1. "GLIB" container — CONFIRMED, 19/21 real `.GLB`/`.TLB` files; 2 truncated

`container-directory.json`: `totalGlibFiles: 21`, `structurallyOk: 19`,
`truncatedOrCorrupted: 2`. The 2 truncated files
(`DISK1/ALWAYS.TLB`, declared 31,226 B vs actual 18,426 B; `DISK2/TITLE.TLB`,
declared 69,278 B vs actual 53,674 B) are diagnosed as real floppy-dump
truncation/corruption, not a format divergence — see
`docs/goldbox-glib-format.md` §3 for the corpus-wide evidence (the same
`ALWAYS.TLB`/`TITLE.TLB` base filenames decode cleanly in other disk
images).

Non-`GLIB` files (out of scope, confirmed by magic-byte inspection):
`SECRET.FON` (raw font), `SECRET.SLB` (magic `"SLBR"`), `SECRET.MX` (magic
`"MXTX"` — a music format, DIFFERENT magic from Curse's `.SLB`, not
investigated further), `ITEMS.DAT` (flat record table).

## 2. `WALLDEF.GLB` — 156-byte wall-slice geometry CONFIRMED

`DISK2/WALLDEF.GLB` — 11 blocks (1 index + 10 real wall-type data blocks).
All 10 real entries' raw byte length is an exact multiple of 156 bytes, zero
remainder (`walldef-geometry.json`: `allMultipleOf156: true`, 10/10):

| id | byte length | slice count |
|---|---|---|
| 19, 6, 9 | 780 | 5 |
| 7, 10, 1, 15, 13 | 1,560 | 10 |
| 21, 3 | 2,340 | 15 |

Index ids `7, 10, 21, 19, 1, 6, 9, 15, 3, 13` — confirmed **NOT sorted** in
the index block (file order, not ascending id order — see
`docs/goldbox-glib-format.md` §2), a useful cross-check that
`decodeGlibIndex` doesn't assume ordering.

## 3. `8X8D.TLB` — same two-scheme split as Curse, same open puzzle

### 3a. `DISK1/8X8D.TLB` — flat universal(203)+specific(202) scheme, SMALLER bank than Curse's

Same 2-bucket structure as Curse's `DISKA/8X8D.TLB` (§3a in that title's
doc), but a much smaller flat bank: 1 placeholder + tiles from ids 202/203 =
**165 tiles total** (vs Curse's 371). This file is on `DISK1`, NOT
co-located with `DISK2/WALLDEF.GLB` — same caveat as Curse: not confirmed to
be the runtime-paired tile source.

**Rendered evidence, honestly weaker than Curse's**: `WALLDEF.GLB`'s own
tile indices mostly exceed this smaller bank's 165-tile range (the
extractor automatically skips any render whose max tile index falls outside
the bank — 29/95 candidate renders were skipped this way). The 66 renders
that DO fit (`public/assets/secretofthesilverblades/amiga/textures/`) are
real, non-garbage decoded output, but visually show a "salt-and-pepper"
speckled pattern rather than Curse's clearly-structured crenellation/door
motifs (compare `walldef-13-wall0-view6.png` here against Curse's
`walldef-16-wall0-view6.png`). **Labeled rendered, LOW confidence** — real
evidence the 8x8-tile PIXEL DECODE doesn't error or produce garbage-shaped
output, but not strong visual confirmation of a semantically-correct
tile-to-wall pairing (unlike Curse's cross-disk pairing, which happened to
produce clearly non-random structure).

### 3b. `DISK2/8X8D.TLB` — per-wall-id nested scheme (SOLVED — the payload is compressed)

> **Correction (2026-08-30, `re-codebreaker`):** the "identical boilerplate
> header" symptom recorded below is not boilerplate. **The nested payload is
> compressed**; the 16-byte header is genuine and describes the container
> *after* decompression, and the compression method is the **high byte of
> the `flags` word**. Every nested `"TILE"` sub-container in this file is
> method **5** (byte-oriented LZ77) — see `docs/goldbox-glib-format.md` §5
> and `tools/shared/goldbox-glib-codecs.ts`.
>
> All 19 entries decompress to exactly `totalSize - 16` = 3644 bytes, each a
> well-formed GLIB body of 70 blocks of exactly 48 bytes (6 raw 8-byte 1bpp
> tiles), monotonic offset table, zero deviation.
>
> This title supplied the decisive **byte-exact oracle** for the whole
> finding: `DISK1/8X8D.TLB` id 202 (242 compressed bytes, method 5)
> decompresses to 884 bytes **identical, 884/884, zero deviation**, to
> Curse's `DISKA/8X8D.TLB` id 202, which is stored uncompressed. The two
> games ship the same universal tile bank, one packed and one not.
>
> The original write-up follows; its "paths tried" rows remain valid as
> refuted hypotheses, but both shared the wrong premise that the on-disk
> bytes are the container image.

> **Update (2026-08-30, same session): wired into the extractor — 95/95
> wall-view PNGs, using this file (not §3a's weaker cross-disk substitute).**
> Same `buildWallSpecificTileBank`/`resolveCompositeWallId` mechanism as
> Curse: `[placeholder, ...universal(id 203, from DISK1), ...specific(this
> wall's own composite id, from DISK2, decompressed)]`. Written as
> `walldef2-<id>-wall<n>-view6.png`, alongside the original `walldef-*` set.
> 90/95 are non-degenerate; 5 render as flat placeholder (a legitimate
> "nothing to draw" view, not an error — 0 "no scheme-2 entry" misses, 0
> out-of-range skips). Uses the same `SLICES_PER_WALLSET=5` composite
> chunking fix Curse's integration needed (`goldbox-glib-export.ts`) —
> confirmed here too via the composite-id table above (e.g. id 21's 3
> wallsets = 15 slices ÷ 5, resolving to 211/212/213 one chunk each, not one
> composite id per slice).

### 3b-old. `DISK2/8X8D.TLB` — per-wall-id nested scheme, SAME unresolved layout as Curse

`DISK2/8X8D.TLB` (co-located with `WALLDEF.GLB`) uses the same per-wall-id
nested scheme as Curse's `DISKB/8X8D.TLB` (§3b in that title's doc), with
the **identical composite-id arithmetic** confirmed independently here:
index ids `71, 72, 101, 102, 211, 212, 213, 19, 6, 9, 11, 12, 151, 152, 31,
32, 33, 131, 132` (19 total) decompose exactly as:

| WALLDEF id | wallsets needed | composite ids present |
|---|---|---|
| 7 | 2 | 71, 72 |
| 10 | 2 | 101, 102 |
| 21 | 3 | 211, 212, 213 |
| 19 | 1 (direct) | 19 |
| 1 | 2 | 11, 12 |
| 6 | 1 (direct) | 6 |
| 9 | 1 (direct) | 9 |
| 15 | 2 | 151, 152 |
| 3 | 3 | 31, 32, 33 |
| 13 | 2 | 131, 132 |

All 19 composite/direct ids accounted for with zero leftover — a second,
independent confirmation (beyond Curse's own) that Pool of Radiance's
`10*id+n` multi-wallset arithmetic is a genuine, engine-wide convention, not
a Curse-specific coincidence.

**The exact per-entry byte layout inside this scheme is unresolved here
too** — same symptom as Curse (§3b there): every nested sub-container's own
header declares the identical `totalSize=3660, blockCount=70` regardless of
the outer directory's own varying allocated span, and a fixed-header-skip
raw-tile decode (tested at N=16 for wall id 6, the simplest direct-single-id
case) produces a sane index range but a visually noisy, non-coherent
"zigzag" pattern (`secret_wall6_hdr16.png`, scratch-only, not shipped) —
the same failure signature as Curse's own attempts. This is now **2
independently-titled instances of the identical open puzzle** (Curse +
Secret), strengthening the case that it's a real, consistent format detail
this pass didn't crack, not a one-off oddity. See
`docs/secretofthesilverblades/TODO.md`.

## 4. Full file catalog — not attempted this pass

Same scope note as Curse (§4 there) — only the outer GLIB container
structure is validated corpus-wide; individual files' semantic content is
not catalogued.

## 5. Extractor and outputs

```
npx tsx tools/secretofthesilverblades/amiga/export-data.ts data/secretofthesilverblades/amiga
```

Writes to `public/assets/secretofthesilverblades/amiga/`:

- `data/container-directory.json` — 19/21 OK, 2 truncated.
- `data/walldef-geometry.json` — 10/10 entries confirmed multiples of 156.
- `textures/walldef-<id>-wall<n>-view6.png` — 66 renders (29 candidates
  skipped as out-of-bank-range) using the §3a flat tile bank — LOW
  confidence, see §3a.
- `textures/walldef2-<id>-wall<n>-view6.png` — 95 renders (0 skipped) using
  §3b's now-decodable per-wall-id scheme, the pairing WALLDEF is actually
  keyed to at runtime. Higher confidence than the `walldef-*` set.

`manifest.json` carries 192 entries (190 texture PNGs + 2 data JSON
records).

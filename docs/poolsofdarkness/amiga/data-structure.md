# Pools of Darkness (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1991. Fourth and last sibling Gold Box title
staged in this repo — see `docs/poolofradiance/amiga/data-structure.md` (the
original `.dax` format) and `docs/curseoftheazurebonds/amiga/data-structure.md`
/ `docs/secretofthesilverblades/amiga/data-structure.md` (the two other
sibling titles opened this same pass, sharing the "GLIB" container this doc
also uses).

Container format: **`docs/goldbox-glib-format.md`** (read that first).
Implementation: `tools/shared/goldbox-glib.ts`,
`tools/shared/goldbox-walltiles.ts`. Extractor:
`tools/poolsofdarkness/amiga/export-data.ts`. Session history:
`docs/poolsofdarkness/TODO.md`.

Raw data: `data/poolsofdarkness/amiga/DISK1/`, `.../Disk2/`, `.../Disk3/`,
plus a `Save/` directory (out of scope) and the disk's own executable
(`Pools of Darkness`, not opened this pass) — this is a 3-disk title, one
more disk than Curse/Secret's 2, reflecting its larger asset corpus (e.g.
`ECL.GLB` is 319,444 B here vs Curse's 138,562 B).

---

## 0. Container/codec CONFIRMED SAME AS Curse/Secret, DIFFERENT from Pool of Radiance

Same base-filename correspondence and the same "GLIB" container confirmed
byte-for-byte identical to Curse and Secret's (see
`docs/goldbox-glib-format.md`). File set: `WALLDEF.GLB`, `8X8D.TLB`
(`Disk2`), `8X8DA.TLB` (`DISK1` — note the distinct name, see §3), `ALWAYS.TLB`,
`COMSPR.TLB`, `BACK.TLB`, `BIGPIC.TLB`, `CPIC.TLB`, `DUNGCOM.TLB`,
`CBODY.TLB`, `CHEAD.TLB`, `ECL.GLB`, `FINAL.TLB`, `FRAME.TLB`, `GEN.TLB`,
`GEO.GLB`, `INTRO.TLB`, `MONCHA.GLB`, `PIC.TLB`, `SKYGRND.TLB`, `SOUNDS.GLB`,
`SPRIT.TLB`, `TITLE.TLB`, `WILDCOM.TLB`, plus **two** item files
(`ITEM.DAT` AND `ITEMS.DAT`, both present — not investigated which one is
the real/active table).

## 1. "GLIB" container — CONFIRMED, 19/24 real `.GLB`/`.TLB` files; 5 truncated

`container-directory.json`: `totalGlibFiles: 24`, `structurallyOk: 19`,
`truncatedOrCorrupted: 5` — the highest truncation count of the three
sibling titles (`DISK1/ALWAYS.TLB`, `DISK1/COMSPR.TLB`,
`Disk3/CBODY.TLB`, `Disk3/CHEAD.TLB`, `Disk3/GEN.TLB`). See
`docs/goldbox-glib-format.md` §3 for the corpus-wide evidence this is
per-disk-image dump damage, not a format divergence — notably, `CBODY.TLB`
and `CHEAD.TLB` decode perfectly cleanly in BOTH Curse's and Secret's own
copies, isolating the corruption to this specific title's `Disk3` image.

Non-`GLIB` files (out of scope): `pod.fon` (raw font), `pod.mx` (magic
`"MXTX"`, same as Secret's `.MX`), `ITEM.DAT`/`ITEMS.DAT` (flat record
tables, magic bytes confirmed non-GLIB).

## 2. `WALLDEF.GLB` — 156-byte wall-slice geometry CONFIRMED; a real format simplification vs. Curse/Secret

`Disk2/WALLDEF.GLB` — 7 blocks (1 index + 6 real wall-type data blocks). All
6 real entries' raw byte length is an exact multiple of 156 bytes, zero
remainder (`walldef-geometry.json`: `allMultipleOf156: true`, 6/6):

| id | byte length | slice count |
|---|---|---|
| 1, 2, 3, 4, 5, 6 | 2,340 | 15 |

**Notable divergence from Curse/Secret**: every single one of Pools' 6 wall
types has exactly 15 slices (3 wallsets' worth) packed into ONE outer
directory entry — unlike Curse/Secret, which split multi-wallset walls
across SEPARATE composite `10*id+n` directory entries (Curse's ids 14/17,
Secret's ids 1/3/7/10/13/15/21). Pools' `WALLDEF.GLB` index is a plain
direct 1:1 map (`{1:1, 2:2, 3:3, 4:4, 5:5, 6:6}`, confirmed non-composite)
— a real format simplification in this later (1991) title, not a decode
error: the underlying 156-byte slice geometry and 10-view sub-array layout
are identical either way, just addressed differently at the directory
level.

## 3. `8X8D.TLB`/`8X8DA.TLB` — same two-scheme split as Curse/Secret, but no working flat bank this time

### 3a. `DISK1/8X8DA.TLB` — flat-scheme file (was misread as degenerate; it is compressed)

> **Correction (2026-08-30, `re-codebreaker`):** this file is not degenerate.
> Its id-202 nested sub-container is method-**5** compressed (`flags = 0x0500`
> → method `5`, `docs/goldbox-glib-format.md` §5); reading it without
> decompressing is what produced "zero usable tiles". Decompressed it is a
> normal, healthy bank: 1168 bytes, 21 blocks — one 104-byte block 0 plus 20
> blocks of exactly 48 bytes (6 raw 8-byte 1bpp tiles each), monotonic offset
> table, zero deviation. The "no PNG render produced for this title" note
> below is likewise obsolete.

### 3a-old. `DISK1/8X8DA.TLB` — degenerate/near-empty flat-scheme file (NOT usable)

`DISK1/8X8DA.TLB` (note the extra `A` — a distinct filename from `Disk2`'s
`8X8D.TLB`) uses the same outer shape as Curse/Secret's flat-bucket files
(index block + 1-2 data blocks), but its index has only ONE entry
(`{id: 202, blockIndex: 1}` — no id 203 at all), and that single id-202
block's own nested sub-container decodes to **zero usable tiles** (an
empty/degenerate nested `"TILE"` sub-container). Checked directly: building
a flat tile bank from this file yields only the 1 grey placeholder tile,
with every real `WALLDEF.GLB` tile index (which reach into the hundreds)
falling out of range. **No PNG render was produced for this title this
pass** — see `tools/poolsofdarkness/amiga/export-data.ts`'s module doc.

### 3b. `Disk2/8X8D.TLB` — per-wall-id nested scheme (SOLVED — the payload is compressed)

> **Correction (2026-08-30, `re-codebreaker`):** the "identical boilerplate
> header" symptom recorded below is not boilerplate. **The nested payload is
> compressed**; the 16-byte header is genuine and describes the container
> *after* decompression, and the compression method is the **high byte of
> the `flags` word**. Every nested `"TILE"` sub-container in this file is
> method **5** (byte-oriented LZ77) — see `docs/goldbox-glib-format.md` §5
> and `tools/shared/goldbox-glib-codecs.ts`.
>
> All 6 entries decompress to exactly `totalSize - 16` = 15472 bytes (two
> 0x2000-byte codec chunks each — this is the only file in the corpus large
> enough to exercise the driver's multi-chunk path), each a well-formed GLIB
> body of 257 blocks: block 0 is 104 bytes and blocks 1-256 are **exactly 56
> bytes** each (7 raw 8-byte 1bpp tiles), monotonic offset table, zero
> deviation. `DISK1/8X8DA.TLB` id 202 has the same shape at smaller scale
> (one 104-byte block 0 + 20 blocks of 48 bytes).
>
> The original write-up follows; its "paths tried" rows remain valid as
> refuted hypotheses, but both shared the wrong premise that the on-disk
> bytes are the container image.

> **Update (2026-08-30, same session): wired into the extractor — 90/90
> wall-view PNGs, this title's first real texture output.** Since Pools'
> own `Disk2/8X8D.TLB` maps WALLDEF ids directly (§2's simplification, no
> composite ids), the extractor tries the WALLDEF id directly FIRST before
> ever falling back to `10*id+n` composite arithmetic — this generalizes the
> same code path Curse/Secret use without any title-specific branching (see
> `tools/shared/goldbox-glib-export.ts`). No universal (id 203) bucket
> exists in this file, so the bank is `[placeholder, ...specific(this
> wall's own id, decompressed)]` only. Written as `walldef2-<id>-wall<n>-
> view6.png`. 83/90 non-degenerate (7 render flat placeholder — a
> legitimate "nothing to draw" view for some slices, not an error); 0 "no
> scheme-2 entry" misses, 0 out-of-range skips. `walldef2-1-wall0-view6.png`
> shows a clear repeating diagonal/herringbone pattern, not noise.

### 3b-old. `Disk2/8X8D.TLB` — per-wall-id nested scheme, SAME unresolved layout as Curse/Secret, but no composite ids needed

`Disk2/8X8D.TLB` (co-located with `WALLDEF.GLB`) uses the same per-wall-id
nested-GLIB scheme as Curse/Secret's own `8X8D.TLB` files, but — consistent
with §2's simplification — its index is also a plain 1:1 map matching
`WALLDEF.GLB`'s own ids directly (`{1:1, 2:2, 3:3, 4:4, 5:5, 6:6}`), with NO
`10*id+n` composite ids needed (since Pools never splits a wall's wallsets
across separate directory entries in the first place — §2). Each id's
nested sub-container declares an identical boilerplate header
(`totalSize=15,488, blockCount=257`) across all 6 entries, regardless of the
outer directory's own varying (6,812-9,146 byte) allocated span for that
entry — **the same open puzzle documented in Curse's
`docs/curseoftheazurebonds/amiga/data-structure.md` §3b and Secret's
`docs/secretofthesilverblades/amiga/data-structure.md` §3b**, now confirmed
present in a THIRD, independently-checked title, with a different
game-specific constant (15,488/257 here vs. 3,660/70 in Curse/Secret) — this
rules out "3,660/70 is a Curse-and-Secret-specific hardcoded value" and
supports "this is a real, per-game-build template constant whose semantic
role is still unresolved," not corruption or coincidence. Not re-attempted
with a fresh header-skip sweep this pass (Curse's and Secret's identical
symptom already exhausted 2 well-formed hypotheses with concrete negative
evidence — see those docs).

## 4. Full file catalog — not attempted this pass

Same scope note as Curse/Secret — only the outer GLIB container structure
is validated corpus-wide; individual files' semantic content is not
catalogued. `ITEM.DAT` vs `ITEMS.DAT`'s relationship is also unresolved
(both present, neither opened).

## 5. `GEO.GLB` — the dungeon/city 16x16 square grid (the maze data)

**CONFIRMED for wall/door connectivity, OPEN for wall-art selection.** 32
levels, each a 1024-byte record (four 256-byte planes over a 16x16 grid).
Plane 3 is a confirmed 2-bit-per-direction (N/E/S/W) wall/door/other code,
verified via a cross-title shared-wall self-consistency oracle at
96.6%/95.1% (horizontal/vertical agreement) on this title specifically.
Planes 0/1 (candidate wall-art selectors) remain open, escalated to
`re-oracle`. Full writeup and cross-title verification table:
`docs/goldbox-glib-format.md` §7. Implementation:
`tools/shared/goldbox-geo.ts`; extractor wiring:
`tools/shared/goldbox-glib-export.ts`'s `geoPath` option (this title passes
`Disk3/GEO.GLB`). See `docs/poolsofdarkness/TODO.md`.

> **Correction (2026-08-31, `re-oracle` escalation):** planes 0/1 are now
> CONFIRMED (wall-art TYPE per direction, 0-15, indexing a level-scoped
> ECL-loaded wallset table) and plane 3's value labels were corrected
> (0=solid/blocked, 1=passable, 2/3=locked door — the original 0=open/
> 1=wall/2=door guess had the right bit layout but backwards meanings). See
> `docs/goldbox-glib-format.md` §7.2's correction block for the full
> source-cited derivation.

### 5.1 Wallset-slot binding — OPEN (0/32 levels, genuine engine-revision difference, not a decode bug)

`Disk3/ECL.GLB` (same GLIB container, same bytecode VM,
`tools/shared/goldbox-ecl.ts`) was wired into this extractor (`eclPath`)
but resolves **0 of 32** levels' wallset slots statically — a real,
confirmed engine-revision difference, not a gap in the decode. Every
header entry point resolves in-range and disassembles cleanly (0 unknown
opcodes), and `LOAD PIECES` (opcode `0x37`) calls ARE found (5 blocks) via
the worklist-based reachability walk, but every one of them uses a
memory-dereferenced (dynamic) operand rather than a literal id — Pools of
Darkness's engine revision computes wallset ids at runtime rather than
hardcoding them per level. Full writeup and cross-title coverage table:
`docs/goldbox-glib-format.md` §7.4. Tracked as `pod-wallset-ecl-binding` in
`docs/poolsofdarkness/TODO.md`. Levels fall back to `GoldBoxView`'s
existing per-level placeholder texture.

## 6. Extractor and outputs

```
npx tsx tools/poolsofdarkness/amiga/export-data.ts data/poolsofdarkness/amiga
```

Writes to `public/assets/poolsofdarkness/amiga/`:

- `data/container-directory.json` — 19/24 OK, 5 truncated.
- `data/walldef-geometry.json` — 6/6 entries confirmed multiples of 156.
- `textures/walldef2-<id>-wall<n>-view6.png` — 90 composited wall-view
  renders (0 skipped), this title's first real texture output — see §3b's
  update block.

- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 32 decoded GEO levels (§5) + the level list and
  wall-texture index the walker (`tools/walker/games-goldbox.ts`) loads.

`manifest.json` carries 92 entries (90 texture PNGs + 2 `data/` JSON
records); the `dungeon/` outputs are consumed directly by the walker and
are not part of `manifest.json`.

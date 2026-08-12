# Investigation: `WFONT1-4.EGA` and `WPORT1-3.EGA`

Status: **both formats solved** (confirmed via disassembly trace + legible
rendered output). This file is a standalone investigation note; it does
**not** edit `docs/wizardry6/amiga/data-structure.md` (per task scope --
concurrent agents were editing that file) and should be merged into that
document's section 5 (superseding the "open" status of 5.2/5.3) by a
follow-up pass.

Confidence levels follow the project convention: **confirmed** (verified
against an independent oracle), **rendered** (visually coherent, plausible,
not independently cross-checked beyond the render itself), **hypothesis**.

---

## Method

Both formats were cracked the same way the `.PIC` cel drawer was (see
`data-structure.md` section 1.4): rather than guessing dimensions blind
(which is what every previous pass on these two formats did, see the
"paths tried" tables in `data-structure.md` 5.2/5.3), the actual filename
string references were located in the `Bane` CODE hunk, then traced forward
through the shared **A4 jump table** (`A4 = DATA_hunk_file_start + 0x7FFE`,
`JSR d16(A4)` resolves via a 6-byte-per-entry `JMP.L` trampoline table at
the start of the DATA hunk's payload) to the actual loader/consumer code,
reading real width/height/stride constants directly out of the
disassembly.

All CODE offsets below are **file-relative minus `0x28`** (the CODE hunk's
payload starts at file offset `0x28`; i.e. "CODE+0xNNNN" = file offset
`0x28 + 0xNNNN`), consistent with the rest of `data-structure.md`.

One correction to the escalation-ladder/how-to-read-r2-output note for future
sessions: `radare2`'s disassembly of `(d16,PC)`-mode operands (e.g.
`pea.l 0x67c6(pc)`) prints the **already-resolved absolute target address**,
not the raw 16-bit displacement encoded in the instruction. Don't re-add
`instr_addr + 2 + displayed_value` on top of that -- the displayed value
*is* the target. (This cost one wasted round of pointer-chasing early in
this session, computing bogus targets like `0x350e` from a value that was
already the resolved target `0x16b4`.)

---

## `WPORT1.EGA`-`WPORT3.EGA` -- **confirmed**

### Summary

Each 4096-byte file is a flat, headerless array of **14 portrait records,
288 bytes each** (`14 * 288 = 4032`; the trailing 64 bytes are verified
all-zero padding in all 3 files). Each 288-byte record is **9 tiles in the
exact `.PIC` cel tile encoding** (`data-structure.md` section 2.3: 8x8px,
4 bitplanes, plane-major, MSB-first, 32 bytes/tile), arranged **3 tiles
wide x 3 tiles tall** (row-major) -- a 24x24 pixel portrait.

Despite only `WPORT1.EGA` existing as a literal string anywhere in the
binary (`WPORT2.EGA`/`WPORT3.EGA` were not found by a plain string search
in earlier passes -- see `data-structure.md` section 1.1, "3 near-identical
copies"), **all 3 files are real and load correctly**: the game builds
`WPORT2.EGA`/`WPORT3.EGA`'s filenames at runtime by patching a single digit
byte in a copy of the `"WPORT1.EGA"` string template (see below) -- they
were never going to show up in a static string scan.

### Trace

Filename occurrences (file offsets, from `data-structure.md` section 1.1):
`WPORT1.EGA` appears (with `.CGA`/`.T16` siblings) at 3 near-identical call
sites, CODE+0x67c6, CODE+0x2f7c2, CODE+0x383c2 (hunk-relative). All three
were checked; the math below is byte-identical across all three (same
`divs.w #0xe` / `muls.w #0x9` constants at each site) -- they are 3 call
sites for the same portrait-loading routine, not 3 different formats.

**1. Platform/filename selection + digit patch** (traced at CODE+0x6692):

```
CODE+0x669e  pea.l   CODE+0x67c6(pc)      ; "WPORT1.EGA" (EGA variant)
CODE+0x66a2  pea.l   -0xc(a5)             ; local filename buffer
CODE+0x66a6  jsr     -0x7d94(a4)          ; entry 103 -> CODE+0x54cac = strcpy(dst,src)
CODE+0x66ac  move.w  #0x20, -0xe(a5)      ; bytes/tile = 32 (4-plane EGA tile)
  ... (CGA/T16 variants: bytes/tile = 16 for the 2-plane CGA case)
CODE+0x6712  move.w  0x8(a5), d0          ; d0 = portrait_id (function arg)
CODE+0x6718  divs.w  #0xe, d0             ; portrait_id / 14
CODE+0x671c  add.w   #0x31, d0            ; + '1' (0x31)
CODE+0x6720  move.b  d0, -0x7(a5)         ; patch byte 5 of "WPORT1.EGA" (the '1')
CODE+0x6724  move.w  0x8(a5), d0
CODE+0x672a  divs.w  #0xe, d0             ; DIVS leaves quotient(lo)/remainder(hi) in d0
CODE+0x672e  swap    d0                   ; remainder = portrait_id % 14
CODE+0x6730  move.w  d0, 0x8(a5)          ; overwrite the arg slot with the in-file index
```

This is the reason `WPORT2.EGA`/`WPORT3.EGA` never show up as literal
strings: `"WPORT1.EGA"` is copied into a stack buffer and its `'1'` byte
(offset 5 within the string) is overwritten with `'1' + portrait_id/14`
before the open call. `portrait_id` ranges enough to produce quotients
0/1/2 -> exactly the 3 shipped files.

**2. Open + seek + read + close** (same function, continuing):

```
CODE+0x673a  pea.l   -0xc(a5)             ; patched filename
CODE+0x673e  jsr     -0x7f50(a4)          ; entry 29 -> CODE+0xf66 = Open(name)
CODE+0x6746  jsr     -0x7d64(a4)          ; entry 111 -> CODE+0x54e40 (fh helper)
CODE+0x674c  move.w  d0, -0x2(a5)         ; file handle
CODE+0x6762  clr.w   -(a7)                ; seek mode = 0
CODE+0x6764  move.w  0x8(a5), d0          ; d0 = in-file index (0..13)
CODE+0x6768  muls.w  -0xe(a5), d0         ; * bytes/tile (32)
CODE+0x676c  muls.w  #0x9, d0             ; * 9 tiles/record = byte offset (288*index)
CODE+0x6778  jsr     -0x7d6a(a4)          ; entry 110 -> CODE+0x54db0 = Seek(fh, offset, mode)
CODE+0x677e  move.w  -0xe(a5), d0         ; bytes/tile (32)
CODE+0x6782  muls.w  #0x9, d0             ; * 9 = 288 (read length)
CODE+0x6790  jsr     -0x7d5e(a4)          ; entry 112 -> CODE+0x54f86 = Read(fh, buf, len)
CODE+0x679a  jsr     -0x7d10(a4)          ; entry 125 -> CODE+0x5585c = Close(fh)
```

`Seek`'s own body (CODE+0x54db0) confirms the caller's `mode=0` becomes
AmigaDOS `OFFSET_BEGINNING` internally (`subq.l #1,d0` on the mode before
the real dos.library `Seek()` call: `0 - 1 = -1 = OFFSET_BEGINNING`) --
i.e. this is a flat, absolute `index * 288` byte offset from file start,
**no header**. This matches the confirmed structural fact that byte 0 of
every `WPORT*.EGA` file is portrait record 0's tile data directly.

**3. Install into the shared tile buffer** (CODE+0x1e9a, called with
literal case constant `2` and tile count `9`):

```
CODE+0x1ea2  cmp.b   #1/2/3, 0xc(a5)      ; pick one of 4 static buffer-pointer slots
CODE+0x1ece  move.w  0xe(a5), d0          ; dest slot index = caller's (slot*9+72)
CODE+0x1ed2  lsl.l   #5, d0               ; * 32 (bytes/tile)
CODE+0x1ed8  move.w  0x10(a5), d3         ; tile count = 9
CODE+0x1edc  lsl.l   #5, d3               ; * 32 = 288 bytes
CODE+0x1ee4  move.b  (a0)+,(a1)+ / dbra   ; flat byte copy, 288 bytes
```

This confirms the record really is 9 tiles (288 bytes), copied as a flat
run into a shared static tile-work buffer -- the same buffer-selection
mechanism (and literally the same 4 buffer-pointer slots at CODE-hunk
addresses `0x16b4`/`0x16c0`/`0x16cc`/`0x16d8`/`0x16e4`) that `WFONT1-4.EGA`
load into (see below). The exact 3x3 tile grouping isn't stated anywhere
in this copy step (it's just a flat 9-tile memcpy) -- it's confirmed by
**rendering**, not by an explicit width field.

### Verification

Rendered all 42 portraits (14 x 3 files) at 3 candidate tile arrangements
that all satisfy "9 tiles, 32 bytes each": 3-wide/3-tall, 9-wide/1-tall,
1-wide/9-tall. Only 3x3 produces coherent images -- 42/42 portraits are
unambiguous small (24x24px) character/monster face icons: humanoid faces
of various skin tones, a lizardman with green scales, a bearded dwarf,
helmeted/armoured figures, a cat-like face, hooded figures, robots. The
9x1 and 1x9 arrangements produce visibly scrambled/discontinuous strips
(spot-checked, not systematically scored). Colours use the confirmed
`.PIC` palette (`data-structure.md` section 2.4) directly, index 15
rendering as the same transparent cyan background `.PIC` cels use.

Structural invariants, zero deviation across all 3 files:
- File size 4096 bytes exactly.
- `14 * 288 = 4032`; trailing 64 bytes all-zero in all 3 files.
- The 3 independent loader call sites (CODE+0x6692, ~0x2f6c0, ~0x38310) use
  byte-identical `divs.w #0xe` (14) / `muls.w #0x9` (9) constants -- not
  just consistent by inspection of one site.

This is **confirmed**, not merely rendered: the record size (288 bytes),
record count (14), and tile size (32 bytes) all come directly from
disassembled immediate constants (not guessed), and the resulting geometry
independently produces recognisable face art -- two independent lines of
evidence agreeing.

### Not resolved this pass

- Which specific portrait (by race/monster/character) each of the 14
  slots in each file corresponds to. No character-record/portrait-index
  cross-reference was traced (would need `scenario.dbs`'s race/monster
  tables, out of scope here).
- The exact semantics of the "case" constant (1/2/3/default -> one of 4
  static buffer-pointer slots) beyond "which shared scratch buffer" --
  i.e. why WPORT specifically always uses case `2`, and what determines
  which of the 3 near-identical loader call sites fires in which UI
  context (character roster? combat? inn?). Not traced -- the 3 call
  sites were confirmed structurally identical, not semantically
  distinguished.

---

## `WFONT1.EGA`-`WFONT4.EGA` -- **confirmed**

### Summary

Despite the "font" naming (and being grouped with the real, confirmed
`WFONT0.EGA` glyph font in `Bane`'s master filename table), these 4 files
are **not glyph sheets**. Each is a flat, headerless array of **128 tiles**
in the exact `.PIC` cel tile encoding (8x8px, 4 planes, plane-major,
32 bytes/tile): `128 * 32 = 4096`, matching the file size exactly with
zero remainder.

### Trace

All 5 filenames (`WFONT0.EGA`-`WFONT4.EGA`) are referenced from one place,
CODE+0x49a2-0x49e4, each preceded by pushing its numeric index (0-4):

```
CODE+0x49a4  pea.l   CODE+0x4c87(pc)      ; "WFONT0.EGA"
CODE+0x49a8  jsr     CODE+0x4408(pc)      ; loader(name)  [index 0 implicit via -(a7) push above]
...
CODE+0x49ae  move.w  #1, -(a7)            ; index = 1
CODE+0x49b2  pea.l   CODE+0x4c92(pc)      ; "WFONT1.EGA"
CODE+0x49b6  jsr     CODE+0x4408(pc)
... (same pattern for index 2/3/4 -> WFONT2-4.EGA)
```

`CODE+0x4408` opens the file, calls a sub-loader (`CODE+0x1e38`) with
`(handle, index)`, then closes. `CODE+0x1e38` switches on `index`:

```
CODE+0x1e42  tst.b/cmp.b index, 0/1/2/3   ; else = 4
CODE+0x1e58  movea.l CODE+0x16b4(pc), a0  ; index 0 -> buffer ptr slot A ("WFONT0" buffer)
CODE+0x1e5c  move.w  #0x400, d0           ; read length 1024 (matches confirmed WFONT0.EGA size)
CODE+0x1e62  movea.l CODE+0x16c0(pc), a0  ; index 1 -> buffer ptr slot B
CODE+0x1e66  move.w  #0x1000, d0          ; read length 4096
CODE+0x1e6c  movea.l CODE+0x16cc(pc), a0  ; index 2 -> buffer ptr slot C, len 0x1000
CODE+0x1e76  movea.l CODE+0x16d8(pc), a0  ; index 3 -> buffer ptr slot D, len 0x1000
CODE+0x1e80  movea.l CODE+0x16e4(pc), a0  ; index 4 (default) -> buffer ptr slot E, len 0x1000
CODE+0x1e90  jsr     -0x7d5e(a4)          ; entry 112 -> CODE+0x54f86 = Read(fh, buf, len) -- same Read as WPORT
```

This confirms: `WFONT0.EGA` is read whole (1024 bytes, matching its
already-confirmed 128-glyph 1bpp format) into its own buffer; `WFONT1-4.EGA`
are each read whole (4096 bytes) into 4 **separate** buffer-pointer slots
(`0x16c0`/`0x16cc`/`0x16d8`/`0x16e4`) -- the same 4 slots the WPORT
tile-install routine (`CODE+0x1e9a`, immediately adjacent in the
disassembly) picks between via its `case 1/2/3/default` switch. WFONT1-4
and WPORT are two different payloads poured through the same
"load N raw bytes into shared tile-buffer slot K" mechanism -- not
coincidence, the buffer *pointer storage* is literally shared.

No further disassembly was needed to confirm 8x8-tile geometry -- the
buffer is loaded as one flat 4096-byte blob (a single `Read` call, no
internal record/seek structure the way WPORT has), so the only open
question was tile size/count, settled definitively by rendering (below).

### Verification

Decoded each file as `4096/32 = 128` tiles, 8x8px, 4-plane plane-major
(the confirmed `.PIC` tile encoding), packed into a 16-wide sheet, using
the confirmed `.PIC` palette. All 4 files render as **unambiguous, legible
content**:

- **`WFONT1.EGA`**: UI icon tiles (dungeon wall/maze pieces, a "Zz" sleep
  status icon, direction arrows) plus pixel-text spelling all **14**
  Wizardry 6 class abbreviations in sequence: `FIG MAG PRI / THI RAN ALC
  BAR PSI VAL BIS LOR / SAM MON NIN` (Fighter, Mage, Priest, Thief,
  Ranger, Alchemist, Bard, Psionic, Valkyrie, Bishop, Lord, Samurai, Monk,
  Ninja) -- independently matches the 14-class roster already confirmed in
  `data-structure.md` section 7.1's `scenario.dbs` XP-table count.
- **`WFONT2.EGA`**: combat/command pixel-text labels `TURN` and `MOVE`,
  plus icons (arrows, a "no entry" circle-slash, a dagger, a gem, a
  target/reticle, a mountain, an eye, a shield-and-cross) and a few
  larger multi-tile creature/terrain graphics (green foliage, a
  red/pink creature).
- **`WFONT3.EGA`**: a **fully legible large ASCII font** -- space,
  punctuation, digits 0-9, `@A-Z`, `[\]`, plus a second dimmed/greyed copy
  of the same alphabet (a disabled/inactive text style) -- alongside
  direction-arrow icons and a small flag icon.
- **`WFONT4.EGA`**: an **item/equipment icon set** -- swords, daggers,
  axes, shields, several armour/helmet pieces, potion bottles, rings,
  wands/staves, keys, scrolls, boots, gauntlets.

This is about as strong a non-audio oracle as this corpus offers short of
`CREDITS.PIC`'s legible text (`data-structure.md` section 2.5) -- readable
words plus an exact match to an independently-known fixed count (14
classes) in `WFONT1.EGA` alone would be sufficient; the fully legible font
in `WFONT3.EGA` and unmistakable equipment iconography in `WFONT4.EGA`
corroborate independently.

### Not resolved this pass

- Per-tile semantic naming/grouping (which of the 128 tiles is "sword01"
  vs "which class label letter") -- frames are extracted flat, by index
  only (`wfontN_tile000`..`127`), same policy `decode-pic.ts` uses for
  `.PIC` cels pending a semantic mapping pass.
- Whether index 15 (the confirmed `.PIC`/WPORT transparent key) is meant
  to composite transparently for these tiles too. Visually, the actual
  backgrounds in the renders are palette index 8 (`$555` dark grey) or
  black, not the cyan index-15 background seen throughout `.PIC`/WPORT --
  so the extractor renders WFONT tiles fully opaque rather than assuming
  the same transparency convention applies. Not traced to a specific
  compositing call; flagged as an open detail, not a confirmed choice.
- Why WPORT's case constant is `2` specifically (colliding with the
  `WFONT2.EGA` buffer slot) while WFONT's own loader fills all 4 slots
  1:1 by index -- i.e. how the two subsystems avoid clobbering each
  other at runtime (probably: they're never both live at once -- a
  portrait window and the icon/label bar it borrows tiles from are
  unlikely to be on-screen with conflicting content simultaneously -- but
  this wasn't traced).

---

## Files written

- `docs/wizardry6/amiga/investigations/fonts-and-portraits.md` (this file)
- `tools/wizardry6/decode-wfont-extra.ts` -- decodes `WFONT1-4.EGA`, writes
  `public/assets/wizardry6/amiga/sprites/wfont1.png`..`wfont4.png` +
  matching `.json` atlas sidecars (128 frames each, named `wfontN_tileNNN`).
- `tools/wizardry6/decode-wport.ts` -- decodes `WPORT1-3.EGA`, writes
  `public/assets/wizardry6/amiga/sprites/wport1.png`..`wport3.png` +
  matching `.json` atlas sidecars (14 frames each, 24x24px, named
  `wportN_portraitNN`).

Both extractors reuse the project's shared decode libraries
(`tools/shared/amiga-planar.ts`'s `decodePlanarPlaneMajor`,
`tools/wizardry6/pic-format.ts`'s confirmed `PIC_PALETTE` and
`celIndicesToRGBA`, `tools/shared/atlas-pack.ts`'s `shelfPack`) rather than
re-deriving tile decode logic -- no new decode primitives were needed since
both formats turned out to reuse the already-confirmed `.PIC` 32-byte tile
encoding exactly. Verified by running both scripts end-to-end against
`data/wizardry6/amiga/` and visually inspecting the produced PNGs (matches
the throwaway-probe renders used for verification above). Both files pass
`eslint` and `tsc --noEmit` with zero errors (project baseline was already
clean).

## Suggested merge into `data-structure.md`

For whoever merges this into the main doc:
- Section 5.2 (`WFONT1.EGA`-`WFONT4.EGA`) status changes from "open" to
  "confirmed"; replace its paths-tried table with a short summary + link
  here, following the same pattern section 2's `.PIC` correction used.
- Section 5.3 (`WPORT1.EGA`-`WPORT3.EGA`) status changes from "open,
  unresolved" to "confirmed"; same treatment.
- Section 9's confidence summary table: update both `WFONT1-4.EGA` and
  `WPORT1-3.EGA` rows from "open" to "confirmed", citing this file.
- Consider promoting the shared "9-tile-per-record install into a shared
  buffer slot" mechanism as a forward-reference from section 2.3 (the
  `.PIC` tile format) -- WFONT1-4/WPORT are now a second and third
  confirmed consumer of the exact same 32-byte tile primitive, alongside
  `.PIC`.

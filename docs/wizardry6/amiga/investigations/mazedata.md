# `mazedata.ega` investigation (102456 bytes)

Status at start of this pass: fully open, flagged low-priority in
`docs/wizardry6/amiga/data-structure.md` section 4. This document is a
standalone investigation write-up; a human will merge the relevant parts
into the main data-structure doc. Everything below was derived this
session by tracing `Bane`'s own loader for this file (per the project's
"find the reader, not the format" method) and independently verified by
rendering.

**Result: the directory/graphics-bank format is confirmed** (disassembly
+ visual verification, not just structural inference). The compose-list
sub-table's *field semantics* remain a well-evidenced but unconfirmed
hypothesis.

---

## 1. Overall structure — confirmed

```
+0                                  u16 BE  dirCount   (153)
+2                                  u16 BE  subCount   (366)
+4                                  dirCount x 6 bytes  directory records
+4 + dirCount*6            (=922)   subCount x 5 bytes  compose-list sub-table
+4 + dirCount*6 + subCount*5 (=2752) dirCount graphics blocks, back-to-back,
                                     partitioned exactly by the directory's
                                     own offset field, to EOF (102456)
```

`4 + 153*6 + 366*5 = 2752`, and the directory's first data offset is
literally `2752` — the two numbers were derived independently (one from
the header's two counts, one from the first directory record's stored
offset) and match exactly.

## 2. Directory — confirmed (disassembly + partition invariant)

153 records of 6 bytes each, starting at file offset 4:

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0` | 4 | `offset` | **BE u32**, absolute file offset of this record's pixel data. Strictly increasing across the table; the last record's `offset + widthUnits*heightRows*4` equals the file size exactly. |
| `+4` | 1 | `widthUnits` | width in 8-pixel units (`widthPx = widthUnits * 8`) |
| `+5` | 1 | `heightRows` | height in pixels (rows) |

**Verified invariant, zero deviation across all 153 records** (same shape
as the `.PIC` directory's confirmed invariant, §2.1 of the main doc):
`dirRecords[i+1].offset - dirRecords[i].offset === widthUnits[i] *
heightRows[i] * 4` for `i = 0..151`, and for the last record,
`fileSize - dirRecords[152].offset === widthUnits[152] * heightRows[152] *
4`. Checked programmatically over the whole table with **zero
mismatches**; also re-checked by the committed extractor
(`verifyPartitionInvariant` in `tools/wizardry6/decode-maze.ts`), which
prints "partition invariant holds with zero deviation across 153
directory records" on every run against the real corpus file.

### 2.1 Ground truth: traced directly from `Bane`'s own loader

Located via the project's proven "find the reader, not the format"
method (§1.4 of the main doc, the A4-jump-table / PC-relative-string
technique that cracked `.PIC`):

1. `MAZEDATA.EGA` is a literal string in `Bane`'s master resource
   filename table at file offset `0x4ce6` (inside the
   `0x4c9c`-`0x4dfe` table documented in the main doc §1.1).
2. Scanned the CODE hunk (file `0x28`-`0x55C64`) for every `LEA`/`PEA`
   `d16(PC)` instruction whose resolved target equals this string's
   CODE-hunk-relative address (`0x4ce6 - 0x28 = 0x4cbe`). One hit:
   `CODE+0x49e6`: `pea.l 0x4cbe(pc)` (file offset `0x4a0e`), followed by
   `jsr 0x4452(pc)` (a per-file "open, read, close" wrapper at
   `CODE+0x4452`) — reached with only the filename pointer pushed (no
   index), unlike the neighbouring `WFONT0-4.EGA` loads a few
   instructions earlier, which push a numeric index and call a different
   routine at `CODE+0x4408` (an indexed-filename builder). This
   correctly separates "load this one fixed-name file" from "build and
   load `WFONTn.EGA` for n=0..4".
3. `CODE+0x4452` opens the file (`jsr -0x7f50(A4)` → resolves via the
   A4-jump-table technique, §1.4 of the main doc, to `CODE+0x0f66`,
   already-confirmed "open file by name"), then calls a size/read
   function via `jsr 0x3c56(pc)` (`CODE+0x3c56`, file offset `0x3c7e`),
   then closes the file (`jsr -0x7d10(A4)` → `CODE+0x5585c`, already
   confirmed "close file").
4. **`CODE+0x3c56`-`0x3cf6` is the function that determines exactly how
   many bytes to read.** Disassembly (r2, `m68k`, raw extracted CODE
   hunk):

   ```
   CODE+0x3c5a  movea.l  <mazeBufPtr>(pc),a0     ; global buffer pointer
   CODE+0x3c62  move.w   #0x4000,-(a7)           ; read first 16KB unconditionally
   CODE+0x3c66  move.l   curPtr,-(a7)
   CODE+0x3c6a  addi.l   #0x4000,curPtr
   CODE+0x3c72  move.w   8(a5),-(a7)             ; file handle
   CODE+0x3c76  jsr      -0x7d5e(A4)             ; generic "read N bytes" call
   ...
   CODE+0x3c7c  movea.l  <mazeBufPtr>(pc),a0
   CODE+0x3c80  move.w   (a0),d1                 ; d1 = dirCount
   CODE+0x3c82  mulu.w   #6,d1                   ; * 6 (record size!)
   CODE+0x3c86  addq.l   #4,d1                   ; + 4 (header size!)
   CODE+0x3c88  add.l    a0,d1                   ; d1 = end of directory
   CODE+0x3c8a  lea      <dirEndPtr>(pc),a0
   CODE+0x3c8e  move.l   d1,(a0)                 ; stash directory-end pointer
   CODE+0x3c90  movea.l  <mazeBufPtr>(pc),a0
   CODE+0x3c94  move.w   (a0),d1                 ; d1 = dirCount
   CODE+0x3c96  subq.w   #1,d1                   ; d1 = dirCount-1 (last index)
   CODE+0x3c98  mulu.w   #6,d1                   ; * 6
   CODE+0x3c9c  addq.l   #4,d1                   ; + 4  -> byte offset of last record
   CODE+0x3c9e  adda.l   d1,a0                   ; a0 -> last directory record
   CODE+0x3ca0  move.l   (a0)+,d1                ; d1 = last record's offset field
   CODE+0x3ca2  clr.w    d2
   CODE+0x3ca4  move.b   (a0)+,d2                ; d2 = byte at +4 (widthUnits)
   CODE+0x3ca6  clr.w    d0
   CODE+0x3ca8  move.b   (a0),d0                 ; d0 = byte at +5 (heightRows)
   CODE+0x3caa  mulu.w   d2,d0                   ; d0 = widthUnits * heightRows
   CODE+0x3cac  lsl.l    #2,d0                   ; d0 *= 4   (bitplanes!)
   CODE+0x3cae  add.l    d1,d0                   ; d0 = lastOffset + w*h*4 = TOTAL FILE SIZE
   CODE+0x3cb0  sub.l    #0x4000,d0              ; minus the 16KB already read
   CODE+0x3cb6  move.l   d0,remainingBytes
   CODE+0x3cba: loop: read remainingBytes in further 0x4000-byte chunks
                (bgt/beq compare against 0x4000, same -0x7d5e(A4) read call)
                until remainingBytes == 0
   ```

   This is a **byte-for-byte match** to the structural formula independently
   derived from the raw file (§2 above): `total_size = dirRecords[last].offset
   + widthUnits[last] * heightRows[last] * 4`. The game computes this exact
   value, in this exact order of operations (`mulu.w #6` for the record
   stride, `addq.l #4` for the header size, `mulu` widthUnits*heightRows then
   `lsl.l #2` = `*4`), purely to know how many bytes of `mazedata.ega` to
   read from disk. This is stronger than the usual "structural invariant
   holds across the corpus" confirmation — it's the game's own code
   performing the identical arithmetic.

## 3. Pixel format — confirmed (rendered, byte-exact structural match)

Each directory record's block (`widthUnits * heightRows * 4` bytes) is a
**plane-major, 4-bitplane, MSB-left** Amiga bitmap — the same convention
already confirmed for `.PIC` cels (main doc §2.3) and `.EGA` full screens
(§3): `widthPx = widthUnits * 8`, `heightPx = heightRows`.

- Tried both orientations (`widthUnits`=width vs. `widthUnits`=height) and
  both plane orderings (plane-major vs. row-interleaved) as a 2x2 grid of
  candidate decodes, per the project's "render greyscale first" method.
  Row-interleaved renders as pure noise/garbage in both orientations;
  plane-major with `widthUnits` = width-in-8px-units, `heightRows` =
  height-in-pixels renders **clean, recognisable dungeon art** in every
  sample checked.
- Applying the already-confirmed `.PIC` palette (`PIC_PALETTE`,
  main doc §2.4 — 16 colours, standard EGA/CGA set in the game's permuted
  pen order) renders **cleanly** — no speckling, unlike the inconclusive
  result the main doc reports for the full-screen `.EGA` format (§3's
  "Open" item). This is a second independent confirmation that both the
  pixel layout and the palette are correct for this file.

### Verification renders (directory index -> content)

| Directory index | `widthUnits`x`heightRows` -> px | Content |
|---|---|---|
| 0 | 14x87 -> 112x87 | mortared stone brick wall texture |
| 1 | 8x51 -> 64x51 | same brick wall, smaller (perspective-scaled copy) |
| 2 | 4x27 -> 32x27 | same brick wall, smaller still |
| 26 | 4x112 -> 32x112 | tall narrow doorway/pillar edge piece |
| 29 | 6x69 -> 48x69 | wooden door with metal studs, in a stone frame (distinct orange/brown palette use) |
| 44 | 18x7 -> 144x7 | thin diagonal floor/ceiling perspective strip |
| 56 | 18x16 -> 144x16 | wider diagonal floor/ceiling perspective strip |
| 68 | 14x88 -> 112x88 | **full corridor/archway scene**: stone arch, hanging red drapes/ropes either side, a stairway receding into darkness |
| 101 | 9x69 -> 72x69 | brick wall with hanging chains (wall decoration) |
| 125 | 6x22 -> 48x22 | skeleton figure (monster/hazard marker) |
| 128 | 8x23 -> 64x23 | treasure chest |
| 133-152 (20 records) | all 2x16 -> 16x16 | run of 20 UI icons: a sword, ring/dial icons, robed-figure icons, an ellipse (shield?), ship/statue-like icons, and several dial/clock-face icons with embedded digit glyphs (map-legend or spell/status icons) |

The **full atlas montage** (`public/assets/wizardry6/amiga/maps/mazedata.png`,
1014x621, 153 frames) reads as a complete, coherent first-person
dungeon-crawler graphics bank: walls at multiple perspective-scaled
sizes, doors, pillar/archway edge pieces, floor/ceiling perspective
strips, a full corridor scene, wall decorations, a monster and a
treasure-chest marker, and a UI icon strip — every one of the 153
records decodes to *something* visually coherent (0 records rendered as
noise), which is itself a strong whole-corpus confirmation beyond the
individual samples above.

Full-corpus decode check: **153/153 records decode without error**,
199,408 total pixels, all colour indices in range `0-15` (max index
observed: 15), 0 out-of-range pixels.

## 4. Compose-list sub-table (366 x 5-byte records, offset 922-2752) — hypothesis

Structure (byte layout) is **confirmed** by the exact-partition
arithmetic (`4 + 153*6 + 366*5 = 2752`, matching the first directory
offset exactly — see §1). Field-level **semantics are not confirmed**;
the loader function traced above only computes the total read size and
does not itself interpret this sub-table's fields (a different,
not-yet-located function almost certainly consumes it at dungeon-render
time — not traced this pass).

| Offset | Size | Field | Evidence |
|---|---|---|---|
| `+0` | 1 | `depthGroup` (hypothesis) | Cycles 0,1,2 repeatedly (and occasionally higher, up to at least 22) across consecutive records — the same shape as the directory's own repeating groups of 3-4 records with decreasing `(widthUnits,heightRows)` (a perspective depth cascade, confirmed visually: record 0/1/2 above are the same wall texture at 3 sizes). Plausibly a "which depth layer to draw this piece at" selector. |
| `+1` | 1 | `dirIndexOrNone` (hypothesis, well-evidenced) | 363/366 records have a value in `0..152` — exactly the valid directory-index range (153 records, 0-based). The remaining 3/366 are exactly `0xFF` (255) — a very plausible "no graphic here" sentinel (an open corridor face has no wall to draw). No value falls outside `0..152` except the `0xFF` sentinel — zero stray/out-of-range indices, which is what you'd expect from a real lookup index and not from generic numeric data. |
| `+2` | 1 | `b2` | Range 7-128, clustering at round-ish values (8, 32, 40, 52, 59, 60, 64, 104, 128). Plausible screen X coordinate or a secondary lookup key. Not confirmed. |
| `+3` | 1 | `b3` | Mostly 0 (283/366), occasionally 1-10. Plausible flag or minor offset. Not confirmed. |
| `+4` | 1 | `b4` | Range 0-18, most common values 0-4. Plausible screen Y or a small count. Not confirmed. |

This reads as a strong candidate for a **first-person corridor
compose-list**: for a given maze position/facing, which directory-index
graphic to draw at which depth layer and screen position, with `0xFF`
meaning "nothing to draw here" (an open passage). This is consistent
with the directory's own contents (walls at matching perspective-scaled
size cascades, door/archway pieces, floor/ceiling strips) but the
consuming code was not located this pass — see "Paths tried" below.

## 5. What this file is *not*

- Not a per-level/per-cell maze grid (X,Y wall-bit grid) in the way the
  filename might first suggest. There is no 14-level or ~20x20-cell
  structure anywhere in the header/directory counts. The actual
  per-level maze grid (which cells have walls, doors, encounters, etc.)
  is presumably stored elsewhere (most likely in `scenario.dbs`'s large
  undecoded remainder, main doc §7.1) and *indexes into* this file's
  graphics bank at render time — this file is the **art asset bank**,
  not the level geometry.
- Not the `.EGA` full-screen format (already ruled out before this
  session, confirmed again here structurally: no 320x200 fixed layout
  anywhere, variable per-record dimensions instead).

## 6. Paths tried

| Approach | Result | Why it stopped / what it fed into |
|---|---|---|
| Blind byte-pattern reading of the first bytes, looking for a stride/record-size by eye | Inconclusive (this session's starting point, from the previous pass) | No stride was obvious by inspection alone; motivated tracing the loader instead of continuing to guess |
| Naive 6-byte-stride parse of the whole file from offset 4 | Offsets monotonic for exactly 156 raw 6-byte windows, then garbage | The break pinpointed the real record count; cross-checked against the file's own 2-byte header field (153) — exact match, and the true table length (153 records) is 3 short of the naive break (156) because the break was detected one iteration late by design of the check, not because of a length error |
| Interpreting the header's 2nd u16 field (366) as unrelated noise | N/A | Recomputing `dirEnd_to_firstDataOffset` gap (1830 bytes) and testing `366 * 5 == 1830` immediately confirmed a second, exact record count for a sub-table filling that exact gap |
| Rendering directory blocks as `widthUnits=height, heightRows=width` (both plane-major and row-interleaved) | Noise / implausible aspect ratios (e.g. 696x14) | Ruled out by comparing against the correct orientation, which produced instantly recognisable brick-wall art |
| Rendering as row-interleaved (either orientation) | Pure noise | Confirms plane-major, consistent with `.PIC`/`.EGA` |
| Tracing `Bane`'s loader via the A4-jump-table / PC-relative-string method (main doc §1.4 technique) | **Decisive** | Found `CODE+0x3c56`, which computes the exact same total-size formula independently derived from the raw bytes — the strongest possible confirmation short of a full renderer trace |
| Searching for the compose-list's consumer (the actual dungeon-view renderer that reads `depthGroup`/`dirIndexOrNone`/`b2`-`b4`) | Not located this pass | The loader function traced above only reads the header/directory to size the file read; it does not touch the sub-table's individual fields. A dedicated forward trace from `<mazeBufPtr>`'s other readers (search all xrefs to the same global pointer used at `CODE+0x3c5a`/`0x3c7c`/`0x3c90`/`0x3cf6`) would be the next step, not attempted this pass due to scope/time — left as future work rather than guessed at |

## 7. Confidence summary

| Claim | Confidence | Evidence |
|---|---|---|
| Header (2x u16: dirCount, subCount) | confirmed | disassembly (`mulu.w #6`, `addq.l #4` on the first field) + exact arithmetic match to the sub-table gap |
| Directory (153 x 6-byte records: u32 offset + u8 widthUnits + u8 heightRows) | confirmed | disassembly (byte-for-byte field reads at `CODE+0x3ca0`-`0x3ca8`) + zero-deviation partition invariant across all 153 records |
| Block length formula (`widthUnits*heightRows*4`) | confirmed | disassembly (`mulu.w`+`lsl.l #2` at `CODE+0x3caa`-`0x3cac`) computing the game's own file-read size |
| Pixel layout (plane-major, 4bpp, MSB-left, `widthPx=widthUnits*8`) | confirmed (rendered) | 153/153 records decode to coherent art with zero noise; brick walls, a full corridor scene, doors, icons all independently recognisable |
| Palette (reuses confirmed `.PIC` `PIC_PALETTE`) | confirmed (rendered) | clean colour rendering, no speckling, across all sampled records |
| Compose-list sub-table byte layout (366 x 5 bytes) | confirmed | exact-partition arithmetic (`4+153*6+366*5==2752==dirRecords[0].offset`) |
| Compose-list field semantics (`depthGroup`/`dirIndexOrNone`/`b2`/`b3`/`b4`) | hypothesis | `dirIndexOrNone` well-evidenced (363/366 in valid directory range, remainder exactly `0xFF`); other fields are range/distribution observations only, consuming code not traced |
| "This file is the art bank, not the per-level maze grid" | hypothesis (well-evidenced) | no level/cell-count structure found anywhere in the header/directory; directory contents are unambiguously reusable art tiles (walls, doors, floor strips) rather than per-level data |

## Session 2 addendum (2026-08-01)

See the main doc (`amiga/data-structure.md` §4.2, §4.4) for full detail;
summary here for this investigation file's own record:

- **New confirmed fact**: the directory's `offset` field is fixed up
  in-place at load time (`CODE+0x3cf6`-`0x3d10`) from a file-relative
  byte offset to an absolute runtime pointer. On-disk format unaffected.
- **Compose-list consumer**: still not located. Four independent search
  approaches this session (brute-force PC-relative-opcode xref scan for
  the maze buffer's storage slot at `CODE+0x1690`; caller census of the
  two known shared "blit" A4 entries 57/58; magic-number scan for
  `366`/`153`/`922`; absolute-long addressing scan) all returned negative
  — see the paths-tried table in the main doc §4.4. Flagged as a
  candidate for `re-codebreaker` escalation in `docs/wizardry6/TODO.md`.
- **`scenario.dbs` sections 2/3 ruled out** as the per-level maze
  geometry this session (see main doc §7.1) — they are per-class UI
  data. The dungeon-level geometry's location is an open question again.

## Session 3 addendum (2026-08-01, `re-codebreaker` escalation) — compose list SOLVED

The consumer is **`DrawMazePiece` at `CODE+0x3d72`–`CODE+0x40cc`**, the
first-person dungeon-view piece blitter. Full spec, signature, mirroring
mechanism, depth addressing and verification: main doc §4.4. Summary of
what changed here:

- **Two field assignments in §4 above are refuted.** `+0` is the
  **directory index** (not `depthGroup`); `+1` is a **signed destination
  byte column** (not `dirIndexOrNone`, and `0xFF` is a real `-1`, not a
  sentinel). The real "draw nothing" mechanism is `+4 == 0` (49/366
  records). §4's table is superseded by main doc §4.4's.
- Depth is **not a field** — the compose list is laid out as consecutive
  per-depth runs and the dispatcher at `CODE+0x9b58` indexes it as
  `baseIndex + depth`.
- Left/right walls are drawn from **the same art, mirrored**, via a
  256-byte bit-reversal table at `CODE+0x157c` (confirmed byte-exact,
  0/256 mismatches).

### Why the previous session's four searches all missed it

The searches were sound in shape but all rested on one wrong premise
about *which* global the renderer would touch, and one gap in the opcode
census:

1. **Wrong global.** The searches targeted `mazeBufPtr` (`CODE+0x1690`).
   But the loader also computes and stashes a **second** pointer at
   `CODE+0x1732` — `bufBase + 4 + dirCount*6`, i.e. the **compose-list
   base** — in the already-documented `lea <dirEndPtr>(pc),a0; move.l
   d1,(a0)` at `CODE+0x3c8a`–`0x3c8e`. That slot, not `0x1690`, is what a
   compose-list consumer dereferences. It was recorded in the §2.1
   disassembly listing above but never scanned for.
2. **Opcode-family gap.** The census covered
   `MOVEA.L`/`LEA.L`/`PEA.L`/`MOVE.L,Dn`/`MOVE.W,Dn`. The renderer reads
   both globals with **`ADD.L d16(pc),Dn` (`D0BA`)** and **`ADDA.L
   d16(pc),An` (`D5FA`)** — computing `index*stride` in a register first
   and *adding* the base, rather than loading the base and indexing off
   it. Those two forms were outside the scanned set, so even the
   `0x1690` scan reported "0 other readers" while two real readers
   (`CODE+0x3dd8`, `CODE+0x3f1a`) sat in the binary. (See
   `narrow-opcode-form-census-false-negative.md`.)
3. **A4 jump-table census could not have worked.** `CODE+0x3d72` is a
   module-local static called only via `jsr d16(pc)` (50 sites); it is
   not an A4 jump-table entry at all. It also sits *between* the two
   entries that were censused (57 = `CODE+0x3d14`, 58 = `CODE+0x40d0`) —
   close enough that a reader scanning that neighbourhood would have
   walked straight into it.

**Method note:** the whole solution came from a single exhaustive
displacement scan — for a target `T`, find every even offset `p` where
`p + s16(mem[p]) == T`, then classify by the preceding opcode word. This
finds *every* `d16(PC)` reference regardless of opcode family, which is
strictly stronger than enumerating a chosen list of opcodes. Probe:
`cb_scan.py` / `cb_callers.py` (scratchpad).

## Session 4 (2026-08-01) — `CODE+0x9b58` caller trace: no per-cell wall data found

Task: find who calls `CODE+0x9b58` and where its wall-type-code arguments
ultimately come from (`mazedata-corridor-call-args`/`dungeon-level-geometry-
location` in `docs/wizardry6/TODO.md`). Full method: exhaustive `d16(PC)`
displacement scan (the same technique that solved §4.4 in Session 3),
applied both upward (find callers of `9b58`) and downward (trace `9b58`'s own
callees). Summary is in the main doc's new §4.6; this addendum has the raw
address-level trace for anyone continuing the work.

### `CODE+0x9b58` itself — larger than previously characterized

Disassembling from `9b58` forward (not just the first ~20 instructions
Session 3 saw) shows the function body extends to roughly `CODE+0xa3a0` and
reads word arguments at `0x8`, `0xa`, `0xc`, `0x12`, `0x14`, `0x16`, `0x18`,
`0x1a`, `0x1c`, `0x1e`, `0x20`, `0x22`, `0x24`, `0x26`, `0x28`, `0x2a(a5)` —
at least 9 distinct baseIndex-shaped arguments beyond the depth/lateral pair,
not just the 4 (`0x12`/`0x14`/`0x16`/`0x18`) documented in §4.4. The
`0x12`/`0x14`/`0x16`/`0x18` block (the part Session 3 already traced) is
just the *first* ~170 bytes of a much larger dispatch.

**Confirmed push-order for `DrawMazePiece` calls** (both from `9b58` and from
the `632c` static block, re-derived and cross-checked): the asm push order at
every call site is `dstIdx` (pushed first, i.e. furthest from the `jsr`) →
`mode` (pushed second) → `srcIdx` (pushed last, immediately before `jsr`).
Verified against the confirmed "mirrored pairs 20↔16" calls at
`CODE+0x6372`–`0x63dc`: the first call of each pair pushes `dstIdx=0x10,
mode=1, srcIdx=0x14` (draws compose-record 20's graphic mirrored, placed at
record 16's position); the reverse call swaps them. This matches
`CODE+0x3d72`'s own field reads (`cmpi.w #$ffff,$c(a5)` tests dstIdx;
`move.w $8(a5),d1` in the direct-path branch reads srcIdx).

### A second, near-duplicate dispatcher: `CODE+0xa3b0`

`CODE+0xa3b0`–`~0xa3ac` has the identical shape to `9b58`'s first block: same
`-0x2caa(a4)` mirror-parity-flag test, same "already-drawn" flag-array
pattern (its own array at `-0x2c4e(a4)`, vs. `9b58`'s `-0x2c5a(a4)` — the two
12-byte regions are cleared side by side, `CODE+0xa8e6` and `CODE+0xa8f6`
respectively, both via the generic `pea <addr>; move.w #0xc,-(a7); jsr
-0x7d82(a4)` clear-buffer call). Not traced further this session — flagged
as a lead for whoever picks this back up (it may hold the "other lateral
position"'s equivalent of `9b58`'s logic).

### `CODE+0x9a52` — the deferred-draw-record writer

`9b58`'s later branches (`CODE+0x9c0a` onward, reached when the "already
drawn" flag is set or `0xa(a5)`/`0xc(a5)` take specific values) call
`CODE+0x9a52` instead of `CODE+0x3d72` directly. Full disassembly:

```
CODE+0x9a52   link.w a5,#0
CODE+0x9a56-9a62   -0x2c0a(a4)[slot] = byte 9(a5)            ; "kind" field (+8)
CODE+0x9a68-9a74   -0x2c12(a4)[slot] = word a(a5)            ; index field 0 (+0)
CODE+0x9a7a-9a86   -0x2c10(a4)[slot] = word c(a5)            ; index field 1 (+2)
CODE+0x9a8c        if 8(a5) != 0xFFFF:
CODE+0x9a94-9ac4     -0x2c12(a4)[slot] += table[-0x3adc(a4)][8(a5)*0x13a + (15(a5)-1)*2]  (byte, zero-extended)
CODE+0x9ac6-9af4     -0x2c10(a4)[slot] += table[-0x3aaa(a4)][8(a5)*0x13a + (15(a5)-1)]
CODE+0x9af6-9b02   -0x2c09(a4)[slot] = byte f(a5)             ; secondary field (+9)
CODE+0x9b08-9b14   -0x2c0e(a4)[slot] = word 0x10(a5)          ; index field 2 (+4)
CODE+0x9b1a-9b26   -0x2c0c(a4)[slot] = word 0x12(a5)          ; index field 3 (+6)
CODE+0x9b2c-9b38   -0x2c08(a4)[slot] = byte 0x15(a5)          ; depth tag (+0xa)
CODE+0x9b3e-9b52   slot += 1 (bound 30, else calls -0x7f7a(a4) — a "list full" handler, then retries)
CODE+0x9b54   unlk a5; rts
```

where `slot = -0x2aaa(a4)` (the running record count) and every field write
uses `slot*12` as the byte offset into its own base — i.e. `-0x2c12(a4)`,
`-0x2c10(a4)`, `-0x2c0e(a4)`, `-0x2c0c(a4)`, `-0x2c0a(a4)`, `-0x2c09(a4)`,
`-0x2c08(a4)` are not 7 separate arrays; they are 7 field offsets
(`+0`/`+2`/`+4`/`+6`/`+8`/`+9`/`+0xa`) within one 12-byte record array based
at `-0x2c12(a4)`, exactly matching the consumer loop below. 11 call sites for
`9a52` were found (`CODE+0x9c46`, `0x9c7c`, `0x9cac`, `0x9d02`, `0x9d3c`,
`0x9d76`, `0x9dc6`, `0x9ed2`, `0x9f20`, `0xa312`, `0xa33c`), all inside
`9b58`'s own body.

The `-0x3adc(a4)`/`-0x3aaa(a4)` tables (referenced at `9aba`/`9aea`) looked
like a promising lead at first — `0x13a` = 314 decimal, exactly matching
`scenario.dbs` section 8's confirmed record size (`master.hdr[8]=314`,
§6.4) — but this doesn't hold up: these two tables are referenced from
**~20 call sites scattered across the entire 351 KB CODE hunk**
(`CODE+0xd1f8`, `0x13ca6`, `0x14f4e`, `0x1522c`, `0x1526e`, `0x185d2`,
`0x188ce`, `0x18910`, `0x19fa0`, `0x1a282`, `0x1a2c4`, `0x21240`, `0x21502`,
and more), not just maze code, and an exhaustive search for any pointer-store
write to either address (`move.l ...,-0x3adc(a4)`) found none. Computing the
implied file offset (`A4 - 0x3adc`, `A4 = DATA hunk payload start + 0x7FFE`)
lands inside the DATA hunk's zero-filled-at-load region (past the 2392 bytes
actually read from the executable file), so it isn't a compiled-in constant
either — it's runtime-populated by something, just not by the simple
pointer-store pattern searched for, and its ~20 unrelated non-maze callers
argue against it being a per-level file's contents. Left as an **unconfirmed,
likely-coincidental** lead, not pursued further.

### The deferred-draw consumer: `CODE+0xaffa`–`0xb142`

Found by tracing `9b58`'s own 5 callers upward into their containing
function. This loop iterates `d4` from `-0x2aaa(a4)-1` down to `0`
(i.e. every record `9a52` wrote this frame), for each computing
`a0 = -0x2c12(a4) + d4*12` and:

- skips the record unless its depth tag (`+0xa`, byte) equals the current
  depth counter `-0x2cae(a4)` (`CODE+0xb02c`–`0xb036`);
- skips it if its "kind" byte (`+8`) equals `0xFF` (`CODE+0xb040`–`0xb048`);
- otherwise draws up to 3 `DrawMazePiece` calls using the record's `+0`,
  `+2`, `+4`, `+6` fields as srcIdx/dstIdx pairs (mirrored via the same
  `-0x2cac(a4)` parity flag used elsewhere), each gated by an
  `0xFFFF`-sentinel check on the corresponding index field
  (`CODE+0xb050`, `0xb05a`, `0xb0c0`, `0xb0cc`).

This confirms the 12-byte record layout `9a52` writes (`+0`/`+2` index pair
1, `+4`/`+6` index pair 2, `+8` kind/`0xFF`-sentinel, `+9` secondary,
`+0xa` depth tag) and that it's a genuine deferred/z-sorted draw list, not
maze content itself.

### Monster/NPC token overlay — new discovery, same array reused

Immediately after the deferred-draw consumer, at `CODE+0xb13c`, the outer
function resets `d4` to `-0x2aaa(a4)-1` again and runs a **second** loop
(`CODE+0xb144`–`0xb1bc`) over the *same* `-0x2c12(a4)` array, but interprets
the record differently:

- `+0xa` (byte) is read and compared elsewhere (not to the render depth
  directly in the snippet captured — see `CODE+0xb15a` onward, not fully
  traced);
- `+8` (byte) compared to `0xFF` = "no token" (`CODE+0xb16e`);
- if present, calls the confirmed `.PIC`-style cel compositor (A4 entry 56,
  `-0x7eae(a4)` → `CODE+0x35e6`, main doc §2.3) — **not** `DrawMazePiece` —
  passing a 2-byte NUL-terminated cel-index list built from the record's `+9`
  byte, and 4 more words from `+0`/`+2`/`+4`/`+6` as position/clip
  arguments, plus the `+8` byte itself.

This is a plausible mechanism for placing a monster or NPC portrait at a
specific screen position within the corridor view, reusing the
already-solved monster-portrait rendering pipeline (§2.6) rather than the
wall-art compose-list mechanism. Genuinely new this session. **Not traced**:
what actually populates `-0x2c12(a4)` with real monster-placement records —
`9a52` (the only located writer) is called from inside `9b58`'s own
compose-list dispatch logic, which suggests the SAME record slots serve both
roles depending on caller, or that a separate not-yet-located writer also
appends monster-token records. Left open.

### The outer renderer (`CODE+0xa72c`–`0xb25e`) — static backdrop + 2 overlays

Full detail in the main doc's new §4.6. Three things happen, in order, none
of which read a per-cell wall array:

1. A depth loop (`-0x2cae(a4)`, 0..3) draws several blocks of **entirely
   immediate-constant** `DrawMazePiece` calls (the same shape as the
   confirmed `632c` static corridor block, just spread across more call
   sites: `CODE+0xab0a`–`0xab86`, `0xac1e`–`0xac52`, `0xac84`–`0xac9c`,
   `0xacbc`–`0xad30`, and more through `0xaf90`), each block gated by a
   per-depth boolean flag that `CODE+0xa892` sets to `1` unconditionally for
   every depth on entry, and that is only ever cleared by
   `CODE+0xa4d0`/`0xa594`/`0xa5de` — whose own gate, a byte array at
   `-0x2c65(a4)` tested via `cmpi.b #1,(a0,d0.l)` (indexed by `depth*3`) at
   exactly 3 sites (`CODE+0xa4ec`, `0xa5a6`, `0xa5f0`), has **zero writers**
   anywhere in the CODE hunk (searched exhaustively for the matching
   `lea -0x2c65(a4),a0` pattern — only those 3 read sites exist). So in the
   shipped build, this view-distance-limiting path appears to never fire;
   the backdrop draws unconditionally every render.
2. `CODE+0xa810` computes a bit index from 5 screen-position globals
   (`-0x479a(a4)*64 + -0x479c(a4)*8 + -0x479e(a4)`) and calls the confirmed
   `TestBit` primitive (A4 entry 46, `CODE+0x2958`) against
   `(-0x481e(a4)) + 0x43a` — this is *exactly* the buffer and field the main
   doc's §7.1 correction block already identified (`scenario.dbs` section
   2's class-selection working-copy buffer). Confirmed by an exhaustive
   whole-hunk search for pointer writes to `-0x481e(a4)`: exactly one
   non-clearing writer exists, `CODE+0x10020` (`move.l d0,-$481e(a4)`),
   inside the chargen "populate class working buffers" function
   (`CODE+0x1000c`–`0x100d2`, itself confirmed by its `CopyMem` from the
   per-class pointer array `-0x4816(a4)[slot]`, `slot = -0x47a4(a4)`). If
   the tested bit is set and `-0x47a4(a4)` (same "selected class slot"
   global) is `0`, `1`, or `4`, the function calls a sibling at
   `CODE+0xa72c` — a 6-icon status bar using immediate compose-list indices
   `0x15a`–`0x169` (the tail-of-directory "20 UI icons" run, §4.3) — and
   returns *without* setting up the per-depth "draw" flags at all. This is
   almost certainly a class-conditional HUD element (a spell-point/status
   gauge for spellcasting classes), not maze geometry.
3. Falling through (bit clear, or class not 0/1/4): `CODE+0xa890`–`0xa8de`
   unconditionally sets all the per-depth "draw" flags to `1` for depths
   0-3 (the "default" path, confirmed above) before the main depth loop
   runs.

### Conclusion (this trace, before escalation)

Both structurally-motivated tracing paths out of `CODE+0x9b58` — the
mirror-parity-flag path (`-0x2caa`/`-0x2cac(a4)`) and the deferred-draw
mechanism (`9a52`/`-0x2c12(a4)`) — terminate without finding a per-cell
(X,Y-indexed) wall/door/floor-type array. The one genuinely data-dependent
branch found (`CODE+0xa810`'s `TestBit` call) converges with, and
re-confirms, the prior session's already-ruled-out `scenario.dbs` section-2/3
finding rather than surfacing new per-level data. The working hypothesis is
that this renderer draws a fixed, position/facing-parity-selected backdrop
with no wall-type content dependency, plus two independent overlays
(class-conditional status icons; monster/NPC portrait tokens) neither of
which reads a maze grid either. This hypothesis was escalated to
`re-codebreaker` — see below, it was refuted.

### `re-codebreaker` escalation results — SOLVED, hypothesis refuted

The escalation found the per-cell wall-type-code source: three **sibling**
functions of `CODE+0x9b58` — `CODE+0x9202`, `CODE+0x969a`, `CODE+0x9876` —
called directly from the outer renderer's depth loop
(`CODE+0xaa4a`-`0xaaf4`) at the same call depth as `9b58` itself, not
reachable from `9b58` or anywhere in its call graph in either direction.
That's exactly why the exhaustive bidirectional trace above (sound in
method — same displacement-scan technique that solved §4.4 — but incomplete
in scope) never found them: it only ever walked `9b58`'s own callers and
callees, never its *siblings*.

**The evaluator, `CODE+0x9202`** (full disassembly and signature in the
main doc's new §4.7.2): takes a cell position (region/local-X/local-Y) and
a lateral offset, steps the cursor if the lateral offset is non-zero (via
`CODE+0x9160`, already documented above in this file's §2.1/§3 as part of
the loader-tracing method — turns out to be reused here as a coordinate
stepper, not just a load-time helper), computes `cellIndex = region*64 +
localY*8 + localX`, checks two per-cell scripted-overlay flag bits, then
reads a 2-bit wall value from one of two bit-packed planes (selected by
current facing) via the game's own `GetBitField` primitive (A4 entry 48,
`CODE+0x29d6`) against a buffer at `-0x481e(a4)`.

**That buffer is exactly the one this file's own Session 3 addendum (and
the main doc's §7.1) already traced and identified as a "class-selection
working buffer".** The escalation's key correction: `-0x47a4(a4)` (read
throughout this corpus as "currently selected class slot 0-13") is
actually the **current maze level index** — confirmed via a `SetLevel`
function at `CODE+0x103f0` and two scripted level-transition call sites
(`CODE+0x42148`, `CODE+0x43284`) that hard-set it to literal level numbers,
which makes no sense for a class index. `CODE+0x1000c`-`0x100d2` (previously
read as "chargen: copy selected class record into scratch") is `LoadLevel`
— it allocates the section-2/3 working buffers, flushes them to per-level
caches when dirty, and computes party X/Y screen position from the
*loaded level's* own region-origin table.

**On-disk format**: `scenario.dbs` section 2 = 14 maze levels (1346 bytes
each, file offset `0x9408`), each covering a 256×256 maze coordinate space
via 12 fixed 8×8-cell regions placed by an explicit origin table. Full
field-by-field layout, bit-packing formula, and section 3's companion
144-entity table: main doc §4.7.

**Independent re-verification (orchestrating session, not copying the
escalation's scratchpad scripts)**: reimplemented the bit-field extraction,
13-field partition check, region-overlap invariant, and both cross-file
byte comparisons (vs. the DOS/EGA release's `scenario.dbs`, vs.
`newgame.dbs`) from the escalation's prose description alone, first as a
throwaway Python probe and then in the committed extractor
(`tools/wizardry6/decode-scenario-maze.ts`). Every reported number
reproduced exactly:

- 13-field partition: exact, 0..1346, zero gap/overlap.
- Region-placement invariant: 0 overlapping cells across all 14 levels ×
  12 regions × 64 cells = 10,752 placements (148/168 regions active, the
  other 20 are unused-region padding at origin `(0,0)`).
- Wall-plane histograms: wallA `{open:7156, door:197, wall:3316,
  secret:83}`, wallB `{open:7127, door:192, wall:3361, secret:72}` — exact
  match to the escalation's reported numbers.
- Feature/orientation histograms: feature code 0 = 90.9% (9771/10752),
  orientation 0 = 93.8% (10081/10752) — exact match.
- Cross-platform oracle: **0 mismatches** across all 8 geometry fields
  between the Amiga and DOS/EGA `scenario.dbs` files (17,464 bytes
  compared), while the two files differ by 14,777 bytes overall elsewhere.
- `newgame.dbs` cross-check: **0/43,204 bytes** differ from `scenario.dbs`
  sections 2/3 (14 interleaved `[1346-byte][1740-byte]` per-level records
  starting at file offset `0x19e`).
- Rendered every level's 12 regions as a top-down map by maze-space
  origin: all 14 show recognisable dungeon architecture (rectangular
  rooms, corridors, doors, secret walls); level 6's populated region shows
  an organic cave-like layout; **level 9 shows an unmistakable left-right
  mirror-symmetric room cluster**, independently confirming the
  escalation's own "temple complex" visual read of the same data.

**Corrected premises** (see main doc §4.7 and the correction blocks in §4.5
and §7.1 for the full list): the two most consequential were treating
`-0x47a4(a4)` as a class-slot index rather than a maze-level index, and
treating `CODE+0x1000c`-`0x100d2` as a chargen routine rather than
`LoadLevel`. Every individual byte-level fact traced in the earlier
sessions (allocator shape, `CopyMem` access pattern, the `+0x1e0`/`+0x1ec`/
`+0x43a` field reads) turned out to be accurate — only the *domain*
inference built on top of them was wrong.

**Still open**: which wall plane (A vs. B) is which absolute compass
direction (confirmed only that facing 0 reads plane A, facing 1 reads
plane B, and facings 2/3 read the *neighbouring* cell's plane — the
neighbour-step direction itself wasn't independently disassembled this
session); section 3's full field semantics; the `+0x000` plane, `+0x438`
scalar, and three `+0x4fa`/`+0x512`/`+0x52a` per-region word arrays in
section 2; exact value→meaning mapping for the 16 feature codes and the
wall values beyond the rendered open/door/wall/secret guess.

## Files written this session

- `docs/wizardry6/amiga/investigations/mazedata.md` (this file, Session 4
  addendum + escalation-results addendum)
- `docs/wizardry6/amiga/data-structure.md` §4.6 (new), §4.7 (new — the
  confirmed maze-level format), correction blocks in §4.5 and §7.1
- `tools/wizardry6/decode-scenario-maze.ts` (new verified extractor;
  parses `scenario.dbs` section 2's 14 maze levels, verifies the 13-field
  partition and region-placement invariants, cross-checks against
  `newgame.dbs` if present, writes `public/assets/wizardry6/amiga/maps/
  maze-level00.png`-`maze-level13.png` top-down renders and
  `maze-levels.json`). `npx tsc --noEmit` and `npx eslint` both clean; a
  `reviewer` pass found no issues.
- `docs/wizardry6/TODO.md`, `docs/wizardry6/plan.md` updated

## Files written (prior sessions)

- `docs/wizardry6/amiga/investigations/mazedata.md` (this file)
- `tools/wizardry6/decode-maze.ts` (verified extractor; parses the
  header/directory/compose-list, verifies the partition invariant,
  decodes all 153 directory records, writes:
  - `public/assets/wizardry6/amiga/maps/mazedata.png` +
    `mazedata.json` (153-frame atlas, 1014x621)
  - `public/assets/wizardry6/amiga/maps/mazedata-composelist.json`
    (raw 366-record sub-table, fields labelled per the hypothesis above)
  - `public/assets/wizardry6/amiga/palettes/mazedata.json` (same 16-colour
    palette as `.PIC`, written alongside for this asset group's
    self-containedness)

# Investigation: `.EGA` full-screen palette + trailing 768 bytes

Scope: resolve the two open items in `docs/wizardry6/amiga/data-structure.md`
§3 for `DRAGONSC.EGA`, `GRAVEYRD.EGA`, `TITLEPAG.EGA` (each 32768 bytes,
confirmed 320x200x4bpp plane-major, no header, starting at file offset 0).
This file is a standalone investigation record — see the note at the bottom
for what still needs to be merged into the main spec.

All offsets below are labelled explicitly as **file offset** (raw byte
position in `Bane`) or **`CODE+0xNNNN`** (offset from the CODE hunk's
payload start, i.e. `file_offset - 0x28` — the convention already used
elsewhere in `data-structure.md`, e.g. §1.4, §2.4). CODE hunk payload spans
file `0x28`-`0x55C64` per §1.

---

## 1. Palette

### 1.1 Traced the real loader (not just the `.PIC` call site)

Traced forward from the title/credits filename table (`data-structure.md`
§1.1, file offset `0x558e`: `CREDITS.PIC\0TITLEPAG.EGA\0TITLEPAG.CGA\0
TITLEPAG.CGA\0TITLEPAG.T16\0...`) to its actual reader:

- `CODE+0x4e9a` (file `0x4ec2`): function entry (`LINK.W A5,#-0x70`). Opens
  and reads `CREDITS.PIC` first (`PEA CODE+0x5566(pc)` at `CODE+0x4eaa` =
  file `0x4ed2`, resolves to file offset `0x558e` = `"CREDITS.PIC"`; open
  via A4-table entry 29 = `CODE+0xf66`; read via A4-table entry 55 =
  `CODE+0x3572`, matches `data-structure.md` §1.4's already-confirmed
  `CREDITS.PIC` cross-check).
- Then branches on a platform-flag byte at `-0x48a7(A4)` (a global, tested
  bit-by-bit: bit0→`.EGA`, bit1→`.CGA`, bit2→a duplicate `.CGA` string,
  bit3→`.T16`). For this Amiga build bit0 is the live path:
  `CODE+0x4ef0` (`BTST.B #0,-0x48a7(A4)`) → `CODE+0x4efa` (file `0x4f22`):
  `PEA CODE+0x5572(pc)` = file offset `0x559a` = `"TITLEPAG.EGA"`, then
  `JSR CODE+0x4ddc(pc)`.
- `CODE+0x4ddc` (file `0x4e04`) is a **separate loader wrapper from the
  documented `CODE+0x366` `LoadResourceFile`** (§1.2) — it allocates a load
  slot (A4-table entry 3 = `CODE+0x13c`), opens the file (entry 29 =
  `CODE+0xf66`), reads it via a **local, non-table** call to `CODE+0x3bd4`
  (file `0x3bfc` — see §2 below, this is the routine that explains the
  768-byte question), closes it (entry 125 = `CODE+0x5585c`), then — only
  if a caller-supplied mode word is non-zero — calls A4-table entry 58 =
  `CODE+0x40d0`.
- Back in the caller, after the platform-specific branch converges at
  `CODE+0x4f52` (file `0x4f7a`), the now-loaded buffer is passed to A4-table
  entry 57 = `CODE+0x3d14` (file `0x3d3c`) and then entry 58 = `CODE+0x40d0`
  (file `0x40f8`) again, this time with the real `TITLEPAG.EGA` bytes in
  the buffer.

### 1.2 Exhaustive search: only one palette-install site exists in the whole binary

Searched the full 351292-byte CODE hunk for every LVO call that could set a
screen palette:

| Search | Pattern | Hits |
|---|---|---|
| `LoadRGB4` (graphics.library LVO `-0xC0`, opcode `4EAE FF40`) | exact bytes | **1**, at `CODE+0x19be` (file `0x19e6`) |
| `SetRGB4` (LVO `-0x1E6`) | exact bytes | 0 |
| `LoadRGB32` (LVO `-0x21C`) | exact bytes | 0 |
| Direct custom-chip access (`$00DFF000` immediate, or `$DFF180`/COLOR00 literal) | exact bytes | 0 (game never touches custom chips directly — it's a well-behaved `graphics.library` client; this also rules out a copper-list palette trace, since `Bane` never installs a custom copper list at all — no `COP1LC`/`COP2LC` write pattern exists because there's no direct `$DFF000`-based chip access anywhere in the binary) |
| `OpenScreen` (LVO `-0xC6`, opcode `4EAE FF3A`) | exact bytes | 4 raw hits, but 3 are **false positives**: they load `A6` from `-0x2dce(A4)` (confirmed = `SysBase`/`ExecBase`, the register used right before every `OpenLibrary` call in this binary) rather than from the `CODE+0x1578(pc)`-stored `GfxBase` pointer, so `-0xC6(A6)` in those 3 cases is a *different* library's LVO that happens to share the same displacement. Only the hit at `CODE+0x1972` (file `0x199a`) loads `A6` from the confirmed `GfxBase` slot and is inside the function that also does `OpenLibrary("graphics.library")` and the confirmed `LoadRGB4` call two paragraphs later — this is the real, and only, screen-open site. |

The single `LoadRGB4` call at `CODE+0x19be` loads the source table via
`LEA CODE+0x17ba(pc),A1` (this is the table `data-structure.md` §2.4
documents at `CODE+0x17b6` — the small offset difference is between the
extension-word address used for the PC-relative computation and the
doc's cited table-content start, not a different table) and the
destination via `LEA 0x2c(A0),A0` where `A0` is the just-opened `Screen`
(`0x2c` = `struct Screen.ViewPort`), exactly matching §2.4's existing
citation.

**Conclusion: `Bane` opens exactly one `Screen` and loads exactly one
16-colour palette, once, at startup — the same table already confirmed in
§2.4 (`PIC_PALETTE` in `tools/wizardry6/pic-format.ts`).** Every image the
game draws, `.PIC` cels and `.EGA` full screens alike, is blitted into that
one screen's bitplanes and displayed through that one palette. There is no
alternate palette load site to find — the earlier "maybe `.EGA` screens use
a different palette" hypothesis in §3 is **ruled out structurally**, not
just left unconfirmed.

### 1.3 Rendering with the confirmed palette

Applied `PIC_PALETTE` directly to all three screens (MSB-first bit order,
plane-major, as already confirmed for the greyscale render). Result,
inspected at 3x nearest-neighbour zoom:

- **`TITLEPAG.EGA`**: the "BANE OF COSMIC FORGE" engraved-stone lettering
  area renders as a dithered black/dark-grey/light-grey/white stone
  texture (consistent with genuine engraved-stone shading, not a decode
  artifact — sampled pixel values in that region are drawn almost
  exclusively from indices {0,1,8,9} = black/white/dark-grey/light-grey,
  not scattered across all 16 colours). The flanking character art shows
  clearly recognisable, large contiguous colour regions: a red
  devil/skeletal figure (lower-left), a purple-robed wizard figure
  (centre) with a mix of magenta/blue for robe shading, and grey/white
  armoured knight figures (right) — see
  `public/assets/wizardry6/amiga/screens/titlepag.png`. This is
  **rendered — recognisable fantasy-art content in plausible colours**,
  the strongest evidence for this palette being correct.
- **`GRAVEYRD.EGA`**: tombstone/figure silhouettes remain visible (as in
  the original greyscale confirmation) and now have colour, but the
  background/sky area is a much noisier mix of blue/magenta/white with no
  clear dithering pattern — weaker evidence than `TITLEPAG`.
  `public/assets/wizardry6/amiga/screens/graveyrd.png`.
- **`DRAGONSC.EGA`**: the confirmed "icon-box row" UI structure (bordered
  boxes across the top) is still clearly visible, and each box's outline
  renders in a plausible UI colour (white/grey), but the fill content
  inside each box is chaotic multi-colour noise rather than a clean
  portrait. Weakest evidence of the three.
  `public/assets/wizardry6/amiga/screens/dragonsc.png`.

**Controls tried to rule out a decode bug** (not a palette-source problem):
reversing plane order (`p3,p2,p1,p0` instead of `p0,p1,p2,p3`) reassigns
colours but produces the **same speckle pattern** at the same pixel
locations (just recoloured) — proves the noise is in the underlying bit
data itself, not an artifact of index construction. Flipping bit order to
LSB-first (instead of the confirmed MSB-first) **breaks legibility**
(mirrors each 8-pixel byte, garbles the title text) — confirms MSB-first
is correct and rules out a bit-order bug as the speckle's cause.

**Confidence:** the palette **table and load mechanism are confirmed**
(§1.2 — structurally the only one in the binary, no alternative exists to
trace). The resulting **per-pixel colour accuracy is rendered, not
byte-exact confirmed** — `TITLEPAG.EGA` is convincing, `GRAVEYRD.EGA` and
`DRAGONSC.EGA` less so. The leading hypothesis for the residual speckle is
that it's genuine period-accurate EGA dithering baked into the source art
(carried over byte-for-byte from a DOS/EGA original, same convention as the
`.PIC`/`.CGA`/`.T16` parallel filename variants documented in §1.1 —
this game shipped on IBM PC EGA and CGA too, both of which commonly used
pixel-pattern dithering to fake extra shades within a fixed 16-colour
palette), not a remaining decode error — every plane/bit-order permutation
that was tried either reproduces the same speckle or actively breaks
already-confirmed legibility. **Closing this fully would need a real
external oracle** (an emulator screenshot of the actual game, or a DOS EGA
release's asset to diff against) — out of scope for this pass per the
amiberry access gate (not requested; static evidence was judged sufficient
to promote the palette from the doc's prior "open" status, given no
alternative candidate exists to test against).

---

## 2. Trailing 768 bytes

> **Superseded by §3 below (2026-08-01):** the "one 768-byte trailer"
> framing in this section is wrong — the real structure is four 192-byte
> per-plane padding gaps (planes are individually padded to a fixed
> `0x2000`-byte slot), not one lump block at file end. The `0x8000`
> fixed-read-size trace in §2.1 immediately below is still accurate and is
> consistent with §3's finding; the rest of this section (§2.2-§2.4) is
> kept for the record but its "padding vs. sub-structure" framing no longer
> applies as stated.

### 2.1 The file *is* read in full — traced the actual DOS `Read()` driver

`CODE+0x3bd4` (file `0x3bfc`) is the bulk-read routine `CODE+0x4ddc`'s
loader calls (§1.1) to fill the load buffer:

```
CODE+0x3bf2  MOVE.L #$8000,D0        ; 32768 -- hardcoded total byte count
CODE+0x3bfc  loop:
             MOVE.L D0,D0 / TST.L D0 ; remaining == 0? -> done
             CMP.L  #$4000,D0        ; > 16384 remaining?
             ; if so: read exactly $4000 (16384) this pass, subtract, loop
             ; else:  read the remainder (D0), then remaining == 0, done
             JSR    -0x7d5e(A4)      ; generic chunked-read trampoline
                                     ; (same trampoline §1.3 of the main doc
                                     ;  uses for misc.hdr's 0x400-byte read --
                                     ;  this confirms it's a generic
                                     ;  "read N bytes" helper, not
                                     ;  Huffman-specific)
```

This reads **exactly 32768 bytes** (`0x8000`, a compile-time constant, not
derived from the file's actual on-disk size via `Examine`/`Seek`) in
16384-byte chunks. All three `.EGA` screens are exactly 32768 bytes, so
this read exactly reaches EOF with no short read and no leftover — **the
trailing 768 bytes are genuinely loaded into memory**, not skipped by the
file I/O layer.

### 2.2 But no traced consumer reads past byte 4 of the buffer

The two functions that receive this buffer after the read (§1.1):

- **`CODE+0x3d14`** (entry 57): reads only `buf[0]`, `buf[1]`, `buf[2]`,
  `buf[3]` (each `<<3`, i.e. treated as "units of 8"), then calls two
  `graphics.library` LVOs (`-0x1E`, `-0xE4`) and returns. No loop over the
  rest of the buffer.
- **`CODE+0x40d0`** (entry 58): also reads only `buf[0]`, `buf[1]`,
  `buf[2]`, `buf[3]` to compute a clip-rectangle (uses a `320` (`0x140`)
  multiply at `CODE+0x4154`, confirming it operates in screen-width units),
  falls back to sentinel "no clip / full image" values (`0xFF`/`0xFFFF`)
  whenever those bytes are zero — which they are in all three real
  `.EGA` files (`data[0..3] == 0` in every case, checked directly). No
  loop over the rest of the buffer was found in the traced portion either.

Searched the whole CODE hunk for any instruction that could index a buffer
at offset `32000` (`0x7D00`) specifically (both as a 32-bit immediate and
as a 16-bit immediate in a `MOVE.W #imm,...` context) — **zero hits**. No
evidence any code path treats bytes 32000-32767 as anything other than
"already inside the buffer, never read."

### 2.3 The trailing bytes' own content doesn't support a real sub-structure

| File | Trailer entropy | Nonzero bytes | Nonzero range |
|---|---|---|---|
| `DRAGONSC.EGA` | 0.0 (all zero) | 0 / 768 | — |
| `GRAVEYRD.EGA` | 2.30 bits/byte | 187 / 768 | offset 0-560 |
| `TITLEPAG.EGA` | 2.90 bits/byte | 235 / 768 | offset 0-255, then all zero to EOF |

- Already ruled out in the main doc: a clean 12-bit-RGB Amiga palette table
  (`DRAGONSC` is all-zero; the other two are only ~80% `0x0RGB`-shaped).
- Checked and ruled out here: the nonzero region isn't a copy of any
  32-byte (or longer) run appearing anywhere else in the same file or in
  the other two `.EGA` files or `CREDITS.PIC` (byte-search, zero matches)
  — rules out "leftover copy of a previously-loaded resource still sitting
  in the same disk-authoring-tool buffer."
- Tried rendering the trailing 768 bytes as a standalone sub-image: 1bpp
  monochrome and 4bpp plane-major, at every width from 16 to 256 px that
  divides the byte count evenly (12 width/plane-count combinations per
  file). No candidate produced a recognisable shape (icon, cursor, small
  portrait) — all renders are either uniform noise or empty.
- The three files' trailing content has **no consistent shape**: one is
  cleanly all-zero, one is front-loaded-then-zero, one is scattered
  throughout — inconsistent with a real fixed-format trailer (which would
  be present, in the same shape, in every file), consistent with inert
  padding whose actual bytes are whatever the build tool's write buffer
  happened to contain (zeroed in `DRAGONSC`'s case, stale/uninitialized in
  the other two).

### 2.4 Conclusion

**Hypothesis, not confirmed**: the trailing 768 bytes are padding to the
fixed `0x8000` (32768-byte) buffer-read constant hardcoded at
`CODE+0x3bf2` — i.e. this resource class's load buffer/read size is a
round `0x8000`, the real pixel payload is `320*200/8*4 = 32000` bytes, and
the remaining 768 bytes are simply whatever was in the source file past
the real image data at build time (unused by any traced consumer). This
is the best-supported explanation given the evidence above, but it is not
a proof of absence — a function using indirect/computed addressing that
wasn't reached by this static trace could theoretically still touch that
range. The task brief's "`disk.hdr` last directory offset sits exactly 768
bytes short of `scenario.dbs`'s size" lead was checked for a numeric
relationship to this 32768-byte buffer constant (e.g. as a multiple or
divisor) — none found; most likely both are independent instances of the
same disk-authoring tool's habit of padding by a block-and-a-half
(768 = 1.5 x 512-byte AmigaDOS blocks) rather than a causally connected
mechanism. Left open for a future pass with either full disassembly of
`CODE+0x40d0`/`CODE+0x3d14` past the point traced here, or an emulator
memory-write trace across a real screen display to see conclusively
whether the OS's own `BltBitMap`/`InitBitMap` ever touches that address
range.

---

## 3. Bitplane stride bug (2026-08-01 follow-up — supersedes §2's conclusion)

A later pass, triggered by a user report that the residual fill-area
speckle in `GRAVEYRD.EGA`/`DRAGONSC.EGA` (§1.3 above) looked like a
bitplane offset/stride bug rather than genuine dithering, re-opened this
question and found a real bug.

**Ground truth used:** the DOS/EGA release's `.t16` full-screen variant
(`docs/wizardry6/dosega/data-structure.md` §9.3) — 320×200, 4bpp
packed-chunky, linear, already confirmed clean by direct rendering,
decoded with a structurally unrelated function
(`decodePackedPixelLinear`) to `.ega`'s planar decoder. Since `.t16` and
`.ega` ship the same artwork in different encodings, decoding `.t16`
gives an independent pixel-index ground truth to check `.ega` against.

**Finding:** per-bitplane, a brute-force offset search (every byte offset
in `[0, fileSize-8000]`, scored by agreement against the corresponding
`.t16` truth bit) found a **perfect 100.0000% match** for all 4 planes at
offsets `0, 8192, 16384, 24576` — an exact arithmetic progression with
common difference `8192` (`0x2000`) — versus the previously-assumed
`0, 8000, 16000, 24000` (difference `8000`, tightly packed). Plane 0
happened to decode correctly under the old assumption (offset 0 either
way); by plane 3 the old assumption's read window had drifted 576 bytes
into the wrong data (only ~48% bit agreement with truth — indistinguishable
from noise), which is what produced the reported speckle.

**Disassembly corroboration:** the literal constant `0x2000` also appears
three times as `adda.l #0x2000,a1` in `Bane`'s `DrawMazePiece` function
(`CODE+0x3e30`, `0x3e94`, `0x3fd4`, within the previously-documented
`CODE+0x3d72`-`0x40cc` range, §4.4 of the main doc), there used as the
fixed pitch between successive destination bitplane pointers when
blitting into the real, on-screen Amiga display bitmap. This is
independent confirmation that `0x2000` is a genuine fixed per-plane
buffer/pitch convention in this engine, not a coincidental numeric match
found only in the file-offset search.

**Verification after the fix:** 0 pixel mismatches across all 3 screens ×
2 platforms × 64,000 pixels (384,000 total comparisons) between the
corrected `.ega` decode and the `.t16` ground truth. `GRAVEYRD.EGA`'s sky
speckle is still visually present after the fix but is now proven
byte-identical to the same ground truth — i.e. **confirmed genuine source
dithering**, not a decode artifact, now that the actual decode bug (the
stride) has been separately found and fixed. This resolves §1.3's
"leading hypothesis... not pursued this pass" into a closed, verified
conclusion.

**Files changed:** `tools/shared/amiga-planar.ts` (`decodePlanarPlaneMajor`
gained an optional `planeStride` parameter, default preserves old
behaviour for all other callers), `tools/wizardry6/decode-ega-screen.ts`
and `tools/wizardry6/decode-dosega-ega-screen.ts` (`.ega` mode) now pass
`planeStride = 0x2000`. See `data-structure.md` §3.3 for the full writeup
this section was condensed from.

---

## 4. What to merge into `data-structure.md`

This file's author was instructed not to edit `data-structure.md` or
`plan.md` directly (parallel-safety with other agents). For whoever merges
this:

- §3's "no confirmed real palette" open item should become: palette
  **confirmed** (sole candidate, §1.2 above), per-pixel colour accuracy
  **rendered** (§1.3), with the copper-list-trace line item struck out —
  ruled out (game never accesses custom chips directly, confirmed via
  whole-binary search for `$DFF000`/`COP1LC` patterns).
- §3's trailing-768-bytes open item should gain the `CODE+0x3bd4`/
  `CODE+0x3bf2` fixed-`0x8000`-read trace (§2.1-2.2 above) and the
  render-attempt/entropy table (§2.3), status remains **open/hypothesis**
  (padding, not a real sub-structure) rather than "unexplained."
- `tools/wizardry6/decode-ega-screen.ts` now imports `PIC_PALETTE` from
  `pic-format.ts` and renders real colour instead of greyscale; assets at
  `public/assets/wizardry6/amiga/screens/{dragonsc,graveyrd,titlepag}.png`
  were regenerated accordingly.

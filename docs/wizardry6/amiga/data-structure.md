# Wizardry 6: Bane of the Cosmic Forge — Amiga data format

Status: **second pass — most formats confirmed** (see `docs/wizardry6/plan.md`
for session log, and `docs/wizardry6/amiga/investigations/` for the five
follow-on investigation write-ups merged into this document:
`ega-screen-palette.md`, `fonts-and-portraits.md`, `mazedata.md`,
`headers-and-databases.md`, `scenario-messages-monsters.md`). Source data:
`data/wizardry6/amiga/` (117 files — verified: 1 `Bane` executable, 60
`.pic`, 12 `.ega`, 5 `.hdr`, 4 `.dbs`, 35 `.snd` — no other file types
present).

No public/community documentation of this format was found (checked
GitHub, romhacking.net-style resources, the "Cosmic Forge" community editor
site, and several Wizardry fan forums/wikis — see "Prior art check" below).
Everything in this document was derived directly from the corpus and from
disassembling `Bane`.

Confidence levels used throughout: **confirmed** (verified against an
independent oracle — disassembly, a rendered/legible image, or a
byte-exact structural invariant holding across the whole corpus),
**rendered** (produces a visually coherent, plausible result but not
independently cross-checked), **hypothesis** (structurally motivated guess,
not yet verified).

## Prior art check

Searched for: GitHub extractors/unpackers, romhacking.net entries, the
"Cosmic Forge" Wizardry 6/7/8 community editor (closed-source freeware, no
format docs published), Wizardry fan forums (`tk421.net`, `zimlab.com`,
`cosmicforge` community forum — the one directly relevant thread,
"Wizardry 7 dbs/hdr file formats for texts", is only hosted on Tapatalk,
which blocks automated fetches; a `WebSearch` snippet of it mentioned "288-byte
or 144-byte blocks" and "endianness swapping" for `SCENARIO.DBS`/
`NEWGAME.DBS` on Wizardry 7 — noted below where it's relevant, but treated
as an unverified secondhand hint, not a source). No usable prior art was
found; this is a from-scratch corpus for the seer project family.

---

## 1. `Bane` — main executable

**Confirmed** (disassembly triage via the `amiga-disasm` agent, IRA +
radare2; see `docs/wizardry6/amiga/disasm/Bane.asm` for the raw IRA dump).

- Standard AmigaOS hunk executable (`HUNK_HEADER` magic `0x3F3` at file
  offset `0x0`). Not PowerPacker/RNC/XPK/Imploder-wrapped at any level (checked
  file-level and per-hunk magic bytes).
- 3 hunks:

  | # | Type | Reserved size | Payload in file | Payload file offset |
  |---|------|---------------|------------------|----------------------|
  | 0 | HUNK_CODE (`0x3E9`) | 351292 B | 351292 B (full) | `0x28`–`0x55C64` |
  | 1 | HUNK_DATA (`0x3EA`) | 30004 B | 2392 B (rest zero-filled at load) | `0x55C98`–`0x565F0` |
  | 2 | HUNK_BSS (`0x3EB`) | 4 B | 0 (reserve-only) | — |

  Stream: `HUNK_HEADER → CODE(+reloc) → DATA(+reloc, 141 relocs) → BSS →
  HUNK_END`. Walking the stream structurally accounts for all 354372 bytes
  exactly — **no trailing/appended overlay data**.
- SAS/C small-data model confirmed: `JSR d16(A4)` calls resolve to `JMP.L`
  trampolines at the start of the DATA hunk's payload (141 found via a
  `4E F9` scan), with `A4 = DATA_hunk_file_start + 0x7FFE`.
- IRA's `-preproc` auto-detection largely fails on this binary (dense
  inline string literals confuse the code/data heuristic — only ~19 tiny
  code islands auto-detected out of 351 KB). `docs/wizardry6/amiga/disasm/Bane.asm` exists but
  needs a hand-refined `.cnf` before it's useful for label-based search;
  all findings below came from targeted radare2 disassembly at
  string-xref-derived offsets, not from a full linear pass. **Flagged as
  future work.**

> **Resolved (this session): `Bane.cnf` coverage gap fixed.** Prior
> sessions' `.cnf` only declared explicit `CODE` for a ~5.5KB cluster near
> `0x55032`-`0x5658a` (out of the 351,292-byte/`0x55C3C` CODE hunk); the
> remaining ~345KB fell back to undifferentiated `DC.L` hex in `Bane.asm`,
> invisible to any text/regex sweep (root cause of the
> `item-catalog-remaining-fields` false negative documented in §7.1's
> "Final update" block). Fix applied: added
> `CODE $00000000 - $00055032` to
> `docs/wizardry6/amiga/disasm/Bane.cnf` (replacing the old
> `CODE $00000000 - $00000006` entry, which only covered the header's
> warm-jump instruction) and regenerated via
> `ira -a -compat=bi -config -keepzh Bane Bane.asm`. IRA's own run log
> confirms the new range **merged** with the adjacent existing declaration
> into one contiguous `CodeArea[0]: 00000000 - 00055070`; the pre-existing
> small clusters from `0x55070` through `0x55C3C` (the true end of the
> CODE hunk, confirmed by hunk-size arithmetic — no undeclared code exists
> after them) were left untouched. Net effect: **99.47% of the CODE hunk
> (349,446 / 351,292 bytes) is now within a declared `CODE` range**, up
> from ~1.5%. Verified concretely: `Bane.asm` grew from 23,032 lines
> (22,343 of them `DC.*` hex, only 374 real instruction lines) to 113,178
> lines (2,778 `DC.*`, 93,841 real instruction lines); a Python scan of
> every disassembled instruction's address comment shows 94,451 lines now
> fall in the previously-100%-invisible `0x1000`-`0x4FFFF` span (0 before).
> Spot-checked the exact bytes cited in §7.1's item-catalog "Final update"
> block — `CODE+0x3bf3c` (`JSR -32664(A4)`), `CODE+0x3bf78`
> (`MOVE.B -226(A5),D0` / `SUB.B D0,(A0)`), `CODE+0x3bf94`, `CODE+0x3c07a`,
> `CODE+0x3c1c0` — all now appear as real disassembled instructions in
> `Bane.asm` at those exact offsets, matching the raw-capstone trace that
> found that function. **Embedded string/data literals inside the newly
> code-classified region still disassemble as garbage instructions where
> IRA has no local knowledge they're data** (e.g. the filename table at
> `CODE+0x4c9c` decodes as nonsense opcodes, not `DC.B` text) — this is
> the expected, documented trade-off (`-text=1` and further `.cnf`
> `LABEL`/data-range refinement were not applied this pass, out of scope
> for the coverage fix). **Practical upshot for future sessions: `Bane.asm`
> is now a genuinely useful greppable asset for label/opcode/call-pattern
> searches across nearly the whole binary, not just the old 5.5KB
> cluster** — always prefer grepping it before falling back to a fresh
> radare2/capstone pass.

### 1.1 Embedded filename tables — confirmed

All target filenames are embedded as literal null-terminated ASCII
strings in the CODE hunk, in per-purpose constant tables, each with
parallel `.EGA`/`.CGA`/`.T16` (Tandy 16-colour) variants — clear evidence
of a shared DOS/EGA/CGA/Tandy + Amiga codebase, of which only `.EGA`
assets ship on this Amiga disk set:

| Cluster | File offset | Contents |
|---|---|---|
| Disk-swap prompts + filenames | `0x1300` | `"INSERT SAVEGAME DISK\0...\0"` + `DISK.HDR, MSG.DBS, SCENARIO.DBS` |
| Master resource filename table | `0x4c9c`–`0x4dfe` | `SCENARIO.HDR, WFONT0-4.{EGA,CGA,T16}, MAZEDATA.{EGA,CGA,T16}, MASTER.HDR, DISK.HDR, MSG.HDR, PCFILE.DBS, MISC.HDR, MSG.DBS, SCENARIO.DBS` |
| Title/credits image table | `0x558e` | `CREDITS.PIC, TITLEPAG.{EGA,CGA,T16}` |
| Graveyard image table | `0x571a` | `GRAVEYRD.{EGA,CGA,T16}` |
| Dragon-scene image table | `0x5a1e` | `DRAGONSC.{EGA,CGA,T16}` |
| Portrait-window image table (×3 near-identical copies) | `0x67ee`, `0x2f7ec`, `0x383ec` | `WPORT1.{EGA,CGA,T16}` |
| Save/new-game table | `0x744e` | `NEWGAME.DBS, SAVEGAME.DBS` (the latter is a runtime-created save file, not shipped on disk) |
| `PCFILE.DBS` (4 standalone call sites) | `0x5af4, 0x29c1a, 0x2fd14, 0x300c6` | fixed roster file, no per-platform variant |
| `MON00.PIC` (6 occurrences) | `0x46a8, 0x629a, 0x14946, 0x15e30, 0x401da, 0x5168a` | base name — almost certainly index-substituted (`MON%02d.PIC`) at runtime |
| `SOUND00.SND` (6 occurrences) | `0x47ac, 0x4894, 0xb364, 0x15d0e, 0x3f94c, 0x5063e` | same pattern as `MON00.PIC` |

> **Correction**: the `PCFILE.DBS` offsets above are the file offsets of
> the `"PCFILE.DBS\0"` **string literal bytes themselves**, not JSR
> targets — disassembling at those addresses produces garbage. The real
> call sites are the `PEA d16(PC)` instructions immediately preceding
> each string (see §1.4's correction note). Left as originally recorded
> here since the string offsets are still useful for locating the bytes.

No DOS library call names appear as strings (normal — SAS/C resolves
library calls via LVO offsets, not name strings). No decompression/debug
strings exist anywhere in the binary.

### 1.2 Resource loader — confirmed (shape), not fully traced

`CODE+0x366` is the shared `LoadResourceFile(name, mode)` entry point,
reached from every filename table above via
`CLR.W -(A7); MOVE.L <name>,-(A7); JSR -0x7fe6(A4)`. It opens/reads the
file via a local subroutine, then (if `mode != 0`) calls a
hash-bucket/40-byte-stride resource-registry pair at `CODE+0x2ad2`/
`0x2b8c` — a load-once resource cache, not further decoded this pass.

### 1.3 Huffman bit-tree decoder — **confirmed**, matches `misc.hdr` exactly

`CODE+0x2a8a`–`0x2ad0` is a canonical Huffman/bit-tree walker operating on
a table of 4-byte nodes (2 words: left child, right child):

```
CODE+0x2a8a  CLR.L    D1                 ; node index = 0 (root)
CODE+0x2a8c  ROL.B    #1, D0             ; rotate next input bit into carry
CODE+0x2a8e  BCS.b    0x2ab0             ; bit=1 -> right child (mirror of below at +2)
CODE+0x2a90  BTST.B   #7, (A0,D1.W)      ; high bit of node word
CODE+0x2a96  BNE.b    0x2a9e             ; set -> internal node
CODE+0x2a98  MOVE.W   (A0,D1.W), D1      ; clear -> LEAF: literal 0x00-0x7F
CODE+0x2a9c  BRA.b    0x2ac8
CODE+0x2a9e  MOVE.W   (A0,D1.W), D1      ; internal: negative back-reference
CODE+0x2aa2  NEG.W    D1
CODE+0x2aa4  LSL.W    #2, D1             ; *4 -> byte offset of next node
CODE+0x2aa6  SUBQ.B   #1, D3             ; bits-left-in-byte--
CODE+0x2aa8  BNE.b    0x2a8c
CODE+0x2aaa  MOVE.B   (A1)+, D0          ; refill next input byte
CODE+0x2aac  MOVEQ    #8, D3
CODE+0x2aae  BRA.b    0x2a8c
```

This matches `misc.hdr`'s byte shape field-for-field: paired 16-bit words
per node, negative values = internal-node back-references (`NEG.W` +
`LSL.W #2`), small positive values (bit 7 clear, `0x00`–`0x7F`) = literal
ASCII leaf codes. `1024 / 4 = 256` nodes — matches `misc.hdr`'s exact file
size. The driver at `CODE+0x2a60`–`0x2a88` reads a 1-byte length prefix
(max 255) then walks the tree once per output byte — see §5.1.

A wrapper at `CODE+0x2a42`–`0x2a5e` calls a trampoline
(`-0x7d5e(A4)` → `CODE+0x54f86`) with a size argument of exactly `0x400`
(1024 = `misc.hdr`'s size), strongly suggesting this is the function that
loads `misc.hdr` into the buffer the tree-walker reads — the
filename→buffer chain wasn't traced end-to-end this pass (**future work**).

### 1.4 `.PIC` cel drawer — **found and traced** (`CODE+0x35e6`)

> **Correction:** an earlier pass reported "no width/height/bitplane-count
> parsing routine was located in code". It exists at `CODE+0x35e6`, with
> the tile expander at `CODE+0x3a56`. A linear r2 sweep misses it; the
> route that works is the **A4 jump table**.

The game reaches its graphics entry points through a 6-byte-per-entry
`JMP abs.L` table that lives at the start of the DATA hunk, with
**`A4 = data_hunk_start + 0x7FFE`** (SAS/C small-data convention). So a
call `jsr -0x7eae(A4)` resolves as:

```
data_offset = 0x7FFE - 0x7eae = 0x150          # always a multiple of 6
entry       = data_offset / 6 = 56
target      = BE u32 at (file 0x55c98 + 0x150 + 2)
```

The DATA hunk's payload starts at **file offset `0x55c98`** (HUNK_DATA tag
at `0x55c90`, size longword at `0x55c94`). Resolved entries used here:

| A4 ref | Entry | Target | Role |
|---|---|---|---|
| `-0x7eae(A4)` | 56 | `CODE+0x35e6` | draw cel list into work buffer (§2.3) |
| `-0x7eb4(A4)` | 55 | `CODE+0x3572` | read whole file into a load slot |
| `-0x7f50(A4)` | 29 | `CODE+0x0f66` | **`BuildResourcePath(name) -> char*`** (prefixes a device string, does not open — corrected, see below) |
| `-0x7d64(A4)` | 111 | `CODE+0x54e40` | **`Open(path) -> handle`** — the real open call, invoked right after `BuildResourcePath` |
| `-0x7d10(A4)` | 125 | `CODE+0x5585c` | close file |

> **Correction** (from `docs/wizardry6/amiga/investigations/headers-and-databases.md`):
> entry 29 (`CODE+0xf66`) does **not** open a file — it concatenates a
> static device-prefix string with the given filename into a fixed
> 58-byte scratch buffer and returns a path pointer. The real `Open()`
> call is entry 111. Also, the earlier `PCFILE.DBS` "call sites" listed in
> §1.1 (`0x5af4, 0x29c1a, 0x2fd14, 0x300c6`) are the file offsets of the
> `"PCFILE.DBS\0"` **string literal bytes themselves**, not JSR targets —
> the real call sites are the `PEA d16(PC)` instructions immediately
> preceding each string.
>
> Additional A4 jump-table entries resolved this pass:
>
> | A4 ref | Entry | Target | Role |
> |---|---|---|---|
> | `-0x7d6a(A4)` | 110 | `CODE+0x54db0` | `Seek(handle, offset)` |
> | `-0x7d5e(A4)` | 112 | `CODE+0x54f86` | `ReadBytes(handle, buffer, count)` (matches §1.3's Huffman-loader read call) |
> | `-0x7d1c(A4)` | 123 | `CODE+0x5564a` | `WriteBytes(handle, buffer, count)` |
> | `-0x7d76(A4)` | 108 | `CODE+0x54d80` | `strcmp`/`strncmp`-style compare |
> | `-0x7d94(A4)` | 103 | `CODE+0x54cac` | `strcpy(dest, src)` |
> | `-0x7d4c(A4)` | 115 | `CODE+0x553ac` | `strcat(dest, src, maxlen)` — **corrected** (was mislabelled "file-copy helper"; re-disassembly shows a `strlen`-scan-then-append-then-NUL-terminate shape, used to append a filename onto an already-built device-prefix path, same role as entry 103's `strcpy`. `newgame.dbs` is not copied via this call — see §7.2's correction) |

Cross-check that anchors the whole chain: the credits loader at
`CODE+0x4ea6` does `pea CREDITS.PIC(pc)` → open → `pea $77AA.w` → read.
`0x77AA` = 30634 = **the exact byte size of `CREDITS.PIC`**.

Per-file load-slot base offsets are a longword table at `CODE+0x3546`:
`0, 0x1c00, 0x3c00, 0x6c00, 0x8000, 0xe400, 0x14800, 0x1ac00`.

---

## 2. `.PIC` images (`CREDITS.PIC` + `mon00.pic`–`mon58.pic`, 60 files)

> **Correction (re-codebreaker pass):** the format is fully solved. Two
> premises in the previous version of this section were wrong and are
> superseded below: (a) the slot's trailing 19 bytes are **not padding** —
> they are the continuation of a variable-length tile-presence bitmask,
> which is why `b2` alone never produced a working length formula; and
> (b) a "band" is not a horizontal strip of a larger picture, it is a
> **complete standalone cel** (sprite) with its own tile grid.

**DOS/EGA variant:** the DOS release ships the same cels with a
byte-identical tile payload, behind a block RLE and a 24-byte (rather than
26-byte) directory slot — see `docs/wizardry6/dosega/data-structure.md` §5.
Its `credits.pic` is the one file whose *content* genuinely differs.

### 2.1 Container/directory — **confirmed**

Every file opens with a fixed **650-byte (`0x28A`) directory**: 25 slots
of 26 bytes each. Record size 26 is confirmed in code: `mulu.w #0x1a,d0`
at `CODE+0x3a62` (and `CODE+0x3624`).

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0` | 4 | `offset` | **BE u32** absolute file offset of this cel's tile data. Read as a longword by `move.l (a0),d0` at `CODE+0x3a72`. The high word is always 0 only because every file is < 64 KB — it is *not* a reserved field. `offset == 0` terminates the directory. |
| `+4` | 1 | `tilesW` | cel width in 8-pixel tiles (was called `b0`). Read at `CODE+0x362c`. |
| `+5` | 1 | `tilesH` | cel height in 8-pixel tiles (was called `b1`). Read at `CODE+0x3634`. |
| `+6` | 20 | `mask[20]` | tile-presence bitmask, `tilesW*tilesH` bits, **LSB-first within each byte**, bytes in ascending order. (`b2` was merely `mask[0]`.) Walked bit-by-bit at `CODE+0x3aca`–`0x3adc`. |

20 mask bytes = 160 bits, which is exactly the capacity of the game's own
cel work buffer (§2.3) — the largest cel in the corpus uses 156 tiles.

Real band count varies 3–25 per file; unused trailing slots are all-zero
(`offset == 0`) and are not real bands. The directory's first entry
always reads `offset = 650` — this is **not a format magic/version
number**, it's simply `directory_offset[0]`, which is always 650 by
construction (25×26 = 650) since band 0's data always starts right after
the fixed-size directory.

**Verified invariant, zero deviation across all 60 corpus files**:
`band[i].length == directory_offset[i+1] - directory_offset[i]` (or, for
the last real band, `file_size - directory_offset[last]`). The directory
offsets exactly partition the file from byte 650 to EOF with no gaps or
overlaps. Example (`mon00.pic`, 2282 bytes, smallest file, 22 real bands):
offsets `650, 682, 714, ..., 2218`, then EOF at 2282 — every gap matches.

Entropy of the post-directory byte stream (4.0–5.6 bits/byte across
sampled files, heavily dominated by `0x00`/`0xFF` and near-`0x00`/near-`0xFF`
values) rules out Huffman/dense-compressed data (compare to `misc.hdr`'s
confirmed real Huffman table, §1.3) and matches raw sparse bitplane data
(large background/silhouette runs) instead.

### 2.2 Cel length formula — **confirmed**

Only **present** tiles are stored, 32 bytes each, in row-major order:

```
n      = tilesW * tilesH
nbytes = ceil(n / 8)
present(t) = (mask[t >> 3] >> (t & 7)) & 1        # LSB-first
length = 32 * popcount(mask[0 .. nbytes-1])
```

**Verification, zero deviation:** across all 60 files / 731 cels, the
computed `length` equals the directory-derived byte range exactly
(731/731). Additionally every mask bit beyond index `n-1` is zero and
every mask byte beyond `nbytes-1` is zero in all 731 cels — an
independent structural check that `tilesW*tilesH` is the true bit count.

### 2.3 Tile/pixel layout — **confirmed**

Each 32-byte tile is an **8×8 pixel, 4-bitplane, plane-major** block:

| Offset in tile | Contents |
|---|---|
| `+0 .. +7` | plane 0 (bit 0), one byte per pixel row, 8 rows |
| `+8 .. +15` | plane 1 (bit 1) |
| `+16 .. +23` | plane 2 (bit 2) |
| `+24 .. +31` | plane 3 (bit 3) |

`colour_index = Σ plane[p].bit << p`, **MSB of each byte = leftmost pixel**.

Decode:

```
buf = 160 tiles x 32 bytes, pre-filled 0xFF          # CODE+0x35ea..0x35fe
src = file + offset
for ty in 0 .. tilesH-1:
    for tx in 0 .. tilesW-1:
        t = ty*tilesW + tx
        if present(t):
            blit_tile(src, buf[ty][tx]); src += 32   # transparent blit, below
image_width  = tilesW * 8
image_height = tilesH * 8
```

**Transparency:** colour index **15** (all four planes set) is the
transparent key. The game's per-row compositor at `CODE+0x3b10`–`0x3b58`
computes `t = src[0] & src[8] & src[16] & src[24]` (the "all planes set"
mask) and writes `dst[P] = (dst[P] & t) | (src[P] & ~t)` for each plane
`P ∈ {0,8,16,24}`. Absent tiles simply advance the destination by 32
(`adda.l #0x20,a2` at `CODE+0x3b6a`), leaving whatever is underneath.

**Compositing:** the cel drawer (`CODE+0x35e6`, reached via the A4 jump
table entry `-0x7eae(A4)`) takes a **NUL-terminated list of cel indices**
and composites them into one buffer, using the *first* cel's `tilesW`/
`tilesH` for all of them. **Cel index = list byte − 1** (`subq.b #1,d0`
at `CODE+0x3a60`), so byte `0x01` selects directory slot 0. Cels sharing
identical `tilesW`/`tilesH` within a file are therefore layers/animation
frames of the same picture — confirmed live in the credits sequence,
where `CODE+0x4faa`–`0x5030` cycles bytes 12,11,10,11,12 (slots 11,10,9),
which are exactly `CREDITS.PIC`'s three 13×3 cels.

**Flags** (byte at `0x13(a5)` of the drawer's frame):

| Bit | Effect | Evidence |
|---|---|---|
| 0 | horizontal flip — remap every byte through a 256-entry **bit-mirror LUT** at `CODE+0x1578`, and emit tile columns in reverse | LUT verified byte-exact as `mirror(i)` for all 256 entries; loop at `CODE+0x365c`–`0x367c` |
| 1 | vertical flip — reverse the 8 bytes within each plane (swap 0↔7, 1↔6, 2↔5, 3↔4) and emit tile rows in reverse | loop at `CODE+0x36a2`–`0x36b8`, `W*H*4` groups of 8 |

The bit-mirror LUT is independent proof of **MSB-left** pixel order, and
the "swap 8 bytes within each group, 4 groups per tile" flip is
independent proof of **8 rows per plane, 4 planes per tile**.

Horizontal clipping (`CODE+0x36de`–`0x3758`) blanks whole tile columns by
writing 32 bytes of `0xFF` and stepping the destination by `(tilesW-1)*32`
— independently confirming the **row-major, 32-byte-stride, `tilesW*32`
row-pitch** buffer layout and that `0xFF` is the blank value.

### 2.4 Palette — **confirmed**

16 Amiga 12-bit colour words at `CODE+0x17b6`, loaded with
`LoadRGB4(screen->ViewPort, table, 16)` at `CODE+0x19a8`–`0x19ba`
(`lea 0x2c(a0),a0` = `struct Screen.ViewPort`; `jsr -0xc0(a6)` on
graphics.library = LVO `LoadRGB4`).

| Idx | Value | Colour | | Idx | Value | Colour |
|---|---|---|---|---|---|---|
| 0 | `$000` | black | | 8 | `$555` | dark grey |
| 1 | `$FFF` | white | | 9 | `$AAA` | light grey |
| 2 | `$55F` | light blue | | 10 | `$00A` | blue |
| 3 | `$F5F` | light magenta | | 11 | `$A0A` | magenta |
| 4 | `$F55` | light red | | 12 | `$A00` | red |
| 5 | `$FF5` | yellow | | 13 | `$A50` | brown |
| 6 | `$5F5` | light green | | 14 | `$0A0` | green |
| 7 | `$5FF` | light cyan | | 15 | `$0AA` | cyan |

This is the standard EGA/CGA 16-colour set in a **permuted** order — the
Amiga data files were re-indexed at build time to this pen order, so
pixel value `v` maps directly to `table[v]`. Note index 15 (`$0AA` cyan)
doubles as the transparent key, so it appears as the background of every
`.PIC` cel.

> **Note (independent re-verification, orchestrating session):** the
> escalation's own saved throwaway probe script (`decode.py` in that
> session's scratchpad, not committed anywhere) had a **stale/incorrect**
> palette array — literally the standard EGA hardware colour order
> (`0=black,1=blue,2=green,...,15=white`), not the permuted order in the
> table above. This was caught by sampling actual background pixels in the
> escalation's own rendered `credits.png`/`mont2.png` output: they read
> RGB `(0,170,170)` (cyan), which matches this section's `$0AA` at index
> 15 exactly, but does **not** match that script's own `EGA[15]` literal
> (white) — proving the array on disk wasn't the one actually used to
> produce those renders (almost certainly edited mid-exploration after the
> images were generated). The disassembly-derived table above was
> cross-checked against two independent real-pixel samples across two
> different rendered images and matches both exactly; it is what
> `tools/wizardry6/pic-format.ts`'s `PIC_PALETTE` implements. Lesson: a
> specialist escalation's *prose claims* and its *rendered evidence* can
> both be correct while a leftover *script artifact* it hands back is
> stale — verify by re-deriving from the primary evidence (disassembly +
> real pixels), not by trusting whichever script file happens to be
> sitting in the scratchpad.

### 2.5 Verification evidence

| Check | Result |
|---|---|
| `length == 32*popcount(mask)` over all cels | **731/731, zero deviation** |
| mask bits beyond `tilesW*tilesH` all zero | 731/731 |
| mask bytes beyond `ceil(n/8)` all zero | 731/731 |
| max tiles per cel vs. game's own buffer | 156 ≤ 160 (`5120/32`, buffer cleared at `CODE+0x35f0`) |
| full-corpus decode | 731 cels, 3,504,128 pixels, **0 out-of-range indices** |
| bit-mirror LUT at `CODE+0x1578` | 256/256 entries equal `mirror(i)` |
| **`CREDITS.PIC` render** | fully legible: "Written and Programmed by / D.W. Bradley", "IBM, Macintosh, Amiga Technical Programming / Gary Speegle", "Computer Graphics / Chris Appel, Renata Dolnick", "Digitized Sound Programming / Jeff Noyle­elling, David Triggerson", "Sound Effects / Steve Miller", "PlayMaster's Guide written by / Brenda Garno EGW.", "Special Thanks to Rob & Norm Sirotek", "Copyright © 1990 by DAVID W. BRADLEY AND SIR-TECH SOFTWARE ALL RIGHTS RESERVED", plus the *Wizardry* logo, "D.W.Bradley", "SIR-TECH SOFTWARE" and "present" |
| **monster renders** | recognisable portraits in natural colour: armoured knight with skull emblem, mummy-king with scimitars, black panther with green eyes, white-bearded wizard in a purple hat, horned demon in red robes over green grass, winged succubus, green serpent |
| **Independent re-verification (orchestrating session, from scratch, not copying the escalation's script)** | reimplemented directory parsing + length formula from this doc's prose alone: **731 cels, 3,504,128 pixels, 731/731 length-formula matches, zero deviation** — exactly reproduces the escalation's own numbers. Re-rendered `mon32.pic`'s 7-cel same-dimension group individually (not composited) and it's an unmistakable progressive wizard-portrait draw-in animation (sparse hair -> full beard+hat), confirming the "same dimensions = animation frames/layers" claim visually, not just by assertion. Palette cross-checked against 2 independent real background-pixel samples (see the note above) |

Verified extractor: `tools/wizardry6/pic-format.ts` (decode library) +
`tools/wizardry6/decode-pic.ts` (writes
`public/assets/wizardry6/amiga/sprites/{credits,monsters}.png` + `.json`
atlas sidecars, and `palettes/pic.json`). Output cel counts match exactly
(19 `CREDITS.PIC` cels + 712 `mon*.pic` cels = 731). Each cel is extracted
as an independent, individually-named frame (`monNN_celCC`) rather than
guessing which cels combine into "the" displayed monster picture.

**Update: which `mon##.pic` FILE a monster uses is now confirmed — see
§7.1's `picFileIndex` finding.** The remaining open half is which specific
cel(s) *within* that file the drawer composites at runtime (the
NUL-terminated cel-index-list *mechanism* is confirmed here in §2.3; the
per-monster list contents were traced to a runtime-built per-combat-slot
struct, not a static record field — see §7.1 and the paths-tried table
below). The atlas gives every real cel a stable name so that finer mapping
can be layered on later without re-decoding anything.

### 2.6 `.PIC` file → monster mapping — confirmed

**Confirmed**, two independent methods plus a visual cross-check:

1. **Statistical**: grouping `scenario.dbs`'s 250 monster records (§7.1) by
   their `categorySingular` field and scanning every byte offset in the
   undecoded stat block for one that is constant within every multi-member
   category group *and* ranges exactly 0–58 (the valid `mon00.pic`–
   `mon58.pic` index space) singles out record offset **+209**: 32/32
   multi-member category groups perfectly consistent, 46 distinct values
   across 114 categories, max value exactly 58.
2. **Disassembly**: `CODE+0x16042` (`move.b 0xd1(a1),d0`, `0xd1`=209)
   reads this exact record byte from a monster-record pointer table
   (`-0x3bbe(a4)`, indexed by combat slot) and passes it to
   `CODE+0x15ebc` → `CODE+0x15cf2` on a cache miss: that function converts
   the value into two ASCII decimal digits (`divs.w 0xa,d0` then `+0x30`
   twice — the standard digit-pair idiom), writes `"MON<NN>.PIC"` into a
   scratch buffer immediately followed on-disk by the literal string
   `"MON00.PIC\0"` at `CODE+0x15e08`, then calls the same
   `BuildResourcePath`/`Open`/read-into-load-slot/`Close` A4 jump-table
   chain documented in §1.4 — i.e. this genuinely is the file loader for
   the monster's portrait, not a coincidental byte match.
3. **Visual cross-check** (5 spot-renders from the already-extracted
   `sprites/monsters.png` atlas, independent of both methods above):
   category `RAT` (index 21) → unmistakable rat art; `BAT` (18) → a bat;
   `GIANT SERPENT` (19) → a serpent; `HUGE SPIDER` (58) → a spider;
   `STINKING CORPSE`/`ZOMBIE` (25) → a rotting corpse. 5/5 species-correct.

A second field at record offset **+210** is read by the same caller
(`CODE+0x16092`, `move.b 0xd2(a1),d0`) but only when a combat-slot/rank
variable equals 1 and the byte is non-zero — i.e. it's consumed
conditionally per *combat slot*, not unconditionally per monster.
**Hypothesis only**: exported as `picFileIndexSecondary`, role not
determined (companion/mount graphic? alternate art for one formation
position?).

**Still open**: which specific cel(s) within the selected file get
composited — but the writer of the per-combat-slot struct is now found
(this session), narrowing the gap to the writer's own upstream data
sources.

**The struct writer — confirmed, `CODE+0x14ce2`.** `LINK.W A5,#-4`, does a
sorted insert into a ≤12-entry array at `-0x3b86(a4)` keyed by a byte at
each entry's `+0x14` (an insertion-sort scan, then a 6-long/24-byte
`move.l (a6)+,(a1)+` shift-down loop — the array itself is kept sorted,
not just each entry). After setting `+0x14`(sortKey)/`+0x15`/`+0`/`+2`/
`+4`/`+6`(screen X/Y/size words, unconfirmed)/`+0x16`, it ends with
`addq.l #8,a1; jsr -0x7d94(a4)` — A4 entry 103, the doc-confirmed
`strcpy(dest,src)` — i.e. `strcpy(&entry+8, srcPtr)` **is** the write of
the cel-index-list string, resolving "who writes `-0x3b86(a4)[slot]+8`".

**Caller chain traced upward, one caller at each level** (exhaustive
`4EBA` pc-relative scan, single-caller at every hop): `CODE+0x14ce2` ←
`CODE+0x14e28` (call site `CODE+0x15082`) ← `CODE+0x15458`, inside a phase
state machine (`-0x3b1c(a4)` cycling 0→1→2→wrap) whose phase-1 body is a
2-group×5-member nested loop calling `InsertToken(member,group)` — up to
10 monster tokens built per encounter, consistent with the struct array's
12-slot cap.

**What gets `strcpy`'d — traced into `CODE+0x14e28`, bottoms out in
runtime tables, not the monster record.** `CODE+0x14e28` fills its own
local buffer (later passed as the `strcpy` source) via one of two paths on
a runtime flag (`tst.w 8(a5)`):
- flag≠0: a single byte copied from a side table at `-0x39b2(a4)[idx]+0`
  (314-byte stride) plus NUL — a 1-cel list, **not sourced from the
  monster record**;
- flag==0: calls `CODE+0x14ad8(monsterOrTableIndex, otherArg, dest,
  count)`, a more complex animation-state-advancing routine reading/
  writing two further side tables (`-0x2e9e/-0x2e9f/-0x2ea0(a4)`, 40-byte
  stride; `-0x3a66..-0x3a90(a4)`, 314-byte stride) — reads like a genuine
  sprite-animation frame-cycler, not a static field lookup.

Neither path traces back to the monster record's `+0x209`/`+0x210`
fields directly — the trail bottoms out in three DATA-hunk-resident
runtime tables whose own writers/semantics weren't traced this pass. A
handful of monster *identity* constants (`0x14`, `0x23`, `0x36`, `0x39` —
all valid `picFileIndex` values, e.g. `0x36`=54=category `* B E L A *`)
still trigger a multi-cel-copy special case (`CODE+0x1885e`–`0x18886`)
instead of the default single-cel path, unresolved either way.

> **Update (this session): all 3 side tables traced to their source —
> the trail terminates in a bulk file `Read()`, not a per-field copy from
> the monster record; the cel-list content is genuinely animation-derived,
> not identity-derived.** An exhaustive scan (every `MOVE`-class
> instruction — `MOVE.B/W/L`, `CLR`, `ADD`/`SUB` with a memory
> destination — targeting each table's exact displacement, across the
> **entire 351,292-byte CODE hunk**, not just the previously-examined
> `CODE+0x14c00`-`0x16400` window) found:
>
> - **Table 2** (`-0x2e9e/-0x2e9f/-0x2ea0(a4)`, 40-byte stride) — **writer
>   found**: `CODE+0x14ad8` (independently re-verified this session,
>   disassembled `CODE+0x14bc0`-`0x14bec` directly: confirms
>   `move.b d5,(a0,d0.l)` with `a0 = lea -0x2ea0(a4)` exactly as claimed),
>   plus 5 near-identical duplicated copies of the same routine
>   (`CODE+0x16552`, `~0x18124`, `~0x19af8`, `~0x20d98`, `~0x3ed00` —
>   SAS/C is known to inline/duplicate small hot routines rather than
>   share one copy, consistent with the confirmed duplication elsewhere in
>   this binary, e.g. `RwRecord`). Values written derive from **table 3**
>   plus an unresolved helper call (`jsr -0x7f8c(a4)`) — never from the
>   monster record. Confirms the "genuine sprite-animation frame-cycler"
>   reading.
> - **Table 1** (`-0x39b2(a4)`) and **table 3** (`-0x3a66..-0x3a90(a4)`),
>   both 314-byte stride — **no `MOVE`-class writer anywhere in the CODE
>   hunk** (60+ occurrences across 15 call sites and all 6 duplicated
>   function bodies, every one a read). Both fields sit inside one
>   314-byte "resource-cache-slot" record based at `-0x3ae4(a4)`
>   (`+4`=length, table-3 fields at `+84/+94/+104/+114/+124/+125/+126`,
>   table-1 at `+306`, a "max" sentinel at `+308`, a "used" flag at
>   `+309`) — **the same `-0x3ae4(a4)` 64-slot resource cache
>   independently found this session from the opposite direction while
>   tracing `scenario.dbs` section 8's reader** (§7.1's `ReadSection`
>   category-8 trace) — two independently-dispatched agents converged on
>   the identical address/stride/slot-count from unrelated starting
>   points, a strong cross-confirmation. The whole record is populated by
>   **one bulk `Read()` syscall** (`CODE+0x15cf2` -> `CODE+0x9fc` ->
>   `jsr -0x7d5e(a4)`, destination = the record's own base address, length
>   from a runtime-populated size table `-0x74c8(a4)[op]` that's zero in
>   the static DATA hunk and filled at program init) — structurally
>   identical to the already-documented `newgame.dbs`/`savegame.dbs`
>   loader pattern (§7.2). This is why no `MOVE` instruction targets these
>   offsets: the whole 314-byte record, cel-list bytes included, arrives
>   as raw bytes from a file read, not from per-field stores.
>
> **Net effect on the original question.** The `+209`/`+210` monster-record
> fields only reach these tables *indirectly*, by selecting **which**
> `.PIC` file gets opened (the already-confirmed `CODE+0x16042` ->
> `0x15ebc` -> `0x15cf2` loader chain) — the tables' actual cel-list
> *content* is raw bytes read wholesale from that opened file, not copied
> field-by-field from the monster's stat block. This is a materially
> different, now largely closed, answer to "what populates the cel-list":
> **it's populated by reading bytes out of the monster's own selected
> `.PIC` file** (whichever bytes the `-0x3ae4(a4)` cache's `Read()` call
> pulls in, at an offset/length driven by the runtime-populated
> `-0x74c8(a4)[op]` table, not traced further this pass) rather than from
> any static per-monster list stored in `scenario.dbs`. The one remaining
> open thread is that `-0x74c8(a4)[op]` size table's own initialization
> (which offset/length within the `.PIC` file each op-code reads) — a
> narrower, more tractable question than "which of 3 opaque tables
> matters," and a natural next step for a future pass.

> **Final update (this session): `-0x74c8(a4)[op]` fully resolved —
> it is nothing but the game's own in-memory cache of `MASTER.HDR`
> itself, and `op` is `ReadSection`'s `category` argument.** Confirmed by
> disassembly, independently re-verified against raw binary bytes:
>
> `CODE+0x4b08`-`0x4b18`, part of the already-documented startup block
> (§6.5) that sequentially loads `MASTER.HDR`/`DISK.HDR`/`MSG.HDR`:
> ```
> 3f3c 0042        move.w  #$42,-(a7)      ; length = 66 (real MASTER.HDR file size)
> 486c 8b38        pea.l   -$74c8(a4)      ; dest buffer
> 487a 0285        pea.l   $4d97(pc)       ; -> literal "MASTER.HDR\0"
> 4eba f9d6        jsr     $44ec(pc)       ; ReadFileBytes(name, buf, len)
> 4fef 000a        lea.l   $a(a7),a7
> ```
> `CODE+0x44ec` is the same shared `Open`/`jsr -0x7d64(a4)`(get handle)/
> `jsr -0x7d5e(a4)`(the confirmed `Read()` primitive)/`Close` helper used
> for `DISK.HDR` and `MSG.HDR` immediately after (byte-verified: the very
> next 4 bytes past this block are `3f3c 02bc` = `move.w #$2bc,-(a7)`
> [700, `disk.hdr`'s real size] followed by `pea -$7486(a4)` — landing
> exactly on `-0x7486(a4)`, the address §6.5 had *already independently
> confirmed* as `disk.hdr`'s cache buffer in an earlier session — a
> cross-confirmation neither session could have faked).
>
> `master.hdr`'s real 66 bytes (independently re-read from
> `data/wizardry6/amiga/master.hdr` this session) decode as 33 BE u16
> values: `64, 74, 1346, 1740, 222, 142, 32, 40, 314, 12` (section 0-9
> record sizes) then `14, 500, 16, 16, 250, 32, 400, 200, 64, 64` (section
> 0-9 record counts). `ReadSection`'s length lookup (`CODE+0xa9c`-`0xab0`,
> independently re-disassembled: `move.w 8(a5),d1; ext.l d1; asl.l #1,d1`
> — doubles the `category` argument into a word index — `lea -$74c8(a4),a1`)
> indexes this exact buffer: word index 1 (`category=1`, item catalog) =
> **74**, byte-exact match to the confirmed item-record stride; word index
> 8 (`category=8`) = **314**, byte-exact match to the confirmed
> `-0x3ae4(a4)` resource-cache-slot stride. Word index 12 (byte offset 24,
> i.e. `-0x74c8+0x18(a4) = -0x74b0(a4)`) = **16**, matching §4.7.1's
> already-independently-confirmed "cached `master.hdr` count field" used
> by the section-2/3 slot sweep at `CODE+0x71a0`-`0x71de` — a third
> independent cross-confirmation.
>
> **Conclusion: `-0x3ae4(a4)`'s bulk `Read()` length for `category=8` is
> simply `master.hdr[8]=314`, no other computation involved.** There is no
> separate, content-aware "what's in this slot" table anywhere — the
> mechanism is fully generic and category-agnostic (`ReadSection` does a
> uniform `master.hdr[category]`-sized blob read for every section). This
> closes the `pic-cel-list-mapping` open thread completely: the cel-list
> content genuinely is raw bytes read out of the monster's own `.PIC` file
> via a size-agnostic generic loader, with `master.hdr` supplying only the
> byte count, not a per-slot schema.

| Approach | Result | Why it stopped short |
|---|---|---|
| Statistical category-grouping scan across all 154 stat-block byte offsets | **found +209** (file index) | succeeded — see above |
| Disassembly trace from `+209`'s read site forward to the drawer call | reached the file loader (`CODE+0x15cf2`) cleanly | the loader only resolves the *file*; the cel-list is assembled several call-frames later in a different, only-partly-traced function |
| Following the drawer's list-pointer argument backward from a live call site (`CODE+0x189bc`) | found it's `pea -0x4(a5)`, a **stack-local buffer**, filled from `-0x3b86(a4)[slot]+8` | that struct field's own population site wasn't located in that pass — genuinely a separate, deeper struct-init function, not a simple record-field read |
| Traced the struct writer itself (`CODE+0x14ce2`) and its 3-level caller chain upward | **found the writer and its callers**, confirmed the `strcpy` write mechanism, found the insertion-sort/12-slot-cap shape | the writer's own two data-source paths both bottom out in three separate runtime side tables (`-0x39b2(a4)`, `-0x2e9e/-0x2ea0(a4)`, `-0x3a66..-0x3a90(a4)`), not the monster record — one level deeper, not yet closed |
| **(this session)** Exhaustive whole-CODE-hunk `MOVE`-class-instruction census for each of the 3 side tables' exact displacements | **found table 2's writer** (`CODE+0x14ad8`, derives from table 3 + an unresolved helper call); **proved tables 1/3 have no field-level writer anywhere** — they're populated by one bulk file `Read()` into a 314B resource-cache slot (`-0x3ae4(a4)`, independently cross-confirmed against §7.1 section 8's reader trace) | resolves the "who populates it" question at the mechanism level (a bulk read, not a static list) but leaves the read's own offset/length source (`-0x74c8(a4)[op]`, runtime-populated, zero in the static DATA hunk) as a new, narrower open thread |

Verified extractor: `tools/wizardry6/decode-scenario-monsters.ts` (adds
`picFileIndex`/`picFile`/`picFileIndexSecondary` to
`public/assets/wizardry6/amiga/data/monster-mapping.json`).

### 2.7 Paths tried (historical — all superseded by §2.1–2.4)

| Approach | Result | Why it failed |
|---|---|---|
| `band_length = popcount(b2) * 32` | matched `mon00.pic` fully | **near miss** — right idea, wrong field width: `b2` is only `mask[0]`; the mask continues into the 19 bytes that were assumed to be padding. Works whenever `tilesW*tilesH ≤ 8`, which is every cel in `mon00.pic`. |
| `band_length = b0 * b1 * 32` | matched `mon01.pic` exactly | that is the *all-tiles-present* special case; fails whenever any tile is omitted (`mon32.pic` band 0: 12 tiles, 9 present → 288 not 384) |
| `b0` = monotonic Y-offset accumulator | held for some files | premise error — cels are standalone sprites, not strips of one image, so there is no accumulating Y |
| Byte autocorrelation on `mon09.pic` largest band | peaks at stride 8, 16, 24 | correct signal (8 bytes = one bitplane of a tile) but not decisive alone |
| Blind layout search over 13 tile geometries × 2 interleaves × 2 bit orders × 2 tile orders, scored by tile-boundary discontinuity | inconclusive, all scores ≈ 1.0 | the correct answer (8×8, planar, MSB, row-major) does not minimise edge discontinuity on a dithered EGA source; **the metric was the problem, not the hypothesis space** |
| Rendering a single cel and eyeballing it | misleading | `mon02.pic` cel 9 is genuinely a lattice/portcullis pattern, which reads as "wrong decode, tile-grid artefact". Cost a false negative on the correct hypothesis. |
| Tile-presence mask rendered as an image, row-major vs column-major | **decisive** | row-major gives contiguous silhouette blocks, column-major gives checkerboards (`mon02.pic` cels 12/13/16, `mon09.pic` cel 0) |
| `GRAVEYRD.EGA` as a layout oracle | **decisive** | rendering it plane-major 4×8000 at 320×200 produces an obvious graveyard scene, fixing the engine's plane/bit conventions before `.PIC` was cracked |
| Locating the reader via `muls #26` byte search | found nothing | the constant is loaded as `move.w #0x1a,d1` then `mulu.w d1,d0`, not as an immediate multiply — searching for `\x00\x1a` with an opcode prefix filter found it |
| Locating the reader via `lea 32(An),Am` search | **decisive** | two hits, one of which (`CODE+0xabf8`) was a false lead, but the search for `move.w #26,-(a7)` alongside led to the A4 jump-table route that resolved `-0x7eae(A4)` → `CODE+0x35e6`, the cel drawer |

---

## 3. `.EGA` full-screen images (`DRAGONSC.EGA`, `GRAVEYRD.EGA`, `TITLEPAG.EGA`)

**Confirmed** (layout, palette, and — as of the §3.3 stride-bug fix —
per-pixel colour accuracy, byte-exact against an independent oracle). All
three files are exactly 32768 bytes, and are **byte-identical to the
DOS/EGA release's `.ega` files of the same name** (same md5 for all 3 —
this is literally the same shipped asset, not just the same format).

- Dimensions/layout: **320×200 pixels, 4 bitplanes, plane-major**
  (all rows of plane 0, then all rows of plane 1, ... — *not*
  row-interleaved), starting at file offset 0, no header.
  `320/8 * 200 * 4 = 32000` bytes of real pixel data.

  > **Correction (2026-08-01, stride-bug investigation — see §3.3):** the
  > original claim that "the remaining 768 bytes at the end of the file are
  > padding, not a hidden structure" was **wrong in its specifics**, though
  > right that the 768 bytes are inert. The 4 planes are **not**
  > tightly packed at `8000` bytes each (`32000` total) with one 768-byte
  > trailer; each plane instead occupies a fixed **8192-byte (`0x2000`)
  > slot** (`4 * 8192 = 32768`, the whole file — no separate trailer at
  > all), and it's the unused `192` bytes at the end of *each* plane's slot
  > (`4 * 192 = 768`) that add up to the "768 extra bytes" previously
  > misattributed to one lump block. Decoding with the old assumption
  > (contiguous `8000`-byte planes) reads increasing amounts of the next
  > plane's padding/start as if they belonged to the current plane —
  > harmless for plane 0 (offset 0 either way) but by plane 3 the read
  > region has drifted 576 bytes into the wrong data. **This, not source
  > dithering, was the primary cause of the "speckle" previously reported
  > in `GRAVEYRD.EGA`/`DRAGONSC.EGA`'s fill regions** (§3.1's old
  > conclusion is superseded below).
- Verification: decoding at this layout and rendering a palette-independent
  greyscale image (4-bit index × 17) produces:
  - `TITLEPAG.EGA` → clearly legible engraved stone lettering reading
    **"BANE OF COSMIC FORGE"**, plus flanking character art either side.
  - `GRAVEYRD.EGA` → a coherent scene with visible tombstone/figure
    silhouettes.
  - `DRAGONSC.EGA` → a coherent UI element (icon-box row across the top,
    partial "WIZARDRY" wordmark at the right).
  - Tried the alternative row-interleaved layout first — it also produces
    *some* structure but far less legible than plane-major.
  - Tried 256×256×4bpp (exact-fit arithmetic, no remainder) — renders as
    noise, ruled out.

### 3.1 Palette — confirmed (sole candidate in the whole binary)

Traced the real `TITLEPAG.EGA`/`GRAVEYRD.EGA`/`DRAGONSC.EGA` loader forward
from the title/credits filename table (§1.1, file offset `0x558e`) through
a dedicated loader wrapper at `CODE+0x4ddc` (distinct from the generic
`LoadResourceFile` at `CODE+0x366`) to the consumers at `CODE+0x3d14`/
`CODE+0x40d0`. Exhaustively searched the entire 351KB CODE hunk for every
possible palette-install site (`LoadRGB4`, `SetRGB4`, `LoadRGB32`, direct
`$DFF000` custom-chip access, `OpenScreen`): there is exactly **one**
`OpenScreen` call and exactly **one** `LoadRGB4` call in the whole binary
(3 of 4 raw `OpenScreen`-opcode hits were false positives from an
unrelated library sharing the same LVO displacement, disambiguated by
tracing each call site's `A6`/library-base provenance). This structurally
rules out an alternate palette for full-screen `.EGA` images — the game
opens exactly one `Screen` and loads exactly one 16-colour palette, once,
at startup: the same table already documented in §2.4 (`PIC_PALETTE` in
`tools/wizardry6/pic-format.ts`), shared by `.PIC` cels and `.EGA` full
screens alike. A copper-list palette trace was considered and ruled out
structurally — `Bane` never touches `$DFF000` directly anywhere in the
binary (no custom copper list is ever installed; it's a well-behaved
`graphics.library` client throughout).

Applying `PIC_PALETTE`: `TITLEPAG.EGA` renders recognisable fantasy-art
content (a red devil/skeletal figure, a purple-robed wizard, grey armoured
knights) at 3× zoom — the strongest evidence for this palette being
correct (sampled pixel values in the engraved-lettering area are drawn
almost exclusively from indices {0,1,8,9} = black/white/dark-grey/
light-grey, consistent with genuine stone-relief shading).

> **Correction (2026-08-01):** the rest of this paragraph originally read:
> *"`GRAVEYRD.EGA` and `DRAGONSC.EGA` retain their confirmed silhouette/UI
> structure with colour applied, but show more residual speckle in fill
> areas — weaker evidence, though two controls (reversed plane order,
> reversed bit order) confirm the speckle lives in the source bitplane
> data itself, not in the palette or decode convention. Leading
> hypothesis: genuine period-accurate EGA dithering... Closing this fully
> would need a real external oracle... not pursued this pass."*
>
> This was **half right**: the speckle genuinely lived in the bitplane
> *reads*, not the palette — but the two controls that were run (plane
> order, bit order) do not actually test where each plane's data is read
> *from* in the file, only how the already-fetched bits are subsequently
> interpreted, so they couldn't have caught a stride bug. The "real
> external oracle" this note said would be needed to close the question
> turned out to already exist in the corpus: the DOS/EGA release's
> `.t16` full-screen variant (`docs/wizardry6/dosega/data-structure.md`
> §9.3) is the *same artwork*, independently confirmed clean, in a
> structurally unrelated packed-chunky 4bpp encoding decoded by different
> code (`decodePackedPixelLinear`, not `decodePlanarPlaneMajor`). Using it
> as ground truth (§3.3) found and fixed a genuine plane-stride bug: after
> the fix, `TITLEPAG.EGA`/`DRAGONSC.EGA` render fully clean (0 mismatches
> against the `.t16` ground truth), and `GRAVEYRD.EGA`'s sky-fill speckle
> — while still visually present — is now **byte-identical** to the same
> `.t16` ground truth, which upgrades "leading hypothesis: genuine
> dithering" to **confirmed**: it really is baked into the source art, not
> a decode error, now that the actual decode error has been separately
> found and fixed. See §3.3 for the full writeup.

### 3.2 Trailing bytes — superseded, see §3.3

> **Correction (2026-08-01):** this section originally described the
> file's 768 "extra" bytes as one inert trailing block (hypothesis, not
> proven) and traced the DOS `Read()` driver's hardcoded `0x8000`-byte
> read count as supporting evidence. The read-count trace below is still
> accurate as far as it goes, but the "one 768-byte trailer" framing was
> **wrong** — see §3.3 for the corrected structure (four 192-byte
> per-plane gaps, not one 768-byte trailer) and its disassembly
> confirmation.
>
> Original trace (kept for the record): traced the actual DOS `Read()`
> driver (`CODE+0x3bd4`, called by the `CODE+0x4ddc` loader wrapper): it
> reads a **hardcoded `0x8000` (32768) byte count**, not derived from the
> file's real on-disk size via `Examine`/`Seek` — so the file's full 32768
> bytes genuinely are read into memory in one shot, not split or
> short-read by the I/O layer. This part of the trace remains correct and
> is consistent with §3.3's finding (all four plane slots, real data plus
> padding, sit inside that one 32768-byte read).

### 3.3 Bitplane stride bug — confirmed and fixed

**The "speckle" reported in `GRAVEYRD.EGA`/`DRAGONSC.EGA`'s fill regions
was primarily a real decode bug, now fixed** — not (solely) genuine source
dithering as §3.1's original text concluded. Re-investigated in response to
a user report that the speckle looked like a bitplane offset bug rather
than authentic period art.

**The bug:** the decoder assumed the file's 4 bitplanes are packed
back-to-back — `plane[p]` at byte offset `p * 8000` (`8000 =
320/8 * 200`, the exact pixel-data size of one plane) — with the file's
remaining 768 bytes as one inert trailer at the end. This is structurally
plausible (it accounts for every byte) but wrong.

**The fix:** each plane actually occupies a fixed **8192-byte (`0x2000`)
slot** — `plane[p]` at byte offset `p * 8192` — of which only the first
8000 bytes are real pixel data; the trailing 192 bytes of each slot are
unused padding. `4 * 8192 = 32768`, exactly the whole file: there is no
separate trailing block at all, just four small per-plane gaps that happen
to sum to the same 768 the old analysis found. Under the old assumption,
plane 0 still decoded correctly (its slot starts at file offset 0 either
way), but each subsequent plane read progressively more of the *next*
plane's padding-then-data as if it were its own final rows: by plane 3 the
read window had drifted 576 bytes from where it needed to be.

**Verification (empirical, byte-exact):** used the DOS/EGA release's
already-confirmed-clean `.t16` decode
(`docs/wizardry6/dosega/data-structure.md` §9.3 — 320×200, 4bpp
packed-chunky, linear, decoded with `decodePackedPixelLinear`, a
structurally unrelated encoding to `.ega`'s planar format) as an
independent ground-truth pixel-index grid for the same artwork, then
brute-force searched every byte offset in `[0, fileSize - 8000]` for which
one best reproduces each of the 4 truth bit-planes:

| Bit-plane | Naive offset (old, `p*8000`) | Best-fit offset (found by search) | Match at best-fit |
|---|---|---|---|
| 0 | `0` | `0` | 100.0000% |
| 1 | `8000` | `8192` | 100.0000% |
| 2 | `16000` | `16384` | 100.0000% |
| 3 | `24000` | `24576` | 100.0000% |

All 4 best-fit offsets are an exact arithmetic progression with common
difference `8192` (`0x2000`), and every one reaches a **perfect
100.0000% bit match** against the `.t16` ground truth — not just a local
maximum. Applying `planeStride = 0x2000` end-to-end:

- **`titlepag.ega`**: 0 pixel mismatches / 64,000 pixels (100.000000%
  match) against the `.t16` ground truth, both platforms (Amiga file and
  DOS/EGA file — they're byte-identical, §3 intro).
- **`graveyrd.ega`**: 0 / 64,000, both platforms.
- **`dragonsc.ega`**: 0 / 64,000, both platforms.
- **Total: 0 mismatches across 384,000 pixel comparisons** (3 screens ×
  2 platforms × 64,000 pixels), verified independently in both Python
  (throwaway probe) and the committed TypeScript pipeline's actual PNG
  output (re-checked pixel-for-pixel against the same ground truth after
  regenerating the assets).
- A hypothesis raised mid-investigation — that `.ega` might actually be
  packed-chunky like `.t16` rather than planar (a "packed decoded as
  planar" misread, which can coincidentally preserve edge/silhouette
  legibility while scrambling fill regions) — was tested and **refuted**:
  decoding `.ega`'s raw bytes with the packed-chunky scheme renders pure
  noise (worse match than the buggy planar decode, not better). The
  format is genuinely planar; only the per-plane stride was wrong.

**Verification (disassembly, independent confirmation of the same
constant):** extracted the CODE hunk (file `0x28`–`0x55C64`, per §1) and
disassembled around `CODE+0x3d72`–`0x40cc` (`DrawMazePiece`, the
first-person dungeon-view piece blitter documented in §4.4). Its per-plane
destination-pointer setup, reached from a plane-0 base computed at
`CODE+0x3db6`–`0x3dc6` (`movea.l d0,a1` / `adda.l d0,a1` / `adda.l
<PC-relative screen-bitplane-base>,a1`), advances to planes 1-3 with three
literal `adda.l #0x2000,a1` instructions (`CODE+0x3e30`, `0x3e94`,
`0x3fd4`, each immediately preceding that plane's per-row copy loop) — the
exact same `0x2000` (8192) constant found empirically above, here used as
the real, on-screen Amiga display's own per-plane bitplane pitch. This
independently corroborates that `0x2000` is a genuine fixed convention
`Bane` uses for single-bitplane buffers (both the real display screen and,
per the empirical proof above, the on-disk `.ega` full-screen asset
format) — not a coincidental numeric match.

**Root-cause note (not further pursued):** the likely reason the on-disk
file mirrors the *display's* bitplane pitch is that these full-screen
assets were saved (or are loaded) as a direct dump into/from the game's
own screen bitplane memory, which — per the disassembly above — is
allocated in fixed `0x2000`-byte-per-plane slots regardless of the actual
`320×200` content size. This is offered as an explanation, not a claim
requiring further proof; the fix itself is fully verified independent of
this root-cause account.

**Fix applied:** `tools/shared/amiga-planar.ts`'s `decodePlanarPlaneMajor`
gained an optional `planeStride` parameter (defaults to the old
tightly-packed behaviour, so every other caller — `.PIC` cel tiles,
`mazedata.ega`, `WFONT`/`WPORT` tiles — is unaffected; all pass no 6th
argument). `tools/wizardry6/decode-ega-screen.ts` (Amiga) and
`tools/wizardry6/decode-dosega-ega-screen.ts`'s `.ega` mode (DOS) both now
pass `planeStride = 0x2000`. Regenerated
`public/assets/wizardry6/amiga/screens/{dragonsc,graveyrd,titlepag}.png`
and the DOS/EGA equivalents; re-ran `tools/viewer/build-manifest.ts`
(manifest content unaffected — same filenames, no new/removed assets).

Verified extractor: `tools/wizardry6/decode-ega-screen.ts` (writes
`public/assets/wizardry6/amiga/screens/{dragonsc,graveyrd,titlepag}.png`,
`PIC_PALETTE`, `planeStride = 0x2000`).

Full trace and evidence (palette + original, now-corrected, trailing-bytes
investigation):
`docs/wizardry6/amiga/investigations/ega-screen-palette.md`.

---

## 4. `mazedata.ega` (102456 bytes) — confirmed (art bank, not level geometry)

**Confirmed** (disassembly-traced loader + full-corpus rendered
verification). Does not share the `.EGA` full-screen format (§3) — it's a
variable-record graphics bank, not a fixed 320×200 image.

### 4.1 Overall structure

```
+0                                  u16 BE  dirCount   (153)
+2                                  u16 BE  subCount   (366)
+4                                  dirCount×6 bytes    directory records
+4 + dirCount*6            (=922)   subCount×5 bytes    compose-list sub-table
+4 + dirCount*6 + subCount*5 (=2752) dirCount graphics blocks, back-to-back,
                                     partitioned exactly by the directory's
                                     own offset field, to EOF (102456)
```

`4 + 153*6 + 366*5 = 2752`, matching the directory's own first data offset
exactly.

### 4.2 Directory (153×6-byte records) — confirmed

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0` | 4 | `offset` | BE u32, absolute file offset of this record's pixel data, strictly increasing |
| `+4` | 1 | `widthUnits` | width in 8-pixel units (`widthPx = widthUnits*8`) |
| `+5` | 1 | `heightRows` | height in pixels (rows) |

**Verified invariant, zero deviation across all 153 records** (same shape
as the `.PIC` directory's confirmed invariant, §2.1):
`dirRecords[i+1].offset - dirRecords[i].offset === widthUnits[i] *
heightRows[i] * 4`, and for the last record, against `fileSize`.

> **New this session — runtime representation differs from the on-disk
> format ("follow the buffer past the read"):** immediately after the
> chunked file read completes, `Bane` runs an **in-place fixup loop**
> (`CODE+0x3cf6`-`0x3d10`, part of the same loader function documented
> below) that overwrites every directory record's `offset` field, field
> by field: `record[i].offset := runtimeBufferBase + record[i].offset`.
> The loop bound is the buffer's own `dirCount` header field (`153`,
> `move.w (a0),d0; subq.w #1,d0; dbra d0,...`), it advances exactly 6
> bytes per iteration (the directory's own record stride), and it only
> ever touches the leading 4-byte `offset` field of each record — the
> `widthUnits`/`heightRows` bytes are left untouched. **The on-disk
> format documented in the table above is unaffected and still
> byte-exact** (this is what every extractor in this corpus reads from
> the shipped file) — but any *runtime* consumer that reads the directory
> **after** this loop has already run sees `offset` as an **absolute
> memory pointer to the pixel data**, not a file-relative byte offset.
> This matters for anyone tracing the compose-list's consumer (§4.4):
> a renderer resolving `dirIndexOrNone` into pixel data would do a
> straight `directoryBase[dirIndexOrNone].offset` pointer dereference at
> runtime, with **no further arithmetic** — it would not need to re-add
> a buffer base, and a disassembly search for "base + offset" arithmetic
> near the compose-list would therefore find nothing even if the
> renderer exists and works correctly. **(This prediction was confirmed
> when the renderer was found: `CODE+0x3ddc` resolves the graphic with a
> bare `movea.l (a2),a3` pointer dereference, no base addition.)** The
> compose-list sub-table itself
> (366×5 bytes, starting right after the directory) is **not** touched by
> this fixup — the loop's bound is `dirCount`, not `dirCount+subCount`.

**Ground truth**: traced directly from `Bane`'s own loader via the
proven "find the reader, not the format" method (§1.4). `MAZEDATA.EGA`'s
filename-table string (file offset `0x4ce6`) is `PEA`-referenced once, at
`CODE+0x49e6` (no numeric index pushed, unlike the neighbouring
`WFONT0-4.EGA` loads — this correctly separates "load this one fixed-name
file" from "build and load `WFONTn.EGA`"), leading to a size/read function
at `CODE+0x3c56`-`0x3cf6` that computes:

```
total_size = dirRecords[last].offset + widthUnits[last] * heightRows[last] * 4
```

— **byte-for-byte identical** to the structural formula independently
derived from the raw bytes, and in the same order of operations
(`mulu.w #6` for the 6-byte record stride, `addq.l #4` for the 4-byte
header, `mulu` width×height then `lsl.l #2` = `×4` bitplanes) the game
itself uses purely to know how many bytes of `mazedata.ega` to read from
disk.

### 4.3 Pixel format — confirmed (rendered, zero-noise full-corpus decode)

Each record's block (`widthUnits*heightRows*4` bytes) is plane-major,
4-bitplane, MSB-left — the same convention as `.PIC` cels (§2.3) and
`.EGA` full screens (§3): `widthPx = widthUnits*8`, `heightPx = heightRows`.
Row-interleaved and the swapped-orientation hypothesis both render as
noise; plane-major with this field mapping renders **clean, recognisable
dungeon art** in every sample. Applying the confirmed `.PIC` palette
(§2.4) renders cleanly with no speckling. This format's planes are
tightly packed (no per-plane padding, confirmed by the §4.2 offset
invariant holding with zero deviation), unlike the full-screen `.EGA`
format's fixed `0x2000`-byte-per-plane slots (§3.3) — a real structural
difference between the two art-bank formats, not a decode-quality
difference; both now decode byte-exact clean.

**Full-corpus decode: 153/153 records decode without error**, 199,408
total pixels, 0 out-of-range colour indices, **0 records render as
noise**. Sample content: perspective-scaled brick wall textures (3 sizes),
doors, pillar/archway edge pieces, floor/ceiling perspective strips, a
full corridor/archway scene with hanging drapes and a stairway, wall
chains, a treasure chest, a skeleton marker, and a run of 20 UI icons
(sword, dial/clock-face icons with embedded digits, robed-figure icons).

### 4.4 Compose-list sub-table (366×5-byte records) — **confirmed**

> **Correction (`re-codebreaker` pass, 2026-08-01):** the consumer has been
> found — `DrawMazePiece` at **`CODE+0x3d72`–`CODE+0x40cc`**, the
> first-person dungeon-view piece blitter — and it **refutes two of the
> previous field assignments**. Superseded claims:
> - "`+0` = `depthGroup`, cycling 0,1,2" — **wrong**. `+0` is the
>   **directory index**. The renderer computes
>   `mazeBuffer + 4 + record[+0]*6` (`mulu.w #6; addq.l #4` at
>   `CODE+0x3dce`–`0x3dd8`) — literally the directory-record address
>   formula from §4.2. The earlier reading looked at only the first few
>   records (whose `+0` values happen to be `0,1,2,0,1,2,…` because the
>   directory's own first entries are a 3-step perspective cascade) and
>   generalised from them. Measured over the whole table, `+0` takes
>   **all 153 distinct values `0..152` and nothing else**, which is a far
>   stronger index signature than `+1` ever had.
> - "`+1` = `dirIndexOrNone`, `0xFF` = 'nothing to draw' sentinel" —
>   **wrong on both counts**. `+1` is a **signed** destination byte
>   column: `CODE+0x3daa` sign-extends it with `ext.w` before use, so
>   `0xFF` is a genuine **-1**, not a sentinel. All three `0xFF` records
>   (6, 38, 44) pair it with `+3 = 10`, giving a final destination column
>   of `-1 + 10 = 9` — an ordinary on-screen position. The "index fits in
>   `0..152`" observation was a coincidence of range: `+1` has only 26
>   distinct values, all small.
> - The real "nothing to draw" mechanism is **`+4 == 0`**, an explicit
>   early-out (`tst.b d0; beq` at `CODE+0x3d9a`), used by **49/366**
>   records — not 3.

| Offset | Size | Field | Meaning | Read at |
|---|---|---|---|---|
| `+0` | 1 | `dirIndex` | index into the §4.2 directory — which graphic to draw | `CODE+0x3dcc` |
| `+1` | 1 | `destXByte` | destination byte column, **signed** (`ext.w`) | `CODE+0x3da8` |
| `+2` | 1 | `destY` | destination screen row (multiplied by `0x28` = 40 bytes/row) | `CODE+0x3dba` |
| `+3` | 1 | `srcClip` | bytes skipped from the source graphic's left edge, **and** added to `destXByte` | `CODE+0x3de0` / `0x3db0` |
| `+4` | 1 | `widthBytes` | bytes copied per row (clipped width); `0` = draw nothing | `CODE+0x3d96` |

Destination address = `screenBase + destY*40 + destXByte + srcClip`;
source address = `directory[dirIndex].offset + srcClip`, advancing by
`widthUnits` per row and by `widthUnits*heightRows` per bitplane, for
`heightRows` rows × 4 planes. `screenBase` is the CODE-hunk-relative
global at **`CODE+0x169c`**, confirmed as the drawing bitmap's plane-0
pointer by `CODE+0x1a78`–`0x1a8c`, which fans it out into four plane
pointers `0x2000` bytes apart (320×200, 4 bitplanes).

#### `DrawMazePiece` — signature and the mirroring mechanism

```
DrawMazePiece(u16 srcIdx @8(a5), u16 mode @0xa(a5), u16 dstIdx @0xc(a5))
```

- `mode` — `1` = OR the source into the screen (`or.b d0,(a1)+`,
  transparent overlay), `0` = replace (`move.b (a3)+,(a1)+`).
- `dstIdx == 0xFFFF` → **direct path** (`CODE+0x3d84`): compose record
  `srcIdx` supplies *both* the graphic and the placement.
- `dstIdx != 0xFFFF` → **mirrored path** (`CODE+0x3efe`): the graphic
  comes from `composeList[srcIdx].dirIndex` but the placement fields come
  from `composeList[dstIdx]`, and the blit is **horizontally mirrored** —
  the source pointer walks *backwards* from `offset + widthUnits - 1 -
  srcClip` and every byte is passed through a **256-byte bit-reversal
  table at `CODE+0x157c`** (`move.b (a4,d1.w),d0`). This is how the game
  draws a left-hand wall from the right-hand wall's art and vice versa.

The bit-reversal table is **confirmed byte-exact**: all 256 entries
satisfy `table[i] == reverse_bits(i)`, **zero mismatches**.

#### Depth/lateral addressing — how a maze cell picks a record

The per-cell dispatcher at **`CODE+0x9b58`** computes compose-list indices
as **`baseIndex + depth`**, where `depth` is its `8(a5)` argument
(bounded by `cmpi.w #3, 8(a5); bge` — 3 depth steps) and the `baseIndex`
values arrive as further arguments (`0x12(a5)`, `0x14(a5)`, `0x16(a5)`,
`0x18(a5)`). So **depth is encoded by position in the table, not by a
field**: the compose list is laid out as consecutive runs, one entry per
depth step, per (piece kind, facing). The 49 `widthBytes == 0` records are
alignment padding that keeps those runs uniform — e.g. records 0/1/2 are
the front wall at 3 depths, record 3 is a zero-width filler, 4/5 continue
the next run. The same function indexes an "already drawn" flag grid at
`-0x2c5a(A4)` with `depth*3 + lateralColumn` (`muls.w #3` at
`CODE+0x9b60`), confirming **3 lateral columns per depth**.

`CODE+0x3d72` has **50 call sites**, all `jsr d16(pc)` — it is a
module-local static, never exposed through the A4 jump table, which is
exactly why the previous session's census of A4 entries 57/58 could not
find it.

> **Correction (disassembly extraction pass, 2026-08-07):** `CODE+0x632c`–
> `0x6552` is **not** one contiguous 16-call block as stated above — it
> spans two adjacent functions. `CODE+0x632c` (`LAB_036C`) is a whole
> function: one unrelated call first (`0x6330`–`0x633a`, an A4-trampoline
> call, nothing to do with `DrawMazePiece`), then the genuinely
> unconditional, branch-free **16-call `DrawMazePiece` sequence at
> `CODE+0x633c`–`0x6452`** (confirmed straight-line, no interleaved
> branches or other calls), then 8 more calls to two *other* functions
> plus one conditional branch before `unlk/rts` at `0x64ec`. Immediately
> after, `CODE+0x64ee` (`LAB_036E`) is a **second, separate** function
> containing the 6-call status-icon sequence already described below —
> its own stack cleanup ends exactly at `0x6552`, which is why that value
> was quoted as the outer boundary. The 16-call corridor sequence and the
> mirrored-pair claim (`20↔16`, `21↔17`, `22↔18`) are both otherwise
> exactly correct — only the byte-range annotation conflated the two
> functions. The full 16 `(dstIdx, mode, srcIdx)` triples, in call order:
>
> ```
> 1:  { dstIdx: 123,   mode: 1, srcIdx: 123 }   // CODE+0x6348
> 2:  { dstIdx: 124,   mode: 1, srcIdx: 124 }   // CODE+0x635a
> 3:  { dstIdx: 125,   mode: 1, srcIdx: 125 }   // CODE+0x636c
> 4:  { dstIdx: 16,    mode: 1, srcIdx: 20 }    // CODE+0x637e
> 5:  { dstIdx: 17,    mode: 1, srcIdx: 21 }    // CODE+0x6390
> 6:  { dstIdx: 18,    mode: 1, srcIdx: 22 }    // CODE+0x63a2
> 7:  { dstIdx: 20,    mode: 1, srcIdx: 16 }    // CODE+0x63b4
> 8:  { dstIdx: 21,    mode: 1, srcIdx: 17 }    // CODE+0x63c6
> 9:  { dstIdx: 22,    mode: 1, srcIdx: 18 }    // CODE+0x63d8
> 10: { dstIdx: 151,   mode: 1, srcIdx: 151 }   // CODE+0x63ea
> 11: { dstIdx: 152,   mode: 1, srcIdx: 152 }   // CODE+0x63fc
> 12: { dstIdx: 153,   mode: 1, srcIdx: 153 }   // CODE+0x640e
> 13: { dstIdx: 65535, mode: 0, srcIdx: 25 }    // CODE+0x641e
> 14: { dstIdx: 65535, mode: 0, srcIdx: 28 }    // CODE+0x642e
> 15: { dstIdx: 65535, mode: 0, srcIdx: 31 }    // CODE+0x643e
> 16: { dstIdx: 65535, mode: 0, srcIdx: 34 }    // CODE+0x644e
> ```
>
> Note calls 1–3 and 10–12 have `dstIdx == srcIdx` (not `0xFFFF`) but
> still take the *mirrored* code path (`CODE+0x3efe`) — the game does not
> special-case `dst==src` as "non-mirrored," so a faithful port must not
> either. Cross-verified via both radare2 and the committed IRA
> disassembly (`Bane.asm`), byte-identical between the two tools.

#### Verification

1. **Renderer-implied structural invariants, zero deviation** over all
   **317 drawn records** (the 49 with `widthBytes == 0` are excluded by
   the game's own early-out). Each is a bound the blit must respect to
   stay inside the source graphic and the destination plane:

   | Invariant | Violations |
   |---|---|
   | `dirIndex < 153` (and every one of the 153 values occurs) | 0 / 366 |
   | `srcClip + widthBytes <= directory[dirIndex].widthUnits` | 0 / 317 |
   | `0 <= destXByte + srcClip` and `+ widthBytes <= 40` | 0 / 317 |
   | `destY + heightRows <= 200` | 0 / 317 |
   | last written byte `< 0x2000` (one plane) | 0 / 317 |

   These are now asserted by the committed extractor
   (`verifyComposeListInvariants` in `tools/wizardry6/decode-maze.ts`),
   which prints "compose-list renderer invariants … hold with zero
   deviation across 317/366 drawn records" on every run.

2. **Rendered oracle.** A faithful Python port of `CODE+0x3d72`
   (including the mirrored/bit-reversed path) executing the real
   16-call argument sequence read out of `CODE+0x632c` composes a
   **complete, correct first-person dungeon corridor**: mortared stone
   side walls (left drawn as the mirror of the right), stone ceiling,
   cobbled floor receding to a vanishing point, and a dark doorway in
   the far wall — plus the `CODE+0x64ee` sequence's six 16×16 status
   icons along the top. Every piece lands in the right place with the
   right perspective scale, using the confirmed `PIC_PALETTE` (§2.4).
   Any error in the field assignment (X/Y swapped, wrong index byte,
   unsigned `+1`, missing clip) scrambles this image; it composes
   cleanly only with the table above.

### 4.5 What this file is *not*

Not a per-level/per-cell wall-bit grid — no level-count or grid-dimension
structure exists anywhere in the header/directory. `mazedata.ega` is
confirmed as the **art asset bank**, not the level data.

> **Correction (superseded twice — see §4.7 for the final answer):** an
> earlier pass in this session concluded `scenario.dbs` sections 2/3 were
> "ruled out" as per-level geometry, based on disassembly that identified
> them as per-**class** (14-record) UI data. **That conclusion was itself
> wrong.** A `re-codebreaker` escalation found the real evaluator functions
> (`CODE+0x9202`/`0x969a`/`0x9876`) — siblings of the already-confirmed
> per-cell dispatcher `CODE+0x9b58` that are *not* reachable from it in
> either direction, which is why two separate call-graph traces from `9b58`
> missed them — and these prove `scenario.dbs` section 2 **is** the
> per-level maze geometry (14 real records, one per dungeon level) and
> section 3 is a per-level companion entity table. The `-0x47a4(a4)` global
> both prior passes read as "selected class slot" is in fact the **current
> maze level index** (confirmed: written by a `SetLevel` function at
> `CODE+0x103f0`, and hard-set to literal level numbers at two scripted
> level-transition sites, `CODE+0x42148`/`0x43284`). See §4.7 and §7.1's
> own (now twice-corrected) block for the full derivation and independent
> verification.

Verified extractor: `tools/wizardry6/decode-maze.ts` (writes
`public/assets/wizardry6/amiga/maps/mazedata.png` + `.json` [153-frame
atlas], `mazedata-composelist.json`, and
`public/assets/wizardry6/amiga/palettes/mazedata.json`).

Full trace and evidence: `docs/wizardry6/amiga/investigations/mazedata.md`.

### 4.6 `DrawMazePiece`'s full caller call-graph — traced this session, no per-cell wall data found

**Confirmed** (disassembly, exhaustive `d16(PC)` displacement-scan xrefs — the
same method that solved §4.4). This session traced *every* caller of
`CODE+0x9b58` (the per-cell dispatcher from §4.4) upward to the outermost
renderer function, and every callee downward to where compose-list pieces
actually get drawn, in order to answer the open question "what supplies
`CODE+0x9b58`'s wall-type-code arguments". **Result: no per-cell (X,Y-indexed)
wall/door/floor-type data source was found anywhere in this call graph.**
Every data-dependent branch resolves to one of: pure position-parity
arithmetic, the already-ruled-out `scenario.dbs` section-2/3 class buffer
(§7.1), or a newly-discovered monster/NPC token-placement mechanism unrelated
to wall geometry. Full detail and address-by-address evidence:
`docs/wizardry6/amiga/investigations/mazedata.md` (Session 4 addendum).

**New confirmed structural facts:**

- `CODE+0x9b58`'s own frame is far larger than previously characterized — it
  reads at least 9 word arguments (`0x8`–`0x2a(a5)`), not just the 5 named in
  §4.4, and the function body extends to roughly `CODE+0xa3a0` (not a short
  routine). Push-order for its own `DrawMazePiece` calls is now pinned down
  precisely: the call-site push order is `dstIdx` (first pushed) → `mode`
  (second) → `srcIdx` (last pushed, right before `jsr`) — independently
  re-derived from the confirmed `632c` static block's "20↔16" mirrored-pair
  calls and cross-checked against `CODE+0x3d72`'s own `8(a5)`/`0xc(a5)` field
  reads. This refines, and is consistent with, §4.4's existing table.
- `CODE+0x9b58` has exactly 5 `jsr d16(pc)` callers
  (`CODE+0xab92`, `0xad52`, `0xae10`, `0xaed0`, `0xaf90`), all inside one
  large renderer function spanning roughly `CODE+0xa72c`–`0xb25e`.
- A **second, near-duplicate dispatcher function** exists at `CODE+0xa3b0`
  (same "already-drawn" flag-array pattern, same `-0x2caa(a4)` mirror-parity
  flag, its own separate flag array at `-0x2c4e(a4)` vs `9b58`'s
  `-0x2c5a(a4)` — the two 12-byte flag regions are cleared side-by-side at
  `CODE+0xa8e6`/`0xa8f6`). Not fully traced this session; noted for future
  work.
- `CODE+0x9b58`'s later branches (from `CODE+0x9c0a` onward) don't call
  `DrawMazePiece` directly — they call a **different function,
  `CODE+0x9a52`**, which *defers* the draw: it appends a 12-byte record
  (two `u16` compose-list-index-or-offset fields, a `u8` "kind" byte with
  `0xFF` = "nothing", a secondary `u8`, and a `u8` depth tag) to a 30-slot
  scratch array at `-0x2c12(a4)` (bound-checked against a literal `30`,
  `CODE+0x9b3e`–`0x9b52`; 11 call sites for `CODE+0x9a52` found, all inside
  `9b58`'s own body, `CODE+0x9c46`–`0xa33c`). A **separate consumer loop**
  at `CODE+0xaffa`–`0xb142` (found by tracing `9b58`'s own callers upward)
  iterates this same array once per depth, filtering by the record's depth
  tag matching the current depth counter (`-0x2cae(a4)`) and by "kind" ≠
  `0xFF`, then calls `DrawMazePiece` with the stored fields — i.e. `9b58`'s
  compose-list selections for these branches are staged through a small
  z-sorted deferred-draw list, not drawn immediately.
- `CODE+0x9a52` itself adds a computed X/Y adjustment to the two index
  fields, looked up from two small tables at `-0x3adc(a4)`/`-0x3aaa(a4)`
  indexed by `kind*0x13a + (depth-1)` (`CODE+0x9aa6`–`0x9ac4`). These two
  tables are referenced from **~20 unrelated call sites scattered across the
  whole 351 KB CODE hunk** (not just maze code — e.g. `CODE+0xd1f8`,
  `0x13ca6`, `0x14f4e`, `0x185d2`, `0x21240`...), with **no writer found
  anywhere** (searched for both a `move.l`-style pointer store, since
  `-0x3adc(a4)` doesn't look like a pointer variable at that reference shape,
  and a stride-based content check) — this is almost certainly a **generic,
  globally-shared static offset table** (plausibly a perspective/screen-offset
  table used throughout the renderer, not maze-specific), and does *not*
  appear to be `scenario.dbs` section 8 data despite the superficially
  matching `0x13a` (314-byte) stride — flagged explicitly because that
  stride match looked promising at first but the table's address falls in
  the DATA hunk's zero-filled-at-load region and has far too many unrelated
  non-maze callers to be a per-level file's contents. **Weak/likely
  coincidental lead, not pursued to a conclusion.**
- The outer renderer function (`CODE+0xa72c`–`0xb25e`) does three things,
  none of which read a per-cell wall array:
  1. **Static backdrop.** Runs a 4-step depth loop (`-0x2cae(a4)`, bound
     `-0x2cb0(a4)` initialised to `4`, `CODE+0xa984`) and, per depth, draws
     several fixed blocks of **entirely immediate-constant**
     `DrawMazePiece` calls (dozens of literal compose-list indices at e.g.
     `CODE+0xab0a`–`0xab86`, `0xac1e`–`0xac52`, `0xacbc`–`0xad30`), each
     block gated only by a small per-depth boolean "draw" flag
     (`-0x2ca8(a4)`, `-0x2ca0(a4)`, `-0x2c98(a4)`, `-0x2c90(a4)`,
     `-0x2c88(a4)`, `-0x2c80(a4)`, `-0x2c78(a4)`) that is **set to `1`
     unconditionally for every depth by `CODE+0xa892`'s init loop** and is
     only ever *cleared* (view-distance-limiting shape) by
     `CODE+0xa4d0`/`0xa594`/`0xa5de`, whose own gating condition — a byte
     array at `-0x2c65(a4)`, tested via `cmpi.b #1` at 3 sites
     (`CODE+0xa4ec`, `0xa5a6`, `0xa5f0`) — has **zero writers anywhere in
     the 351 KB CODE hunk** (searched exhaustively for the matching
     `lea -0x2c65(a4),a0` addressing form). This reads as either dead code
     in the shipped build or a not-yet-located alternate write path; either
     way, **the default, always-executed behaviour is to draw the same
     fixed backdrop pieces at every depth on every render**, independent of
     any maze content.
  2. **Class-conditional status-icon bar.** `CODE+0xa810` computes a bit
     index from 5 screen-position globals (`(-0x479a(a4))*64 +
     (-0x479c(a4))*8 + (-0x479e(a4))`) and calls the confirmed `TestBit`
     primitive (A4 entry 46, `CODE+0x2958`) against
     `(-0x481e(a4)) + 0x43a` — **exactly** the same buffer and field
     already documented in §7.1 (`scenario.dbs` section 2's working-copy
     buffer, populated *only* by the character-creation "copy selected
     class record" mechanism at `CODE+0x1000c`–`0x100d2`; confirmed by an
     exhaustive whole-hunk search for any `move.l`-style write to
     `-0x481e(a4)`, which found exactly one non-clearing writer, at
     `CODE+0x10020`, inside that same chargen function). If the bit is set
     and `-0x47a4(a4)` (the same "selected class slot" global from §7.1) is
     `0`, `1`, or `4`, it draws a **6-icon status bar** via a sibling
     function at `CODE+0xa72c` (immediate compose-list indices
     `0x15a`–`0x169`, i.e. records in the confirmed "20 UI icons" run at
     the tail of the directory, §4.3) **instead of** setting up the normal
     per-depth "draw" flags, then returns early — this is a HUD/status
     overlay gated on party state, not maze content. This is the *same*
     code path §7.1 already traced and concluded was per-class UI data;
     tracing forward from `CODE+0x9b58` converges on it rather than
     surfacing new per-cell data.
  3. **Monster/NPC token overlay (new discovery).** A separate loop at
     `CODE+0xaffa`–`0xb1cc` reads records from the *same* `-0x2c12(a4)`
     30-slot array `CODE+0x9a52` populates, but with a different field
     interpretation (`+0xa` = depth tag compared against the current depth;
     `+8` = a cel-selector byte, `0xFF` = "no token here"; `+0`/`+2`/`+4`/
     `+6` = up to two screen X/Y pairs). When a token is present, it calls
     the *already-confirmed* `.PIC`-style cel compositor (A4 entry 56,
     `CODE+0x35e6`, §2.3) — **not** `DrawMazePiece` — with a 2-byte
     NUL-terminated cel-index list built from record bytes `+8`/`+9`. This
     is a plausible mechanism for placing a monster/NPC portrait at a
     specific corridor position (reusing the already-solved monster-portrait
     rendering pipeline, §2.6), but its own *source* record (what populates
     the `-0x2c12(a4)` array with real monster placements, as opposed to the
     deferred-draw records `9a52` also writes there) was not traced this
     session.

**Paths tried (this session, `CODE+0x9b58` caller trace):**

| Approach | Result | Why it didn't find per-cell wall data |
|---|---|---|
| Trace `9b58`'s own baseIndex args (`0x12`–`0x18(a5)`) forward into the two mirror-parity flags `-0x2caa(a4)`/`-0x2cac(a4)` | Both are **pure arithmetic** on player position + facing globals (`-0x47a2(a4)`, `-0x47a0(a4)`, `-0x4798(a4)`), parity (`/2` remainder) — zero memory/array reads involved | Confirms these select *which side* to mirror, not *what* to draw; not a content lookup at all |
| Find `9b58`'s 5 callers and trace the containing renderer function | Found the whole `CODE+0xa72c`–`0xb25e` function; its `DrawMazePiece` calls are **entirely immediate constants**, gated by per-depth flags that default to always-1 | The "backdrop" is static/table-driven, not maze-content-driven; the flags' only conditional-clear path depends on an array (`-0x2c65(a4)`) with no writer found anywhere in the binary |
| Trace the one genuinely data-dependent branch (`CODE+0xa810`'s `TestBit` against `-0x481e(a4)+0x43a`) | Converges exactly with the **already-ruled-out** `scenario.dbs` section-2/3 class-buffer finding from §7.1 (same buffer, same field, same sole writer at `CODE+0x1000c`) | Re-confirms a prior negative result rather than finding new per-cell data; this branch selects a class-conditional status-icon bar, not wall art |
| Trace `9b58`'s deferred-draw mechanism (`CODE+0x9a52` → `-0x2c12(a4)` → consumer loop at `CODE+0xaffa`) | Found a genuinely new mechanism (30-slot deferred/z-sorted draw list) but its own inputs (`8(a5)`/`0xa(a5)`/etc. at the `9a52` call sites inside `9b58`) are themselves a mix of immediates and small per-depth static-table lookups (`-0x7c5e(a4)`, `-0x7c6e(a4)` — also zero writers found) | Deferred *when* to draw, not *what* determined by cell content; the "what" is still static |
| Checked whether the same `-0x2c12(a4)` array is reused for monster/NPC token placement | **Yes** — found a second consumer loop (`CODE+0xaffa`–`0xb1cc`) reading it with a different field layout, calling the confirmed `.PIC` cel compositor for monster portraits | Genuine new finding, but about monster placement, not wall geometry; the *source* of the monster-placement records themselves wasn't traced |
| Checked `-0x3adc(a4)`/`-0x3aaa(a4)` (a `0x13a`=314-byte-stride table inside `9a52`, matching `scenario.dbs` section 8's record size) as a candidate connection to an undecoded `scenario.dbs` section | Referenced from ~20 unrelated call sites across the whole binary, zero writers found, address falls in the DATA hunk's zero-filled region | Almost certainly a generic shared table, not section-8 file content; flagged as a weak/unconfirmed lead only |

> **Re-checked this session against the now-99.47%-covered `Bane.asm`
> (these two "no writer found anywhere" claims predate the `Bane.cnf`
> coverage fix, so they were only ever checked against the old ~1.5%
> window) — both negatives hold, now exhaustively.** `-0x2c65(a4)`: only
> 3 references in the whole binary (`grep`-verified), all
> `CMPI.B #1,0(A0,D0.L)` reads at exactly the 3 already-cited addresses
> (`CODE+0xa4ec`/`0xa5a6`/`0xa5f0`) — zero writes. `-0x3adc(a4)`/
> `-0x3aaa(a4)`: 19 references each (38 total, `grep`-verified), every
> single one a `MOVE.B 0(A0,Dn.L),Dn`-shaped read — zero writes to
> either table anywhere in the binary. Both conclusions upgrade from
> coverage-limited to fully confirmed: these two arrays really are
> read-only from the shipped code's perspective (populated by some
> mechanism outside the CODE hunk entirely — DATA-hunk static init or a
> mechanism this project hasn't traced — not by any instruction in
> `Bane`'s own code).

**Assessment (superseded — see §4.7):** this section originally concluded,
evidenced but unproven, that the corridor renderer draws a fixed,
non-cell-content-driven backdrop. **A `re-codebreaker` escalation refuted
this.** The per-cell wall-type codes are real and do exist — they just
don't live anywhere in `CODE+0x9b58`'s own call graph (which is why the
exhaustive bidirectional trace above, sound as far as it went, structurally
could not find them). They're computed by three **sibling** functions
(`CODE+0x9202`/`0x969a`/`0x9876`) called directly from the outer renderer
alongside `9b58`, not from `9b58` or its callees at all — and they read
real per-level dungeon data from `scenario.dbs` section 2, the same buffer
this section's own paths-tried table (row 3) had already flagged as
converging on a "class buffer", which turned out to be a wrong
identification carried over from an earlier pass (see §7.1's correction
block). Full derivation, verification evidence, and the corrected format
spec: §4.7 below.

---

### 4.7 `scenario.dbs` section 2/3 — the real per-level dungeon maze geometry

**Confirmed** (disassembly via `re-codebreaker` escalation, independently
re-verified in the orchestrating session from the prose alone — see the
verification block below). Supersedes §4.5's and §4.6's "no per-cell wall
data found" conclusion and §7.1's original section-2/3 finding (per-class
UI data) — both are now understood to have been looking at the right
*bytes* through the wrong *lens*: the same buffer really is read by
character-creation UI code (§7.1's original trace was accurate as far as it
went), but it is *also*, and primarily, the dungeon level's own maze
geometry — `-0x47a4(a4)` (the index selecting which of 14 records to load)
is the **current maze level**, not a "selected class slot"; the two roles
were conflated because both are small `0..13` indices into the same
14-record section.

#### 4.7.1 Why the previous traces missed it

`CODE+0x9b58` (§4.4/§4.6) and the outer renderer function's own inline
logic only ever *consume* pre-computed wall-type codes — they never read
`scenario.dbs` themselves. The actual per-cell **evaluation** happens in
three sibling functions, called directly from the outer renderer's depth
loop (`CODE+0xaa4a`–`0xaaf4`) at the same call depth as `9b58`, not from
`9b58` or reachable from anywhere in its call graph:

| Call site | Callee | Lateral offset | Result stored in |
|---|---|---|---|
| `CODE+0xaa60` | `CODE+0x9202` | `0` (straight ahead) | `-0x2c70(a4)` |
| `CODE+0xaa82` | `CODE+0x969a` | `0` | `-0x2c6e(a4)` |
| `CODE+0xaaa4` | `CODE+0x9876` | `0` | `-0x2c6c(a4)` |
| `CODE+0xaac8` | `CODE+0x9202` | `-1` (`#$ffff`) | `-0x2c6a(a4)` |
| `CODE+0xaaec` | `CODE+0x9202` | `+1` | `-0x2c68(a4)` |

> **Correction (dungeon-walker M6 session, 2026-08-07):** the sentence
> that used to follow here — "those 5 globals are then pushed as `9b58`'s
> baseIndex arguments" — is wrong on two counts, found while extracting
> `9b58`'s literal `baseIndex` constants for the walker's per-cell
> slot-key scheme. Re-verified instruction-by-instruction against
> `disasm/Bane.asm`:
>
> - The evaluator result does **not** feed `9b58`'s arithmetic `baseIndex`
>   arguments (`0x12(a5)`/`0x14(a5)`/`0x16(a5)`/`0x18(a5)`, the ones
>   `ADD.W 8(a5),D0`'d against depth in §4.4/§4.5). Those are **4 literal
>   immediates, hardcoded per call site** — e.g. the front-wall call
>   (`CODE+0xab92`) pushes `0x7a, 0x7a, 0, 0`; the left-wall calls push
>   `0x82,0x8e,3,0xc` (`0xad52`) and `0x86,0x8a,6,9` (`0xae10`); the
>   right-wall calls push the exact mirror-swapped pairs, `0x8a,0x86,9,6`
>   (`0xaed0`) and `0x8e,0x82,0xc,3` (`0xaf90`). The evaluator result
>   instead lands at a *different* argument slot, **`0xA(a5)`**, used
>   inside `9b58`'s body exclusively via `CMPI.W` (against `2`, `7`, `3`,
>   `4`) and one `EXT.L`-then-dispatch read — never as an `ADD.W` operand.
>   It's a dispatch/gating key selecting which literal-driven draw path
>   fires, not itself part of the baseIndex+depth arithmetic.
> - The 5 cited "push" address pairs don't all actually reach `9b58`.
>   Only 3 of the table's 5 result globals do: `-0x2c70(a4)` (front, once,
>   into `0xab92`) and `-0x2c6a(a4)`/`-0x2c68(a4)` (left/right, each
>   *twice*, into `0xad52`+`0xae10` and `0xaed0`+`0xaf90` respectively —
>   `9b58` is called 5 times total: 1 front + 2 left-side "layers" + 2
>   right-side "layers"). `-0x2c6e(a4)` and `-0x2c6c(a4)` (the `969a`/
>   `9876` evaluator siblings' results) **never reach `9b58` at all** —
>   they instead feed a structurally near-identical but *shorter*
>   16-word/32-byte sibling dispatcher at `CODE+0xa174`, plus several
>   small 2-word-argument gate stubs (`CODE+0xa4d0` and three neighbours)
>   that each do their own `CMPI.W #2,10(a5)` on the same result — not
>   traced further this pass.
>
> **Addendum (dungeon-walker M6 session, 2026-08-08):** the sentence just
> above — "used inside `9b58`'s body exclusively via `CMPI.W` (against
> `2`, `7`, `3`, `4`) and one `EXT.L`-then-dispatch read" — undersold its
> own finding: those aren't 4 independent equality checks running
> alongside a separate dispatch. It's one cascade, fully traced this pass:
>
> 1. Gate: `CMPI.W #3,8(a5); BGE.W ...` — the whole mechanism only runs
>    for `depth<3` (`8(a5)` is the depth argument).
> 2. Preamble: `CMPI.W #2,10(a5); BEQ.S ...` (equality) then
>    `CMPI.W #7,10(a5); BLT.S ...` (a **range** check, `<7` vs `>=7`, not
>    an equality-to-7 test as the sentence above implied) — `10(a5)==2`
>    **or** `10(a5)>=7` (i.e. any of `7,8,9,10,11,12,13,14`) fires one
>    extra literal-driven `DrawMazePiece` call (baseIndex `0x16(a5)`/
>    `0x18(a5)`), then falls through regardless.
> 3. The fallthrough always reaches `CODE+0xa04c` (`LAB_04F6`), a genuine
>    **15-entry jump table for `10(a5)` = 0-14** (`CMP.L #$f,D0; BCC` +
>    `ASL.L #1,D0` + PC-relative computed jump — same shape as `CODE+
>    0x964e`'s feature table). The "`CMPI #3`"/"`CMPI #4`" checks are
>    **live jump targets reached from this table** (indices 1/3/4 share a
>    landing block that then discriminates `10(a5)`'s exact value further),
>    not standalone comparisons — my own first-pass framing above was
>    imprecise about this.
>
> Full per-value trace of that 15-entry table (`10(a5)` = 0-14, meanings
> per §4.7.2's dispatch table above):
>
> | `10(a5)` | Meaning | What happens |
> |---|---|---|
> | 0 | wall 0 | no draw here — falls to the shared tail (below) |
> | 1 | wall 1 | 2 direct `DrawMazePiece` calls + a conditional deferred-queue push |
> | 2 | wall 2 | preamble draw only (idx2 itself is a no-op) |
> | 3 | wall 3 | conditional deferred-queue push(es) + the same 2 direct calls as `1` |
> | 4 | feature 7→4 | conditional deferred-queue push + the same 2 direct calls |
> | **5** | **feature 1→5 ("door")** | preamble skipped (`10(a5)<7`); **1 direct `DrawMazePiece` call**, unconditional — see below |
> | 6 | feature 2→6 | 1 direct `DrawMazePiece` call |
> | 7 | feature 8→7 | preamble draw + 1 more direct call |
> | 8 | feature 3→8 | preamble draw + 1 conditional deferred-queue push |
> | 9 | feature 4→9 | preamble draw + 1 conditional deferred-queue push |
> | 10 | feature 9→10 | preamble draw + 1 direct call |
> | 11 | feature 10→11 | preamble + base draw + 1 more direct call |
> | 12 | feature 11→12 | preamble + base draw + 1 more direct call |
> | 13 | feature 12→13 | preamble + base draw + 1 more direct call, literal mode `-1` |
> | 14 | feature 5→14 | preamble + 1 conditional call with a **fully literal** `srcIdx=$0158` (344) — not baseIndex-derived at all |
>
> All paths converge on a shared tail (`CODE+0xa05e`) doing further gated
> draws from the feature-14/15 "triggered" flag arrays (§4.7.2) — the
> already-documented static-backdrop mechanism, not new here.
>
> **Door rendering confirmed** (`10(a5)=5`, `CODE+0x9dd2`-`0x9e0a`): calls
> `DrawMazePiece` once, unconditionally, with `srcIdx`/`mode`/`secondary-
> pieceIdx` computed from **2 more of `9b58`'s own literal per-call-site
> arguments** the earlier pass didn't list — `44(a5)`/`46(a5)` — following
> the exact same mirror-parity pattern as `0x12`-`0x18(a5)`: front
> `0xab92`: `$B2,$B2`; left `0xad52`/`0xae10`: `$B5,$BE` / `$B8,$BB`;
> right `0xaed0`/`0xaf90`: `$BB,$B8` / `$BE,$B5` (exact mirror swaps of
> the left pair, as expected). This also resolves `LAB_026F`
> (`DrawMazePiece`)'s own parameter roles precisely: `8(a5)`=`srcIdx`,
> `10(a5)`=blend (`0`=overwrite, nonzero=`OR.B` merge), `12(a5)`=`!=
> 0xFFFF` routes to a **second compose-list index** used to reposition/
> resize the blit (a real "compose two records" mode) rather than the
> simple direct-vs-mirrored split earlier sessions' `632c` static-corridor
> work needed (that block never used this second-record mode).
>
> **Net effect on M6:** the mechanism this whole investigation assumed —
> per-cell wall/feature data flowing through to real `DrawMazePiece` calls,
> door cells included — is now confirmed end-to-end with concrete formulas
> for most of the 15 dispatch values. What's still open, and now clearly
> scoped as implementation work rather than further disassembly: `9b58`
> takes at least 6 confirmed literal-per-call-site argument slots (`0x12/
> 0x14/0x16/0x18/0x2c/0x2e(a5)`, i.e. `18/20/22/24/44/46`) and the original
> caller-trace pass found reads as far as `0x2a(a5)` inside the function,
> so more may exist; the deferred-draw queue (`CODE+0x9a52`/its consumer
> at `CODE+0xaffa`-`0xb142`, both already documented) needs its own
> semantics nailed down for values `1/3/4/8/9`; and the `CODE+0xa174`
> sibling dispatcher (fed by the 2 evaluator results that never reach
> `9b58`) is still fully untraced. A full data-driven per-cell renderer
> needs all of this — a real, multi-session implementation task in its own
> right, not a quick follow-up.
>
> Net effect on the walker's own M6 work: the literal `baseIndex`
> constants above (front/left×2/right×2) are real, per-call-site
> constants — usable directly for a hand-authored slot table — but which
> *compose-list index within a run* gets drawn (i.e. which of several
> literal-driven variants `9b58` picks) is gated by the evaluator's
> wall-type code at `0xA(a5)`, comparing it against `2`/`7`/`3`/`4`.
> Resolving what those 4 comparison values mean (tying them back to the
> already-exported `wallA`/`wallB`/`feature` planes) is the next concrete
> step — see `docs/wizardry6/TODO.md`'s `dungeon-walker-m6-wiring` row.

#### 4.7.2 The evaluator: `CODE+0x9202` (and siblings `0x969a`/`0x9876`)

```
EvalCellFace(x@8, y@0xa, locX@0xc, locY@0xe, region@0x10, lateral@0x12):
  if lateral != 0: step (x,y,locX,locY,region) by (dFwd=0, dLat=lateral)   ; CODE+0x9160
                   if that step went off-map -> return 2 (solid/wall)
  cellIndex = region*64 + locY*8 + locX                                    ; CODE+0x92a0-0x92b0
  if TestBit(levelBuf + 0x43a, cellIndex): 14-way dispatch on -0x47a4(a4)  ; CODE+0x9434
  if TestBit(levelBuf + 0x49a, cellIndex): 14-way dispatch on -0x47a4(a4)  ; CODE+0x949e
  switch (facing = -0x4798(a4)):                                          ; CODE+0x9532
     0: wall = GetBitField(levelBuf + 0x060, cellIndex, 2)   ; this cell's face-A wall
     1: wall = GetBitField(levelBuf + 0x120, cellIndex, 2)   ; this cell's face-B wall
     2: wall = <neighbour cell's face-A wall>                ; CODE+0x908c, neighbour = (x, y-1)
     3: wall = <neighbour cell's face-B wall>                ; CODE+0x90f6, neighbour = (x-1, y)
  feature = GetBitField(levelBuf + 0x1f8, cellIndex, 4)      ; 4-bit feature code
  orient  = GetBitField(levelBuf + 0x378, cellIndex, 2)      ; 2-bit feature orientation
  if (facing == orient) || feature == 6 || feature >= 0xd:
        16-way dispatch on feature                            ; CODE+0x964e
  return wall-or-feature-derived code
```

> **Correction (dungeon-walker M6 session, 2026-08-08):** the guard above
> read `feature == 6 || feature <= 0xc` before this session; disassembling
> `CODE+0x9578`-`0x9582` shows that's backwards — it's `feature == 6 ||
> feature >= 0xd` (i.e. `feature ∈ {13,14,15}`), corrected above. For every
> other feature value, `CODE+0x964e`'s table is reached **only** when
> `facing == orient` — from any other facing, that cell renders as a plain
> wall regardless of its feature code.
>
> `CODE+0x964e`'s full 16-entry table (feature 0-15 → return value, `D7`
> holds the raw 0-3 wall bitfield going in; "unchanged" means the stub
> leaves `D7` alone and only performs a side-effect array write instead of
> setting a return value):
>
> | feature | Returns | Notes |
> |---|---|---|
> | 0 | wall value (unchanged) | jumps straight to the same shared return the "skip dispatch" path uses — confirmed pass-through |
> | 1 | **5** | cross-platform confirmed as "closed door" (`maze-plane-semantics` TODO row) — `5` isn't one of `9b58`'s 4 `CMPI` values (`2`/`7`/`3`/`4`), so it must route through `9b58`'s separate, still-untraced `EXT.L`-then-dispatch mechanism |
> | 2 | 6 | |
> | 3 | 8 | |
> | 4 | 9 | |
> | 5 | 14 | |
> | 6 | wall value (unchanged) | side effect: writes word `1` to an array at `-11306(a4)`, indexed `cellSlot*6 + (lateral+1)*2` |
> | 7 | **4** | matches one of `9b58`'s 4 `CMPI` values |
> | 8 | **7** | matches another of `9b58`'s 4 `CMPI` values |
> | 9 | 10 | |
> | 10 | 11 | |
> | 11 | 12 | |
> | 12 | 13 | |
> | 13 | wall value (unchanged) | side effect: writes word `1` to an array at `-11330(a4)`, same index formula as feature 6 |
> | 14 | wall value (unchanged) | side effect: writes byte `1` to an array at `-11342(a4)`, indexed `cellSlot*3 + (lateral+1)` |
> | 15 | wall value (unchanged) | side effect: writes byte `1` to an array at `-11354(a4)`, same index formula as feature 14 |
>
> `orient` is read exactly once, only in the gate comparison above — none
> of the 16 stubs reference it again, so orientation strictly gates
> *whether* the dispatch runs, never *what* it returns. The 4 side-effect
> arrays (features 6/13/14/15) look like per-cell "triggered/discovered"
> state flags, structurally identified (stride, index formula) but not
> semantically decoded. **Still open:** `9b58`'s `EXT.L`-then-dispatch
> path (distinct from its 4 `CMPI` checks) — needed to know what happens
> for door cells (`5`) and every other feature-derived value this table
> produces (`6`, `8`-`14`) that isn't one of the 4 `CMPI`-compared values.

`levelBuf` = `-0x481e(a4)` — the buffer §7.1 originally traced as a
character-creation "selected class" scratch copy. `0x969a`/`0x9876` are the
same shape for the two perpendicular faces (`0x9876` reads `+0x120` before
`+0x060`, the mirrored side). `-0x47a4(a4)` (§7.1's "selected class slot")
is the **current maze level**: confirmed set by `SetLevel` at
`CODE+0x103f0` (`move.w $8(a5),-$47a4(a4)`) and hard-coded to literal level
numbers at two scripted level-transition sites (`CODE+0x42148`,
`0x43284`), and saved/restored via `CODE+0x11392` — none of which make
sense for a UI class-selection index. `CODE+0x1000c`–`0x100d2` (§7.1's
"chargen copy" function) is `LoadLevel`: it allocates the section-2/3
working buffers, flushes them to the per-level cache arrays
`-0x4816(a4)[level]`/`-0x47de(a4)[level]` when dirty, and computes
`partyX`/`partyY` (`-0x47a2(a4)`/`-0x47a0(a4)`, the same globals already
confirmed incremented during party movement, §4.6) from the *loaded*
level's own region-origin table — i.e. it's the level-load/flush routine,
not a character-creation routine.

**Facing 2/3 neighbour-step directions — confirmed this session
(disassembly).** The doc previously flagged "the neighbour-step direction
for facings 2/3 wasn't independently disassembled" as an explicit gap.
Disassembling `CODE+0x908c` (file `0x90b4`) and `CODE+0x90f6` (file
`0x911e`) directly:

- **Facing 2**'s helper decrements its own `y` argument by 1
  (`move.w 0xa(a5),d0; subq.w #1,d0`) before calling the shared
  coordinate-resolver at `CODE+0x8f14`, then — on success — reads
  **plane A** (`+0x060`) at the resolved cell. I.e. facing 2's neighbour
  is at `(x, y-1)`, and it reads that neighbour's plane A.
- **Facing 3**'s helper decrements its own `x` argument by 1
  (`move.w 0x8(a5),d0; subq.w #1,d0`, `y` unchanged) before the same
  resolver call, then reads **plane B** (`+0x120`). I.e. facing 3's
  neighbour is at `(x-1, y)`, reading that neighbour's plane B.

Combined with the already-confirmed "facing 0 reads *this* cell's plane A,
facing 1 reads *this* cell's plane B" — this is the classic shared-edge
wall-storage scheme: plane A stores each cell's wall on its own **+Y
side** (facing 0 = looking in +Y, reads your own plane A directly; facing
2 = looking in -Y, reads the *neighbour at y-1*'s plane A, which is the
same physical wall from the other side). Symmetrically, plane B stores
each cell's wall on its own **+X side** (facing 1 = +X, facing 3 = -X via
the `x-1` neighbour). This resolves facing↔coordinate-delta↔plane fully:
`{0:(+Y,planeA), 1:(+X,planeB), 2:(-Y,neighbour planeA), 3:(-X,neighbour
planeB)}` — **confirmed** (disassembly). What remains open is only the
mapping from this local `(+X,+Y)` coordinate frame to absolute compass
directions (north/south/east/west) and the `yAxisDown` sign convention —
per `seer/docs/walker.md` §10.2/§10.4, that's intentionally deferred to the
walker's own empirical M3 pass rather than more static analysis, since a
live walk is a strictly better oracle for it than any further
disassembly.

#### 4.7.3 On-disk format: `scenario.dbs` section 2 (14 × 1346-byte maze levels)

Section 2 (`file offset 0x9408`, `master.hdr[2]` = 1346-byte stride ×
16-slot capacity, of which only the first **14** slots are real — records
14/15 are all-zero, the same "declared capacity, real content padded with
blank slots" convention already established elsewhere in this corpus).
Each level covers a 256×256 maze coordinate space via **12 fixed 8×8-cell
regions** (768 cells total), placed with an explicit per-region origin
table rather than being one flat grid:

| Offset | Size | Field | Bits/cell | Confidence |
|---|---|---|---|---|
| `+0x000` | 96 B | unidentified plane | 1 | hypothesis |
| `+0x060` | 192 B | **wall plane A** (this cell's wall, facing 0) | 2 | confirmed (structure), rendered (value meaning) |
| `+0x120` | 192 B | **wall plane B** (this cell's wall, facing 1) | 2 | confirmed (structure), rendered (value meaning) |
| `+0x1e0` | 12 B | region origin X (1 byte/region, maze coords) | — | confirmed |
| `+0x1ec` | 12 B | region origin Y (1 byte/region) | — | confirmed |
| `+0x1f8` | 384 B | feature code (0-15) | 4 | confirmed (structure), rendered (value meaning) |
| `+0x378` | 192 B | feature orientation (0-3) | 2 | confirmed (structure), hypothesis (meaning) |
| `+0x438` | 2 B | scalar/padding | — | hypothesis |
| `+0x43a` | 96 B | scripted-overlay flag P (fires a per-level 14-way dispatch) | 1 | confirmed |
| `+0x49a` | 96 B | scripted-overlay flag Q (second per-level 14-way dispatch) | 1 | confirmed |
| `+0x4fa` | 24 B | per-region Y-coordinate list (5 slots x 12 regions), feature-code-1 stamp source | — | confirmed (cross-platform, see below) |
| `+0x512` | 24 B | per-region X-coordinate list (5 slots x 12 regions), paired with `+0x4fa` | — | confirmed (cross-platform, see below) |
| `+0x52a` | 24 B | per-region word array | — | hypothesis (still unlocated) |

> **Cross-platform relay (from `dosega/data-structure.md` §6.4a, a
> different session working the DOS/EGA port in parallel — not
> independently re-verified against the Amiga binary itself this
> session, flagged accordingly):** `wmaze.ovr`'s state-6 handler
> ("entering a maze level") was traced disassembling the DOS/EGA port,
> and reads this exact record's `+0x4fa`/`+0x512` as **12 regions x 5
> slots** of `(Y,X)` word-pair cell coordinates (`region=si, y=+0x4fa
> value, x=+0x512 value`, indexed `si*5+di`). If a slot's two words sum
> to a positive value, the handler calls a confirmed `SetMazeCell`
> primitive with `kind=1` — i.e. **`+0x4fa`/`+0x512` are a per-region,
> up-to-5-entry list of cells that get feature-code `1` stamped onto them
> when the level loads**. The DOS session's state-5 handler ("per-step/
> enter maze view") independently corroborates feature-code `1`'s role:
> it checks the player's current cell for value `1` and, if found,
> transitions to a different overlay/state consistent with a door-popup
> UI — converging with this doc's own working label for feature-code `1`.
> This resolves the byte-offset/shape half of what was previously listed
> as "unidentified per-region word arrays" in `maze-plane-semantics`; the
> `+0x52a` third array was not referenced by the traced DOS loop and
> remains unlocated on both platforms. Because this finding comes from
> the DOS/EGA disassembly (not the Amiga `Bane` binary), it's recorded
> here as **cross-platform-confirmed** rather than Amiga-disassembly-
> confirmed — the underlying `scenario.dbs` bytes are already known to be
> byte-identical across both ports (§4.7.5's cross-platform oracle check),
> so the field *shape* transfers directly even though the *code* that
> reads it wasn't independently traced on the Amiga side this session.

These 13 fields partition the 1346-byte record **exactly, zero gap or
overlap** (`96+192+192+12+12+384+192+2+96+96+24+24+24 = 1346`) — derived
independently from the buffer offsets in the evaluator's own disassembly,
not fitted to the byte count.

`cellIndex = region*64 + localY*8 + localX`, `localX = x - originX[region]`,
`localY = y - originY[region]` (both `0..7`). Bit-field extraction is
**LSB-first**, matching the game's own `GetBitField(base, i, n)` primitive
(A4 jump-table entry 48, `CODE+0x29d6`): `bitPos = i*n; ((base[bitPos>>3] |
base[(bitPos>>3)+1]<<8) >> (bitPos&7)) & ((1<<n)-1)`. `TestBit(base, i)`
(A4 entry 46, `CODE+0x2958`, already confirmed elsewhere in this corpus)
is `base[i>>3] & (1<<(i&7))`. `SetBitField` (A4 entry 47, `CODE+0x2984`)
also exists — maze state is mutable at runtime (door/secret discovery,
scripted triggers).

#### 4.7.4 `scenario.dbs` section 3 — per-level entity table (structure and lookup mechanism confirmed, most field semantics resolved)

Section 3 (`file offset 0xe828`, stride 1740, same 14-real/2-blank
capacity pattern). A structure-of-arrays table of **144 per-level
entities**, partitioning to exactly 1740 bytes with zero slack: three
`u16[144]` arrays at `+0x000`, `+0x120`, `+0x240` (288 bytes each), six
`u8[144]` arrays at `+0x360`, `+0x3f0`, `+0x480`, `+0x510`, `+0x5a0`,
`+0x630` (144 bytes each), plus a 12-byte trailer at `+0x6c0`
(`3*288 + 6*144 + 12 = 1740`).

> **Update (this session, `amiga-disasm` trace, independently
> re-verified):** `CODE+0x8fe6` is a complete, self-contained function —
> **`FindEntitySlot(x, y, regionKey, startIndex) -> entityIndex|-1`** —
> exposed via **A4 jump-table entry 64** (`jsr -0x7e7e(a4)`), which is why
> earlier `jsr d16(pc)`/`bsr` scans never found a caller directly:
>
> ```
> FindEntitySlot(x@8(a5), y@0xa(a5), regionKey@0xc(a5), startIndex@0xe(a5)):
>   for d4 = startIndex .. 143:
>     if entity[d4].region(+0x510) != regionKey: return -1   ; abort whole scan, CODE+0x9000-0x9008
>     if entity[d4].x(+0x3f0)  != x: continue                ; CODE+0x901e-0x9026
>     if entity[d4].y(+0x480)  != y: continue                ; CODE+0x9034-0x903c
>     if entity[d4].active(+0x360) == 0: continue             ; CODE+0x9048-0x904c
>     bitIdx = entity[d4].flagBit(+0x5a0)                     ; CODE+0x905a
>     if TestBit(-0x4772(a4) + level*10, bitIdx): continue    ; "already triggered" check, A4 entry 46
>     return d4
>   return -1
> ```
>
> The "abort scan entirely on region mismatch" behaviour (rather than
> `continue`) is explained by the table being **sorted/grouped by
> region** — confirmed by the `+0x6c0` field below.
>
> **`+0x6c0` (previously "12 trailing bytes, open") — confirmed: a
> 12-byte per-region start-index directory.** `trailing[region] ==` the
> index of that region's first active entity (independently
> re-verified, level 0: `[21, 38, 47, 59, 71, 90, 98, 105, 115, 124, 132,
> 137]`, exactly matching the first `active!=0` index found per region by
> direct scan of the same level's `+0x360`/`+0x510` arrays, zero
> deviation). `FindEntitySlot`'s `startIndex` argument is fed from this
> table by its 7 callers, so a fresh per-region scan starts exactly where
> that region's entities begin.
>
> **Value ranges (independently re-verified across all 14 levels'
> active entries):** `+0x3f0` (x) and `+0x480` (y) are **exactly 0-7**
> (local-region coordinates, matching the confirmed 8×8-cell region
> size from §4.7.3); `+0x510` (region) is **exactly 0-11** (matching the
> confirmed 12-region-per-level structure). This upgrades all three from
> "matched against arguments" (mechanism only) to **confirmed identity**
> (x/y/region key fields, not just opaque match keys).
>
> **`+0x360`** is a multi-valued **kind** byte, not a boolean "active"
> flag as originally guessed — callers compare it against specific
> literals (`3` at `CODE+0xff2c`, `7` at `0xef26`/`0x513bc`, `8` at
> `0xef74`, `0x13` at `0x52c4a`), and 14-25 distinct nonzero values occur
> per level; `FindEntitySlot`'s own `!=0` test (line 4 of the pseudocode
> above) is a coarser "any entity present" gate, with the specific kind
> dispatched by each of the 7 callers separately. Only ~5 of the ~25
> observed kind values have a located handler.
>
> **`+0x5a0`** is confirmed: a bit index into an 80-bit (10-byte)
> per-level "already triggered" flag table at `-0x4772(a4) + level*10`
> (the same per-level 10-byte-stride table already independently found
> — but not fully explained — while tracing §4.6's monster/NPC token
> overlay).
>
> **`+0x630`**: packed byte, low 5 bits extracted via a new **A4 entry
> 49** `GetBits(value, shift, count)` primitive (`CODE+0x2a1c`,
> `-0x7ed8(a4)`) at `CODE+0x51466` — structure confirmed, meaning open.
>
> **`+0x240`**: a packed bitfield read via the same new `GetBits`
> primitive with `shift = facing*2` or `facing*2+8`, `count=2`, compared
> against the literal `2` (section 2's confirmed "wall" enum value,
> §4.7.3) — mechanism confirmed, exact meaning (a per-facing wall-state
> override for this entity's cell?) still rendered/hypothesis.
>
> **`+0x000` — confirmed this session: msg.dbs trigger-ID for a
> per-entity conditional message.** The previous pass's negative result
> was a real instance of `narrow-opcode-form-census-false-negative` — it
> only censused `d16(A4)` direct-displacement forms and missed the
> `(An,Dn.L)` zero-displacement indexed form actually used here. Read at
> `CODE+0xb9ae` (`tst.w (a0,d0.l)`) and `CODE+0xb9c0`
> (`move.w (a0,d0.l),-(a7)`), where `a0 = movea.l -0x481a(a4)` (the
> confirmed section-3 working-buffer base, same one §7.1's original
> per-class-UI trace used before the §4.7 domain correction) and
> `d0 = entityIndex*2`. The pushed value feeds `jsr 0x11072(pc)` ->
> `CODE+0x872` -> `CODE+0x730` — the confirmed `LoadMessage(triggerID,
> destBuffer)` API (§6.2) — i.e. `+0x000` is a **msg.dbs trigger ID**,
> displayed conditionally (`ble.b` skips the whole block when `+0x000`
> is `<=0`). Independently re-verified this session (raw disassembly at
> both cited addresses matches exactly) and structurally confirmed a
> second time via the kind-byte dispatch table below: kind `8`'s handler
> (`CODE+0xea6c`) does the identical `tst.w (a0,d0.l)` / conditional-push
> / `jsr 0xb85a(pc)`->`CODE+0x872` sequence — same field, second
> independent consumer.
>
> **`+0x120`** — consumer confirmed: read at `CODE+0xb9f0`, feeding
> `CODE+0x10fb4` (called from `CODE+0xbb2c`), and independently from
> `CODE+0xbe12` (kind 1), `CODE+0xd7f6` (kind `0x16`), `CODE+0x147f8` (a
> different `FindEntitySlot` caller), and `CODE+0xe2ba` (paired with
> `+0x630`). `CODE+0x10fb4` multiplies the value by 5 (a record stride),
> gates on a page-loaded flag that also draws a small dialog frame
> (`CODE+0xeb4`), and does keypress-wait checks (`CODE+0x23cc`/`0x24fc`)
> — consistent with a **secondary sound/flavor-cue resource ID**,
> structurally distinct from `+0x000`'s direct msg.dbs trigger ID.
> Mechanism confirmed, exact resource bank (sound? a second text table?)
> not pinned down — hypothesis on the specific resource type only.
>
> **`+0x360` kind-byte — full dispatch table located, 3 kinds
> semantically confirmed.** `CODE+0xe9dc` (the first-listed
> `FindEntitySlot` caller) reads the kind byte off the matched entity and
> jumps through a 26-entry table at `CODE+0xeb30` (`cmp.l #0x1a,d0;
> asl.l #1,d0; move.w (pc,d0.w),d0; jmp (pc,d0.w)`), independently
> re-verified this session (disassembled `CODE+0xe9d0`-`0xea06` directly:
> confirms the `jsr -0x7e7e(a4)` = `FindEntitySlot` call, the
> `move.b 0x360(a0),d0` kind-byte read, and the `bra.w 0xeb30` dispatch).
> Cross-checked against a direct histogram of the raw `scenario.dbs`
> section-3 bytes across all 14 levels: **all 20 distinct nonzero kind
> values actually present in the data now have a located handler
> address**; 5 more kinds (`14,15,17,18,20`) have handlers in the table
> but never occur in any level's data (dead/unused capacity). Three kinds
> got deeper semantic tracing:
>
> | Kind | Dispatch target | Meaning | Evidence |
> |---|---|---|---|
> | 1 (262 occurrences, most common) | `CODE+0xbcb8` | **teleporter** | decodes `+0x240` via 3x `GetBits` calls (A4 entry 49, `-0x7ed8(a4)`, already confirmed in §4.7.4's field table) and writes the results directly into `-0x479e(a4)`/`-0x479c(a4)`/`-0x479a(a4)` — the already-confirmed player x/y/region globals (§4.7.2). Independently re-verified: disassembled `CODE+0xbcb8`-`0xbd2a` directly, confirms 3 sequential `jsr -0x7ed8(a4)` calls each storing into one of the 3 player-position globals |
> | 5 (36 occurrences) | inline handler (table entry 5) | **token/monster-icon placement** | writes `+0x630` (icon/appearance id) into `-0x4782(a4)`, the §4.6 corridor deferred-draw monster/NPC token-overlay array |
> | 8 (86 occurrences) | `CODE+0xea6c` | **conditional message trigger** | tests `+0x000!=0`, then pushes `+0x000` and calls the msg.dbs display pipeline (`CODE+0xea90` -> `jsr 0xb85a(pc)` -> `CODE+0x872`) — independently re-verified, see the `+0x000` block above |
>
> The other 17 located-but-uncharacterized kind values are left as
> addressed-but-undecoded — a future pass has exact dispatch addresses to
> start from instead of a fresh call-site census.
>
> **Callers and domain — encounter/trigger lookup, not corridor-render
> data.** 7 confirmed call sites for A4 entry 64
> (`CODE+0xe9dc, 0xef0a, 0xff0e, 0x147d4, 0x15b62, 0x513a0, 0x52c2c`), all
> passing the player's current cell (`x=-0x479e(a4)`, `y=-0x479c(a4)`,
> `region=-0x479a(a4)`) — either a fresh per-region scan (`startIndex`
> from `+0x6c0`) or a continuation (a separate global, supporting
> multiple entities per cell). **5 of 7 sites fall inside
> `CODE+0xb000`-`0x16000`**, the same address range as the already-
> confirmed monster-portrait/combat pipeline (§2.6's `MON##.PIC` loader,
> §7.1's `SOUNDnn.SND` loader) — strong evidence section 3 is an
> **encounter/combat-trigger** lookup ("is a kind-tagged entity at the
> cell just stepped onto"), consistent with the walker's own guess
> (`seer/docs/walker.md` §10.3) that this table is the natural home for
> monster/NPC placement data.
>
> **Confirmed disconnected from §4.6's token-overlay array.** None of
> the 139 section-3-buffer accesses found, nor any of the 7
> `FindEntitySlot` callers, fall inside `CODE+0x9202`-`0xb300` (the wall
> evaluators, `9b58`, or `9a52`'s call sites) — section 3 and the
> corridor renderer's monster/NPC deferred-draw array
> (`-0x2c12(a4)`, §4.6) are populated by **entirely disjoint code**. The
> token-overlay array's own source record is still unlocated; it is
> confirmed **not** section 3.

This is the same buffer/array-of-parallel-fields shape already
independently noticed (without knowing what it was) while tracing the
monster/NPC token overlay in §4.6.

#### 4.7.5 Verification

| Check | Result |
|---|---|
| 13-field record partition, section 2 | **Exact, zero gap/overlap**, re-derived independently in the orchestrating session from the prose description alone (not the escalation's script) |
| Region-placement invariant: 0 overlapping cells among "active" (origin ≠ (0,0)) regions | **0/0** across all 14 levels × 12 regions × 64 cells = 10,752 placements — independently reproduced exactly; 148/168 regions are active (the other 20 are unused-region padding at origin (0,0), fully accounted for) |
| Wall-plane value histograms | Independently reproduced **exactly**: wallA `{open:7156, door:197, wall:3316, secret:83}`, wallB `{open:7127, door:192, wall:3361, secret:72}` |
| Feature-code / orientation histograms | Independently reproduced **exactly**: feature code 0 = 90.9% of cells (9771/10752), orientation 0 = 93.8% (10081/10752) |
| **Cross-platform oracle**: Amiga vs. DOS/EGA `scenario.dbs`, same section-2 offset/stride | **0 mismatches** across all 8 geometry fields (wallA/wallB/originX/originY/feature/orient/flagP/flagQ), 17,464 bytes compared, while the two files differ by 14,777 bytes overall elsewhere — independently re-run in the orchestrating session, exact match |
| **`newgame.dbs` cross-check**: first 43,204 bytes = 14× interleaved `[1346-byte section-2 record][1740-byte section-3 record]` starting at file offset `0x19e` | **0/43,204 bytes differ** from `scenario.dbs` sections 2/3 respectively — independently re-run, exact match. Confirms `newgame.dbs` is the mutable maze-state template copied to `SAVEGAME.DBS` at "new game" |
| **Rendered**: compositing each level's 12 regions by maze-space origin | Recognisable dungeon architecture in every level — rectangular rooms, corridors, doors (orange), secret walls (purple), feature cells (yellow outline) — not noise. Level 6 shows an organic cave-like layout (curved walls) in its populated region. **Level 9 shows an unmistakable left-right mirror-symmetric room cluster** (two near-identical door/feature patterns on the right side of the map), independently confirming the escalation's own visual read of the same data |

Independent re-verification method: reimplemented the bit-field extraction,
partition check, region-overlap invariant, and both cross-file byte
comparisons from this section's prose alone (not by copying the
escalation's scratchpad scripts), in a throwaway Python probe first and
then in the committed extractor below — both reproduce every reported
number exactly.

**Still open** (tracked in `docs/wizardry6/TODO.md`): the `+0x000` 1-bit
plane, the `+0x438` scalar, the `+0x52a` per-region word array, and the
value→meaning mapping for the 16 feature codes and the wall values
beyond the open/door/wall/secret rendered guess and feature-code `1`
("closed door" working label). **Resolved this session**: the
facing↔coordinate-delta↔plane mapping is now fully confirmed via
disassembly (facing 0 = own `+Y` side via plane A, facing 1 = own `+X`
side via plane B, facing 2 = neighbour `(x,y-1)`'s plane A, facing 3 =
neighbour `(x-1,y)`'s plane B — see the
new block above `#### 4.7.3`); only the mapping from this local `(X,Y)`
frame to absolute compass directions remains open, and per
`seer/docs/walker.md` §10.2/§10.4 that's intentionally deferred to the
walker's own empirical pass.

> **Session note (2026-08-03): deferral reasoning re-confirmed, no
> static-analysis attempt made against explicit design intent.**
> Re-read `seer/docs/walker.md` §10.1-§10.2 before touching this item, per
> this session's task brief. §10.2's three justifications still hold
> exactly as written: (1) §5.4's data-file design makes `planeDirs` and
> the wall-value table plain JSON, so a wrong guess is a one-line edit,
> not a re-decode; (2) the walker itself is a strictly better oracle for
> this specific question than more disassembly — a wrong `planeDirs`
> shows walls on the visibly wrong side of a rendered corridor, and a
> wrong wall-value mapping produces walk-through-walls or stuck-in-open-
> corridor bugs, both trivially diagnosable against the already-confirmed
> top-down level renders (§4.7.5) in a way no amount of static tracing of
> `CODE+0x9202`'s dispatch targets would settle faster; (3) blocking on
> this would idle M0-M1, which need none of it. No new evidence surfaced
> during this session's work on the other 4 TODO items that bears on the
> local-frame→compass mapping or the remaining 3 unidentified fields
> (`+0x000`, `+0x438`, `+0x52a`), so this item is left open with the
> existing placeholder (`planeDirs: [0, 3]`) rather than forced to a
> static resolution. Left for the walker's own M3 pass, as designed.

Verified extractor: `tools/wizardry6/decode-scenario-maze.ts` (writes
`public/assets/wizardry6/amiga/maps/maze-level00.png`–`maze-level13.png`
[top-down renders] and `maze-levels.json` [full decoded field data for all
14 levels]; re-prints the region-placement and `newgame.dbs` cross-check
invariants on every run).

Full trace and evidence (escalation report + independent re-verification):
`docs/wizardry6/amiga/investigations/mazedata.md` (Session 4 addendum,
`re-codebreaker` results subsection).

---

## 5. Font/portrait `.EGA` files

### 5.1 `WFONT0.EGA` (1024 bytes) — **confirmed**

128 glyphs × 8×8 pixels × 1 bit/pixel (1 byte/row, 8 bytes/glyph,
MSB-first, no header). `128 × 8 = 1024` — matches the file size exactly.
Rendering all 128 glyphs (glyph index = ASCII code) as an atlas produces
a **fully legible standard ASCII font** — digits, uppercase letters,
punctuation all read cleanly (see
`public/assets/wizardry6/amiga/sprites/wfont0.png`).

Verified extractor: `tools/wizardry6/decode-font.ts` (writes
`wfont0.png` + `wfont0.json` atlas sidecar, 128 frames).

### 5.2 `WFONT1.EGA`–`WFONT4.EGA` (4096 bytes each) — confirmed

Despite the "font" naming, these are **not glyph sheets** — each is a
flat, headerless array of **128 tiles** in the exact `.PIC` cel tile
encoding (§2.3: 8×8px, 4 planes, plane-major, 32 bytes/tile):
`128 * 32 = 4096`, matching the file size exactly.

All 5 filenames (`WFONT0-4.EGA`) are loaded from one place,
`CODE+0x49a2`-`0x49e4` (each preceded by pushing its numeric index 0-4),
via `CODE+0x4408` → a sub-loader `CODE+0x1e38` that switches on index:
index 0 reads 1024 bytes into `WFONT0`'s own buffer (matching its
confirmed 128-glyph 1bpp format, §5.1); indices 1-4 each read a full
4096-byte blob into 4 **separate** buffer-pointer slots
(`CODE`-relative `0x16c0`/`0x16cc`/`0x16d8`/`0x16e4`) — the same 4 slots
`WPORT`'s tile-install routine (§5.3) picks between. WFONT1-4 and WPORT
are two different payloads poured through the same "load N raw bytes into
shared tile-buffer slot K" mechanism.

Rendered as 128 tiles/file (16-wide sheet) using the confirmed `.PIC`
palette — all 4 files produce **unambiguous, legible content**:

- **`WFONT1.EGA`**: UI icon tiles (maze wall pieces, a "Zz" sleep-status
  icon, direction arrows) plus pixel-text spelling all **14** Wizardry 6
  class abbreviations in sequence — `FIG MAG PRI THI RAN ALC BAR PSI VAL
  BIS LOR SAM MON NIN` — independently matching the 14-class roster
  already confirmed via `scenario.dbs`'s XP tables (§7.1).
- **`WFONT2.EGA`**: combat/command pixel-text labels `TURN`/`MOVE` plus
  icons (arrows, a "no entry" circle-slash, a dagger, a gem, a target
  reticle, a mountain, an eye, a shield-and-cross) and a few larger
  multi-tile creature/terrain graphics.
- **`WFONT3.EGA`**: a fully legible large ASCII font (space, punctuation,
  digits, `@A-Z`) plus a second dimmed/greyed "disabled" copy of the same
  alphabet, direction-arrow icons, a small flag icon.
- **`WFONT4.EGA`**: a complete item/equipment icon set — swords, daggers,
  axes, shields, armour/helmet pieces, potion bottles, rings, wands,
  keys, scrolls, boots, gauntlets.

**Per-tile semantic naming — rendered (visual pass, this session).** Frames
are still extracted flat (`wfontN_tileNNN`) — the naming below is a
documentation-only overlay, not a code change, and is **rendered**
confidence (assigned by eye against an index-labelled render), not
disassembly-derived, except where independently cross-checked as noted.

- **`WFONT1.EGA`**: tiles `0-20` = maze wall/corner-junction icon set
  (grey line-art, various opening patterns — likely an automap/UI legend);
  tiles `21-31`/`32-41` = **two adjacent, near-duplicate copies** of a
  10-icon status-effect set (`OK`/green button, `Zz` sleep, a cyan/red
  cross target, a purple X pattern, a grey lantern, a white cross-on-red
  [heal], a blue/red bullseye [shield?], a white-X-on-red [poison/dead], a
  cyan skull [dead], a white dice/dot pattern) — plausibly an
  enabled/disabled or two-frame-blink pair, not independently confirmed;
  tiles `42-83` = **the 14 class-abbreviation letters, confirmed
  byte-exact this session** by concatenating the known roster string
  `FIG MAG PRI THI RAN ALC BAR PSI VAL BIS LOR SAM MON NIN` (spaces
  removed, 42 characters) against the tile sequence — every one of the 42
  glyphs matches its predicted letter with zero deviation; tiles `84-105`
  = small coloured vertical-bar icons (stat/HP-SP meter pips, by shape);
  tiles `106-110` = the 5 direction-arrow icons (left/up-turn/right/
  down/corner-enter, red-bordered); tile `111` = a small dark
  creature/monster glyph; `112-127` = unused (blank).
- **`WFONT2.EGA`**: tiles `0-15` = the same wall/corner icon set as
  `WFONT1` but with a yellow highlight overlay (selected/cursor state);
  tiles `16-31` spell the pixel-text labels `TURN`/(partial second word,
  cut by the tile grid) plus command icons (`33`=cyan forward-arrow,
  `34`=red no-entry circle-slash, `35`=red diagonal dagger, `36`=blue
  gem/checker pattern, `37`=black/pink target reticle, `38`=green
  mountain, `39`=blue eye, `40`=white shield-and-cross); `53-54` = a
  cross icon and a red-bordered down-arrow (mirrors `WFONT1`'s direction
  set); `56-98` = several larger multi-tile creature/terrain graphics
  (green foliage/vine shapes, red/tan mottled monster or texture blocks) —
  matches the doc's original prose description exactly, now with
  index ranges attached.
- **`WFONT3.EGA`**: tile `0` blank; `1-5` = the same 5 direction-arrow
  icons as `WFONT1` tiles `106-110` (red-bordered); `6-8` = small
  grey/flag icons; `9-11` = grey checkerboard-dither fill patterns;
  `12-15` = grey frame/box icons; `17-31` = ASCII punctuation
  (`!"#$%&'()*+,-./`); `32-47` = digits `0-9` plus more punctuation
  (`:;<=>?`-ish, one custom glyph at `45`); `48-79` = the full uppercase
  alphabet `@A-Z[\]`; `80-111` = a **second, visibly dimmed/greyed copy**
  of `'A-Z[\]?` (a "disabled" text style) plus a repeat of the direction
  arrow / flag icons at the tail (`110-111`) — matches the doc's original
  prose exactly, confirmed by direct render.
- **`WFONT4.EGA`**: a dense equipment-icon sheet with no internal
  dividers found; by visual clustering: `~1-20` mixed melee weapons
  (swords, axes, maces, daggers); `21-30` potions/rings/shields/helmets;
  `31-63` more weapons, boots, gauntlets, robes/hoods (clothing); `64-79`
  shields, ring, tree/staff-like, mask icons; `80-103` misc gear and more
  potions; `104-111` misc (a `?` icon, a rounded dark icon, boots) —
  matches the doc's original "complete item/equipment icon set" summary;
  a precise per-tile item-name mapping (e.g. which sword icon is
  `KATANA`) was not attempted — there's no code-level tie between a
  specific `scenario.dbs` item record and a specific `WFONT4` tile index
  in the corpus as decoded so far.

Zoomed reference renders used for this pass (not committed, scratch only):
`wfontN_idx.png` in the session scratchpad, index-labelled 16-wide grids
decoded directly from the raw `.EGA` tile bytes.

Open: whether index 15 composites transparently for these tiles (visually
the real backgrounds use index 8 or black, not the cyan index-15
background `.PIC`/`WPORT` use, so the extractor renders these opaque —
not traced to a specific compositing call).

Verified extractor: `tools/wizardry6/decode-wfont-extra.ts` (writes
`public/assets/wizardry6/amiga/sprites/wfont1.png`–`wfont4.png` + `.json`
atlas sidecars, 128 frames each).

### 5.3 `WPORT1.EGA`–`WPORT3.EGA` (4096 bytes each) — confirmed

Each file is a flat, headerless array of **14 portrait records, 288 bytes
each** (`14*288 = 4032`; trailing 64 bytes verified all-zero in all 3
files). Each 288-byte record is **9 tiles in the exact `.PIC` cel
encoding** (§2.3), arranged 3×3 (row-major) into a 24×24px portrait.

Only `WPORT1.EGA` exists as a literal string anywhere in the binary —
`WPORT2/3.EGA` were never found by string search because the game builds
their filenames at runtime by patching a single digit byte in a copy of
the `"WPORT1.EGA"` string template. Traced at `CODE+0x6692` (one of 3
near-identical call sites, `CODE+0x67c6`/`0x2f7c2`/`0x383c2`, all using
byte-identical constants):

```
portrait_id / 14   -> patched into the filename's digit byte ('1' + quotient)
portrait_id % 14    -> the in-file record index (0-13)
Seek(fh, index*288, OFFSET_BEGINNING); Read(fh, buf, 288); Close(fh)
```

— confirmed flat, absolute `index*288` byte offset, no header. The
288-byte record is then installed into the same shared tile-work buffer
mechanism `WFONT1-4.EGA` use (`CODE+0x1e9a`, one of 4 static
buffer-pointer slots selected via a `case` constant — WPORT always uses
case 2).

Rendered all 42 portraits (14×3 files) at 3 candidate tile arrangements
(3×3, 9×1, 1×9) that all satisfy "9 tiles, 32 bytes each" — only 3×3
produces coherent images: 42/42 portraits are unambiguous 24×24px
character/monster face icons (humanoid faces of various skin tones, a
green-scaled lizardman, a bearded dwarf, helmeted figures, hooded
figures, robots), using the confirmed `.PIC` palette and transparent key.

> **Superseded by the "Final update" block below**: the picker UI has
> since been located and directly confirms the free-choice hypothesis at
> the code level, not just by absence of restriction evidence.

**Partial progress (an earlier session): no evidence of race/class-gated
selection found; working hypothesis is a free player-chosen icon
gallery, not identity-bound.** Checked the loading site
(`CODE+0x6692`/file `0x66ba` onward) for any race- or class-conditional
logic that would restrict *which* of the 42 portraits a given character
can pick — found only a **generic platform-variant filename-suffix
selector** (a 4-way `btst.b #0-3,-0x48a7(a4)` dispatch choosing between
`.EGA`/`.CGA`/`.T16`-family string suffixes, shared by many loaders in
this binary, not portrait-specific). No code path conditions the
`portrait_id` value itself on the character's race or class byte. Combined
with `pcfile.dbs`'s confirmed `+412` field (§7.3) being a single
**directly-stored** per-character byte (not computed from a race/class
field at display time), the working hypothesis is that `WPORT`'s 42 icons
are a **free-choice portrait gallery** presented at character creation —
any of the 42 can be picked for any race/class — rather than a fixed
per-race or per-class mapping. This is **not conclusively confirmed**
(the actual character-creation portrait-picker UI code, which would show
whether the offered subset is filtered, wasn't located this pass) but is
the best-supported reading given the evidence: no restriction code found,
and the field itself is a raw stored choice, not a derived value. Left
open for a future pass that locates the picker UI specifically.

> **Update (this session, one bounded attempt per the walker plan's own
> "not much more" guidance):** searched for a picker-loop bound-check
> constant (`cmpi.b #41`/`#42`, the 0-indexed/1-indexed portrait count) as
> a cheap way to find cycling/arrow-key selector code — a raw-opcode
> census of `cmpi.b Dn,#imm` for both `0x29` (41) and `0x2A` (42) across
> the whole CODE hunk found **zero hits**. This doesn't rule out a picker
> UI (it could bound-check a word-sized register, use a different literal
> such as a padded slot count, or use a data-driven menu-count field
> instead of a hardcoded immediate), but it's a genuine negative data point
> against the simplest possible "linear 0-41 cycle" picker implementation.
> Picker UI still not located; hypothesis unchanged.

> **Final update (this session): picker UI found, hypothesis CONFIRMED —
> free-choice gallery, no race/class gating.** The prior session's
> negative `cmpi.b #41/#42` census missed the real bound check because it
> uses `divu.w`, not `cmpi.b` — a `MOD 42` wraparound, not a linear bound
> compare. Also corrected a labelling slip: `CODE+0x67c6`/`0x2f7c2`/
> `0x383c2` are not code, they're the embedded `"WPORT1.EGA\0"` string
> constants referenced via `pea.l d16(pc)` from inside the loader
> functions; the real loader-copy entry points (found via a byte-pattern
> search for the shared `LINK.W A5,#-0x130` prologue, `4E 55 FE D0` —
> independently re-verified: disassembled `CODE+0x6692` directly, confirms
> `link.w a5,#$fed0`) are `CODE+0x6692`, `CODE+0x2f69a`, `CODE+0x38290`.
>
> A caller census against those 3 addresses found exactly 5 call sites.
> Two (`CODE+0x7402`, `0x8498`) are pure roster-display reads of the
> already-stored `portrait_id` — no picker logic. The other three lead to
> **two independent, fully-traced picker implementations**, both
> confirmed via direct disassembly to use a **hardcoded `divu.w #0x2a,d0`
> (42) MOD wraparound**, with no race/class-byte comparison anywhere in
> either cycling loop:
> - **Scratch-var picker** (`CODE+0x2f7f0`-`0x2fa9c`, "new character" /
>   "re-edit character" entry points): decrement (`CODE+0x2f9fc`-`0x2fa16`,
>   independently re-disassembled — `add.w #$29,d0` then `divu.w #$2a,d0`,
>   i.e. `(-1) mod 42` via `+41 mod 42`) and increment (`CODE+0x2fa18`-
>   `0x2fa30`, `addq.w #1,d0` then `divu.w #$2a,d0`) both confirmed
>   byte-exact.
> - **In-place cycler** (`CODE+0x38470` region, a second, independent
>   implementation operating directly on the roster's stored portrait
>   byte): decrement (`CODE+0x386e2`) and increment (`CODE+0x38716`), both
>   independently re-disassembled — confirms the identical `add.w #$29,d1`
>   / `addq.w #1,d1` then `divu.w #$2a,d1` shape, reading/writing
>   `-0x4466(a4)[charIndex*0x1b0]` directly (`0x4602-0x4466=0x19C=412`,
>   exactly `pcfile.dbs+412`, confirming the roster-offset math
>   independently a second way).
>
> **Conclusion: the portrait choice is unrestricted** — both independent
> implementations wrap unconditionally through all 42 icons via a
> hardcoded modulus, with zero race/class-byte reads anywhere in either
> cycling path. This is a direct code-level confirmation, not an
> absence-of-evidence inference. **Hypothesis upgraded from "best-supported
> reading" to confirmed: `WPORT`'s 42 icons are a free-choice portrait
> gallery, not identity-bound.**

Verified extractor: `tools/wizardry6/decode-wport.ts` (writes
`public/assets/wizardry6/amiga/sprites/wport1.png`–`wport3.png` + `.json`
atlas sidecars, 14 24×24px frames each).

Full trace and evidence:
`docs/wizardry6/amiga/investigations/fonts-and-portraits.md`.

---

## 6. `.hdr` index/table files

### 6.1 `misc.hdr` (1024 bytes) — **confirmed**

Huffman decode tree for `Bane`'s text decompressor (§1.3). 256 nodes ×
4 bytes (2×BE u16: left child, right child). Leaf = positive value with
bit 7 clear (`0x00`–`0x7F`, literal ASCII byte). Internal node = negative
value; decoder computes `next_node_offset = (-value) * 4`.

### 6.2 `msg.hdr` (5102 bytes) — confirmed

`msg.dbs`'s directory.

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0` | 2 | `count` | BE u16 = 724 (verified: real records are exactly indices `0..723`) |
| `+2` | 850×6 | record array | fixed capacity 850 slots; slots `724..849` are all-zero (unused) |

Each 6-byte record: 3× BE u16 fields `(A, B, C)`.

> **Correction** (see §7.4): the original pass mislabelled field `A` as
> the confirmed `msg.dbs` byte offset. It's monotonic and in-bounds, but
> that's coincidental — `A` is actually a separate binary-search lookup
> key (`CODE+0x730`) used to resolve an in-game "message trigger ID" to a
> record index, not a byte offset. The real per-message position is
> **`(C & 0xFF)*1024 + B`**: `B` is a page-relative offset (0-1023) and
> `C`'s *low* byte is the page number (0-79, `msg.dbs` = 80×1024-byte
> pages). `C`'s *high* byte is the width of field `A`'s lookup range
> (`C_hi`, 0-113 observed) — a different role from `C`'s low byte,
> confirmed via the same binary-search disassembly.

- **Confirmed**: `(C&0xFF)*1024 + B` gives 724/724 unique, in-bounds
  `msg.dbs` positions, zero collisions, page range exactly 0-79.
- **Confirmed**: the byte at that position is a 1-byte decoded-length
  prefix; the byte immediately after is a compressed-byte-count (not
  needed for decoding); the Huffman bitstream starts 2 bytes after the
  position (§7.4).
- **Confirmed** (see the "Final update" block below): field `A` is the
  start of an inclusive trigger-ID range `[A, A+C_hi]` — every trigger ID
  in that band resolves to the same message record.

> **Update (this session): `CODE+0x872`'s callers found — it is the
> `LoadMessage(triggerID, destBuffer)` public API.** Previous sessions
> traced `CODE+0x872` only as far as "a wrapper that forwards its own
> trigger-ID argument to the binary search at `CODE+0x730`", and reported
> its own callers as not found via a direct `jsr d16(pc)`/`bsr` census
> (suspected indirect/A4 dispatch). Re-disassembled the full function body
> this session (`CODE+0x872`-`0x9aa`, not just its first few instructions):
> it calls `CODE+0x730` (the binary-search field-A lookup) with its own
> first argument, branches on found/not-found (`bne.b`; not-found sets a
> flag at `-0x58be(a4)` to `1` and returns early), then on success reads
> the resolved record's `B`/`C` fields, checks a small page-cache
> (`-0x58c0(a4)`, calling a page-load helper at `CODE+0x7a4` on a cache
> miss), and finally does page-relative reads against a cached `msg.dbs`
> page buffer at `-0x5cc0(a4)` with an explicit `cmp.w #0x400,d0`
> (1024-byte page wraparound check) — this is exactly the confirmed
> `(C&0xFF)*1024+B` page/offset mechanism from this section's main text,
> now traced from the *call* side rather than just the field-math side.
>
> **`CODE+0x872` is itself A4 jump-table entry 15** (`jsr -0x7fa4(a4)`,
> confirmed by finding `4E F9 00 00 08 72` at jump-table slot 15 in the
> DATA hunk) — explaining why the previous `jsr d16(pc)`/`bsr` census found
> nothing: it's called indirectly through A4, the same mechanism already
> established for `ReadSection` (entry 17) and `FindEntitySlot` (entry 64).
> A raw-opcode census for `4E AC 80 5C` (`jsr -0x7fa4(a4)`) across the whole
> CODE hunk finds **287 call sites**, spread throughout the binary
> (`CODE+0x5c46` through `CODE+0x54b14`) — consistent with a heavily-used,
> generic "load and cache a message by trigger ID" primitive. Every sampled
> call site follows the identical 2-argument shape
> `pea.l <destBuffer>; move.w <triggerID>,-(a7); jsr -0x7fa4(a4); addq.w
> #6,a7` (6 bytes of args popped = 4-byte pointer + 2-byte word), matching
> `LoadMessage(triggerID, destBuffer)`.
>
> **Verification:** one call site (`CODE+0x6b7a`) pushes a **literal**
> trigger-ID immediate, `move.w #0x41a,-(a7)` (`0x41a` = 1050 decimal) —
> cross-checked directly against `msg.hdr`'s 724 real field-A values:
> **1050 is exactly one of them** (an exact hit, not a near-miss). Broader
> sweep: of the 287 total call sites, 165 push a literal immediate
> (the rest push a register/computed value, not staticaly checkable);
> **21/165 (12.7%) of those literals exactly equal a real field-A value**
> — well above the ~3.8% base rate a random 16-bit value would hit by
> chance against the sparse 724-of-~18850 field-A range (100-18950), a
> ~3.3x enrichment, though not a 100% match (several mismatches cluster in
> adjacent-integer pairs, e.g. `1212`/`1213`, `2027`/`2028`, `5231`/`5232`
> — plausibly a different or partially-overlapping ID namespace for some
> call sites, e.g. UI widget/button-pair IDs rather than story message
> triggers; not resolved further this session). Net: the *caller* question
> is now **confirmed** (exact function, exact A4 entry, exact call count
> and calling convention, one byte-exact spot-check); field `A`'s full
> real-world ID-namespace semantics remain **open**, now with a
> significantly stronger evidence base than "not pursued" — a genuine
> advance, not a full close.

> **Final update (this session): field `A`'s real-world meaning fully
> resolved — it's the START of an inclusive trigger-ID RANGE, not an
> exact key.** The prior session's "second overlapping namespace"
> hypothesis is **dissolved, not confirmed** — the apparent 12.7%
> exact-match rate was purely an artifact of testing equality against
> what the binary search actually implements as a **range** lookup.
>
> Disassembled the binary-search body (`CODE+0x730`-`0x79c`) in full and
> independently re-verified byte-exact:
> ```
> CODE+0x76a: cmp.w (a0),d0 ; bge.b 0x774      ; reject if triggerID < A
> CODE+0x77a: move.b 0x4(a0),d0                ; d0 = C's high byte (C_hi)
> CODE+0x782: add.w (a0),d0                    ; d0 = A + C_hi
> CODE+0x788: cmp.w d0,d1 ; bls.b 0x792         ; accept if triggerID <= A+C_hi
> ```
> — i.e. every `msg.hdr` record indexes the **inclusive integer range
> `[A, A+C_hi]`**, and any trigger ID in that band resolves to the *same*
> message record. All 724 ranges (rebuilt from the real `msg.hdr` bytes)
> are non-overlapping and correctly sorted. Re-testing all 165 literal
> call-site trigger IDs against **range membership** instead of exact
> equality: **165/165 (100%) resolve successfully**, zero misses. The 3
> previously-cited "mismatch" pairs are not a second namespace at all —
> they're multiple literal call sites sharing one message record's range:
> `1212`/`1213` both fall in `[1209,1213]` (one record, page 3 offset 50);
> `2027`/`2028` both fall in `[2020,2046]`; `5231`/`5232` both fall in
> `[5224,5235]`; an 8-site cluster (`5001`...`5008`, a post-encounter
> reward screen) all fall in `[5000,5008]`, one shared reward-flavor
> message reused across 8 differently-numbered call sites. Also checked
> and ruled out: cross-referencing the 144 originally-"unmatched" values
> against the DOS/EGA port's own (larger, 718-record) `msg.hdr` found only
> 1/144 present there, so "orphaned DOS-only IDs" does not explain the
> residue either — the range-lookup finding fully accounts for the data on
> its own. **Closed**: field `A` = inclusive-range start, `C`'s high byte
> = range width; there is only one ID namespace, not two.

Full trace: `docs/wizardry6/amiga/investigations/scenario-messages-monsters.md`.

### 6.3 `scenario.hdr` (414 bytes) — confirmed (load mechanism + trailing flags), semantics partly open

**Confirmed**: `scenario.hdr` is byte-for-byte identical, in its
**entirety**, to the first 414 bytes of `newgame.dbs` (§7.2). Checked
(and ruled out) whether `scenario.dbs`, `pcfile.dbs`, or `msg.dbs` share
the same prefix — none do; only `newgame.dbs` matches, completely.

**Load mechanism — confirmed**: `SCENARIO.HDR` is read as a flat
414-byte blob (`CODE+0x48d4`) into a DATA-hunk cache — no internal
directory/count field is parsed at load time; it's just cached verbatim
for later field-level access.

**Trailing 6 bytes (offsets 408-413) — confirmed as individually-addressed
fields**, semantics still hypothesis. A whole-binary scan for accesses
into this buffer's span found 76 references, 6 of them byte-granular
fields at the very end:

| File offset | Shipped value | Evidence |
|---|---|---|
| 408 | `0x00` | read/written at several sites |
| 409 | `0x10` | read/written at several sites |
| 410 | `0x01` | compared against literal `1`/`3`; written |
| 411 | `0x00` | read/written |
| 412 | `0x01` | compared against literal `1`; read/written |
| 413 | `0x01` | read; written from a computed value |

These are consumed as small integer flags/state throughout runtime code,
not just at load — a genuine confirmed structural fact, but their
semantic meaning (game-state? difficulty? party-created flag?) wasn't
determined.

**The embedded `H0:`/`F0:` strings — confirmed live scratch-buffer
overlap**, not a dead build artifact as originally guessed: the
`BuildResourcePath` helper (§1.4 correction) uses a fixed scratch buffer
that maps to file offset 328 in this same cached buffer — 1 byte before
the shipped file's `"H0:"` string (offset 329-331). This specific byte
range of the loaded cache is reused as the live path-building scratch
buffer at runtime; the `H0:`/`F0:` text visible in the shipped file is
stale content from the original build tool, overwritten the first time
`BuildResourcePath` runs.

Full trace: `docs/wizardry6/amiga/investigations/headers-and-databases.md`.

### 6.4 `master.hdr` (66 bytes) — confirmed (full structural decode)

Not an opaque constant table — it's a **two-part, 10-entry table**
describing `scenario.dbs`'s internal section layout:

```
words[0..9]   = per-section RECORD SIZE (bytes), for scenario.dbs sections 0-9
words[10..19] = per-section RECORD COUNT,        for scenario.dbs sections 0-9
```

(20 BE u16 values = 40 bytes; the remaining 26 bytes are zero padding.)

**Verified byte-exact, 10/10 sections, cross-file against `disk.hdr`**:
treating `disk.hdr`'s 9 section-boundary offsets (§6.5) plus `0` and
`scenario.dbs`'s file size as 11 boundary points gives 10 section-size
gaps. Every gap divides exactly by the corresponding `master.hdr[i]`
word, zero remainder:

| Section | `scenario.dbs` range | Record size | Record count | Contents |
|---|---|---|---|---|
| 0 | `0x0`–`0x380` | 64 | 14 | class XP tables (§7.1, independently confirmed pre-existing) |
| 1 | `0x380`–`0x9408` | 74 | 500 | item catalog (§7.1) |
| 2 | `0x9408`–`0xe828` | 1346 | 16 (14 real) | **confirmed**: per-level dungeon maze geometry (§4.7) — this row was stale, superseded by §4.7's `re-codebreaker`-escalated finding; not read via the generic `ReadSection` category dispatch below, see §4.7.1 |
| 3 | `0xe828`–`0x154e8` | 1740 | 16 (14 real) | **confirmed** (structure/lookup/most fields): per-level entity table (§4.7.4) — this row was stale, same correction as section 2 |
| 4 | `0x154e8`–`0x22db4` | 222 | 250 | monster catalog (§7.1) |
| 5 | `0x22db4`–`0x23f74` | 142 | 32 | open — rendered/refined, no per-field consumer located (§7.1, §8) |
| 6 | `0x23f74`–`0x27174` | 32 | 400 | **confirmed**: scripted event/opcode table, records are callable sub-scripts (§7.1) |
| 7 | `0x27174`–`0x290b4` | 40 | 200 | **confirmed**: weighted treasure/reward table, references item catalog (§7.1) |
| 8 | `0x290b4`–`0x2df34` | 314 | 64 | **confirmed closed**: generic resource cache, content is per-use not a fixed struct (§7.1, §2.6) |
| 9 | `0x2df34`–EOF | 12 | 64 | **confirmed**: `SOUNDnn.SND` length/index directory (§7.1) |

Section 0 was independently confirmed already (§7.1's round-decimal XP
tables, `14×64B`, discovered with zero knowledge of this section system)
— strong cross-validation this isn't curve-fitting.

**Confirmed via disassembly**: a shared `ReadSection(category, recordIndex)`
routine computes
`seekOffset = sectionBaseOffset[category] + recordIndex * master.hdr[category]`
against the cached `SCENARIO.DBS` file handle. `master.hdr`'s own 66-byte
file is cached verbatim in memory and indexed directly (no separate copy).

> **Correction (this session):** the routine's real prologue (`link.w
> a5,#0`) is at **`CODE+0x9fc`**, not `CODE+0xa24`. `CODE+0xa24`-`0xa8e` is
> a *leading* case-dispatch block belonging to the same function (category
> `2`..`8` remap recordIndex through one of `disk.hdr`'s 5 trailing lookup
> tables before falling through to the seek/read code at `CODE+0x9fc`+;
> category `0`,`1`,`9` skip the dispatch entirely). Public entry point:
> A4 jump-table **entry 17** (`jsr -0x7f98(a4)`) resolves to `CODE+0x9fc`.
>
> A **second, unrelated** function shares an adjacent entry number and was
> previously conflated with `ReadSection` in this doc's call-site census
> (§7.1's now-superseded "immediates 1, 9, 11, 18" row): A4 entry **16**
> (`jsr -0x7f9e(a4)`) resolves to `CODE+0x9ae`, a `.PIC`-style
> NUL-terminated-list compositor (dispatches to `CODE+0x20d4`/`0x2106`
> depending on whether its own `index` parameter is `<16`) — it has no
> connection to `scenario.dbs` sections despite a superficially similar
> 3-argument `(category, buffer, index)` shape. Re-running the literal-
> immediate census against **only** the confirmed entry-17 call sites (47
> total, raw-opcode scan of `4E AC 80 68` in the CODE hunk) finds literal
> categories **1, 4, 5, 6, 7, 8, 9** — covering sections 1, 4, 5, 6, 7, 8,
> 9 directly by name; **no literal 0, 2, or 3** appears at any entry-17
> call site. Section 0 (XP tables) turns out to be read with a
> **computed** recordIndex (the character's own class byte from a cached
> `pcfile.dbs` record, see `CODE+0x3eb44`-`0x3eb5e`) but a **literal**
> category `0` (`clr.w -(a7)` immediately before the call) — i.e. "no
> literal category" is not by itself proof a section's reads are rare or
> indirect; it can also mean the literal is `0` (indistinguishable from a
> generic zero-push at the byte-scan level without a dedicated per-record
> decode, which this pass did for the section-0 case specifically).

**Categories 10-19 — confirmed vestigial (this session).** Resolved by
re-deriving the raw addressing arithmetic directly (both `master.hdr[category]`
and the base-offset lookup are simple fixed-displacement reads off `A4`, no
separate runtime-populated table involved — see the correction below).

> **Correction to `headers-and-databases.md`'s framing:** that investigation
> read `-0x7482(A4)` as *"a runtime-populated 20-entry `u32` base-offset
> array... its initial 10 entries are populated from `disk.hdr`"* and left
> open how entries 10-19 might be populated. Re-derived directly from the
> `disk.hdr`/`DISK.HDR`-string `PEA` xref (`CODE+0x4b24`): the routine reads
> `DISK.HDR`'s 700 bytes straight into a buffer at **`-0x7486(A4)`**
> (`move.w #0x2bc,-(a7)` [700]; `pea -0x7486(a4)`; `pea "DISK.HDR"(pc)`; `jsr`
> the confirmed `ReadFileBytes` helper). `-0x7482(A4)` is **not** a separate
> array at all — it's simply `-0x7486(A4) + 4`, i.e. a fixed alias 4 bytes
> into that *same* cached `disk.hdr` buffer. Nothing ever copies `disk.hdr`'s
> 9 offsets anywhere else; `ReadSection`'s `baseOffset = *(u32*)(-0x7482(A4)
> + category*4)` is reading `disk.hdr`'s own bytes `[4+category*4 ..
> 8+category*4)` directly, live, every call.
>
> This makes the answer for categories 10-19 fall out of arithmetic alone,
> verified byte-exact: `disk.hdr`'s real header (4 zero words + 9 offsets)
> only occupies bytes 0-43, i.e. categories 0-9 (`4+9*4+4=44`). Category 10
> onward reads `disk.hdr` bytes 44+ — which is exactly the **already-confirmed
> content-trivial identity-ramp region** (§6.5's 5 tables, `table[i]==i`).
> Concretely (`disk.hdr[4+cat*4 .. 8+cat*4)` as BE u32): category 10 →
> `0x00010203`, category 11 → `0x04050607`, ..., category 19 →
> `0x14151617` — literal ramp bytes reinterpreted as a 4-byte "offset", not
> a real file position.
>
> Symmetrically, `master.hdr[category]` for `recordSize` is `master.hdr`'s
> flat 20-word array (`words[0..9]`=sizes, `words[10..19]`=counts) — for
> category ≥10 this doesn't add a real 11th-20th section, it just re-reads
> the **already-known count array** as if it were a size: `master.hdr[10]=14`
> (= section 0's own record *count*), `master.hdr[11]=500` (section 1's
> count), ... `master.hdr[19]=64` (section 9's count) — hence the "real
> non-zero size/count" the original open note observed; it's real data, just
> not independent data.
>
> **No code path ever exercises this**: the exhaustive raw-opcode census of
> all 47 confirmed `ReadSection` (A4 entry 17) call sites found literal
> categories only in `{0,1,4,5,6,7,8,9}` — zero call sites push a literal
> ≥10. Categories 10-19 are real, addressable, but **never-issued** array
> capacity; if any code ever did call with category ≥10, it would silently
> read `master.hdr`'s own count sub-array as a bogus record size and
> `disk.hdr`'s own identity-ramp bytes as a bogus base offset, rather than
> crashing or hitting a bounds check — but nothing in the shipped binary
> does so. **Vestigial/unused, confirmed.**

Full trace: `docs/wizardry6/amiga/investigations/headers-and-databases.md`.

### 6.5 `disk.hdr` (700 bytes) — confirmed

> **Correction**: the main doc originally read the header as 24 bytes
> ("3 zero words, then 9 offsets") and mis-converted two of the hex
> offsets to decimal. The real header is **44 bytes** (4 zero words, not
> 3, then the 9 BE u32 values occupy bytes 8-43). The correct decimal
> values are `896, 37896, 59432, 87272, 142772, 147316, 160116, 168116,
> 188212` (the previous `142804`/`146292` were transcription errors —
> the hex literals `0x22db4`/`0x23f74` themselves were always right).

These 9 values are `scenario.dbs`'s section 1-9 base offsets (section 0's
base offset, 0, is implicit) — confirmed via the byte-exact
section-size/`master.hdr`-divisor match, §6.4.

**Trailing 656 bytes — confirmed role**: not filler. They're read by code
as **5 separate byte-indexed lookup tables** (sizes 16/64/256/256/64,
`16+64+256+256+64 = 656`, exactly partitioning the region), consumed by a
"remap record index by category" dispatch (`CODE+0xa30`-`0xaa8`,
`CMP.L #7,d0; BCC default; JMP (pc,d0.w)`). Content: each of the 5 tables
independently resets to `0` at its own start and holds `table[i] == i`
for its full size — i.e. each is its own **identity lookup**, not one
continuous ramp. This upgrades the earlier guess ("generic
identity-translation table") from speculation to disassembly- and
byte-exact-confirmed: it's a real, exercised code path with no actual
remapping data behind it in this shipped build (plausibly a general
remapping feature the final game never needed).

Full trace: `docs/wizardry6/amiga/investigations/headers-and-databases.md`.

---

## 7. `.dbs` data files

### 7.1 `scenario.dbs` (188980 bytes)

**Confirmed**: this file is organised into **10 fixed-stride sections**,
directly indexed by `disk.hdr`'s 9 base offsets (§6.5) and `master.hdr`'s
10 record-size/record-count pairs (§6.4) — see the section table in §6.4.
Three sections are now decoded:

**Section 0 (offset `0x000`–`0x37F`, 14×64-byte records) — class XP
tables, confirmed (high-confidence structural evidence).** The file opens
with 14 back-to-back tables of 16 big-endian u32 values each:

```
table 0:  1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000,
          512000, 768000, 1024000, 1280000, 1536000, 1792000, 2048000
table 1:  1250, 2500, 5000, 10000, 20000, 40000, 80000, 160000, 320000,
          640000, 1015000, 1390000, 1765000, 2140000, 2515000, 2890000
table 2:  (identical to table 1)
table 3:  900, 1800, 3600, 7200, 14400, 28800, 57600, 115200, 230400,
          460800, 685800, 910800, 1135800, 1360800, 1585800, 1810800
... (tables 4-13 similarly shaped, each a monotonic round-decimal sequence)
table 14: 1112690507, ... (not a round number — confirms the table ends at 14)
```

Every value in tables 0–13 is a round decimal number in a strictly
increasing sequence — the canonical shape of a per-level XP-to-advance
table. 14 tables matches Wizardry 6's real 14-class roster (also
independently confirmed by `WFONT1.EGA`'s legible class-abbreviation
text, §5.2). **Not yet mapped**: which of the 14 tables belongs to which
specific class.

Verified extractor: `tools/wizardry6/decode-scenario-xp.ts` (writes
`public/assets/wizardry6/amiga/data/xp-tables.json`).

**Section 1 (offset `0x380`–`0x9408`, 500×74-byte records) — item
catalog, largely decoded this session.** Found via the same technique as
the monster table below (stride confirmed by consistent name-field
spacing). Cross-verified byte-exact against `disk.hdr`'s offsets
`896`/`37896`.

> **Update (this session, `amiga-disasm` trace of all 23 confirmed
> category-1 `ReadSection` call sites, cross-checked independently against
> the raw bytes of all 452 named records in the orchestrating session):**
> most of the record is now decoded. **The doc's original `+58`/`+59-60`
> offsets were off by exactly 2 bytes** from the real disassembly-confirmed
> fields (they describe `+56`/`+57-58`) — a byte-inspection artifact from
> the original pass, not a disassembly error; superseded below.
>
> `ReadSection`'s real signature is 4 arguments, not 2:
> `ReadSection(extraFlag@0x10(a5), recordIndex@0xe(a5), bufferPtr@0xc(a5),
> category@8(a5))` — refines, doesn't contradict, §6.4's description.

| Offset | Size | Field | Confidence | Evidence |
|---|---|---|---|---|
| `+0` | ~20 | item name, NUL-padded | confirmed (legible) | `strcpy` at `CODE+0x1cc9c-0x1cca4` |
| `+16` | 4 | BE u32 price (gold) | **confirmed** | seeded into the shop BCD money-accumulator primitives (`CODE+0x46648-0x4665c`, `0x46b38`) |
| `+18` | 2 | **not a separate field — low 16 bits of `+16`'s price** | **confirmed** | independently verified this session: `word@+18 == price & 0xFFFF` in **0/452 mismatches** across every named record. `CODE+0x366a2` reads it on a sentinel-item code path as a plain display value, not a distinct attribute |
| `+20` | 2 | **damage bonus** (BE u16) | **confirmed** | `add.w field20,d0` after `field22*field23`, 3 sites (`CODE+0x2e32a`, `0x45f3e`, `0x465b6`) |
| `+22` | 1 | **dice count** | **confirmed** | `mulu.w` with `+23`, same 3 sites |
| `+23` | 1 | **dice sides** | **confirmed** | same 3 sites; `+20-23` (bonus/count/sides) is copied whole via a single `move.l` in 4 separate equip-application functions — the item-catalog analogue of the monster stat block's `RollDice`-fed dice specs (§7.1 monster table) |
| `+28` | 2 (word — **not 4 bytes**) | item special-power ID (packed byte pair) | **confirmed structure**, hypothesis semantics | `tst.w field28` gates a block at `CODE+0x1d052`; `divs.w #0x100` splits hi/lo; lo byte×6 indexes a 6-byte table at `-0x7bce(a4)` selecting which of two per-character result fields gets the hi byte. **Refutes the original "4-byte weight" guess** — no 4-byte read at this offset exists in any of the 23 traced consumers |
| `+30` | 2 | secondary combat stat | hypothesis | copied into a runtime equip-cache in 3 functions; feeds `total += max(diceByte,1)*field30` (`CODE+0x2e3fc`) whose own consumer wasn't identified |
| `+31`–`+32` | 2 | undecoded | open | genuinely no consumer located anywhere, incl. the new function found this session (see the "Final update" block below) |
| `+33`–`+45` | 13 | per-class equip-bonus array | hypothesis, consumer found this session | 14-iteration loop (`CODE+0x3c184`-`0x3c1b2`) feeds a per-class accumulator helper at `CODE+0x3ac1c` — see the "Final update" block below |
| `+46`–`+53` | 8 | per-slot resistance/quality-shaped array | hypothesis, consumer found this session | 8-iteration copy loop (`CODE+0x3bfa2`-`0x3bfd6`) into a per-char/per-slot cache — see the "Final update" block below |
| `+54`–`+55` | 2 | **class-restriction bitmask**, 14 bits, `+54`=bits 0-7, `+55`=bits 8-13 | **confirmed** (mechanism + live enforcement) | `TestBit`-loop bound `cmpi.w #0xe` (14) at `CODE+0x399d8`/`0x3ab86`. **Enforcement located**: `CODE+0x366b4-0x366d2` reads the wearer's class-ID byte and calls `TestBit(&item.field54, classID)`; on failure (`≠1`) branches to `CODE+0x3675c`, which aborts the equip with message `0x2da`. **Byte-order note (independently pinned down this session, verifying the extractor):** `TestBit(base,i)` is `base[i>>3] & (1<<(i&7))` — a raw byte-array read, so bit 0 lives in `+54`'s bit 0 and bit 8 lives in `+55`'s bit 0, which is the *opposite* of reading `+54-55` as a big-endian `u16` despite the 68k CPU being big-endian; confirmed by cross-checking against the reported semantics, which only match under this byte order (`base[54]\|(base[55]<<8)`), not a naive BE `u16` read. Semantic cross-check, 500 records: `MITRE`/`MITRE DE SANCT` (priest hats) allow only `PRI,BIS`; `DAGGER` excludes exactly `PRI,BIS,MON`; blunt weapons (`MACE`) allow `PRI` where edged weapons don't — the classic "priests use blunt weapons only" Wizardry rule, in the same 14-class order `WFONT1.EGA` already established (§5.2) |
| `+56` (+ low 3 bits of `+57`) | 1+ | **race-restriction bitmask**, 11 bits | **confirmed** (structure + strong thematic match) | `TestBit`-loop bound `cmpi.w #0xb` (11) at `CODE+0x39916`. Semantic: `ELVEN BOW` is the only record with *only* bit 1 set (`0x02`); `FAERIE CAP`/`PIXIE STICK`/`FAERIE STICK`/`NIGHT STICK`/`ROD=SPRITES` are the only records with *only* bit 5 set (`0x20`); `GIANT SLEDGE` sets exactly bits 0,2,6,7 (`0xC5` — big/strong races only). Independently re-derived this session from the raw bytes alone (452/452 named records: only 6 distinct patterns exist — `0x00` [broken-item placeholder], `0x02` [Elf-only], `0x20` [Faerie-only, 5/5 tiny-item names], `0xC5` [`GIANT SLEDGE`], `0xDF` [`0xFF` minus bit 5, 127 records — "everyone except Faerie", almost all heavy weapons/armor], `0xFF` [unrestricted, 317 records]) before the disassembly trace returned and independently converged on the same bit-5-Faerie/bit-1-Elf reading. `+57`'s low 3 bits (bits 8-10) are `0x07` (all set) in 445/452 records, `0x00` in the single-race-restricted 7 |
| `+58` | 1 | **gender/2-state restriction**, 2 bits | **confirmed structure**, hypothesis label | `TestBit`-loop bound `cmpi.w #0x2` at `CODE+0x39972`. `0x03` (unrestricted) in 445/452; `FUR HALTER`/`CHAMOIS SKIRT`/`JAZERAINT SKIRT` = `0x02` (thematically female garments), `CAMEO LOCKET` = `0x01` |
| `+59` | 1 | special-property flags | **confirmed structure**, partial semantics | individually `btst`'d and remapped into a runtime equip-cache flags byte in 3 near-identical functions (`CODE+0x2e364-0x2e3be`, `0x41d3e-0x41d92`, `0x4ecb2-0x4ecfa`); bit 2 (`0x04`, 29 records) matches exactly the classic Wizardry two-handed weapons (`CLAYMORE, SPEAR, AWL PIKE, QUARTERSTAFF, BO, HALBERD`) — **bit 2 = two-handed flag, confirmed by name semantics**; bits 1,3,4,5 open |
| `+60` | 1 | **item category / equip-slot enum, 0-16** | **confirmed** | Direct semantic decode across all 452 named records: `0`=melee, `1`=polearm, `2`=light/thrown, `3`=bow, `4`=ammo, `5`=cloak, `6`=headgear, `7`=body-upper, `8`=body-lower, `9`=gauntlets, `10`=boots, `11`=shield, `12`=heal potion, `13`=spell scroll, `14`=misc/instrument, `15`=key, `16`=powder/dust. Also `cmpi.b`'d directly against literals 2/3/4 (`CODE+0x277e0/0x277e8`, `0x39c52`) and used as an index into a 256-entry classification table at `-0x7be4(a4)` |
| `+61` | 1 | companion byte to `+60`, plausibly a per-category icon/sub-type index | hypothesis, consumer chain traced this session | 2 new equip-cache write sites found (`CODE+0x2e34c`, `CODE+0x37356`, `move.b record+61,(a0)+5` — extends the documented equip-cache layout with a new `+5` field); consumer chain: cached per-item-index at `-0x2110(a4)` (`CODE+0x500b4`), read back `+1`'d at `CODE+0x45d48`/`0x4ee0c`, passed through trampoline `-0x7f2c(a4)` (`CODE+0x1ff6`) into a per-character slot table shaped like an icon/animation-queue insert. Value sets cluster loosely per `+60` category (melee 0-7/14-19/51-59; headgear 25,39-40,64-72,85,91-97; body-upper 26,41-42,60-69) with some cross-category overlap (33/35/49/119 shared by misc/key/instrument) — consistent with, not proof of, a per-category icon index; no icon sheet available to visually confirm |
| `+62`–`+63` | 2 | constant `0x0000` | confirmed (structural) | zero in all 452 named records — reserved/padding |
| `+64` | 1 | per-slot cache byte, raw copy | hypothesis, consumer found this session | `CODE+0x3bf94` (see block below) |
| `+65` | 1 | per-slot cache byte, raw copy | hypothesis, consumer found this session | `CODE+0x3c07a` (see block below) |
| `+66` | 1 | per-character "running max" tracker input | hypothesis, consumer found this session | `CODE+0x3c1c0` (see block below) |
| `+67` | 1 | per-character "running max" tracker input (2nd) | hypothesis, consumer found this session | `CODE+0x3c202` (see block below) |
| `+68` | 1 | per-slot local-array byte | hypothesis, consumer found this session | `CODE+0x3bf46` (see block below) |
| `+69` | 1 | small enum, dispatch-target semantics undetermined | hypothesis, corroborated this session | 2 new citations beyond the existing ones: `CODE+0x2780e` (`cmpi.b #7,record+69`); `CODE+0x36614`/`0x3661e` (`tst.b`/`move.b record+69,d0`) used as an index into a branch-dispatch chain `CODE+0x36622`-`0x3688e` — mechanism confirmed, what each dispatch target does not decoded |
| `+70` | 1 | per-character byte-pool subtraction (weight/encumbrance-shaped) | hypothesis, consumer found this session | `CODE+0x3bf78`/`0x3c17e` (see block below) |
| `+71` | 1 | per-slot cache byte, category-gated (ammo-specific?) | hypothesis, consumer found this session | `CODE+0x3c088`/`0x3c0ca` (see block below) |
| `+72` | 1 | per-slot cache byte, raw copy | hypothesis, consumer found this session | `CODE+0x3c10c` (see block below) |
| `+73` | 1 | undecoded | open | not found in the new consumer function either — genuinely no reader located |

> **Correction (this session):** re-checked the doc's own field-size column
> against the TODO list's `+18-19`/`+29` gaps and found both were **already
> covered by existing confirmed fields, not real gaps** — a bookkeeping
> slip in a previous session's TODO description, not a new finding.
> `+18-19` is the low 16 bits of `+16`'s BE u32 price (0/452 mismatches,
> see the corrected `+18` row above). `+29` is the low byte of `+28`,
> which the table already documents as a **2-byte** field (`+28`-`+29`
> together, the special-power-ID packed pair) — there was never an
> independent byte at `+29` to decode. The item catalog's genuinely open
> span narrows to `+31`-`+53` (23 bytes), `+64`-`+68` (5 bytes), and
> `+70`-`+73` (4 bytes) — 32 bytes total across 3 gaps, all exhaustively
> swept this session with zero consumers found in any of them, across
> every one of the 23 confirmed category-1 `ReadSection` call sites plus
> the known equip-cache consumer functions.

> **Final update (this session): a new consumer function found outside
> the known 23 call sites resolves 29 of the 32 remaining gap bytes.**
> The prior two sessions' sweeps searched only the ~5.5KB of the
> 351,292-byte CODE hunk that `docs/wizardry6/amiga/disasm/Bane.cnf`
> actually marks as `CODE` (a cluster near `0x55032`-`0x5658a`) — the
> remaining ~345KB, including the function below, is emitted as
> undifferentiated `DC.L` hex in `Bane.asm`, invisible to a text/regex
> sweep over that file. This is the documented "large hand-optimized
> binary, `-preproc` classifies almost none of it as code" IRA failure
> mode (`game-re-tooling/amiga.md`) — confirmed by grepping `Bane.asm` for
> offset markers across `0x1000`-`0x4FFFF` (zero hits) and for addresses
> the doc itself already relies on, e.g. `0x39916`/`0x37356` (also zero
> hits). Raw `r2`/capstone linear disassembly of the extracted CODE hunk,
> bypassing the `.cnf` classification entirely, is what surfaced this
> function. **This is a standing gap in the project's IRA config, not
> specific to the item catalog — a future session should add an explicit
> `CODE $0 - $55032` range to `Bane.cnf` and regenerate, per the tooling
> doc's own documented fix for this exact failure mode.**
>
> **New function: `CODE+0x3bf3c`-`0x3c220` (part of a larger ~3.3KB body,
> `CODE+0x3b966`-`0x3c640`), signature
> `(arg@0x8(a5), arg@0xc(a5), charIndex@0x10(a5))`.** For each of a
> character's 8 equip slots it reads the equipped item's catalog index
> from the confirmed equip-cache (`-0x45c2(a4)`) and calls
> `ReadSection(category=1, buffer=-0x128(a5))` at `CODE+0x3bf3c` — **this
> exact call site is one of the already-known 23 category-1 sites**; the
> gap was that nobody had traced past its immediate return into the rest
> of the function. Independently re-verified byte-exact (raw hex, not
> just mnemonics) at every cited address:
>
> - **`+64`** (`CODE+0x3bf94`, `move.b -$e8(a5),(a0,d0.l)`, confirmed
>   `-0x128(a5)+64 = -0xe8(a5)` exactly): raw copy into a new per-char/
>   per-slot cache `-0x4505(a4)[charIdx*0x1b0 + slot*16]`.
> - **`+65`** (`CODE+0x3c07a`): same shape into `-0x4506(a4)[...]`.
> - **`+66`** (`CODE+0x3c1c0`, `move.b -$e6(a5),d1; cmp.b (a0,d0.l),d1;
>   bls...`, confirmed `-0x128+66=-0xe6`): a **running-max** compare —
>   keeps the larger of the current value and a per-character byte
>   `-0x4460(a4)[charIdx]` — "best equipped item" tracker shape.
> - **`+67`** (`CODE+0x3c202`, `move.b -$e5(a5),d1`, confirmed
>   `-0x128+67=-0xe5`): identical running-max pattern into
>   `-0x445f(a4)[charIdx]`.
> - **`+68`** (`CODE+0x3bf46`, `move.b -$e4(a5),d0`, confirmed
>   `-0x128+68=-0xe4`): copied into a local per-slot array `-0x30(a5)`,
>   consumed later in the same function.
> - **`+70`** (`CODE+0x3bf78` for slots 0/1, `CODE+0x3c17e` for slots
>   2-7, both `move.b -$e2(a5),d0; sub.b d0,(a0)`, confirmed
>   `-0x128+70=-0xe2`): subtracted from two new per-character byte pools
>   `-0x44a1(a4)[charIdx]`/`-0x44a2(a4)[charIdx]` — a weight/encumbrance-
>   shaped deduction.
> - **`+71`** (`CODE+0x3c088`/`0x3c0ca`, category==4/ammo-branch vs.
>   else, both eventually `muls.w #5,d0; sub.b d0,(a0)`): the category
>   gating is itself new, positive evidence this byte is
>   **ammo-specific** — negated/subtracted ×5 into a new per-slot cache
>   `-0x4504(a4)[...]`.
> - **`+72`** (`CODE+0x3c10c`, `move.b -$e0(a5),(a0,d0.l)`, confirmed
>   `-0x128+72=-0xe0`): raw copy into a new per-slot cache
>   `-0x4503(a4)[...]`.
> - **`+73`**: **not found** in this function either — genuinely no
>   reader located anywhere.
> - **`+33`-`+45`** (13 bytes, part of the original `+31`-`+53` gap): a
>   14-iteration loop (`CODE+0x3c184`-`0x3c1b2`, `move.w #1,-0x4(a5)`
>   init, `cmpi.w #0xe,-0x4(a5); blt` bound — confirmed 13 real
>   iterations, indices 1-13) reads `record[32+classIdx]` (base
>   `lea.l -0x108(a5),a0`, confirmed `-0x128+32=-0x108` exactly) and
>   passes each byte to a helper at `CODE+0x3ac1c(pc)`, which accumulates
>   it into a new per-character/per-class table
>   `-0x44b0(a4)[charIdx*0x1b0 + classIdx]` (indices 1-13 — matching the
>   confirmed 14-class roster, with index 0 never touched). Strong
>   structural evidence for a **per-class accumulating equip-bonus
>   array**.
> - **`+46`-`+53`** (8 bytes, part of the original `+31`-`+53` gap): an
>   8-iteration copy loop (`CODE+0x3bfa2`-`0x3bfd6`, base
>   `lea.l -0xfa(a5),a0`, confirmed `-0x128+46=-0xfa`, loop bound
>   `cmpi.w #8`) copies each byte raw into a new per-char/per-slot cache
>   `-0x450e(a4)[charIdx*0x1b0 + slot*16 + i]` — 8 contiguous bytes into
>   an 8-slot-shaped cache, suggestively similar in shape to the monster
>   catalog's own 8-slot damage-resistance array (§7.1 monster table).
> - **`+31`, `+32`**: not individually dereferenced anywhere in this
>   function (`+32` only ever serves as the class-array's own base
>   address — the loop starts at index 1, index 0 is never read).
> - **Bonus, outside the 3 assigned gaps**: `+24`-`+27` (4 bytes,
>   immediately after the confirmed `+20`-`+23` dice spec, previously
>   absent from both the "confirmed" and "genuinely open" lists) is also
>   copied whole (`move.l (a1)+,(a0)+` at `CODE+0x3c0f4`, source
>   `lea.l -0x110(a5),a1`, confirmed `-0x128+24=-0x110`) into a new cache
>   slot `-0x4512(a4)[charIdx*0x1b0 + slot*16]` — flagged here as a
>   previously-unlisted field for the record.
>
> **Net effect: the item catalog's genuinely open span narrows from 32
> bytes to exactly 3 — `+31`, `+32`, `+73`.** Every other byte in the
> original 3 gaps now has at least a structurally-confirmed consumer
> (hypothesis-level semantics, matching this doc's convention for
> access-confirmed-but-not-semantically-decoded fields). Given the
> IRA-coverage meta-finding above, the 3 remaining bytes are plausibly
> read somewhere in the ~345KB `Bane.cnf` still doesn't classify as code
> — the concrete next step is the `.cnf` fix, not another targeted sweep
> of the current disassembly.

> **Re-checked this session against the now-99.47%-covered `Bane.asm`
> (the `.cnf` fix flagged as "the concrete next step" above has since
> landed) — conclusion unchanged, now confirmed via a second, independent
> disassembly method.** The original negative for `+31`/`+32`/`+73` came
> from a raw capstone pass that already bypassed `Bane.cnf` entirely, so
> it wasn't actually coverage-limited — but it had never been
> cross-checked against IRA's own output. Computed the item record's
> local-buffer displacements for the 3 open bytes (base `-0x128(a5)`,
> confirmed above) and grepped the full `Bane.asm` for the resulting
> exact operand text: `-265(A5)` (`+31`) and `-223(A5)` (`+73`) — **zero
> hits, either one, anywhere in the 113,178-line file.** `-264(A5)`
> (`+32`) has exactly **one** hit, `CODE+0x3c18e` (`LEA -264(A5),A0`) —
> and that's the already-known per-class equip-bonus array's own base
> pointer (the loop starts at index 1, so `+32` itself is never
> dereferenced, matching the existing finding exactly, not a new read).
> Two independent disassemblers, two different methods, same answer:
> `+31`/`+73` have no reader anywhere in `Bane`, and `+32` is only ever
> used as an array base, never read directly.

> **Final sanity check (2026-08-03): confirmed there is no "outside the
> CODE hunk" location either — closing this as a confirmed absence, not
> open uncertainty.** The two prior negatives (raw capstone pass, then
> IRA text search on computed displacements) both only ever swept the
> CODE hunk. Checked whether anything could plausibly read these 3 bytes
> from elsewhere:
> - **No overlay/second executable exists in this corpus.** Unlike the
>   DOS/EGA port (`wroot.exe` + 11 `.ovr` files), the Amiga release ships
>   exactly one executable (`data/wizardry6/amiga/Bane`) and no other
>   file with an executable-shaped magic — confirmed by extension census
>   over the full 117-file corpus (`Bane` x1, `.pic`/`.PIC` x60, `.ega`/
>   `.EGA` x12, `.hdr` x5, `.dbs` x4, `.snd` x35, nothing else). There is
>   no second code module this data could be read by.
> - **`Bane`'s own hunk stream is fully accounted for** (§1: `HUNK_HEADER
>   -> CODE(+reloc) -> DATA(+reloc, 141 relocs) -> BSS -> HUNK_END` walks
>   the file's exact 354,372 bytes with no trailing/appended data) — there
>   is no hidden fourth region to hold a reader.
> - **The DATA hunk itself contains no independent logic.** Spot-checked
>   its payload directly (`xxd` at file offset `0x55c98`, the confirmed
>   DATA hunk payload start, §1.4): the first bytes are a dense run of
>   `4E F9 00 00 0xxx` — `JMP.L abs32` trampolines, i.e. the already-
>   documented A4 jump table itself, not custom code. The DATA hunk holds
>   trampolines-into-CODE and initialized globals, never a piece of logic
>   that could read an item-catalog record field on its own.
>
> With no second executable, no overlay region, and no independent logic
> in the DATA hunk, "read by something outside the CODE hunk" has no
> remaining candidate location to check. **Conclusion: `+31`, `+32`
> (except as the equip-bonus array's own base pointer), and `+73` are
> confirmed genuinely unused/reserved bytes in the shipped build** — not
> an artifact of disassembly coverage, not a missed addressing form, and
> not a reader living somewhere this project's tooling can't see. This
> closes `item-catalog-remaining-fields`.

**Runtime equip-cache** (analog of the monster catalog's `-0x3bbe(a4)`
pointer table): `-0x45c2(a4)`, indexed `[charIndex*0x1b0][slotIndex*8]`
(432-byte character stride, 8-byte slot stride — 8 equip slots per
character, confirmed by an explicit `cmpi.w #0x8` loop bound at 2 sites,
consistent with the classic weapon/shield/armor/helm/gauntlets/boots/
cloak/misc 8-slot layout): `+0`=item catalog index, `+4`=cached `+60`,
`+6`=cached `max(diceCount*diceSides+bonus, 1)`, `+7`=remapped `+59`
flags plus a separately-set cursed/locked bit (blocks un-equip with
message `0x5f8`, `CODE+0x466c4`).

164 clean weapon names read directly (`DAGGER, MAIN GAUCHE, SHORT SWORD,
KATANA, LANCE, ...`) with round, sensibly-scaling prices (`DAGGER=15gp,
KATANA=400gp, LANCE=450gp`); armor/shield/accessory names (`CLOTH SHIRT`
onward, `BRONZE CUIRASS, STUDDED HAUBERK, FULL PLATE, SILVER CROSS,
DIAMOND RING, ...`) continue at the same stride — a single unified item
catalog covering weapons, armor, jewelry, wands, potions, spellbooks/
scrolls, and quest keys/items. Not yet exported to a standalone asset
file — extraction logic is a direct analogue of the monster-table
extractor below and is committed follow-up work, not a blocker.

**Section 4 (offset `0x154e8`–`0x22db4`, 250×222-byte records) — monster
catalog, confirmed structure/names.** Cross-verified byte-exact against
`disk.hdr`'s offsets `87272`/`142772`. Record layout (first 64 bytes
confirmed):

| Offset | Size | Field | Confidence |
|---|---|---|---|
| `+0` | 16 | singular display name, NUL-padded | confirmed (legible) |
| `+16` | 16 | plural display name, NUL-padded | confirmed (legible) |
| `+32` | 16 | singular "category" name, NUL-padded | confirmed (legible), semantics hypothesis |
| `+48` | 16 | plural "category" name, NUL-padded | confirmed (legible), semantics hypothesis |
| `+64` (`+0x40`) | 4 | BE u32, XP award | **confirmed** — `move.l 0x40(a1),d0` at `CODE+0x22e9a`, added to the global XP accumulator `-0x3bc4(a4)` at `CODE+0x22e9e` inside the "remove combat participant" cleanup function |
| `+68`–`+0x93` | ~44 | per-attack sub-structure(s), message-verb/style selector at `+0x80`(+attack idx) | hypothesis — see stat-block table below |
| `+0x8a`–`+0x93` (approx) | ~11 | weighted spell/special-ability ID list (5%/5%/5%/10%×4/15%×∞ tier-selection loop) | hypothesis, contradicts the resistance-table range below — not reconciled |
| `+0x94` | 1 | reserved slot-zero of the resistance array — the `PEA 148(A0)` base pointer, but index 0 is never a real element (all-zero in 183/183 named records) | **confirmed** |
| `+0x95`–`+0xA1` (149-161) | 13 | **per-damage-type resistance %**, in order **Fire, Lightning, Cold, Paralysis, Air, Poison, Earth, Acid, Hypnotism, Psionics, Life, Magic, Death**; `125` = immune. Formula `scaled = max(0, value*(resist-penetration)/100)` at 3 call sites | **confirmed** — see the Zimlab oracle table in the note below. **Correction:** the array starts at `+0x95`, not `+0x94`; the doc's earlier `+0x94+idx` was off by one (`ISLAND GIANT` and `HYDRA PLANT` both match the published table exactly at `+0x95` and both fail at `+0x94`) |
| `+0x86`–`+0x89` (134-137) | 4 | **the four monster attributes** (range 2-25 across the corpus; Cosmic Forge's changelog records the original editor cap as 25). Consumed as an *attribute-sum differential* — `(defender[135]+[136]+[137]) − (attacker[135]+[136]+[137])`, then `DIVS #2`, at `CODE+0x1f7a8`-`0x1f826` — a to-hit/initiative modifier | **confirmed** structure; supersedes the refuted "HP current/max pair" reading |
| `+0xaa` (170) | 1 | percent-chance gate for the **special attack** (vs `+0xa8`'s spell/cast gate) | **confirmed** — matches the published `%SA` column in 3/3 spot checks (`BANSHEE` 80, `PIT FIEND` 25, `HYDRA PLANT` 20); read at `CODE+0x1726e`/`0x1729a`/`0x1e608` |
| `+0x74`–`+0x77` (116-119) | 4 (BE u16 bonus, u8 count, u8 sides) | **number appearing** (group size) — *not* attacks-per-round; see the "HP found" note below | **confirmed** |
| `+0x78`–`+0x7b` (120-123) | 4 (BE u16 bonus, u8 count, u8 sides) | **HIT POINTS** — rolled once at spawn into the combat participant's current *and* max HP | **confirmed** |
| `+0x7c`–`+0x7f` (124-127) | 4 (BE u16 bonus, u8 count, u8 sides) | **STAMINA** (second current/max pool, parallel to HP) | **confirmed** structure, high-confidence semantics |
| `+0xa4`/`+0xa5` | 1+1 | companion/escort monster ID + spawn-chance (0-100), gates a recursive load into `slot+1` | **confirmed** |
| `+0xa8` | 1 | percent-chance gate (vs `Random(100)`) for the AI's "special action" (spell/breath) block | **confirmed** |
| `+0xda` | 1 | "death message" type/ID, gated by `+0xdc` bit 0 | confirmed (read site), hypothesis (role) |
| `+209` | 1 | `.PIC` file index (0-58) — which `mon##.pic` file this monster renders with | **confirmed** — see §2.6 |
| `+210` | 1 | secondary/alternate selector, consumed only for one combat-slot condition | hypothesis — see §2.6 |
| `+0xbe`–`+0xc5` (190-197) | 8 (signed bytes) | **the full AC block**: `+0xbe` = overall AC, then `+0xbf`..`+0xc5` = per-body-part AC in the order **Shield, Spell, Head, Body, Legs, Hands, Feet** | **confirmed** — 10/10 exact matches against the published bestiary (see the Zimlab oracle table below). This resolves `+0xc1`-`+0xc5`, previously "copied but role not traced". Note the in-place accumulation `+0xbe = +0xbe+0xbf+0xc0` at `CODE+0x290b2`-`0x290d4` happens **only on the converted-PC path**; for ordinary catalog monsters `+0xbe` is the stored overall AC, read directly |
| `+0xbe` (190) | 1 (signed) | **AC (armor class)** — overall; see the 8-byte block row above | **confirmed** — read at `CODE+0x1fce2`/`0x1fe88`, added into a to-hit-style roll computation. Independently re-verified this session: raw disassembly at both cited sites matches exactly. Statistical cross-check across 183 named records, independently reproduced: signed range **-14..+12**, Pearson r = **-0.566** vs `log(XP)` (tougher monsters trend lower/more-negative AC, the correct direction; `WILL O' WISP`, XP 170518, is the best at -14, `CREEPING VINE`, XP 59, is the worst at +12) |
| `+0xd4` (212) | 1 | **monster level (coarse 4-tier class, not a literal level number)** | **confirmed** structure, medium-confidence semantics — written at `CODE+0x29114` from `pcfile.dbs` character offset `+425` (a source independently confirmed elsewhere in the binary, `CODE+0x3ae08`-`0x3ae3e`, to be a classic "level from XP" formula). Only 4 distinct raw values (1-4) occur; independently re-verified median XP per tier is monotonic: tier1=5154, tier2=10477, tier3=59947, tier4=91860 (a handful of unique late bosses sit at tier1, plausibly deliberate design rather than a decode error) |
| `+0xd6` (214) | 1 | **gender / pronoun class** — `0`=male (52), `1`=female (23), `2`=neuter/beast (108) | **confirmed** (semantics via exhaustive name census; no reader exists in `Bane`) — supersedes both the "alignment" and the "creature-type tier" readings, see the "HP found / alignment refuted" note below |
| `+68`–`+69`, `+84`–`+85`, `+100`–`+101` | 2 each | three further BE u16 fields, each the first field of a **16-byte sub-record** at `+68`/`+84`/`+100` (stride 16) | **confirmed** as u16 (cross-port endian test, 0 counterexamples); semantics open |
| `+68`–`+221` (excl. above) | | HP **found** (`+0x78`); alignment **refuted as nonexistent** | see the "HP found / alignment refuted" note below |

> **Session note (`re-codebreaker`, 2026-08-03): HP FOUND at `+0x78`;
> alignment REFUTED as a field that exists at all; `+0x74` and `+0xd6`
> both re-identified.** Every one of the 10 prior negatives stands as
> written — they were all correct, and all searching for the wrong
> *shape*. HP is not a mutable field of the 222-byte catalog record (so
> the `SUB`/`ADD` mutation censuses could never have found it) and is
> not rolled by a 4th `RollDice` call (so the caller census could never
> have found it). **HP is one of the three already-"confirmed" dice
> specs — the one the doc mislabelled "damage-roll dice spec #1".**
>
> **The premise that broke the search: `-0x3ba2(a4)[slot]` is not "a
> 44-byte per-attack record array".** It is the **combat-participant
> array**: one 414-byte struct per combat *group*, containing up to
> **9** individual creatures at a 44-byte (`0x2c`) stride, followed by
> group-level fields at `+396`-`+414`. `396/44 = 9` exactly. The `D4`
> loop in `LoadMonsterIntoSlot` (`CODE+0x16140`-`0x16278`) iterates
> *individuals in the group*, not attacks — its bound is
> `member[+413] = RollDice(record+0x74)`.
>
> **`+0x74` (116-119) = NUMBER APPEARING, not attacks-per-round.**
> Three independent proofs: (a) the loop above fills one 44-byte
> individual per rolled unit; (b) the rolled range across all 183 named
> records is exactly **1..9** with **0/183 violations** of the 9-slot
> structural capacity — a zero-deviation invariant; (c) the
> **second, previously-undocumented `ReadSection(category=4)` call
> site** at `CODE+0x24a86` (a monster-summoning/reinforcement path,
> found this session — the docs only ever cited `CODE+0x16012`)
> *overwrites* `record+116` (BE u16 bonus, `MOVE.W D0,116(A1)` at
> `CODE+0x24ad0`) and `record+118` (dice count, `CODE+0x24ab4`) with a
> runtime-computed count *before* calling `RollDice(record+0x74)` —
> i.e. the game forces "N creatures arrive" through this exact field.
>
> **`+0x78` (120-123) = HIT POINTS — confirmed.** In
> `LoadMonsterIntoSlot`:
> `member[+4] = RollDice(record+0x78)` (`CODE+0x161ac`), then
> `member[+2] = member[+4]` (`CODE+0x161e0`). The pair is then:
> - **decremented on damage** — `SUB.W D0,2(A1)` at `CODE+0x20976`
>   and `CODE+0x2355e`;
> - **death-checked** — `TST.W 2(A1); BGT.S` at `CODE+0x2357c`, whose
>   fall-through is the death/removal path (`CODE+0x23582`-`0x235be`);
> - **healed and clamped to max** — `ADD.W D0,2(A1)` at `CODE+0x26c4c`
>   followed immediately by `MOVE.W 2(A1),D0; CMP.W 4(A6),D0; BLE.S;
>   MOVE.W 4(A1),2(A6)` (`CODE+0x26c84`-`0x26cc2`): *if current > max,
>   set current = max*. This clamp is the textbook current/max
>   signature and is decisive. Second instance at `CODE+0x26de4`;
> - **drained on both halves** by one effect — `SUB.W D0,4(A1)` then
>   `SUB.W D0,2(A1)` (`CODE+0x1f038`/`0x1f05a`) with max floored at 1
>   (`CMPI.W #1,4(A1); BGE; MOVE.W #1,4(A1)`) — a max-HP-drain attack.
>
> So **`member[+2] = current HP`, `member[+4] = max HP`**.
>
> **Cross-check that pins the semantics independently of the monster
> path**: the party-side populator (`CODE+0x16364`, which fills the same
> array for combat slot 0) sets these same fields from the character
> record instead — `member[+2] ← pcfile+24`, `member[+4] ← pcfile+26`,
> `member[+6] ← pcfile+28`, `member[+8] ← pcfile+30`
> (`CODE+0x1642c`-`0x1649e`; A4 displacements `-17898`/`-17896`/
> `-17894`/`-17892`, resolved against the confirmed character-array base
> `-0x4602(A4)` = `-17922`). It also copies `member[+14] ←
> strcpy(pcfile+98, 10)` (the character name) and `member[+34] ←
> pcfile+417`, `member[+35] ← pcfile+420`. **This newly resolves four
> `pcfile.dbs` fields**: `+24`/`+26` = current/max HP and `+28`/`+30` =
> current/max stamina — superseding §7.3's "`+24,+26,+28,+30` …
> candidate attribute block (STR/IQ/PIE/VIT-shaped)" guess, which is
> now refuted (they are two current/max pairs, not four attributes).
>
> **`+0x7c` (124-127) = STAMINA** by the same route: `member[+8] =
> RollDice(record+0x7c)` (`CODE+0x16220`), `member[+6] = member[+8]`
> (`CODE+0x16254`), mapping onto `pcfile+28`/`+30`.
>
> **Verification — cross-platform port oracle (the strongest evidence
> here).** The DOS/EGA corpus ships its own `data/wizardry6/dosega/wiz6/
> scenario.dbs`, same 188,980 bytes, same `0x154e8` base, same 222-byte
> stride, **247/250 records byte-identical in their name field**. Since
> the 68000 is big-endian and x86 little-endian, any genuine multi-byte
> integer must appear byte-reversed between the two files while genuine
> single bytes must be identical. Restricting to the 182 comparable
> named records and to positions where the two ports actually differ:
>
> | field | width | byte-reversal holds |
> |---|---|---|
> | `+64` XP | u32 | **182/182** |
> | `+68` | u16 | **83/83** |
> | `+84` | u16 | **45/45** |
> | `+100` | u16 | **20/20** |
> | `+116` number appearing bonus | u16 | **51/51** |
> | `+120` **HP bonus** | u16 | **179/179** |
> | `+124` stamina bonus | u16 | **182/182** |
> | `+164` (control — expected *not* multi-byte) | u32 / u16 | **0/4** and **0/3** |
>
> and the single-byte controls `+118`, `+119`, `+122`, `+123`, `+126`,
> `+127`, `+190`, `+208`, `+209`, `+212`, `+214`, `+217`, `+221` differ
> in **0/182** records each. The negative control at `+164` proves the
> test can fail, so the positives are meaningful. Taken over the three
> dice specs as whole 4-byte units, **548 of 549 field instances
> (183 records × 3) match exactly under the BE/LE u16 swap and 0 are
> byte-identical** — the single exception is one `LICHE` record whose HP
> bonus is genuinely different between ports (84 vs 124), one of only 3
> records that differ in content at all. This confirms the
> `(BE u16 bonus, u8 count, u8 sides)` layout byte-exactly, and gives
> the record a complete multi-byte-field map for the first time.
>
> **Verification — third-party published bestiary (the strongest oracle
> available for this game).** Snafaru's Wizardry VI walkthrough hosts a
> full monster list stated to be *"taken from the internal data tables on
> the Wizardry disk, and checked against actual gameplay"*
> (<https://www.zimlab.com/wizardry/walk/w6/3/wizardry-6-walkthrough-3.htm>).
> Every value below was decoded **from this project's own raw Amiga
> `scenario.dbs` bytes** and then compared against that table — no
> reference implementation's code was copied or trusted:
>
> | field | checks | result |
> |---|---|---|
> | `+0x78` **HP** dice spec | 19 monsters | **19/19 exact** |
> | `+0x74` **number appearing** dice spec | 13 monsters | **13/13 exact** |
> | `+0xbe`-`+0xc5` **AC block** (8 signed bytes) | 10 monsters × 8 values = 80 values | **80/80 exact** |
> | `+0x95`-`+0xa1` **resistances** (13 named, positional) | 2 monsters × 13 = 26 values | **26/26 exact** at `+0x95`; **0/26** at `+0x94` |
> | `+0xa8` **%Cast** | 6 monsters | **6/6 exact** |
> | `+0xaa` **%SpecialAttack** | 3 monsters | **3/3 exact** |
> | `+0x40` **XP** (BE u32) | 13 monsters | **13/13 exact** |
>
> Worked HP examples, decoded → published: `RAT` `1+1d3` → `1d3+1 (2-4)`;
> `GIANT RAT` `2+2d4` → `2d4+2 (4-10)`; `SLIME` `4+3d3` → `3d3+4 (7-13)`;
> `HYDRA PLANT` `40+8d3` → `8d3+40 (48-64)`; `ISLAND GIANT` `120+12d6` →
> `12d6+120 (132-192)`; `LICHE` `64+16d4` → `16d4+64 (80-128)`;
> `WILL O' WISP` `88+22d2` → `22d2+88 (110-132)`; `TYRANNASAURUS`
> `2000+50d20` → `50d20+2000 (2050-3000)`. Fixed-HP bosses use `Nd1`:
> `?? BANE KING ??` `150+24d1` → published flat `174`; `* XORPHITUS *`
> `142+18d1` → published flat `160`. `ISLAND GIANT`'s resistance row
> decodes positionally to Cold 75 / Paralysis 95 / Air 85 / Earth 55 /
> Hypnotism 85 / Psionics 85 / Life 65, which is the published row
> element-for-element — a positional confirmation of the element order,
> not merely a multiset match.
>
> **Community-tooling survey (recorded so nobody repeats it).** The
> **Cosmic Forge** editor (Sergey Pershin / "mad god",
> <https://spershin.wixsite.com/mad-god-tiny-hut/cosmic-forge>) is the
> canonical W6/W7/W8 editor but is **binary-only — no source has ever
> been released** (not on GitHub, SourceForge, or the author's own site;
> the `spershin` GitHub account is unrelated day-job work). Its public
> changelog is still useful as a field vocabulary: it names *Attributes*
> (cap 25 — matching `+0x86`-`+0x89`'s observed 2-25 range), *Miss
> Chance*, *Initiative*, *Resistances* (cap 125 — matching), *HP
> Regeneration*, *Special Resistance*, and "Armor AC modifiers for all 9
> Attack Modes", and confirms *"Monster ID takes only one byte throughout
> the Game code"*. **It has no alignment control for W6/W7** (only W7
> `Alliance`, W8 `Faction`). Three GitHub projects touch this format:
> `old-games/WizardryVI-ru` (a Russian translation project shipping
> `monsters/monsters.json` — all 250 stat blocks as raw hex, the most
> useful artifact), `martydill/Wizardry-6-reverse-engineering` (record
> origin is 26 bytes *before* the name block, so subtract `0x1A` to
> convert to this doc's convention; its HP note at its `0x92` is this
> doc's `+0x78`, agreeing with the finding above), and `ndouglas/wiz6`
> (the most complete public field table, but **it must not be inherited
> uncritically** — it reads XP as u16 at `+0x40` and so truncates every
> value above 65535, labels `+0x78` a `goldStat`, and splits `+0x7c`
> into `moveStat`/`monsterLevel`/`monsterLevelMax` rather than
> recognising the stamina dice spec; it does independently agree on
> `+209` = `.PIC` index and `+0xbe` = AC). No public source, forum post,
> or repo documents an alignment field for Wizardry 6.

> **Verification — statistical, all reproduced from raw bytes:**
> `RollDice` mean = `bonus + count*(sides+1)/2`.
> - `corr(log meanHP, log XP) = **0.8956**` across 183 records (the bar
>   the brief set was >0.7; the refuted `+0xd3` candidate managed only
>   0.51). `corr(log meanStamina, log XP) = 0.7999`.
>   `corr(log meanHP, AC) = -0.4157` (correct sign — high HP pairs with
>   low/better AC).
> - Median mean-HP by the confirmed level tier `+0xd4` is strictly
>   monotonic: tier1 **38**, tier2 **70**, tier3 **144**, tier4 **160**.
> - Dynamic range spans the whole bestiary as required: `BAT` and
>   `CREEPING VINE` = `0+1d3` (2-4 HP), `RAT` = `1+1d3`, up to
>   `TYRANNASAURUS` and `HORASTHMUS` = `2000+50d20` (2050-3000 HP),
>   `* B E L A *` = `850+21d1`, `CHARRON` = `500+46d4`. Compare the
>   refuted `+0x86`/`+0x87` candidate's flat 2-25 range.
> - Structural invariants, **0 violations in 183 records**: minimum
>   roll (`bonus+count`) ≥ 1 everywhere (no monster can spawn dead);
>   maximum roll fits the signed 16-bit field the code uses
>   (`MOVE.W`/`SUB.W`/`TST.W`) with a wide margin (max 3000 for HP,
>   7200 for stamina, both « 32767).
>
> **Alignment: refuted — Wizardry 6 has no alignment system, so no such
> field exists.** Evidence:
> - `+0xd6` (214), the last surviving 3-state candidate, is **gender**.
>   A full name census of all 183 records: value `1` (n=23) is
>   *exclusively* female — `AMAZULU`, `AMAZULU ARCHER`, `AMAZULU QUEEN`
>   ×2, `SHAMANESS`, `PRIESTESS`, `KUWALI KUBONA` ×2, `SIREN` ×3,
>   `SIREN SORCERESS`, `MAI-LAI`, `ROBIN WINDMARNE`, `BRIGERD WOLTAN`,
>   `HIGHLANDER`, `VALKYRIE`, `DROW ELF`, `R E B E C C A`,
>   `FAERIE QUEEN`, `FAERIE SYLPH`, `WILL O' WISP`, `TWISTED SYLPH`,
>   `PIXIE`. Value `0` (n=52) is *exclusively* male — `ROGUE`,
>   `PIRATE`, `CAPTAIN MATEY`, `MINER DWARF`, `HILL GIANT`, `SAMURAI`,
>   `NINJA`, `BLACK KNIGHT`, `D R A C U L A`, `* X O R P H I T U S *`,
>   `?? BANE KING ??`, `LORD DAIMYO`, `GRANDFATHER`, `GREATER DEMON`…
>   Value `2` (n=108) is every beast, plant, ooze, undead and dragon.
>   This also explains its character-side source `pcfile+414`, whose only
>   other use is display/icon math (`CODE+0xc7ee` and 15 sibling sites) —
>   the character-sheet gender symbol. **This supersedes both the
>   "alignment" reading and the fallback "coarse creature-type tier"
>   reading recorded in the previous session's note below.**
> - `+0xd6` has **no reader anywhere in `Bane`** — a direct text search
>   for the displacement form `214(An)` over all 113,178 lines of
>   `Bane.asm` returns exactly 2 hits, both *writes*
>   (`CODE+0x2912a`, `CODE+0x2931a`), both in the PC→monster conversion
>   routine. Likewise `221(An)` returns **zero** hits of any kind.
> - **The game has no alignment vocabulary.** `msg.dbs` was re-decoded
>   *sequentially* rather than only at the 724 `msg.hdr`-indexed entry
>   points (each message is self-delimited: `u8 decodedLen`,
>   `u8 compressedLen`, bitstream), yielding **642 messages** including
>   the character-creation enumeration blocks the indexed extractor
>   truncates to their first string. Force-decoding page 0 offset 0
>   yields the race list then `*CANCEL*` then the class list —
>   `HUMAN … DWARF … GNOME … LIZARDMAN … FELPURR … *CANCEL* …
>   FIGHTER … THIEF … ALCHEMIST … PSIONIC … VALKYRIE … LORD`; page 0
>   offset 161 begins the gender block (`MALE …`). **There is no
>   alignment enumeration block anywhere in that sequence**, and across
>   all 642 sequentially-decoded messages `NEUTRAL` and `ALIGN` occur
>   **0 times**, while `GOOD`/`EVIL` occur only inside narrative prose
>   ("…PART OF SOMETHING EVIL…", "GOOD AS NEW!!"), never as an
>   enumeration label. Wizardry 6 dropped the Good/Neutral/Evil system
>   of Wizardry 1-5; character creation is race + gender + attributes.
>
> **Consequences for §7.3 (`pcfile.dbs`)**: `+24`/`+26` = current/max
> HP, `+28`/`+30` = current/max stamina, `+36` = a word copied into
> `member[+0]` (whose monster-side counterpart is `record[122]`, the HP
> dice *count* — the classic "hit dice as level proxy", hypothesis),
> `+98` = 10-byte character name (`strcpy`, `CODE+0x164e4`),
> `+414` = gender, `+417` → `member[+34]` (a 0-3 status/state code,
> `CMPI.B #3` gated — *not* the race byte §7.3 guesses),
> `+420` → `member[+35]`.

> **Session note (HP/AC/level/alignment, `amiga-disasm` trace,
> independently re-verified):** swept the full ~87KB combat subsystem via
> an exhaustive whole-CODE-hunk census of every reference to `-0x3bbe(a4)`
> (the confirmed monster-record-pointer table), plus a newly-found
> "character record -> monster-slot" conversion routine at
> `CODE+0x290b6`-`0x29146` that copies specific `pcfile.dbs` character
> fields into specific monster-record offsets — useful because it let
> monster fields be cross-referenced against already-independently-traced
> character fields (e.g. `pcfile.dbs`'s confirmed `+415`=class). AC and
> level (above) came from this cross-reference. **HP not found**: the
> best candidate, `+0xd3` (211), feeds `Random(10)+field` (clamped >= 1)
> at `CODE+0x1e260`, then gets divided and distributed across per-attack
> runtime fields that lead into the doc's already-flagged `+0x8a`-`0x93`
> "weighted spell/special-ability tier" loop — this reads as a
> **spell/special-ability point pool**, not HP; no write near
> `LoadMonsterIntoSlot` initializes an obvious "current HP" runtime field,
> and the one `RemoveCombatParticipant` call found (`CODE+0x230ee`) is
> gated by a flee/morale counter, not an HP-reaches-zero check.
> `+0xd3` does correlate with XP (r=+0.51) but the structural evidence
> points away from HP. **Alignment not found**: two plausible candidates
> were tested and ruled out — `+0xd9` (217, 3 raw values: 0/3/11) clusters
> cleanly by **creature trait**, not alignment (0=corporeal [160],
> 3=incorporeal/ghost-type [20, exclusively banshees/spectres/wraiths/
> liches/shadows], 11=unique super-boss [Bane King, Dracula, Rebecca]);
> `+0xd6` (214, 3 raw values: 0/1/2, counts 52/23/108) has a thematically
> suggestive split but its character-record source field (`+414`) is used
> elsewhere purely for on-screen text-column math, undermining a stat
> reading. No dedicated 2-3-state field with a clean Good/Neutral/Evil
> correlation was located. **Independently re-verified this session**:
> re-disassembled the AC read sites (`CODE+0x1fce2`) and the AC-derivation
> sequence (`CODE+0x290b2`-`0x290d4`, confirms `+0xbe = +0xbe + +0xbf +
> +0xc0`, an in-place accumulation, not a simple base+modifier pair as
> the field alone might suggest) directly from raw bytes — matches
> exactly. Independently re-derived the full statistical cross-check
> (AC range, Pearson r, level-tier median XPs) from scratch in Python
> against the raw `scenario.dbs` bytes — reproduces every reported number
> exactly, zero deviation.

> **Session note (this session): the full character->monster-slot
> conversion field list extracted; 2 more HP/alignment candidates tested
> and refuted; HP/alignment remain genuinely open.** The routine cited
> above as `CODE+0x290b6`-`0x29146` is the tail of a larger routine
> spanning `CODE+0x28fee`-`0x29342`, with **two parallel copy paths**
> (an inline `muls.w #0x1b0` path and a `jsr -0x7d40(a4)` index-multiply
> helper path, gated by a flag at `-0x3b22(a4)`) that copy the identical
> field set. Independently re-disassembled the full routine directly
> (capstone against the raw CODE hunk, since IRA's `-preproc` classified
> this whole span as data — the known "large hand-optimized binary"
> failure mode, `game-re-tooling/amiga.md`) and reproduced every cited
> displacement exactly:
>
> | `pcfile.dbs` src | size | monster dest | Note |
> |---|---|---|---|
> | `+300` | 1 | `+0x86` | new |
> | `+301` | 1 | `+0x87` | new |
> | `+304` | 1 | `+0x88` | matches existing citation |
> | `+305` | 1 | `+0x89` | matches existing citation |
> | `+338`-`+351` | 14 (bulk `memmove`) | `+0x94`-`+0xa1` | resistance-table block, source of §7.1's `+0x94+idx` field |
> | `+352`-`+359` | 8 (bulk `memmove`) | `+0xbe`-`+0xc5` | AC block; only `+0xbe`/`+0xbf`/`+0xc0` previously confirmed (the accumulation triple) — `+0xc1`-`+0xc5` newly identified as also copied, role not traced |
> | `+414` | 1 | `+0xd6` | already-tested UI-shaped candidate, see below |
> | `+415` | 1 | `+0xd0` | class byte (0-13) — new; not previously known to appear anywhere in the monster record |
> | `+425` | 1 | `+0xd4` | matches existing citation (level) |
> | `+426` | 1 | `+0xd5` | new |
> | `+427` | 1 | `+0xd3` | already-tested "spell pool" candidate |
>
> Independently re-verified byte-exact: disassembled both copy paths
> directly (`CODE+0x29100`-`0x29150` and `0x292d0`-`0x2933c`) and confirmed
> every `LEA -0xNNNN(a4)` displacement in the whole `0x28fee`-`0x29342`
> span resolves to exactly these 11 `pcfile.dbs` offsets, no others.
>
> **Caution on `+0xd0`**: this field is only class-shaped (0-13) for the
> *converted-PC* code path this routine drives. Independently checked
> against the raw on-disk `scenario.dbs` monster records themselves
> (loaded via the normal `ReadSection(category=4)` path, not this
> conversion routine): `+0xd0`'s real distribution across the 183 named
> monster records is `0-26` (26 distinct values, several >13) — clearly a
> **different field for ordinary monsters**, not a class enum. `+0xd0` is
> evidently dual-purpose/overloaded depending on whether the combat slot
> holds a real catalog monster or a converted player character; do not
> read it as "class" for regular monster records.
>
> **Directly tested the task's specific hypothesis — refuted.**
> `pcfile.dbs+420`/`+421` (the doc's own flagged gender/alignment *setter*
> candidates) are confirmed **not** touched anywhere in this routine —
> verified by enumerating all `LEA -0xNNNN(a4)` displacements in the
> routine and confirming neither `-0x445e(a4)` (+420) nor `-0x445d(a4)`
> (+421) appears.
>
> **Two new HP/alignment candidates tested and refuted, both
> independently re-verified statistically against the raw `scenario.dbs`
> bytes:**
> - `+0xd6` (pcfile `+414`) re-tested for alignment: histogram
>   `{0:52, 1:23, 2:108}` reproduced exactly. A full name/category
>   breakdown shows **no Good/Neutral/Evil shape** — group 0 mixes evil
>   unique bosses (Dracula, Bane King, Greater Demon) with mundane NPCs
>   (dwarves, samurai guards); group 2 mixes undead (Liche, Wraith,
>   Banshee) with plain animals (Rat, Bat, Vine). Cross-tab against the
>   confirmed creature-trait field `+0xd9` (independently reproduced:
>   `d6=2` splits `{d9=0: 91, d9=3: 17}`) shows no clean correlation
>   either. **Alignment hypothesis for `+0xd6` is now closed as refuted**,
>   not merely open; best-supported reading is a coarse
>   humanoid/exotic/beast-undead creature-type tier, itself unconfirmed.
> - `+0x86`/`+0x87` (pcfile `+300`/`+301`) tested as an HP current/max
>   pair: range 2-25/2-24 (independently reproduced exactly) is too
>   narrow and inconsistent to plausibly encode HP across a bestiary
>   spanning RAT to TYRANNASAURUS (XP 472,050); `corr(+0x86,+0x87)=+0.12`
>   (independently reproduced: 0.119) — should be high for a genuine
>   current/max pair, so this is refuted as HP.
>
> **Two further avenues tried, both closed as dead ends (not just
> untried):** a search of the fully-decoded `messages.json` (724/724
> messages) for wounded/hurt/dying/critical-health-shaped flavor text
> found **zero hits** — this build has no HP-flavor-text system at all,
> closing that whole approach. A whole-combat-range census for
> `mulu.w/muls.w/divu.w/divs.w #100,Dn` (a literal `*100/max`
> percentage-bar computation) across `CODE+0x14c00`-`0x29988` found
> **zero hits** — if an HP percentage display exists, it doesn't use this
> literal encoding.
>
> **Coverage for a future session**: this pass instruction-by-instruction
> covered `CODE+0x28e00`-`0x29988` (the conversion routine and its
> immediate surroundings) plus 2 targeted whole-range scans over
> `CODE+0x14c00`-`0x29988`. The bulk of `CODE+0x14c00`-`0x28e00`
> (~75KB) remains genuinely un-walked — the same gap the prior session
> left, not newly closed. **New lead for a future pass**: several monster
> names are literal "`X'S GHOST`" (`EILA'S GHOST`, `MARO'S GHOST`,
> `BULLI'S GHOST`, `NARCI'S GHOST`, `BULLI'S GHOST`) — thematically these
> look exactly like the kind of "a specific NPC's spirit becomes a combat
> participant" case the character->monster-slot conversion routine
> exists for; tracing what sets `-0x3b20(a4)`/`-0x3b22(a4)` (the
> char-index/path-select pair gating this routine) before it runs is
> unexplored and might surface an HP-shaped field not checked this pass.

> **Session note (stat block, `amiga-disasm` trace):** the containing
> function is `CODE+0x15fee` — `LoadMonsterIntoSlot(monsterIndex@8(a5),
> slot@0xa(a5))`, self-recursive (calls itself at `CODE+0x16358` to load a
> companion into `slot+1`). It calls `ReadSection(category=4,
> buffer=-0x3bbe(a4)[slot], recordIndex=monsterIndex)` at `CODE+0x16012`,
> confirming `-0x3bbe(a4)[slot]` holds a **live pointer to the monster's
> full 222-byte record** per combat slot — the vector used to find every
> field above. A new primitive was found and confirmed along the way:
> `RollDice(bonus:u16, diceCount:u8, diceSides:u8) -> sum` at `CODE+0x15e8a`
> (`sum=bonus; while(diceCount--) sum+=Random(diceSides)+1`, `Random`=A4
> entry 19/`CODE+0xb9c`) — only 3 call sites exist in the whole binary, all
> inside `CODE+0x15fee`, each fed a 4-byte record slice, which is how the
> three dice-spec fields above were pinned down precisely. Not reached this
> pass despite real effort: HP (current/max), AC, monster level, alignment
> — the containing combat subsystem spans roughly `CODE+0x14c00`-`0x29988`
> (~87 KB, 733 raw hits on the three per-slot table bases), too large to
> sweep exhaustively in one pass; the load/AI-action/cleanup/resistance
> functions sampled were the densest clusters, not the whole subsystem.
> Independent statistical corroboration (this session, byte histograms
> over the 183 named monster records): offset `+117` (`+0x75`, dice-spec
> low byte) clusters `{0:132, 1:29, 2:9, 3:10, 4:2, 8:1}` and `+118`
> (`+0x76`, count) clusters `{1:148, 2:24, 3:5, ...}` — both small-integer,
> dice-shaped distributions consistent with the disassembly-confirmed
> dice-spec role, not proof on their own.

> **Session note (this session): full-coverage re-audit of the ~75KB
> "genuinely un-walked" combat subsystem gap flagged by the previous
> session — HP/alignment still not located, but the negative is now much
> harder-won than before.** This was a direct test of the hypothesis that
> the un-walked gap was a `Bane.cnf` coverage artifact (the same root
> cause already confirmed for `item-catalog-remaining-fields`), not a
> genuine absence. Walked `CODE+0x14c00`-`0x29988` using the now-99.47%-
> covered `Bane.asm` directly (grep + `Read`) instead of ad-hoc targeted
> disassembly, and re-ran every prior negative census against the full
> file:
>
> - **`RollDice` (`LAB_0987`/`CODE+0x15e8a`) callers re-confirmed
>   exhaustively: still exactly 3**, all inside `LoadMonsterIntoSlot`
>   (`CODE+0x160c2`, `0x1618e`, `0x16202`), all consuming the
>   already-confirmed attack/damage dice specs. This upgrades the prior
>   session's targeted-disassembly finding to a full-binary label-census
>   confirmation: there is no 4th `RollDice` call anywhere that could be
>   rolling monster HP.
> - **The death-message function (`LAB_0E2B`/`CODE+0x22c36`, called from
>   the cited `CODE+0x230ee`) re-confirmed to have exactly 1 caller**,
>   binary-wide (`grep`-verified). Read its body directly: it reads
>   record `+0xda` (218, death-message type) gated by `+0xdc` (220) bit 0,
>   consistent with the doc's existing citation — this is gated by the
>   morale/flee counter at the one call site, not by any HP-shaped
>   comparison.
> - **New observation on `+0xdc` (220):** all 4 references to this byte
>   in the whole binary are `BTST #0/#1/#2,220(A1)` (reads, at
>   `CODE+0x16af4`, `0x1e2d0`, `0x22c78`, `0x28b2a`) plus exactly one
>   `CLR.B 220(A0)` (`CODE+0x289ac`, inside a per-slot combat-init
>   routine). **No instruction anywhere sets any bit of this byte** (no
>   `BSET`, `OR.B`, or `MOVE.B #imm,220(...)` found) — it is either baked
>   into the static on-disk catalog record (not runtime-computed at all)
>   or set via a bulk copy this pass didn't isolate; either way it reads
>   as a per-monster-type flag (death-animation/message variant), not a
>   live "HP reached zero" trigger.
> - **Direct SUB/ADD mutation census on the static per-slot record clone
>   (`-0x3bbe(a4)[slot]`, the 222-byte `ReadSection`-populated buffer):
>   zero mutating instructions found anywhere in the binary.** Every one
>   of the 151 total references to this table resolves to `MOVE`/`CMPI`/
>   `TST`/`PEA` — no `SUB.B`/`SUB.W`/`ADD.B`/`ADD.W` targets any offset of
>   this buffer. If monster HP were tracked as a mutable field inside this
>   per-slot clone (a natural design, since each combat slot gets its own
>   copy), damage application would have to show up as a `SUB` here; it
>   doesn't. This is new, structurally strong evidence *against* "HP is a
>   direct field of the static catalog record."
> - **Traced the sibling per-attack runtime array (`-0x3ba2(a4)[slot]`, a
>   44-byte-stride array of up to 6 attack sub-records, shared by both
>   `LoadMonsterIntoSlot` and a parallel party-side populator at
>   `CODE+0x16364`) end to end** — mapped fields `+0`/`+2`/`+4`/`+6`/`+8`
>   (attack/damage-dice-derived words), `+34` (a 0-3 state code gating
>   several combat-loop filters), `+42`/`+43` (sentinel/active-flag
>   bytes), and the struct-header fields `+396`-`+413` (per-slot flag
>   arrays and an attack-count byte). Its only mutable fields, `+2`/`+4`,
>   **do get `SUB.W`ed** (`CODE+0x1f038`/`0x1f05a`/`0x20976`/`0x2355e`)
>   and `ADD.W`ed (`0x26c4c`/`0x26de4`) — but tracing the write-back shows
>   the decremented value is saved into a **per-character 432-byte-stride
>   array** (`-0x45ea(a4)`-family, the confirmed `pcfile.dbs` record
>   stride), i.e. this is a player-character resource (reads like
>   spell/wand charges), not monster HP. **Ruled out as the HP field.**
> - **New, unrelated finding surfaced by this trace**: the "weighted
>   spell/special-ability tier-selection" array flagged in the field table
>   above as `+0x8a`-`+0x93` (hypothesis, "contradicts the resistance-table
>   range... not reconciled") has its **real base traced to record offset
>   `+0x53`** (83 decimal) — confirmed via `PEA 83(A1)` (`CODE+0x1e81e`,
>   `0x1e8fc`) feeding directly into `CODE+0x1d142`, which **is** the
>   already-documented `Random(8)`-seeded, mod-100-bounded weighted-tier
>   search loop. A second field, `+0x51` (81 decimal), gates whether this
>   block runs at all (`CMPI.B #1,81(A1); BLS.S skip`, `CODE+0x1e6b2`/
>   `0x1e6dc`/`0x1e880`) — likely a per-monster "ability count/has-ability"
>   flag. This resolves the doc's own "not reconciled" contradiction: the
>   real array lives at `+0x53`, not `+0x8a` (the `+0x8a`-`+0x93` guess is
>   superseded, left here per this project's convention of not silently
>   deleting superseded claims). Not HP-related, but a genuine byproduct
>   of the dedicated walk.
>
> **Net assessment: HP and alignment remain genuinely open, but the
> "un-walked ~75KB" caveat no longer applies in the same way** — this
> session walked the full range with full `Bane.asm` coverage, ran 4
> independent exhaustive censuses (RollDice callers, death-fn callers,
> static-record mutation search, runtime-attack-array mutation trace),
> and found zero candidates consistent with a mutable current/max HP
> pair. The remaining possibility space has narrowed to: HP living in a
> wholly separate, not-yet-identified runtime structure (neither the
> static per-slot clone nor the per-attack array), or a display-only
> mechanism this pass's searches don't cover (e.g. a coarse HP-band
> icon/portrait-tint selector rather than a numeric field). The "X'S
> GHOST" monster-name-cluster lead from the prior session remains
> unexplored and is still the most promising concrete next step.

Names read as unmistakable real Wizardry 6 bestiary entries: `RAT, GIANT
RAT, BAT, HUGE BAT, VAMPIRE BAT, CREEPING VINE, ROGUE, BUSHWACKER, ROGUE
LEADER, GIANT SERPENT, ZOMBIE, SLIME, HYDRA PLANT, DUNGEON LEECH,
ROTTING CORPSE`, plus named bosses (`XORPHITUS, QUEEQUEG, CAPTAIN MATEY,
L'MONTES, AMEN-TUT-BUTT`). 183/250 slots have a legible name; the other
67 are all-zero (unused roster capacity, same convention as `msg.hdr`
and the `.PIC` directory's trailing-blank-slot pattern).

The "category name" field was the standout *lead* for the `.PIC`
cel-mapping question: for a plain monster the category equals its own name
(`RAT`/`RAT`), but variant/reskinned monsters point at a shared base
(`BUSHWACKER`→category `ROGUE`; `HUGE BAT`/`VAMPIRE BAT`/`BLACK BAT`→
category `BAT`) — exactly the shape a "which sprite set renders this
monster" selector would have. This pass found and confirmed the actual
field it was pointing at: record offset **+209** (see §2.6) — a small
integer, not the category name itself. The category text and `+209` agree
almost everywhere (same category ⇒ same `picFileIndex`) with one
instructive exception: `BRIGAND`/`PIRATE` share category `ROGUE` with
`ROGUE`/`BUSHWACKER`/`ROGUE LEADER`/`SCALLYWAG`, but `+209` gives them
`11` (`CAPTAIN MATEY`'s own file) instead of `22` (the other four
`ROGUE`s) — a thematically sensible pirate-specific reuse the coarser
category field alone wouldn't have predicted, which is independent
evidence `+209` is the real selector rather than a re-derivation of the
category text.

Verified extractor: `tools/wizardry6/decode-scenario-monsters.ts` (writes
`public/assets/wizardry6/amiga/data/monster-mapping.json`).

**Section 9 (offset `0x2df34`–EOF, 64×12-byte records) — CONFIRMED: the
`SOUNDnn.SND` length directory.**

> **Correction (this session, `amiga-disasm` trace + independent
> re-verification):** the target blob is now identified. The earlier
> "277,826 bytes doesn't match any corpus file" claim below had a
> transcription slip in the chain endpoint — `0x43b42` is **277,314**
> decimal, not 277,826 — and 277,314 is *exactly* the combined size of
> every real `sound##.snd` file in the corpus (`35/35` files sum to
> `0x43b42` byte-for-byte). Full derivation and verification below;
> original text kept struck through per this doc's convention.
>
> ~~*(original "target blob unidentified" analysis, superseded)*~~

Interpreting each 12-byte record as `[BE u32 offset][BE u32 length][4
bytes tail]` and testing the same boundary-partition invariant already
confirmed for the `.PIC` directory (§2.1) and `mazedata.ega`'s directory
(§4.2) — `record[i].offset + record[i].length == record[i+1].offset` for
the *next record in the chain* — holds for **34 of the 39 non-empty
records** with zero deviation, forming one continuous cumulative-sum chain
from `0` to `0x43b42` (277,314 bytes). The 5 records that don't participate
(indices 1, 9, 18, 19, 39 — small values like `8`, `0x10`, `0xf`, `5` that
don't fit the chain) correspond **exactly** to the 5 gaps in the corpus's
`sound##.snd` numbering (no `sound01.snd`, `sound09.snd`, `sound18.snd`,
`sound19.snd`, `sound39.snd` exist on disk) — these are unused/reserved
slot indices, not placeholder records with unrelated content. Records
40-63 are all-zero (unused capacity).

**Reader — confirmed (disassembly, `CODE+0x468a`-`0x4782`).** `ReadSection`
category `9` (A4 entry 17, `CODE+0x9fc`) is called from 11 literal-9 sites
(`CODE+0x46b4, 0x47ce, 0xb27c, 0xb29e, 0x15c26, 0x15c48, 0x3f864, 0x3f886,
0x50556, 0x50578`), caching each record into `-0x71b2(a4)[idx]`
(`CODE+0x46a8`). The consumer at `CODE+0x468a`-`0x4782` reads **only the
cached record's `length` field** (`-0x71ae(a4)[idx]`, i.e. the record's
`+4`, at `CODE+0x4742`-`0x4746`) — the `offset` field is **never read by
this build**. It builds `"SOUND<nn>.SND"` via the same digit-pair idiom as
§2.6's `MON<nn>.PIC` loader, opens the file, and calls `LoadSoundEffect`
(A4 entry 44, `CODE+0x27c6`): `AllocMem(length)` (`CODE+0x27f2`),
`Seek(handle, 0)` — hardcoded to the start of the file, **not** the
record's own `offset` field (`CODE+0x2816`) — `Read(handle, buffer,
length)` (`CODE+0x282c`), then a `subi.b #0x80,(a0)+` bias-removal loop
(`CODE+0x283e`-`0x2842`) converting the file's unsigned 8-bit PCM to
signed — independently corroborating §8's DC-offset-`0x80` finding, this
time from the decoder side rather than a byte histogram.

**Verification (independently re-run in the orchestrating session, not
copied from the trace):** all 35 non-empty section-9 `length` fields match
their corresponding real `data/wizardry6/amiga/sound{NN}.snd` file size
**exactly, 35/35, zero deviation** (e.g. record 0 length=1769 =
`sound00.snd`'s exact byte size; record 38 length=6318 =
`sound38.snd`'s exact byte size). Sum of all 35 real `.snd` file sizes on
disk = **277,314 = `0x43b42` exactly**, matching the chain endpoint
byte-for-byte. The 5 non-chaining record indices are exactly the 5 gaps in
`.snd` file numbering (1, 9, 18, 19, 39) — not a coincidence, a structural
match.

**Conclusion (confirmed):** section 9 is the game's own `SOUNDnn.SND`
length/index directory, consumed only for `AllocMem` sizing and building
the filename string — the `offset` field is genuinely vestigial on this
Amiga build (plausibly meaningful to a different platform's packed sound
bank in the shared cross-platform authoring format, or simply redundant
since each sound ships as its own file here). The 4-byte "tail" field
(`+8..+11`, clustering around a `00 xx 49 00`-ish shape with a handful of
outliers) is not consumed anywhere in the traced loader path — still
undecoded, but low-priority now that the directory's core purpose is
solved.

Verified extractor: `tools/wizardry6/decode-scenario-section9.ts` — output
JSON's `offset`/`length`/chain fields are unchanged (still byte-exact from
the file), only the documentation of what they mean has changed; a
follow-up pass could add filename cross-references (`sound##.snd`) to the
JSON but the raw decode was already correct.

**Sections 2/3 — structure confirmed (per-class array, 14 real records),
domain confirmed as class-selection/class-display data via disassembly;
refutes the dungeon-geometry hypothesis. Field-level semantics mostly
open.**

> **Correction (this session, supersedes the "16-record count doesn't
> match 14 classes" conclusion below):** the earlier conclusion was based
> only on the section's *declared* capacity (`master.hdr[2]=16`,
> `master.hdr[3]=16`) without checking whether all 16 slots are actually
> populated — the same "declared capacity > real content, padded with
> all-zero placeholder slots" convention already established elsewhere in
> this exact file (`msg.hdr`'s 850-slot table with only 724 real records,
> §6.2; the `.PIC` directory's blank trailing slots, §2.1; `scenario.dbs`
> section 4's 67 blank monster slots, §7.1). Re-checked directly against
> the raw bytes: **records 14 and 15 are all-zero (0/1346 and 0/1740
> nonzero bytes) in both sections 2 and 3** — i.e. only **14** of the 16
> declared slots hold real data, exactly matching the known 14-class
> roster after all.
>
> This is independently confirmed by `Bane`'s own startup code, not just
> by re-reading the raw bytes. A dedicated allocator at
> `CODE+0x4bee`-`0x4c76` (part of the same init sequence that opens
> `SCENARIO.DBS` and caches `master.hdr`/`disk.hdr`/`msg.hdr`/`pcfile.dbs`'s
> header, `CODE+0x4a80`-`0x4b58`) runs a loop bounded by
> `cmpi.w #0xe,-0x6(a5); blt.b <loop>` — **exactly 14 iterations** (index
> `0..13`) — allocating one `master.hdr[2]`-sized buffer (`1346` bytes,
> pushed via `move.w #0x542,-(a7)`) and one `master.hdr[3]`-sized buffer
> (`1740` bytes, `move.w #0x6cc,-(a7)`) per iteration, storing the
> pointers into two parallel DATA-hunk-relative arrays at `-0x4816(a4)`
> (section 2) and `-0x47de(a4)` (section 3). The loop bound `0xe`=14 is a
> literal in the code — the game itself only ever allocates/touches 14
> per-class slots for these two sections, never 16.
>
> A separate global, `-0x47a4(a4)` (a "currently selected class/slot"
> index), is used by at least three sites
> (`CODE+0xb1ec`-`0xb25e`, `CODE+0x10020`-`0x10094`,
> `CODE+0x133cc`-`0x13408`) to `CopyMem` between a given slot's cached
> record (`-0x4816(a4)[slot]`/`-0x47de(a4)[slot]`) and two shared
> "working" buffers (`-0x481e(a4)` for section 2, `-0x481a(a4)` for
> section 3) — i.e. there is a genuine "select one class at a time, copy
> its record into a scratch working area" access pattern, consistent with
> a class-information/class-selection UI screen rather than dungeon
> geometry (dungeon levels aren't "selected" one at a time out of a
> fixed set of 14 the way classes are). A fourth site,
> `CODE+0x71a0`-`0x71de`, sweeps **all** `master.hdr[2]`=16 declared slots
> (loop bound read from the cached `master.hdr` count field at
> `-0x74b0(a4)`, not the hardcoded `14`) copying each into small
> per-iteration local buffers — a generic "list all class slots including
> blanks" sweep, consistent with a selection menu that shows all 14 real
> classes (the 2 blank slots would just render empty).
>
> Two concrete record fields were located this session, both consistent
> with UI/display use rather than maze data: bytes at **section-2 working
> buffer offset `+0x1e0`** and **`+0x1ec`** are read as small integers and
> added to on-screen base-coordinate globals (`-0x479e(a4)`/`-0x479c(a4)`)
> to produce a final screen X/Y pair (`CODE+0x10098`-`0x100cc`), and byte
> offset **`+0x43a`** is passed **by address** (not by value) to a generic
> bit-test primitive (`CODE+0x2958`, A4 entry 46 / `-0x7eea(a4)`:
> `TestBit(buffer, bitIndex)` — the same shape of primitive the `.PIC`
> tile-presence mask reader would use, §2.1) from
> `CODE+0xa810`-`0xa866`, with a computed bit index built from the same
> five screen-position globals populated at `+0x1e0`/`+0x1ec` — i.e.
> `+0x43a` onward is very likely a **bitmask indexed by (row,col)-derived
> position**, not a `.PIC`-style NUL-terminated cel-index list as first
> suspected (raw bytes at that offset are dense/high-entropy, not a short
> run of small ascending indices terminated by `0`).
>
> **Net effect on the original task question**: this is strong,
> disassembly-confirmed evidence that sections 2/3 are **not** the
> per-level dungeon/maze grid — they are per-class (14) UI-related
> records, most plausibly driving a class-selection or class-info screen
> (character creation), consistent with `WFONT1.EGA`'s already-confirmed
> class-abbreviation icon tiles (§5.2). The dungeon-level geometry, if
> present anywhere in this corpus, is **not** in `scenario.dbs` sections
> 2 or 3 — see the updated `docs/wizardry6/TODO.md` entry.
>
> **Correction (later session, §4.7): this conclusion was wrong.** Every
> individual fact traced above is real (the 14-iteration allocator, the
> `CopyMem`-into-scratch-buffer access pattern, the `+0x1e0`/`+0x1ec`/
> `+0x43a` field reads all check out byte-for-byte) — the wrong inference
> was the *domain*. `-0x47a4(a4)` is not a "selected class slot"; it's the
> **current maze level index** (confirmed via `SetLevel` at `CODE+0x103f0`
> and two scripted level-transition call sites). Sections 2/3 are the
> per-level dungeon maze geometry and its companion entity table — see
> §4.7 for the full corrected derivation, independently re-verified
> byte-exact against a cross-platform oracle (the DOS/EGA release) and
> against `newgame.dbs`. This section's byte-level findings (allocator,
> access pattern, field offsets) remain accurate and are incorporated into
> §4.7 with corrected semantics; left here, uncorrected in place, as a
> documented instance of a plausible-but-wrong domain inference from
> otherwise-solid evidence.
>
> Not located this pass: the exact call site that performs the *initial*
> disk **read** filling each of the 14 allocated slots (the allocator
> above only calls `AllocMem`; the three `CopyMem` sites found all copy
> between already-populated buffers). None of the 47 confirmed
> `ReadSection` (entry 17) call sites use category `2` or `3` (literal or
> otherwise) or target the `-0x4816(a4)`/`-0x47de(a4)` arrays as a
> buffer argument — the read likely happens through a separate,
> not-yet-located routine (possibly folded into the allocator itself via
> a call this pass didn't attribute, or triggered lazily on first
> class-selection). Full field layout beyond the three located fields
> (`+0x1e0`, `+0x1ec`, `+0x43a`) remains open.

**Sections 5, 6, 7, 8 — section 6 confirmed (a scripted event/opcode
table, callable as sub-scripts, NOT monster encounter/spawn groups),
section 7 confirmed (a weighted treasure/reward table referencing the
**item** catalog, not monster encounters — corrects the earlier
"encounter-selection" label), section 5 rendered (new lead this
session), section 8 confirmed closed (generic resource cache, no
dedicated content reader — see below).** Boundaries and record size/count
are known exactly (§6.4's
section table). `ReadSection` call sites *are* now confirmed for these
four sections (literal categories `5`, `6`, `7`, `8` found at
`CODE+0x47994`, `0x421de`, `0x477b0`/`0x4fde2`, and
`0x45a2`/`0x6194`/`0x14840`/`0x15d2a`/`0x400d4`/`0x51584` respectively —
see §6.4's correction above).

> **Correction (this session): an undocumented, unverified claim in
> `docs/wizardry6/TODO.md`/`plan.md` — "section 6 is confirmed as 400x32B
> monster encounter/spawn groups" — is REFUTED.** That claim was written
> into the project's status-tracking files by a previous session but was
> **never actually substantiated anywhere in this doc or the
> investigations directory** — a process gap caught only because this
> session re-verified it from scratch per the project's own "independently
> re-verify agent claims before writing them as confirmed" practice,
> rather than carrying the TODO's wording forward. Fresh disassembly this
> session found the real structure below, independently re-verified
> byte-exact (own from-scratch Python re-derivation, not copied from the
> tracing agent's numbers).
>
> **Section 6 (`file 0x23f74`-`0x27174`, 400 x 32-byte records) — confirmed:
> a general scripted event/opcode table, not monster data.** The reader
> (`CODE+0x421ba`, `ReadSection` call at `CODE+0x421de`, literal category
> `6`) loads each 32-byte record as **8 sub-entries of 4 bytes**
> (`word@+0`, `byte@+2`, `caseCode@+3`), confirmed by the loop bound
> `cmpi.w #0x8,d0` immediately after the read. Each sub-entry's `caseCode`
> dispatches through a **45-entry jump table** at `CODE+0x433c4`/
> `0x4341e`-`0x43424` (targets `CODE+0x4220c`-`0x433ac`). Case `0` is a
> terminator (exits the whole function). Histogram across all 3200
> sub-entries (400 records x 8): `{0: 2653 (82.9%, terminator), 1: 174
> (5.4%), 15: 50, 6: 46, 3: 37, 20: 28, 16: 27, 34: 26, 9: 17, 37: 15, ...}`
> — independently re-derived exactly, including the full top-10
> histogram, in this session's own from-scratch Python re-parse.
>
> Case `1`'s handler (`CODE+0x42212` -> `CODE+0x40944`) calls
> `CODE+0x872` — the confirmed `LoadMessage(triggerID,destBuffer)` API
> (§6.2) — via the identical `pea.l <dest>; move.w <id>,-(a7); jsr
> -0x7fa4(a4)` push shape. Case `1`'s `word@+0` field is a **msg.hdr
> trigger ID**: **174/174 (100%) exact match** against `msg.hdr`'s 724
> confirmed field-A values, independently re-derived this session
> (0 mismatches). Case `6` is the same: **46/46 (100%) exact match**.
> These are exactly the field this doc previously flagged as "clustering
> 11810-12080, incrementing 5-20/record, cross-referenced against
> msg.hdr at baseline/noise level" (below) — the previous cross-check was
> run against the *whole file*'s `u16` fields indiscriminately rather than
> against this specific case-1/case-6 subset, which is why it read as
> noise; isolating by case code reveals a perfect match. `word@+0`'s
> value range for case 1 (11810-18850) is entirely disjoint from the
> monster catalog's 0-249 index domain — **0/174 values fall in
> `[0,249]`**, directly refuting a monster-ID reading.
>
> Other located case codes, none monster-related: case `29` gates a
> **recursive self-call** to `CODE+0x421ba` behind `RandomRange(100)`
> (`CODE+0x42c68`, A4 entry 19, `CODE+0xb9c` — the same `Random()`
> primitive `RollDice` uses, independently confirmed this session);
> case `12` clears a 432-byte-stride array at `-0x45ee(a4)` (the
> `pcfile.dbs` record stride — resembles a per-character reset); case
> `33` loops calling `RandomRange(8)` N times summing into an accumulator
> (a dice-roll pattern, structurally similar to but a separate code path
> from the confirmed `RollDice` primitive). **Conclusion: section 6 is a
> general scripted event/opcode table** (message display, recursive
> probability-gated triggers, dice-style rolls, character-state resets),
> not monster encounter data — genuinely refuted, not merely
> unconfirmed. `master.hdr`'s own "record count 400" for this section
> remains accurate; it's 400 8-slot opcode-sequence records, not 400
> monster groups.
>
> **Update (2026-08-03, `amiga-disasm` trace): 7 more case codes
> characterized, plus a structural finding that section-6 records are
> callable sub-scripts, not a flat opcode list.** All 45 jump-table
> targets were recomputed byte-exact directly from the raw executable
> (some IRA-disassembled table words misdecode as bogus instructions —
> the raw recompute was cross-checked against the 6 already-confirmed
> case targets first, all landed exactly right). Requested top-frequency
> codes, verified against the full 400x32B corpus (3200 sub-entries):
>
> | case | target | n | characterization |
> |---|---|---|---|
> | 3 | `CODE+0x422ca` | 37 | **fixed "show-once" message**: literal msg.hdr trigger `0x606`/1542 via `CODE+0x40a88`, gated by a per-sub-entry "already shown" flag byte at `-34(a5)[i]` |
> | 9 | `CODE+0x42540` | 17 | **item-possession-gated one-time message**: `CODE+0x41adc` calls `ReadSection(category=1, recordIndex=word@+0)` — `word@+0`'s range (230-471) confirms it's an **item-catalog index**, not a monster/msg id; searches party equip-caches for that item, on match+unset-flag shows msg.hdr trigger `0x60b`/1547 |
> | 15 | `CODE+0x427f4` | 50 | writes `(byte@+2, word@+0)` via helper `-0x7f0e(a4)`(`-32496`) into two parallel arrays (`-18290(a4)`, `-30310(a4)`), indexed by an external counter — mechanism confirmed, destination-array semantics open (hypothesis: spell/flag grant list, given the tight `word@+0` bound `0<v<79`) |
> | 16 | `CODE+0x42874` | 27 | same `-32496(a4)` helper as case 15, dest fixed at `-8798(a4)` (2 bytes before section 7's `-8796(a4)` output array — possibly its count-prefix). Sibling case 17 (`CODE+0x428ba`, adjacent, not separately requested) does the same plus a second write to a `-8816(a4)`-indexed array |
> | 20 | `CODE+0x42998` | 28 | **membership test + early-abort**: `helper -0x7f0a(a4)`(`-32490`)`(word@+0, list=-8798(a4))`; if the result is `1`, aborts the **whole record** (`D0=0; RTS`) — a conditional short-circuit gate over the rest of the record's sub-entries |
> | 34 | `CODE+0x430da` | 26 | **recursion, confirmed**: `JSR CODE+0x421ba(charIdx, byte@+2)` — `CODE+0x421ba` is section 6's own top-level record processor; `byte@+2` is translated through a word-indexed table at `-8894(a4)` into a *different* record index, which is then recursively processed as a full sub-script; a `1` return aborts the outer record. Case 27 (`CODE+0x42bca`, incidental find, not separately requested) uses the identical pattern |
> | 37 | `CODE+0x43172` | 15 | new pattern: loops `word@+0` times; each iteration dispatches on `byte@+2∈{0..3}` through a 4-entry table adjusting one of two running bound counters (`-18336(a4)`/`-18338(a4)`), calls a "pick position within bounds" helper (writes 3 output coords `-18330/-18332/-18334(a4)`), indexes a per-tile byte array at that position, then notifies via `CODE+0x40be0`(`#4`) — shape (bounded position search + per-tile lookup + notify) is consistent with a spawn-placement or reveal/light-radius mechanic; semantics open |
>
> **Section 6 records are callable sub-scripts, not a flat per-record
> opcode list** — recursion into `CODE+0x421ba` now confirmed at 3
> distinct case codes (29, 27, 34), not just the one previously
> documented (29); cases 27/34 route the recursion target through an
> explicit `byte@+2` translation table rather than a random pick,
> confirming this is deliberate scripted call structure, not just a
> probability-gated repeat.
>
> **Section 7 (`file 0x27174`-`0x290b4`, 200 x 40-byte records) —
> corrected this session: this is a weighted treasure/reward table
> referencing the item catalog, NOT monster encounters.** The earlier
> "weighted encounter-selection table" label is superseded below.
>
> Reader `CODE+0x4778e` (`ReadSection` call `CODE+0x477b0`, literal
> category 7) is Consumer A; a second, previously-untraced `ReadSection`
> call site at `CODE+0x4fde2` (function `CODE+0x4fdd0`) is Consumer B —
> both address the same 40-byte record shape starting at **record offset
> 0**, not offset 4 as previously assumed: 6 x 6-byte sub-entries
> (`word id@+0`, `word availCount@+2`, `byte kind@+4`, `byte weight@+5`),
> loop bound `cmpi.w #6`. **Corrects the "4-byte header" claim** — there
> is no leading header; the 4 bytes this doc previously described as a
> header are actually **trailing**, at record offset `+36`-`+39`, and
> neither confirmed consumer ever reads them (genuinely unaccounted-for,
> same status as before, just at the opposite end of the record).
>
> **Decisive evidence against "encounter table": both consumers feed the
> weighted pick's output straight into `ReadSection(category=1, ...)`**
> — category 1 is the confirmed **item catalog** (§7.1), not category 4
> (monster catalog). Consumer A (`CODE+0x45ebc`, called from
> `CODE+0x4778e` after the pick loop) reads the picked record's item-
> catalog dice fields `+20`/`+22`/`+23` (the already-confirmed damage-
> bonus/dice-count/dice-sides fields) to compute a max-damage preview.
> Consumer B dispatches per-slot on the `kind` byte via `CODE+0x4ff50`:
> `kind==1` -> `CODE+0x4fe76`, `RandomRange(id-availCount)+availCount`
> accumulated into a running total (gold-shaped: weight is always 100,
> deterministic, `id>=availCount` in every occurrence); `kind==2` ->
> `CODE+0x4fef0`, `id+RandomRange(availCount)` written into an item-index
> pool later fed to `ReadSection(category=1,...)` at `CODE+0x5001c`;
> `kind==4` -> `CODE+0x4feca`, `id*availCount` accumulated into a second
> running total; `kind==0` is a no-op/skip.
>
> **Full-corpus verification** (`scenario.dbs` offset `0x27174`,
> 200x40B, 1200 sub-entry slots): `kind=0` 625 (52.1%, inert padding,
> all-zero); `kind=1` 86 (7.2%, weight always 100, id 20-30000,
> availCount 10-25000, `id>=availCount` 86/86 — gold-reward shape);
> `kind=2` 478 (39.8%, weight 2-100 variable, id 1-482, availCount 1-58 —
> **478/478 (100%) within the item catalog's valid `[0,499]` index
> range**); `kind=4` 11 (0.9%, weight always 100, id 100-10000,
> availCount 1-10 — flat multiplicative bonus shape). **Refined label:
> a weighted treasure/reward table** (gold roll / item-catalog pick /
> flat bonus), not monster encounters — confirmed by the code-level
> `category=1` `ReadSection` call, a stronger proof than a numeric-range
> check alone (the item catalog's `[0,499]` and monster catalog's
> `[0,249]` ranges aren't disjoint, so range alone would only be
> suggestive). Whether Consumer A (shop stock?) and Consumer B (chest/
> treasure drop?) represent different in-game contexts is plausible but
> unconfirmed — both consumers' own `recordIndex` sources
> (`-8819(a4)`/`-15296(a4)`) have no located writer in the 99.47%-covered
> `Bane.asm`, left open for a future pass.
>
> **Section 5 (`file 0x22db4`-`0x23f74`, 32 x 142-byte records) —
> rendered, refined.** Reader `CODE+0x47982`-`0x479c2` (`ReadSection` call
> `CODE+0x47994`, literal category 5), buffer cached at `-0x22fe(a4)`.
> Only 2 other sites reference that exact buffer displacement:
> `CODE+0x40072` (forwards buffer + literal `14` into the shared
> `.PIC`-style compositor `CODE+0x20d4`, the same target already
> documented for A4 entry 16's "index `<16`" branch) and `CODE+0x40a9e`
> (forwards buffer + literal `94` into a different accessor, A4
> `-0x7faa`). Neither reads a *named scalar field* out of the record for
> game logic — the buffer is passed opaquely into generic shared code, so
> "combat-slot init blob, no per-field consumer" stands, refined with the
> two concrete forwarding sites.
>
> **New lead (2026-08-03, incidental find while tracing section 6's case
> 3):** case 3's handler (`CODE+0x40a88`, the same "show-once fixed
> message" case documented above) forwards the **exact same `-0x22fe(a4)`
> buffer and literal `94`** already flagged as one of section 5's two
> known forwarding sites (`CODE+0x40a9e`) — confirming `-0x22fe(a4)` is
> genuinely section 5's own cached buffer, reused live. This happens as
> step 2 of a 3-step "load message text -> forward buffer+94 to accessor
> `-0x7faa(a4)` -> call the message-box renderer" sequence used by
> several section-6 message-display cases, suggesting section 5 supplies
> a small fixed-size (<=94-byte) sub-resource consumed alongside message
> text during message-box rendering (a window frame or portrait template
> are the obvious candidates) — hypothesis only, not traced further this
> session.
>
> **Section 8 (`file 0x290b4`-`0x2df34`, 64 x 314-byte records) — CONFIRMED
> CLOSED: a generic resource cache, content is per-use, not a fixed
> semantic struct.** Reader `CODE+0x4580` (`ReadSection` call
> `CODE+0x45a2`, literal category 8), destination is a **fixed cache
> array** at `-0x3ae4(a4)`, indexed `recordIndex*314` (all 64 records
> cacheable simultaneously — a genuine resource cache, not scratch space;
> this is the same 314-byte-stride record independently found this
> session from the opposite direction while tracing `pic-cel-list-
> mapping`'s "table 1/table 3" side tables, see §2.6 — same cache
> mechanism, cross-confirmed). Post-read code builds a 2-digit ASCII
> string via `div/10,+0x30` on the *recordIndex parameter itself*
> (portrait-filename-shaped), but this doesn't touch the record's own 314
> content bytes.
>
> **Update (this session): the length-lookup mechanism traced to source
> resolves this fully — see §2.6's "Final update" block.** `ReadSection`'s
> `Read()` length for every category, section 8 included, is simply
> `master.hdr[category]` (confirmed: `master.hdr` word index 8 = 314,
> byte-exact match), loaded once at program init from the literal
> `MASTER.HDR` file (`CODE+0x4b08`-`0x4b18`) into `-0x74c8(a4)`. The
> loader is fully generic and category-agnostic — there is no
> category-8-specific, field-aware code anywhere in this call chain, and
> no evidence any such code exists elsewhere (the exhaustive `MOVE`-class
> census against the cache's own 314 content-byte offsets, run last
> session, found only the cel-list consumers documented in §2.6, never a
> named "section 8 record" reader). Since the identical 314-byte cache
> slot independently and simultaneously serves monster `.PIC` cel-list
> content with no dedicated reader inside the loader itself, "content
> varies entirely by what's cached into the slot at the time" is the
> correct closing answer for section 8 — not a missing reader that a
> future pass might still find. **Closed.**

Two specific concerns raised
by a prior pass were followed up and **both ruled out**:

- **Not graphics.** Sections 2/3 were rendered as plane-major 4bpp
  bitplane data (the corpus's one confirmed image convention, §2.3/§3/§4)
  at 5 candidate widths (64–320px) — every render is visual noise, no
  coherent shapes at any width. This matches the entropy evidence:
  2.93–3.26 bits/byte for sections 2/3/7/8 and 1.22–2.21 for sections 5/6,
  well below the confirmed real-image range (4.0–5.6 bits/byte, §2.1).
  The "sprite/bitplane-shaped byte patterns" flagged by the prior pass
  were incidental printable-ASCII runs in ordinary small-integer data, not
  real image content — confirmed by string-scanning sections 2/3 and
  finding only garbage strings, no legible words.
- **Not Huffman-compressed text.** Tried decoding section 2's records
  through the confirmed `misc.hdr` bit-tree (§1.3/§5.1) at every plausible
  bitstream start offset — output is dominated by `E`/`T`/`A`/`O`/`N`/`S`
  repeats (the tree's shortest-code letters), the classic signature of
  *non*-Huffman bits being walked through the tree rather than genuine
  compressed text (matches this project's own documented
  `rle-decode-succeeds-on-garbage`-style pitfall: a decode that runs to
  completion and even looks superficially plausible isn't real).

Beyond ruling those two out, no positive structure was found for 5/6/7/8:

> **Correction (this session):** the "16 doesn't match 14 classes" and
> "record 0/1 byte-identical" claims below are both **wrong** and are
> superseded by the confirmed finding above (records 14-15 are the
> all-zero padding; only 14 of 16 declared slots are real). Re-checked
> directly: section 2 records 0 and 1 share only a **96-byte common
> prefix**, not full identity — 599 of 1346 bytes differ overall. The
> original "byte-identical" claim was never substantiated by an actual
> byte-for-byte diff; left here, struck through, as a documented dead end
> per this project's convention of not silently deleting superseded
> claims.
>
> ~~**Sections 2/3** (16 records of 1346/1740 bytes): not sparse — nonzero
> bytes are spread through the whole record, not concentrated in a
> header. 16 records does *not* match Wizardry 6's known 14-class roster
> (already confirmed via §7.1's XP tables and §5.2's `WFONT1.EGA` class
> labels), ruling out a simple per-class table. Record 0 and record 1 are
> byte-identical (boilerplate/placeholder, same convention as elsewhere
> in this corpus) in section 2; not similarly checked for section 3.~~

- **Sections 5/6/7/8**: section 6's records show a recurring `BE u16`
  field clustering tightly in the `0x2e00`–`0x2f30` (11,776–12,080)
  range, incrementing by roughly 5–20 between consecutive records —
  looks like it could be an offset/ID into *something*, but cross-checking
  every `u16` field in sections 5/6/7/8 against (a) `msg.hdr`'s 724
  field-A "trigger ID" values and (b) `msg.hdr`'s own computed
  `(page,B)→msg.dbs` byte offsets both came back at **baseline/noise
  level** (0.1–3.8% hit rate, consistent with what the value ranges'
  density alone predicts by chance) — both refuted as the reference
  target, not merely untested.

  > **Correction (this session): this field is a msg.hdr trigger ID after
  > all — the whole-file cross-check above was diluted by mixing it with
  > unrelated case codes.** See the correction block above (section 6's
  > full opcode-table decode): once isolated to specifically case-1 and
  > case-6 sub-entries (not every `u16` in the file indiscriminately), the
  > match rate is 174/174 and 46/46 (100%), not baseline noise. The
  > "0.1-3.8%" figure above was real and correctly computed, but for the
  > wrong population — it measured the whole undifferentiated byte stream,
  > which is dominated by the 82.9% terminator sub-entries and ~15 other
  > case codes whose fields aren't msg.hdr IDs at all.

| Approach | Section(s) | Result | Why it stopped short |
|---|---|---|---|
| Render as plane-major 4bpp bitplane at 5 widths (64–320px) | 2, 3 | pure noise at every width | entropy (2.9–3.3 bits/byte) already well below the confirmed real-image floor (4.0–5.6); this was a confirmatory check, not a new lead |
| Decode through the confirmed `misc.hdr` Huffman tree at every bitstream-start offset | 2 | `ETAONS`-dominated garbage, not English | classic non-Huffman-bits-through-the-tree signature; ruled out, not a genuine text encoding |
| 16-record count vs. known domain counts (14 classes, 8 races, etc.) | 2, 3 | no match to any confirmed Wizardry 6 roster count | doesn't rule out a *different* count-16 domain, just the obvious ones |
| Cross-reference every section 5/6/7/8 `u16` field against `msg.hdr` field-A (724 values) | 5, 6, 7, 8 | 0.1–3.8% hit rate, baseline/noise level | refuted, not merely unconfirmed — the hit rate matches what the value density alone predicts |
| Cross-reference against `msg.hdr`'s own computed `msg.dbs` byte offsets (724 values) | 5, 6, 7, 8 | same baseline/noise result | refuted |
| Offset+length chain invariant (same test that solved `.PIC`'s and `mazedata.ega`'s directories) | 9 | **34/39 active records chain exactly**, zero deviation | **confirmed structure**; target blob (277,826 B) doesn't match any corpus file by size — open |
| ~~`ReadSection(category, index)` call-site census (immediate-value push tracing, `-0x7f9e(a4)`/`-0x7f98(a4)`)~~ **superseded, see below** | all | ~~found ~40 call sites; immediate category values seen were `1`, `9`, `11`, `18`~~ | **wrong function**: `-0x7f9e(a4)` (A4 entry 16) is `CODE+0x9ae`, an unrelated `.PIC`-style NUL-list compositor, not `ReadSection` — conflating the two entries produced the false "11, 18" category values (they belong to entry 16's own unrelated first argument). Left here struck through as a documented dead end |
| Redone: raw-opcode scan for entry-17 only (`4E AC 80 68` = `jsr -0x7f98(a4)`, the *confirmed* `ReadSection`), decode last-pushed-word-before-call as category | all | 47 call sites; literal categories **1, 4, 5, 6, 7, 8, 9** found (covers sections 1/4/5/6/7/8/9 directly); **no literal 2, 3, or 0** | section 0 turned out to use a literal `0` (indistinguishable from background noise at a glance) with a *computed* recordIndex (class byte from `pcfile.dbs`, confirmed at `CODE+0x3eb44`); sections 2/3 use neither a literal category at these 47 sites nor the shared per-slot arrays as a buffer argument — their actual disk-read call site is still not located (see the correction block above) |
| Trace the mazedata-style "find the reader" method for sections 2/3 specifically: locate the per-slot allocator (`CODE+0x4bee`-`0x4c76`) and its `-0x47a4(a4)`-indexed consumers | 2, 3 | **decisive for domain, not for full field layout**: confirmed 14-record (not 16) real capacity, confirmed per-class-selection UI access pattern (§7.1 correction block above), located 3 fields (`+0x1e0`, `+0x1ec` = screen-position offsets; `+0x43a` = a `(row,col)`-indexed bitmask) | refutes the dungeon-geometry hypothesis outright; the *rest* of each 1346/1740-byte record (over 90% of the bytes) remains unmapped, and the initial disk-read call site wasn't found |
| **(prior session)** Disassemble each section's confirmed `ReadSection` call site directly and trace the caller's own consumer logic, record-by-record, instead of a whole-file `u16` cross-reference sweep | 5, 6, 7, 8 | **section 6 fully decoded** (8x4-byte sub-entry opcode table, 45-entry dispatch, case-1/case-6 fields are msg.hdr trigger IDs at 100% match once isolated by case code — refutes the "monster encounter groups" claim); **section 7 fully decoded** (weighted encounter-selection, `RandomRange(100)` confirmed); section 5 refined (2 concrete opaque-forwarding call sites found, still no named-field consumer); section 8 still open (fixed 64-slot resource cache confirmed, content still unconsumed) | succeeded for 6 and 7; the earlier whole-file `u16` cross-reference (row above) was the right test applied to the wrong population — isolating by the section's own internal case/kind code, not just by section, was the fix |
| **(this session)** Traced the cache's `Read()`-length source `-0x74c8(a4)[op]` to its origin instead of re-sweeping for a named-field consumer | 8 | **closed**: `-0x74c8(a4)` is a verbatim in-memory copy of `MASTER.HDR` loaded once at init (`CODE+0x4b08`-`0x4b18`, byte-exact disassembly match); `op` is `ReadSection`'s own `category` argument doubled into a word index (`CODE+0xa9c`, `asl.l #1,d1`); `master.hdr[8]=314` supplies only the byte count for a fully generic, category-agnostic blob read — no category-8-specific reader exists anywhere, so "content varies by what's cached there" is the correct closing answer, not an undiscovered reader | resolved — this closes both `scenario-sections-5678` §8 and `pic-cel-list-mapping`'s last open thread simultaneously (§2.6) |

Verified extractor: `tools/wizardry6/decode-scenario-section9.ts` (writes
`public/assets/wizardry6/amiga/data/scenario-section9-directory.json` —
the confirmed offset/length/tail records and the derived chain order;
sections 2/3/5/6/7/8 have no extractor since nothing was decoded).

Full trace: `docs/wizardry6/amiga/investigations/scenario-messages-monsters.md`
(item/monster tables) and `headers-and-databases.md` (section-table
cross-reference).

### 7.2 `newgame.dbs` (49856 bytes) — CONFIRMED: full field-level reader found

> **Correction (this session, `amiga-disasm` trace, independently
> re-verified byte-exact):** the previous claim that "at *start new game*,
> the game does not parse `NEWGAME.DBS` field-by-field... calls a
> file-copy helper (`CODE+0x553ac`) to duplicate the whole file verbatim"
> was **wrong on both counts**. Re-disassembling `CODE+0x553ac` directly
> shows a `strlen`-scan-then-append shape (scan `(a0)+` for NUL, then copy
> `(a1)+ -> (a0)+` with a max-length bound, then NUL-terminate) — this is
> **`strcat`/`strncat(dest, src, maxlen)`**, not a file-copy routine; it's
> used to append a filename onto an already-built device-prefix path (the
> same role as the confirmed `strcpy` at entry 103, §1.4), never to
> duplicate a file on disk. §1.4's entry-115 row is corrected below. A
> genuine **field-by-field reader/writer function does exist** — found via
> a third method (a word-immediate scan for the `0x19e`=414 boundary
> constant, rather than the string/byte-match approaches tried earlier) —
> and both reads and writes this exact 414-byte-header format on *both*
> `NEWGAME.DBS` and `SAVEGAME.DBS`, gated by a mode parameter. Original
> text below is retained, struck through in spirit (kept for the paths-
> tried record) and superseded by the confirmed reader documented after it.

~~At "start new game", the game does not parse `NEWGAME.DBS` field-by-field
— it just copies the whole file verbatim to `SAVEGAME.DBS`.~~ **The entire
414-byte `scenario.hdr` is still byte-for-byte identical to `newgame.dbs`'s
first 414 bytes (§6.3)** — that observation stands; it's now explained as
the shared header format both files' reader parses, not evidence of a
copy-only relationship.

#### Confirmed reader: `CODE+0x6e22`

`LINK.W A5,#0xef0c` (large local frame), takes a `mode@0x8(a5)` parameter.
Traced backward to this prologue from 3 previously-unexamined `ReadBytes`/
`WriteBytes` call sites using the `0x19e`(414) byte count
(`CODE+0x702e`, `0x13158`, `0x1343a` — distinct from the already-confirmed
`scenario.hdr` load at `CODE+0x48ae`). Mode dispatch at the top:

```
CODE+0x6e72   tst.w   0x8(a5)
CODE+0x6e76   bne.b   0x6e92                 ; mode != 0 -> "load save" path
CODE+0x6e78   pea.l   "NEWGAME.DBS"(pc)      ; string at file offset 0x7426, right before "SAVEGAME.DBS" at 0x7432
CODE+0x6e7c   jsr     -0x7f50(a4)            ; BuildResourcePath, entry 29
CODE+0x6e84   pea.l   -0x222(a5)
CODE+0x6e88   jsr     -0x7d94(a4)            ; strcpy, entry 103
CODE+0x6e8e   bra.w   0x6f92                 ; -> Open(), shared with the mode!=0 path
```

**Full field-level read sequence** (`CODE+0x6e22`-`0x73ac`), traced end to
end:

| Step | `CODE+` | Action | Bytes | File region | Matches |
|---|---|---|---|---|---|
| 1 | `0x7020`-`0x703c` | `Seek(0)` + `ReadBytes(count=0x19e)` into the shared 414-byte header cache `-0x7666(A4)` | 414 | `0x000`-`0x19e` | confirmed shared header, §6.3 |
| 2 | `0x70ee`-`0x71de`, looped `i=0..13` | per-iteration `ReadBytes` + `memmove` (confirmed `memmove` at `CODE+0x55008`) into per-level maze/entity cache arrays, `1346`+`1740` bytes each | `14×3086 = 43,204` | `0x19e`-`0xaa62` | confirmed 14× `scenario.dbs` section-2/3-format record pairs, §4.7/§7.1 — `43204/3086 = 14` exactly, forcing the loop bound |
| 3 | `0x71f2`-`0x72f4` | `ReadBytes(count=0x42)` = **66 bytes**, unpacked into position/region globals (`-0x47a2(A4)`..`-0x4776(A4)`) | 66 | `0xaa62`-`0xaaa4` | **new** — positionally exactly `master.hdr`'s own size (§6.4); on the shipped file this block is **all-zero** |
| 4 | `0x72fa`-`0x7300` | `CMPI.W #1,0x8(a5)` — only `mode==1` continues past this point | — | — | mode gate |
| 5 | `0x7310`-`0x73ac`, looped `i=0..(char count)-1` | `ReadBytes(count=0x1b0=432)` per character, installed via the same 432-byte block-copy pattern `RwRecord` uses | `N×432` | `0xaaa4`-EOF | `pcfile.dbs` record format, §7.3 |

Step 3's `0x42`(66)-byte block lands **exactly** at file offset
`414 + 14×3086 = 43,618 = 0xAA62` — the boundary this session's own task
brief specified as the start of the "still-open" trailer — independently
re-derived here from the confirmed 14-pair structure, not assumed from
the brief.

**Verification (independently re-run, byte-exact):** `newgame.dbs[0xaa62
: 0xaa62+66]` is **all-zero, 66/66 bytes** (a fresh-install "empty
position" state, consistent with the game having no active party yet).
`newgame.dbs[0xaaa4 : EOF]` (6172 bytes) is **99.87% zero — only 8
nonzero bytes total**, at absolute offsets `0xc281/0xc283/0xc285/0xc287`
and an identical repeat 14 bytes later at `0xc28f/0xc291/0xc293/0xc295`
(decoding as two copies of the BE-u16 sequence `127, 117, 7, 1`), ~43
bytes before EOF — plausibly build-tool scratch residue analogous to the
already-documented `H0:`/`F0:` phenomenon (§6.3), not meaningful game
data. This is consistent with step 5's character-record loop legitimately
reading nothing real: a fresh `newgame.dbs` template has zero characters.

**Still open**: the step-5 loop bound (`-0x8(a5)`, the character count)
wasn't traced to its own write site within this function — it's read, not
assigned, in the traced body, so it's set by the caller or an earlier
step not covered this pass (a fixed roster max of 16, matching
`pcfile.dbs`, is the leading candidate but isn't confirmed). Byte
accounting for the reserved region past the 66-byte block doesn't close
to a clean record count either (`6172/432 = 14.29`, not an integer) —
either the region is sized with slack for a max roster rather than an
exact multiple, or a second small header exists before the character-
record area that wasn't located. The genuine on-disk **write** path that
would create a real `SAVEGAME.DBS` from a live game session was not
located this pass (no `SAVEGAME.DBS` exists in the shipped corpus to
cross-check against) — this reader only covers the confirmed **read**
side, which is enough to explain and decode every byte of `newgame.dbs`
itself.

| Approach | Result | Why it stopped short |
|---|---|---|
| Byte-match vs. `scenario.dbs` section 2 onward | 42.2% raw match, but 41.0 pts is shared zero-padding and the non-zero residual is noise-level (1.2%) | **refuted** — superseded; the real relationship (§4.7/§7.1's confirmed maze/entity records) is now understood structurally, not via a coincidental byte-match |
| `pcfile.dbs`'s confirmed 432-byte `RwRecord` stride, flat array over the whole 49,442-byte region | doesn't divide evenly | **refuted** as a flat array over the whole region — but the true format interleaves a 414B header, 14×3086B maze/entity pairs, a 66B position block, and *then* (only for a populated save) a run of 432B character records, exactly as the confirmed reader shows |
| Second `"SAVEGAME.DBS"` string reference (`CODE+0x13774`) as a possible real loader | leads to party-roster window/UI code, not a file-read call sequence | still not a loader at this occurrence — the real reader was found via the word-immediate-scan method instead, see above |
| **(this session)** Word-immediate scan for the `0x19e`(414) boundary constant across all `ReadBytes`/`WriteBytes` call sites | **found the reader** — `CODE+0x6e22`, 3 previously-unexamined call sites | succeeded |
| **(this session)** Re-disassembled the previously-cited "file-copy helper" (`CODE+0x553ac`) directly instead of trusting the earlier label | **refuted the label** — it's `strcat`/`strncat`, not a file copier | corrects §1.4 |

Verified extractor: none yet for this format — `decode-headers.ts` covers
`pcfile.dbs`/`scenario.hdr` only; a `newgame.dbs`-specific extractor
exposing the 4-part layout above (header/maze-entity-pairs/position-block/
character-records) is committed follow-up work, not attempted this pass.

Full trace: `docs/wizardry6/amiga/investigations/headers-and-databases.md`.

### 7.3 `pcfile.dbs` (6936 bytes) — confirmed (overturns the earlier 289×24 hypothesis)

**The earlier `6936/289 = 24` hypothesis was wrong.** Real structure,
confirmed via disassembly and byte-exact against the shipped file:

```
pcfile.dbs = 24-byte header + 16 × 432-byte character records
             24 + 16*432 = 6936  (exact)
```

**Header (24 bytes) — confirmed**, read via `ReadFileBytes("PCFILE.DBS",
buf, 0x18)`:

| Offset | Size | Field | Shipped value |
|---|---|---|---|
| +0 | 2 | `recordSize` | `0x01B0` = 432 |
| +2 | 2 | `recordCount` | `0x0010` = 16 |
| +4 | 4 | `baseOffset` | `0x00000018` = 24 |
| +8 | 16 | `usedFlags[16]` | all zero (fresh install) |

`recordSize` is genuinely consumed as a seek stride (`MULS.W
-0x71ca(a4),d0`), `recordCount` is the loop bound in 3 separate
roster-scan functions, `usedFlags[16]` gates "skip empty slot" in all of
them, and `baseOffset` is added to `index*recordSize` before every seek —
all four confirmed via disassembly, not inferred. This **overturns** the
earlier "record 0 is a header, real roster is 23 slots" reading: the 4
non-zero bytes previously read as "record 0" (`01 b0 00 10 00 00 00 18`)
are precisely this header's populated fields; the real roster is exactly
**16 slots**, not 23 or 24.

**Character record (432 bytes) — read/write mechanism confirmed, most
fields open.** A shared `RwRecord(buffer, index, mode)` function (2
byte-identical compiled copies) does `Seek(fh, index*recordSize +
baseOffset); mode==0 ? Read : Write; Close`. Record size independently
re-confirmed a second way via an in-memory roster block-copy loop
(`MULS.W #0x1B0,d0`, 108 longwords × 4 = 432).

Fields located:

| Record offset | Type | Evidence |
|---|---|---|
| `+0` | NUL-terminated ASCII name | `strcmp`-style compare and `strcpy` both use this field as a string, two independent call sites agree |
| `+412` | byte | **confirmed** — sole argument to the `WPORT` portrait-loading routine (§5.3), re-confirmed this session at `CODE+0x73f6`-`0x7402`: `field412/14` selects the `WPORT` file, `field412%14` the in-file portrait index, matching §5.3's confirmed `÷14` mechanism |
| `+413` | byte | small enum, range ≤7 (`CMPI.B #7` at `CODE+0x1d40e`) |
| `+414` | byte | icon-index offset (`+8` then used, `CODE+0xc7ee`) |
| `+415` | byte | **confirmed — `class` (0-13)** — this session traced the doc's own "known lead" (`CODE+0x3eb44`-`0x3eb5e`, the section-0 class-XP-table call site) precisely: `-0x4463(A4)` (used there as the class-byte source) resolves to `-0x4602(A4)+415` — i.e. the *same* roster array already confirmed for `+0`, accessed through a pointer pre-offset by exactly 415, not a separate structure. 75 total call sites for `-0x4463(A4)` were found (`MULS.W #0x1B0` scan); the byte is repeatedly `CMPI.B`'d against literals `3, 4, 6, 0xC, 0xD` — all valid values in the confirmed 0-13/14-class range (§7.1, §5.2) |
| `+416`-`+431` | bytes | write-path setters (`+420`/`+421` are written *from* caller-supplied bytes during what reads like character-creation) — see the broader field map below; `+417` is a strong race-byte candidate (doubled and indexed into a word table, structurally parallel to `+415`'s class lookup) |
| `+1..411` | — | mostly open — see the broader field map below for the ~70 offsets with *some* disassembly evidence; large stretches show no access via the scan method used this pass |

**Broader field map (this session, `amiga-disasm` trace) — offsets/access
mechanics confirmed, semantic labels hypothesis unless noted.** A
systematic scan of every `MULS.W #0x1B0,Dn` (record-stride multiply,
1441 raw hits) immediately followed by `LEA.L d16(A4),An` found **70
distinct record offsets** genuinely touched by code (out of 432 total —
most of the record showed no access via this specific addressing idiom,
meaning either a different addressing form was used or the bytes are
genuinely unused padding; not conclusively distinguished this pass):

> **Re-audit note (this session): this census's raw hit count was
> partly coverage-limited — re-running it is flagged as future work, not
> completed this pass.** Re-counting `MULS #$01b0,Dn` occurrences against
> the now-99.47%-covered `Bane.asm` gives **1631** raw hits, not 1441 (a
> 13% increase) — unlike the item-catalog census (which used raw capstone
> and was already coverage-independent), this one's original count came
> from a text-based sweep that the old `Bane.cnf` gap would have
> truncated, so the extra ~190 sites are plausibly real, previously
> invisible call sites. A full re-derivation of the 70-offset field map
> against the new sites would need the same non-trivial per-site
> base-register tracing this session did for the monster stat block
> (the addressing shape varies enough between call sites — `LEA`-then-
> `ADDA` vs `MOVEA`-then-`ADDA`, indexed-direct forms, etc. — that a
> simple regex census under-counts badly, confirmed by a scripted attempt
> this session that found legitimate MULS sites but 0 attributable
> offsets). Deferred to a future dedicated pass rather than rushed;
> `pcfile-character-fields` is correctly left open in `TODO.md`, not
> closed by this note.

| Offset(s) | Notes |
|---|---|
| `+8` | fed to a confirmed signed-long-divide primitive with divisor 365 — hypothesis: age-in-days |
| `+12`, `+20` | both routed through the same value/bound-formatter pair — hypothesis: a stat's current/max pair |
| `+16` | `ADDQ.L #1` on every roster slot in one loop — a running counter, not a per-character stat |
| `+24,+26,+28,+30` | ~~4 consecutive words pushed as plain args together — candidate attribute block (STR/IQ/PIE/VIT-shaped)~~ **Correction (2026-08-03, `re-codebreaker`): not an attribute block.** These are **two current/max pairs**: `+24`=current HP, `+26`=max HP, `+28`=current stamina, `+30`=max stamina. Confirmed by the party-side combat-participant populator at `CODE+0x1642c`-`0x1649e`, which copies them into the same struct fields (`member[+2]/[+4]/[+6]/[+8]`) that `LoadMonsterIntoSlot` fills from the monster catalog's HP/stamina dice specs — and `member[+2]` is the field that damage subtracts from, death tests (`TST.W 2(A1); BGT`, `CODE+0x2357c`) and healing clamps against `member[+4]`. See §7.1's "HP found / alignment refuted" note |
| `+36` | word, copied into combat-participant `member[+0]`; the monster-side counterpart of that field is `record[122]` (the HP dice *count*) — character level / hit-dice proxy, hypothesis |
| `+98` | 10-byte character name — `strcpy` into `member[+14]` at `CODE+0x164e4` (distinct from `+0`'s name string) |
| `+414` | **gender** (confirmed via the monster-catalog mirror `+0xd6`, §7.1) — supersedes "icon-index offset"; the icon it selects is the character-sheet gender symbol |
| `+417` | copied into `member[+34]`, a 0-3 status/state code (`CMPI.B #3,34(A1)` gates, e.g. `CODE+0x16c0c`) — **weakens the "race byte" guess below**; reads as a status field |
| `+32` | multiplied by 100 — percentage-style stat |
| `+34` | `DIVS.W #10` — 2-digit display value |
| `+240` | per-character accumulating counter |
| `+253,+269,+292-299,+317,+324` | boolean-shaped `TST.B`/`CMPI.B #1` tests; the `+292/293/294/298/299` cluster shares an identical shape — equip-slot-boolean candidate |
| `+255,+271,+392,+408` | all 4 routed through the same bit-test/flag-array primitive (`CODE+0x2958`, the confirmed `TestBit`) — 4 parallel small bit-array fields, spell-known bitmask is a plausible fit |
| `+272,+273` | both compared against sentinel `0xFF` — two byte-range enum/slot fields; **too narrow a range to be raw 0-499 item-catalog indices**, so probably not a direct inventory-slot array |
| `+290,+338` | both routed through the confirmed `memmove` (`CODE+0x55008`) — copy-source fields, purpose untraced |
| `+304,+305,+427` | **directly relevant to §2.6's still-open combat-slot-struct question** — copied into the per-combat-slot struct at `-0x3bbe(A4)[slot]+0x88/+0x89/+0xd3` (`CODE+0x2903e`-`0x290e8`); a partial, not full, answer to "what populates that struct" |
| `+306,+316,+320,+321,+323,+333,+337` | 6 of these 7 share an identical "byte value shifted into a word's high half" idiom — homogeneous array, possibly per-slot quality/bonus values |
| `+417` | doubled and indexed into a word table at `-0x778a(A4)`, structurally parallel to `+415`'s class-lookup shape — strong race-byte candidate |
| `+420,+421` | **write path**: set from caller-supplied bytes (not read from the record) — gender/alignment setter candidates during character creation |

An explicit targeted search for `MULS.W #0x4A` (74, the item-catalog
record stride) found **zero hits** anywhere in the CODE hunk — no
inventory array indexes into the item catalog via a literal multiply in
this scan's search space, so an inventory field (if present) either uses
a different addressing idiom or wasn't found this pass.

> **Session note (2026-08-03, `amiga-disasm` per-function trace): ~25
> offsets resolved or revised, 2 dense consumer functions found.** Rather
> than re-running the failed universal-regex census, this pass grepped
> `Bane.asm` for each target offset's A4 displacement
> (`displacement = offset - 0x4602`, consistent with the confirmed `+415`
> example, `-0x4463(A4) = -0x4602+415`) and read the full body of every
> function that touched it. Two functions did most of the work:
> `CODE+0x77da` (draws one roster-list summary line, 2-column/8-row
> layout) and `CODE+0x31d40`-`0x325xx` (populates the full character
> "Info" requester screen, several sub-labels `LAB_12E4`/`LAB_12E7`/
> `LAB_12DB`/`LAB_12D9`), plus `CODE+0x1ec26` (encumbrance-tier combat
> penalty calculator) and `CODE+0x1d1a6` (a large frame function scanning
> equip-gated bit/index fields).
>
> | Offset(s) | Finding | Confidence |
> |---|---|---|
> | `+8` | **Upgraded to rendered**: divided by 365 (`CODE+0x31e8a`, same divisor already noted) and the *result is actually displayed* on the Info screen next to the class/title area — confirms this is a real displayed field, not just an orphaned divide. Age-in-days label unchanged | rendered |
> | `+12` | **Confirmed: Experience Points.** `CODE+0x3ebda` compares it (`CMP.L`) against a computed "XP for next level" threshold built from the per-class XP table (§7.1's section-0 tables) indexed by `level-1`; `CODE+0x320a0` displays it as a raw 32-bit number on the Info screen (widget `0xca`) | **confirmed** |
> | `+16` | Displayed as a raw 32-bit number on the Info screen (widget `0xcb`, `CODE+0x320e8`), same display primitive as XP, positioned right after it — a genuine per-character LONG field, distinct from the pre-existing "roster-wide `ADDQ.L` counter" note (that's a separate maintenance loop, not in conflict) | rendered, semantics still hypothesis |
> | `+20` | **Revises the doc's old "`+12,+20` current/max pair" pairing** — `+20` is not paired with `+12`; it's an independent raw-number LONG display (widget `0xd7`, `CODE+0x3243e`), same primitive as `+16`. Gold is the obvious Wizardry-6 candidate for one of `+16`/`+20`, unconfirmed which | rendered, hypothesis semantics |
> | `+24,+26` | **New current/max pair** (not the old STR/IQ/PIE/VIT reading — see below): `CODE+0x77b0` renders `(cur=+24,max=+26)` as a 3-glyph bar (`cur*100/max`, `/10`, clamped 0-10) on the roster line; `CODE+0x31b18`/`0x321da` display both as raw numbers on the Info screen. HP was the natural fit here, and **is now independently confirmed** by the `re-codebreaker` escalation's combat-participant cross-reference (`CODE+0x1642c`-`0x1649e`, see the table row above and §7.1's "HP found" note) | **confirmed** (upgraded from rendered by the later cross-reference above) |
> | `+28,+30` | A second, differently-rendered current/max pair — same bar mechanic (`CODE+0x77f8`) but the Info screen shows it as a **percentage** (`cur*100/max`, min-clamped to 1 when `cur>0`) rather than raw numbers, a genuinely distinct UI treatment from `+24/+26`. Stamina was the plausible fit here, and **is now independently confirmed** by the same cross-reference (§7.1's "HP found" note) | **confirmed** (upgraded from rendered by the later cross-reference above) |
> | `+32,+34` | **Confirmed: current/max carry weight (encumbrance).** `CODE+0x1ec26` computes `(+32*100)/+34`, compares against literal thresholds 50/66, and clamps combat-penalty fields `+425`/`+426` (max 3) accordingly — classic tiered-encumbrance mechanic. `+32` itself is computed by `CODE+0x31bc8`, which sums `weight[slot]*max(qty[slot],1)` over the new `+64..+71` per-slot array (below), bounded by `+428`/`+429`. **Corrects** the old "`+32`: percentage stat" / "`+34`: `DIVS #10` display-divide" notes — `+34` is the capacity divisor in this ratio, not an independent display transform | **confirmed** |
> | `+36` | **Confirmed: character level.** Compared against literal `0x10` (16, Wizardry 6's real level cap) at `CODE+0x3eb6a` to pick linear-vs-table XP lookup; displayed raw on the Info screen (widget `0x09`, `CODE+0x31fd0`) next to the class-name widget | **confirmed** |
> | `+38` | Displayed as a raw number on the Info screen immediately adjacent to level (`CODE+0x31f88`) — position suggests a level/age-adjacent stat, not resolved further | rendered, hypothesis semantics |
> | `+40`-`+63` (**new offsets**, not in the original 70) | A 6-row x (word+word) array, looped explicitly 6x (`CODE+0x31c72`-`0x31d40`), each row = word at `+40+i*4` and word at `+42+i*4`, labeled via a 6-entry word table at `-0x7cac(A4)` and drawn as 6 labeled Info-screen rows. **Recommended to supersede** the old `+24,+26,+28,+30` "STR/IQ/PIE/VIT attribute block" guess — those 4 offsets are now much better explained as two current/max bars (above), and this 6-row block is the much stronger structural match for Wizardry 6's 6 core attributes (STR/IQ/PIE/VIT/AGI/LUCK), each with a value + modifier pair | rendered |
> | `+64`-`+71`+ (**new offsets**) | 8-byte-stride per-equip-slot array, read by `CODE+0x31b44`: `+66`=word (cached item weight, summed into `+32` above — **not** recomputed live from the item catalog), `+68`=byte (item type/category, checked against literal 1/2/3), `+70`=byte (quantity, min-clamped to 1). Slot count driven by new offsets `+428`/`+429` (two sub-ranges). **Explains** the doc's earlier "`MULS.W #0x4A` [item-catalog stride] census found zero hits" — per-character equip weight is cached at record-write time, not re-looked-up from the catalog at display time, so that specific negative result was never going to find an inventory array | confirmed access mechanics, hypothesis exact semantics |
> | `+272,+273` | **Confirmed: equip-slot indices** (not item-catalog indices, matching the doc's existing "too narrow a range" observation) — used directly (`x8`) as an index into the new `+64..+71` slot array, read at `CODE+0x7a64` (roster status icons) and `CODE+0x1ddc2`/`0x1d866` (item-type gate, tests the indexed slot's `+68` type byte against 2/3) | **confirmed** |
> | `+290`-`+299` (10-byte array) | **Revises** the old "equip-slot-boolean candidate" reading. `CODE+0x7982` does a max-severity scan over all 10 bytes against a word table at `-0x777e(A4)`, rendered as status icons on the roster line; `CODE+0x3235e`-`0x323de` independently tests `+295`/`+296`/`+298`/`+299` against 3 more icon-lookup tables on the Info screen. The icon-rendering behaviour fits **status/condition ailments** (poisoned/paralyzed/etc.) much better than equipment-slot booleans | rendered |
> | `+408` | **Revises** the old "spell-known bitmask" grouping for this specific offset. 3 `TestBit` calls (bits 0/1/2) at `CODE+0x31ed6`-`0x31f10`; setting bit 0 or 1 skips a whole block of Info-screen widget-drawing code. Reads as a per-character **display-capability** bitfield (e.g. "hide the SP field for non-casters", plausibly class-derived) rather than a spell-known table | rendered |
> | `+255` | `TestBit` loop (bound ~5) inside `CODE+0x1d1a6`, cross-gated against `+272`'s indexed equip-slot type (`==2`/`==3`, weapon/shield). Leans toward a class special-combat-technique-availability table (weapon-type-gated) rather than "spell known" | hypothesis, partial revision of the old grouping |
> | `+271` | Scanned via helper `LAB_0C00` (up to 10 iterations, early-exit on state `==4`), gated by equipped-item type `==2` and a `+269` prerequisite flag. Spellbook/ability scan remains plausible (10 iterations fits "10 possible entries") but unconfirmed | hypothesis, well-evidenced |
> | `+269` | Confirmed as a simple boolean gate for `+271`'s scan — no new semantic label beyond that | hypothesis (gate role confirmed) |
> | `+417` | Same doubled-index-into-word-table mechanism as before, now independently found at **2** call sites (`CODE+0x77ea`, `CODE+0x322c0`), both further modified by `+292`/`+293` bump-by-1/2 logic — structural parallel to `+415`'s class lookup strengthened, but the target table's own contents weren't decoded, so "race" is still inferred, not proven | well-evidenced hypothesis (not upgraded to confirmed) |
> | `+425,+426` (**new offsets**) | Combat penalty fields (to-hit/AC-shaped), clamped to max 3, set by the `+32/+34` encumbrance-tier logic in `CODE+0x1ec26` | rendered |
> | `+428,+429` (**new offsets**) | Loop bounds for the two inventory-slot sub-ranges summed into `+32`'s weight total — equipped-item-count / inventory-item-count candidates | confirmed access mechanics, hypothesis semantics |
>
> **Not independently re-verified this pass** (left exactly as the
> existing table describes): `+240`, `+253`, `+304,+305,+427`,
> `+306,+316,+320,+321,+323,+333,+337`, `+420,+421`. `+392` was only
> re-located (13 call sites, same `TestBit` shape as `+255`/`+271`/`+408`)
> but its consuming function body wasn't read this pass.
>
> Net: **2 offsets newly confirmed** (`+12`=XP, `+36`=level), **1 pair
> newly confirmed** (`+32,+34`=carry weight/capacity), **~19 more**
> upgraded from bare access-site to rendered/well-evidenced semantics or
> newly discovered (`+40`-`+63` attribute block, `+64`-`+71` equip-slot
> array, `+425,+426,+428,+429`), and **1 old hypothesis explicitly
> revised** (`+24,+26,+28,+30` reinterpreted as two stat-bar pairs, not a
> 4-word attribute block — the attribute block is now `+40`-`+63`).
> `pcfile-character-fields` remains open (large remaining span
> unresolved, e.g. most of `+72`-`+239`, `+300`-`+391`,`+393`-`+407`,
> `+409`-`+411`,`+413,+414`,`+422`-`+424`,`+430,+431`), but materially
> advanced.

**Caveat on all of the above except `+0`/`+412`/`+415`**: these are
disassembly-confirmed *access sites* (real reads/writes at these exact
byte offsets), not confirmed *semantics* — and they could not be
cross-checked against real character data, since **all 16 shipped
`pcfile.dbs` records are empty** (fresh-install state). Treat the
non-`+0`/`+412`/`+415` rows as hypothesis, however well-evidenced the
access pattern.

Verified extractor: `tools/wizardry6/decode-headers.ts` (writes
`public/assets/wizardry6/amiga/data/headers.json`).

Full trace: `docs/wizardry6/amiga/investigations/headers-and-databases.md`.

### 7.4 `msg.dbs` (81920 bytes) — confirmed, 724/724 messages decoded

**Solved.** `msg.dbs` is exactly 80 pages of 1024 bytes
(`81920 = 80×1024`). Each message lives at
`msg.dbs[(msg.hdr field C & 0xFF)*1024 + msg.hdr field B]`:

| Offset | Size | Field |
|---|---|---|
| +0 | 1 | decoded character count `L` |
| +1 | 1 | compressed byte count (not needed to decode — the tree walk self-terminates on `L`) |
| +2.. | | Huffman bitstream (`misc.hdr` tree, MSB-first, `CODE+0x2a8a`-`0x2ad0`), walked once per output byte until `L` bytes produced |

This **corrects §6.2's framing**: field `A` (previously labelled
"confirmed" as the byte offset) is actually a separate binary-search
lookup key (`CODE+0x730`, matches query values against `[A[mid],
A[mid]+C_hi[mid]]` where `C_hi` is field `C`'s *high* byte) — almost
certainly mapping a much larger in-game "message trigger ID" space onto
the 724 stored records. It's monotonic and in-bounds (as originally
observed) but is not the msg.dbs offset. The real position uses field
`B` as a **page-relative** offset (always < 1024) and field `C`'s *low*
byte as the page number (0-79) — `B` alone looked plausible for
low-page-number records only because it's coincidentally close to a flat
offset early in the file, which is what caused the original "doesn't
consistently equal `A[i+1]-A[i]`" confusion.

**Verified**: 724/724 unique `(page,offset)` positions (zero collisions);
`C&0xFF` spans exactly 0-79 (msg.dbs's real page count, no gaps); Huffman
tree structural sanity check (node 0 = both children internal, shortest
codes resolve to `E,T,A,O,N,S` in classic English letter-frequency
order); 90.7% printable-ASCII across all decoded output; dozens of full
legible sentences recovered (`"XORPHITUS IS A POWERFUL WIZARD..."`,
`"YOU ARE NOT ELIGIBLE"`, `"APPROACHING THE GATE WITH..."`,
`"PILES OF ROTTED FURNITURE"`).

Open (doesn't block extraction): field `A`'s exact real-world meaning
(what ID space it indexes); the precise mechanics of a
position-computing loop at `CODE+0x8c4`-`0x90c` that a live in-game
lookup uses (this extractor's direct offset formula was confirmed
independently and doesn't depend on that loop); a handful of records
(e.g. index 133) decode to pure control-byte runs rather than text —
very likely legitimate non-text/reserved slots, not decode failures.

Verified extractor: `tools/wizardry6/decode-msg-text.ts` (writes
`public/assets/wizardry6/amiga/data/messages.json`, 724 messages with
`index, a, b, c, page, offset, text, decodedLength, compressedLength`).

Full trace: `docs/wizardry6/amiga/investigations/scenario-messages-monsters.md`.

---

## 8. `.snd` sound effects (35 files)

**Rendered — high confidence, not yet confirmed by ear.** No IFF/8SVX
magic (`FORM`/`8SVX`) at the start of any sampled file. Byte-value
histograms cluster tightly around `0x80` (128) — the DC-centre/silence
value for **unsigned 8-bit PCM** — e.g. `sound02.snd` opens with 20
consecutive `0x80`/`0x86` bytes (a held near-silent tone); whole-file
means across sampled files are 132–138, close to 128; local byte runs
look like smooth waveform steps (`86 86 86...8e`), not compressed-stream
noise. No sample-rate field exists anywhere in the 35 files (headerless);
the true playback rate is **unconfirmed** — the conversion tool defaults
to 8000 Hz as a common period-effects rate for Paula-chip games, which is
a guess, not a verified value.

Verified extractor: `tools/wizardry6/decode-sound.ts` (writes 35 WAV
files to `public/assets/wizardry6/amiga/audio/`, raw PCM bytes
copied verbatim into a standard WAV container).

---

## 9. Confidence summary

| Format | Status | Evidence |
|---|---|---|
| `Bane` hunk structure | confirmed | disassembly, structural walk accounts for 100% of file |
| `Bane` Huffman decoder | confirmed | disassembly matches `misc.hdr`'s byte shape exactly |
| `Bane` A4 jump-table entries (incl. `BuildResourcePath`/`Open`/`Seek`/`Read`/`Write`/`Close`/`strcmp`/`strcpy`/file-copy) | confirmed | disassembly, cross-checked against multiple independent call sites; corrects an earlier "open file by name" mislabel |
| `misc.hdr` | confirmed | matches decoder above |
| `.EGA` full-screen images (3 files) — layout | confirmed | legible "BANE OF COSMIC FORGE" title text; per-plane `0x2000`-byte stride (§3.3) |
| `.EGA` full-screen images — palette | confirmed | sole `LoadRGB4`/`OpenScreen` call in the whole binary, shared with `.PIC` |
| `.EGA` full-screen images — per-pixel colour accuracy | **confirmed** | 0 mismatches / 384,000 pixels (3 screens × 2 platforms) against the independently-decoded `.t16` ground truth, after fixing the §3.3 plane-stride bug; residual `GRAVEYRD.EGA` sky speckle proven genuine (byte-identical to ground truth), not a decode artifact |
| `WFONT0.EGA` | confirmed | fully legible rendered ASCII font |
| `WFONT1-4.EGA` | confirmed | disassembly-traced loader + legible class labels/UI icons/full font/equipment icons |
| `WPORT1-3.EGA` | confirmed | disassembly-traced loader (runtime filename-digit patching) + 42/42 recognisable portrait icons |
| `.PIC` directory (60 files) | confirmed | byte-exact offset-partition invariant, zero deviation; 26-byte record + 20-byte tile mask traced in code (§2.1) |
| `.PIC` cel length formula | confirmed | `32*popcount(mask)` exact on 731/731 cels, plus mask-tail-zero invariant (§2.2) |
| `.PIC` tile/pixel layout | confirmed | drawer at `CODE+0x35e6` traced end to end; legible `CREDITS.PIC` text + recognisable monster portraits (§2.3, §2.5) |
| `.PIC` palette | confirmed | 16 12-bit words at `CODE+0x17b6`, loaded via `LoadRGB4(vp,tbl,16)`; sole palette-load site in the binary (§2.4, §3.1) |
| `.PIC` file → monster mapping | confirmed | record offset +209, 2 independent derivations (category-grouping statistics + disassembly trace to the `MON%02d.PIC` loader) + 5/5 species-correct visual spot-renders (§2.6) |
| `.PIC` cel-index-list → monster mapping (which cel(s) *within* the file) | open | the per-combat-slot struct's writer (`CODE+0x14ce2`, `strcpy`-based) and its 3-level caller chain are now confirmed; both of its own data-source paths bottom out in 3 separate runtime side tables, not the monster record — one level deeper than before, still not closed (§2.6) |
| `mazedata.ega` | confirmed | disassembly-traced loader (game's own size-formula matches the structural derivation exactly); 153/153 records render as coherent dungeon art, zero noise |
| `mazedata.ega` compose-list field semantics | **confirmed** | consumer located and traced: `DrawMazePiece` at `CODE+0x3d72` (50 call sites) reads all 5 fields directly; 5 renderer-implied structural invariants hold with zero deviation across all 317 drawn records; a faithful port executing the game's own `CODE+0x632c` call sequence composes a complete, correct first-person corridor view. Two earlier field assignments (`+0`=depthGroup, `+1`=dirIndex/`0xFF` sentinel) are **refuted** — see §4.4's correction block |
| `DrawMazePiece` call-graph / per-cell wall-type-code source | confirmed | `CODE+0x9b58`'s baseIndex arguments are computed by 3 sibling evaluator functions (`CODE+0x9202`/`0x969a`/`0x9876`), not by `9b58` or its own callees — reads real per-cell data from `scenario.dbs` section 2 (§4.6, §4.7) |
| `scenario.dbs` sections 2/3 as dungeon maze geometry | **confirmed** | 14 per-level maze records (section 2) + companion entity table (section 3); 13-field record partition exact; region-placement invariant 0 overlaps/10,752 placements; byte-exact cross-platform match vs. DOS release (0/17,464 geometry bytes differ) and vs. `newgame.dbs` (0/43,204 bytes differ); rendered dungeon maps recognisable in all 14 levels (§4.7) — overturns this doc's own earlier "per-class UI data, refutes dungeon-geometry hypothesis" conclusion (§7.1's correction block) |
| `mazedata.ega` directory runtime representation | confirmed | disassembly-confirmed in-place fixup (`CODE+0x3cf6`-`0x3d10`) converts each `offset` field from a file-relative byte offset to an absolute runtime pointer immediately after load; on-disk format (§4.2's table) is unaffected |
| `msg.hdr` | confirmed | `(C&0xFF)*1024+B` gives 724/724 unique in-bounds positions; corrects the earlier field-`A`-as-offset reading |
| `msg.dbs` message text | confirmed | 724/724 messages decoded, 90.7% printable ASCII, dozens of full legible sentences |
| `scenario.dbs` — section table (10 sections) | confirmed | `master.hdr`/`disk.hdr` cross-file byte-exact divisor match, 10/10 sections |
| `scenario.dbs` section 0 (class XP tables) | confirmed (structural) | round-decimal monotonic sequences, count matches 14 known classes |
| `scenario.dbs` section 1 (item catalog) | confirmed (structure/names/price/damage-dice/class+race+gender restriction masks/category enum), hypothesis-with-traced-consumer (`+24-27`,`+33-45`,`+46-53`,`+61`,`+64-68`,`+69`,`+70-72`), genuinely open (`+31-32`,`+73`) | 500×74-byte records, byte-exact `disk.hdr` cross-reference, legible weapon/armor names; class mask (`+54-55`) confirmed with a live equip-time enforcement site; race mask (`+56-57`) confirmed via disassembly + independently-converging statistical bit/name analysis; item-category enum (`+60`) confirmed across all 452 named records; remaining gaps narrowed from 32 bytes to 3 this session via a new consumer function (`CODE+0x3bf3c`-`0x3c220`) |
| `scenario.dbs` section 4 (monster catalog) | confirmed (structure/names/XP/HP/stamina/number-appearing/AC-block/resistances/gender/level), alignment refuted (game has no such system), open (3 unmapped 16-byte sub-records, a handful of scattered bytes) | 250×222-byte records, byte-exact `disk.hdr` cross-reference, legible bestiary names; `+0x74`(number appearing), `+0x78`(**HP**), `+0x7c`(stamina), `+0x86-0x89`(attributes), `+0x95-0xa1`(13 named resistances), `+0xa8/+0xaa`(%cast/%special), `+0xbe-0xc5`(full AC block), `+0xd6`(gender), `+0xd4`(level tier) all confirmed via disassembly + a cross-platform BE/LE endian oracle + the published Zimlab bestiary (19/19, 13/13, 80/80, 26/26, 13/13, 9/9 exact matches); alignment closed as nonexistent (no alignment enumeration anywhere in a 642-message full `msg.dbs` re-decode, no alignment control in the Cosmic Forge community editor) |
| `scenario.dbs` section 9 | **confirmed** | `SOUNDnn.SND` length/index directory — 34/39 active records chain exactly (same invariant as `.PIC`/`mazedata.ega`'s directories), 35/35 record `length` fields match real `.snd` file sizes byte-exact, sum = `0x43b42` exact; `offset` field confirmed vestigial (never read), `Seek` is hardcoded to 0 |
| `scenario.dbs` section 2 (dungeon maze levels) | **confirmed** (geometry structure + region placement), rendered (wall-value/feature-code meaning) | 14×1346-byte per-level records, 13-field partition exact, region-placement invariant 0/10,752 overlaps, byte-exact vs. DOS release and `newgame.dbs` (§4.7) — overturns this doc's own earlier "per-class UI data" finding, see §7.1's correction block |
| `scenario.dbs` section 3 (per-level entity table) | confirmed (structure, lookup mechanism, most fields), open (kind-byte dispatch, `+0x000`/`+0x120`) | 144-entry SoA table, exact partition to 1740 bytes; `FindEntitySlot` (A4 entry 64, `CODE+0x8fe6`) confirmed and traced to 7 callers, mostly in the combat/encounter address range; `+0x3f0`/`+0x480`/`+0x510` confirmed as x/y/region keys (value ranges 0-7/0-7/0-11 match the confirmed region geometry); `+0x6c0` (new) confirmed as a per-region entity-start-index table, independently re-verified byte-exact; `+0x360` confirmed as a multi-valued kind byte (not boolean); `+0x5a0` confirmed as a per-level "already triggered" bit index (§4.7) |
| `scenario.dbs` section 6 | **confirmed** | 400×32-byte scripted event/opcode table, 8×4-byte sub-entries per record, 45-entry case-code jump table; message-display cases verified 100% against `msg.hdr` (174/174, 46/46); records confirmed callable as sub-scripts (recursion into the section's own top-level processor at 3 distinct case codes) |
| `scenario.dbs` section 7 | **confirmed** | 200×40-byte weighted treasure/reward table (corrects an earlier "encounter-selection" label); both consumer functions feed picks into `ReadSection(category=1)` = the item catalog, not the monster catalog; kind values 0/1/2/4 = padding/gold-roll/item-pick/flat-bonus, verified across all 1200 sub-entries |
| `scenario.dbs` section 5 | open | boundaries/stride known exactly (§6.4); 2 opaque forwarding call sites confirmed, no named field consumer; new lead this session (its cached buffer is reused live by one of section 6's message-display cases, suggesting a small sub-resource for message-box rendering), untraced further |
| `.snd` PCM | rendered | byte-histogram/DC-offset evidence, not heard |
| `pcfile.dbs` | confirmed (header/roster mechanism/name/class/portrait/XP/level/carry-weight), open (large spans of the 432B record still hypothesis-only or undetermined) | 24-byte header + 16×432-byte records, disassembly-traced `RwRecord`; `+415`=class, `+412`=WPORT portrait, `+12`=XP, `+36`=level, `+32`/`+34`=current/max carry weight all confirmed; ~25 more offsets upgraded to rendered/well-evidenced this session via per-function tracing, overturns the earlier 289×24 hypothesis |
| `master.hdr` | confirmed | 10/10-section byte-exact divisor cross-check against `disk.hdr`, disassembly-confirmed `ReadSection` reader; categories 10-19 confirmed vestigial (fixed alias into `disk.hdr`'s own buffer + `master.hdr`'s own count sub-array, never issued by any of 47 confirmed call sites) |
| `disk.hdr` | confirmed | 44-byte header (corrects an earlier 24-byte miscount) + 5 disassembly-confirmed (but content-trivial) identity lookup tables |
| `scenario.hdr` | confirmed (load mechanism, trailing flags, `H0:`/`F0:` explanation); hypothesis (flag semantics) | disassembly of `ReadFileBytes` call site + whole-binary displacement scan |
| `newgame.dbs` | **confirmed** | full field-level reader found and traced this session (`CODE+0x6e22`): 414B shared header (§6.3) + 14×3086B `scenario.dbs`-section-2/3-format maze/entity pairs (§4.7/§7.1) + 66B position block (empty/zero on the shipped fresh-install file) + a conditional `pcfile.dbs`-format character-record run (§7.3); corrects the earlier "whole-file opaque copy" claim (the previously-cited "file-copy helper" is actually `strcat`, §1.4 correction) |

See also `docs/wizardry6/amiga/investigations/` for the full disassembly
traces and paths-tried tables behind each row above.

# Wizardry 6: Bane of the Cosmic Forge — DOS/EGA data format

Status: **first pass**. Source data: `data/wizardry6/dosega/wiz6/` (162
files — MS-DOS MZ executables `wroot.exe`/`winstall.exe`, 11 `.ovr` overlay
modules, 4 video `.drv` drivers, 60 `.pic` sprite files, 12 `.ega`/12 `.cga`/
12 `.t16` platform-variant image banks, 5 `.hdr`, 4 `.dbs`, 35 `.snd`, 2
`.bat` launchers, `moslowiz.com` (third-party, licensed, **not analysed** —
its license explicitly prohibits reverse engineering), `mo_info.txt`,
`wizardry6.pif`).

This release shares its core data-file formats with the already-solved
Amiga port (`docs/wizardry6/amiga/data-structure.md` — read that document
first; this one only records what differs). The two ports are built from
the same underlying engine: every same-named `.hdr`/`.dbs` file is
byte-identical in *size* between the two corpora, and — critically — every
multi-byte numeric field in those files is simply stored **little-endian
on DOS / big-endian on Amiga**, with the record layouts otherwise
unchanged. Plain bitmap/tile pixel data (no multi-byte fields) is often
**byte-identical** between the two ports outright. The one exception is the
`.pic` sprite container, which is **RLE-compressed** on DOS (and whose
directory slot narrows from 26 to 24 bytes) — but whose decompressed pixel
payload is nevertheless byte-identical to the Amiga's. See §5.

Confidence levels: **confirmed** (verified against an independent oracle —
a byte-exact invariant, matching values against the already-confirmed
Amiga corpus, or legible rendered output), **rendered** (plausible,
visually coherent, not independently cross-checked), **hypothesis**
(structurally motivated guess, not yet verified).

---

## 0. Method note: the endian-swap discovery

Before any disassembly, a direct byte comparison against the Amiga corpus
was run for every same-sized `.hdr`/`.dbs` pair, under two hypotheses: (a)
raw byte-for-byte identity, (b) pairwise 16-bit byte swap. Neither alone
explains the whole corpus — ASCII text fields naturally score higher under
raw comparison (swapping unrelated adjacent text bytes usually breaks
them), while genuinely numeric fields only line up once each field is
reinterpreted at its own native width (`u16`/`u32`) in the other
endianness — a blind pairwise-16-bit swap is actually *wrong* for `u32`
fields (it needs a full 4-byte reversal, or equivalently, just re-reading
the same bytes as little-endian instead of big-endian at the correct
field width). Once each file's fields are read at their real declared
width or the correct endianness instead of blindly swapping adjacent byte
pairs, every shared header/database file except `.PIC` reproduces the
Amiga corpus's decoded *values* exactly:

| File | Field-width-correct LE reinterpretation result |
|---|---|
| `master.hdr` | 20/20 `u16` values identical to Amiga (§1.2) |
| `disk.hdr` | 9/9 `u32` section offsets identical; trailing 656 bytes byte-identical outright (§1.3) |
| `misc.hdr` | Huffman tree 98.9% node-identical (11/1024 bytes differ, all explainable as genuine minor tree differences, not a decode bug — §1.1) |
| `scenario.hdr` | byte-identical to Amiga except at two already-known live-scratch/flag byte ranges (§1.4) |
| `pcfile.dbs` | header fields (`u16`/`u16`/`u32`) reproduce the exact same `24 + 16*432 = 6936` structure (§1.5) |
| `scenario.dbs` | class-XP `u32` tables reproduce Amiga's exact round-decimal values; item/monster catalog names, prices and `picFileIndex` all confirmed (§1.6) |
| `newgame.dbs` | shares `scenario.hdr`'s 414-byte prefix, same as Amiga (§1.7) |
| `msg.hdr`/`msg.dbs` | same field layout (`(C&0xFF)*1024+B`) and same Huffman-tree-walk algorithm decode legible English text (§1.8) |

## 1. Shared `.hdr`/`.dbs` files

### 1.1 `misc.hdr` (1024 bytes) — confirmed

Same format as Amiga (§6.1 of the Amiga doc): 256 Huffman-tree nodes, 4
bytes each = 2×`i16` (left child, right child), but each `i16` is
**little-endian** here (Amiga: big-endian). Leaf = non-negative value
(literal output byte, low byte used, though negative-check alone is
sufficient since leaf words store the byte in `0x00`-`0x7F`); internal
node = negative value, `nextNodeIndex = -value` (index into the 256-node
array, matching node stride 4 bytes exactly as the Amiga decoder computes
via `NEG.W`+`LSL.W #2`).

Byte-for-byte comparison against Amiga's `misc.hdr` under the swap
hypothesis: **1013/1024 bytes match (98.9%)**. The 11 mismatching bytes
are all within 3 tree nodes (offsets 244-247, 332-335, 366-421) and take
the shape of a **left/right child swap** at the same node (e.g. node 61:
Amiga has left=40/right=49, DOS has left=49/right=40) or a differing leaf
value at one child — i.e. this is a **genuinely different but structurally
equivalent Huffman tree** (most likely built from a very slightly
different English-text corpus between the two ports, causing different
tie-breaks during tree construction), not a decode error. Each platform's
own `misc.hdr` file must be used with that platform's own `msg.dbs`/records
— the two trees are not interchangeable.

Verified via decoding `msg.dbs` end-to-end (§1.8): the DOS tree produces
legible English sentences using exactly this algorithm and this file, with
no cross-reference to the Amiga tree.

### 1.2 `master.hdr` (66 bytes) — confirmed, byte-exact

Same two-part 10-entry table as Amiga (§6.4): `words[0..9]` = per-section
record size, `words[10..19]` = per-section record count, for
`scenario.dbs`'s 10 fixed-stride sections — but each word is **`u16`
little-endian**.

**Verified**: all 20 values decode to numbers **identical** to Amiga's:
`recordSizes = [64, 74, 1346, 1740, 222, 142, 32, 40, 314, 12]`,
`recordCounts = [14, 500, 16, 16, 250, 32, 400, 200, 64, 64]`. This means
`scenario.dbs`'s internal section layout (record size/count per section)
is **identical between the two ports** — the same section table from the
Amiga doc's §6.4 applies here unchanged.

### 1.3 `disk.hdr` (700 bytes) — confirmed, byte-exact

Same 44-byte header (4 zero words + 9 `u32` section-boundary offsets into
`scenario.dbs`) + 656-byte trailing region as Amiga (§6.5), with the 9
`u32` values **little-endian**.

**Verified**: all 9 offsets decode to values **identical** to Amiga's —
`896, 37896, 59432, 87272, 142772, 147316, 160116, 168116, 188212`. The
trailing 656 bytes (5 identity-ramp lookup tables, sizes 16/64/256/256/64)
are **byte-identical outright** to the Amiga file (0 differences across
all 656 bytes) — single-byte identity data is endianness-agnostic, so this
is expected once the format itself is confirmed shared.

This means `scenario.dbs`'s 10-section boundary layout is **exactly the
same on both platforms**, byte-for-byte in terms of offsets — a strong
confirmation the underlying scenario data is a straight recompile/rebuild
of the same source tables, not independently re-authored per platform.

### 1.4 `scenario.hdr` (414 bytes) — confirmed

Same flat 414-byte cached blob as Amiga (§6.3) — no internal directory,
loaded verbatim. Comparing this shipped DOS file directly against the
shipped Amiga file (no endian conversion needed — the bulk of the region
is ASCII scratch-path text and single bytes) gives only **12/414 bytes
different**, and every one of them falls inside the two already-documented
live-scratch-buffer/flag regions from the Amiga doc:

- Offset 328-335: Amiga's stale build-time `"H0:"` volume-prefix text vs.
  this DOS file's **`"C:\BANE\"`** — the DOS-native equivalent of the same
  `BuildResourcePath` scratch-buffer overlap the Amiga doc identified (§6.3
  correction) — this specific shipped copy of `scenario.hdr` had already
  had a resource path built into it before being captured, baking in the
  real DOS install path.
- Offset 408: a single flag byte (Amiga=`0x00`, DOS=`0x05`) — one of the
  same 6 individually-addressed trailing flag bytes documented in Amiga
  §6.3 (semantics still open there).

Comparing `scenario.hdr` against **this platform's own** `newgame.dbs`
(which the Amiga doc found is byte-identical to `scenario.hdr` for the
first 414 bytes, §7.2) reproduces the same relationship here: only 9/414
bytes differ, all at the same scratch-path (330-335) and flag (408, 412,
413) offsets — confirming the shared-414-byte-header relationship holds on
DOS too, not just that both files independently happen to resemble Amiga's.

### 1.5 `pcfile.dbs` (6936 bytes) — confirmed

Same structure as Amiga (§7.3): 24-byte header + 16×432-byte character
records, `24 + 16*432 = 6936` exact — but header fields are little-endian:

| Offset | Size | Field | Shipped DOS value |
|---|---|---|---|
| +0 | 2 | `recordSize` (`u16` LE) | 432 |
| +2 | 2 | `recordCount` (`u16` LE) | 16 |
| +4 | 4 | `baseOffset` (`u32` LE) | 24 |
| +8 | 16 | `usedFlags[16]` | `01 01 01 01 01 01 00...00` |

**Difference from Amiga's shipped file**: Amiga's `pcfile.dbs` is a
fresh-install template (all-empty roster, `usedFlags` all zero). This DOS
copy ships **6 pre-made sample characters** (`usedFlags[0..5]=1`) with
legible names: `THESUS, TEMPEST, LYSANDR, NOBAL, TREON, PENTAG`. The
432-byte record's internal field layout (beyond the name at +0) was not
decoded this pass, same as Amiga — but these 6 populated records are a
ready-made oracle for a future pass at the record's stat fields (unlike
Amiga's all-empty file).

### 1.6 `scenario.dbs` (188980 bytes) — confirmed for sections 0/1/4, same section table as Amiga

Section table identical to Amiga (§1.2/§1.3 above — cross-verified via
`master.hdr`/`disk.hdr`'s byte-exact LE reinterpretation). Sections
decoded this pass, all via little-endian reinterpretation of the exact
Amiga field layout:

**Section 0** (`0x000`-`0x37F`, 14×64-byte class XP tables) — **confirmed,
values identical to Amiga**. All 16×14 `u32` LE values reproduce Amiga's
exact round-decimal sequences (`1000, 2000, 4000, 8000, ...`;
`1250, 2500, 5000, ...`; etc.), and table 14 breaks round-number shape at
exactly the same boundary (`1263489602, 1226853957, 5064020, 0, 0, ...`),
confirming the same 14-table extent.

**Section 1** (`0x380`-`0x9408`, 500×74-byte item catalog) — **confirmed**.
Same field layout as Amiga §7.1 (name at +0, price `u32` LE at +16).
Sampled records reproduce Amiga's exact item names and prices verbatim:
`DAGGER=15gp, MAIN GAUCHE=30gp, SHORT SWORD=45gp, WAKIZASHI=240gp,
LONGSWORD=60gp`, `NINJA COWL=50gp, TABI BOOTS=85gp, WIZARD'S CONE=75gp,
MITRE=200gp`, followed by all-zero unused slots past record 163 in the
sampled range.

**Section 4** (`0x154e8`-`0x22db4`, 250×222-byte monster catalog) —
**confirmed**. Same field layout as Amiga §7.1 (singular/plural/category
names at +0/+16/+32/+48, `picFileIndex` `u8` at +209, secondary selector
`u8` at +210 — single-byte fields, endianness-agnostic). **185/250**
records have a legible name (vs. Amiga's 183/250 — a small, expected
content difference, not a decode issue). Spot-checked records reproduce
Amiga's exact names and `picFileIndex` values: `RAT→21, GIANT RAT→21,
BAT→18, HUGE BAT→18, VAMPIRE BAT→18, CREEPING VINE→24, ROGUE→22,
BUSHWACKER→22, ZOMBIE→25 (category STINKING CORPSE), HILL GIANT→26,
HYDRA PLANT→20` — every value identical to the Amiga catalog's
already-confirmed mapping (Amiga §2.6a). This independently re-confirms
`+209` as the `.PIC` file-index field on this platform too, even though
the `.PIC` container format itself differs (§5) — the *index space*
(0-58, selecting `mon00.pic`-`mon58.pic`) is unchanged.

Sections 2, 3, 5, 6, 7, 8, 9 — same status as Amiga: boundaries/stride
known exactly (§1.2's table), contents undecoded this pass, not
specifically re-examined for DOS (no reason to expect the content differs
from Amiga's own open status here — carried over as still-open).

### 1.7 `newgame.dbs` (49856 bytes) — partial, same status as Amiga

Shares its first 414 bytes with `scenario.hdr` (§1.4). Post-header body
not decoded this pass (same open status as Amiga §7.2) — not
re-examined for DOS-specific differences.

### 1.8 `msg.hdr` (5102 bytes) + `msg.dbs` (81920 bytes) — confirmed

Same layout as Amiga (§6.2/§7.4): `msg.hdr` = 2-byte `count` (`u16` LE
here; DOS value **718** vs. Amiga's 724 — a real content difference, not a
decode bug, see below) + up to 850×6-byte records, each 3×`u16` LE fields
`(A, B, C)`. Position formula unchanged: `offset = (C & 0xFF)*1024 + B`
into `msg.dbs` (which is `80×1024` bytes here too — `81920` bytes, same
file size as Amiga). At that offset: `+0` decoded-length byte `L`, `+1`
compressed-byte-count (unused for decode), `+2..` the Huffman bitstream
(MSB-first per byte), walked with `misc.hdr`'s **DOS-native** tree (§1.1)
— **not** the Amiga tree.

**Verified**: reimplementing the exact algorithm from the Amiga doc's own
prose (ROL-style MSB-first bit walk, refill every 8 bits, negative node
value = internal back-reference, non-negative = literal byte) against
Amiga's own corpus first reproduces the doc's stated result exactly
(**724/724 unique positions, 90.7% printable-ASCII** — an exact match to
Amiga §7.4's own numbers, confirming the reimplementation is correct
before trusting it on new data). Running the same algorithm against the
DOS corpus (DOS tree + DOS `msg.hdr`/`msg.dbs`) gives:

- **686/718 unique `(page, offset)` positions** (32 collisions — see
  "open" below)
- **98.5% printable-ASCII** across all decoded output (higher than
  Amiga's 90.7%, plausibly just different message-content mix)
- Dozens of fully legible sentences/phrases recovered, e.g.:
  `"HELLO/HAIL"`, `"GOODBYE/QUIT/FAREWELL"`, `"YES/SURE/OK/YEA/YEAH"`,
  `"NOPE/NEVER"`, `"500 GOLD FINDER'S FEE FOR ASHES...THE DEAD BELONG TO
  THE ISLE OF THE DEAD"`, `"THE SPELL HAS BEEN SCRIBED INTO YOUR...
  PERSONAL SPELLBOOK"`, `"YOU ARE NOT ADVANCED ENOUGH TO WRITE...SPELL
  INTO YOUR SPELLBOOK"`, `"WIZARD'S LAIR"`, `"...KNOW YOU NEED TWO GEMS TO
  OPEN THE SKULL DOOR...ORPHITUS HID THEM TO SEAL OFF DEATH...ORPHITUS HID"`

Short runs of repeated high-frequency letters (mostly `E`/`T`) interleaved
with legible words appear in both the DOS and the Amiga decode alike (e.g.
Amiga record 4, `L=12`, decodes to
`\x1b\x08\t\n\x0b\rET E  ` under the exact same known-good algorithm) —
this is a **pre-existing property of the confirmed-correct Amiga decode**,
not a DOS-specific bug: some `msg.dbs` slots are short embedded
control-code/formatting sequences rather than player-facing prose (matches
the Amiga doc's own note about record index 133 and similar reserved
slots).

**Resolved: the 32/718 `(page, offset)` collisions are genuine,
intentional text reuse — not a decode gap.** Two structural facts settle
this:

1. **Field `A` is a strictly increasing, zero-duplicate sorted key across
   all 718 records** (`hdr[i].a < hdr[i+1].a` for every `i`, verified
   directly against the raw file, no exceptions) — hard confirmation of
   the existing "binary-search trigger-ID key" hypothesis (Amiga §6.2/§7.4)
   for this platform, independent of the Amiga question still being open
   there.
2. **Every one of the 29 colliding `(page, offset)` groups pairs 2 or 3
   *distinct* field-`A` values** pointing at the identical stored text —
   never a duplicate `A`, and never more records in a group than there are
   distinct `A`s. This is the byte-level signature of deliberate string
   sharing (several different sorted lookup keys resolving to one physical
   string), not a corrupted or misread record.

Decoding the actual shared text confirms this qualitatively: e.g. records
`12/139/410` (A=`660/10252/14322`) all decode to `"SELECT NEW CHARACTE[R]"`
— an obviously reusable generic UI prompt — and records `35/689`
(A=`2000/18405`) both decode to `"TYPE THE MAGICWORD FO[R]"`, another
generic prompt. A third group (`354/533/571`) shares a control-code-heavy
fragment matching the same reserved-slot pattern already documented above
(record 133-style formatting sequences, not player-facing prose) — those
are shared for the same reason: one stored formatting fragment reused by
several trigger contexts.

Note for future cross-platform work: Amiga's own `msg.hdr` has **zero**
`(page, offset)` collisions across its 724 records (Amiga §7.4's own
numbers) — i.e. the DOS release deliberately deduplicates repeated
strings and the Amiga port's rebuild did not (or authored its message set
independently, without inheriting the sharing). This is a real, minor
authoring difference between the ports, not evidence of a decode
discrepancy on either side.

Field `A`'s deeper semantics (what the trigger-ID key actually *indexes
into*, beyond "a sorted lookup key") remain open on both platforms — see
`msg-hdr-field-a` in `docs/wizardry6/TODO.md` — but that question is
separate from, and no longer blocks closing, the collision question.

Separately, **5/718 records compute a page number > 79** (`89, 102, 109,
86, 90` — outside `msg.dbs`'s real `0-79` page range, so
`tools/wizardry6/decode-dosega-msg-text.ts` skips them rather than
reading out of bounds): indices `21, 90, 94, 101, 108`. Not investigated
further this pass — plausibly reserved/unused trigger-ID slots whose `B`/`C`
fields were never meant to be read as real positions (the records still
have valid, strictly-increasing `A` values, consistent with being genuine
but currently-unused table entries rather than corrupt records).

---

## 2. `.EGA` full-screen images (`dragonsc.ega`, `graveyrd.ega`, `titlepag.ega`) — confirmed

All three are exactly 32768 bytes, **byte-identical to the Amiga release**
(same md5 for all 3 files — this is genuinely the same shipped asset, not
just the same format). **Same layout**: 320×200 pixels, 4 bitplanes,
plane-major (all rows of plane 0, then all of plane 1, ...), no header.

> **Correction (2026-08-01, stride-bug investigation):** an earlier pass
> assumed the 4 planes were packed back-to-back (`320/8*200 = 8000` bytes
> each, `32000` total) with the file's remaining `768` bytes as one inert
> trailing block. **Wrong.** Each plane actually occupies a fixed
> **8192-byte (`0x2000`) slot** — `4 * 8192 = 32768`, the *entire* file, no
> leftover trailer at all; the "768 extra bytes" were really `4 * 192`
> bytes of per-plane padding, one slice after each plane's real 8000 bytes
> of pixel data, not one block at the end. See
> `docs/wizardry6/amiga/data-structure.md` §3.3 for the full writeup
> (verification method, disassembly confirmation, and the "genuine
> dithering vs. decode bug" resolution) — this file uses the identical fix,
> confirmed the same way (byte-exact against this same file's `.t16`
> sibling, §9.3 below).

**Verification**: decoding `titlepag.ega` at this layout renders clearly
legible **"BANE...COSMIC...FORGE"** engraved-stone title lettering with
clean, un-speckled stonework (0 pixel mismatches against the `.t16`-decoded
ground truth for this same screen, see §9.3), exactly matching Amiga's own
confirmed render.

**Palette**: same confirmed `PIC_PALETTE` table as Amiga (§2.4/§3.1) — the
permuted 16-colour order `{0x000, 0xfff, 0x55f, 0xf5f, 0xf55, 0xff5,
0x5f5, 0x5ff, 0x555, 0xaaa, 0x00a, 0xa0a, 0xa00, 0xa50, 0x0a0, 0x0aa}`.
Tested against the alternative "standard EGA hardware DAC order"
(`{black, blue, green, cyan, red, magenta, brown, ltgrey, dkgrey, ltblue,
ltgreen, ltcyan, ltred, ltmagenta, yellow, white}`) — the standard-order
render is visibly wrong (garish, inconsistent neon colour blocks with no
plausible EGA-art shape), while `PIC_PALETTE` produces a coherent, visually
plausible render (subdued stone greys around the title text, matching
Amiga's own description of "indices {0,1,8,9}" dominating the lettering
area). This is a useful independent confirmation that `PIC_PALETTE`'s
"permuted" order isn't an Amiga-side port artifact at all — since DOS is
the original platform, this **is** the genuine, original game-authored
EGA palette, later carried over unchanged to the Amiga port.

`graveyrd.ega` renders a coherent scene (tombstone/arch silhouettes with
speckled magenta/white "dithered sky" fill) matching Amiga's own
description. This residual fill-area speckle is now **confirmed genuine**
(not a decode artifact of either platform's `.ega` decoder): after the
stride fix, `graveyrd.ega`'s decode is byte-for-byte identical
(100.000000% index match, all 64,000 pixels) to `graveyrd.t16`'s decode —
a structurally unrelated packed-chunky 4bpp encoding, decoded by
completely different code (`decodePackedPixelLinear`, not
`decodePlanarPlaneMajor`). Two independently-coded decoders of two
differently-encoded files converging on the identical pixel grid rules out
"decode bug in the shared planar path" as an explanation for the sky
speckle — it's baked into the source art itself, most likely genuine
period-accurate EGA dithering.

---

## 3. `mazedata.ega` (102303 bytes) — confirmed, directory format differs from Amiga

**File size differs from Amiga's 102456 bytes by exactly 153 bytes** — the
same number as the directory's own record count. This is not a
compression difference; it's explained by removing the per-record 32-bit
absolute file offset field entirely from each directory record.

### 3.1 Header (confirmed, byte-exact counts)

Same 4-byte header as Amiga (§4.1): `+0 u16 LE dirCount` (153),
`+2 u16 LE subCount` (366) — identical counts to Amiga (single small
values, endianness-agnostic in practice).

### 3.2 Directory (153×5-byte records, not 6) — confirmed, zero-deviation

```
+0   3 bytes   unknown/vestigial (see below — NOT a stored offset)
+3   1 byte    widthUnits  -- width in 8px units (same meaning as Amiga)
+4   1 byte    heightRows  -- height in pixels/rows (same meaning as Amiga)
```

**`widthUnits`/`heightRows` are byte-identical to Amiga's for all 153
records (0/153 mismatches)** — confirming this is the exact same art bank,
just re-encoded. Unlike Amiga (and unlike this same file's own compose-list
sub-table, §3.3, which keeps its per-record byte width), **no absolute
file-offset field is stored per record here** — reading the first 3 bytes
of each record as a big-endian *or* little-endian 24-bit integer produces
values with no consistent relationship to any real file position
(confirmed not to be a scaled/relative offset either; see "open" below).
Graphics-block positions are instead **implicit and cumulative**: block
`i`'s file offset is `gfxBase + Σ(widthUnits[j]*heightRows[j]*4)` for all
`j < i`, where `gfxBase = 4 + dirCount*5 + subCount*5`.

### 3.3 Compose-list sub-table (366×5-byte records) — same byte size as Amiga

Byte width unchanged (5 bytes/record, same as Amiga §4.4) — field
semantics not re-examined this pass (Amiga's own field semantics there are
hypothesis-only; carried over as an open question, not re-verified for
DOS specifically).

### 3.4 Zero-deviation verification

```
gfxBase = 4 + 153*5 + 366*5 = 2599
Σ(widthUnits[i]*heightRows[i]*4) for all 153 records = 99704
gfxBase + 99704 = 102303  ==  actual file size (102303), EXACT
```

Tested systematically: brute-forced every combination of directory record
size (4-8 bytes), offset field width (2/3/4 bytes), offset field position
(leading/trailing), sub-record size (2-6 bytes), and endianness looking
for one where `record[0].offset == computed header size` exactly — **zero
exact matches** (closest candidate off by 89 bytes) — which is what
motivated dropping the "each record stores its own offset" assumption
and testing the cumulative/implicit-offset hypothesis instead, which
matched exactly on the first try once `widthUnits`/`heightRows` were
independently confirmed correct against Amiga's own values.

Decoding and rendering (plane-major, 4bpp, `PIC_PALETTE`, same as Amiga
§4.3) the first several graphics blocks under this scheme produces **clean,
recognisable perspective-scaled brick-wall textures and a UI icon**,
visually matching Amiga's own described content ("perspective-scaled brick
wall textures (3 sizes) ... wall chains ... 20 UI icons") — no noise, no
misalignment.

**Open**: the 3 leading bytes per directory record — confirmed *not* a
useful file offset by exhaustive brute force, not all-zero (only 1/153
records have all-3-bytes-zero), no correlation found with the real
cumulative offset. Left as vestigial/unknown; not required for decoding.

---

## 4. Font/portrait `.EGA` files — confirmed, byte-identical to Amiga

`wfont0.ega`, `wfont1.ega`-`wfont4.ega`, `wport1.ega`-`wport3.ega` are
**byte-identical in size** to their Amiga counterparts, and mostly
**byte-identical in content outright** (no endian conversion needed —
these are pure planar/1bpp pixel data with no multi-byte fields):

| File | Amiga size | DOS size | Byte-identical? |
|---|---|---|---|
| `wfont0.ega` | 1024 | 1024 | yes (100%) |
| `wfont1.ega` | 4096 | 4096 | yes (100%) |
| `wfont2.ega` | 4096 | 4096 | yes (100%) |
| `wfont3.ega` | 4096 | 4096 | yes (100%) |
| `wfont4.ega` | 4096 | 4096 | 99.5% (20/4096 bytes differ, one clustered ~32-byte run — one tile redrawn slightly differently between ports) |
| `wport1.ega` | 4096 | 4096 | yes (100%) |
| `wport2.ega` | 4096 | 4096 | yes (100%) |
| `wport3.ega` | 4096 | 4096 | yes (100%) |

Format is therefore **directly confirmed** without any independent
re-verification needed: same as Amiga §5.1/§5.2/§5.3 — `wfont0.ega` = 128
glyphs × 8×8px × 1bpp; `wfont1-4.ega` = 128 tiles/file in the `.PIC`
32-byte-tile encoding; `wport1-3.ega` = 14×288-byte portrait records, 9
tiles each (3×3, 24×24px).

---

## 5. `.pic` sprite files (`mon00.pic`-`mon58.pic`, `credits.pic`) — **confirmed** (solved)

> **Correction (`re-codebreaker` pass):** this section previously read
> "open, escalated". The format is now fully solved and the earlier
> reading of the file's opening bytes was wrong in a specific,
> instructive way. There is **no plaintext directory at offset 0**: the
> whole file is RLE-compressed. The "stride-7 records with `600, 632,
> 664, 696` as BE `u16`s" signal was real *content* seen through the
> wrong frame — those are the **little-endian** offsets `0x0258, 0x0278,
> 0x0298, 0x02B8` of the *decompressed* directory, each preceded by a
> one-byte RLE literal-count control (`0x02`) that shifted the whole
> read by one byte and made LE look like BE. Likewise the "identical
> 5-byte suffix `02 fd 01 ed 00`" is not a field group: `fd` and `ed`
> are **run controls** (`−3` and `−19`), expanding to `01 01 01` then
> nineteen `00` bytes — i.e. the `tilesW=1, tilesH=1, mask=0x01` tail of
> a 24-byte directory slot. The entropy discontinuity at byte 600 was a
> coincidence, not a directory/payload boundary.

DOS `.pic` files are **the Amiga `.PIC` payload, byte for byte**, wrapped
in two changes:

1. the whole file is compressed with a block-oriented byte RLE (§5.1), and
2. the directory slot shrinks from 26 to 24 bytes, because the cel offset
   is a `u16` **little-endian** instead of a `u32` big-endian (§5.2).

Nothing else changes: tile encoding, tile size, mask semantics, cel
ordering and the transparent colour index are all identical to
`amiga/data-structure.md` §2.2-§2.4. This is unsurprising — EGA's four
colour planes and the Amiga's four bitplanes are the same planar
organisation, so the artwork needed no conversion. It also explains the
51%-86% size ratio: it is compression ratio, which varies with content,
plus a flat 50 bytes of directory savings.

Implementation: `tools/wizardry6/dos-rle.ts` (codec) and
`tools/wizardry6/pic-format-dos.ts` (directory), which reuses
`pic-format.ts`'s `decodePicCel` / `picCelByteLength` / `PIC_PALETTE` /
`celIndicesToRGBA` verbatim. Regression test:
`tools/wizardry6/__tests__/pic-format-dos.test.ts`.

### 5.1 Compression — block RLE — confirmed

A byte-oriented RLE with a signed control byte. There is **no header and
no end-of-stream marker**; decoding starts at file offset 0 and runs to
EOF.

| Control byte `c` | Meaning |
|---|---|
| `0x01`-`0x7F` | copy the next `c` bytes literally |
| `0x80`-`0xFF` | emit `256 - c` copies of the next byte (i.e. `-(int8)c`; `0xFF` = 1, `0x80` = 128) |
| `0x00` | never a real token — see the block rule below |

**Block rule.** The compressed stream is cut into **4096-byte blocks and
no token straddles a block boundary** — the game reads the file one 4 KB
disk buffer at a time. Since the shortest legal token is 2 bytes
(`ctrl` + one payload byte), an encoder filling a block can be left with
at most one unusable byte, which is written as filler and must be
skipped:

```
i = 0
while i < len(src):
    blockEnd = min((i / 4096 + 1) * 4096, len(src))
    if blockEnd - i < 2:        # 1 filler byte at the end of the block
        i = blockEnd; continue
    c = src[i]; i += 1
    if c >= 0x80:               # run
        emit (256 - c) copies of src[i]; i += 1
    else:                       # literal
        emit src[i : i+c];      i += c
```

Corpus statistics (60 files, 210 blocks, 125,852 tokens):

- 85 of 210 blocks carry exactly **one** filler byte; **no block ever has
  two or more** bytes left over — consistent with an encoder that always
  emits a token that fits, since it can always shorten a literal.
- The filler byte is **not a sentinel**: 65 occurrences are `0x00`, the
  other 20 are arbitrary stale values (`0x20`, `0x30`, `0x45`, `0x7F`,
  `0xBE`, `0xD0`, `0xF6`, `0xFF`, ...).
- Every one of the 65 `c == 0x00` bytes sits at exactly `blockEnd - 1`,
  which is why `0x00` never needs a token meaning.
- Literal lengths span 1-127 (most common: 1, 2, 3, 4, 5); run lengths
  span 1-128 (most common: 3, 4, 5, 6, 7).

The block size is **uniquely determined**, not assumed. Decoding all 59
`mon##.pic` files with a block size of 1024 / 2048 / 4096 / 8192 / 16384 /
none yields **2 / 4 / 59 / 49 / 42 / 40** byte-exact files respectively —
only 4096 decodes the whole corpus.

An equivalent formulation ("skip to the next block if the *whole token*
would not fit") produces byte-identical output on every file in the
corpus, so the two cannot be distinguished from the shipped data. The
`< 2 bytes remaining` form is implemented, as it is what a
`while (p <= bufEnd - 2)` refill loop would naturally do.

### 5.2 Directory — confirmed

The decompressed image is the DOS-native `.pic`: a fixed **600-byte
directory (25 slots × 24 bytes)** followed by cel tile data.

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0` | 2 | `offset` | **LE u16** absolute offset of this cel's tile data **within the decompressed image**. `offset == 0` terminates the directory. |
| `+2` | 1 | `tilesW` | cel width in 8-pixel tiles |
| `+3` | 1 | `tilesH` | cel height in 8-pixel tiles |
| `+4` | 20 | `mask[20]` | tile-presence bitmask, `tilesW*tilesH` bits, LSB-first within each byte |

Relative to the Amiga slot (`amiga/data-structure.md` §2.1) only the
offset field changed: 4 bytes BE → 2 bytes LE. `tilesW`, `tilesH` and all
20 mask bytes are **byte-identical** to their Amiga counterparts, and
every DOS offset equals its Amiga counterpart **minus exactly 50**
(= 25 slots × the 2 bytes saved per slot). The first slot therefore always
reads `offset = 600` rather than the Amiga's 650 — this is the real
explanation for the "600" that the earlier pass spotted, and it is
`directory_offset[0]` by construction, not a magic number.

The `u16` offset is sufficient because no decompressed `.pic` exceeds
64 KB (largest: `credits.pic` at 30,584 bytes).

The Amiga cel-length invariant carries over unchanged:
`offset[i+1] - offset[i] == 32 * popcount(mask[0 .. ceil(tilesW*tilesH/8)-1])`.

### 5.3 Tile/pixel layout and palette — confirmed (inherited)

Unchanged from `amiga/data-structure.md` §2.2-§2.4: only present tiles are
stored, 32 bytes each (4 planes × 8 rows × 1 byte, plane-major, MSB =
leftmost pixel), in row-major tile order; absent tiles render as the
transparent index. Colour index 15 is the transparent key.

Because the tile bytes are byte-identical to the Amiga file, the index
semantics are necessarily identical, and `PIC_PALETTE` (an EGA-family
16-colour set) renders the DOS data correctly — see the credits render in
§5.4. Whether the DOS EGA release programmes those same 16 RGB values
into its palette registers (rather than merely the same *indices*) is a
separate, unverified question; `ega.drv` / `wroot.exe` were not examined
for a palette table.

### 5.4 Verification evidence

Oracle: the fully-confirmed Amiga `.PIC` corpus (`data/wizardry6/amiga/`).

| Check | Result |
|---|---|
| Decompressed length == Amiga length − 50 | **59/59** `mon##.pic` (and `credits.pic`: 30,584 == 30,634 − 50) |
| Decompressed tile payload == Amiga tile payload, byte for byte | **59/59** files, **939,144 bytes**, zero mismatching bytes |
| Directory: offset−50, `tilesW`, `tilesH`, all 20 mask bytes match Amiga | **712/712** cels, zero deviation |
| Rendered cel pixels identical to the Amiga render | **712 cels, 3,414,272 pixels, 0 differing pixels** |
| Mask-popcount invariant `offset[i+1] - offset[i] == 32*popcount(mask)` | **665/665** consecutive cel pairs across all 60 files, zero deviation |
| Last cel's extent reaches EOF exactly | 59/60 (`credits.pic` has 1,504 bytes of zero padding — see below) |
| Unused directory slots all-zero | 60/60 files |
| Decoding terminates exactly at EOF, no token reads past the end | 60/60 files, 0 overruns |

`credits.pic` is the one file whose content legitimately **differs** from
the Amiga version, and it is not a decoder failure:

- It decompresses to exactly 30,584 bytes — the expected length — and its
  directory parses cleanly (13 cels vs the Amiga's 19).
- Cels 0-2 (`34×4`, `35×3`, `36×3` tiles, offsets 600/4280/5784) are
  **byte-identical** to the Amiga's — the first 6,080 payload bytes match
  exactly — and the two files diverge from cel 3 onward. The DOS release
  simply credits a different (non-Amiga-conversion) staff list.
- The last cel's declared extent ends 1,504 bytes before EOF; those
  trailing bytes are **all zero** (1,504 bytes, one distinct value),
  i.e. buffer padding, which is why the "last cel runs to EOF" form of
  the invariant does not hold for this one file.
- Rendering it produces fully legible credit text and logos ("Written and
  Programmed by D W Bradley", "Computer Graphics Chris Appel / Renata
  Dolnick", the *Wizardry* logo, the SIR-TECH logo, "A Fantasy
  Role-Playing Simulation"). This is independent ground truth for the
  codec, the directory and the pixel layout on the one file the Amiga
  oracle could *not* cover.

Cross-check against `scenario.dbs`: monster record 0 (`RAT`) has
`picFileIndex = 21`, and `mon21.pic` renders as a rat-like quadruped with
a long tail — matching the confirmed Amiga mapping
(`amiga/data-structure.md` §2.6a).

### 5.5 Notes for the pipeline

- `.pic` is the **only** compressed file class in the DOS corpus. Every
  other DOS file shares its Amiga counterpart's exact byte size
  (`msg.dbs` 81,920, `scenario.dbs` 188,980, `newgame.dbs` 49,856,
  `pcfile.dbs` 6,936, `disk.hdr` 700, `misc.hdr` 1,024, ...), so none of
  them can be RLE-compressed. `mazedata.ega` (DOS 102,303 vs Amiga
  102,456) is the only near-miss and is not compressed by this codec —
  its difference is the 153×5-byte vs 153×6-byte directory of §3.2.
- There are no `mon##.cga` / `mon##.t16` variants: unlike
  `titlepag`/`wfont`/`wport`/`mazedata`/`dragonsc`/`graveyrd`, the `.pic`
  files are shared across all display drivers, and the 4-plane data is
  adapted at runtime.
- The `dosega` platform is **not yet registered** in `src/game-id.ts` or
  `tools/shared/game-config.ts`; the decoder above is standalone and not
  yet wired into `exportGameData`/`buildAssets`.

### 5.6 Paths tried

| Approach | Result | Why it fell short |
|---|---|---|
| Direct LE reinterpretation of Amiga's exact 26-byte/25-slot/20-byte-mask layout | Garbage — first offset decodes to 4,244,789,250, no zero-terminator, tilesW/tilesH absurd (237, 253) | Correct conclusion, wrong inference. There is no plaintext directory at all — the file is compressed |
| Fixed 24-byte record (2-byte BE offset + tw + th + 20-byte mask) at file offset 0 | Slot 0's offset (600) matched; slots 1+ gave implausible tw/th (237, 0, ...) | The record size (24) and offset width (2) were both **right**, but they describe the *decompressed* image, not the file on disk |
| Predicted-size model: variable-length mask (`ceil(tw*h/8)` bytes) + 2-byte offset, using Amiga's confirmed `tw`/`h`/mask as ground truth | Predicted/actual ratio 0.80 (range 0.65-0.93), not 1.0 | Correctly proved the size reduction is not directory savings alone; the mask is *not* variable-length, the payload is compressed |
| Stride-7 monotonic-run byte scan (BE `u16` at every stride 4-40) | Found `600,632,664,696` (+32 steps) with 4 byte-identical 5-byte suffixes | Real content read through the wrong frame — see the Correction block above. A one-byte RLE control before each LE offset made LE look like BE at a phantom stride of 7 |
| `fb ff` / `f8 ff` / `f0 00` as an RLE escape/tag scheme | Superseded | Correct instinct (these *are* run controls), wrong framing: the scheme is control-byte-led, not escape-led, so scanning for recurring *pairs* found run-control + payload rather than the token structure |
| `ancient identify` against known retro compressors | "Unknown or invalid compression format" | Correct — it is an in-house RLE with no magic, not a member of any known packer family |
| Real-mode x86 disassembly of `winit.ovr`/`wmele.ovr` to find the loader | Not needed | Solved structurally instead. The DS-relative segment-base blocker was resolved in a later session for other DOS questions — see §6.1a |

---

## 6. `wroot.exe` — main executable and overlay architecture

**Confirmed (format/shape)**: `wroot.exe` (67134 bytes) is a standard
16-bit real-mode MS-DOS MZ executable (`MZ` magic at offset 0,
`HeaderParagraphs=0x20`=512-byte header, entry `CS:IP = 0000:0x4072`
relative to the load segment, one relocation entry patching the stack
segment word). Confirmed via `wizardry6.pif` (a Windows PIF pointing at
`C:\BANE\WROOT.EXE`) and `bane.bat`/`playbane.bat` (both simply run
`Moslowiz %1 wroot` / `wroot` directly) that this is the real game
executable, launched (optionally) through the `moslowiz.com` CPU-throttle
TSR — **not analysed**, per its license.

### 6.1 Startup load order — confirmed (from `bane.bat`'s error-code table)

`bane.bat`/`playbane.bat` both check `ERRORLEVEL` 1-22 after running
`wroot`, each mapped to a specific startup failure message. Taken in
order, this is a **direct enumeration of wroot.exe's own startup sequence**
(no disassembly needed — the game's own installer/launcher documents it):

```
1  Open SCENARIO.HDR              9  Open PICTURE            17 Re-open MSG.DBS
2  Configure graphics mode        10 Open SOUND               18 Re-open SCENARIO.DBS
3  Load system fonts              11 Alloc window/residents   19 Re-open SCENARIO.HDR
4  Load MAZEDATA                  12 Load TitlePage            20 Alloc maze buffers
5  Set graphic mode for hardware  13 Load DragonScreen          21 Load PICTURE
6  Load system headers            14 Load PORTRAITS            22 Unknown error
7  Open MSG.DBS                   15 Load SOUND
8  Open SCENARIO.DBS              16 Alloc sound memory
```

This matches the embedded filename/overlay-name strings found in
`wroot.exe` and `winit.ovr` (§6.2, §6.4) almost exactly in order, and confirms
`winit.ovr` (not `wroot.exe` itself) is what performs most of this
loading (see below).

### 6.1a The CS/DS segment relationship — confirmed, unblocks all of §6

**`DS = CS + 0x0fd8` paragraphs (`= CS + 0xfd80` bytes), fixed for the
whole lifetime of the process.** Traced directly from `wroot.exe`'s own
entry code (module offset `0x4072` = file offset `0x4272`, right after
the 512-byte/`0x20`-paragraph MZ header):

```
0000:4072  bd d8 0f   mov bp, 0xfd8      ; RELOC 16 -- the ONE MZ reloc
                                          ; entry patches this word, adding
                                          ; the real load segment: bp = loadSeg + 0xfd8
0000:4075  85 ed      test bp, bp
0000:4077  75 02      jne 0x407b
0000:4079  8c dd      mov bp, ds          ; DOS-supplied initial DS (PSP segment) as fallback
0000:407b  2e 8c 1e 70 40   mov word cs:[0x4070], ds   ; save PSP segment for later argv/env use
  ... (DOS int21h/4Ah "shrink memory block" sizing, PSP:[2] top-of-memory read) ...
0000:40c6  8e d5      mov ss, bp          ; SS = loadSeg + 0xfd8
  ... (environment-block copy loop) ...
0000:416f  8e dd      mov ds, bp          ; DS = bp = loadSeg + 0xfd8  <-- the actual DS load
```

This is the standard small-model C startup idiom the tooling note
(`game-re-tooling/dos.md`) describes: `DS == SS == CS + constant`, the
constant (`0x0fd8` paragraphs) taken directly from the MZ header's own
`InitialSs` field (`e_ss = 0x0fd8`) and reused as a general-purpose
register value rather than loaded straight into `SS` by the OS loader,
because this compiler's startup stub also needs it as a plain segment
value for other setup work (memory sizing, environment-segment patching)
before finally committing it to both `SS` (`0x40c6`) and `DS` (`0x416f`).

**Verified against a real string, not just structurally.** Any `DS`-relative
operand `x` used by the program's own code corresponds to file offset
`0x200 (header) + 0xfd80 (DS base) + x`. Testing this on a real
`int 21h AH=9` call found later in the same startup routine
(`0000:41ad mov dx, 0x670; ... int 0x21`, a "print string, `$`-terminated"
call) gives file offset `0x200 + 0xfd80 + 0x670 = 0x105f0`, and the bytes
there are literally **`"8087/80287 is required!\r\n$"`** — a real,
legible, contextually-correct DOS startup error string. This is decisive:
the CS/DS relationship is no longer a hypothesis.

### 6.2 Overlay loader — confirmed (fully traced)

`wroot.exe` contains an explicit overlay-error format string:
`"Error %d loading overlay: %s$"` (file offset `0x105bb`), immediately
preceded by a **table of 11 overlay base names**, each NUL-terminated,
back-to-back: `WINIT, WBASE, WMAZE, WMELE, WPOPS, WMEXE, WTREA, WPCMK,
WPCVW, WMNPC, WDOPT`, followed by a shared `.ovr` suffix string. This is
the exact set of 11 `.ovr` files present in the corpus — confirming
filenames are built at runtime as `<name> + ".ovr"` and loaded by number
into a shared overlay memory region, with `%d`/`%s` in the error message
being the overlay's numeric slot and resolved filename.

**The full call chain is now traced**, using the §6.1a `DS` base to
convert every `DS`-relative immediate found in the loader back to a file
offset:

- **`GameStateLoop`** (module offset `0x132d`-`0x145e`, file
  `0x152d`-`0x165e`): an infinite state-machine loop. On entry it zeroes a
  global `curState` (`word [0x363a]`), then repeatedly: `mov ax, [curState];
  cmp ax, 0x1a (26); jae <no-op tail>; shl ax,1; jmp word cs:[ax + 0x1417]`
  — a 26-entry jump table at module offset `0x1417`-`0x144a` (immediately
  before the bounds-check code, i.e. the jump table is embedded inline in
  the code stream, not a separate data section). Each case pushes one
  overlay's `DS`-relative name offset (`0x5f4`=`WINIT`, `0x5fa`=`WBASE`,
  `0x600`=`WMAZE`, `0x606`=`WMELE`, `0x60c`=`WPOPS`, `0x612`=`WMEXE`,
  `0x618`=`WTREA`, `0x61e`=`WPCMK`, `0x624`=`WPCVW`, `0x62a`=`WMNPC`,
  `0x630`=`WDOPT`) and calls `LoadOverlay` (`0x36dc`); after the call, the
  loop calls a `WaitNextState` helper (`0x3640`) and jumps back to the top
  — i.e. **`curState` is not a one-shot function argument, it's a
  persistent global that both `wroot.exe`'s own code and the just-loaded
  overlay's own code read to decide what to do next** (confirmed by
  `wmaze.ovr` reading the identical absolute address `[0x363a]` at its own
  entry point, see below). The jump table's 26 slots collapse onto only a
  handful of distinct case bodies (several states share one target,
  e.g. states 5/6/23 all target the `WMAZE`-loading case) — i.e. `curState`
  encodes a specific game screen/context, of which several distinct
  screens all use the same overlay.
- **`LoadOverlay(nameOffset)`** (`0x36dc`→`0x36e9`, a thin trampoline into
  the real body): builds `"<NAME>.ovr"` (`BuildFilename` at `0x390e`, then
  a `.ovr`-suffix append at `0x38d7` using the shared `.ovr\0` string at
  `DS:0x636`), opens it (`0x3e88`, a thin `int 21h AH=3Dh` wrapper), reads
  the 14-byte header (`0x42d3`, `int 21h AH=3Fh`, count=`0xe`), validates
  it (see §6.3), computes the free-memory requirement, and loads the code
  region via `0x3817` (a direct `int 21h AH=3Fh` wrapper: `DS` is
  temporarily set to `CS` for this one call, so the destination buffer
  offset it's given, `0x4572`, is `CS`-relative — i.e. **every overlay's
  code is always loaded to the identical fixed buffer offset `0x4572`
  within the shared code/data segment**, confirmed both by this call site
  and independently by the header's own constant `+2` field, see §6.3).
  After a successful load, control transfers into the freshly-loaded
  overlay via an indirect jump through a pointer restored from the tail of
  the overlay's own code (see §6.3's `JMP WORD [ptr]` finding) — the
  overlay's entry code then re-reads the *same* `[0x363a]` global to decide
  which of its own internal handlers to run for the requested state (see
  `wmaze.ovr` below), i.e. **overlay selection and in-overlay dispatch are
  both driven by the one shared `curState` variable**, at two dispatch
  levels (which file to load, then which function inside it to call).

**`bane.bat`'s ERRORLEVEL table (§6.1)'s load order is therefore literally
this same loop's first several `curState` values in sequence** (0=`WINIT`
first, matching "1 Open SCENARIO.HDR" through the early startup checks),
not a separate mechanism.

### 6.3 `.ovr` overlay file header — confirmed, 14 bytes (corrected from 8)

> **Correction:** the previous pass under-read the header as 8 bytes based
> on where the constant magic bytes stopped looking constant. The real
> header is **14 bytes**, confirmed by disassembling `LoadOverlay`'s own
> header-validation code (§6.2): it issues one `int 21h AH=3Fh` read of
> exactly `0xe` (14) bytes into a local struct and validates 4 of its 7
> words before using the other 3. The `+4` field's semantics (previously
> only an approximate hypothesis, "roughly code size, off by 16-1346
> bytes") are now **exact**, because the missing piece was the header
> being 6 bytes longer than assumed, not the field itself being
> approximate.

```
+0   4   magic       CONSTANT across all 11 files: F2 00 72 45
+4   2   sizeA       u16 LE -- code-region byte length
+6   2   magic2      CONSTANT across all 11 files: EE 4F  (== 0x4fee)
+8   2   sizeB       u16 LE -- data/string-pool region byte length
+10  2   fieldC      u16 LE -- included in a pre-load free-memory check; role beyond that not traced
+12  2   fieldD      u16 LE -- not read in the traced code path; not resolved this pass
```

**Byte-exact invariant, verified on all 11 files, zero deviation:**
`fileSize == 14 + sizeA + sizeB`.

| Overlay | sizeA | sizeB | 14+sizeA+sizeB | fileSize | match |
|---|---|---|---|---|---|
| `winit.ovr` | 4649 | 510 | 5173 | 5173 | yes |
| `wbase.ovr` | 14802 | 114 | 14930 | 14930 | yes |
| `wmaze.ovr` | 38659 | 44 | 38717 | 38717 | yes |
| `wmele.ovr` | 19929 | 32 | 19975 | 19975 | yes |
| `wpops.ovr` | 25905 | 34 | 25953 | 25953 | yes |
| `wmexe.ovr` | 44467 | 10 | 44491 | 44491 | yes |
| `wtrea.ovr` | 30043 | 42 | 30099 | 30099 | yes |
| `wpcmk.ovr` | 23707 | 1072 | 24793 | 24793 | yes |
| `wpcvw.ovr` | 46648 | 1340 | 48002 | 48002 | yes |
| `wmnpc.ovr` | 45750 | 236 | 46000 | 46000 | yes |
| `wdopt.ovr` | 22875 | 56 | 22945 | 22945 | yes |

**The `14+sizeA` boundary is independently confirmed to be the real
code/data split** by dumping the bytes right at that computed offset for
every file: it always lands exactly on the start of a legible resource
filename string (e.g. `winit.ovr`'s boundary at file offset `0x1237`
begins `"MON00.PIC\0SOUND00.SND\0..."`, `wbase.ovr`'s begins
`"PCFILE.DBS\0MON00.PIC\0WPO..."`) — the code region ends and the
string-literal data pool begins at exactly that byte, with no gap or
overlap.

**Disassembly of the code region's own tail** (confirmed on `winit.ovr`,
whose 14-byte-header-relative code end is file offset `0x1237`) shows the
last code bytes are a genuine, complete instruction:
`0x1232: push cx` (1 byte) then `0x1233: jmp word [0x51ea]` (4 bytes,
`ff 26 ea 51`), ending precisely at `0x1237` — an indirect jump through a
function-pointer slot, i.e. **every overlay's code region ends with a
trampoline jump to its own real entry point**, consistent with
`LoadOverlay` (§6.2) transferring control there after the read completes.
This also fully explains the previously-reported "`QMON00.PIC`" string
(§6.4's old finding) — see the correction there.

**Field `+2` (the "magic1" bytes 2-3, constant `0x4572` across all 11
files) does double duty**: `LoadOverlay`'s validation code checks it (via
an unsigned `>=` comparison against the literal `0x4572`, which is always
exactly true in practice) as part of confirming the file's identity, but
the *same* stack slot is read again later, unmodified, as the destination
buffer offset for the code-region read (`push word [bp-0x10]` immediately
before the `0x3817` read call, with no intervening write) — i.e. **the
header's `+2` field isn't just a signature, it doubles as the fixed
in-buffer load offset for the code region** (`0x4572`, matching the
buffer-relative constant found independently at the `0x3817` call site in
`LoadOverlay` itself). Byte 14 onward (the code region) is genuine x86-16
machine code, confirmed via full disassembly of `winit.ovr`'s code region
(§6.2, §6.4) and a targeted disassembly of `wmaze.ovr`'s entry (§6.4).

### 6.4 Rough content map per overlay (from embedded resource-filename strings)

| Overlay | Referenced resource files | Likely role |
|---|---|---|
| `winit.ovr` | `DISK.HDR, MASTER.HDR, MISC.HDR, MSG.HDR, MSG.DBS, PCFILE.DBS, SCENARIO.HDR, SCENARIO.DBS, DRAGONSC.{EGA,CGA,T16}, GRAVEYRD.{EGA,CGA,T16}, MAZEDATA.{EGA,CGA,T16}, CREDITS.PIC, MON00.PIC, SOUND00.SND` | Startup/initialization — loads essentially every core data file; matches `bane.bat`'s load-order table (§6.1) almost item-for-item |
| `wbase.ovr` | `NEWGAME.DBS, PCFILE.DBS, SAVEGAME.DBS, SCENARIO.HDR, WPORT1.{EGA,CGA,T16}, MON00.PIC` | Party/character base management (new game creation, save/load, portrait display) |
| `wmele.ovr` | `MON00.PIC, SOUND00.SND` | Melee/combat (monster art + combat sound) |
| `wmnpc.ovr` | `MON00.PIC, SOUND00.SND` | NPC interaction |
| `wdopt.ovr` | `SOUND00.SND, MON00.PIC` | Display/dungeon options |
| `wmaze.ovr` | `SAVEGAME.DBS, SOUND00.SND` | Dungeon/maze view — **confirmed** (below), not just content-mapped |
| `wpcmk.ovr`, `wpcvw.ovr` | (no filename strings in the code region; both carry an identical embedded letter-coded data block in their data pool) | Character creation / character-sheet viewer — the shared block is confirmed as a class attribute-requirement + race-attribute table pair, see §6.6 |
| `wpops.ovr`, `wtrea.ovr`, `wmexe.ovr` | (no filename strings found) | Popup windows, treasure/inventory, and shared executable-support routines respectively — operate on already-loaded in-memory data rather than opening files directly |

> **Correction (`QMON00.PIC`, previously flagged open):** there is no
> `"QMON00.PIC"` string anywhere in `winit.ovr`. This was a false read from
> a naive whole-file string scan that crossed the code/data-pool boundary
> (§6.3): the code region's very last byte is the operand high-byte of its
> final instruction, `jmp word [0x51ea]` (bytes `ff 26 ea 51`), and `0x51`
> happens to be ASCII `'Q'`. The data pool begins immediately after with
> the ordinary, non-`Q`-prefixed string `"MON00.PIC\0"` (the standard
> `MON%02d.PIC` pattern, same as everywhere else in this corpus).
> Disassembling the code immediately before that byte confirms it's a real,
> complete, non-truncated instruction (`0x1232: push cx; 0x1233: jmp word
> [0x51ea]`), not a mis-aligned read — the `'Q'` is genuine code, not a
> stray data byte. Closed: `dosega-qmon00-pic` removed from
> `docs/wizardry6/TODO.md`.

**`wmaze.ovr`'s role — confirmed, not just content-mapped.** `wroot.exe`'s
state-machine loop (§6.2) maps three distinct `curState` values (5, 6, 23)
to the same jump-table case body, the one that loads `wmaze.ovr`; loading
it additionally forces `curState := 5` immediately beforehand (module
offset `0x1385`, `mov word [0x363a], 5`). Disassembling `wmaze.ovr`'s own
entry point (buffer offset `0x4572` = file offset 14, i.e. immediately
after its 14-byte header) shows it re-reads the *identical absolute
address* `[0x363a]` that `wroot.exe`'s own loop uses — direct proof
overlays execute in place inside the same shared data segment as the main
executable, not a separate address space:

```
000e: cmp word [0x363a], 0x17(23)   ; if curState==23: call errHandler(10); ...; call 0x3304
0025: cmp word [0x363a], 6          ;   elif curState==6: push [0x363c]; call 0x3d3   (state-6 handler, takes a param)
0034: cmp word [0x363a], 5          ;   elif curState==5: call 0x2abc                  (state-5 handler, no param)
003e: mov ax,0; ret
```

i.e. **the overlay-load dispatcher and the loaded overlay's own entry
code perform a two-level dispatch off the one shared `curState` global**:
the outer loop in `wroot.exe` decides *which file* to load, and the
freshly-loaded file's own entry immediately re-examines the same variable
to decide *which internal handler* to run. A few lines further into
`wmaze.ovr`'s entry, two file handles are lazily opened and cached (guard
flags at `[0x4eeb]`/`[0x4eea]`, filename offsets read from `[0x3304]`/
`[0x3306]` — near-certainly `SAVEGAME.DBS` and `SOUND00.SND`, this
overlay's only two embedded resource-filename strings, §6.4's table
above), then a per-event/per-view table at buffer offset `0x7d2` is
indexed by `[0x363c]*4` (a second, per-call parameter distinct from
`curState`) to fetch a far pointer used for further dispatch. This
confirms `wmaze.ovr` is the dungeon/maze-view handler (as content-mapped),
lazily opens the save file and a sound bank on first entry, and dispatches
internally through an event/view table keyed by a secondary parameter —
consistent with `seer/docs/walker.md`'s expectation of a slot-indexed
compositor, though the table's own contents (which events, which
far-pointer targets) were not traced further this pass; full internal
rendering-loop tracing is out of scope for this session's depth (a future
pass following `seer/docs/walker.md`'s architecture could resume from buffer
offset `0x7d2`'s table).

### 6.4a `wmaze.ovr`'s state-5/state-6 handler bodies — confirmed

**This session traced both handlers named in the previous pass's "not
attempted" note (`0x3d3` for `curState==6`, `0x2abc` for `curState==5`)
line-by-line**, using the file-offset-as-address convention established in
§6.2/§6.3 (near `CALL`/`JMP` operands whose computed target falls inside
`[0, fileSize)` reference real code in this same file — confirmed twice by
disassembling both targets and finding genuine function prologues
(`push bp; mov bp, sp`) at exactly the addresses `wroot.exe`'s dispatcher
pushes; targets that wrap outside the file's own byte range are calls into
a resident helper library living elsewhere in the shared segment, not
resolved this pass, see below).

> **Correction to the `0x7d2` table's description above:** it is not "a
> far pointer used for further dispatch" — traced to its actual consumer
> (`sub_42` at file offset `0x42`, wmaze's lazy-file-open routine, called
> from both handlers), it is a **4-byte-stride array of two-word field
> descriptors**, one entry per `[0x363c]` event-parameter value, passed
> together with the cached `SAVEGAME.DBS` handle/pointer to a resident I/O
> helper (`call` target `0xbb9a`, outside this file, not traced further)
> for reading/writing one field of the current savegame record. A second,
> structurally identical 4-byte-stride table at buffer offset `0x80a`
> (immediately following, `0x7d2 + 14*4`) serves the same role for
> `SOUND00.SND` via the same helper — i.e. **wmaze.ovr keeps one
> field-descriptor table per lazily-opened resource file**, not one
> generic dispatch table.

**`sub_42` (file offset `0x42`) — lazy resource-file opener, confirmed.**
Opens `SAVEGAME.DBS` (via filename offset `[0x3304]`) and `SOUND00.SND`
(via `[0x3306]`) on first use, each guarded by its own one-shot flag
(`[0x4faa]`/`[0x4fa8]` cache the returned handle, `[0x4eeb]`/`[0x4eea]`
the "already opened" flags). After opening `SAVEGAME.DBS`, it immediately
reads two per-region byte fields from the **mazedata level record**
(pointer `[0x4faa]`, indexed by current region `[0x4f9c]`) at **new
offsets `+0x1e0` and `+0x1ec`**, adds them to the player's local region
coordinates (`[0x4fa0]`=local X, `[0x4f9e]`=local Y, both already read
elsewhere in this handler chain) and stores the sums at `[0x4fa4]`/
`[0x4fa2]` — i.e. **`+0x1e0`/`+0x1ec` are per-region origin-offset bytes,
added to a local 0-7 in-region coordinate to produce a global maze
coordinate**, the DOS-side confirmation of the Amiga corpus's "12 fixed
8x8-cell regions/level placed via an origin table" mechanism, now with
concrete field offsets and the exact consumer.

**State-6 handler (`0x3d3`, `curState==6`) — "entering a maze level",
confirmed.** Two parts:

1. If the caller's own `[0x363c]` parameter is negative, transitions
   straight to `curState:=7` and returns (early-out path, not traced
   further). Otherwise:
2. Calls `sub_42` (opens `SAVEGAME.DBS`/`SOUND00.SND` if not already
   open), sets `curState:=7` pending, then runs **two independent scan
   loops** before falling through to a shared tail (`curState:=5`,
   `jmp 0x3f9`):
   - **Entity-placement loop** (outer `si` = region 0-11, `cmp si,0xc`,
     matching the confirmed "12 fixed 8x8-cell regions/level"): for each
     region, reads `byte[scenarioEntityBase + si + 0x6c0]` to get a
     starting entity-slot index `di`, then walks `di` forward
     (`byte[...+ di + 0x510] == si` as an ownership check, i.e. **entities
     belonging to one region are stored contiguously and `+0x6c0[region]`
     is the start index of that run** — a sharper characterization of the
     Amiga corpus's already-confirmed "`+0x6c0` per-region entity-start-index
     table" than a bare index lookup) until the region key no longer
     matches. For each entity that also has `byte[...+di+0x360] != 0`
     (active/kind byte, same field the Amiga corpus calls the "kind
     byte"), stamps a marker into a **separate per-cell buffer at buffer
     offset `0x4e68`** (distinct from the wall/feature buffer at
     `0x4e08`, see below) at a cell computed from
     `byte[...+di+0x480]*8 + byte[...+di+0x3f0]` — cross-platform
     confirmation, from independent DOS disassembly, of the Amiga
     corpus's `scenario.dbs` section-3 entity fields `+0x360`
     (kind/active), `+0x3f0`/`+0x480`/`+0x510` (coordinate/region keys),
     and `+0x6c0` (per-region index) all being single-byte fields at
     these exact offsets, consumed here to place monster/NPC markers on
     specific dungeon cells when a level loads.
   - **Door-stamping loop** (`di`=0-4 outer, `si`=0-11 inner, index
     `si*5+di`, i.e. **5 slots per region across the same 12 regions**):
     reads two words per slot from the mazedata level record (pointer
     `[0x4faa]`) at `+0x4fa` and `+0x512` via a resident "get word" helper
     (`call` target `0xe3c1`, not traced further) — the first DOS-side
     disassembly-confirmed semantics for these two fields, previously
     unidentified on the Amiga side too (`amiga/data-structure.md`'s
     `maze-plane-semantics` item lists `+0x4fa`/`+0x512`/`+0x52a` as
     unidentified per-region word arrays). If the two words sum to a
     positive value, calls `sub_1d1(region=si, y=+0x4fa value,
     x=+0x512 value, kind=1)` — i.e. **`+0x4fa`/`+0x512` are a per-region,
     up-to-5-entry list of (Y,X) cell coordinates that get feature-code
     `1` stamped onto them** when the level loads (a `+0x52a` third array
     was not referenced by this particular loop; still unlocated). The
     hardcoded `kind=1` value that gets stamped is the
     same value the state-5 handler below treats as a trigger condition —
     strong internal evidence `1` marks a specific interactive-tile type
     (working label: "closed door", pending confirmation from a message
     string or item name, not attempted this pass).

**`sub_1d1` (file offset `0x1d1`) — `SetMazeCell(region, y, x, value)`,
confirmed.** Normalizes `y`/`x` into 0-7 via `((coord + 8) mod 8)`
(handles negative deltas from neighbour-cell addressing, conceptually the
DOS-side counterpart to the Amiga corpus's confirmed
facing/coordinate-delta/plane mapping), computes cell index
`region*64 + y*8 + x` into the wall/feature buffer at `0x4e08`, reads the
current value via the same resident "get cell" helper the state-5 handler
uses (`call` target `0xe34b`), and only if the value differs, writes the
new one via a resident "set cell" helper (`call` target `0xe31d`) — a
read-modify-write primitive, not an unconditional store.

**State-5 handler (`0x2abc`, `curState==5`) — "per-step/enter maze view",
confirmed.** Updates a running high-water-mark variable (`[0x4ee8]`) from
`byte[scenarioEntityBase + currentRegion + 0x6c0]` (bookkeeping, role
beyond "max touched index" not traced); conditionally calls
`sub_1d1(region=[0x4f9c], y=[0x4fa0], x=[0x4f9e], kind=0)` to **clear** a
cell (the mirror operation of the state-6 door-stamping loop above);
computes the player's *current* cell index the same way `sub_1d1` does
(`region*64 + y*8 + x` from `[0x4f9c]`/`[0x4f9e]`/`[0x4fa0]`) and reads its
value from the `0x4e08` buffer via the `0xe34b` helper — **if the value is
exactly `1`** (the same code the state-6 loop stamps), it transitions to
`curState:=0xa` (10), a different overlay/state than the maze view itself
— consistent with `curState==10` being `wpops.ovr`'s "popup windows" role
per §6.4's content map (a door-interaction popup), though this specific
mapping (state 10 -> `wpops.ovr`) was not independently re-confirmed
against `wroot.exe`'s jump table this pass.

**Not traced further this pass** (reasonable stopping point for "one
layer down", not a dead end): the resident helpers at call targets
`0xbb9a`, `0xe34b`, `0xe31d`, `0xe3c1`, `0xc47e` (errHandler),
`0xf34c`/`0xf9ba`/`0xf4be`/`0xcbc0`/`0xbedc`/`0xe31d`/`0xe4ff` (all fall
outside `wmaze.ovr`'s own file bounds when decoded with the same
file-offset convention that correctly resolved every in-file target,
strong evidence they live in a permanently-resident portion of the shared
segment — most likely `wmexe.ovr`, whose content-map role is already
"shared executable-support routines"); `sub_925`, `sub_184`, `sub_117`,
`sub_5367` (called from the state-5/6 handlers but not disassembled); the
`+0x52a` mazedata field; and the exact contents of the `0x7d2`/`0x80a`
field-descriptor tables (which `[0x363c]` values are actually used by
real callers wasn't enumerated).

> **Correction (resident-helper location):** the "most likely `wmexe.ovr`"
> guess above is **refuted** — see §6.4b. The resident library is inside
> `wroot.exe` itself, and every one of these specific call targets is now
> resolved to a named `wroot.exe` module offset: `0xbb9a`→`0xfe`
> (5-argument savegame/sound field-I/O wrapper), `0xe34b`→`0x28af`
> (`GetMazeCell`-family read primitive), `0xe31d`→`0x2881` (`SetMazeCell`
> write primitive, byte-identical prologue to `0x28af`), `0xe3c1`→`0x2925`
> (mazedata word-field reader, consumed by the door-stamping loop for
> `+0x4fa`/`+0x512`), `0xc47e`→`0x9e2` (re-identified below, **not** an
> error handler), `0xf9ba`→`0x3f1e` (signed-magnitude/`abs` idiom typical
> of a compiler-runtime 32-bit division helper, not game-specific),
> `0xf34c`→`0x38b0`, `0xf4be`→`0x3a22`, `0xcbc0`→`0x1124`, `0xe4ff`→`0x2a63`
> (also called directly by `wroot.exe`'s own code near `GameStateLoop`'s
> tail, independent cross-confirmation). `sub_925`/`sub_184`/`sub_117`/
> `sub_5367` were not re-examined this pass.
>
> **Correction (`errHandler` mislabel):** `0xc47e` (module offset `0x9e2`
> in `wroot.exe`) is **not** an error handler. Disassembled in full: `if
> (arg <= 0) return 0; else return Rand() % arg` (calls a further resident
> function at `0x2556` for the raw random value, then `idiv`s by the
> argument and returns the remainder) — a classic `RandomRange(n)`
> primitive. The state-23 call site (`push 0xa; call errHandler` in the
> old reading) is therefore `RandomRange(10)`, not an error display. This
> is `wroot.exe`'s single most heavily used resident function across the
> whole overlay corpus after the one at module offset `0x30b` (308 and 564
> call sites respectively, out of 9,251 total near-relative `CALL`
> instructions across all 11 overlays — see §6.4b), consistent with a
> generic RNG utility, not a rare error path.

### 6.4b The resident-code library lives in `wroot.exe` itself — confirmed, `wmexe.ovr` hypothesis refuted

**This session's primary target.** Every overlay's "resident helper"
calls (§6.4a's "not traced further" list, and its counterparts in every
other overlay) turn out to resolve into `wroot.exe`'s own permanently-
loaded code, not into `wmexe.ovr` or any other overlay. `wmexe.ovr` was
the strongest prior lead (content-mapped as "shared executable-support
routines" purely because it has zero embedded filename strings) — it is
now disassembled and shown to be an **entirely ordinary, swappable
overlay**, structurally indistinguishable from `wmaze.ovr`: it loads to
the identical buffer offset `0x4572` as every other overlay (§6.3), and
its own out-of-file-bounds calls resolve into `wroot.exe` at exactly the
same rate and via exactly the same addressing convention as every other
overlay's. There is no dedicated "library overlay" — `wroot.exe` itself
*is* the resident library, which makes sense in retrospect: it is the one
file guaranteed to be memory-resident for the entire process lifetime.

**The address-translation formula (derived and verified this session).**
A near-relative `CALL`/`JMP` (`E8`/opcode-relative) instruction inside an
overlay's own code region encodes a *position-dependent* displacement:
the assembler/linker computed it assuming the overlay's code sits at its
real runtime location, buffer offset `0x4572` (§6.3), not at file offset
14 (where a naive "address = file offset" reading places it). For calls
that stay **within** the same overlay file, this doesn't matter — the
displacement is invariant under any *consistent* choice of coordinate
origin, so the "naive" convention already used in §6.2/§6.3/§6.4a happens
to give the right in-file answer by construction (this is a structural
tautology of relative addressing, not evidence about the true runtime
base — confirmed by re-deriving it explicitly this session, not simply
assumed). For calls that leave the overlay's own bounds, the naive
convention is **off by a constant** from the true target, because the
true displacement was computed against the real buffer position, not file
offset 14. The correct formula, derived from first principles and
verified against real code (below):

```
addr_after      = file_offset_of_call_instruction + instruction_length   (3 for E8 rel16)
real_buf_after  = 0x4572 + (addr_after - 14)                             ; 14 = .ovr header size
true_target     = (real_buf_after + signed_displacement) mod 0x10000     ; true CS-relative offset
```

Equivalently, `true_target = (naive_apparent_target + 0x4564) mod 0x10000`
— a fixed additive correction, since `0x4564 = 0x4572 - 14`. Because
`wroot.exe`'s own MZ entry point is `CS:IP = 0000:0x4072` (§6.1a) — i.e.
its load module starts at logical offset 0 in the same shared `CS`
segment every overlay's code buffer also lives in — `true_target` **is
already `wroot.exe`'s own module offset** whenever it falls inside
`wroot.exe`'s module range (`[0, fileSize-0x200) = [0, 0x1043E)`); no
further conversion is needed to locate it in `wroot.exe`'s file
(`wrootFileOffset = true_target + 0x200`, the MZ header size), and r2's
own default address display for `wroot.exe` (MZ-aware) already equals
module offset directly.

**Verified two ways.** (1) First found by hand: `wmaze.ovr`'s call to
naive target `0xcbc0` (file offset `0x3e6`, bytes `e8 d7 c7`) resolves via
the formula to true target `0x1124`; disassembling `wroot.exe` at module
offset `0x1124` finds a genuine function prologue (`push bp; mov bp,sp;
add sp,0xffe8`) with two word parameters, and `wroot.exe`'s *own* code
independently calls the exact same address (`0x1124`, with literal args
`(0,3)`) right after loading the `WINIT` overlay in `GameStateLoop` —
independent, structurally unrelated confirmation that `0x1124` is a real,
meaningful `wroot.exe` function. (2) Applied systematically: disassembled
every overlay's full code region (`r2 pDj`), extracted all `E8`
near-relative `CALL` instructions, and classified each target as
in-overlay-file, in-`wroot.exe`, or unresolved:

| Overlay | Total `CALL`s | In-file | Into `wroot.exe` | Unresolved |
|---|---|---|---|---|
| `winit.ovr` | 223 | 65 | 158 | **0** |
| `wbase.ovr` | 550 | 118 | 432 | **0** |
| `wmaze.ovr` | 1157 | 444 | 713 | **0** |
| `wmele.ovr` | 328 | 128 | 200 | **0** |
| `wpops.ovr` | 523 | 156 | 367 | **0** |
| `wmexe.ovr` | 847 | 557 | 290 | **0** |
| `wtrea.ovr` | 793 | 300 | 493 | **0** |
| `wpcmk.ovr` | 891 | 421 | 470 | **0** |
| `wpcvw.ovr` | 1303 | 504 | 799 | **0** |
| `wmnpc.ovr` | 1151 | 491 | 660 | **0** |
| `wdopt.ovr` | 485 | 163 | 322 | **0** |
| **Total** | **9251** | **3347** | **5904** | **0** |

Every single one of 9,251 near-relative `CALL` instructions across all 11
overlay files resolves cleanly, zero exceptions — as decisive a
confirmation as this corpus offers of both the formula and the "library
lives in `wroot.exe`" conclusion. 84 distinct `wroot.exe` addresses are
called this way across the whole corpus (the resident library's real
size, at least at the granularity of direct-call entry points).

**Named resident functions** (module offset in `wroot.exe`; all verified
by disassembling a real prologue at the target, several cross-confirmed
by a second, independent call site):

| `wroot.exe`+ | Calls (corpus-wide) | Role | Confidence |
|---|---|---|---|
| `0x30b` | 564 | **Refined from hypothesis to confirmed**: `SetWindowCursor(win, col, row)` — `win[6] = col mod win[0]`, `win[7] = row mod win[1]`, where `win[0]`/`win[1]` are a window struct's width/height and `win[6]`/`win[7]` its cursor column/row (see the new §6.4c window-subsystem writeup) — not a generic "coordinate helper", a specific member of that subsystem and its single most-called primitive | confirmed |
| `0x9e2` | 308 | `RandomRange(n)`: `if(n<=0) return 0; else return Rand()%n` (calls `0x2556` for the raw value) — corrects the previous "`errHandler`" label, see correction block above | confirmed |
| `0x28af` | 101 | `GetMazeCell`-family read primitive (2 args, bit-shift setup `cl=3`) — the "get cell" helper `sub_1d1`/state-5 call at naive target `0xe34b` | confirmed (role); exact bit layout not re-derived |
| `0x2881` | (not independently counted; same cluster as `0x28af`) | `SetMazeCell`-family write primitive, byte-identical prologue to `0x28af` — naive target `0xe31d` | confirmed (role) |
| `0x2925` | 129 | Mazedata word-field reader (odd `ch=cl` bit trick) — naive target `0xe3c1`, the door-stamping loop's `+0x4fa`/`+0x512` reader | confirmed (role) |
| `0xfe` | 8 | 5-argument thin wrapper (tail-calls `0x387a`) — the savegame/sound per-field I/O helper referenced by the `0x7d2`/`0x80a` field-descriptor tables, naive target `0xbb9a` | confirmed (role) |
| `0x2a63` | 91 (+1 direct call from `wroot.exe`'s own code) | **Refined from hypothesis to confirmed, and sharply narrowed**: `RefreshAllWindows()` — walks the window linked list at `CS:0x1bd2` (the `lea di,[0x1bd2]; mov si,cs:[di]` this row previously flagged as a bare "table-lookup helper" is this function's own list-walk, not a separate lookup primitive), calls `RefreshWindow` (`0x2b19`, §6.4c) on every live window, then performs a final full-screen attribute-clear-and-flip pass through the video-driver vectors `cs:[0x1b92]`/`cs:[0x1ba6]` — the master "redraw everything and flip" driver, called after most game actions | confirmed |
| `0x390e` | 90 | `BuildFilename` — already confirmed by role in §6.2 (`LoadOverlay`'s `"<NAME>.ovr"` construction); its call count here (90 sites across the corpus) is an independent cross-check that the formula and target-naming are both correct | confirmed |
| `0x38b0` | 67 | Block-memory routine (`pushf; cld; es=ds; di=[bp+4]`) — string/memcpy-shaped, naive target `0xf34c`; new this session: it's `0x11a`'s (`CreateWindow`, §6.4c) block-fill primitive for a window's trailing escape-code bytes, called as `f(dst, len, fillByte)` | hypothesis (role narrowed) |
| `0x3f1e` | (uncounted, low) | No `bp` frame; `test dx,dx; jns; neg dx; neg ax; sbb dx,0` — the classic sign/absolute-value preamble of a compiler-runtime 32-bit division helper, not game logic — naive target `0xf9ba`; disassembled in full this session: after sign-normalizing both operands it tail-calls `0x3f78` (not traced) for the actual unsigned divide, then re-applies the sign — a generic compiler-runtime `ldiv`-family helper | confirmed (shape) |
| `0x1124` | (called from `wroot.exe` itself + `wmaze.ovr`) | 2-arg classification helper, called with literal args `(0,3)` right after `GameStateLoop` loads `WINIT` — naive target `0xcbc0` | hypothesis (role not determined) |

23 further resident targets were characterized this session (see §6.4c
below and the summary table there) — a text/window display subsystem
(13 functions), 3 DOS/runtime-service wrappers, and several smaller
helpers — bringing the total named/characterized fraction of the 84
distinct resident call targets to roughly 35 (~42%). The remaining ~49
were not individually characterized this pass — this is a large
(tens-of-KB, per §6.5's own scoping note) shared library and full semantic
decode of every entry point is out of scope for one session. Per-function
semantics can be filled in incrementally by future passes using the same
formula, applied at whichever call site is of interest.

### 6.4c The text/window display subsystem — confirmed, 13 resident functions named

**This session's primary new find on the resident-library side.** Tracing
the previously-uncharacterized high-frequency `wroot.exe` targets (by
corpus-wide call count, using the same address-translation formula and a
capstone-based disassembler probe, `/tmp/.../dosega_disas.py`, not
committed — throwaway per Method §3) surfaced a single coherent
subsystem: an in-memory array of "window" control structs, each an
8-byte fixed header plus a mode-dependent variable trailer, registered in
a singly-linked list at `CS:0x1bd2` and rendered into an off-screen
character+attribute buffer at segment `CS:[0x1b60]` (40-byte row stride —
`320/8`, the EGA planar byte-per-row convention already established
elsewhere in this corpus) before being blitted to real video memory
through a cluster of indirect `lcall cs:[...]` vectors at `CS:0x1b8a`-
`0x1bc6` (most plausibly slots filled in from the selected `.drv`'s own
"`CALL rel16 ; RETF`" export trampoline table, per §7's driver-dispatch
note — not independently confirmed by disassembling a `.drv` file this
session).

**Window struct layout** (offsets relative to a window's own base
pointer, recovered from `0x11a`'s constructor and cross-checked against
every consumer's field use):

```
+0   1   width        (columns)
+1   1   height        (rows)
+2   1   origin/col arg (from CreateWindow's 1st positional arg)
+3   1   origin/row arg (from CreateWindow's 2nd positional arg)
+4   1   arg4 (role not traced)
+5   1   flags -- bit0: "positioned"/claimed; bit1: consumed by 0x2b19's ownership check
+6   1   cursor column (0..width-1, wrapped by 0x30b / by the PutChar primitives' own inline wrap)
+7   1   cursor row    (0..height-1, wrapped the same way)
+8+  N   mode-dependent trailer: either literal escape-code bytes (ESC=0x1B
         among them, for text-entry-field windows) or, when the
         "extra data" flag is set at construction time, width*height WORDs
         of per-cell content starting at +0x10
```

**Functions named this session** (module offset in `wroot.exe`; role
confirmed by full disassembly of the body, not just the prologue):

| `wroot.exe`+ | Corpus calls | Role |
|---|---|---|
| `0x11a` | 47 | `CreateWindow(x, y, width, height, flags, mode)` — allocates a struct via the new-found allocator `0x3a22` (size depends on `mode`: fixed 0x14 bytes, or `width*height*2+0x14` when the "extra per-cell data" flag is set), zeroes the cursor fields, stores the 6 arguments into the fixed header, and for `mode` values `-1`/`-2` initializes the trailer (`0x38b0`) with fixed escape-code bytes (`0x1B`=ESC among them — the control-code set for an editable text-entry field). Calls the error path (`0xd5`, arg `0xb`=11) if the allocator returns 0. |
| `0x2a63` | 91+1 | `RefreshAllWindows()` — see the corrected table entry above |
| `0x2b19` | 38 | `RefreshWindow(win)` — the master per-window blit: for every character cell in the window's rectangle (accounting for the CGA/EGA/Tandy width-mode trio `CS:[0x1b4e]`/`[0x1b4f]`/`[0x1b50]` also read by the `PutChar` pair below), reads the offscreen attribute byte, validates its high-nibble ownership stamp against the window's own registry index, and dispatches through `cs:[0x1b8e]`/`cs:[0x1b8a]` (draw-glyph driver vectors) when valid. **Contains the game's display-integrity fail-safe**: if the stored attribute's low nibble is outside `0..4`, it prints a `$`-terminated message at `CS:0x2f02` via `int 21h AH=9` and terminates the process via `int 21h AH=4Ch AL=FFh` — i.e. a detected-corruption abort, not an ordinary code path. |
| `0x23e3` | 97 | `PutChar(win, char, attr)` (unsigned-attribute variant) — computes the window's current cell address (`row*width+col`, from the linked-list-confirmed struct), writes `char`/`attr` into the offscreen buffer's per-cell WORD array (`win+0x10 + cellIndex*2`) when the "extra data" mode is set, then advances/wraps the cursor (`col = (col+1) mod width`; on wrap, `row = (row+1) mod height`) — the same wrap arithmetic `0x30b` performs generically |
| `0x22b7` | 87 | `PutChar` (signed-attribute variant) — structurally identical to `0x23e3`, but sign-normalizes the `attr` argument first and left-shifts it into the high nibble (`shl ah,4`) instead of a plain byte copy — a different attribute-packing convention for the same primitive |
| `0x251d` | 84 | `PrintString(win, str, attr)` (unsigned variant) — walks a NUL-terminated byte string at an absolute pointer and calls `0x23e3` once per non-NUL byte |
| `0x24e9` | 83 | `PrintString` (signed variant) — exact twin of `0x251d`, calling `0x22b7` per byte instead |
| `0x32be` | 68 | `ClearWindow(win)`/stamp-fill: zeroes the cursor fields, stamps this window's ownership id (`0x80 | registryIndex`) onto every offscreen cell in `0..999` (`25×40`, the full screen grid) whose low 7 bits currently match the window's own index, then `rep stosw`-fills the window's own rectangle with a space/attribute pattern |
| `0x3118` | 73 | Positional reflow ("`AutoPositionWindows`"): marks the just-created window as positioned (`win[5] |= 1`), re-stamps its ownership id across the full 1000-cell grid, then walks every *other* registered window lacking the "positioned" flag and claims any still-unowned cells in that window's own rectangle — an automatic tiling/z-order layout pass run whenever a new window is created |
| `0x31d1` | 66 | Ownership-release scan: clears the window's flags bit 0, then for each of its rows scans the offscreen buffer clearing cells still stamped with this window's id — the release counterpart to `0x32be`'s claim |
| `0x303e` | (called via `0x2d2`, not independently counted) | `RemoveWindow(win)` — unlinks the struct from the `CS:0x1bd2` list (array compaction, shift-left), decrements/clears its ownership stamps across the 1000-cell grid, then re-runs the `0x3118`-style reflow pass for the remaining unpositioned windows |
| `0x3b20` | (called via `0x2d2`) | Heap-block validity/free helper — reads a 2-byte tag word immediately *before* the passed pointer and returns `-1` if its bit 0 is clear; paired with `0x303e` in `0x2d2`'s teardown sequence (unlink, then presumably free) |
| `0x2d2` | 74 | `DestroyWindow(win, doRefresh)` — composite wrapper: `0x303e` (unlink+unstamp) then `0x3b20` (free-tag check), and conditionally `0x2a63` (`RefreshAllWindows`) if `doRefresh` is nonzero |
| `0x83f` | 44 | `Puts`/window-`printf` wrapper: formats into an 80-byte stack scratch buffer via `0x75b` (not traced), then dispatches to `0x251d` or `0x24e9` depending on whether a width argument is `>= 0x10` |
| `0x9fb` | 38 | `RedrawWindow(win, flag)` top-level: conditionally calls `0x3118` (reflow), selects a border-character variant (`0x1e` vs `0x1c`) by comparing the window pointer against a static "focused window" slot at `CS:0x3342`, fills via `0x32be`, refreshes via `0x2b19`, and conditionally releases via `0x31d1` |

**Two supporting DOS/runtime-service wrappers found in the same trace**
(not part of the window subsystem itself, but discovered by following its
callees):

| `wroot.exe`+ | Corpus calls | Role |
|---|---|---|
| `0x400f` | 56 | `strlen(ptr)` — textbook `repne scasb` with `ES=DS`, `CX=0x7FFF`, returns `di-bx-1` |
| `0x3a22` | (called by `0x11a`; not independently counted) | Heap allocator (`malloc`-style): aligns the requested size up to even, lazily initializes a free-list head at `CS:0x6c6` on first use, walks the free list from `CS:[0x6c4]` to the heap-end sentinel `CS:[0x65a]`, and on exhaustion requests 1024 more bytes via `0x44a5` (itself an `int 21h AH=4Ah`-style grow-block wrapper). **Corrects an adjacent mix-up**: this address was not previously in the named table; the *previous* pass's `0x3f1e` entry's "no `bp` frame, sign/abs preamble" description is unrelated to this function (0x3a22 has a normal `push bp; mov bp,sp` frame) — the two were disassembled independently this session and do not overlap, no correction to `0x3f1e`'s own row was needed once re-verified directly |
| `0x4309` | 28 | `CloseFile(handle)` — thin `int 21h AH=3Eh` wrapper, stashes the DOS error code to `CS:0x660` and returns `-1` on failure |
| `0x3970` | (called from `wroot+0x0`'s cleanup loop) | `FreeMemBlock(segment)` — thin `int 21h AH=49h` wrapper |

**One more named function outside the window subsystem, found by tracing
`0xd5`'s (the allocation-failure error path used by `0x11a`) own body**:
`wroot+0x0` is a **shutdown/cleanup routine**: iterates a 14-slot table
(`DS:[bx+0x7d2]`/`[bx+0x7d4]` and `DS:[bx+0x80a]`/`[bx+0x80c]`, two
segment/handle word-pairs per slot — **not** the same table as
`wmaze.ovr`'s CS-relative `0x7d2`/`0x80a` field-descriptor tables from
§6.4a, despite the coincidentally identical small offsets; this one is
`DS`-relative, a different physical location entirely), freeing each
non-zero pair via `0x3970`, then closes two file handles cached at
`CS:0x842`/`0x844` via `0x4309`, sets an error-state flag, dispatches
through an inline jump table, and finally calls the already-known
`WaitNextState` (`0x3640`). Called from `0xd5(errCode)` before `0xd5`'s
second call (`0x42ab`, which chains an indirect vector `[0x68a]` and
`0x41b6` — presumably the actual message-print-and-terminate path,
not traced further this session).

**Two smaller, lower-confidence finds, not part of either cluster above**:
- `0x2643` (25 calls) — `IsAcceptableChar(mode, char)`: an input-field
  keystroke filter, reading a small "current field" descriptor at
  `CS:0x262b` and range-checking the candidate byte against either a
  generic printable-ASCII range or a digit-plus-control-code set
  depending on the caller's mode — the validator half of the
  text-entry-field windows `0x11a` constructs (their ESC-byte trailer is
  the corresponding control-code table).
- `0xaaa`/`0xc16` (60/103 calls) — an attribute/colour resolution helper
  pair: `0xaaa` double-indexes two small tables (`CS:0x334e`, stride 5;
  and a mode byte at `CS:0x3590`) with a conditional halving, and `0xc16`
  writes 4 caller-supplied bytes into a 4-byte-stride table at
  `CS:0x3598` indexed by its first argument — plausibly a per-window or
  per-video-mode colour/attribute-scheme table, not resolved further this
  session.

**Verification**: every function above was disassembled to a genuine
`push bp; mov bp, sp` prologue (or, for the 3 DOS-wrapper leaf functions,
a short non-framed body ending in a clean `ret`) at the exact address the
call-census formula predicted, and every cross-reference between these
functions (e.g. `0x11a` calling `0xd5` calling `wroot+0x0` calling
`0x3970`/`0x4309`; `0x83f` calling `0x251d`/`0x24e9`; `0x2d2` calling
`0x303e`/`0x3b20`/`0x2a63`) was confirmed by direct disassembly of both
ends of the call, not inferred from naming alone. `0x30b`'s and `0x2a63`'s
existing table rows (this session's two direct refinements of a prior
pass's hypotheses) were independently re-derived from scratch this
session before comparing against the prior wording, not assumed correct
and merely relabeled.

### 6.5 What wasn't attempted

**Resolved this session** (previously the entry for this section): the
CS/DS segment relationship blocker is now closed, see §6.1a. Full
disassembly of `wroot.exe`'s overlay-load state machine (§6.2), the
`.ovr` header format (§6.3), and `wmaze.ovr`'s entry dispatch (§6.4 above)
are all now traced and confirmed using that resolved base.

**Resolved this session (second pass)**: `wmaze.ovr`'s `0x3d3` (state-6,
"entering a maze level") and `0x2abc` (state-5, "per-step/enter maze
view") handlers, `sub_1d1` (`SetMazeCell`), and `sub_42` (lazy
resource-file opener) are all now traced and confirmed — see §6.4a. This
also gave DOS-side confirmation of the Amiga corpus's `scenario.dbs`
`+0x360`/`+0x3f0`/`+0x480`/`+0x510`/`+0x6c0` entity fields and the first
disassembly-confirmed semantics for mazedata's `+0x4fa`/`+0x512`
per-region word arrays and two new fields (`+0x1e0`/`+0x1ec`, per-region
origin offsets).

**Resolved this session (third pass)**: the resident-helper-location
question is closed — see §6.4b. The library lives in `wroot.exe` itself
(confirmed corpus-wide: all 9,251 near-relative `CALL` instructions across
all 11 overlays resolve, zero exceptions), not `wmexe.ovr` (which is now
disassembled and confirmed to be an ordinary swappable overlay, not a
resident-code host). 11 of the specific call targets left unresolved by
§6.4a are now named `wroot.exe` module offsets, including a correction
of the previous "`errHandler`" label to `RandomRange(n)`.

**Still not attempted**: `winit.ovr`'s individual file-loading call
sequence beyond the filename table already read from its data pool; most
of every overlay's internal body beyond entry dispatch (`wbase.ovr`,
`wmele.ovr`, `wpops.ovr`, `wtrea.ovr`, `wmexe.ovr`, `wpcmk.ovr`/`wpcvw.ovr`
beyond the §6.6 data block and dispatchers, `wmnpc.ovr`, `wdopt.ovr`); full
semantic decode of the ~73 uncharacterized `wroot.exe` resident functions
(§6.4b); `wmaze.ovr`'s own `sub_925`/`sub_184`/`sub_117`/`sub_5367` and the
`0x7d2`/`0x80a` field-descriptor tables' actual contents. Each of these is
a tens-of-KB body and tracing one fully is a session-scale effort in its
own right, out of scope here. `sub_390e` (`BuildFilename`) and `sub_38d7`
(`.ovr`-suffix append) inside `LoadOverlay` were identified by call-site
role but not disassembled line-by-line (their behavior is unambiguous
from their call-site arguments and effects, so this wasn't necessary to
close the open items) — `sub_390e`'s identity is now additionally
cross-confirmed by call-count (90 sites corpus-wide, §6.4b).

### 6.6 `wpcmk.ovr`/`wpcvw.ovr` shared data block — confirmed (class-requirement table), corroborated but not row-mapped (race table)

Both overlays' data pools contain the same set of letter-coded tables,
though not at byte-identical relative file offsets (`wpcvw.ovr`'s copy is
shifted by a data-pool layout difference specific to that file — see
below) — comparing the tables' own *content*, not raw file position, is
what confirms they're the same data.

**Table layout** (found in `wpcmk.ovr`'s data pool immediately after a
`"PCFILE.DBS\0   \0"` lead-in; `wpcvw.ovr` carries the same tables after
its own, different lead-in):

| Block | Rows | Cols | Alphabet | Present in |
|---|---|---|---|---|
| 1 | 14 (**revised from "~30 tokens"**) | 4 | ASCII `'0'`/`'1'` digit strings, fixed widths 10/7/5/8 | `wpcmk.ovr` only |
| 2 | 14 (×2, byte-identical repeat) | 8 | `A`-`P` (values 0-15) | both, byte-identical |
| 3 | 11 | 8 | `A`-`P` | both, byte-identical |
| 4 | 10 | 14 | `A`-`K` (values 0-10) | both (letters only); `wpcvw.ovr` additionally carries a companion `'0'`-`'3'` digit row per entry that `wpcmk.ovr` lacks |

**Block 2 — confirmed: per-class attribute minimum-requirement table.**
14 rows, in exactly the corpus's already-confirmed 14-class order
(`FIG, MAG, PRI, THI, RAN, ALC, BAR, PSI, VAL, BIS, LOR, SAM, MON, NIN`
— `amiga/data-structure.md`'s roster). Each row is 8 ASCII letters, read
as base-26 values (`A`=0 .. `Z`=25). Column semantics match Wizardry's
canonical 7-attribute order (`STR, IQ, PIE, VIT, AGI, DEX, LUK`) plus one
always-zero 8th column, cross-validated against real class lore:

| Class | Row | Nonzero columns (value) | Matches known class identity |
|---|---|---|---|
| FIG | `MAAAAAAA` | STR=12 | Fighters are the Strength class |
| MAG | `AMAAAAAA` | IQ=12 | Mages are the IQ class |
| PRI | `AAMAAAIA` | PIE=12, LUK=8 | Priests are the Piety class |
| THI | `AAAAMIAA` | AGI=12, DEX=8 | Thieves need Agility (and some Dexterity) |
| RAN | `KIILKIIA` | STR=10,IQ=8,PIE=8,VIT=11,AGI=10,DEX=8 | Rangers are a jack-of-all-attributes hybrid class |
| ALC | `ANAANAAA` | IQ=13, AGI=13 | Alchemists (IQ-primary hybrid) |

The two identical copies of block 2 (28 lines = 14×2) are byte-for-byte
duplicates of each other within the same file — most likely the same
table referenced from two different code paths in the overlay's source,
not two semantically distinct tables.

**Block 3 — per-race base-attribute table, row count corroborated this
session, row order still not confirmed.** Same 8-column shape as block 2
but denser (nearly every column nonzero, consistent with races having
baseline values across *all* attributes rather than sparse class
*requirements*), 11 rows, decoded the same base-26 way as block 2
(columns assumed `STR, IQ, PIE, VIT, AGI, DEX, LUK`, 8th always 0):

| Row | Letters | STR | IQ | PIE | VIT | AGI | DEX | LUK |
|---|---|---|---|---|---|---|---|---|
| 0 | `JIIJJIIA` | 9 | 8 | 8 | 9 | 9 | 8 | 8 |
| 1 | `HKKHJJIA` | 7 | 10 | 10 | 7 | 9 | 9 | 8 |
| 2 | `LGKMHHHA` | 11 | 6 | 10 | 12 | 7 | 7 | 7 |
| 3 | `KHNKIGGA` | 10 | 7 | 13 | 10 | 8 | 6 | 6 |
| 4 | `IHGJKHNA` | 8 | 7 | 6 | 9 | 10 | 7 | 13 |
| 5 | `FLGGKOMA` | 5 | 11 | 6 | 6 | 10 | 14 | 12 |
| 6 | `MFFOIKDA` | 12 | 5 | 5 | 14 | 8 | 10 | 3 |
| 7 | `KHGMKIGA` | 10 | 7 | 6 | 12 | 10 | 8 | 6 |
| 8 | `HKHHKMKA` | 7 | 10 | 7 | 7 | 10 | 12 | 10 |
| 9 | `IGMKIIKA` | 8 | 6 | 12 | 10 | 8 | 8 | 10 |
| 10 | `KKGKHHJA` | 10 | 10 | 6 | 10 | 7 | 7 | 9 |

**Row count (11) is now corroborated from independent in-corpus evidence,
not just structural shape**, closing most of the "not independently
corroborated" gap from the previous pass — see "Race-name string evidence"
below. **Row-to-race mapping (which row is which race) is still not
confirmed**: no in-corpus ordered list tying a specific race name to a
specific row index was found (searched for a code table pairing the
confirmed message IDs below with a 0-10 race index; found a bounded
11-entry dispatcher near one of them but its jump targets resolve outside
this file, see below — not conclusive).

**Block 4 — per-race×class rating table, sharper characterization this
session, row domain still open.** 10 rows × 14 columns, values 0-10
(letters `A`-`K`), decoded against the confirmed 14-class column order:

| Row | FIG | MAG | PRI | THI | RAN | ALC | BAR | PSI | VAL | BIS | LOR | SAM | MON | NIN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 | 2 | 1 | 2 | 1 | 2 | 2 | 2 | 2 | 7 | 2 | 7 | 1 | 0 |
| 1 | 0 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | 2 | 7 | 7 | 10 | 3 | 0 |
| 2 | 0 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | 2 | 8 | 5 | 10 | 4 | 0 |
| 3 | 0 | 2 | 7 | 2 | 7 | 3 | 2 | 2 | 2 | 7 | 5 | 8 | 3 | 0 |
| 4 | 0 | 2 | 10 | 2 | 7 | 7 | 6 | 2 | 2 | 8 | 4 | 2 | 1 | 0 |
| 5 | 0 | 2 | 1 | 2 | 2 | 3 | 4 | 2 | 2 | 4 | 4 | 4 | 6 | 0 |
| 6 | 0 | 2 | 8 | 2 | 8 | 1 | 7 | 2 | 2 | 5 | 10 | 5 | 5 | 0 |
| 7 | 0 | 2 | 4 | 2 | 2 | 4 | 6 | 2 | 2 | 8 | 5 | 10 | 5 | 0 |
| 8 | 0 | 2 | 10 | 2 | 6 | 3 | 7 | 2 | 2 | 5 | 10 | 8 | 3 | 0 |
| 9 | 0 | 2 | 7 | 2 | 7 | 7 | 6 | 2 | 2 | 2 | 4 | 2 | 7 | 0 |

**New structural finding: 5 of the 14 columns are constant across all 10
rows** — `FIG`=0, `MAG`=2, `THI`=2, `PSI`=2, `VAL`=2 never vary by row, and
`NIN`=0 also never varies. The 8 varying columns (`PRI, RAN, ALC, BAR,
BIS, LOR, SAM, MON`) are exactly the classes block 2 gives *multiple*
nonzero stat-requirement columns (hybrid/elite classes), while every
constant column except `NIN` is a class block 2 gives exactly *one*
nonzero requirement (`FIG`=STR only, `MAG`=IQ only, `THI`=AGI+DEX,
`PSI`/`VAL` not decoded in block 2's worked examples but pattern-consistent).
This is a much better-supported hypothesis than a flat "cross-reference
rating": **block 4 most plausibly reads as a per-race "difficulty/cost to
qualify" rating (0-10) for each class**, flat/baseline for classes whose
prerequisite is trivial for every race and varying for classes whose
multi-attribute prerequisite some races meet more easily than others.
`NIN` being constant at `0` doesn't fit that pattern (Ninja is not a
single-attribute class) — possibly Ninja is reached by in-game class
change rather than creation-time point-buy, making a creation-cost rating
inapplicable; not confirmed. The row-count mismatch with block 3 (10 vs.
11) is unresolved — no evidence found this pass for which race, if any, is
excluded.

**Race-name string evidence, found this session — corroborates the count,
does not resolve row order.** Decoded `msg.dbs` via the already-committed
`tools/wizardry6/decode-dosega-msg-text.ts` and searched its output for
race-name substrings:

- **`HUMAN`** (message field-A `11922`) and **`ELF`** (field-A `15824`)
  decode as clean, standalone, fully legible Huffman records (decoded
  length matches string length exactly, no surrounding noise) — as solid
  as this corpus's text decode gets.
- **`DWARF`, `GNOME`, `LIZARDMAN`, `FELPUR[R]`** (the last one byte-short,
  likely a decode boundary artifact) all appear as recognisable substrings
  embedded in three garbled/overlapping records on the same `msg.dbs`
  page (page 0, offsets 2/14/32, right after `HUMAN`'s offset-0 and
  `ELF`'s offset-6 records) — lower confidence than `HUMAN`/`ELF` (the
  surrounding bytes decode to Huffman-bitstream-resync noise, consistent
  with these records' offset fields pointing mid-stream into a denser
  packed run rather than at each string's own header), but the word
  boundaries are too clean to be coincidental.
- `HOBBIT`, `DRACON`, `RAWULF`, `MOOK`, `TRYNNIE`, `RAPAX` were searched
  for and **not found** anywhere in the decoded message corpus.

**Six of eleven races independently located in the game's own text data,
clustered on one `msg.dbs` page, is strong corroboration that block 3's
row count (11) is the real race count** — but gives no row-index mapping
(the found strings are isolated message records, not an ordered table
entry pointing at a specific block-3 row).

> **Correction (the "`ELF` message ID next to bounded dispatchers" lead is
> refuted — it was a byte-pattern coincidence, not a real reference).**
> The previous session read `d0 3d` (bytes at file offsets `0x8add` and
> `0x8bef` in `wpcvw.ovr`) as the tail of a `cmp ax, 0x3dd0` (`ELF`'s
> message field-A value) immediate. Precise disassembly this session shows
> this is wrong at both sites: `0x8add`/`0x8bef` are not inside any `CMP`
> instruction at all — they are the **last byte of an inline jump-table
> entry** (`...d0`, the high byte of a `u16` case target) immediately
> followed by the **first byte of the next instruction**, `cmp ax, 0xb`/
> `cmp ax, 0xe` (opcode `3d`). The `d0`+`3d` byte pair is a pure boundary
> artifact — table tail glued to the following opcode's first byte, the
> same class of false-positive as the corpus's already-documented
> `QMON00.PIC` case (§6.4). **There is no literal `HUMAN` or `ELF`
> message-ID reference anywhere in `wpcvw.ovr`, `wpcmk.ovr`, `winit.ovr`,
> or `wbase.ovr`** (checked this session by direct byte search for both
> field-A values as `u16` LE immediates).
>
> The two dispatchers themselves are real, however (correctly identified
> by shape even though the reason given for finding them was wrong), and
> — now that §6.4b's addressing formula applies equally to the *absolute*
> `jmp word cs:[bx+disp16]` table-lookup form used here (no position
> adjustment needed for this addressing mode; the compiler bakes in the
> true runtime buffer address directly, unlike a relative `CALL`/`JMP`) —
> both are now **fully traced, and both resolve entirely within
> `wpcvw.ovr`'s own file**, not into resident code as previously assumed:
>
> - **11-way dispatcher** (table at file offset `0x8ac8`, dispatch at
>   `0x8ade`): the switch value is read at the dispatcher's own entry
>   (file offset `0x8952`: `mov ax,0x1b0(432); imul word[bp+4]; mov bx,ax;
>   mov al, byte[bx+0x4585]`) — i.e. a **single byte read from the live
>   in-memory `pcfile.dbs` character array**, indexed by character slot
>   (`[bp+4]`, stride 432 = the already-confirmed record size) plus a
>   fixed field offset. Cross-referencing this array's base address
>   (`0x43f0`, recovered by censusing all 354 occurrences of the
>   `imul...0x1b0` character-indexing idiom in `wpcvw.ovr` and finding the
>   full set of field constants used — 67 distinct fields spanning offsets
>   0-421 relative to that base) against the **already-confirmed** WPORT
>   portrait field (Amiga corpus: `+412`) locates it at exactly
>   `0x43f0+412 = 0x458c`, which **is** in the captured constant set —
>   decisive confirmation the base is correct. Under that base,
>   `0x4585 - 0x43f0 = 0x195 = `**`405`**. **New confirmed `pcfile.dbs`
>   field: byte `+405` = race index (0-10), directly driving this
>   11-way dispatch, bound-checked at exactly 11.** Each of the 11 case
>   bodies pushes `(charIndex, fieldOffset, delta)` and calls an in-file
>   helper at `0x8690` — disassembled in full: `AdjustClampedByte`, reads
>   the current byte at `charArrayBase(0x453a) + charIndex*432 +
>   fieldOffset`, adds `delta`, clamps to `[0,125]`, writes it back. I.e.
>   **this dispatcher applies a race-specific numeric stat/resistance
>   bonus at character-view time** (a different array base, `0x453a`, from
>   the `0x43f0` one the race byte itself lives in — two distinct
>   per-character 432-byte arrays are in play, not one). It does **not**
>   reference race names or text anywhere in its body — fully tracing it
>   answers "where does the race byte live and what happens per race" but
>   not "which race is index 0".
> - **14-way dispatcher** (table+dispatch at file offset `~0x8bf0`,
>   `cmp ax,0xe`): same general shape (character-indexed byte read driving
>   a bounded switch), presumed to be the class-bonus counterpart; not
>   independently re-derived to an exact field offset this session (a
>   *second*, distinct 11/14-bound dispatcher pair was also found
>   immediately upstream at file offsets `~0x8945`/`~0x8952`, meaning this
>   general "apply a per-race/per-class stat delta" pattern recurs at
>   least twice in `wpcvw.ovr` — not further characterized).
>
> **Net effect on the row-order question: this lead, even fully resolved,
> does not answer it** — the dispatch is driven by an already-numeric
> stored byte, and the case bodies manipulate stats, not text. Superseded
> by the new lead below.

**A second lead found in a prior session, in `wpcmk.ovr` (character
*creation*, not viewer) — this session traced it to a full resolution,
and the outcome is a demotion, not a confirmation.** `wpcmk.ovr` has its
**own**, separate 11-way dispatcher (table at file offset `0x3047`,
dispatch at `0x305d`, `cmp ax,0xb`) whose 11 case bodies each push a
distinct literal 16-bit value — `0x52d9, 0x52e2, 0x52eb, 0x52f4, 0x52fd,
0x5306, 0x530f, 0x5318, 0x5321, 0x532a, 0x5333` — evenly spaced exactly 9
bytes apart, and call a helper at file offset `0x2c7b` that treats the
pushed value as a plain (unprefixed, i.e. `DS`-relative) pointer.

> **Correction/refinement (this session): `0x2c7b` is not a string-read/
> display routine — it's fully disassembled below, and it is a per-column
> maximum-letter accumulator whose behaviour is a structural no-op on
> zero-initialized input. The "fixed-width race-name storage" reading of
> the 9-byte-stride table is now in real doubt, not just unconfirmed.**

**`0x2c7b(ptr)` disassembled in full this session:**
```
for si in 0..7:                                  # only 8 of the 9 bytes touched
    existing = byte[si + 0x559c]                  # zero-extended
    candidate = (signed)byte[ptr + si] - 'A'       # sign-extended letter index
    if existing < candidate:                       # signed compare
        byte[si + 0x559c] = byte[ptr + si] - 'A'
```
This computes, for each of the first 8 character positions, the
alphabetically-highest letter seen so far across calls, writing the
running maximum into a *second* buffer at `DS:0x559c` (8 bytes) — not
printing or copying the string anywhere. Critically: **if `byte[ptr+si]`
is `0` (true of any never-written, zero-initialized memory), the signed
candidate value is `-65`, and `existing >= -65` is true for any
non-negative `existing` (in particular the BSS-zero starting value) — so
the comparison's `else` branch is never taken and `0x559c` is never
updated.** I.e. on genuinely unpopulated input, this whole mechanism is
architecturally inert.

**Both the source table (`0x52d9`-`0x5340`-ish) and the destination
accumulator (`0x559c`-`0x55a4`-ish) are confirmed, via the MZ header's own
fields, to be real but *uninitialized* memory — not an addressing error,
and not a runtime `malloc` result either:**

```
wroot.exe module size            = fileSize - headerSize = 67134 - 512 = 66,622  (0x1043E)
MinAlloc (header +0xA, paragraphs)= 2707  ->  43,312 bytes  (0xA930)
module_end + MinAlloc            = 66,622 + 43,312 = 109,934  (0x1AD6E)
DS base (CS-relative bytes)      = 0xFD8 paragraphs * 16 = 64,896  (0xFD80)
DS:0x52D9 in CS-relative bytes   = 64,896 + 0x52D9 = 86,105  (0x15059)
DS:0x559C in CS-relative bytes   = 64,896 + 0x559C = 86,812  (0x152DC)
```
Both `0x15059` and `0x152DC` fall **inside** the `module_end..module_end+
MinAlloc` gap (`0x1043E`-`0x1AD6E`) — i.e. real memory DOS allocates and
zero-fills for the process at load time (a genuine BSS region), but with
**no on-disk bytes at all** — confirming the previous session's "outside
`wroot.exe`'s file size" finding and sharpening it: this isn't just "some
runtime buffer with unknown provenance", it's specifically DOS's own
zero-initialized BSS extension, declared but not populated by the loader.
Because both ends are fixed, compile-time-linked addresses (proven by
`wpcmk.ovr`'s own dispatcher embedding `0x52d9` etc. as literal
immediates — a heap/`malloc` pointer could not be known at link time), this
is a real static/global array, just one living past the file's own image.

**A broadened, desync-resistant writer census (this session) still finds
no text writer — but does find the range is heavily aliased by unrelated
overlay-local scratch state, further undermining the race-name reading.**
The previous session's census used a single linear disassembly pass per
file, which can silently desynchronize through inline data (jump tables,
literal pools) and miss real instructions — a known corpus pitfall. This
session's census instead disassembles from **every** `push bp` (`0x55`)
byte in each file (deduping results), which is robust to a single bad
resync point, and checks both literal-immediate and pure-displacement
memory operands (i.e. register-indexed forms genuinely are covered, not
just literal loads). Result across all 11 overlays + `wroot.exe`, target
range `0x52D9`-`0x5340`:

- **`wroot.exe`, `winit.ovr`, `wbase.ovr`, `wmaze.ovr`, `wpops.ovr`,
  `wpcmk.ovr`, `wpcvw.ovr`, `wdopt.ovr` — zero references of any kind**
  (neither read nor write). In particular `wpcmk.ovr` itself, the one file
  that *reads* this range (via `0x2c7b`), never writes it.
- **`wmele.ovr`: 69 references, real writes present** —
  `mov word ptr [0x52f6], ax` / `mov word ptr [0x52f2], dx` / `mov word
  ptr [0x52f6], 4` / `mov word ptr [0x52f4], dx` / `mov word ptr
  [0x52f8], 0` / `mov word ptr [0x52fa], 0`, interleaved with dozens of
  compares — a genuine numeric counter/state-machine structure (not text),
  confirming and *extending* the prior session's "compared, not written"
  note, which had missed these actual writes due to the desync issue above.
- **`wmexe.ovr`: 69 references, an almost byte-identical write pattern**
  one field-group over (`0x52f4`/`0x52f6`/`0x52f8`/`0x52fa`/`0x52fc`) — the
  same counter structure reused (or a sibling copy of the same source) in
  a second overlay.
- **`wtrea.ovr`: 12 references, including single-byte zero-writes**
  `mov byte ptr [0x52dc], 0`, `mov byte ptr [0x52e4], 0`, `mov byte ptr
  [0x52e5], 0` — landing inside table entries 0 and 1's own byte ranges —
  plus a separate word counter at `0x5310`.
- **`wmnpc.ovr`: 13 references** (`0x5322`/`0x5324` growing-counter,
  matching the prior session's already-documented finding).

**Conclusion: the address range `0x52D9`-`0x5340` is ordinary DS scratch
space, actively reused by at least four *unrelated* overlays
(`wmele`/`wmexe`/`wtrea`/`wmnpc`) for their own combat/treasure/NPC
counters and flags — not a dedicated, stable race-name text table.** A
persistent 11-entry name table could not survive this kind of
cross-overlay aliasing (loading `wmele.ovr` or `wtrea.ovr` between two
character-creation screens would silently corrupt it with unrelated
numeric state), and no code anywhere writes recognizable ASCII text into
it in the first place. Combined with `0x2c7b`'s demonstrated no-op
behaviour on zero/garbage input, the most honest reading is that this
9-byte-stride, 11-entry structural match to fixed-width race-name storage
was **coincidental** — a structurally plausible shape that turned out not
to be the real mechanism, not a confirmed table with a merely-missing
writer.

**This does not resolve the race-table row-order question** — it
demotes what had been "the most promising lead" back to unresolved, and
adds a *reason* (rather than just "not found") for why a static trace
alone won't settle it: **the true value at `DS:0x52D9`+ at the moment
`wpcmk.ovr`'s dispatcher runs depends on which overlays happened to load
previously in the same session** (their scratch writes into this same
physical range persist until overwritten), which is not something any
static file corpus can determine — it is inherently a **live, path-
dependent runtime state**. Resolving this further needs either (a) a live
trace — run the game under a DOS emulator with debugger support (e.g.
DOSBox-X or a similar 8086 debugger; no such tooling is set up in this
project yet, unlike the Amiga side's amiberry MCP integration), set a
breakpoint at `wpcmk.ovr` file offset `0x2c7b` during a real
character-creation session, and inspect `DS:0x52D9`-`0x5340` and
`DS:0x559C`-`0x55A4` directly, or (b) finding the *real* mechanism
that resolves race names to display text, which — given `0x2c7b`'s
actual role now understood — is almost certainly not this dispatcher at
all; a fresh, differently-shaped lead is needed rather than a deeper trace
of this one.

**Block 1 (`wpcmk.ovr`-exclusive, not part of the cross-file shared
content) — restructured this session, semantics still open.** Previously
described as "~30 variable-length tokens"; re-scanned precisely this
session and found to be **exactly 56 ASCII `'0'`/`'1'` digit-string
tokens (14 rows × 4 fixed-width columns of 10/7/5/8 bits) followed by a
literal `"***"` terminator token** — i.e. one row per class, in the same
confirmed `FIG..NIN` order as blocks 2/4:

| Class | Col A (10b) | Col B (7b) | Col C (5b) | Col D (8b) |
|---|---|---|---|---|
| FIG | `1111111110` | `0100000` | `00000` | `11100000` |
| MAG | `1000111100` | `0101000` | `00000` | `11100010` |
| PRI | `0001101010` | `0101000` | `00000` | `11101000` |
| THI | `1111111110` | `0101111` | `00000` | `11100000` |
| RAN | `1111111110` | `0100111` | `00000` | `11110000` |
| ALC | `1001110000` | `0100000` | `00000` | `11110000` |
| BAR | `1111111110` | `0111111` | `00000` | `11100010` |
| PSI | `1001111000` | `0101000` | `00000` | `11100100` |
| VAL | `1111111110` | `0101000` | `00000` | `11101000` |
| BIS | `0001101010` | `0101000` | `00000` | `11101010` |
| LOR | `1111111110` | `0101000` | `00000` | `11101000` |
| SAM | `1111111110` | `0101000` | `00000` | `11100011` |
| MON | `1001111101` | `0101001` | `00000` | `11100101` |
| NIN | `1111111111` | `0100111` | `00000` | `11110001` |

Column C (5 bits) is `00000` for every class — most likely reserved/unused
padding, not a live field. Column A (10 bits) has only 7 distinct values
across 14 classes, and 7 classes (`FIG, THI, RAN, BAR, VAL, LOR, SAM` —
every non-primary-caster, non-hybrid combat class) share the *identical*
pattern `1111111110`, while the 6 spellcasting/hybrid/prestige classes
(`MAG, PRI, ALC, PSI, BIS, MON`) each have a distinct pattern and `NIN`
is the unique all-`1`s row. This class-role clustering (not per-class
individuality) suggests a **category/eligibility bitmask** (candidate:
starting-equipment or weapon/armor-category access, since Column A's
grouping tracks combat role) rather than a per-class unique value table.
`wpcmk.ovr`-only presence (absent from the character-*viewer*
`wpcvw.ovr`) is consistent with a creation-time-only concern. No code
consumer was located this pass (searched for `mov ax, imm16; push ax`
immediate references to the block's own start address in both overlays'
code regions — no hits; the block's address may only be reached via a
computed/indexed reference, not a literal).

Not promoted to a committed extractor this pass (data-analysis findings
only, no rendering/asset output produced) — the table content is recorded
here as byte offsets relative to each file's own findable anchor strings
(`"MAAAAAAA"`, `"ACBCBCCCCHCHBA"`), not as fixed absolute offsets, since
`wpcvw.ovr`'s layout has an internal shift (§ above) that a fixed-offset
reader would need to account for.

**Paths tried this session (race-table row order):**

| Approach | Result | Why it fell short |
|---|---|---|
| Whole-corpus string scan for the 11 canonical Wizardry-race names in every `.ovr`/`.dbs`/`.hdr` file | Zero plain-ASCII hits anywhere except one flavor-text mention of `FAERIE`/`FAIRIES` in `scenario.dbs` | Race names live in Huffman-compressed `msg.dbs`, not as raw strings |
| Decoded `msg.dbs` via the committed extractor and substring-searched the output | 2 clean (`HUMAN`, `ELF`) + 4 embedded/lower-confidence (`DWARF`, `GNOME`, `LIZARDMAN`, `FELPUR[R]`) race names found; 5 more (`HOBBIT`, `DRACON`, `RAWULF`, `MOOK`, `TRYNNIE`) not found | Corroborates the count (11) but gives no ordered row mapping — found strings are isolated records, not a table |
| Searched `wpcmk.ovr`/`wpcvw.ovr` code for the confirmed `HUMAN`/`ELF` message-ID constants (`11922`/`15824`) as literal operands (session 4) | `ELF`'s ID found twice in `wpcvw.ovr`, each next to an 11-bounded and a 14-bounded jump-table dispatch (race/class count match) | **Refuted this session** — both "hits" are a byte-boundary coincidence (jump-table tail byte + next opcode's first byte), not a real `ELF` reference; see correction block above |
| Searched code for a literal `mov ax,imm16` reference to block 1's own start address | Zero hits in either overlay | Block 1's consumer (if any) is reached by computed/indexed addressing, not a literal — needs a broader trace, out of scope this pass |
| **(this session)** Traced `wmexe.ovr` fully (this session's primary target) to find where §6.4a's resident helpers live, hoping the same code might host a race-name table | `wmexe.ovr` confirmed to be an ordinary overlay; resident library located in `wroot.exe` instead (§6.4b) | Resolves the *helper-location* question generally, but the specific `wpcvw.ovr` dispatchers it unblocked turn out to apply numeric stat deltas, not display names — see correction block above |
| **(this session)** Re-derived `wpcvw.ovr`'s two bounded dispatchers precisely, now that the addressing formula is known | Both fully traced: 11-way keyed on new-confirmed `pcfile.dbs +405` (race index), 14-way presumed class-keyed; both apply `AdjustClampedByte`-style stat deltas via in-file helper `0x8690` | Structurally sound but uninformative for names — no text/message reference in either dispatcher's body |
| **(this session)** Searched `wpcmk.ovr`/`wpcvw.ovr`/`winit.ovr`/`wbase.ovr` for `HUMAN`'s/`ELF`'s message field-A values as literal `u16` operands (broader recheck after the ELF-lead refutation) | Zero hits anywhere (the 2 `wpcvw.ovr` "hits" are the refuted false positive) | Confirms race message-IDs are never referenced as raw literals in these overlays — any real name-display mechanism is index/computed, not literal-ID-driven |
| **(prior session)** Found and probed `wpcmk.ovr`'s own separate 11-way dispatcher (9-byte-stride pointer table @ file offset `0x3047`) | Structurally the best lead yet (9-byte stride fits fixed-width race names); pointers are `DS`-relative and resolve to a **runtime-only** buffer (checked against `wroot.exe`'s static file range, out of bounds) | Can't read contents statically; a targeted writer census (`capstone`, literal-address `mov` writes, all 11 overlays + `wroot.exe`) found no populator in the `0x52c0`-`0x5340` range — likely written via register-indexed addressing this census doesn't catch, or by resident `wroot.exe` code not disassembled this pass |
| **(this session)** Fully disassembled the dispatcher's consumer, `0x2c7b` | It's a per-column max-letter accumulator into a second buffer (`DS:0x559c`), not a string read/print — and provably a no-op on zero-initialized input (signed-comparison analysis) | Structurally refutes treating the table as "confirmed, just missing a writer" — the consumption mechanism doesn't match "display a race name" at all |
| **(this session)** Quantified both buffers against `wroot.exe`'s own MZ header `MinAlloc` field | Both `DS:0x52d9` and `DS:0x559c` fall inside the module-end..module-end+MinAlloc gap — genuine DOS-zeroed BSS, no on-disk bytes possible, not an addressing bug | Confirms *why* no static content can ever exist for these addresses, but doesn't find a writer |
| **(this session)** Broadened writer census: multi-start (every `push bp` byte) disassembly per file, desync-resistant, both literal and pure-displacement memory operands, across all 11 overlays + `wroot.exe` | Zero writers in `wroot.exe`/`winit`/`wbase`/`wmaze`/`wpops`/`wpcmk`/`wpcvw`/`wdopt`; real *numeric* writes found in `wmele.ovr` (69, a counter the previous narrower census had only seen as "compared, not written" — a desync artifact), `wmexe.ovr` (69, same counter shape one field-group over), `wtrea.ovr` (12, including 3 single-byte zero-writes landing inside table entries 0/1), `wmnpc.ovr` (13, already-known counter) | No text writer found anywhere; the range is demonstrably general-purpose overlay-local scratch space reused by 4 unrelated overlays for unrelated numeric state, which structurally cannot coexist with a stable persistent name table — demotes the whole lead from "unresolved but promising" to "most likely a coincidental structural match, not the real mechanism" |

---

## 7. `winstall.exe`, video drivers, batch launchers — confirmed (shallow, as scoped)

**`winstall.exe`** (24178 bytes, MZ executable) — confirmed as a separate
installer program (not analysed in depth, per task scope): embeds video
mode selection text (`VGA/MCGA 256 Color, VGA/EGA 16 Color, MCGA/CGA 4
Color, TANDY 16 Color, HERCULES B/W Mono`), sound card selection (`PC
Internal Speaker, AdLib, Covox Sound/Voice Master, Sound Blaster, None`),
and disk-drive-type selection, plus references to `PLAYBANE.BAT,
WROOT.EXE, WINIT.OVR` — consistent with writing/configuring the launch
batch file and, presumably, copying the platform-specific `.ega`/`.cga`/
`.t16`/`.drv` files appropriate to the selected hardware.

**`ega.drv`/`cga.drv`/`herc.drv`/`tandy.drv`** — each begins with a `JMP`
followed by a repeating `CALL rel16 ; RETF` pattern, the classic shape of
a driver entry-point dispatch/trampoline table (one call+far-return pair
per exported driver function — init, set-mode, blit, etc.). Not
disassembled further, per task scope (low priority — `ega.drv` is the only
one relevant to this project's target platform).

**`bane.bat`/`playbane.bat`** — plain text; `bane.bat` runs
`Moslowiz %1 wroot` (game launched through the CPU-throttle TSR, with a
passthrough argument), `playbane.bat` runs `wroot` directly (no
throttling). Both share the identical `ERRORLEVEL` 1-22 startup-failure
table used in §6.1.

---

## 8. Confidence summary

| Format | Status | Evidence |
|---|---|---|
| `misc.hdr` | confirmed | 98.9% node-identical to Amiga tree under LE reinterpretation; DOS tree independently decodes legible `msg.dbs` text |
| `master.hdr` | confirmed | 20/20 `u16` LE values byte-exact identical to Amiga |
| `disk.hdr` | confirmed | 9/9 `u32` LE offsets byte-exact identical to Amiga; 656 trailing bytes byte-identical outright |
| `scenario.hdr` | confirmed | 12/414 (vs. Amiga) / 9/414 (vs. own `newgame.dbs`) differing bytes, all at already-known scratch/flag offsets |
| `pcfile.dbs` | confirmed | header fields match Amiga's structure exactly under LE reinterpretation; ships 6 sample characters (Amiga's is empty) |
| `scenario.dbs` §0 (XP tables) | confirmed | `u32` LE values identical to Amiga's round-decimal sequences |
| `scenario.dbs` §1 (items) | confirmed | names/prices identical to Amiga's catalog |
| `scenario.dbs` §4 (monsters) | confirmed | names/`picFileIndex` identical to Amiga's catalog (185/250 legible) |
| `scenario.dbs` §2/3/5/6/7/8/9 | open | not re-examined this pass, same as Amiga |
| `newgame.dbs` | partial | shared-header confirmed, body not re-examined |
| `msg.hdr`/`msg.dbs` | confirmed | reimplemented algorithm reproduces Amiga's exact stated numbers on Amiga data, then decodes legible DOS text (98.5% printable, dozens of full sentences); 32/718 position collisions confirmed as genuine text reuse (field `A` strictly sorted, zero duplicates, every collision pairs distinct `A`s) |
| `.EGA` full screens (3 files) | confirmed | 0 pixel mismatches / 192,000 (3 files x 64,000px) against the `.t16` ground truth after the §2 plane-stride fix; same `PIC_PALETTE` confirmed better than standard EGA order |
| `mazedata.ega` | confirmed | zero-deviation byte accounting (`2599 + 99704 = 102303` exact); wu/hr fields 0/153 mismatches vs. Amiga; clean brick-wall/icon renders |
| `wfont0-3.ega`, `wport1-3.ega` | confirmed | byte-identical files to Amiga |
| `wfont4.ega` | confirmed | 99.5% byte-identical, one tile differs |
| `.pic` sprites (60 files) | confirmed | block RLE + 24-byte LE directory (§5); 939,144 payload bytes and 712 cels / 3,414,272 rendered pixels byte-exact vs Amiga, zero deviation; `credits.pic` (the one DOS-unique file) renders legible credit text |
| `wroot.exe` MZ structure | confirmed | standard MZ header parse |
| `wroot.exe` startup load order | confirmed | `bane.bat`'s `ERRORLEVEL` table |
| `.ovr` overlay name table | confirmed | 11 names match the 11 shipped `.ovr` files exactly |
| CS/DS segment relationship | confirmed | `DS = CS + 0xfd80` bytes, traced from `wroot.exe`'s startup stub and verified against a real legible string ("8087/80287 is required!") at the computed file offset (§6.1a) |
| `wroot.exe` overlay-load state machine | confirmed | full call chain traced (`GameStateLoop` → `LoadOverlay` → file open/read), `curState` global identified and cross-confirmed inside `wmaze.ovr`'s own entry code (§6.2) |
| `.ovr` 14-byte file header | confirmed | `fileSize == 14 + sizeA + sizeB` exact on all 11 files, zero deviation; boundary independently confirmed to land on the start of each file's resource-string pool (§6.3) |
| `.ovr` per-file content map | confirmed for `winit`/`wmaze`; rendered for the rest | `wmaze.ovr`'s role and dispatch confirmed via disassembly (§6.4); other overlays' content map still from embedded filename strings only, not individually disassembly-traced |
| `wmaze.ovr` state-5/state-6 handler bodies | confirmed | `0x3d3`/`0x2abc` fully traced, `sub_1d1`/`sub_42` identified, DOS-side confirmation of Amiga's `scenario.dbs` `+0x360`/`+0x3f0`/`+0x480`/`+0x510`/`+0x6c0` entity fields and first-ever semantics for mazedata `+0x1e0`/`+0x1ec`/`+0x4fa`/`+0x512` (§6.4a) |
| Resident-code library location | confirmed | lives in `wroot.exe` itself, not `wmexe.ovr`; formula + corpus-wide zero-exception verification (9,251/9,251 near-relative `CALL`s across all 11 overlays resolve), now 34 total named/characterized call targets (11 from the prior session + a 13-function text/window display subsystem plus 10 further helpers this session, §6.4c) |
| `pcfile.dbs` `+405` (race index) | confirmed | drives `wpcvw.ovr`'s 11-way per-character dispatcher, bound-checked at exactly 11; array base cross-validated against the already-confirmed `+412` WPORT field at the same base (§6.6) |
| `wpcmk.ovr`/`wpcvw.ovr` shared block | confirmed (class-requirement table + block 1 structure + new `+405` race field); corroborated count, unmapped rows (race table) | 14-row class-requirement table matches the confirmed class roster and known class lore exactly; block 1 resolved to a precise 14×4 bitmask shape; race-table row count (11) now corroborated by 6 in-corpus race-name strings found in decoded `msg.dbs`; both `wpcvw.ovr` bounded dispatchers now fully traced (§6.4b's formula) but shown to apply numeric stat deltas, not display names; the `wpcmk.ovr` 9-byte-stride candidate name table's consumer is now fully disassembled and shown to be a no-op-on-zero-input max-letter accumulator, and the address range is demonstrably reused DS scratch space shared with 4 unrelated overlays — demoted from "promising, unresolved" to "most likely coincidental, not the real mechanism" — row order/mapping still open (§6.6) |
| `winstall.exe` | confirmed (shallow) | strings confirm installer role, not deeply analysed per scope |
| `ega.drv` | rendered (shallow) | driver dispatch-table shape recognised, not disassembled, per scope |
| `cga.drv`/`tandy.drv` | confirmed | disassembled (§9) -- screen-blit routines locate the pixel layout, `wroot.exe`'s mode-init calls locate the palettes |
| `.CGA`/`.T16` full screens (9 files) | confirmed | see §9.1/§9.2 -- legible renders, palettes confirmed via `wroot.exe` INT 10h disassembly |
| `mazedata.cga`/`.t16` | confirmed | see §9.3 -- zero-deviation byte accounting, clean brick-wall/icon renders, wu/hr identical to `.ega` |
| `wfont0-4`/`wport1-3` `.cga`/`.t16` (14 files) | confirmed | see §9.4 -- clean tile/portrait renders, same mechanism as `.ega` |

See `docs/wizardry6/TODO.md` for the single open-work tracker (all
platforms).

---

## 9. `.CGA` (2bpp) and `.T16` (Tandy 16-color, 4bpp) platform variants

Every `.ega` asset covered in §2-§4 ships alongside a `.cga` and a `.t16`
sibling (12 base names each: `dragonsc`, `graveyrd`, `titlepag`,
`mazedata`, `wfont0`-`wfont4`, `wport1`-`wport3`). This section covers all
36 files. Both formats were undecoded prior to this pass; the task's two
starting hypotheses (based on file-size arithmetic alone) both survive,
with one substantive refinement to hypothesis 2's *content* claim -- see
§9.4.

**Method note:** the file-size halving/matching arithmetic
(`.cga = .ega/2` for 4bpp-vs-2bpp files, `.t16 = .ega` for the two 4bpp-vs-
4bpp cases) only constrains *total byte count*, not pixel *arrangement* --
the same byte count is produced whether the pixels are planar (bitplane,
the Amiga/EGA convention used throughout this whole corpus) or packed
(chunky, N bits/pixel packed directly into consecutive bytes). Every
format in this section turned out to be **packed, not planar** -- a
plane-major bitplane decode at the "right" bit depth reliably produces
noise, and only `decodePackedPixelLinear`/`decodeCgaBanked` (new,
`tools/shared/packed-pixel.ts`) produce legible output. This is the
single biggest structural difference from every other format in this
corpus, and is easy to miss because the byte-count arithmetic alone
doesn't rule out planar.

### 9.1 `.CGA` full-screen images (`dragonsc.cga`, `graveyrd.cga`,
`titlepag.cga`) -- confirmed

320x200 pixels, 2 bits/pixel, packed 4 pixels/byte (MSB-first: bits 7-6 =
leftmost pixel). File size 16384 bytes = exactly half of the corresponding
`.ega` file (32768) -- confirmed exact for all 3 files.

**Pixel layout is the classic real CGA hardware video-memory convention**,
not a plain linear bitmap: the image is split into two interleaved
"fields" -- even scanlines (0, 2, 4, ..., 198) then odd scanlines (1, 3,
5, ..., 199) -- each field occupying a **fixed 0x2000-byte (8192-byte)
bank** in the file regardless of how much of it holds real pixel data:

```
rowBytes = width / 4 = 80
bank 0 (even scanlines): file offset 0x0000 .. 0x1FFF
  real pixel data: 100 rows x 80 bytes = 8000 bytes (offset 0x0000-0x1F3F)
  unused padding:  192 bytes (offset 0x1F40-0x1FFF)
bank 1 (odd scanlines):  file offset 0x2000 .. 0x3FFF
  real pixel data: 100 rows x 80 bytes = 8000 bytes (offset 0x2000-0x3F3F)
  unused padding:  192 bytes (offset 0x3F40-0x3FFF)
total: 2 x 8192 = 16384 bytes, exact
```

The "half of `.ega`'s 768 trailing bytes" the task's starting arithmetic
predicted (`16384 = 16000 + 384`) is correct in *aggregate byte count*
(2 x 192 = 384) but the padding isn't one trailing block -- it's split
into two 192-byte gaps, one per bank, matching real IBM CGA video memory's
own even/odd field layout exactly (`0xB8000`/`0xBA00` in real hardware
segment terms).

**Confirmed via disassembly** of `cga.drv`'s screen-blit routine
(`CODE+0x5af`, a raw headerless x86-16 binary -- `file` offset ==
segment-relative offset, no MZ header to adjust for):

```
CODE+0x5ea   mov ax, 0xb800      ; es = CGA video segment
CODE+0x5ed   mov es, ax
CODE+0x5ef   mov ax, word cs:[0x14d]   ; ds = source asset buffer
CODE+0x5f5   mov si, word [bp-6]       ; (loop top)
             mov di, si
             mov cx, word [bp-2]
             rep movsw es:[di], [si]   ; copy bank 0
             mov si, word [bp-6]
CODE+0x602   add si, 0x2000            ; source += 0x2000 (!)
             mov di, si                ; dest = same address (es differs)
             rep movsw es:[di], [si]   ; copy bank 1
             add word [bp-6], 0x50     ; += 80 (next row-pair)
             dec word [bp-4]
             jne CODE+0x5f5
```

The critical detail: `add si, 0x2000` is applied to the **source**
pointer identically to the destination -- both `si` (source, in the
`cs:[0x14d]` asset buffer) and `di` (destination, `0xB800:`) jump by the
same 0x2000 bank gap. This means the asset file itself is pre-formatted
to match hardware layout exactly (a straight `memcpy`/`rep movsw` onto
each bank, no runtime reshuffling) -- confirming the file-level bank
layout described above, not just the video-hardware convention alone.

**Verification (rendering):** decoding with this layout and greyscale
turns three vertically-repeated, blurred noise panels (produced by every
simpler hypothesis tried -- see §9.6) into one single, sharp, legible
image. `titlepag.cga` renders unmistakable "BANE OF THE COSMIC FORGE"
stone-relief title lettering with character portraits, matching
`titlepag.ega`'s confirmed content. `graveyrd.cga` renders a clean
graveyard scene (grim reaper, arch, tombstones). `dragonsc.cga` renders
the "Wizardry" logo banner with icon row, mostly black below (matches its
EGA sibling's mostly-black content).

### 9.2 `.CGA` palette -- confirmed (disassembly)

Confirmed via `wroot.exe` disassembly (standard MZ executable, header 512
bytes/0x200 -- addresses below given as `CODE+0xSSSS` segment-relative,
i.e. **file offset = 0xSSSS + 0x200**):

```
CODE+0x1de9  mov ax, 4        ; file 0x1fe9 -- INT 10h AH=0 AL=4:
CODE+0x1dec  int 0x10         ; file 0x1fec -- set video mode 4 (320x200 CGA 4-color)
CODE+0x1def  mov ah, 0xb      ; file 0x1fef
CODE+0x1df1  mov bx, 0x101    ; file 0x1ff1 -- BH=01h BL=01h
CODE+0x1df4  int 0x10         ; file 0x1ff4 -- INT 10h AH=0Bh: "select 4-color palette"
```

`AH=0Bh BH=01h BL=01h` is the standard documented BIOS call: BH=01h
selects the "4-color palette" function, BL=01h chooses hardware
**"Palette 1"** (background/cyan/magenta/white) over the alternative
"Palette 0" (background/green/red/brown). No separate call in this code
path sets the color-select register's intensity bit (there is no `AH=0Bh
BH=00h` "set background/border color" call nearby, which is the only
other BIOS entry point that touches that register), so the register is
left at whatever the mode-4 set leaves it -- **low intensity**:

```
CGA_PALETTE = [
  0: black       (0, 0, 0)
  1: cyan        (0, 170, 170)
  2: magenta     (170, 0, 170)
  3: light grey  (170, 170, 170)   -- "white" in the CGA-palette sense
]
```

**Cross-checked two ways:**

1. **Thematic**: `graveyrd.cga` renders with a magenta-dominant dithered
   sky, matching this same document's own §2 description of
   `graveyrd.ega`'s sky as "speckled magenta/white dithered fill" for the
   *same scene* -- an independent confirmation the hue family (cyan/
   magenta) is right, from a description written before this section
   existed.
2. **Quantitative**: a pixel-co-occurrence check against the
   already-confirmed EGA decode (same coordinates, same artwork, all 3
   screen files) -- for each CGA index value, the EGA pixel at the same
   coordinate was looked up and averaged. All 4 candidate CGA palette
   families (Palette 0 low/high, Palette 1 low/high) were tested by
   least-squares fit against these measured averages; Palette 1 (either
   intensity) fits far better than Palette 0 (61,618-64,627 vs.
   69,897-166,083 summed squared error across the 4 indices), consistent
   with the BIOS trace. Low vs. high intensity is a closer call
   numerically (61,618 vs. 64,627) and low intensity wins, consistent
   with no intensity-setting call being present.

This is a case where the disassembly nails the palette *family*
definitively but leaves one bit (intensity) resting on the "no call sets
it, so it's the default" inference plus a modest numerical edge, rather
than a directly-read register value -- flagged here rather than glossed
over. It does not affect confidence in the CGA pixel-layout finding
(§9.1), which is independent of palette choice.

### 9.3 `.T16` full-screen images -- confirmed

320x200 pixels, 4 bits/pixel, packed 2 pixels/byte (high nibble =
leftmost pixel), **linear** (no bank interleave, unlike `.CGA`). File size
32768 bytes, identical to `.ega` (4bpp either way, packed vs. planar
doesn't change the total). Confirmed by direct rendering: `titlepag.t16`
decoded this way is immediately legible on the very first attempt, no
banking hypothesis needed.

Confirmed via `tandy.drv` disassembly (`CODE+0x565`, same raw-binary
addressing as `cga.drv`) that Tandy 16-color hardware video memory
*itself* is bank-interleaved (4 banks at destination offsets `0x0`,
`0x2000`, `0x4000`, `0x6000`), but critically the blit routine's
**source** pointer only advances by a plain row stride (`0xa0` = 160
bytes) between banks -- only the **destination** (video memory) pointer
takes the big bank jumps:

```
CODE+0x5b9  mov si, word [bp-8]      ; source, plain linear
CODE+0x5bc  mov di, word [bp-6]      ; dest, video memory
            rep movsw es:[di],[si]   ; x2 (bank 0)
CODE+0x5c9  mov di, word [bp-6]
CODE+0x5cc  add di, 0x2000           ; DEST bank jump only
CODE+0x5d0  add word [bp-8], 0xa0    ; SOURCE: plain row-stride advance
            ...                       ; (bank 1 copy)
CODE+0x5e5  add di, 0x4000           ; DEST bank jump only (bank 2)
CODE+0x5e9  add word [bp-8], 0xa0    ; SOURCE: plain row-stride advance
```

I.e. Tandy's driver de-interleaves at blit time; the `.T16` asset file on
disk is a plain top-to-bottom bitmap, unlike `.CGA`'s pre-interleaved
layout (§9.1). This is a real, confirmed difference between the two
drivers' conventions, not an inconsistency in the analysis.

**Cross-reference:** this same `0x2000`/`0x4000`/`0x6000` bank-pitch
convention (destination-only, source stays linear) turned out to be exactly
the missing piece for the *Amiga/EGA* full-screen decoder's plane-stride
bug (§2's correction above, `docs/wizardry6/amiga/data-structure.md` §3.3)
— `.ega`'s 4 bitplanes are individually padded to the identical `0x2000`
pitch, and this section's clean, already-confirmed `.t16` decode is what
was used as the byte-exact ground truth to find and verify that fix.

### `.T16` palette -- confirmed (disassembly, exact match)

Confirmed via `wroot.exe` disassembly, Tandy mode-9 setup path:

```
CODE+0x1ef8  mov ax, 9         ; file 0x20f8 -- INT 10h AH=0 AL=9: set Tandy 320x200 16-color mode
CODE+0x1efb  int 0x10          ; file 0x20fb
CODE+0x1f02  mov dx, 0x1e54    ; file 0x2102 -- points at a 17-byte table at file offset 0x2054
CODE+0x1f05  mov ax, 0x1002    ; file 0x2105 -- INT 10h AH=10h AL=02h: "Set All Palette Registers"
CODE+0x1f08  int 0x10          ; file 0x2108
```

`AH=10h AL=02h` is the EGA/VGA-compatible BIOS call that directly
programs the Attribute Controller's 16 palette registers (plus overscan)
from a caller-supplied table at `ES:DX`. The table's 17 bytes (file
offset 0x2054):

```
00 0f 09 0d 0c 0e 0a 0b 08 07 01 05 04 06 02 03 00
```

Read as "register `i` is programmed with standard-EGA-order color
`table[i]`" (standard IRGB order: 0=black, 1=blue, 2=green, 3=cyan,
4=red, 5=magenta, 6=brown, 7=ltgrey, 8=dkgrey, 9=ltblue, 10=ltgreen,
11=ltcyan, 12=ltred, 13=ltmagenta, 14=yellow, 15=white), this reproduces
**`PIC_PALETTE`'s exact 16-entry permutation, byte for byte, at every
single index** (0->black, 1->white, 2->ltblue, 3->ltmagenta, 4->ltred,
5->yellow, 6->ltgreen, 7->ltcyan, 8->dkgrey, 9->ltgrey, 10->blue,
11->magenta, 12->red, 13->brown, 14->green, 15->cyan) -- i.e. **Tandy
16-color mode uses the identical palette table as EGA/Amiga**, just
reprogrammed explicitly through the EGA/VGA-compatible BIOS call rather
than inherited implicitly from hardware defaults.

Independent cross-check: the neighbouring EGA-mode setup path
(`CODE+0x1e9b`, file 0x209b) makes the identical `AH=10h AL=02h` call with
its own table at file offset 0x2043 (`00 17 11 15 14 16 12 13 10 07 01 05
04 06 02 03 00`) -- the same permutation, just extended into EGA's full
6-bit register range (`0x10`-`0x17` instead of `0x00`-`0x07` for entries
1-8, since EGA can address 64 colors and Tandy only 16). Finding the *same*
permutation independently on both paths, with the exact register-range
difference expected from the hardware capability difference, rules out
coincidence.

This is the strongest-evidence palette finding in this whole section --
directly read from an executed BIOS call's own parameter table, not
inferred from pixel statistics.

### 9.4 `mazedata.cga`/`.t16` -- confirmed

Same 4-byte header + 153x5-byte directory + 366x5-byte compose-list
container as `mazedata.ega` (§3) -- confirmed unchanged, byte for byte:
`widthUnits`/`heightRows` are identical to the `.ega` file's values for
all 153 records on both `.cga` and `.t16`. Only the per-record pixel
payload's bit depth changes (`bpp` = 2 for `.cga`, 4 for `.t16`, vs. 4 for
`.ega`), and the cumulative-offset formula (§3's
`gfxBase + sum(widthUnits[i]*heightRows[i]*bpp)`) generalizes directly by
using `bpp` in place of the fixed multiplier of 4:

```
mazedata.cga: 2599 (header+dir+composelist, unchanged) + 49852 (=99704/2) = 52451, exact
mazedata.t16: 2599 + 99704 (bpp=4, same as .ega) = 102303, exact (== mazedata.ega's size)
```

**Pixel encoding is packed (chunky), not planar** -- like the full-screen
formats (§9.1/§9.3), a plane-major bitplane decode at 2 (or 4) planes
renders as noise. `decodePackedPixelLinear` applied **per record, with no
bank interleave** (this is a graphics-asset bank, not a direct-to-video-
memory image, so the hardware bank convention from §9.1 does not apply
here) renders clean, recognisable perspective-scaled brick-wall textures,
doors, a treasure chest, a skeleton marker, and the 20-icon UI row --
matching `mazedata.ega`'s own confirmed content exactly, just recolored.
Verified across the first 12+ records visually and the full 153-record
byte accounting exactly (zero deviation, both files).

Palette: `.cga` uses `CGA_PALETTE` (§9.2), `.t16` uses `PIC_PALETTE`
(§9.3) -- same as their respective full-screen siblings, both render
cleanly with no unmapped indices.

### 9.5 `wfont0-4`/`wport1-3` `.cga`/`.t16` -- confirmed

File-size arithmetic (`128 tiles x 8 bytes/plane x N planes` for `wfont0-
4`, `14 x 9 tiles x N bytes/plane-row` for `wport1-3`) is consistent with
`N=2` (`.cga`, 16 bytes/tile) and `N=4` (`.t16`, 32 bytes/tile, same as
`.ega`) for every file, and confirmed correct by rendering:

1. **Mechanism (confirmed):** all of `wfont1-4`/`wport1-3` on every
   platform, and `wfont0` specifically on `.cga`/`.t16`, decode with the
   exact same general **packed-pixel** 8x8-tile mechanism `mazedata` uses
   (§9.4) -- `decodePackedPixelLinear` per tile, 3x3 tiles per portrait
   for `wport`. Rendered: `wfont1.cga`/`.t16` reproduce the UI icons and
   all 14 class-abbreviation pixel-text strings ("FIG MAG PRI THI RAN ALC
   BAR PSI VAL BIS LOR SAM MON NIN") the Amiga doc describes for
   `WFONT1.EGA`; `wport1-3.cga`/`.t16` reproduce 14x3 recognisable 24x24
   face/portrait icons per file, same as `.ega`.

2. **Content (refined from the task's starting hypothesis):** the task's
   hypothesis 2 predicted `wfont0.cga`/`.t16` would switch from the
   EGA-only special-cased 1bpp monochrome font to being "a colour tile
   set using the general mechanism". The **mechanism** half of that is
   confirmed exactly as stated -- `wfont0.cga`/`.t16` do use the general
   packed-tile decode, not the special mono case. The **content** is a
   refinement, not a confirmation: rendered, `wfont0.cga`/`.t16` are
   still recognisably the *same plain ASCII glyph sheet* as
   `wfont0.ega` (digits, punctuation, uppercase letters -- the glyph
   *shapes* are pixel-identical to the EGA version, just now decoded at
   the mode's higher bit depth), not repurposed for icon/graphic content
   the way `wfont1-4` are. The most likely explanation is that the extra
   bit depth on `.cga`/`.t16` is spent on anti-aliased/shaded lettering
   headroom (the file is still a font either way), not on giving `wfont0`
   a new role. This is a case where the file-size arithmetic and the
   *mechanism* were exactly right, but the plain "colour tile set" framing
   of the *content* needed correcting against the actual render -- exactly
   the kind of check the task asked for ("if a hypothesis breaks... say
   so").

Palette/transparency: `wfont0-4` render **opaque** (`indicesToPaletteRGBA`,
no transparent key) on every platform, matching the Amiga doc's own
finding for `.ega` that these tiles don't use the `.PIC` transparency
convention. `wport1-3` render with index `(1<<bpp)-1` (3 for `.cga`, 15
for `.t16`) as the transparent key, same "max index = transparent"
convention as `.PIC` cels (`amiga/data-structure.md` §2.3) -- confirmed
visually (portrait backgrounds are transparent, not solid-colored, in the
rendered atlases).

### 9.6 Paths tried (`.CGA` full-screen pixel layout)

| Approach | Result | Why it fell short |
|---|---|---|
| Plane-major bitplane decode, 2 planes (matching the rest of this corpus's convention) | Pure noise | Wrong encoding family entirely -- `.CGA` is packed/chunky, not planar (only discovered once packed decoding was tried) |
| Packed-pixel, linear, no banking, width=320 | `titlepag.cga` shows recognisable "BANE...COSMIC...FORGE" text and character art, but the image is vertically compressed into **3 near-identical blurred repeats** stacked in the 200-row canvas | Right pixel encoding (packed 2bpp), wrong scanline ordering -- row-autocorrelation found no exact periodic repeat at any lag, ruling out a simple modulo-N interleave guess; the "3 repeats" were actually 2 real halves (see next row) plus a visual misjudgement of a black band as a 3rd division |
| Packed-pixel, 2-way row interleave, `bankSize = rowsPerBank * rowBytes` (8000 bytes, no gap) | Blurry combing/interlace artifact, content recognisable but not clean | Right *idea* (2-way field interleave), wrong bank size -- CGA hardware banks are a fixed 0x2000 (8192) bytes regardless of how much real data they hold; using the tight-packed 8000-byte size misaligns bank 1 by 192 bytes |
| Packed-pixel, 2-way row interleave, `bankGap = 0x2000` (hardware-accurate) | **Clean, sharp, fully legible** -- decisive | Correct on the first attempt with the disassembly-confirmed bank size; independently corroborated by `cga.drv`'s blit routine applying the same `0x2000` gap to its source pointer |
| Pixel-co-occurrence cross-reference against the already-confirmed EGA decode | Correctly identified "Palette 1" family (cyan/magenta) over "Palette 0" (green/red/brown), but only a modest numerical edge for intensity (low vs. high) | Statistical method, contaminated by dithering/edge pixels near palette-family boundaries; decisive for the coarse question (which 2 of 4 candidate families), not fully decisive for the finer one (which intensity) -- resolved by combining with the `wroot.exe` disassembly instead |

---

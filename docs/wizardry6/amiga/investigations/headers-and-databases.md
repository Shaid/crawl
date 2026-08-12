# Investigation: `.hdr` index files + `pcfile.dbs`/`newgame.dbs`/`scenario.hdr`

Status: working notes from a targeted disassembly pass on 5 small index/
database files (`scenario.hdr`, `master.hdr`, `disk.hdr`, `newgame.dbs`,
`pcfile.dbs`). **Not yet merged into `docs/wizardry6/amiga/data-structure.md`**
— a human will fold the confirmed sections in. This file follows the same
confidence conventions as the main doc (confirmed / rendered / hypothesis).

All addresses below are cited as `CODE+0xNNNN`. **Two different bases are
in play in this codebase's own existing citations, and this file follows
whichever one the main doc already established for a given address,
rather than silently unifying them** (flagging this explicitly so a
future merge doesn't introduce off-by-`0x28` errors):

- For addresses found by locating bytes directly in the file (string
  search, disassembling the extracted CODE-hunk payload, etc.), `CODE+N`
  = **file offset** in `Bane` = `hunk-relative offset + 0x28` (the CODE
  hunk's payload starts at file offset `0x28`). Confirmed by
  cross-checking against the main doc's own citations — its `PCFILE.DBS`
  "call site" list, `0x5af4/0x29c1a/0x2fd14/0x300c6`, turned out to be the
  exact file offsets of the 4 standalone `"PCFILE.DBS"` string literals
  themselves, not JSR targets (see "Correction" below) — and this is the
  basis used for essentially every address in this document.
- For the handful of addresses that are **A4 small-data jump-table
  targets** (resolved via the main doc's §1.4 formula, reading a `JMP.L`
  absolute target straight from the DATA hunk — which is a pre-relocation
  runtime address, i.e. numerically equal to the **hunk-relative**
  offset since the CODE hunk loads at runtime address 0), this document
  cites the **raw, unadjusted** target value — matching how the main doc
  itself already cites those exact functions (e.g. `-0x7eae(A4)` ->
  entry 56 -> `CODE+0x35e6`; `-0x7d64(A4)` -> entry 111 -> `CODE+0x54e40`
  — both already in the main doc's §1.4 table, unadjusted). The
  "Correction" table below (§ entries 108, 103, 110, 112, 123, 125, 115,
  29) uses this same raw/unadjusted basis throughout, and any later
  reference to one of *those specific* functions elsewhere in this
  document also uses the raw value, called out inline where it happens.

DATA-hunk buffer addresses are cited as `-0xNNNN(A4)` (SAS/C small-data
displacement) with the derived DATA-hunk offset noted (`0x7FFE - |disp|`).

Method: extracted the CODE hunk to a raw binary
(`data[0x28:0x55C64]` of `Bane`) and used `r2 -a m68k -b 32 -q -n` per the
`radare2-amiga` skill, plus the DATA-hunk jump-table technique from the main
doc's §1.4 (`A4 = DATA_start + 0x7FFE`; `target = BE u32 @ (0x55c98 +
entry*6 + 2)`, `entry = (0x7FFE - |disp|) / 6`). Verified against known
entries from the main doc (55, 56, 111, 125, 29) before trusting new ones.

---

## Correction to §1.1/§1.4: the `PCFILE.DBS` "call sites" are string literals, and entry 29 is not "open"

The main doc's §1.1 lists `PCFILE.DBS (4 standalone call sites) |
0x5af4, 0x29c1a, 0x2fd14, 0x300c6`. Disassembling at those exact addresses
produces garbled/`invalid` output — because they are the file offsets of
the **`"PCFILE.DBS\0"` string bytes themselves** (confirmed: a raw string
search of the extracted CODE hunk finds `PCFILE.DBS` at hunk-relative
`0x5acc/0x29bf2/0x2fcec/0x3009e`, and `+0x28` lands exactly on the doc's
cited addresses). The real call sites are found by searching for
`PEA d16(PC)` instructions whose resolved target is the string address —
this finds one `PEA` immediately before each string, at hunk-relative
`0x4b4c / 0x5a58 / 0x29b7e / 0x2fcb6 / 0x30068` (5 hits: the master
filename table's `PCFILE.DBS` load, plus the 4 "standalone" ones).

Also, the main doc's §1.4 A4-jump-table entry list labels `-0x7f50(A4)`
(entry 29, `CODE+0xf66`) as **"open file by name"**. Disassembling
`CODE+0xf66` end-to-end shows it does **not** call any DOS `Open()` — it
concatenates a static device-prefix buffer with the given filename into a
fixed 58-byte scratch buffer (`-0x751e(A4)`/`-0x70fe(A4)`, `BSR CODE+0xf26`
[hunk-rel `0xefe`]) and returns a **pointer to that path string**. The
*actual* `Open()` call is entry 111 (`-0x7d64(A4)`, `CODE+0x54e40`,
already labeled "(file handle helper)" in the main doc) — it's called
immediately afterward with the path pointer, and *that* call's `d0` is the
real DOS file handle used by every subsequent seek/read/write/close. This
should be relabeled in the main doc:

| A4 ref | Entry | Target | Correct role |
|---|---|---|---|
| `-0x7f50(A4)` | 29 | `CODE+0xf66` | **`BuildResourcePath(name) -> char*`** (prefixes a device string, does not open) |
| `-0x7d64(A4)` | 111 | `CODE+0x54e40` | **`Open(path) -> handle`** (the real open call) |
| `-0x7d6a(A4)` | 110 | `CODE+0x54db0` | `Seek(handle, offset)` (new, not in main doc) |
| `-0x7d5e(A4)` | 112 | `CODE+0x54f86` | `ReadBytes(handle, buffer, count)` — matches main doc §1.3's already-cited `CODE+0x54f86` target for the Huffman loader's read call, confirming the entry-number formula |
| `-0x7d1c(A4)` | 123 | `CODE+0x5564a` | `WriteBytes(handle, buffer, count)` (new) |
| `-0x7d10(A4)` | 125 | `CODE+0x5585c` | `Close(handle)` (matches main doc) |
| `-0x7d76(A4)` | 108 | `CODE+0x54d80` | `strcmp`/`strncmp`-style byte-string compare (new) |
| `-0x7d94(A4)` | 103 | `CODE+0x54cac` | `strcpy(dest, src)` (new) |
| `-0x7d4c(A4)` | 115 | `CODE+0x553ac` | file-copy helper (new; used by "start new game" to duplicate `NEWGAME.DBS` -> `SAVEGAME.DBS`, see below) |

---

## 1. `pcfile.dbs` — **confirmed, overturns the 289x24 hypothesis**

**The main doc's `6936 / 289 = 24` hypothesis is wrong.** The real
structure, confirmed via disassembly and byte-exact against the shipped
file:

```
pcfile.dbs = 24-byte header + 16 x 432-byte character records
             24 + 16*432 = 6936  (exact, matches file size)
```

### 1.1 Header (24 bytes) — confirmed

At startup, `Bane` reads exactly the first **24 (0x18) bytes** of
`PCFILE.DBS` into a DATA-hunk buffer at `-0x71ca(A4)` (DATA offset
`0xE34`), via the generic `ReadFileBytes(name, buffer, count)` helper
(`CODE+0x4514`, entry index calc confirmed against known entries — see
correction above). Call site: `CODE+0x4b6c`-`0x4b78`
(`move.w #0x18,-(a7); pea -0x71ca(a4); pea "PCFILE.DBS"(pc); jsr
ReadFileBytes`).

| Buffer offset | `-N(A4)` | File offset | Size | Field | Value (shipped file) |
|---|---|---|---|---|---|
| +0 | `-0x71ca` | 0 | word | `recordSize` | `0x01B0` = 432 |
| +2 | `-0x71c8` | 2 | word | `recordCount` | `0x0010` = 16 |
| +4 | `-0x71c6` | 4 | long | `baseOffset` | `0x00000018` = 24 |
| +8 | `-0x71c2` | 8 | byte[16] | `usedFlags[16]` | all zero (fresh install) |

Confirmed via:
- `24 + recordCount*recordSize == fileSize` (`24 + 16*432 = 6936`), exact.
- `recordSize` (`-0x71ca(A4)`) is read via `MULS.W -0x71ca(a4), d0` at
  `CODE+0x5a9c`/`CODE+0x29bc2` (see §1.2) to compute a record's byte
  offset — i.e. it's genuinely consumed as a stride, not just present.
- `recordCount` (`-0x71c8(A4)`) is the loop bound in the two roster-scan
  functions (`CODE+0x8026`/`0x30580`, `cmp.w -0x71c8(a4),d0`) and the
  "find slot by name" function (`CODE+0x2fd48`, `cmp.w -0x71c8(a4),d4`).
- `usedFlags[16]` (`-0x71c2(A4)`) is read one byte per slot in all three of
  those loops (`tst.b (a0,d4.w)` / `cmpi.b #1,(a0,d0.w)`) to skip empty
  slots — and in the shipped (fresh-install) file every flag is 0, matching
  "no characters yet", consistent with all 16 records also being all-zero
  (verified: every one of the 16 records is 100% zero bytes in this file).
- `baseOffset` (`-0x71c6(A4)`) is added (`ADD.L`) to `record_index *
  recordSize` right before the seek call — i.e. it's the header size,
  confirmed algebraically (`24` exactly).

This **overturns** the main doc's §7.3 hypothesis outright: there is no
"record 0 is a header, real roster is 23 slots" ambiguity — the header is
a genuinely separate 24-byte struct *before* the record array, not record
slot 0, and the real roster is exactly **16 slots**, not 23 or 24. The
"4 non-zero bytes: `01 b0 00 10 00 00 00 18`" the main doc read as "record
0" are precisely this header's 4 populated fields (`01B0, 0010,
00000018`), which is why its last value (`0x18`) "coincidentally" equalled
the doc's guessed slot count of 24 — it doesn't, it's actually the header
size (24 *bytes*, not 24 *slots*).

### 1.2 Character record (432 bytes) — read/write mechanism confirmed, most fields open

A shared function exists in **two byte-identical copies** at hunk-relative
`0x5a4c` (`CODE+0x5a74`) and `0x29b72` (`CODE+0x29b9a`) — same bytes, two
separate compiled instances, presumably two independently-linked call
sites from the original source. Signature: `RwRecord(buffer, index, mode)`
(args at `0x8(a5)`, `0xc(a5)`, `0xe(a5)` respectively, confirmed from the
calling convention at every call site):

```
seekOffset = index * recordSize + baseOffset     ; -0x71ca / -0x71c6 (A4)
Seek(fh, seekOffset)
if mode == 0:  ReadBytes(fh, buffer, recordSize)
if mode == 1:  WriteBytes(fh, buffer, recordSize)
Close(fh)
```

7 call sites found (`CODE+0x7fa6`, `0x8468`, `0x2fcc2`, `0x2ff42`,
`0x301b0`, `0x30212`, `0x30500` — hunk-relative `+0x28`), covering: roster-list
building (name + 3 icon bytes -> UI arrays), "find character slot by
name" (`CODE+0x2fd48`), add/remove-from-roster, and a full in-memory
roster cache (`-0x4602(A4)`, confirmed: a `432`-byte-stride block-copy loop
at `CODE+0x84ca`/`0x854c` — `MULS.W #0x1B0,d0` then a 108-longword
`MOVE.L (a1)+,(a0)+` loop, `108*4 = 432` exact — independently
re-confirms the record size a second way).

Fields located so far (all via A4-relative / A5-relative local-buffer
displacement, cross-checked against the confirmed 432-byte record
boundary):

| Record offset | Type | Evidence |
|---|---|---|
| `+0` | NUL-terminated ASCII string (**name**) | `strcmp`-style compare (`CODE+0x54d80`, entry 108 — see Correction table above; note this is a raw A4-jump-table target address, cited unadjusted per the main doc's own §1.4 convention, *not* the file-offset-plus-`0x28` convention used for directly-disassembled addresses elsewhere in this doc) called with the record buffer as one operand in "find slot by name" (call site `CODE+0x2fd72`); separately, `strcpy(dest, recordBuffer)` (`CODE+0x54cac`, entry 103, same raw-address caveat) is used to copy this same field into an 8-byte-stride roster-name array for a UI list (call site `CODE+0x7fc0`) — two independent call sites agree the first field is a string |
| `+412` | byte | read (`CODE+0x84ba`) and pushed as the sole argument to a `WPORT1.{EGA,CGA,T16}`-selecting/portrait-loading routine (`CODE+0x66ba`). **Hypothesis, not confirmed**: that routine's first action on its argument, in the block starting at `CODE+0x673a` (hunk-relative `0x6712`), is `DIVS.W #14, d0` (at `CODE+0x6740`) — dividing by exactly **14**, the game's already-confirmed real class count (main doc §7.1) — with the quotient turned into an ASCII digit (`+'1'`, likely a `WPORT<N>` filename suffix) and the remainder fed back in as a re-used index for whatever comes next. This is suggestive of field 412 being a combined `(portraitFile, classOrVariant)` selector (`portraitFile = field412 / 14`, `remainder = field412 % 14`), matching this project's round-number/known-count oracle convention, but **not verified against a live character** (the shipped `pcfile.dbs` has no non-empty records to sample a real value from) — flagged as hypothesis only. An earlier draft of this table mischaracterized this as a "class-icon lookup" against a different, unrelated function; that was wrong and is corrected here. |
| `+413` | byte | written into a word-array for UI list rendering (`CODE+0x7fc6`-`0x7fe4`); paired with offsets 414/415 below in the same loop |
| `+414` | byte | ditto, separate array |
| `+415` | byte | ditto, separate array |

The gap between offset 0 (name start) and offset 412 (432 - 412 = 20
bytes before EOF) is unexplored — the name field's own max length was not
determined (only that it's NUL-terminated; the shipped file has no live
characters to sample a real name from). Given all 16 shipped records are
100% zero, no live-data field values could be sampled this pass — only
the *offsets and access patterns* are confirmed, not concrete example
values. **Open**: bytes 1-411 (race/class/stats/inventory, almost
certainly, per generic Wizardry character-record conventions, but no
disassembly evidence located this pass to back specific sub-offsets).

### 1.3 Paths tried

| Approach | Result | Why it failed / what it found |
|---|---|---|
| Trust main doc's `PCFILE.DBS` "call site" addresses literally | garbled/`invalid` disassembly | those addresses are the string literal bytes, not code — see Correction above |
| Search for `PEA d16(PC)` instructions targeting the string addresses | **found the 5 real call sites** | straightforward once corrected |
| Trace the 4 real call sites' surrounding function bodies | 2 were literally byte-identical (`0x5a4c`==`0x29b72`) | same routine compiled/linked twice; not a bug, just redundant linkage |
| Cross-check record size via a completely independent code path (in-memory roster block-copy) | `MULS.W #0x1B0` = 432, same value | strong second confirmation, found by tracing a different caller entirely (`CODE+0x8438`, single-character add-to-roster) |

Verified extractor: `tools/wizardry6/decode-headers.ts` (new, this pass) —
writes `public/assets/wizardry6/amiga/data/headers.json`.

---

## 2. `master.hdr` (66 bytes) — **confirmed** (full structural decode)

`master.hdr` is **not** an opaque 20-constant table. It is a **two-part,
10-entry table** describing `scenario.dbs`'s internal section layout:

```
words[0..9]   = per-section RECORD SIZE (bytes), for scenario.dbs sections 0-9
words[10..19] = per-section RECORD COUNT,        for scenario.dbs sections 0-9
```

(20 BE u16 values total = 40 bytes; the remaining 26 bytes of the 66-byte
file are zero padding, as the main doc already noted.)

### Verification (byte-exact, 10/10 sections, cross-file)

`disk.hdr`'s 9 BE u32 values (see §3) are `scenario.dbs` section boundary
offsets. Treating `[0, disk.hdr[0..8], scenario.dbs.size]` as 11 boundary
points gives 10 gaps (section sizes in bytes). **Every single gap divides
exactly by the corresponding `master.hdr[0..9]` word, with zero
remainder, in strict index order** — checked programmatically, no
cherry-picking:

| Section | scenario.dbs range | Gap (bytes) | `master.hdr[i]` (record size) | Gap / size = count | `master.hdr[10+i]` (record count) | Match? |
|---|---|---|---|---|---|---|
| 0 | `0x0`–`0x380` | 896 | 64 | 14 | 14 | yes |
| 1 | `0x380`–`0x9408` | 37000 | 74 | 500 | 500 | yes |
| 2 | `0x9408`–`0xe828` | 21536 | 1346 | 16 | 16 | yes |
| 3 | `0xe828`–`0x154e8` | 27840 | 1740 | 16 | 16 | yes |
| 4 | `0x154e8`–`0x22db4` | 55500 | 222 | 250 | 250 | yes |
| 5 | `0x22db4`–`0x23f74` | 4544 | 142 | 32 | 32 | yes |
| 6 | `0x23f74`–`0x27174` | 12800 | 32 | 400 | 400 | yes |
| 7 | `0x27174`–`0x290b4` | 8000 | 40 | 200 | 200 | yes |
| 8 | `0x290b4`–`0x2df34` | 20096 | 314 | 64 | 64 | yes |
| 9 | `0x2df34`–EOF (188980) | 768 | 12 | 64 | 64 | yes |

**Section 0 is independently confirmed already**: the main doc's §7.1
identifies `scenario.dbs[0x000:0x380]` as 14 back-to-back XP tables of
16 BE u32 each — `14 records x 64 bytes` is *exactly* `master.hdr`'s
section-0 entry (`recordSize=64, count=14`), discovered completely
independently (round-decimal-value heuristic, no knowledge of this
section table) in an earlier pass. This cross-validation is strong
evidence the section-table read is correct, not coincidental curve-fitting
across 10 arbitrary numbers.

**Also resolves the main doc's "mysterious 768 bytes" note** (§3, §6.5):
section 9 (`scenario.dbs[0x2df34:EOF]`, 768 bytes) is exactly `64 records
x 12 bytes` — not a hidden palette, not a trailer, just the last (and
smallest-record) section in this same directory system. The `768` byte
figure appearing near the `.EGA` screens (main doc §3) is very likely
**unrelated** — that's a different file format, no evidence connects them
beyond the numeric coincidence; that angle is explicitly out of scope
here (per task instructions) and is left to whichever pass owns `.EGA`.

### Confirmed via disassembly: the generic section reader

`CODE+0xa24`-`0xab6` is a shared `ReadSection(category, recordIndex) ->
seek+read` routine:

```
d0 = category * 4
baseOffset = *(u32*)(-0x7482(A4) + d0)        ; scenario.dbs section base-offset table
d1 = category * 2
recordSize = *(u16*)(-0x74c8(A4) + d1)        ; == master.hdr word[category]  (buffer IS master.hdr's cache)
seekOffset = baseOffset + recordIndex * recordSize
Seek(scenarioDbsHandle, seekOffset)           ; handle cached at -0x766a(A4), opened from "SCENARIO.DBS" (string literal at CODE+0x4df7, open call block at CODE+0x4be0-0x4bf6)
```

`-0x74c8(A4)` (DATA offset `0xB36`) is confirmed as `master.hdr`'s own
20-word in-memory cache: it's populated by the same
`ReadFileBytes("MASTER.HDR", buffer, 0x42)` call
(`CODE+0x4b30`-`0x4b74`) that reads the whole 66-byte file verbatim — the
reader indexes directly into this cache, no separate copy.

`-0x7482(A4)` (DATA offset `0xB7C`) is a **runtime-populated** 20-entry
`u32` base-offset array — its initial 10 entries are populated from
`disk.hdr` (see §3); how entries 10-19 are populated (if at all — no
`disk.hdr` data exists for them, since `disk.hdr` only supplies 9 real
offsets) was **not traced this pass** — flagged open below.

### Open

- Categories 10-19 have real (non-zero) `master.hdr` record sizes and
  counts, but no corresponding `disk.hdr` base offsets were found (only 9
  exist). Either they reuse a different offset source not found this
  pass, or they're vestigial/unused in the shipped game. Not resolved.
- The record *contents* of `scenario.dbs` sections 1-9 (item stats,
  monster stats, spell data, etc. almost certainly) are explicitly **out
  of scope** for this investigation (owned by another pass) — this
  section only documents the directory/index system that locates them,
  for that pass's benefit.

Verified extractor: `tools/wizardry6/decode-headers.ts` — writes the
decoded `{recordSizes: number[10], recordCounts: number[10]}` plus the
derived section table (offsets from `disk.hdr`, sizes, counts) to
`public/assets/wizardry6/amiga/data/headers.json`.

---

## 3. `disk.hdr` (700 bytes) — **confirmed** (header), **confirmed role** (trailing ramp)

### 3.1 Header (44 bytes, not 24) — confirmed

> **Correction to main doc §6.5:** "First 24 bytes: 3 zero words, then 9
> BE u32..." is a miscount. Reading the actual file: the first **4** words
> (8 bytes) are zero, not 3, and the 9 BE u32 values that follow occupy
> bytes 8-43 (36 bytes) — the real header is **44 bytes**, not 24. The 9
> hex values themselves were transcribed correctly in the main doc, but
> **two of the main doc's own decimal conversions are wrong**:
> `0x00022db4` is **142772**, not `142804` as the main doc states, and
> `0x00023f74` is **147316**, not `146292`. (Re-derived directly with
> Python's own hex parser to rule out a second transcription slip here —
> `int('22db4',16) == 142772`, `int('23f74',16) == 147316`.) The correct
> full decimal list is:
> `896, 37896, 59432, 87272, 142772, 147316, 160116, 168116, 188212`.
> This does **not** change any conclusion below — the section-boundary
> divisibility check in §2 was computed from the hex literals throughout
> (never from the bad decimal figures), so it's unaffected; only the main
> doc's own printed decimal numbers need fixing on merge.

These 9 values are `scenario.dbs`'s section 1-9 base offsets (section 0's
base offset, 0, is implicit/hardcoded — see §2). Confirmed by the
byte-exact section-size/`master.hdr`-divisor match in §2.

### 3.2 Trailing 656 bytes — **confirmed role**, content genuinely a ramp

> **Correction to main doc §6.5:** the trailing bytes are not
> unexplained filler. They **are read by code** — as 5 separate
> byte-indexed lookup tables, consumed by a "remap record index by
> category" dispatch at `CODE+0xa30`-`0xaa8` (hunk-relative
> `0xa08`-`0xa80`, a `CMP.L #7,d0; BCC.b default; JMP (pc,d0.w)` switch on
> a small "category" value 0-7). Table boundaries (all relative to
> `disk.hdr` file offset 44, where the header ends):

| Table | `disk.hdr` offset range | Size | `-N(A4)` LEA site |
|---|---|---|---|
| 0 | 44-59 | 16 | `CODE+0xa34` |
| 1 | 60-123 | 64 | `CODE+0xa48` |
| 2 | 124-379 | 256 | `CODE+0xa5c` |
| 3 | 380-635 | 256 | `CODE+0xa70` |
| 4 | 636-699 | 64 | `CODE+0xa84` |

`16+64+256+256+64 = 656`; `44+656 = 700` — exact, zero remainder,
independently confirms these 5 ranges partition the whole trailing region.

The content itself, however, really is what the main doc already
suspected: a literal `0x00..0xFF` byte ramp — but checked precisely
(programmatically, byte-exact), it is **not one continuous ramp across
the whole 656-byte trailing region**. Each of the 5 tables
**independently resets to 0 at its own start**: `table[i] == i mod 256`
holds for every one of the 5 tables checked separately (verified,
zero deviation in all 5), but table 2 (e.g.) does *not* continue from
table 1's ending value — it restarts at 0. This means every one of the 5
tables is, exactly, its own **identity lookup** (`table[i] = i`) over its
own size — a cleaner and stronger finding than "one big ramp that happens
to look like identity for small indices": it's identity *by construction*
for every index up to each table's own declared size (16, 64, 256, 256,
64 respectively — the two 256-entry tables cover the full byte range,
so index truly can't escape identity there; the three smaller tables are
identity only up to their own size, same as before). This confirms the
main doc's existing "generic identity-translation table baked in by the
tool" guess, but upgrades it from speculation to **disassembly- and
byte-exact-confirmed**: it's not dead/unused padding, it's a real,
exercised code path that happens to have no real remapping data behind
it in this shipped build (plausibly a general remapping *feature* that
the final game never actually needed).

### 3.3 Paths tried

| Approach | Result | Why it failed / what it found |
|---|---|---|
| Assume 24-byte header per main doc | off by 20 bytes | direct byte recount from the file fixed it |
| Grep whole-binary A4-relative-displacement scan for accesses inside `disk.hdr`'s buffer range | found the 5 `LEA` sites + the base-offset-table `LEA` | confirms the ramp is genuinely read, not just coincidentally-overlapping unrelated globals (verified: these buffers are populated by a single `ReadFileBytes(..., 0x2BC)` call, i.e. any code addressing that exact 700-byte span by construction touches real file bytes) |

Verified extractor: `tools/wizardry6/decode-headers.ts`.

---

## 4. `scenario.hdr` / `newgame.dbs` shared header (414 bytes)

### 4.1 Load mechanism — confirmed

`SCENARIO.HDR` is opened and read as a **flat 414-byte blob**
(`move.w #0x19E,-(a7)` = 414 exactly) into DATA-hunk cache `-0x7666(A4)`
(`CODE+0x48d4`, `ReadFileBytes("SCENARIO.HDR", buffer, 0x19E)`) — no
internal directory/count field is parsed at load time; the whole thing is
just cached verbatim for later field-level access elsewhere in the game
(consistent with the main doc's observation that `scenario.hdr` ==
`newgame.dbs[0:414]` byte-for-byte).

### 4.2 Trailing 6 bytes (offsets 408-413) — confirmed as individually-addressed fields

A whole-binary scan for any A4-relative access landing inside this
buffer's 414-byte span (safe to trust — see §3.3's reasoning: the whole
span is populated by one `ReadFileBytes` call, so any code touching it by
construction touches real file bytes) finds **76 references**, six of
which are byte-granular fields at the very end of the file:

| File offset | `-N(A4)` | Shipped value | Evidence |
|---|---|---|---|
| 408 | `-0x74ce` | `0x00` | read (`CODE+0xcca`, `0x12788`, `0x12ef2`), written (`CODE+0x12f08`) |
| 409 | `-0x74cd` | `0x10` | read (`CODE+0x48f8`, `0x7106`, `0x127a2`, `0x12f12`, `0x12f3e`, `0x131d2`), written (`CODE+0x70e6`, `0x12f2c`) |
| 410 | `-0x74cc` | `0x01` | compared `cmpi.b #3,...` (`CODE+0x4482`) and `cmpi.b #1,...` (`CODE+0x6f4c`, `0x1330c`) — both against the shipped value of `1`, the `#1` comparisons match; written (`CODE+0x70ec`) |
| 411 | `-0x74cb` | `0x00` | read (`CODE+0x127b8`, `0x12f4c`), written (`CODE+0x70f2`, `0x12f62`) |
| 412 | `-0x74ca` | `0x01` | compared `cmpi.b #1,...` (`CODE+0x49a6`, `0x131e2`) — matches shipped value; read (`CODE+0x127d2`, `0x12f6c`), written (`CODE+0x70f8`, `0x12f7a`) |
| 413 | `-0x74c9` | `0x01` | read (`CODE+0x4902`, `0x127ea`), written from a local computed value (`CODE+0x70fe`) |

(Full byte dump for reference, file offset 406-413: `00 00 00 10 01 00 01
01` — matches the main doc's "Ends with `10 01 00 01 01`" for the last 5
bytes exactly.)

These 6 bytes are consumed as small integer flags/state (compared against
literal `1` and `3` in several places) throughout the game's runtime code,
not just at load — this is a genuine, confirmed structural fact (6
trailing single-byte fields), but their **semantic meaning** (game-state
flag? difficulty? party-created flag?) was not determined this pass —
labeled hypothesis-only.

### 4.3 The embedded `H0:`/`F0:` strings are a *live* scratch-buffer overlap — confirmed

The main doc flags the embedded `"H0:"` (offset ~308) and `"F0:"` (offset
~382) strings as "likely build-time artifacts... not consumed at
runtime". This pass found stronger evidence: the `BuildResourcePath`
helper (§ Correction, `CODE+0xf66`) uses a **fixed scratch buffer** at
`-0x751e(A4)` to build "device:filename" strings at runtime — and that
exact address maps to **file offset 328** in the `scenario.hdr` cache
buffer, which is 1 byte before the shipped file's own `"H0:"` string
(file offset 329-331). I.e. **this specific byte range of the loaded
`scenario.hdr`/`newgame.dbs` cache is reused as the live path-building
scratch buffer at runtime** — the `"H0:"` text visible in the shipped
file is stale content from whatever the original build tool last wrote
there (matching the main doc's build-time-artifact guess), and the game
itself doesn't care what's there before its own `BuildResourcePath` calls
overwrite it. This is a **confirmed** (not just plausible) explanation
for why that specific string exists at that specific offset, though it
does not mean the string's original content had game-level meaning
independent of the build tool.

### 4.4 `newgame.dbs` beyond the shared 414-byte header — open, partial

The main doc leaves the remaining `49856 - 414 = 49442` bytes fully
undetermined. This pass found:

- **Confirmed (disassembly)**: at "start new game", the game does
  **not** parse `NEWGAME.DBS` field-by-field — it opens it, builds a
  resource path for `SAVEGAME.DBS`, and calls the file-copy helper
  (`CODE+0x553ac`, entry 115, new — see Correction) to duplicate the
  whole file verbatim (`CODE+0x6ea0`-`0x6fac`). So `newgame.dbs` is
  architecturally a **save-file template** — its internal record layout
  is whatever `SAVEGAME.DBS`'s (the live save format) loader expects, not
  something parsed by the "new game" trigger path itself. That loader
  was not traced this pass (no `SAVEGAME.DBS` exists in the shipped data
  corpus to cross-check against, since it's runtime-created — per the
  main doc's own note in §1.1).
- **Structural note (not decoded)**: the remaining bytes are not just
  padding — `18204 / 49442` bytes (37%) are non-zero, spread across
  nearly the whole remaining file (first non-zero at file offset 415,
  last at 49813, 41 bytes before EOF). The first 64 bytes of this region
  (`01 01 00 01 01 02 03 04 05 06 07 05 06 07 08 09 0a 08 09 0a 08 09 0a
  00...`) contain small ascending-run patterns reminiscent of the
  `disk.hdr` identity-ramp tables (§3.2), but no record-stride hypothesis
  was tested against this region this pass — left fully open,
  flagged as a good next target (the confirmed `RwRecord`/432-byte
  machinery from §1.2 is a plausible next thing to check this region
  against, since starting-party data is a natural candidate, but that
  was not attempted here).

### 4.5 Paths tried

| Approach | Result | Why it failed / what it found |
|---|---|---|
| Whole-binary A4-displacement scan restricted to the buffer's 414-byte span | found 76 real references, 6 of them byte-granular trailing fields | straightforward once the buffer's exact base/size was confirmed from the `ReadFileBytes` call site |
| Assume the `H0:`/`F0:` strings are pure inert build artifacts (main doc's original framing) | superseded | found a live consumer (`BuildResourcePath`'s scratch buffer) landing on the same address |
| Attempt to trace `NEWGAME.DBS`'s post-header bytes via a record-stride guess | not attempted (time-boxed) | no disassembly lead found pointing at a specific reader for this region; the only confirmed consumer (`SAVEGAME.DBS`-copy) treats it as an opaque blob |

Verified extractor: `tools/wizardry6/decode-headers.ts` — extracts the
shared 414-byte header (both files) plus the 6 trailing flag bytes; does
**not** attempt to decode `newgame.dbs`'s remainder (left as raw bytes /
open).

---

## 5. Summary table (for merge into the main doc)

| Format | Old status | New status | Evidence |
|---|---|---|---|
| `pcfile.dbs` | hypothesis (289x24) | **confirmed** (24B header + 16x432B records) | byte-exact size match, 2 independent record-size confirmations via disassembly, header field roles all traced to real consumers |
| `master.hdr` | open | **confirmed** (10 record-sizes + 10 record-counts for `scenario.dbs` sections) | 10/10 exact-divisor cross-check against `disk.hdr` boundaries, independently re-confirms the already-known XP-table boundary |
| `disk.hdr` | open | **confirmed** (44B header of 9 section base-offsets; trailing 656B = 5 confirmed-consumed but content-trivial lookup tables) | disassembly of the section reader + category-remap dispatch; byte-exact table-boundary partition |
| `scenario.hdr` | open (structure) | **confirmed** (load mechanism, 6 trailing flag-byte fields, `H0:` scratch-buffer explanation); semantics of those 6 bytes still hypothesis | disassembly of `ReadFileBytes` call site + whole-binary displacement scan |
| `newgame.dbs` | open | **partial**: shared-header portion confirmed via scenario.hdr; "new game" trigger treats the whole file as an opaque copy-source; post-header 49442 bytes still fully open | disassembly of the new-game/save-copy code path |

Also resolves the main doc's §3/§6.5 "mysterious 768 bytes" cross-file
lead: it's `scenario.dbs` section 9 (64 x 12-byte records), unrelated to
the `.EGA` screens' own trailing-768-bytes puzzle (left to that format's
owner).

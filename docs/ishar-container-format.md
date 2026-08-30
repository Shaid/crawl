# Ishar-engine resource container format (Silmarils, 1990-1994)

Shared by all four titles investigated in this pass: **Crystals of Arborea**
(1990, `data/crystalsofarborea/amiga/*.CO`), **Ishar: Legend of the Fortress**
(1992, `data/ishar/amigaaga/*.DO`), **Ishar 2: Messengers of Doom** (1993,
`data/ishar2/amigaaga/*.DO`), and **Ishar 3: The Seven Gates of Infinity**
(1994, `data/ishar3/amigaaga/*.DO`). Crack the container once, document it
here; per-game specifics (file catalog, individual resource semantics) live
in each game's own `docs/<game>/<platform>/data-structure.md`.

The container/compression layer (§2) is now confirmed via real open-source
prior art for this exact engine (Silmarils' "ALIS" engine family):
`github.com/maestun/silm-depack` and `github.com/maestun/alis` (both MIT).
Everything past the container layer (per-title resource semantics, the
overworld/dungeon-view question) remains a from-scratch investigation —
no prior-art tool or fan documentation covers Ishar's *content* formats.

## 1. Executables (disassembly oracle)

Every title ships a real AmigaOS `loadseg()`-able hunk executable, which
`file`-detection on extensionless names alone missed on the first pass (an
easy trap: these carry a `.X` or no extension that doesn't look like an
executable):

| Title | File | Size | Hunks |
|---|---|---|---|
| Ishar 1 | `data/ishar/amigaaga/T.X` | 75,200 B | CODE(13,888)+DATA(33,136)+CODE(13,724)+CODE(4,372) |
| Ishar 2 | `data/ishar2/amigaaga/T.X` | 78,320 B | same shape, NOT byte-identical to Ishar 1's (differs from byte 23) |
| Ishar 3 | `data/ishar3/amigaaga/START` | 97,072 B | (not yet parsed this pass) |
| Crystals of Arborea | `data/crystalsofarborea/amiga/T.X` | 54,420 B | (not yet parsed this pass) |

All four start with `HUNK_HEADER` (`0x000003F3`) at file offset 0 — confirmed
real hunk executables, not raw code. No `HUNK_SYMBOL` block in Ishar 1's
`T.X` (no leaked symbol names). `strings` on Ishar 1's `T.X` confirms it is
the main engine binary, not a stub loader: it contains `dos.library`,
`graphics.library`, `intuition.library`, `keyboard.device`,
`trackdisk.device`, the French error string `"erreur opensystem"`, `"Not
enough memory. Please disconnect the external drive and reboot."`, and two
direct filename references — `BLANC.SND` and `MAIN.DO`/`main.do` (both
cases present) — confirming `T.X` opens `MAIN.DO` directly by name at
startup (see §4).

**Compression/decompression: CONFIRMED, cracked and ported (§2.5)** — closed
this session. Both the `amiga-disasm` agent's live disassembly trace of
`T.X` and an independently-found open-source reference implementation
(`github.com/maestun/silm-depack`, MIT) converged on the same two codecs.

## 2. The container header — CONFIRMED (superseding the original structural read)

> **Correction:** the original pass (below, §2 as first written) derived a
> 16-byte header purely from byte-position statistics, before the codec was
> cracked. It correctly identified the class byte and the 24-bit size field,
> but mis-modeled bytes 4-15 as one flat "codec table" — they are actually
> **two distinct sub-fields** (`isMain` sentinel + a per-index bit-width
> dictionary, only present for the LZ77 codec) whose sizes differ by codec
> and by whether the file is the engine's "main" script. See §2.5 for the
> confirmed layout and the reference source it was verified against; the
> ratio/class-byte evidence in §2.1-§2.3 below is unaffected and still holds.

```
offset  0-3  u32 BE  magic       — top byte = packer kind (0x01 stored / 0x81,0x80 old RLE / 0xA1 new LZ77);
                                    low 24 bits = declared total size (header + payload)
offset  4-5  u16 BE  isMain      — 0 = this file is the engine's root/main script (MAIN.DO/MAIN.CO)
offset  6-21 16 B    vmSpecs     — present ONLY if isMain == 0 (main files carry this extra block)
offset  N    8 B     dictionary  — present ONLY for packerKind == 0xA1 (new codec); per-index bit-width table
                                    driving the LZ77 match-length/distance decode
```

`decompressedSize = (magic & 0x00FFFFFF) - headerSize`. The 16-byte cut this
doc originally described (§2 as first measured) is the `classByte + sizeHigh
+ sizeLow + [10-byte table]` view of exactly this same header for a
**non-main, 0xA1-class** file (`isMain` u16 + 8-byte dictionary = 10 bytes) —
the two derivations agree; the correction is purely in what those 10 bytes
*are*, not their position or size. See §2.5.

Implemented in `tools/shared/ishar-container.ts` (`parseIsharHeader`, the
original structural view — still useful for the inventory scan) and, with
the confirmed semantics, `tools/shared/silmarils-unpack.ts`
(`unpackSilmarilsScript`). The inventory scanner
(`tools/shared/ishar-inventory.ts`, per-title CLI wrappers under
`tools/<game>/<platform>/inventory.ts`) still uses the original structural
parse (sufficient for cataloguing); the real decoder uses the corrected one.

### 2.1 Evidence: the decompressed-size hypothesis holds corpus-wide

For every file with `classByte != 0x01`, `decompressedSize / fileSize`
(the implied compression ratio) is **>= 1.0 with no exceptions**, across
all four titles' full corpora (413 compressed files total):

| Title | compressed files | ratio min | ratio max | ratio mean |
|---|---|---|---|---|
| Ishar 1 | 98 | 1.019 | 3.578 | 1.880 |
| Ishar 2 | 137 | 1.039 | 3.718 | 2.063 |
| Ishar 3 | 136 | 1.058 | 9.140 | 2.636 |
| Crystals of Arborea | 36 | 1.015 | 2.184 | 1.302 |

A ratio that is *always* >= 1.0 (never once inverted, across ~400 files of
widely varying content) is strong evidence the field really is a
decompressed-size declaration, not a coincidence — see this project's
verification-bar convention (Method §4). It does **not** yet prove the size
is *exactly* right (only that it's plausible), and it says nothing about
the algorithm.

### 2.2 The "stored" class (`classByte == 0x01`) — CONFIRMED, no compression

6 files in Crystals of Arborea (`CARTE.CO`, `DEBUTER.CO`, `EBRAIN.CO`,
`EMOVE.CO`, and 2 more — see the inventory JSON) have `classByte == 0x01`
and `decompressedSize == fileSize` **exactly** (ratio 1.000, not
approximately), for every one of them. This is the strongest kind of
confirmation available without disassembly: an exact-equality invariant
holding 6/6 times. No Ishar 1/2/3 file uses this class in the sampled
corpus — every Ishar `.DO` file is compressed (either `0x81` or `0xA1`).

`CARTE.CO` being stored/uncompressed is what made it directly readable
without cracking the codec — see `docs/crystalsofarborea/amiga/data-structure.md`
§3 for what that revealed about the overworld representation.

### 2.3 Two compressed sub-classes: `0xA1` (Ishar-only) vs `0x81` (both engines)

| classByte | Ishar 1 | Ishar 2 | Ishar 3 | Crystals |
|---|---|---|---|---|
| `0xA1` | 97/98 | 136/137 | 136/136 | 0 |
| `0x81` | 1/98 (`MAIN.DO`) | 1/137 (`MAIN.DO`) | 0 | 36/42 |
| `0x01` (stored) | 0 | 0 | 0 | 6/42 |

`0xA1`-class files share the identical 10-byte codec table
`00 01 0B 09 0A 0B 07 05 06 07` at offset 4-13 across **all three** Ishar
titles — direct evidence the same codec/engine carried forward Ishar 1
through 3 unchanged in this respect. `0x81`-class files (Ishar's `MAIN.DO`
+ all of Crystals' compressed `.CO` files) instead share a *different*
10-byte window (e.g. `00 01 03 00 XX 16 82 00 01 16` in Crystals, where
`XX` is a per-file varying byte — not fully constant the way the `0xA1`
table is). This is consistent with `0x81` being an older or simpler
compression variant that Crystals (1990, the prequel) used throughout, and
that Ishar 1/2 kept around only for `MAIN.DO` specifically (see §4) while
switching everything else to the newer `0xA1` scheme; Ishar 3 appears to
have dropped `0x81` entirely (its own `MAIN.DO` is `0xA1`-class in the
sampled corpus).

**Open, not yet explained**: `MAIN.DO`'s `0x81` files have a compression
ratio very close to 1.0 (1.019 in Ishar 1) and — unlike every `0xA1` file
sampled — leak long, readable ASCII fragments under a plain `strings` pass
(see §4). Real compressed pixel data (`0xA1` files, e.g. `MAP.DO`,
`FORET.DO`) shows **zero** readable fragments and body entropy of
7.7-7.9 bits/byte (near the 8-bit maximum), consistent with genuine
LZ+entropy-style compression. This asymmetry (text-bearing files barely
"compress" and stay legible; pixel files compress well and look fully
random) is itself suggestive that the underlying codec is LZ77-family
(literal runs pass through unmodified for spans with no long-distance
repeats — exactly what French dialogue/filename text would produce) rather
than a whole-file entropy coder, but this is a **hypothesis**, not
confirmed by code.

### 2.4 The header-extension question — RESOLVED

§2.4 as originally written flagged bytes 17-22 as unexplained near-constant
padding beyond the (then-hypothesized) 16-byte header. This is now fully
explained by §2.5: those bytes are the tail of the 8-byte LZ77 dictionary
(offset 6-13 in the corrected layout) plus the *first few real bitstream
bytes* of the compressed payload — the apparent near-constancy across files
was the dictionary (which is genuinely near-constant corpus-wide, see §2.3's
`00 01 0B 09 0A 0B 07 05 06 07` table) bleeding into what looked like
"offset 17-20" under the old, slightly-misaligned byte-counting scheme. No
further header bytes exist past the dictionary; payload starts immediately
after it (or immediately after `isMain` for the RLE codecs, which carry no
dictionary at all).

### 2.5 The compression algorithms — CONFIRMED, ported, corpus-verified

Cracked via a genuine open-source reference implementation found by
`WebSearch`, not derived from scratch: **`github.com/maestun/silm-depack`**
(MIT-licensed, dedicated depacker for this exact Silmarils "ALIS" engine
family; a fuller engine reimplementation also exists at
`github.com/maestun/alis`). Ported faithfully to TypeScript in
`tools/shared/silmarils-unpack.ts`, preserving the reference's exact
`s8`/`s16`/`u32` truncation semantics (see the C-to-TS integer-fidelity
caveat in this project's own pitfalls library,
`byte-exact-adpcm-needs-exact-integer-sequence.md`, which applies here too).

Independently, the `amiga-disasm` agent traced the live decompression
routine in `T.X` this session and confirmed the same qualitative shape
(bit-reader + escape-coded match lengths + short/long match dispatch) —
its register-level trace doesn't map instruction-for-instruction onto
`silm-depack`'s C variable names (different code shape, same algorithm
family), but it independently corroborates that `T.X` really does run an
LZ77-style bitstream decompressor with the class-byte dispatch (bit 7 of
byte 0: clear = raw copy) already inferred structurally.

**Two codecs, dispatched by the magic's top byte:**

- **`0x81` (old, non-interlaced) / `0x80` (old, interlaced)** — classic
  PackBits-style RLE. A control byte with bit 7 clear starts a literal run
  of `byte & 0x7F` bytes copied verbatim from the packed stream; bit 7 set
  starts a run-length run of `byte & 0x7F` repeats of the next packed byte.
  `0x80` additionally de-interleaves output across 8 passes at stride 8
  (never observed in this corpus — every sampled interlaced-capable file
  used `0x81`).
- **`0xA1` (new)** — a real LZ77 bitstream: a rotating 32-bit shift register
  refilled 16 bits at a time from the packed stream, decoding either
  literal-byte runs or self-referencing back-copies (negative-offset
  `write_neg`), with match distance/length driven by the 8-byte per-index
  bit-width dictionary and an Elias-gamma-like escape-coded length
  continuation.

**Verification — two independent oracles, both passing decisively:**

1. **Corpus-wide packed-byte-consumption self-consistency** (Method §4's
   boundary-agnostic forward-walk style: does the decoder consume its input
   to (near-)exactly its declared end, with zero catastrophic
   failures/infinite loops, across the whole sample):
   - `0xA1` codec, 97 non-MAIN Ishar 1 files: **83/97 exact**, remaining 14
     off by only 2-4 bytes (1-2 leftover refill-words — explained precisely
     by the reference's own refill-then-check loop order).
   - `0x81` codec, Ishar 1's `MAIN.DO` + all 36 of Crystals' `0x81`-class
     `.CO` files: **every single file** shows `packedConsumed ==
     packedTotal + 1`, exactly — a perfectly uniform off-by-1 explained by
     the reference C source's `do{...}while(--cnt>0)` loop always advancing
     the packed-byte pointer one extra time even on the final,
     non-interlaced pass.
2. **Decoded content is genuinely readable** (the strongest oracle
   available, Method §4): `MANUEL.CO` (Crystals) decodes to a clean English
   manual table of contents ("INSTRUCTIONS", "THE HISTORY OF THE CRYSTAL
   WORLD", "SELECTING A TEAM", "CHARACTER RECORDS", "THE MAIN ICON SCREEN",
   "THE MAP", "3D MODE", "COMBAT", "KEYBOARD AND JOYSTICK CONTROLS"), and
   `MESSAGE2.CO` decodes to real NPC dialogue ("YOUR MAGICIAN IS ABSENT",
   "I CANNOT TRUST YOU", "WELCOME,PRINCE OF THE ELVES,...").

**Full-corpus batch run** (`decompressDir()` in
`tools/shared/ishar-decompress.ts`, per-title CLI wrappers
`tools/<game>/<platform>/decompress.ts`, `npm run <game>:decompress`):
every `.DO`/`.CO` file in all four titles decoded without exception —
`ishar/amigaaga` 98/98, `ishar2/amigaaga` 137/137, `ishar3/amigaaga`
136/136, `crystalsofarborea/amiga` 42/42. Output: raw decompressed bytes to
`build/cache/<game>/<platform>/decompressed/*.bin` (gitignored
intermediate), a verification report and extracted printable-text runs to
`public/assets/<game>/<platform>/data/{decompression-report,text-strings}.json`.

## 3. `MAIN.DO`/`MAIN.CO` — the master resource manifest

CONFIRMED (via `strings` on the raw compressed bytes — readable because of
the `0x81` codec's apparent literal-passthrough behavior, §2.3): `MAIN.DO`
(Ishar 1) and `MAIN.CO` (Crystals) both contain a long list of
lowercase resource filenames with a **`.AO` extension** (not `.DO`/`.CO`) —
e.g. `logo.AO`, `presen.AO`, `preson.AO`, `mcave.AO`, `foret.AO`,
`buste.AO`, `main.io`, `foret.io`. These match the on-disk `.DO`/`.CO`
filenames one-to-one modulo extension and case (`LOGO.DO` <-> `logo.AO`,
`PRESEN.DO` <-> `presen.AO`, `DIAM.CO` <-> `diam.AO`, `BOARBO.CO` <->
`boarbo.AO`, `LAFIN.CO` <-> `lafin.AO`, etc.) — confirming `MAIN.DO`/
`MAIN.CO` is the game's own **resource directory/load table**, not a
graphics or map file itself, despite sharing the same 16-byte container
header as everything else.

`.AO` is very likely a cross-platform-authoring leftover (Silmarils shipped
this engine on Amiga, Atari ST and DOS from a shared toolchain) rather than
a real extension used at runtime on Amiga — no `.AO` files exist on disk in
any of the four sampled directories. The separate `.io`-suffixed names seen
alongside (`main.io`, `foret.io`) are a second, distinct reference kind
whose role is not yet identified (possibly a script/event resource
paired with the `.AO`-suffixed graphics resource of the same base name).

Many filenames repeat multiple times within the same `MAIN.DO` (e.g.
`loup.AO` — "wolf" — appears at least 3 times, `orc.AO` at least 3 times,
`stel.AO`/`barbare.AO`/`dealer.AO` similarly) — consistent with a
**per-scene resource list** structure (each game screen/encounter
referencing its own small set of resources, so common monster sprites
recur across many scenes) rather than one flat deduplicated directory.
This is a plausible read of the *evidence available* (repeated names,
readable via `strings` only, no binary structure decoded) — **not yet a
confirmed record layout**.

**CONFIRMED this session**: every `.AO`-suffixed base name enumerated in
`MAIN.DO` has a same-named `.DO` file actually present in
`data/ishar/amigaaga/` (checked exhaustively: `village`, `ville`,
`rampart`, `temple`, `plaine`, `foret`, `fond`, `arbre`, `orc`, `bormin`,
`loup`, `wardog`, and every other base name tried resolves). No `.AO`,
`.CO`, `.IO`, or `.FO` file exists anywhere in this data dump — the
directory holds only `.DO` (98), `.FIC` (8), and a handful of
non-resource files (§5). This means the **"amigaaga" release collapsed
the original per-location 5-extension family** (`.io`/`.co`/`.fo`/`.do`/
`.ao` — visible only as *references*, e.g. in `SOS.DO`'s
`foret.io`/`foret.co`/`foret.fo`/`foret.do`/`foret.ao` prompt-script
sequence) **into a single `.DO` file per base name**, with content type
(script vs. graphics vs. scene-layout vs. sound-index) now identified
purely by the container header (§2.5's `packerKind`/`isMain`), not by
filename extension. Concretely: `ORC.DO` is very likely the orc monster
*graphic* (not a script), `VILLAGE.DO`/`TEMPLE.DO`/`RAMPART.DO` the
outdoor location *background graphics* — see
`docs/ishar/amigaaga/data-structure.md` §5 for the header-shape evidence
supporting this.

Ishar 2 and Ishar 3's own `MAIN.DO` do **not**
show the same readable-string behavior (`strings` on them returns almost
nothing filename-shaped) — either their compression differs enough to
obscure the same content, or their manifest is structured differently.
Open; see `docs/ishar/TODO.md`.

## 4. `blanc.snd` — confirmed identical across all four titles

`data/<game>/<platform-or-amiga>/blanc.snd` is **byte-identical** (same
MD5, `70249099bb14f1acc700ac3001b2302c`) in Ishar 1, Ishar 2, Ishar 3, and
Crystals of Arborea. ("blanc" = French "blank/white".) This is a shared
placeholder/silent sound sample carried forward across the whole engine
family, not per-title content — confirmed, not a coincidence of naming.

## 5. Non-resource files (not part of the container format)

A handful of files per title are not `.DO`/`.CO` container resources at
all — flagged by the inventory scanner's `note` field rather than
misdecoded as garbage headers:

- **`T.X`/`START`** — the game executables (§1).
- **`.FIC` files** — smaller, mostly-zero-with-some-nonzero-bytes files
  (e.g. `CONT1.FIC`-`CONT6.FIC`, 4,860-10,800 B, high zero-fraction but not
  fully zero; `TAB1.FIC`, 361 B, a tight `{1,2,3,4}`-valued byte array).
  Structurally distinct from the `.DO`/`.CO` header shape entirely (no
  `0xA1`/`0x81`/`0x01` magic). Not decoded this pass — lower priority per
  the task brief; see `docs/ishar/TODO.md`.
- **`DEFAULT.DAT`/`S2.DAT`** (Crystals) — 1,228 B each, differ by exactly 1
  byte (offset 15). Almost certainly save-game/party-state templates, not
  shipped content assets (see the `save-file-not-asset.md` pitfall) — not
  pursued further.
- **`system-configuration`** (Ishar 2) — a hardware/timing config blob
  containing the ASCII string `"generic"` at offset 0x80; looks like an
  Amiga chipset/CPU-speed detection cache, not game content. Not pursued.
- **`OBJETS.CO`** (Crystals) — **correction**: an earlier pass misidentified
  this as a raw Targa image via the `file` command. It is **not** — its
  first 16 bytes parse as a completely normal `0x81`-class compressed
  container header (`81 00 1b 16 00 01 03 00 3b 16 82 00 01 16 8a 00`),
  identical in shape to every other Crystals `.CO` resource. `file`'s Targa
  heuristic is notoriously loose and matched some bytes inside the
  compressed stream by coincidence. Treat it as an ordinary compressed
  resource (very likely the item/object icon bank, given the name — "objet"
  = French "object/item") pending decompression, not as a real image file.

## 6. A single shared "scene/resource header" beneath the payload — STRUCTURAL, cross-title

The single most important structural finding of this session, and the
strongest lead on the task's central "overworld vs. dungeon-view mechanism"
question. **After** the confirmed §2.5 container header (magic + isMain +
dictionary) is stripped, the decompressed *payload* of every location-scene
resource examined — Ishar 1's overworld `MAP.DO` and every `*CAVE*.DO`
(`MCAVE`, `PCAVE`, `FCAVE`, `FCAVE2`, `SCAVE`, `COLCAVE`, `INCAVE`), **and**
Ishar 2's dungeon files (`DJ1`, `DJ2`, `DJCAT`, `DJCOL`, `DJDEC`, `DJTRAP`,
`FDJ1`, `FDJCAT`), **and** several of Ishar 1's outdoor-location/monster
graphics (`ORC`, `VILLAGE`, `TEMPLE`, `RAMPART`, `WARDOG`) — opens with the
**identical 16-byte shape**:

```
00 XX 1c 00 00 16 00 00 00 00 00 00 00 YY 00 00
```

where `XX` varies per file (looks like a sequential resource-index/ID —
Ishar 2's dungeon-file cluster takes consecutive values 0x5b-0x5f and
0x6a-0x6c, exactly matching their apparent catalog order) and `YY` is
either `0x16` (graphics + Ishar-1 cave files) or `0x00` (Ishar-2 dungeon
files + some Ishar-1 files, e.g. `FOND`/`FCAVE`). Bytes at offset 2 (`0x1c`)
and offset 5 (`0x16`) are constant in **every single file checked across
both titles**. Immediately after, a further shared shape holds at offsets
16-24: two big-endian `u16` fields flanking a constant `00 20` word (`YY YY
00 20 00 ZZ 00 20 ..`), where `ZZ` at offset 21 (0x0a for graphics/Ishar-1
cave files, 0x47 for Ishar-2 dungeon files, 0x1e for a third subgroup) looks
like a content-subtype discriminator.

**Read**: this is evidence for **one generic "scene/resource descriptor"
record format used uniformly across the whole engine**, not a dedicated
tile-grid format for the overworld and a separate wall-compositor format
for first-person dungeon views. The two content classes (Ishar 1's
open-air `MAP.DO`/cave files and Ishar 2's explicit `DJ*` dungeon files)
sharing byte-for-byte identical header shape **across different games**
argues the renderer dispatches on something *outside* this header (a type
tag carried in the calling script/manifest context, most likely inside
`MAIN.DO`'s own bytecode) rather than the resource self-declaring "I am a
tile grid" vs. "I am a first-person corridor." This directly bears on the
brief's dungeon-view question: it argues against a simple fixed per-depth
wall-tile array (which would need no such generic per-scene header) and
toward a **vector/placement-list scene format** — a sequence of small
records placing pre-rendered graphic pieces at given positions, which the
renderer composites differently depending on view mode. Spot evidence for
this shape inside `MCAVE.DO`'s payload: the 2-byte pair `14 44` (and
several other short byte-pairs) recurs many times at irregular spacing,
consistent with repeated placement records referencing the same few
graphic-tile dimensions (e.g. a standard wall-panel size) rather than a
raster tilemap (which would show one dominant repeated *single* byte, as
`MAP.DO` does: byte `0x88` alone is 21% of its whole payload, matching what
an actual tile-index raster with a dominant terrain type would look like —
that specific pattern in `MAP.DO`, distinct from the caves' more
tuple-structured content, is itself a hint that the *overworld* payload may
carry a real tile-index array in one region and a placement-record list in
another).

**Confidence: STRUCTURAL** (cross-game byte-position agreement across 15+
files, an unusually strong signal for this project's own conventions) but
**not CONFIRMED** — no disassembly trace targeted the renderer/compositor
routine itself this session, and no field in this header has a proven
semantic name yet (only offset positions and constancy/variability
patterns). This is the natural next target for a follow-up pass or a
`re-codebreaker` escalation if static analysis stalls: trace `T.X`'s (or
Ishar 2's `T.X`'s) call site that reads a `DJ*.DO`/`*CAVE.DO` buffer after
decompression, to pin down what offset 21's subtype byte actually selects.

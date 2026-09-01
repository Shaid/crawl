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

> **Correction (2026-08-30, user confirmation — the user has actually played
> these games): the outdoor overworld is first-person too, not a separate
> mode.** All three Ishar titles are "completely first-person crawlers,
> except you spend a lot of time outdoors exploring islands and so on,
> still in first-person" — there is no alternating top-down/node-graph
> overworld screen the player navigates *instead of* the 3-D view; outdoor
> exploration (forests, coastlines, islands) uses the *same* first-person
> renderer as caves and dungeons. This substantially **strengthens** the
> "one generic scene/resource descriptor used engine-wide" reading above,
> rather than complicating it — `MAP.DO` and the cave/dungeon files sharing
> an identical header shape is exactly what you'd expect if they're all
> fed to the *same* first-person compositor, not evidence of a coincidental
> format reuse across two different UI modes. It also reframes §4/TODO's
> "THE MAP" vs. "3D MODE" manual-table-of-contents finding below: those are
> most likely **an auxiliary top-down reference/overview map (a callable
> overlay, the way EOB/Wizardry/Black Crypt-style blobbers in this same
> repo's corpus have one) and the primary always-active first-person
> renderer**, not two alternate ways of playing the game. The
> `ishar-overworld-representation` open item's node-graph-vs-tile-grid
> framing should be read as "what does the auxiliary map screen look like",
> not "what does the player navigate through" — the player is always in the
> first-person view, indoors and outdoors alike. See
> `docs/ishar/TODO.md`'s updated `ishar-overworld-representation` and
> `ishar-firstperson-view-mechanism` rows.

**Confidence: STRUCTURAL** (cross-game byte-position agreement across 15+
files, an unusually strong signal for this project's own conventions) but
**not CONFIRMED** — no disassembly trace targeted the renderer/compositor
routine itself this session, and no field in this header has a proven
semantic name yet (only offset positions and constancy/variability
patterns). This is the natural next target for a follow-up pass or a
`re-oracle` escalation if static analysis stalls: trace `T.X`'s (or
Ishar 2's `T.X`'s) call site that reads a `DJ*.DO`/`*CAVE.DO` buffer after
decompression, to pin down what offset 21's subtype byte actually selects.

> **Update (fourth pass): the pixel/sprite format is now CONFIRMED**, and the
> renderer architecture question above has a real, source-grounded (though
> still not fully pinned to specific on-disk bytes) answer — see §7 and §8.

## 7. Sprite/image pixel format — CONFIRMED

Solved and moved to its own doc: `docs/ishar-sprite-format.md`. Summary: a
per-script resource directory (`adresdes()`'s 2-level self-relative
indirection, ported from `github.com/maestun/alis`) resolves numbered
"bitmap header" records, each a small typed struct (6 pixel-encoding types
confirmed: raw/banked 4-bit and direct 8-bit, each masked or opaque).
Applied blind to real corpus bytes and confirmed via genuinely recognizable
rendered art across all four titles (barbarian warriors, a dragon, a tree,
an orc-like monster, a skeleton) — 1,608/2,244/2,744/905 sprites decoded for
Ishar 1/2/3/Crystals respectively. Real AGA colour palette resolution
remains open (VM-bytecode-selected, not statically located this pass — see
that doc's §5).

This closes the `ishar-png-render` TODO item and directly answers the task
brief's Priority 1.

## 8. First-person rendering mechanism — architecture identified (STRUCTURAL), exact on-disk geometry still open

> **Correction (2026-09-01, `re-oracle` escalation): §8's central claim is
> WRONG for Ishar — the heightfield/voxel raycaster is version-gated OFF
> for every title in this corpus.** `render3d.c`'s entry point `openland()`
> is called from exactly one place in the whole reference implementation:
> `copensc` (opcode 0x4e, `opcodes.c:1401-1417`), inside
> `if (alis.platform.version >= 31)`. The per-game ALIS version table
> (`script.c:180-400`, set from the main script's own header fields) says:
> Crystals of Arborea = **20**, Ishar 1 = **20**, Ishar 2 = **21**,
> Transarctica = 22, **Ishar 3 = 30**, Robinson's Requiem = **31**. Only
> Robinson's Requiem reaches `openland()`/`iniland()`/the whole `render3d*`
> family — Ishar 1/2/3 and Crystals **never execute one line of it**. The
> raycaster architecture described below is Robinson's Requiem's, present
> in the shared reference codebase but dead code for this corpus. This also
> dissolves §8.1's "gap in the oracle": `cdefmap`/`cwalkmap`/etc. being
> unimplemented for Ishar is not a gap — Ishar's scripts never issue those
> opcodes (which is exactly why `alis` is "Playable" for Ishar without
> them). Ishar's first-person view is instead built from the **generic VM
> sprite/scene system** (the §7 sprite format, composite records, and
> per-location scripts' bytecode) — scaled/laid-out 2-D sprite compositing
> driven by script logic, not any terrain raycast. The real on-disk world
> geometry is the `.FIC` region-grid system, now solved — see §9.

`alis`'s own `render3d.c`/`render3d_68k.c` contain a real, working
implementation of Ishar/Crystals' first-person view: a **heightfield/voxel-
column terrain raycaster** (Comanche-style column-span rendering, not a
discrete per-depth wall-tile compositor and not a generic vector/placement-
list format) — functions `openland`/`iniland`/`altiland`/`inilens`/
`calctoy`/`spritland`/`landtopix`/`barland`/`tbarland` (and their 68k-
specific counterparts `calclan0_68k`/`doland_68k`/`landtofi_68k`). Camera
position, pitch, yaw, and FOV live in a "screen" struct (`screen.c`'s
`eScreenVars` enum — e.g. `EScreenWidth=0x12`, `EScreenHeight=0x14`), gated
by a `numelem` bit-2 flag (`EScreenNumElem & 0x2`) that selects the
raycaster path.

**This is a real, qualitative answer to the brief's Priority 2 question**:
the engine is NOT compositing fixed wall tiles per depth cell (the Gold
Box/Black Crypt convention elsewhere in this project's corpus), and it's
more specific than "a generic vector/placement-list format" — it's
specifically a terrain-height raycaster, which explains why outdoor
(rolling landscape) and indoor (caves/dungeons, presumably modeled as
enclosed height regions) content can share one rendering pipeline, matching
the user's confirmation that both are first-person (§6 correction above).

**What is NOT yet confirmed**: the exact on-disk location of any specific
location's terrain height grid. An earlier attempt this session tried
reading `xread16` at decompressed-file-offset 18 across the whole corpus
(226/235 files reading exactly `0x0020`=32, tempting a "grid_width=33
always" claim) — **this numeric claim is explicitly WITHDRAWN as
unconfirmed**, not because the byte pattern isn't real (it is, reproducibly),
but because the field-offset semantics it was interpreted under
(`eScreenVars`) apply to `scene_addr = alis.basemain + scridx`, where
`alis.basemain = alis.main->vram_org` is **MAIN's own script data**, not
each individual `.DO` file's own raw decompressed bytes. Applying MAIN's
internal "screen table" field offsets to a different file's own byte-0 base
is exactly the kind of category error this project's pitfalls library warns
about (see `indexed-operand-needs-base-provenance.md` in the game-re
lessons library). The `0x0020` pattern may still be meaningful (worth
re-deriving once MAIN's own internal screen-table records are located), but
it is HYPOTHESIS, not CONFIRMED, pending either:

1. locating MAIN.DO's own internal screen-table records (the same
   `adresdes()`-directory-decode technique applied to MAIN's own resource
   directory, analogous to §7's sprite work but for screen/scene records
   instead of bitmaps — not attempted this session), or
2. a real disassembly/bytecode trace of the `calloctab` opcode (`0xe9` in
   `opcodes.c`) allocation calls that populate a screen's terrain grid at
   runtime.

Priority 3 (MAP.DO walkable grid geometry) and Priority 4 (a
`tools/walker/games-ishar.ts` `GameView`) were **not attempted** this
session: building a walker on this unconfirmed geometry would risk shipping
a plausible-but-wrong "confirmed" walkable-maze claim, which this project's
verification bar explicitly warns against. See `docs/ishar/TODO.md`.

### 8.1 Fifth pass — the terrain-anchor mechanism traced to a bytecode wall; escalated to `re-oracle`

Pushed on two concrete leads to locate real per-location terrain data:
applying the sprite-directory decode technique to `MAIN.DO`'s own internal
scene-table records, and tracing the `calloctab` (0xe9) opcode. Found the
real mechanism, but it terminates at a genuine gap in the reference oracle:

- **`copensc`** (opcode 0x4e, `opcodes.c:1401-1417`) reads its scene-id
  (`scridx`) as a **literal 16-bit bytecode immediate** baked into the
  calling script's own compiled bytecode — not a discoverable static data
  pattern. This means the "screen object" struct's *instances* are not
  laid out at fixed, guessable offsets in `MAIN.DO`'s decompressed bytes at
  all — a static byte-pattern scan for plausible struct shapes (gate byte +
  width/height sanity + frustum-field sanity, run corpus-wide across all
  four titles' `MAIN.bin`) came back with only 1-8 weak, mutually
  non-independent hits per title out of ~13,000-15,000 candidate offsets —
  a real negative, not under-effort (adjacent "hits" 2-4 bytes apart shared
  permuted field values, the signature of a sliding window re-reading the
  same bytes, not distinct real records).
- **`cdefmap`** (opcode 0xe3, `opcodes.c:4658-4783`) is the actual writer of
  `scene_addr+0x40`/`+0x42` (the fields `render_context` is built from,
  §8's `render_context = ... + xread32(alis.atent + xread16(scene_addr+0x40))`):
  it reads a self-relative offset as a bytecode literal from the
  **terrain-owning script's own bytecode** (not `MAIN.DO`'s), derives a
  "mapram" anchor, and reads/writes several `mapram`-relative fields
  including raw dimension bytes stored immediately before the anchor. This
  is a strong, concrete, plausible mechanism for how a real terrain grid
  would be discoverable — **but `opcodes.c`'s own dispatch table marks
  opcode 0xe3 (and 0xe4/0xe5/0xe8/0xf7/0xf8/0xfd) as defaulting to a no-op
  stub (`map_cnul`) for every game except Transarctica and Robinson's
  Requiem** — two sibling Silmarils titles NOT in this project's corpus.
  Ishar 1/2/3 and Crystals of Arborea all fall through to `cdefmap`'s own
  `else { ALIS_DEBUG(EDebugWarning, "MISSING: %s", ...); }` branch
  (`opcodes.c:4779-4782`). **The reference oracle's own authors have not
  reverse-engineered how Ishar populates its terrain-scene fields.**

This is a genuine gap in the ground-truth oracle, not a search failure —
escalated to `re-oracle` (per this session's process update: escalate
directly to `re-oracle`, skipping `re-codebreaker`) with a full
self-contained brief covering all of the above plus the exact `render3d.c`
field-offset evidence from §8. Result pending; see
`docs/ishar/TODO.md`'s `ishar-firstperson-view-mechanism` row for status.

> **Correction (2026-09-01, the `re-oracle` result): the escalation
> succeeded by refuting the premise rather than crossing the wall.** The
> "oracle gap" framing above was itself the error: `cdefmap` (0xe3) and its
> siblings are Robinson's-Requiem-only opcodes, and Ishar (versions 20/21/
> 30, all `< 31`) never calls them and never reaches `render3d.c` at all —
> see the §8 correction block. One-line diagnosis of why the prior passes
> walled: **all of them assumed the reference's `render3d.c` was Ishar's
> renderer without checking the call site's version gate** (`opcodes.c:1409`
> `if (alis.platform.version >= 31)`), so every search was for a data
> structure (a heightfield anchored via `+0x40`/`+0x42`) that Ishar's data
> genuinely does not contain. No ALIS bytecode disassembler was needed to
> break the wall (though §9 shows a minimal hand-decode of a few opcode
> streams, which proved cheap and decisive once aimed at the right target).

### 8.2 Implementation pass (2026-09-01) — ONE location script executed end-to-end, real first-person frames produced

Following §8/§8.1's finding that each location script's own compiled ALIS
bytecode IS the first-person renderer, this pass built the minimum tooling
to actually execute one and render a frame, and wired it into
`tools/walker/games-ishar.ts` behind a toggle. Honest scope: this is **one
script pair, one region, Ishar 1 only** — see the "Not generalized" list
below.

**New tooling** (all `tools/shared/`):

- `alis-disasm.ts` — a structured ALIS bytecode disassembler (CFG worklist,
  mirroring `goldbox-ecl.ts`'s pattern). Decodes the full OPERNAMES/
  STORENAMES/ADDNAMES token space and ~150 opcodes from `opcodes.c`.
  **CONFIRMED**: disassembling `FORET.bin` reproduces a prior session's
  hand-verified reference disassembly (`foret.dis`, from the `re-oracle`
  escalation) **256/256 instructions, 0 diffs, 0 missing**.
- `alis-interp.ts` — a SCOPED interpreter (not general-purpose — control
  flow, EVAL-step arithmetic/comparison, `cswitch1`/`cswitch2` dispatch, and
  the three placement opcodes `cput`/`cputnat`/`cxputat` only; every other
  opcode is an explicit no-op) that actually *executes* a script's
  per-frame placement logic against real inputs (region-grid cells, party
  globals) via a small `SceneEnv` callback interface. Also ports
  `putin()`'s composite-sprite-record recursion (`resolveIsharComposite()`):
  a bitmap-header type byte `> 0x80` (except `0xfe` = palette install)
  means `count = byte[1]` followed by `count` × 8-byte
  `[elem:u16 BE (bit15 = horizontal-mirror), dx:s16, dy:s16, dz:s16]`
  records, resolved recursively.
- `ishar-firstperson.ts` — orchestration: builds a `SceneEnv` over Ishar 1's
  confirmed globals, runs `FOND.bin` (backdrop) then `FORET.bin` (forest)
  through the interpreter, resolves every placement's `idx` through the
  script's own resource directory (`ishar-sprites.ts`, already CONFIRMED),
  sorts far-to-near, and composites a flat RGBA frame.
- `ishar-script-export.ts` + `tools/ishar/amigaaga/scripts.ts` — ships
  `FORET.bin`/`FOND.bin`'s DECOMPRESSED bytes as
  `public/assets/ishar/amigaaga/scripts/{foret,fond}.bin`, so the browser
  walker can `fetch()` already-decoded bytes rather than run
  `silmarils-unpack.ts` client-side (that module uses Node's `Buffer`
  internally, unpolyfilled in this project's `vite.config.ts`). **Not**
  wired into `package.json` (out of scope this session) — run directly via
  `npx tsx tools/ishar/amigaaga/scripts.ts`. Verified byte-identical to the
  already-decompressed `build/cache/ishar/amigaaga/decompressed/*.bin`
  copies produced by the existing `ishar:decompress` step.

**Findings that corrected/refined the original `re-oracle` brief**, each
found by diffing against `foret.dis` or by numeric sanity-checking the
interpreter's output:

1. **`cswitch1`/`cswitch2` jump-table entries decode with the target
   computed as `here + 2 + rel`, not `here + rel`** (`here` = the address
   *after* reading the 16-bit relative field). Missing the `+2` shifted
   every dispatch target by exactly 2 bytes low.
2. **A cswitch's own "no-match" fallthrough address must be captured AFTER
   decoding the whole entry table, not before.** Capturing it first points
   into the middle of the raw jump-table bytes (interpreted as bogus
   opcodes downstream) rather than past the table's end.
3. **The raw party-facing byte at `basemain+0x137e` is `compassIndex + 1`,
   not `compassIndex` directly** — `FORET.bin`'s own `cswitch2` dispatch
   uses `index = value + base` with `base = -1`, so `value=0` (a naive
   "north=0" encoding) resolves to `index=-1` (out of range, silently no
   match) while `value=1` correctly lands on slot 0. Empirically derived
   by noticing `facing=0` produced zero placements.
4. **`oimmb`/`oimmw` operand tokens hold SIGNED literal values (sign-extend
   on decode); structurally identical-shaped tokens for other opnames
   (`odirb`, `omainb`, etc.) are UNSIGNED address/offset operands and must
   NOT be sign-extended.** Missing this made a `-1` loop-decrement literal
   read as `+255`, breaking the ring/lateral clamp loop's termination
   (interpreter hit its step budget with zero placements). Fixing it also
   retroactively corrected the per-ring elevation constants: the real
   values are `-34, -23, -14, -8, -4, -1` for rings 1-6 (monotonically
   converging toward the horizon with distance), not large positive values
   as an unsigned reading would suggest.
5. **Ishar 1's game-screen (`cscreen 0x000e`) field offsets, re-derived
   directly from `MAIN.bin`'s own `cdefsc` bytecode**: `xCenter=127`,
   `horizonY=86`, `width=255`, `height=125` at config-block offsets
   `+4:6`/`+6:8`/`+0xc:0xe`/`+0xe:0x10` respectively. This corrects the
   originating `re-oracle` brief's cited offsets (`+0xa`/`+0xc`/`+0x12`/
   `+0x14`), which were off by a constant 5 against the same 32-byte
   block — the VALUES the brief cited (127/86/255/125) were already
   correct, only the byte positions were wrong.
6. **A real visualization bug, not a decode bug, in the already-shipped
   `isharBitmapToGreyscaleRGBA()`** (`ishar-sprites.ts`): its fixed
   0-255 grey scale silently renders any bitmap whose real palette-index
   range sits in a narrow `palOffset`-shifted band (common for `palOffset`
   above ~40) as a near-flat block. Confirmed via a raw index histogram on two
   `FOND.bin` sprites: 9 distinct values, well-distributed, rendered
   visually flat by the fixed-scale function. Added
   `isharBitmapToNormalizedGreyscaleRGBA()` (per-bitmap min-max stretch)
   and used it in the first-person renderer; the existing sprite-atlas
   pipeline (`ishar-sprite-atlas.ts`) still uses the fixed-scale function
   unchanged (a corpus-wide re-check with the normalized version is a
   plausible, undone follow-up — see `docs/ishar/TODO.md`).

**Verification (this session)**:

- Disassembly: 256/256 instruction match against `foret.dis` (see above).
- Numeric sanity: for a real `CONT1` position/facing, the interpreter
  produces 9-21 placements (varies by pose) with depth values matching
  `ring * 99` for rings 3-6, elevation matching the corrected per-ring
  table, and LOD sprite indices matching the confirmed `baseSlot + (ring-1)`
  convention — all non-degenerate, in-range values.
- Behavioral: placement count varies across 4 different party
  positions/facings (21/12/16/19), and between two positions at the same
  facing but different depth (15 far vs. 19 near, with the near render's
  foreground silhouette visibly taller/more prominent) — a real, position-
  and-facing-responsive render, not a static image.
- Visual (via `Read`, greyscale, no palette): frames show a coherent
  three-band composition — flat placeholder sky, a textured backdrop layer
  (real decoded `FOND.bin` content, once the greyscale bug above was fixed)
  sitting at the horizon, and a dense foliage/tree-line texture band along
  a flat placeholder ground colour. This reads as an **abstract, stylized
  outdoor scene** (recognizable sky/ground/foliage-texture bands that
  respond correctly to movement) rather than crisp, individually-legible
  tree sprites — an honest characterization, not "confirmed photorealistic
  trees." The backdrop layer's real anchor/tiling convention against a real
  screenshot is UNVERIFIED (see below).

**RENDERED / HYPOTHESIS, not CONFIRMED**:

- The placeholder sky (flat blue) / ground (flat green) fill colours — no
  real AGA palette has been recovered for this engine (see `ishar-sprite-
  format.md`'s open item); these are arbitrary, clearly-labelled-as-such
  placeholder colours chosen for visual legibility during verification.
- The sprite anchor convention (`pixelX` = sprite horizontal centre,
  `pixelY` = sprite BASE/bottom edge — "billboard standing on the ground").
  Plausible and used consistently, but never checked against a real
  screenshot or emulator capture.
- `FOND.bin`'s real tiling/parallax/anchor behaviour. Its composite
  placements resolve to large panels (up to 96x85px against a 255x125px
  screen) anchored at the horizon extending upward — visually plausible as
  "cloud/hill silhouette above the treeline" but not confirmed; two panels
  don't tile to cover the full screen width, leaving flat sky visible at
  the frame edges (may be correct — genuinely open sky in those
  directions — or may indicate a missing tiling/repeat rule).

**NOT generalized this session** (deliberately, per the task's "don't force
false generality" instruction):

> **Correction (2026-09-01/02 follow-up pass, §8.3)**: `VILLAGE.bin` is now
> RENDERED end-to-end (its `cswitch2` cell-value-to-building-style mapping
> resolved and verified against a real `CONT1.FIC` compound cluster) and
> `TEMPLE.bin` was executed against real data with an inconclusive result
> (small/invisible placements, not a confirmed render) — see §8.3 for the
> full account. `RAMPART.bin`/`PLAINE.bin` were disassembled (clean, same
> shell shape) but still not traced/tested end-to-end. The two bullets below
> remain accurate as written.

- `ORC.bin` (monster placement) was deliberately NOT wired into the
  renderer — there is no real on-disk encounter/instance-position data to
  drive it honestly for a specific frame; fabricating a monster placement
  would violate this project's no-fabrication rule.
- Ishar 2/3: their `cscreen 0x000e` constants were opportunistically noted
  from `main2.dis`/`main3.dis` (`xCenter=127, horizonY=78, width=255,
  height=112` for both) but their global-variable offsets (party
  position/facing, location type) were not re-derived, and no script was
  tested.

**Walker integration**: `tools/walker/games-ishar.ts`'s `IsharView` gained
a `firstPersonAvailable` getter (true only for `game==='ishar'` and region
`CONT1`, with `FORET.bin`/`FOND.bin` fetched successfully) and a `KeyF`
toggle between the existing top-down view (default, all other
games/regions) and the new first-person render. The first-person frame is
cached by `(x, y, facing)` and only recomputed when the party actually
moves. Existing WASD movement is unchanged (grid-quantized, absolute
N/E/S/W) — pressing a direction key both turns to face it and steps, which
already satisfies "turning changes the view" / "walking changes depth"
without inventing a separate first-person control scheme. **Not
independently verified in a live browser** (no Playwright install was
available this session and installing one would have required editing
`package.json`, out of scope) — the plumbing (`fetch`, `ImageData`,
`drawImage`) is thin, `tsc`/`eslint` clean, and wraps the Node-side-verified
`renderIsharForestFrame()` unchanged.

### 8.3 Generalization pass (2026-09-01/02) — a SECOND location script rendering (VILLAGE), a third attempted (TEMPLE, inconclusive), and a real N-ary indexing mechanism found in Crystals of Arborea

Following on from §8.2's single-script proof of concept, this pass generalized
the renderer and tried to extend it to more locations/titles per the task
brief's priority order.

**`renderIsharForestFrame()` renamed/generalized to `renderIsharLocationFrame()`**
(`tools/shared/ishar-firstperson.ts`) — it always took an arbitrary location
script, just under a FORET-specific name; the rename makes that explicit. No
behavioral change (regression-checked: `VILLAGE` at a fixed test pose renders
the identical 80 placements before and after).

**`VILLAGE.bin` — RENDERED, a second confirmed end-to-end script.**
Disassembled clean (241 instrs, 0 errors); shares `FORET.bin`'s exact
facing-switch + ring-clamp-loop shell **byte-for-byte**, including the whole
per-ring elevation/scale constant table (`-34,-23,-14,-8,-4,-1`), but
dispatches its cell value via a DIFFERENT `cswitch2` (`base=0x19, count=0x18`
— i.e. cell values `-25..-1` select one of 6 repeating sprite-index bases,
`0x1a/0x20/0x26/0x2c/0x32/0x38`, decreasing by 6 per step through the range —
a building-style selector, structurally the direct analogue of FORET's
terrain-type `cswitch1`). Verified against **real** `CONT1.FIC` data: a scan
for cells with sign-extended value in `[-25,-1]` found a real cluster at
`x=52-56,y=14-20` (values `-25,-21,-20,-19,-17,-16,-15,-14,-11,-10,-9`) —
independently matching this project's own earlier visual-inspection note (§9.3
below / §9.1's table) that this exact area of `CONT1` shows "building/compound
rectangles." Rendered 4 test poses near this cluster (facing each cardinal
direction) — placement counts 30-80, all real, non-degenerate, varied-size
(16×15 up to 80×40) decoded bitmaps, **visually confirmed via `Read`**: all
four frames show a coherent, recognizable timber-framed building silhouette
(large triangular roof trusses, repeated vertical support beams, small
fence-post-like accent elements) — a substantially MORE legible result than
FORET's abstract textured band, and unambiguously building-shaped, not
foliage-shaped. Exported as a browser asset
(`public/assets/ishar/amigaaga/scripts/village.bin`,
`tools/ishar/amigaaga/scripts.ts`) and wired into the walker (see below).

**`TEMPLE.bin` — attempted end-to-end, INCONCLUSIVE (not shipped).**
Disassembles clean (252 instrs, 0 errors), same shell shape (elevation table
byte-identical, ring cap 5 rather than 6), own cell dispatch `cswitch2
base=-10 count=6` (values `[-10,-4]`). A scan of `CONT1-6.FIC` found only 4
real cells in this range corpus-wide; the best (`CONT4.FIC` value `-8` at
`(67,26)`) was used to drive a real render, producing only 7 script
placements (19 with the `FOND` backdrop) — the composited frame shows no
visible foreground structure (just backdrop + placeholder ground), unlike
VILLAGE's clearly-legible result. Two candidate branches in TEMPLE's own cell
dispatch place a large mirrored pillar-pair (facing N/S) vs. a single small
facade sprite (facing E/W, `cjsr 0x5f3`) — the tested pose hit the small-sprite
branch, which may simply be too small/distant to read at this ring depth
rather than evidence of a decode error. **Not wired into the walker or
counted as a confirmed render** — reported here as an honest partial result,
not a success.

**`RAMPART.bin`/`PLAINE.bin` — disassembled only.** Both disassemble clean
(439 / 295 instrs, 0 errors) under the identical facing-switch + ring-loop
shell (RAMPART's ring cap is 7, not 6/5 like the others). Neither script's own
cell-dispatch table was traced, and neither was executed end-to-end, this
session — pure time-budget triage, not a blocker found.

**Ishar 2/3 — not attempted this session** (deferred; the task brief treated
this as optional once items 1-3 consumed the available effort — see
`docs/ishar/TODO.md`).

**Crystals of Arborea — a genuinely different, richer indexing mechanism
found; NOT solved.** Crystals ships several scripts sharing the IDENTICAL
facing-switch + ring-loop shell as Ishar 1's outdoor scripts (`ARBRE.CO`
351 instrs, `NPLAINE.CO` 314, `PLAGES.CO` 277, `CAVINT.CO` 439 — all 0
disassembly errors, using Crystals' own global offsets `0x2b38/0x2b39/0x2b3a`
for party X/Y/facing in place of Ishar 1's `0x137c/0x137d/0x137e`), confirming
the engine-wide scene-compositor convention transfers across titles as
expected. Also found a real, previously-undocumented content-loading
mechanism: `MAIN.CO`'s own bytecode (`cfopen("INIT.FIC",2)` +
`cfreadb(addr=0x7c, len=0x2a4e=10830)`, byte-exact against the real
`INIT.FIC` file size) loads the WHOLE 10,830-byte file into
`basemain+0x7c` in ONE read, spanning many separately-`cdim`-declared arrays
(`off=0x7c count=2 dims=[2,114]`, `off=0x2ace count=1 dims=[15]`,
`off=0x2b42 count=1 dims=[15]`, ...) — a genuine parallel to Ishar 1's
`EN1.FIC` scatter-array convention (§9.3) done as one big block read instead
of many small ones.

> **Correction (2026-09-02 follow-up pass): the N-ary indexing formula below
> is now SOLVED, not just traced-to-source.** `ARBRE.bin` renders a real,
> unambiguous forest scene end-to-end (4 real positions/facings, all
> visually confirmed via `Read` as coherent multi-tree first-person views);
> `NPLAINE.bin` renders a semantically-distinct sparse low-vegetation band at
> the same test position. The role assignment left open below (which popped
> value pairs with which `dims` entry, and `omainb(0x2b3c)`'s real role) is
> now pinned down: `index = direct + 2*pop() + 114*pop()`, where the FIRST
> `pop()` (multiplied by `dims[0]=2`) is the LAST-pushed eval-stack value and
> the SECOND `pop()` (multiplied by `dims[1]=114`) is the FIRST-pushed value
> (`tabchar()`'s `*acc++` reads the SAME direction `opushacc`/`opile` push/pop
> the stack, i.e. LIFO — a detail the original best-effort attempt below got
> backwards). `omainb(0x2b3c)` (the `direct`/`varD7` term) has no writer in
> this session's reached CFG and defaults to 0, which resolves to what turned
> out to be the OUTDOOR terrain layer (`Z=0`); an untested `Z=1` layer, found
> by the same array-wide visual scan, is a dense grid of rectangular room/
> building outlines — plausibly the indoor/`CAVINT`-side content, not
> confirmed (see `tools/shared/crystals-firstperson.ts`'s module doc for the
> full derivation and verification chain, and
> `docs/crystalsofarborea/amiga/data-structure.md` §8 for the per-title
> write-up). Wired into `tools/walker/games-crystalsofarborea.ts` (`KeyF`
> toggle, `KeyC` cycles `ARBRE`/`NPLAINE`).

ARBRE/PLAGES/NPLAINE/CAVINT's own `omaintc(0x7c)` reads push **TWO**
values before the indexed read (`[odirb(0x24) opushacc odirb(0x25) opushacc
omainb(0x2b3c) omaintc(0x7c)]`), not Ishar 1's one — because `basemain+0x7c`
is `cdim`-declared with `count=2` (two dimensions), not Ishar 1's `count=1`.
Tracing the real VM's `tabchar()` (`github.com/maestun/alis`'s `alis.c:1431`)
and `cdim`'s own runtime write algorithm (`opcodes.c:613`) shows `omaintc` is
genuinely **N-ary**, not a fixed 2-value `(x,y)` read as this project's
interpreter previously hardcoded: `result = addr + varD7 + Σ dims[i] *
pop()` for `i` in `0..count-1`, where `count`/`dims` are written into vram
just before the array's base by `cdim`, and each `pop()` consumes one
eval-stack value in LIFO order (most-recently-pushed first). Ishar 1's CONT
grids are the `count=1` special case (matches the already-confirmed
`cell = grid[y*width+x]` formula exactly). **`alis-interp.ts`'s `SceneEnv`
was generalized to this real formula** (`readGrid(addr, pop, direct)` — a
`pop()` closure instead of a fixed `(x,y)` pair; Ishar 1's own `SceneEnv` in
`ishar-firstperson.ts` was updated to call `pop()` once, reproducing the old
behavior exactly — regression-verified via VILLAGE's unchanged 80-placement
count). A best-effort Crystals-specific formula (`address = direct +
dims[0]*pop1 + dims[1]*pop2 = direct + 2*p1 + 114*p2`, using real `INIT.FIC`
bytes) was tried against `ARBRE.bin` — it produced a highly-suspicious
**600 placements** (far beyond any Ishar script's observed range of
9-116) with the rendered frame showing nothing (all placements land
off-screen), a strong signal that the specific role assignment (which popped
value pairs with which `dims` entry, and what `omainb(0x2b3c)`'s real
semantic meaning is) is **not yet correctly resolved**. This is reported
honestly as an OPEN, NOT-shipped, NOT-wired finding at the time — see the
correction block above this paragraph for the resolution (the role
assignment was the LIFO pop order, not the formula itself, which was already
right). Kept here as the paths-tried record: `crystals-local-scene-array-
indexing` is now SOLVED and its row removed from `docs/ishar/TODO.md`.

### 8.4 Fourth pass (2026-09-02) — `RAMPART.bin`/`PLAINE.bin` RENDERED by disassembling each script's own cell-value dispatch

§8.2/§8.3 left `RAMPART.bin` and `PLAINE.bin` at "disassembles clean under
the same shell shape, not traced further" — the same gap `TEMPLE.bin` fell
into (a real matching cell found, but not from the script's *own* declared
dispatch range, just a guessed test position). This pass closed both by
**disassembling each script's own `cswitch1`/`cswitch2` cell-value dispatch
instruction directly** (`tools/shared/alis-disasm.ts`, no new tooling
needed) rather than guessing a test position first, then scanning the real
`CONT*.FIC` grids for cells the script's own dispatch actually accepts —
the same method §8.3 used for `VILLAGE.bin`, generalized to both remaining
scripts (and, in Crystals' case, revealing a real correction — see the next
section).

**`PLAINE.bin` ("plains") — RENDERED.** Its own cell dispatch is a
`cswitch1` on `odirb(0x1c)` (fed from `omaintc(0x80)`/`omaintc(0x234a)`,
the same CONT-grid read every outdoor script uses) with an explicit value
set: `{-27, -26, 12, 13, 14, ..., 25, 34, 35, 36, 37}` (20 distinct values —
a sorted-linear-scan dispatch, not a contiguous range like FORET/VILLAGE's
`cswitch2`s). A scan of `CONT1.FIC` for cells in that set found **1,039
matches** — this terrain type is common, unlike VILLAGE's tight compound
cluster. Rendered 4 test poses near a dense cluster
(`(25,9)`/`(30,10)`/`(40,8)`/`(20,14)`, facing N/E/S/W): placement counts
39/347/81/169 (real, varied, non-degenerate). **Visually confirmed via
`Read`**: all four frames show a wide, textured grey-toned grass/field band
along the ground plus small rounded shrub/bush clumps in the foreground —
open, low vegetation, semantically distinct from FORET's dense tree-line
band and VILLAGE's angular building silhouette.

**`RAMPART.bin` ("fortress rampart") — RENDERED.** Its own dispatch is a
`cswitch2` on `odirb(0x26)` with `base=-100, count=11` — i.e. `index =
value - 100`, valid for `index` in `0..11`, so the accepted cell-value range
is **exactly `100..111`** (12 contiguous values, structurally the same
"cswitch2 on a small contiguous range" shape as VILLAGE's building selector,
just with a different base/sign). A scan of all 6 `CONT<n>.FIC` files found
**zero** matches in `CONT1`/`CONT2`/`CONT5`/`CONT6` but **101 matches in
CONT3 and 58 in CONT4** — and plotting the hits shows something no other
script's cluster has shown yet: a **closed polygon perimeter** (real cell
coordinates trace a rough pentagon: `(71-77,16-17)` → `(78-86,18-29)` →
`(83-87,22-37)` → `(78-84,38-44)` → `(56-71,29-45)` → `(58-66,18-27)` → back
to start), unmistakably a fortification wall enclosing an interior area —
exactly what "rampart" predicts, and a stronger structural match than any
other script's cluster shape so far (FORET/PLAINE are diffuse fields,
VILLAGE is a compact blob, this is a closed ring). Rendered 4 test poses
near/inside this ring in `CONT3.FIC` (`(65,22)` facing N/E, `(75,40)`
facing S, `(60,27)` facing W): placement counts 20/12/18/59. **Visually
confirmed via `Read`** for 3 of 4 poses: tall, narrow, angular
vertical silhouettes rising well above the horizon/tree-line — read as
towers/wall segments, a visual character no other rendered script shows
(everything else stays low and horizontal). The 4th pose (facing E from
`(65,22)`) shows only backdrop+ground with no visible foreground structure
despite 12 non-zero placements — honestly reported as "wall not currently
in view at this specific facing," the same kind of facing-dependent gap
already documented for FORET/TEMPLE, not a decode failure (the OTHER 3
poses from nearby positions are unambiguous).

**Shipped**: both scripts added to `LOCATION_SCRIPTS` in
`tools/ishar/amigaaga/scripts.ts` (exported as
`public/assets/ishar/amigaaga/scripts/{plaine,rampart}.bin`) and to
`tools/walker/games-ishar.ts`'s `KeyC` cycle. `RAMPART.bin`'s real cluster
being in `CONT3`/`CONT4` (not `CONT1`, unlike every other wired script)
meant `firstPersonAvailable`'s region gate was widened from `CONT1`-only to
`CONT1|CONT3|CONT4` — the existing "any script against any region" test-
bench convention (§8.2/§8.3) already tolerated a script rendering nothing
useful outside its own confirmed region, so this is a pure widening, not a
new mechanism.

### 8.5 Crystals of Arborea companion pass (2026-09-02) — `PLAGES.bin`/`CAVINT.bin` RENDERED, and a real correction to the `sceneLayer`/`CAVINT` guess

See `docs/crystalsofarborea/amiga/data-structure.md` §8's correction block
for the full write-up (same method as §8.4 above, applied to Crystals'
`INIT.FIC` local-scene array instead of Ishar's `CONT*.FIC` grids). Summary:
`PLAGES.bin` ("beaches") RENDERS a rocky/dune coastal terrain at 4 real
positions found from its own `cswitch1` dispatch (`{-25..-20, 50}`).
`CAVINT.bin` ("cave interior") also RENDERS, but needed a real correction:
its own `cswitch1` dispatch (`{-94..-90, -79..-70, 80..85}`) reads the
identical default-0 `omainb(0x2b3c)` `sceneLayer` global as every other
Crystals script (no writer in reached CFG, same as `ARBRE`/`PLAGES`) — yet
none of its accepted values exist anywhere in `INIT.FIC`'s Z=0 sub-array.
They DO exist, densely (1,947 matches, forming real closed room/wall
outlines), in the Z=1 sub-array — meaning the real game must set this
global to 1 somewhere in `CAVINT`'s own launch path (outside the script's
own bytecode, e.g. `MAIN.CO`'s scene dispatcher), not that `CAVINT` reads
Z=0 like everything else. This **confirms** (via real disassembly + real
cell matching, not the earlier untested guess) the previous session's
structural hunch that Z=1 is the indoor/room-outline layer — the earlier
"tested with `sceneLayer=1`, blank frame, INCONCLUSIVE" result was a wrong
TEST POSITION, not a wrong layer guess.

### 8.6 Generalizing to Ishar 2/3 (2026-09-01) — Ishar 2 CONFIRMED (two scripts), Ishar 3 attempted and left OPEN

Task: generalize the proven mechanism (§8.2-8.5) to Ishar 2/3, reusing
`computeScenePlacements()`/`compositeFrame()`/`fillPlaceholderSkyGround()`
unchanged (per the `crystals-firstperson.ts` precedent) rather than
reinventing them.

**Ishar 2 — CONFIRMED, RENDERED.** Dungeon files (`DJ*.DO`) were tried
first (the task's own initial suggestion) and rejected: `DJ1.bin` disassembles
as a 100 KB, 1,303-instruction script with a genuinely different
rectangular-area-scan structure, not the simple facing/ring-loop shell.
Pivoting to Ishar 2's own OUTDOOR location scripts (`FORET1.DO`, `VILLE.DO`,
`PLAINE1.DO`, `ARBO.DO`, `MONTAGNE.DO`) found they share Ishar 1's exact
facing/ring-loop shell byte-for-byte in STRUCTURE — only addresses and
tuning constants differ. This structural correspondence (same shell, same
operand-position roles feeding `omaintc`, only the literal addresses/
constants swapped) is the evidence for:

- `ISHAR2_GLOBALS`: `partyX = 0x2ab4`, `partyY = 0x2ab5`,
  `partyFacing = 0x2ab6` (a `cswitch2 base=-1 count=3` on `0x2ab6`, matching
  Ishar 1's `rawValue = facingIndex + 1` convention exactly — confirmed
  empirically: facing-block=1's world-Y update direction matches Ishar 1's
  own facing-value-1 block), `gridBufferA = 0x80`, `gridBufferB = 0x159c`.
- `ISHAR2_GAME_SCREEN = {xCenter:127, horizonY:78, width:255, height:112}`,
  from `MAIN.bin`'s own `cdefsc scridx=0x000e` config block (same field
  offsets as Ishar 1's own `cdefsc` block) — byte-identical to Ishar 3's own
  block (see below), both distinct from Ishar 1's.

Unlike Ishar 1 (one shared `FOND.bin` for every outdoor script), **Ishar 2
ships a PER-LOCATION backdrop file** (`FOND1.DO` for `FORET1.DO`,
`FVILLE.DO` for `VILLE.DO`).

RENDERED end-to-end, 9 real position/facing combinations, all visually
distinct and non-degenerate (`tools/.scratch/probe-ishar2*.ts`, PNGs
inspected via `Read`):

- `FORET1.bin` + `FOND1.bin` against real `CONT1.FIC` cells (terrain
  dispatch `cswitch2 base=-30 count=3`, i.e. sign-extended cell value in
  `[30,33]` — a dense 563-cell cluster around x=8-45,y=48+): `(20,50)` all
  4 facings + `(30,55)` facing N — 5 renders, all show coherent, clearly
  tree-like branching/root structures against sky+water, each facing/
  position producing a visibly different composition (e.g. `(30,55,N)`
  shows a horizon tree-line with a wide water gap, `(20,50,E)` shows
  multiple distinct tree clusters spread across the frame).
- `VILLE.bin` + `FVILLE.bin` against real `CONT3.FIC` cells: `(35,9)` all 4
  facings — 4 renders, each showing a recognizable row of building
  roofs/walls along the horizon over a cobblestone ground, with clearly
  different building silhouettes per facing (N: a continuous roofline; E: a
  fence/gate structure plus a tall tower; S: a stacked-wall/brick
  structure).

Minor open caveat: `FORET1.bin`'s runs hit the interpreter's
`STEP_BUDGET` (200,000 steps, `alis-interp.ts`) before naturally
terminating (`'step budget exceeded -- aborting run'` warning) — the
rendered frames still look coherent (near-field content composites first),
so this doesn't block shipping, but a fuller/more distant background may be
missing for this specific script. Not investigated further this session.

`ARBO.bin`/`PLAINE1.bin`/`MONTAGNE.bin` disassemble clean under the same
shell (0 decode errors) but weren't exercised end-to-end — `MONTAGNE.bin`
is structurally more complex (1,462 instructions vs. ~200-500, 8
`cswitch2` sites instead of 2), likely a multi-sub-biome script, out of
scope this pass.

Shipped: `tools/shared/ishar2-firstperson.ts` (mirrors
`crystals-firstperson.ts`'s module shape: `ISHAR2_GLOBALS`,
`ISHAR2_GAME_SCREEN`, `renderIshar2LocationFrame()`), export pipeline
`tools/ishar2/amigaaga/scripts.ts` (ships `foret1.bin`/`fond1.bin`/
`ville.bin`/`fville.bin` under `public/assets/ishar2/amigaaga/scripts/`),
and `tools/walker/games-ishar.ts` generalized to dispatch the render
function and location-script table per game id (`LOCATION_SCRIPTS`,
`RENDER_FRAME`, both keyed by `IsharGameId`) — `KeyF`/`KeyC` now work
identically for Ishar 2 as they already did for Ishar 1.

**Ishar 3 — attempted, NOT achieved this session. Left OPEN, well-scoped.**
The same structural-correspondence approach found:

- `ISHAR3_GLOBALS`: `partyX = 0x14b6` (clamped against 57, matching
  `ISHAR_REGION_LAYOUT.ishar3.width`), `partyY = 0x257` (clamped against
  82, matching `.height`), `partyFacing = 0x14b7`, `gridBufferA = 0x260`,
  `gridBufferB = 0x14ae` (the latter two match §9's already-confirmed
  `MAIN.bin` loader trace) — CONFIRMED by disassembly.
- A facing dispatch (`cswitch2 base=2 count=4`, targets
  `[869,608,1126,82,345]`) exists at a position analogous to Ishar 1/2's,
  and a 4-entry raw-value table (`ISHAR3_FACING_RAW = [-2,-1,2,1]` for
  N/E/S/W) was derived by tracing which world-coordinate axis/sign each of
  the 4 non-default target blocks updates.
- `ISHAR3_GAME_SCREEN` is byte-identical to Ishar 2's `cdefsc` block.

**However, rendering `FORET.bin` (+ `FFORET.bin`) against real `CONT4-3.FIC`
cells produces a noisy, non-forest-like image at every position/facing
tried** (5 positions across 2 test cells, one near a region edge and one
well interior — ruling out an edge-clamp artifact). Root-caused (not just
observed) via direct disassembly of the shared per-cell subroutine chain
(`cjsr target=1127` at four call sites in `FORET.bin`, decimal target 1127
= file offset `0x467`, itself immediately calling `cjsr target=1747` =
`0x6d3`, the ring-depth-to-screen-scale table): **Ishar 3's outdoor scripts
use a materially different, more complex shell than Ishar 1/2.** Instead of
a single facing-SELECTED forward-scan (one of 4 blocks executes, chosen by
the facing dispatch), Ishar 3's `FORET.bin` executes **all 4 of a
"diamond scan" set of blocks unconditionally** (found via `grep`-ing every
`cjsr target=1127` call site — 4 distinct call sites, none behind the
facing `cswitch2`), each sweeping a depth x lateral double loop along a
DIFFERENT pair of world axes (two blocks feed the lateral loop variable into
world-Y with a fixed world-X depth offset; the other two feed it into
world-X with a fixed world-Y depth offset — i.e. north/south/east/west
strips around the player, not one forward frustum). The per-cell
screen-projection formula (`sdirw(0x5e) = odirb(0x58) * scaleConstant[ring]`,
found in the shared `0x6d3` subroutine) is confirmed structurally sound in
isolation — but the OUTER ring loop's lateral-bound narrowing/widening logic
(`0x59` ring counter decrementing, `0x54`/`0x55` lateral bounds
accumulate-unless-clamped each ring) allows the observed lateral magnitude
to reach ~28-49 in practice, not the ~7 the initial one-time clamp suggests
— multiplied by scale constants up to 192, this produces on-screen x-offsets
from -9,408 to +1,197 against a 255px-wide screen (confirmed via direct
instrumentation of `runIsharScene()`'s raw placement list, not just the
final composited image).

**Confirmed NOT script-specific**: `JUNGLE.bin` (paired `FJUNGLE.bin`)
shares the byte-identical shell shape — also exactly 4 `cjsr target=1127`
call sites, 0 decode errors — so this is a title-wide structural
difference in Ishar 3's outdoor renderer, not a `FORET.bin` quirk.

Paths tried (all on real `FORET.bin`/`JUNGLE.bin` bytes, not synthetic
data):

| Approach | Result | Why it failed |
|---|---|---|
| Structural-correspondence global/facing derivation (the approach that worked for Ishar 2) | Globals/screen constants confirmed; render still broken | Correspondence holds for the FACING dispatch and globals, but Ishar 3's terrain-scan CONTROL FLOW is a different shape (4 unconditional quadrant blocks, not 1 facing-selected block) — the assumption "same shell, only addresses differ" was true for Ishar 2 but false for Ishar 3's scan structure specifically |
| Test at 5 positions/facings against `FORET.bin` | All 5 renders equally noisy/wrong | Rules out a single bad test position; the bug is structural, not position-dependent |
| Interior vs. near-edge test position (`(7,3)` vs `(28,40)` in a 57x82 grid) | Both produce wildly out-of-range x (`-9,408..1,197` and `-5,376..384` respectively) | Rules out an edge-clamp artifact as the sole cause — the out-of-range magnitude scales with position but never resolves to a plausible range |
| Direct instrumentation of `runIsharScene()`'s raw placement list (bypassing composite-leaf `dx`/`dy`/`dz` offsets) | Confirmed the huge x values originate at the `cputnat`/`cxputat` placement-command level itself, not in `resolveIsharComposite()`'s composite expansion | Narrowed the bug to the script's own coordinate-computation subroutine, not the shared renderer library |
| Traced the shared per-cell subroutine chain (`0x467`->`0x6d3`, the ring-scale table) to its full body | Formula itself (`lateral * scaleConstant[ring]`) is internally consistent and looks correct in isolation | The bug is in what feeds "lateral" into that formula — the OUTER ring-loop bound-narrowing logic across 4 differently-shaped scan blocks, which needs a full CFG-level re-derivation, not a one-function read |
| `JUNGLE.bin` as an alternative script (this session's own planned fallback) | Confirmed the identical 4x-`cjsr`-1127 shell shape (same call-site count, 0 decode errors) | Rules out "just try a simpler script" — the shell difference is title-wide, not one script's authoring quirk |

Not escalated to `re-oracle` this session: the negative is well-scoped (a
specific, named structural difference — 4 unconditional quadrant blocks vs.
1 facing-selected block — with concrete file offsets and evidence, not a
vague "doesn't work"), and the task's own instructions explicitly permit
leaving one title as a scoped follow-up when the other is solid. A future
pass should fully disassemble all 4 scan blocks' lateral-bound
narrow/widen logic (the `0x37c`-`0x466`-shaped tail already partially read
above) to determine which block (if any) corresponds to the "forward
view" and whether the other 3 feed a DIFFERENT, not-yet-found screen
formula rather than the shared `0x6d3` one.

`ishar3-firstperson.ts` is left in the tree (globals/facing table/screen
constants are genuinely CONFIRMED and may be useful groundwork), but its
module doc no longer claims a working render, and it is NOT wired into
`tools/walker/games-ishar.ts` (`LOCATION_SCRIPTS.ishar3 = []`).

> **Correction (2026-09-02):** the "4 unconditional quadrant blocks" verdict
> above was WRONG — a genuine misdiagnosis, not a hard structural limitation.
> The prior pass's evidence ("4 distinct `cjsr target=1127` call sites, none
> gated by the facing `cswitch2`") only checked that no SINGLE gate wrapped
> all 4 sites textually; it never checked CFG reachability from the `cswitch2`
> dispatch itself. A full disassembly this session (`FORET.bin`, entry
> `scriptEntryPoint()`-derived, 247 instructions, 0 decode errors) shows:
>
> - The `cswitch2 base=2 count=4` at file offset `0x3c` has 5 targets
>   (`[869, 608, 1126, 82, 345]`); target `1126` (`0x466`) is a bare `cret`
>   (the value=0/out-of-range no-op case).
> - Each of the OTHER 4 targets (`0x365`=N, `0x260`=E, `0x159`=S, `0x52`=W —
>   matching `ISHAR3_FACING_RAW`) is its OWN self-contained block: its own
>   depth-cap setup (`0x56`/`0x59`, bounded by the depth-axis global capped
>   at 7), its own lateral-bound setup (`0x54`/`0x55`, bounded by the
>   lateral-axis global against the region's OTHER dimension), its own ring
>   loop with its own `cjsr target=1127` call site — and EVERY block ends
>   with `cjmp target=1126` (0x466, the shared `cret`), not a fallthrough
>   into the next block.
> - This is EXACTLY Ishar 1/2's shell shape (one facing-selected block, not
>   4 unconditional ones) — the earlier pass's "materially different shell"
>   conclusion doesn't hold up under a real CFG trace. See
>   `false-positive-bytecode-hit-without-cfg-reachability.md` — this is a
>   textbook instance of that pitfall: a flat opcode-occurrence grep mistaken
>   for a liveness/reachability proof.
> - Independently double-checked the interpreter's comparison-operator
>   semantics against `github.com/maestun/alis`'s real source
>   (`src/opernames.c`'s `readexec_opername_saveD7()` + `osup()`: saves the
>   PRE-token accumulator into `varD6`, reads the operand into `varD7`, then
>   `varD7 = (varD6 > varD7) ? -1 : 0`) — confirms `alis-interp.ts`'s
>   `applyBinary(op, accBefore, newOperand)` convention is correct, ruling
>   out an operand-order decode bug as an alternative explanation.
>
> **Result: `renderIshar3LocationFrame()` needed NO code change.** Running
> the existing, unmodified interpreter/`SceneEnv` against real `FORET.bin`/
> `JUNGLE.bin` bytecode and real `CONT4-3.FIC` grid cells at 7 real
> position/facing combinations (`(28,41)` all 4 facings, `(15,20)` facing N,
> `(40,60)` facing S, plus JUNGLE at `(28,41)` facing N) produced coherent,
> non-degenerate first-person frames for 6/7 (visually inspected via `Read`:
> distinct tree/foliage silhouette shapes against a sky/ground split,
> different per facing/position — `(40,60)` facing S rendered only the
> backdrop with 2 foreground placements, an empty-but-not-garbage scene,
> plausibly because no FOREST_SET-matching cell falls within view from that
> specific pose). `JUNGLE.bin`'s own cell-value dispatch (`cswitch2
> base=-7 count=26`, accepted range `[-7,19]`) is much broader than
> FORET's explicit `cswitch1` list and doesn't discriminate one
> `CONT<n>-3.FIC` region from another the way FORET's does (a corpus scan
> found `CONT4-3.FIC` has by far the strongest FOREST_SET match — 4,057/4,674
> cells, 87% — but every region matches JUNGLE's broader set at 50-90%), so
> JUNGLE is shipped against the same `CONT4-3.FIC` region as FORET on the
> strength of its own real, non-degenerate render rather than an
> independently-pinned canonical region.
>
> **The residual "lateral bound can widen instead of shrink" anomaly is
> real** (re-derived and confirmed by disassembly, not retracted) but turns
> out to be empirically HARMLESS for interior party positions: `blit()`'s
> per-pixel clip silently drops placements whose computed screen X falls
> outside the visible range, and for an interior position the vast majority
> of VISIBLE (in-range) pixels come from the correctly-scaled near rings.
> Direct instrumentation confirmed raw placement x-offsets at `(28,41)`
> facing N span `-5,376..384` (matching the "widens to ~28-49 cells laterally,
> times up to 192 scale" mechanism previously found) while the COMPOSITED,
> clipped frame still shows a clean, recognizable scene. Testing a
> near-CORNER position (`(7,3)`, both axes close to their own edges
> simultaneously — the previous session's own test position) DOES show a
> visibly messier, less-structured result than any interior position, which
> is consistent with this quirk being real and position-dependent, just not
> disqualifying for normal (non-corner) play. Not investigated further —
> low priority, doesn't block shipping.
>
> Shipped this session: `tools/ishar3/amigaaga/scripts.ts` (exports
> `foret`/`fforet`/`jungle`/`fjungle` to
> `public/assets/ishar3/amigaaga/scripts/`, matching Ishar 1/2's own
> `scripts.ts` convention — not wired into `npm run`), and
> `tools/walker/games-ishar.ts`'s `LOCATION_SCRIPTS.ishar3`/`RENDER_FRAME.ishar3`
> now dispatch to `renderIshar3LocationFrame()` exactly like Ishar 1/2 — `KeyF`/
> `KeyC` work identically for Ishar 3 now. `ishar3-firstperson.ts`'s module doc
> has been rewritten to match (CONFIRMED, not "attempted, not achieved").

### 8.7 Fifth pass on Ishar 1 (2026-09-02) — `TEMPLE.bin` RENDERED, superseding the §8.3 INCONCLUSIVE verdict

§8.3 left `TEMPLE.bin` at "attempted end-to-end, INCONCLUSIVE": its own
`cswitch2 base=-10 count=6` dispatch was read as accepting cell values
`[-10,-4]`, a scan of `CONT1-6.FIC` found only 4 matching cells
corpus-wide, and the one rendered position produced just 7 placements with
no visible foreground structure. This pass re-derived the dispatch from
scratch (re-disassembling `TEMPLE.bin`'s own `cswitch2` at file-relative
bytecode offset `0x4c9`, confirmed byte-for-byte against the raw bytes:
`expr=odirb(33)`, `count=6`, `base=-10`) and found the earlier value range
was **wrong — a sign error, not a data absence**.

**The fix**: `alis`'s own `opcodes.c` `cswitch2()` (lines 743-761,
vendored copy at `/tmp/.../scratchpad/alis/src/opcodes.c` from an earlier
`re-oracle` escalation) reads `alis.varD7 += script_read16()` (i.e.
`varD7 = value + base`) and then tests `0 <= varD7 <= count`, so the real
relationship is **`index = value + base`**, equivalently `value = index -
base`. Applying this correctly to `base=-10`, `count=6` (7 slots, index
`0..6`) gives `value = index - (-10) = index + 10`, i.e. the real accepted
range is **`[10,16]`**, not `[-10,-4]` as the earlier pass computed
(apparently by using `value = index + base` instead). Cross-checked against
two ALREADY-CONFIRMED dispatches in this same doc using the same
`value = index - base` formula: RAMPART's `base=-100,count=11` gives
`[100,111]` (matches §8.4's cited range exactly) and VILLAGE's
`base=0x19,count=0x18` gives `[-25,-1]` (matches §8.2/§8.3's cited range
exactly) — both already-shipped, visually-confirmed renders are consistent
with the corrected formula, confirming the formula itself (not just this
one instance) and isolating the earlier TEMPLE-specific error to that one
derivation.

**Scan result**: cells with sign-extended value in `{10,...,16}` are
common across the WHOLE corpus (CONT1: 165, CONT2: 1,112, CONT3: 65,
CONT4: 169, CONT5: 818, CONT6: 42 matches) — not "4 cells total" as the
wrong range implied. This terrain code is evidently a common decorative
feature (like PLAINE's terrain, not a single unique building placement
like VILLAGE's compound), present in every region; this pass only
rendered/visually-confirmed `CONT3`, `CONT4`, and `CONT6` (`regionPattern`
is scoped to those three, consistent with the project's "test-bench, not
exhaustive" convention for `firstPersonAvailable`).

**Disassembling the two content-placing branches** (values 10/11/12 to
subroutine `0x5f3`; values 15/16 to subroutine `0x63a`; values 13/14
return immediately with no placement) found a real, coherent architectural
design, not arbitrary dispatch noise: values 11/12 test
`facing==East OR facing==West` (`omainb(0x137e)`, the confirmed party-facing
global) and, when FALSE (i.e. facing North or South — looking straight
down a corridor), place a **MIRRORED PAIR** of the same sprite at lateral
offsets `dx=∓99` (value 11) or `dx=∓113` (value 12) via one `cputnat` +
one `cxputat` call sharing a scratch var (`sdirb(40)`) set to `-99`/`+99`
(or `-113`/`+113`) between them — a textbook "two columns flanking a
path" layout. When TRUE (facing East/West — looking across the corridor),
it instead calls the shared small-facade subroutine (`0x5f3`, gated
further by a toggle byte `odirb(42)` alternating between two sprite
indices). Values 15/16 place a single (non-mirrored) object via
subroutine `0x63a`, each suppressed for exactly one facing (15 hides when
facing North, 16 hides when facing South) — plausibly a landmark object
whose sprite is only drawn from angles where it isn't edge-on to the
camera. Value 10 has no mirrored-pair branch (only the small-facade-or-
nothing choice).

**Rendered 6 test poses** (`renderIsharLocationFrame`, `TEMPLE.bin` +
its own backdrop `FTEMPLE.bin` — see below): `CONT4 (20,20) facing N`
(15 placements), `CONT4 (20,7) facing S` (26 placements), `CONT3 (54,12)
facing N` (5 placements), `CONT3 (55,49) facing N` (11 placements),
`CONT6 (50,17) facing S` (13 placements), `CONT6 (50,23) facing N` (13
placements) — all real, non-degenerate, varied placement counts.
**Visually confirmed via `Read`**: the `CONT4 facing S` pose shows two
clearly SYMMETRIC vertical pillar/column shapes flanking a dark
central archway, against a mottled stone-arch backdrop — an unmistakably
temple/architectural composition, visually distinct from every other
rendered script (FORET's tree-line, VILLAGE's timber building, PLAINE's
grass field, RAMPART's fortress walls). The other 5 poses show a single
thin pillar/pole silhouette or a dark building-block silhouette against
the same stone-arch backdrop — coherent and varied, though less
dramatically legible than the paired-pillar pose.

**A previously-undocumented per-location backdrop convention found for
Ishar 1**: `MAIN.bin`'s resource manifest (§3) contains a straight-line
`cload(id=68, "ftemple.AO"); cload(id=69, "temple.AO")` instruction pair
at file-relative bytecode offsets `0x1a88`/`0x1a96` — exactly 14 bytes
apart, matching `cload`'s own encoded instruction length exactly, i.e. two
adjacent statements with NO branch between them, not a coincidental
address gap. This means Ishar 1 does NOT uniformly share one `FOND.bin`
backdrop for every outdoor location as §8.2 claimed ("no per-biome
backdrop file exists on disk") — `FTEMPLE.DO` (11,412 B on disk, 17,056 B
decompressed) genuinely exists and is `TEMPLE`'s own companion asset, the
same per-location-backdrop convention already established for Ishar 2
(§8.6's `FOND1.bin`/`FVILLE.bin`). (`FVILLE.DO` also exists in Ishar 1's
own data directory, alongside `VILLAGE.DO` — raising the same question for
the already-shipped `VILLAGE.bin` render, which currently uses the shared
`FOND.bin`; not re-tested this session, see `docs/ishar/TODO.md`.) Both
`FOND.bin` and `FTEMPLE.bin` render plausibly as TEMPLE's backdrop (spot-
checked); `FTEMPLE.bin` was shipped as the default since it is TEMPLE's
own confirmed companion asset per the manifest evidence above.

**Shipped**: `TEMPLE.bin` + `FTEMPLE.bin` exported
(`public/assets/ishar/amigaaga/scripts/{temple,ftemple}.bin`,
`tools/ishar/amigaaga/scripts.ts`) and wired into
`tools/walker/games-ishar.ts`'s `LOCATION_SCRIPTS.ishar` (`fondKey:
'ftemple'`, `regionPattern: /^CONT[346]/i`) and `KeyC` cycle.

**Paths tried** (superseding §8.3's row for this item):

| Approach | Result | Why it failed / succeeded |
|---|---|---|
| §8.3: scan `CONT*.FIC` for `cswitch2` value range `[-10,-4]` (formula `value = index + base`), render the one real hit | 4 matches corpus-wide; rendered frame showed no visible foreground structure | Wrong formula — should be `value = index - base`, confirmed against `opcodes.c` source and two already-shipped dispatches (RAMPART, VILLAGE) using the same formula correctly |
| §8.7 (this pass): re-derive from `opcodes.c` source, scan for `[10,16]` | 165-1,112 matches per region, 6/6 test poses render real, varied, temple-coherent content (paired pillars) | Correct formula; the earlier session's range was simply computed backwards for this one instance (RAMPART/VILLAGE happened to be computed correctly) |

## 9. The world/region grid system — SOLVED (`CONT*.FIC` + MAIN bytecode loader), CONFIRMED

Found by the 2026-09-01 `re-oracle` pass. The actual walkable-world data
for all three Ishar titles lives in the **`.FIC` sidecar files** (previously
the deprioritized `ishar-fic-files` row), loaded at runtime not through the
container/codec layer at all but through the ALIS VM's raw file-I/O opcodes
(`cfopen` 0x70 / `cfreadb` 0x77 / `cfwriteb` 0x78 / `cfclose` 0x71),
whose call sites — with literal filenames, destination addresses and
byte-exact lengths — sit in `MAIN.DO`'s own bytecode.

### 9.1 The region grids: `CONT<n>.FIC`

One file per world region ("contrée" — matching `MAIN.DO`'s own
`NUMERO DE CONTREE ?` editor prompt). **No header, no compression: the
whole file is one (or two) raw row-major byte grid(s), 1 byte per cell.**

| Title | Files | File size | Layout | Row stride (game's own `cdim`) |
|---|---|---|---|---|
| Ishar 1 | `CONT1-6.FIC` | 4,860 B | one **90×54** grid | 90 |
| Ishar 2 | `CONT1-7.FIC` | 10,800 B | two **60×90** layers (2×5,400) | 60 |
| Ishar 3 | `CONT1-3..6-3.FIC` | 9,348 B | two **57×82** layers (2×4,674) | 57 |

Three independent signals agree per title, meeting the CONFIRMED bar:

1. **Byte-exact loader bytecode in `MAIN.bin`** (decompressed offsets,
   hand-decoded against `alis`'s opcode/opername/storename tables):
   - Ishar 1 `MAIN.bin+0x49d2`: `70 ff 0a 233a 00 02` =
     `cfopen(strvar@vram+0x233a, mode 2)`; `77 0080 12fc` =
     `cfreadb(vram+0x0080, len 4860)`; `71` = `cfclose`. A twin routine at
     `+0x49e3` reads into `vram+0x234a`; matching `cfwriteb` routines at
     `+0x4992`/`+0x49a4` (mode 0x0302) **write the 4,860 bytes back to
     disk** — CONT files are mutable region state (live world persistence
     onto the game disk), not static assets. The filename is set by a
     region-number dispatch (`cswitch2` on byte var `vram+0x4251`) whose
     6 arms each store the literal `"CONT<n>.FIC"` (inline `cstore oimmp`
     strings at `MAIN.bin+0x4a16..0x4a87`).
   - Ishar 2 `MAIN.bin+0x3cb7`: same shape, two reads
     `cfreadb(+0x0080, 5400)` + `cfreadb(+0x159c, 5400)` = 10,800 exactly.
   - Ishar 3 `MAIN.bin+0x4a25` (v30 form, u32 lengths):
     `cfreadb(+0x0260, 4674)` + `cfreadb(+0x14ae, 4674)` = 9,348 exactly.
2. **The game's own array declarations** (`cdim`, opcode 0x29, which writes
   ALIS's self-describing array-dimension header just below the array):
   Ishar 1 `MAIN.bin+0x60`: `29 0080 01 01 005a` = element size 1, one
   stride word **90** for the array at `vram+0x80` (and `+0x191` declares
   the `0x234a` twin, also stride 90; Ishar 2 declares stride **60** for
   both buffers; Ishar 3's v30-form `cdim` declares stride **57** and total
   size 0x1242=4,674). The stride word is what `tabchar()`
   (`alis.c:1431`) multiplies the row index by: **cell address =
   base + x + y*stride**.
   (The two Ishar 2/3 layers are genuinely *layers*, not top/bottom map
   halves: Ishar 2 `CONT1.FIC`'s second 5,400 bytes are 98% zero with a
   tiny sparse alphabet ({1,2,3,4}, a couple of high-bit values) — a
   sparse object/overlay layer over the dense terrain layer, and each
   buffer gets its own separate `cdim` declaration.)
3. **Whole-file autocorrelation** on the shipped `.FIC` bytes independently
   peaks at exactly those strides (90 / 120=2×60 / 57), and an ASCII render
   of Ishar 1's `CONT1.FIC` at 90×54 shows an unmistakable coherent region
   map: a `0xCC/0xCD/0xCE`-walled coastline, road lines, enclosed
   village/compound rectangles, terrain-type patches. (`CONT6` is nearly
   empty — 138 non-zero cells — a special mini-region.)

**Runtime anchor**: the active region grid lives at `basemain + 0x80`
(Ishar 1/2; `+0x260` Ishar 3), i.e. inside MAIN's *runtime variable RAM* —
which is why every prior static scan of MAIN's *file bytes* for the grid
came back empty (vram is zero-initialized at load; the grid arrives via
`cfreadb` afterward).

**Consumers (byte-pattern census across all Ishar 1 decompressed
scripts)**: indexed reads of the grid use opername `omaintc` (0x26 =
`tabchar` on `basemain + offset`); the 3-byte pattern `26 00 80` appears in
exactly the scripts you'd predict — `GERDEP.bin` ("gère déplacement", the
movement handler, 6 sites), `RPLAINE.bin` (12), `ENCONT.bin` (encounters),
`AFFOBJ.bin`, and every outdoor/location scene script (`VILLAGE`, `VILLE`,
`TEMPLE`, `FORET`, `PLAINE`, `MCAVE`, `COLCAVE`, `INCAVE`, `ARBRE`,
`LACUSTRE`, `STEL`, `FONTAINE`, ...) — each paired 1:1 with a read of the
second buffer (`26 234a`). A decoded GERDEP statement
(`GERDEP.bin+0x9a5`): `1e | 38 | 1e 3fd0 | 40 | 1e 137d | 26 0080 | 3a |
12 13` = `cstore( oeval; omainb(0x3fd0); opushacc; omainb(0x137d);
omaintc(0x0080); ofin ) -> sdirb(0x13)` (the `1e`/`0x1e` bytes are the
`cstore` opcode and the `omainb` opername — same byte value, different
dispatch tables) →
**cell = grid[ byteVar(basemain+0x3fd0) × 90 + byteVar(basemain+0x137d) ]**
— identifying the party-position globals (a second variable pair
`0x137c`/`0x3fd1` appears in sibling expressions, likely the
candidate/target cell of a movement test).

### 9.2 Cell values (semantics partially open)

Observed alphabet: `0x00` (dominant; void/outside-region — reads as sea in
the render), low positive codes `0x01..~0x30` (terrain/feature types —
roads render as long `0x03` lines, letters `0x13-0x1b` cluster around
buildings), and high-bit values `0x9D`, `0xCC/0xCD/0xCE` (coastline/borders
— the walls of the rendered map), `0xE1`, `0xE5/0xE6` (dense
forest/mountain patches). `tabchar` reads cells **sign-extended**
(`(s8)xread8`), so "cell < 0" is the natural blocked/special test —
HYPOTHESIS: high-bit = impassable obstacle class, low positive = walkable
terrain whose value selects the scene/location script. The value→scene
dispatch (very likely the `cswitch` streams in `MAIN.bin+0x18e8..0x1c74`,
where all the location `.AO` names sit) is not yet decoded — that, and the
exact role split between the two grid buffers (`0x80` vs `0x234a`:
adjacent-region staging for border crossing, or pristine-copy for
change-detection — both fit the paired reads), are the remaining open
items. See `docs/ishar/TODO.md`.

### 9.3 The other `.FIC` files

- **`EN1.FIC`** (3,640 B Ishar 1; 6,050 B Ishar 2/3) — the encounter/
  monster table bank. Loaded by a scatter-read routine right after the
  CONT dispatch (Ishar 1 `MAIN.bin+0x4a8a`): one `cfopen` + **28 separate
  `cfreadb`s** into distinct `vram` arrays (5×140 B, 12×70 B, 2×210 B,
  1×560 B, ...) summing to **exactly 3,640** — and 29 reads summing to
  exactly 6,050 in both Ishar 2 (`+0x3e0e`) and Ishar 3 (`+0x4adc`,
  write-twin at `+0x4ae4`). So EN1 is a concatenation of the game's
  monster/encounter arrays in vram order, sizes byte-exact from the
  bytecode.
- **`TAB1.FIC`** (Ishar 1, 361 B) — loaded whole by
  `MAIN.bin+0x4b2c`: `cfopen("TAB1.FIC", 2); cfreadb(vram+0x379c, 0x169);
  cfclose` (0x169 = 361 exactly), and declared by `cdim` at `MAIN.bin+0x1bc`
  with stride **19** → a 19×19 byte grid, values {1,2,3,4} only. Role open
  (candidates: encounter-frequency/biome zone table; "EDITER TABLEAU ?"
  suggests editor provenance).

### 9.4 `MAP.DO` — resolved: it's the map *picture*, not a grid

With the corrected bitmap-header offsets (§7 / `docs/ishar-sprite-format.md`
correction: width at header+2, height at header+4 — the prose previously
said +1/+3 while the shipped code correctly used +2/+4), `MAP.bin` parses
completely: a 24-byte script header, an 8-byte bytecode stub, a 2-slot
resource directory (slot 1 = a composite record `ff 01 | elem 0, dx=159,
dz=137`; slot 0 = a **type 0x12 opaque banked-4-bit 320×126 bitmap**,
pixel run `0x4b2..0x5372`, ending 6 bytes before EOF). The old
"`0x88` is 21% of the payload" observation was simply this image's dominant
pixel-pair value. `MAP.DO` is the auxiliary top-down map screen's
*artwork*; the walkable world is §9.1's `CONT*.FIC`.

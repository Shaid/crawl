# Crystals of Arborea (Silmarils, 1990, Amiga) — data structure

`data/crystalsofarborea/amiga/` — the prequel to the Ishar trilogy, same
developer, related-but-not-identical engine. **Container format is shared
with Ishar 1/2/3** — see `docs/ishar-container-format.md` for the full
derivation; this doc covers only what's specific to this title.

Genuinely from-scratch investigation, first pass. Confidence levels used
below: **CONFIRMED** (verified against an exact-equality invariant or code),
**STRUCTURAL** (derived from consistent byte-level evidence across the
corpus, not yet code-verified), **HYPOTHESIS** (plausible, weakly
evidenced).

## 1. Executable

`T.X` (54,420 bytes) — a real AmigaOS hunk executable (`HUNK_HEADER` magic
at offset 0), the smallest of the four titles' main binaries. Not yet
disassembled this pass (see `docs/ishar/TODO.md`).

## 2. Container inventory

`npx tsx tools/crystalsofarborea/amiga/inventory.ts` scans
`data/crystalsofarborea/amiga/` and writes
`public/assets/crystalsofarborea/amiga/data/container-inventory.json`.
Summary (47 total files):

| classByte | count | meaning |
|---|---|---|
| `0x81` | 36 | compressed (see `docs/ishar-container-format.md` §2.3) |
| `0x01` | 6 | stored/raw, `decompressedSize == fileSize` exactly (CONFIRMED) |
| non-container | 5 | `T.X`, `DEFAULT.DAT`, `S2.DAT`, `INIT.FIC`, `T.X` executable |

Every `.CO` file parses cleanly under the shared header — no anomalies
found (all 42 `.CO` files carry a valid `classByte`/size field, 0 parse
failures).

## 3. `CARTE.CO` — the overworld travel screen (STRUCTURAL + partial content)

`CARTE.CO` ("map") is `classByte == 0x01` (**stored, uncompressed** —
`decompressedSize == fileSize == 29,860` exactly), making it directly
readable without needing the compression codec. This is the single most
informative file examined this pass for the "how does the overworld work"
question.

### 3.1 Confirmed content: character names + travel UI text

A plain `strings` pass over the raw bytes finds, near the very start of the
file (offset ~0x160-0x1E0):

```
JON  ZACH  IRVAN  AKEER  OLBAR  THORM  ALL  NONE  MOVE  EXIT
```

`ZACH`, `IRVAN`, `AKEER`, `OLBAR`, `THORM` read as NPC/companion names
(fantasy-appropriate); `ALL`/`NONE`/`MOVE`/`EXIT` are UI command labels.
This is direct, confirmed evidence that `CARTE.CO` is not a pure geometric
map — it's the **overworld travel screen**, combining map/travel state with
a party-recruitment or companion-selection UI (`MOVE`/`EXIT` as menu
actions, `ALL`/`NONE` as a select-all/select-none toggle for a
multi-companion list). This is consistent with what's publicly known of
Ishar's gameplay (recruitable NPC companions who travel with the party) —
Crystals of Arborea, as the engine's prequel, evidently already had this
mechanic.

### 3.2 Structural finding: an 8-entry, twice-repeated fixed record array

Immediately following the string region (from file offset `0x30` in the
byte stream, right after the header + a short preamble), a tight,
byte-exact repeating record pattern was found by searching for the literal
marker byte-pair `38 00`:

```
38 00 II 3a 1a ZZ 1e 00 XX
```

where `II` runs `00,01,02,...,07` (an 8-entry index, confirmed
monotonically incrementing by exactly 1 each record — a strong keyframe/
array-boundary signal per this project's verification conventions), `ZZ` is
constant within each of the two runs (`0x3C` for the first 8-record run,
`0x46` for the second), and `XX` varies (`01,01,01,00,FF,FF,FF,FF` in the
first run; `FF,00,01,01,01,00,FF` in the second). Each record is 9 bytes;
16 records total (2 runs of 8). The record pattern (`38 00 <index 0-7> 3a
1a <const> 1e 00 <byte>`) recurs many more times later in the file at much
higher offsets (`0x555`, `0x580`s, `0x64`s, `0x9`xx, `0xa`xx, `0xb`xx,
`0x10`xx...) with different embedded field values — consistent with the
same 9-byte-ish record shape being reused throughout the file for
per-location or per-node data, not just once at the top.

**HYPOTHESIS, not confirmed**: the `II` field cycling 0-7 is strongly
suggestive of an **8-directional adjacency/exit table** (N/NE/E/SE/S/SW/W/NW,
or similar) attached to a map node — i.e. evidence *consistent with* (not
proof of) the task brief's node/location-graph overworld hypothesis. The
byte `0x38` recurring as a leading tag across dozens of records throughout
the file, at widely varying offsets and with what look like different
"opcode-shaped" tags following it (`0x11`, `0x14`, `0x18`, `0x1a`, `0x19`,
`0x32`, `0x33`, `0x28`... seen at other `38`-prefixed record occurrences
later in the file) also raises the alternative reading that this is a
**small bytecode/event-script format** (the same broad category as this
project's already-solved Black Crypt `bcdfs` action-opcode records or Gold
Box's dungeon scripts) rather than a pure static map/graph — the two
readings are not mutually exclusive (a scripted node-transition table would
look like both at once). Settling this needs either the executable's own
consumer code for `CARTE.CO` (not yet traced) or enough of the file
manually decoded to see whether values plausibly index real screen/location
IDs. See `docs/ishar/TODO.md`.

### 3.3 Not yet decoded

The remaining ~28 KB of `CARTE.CO` beyond the sections above (from roughly
offset `0x1e0` onward, excluding the record runs found) has not been
walked byte-by-byte this pass.

### 3.4 Re-verified against the properly header-stripped decode

§3.1-3.2 above were originally derived from the **raw file bytes**, before
a bug was found and fixed in the stored-file (`classByte == 0x01`) path of
`tools/shared/ishar-decompress.ts` (it was returning the whole raw buffer,
container header included, as "content"). Re-checked this session against
the corrected decode (`build/cache/crystalsofarborea/amiga/decompressed/CARTE.bin`,
29,854 B = 29,860 - 6-byte header, confirming `isMain == false` for this
file): the §3.2 record array's marker byte-pair now lands at content offset
**42** exactly (`0x30` in the raw file minus the 6-byte header) —
`38 00 00 3a 1a 3c 1e 00 01`, `38 00 01 3a 1a 3c 1e 00 01`, ...,
`38 00 07 3a 1a 3c 1e 00 ff` (8 records, `II` incrementing 0-7 as before,
`ZZ = 0x3c`), then a second run starting `38 00 00 3a 1a 46 1e 00 ...`
(`ZZ = 0x46`) — byte-for-byte the same structure §3.2 already described,
just at the corrected offset. §3.1's name strings shift the same way
(`IRVAN`/`AKEER`/`OLBAR`/`THORM` now at content offsets 277/299/322/345).
**Conclusion: the header-skip fix does not change §3's analysis or its
open questions** — it was already reading the record array and name
strings correctly by coincidence of relative positioning; only absolute
offsets cited in this doc needed correcting, which is now done.

## 4. `MANUEL.CO`/`MESSAGE2.CO`/`MESSAGES.CO` — CONFIRMED via full decompression

The `0x81`-class RLE codec is now cracked corpus-wide
(`docs/ishar-container-format.md` §2.5); all 36 compressed `.CO` files
decode cleanly (`npm run crystalsofarborea:decompress`, 42/42 total
including the 6 already-stored files). Two files give the strongest content
confirmation found anywhere in this session's work on all four titles:

- **`MANUEL.CO`** decodes to a clean, fully readable English in-game manual
  table of contents: `INSTRUCTIONS`, `INTRODUCTION`, `THE HISTORY OF THE
  CRYSTAL WORLD`, `SELECTING A TEAM`, `CHARACTER RECORDS`, `THE MAIN ICON
  SCREEN`, `THE MAP`, `3D MODE`, `COMBAT`, `KEYBOARD AND JOYSTICK
  CONTROLS`, `RETURN TO GAME`. This directly confirms an earlier guessed role
  ("possibly a copy-protection screen", §5's file-role catalog) was wrong —
  it's a real in-game help/manual screen — and, more importantly for the task's core question,
  it independently corroborates that this engine has a distinct **"3D
  MODE"** (first-person dungeon/cave view) as a named, player-facing game
  mode separate from "THE MAP" (the overworld) — direct, in-game-text
  confirmation that the two view types the task asked about are real,
  distinct, named systems in this engine, not a modern RE-driven
  assumption.
- **`MESSAGE2.CO`** decodes to real NPC dialogue: `YOUR MAGICIAN IS
  ABSENT`, `I CANNOT TRUST YOU`, `GET OUT OF MY HOUSE,STRANGER`,
  `WELCOME,PRINCE OF THE ELVES,...IF YOU PASS THE KNOWLEDGE TEST,YOUR
  ...MAGICIAN WILL ACQUIRE CERT[AIN...]`.

See `public/assets/crystalsofarborea/amiga/data/text-strings.json` for the
full extracted-text corpus across all 42 files.

## 5. File-role catalog (STRUCTURAL/HYPOTHESIS — filename-based, French)

Not semantically decoded — a quick pass on filenames only, per the task's
priority (container format + map/dungeon question over exhaustive
cataloguing). All HYPOTHESIS confidence (plausible French-language reading
of the filename, not verified against content):

| File | Guessed role |
|---|---|
| `CARTE.CO` | Overworld travel/map screen — see §3, partially confirmed |
| `PLAGES.CO` | "beaches" — coastline overworld terrain (matches the brief's guess) |
| `NPLAINE.CO` | a plain/field overworld terrain variant |
| `ARBRE.CO` | "tree" — likely a landmark/forest object |
| `HABITAT.CO` / `GHABITAT.CO` | dwelling exterior (the `G`-prefixed pair pattern — a higher-color or alternate-palette variant — recurs across this corpus, e.g. `GEMECAV.CO`/`GEMEEXT.CO`) |
| `TOUR.CO` | "tower" — a landmark location |
| `PUIT.CO` | "well" — a landmark location |
| `INTMAIS.CO` | "intérieur maison" — house interior |
| `CAVINT.CO` | cave interior — first-person cave/dungeon view candidate |
| `SOLCAVE.CO` | cave floor/ground |
| `GEMECAV.CO` / `GEMEEXT.CO` | "gem cave" / "gem exterior" — a gem-related location, cave and outdoor variants |
| `COMBAT.CO` / `SCOMB.CO` | combat screen(s) |
| `DEATH.CO` | death/game-over screen |
| `LAFIN.CO` | "the end" — ending screen |
| `LOGO.CO` / `PRESENT.CO` | title/logo and presentation screens |
| `DEBUTER.CO` | "to start" — character creation/intro |
| `MANUEL.CO` | "manual" — CONFIRMED a real in-game help/manual screen (§4), not the copy-protection code-check screen this table originally guessed |
| `MESSAGE2.CO` / `MESSAGES.CO` | dialogue/message text |
| `OBJETS.CO` | "objects" — item/icon bank (see `docs/ishar-container-format.md` §5's correction: this is a normal compressed `.CO`, not a Targa image) |
| `ORC_ELF.CO` | orc/elf sprite bank |
| `SOURIS.CO` | "mouse" — mouse cursor sprite |
| `GUGUS.CO`, `SHAMNIR.CO`, `MORGOT.CO`, `NAD.CO`, `GERSOM.CO`, `EBRAIN.CO` | NPC/character names (candidates, cf. `CARTE.CO`'s `ZACH`/`IRVAN`/`AKEER`/`OLBAR`/`THORM`) |
| `CIELSOL.CO` | "sky/sun" — an outdoor sky backdrop element |
| `ECRAN.CO` / `ECRANS.CO` | "screen" / "screens" — possibly a screen-selection or palette table |
| `ENDIV.CO`, `HT.CO`, `EMOVE.CO` | unclear — not attempted |

## 6. Open items

See `docs/ishar/TODO.md` (single status surface for the whole Ishar-engine
family, covers this title too).

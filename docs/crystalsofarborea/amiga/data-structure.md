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

### 3.5 The 8-entry record array — RESOLVED: it is real ALIS bytecode, and it is NOT a destination/adjacency table

> **Correction (2026-09-01 session): §3.2's framing above was wrong on two
> counts.** The "38 00 II 3a 1a ZZ 1e 00 XX" pattern is not a static data
> record at all — it is genuine, executing ALIS bytecode (confirmed by a
> from-scratch mini interpreter covering exactly the opcodes/opernames/
> storenames involved, ported from `github.com/maestun/alis`'s `opcodes.c`/
> `opernames.c`/`storenames.c`) — and its content is not an 8-directional
> adjacency table but a **party-roster/companion-selection checklist**.

**Container-fixing prerequisite (a real, generalizable pipeline bug found
along the way)**: `tools/shared/silmarils-unpack.ts`'s `unpackSilmarilsScript()`
only recognized the two *compressed* packer kinds (`0x81`/`0x80`/`0xA1`) and
silently returned `null` for `classByte == 0x01` ("stored", §2.2) — which
meant the sprite-atlas batch pipeline (`ishar-sprite-atlas.ts`, built on this
function) silently skipped all 6 of Crystals' stored files, including
`CARTE.CO` itself, even though `ishar-decompress.ts` had its own,
separately-fixed stored-class path (§3.4). Fixed this session (added a
`PACKER_KIND_STORED = 0x01` branch that copies the post-header bytes
verbatim, no algorithm needed). Re-ran `npm run crystalsofarborea:sprites`:
33/42 files now produce a decodable sprite directory (up from 31/36, since 6
more files are now even attempted), 931 sprites (up from 905) — Ishar 1/2/3
re-run afterward for regression: identical counts (1608/2244/2744 sprites),
confirming the fix is purely additive (no Ishar 1-3 file uses the stored
class in the sampled corpus).

**`CARTE.bin`'s own sprite directory** (now reachable thanks to the fix
above): `findIsharDirectory()` resolves `dirOff=4832` (`0x12E0`),
`baseDelta=88` (one of the two corpus-wide constants, §7 of
`docs/ishar-sprite-format.md`), `length=31`; 25/31 slots decode to a valid
bitmap. The 7 largest (indices 5-11, heights 90-167px) form the overworld
**map picture** — visually confirmed (`public/assets/crystalsofarborea/amiga/sprites/carte.png`):
an unmistakable island/continent coastline silhouette (RENDERED, greyscale —
no AGA palette recovered, per `docs/ishar-sprite-format.md` §5). The
remaining ~18 slots are much smaller (16-64px wide, 1-38px tall) — plausibly
UI icon/glyph bitmaps, but their exact role (font glyphs vs. map markers vs.
checkbox states) is **not determined**; visual inspection alone is not
proof of semantic role (see `plausible-render-not-semantic-label.md`).

**The bytecode itself** (`CARTE.bin` content offset 42-183, verified via a
purpose-built mini interpreter, `/tmp` scratch script, not committed —
re-derivable directly from the trace below): one `cscmov` (0x38, "move
current screen", 6 bytes: `38 00 00 3a 1a 3c`) — reads `x=0` (`oimmb`),
`y=0` (unchanged, since the second opername is `ofin`/0x3a which never
touches the accumulator register `varD7`), `z=` the *first script-local
scratch array's own index-0 cell* (`odirtc` reading `tabchar(vram_org+0x3c)`
with `varD7==0` at that point) — followed by **15 `cstore` instructions**
(9 bytes each, `1e 00 <val> 38 00 <idx> 3a 1a <arrayOff>`), each of which:
pushes an immediate `val` onto the accumulator (`oimmb`), runs a nested
`oeval` loop that computes an index `idx` via a second `oimmb` (this becomes
the *live* `varD7` seen by the following store), then dispatches `sdirtc`
(storename `0x1a`) which computes `tabchar(vram_org+arrayOff) + varD7` (i.e.
`array[arrayOff][idx]`, exactly the same 1-D array-indexing convention
`tabchar()` uses for the already-solved `CONT*.FIC` region grid — see
`docs/ishar-container-format.md` §9.1) and stores the popped `val` there.
This walk **self-terminates exactly at the expected boundary**: byte 183
(right after the 15th store) is `0x94` (`cfindtyp`), an unrelated,
well-formed *different* top-level opcode — a strong, boundary-agnostic
forward-walk confirmation (Method §4) that this really is the intended
instruction stream, not a coincidental byte-pattern match.

**Net effect — CONFIRMED values** (two 8-element signed-byte scratch arrays
declared at this script's own vram offsets `0x3c` and `0x46`):

| index | 0x3c | 0x46 |
|---|---|---|
| 0 | *(read by `cscmov`, never explicitly written here — default, unconfirmed, assumed 0)* | -1 |
| 1 | 1 | -1 |
| 2 | 1 | 0 |
| 3 | 1 | 1 |
| 4 | 0 | 1 |
| 5 | -1 | 1 |
| 6 | -1 | 0 |
| 7 | -1 | -1 |

**The index order matches, exactly, 8 confirmed UI strings** found later in
the same file (content offsets 236-433, a plain printable-run scan):
`JON`(236) `ZACH`(256) `IRVAN`(277) `AKEER`(299) `OLBAR`(322) `THORM`(345)
`ALL`(368) `NONE`(389) — 8 strings, immediately followed by `MOVE`(411)
`EXIT`(433) action-button strings. This is a **genuine correction** to
§3.2's original "8-directional adjacency" hypothesis: the natural reading is
a **party-composition checklist** — the player character (JON) plus 5
recruitable companions (ZACH/IRVAN/AKEER/OLBAR/THORM), plus `ALL`/`NONE`
select-shortcut buttons, immediately followed by `MOVE` (confirm) and `EXIT`
(cancel). **STRUCTURAL, not fully CONFIRMED**: the count/order match is
exact and not cherry-picked, but which array means "currently selected" vs.
some other axis (e.g. "available/has joined yet") is HYPOTHESIS — the values
don't cleanly split into one all-boolean "selected" array (both arrays mix
-1/0/1 across all 8 rows, including the two non-checkbox `ALL`/`NONE` slots).

**A real consumer of both arrays exists later in the same file** (content
offsets ~3567-3767, found by searching for `1a 3c`/`1a 46` — the same
`sdirtc`/`odirtc` array-offset immediates — beyond the init block): an
interleaved run of reads from both arrays inside code built from `cftstset`
(0x56 — "hit-test setup": reads 5 opernames into `wcx`/`wcy`/`wcz`/`matmask`/
`wforme`, then calls `clipform()`+`crstent()`, the exact "forme"
collision-test mechanism `docs/ishar-sprite-format.md` §1 already named as
`adresform()`/`cforme`/`ctstmov`-family), `cboxf` (0x7c — fills a rectangle
at an accumulating draw position, i.e. a **checkbox/row highlight
drawer**), branch opcodes `cbz8`/`cbz24`/`cbeq24` (0x12/0x14/0x1a as
TOP-LEVEL opcodes here, not opernames — same byte values, different
dispatch table per file+line in `alis`'s own source, exactly the "same byte,
different table" convention `docs/ishar-container-format.md` §9's worked
GERDEP example already established), and — decisively — **`clive`** (0x40,
"load and run another script by a literal 16-bit id", `opcodes.c:1032`).
This is strong, converging (STRUCTURAL) evidence the screen supports
click-to-toggle interaction on the 8 rows and, on confirmation (`MOVE`),
**launches a different script by id** — consistent with `MOVE` starting the
actual travel/exploration script. **Not decoded**: which literal id(s)
`clive` loads here, and any per-location hotspot/placement table for a
"click a place on the map to go there" mechanic — no such table was found
this session; if it exists, it lives outside this traced 200-byte window.

**Answer to the task's core movement question**: Crystals of Arborea's
overworld screen (`CARTE.CO`) is **not** a WASD/grid-walked space and (so
far as decoded) **not** a literal destination-adjacency graph either — it is
a **mouse-driven party-roster/travel-confirmation UI** layered over a static
map picture. Combined with the confirmed total absence of any
`CONT*.FIC`-style region grid on disk (`ls data/crystalsofarborea/amiga/`
shows only `INIT.FIC`), this settles Priority 2 of the task brief: no
grid-walker `GameView` is appropriate for this title. A menu/checklist-style
`GameView` was built instead — see §7 below.

#### Paths tried (the 8-entry array's semantic role)

| Approach | Result | Why it stalled/succeeded |
|---|---|---|
| Naive fixed-9-byte-stride byte scan (§3.2, original pass) | Found the right byte region and the right `II` cycling-0-7 signal, but mis-paired which byte was "the value" vs. "the index" (conflated a coincidental byte value `0x38`/`0x00` that recurs inside every `cstore`'s own `seval`+`oimmb` sub-sequence with a second top-level `cscmov` instruction that doesn't actually recur) | A structural/statistical read with no VM semantics behind it — see `bytecode-residue-recurring-groups.md`-style pitfall: recurring byte groups in a real bytecode stream are not proof of a flat record array |
| Full VM-semantics mini interpreter (this session) | Solved: 1×`cscmov` + 15×`cstore`, self-terminating at the exact expected byte boundary, both arrays' real values recovered | Ported the *exact* byte-consumption rules for the handful of opcodes/opernames/storenames actually used, from `alis`'s real source, rather than guessing a fixed stride |
| Matching array values to the 8 confirmed UI strings | STRUCTURAL match on count+order (not values) — reframes "destinations" to "party roster" | The exact semantic split (which array = "selected") remains open — no further bytecode traced past the `clive` call |

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

## 5.5 Sprite/image pixel format — CONFIRMED

See `docs/ishar-sprite-format.md`. 33/42 files decode a valid resource
directory (up from 31/36 this session — the stored-class pipeline bug fixed
in §3.5 let 6 more files be attempted, including `CARTE.CO`), 931 sprites
total (up from 905) (`public/assets/crystalsofarborea/amiga/sprites/`) —
this title's corpus is dominated by the older raw-4-bit type (`0x00`/`0x02`,
no palette-bank byte), distinct from Ishar 1-3's dominant banked-4-bit type.
Visually confirmed via `orc_elf.png` (skeleton/humanoid figures), `arbre.png`
(tree/bush silhouettes), and `carte.png` (§3.5's map picture — a
recognizable island/coastline silhouette).

## 7. Walker `GameView` — `CrystalsOfArboreaView`

`tools/walker/games-crystalsofarborea.ts` implements the shared walker
harness's `GameView` interface for this title. Per §3.5's findings, this is
**not** a spatial walker (no grid, no first-person view, no automap) — it's
a menu/checklist screen reproducing `CARTE.CO`'s confirmed party-roster UI:

- Renders the confirmed map picture (§3.5, `carte.png`'s 7 largest strips,
  shelf-packed side by side) as a backdrop, greyscale (RENDERED, no AGA
  palette).
- Renders the 8 confirmed rows (`JON`/`ZACH`/`IRVAN`/`AKEER`/`OLBAR`/
  `THORM`/`ALL`/`NONE`) as togglable checkboxes seeded from the CONFIRMED
  `0x3c`-array values (§3.5's table; the one un-written index defaults to
  unchecked), plus `MOVE`/`EXIT` action rows.
- Keyboard (`W`/`S`/arrows` to move focus, `Space`/`Enter` to
  toggle/activate) and mouse (`pick()`) both drive the same toggle logic;
  `ALL`/`NONE` apply their real confirmed semantics (check/uncheck every
  companion row). `MOVE`/`EXIT` surface a status line explaining what's
  confirmed (a `clive` script-launch happens; the destination is not
  decoded) rather than silently no-op'ing.
- `pose`/`items`/`automap`/`palette` are all trivial/empty per the `GameView`
  contract — there is no spatial state to track for this screen.

Verified: `npx tsc --noEmit -p .` and `npx eslint` clean on the new file;
`npm test` (370 tests, whole repo) unaffected. Not verified in a live
browser session this pass (no amiberry/browser access used — static
type-checked + hand-traced against the confirmed bytecode/UI-string
evidence only).

## 8. Open items

See `docs/ishar/TODO.md` (single status surface for the whole Ishar-engine
family, covers this title too).

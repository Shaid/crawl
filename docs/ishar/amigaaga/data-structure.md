# Ishar: Legend of the Fortress (Silmarils, 1992, Amiga AGA) — data structure

`data/ishar/amigaaga/`, 110 files. **Container format is shared across the
whole Ishar-engine family** (Ishar 1/2/3 + prequel Crystals of Arborea) —
see `docs/ishar-container-format.md` for the header/compression evidence;
this doc covers what's specific to Ishar 1. Confidence vocabulary: CONFIRMED
(verified against an exact-equality invariant or code), STRUCTURAL (derived
from consistent byte-level evidence across the corpus, not yet
code-verified), HYPOTHESIS (plausible, weakly evidenced) — same convention
used in `docs/crystalsofarborea/amiga/data-structure.md`.

## 1. Executable

`T.X` (75,200 bytes, real AmigaOS hunk executable — see
`docs/ishar-container-format.md` §1 for hunk layout and string evidence).
Confirmed to be the game's main engine binary, and confirmed to open
`MAIN.DO`/`BLANC.SND` by name at startup.

## 2. Container inventory

`npx tsx tools/ishar/amigaaga/inventory.ts` scans `data/ishar/amigaaga/`
and writes `public/assets/ishar/amigaaga/data/container-inventory.json`.
110 files total: 98 `.DO` containers (97 `classByte=0xA1`, 1 `classByte=0x81`
— `MAIN.DO`, see `docs/ishar-container-format.md` §3), 12 non-container
files (`T.X`, `blanc.snd`, 6× `CONT<N>.FIC`, `EN1.FIC`, `TAB1.FIC`). Ratio
range 1.019-3.578, mean 1.880 (see the container-format doc's table).

All 98 `.DO` files parse cleanly under the shared header with no anomalies.

## 3. `MAP.DO` — DECOMPRESSED this session; content still open

The `0xA1` codec is now cracked corpus-wide (`docs/ishar-container-format.md`
§2.5) — `MAP.DO` (13,006 B on disk) decodes cleanly to 21,368 real bytes at
`build/cache/ishar/amigaaga/decompressed/MAP.bin` via
`npm run ishar:decompress`. Its byte histogram is dominated by two values
(`0x88` at 21%, `0x66` at 16.6% of the whole payload, 200 distinct byte
values total) — plausible for a tile-index raster with a dominant terrain
type, unlike the cave files (see §5) whose dominant byte is `0x00`
(padding/record-separator-shaped, not a raster). No dimension field or
tile-bank cross-reference has been confirmed yet; the overworld-mechanism
question (node-graph vs. tile grid) remains open at the pixel level, though
§5's shared-header finding and §4's editor-tool strings both point toward
a **hierarchical zone/region/country coordinate system populated with
discrete named location screens** rather than either a pure node-graph or
a single seamless tile grid.

Ishar 2 and 3 both also ship a `MAP.DO` (71,800 B and 40,214 B on disk
respectively — much larger than Ishar 1's, consistent with larger/more
detailed overworlds in the sequels); both decode cleanly with the same
codec (see `docs/ishar2/amigaaga/data-structure.md`,
`docs/ishar3/amigaaga/data-structure.md`) but their content is likewise not
yet semantically decoded.

## 4. `MAIN.DO` — confirmed master resource manifest, now with real content

See `docs/ishar-container-format.md` §3 — `MAIN.DO` contains readable
`.AO`-suffixed filenames matching Ishar 1's own `.DO` files one-to-one
(modulo extension/case), confirming it's the game's resource-load table,
not a graphics/map asset itself despite carrying the same container header.

Full decode this session (`public/assets/ishar/amigaaga/data/text-strings.json`,
key `"MAIN.DO"`) adds substantial new content beyond the extension mapping:

- **Every outdoor location and cave name** appears as a graphics reference
  (`village.AO`, `ville.AO`, `rampart.AO`, `temple.AO`, `plaine.AO`,
  `foret.AO`, `mcave.AO`, `pcave.AO`, `scave.AO`, `fcave.AO`, `fcave2.AO`,
  `colcave.AO`, `incave.AO`, `fontaine.AO`, `lacustre.AO`, `arbre.AO`) —
  confirms §6.1/§6.2's filename-based catalog directly from the game's own
  manifest, not just inference.
- **A full 30-name monster roster** (`orc`, `bormin`, `kiriela`, `loup`,
  `azal`, `wardog`, `barbare`, `stel`, `predator`, `naim`, `fragorn`,
  `dealer`, `minotor`, `momo`, `sorcier`, `wiz1`/`en1`, `morgu`, `krog`,
  `darkm`, `darkwiz`, `spider`, `zombi`, `dwarrior`, `geant`, `skelet`,
  `spectre`, `dragon`, `medus`, `goul`, `gaz`, `knight`) confirms §6.4's
  catalog and gives real recurrence-frequency evidence for a per-encounter
  resource-list structure (the same handful of names — `orc`, `barbare`,
  `stel`, `dealer` — repeat across many manifest positions).
- **Debug/level-editor strings** — `POSITION X :`, `POSITION Y :`, `NUMERO
  DE CONTREE ?` ("country number"), `NUMERO DE REGION ?`, `NUMERO DE ZONE
  ?`, `EDITER TABLEAU ?` ("edit table?"), `tableau.AO`. These look like an
  in-house level-editor/debug tool embedded in (or adjacent to) `MAIN.DO`'s
  script, and are the strongest single piece of evidence found this
  session on the overworld's real coordinate model: the world is addressed
  hierarchically as **country -> region -> zone -> (X, Y)**, not a single
  flat coordinate space and not a pure node-graph with no positions at all.
  HYPOTHESIS pending disassembly of what reads these fields, but a strong
  one — see `docs/ishar/TODO.md`.
- Localization/UI strings confirming the base/D/E/I suffix convention
  (§6.5) applies engine-wide, not just to `MESSAGE`/`TEXTIN`/`SOS`:
  `1 - ENGLISH` / `2 - FRANCAIS` / `3 - DEUTSCH` / `4 - ITALIANO`, `DISK A`/
  `B`/`C`/`D` (confirms a multi-floppy release), `CONT1.FIC`-`CONT6.FIC`
  and `EN1.FIC`/`TAB1.FIC` (matches the `.FIC` files on disk, §5 of
  `docs/ishar-container-format.md`).

`SOS.DO` (localized error/prompt script) independently confirms the
original 5-extension-per-location scheme referenced in `MAIN.DO`:
`foret.io`/`foret.co`/`foret.fo`/`foret.do`/`foret.ao` and
`main.io`/`main.co`/`main.fo`/`main.do`/`main.ao` appear as a literal
sequence — see `docs/ishar-container-format.md` §3 for the conclusion this
supports (extension collapse in the AGA re-release).

## 5. A shared scene/resource header beneath `MAP.DO`, the cave files, and outdoor graphics — STRUCTURAL

Decompressing `MAP.DO`, every `*CAVE*.DO` file, and several outdoor
location/monster graphics (`ORC.DO`, `VILLAGE.DO`, `TEMPLE.DO`,
`RAMPART.DO`, `WARDOG.DO`) shows they **all open with the identical
16-byte header shape** `00 XX 1c 00 00 16 00 00 00 00 00 00 00 YY 00 00`
(bytes at offset 2 and 5 constant in every file checked) — see
`docs/ishar-container-format.md` §6 for the full evidence table and the
cross-title confirmation (Ishar 2's `DJ*.DO` dungeon files share the same
shape). This is the single strongest lead this session found on the task's
central dungeon-view question: it argues the engine uses one generic
scene/resource descriptor format for outdoor maps, cave interiors, *and*
graphics banks alike, with the actual rendering mode selected by context
external to this header (most likely `MAIN.DO`'s own script/bytecode) —
not a dedicated tile-grid format for `MAP.DO` and a separate compositor
format for the caves. STRUCTURAL confidence; not traced in disassembly
this session.

## 6. File-role catalog (STRUCTURAL/HYPOTHESIS — filename-based, cross-checked against §4's manifest content)

Not semantically decoded (no pixel/table content extracted yet, pending
compression) — a filename/French-language pass, useful for cataloguing and
for confirming the overworld/dungeon split the task asked about:

### 6.1 Outdoor / overworld candidates
`PLAINE.DO`, `RPLAINE.DO` (plain — "R" prefix likely a variant, e.g. a
different time of day or region), `FORET.DO` ("forest" — the largest
"outdoor" file at 33,496 B), `VILLAGE.DO`, `VILLE.DO`, `INVILLE.DO` ("in
ville" — inside the town), `FVILLE.DO` ("façade ville" — town exterior
view), `LACUSTRE.DO` ("lake-side"), `RAMPART.DO` (fortress rampart — ties
directly to the game's subtitle "Legend of the Fortress"), `FONTAINE.DO`
(fountain), `FRISE.DO` (frieze/decorative border), `FOND.DO` (background),
`FBOISHAR.DO`/`FBUIS.DO` ("bois" = woods/forest — `FBOISHAR` likely "forest
of Ishar", 123,686 B, the single largest `.DO` file in the whole corpus —
consistent with a big outdoor set-piece image or a tiled overworld terrain
bank).

### 6.2 First-person cave/dungeon view candidates
`MCAVE.DO` (50,290 B — by far the largest of the cave files, a strong
candidate for the actual first-person wall/frustum tile bank), `PCAVE.DO`,
`FCAVE.DO`, `FCAVE2.DO`, `SCAVE.DO`, `INCAVE.DO` ("in cave" — cave
interior), `COLCAVE.DO` ("colonne cave" — a cave with columns, or a
specific cave room). The `M`/`P`/`F`/`S`/`IN`/`COL` prefix family strongly
suggests a single **cave-view rendering system with several named views or
distance bands** (echoing this project's other games' per-depth wall-slice
compositing, e.g. Black Crypt/Gold Box), consistent with the task's "is
there a wall-tile/view-compositor mechanism" question — but no pixel data
has been decoded yet to confirm the actual mechanism.

### 6.3 Buildings / interiors
`INTMAIS.DO` (house interior, 33,368 B), `ITAVERNE.DO`/`TAVERNE.DO`
(tavern, interior + presumably exterior/sign), `TEMPLE.DO`/`FTEMPLE.DO`
(temple + façade), `MARCHAND.DO` (merchant/shop).

### 6.4 Monster/NPC sprite candidates (largest single group)
`AZAL`, `BARBARE` ("barbarian"), `BORMIN`, `DARKM` ("dark m[age?]"),
`DARKWIZ` ("dark wizard"), `DRAGON`, `DWARRIOR` ("d[ark] warrior"),
`FRAGORN`, `GAZ`, `GEANT` ("giant"), `GOUL` ("ghoul"), `KIRIELA`, `KNIGHT`,
`KROG`, `LOUP` ("wolf"), `MEDUS` ("medusa"), `MINOTOR` ("minotaur"), `MOMO`,
`MORGU`, `NAIM`, `ORC`, `PABO`, `PREDATOR`, `SKELET` ("skeleton"),
`SORCIER` ("sorcerer"), `SPECTRE`, `SPIDER`, `STEL`, `WARDOG`, `WIZ1`
("wizard"), `ZOMBI` ("zombie") — all `.DO` (28 files). `DEALER.DO` is
likely an NPC merchant portrait rather than a monster. `KROG`/`DARKM` etc.
recur repeatedly inside `MAIN.DO`'s readable filename list (§4), consistent
with per-scene monster-encounter resource lists.

### 6.5 UI / text / localization
A clean 4-way suffix pattern recurs three times — **base (French) / D
(Deutsch) / E (English) / I (Italian)** — a STRUCTURAL finding (the same
suffix convention across three unrelated base names is unlikely to be
coincidence):
- `MESSAGE.DO` / `MESSAGED.DO` / `MESSAGEE.DO` / `MESSAGEI.DO`
- `TEXTIN.DO` / `TEXTIND.DO` / `TEXTINE.DO` / `TEXTINI.DO`
- `SOS.DO` / `SOSD.DO` / `SOSE.DO` / `SOSI.DO`

Also: `AFFOBJ.DO` ("afficher objet" — display/show object, likely the
item-display UI panel), `OBJET.DO`/`OBJINT.DO` (object bank + "object
interior"?), `SOURIS.DO` (mouse cursor), `PARAM.DO` (parameters/config
table — note its ratio outlier, 3.578, the highest of any Ishar 1 file,
consistent with small highly-redundant numeric-table content compressing
unusually well), `BUSTE.DO` (character portrait/bust, 25,870 B),
`ENCONT.DO` ("encounter", small — 1,040 B), `TELEP.DO` ("téléporter" —
teleport), `STAGE.DO` (unclear — possibly level/stage select), `AUTEUR.DO`
("author" — credits screen, note the `0x81`-class ratio anomaly discussed
in `docs/ishar-container-format.md` §2.3), `DEAD.DO`/`THEEND.DO`
(game-over / ending sequences), `PRESEN.DO`/`PRESON.DO`/`PRESTI.DO`
(presentation/title-sequence variants), `KNIGHT.DO`/`SAMB.DO`/`SAUB.DO`/
`GERDEP.DO`/`GEREN.DO`/`DPLT.DO`/`EN1.DO`/`SCOMB.DO` (uncategorized).

## 7. Open items

See `docs/ishar/TODO.md` (single status surface for the whole Ishar-engine
family).

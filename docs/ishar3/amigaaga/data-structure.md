# Ishar 3: The Seven Gates of Infinity (Silmarils, 1994, Amiga AGA) — data structure

`data/ishar3/amigaaga/`, 148 files. **Container format shared with Ishar
1/2 and Crystals of Arborea** — see `docs/ishar-container-format.md`; this
doc covers only what's specific to Ishar 3. First pass, lower depth than
Ishar 1.

`data/ishar3/amiga/` (note: `amiga`, not `amigaaga`) exists but is
**completely empty** — checked directly (`ls -la`, 0 entries besides `.`/
`..`). Not a populated second platform variant; likely an unused
placeholder directory from data staging. Not pursued further per the task
brief.

## 1. Executable

`START` (97,072 bytes) — same role as Ishar 1/2's `T.X` (real AmigaOS hunk
executable, `HUNK_HEADER` magic at offset 0), just under a different name.
The largest of the trilogy's main binaries, consistent with Ishar 3 being
the most feature-rich entry. Not disassembled this pass.

## 2. Container inventory

`npx tsx tools/ishar3/amigaaga/inventory.ts` → 148 files: 136 `.DO`
containers, **all** `classByte=0xA1` (0 files use `0x81` in this title,
including `MAIN.DO` itself — a change from Ishar 1/2 where `MAIN.DO`
specifically used `0x81`; see `docs/ishar-container-format.md` §2.3), 12
non-container files (`START`, `blanc.snd`, 6× `CONT<N>-3.FIC`, `EN1.FIC`,
`RAZ.FIC`, `INIT.FIC`, `INITPV.FIC`). Ratio range 1.058-**9.140** (by far
the widest range of any title — one file compresses to roughly 1/9th its
original size, worth a closer look once the codec is cracked), mean 2.636.
Same shared `0xA1` codec table as Ishar 1/2.

The file corpus here shows a much larger, more elaborate location set than
Ishar 1/2: a full town simulation (`VBANK.DO`, `VCASINO.DO`,
`VPERSO1.DO`-`VPERSO5.DO`, `VHOUSE1.DO`-`VHOUSE3.DO`, `VTHEATRE.DO`,
`VJARDIN.DO` — bank, casino, 5 named persons/portraits, 3 houses, theatre,
garden), a 4-level dungeon (`DJ1.DO`-`DJ4.DO`, `FDJ1.DO`-`FDJ4.DO`,
`DJLAVE.DO`/`FDJLAVE.DO` — a lava dungeon level), and several full
cutscene-scale files (`INTRO1.DO` 128,970 B, `INTRO3.DO` 221,916 B —
the single largest file in the whole four-title corpus, `INTRO4.DO`
173,156 B, `THEFIN.DO` 213,926 B, `DEAD.DO` 144,730 B) consistent with a
much bigger production than Ishar 1.

## 3. Compression cracked; MAIN.DO carries the same level-editor strings as Ishar 1/2

The `0xA1` codec is confirmed corpus-wide (`docs/ishar-container-format.md`
§2.5) — `npm run ishar3:decompress` decodes 136/136 `.DO` files cleanly.

`MAIN.DO`'s decoded content (280 printable-text runs,
`public/assets/ishar3/amigaaga/data/text-strings.json`) includes its own
`.AO` resource manifest (`messageu.AO`, `logo.AO`, `souris.AO`,
`buste.AO`/`buste2.AO`, `objet.AO`, `fville.AO`, `fjungle.AO`) and, most
notably, the **near-verbatim same embedded level-editor/debug strings**
found in Ishar 1's and Ishar 2's `MAIN.DO`: `POSITION X :`, `POSITION Y :`,
`NUMERO DE CONTREE ?`, `NUMERO DE ZONE ?`, `NUMERO DE CODE ?`, `EDITER
TABLEAU ?`. Three-title agreement on identical wording is strong,
code-independent evidence that this hierarchical country/zone/(code)/X/Y
addressing scheme (and the debug tool that edits it) is a genuine, stable
engine-wide feature carried across the whole trilogy, not an Ishar-1-only
artifact — see `docs/ishar/TODO.md`'s `ishar-overworld-representation` row.

## 4. Open items

See `docs/ishar/TODO.md`.

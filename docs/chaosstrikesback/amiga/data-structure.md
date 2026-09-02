# Chaos Strikes Back (Amiga) — data structure

FTL Games, 1990 (Dungeon Master expansion; this corpus: the Amiga release).
Source: 3 ADF disk images in `data/_unexplored_/ChaosStrikesBack/`
(`disk.1`, `disk.2`, `Disk.3`), extracted by
`tools/chaosstrikesback/amiga/extract-adf.ts` into
`data/chaosstrikesback/amiga/{disk1,disk2,disk3}/`.

Shared container/codec formats are documented once in
[`docs/dungeonmaster-format.md`](../../dungeonmaster-format.md) — this file
covers what's specific to CSB.

Shared code: `tools/shared/dungeonmaster-{container,codec,dungeon,render}.ts`.
Extractor: `tools/chaosstrikesback/amiga/export-data.ts`.

## Disk images

All 3 confirmed real AmigaDOS 880 KB floppies (`DOS` bootblock magic +
`OFS`/`FFS` flags byte — `adfBootblockType()`
from `@seer-project/amiga`).

- **disk1**: main game data (`Dungeon.DAT` = Prison, `Graphics.DAT`, etc.)
- **disk2**: `MINI.DAT` (a saved-game file embedding CSB's real 11-map
  dungeon — see below) plus other save/support files
- **disk3**: a real but **blank/formatted** disk — 0 files walkable via the
  AmigaDOS root directory. This matches its companion filename in the
  original corpus tree, `EnglishUtilityDisk.info` (an icon file for an empty
  utility disk), and isn't a dump error — `listAdf()` returns a valid, empty
  root directory rather than failing or reporting a corrupt filesystem.

### A real bug found and fixed along the way

Extracting disk1's `Graphics.DAT` (435,397 bytes) initially only recovered
plausible image content for its first ~26 items (~30 KB) before every
subsequent item decoded as an all-zero-header non-image. The shared
`@seer-project/amiga` ADF reader's `readAdfFile()` followed a file's
extension-block ("file list") chain using a strict `type === T_HEADER(2)`
gate, but AmigaDOS extension blocks carry primary type `T_LIST(16)`, not
`T_HEADER` — so any file needing more than one header block's 72-entry
data-pointer table (roughly >35 KB on OFS) was silently truncated to its
first block's worth of data, zero-padded past that. Fixed upstream in
`~/Development/seer/packages/amiga/src/adf.ts` (new `validChainBlock()`
accepting both `T_HEADER` and `T_LIST`, used only in the file-read chain
loop — directory-hash-chain walking, which never encounters `T_LIST`
blocks, is untouched), with a new regression test (a synthetic 90,000-byte
/ 3-extension-block fixture) added to that package's own test suite. This
bug would have silently corrupted extraction of **any** file over ~35 KB on
an OFS Amiga disk in **any** project using this shared package, not just
this one. After the fix, `disk1/Graphics.DAT` (and other previously-
truncated large files: `KAOS.FTL`, `ANIM.DAT`, `NAKED.AMG`, `HCSB.HTC`) all
show clean/minimal trailing-zero padding consistent with normal end-of-file
slack, not truncation — confirmed by `disk1/Graphics.DAT`'s `IMG1` decode
going from 23/683 to **683/683** clean items.

## Dungeon files

**Prison** (`disk1/Dungeon.DAT`): stored compressed (`0x8104`), 2 maps.
Decompresses to exactly the declared `uncompressedSize`, parses cleanly.

**Main CSB dungeon** (11 maps): CSB does not ship a standalone
`Dungeon.DAT`-equivalent for this on Amiga — it's embedded, uncompressed, in
`disk2/MINI.DAT`'s saved-game envelope (per the "Saved Game Files" community
docs). Located via `findDungeonDataOffsets()` (pattern scan, not a
hardcoded offset — see the shared doc for the 5-check scan and how it
narrowed 97 false positives down to exactly 1 real match): **offset
10098**. The extractor asserts exactly one match and throws otherwise, so
this stays a verified invariant on every run rather than a one-off finding.

Exported: `public/assets/chaosstrikesback/amiga/data/dungeon-{prison,csb}.json`,
top-down PNGs under `public/assets/chaosstrikesback/amiga/screens/
{prison,csb}-mapNN-lvlL.png` (13 PNGs: 2 Prison + 11 CSB). **Rendered**:
visually coherent mazes for both, same evidence class as DM1.

## `disk1/Graphics.DAT`

`DMCSB2` container (`0x8001` signature, 749 total items) — the **same**
container variant as DM1's own `Graphics.DAT` (not a CSB-specific format;
an earlier pass of this doc wrongly assumed DM1 used the plainer,
signature-less `DMCSB1` shape — see `docs/dungeonmaster-format.md`'s
correction note). 683 of the 749 items are image-shaped candidates — same
count as DM1's `Graphics.DAT`. `IMG1` codec (confirmed byte-identical
algorithm to DM1's — no CSB-specific codec differences found).
**683/683** image-shaped items decode with 0 residue. Exported the same way
as DM1's atlas:
`public/assets/chaosstrikesback/amiga/sprites/graphics-sample.png` (400-item
sample) + `.json` sidecar. Visually the same class of unmistakably-real
content as DM1's atlas (largely overlapping/shared asset base, as expected
for a direct expansion).

## TODO

See `docs/chaosstrikesback/TODO.md`.

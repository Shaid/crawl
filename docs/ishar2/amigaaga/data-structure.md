# Ishar 2: Messengers of Doom (Silmarils, 1993, Amiga AGA) — data structure

`data/ishar2/amigaaga/`, 150 files. **Container format shared with Ishar
1/3 and Crystals of Arborea** — see `docs/ishar-container-format.md`; this
doc covers only what's specific to Ishar 2. First pass, lower depth than
Ishar 1 (see `docs/ishar/TODO.md` for what's left).

## 1. Executable

`T.X` (78,320 bytes, real AmigaOS hunk executable, `HUNK_HEADER` magic at
offset 0). **Confirmed NOT byte-identical to Ishar 1's `T.X`** (`cmp`
reports the first difference at byte 23) — a distinct binary per title, not
a shared/copied file, though presumably a close revision of the same
engine given the identical container format and codec table (§2). Not
disassembled this pass.

## 2. Container inventory

`npx tsx tools/ishar2/amigaaga/inventory.ts` → 150 files: 137 `.DO`
containers (136 `classByte=0xA1`, 1 `classByte=0x81` — `MAIN.DO`), 13
non-container files (`T.X`, `blanc.snd`, `system-configuration`, 7×
`CONT<N>.FIC`, `EN1.FIC`, `PRESENT.FIC`, `RAZ.FIC`). Ratio range
1.039-3.718, mean 2.063. Same `0xA1` 10-byte codec table
(`00 01 0B 09 0A 0B 07 05 06 07`) as Ishar 1 and 3 — direct evidence of a
shared/unchanged compression codec across the trilogy (see
`docs/ishar-container-format.md` §2.3).

Notably `MAP.DO` here is 71,800 B on disk (vs. Ishar 1's 13,006 B) — a much
larger overworld, consistent with Ishar 2's known larger game world
(introducing sailing/ship travel per the subtitle "Messengers of Doom").
`BOAT.DO` (23,148 B) is a new file not present in Ishar 1, consistent with
this. A `DJ1.DO`/`DJ2.DO` pair (dungeon 1/2, "donjon") plus
`DJCAT.DO`/`DJCOL.DO`/`DJDEC.DO`/`DJFONT.DO`/`DJTRAP.DO` (dungeon
catacombs/columns/decorations/font/traps) is new here too — a much more
developed first-person-dungeon file family than Ishar 1's simpler
`*CAVE.DO` set, suggesting Ishar 2 introduced proper multi-level dungeons
alongside the original cave/overworld structure. Unlike `MAIN.DO`'s
readable behavior in Ishar 1, `strings` on Ishar 2's `MAIN.DO` returns
almost nothing filename-shaped — open, see `docs/ishar-container-format.md`
§3.

## 3. Compression cracked; DJ*.DO dungeon files share Ishar 1's scene-header shape

The `0xA1`/`0x81` codecs are confirmed corpus-wide (`docs/ishar-container-format.md`
§2.5) — `npm run ishar2:decompress` decodes all 137/137 `.DO` files cleanly
to `build/cache/ishar2/amigaaga/decompressed/*.bin`.

**Cross-title structural finding**: `DJ1.DO`, `DJ2.DO`, `DJCAT.DO`,
`DJCOL.DO`, `DJDEC.DO`, `DJTRAP.DO`, `FDJ1.DO`, and `FDJCAT.DO` all
decompress to payloads opening with the **identical 16-byte header shape**
found in Ishar 1's `MAP.DO`/`*CAVE*.DO` files
(`00 XX 1c 00 00 16 00 00 00 00 00 00 00 00 00 00`, bytes at offset 2 and 5
constant) — see `docs/ishar-container-format.md` §6 for the full
cross-title table. This is strong evidence the whole engine family (not
just Ishar 1) uses one shared, generic scene/resource descriptor for both
overworld/cave and dedicated-dungeon content, rather than a format that
changed between Ishar 1's simpler caves and Ishar 2's more elaborate
multi-level dungeons. The `XX` byte at offset 1 takes consecutive values
across this file cluster (`0x5b`-`0x5f`, `0x6a`-`0x6c`) matching their
apparent catalog/load order — consistent with a resource-index field.

**Correction to the first-pass note above** (which said `strings` on Ishar
2's `MAIN.DO` found nothing filename-shaped): that was checked against the
raw, still-compressed bytes. With real decompression now applied, Ishar 2's
`MAIN.DO` is just as readable as Ishar 1's — 285 printable-text runs
(`public/assets/ishar2/amigaaga/data/text-strings.json`), including its own
`.AO` filename manifest (`messagee.AO`, `logo.AO`, `souris.AO`,
`objet.AO`, monster names `ork5.AO`/`skelett5.AO`/`sorcier5.AO`,
`pcave.AO`) and, importantly, its **own copy of the same level-editor debug
strings** found in Ishar 1's `MAIN.DO`: `POSITION X :`, `POSITION Y :`,
`NUMERO DE CONTREE ?`, `NUMERO DE ZONE ?`, `NUMERO DE CODE ?` ("code
number" — a variant of Ishar 1's "NUMERO DE REGION ?"), `EDITER TABLEAU ?`.
This is a genuine cross-title confirmation (found independently in two
different games' `MAIN.DO`) that strengthens the hierarchical
country/zone/(code)/X/Y coordinate-model hypothesis for the overworld —
see `docs/ishar/TODO.md`'s `ishar-overworld-representation` row.

## 3.5 Sprite/image pixel format — CONFIRMED

See `docs/ishar-sprite-format.md`. 119/137 files decode a valid resource
directory, 2,244 sprites total (`public/assets/ishar2/amigaaga/sprites/`).

## 4. Open items

See `docs/ishar/TODO.md`.

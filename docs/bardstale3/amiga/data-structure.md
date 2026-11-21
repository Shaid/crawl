# Bard's Tale III: Thief of Fate (Amiga)

Source: `data/_unexplored_/BardsTale3/` — a WHDLoad dump (`BardsTale3.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTale3.slave`'s embedded WHDLoad header text reads `Bard's Tale 3:
Thief of Fate` (`strings -n 4 BardsTale3.slave`) — confirmed as game 3, not
assumed from the directory name.

## 1. File inventory

```
BardsTale3.slave           WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution / Spells   WHDLoad-extracted reference text (no format work needed)
data/driver                 68k executable/overlay, not yet disassembled
data/all.pic                "animated picture" bank — CONFIRMED, see §2
data/bard3                  palette source for all.pic (id-remap + palette tables) — CONFIRMED, see §2
data/D0WAL.GRP, GDUNG.GRP, SKARA.GRP, WILDWAL.GRP
                             LE u16 offset directory (D0WAL: 7 entries, 14..8864), records start
                             with magic RAW\x18 — NOT yet decoded
data/maps.hi, maps.lo       71 records of [u32 size][stock LZHUF] (decodes, 71/71); record = 16-byte
                             name + w/h + word-offset table; cell format NOT yet decoded
data/monsterh, monsterl     NOT graphics: no size header, 41 record spans all multiples of 48 =
                             raw 48-byte monster stat records with high-bit ASCII names
                             (the "try unpackBard3" premise is retracted; the earlier planar sweep
                             failing was correct)
data/icons.bin               unidentified, not yet investigated
data/title, titlescreen, victory, finalBardscreen
                             confirmed (via container triage) to be real IFF ILBM screens —
                             trivially decodable with @seer-project/iff, NOT yet done this session
data/game.sav, parties.inf, thieves.inf, inventor.stf, Some.stuff
                             save/state-shaped files — out of scope (save-file-not-asset.md)
data/fonts/bards.font, data/libs/*
                             standard Amiga system font/libraries, not game-specific
```

## 2. `all.pic` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` §2 (sentinel-
terminated directory) + §6 (LZ77+adaptive-Huffman codec) + §6.1 (palette
via `bard3`'s id-remap table).

- **85 real pictures** (indices 0-84), directory sentinel at entry **85**
  == file length (526,002 bytes) exactly.
  > **Correction (2026-11-18):** this previously said 84 pictures and that
  > slot 84 "fails to decode". It decodes fine; the failure was our decoder
  > throwing on LZHUF's one-byte bit-buffer read-ahead past EOF (fixed). See
  > bardstale-picture-format.md §5.
- Every record decompresses to exactly 19712 bytes = 4 x 4928-byte chunky
  112x88 4bpp sub-frames — confirmed zero-deviation across all 85 records.
- All 85 x 4 = 340 sub-frame cells resolved a palette via `bard3`'s id-remap
  table (all 85 indices present once; 3 `0xFF` rows = no picture). The old
  "0 misses" metric was circular (see picture-format §6.1).

Verification: all 340 sub-frame cells render as recognizable,
non-degenerate monster/character/scene art (campfire scene with hooded
figures, orcs, wolves, gargoyles, sharks, an octopus, a mind-flayer-like
creature, a minotaur, a tree, warrior women, skeletons, robots, a giant
bloodshot eye, a demon) with visible small frame-to-frame variation within
each picture's 4 sub-frames (consistent with real animation content, e.g.
campfire flame flicker) — see
`public/assets/bardstale3/amiga/sprites/pics.png`.

Extractor: `tools/bardstale3/amiga/export-data.ts` (`npx tsx
tools/bardstale3/amiga/export-data.ts`).

## 3. Maps and wall art (2026-11-21, walker attempt -- partial)

### `maps.hi` / `maps.lo` container (confirmed)
u32BE directory of record offsets (entry 0 = directory length, so 37 / 36 entries; last entry = file length), each
record `[u32 BE decodedSize][Okumura LZHUF stream]` (N=4096 spaces-filled, F=60, THRESHOLD=2; a fresh decoder,
`tools/bardstale3/amiga/lzhuf.ts`). **71/71 records decode and the stream consumes exactly `span - 3` bytes
(= span - 4 + 1 read-ahead byte) for every record** -- the same invariant the picture codec shows; a decoder started
one byte late breaks it (null control in `tools/walker/__tests__/bardstale3-maps.test.ts`). Extractor:
`tools/bardstale3/amiga/export-maps.ts` -> `data/maps.json`. (The earlier "71 records of `[u32 size][LZHUF]`" scan treated
the files as a flat sequence; they have the directory above.)

### Decoded record
16-byte high-bit ASCII name (`0xff` padded: "Lucencia", "Wilderness", "Tower", "Cyanis' Tower"), then two families:
| Family | Maps | Layout |
|---|---|---|
| **grid** (10: Lucencia, Celaria Bree, Nowhere, Dark Copse, Black Scar in `hi`; Wilderness, Skara Brae, Arboria, Ciera Brannia, Gelidia in `lo`) | cities/overland, 11..20 square | `[0x10]=w [0x11]=h`, 2 flag bytes (`0x9f 0x11` ...), `(h+2)` u16BE words (word 0 unresolved; words 1..h = row start - 1, rows listed last to first), then **h rows of w cell bytes at `0x14 + 2(h+2)`** (Lucencia: 12x12 at 0x30), then a tail of 3-5-byte records (events/specials, unresolved) |
| **dungeon** (61) | towers, tombs, mountains, catacombs ... one record per level | `[0x10]` = size-1 (0x13 = 20 wide), `[0x11]` = level index 0..3, link bytes (`03 04 05 06 ff ff ff ff ...`), a u16BE word table with only ~7 entries stepping 0x19, then a compact (RLE/sparse?) cell stream -- **not decoded** |
Cell bytes of the grid family (Lucencia): `00` open (90 of 144), `e3` (37) / `e2` (7) wall-like blocks, `f8`, `f1`, `f2`, `04`, `0f` singletons
(specials). **Hypothesis**: a cell is either a solid block or open (the BT3 city/wild maps are not per-face like BT1/BT2);
no consumer in `driver` was traced, orientation (row order, which edge is north) is unconfirmed, so no walker was built.

### `.GRP` wall art (container confirmed, 32/32 non-empty records)
LE u16 offset directory (entry 0 = directory length), record = `"RAW"`, `w` px (1 byte), `00 00 00 00`, `bytesPerRow` u16BE (= w/2),
`h` (1 byte), key colour (1 byte = 5), `bytesPerRow*h` **chunky 4bpp** bytes (high nibble first), 1 trailing byte; span =
`12 + bpr*h + 1` for every non-empty record (`decodeGrp` throws otherwise). Entry sizes alternate: **24x97 side-wall** and
**64x55 front-wall** (`D0WAL` 7 records, `SKARA` 8, `GDUNG` 10 incl. two 112x44/112x45 pieces = floor/ceiling halves?, `WILDWAL` 11 incl.
4 empty 22-byte placeholders and one 65x55). Greyscale render of `D0WAL` records 0/1 shows a skewed side wall and a flagstone front wall,
i.e. the decode is right; **palette not located** (bard3's picture palettes are for `all.pic`; the dungeon/wild palette source is
unknown) and the which-record-is-which-depth mapping is not traced (needs `driver`). `data/grp-wall-art.json` holds raw indices.

### Why there is no BT3 walker yet
Missing, in order: (1) the cell semantics of the grid family and the whole dungeon-record layout (a `driver` trace of the
map-load + move routine), (2) the palette for the wall art, (3) the view geometry / record-to-depth mapping. Smallest next step:
disassemble `driver`'s map loader (search for the `maps.hi`/`maps.lo` open + LZHUF call) and follow the buffer to the move routine.

## 4. Open

See `docs/bardstale3/TODO.md`.

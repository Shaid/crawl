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

## 3. Open

See `docs/bardstale3/TODO.md`.

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
                             likely first-person wall/dungeon-view graphics — NOT yet investigated
data/maps.hi, maps.lo       same u32BE[N+1]-directory container convention as all.pic
                             (confirmed structurally); content NOT yet decoded — likely dungeon/level data
data/monsterh, monsterl     same container convention; content NOT yet decoded — an earlier
                             raw-planar/chunky hypothesis (seer-probe gfx sweep, best score 0.68/1.0,
                             visually noise) failed BEFORE this session's LZHUF codec was known;
                             not yet re-attempted with unpackBard3
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

- **84 real pictures** (indices 0-83), directory sentinel at entry **85**
  (not 84 — corrected mid-session, see bardstale-picture-format.md's
  correction block) == file length (526,002 bytes) exactly. A distinct
  85th directory slot (index 84) exists between the last real picture and
  the sentinel but fails to decode — open, see TODO.
- Every record decompresses to exactly 19712 bytes = 4 x 4928-byte chunky
  112x88 4bpp sub-frames — confirmed zero-deviation across all 84 records.
- All 84 x 4 = 336 sub-frame cells resolved a real (non-fallback) palette
  via `bard3`'s id-remap table (0 misses).

Verification: all 336 sub-frame cells render as recognizable,
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

# The Bard's Tale: Tales of the Unknown (Amiga)

Source: `data/_unexplored_/BardsTaleNTSC/` — a WHDLoad dump (`BardsTaleNTSC.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTaleNTSC.slave`'s embedded WHDLoad header text reads `The Bard's
Tale: Tales of the Unknown` (`strings -n 4 BardsTaleNTSC.slave`) — confirmed
as game 1, not assumed from the directory name.

## 1. File inventory

```
BardsTaleNTSC.slave        WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution WHDLoad-extracted reference text (no format work needed)
data/bardstale, data/bardstale.dat, data/c/*   68k executable + overlay-ish files, not yet disassembled
data/bards_data/pics       "animated picture" bank — CONFIRMED, see §2
data/bards_data/big_city, big_dung, dung_blank, bard_screen, control_panel, icon0-4
                            likely other screen/UI graphics banks, not yet investigated
data/bards_data/levs       likely dungeon/maze level data, not yet investigated
data/bards_data/chant, drums, harp, panflu, trumpet
                            almost certainly audio/instrument data (thematic — Bard's Tale's bard-song
                            mechanic), not yet investigated
data/members/*             character save-file-shaped data (`TPW.*`), out of scope per
                            save-file-not-asset.md — these are player state, not shipped assets
data/fonts/narrow.font, data/libs/diskfont.library
                            standard Amiga system font/library, not game-specific
```

## 2. `pics` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` (shared across all
3 games) §3.1 (BT1-specific RLE step) + §4 (Huffman) + §5 (BT1 has **55**
real pictures, indices 0-54, no placeholder slots).

Verification: all 55 render as recognizable, non-degenerate character
portraits and monster art (warrior in armor, paladin with sword/robes,
skeleton, various monsters, a castle/gate scene, an "Interplay
Productions" splash panel) — see
`public/assets/bardstale1/amiga/sprites/pics.png`.

Extractor: `tools/bardstale1/amiga/export-data.ts` (`npx tsx
tools/bardstale1/amiga/export-data.ts`).

## 3. Open

See `docs/bardstale1/TODO.md`.

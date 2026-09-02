# Bard's Tale II: The Destiny Knight (Amiga)

Source: `data/_unexplored_/BardsTale2/` — a WHDLoad dump (`BardsTale2.slave`
+ `data/`). First-contact investigation, 2026-09-02.

## 0. Identity (confirmed)

`BardsTale2.slave`'s embedded WHDLoad header text reads `Bard's Tale 2: The
Destiny Knight` (`strings -n 4 BardsTale2.slave`) — confirmed as game 2, not
assumed from the directory name.

## 1. File inventory

```
BardsTale2.slave           WHDLoad slave (identity oracle, §0)
Manual / ReadMe / Solution WHDLoad-extracted reference text (no format work needed)
data/bard                  68k executable, not yet disassembled
data/bs.anm                unidentified, name suggests animation, not yet investigated
data/bards_data/pics       "animated picture" bank — CONFIRMED, see §2
data/bards_data/wpics      a SECOND, differently-named picture-like file — NOT yet
                            investigated (possibly a wilderness/overland variant, unconfirmed)
data/bards_data/big_city, big_dung, dung_blank, bard_screen
                            likely other screen/UI graphics banks, not yet investigated
data/bards_data/levs       likely dungeon/maze level data, not yet investigated
data/bards_data/citys, ic  unidentified, not yet investigated
data/bards_data/chant, drums, harp, panflu, trumpet
                            almost certainly audio/instrument data, not yet investigated
data/title                 unidentified, name suggests a title screen, not yet investigated
data/members/*             character save-file-shaped data — out of scope (save-file-not-asset.md)
data/fonts/narrow.font, data/libs/diskfont.library
                            standard Amiga system font/library, not game-specific
```

## 2. `pics` — animated picture bank (CONFIRMED, rendered)

Full byte-level spec: `docs/bardstale-picture-format.md` §3.2 (BT2-specific
bit-transpose+XOR steps) + §4 (Huffman) + §5 (BT2 has 64 directory slots,
**61 real pictures** — indices 0-63 minus 3 confirmed placeholder/sentinel
slots at 25, 30, 52).

Verification: all 61 render as recognizable, non-degenerate character
portraits and monster art (a Conan-style barbarian, a knight/paladin, a
"Garth's" shop sign, gates/dungeon doors, a second "Interplay Productions"
splash panel) — see `public/assets/bardstale2/amiga/sprites/pics.png`.

Extractor: `tools/bardstale2/amiga/export-data.ts` (`npx tsx
tools/bardstale2/amiga/export-data.ts`).

## 3. Open

See `docs/bardstale2/TODO.md`.

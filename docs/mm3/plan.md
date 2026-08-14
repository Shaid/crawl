# Might & Magic III: Isles of Terra — RE pipeline

## Status (2026-08-12)

Might & Magic III (New World Computing, 1991; Amiga port 1992) was added to
the crawl repo as `data/mm3/{amiga,dosvga}/`. This pass reverse-engineered
**both data containers** (the DOS `MM3.CC` archive and the Amiga `.cc`
files), the **Amiga LZ77 codec** and the **DOS LZHUF codec** (byte-exact
against the reference C++), the filename hashes, and the shared
Xeen-style **sprite container** structure. Extracted, named assets and
verified tables are published to `public/assets/mm3/{amiga,dosvga}/`.

Formats, evidence and open items: see
- `amiga/data-structure.md`
- `dosvga/data-structure.md`
- `TODO.md` (open-work index)

The game is registered in `src/game-id.ts` and
`tools/shared/game-config.ts` (`mm3`, platforms `amiga` + `dosvga`,
`supported: false` — container extraction is committed, browser rendering
is not yet wired).

## Extractors

| Script | Purpose |
|--------|---------|
| `scripts/mm3lib/dos_cc.py` | DOS MM3.CC container reader: encrypted TOC, Xeen filename hash, LZHUF (byte-exact vs rewolf-mm3-dumper) |
| `scripts/mm3lib/amiga_cc.py` | Amiga .cc container reader: 10-byte directory, amiga filename hash, LZ77 (port of the game's own routine) |
| `scripts/extract_mm3_dos.py` | DOS: 558 entries → `public/assets/mm3/dosvga/` (files/, audio WAV, monster-stats.json, maze-text.json, sprites.json, cc-directory.json) |
| `scripts/extract_mm3_amiga.py` | Amiga: 553 entries → `public/assets/mm3/amiga/` (files/, cc-directory.json) |

Run from the repo root: `python3 scripts/extract_mm3_dos.py` and
`python3 scripts/extract_mm3_amiga.py`.

## Continuation pass (2026-08-13, after mm2/w6 viewer work)

- **Amiga sprite cell format — SOLVED** (`mm3-amiga-sprite-rle` closed):
  the container (`u16 frameCount + frameCount×{u32 cellA, u32 cellB}`, cell
  `{u16 x,y,w,h}` + body) and the body are confirmed **extension-
  independent**. The body is a literal/skip record stream —
  `[count u16][count×u16]` literal runs + `[marker u16]` skip words
  (`(~marker)&0xffff` zeros in dest; 0xffff = terminator) — decoding to
  exactly `6·w·ceil(h/16)` u16 words: plane 0 = 1-bit mask, planes 1-5 =
  5-bit colour, column-major within each plane (pixel (x,y) = word
  x·ceil(h/16)+y//16, bit 15-(y%16)). frame N = cellA OR cellB (the
  per-frame overlay). The decode loop is the game's own root CODE
  (`code1.bin+0x209E`/`+0x20C2`), found via amiga-disasm escalation and
  independently re-verified. **Verified: 1811/1811 frames byte-exact;
  466/466 monster frames coherent (archer = head/bow/bowstring/torso/legs,
  spider = body+8 legs from cellA|cellB, demon = wings/claws animating);
  0 mask-vs-PNG mismatches across all 1,380 rendered frames.** All 350
  pictures render (126 monsters + 115 pics + 42 icons + 31 faces + 36
  outs). Extractor: `scripts/mm3lib/amiga_sprite.py` +
  `scripts/extract_mm3_amiga_sprites.py` →
  `public/assets/mm3/amiga/sprites/{monsters,pics,icons,faces,outs}/`
  (PNG strips + JSON with AtlasMeta frames + base64 mask/colour).
  The old ".fac/.out raw planes, .mon/.icn/.pic token encoding" split is
  retracted (raw-plane .fac decode was coincidentally coherent; the true
  record-stream decode works on every extension).
- **mm3 viewer wired (amiga + dosvga)** — both platforms are now
  `supported: true` in `tools/shared/game-config.ts` with `buildAssets`
  hooks that run the Python extractors (`extract_mm3_amiga.py` +
  `extract_mm3_amiga_sprites.py` / `extract_mm3_dos.py` +
  `extract_mm3_dos_screens.py` + `extract_mm3_dos_sprites.py`) and merge
  the manifests through the shared TS helpers. `npm run extract-data --
  game mm3` (per platform) works end-to-end. Live-verified with
  Playwright: mm3/amiga = 279 assets (252 sprite strips + 13 screens + 10
  palettes + 4 data tables), 0 console errors; `spider.mon`/`demon.mon`/
  `archer.mon` render on canvas with 12k+ opaque px at 3× zoom.
  `data/cc-directory` table renders. Amiga screens render with the
  confirmed palette (`mm3-amiga-palette` closed). DOS side: sprites +
  screens + palette are now all solved and wired (`mm3-dos-palette`,
  `mm3-mon-rle`, `mm3-dos-sprite-pipeline` all closed) — manifest grows to
  421 entries, spot-checked correct (`create.raw` teal marble, `archer.mon`
  plausible pixel counts) — but not yet live-verified in a browser with
  Playwright the way the Amiga side was; see TODO `mm3-wire-viewer`.
- **Amiga LZ77 oracle — CLOSED** (`mm3-amiga-lz-oracle`): the game's own
  decompressor (CODE payload 0x55C4) now runs under musashi in
  `tools/mm3_lz_harness/emu_lz.c`; **552/552 LZ entries decode
  byte-identical to the Python port** (0 mismatches, 0 non-returns). The
  ring's sign-extended `.w` indexing (negative half = caller stack below
  the frame) is documented in the harness header.
- **Amiga palette — SOLVED** (`mm3-amiga-palette` closed): the game palette
  is static 0RGB at main-exe DATA+0x4A62, byte-identical (32/32 words) to
  intro-exe DATA+0x0FB6. Code-confirmed install chain: seg 11 init copies
  the 32 words into the runtime table `A4-0x12DC` (seg 11 `0x26/0x30/0x34`),
  LoadRGB4 installs it as screen colours (seg 1 `0x9304`). Plus 5 credits
  palettes (main DATA+0x48E0..0x49E0) and 3 intro palettes
  (intro DATA+0x0EC2/0x0F02/0x0F42). `scripts/extract_mm3_amiga_screens.py`
  writes `palettes/*.json` + renders all 13 screens to `screens/*.png`
  (viewer: 279 assets, live-verified). Retracted: the earlier
  "runtime-loaded from .vga/.clp" reading (only the copy into BSS + the
  AllocMem viewport structs are runtime) and `palette-candidates.json`.
- `.maz` framing documented; `.dat` tables confirmed at 90 values each.

## Key facts

- **DOS data file** `MM3.CC` (3.4 MB) = encrypted Xeen-style CC archive:
  `u16 LE numEntries` + 8-byte entries (XOR cipher, key 0xAC += 0x67),
  LZHUF-compressed streams (per-stream dictionary init byte = most-common
  byte). 558 entries, 541 named from the community filename list
  (rewolf-mm3-dumper); 556/556 compressed entries decode byte-exact vs the
  compiled reference.
- **Amiga data files** `game.cc`/`global.cc`/`intro.cc`/`mm3-01..05.cc` =
  `u16 BE count` + count × `{u16 key, u32 offset, u32 size}` (10-byte
  entries), each entry `u32 size-8 | u32 decsize | LZ77 (exactly size-8
  bytes)`. The LZ77 (ring 4096 init 0x20, flag-byte bitstream, absolute
  12-bit ring positions, length nibble+3) is a faithful port of the game's
  own routine (CODE hunk payload 0x55C4). **Verified byte-exact against the
  game's own code under musashi: 552/552 entries, 0 mismatches**
  (`tools/mm3_lz_harness/emu_lz.c`). 553/553 entries across the 8
  files, zero deviation.
- **Filename hashes**: DOS `rotl16(h,9)+upper(c)`; Amiga
  `fold16(rotl32(h,5)+upper(c))`. Verified: 541/558 DOS names, 420/449
  Amiga keys resolve to real filenames.
- **Sprite container** (DOS `.vga/.mon/.fac/.icn/.pic/.out/.til/.brd/.sky`):
  `u16 frameCount` + frameCount × `{u16 cell1, u16 cell2}` + cells
  `{u16 xoff, u16 w, u16 yoff, u16 h}` + scanline RLE. **Fully solved**
  (`mm3-mon-rle` closed) — the opcode grammar is a simple 3-command
  scheme (literal/skip/run), *not* the MM4/5 Xeen grammar as earlier
  assumed; found by disassembling the game's own blitter in the `MM3.CC`
  `vga` display driver. Verified 157,330/157,330 lines and 3,823/3,823
  cells exact across all 402 sprite-container files, 0 deviation
  (`scripts/mm3lib/dos_sprite.py`, `scripts/verify_mm3_dos_sprites.py`).
- **Screens**: DOS `.raw` = 320×200 raw 8-bit VGA (no palette in file);
  Amiga 40000-byte screens = 320×200 5-plane planar (tmp.scr is a saved
  screen) — rendered with the confirmed static Amiga palette
  (`mm3-amiga-palette` closed). DOS screens now render too, with the
  confirmed 256-colour VGA palette (`mm3-dos-palette` closed) —
  `scripts/extract_mm3_dos_screens.py`, all 12 `.raw` files.
- **Maze (wall-layout) records — SOLVED** (`mm3-cur-format` closed): the
  dungeon/town wall data lives in `MM3.CUR` (the "current game" archive,
  not the read-only `MM3.CC` — the game mutates and saves it), 240/240
  entries named. `maze<N>.dat` (105, 832 B raw) = 16x16 wall grid (4
  nibbles per cell = N/E/S/W, each 3-bit graphic index + 1 blocking bit)
  + 16x16 cell grid + a fully code-cited 64-byte trailer (neighbour maze
  ids, run position, 256-bit seen bitmap). `maze<N>.bin`/`.evt` add
  object/monster placement and event scripts. Outdoor mazes (41-64) are a
  separate terrain-layer encoding sharing the same word. Verified against
  two independent shipped-art oracles: the World Map poster (outdoor
  sections match section-for-section) and the Castle Blackwind route map
  (108/109 arrows legal on maze33 vs a 31.4% corpus mean). Wired into
  `scripts/extract_mm3_dos_mazes.py` -> `tools/shared/game-config.ts`;
  not yet consumed by a walker (`mm3-maze-viewer` open).

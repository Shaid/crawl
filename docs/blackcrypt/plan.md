# Black Crypt — Reverse Engineering Plan

## Current Status

### What We Know

Black Crypt (1992, Attention to Detail / Psygnosis) is a first-person dungeon
crawler for Amiga (EHB, 64 colors) and DOS (VGA, 256 colors). The Amiga version
spans 3 floppy disks with 26 `bcdf*` data files, 4 executable overlays, and a
main executable.

#### Fully Decoded

- **bcdfs**: Dungeon map format — 13 maps with interleaved entity data (items,
  monsters, structures, actions). Cross-validated against DOS `maindung.gam`.
- **bcdfa**: **BCSPEED effect animations** — a *mixed* container, not a flat run of
  RLE streams. `.GFK` sprites **solved and confirmed**; `.PRG` sizing confirmed.
  Format and verification: `amiga/data-structure.md` → "bcdfa — BCSPEED Effect
  Animations". Everything the old blind stream split said about bcdfa (887 streams,
  stream 407, streams 708–739, streams 0–1 viewport masks, 7 PRG action types) is
  superseded there.
  - Each stream = one "actor" (monster) with animation sequences
  - **NOT item tile data** — the old 64×24 extraction assumption was wrong
- **bcdfx/bcdfy/bcdfz**: the three dungeon tilesets — **SOLVED**. Each is a bare
  concatenation of chunks whose directory lives in the decompressed `bcdft` S_1
  image (12 chunks for bcdfx/bcdfz, 7 for bcdfy), summing to the file size
  exactly, 3/3. Every chunk is a *sequence* of independent sub-images described
  by blit-descriptor tables in `bcdft`'s own graphics kernel. **83 named
  sub-images in bcdfx/bcdfz, 46 in bcdfy; 205,602 of 205,922 decompressed bytes
  assigned with zero overlap** (one 320-byte tail open). Do not RLE-scan these
  files — five chunks per file are stored uncompressed, which is what produced
  every wrong payload table in this document's history. See the format spec.
  **Level assignment confirmed** (`bcdft` S_1 `+0x1A5CC`, hardcoded level-range
  dispatch on a runtime-patched `"bcdf?"` filename template): **bcdfx = levels
  1-4 and 12-13, bcdfy = level 5 only, bcdfz = levels 6-11**. Cross-referenced
  with the per-level accent-ramp table this gives **bcdfy → ramp 1 (violet),
  bcdfz → ramp 2 (bone/cream), bcdfx → ramp 0 (levels 1-4) / ramp 3 (levels
  12-13)** — see the spec's "Dungeon tileset selection".
- **bcdfo**: UI/chrome graphics — face tiles, blit descriptors.
- **bcdfq**: Overlay with 81.7 KB CHIP data — embedded MMD0 music, 8SVX sounds,
  palette variants, game text.
- **bcdfu**: The **endgame/epilogue sequence player** (its CODE hunk is a
  complete standalone program: 10 narrative screens + credits, then `RTS`).
  Also carries 3 MMD0 modules, 8SVX sound effects, the **RLE decompressor** at
  LAB_0043, and **5 palette records** — which are the *epilogue screens'*
  palettes, i.e. copies of entries 0–4 of the real 12-entry dungeon accent-ramp
  table in `bcdft`. See the spec's "Dungeon accent-ramp selection".
- **bcdfv**: **Solved.** The endgame/epilogue sequence data for `bcdfu` — 16
  sequentially-read blocks (congratulations screen, picture frame, 8×8 font,
  ten 160×99×6bpp narrated panels, Black Crypt facade intact + destroyed,
  240×153 1bpp credits). No monster sprites and no sound in it, despite years
  of notes saying otherwise. Spec + evidence in the data-structure doc's
  "bcdfv" section; extractor `scripts/extract_bcdfv.py`.
- **clipper.clp** (DOS): Resource archive — 816 entries (751 images, 7 palettes,
  22 sounds). Format fully decoded. Image categorization corrected: the 505
  previously-unnamed images dumped into one generic "misc" bucket are mostly
  real, identifiable content (180 more item icons, 73 spell-effect icons,
  19 chest-armor icons) — see `docs/blackcrypt/dos/data-structure.md`'s "Item
  icons and other unnamed entries" section. DOS now has **247** item icons
  total (48 named + 180 + 19; the 19 were briefly split out as a separate
  "heraldry" bucket before being corrected to chest armor and folded into
  `items` — there is no `heraldry` category in the current output), a
  count-plausible match for the Amiga `bcdft` item-name table's 254 distinct
  names (not an index-verified 1:1 mapping — see the same doc's Amiga
  cross-reference section). **Update:** the Amiga side is now index-verified
  from the other direction — `bcdfs` records reference names by byte offset
  into `bcdft` S_1 `+0x1C4E2` and carry the `gfxNumber` that selects the icon,
  so icon ↔ name is resolved (256 distinct names in use across 685
  placements). See `amiga/data-structure.md` § "Icon → item-name linkage".
- **maindung.gam** (DOS): Dungeon data — identical structure to Amiga `bcdfs`,
  differing only in endianness.

- **bcdfb–bcdfn**: Monster sprite files — **SOLVED**, see
  `docs/blackcrypt/amiga/data-structure.md` for the full format. 13 files with
  12-byte headers and 42×28-byte directory entries; entries sharing `data_off`
  are a normal/mirrored pair of the *same* image, not sub-frames (an earlier
  even-height-split theory was wrong). 7 sequential bitplanes per sprite
  (plane 0 = mask, planes 1–6 = 6bpp EHB colour). The root cause of the
  earlier "vertically scrambled" renders was a decode-offset bug — the RLE
  stream starts at byte 1402, not immediately after the directory at 0x4A4 —
  not a bitplane ordering problem. `scripts/extract_monsters.py` is the
  canonical extractor: **204 sprites**, byte-exact across all 13 files, 0
  unknown palette indices. Output: `public/assets/blackcrypt/amiga/sprites/monsters.*`.
- **bcdfr**: 4 full-screen images with per-screen BPP, sized by bcdfq chunk readers:
  Raven logo (4bpp, 320×200, 32KB), Title screen (6bpp, 320×200, 48KB),
  BC logo banner (6bpp, 320×44, 10,560B), Plot text (6bpp, 320×200, 48KB).
  Sequential planar, per-screen BPP, confirmed clean — no ghosting.
- **bcdfw**: Workbench drawer icon (457 B, `0xE3100001`).
- **configuration.dat**: 8 bytes — `MLONF_` + `0x0100`.
- **bcdfb–bcdfn trailing data**: a fixed **1932-byte** wall-decoration block
  (3 decorations × 3 view sizes, 16×20 / 16×15 / 16×11, mask+6bpp EHB)
  followed by a **raw signed-8-bit PCM monster sound bank** running to EOF.
  (Corrected in place — twice: "692 standalone 1bpp icons", then "92 7-plane
  icons"; both swept the PCM bank up as pixels. Sound confirmed byte-exact
  against DOS `clipper.clp`. See `docs/blackcrypt/amiga/data-structure.md`'s
  "Trailing Data — Wall Decorations + Monster Sound Bank" section.)
  `scripts/extract_bcdfbn_decor.py`.

#### Undecoded

- **bcdfq appended data**: 81,908 B of CHIP-resident data after the HUNK code.
  **Correction:** this is *not* read via a "self-reading mechanism" — that
  theory is retracted (see `docs/blackcrypt/amiga/data-structure.md`'s
  "bcdfq self-reading mechanism — RETRACTED" section: the only filename
  string bcdfq ever opens is `"bcdfr"`, confirmed by `strings`). The appended
  data is ordinary memory-resident overlay data (music/palettes), directly
  addressable once `LoadSeg()` loads it — no re-Open() involved. Front-facing
  wall tiles are **not** here; see the corrected Open Question #3 below.
- **P1 (42,754 B)**: Background/fill data — not a standard image dimension at any
  bpp. Contains 256 unique byte values.

### Key Discovery: RLE Decompression

Found in `bcdfu.asm` at LAB_0043 (line 643). Shared across bcdfv, bcdfx, bcdfy,
bcdfz.

```
Control byte:
  0x00      → end of stream
  bit0 = 1  → literal copy: copy (byte >> 1) bytes
  bit0 = 0  → RLE fill: repeat next byte (byte >> 1) times
```

Max 127 bytes per command. Stream-oriented, no block boundaries.

### Key Discovery: bcdfa is a mixed container, not a stream run

Splitting bcdfa into RLE streams from offset 0 is wrong and produced a long chain of
bogus findings. Blocks must be located by their marker strings; some are compressed
and some are stored raw. See `amiga/data-structure.md` → "bcdfa — BCSPEED Effect
Animations" for the layout, the corrections, and the verification numbers.

### Key Discovery: the container directory is in the executable

The chunk table for each tileset lives in the decompressed `bcdft` S_1 image
(`+0x1DE10` / `+0x1DE5A` / `+0x1DE86`), not in the file: three big-endian words
per entry — size, compressed flag, destination `d16(A5)` slot — terminated by a
zero size. Reading through it gives 100 % byte coverage of all three files and
makes the old "payload boundary" tables obsolete. The full per-slot sub-image
inventory is in `data-structure.md`'s bcdfx/y/z section; it is not restated
here.

#### Remaining Data (post-payload)

- **bcdfx** (31,867 B): 125 × `00100800` copper MOVE pairs to COLOR00, plus
  `18ff05f7` patterns. Likely copper list or display configuration data.
- **bcdfz** (51,274 B): No copper pairs. Contains ramp patterns
  (`ffffffe0`, `07ffffff`, `fffffff0`). Different data structure.
- **bcdfy** (116,818 B): 102 × `00100800` copper MOVE pairs. Mostly ramp
  patterns with `fff00fff` repeating. Template/placeholder data.
  > **Correction:** this treated almost the whole file as one undifferentiated
  > "remaining/post-payload" blob of raw bytes. It's actually 178 separate RLE
  > streams (same codec as bcdfx/bcdfz), two of which decode to a confirmed
  > third dungeon tileset — see the bcdfy note above and
  > `data-structure.md`'s "bcdfy — a third, partial tileset" section. The
  > `00100800`/`fff00fff` byte patterns quoted here are almost certainly
  > uninterpreted RLE control-byte/fill-value pairs, not raw copper/ramp data.

### Disk Layout (Confirmed)

| Disk 1 (GAMEDISK1:) | Disk 2 (GAMEDISK2:) | Disk 3 (GAMEDISK3:) |
|----------------------|----------------------|----------------------|
| bcdfa, bcdfo | bcdfb, bcdfc, bcdfd | bcdff, bcdfg, bcdfh |
| bcdfp, bcdfq | bcdfe, bcdfm, bcdfn | bcdfi, bcdfj, bcdfk |
| bcdfr, bcdfs, bcdft | bcdfu, bcdfv, bcdfx | bcdfl, bcdfy, bcdfz |
| bcdfw (icon) | — | — |

### Questions Log

Historical record of questions asked and answered during this project.
**Current open work lives in `docs/blackcrypt/TODO.md`, not here** — this
section only keeps the resolved narrative for context.

1. ~~**What is P0's exact purpose?**~~ **SOLVED.** P0 is slot `$08` in the
   in-executable chunk directory — perspective **side walls**, 4 depths ×
   left/right pair, 7-plane masked, 14,448 B. Widths (16/32/16/16) sum to 80,
   max height 140, matching the DOS port's `Wall Left`/`Wall Right` at 80×140
   exactly. See `data-structure.md`'s "bcdfx / bcdfy / bcdfz" section.
2. ~~**What is P1's role?**~~ **SOLVED.** P1 is slot `$0C` — **doors**: 2 leaf
   types × 3 depths plus 7 door-way frames, 42,754 B, all chained back-to-back
   with zero gaps. Not a colour ramp or palette table.
3. ~~**Where are the front-facing wall tiles?**~~ **SOLVED.** Not small
   repeating tiles — whole per-depth wall bitmaps (Wall 0/1/2 at 176/112/64 px,
   plus Ceiling and Floor) inside slot `$B0` of the same chunk directory. The
   two retracted leads below (bcdfq self-read, the chargen "Tile Table") were
   both dead ends on the way to this; the real answer came from an
   in-executable chunk directory the game itself uses to load bcdfx/y/z,
   cross-checked against the DOS port's named dimension manifest. See
   `data-structure.md`'s "bcdfx / bcdfy / bcdfz" section for the full 83-entry
   sub-image table (bcdfx/bcdfz) / 46-entry table (bcdfy).
4. ~~**How are bcdfb–bcdfn loaded at runtime?**~~ **Answered.** They are the 13
   dungeon level graphic stores, opened by name from the decompressed `bcdft`
   image via the patched `"bcdf?"` template (S_1 `+0x21E7E`) — nothing to do
   with bcdfv.
   Directory format: 12-byte header + 42 × 28-byte entries. RLE decompression
   produces 204 sprites, byte-exact, across all 13 files — see
   `docs/blackcrypt/amiga/data-structure.md`.
5. ~~**What do the +0C/+0E fields in monster directory entries represent?**~~
   **SOLVED.** +0C = BLTSIZE = (height << 6) | (width/16 + 1). +0E = screen
   modulo. Both confirmed correct. The BLTSIZE width field encodes width in
   words, not pixels.
6. ~~**What do the BCSPEED.PRG tag bytes (0x40/0x44/0xFF/0x3C) mean, and how
   does a script bind to a GFK record?**~~ **Mostly solved.** The old "7
   action types" answer was an artefact of RLE-decoding an uncompressed
   block — those values were record counts. Record *sizing* is confirmed
   (33/33 gaps exact). The GFK-linkage half is now **fully answered**: a
   script binds to a GFK record per-particle, via BCSPEED.EFF (see item 7
   below) — not a static table. Tag bytes `0x3C`/`0x40`/`0x44` are confirmed
   to be byte offsets into a jump table; `0x3C` is the end/kill case. The
   individual `0x40`/`0x44` handlers are still open — see `TODO.md`
   (`bcdfa-prg-handlers`).
7. ~~**What is in the rest of bcdfa (0x00000–0x0DFFA, 0x10779–0x1AE6F, 0x1B5B4–end)?**~~
   **SOLVED — bcdfa has a full 13-entry container directory, just like
   bcdfx/y/z.** `OpenBcdfaFile` at decompressed `bcdft` S_1 `+0x1DBD2` (found
   and disassembly-confirmed with r2, structurally identical to
   `OpenTilesetFile` at `+0x1DD16`) reads a 13-entry directory at S_1
   `+0x1DC54` — the same 3-word (size, compressed, A5-slot) shape as
   bcdfx/y/z's, summing to bcdfa's exact 197,894-byte file size, zero
   deviation. This closes the long-standing "bcdfa has no known loader" gap
   in one shot: 10 of the 13 entries land byte-exact on already-confirmed
   banks (UI panel, paperdoll, sound bank, GFK, PRG, both item-icon banks,
   floor items, chest armour), and it retroactively fixes a wrong hand-check
   that had flagged chest armour's size as "inconsistent" (a one-entry
   cumulative-offset arithmetic slip — armour is directory entry 10, not 9).
   Of the three remaining entries: **entry 4** (`0x10779`, 4,288 B decoded)
   is a **confirmed** 128-glyph 8x8 1bpp message-log font (consumer code
   traced at S_1 `+0x1F3D2`) plus a 136-glyph second alphabet that renders
   legibly but has no traced consumer (rendered, not confirmed); **entry 5**
   (`0x111E1`, 34,340 B, slot `0xB4`) is a large multi-purpose UI/text
   resource bank with 10+ distinct consumer call sites found across S_1 —
   real, but not yet broken into individual sub-records; **entry 6**
   (`0x15F8D`, 20,195 B) is directory-confirmed **raw, not RLE** — which is
   exactly why every earlier attempt to RLE-decode it desynced into
   fragments — is now **SOLVED as BCSPEED.EFF**: 95 effect particle-emitter
   scripts, the third BCSPEED bank, tying the already-confirmed GFK sprites
   to the already-confirmed PRG movement scripts. Cracked via a
   `re-codebreaker` escalation (consumer code traced at S_1 `+0x25536`/
   `+0x25624`), then **independently re-verified from scratch** by the
   orchestrating session (fresh r2 disassembly matching instruction-for-
   instruction, a from-scratch blind parser reproducing the in-executable
   95-entry offset table byte-exact with zero unaccounted bytes, and a DOS
   `clipper.clp` byte-identical cross-check via this project's own parser)
   before being promoted to a committed extractor:
   `bclib.bcdfa.eff_scripts`, `scripts/extract_bcdfa_eff.py` →
   `public/assets/blackcrypt/amiga/data/bcspeed-effects.json`. The
   `0x300C2`–EOF tail (entry 12, 1,092 B) is also directory-confirmed raw,
   not RLE, and shares the same small-integer profile as entry 6 did before
   it was solved — still unidentified, but now with a clear playbook (DOS
   catalog byte-signature search; widen the consumer-code census to
   `MOVE.L $34(A5),Dn`, since the address-register-only scan is exactly
   what produced entry 6's initial false "no consumer" negative). See
   `data-structure.md`'s "bcdfa — Container Directory" and "bcdfa —
   BCSPEED.EFF" sections for the full 13-entry table, the loader trace, and
   per-entry status. Remaining open sub-items (entry 5, entry 12, the
   second font alphabet, EFF's spell-mapping and render-motion follow-ups)
   are tracked individually in `docs/blackcrypt/TODO.md`, not here.

---

## Plan Going Forward

### Phase 1: Visual Identification of Payloads (COMPLETE)

**Goal:** Determine what each RLE payload in bcdfx/bcdfz contains.

**Results:**
- P2 confirmed as 208×356 @ 6bpp floor/ceiling atlas ✓
- P4/P5 confirmed as 80×193 @ 6bpp wall side textures ✓
- P3 confirmed as 320×269 viewport mask ✓
- P0 identified as depth shading lookup table ✓
- bcdfa confirmed as BCSPEED sprite animation archive ✓ (NOT item tiles)
- P1 remains partially unidentified (background/fill data)
- P6 (bcdfx only) is all 0xFF fill
- P7/P8/P9 (bcdfx only) are small data blocks

All 751 Windows VGA images extracted from clipper.clp. EHB palette rendering confirmed
correct for bcdfo portraits and bcdfa icon tiles.

### Phase 2: Data Format Analysis (Mostly Complete)

**Goal:** Understand the internal structure of each payload and post-payload data.

**Completed:**
- P2 confirmed as 208×356 @ 6bpp floor/ceiling atlas ✓
- P4/P5 confirmed as 80×193 @ 6bpp wall side textures ✓
- P3 confirmed as 320×269 viewport mask ✓
- P0 identified as depth shading lookup table ✓
- bcdfa confirmed as BCSPEED sprite animation archive ✓ (NOT item tiles)
- bcdfr confirmed as 4 mixed-BPP screens (chunk reader sizes) ✓
- bcdfo confirmed: **36** portraits (corrected from an earlier 109-tile
  miscount — see data-structure.md's bcdfo section) + UI elements at
  descriptor offsets ✓
- Palettes mapped: 3 contiguous tables in bcdfq at file offsets 0x266 (raven,
  16-color), 0x286 (title, 32-color), 0x2C6 (game, 32-color) ✓ — there is no
  separate "dungeon palette"; the `CODE + 0x2C6` offset in older notes double-adds
  the hunk header and reads 18 words past the table into 68k code
- bcdfb–bcdfn (monster sprites): 204 sprites, byte-exact across all 13 files ✓
- bcdft S_5 LZ77 decompression: solved by emulating the game's own 68k
  decompressor with musashi rather than reimplementing it — see
  `tools/bcdft_decompress/` ✓ (the emulator's cycle budget was too small and
  silently truncated the output + skipped relocation fixups; fixed, and it now
  also dumps the S_2 small-data hunk — see the spec's bcdft section)
- **Dungeon accent ramp (COLOR26–31) selection: solved** ✓ — 12-entry ramp
  table in decompressed bcdft, chosen per **dungeon level** from a 13-entry
  table (`0,0,0,0,1,2,2,2,2,2,2,3,3`), overridable by a map-square flag and by
  `bcdfs` action opcodes `0x1E`/`0x1F`. Not per tileset; `bcdfu`'s five
  palettes are the epilogue screens'. See the spec's "Dungeon accent-ramp
  selection (confirmed)"
- bcdfa BCSPEED.GFK sprite extraction **confirmed**: 73 frames of 16×16 (mask +
  6bpp EHB) across 16 records, 100% silhouette match vs the DOS port, rendered to
  `public/assets/blackcrypt/amiga/sprites/bcspeed.*` by `scripts/render_all.py` ✓

**Remaining:**
- ~~P1: 42,754 bytes, 256 unique values — may be color ramp or palette mapping~~ — **SOLVED**, see Open Question #2 above (doors, slot `$0C`)
- ~~Front-facing wall tiles~~ — **SOLVED**, see Open Question #3 above (slot `$B0`)
- ~~Item sprites (dungeon floor)~~ — **SOLVED.** 180 icons in two RLE streams
  inside `bcdfa`; see "bcdfa — Item Icon Bank" in
  `docs/blackcrypt/amiga/data-structure.md` for the byte-level spec and the
  verification evidence. Extractor: `scripts/extract_items.py`. The earlier
  bcdfo-gaps lead was **not** the answer and remains unexamined (still ~8.3 KB
  of unexplained data there — a separate question). Both follow-ups are now
  closed: `gfxNumber` → icon index is a 256-byte LUT in the decompressed
  `bcdft` S_1 at `+0x26EF2` (**confirmed**), and the larger paperdoll art is
  two banks — 19 chest armours at `bcdfa+0x2D05E` and 7 large panel records
  inside `bcdfa+0x036FD`. Extractor: `scripts/extract_paperdoll.py`. See the
  "Chest Armour Paperdoll Bank" and "Large Equipment-Panel Art" sections in
  `docs/blackcrypt/amiga/data-structure.md`.
- ~~Dungeon-floor item sprites (a distinct sprite class?)~~ — **SOLVED.**
  Yes, distinct: 147 masked sprites = 49 items × 3 view depths, pixels at
  `bcdfa+0x270C4`, geometry from a descriptor table in `bcdft` S_1
  `+0x271B6`. Extractor `scripts/extract_floor_items.py`. The earlier
  "negative result / reuses the 24×24 icon" entry here is superseded — see the
  "Dungeon-floor item sprites" section in `data-structure.md` for the spec,
  the evidence and why the first search missed it.
- Remaining tail of the `bcdfa+0x036FD` stream (~11 KB of other UI art at
  32/16/80-px row widths) and 4 gaps in `bcdfo` between LAB_010D descriptors
  (~8.3 KB total) are both still unclassified — tracked in `TODO.md`
  (`bcdfa-paperdoll-tail`, `bcdfo-ui-gaps`), evidence in `data-structure.md`.

### Phase 3: Overlay Disassembly (In Progress)

**Goal:** Trace remaining data loading paths and rendering pipeline.

1. ~~**Trace bcdfq chunk readers**~~ **Done — retracted as a wall-tile lead.**
   LAB_0022/LAB_0026 etc. read bcdfr's 4 screens (`bcdfq` opens `"bcdfr"`, not
   itself); size tables sum to exactly bcdfr's 138,560 B file size. See the
   "bcdfq self-reading mechanism — RETRACTED" correction in `data-structure.md`.

2. ~~**Identify standalone file loading** — Find the code that opens
   bcdfx/bcdfz by constructing the filename at runtime (likely via LAB_002C
   device name builder + a character index). Trace the RLE decompression
   calls and buffer allocation.~~ **Done.** It is indirect filename
   construction: one `"bcdf" 'a' 0` template lives in decompressed `bcdft` S_1
   `+0x1DE0A`, patched at `+0x21E7E` (bcdfb–bcdfn) and `+0x1DD16`
   (bcdfw/x/y/z). The level-entry routine at `+0x1A5CC` selects the tileset by
   hardcoded level range (levels 1–4 & 12–13 → bcdfx, level 5 → bcdfy, levels
   6–11 → bcdfz). See AGENTS.md's "bcdfx/bcdfy/bcdfz loading mechanism —
   SOLVED" entry and the "bcdfx / bcdfy / bcdfz" section in
   `docs/blackcrypt/amiga/data-structure.md` for the full trace and the
   chunk-directory format each file's RLE payloads are read through.

3. ~~**Identify buffer allocation** — find the sizes of buffers used to hold
   decompressed payloads.~~ **Done.** Two zero-terminated `AllocMem` size
   tables at decompressed `bcdft` S_1 `+0x1DA02`/`+0x1DA7E`, read by a loop at
   `+0x1DB66` (also called from `+0x1DCBA`/`+0x1DAC0`/`+0x1DC56`). 20 of their
   ~46 non-zero entries are exact matches to sizes already confirmed
   elsewhere, covering 11 of the tileset's 12 `SLOT_SIZES`. See
   `docs/blackcrypt/amiga/data-structure.md`'s "Master buffer-allocation size
   tables" (in the bcdfx/y/z section).

### Phase 4: Cross-Platform Validation (Low Priority)

**Goal:** Verify Amiga/DOS data equivalence.

1. **Map DOS clipper.clp entries to Amiga files** — identify which bcdf* files
   correspond to which clipper.clp entries.

2. **Compare image dimensions and content** — validate that the same game
   resources are stored in both versions.

---

## Files Reference

### Amiga
- `data/blackcrypt/amiga/bcdfx` — 144,169 B, RLE multi-payload (GAMEDISK2)
- `data/blackcrypt/amiga/bcdfy` — 117,937 B, RLE multi-payload (GAMEDISK3)
- `data/blackcrypt/amiga/bcdfz` — 160,806 B, RLE multi-payload (GAMEDISK3)
- `data/blackcrypt/amiga/bcdfv` — 191,917 B, endgame sequence data, 16-block RLE container (GAMEDISK2)
- `data/blackcrypt/amiga/bcdfu.asm` — RLE decompressor at LAB_0043 (line 643)
- `data/blackcrypt/amiga/adf/` — 3 ADF disk images (901,120 B each)

### DOS
- `data/blackcrypt/dosvga/clipper.clp` — 1,151,267 B, resource archive
- `data/blackcrypt/dosvga/crypt.exe` — 253,952 B, PE32 executable
- `data/blackcrypt/dosvga/maindung.gam` — 15,099 B, dungeon data

### Documentation
- `docs/blackcrypt/amiga/data-structure.md` — Amiga format specification
- `docs/blackcrypt/dos/data-structure.md` — DOS format specification
- `docs/blackcrypt/plan.md` — This file

# AGENTS.md — Project conventions for AI assistants

## Extraction Status

`docs/blackcrypt/amiga/data-structure.md` is the source of truth for file
formats — read it before touching an extractor. This section is a quick
index plus a log of dead ends worth not repeating; where the two disagree,
`data-structure.md` wins.

### Solved and extracted
- **bcdfr**: 4 full-screen images (Raven logo, Title, Logo banner, Plot text)
- **bcdfo**: **36** character portraits (32×24×6bpp) + UI elements via LAB_010D descriptors.
  **Correction:** previously miscounted as 109 — tiles 36-108 are not more
  portraits, they're the same-file-but-differently-shaped LAB_010D UI
  descriptor region (already separately extracted correctly by
  `scripts/render_all.py` → `sprites/ui.*`) misread at the wrong fixed
  576-byte stride. Tile 36 starts at exactly `0x60+36×576=0x5160` = desc00's
  own source offset. Fixed in `tools/shared/game-config.ts`
  (`N_REAL_PORTRAITS=36`); see data-structure.md's bcdfo section for the full
  writeup, including ~8.3KB across 4 gaps between known UI descriptors that
  still isn't accounted for by any of them.
- **bcdfb–bcdfn** (monster sprites): 204 sprites, byte-exact across all 13 files, 0
  unknown palette indices. `scripts/extract_monsters.py` →
  `public/assets/blackcrypt/amiga/sprites/monsters.*`. The "vertically scrambled"
  symptom recorded in earlier notes was a decode-offset bug (RLE stream starts at
  byte 1402, not immediately after the directory) — not a bitplane ordering
  problem, and not fixed by frame-splitting (that theory is wrong, see
  data-structure.md's "Animation frames" correction).
- **bcdfa** (BCSPEED effect animations): a **mixed** container — do not split it
  blindly into RLE streams (the old "887 streams", "stream 407", "streams 708–739"
  and "32×14 @4bpp" claims all come from that mistake and are wrong). Locate blocks
  by marker string. `BCSPEED\0GFK\0`: one RLE stream starting at `bcdfa+0x0DFFB`
  (the 336 raw bytes before it are the tail of the effect sound bank's last
  sample, **not** a "movement/delta table" as previously guessed — see the
  sound-bank entry below), 16 records of `12-byte name + BE count + count×224`, each
  frame a 16×16 sprite in 7 planes (mask + 6bpp EHB). 73 frames, **confirmed**
  100% against the DOS port's 73 16×16 spell effects. `BCSPEED\0PRG\0`: 34
  **uncompressed** records of `name + BE count + count×3`. Decoders live in
  `scripts/bclib/bcdfa.py`; assets via `scripts/render_all.py` → `sprites/bcspeed.*`.
- **bcdfa's offset-0 RLE stream** (18,932 B) is **not** BCSPEED data — it's the
  in-dungeon "Adventure Screen" **UI panel bank**: the class LV:/AC: stat panel
  (`as_stats`, confirmed against `data/default-2.png`'s CLERIC panel and DOS
  `clipper.clp`'s "AS Stats", 99.360%), the portrait placeholder frame
  (`face_square` vs DOS "Face Square", 98.810%), the twin-gem ring-slot graphic
  (`gem_stone` vs DOS "Gem Stone", 100%), the Save/Rest buttons (`options` vs DOS
  "Options", 100%) and the movement compass (`up_arrows` vs DOS "Up Arrows",
  100%) — plus one unidentified 24×24 checkerboard dither tile and one
  ambiguous second `as_stats` occurrence (see data-structure.md's "bcdfa — UI
  Panel Bank" for the open question on that last one).
  `scripts/extract_bcdfa_ui.py` → `sprites/ui-panel.*`.
- **bcdfa's `0x06F4D`–`0x0DFFB` span** (28,846 B) is a raw **signed 8-bit PCM
  sound bank** — the BCSPEED effect sound effects — not the "336-byte raw
  movement/delta table" this project previously guessed. 10 samples tile the
  span with zero gap, byte-identical (`XOR 0x80`) to 14 of DOS `clipper.clp`'s
  22 sound entries; the other 8 are the already-known bcdfb/c/f/j/m monster
  sound bank samples, so every DOS sound is now accounted for.
  `scripts/extract_bcdfa_sfx.py` → `audio/bcspeed-sfx-*.raw`,
  `data/bcspeed-sfx.json`.
- **bcdfa's container directory** (13 entries, S_1 `+0x1DC54`, loader
  `OpenBcdfaFile` at S_1 `+0x1DBD2`): the same in-executable-directory
  mechanism already documented for bcdfx/y/z, applied to bcdfa itself for
  the first time this pass. Sums to bcdfa's exact 197,894 B file size
  (13/13, zero deviation); 10 of 13 entries land byte-exact on
  already-confirmed banks. Closes the long-standing "bcdfa has no known
  loader" gap everywhere it appeared in this project's docs.
  `bclib.read_container_directory`/`read_container_chunks`.
- **bcdfa's `0x10779`–`0x111E1` span** (container-directory entry 4, 4,288 B
  decoded) is the game's **in-dungeon message-log font**: 128 glyphs, 8x8,
  1bpp, full printable ASCII + arrows — confirmed via its own consumer code
  (a scrolling-text blitter at S_1 `+0x1F3D2` reading `$E0(A5)`, stride 8
  bytes/glyph, index = ASCII−0x20), not just by rendering.
  `scripts/extract_bcdfa_font.py` → `sprites/font-mono.*`. The chunk's
  remaining 3,264 B render as a second, legible 8x8 alphabet (136 glyphs,
  3 planes) but no consumer was found for it — extracted as `font-mono2.*`,
  clearly flagged rendered-not-confirmed.
- **bcdft** (LZ77 compressed **game code + data**, not just data): decompressed
  by emulating the game's own 68k decompression routine with musashi, rather
  than reimplementing the custom LZ77 by hand. See `tools/bcdft_decompress/`.
  It produces **two** outputs — `bcdft_decompressed.bin` (S_1, 166,676 B, code
  + graphics/string data) and `bcdft_s2_data.bin` (S_2, 40,808 B, the `A4`
  small-data segment where every global and per-level table lives,
  `A4 = S_2 + 0x7FFE`). The emulator used to run a *fixed* 20 M cycles, which
  truncated S_1 at `0x1FEE0` and skipped the relocation-fixup pass; it now runs
  until the engine returns (~30 M cycles). Regenerate with
  `cd tools/bcdft_decompress && bash build.sh run`.
- **bcdfq palettes**: three contiguous tables at **file** offsets 0x266 (raven,
  16-color), 0x286 (title, 32-color), 0x2C6 (game, 32-color) — confirmed against
  a live Amiberry screenshot. There is no separate "monster" palette;
  `CODE + 0x2C6` in older notes double-counts the 36-byte hunk header and lands
  18 words past the table, into 68k opcodes.
- **Dungeon accent ramp (COLOR26-31) — solved.** It varies **per dungeon
  level**, and the table is not in `bcdfu`. (The tileset *file* is also chosen
  per level, so ramp and tileset do correlate — see the tileset entry below.)
  Authoritative
  table: `bcdft_decompressed.bin + 0x27B00`, **12 entries × 12 bytes**;
  `SetDungeonPalette(index)` at `+0x26900` writes them into the copper list at
  `$510(A5) + 0x6A` (= COLOR26). Per-level defaults: 13 words at
  `bcdft_s2_data.bin + 0x39E` = `0,0,0,0,1,2,2,2,2,2,2,3,3`. Overrides: map
  square flag bit 31 forces ramp 4 (`+0x02D46`), and `bcdfs` action opcodes
  `0x1E`/`0x1F` set it from the action record's byte `0x06` (`+0x0CCE6` /
  `+0x0CD3E`). `bcdfu`'s five palettes are the **epilogue screens'** copies of
  ramps 0-4. Cross-checked against DOS `clipper.clp` palettes. Full trace in
  `docs/blackcrypt/amiga/data-structure.md`.
- **Screenshot capture**: Amiberry IPC screenshot endpoint works (`/runtime/screenshot`)
- **bcdfb–bcdfn trailing data → wall decorations + monster sound bank**
  (**confirmed**): the 9–19 KB per file that follows the monster-sprite RLE
  stream splits at a **fixed 1932-byte** boundary. `[0,1932)` = **3 wall
  decorations × 644 B**, each holding the same object at three view distances
  (16×20 / 16×15 / 16×11, 7 sequential planes = mask + 6bpp EHB; 280+210+154 =
  644 exactly). `[1932,EOF)` = a **raw signed-8-bit PCM monster sound bank**,
  samples back to back, last one ending exactly at EOF.
  **Correction applied in place — this supersedes TWO earlier wrong passes:**
  first "692 standalone 1bpp icons", then "92 7-plane 16×20 icons, 7/file".
  Both were wrong in the same way: they treated 7–17 KB of *audio* as
  bitplanes (every old "icon" index ≥ 7 was PCM), and the second also assumed a
  uniform 280-byte icon stride when the real block is three nested sizes.
  Verified: sound bank matches **8 DOS `clipper.clp` samples byte-for-byte**
  (DOS byte = Amiga byte XOR 0x80); bcdfb's 9914-byte bank is **100 % tiled**
  by three of them with no gap; the 1932 boundary holds 13/13 files with zero
  deviation (lag-644 bit agreement 0.60–0.98 before it, chance after); 0
  unknown palette indices across 23,550 opaque pixels; every decoration renders
  as the same recognisable object at three shrinking sizes (keyhole/lock
  plates, a red-cross panel, a gargoyle face with glowing eyes). See
  data-structure.md's "Trailing Data — Wall Decorations + Monster Sound Bank"
  section. `scripts/extract_bcdfbn_decor.py` → `sprites/wall-decorations.*`,
  `audio/level<NN>-sfx.raw`, `data/level-sfx-banks.json`.
  (`scripts/extract_bcdfbn_icons.py` deleted.)

- ~~**bcdfv** ("sound + sprite container")~~: **SOLVED — and the question was
  malformed.** bcdfv is the **endgame/epilogue sequence data** for `bcdfu`: 16
  sequentially-read blocks, every size byte-exact — congratulations screen
  (320×200, planes 0–3), ornate picture frame (320×200×6 EHB), 8×8×6bpp font
  (59 glyphs, 48 B each, ASCII 0x20–0x5A), **ten 160×99×6bpp narrated
  illustration panels** (1,980 B/plane, 11,880 B each), Black Crypt facade
  intact (320×200, planes 0–4) and destroyed (planes 0–3, plane 4 retained),
  and a 240×153 **one-bitplane** credits graphic (30 B/row × 153 = 4,590
  exactly). Geometry read off the blitter in `LAB_0064`/`LAB_0072`/`LAB_0020`/
  `LAB_0076`, not guessed. There is **no monster sprite and no sound** in the
  file — the old claim came from hand-written speculative comments in
  `bcdfu.asm`, and the "Two Head" sprite everyone was hunting is in `bcdfb`
  and was already extracted (100.00% silhouette match vs. the DOS oracle,
  14/14 frames). `scripts/extract_bcdfv.py` + `scripts/bclib/bcdfv.py` →
  `screens/ending-*.png`, `sprites/ending-panels.*`, `sprites/ending-font.*`,
  `data/ending-script.json`.

### Extraction history (mostly solved — current open work is in `docs/blackcrypt/TODO.md`)
- ~~**Item sprites (dungeon floor)**~~: **SOLVED.** All 180 item icons are
  24x24 @ 6 sequential bitplanes with **no mask plane** (the only Black Crypt
  sprite format without one), 432 B per record, in two RLE streams inside
  `bcdfa`: `+0x1B5B3` -> 75,600 B = 175 icons, and `+0x2FE5C` -> 2,160 B = 5
  icons. Both decode to an exact multiple of 432 with zero remainder.
  Confirmed three ways: the whole bank is byte-for-byte resident in chip RAM
  at `$7D918` in three in-game emulator savestates (75,600/75,600 B); the DOS
  `clipper.clp` port holds the same 180 icons in the same order (entries
  447-621 and 624-628) with 100.000% silhouette agreement
  (103,680/103,680 px); and 13 icon placements in three real screenshots match
  pixel-exactly (3,683/3,683 opaque px). Extractor `scripts/extract_items.py`
  -> `sprites/items.*`. Spec + evidence:
  `docs/blackcrypt/amiga/data-structure.md`, "bcdfa - Item Icon Bank".
  The bcdfo-gap lead was **not** it; those 4 gaps are tracked separately in
  `docs/blackcrypt/TODO.md` (`bcdfo-ui-gaps`).
  `gfxNumber` -> icon index is now **confirmed** as `table[gfxNumber]` via a
  236-byte LUT in the decompressed `bcdft` S_1 at `+0x26EF2` (max value 174),
  reached by `MULU.W #$1B0` at five sites - the earlier "no `MULU #$1B0`
  anywhere" note was wrong (it had not searched the decompressed overlay).
  **Item names are also solved:** each `bcdfs` record's word `+0x02` is a
  *tagged* name reference - bit 15 clear = byte offset into the map-item name
  block at `bcdft` S_1 `+0x1C4E2`, bit 15 set = index into a 19-entry `char *`
  table at S_2 `+0x07BA`. 685/685 references in the shipped `bcdfs` resolve to
  an exact string start. Note `+0x1C430` (the offset older notes call "the item
  name block") is where the *starting-equipment* names live; the map-item block
  starts `0xB2` bytes later. `scripts/extract_bcdfs_items.py` ->
  `data/item-names.json`.
- **`bcdfs` has a verified walker**: `scripts/bclib/bcdfs.py`, ported
  instruction-for-instruction from the game's loader (S_1 `+0x188D0`,
  `+0x18570`, `+0x18764`). Walks 13/13 maps with zero deviation (every square
  passes the nibble check; maps 1-12 each end exactly 3,948 B before the next
  map). Use it - do **not** hand-roll a `bcdfs` scan: records are a fixed 20
  bytes, monsters are two of them, every action record is 8 bytes (not "7 for
  the first"), and empty rows are encoded `40 FF` with **signed** column
  bounds, which is what breaks naive walkers on maps 11-13.
- **Equipment-panel paperdoll art**: solved in two banks.
  **Chest armour** = RLE stream at `bcdfa+0x2D05E` -> 13,224 B = **19** x 696,
  32x29 @ 6bpp, no mask, selected by a second LUT at `bcdft` S_1 `+0x270CA`
  (values 0..18). 99.631% silhouette agreement with the DOS port's 19 32x29
  icons (17,567/17,632 px, 15/19 frames pixel-exact) and record 0 matches
  `default-3.png` at (250,33) 928/928 RGB-exact.
  **Large panel art** = **7** records inside the `bcdfa+0x036FD` stream
  (4 x 48x29 crests, 3 x 48x25 body armour; only the left 36 px are drawn);
  records 2 and 4 match `default-3.png` 1044/1044 and 900/900 RGB-exact.
  Extractor `scripts/extract_paperdoll.py` -> `sprites/{armour,paperdoll}.*`.
  Remaining ~11 KB tail of the `0x036FD` stream (other UI art at 32/16/80-px
  widths) is tracked in `docs/blackcrypt/TODO.md` (`bcdfa-paperdoll-tail`).
- **Dungeon-floor item sprites - SOLVED (147 sprites = 49 items x 3 view
  depths).** Pixels = one RLE stream at `bcdfa+0x270C4` -> 31,388 B; geometry =
  a 147 x 10-byte blit-descriptor table in decompressed `bcdft` S_1
  `+0x271B6`, read by the consumer at S_1 `+0x2193E` (`group*30 + depth*10`).
  Variable per-sprite geometry (16-80 px wide, 1-26 rows), 7 planes
  (mask + 6bpp EHB), packed back to back. Selected by the **third** 236-entry
  `gfxNumber` LUT at S_1 `+0x26FDE` (0..48, `0xFF` = no floor graphic).
  Verified: 147/147 descriptors self-consistent and tiling the bank with 0
  gaps/overlaps ending exactly on 31,388; **100.000% pixel match against 43
  placements in 10 real screenshots (7,474/7,474 opaque px)**.
  Extractor `scripts/extract_floor_items.py` -> `sprites/floor-items.*`.
  > **Correction:** this entry previously read "no separate asset class found
  > ... floor items reuse the 24x24 icon, unscaled". That was wrong. The
  > search that produced it was a fixed-record-size `MULU` census, which
  > cannot see a bank whose records carry their own dimensions.
- ~~**Front-facing wall tiles**~~: **SOLVED.** Not small repeating tiles —
  whole per-depth wall bitmaps (Wall 0/1/2 at 176/112/64 px, plus Ceiling and
  Floor) inside slot `$B0` of bcdfx/bcdfz's in-executable chunk directory
  (see the "bcdfx/bcdfy/bcdfz loading mechanism" entry below). The two leads
  this was previously chasing are both retracted dead ends, not the answer:
  bcdfq's appended data is not read via any "self-reading mechanism" (LAB_0019
  opens `"bcdfr"`, confirmed by `strings`, not `"bcdfq"`), and the "Tile
  Table" at bcdfp file offset 0x566C is a character-creation screen layout
  (traced to `LAB_0068`'s literal call-site coordinates; 9× 32×24 + 4× 192×47
  UI positions, not dungeon tiles).
- **bcdfx/bcdfy/bcdfz loading mechanism — SOLVED.** It *is* indirect filename
  construction; the earlier "no partial `"bcdf"` prefix + patched-byte pattern
  either" was a false negative because the template lives in the **decompressed**
  `bcdft` image, not in any raw overlay. `bcdft_decompressed.bin + 0x1DE0A`
  holds one `"bcdf" 'a' 0` template; two routines patch its last byte:
  `+0x21E7E` (`0x62 + level-1` → `bcdfb`..`bcdfn`) and `+0x1DD16`
  (`0x77 + param` → `bcdfw`/`x`/`y`/`z`). The level-entry routine at `+0x1A5CC`
  selects the tileset by hardcoded level range:
  **levels 1-4 & 12-13 → bcdfx, level 5 → bcdfy, levels 6-11 → bcdfz.**
  Combined with the per-level ramp table that gives
  **bcdfy → ramp 1 (violet), bcdfz → ramp 2 (bone/cream), bcdfx → ramp 0
  (levels 1-4) and ramp 3 (levels 12-13)**. Each tileset's chunk directory
  is in the executable (`+0x1DE10`/`+0x1DE5A`/`+0x1DE86`, 3-word entries:
  size, RLE flag, A5 slot, zero-terminated) and each sums to the file's exact
  byte size (3/3, zero deviation). `scripts/bclib/bcdfxyz.py` reads this
  directory (`read_chunk_directory`/`read_chunks`) and the confirmed
  per-sub-image geometry (`iter_sub_images`/`SUB_IMAGES`, 83 named sub-images
  for bcdfx/bcdfz, 46 for bcdfy) directly — `render_all.py` no longer scans
  RLE-decompressed payload sizes (`find_payload_by_size`, retired: it was
  blind to raw-stored chunks and to same-size collisions) and no longer
  defaults to a blanket bcdfu-variant-0 palette; it calls
  `read_dungeon_palette_for_tileset` per file, matching the ramp table above.

### Extraction Paths Tried (historical — do not repeat)

| Format | Approach | Result | Notes |
|--------|----------|--------|-------|
| bcdfb | RLE decompress all streams, use dir offsets into concatenated output | **204 sprites correct** | Root cause: offsets into decompressed data, not raw file |
| bcdfb | 7-plane seq planar at directory offsets (raw file) | Noise | Was reading raw compressed data as if uncompressed |
| bcdfb | 42-entry dir + RLE decompress + 7-plane sequential, stream start at 0x4A4 | 204 sprites, misaligned | Wrong stream start — 214-byte raw table between directory and RLE data was decoded as if compressed |
| bcdfb | Frame-splitting entries sharing data_off by dividing height evenly | "495 animation frames" | **Wrong** — entries sharing data_off are a normal/mirrored pair of the same image, not sub-frames. See data-structure.md. |
| bcdfa | 64×24 tiles, 6bpp, RLE streams | 280 tiles, unrecognizable | |
| bcdfa | 32×24 tiles, 6bpp, RLE streams | 599 tiles, unrecognizable | |
| bcdfa | Split whole file into RLE streams from offset 0, index blocks by stream number | "887 streams", "stream 407", "streams 708–739", "streams 0–1 = viewport masks" | **Wrong — retracted.** bcdfa is a *mixed* container; the `.PRG` block is uncompressed and the `.GFK` stream starts at a specific offset. Every stream-index-based bcdfa claim descends from this. Locate blocks by marker string. |
| bcdfa | 32×14 @4bpp, BCSPEED.GFK 16 entries | "16 multi-frame sprites, 74 frames, cursors/reticles/UI" | **Wrong — retracted.** 224 B/frame is also 16×16×7; the real format is 16×16 mask + 6bpp EHB, 73 frames, spell/projectile effects. The 4bpp reading also required the only maskless, non-EHB sprite format in the game — that anomaly was the clue. |
| bcdfa | RLE stream started at `+0xDEAB` (first `0x00`-terminator boundary) | 333-byte phantom "preamble"; record 0 281 B too long and rendering as noise | **Wrong — retracted.** 336 raw uncompressed bytes precede the stream; decoding them as RLE desyncs the decoder, which resynchronises only before record 1. Real start `+0x0DFFB`. Same trap as the monster files' `MONSTER_STREAM_START`. Tell: the parse consumed a `0x01` control byte, which `LAB_0043` would read as a 65,535-byte literal — impossible in a valid stream. |
| bcdfa | PRG analysis via RLE streams | "283 keyframe entries, 7 action types (0x09/0x0b/0x0d/0x10/0x13/0x15/0x1f)" | **Wrong — retracted.** The PRG block is **uncompressed**; RLE-decoding it shreds the marker strings. Real: 34 records, and those "action types" are the big-endian record *counts*. Sizing confirmed 33/33. |
| bcdfa GFK | Cross-checked against DOS `clipper.clp` spell-effect atlas | **73 frames, 16×16, same order; 17,152/17,152 opaque pixels agree (100.000%)** | The oracle that confirmed the 16×16 mask+6bpp decode. |
| bcdfv | RLE block + raw, 6bpp seq planar as 64×96 sprites | 69% shape match | **Wrong — retracted.** That block is a 320×200×5bpp full screen (40,000 = 5 × 8,000), the intact Black Crypt facade. There are no sprites in bcdfv. |
| bcdfv | RLE block + raw, 6bpp word-interleaved | 65% shape match | same — wrong premise, not a layout problem |
| bcdfv | RLE block + raw, 7-plane (mask) word-intl | Mask runs avg 2.4px | same |
| bcdfv | Sweep start offsets for a hidden sprite stream | n/a | Unnecessary: all 191,917 bytes are consumed by the 16-block read schedule, each block's RLE terminator landing on its last input byte. |
| bcdfv | Font at decompressed offset $A148 | saved font sheet | Coincidental. The real font is block 3, read **raw** to buffer+$1A5E0, 8×8×6bpp, 48 B/glyph, 2,832/48 = 59 glyphs exactly (`LAB_0020`). |
| bcdfv | **Audit the `.asm` comments against the code they annotate** | **Solved the whole file** | The "monster sprite"/"sound" annotations in `bcdfu.asm` were hand-written guesses. bcdfu's own narration strings ("THROUGH INCREDIBLE BRAVERY…") identify it as the epilogue player in one grep. |
| bcdft | Simple backwards token LZ77 (hand-written) | 0 bytes | Abandoned in favour of emulating the game's own decompressor |
| bcdft | Simple bit-stream LZ77 (hand-written) | 182 bytes | |
| bcdft | musashi 68k emulator running the game's S_4 decompression engine | **166,676 B, correct** | Avoids hand-translation bugs entirely |
| bcdft | same emulator, fixed `m68k_execute(20000000)` budget | **Silently truncated** — 113,853 non-zero bytes, stopped at S_1+0x1FEE0, relocation-fixup pass never ran | Engine needs ~30 M cycles. Symptom: absolute `JSR $xxxxxx.l` targets point into an all-zero region. Fixed by looping until PC leaves S_4 |
| Dungeon COLOR26-31 source | Byte-searched the whole Amiga corpus (raw + all RLE-decompressed bcdfx/y/z payloads) for the live-captured ramp | Exactly one hit, `bcdfu+0x420` | Misleading: that is the **epilogue overlay's copy**. The real table is inside `bcdft`'s compressed payload, invisible to a raw search |
| Dungeon palette loader | `bcdfp LAB_0137` "copies a 32-word palette, indexing by (n-1)*64" | Wrong routine | It is a 16-step screen **fade**; its table (`bcdfp+0x4194`) has exactly one entry and both call sites pass n=1/0. Real loader is in decompressed bcdft |
| bcdfq palette (dungeon) | `CODE + 0x2C6` = file offset 0x2EA | Garbage / runs into 68k code | Off by the 36-byte hunk header; correct offset is file 0x2C6, no separate dungeon palette |
| bcdfq palette (game) | 0x2C6 offset verified vs screenshot | Confirmed correct | EHB palette matches in-game colors |
| bcdfo UI | Descriptors from LAB_010D | Correct | |
| bcdfo portraits | Treated all `(fileSize-0x60)/576 = 109` tiles as character portraits | **Wrong — 73 of the 109 were the LAB_010D UI region, misread at the wrong stride** | Only tiles 0-35 (36) are real faces; tile 36 begins at exactly `0x60+36×576=0x5160` = desc00's own offset. Fixed in `tools/shared/game-config.ts` (`N_REAL_PORTRAITS=36`). |
| bcdfr | 4 screens at documented BPP | Correct | |
| bcdfq "self-read" | Assumed LAB_0019 opens `"bcdfq"` by filename, chunk tables = per-disk tile/texture data | **Wrong — retracted** | `LAB_001C` is `"bcdfr"`, not `"bcdfq"`; `strings -a bcdfq` finds zero `"bcdfq"` bytes in the file. LAB_0019/22/27/2B/2F load bcdfr's 4 screens (chunk sizes sum to exactly bcdfr's file size). See data-structure.md correction. |
| bcdfp "Tile Table" @ 0x566C | Assumed 9-entry table = dungeon viewport tile descriptors, pointers into bcdfa | **Wrong — retracted** | Byte-parsed directly: 15×14-byte records, 9×(32×24 @ X∈{12,45,78},Y∈{106,132,158}) + 4×(192×47 @ X=128,Y∈{5,54,103,152}). Exact-match traced to `LAB_0068`'s literal `LAB_010E` calls (character-creation screen), which render existing bcdfo descriptors at these same coordinates. Not wall tiles, no bcdfa pointers. |
| Item sprites | Entropy-scanned bcdft decompressed blob (2KB windows, unique-byte-count + printable%) for an image-shaped region | No image region found | 0–108KB dense structured tables (140–180 unique bytes/2KB), 108–129KB ASCII text, 129KB+ zero padding. Ruled out bcdft as an item-icon source. |
| Item sprites | Checked bcdfa's non-GFK/PRG "streams" for icon-sized payloads | "mostly padding, 410/887 zero-length" | **Void** — built on the discredited blind stream split of a mixed container. bcdfa's non-BCSPEED regions are un-surveyed; redo from real block boundaries before concluding anything. |
| Item sprites / wall tiles | Grepped `strings -a` across bcdfp/bcdfq/bcdfu/bcdft/BlackCrypt for any bcdfb–n/x/y/z filename fragment | None found | No `"bcdf"` + single-letter-patch pattern either (checked bcdfu's one `"bcdfv"` string — never modified before its one `Open()` call). **Since answered:** the game stores one `"bcdf" 'a' 0` template in the *decompressed* `bcdft` image and patches its last byte before each `Open()` (S_1 `+0x21E7E` for bcdfb–bcdfn, `+0x1DD16` for bcdfw/x/y/z) — which is why no raw overlay contains the strings. |
| Item sprites | Traced every `Open()` (LVO -30) call site in bcdfp/BlackCrypt.asm for a filename operand | All accounted for (bcdfs, bcdfo, CHARACTERS, GAMESAVE:, OrigDungeons, TempDungeons, Configuration.dat, bcdfq/p/t/u overlays) | No new/unexplained Open() call found — confirms item sprites aren't loaded via a not-yet-noticed filename string. |
| bcdfb–bcdfn "Trailing Data" | Split at a fixed 1932 B boundary: `[0,1932)` = 3 wall decorations × 644 B (3 nested sizes 16×20/16×15/16×11, mask+6bpp EHB); `[1932,EOF)` = raw signed-8-bit PCM sound bank | **117 decoration sprites + 13 sound banks; bcdfb's bank 100 % byte-exact vs DOS `clipper.clp` #170/#169/#177** | **Confirmed.** Supersedes both "692 standalone 1bpp icons" and "92 7-plane icons" — both treated PCM audio as bitplanes. Boundary holds 13/13 files, zero deviation. See data-structure.md's "Trailing Data — Wall Decorations + Monster Sound Bank" (incl. paths-tried table). |
| bcdfb–bcdfn "Trailing Data" | Read raw (uncompressed) 40-byte blocks starting right after the sprite stream terminator, decoded each as a **standalone 16×20×1bpp** planar bitmap | "692 icons across 13 files, visually clean" — **wrong, superseded** | Each 40-byte block is actually *one plane* of a 7-plane mask+6bpp-colour icon (same convention as monster sprites), not its own icon — a single colour bitplane of a real image still renders as a clean-looking 1bpp bitmap in isolation, which is what made this look right. Boundary counts (61/49/49/49/69/49/52/52/49/56/52/53/52) clustering near multiples of 7 was the tell, missed at the time. |
| bcdfb–bcdfn "Trailing Data" | Read raw 280-byte blocks (7×40), decoded as mask+6bpp-EHB colour via `bclib.decode_masked`, same convention as monster sprites | **92 icons across 13 files (7/file, 8 for bcdfj), coherent finished colour art** (control panels, dials, gargoyle face, keyhole/lock panel) | **Corrected finding** — see data-structure.md's "Trailing Data — Wall-Mechanism/Structure Icon Region". Boundary (real icon vs. following unidentified data) found via a per-icon colour-diversity heuristic (>40 distinct palette indices ⇒ noise), not a length field. |
| Item sprites | Parsed the emulator savestates (`data/blackcrypt/default*.uss`) as a static chip-RAM dump (zlib `CRAM` chunk), located the on-screen inventory cheese icon's source by searching all 2 MB for a bitmap reproducing it under an unknown (row-stride, bit-shift) pair, then matched the region back to an RLE stream in `bcdfa` | **Found: `bcdfa+0x1B5B3` -> 175 icons, `+0x2FE5C` -> 5 icons, 24x24 @ 6bpp, no mask, 432 B/record** | **Confirmed** three independent ways (chip RAM byte-exact 75,600/75,600 in 3 savestates; DOS silhouette 103,680/103,680 = 100.000% over 180/180 frames; 3,683/3,683 screenshot pixels). See data-structure.md's "bcdfa - Item Icon Bank". |
| Item sprites | Assumed the game's usual `plane0 = 1bpp mask + 6bpp EHB colour` convention and looked for a 7-plane (504 B) record | Never matched | **Refuted premise.** Item icons are the one Black Crypt sprite format with **no mask plane**; "transparency" is colour index 53, which is RGB `0x222222`, byte-identical to the inventory slot interior it is blitted onto. Assuming a mask cost several wrong record sizes. |
| Item sprites | Took the RLE stream start as `bcdfa+0x1B5B4` (the round boundary after the last `BCSPEED\0PRG\0` record) | 74,850 B, not a multiple of 432, decoder desynced but output still looked like icon data | The real start is `+0x1B5B3`, one byte earlier - the only start in the neighbourhood whose output is an exact multiple of the record size. Third instance of this trap in this project (cf. `MONSTER_STREAM_START`, the GFK preamble). |
| Item sprites | Mapped screenshot RGB back to palette indices, then searched chip RAM per bitplane for the equipment-panel armour | Only planes 0 and 4 hit; planes 1/2/3/5 found nothing anywhere | **Not a failed search - an ambiguous index map.** Under EHB, register 22 and register 56 are both RGB `0x666666`; planes 0 and 4 are exactly the two bit positions where those two indices agree. Compare in RGB, not in recovered indices. The stride-6 hit was real. |
| Item icon -> `bcdfs` gfxNumber | Grepped bcdfp/bcdfq/bcdfu disassembly for `#$1B0` (432) or a `MULU` by the record size | No literal found | **Still open.** The blit call site for item icons has not been located; the mapping from an item's `gfxNumber` to its 0-179 icon index is unresolved. |
| bcdfa `0x00000` stream | Structural scan for a column that is one constant colour index across every row of every one of 6 planes, first pinned to the paperdoll bank's known padding index (33), then generalised to "any single index, per plane" | **7 records found; 6 identified against DOS `clipper.clp` at 98.8-100% silhouette agreement** | The strict (index-33-only) scan is clean (one hit per record); the generalised (any-index) scan is much noisier and needs cross-checking (DOS name/dimension match, or the strict scan) before trusting a hit — see data-structure.md's "bcdfa — UI Panel Bank" |
| bcdfa `0x06F4D`-`0x0DFFB` | Byte-value entropy/autocorrelation profiling (this range's entropy, 6.91 bits/byte, was *higher* than the file's own confirmed-compressed streams, and its lag-1..10 autocorrelation decayed smoothly like a waveform, not like image or compressed data) then cross-referencing every DOS `clipper.clp` `type=4` sound entry (`XOR 0x80`) against the raw byte range | **10 unique PCM samples, byte-identical to 14 DOS sound entries, tiling the whole 28,846 B span with 0 gap** | Retracts the "336-byte raw movement/delta table" guess — that span is the tail of the last sample. See data-structure.md's "bcdfa — Effect Sound Bank" |
| bcdfa `0x10779`-`0x1AE70` | Opaque/masked render sweeps (widths 16-208px) plus both padding-column scans | No coherent image; strict scan found 0 hits, generalised scan found too many (100K+) to be useful | **Superseded — `bcdfa` does have a loader.** Found it (`bcdft` S_1 `+0x1DBD2`, structurally identical to `OpenTilesetFile`) and its 13-entry container directory, which resolved this whole span at once: entry 4 (`0x10779`, 4,288 B) is a confirmed message-log font; entry 5 (`0x111E1`, 34,340 B) has 14 real consumer-code hits (heterogeneous bank, not one image, still open); entry 6 (`0x15F8D`, 20,195 B) is directory-confirmed **raw, not RLE** — explaining why it never chained as RLE — **solved** as BCSPEED.EFF via `re-codebreaker` + independent re-verification. See data-structure.md's "bcdfa — Container Directory" and "bcdfa — BCSPEED.EFF" |
| bcdfa container directory | Found by re-applying the bcdfx/y/z "template-patch + in-executable directory" mechanism to bcdfa itself (a 4th patch site of the same shared `"bcdf?"` template, hardcoded rather than parameterised) | **13-entry directory at S_1 `+0x1DC54`, sums to bcdfa's exact 197,894 B file size, 13/13 zero deviation; 10/13 entries land byte-exact on already-confirmed banks** | Retroactively fixed a wrong "chest armour size looks inconsistent" hand-check (an off-by-one cumulative-offset arithmetic slip, not a real inconsistency). See data-structure.md's "bcdfa — Container Directory" |
| bcdfo UI descriptor gaps (4 gaps, 8,326 B total) | Opaque 6-plane render sweep (8 widths) plus both padding-column scans, applied per-gap | No coherent image in any of the 4 gaps; one gap (`0xB4F8`-`0xB658`, 352 B) is 94% a single byte value (0xFF) with a periodic 0xC0, reading as blank/filler rather than a distinct asset | **Superseded — 3 of 4 gaps solved.** They aren't filler or new assets: `chargen_ui`, the 4 guild banners and `stats_panel` are 7-plane masked sprites whose mask plane is stored *outside* the descriptor's own colour span (the "94% 0xFF" gap is the guild banners' shared mask, not blank filler). Found by comparing each gap's start offset to every descriptor's own 6-plane end offset, not by any render sweep. The 5,288 B gap between `chargen_logo` and `sigil_0` is still open. See data-structure.md's "bcdfo — Character Portraits + UI Elements" § "Unaccounted gaps". |

## Agent: amiga-re (Amiga 68k Reverse Engineering Specialist)

Available via the `task` tool with `subagent_type="amiga-re"`. Loads the profile from
`.opencode/skills/amiga-re.md` and has access to radare2 MCP + openground (amigadocs).

Use for: analyzing 68k disassembly, custom chipset usage, AmigaOS LVO resolution,
custom compression formats, bootblock analysis.

## Reverse Engineering

### What to annotate
- Data tables: decoded values, sizes, counts, purpose
- Functions: what they do, parameters, return values
- Constants: magic numbers, addresses, offsets
- Structures: field layout, byte-level format
- File format discoveries: chunk sizes, palette locations, descriptor tables

### How to annotate
Use `; ── ... ──` style comments for section headers, and `;` for inline notes:
```asm
; ── Portrait tile descriptor (32×24×6bpp sequential planar) ──
; Source = $60 + index×$240 (96 + index×576). Stride = $60/plane.
LAB_010C:
    DS.L    1               ; runtime source offset
    DC.L    $00600000        ; $60 = 96 (plane stride)
```

### Priority files
- `data/blackcrypt/amiga/BlackCrypt.asm` — main executable
- `data/blackcrypt/amiga/bcdfp.asm` — game logic overlay (blitter, BCSub, tile descriptors)
- `data/blackcrypt/amiga/bcdfq.asm` — rendering overlay (chunk readers, palettes)
- `data/blackcrypt/amiga/bcdft.asm` — data carrier overlay (7 hunks, no file I/O)
- `data/blackcrypt/amiga/bcdfu.asm` — RLE decompressor, sound, 4 palette variants

### bcdfa — BCSPEED Effect Animations
- 197,894 bytes. A **mixed** container: some blocks RLE-compressed, some raw.
  **Do not split it into RLE streams from offset 0** — that model is retracted
  and everything phrased as "stream N" for bcdfa is wrong. Find blocks by marker.
- **Loaded by `bcdft` S_1 `+0x1DBD2`** (`OpenBcdfaFile`) — solved this pass.
  Has a real **13-entry container directory** at S_1 `+0x1DC54`, same 3-word
  (size, compressed, A5-slot) shape as bcdfx/y/z's `CHUNK_DIRECTORIES`,
  summing to bcdfa's exact 197,894-byte size (13/13, zero deviation).
  `bclib.read_container_directory`/`read_container_chunks`. See
  data-structure.md's "bcdfa — Container Directory" for the loader trace and
  the full entry table.
- **BCSPEED.GFK** — **solved**. One RLE stream at file offset `+0x0DFFB` (the byte
  before the first marker; the 336 raw bytes ahead of it are the tail of the
  effect sound bank's last PCM sample, not a table), decoding to 16,576 B = 16
  records, no header, no trailing slack. Record:
  `12-byte "BCSPEED\0GFK\0" + 2-byte BE frame count + count×224`. Each 224-byte
  frame is **16×16, 7 sequential planes** — plane 0 = 1-bit cookie-cut mask,
  planes 1–6 = 6bpp EHB colour (the same convention as the monster sprites).
  **73 frames**: spell/projectile effects — bee, stars, fireballs, ice burst,
  flames, fly, skull, serpent, bolts.
- **BCSPEED.PRG** — **uncompressed**, 34 records at `+0x1AE70`…`+0x1B566`:
  `12-byte "BCSPEED\0PRG\0" + 2-byte BE count + count×3`. Sizing confirmed
  (33/33 gaps exact); tag-byte semantics still open.
- Verified against the DOS port: `clipper.clp` yields exactly 73 spell-effect
  frames of 16×16 in the same order, 100.000% silhouette agreement (17,152/17,152
  opaque pixels) on the 67 frames without a stored background.
- Decoders: `scripts/bclib/bcdfa.py`; assets via `scripts/render_all.py`.
- `0x00000`–`0x036FC` (18,932 B) is the **UI panel bank** — **32 records, 15
  named** (`UI_PANEL_RECORDS`/`ui_panel_records`, `scripts/extract_bcdfa_ui.py`
  → `sprites/ui-panel.*`, 15 frames). Every record is 7-plane masked (stencil
  + 6 EHB colour), decoded cookie-cut against its own stencil — the earlier
  "6-plane opaque, backdrop-keyed" reading put every record one plane block
  late (`as_stats_alt` was `as_stats`'s own stencil, misread as a second
  record — dropped). Named: `as_stats`/`face_square`/`gem_stone`/`options`/
  `up_arrows` (AS Stats/Face Square/Gem Stone/Options/Up Arrows, 98.2-100%
  DOS agreement), `ghost` (DOS `Ghost`, a 50% black stipple — renamed from
  `checker_tile`, rendered as a mask), `page_1`-`5` and
  `pressure_plate_1/2_up/down` (all 100.000% DOS silhouette).
- `0x06F4D`–`0x0DFFB` (28,846 B) is a raw signed 8-bit **PCM sound bank**
  (`sfx_samples`, `scripts/extract_bcdfa_sfx.py`) — 10 samples, byte-identical
  to 14 DOS `clipper.clp` sound entries.
- `0x10779`–`0x111E1` (container-directory entry 4, 4,288 B decoded) is
  **solved**: **four** fonts, not two — region A (message-log font, 64
  glyphs, 8x8 1bpp, consumer S_1 `+0x1F3D2`), region B (micro font, 59
  glyphs, 4x5 1bpp, consumer `+0x20040`), regions C+D (big font mask+colour,
  59 glyphs, 8x8 6bpp masked, consumer `+0x2024E`/`+0x2025C`). The old "128
  glyphs twice over" / "unconfirmed 136-glyph second alphabet" readings were
  both numerological coincidences — see data-structure.md's "The chunk is
  four fonts, not two". `mono_font_glyphs`/`font_micro_glyphs`/
  `font_big_glyphs`, `scripts/extract_bcdfa_font.py` → `sprites/font-mono.*`
  (64), `sprites/font-micro.*` (59), `sprites/font-big.*` (59) — all four
  regions code-confirmed, `font-mono2` retired.
- `0x111E1`–`0x15F8D` (entry 5, 34,340 B) is **partly solved**. Its
  `0x0000`-`0x3480` sub-record (13,440 B) is the **Spell Book background**
  (100.000% DOS silhouette). Its `0x7CA0`-end tail (2,436 B) is the **29 key
  icons** (`key_icon_sprites`, `scripts/extract_bcdfa_keys.py` →
  `sprites/keys.*` — 100.000% DOS agreement, all 29 frames; DOS's own
  unnamed `Start Keys`/`End Keys` bracket is the same 29 8x14 icons). The
  remaining ~17.7 KB (`0x3480`/`0x62C4`/`0x7110`/`0x7230`/`0x7350`/`0x73A0`)
  is still open — a heterogeneous multi-record UI/text bank, not one image.
- **bcdfa's `0x15F8D`–`0x1AE70` span** (entry 6, 20,195 B, directory-confirmed
  **raw not RLE**) is **BCSPEED.EFF — solved**: 95 effect particle-emitter
  scripts, the third BCSPEED bank, tying the GFK sprites to the PRG movement
  scripts. Cracked via `re-codebreaker` (consumer code traced at S_1
  `+0x25536`/`+0x25624`), then **independently re-verified from scratch**
  in the orchestrating session (fresh r2 disassembly, a from-scratch blind
  parser reproducing the in-executable 95-entry table byte-exact with zero
  unaccounted bytes, and a DOS `clipper.clp` byte-identical cross-check via
  this project's own `parse_clp`, not the escalation's code) before being
  promoted to a committed extractor. `bclib.bcdfa.eff_scripts`/
  `eff_table_offsets`, `scripts/extract_bcdfa_eff.py` →
  `data/bcspeed-effects.json`. All 18 PRG tag-byte jump-table handlers are
  now also traced and implemented as a **true per-tick particle simulation**
  (`simulate_effect`, `scripts/render_bcspeed_eff.py` →
  `data/bcspeed-effects-simulated.json`, verified error-free across all 95
  effects/1,833 ticks with a 95/95 tick-0-matches-raw-spawn regression
  check). See data-structure.md's "bcdfa — BCSPEED.EFF".
- `0x300C2`–EOF (entry 12, 1,092 B, also raw) is **solved**: the
  **Throwing-Items projectile sprite bank** — Arrow + Dagger at 3 view
  depths x 2 facings (12 records, 7-plane masked). Found by searching
  `clipper.clp`'s catalog for the `Start Throwing Items`/`End Throwing Items`
  markers, the move that also solved entry 6. `throwing_item_sprites`,
  `scripts/extract_bcdfa_throwing.py` → `sprites/throwing-items.*` — DOS
  agreement 100.000% on both named entries (`Arrow`, `Dagger`), mirror
  invariant holds on 39/39 rows.

### Known conventions
- IRA disassembly: BCLR instructions at label data are raw bytes, not code
- DOS LVO offsets: Open=-30, Close=-36, Read=-42, Write=-48, Lock=-84, etc.
- A6 = library base (dos, exec, graphics), A5 = local data frame, A4 = overlay data
- BLTSIZE encoding: (height << 6) | width_in_words
- 6bpp EHB: colors 0-31 base, 32-63 half-bright (color >> 1)
- 12-bit Amiga RGB → 24-bit: each nibble × 17
- **Minterm $0FCA**: D = (A AND B) OR (NOT A AND C) — mask+color sprite blit
  - Channel A = transparency mask (1=pixel, 0=transparent), fixed per plane loop
  - Channel B = color data, advances by stride each plane
  - Channel C/D = screen (read/write), same pointer
- **Minterm $09F0**: D = C — straight screen-to-screen copy
- **Minterm $03CA**: D = B — opaque source-to-screen copy (no mask)
- **Minterm $00F0**: D = C — full word fill/copy
- **LAB_010D**: 28-byte descriptor table entries for UI elements (source offset, stride, BLTSIZE, modulo, flags, width, height)
- **LAB_010E**: Render UI element by descriptor index → LAB_011E
- **LAB_010F**: Render portrait by tile index → LAB_011E (uses LAB_010C as live descriptor)
- **LAB_011E**: Main sprite blitter with clipping (flag bit0=LAB_0124 path)
  - Minterm $0FCA: A=mask(fixed), B=color(stride), C/D=screen
  - 6 iterations (DBF D0,5) — one per color bitplane
- **LAB_0110**: Simple opaque screen blitter (2-pass: aligned words + edge pixels)
- **LAB_011B**: Screen-to-screen blit for scrolling
- **LAB_0124**: Alternate sprite blitter with screen-edge clipping

### bcdft — Data Carrier Overlay
- **7 hunks**: S_0 CODE (entry stub), S_1 BSS (166KB target), S_2 BSS (40KB target), S_3 BSS (1L), S_4 CODE (LZ77+relocation engine), S_5 DATA (85KB compressed), S_6 BSS (18KB read buffer)
- **S_0 entry**: chain resolver frees S_3/S_5/S_6, returns modified A1
- **S_4 engine**: LZ77 decompresses S_5 into S_1/S_2, then applies pointer relocation fixups
- **S_5 DATA**: 84,976 bytes custom LZ77-compressed game data (item names, game strings, quest text, data tables). **NOT** wall/floor textures — those come from bcdfx/y/z.
- **Decompression**: Achieved via **musashi 68k emulator** (see `tools/bcdft_decompress/`). The S_4 engine is run directly by emulating the 496 bytes of 68k code, avoiding hand-translation bugs.
  - Build: `cd tools/bcdft_decompress && bash build.sh run`
  - Output: 166,676 bytes, ~113KB non-zero, containing all item names, game strings, and data structures
  - Key finding: `POTION OF WATER BREATHING` at offset 118185, `CANNOT PLACE ITEM IN INVENTORY` at 120287
- **WHDLoad slave**: matches by hunk size $4c1ac, patches at $496ba/$496c2 (trainer)
- **bcdfb-bcdfn**: 13 dungeon level graphic stores (one per map, b=map1 through n=map13). Opened by name from the decompressed `bcdft` image (S_1 `+0x21E7E`); nothing to do with bcdfv. Each file contains RLE-compressed sprite data for that map's monsters. Format: 12-byte header + 42 × 28-byte entries. Entries sharing data_off are a normal/mirrored **pair of the same image**, not sub-frames — see the "Animation frames" correction in data-structure.md. 7-plane sequential bitplane (mask + 6bpp EHB). RLE decompression + directory produces **204 sprites**, byte-exact, across all 13 files.

### bcdfx/bcdfy/bcdfz — The three dungeon tilesets (SOLVED, 100% coverage)

**Never RLE-scan these files.** Each is a bare concatenation of chunks whose
directory lives in the *executable* — decompressed `bcdft` S_1 at `+0x1DE10`
(bcdfx, 12 entries), `+0x1DE5A` (bcdfy, 7), `+0x1DE86` (bcdfz, 12); three
big-endian words each — size, compressed flag, destination `d16(A5)` slot —
zero-size terminated. Each table sums to the file's exact byte size (3/3, zero
deviation). **Five chunks per file are stored uncompressed**, so a blind RLE
walk desynchronises on them; that is the single root cause of every wrong
"payload boundary"/"P0–P9" table in this repo's history.

Each chunk is a *sequence* of independent sub-images, back to back, no header
or separator — every image has its own width, height and plane count.
Sequential planar; 6 planes = opaque, **7 planes = mask plane first**.

- **83 named sub-images in bcdfx and bcdfz, 46 in bcdfy. 205,602 of 205,922
  decompressed bytes assigned, zero overlap**, one 320-byte tail still open.
- The geometry comes from the game's own blit-descriptor tables, not from
  guessing: a **20-byte** record (walls/ceiling/floor, S_1 `+0x22CE2`/`+0x22D96`),
  a **28-byte** record carrying its own `slot`, `src`, `bytesPerPlane`,
  `BLTSIZE`, modulo, dest X/Y, flags, width and height (side walls, doors,
  pits, pillars, chains, buttons), and an **18-byte** record for the stairs
  (S_1 `+0x25246`). The 28-byte record is self-validating —
  `bytesPerPlane == (w/8)*h`, `BLTSIZE == (h<<6)|(w/16+1)`,
  `modulo + blitBytes == 40` — which held on 61/61 records found by a
  whole-binary scan.
- Slot map: `$08` side walls (4 depths × L/R, masked) · `$0C` doors (2 leaf
  types × 3 depths + 7 door-way frames) · `$B0` front walls ×3 depths +
  ceiling + floor · `$10` floor/ceiling pits · `$BC` alcove A–E · `$C0` plaque
  A–E · `$14` pillars · `$B8` Door Slot 64×136 · `$C4` stairs (2 flights × 3
  depths) · `$20` pull chains · `$C8` Panel Top + Fountain · `$1C` 18 wall
  buttons.
- **Each wall row is three pieces — left return, front face, right return** —
  so the returns can swap under mirroring. `16+176+16 = 48+112+48 =
  64+80+64 = 208`. The old "Wall 2 = 64×57" was a *return*; the front face is
  **80×57**. DOS `clipper.clp` stores each row pre-composited at 208 px.
- 70 of `dungeon.json`'s 76 entries have an Amiga counterpart at identical
  dimensions in these three files (or, for the 5 wall entries, by exact
  decomposition). The remaining 6 (`Floor 2`, the four `Pressure Plate`s,
  `Ram Block`) are **all now found elsewhere in the Amiga corpus** — 4
  `Pressure Plate`s and `Floor 2` in `bcdfa` (the UI panel bank's newly-named
  records, and a runtime mirror of `bcdfx`'s own `floor` sub-image,
  respectively), `Ram Block` also in `bcdfa` (the `0x036FD` paperdoll
  stream's tail). None were ever in `bcdfb`–`bcdfn`. See data-structure.md's
  "DOS `Floor 2` and `Ram Block` — SOLVED".
- `bcdfy` carries **7 of the 12 chunks**, not 2 — the earlier "only stream
  44 + 45" reading missed its side-wall chunk (stored *raw*, 14,448 B at
  offset 0) and its door chunk (compresses to a different raw size than
  bcdfx's, so a decompressed-size match never fired). It lacks only pits,
  alcove, plaque, panel/fountain and buttons.
- Renders: composite 208×140 viewports built straight from the descriptors'
  dest X/Y join seamlessly for all three tilesets, at ramps 0/1/2 respectively.
  Full offset tables in `docs/blackcrypt/amiga/data-structure.md`.

**PALETTE — the bcdfq `game` table is only 26/32 right for the dungeon.** A
live copper-list capture (`COP1LC` → 32 `MOVE`s to `COLOR00`–`COLOR31`) matches
bcdfq `game` exactly for COLOR00–25 and differs entirely for COLOR26–31, which
the game reprograms per tileset. Five 32-word variants live in **`bcdfu`** at
`0x03EC` / `0x042C` / `0x046C` / `0x04AC` / `0x04EC` (64-byte stride, identical
in entries 0–25). Variant 0 (`432 542 653 764 875 986`, tan sandstone) is
live-confirmed and occurs exactly once in the whole corpus. Use
`bclib.read_dungeon_palette()`. Which variant each level/tileset selects is
still unknown.

### bcdfq — Intro + Music Only
- Contains intro/title screens (loaded from bcdfr) and OctaMED music engine
- **ZERO dungeon rendering code** — all 3D rendering is in bcdfp
- Contains one palette used for both monsters and dungeon walls/floors, at
  **file** offset 0x2C6 (red/orange/tan — correct for ogres). There is no
  separate "dungeon palette": `CODE+0x2C6` (file offset 0x2EA) was a stale
  offset that reads 18 words past the table into unrelated file content —
  monsters and stonework necessarily share one EHB palette.

### File Loading Summary
Only these files are ever loaded by name in the WHDLoad version:
| File | Loaded By | Contents |
|------|-----------|----------|
| bcdfp | BlackCrypt (LoadSeg) | Game logic, blitters, save/load |
| bcdfq | BlackCrypt (LoadSeg) | Intro screens, music engine |
| bcdft | BlackCrypt (LoadSeg) | LZ77-compressed text tables + item names (85KB) |
| bcdfu | BlackCrypt (LoadSeg) | RLE decompressor, sound engine |
| bcdfo | bcdfp (LAB_00AE) | 36 portraits + UI graphics (63KB) |
| bcdfs | bcdfp (LAB_0047) | Map data (all 13 maps, NOT a save file) |
| bcdfv | bcdfu (LAB_0033) | Endgame/epilogue sequence data (192KB) |
| Configuration.Dat | BlackCrypt | Game config (8 bytes) |

bcdfb-bcdfn (b through n, 13 files) are **per-map monster sprite files** on floppy.
bcdfb-bcdfn are opened by name from the decompressed `bcdft` image via the patched `"bcdf?"` template (S_1 `+0x21E7E`) — not from bcdfv.
bcdfx/bcdfy/bcdfz — the three dungeon tilesets, opened through the *same*
patched `"bcdf?"` template from `OpenTilesetFile` (S_1 `+0x1DD16`,
`ADDI.W #$77,D0` / `MOVE.B D0,$4(A0)` / DOS `Open()` LVO −30). No literal
`"bcdfx"`/`"bcdfy"`/`"bcdfz"` string exists in any build — `strings` cannot
find one, and an empty search here is evidence about how the name is built,
not that the loader is missing.

### Monster Sprite Rendering Pipeline (bcdfp.asm)

The monster sprite rendering code is entirely within **inline raw data blocks** that IRA encoded as `DC.L` (failed to disassemble). There are **no labeled callers** of LAB_011E for monster sprites in the disassembly.

#### VBlank Handler LAB_00D3 (line 3100)
Drives the 3D viewport rendering pipeline. Dispatches through a jump table (lines 3104-3107) to rendering phases.

#### Direction Dispatch (lines 3156-3183)
For each player direction (0=N, 1=E, 2=S, 3=W), calls different viewport + monster rendering functions via `BSR.W`. Each direction target renders walls AND monsters for that viewing angle.

#### Sprite Descriptor Construction (inline, around line 3212-3213)
After LAB_00D8, the inline code:
- Loads sprite data pointer from `A5+$03CE`
- Loads sprite descriptor base from `A5+$03C2`
- Writes sprite dimensions to descriptor offset +2 (width) and +6 (height/BLTSIZE)
- Loads a buffer base from `A5+$03C6` — **not** bcdfv sprite data; it is a
  copper list (torch-flicker colour cycling). See data-structure.md.
- Skips 12 bytes of header (`LEA $000C(A1),A1`)
- Copies sprite data in a loop: `MOVE.W (A0)+,(A1)+` followed by `LEA $000C(A1),A1` — stride of 12 bytes ($0C) between plane words

#### Sprite Copy Loop (inline)
```
MOVEQ #7,D0            ; 8 iterations
loop: MOVE.W (A0)+,(A1)+
      LEA $000C(A1),A1  ; stride 12 between planes
      DBF D0,loop
```
Copies 8 words (16 bytes) from a lookup table into the sprite buffer, spacing them 12 bytes apart. This may be setting up a render descriptor, not the source sprite data itself.

#### Source Data Access Pattern (inline)
```
MOVEA.L $03C6(A5),A1   ; sprite data buffer base
LEA $000A(A1),A1       ; offset 10 bytes into sprite entry
```
Two different header offsets appear: `$000A` (10) and `$000C` (12). The purpose of each is unclear.

#### Sprite Blit Invocation (inline)
The inline code at line 3229 calls `BSR.W *+$886` — a function that eventually reaches LAB_011E or does an inline blit with the same $0FCA minterm setup.

#### Key A5 Offsets for Monster Sprite Rendering
| Offset | Purpose |
|--------|---------|
| A5+$03BE | Alternate sprite pointer |
| A5+$03C2 | Sprite descriptor base pointer (A2 in blitter) |
| A5+$03C6 | Copper list pointer (torch-flicker colour cycling) — **not** bcdfv data |
| A5+$03CE | Sprite data pointer (current monster) |
| A5+$03D6 | Sprite type/index |
| A5+$03D8 | Sprite state longword |
| A5+$03D9 | Sprite-active flag (byte) |
| A5+$03DA | Sprite direction/movement byte |
| A5+$043C | Rendering state flag |

### Text Rendering Blitter (bcdfp.asm LAB_0103, line 3646)
A separate blitter for rendering text characters:
- Plane stride: 256 bytes ($100)
- BLTSIZE: $0211 = height=8, width_words=17 (272 pixels/34 bytes per row)
- Screen modulo: 6 bytes
- 6 iterations (DBF D0,5)
- Font data loaded from 0(A5)+$A148

### bcdfv — Block Loading Structure

> **Superseded.** The block *sizes* below are right, but the "Phase 1 intro /
> Phase 2 game data" framing and every content label are wrong. See the
> data-structure doc's "bcdfv" section for the full 16-block table with
> content, geometry and verification. Kept here only so the old block numbers
> stay resolvable.

Confirmed by reading LAB_0033-LAB_003A in bcdfu.asm. File size = 191,917 bytes (0x2EDAD).

**Phase 1 (intro screens)** — data overwritten by Phase 2:
| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 61 | 1 | $4EB0 (20144) | RLE | buffer+0 → 32000B output |
| 68 | 5 | $5067 (20583) | RLE | $17700 → $BB80 → 48000B |
| 74 | 6 | $0B10 (2832) | RAW | $1A5E0 |
| 76 | 4 | $2500 (9472) | RLE | $EA60 → $BB80 |
| 72 | — | — | COPY | LAB_003D: $BB80 → buffer+0, 48000 bytes |

**9× LAB_0022 calls** (intro screens): total $14525 (83237) bytes

**Phase 2 (game data — final buffer state)**:
| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 131 | 2 | $6754 (26452) | RLE | $BB80 → buffer+0 (**40,000B output**) |
| 132 | 3 | $678C (26508) | RAW | $BB80 |
| 148 | 7 | $0A81 (2689) | RLE | $EA60 → $BB80 (**4,590B output**, overwrites Block 3 start) |

### bcdfb-bcdfn — Monster Sprite Format (CORRECT EXTRACTION)
13 files (b=map1, c=map2, ..., n=map13). RLE-compressed (bcdfu LAB_0043).
Each file has exactly **42 directory entries** with 12-byte header + 28-byte entries
(546 entries total across all 13 files) — but entries sharing `data_off` are a
**normal/mirrored pair of the same image**, not separate animation frames, so
this yields **204 distinct sprites**, not 546.
7-plane sequential planar decode (mask=plane0, color=plane1-6, EHB).
⚠ **Bit order: standard.** Plane 1 → bit 0 (LSB), plane 6 → bit 5 (EHB half-bright MSB).
The half-bright problem was the palette loading (`range(64)` vs `range(32)`), not the bit order.
204 sprites extracted across all 13 files — see `scripts/extract_monsters.py`.

**Palette: one table, not two.** Monster sprites and dungeon walls/floors share
the single palette at **file** offset `0x2C6` (NOT `CODE+0x2C6` = file 0x2EA —
that's mid-table, 18 words past the end, into unrelated file content). Loading
from `36+0x2C6` gives blue ogres because it's reading the wrong bytes, not
because there's a second "dungeon" palette to fall back to.

The table stores only **32 base colors** (64 bytes). EHB half-bright entries
32-63 must be **computed**, and the computation has to happen on the 4-bit
nibble, not the scaled 8-bit value:

```
correct:   half = (nibble >> 1) * 17        # shift the nibble, then scale
wrong:     half = (nibble * 17) // 2        # scale, then halve — off by up to
                                             # 8 per channel on every odd nibble
```

`bclib.ehb_palette` / `amiga-planar.ts`'s `ehbPalette` do this correctly by
computing from the raw palette word. `bclib.load_palette_json` — which reads
a plain `{index: [r,g,b]}` JSON with no nibble to recover — had the wrong
(`// 2` on the scaled value) formula until this was caught; it now recovers
the nibble as `component // 17` (exact, since every stored component is
`nibble * 17`) before halving. Using `range(64)` instead of computing entries
32-63 at all reads past the palette table entirely → garbage half-bright colors.

**File structure:**
- **12-byte header**: 2 pad + 2 map_id + 2 extra_id + 2 extra_id2 + 4 pad
- **42 × 28-byte directory entries** (starting at byte 12)
- **RLE-compressed data** after the directory (bcdfu LAB_0043 algorithm)
- Directory data offsets index into **concatenated decompressed stream**

**Directory entry (28 bytes):**
| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| +0 | 4 | data_off | offset into concatenated decompressed data |
| +4 | 4 | bpr | bytes per plane = (width/8) × total_height |
| +8 | 4 | reserved | 0 |
| +12 | 2 | BLTSIZE | (height<<6) \| (width/16 + 1) |
| +14 | 2 | modulo | screen modulo |
| +16 | 4 | reserved | 0 |
| +20 | 2 | type | 0x0100/0x0500 (frame variant) |
| +22 | 2 | width | pixels |
| +24 | 2 | height | total rows (sum of all frame heights) |
| +26 | 2 | reserved | 0 |

**Animation frames:** Entries sharing data_off are frames of the same sprite.
Frame heights = base_h or base_h+1, where base_h = height // n_frames.
Frames are concatenated within each plane: frame0 rows, frame1 rows, etc.

**Data block layout (per sprite, 7-plane sequential):**
```
plane_0 = raw_data[0 : bpr]               ; mask (1-bit, 1=opaque)
plane_1 = raw_data[bpr : bpr*2]           ; color bit 0 (LSB)
plane_2 = raw_data[bpr*2 : bpr*3]         ; color bit 1
...
plane_6 = raw_data[bpr*6 : bpr*7]         ; color bit 5 (MSB/half-bright)
```

**Example frame splits (from bcdfb):**
| data_off | Width | Total H | Frames | Frame Heights | Description |
|----------|-------|---------|--------|---------------|-------------|
| 0 | 96 | 129 | 2 | 65, 64 | Two-frame monster animation |
| 10836 | 96 | 124 | 3 | 42, 41, 41 | Three-frame animation |
| 31836 | 64 | 79 | 3 | 27, 26, 26 | Three-frame small monster |
| 65394 | 32 | 32 | 8 | 4,4,4,4,4,4,4,4 | 8-frame tiny sprite |
| 66290 | 16 | 17 | 8 | 3,2,2,2,2,2,2,2 | 8-frame very small sprite |


### Character Record Layout (from WHDLoad trainer)
0xA8 (168) bytes per character, 4 chars:
- +$00: name
- +$4E: current HP (w)
- +$50: max HP (w)
- +$52: experience (l)
- +$56: gold (w)
- +$64..$68: current STR/INT/WIS/CON/CHR (b)
- +$6E..$72: max STR/INT/WIS/CON/CHR (b)
- +$A2: level/XP (w)
Base: $1758(A5), offsets: +0, +$A8, +$150, +$1F8

### RLE Algorithm (bcdfu.asm LAB_0043)
- ctrl byte 0x00 = end of stream
- bit0=1: literal copy (byte>>1) bytes from source
- bit0=0: fill next byte (byte>>1) times

### bcdfs — Map Data Format (220KB, all 13 maps)
**NOT a save file** despite being read by LAB_0047. Contains ALL map layouts.

Each of 13 maps has:
1. **52-byte global offset table** at file offset 0 (13 longwords, buffer-relative offsets). Maps 2-13 have 52 zero bytes (their tables are at the start of each map's section).
2. **Per-map header** (7 bytes): starts at file offset 52 for map 1; subsequent maps at absolute position `52 + offset_table[N]`. Header = `height 00 00 00 00 00 00`. For map 1, height = 30 lines.
3. **Variable-length line data** — grid is **256 columns wide** (not 64). Format per line:
   - **Per-line header (2 bytes)**: `col_start col_end` (each 0-255, e.g. `1F F2` = cols 31-242). Lines with `00 00` encode a **single transition cell** (col 0).
   - **Square records (4 bytes each)**: `0F F1 00 00`
     - nibble0: terrain flags (+1 wall, +2 dark, +4 spell_fail, +8 water; 0=floor/open)
     - nibble2-3: always `0F`
     - nibble3 nybble: 4 bits = level number (1-N per 256×N map)
     - nibble4: 4 bits = wall flags (+1 N / +2 E / +4 S / +8 W)
     - nibble5-6: 12 bits = unique number (0=empty, 1-FFF=item/monster/structure data follows)
4. **Line count per map**: maps 1-5 have 30 lines (rows 0-29), maps 6-7 have 24 lines, maps 8-13 have 22 lines, except map 13 which has only 1 line with cols 64-255 (a special transition row).
5. **3950+ bytes 0x00** — per-map scratch space for items dropped on floor
6. **Items/monsters/structures** — inserted between squares using unique numbers; stacking uses chained unique numbers

### Monster Entry (~40 bytes, referenced from bcdfs square unique number)
```
a aa 80 bb cc de F0 fg 0h ii jj jj 0k kk ll ll 00 0m 00 00 0n nn ...
```
- `bb`: **graphics file selector** (which bcdfX file provides the sprite)
- `cc`: chance-to-hit / XP variance
- `d`: door-pass flag (bit)
- `e`: attack speed (nibble)
- `f/g`: move speed (nibbles)
- `h`: attack method (nibble)
- `ii`: magic attack intensity
- `jjjj`: HP
- `kkk`: carry item number
- `llll`: spell set flags
- `m`: movement type
- `nnn`: stacking number
- `oooo`: XP gain
- `pppp`: attack strength
- `q`: position on square (0-4: NW/NE/SE/SW/center)

### Item Entry (~20 bytes, referenced from bcdfs square unique number)
```
a aa bb bb cc cc d e ff gg ...
```
- `bbbb`: gfx number (determines weapon properties)
- `cccc`: **name offset into bcdft** (decompressed data); 0 = first name at byte 115978
- `d`: position on square (nibble)
- `e`: who can use (bitmask: +1 Fighter, +2 Cleric, +4 Druid, +8 MU)
- `ff`: item type (defines trailing bytes)
- `gg`: position in container

### bcdfo Descriptor Table (bcdfp.asm LAB_010D)
28-byte entries:
- +0: word → pointer table index (base address)
- +2: long → source data offset (added to base)
- +6: long → stride per bitplane
- +10: long → alternate source offset (if flag bit1=1)
- +14: word → BLTSIZE = (h<<6)|<w/8
- +16: word → screen modulo
- +18: word → X position (runtime)
- +20: word → Y position (runtime)
- +22: word → flags (bit0=clipped path LAB_0124, bit1=alternate addr)
- +24: word → width pixels
- +26: word → height pixels

## Extracted Assets

All extraction scripts live in `scripts/`. Output goes to `data/blackcrypt/extracted/`.
Use greyscale by default unless the palette is confirmed correct by the user.

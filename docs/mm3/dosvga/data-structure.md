# Might & Magic III (DOS/VGA) — data structure

Format documentation for `data/mm3/dosvga/`. All offsets file-relative.

## Inventory

| File | Size | Role |
|------|------|------|
| `MM3.CC` | 3,430,389 | the game data archive (558 entries) |
| `MM3.EXE` | 280,032 | packed executable (Executrix by Knowledge Dynamics + Borland TLINK; uncompressed FBOV overlay at 0x286C0) |
| `MM3.CUR` | 207,551 | current-game data — **CC archive** (parses with `dos_cc.py`, 240 entries: many 832-byte maze blocks + character/party records; per-entry semantics open, see TODO `mm3-cur-format`) |
| `MM3.CFG` | 4 | `00 01 20 02` (sound config) |
| `Mm3.com` | 776 | copy-protection loader: hooks `INT 21h`, patches a far call in the loaded MM3.EXE to a short jump on file-close — not a plain overlay stub |
| `MM3.$$$` | 28,600 | 8-bit PCM scratch (byte histogram clustered 0x97–0xD8) — not a CC archive |
| `Manual.pdf` / `keys_3_5.pdf` | | manual + key chart (naming oracle) |

## MM3.CC container — confirmed

Same container family as MM4/5 (`Xeen`) but with MM3-specific filename
hash, header cipher and compression. Documented by ReWolf
(`https://github.com/rwfpl/rewolf-mm3-dumper`,
`http://blog.rewolf.pl/blog/?p=1202`); this project's Python port
(`scripts/mm3lib/dos_cc.py`) is verified byte-exact against the compiled
reference on **all 556 compressed entries**.

```
FileHeader { u16 LE numEntries; FileEntry entries[numEntries]; }   ; 8-byte entries
FileEntry  { u16 hash; u16 offsetLo; u8 offsetHi; u16 compressedSize; u8 pad; }
             offset = (offsetHi << 16) | offsetLo (file-relative)

Header cipher (decrypt): key = 0xAC; per byte: b = rotl8(b,2) + key; key += 0x67
Filename hash: h = rotl16(h, 9) + upper(c)   ; upper: (c & 0x7F) < 0x60 ? c : c - 0x20

Entries 0 and 1 are special (uncompressed strings — copy-protection text).
All other entries: 4-byte descriptor { u8 init; u8 init; u16 BE decSize }
followed by an LZHUF stream (canonical lzhuf.c with per-stream dictionary
init byte = most-common byte of the output).
```

**Verification:** 541/558 entries resolve to real filenames; 556/556
compressed entries decode byte-identical to the reference C++ output
(0x00-padded stream tails, matching the C reference's past-end reads).

## Asset formats (by extension)

| Ext | Count | Format | Status |
|-----|-------|--------|--------|
| `.raw` | 12 | 64000 B = 320×200 raw 8-bit VGA screen (no palette in file) | **confirmed** geometry + palette (see "DOS 256-colour palette" below) |
| `.vga` | 120 | sprite container (wall/terrain/UI animation frames) | **confirmed** — container, cells, and scanline RLE (see "Scanline opcode grammar") |
| `.mon` | 81 | monster sprites, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.fac` | 31 | character faces, same container (32×32 cells) | **confirmed** — container, cells, and scanline RLE |
| `.icn` | 52 | UI icons (36×20 cells) | **confirmed** — container, cells, and scanline RLE |
| `.pic` | 63 | object/screen art, same container | **confirmed** — container, cells, and scanline RLE |
| `.out` | 42 | full-screen UI art, same container | **confirmed** — container, cells, and scanline RLE |
| `.maz` | 64 | map-section text: small records `\x02 <name> \x01\x00` (location names) + big records `\x03 <section> (\x0b <3-digit index>)? <description> \x00...` (area descriptions) | **confirmed** framing + text extracted to `maze-text.json` |
| `.dat` | 22 | monster stat tables, **90 values each** (90 = monster-type count; per-field width inferred from payload length: `MonHP.dat`/`MonGems.dat` = u16 LE, `MonExp.dat`/`MonGold.dat` = u32 LE, the rest u8) | **confirmed** shapes + counts + widths; monster-id order is the game-internal table order, **61/90 ids name-mapped** (see below) |
| `.s` | 7 | unsigned 8-bit PCM speech, 8000 Hz | **confirmed** (ModdingWiki + byte histogram); converted to WAV |
| `.m` | 15 | music (format open) | open |
| `.til` | 6 | minimap tile sets, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.sky` | 3 | sky images, same sprite container | **confirmed** — container, cells, and scanline RLE (not raw 320×200 as earlier guessed) |
| `.brd` | 4 | battle-board layouts, same sprite container | **confirmed** — container, cells, and scanline RLE |
| `.spl` | 4 | special screens | open — **not** the sprite container (unlike `.til`/`.sky`/`.brd`) |
| `.drv` | 8 | per-sound-card drivers (incl. embedded SFX) | open |
| `.bin` | 6 | text data (`spldesc`, `jester`, `award`, `tavern`, `quest`, `copy`) | **confirmed** null-separated text |

Unnamed entries (16) identified by content: 2 copy-protection strings,
intro text ("In the days when Fountain Head..."), 4 map-text files
("The Arena", "No text in this file."), 7 extra speech files
(0x8631–0x8637, 80-centered PCM), 1 object sprite (0x7A39). Entry `0x8F99`
is now named — it's `vga`, the VGA display driver (x86 code; see "DOS
256-colour palette" below) — retracting the earlier "1 monster sprite"
classification.

### `.dat` monster id → name mapping — **61/90 confirmed**

The internal monster-id order (index into every `Mon*.dat` table) isn't
shipped with a name table anywhere in the game data. Resolved by
cross-referencing each id's decoded `(HP, AC, Speed, NumAttacks)` 4-field
fingerprint against the community bestiary at
[shrines.rpgclassics.com/pc/mm3/monsters.shtml](https://shrines.rpgclassics.com/pc/mm3/monsters.shtml)
(89 monsters, alphabetical, itself sourced from the game). 61/90 ids
matched a unique name with all 4 fields exact and **zero ambiguity** — no
name matched more than one id, no id matched more than one name (e.g. id
56 = `333/16/33/6` = Major Demon, id 66 = `666/33/66/4` = Major Devil).

8 more ids have a plausible 3-of-4-field near match (Goblin, Cryo Spore,
Castle Guard, Gargoyle, Cult Leader, Mummy, Rat Overlord, Mummy King) —
each differs from its candidate in exactly one field (usually Speed or
NumAttacks), which could be a genuine game-version stat revision or a
bestiary transcription error; **not** included in the confirmed mapping.
21 ids have no candidate at all — the bestiary lists 89 names against 90
internal ids, so at least one monster is unlisted there.
→ `scripts/mm3lib/mm3_monster_names.json` (mapping + evidence),
`data/monster-stats.json` (`names` array, extractor-attached).

## Sprite container — **SOLVED** (container, cells, scanline RLE)

```
u16 frameCount
frameCount × { u16 cell1Offset; u16 cell2Offset }     ; cell2 = 0 = none
cells at offsets: { u16 xoff; u16 w; u16 yoff; u16 h } + scanline RLE
```

Shared by `.vga/.mon/.fac/.icn/.pic/.out/.til/.brd/.sky` (`.spl` is a
different, still-open format). A frame is cell1 drawn, then cell2 drawn
over it where present. Cell geometry verifies across hundreds of files
(e.g. `caswl1.vga`: 13 frames, 168-wide wall cells; `dwarf1.fac`: 32×32
face cells; `cast.icn`: 36×20 icons). This container is only
superficially "Xeen-style" (MM4/5) — the frame/cell headers match, but
the scanline opcode grammar below **does not**; see the correction.

### Line framing — **confirmed**

```
cell at offset: { u16 xoff; u16 w; u16 yoff; u16 h }
per row:        u16 LE lineLength        ; 0 = blank (fully transparent) row, 2 bytes total
                u16 LE xSkip              ; starting x within the cell — a real u16,
                                          often non-zero (only its high byte is always 0)
                opcode stream             ; lineLength = 2 + nopcode bytes
```

The row loop terminates only on landing **exactly** at `lineLength` — an
opcode stream that overran the line would run the decoder away, so the
encoder can never emit one (confirmed from the driver's `cmp si,bp / je`
exit condition, not inferred). Cell `width` is **not** a scanline bound:
the non-mirrored blit path skips the width field entirely
(`vga`+0x1DAE `inc si; inc si`) — only the horizontal-mirror variant
reads it, for its right-to-left origin. A line legitimately emits fewer
than `width` pixels; trailing transparent pixels simply aren't encoded.

### Scanline opcode grammar — **SOLVED**

MM3 is **not** the MM4/5 Xeen grammar (3-bit cmd + 5-bit len, 8 opcode
classes, pattern/ramp + stream-copy commands) — that earlier assumption
only coincidentally decoded 76–93% of lines per extension, then desynced.
The real grammar has three commands, found by disassembling the game's
own blitter (below):

| Opcode | Bytes | Meaning |
|--------|-------|---------|
| `0x00`–`0x7F` | `1 + (op+1)` | **literal run**: next `op+1` bytes are palette indices (1–128 px) |
| `0x80`–`0xBF` | `1` | **transparent skip** of `(op & 0x3F) + 1` px (1–64) — destination advances, source untouched |
| `0xC0`–`0xFF` | `2` | **run**: next byte is a palette index, drawn `(op & 0x3F) + 3` times (3–66) |

There is no fill/stream-copy/pair/pattern command and no ramp table (a
corpus-wide byte search for Xeen's `PATTERN_STEPS` table returns zero
hits anywhere in `MM3.EXE`, the reconstructed exe, the `vga` driver, or
any of the 558 `MM3.CC` entries). The end-of-line-truncation hypothesis
from the earlier pass is **refuted** — there is no clamp anywhere in the
decoder; every opcode always lands exactly on the line boundary.

**Decoder location** (not in `MM3.EXE` — same pattern as the palette):
the blitter lives in the `MM3.CC` VGA display driver (entry hash
`0x8F99`, filename `vga`, see "DOS 256-colour palette" below). API
jump-table entry 7 (`vga`+0x0E92, called with `[bp+8]`=sprite-file
segment, `[bp+0xA]`=frame index, `[bp+0xC/0xE]`=dest x/y, `[bp+0x10]`=flags
— flag bit 0 selects horizontal mirror) → dispatcher `vga`+0x1D70 → row
loop `vga`+0x1DC2–0x1E20 (mirrored variant at `vga`+0x1E22–0x1E36; the
mirror's `std`/`dec di` confirms it's real, not a decode artifact). 9
total blit variants share the byte-identical opcode core (`and cl,0x3f /
add cl,0x3` and `and ax,0x3f / inc ax`, verified at all 18 call sites);
the 4 non-mirror variants (shadow/translucent/scaled draws?) are
unidentified — see TODO `mm3-dos-blit-variants`.

**Verification** — two independent whole-corpus invariants, **zero
deviation** across all 402 sprite-container files:
- **Byte-framing**: every cell ends exactly at the next cell offset from
  the frame table, and every line's opcode stream lands exactly on its
  declared `lineLength` — **3,823/3,823 cells, 157,330/157,330 lines**
  (`scripts/verify_mm3_dos_sprites.py`).
- **Pixel-bound**: every line's `xSkip + pixels-emitted ≤ cell width` —
  **0/157,330 overruns** (vs. 17,664 overruns, 14% of "exact" lines,
  under the old Xeen grammar).
- **Cross-port mask check** against the byte-exact-verified Amiga port:
  `archer.mon` 5/5 frames, 0 mask mismatches; corpus-wide 821/1,292
  shared frames pixel-exact, DOS-only (possibly-spurious) pixels
  0.58% and one-sided (the DOS mask is a strict subset of Amiga's in
  1,062/1,292 frames — cross-port art differences, not a DOS decode bug).
  Independent re-check on the 32×32 `.fac` faces: 32/33 face cells
  decode with every row filling exactly `width` px (the lone exception,
  `elf3.fac` row 13, has one genuine transparent pixel — a skip opcode in
  the art), and the DOS decode's palette-index colours map 1:1 onto the
  Amiga face colours (e.g. DOS index 11 → `(161,161,161)` vs Amiga
  `(153,153,153)` — the ports' own 6-bit vs 5-bit palettes), confirming
  both the grammar and the palette from the data side.
- Renders (`build/cache/mm3/dos-sprite-renders/`) at the confirmed
  256-colour palette: `archer.mon` (blue-tunic archer drawing a bow),
  `beholder.mon`, `bank.out`, `caswl1.vga`, `castle.til`, `dwarf1.fac` —
  all coherent, recognisable art.

→ `scripts/mm3lib/dos_sprite.py` (decoder, every rule cites its `vga`+
offset), `scripts/verify_mm3_dos_sprites.py` (corpus verifier). Wired into
the extractor/viewer pipeline via `scripts/extract_mm3_dos_sprites.py`
(`mm3-dos-sprite-pipeline` closed) — every sprite-container file renders
to a PNG strip + JSON sidecar under `public/assets/mm3/dosvga/sprites/`,
hooked into `tools/shared/game-config.ts`'s mm3/dosvga `buildAssets`.

## MM3.EXE / palette

MM3.EXE is Executrix-packed; the uncompressed FBOV overlay (46 segments,
`ovrsize` 0x1BF10) holds game code.

### DOS 256-colour palette — **SOLVED**

The palette is **not in MM3.EXE**. MM3.EXE never touches the VGA DAC and
never calls `INT 10h AH=10h`; all VGA work lives in a display driver
loaded from `MM3.CC`.

| | |
|---|---|
| Driver | `MM3.CC` entry hash `0x8F99`, filename **`vga`**, CC offset `0x04063F`, 8,683 B → 15,570 B (LZHUF) |
| Palette | **`vga`+0x39C, 768 B, 256 × `{u8 r,g,b}` 6-bit (0–63)** |

Driver layout: `0x000–0x035` 18-entry API jump table · `0x036–0x335`
working palette (DAC upload source) · `0x336–0x39B` six 17-byte EGA/CGA
attribute blocks (`INT 10h AX=1002h`) · **`0x39C–0x69B` master 256-colour
palette** · `0x9BE` display-mode index.

Install (API entry 5, `vga`+0x0F → `0x1138`): if `[0x9BE]==0` (VGA mode
13h), scale `master[i]*f/128` into `0x36` for `f` stepping `0x80→0`
(fade), then `0x11E4` writes DAC index 0 to port `0x3C8` and shifts all
768 bytes to port `0x3C9` via a **fully unrolled** `lodsb; out dx,al` ×768
(`0x11F8`–`0x17F7`). Note `mov **bx**,0x3C8` at `0x11EA` — not `mov dx` —
which is why byte-scanning for `mov dx,imm` port constants found nothing.

**There is exactly one palette.** Nothing writes `0x39C` in VGA mode and
no file is ever loaded into it; the only runtime variation is the global
fade brightness. `[0x9BE]` selects the *path* (0 = VGA 256-colour, 1–5 =
Tandy/EGA/CGA via the `0x336` tables), and only VGA uses this table. Mode
13h is set by an obfuscated `mov ax,0xFE58; add ax,dx; int 10h` where `dx`
is a self-checksum of the driver (`dx = 0x01BB`, giving `AX=0x0013`) — an
anti-tamper check.

**Verification:** invoking the driver's own routine under Unicorn and
capturing port `0x3C9` yields **768/768 bytes identical** to `vga`+0x39C.
All 12 `.raw` screens render as coherent artwork; the Amiga port ships the
same `.raw` screens pixel-aligned (DOS index → Amiga colour consistency
1.00 across 7 screens), and nearest-colour re-quantisation of the DOS
render reproduces the Amiga `create.raw` for 77.4 % of pixels vs 29.9 %
for the VGA BIOS default and 1.1 % for random.
→ `build/cache/mm3/palette/mm3_dos_palette.json` (256 × `{r,g,b}`, 0–63,
the original emulation-derived artifact). No emulation is actually needed
to *extract* the table, only to have discovered where it lives — it's a
static byte range inside a normally LZHUF-decompressed `MM3.CC` entry, so
`scripts/mm3lib/dos_palette.py` reads it directly via the existing
`dos_cc` container reader (confirmed byte-identical to the artifact
above) and is what the extraction pipeline actually runs.

### Executrix self-unpacking — **SOLVED** (`tools/mm3_executrix_unpack/run.py`)

The packed exe's stub (MZ entry CS:IP = 0x0000:0x0000; file 0x200 =
`e9 99 00` jmp 0x29C) was traced and emulated under Unicorn
(`tools/mm3_executrix_unpack/run.py`): it reads the embedded original MZ
header at file 0x699 (37 bytes into its own data area), seeks to the
compressed image at `[0x48c]<<4 + 0x699` = 0x899, copies itself high
(`ES = [0x49a]-[0x492]-0x300`), and runs an adaptive-Huffman LZ
decompressor (3-byte table entries, 8-entry jump table at 0x27E, code
length in `[0x90]` starting at 9, tree at `[0x4a2]:bp*3`, mask table at
0x270).

The old "~31 KB fault" was **an emulator setup artifact, not a decoder
bug.** The stub computes its in-memory layout from the *original* load
segment:

    [0x492] = 0x4c2 - CS_original   (stub 0xb4, after entry)
    tree    = CS_high + [0x492]     (stub 0x278, after self-copy-high)
    input   = CS_high:0x4d1         (stub 0x28a, 0x2000-byte refill buf)

The input buffer spans `[high_CS*16+0x4d1, high_CS*16+0x24d1)`, and the
tree base is `(high_CS + [0x492])*16`. They overlap iff

    [0x492]*16 - 0x4d1 < 0x2000  ⇔  [0x492] < 0x24e
    ⇔  CS_original > 0x4c2 - 0x24e = 0x274

PSP=0x300 gives CS_original = 0x310 > 0x274 → overlap → the tree (which
grows at `es:[bp*3]`, bp up to 0x1000+) clobbers buffered input / the
walk runs past the tree → the old fault. With **PSP ≤ 0x200** (CS_original
≤ 0x210) there is no overlap and the decompressor runs to completion, then
the relocation fixup pass runs (visible as the +LOAD_SEG delta on the
first instructions). A PSP sweep confirms the clean threshold exactly at
CS_original = 0x274 (PSP=0x264): PSP 0x80–0x250 → CLEAN, 0x274+ → FAULT.
The doc's "different top-of-memory value" experiments changed TOP_SEG,
which cancels out of the layout — the load segment is the variable that
matters.

Verified: the decompressed body begins `ba 7f 1a 2e 89 16 3c 02 b4 30
cd 21 ...` = the doc's pre-relocation `ba 6f 18 ...` plus LOAD_SEG 0x210
relocation delta. Output:
`build/cache/mm3/MM3_original_reconstructed.exe` (279,985 B =
0x200 embedded header + 0x443b1 decompressed body). This makes the
game's code+data statically inspectable.

**Caveat (see TODO `mm3-recon-exe-extent`):** the reconstruction is genuine
only to file `~0x288F0` (root code `0x200–0x18120`; overlay `INT 3F` stub
area `0x18120–0x188F0`, 311 stubs; DGROUP `0x188F0–0x288F0`, exactly
64 KB) — bytes beyond that are stale packed-file content left over from
`run.py`'s trailing-zero trim, not decompressed output. The palette table
turned out to live in `MM3.CC`, not this exe (see "DOS 256-colour palette"
above); the FBOV overlay's own segment operands don't resolve with any
single relocation delta and need reading from a live memory dump, not the
static file.

### Runtime loading architecture — how the `vga` driver gets loaded and called

The "segment operands don't resolve statically" caveat above is explained
by the loader machinery, traced by booting the real packed `MM3.EXE` under
a Unicorn harness (DOS/BIOS int stubs + a real memory allocator + VGA
port/vblank emulation). Body offsets below are in the decompressed body
(loaded at LOAD_SEG `0x210`, DS `0x1A7F` = body `0x186F0`):

1. **FBOV loader** — segment `0x18A9`, body `0x169A9`. Opens the game's
   own `MM3.EXE`, reads the **packed** MZ header (20 B), and recovers the
   FBOV offset from its size fields: `e_cp=324, e_cblp=192` →
   `(324-1)*512+192 = 0x286C0` (Executrix crafted these fields so the
   arithmetic lands on the overlay). Seeks there, verifies `'FBOV'`
   (`cmp word [bp-0x14],0x4246` at body `0x16A4B`), saves the region end
   (`0x286D0`) at DS `0x114/0x116`, then loads the 46 segments
   (`0x16CB4`, `0x16D81`).
2. **Segment map** — DS `0x19D0:0x1A0`, 46 × 8-byte entries
   `{u16 seg; u16 size; u16 flags; u16 w4}`, read by `0x16C34` (which
   walks it from `0x1A0` to `0x310`, step 8, and patches each loaded
   segment: `[seg+4:6] += FBOV_base`, `[seg+0x18] = 0x4CF`). The image's
   own segments (root `0x210` … data `0x1A7F`) are listed first; the
   loader reads them from the file back into their in-image positions
   (self-load). This table is the FBOV `seginfo`; it lives in the image,
   not the file (the game never seeks to the MZ-relative `exeinfo`).
3. **CC code overlays** — the display driver and other loadable modules
   come from `MM3.CC` entries (the `vga` driver = entry `0x8F99`; also the
   PIT/timer driver entry 33, etc.). The boot loads them via the CC reader
   (`0x145F` segment, body `0x12636` = the documented CC open/decrypt) into
   allocated memory, and the game calls them through **far-branch-table
   stubs** that are runtime-patched.
4. **FBT dispatch** — segment `0x145F`'s stub table at body `0x14F53+`
   (`push word cs:[0x2A73]; mov ax,ID; push ax; retf`, 10 B each, IDs
   `0x03/0x06/0x0C/…/0x30`). The loader writes the driver's runtime
   segment into `[0x145F:0x2A73]`; each stub then jumps to
   `[driver_seg]:ID`. In the boot harness the driver loaded at segment
   `0x92FC`, and `[0x145F:0x2A73] = 0x92FC` — the IDs are indices into the
   driver's own API jump table (`0x000–0x035`), confirming the driver's
   entry points (`0x03→0x1498`, `0x06→0x3624`, `0x0C→0x1256`,
   `0x2D→0x15A9`, `0x30→0x2812`, …). This is why the far-call segment
   operands in the static image don't resolve — the target segment is a
   runtime allocation, written into the stub table at load time.

The harness run (DOS/BIOS stubs, allocator, port 0x3DA vblank, AdLib
0x330/0x331, keyboard) boots the packed exe to mode 13h, through the
resource-table sort, and into the driver's screen/palette code — the same
driver path independently confirmed by the palette and blitter traces.


## Still open / paths tried

See `docs/mm3/TODO.md`.

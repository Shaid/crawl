# Might & Magic III (DOS/VGA) — data structure

Format documentation for `data/mm3/dosvga/`. All offsets file-relative.

## Inventory

| File | Size | Role |
|------|------|------|
| `MM3.CC` | 3,430,389 | the game data archive (558 entries) |
| `MM3.EXE` | 280,032 | packed executable (Executrix by Knowledge Dynamics + Borland TLINK; uncompressed FBOV overlay at 0x286C0) |
| `MM3.CUR` | 207,551 | current-game data (format open) |
| `MM3.CFG` | 4 | `00 01 20 02` (sound config) |
| `Mm3.com` | 776 | DOS overlay stub loader (loads MM3.EXE as an overlay) |
| `MM3.$$$` | 28,600 | temp/scratch file (format open) |
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
| `.raw` | 12 | 64000 B = 320×200 raw 8-bit VGA screen (no palette in file) | **confirmed** geometry; palette open (`mm3-dos-palette`) |
| `.vga` | 120 | Xeen-style sprite container (wall/terrain/UI animation frames) | **confirmed** container + cell geometry |
| `.mon` | 81 | monster sprites, same sprite container | container confirmed; scanline-RLE variant open (`mm3-mon-rle`) |
| `.fac` | 31 | character faces, same container (32×32 cells) | container + cells confirmed |
| `.icn` | 52 | UI icons (36×20 cells) | container + cells confirmed |
| `.pic` | 63 | object/screen art, same container | container confirmed |
| `.out` | 42 | full-screen UI art, same container | container confirmed |
| `.maz` | 64 | map-section text: small records `\x02 <name> \x01\x00` (location names) + big records `\x03 <section> (\x0b <3-digit index>)? <description> \x00...` (area descriptions) | **confirmed** framing + text extracted to `maze-text.json` |
| `.dat` | 22 | monster stat tables, **90 values each** (90 = monster-type count; `MonHP.dat` = u16 LE, `MonAC.dat` = u8...) | **confirmed** shapes + counts; monster-id order is the game-internal table order (not yet name-mapped) |
| `.s` | 7 | unsigned 8-bit PCM speech, 8000 Hz | **confirmed** (ModdingWiki + byte histogram); converted to WAV |
| `.m` | 15 | music (format open) | open |
| `.til` | 6 | minimap tile sets | open |
| `.sky` | 3 | sky images | open (likely raw 320×200) |
| `.brd` | 4 | battle-board layouts | open |
| `.spl` | 4 | special screens | open |
| `.drv` | 8 | per-sound-card drivers (incl. embedded SFX) | open |
| `.bin` | 6 | text data (`spldesc`, `jester`, `award`, `tavern`, `quest`, `copy`) | **confirmed** null-separated text |

Unnamed entries (17) identified by content: 2 copy-protection strings,
intro text ("In the days when Fountain Head..."), 4 map-text files
("The Arena", "No text in this file."), 7 extra speech files
(0x8631–0x8637, 80-centered PCM), 1 monster sprite (0x8F99), 1 object
sprite (0x7A39).

## Xeen-style sprite container — confirmed (cells)

```
u16 frameCount
frameCount × { u16 cell1Offset; u16 cell2Offset }     ; cell2 = 0 = none
cells at offsets: { u16 xoff; u16 w; u16 yoff; u16 h } + scanline RLE
```

Same family as the Xeen engine's sprite format (ModdingWiki/Xeen wiki
"Sprite File Format" — MM3 precedes MM4/5 and shares the format). Cell
geometry verifies across hundreds of files (e.g. `caswl1.vga`: 13 frames,
168-wide wall cells; `dwarf1.fac`: 32×32 face cells; `cast.icn`: 36×20
icons).

### Line framing — **confirmed** (all extensions)

```
cell at offset: { u16 xoff; u16 w; u16 yoff; u16 h }
per row:        u16 LE lineLength        ; 0 = blank row (2 bytes, 1 row)
                u8  xskip                ; cell-relative x (high byte of a u16
                                          xskip; always 0x00 in practice)
                u8  0x00                 ; xskip high byte (= 0) — the "marker"
                opcode stream            ; lineLength = 2 + nopcodes
```

Verification: **62/62 cells across 7 files** (mon/fac/icn/vga) end at
exactly the next cell offset from the frame table, zero deviation — the
row count equals `h` and each row's `lineLength` accounts for xskip + the
0x00 byte + opcodes. The earlier doc claim that `.fac/.icn/.vga/.pic`
cells "decode to coherent pixel counts" under the documented Xeen
semantics is **wrong** (a corpus-wide exact-consumption audit: `.pic`
52.0 %, `.out` 56.2 %, `.icn` 41.6 %, `.fac` 33.6 %, `.mon` 33.7 %,
`.vga` 45.0 % — no extension decodes cleanly under strict Xeen).

### Scanline opcode grammar — **partial** (see TODO `mm3-mon-rle`)

The opcode byte layout is Xeen-family (cmd = bits 7–5, len = bits 4–0;
cmd0/1 literal, cmd2 fill, cmd3 stream-copy, cmd4 pair, cmd5 skip, cmd6/7
pattern). A whole-corpus exact-consumption audit of the marker+Xeen model
(skip the 0x00 lead byte; cmd0/1 count = len+1; pair = len+2; pattern =
(op&7)+3) gives: `.fac` 93.2 %, `.icn` 90.0 %, `.mon` 76.4 %, `.vga`
81.6 %, `.pic` 78.8 %, `.out` 80.0 % of lines consuming exactly. The
residual lines all end in a literal/pattern/pair opcode whose params run
past the line end (opcodes 0x10–0x1F needing 17–32 literals are the top
failure class). The remaining ~7–24 % fit only if opcode params are
clamped at the line end (end-of-line truncation), which consumes every
line by construction and renders plausible silhouettes (archer frame 0 =
81-px-wide body, head ~30–40 px, bow-side leg region; dse/dwarf faces
~95 % fill) — but the encoder writing trailing no-op opcodes is
unverified, so the truncation reading is **hypothesis, not confirmed**.
See `docs/mm3/TODO.md` `mm3-mon-rle`.

## MM3.EXE / palette

MM3.EXE is Executrix-packed; the uncompressed FBOV overlay (46 segments,
`ovrsize` 0x1BF10) holds game code. The 256-colour palette used by the
`.raw` screens is **not in MM3.CC and not readable from the packed exe** —
it needs the unpacked executable (Universal Program Cracker 1.11 or
equivalent) or an emulator capture. See TODO `mm3-dos-palette`.

### Executrix self-unpacking — **partially working** (see TODO `mm3-mon-rle`)

The packed exe's stub (MZ entry CS:IP = 0x0000:0x0000; file 0x200 =
`e9 99 00` jmp 0x29C) was traced and emulated under Unicorn
(`/tmp/opencode/mm3_pure_low.py`): it reads the embedded original MZ
header at file 0x699 (37 bytes into its own data area), seeks to the
compressed image at `[0x48c]<<4 + 0x699` = 0x899, copies itself high
(`ES = [0x49a]-[0x492]-0x300`), and runs an adaptive-Huffman LZ
decompressor (3-byte table entries, 8-entry jump table at 0x27E, code
length in `[0x90]` starting at 9, tree at `[0x4a2]:bp*3`, mask table at
0x270). With PSP = 0x300 (stub CS = 0x310) the first **~30 KB of the
original exe decode correctly** (verified: the decoded stream begins
`ba 6f 18 2e 89 16 3c 02 b4 30 cd 21 ...` — a coherent DOS-version-check
+ PSP-access init sequence; the first 3 bytes match the packer's 3-byte
patch slot). The decode faults late (~31 KB, 1310 tree entries) on a
tree-walk chain entry whose code exceeds the assigned range (walk index
0x4A9B = 0xC389×3, read past the tree into unmapped memory) — the
sprite-decoder code sits beyond the fault point. The tree-buffer vs
input-buffer layout is the suspected culprit (tree at `[0x4a2]` overlaps
the stream copy when `[0x492]` is small); a different top-of-memory
value changes but does not remove the fault.

## Still open / paths tried

See `docs/mm3/TODO.md`.

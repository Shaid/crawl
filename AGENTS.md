# AGENTS.md — Project conventions for AI assistants

## Reverse Engineering

When working with disassembly files (`*.asm`), **add inline comments** to document
findings as you decode them. The assembly is the source of truth — annotations must
live alongside the code they describe.

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
- **LAB_0110**: Simple opaque screen blitter (2-pass: aligned words + edge pixels)
- **LAB_011B**: Screen-to-screen blit for scrolling

## Extracted Assets

All extraction scripts live in `scripts/`. Output goes to `data/blackcrypt/extracted/`.
Use greyscale by default unless the palette is confirmed correct by the user.

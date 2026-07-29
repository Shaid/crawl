# bcdft LZ77 Decompressor

Decompresses the `bcdf$t` file from Black Crypt (Amiga) by running the
game's own 496-byte 68k decompression engine (S_4) inside a musashi
CPU emulator.

## Why an emulator?

The S_4 engine uses a custom backwards-reading LZ77 algorithm with:
- 4-level bit tree for operation type decoding
- Variable-length offset/length codes with 3 lookup tables
- Circular buffer with self-modifying state
- Interleaved fixup relocation entries

Hand-translating this to Python consistently produced cascading bit-level
errors. Running the actual 68k code in an emulator guarantees correctness.

## Quick start

```bash
cd tools/bcdft_decompress
bash build.sh run
```

Output: `data/blackcrypt/extracted/bcdft_decompressed.bin` (166,676 bytes)

## How it works

1. `extract_sections.py` extracts S_0, S_4, and S_5 from the Amiga HUNK file
2. `emu.c` — a musashi-based 68k emulator — loads these into the correct
   segment chain layout, sets up initial registers (D6=3, A4=chain resolver),
   and runs the S_4 code until RTS
3. The decompressed output is written to `/tmp/s1_output.bin`
4. `build.sh` copies it to the project's extracted directory

## Known strings in output

| String | Offset |
|--------|--------|
| POTION OF WATER BREATHING | 118185 |
| POTION OF HEALING | 116628 |
| CANNOT PLACE ITEM IN INVENTORY | 120287 |
| CANNOT USE THIS SPELLBOOK | 120388 |
| THIS ITEM DOES NOT FIT IN | 120617 |
| FIGHTER / CLERIC / MAGIC USER / DRUID | 108681 |
| SPELL FAILED | 119198 |
| RAISE DEAD / CURE POISON / SHIELD / DISPEL MAGIC | 108068 |

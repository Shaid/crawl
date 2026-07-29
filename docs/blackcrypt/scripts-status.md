# Script Status — Confirmed Working

| Script | Extracts | Output | Verified? |
|--------|----------|--------|-----------|
| `scripts/extract_monsters.py` | 546 monster sprite frames from bcdfb-n | `monsters/` — PNG with correct palette | ✓ Identical to validated reference |
| `scripts/extract_clipper.py` | 751 images, 7 palettes, 22 sounds from clipper.clp | `extracted/clipper/` — PNG with alpha | ✓ Transparency correct, 0 cyan remaining |
| `tools/bcdft_decompress/` (C emulator) | 166KB decompressed bcdft data (item names, strings) | `extracted/bcdft_decompressed.bin` | ✓ Contains "POTION OF WATER BREATHING" at 118185 |

## Key Palette Locations

| What | bcdfq offset | File offset | Notes |
|------|-------------|-------------|-------|
| Monster sprites | **FILE offset** `0x2C6` | `0x2C6` | Has red/orange — correct for ogres |
| Dungeon walls/floors | **CODE** + `0x2C6` | `36 + 0x2C6 = 0x2EA` | Has brown/blue/grey |
| Title/Logo | CODE + `0x286` | `36 + 0x286 = 0x2AA` | 32-color |
| Raven logo | CODE + `0x266` | `36 + 0x266 = 0x28A` | 16-color |

**Both palettes:** 32 base colors + 32 computed EHB half-bright.
Monster palette at `0x2C6` (FILE), dungeon palette at `0x2EA` (CODE+0x2C6).

## RLE Algorithm (bcdfu LAB_0043)
- ctrl=0 → end of stream
- bit0=1 → literal copy (ctrl>>1) bytes
- bit0=0 → fill next byte (ctrl>>1) times

# Liberation (CD32) generator / view oracle (musashi)

`gen.c` runs the game's own PlotGen + CityGen and captiveII's wall-set / CMAP
pickers for one (world, zone), and optionally captiveII's static wall view
composer for a list of poses (vector objects skipped). No Amiga emulator: the
HUNK executables are relocated into a flat 16 MB space and exec/dos are stubbed.

```sh
bash tools/liberation/cd32/emu/build.sh            # -> build/cache/liberation/gen
build/cache/liberation/gen data/liberation/cd32/data 0 8 /tmp/w0z8.bin
LIB_VIEWS="23,43,1,3;23,41,1,0" LIB_VIEWOUT=/tmp/v.bin build/cache/liberation/gen data/liberation/cd32/data 0 8 /tmp/w0z8.bin
npx tsx tools/liberation/cd32/verify-view.ts 0 8 300   # TS composer vs this oracle
```

Output: grid 0x3000 (3 planes) | param block 1200 B (A5+0x1D7A; start cell at +32, facing +35)
| u16 wall set | u32 CMAP (captiveII CODE offset). View file: per pose 75-byte window +
6 x 2400 planar bytes. `LIB_BLITLOG=<file>` logs each blitter call (record bytes, mode).
Spec: docs/liberation/cd32/data-structure.md.

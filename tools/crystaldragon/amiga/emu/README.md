# Crystal Dragon `Unpack` oracle (musashi)

Runs the game's own `Unpack` (`Crystal_Dragon` hunk 0 `+0x0004`) on one packed file, to check the
TypeScript codecs in `../codec.ts` against the original 68k code. Not part of the asset build.

```sh
# relocated flat image of both hunks (hunk 0 at 0x10000)
python3 mkflat.py ../../../../data/crystaldragon/amiga/data/Crystal_Dragon /tmp/cd-flat.bin
M=../../../bcdft_decompress/musashi   # built by tools/bcdft_decompress/build.sh
gcc -O2 -w -I$M -I$M/softfloat -o unpack unpack.c $M/m68kcpu.o $M/m68kdasm.o $M/m68kops.o $M/softfloat.o -lm
./unpack /tmp/cd-flat.bin ../../../../data/crystaldragon/amiga/data/32 /tmp/32.bin
```

Registers on entry: A0 = packed file, A1 = output, A2 = 16 KB history ring, D0 = file size,
D1 = palette destination (SC only). Returns the unpacked size in D0. Result 2026-11-21:
86/86 `SA` sets byte-identical to `unSA`, level `cc` byte-identical to `unSF`.

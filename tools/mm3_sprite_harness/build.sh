#!/bin/bash
set -e
cd "$(dirname "$0")"
MUSASHI=../bcdft_decompress/musashi
gcc -I. -I"$MUSASHI" -I"$MUSASHI/softfloat" -O2 -o /tmp/mm3_sprite_emu \
    emu_sprite.c \
    "$MUSASHI/m68kcpu.o" "$MUSASHI/m68kdasm.o" "$MUSASHI/m68kops.o" "$MUSASHI/softfloat.o" -lm
echo built

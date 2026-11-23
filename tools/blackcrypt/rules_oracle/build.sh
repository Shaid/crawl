#!/usr/bin/env bash
# Builds the Black Crypt rules oracle against the musashi core already built by
# tools/bcdft_decompress/build.sh. Usage: ./build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
M="$here/../../bcdft_decompress/musashi"
[ -f "$M/m68kcpu.o" ] || { echo "build tools/bcdft_decompress first (./build.sh)"; exit 1; }
gcc -O2 -I"$M" -I"$M/softfloat" -o "$here/oracle" "$here/oracle.c" "$M/m68kcpu.o" "$M/m68kdasm.o" "$M/m68kops.o" "$M/softfloat.o" -lm
echo built "$here/oracle"

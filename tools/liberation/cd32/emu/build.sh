#!/usr/bin/env bash
# Build the Liberation generator/view oracle (gen.c) against musashi.
# Output: build/cache/liberation/gen (repo-relative). Reuses the musashi tree
# tools/bcdft_decompress/build.sh prepares (cloning it there if absent).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
M="$ROOT/tools/bcdft_decompress/musashi"
OUT="$ROOT/build/cache/liberation"
if [ ! -f "$M/m68kops.o" ]; then
  (cd "$ROOT/tools/bcdft_decompress" && bash build.sh >/dev/null)
fi
mkdir -p "$OUT"
gcc -O2 -w -I"$M" -I"$M/softfloat" -o "$OUT/gen" "$HERE/gen.c" \
  "$M/m68kcpu.o" "$M/m68kdasm.o" "$M/m68kops.o" "$M/softfloat.o" -lm
echo "$OUT/gen"

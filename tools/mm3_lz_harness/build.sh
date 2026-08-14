#!/bin/bash
# Build the MM3 (Amiga) LZ oracle harness.
# Usage (from anywhere): bash tools/mm3_lz_harness/build.sh
#
# Steps:
#   1. Extract the root CODE hunk from data/mm3/amiga/Might&MagicIII into
#      build/cache/mm3/code0.bin (the decompressor lives at payload 0x55C4).
#   2. Reuse the musashi 68k objects from tools/bcdft_decompress/musashi/
#      (compile them if absent).
#   3. Build the harness.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MUSASHI="$ROOT/tools/bcdft_decompress/musashi"
CACHE="$ROOT/build/cache/mm3"
EXE="$ROOT/data/mm3/amiga/Might&MagicIII"
OUT="${MM3_EMU_BIN:-/tmp/mm3_lz_emu}"

echo "==> extracting root CODE hunk from $(basename "$EXE")"
mkdir -p "$CACHE"
python3 - "$EXE" "$CACHE/code0.bin" << 'PYEOF'
import struct, sys
exe, out = sys.argv[1], sys.argv[2]
data = open(exe, 'rb').read()
pos = 0
while pos < len(data) - 4:
    tag = int.from_bytes(data[pos:pos+4], 'big')
    if tag == 0x3E9:  # HUNK_CODE
        lw = int.from_bytes(data[pos+4:pos+8], 'big')
        payload = data[pos+8:pos+8+lw*4]
        if pos == 0x20:  # first hunk = root CODE
            open(out, 'wb').write(payload)
            print(f"   {len(payload)} bytes -> {out}")
            sys.exit(0)
        pos += 8 + lw * 4
    elif tag == 0x3EA:  # HUNK_DATA
        lw = int.from_bytes(data[pos+4:pos+8], 'big')
        pos += 8 + lw * 4
    elif tag == 0x3EB:  # HUNK_BSS
        pos += 8
    elif tag in (0x3EC, 0x3F2, 0x3F3, 0x3E7):
        pos += 4
    else:
        pos += 4
print("ERROR: no root CODE hunk found", file=sys.stderr)
sys.exit(1)
PYEOF

mkdir -p "$MUSASHI"
for obj in m68kcpu.o m68kdasm.o m68kops.o softfloat.o; do
    if [ ! -f "$MUSASHI/$obj" ]; then
        echo "==> compiling musashi $obj"
        (cd "$MUSASHI" && gcc -I. -Isoftfloat -O2 -c "${obj%.o}.c" -o "$obj")
    fi
done

echo "==> building $OUT"
gcc -I"$MUSASHI" -I"$MUSASHI/softfloat" -O2 -o "$OUT" \
    "$HERE/emu_lz.c" \
    "$MUSASHI/m68kcpu.o" "$MUSASHI/m68kdasm.o" "$MUSASHI/m68kops.o" "$MUSASHI/softfloat.o" \
    -lm
echo "==> built: $OUT"
echo "    usage: $OUT <entry.bin> <out.bin> [code0.bin]"

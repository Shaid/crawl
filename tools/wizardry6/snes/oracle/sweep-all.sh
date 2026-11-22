#!/usr/bin/env bash
# Full SNES walker-vs-game parity sweep: every party cell x 4 facings of all
# 14 levels, one process per level (memory), JOBS levels at a time.
# Per-level JSON reports go to OUT (default build/cache/w6-snes-parity).
# Exits non-zero if any level has a residual. See sweep-parity.ts.
set -u
cd "$(dirname "$0")/../../../.."
OUT="${OUT:-build/cache/w6-snes-parity}"
JOBS="${JOBS:-4}"
mkdir -p "$OUT"
seq 0 13 | xargs -P "$JOBS" -I{} sh -c "npx --no-install tsx tools/wizardry6/snes/oracle/sweep-parity.ts {} 1 --out '$OUT' > '$OUT/L{}.txt' 2>&1; echo \$? > '$OUT/L{}.status'"
status=0
for L in $(seq 0 13); do
  grep -h '^L[0-9]' "$OUT/L$L.txt" || { echo "L$L: no result"; cat "$OUT/L$L.txt"; }
  [ "$(cat "$OUT/L$L.status" 2>/dev/null)" = "0" ] || status=1
done
exit $status

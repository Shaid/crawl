#!/usr/bin/env bash
# Build the Ishar game oracle: maestun/alis (MIT, an ALIS engine
# reimplementation) at a pinned commit, plus crawl's harness patch.
# Output: build/cache/ishar-oracle/alis/build/alis (repo-relative).
# The alis source is fetched into build/cache/ (git-ignored), never committed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$ROOT/build/cache/ishar-oracle"
SRC="$OUT/alis"
REPO="${ALIS_REPO:-https://github.com/maestun/alis.git}"
PIN=31b1811

mkdir -p "$OUT"
if [ ! -d "$SRC/.git" ]; then
  git clone -q "$REPO" "$SRC"
fi
git -C "$SRC" fetch -q origin 2>/dev/null || true
git -C "$SRC" checkout -q -f "$PIN"
git -C "$SRC" clean -fdq src
git -C "$SRC" apply "$HERE/harness.patch"
command -v sdl2-config >/dev/null || { echo "sdl2-config not found: install SDL2 development files" >&2; exit 1; }
make -C "$SRC" -j"$(nproc 2>/dev/null || echo 4)" >"$OUT/make.log" 2>&1 || { tail -30 "$OUT/make.log" >&2; exit 1; }
echo "$SRC/build/alis"

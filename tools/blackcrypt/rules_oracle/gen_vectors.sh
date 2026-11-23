#!/usr/bin/env bash
# Builds the three musashi oracles and regenerates the FULL movement and spell vector sets (about 7 MB compressed) into
# ./generated/ (gitignored). The tests use ./generated/ when it exists and fall back to the small committed
# subsets (vectors_move.small.json.gz, vectors_spell.small.json.gz), so a fresh checkout still has a fast regression check.
# Needs: tools/bcdft_decompress built and run (build/cache/blackcrypt/bcdft_decompressed.bin, bcdft_s2_data.bin).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cache="$here/../../../build/cache/blackcrypt"
[ -f "$cache/bcdft_decompressed.bin" ] || { echo "run tools/bcdft_decompress/build.sh run first"; exit 1; }
"$here/build.sh"; "$here/build_move.sh"; "$here/build_spell.sh"
mkdir -p "$here/generated"
python3 "$here/make_vectors_move.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/generated/vectors_move.json.gz"
python3 "$here/make_vectors_spell.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/generated/vectors_spell.json.gz"
python3 "$here/make_vectors_events.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/vectors_events.json.gz"
python3 "$here/make_vectors_boss.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/vectors_boss.json.gz"
python3 "$here/make_vectors_spells9.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/vectors_spells9.json.gz" 70
python3 "$here/make_vectors_spells10.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/vectors_spells10.json.gz" 70
python3 "$here/make_vectors_pass7.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/generated/vectors_pass7.json.gz" 150
python3 "$here/make_vectors_pass7.py" "$cache/bcdft_decompressed.bin" "$cache/bcdft_s2_data.bin" "$here/vectors_pass7.json.gz" 60
echo "generated vectors in $here/generated (events, boss and spells9 fixtures rewritten in place: they are small and committed)"

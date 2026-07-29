#!/usr/bin/env bash
set -euo pipefail

# ── bcdft decompressor builder ──
# Builds a musashi-based 68k emulator that runs the S_4 decompression engine
# directly, producing the correct decompressed dungeon data.
#
# Prerequisites: git, gcc, make, cmake (optional)
#
# Usage:
#   ./build.sh              # build the emulator binary
#   ./build.sh run          # build + decompress bcdft
#   ./build.sh clean        # remove build artifacts

MUSASHI_REPO="https://github.com/kstenerud/musashi.git"
MUSASHI_DIR="musashi"
OUTPUT_BIN="bcdft_decompress"
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Paths to input data
BCDFT="${PROJECT_ROOT}/data/blackcrypt/amiga/bcdft"

# Directories
EXTRACTED="${PROJECT_ROOT}/data/blackcrypt/extracted"

build_musashi() {
    if [ ! -f "${MUSASHI_DIR}/m68kcpu.c" ]; then
        echo "==> Cloning musashi from ${MUSASHI_REPO}"
        git clone --depth 1 "${MUSASHI_REPO}" "${MUSASHI_DIR}" || {
            echo "ERROR: git clone failed. Check your network connection."
            echo "If offline, you can manually download musashi to ${MUSASHI_DIR}:"
            echo "  git clone --depth 1 ${MUSASHI_REPO} ${MUSASHI_DIR}"
            exit 1
        }
    else
        echo "==> musashi already present"
    fi

    if [ ! -x "${MUSASHI_DIR}/m68kmake" ] || [ ! -f "${MUSASHI_DIR}/m68kops.c" ]; then
        echo "==> Generating opcode tables"
        cd "${MUSASHI_DIR}"
        gcc -I. -o m68kmake m68kmake.c
        ./m68kmake . .
        cd ..
    else
        echo "==> opcode tables already generated"
    fi

    echo "==> Compiling musashi core"
    cd "${MUSASHI_DIR}"
    for obj in m68kcpu.o m68kdasm.o m68kops.o softfloat.o; do
        if [ ! -f "${obj}" ]; then
            echo "   compiling ${obj}..."
            case "${obj}" in
                softfloat.o) gcc -I. -Isoftfloat -O2 -c softfloat/softfloat.c -o softfloat.o ;;
                *)           gcc -I. -Isoftfloat -O2 -c "${obj%.o}.c" ;;
            esac
        fi
    done
    cd ..
}

build_emu() {
    echo "==> Compiling bcdft_decompress emulator"
    gcc -I"${MUSASHI_DIR}" -I"${MUSASHI_DIR}/softfloat" -O2 \
        -o "${OUTPUT_BIN}" \
        emu.c \
        "${MUSASHI_DIR}/m68kcpu.o" \
        "${MUSASHI_DIR}/m68kdasm.o" \
        "${MUSASHI_DIR}/m68kops.o" \
        "${MUSASHI_DIR}/softfloat.o" \
        -lm
    echo "==> Built: ${OUTPUT_BIN}"
}

clean() {
    echo "==> Cleaning"
    rm -rf "${MUSASHI_DIR}" "${OUTPUT_BIN}" musashi_build
}

run() {
    if [ ! -f "${OUTPUT_BIN}" ]; then
        echo "Error: emulator not built. Run ./build.sh first."
        exit 1
    fi

    if [ ! -f "${BCDFT}" ]; then
        echo "Error: bcdft not found at ${BCDFT}"
        exit 1
    fi

    echo "==> Extracting S_4 and S_5 from bcdft"
    python3 extract_sections.py "${BCDFT}" /tmp/s0_code.bin /tmp/s4_code.bin /tmp/s5_data.bin

    echo "==> Running emulator"
    ./"${OUTPUT_BIN}"

    echo "==> Copying results"
    mkdir -p "${EXTRACTED}"
    cp /tmp/s1_output.bin "${EXTRACTED}/bcdft_decompressed.bin"
    ls -la "${EXTRACTED}/bcdft_decompressed.bin"
    echo "==> Done"
}

case "${1:-}" in
    run)    build_musashi; build_emu; run ;;
    clean)  clean ;;
    *)      build_musashi; build_emu ;;
esac

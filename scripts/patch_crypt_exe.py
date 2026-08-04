#!/usr/bin/env python3
"""Restore the removed map-switch call in the Black Crypt Windows demo's
`crypt.exe` — Phase 4 of `docs/blackcrypt/dos/full-game-restoration-plan.md`.

## What was removed, and why a thunk is enough

The 1995 demo ships the *entire* map-switch subsystem — a generic per-map
parser (`fcn.00425350`), a generic per-map writer (`fcn.004258d0`), and a
`SwitchMap(fromMap, toMap)` driver (`fcn.00426880`) that composes them,
selects the right tileset group, and loads per-map resources — fully intact
and already exercised on every game load (the save/restore path calls
`SwitchMap(-1, curMap)`). What's actually missing is just the 12-byte body
of `fcn.00423b50`, the function both in-game map-transition call sites
(stairs/teleport resolution and the teleport action handler) invoke with the
destination map number: instead of forwarding to `SwitchMap`, the shipped
binary discards the argument and prints "YOU HAVE REACHED THE END OF THE
TEST LEVEL". See plan doc § "1A" for the full trace and verification (1,530/
1,530 squares, 45/45 actions, a byte-exact padding invariant, and a
guard-by-guard structural match against the Amiga's own level-entry routine
at `S_1 +0x1A5CC`) — this script only encodes the patch that trace concluded
was sufficient; it doesn't re-derive it.

Both call sites already write the destination x/y/facing globals *before*
calling the stub (§1A), so the restored routine needs to do nothing but
forward to `SwitchMap` — no party-position logic belongs in the thunk.

## The two edits

`fcn.00423b50` (file offset 0x23b50) is only 16 bytes usable (12-byte stub
body + 4 `0x90` pad bytes) — not enough room for the replacement inline. So:

1. Overwrite the stub's first 5 bytes with a `jmp rel32` to a code cave.
   (The other 11 stub bytes are left as dead, unreached data — the `jmp`
   never falls through to them, and leaving them alone keeps the diff
   minimal.)
2. Place the actual thunk body in real `.text` slack: 333 zero bytes at file
   offset 0x2DEB3 (vaddr 0x42DEB3-0x42E000), confirmed all-zero and inside
   the raw PE image. An earlier plan draft proposed vaddr 0x45DBE0 instead;
   that address is BSS (no file bytes to patch at all) *and* lands inside
   the live map (de)serialization scratch buffer that `LoadDungeon`/
   `SaveDungeon` overwrite on every map load — see the plan doc's
   correction in §1A for why that candidate was wrong and this one is
   right. This script re-verifies both regions' bytes at runtime rather
   than trusting that write.

Thunk (22 bytes, assembled with `rasm2` — see the plan doc §"Phase 4" DONE
block for the exact `rasm2` invocations and round-trip disassembly used to
derive these bytes; nothing here is hand-computed):

    mov   eax, dword [esp+4]      ; destMap, as pushed by both call sites
    movzx ecx, word [0x47481a]    ; fromMap = current map
    push  eax                     ; toMap
    push  ecx                     ; fromMap
    call  0x426880                ; SwitchMap
    add   esp, 8
    ret

## Repo hygiene

This script never touches `data/blackcrypt/dosvga/crypt.exe` (or any file
under `data/`) in place — it only *reads* a user-supplied input path and
*writes* a user-supplied output path, and refuses to run if they're the
same file. A patched `crypt.exe` is derived, copyrighted demo data and must
never be committed to this repo (see the plan doc's "Repo hygiene" section)
— only this script is.
"""
import argparse
import sys
from pathlib import Path

# --- Addresses (all vaddr, PE image base 0x400000; .text's raw and virtual
# offsets coincide 1:1 for this binary, so file_offset = vaddr - 0x400000) --
STUB_VADDR = 0x423B50
STUB_FILE_OFFSET = STUB_VADDR - 0x400000          # 0x23b50
STUB_WINDOW_LEN = 16                              # 12-byte body + 4 NOP pad

CAVE_VADDR = 0x42DEB3
CAVE_FILE_OFFSET = CAVE_VADDR - 0x400000          # 0x2deb3
CAVE_WINDOW_LEN = 333                             # confirmed all-zero .text slack

SWITCHMAP_VADDR = 0x426880

# --- Bytes, assembled and round-trip-verified with rasm2 (see docstring) --

# jmp rel32 from STUB_VADDR to CAVE_VADDR: e9 <cave - (stub + 5)>
JMP_BYTES = bytes.fromhex('e95ea30000')
assert len(JMP_BYTES) == 5
_jmp_target = STUB_VADDR + 5 + int.from_bytes(JMP_BYTES[1:], 'little', signed=True)
assert _jmp_target == CAVE_VADDR, hex(_jmp_target)

# mov eax,[esp+4]; movzx ecx,word[0x47481a]; push eax; push ecx;
# call 0x426880; add esp,8; ret
THUNK_BYTES = bytes.fromhex(
    '8b4424040fb70d1a4847005051e8bb89ffff83c408c3')
assert len(THUNK_BYTES) == 22
_call_off = THUNK_BYTES.index(b'\xe8')
_call_next = CAVE_VADDR + _call_off + 5
_call_target = _call_next + int.from_bytes(
    THUNK_BYTES[_call_off + 1:_call_off + 5], 'little', signed=True)
assert _call_target == SWITCHMAP_VADDR, hex(_call_target)

# Original stub bytes at STUB_FILE_OFFSET, for a pre-flight sanity check
# (refuse to patch a file that doesn't look like the known demo build).
EXPECTED_ORIGINAL_STUB = bytes.fromhex(
    '68c8b64300e8b68dfeff59c3' '90909090')
assert len(EXPECTED_ORIGINAL_STUB) == STUB_WINDOW_LEN


def patch(data: bytes) -> bytes:
    """Return a patched copy of `data` (a full `crypt.exe` image). Raises
    ValueError if the input doesn't look like the expected demo build."""
    if len(data) < CAVE_FILE_OFFSET + CAVE_WINDOW_LEN:
        raise ValueError(
            f'input is only {len(data)} B -- too small to contain the '
            f'expected code cave at file+{CAVE_FILE_OFFSET:#x}')

    stub_window = data[STUB_FILE_OFFSET:STUB_FILE_OFFSET + STUB_WINDOW_LEN]
    if stub_window != EXPECTED_ORIGINAL_STUB:
        raise ValueError(
            f'stub bytes at file+{STUB_FILE_OFFSET:#x} do not match the '
            f'known "END OF THE TEST LEVEL" stub (fcn.00423b50) -- got '
            f'{stub_window.hex()}, expected {EXPECTED_ORIGINAL_STUB.hex()}. '
            f'Refusing to patch what may not be the expected crypt.exe '
            f'build (1995 demo, 253,952 B).')

    cave_window = data[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + CAVE_WINDOW_LEN]
    if any(cave_window):
        raise ValueError(
            f'code cave at file+{CAVE_FILE_OFFSET:#x} is not all-zero '
            f'({sum(1 for b in cave_window if b)} nonzero bytes out of '
            f'{CAVE_WINDOW_LEN}) -- refusing to overwrite what might be '
            f'real code/data in a different crypt.exe build.')

    out = bytearray(data)
    out[STUB_FILE_OFFSET:STUB_FILE_OFFSET + len(JMP_BYTES)] = JMP_BYTES
    out[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + len(THUNK_BYTES)] = THUNK_BYTES
    return bytes(out)


def _self_check(original: bytes, patched: bytes) -> None:
    """Re-verify the patched bytes exactly as the plan doc's verification
    bar demands: the two intended windows contain exactly the intended
    bytes, and every other byte in the file is unchanged from the input."""
    stub_got = patched[STUB_FILE_OFFSET:STUB_FILE_OFFSET + len(JMP_BYTES)]
    if stub_got != JMP_BYTES:
        raise AssertionError(
            f'self-check failed: stub window is {stub_got.hex()}, '
            f'expected {JMP_BYTES.hex()}')

    cave_got = patched[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + len(THUNK_BYTES)]
    if cave_got != THUNK_BYTES:
        raise AssertionError(
            f'self-check failed: cave window is {cave_got.hex()}, '
            f'expected {THUNK_BYTES.hex()}')

    if len(original) != len(patched):
        raise AssertionError(
            f'self-check failed: output length {len(patched)} != input '
            f'length {len(original)}')

    changed = [
        i for i in range(len(original))
        if original[i] != patched[i]
        and not (STUB_FILE_OFFSET <= i < STUB_FILE_OFFSET + len(JMP_BYTES))
        and not (CAVE_FILE_OFFSET <= i < CAVE_FILE_OFFSET + len(THUNK_BYTES))
    ]
    if changed:
        raise AssertionError(
            f'self-check failed: {len(changed)} byte(s) changed outside '
            f'the two intended windows, e.g. offset {changed[0]:#x} '
            f'({original[changed[0]]:#04x} -> {patched[changed[0]]:#04x})')


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Restore the map-switch call in Black Crypt\'s Windows '
                    'demo crypt.exe (Phase 4, see '
                    'docs/blackcrypt/dos/full-game-restoration-plan.md). '
                    'Never modifies the input file; writes a patched copy '
                    'to --out.')
    ap.add_argument('input', type=Path,
                     help='Path to your own crypt.exe (1995 demo build)')
    ap.add_argument('output', type=Path,
                     help='Path to write the patched copy to (must differ '
                          'from input; not overwritten if it already '
                          'exists unless --force is given)')
    ap.add_argument('--force', action='store_true',
                     help='Overwrite --output if it already exists')
    args = ap.parse_args()

    in_path: Path = args.input.resolve()
    out_path: Path = args.output.resolve()

    if in_path == out_path:
        print('error: input and output must be different files (refusing '
              'to patch crypt.exe in place)', file=sys.stderr)
        return 1

    if out_path.exists() and not args.force:
        print(f'error: {out_path} already exists (pass --force to '
              f'overwrite)', file=sys.stderr)
        return 1

    original = in_path.read_bytes()
    try:
        patched = patch(original)
    except ValueError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    out_path.write_bytes(patched)

    # Self-check against what was actually written to disk, not just the
    # in-memory buffer -- catches truncated/corrupted writes too.
    written = out_path.read_bytes()
    try:
        _self_check(original, written)
    except AssertionError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    print(f'patched {in_path} ({len(original)} B) -> {out_path}')
    print(f'  jmp   file+{STUB_FILE_OFFSET:#x} (vaddr {STUB_VADDR:#x}) '
          f'-> cave vaddr {CAVE_VADDR:#x}: {JMP_BYTES.hex()}')
    print(f'  thunk file+{CAVE_FILE_OFFSET:#x} (vaddr {CAVE_VADDR:#x}), '
          f'{len(THUNK_BYTES)} B: {THUNK_BYTES.hex()}')
    print('  self-check OK: both windows match intended bytes, zero '
          'differences elsewhere in the file')
    return 0


if __name__ == '__main__':
    sys.exit(main())

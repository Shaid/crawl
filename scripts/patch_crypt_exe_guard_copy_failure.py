#!/usr/bin/env python3
"""Guard the restore-game routine against a failed `orig%hu.gam` copy —
Phase 4b (Phase 6 finding "9") of
`docs/blackcrypt/dos/full-game-restoration-plan.md`.

## The bug this fixes

`fcn.00426390` (restore-game, called from the Load Game menu) always does,
right before switching into the saved map:

    DeleteFileA("tempdung.gam")
    CopyFileA("orig%hu.gam" % slot, "tempdung.gam", FALSE)
    if (!CopyFileA_result) {
        print("*** COPY FAILED ***");      // fcn.0040c910
        FormatMessageA(GetLastError());    // fcn.00425d80 -- formats into a
                                            // local stack buffer that is
                                            // never displayed or logged
    }
    SwitchMap(-1, curMap);                 // unconditional -- runs even
                                            // after the block above

`fcn.00425d80` has no visible effect (its `FormatMessageA` output goes into
a local buffer that goes out of scope on `ret`), so the "COPY FAILED"
branch is not a real error handler -- it is dead-end diagnostics, and
execution falls straight through into `SwitchMap(-1, curMap)` regardless of
whether `tempdung.gam` now exists.

`SwitchMap` calls `LoadDungeon` (`fcn.00425350`), whose first action is
`fopen("tempdung.gam", "rb")`. If the copy failed and no `tempdung.gam` was
left over from a previous session either (the preceding `DeleteFileA`
already removed it unconditionally), `fopen` returns NULL. That NULL FILE*
is passed unchecked into the fseek wrapper (`fcn.004274d3`), which calls the
CRT stream-lock helper `fcn.00428c08(stream)`. Because NULL falls outside
the static stdio-table range `[0x43b860, 0x43bac0)` the helper takes it as
a "heap" FILE* and computes a bogus CRITICAL_SECTION pointer as
`NULL + 0x20 = 0x20`, then calls `EnterCriticalSection(0x20)`. That routine's
interlocked increment on `LockCount` (offset +4 of a CRITICAL_SECTION)
faults writing to address `0x24` -- exactly the page fault two independent
live Wine crashes reproduced byte-for-byte (`EAX=0`, `ECX=0x0043b860`,
`EBX=0x20`, fault address `0x00000024`; see
`data/blackcrypt/wine-test/backtrace.txt` and
`backtrace-load-game-4.txt`).

This has nothing to do with the *content* of the save file -- it fires for
any save slot whose `orig<N>.gam` companion file (created by the DOS game's
own Save Game flow, per-slot, the first time that slot is used) doesn't
exist yet. It is a bug in the shipped 1998 binary itself, always present,
completely independent of Phase 4's map-switch-stub restoration.

## The fix

Redirect the already-dead "COPY FAILED" fallthrough to the *existing*,
already-correct "char file didn't open" bailout a few dozen bytes earlier
in the same function (`0x426408`: `mov ax, 1; pop esi; add esp, 0x24; ret`)
instead of letting it fall into `SwitchMap`. Stack depth at the patch site
(`0x426849`, right after `pop edi; pop ebp; test eax,eax; pop ebx`) is
provably identical to the depth at `0x426406` (both are exactly "prologue's
`sub esp,0x24; push esi`, no net pushes since") -- traced instruction by
instruction, every `push`/`call`/`add esp,N` pair in between balances
exactly, including the explicit `push ebx; push ebp; push edi` /
`pop edi; pop ebp; pop ebx` bracket around the character/scalar-parsing
block. So jumping straight to `0x426408` from the failure branch is stack-
safe and gives exactly the same clean "load failed, return to menu"
behaviour already used for a missing `char%hu.dat`.

The 18-byte window `0x42684b`-`0x42685c` (`push str; call fcn.0040c910;
add esp,4; call fcn.00425d80`) becomes `push str; call fcn.0040c910;
add esp,4; jmp 0x426408` -- same 18 bytes, same "*** COPY FAILED ***"
diagnostic print kept intact (whatever fcn.0040c910 does with it is
unaffected -- this script doesn't touch that call), only the inert
`FormatMessageA` call is replaced with a jump to the existing bailout.
No code cave needed; the replacement is byte-for-byte the same length as
what it replaces.

## Repo hygiene

Same contract as `patch_crypt_exe.py`: never touches
`data/blackcrypt/dosvga/crypt.exe` in place, only reads a user-supplied
input and writes a user-supplied output, refuses in-place patching, and no
patched binary is committed anywhere in this repo. This patch is
independent of (and layers safely on top of, or under, in either order)
`patch_crypt_exe.py`'s edits -- the two windows (`0x23b50`/`0x2deb3` vs.
`0x2684b`) don't overlap.
"""
import argparse
import sys
from pathlib import Path

# --- Addresses (all vaddr, PE image base 0x400000; .text's raw and virtual
# offsets coincide 1:1 for this binary, so file_offset = vaddr - 0x400000) --
GUARD_VADDR = 0x42684B
GUARD_FILE_OFFSET = GUARD_VADDR - 0x400000        # 0x2684b
GUARD_WINDOW_LEN = 18

BAIL_VADDR = 0x426408      # fcn.00426390's existing "char file didn't
                            # open" early return: mov ax,1; pop esi;
                            # add esp,0x24; ret

# --- Bytes, assembled and round-trip-verified with rasm2 (see docstring) --

# Original 18 bytes at GUARD_FILE_OFFSET (pre-flight sanity check).
EXPECTED_ORIGINAL_GUARD = bytes.fromhex(
    '6830b74300' 'e8bb60feff' '83c404' 'e823f5ffff')
assert len(EXPECTED_ORIGINAL_GUARD) == GUARD_WINDOW_LEN

# New bytes: keep "push str; call fcn.0040c910; add esp,4" (the
# "*** COPY FAILED ***" print) unchanged, replace the trailing
# "call fcn.00425d80" (inert FormatMessageA-into-a-discarded-buffer) with
# "jmp 0x426408" (rasm2 -a x86 -b 32 -s 0x426858 "jmp 0x426408" -- the
# replaced call sits at vaddr 0x426858, i.e. GUARD_VADDR + 13, since the
# preceding push(5)+call(5)+add esp,4(3) = 13 bytes come first).
JMP_BYTES = bytes.fromhex('e9abfbffff')
assert len(JMP_BYTES) == 5
_jmp_site = GUARD_VADDR + 13   # offset of the replaced call within the window
_jmp_target = _jmp_site + 5 + int.from_bytes(JMP_BYTES[1:], 'little', signed=True)
assert _jmp_target == BAIL_VADDR, hex(_jmp_target)

NEW_GUARD = EXPECTED_ORIGINAL_GUARD[:13] + JMP_BYTES
assert len(NEW_GUARD) == GUARD_WINDOW_LEN


def patch(data: bytes) -> bytes:
    """Return a patched copy of `data` (a full `crypt.exe` image). Raises
    ValueError if the input doesn't look like the expected demo build."""
    if len(data) < GUARD_FILE_OFFSET + GUARD_WINDOW_LEN:
        raise ValueError(
            f'input is only {len(data)} B -- too small to contain the '
            f'expected guard window at file+{GUARD_FILE_OFFSET:#x}')

    window = data[GUARD_FILE_OFFSET:GUARD_FILE_OFFSET + GUARD_WINDOW_LEN]
    if window != EXPECTED_ORIGINAL_GUARD:
        raise ValueError(
            f'bytes at file+{GUARD_FILE_OFFSET:#x} do not match the known '
            f'"*** COPY FAILED ***" fallthrough in fcn.00426390 -- got '
            f'{window.hex()}, expected {EXPECTED_ORIGINAL_GUARD.hex()}. '
            f'Refusing to patch what may not be the expected crypt.exe '
            f'build (1995/1998 demo, 253,952 B).')

    out = bytearray(data)
    out[GUARD_FILE_OFFSET:GUARD_FILE_OFFSET + len(NEW_GUARD)] = NEW_GUARD
    return bytes(out)


def _self_check(original: bytes, patched: bytes) -> None:
    got = patched[GUARD_FILE_OFFSET:GUARD_FILE_OFFSET + len(NEW_GUARD)]
    if got != NEW_GUARD:
        raise AssertionError(
            f'self-check failed: guard window is {got.hex()}, expected '
            f'{NEW_GUARD.hex()}')

    if len(original) != len(patched):
        raise AssertionError(
            f'self-check failed: output length {len(patched)} != input '
            f'length {len(original)}')

    changed = [
        i for i in range(len(original))
        if original[i] != patched[i]
        and not (GUARD_FILE_OFFSET <= i < GUARD_FILE_OFFSET + len(NEW_GUARD))
    ]
    if changed:
        raise AssertionError(
            f'self-check failed: {len(changed)} byte(s) changed outside '
            f'the intended window, e.g. offset {changed[0]:#x} '
            f'({original[changed[0]]:#04x} -> {patched[changed[0]]:#04x})')


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Guard Black Crypt\'s Windows demo crypt.exe against a '
                    'crash when loading a save slot whose orig<N>.gam '
                    'companion file is missing (Phase 4b / Phase 6 finding '
                    '"9", see '
                    'docs/blackcrypt/dos/full-game-restoration-plan.md). '
                    'Never modifies the input file; writes a patched copy '
                    'to --out. Independent of, and safe to combine in '
                    'either order with, patch_crypt_exe.py.')
    ap.add_argument('input', type=Path,
                     help='Path to your own crypt.exe (1995/1998 demo '
                          'build; may already have patch_crypt_exe.py\'s '
                          'edits applied, or not)')
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

    written = out_path.read_bytes()
    try:
        _self_check(original, written)
    except AssertionError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    print(f'patched {in_path} ({len(original)} B) -> {out_path}')
    print(f'  guard file+{GUARD_FILE_OFFSET:#x} (vaddr {GUARD_VADDR:#x}), '
          f'{len(NEW_GUARD)} B: {NEW_GUARD.hex()}')
    print(f'    (keeps the "*** COPY FAILED ***" print, replaces the '
          f'inert FormatMessageA call with a jump to the existing '
          f'"load failed" bailout at vaddr {BAIL_VADDR:#x})')
    print('  self-check OK: guard window matches intended bytes, zero '
          'differences elsewhere in the file')
    return 0


if __name__ == '__main__':
    sys.exit(main())

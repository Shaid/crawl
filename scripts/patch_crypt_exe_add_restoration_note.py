#!/usr/bin/env python3
"""Add a third "intro text" page to the Black Crypt Windows demo's
`crypt.exe`, about this repo's later restoration work — Phase 5 of
`docs/blackcrypt/dos/full-game-restoration-plan.md`.

## The display mechanism (traced this session)

On startup, `main` (`0x4135d0`, called from `entry0` at `0x427ea1`) shows
three sequential modal Win32 dialogs before the title screen, all built from
the same reusable pattern: `DialogBoxParamA(hInstance, MAKEINTRESOURCE(id),
NULL, dlgProc, 0)`, where `dlgProc`'s `WM_INITDIALOG` handler calls
`SetDlgItemTextA(hDlg, controlId, someString)` to fill in a text control, and
whose `WM_COMMAND` handler calls `EndDialog(hDlg, 1)` when the OK/Next
button (control id 1) is clicked:

1. `DialogBoxParamA(..., 101, ..., DlgProc_EULA@0x413450, 0)` — the
   Activision EULA (dialog template 101, control id 1001). If declined
   (`dword [0x474af8] == 0` after the call), `main` returns immediately —
   the game never starts.
2. `DialogBoxParamA(..., 102, ..., DlgProc_History@0x4134f0, 0)` — Rick
   Johnson's "making of" history note (dialog template **102**, control id
   **1003**), text at `0x43a2bc`.
3. `DialogBoxParamA(..., 102, ..., DlgProc_DemoNote@0x413570, 0)` — the
   demo-specific note (**same dialog template 102, same control id 1003**),
   text at `0x43ab48`.

Pages 2 and 3 are two independent modal dialogs built from the identical
dialog template (102) with two different, near-identical `DlgProc`s that
each just plug a different string into the same control. There is no page
count, no pointer table — "how many pages" is simply however many
`DialogBoxParamA` calls appear in a row in `.text`. Each of the three
strings is its own null-terminated C string (confirmed: exactly one 0x00
byte immediately before each string's start and one immediately after its
end — `0x38850`-`0x3a2ba` EULA, `0x3a2bc`-`0x3ab46` history,
`0x3ab48`-`0x3ae16` demo note); the multi-"paragraph" look under a plain
`strings` scan is just `\\r\\r\\n\\r\\r\\n` breaks inside one string each,
which `strings` treats as string boundaries because CR isn't in its
printable set — not evidence of separate resources.

## What this patch does

Adds a **fourth** `DialogBoxParamA` call, right after page 3's, reusing
template 102 (so no `.rsrc` resource edit is needed at all — the template
already has a text control at id 1003 and an OK-style button at id 1) with
a new minimal `DlgProc` that:

- On `WM_INITDIALOG`, calls `SetDlgItemTextA(hDlg, 1003, NEW_STRING)`.
- On `WM_COMMAND`, **jumps into the existing, generic tail of
  `DlgProc_DemoNote` at `0x413583`** (which just forwards to the shared
  `EndDialog`-on-OK helper at `0x413550`) instead of duplicating that
  ~40-byte block — it's control-id-and-string agnostic, only reads its
  args off the stack frame, so a `jmp` (not `call`, to preserve the frame)
  into it from a new `DlgProc` works unmodified.

No inserted bytes, no shifted offsets — same technique as Phase 4:

1. The new `DlgProc` (52 B) and the "make the 4th call" thunk (22 B) both
   go in the **same `.text` code cave Phase 4 uses** (`0x42DEB3`-`0x42E000`,
   333 B), in the *unused remainder* after Phase 4's own 22-byte thunk:
   `0x42DEC9`-`0x42E000` (311 B free). This patch only ever touches
   `0x42DEC9` onward, and its own byte ranges never overlap Phase 4's
   (hook site, cave bytes, and string bytes are all disjoint from Phase 4's
   two windows) — but **application order is not actually free**, checked
   empirically, not just reasoned about: `patch_crypt_exe.py`'s own
   pre-flight guard checks that the *entire* 333-byte cave is zero (a
   stricter check than the 22 bytes it actually writes), so it refuses to
   run against a `crypt.exe` this script has already patched (the guard
   sees this script's bytes at `0x2dec9` onward and — correctly, if overly
   broadly — refuses to overwrite non-zero cave bytes it doesn't recognize).
   **Apply `patch_crypt_exe.py` first if you want both patches; this script
   works against either a stock or an already-Phase-4-patched `crypt.exe`.**
2. The new page's text goes in **`.rdata`'s own unused tail**,
   `0x42F2D9`-`0x430000` (3,367 B) — the zero padding after the PE import
   name table (the last real content there, `"SetEnvironmentVariableA\0"`,
   ends at `0x2F2D9`; the section's raw size just rounds up to the next
   file-alignment boundary). Confirmed empty two ways: every byte in that
   range is `0x00` in the shipped file, and no dword anywhere in the whole
   253,952-byte file decodes as a pointer into `[0x42F2D9, 0x430000)` (a
   file-wide dword scan found exactly 2 coincidental hits, both proven to
   be an unrelated `0xFFFFFFFF` rect-list terminator immediately followed
   by an unrelated `0x0042` coordinate word, not real pointers). `.rdata`
   is a real, file-backed, `-r--` section (not BSS), so this is safe,
   unlike the plan's already-documented rejected `0x45DBE0` BSS/live-buffer
   candidate for Phase 4's own cave.
3. The 4th `DialogBoxParamA` call is spliced in by overwriting exactly one
   existing 5-byte instruction — `mov eax, dword [0x476a5c]` at file+`0x1361b`
   (vaddr `0x41361b`, the first instruction after page 3's call returns,
   reading the command-line argument count) — with a 5-byte `jmp rel32` to
   the new cave thunk. The thunk re-executes that exact stolen instruction
   first, then makes the new `DialogBoxParamA` call (reusing `ebx`
   /`ebp`/`esi` — hInstance, 0, and the `DialogBoxParamA` pointer — which
   are all still live and unmodified at this point in `main`, per the
   trace), then `jmp`s back to the original next instruction
   (`mov esi, 1` at `0x413620`). No party/game state is touched; this
   entire sequence runs before any game data is loaded.

## Verification performed (see `_self_check` / the pre-flight guards)

Every immediate/rel8/rel32 byte below was produced by `rasm2 -a x86 -b32
-s <addr> '<insn>'`, never hand-computed, and independently re-validated
here by decoding each `push`/`jmp`/`je`/`call` operand back out of the
assembled bytes and asserting it lands on the intended address (mirroring
`patch_crypt_exe.py`'s own asserts). The self-check after writing re-reads
the file from disk and re-verifies both windows plus a full-file byte diff
showing zero changes outside the three intended windows (hook, cave,
string).

## Repo hygiene

Same as `patch_crypt_exe.py`: never reads/writes `data/blackcrypt/dosvga/
crypt.exe` in place, refuses same input/output path, refuses to overwrite
an existing output without `--force`, and no patched binary is committed.
"""
import argparse
import sys
from pathlib import Path

# --- Addresses (all vaddr, PE image base 0x400000; every section here is
# raw-identity-mapped, so file_offset = vaddr - 0x400000) -------------------

HOOK_VADDR = 0x41361B
HOOK_FILE_OFFSET = HOOK_VADDR - 0x400000          # 0x1361b
HOOK_LEN = 5                                      # the stolen instruction's length

CAVE_BASE_VADDR = 0x42DEC9        # first free byte after Phase 4's own thunk
CAVE_FILE_OFFSET = CAVE_BASE_VADDR - 0x400000     # 0x2dec9
CAVE_CHECK_LEN = 311              # 0x42dec9 .. 0x42e000, all confirmed zero

STRING_VADDR = 0x42F2D9           # tail padding after the PE import name table
STRING_FILE_OFFSET = STRING_VADDR - 0x400000      # 0x2f2d9
STRING_REGION_LEN = 0x430000 - STRING_VADDR       # 3,367 B available

DIALOG_PARAM_A_IAT = 0x42E198     # sym.imp.USER32.dll_DialogBoxParamA
SET_DLG_ITEM_TEXT_A_IAT = 0x42E1B4
DLG_TEMPLATE_ID = 0x66            # 102 -- reused from pages 2 and 3, unmodified
CONTROL_ID_TEXT = 0x3EB           # 1003 -- reused from pages 2 and 3, unmodified
RESUME_VADDR = 0x413620           # 'mov esi, 1', right after the stolen instruction
SHARED_WM_COMMAND_TAIL = 0x413583  # DlgProc_DemoNote's generic WM_COMMAND handler

# --- The new page's text ----------------------------------------------------
# Same voice/format convention as pages 2 and 3: plain paragraphs separated by
# "\r\r\n\r\r\n", single "\r\r\n" at the very end, ASCII, NUL-terminated.
# Not signed as Rick Johnson or attributed to Raven/Activision -- this is a
# separate, later addition by an unrelated fan project.
_PARA_1 = (
    "A fan reverse-engineering project later found that the map-switching "
    "code mentioned above was never really removed -- just one small "
    "routine disconnected from an otherwise complete, working system for "
    "loading, saving, and switching between dungeon maps, the same system "
    "already used every time you load a save.")
_PARA_2 = (
    "Using the original Amiga game's own data, that project reconstructed "
    "the remaining twelve dungeon maps and reconnected the routine.  If "
    "you find yourself somewhere beyond the first map, that is why.")
_PARA_3 = (
    "This is an unofficial, non-commercial fan preservation effort, not a "
    "release by Raven Software or Activision.  More information, for "
    "anyone curious, is at crawl.shaid.net.")
NEW_PAGE_TEXT = ("\r\r\n\r\r\n".join([_PARA_1, _PARA_2, _PARA_3]) + "\r\r\n")
NEW_PAGE_BYTES = NEW_PAGE_TEXT.encode("ascii") + b"\x00"
assert len(NEW_PAGE_BYTES) <= STRING_REGION_LEN, (
    f"new page text ({len(NEW_PAGE_BYTES)} B) does not fit in the "
    f"available {STRING_REGION_LEN} B .rdata tail")

# --- Assembled bytes (rasm2 -a x86 -b 32 -s <addr> '<insn>', see docstring) -

# newDlgProc @ CAVE_BASE_VADDR (0x42dec9), 52 B total:
#   +0  8b442408        mov eax, dword [esp+8]        ; msg
#   +4  2d10010000      sub eax, 0x110                 ; WM_INITDIALOG?
#   +9  740c            je  init_handler (+23)
#   +11 48              dec eax
#   +12 0f84a856feff    je  0x413583                    ; WM_COMMAND -> shared tail
#   +18 31c0            xor eax, eax
#   +20 c21000          ret 0x10
#   +23 8b4c2404        init_handler: mov ecx, dword [esp+4]   ; hDlg
#   +27 68d9f24200      push 0x42f2d9                   ; NEW_PAGE text
#   +32 68eb030000      push 0x3eb                       ; control id 1003
#   +37 51              push ecx
#   +38 ff15b4e14200    call dword [0x42e1b4]            ; SetDlgItemTextA
#   +44 b801000000      mov eax, 1
#   +49 c21000          ret 0x10
NEW_DLGPROC_BYTES = bytes.fromhex(
    '8b442408'
    '2d10010000'
    '740c'
    '48'
    '0f84a856feff'
    '31c0'
    'c21000'
    '8b4c2404'
    '68d9f24200'
    '68eb030000'
    '51'
    'ff15b4e14200'
    'b801000000'
    'c21000'
)
assert len(NEW_DLGPROC_BYTES) == 52
NEW_DLGPROC_VADDR = CAVE_BASE_VADDR
INIT_HANDLER_VADDR = NEW_DLGPROC_VADDR + 23

# Cross-check: the string operand embedded in the "push 0x42f2d9" instruction
# (bytes 27..32 of NEW_DLGPROC_BYTES: 68 d9 f2 42 00) must equal STRING_VADDR.
_pushed_str_va = int.from_bytes(NEW_DLGPROC_BYTES[28:32], 'little')
assert _pushed_str_va == STRING_VADDR, hex(_pushed_str_va)

# Cross-check: the "je 0x413583" near-jump at offset +12 (6 B: 0f 84 rel32)
# must resolve to SHARED_WM_COMMAND_TAIL.
_je_next = NEW_DLGPROC_VADDR + 12 + 6
_je_rel32 = int.from_bytes(NEW_DLGPROC_BYTES[14:18], 'little', signed=True)
assert _je_next + _je_rel32 == SHARED_WM_COMMAND_TAIL, hex(_je_next + _je_rel32)

# Cross-check: the short "je init_handler" at offset +9 (2 B: 74 0c).
_je2_next = NEW_DLGPROC_VADDR + 9 + 2
_je2_rel8 = int.from_bytes(NEW_DLGPROC_BYTES[10:11], 'little', signed=True)
assert _je2_next + _je2_rel8 == INIT_HANDLER_VADDR, hex(_je2_next + _je2_rel8)

# cave3 (the "make the 4th DialogBoxParamA call" thunk) @ NEW_DLGPROC_VADDR+52
# = 0x42defd, 22 B total:
#   +0  a15c6a4700      mov eax, dword [0x476a5c]      ; stolen original instr
#   +5  55              push ebp                        ; lParam = 0
#   +6  68c9de4200      push 0x42dec9                   ; new DlgProc
#   +11 55              push ebp                         ; hWndParent = 0
#   +12 6a66            push 0x66                        ; dialog template 102
#   +14 53              push ebx                          ; hInstance
#   +15 ffd6            call esi                           ; DialogBoxParamA
#   +17 e90d57feff      jmp 0x413620                        ; resume main()
CAVE3_BYTES = bytes.fromhex(
    'a15c6a4700'
    '55'
    '68c9de4200'
    '55'
    '6a66'
    '53'
    'ffd6'
    'e90d57feff'
)
assert len(CAVE3_BYTES) == 22
CAVE3_VADDR = NEW_DLGPROC_VADDR + len(NEW_DLGPROC_BYTES)
assert CAVE3_VADDR == 0x42DEFD, hex(CAVE3_VADDR)

# Cross-check: the stolen instruction at the top of cave3 is byte-identical
# to what HOOK_VADDR originally held (see EXPECTED_HOOK_BYTES below).
STOLEN_INSTR_BYTES = bytes.fromhex('a15c6a4700')
assert CAVE3_BYTES[:5] == STOLEN_INSTR_BYTES

# Cross-check: "push 0x42dec9" (bytes 6..11 of CAVE3_BYTES: 68 c9 de 42 00).
_pushed_dlgproc_va = int.from_bytes(CAVE3_BYTES[7:11], 'little')
assert _pushed_dlgproc_va == NEW_DLGPROC_VADDR, hex(_pushed_dlgproc_va)

# Cross-check: "jmp 0x413620" (bytes 17..22 of CAVE3_BYTES: e9 rel32).
_jmp_back_next = CAVE3_VADDR + 17 + 5
_jmp_back_rel32 = int.from_bytes(CAVE3_BYTES[18:22], 'little', signed=True)
assert _jmp_back_next + _jmp_back_rel32 == RESUME_VADDR, hex(_jmp_back_next + _jmp_back_rel32)

# The full cave payload written in one shot, offset CAVE_FILE_OFFSET..+74:
CAVE_PAYLOAD = NEW_DLGPROC_BYTES + CAVE3_BYTES
assert len(CAVE_PAYLOAD) == 74
assert len(CAVE_PAYLOAD) <= CAVE_CHECK_LEN

# Original bytes at HOOK_FILE_OFFSET, for the pre-flight sanity check.
EXPECTED_HOOK_BYTES = bytes.fromhex('a15c6a4700')
assert len(EXPECTED_HOOK_BYTES) == HOOK_LEN

# jmp rel32 from HOOK_VADDR to CAVE3_VADDR: e9 <cave3 - (hook + 5)>
JMP_BYTES = bytes.fromhex('e9dda80100')
assert len(JMP_BYTES) == 5
_jmp_target = HOOK_VADDR + 5 + int.from_bytes(JMP_BYTES[1:], 'little', signed=True)
assert _jmp_target == CAVE3_VADDR, hex(_jmp_target)


def patch(data: bytes) -> bytes:
    """Return a patched copy of `data` (a full `crypt.exe` image), adding
    the fourth intro-text page. Raises ValueError if the input doesn't look
    like the expected demo build, or if the target regions aren't free."""
    min_len = max(STRING_FILE_OFFSET + len(NEW_PAGE_BYTES),
                   CAVE_FILE_OFFSET + CAVE_CHECK_LEN)
    if len(data) < min_len:
        raise ValueError(
            f'input is only {len(data)} B -- too small to contain the '
            f'expected target regions (need at least {min_len} B)')

    hook_window = data[HOOK_FILE_OFFSET:HOOK_FILE_OFFSET + HOOK_LEN]
    if hook_window != EXPECTED_HOOK_BYTES:
        raise ValueError(
            f'bytes at file+{HOOK_FILE_OFFSET:#x} do not match the known '
            f'"mov eax, dword [0x476a5c]" instruction right after the '
            f'demo-note dialog call in main() -- got {hook_window.hex()}, '
            f'expected {EXPECTED_HOOK_BYTES.hex()}. Refusing to patch what '
            f'may not be the expected crypt.exe build (1995 demo, '
            f'253,952 B).')

    cave_window = data[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + CAVE_CHECK_LEN]
    if any(cave_window):
        raise ValueError(
            f'.text code cave remainder at file+{CAVE_FILE_OFFSET:#x} is '
            f'not all-zero ({sum(1 for b in cave_window if b)} nonzero '
            f'bytes out of {CAVE_CHECK_LEN}) -- refusing to overwrite what '
            f'might be real code/data, or an already-applied copy of this '
            f'same patch, in a different crypt.exe build.')

    string_window = data[STRING_FILE_OFFSET:STRING_FILE_OFFSET + len(NEW_PAGE_BYTES)]
    if any(string_window):
        raise ValueError(
            f'.rdata tail at file+{STRING_FILE_OFFSET:#x} is not all-zero '
            f'({sum(1 for b in string_window if b)} nonzero bytes out of '
            f'{len(NEW_PAGE_BYTES)}) -- refusing to overwrite what might be '
            f'real data in a different crypt.exe build.')

    out = bytearray(data)
    out[STRING_FILE_OFFSET:STRING_FILE_OFFSET + len(NEW_PAGE_BYTES)] = NEW_PAGE_BYTES
    out[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + len(CAVE_PAYLOAD)] = CAVE_PAYLOAD
    out[HOOK_FILE_OFFSET:HOOK_FILE_OFFSET + len(JMP_BYTES)] = JMP_BYTES
    return bytes(out)


def _self_check(original: bytes, patched: bytes) -> None:
    """Re-verify the patched bytes: the three intended windows contain
    exactly the intended bytes, and every other byte in the file is
    unchanged from the input."""
    windows = [
        ('hook', HOOK_FILE_OFFSET, JMP_BYTES),
        ('cave', CAVE_FILE_OFFSET, CAVE_PAYLOAD),
        ('string', STRING_FILE_OFFSET, NEW_PAGE_BYTES),
    ]
    for name, off, expected in windows:
        got = patched[off:off + len(expected)]
        if got != expected:
            raise AssertionError(
                f'self-check failed: {name} window at file+{off:#x} is '
                f'{got.hex()}, expected {expected.hex()}')

    if len(original) != len(patched):
        raise AssertionError(
            f'self-check failed: output length {len(patched)} != input '
            f'length {len(original)}')

    ranges = [(off, off + len(expected)) for _, off, expected in windows]
    changed = [
        i for i in range(len(original))
        if original[i] != patched[i]
        and not any(lo <= i < hi for lo, hi in ranges)
    ]
    if changed:
        raise AssertionError(
            f'self-check failed: {len(changed)} byte(s) changed outside '
            f'the three intended windows, e.g. offset {changed[0]:#x} '
            f'({original[changed[0]]:#04x} -> {patched[changed[0]]:#04x})')


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Add a fourth intro-text page (about this repo\'s '
                    'restoration work) to Black Crypt\'s Windows demo '
                    'crypt.exe (Phase 5, see '
                    'docs/blackcrypt/dos/full-game-restoration-plan.md). '
                    'Never modifies the input file; writes a patched copy '
                    'to --out. Works against a stock crypt.exe or one '
                    'already patched by patch_crypt_exe.py -- but if you '
                    'want both, run patch_crypt_exe.py FIRST (its own '
                    'pre-flight check is stricter than what it writes and '
                    'will reject a crypt.exe this script has already '
                    'touched).')
    ap.add_argument('input', type=Path,
                     help='Path to your own crypt.exe (1995 demo build, '
                          'stock, or already patched by patch_crypt_exe.py '
                          '-- apply patch_crypt_exe.py first if you want '
                          'both patches)')
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
    print(f'  hook   file+{HOOK_FILE_OFFSET:#x} (vaddr {HOOK_VADDR:#x}) '
          f'-> jmp cave3 vaddr {CAVE3_VADDR:#x}: {JMP_BYTES.hex()}')
    print(f'  cave   file+{CAVE_FILE_OFFSET:#x} (vaddr {CAVE_BASE_VADDR:#x}), '
          f'{len(CAVE_PAYLOAD)} B: DlgProc + DialogBoxParamA thunk')
    print(f'  string file+{STRING_FILE_OFFSET:#x} (vaddr {STRING_VADDR:#x}), '
          f'{len(NEW_PAGE_BYTES)} B, NUL-terminated')
    print('  self-check OK: all three windows match intended bytes, zero '
          'differences elsewhere in the file')
    return 0


if __name__ == '__main__':
    sys.exit(main())

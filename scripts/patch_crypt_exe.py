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

Thunk (originally 22 bytes, assembled with `rasm2` on 2026-08-04 — see the
plan doc §"Phase 4" DONE block):

    mov   eax, dword [esp+4]      ; destMap, as pushed by both call sites
    movzx ecx, word [0x47481a]    ; fromMap = current map
    push  eax                     ; toMap
    push  ecx                     ; fromMap
    call  0x426880                ; SwitchMap
    add   esp, 8
    ret

## 2026-11-13: the destination map's accent ramp (TODO `blackcrypt-mapswitch-ramp`)

`SwitchMap` never touches the dungeon palette's accent ramp (entries 26-31
and half-bright 58-63). DOS keeps Amiga's mechanism — the 12x12-byte ramp
table at `0x432d08`, the per-map default table at `0x434f22` (14 words,
1-based map index: maps 1-4 -> 0, 5 -> 1, 6-11 -> 2, 12-13 -> 3, identical
to Amiga S_2 `+0x39E`) and `fcn.0040aaa0(ramp)` which rewrites those
entries — but the per-map table is read only at `0x40f8d0`, on a dark-square
(bit-31) state flip. So without this, map 5 would render (and save) ramp 0.

The thunk's last 4 bytes (`add esp,8; ret`) become `jmp short 0x42df2e` +
2 x `int3` padding, and a 59-byte tail at `0x42df2e` (past the Phase 5/7
caves) does what the `0x40f8c9`-`0x40f8df` branch does, for the new map:

    add   esp, 8                        ; pop SwitchMap's two args
    movzx eax, word [0x47481a]          ; curMap (SwitchMap set it = toMap)
    mov   ax, word [eax*2+0x434f22]     ; per-map default ramp
    mov   word [0x46f820], ax           ; active ramp (what saves record)
    push  eax
    call  0x40aaa0                      ; apply ramp to palette 26-31/58-63
    add   esp, 4
    ret

Both are assembled from `THUNK_SOURCE` below with GNU `as`/`ld` (one unit,
`-Ttext=0x42deb3`, so the linker resolves every displacement); the
self-check re-assembles and disassembles them on every run when binutils
is present (`bclib/x86patch.py`). The patcher also sets `.text`'s
VirtualSize from `0x2ceb4` to its raw size `0x2d000` (review finding 9), so
the caves are inside the declared section.

## 2026-11-21: the arrival triple (review finding 7)

Both cross-map callers skip their same-map redraw tails (stairs `0x423cf9
jmp 0x423e00`; teleport `0x41b3bb`), and `SwitchMap`/`LoadDungeon`
(`0x425350`)/`0x4258d0`/`0x40b7a0` never call the world renderer, so the
old thunk left the *previous* map's view on screen until the next step.
Decision (static): the skipped tail is needed. The same-map teleport path
(`0x41b3cd`: `0x4070b0; 0x40f830(1); 0x408310(0)`), the stairs
different-square path (`0x423de1`) and the stairs no-op path
(`0x423d7d`-`0x423d8c`, `0x408330` = `0x408310(0)`) all run exactly this
triple, and `0x40f830` is the renderer + square-entry handler (calls
`0x40a430(1)` draw, `0x40a970`, and the dark-flip branch whose ramp read
`0x40f8d0` is the one this thunk already mirrors). The compiler laid the
teleport's cross-map and same-map branches in parallel, so the original
(full-game) body of `0x423b50` must have performed the redraw itself. The
tail now ends with that triple after the ramp is applied. Not added: the
stairs-only `0x40a600` ("Line Dissolve" transition) and `0x4039a0` (a
queue compaction) -- cosmetic, and the teleport caller has no equivalent.

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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bclib import x86patch  # noqa: E402

# --- Addresses (all vaddr, PE image base 0x400000; .text's raw and virtual
# offsets coincide 1:1 for this binary, so file_offset = vaddr - 0x400000) --
STUB_VADDR = 0x423B50
STUB_FILE_OFFSET = STUB_VADDR - 0x400000          # 0x23b50
STUB_WINDOW_LEN = 16                              # 12-byte body + 4 NOP pad

CAVE_VADDR = 0x42DEB3
CAVE_FILE_OFFSET = CAVE_VADDR - 0x400000          # 0x2deb3

# The ramp-set tail lives past the Phase 5 / Phase 7 caves
# (0x42dec9-0x42df13 restoration note, 0x42df13-0x42df2e title credit).
RAMP_VADDR = 0x42DF2E
RAMP_FILE_OFFSET = RAMP_VADDR - 0x400000          # 0x2df2e
CAVE_END_VADDR = 0x42E000                         # end of .text raw data

SWITCHMAP_VADDR = 0x426880                        # SwitchMap(fromMap, toMap)
SET_RAMP_VADDR = 0x40AAA0                         # SetDungeonRamp(ramp)
CUR_MAP_VADDR = 0x47481A                          # word: current map, 1-based
MAP_RAMP_TABLE_VADDR = 0x434F22                   # word[14]: per-map default ramp
CUR_RAMP_VADDR = 0x46F820                         # word: active ramp (saved)

# Review finding 7 (2026-11-21): the "arrive on a square" triple that every
# same-map path runs and both cross-map callers skip.
ARRIVE_BOB_VADDR = 0x4070B0                       # walk-bob toggle
ARRIVE_ENTER_VADDR = 0x40F830                     # square-entry handler (arg 1): draws the view
ARRIVE_PRESENT_VADDR = 0x408310                   # present (arg 0)

# --- Source. Assembled with GNU as + ld -Ttext=0x42deb3 (one unit, so the
# rel8 jmp and both rel32 calls are resolved by the linker, not by hand).
# The .org gap 0x42dec9-0x42df2e is owned by other patchers and is never
# written by this one -- only the two slices below are.
THUNK_SOURCE = f'''
    mov   eax, dword ptr [esp+4]
    movzx ecx, word ptr ds:[{CUR_MAP_VADDR:#x}]
    push  eax
    push  ecx
    call  {SWITCHMAP_VADDR:#x}
    jmp   short ramp
    int3
    int3
.org {RAMP_VADDR - CAVE_VADDR:#x}, 0
ramp:
    add   esp, 8
    movzx eax, word ptr ds:[{CUR_MAP_VADDR:#x}]
    mov   ax, word ptr [eax*2+{MAP_RAMP_TABLE_VADDR:#x}]
    mov   word ptr ds:[{CUR_RAMP_VADDR:#x}], ax
    push  eax
    call  {SET_RAMP_VADDR:#x}
    add   esp, 4
    call  {ARRIVE_BOB_VADDR:#x}
    push  1
    call  {ARRIVE_ENTER_VADDR:#x}
    add   esp, 4
    push  0
    call  {ARRIVE_PRESENT_VADDR:#x}
    add   esp, 4
    ret
'''

# --- Bytes, as produced by x86patch.assemble(THUNK_SOURCE, CAVE_VADDR) and
# re-derived from source at every run when binutils is present.

# jmp rel32 from STUB_VADDR to CAVE_VADDR: e9 <cave - (stub + 5)>
JMP_BYTES = bytes.fromhex('e95ea30000')
assert len(JMP_BYTES) == 5
_jmp_target = STUB_VADDR + 5 + int.from_bytes(JMP_BYTES[1:], 'little', signed=True)
assert _jmp_target == CAVE_VADDR, hex(_jmp_target)

# Head, 22 B at 0x42deb3. The first 18 B are the original 2026-08-04 thunk
# unchanged; its old 'add esp,8; ret' tail is replaced by 'jmp short
# 0x42df2e' + 2x int3 padding (never executed).
THUNK_BYTES = bytes.fromhex(
    '8b4424040fb70d1a4847005051e8bb89ffff' 'eb67cccc')
assert len(THUNK_BYTES) == 22
_call_off = THUNK_BYTES.index(b'\xe8')
_call_target = (CAVE_VADDR + _call_off + 5 + int.from_bytes(
    THUNK_BYTES[_call_off + 1:_call_off + 5], 'little', signed=True))
assert _call_target == SWITCHMAP_VADDR, hex(_call_target)
assert CAVE_VADDR + 18 + 2 + THUNK_BYTES[19] == RAMP_VADDR

# Ramp + arrival tail, 59 B at 0x42df2e (2026-11-13 ramp, TODO
# blackcrypt-mapswitch-ramp; 2026-11-21 arrival triple, finding 7):
# after SwitchMap has set word[0x47481a] = toMap, apply that map's default
# accent ramp exactly as the dark-square-off branch at 0x40f8c9-0x40f8df
# does (word[0x434f22 + map*2] -> word[0x46f820] -> fcn.0040aaa0).
# Then the arrival triple (4070b0; 40f830(1); 408310(0)) exactly as the
# same-map teleport path at 0x41b3cd and the stairs paths at 0x423de1 /
# 0x423d7d run it -- see finding 7 in the module docstring.
RAMP_BYTES = bytes.fromhex(
    '83c408' '0fb7051a484700' '668b0445224f4300' '66a320f84600' '50'
    'e854cbfdff' '83c404'
    'e85c91fdff' '6a01' 'e8d518feff' '83c404' '6a00' 'e8aba3fdff' '83c404' 'c3')
assert len(RAMP_BYTES) == 59
assert RAMP_VADDR + len(RAMP_BYTES) <= CAVE_END_VADDR


def _call_targets(code: bytes, base: int) -> list[int]:
    """Targets of every `e8 rel32` found by walking the known fixed layout."""
    out, i = [], 0
    while i < len(code):
        if code[i] == 0xE8:
            out.append(base + i + 5 + int.from_bytes(code[i + 1:i + 5], 'little', signed=True))
            i += 5
        else:
            i += 1
    return out


# (the byte walk can see false 0xe8 inside immediates; the layout above has none)
assert _call_targets(RAMP_BYTES, RAMP_VADDR) == [
    SET_RAMP_VADDR, ARRIVE_BOB_VADDR, ARRIVE_ENTER_VADDR, ARRIVE_PRESENT_VADDR], \
    [hex(x) for x in _call_targets(RAMP_BYTES, RAMP_VADDR)]

EXPECTED_THUNK_INSNS = [
    'mov eax,DWORD PTR [esp+0x4]',
    'movzx ecx,WORD PTR ds:0x47481a',
    'push eax',
    'push ecx',
    'call 0x426880',
    'jmp 0x42df2e',
    'int3',
    'int3',
]
EXPECTED_RAMP_INSNS = [
    'add esp,0x8',
    'movzx eax,WORD PTR ds:0x47481a',
    'mov ax,WORD PTR [eax*2+0x434f22]',
    'mov ds:0x46f820,ax',
    'push eax',
    'call 0x40aaa0',
    'add esp,0x4',
    'call 0x4070b0',
    'push 0x1',
    'call 0x40f830',
    'add esp,0x4',
    'push 0x0',
    'call 0x408310',
    'add esp,0x4',
    'ret',
]

# Original stub bytes at STUB_FILE_OFFSET, for a pre-flight sanity check
# (refuse to patch a file that doesn't look like the known demo build).
EXPECTED_ORIGINAL_STUB = bytes.fromhex(
    '68c8b64300e8b68dfeff59c3' '90909090')
assert len(EXPECTED_ORIGINAL_STUB) == STUB_WINDOW_LEN

# Original bytes of the per-map ramp table (14 LE words, index = 1-based map,
# entry 0 unused): maps 1-4 -> 0, 5 -> 1, 6-11 -> 2, 12-13 -> 3. Same values
# as Amiga S_2 +0x39E. Checked so a different build can't be patched blind.
MAP_RAMP_TABLE_FILE_OFFSET = MAP_RAMP_TABLE_VADDR - 0x400000
EXPECTED_MAP_RAMP_TABLE = bytes.fromhex(
    '0000' '0000' '0000' '0000' '0000' '0100' '0200' '0200' '0200' '0200'
    '0200' '0200' '0300' '0300')

_WINDOWS = (
    ('stub', STUB_FILE_OFFSET, JMP_BYTES),
    ('thunk', CAVE_FILE_OFFSET, THUNK_BYTES),
    ('ramp', RAMP_FILE_OFFSET, RAMP_BYTES),
)


def patch(data: bytes) -> bytes:
    """Return a patched copy of `data` (a full `crypt.exe` image). Raises
    ValueError if the input doesn't look like the expected demo build."""
    if len(data) < RAMP_FILE_OFFSET + len(RAMP_BYTES):
        raise ValueError(
            f'input is only {len(data)} B -- too small to contain the '
            f'expected code cave at file+{RAMP_FILE_OFFSET:#x}')

    stub_window = data[STUB_FILE_OFFSET:STUB_FILE_OFFSET + STUB_WINDOW_LEN]
    if stub_window != EXPECTED_ORIGINAL_STUB:
        raise ValueError(
            f'stub bytes at file+{STUB_FILE_OFFSET:#x} do not match the '
            f'known "END OF THE TEST LEVEL" stub (fcn.00423b50) -- got '
            f'{stub_window.hex()}, expected {EXPECTED_ORIGINAL_STUB.hex()}. '
            f'Refusing to patch what may not be the expected crypt.exe '
            f'build (1995 demo, 253,952 B).')

    table = data[MAP_RAMP_TABLE_FILE_OFFSET:
                 MAP_RAMP_TABLE_FILE_OFFSET + len(EXPECTED_MAP_RAMP_TABLE)]
    if table != EXPECTED_MAP_RAMP_TABLE:
        raise ValueError(
            f'per-map ramp table at file+{MAP_RAMP_TABLE_FILE_OFFSET:#x} is '
            f'{table.hex()}, expected {EXPECTED_MAP_RAMP_TABLE.hex()}')

    # Only the two slices this patcher writes must be free; the gap between
    # them belongs to the Phase 5/7 patchers, so application order is free.
    for name, off, payload in _WINDOWS[1:]:
        window = data[off:off + len(payload)]
        if any(window):
            raise ValueError(
                f'{name} code cave at file+{off:#x} is not all-zero '
                f'({sum(1 for b in window if b)} nonzero bytes out of '
                f'{len(payload)}) -- refusing to overwrite what might be '
                f'real code/data, or an already-applied copy of this patch.')

    out = bytearray(data)
    for _name, off, payload in _WINDOWS:
        out[off:off + len(payload)] = payload
    x86patch.fix_virtual_size(out, '.text')
    return bytes(out)


def _self_check(original: bytes, patched: bytes) -> list[str]:
    """Re-verify the patched bytes exactly as the plan doc's verification
    bar demands: the intended windows contain exactly the intended bytes,
    every other byte in the file is unchanged from the input, and (when GNU
    binutils is present) the embedded bytes re-assemble from THUNK_SOURCE
    byte-exact and disassemble back to the intended instructions."""
    for name, off, expected in _WINDOWS:
        got = patched[off:off + len(expected)]
        if got != expected:
            raise AssertionError(
                f'self-check failed: {name} window at file+{off:#x} is '
                f'{got.hex()}, expected {expected.hex()}')
    x86patch.check_virtual_size(patched, '.text')

    if len(original) != len(patched):
        raise AssertionError(
            f'self-check failed: output length {len(patched)} != input '
            f'length {len(original)}')

    vs_off = x86patch.VIRTUAL_SIZE_FIX['.text'][0]
    ranges = [(off, off + len(p)) for _n, off, p in _WINDOWS]
    ranges.append((vs_off, vs_off + 4))
    changed = [
        i for i in range(len(original))
        if original[i] != patched[i]
        and not any(lo <= i < hi for lo, hi in ranges)
    ]
    if changed:
        raise AssertionError(
            f'self-check failed: {len(changed)} byte(s) changed outside '
            f'the intended windows, e.g. offset {changed[0]:#x} '
            f'({original[changed[0]]:#04x} -> {patched[changed[0]]:#04x})')

    notes = []
    if x86patch.have_toolchain():
        unit = x86patch.assemble(THUNK_SOURCE, CAVE_VADDR)
        gap = RAMP_VADDR - CAVE_VADDR
        if (unit[:len(THUNK_BYTES)] != THUNK_BYTES
                or unit[gap:] != RAMP_BYTES
                or any(unit[len(THUNK_BYTES):gap])):
            raise AssertionError(
                f'self-check failed: GNU as output {unit.hex()} does not '
                f'reproduce the embedded thunk/ramp bytes')
        notes.append(f'THUNK_SOURCE re-assembled with GNU as/ld at '
                     f'{CAVE_VADDR:#x}: byte-exact ({len(THUNK_BYTES)} + '
                     f'{len(RAMP_BYTES)} B)')
    notes.append(x86patch.verify_roundtrip(
        'thunk', THUNK_BYTES, CAVE_VADDR, None, EXPECTED_THUNK_INSNS))
    notes.append(x86patch.verify_roundtrip(
        'ramp', RAMP_BYTES, RAMP_VADDR, None, EXPECTED_RAMP_INSNS))
    notes.append(x86patch.verify_roundtrip(
        'stub', JMP_BYTES, STUB_VADDR, None, ['jmp 0x42deb3']))
    return notes


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
        notes = _self_check(original, written)
    except AssertionError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    print(f'patched {in_path} ({len(original)} B) -> {out_path}')
    print(f'  jmp   file+{STUB_FILE_OFFSET:#x} (vaddr {STUB_VADDR:#x}) '
          f'-> cave vaddr {CAVE_VADDR:#x}: {JMP_BYTES.hex()}')
    print(f'  thunk file+{CAVE_FILE_OFFSET:#x} (vaddr {CAVE_VADDR:#x}), '
          f'{len(THUNK_BYTES)} B: {THUNK_BYTES.hex()}')
    print(f'  ramp  file+{RAMP_FILE_OFFSET:#x} (vaddr {RAMP_VADDR:#x}), '
          f'{len(RAMP_BYTES)} B: {RAMP_BYTES.hex()}')
    print('  .text VirtualSize -> 0x2d000')
    print('  self-check OK: all windows match intended bytes, zero '
          'differences elsewhere in the file')
    for n in notes:
        print(f'  {n}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

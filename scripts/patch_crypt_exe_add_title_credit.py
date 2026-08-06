#!/usr/bin/env python3
"""Add a second, fan-restoration credit line to the Black Crypt Windows
demo's `crypt.exe` title-screen sequence -- Phase 7 of
`docs/blackcrypt/dos/full-game-restoration-plan.md`.

## The mechanism (traced this session)

`fcn.0040b970` (called once, from `fcn.0040bbe0` at `0x40c1f5`, the
resource-directory build routine) is the whole pre-game title sequence: it
shows four full-screen 320x200 clipper-directory bitmaps in a row --
`"Title 4"` (the real Raven Software credits screen: DESIGN/GRAPHICS/MUSIC/
PROGRAMMING/SOUND, ~350 ticks), `"Title 1"` (a bare gargoyle-temple
background with no "BLACK CRYPT" wordmark yet, ~100 ticks), `"Title 2"`
(the same background *with* the wordmark, ~400 ticks), then `"Title 3"`
(the game's premise blurb + item icons, waits indefinitely for a keypress).

Each screen's background is blitted onto one of a small pair of
directory-indexed off-screen surfaces (`dword[idx*4 + 0x469998]`, `idx`
selected by the global "current" index `word[0x4699a4]`), then made
visible either by `fcn.00403d20()` (Title 1/3/4's normal path -- flips the
just-drawn buffer to the screen and *also* toggles `word[0x4699a4]`
(next draw target) against `word[0x46b2fc]` (mirrors whichever buffer is
now on-screen)) or, for Title 2 only, `fcn.00408120(0, 320, 200)` (locks
the two directory-indexed surfaces selected by `word[0x4699a4]` (source)
and `word[0x46b2fc]` (dest) and byte-copies **200 rows only** -- a
real, code-derived bound, `H` is the one argument the function actually
reads).

**The existing "PC CRYPT V1.0 BY RICK JOHNSON!" credit** is drawn by
`fcn.0040c9b0(stringPtr, styleArg, widthArg)`, called once during Title 2's
block (`0x40ba9a`-`0x40baa3`, args `(str.PC_CRYPT_..., 1, 0x24)`).
`fcn.0040c9b0` draws its glyphs onto a **single fixed global surface,
`dword[0x46bd38]`** (confirmed by reading its own Blt call at `0x40cab4`/
`0x40cadc`: `mov ecx, dword[0x46bd38]` used directly as the call's `this`,
no directory indexing at all) -- the same fixed surface used by ~40
unrelated in-game UI-drawing routines elsewhere in this executable (item
icons, health bars, etc., all outside the title sequence), strongly
indicating it's the buffer the game always draws UI overlays onto for
display, not one of the toggled scratch buffers. Every character blits an
8x8 slice of the `"Scroll Font 1"` font strip to a **hardcoded destination
row, `y = 0xdd` (221)** -- a literal inside `fcn.0040c9b0`'s own body
(`push 0xdd` at `0x40cad2`), identical for every caller, *not* a parameter.

**Why the existing credit survives Title 2's own background-refresh-then-
present sequence**: `fcn.0040c9b0` is called (drawing onto `0x46bd38`)
*before* Title 2's own background blit (onto the directory-indexed
surface) and *before* `fcn.00408120`'s composite -- but neither of those
later steps can erase it, because both are bounded to the top `200` rows
(`H` argument / SetRect height), while the credit sits at row `221`,
outside that range. This -- not draw-order alone -- is what actually makes
the credit immune to the composite step, a detail the original write-up
of this phase didn't establish and got partially wrong (see the "Live-test
bug, fixed this session" section below).

## The live-test bug (found and fixed this session)

The first shipped version of this patch reused `fcn.00408120(0, 320, 200)`
-- Title 2's own "make visible" call -- as its present step, on the theory
that it was a safe, already-proven drop-in. Live-testing under Wine showed
the new credit *did* render, but **Title 4's Raven Software credits screen
flashed back onto the display at the same time.**

Root cause, traced instruction-by-instruction (not guessed): at the exact
point in `fcn.0040b970` where this patch's hook fires (right after Title
1's own `call fcn.00403d20` at `0x40ba61`, its only in-between instruction
being the stolen, harmless `fcn.0040aaf0(3, 1)` sound call), the toggle
bookkeeping is deterministic and confirmed by tracing every prior
`fcn.00403d20` call in the sequence: `word[0x4699a4] == 1`. That directory
slot (`dword[0x46999c]`, i.e. `1*4 + 0x469998`) was **last written during
Title 4's own background blit, at the very start of the function, and is
never redrawn again before this point** -- Title 1's own background blit
went to the *other* slot (index 0). So it's genuinely stale, holding
Title 4's picture.

Title 2's own, real call site never hits this problem because its call
order is: draw credit (onto `0x46bd38`) -> **resolve and Blt Title 2's own
background onto the directory slot `fcn.00408120` is about to read as its
source** -> call `fcn.00408120`. That background blit is what keeps the
composite's source fresh. This patch's cave skipped that step entirely --
it drew the credit and went straight to `fcn.00408120`, so the composite's
`H=200`-row copy pulled two-screens-old Title 4 pixels into the on-screen
picture area (rows 0-199); the credit itself survived only because row
221 falls outside that copied range, exactly per the mechanism above --
which is why the bug looked exactly like "new credit, but old Raven logo
underneath it" rather than a scrambled mess.

**The fix, verified against that same trace**: `fcn.00408120` was never
actually necessary. Title 1's own normal presenter,
`call fcn.00403d20`, already runs *unmodified*, immediately before this
patch's hook, and correctly Blits Title 1's own (non-stale) background
onto `dword[0x46bd38]` before the hook ever fires -- i.e. the on-screen
picture is already correct at the moment the cave starts running. Adding
*any* extra composite/present call after that is not just redundant, it's
actively harmful here, because the one directory slot available for such a
call to source from (`word[0x4699a4]`) happens to be the stale one at this
exact point in the four-screen sequence. Re-calling `fcn.00403d20()`
itself would reproduce the same class of bug (it also sources from
`word[0x4699a4]`). The correct cave simply **drops the present step
entirely**: re-execute the stolen sound call, draw the credit onto
`0x46bd38` (already showing the correct picture), and resume -- nothing
else is needed. This shrinks the cave from 47 B to 27 B (see below).

## What this patch does

Reuses `fcn.0040c9b0` **completely unmodified**, calling it with a new
string on **Title 1's** block instead of Title 2's -- Title 1 is a bare
background (no wordmark, no existing text draw of any kind) shown for the
same on-screen row window, so a second call to the exact same function,
positioned analogously to Title 2's own credit call, cannot collide with
anything: not the real Raven Software credits (that's Title 4, a separate
screen, never touched), not Rick Johnson's own PC-port credit (Title 2, a
separate screen, never touched).

Insertion point: Title 1's block ends with
`fcn.0040aaf0(3, 1); wait-100-ticks-for-input-or-timeout`. The `call
fcn.0040aaf0` at `0x40ba6a` (5 B: `e8 81 f0 ff ff`) is stolen and replaced
with a 5-byte `jmp rel32` to a cave that: re-executes the exact stolen
call (args were already pushed by the two instructions just before the
hook and are untouched), then draws the new credit the same way Title 2's
own credit is drawn (`fcn.0040c9b0(newStr, 1, 0x24)` -- identical arg
shape to the proven-working call), then jumps back to resume Title 1's own
code unmodified. No present/composite call is made -- see above for why
none is needed.

`fcn.0040c9b0` ends in a bare `ret` (confirmed by disassembly, not
assumed) -- i.e. cdecl, caller cleans the stack -- so the cave explicitly
balances its own call with `add esp, 0xc`; it does not rely on any of the
surrounding function's own deferred/batched stack cleanup (which exists
for the *original*, untouched instructions and must not be disturbed).

## Feasibility -- slack space, checked fresh for this patch

Per this project's standard (Phase 4/5): searched for large all-zero runs,
then required each candidate to have **zero** dwords anywhere in the whole
253,952-byte file decoding as a pointer into it (a fresh file-wide scan,
not assumed from Phase 4/5's own findings, since those two patches already
consumed part of the same cave):

- **Code**: the same shared `.text` cave Phase 4/5 use
  (`0x42DEB3`-`0x42E000`, 333 B) has **237 B free** after Phase 4's 22 B
  thunk and Phase 5's 74 B DlgProc+thunk (`0x2DEB3`+22+74 = `0x2DF13`
  onward). Freshly confirmed all-zero in the real, unmodified
  `data/blackcrypt/dosvga/crypt.exe` at the time of this patch (not
  inherited from the older docs). This patch's cave (27 B, after this
  session's fix -- previously 47 B) fits inside with 210 B to spare.
- **String data**: `.rdata`'s own unused tail, `0x42F2D9`-`0x430000`
  (3,367 B), of which Phase 5 uses the first 695 B (`0x42F2D9`-`0x42F590`).
  This patch places its string well clear of that, at `0x42F600` (112 B of
  margin from Phase 5's own end), with 2,560 B still free afterward. A
  fresh file-wide dword scan for pointers into either target region (the
  27-byte cave slice and the 40-byte string slice) found **zero** hits in
  both.

**Composability, checked explicitly, not assumed:** this patch's own hook,
cave and string windows are fully disjoint from both `patch_crypt_exe.py`
(Phase 4, patches `fcn.00423b50` + `0x2DEB3`-`0x2DEC9`) and
`patch_crypt_exe_add_restoration_note.py` (Phase 5, patches `0x41361B` +
`0x2DEC9`-`0x2DF13` + `0x2F2D9`-`0x42F590`), so this patch applies cleanly
to a stock `crypt.exe`, or one already patched by Phase 4, or one already
patched by both Phase 4 and Phase 5, in any combination. **One real
ordering constraint exists, inherited from Phase 5's own precondition, not
introduced by this patch:** Phase 5's pre-flight check requires its *entire
311-byte cave remainder* (`0x2DEC9`-`0x2E000`) to read all-zero, which
includes the bytes this patch writes. So if this patch is applied
*before* Phase 5, Phase 5 can never be applied afterward (its own guard
will correctly refuse). **Apply Phase 5 before this patch if you want
both.** This patch itself does not require Phase 4 or Phase 5 -- it can be
applied to a stock `crypt.exe` on its own. Composability with Phase 6's
copy-failure guard (`patch_crypt_exe_guard_copy_failure.py`, hook at
`fcn.00423b50`'s own body / `"9"` in the plan doc) was also re-checked this
session: disjoint hook and cave windows, no interaction.

## The drafted text

`"FAN RESTORATION AT CRAWL.SHAID.NET"` (34 chars, all-caps, space/letters/
period only -- every character class already proven safe by the existing,
shipped "PC CRYPT V1.0 BY RICK JOHNSON!" credit, which also uses space,
letters and a period). Centered start offset `(40-34)*4 = 24 px` from each
edge -- comfortable margin, nowhere near the `strlen<=40` overflow bound.
Deliberately terse (a title-screen credit line has no room for prose) and
deliberately *not* claiming official status, Rick Johnson's authorship, or
Raven/Activision affiliation -- "fan restoration" reads as exactly what it
is. `crawl.shaid.net` is this project's own real, already-deployed docs
site (same URL Phase 5's dialog page uses).

## Verification performed

Every immediate/rel32 byte below was produced by `rasm2 -a x86 -b32 -s
<addr> '<insn>'`, never hand-computed, and independently re-validated here
by decoding each `push`/`jmp`/`call` operand back out of the assembled
bytes and asserting it lands on the intended address. The self-check
re-reads the file from disk and re-verifies both windows plus a full-file
byte diff showing zero changes outside the three intended windows (hook,
cave, string).

**Live-tested this session (Wine), not just statically verified**: the
first version of this patch (with the now-removed `fcn.00408120` present
call) was live-tested under Wine by the project owner and the Title-4
flashback bug was observed and reported first-hand -- this is the ground
truth that drove the fix above, not a hypothesis. The corrected version
(this file) has been statically re-verified with the same rigor as the
original (byte-exact diff, round-trip disassembly, composability checks),
but a second live Wine pass to confirm the fix is still recommended before
calling this phase fully closed.

## Repo hygiene

Same as `patch_crypt_exe.py` / `patch_crypt_exe_add_restoration_note.py`:
never reads/writes `data/blackcrypt/dosvga/crypt.exe` in place, refuses
same input/output path, refuses to overwrite an existing output without
`--force`, and no patched binary is committed.
"""
import argparse
import sys
from pathlib import Path

# --- Addresses (all vaddr, PE image base 0x400000; every section here is
# raw-identity-mapped, so file_offset = vaddr - 0x400000) -------------------

HOOK_VADDR = 0x40BA6A             # 'call fcn.0040aaf0' inside Title 1's block
HOOK_FILE_OFFSET = HOOK_VADDR - 0x400000     # 0xba6a
HOOK_LEN = 5

CAVE_BASE_VADDR = 0x42DF13        # first free byte after Phase 4 + Phase 5
CAVE_FILE_OFFSET = CAVE_BASE_VADDR - 0x400000    # 0x2df13
CAVE_MAX_LEN = 237                # 0x42df13 .. 0x42e000, all confirmed zero

STRING_VADDR = 0x42F600           # .rdata tail, well clear of Phase 5's own
STRING_FILE_OFFSET = STRING_VADDR - 0x400000     # 0x2f600
STRING_REGION_LEN = 0x430000 - STRING_VADDR      # 2,560 B available

TITLE_1_DRAW_TEXT_IAT = 0x40C9B0        # fcn.0040c9b0 (the credit-line drawer)
STOLEN_CALL_TARGET = 0x40AAF0           # fcn.0040aaf0 (sound start/stop)
RESUME_VADDR = HOOK_VADDR + HOOK_LEN    # 0x40ba6f, 'push 1' (wait loop start)

DRAW_ARG2 = 1        # matches Title 2's own credit call exactly
DRAW_ARG3 = 0x24      # matches Title 2's own credit call exactly

# --- The new title-screen credit line ---------------------------------
# ALL CAPS, space/letters/period only -- "Scroll Font 1" (clipper.clp entry
# 128, 8x472 px = 59 glyph slots) only covers glyphs 0x20 (space) through
# 0x5A ('Z'); no lowercase. strlen=34 <= 40 (the hard on-screen-width bound
# derived from fcn.0040c9b0's own centering formula), giving 24 px of
# margin on each side.
NEW_CREDIT_TEXT = "FAN RESTORATION AT CRAWL.SHAID.NET"
assert all(c == ' ' or c == '.' or ('A' <= c <= 'Z') for c in NEW_CREDIT_TEXT)
assert len(NEW_CREDIT_TEXT) <= 40, (
    f'credit text is {len(NEW_CREDIT_TEXT)} chars -- would run off-screen '
    f'(the font/centering routine only supports <=40 chars at 320 px wide)')
NEW_CREDIT_BYTES = NEW_CREDIT_TEXT.encode('ascii') + b'\x00'
assert len(NEW_CREDIT_BYTES) <= STRING_REGION_LEN

# --- Assembled bytes (rasm2 -a x86 -b 32 -s <addr> '<insn>', see docstring) -
#
# Cave layout @ CAVE_BASE_VADDR (0x42df13), 27 B total (was 47 B before
# this session's fix -- the present/composite step at the old +22..+41 was
# removed, see "The live-test bug" above):
#   +0  e8d8cbfdff      call 0x40aaf0        ; re-executed stolen instruction
#   +5  6a24            push 0x24            ; DRAW_ARG3
#   +7  6a01            push 1               ; DRAW_ARG2
#   +9  6800f64200      push 0x42f600        ; NEW_CREDIT_BYTES address
#   +14 e88aeafdff      call 0x40c9b0        ; fcn.0040c9b0 (draw credit)
#   +19 83c40c          add esp, 0xc         ; cdecl cleanup (3 args)
#   +22 e941dbfdff      jmp 0x40ba6f         ; resume Title 1's own code
CAVE_PAYLOAD = bytes.fromhex(
    'e8d8cbfdff'
    '6a24'
    '6a01'
    '6800f64200'
    'e88aeafdff'
    '83c40c'
    'e941dbfdff'
)
assert len(CAVE_PAYLOAD) == 27
assert len(CAVE_PAYLOAD) <= CAVE_MAX_LEN

# Cross-checks -- decode every operand back out of the assembled bytes and
# assert it lands on the intended address (mirrors patch_crypt_exe.py /
# patch_crypt_exe_add_restoration_note.py's own style).

# +0: 'call 0x40aaf0' (5 B: e8 rel32)
_c1_next = CAVE_BASE_VADDR + 0 + 5
_c1_rel32 = int.from_bytes(CAVE_PAYLOAD[1:5], 'little', signed=True)
assert _c1_next + _c1_rel32 == STOLEN_CALL_TARGET, hex(_c1_next + _c1_rel32)

# +9: 'push 0x42f600' (5 B: 68 imm32)
_pushed_str_va = int.from_bytes(CAVE_PAYLOAD[10:14], 'little')
assert _pushed_str_va == STRING_VADDR, hex(_pushed_str_va)

# +14: 'call 0x40c9b0' (5 B: e8 rel32)
_c2_next = CAVE_BASE_VADDR + 14 + 5
_c2_rel32 = int.from_bytes(CAVE_PAYLOAD[15:19], 'little', signed=True)
assert _c2_next + _c2_rel32 == TITLE_1_DRAW_TEXT_IAT, hex(_c2_next + _c2_rel32)

# +22: 'jmp 0x40ba6f' (5 B: e9 rel32)
_jmp_back_next = CAVE_BASE_VADDR + 22 + 5
_jmp_back_rel32 = int.from_bytes(CAVE_PAYLOAD[23:27], 'little', signed=True)
assert _jmp_back_next + _jmp_back_rel32 == RESUME_VADDR, hex(_jmp_back_next + _jmp_back_rel32)

# Original bytes at HOOK_FILE_OFFSET, for the pre-flight sanity check.
EXPECTED_HOOK_BYTES = bytes.fromhex('e881f0ffff')
assert len(EXPECTED_HOOK_BYTES) == HOOK_LEN
_expected_hook_target = HOOK_VADDR + 5 + int.from_bytes(
    EXPECTED_HOOK_BYTES[1:], 'little', signed=True)
assert _expected_hook_target == STOLEN_CALL_TARGET, hex(_expected_hook_target)

# jmp rel32 from HOOK_VADDR to CAVE_BASE_VADDR: e9 <cave - (hook+5)>
JMP_BYTES = bytes.fromhex('e9a4240200')
assert len(JMP_BYTES) == 5
_jmp_target = HOOK_VADDR + 5 + int.from_bytes(JMP_BYTES[1:], 'little', signed=True)
assert _jmp_target == CAVE_BASE_VADDR, hex(_jmp_target)


def patch(data: bytes) -> bytes:
    """Return a patched copy of `data` (a full `crypt.exe` image), adding
    the second title-screen credit line. Raises ValueError if the input
    doesn't look like the expected demo build, or if the target regions
    aren't free."""
    min_len = max(STRING_FILE_OFFSET + len(NEW_CREDIT_BYTES),
                   CAVE_FILE_OFFSET + len(CAVE_PAYLOAD))
    if len(data) < min_len:
        raise ValueError(
            f'input is only {len(data)} B -- too small to contain the '
            f'expected target regions (need at least {min_len} B)')

    hook_window = data[HOOK_FILE_OFFSET:HOOK_FILE_OFFSET + HOOK_LEN]
    if hook_window != EXPECTED_HOOK_BYTES:
        raise ValueError(
            f'bytes at file+{HOOK_FILE_OFFSET:#x} do not match the known '
            f'"call fcn.0040aaf0" instruction inside Title 1\'s block in '
            f'fcn.0040b970 -- got {hook_window.hex()}, expected '
            f'{EXPECTED_HOOK_BYTES.hex()}. Refusing to patch what may not '
            f'be the expected crypt.exe build (1995 demo, 253,952 B), or a '
            f'crypt.exe this same patch has already been applied to.')

    cave_window = data[CAVE_FILE_OFFSET:CAVE_FILE_OFFSET + len(CAVE_PAYLOAD)]
    if any(cave_window):
        raise ValueError(
            f'.text code cave slice at file+{CAVE_FILE_OFFSET:#x} is not '
            f'all-zero ({sum(1 for b in cave_window if b)} nonzero bytes '
            f'out of {len(CAVE_PAYLOAD)}) -- refusing to overwrite what '
            f'might be real code/data, or an already-applied copy of this '
            f'same patch, in a different crypt.exe build. (If you also '
            f'want patch_crypt_exe_add_restoration_note.py\'s Phase 5 '
            f'patch, apply it BEFORE this one -- see this script\'s '
            f'docstring for why the order matters.)')

    string_window = data[STRING_FILE_OFFSET:STRING_FILE_OFFSET + len(NEW_CREDIT_BYTES)]
    if any(string_window):
        raise ValueError(
            f'.rdata tail at file+{STRING_FILE_OFFSET:#x} is not all-zero '
            f'({sum(1 for b in string_window if b)} nonzero bytes out of '
            f'{len(NEW_CREDIT_BYTES)}) -- refusing to overwrite what might '
            f'be real data in a different crypt.exe build.')

    out = bytearray(data)
    out[STRING_FILE_OFFSET:STRING_FILE_OFFSET + len(NEW_CREDIT_BYTES)] = NEW_CREDIT_BYTES
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
        ('string', STRING_FILE_OFFSET, NEW_CREDIT_BYTES),
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
        description='Add a second title-screen credit line ("FAN '
                    'RESTORATION AT CRAWL.SHAID.NET") to Black Crypt\'s '
                    'Windows demo crypt.exe (Phase 7, see '
                    'docs/blackcrypt/dos/full-game-restoration-plan.md). '
                    'Never modifies the input file; writes a patched copy '
                    'to --out. Works against a stock crypt.exe, one '
                    'already patched by patch_crypt_exe.py (Phase 4), or '
                    'one already patched by both that and '
                    'patch_crypt_exe_add_restoration_note.py (Phase 5) -- '
                    'but if you want Phase 5 too, apply it BEFORE this '
                    'script (Phase 5\'s own pre-flight check is stricter '
                    'than what it writes and will reject a crypt.exe this '
                    'script has already touched).')
    ap.add_argument('input', type=Path,
                     help='Path to your own crypt.exe (1995 demo build, '
                          'stock or already patched by patch_crypt_exe.py '
                          'and/or patch_crypt_exe_add_restoration_note.py)')
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
          f'-> jmp cave vaddr {CAVE_BASE_VADDR:#x}: {JMP_BYTES.hex()}')
    print(f'  cave   file+{CAVE_FILE_OFFSET:#x} (vaddr {CAVE_BASE_VADDR:#x}), '
          f'{len(CAVE_PAYLOAD)} B: re-executed sound call + draw-credit '
          f'(no present call -- see docstring for why none is needed)')
    print(f'  string file+{STRING_FILE_OFFSET:#x} (vaddr {STRING_VADDR:#x}), '
          f'{len(NEW_CREDIT_BYTES)} B, NUL-terminated: '
          f'{NEW_CREDIT_TEXT!r}')
    print('  self-check OK: all three windows match intended bytes, zero '
          'differences elsewhere in the file')
    return 0


if __name__ == '__main__':
    sys.exit(main())

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
Each screen is: resolve the bitmap by name (`fcn.00402650`), blit it, then
either `fcn.00403d20()` (Title 1/3/4's "make visible" step) or, for Title 2
only, `fcn.00408120(0, 320, 200)` (a slower, explicit-dimension present
routine -- confirmed by disassembly to Lock two directory-indexed surfaces
and byte-copy `200` rows across 4 bands, i.e. it really does present a full
320x200 region, not a smaller sub-rect).

**The existing "PC CRYPT V1.0 BY RICK JOHNSON!" credit** is drawn by
`fcn.0040c9b0(stringPtr, styleArg, widthArg)`, called once during Title 2's
block (`0x40ba9a`-`0x40baa3`, args `(str.PC_CRYPT_..., 1, 0x24)`) *before*
Title 2's own background blit -- confirmed safe because that credit renders
at a fixed row **below** the picture area, not inside it (see next
paragraph), so draw-then-blit ordering doesn't matter: the background blit
never touches that row.

`fcn.0040c9b0` (392 B, traced instruction-by-instruction):

- Computes `strlen` via `repne scasb`, then the glyph loop's starting X as
  `esi = (40 - strlen) * 4` -- exactly the classic centering formula for a
  320px-wide, 8px-per-glyph text line (`(320 - strlen*8) / 2`, refactored).
  **This is a real, code-level constraint, not a guess**: with `strlen`
  characters at 8 px each, the line only stays on-screen (0 <= x <
  320) for `strlen <= 40`; the existing credit is 31 chars, so it already
  uses most of that budget (9 chars of headroom, `(40-31)*4 = 36 px` start
  offset).
- Per character: glyph index = `charCode - 0x20`; **bounds-checked against
  the "Scroll Font 1" clipper entry's own declared height field** (confirmed
  via `clipper.clp`: entry 128, `"Scroll Font 1"`, type 2, `8x472` px --
  472/8 = 59 glyph slots, i.e. valid chars are exactly `0x20` (space)
  through `0x5A` (`'Z'`), covering space, digits, most ASCII punctuation,
  and uppercase A-Z, but **no lowercase** (`fcn.0040c9b0` at `0x40ca90`:
  `cmp ax, word[edx*4+0x43c7b0]; jg <skip this char>` -- a character whose
  glyph offset exceeds the strip's own height is silently dropped, not
  drawn, no crash). This matches the existing credit's own ALL-CAPS style
  exactly, and is why any addition must also be ALL-CAPS with no lowercase.
- Every character blits from an 8x8 slice of the `"Scroll Font 1"` strip to
  a **hardcoded destination row, `y = 0xdd` (221)** -- a literal embedded in
  `fcn.0040c9b0`'s own body (`push 0xdd` at `0x40cad2`), identical for
  every caller; it is *not* a parameter. Confirmed via the standard
  `(this, x, y, srcSurf, srcRect, flags)` calling convention already
  established for the file's other directory-entry Blit calls (verified by
  reading the exact push order for both the credit-line call and the known-
  correct Title-N background blit, which uses the same convention with
  known-correct `x=0, y=0` values). Since `y` is compiled-in, giving a
  *second* credit its own row would need patching `fcn.0040c9b0` itself
  (touching the one existing, working credit) or a full near-duplicate of
  the function -- neither is worth it when there are three other title
  screens with nothing drawn at that row at all.

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
hook and are untouched), draws the new credit the same way Title 2's own
credit is drawn (`fcn.0040c9b0(newStr, 1, 0x24)` -- identical arg shape to
the proven-working call), presents it with the same routine already proven
to make a `fcn.0040c9b0`-drawn credit visible (`fcn.00408120(0, 320, 200)`,
Title 2's own "make visible" call -- Title 1 normally uses the plainer
`fcn.00403d20()` instead, which stays untouched and still runs immediately
before the hook fires, so Title 1's picture displays exactly as before for
one instant, then our credit is drawn and an extra, harmless present makes
it visible too), then jumps back to resume Title 1's own code unmodified.

Both `fcn.0040c9b0` and `fcn.00408120` end in a bare `ret` (confirmed by
disassembly, not assumed) -- i.e. cdecl, caller cleans the stack -- so the
cave explicitly balances its own two calls with `add esp, 0xc` each; it
does not rely on any of the surrounding function's own deferred/batched
stack cleanup (which exists for the *original*, untouched instructions and
must not be disturbed).

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
  inherited from the older docs). This patch's cave (47 B) fits inside
  with 190 B to spare.
- **String data**: `.rdata`'s own unused tail, `0x42F2D9`-`0x430000`
  (3,367 B), of which Phase 5 uses the first 695 B (`0x42F2D9`-`0x42F590`).
  This patch places its string well clear of that, at `0x42F600` (112 B of
  margin from Phase 5's own end), with 2,560 B still free afterward. A
  fresh file-wide dword scan for pointers into either target region (the
  47-byte cave slice and the 40-byte string slice) found **zero** hits in
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
includes the 47 bytes this patch writes. So if this patch is applied
*before* Phase 5, Phase 5 can never be applied afterward (its own guard
will correctly refuse). **Apply Phase 5 before this patch if you want
both.** This patch itself does not require Phase 4 or Phase 5 -- it can be
applied to a stock `crypt.exe` on its own.

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

**Not done (same scope boundary as Phase 4/5):** live Wine/screenshot
confirmation. Static, byte-exact verification is this project's established
bar for code patches (Phase 4/5 shipped on that basis); the credit's
placement (same row as the already-proven-working Rick Johnson credit, same
draw/present routine pair, same font, same centering formula) is derived
from, not merely modeled after, the one credit line already confirmed to
render correctly in the shipped game.

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
PRESENT_IAT = 0x408120                  # fcn.00408120 (Title 2's own "make visible")
STOLEN_CALL_TARGET = 0x40AAF0           # fcn.0040aaf0 (sound start/stop)
RESUME_VADDR = HOOK_VADDR + HOOK_LEN    # 0x40ba6f, 'push 1' (wait loop start)

DRAW_ARG2 = 1        # matches Title 2's own credit call exactly
DRAW_ARG3 = 0x24      # matches Title 2's own credit call exactly
PRESENT_ARG_X = 0
PRESENT_ARG_W = 0x140  # 320
PRESENT_ARG_H = 0xC8   # 200

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

# Cave layout @ CAVE_BASE_VADDR (0x42df13), 47 B total:
#   +0  e8d8cbfdff      call 0x40aaf0        ; re-executed stolen instruction
#   +5  6a24            push 0x24            ; DRAW_ARG3
#   +7  6a01            push 1               ; DRAW_ARG2
#   +9  6800f64200      push 0x42f600        ; NEW_CREDIT_BYTES address
#   +14 e88aeafdff      call 0x40c9b0        ; fcn.0040c9b0 (draw credit)
#   +19 83c40c          add esp, 0xc         ; cdecl cleanup (3 args)
#   +22 68c8000000      push 0xc8            ; height=200
#   +27 6840010000      push 0x140           ; width=320
#   +32 6a00            push 0               ; x=0
#   +34 e8e6a1fdff      call 0x408120        ; fcn.00408120 (present)
#   +39 83c40c          add esp, 0xc         ; cdecl cleanup (3 args)
#   +42 e92ddbfdff      jmp 0x40ba6f         ; resume Title 1's own code
CAVE_PAYLOAD = bytes.fromhex(
    'e8d8cbfdff'
    '6a24'
    '6a01'
    '6800f64200'
    'e88aeafdff'
    '83c40c'
    '68c8000000'
    '6840010000'
    '6a00'
    'e8e6a1fdff'
    '83c40c'
    'e92ddbfdff'
)
assert len(CAVE_PAYLOAD) == 47
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

# +22: 'push 0xc8' (5 B: 68 imm32)
_pushed_h = int.from_bytes(CAVE_PAYLOAD[23:27], 'little')
assert _pushed_h == PRESENT_ARG_H, hex(_pushed_h)

# +27: 'push 0x140' (5 B: 68 imm32)
_pushed_w = int.from_bytes(CAVE_PAYLOAD[28:32], 'little')
assert _pushed_w == PRESENT_ARG_W, hex(_pushed_w)

# +34: 'call 0x408120' (5 B: e8 rel32)
_c3_next = CAVE_BASE_VADDR + 34 + 5
_c3_rel32 = int.from_bytes(CAVE_PAYLOAD[35:39], 'little', signed=True)
assert _c3_next + _c3_rel32 == PRESENT_IAT, hex(_c3_next + _c3_rel32)

# +42: 'jmp 0x40ba6f' (5 B: e9 rel32)
_jmp_back_next = CAVE_BASE_VADDR + 42 + 5
_jmp_back_rel32 = int.from_bytes(CAVE_PAYLOAD[43:47], 'little', signed=True)
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
          f'{len(CAVE_PAYLOAD)} B: re-executed sound call + draw-credit + '
          f'present thunk')
    print(f'  string file+{STRING_FILE_OFFSET:#x} (vaddr {STRING_VADDR:#x}), '
          f'{len(NEW_CREDIT_BYTES)} B, NUL-terminated: '
          f'{NEW_CREDIT_TEXT!r}')
    print('  self-check OK: all three windows match intended bytes, zero '
          'differences elsewhere in the file')
    return 0


if __name__ == '__main__':
    sys.exit(main())

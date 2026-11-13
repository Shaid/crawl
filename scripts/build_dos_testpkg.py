#!/usr/bin/env python3
"""Build a clean live-test package for the restored Black Crypt Windows demo.

TODO `blackcrypt-testpkg-origgam`; plan doc
`docs/blackcrypt/dos/full-game-restoration-plan.md` § "Review — 2026-11-13
`re-codebreaker` gap audit", finding 1, and § "Live-test package".

The package is a directory the project owner can run `crypt.exe` from:

| File | Source |
|---|---|
| `crypt.exe` | stock demo exe + every `scripts/patch_crypt_exe*.py` patch (each one's own `patch()` + `_self_check()`) |
| `maindung.gam` | `bclib.maindung.convert(data/blackcrypt/amiga/bcdfs)` — all 13 maps, 171,005 B |
| `clipper.clp` | stock demo `clipper.clp`, or `--clipper PATH` (e.g. the Phase 3 injector's output) |
| `Config.dat` | stock demo `Config.dat` |
| `orig<N>.gam` | only with `--orig-slot N`: `maindung[52:]`, 170,953 B |

**Why `orig<N>.gam` drops 52 bytes.** On New Game, `fcn.00401fa0` reads
`MainDung.gam`, copies its 13-dword offset table, then skips it
(`0x402015 add eax,0x34`, `0x402024 sub ebp,0x34`) and writes only the body
to `orig%d.gam` (`0x402018`) and `TempDung.gam` (`0x402081`). The offsets
are body-relative, so a full-length copy makes every `LoadDungeon` seek land
52 B early. The game-written demo files agree: `orig1.gam`/`tempdung.gam`
are 15,047 B = `maindung.gam` (15,099 B) − 52, and match `maindung[52:]` on
14,821/15,047 B (the rest is runtime square state from a live session) vs
7,874/15,047 unshifted. This script re-checks that before using it.

No stale `tempdung.gam` / `orig*.gam` / `char*.dat` is ever copied: the
output directory is created fresh (`--force` empties a previous package).
For a New Game test leave out `--orig-slot`; the game writes its own.

Repo hygiene: reads `data/` only, refuses any output path under `data/`,
and defaults to `build/blackcrypt/dos-testpkg/` (gitignored). Never commit
the package — it is derived copyrighted game data.
"""
import argparse
import shutil
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bclib import maindung  # noqa: E402
import patch_crypt_exe  # noqa: E402
import patch_crypt_exe_guard_copy_failure  # noqa: E402
import patch_crypt_exe_add_restoration_note  # noqa: E402
import patch_crypt_exe_add_title_credit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DOS = ROOT / 'data' / 'blackcrypt' / 'dosvga'
AMIGA_BCDFS = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'
DEFAULT_OUT = ROOT / 'build' / 'blackcrypt' / 'dos-testpkg'

OFFSET_TABLE_BYTES = 13 * 4  # 52
FULL_MAINDUNG_BYTES = 171005

# (name, module, required). Phase 4 + its copy-failure guard are the
# functional patches; Phase 5/7 are cosmetic credits (--no-credits drops them).
PATCHERS = [
    ('phase4-mapswitch+ramp', patch_crypt_exe, True),
    ('phase4b-copy-guard', patch_crypt_exe_guard_copy_failure, True),
    ('phase5-restoration-note', patch_crypt_exe_add_restoration_note, False),
    ('phase7-title-credit', patch_crypt_exe_add_title_credit, False),
]


def check_demo_origgam_relation() -> str:
    """The game's own output is the oracle for the 52-B rule. The demo
    folder's `orig1.gam`/`tempdung.gam` were written by a live run (they
    carry ~226 B of runtime square state, so they are not byte-identical to
    `maindung[52:]`); the check is therefore length + alignment: the file
    must be exactly 52 B shorter, and agree with `maindung[52:]` far better
    than with the unshifted `maindung[0:]` (the null control)."""
    main = (DOS / 'maindung.gam').read_bytes()
    lines = []
    for name in ('orig1.gam', 'tempdung.gam'):
        p = DOS / name
        if not p.exists():
            continue
        body = p.read_bytes()
        n = len(body)
        shifted = sum(1 for x, y in zip(body, main[OFFSET_TABLE_BYTES:]) if x == y)
        unshifted = sum(1 for x, y in zip(body, main) if x == y)
        if n != len(main) - OFFSET_TABLE_BYTES or shifted < 0.95 * n or unshifted > 0.75 * n:
            raise SystemExit(f'error: game-written {name} ({n} B) does not fit '
                             f'the 52-B rule: {shifted}/{n} B agree with '
                             f'maindung[52:], {unshifted}/{n} with maindung[0:]')
        lines.append(f'{name}: {n} B = maindung.gam - 52; agrees with '
                     f'maindung[52:] on {shifted}/{n} B vs {unshifted}/{n} unshifted')
    if not lines:
        return 'no game-written orig1.gam/tempdung.gam beside the demo; 52-B rule not re-checked'
    return '\n'.join(lines)


def build_exe(include_credits: bool) -> tuple[bytes, list[str]]:
    data = (DOS / 'crypt.exe').read_bytes()
    log = []
    for name, mod, required in PATCHERS:
        if not required and not include_credits:
            continue
        before = data
        data = mod.patch(before)
        notes = mod._self_check(before, data)
        log.append(f'{name}: self-check OK')
        for n in notes or []:
            log.append(f'  {n}')
    return data, log


def build_maindung() -> bytes:
    full = maindung.convert(AMIGA_BCDFS.read_bytes())
    if len(full) != FULL_MAINDUNG_BYTES:
        raise SystemExit(f'error: converted maindung is {len(full)} B, '
                         f'expected {FULL_MAINDUNG_BYTES}')
    demo = (DOS / 'maindung.gam').read_bytes()
    if maindung.to_demo(full) != demo:
        raise SystemExit('error: converter no longer reproduces the shipped '
                         'maindung.gam byte-exact (run verify_maindung.py)')
    body_len = len(full) - OFFSET_TABLE_BYTES
    offs = struct.unpack_from('<13I', full, 0)
    if offs[0] != 0 or list(offs) != sorted(offs) or offs[-1] >= body_len:
        raise SystemExit(f'error: offset table {offs} is not body-relative '
                         f'and increasing within {body_len} B')
    return full


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT,
                    help=f'package directory (default {DEFAULT_OUT.relative_to(ROOT)})')
    ap.add_argument('--clipper', type=Path, default=None,
                    help='clipper.clp to ship (default: the stock demo file)')
    ap.add_argument('--orig-slot', type=int, action='append', default=[],
                    metavar='N', help='also write orig<N>.gam = maindung[52:] '
                    '(save-slot path); repeatable')
    ap.add_argument('--no-credits', action='store_true',
                    help='skip the cosmetic Phase 5/7 credit patches')
    ap.add_argument('--force', action='store_true',
                    help='empty an existing package directory first')
    args = ap.parse_args()

    out = args.out.resolve()
    data_root = (ROOT / 'data').resolve()
    if out == data_root or data_root in out.parents:
        print(f'error: refusing to write under {data_root}', file=sys.stderr)
        return 1
    if out.exists() and any(out.iterdir()):
        if not args.force:
            print(f'error: {out} is not empty (pass --force to rebuild)',
                  file=sys.stderr)
            return 1
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    print(check_demo_origgam_relation())
    exe, log = build_exe(not args.no_credits)
    full = build_maindung()
    clipper_src = (args.clipper or DOS / 'clipper.clp').resolve()

    (out / 'crypt.exe').write_bytes(exe)
    (out / 'maindung.gam').write_bytes(full)
    shutil.copyfile(clipper_src, out / 'clipper.clp')
    shutil.copyfile(DOS / 'Config.dat', out / 'Config.dat')
    for n in sorted(set(args.orig_slot)):
        if not 1 <= n <= 9:
            print(f'error: slot {n} out of range 1..9', file=sys.stderr)
            return 1
        (out / f'orig{n}.gam').write_bytes(full[OFFSET_TABLE_BYTES:])

    # Re-read everything that was written.
    assert (out / 'crypt.exe').read_bytes() == exe
    assert (out / 'maindung.gam').read_bytes() == full
    for n in set(args.orig_slot):
        b = (out / f'orig{n}.gam').read_bytes()
        assert len(b) == FULL_MAINDUNG_BYTES - OFFSET_TABLE_BYTES == 170953
        assert b == full[OFFSET_TABLE_BYTES:]
    stale = [p.name for p in out.iterdir()
             if p.name.lower() in ('tempdung.gam',) or p.name.lower().startswith('char')]
    assert not stale, stale

    for line in log:
        print(line)
    print(f'package: {out}')
    for p in sorted(out.iterdir()):
        print(f'  {p.name:14s} {p.stat().st_size:>9,} B')
    print(f'  clipper.clp from {clipper_src}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

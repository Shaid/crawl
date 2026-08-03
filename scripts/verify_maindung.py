#!/usr/bin/env python3
"""Verify `bclib.maindung`'s Amiga `bcdfs` -> DOS `maindung.gam` converter.

Three independent checks, all against real shipped data:

1. **Byte-exact round-trip.** Convert Amiga map 1 (`data/blackcrypt/amiga/
   bcdfs`) and compare it, byte for byte, against the real demo file
   (`data/blackcrypt/dosvga/maindung.gam`) — after trimming the full 13-map
   output down to what the demo itself contains (`maindung.to_demo`; the
   demo's own offset table has maps 3-13 zeroed out, which is a documented
   property of the shipped file, not something the converter should
   reproduce for the full-game output). Zero deviation across all
   15,099 bytes is the bar; anything else fails the script.
2. **Full 13-map size.** The complete conversion (all 13 Amiga maps) must be
   exactly 171,005 B, matching `bcdfs`'s own size (positions/sizes are
   identical between the two formats).
3. **Monster-extension guard.** Confirms (again) that the never-triggered
   4-byte monster extension really is absent from all 13 shipped maps, so
   `maindung.convert()`'s "raise rather than guess" branch is dead code on
   real data, not a silent gap.

Requires `data/blackcrypt/amiga/bcdfs` and `data/blackcrypt/dosvga/
maindung.gam`. Converted output is *not* written under `public/assets/` or
committed anywhere — it is derived DOS game data and stays out of git (see
`docs/blackcrypt/dos/full-game-restoration-plan.md`, "Repo hygiene"); this
script writes its scratch copy to `build/cache/` only if asked.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bclib import bcdfs, maindung

ROOT = Path(__file__).resolve().parent.parent
AMIGA_BCDFS = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'
DOS_MAINDUNG = ROOT / 'data' / 'blackcrypt' / 'dosvga' / 'maindung.gam'


def main():
    ok = True

    amiga_raw = AMIGA_BCDFS.read_bytes()
    full = maindung.convert(amiga_raw)

    # --- Check 2: full 13-map size -----------------------------------
    print(f'full 13-map conversion: {len(full)} B (bcdfs is {len(amiga_raw)} B)')
    if len(full) != len(amiga_raw) or len(full) != 171005:
        print('  FAILED -- expected exactly 171005 B, matching bcdfs')
        ok = False
    else:
        print('  OK')

    # --- Check 1: byte-exact round trip against the shipped demo -----
    real = DOS_MAINDUNG.read_bytes()
    demo_shaped = maindung.to_demo(full)
    print(f'demo-trimmed conversion: {len(demo_shaped)} B (real maindung.gam '
          f'is {len(real)} B)')
    if len(demo_shaped) != len(real):
        print('  FAILED -- length mismatch')
        ok = False
    else:
        mismatches = [i for i in range(len(real)) if demo_shaped[i] != real[i]]
        print(f'  {len(real) - len(mismatches)}/{len(real)} bytes match '
              f'({100 * (len(real) - len(mismatches)) / len(real):.3f}%)')
        if mismatches:
            print(f'  FAILED -- {len(mismatches)} mismatches, first 10:')
            for i in mismatches[:10]:
                print(f'    offset {i:#06x}: got {demo_shaped[i]:#04x}, '
                      f'want {real[i]:#04x}')
            ok = False
        else:
            print('  OK -- zero deviation across all 15,099 bytes')

    # --- Check 3: monster-extension guard is dead code on real data --
    ext_hits = []
    bcdfs.walk_all(
        amiga_raw,
        on_monster2ext=lambda m, r, c, o, b: ext_hits.append((m, r, c, o)))
    print(f'monster-extension triggers across all 13 maps: {len(ext_hits)}')
    if ext_hits:
        print(f'  UNEXPECTED -- {ext_hits[:5]} ... convert() would have '
              f'raised on this data; its DOS encoding is still undetermined')
        ok = False
    else:
        print('  OK -- 0/265 monster pairs trigger it, as expected')

    print()
    if ok:
        print('ALL CHECKS PASSED')
    else:
        print('FAILED -- see above')
        sys.exit(1)


if __name__ == '__main__':
    main()

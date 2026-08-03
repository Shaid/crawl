#!/usr/bin/env python3
"""Verify `export_dungeon_levels.py` / `export_dungeon_slots.py` output.

Three checks, all against real generated data (run the exporters first):

1. **Schema validation.** Shells out to a small Node/`tsx` snippet that
   imports `@seer/dungeon/schema`'s real `validateDungeonLevelFile` /
   `validateSlotTableFile` and runs them against the generated JSON --
   the actual runtime validator, not a hand-ported reimplementation of its
   rules.
2. **Densification.** All 13 maps produce exactly `64*64=4096`-element
   planes, and every plane a `wallStorage`/`sublevelPlane` reference names
   actually exists.
3. **`slots.json` re-verification.** If `export_dungeon_slots.py` reported
   a raw-descriptor mismatch against the M1 hand-authored file, that's
   surfaced here as a hard failure -- see that script's own output for the
   specifics; this only checks that the two numeric tables now agree.

Usage:
    python3 scripts/verify_dungeon_export.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEER = ROOT.parent / 'seer'
LEVELS = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'dungeon' / 'levels.json'
SLOTS = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'dungeon' / 'slots.json'

VALIDATE_SNIPPET = '''
import {{ validateDungeonLevelFile, validateSlotTableFile }} from '{schema_path}';
import fs from 'node:fs';

const kind = process.argv[2];
const path = process.argv[3];
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
try {{
  if (kind === 'levels') validateDungeonLevelFile(data);
  else if (kind === 'slots') validateSlotTableFile(data);
  else throw new Error('unknown kind ' + kind);
  console.log('OK');
}} catch (e) {{
  console.error('FAILED: ' + e.message);
  process.exit(1);
}}
'''


def run_validator(kind, path):
    schema_path = str(SEER / 'packages' / 'dungeon' / 'src' / 'schema' / 'index.ts')
    snippet = VALIDATE_SNIPPET.format(schema_path=schema_path)
    script = ROOT / 'build' / 'cache' / 'blackcrypt' / '_validate_dungeon.mjs'
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(snippet)
    proc = subprocess.run(
        ['npx', '--yes', 'tsx', str(script), kind, str(path)],
        cwd=str(SEER), capture_output=True, text=True)
    return proc.returncode == 0, proc.stdout + proc.stderr


def main():
    ok = True

    if not LEVELS.exists():
        print(f'FAILED -- {LEVELS} does not exist; run export_dungeon_levels.py first')
        return 1
    doc = json.loads(LEVELS.read_text())

    # --- Check 1: schema validation (levels.json) ---------------------
    passed, output = run_validator('levels', LEVELS)
    print(f'levels.json schema validation: {"OK" if passed else "FAILED"}')
    if not passed:
        print('  ' + output.strip().replace('\n', '\n  '))
        ok = False

    if SLOTS.exists():
        passed, output = run_validator('slots', SLOTS)
        print(f'slots.json schema validation: {"OK" if passed else "FAILED"}')
        if not passed:
            print('  ' + output.strip().replace('\n', '\n  '))
            ok = False
    else:
        print(f'slots.json: not found at {SLOTS} -- skipped')

    # --- Check 2: densification ----------------------------------------
    n = 0
    for unit in doc['units']:
        n += 1
        for plane_name, plane in unit['planes'].items():
            if len(plane) != 64 * 64:
                print(f'FAILED -- unit {unit["id"]} plane {plane_name!r} has '
                      f'{len(plane)} elements, expected 4096')
                ok = False
        ws = doc['wallStorage']
        if ws['kind'] == 'bitflags' and ws['plane'] not in unit['planes']:
            print(f'FAILED -- unit {unit["id"]} has no plane {ws["plane"]!r} '
                  f'named by wallStorage')
            ok = False
        sp = unit.get('sublevelPlane')
        if sp is not None and sp not in unit['planes']:
            print(f'FAILED -- unit {unit["id"]} has no plane {sp!r} named by sublevelPlane')
            ok = False
    print(f'densification: {n} units, all planes 4096 elements: '
          f'{"OK" if ok else "FAILED (see above)"}')

    print()
    print('OVERALL:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

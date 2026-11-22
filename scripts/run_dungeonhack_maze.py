#!/usr/bin/env python3
"""Generate Dungeon Hack dungeons by running the game's own MAZE.EXE.

Usage: python3 scripts/run_dungeonhack_maze.py [name seed [depth]] ...
Default: the shipped dungeon ("shipped": SAVEGAME/SETTINGS.DAT as installed) plus
seeds 1..3 with the shipped settings. Output -> build/cache/dungeonhack/maze/<name>/
{LEVELS,ITEMS,FEAnn}.DAT + SEED.TXT. Needs `pip install unicorn`.

SETTINGS.DAT layout (27 B; MAZE.EXE `Settings=` hex string = bytes 4..15):
  +0 u32 seed, +4..+15 DEPTH FREQ_MONSTERS FREQ_TREASURE FREQ_ILLUSIONARY_WALLS
  FREQ_FOOD FREQ_KEYS FREQ_TRAPS FREQ_PITS HINT_SHEET_FREQ ZONES_ON WATER_ON
  MULTI_LEVEL_PUZZLES_ON (one nibble each; names are MAZE.EXE's own strings),
  +16..+26 customise-screen slider state (not read by MAZE.EXE; unverified).
Level count = DEPTH + 10 (depth 3 -> 13 levels, depth 15 -> 25 levels).
"""
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dungeonhacklib import mazeemu  # noqa: E402

ROOT = HERE.parent
DATA = ROOT / 'data' / 'dungeonhack' / 'dosvga'
OUT = ROOT / 'build' / 'cache' / 'dungeonhack' / 'maze'
NAMES = ('LEVELS.DAT', 'ITEMS.DAT', 'SEED.TXT')


def generate(name: str, seed: int | None = None, depth: int | None = None) -> Path:
    wd = OUT / name
    shutil.rmtree(wd, ignore_errors=True)
    wd.mkdir(parents=True)
    sv = DATA / 'SAVEGAME'
    for f in sv.iterdir():
        if f.suffix == '.DAT':
            shutil.copy(f, wd / f.name)
    s = bytearray((wd / 'SETTINGS.DAT').read_bytes())
    if seed is not None:
        s[0:4] = seed.to_bytes(4, 'little')
    if depth is not None:
        s[4] = depth
    (wd / 'SETTINGS.DAT').write_bytes(bytes(s))
    dos = mazeemu.run_maze(str(DATA / 'MAZE.EXE'), str(wd))
    assert dos.exit_code == 0, dos.exit_code
    return wd


def main() -> None:
    args = sys.argv[1:]
    jobs = []
    if args:
        jobs.append((args[0], int(args[1], 0), int(args[2]) if len(args) > 2 else None))
    else:
        jobs = [('shipped', None, None), ('seed1', 1, None), ('seed2', 2, None), ('seed3', 3, None)]
    for name, seed, depth in jobs:
        wd = generate(name, seed, depth)
        fea = sorted(p.name for p in wd.glob('FEA*.DAT'))
        print(f'{name}: LEVELS.DAT {(wd / "LEVELS.DAT").stat().st_size} B, {len(fea)} FEA files, '
              f'ITEMS.DAT {(wd / "ITEMS.DAT").stat().st_size} B')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Export everything the Dungeon Hack walker needs (tools/dungeonhack/engine.ts,
tools/walker/games-dungeonhack.ts) to public/assets/dungeonhack/dosvga/data/walker/.

The first-person view is mostly the game's own AESOP/16 bytecode in HACK.RES
(`dungeon`, `kernel`, `features`, `doors`, ... SOP classes, run by tools/aesop/vm.ts),
exactly as for EOB3 (scripts/extract_eotb3_walker.py). Unlike EOB3 three view
primitives are NATIVE code in AESOP.EXE (`init_viewspace`, `build_clipping`,
`draw_walls`, plus `step_X/Y`), so their lookup tables are read here from
AESOP.EXE's data segment (docs/dungeonhack/dosvga/data-structure.md section 9).

Output:
  aesop-classes.json   334 SOP code objects (bytecode b64 + handler/export/import/extern tables)
  palettes.json        every palette resource (id -> name, 6-bit RGB)
  bitmaps.bin + bitmaps-index.json   every "old format" bitmap resource, raw
  natives.json         AESOP.EXE tables for the native view/step functions
  dungeons.json        MAZE.EXE outputs (build/cache/dungeonhack/maze, see
                       scripts/run_dungeonhack_maze.py): seed, settings, per-level
                       lvlmap + FEAnn.DAT, ITEMS.DAT
"""
import base64
import json
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from eotb3lib import res, palette  # noqa: E402
from dungeonhacklib import classify  # noqa: E402
import extract_eotb3_walker as eob3  # noqa: E402  (parse_class is engine-level)

ROOT = HERE.parent
DATA = ROOT / 'data' / 'dungeonhack' / 'dosvga'
OUT = ROOT / 'public' / 'assets' / 'dungeonhack' / 'dosvga' / 'data' / 'walker'
MAZE_CACHE = ROOT / 'build' / 'cache' / 'dungeonhack' / 'maze'

# AESOP.EXE (Borland C++ 1991, real mode): MZ header = 0x1600 bytes; DGROUP = paragraph
# 0x1abf (the `mov dx,0x1abf` at the startup stub) -> data segment base in the image.
EXE_HDR = 0x1600
DS_BASE = 0x1ABF0
# Segment 0f36 = the Dungeon Hack native module. Offsets are DS-relative.
TABLES = {
    # step_X/step_Y (0f36:0006 / 0f36:00d0)
    'step': (0x10E3, 0x1117 - 0x10E3),
    # init_viewspace (0f36:040f): six 8-byte tables indexed by fdir
    'viewspace': (0x10EB, 6 * 8),
    # build_clipping (0f36:05f4): 18x18 signed bytes (0x7e = unreachable, 0x7f = no clip)
    'clip': (0x1117, 18 * 18),
    # draw_walls (0f36:0785): per fdir 26 signed bytes
    'wall_dx': (0x125B, 4 * 26),
    'wall_dy': (0x12C3, 4 * 26),
    'wall_visidx': (0x132B, 25),
    'wall_y': (0x1344, 26 * 2),
    'wall_x': (0x1378, 26 * 2),
    'wall_flip': (0x13AC, 26),
    'wall_shape': (0x13C6, 2 * 26),
    # set_palette (0c7e:04f9): first DAC colour per region
    'first_color': (0x0E0A, 5 * 2),
}


def read_tables():
    d = (DATA / 'AESOP.EXE').read_bytes()[EXE_HDR:]
    return {k: list(d[DS_BASE + a:DS_BASE + a + n]) for k, (a, n) in TABLES.items()}


def read_dungeon(d: Path):
    lv = (d / 'LEVELS.DAT').read_bytes()
    seed = struct.unpack_from('<I', lv, 0)[0]
    n = (len(lv) - 4) // 1024
    levels = []
    for i in range(n):
        fea = d / f'FEA{i:02d}.DAT'
        levels.append({
            'lvlmap': base64.b64encode(lv[4 + i * 1024:4 + (i + 1) * 1024]).decode(),
            'fea': base64.b64encode(fea.read_bytes()).decode() if fea.exists() else '',
        })
    settings = (d / 'SETTINGS.DAT').read_bytes()
    return {
        'name': d.name, 'seed': seed, 'settings': list(settings[4:16]),
        'items': base64.b64encode((d / 'ITEMS.DAT').read_bytes()).decode(),
        'levels': levels,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    r = res.load(str(DATA / 'HACK.RES'))

    classes = []
    for name in sorted(r.table0):
        if name.endswith(('.EXPT', '.IMPT')):
            continue
        c = eob3.parse_class(r, name)
        if c:
            classes.append(c)
    (OUT / 'aesop-classes.json').write_text(json.dumps({'classes': classes}, separators=(',', ':')))

    pals, blob, index = {}, bytearray(), {}
    for slot, e in sorted(r.entries.items()):
        b = r.resource_bytes(slot)
        if not b:
            continue
        if classify.looks_like_old_format_bitmap(b):
            # screens / portraits / spell art are not part of the dungeon view
            if len(b) > 400_000:
                continue
            index[slot] = {'name': e.name, 'offset': len(blob), 'size': len(b), 'shapes': struct.unpack_from('<H', b, 4)[0]}
            blob += b
        elif e.name.endswith(('palette', 'Palette')) or e.name.startswith(('Sel-', 'wall/floor')):
            try:
                cols = palette.load_resource_palette(b)
            except ValueError:
                continue
            pals[slot] = {'name': e.name, 'colors': [[c['r'], c['g'], c['b']] for c in cols]}
    (OUT / 'palettes.json').write_text(json.dumps(pals, separators=(',', ':')))
    (OUT / 'bitmaps.bin').write_bytes(bytes(blob))
    (OUT / 'bitmaps-index.json').write_text(json.dumps(index, separators=(',', ':')))
    (OUT / 'natives.json').write_text(json.dumps(read_tables(), separators=(',', ':')))

    dungeons = []
    for name in ('shipped', 'seed1', 'seed2', 'seed3'):
        d = MAZE_CACHE / name
        if not (d / 'LEVELS.DAT').exists():
            print(f'  {name}: no maze output, running scripts/run_dungeonhack_maze.py (needs `pip install unicorn`)')
            subprocess.run([sys.executable, str(HERE / 'run_dungeonhack_maze.py')], check=True)
        dungeons.append(read_dungeon(d))
    (OUT / 'dungeons.json').write_text(json.dumps({'dungeons': dungeons}, separators=(',', ':')))
    print(f'dungeonhack walker pack: {len(classes)} classes, {len(pals)} palettes, {len(index)} bitmaps '
          f'({len(blob)} B), {len(dungeons)} dungeons x {len(dungeons[0]["levels"])} levels -> {OUT}')


if __name__ == '__main__':
    main()

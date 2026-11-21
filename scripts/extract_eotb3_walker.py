#!/usr/bin/env python3
"""Export everything the EOB3 walker needs to run the game's own AESOP/16
dungeon-view bytecode in the browser (`tools/aesop/` VM + `tools/walker/games-eotb3.ts`).

The first-person view is NOT in native code: the `dungeon` / `features` /
`doors` / ... SOP class objects in EYE.RES draw it by calling the native
`draw_bitmap` primitive (docs/eotb3/dosvga/data-structure.md section 10).
So instead of re-deriving a per-wall-type dispatch table by hand, we ship the
class objects verbatim and interpret them (`tools/aesop/vm.ts`; the shipped
level objects come from SAVEGAME/LVLnn.TMP, parsed below from the file format
and the game's own save writer in INTERP.EXE).

Output (public/assets/eotb3/dosvga/data/walker/):
  aesop-classes.json   every SOP code object: bytecode (base64) + handler /
                       export / import / extern tables (EYE.RES .EXPT/.IMPT)
  levels.json          14 levels: lvlmap (32x32), area-class name, and the
                       shipped SAVEGAME/LVLnn.TMP object records
  palettes.json        the 55 palette resources (id -> 8-bit RGB)
  vfx.bin + vfx-index.json   raw "1.10" VFX bitmap resources (id >= 186,
                       decoded in the browser; sidecar maps id -> offset/size)

Source of truth for each format: docs/eotb3/dosvga/data-structure.md sec 10.
"""
import base64
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from eotb3lib import res, bitmap, palette  # noqa: E402

ROOT = HERE.parent
DATA = ROOT / 'data' / 'eotb3' / 'dosvga'
OUT = ROOT / 'public' / 'assets' / 'eotb3' / 'dosvga' / 'data' / 'walker'

# Level n (1..14) <-> map resource id 4+n and the area-class SOP that owns it
# (its "enter level" handler loads the map, sets `wallset` and the palettes).
# Order is the level order in the shipped saves ("level 3 = Graveyard").
AREA_CLASSES = [
    'mauslvl1', 'mauslvl2', 'graveyrd', 'frstrail', 'ghqrtr',
    'magelvl1', 'magelvl2', 'magelvl3', 'magelvl4',
    'tmplqrtr', 'templvl1', 'templvl2', 'templvl3', 'templvl4',
]
FIRST_MAP_RESOURCE = 5
FIRST_VFX_ID = 186  # everything below is portraits / floor shapes / outtakes


def parse_class(r, name):
    code_e = r.find(name)
    expt = r.find(name + '.EXPT')
    impt = r.find(name + '.IMPT')
    if code_e is None or expt is None or impt is None:
        return None
    code = r.resource_bytes(code_e.slot)
    if len(code) < 16:
        return None
    static_size, imp_res, exp_res, parent = struct.unpack_from('<HIII', code, 0)
    exports = res.parse_dictionary(r.resource_bytes(expt.slot))
    imports = res.parse_dictionary(r.resource_bytes(impt.slot))
    handlers, exported_vars = {}, {}
    for k, v in exports.items():
        if k.startswith('M:'):
            handlers[int(k[2:])] = int(v)
        elif k == 'N:PARENT':
            parent = int(v)  # real superclass (the code header's field is not it)
        elif len(k) > 2 and k[1] == ':' and k[0] in 'BWL':
            exported_vars[k] = int(v.split(',')[0])
    runtime_fns, externs = {}, {}
    for k, v in imports.items():
        if k.startswith('C:'):
            runtime_fns[int(v)] = k[2:]
        elif len(k) > 2 and k[1] == ':' and k[0] in 'BWL':
            xr, src = v.split(',')
            externs[int(xr)] = [k, int(src)]
    return {
        'number': code_e.slot,
        'name': name,
        'staticSize': static_size,
        'parent': -1 if parent == 0xFFFFFFFF else parent,
        'handlers': handlers,
        'exportedVars': exported_vars,
        'runtimeFns': runtime_fns,
        'externs': externs,
        'code': base64.b64encode(code).decode('ascii'),
    }


def parse_lvl_tmp(path):
    """SAVEGAME/LVLnn.TMP -> [{slot, cls, statics}] for every live object.

    Layout (clean-room, from the files and the game's own writer; see
    docs/eotb3/dosvga/data-structure.md section 10 "LVLnn.TMP stream"):

      +0   u8   0x1A  stream tag (INTERP.EXE+0x13a15 `mov ah,0x1a`, written
                      once before the first record)
      then one record per object slot, slot ids ascending 1000..1999 (the
      range literals pushed at INTERP.EXE 0x19000-0x19005):
        u16 slot   object slot number
        u32 cls    class/resource number, 0xFFFFFFFF = slot free
        u16 size   static-data bytes that follow (0 for a free slot)
        u8[size]   raw static data (the object's statics, verbatim)

    Writer: INTERP.EXE (LE object 1 vaddr) 0x139e0; it builds the 8-byte
    header at 0x13a9b-0x13ae9 (size = object length - 4) and, for a free slot,
    writes the header with size 0 only (0x13b4f).
    """
    d = Path(path).read_bytes()
    if d[0] != 0x1A:
        raise ValueError(f'{path}: stream tag {d[0]:#x}, expected 0x1A')
    pos, recs = 1, []
    while pos < len(d):
        slot, cls, size = struct.unpack_from('<HIH', d, pos)
        pos += 8
        if size:
            if cls == 0xFFFFFFFF:
                raise ValueError(f'{path}: free slot {slot} carries {size} bytes')
            if pos + size > len(d):
                raise ValueError(f'{path}: slot {slot} statics run past EOF')
            recs.append({'slot': slot, 'cls': cls,
                         'statics': base64.b64encode(d[pos:pos + size]).decode('ascii')})
            pos += size
        elif cls != 0xFFFFFFFF:
            raise ValueError(f'{path}: live slot {slot} has no statics')
    return recs


def main():
    r = res.load(str(DATA / 'EYE.RES'))
    OUT.mkdir(parents=True, exist_ok=True)

    # --- classes -----------------------------------------------------------
    classes = []
    for name in sorted(r.table0):
        if name.endswith(('.EXPT', '.IMPT')):
            continue
        c = parse_class(r, name)
        if c:
            classes.append(c)
    (OUT / 'aesop-classes.json').write_text(json.dumps({'classes': classes}, separators=(',', ':')))

    # --- levels ------------------------------------------------------------
    levels = []
    for i, area in enumerate(AREA_CLASSES):
        lv = i + 1
        e = r.entries[FIRST_MAP_RESOURCE + i]
        grid = list(r.resource_bytes(e.slot))
        assert len(grid) == 1024, (lv, len(grid))
        levels.append({
            'level': lv, 'name': e.name, 'mapResource': e.slot, 'area': area,
            'lvlmap': grid,
            'records': parse_lvl_tmp(DATA / 'SAVEGAME' / f'LVL{lv:02d}.TMP'),
        })
    (OUT / 'levels.json').write_text(json.dumps({'levels': levels}, separators=(',', ':')))

    # --- palettes ----------------------------------------------------------
    pals = {}
    for slot, e in r.entries.items():
        if not e.name.endswith((' palette', ' pal')):
            continue
        try:
            cols = palette.load_resource_palette(r.resource_bytes(slot))
        except ValueError:
            continue
        pals[slot] = {'name': e.name, 'colors': [[c['r'], c['g'], c['b']] for c in cols]}
    (OUT / 'palettes.json').write_text(json.dumps(pals, separators=(',', ':')))

    # --- raw VFX bitmaps -----------------------------------------------------
    blob, index = bytearray(), {}
    for slot, e in sorted(r.entries.items()):
        if slot < FIRST_VFX_ID:
            continue
        b = r.resource_bytes(slot)
        if b[:4] != b'1.10':
            continue
        index[slot] = {'name': e.name, 'offset': len(blob), 'size': len(b),
                       'shapes': bitmap.vfx_shape_count(b)}
        blob += b
    (OUT / 'vfx.bin').write_bytes(bytes(blob))
    (OUT / 'vfx-index.json').write_text(json.dumps(index, separators=(',', ':')))
    print(f'eotb3 walker pack: {len(classes)} classes, {len(levels)} levels, '
          f'{sum(len(l["records"]) for l in levels)} objects, {len(pals)} palettes, '
          f'{len(index)} bitmaps ({len(blob)} B) -> {OUT}')


if __name__ == '__main__':
    main()

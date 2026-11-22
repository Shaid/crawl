#!/usr/bin/env python3
"""From-bytes check that the EOB3 walker's constants come from the game's own
executable, not from a third-party reimplementation (provenance note 2026-11-22,
docs/eotb3/dosvga/data-structure.md section 10.3).

Reads INTERP.EXE (DOS/4GW LE) and verifies:
  1. step_X / step_Y (INTERP.EXE obj1 vaddr 0x17890 / 0x17930): the signed-byte
     table at vaddr 0x31196 (file+0x25596) that both read; DX/DY in
     tools/walker/games-eotb3.ts must equal the natives' result for
     dist=1, mtype 2/4/5/6, fdir 0..3 (x: tb=0x31196, y: tb=0x311ae,
     index (mtype<<2)+fdir, result & 31 -- 0x1791f / 0x1799f).
  2. FIRST_COLOR in tools/eotb3/engine.ts == the u16 per-region first-colour table at
     vaddr 0x30fb8 (file+0x253b8), indexed `mov di,[eax*2+0xfb8]` at 0x16884.
  3. SAVEGAME/LVLnn.TMP structure used by extract_eotb3_walker.parse_lvl_tmp:
     tag 0x1A then exactly slots 1000..1999 in order (load_range INTERP 0x137d0,
     writer 0x139e0, range literals 0x19000), consuming the file to EOF.
Null controls: a table row-shifted by one and a tag-less parse must both FAIL.
"""
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / 'data' / 'eotb3' / 'dosvga'
e = (D / 'INTERP.EXE').read_bytes()

le = struct.unpack_from('<I', e, 0x3c)[0]
g = lambda o: struct.unpack_from('<I', e, le + o)[0]
pagesz, datapg, objtab = g(0x28), g(0x80), g(0x40)
objs = [struct.unpack_from('<6I', e, le + objtab + 24 * i) for i in range(g(0x44))]


def vaddr_to_file(v):
    for vs, base, _fl, pi, np_, _ in objs:
        if base <= v < base + np_ * pagesz:
            return datapg + (pi - 1) * pagesz + (v - base)
    raise ValueError(hex(v))


s8 = lambda b: b - 256 if b > 127 else b
fails = 0


def check(name, ok):
    global fails
    print(('PASS ' if ok else 'FAIL ') + name)
    fails += 0 if ok else 1


def step(axis, v, fdir, mtype, dist, shift=0):
    """INTERP.EXE 0x17890 (X) / 0x17930 (Y) for mtype not in {0,7,8,9}."""
    tb = 0x31196 if axis == 'x' else 0x311ae
    b = e[vaddr_to_file(tb + (mtype << 2) + fdir + shift)]
    return (v + s8(b) * dist) & 31


check('table vaddr 0x31196 is file+0x25596', vaddr_to_file(0x31196) == 0x25596)
src = (ROOT / 'tools/walker/games-eotb3.ts').read_text()
tbl = {k: eval(re.search(r'const %s = (\[\[.*?\]\]);' % k, src).group(1).replace('[', '(').replace(']', ')'))
       for k in ('DX', 'DY')}
for axis, name in (('x', 'DX'), ('y', 'DY')):
    for sh, label, want in ((0, '', True), (1, 'null control (shifted by one byte) ', False)):
        ok = all(step(axis, 10, f, m, 1, sh) == (10 + tbl[name][m - 1][f]) & 31
                 for m in (2, 4, 5, 6) for f in range(4))
        check(f'{label}{name} == INTERP step_{axis.upper()} for mtype 2/4/5/6', ok == want)

eng = (ROOT / 'tools/eotb3/engine.ts').read_text()
fc = [int(x, 16) for x in re.search(r'const FIRST_COLOR = \[(.*?)\]', eng).group(1).split(',')]
fo = vaddr_to_file(0x30fb8)
check('FIRST_COLOR == game u16[5] at file+0x253b8',
      fc == [struct.unpack_from('<H', e, fo + 2 * i)[0] for i in range(5)] and fo == 0x253b8)

for lv in range(1, 15):
    d = (D / 'SAVEGAME' / f'LVL{lv:02d}.TMP').read_bytes()
    pos, slots = 1, []
    ok = d[0] == 0x1A
    while pos < len(d):
        slot, cls, size = struct.unpack_from('<HIH', d, pos)
        slots.append(slot)
        pos += 8 + size
        ok &= (size == 0) == (cls == 0xFFFFFFFF)
    check(f'LVL{lv:02d}.TMP: tag 0x1A, slots 1000..1999 contiguous, ends at EOF', ok and pos == len(d) and slots == list(range(1000, 2000)))
bad = (D / 'SAVEGAME' / 'LVL01.TMP').read_bytes()  # parsed from offset 0 (tag not skipped): null control
pos = 0
try:
    while pos < len(bad):
        slot, cls, size = struct.unpack_from('<HIH', bad, pos); pos += 8 + size
    nc = pos == len(bad)
except struct.error:
    nc = False
check('null control (tag byte not skipped) fails the structure walk', not nc)
sys.exit(1 if fails else 0)

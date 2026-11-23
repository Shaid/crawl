#!/usr/bin/env python3
"""Generate vectors_move.json: movement-rule cases produced by the game's own 68k routines
(oracle_move, mode gen). Usage: make_vectors_move.py <s1.bin> <s2.bin>. Deterministic."""
import json, random, subprocess, sys, pathlib

here = pathlib.Path(__file__).resolve().parent
s1p, s2p = sys.argv[1], sys.argv[2]
rnd = random.Random(0xB1AC0A)

def run(lines):
    out = subprocess.run([str(here / 'oracle_move'), s1p, s2p, 'gen'], input='\n'.join(lines) + '\n',
                         capture_output=True, text=True, check=True).stdout
    res = [l for l in out.split('\n') if l]
    assert len(res) == len(lines), (len(res), len(lines))
    return res

def seed(): return ''.join('%02x' % rnd.randrange(256) for _ in range(6))

X0, Y0, N = 8, 8, 8   # world region: x,y in [8, 16)

def world(wall_p=0.10, obj_p=0.30, struct_bias=0.5, aligned=False, mtypes=False):
    """Returns (tokens, mon info). Monster id 1 (S id 2); other ids from 3."""
    t = []
    nid = [3]
    cells = {}
    def newid(): i = nid[0]; nid[0] += 1; return i
    def add(x, y, i):
        # head insertion, like AddToSquare
        c = cells.setdefault((x, y), [0, 0])  # [walls, head]
        t.extend(['W', str(i), '0x12', str(c[1])]); c[1] = i
    mx, my = rnd.randrange(X0, X0 + N), rnd.randrange(Y0, Y0 + N)
    while True:
        if aligned:
            dd = rnd.randrange(4); kk = rnd.choice([1, 1, 2, 3, 3, 4, 5]); ddx, ddy = [(0, 1), (1, 0), (0, -1), (-1, 0)][dd]
            px, py = mx + kk * ddx + (rnd.choice([0, 0, 0, 1]) if rnd.random() < 0.15 else 0), my + kk * ddy
            if not (X0 <= px < X0 + N and Y0 <= py < Y0 + N): mx, my = rnd.randrange(X0, X0 + N), rnd.randrange(Y0, Y0 + N); continue
        else:
            px, py = rnd.randrange(X0, X0 + N), rnd.randrange(Y0, Y0 + N)
        if (px, py) != (mx, my): break
    for x in range(X0, X0 + N):
        for y in range(Y0, Y0 + N):
            walls = 0
            for d in range(4):
                if rnd.random() < wall_p: walls |= 1 << d
            cells[(x, y)] = [walls, 0]
    for x in range(X0, X0 + N):
        for y in range(Y0, Y0 + N):
            if (x, y) == (mx, my): continue
            k = 0
            while rnd.random() < obj_p and k < 3:
                k += 1
                i = newid()
                if rnd.random() < struct_bias:
                    t += ['W', str(i), '0', '1', 'B', str(i), '5', str(rnd.choice([0x10, 0x11, 0x12, 0x14, 0x17, 0x1f, 0x2f, 0x05, 0x20]))]
                    t += ['W', str(i), '10', str(rnd.choice([0, 0, 0, 1])), 'W', str(i), '14', str(rnd.choice([0, 0, 1, 2])),
                          'W', str(i), '16', str(rnd.randrange(0, 6)), 'B', str(i), '15', str(rnd.randrange(2))]
                elif rnd.random() < 0.8:
                    s = newid()
                    t += ['W', str(i), '0', str(rnd.choice([0x80B3, 0x80B3, 0x80B4, 0x80B9] + ([0x804F] if mtypes else []))), 'W', str(i), '16', str(s), 'B', str(s), '11', str(rnd.randrange(5))]
                    if mtypes: t += ['W', str(i), '14', str(rnd.randrange(12)), 'B', str(s), '19', str(rnd.choice([0, 0, 0, 1])), 'B', str(i), '3', str(rnd.randrange(256)), 'B', str(i), '6', str(rnd.randrange(8))]
                else:
                    t += ['W', str(i), '0', str(rnd.randrange(1, 0x7fff))]  # item
                add(x, y, i)
    # the monster itself
    gfx = rnd.choice([0x80B3, 0x80B3, 0x80B4, 0x80B9])
    b3 = rnd.randrange(256) & ~0x00 if rnd.random() < 0.5 else (rnd.randrange(4) << 2) | rnd.choice([0, 0x10, 0x20, 0x30, 0x80, 0xB0])
    b6 = rnd.randrange(8)
    pos = rnd.randrange(5)
    facing = rnd.randrange(4); desired = rnd.choice([0, 1, 2, 3, 4])
    t += ['W', '1', '0', str(gfx), 'B', '1', '3', str(b3), 'B', '1', '6', str(b6), 'W', '1', '16', '2',
          'B', '2', '11', str(pos), 'B', '2', '12', str(facing), 'B', '2', '13', str(desired)]
    add(mx, my, 1)
    for (x, y), (walls, head) in cells.items():
        t += ['c', str(x), str(y), '%x' % ((walls << 12) | head | (0x80000000 if rnd.random() < 0.03 else 0))]
    t += ['AW', '0x1742', str(px), 'AW', '0x1740', str(py)]
    return t, dict(mx=mx, my=my, px=px, py=py, nid=nid[0])

lines = []
meta = []
for _ in range(1500):
    t, m = world(wall_p=rnd.choice([0.0, 0.05, 0.12, 0.25]), obj_p=rnd.choice([0.0, 0.15, 0.35]))
    lines.append(['seed', seed()] + t + ['path', '1', str(m['mx']), str(m['my']), str(m['px']), str(m['py']), 'seedout']); meta.append('path')
for _ in range(600):
    t, m = world(wall_p=rnd.choice([0.0, 0.1, 0.25]), obj_p=rnd.choice([0.15, 0.35]))
    lines.append(['seed', seed()] + t + ['adj', '1', str(m['mx']), str(m['my']), str(m['px']), str(m['py'])]); meta.append('adj')
for _ in range(400):
    t, m = world(obj_p=0.45, struct_bias=0.8)
    for _ in range(3):
        x, y = rnd.randrange(X0, X0 + N), rnd.randrange(Y0, Y0 + N)
        t_ = t + ['enter', str(x), str(y), str(rnd.randrange(256)), str(rnd.randrange(8)), str(rnd.choice([0, 1, 2])),
                  'wmask', str(x), str(y), str(rnd.choice([0x80B3, 0x80B4, 0x80B9]))]
        lines.append(t_); meta.append('enter')
for _ in range(1500):
    t, m = world(wall_p=rnd.choice([0.0, 0.1]), obj_p=rnd.choice([0.1, 0.3]), struct_bias=0.6)
    out = ['seed', seed()] + t + ['mover', '1', str(m['mx']), str(m['my'])]
    for dx, dy in ((0, 0), (0, 1), (1, 0), (0, -1), (-1, 0)):
        out += ['dc', str(m['mx'] + dx), str(m['my'] + dy)]
    for i in range(1, min(m['nid'], 40)): out += ['dw', str(i), '18']
    out += ['db', '2', '11', 'db', '2', '12', 'db', '2', '13', 'log', 'seedout']
    lines.append(out); meta.append('mover')

# targeted door / pit / statue scenarios for the mover (the random worlds rarely line a door up)
for _ in range(600):
    d = rnd.randrange(4); pos = rnd.choice([4, 4, rnd.randrange(4)])
    dx, dy = [(0, 1), (1, 0), (0, -1), (-1, 0)][d]
    mx, my = 12, 12
    typ = rnd.choice([0x11, 0x11, 0x11, 0x12, 0x14, 0x17, 0x10, 0x2f, 0x1f])
    b3 = rnd.choice([0, 0x10, 0x20, 0x30, 0x80, 0x90, 0x04, 0x14])
    b6 = rnd.choice([0, 1, 2, 3])
    t = ['seed', seed(), 'W', '1', '0', '0x80B3', 'B', '1', '3', str(b3), 'B', '1', '6', str(b6), 'W', '1', '16', '2',
         'B', '2', '11', str(pos), 'B', '2', '12', str(d), 'B', '2', '13', str(d),
         'W', '1', '18', '0', 'c', '12', '12', '1', 'W', '3', '0', '1', 'B', '3', '5', str(typ),
         'W', '3', '10', str(rnd.choice([0, 0, 1])), 'W', '3', '14', str(rnd.choice([0, 1, 2])), 'W', '3', '16', str(rnd.choice([0, 1, 2, 5])), 'B', '3', '15', str(rnd.randrange(2)),
         'c', str(mx + dx), str(my + dy), '3', 'AW', '0x1742', '20', 'AW', '0x1740', '20']
    out = t + ['mover', '1', str(mx), str(my)]
    for ddx, ddy in ((0, 0), (dx, dy)): out += ['dc', str(mx + ddx), str(my + ddy)]
    out += ['dw', '1', '18', 'dw', '3', '18', 'db', '2', '11', 'log', 'seedout']
    lines.append(out); meta.append('mover')

# ray (the shared +0x435C scan)
for _ in range(1200):
    t, m = world(wall_p=rnd.choice([0.0, 0.08, 0.2]), obj_p=rnd.choice([0.1, 0.3, 0.5]), struct_bias=0.6)
    lines.append(['seed', seed()] + t + ['ray', str(rnd.randrange(0, 8)), str(rnd.randrange(4)), str(rnd.randrange(3)), str(m['mx']), str(m['my']), str(rnd.choice([0, 1, 2, 3, 7]))]); meta.append('ray')

# the whole monster act (9D28): melee, bolts, hold, special, turn-toward
def actcase(clean=False, kind='act'):
    t, m = world(wall_p=0.0 if clean else rnd.choice([0.0, 0.05, 0.15]), obj_p=0.0 if clean else rnd.choice([0.0, 0.15, 0.3]), struct_bias=0.5, aligned=True if clean else rnd.random() < 0.8)
    gfx = rnd.choice([0x80B3, 0x80B3, 0x80B7, 0x80B8, 0x80B9, 0x80C0])
    b3 = (rnd.choice([3, 3, 3, 2, 1, 0]) << 2) | rnd.choice([0, 0, 0x20, 0x10, 0x30, 0x80])
    b6 = rnd.choice([2, 4, 4, 6, 6, 6, 0, 5])
    if clean: b3 = (3 << 2) | rnd.choice([0, 0x20]); b6 = rnd.choice([6, 6, 4, 2])
    wc = rnd.choice([0, rnd.randrange(65536), rnd.randrange(65536), 0xFFFC, 0x0004, 0x0800, 0x7000, 0xF000, 0x0F84])
    pos = rnd.randrange(5); facing = rnd.randrange(4)
    ddx, ddy = m['px'] - m['mx'], m['py'] - m['my']
    toward = 1 if ddx > 0 and abs(ddx) > abs(ddy) else 3 if ddx < 0 and abs(ddx) > abs(ddy) else 0 if ddy > 0 and abs(ddy) > abs(ddx) else 2 if ddy < 0 and abs(ddy) > abs(ddx) else 0
    face_s = toward if (clean or rnd.random() < 0.6) else rnd.randrange(4)
    if clean: wc = rnd.choice([0xFFFC, 0x0004, 0x0F84, 0x7FFC, rnd.randrange(65536) | 4])
    o = ['W', '1', '0', str(gfx), 'B', '1', '3', str(b3), 'B', '1', '6', str(b6), 'B', '1', '7', str(rnd.choice([0, 1, 3, 20])), 'W', '1', '12', str(wc),
         'W', '2', '8', str(rnd.choice([5, 30, 80, 200, 500])), 'B', '2', '11', str(pos), 'B', '2', '12', str(face_s), 'B', '2', '13', str(rnd.choice([4, 0, 1, 2, 3])),
         'B', '2', '15', str(rnd.randrange(2)), 'B', '2', '19', str(rnd.randrange(2)), 'AB', '0x1E91', str(rnd.randrange(1, 12)), 'AW', '0x1744', str(facing)]
    form = list(range(4)); rnd.shuffle(form)
    for i in range(4):
        b = 0x1758 + 0xA8 * i
        o += ['AW', str(0x1E74 + 2 * i), str(form[i]), 'AW', str(b + 0x4E), str(rnd.choice([-3, 0, 5, 30, 60])), 'AB', str(b + 0x62), str(rnd.randrange(-6, 30) & 0xff),
              'AB', str(b + 0x69), str(rnd.choice([0, 20, 50, 80, 150, 0xF0])), 'AB', str(b + 0x83), str(rnd.choice([0, 0, 1])),
              'AB', str(b + 0x8D), str(rnd.choice([0, 0, 0, 1])), 'AB', str(b + 0x8E), str(rnd.choice([0, 0, 0, 1]))]
    out = ['seed', seed()] + t + o + (['act', '1', str(m['mx']), str(m['my']), str(rnd.choice([2, 3, 4, 4, 0xC])), str(0 if clean else rnd.choice([0, 0, 1, 2]))] if kind == 'act' else
                                    [kind, '1', str(m['mx']), str(m['my'])] + ([] if kind == 'wander' else [str(rnd.choice([2, 3, 4, 4]) if kind == 'pursue' else rnd.choice([0xC, 0xC, 0xB]))]))
    for dx, dy in ((0, 0), (0, 1), (1, 0), (0, -1), (-1, 0)):
        out += ['dc', str(m['mx'] + dx), str(m['my'] + dy)]
    out += ['db', '2', '11', 'db', '2', '12', 'db', '2', '13', 'db', '2', '14', 'dw', '2', '0', 'dw', '2', '2', 'db', '2', '15', 'db', '1', '7', 'db', '2', '19', 'log', 'seedout']
    return out
for _ in range(5000):
    lines.append(actcase()); meta.append('act')
for _ in range(2500):
    lines.append(actcase(True)); meta.append('act')

# activation scan (+0xB614 monster half) with the type-10 switch
for _ in range(1500):
    t, m = world(wall_p=rnd.choice([0.0, 0.1, 0.2]), obj_p=rnd.choice([0.1, 0.3, 0.5]), struct_bias=rnd.choice([0.2, 0.5]), mtypes=True)
    tick = rnd.randrange(0, 100000)
    out = ['seed', seed()] + t + ['W', '1', '14', str(rnd.randrange(12)), 'B', '2', '19', str(rnd.choice([0, 0, 1])), 'AW', '0x1750', str(tick >> 16), 'AW', '0x1752', str(tick & 0xffff), 'scan']
    for i in range(1, min(m['nid'], 36)): out += ['dw', str(i), '14', 'db', str(i), '19', 'db', str(i), '17', 'db', str(i), '18', 'dw', str(i), '4', 'db', str(i), '14', 'dw', str(i), '0', 'dw', str(i), '2']
    out += ['log', 'seedout']
    lines.append(out); meta.append('scan')

for kind in ('pursue', 'approach', 'wander'):
    for _ in range(1500):
        lines.append(actcase(rnd.random() < 0.4, kind)); meta.append(kind)
for _ in range(500):
    n = rnd.randrange(0, 5); lst = sorted(rnd.sample(range(4), min(n, 4)))
    t = ['seed', seed(), 'W', '1', '16', '2', 'B', '2', '12', str(rnd.randrange(4))]
    for k, v in enumerate(lst): t += ['AB', str(0x1E8A + k), str(v)]
    t += ['AB', '0x1E8E', str(len(lst)), 'pick', '2', 'db', '2', '13', 'seedout']
    lines.append(t); meta.append('pick')
strs = [' '.join(l) for l in lines]
res = run(strs)
vec = {'note': 'Generated by tools/blackcrypt/rules_oracle/make_vectors_move.py from the game\'s own code; see docs/blackcrypt/amiga/game-rules.md',
       'cases': [{'k': k, 'in': i, 'out': o} for k, i, o in zip(meta, strs, res)]}
import gzip
gzip.open(sys.argv[3] if len(sys.argv) > 3 else here / 'vectors_move.json.gz', 'wt', compresslevel=9).write(json.dumps(vec, separators=(',', ':')))
from collections import Counter
print(Counter(meta))
# result histogram for path
pc = Counter(); 
for k, o in zip(meta, res):
    if k == 'path': pc[o.split()[1]] += 1
print('path results', pc)

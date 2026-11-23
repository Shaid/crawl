#!/usr/bin/env python3
"""Generate vectors_spells9.json.gz: the nine formerly code-read party spells run through the real CastSpell dispatcher (S_1 +0x7044,
`C 0x7044 1 2 0`, slot 0 of the active character) in oracle_spell, on synthetic worlds (object table, cell map, free list, character
records). Each case stores its A4-relative pokes and the oracle's full diff of the A4 region plus the hook log, so the TS model is compared on
EVERY changed byte (not a hand-picked list). Usage: make_vectors_spells9.py <s1.bin> <s2.bin> [out]. Deterministic. Evidence: harness.
Spell groups (spell id in slot 0): 10 CREATE FOOD, 2/51 REVEAL TRUTH, 41 REMOVE TRAP, 26 READ RUNE, 22/24 DISPEL MAGIC, 21 REMOVE GLYPH,
44 CREATE WALL. See docs/blackcrypt/amiga/game-rules.md section 12."""
import gzip, json, random, subprocess, sys, pathlib
here = pathlib.Path(__file__).resolve().parent
S1, S2 = sys.argv[1], sys.argv[2]
A4 = 0xA8BF0 + 0x7FFE
ORACLE = str(here / 'oracle_spell')
rnd = random.Random(0x59A11E5)
CH = lambda i: 0x1758 + 0xA8 * i
OB = lambda i: -0x6E7A + 0x14 * i
CELL = lambda x, y: -0x37CA + (y << 8) + (x << 2)
KEEP_REAL = 'K 0x17EEA K 0x6 K 0x46 K 0xFE K 0x27D28 K 0x1744A K 0x126D2 K 0x11992'   # object allocator / free / unlink / lookup / insert and the inventory-weight routines run for real (default: stubbed to RTS)
HOOKS = KEEP_REAL + ' ' + 'H 0x4876 0 H 0x4960 0 H 0x5EA 0 H 0x288B8 0 H 0x49B4 0 H 0xB25A 0 H 0x28012 0 H 0x280B6 0 H 0x288C6 0 H 0x280F6 0 H 0x280D4 0 H 0x4AE 0 H 0x2D46 0'
# the lookup helper +0x27D28 loads the cell-array and object-table bases as long IMMEDIATES (movea.l #imm, a4 / a5) that the decompressed image carries 0x80 below
# this harness's A4 (the same skew the behaviour-VM script table shows); patch both immediates in place (S_1 +0x27D2E, +0x27D34)
PTRS = 'l %d %d l %d %d' % (0x80058 + 0x27D2E, A4 - 0x37CA, 0x80058 + 0x27D34, A4 - 0x6E7A)
DX = [(0, 1), (1, 0), (0, -1), (-1, 0)]

class W:
    def __init__(s): s.p = []
    def b(s, o, v): s.p.append(['b', o, v & 0xFF])
    def w(s, o, v): s.p.append(['w', o, v & 0xFFFF])
    def l(s, o, v): s.p.append(['l', o, v & 0xFFFFFFFF])
    def obj(s, i, **f):
        o = OB(i)
        for k, v in f.items():
            if k == 'w0': s.w(o, v)
            elif k == 'b4': s.b(o + 4, v)
            elif k == 'b5': s.b(o + 5, v)
            elif k == 'b7': s.b(o + 7, v)
            elif k == 'w8': s.w(o + 8, v)
            elif k == 'wA': s.w(o + 0xA, v)
            elif k == 'wC': s.w(o + 0xC, v)
            elif k == 'wE': s.w(o + 0xE, v)
            elif k == 'w10': s.w(o + 0x10, v)
            elif k == 'nx': s.w(o + 0x12, v)

def base(spell, free_from=40):
    w = W(); d = {}
    w.w(0x174A, rnd.choice([0, 1, 3, 10])); w.w(0x1A14, rnd.randrange(4)); d['active'] = w.p[-1][2]
    f = rnd.randrange(4); w.w(0x1744, f); px = rnd.randrange(8, 20); py = rnd.randrange(8, 20); w.w(0x1742, px); w.w(0x1740, py)
    for i in range(4): w.w(0x1E74 + 2 * i, i)
    w.l(0x1750, rnd.randrange(0, 100000))
    for i in range(4):
        w.w(CH(i), rnd.randrange(4)); w.b(CH(i) + 0x5E, rnd.randrange(1, 25)); w.b(CH(i) + 0x6A, rnd.randrange(-3, 6)); w.b(CH(i) + 0x65, rnd.randrange(0, 31)); w.b(CH(i) + 0x66, rnd.randrange(0, 31))
        w.w(CH(i) + 0x4E, rnd.choice([0, -2, 15, 40, 90])); w.b(CH(i) + 0x6E, rnd.randrange(3, 30)); w.l(CH(i) + 0xA4, rnd.choice([0, 500, 9000, 40000, 150000]))
        for s in range(5): w.b(CH(i) + 0x49 + s, 255)
    a = d['active']; w.b(CH(a) + 0x49, spell); w.w(CH(a) + 0x4E, rnd.choice([15, 40, 90]))
    # free list ids free_from.. in random order, ends 0; head cell is object 0's +0x12 word
    ids = list(range(free_from, free_from + 30)); rnd.shuffle(ids)
    w.w(OB(0) + 0x12, ids[0])
    for a_, b_ in zip(ids, ids[1:] + [0]): w.w(OB(a_) + 0x12, b_)
    d.update(f=f, px=px, py=py, cells={})
    return w, d

def put_cell(w, d, x, y, chain, flags=0):
    v = (chain[0] if chain else 0) | flags
    w.l(CELL(x, y), v); d['cells'][(x, y)] = v
def link(w, chain):
    for a_, b_ in zip(chain, chain[1:] + [0]): w.w(OB(a_) + 0x12, b_)
def front(d, k=1): return d['px'] + DX[d['f']][0] * k, d['py'] + DX[d['f']][1] * k

def gen(spell):
    w, d = base(spell)
    wallbit = lambda f: 0x1000 << f
    pflags = wallbit(d['f']) if rnd.random() < 0.12 else 0
    pflags |= rnd.choice([0] * 9 + [0x40000000])
    fx, fy = front(d)
    if spell == 10:
        chain = list(range(1, rnd.choice([1, 2, 3, 4]))) if rnd.random() < 0.6 else []
        for i in chain: w.obj(i, w0=rnd.choice([0x15, 0x12, 0x1]), b4=rnd.randrange(256), b5=rnd.randrange(32))
        link(w, chain); put_cell(w, d, d['px'], d['py'], chain, pflags)
    elif spell in (2, 51):
        a = d['active']
        for c in range(4):
            for k in (2, 3):
                if rnd.random() < 0.6:
                    it = 5 + c * 2 + (k - 2); w.w(CH(c) + 0x16 + 2 * k, it)
                    w.obj(it, w0=rnd.choice([0x12, 0x13]), b5=rnd.choice([0x18, 0x18, 0x18, 0x17, 0x13]), wE=rnd.choice([1, 1, 0, 2]), w8=rnd.randrange(-30, 400), wA=rnd.randrange(0, 50), wC=0)
                    if rnd.random() < 0.3: w.obj(it, b5=0x13, wC=30 + c, ); w.obj(30 + c, w0=0x12, b5=rnd.choice([0x18, 0x5]), w8=rnd.randrange(0, 100), wA=rnd.randrange(0, 9), nx=0)
        # NOTE: ids 5..12 and 30..33 are used by items; the free list (40..69) does not overlap
    elif spell in (41, 21, 22, 24, 44):
        typ = {41: 0x1E, 21: 0x10, 22: 0x10, 24: 0x10, 44: 0x10}[spell]
        chain = []
        if spell == 44:
            if rnd.random() < 0.35:
                chain = [1]; w.obj(1, w0=rnd.choice([0x1, 0x15]), b5=rnd.randrange(32))
        else:
            n = rnd.choice([0, 1, 1, 2, 3])
            for i in range(1, n + 1):
                kind = rnd.random()
                if kind < 0.15: w.obj(i, w0=0x80B3 if rnd.random() < .5 else 0x80C5, b5=typ)            # monster with the same type byte: skipped by the lookup
                else: w.obj(i, w0=1, b5=typ if rnd.random() < 0.8 else rnd.choice([0x11, 0x14]), wC=rnd.choice([1, 2, 3, 2, 3]), wE=rnd.choice([0, 1, 2, 3, 5]), wA=rnd.choice([0, 1]), w10=0, b7=0)
                if i == 1 and rnd.random() < 0.6:   # a matching structure first on the square (so the effect path is well covered)
                    w.obj(1, w0=1, b5=typ, wC={41: 1, 21: 3}.get(spell, 2), wE=1 if spell == 41 else rnd.choice([0, 1, 2, 3, 5]))
                chain.append(i)
            link(w, chain)
            # linked group (DISPEL MAGIC follows x = word +0x10, y = byte +7): a second and third square
            if spell in (22, 24) and chain and rnd.random() < 0.6:
                nx_, ny_ = fx + rnd.choice([-1, 0, 1]), fy + rnd.choice([-1, 0, 1]); w.obj(chain[0], w10=nx_, b7=ny_)
                ch2 = [20]; w.obj(20, w0=1, b5=0x10, wC=rnd.choice([2, 2, 3]), wE=1, w10=0, b7=0)
                if rnd.random() < 0.5:
                    mx_, my_ = fx + rnd.choice([-2, 0, 2]), fy + rnd.choice([-2, 0, 2]); w.obj(20, w10=mx_, b7=my_)
                    w.obj(21, w0=1, b5=0x10, wC=2, wE=1, w10=0, b7=0); put_cell(w, d, mx_, my_, [21])
                put_cell(w, d, nx_, ny_, ch2) if (nx_, ny_) != (fx, fy) else None
        put_cell(w, d, fx, fy, chain, rnd.choice([0, 0, 0, wallbit((d['f'] + 2) % 4)]))
        if (fx, fy) in d['cells'] and spell == 44: pass
        # party cell carries the facing-wall bit (or not)
        put_cell(w, d, d['px'], d['py'], [], pflags if spell != 44 else pflags)
        if spell == 44 and rnd.random() < 0.0: pass
    elif spell == 26:
        w.b(-0x779A, rnd.choice([0x6A, 0x6A, 0x3, 0]))
        a = d['active']; w.b(0x1E70, 0)
        for s in range(5): w.b(CH(a) + 0x49 + s, rnd.choice([255, 3, 4, 5, 7, 9]))
        w.b(CH(a) + 0x49, 26)
        put_cell(w, d, d['px'], d['py'], [], 0)
    if spell not in (10, 41, 21, 22, 24, 44, 26) and (d['px'], d['py']) not in d['cells']: put_cell(w, d, d['px'], d['py'], [], 0)
    if spell == 10 and (d['px'], d['py']) not in d['cells']: put_cell(w, d, d['px'], d['py'], [], 0)
    return w, d

def run(lines):
    out = subprocess.run([ORACLE, S1, S2, 'script'], input='\n'.join(lines) + '\n', capture_output=True, text=True, check=True).stdout
    res = []
    for l in out.split('\n'):
        if not l.startswith('script'): continue
        a, b, c, dd = l[len('script :'):].split('|')
        cs = c.split()
        log = [[int(v, 16) if i == 0 else int(v) for i, v in enumerate(e.split(','))] for e in b.split()[1:]]
        diff = {}
        for t in dd.split():
            k, v = t.split(':'); diff[int(k, 16) - 0x8000] = int(v, 16)
        res.append(dict(log=log, seed=cs[0], d0=int(cs[2]), a3=int(cs[6]), diff=diff))
    return res

def gen_door():
    w, d = base(0xFF); x = rnd.randrange(8, 20); y = rnd.randrange(8, 20)
    chain = []
    if rnd.random() < 0.8:
        for i in range(1, rnd.choice([2, 3, 4])):
            if i == 1 or rnd.random() < 0.5: w.obj(i, w0=1, b5=rnd.choice([0x11, 0x11, 0x10, 0x14]), wE=rnd.choice([0, 2, 1]), wC=rnd.randrange(3))
            else: w.obj(i, w0=0x80B3, b5=0x11)
            chain.append(i)
        link(w, chain)
    put_cell(w, d, x, y, chain, rnd.choice([0, 0x80000000]))
    w.b(0x1748, rnd.choice([0, 1]))
    return w, d, 'C 0x9056 2 2 %d 2 %d' % (y, x), dict(x=x, y=y)

def gen_hammer():
    w, d = base(0xFF)
    w.w(0x1A1E, rnd.choice([4, 4, 4, 4, 3, 5, 2])); w.l(0x1750, rnd.randrange(0, 100000)); w.w(0x1E60, 0)
    fx, fy = front(d)
    walls = (0x1000 << d['f']) if rnd.random() < 0.15 else 0
    put_cell(w, d, d['px'], d['py'], [], walls)
    head = 0; ids = []
    for m in range(rnd.choice([0, 1, 1, 1, 2])):
        P, S = 1 + 2 * m, 2 + 2 * m
        w.obj(P, w0=rnd.choice([0x80C5, 0x80C5, 0x80B3, 0x80B2]), w10=S, nx=head); w.b(OB(S) + 0xB, rnd.choice([4, 4, 0, 1, 2, 3])); w.b(OB(S) + 0xA, rnd.choice([0, 1, 5])); w.b(OB(S) + 0xC, rnd.randrange(4)); w.b(OB(S) + 0x12, rnd.randrange(250))
        head = P
    put_cell(w, d, fx, fy, [head] if head else [])
    if rnd.random() < 0.7:
        w.obj(20, w0=1, b5=0x12, wA=rnd.choice([0, 1, 5])); put_cell(w, d, 0x0C, 0x11, [20])
    elif rnd.random() < 0.5: w.obj(20, w0=1, b5=0x12, wA=3)
    return w, d, 'C 0x7C40 0', {}

def gen_weight():
    w, d = base(0xFF); ids = []
    def item(i, depth=0):
        cont = depth < 2 and rnd.random() < 0.35
        t = rnd.choice([0x13, 0x23]) if cont else rnd.choice([0x05, 0x18, 0x14, 0x0E, 0x12])
        w.obj(i, w0=0x12, b5=t, w8=rnd.randrange(-20, 1500), wA=rnd.randrange(0, 80))
        if cont:
            kids = [100 + i * 4 + k for k in range(rnd.choice([0, 1, 2, 3]))]
            if kids: w.obj(i, wC=kids[0])
            for k in kids: item(k, depth + 1)
            for a_, b_ in zip(kids, kids[1:] + [0]): w.w(OB(a_) + 0x12, b_)
    for i in range(5, 13): item(i)
    ch = rnd.randrange(4); add = rnd.choice([0, 0, rnd.randrange(5, 13)]); rem = rnd.choice([0, rnd.randrange(5, 13)])
    return w, d, 'C 0x126D2 3 2 %d 2 %d 2 %d' % (rem, add, ch), dict(ch=ch, add=add, rem=rem)

def vit_chars(w):
    for i in range(4):
        w.w(CH(i) + 0x4E, rnd.choice([0, -3, 9, 50])); w.w(CH(i) + 0x56, rnd.choice([0, 500, 999, 1000, 1001, 1002, 5000, 9990, 10000, 12000, 32000, -100, rnd.randrange(0, 11000)]))
        w.w(CH(i) + 0x52, rnd.choice([0, 1, 100, 4999, 5000, 6000, rnd.randrange(0, 5200)])); w.w(CH(i) + 0x54, rnd.choice([0, 1, 100, 4999, 5000, 6000, rnd.randrange(0, 5200)]))
        w.b(CH(i) + 0x90, rnd.choice([0, 0, 1, 3])); w.b(CH(i) + 0x62, rnd.randrange(-20, 40)); w.b(CH(i) + 0x64, rnd.randrange(2, 29)); w.b(CH(i) + 0x68, rnd.randrange(2, 29))
        w.l(CH(i) + 0xA4, rnd.choice([0, 2047, 2048, 4096, 30000, 150000, 300000, rnd.randrange(0, 400000), -5000]))
def gen_vitals():
    w, d = base(0xFF); vit_chars(w)
    ch = rnd.randrange(4); dd = [rnd.choice([-3, -2, -1, 1, 5, -300, 300, -2000, 20000, -20000, rnd.randrange(-400, 400)]) for _ in range(3)]
    return w, d, 'C 0x17EEA 4 2 %d 2 %d 2 %d 2 %d' % (dd[2] & 0xFFFF, dd[1] & 0xFFFF, dd[0] & 0xFFFF, ch), dict(ch=ch, dE=dd[0], dF=dd[1], dW=dd[2])
def gen_step():
    w, d = base(0xFF); vit_chars(w); w.w(0x1A14, 0)
    FRAME = 0x2F0100
    return w, d, 'A 5 %d D 6 %d G 0x16FC6 0x17006' % (FRAME, 0xFFFFFFFF), dict(frame_poke=['w', FRAME - 2, 0xFFFF])

def gen_swing():
    w, d = base(0xFF)
    w.w(0x1A14, 0); w.w(0x1744, 0); w.w(0x1740, 5); w.w(0x1742, 5); w.l(0x1750, rnd.randrange(0, 100000)); w.w(0x1E2E, rnd.choice([0, 0, 1, 2]))
    w.w(CH(0), rnd.randrange(4)); w.b(CH(0) + 0x5E, rnd.randrange(1, 20)); w.b(CH(0) + 0x64, rnd.randrange(3, 28)); w.b(CH(0) + 0x6C, rnd.randrange(0, 30)); w.w(CH(0) + 0x4E, 50); w.w(CH(0) + 0x50, 50)
    put_cell(w, d, 5, 6, [1], 0)
    w.obj(1, w0=0x80B3, w10=2, w8=rnd.choice([400, 900, 30000])); w.b(OB(1) + 2, rnd.randrange(256)); w.obj(2, w0=0); w.b(OB(2) + 0xB, 4)
    delay = rnd.choice([5, 5, 6, 7, 8, 9, 12, 20, 40, 3000, rnd.randrange(5, 200)]); item = rnd.choice([0, 3, 3]); gfx = rnd.choice([0x80, 0x12, 0x20, 0x35, rnd.randrange(0, 0xA0)])
    if item: w.obj(item, w0=gfx, wC=rnd.randrange(0, 4))
    # args: first pushed = rightmost: delay (0x10), side (0xE), hand byte (0xC), char (0xA), item (8)
    return w, d, 'C 0x1451E 5 2 %d 2 0 1 0 2 0 2 %d' % (delay, item), dict(delay=delay, item=item)

def gen_cool():
    w, d = base(0xFF); ch = rnd.randrange(4)
    item = rnd.choice([0, 5, 5, 6]); w.obj(5, w0=0x12, w8=rnd.choice([0, 22, 23, 24, 100, 460, 1000, 5000, 32767, 40000, 65535, rnd.randrange(0, 65536)])); w.obj(6, w0=0x12, w8=rnd.randrange(0, 3000))
    w.b(CH(ch) + 0x68, rnd.randrange(0, 31)); w.b(CH(ch) + 0x1C, 0)
    return w, d, 'D 5 %d D 2 %d G 0x138F0 0x1394E' % (item, ch), dict(ch=ch, item=item)
def gen_ready():
    w, d = base(0xFF); ch = rnd.randrange(4); hand = rnd.randrange(2)
    vit_chars(w); w.w(0x1E2E, rnd.choice([0, 0, 1, 3])); w.l(0x1750, rnd.randrange(0, 100000)); w.b(CH(ch) + 0x5F, rnd.randrange(0, 4)); w.w(0x1A14, ch)
    a3 = rnd.choice([5, 6, 7, 9, 20, 85, 130, 2900, 3000, 32767, 40000, rnd.randrange(5, 3000)]); flag = rnd.choice([1, 1, 1, 0]); FR = 0x2F0100
    return w, d, 'A 5 %d D 2 %d D 6 %d A 3 %d G 0x13E8C 0x137B6' % (FR, ch, hand, a3), dict(ch=ch, hand=hand, a3=a3, flag=flag, frame_poke=['b', FR - 9, flag])

PLAN = [10, 2, 51, 41, 26, 22, 24, 21, 44]
FAM = ['door', 'hammer', 'weight', 'vitals', 'step', 'swing', 'cool', 'ready']
N = int(sys.argv[4]) if len(sys.argv) > 4 else 220
cases = []; lines = []
for n in range(N * len(PLAN)):
    sp = PLAN[n % len(PLAN)]; w, d = gen(sp); sd = ''.join('%02x' % rnd.randrange(256) for _ in range(6))
    txt = ' '.join(['S', sd, HOOKS, PTRS] + ['%s %d %d' % (k, A4 + o, v) for k, o, v in w.p] + ['C 0x7044 1 2 0'])
    cases.append(dict(spell=sp, seed=sd, pokes=w.p)); lines.append(txt)
for n in range(N * len(FAM)):
    fam = FAM[n % len(FAM)]; sd = ''.join('%02x' % rnd.randrange(256) for _ in range(6)); extra = {}
    if fam == 'door': w, d, call, extra = gen_door()
    elif fam == 'hammer': w, d, call, extra = gen_hammer()
    elif fam == 'weight': w, d, call, extra = gen_weight()
    elif fam == 'vitals': w, d, call, extra = gen_vitals()
    elif fam == 'step': w, d, call, extra = gen_step()
    elif fam == 'swing': w, d, call, extra = gen_swing()
    elif fam == 'cool': w, d, call, extra = gen_cool()
    else: w, d, call, extra = gen_ready()
    txt = ' '.join(['S', sd, HOOKS, 'H 0x8388 0 H 0xB25A 0 H 0x21F8 0 H 0x20F6 0 H 0x2066 0 H 0x21BA 0 H 0x80506 0 H 0x170A8 0', PTRS] + ['%s %d %d' % (k, A4 + o, v) for k, o, v in w.p] + (['%s %d %d' % (extra['frame_poke'][0], extra['frame_poke'][1], extra['frame_poke'][2])] if 'frame_poke' in extra else []) + [call])
    cases.append(dict(fam=fam, seed=sd, pokes=w.p, **extra)); lines.append(txt)
res = run(lines)
assert len(res) == len(cases)
KEEP_LOG = {0x4876, 0x4960, 0x5EA, 0x4AE, 0x2D46, 0xB25A, 0x170A8}
for c, r in zip(cases, res):
    c['out'] = dict(diff={str(k): v for k, v in sorted(r['diff'].items())}, seed=r['seed'], d0=r['d0'], a3=r['a3'],
                    log=[[e[0]] + e[1:8] for e in r['log'] if e[0] in KEEP_LOG])
vec = dict(note='Generated by make_vectors_spells9.py from the game\'s own code; see game-rules.md section 12', cases=cases)
gzip.open(sys.argv[3] if len(sys.argv) > 3 else str(here / 'vectors_spells9.json.gz'), 'wt', compresslevel=9).write(json.dumps(vec, separators=(',', ':')))
print('wrote', len(cases))

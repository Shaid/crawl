#!/usr/bin/env python3
"""MM3 rules vector generators.  Usage: rules.py UNIT OUT.json [--n N] [--seed S]
Big sets go to tools/mm3/rules_oracle/generated/ (gitignored); `subset IN OUT --n N` writes a small committed subset."""
import json, os, random, sys, gzip
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE, HEAP
from harness import Rec

def g(d): return A4V + d
def sb(e, d, v): e.w8(g(d), v)
def sw(e, d, v): e.w16(g(d), v)
def sl(e, d, v): e.w32(g(d), v)

SEED = -0x2104
YEAR = -0x1326
CH = g(-0xc78)                 # character record 0 (stride 0x130)
R = lambda off: CODE_BASE + off
F_RAND15, F_SRAND, F_RAND = R(0x12EA8), R(0x12EA0), R(0x64D4)
F_BRACKET, F_LEVEL, F_AGE, F_CONDMOD, F_EQUIP, F_GETSTAT = R(0xCE5C), R(0xD03E), R(0xCE8E), R(0x94FA), R(0xCEF0), R(0xD064)
F_MAXHP, F_AC = R(0xAD56), R(0xADE6)
F_CHECK, F_SAVE, F_DAMAGE = OV_BASE[4] + 0x82B0, OV_BASE[4] + 0x82DC, OV_BASE[4] + 0xECE8
F_WEAPON, F_PARTYHIT, F_ELEMENT = R(0x11DA6), OV_BASE[4] + 0x12C38, OV_BASE[4] + 0x12D56
F_MELEE, F_DMGHIT, F_XPSPLIT = OV_BASE[4] + 0x13282, OV_BASE[4] + 0x13048, OV_BASE[4] + 0x12FB0
F_MONATTACK, F_UI971C, F_DRAW945E = R(0x9E02), R(0x971C), R(0x945E)

def fill_char(e, rnd, a, sane=True):
    for k in range(0x130): e.w8(a + k, rnd.getrandbits(8))
    def zr(off, n, p=0.5, hi=255):
        for i in range(n): e.w8(a + off + i, 0 if rnd.random() < p else rnd.randint(1, hi))
    for off in (0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21):
        e.w8(a + off, rnd.randint(0, 40) if rnd.random() < 0.85 else rnd.randint(0, 255))
    e.w8(a + 0x23, rnd.randint(0, 60)); e.w8(a + 0x24, rnd.choice([0, 0, 0, rnd.randint(1, 30)]))
    e.w8(a + 0x26, rnd.choice([0, 0, rnd.randint(1, 20), rnd.getrandbits(8)]))
    e.w8(a + 0x22, rnd.randint(0, 30)); e.w8(a + 0x102, rnd.choice([0, rnd.randint(0, 30)]))
    e.w8(a + 0x103, rnd.choice([0, 0, rnd.randint(1, 10)]))
    e.w8(a + 0x11, rnd.randint(0, 12) if rnd.random() < 0.9 else rnd.getrandbits(8))
    e.w8(a + 0x13, rnd.randint(0, 12) if rnd.random() < 0.9 else rnd.getrandbits(8))
    e.w8(a + 0x2a, rnd.getrandbits(1))
    for i in range(18):
        e.w8(a + 0xdc + i, rnd.choice([0, rnd.randint(1, 0x4a), rnd.randint(0x20, 0x2c), rnd.getrandbits(8)]))
        e.w8(a + 0x7d + i, rnd.choice([0, 1, 2, 4, 13, rnd.randint(1, 255)]))
        e.w8(a + 0x90 + i, rnd.choice([0, 0, 0, 0x40, 0x80, 0xc0, rnd.getrandbits(8)]))
        for off in (0xa3, 0xb6, 0xc9):
            e.w8(a + off + i, 0 if rnd.random() < 0.5 else rnd.randint(1, 60))
    for off in range(0x113, 0x123):
        e.w8(a + off, 0 if rnd.random() < 0.7 else rnd.randint(1, 12))
    if rnd.random() < 0.8:
        for off in (0x120, 0x121, 0x122): e.w8(a + off, 0)
    e.w16(a + 0x126, rnd.choice([rnd.randint(-30, 60), rnd.randint(0, 400)]) & 0xffff)
    e.w16(a + 0x128, rnd.randint(0, 100))
    e.w16(a + 0x12a, 0)
    e.w8(a + 0x7a, rnd.choice([0, 1, 1, rnd.getrandbits(8)]))
    e.w32(a + 0x12c, rnd.choice([0, rnd.getrandbits(16), rnd.getrandbits(32)]))
    if rnd.random() < 0.5: e.w8(a + 0x23, rnd.randint(1, 25))

def setup_common(e, rnd, a, seed=None):
    sl(e, SEED, rnd.getrandbits(32) if seed is None else seed)
    sw(e, YEAR, rnd.randint(1000, 1300))
    fill_char(e, rnd, a)
    b = e.r16(g(YEAR)) - rnd.choice([rnd.randint(14, 70), rnd.randint(0, 200), rnd.randint(-5, 5)])
    e.w16(a + 0x12a, b & 0xffff)
    for k in range(0x1322, 0x1322 + 8, 2): pass
    for d in (-0x1322, -0x1320, -0x131e, -0x131c): sw(e, d, rnd.choice([0, rnd.randint(0, 30), rnd.randint(0, 120)]))

def gen_rng(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32) if i % 7 else rnd.choice([0, 1, 0xffffffff, 0x7fff, 0x80000000])
        kind = rnd.choice(['r15', 'srand', 'range', 'range', 'range'])
        if kind == 'r15':
            out.append({'kind': kind, 'args': [], **Rc.run(F_RAND15, (), lambda e: sl(e, SEED, seed))})
        elif kind == 'srand':
            w = rnd.getrandbits(32)
            out.append({'kind': kind, 'args': [w], **Rc.run(F_SRAND, ((w, 4),), lambda e: sl(e, SEED, seed))})
        else:
            if rnd.random() < 0.15:
                lo = rnd.randint(-5, 50); hi = lo - rnd.randint(0, 3)
            else:
                lo = rnd.choice([0, 1, 1, 1, rnd.randint(-20, 300)])
                hi = lo + rnd.choice([0, 1, 2, 3, 5, 9, 19, 99, 1008, rnd.randint(0, 0x7ffe)])
            hi = min(hi, lo + 0x7ffe)
            out.append({'kind': kind, 'args': [lo, hi], **Rc.run(F_RAND, (lo & 0xffff, hi & 0xffff), lambda e: sl(e, SEED, seed))})
    def first(sd): return (((sd * 0x41c64e6d + 0x3039) & 0xffffffff) >> 16) & 0x7fff
    found = 0
    while found < 8:
        sd = rnd.getrandbits(32)
        if first(sd) >= 32760:
            lo, hi = rnd.choice([(1, 10), (1, 6), (1, 100), (0, 9), (1, 20)])
            out.append({'kind': 'range', 'args': [lo, hi], 'keep': True, **Rc.run(F_RAND, (lo, hi), lambda e: sl(e, SEED, sd))}); found += 1
    return out

def per_char(fn, nargs):
    """Generic char-unit generator: fn(rnd) -> args after the char pointer."""
    def gen(n, rnd):
        e = Emu(); Rc = Rec(e); out = []
        for _ in range(n):
            args = fn(rnd)
            def setup(e): setup_common(e, rnd, CH)
            v = Rc.run(fn.addr, ((CH, 4),) + tuple(args), setup, ret_bits=getattr(fn, 'bits', 16))
            out.append({'char': CH, 'args': list(args), **v})
        return out
    return gen

def gen_bracket(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for v in range(0, 256):
        out.append({'args': [v], **Rc.run(F_BRACKET, (v,))})
    for _ in range(n - 256):
        v = rnd.randint(0, 0xffff)
        out.append({'args': [v], **Rc.run(F_BRACKET, (v,))})
    return out

def mk(addr, argfn):
    argfn.addr = addr; return argfn
UNITS = {'rng': gen_rng, 'bracket': gen_bracket}
def reg(name, addr, argfn): UNITS[name] = per_char(mk(addr, argfn), 0)
reg('level', F_LEVEL, lambda r: ())
reg('age', F_AGE, lambda r: (r.choice([0, 1]),))
reg('condmod', F_CONDMOD, lambda r: (r.randint(0, 6),))
reg('equip', F_EQUIP, lambda r: (r.choice([0, 1, 2, 4, 5, 6, 7, 8, 9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17, r.randint(0, 20)]),))
reg('getstat', F_GETSTAT, lambda r: (r.randint(0, 6), r.choice([0, 0, 1])))
def _mh(r): return ()
_mh.bits = 32
reg('maxhp', F_MAXHP, _mh)
reg('ac', F_AC, lambda r: (r.choice([0, 1]),))
reg('save', F_SAVE, lambda r: (r.randint(0, 6),))

def gen_check(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        x = rnd.randint(-20, 300); seed = rnd.getrandbits(32)
        out.append({'args': [x], **Rc.run(F_CHECK, (x & 0xffff,), lambda e: sl(e, SEED, seed))})
    return out
UNITS['check'] = gen_check

def gen_dmgchar(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        dmg = rnd.choice([0, rnd.randint(0, 30), rnd.randint(0, 400)])
        def setup(e): setup_common(e, rnd, CH)
        out.append({'char': CH, 'args': [dmg], **Rc.run(F_DAMAGE, ((CH, 4), dmg), setup)})
    return out
UNITS['dmgchar'] = gen_dmgchar

def gen_monattack(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(F_UI971C, 'ui971c', argfn=lambda e, sp: [e.r16(sp)])
    e.stub(F_DRAW945E, 'draw945e', argfn=lambda e, sp: [e.r16(sp + 4), e.r16(sp + 6), e.r16(sp + 8), e.r16(sp + 10)])
    e.stub(F_DAMAGE, 'applyECE8', argfn=lambda e, sp: [e.r32(sp), e.r16(sp + 4)])
    for _ in range(n):
        mon = rnd.randint(0, 89); slot = rnd.choice([rnd.randint(0, 7), rnd.randint(0, 7), -1, 8, 9])
        def setup(e):
            setup_common(e, rnd, CH)
            if rnd.random() < 0.4: e.w8(CH + 0x103, rnd.randint(0, 3))
        v = Rc.run(F_MONATTACK, ((CH, 4), slot & 0xffff, mon), setup)
        out.append({'char': CH, 'args': [slot, mon], **v})
    return out
UNITS['monattack'] = gen_monattack

def setup_target(e, rnd):
    sb(e, -0x3f2b, rnd.randint(0, 9))
    for i in range(10):
        sw(e, 0x188e + 2 * i, rnd.choice([0, 0, rnd.randint(1, 5)]))
        sw(e, 0x173a + 2 * i, rnd.randint(0, 89))
    sb(e, 0x330e, rnd.getrandbits(8)); sb(e, 0x330c, rnd.getrandbits(8))

def gen_weapon(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        mode = rnd.randint(0, 1)
        def setup(e):
            setup_common(e, rnd, CH)
            for i in range(18):
                e.w8(CH + 0x7d + i, rnd.choice([0, 1, 13, 4, 4, 2, rnd.getrandbits(8)]))
                e.w8(CH + 0xef + i, rnd.getrandbits(8))
        out.append({'char': CH, 'args': [mode], **Rc.run(F_WEAPON, ((CH, 4), mode), setup)})
    return out
UNITS['weapon'] = gen_weapon

def gen_partyhit(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        mode = rnd.randint(0, 1)
        def setup(e):
            setup_common(e, rnd, CH)
            e.w8(CH + 0x13, rnd.randint(0, 9))
            for i in range(18):
                e.w8(CH + 0x7d + i, rnd.choice([0, 1, 13, 4, 4, 2, rnd.getrandbits(8)]))
            setup_target(e, rnd)
        out.append({'char': CH, 'args': [mode], **Rc.run(F_PARTYHIT, ((CH, 4), mode), setup)})
    return out
UNITS['partyhit'] = gen_partyhit

def gen_element(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        kind = rnd.choice([0, 3, 0, 3, 1, 2, 4, 5, 9])
        def setup(e):
            setup_target(e, rnd)
            sw(e, 0x332e, rnd.choice([0, 1, 2, 3, 4, 5, 6, 7, rnd.randint(0, 40)]))
            sb(e, 0x3310, rnd.choice([0, rnd.randint(1, 8), rnd.randint(9, 40), rnd.getrandbits(8)]))
        out.append({'args': [kind], **Rc.run(F_ELEMENT, (kind,), setup)})
    return out
UNITS['element'] = gen_element

def gen_meleeround(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(OV_BASE[4] + 0x136E2, 'apply136E2', argfn=lambda e, sp: [e.r32(sp), e.r16(sp + 4), e.r16(sp + 6)])
    e.stub(OV_BASE[4] + 0x1307C, 'call1307C', argfn=lambda e, sp: [])
    for _ in range(n):
        def setup(e):
            setup_common(e, rnd, CH)
            e.w8(CH + 0x13, rnd.randint(0, 9))
            for i in range(18): e.w8(CH + 0x7d + i, rnd.choice([0, 1, 13, 4, 2, rnd.getrandbits(8)]))
            setup_target(e, rnd)
        out.append({'char': CH, 'args': [], **Rc.run(F_MELEE, ((CH, 4), 0), setup)})
    return out
UNITS['meleeround'] = gen_meleeround

def gen_dmghit(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        def setup(e):
            setup_common(e, rnd, CH); sw(e, 0x330c, rnd.randint(-5, 60) & 0xffff)
        out.append({'char': CH, 'args': [], **Rc.run(F_DMGHIT, ((CH, 4),), setup)})
    return out
UNITS['dmghit'] = gen_dmghit

def gen_xpsplit(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        amount = rnd.choice([0, rnd.randint(1, 100), rnd.randint(1, 50000), rnd.randint(0, 0x7fffffff)])
        def setup(e):
            cnt = rnd.randint(1, 6)
            sb(e, -0x104a, rnd.choice([0, 1, 2, 2])); sb(e, -0x1672, cnt); sb(e, 0x1f74, rnd.randint(1, 6))
            for i in range(8): sb(e, -0xc81 + i, rnd.randint(0, 7))
            for k in range(8):
                a = CH + 0x130 * k
                for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.8 else rnd.randint(1, 5))
                e.w32(a + 0x12c, rnd.choice([0, rnd.getrandbits(20), rnd.getrandbits(32)]))
        out.append({'args': [amount], **Rc.run(F_XPSPLIT, ((amount, 4),), setup, ret_bits=16)})
    return out
UNITS['xpsplit'] = gen_xpsplit

def _bsp(r): return ()
_bsp.bits = 32
def _bxp(r): return ()
_bxp.bits = 32
reg('maxsp', R(0xAC46), _bsp)
reg('xpnext', R(0x88FC), _bxp)

def main():
    a = sys.argv[1:]
    if a[0] == 'subset':
        data = json.load(open(a[1])); n = int(a[a.index('--n') + 1]) if '--n' in a else 40
        r = random.Random(7)
        keep = [d for d in data if d.get('keep')]
        rest = [d for d in data if not d.get('keep')]
        sub = keep + (rest if len(rest) <= n else r.sample(rest, n))
        raw = json.dumps(sub, separators=(',', ':')).encode()
        if a[2].endswith('.gz'): gzip.GzipFile(a[2], 'wb', mtime=0).write(raw)
        else: open(a[2], 'wb').write(raw)
        return
    unit, outp = a[0], a[1]
    n = int(a[a.index('--n') + 1]) if '--n' in a else 3000
    seed = int(a[a.index('--seed') + 1]) if '--seed' in a else 1
    rnd = random.Random(seed)
    res = UNITS[unit](n, rnd)
    os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
    json.dump(res, open(outp, 'w'), separators=(',', ':'))
    print(unit, len(res), 'vectors ->', outp)
if __name__ == '__main__': main()

#!/usr/bin/env python3
"""MM3 rules vector generators, pass 4: world rules (rest, ...).  Same recorder/format as rules.py .. rules3.py.
Usage: rules4.py UNIT OUT.json [--n N] [--seed S]   |   rules4.py subset IN OUT.gz --n N"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE, DATA_BASE
from harness import Rec
import rules as B
from rules import g, sb, sw, sl, R, CH, fill_char, SEED
from rules2 import party
from rules3 import install_ui, quiet, OV4, OV8

def ptr(e, v):
    """a pointer argument as a stable id: root code offset; 0x1000000 + A4 displacement (DATA); 0x2000000 + seg*0x100000 + offset (overlay)"""
    if CODE_BASE <= v < CODE_BASE + 0x20000: return v - CODE_BASE
    if DATA_BASE <= v < DATA_BASE + 0x10000: return 0x1000000 + (v - A4V)
    for sg, b in OV_BASE.items():
        if b <= v < b + 0x20000: return 0x2000000 + sg * 0x100000 + (v - b)
    return v

# ---------------------------------------------------------------- rest R+0xFEA6
F_REST = R(0xFEA6)
def install_rest(e):
    install_ui(e, skip=('13c10', 'bef6'))
    e.walk = []; e.yn = []; e.ticks = []
    e.stub(OV4(0x57C), 'walk', fn=lambda e2, sp: e2.walk.pop(0) if e2.walk else 0, argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    e.stub(R(0xBEF6), 'msg', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x8A40), 'yesno', fn=lambda e2, sp: e2.yn.pop(0) if e2.yn else 0, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), e2.r16(sp + 4)])
    def tick(e2, sp):
        if e2.ticks and e2.ticks.pop(0): e2.w8(g(-0x104a), 1)
    e.stub(OV4(0x108EC), 'tick', fn=tick, argfn=lambda e2, sp: [])
    e.stub(OV4(0x10386), 'timepass', argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(OV4(0xB64A), 'b64a', argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), ptr(e2, e2.r32(sp + 8)), e2.r32(sp + 12)])
    # real: D064 (attribute), CEC6 (worst condition), AD56 (max HP), AC46 (max SP), C7F8 (party-wiped test)

def rest_state(e, rnd):
    n = rnd.choice([1, 2, 3, 4, 5, 6, 6, 7, 8]); party(e, rnd, n); sb(e, -0x1672, n); sb(e, 0x1f74, n)
    for k in range(8):
        a = CH + 0x130 * k
        for off in range(0x14, 0x1b): e.w8(a + off, rnd.choice([1, 5, 10, 15, 20, rnd.randint(1, 40)]) if rnd.random() < 0.97 else 0)
        for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.8 else rnd.choice([1, 2, 3, 5, 8, 0xb, 0xc, 0xd, 0xe, 0xf]))
        for off in (0x102, 0x103, 0x104, 0x105, 0x11f, 0x126, 0x127, 0x128, 0x129): e.w8(a + off, rnd.randint(0, 9))
        e.w8(a + 0x11b, rnd.choice([0, 0, 1]))
    if rnd.random() < 0.2:      # one member with a zero attribute
        e.w8(CH + 0x130 * rnd.randrange(n) + 0x14 + rnd.randrange(7), 0)
    sb(e, -0x104a, rnd.choice([0, 1, 2, 4, 5, 12, 12, 3]))
    sb(e, -0x1667, rnd.randint(0, 31)); sb(e, -0x1666, rnd.randint(0, 31)); sb(e, 0xdb9, rnd.randint(0, 3))
    for m in range(4): e.w8(g(-0xde) + 0x340 * m + 0x30e, rnd.choice([1] * 10 + [0, 0x40]))
    sb(e, -0x3305, rnd.choice([0, 1])); sb(e, -0x3307, rnd.choice([0, 0, 1]))
    sw(e, -0x1318, rnd.choice([0, 0, rnd.randint(1, 3), rnd.randint(1, 20), rnd.randint(1, 100), 0xffff]))
    sb(e, -0x32e1, rnd.choice([0, 1]))
    sl(e, SEED, rnd.getrandbits(32))
    return n

def gen_rest(n, rnd):
    e = Emu(); Rc = Rec(e); install_rest(e); out = []
    for _ in range(n):
        info = {}
        def setup(e):
            rest_state(e, rnd)
            e.walk[:] = [rnd.choice([0] * 11 + [1, 4])]; info['walk'] = list(e.walk)
            e.yn[:] = [rnd.choice([0, 1, 1])]; info['yn'] = list(e.yn)
            e.ticks[:] = [1 if (rnd.random() < 0.07) else 0 for _ in range(10)]; info['ticks'] = list(e.ticks)
        v = Rc.run(F_REST, (), setup)
        out.append({'args': [], **info, **v})
    return out
B.UNITS['rest'] = gen_rest
def mark_keep(out, sig):
    """committed subsets keep one vector per distinct path signature"""
    seen = set()
    for v in out:
        k = sig(v)
        if k not in seen: seen.add(k); v['keep'] = True
    return out
_gens = {}
def keepwrap(name, sig):
    f = B.UNITS[name]
    B.UNITS[name] = lambda n, rnd: mark_keep(f(n, rnd), sig)


# ---------------------------------------------------------------- item price OV7+0x3CC, price text OV7+0x7E0
OV7 = lambda off: OV_BASE[7] + off
F_PRICE, F_PRICE2 = OV7(0x3CC), OV7(0x7E0)
def item_slot(e, rnd, a, slot):
    ids = [rnd.randint(0, 0x49), rnd.randint(0, 0x52), 0x4b, 0x52, 0x4a, 0x4c, rnd.getrandbits(8)]
    e.w8(a + 0xdc + slot, rnd.choice(ids[:3] * 3 + ids))
    e.w8(a + 0xb6 + slot, rnd.choice([0, 1, 2, 3, 4, 5, rnd.randint(0, 255), rnd.randint(0, 8)]))
    e.w8(a + 0xa3 + slot, rnd.choice([0, rnd.randint(0, 63), rnd.randint(0, 255)]))
    e.w8(a + 0xc9 + slot, rnd.choice([0, rnd.randint(0, 63), rnd.randint(0, 255)]))
    e.w8(a + 0xef + slot, rnd.choice([0, 1, 2, rnd.randint(0, 15), rnd.randint(0, 255)]))
    e.w8(a + 0x90 + slot, rnd.choice([0, 0, 0x40, 0x80, 0xc0, rnd.randint(0, 63), rnd.getrandbits(8)]))
def price_args(rnd):
    mode = rnd.choice([1, 1, 2, 2, 3, 4, 5, 6, 0, 7, 9, rnd.getrandbits(16)])
    flags = rnd.choice([0, 1, 0x80, 0x81, 0x80 | rnd.randint(0, 15), rnd.randint(0, 15), rnd.randint(0x81, 0xff), rnd.getrandbits(16)])
    return mode, flags
def price_ok(e, a, slot, mode, flags):
    """skip the cases that read an uninitialised stack local (mode >= 7) """
    ids = e.r8(a + 0xdc + slot)
    if not (ids <= 0x49 or ids in (0x4b, 0x52)): return True
    return not (mode >= 7)           # modes >= 7 return the uninitialised stack local -0xC
def gen_price(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    while len(out) < n:
        slot = rnd.randrange(18); mode, flags = price_args(rnd); info = {}
        ci = rnd.randrange(8); a = CH + 0x130 * ci
        def setup(e):
            sl(e, SEED, rnd.getrandbits(32)); fill_char(e, rnd, a); item_slot(e, rnd, a, slot)
            if not price_ok(e, a, slot, mode, flags): raise SkipVec
        try: v = Rc.run(F_PRICE, ((a, 4), slot, mode, flags), setup, ret_bits=32)
        except (SkipVec, RuntimeError, ZeroDivisionError): continue
        out.append({'args': [ci, slot, mode, flags], **v})
    return out
class SkipVec(Exception): pass
def gen_price2(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e, skip=('13c10',)); out = []
    e.stub(OV7(0x5CC), 'name', fn=lambda e2, sp: e2.r32(sp + 6), argfn=lambda e2, sp: [e2.r16(sp + 4), ptr(e2, e2.r32(sp + 6)), e2.r16(sp + 10)])
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), ptr(e2, e2.r32(sp + 8)), ptr(e2, e2.r32(sp + 12)), e2.r32(sp + 16)])
    while len(out) < n:
        slot = rnd.randrange(18); mode, flags = price_args(rnd); sel = rnd.choice([0, 1, 2])
        ci = rnd.randrange(8); a = CH + 0x130 * ci
        def setup(e):
            sl(e, SEED, rnd.getrandbits(32)); fill_char(e, rnd, a); item_slot(e, rnd, a, slot)
            if not price_ok(e, a, slot, mode, flags): raise SkipVec
        try: v = Rc.run(F_PRICE2, ((a, 4), slot, mode, sel, flags), setup, ret_bits=32)
        except (SkipVec, RuntimeError, ZeroDivisionError): continue
        out.append({'args': [ci, slot, mode, sel, flags], **v})
    return out
B.UNITS['itemprice'] = gen_price; B.UNITS['itemprice2'] = gen_price2

# ---------------------------------------------------------------- training hall: eligibility OV5+0x1C70, level-up block OV5+0x1EEE
from rules2 import _trainchar
OV5 = lambda off: OV_BASE[5] + off
F_ELIG, F_LEVELUP = OV5(0x1C70), OV5(0x1EEE)
def gen_trainelig(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    NARGS = {0x1d20: 3, 0x1d46: 1, 0x1d67: 3}
    def sprintf(e2, sp):
        fmt = ptr(e2, e2.r32(sp + 4)); k = NARGS.get(fmt - (0x2000000 + 5 * 0x100000), 3)
        return [ptr(e2, e2.r32(sp)), fmt] + [e2.r32(sp + 8 + 4 * i) if i else ptr(e2, e2.r32(sp + 8)) for i in range(k)]
    e.stub(R(0x13C10), 'sprintf', argfn=sprintf)
    for _ in range(n):
        def setup(e):
            _trainchar(e, rnd); sb(e, -0x1665, rnd.randint(0, 120))
            for i in range(0x60): sb(e, -0x3afa + i, rnd.choice([rnd.randint(1, 30), 13, 20, 99, 255]))
            e.w8(CH + 0x23, rnd.choice([0, 1, 2, 5, 11, 12, 13, 19, 20, 30, rnd.randint(0, 255)]))
            if rnd.random() < 0.5: e.w32(CH + 0x12c, rnd.getrandbits(32))
        out.append({'args': [], **Rc.run(F_ELIG, ((CH, 4),), setup, ret_bits=32)})
    return out
def gen_levelup(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [e2.r32(sp), e2.r32(sp + 4), e2.r32(sp + 8)])
    e.stub(R(0xBEF6), 'msg', argfn=lambda e2, sp: [e2.r32(sp)])
    e.stub(OV4(0xB6F8), 'short', argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    e.stub(OV4(0xFE5C), 'clock', argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(OV4(0xB64A), 'b64a', argfn=lambda e2, sp: [e2.r16(sp)])
    for _ in range(n):
        info = {}
        idx = rnd.randrange(8); a = CH + 0x130 * idx
        def setup(e):
            e.heap = 0x600000
            _trainchar(e, rnd)
            if True:
                fill_char(e, rnd, a); e.w8(a + 0x23, rnd.choice([1, 2, 3, 5, 10, 11, 12, 13, 20, rnd.randint(0, 255)])); e.w8(a + 0x13, rnd.randint(0, 9))
                e.w32(a + 0x12c, rnd.choice([0, rnd.getrandbits(16), rnd.getrandbits(24), rnd.getrandbits(32)]))
                for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.85 else rnd.randint(1, 3))
                if rnd.random() < 0.3: e.w8(a + 0x7a, 0)
            for d in (-0x1308,): sl(e, d, rnd.choice([0, rnd.randint(0, 1000), rnd.randint(0, 100000), 10 * e.r8(a + 0x23) ** 2, 10 * e.r8(a + 0x23) ** 2 - 1, rnd.getrandbits(32)]))
            sl(e, SEED, rnd.getrandbits(32))
            base = e.alloc(0x40); info['frame'] = base
            for i in range(0x30): e.w8(base + i, rnd.choice([0, 0, 1]))
            info['d6'] = rnd.choice([0, 0, 0, 0, 1, rnd.randint(0, 1000)])
            info['a5'] = base + 0x30
        def regs():
            return {'A3': a, 'D5': idx, 'D6': info['d6'], 'A5': info['a5']}
        v = Rc.run(F_LEVELUP, (), setup, regs=regs, stops=(OV5(0x1E70), OV5(0x1FF2)))
        out.append({'args': [idx], **info, **v})
    return out
B.UNITS['trainelig'] = gen_trainelig; B.UNITS['levelup'] = gen_levelup

# ---------------------------------------------------------------- trap damage OV4+0xED8E, thievery skill OV4+0xE65C, per-step tick OV4+0x108EC
F_TRAP, F_THIEF, F_STEP = OV4(0xED8E), OV4(0xE65C), OV4(0x108EC)
def gen_trapdmg(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    for _ in range(n):
        dmg = rnd.choice([0, rnd.randint(0, 30), rnd.randint(0, 200), rnd.randint(0, 2000)]); kind = rnd.choice([0, 1, 2, 3, 4, 5, 6, 7] + [rnd.randint(0, 6)] * 3)
        tgt = rnd.choice([rnd.randint(0, 7), rnd.randint(0, 3), 0])
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 8)); sb(e, -0x1672, pn)
            sl(e, SEED, rnd.getrandbits(32)); sw(e, -0x1326, rnd.randint(1000, 1300))
            sb(e, 0x70e0, rnd.choice([0, 0, 1, 2, 2]))
            for d in (-0x1322, -0x1320, -0x131e, -0x131c): sw(e, d, rnd.choice([0, 0, rnd.randint(0, 30), rnd.randint(0, 300)]))
            for k in range(8):
                a = CH + 0x130 * k
                for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.8 else rnd.choice([1, 2, 3, 0xc, 0xd, 0xe, 0xf, rnd.randint(1, 12)]))
                e.w8(a + 0x103, rnd.choice([0, 0, rnd.randint(0, 20)]))
                e.w16(a + 0x126, rnd.choice([rnd.randint(1, 80), rnd.randint(-5, 400), 1]) & 0xffff)
            sw(e, 0x7158, rnd.choice([0, 1]))
        out.append({'args': [dmg, kind, tgt], **Rc.run(F_TRAP, (dmg, kind, tgt), setup)})
    return out
def gen_thief(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        def setup(e):
            fill_char(e, rnd, CH); sl(e, SEED, rnd.getrandbits(32))
            e.w8(CH + 0x13, rnd.randint(0, 9)); e.w8(CH + 0x11, rnd.randint(0, 5)); e.w8(CH + 0x27, rnd.choice([0, 1, 1, 2]))
            e.w8(CH + 0x23, rnd.choice([0, 1, 5, 20, rnd.randint(0, 255)]))
        out.append({'args': [], **Rc.run(F_THIEF, ((CH, 4),), setup, ret_bits=32)})
    return out
def gen_step(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    e.stub(OV4(0x10386), 'timepass', argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(R(0x98CA), 'monsterview', argfn=lambda e2, sp: [])
    for _ in range(n):
        def setup(e):
            sb(e, -0x3307, rnd.choice([0, 0, 0, 1])); sb(e, -0x3305, rnd.choice([0, 1])); sb(e, -0x32e0, rnd.choice([0, 1, 3]))
        out.append({'args': [], **Rc.run(F_STEP, (), setup)})
    return out
B.UNITS['trapdmg'] = gen_trapdmg; B.UNITS['thievery'] = gen_thief; B.UNITS['steptick'] = gen_step

callsig = lambda v: (tuple(c[0] for c in v['calls'])[:4], v.get('stop'), v['ret'] == 0 if 'ret' in v else 0)
keepwrap('rest', lambda v: (tuple(c[0] for c in v['calls'] if c[0] != 'redraw')[:3], tuple(c[1][2] for c in v['calls'] if c[0] == 'sprintf'), tuple(c[1][0] for c in v['calls'] if c[0] in ('msg', 'timepass'))))
keepwrap('itemprice', lambda v: (v['args'][2], v['ret'] == 0, v['args'][3] > 0x80))
keepwrap('itemprice2', lambda v: (v['args'][2] if v['args'][2] < 7 else 7, v['ret'] == 1))
keepwrap('trainelig', lambda v: v['calls'][0][1][1])
keepwrap('levelup', lambda v: (v['stop'], tuple(c[0] for c in v['calls'])))
keepwrap('trapdmg', lambda v: (v['args'][1], len(v['calls']) > 0))
keepwrap('thievery', lambda v: v['ret'] == 0)
keepwrap('steptick', lambda v: tuple(c[0] for c in v['calls']))

# ---------------------------------------------------------------- map object / monster loader OV4+0x14348(map)
F_LOADER = OV4(0x14348)
def gen_loader(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e, skip=('13c10', 'bef6', 'c934', '81a8', '5eb2'))
    e.files = []; e.loadlog = []
    def mkload(e2, sp):
        data = e2.files.pop(0)
        a = e2.alloc(len(data) + 16); e2.uc.mem_write(a, bytes(data))
        e2.w32(g(-0x1686), len(data)); e2.loadlog.append([a, len(data)])
        return a
    e.stub(R(0x5B68), 'load', fn=mkload, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x5C3A), 'loadtext', fn=mkload, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x81A8), 'free', argfn=lambda e2, sp: [])
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), ptr(e2, e2.r32(sp + 8)) if e2.r32(sp + 8) > 0x10000 else e2.r32(sp + 8)])
    e.handle = [0x1000]
    def res(e2, sp): e2.handle[0] += 1; return e2.handle[0]
    e.stub(R(0x5EB2), 'resource', fn=res, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(OV4(0x8158), 'ov4_8158', argfn=lambda e2, sp: [])
    out = []
    while len(out) < n:
        info = {}
        mp = rnd.choice([rnd.randint(0, 0x6f), rnd.randint(0, 0x42), 0x29, 0x2f, 0x38, 0x2d, 0x68, 0x69, 0x41, 0])
        def setup(e):
            e.heap = 0x600000; e.handle[0] = 0x1000; e.loadlog.clear()
            nm = rnd.choice([0, 1, 2, 3, 5, 9, 14])
            f1 = bytearray()
            for _ in range(nm):
                tb = rnd.choice([0, rnd.getrandbits(8), rnd.randint(0, 3), rnd.randint(4, 60) * 4 + rnd.randint(0, 3)])
                f1 += bytes([rnd.randint(0, 31), rnd.randint(0, 31), tb])
            f1 += b'\xff'
            names = [rnd.choice([0xff, rnd.randint(0, 0x4f), 0x2a, 0x2a]) for _ in range(5)]
            f1 += bytes(names)
            okk = [i for i in range(5) if names[i] != 0xff]       # an object kind must name a real entry: a 0xFF would index outside the DATA window
            for _ in range(rnd.choice([0, 1, 2, 4, 7]) if okk else 0):
                f1 += bytes([rnd.getrandbits(8), rnd.getrandbits(8), rnd.choice(okk)])
            f2 = bytes(rnd.getrandbits(8) for _ in range(rnd.choice([0, 12, 60, 400])))
            f3 = bytes(rnd.getrandbits(8) for _ in range(rnd.choice([0, 30, 300])))
            e.files[:] = [f1, f2, f3]; info['files'] = [list(f1), len(f2), len(f3)]
            sl(e, SEED, rnd.getrandbits(32)); sl(e, 0xcb6, 0); sl(e, 0xcba, 0xdead)
            # quest flag bits (A4-0x12fc) the special-map branches test
            for i in range(0x10): sb(e, -0x12fc + 0x40 // 8 * 0 + i * 0, e.r8(g(-0x12fc + i)))
            for i in range(0x20): sb(e, -0x12fc + i, rnd.choice([0, 0xff, rnd.getrandbits(8)]))
            info['f2'] = list(f2); info['f3'] = list(f3)
        try: v = Rc.run(F_LOADER, (mp,), setup, max_insn=3_000_000)
        except RuntimeError: continue
        out.append({'args': [mp], **info, 'loads': [list(x) for x in e.loadlog], **v})
    return out
B.UNITS['loader'] = gen_loader

# ---------------------------------------------------------------- the player's run command R+0x11ECC
from rules3 import battle_state, GRP
def gen_run(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    for _ in range(n):
        def setup(e):
            pn = battle_state(e, rnd); sl(e, SEED, rnd.getrandbits(32))
            groups = sum(1 for a in GRP[:3] if e.r8(g(a)))
            tot = pn + groups
            perm = list(range(tot)); rnd.shuffle(perm)
            for i in range(12): sb(e, 0x331e + i, perm[i] if i < tot else 0xff)
            order = list(range(8)); rnd.shuffle(order)
            for k in range(8): sb(e, -0xc81 + k, order[k])
            sb(e, -0x3309, rnd.randint(0, 7)); sb(e, -0x3308, rnd.choice([0, rnd.randint(0, 11), 0xff]))
            sb(e, 0xdb9, rnd.randint(0, 3))
            for m in range(4): e.w8(g(-0xde) + 0x340 * m + 0x307, rnd.choice([0, 1, 30, 50, 75, 100, rnd.getrandbits(8)]))
            for i in range(10): sw(e, 0x173a + 2 * i, rnd.randint(0, 89))
        out.append({'args': [], **Rc.run(R(0x11ECC), (), setup)})
    return out
B.UNITS['runcmd'] = gen_run
keepwrap('runcmd', lambda v: str(0x1f74 + 0x207ffe) in v['fin'])

UNITS = B.UNITS
if __name__ == '__main__':
    B.main()

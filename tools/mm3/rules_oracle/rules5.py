#!/usr/bin/env python3
"""MM3 rules vector generators, pass 5: character creation (overlay 6), ...  Same recorder/format as rules.py .. rules4.py.
Usage: rules5.py UNIT OUT.json [--n N] [--seed S]   |   rules5.py subset IN OUT.gz --n N"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE, DATA_BASE
from harness import Rec
import rules as B
from rules import g, sb, sw, sl, R, CH, fill_char, SEED
from rules3 import install_ui, quiet, OV4, OV8
from rules4 import ptr, keepwrap
from rules2 import party

OV6 = lambda off: OV_BASE[6] + off
OV7 = lambda off: OV_BASE[7] + off

# ---------------------------------------------------------------- class requirements OV6+0x48C(stats[7], out[10]) and roll OV6+0x5FE(stats[7], out[10])
F_CLASSREQ, F_ROLL = OV6(0x48C), OV6(0x5FE)
def gen_classreq2(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        info = {}
        def setup(e):
            e.heap = 0x600000
            st = e.alloc(16); fl = e.alloc(16); info['st'] = st; info['fl'] = fl
            mode = rnd.choice(['lo', 'edge', 'edge', 'any'])
            vals = [rnd.choice([rnd.randint(3, 24), rnd.randint(10, 16), rnd.randint(11, 16), 12, 13, 15]) if mode != 'any' else rnd.getrandbits(8) for _ in range(7)]
            if mode == 'edge':
                k = rnd.randrange(7); vals[k] = rnd.choice([11, 12, 13, 14, 15, 16])
            for i, v in enumerate(vals): e.w8(st + i, v)
            for i in range(16): e.w8(fl + i, rnd.getrandbits(8))
        # the pointers are only known after setup allocates: call with a deferred args list
        e.heap = 0x600000
        st0, fl0 = 0x600000, 0x600010                 # alloc is deterministic from heap=0x600000 (16-byte aligned)
        v = Rc.run(F_CLASSREQ, ((st0, 4), (fl0, 4)), setup)
        assert info['st'] == st0 and info['fl'] == fl0
        out.append({'args': [st0, fl0], **v})
    return out
def gen_roll(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        def setup(e):
            e.heap = 0x600000; st = e.alloc(16); fl = e.alloc(16)
            for i in range(7): e.w8(st + i, rnd.getrandbits(8))
            for i in range(16): e.w8(fl + i, rnd.getrandbits(8))
            sl(e, SEED, rnd.getrandbits(32))
        out.append({'args': [0x600000, 0x600010], **Rc.run(F_ROLL, ((0x600000, 4), (0x600010, 4)), setup)})
    return out
B.UNITS['classreq'] = gen_classreq2; B.UNITS['rollstats'] = gen_roll
keepwrap('classreq', lambda v: tuple(v['fin'].get(str(0x600010 + i), 0) for i in range(10)))
keepwrap('rollstats', lambda v: tuple(1 if str(0x600010 + i) in v['fin'] and v['fin'][str(0x600010 + i)] else 0 for i in range(10)))

# ---------------------------------------------------------------- build the character record OV6+0x1A0(class, race, align, sex, stats*, record*)
F_BUILD = OV6(0x1A0)
def gen_build(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    install_ui(e, skip=('13c10',))
    e.names = []; quiet(e, R(0x794C), '794c')
    def b5ce(e2, sp):
        nm = e2.names.pop(0) if e2.names else []
        p = e2.r32(sp)
        for i, c in enumerate(nm): e2.uc.mem_write(p + i, bytes([c]))
        return len(nm)
    e.stub(R(0xB5CE), 'name', fn=b5ce, argfn=lambda e2, sp: [e2.r16(sp + 4), e2.r16(sp + 6)])
    for _ in range(n):
        info = {}
        cls = rnd.choice([0xff] + list(range(10)) * 4 + [rnd.getrandbits(8)] if rnd.random() < 0.9 else [rnd.getrandbits(8)])
        race = rnd.choice(list(range(5)) * 2 + [rnd.getrandbits(5)])
        sex = rnd.randint(0, 1); al = rnd.choice([0, 1, 2, 2, 0xff, rnd.getrandbits(8)])
        def setup(e):
            e.heap = 0x600000; st = e.alloc(16); rec = e.alloc(0x130 + 16)
            info['st'] = st; info['rec'] = rec
            for i in range(7): e.w8(st + i, rnd.choice([rnd.randint(3, 24), rnd.getrandbits(8)]))
            for i in range(0x130 + 16): e.w8(rec + i, rnd.getrandbits(8))
            nm = [rnd.randint(0x41, 0x7a) for _ in range(rnd.choice([0, 1, 3, 9, 10]))]
            e.names[:] = [nm]; info['name'] = nm
            sl(e, SEED, rnd.getrandbits(32))
            sw(e, -0x1326, rnd.choice([rnd.randint(1000, 1300), rnd.randint(0, 20), rnd.getrandbits(16)]))
            sb(e, -0x1327, rnd.getrandbits(8)); sb(e, -0x1661, rnd.getrandbits(8))
        a0 = 0x600000; r0 = 0x600010           # alloc(16), then the record
        args = (cls << 8, race << 8, al << 8, sex << 8, (a0, 4), (r0, 4))
        v = Rc.run(F_BUILD, args, setup)
        assert info['st'] == a0 and info['rec'] == r0
        out.append({'args': [cls, race, al, sex, a0, r0], **info, **v})
    return out
B.UNITS['cbuild'] = gen_build
keepwrap('cbuild', lambda v: (v['args'][0] == 0xff or v['args'][2] == 0xff, v['ret'] == 0, v['args'][0] if v['args'][0] < 10 else 99))

# ---------------------------------------------------------------- map event: locked chest / trap gate + three reward actions OV4+0xE16E
F_EVENT = OV4(0xE16E)
KINDS = [4, 0xc, 0x12, 0x14, 0x17, 0x21, 0x26, 0x28]
def gen_event(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    install_ui(e, skip=('13c10', 'bef6'))
    quiet(e, OV4(0x13C2E), '13c2e', nargs=1)
    e.picks = []; e.cb = []
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), ptr(e2, e2.r32(sp + 8)) if e2.r32(sp + 8) > 0x10000 else e2.r32(sp + 8)])
    e.stub(R(0xBEF6), 'msg', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(OV4(0xC222), 'pick', fn=lambda e2, sp: e2.picks.pop(0) if e2.picks else 0, argfn=lambda e2, sp: [])
    e.stub(OV4(0xED8E), 'trap', argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    e.stub(R(0xB83A), 'itemgen', argfn=lambda e2, sp: [e2.r16(sp) >> 8, ptr(e2, e2.r32(sp + 2)), e2.r16(sp + 6)])
    e.stub(OV4(0xCB20), 'script', fn=lambda e2, sp: e2.cb.pop(0) if e2.cb else 0, argfn=lambda e2, sp: [e2.r16(sp), e2.r32(sp + 2), e2.r16(sp + 6), e2.r32(sp + 8), e2.r16(sp + 12)])
    while len(out) < n:
        info = {}
        codes = [0x15, 0x22, 0x23, 0x42, 0x43, 0x43, rnd.getrandbits(8), rnd.getrandbits(16)]
        acts = [(rnd.choice(codes), rnd.choice([0, 1, 5, rnd.getrandbits(8), rnd.getrandbits(16), rnd.getrandbits(32)])) for _ in range(3)]
        w3 = rnd.choice([0, 1, rnd.getrandbits(16)])
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 8)); sb(e, -0x1672, pn)
            sl(e, SEED, rnd.getrandbits(32))
            idx = rnd.randint(1, 5); info['idx'] = idx
            sb(e, -0x1044, idx if rnd.random() < 0.9 else 0)
            sb(e, 0x70e2, rnd.choice([0] * 8 + [1, 0xff]))
            for i in range(6): sw(e, -0x1046 + 12 * i, rnd.choice(KINDS + [0, rnd.getrandbits(16)])); sw(e, -0x1048 + 12 * i, rnd.getrandbits(16))
            mp = rnd.randint(0, 3); sb(e, 0xdb9, mp)
            for m in range(4):
                sb(e, -0xde + 0x340 * m + 0x31e, rnd.choice([0, 3, rnd.randint(0, 40), rnd.getrandbits(8)]))
                sb(e, -0xde + 0x340 * m + 0x312, rnd.choice([0, 1, 5, rnd.randint(10, 40), rnd.randint(15, 60), rnd.getrandbits(8)]))
            for k in range(8):
                a = CH + 0x130 * k
                e.w8(a + 0x27, rnd.choice([0, 1, 1])); e.w8(a + 0x23, rnd.randint(0, 40))
            e.picks[:] = [rnd.choice([rnd.randint(0, 7), rnd.randint(0, 3), 0xffff]) for _ in range(2)]; info['picks'] = list(e.picks)
            e.cb[:] = [rnd.choice([0, 0, 1]) for _ in range(3)]; info['cb'] = list(e.cb)
            sb(e, 0x709b, rnd.choice([0, 1, 5, 9, 10, 11, rnd.getrandbits(8)]))
            sl(e, 0x70a0, rnd.choice([0, rnd.getrandbits(16), rnd.getrandbits(32)])); sl(e, 0x709c, rnd.choice([0, rnd.getrandbits(16), rnd.getrandbits(32)]))
            for i in range(0x80): sb(e, 0x70a4 + i, rnd.getrandbits(8)) if i < 0x38 else None
            for i in range(0x100): sb(e, -0x2f8 + i, rnd.getrandbits(8))
        args = (acts[0][0], (acts[0][1], 4), acts[1][0], (acts[1][1], 4), acts[2][0], (acts[2][1], 4), w3)
        try: v = Rc.run(F_EVENT, args, setup)
        except RuntimeError: continue
        out.append({'args': [acts[0][0], acts[0][1], acts[1][0], acts[1][1], acts[2][0], acts[2][1], w3], **info, **v})
    return out
B.UNITS['event'] = gen_event
keepwrap('event', lambda v: (tuple(c[0] for c in v['calls'])[:5], v['ret'], str(0x70e2 + 0x207ffe) in v['fin']))

# ---------------------------------------------------------------- OV7 item command: shop flows entered mid-function (sell, repair, identify, buy, recharge, discard)
from rules4 import item_slot, OV7 as _OV7
SHOP_ENTRY = {'sell': 0x4506, 'repair': 0x45c4, 'identify': 0x462a, 'buy': 0x46ea, 'recharge': 0x47f6, 'discard': 0x4408, 'duplicate': 0x48a8}
SHOP_STOPS = (_OV7(0x4B7E), _OV7(0x3FFC))
SPRINTF_N = {0x858: 5, 0x4d10: 4, 0x4d95: 4, 0x4d5b: 4}
def gen_shop(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    install_ui(e, skip=('13c10', 'bef6', '81a8'))
    e.yn = []
    def sprintf(e2, sp):
        fmt = e2.r32(sp + 4) - OV_BASE[7]
        k = SPRINTF_N.get(fmt, 3)
        return [ptr(e2, e2.r32(sp + 4 * i)) for i in range(k)]
    e.stub(R(0x13C10), 'sprintf', argfn=sprintf)
    e.stub(R(0xBEF6), 'msg', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x8A40), 'yesno', fn=lambda e2, sp: e2.yn.pop(0) if e2.yn else 0, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), e2.r16(sp + 4)])
    e.stub(OV7(0x5CC), 'name', fn=lambda e2, sp: e2.r32(sp + 6), argfn=lambda e2, sp: [e2.r16(sp + 4), ptr(e2, e2.r32(sp + 6)), e2.r16(sp + 10)])
    e.stub(OV4(0xB6F8), 'short', argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    e.stub(OV4(0xF08A), 'remove', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), e2.r16(sp + 4)])
    e.stub(OV4(0xEFBA), 'refresh', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(OV7(0x4E08), 'identify', argfn=lambda e2, sp: [e2.r16(sp), ptr(e2, e2.r32(sp + 2))])
    ops = list(SHOP_ENTRY)
    for i in range(n):
        op = ops[i % len(ops)]
        info = {}
        ci = rnd.randrange(8); a = CH + 0x130 * ci
        bi = rnd.choice([k for k in range(8) if k != ci]); b = CH + 0x130 * bi
        slot = rnd.randrange(18); mode = rnd.choice([0, 1, 2, 2, 3, 4, 5, 6, 1, 2]) if op != 'discard' else rnd.choice([0, 1, 8, 8, 2])
        if op in ('sell',): mode = rnd.choice([1, 2, 2, 1, 3])
        def setup(e):
            e.heap = 0x600000
            sl(e, SEED, rnd.getrandbits(32)); fill_char(e, rnd, a); fill_char(e, rnd, b); item_slot(e, rnd, a, slot)
            if rnd.random() < 0.15: e.w8(a + 0xdc + slot, 0)
            if rnd.random() < 0.6 and op in ('sell', 'repair', 'identify', 'buy'): e.w8(a + 0xdc + slot, rnd.randint(1, 0x49) if rnd.random() < 0.9 else rnd.choice([0x4b, 0x52, 0x46, 0x47, 0x80]))
            if op == 'repair' and rnd.random() < 0.7: e.w8(a + 0x90 + slot, e.r8(a + 0x90 + slot) | 0x80)
            if op == 'duplicate':
                e.w8(a + 0xdc + slot, rnd.choice([rnd.randint(1, 0x4a), rnd.randint(1, 0x48), rnd.randint(1, 0x20)]))
                e.w8(a + 0xed, rnd.choice([0, 0, 0, 0, rnd.getrandbits(8)]))
                e.w8(a + 0xc9 + slot, rnd.choice([0, 0, 0, rnd.choice([9, 10, 17, 18, 25, 26, 33, 34, 39, 40, 45, 46, 50, 51, 56, 57, 61, 62, 71, 72]), rnd.randint(0, 80)]))
                e.w8(a + 0xa3 + slot, rnd.choice([0, 0, rnd.choice([7, 8, 14, 15, 19, 20, 24, 25, 32, 33, 36]), rnd.randint(0, 40)]))
                e.w8(a + 0xb6 + slot, rnd.choice([0, 1, 5, 0x11, 0x12, rnd.randint(0, 0x20)])); e.w8(a + 0xef + slot, rnd.choice([0, 1, 0x37, 0x38, rnd.randint(0, 0x60)]))
            e.w8(b + 0xed, rnd.choice([0, 0, 0, 1, rnd.getrandbits(8)])); e.w8(a + 0x2f, rnd.choice([0, 0, 1]))
            for off in (0xa1, 0xb4, 0xc7, 0xda, 0x100): e.w8(b + off, rnd.getrandbits(8))
            sl(e, 0x3270, b)
            for d in (-0x1308, -0x1310, -0x1304, -0x130c): sl(e, d, rnd.choice([0, 1, rnd.randint(0, 5000), rnd.randint(0, 100000), rnd.getrandbits(24)]))
            sw(e, -0x1318, rnd.randint(0, 1000))
            for i in range(16): e.w8(g(-0x55ce) + i, e.r8(g(-0x55ce) + i))
            e.yn[:] = [rnd.choice([0, 1, 1, 1])]; info['yn'] = list(e.yn)
            base = e.alloc(0x60); info['a5'] = base + 0x30
            for k in range(0x60): e.w8(base + k, rnd.getrandbits(8))
            e.w16(base + 0x30 + 0xc, rnd.choice([0, 1, 0x80, 0x81, rnd.randint(0, 15), rnd.randint(0x81, 0xff), 1]))
        def regs(): return {'A3': a, 'D5': slot, 'D7': mode, 'A5': info['a5']}
        try: v = Rc.run(SHOP_ENTRY_ADDR(op), (), setup, regs=regs, stops=SHOP_STOPS)
        except (RuntimeError, ZeroDivisionError): continue
        out.append({'args': [op, ci, bi, slot, mode], **info, **v})
    return out
def SHOP_ENTRY_ADDR(op): return _OV7(SHOP_ENTRY[op])
B.UNITS['shopop'] = gen_shop

# ---------------------------------------------------------------- OV7 item command, Enchant Item entry (0x4A7E): regenerates the item through the real generator
def gen_enchant(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    install_ui(e, skip=('13c10', 'bef6', '81a8'))
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), ptr(e2, e2.r32(sp + 8))])
    e.stub(R(0xBEF6), 'msg', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    for _ in range(n):
        info = {}
        ci = rnd.randrange(8); a = CH + 0x130 * ci; bi = rnd.randrange(8); b = CH + 0x130 * bi
        slot = rnd.randrange(18)
        def setup(e):
            e.heap = 0x600000
            sl(e, SEED, rnd.getrandbits(32)); fill_char(e, rnd, a)
            if bi != ci: fill_char(e, rnd, b)
            e.w8(a + 0xdc + slot, rnd.choice([0, rnd.randint(1, 0x47), rnd.randint(1, 0x47), rnd.randint(0x48, 0x60)]))
            for off in (0xa3, 0xb6, 0xc9, 0xef): e.w8(a + off + slot, rnd.choice([0, 0, 0, 0, 0, rnd.randint(0, 9)]))
            e.w8(a + 0x23, 0) if False else None
            e.w8(b + 0x23, rnd.choice([0, 1, 9, 10, 19, 20, 35, 60, rnd.randint(0, 255)])); e.w8(b + 0x24, rnd.choice([0, 0, 5]))
            sl(e, 0x3270, b)
            base = e.alloc(0x60); info['a5'] = base + 0x30
            for k in range(0x60): e.w8(base + k, rnd.getrandbits(8))
        def regs(): return {'A3': a, 'D5': slot, 'A5': info['a5']}
        v = Rc.run(_OV7(0x4A7E), (), setup, regs=regs, stops=SHOP_STOPS)
        out.append({'args': [ci, bi, slot], **info, **v})
    return out
B.UNITS['enchant'] = gen_enchant
keepwrap('enchant', lambda v: (tuple(c[0] for c in v['calls']),))
keepwrap('shopop', lambda v: (v['args'][0], tuple(c[0] for c in v['calls']), v.get('stop')))

# ---------------------------------------------------------------- damage to a monster OV4+0x136E2 with the REAL item generator R+0xB83A (pass 2 stubbed it)
import rules2 as _r2
B.UNITS['mondmgfull'] = lambda n, rnd: _r2.gen_mondmg(n, rnd, loot=False)
keepwrap('mondmgfull', lambda v: (v['args'][1], any(c[0] == 'loot' for c in v['calls']) or str(0x709b + 0x207ffe) in v['fin']))

# ---------------------------------------------------------------- encounter-start volley R+0xC5FA, weapon breaking R+0x122DE
F_VOLLEY, F_BREAK = R(0xC5FA), R(0x122DE)
def gen_volley(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.res = []
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp)), ptr(e2, e2.r32(sp + 4)), e2.r32(sp + 8)])
    e.stub(R(0x81A8), 'free', argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x5EB2), 'resource', fn=lambda e2, sp: e2.res.pop(0) if e2.res else 0, argfn=lambda e2, sp: [ptr(e2, e2.r32(sp))])
    e.stub(R(0x971C), 'cue', argfn=lambda e2, sp: [e2.r16(sp)])
    def redraw(e2, sp): e2.w32(g(0xdca), 0)
    e.stub(OV4(0), 'redraw', fn=redraw, argfn=lambda e2, sp: [])
    e.stub(R(0xA1DC), 'monturn', argfn=lambda e2, sp: [e2.r16(sp)])
    while len(out) < n:
        info = {}
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 8)); sb(e, -0x1672, pn)
            lst = [rnd.choice([0xff, 0xff, 0xff, rnd.randint(0, 89)]) for _ in range(36)]
            if all(x == 0xff for x in lst): lst[rnd.randrange(36)] = rnd.randint(0, 89)
            for i, v in enumerate(lst): sb(e, 0x1f4e + i, v)
            d5 = None
            for v in lst:
                if v == 0xff: continue
                d5 = e.r8(g(-0x53c8) + e.r8(g(-0x5d42) + v))
                if d5 != 0xc: break
            sw(e, 0x21f8, rnd.choice([d5, d5, rnd.getrandbits(16), 0xc]))
            sb(e, -0x104a, rnd.choice([0, 1, 2, 5, 5, 5]))
            sl(e, 0xdca, rnd.choice([0, 0, 0x600100])); sl(e, 0xc22, rnd.getrandbits(32)); sl(e, -0x1676, rnd.getrandbits(32))
            sw(e, -0x351a, rnd.choice([0, 0, 1])); sb(e, -0x33a9, rnd.getrandbits(8)); sb(e, -0x33aa, rnd.getrandbits(8)); sb(e, -0x3307, rnd.choice([0, 1]))
            e.res[:] = [rnd.choice([0, 0x600200, rnd.getrandbits(24)])]; info['res'] = list(e.res)
            for k in range(8):
                a = CH + 0x130 * k
                for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.7 else rnd.choice([1, 2, 8, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf]))
        v = Rc.run(F_VOLLEY, (), setup, regs={'D5': 0})
        out.append({'args': [], **info, **v})
    return out
B.UNITS['volley'] = gen_volley
keepwrap('volley', lambda v: (tuple(c[0] for c in v['calls'] if c[0] not in ('monturn',)), str(0x207ffe - 0x104a) in v['fin']))
def gen_break(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        def setup(e):
            fill_char(e, rnd, CH)
            for i in range(18):
                e.w8(CH + 0xdc + i, rnd.choice([0, rnd.randint(1, 0x1d), rnd.randint(0x1e, 0x50), 0x1d, 0x1e]))
                e.w8(CH + 0x7d + i, rnd.choice([0, 0, 1, 2, rnd.getrandbits(8)]))
        out.append({'args': [], **Rc.run(F_BREAK, ((CH, 4),), setup)})
    return out
B.UNITS['breakweapons'] = gen_break

UNITS = B.UNITS
if __name__ == '__main__':
    B.main()

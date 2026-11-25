#!/usr/bin/env python3
"""MM3 rules vector generators, pass 2 (monster turn, initiative, damage to a monster, loot).  Usage: rules2.py UNIT OUT.json [--n N] [--seed S]
Same recorder/format as rules.py; `rules.py subset IN OUT.gz --n N` writes the committed subsets."""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE
from harness import Rec
import rules as B
from rules import g, sb, sw, sl, R, CH, fill_char, setup_common, SEED

def party(e, rnd, n=None):
    """eight characters, party order table, counters."""
    n = rnd.choice([1, 2, 3, 4, 5, 6, 6, 7, 8, 8]) if n is None else n
    sb(e, 0x1f74, n)
    order = list(range(8)); rnd.shuffle(order)
    for i in range(8): sb(e, -0xc81 + i, order[i] if i < n or rnd.random() < 0.5 else rnd.randint(0, 7))
    for k in range(8):
        a = CH + 0x130 * k
        fill_char(e, rnd, a)
        for off in range(0x113, 0x123):
            e.w8(a + off, 0 if rnd.random() < 0.85 else rnd.randint(1, 3))
        if rnd.random() < 0.3:
            for off in (0x11b, 0x11e, 0x11f, 0x120, 0x121, 0x122): e.w8(a + off, 0)
        e.w8(a + 0x11b, rnd.choice([0, 0, 0, 0, 1]))
        if rnd.random() < 0.25: e.w8(a + 0x11f + rnd.randint(0, 3), rnd.randint(1, 2))
        if rnd.random() < 0.2: e.w8(a + 0x11e, 1)
        e.w8(a + 0x13, rnd.randint(0, 9)); e.w8(a + 0x11, rnd.randint(0, 5))
    if rnd.random() < 0.06:
        for k in range(8): e.w8(CH + 0x130 * k + 0x11f + rnd.randint(0, 3), 1)
    for i in range(8): sb(e, 0x1f76 + i, rnd.choice([0, 0, 1]))
    sw(e, -0x1326, rnd.randint(1000, 1300))
    for d in (-0x1322, -0x1320, -0x131e, -0x131c): sw(e, d, rnd.choice([0, rnd.randint(0, 30)]))
    return n

F_A1DC = R(0xA1DC); F_D1AE = R(0xD1AE)
def gen_monturn(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(B.F_MONATTACK, 'hit9E02', argfn=lambda e, sp: [e.r32(sp), e.r16(sp + 4), e.r16(sp + 6)])
    e.stub(B.F_UI971C, 'ui971c', argfn=lambda e, sp: [e.r16(sp)])
    e.stub(F_D1AE, 'end', argfn=lambda e, sp: [])
    for _ in range(n):
        mon = rnd.randint(0, 89)
        flag = rnd.choice([0, 1, 1])
        def setup(e):
            pn = party(e, rnd)
            sb(e, -0x33a9, flag); sb(e, -0x3307, 0); sb(e, -0x104a, rnd.choice([0, 2, 3, 5]))
            sb(e, 0x1f73, rnd.randint(1, 10)); sb(e, -0x1ba, rnd.randint(0, 10)); sb(e, -0x1b9, rnd.randint(0, 10))
            k = rnd.randint(0, 2)
            sb(e, -0x3309, pn + k)
            for i in range(10):
                sw(e, 0x188e + 2 * i, rnd.choice([0, 0, 0, 1, rnd.randint(2, 9)]))
                sw(e, 0x173a + 2 * i, rnd.randint(0, 89))
            if rnd.random() < 0.4: e.w16(g(0x188e) + 2 * (e.r8(g([0x1f73, -0x1ba, -0x1b9][k])) - 1), 0)
        v = Rc.run(F_A1DC, (mon,), setup)
        out.append({'args': [mon], **v})
    return out
B.UNITS['monturn'] = gen_monturn


F_INIT = OV_BASE[4] + 0x1307C
def gen_initiative(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        def setup(e):
            pn = party(e, rnd)
            sb(e, 0x1f73, rnd.choice([0, 0, rnd.randint(1, 10)])); sb(e, -0x1ba, rnd.choice([0, rnd.randint(1, 10)])); sb(e, -0x1b9, rnd.choice([0, rnd.randint(1, 10)]))
            for i in range(10): sw(e, 0x173a + 2 * i, rnd.randint(0, 89))
            for k in range(8):
                for s in (0x14 + 8, 0x15 + 8): pass
            for i in range(12): sb(e, 0x331e + i, rnd.choice([rnd.randint(0, 11), 0xff]))
            sb(e, -0x3308, rnd.choice([0xff, 0xff, rnd.randint(0, 11)]))
        out.append({'args': [], **Rc.run(F_INIT, (), setup)})
    return out
B.UNITS['initiative'] = gen_initiative

F_MDMG = OV_BASE[4] + 0x136E2
def loot_pattern(e, t, buf):
    for k, off in enumerate((0x90, 0xa3, 0xb6, 0xc9, 0xdc, 0xef)): e.w8(buf + off, (t * 7 + k * 13 + 1) & 0xff)
def gen_mondmg(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(B.F_UI971C, 'ui971c', argfn=lambda e, sp: [e.r16(sp)])
    e.stub(R(0x122DE), 'call122DE', argfn=lambda e, sp: [e.r32(sp)])
    e.stub(OV_BASE[4], 'ov4_0', argfn=lambda e, sp: [])
    e.stub(R(0xB83A), 'loot', argfn=lambda e, sp: [e.r8(sp), e.r32(sp + 2), e.r16(sp + 6)], fn=lambda e, sp: loot_pattern(e, e.r8(sp), e.r32(sp + 2)))
    for _ in range(n):
        mode = rnd.choice([0, 0, 0, 2, 3, 1, 4, 5, 6, rnd.randint(0, 9)])
        dmg = rnd.choice([0, rnd.randint(1, 20), rnd.randint(1, 120), rnd.randint(1, 600)])
        def setup(e):
            pn = party(e, rnd)
            setup_target(e, rnd)
            sb(e, -0x104a, rnd.choice([0, 1, 2, 2])); sb(e, -0x1672, rnd.randint(1, 6)); sb(e, 0x1f74, pn)
            t = rnd.randint(0, 9); sb(e, -0x3f2b, t)
            sw(e, 0x173a + 2 * t, rnd.choice([0x19, rnd.randint(0, 89), rnd.randint(0, 89)]))
            sw(e, 0x188e + 2 * t, rnd.choice([0, 7, 7, rnd.randint(0, 9)]))
            sw(e, 0x1492 + 2 * t, rnd.choice([rnd.randint(1, 60), rnd.randint(1, 300), 1]))
            sb(e, 0x715c, rnd.choice([rnd.randint(0, 11), rnd.randint(0, 11), 12, 13]))
            sw(e, 0x332e, rnd.choice([0, 0, 0xb, 0xd, 0xf, 0xc, rnd.randint(0, 40)]))
            for i in range(12): sb(e, 0x1e8c + i, rnd.getrandbits(8))
            sb(e, -0x1665, rnd.choice([0, 0, 0x6a]))
            sb(e, 0x709b, rnd.choice([0, 1, 5, 9, 10, 11]))
            sl(e, 0x70a0, rnd.getrandbits(rnd.choice([8, 20, 32]))); sl(e, 0x709c, rnd.getrandbits(rnd.choice([8, 20, 32])))
            sb(e, 0x1f73, rnd.choice([0, 0, rnd.randint(1, 10)]))
            for k in range(8):
                a = CH + 0x130 * k
                e.w32(a + 0x12c, rnd.choice([0, rnd.getrandbits(20), rnd.getrandbits(32)]))
            sb(e, -0x3305, 0)
        out.append({'args': [dmg, mode], **Rc.run(F_MDMG, ((CH, 4), dmg, mode), setup)})
    return out
B.UNITS['mondmg'] = gen_mondmg
B.UNITS['mondmg'] = gen_mondmg
from rules import setup_target
F_LOOT = R(0xB83A)
def gen_item(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    buf = g(-0x2f8)
    for _ in range(n):
        t = rnd.choice([0, 1, 2, 3, 4, 5, 6, 6, rnd.randint(0, 6)])
        slot = rnd.choice([0, 0, rnd.randint(0, 17)])
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            for k in range(0x130): e.w8(buf + k, rnd.getrandbits(8))
        out.append({'args': [t, slot], **Rc.run(F_LOOT, ((t << 8), (buf, 4), slot), setup)})
    return out
B.UNITS['item'] = gen_item
F_PAY = OV_BASE[8] + 0x534; F_REFUND = OV_BASE[8] + 0x5aa; F_BLOCK = OV_BASE[4] + 0xB840; F_PRICE = OV_BASE[4] + 0xF13E; F_SPSP = OV_BASE[4] + 0xF10C
def _spellstate(e, rnd):
    fill_char(e, rnd, CH)
    e.w16(CH + 0x128, rnd.choice([rnd.randint(0, 40), rnd.randint(0, 300), 0xfff0]))
    sl(e, -0x1304, rnd.choice([0, rnd.randint(0, 30), rnd.randint(0, 3000), rnd.getrandbits(32)]))
def gen_castpay(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        sp = rnd.choice([rnd.randint(0, 76), rnd.randint(0, 76), rnd.randint(0, 99)])
        v = Rc.run(F_PAY, ((CH, 4), sp), lambda e: _spellstate(e, rnd))
        out.append({'char': CH, 'args': [sp], **v})
    return out
def gen_castrefund(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        sp = rnd.randint(0, 99)
        out.append({'char': CH, 'args': [sp], **Rc.run(F_REFUND, ((CH, 4), sp), lambda e: _spellstate(e, rnd))})
    return out
def gen_castblock(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(R(0x13C10), 'sprintf', argfn=lambda e, sp: [e.r32(sp), e.r32(sp + 4), e.r32(sp + 8)], ret=0)
    e.stub(R(0xBEF6), 'msg', argfn=lambda e, sp: [e.r32(sp)])
    for _ in range(n):
        def setup(e):
            fill_char(e, rnd, CH)
            for off in range(0x113, 0x123): e.w8(CH + off, 0 if rnd.random() < 0.8 else rnd.randint(1, 3))
        out.append({'char': CH, 'args': [], **Rc.run(F_BLOCK, ((CH, 4),), setup)})
    return out
def gen_spellprice(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        sp = rnd.randint(0, 99); lv = rnd.choice([rnd.randint(0, 40), rnd.randint(0, 70), rnd.randint(-3, 3)])
        out.append({'args': [sp, lv], **Rc.run(F_PRICE, (sp, lv & 0xffff), None, ret_bits=32)})
    return out
def gen_spellsp(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n):
        sp = rnd.randint(0, 99); lv = rnd.choice([rnd.randint(0, 40), rnd.randint(0, 70), rnd.randint(-3, 3)])
        out.append({'args': [sp, lv], **Rc.run(F_SPSP, (sp, lv & 0xffff), None, ret_bits=32)})
    return out
B.UNITS['spellsp'] = gen_spellsp
B.UNITS['castpay'] = gen_castpay; B.UNITS['castrefund'] = gen_castrefund; B.UNITS['castblock'] = gen_castblock; B.UNITS['spellprice'] = gen_spellprice
F_THR = OV_BASE[4] + 0xB7EC; F_SHORT = R(0x88CA); F_PAY2 = R(0x8964)
def _trainchar(e, rnd):
    fill_char(e, rnd, CH)
    e.w8(CH + 0x23, rnd.choice([0, 1, 2, 3, 5, 11, 12, 13, 20, rnd.randint(0, 255)]))
    e.w8(CH + 0x13, rnd.randint(0, 9))
    e.w32(CH + 0x12c, rnd.choice([0, rnd.getrandbits(16), rnd.getrandbits(24), rnd.getrandbits(32)]))
def gen_levelthr(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n): out.append({'char': CH, 'args': [], **Rc.run(F_THR, ((CH, 4),), lambda e: _trainchar(e, rnd), ret_bits=32)})
    return out
def gen_shortfall(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for _ in range(n): out.append({'char': CH, 'args': [], **Rc.run(F_SHORT, ((CH, 4),), lambda e: _trainchar(e, rnd), ret_bits=32)})
    return out
def gen_pay(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    e.stub(OV_BASE[4] + 0xB6F8, 'short', argfn=lambda e, sp: [e.r16(sp), e.r16(sp + 2), e.r16(sp + 4)])
    for _ in range(n):
        kind = rnd.choice([0, 0, 1, 1, 2, 3]); bank = rnd.choice([0, 1])
        cost = rnd.choice([rnd.randint(0, 100), rnd.randint(0, 10000), rnd.getrandbits(32)])
        def setup(e):
            for d in (-0x1308, -0x1310, -0x1304, -0x130c): sl(e, d, rnd.choice([cost, cost - 1 if cost else 0, cost + 1, rnd.getrandbits(rnd.choice([8, 16, 32]))]) & 0xffffffff)
            sw(e, -0x1318, rnd.choice([cost & 0xffff, rnd.randint(0, 500), rnd.getrandbits(16)]))
        out.append({'args': [kind, cost, bank], **Rc.run(F_PAY2, (kind, (cost, 4), bank), setup)})
    return out
B.UNITS['levelthr'] = gen_levelthr; B.UNITS['shortfall'] = gen_shortfall; B.UNITS['pay'] = gen_pay
UNITS = B.UNITS
if __name__ == '__main__':
    B.main()

#!/usr/bin/env python3
"""MM3 rules vector generators, pass 3: the cast command / spell handlers (OV8), the combat spell engine.
Same recorder/format as rules.py / rules2.py.  Usage: rules3.py UNIT OUT.json [--n N] [--seed S]"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE
from harness import Rec
import rules as B
from rules import g, sb, sw, sl, R, CH, fill_char, SEED
from rules2 import party

OV8 = lambda off: OV_BASE[8] + off
OV4 = lambda off: OV_BASE[4] + off
F_CAST = OV8(0x252E)
SPELL_STORE = 0x7B

def quiet(e, addr, name, ret=0, nargs=0):
    e.stub(addr, name, ret=ret, nargs=nargs, quiet=True)
def logged(e, addr, name, nargs, ret=0, words=True):
    e.stub(addr, name, ret=ret, nargs=nargs)

# UI/animation/text leaves of the cast flow (root = R+, overlays = OVn+)
UI_QUIET = {'bfda': R(0xBFDA), 'bf7e': R(0xBF7E), 'bfae': R(0xBFAE), 'c038': R(0xC038), 'be2a': R(0xBE2A), 'c11e': R(0xC11E),
            'd1ae': R(0xD1AE), '188a': R(0x188A), '1b50': R(0x1B50), '945e': R(0x945E), '13c10': R(0x13C10), '81a8': R(0x81A8),
            'bef6': R(0xBEF6), '7940': R(0x7940), 'c934': R(0xC934), 'c166': R(0xC166)}
def install_ui(e, anim=0):
    for n, a in UI_QUIET.items(): quiet(e, a, n)
    quiet(e, R(0x5EB2), '5eb2', ret=anim)
    e.keys = []
    def keyfn(e2, sp):
        return e2.keys.pop(0) if e2.keys else 0x1b
    e.stub(R(0x6F46), 'key', fn=keyfn, argfn=lambda e2, sp: [], quiet=True)
    e.stub(R(0x971C), 'cue', argfn=lambda e2, sp: [e2.r16(sp)])
    for a, n in ((OV4(0), 'redraw'), (OV4(0x60), 'ov4_60'), (OV4(0x13E14), 'ov4_3e14')):
        e.stub(a, n, argfn=lambda e2, sp: [])


F_E6EA = OV4(0xE6EA); F_3DA = OV4(0x3DA)
def install_cast(e):
    """UI leaves quiet; logged: cue, engine E6EA (with the three combat-spell globals), the overlay UI leaves; pickers/menus are the real code driven by e.keys."""
    install_ui(e)
    e.nums = []
    rd16 = lambda e2, a: e2.r16(g(a))
    e.stub(F_E6EA, 'engine', argfn=lambda e2, sp: [e2.r16(sp), rd16(e2, 0x3330), rd16(e2, 0x332e), rd16(e2, 0x332c)])
    e.stub(OV7_F1C, 'ov7_f1c', argfn=lambda e2, sp: [e2.r32(sp), e2.r16(sp + 4)])
    e.stub(OV4(0x98B4), 'ov4_98b4', argfn=lambda e2, sp: [])
    e.stub(OV4(0x97E6), 'ov4_97e6', argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(F_FEA6, 'fea6', argfn=lambda e2, sp: [])
    def n3da(e2, sp): return e2.nums_3da.pop(0) if e2.nums_3da else 0
    e.nums_3da = []
    e.stub(F_3DA, 'walk', fn=n3da, argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    def nb6aa(e2, sp): return e2.nums.pop(0) if e2.nums else 0
    e.stub(R(0xB6AA), 'number', fn=nb6aa, argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2)])
OV7_F1C = OV_BASE[7] + 0xF1C
F_FEA6 = R(0xFEA6)

def cast_state(e, rnd, spell, mode=None, keys=None):
    n = rnd.choice([1, 2, 3, 4, 4, 5, 6, 6, 7, 8])
    party(e, rnd, n)
    sb(e, -0x1672, n); sb(e, 0x1f74, n)
    if rnd.random() < 0.8:      # mostly healthy party
        for k in range(8):
            for off in range(0x113, 0x123): e.w8(CH + 0x130 * k + off, 0 if rnd.random() < 0.93 else rnd.randint(1, 3))
    mode = rnd.choice([0, 0, 0, 0, 0, 2, 2, 2, 3, 4, 12]) if mode is None else mode
    sb(e, -0x104a, mode)
    k = rnd.randrange(n); sb(e, -0x3309, k)
    c = e.r8(g(-0xc81 + k)); a = CH + 0x130 * c
    e.w8(a + SPELL_STORE, spell)
    rich = rnd.random() < 0.8
    e.w16(a + 0x128, 20000 if rich else rnd.choice([rnd.randint(0, 40), rnd.randint(0, 300), 500]))
    e.w8(a + 0x23, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 60), rnd.randint(0, 255)]))
    sl(e, -0x1304, 100000 if rich else rnd.choice([0, rnd.randint(0, 30), rnd.randint(0, 3000), 100000]))
    for k2 in range(8):      # dead / stone / eradicated targets for the raise spells
        if rnd.random() < 0.25: e.w8(CH + 0x130 * k2 + rnd.choice([0x120, 0x121, 0x122, 0x11f]), rnd.randint(1, 3))
    for d in (0x3330, 0x332e, 0x332c): sw(e, d, rnd.getrandbits(16))
    sb(e, -0x3305, rnd.choice([0, 0, 1]))
    sb(e, 0xdb9, rnd.randint(0, 3))
    for m in range(4):
        for off in range(0x30e, 0x31a): e.w8(g(-0xde) + 0x340 * m + off, rnd.choice([1, 1, 1, 1, 1, 1, 0]))
    sb(e, -0x1660, rnd.choice([0, 1, 2])); sb(e, -0x165e, rnd.choice([0, 1, 2]))
    e.keys = list(keys) if keys is not None else []
    return c

def rand_keys(rnd, n):
    pool = [0x1b, 0, 1, 2, 3, 0x41, 0x43, 0x45, 0x46, 0x52, 0x53] + [0xc9 + i for i in range(n + 2)] * 3 + [0x31, 0x20]
    ks = [rnd.choice(pool) for _ in range(rnd.randint(1, 4))]
    if rnd.random() < 0.6: ks.insert(0, rnd.choice([0xc9 + i for i in range(n)] + [0, 1, 2, 3, 0x52, 0x53, 0x41, 0x43, 0x45, 0x46]))
    return ks

def gen_cast(n, rnd, spells=None):
    e = Emu(); Rc = Rec(e); install_cast(e); out = []
    for i in range(n):
        spell = rnd.choice(spells) if spells else (i % 77 if rnd.random() < 0.8 else rnd.choice([rnd.randint(0, 255), 0x4d, 0xff]))
        info = {}
        def setup(e):
            nn = 4
            cast_state(e, rnd, spell, keys=rand_keys(rnd, rnd.randint(1, 8)))
            info['keys'] = list(e.keys)
            e.nums[:] = [rnd.choice([0, rnd.randint(0, 5), rnd.randint(1, 5), rnd.randint(0, 9), rnd.randint(1, 300)]) for _ in range(3)]; info['nums'] = list(e.nums)
            e.nums_3da[:] = [rnd.choice([0, 0x1111, 0x7777, 0x70]) for _ in range(4)]; info['walk'] = list(e.nums_3da)
        v = Rc.run(F_CAST, (1,), setup)
        out.append({'args': [spell], **info, **v})
    seen = set()                              # committed subsets keep one successful cast and one refusal per spell
    for v in out:
        k = (v['args'][0], v.get('ret'))
        if k not in seen: seen.add(k); v['keep'] = True
    return out

F_3282 = OV4(0x13282)
ANIM_HANDLE = 0x1234
def install_engine(e):
    install_ui(e, ANIM_HANDLE)
    e.nums_3da = []
    def n3da(e2, sp): return e2.nums_3da.pop(0) if e2.nums_3da else 0
    e.stub(F_3DA, 'walk', fn=n3da, argfn=lambda e2, sp: [e2.r16(sp), e2.r16(sp + 2), e2.r16(sp + 4)])
    e.stub(F_3282, 'hit', argfn=lambda e2, sp: [e2.r32(sp), e2.r16(sp + 4), e2.r8(g(-0x3f2b))])
GRP = [0x1f73, -0x1ba, -0x1b9, 0x3264, 0x3259, 0x3252, 0x3261, 0x3258, 0x3251, 0x325e, 0x3255, 0x3250]
def gen_engine(n, rnd):
    e = Emu(); Rc = Rec(e); install_engine(e); out = []
    for _ in range(n):
        arg = rnd.choice([0xb, 0xb, 0xe, 0xd, 5, 0, 8, 0xa, 3, rnd.randint(0, 30)])
        info = {}
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 6)); sb(e, -0x1672, pn); sb(e, 0x1f74, pn)
            for k in range(8):
                for off in range(0x113, 0x123): e.w8(CH + 0x130 * k + off, 0 if rnd.random() < 0.9 else rnd.randint(1, 3))
                for i in range(18):
                    e.w8(CH + 0x130 * k + 0xdc + i, rnd.choice([0, 0x1e, 0x1f, 0x20, 0x21, rnd.getrandbits(8)]))
                    e.w8(CH + 0x130 * k + 0x7d + i, rnd.choice([0, 0, 1, 5]))
            for a in GRP: sb(e, a, rnd.choice([0, 0, rnd.randint(1, 10)]))
            sb(e, 0x715c, rnd.randint(0, 12)); sb(e, -0x3f2b, rnd.choice([0xff, rnd.randint(0, 9)]))
            sw(e, 0x332e, rnd.choice([0, 0, 1, 3, 7])); sw(e, 0x332c, rnd.choice([0, 1, 2, 2, 3])); sw(e, 0x3330, rnd.getrandbits(16))
            sl(e, 0xdca, rnd.choice([0, 0, 0x5555])); sw(e, 0x21f8, rnd.choice([arg, arg, rnd.randint(0, 30)])); sl(e, 0xc22, rnd.choice([0, 0x777]))
            for i in range(8): sb(e, 0x21e8 + i, rnd.choice([0, 1]))
            sb(e, -0x1667, rnd.getrandbits(8)); sb(e, -0x1666, rnd.getrandbits(8)); sb(e, 0xdb9, rnd.randint(0, 3))
            for i in range(8): sb(e, 0x3332 + i, rnd.choice([0, 1]))
            e.nums_3da[:] = [rnd.choice([0, 0, 0x1111, 0x70, 0x7777])]; info['walk'] = list(e.nums_3da)
        v = Rc.run(F_E6EA, (arg,), setup)
        out.append({'args': [arg], **info, **v})
    return out
B.UNITS['engine'] = gen_engine


def gen_spellhit(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    e.stub(OV4(0x136E2), 'apply136E2', argfn=lambda e2, sp: [e2.r32(sp), e2.r16(sp + 4), e2.r16(sp + 6)])
    e.stub(OV4(0x1307C), 'call1307C', argfn=lambda e2, sp: [])
    for _ in range(n):
        mode = rnd.choice([1, 1, 1, 1, 3, 2])
        ci = rnd.randrange(8); a = CH + 0x130 * ci
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 6)); sb(e, -0x1672, pn); sb(e, 0x1f74, pn)
            sl(e, 0x3270, a); e.w8(a + 0x23, rnd.randint(1, 40))
            B.setup_target(e, rnd); sb(e, -0x3f2b, rnd.choice([rnd.randint(0, 9), rnd.randint(0, 9), rnd.randint(0, 9), 0xff]))
            for i in range(10):
                sw(e, 0x173a + 2 * i, rnd.choice([rnd.randint(0, 89), rnd.choice([0, 1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 80, 89])]))
                sw(e, 0x1492 + 2 * i, rnd.choice([rnd.randint(1, 40), rnd.randint(1, 600), 1, 0xffff]))
                sw(e, 0x188e + 2 * i, rnd.choice([0, 0, 0, rnd.randint(1, 9)]))
            arrow = rnd.random() < 0.2
            sw(e, 0x332a, 1 if arrow else rnd.choice([0, 0, 2]))
            dmg = rnd.choice([0, 0, 0, rnd.randint(1, 500)])
            sw(e, 0x3330, dmg)
            sw(e, 0x332e, rnd.randint(7, 16) if dmg == 0 else rnd.randint(0, 16))
            sw(e, 0x330c, rnd.getrandbits(16))
            for i in range(8): sb(e, 0x21e8 + i, rnd.choice([0, 1, 1])); sb(e, 0x3332 + i, rnd.choice([0, 0, 1]))
            for k in range(8):
                for i in range(18): e.w8(CH + 0x130 * k + 0x7d + i, rnd.choice([0, 1, 13, 4, 4, 2]))
        out.append({'args': [mode], 'caster': a, **Rc.run(F_3282, ((a, 4), mode), setup)})
    return out
B.UNITS['spellhit'] = gen_spellhit


F_C7F8, F_12150, F_12276, F_1220A, F_11FA0 = R(0xC7F8), R(0x12150), R(0x12276), R(0x12206), R(0x11FA0)
def battle_state(e, rnd):
    pn = party(e, rnd, rnd.randint(1, 8)); sb(e, -0x1672, pn); sb(e, 0x1f74, pn)
    for k in range(8):
        for off in range(0x113, 0x123): e.w8(CH + 0x130 * k + off, 0 if rnd.random() < 0.6 else rnd.randint(1, 3))
        if rnd.random() < 0.3: e.w8(CH + 0x130 * k + rnd.randint(0x113, 0x122), rnd.randint(1, 3))
    for a in GRP[:3]: sb(e, a, rnd.choice([0, 0, rnd.randint(1, 10)]))
    sb(e, -0x104a, rnd.choice([2, 2, 2, 0, 5]))
    sb(e, -0x3307, rnd.choice([0, 1]))
    for i in range(12): sb(e, 0x3312 + i, rnd.choice([0, 0, 1]))
    return pn
def gen_wipecheck(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    for _ in range(n): out.append({'args': [], **Rc.run(F_C7F8, (), lambda e: battle_state(e, rnd))})
    return out
def gen_roundover(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    for _ in range(n): out.append({'args': [], **Rc.run(F_12150, (), lambda e: battle_state(e, rnd))})
    return out
def gen_alldown(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    def st(e):
        pn = battle_state(e, rnd)
        if rnd.random() < 0.5:
            for k in range(8):
                for off in range(0x113, 0x123): e.w8(CH + 0x130 * k + off, 0)
                if rnd.random() < 0.8: e.w8(CH + 0x130 * k + rnd.choice([8, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf]) + 0x113, rnd.randint(1, 3))
    for _ in range(n): out.append({'args': [], **Rc.run(F_12276, (), st)})
    return out
def gen_compact(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    def st(e):
        battle_state(e, rnd)
        for i in range(8): sb(e, -0xc81 + i, rnd.choice([0xff, 0xff, rnd.randint(0, 7)]))
    for _ in range(n): out.append({'args': [], **Rc.run(F_1220A, (), st)})
    return out
def gen_roundloop(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    e.wipe = []
    def a1dc(e2, sp):
        if e2.wipe: e2.w8(g(-0x3307), e2.wipe.pop(0))
    e.stub(F_A1DC_, 'monsterTurn', fn=a1dc, argfn=lambda e2, sp: [e2.r16(sp)])
    e.stub(R(0xC166), 'command', argfn=lambda e2, sp: [e2.r16(sp)])
    for _ in range(n):
        info = {}
        def setup(e):
            pn = battle_state(e, rnd)
            groups = sum(1 for a in GRP[:3] if e.r8(g(a)))
            tot = pn + groups
            for i in range(12): sb(e, 0x331e + i, rnd.choice([rnd.randint(0, max(0, tot - 1)), rnd.randint(0, 11), 0xff]) if i < tot else 0xff)
            # a valid permutation most of the time
            if rnd.random() < 0.8:
                perm = list(range(tot)); rnd.shuffle(perm)
                for i in range(12): sb(e, 0x331e + i, perm[i] if i < tot else 0xff)
            sb(e, -0x3308, rnd.choice([0xff, 0xff, rnd.randint(0, max(0, tot - 1)), 0x7f]))
            sb(e, -0x3309, rnd.choice([0xff, rnd.randint(0, max(0, tot - 1))]))
            for i in range(10): sw(e, 0x173a + 2 * i, rnd.randint(0, 89))
            for k in range(8): sb(e, -0xc81 + k, rnd.randint(0, 7)) if rnd.random() < 0.7 else None
            if rnd.random() < 0.9:
                order = list(range(8)); rnd.shuffle(order)
                for k in range(8): sb(e, -0xc81 + k, order[k])
            if rnd.random() < 0.6:       # a fresh, healthy battle
                sb(e, -0x104a, 2); sb(e, -0x3307, 0)
                if e.r8(g(0x1f73)) == 0 and e.r8(g(-0x1ba)) == 0 and e.r8(g(-0x1b9)) == 0: sb(e, 0x1f73, rnd.randint(1, 10))
                for k in range(8):
                    for off in range(0x113, 0x123): e.w8(CH + 0x130 * k + off, 0 if rnd.random() < 0.9 else rnd.randint(1, 3))
                tot2 = e.r8(g(0x1f74)) + sum(1 for a in GRP[:3] if e.r8(g(a)))
                perm = list(range(tot2)); rnd.shuffle(perm)
                for i in range(12): sb(e, 0x331e + i, perm[i] if i < tot2 else 0xff)
                for i in range(12): sb(e, 0x3312 + i, 0 if rnd.random() < 0.7 else 1)
                sb(e, -0x3309, rnd.choice([0xff, 0xff, rnd.randint(0, max(0, tot2 - 1))])); sb(e, -0x3308, rnd.choice([0xff, rnd.randint(0, max(0, tot2 - 1))]))
            e.wipe[:] = [rnd.choice([0, 0, 0, 1]) for _ in range(6)]; info['wipe'] = list(e.wipe)
        try: v = Rc.run(F_11FA0, (), setup, max_insn=40000)
        except RuntimeError: continue          # an inconsistent random state that loops forever in the game
        out.append({'args': [], **info, **v})
    return out
F_A1DC_ = R(0xA1DC)
B.UNITS['wipecheck'] = gen_wipecheck; B.UNITS['roundover'] = gen_roundover; B.UNITS['alldown'] = gen_alldown
B.UNITS['compact'] = gen_compact; B.UNITS['roundloop'] = gen_roundloop


F_CLOCK = OV4(0xFE5C); F_INTEREST = OV4(0xC9D4)
def gen_clock(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    e.stub(R(0xC8D2), 'flag', argfn=lambda e2, sp: [e2.r32(sp), e2.r16(sp + 4), e2.r16(sp + 6)])
    e.stub(R(0xC1E6), 'mapreset', argfn=lambda e2, sp: [])
    e.stub(OV4(0xC704), 'c704', argfn=lambda e2, sp: [])
    e.stub(OV4(0xB64A), 'b64a', argfn=lambda e2, sp: [e2.r16(sp)])
    for _ in range(n):
        minutes = rnd.choice([0, 1, 30, 0x12c, 0x5a0, 0x5a1, 0xb40, rnd.randint(0, 3000), rnd.randint(0, 0x7fff), rnd.getrandbits(16)])
        def setup(e):
            sw(e, -0x131a, rnd.choice([0, rnd.randint(0, 0x5a0), rnd.randint(0, 0x700), rnd.getrandbits(16)]))
            sb(e, -0x1327, rnd.choice([rnd.randint(0, 99), 99, 98, 0, rnd.randint(0, 255)]))
            sw(e, -0x1326, rnd.randint(1000, 1300)); sb(e, -0x33a7, rnd.choice([0, 0, 1]))
            sb(e, -0x104a, rnd.choice([0, 2, 9, 9, 3])); sw(e, 0x7158, rnd.choice([0, 1]))
            sl(e, -0x1310, rnd.choice([0, rnd.randint(0, 100000), rnd.getrandbits(32)])); sl(e, -0x130c, rnd.choice([0, rnd.randint(0, 5000), rnd.getrandbits(32)]))
        out.append({'args': [minutes], **Rc.run(F_CLOCK, (minutes,), setup)})
    return out
def gen_interest(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    for _ in range(n):
        def setup(e):
            sl(e, -0x1310, rnd.choice([0, rnd.randint(0, 100000), rnd.getrandbits(32), 99, 100, 199])); sl(e, -0x130c, rnd.choice([0, rnd.randint(0, 5000), rnd.getrandbits(32), 99, 100]))
        out.append({'args': [], **Rc.run(F_INTEREST, (), setup)})
    return out
B.UNITS['clock'] = gen_clock; B.UNITS['interest'] = gen_interest


F_TIMEPASS = OV4(0x10386)
def gen_timepasses(n, rnd):
    e = Emu(); Rc = Rec(e); install_ui(e); out = []
    e.stub(R(0xC8D2), 'flag', argfn=lambda e2, sp: [e2.r32(sp), e2.r16(sp + 4), e2.r16(sp + 6)])
    e.stub(R(0xC1E6), 'mapreset', argfn=lambda e2, sp: [])
    e.stub(OV4(0xC704), 'c704', argfn=lambda e2, sp: [])
    e.stub(OV4(0xB64A), 'b64a', argfn=lambda e2, sp: [e2.r16(sp)])
    e.ret10346 = [0]
    e.stub(OV4(0x10346), 'f10346', fn=lambda e2, sp: e2.ret10346[0], argfn=lambda e2, sp: [])
    e.stub(OV4(0xBFB2), 'bfb2', argfn=lambda e2, sp: [e2.r16(sp)])
    e.resist = []
    e.stub(OV4(0x82DC), 'save', fn=lambda e2, sp: (e2.resist.pop(0) if e2.resist else 0), argfn=lambda e2, sp: [(e2.r32(sp) - CH) // 0x130, e2.r16(sp + 4)])
    for _ in range(n):
        minutes = rnd.choice([0, 1, 30, 0x12c, 0x1e0, 0x1e0, 0x5a0, 0x17c, 0x1d6, rnd.randint(0, 3000), rnd.randint(0, 0x7fff), rnd.getrandbits(16)])
        info = {}
        def setup(e):
            pn = party(e, rnd, rnd.randint(1, 8)); sb(e, -0x1672, pn)
            for k in range(8):
                a = CH + 0x130 * k
                for off in range(0x113, 0x123): e.w8(a + off, 0 if rnd.random() < 0.65 else rnd.choice([1, 2, 3, 5, 9, 10, 11, 0x40, 0x80, 0xff, rnd.getrandbits(8)]))
                if rnd.random() < 0.5:
                    for off in (0x120, 0x121, 0x122): e.w8(a + off, 0)
                if rnd.random() < 0.15: e.w8(a + 0x14 + rnd.randint(0, 6), 0)
            sw(e, -0x131a, rnd.choice([0, rnd.randint(0, 0x5a0), rnd.randint(0, 0x700), rnd.getrandbits(16), 0x1df, 0x1e0]))
            sb(e, -0x1327, rnd.randint(0, 99)); sw(e, -0x1326, rnd.randint(1000, 1300)); sb(e, -0x33a7, rnd.choice([0, 1]))
            sb(e, -0x104a, rnd.choice([0, 2, 9])); sw(e, 0x7158, rnd.choice([0, 1])); sb(e, 0x715e, rnd.choice([0, 1])); sb(e, -0x1665, rnd.randint(0, 120))
            sl(e, -0x1310, rnd.randint(0, 100000)); sl(e, -0x130c, rnd.randint(0, 5000))
            e.ret10346[0] = rnd.choice([0, 1, 1]); info['r10346'] = e.ret10346[0]
            e.resist[:] = [rnd.choice([0, 1]) for _ in range(64)]; info['resist'] = list(e.resist)
            sl(e, SEED, rnd.getrandbits(32))
        v = Rc.run(F_TIMEPASS, (minutes,), setup)
        out.append({'args': [minutes], **info, **v})
    return out
B.UNITS['timepasses'] = gen_timepasses

B.UNITS['cast'] = gen_cast
UNITS = B.UNITS
if __name__ == '__main__':
    B.main()

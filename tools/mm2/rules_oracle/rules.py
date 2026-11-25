#!/usr/bin/env python3
"""MM2 rules vector generators.  Usage: rules.py UNIT OUT.json [--n N] [--seed S]
Units: rng, monunpack, ...  Big sets go to tools/mm2/rules_oracle/generated/
(gitignored); `subset IN OUT --n N` writes a small committed subset."""
import json, os, random, sys, gzip
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, HEAP, REPO
from harness import Rec

def g(d): return A4V + d
def sb(e, d, v): e.w8(g(d), v)
def sw(e, d, v): e.w16(g(d), v)
def sl(e, d, v): e.w32(g(d), v)

SEED = -24802
F_RAND16, F_SRAND, F_RANDR = 0x24048, 0x2407C, 0x22BC6
F_MONUNPACK = 0x4C8E
LAB_03F1 = 0x64F8   # UI message routine (stubbed by the spell-gate vectors); see lab.sh
P_MONBUF = -30658

def mondata():
    p = os.path.join(REPO, 'data', 'mm2', 'amiga', 'data', 'monsters.dat')
    return open(p, 'rb').read()

def gen_rng(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32) if i % 7 else rnd.choice([0, 1, 0xffffffff, 0x7fff, 0x80000000])
        kind = rnd.choice(['r16', 'srand', 'range', 'range', 'range'])
        if kind == 'r16':
            v = R.run(F_RAND16, (), lambda e: sl(e, SEED, seed))
            out.append({'kind': kind, 'args': [], **v})
        elif kind == 'srand':
            w = rnd.getrandbits(16)
            v = R.run(F_SRAND, (w,), lambda e: sl(e, SEED, seed))
            out.append({'kind': kind, 'args': [w], **v})
        else:
            if rnd.random() < 0.15:
                lo = rnd.randint(-5, 50); hi = lo - rnd.randint(0, 3)      # hi <= lo
            else:
                lo = rnd.choice([0, 1, 1, 1, rnd.randint(-20, 300)])
                hi = lo + rnd.choice([0, 1, 2, 3, 5, 9, 19, 99, 1008, rnd.randint(0, 3000)])
            v = R.run(F_RANDR, (lo & 0xffff, hi & 0xffff), lambda e: sl(e, SEED, seed))
            out.append({'kind': kind, 'args': [lo, hi], **v})
    # directed: seeds whose first draw is near 0x7FFF so k-truncation yields hi+1
    def first(sd): return (((sd * 0x41c64e6d + 0x3039) & 0xffffffff) >> 16) & 0x7fff
    found = 0
    while found < 8:
        sd = rnd.getrandbits(32)
        if first(sd) >= 32760:
            lo, hi = rnd.choice([(1, 10), (1, 6), (1, 100), (0, 9), (1, 20)])
            v = R.run(F_RANDR, (lo, hi), lambda e: sl(e, SEED, sd))
            out.append({'kind': 'range', 'args': [lo, hi], 'keep': True, **v}); found += 1
    return out

def gen_monunpack(n, rnd):
    n_syn = n
    e = Emu(); R = Rec(e); md = mondata(); out = []
    e.uc.mem_write(HEAP, md)
    for mid in range(256):
        slot = rnd.randint(0, 10)
        def setup(e, mid=mid, slot=slot):
            sl(e, P_MONBUF, HEAP); sb(e, -4574 + slot, mid)
            # poison the destination so the routine's own clearing is observable
            for d in range(-4562, -4562 + 0x38): sb(e, d, rnd.getrandbits(8))
        v = R.run(F_MONUNPACK, (slot,), setup, max_insn=200000)
        out.append({'id': mid, 'slot': slot, **v})
    # synthetic records (random bytes) exercise the x10 cap / byte truncation that retail never hits
    for i in range(n_syn):
        mid = rnd.randint(0, 255); slot = rnd.randint(0, 10)
        rec = bytes(rnd.getrandbits(8) for _ in range(26))
        def setup(e, mid=mid, slot=slot, rec=rec):
            e.uc.mem_write(HEAP + mid * 26, rec)
            sl(e, P_MONBUF, HEAP); sb(e, -4574 + slot, mid)
            for d in range(-4562, -4562 + 0x38): sb(e, d, rnd.getrandbits(8))
        v = R.run(F_MONUNPACK, (slot,), setup, max_insn=200000)
        out.append({'id': mid, 'slot': slot, 'synthetic': True, **v})
        e.uc.mem_write(HEAP + mid * 26, md[mid * 26:mid * 26 + 26])
    return out

P_CHARIDX, P_MONSLOT = -1272, -1271
def setup_party(e, rnd, size=None):
    """party table (A4-31082, u16 roster index per slot), size words at -31066, roster at A4-10814 (130 B each)"""
    size = size or rnd.randint(1, 6)
    sw(e, -31066, size)
    for i in range(8): sw(e, -31082 + 2 * i, 0xffff)
    idxs = rnd.sample(range(48), size)
    for i, r in enumerate(idxs): sw(e, -31082 + 2 * i, r)
    return idxs

def gen_melee(n, rnd):
    e = Emu(); R = Rec(e); out = []
    e.stub(0xFF42, 'applyHit', argfn=lambda e: [e.r16(g(-3852)), e.r8(g(-24113))], nargs=0)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            idxs = setup_party(e, rnd)
            ci = rnd.randrange(len(idxs)); sb(e, P_CHARIDX, ci)
            ac = rnd.choice([rnd.randint(0, 30), rnd.randint(0, 80), rnd.randint(0, 255)])
            e.w8(g(-10814) + idxs[ci] * 130 + 36, ac)
            slot = rnd.randint(0, 10); sb(e, P_MONSLOT, slot)
            sb(e, -4574 + slot, rnd.choice([rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 40)]))
            sb(e, -4530, rnd.choice([1, 1, 2, 3, 4, rnd.randint(0, 12)]))
            sb(e, -4531, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 250), rnd.randint(1, 60)]))
            sb(e, -1305 + slot, rnd.choice([0, 0, 4, 8, 12, rnd.getrandbits(8)]))
            sw(e, -3852, rnd.getrandbits(16)); sb(e, -24113, rnd.getrandbits(8))
        v = R.run(0x10478, (), setup)
        out.append({'seed': seed, **v})
    return out

def gen_bonus(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for v in range(256):
        out.append({'arg': v, **R.run(0x4442, (v,), None)})
    return out

def charsetup(e, rnd, ptr=None):
    """random character record in roster slot 0; returns its absolute address"""
    a = ptr or (g(-10814) + rnd.randint(0, 47) * 130)
    for i in range(130): e.w8(a + i, rnd.getrandbits(8))
    return a

def gen_luck(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            a = charsetup(e, rnd)
            setup.a = a
            e.w8(a + 32, rnd.choice([1, rnd.randint(1, 30), rnd.randint(1, 255)]))
            e.w8(a + 21, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 140), rnd.getrandbits(8)]))
        # char pointer is an argument: pick it beforehand
        a = g(-10814) + rnd.randint(0, 47) * 130
        def setup2(e, a=a):
            sl(e, SEED, seed)
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 32, rnd.choice([1, rnd.randint(1, 30), rnd.randint(1, 255)]))
            e.w8(a + 21, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 140), rnd.getrandbits(8)]))
        v = R.run(0x48BA, ((a, 4),), setup2)
        out.append({'char': a, 'seed': seed, **v})
    return out

def gen_dmgchar(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        a = g(-10814) + rnd.randint(0, 47) * 130
        dmg = rnd.choice([0, rnd.randint(1, 20), rnd.randint(1, 200), rnd.randint(1, 3000), rnd.getrandbits(16)])
        fA, fB, fC = rnd.choice([0, 1, 1, 2]), rnd.choice([0, 1, 1]), rnd.choice([0, 1, 2, 3, 4, 7, 0xff])
        def setup(e, a=a):
            sl(e, SEED, seed)
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 38, rnd.choice([0, 0, 0, 0x10, 0x20, 0x40, 0x50, 0x80, 0x81, rnd.getrandbits(8)]))
            e.w16(a + 94, rnd.choice([rnd.randint(0, 40), rnd.randint(0, 300), rnd.getrandbits(16)]))
            e.w8(a + 32, rnd.randint(1, 40)); e.w8(a + 21, rnd.randint(1, 100))
            sb(e, -31146, rnd.choice([0, rnd.randint(0, 60), rnd.getrandbits(8)]))
            sb(e, -31145, rnd.choice([0, rnd.randint(0, 60), rnd.getrandbits(8)]))
            sw(e, -3852, rnd.getrandbits(16))
            e.w8(HEAP, fA); e.w8(HEAP + 1, fB); e.w8(HEAP + 2, fC)
        v = R.run(0x4952, ((a, 4), dmg, (HEAP + 1, 4), (HEAP, 4), (HEAP + 2, 4)), setup)
        out.append({'char': a, 'dmg': dmg, 'seed': seed, 'pA': HEAP, 'pB': HEAP + 1, 'pC': HEAP + 2, **v})
    return out

def gen_pmelee(n, rnd):
    e = Emu(); R = Rec(e); out = []
    md = mondata(); e.uc.mem_write(HEAP + 0x1000, md)
    for off in (0x1119E, 0x22376, 0x218EA, 0x22108, 0x22480, 0x06DA6, 0x097A2, 0x2408E, 0x044E0):
        e.stub(off, 'ui%x' % off, nargs=0)
    e.stub(0x11040, 'resolve', nargs=0, argfn=lambda e: [e.r16(g(-3852)), e.r8(g(-24113)), e.r8(g(-24106))])
    for i in range(n):
        seed = rnd.getrandbits(32)
        mode = rnd.randint(0, 1)
        cnt = rnd.randint(1, 11); grp = rnd.randint(1, 11)
        tgt = rnd.randint(0, max(0, min(cnt, 10) - 1))
        cls = rnd.randint(0, 7)
        def setup(e, mode=mode, cnt=cnt, grp=grp, tgt=tgt, cls=cls):
            sl(e, SEED, seed)
            sl(e, P_MONBUF, HEAP + 0x1000)
            idxs = setup_party(e, rnd)
            ci = rnd.randrange(len(idxs)); sb(e, -1269, ci)
            a = g(-10814) + idxs[ci] * 130
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 15, cls); e.w8(a + 113, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 60), rnd.randint(1, 255)]))
            e.w8(a + 38, rnd.choice([0, 1, 0, rnd.getrandbits(8)]))
            for fld in (76, 77, 78, 79): e.w8(a + fld, rnd.randint(0, 40))
            e.w8(a + 107, rnd.randint(1, 80)); e.w8(a + 111, rnd.randint(1, 80)); e.w8(a + 114, rnd.randint(0, 150))
            sb(e, -24114, mode); sb(e, -30654, cnt); sb(e, -1316, grp)
            sb(e, -31133, rnd.choice([0, 0, rnd.randint(0, 20)])); sb(e, -31129, rnd.choice([0, rnd.randint(0, 20)]))
            sb(e, -31141, rnd.choice([0, 0, rnd.randint(0, 60), rnd.getrandbits(8)]))
            for k in range(11): sb(e, -4574 + k, rnd.randint(0, 255))
            # synthetic monster record for the target (no retail bytes in the vectors); AC low 5 bits biased to span hit/miss
            mid = e.r8(g(-4574 + tgt)); rec = bytearray(rnd.getrandbits(8) for _ in range(26))
            rec[22] = rnd.choice([rnd.randint(0, 31), rnd.randint(0, 31) + 32, rnd.getrandbits(8)])
            e.uc.mem_write(HEAP + 0x1000 + mid * 26, bytes(rec))
            sw(e, -3852, rnd.getrandbits(16))
            for d in (-24106, -24111, -24112, -24113): sb(e, d, rnd.getrandbits(8))
        v = R.run(0x111DA, (tgt,), setup, max_insn=400000)
        out.append({'seed': seed, 'tgt': tgt, **v})
    return out

def rnd_byte(rnd, small=None):
    return rnd.choice([0, 0, 1, 2, 3, rnd.randint(0, 20), rnd.getrandbits(8)])

def gen_monspecial(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            slot = rnd.randint(0, 10); sb(e, P_MONSLOT, slot)
            sb(e, -1305 + slot, rnd.choice([0, 0x40, 0x41, rnd.getrandbits(8)]))
            sb(e, -1283 + slot, rnd_byte(rnd)); sb(e, -4539, rnd.choice([0, 10, 20, 35, 50, 75, 90, 100]))
        out.append({'seed': seed, **R.run(0x105B6, (), setup)})
    return out

def gen_killreward(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            slot = rnd.randint(0, 10); sb(e, -1309, slot); sb(e, -4574 + slot, rnd.getrandbits(8))
            sb(e, -4542, rnd.randint(0, 1)); sb(e, -4543, rnd.randint(0, 3)); sb(e, -4541, rnd.randint(0, 3))
            sb(e, -24105, rnd.randint(0, 3)); sb(e, -24104, rnd.getrandbits(8))
            sl(e, -4510, rnd.choice([rnd.randint(0, 5000), rnd.getrandbits(32)]))
            sl(e, -28614, rnd.getrandbits(32)); sw(e, -16146, rnd.getrandbits(16)); sl(e, -16144, rnd.getrandbits(32))
        out.append({'seed': seed, **R.run(0x10B70, (), setup)})
    return out

def gen_partystrength(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            idxs = setup_party(e, rnd)
            for r in idxs:
                a = g(-10814) + r * 130
                e.w8(a + 113, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 255)])); e.w16(a + 116, rnd.choice([rnd.randint(0, 300), rnd.getrandbits(16)]))
            sb(e, -31150, rnd.randint(0, 3)); sl(e, -28618, rnd.getrandbits(32)); sb(e, -28610, rnd.getrandbits(8))
        out.append(R.run(0x11E58, (), setup))
    return out

def gen_mspelldmg(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32); arg = rnd.choice([2, 4, 6, 8, 10, 12, 20, rnd.randint(1, 100)])
        def setup(e):
            sl(e, SEED, seed)
            slot = rnd.randint(0, 10); sb(e, P_MONSLOT, slot); sb(e, -4574 + slot, rnd.getrandbits(8)); sw(e, -3852, rnd.getrandbits(16))
        out.append({'seed': seed, 'arg': arg, **R.run(0x1F6DC, (arg,), setup)})
    return out

def gen_sync(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        a = g(-10814) + rnd.randint(0, 47) * 130
        def setup(e, a=a):
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
        out.append({'char': a, **R.run(0x4476, ((a, 4),), setup)})
    return out

def gen_spelllevel(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            idxs = setup_party(e, rnd)
            a = g(-10814) + idxs[0] * 130
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 15, rnd.randint(0, 7)); e.w8(a + 32, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 255)]))
            e.w8(a + 35, rnd.choice([0, 0, rnd.randint(0, 9), rnd.getrandbits(8)]))
            e.w8(a + 17, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 255)])); e.w8(a + 18, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 255)]))
        out.append(R.run(0x20064, (0,), setup))
    return out

def gen_xpaward(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for off in (0x042DC, 0x22076, 0x22108, 0x218EA, 0x22376, 0x2249C, 0x06FB8, 0x06798, 0x1215A):
        e.stub(off, 'ui%x' % off, nargs=0)
    e.stub(0x123B0, 'treasure', nargs=0)
    for i in range(n):
        def setup(e):
            idxs = setup_party(e, rnd)
            living = rnd.randint(1, len(idxs))
            for j, r in enumerate(idxs):
                a = g(-10814) + r * 130
                e.w8(a + 38, rnd.choice([0, 0x10, 0x40]) if j < living else rnd.choice([0x80, 0x81, 0xff]))
                e.w32(a + 98, rnd.choice([0, rnd.randint(0, 100000), rnd.getrandbits(32)]))
            sl(e, -28614, rnd.choice([rnd.randint(0, 5000), rnd.randint(0, 3000000), rnd.getrandbits(32)]))
            sb(e, -24105, rnd.randint(0, 3)); sb(e, -24104, rnd.randint(0, 3))
        out.append(R.run(0x12430, (), setup))
    return out

def gen_train(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for off in (0x05312, 0x22108, 0x22376, 0x22480, 0x042DC, 0x2249C, 0x097A2):
        e.stub(off, 'ui%x' % off, nargs=0)
    for i in range(n):
        cost = rnd.choice([0, rnd.randint(1, 500), rnd.randint(1, 20000), rnd.getrandbits(32)])
        def setup(e):
            idxs = setup_party(e, rnd)
            a = g(-10814) + idxs[0] * 130
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 15, rnd.randint(0, 7)); e.w8(a + 38, rnd.choice([0, 0, 0, 0, 0x10, 0x40]))
            e.w8(a + 32, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 255)])); e.w8(a + 113, rnd.randint(1, 255)); e.w8(a + 35, rnd.randint(0, 9))
            e.w8(a + 39, rnd.choice([rnd.randint(1, 30), rnd.randint(1, 140), rnd.getrandbits(8)])); e.w8(a + 30, rnd.choice([0, rnd.randint(0, 255)]))
            e.w32(a + 102, rnd.choice([rnd.randint(0, 600), rnd.randint(0, 30000), rnd.getrandbits(32)]))
            for h in (94, 96, 116): e.w16(a + h, rnd.choice([rnd.randint(0, 200), rnd.getrandbits(16)]))
            sb(e, -31218, rnd.randint(0, 9))
        out.append({'cost': cost, **R.run(0x20232, (0, (cost, 4)), setup)})
    return out

def gen_rest(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for off in (0x067E6, 0x069DC, 0x06150, 0x054F2):
        e.stub(off, 'ui%x' % off, nargs=0)
    e.stub(0x01B2A, 'redraw', nargs=3)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            idxs = setup_party(e, rnd)
            for r in idxs:
                a = g(-10814) + r * 130
                for k in range(130): e.w8(a + k, rnd.getrandbits(8))
                e.w8(a + 38, rnd.choice([0, 0, 0, 0x04, 0x08, 0x0c, 0x10, 0x40, 0x81, 0x90, rnd.getrandbits(8)]))
                e.w8(a + 33, rnd.choice([rnd.randint(18, 70), rnd.randint(70, 120), rnd.getrandbits(8)]))
                e.w8(a + 37, rnd.choice([0, 0, rnd.randint(0, 40), rnd.getrandbits(8)]))
                e.w8(a + 15, rnd.randint(0, 7)); e.w8(a + 35, rnd.choice([0, rnd.randint(1, 9)]))
                e.w8(a + 32, rnd.randint(1, 60)); e.w8(a + 17, rnd.randint(1, 90)); e.w8(a + 18, rnd.randint(1, 90))
                for f in (94, 96, 116): e.w16(a + f, rnd.choice([0, rnd.randint(1, 200), rnd.getrandbits(16)]))
            sw(e, -31158, rnd.choice([9, rnd.randint(0, 20)]))
        out.append({'seed': seed, **R.run(0x19B28, (), setup)})
    return out

def gen_spellcost(n, rnd):
    e = Emu(); R = Rec(e); out = []
    e.stub(LAB_03F1, 'msg', nargs=1)
    for i in range(n):
        idx = rnd.choice([42, 46, rnd.randint(0, 95), rnd.randint(0, 95)])
        rec = g(-11006) + 2 * idx
        a = g(-10814) + rnd.randint(0, 47) * 130
        def setup(e):
            e.w8(rec, rnd.getrandbits(8)); e.w8(rec + 1, rnd.getrandbits(8))
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            e.w8(a + 113, rnd.randint(1, 60)); e.w16(a + 92, rnd.choice([0, rnd.randint(0, 120), rnd.getrandbits(16)])); e.w16(a + 88, rnd.choice([0, rnd.randint(0, 120), rnd.getrandbits(16)]))
            sb(e, -30654, rnd.choice([0, rnd.randint(1, 11), rnd.getrandbits(8)])); sw(e, -16138, rnd.getrandbits(16)); sw(e, -16136, rnd.getrandbits(16))
        k = rnd.choice(['cost', 'gems', 'sp'])
        if k == 'cost': v = R.run(0x4BBC, ((a, 4), (rec, 4)), setup)
        elif k == 'gems': v = R.run(0x795C, ((a, 4), (rec, 4)), setup)
        else:
            # SP gate reads the cost computed earlier: run it right after a cost call in the same state
            def setup2(e):
                setup(e); e.call(0x4BBC, ((a, 4), (rec, 4)))
            v = R.run(0x79A0, ((a, 4),), setup2)
        out.append({'kind': k, 'char': a, 'rec': rec, **v})
    # directed: the two special records with a monster count above the usual cap of 10, variable cost (flat nibble 0, mult 0)
    for j in range(6):
        idx = (42, 46)[j % 2]; rec = g(-11006) + 2 * idx; a = g(-10814) + rnd.randint(0, 47) * 130
        def setup(e, rec=rec, a=a):
            e.w8(rec, rnd.getrandbits(8)); e.w8(rec + 1, rnd.choice([0x00, 0x40, 0xC0, 0x80]))
            for k in range(130): e.w8(a + k, rnd.getrandbits(8))
            sb(e, -30654, rnd.randint(12, 40)); sw(e, -16138, rnd.getrandbits(16))
        v = R.run(0x4BBC, ((a, 4), (rec, 4)), setup)
        out.append({'kind': 'cost', 'char': a, 'rec': rec, 'keep': True, **v})
    return out


# ---------------------------------------------------------------- pass 2: initiative / encounter
def synth_monsters(e, rnd, big=False):
    """synthetic monsters.dat (256 random 26-byte records) at HEAP; pointer at A4-30658"""
    e.uc.mem_write(HEAP, bytes(rnd.getrandbits(8) for _ in range(256 * 26)))
    sl(e, P_MONBUF, HEAP)

def gen_encgroup(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            sb(e, -1316, rnd.choice([0, 0, 0, 0, 1, 5, rnd.getrandbits(8)]))
            sb(e, -31202, rnd.choice([0, 0, 1, 2]))
            sw(e, -31066, rnd.randint(0, 8)); sb(e, -31065, rnd.choice([0, rnd.randint(1, 8), rnd.randint(1, 8), rnd.getrandbits(8)]))
            sb(e, -31083, rnd.choice([0, 0, 2, 3, 0x80]))
            sb(e, -30654, rnd.choice([0, rnd.randint(1, 10), rnd.randint(1, 14), rnd.getrandbits(8)]))
            sb(e, -24141, rnd.getrandbits(8))
        out.append({'seed': seed, **R.run(0x11D0C, (), setup)})
    return out

def gen_moninit(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            synth_monsters(e, rnd)
            sb(e, -30654, rnd.choice([0, rnd.randint(1, 10), rnd.randint(1, 10), rnd.randint(11, 14), rnd.getrandbits(8)]))
            for k in range(11): sb(e, -4574 + k, rnd.getrandbits(8))
            for k in range(11):                                   # poison the per-slot arrays
                sb(e, -1283 + k, rnd.getrandbits(8)); sb(e, -1294 + k, rnd.getrandbits(8)); sb(e, -1305 + k, rnd.getrandbits(8)); sw(e, -1338 + 2 * k, rnd.getrandbits(16))
        out.append(R.run(0x11C82, (), setup, max_insn=400000))
    return out

def gen_battleover(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            idxs = setup_party(e, rnd, rnd.choice([None, None, 1, 2, 4, 6]))
            sw(e, -31066, rnd.choice([len(idxs), len(idxs), len(idxs), 0]))
            sb(e, -30654, rnd.choice([0, 1, 3, 11, rnd.getrandbits(8)])); sb(e, -1315, rnd.choice([0, 0, 0, 1]))
            for r in idxs: e.w8(g(-10814) + r * 130 + 38, rnd.choice([0, 0, 0x04, 0x10, 0x11, 0x40, 0x80, 0x81, rnd.getrandbits(8)]))
        out.append(R.run(0x13282, (), setup))
    return out

def gen_encpick(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); synth_monsters(e, rnd)
            sb(e, -31150, rnd.randint(0, 3)); sb(e, -28610, rnd.choice([rnd.randint(0, 30), rnd.getrandbits(8)]))
            lo = rnd.randint(1, 16); hi = lo + rnd.randint(0, 15) if rnd.random() < .8 else rnd.randint(0, 20)
            sb(e, -22030, lo); sb(e, -22031, hi)
            sb(e, -30654, rnd.choice([0, 0, rnd.randint(0, 10), rnd.randint(0, 12), rnd.getrandbits(8)]))
            sb(e, -4574, rnd.getrandbits(8))
            for k in range(11): sb(e, -4574 + k, rnd.getrandbits(8))
        out.append({'seed': seed, **R.run(0x11F0A, (), setup, max_insn=400000)})
    return out

def gen_charflee(n, rnd):
    e = Emu(); R = Rec(e); out = []
    e.stub(0x12848, 'ui12848', nargs=0)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            idxs = setup_party(e, rnd, rnd.choice([None, 1, 2, 6, 8]))
            sb(e, -22029, rnd.choice([0, 1, rnd.randint(2, 100), rnd.randint(2, 100), rnd.getrandbits(8)]))
            sb(e, -1269, rnd.choice([rnd.randint(0, len(idxs) - 1), rnd.randint(0, len(idxs) - 1), rnd.randint(0, 9)]))
            for k in range(8): sb(e, -24128 + k, rnd.randint(0, 2))
            sb(e, -24141, rnd.randint(0, 9)); sb(e, -24140, rnd.randint(0, 1)); sb(e, -1272, rnd.randint(0, 8))
        out.append({'seed': seed, **R.run(0x116B0, (), setup)})
    return out

def gen_round(n, rnd):
    e = Emu(); R = Rec(e); out = []
    st = {'script': [], 'i': 0, 'cur': None}
    def pick(kind):
        def argfn(e):
            idx = e.r8(g(-1269 if kind == 'pact' else -1271))
            eff = st['script'][st['i']] if st['i'] < len(st['script']) else [1, 0, 0]
            st['i'] += 1; st['cur'] = eff
            return [idx] + eff
        def fn(e, sp):
            kp = kind == 'pact'
            idx = e.r8(g(-1269 if kp else -1271))
            base = g(-24128 if kp else -24138)
            e.w8(base + idx, e.r8(base + idx) + 1)
            if not kp: e.w8(g(-1309), idx)
            c, a, b = st['cur']
            if c == 1: e.w8(g(-1315), 1)
            elif c == 2: e.w8(g(-30654), 0)
            elif c == 3:
                for k in range(e.r16(g(-31066))):
                    w = e.r16(g(-31082) + 2 * k)
                    e.w8(g(-10814) + w * 130 + 38, 0x81)
            elif c == 4: e.w8(g(-1294) + a, 0)
            elif c == 5: e.w8(g(-1305) + a, e.r8(g(-1305) + a) | b)
            elif c == 6:
                w = e.r16(g(-31082) + 2 * a); e.w8(g(-10814) + w * 130 + 110, b)
            return None
        e.stub(0x119C2 if kind == 'pact' else 0x1064C, kind, argfn=argfn, nargs=0, fn=fn)
    pick('pact'); pick('mact')
    for off, nm in ((0x135BE, 'ui135be'), (0x129CC, 'ui129cc'), (0x12848, 'ui12848'), (0x12430, 'xp'), (0x11646, 'retreat')): e.stub(off, nm, nargs=0)
    e.stub(0x03266, 'ui3266', nargs=3)
    for i in range(n):
        seed = rnd.getrandbits(32)
        size = rnd.choice([1, 2, 3, 4, 5, 6]); nmon = rnd.choice([1, 2, 3, 4, 6, 10, 11, 13])
        script = []
        for _ in range(rnd.randint(1, 14)):
            c = rnd.choice([0, 0, 0, 0, 4, 4, 5, 5, 6, 1, 2, 3])
            script.append([c, rnd.randint(0, 10) if c != 6 else rnd.randint(0, size - 1), rnd.getrandbits(8)])
        st['script'] = script; st['i'] = 0
        def setup(e):
            sl(e, SEED, seed); synth_monsters(e, rnd)
            idxs = setup_party(e, rnd, size)
            for r in idxs:
                a = g(-10814) + r * 130
                e.w8(a + 110, rnd.choice([rnd.randint(0, 6), rnd.randint(0, 30), rnd.getrandbits(8)]))
                e.w8(a + 38, rnd.choice([0, 0, 0, 0, 0x10, 0x40, 0x81]))
            sb(e, -31065, size)
            sb(e, -30654, nmon)
            for k in range(11): sb(e, -4574 + k, rnd.getrandbits(8))
            sb(e, -1316, rnd.choice([0, 0, 3])); sb(e, -31202, rnd.choice([0, 1])); sb(e, -31083, rnd.choice([0, 0, 2, 3]))
            sb(e, -1315, 0); sb(e, -24140, rnd.choice([0, 0, 1]))
            for k in range(10): sb(e, -24138 + k, rnd.randint(0, 1))
            for k in range(8): sb(e, -24128 + k, rnd.randint(0, 1))
            sb(e, -24141, rnd.randint(0, 6))
        v = R.run(0x12A22, (), setup, max_insn=3_000_000)
        out.append({'seed': seed, 'script': script, 'used': st['i'], **v})
    return out

def enc_setup(e, rnd, seed):
    sl(e, SEED, seed); synth_monsters(e, rnd)
    sb(e, -31150, rnd.randint(0, 3)); sb(e, -28610, rnd.choice([rnd.randint(0, 30), rnd.getrandbits(8)]))
    lo = rnd.randint(1, 16); hi = lo + rnd.randint(0, 15) if rnd.random() < .8 else rnd.randint(0, 20)
    sb(e, -22030, lo); sb(e, -22031, hi)
    sb(e, -22032, rnd.choice([rnd.randint(1, 12), rnd.randint(1, 40), rnd.getrandbits(8)]))
    sb(e, -30654, rnd.choice([0, 0, rnd.randint(0, 10), rnd.randint(0, 12), rnd.getrandbits(8)]))
    for k in range(11): sb(e, -4574 + k, rnd.getrandbits(8))
    sl(e, -28618, rnd.choice([rnd.randint(0, 40), rnd.randint(0, 400), rnd.randint(0, 5000), rnd.getrandbits(32)]))
    sb(e, -28609, rnd.getrandbits(8))
    for k in range(14): sb(e, -4562 + k, rnd.getrandbits(8))

def gen_encbudget(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        out.append({'seed': seed, **R.run(0x12072, (), lambda e: enc_setup(e, rnd, seed))})
    return out

def gen_encgen(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        out.append({'seed': seed, **R.run(0x1213E, (), lambda e: enc_setup(e, rnd, seed), max_insn=4_000_000)})
    return out

def gen_driver(n, rnd):
    e = Emu(); R = Rec(e); out = []
    st = {'keys': [], 'nums': [], 'pays': []}
    quiet_ui = [0x03266, 0x0316E, 0x042DC, 0x04032, 0x04088, 0x0425A, 0x05070, 0x054F2, 0x06798, 0x05080, 0x06DA6, 0x044E0]
    for off in quiet_ui: e.stub(off, 'ui%x' % off, nargs=0, quiet=True)
    # runtime-library UI/printing entry points reached through the jump table
    for off in (0x21624, 0x21B9A, 0x2206E, 0x22076, 0x22108, 0x218EA, 0x22480, 0x22376, 0x21C1E, 0x22958): e.stub(off, 'ui%x' % off, nargs=0, quiet=True)
    e.stub(0x12A22, 'battle', nargs=0)
    e.stub(0x11646, 'retreat', nargs=0)
    SUBMENU_RET = 0x12FCA
    def key_arg(e):
        k = st['keys'].pop(0) if st['keys'] else None
        if k is None: k = 0x1b if abs(e.last_ret_pre - (0x100000 + SUBMENU_RET)) <= 8 else 0x41
        st['cur'] = k; return [k]
    def keyfn(e, sp): return st['cur']
    def getkey_arg(e):
        sp = e.uc.reg_read(__import__('unicorn.m68k_const', fromlist=['x']).UC_M68K_REG_A7)
        e.last_ret_pre = e.r32(sp)
        return key_arg(e)
    e.stub(0x097A2, 'key', argfn=getkey_arg, fn=keyfn)
    def num_arg(e):
        v = st['nums'].pop(0) if st['nums'] else 0
        st['curn'] = v; return [v]
    e.stub(0x03EE0, 'num', argfn=num_arg, fn=lambda e, sp: st['curn'])
    for off, nm in ((0x06C66, 'payFood'), (0x06ACE, 'payGold'), (0x06B9A, 'payGems')):
        def mk(nm):
            def argfn(e):
                sp = e.uc.reg_read(__import__('unicorn.m68k_const', fromlist=['x']).UC_M68K_REG_A7)
                a = e.r32(sp + 4) if nm == 'payGold' else e.r16(sp + 4)
                st['curp'] = st['pays'].pop(0) if st['pays'] else 0
                return [a, st['curp']]
            return argfn
        e.stub(off, nm, argfn=mk(nm), fn=lambda e, sp: st['curp'])
    for i in range(n):
        seed = rnd.getrandbits(32)
        size = rnd.randint(1, 6)
        keys = []
        if rnd.random() < .7: keys.append(0x20)
        for _ in range(rnd.randint(1, 6)):
            keys.append(rnd.choice([0x41, 0x61, 0x42, 0x62, 0x42, 0x48, 0x68, 0x52, 0x72, 0x53, 0x1b, 0x31, 0x32, 0x33, 0x58, 0x31, 0x32, 0x33]))
            if keys[-1] in (0x42, 0x62): keys.append(rnd.choice([0x31, 0x32, 0x33, 0x1b]))
        nums = [rnd.choice([0, 1, 255, rnd.randint(1, 255), rnd.randint(1, 9999), rnd.randint(1, 60), 0x0A0B, 0x3C3C]) for _ in range(4)]
        pays = [rnd.randint(0, 1) for _ in range(4)]
        st['keys'], st['nums'], st['pays'] = list(keys), list(nums), list(pays)
        def setup(e):
            enc_setup(e, rnd, seed)
            idxs = setup_party(e, rnd, size); sb(e, -31065, size)
            for r in idxs:
                a = g(-10814) + r * 130
                e.w8(a + 30, rnd.choice([0, rnd.randint(0, 60), rnd.randint(0, 100), rnd.getrandbits(8)])); e.w8(a + 38, rnd.choice([0, 0, 0x10, 0x40, 0x81]))
                e.w8(a + 113, rnd.randint(1, 30)); e.w16(a + 116, rnd.randint(0, 200))
            sb(e, -31083, rnd.choice([0, 0, 0, 2, 3, 0x80, 0x82, 0x83]))
            sb(e, -31142, rnd.choice([0, 0, 1]))
            sb(e, -22025, rnd.choice([rnd.randint(0, 100), rnd.getrandbits(8)])); sb(e, -22029, rnd.choice([rnd.randint(0, 100), rnd.getrandbits(8)]))
            sb(e, -21960, rnd.randint(0, 3)); sb(e, -31154, rnd.getrandbits(8))
            nz = rnd.choice([0, 1, 2, 3, 5, 10])
            for k in range(11): sb(e, -4574 + k, rnd.randint(1, 255) if k < nz or (k == 10 and rnd.random() < .5) else 0)
            sb(e, -30654, rnd.choice([0, rnd.randint(0, 5), rnd.randint(11, 40)]))
            if bias:
                sb(e, -4574, rnd.randint(1, 60)); sb(e, -22025, rnd.randint(0, 40))
                rec = HEAP + rnd.randint(1, 60) * 26 + 16
                for q in range(1, 61): e.uc.mem_write(HEAP + q * 26 + 16, bytes([rnd.choice([0xE0, 0xE0, 0x80, 0x40, 0x20, 0xA0, 0xC0, 0x00])]))
        bias = rnd.random() < .6
        v = R.run(0x12C6E, (), setup, max_insn=3_000_000)
        keep = any(c[0] in ('payFood', 'payGold', 'payGems') for c in v['calls']) or any(c[0] == 'retreat' for c in v['calls'])
        out.append({'seed': seed, 'keys': keys, 'nums': nums, 'pays': pays, **({'keep': True} if keep and rnd.random() < .08 else {}), **v})
    return out

QUIET_UI = (0x03266, 0x0316E, 0x042DC, 0x04032, 0x04088, 0x0425A, 0x05070, 0x054F2, 0x06798, 0x05080, 0x06DA6, 0x044E0, 0x06FB8, 0x129CC, 0x12848,
            0x21624, 0x21B9A, 0x2206E, 0x22076, 0x22108, 0x218EA, 0x22480, 0x22376, 0x21C1E, 0x22958, 0x220BE, 0x05030)

def quiet_ui(e):
    for off in QUIET_UI: e.stub(off, 'ui%x' % off, nargs=0, quiet=True)

def mon_state(e, rnd, slot_max=10):
    synth_monsters(e, rnd)
    sb(e, -30654, rnd.choice([1, rnd.randint(1, 10), rnd.randint(1, 10), rnd.randint(10, 14)]))
    for k in range(11):
        sb(e, -4574 + k, rnd.getrandbits(8)); sb(e, -1305 + k, rnd.choice([0, 0x01, 0x10, 0x81, 0x90, 0xC1, 0x80, rnd.getrandbits(8)]))
        sb(e, -1294 + k, rnd.getrandbits(8)); sb(e, -1283 + k, rnd.getrandbits(8)); sw(e, -1338 + 2 * k, rnd.choice([rnd.randint(1, 20), rnd.getrandbits(16)]))
    for k in range(10): sb(e, -24138 + k, rnd.randint(0, 1))
    for k in range(8): sb(e, -24128 + k, rnd.randint(0, 1))
    sb(e, -1309, rnd.randint(0, slot_max)); sb(e, -1316, rnd.randint(0, 11))
    for d in range(-4562, -4562 + 0x38): sb(e, d, rnd.getrandbits(8))
    sb(e, -4542, rnd.randint(0, 1)); sb(e, -4543, rnd.randint(0, 3)); sb(e, -4541, rnd.randint(0, 3))
    sb(e, -24105, rnd.randint(0, 3)); sb(e, -24104, rnd.getrandbits(8)); sb(e, -1310, rnd.randint(0, 1)); sb(e, -24103, rnd.randint(0, 1))
    sl(e, -28614, rnd.getrandbits(32)); sw(e, -16146, rnd.getrandbits(16)); sl(e, -16144, rnd.getrandbits(32)); sw(e, -3852, rnd.choice([rnd.randint(0, 40), rnd.getrandbits(16)]))
    idxs = setup_party(e, rnd)
    for r in idxs:
        a = g(-10814) + r * 130
        for q in (120, 124): e.w8(a + q, rnd.getrandbits(8))
        if rnd.random() < .5: e.w8(a + 120, e.r8(g(-4574) + e.r8(g(-1309))))
        if rnd.random() < .7: e.w8(a + 124, e.r8(a + 124) | 1)
    return idxs

def gen_mondeath(n, rnd):
    e = Emu(); R = Rec(e); out = []; quiet_ui(e)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); mon_state(e, rnd)
        out.append({'seed': seed, **R.run(0x10E5E, (), setup, max_insn=600000)})
    return out

def gen_mondamage(n, rnd):
    e = Emu(); R = Rec(e); out = []; quiet_ui(e)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); mon_state(e, rnd, 12)
            eq.clear()
            if rnd.random() < .2:
                sl_ = min(e.r8(g(-1309)), 10); sw(e, -1338 + 2 * sl_, e.r16(g(-3852))); eq.append(1)
        eq = []
        out.append({'seed': seed, **({'keep': True} if False else {}), **R.run(0x10EAC, (), setup, max_insn=600000)})
        if eq and sum(1 for o in out if o.get('keep')) < 6: out[-1]['keep'] = True
    return out

def gen_questkill(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e): mon_state(e, rnd)
        out.append(R.run(0x10C66, (), setup))
    return out

def gen_resolve(n, rnd):
    e = Emu(); R = Rec(e); out = []; quiet_ui(e)
    e.stub(0x132E6, 'ui132e6', nargs=0, quiet=True)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); idxs = mon_state(e, rnd)
            ci = rnd.randrange(len(idxs)); sb(e, -1269, ci)
            a = g(-10814) + idxs[ci] * 130
            e.w8(a + 12, rnd.randint(0, 3)); e.w8(a + 76, rnd.getrandbits(8)); e.w8(a + 78, rnd.getrandbits(8))
            sb(e, -4528, rnd.choice([0, 0, 1, 2, 3])); sb(e, -4516, rnd.choice([0, 0, 0, 1]))
            sw(e, -3852, rnd.choice([0, 0, rnd.randint(1, 40), rnd.getrandbits(16)])); sb(e, -24114, rnd.randint(0, 1)); sb(e, -24106, rnd.randint(0, 2))
            sb(e, -24109, rnd.randint(0, 5)); sb(e, -24113, rnd.randint(0, 5))
        out.append({'seed': seed, **R.run(0x11040, (), setup, max_insn=600000)})
    return out

def tgt_state(e, rnd, alive=True):
    size = rnd.randint(1, 6)
    idxs = setup_party(e, rnd, size); sb(e, -31065, size)
    conds = []
    for r in idxs:
        c = rnd.choice([0, 0, 0, 0x10, 0x40, 0x80, 0x81, 0xC0, rnd.getrandbits(8)]); conds.append(c)
        e.w8(g(-10814) + r * 130 + 38, c)
    if alive and all((c & 0xC0) or c >= 0x80 for c in conds):
        e.w8(g(-10814) + idxs[rnd.randrange(size)] * 130 + 38, 0)
    sb(e, -1272, rnd.randint(0, 7)); sb(e, -24141, rnd.randint(0, 7))
    return idxs

def gen_tgtranged(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); tgt_state(e, rnd)
        out.append({'seed': seed, **R.run(0x10332, (), setup, max_insn=100000)})
    return out

def gen_tgtmelee(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e): tgt_state(e, rnd)
        out.append(R.run(0x103BA, (), setup, max_insn=100000))
    return out

def gen_monturn(n, rnd):
    e = Emu(); R = Rec(e); out = []; quiet_ui(e)
    e.stub(0x132E6, 'ui132e6', nargs=0, quiet=True); e.stub(0x1119E, 'ui1119e', nargs=0, quiet=True)
    for off, nm, na in ((0x103BA, 'pickMelee', 0), (0x10332, 'pickRanged', 0), (0x10118, 'advance', 0), (0x10002, 'spell', 0), (0x1042C, 'special', 0), (0x10894, 'partyEffect', 3), (0x1265E, 'show', 1), (0x10478, 'attack', 0)):
        e.stub(off, nm, nargs=na)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); idxs = mon_state(e, rnd)
            slot = rnd.randint(0, 10); sb(e, -1271, slot)
            if rnd.random() < .5: sb(e, -1305 + slot, rnd.choice([0, 0, 0, 0x02, 0x10, 0x20, 0x40, 0x80, 0x82, 0xC0, rnd.getrandbits(8)]))
            else: sb(e, -1305 + slot, rnd.choice([0, 0x02, 0x01]))
            sb(e, -1314, rnd.choice([0, 0, 1])); sb(e, -28610, rnd.randint(0, 40)); sb(e, -1316, rnd.randint(0, 11)); sb(e, -1313, rnd.randint(0, 5))
            sb(e, -1310, rnd.randint(0, 1)); sb(e, -24139, rnd.randint(0, 1))
            sb(e, -1283 + slot, rnd.choice([0, 1, 2, 5]))
        out.append({'seed': seed, **R.run(0x1064C, (), setup, max_insn=600000)})
    return out

def gen_setcond(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32)
        eff = rnd.choice(list(range(0, 34)) + list(range(1, 31)) * 2)
        ridx = rnd.randint(24, 47) if rnd.random() < .25 else rnd.randint(0, 23)
        a = g(-10814) + ridx * 130
        def setup(e):
            sl(e, SEED, seed)
            idxs = setup_party(e, rnd)
            ci = rnd.randrange(len(idxs)); sb(e, -1272, ci); sw(e, -31082 + 2 * ci, ridx)
            for k in range(130): e.w8(a + k, rnd.getrandbits(8) if rnd.random() < .6 else rnd.choice([0, 1, 2, 50, 100, 200, 255]))
            for k in (0x16, 0x1b, 0x1c, 0x1a, 0x1e): e.w8(a + k, rnd.choice([0, 1, 30, 50, 90, 100, 101, 255, rnd.getrandbits(8)]))
            e.w8(a + 38, rnd.choice([0, 0, 0, 4, 0x10, 0x40, 0x80, 0x81, rnd.getrandbits(8)]))
            if rnd.random() < .5: e.w32(a + 102, rnd.choice([0, 1, 255, 256, 70000, rnd.getrandbits(32), rnd.getrandbits(16)]))
            for k in range(6): e.w8(a + 58 + k, rnd.choice([0, 0, rnd.randint(1, 0xcf), rnd.randint(1, 255)]))
            sb(e, -4537, eff)
        v = R.run(0x1F27E, ((a, 4),), setup)
        keep = (v['ret'] or eff in (10, 11, 12)) and sum(1 for o in out if o.get('keep') and o['effect'] == eff) < 2
        out.append({'seed': seed, 'effect': eff, 'char': a, **({'keep': True} if keep else {}), **v})
    return out

def gen_monspecial2(n, rnd):
    e = Emu(); R = Rec(e); out = []; quiet_ui(e)
    e.stub(0x132E6, 'ui132e6', nargs=0, quiet=True); e.stub(0x1119E, 'ui1119e', nargs=0, quiet=True)
    for i in range(n):
        seed = rnd.getrandbits(32)
        eff = rnd.choice([0, rnd.randint(1, 31), rnd.randint(1, 31), rnd.randint(1, 40), rnd.getrandbits(8)])
        ridx = rnd.randint(24, 47) if rnd.random() < .2 else rnd.randint(0, 23)
        a = g(-10814) + ridx * 130
        def setup(e):
            sl(e, SEED, seed); synth_monsters(e, rnd)
            idxs = setup_party(e, rnd); sb(e, -31065, len(idxs))
            ci = rnd.randrange(len(idxs)); sb(e, -1272, ci); sw(e, -31082 + 2 * ci, ridx)
            for k in range(130): e.w8(a + k, rnd.getrandbits(8) if rnd.random() < .6 else rnd.choice([0, 1, 2, 50, 100, 200, 255]))
            for k in (0x16, 0x1b, 0x1c, 0x1a, 0x1e): e.w8(a + k, rnd.choice([0, 1, 30, 50, 90, 100, 255, rnd.getrandbits(8)]))
            e.w8(a + 38, rnd.choice([0, 0, 0, 4, 0x10, 0x40, 0x80, 0x81, rnd.getrandbits(8)]))
            e.w8(a + 32, rnd.randint(1, 40)); e.w8(a + 21, rnd.getrandbits(8))
            slot = rnd.randint(0, 10); sb(e, -1271, slot); sb(e, -4574 + slot, rnd.getrandbits(8))
            sb(e, -4537, eff); sb(e, -4536, rnd.randint(0, 1)); sb(e, -1270, rnd.choice([0, 0, 0, 1])); sb(e, -24114, rnd.choice([0, 0, 1]))
            sb(e, -24141, rnd.randint(0, 7))
        v = R.run(0xFD8C, (), setup, max_insn=600000)
        out.append({'seed': seed, 'effect': eff, 'char': a, **v})
    return out

UNITS = {'monspecial2': gen_monspecial2, 'setcond': gen_setcond, 'tgtranged': gen_tgtranged, 'tgtmelee': gen_tgtmelee, 'monturn': gen_monturn, 'resolve': gen_resolve, 'mondeath': gen_mondeath, 'mondamage': gen_mondamage, 'questkill': gen_questkill, 'driver': gen_driver, 'encbudget': gen_encbudget, 'encgen': gen_encgen, 'charflee': gen_charflee, 'round': gen_round, 'encgroup': gen_encgroup, 'moninit': gen_moninit, 'battleover': gen_battleover, 'encpick': gen_encpick, 'spellcost': gen_spellcost, 'rest': gen_rest, 'train': gen_train, 'xpaward': gen_xpaward, 'spelllevel': gen_spelllevel, 'monspecial': gen_monspecial, 'killreward': gen_killreward, 'partystrength': gen_partystrength, 'mspelldmg': gen_mspelldmg, 'sync': gen_sync, 'pmelee': gen_pmelee, 'bonus': gen_bonus, 'luck': gen_luck, 'dmgchar': gen_dmgchar, 'melee': gen_melee, 'rng': gen_rng, 'monunpack': gen_monunpack}

def main():
    a = sys.argv[1:]
    if a[0] == 'subset':
        data = json.load(open(a[1])); n = int(a[a.index('--n') + 1]) if '--n' in a else 40
        r = random.Random(7)
        if '--synthetic' in a: data = [d for d in data if d.get('synthetic')]
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

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

UNITS = {'rest': gen_rest, 'train': gen_train, 'xpaward': gen_xpaward, 'spelllevel': gen_spelllevel, 'monspecial': gen_monspecial, 'killreward': gen_killreward, 'partystrength': gen_partystrength, 'mspelldmg': gen_mspelldmg, 'sync': gen_sync, 'pmelee': gen_pmelee, 'bonus': gen_bonus, 'luck': gen_luck, 'dmgchar': gen_dmgchar, 'melee': gen_melee, 'rng': gen_rng, 'monunpack': gen_monunpack}

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

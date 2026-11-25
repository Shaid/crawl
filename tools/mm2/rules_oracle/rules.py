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

UNITS = {'bonus': gen_bonus, 'luck': gen_luck, 'dmgchar': gen_dmgchar, 'melee': gen_melee, 'rng': gen_rng, 'monunpack': gen_monunpack}

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

"""World units: non-combat cast `qcast` CODE+0x8794 (handlers via DS:0x2BEB), item use `use` CODE+0x8619, combat item use `useitem` CODE+0xC5FD.
Keys are scripted through a stubbed `wait_`; screen output callees are stubbed and logged."""
from common import *
from units_combat import mon_setup, party_fx, MONBASE, MONSLOT
from units_spells import make_wait, level_slot, party_setup, PARTYTAB, NPARTY, CURIDX, effect_state_char, world_setup
from units_spells import UI as CUI

WUI = [PTEXT, ('cout', 0x3fff, None, lambda e: [e.regs()['ax'] & 255]), ('pdec', 0x4030, None, lambda e: [e.rb(0x3c14)]), ('noises', 0x1ab3, None, lambda e: [e.regs()['ax'] & 255]),
       uistub('delayt', 0x8377), ('dl1', 0x837a, None, lambda e: [e.regs()['bx']]), uistub('clrtext4', 0x43ba), uistub('clr13to19', 0x439b), uistub('namestxt', 0x83f0),
       uistub('btmview', 0x6cfd), uistub('setgraph', 0x43fd)]
QSTOPS = (0x74b6, 0x6e46, 0xf45, 0x6f98, 0x509d, 0x4d7e)

def _usable():
    img = Emu().img
    ds = 0x107b0
    t = [int.from_bytes(img[ds + 0x2beb + 2 * i: ds + 0x2beb + 2 * i + 2], 'little') for i in range(94)]
    return [i for i in range(94) if (img[ds + 0xc5dc + i] & 1) == 0 and t[i] != 0x8af1]
USABLE = _usable()
FLAGS = list(Emu().img[0x107b0 + 0xc5dc: 0x107b0 + 0xc5dc + 94])

def handler_keys(r, sidx):
    if sidx == 41: return [r.choice([0x31, 0x32, 0x33, 0x34, 0x35, 0x35, 0x1b, 0x39, 0x30])]
    if sidx == 64: return [r.choice([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x1b]), r.choice([0x31, 0x32, 0x33, 0x34, 0x35, 0x1b]), r.choice([0x0d, 0x0d, 0x1b])]
    if sidx == 83: return [r.choice([0x4e, 0x45, 0x53, 0x57, 0x58]), r.choice([0x30, 0x31, 0x32, 0x35, 0x39, 0x3a]), r.choice([0x0d, 0x0d, 0x1b])]
    if sidx in (88, 90): return [r.choice([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x1b])]
    return [r.choice([0x1b, 0x0d])] if r.random() < 0.3 else []

def map_state(e, r):
    for i in range(0x200): e.wb(0x3cfa + i, r.choice([0, 0, 0, 1, 2, 0x55, 0xaa, r.getrandbits(8)]))
    e.wb(0x3c38, r.randint(0, 15)); e.wb(0x3c39, r.randint(0, 15)); e.wb(0x3c3a, r.getrandbits(8))
    e.wb(0x3c3c, r.choice([0, 0, 1, 0xc0, 0x30, r.getrandbits(8)]))
    e.wb(0x3c3d, r.choice([0xc0, 0x30, 0x0c, 0x03, 0xc0, 0x30, r.getrandbits(8)]))
    e.wb(0x3c41, r.choice([0x10, 0xf0, 1, 0xff, r.getrandbits(8)]))
    e.wb(0x3be8, r.getrandbits(8)); e.wb(0x3be9, r.getrandbits(8)); e.wb(0x3bea, r.getrandbits(8))

def qworld(e, r, cls=None):
    """a party in the field (no monsters needed, party records kept clear of the maze buffer DS:3CFA..3EFA)"""
    rnd_state(e, r)
    n = r.choice([1, 2, 3, 4, 5, 6, 6])
    recs = r.sample(range(4, 18), n)
    for i, k in enumerate(recs):
        mkchar(e, r, rec_addr(k), cls=(cls if (i == 0 and cls) else None))
        e.ww(PARTYTAB + 2 * i, rec_addr(k))
        effect_state_char(e, r, rec_addr(k))
    e.wb(NPARTY, n)
    cur = r.randint(0, n - 1)
    e.ww(CURIDX, cur); e.ww(CHARP, rec_addr(recs[cur]))
    a = rec_addr(recs[cur])
    mon_setup(e, r)
    party_fx(e, r)
    for off in (0x3c95, 0x3c96, 0x3c97, 0x3c98, 0x3c99, 0x3c9a, 0x3c9b, 0x3ca1, 0x3ca2, 0x3ca3, 0x3ca4, 0x3ca5):
        e.wb(off, r.choice([0, 0, 0, 5, 20, 60, 130, r.randint(0, 255)]))
    e.wb(0x3c10, r.choice([0, 0, 0, 0, 0, 0, 1, 2, 3, 8, r.getrandbits(8)]))
    e.wb(0x3c11, r.choice([0, 1, 2, 3, 4, r.randint(0, 15)]))
    e.ww(0x132, 0xc940)
    for i in range(0x80): e.wb(0xc940 + i, r.choice([0, 0x80, 0xff, r.getrandbits(8), r.randint(0, 120)]))
    map_state(e, r)
    for k in range(6): e.wb(0x3855 + k, r.choice([0, 0, 1]))
    e.wb(0x3189, r.choice([0, 0, 0, 1]))
    return a, n

def spell_boost(e, r, a, cls, sidx):
    L, S = level_slot(sidx)
    e.wb(a + 0x30, r.choice([7, 7, 7, 7, 5, 4, r.randint(0, 9)]))
    lvl = r.choice([1, 3, 8, 15, 30, r.randint(1, 255)]); e.wb(a + 0x24, lvl)
    e.ww(a + 0x2b, r.choice([100, 255, 300, 256, 258, 0x103, r.randint(0, 60), r.randint(0, 6)]))
    e.ww(a + 0x31, r.choice([100, 255, 300, 256, 257, 0x102, r.randint(0, 60), r.randint(0, 6)]))
    if r.random() < 0.7:
        e.wb(a + 0x30, 7); e.ww(a + 0x2b, 250); e.ww(a + 0x31, 250); e.wb(0x3c10, e.rb(0x3c10) & ~2); e.wb(0xc940, e.rb(0xc940) | 0x80)
    return L, S

def extra_keys(r):
    ks = []
    for _ in range(r.choice([1, 1, 2, 3, 4])):
        ks.append(r.choice([0x31 + r.randint(0, 5), 0x41 + r.randint(0, 5), 0x41, 0x0d, 0x0d, 0x4e, 0x45, 0x53, 0x57, 0x30 + r.randint(0, 9), 0x1b if r.random() < 0.1 else 0x0d]))
    return ks

def run_keys(n, rnd, mk, ip, stops, stubs=WUI):
    res = []
    e = Emu(); Rc = Rec(e)
    for _ in range(n):
        box = {}
        e.stubs.clear()
        def setup(em, box=box):
            box['keys'] = mk(em, rnd)
            for st in stubs + [make_wait(em, box['keys'])]: em.stub(st[1], st[0], st[2] if len(st) > 2 else None, st[3] if len(st) > 3 else None)
        v = Rc.run(ip, None, setup, stops=stops)
        res.append({'args': box['keys'], **v})
    return res

@unit('qcast')
def _(n, rnd):
    def mk(e, r):
        sidx = r.choice(USABLE) if r.random() < 0.9 else r.randint(0, 93)
        cls = r.choice([3, 5]) if sidx >= 47 else r.choice([1, 2, 4, 6])
        a, np_ = qworld(e, r, cls)
        L, S = spell_boost(e, r, a, cls, sidx)
        fl = FLAGS[sidx]
        keys = [0x31 + L, 0x31 + S]
        keys += [0x31 + r.randint(0, 5)] if fl & 4 else ([0x0d] if r.random() < 0.9 else [0x1b])
        keys += handler_keys(r, sidx)
        if r.random() < 0.1: keys.insert(r.randint(0, len(keys)), r.choice([0x1b, 0x20, 0x39, 0x30, 0x7a]))
        return keys
    res = run_keys(n, rnd, mk, 0x8794, QSTOPS)
    seen = set()
    for d in res:
        k = (d['out']['stop'], len(d['calls']) // 4)
        if k not in seen: seen.add(k); d['keep'] = True
    return res

def _item_ids():
    img = Emu().img; ds = 0x107b0
    def rec(i):
        b = 0x917a + 0x18 * (i - 1) if i < 0x56 else 0x9972 + 0x18 * (i - 0x56)
        return img[ds + b: ds + b + 0x19]
    sp = [i for i in range(1, 256) if rec(i)[0x11] == 0xff and (img[ds + 0xc5dc + rec(i)[0x12]] & 1) == 0 if rec(i)[0x12] < 94 and True]
    st = [i for i in range(1, 256) if rec(i)[0x11] not in (0, 0xff)]
    return sp, st, rec
SPITEMS, STITEMS, _rec = _item_ids()

@unit('use')
def _(n, rnd):
    def mk(e, r):
        a, np_ = qworld(e, r)
        slots = list(range(0x40, 0x4c))
        for s in slots:
            e.wb(a + s, 0 if r.random() < 0.2 else r.choice(SPITEMS + SPITEMS + STITEMS + [r.randint(1, 255)]))
            e.wb(a + s + 0xc, r.choice([0, 1, 1, 2, 5, 20, r.randint(0, 255)]))
        k = r.choice(slots)
        iid = e.rb(a + k)
        keys = [0x31 + (k - 0x40) if k < 0x46 else 0x41 + (k - 0x46)]
        # slot index counts only non-empty slots inside its range
        rng = range(0x40, 0x46) if k < 0x46 else range(0x46, 0x4c)
        nth = sum(1 for s in rng if s < k and e.rb(a + s) != 0)
        keys = [0x31 + nth if k < 0x46 else 0x41 + nth]
        if iid == 0: keys = [r.choice([0x31, 0x41, 0x1b])]
        else:
            rc = _rec(iid)
            if rc[0x11] == 0xff and rc[0x12] < 94:
                sidx = rc[0x12]
                L, S = level_slot(sidx)
                fl = FLAGS[sidx]
                keys += [0x31 + r.randint(0, 5)] if fl & 4 else ([0x0d] if r.random() < 0.9 else [0x1b])
                keys += handler_keys(r, sidx)
        if r.random() < 0.08: keys.insert(0, r.choice([0x1b, 0x20, 0x39, 0x7a]))
        e.wb(0x3c10, e.rb(0x3c10) & ~2 if r.random() < 0.8 else e.rb(0x3c10))
        e.wb(0xc940, e.rb(0xc940) | (0x80 if r.random() < 0.8 else 0))
        return keys
    res = run_keys(n, rnd, mk, 0x8619, QSTOPS)
    seen = set()
    for d in res:
        k = (d['out']['stop'], len(d['calls']) // 4)
        if k not in seen: seen.add(k); d['keep'] = True
    return res

CUI2 = CUI + [uistub('clrtext4', 0x43ba), uistub('home', 0x43e6), uistub('pdatal', 0xb6ce), uistub('pround', 0xb776), uistub('pinit', 0xb892), ('viewch', 0x6a2d, None, lambda e: [e.regs()['ax'] & 255])]
CSTOPS = (0xc7c4, 0xc5e1, 0x9a46, 0x9809, 0x9799)

@unit('useitem')
def _(n, rnd):
    """CODE+0xC5FD combat item use (stops as comcast)"""
    def mk(e, r):
        a, np_ = world_setup(e, r, None)
        e.ww(0x2686, 0)
        e.wb(0x2686, r.randint(0, 5))
        slots = list(range(0x40, 0x4c))
        for s in slots:
            e.wb(a + s, 0 if r.random() < 0.2 else r.choice(SPITEMS + SPITEMS + STITEMS + [r.randint(1, 255)]))
            e.wb(a + s + 0xc, r.choice([0, 1, 1, 2, 5, 20, r.randint(0, 255)]))
        k = r.choice(slots)
        iid = e.rb(a + k)
        rng = range(0x40, 0x46) if k < 0x46 else range(0x46, 0x4c)
        nth = sum(1 for s in rng if s < k and e.rb(a + s) != 0)
        keys = [0x31 + nth if k < 0x46 else 0x41 + nth]
        if iid == 0: keys = [r.choice([0x31, 0x41, 0x1b])]
        else:
            rc = _rec(iid)
            if rc[0x11] == 0xff and rc[0x12] < 94:
                sidx = rc[0x12]
                fl = FLAGS[sidx]
                keys += [0x31 + r.randint(0, 5)] if fl & 4 else []
                keys += [r.choice([0x41, 0x0d])] if fl & 8 else []
                keys += [r.choice([0x41, 0x0d])] if not (fl & 12) else []
        e.wb(0x3c10, e.rb(0x3c10) & ~2 if r.random() < 0.8 else e.rb(0x3c10))
        e.wb(0xc940, e.rb(0xc940) | (0x80 if r.random() < 0.8 else 0))
        if r.random() < 0.3: keys += [r.choice([0x41, 0x0d, 0x31, 0x32])]
        return keys
    res = run_keys(n, rnd, mk, 0xc5fd, CSTOPS, stubs=CUI2)
    seen = set()
    for d in res:
        k = (d['out']['stop'], len(d['calls']) // 4)
        if k not in seen: seen.add(k); d['keep'] = True
    return res

#!/usr/bin/env python3
"""Generate vectors_spells10.json.gz (pass 6): RAISE DEAD (spell 4, `+0x5CFA`, revive `+0x5C06`), TELEPORT (spell 18, `+0x6AF0`) through the real
CastSpell dispatcher `+0x7044`, plus the event-queue primitives schedule `+0x5EA`, cancel `+0x55E` and recast-cancel `+0x49B4` called directly
(including node-pool exhaustion). UI hooks: the target pick `+0x908AA` / the map pick `+0x3B94` return a per-case value. Evidence: harness.
Usage: make_vectors_spells10.py <s1.bin> <s2.bin> [out] [n_per_family]. Reuses the helpers of make_vectors_spells9.py (its prefix is exec'd)."""
import gzip, json, random, sys, pathlib
here = pathlib.Path(__file__).resolve().parent
src = (here / 'make_vectors_spells9.py').read_text().split('\nPLAN = [')[0]
src = src.replace("rnd = random.Random(0x59A11E5)", "rnd = random.Random(0x6A55A10)")
exec(compile(src, 'spells9-prefix', 'exec'))
N = int(sys.argv[4]) if len(sys.argv) > 4 else 150
POOL = 150; Q = 0x1036
KEEP_Q = 'K 0x5EA K 0x55E'
BASEH = ' '.join('H %s 0' % h for h in ['0x4876', '0x4960', '0x288B8', '0xB25A', '0x28012', '0x280B6', '0x288C6', '0x280F6', '0x280D4', '0x4AE', '0x2D46'])
KEEP_LOG = {0x4876, 0x4960, 0xB614, 0x382A, 0x4AE}

def chars(w, d):
    for i in range(4):
        c = CH(i)
        for o in range(0x44, 0xA8): w.b(c + o, rnd.randrange(256))
        w.w(c + 0x4E, rnd.choice([0, -2, 15, 40, 90, 1])); w.w(c + 0x50, rnd.choice([1, 9, 10, 11, 37, 99, 250, 999, 32000]))
        w.w(c + 0x56, rnd.choice([0, 400, 999, 1000, 1001, 5000])); w.b(c + 0x68, rnd.randrange(1, 28)); w.b(c + 0x72, rnd.randrange(1, 28))
        w.b(c + 0x6E, rnd.randrange(3, 30)); w.l(c + 0xA4, rnd.choice([0, 500, 9000, 40000]))
        for s in range(5): w.b(c + 0x49 + s, 255)
        w.w(c + 0x1A, 0); w.w(c + 0x1C, 0)

def gen_raise():
    w, d = base(4); chars(w, d)
    a = d['active']; w.b(CH(a) + 0x49, 4); w.w(CH(a) + 0x4E, 40)
    perm = list(range(4)); rnd.shuffle(perm)
    for i in range(4): w.w(0x1E74 + 2 * i, perm[i])
    w.b(0x1A05, rnd.choice([0, 0, 1]))
    for i in range(4): w.w(0x1A0C + 2 * i, rnd.randrange(65536)); w.b(0x1A07 + i, rnd.randrange(256))
    cands = []; nid = 5
    for slot in range(4):
        c = perm[slot]
        for hand in (0x1C, 0x1A):
            r = rnd.random()
            if r < 0.5:
                typ = rnd.choice([0x26, 0x26, 0x26, 0x18, 0x14]); wc = rnd.choice([0, 1, 2, 3, 3, 4, 5, 9])
                w.obj(nid, w0=0x12, b5=typ, wC=wc, w8=rnd.randrange(0, 600), wA=rnd.randrange(0, 50)); w.w(CH(c) + hand, nid); nid += 1
    # recompute candidate slots exactly as the game does (hp > 0, +0x1C then +0x1A, type 0x26, word +0xC < 4 signed)
    P = {}
    for k, o, v in w.p: P[(k, o)] = v
    gw = lambda o: P.get(('w', o), 0)
    for slot in range(4):
        c = perm[slot]
        hp = gw(CH(c) + 0x4E); hp = hp - 65536 if hp >= 32768 else hp
        if hp <= 0: continue
        for hand in (0x1C, 0x1A):
            it = gw(CH(c) + hand)
            if it and P.get(('b', OB(it) + 5)) == 0x26:
                wc = gw(OB(it) + 0xC); wc = wc - 65536 if wc >= 32768 else wc
                if wc < 4: cands.append(slot); break
    pick = rnd.choice(cands) if cands and rnd.random() < 0.9 else rnd.choice([0, 1, 2, 3, 4, 7, 0xFFFF])
    if cands is not None and pick < 4 and pick not in cands: pick = 4          # a UI pick is always a candidate; keep invalid ones out of range
    put_cell(w, d, d['px'], d['py'], [], rnd.choice([0] * 9 + [0x40000000]))
    for i in range(30):
        pass
    return w, d, dict(spell=4, pick=pick), 'H 0x10852 %d' % pick

def gen_tele():
    w, d = base(18); chars(w, d); w.b(CH(d['active']) + 0x49, 18); w.w(CH(d['active']) + 0x4E, 40)
    good = rnd.random() < 0.6
    w.w(0x1E2A, rnd.choice([1, 1, 2]) if good else rnd.choice([0, 1, 1, 1, 2]))
    tx = rnd.randrange(0, 40); ty = rnd.randrange(0, 40)
    chain = []; nid = 1
    for _ in range(rnd.choice([0, 0, 1, 2, 3])):
        t = rnd.choice([0x05, 0x13, 0x1E, 0x14]) if good else rnd.choice([0x10, 0x11, 0x12, 0x17, 0x1F, 0x2F, 0x05, 0x13, 0x1E])
        if not good and rnd.random() < 0.15: w.obj(nid, w0=rnd.choice([0x80B3, 0x80C5]), b5=t, wA=rnd.randrange(2))
        else: w.obj(nid, w0=1, b5=t, wA=rnd.choice([0, 0, 1, 7]) if not good else rnd.choice([1, 7]))
        chain.append(nid); nid += 1
    link(w, chain)
    flags = (rnd.choice([0x00F00000, 0x00F00000, 0x00F00000, 0x00E00000, 0x01F00000, 0x00000000, 0x0FF00000]) if not good else 0x00F00000) | rnd.choice([0, 0x40000000, 0x1000, 0x80000000])
    if not good and rnd.random() < 0.08: tx, ty = d['px'], d['py']
    put_cell(w, d, d['px'], d['py'], [], rnd.choice([0] * 9 + [0x40000000]))
    if (tx, ty) != (d['px'], d['py']):
        put_cell(w, d, tx, ty, chain, flags)
    else:
        v = (chain[0] if chain else 0) | flags & ~0x40000000; w.l(CELL(tx, ty), v)
    pick = (ty & 0xFF) | (tx << 8) if (good or rnd.random() > 0.06) else 0
    return w, d, dict(spell=18, pick=pick, tx=tx, ty=ty), 'H 0x3B94 %d H 0xB614 0 H 0x382A 0' % pick

def queue(w, k, m):
    """k active nodes (sorted, ties allowed), free list of m nodes ending at 0x96; returns list of active (id, due)"""
    ids = rnd.sample(range(0, POOL), k + m)
    act, free = ids[:k], ids[k:]
    dues = sorted(rnd.choice([0, 5, 10, 10, 20, 40, 100, 1000, rnd.randrange(0, 5000)]) for _ in act)
    w.l(0x1750, rnd.randrange(0, 100)); 
    def node(i, due, nxt, typ=None):
        o = Q + 12 * i
        w.l(o, due); w.b(o + 4, rnd.choice([0x1E, 0x1F, 0x20, 0x21, 0x22, 0x14, 0x15]) if typ is None else typ)
        w.b(o + 5, rnd.randrange(0, 5)); w.b(o + 6, rnd.randrange(0, 4)); w.b(o + 7, rnd.randrange(256)); w.b(o + 8, rnd.randrange(256)); w.b(o + 9, nxt); w.w(o + 0xA, rnd.randrange(65536))
    for n_, (i, due) in enumerate(zip(act, dues)): node(i, due, act[n_ + 1] if n_ + 1 < len(act) else 0x96)
    for n_, i in enumerate(free): w.b(Q + 12 * i + 9, free[n_ + 1] if n_ + 1 < len(free) else 0x96); w.l(Q + 12 * i, 0)
    w.b(0x173F, act[0] if act else 0x96); w.b(0x173E, free[0] if free else 0x96)
    return act, dues

def gen_sched():
    w, d = base(0xFF); k = rnd.choice([0, 1, 2, 5, 10, 30]); m = rnd.choice([0, 1, 1, 2, 3, 8])
    act, dues = queue(w, k, m)
    due = rnd.choice(dues + [0, 7, 10, 99999]) if dues else rnd.choice([0, 7, 10]); due += rnd.choice([0, 0, 0, 1, -1]); due &= 0xFFFFFFFF
    t = rnd.choice([0x14, 0x15, 0x1E, 0x22]); a1, a2, a3, a4 = [rnd.randrange(256) for _ in range(4)]; wd = rnd.randrange(65536)
    args = [wd, a4 << 8, a3 << 8, a2 << 8, a1 << 8]
    call = 'C 0x5EA 7 2 %d 2 %d 2 %d 2 %d 2 %d 4 %d 2 %d' % (wd, a4 << 8, a3 << 8, a2 << 8, a1 << 8, due, t << 8)
    return w, d, dict(fam='sched', t=t, due=due, a=[a1, a2, a3, a4], wd=wd), ''.join(['']), call
def gen_cancel():
    w, d = base(0xFF); k = rnd.choice([1, 2, 5, 12]); m = rnd.choice([0, 2, 5])
    act, dues = queue(w, k, m)
    tgt = rnd.choice(act + [rnd.randrange(0, POOL)] * 1)
    return w, d, dict(fam='cancel', id=tgt), '', 'C 0x55E 1 2 %d' % (tgt << 8)
def gen_recast():
    w, d = base(0xFF); k = rnd.choice([1, 3, 6, 12]); m = rnd.choice([0, 3])
    act, dues = queue(w, k, m)
    # query a node that exists half the time
    P = {(kk, o): v for kk, o, v in w.p}
    if rnd.random() < 0.7:
        i = rnd.choice(act); t = P[('b', Q + 12 * i + 4)]; a1 = P[('b', Q + 12 * i + 5)]; a2 = P[('b', Q + 12 * i + 6)]
    else: t = rnd.choice([0x1E, 0x1F, 0x20]); a1 = rnd.randrange(5); a2 = rnd.randrange(4)
    return w, d, dict(fam='recast', t=t, a1=a1, a2=a2), '', 'C 0x49B4 3 2 %d 2 %d 2 %d' % (a2 << 8, t << 8, a1)


def gen_scan():
    w, d = base(0xFF); px, py = d['px'], d['py']
    w.l(0x1750, rnd.randrange(0, 1000)); w.b(0x1E91, rnd.choice([0, 2, 3, 5, 7])); w.b(0x1E8F, rnd.choice([0, 0, 2, 3]))
    w.b(0x1748, rnd.choice([0, 1])); put_cell(w, d, px, py, [])
    act, dues = queue(w, rnd.choice([0, 2, 5]), rnd.choice([12, 20, 30]))
    # object id plan: 1.. in the area; templates at ids 100..; items 120..; free list 40..69 base() already set, queue() above sets event nodes
    nid = [1]
    def newid(n=1):
        i = nid[0]; nid[0] += n; return i
    # template monster in map row 0, column tc (never on a square near the party: party is at x >= 8)
    tc = rnd.randrange(1, 5); tp, ts = 100, 101
    big = rnd.random() < 0.25
    w.obj(tp, w0=rnd.choice([0x80B3, 0x80B2, 0x804F, 0x80C5]), w10=ts, wA=rnd.choice([0, 0, 120]), nx=0, wE=0); w.b(OB(tp) + 6, 8 if big else 0); w.b(OB(tp) + 0xF, rnd.randrange(256))
    w.obj(ts, w0=0, nx=0); w.b(OB(ts) + 0xB, 0); w.b(OB(ts) + 0x13, 0)
    for k, it in enumerate([120, 121, 122]):
        w.obj(it, w0=0x12, b5=0x15, w8=rnd.randrange(0, 200), nx=([121, 122, 0][k]))
    put_cell(w, d, tc, 0, [tp])
    cells = {}
    area = [(px + dx, py + dy) for dx in range(-3, 4) for dy in range(-3, 4)]
    for _ in range(rnd.choice([0, 1, 2, 4, 6])):
        (x, y) = rnd.choice(area); cells.setdefault((x, y), [])
        if rnd.random() < 0.7:   # a monster (primary id, secondary id)
            p_, s_ = newid(2), None; s_ = p_ + 1
            w.obj(p_, w0=rnd.choice([0x80B3, 0x80B2, 0x804F, 0x80C5]), w10=s_, wE=rnd.choice([0, 1, 5]), nx=0); w.b(OB(p_) + 0xF, rnd.randrange(256))
            w.obj(s_, w0=0, nx=0); w.b(OB(s_) + 0xB, rnd.randrange(5)); w.b(OB(s_) + 0x13, rnd.choice([0, 0, 0, 1]))
            cells[(x, y)].insert(0, p_)
        else:
            g = newid(); w.obj(g, w0=1, b5=0x2E, wC=rnd.choice([0, 1, 3, 7, 40000]), wE=rnd.choice([0, 1, 2, 5, 40000]), w10=tc, b7=rnd.choice([0, 0, 0, 3])); cells[(x, y)].append(g)
    # a generator is present most of the time, with limits that usually allow a spawn
    if rnd.random() < 0.7:
        (x, y) = rnd.choice(area); cells.setdefault((x, y), [])
        g = newid(); w.obj(g, w0=1, b5=0x2E, wC=rnd.choice([1, 3, 7]), wE=rnd.choice([3, 9, 5, 40000]), w10=tc, b7=0); cells[(x, y)].append(g)
    for (x, y), ch in cells.items():
        if (x, y) == (px, py): continue
        link(w, ch); put_cell(w, d, x, y, ch)
    return w, d, dict(fam='scan'), ''

cases = []; lines = []
def add(w, extra, hooks, call):
    sd = ''.join('%02x' % rnd.randrange(256) for _ in range(6))
    txt = ' '.join(['S', sd, KEEP_REAL, KEEP_Q, hooks, PTRS] + ['%s %d %d' % (k, A4 + o, v) for k, o, v in w.p] + [call])
    cases.append(dict(seed=sd, pokes=w.p, **extra)); lines.append(txt)
for n in range(N):
    w, d, ex, h = gen_raise(); ex['fam'] = 'raise'; add(w, ex, BASEH + ' ' + h, 'C 0x7044 1 2 0')
for n in range(N):
    w, d, ex, h = gen_tele(); ex['fam'] = 'tele'; add(w, ex, BASEH + ' ' + h, 'C 0x7044 1 2 0')
for n in range(N * 2):
    w, d, ex, h = gen_scan(); add(w, ex, BASEH + ' H 0x866C 0 H 0x8388 0 K 0xB614 K 0xBAA6 K 0x8458', 'C 0xB614 0')
for g in (gen_sched, gen_cancel, gen_recast):
    for n in range(N):
        r = g()
        if g is gen_sched: w, d, ex, _, call = r
        else: w, d, ex, _, call = r
        add(w, ex, BASEH, call)
res = run(lines)
assert len(res) == len(cases)
for c, r in zip(cases, res):
    c['out'] = dict(diff={str(k): v for k, v in sorted(r['diff'].items())}, seed=r['seed'], d0=r['d0'], a3=r['a3'],
                    log=[[e[0]] + e[1:8] for e in r['log'] if e[0] in KEEP_LOG])
vec = dict(note='Generated by make_vectors_spells10.py from the game\'s own code; see game-rules.md section 13', cases=cases)
gzip.open(sys.argv[3] if len(sys.argv) > 3 else str(here / 'vectors_spells10.json.gz'), 'wt', compresslevel=9).write(json.dumps(vec, separators=(',', ':')))
print('wrote', len(cases))

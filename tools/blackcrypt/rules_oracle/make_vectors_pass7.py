#!/usr/bin/env python3
"""Generate vectors_pass7.json.gz (pass 7). Families (all run in oracle_spell's `script` mode on a synthetic A4 image, stored with the oracle's complete A4 diff):
  pop    the tick handler's due-event POP LOOP `+0x12BA..+0x1FDA` (G token): several events per queue, ties, a head not yet due or already overdue, the consumers of
         0x14 / 0x15 / 0x16 / 0x1E-0x25 / 0x28 / 0x29 and an unknown type, with the real lookup / unlink / free routines un-stubbed.
  death  monster death `+0x7ED0`: unlink, carried-item chain dropped on the square (InsertObj), both records freed, the monster's queued events cancelled `+0xB25A`, XP.
  dmg    DamageCharacter `+0x17686`: survive path (hp, last-damage markers, events 0xA / 0x16) and death path (items to the square, corpse, leader fix-ups, event purge).
  vmtele the monster VM's TELEPORT op handler `+0xADA2..+0xAE78` (G token, registers preset): unlink from the old square, link at the head of the new one, distance byte.
  enter  the PARTY square-enter test `+0x27BAA` (the helper MoveParty `+0x16CC4` calls with the stepped position): result code 0 free, 1 blocked, 2..4 stairs / teleporter kinds, 5 / 7 glyph kinds,
         6 trap, 8 monster, 9 teleporter with a message; the position and facing are rewritten for teleporters (a0 / a1 / a2 pointers; peeks).
  trig   TriggerActionsAt `+0xCF34` (x, y, structure type): the action-record chain at A4+0x836 (8-byte records: [0] a4, [1] generation, [2] a1, [3] a2, [4] count, [5] delay, [6] a3, [7] next);
         immediate records go to the executor `+0xC4F6` (hooked, logged), delayed ones become event 0x28, the longest delay becomes event 0x29 (the structure timer), the chain cursor is stored back.
Usage: make_vectors_pass7.py <s1.bin> <s2.bin> [out] [n_per_family]. Deterministic. Evidence: harness. See docs/blackcrypt/amiga/game-rules.md section 14."""
import gzip, json, random, sys, pathlib
here = pathlib.Path(__file__).resolve().parent
src = (here / 'make_vectors_spells9.py').read_text().split('\nPLAN = [')[0]
src = src.replace("rnd = random.Random(0x59A11E5)", "rnd = random.Random(0x7A55507)")
exec(compile(src, 'spells9-prefix', 'exec'))
N = int(sys.argv[4]) if len(sys.argv) > 4 else 150
POOL = 150; Q = 0x1036
KEEP_Q = 'K 0x5EA K 0x55E'
UIH = ' '.join('H %s 0' % h for h in ['0x3EBE', '0x3FF2', '0x4AE', '0x82A', '0x2D46', '0x4876', '0x4960'])
KEEP_LOG = {0x3EBE, 0x3FF2, 0x4AE, 0xB614}

def chars(w):
    for i in range(4):
        c = CH(i)
        for o in range(0x44, 0xA8): w.b(c + o, rnd.choice([0, 0, 1, 2, 3, rnd.randrange(256)]))
        w.w(c + 0x4E, rnd.choice([0, -2, 15, 40, 90, 1]))
        w.b(c + 0x5F, rnd.choice([0, 1, 2, 3, 3, 255])); w.b(c + 0x60, rnd.choice([0, 1, 1, 2, 5])); w.b(c + 0x45, rnd.choice([0, 0, 1]))
        for o in (0x82, 0x83, 0x84, 0x85, 0x78, 0x79, 0x7A): w.b(c + o, rnd.choice([0, 1, 2, 3, 50, 200]))
        w.b(c + 0x69, rnd.choice([0, 20, 75, 100, 200]))

def gen_pop():
    w = W()
    T = rnd.randrange(1, 100000)
    w.l(0x1750, T); w.w(0x174A, rnd.choice([0, 1, 1, 2, 3, 4, 10]))
    w.w(0x1A14, rnd.randrange(4)); w.w(0x1A16, rnd.randrange(4)); w.b(0x1A26, rnd.choice([0, 0, 3, 1])); w.w(0x1756, rnd.choice([0, 0, 0, 1]))
    for gw in (0x1E28, 0x1E2A, 0x1E2C, 0x1E2E, 0x1A1E): w.w(gw, rnd.choice([0, 1, 2, 3, 7]))
    for i in range(4): w.w(0x19F8 + 2 * i, rnd.randrange(4)); w.w(CH(i) + 0x16, rnd.choice([0, 0, 5])); w.w(CH(i) + 0x14, rnd.choice([0, 7]))
    w.b(0x83D, rnd.randrange(8))
    chars(w)
    # free object list so unlink / free work, and a few structures on the squares the events name
    ids = list(range(40, 70)); rnd.shuffle(ids); w.w(OB(0) + 0x12, ids[0])
    for a_, b_ in zip(ids, ids[1:] + [0]): w.w(OB(a_) + 0x12, b_)
    sq = {}
    for k in range(3):
        x, y = rnd.randrange(3, 8), rnd.randrange(3, 8)
        sq.setdefault((x, y), [])
        typ = rnd.choice([0x10, 0x10, 0x1E, 0x14, 0x2C]); oid = 1 + k
        w.obj(oid, w0=1, b5=typ, wA=rnd.choice([0, 1, 3]), wC=rnd.choice([1, 1, 2]), wE=rnd.choice([1, 1, 0]), nx=0)
        sq[(x, y)].append(oid)
    for (x, y), ch in sq.items():
        link(w, ch); w.l(CELL(x, y), ch[0] | rnd.choice([0, 0, 0x40000000]))
    # the queue: k active nodes sorted by due, the rest free
    k = rnd.choice([1, 1, 2, 3, 4, 6, 9]); m = rnd.choice([0, 3, 10])
    idsq = rnd.sample(range(0, POOL), k + m); act, free = idsq[:k], idsq[k:]
    head_mode = rnd.choice(['due'] * 8 + ['future', 'late'])
    dues = []
    for j in range(k):
        if j == 0: dues.append(T if head_mode == 'due' else (T + rnd.randrange(1, 9) if head_mode == 'future' else max(0, T - rnd.randrange(1, 9))))
        else: dues.append(dues[-1] if rnd.random() < 0.45 else dues[-1] + rnd.randrange(1, 12))
    squares = list(sq.keys())
    TYPES = [0x14, 0x14, 0x15, 0x15, 0x16, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x22, 0x23, 0x24, 0x25, 0x28, 0x28, 0x29, 0x29, 0x2B, 0x30]
    evs = []
    for n_, (i, due) in enumerate(zip(act, dues)):
        t = rnd.choice(TYPES); o = Q + 12 * i
        a1, a2, a3, a4 = rnd.randrange(4), rnd.randrange(4), rnd.randrange(2), rnd.choice([0, 1, 2, 3, 5, 255])
        if t in (0x1E, 0x1F): a2 = rnd.choice([0, 0, 1, 2, 3, 4]); a3 = rnd.choice([1, 2, 3, 5, 75, 200])
        if t in (0x22, 0x29):
            (a1, a2) = rnd.choice(squares) if rnd.random() < 0.8 else (rnd.randrange(3, 8), rnd.randrange(3, 8))
            a3 = rnd.choice([0x10, 0x1E, 0x14, 0x2C, 0x33]) if t == 0x29 else 0
        if t == 0x28: a1, a2, a3, a4 = [rnd.randrange(256) for _ in range(4)]
        w.l(o, due); w.b(o + 4, t); w.b(o + 5, a1); w.b(o + 6, a2); w.b(o + 7, a3); w.b(o + 8, a4)
        w.b(o + 9, act[n_ + 1] if n_ + 1 < k else 0x96); w.w(o + 0xA, rnd.randrange(65536))
        evs.append([i, due, t, a1, a2, a3, a4])
    for n_, i in enumerate(free): w.b(Q + 12 * i + 9, free[n_ + 1] if n_ + 1 < len(free) else 0x96)
    w.b(0x173F, act[0]); w.b(0x173E, free[0] if free else 0x96)
    return w, dict(fam='pop', head=act[0], evs=evs)


import struct
S2B = open(S2, 'rb').read()
SCRIPT_PTRS = ['l %d %d' % (A4 - 0x6EB4 + 4 * i, struct.unpack('>I', S2B[0x114A + 4 * i:0x114A + 4 * i + 4])[0] + 0x80) for i in range(12)]   # the script pointer table is 0x80 low in the image (same patch as the `ai` mode)
KEEP_DEATH = 'K 0xFE K 0x1744A K 0x46 K 0xB25A K 0x6 K 0x175C4 K 0x55E K 0x17EEA'
UID = ' '.join('H %s 0' % h for h in ['0x17D2A', '0x2D46', '0xB614', '0x4AE', '0x8388', '0x148C8', '0xFDD8', '0x170A8'])

def free_list(w, first=60, n=40):
    ids = list(range(first, first + n)); rnd.shuffle(ids); w.w(OB(0) + 0x12, ids[0])
    for a_, b_ in zip(ids, ids[1:] + [0]): w.w(OB(a_) + 0x12, b_)

def events(w, mon_ids, chars=(0, 1, 2, 3), n=None):
    """a random queue; nodes keyed (word +0xA) by a monster id, or typed for a character"""
    k = rnd.choice([0, 2, 5, 9]) if n is None else n; m = 12
    ids = rnd.sample(range(0, POOL), k + m); act, free = ids[:k], ids[k:]
    dues = sorted(rnd.randrange(0, 400) for _ in act)
    for n_, (i, due) in enumerate(zip(act, dues)):
        o = Q + 12 * i
        w.l(o, due); w.b(o + 4, rnd.choice([1, 5, 0x1E, 0x14, 0x15, 0x16, 0x25, 0x22, 0x20])); w.b(o + 5, rnd.choice(chars)); w.b(o + 6, rnd.randrange(4)); w.b(o + 7, rnd.randrange(3)); w.b(o + 8, rnd.randrange(8))
        w.b(o + 9, act[n_ + 1] if n_ + 1 < k else 0x96); w.w(o + 0xA, rnd.choice(mon_ids + [0, 77]))
    for n_, i in enumerate(free): w.b(Q + 12 * i + 9, free[n_ + 1] if n_ + 1 < len(free) else 0x96)
    w.b(0x173F, act[0] if act else 0x96); w.b(0x173E, free[0])

def gen_death():
    w = W()
    w.l(0x1750, rnd.randrange(0, 5000)); w.w(0x174A, rnd.choice([0, 1, 2, 3, 10])); w.w(0x1740, rnd.randrange(8, 12)); w.w(0x1742, rnd.randrange(8, 12)); w.w(0x1744, rnd.randrange(4))
    w.w(0x1A1E, rnd.choice([0, 0, 1]))
    for i in range(4):
        c = CH(i); w.w(c + 0x4E, rnd.choice([0, -1, 5, 40, 90, 12])); w.b(c + 0x5E, rnd.randrange(1, 12)); w.l(c + 0xA0, rnd.randrange(0, 20000))
    P, S = 1, 2; x, y = rnd.randrange(14, 20), rnd.randrange(14, 20)
    gfx = rnd.choice([0x80B3, 0x80B3, 0x80B2, 0x804F, 0x80C5, 0x80B9]); hp = rnd.choice([0, -3, -3, 0, 1, 7]) if gfx != 0x80C5 else rnd.choice([0, 10, 49, 50, 80])
    typ = rnd.choice([0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11])
    w.obj(P, w0=gfx, w8=hp, wE=typ, w10=S, nx=0); w.b(OB(P) + 2, rnd.randrange(1, 60)); w.b(OB(P) + 0xC, rnd.randrange(4)); w.w(OB(P) + 6, rnd.randrange(0, 300))
    w.obj(S, w0=0, nx=0, w8=rnd.randrange(1, 500)); w.b(OB(S) + 0xB, rnd.randrange(5)); w.w(OB(S) + 4, rnd.randrange(65536))
    # carried chain 10.. and the other objects on the square 20..
    carry = list(range(10, 10 + rnd.choice([0, 0, 1, 2, 4])))
    for k, it in enumerate(carry): w.obj(it, w0=0x12, b5=0x15, w8=rnd.randrange(300), nx=carry[k + 1] if k + 1 < len(carry) else 0); w.b(OB(it) + 4, 0)
    w.w(OB(P) + 0xA, carry[0] if carry else 0)
    others = list(range(20, 20 + rnd.choice([0, 1, 3])))
    for it in others: w.obj(it, w0=0x12, b5=0x15, wA=0)
    chain = others[:]; chain.insert(rnd.randrange(len(chain) + 1), P)
    link(w, chain); w.l(CELL(x, y), chain[0] | rnd.choice([0, 0x40000000]))
    free_list(w); events(w, [P], chars=(0, 1, 2, 3))
    xs, ys = x, y
    return w, dict(fam='death', P=P, x=xs, y=ys, flag=rnd.choice([0, 1]))

def gen_dmg():
    w = W()
    T = rnd.randrange(1, 5000); w.l(0x1750, T); mode = rnd.choice([0, 1, 1, 2, 3, 4, 10]); w.w(0x174A, mode)
    px, py = rnd.randrange(8, 14), rnd.randrange(8, 14); w.w(0x1742, px); w.w(0x1740, py); w.w(0x1744, rnd.randrange(4))
    ch = rnd.randrange(4); form = list(range(4)); rnd.shuffle(form)
    for i in range(4): w.w(0x1E74 + 2 * i, form[i]); w.w(0x19F8 + 2 * i, rnd.randrange(4))
    w.w(0x1A24, rnd.choice([ch, ch, rnd.randrange(5)])); w.w(0x1A14, rnd.choice([ch, ch, rnd.randrange(4)])); w.w(0x1A16, rnd.choice([ch, rnd.randrange(4)])); w.b(0x1A26, rnd.choice([0, 0, 3]))
    w.w(0x1E2A, rnd.randrange(5)); w.w(0x1E2C, rnd.randrange(5)); w.w(0x1E88, 0)
    solo = rnd.random() < 0.2
    nid = [1]
    for i in range(4):
        c = CH(i); alive = rnd.random() < 0.8 and not solo
        w.w(c + 0x4E, rnd.choice([5, 20, 60, 200]) if alive or i == ch else rnd.choice([0, -2]))
        w.w(c + 0x50, 250); w.b(c + 0x6E, 20); w.b(c + 0x68, rnd.randrange(3, 25)); w.b(c + 0x84, rnd.randrange(3)); w.b(c + 0x85, rnd.randrange(3)); w.b(c + 0x8C, rnd.choice([0] * 8 + [3]))
        w.w(c + 0x52, 3000); w.w(c + 0x54, 3000); w.w(c + 0x56, 5000); w.l(c + 0xA4, rnd.choice([0, 4000]))
        for r in range(3):
            for k in range(6):
                if rnd.random() < 0.25 and nid[0] < 90:
                    w.obj(nid[0], w0=0x12, b5=0x15, w8=rnd.randrange(100), nx=0); w.w(c + 0x16 + 12 * r + 2 * k, nid[0]); nid[0] += 1
        for k in range(5):
            if rnd.random() < 0.3 and nid[0] < 90:
                w.obj(nid[0], w0=0x12, b5=0x15, w8=rnd.randrange(100), nx=0); w.w(c + 0x3A + 2 * k, nid[0]); nid[0] += 1
    sqitems = list(range(95, 95 + rnd.choice([0, 0, 2])))
    link(w, sqitems); w.l(CELL(px, py), (sqitems[0] if sqitems else 0) | rnd.choice([0, 0x40000000]))
    free_list(w, 100, 60)
    events(w, [1], chars=(ch, ch, rnd.randrange(4)))
    dmg = rnd.choice([0, 1, 3, 10, 40, 100, 300, 65535]); kind = rnd.randrange(8)
    return w, dict(fam='dmg', ch=ch, dmg=dmg, kind=kind, flag=rnd.choice([0, 1]))


def gen_vmtele():
    w = W()
    w.w(0x1748, rnd.choice([0, 1])); w.w(0x1742, rnd.randrange(0, 60)); w.w(0x1740, rnd.randrange(0, 60))
    P, S = 1, 2; ox, oy = rnd.randrange(5, 30), rnd.randrange(5, 30); nx_, ny_ = rnd.randrange(0, 64), rnd.randrange(0, 64)
    if rnd.random() < 0.1: nx_, ny_ = ox, oy
    w.obj(P, w0=0x80B3, wE=3, w10=S, nx=0); w.obj(S, w0=0, nx=0); w.b(OB(S) + 0xE, rnd.randrange(256))
    old = [P] + list(range(10, 10 + rnd.choice([0, 1, 2]))); link(w, old); w.l(CELL(ox, oy), old[0] | rnd.choice([0, 0x40000000, 0x1000]))
    for k in old[1:]: w.obj(k, w0=0x12, b5=0x15)
    if (nx_, ny_) != (ox, oy):
        new = list(range(20, 20 + rnd.choice([0, 0, 1, 3]))); link(w, new)
        for k in new: w.obj(k, w0=0x12, b5=0x15)
        w.l(CELL(nx_, ny_), (new[0] if new else 0) | rnd.choice([0, 0x80000000, 0x20000000]))
    return w, dict(fam='vmtele', P=P, S=S, ox=ox, oy=oy, nx=nx_, ny=ny_)


def run2(lines):
    out = subprocess.run([ORACLE, S1, S2, 'script'], input='\n'.join(lines) + '\n', capture_output=True, text=True, check=True).stdout
    res = []
    for l in out.split('\n'):
        if not l.startswith('script'): continue
        a, b, c, dd = l[len('script :'):].split('|')
        cs = c.split(); diff = {}
        log = [[int(v, 16) if i == 0 else int(v) for i, v in enumerate(e.split(','))] for e in b.split()[1:]]
        for t in dd.split():
            k, v = t.split(':'); diff[int(k, 16) - 0x8000] = int(v, 16)
        res.append(dict(peeks=[int(v) for v in a.split()], log=log, seed=cs[0], d0=int(cs[2]), a3=int(cs[6]), diff=diff))
    return res
ENTER_PTRS = 'l %d %d l %d %d' % (0x80058 + 0x27BB0, A4 - 0x37CA, 0x80058 + 0x27BB6, A4 - 0x6E7A)
def gen_enter():
    w = W(); x, y = rnd.randrange(2, 60), rnd.randrange(2, 60); f = rnd.randrange(4)
    w.w(0x1998, rnd.choice([0, 1, 1]))
    chain = []; nid = 1
    for _ in range(rnd.choice([0, 1, 1, 2, 3])):
        t = rnd.choice([0x11, 0x11, 0x14, 0x12, 0x17, 0x10, 0x10, 0x1E, 0x1F, 0x2F, 0x05, 0x13, 'mon'])
        if t == 'mon': w.obj(nid, w0=rnd.choice([0x80B3, 0x80C5]), wA=0)
        else:
            w.obj(nid, w0=1, b5=t, wA=rnd.choice([0, 0, 0, 1, 5]), wC=rnd.choice([0, 1, 2, 3, rnd.randrange(64)]), wE=rnd.randrange(64), w10=rnd.choice([0, 1, 2, 3, 4, 5]), w8=rnd.randrange(8))
            w.b(OB(nid) + 0xF, rnd.randrange(256))
        chain.append(nid); nid += 1
    link(w, chain); w.l(CELL(x, y), (chain[0] if chain else 0) | rnd.choice([0, 0x40000000]))
    return w, dict(fam='enter', x=x, y=y, f=f)


def gen_trig():
    w = W(); x, y = rnd.randrange(3, 30), rnd.randrange(3, 30)
    T = rnd.randrange(1, 5000); w.l(0x1750, T)
    typ = rnd.choice([0x1E, 0x1D, 0x1F, 0x14, 0x12])
    gen_ = rnd.randrange(0, 4); start = rnd.choice([0, 1, 2, 5, 9])
    n = 12; idxs = list(range(1, n + 1)); rnd.shuffle(idxs)
    for i in range(1, 16):
        r = 0x836 + 8 * i
        w.b(r, rnd.randrange(256)); w.b(r + 1, rnd.choice([gen_ + 1, gen_ + 1, gen_ + 1, gen_ + 2, 0, 9])); w.b(r + 2, rnd.randrange(256)); w.b(r + 3, rnd.randrange(256))
        w.b(r + 4, rnd.choice([0, 1, 2, 255, 3])); w.b(r + 5, rnd.choice([0, 0, 2, 5, 9, 30, 200])); w.b(r + 6, rnd.randrange(256)); w.b(r + 7, 0)
    if start:
        L = [start] + rnd.sample([i for i in range(1, 16) if i != start], rnd.choice([0, 1, 2, 4]))
        for i_, r_ in enumerate(L): w.b(0x836 + 8 * r_ + 7, L[i_ + 1] if i_ + 1 < len(L) else rnd.choice([0, start]))
    w.obj(1, w0=1, b5=typ, wA=rnd.choice([0, 0, 0, 1]), w8=rnd.choice([0, 1]), wC=rnd.randrange(16), w10=rnd.randrange(8), b7=rnd.choice([0, 1]), nx=0)
    w.b(OB(1) + 0xD, start); w.b(OB(1) + 0x11, gen_)
    w.l(CELL(x, y), 1)
    free_list(w, 60, 30)
    k = rnd.choice([0, 3, 10]); m = rnd.choice([3, 10])
    ids = rnd.sample(range(0, POOL), k + m); act, free = ids[:k], ids[k:]
    dues = sorted(T + rnd.randrange(0, 50) for _ in act)
    for n_, (i, due) in enumerate(zip(act, dues)):
        o = Q + 12 * i; w.l(o, due); w.b(o + 4, rnd.choice([0x1E, 0x28, 0x29])); w.b(o + 9, act[n_ + 1] if n_ + 1 < k else 0x96)
    for n_, i in enumerate(free): w.b(Q + 12 * i + 9, free[n_ + 1] if n_ + 1 < len(free) else 0x96)
    w.b(0x173F, act[0] if act else 0x96); w.b(0x173E, free[0])
    for o_ in (0x174D, 0x174C, 0x1749): w.b(o_, rnd.choice([0, 1]))
    return w, dict(fam='trig', x=x, y=y, typ=typ)

cases = []; lines = []
def add(w, extra, call, extra_pre=''):
    sd = ''.join('%02x' % rnd.randrange(256) for _ in range(6))
    txt = ' '.join(['S', sd, KEEP_REAL, KEEP_Q, UIH, PTRS, extra_pre] + ['%s %d %d' % (k, A4 + o, v) for k, o, v in w.p] + [call])
    cases.append(dict(seed=sd, pokes=w.p, **extra)); lines.append(txt)
def vmtele_call(ex):
    # registers of the handler at +0xADA2 (as left by the dispatcher): d4 = monster id, d7 = new x (byte), d3 = new y, d2 = pc, a2 = secondary record; a5 frame words +0xA = old x, +0xC = old y
    return 'w %d %d w %d %d G 0xADA2 0xAE78 D 4 %d D 7 %d D 3 %d D 2 5 A 2 %d A 5 3080192' % (3080192 + 0xA, ex['ox'], 3080192 + 0xC, ex['oy'], ex['P'], ex['nx'], ex['ny'], A4 + OB(ex['S']))
EP = 0x2F0900
def enter_call(ex):
    return 'w %d %d w %d %d w %d %d C 0x27BAA 0 A 0 %d A 1 %d A 2 %d r16 %d r16 %d r16 %d' % (EP, ex['x'], EP + 2, ex['y'], EP + 4, ex['f'], EP, EP + 2, EP + 4, EP, EP + 2, EP + 4)
POPK = 'G 0x12BA 0x1FDA D 7 %d A 5 3080192'
for n in range(N * 2):
    w, ex = gen_pop(); add(w, ex, POPK % ex['head'])
for n in range(N * 2):
    w, ex = gen_death(); add(w, ex, 'C 0x7ED0 4 2 %d 2 %d 2 %d 2 %d A 5 3080192' % (ex['flag'], ex['y'], ex['x'], ex['P']), extra_pre=KEEP_DEATH + ' ' + UID + ' ' + ' '.join(SCRIPT_PTRS))
for n in range(N):
    w, ex = gen_vmtele(); add(w, ex, vmtele_call(ex), extra_pre=KEEP_DEATH + ' K 0x74 ' + UID)
for n in range(N * 3):
    w, ex = gen_enter(); add(w, ex, enter_call(ex), extra_pre=ENTER_PTRS + ' K 0x27BAA H 0x3882 0')
for n in range(N * 2):
    w, ex = gen_trig(); add(w, ex, 'C 0xCF34 3 1 %d 2 %d 2 %d A 5 3080192' % (ex['typ'], ex['y'], ex['x']), extra_pre=KEEP_DEATH + ' K 0xCF34 H 0xC4F6 0 ' + UID)
for n in range(N * 2):
    w, ex = gen_dmg(); add(w, ex, 'C 0x17686 4 2 %d 2 %d 2 %d 2 %d A 5 3080192' % (ex['flag'], ex['kind'], ex['dmg'], ex['ch']), extra_pre=KEEP_DEATH + ' ' + UID)
res = run2(lines)
assert len(res) == len(cases)
for c, r in zip(cases, res):
    c['out'] = dict(diff={str(k): v for k, v in sorted(r['diff'].items())}, seed=r['seed'], peeks=r['peeks'], d0=r['d0'], a3=r['a3'],
                    log=[[e[0]] + e[1:8] for e in r['log'] if e[0] in KEEP_LOG or e[0] in (0x17D2A, 0xC4F6)])
vec = dict(note='Generated by make_vectors_pass7.py from the game\'s own code; see game-rules.md section 14', cases=cases)
gzip.open(sys.argv[3] if len(sys.argv) > 3 else str(here / 'vectors_pass7.json.gz'), 'wt', compresslevel=9).write(json.dumps(vec, separators=(',', ':')))
print('wrote', len(cases))

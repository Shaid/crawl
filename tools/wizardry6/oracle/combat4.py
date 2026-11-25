"""Wizardry 6 (Amiga) pass-5 oracle: the use-item action LAB_0F8A (CODE+0x275f0), the party-order swap
LAB_0FDB/LAB_0FDA (CODE+0x286c0 / 0x285be) and the post-combat sort and defeat check LAB_0A03
(CODE+0x17814), run as the game's own code under Unicorn via combat.Combat.run_call (see combat.py's header
for the footprint method). Presentation is stubbed; the C-runtime swap helper (-32124(A4)) runs for real.

Usage: combat4.py <useitem|swap|postcombat> OUT.json [--n N] [--seed S]
"""
import json, os, struct, sys
import random as pyrandom
sys.path.insert(0, os.path.dirname(__file__))
import combat as C
C.KEEP_JT.add(-32124)          # the swap/copy helper: part of the rules (party order), not presentation
from combat import *            # noqa: F401,F403
from combat3 import build_world, ensure_living, pack, w8, w16, label_offsets, G6_MEM   # noqa: F401

USE_ITEM = 0x275f0
SWAP = 0x286c0
SWAP1 = 0x285be
POSTCOMBAT = 0x17814
MAKERS = {}


def argv(flag, default):
    return int(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default


def item_bytes(c, iid, cache={}):
    """First 90 bytes of the scenario item record `iid` as the game's own ReadSection (CODE+0x9fc) delivers them."""
    if iid not in cache:
        if 'buf' not in cache: cache['buf'] = c.alloc(256)
        c.call(0x9fc, [1, (cache['buf'], 4), iid, 0])
        cache[iid] = bytes(c.uc.mem_read(cache['buf'], 90))
    return cache[iid]


def make_useitem_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(0x24ea0, 'spell_effect', log=8)
    o = label_offsets()
    kinds_seen = {}
    good = [i for i in range(1, 520) if int.from_bytes(item_bytes(c, i)[28:30], 'big')]
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 4), party=rng.randrange(1, 5))
        ag = 0 if rng.random() < .85 else rng.randrange(1, ng + 1)
        ai = rng.randrange(counts[ag])
        A = MEM_BASE + ag * MEM_STRIDE + ai * 44
        slot = rng.randrange(0, 8)
        w16(fx, A4 - 15138, ag); w16(fx, A4 - 15136, ai)
        tg, ti = rng.randrange(0, ng + 1), rng.randrange(0, 4)
        w8(fx, A + 31, tg); w8(fx, A + 32, ti)
        w16(fx, A + 10, slot)
        w16(fx, A4 - 15126, 0)
        P = A4 - 17922 + ai * 0x1b0
        ids = {}
        for s in range(8):
            iid = rng.choice(good) if rng.random() < .8 else rng.randrange(1, 520)
            w16(fx, P + 64 + 8 * s, iid); ids[s] = iid
        w8(fx, P + 415, rng.choice([6, 6, rng.randrange(14)]))
        for k in (307, 308 + 16, 320): w8(fx, P + k, rng.choice([0, 10, 30, 60, 100, 255]))
        for k in range(308, 338): w8(fx, P + k, rng.choice([0, 5, 20, 50, 90, 100]))
        w16(fx, P + 36, rng.randrange(1, 25))
        w8(fx, P + 421, rng.randrange(0, 6))
        w16(fx, A4 - 15306, counts[0])
        c.apply(fx.writes)
        iid = ids[slot]
        rec = item_bytes(c, iid)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(USE_ITEM, [(A, 4)], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        kinds_seen[rec[60]] = kinds_seen.get(rec[60], 0) + 1
        out.append(pack(c, res, {'seed': seed3, 'A': A, 'items': {str(iid): rec.hex()}}))
    print('item kinds', dict(sorted(kinds_seen.items())), file=sys.stderr)
    return out


MAKERS['useitem'] = make_useitem_vectors


def make_swap_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_0DFE'), 'refresh', log=4)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=rng.randrange(2, 5))
        np_ = counts[0]
        w16(fx, A4 - 15306, np_)
        for k in range(6):
            w16(fx, A4 - 15330 + 2 * k, rng.randrange(0, 500)); w16(fx, A4 - 15318 + 2 * k, rng.randrange(0, 500))
        w16(fx, A4 - 15138, 0); w16(fx, A4 - 15136, rng.randrange(np_))
        a, b = rng.randrange(np_), rng.randrange(np_)
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(SWAP, [a, b], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'a': a, 'b': b}))
    return out


_O = {}
def c_off(name):
    if not _O: _O.update(label_offsets())
    return _O[name]


MAKERS['swap'] = make_swap_vectors


def make_postcombat_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    for nm, lg in (('LAB_09BA', 2), ('LAB_0A1E', 2), ('LAB_0A02', 2)):
        c._stub(c_off(nm), nm, log=lg)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=rng.randrange(1, 7))
        np_ = rng.randrange(1, 7)
        w16(fx, A4 - 15306, np_)
        g0 = MEM_BASE
        w8(fx, g0 + 413, np_)
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            w8(fx, r + 417, rng.choice([0, 0, 0, 1, 2, 3, 4, 5, 8]) if rng.random() < .7 else rng.choice([2, 3, 5]))
            w8(fx, r + 416, rng.randrange(0, 6)); w8(fx, r + 414, rng.randrange(0, 6))
            o_ = g0 + i * 44
            w8(fx, o_ + 34, rng.choice([0, 0, 1, 2, 3])); w8(fx, o_ + 43, rng.choice([0, 0, 0, 1, 2]))
        for k in range(6):
            w16(fx, A4 - 15330 + 2 * k, rng.randrange(0, 500)); w16(fx, A4 - 15318 + 2 * k, rng.randrange(0, 500))
        w16(fx, A4 - 18608, rng.choice([0, 5, 0x12])); w16(fx, A4 - 15130, rng.choice([0, 0, 1]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(POSTCOMBAT, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3}))
    return out


MAKERS['postcombat'] = make_postcombat_vectors

if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

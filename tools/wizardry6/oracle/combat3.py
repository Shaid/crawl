"""Wizardry 6 (Amiga) pass-3 oracle: the round planner (LAB_0C63 / LAB_0C96), the round driver
(LAB_102D), the per-action executor (LAB_0FF9) and the spell engines behind LAB_0F06, all run as
the game's own code under Unicorn via combat.Combat.run_call, with presentation stubbed.

Per vector: input footprint, every byte written, the effect log of logged callees, the generator state.
The TypeScript ports (planner.ts, round.ts, spells.ts) run on exactly the footprint bytes and throw on any
read outside it (see combat.py's header for the method).

Usage: combat3.py planner OUT.json [--n N] [--seed S]   (likewise: monsters, round, action, area, ...)
"""
import json, os, struct, sys
import random as pyrandom
sys.path.insert(0, os.path.dirname(__file__))
from combat import *   # noqa: F401,F403  (Combat, Fixture, MEM_BASE, REC_MON_BASE, RNG_ADDR, ...)
import combat as C

PLAN = 0x1e21a          # LAB_0C63(g, tg)
PLAN_MONSTERS = 0x1e96c  # LAB_0C96()
G6_MEM = MEM_BASE + 6 * MEM_STRIDE
NSPELLS = 82


def w16(fx, a, v): fx.writes.append((a, struct.pack('>H', v & 0xffff)))
def w8(fx, a, v): fx.writes.append((a, bytes([v & 0xff])))


def build_world(c, rng, ngroups=None, party=None):
    """Random party + up to five monster groups + the ally group 6, in the game's layout."""
    fx = C.Fixture(c, rng).build(0, 0, 0, 0, 0, 0, ng=7)
    A4 = c.A4
    ngroups = ngroups or rng.randrange(1, 6)
    party = party or rng.randrange(1, 5)
    w16(fx, A4 - 15140, ngroups)
    w8(fx, A4 - 15305, party)
    counts = {}
    for g in range(7):
        base = MEM_BASE + g * MEM_STRIDE
        if g == 0: n = party
        elif g == 6: n = rng.choice([0, 0, 1, 2, 3])
        elif g <= ngroups: n = rng.randrange(1, 10)
        else: n = rng.choice([0, 0, 1])
        counts[g] = n
        w8(fx, base + 413, n)
        for i in range(9):
            o = base + i * 44
            st = rng.choice([0, 0, 0, 0, 1, 2, 3]) if i else 0
            w8(fx, o + 34, st)
            for b in (16, 17): w8(fx, o + b, rng.choice([0, 0, 0, 0, 0, 1, 3]))
            w8(fx, o + 36, rng.choice([0, 0, 1]))
            w8(fx, o + 41, rng.choice([0, 0, 1, 2, 255, 254, 5, 250]))
            w16(fx, o + 0, rng.randrange(0, 40))
            hp = rng.randrange(0, 60); w16(fx, o + 2, hp); w16(fx, o + 4, hp + rng.choice([0, 0, 3, 10, 40]))
        if g:
            r = REC_MON_BASE + g * REC_MON_STRIDE
            for k in range(3): w8(fx, r + 128 + k, rng.choice([0, 1, 1, 2, 3]))
            w8(fx, r + 128 + rng.randrange(3), 1)          # at least one valid attack slot
            for k in range(11): w8(fx, r + 138 + k, rng.choice([rng.randrange(0, NSPELLS), rng.randrange(0, NSPELLS), 0]))
            w8(fx, r + 168, rng.choice([0, 20, 50, 100])); w8(fx, r + 170, rng.choice([0, 0, 25, 100]))
            w8(fx, r + 208, rng.choice([0, 1, 0x16])); w8(fx, r + 211, rng.randrange(0, 60))
            w8(fx, r + 213, rng.randrange(1, 5)); w8(fx, r + 216, rng.randrange(0, 82)); w8(fx, r + 220, rng.randrange(0, 8))
            for k in range(3):
                w8(fx, r + 16 * k + 81, rng.choice([0, 1, 1, 2, 3, 5]))
                w8(fx, r + 16 * k + 83, rng.choice([1, 0x81, 0x24, 0x10, 0xff, 0x08, 0]))
    return fx, ngroups, counts


def ensure_living(c, rng, fx, counts, groups):
    """The planner's target pick loops until it finds a living member: guarantee one in every target group."""
    for g in groups:
        base = MEM_BASE + g * MEM_STRIDE
        if counts[g] > 0:
            w8(fx, base + rng.randrange(counts[g]) * 44 + 34, 0)


def pack(c, res, extra=None):
    d = {'foot': {str(a): b for a, b in res['foot'].items() if not (RNG_ADDR <= a < RNG_ADDR + 6)},
         'diff': {str(a): b for a, b in res['diff'].items() if not (RNG_ADDR <= a < RNG_ADDR + 6)},
         'effects': res['effects'], 'rng': res['rng'], 'a4': c.A4}
    if extra: d.update(extra)
    return d


def make_planner_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    while len(out) < n:
        fx, ng, counts = build_world(c, rng)
        g = rng.choice([1, 2, 3, 4, 5, 6]) if rng.random() < .9 else rng.randrange(1, ng + 1)
        g = min(g, ng) if g != 6 else 6
        if g == 6:
            if counts[6] == 0: continue
            tg = rng.randrange(1, ng + 1)
        else:
            tg = rng.choice([0, 0, 0, 6]) if counts[6] else 0
        if counts[g] == 0 or counts[tg] == 0: continue
        ensure_living(c, rng, fx, counts, {tg})
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(PLAN, [g, tg], seed3)
        except RuntimeError as e:
            print('skip', g, tg, str(e)[-80:], file=sys.stderr); continue
        out.append(pack(c, res, {'g': g, 'tg': tg, 'seed': seed3}))
    return out


def make_monster_plan_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    while len(out) < n:
        fx, ng, counts = build_world(c, rng)
        if any(counts[g] == 0 for g in range(1, ng + 1)): continue
        ensure_living(c, rng, fx, counts, set(range(0, ng + 1)) | {6})
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(PLAN_MONSTERS, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-80:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3}))
    return out


def argv(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


MAKERS = {'planner': make_planner_vectors, 'monsters': make_monster_plan_vectors}

if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

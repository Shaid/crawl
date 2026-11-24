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


def label_offsets(path=None):
    """LAB_xxxx -> CODE offset, parsed from the (gitignored) IRA listing."""
    import re
    path = path or os.path.join(C.REPO, 'data', 'wizardry6', 'amiga', 'disasm', 'Bane.asm')
    out, pending = {}, None
    for line in open(path):
        m = re.match(r'^(LAB_[0-9A-F]+):', line)
        if m: pending = m.group(1); continue
        if pending:
            m = re.search(r';([0-9a-f]{5}):', line)
            if m: out[pending] = int(m.group(1), 16)
            pending = None if m or line.strip() else pending
            if m: pending = None
    return out



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
            hp = rng.randrange(0, 60); w16(fx, o + 2, hp); w16(fx, o + 4, max(1, hp + rng.choice([0, 0, 3, 10, 40])))
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
         'effects': res['effects'], 'rng': res['rng'], 'a4': c.A4, 'rargs': res['rargs']}
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



# ---------------------------------------------------------------------------
# round driver LAB_102D (CODE+0x29704) with the action callees stubbed and logged
ROUND = 0x29704
ROUND_STUBS = {0x224be: ('attack', 8), 0x27132: ('cast', 4), 0x27b26: ('breath', 4), 0x275f0: ('useitem', 4),
               0x2824e: ('equip', 0), 0x282aa: ('hide', 4), 0x2846c: ('run', 4), 0x286c0: ('swap', 4),
               0x225f8: ('psync', 4), 0x23758: ('area_dmg', 14), 0x23aa0: ('area_status', 30),
               0x296a8: ('cloud_msg', 4)}
ROUND_UI = {0x27a40: 'msgprint', 0x2361e: 'e61', 0x21d90: 'win90'}


class Round(Combat):
    def __init__(self):
        super().__init__()
        self.retvals = {}
        for off, (nm, n) in ROUND_STUBS.items(): self._stub(off, nm, log=n)
        for off, nm in ROUND_UI.items(): self._stub(off, nm, log=False)


def make_round_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Round(); out = []
    while len(out) < n:
        fx, ng, counts = build_world(c, rng)
        A4 = c.A4
        w16(fx, A4 - 15306, counts[0] or 1)         # party size (LAB_0FE6)
        w16(fx, A4 - 18610, 0x0d)                   # game state: in combat
        w16(fx, A4 - 15134, 0)
        # formation grids: -15160 (2x5 words: group per cell), cell per member
        for r in range(2):
            for q in range(5): w16(fx, A4 - 15160 + r * 10 + q * 2, rng.choice([0xffff, 0, 1, 2, 3, 4, 5, 6]))
        busy = rng.random() < 0.5
        for g in range(7):
            base = MEM_BASE + g * MEM_STRIDE
            w8(fx, base + 410, rng.choice([0, 0x97, 5]))
            for k in range(4):
                if rng.random() < 0.12:
                    w8(fx, base + 402 + k, rng.randrange(1, 6)); w8(fx, base + 406 + k, rng.randrange(1, 101))
                else:
                    w8(fx, base + 402 + k, 0); w8(fx, base + 406 + k, 0)
            if g: w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 220, rng.randrange(0, 8))
            for i in range(9):
                o = base + i * 44
                slots = sorted([rng.randrange(1, 101) for _ in range(4)], reverse=True)
                for k in range(4): w8(fx, o + 24 + k, slots[k] if rng.random() < (0.9 if busy else 0.5) else 0)
                w8(fx, o + 33, rng.choice([0, 0, 0, 1, 2, 3]))
                w8(fx, o + 30, rng.choice([0, 0, 0, 0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9]))
                w16(fx, o + 10, rng.choice([0, 1, 3, 4, 8, 5, 0x0301, 7]))
                w16(fx, o + 12, rng.choice([0, 4, 8, 0xffff]))
                w8(fx, o + 28, rng.randrange(0, 4)); w8(fx, o + 29, rng.randrange(0, 4))
                w8(fx, o + 31, rng.choice([0, 0, 1, 2, 3, g]) % 7); w8(fx, o + 32, rng.randrange(0, 9))
                w8(fx, o + 36, rng.choice([0, 0, 0, 1])); w8(fx, o + 37, rng.choice([0, 0, rng.randrange(1, 101)]))
                w8(fx, o + 43, rng.choice([0, 0, 0, 0, 3, 1, 2]))
                w8(fx, o + 42, rng.choice([0xff, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
                w16(fx, o + 6, rng.randrange(0, 80)); w16(fx, o + 8, rng.randrange(1, 120))
                for b in (15, 18, 20, 21, 22): w8(fx, o + b, rng.choice([0, 0, 0, 0, 0, 0, 3, 20]))
        for i in range(6):
            for h in range(8): w8(fx, A4 - 17922 + i * 0x1b0 + 272 + h, rng.choice([0xff, 0, 1]))
        # every member's target is in range; make each target group non-empty
        for g in range(7):
            for i in range(counts[g]):
                o = MEM_BASE + g * MEM_STRIDE + i * 44
                tgx = rng.choice([0, 0, 1, 2]) if g else rng.choice([1, 2])
                if counts[tgx] == 0: tgx = g
                w8(fx, o + 31, tgx); w8(fx, o + 32, rng.randrange(counts[tgx]))
        c.apply(fx.writes)
        ret = {'cast': rng.randrange(0, 12), 'breath': rng.randrange(0, 8)}
        c.retvals = dict(ret)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(ROUND, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'ret': ret}))
    return out


MAKERS['round'] = make_round_vectors



# ---------------------------------------------------------------------------
# spell effect dispatcher LAB_0F06 (CODE+0x24ea0) with the leaf engines stubbed and logged
SPELL_ENGINES = {'LAB_0E6C': ('area_dmg', 7), 'LAB_0E7C': ('area_stat', 12), 'LAB_0E90': ('area_stat2', 15),
                 'LAB_0EB5': ('grp_all', 11), 'LAB_0EA8': ('grp_drain', 6), 'LAB_0EC0': ('grp_weak', 5),
                 'LAB_0ED3': ('grp_pm', 4), 'LAB_0E4F': ('spelldmg', 7), 'LAB_0E3A': ('resscale', 4),
                 'LAB_0DFE': ('psync', 2), 'LAB_0EEE': ('summon', 7)}
SPELL_UI = ['LAB_0EE1', 'LAB_0E27', 'LAB_0DC8', 'LAB_0E21']
SPELL_SKIP = set()                            # the summon routine LAB_0EEE is logged like an engine


class SpellRun(Combat):
    def __init__(self):
        super().__init__()
        o = label_offsets()
        self.retvals = {}
        for l, (nm, n) in SPELL_ENGINES.items(): self._stub(o[l], nm, log=2 * n)
        for l in SPELL_UI: self._stub(o[l], l, log=False)
        self.disabled = {0x24ea0}


def spell_world(c, rng, spell, power):
    fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 4), party=rng.randrange(1, 5))
    A4 = c.A4
    if counts[6] == 0:
        w8(fx, MEM_BASE + 6 * MEM_STRIDE + 413, 2); counts[6] = 2
    ag = rng.choice([0, 0, 1, 2, 6]); ag = ag if ag <= ng or ag == 6 else 1
    ai = rng.randrange(counts[ag])
    tg = rng.choice([0, 1, 2, 3, 6]); tg = tg if (tg <= ng or tg in (0, 6)) else 1
    ti = rng.randrange(counts[tg])
    ensure_living(c, rng, fx, counts, {tg})
    A = MEM_BASE + ag * MEM_STRIDE + ai * 44
    w8(fx, A + 31, tg); w8(fx, A + 32, ti)
    w16(fx, A, rng.randrange(0, 90))
    w16(fx, MEM_BASE + tg * MEM_STRIDE + ti * 44, rng.randrange(0, 90))
    w16(fx, A4 - 15138, ag); w16(fx, A4 - 15136, ai)
    w16(fx, A4 - 15134, rng.randrange(1, 101))
    w16(fx, A4 - 18340, rng.randrange(0, 8)); w16(fx, A4 - 15126, rng.randrange(2))
    for g in range(7):
        base = MEM_BASE + g * MEM_STRIDE
        for k in range(396, 402): w8(fx, base + k, rng.choice([0, 0, 3, 30, 200, 250]))
        for k in range(402, 406): w8(fx, base + k, rng.choice([0, 0, 2, 9]))
        w8(fx, base + 412, rng.randrange(2))
        w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 208, rng.choice([0, 0x14, 0x15, 0x16, 3]))
        for i in range(9):
            o = base + i * 44
            for b in (14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 35, 36, 37): w8(fx, o + b, rng.choice([0, 0, 5, 40, 200]))
            for b in (38, 39, 41): w8(fx, o + b, rng.choice([0, 1, 5, 250, 255, 100]))
    for k in range(18118, 18140, 2): w16(fx, A4 - k, rng.choice([0, 0, 5, 300, 0xfff0]))
    return fx, A, ag, ai, tg, ti


def make_spell_vectors(n, seed):
    rng = pyrandom.Random(seed); c = SpellRun(); out = []
    ids = [s for s in range(82) if s not in SPELL_SKIP]
    k = 0
    while len(out) < n:
        spell = ids[k % len(ids)]; k += 1
        power = rng.randrange(1, 7)
        fx, A, *_ = spell_world(c, rng, spell, power)
        c.apply(fx.writes)
        ret = {'spelldmg': rng.randrange(0, 70), 'resscale': rng.randrange(0, 9)}
        c.retvals = dict(ret)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(0x24ea0, [(A, 4), spell, power], seed3)
        except RuntimeError as e:
            print('skip', spell, str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'spell': spell, 'power': power, 'A': A, 'ret': ret}))
    return out


MAKERS['spells'] = make_spell_vectors



# ---------------------------------------------------------------------------
# spell engines: area damage / status / whole-side wrappers, run for real (SetStatus + kill cleanup included)
ENGINE_OFF = {'area_dmg': 0x23758, 'area_stat': 0x238ac, 'area_stat2': 0x23aa0, 'grp_drain': 0x23d38, 'grp_all': 0x23f18,
              'grp_weak': 0x24054, 'grp_pm': 0x244ae}


class EngineRun(SpellRun):
    def __init__(self):
        super().__init__()
        o = label_offsets()
        # leaf routines the engines call that are not themselves under test here
        self._stub(0x2361e, 'e61', log=False)
        for l in ('LAB_0EE1', 'LAB_0EEE'): self._stub(o[l], l, log=False)
        # run the engines, ResistScale, the damage engine and SetStatus (with the kill cleanup) for real; keep psync logged
        self.disabled = {0x2300c, 0x24ea0} | {o[l] for l, (nm, _) in SPELL_ENGINES.items() if nm != 'psync'}


def engine_words(rng, eng, counts, ng):
    gs = [g for g in range(7) if counts[g] > 0 and (g <= ng or g in (0, 6))]
    g = rng.choice(gs)
    t = rng.choice([-10, -10, -3, -1, rng.randrange(counts[g]), rng.randrange(counts[g])])
    res = rng.randrange(0, 14); mod = rng.randrange(-30, 60)
    dd = lambda: rng.choice([-1, 0, 1, 2, 3, 5, 7])
    if eng == 'area_dmg':
        return [g, t, dd(), rng.randrange(1, 9), rng.randrange(1, 5), res, mod]
    if eng == 'area_stat':
        kill = rng.randrange(2)
        return [g, t, 0xd4a, res, rng.choice([1, 2, 3, 4]) if kill else rng.randrange(0, 8), mod, kill, dd(), dd(), rng.choice([0, 3, 14, 0xff]), 6, 14]
    if eng == 'area_stat2':
        kill = rng.randrange(2)
        return [g, t, 0xd50, res, rng.randrange(1, 4), mod, dd(), rng.randrange(1, 9), rng.choice([1, 2, 3, 4]) if kill else rng.randrange(0, 8), kill, dd(), dd(), rng.choice([0, 5, 0xff]), 6, 6]
    if eng == 'grp_drain':
        return [rng.choice([0, 1, 2, 5, 6, 7, -1]), dd(), rng.randrange(1, 9), rng.randrange(1, 5), res, mod]
    if eng == 'grp_all':
        return [rng.choice([0, 1, 2, 5, 6, 7]), 0xd4a, rng.choice([5, 11, 3, 2, 6]), rng.choice([3, 3, 2, 0]), mod, rng.choice([1, 1, 0]),
                rng.choice([0, 1, 5, 20, 40]), dd(), dd(), rng.choice([0, 3, 14]), 6, 14][:11]
    if eng == 'grp_weak':
        return [g, t, mod, rng.choice([1, 2, 3, 5, 7, 12]), rng.randrange(2)]
    if eng == 'grp_pm':
        return [g, t, rng.randrange(1, 7), mod]
    raise KeyError(eng)


def make_engine_vectors(n, seed):
    rng = pyrandom.Random(seed); c = EngineRun(); out = []
    names = list(ENGINE_OFF)
    k = 0
    while len(out) < n:
        eng = names[k % len(names)]; k += 1
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 4), party=rng.randrange(1, 5))
        A4 = c.A4
        if counts[6] == 0: w8(fx, MEM_BASE + 6 * MEM_STRIDE + 413, 2); counts[6] = 2
        w = engine_words(rng, eng, counts, ng)
        for g in range(7):
            base = MEM_BASE + g * MEM_STRIDE
            for q in range(396, 402): w8(fx, base + q, rng.choice([0, 0, 3, 30, 100, 250]))
            for i in range(9):
                o = base + i * 44
                w8(fx, o + 0x2b, rng.choice([0, 0, 0, 0, 1]))
                for b in range(14, 24): w8(fx, o + b, rng.choice([0, 0, 0, 5, 40, 250]))
            for q in range(14): w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 0x94 + q, rng.choice([0, 20, 50, 80, 100, 130]))
            w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 0xdc, rng.randrange(0, 4))
        w16(fx, A4 - 15306, rng.randrange(1, 7)); fx.writes.append((A4 - 15300, struct.pack('>I', rng.randrange(0, 4000))))
        for g in (6,):
            pass
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(ENGINE_OFF[eng], [x & 0xffff if x >= 0 else x & 0xffff for x in w], seed3)
        except RuntimeError as e:
            print('skip', eng, w, str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'eng': eng, 'w': w}))
    return out


MAKERS['engines'] = make_engine_vectors



# ---------------------------------------------------------------------------
# the cast gate LAB_0F72 (CODE+0x27132): anti-magic gate, success chance, fizzle / backfire, silence, SP cost
def make_cast_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    while len(out) < n:
        spell = rng.randrange(0, 82); power = rng.randrange(1, 7)
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 4), party=rng.randrange(1, 5))
        ag = rng.choice([0, 0, 0, 1, 2, 6]); ag = ag if ag <= ng or ag == 6 else 1
        if ag == 6 and counts[6] == 0: ag = 0
        ai = rng.randrange(counts[ag])
        tg = rng.choice([0, 1, 2]); tg = tg if tg <= ng else 0
        A = MEM_BASE + ag * MEM_STRIDE + ai * 44
        w8(fx, A + 31, tg); w8(fx, A + 32, rng.randrange(counts[tg]))
        w16(fx, A + 10, power * 256 + spell)
        w8(fx, A + 14, rng.choice([0, 0, 0, 3]))
        w16(fx, A, rng.randrange(0, 40))
        w16(fx, A4 - 15138, ag); w16(fx, A4 - 15136, ai)
        for g in range(7): w8(fx, MEM_BASE + g * MEM_STRIDE + 401, rng.choice([0, 0, 0, 5, 30, 200]))
        for g in range(7): w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 208, rng.choice([0, 3, 4, 5, 13, 0x16]))
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            w8(fx, r + 415, rng.randrange(0, 14))
            for k in (321, 333, 307): w8(fx, r + k, rng.choice([0, 20, 50, 80, 100, 3, 17]))
            for k in range(0, 6): w16(fx, r + 40 + 4 * k, rng.randrange(0, 60))
            w16(fx, r + 36, rng.randrange(1, 25))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(0x27132, [(A, 4)], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'A': A, 'ret': res['ret']}))
    return out


MAKERS['cast'] = make_cast_vectors



# ---------------------------------------------------------------------------
# item removal LAB_0DE6 (CODE+0x22278)
def make_remove_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    c.disabled = set(getattr(c, 'disabled', ())) | {0x22278}      # run the real removal; its callees stay logged
    c._stub(0x2200e, 'unequip', log=2); c._stub(0x21f1a, 'weight', log=2)
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        ai = rng.randrange(4); P = A4 - 17922 + ai * 0x1b0
        cnt = rng.randrange(1, 12)
        w8(fx, P + 428, cnt)
        for s in range(14):
            w16(fx, P + 64 + 8 * s, rng.randrange(0, 300))
            w8(fx, P + 70 + 8 * s, rng.choice([0, 1, 1, 2, 5]))
        for k in range(8): w8(fx, P + 272 + k, rng.choice([0xff, 0xff, rng.randrange(cnt), rng.randrange(cnt)]))
        for k in range(352, 360): w8(fx, P + k, rng.randrange(0, 12))
        w16(fx, A4 - 15136, ai)
        slot = rng.randrange(cnt)
        c.apply(fx.writes)
        c.apply([(RNG_ADDR, bytes(6))])
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        try:
            res = c.run_call(0x22278, [slot], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'slot': slot}))
    return out


MAKERS['remove'] = make_remove_vectors


# ---------------------------------------------------------------------------
# hide LAB_0FC5 (CODE+0x282aa) and run LAB_0FD2 (CODE+0x2846c), run for real; only the presentation is stubbed
FLEE = {'hide': 0x282aa, 'run': 0x2846c}


def make_flee_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    k = 0
    while len(out) < n:
        which = ['hide', 'run'][k % 2]; k += 1
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 6), party=rng.randrange(1, 5))
        ag = rng.choice([0, 0, 0, 1, 2]); ag = ag if ag <= ng else 1
        ai = rng.randrange(counts[ag])
        A = MEM_BASE + ag * MEM_STRIDE + ai * 44
        w16(fx, A4 - 15138, ag); w16(fx, A4 - 15136, ai)
        w16(fx, A4 - 15306, counts[0])
        w16(fx, A, rng.randrange(0, 60))
        w16(fx, A4 - 15128, rng.choice([0, 0, 0, 1, 2]))
        for g in range(7):
            base = MEM_BASE + g * MEM_STRIDE
            w8(fx, base + 43, 0)
            for q in (122, 135, 137): w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + q, rng.randrange(0, 30))
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            w16(fx, r + 36, rng.randrange(1, 25))
            for q in (324, 301, 325): w8(fx, r + q, rng.choice([0, 5, 20, 50, 80, 100]))
            w8(fx, r + 36 + 308 - 308 + 0, 0) if False else None
        w8(fx, A + 43, rng.choice([0, 0, 0, 1, 2]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(FLEE[which], [(A, 4)], seed3)
        except RuntimeError as e:
            print('skip', which, str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'what': which, 'A': A}))
    return out


MAKERS['flee'] = make_flee_vectors


# ---------------------------------------------------------------------------
# encounter start LAB_0A31 (CODE+0x17fde): clear groups, add group 1 (+ companion chain), party structs, evasion
ENC_START = 0x17fde


class EncounterRun(Combat):
    """The encounter builder runs for real. Replaced: the monster picture routines (LAB_097E, LAB_0979), the formation
    slot picker LAB_098A (its result is logged and replayed by the port), and the C-runtime memset / memcpy / strcpy,
    which the oracle would otherwise stub away. LoadRecord (CODE+0x9fc) runs for real; the bytes it delivers are
    captured at its return so the port can replay them."""
    def __init__(self):
        super().__init__()
        o = label_offsets()
        self.retvals = {}
        self.loads = []
        self.pend = {}
        self._stub(o['LAB_097E'], 'pic_slot', log=4)
        self._stub(o['LAB_0979'], 'pic_mon', log=2)
        self._stub(o['LAB_098A'], 'formation', log=2)
        self._stub(0x1ede0 - 0x1ede0 + o['LAB_0E21'], 'e21', log=False)
        for nm in ('LAB_0DC8', 'LAB_0DBA', 'LAB_0DC6', 'LAB_0DC9'):
            if nm in o: self._stub(o[nm], nm, log=False)
        j = self.jt
        self._custom(j[-32130], self._memset)
        self._custom(j[-32088], self._memcpy)
        self.uc.hook_add(UC_HOOK_CODE, self._load_enter, begin=CODE_BASE + 0x9fc, end=CODE_BASE + 0x9fc)

    def _custom(self, off, fn):
        def hook(uc, a, size, ud):
            if off in self.disabled: return
            sp = uc.reg_read(UC_M68K_REG_A7)
            fn(sp)
            uc.reg_write(UC_M68K_REG_D0, 0)
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
            uc.reg_write(UC_M68K_REG_PC, self.r32(sp))
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=CODE_BASE + off, end=CODE_BASE + off)

    def _poke(self, addr, data):
        for k, b in enumerate(data):
            a = addr + k
            if self.tracking and a not in self.written: self.written[a] = self.uc.mem_read(a, 1)[0]
        self.uc.mem_write(addr, bytes(data))

    def _memset(self, sp):          # memset(ptr long, n word, v word)
        ptr, n, v = self.r32(sp + 4), self.r16(sp + 8), self.r16(sp + 10)
        self._poke(ptr, bytes([v & 0xff]) * n)

    def _memcpy(self, sp):          # movmem(src long, dst long, n word)
        src, dst, n = self.r32(sp + 4), self.r32(sp + 8), self.r16(sp + 12)
        self.rd_note(src, n)
        self._poke(dst, bytes(self.uc.mem_read(src, n)))

    def rd_note(self, addr, n):
        if not self.tracking: return
        for a in range(addr, addr + n):
            if a not in self.written and a not in self.foot: self.foot[a] = self.uc.mem_read(a, 1)[0]

    def _load_enter(self, uc, a, size, ud):
        sp = uc.reg_read(UC_M68K_REG_A7)
        ret = self.r32(sp)
        sec, dest, rid = self.r16(sp + 4), self.r32(sp + 6), self.r16(sp + 10)
        self.pend.setdefault(ret, []).append((sec, dest, rid))
        if ret not in getattr(self, '_rethooks', set()):
            self._rethooks = getattr(self, '_rethooks', set()) | {ret}
            def rh(uc2, a2, s2, ud2, ret=ret):
                if not self.pend.get(ret): return
                sec_, dest_, rid_ = self.pend[ret].pop(0)
                if self.tracking and sec_ == 4:
                    self.loads.append([rid_, dest_, bytes(uc2.mem_read(dest_, 222)).hex()])
                    for q in range(dest_, dest_ + 222):
                        if q not in self.written: self.written[q] = 0
            self.uc.hook_add(UC_HOOK_CODE, rh, begin=ret, end=ret)


def make_encounter_vectors(n, seed):
    rng = pyrandom.Random(seed); c = EncounterRun(); out = []
    A4 = c.A4
    ids = list(range(0, 250))
    while len(out) < n:
        fx = C.Fixture(c, rng).build(0, 0, 0, 0, 0, 0, ng=7)
        party = rng.randrange(1, 7)
        w16(fx, A4 - 15306, party); w8(fx, A4 - 15305, party)
        mid = rng.choice(ids)
        w16(fx, A4 - 15102, mid)
        w16(fx, A4 - 15100, rng.choice([0, 1, 1]))
        w16(fx, A4 - 15128, rng.choice([0, 0, 1]))
        w16(fx, A4 - 18340, rng.randrange(1, 14))
        w16(fx, A4 - 18122, rng.choice([0, 0, 40]))
        w8(fx, A4 - 18119, rng.randrange(0, 50))
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            for q in (24, 26, 28, 30): w16(fx, r + q, rng.randrange(1, 300))
            w16(fx, r + 36, rng.randrange(1, 25))
            w8(fx, r + 417, rng.choice([0, 0, 0, 1, 2, 3])); w8(fx, r + 420, rng.randrange(0, 50))
            for q in range(290, 300): w8(fx, r + q, rng.choice([0, 0, 0, 5]))
            for q in (301, 331): w8(fx, r + q, rng.choice([0, 10, 30, 60, 90, 100]))
            w8(fx, r + 331 + 0, rng.choice([0, 10, 30, 60, 90, 100, 255]))
        # group memory starts with junk so the clear is observable
        for g in range(7):
            for q in range(0, 0x1a0, 7): w8(fx, MEM_BASE + g * MEM_STRIDE + q, rng.randrange(0, 256))
            w8(fx, MEM_BASE + g * MEM_STRIDE + 413, rng.randrange(0, 10))
        c.apply(fx.writes)
        c.retvals = {'formation': rng.randrange(0, 7)}
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        c.loads = []; c.pend = {}
        try:
            res = c.run_call(ENC_START, [], seed3)
        except RuntimeError as e:
            print('skip', mid, str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'mid': mid, 'loads': c.loads, 'ret': dict(c.retvals)}))
    return out


MAKERS['encounter'] = make_encounter_vectors


# ---------------------------------------------------------------------------
# breath LAB_0FB1 (CODE+0x27b26): twelve breath types, run for real with the area engines
BREATH = 0x27b26


def make_breath_vectors(n, seed):
    rng = pyrandom.Random(seed); c = EngineRun(); out = []
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 4), party=rng.randrange(1, 5))
        if counts[6] == 0: w8(fx, MEM_BASE + 6 * MEM_STRIDE + 413, 2); counts[6] = 2
        ag = rng.choice([1, 1, 2, 0, 6]); ag = ag if (ag <= ng or ag in (0, 6)) else 1
        ai = rng.randrange(counts[ag])
        tg = rng.choice([0, 0, 1, 2, 6]); tg = tg if (tg <= ng or tg in (0, 6)) else 0
        ti = rng.randrange(counts[tg])
        ensure_living(c, rng, fx, counts, {tg})
        A = MEM_BASE + ag * MEM_STRIDE + ai * 44
        w8(fx, A + 31, tg); w8(fx, A + 32, ti)
        w16(fx, A + 10, rng.randrange(0, 14))
        w16(fx, A + 2, rng.choice([5, 20, 40, 90, 150, 700, 3000])); w16(fx, A + 8, rng.randrange(1, 120)); w16(fx, A + 6, rng.randrange(0, 120))
        w8(fx, A + 14, rng.choice([0, 0, 3]))
        w16(fx, A4 - 15138, ag); w16(fx, A4 - 15136, ai)
        for g in range(7):
            base = MEM_BASE + g * MEM_STRIDE
            for q in range(396, 402): w8(fx, base + q, rng.choice([0, 0, 3, 30, 100, 250]))
            for i in range(9):
                o = base + i * 44
                w8(fx, o + 0x2b, rng.choice([0, 0, 0, 0, 1]))
                for b in range(14, 24): w8(fx, o + b, rng.choice([0, 0, 0, 5, 40, 250]))
            for q in range(14): w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 0x94 + q, rng.choice([0, 20, 50, 80, 100, 130]))
            w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 210, rng.choice([0, 0, 3, 6]))
            w8(fx, REC_MON_BASE + g * REC_MON_STRIDE + 0xdc, rng.randrange(0, 4))
        w16(fx, A4 - 15306, rng.randrange(1, 7)); fx.writes.append((A4 - 15300, struct.pack('>I', rng.randrange(0, 4000))))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(BREATH, [(A, 4)], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'A': A, 'ret': res['ret']}))
    return out


MAKERS['breath'] = make_breath_vectors


# ---------------------------------------------------------------------------
# summon LAB_0EEE (CODE+0x24940): add a group (monster side) or the ally group 6 (party side), for real
SUMMON = 0x24940


def make_summon_vectors(n, seed):
    rng = pyrandom.Random(seed); c = EncounterRun(); out = []
    A4 = c.A4
    while len(out) < n:
        fx = C.Fixture(c, rng).build(0, 0, 0, 0, 0, 0, ng=7)
        ag = rng.choice([0, 6, 1, 2, 3])
        ng = rng.randrange(0, 6)
        w16(fx, A4 - 15138, ag); w16(fx, A4 - 15140, ng)
        w16(fx, A4 - 15306, rng.randrange(1, 7)); w8(fx, A4 - 15305, rng.randrange(1, 7))
        for g in range(7):
            for q in range(0, 0x1a0, 5): w8(fx, MEM_BASE + g * MEM_STRIDE + q, rng.randrange(0, 256))
            w8(fx, MEM_BASE + g * MEM_STRIDE + 413, rng.choice([0, 0, 1, 3]))
        ids = [rng.choice([rng.randrange(200, 224), rng.randrange(0, 250)]) for _ in range(6)]
        nn = rng.choice([0, 1, 2, 3, 4, 5, 6, 7])
        c.apply(fx.writes)
        c.retvals = {}
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        c.loads = []; c.pend = {}
        try:
            res = c.run_call(SUMMON, ids + [nn], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'ids': ids, 'n': nn, 'loads': c.loads}))
    return out


MAKERS['summon'] = make_summon_vectors


if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

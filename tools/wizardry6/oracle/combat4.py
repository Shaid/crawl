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
C.KEEP_JT.update({-32124, -32478})          # the swap/copy helper: part of the rules (party order), not presentation
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

TICK = 0x120da          # LAB_07FA(member, hpDie, stamMult, dt, spFlag): per-time-unit regen / poison / disease / timers


def make_tick_vectors(n, seed):
    """LAB_07FA: the party member's time tick (used per step by the world clock and per rest minute)."""
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_0751'), 'LAB_0751', log=2)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        i = rng.randrange(6)
        P = A4 - 17922 + i * 0x1b0
        w8(fx, P + 417, rng.choice([0, 0, 0, 1, 2, 3, 4]))
        for k in (418, 419, 420): w8(fx, P + k, rng.choice([0, 0, 0, 1, 2, 5]))
        mx = rng.randrange(1, 200); w16(fx, P + 26, mx); w16(fx, P + 24, rng.choice([rng.randrange(-20, mx + 20), 1, 0]))
        sm = rng.randrange(1, 300); w16(fx, P + 30, sm); w16(fx, P + 28, rng.choice([rng.randrange(-5, sm + 20), 0]))
        for k in range(290, 300): w8(fx, P + k, rng.choice([0, 0, 1, 3, 10, 255]))
        w8(fx, P + 293, rng.choice([0, 0, 2])); w8(fx, P + 292, rng.choice([0, 0, 4]))
        for k in range(6):
            smx = rng.randrange(0, 40); w16(fx, P + 42 + 4 * k, smx); w16(fx, P + 40 + 4 * k, rng.randrange(0, smx + 8))
            w8(fx, P + 284 + k, rng.choice([0, 1, 2, 6]))
        w8(fx, P + 414, rng.randrange(0, 6))
        c.apply(fx.writes)
        args = [i, rng.choice([0, 0, 6, 10, 20]), rng.choice([0, 0, 5, 10, 50]), rng.choice([1, 1, 2, 5, 60]), rng.choice([0, 1])]
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(TICK, args, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'args': args}))
    return out


MAKERS['tick'] = make_tick_vectors

REST = 0x12456          # LAB_0808(): camp (8 rest minutes, each +60 on the clock), returns 1 when a wandering encounter interrupts


def make_rest_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    for nm in ('LAB_078D', 'LAB_0784'): c._stub(c_off(nm), nm, log=False)
    c._stub(c_off('LAB_0751'), 'LAB_0751', log=2)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        np_ = rng.randrange(1, 5)
        w16(fx, A4 - 15306, np_); w16(fx, A4 - 18610, 5); w16(fx, A4 - 10886, 0)
        clock = rng.randrange(6000, 100000)
        fx.writes.append((A4 - 18302, struct.pack('>I', clock)))
        fx.writes.append((A4 - 18298, struct.pack('>I', clock - rng.choice([0, 30, 100, 1000, 5000]))))
        fx.writes.append((A4 - 18294, struct.pack('>I', rng.choice([0, 100, 5000, 12000]))))
        for k in range(6):
            w16(fx, A4 - 18138 + 4 * k, rng.choice([0, 1, 30, 100, 600])); w16(fx, A4 - 18136 + 4 * k, rng.randrange(0, 50))
        for i in range(6):
            P = A4 - 17922 + i * 0x1b0
            w8(fx, P + 417, rng.choice([0, 0, 0, 1, 3]))
            for k in (418, 419, 420, 421, 422, 423): w8(fx, P + k, rng.choice([0, 0, 1, 2, 5, 9]))
            mx = rng.randrange(1, 200); w16(fx, P + 26, mx); w16(fx, P + 24, rng.randrange(1, mx + 1))
            sm = rng.randrange(1, 300); w16(fx, P + 30, sm); w16(fx, P + 28, rng.randrange(0, sm + 1))
            for k in range(290, 300): w8(fx, P + k, rng.choice([0, 0, 1, 3, 10, 255]))
            for k in range(6):
                smx = rng.randrange(0, 40); w16(fx, P + 42 + 4 * k, smx); w16(fx, P + 40 + 4 * k, rng.randrange(0, smx + 8))
                w8(fx, P + 284 + k, rng.choice([0, 1, 2, 6]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(REST, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'ret': res['ret']}))
    return out


MAKERS['rest'] = make_rest_vectors

STEP_TICK = 0x13d60     # LAB_08AE: the per-step clock / hunger / exhaustion / wandering-encounter tail of the post-move routine LAB_08A7
STEP_TICK_END = 0x13f1c  # LAB_08BD: the routine falls through here when nothing happened


def run_mid(c, entry, stop, seed, frame=()):
    """Run a stretch of a routine from mid-function `entry` (a fake LINK frame stands in for the skipped prologue) until it
    returns or reaches `stop`. Same tracking as run_call."""
    from unicorn.m68k_const import UC_M68K_REG_A5, UC_M68K_REG_A7, UC_M68K_REG_A4, UC_M68K_REG_PC, UC_M68K_REG_D0
    from unicorn import UC_HOOK_CODE
    import emu as E
    c.effects = []; c.written = {}; c.foot = {}; c.rargs = []
    c.seed(*seed)
    a5 = E.STACK_TOP - 0x800
    c.w32(a5, 0); c.w32(a5 + 4, E.RET_MAGIC)
    c.uc.reg_write(UC_M68K_REG_A5, a5); c.uc.reg_write(UC_M68K_REG_A7, a5 - 64); c.uc.reg_write(UC_M68K_REG_A4, c.A4)
    for off, data in frame: c.uc.mem_write(a5 + off, bytes(data))
    hit = []
    def stop_hook(uc, a, sz, ud): hit.append(1); uc.emu_stop()
    h = c.uc.hook_add(UC_HOOK_CODE, stop_hook, begin=CODE_BASE + (stop or 0x7ffffff0), end=CODE_BASE + (stop or 0x7ffffff0))
    c.tracking = True
    try:
        c.uc.emu_start(CODE_BASE + entry, E.RET_MAGIC + 0x100, count=200_000_000)
    finally:
        c.tracking = False
        c.uc.hook_del(h)
    diffs = {a: c.uc.mem_read(a, 1)[0] for a in c.written}
    return {'foot': c.foot, 'diff': diffs, 'effects': c.effects, 'rng': list(c.state()), 'rargs': [], 'fell': bool(hit), 'ret': c.uc.reg_read(UC_M68K_REG_D0) & 0xffff}


def make_steptick_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    for nm in ('LAB_078D', 'LAB_0784'): c._stub(c_off(nm), nm, log=False)
    c._stub(c_off('LAB_0751'), 'LAB_0751', log=2)
    tbl = c.alloc(2048); slot = c.alloc(16)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        np_ = rng.randrange(1, 5)
        w16(fx, A4 - 15306, np_); w16(fx, A4 - 18610, 5); w16(fx, A4 - 10886, 0); w16(fx, A4 - 18330, rng.randrange(0, 12))
        clock = rng.choice([rng.randrange(6000, 100000), 600 * rng.randrange(10, 100) + 5, 60 * rng.randrange(100, 900) + 10 * rng.randrange(6) + 4])
        fx.writes.append((A4 - 18302, struct.pack('>I', clock)))
        fx.writes.append((A4 - 18298, struct.pack('>I', clock - rng.choice([0, 30, 1000]))))
        fx.writes.append((A4 - 18294, struct.pack('>I', rng.choice([0, 100, 5000]))))
        for k in range(6):
            w16(fx, A4 - 18138 + 4 * k, rng.choice([0, 1, 30, 100, 600])); w16(fx, A4 - 18136 + 4 * k, rng.randrange(0, 50))
        for i in range(6):
            P = A4 - 17922 + i * 0x1b0
            w8(fx, P + 417, rng.choice([0, 0, 0, 1, 3] if rng.random() < .8 else [3, 3, 4]))
            for k in (418, 419, 420, 421, 422, 423): w8(fx, P + k, rng.choice([0, 0, 1, 2, 5, 9]))
            mx = rng.randrange(1, 200); w16(fx, P + 26, mx); w16(fx, P + 24, rng.randrange(1, mx + 1))
            sm = rng.randrange(1, 300); w16(fx, P + 30, sm); w16(fx, P + 28, rng.randrange(0, sm + 1))
            for k in range(290, 300): w8(fx, P + k, rng.choice([0, 0, 1, 3, 10, 255]))
            w8(fx, P + 292, rng.choice([0, 1, 4])); w8(fx, P + 293, rng.choice([0, 0, 2]))
            for k in range(6):
                smx = rng.randrange(0, 40); w16(fx, P + 42 + 4 * k, smx); w16(fx, P + 40 + 4 * k, rng.randrange(0, smx + 8))
                w8(fx, P + 284 + k, rng.choice([0, 1, 2, 6]))
        if rng.random() < .35:        # whole party exhausted: forces the camp
            for i in range(np_): w8(fx, A4 - 17922 + i * 0x1b0 + 292, rng.choice([1, 4]))
        b = bytearray(rng.randrange(256) for _ in range(1400))
        for k in range(1334, 1346): b[k] = rng.choice([0, 1, 30, 80, 100, 255])
        c.apply([(tbl, bytes(b)), (A4 - 18462, struct.pack('>I', tbl)), (A4 - 18306, struct.pack('>I', slot))])
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = run_mid(c, STEP_TICK, STEP_TICK_END, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'fell': res['fell'], 'slot': slot}))
    return out


MAKERS['steptick'] = make_steptick_vectors

DISARM = 0x4ca82        # LAB_1C5B after the trap-type menu: mismatch -> -1, else the skill roll (1 disarmed, 0 retry, -1 trap triggers)


def make_disarm_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        who = rng.randrange(4); P = A4 - 17922 + who * 0x1b0
        w8(fx, P + 415, rng.choice([3, 3, 4, 13, 6, rng.randrange(14)]))
        w16(fx, P + 36, rng.randrange(1, 25))
        for k in (304, 323): w8(fx, P + k, rng.choice([0, 10, 30, 60, 100, 200]))
        w8(fx, P + 308 + 15, rng.choice([0, 30, 99, 100]))
        w16(fx, A4 - 18340, rng.randrange(1, 13))
        actual = rng.randrange(0, 16); w16(fx, A4 - 3236, actual)
        chosen = actual if rng.random() < .85 else rng.randrange(0, 16)
        idx = rng.randrange(0, 5)
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        frame = [(8, struct.pack('>H', who)), (-12, struct.pack('>H', idx)), (-46 + 2 * idx, struct.pack('>H', chosen))]
        try:
            res = run_mid(c, DISARM, None, seed3, frame)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'who': who, 'chosen': chosen, 'ret': res['ret']}))
    return out


MAKERS['disarm'] = make_disarm_vectors

ENC_GROUP = 0x1017a     # LAB_0732(level)  -> region group nibble
ENC_MON = 0x1010a       # LAB_072E(group)   -> monster id


def make_encounter_pick_vectors(n, seed):
    """LAB_0732 + LAB_072E: the random-encounter pick. -18462(A4) points at the level table block (chance bytes at +1334,
    group nibbles at +1322, monster ids at +0); the table is random bytes here and the footprint records what was read."""
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    tbl = c.alloc(2048)
    while len(out) < n:
        which = 'group' if len(out) % 2 == 0 else 'mon'
        blk = bytes(rng.randrange(256) for _ in range(1400))
        if rng.random() < .5:
            b = bytearray(blk)
            for k in range(1334, 1346): b[k] = rng.choice([0, 1, 30, 50, 80, 100, 101, 255])
            blk = bytes(b)
        c.apply([(tbl, blk), (A4 - 18462, struct.pack('>I', tbl))])
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        arg = rng.randrange(0, 12) if which == 'group' else rng.randrange(0, 16)
        try:
            res = c.run_call(ENC_GROUP if which == 'group' else ENC_MON, [arg], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'which': which, 'arg': arg, 'ret': res['ret']}))
    return out


MAKERS['encpick'] = make_encounter_pick_vectors

if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

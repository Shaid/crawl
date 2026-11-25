"""Wizardry 6 (Amiga) pass-6 oracle: the scripted-encounter trigger of the exploration routine LAB_08A7 (CODE+0x13c54)
and the region-set flood fill LAB_0735 (CODE+0x101ca), run as the game's own code under Unicorn with the C-runtime bit
helpers (TestBit/SetBit/GetField/SetField, JT -32490/-32496/-32478/-32484) running for real.

Makers (all through combat.Combat.run_call / combat4.run_mid, same footprint method as passes 2-5):
  region    LAB_0735(level, x, y, val): set (val 1) or clear (val 0, consuming the spots it covers) the connected region
  entry     LAB_08A7 from its first instruction to LAB_08AD (CODE+0x13d26): the region clear unless the return state
            -18608 is 0x17, the redraw, then the scripted-spot test at LAB_08AA..LAB_08AB
  loop      the loop body from LAB_08AA (CODE+0x13cc4), no clear: the test the exploration loop repeats after every move
  kind4     entity kind 4 handler LAB_062F (CODE+0xcf1c): scripted encounter from the entity's operand byte
  kind5     entity kind 5, the inline case of LAB_06B6 (CODE+0xea30..0xeb42): scripted encounter, state 0x12
  zone      the zone-indicator code after LAB_08BD (CODE+0x13f1c..0x13fde)
  upkeep    LAB_09BA(group, member, a, b) (CODE+0x1693e): the end-of-combat member upkeep (regeneration, poison, death, counters)
  compact   LAB_09C8(group) (CODE+0x16be2): upkeep of the survivors and compaction of a group, with the real LAB_09BA inside
  decay     LAB_0AA2 (CODE+0x19144): group buff and cloud decay at the end of a fight
  writeback LAB_0A02(member) (CODE+0x1775e): combat struct -> character record
  xpsplit   LAB_1D9A (CODE+0x5031a): the victory XP split
  loot      LAB_1D76 from CODE+0x4fe28: the treasure roll, gold / bonus-XP split and item list
  postfull  LAB_0A03 (CODE+0x17814) with the real LAB_09BA and LAB_0A02

Usage: combat5.py <region|entry|loop|kind4|kind5|zone|upkeep|compact|decay|writeback|xpsplit|loot|postfull> OUT.json [--n N] [--seed S]
"""
import json, os, struct, sys
import random as pyrandom
sys.path.insert(0, os.path.dirname(__file__))
import combat as C
C.KEEP_JT.update({-32124, -32478, -32484, -32472})
from combat import *            # noqa: F401,F403
from combat3 import pack, w8, w16, label_offsets   # noqa: F401
import combat4 as C4
from combat4 import run_mid, c_off, argv
import emu as E

MAKERS = {}
REGION = 0x101ca        # LAB_0735(level, x, y, val)
ENTRY = 0x13c54         # LAB_08A7
LOOP = 0x13cc4          # LAB_08AA
AFTER_TEST = 0x13d26    # LAB_08AD: reached when no scripted encounter fires
BITMAP = -18018         # 96 bytes: 12 levels x 8 x 8 bits


def rb(rng, n): return bytes(rng.randrange(256) for _ in range(n))


class World:
    """A random but structured level block (edge fields, spots, group table) behind -18462(A4) and -18458(A4)."""
    def __init__(self, c, rng):
        self.c, self.rng = c, rng
        A4 = c.A4
        self.a = c.alloc(2048); self.b = c.alloc(2048); self.slot = c.alloc(16)
        blk = bytearray(rb(rng, 1500))
        zero_p = rng.choice([0.5, 0.7, 0.85])
        for k in range(96, 480):                      # 2-bit edge fields: mostly open so regions are large
            v = 0
            for sh in (0, 2, 4, 6):
                v |= (0 if rng.random() < zero_p else rng.randrange(1, 4)) << sh
            blk[k] = v
        for k in range(1274, 1322): blk[k] = 0        # spots filled below
        for lv in range(12):                           # five spots per level, 3-bit x and y fields
            for s in range(5):
                on = rng.random() < 0.45
                x, y = (rng.randrange(8), rng.randrange(8)) if on else (0, 0)
                self.setfield(blk, 1274, lv * 5 + s, 3, x); self.setfield(blk, 1298, lv * 5 + s, 3, y)
        for k in range(1334, 1346): blk[k] = rng.choice([0, 10, 50, 100])
        self.blk = bytes(blk)
        bb = bytearray(rb(rng, 1800))
        for lv in range(13): bb[1728 + lv] = rng.choice([0, 1, 3, 10, 40])
        c.apply([(self.a, self.blk), (self.b, bytes(bb)), (A4 - 18462, struct.pack('>I', self.a)),
                 (A4 - 18458, struct.pack('>I', self.b)), (A4 - 18306, struct.pack('>I', self.slot)),
                 (A4 + BITMAP, bytes(96))])

    @staticmethod
    def setfield(blk, base, idx, width, val):
        pos = width * idx
        for i in range(width):
            p = pos + i; bit = (val >> i) & 1
            blk[base + (p >> 3)] = (blk[base + (p >> 3)] & ~(1 << (p & 7)) & 0xff) | (bit << (p & 7))

    def getfield(self, base, idx, width):
        pos = width * idx; v = 0
        for i in range(width):
            p = pos + i
            v |= ((self.blk[base + (p >> 3)] >> (p & 7)) & 1) << i
        return v

    def arm(self, levels):
        """Arm the regions the way LAB_073F does: LAB_0735(level, x, y, 1) for every spot with x + y > 0 (real code)."""
        for lv in levels:
            for s in range(5):
                x = self.getfield(1274, lv * 5 + s, 3); y = self.getfield(1298, lv * 5 + s, 3)
                if x + y > 0: self.c.call(REGION, [lv, x, y, 1])

    def bitmap(self): return bytes(self.c.uc.mem_read(self.c.A4 + BITMAP, 96))


def pick_cell(w, rng, armed_p=.6):
    lv = rng.randrange(12); x = rng.randrange(8); y = rng.randrange(8)
    if rng.random() < armed_p:
        bm = w.bitmap(); cells = [k for k in range(768) if bm[k >> 3] >> (k & 7) & 1]
        if cells: k = rng.choice(cells); lv, y, x = k >> 6, (k >> 3) & 7, k & 7
    return lv, x, y


def make_region_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    while len(out) < n:
        w = World(c, rng)
        w.arm(rng.sample(range(12), rng.randrange(0, 4)))
        lv, x, y = pick_cell(w, rng, .5)
        val = rng.choice([0, 0, 1])
        try:
            res = c.run_call(REGION, [lv, x, y, val], [1, 1, 1])
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': [1, 1, 1], 'lv': lv, 'x': x, 'y': y, 'val': val}))
    return out


MAKERS['region'] = make_region_vectors


def make_entry_vectors(n, seed, loop=False):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_0764'), 'LAB_0764', log=0)
    while len(out) < n:
        w = World(c, rng)
        w.arm(rng.sample(range(12), rng.randrange(1, 5)))
        lv, x, y = pick_cell(w, rng)
        ret_state = rng.choice([0x17, 0x17, 5, 5, 4, 0x12, 8])
        c.apply([(A4 - 18330, struct.pack('>h', lv)), (A4 - 18334, struct.pack('>h', x)), (A4 - 18332, struct.pack('>h', y)),
                 (A4 - 18608, struct.pack('>H', ret_state)), (A4 - 18610, struct.pack('>H', 5)),
                 (A4 - 10892, struct.pack('>H', rng.choice([0, 1]))),
                 (A4 - 18148, struct.pack('>h', rng.choice([-1, 0, 2, 5, 40]))),
                 (A4 - 15100, struct.pack('>H', 7)), (A4 - 15128, struct.pack('>H', 7))])
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            if loop: res = run_mid(c, LOOP, AFTER_TEST, seed3)
            else: res = run_mid(c, ENTRY, AFTER_TEST, seed3, frame=[(-64, struct.pack('>I', E.RET_MAGIC))])
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'fell': res['fell'], 'slot': w.slot, 'lv': lv, 'x': x, 'y': y, 'ret_state': ret_state}))
    return out


MAKERS['entry'] = lambda n, s: make_entry_vectors(n, s, False)
MAKERS['loop'] = lambda n, s: make_entry_vectors(n, s, True)


KIND4 = 0xcf1c          # LAB_062F
KIND5 = 0xea30          # inline case of LAB_06B6 (kind 5)
KIND5_END = 0xeb42      # LAB_06BE
ZONE = 0x13f1c          # LAB_08BD
ZONE_END = 0x13fde      # LAB_08C2


def entity_world(c, rng, w):
    A4 = c.A4
    idx = rng.randrange(0, 96)
    B = bytearray(bytes(c.uc.mem_read(w.b, 2048)))
    for k in range(0, 1728): B[k] = rng.randrange(256) if rng.random() < .7 else 0
    B[1584 + idx] = rng.choice([rng.randrange(0, 16), rng.randrange(0, 255), 0])
    if rng.random() < .5:
        wd = (B[576 + 2 * idx] << 8) | B[577 + 2 * idx]
        wd = (wd | 8) if rng.random() < .5 else (wd & ~8)
        B[576 + 2 * idx] = wd >> 8; B[577 + 2 * idx] = wd & 255
    c.apply([(w.b, bytes(B)), (A4 - 18148, struct.pack('>h', idx)), (A4 - 15100, struct.pack('>H', 7)),
             (A4 - 15128, struct.pack('>H', 7)), (A4 - 18610, struct.pack('>H', 5))])
    return idx


def make_kind_vectors(n, seed, kind):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    if kind == 4:
        c._stub(c_off('LAB_05B1'), 'LAB_05B1', log=4); c._stub(c_off('LAB_05CD'), 'LAB_05CD', log=2)
    while len(out) < n:
        w = World(c, rng)
        idx = entity_world(c, rng, w)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            if kind == 4: res = c.run_call(KIND4, [], seed3); res['fell'] = False
            else: res = run_mid(c, KIND5, KIND5_END, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'slot': w.slot, 'idx': idx}))
    return out


MAKERS['kind4'] = lambda n, s: make_kind_vectors(n, s, 4)
MAKERS['kind5'] = lambda n, s: make_kind_vectors(n, s, 5)


def make_zone_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_078D'), 'LAB_078D', log=2)
    while len(out) < n:
        w = World(c, rng)
        zb = bytearray(rb(rng, 96))
        for k in range(96):
            if rng.random() < .4: zb[k] = 0
        c.apply([(w.a + 1082, bytes(zb))])
        mp = rng.choice([5, 12, 12, 8, 8, 3, 1, 13])
        fl = rng.randrange(0, 12); x = rng.randrange(8); y = rng.randrange(8)
        if rng.random() < .6:                              # a cell whose zone bit is set
            cells = [k for k in range(768) if zb[k >> 3] >> (k & 7) & 1]
            k = rng.choice(cells); fl, y, x = k >> 6, (k >> 3) & 7, k & 7
        c.apply([(A4 - 18340, struct.pack('>h', mp)), (A4 - 18330, struct.pack('>h', fl)), (A4 - 18334, struct.pack('>h', x)),
                 (A4 - 18332, struct.pack('>h', y)), (A4 - 18136, struct.pack('>h', rng.choice([0, 1, 1, 2]))),
                 (A4 - 10894, struct.pack('>H', rng.choice([0, 1]))), (A4 - 10890, struct.pack('>H', rng.choice([0, 1]))),
                 (A4 - 18610, struct.pack('>H', 5))])
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = run_mid(c, ZONE, ZONE_END, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'fell': res['fell']}))
    return out


MAKERS['zone'] = make_zone_vectors


from combat3 import build_world, ensure_living   # noqa: F401

UPKEEP = 0x1693e
COMPACT = 0x16be2
DECAY = 0x19144
WRITEBACK = 0x1775e
XPSPLIT = 0x5031a
LOOT = 0x4fe28          # LAB_1D7A: after the chest pre-step
LOOT_FULL = 0x4fdd0
POSTFULL = 0x17814


def randomize_members(fx, rng, A4, groups, nmax=9):
    """Random end-of-combat state in every member struct of the given groups (the layout of combat.py's fixtures)."""
    for g in groups:
        base = MEM_BASE + g * MEM_STRIDE
        for i in range(nmax):
            o = base + i * 44
            mx = rng.randrange(1, 80)
            w16(fx, o + 4, mx); w16(fx, o + 2, rng.choice([mx, rng.randrange(-3, mx + 1), 1, 0, 2]))
            smx = rng.randrange(0, 60); w16(fx, o + 8, smx); w16(fx, o + 6, rng.choice([smx, rng.randrange(-2, smx + 1), 0]))
            w8(fx, o + 16, rng.choice([0, 0, 1, 5, 12]))
            for k in range(14, 24): w8(fx, o + k, rng.choice([0, 0, 0, 1, 2, 7, 255]))
            w8(fx, o + 34, rng.choice([0, 0, 0, 1, 2, 3]))
            w8(fx, o + 35, rng.choice([0, 0, 1, 3, 9]))
            w8(fx, o + 36, rng.choice([0, 0, 1, 4]))
            w8(fx, o + 41, rng.choice([0, 0, 1, 5, 0xff, 0xfb]))
            w8(fx, o + 42, rng.choice([0xff, 0xff, rng.randrange(0, 46)]))
            w8(fx, o + 43, rng.choice([0, 0, 1, 2, 3]))


def make_upkeep_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 6), party=rng.randrange(1, 5))
        randomize_members(fx, rng, A4, range(0, 7))
        for g in range(1, 7):
            r = REC_MON_BASE + g * REC_MON_STRIDE
            w8(fx, r + 220, rng.randrange(0, 8)); w8(fx, r + 218, rng.randrange(0, 200))
        g = rng.choice([0, 0, 1, 2, 3, 4, 5, 6]); i = rng.randrange(0, 9)
        a = rng.choice([0, 0, 1, 3, 20, 50]); b = rng.choice([0, 0, 1, 2, 5])
        if rng.random() < .3: w8(fx, MEM_BASE + g * MEM_STRIDE + i * 44 + 35, rng.choice([2, 9, 30]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(UPKEEP, [g, i, a, b], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'g': g, 'i': i, 'a': a, 'b': b, 'ret': res['ret']}))
    return out


MAKERS['upkeep'] = make_upkeep_vectors


def make_compact_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 6), party=rng.randrange(1, 5))
        randomize_members(fx, rng, A4, range(0, 7))
        for g in range(1, 7):
            r = REC_MON_BASE + g * REC_MON_STRIDE
            w8(fx, r + 220, rng.randrange(0, 8)); w8(fx, r + 218, rng.randrange(0, 200)); w8(fx, r + 215, rng.choice([0, 0, 1, 4, 12]))
        g = rng.choice([1, 2, 3, 4, 5, 6])
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(COMPACT, [g], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'g': g}))
    return out


MAKERS['compact'] = make_compact_vectors


def make_decay_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=rng.randrange(1, 6), party=rng.randrange(1, 5))
        for g in range(7):
            base = MEM_BASE + g * MEM_STRIDE
            for k in range(396, 402): w8(fx, base + k, rng.choice([0, 0, 1, 5, 9, 10, 19, 30, 100, 200]))
            for k in range(402, 406): w8(fx, base + k, rng.choice([0, 0, 1, 3, 20]))
        w16(fx, A4 - 18122, rng.choice([-1, 0, 1, 2])); w16(fx, A4 - 18120, rng.choice([-2, 0, 1, 5]))
        w8(fx, MEM_BASE + 400, rng.choice([0, 3, 9]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(DECAY, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3}))
    return out


MAKERS['decay'] = make_decay_vectors


def make_writeback_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_0A02'), 'LAB_0A02', log=2); c.disabled.add(c_off('LAB_0A02'))
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        randomize_members(fx, rng, A4, [0])
        i = rng.randrange(0, 6)
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(WRITEBACK, [i], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'i': i}))
    return out


MAKERS['writeback'] = make_writeback_vectors


def party_conditions(fx, rng, A4, np_):
    for i in range(6):
        r = A4 - 17922 + i * 0x1b0
        w8(fx, r + 417, rng.choice([0, 0, 0, 1, 2, 3, 4, 5, 8]))
        w8(fx, r + 418, rng.choice([0, 0, 1, 3])); w8(fx, r + 419, rng.choice([0, 0, 1, 2, 6]))


def make_xpsplit_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_1BE6'), 'LAB_1BE6', log=0)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        np_ = rng.randrange(1, 7)
        w16(fx, A4 - 15306, np_)
        party_conditions(fx, rng, A4, np_)
        pool = rng.choice([0, 1, 7, 100, 4321, 99999, 1234567])
        fx.writes.append((A4 - 15300, struct.pack('>I', pool)))
        for i in range(6): fx.writes.append((A4 - 17910 + i * 0x1b0, struct.pack('>I', rng.choice([0, 500, 70000]))))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(XPSPLIT, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'pool': pool}))
    return out


MAKERS['xpsplit'] = make_xpsplit_vectors


def run_mid_big(c, entry, seed, frame, sp_gap=512):
    """combat4.run_mid with a deeper stack gap so the routine's locals (up to sp_gap bytes below A5) survive its pushes."""
    from unicorn.m68k_const import UC_M68K_REG_A5, UC_M68K_REG_A7, UC_M68K_REG_A4, UC_M68K_REG_D0
    c.effects = []; c.written = {}; c.foot = {}; c.rargs = []
    c.seed(*seed)
    a5 = E.STACK_TOP - 0x800
    c.w32(a5, 0); c.w32(a5 + 4, E.RET_MAGIC)
    c.uc.reg_write(UC_M68K_REG_A5, a5); c.uc.reg_write(UC_M68K_REG_A7, a5 - sp_gap); c.uc.reg_write(UC_M68K_REG_A4, c.A4)
    for off, data in frame: c.uc.mem_write(a5 + off, bytes(data))
    c.tracking = True
    try:
        c.uc.emu_start(CODE_BASE + entry, E.RET_MAGIC + 0x100, count=200_000_000)
    finally:
        c.tracking = False
    diffs = {a: c.uc.mem_read(a, 1)[0] for a in c.written}
    return {'foot': c.foot, 'diff': diffs, 'effects': c.effects, 'rng': list(c.state()), 'rargs': [], 'ret': c.uc.reg_read(UC_M68K_REG_D0) & 0xffff}


def treasure_record(c, rng, real_cache={}):
    kind = rng.random()
    if kind < .45:                                      # a real record
        if 'buf' not in real_cache: real_cache['buf'] = c.alloc(64)
        rid = rng.randrange(0, 200)
        c.call(0x9fc, [7, (real_cache['buf'], 4), rid, 0])
        return bytes(c.uc.mem_read(real_cache['buf'], 40))
    out = bytearray(40)
    for k in range(6):
        t = rng.choice([0, 1, 1, 2, 2, 4, 3])
        if t == 1: A = rng.randrange(1, 900); B = rng.randrange(0, A + 1)
        elif t == 2: A = rng.randrange(1, 400); B = rng.randrange(1, 6)
        elif t == 4: A = rng.randrange(1, 50); B = rng.randrange(1, 30)
        else: A = rng.randrange(0, 20); B = rng.randrange(0, 20)
        out[6 * k:6 * k + 2] = struct.pack('>H', A); out[6 * k + 2:6 * k + 4] = struct.pack('>H', B)
        out[6 * k + 4] = t; out[6 * k + 5] = rng.choice([0, 20, 50, 80, 100, 100])
    return bytes(out)


def make_loot_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_1BE6'), 'LAB_1BE6', log=0); c._stub(c_off('LAB_1D2D'), 'LAB_1D2D', log=0)
    c._stub(c_off('LAB_1B5B'), 'LAB_1B5B', log=0); c._stub(c_off('LAB_1B62'), 'LAB_1B62', log=2)
    c._stub(c_off('LAB_1D52'), 'LAB_1D52', log=0)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=4)
        np_ = rng.randrange(1, 7)
        w16(fx, A4 - 15306, np_)
        party_conditions(fx, rng, A4, np_)
        if rng.random() < .15:
            for i in range(6): w8(fx, A4 - 17922 + i * 0x1b0 + 417, rng.choice([1, 2, 3]))
        for i in range(6):
            fx.writes.append((A4 - 17910 + i * 0x1b0, struct.pack('>I', rng.choice([0, 500, 70000]))))
            fx.writes.append((A4 - 17902 + i * 0x1b0, struct.pack('>I', rng.choice([0, 20, 5000]))))
        w16(fx, A4 - 18608, rng.choice([0xf, 0x15]))
        rec = treasure_record(c, rng)
        ids = set()
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = run_mid_big(c, LOOT, seed3, [(-44, rec)])
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        # item records the routine asked for: replay ReadSection(1, id) for every id in the item list it built
        cnt = struct.unpack('>h', bytes(c.uc.mem_read(A4 - 3114, 2)))[0]
        items = {}
        for k in range(max(0, min(cnt, 6))):
            iid = struct.unpack('>h', bytes(c.uc.mem_read(A4 - 5446 + 2 * k, 2)))[0]
            items[str(iid)] = item_bytes(c, iid).hex()
        out.append(pack(c, res, {'seed': seed3, 'rec': rec.hex(), 'items': items}))
    return out


from combat4 import item_bytes   # noqa: E402
MAKERS['loot'] = make_loot_vectors


def make_postfull_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    A4 = c.A4
    c._stub(c_off('LAB_0A1E'), 'LAB_0A1E', log=2)
    while len(out) < n:
        fx, ng, counts = build_world(c, rng, ngroups=1, party=rng.randrange(1, 7))
        np_ = rng.randrange(1, 7)
        w16(fx, A4 - 15306, np_)
        g0 = MEM_BASE
        w8(fx, g0 + 413, np_)
        randomize_members(fx, rng, A4, [0], 6)
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            w8(fx, r + 417, rng.choice([0, 0, 0, 1, 2, 3, 4, 5, 8]) if rng.random() < .7 else rng.choice([2, 3, 5]))
            w8(fx, r + 418, rng.choice([0, 0, 1, 4])); w8(fx, r + 419, rng.choice([0, 0, 1, 2, 9]))
            w8(fx, r + 416, rng.randrange(0, 6)); w8(fx, r + 414, rng.randrange(0, 6))
        for k in range(6):
            w16(fx, A4 - 15330 + 2 * k, rng.randrange(0, 500)); w16(fx, A4 - 15318 + 2 * k, rng.randrange(0, 500))
        w16(fx, A4 - 18608, rng.choice([0, 5, 0x12])); w16(fx, A4 - 15130, rng.choice([0, 0, 1]))
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(POSTFULL, [], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3}))
    return out


MAKERS['postfull'] = make_postfull_vectors


if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

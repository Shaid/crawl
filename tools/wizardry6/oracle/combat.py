"""Wizardry 6 (Amiga) combat oracle: runs Bane's attack resolver LAB_0CD0
(CODE+0x1f33e) under the Unicorn single-routine core against synthetic party / monster
state, and records, per vector:

  * the INPUT FOOTPRINT - every byte of the data hunk / heap the routine read (first value seen),
    so the TypeScript port (tools/wizardry6/combat.ts) is run against exactly those bytes
    and fails loudly if it ever reads one the game did not;
  * the WRITES - every byte that ended up different;
  * the EFFECT LOG - calls to the routines stubbed out (UI, sound, status application,
    spell dispatcher) with their raw stack arguments;
  * the random generator state after.

UI and presentation callees are replaced by recording no-ops; everything that decides
(random generator, divide helper, bit tests, ReadSection) is the game's own code.

Usage: combat.py vectors OUT.json [--n N] [--seed S]
"""
import json, os, re, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import *
from w6 import W6
from rules import load_jt, Rules, REC_BASE, REC_SIZE
from unicorn.m68k_const import *

ATTACK = 0x1f33e
# Presentation / sound / window / delay callees of the attack resolver (CODE offsets).
UI_FUNCS = {0x21bf0: 'name', 0x21c50: 'win50', 0x21d44: 'win44', 0x21d90: 'win90', 0x21db6: 'winb6',
            0x225f8: 'portrait', 0x229e4: 'tick', 0x22ae0: 'ae0', 0x22afa: 'delay', 0x22b52: 'b52',
            0x24862: 'anim', 0x22ea6: 'status_msg'}
# Logic callees that are recorded (their effect is a separate harness): name -> offset
LOGGED = {0x22278: ('use_ammo', 2), 0x2300c: ('set_status', 14), 0x1ede0: ('weapon_proc', 12), 0x24ea0: ('spell_effect', 8)}
KEEP_JT = {-32652, -32664, -32490, -32496}      # Random, ReadSection, TestBit, SetBit
G = {'ag': -15138, 'ai': -15136}
MEM_ARR, MREC_ARR = -15266, -15294
RNG_ADDR = CODE_BASE + 0x1728
MEM_BASE, MEM_STRIDE = 0x400000, 0x400     # member-array structs, group g at MEM_BASE+g*STRIDE
REC_MON_BASE, REC_MON_STRIDE = 0x420000, 0x400   # 222-byte monster records


class Combat(W6):
    seed = Rules.seed; state = Rules.state; random = Rules.random

    def __init__(self):
        super().__init__(trace_unknown_lvo=False)
        self.boot()
        self.effects = []
        jt = load_jt(self)
        self.jt = jt
        for d, off in jt.items():
            if off < 0x54000 and d not in KEEP_JT and off not in (0x25a6, 0x40d0):
                self._stub(off, 'jt%d' % d)
        for off, nm in UI_FUNCS.items(): self._stub(off, nm, log=False)
        for off, (nm, n) in LOGGED.items(): self._stub(off, nm, log=n)
        self.written = {}; self.foot = {}
        self.tracking = False
        # data hunk, BSS and heap; the stack (0x1E0000-0x1F0000) is excluded
        for lo, hi in ((DATA_BASE, 0x1E0000 - 1), (HEAP_BASE, HEAP_END)):
            self.uc.hook_add(UC_HOOK_MEM_READ, self._rd, begin=lo, end=hi)
            self.uc.hook_add(UC_HOOK_MEM_WRITE, self._wr, begin=lo, end=hi)
        self.uc.hook_add(UC_HOOK_MEM_READ, self._rd, begin=RNG_ADDR, end=RNG_ADDR + 5)
        self.uc.hook_add(UC_HOOK_MEM_WRITE, self._wr, begin=RNG_ADDR, end=RNG_ADDR + 5)

    def _stub(self, off, name, log=False):
        addr = CODE_BASE + off
        def hook(uc, a, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            if log and self.tracking:
                self.effects.append([name, bytes(uc.mem_read(sp + 4, log)).hex()])
            uc.reg_write(UC_M68K_REG_D0, 0)
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
            uc.reg_write(UC_M68K_REG_PC, self.r32(sp))
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)

    def _rd(self, uc, access, addr, size, value, ud):
        if not self.tracking: return
        for a in range(addr, addr + size):
            if a not in self.written and a not in self.foot:
                self.foot[a] = uc.mem_read(a, 1)[0]
    def _wr(self, uc, access, addr, size, value, ud):
        if not self.tracking: return
        for a in range(addr, addr + size):
            if a not in self.written:
                self.written[a] = uc.mem_read(a, 1)[0]

    # -- fixture application / running --------------------------------------
    def apply(self, writes):
        for a, b in writes: self.uc.mem_write(a, bytes(b))

    def run_attack(self, target, hand, kind, seed):
        self.effects = []; self.written = {}; self.foot = {}
        self.seed(*seed)
        self.tracking = True
        self.a5 = STACK_TOP - 16
        try:
            ret = self.call(ATTACK, [(target, 4), hand, kind])
        finally:
            self.tracking = False
        diffs = {a: self.uc.mem_read(a, 1)[0] for a in self.written}   # every byte written, final value
        self.ibuf = bytes(self.uc.mem_read(self.a5 - 74, 32)).hex()
        return {'foot': self.foot, 'diff': diffs, 'effects': self.effects, 'rng': list(self.state())}


# ---------------------------------------------------------------------------
# fixture generation
import random as pyrandom

SUBTYPES = list(range(0, 24)) + [0x26, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x59, 0x5a, 0x62, 0x63, 0xff]


class Fixture:
    """A synthetic encounter: party records, member arrays, monster records, globals."""
    def __init__(self, c, rng):
        self.c, self.rng = c, rng
        self.writes = []          # (absolute address, bytes)
        self.items = {}           # item id -> word 24 of its scenario record

    def put(self, addr, data): self.writes.append((addr, bytes(data)))
    def rb(self, n, hi): return bytes(self.rng.randrange(hi + 1) for _ in range(n))

    def build(self, ag, ai, tg, ti, hand, kind):
        c, rng, A4 = self.c, self.rng, self.c.A4
        w16 = lambda a, v: self.put(a, struct.pack('>H', v & 0xffff))
        w32 = lambda a, v: self.put(a, struct.pack('>I', v & 0xffffffff))
        for g in range(6):
            w32(A4 + MEM_ARR + 4 * g, MEM_BASE + g * MEM_STRIDE)
            w32(A4 + MREC_ARR + 4 * g, REC_MON_BASE + g * REC_MON_STRIDE)
        w16(A4 - 15138, ag); w16(A4 - 15136, ai)
        # globals read by the resolver
        w16(A4 - 18606, 1 if rng.random() < 0.08 else 0)           # -0x48ae: debug/auto-hit
        w16(A4 - 18134, rng.choice([0, 0, 1, 2])); w16(A4 - 18132, rng.randrange(0, 6))
        w16(A4 - 18126, rng.choice([0, 0, 1, 2])); w16(A4 - 18124, rng.randrange(0, 6))
        w16(A4 - 15134, rng.randrange(0, 12))
        w16(A4 - 15126, rng.randrange(2))
        w16(A4 - 18602, rng.randrange(0, 8)); w16(A4 - 18598, rng.randrange(0, 8))
        # party records
        for i in range(6):
            r = A4 - 17922 + i * 0x1b0
            rec = bytearray(self.rb(0x1b0, 6))
            cap = rng.randrange(60, 400)
            cur = rng.choice([rng.randrange(0, cap), int(cap * rng.uniform(0.4, 1.05))])
            rec[32:34] = struct.pack('>H', cur); rec[34:36] = struct.pack('>H', cap)
            rec[30:32] = struct.pack('>H', rng.randrange(10, 300))
            rec[36:38] = struct.pack('>H', rng.randrange(1, 25))
            n_items = rng.randrange(0, 12)
            rec[428] = n_items; rec[429] = rng.randrange(0, 3)
            for s in range(30):
                o = 64 + 8 * s
                iid = rng.randrange(1, 200)
                rec[o:o + 2] = struct.pack('>H', iid); rec[o + 2:o + 4] = struct.pack('>H', rng.randrange(0, 5))
                rec[o + 4] = rng.randrange(0, 16); rec[o + 5] = rng.choice(SUBTYPES); rec[o + 6] = rng.randrange(0, 3)
            for h in range(8): rec[272 + h] = 0xff
            if n_items:
                rec[272] = rng.choice([0xff, rng.randrange(n_items), rng.randrange(n_items)])
                rec[273] = rng.choice([0xff, rng.randrange(n_items), rng.randrange(n_items)])
            for k in range(30): rec[308 + k] = rng.choice([rng.randrange(0, 40), rng.randrange(0, 101)])
            rec[415] = rng.randrange(14)
            for b in (240, 256):   # weapon blocks: dice word, count, sides, proc percents
                rec[b:b + 2] = struct.pack('>h', rng.randrange(-3, 8)); rec[b + 2] = rng.randrange(0, 4); rec[b + 3] = rng.randrange(1, 10)
                for j in range(8): rec[b + 4 + j] = rng.choice([0, 0, 0, 20, 100])
            rec[254] = rng.randrange(0, 12) if rng.random() < .8 else rng.randrange(0, 256)
            rec[270] = rng.randrange(0, 6); rec[430] = rng.randrange(0, 8)
            for j in (425, 426): rec[j] = rng.randrange(0, 5)
            self.put(r, rec)
            # slot item spell words for ReadSection (computed by the oracle)
            for s in range(30): self.items[struct.unpack('>H', bytes(rec[64 + 8 * s:66 + 8 * s]))[0]] = None
        # member arrays: 9 members x 44 + group trailer
        for g in range(6):
            m = bytearray(self.rb(0x1c0, 3))
            for j in range(9):
                o = j * 44
                maxhp = rng.randrange(1, 80)
                m[o:o + 2] = struct.pack('>H', maxhp)
                m[o + 2:o + 4] = struct.pack('>H', rng.randrange(1, 90))
                m[o + 4:o + 6] = struct.pack('>H', rng.randrange(1, 90))
                smax = rng.randrange(1, 120)
                m[o + 6:o + 8] = struct.pack('>H', rng.randrange(0, smax + 1)); m[o + 8:o + 10] = struct.pack('>H', smax)
                m[o + 10:o + 12] = struct.pack('>H', rng.choice([0, 1, 2, 3, 5]))
                for b in (0x0f, 0x10, 0x11, 0x12, 0x16, 0x17): m[o + b] = rng.choice([0, 0, 0, 0, 1, 5])
                m[o + 0x1e] = rng.choice([0, 0, 0, 1, 7, 10]); m[o + 0x22] = rng.choice([0, 0, 0, 0, 1, 2, 2, 3])
                m[o + 0x1f] = rng.randrange(6); m[o + 0x20] = rng.randrange(9)
                for b in (0x26, 0x27, 0x28, 0x29): m[o + b] = rng.choice([0, 1, 2, 255, 254, 3, rng.randrange(256)])
                m[o + 0x2b] = rng.choice([0, 0, 0, 1, 0xff])
            m[0x18e] = rng.choice([0, 0, 10, 50])
            self.put(MEM_BASE + g * MEM_STRIDE, m)
            mr = bytearray(self.rb(222, 5))
            for b in range(0x44, 0x84, 16):
                mr[b:b + 2] = struct.pack('>h', rng.randrange(-2, 9)); mr[b + 2] = rng.randrange(0, 4); mr[b + 3] = rng.randrange(1, 9)
                for j in range(4, 12): mr[b + j] = rng.choice([0, 0, 0, 30, 100])
            mr[0x40:0x44] = struct.pack('>I', rng.randrange(0, 1000))
            for b in range(0x83, 0x87): mr[b] = rng.choice([0, 1, 2, 3, 4, 7, 0x20, 0x22, 0x12])
            for b in (0x86,): mr[b] = rng.randrange(0, 20)
            for b in range(0x87, 0x8a): mr[b] = rng.randrange(0, 30)
            for t in (0xae, 0xb6):
                for j in range(8): mr[t + j] = rng.choice([0, 5, 10, 20, 30])
            mr[0xbe:0xc6] = bytes(rng.choice([0, 1, 2, 5, 10, 246, 250, 253, 255]) for _ in range(8))
            mr[0xc6:0xcf] = bytes(rng.choice([0, 1, 2, 3, 253, 254, 255]) for _ in range(9))
            mr[0xd0] = rng.choice([0, 0, 1, 0x11, 0x16, 0x20]); mr[0xd2] = rng.randrange(0, 8)
            mr[212] = rng.randrange(1, 9)
            self.put(REC_MON_BASE + g * REC_MON_STRIDE, mr)
        return self


_IW = {}


def itemword28(c, iid):
    """Word at +28 of item `iid`'s scenario record (section 1), read by the game's own ReadSection."""
    if iid not in _IW:
        if 'buf' not in _IW: _IW['buf'] = c.alloc(256)
        buf = _IW['buf']
        c.call(0x9fc, [1, (buf, 4), iid, 0])
        _IW[iid] = c.r16(buf + 28)
    return _IW[iid]


def make_vectors(n, seed):
    rng = pyrandom.Random(seed)
    c = Combat()
    base_state = None
    out = []
    A4 = c.A4
    for v in range(n):
        fam = rng.choices(['pm', 'mp', 'mm'], [5, 4, 1])[0]
        if fam == 'pm':   ag, ai, tg, ti = 0, rng.randrange(4), rng.randrange(1, 6), rng.randrange(0, 9)
        elif fam == 'mp': ag, ai, tg, ti = rng.randrange(1, 6), rng.randrange(0, 9), 0, rng.randrange(4)
        else:             ag, ai, tg, ti = rng.randrange(1, 6), rng.randrange(0, 9), rng.randrange(1, 6), rng.randrange(0, 9)
        hand = rng.choice([0, 1, 0, 1, 2, 3]) if ag else rng.choice([0, 1])
        kind = rng.randrange(0, 9)
        fx = Fixture(c, rng).build(ag, ai, tg, ti, hand, kind)
        T = MEM_BASE + ag * MEM_STRIDE + ai * 44          # the ATTACKER's member struct (param 1)
        fx.writes.append((T + 0x1f, bytes([tg, ti])))      # its chosen target group / member
        c.apply(fx.writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        items = {}
        for iid in fx.items: items[iid] = itemword28(c, iid)
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_attack(T, hand, kind, seed3)
        except RuntimeError as e:
            print('skip', v, fam, ag, ai, tg, ti, hand, kind, str(e)[-60:], file=sys.stderr); continue
        out.append({'fam': fam, 'ag': ag, 'ai': ai, 'tg': tg, 'ti': ti, 'hand': hand, 'kind': kind, 'T': T,
                    'seed': seed3, 'a4': A4,
                    'foot': {str(a): b for a, b in res['foot'].items() if not (RNG_ADDR <= a < RNG_ADDR + 6)},
                    'diff': {str(a): b for a, b in res['diff'].items() if not (RNG_ADDR <= a < RNG_ADDR + 6)},
                    'effects': res['effects'], 'rng': res['rng'], 'items': items, 'ibuf': c.ibuf})
    return out


def pick_subset(V, n=110):
    """A small committed subset: every effect kind, stance resets, all attack kinds, both sides."""
    chosen, seen = [], set()
    def feat(v):
        f = {'fam:' + v['fam'], 'kind%d' % v['kind']} | {'fx:' + e[0] for e in v['effects']}
        if any((int(a) - 0x400000) % 0x400 % 44 == 0x1e for a in v['diff'] if int(a) >= 0x400000): f.add('stance')
        return f
    for v in V:                      # greedy: first vector that brings a new feature
        f = feat(v)
        if f - seen: chosen.append(v); seen |= f
    for v in V:
        if len(chosen) >= n: break
        if v not in chosen: chosen.append(v)
    for v in chosen: v.pop('ibuf', None)
    return chosen


if __name__ == '__main__':
    if sys.argv[1] == 'subset':
        V = json.load(open(sys.argv[2]))
        sub = pick_subset(V)
        json.dump(sub, open(sys.argv[3], 'w'), separators=(',', ':'))
        print(len(sub), 'vectors in subset')
    if sys.argv[1] == 'vectors':
        n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 200
        seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1
        v = make_vectors(n, seed)
        json.dump(v, open(sys.argv[2], 'w'), separators=(',', ':'))
        print(len(v), 'vectors')

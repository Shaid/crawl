"""Wizardry 6 (Amiga) rules oracle: runs Bane's own pure-computation routines
under the Unicorn core (see emu.py) and dumps input/output vectors for the TypeScript
ports in tools/wizardry6/rules.ts.

Single-routine harness, not a system emulator. Routines that draw or print are
run with their UI callees replaced by no-ops (UI_STUBS); everything that
touches game state (the random generator, the 432-byte character records at
A4-17922, the level-up arithmetic) is the game's own code.

Usage:  rules.py vectors OUT.json [--seed N]
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import *
from w6 import W6
from unicorn.m68k_const import *

REC_BASE = -17922        # A4 displacement of party record 0 (pcfile record layout)
REC_SIZE = 0x1B0
RNG_STATE = 0x1728       # CODE offset of the 3-word generator state (LAB_00E0)
RANDOM = 0xb9c           # Random(n) wrapper (LAB_0063)
RAW_RNG = 0x2138         # LAB_0147: raw 19-bit generator
LEVEL_HP = 0x3db86       # LAB_16B3: level-up HP/stamina gain
LEVEL_ATTR = 0x3e688     # LAB_16EA: level-up random attribute raise
SPELL_TIER = 0x3e86e     # LAB_16F1: spell-realm tier from level
# Jump-table displacements the routines above use for UI work only.
UI_JT = (-32730, -32688, -32676, -32700, -32682, -32736, -32724)
UI_PC = (0x3d5f0,)       # LAB_16A2 (PC-relative message-line helper)

def load_jt(e):
    d = -32652
    while d > -32768: d -= 6
    d += 6
    out = {}
    for disp in range(d, 0, 6):
        a = e.A4 + disp
        if e.r16(a) == 0x4ef9: out[disp] = e.r32(a + 2) - CODE_BASE
        elif out: break
    return out

class Rules(Emu):
    def __init__(self):
        super().__init__(trace_unknown_lvo=False)
        self.jt = load_jt(self)
        self.ui_calls = 0
        for off in [self.jt[d] for d in UI_JT] + list(UI_PC):
            self._noop(off)

    def _noop(self, off):
        addr = CODE_BASE + off
        def hook(uc, a, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            ret = self.r32(sp)
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
            uc.reg_write(UC_M68K_REG_PC, ret)
            self.ui_calls += 1
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)

    # -- RNG ---------------------------------------------------------------
    def seed(self, s1, s2, s3):
        a = self.code(RNG_STATE)
        self.w16(a, s1); self.w16(a + 2, s2); self.w16(a + 4, s3)
    def state(self):
        a = self.code(RNG_STATE)
        return (self.r16(a), self.r16(a + 2), self.r16(a + 4))
    def raw(self): return self.call(RAW_RNG)
    def random(self, n):
        r = self.call(RANDOM, [n & 0xffff]) & 0xffff
        return r - 0x10000 if r & 0x8000 else r

    # -- character record --------------------------------------------------
    def rec(self, i=0): return self.A4 + REC_BASE + i * REC_SIZE

CHECK_LEVEL = 0x3eade    # LAB_16FE: while xp >= threshold(level): LevelUp (LAB_16F9)
LEVEL_UP = 0x3e930       # LAB_16F9: one level (display + effects), stubbed here
XP_UI = (0x13c, 0x33f8, 0xbba, 0x366, 0xc10, 0x38c)   # window create / draw / clear helpers


class XpRules(W6):
    """W6 state (scenario.dbs through the game's own ReadSection) + UI stubs, to run
    CheckLevelUp with LevelUp replaced by a counter."""
    def __init__(self):
        super().__init__(trace_unknown_lvo=False)
        self.boot()
        self.levelups = 0
        for off in XP_UI:
            self._noop2(off, 1)
        a = self.code(LEVEL_UP)
        def lu(uc, ad, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            self.levelups += 1
            rec = self.A4 + REC_BASE + self.r16(sp + 4 + 8) * REC_SIZE   # args: long, long, word @ sp+4,+8,+12
            self.w16(rec + 36, self.r16(rec + 36) + 1)
            ret = self.r32(sp)
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
            uc.reg_write(UC_M68K_REG_PC, ret)
        self.uc.hook_add(UC_HOOK_CODE, lu, begin=a, end=a)
    def _noop2(self, off, d0):
        addr = CODE_BASE + off
        def hook(uc, a, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            uc.reg_write(UC_M68K_REG_D0, d0)
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
            uc.reg_write(UC_M68K_REG_PC, self.r32(sp))
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)


def xp_vectors(rng):
    x = XpRules()
    base = x.A4 + REC_BASE
    out = []
    for _ in range(300):
        cls = rng.randrange(14)
        lvl = rng.choice([1, 2, 3, 5, 8, 12, 15, 16, 17, 18, 20, 30])
        xp = rng.choice([0, 999, 1000, 1001, 2000, 5000, 20000, 150000, 1000000, 3000000, 5000000, 9000000])
        xp = rng.choice([xp, xp + rng.randrange(0, 200000)])
        x.uc.mem_write(base, bytes(REC_SIZE))
        x.w8(base + 415, cls); x.w16(base + 36, lvl); x.w32(base + 12, xp)
        x.levelups = 0
        x.call(CHECK_LEVEL, [0])
        out.append({'cls': cls, 'level': lvl, 'xp': xp, 'levelsGained': x.levelups, 'finalLevel': x.r16(base + 36)})
    return out


def make_vectors(seed=1):
    import random as pyrandom
    rng = pyrandom.Random(seed)
    e = Rules()
    out = {'note': 'generated by tools/wizardry6/oracle/rules.py; do not edit', 'seedArg': seed}
    # 1. Random / raw generator
    rv = []
    for _ in range(40):
        st = [rng.randrange(1, 30000) for _ in range(3)]
        e.seed(*st)
        seq = []
        for n in [1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 100, 0, -3, 300]:
            before = e.state()
            v = e.random(n)
            seq.append([n, v])
        rv.append({'seed': st, 'calls': seq, 'after': list(e.state())})
    out['random'] = rv
    rw = []
    for _ in range(30):
        st = [rng.randrange(1, 30000) for _ in range(3)]
        e.seed(*st)
        vals = [e.raw() for _ in range(8)]
        rw.append({'seed': st, 'raw': vals})
    out['raw'] = rw
    # 2. level-up HP / stamina (LAB_16B3)
    lv = []
    base = e.rec(0)
    for cls in range(14):
        for _ in range(60):
            st = [rng.randrange(1, 30000) for _ in range(3)]
            lvl = rng.randrange(2, 30)
            thr = rng.choice([0, 0, 0, lvl + 3, lvl])   # rec+431: >level forces the 1/1 branch
            str_, vit = rng.randrange(3, 25), rng.randrange(3, 25)
            e.uc.mem_write(base, bytes(REC_SIZE))
            e.w8(base + 415, cls); e.w8(base + 300, str_); e.w8(base + 303, vit)
            e.w16(base + 36, lvl); e.w8(base + 431, thr)
            for off, v in ((24, 50), (26, 60), (28, 40), (30, 45)): e.w16(base + off, v)
            e.seed(*st)
            e.call(LEVEL_HP, [(0x300000, 4), (0x300000, 4), 0], absolute=False)
            lv.append({'cls': cls, 'str': str_, 'vit': vit, 'level': lvl, 'thr431': thr, 'seed': st,
                       'hpGain': e.r16(base + 26) - 60, 'hpCurGain': e.r16(base + 24) - 50,
                       'stGain': e.r16(base + 30) - 45, 'stCurGain': e.r16(base + 28) - 40,
                       'after': list(e.state())})
    out['levelHp'] = lv
    # 3. level-up attribute raise (LAB_16EA)
    la = []
    for _ in range(120):
        st = [rng.randrange(1, 30000) for _ in range(3)]
        e.uc.mem_write(base, bytes(REC_SIZE))
        attrs = [rng.choice([3, 10, 16, 17, 18, 19, 25]) for _ in range(8)]
        for i, a in enumerate(attrs): e.w8(base + 300 + i, a)
        e.seed(*st)
        e.call(LEVEL_ATTR, [(0x300000, 4), (0x300000, 4), 0])
        la.append({'attrs': attrs, 'seed': st, 'after': [e.r8(base + 300 + i) for i in range(8)],
                   'rng': list(e.state())})
    out['levelAttr'] = la
    # 4. spell tier (LAB_16F1)
    ls = []
    for lvl in range(1, 40):
        for cur in (0, 3, 9):
            e.uc.mem_write(base, bytes(REC_SIZE))
            e.w16(base + 36, lvl); e.w8(base + 416, cur)
            e.call(SPELL_TIER, [0])
            ls.append({'level': lvl, 'cur': cur, 'after': e.r8(base + 416)})
    out['spellTier'] = ls
    out['uiCalls'] = e.ui_calls
    out['checkLevelUp'] = xp_vectors(rng)
    sc = open(os.path.join(DATA, 'scenario.dbs'), 'rb').read()
    out['xpTables'] = [list(struct.unpack('>16I', sc[64 * i:64 * i + 64])) for i in range(14)]
    return out

if __name__ == '__main__':
    if sys.argv[1] == 'vectors':
        seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1
        v = make_vectors(seed)
        json.dump(v, open(sys.argv[2], 'w'), separators=(',', ':'))
        print({k: (len(x) if isinstance(x, list) else x) for k, x in v.items()})

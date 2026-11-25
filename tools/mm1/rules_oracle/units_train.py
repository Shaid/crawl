"""Training / level-up units (CODE+0x2A3A right6 pieces, CODE+0x1B68 training commit)."""
from common import *

UI = [PTEXT, uistub('ph2', 0x40e1), uistub('pdec', 0x4030), uistub('cout', 0x3fff)]

@unit('xpthr')
def _(n, rnd):
    """XP threshold + gold cost for the next level: CODE+0x2A92..0x2BA3 (class table / doubling / increment)"""
    def mk(e, r):
        a = pickchar(e, r)
        lv = r.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 50, 100, r.randint(1, 199)])
        e.wb(a + 0x14, r.choice([1, 2, 3, 4, 5, 6, 6, 0, 7, r.randint(0, 255)]))
        e.wb(0x15d1, lv)
        return [lv], {}
    return run_n(n, rnd, mk, 0x2a92, stop=0x2ba3)

@unit('xpcmp')
def _(n, rnd):
    """CODE+0x2BA3..: (threshold - XP) as a 32-bit subtract; stop 0x2BD4 = XP exceeds threshold (can train), 0x2C5F = needs more"""
    def mk(e, r):
        a = pickchar(e, r)
        thr = r.choice([r.getrandbits(32), r.getrandbits(20), r.randint(1500, 400000)])
        xp = thr + r.choice([0, 0, 1, -1, r.randint(-1000, 1000), r.getrandbits(18) - (1 << 17)])
        xp &= 0xffffffff
        e.wbytes(a + 0x27, xp.to_bytes(4, 'little'))
        e.wbytes(0x15d3, thr.to_bytes(4, 'little'))
        return [thr, xp], {}
    return run_n(n, rnd, mk, 0x2ba3, stops=(0x2bd4, 0x2c5f))

@unit('traingold')
def _(n, rnd):
    """CODE+0x2C2E..0x2C5E: gold after paying the training cost (24-bit), cantrg/cantrex flags"""
    def mk(e, r):
        a = pickchar(e, r)
        g = r.choice([r.getrandbits(24), r.randint(0, 5000), r.randint(0, 100000)])
        cost = r.choice([g, g + 1, max(0, g - 1), r.randint(0, 40000), r.getrandbits(16)]) & 0xffffff
        e.wbytes(a + 0x39, g.to_bytes(3, 'little')); e.wbytes(0x15de, cost.to_bytes(3, 'little'))
        e.wb(0x15e4, r.choice([0, 0, 1])); e.wb(0x15e5, r.choice([0, 0, 1]))
        return [g, cost], {}
    return run_n(n, rnd, mk, 0x2c2e, stop=0x2c5e)

@unit('levelup')
def _(n, rnd):
    """CODE+0x1B68..0x1D54: the training commit (gold paid, level+1, age+1, HP roll + END bonus, spell level)"""
    def mk(e, r):
        a = pickchar(e, r)
        e.wb(a + 0x14, r.choice([1, 2, 3, 4, 5, 6, 6, 0, 7, r.randint(0, 255)]))
        e.wb(a + 0x23, r.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, r.randint(0, 255)]))
        e.wb(a + 0x1b, r.choice([r.randint(1, 8), r.randint(9, 45), r.randint(0, 255)]))
        e.wb(a + 0x3f, r.choice([0, 0, 0, 0, 1, 0x40]))
        e.wb(0x15e5, r.choice([0, 1, 1, 1, 1])); e.wb(0x15e4, r.choice([0, 1, 1, 1, 1]))
        e.wbytes(0x15e1, [r.getrandbits(8) for _ in range(3)])
        return [], {}
    return run_n(n, rnd, mk, 0x1b68, stub=[uistub('msg247d', 0x247d), uistub('nogold', 0x2437), uistub('noises', 0x1ab3)],
                 stops=(0x1b28, 0x1b1a, 0x1d54))

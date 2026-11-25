"""Combat units: to-hit/damage roll, party attack setup, monster attack setup, damage application, initiative."""
from common import *

MONBASE, MONSLOT = 0x2e80, 0x20
MONTAB = 0x3c58          # 15 word pointers into the monster slots (in turn order)
NMON = 0x3c1d            # live monster count
MONAC, MONCON, MONHP = 0x386a, 0x3879, 0x3888

def mon_setup(e, r, count=None):
    cnt = count if count is not None else r.choice([1, 1, 2, 3, 4, 5, 8, 12, 15, r.randint(1, 15)])
    e.wb(NMON, cnt)
    order = r.sample(range(15), 15)
    for i in range(15): e.ww(MONTAB + 2 * i, MONBASE + MONSLOT * order[i])
    for k in range(15):
        a = MONBASE + MONSLOT * k
        e.wbytes(a, [r.getrandbits(8) for _ in range(MONSLOT)])
        e.wb(a + 0x13, r.choice([0, 1, 2, 4, 6, 8, 10, 12, 20, 30, r.randint(0, 255)]))
        e.wb(a + 0x14, r.choice([1, 1, 2, 3, 4, r.randint(0, 6)]))
        e.wb(a + 0x1a, r.choice([0, 0, 0x80, 0x40, r.getrandbits(8)]))
        e.wb(a + 0x1c, r.choice([0, 3, 6, 0x83, r.getrandbits(8)]))
        e.wb(MONAC + k, r.choice([0, 3, 6, 10, 20, 40, r.randint(0, 255)]))
        e.wb(MONHP + k, r.choice([1, 5, 10, 30, 60, 100, r.randint(0, 255)]))
        e.wb(MONCON + k, r.choice([0, 0, 0, 0, 0x10, 0x20, 0x40, 0x80, 0x01, r.getrandbits(8)]))
        e.wb(0x3c29 + k, r.choice([0, 1, 2, 3, 5, 8, 12, r.randint(0, 40)]))

def party_fx(e, r):
    """party effect bytes DS:3C9D..3CA6 (mostly zero)"""
    for off in range(0x3c9d, 0x3ca7):
        e.wb(off, r.choice([0, 0, 0, 0, 1, r.randint(1, 20)]))

@unit('rolldmg')
def _(n, rnd):
    def mk(e, r):
        e.wb(0x3840, r.choice([0, 3, 10, 20, 40, 100, 190, 200, 250, r.randint(0, 255)]))
        e.wb(0x3841, r.choice([0, 1, 5, 10, 20, 30, 60, 200, r.randint(0, 255)]))
        e.wb(0x3842, r.choice([1, 1, 1, 2, 3, 4, 6, 8, r.randint(1, 12), r.randint(0, 255) if r.random() < 0.01 else 2]))
        e.wb(0x3843, r.choice([0, 1, 2, 4, 6, 8, 12, 20, r.randint(0, 255)]))
        e.wb(0x3844, r.choice([0, 0, 1, 3, 10, 40, 120, 200, r.randint(0, 255)]))
        return [], {}
    return run_n(n, rnd, mk, 0xc008, stop=0xc061)

UI_PM = ('pmonname', 0xba6b, None, lambda e: [e.regs()['bp']])
UI_CLR = uistub('clropt', 0xbfd1)

@unit('attackp')
def _(n, rnd):
    """CODE+0xA399..: party member attacks monster slot BL - thaco / attacks / damage / bonus setup (stops: 0xA5D7 = roll, 0xA5E5 = immune)"""
    def mk(e, r):
        a = pickchar(e, r)
        e.wb(a + 0x14, r.choice([1, 2, 3, 4, 5, 6, 6, r.randint(0, 255) if r.random() < 0.05 else 3]))
        e.wb(a + 0x18, r.choice([r.randint(1, 8), r.randint(9, 45), r.randint(0, 255)]))
        e.wb(a + 0x20, r.choice([r.randint(1, 8), r.randint(9, 45), r.randint(0, 255)]))
        e.wb(a + 0x24, r.choice([1, 2, 5, 8, 9, 15, 17, 24, r.randint(0, 255)]))
        mon_setup(e, r)
        party_fx(e, r)
        e.wb(0x3898, r.choice([0, 2, 4, 6, 8, 10, 12, r.randint(0, 255)]))
        e.wb(0x3899, r.choice([0, 0, 1, 2, 3, 5, r.randint(0, 255)]))
        e.wb(0x389a, r.choice([0, 0, 1]))
        bl = r.randint(0, 14)
        return [bl], {'bx': bl}
    return run_n(n, rnd, mk, 0xa399, stub=[PTEXT, UI_PM, UI_CLR], stops=(0xa5d7, 0xa5e5))

@unit('monhit')
def _(n, rnd):
    """CODE+0x9CAE..0x9D52: monster attacks character - target AC, thaco, damage dice, attack count (before rolldmg)"""
    def mk(e, r):
        a = pickchar(e, r)
        mon_setup(e, r)
        party_fx(e, r)
        e.ww(0x38b2, r.randint(0, 14))
        e.ww(0x3cb4, MONBASE + MONSLOT * r.randint(0, 14))
        e.wb(0x3189, r.choice([0, 0, 1]))
        return [], {}
    return run_n(n, rnd, mk, 0x9cae, stop=0x9d52)

@unit('apdmch')
def _(n, rnd):
    """CODE+0x9DAB: apply damage ([3845]) to the current character"""
    def mk(e, r):
        a = pickchar(e, r)
        e.wb(0x3845, r.choice([0, 1, 3, 8, 20, 50, 200, 255, r.randint(0, 255)]))
        hp = r.choice([0, 1, 5, 10, 20, 50, 100, 255, 256, 300, r.randint(0, 600)])
        e.ww(a + 0x33, hp)
        e.wb(a + 0x3f, r.choice([0, 0, 0, 0x40, 0x80, 0xc0, 0x01, r.getrandbits(8)]))
        e.wb(0x3bdd, r.randint(0, 25)); e.wb(0x3bdc, r.randint(0, 39))
        return [], {}
    return run_n(n, rnd, mk, 0x9dab, stub=[PTEXT, ('dosound', 0x1ad6, None, lambda e: [e.regs()['ax']])])

@unit('apdmmon')
def _(n, rnd):
    """CODE+0xC15E: apply damage ([3845]) to the monster slot selected by [3CB4] (getmony reads [38B2]); death compacts the list"""
    def mk(e, r):
        pickchar(e, r)
        mon_setup(e, r)
        k = r.randint(0, 14)
        idx = k
        e.ww(0x38b2, idx)
        e.ww(0x3cb4, MONBASE + MONSLOT * idx)
        e.wb(0x3845, r.choice([0, 1, 3, 8, 20, 50, 200, 255, r.randint(0, 255)]))
        e.wb(MONHP + idx, r.choice([1, 5, 10, 30, 60, 100, r.randint(0, 255)]))
        e.wb(0x2e7f, r.choice([0, 0, 1]))
        return [idx], {}
    return run_n(n, rnd, mk, 0xc15e, stub=[PTEXT, UI_PM, ('dosound', 0x1ad6, None, lambda e: [e.regs()['ax']]), uistub('pmonst', 0xb958)])

@unit('setinit')
def _(n, rnd):
    """CODE+0xB8E3: round initiative thresholds for party / monsters"""
    return run_n(n, rnd, lambda e, r: ([], {}), 0xb8e3, stub=[uistub('pinit', 0xb892)])

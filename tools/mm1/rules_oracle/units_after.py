"""After-combat units: treasure (CODE+0xC3AD treas, 0xC422 treitem), 32-bit divide (0x8386), post-combat reset (0xA1EA resout),
the battle-won block (0x9FC1..0xA1BE: experience pool, treasure, split among living members), monster upkeep and flee."""
from common import *
from units_combat import mon_setup, party_fx, MONBASE, MONSLOT
from units_spells import party_setup, PARTYTAB, NPARTY, effect_state_char

def pc(e, r, cls=None):
    rnd_state(e, r)
    a, n = party_setup(e, r, cls)
    return a, n

@unit('treas')
def _(n, rnd):
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        k = r.randint(0, 14)
        e.ww(0x3cb4, MONBASE + MONSLOT * k)
        e.wb(MONBASE + MONSLOT * k + 0x18, r.choice([0, 1, 2, 3, 4, 5, 6, 7, r.getrandbits(8)]))
        e.wb(0x389c, r.choice([0, 1, 3, 5, 7, r.getrandbits(8)])); e.wb(0x389b, r.getrandbits(8))
        e.ww(0x3c7d, r.choice([0, 100, 255, 0xfff0, r.getrandbits(16)])); e.wb(0x3c7f, r.choice([0, 3, 250, 255, r.getrandbits(8)]))
        return [], {}
    return run_n(n, rnd, mk, 0xc3ad)

@unit('treitem')
def _(n, rnd):
    def mk(e, r):
        pc(e, r)
        e.wb(0x389c, r.choice([0, 0xff, 0xaa, 0x55, 0x80, 0x01, 0x20, 0x7f, r.getrandbits(8)]))
        for i in range(5): e.wb(0x38a0 + i, r.choice([0, 0, 0, 1]))
        for i in range(3): e.wb(0x3c7a + i, r.choice([0, 0, 5, r.getrandbits(8)]))
        e.wb(0x3c7d, 0); e.wb(0x3c7e, r.choice([0, 0, 1])); e.wb(0x3c7f, r.choice([0, 0, 4]))
        return [], {}
    return run_n(n, rnd, mk, 0xc422)

@unit('divide')
def _(n, rnd):
    def mk(e, r):
        e.wbytes(0x3c86, [r.getrandbits(8) if r.random() < 0.7 else 0 for _ in range(4)])
        e.wbytes(0x3c8c, [r.choice([0, 1, 2, 3, 4, 5, 6, r.getrandbits(8)]), r.choice([0, 0, 0, 1, r.getrandbits(8)])])
        return [], {}
    return run_n(n, rnd, mk, 0x8386)

@unit('resout')
def _(n, rnd):
    def mk(e, r):
        pc(e, r)
        return [], {}
    return run_n(n, rnd, mk, 0xa1ea)

VICT_UI = [PTEXT, uistub('pdec', 0x4030), uistub('clropt', 0xbfd1), uistub('puttoscr', 0xc5ad)]
@unit('victory')
def _(n, rnd):
    """CODE+0x9FC1..0xA1C1 (stop): battle won - experience pool, treasure per monster, split among the living, resout"""
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        for k in range(15):
            a = MONBASE + MONSLOT * k
            e.wb(a + 0x16, r.choice([0, 5, 30, 200, 255, r.getrandbits(8)])); e.wb(a + 0x17, r.choice([0, 0, 1, 20, 255, r.getrandbits(8)]))
            e.wb(a + 0x18, r.choice([0, 0, 1, 2, 4, 6, 0x81, 0xff, r.getrandbits(8)]))
        e.wb(0x3897, r.choice([1, 2, 3, 5, 8, 15, r.randint(1, 15)]))
        e.wb(0x389c, 0)
        for i in range(5): e.wb(0x38a0 + i, 0)
        for i in range(3): e.wb(0x3c7a + i, 0)
        e.ww(0x3c7d, 0); e.wb(0x3c7f, 0)
        for i in range(8): e.wb(0x3c78 + i, 0) if i < 2 else None
        n = e.rb(NPARTY)
        for i in range(n):
            a = e.rw(PARTYTAB + 2 * i)
            e.wbytes(a + 0x27, r.choice([0, 100000, 0xfffffff0, r.getrandbits(32)]).to_bytes(4, 'little'))
        return [], {}
    return run_n(n, rnd, mk, 0x9fc1, stub=VICT_UI, stop=0xa1c1)

ENC_UI = [('ph2one', 0x40d6, None, lambda e: [e.regs()['ax'] & 255]), ('ph2', 0x40e1, None, lambda e: [e.rw(0x3bd4)])]
@unit('encgen')
def _(n, rnd):
    """CODE+0x2F87..0x3206 (stop): build the encounter - party level budget, level/type per monster, group sizes, 32-byte records copied to DS:2E80.."""
    def mk(e, r):
        rnd_state(e, r)
        a, np_ = party_setup(e, r)
        for i in range(np_):
            ra = e.rw(PARTYTAB + 2 * i)
            e.wb(ra + 0x24, r.choice([1, 2, 3, 5, 8, 12, 20, 40, 100, 200, r.randint(1, 255)]))
            e.wb(ra + 0x3f, r.choice([0, 0, 0, 0x40, 0x80, 0x20, 0x01, r.getrandbits(8)]))
        e.ww(0x132, 0xc940)
        for i in range(0x40): e.wb(0xc940 + i, r.randint(0, 255))
        e.wb(0xc940 + 0x21, r.choice([1, 2, 4, 6, 8, 10, 12, 13, 16, r.randint(0, 20)]))
        e.wb(0xc940 + 0x2f, r.choice([0, 1, 2, 5, 9, 10, 11, r.randint(0, 255)]))
        e.wb(0xc940 + 0x22, r.choice([1, 2, 3, 4, 6, 8, 12, 15, 16, r.randint(0, 255)]))
        pre = r.random() < 0.15
        e.wb(0x3c21, r.randint(1, 3) if pre else 0)
        if pre:
            k = r.randint(1, 5)
            e.wb(0x3c1d, k); e.wb(0x3c1c, r.randint(0, 60))
            for i in range(k): e.wb(0x3c29 + i, r.randint(1, 12)); e.wb(0x3c58 + i, r.randint(1, 15))
        return [], {}
    return run_n(n, rnd, mk, 0x2f87, stub=ENC_UI, stop=0x3206)

UPK = [PTEXT, uistub('pmonst', 0xb958), ('pmonname', 0xba6b, None, lambda e: [e.regs()['bp']]), uistub('clropt', 0xbfd1), ('cout', 0x3fff, None, lambda e: [e.regs()['ax'] & 255]),
       uistub('puttoscr', 0xc5ad), uistub('pround', 0xb776), uistub('pinit', 0xb892), uistub('clragone', 0xbfe9), uistub('pcharco', 0xbd9a), uistub('delay', 0xc219)]

@unit('regenmon')
def _(n, rnd):
    """CODE+0xAD44: monster upkeep - regeneration (+5 HP, flag +0x1E bit 6) and shaking off one status bit (saving throw)"""
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        for k in range(15):
            a = MONBASE + MONSLOT * k
            e.wb(a + 0x11, r.choice([5, 10, 30, 60, 255, r.getrandbits(8)]))
            e.wb(a + 0x1e, r.choice([0, 0x40, 0x40, 0x80, 0xc0, r.getrandbits(8)]))
            e.wb(0x3888 + k, r.choice([e.rb(a + 0x11), 1, 3, 30, 250, r.getrandbits(8)]))
            e.wb(0x3879 + k, r.choice([0, 0, 1, 2, 4, 0x10, 0x20, 0x40, 0x80, 0xc0, 0xff, 0x81, 0x30, r.getrandbits(8)]))
        e.wb(0x3c11, r.randint(0, 3))
        return [], {}
    return run_n(n, rnd, mk, 0xad44, stub=UPK)

@unit('monadv')
def _(n, rnd):
    """CODE+0xAC41: monsters behind the melee line that carry flag +0x1E bit 7 and have no status step forward to the front"""
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        for k in range(15):
            a = MONBASE + MONSLOT * k
            e.wb(a + 0x1e, r.choice([0, 0x80, 0x80, 0xc0, r.getrandbits(8)]))
            e.wb(0x3879 + k, r.choice([0, 0, 0, 4, 1, 0x40, r.getrandbits(8)]))
        e.wb(0x3c11, r.randint(0, 5))
        return [], {}
    return run_n(n, rnd, mk, 0xac41, stub=UPK)

@unit('flee')
def _(n, rnd):
    """CODE+0x9A17 with AL = 'R': run - two rolls (d100 <= DS:3C8F, then d100 < round counter DS:3BDB); failure raises DS:3C8F"""
    def mk(e, r):
        pc(e, r)
        e.wb(0x3c8f, r.choice([0, 1, 10, 50, 80, 99, 100, r.getrandbits(8)]))
        e.wb(0x3bdb, r.choice([1, 1, 2, 5, 20, 60, r.getrandbits(8)]))
        e.ww(0x132, 0xc940)
        for i in range(0x40): e.wb(0xc940 + i, r.randint(0, 255))
        for k in range(6): e.wb(0x3855 + k, 0)
        return [0x52], {'ax': 0x52}
    return run_n(n, rnd, mk, 0x9a17, stub=UPK, stops=(0x9799, 0xa242, 0x9809))

@unit('roundend')
def _(n, rnd):
    """CODE+0x9F1A: end of a combat round - thresholds count down; when both reach 1 a new round starts (initiative, AC, upkeep, advance)"""
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        for k in range(15):
            a = MONBASE + MONSLOT * k
            e.wb(a + 0x11, r.choice([5, 30, 255, r.getrandbits(8)]))
            e.wb(a + 0x1e, r.choice([0, 0x40, 0x80, 0xc0, r.getrandbits(8)]))
            e.wb(0x3888 + k, r.choice([e.rb(a + 0x11), 1, 30, r.getrandbits(8)]))
            e.wb(0x3879 + k, r.choice([0, 0, 1, 4, 0x10, 0x40, 0x80, 0xff, r.getrandbits(8)]))
        e.wb(0x3bf2, r.choice([1, 1, 2, 5, 40, r.getrandbits(8)])); e.wb(0x3bf3, r.choice([1, 1, 2, 5, 40, r.getrandbits(8)]))
        e.wb(0x3c11, r.randint(0, 4)); e.wb(0x3bdb, r.randint(1, 20))
        e.ww(0x3847, r.randint(0, 5))
        return [], {}
    return run_n(n, rnd, mk, 0x9f1a, stub=UPK, stop=0x9799)

@unit('monpick')
def _(n, rnd):
    """CODE+0x9A76..: which monster acts next, and whether it runs away (flag +0x1E bits 4-5 against the party's top level DS:3C1B)"""
    def mk(e, r):
        pc(e, r)
        mon_setup(e, r)
        for k in range(15):
            a = MONBASE + MONSLOT * k
            e.wb(a + 0x15, r.choice([0, 10, 40, 41, 100, r.getrandbits(8)]))
            e.wb(a + 0x1e, r.choice([0, 0x10, 0x20, 0x30, 0x40, 0x80, r.getrandbits(8)]))
            e.wb(0x3879 + k, r.choice([0, 0, 0, 0, 1, 4, 0x10, 0x20, 0x80, 0xff, r.getrandbits(8)]))
            e.wb(0x385b + k, r.choice([0, 0, 0, 1]))
            e.wb(a + 0x16, 5); e.wb(a + 0x17, 5); e.wb(a + 0x18, 5)
        e.wb(0x3bf3, r.choice([0, 1, 5, 40, 41, 60, r.getrandbits(8)]))
        e.wb(0x3c1b, r.choice([0, 2, 4, 5, 8, 9, 12, 13, 14, 20, 100, r.getrandbits(8)]))
        for i in range(15): e.ww(0x3c58 + 2 * i, MONBASE + MONSLOT * i)
        return [], {}
    return run_n(n, rnd, mk, 0x9a76, stub=UPK, stops=(0x9b9d, 0x9ec9, 0x9fc1, 0x9f1a))

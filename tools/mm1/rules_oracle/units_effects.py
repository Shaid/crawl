"""Monster touch effects (CODE+0xA60F monbon dispatcher, handlers via the DS:3229 table), saving throws, resistance rolls."""
from common import *
from units_combat import mon_setup, party_fx, MONBASE, MONSLOT

UI = [PTEXT, ('cout', 0x3fff, None, lambda e: [e.regs()['ax'] & 255])]

def effect_state(e, r, a, idx=None):
    mon_setup(e, r)
    party_fx(e, r)
    for off in (0x3c95, 0x3c96, 0x3c97, 0x3c98, 0x3c99, 0x3c9a, 0x3c9b, 0x3ca1):
        e.wb(off, r.choice([0, 0, 0, 5, 20, 60, 130, r.randint(0, 255)]))
    lowres = r.random() < 0.5
    for off in range(0x59, 0x68, 2):
        e.wb(a + off, r.choice([0, 1, 2, 3]) if lowres else r.choice([0, 5, 20, 50, 80, 100, 110, 119, 120, 130, 200, r.randint(0, 255)]))
    e.wb(a + 0x3f, r.choice([0, 0, 0, 0, 0x40, 0x80, 0xc0, 0x01, 0x08, 0x20, 0xa0, r.getrandbits(8)]))
    for off in (0x39, 0x3a, 0x3b, 0x31, 0x32, 0x2b, 0x2c):
        e.wb(a + off, r.choice([0, 0, r.randint(1, 255)]))
    for off in range(0x46, 0x4c): e.wb(a + off, r.choice([0, 0, 0, 0, r.randint(1, 255)]))
    for off in range(0x15, 0x25): e.wb(a + off, r.choice([0, 1, 2, 3, 4, 5, 10, r.randint(0, 40)]))
    e.wb(a + 0x1c, r.choice([0, 1, 2, 5, 12]))
    e.wb(a + 0x24, r.choice([0, 1, 2, 3, 4, 10, 30, r.randint(0, 255)]))
    e.wb(a + 0x25, r.choice([18, 100, 200, 205, 215, 255]))
    e.wb(a + 0x14, r.choice([1, 2, 3, 4, 5, 6]))
    e.wb(0x3845, r.choice([0, 1, 5, 20, 250, 254, r.randint(0, 255)]))

@unit('savechar')
def _(n, rnd):
    def mk(e, r):
        a = pickchar(e, r); effect_state(e, r, a)
        e.wb(a + 0x22, r.choice([0, 3, 10, 20, 40, 100, r.randint(0, 255)]))
        e.wb(a + 0x24, r.choice([0, 1, 5, 10, 25, 60, r.randint(0, 255)]))
        return [], {}
    return run_n(n, rnd, mk, 0xa655)

@unit('savemons')
def _(n, rnd):
    def mk(e, r):
        pickchar(e, r)
        mon_setup(e, r)
        k = r.randint(0, 14)
        e.ww(0x38b2, k)
        return [k], {}
    return run_n(n, rnd, mk, 0xa6a3)

@unit('setcondi')
def _(n, rnd):
    def mk(e, r):
        a = pickchar(e, r)
        v = r.choice([1, 2, 4, 8, 0x10, 0x20, 0x40, 0xa0, 0xc0, 0xff, r.getrandbits(8)])
        return [v], {'ax': v}
    return run_n(n, rnd, mk, 0xa6d3)

RES = {'magic': 0xa706, 'fire': 0xa71a, 'cold': 0xa72e, 'elec': 0xa742, 'acid': 0xa756, 'fear': 0xa76a, 'poison': 0xa785, 'psychic': 0xa79b}
@unit('resist')
def _(n, rnd):
    names = list(RES)
    def run(n, rnd):
        e = Emu(); Rc = Rec(e); out = []
        for _ in range(n):
            w = rnd.choice(names)
            box = {}
            def setup(e):
                rnd_state(e, rnd)
                a = pickchar(e, rnd); effect_state(e, rnd, a)
            v = Rc.run(RES[w], None, setup)
            out.append({'args': [names.index(w)], **v})
        return out
    return run(n, rnd)

@unit('monresma')
def _(n, rnd):
    def mk(e, r):
        a = pickchar(e, r); effect_state(e, r, a)
        e.ww(0x3cb4, MONBASE + MONSLOT * r.randint(0, 14))
        e.wb(a + 0x24, r.choice([0, 1, 5, 10, 25, 150, 200, 255]))
        return [], {}
    return run_n(n, rnd, mk, 0xa7c1)

@unit('monbon')
def _(n, rnd):
    """CODE+0xA60F: monster touch effect dispatcher incl. the 25 handlers of the DS:3229 table"""
    def mk(e, r):
        a = pickchar(e, r); effect_state(e, r, a)
        k = r.randint(0, 14)
        e.ww(0x3cb4, MONBASE + MONSLOT * k)
        e.ww(0x38b2, k)
        v = r.choice([0, 0x80, 0x81, 0x97, r.randint(1, 25), r.randint(1, 25), r.randint(1, 25), r.randint(1, 25), r.randint(1, 25), r.randint(1, 25)])
        e.wb(MONBASE + MONSLOT * k + 0x1b, v)
        e.wb(0x3189, r.choice([0, 0, 0, 0, 1]))
        return [v], {}
    return run_n(n, rnd, mk, 0xa60f, stub=UI)

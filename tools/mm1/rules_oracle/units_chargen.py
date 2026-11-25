"""Character-creation / derived-stat units."""
from common import *

def gen_random(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for i in range(n):
        nn = rnd.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 31, 32, 99, 100, rnd.randint(0, 255), rnd.randint(0, 255)])
        out.append({'args': [nn], **Rc.run(0x451b, {'ax': nn}, lambda e: rnd_state(e, rnd))})
    return out




U['random'] = gen_random

@unit('rollstat')
def _(n, rnd):
    return run_n(n, rnd, lambda e, r: ([], {}), 0x5a42)

@unit('raceadj')
def _(n, rnd):
    def mk(e, r):
        race = r.choice([1, 2, 3, 4, 5, 5, r.randint(0, 9)])
        e.wb(0x23aa, race)
        st = [r.randint(1, 20) for _ in range(7)]
        e.wbytes(0x239b, st)
        return [race], {}
    return run_n(n, rnd, mk, 0x549b, stub=[PTEXT], stop=0x551c)

@unit('pclass')
def _(n, rnd):
    def mk(e, r):
        st = [r.choice([r.randint(3, 20), r.randint(10, 14)]) for _ in range(7)]
        e.wbytes(0x239b, st); e.wbytes(0x23bd, [0] * 6)
        return st, {}
    return run_n(n, rnd, mk, 0x5ae4, stub=[PTEXT])

@unit('setspell')
def _(n, rnd):
    def mk(e, r):
        a = pickchar(e, r)
        v = r.choice([r.randint(0, 25), r.randint(10, 20)])
        return [v], {'ax': v}
    return run_n(n, rnd, mk, 0x5a00)

@unit('hpbonus')
def _(n, rnd):
    def mk(e, r):
        a = pickchar(e, r)
        e.wbytes(0x239b, [r.choice([r.randint(3, 21), r.randint(10, 20)]) for _ in range(7)])
        v = r.choice([6, 8, 10, 12, 0x32, r.randint(0, 255)])
        return [v], {'ax': v}
    return run_n(n, rnd, mk, 0x5982)

@unit('createcommit')
def _(n, rnd):
    def mk(e, r):
        e.wbytes(0x45e8, [r.choice([0, 1, 1]) if i < 17 else r.choice([0, 1]) for i in range(18)])
        if not any(e.rb(0x45e8 + i) == 0 for i in range(18)): e.wb(0x45e8 + r.randint(0, 17), 0)
        e.wbytes(0x239b, [r.randint(3, 20) for _ in range(7)])
        cls, race, al, sex = r.randint(1, 6), r.randint(1, 5), r.randint(1, 3), r.randint(1, 2)
        e.wb(0x23a9, cls); e.wb(0x23aa, race); e.wb(0x23ab, al); e.wb(0x23ac, sex)
        name = bytes([r.randint(0x41, 0x5a) for _ in range(r.randint(1, 15))]).ljust(15, b'\0')
        e.wbytes(0x23ad, name)
        for i in range(18): mkchar(e, r, rec_addr(i))
        return [cls, race, al, sex], {}
    return run_n(n, rnd, mk, 0x57b7, stub=[PTEXT], stop=0x597c)

@unit('resetac')
def _(n, rnd):
    def mk(e, r):
        a = mkchar(e, r, rec_addr(r.randint(0, 17))); e.ww(CHARP, a)
        return [], {}
    return run_n(n, rnd, mk, 0x732a)

#!/usr/bin/env python3
"""MM2 rules vector generators, pass 6 (exchange-stats command, ...).
Usage as rules.py:  rules7.py UNIT OUT.json [--n N]   (`subset` is rules.py's).  Units merge into rules.UNITS."""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import rules, rules4, rules5
from rules import *
from rules5 import UI_ROOT, UI_OVL, ovl, new_emu
from emu import Emu, A4V, HEAP, REPO, CODE_BASE, OVL_REL, OVL_BASE
from harness import Rec

def gen_xchg(n, rnd):
    """overlay 0x201A exchange stats: pick the second stat by letter A..G (ESC aborts, letters above G ask again), swap the two bytes, recompute the
    class-eligibility flags (real 0x1DF4) and redraw (stubbed)"""
    e = new_emu(); R = Rec(e)
    for off in UI_ROOT: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    for off in (0x1C0E, 0x1D42): e.stub(ovl(off), 'ui%x' % off, nargs=0, quiet=True)
    keys = []
    e.stub(0x042AA, 'key', nargs=2, fn=lambda e, sp: keys.pop(0) if keys else 0x1b)
    out = []
    for i in range(n):
        st = e.alloc(8); fl = e.alloc(8)
        idx = rnd.choice([0, 1, 2, 3, 4, 5, 6, rnd.randint(0, 6)])
        ks = [rnd.choice([0x41 + k for k in range(7)] + [0x61 + k for k in range(7)] + [0x48, 0x5a, 0x1b]) for _ in range(rnd.randint(0, 3))] + [rnd.choice([0x1b] + [0x41 + k for k in range(7)])]
        def setup(e):
            keys[:] = ks
            for k in range(7): e.w8(st + k, rnd.choice([rnd.randint(3, 21), rnd.randint(8, 21), rnd.getrandbits(8)]))
            e.w8(st + 7, rnd.getrandbits(8))
            for k in range(8): e.w8(fl + k, rnd.choice([0, 1, 0xff]))
        v = R.run(ovl(0x201A), (idx, (st, 4), (fl, 4)), setup)
        out.append({'idx': idx, 'keys': ks, 'stats': st, 'flags': fl, **v})
        e.heap = HEAP
    return out

def gen_toggle(n, rnd):
    """CODE+0x6E0 roster screen: toggle roster entry idx (0..23 characters, 24..47 hirelings) in/out of the party: in the party -> removed (0x362C, shift-down);
    else a character is added when fewer than 6 characters and fewer than 8 members; a hireling when fewer than 8 members and its slot flag A4-31115[idx] is set. UI quiet."""
    e = new_emu(); R = Rec(e)
    for off in (0x22108, 0x218EA): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    out = []
    for i in range(n):
        idx = rnd.choice([rnd.randint(0, 47), rnd.randint(0, 23), rnd.randint(24, 47), rnd.randint(0, 47)])
        def setup(e):
            size = rnd.choice([0, 1, 2, 3, 5, 6, 7, 8, rnd.randint(0, 8)])
            pool = list(range(48)); rnd.shuffle(pool)
            mem = pool[:size]
            if rnd.random() < .4 and size: mem[rnd.randrange(size)] = idx
            for k in range(8): sw(e, -31082 + 2 * k, mem[k] if k < size else 0xffff)
            sw(e, -31066, size)
            chars = sum(1 for x in mem if x < 24); sb(e, -24162, chars if rnd.random() < .9 else rnd.randint(0, 8)); sb(e, -24161, size - chars if rnd.random() < .9 else rnd.randint(0, 8))
            if rnd.random() < .3: sb(e, -24162, 6); sb(e, -24161, rnd.choice([0, 1, 2]))
            for k in range(24): sb(e, -31115 + k, rnd.choice([0, 1, 1, rnd.getrandbits(8)]))
        out.append({'idx': idx, **R.run(0x6E0, (idx,), setup)})
    return out

UNITS7 = {'cgxchg': gen_xchg, 'partytoggle': gen_toggle}
rules.UNITS.update(UNITS7)
if __name__ == '__main__': rules.main()

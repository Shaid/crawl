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

def gen_disarm(which):
    """chest / trap disarm CODE+0x1AEC2 `disarm(effect.b)` (which='a') and CODE+0x1AF6E `pick_and_disarm()` ('b'): a member is picked (0xFF effect skips the pick and the roll;
    ESC cancels), d = rand(1,100); the disarm works when d <= 0x60 and d <= the member's thief byte +0x1E; otherwise a non-zero effect id is applied to the member
    (0x1AA70, logged); then (A) the 'anyone able to act' test 0x47A2 shows the open-chest screen. Picker 0x1AE2E, the effect and the screens are stubs."""
    def gen(n, rnd):
        e = new_emu(); R = Rec(e); out = []
        for off in (0x560A, 0x54F2, 0x1AC94, 0x097A2, 0x06DA6): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
        picks = []
        e.stub(0x1AE2E, 'pick', nargs=0, fn=lambda e, sp: picks.pop(0) if picks else 0x1b)
        e.stub(0x1AA70, 'effect', nargs=2)
        for i in range(n):
            seed = rnd.getrandbits(32)
            eff = rnd.choice([0, 0xff, 0xff, 1, 2, 3, 4, 5, 7, rnd.randint(0, 255)])
            size = rnd.choice([1, 2, 3, 4, 5, 6, rnd.randint(1, 6)])
            pk = rnd.choice([0x1b] + list(range(size)) + [rnd.randint(0, 7)])
            def setup(e):
                sl(e, SEED, seed); picks[:] = [pk]
                idxs = setup_party(e, rnd, size)
                for r in idxs:
                    a = g(-10814) + 130 * r
                    e.w8(a + 30, rnd.choice([0, 0x10, 0x30, 0x5f, 0x60, 0x61, 0x80, rnd.getrandbits(8)])); e.w8(a + 38, rnd.choice([0, 0, 0, 0x20, 0x40, 0x80, rnd.getrandbits(8)]))
            if which == 'a': v = R.run(0x1AEC2, (eff,), setup)
            else: v = R.run(0x1AF6E, (eff,), setup)
            out.append({'seed': seed, 'eff': eff, 'pick': pk, **v})
            e.heap = HEAP
        return out
    return gen

def gen_trapfx(n, rnd):
    """trap effect application CODE+0x1A90E `(effect.b, slot.w)`: kind = effect-1; the picked member is hit again when its class (+0x0F) is 5 or 6, then every party member;
    each hit is damage_char(member, base << A4-22022, luck save on, percentage save on, type kind) with base = A4-26892[danger index 0..4 from A4-31203] (0x1A8A4, real damage_char 0x4952)"""
    e = new_emu(); R = Rec(e); out = []
    for off in (0x6FB8, 0x6798): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    for i in range(n):
        seed = rnd.getrandbits(32)
        eff = rnd.choice([1, 2, 3, 4, 5, 6, 7, 8, 0, rnd.randint(1, 20), rnd.getrandbits(8)])
        size = rnd.choice([1, 2, 3, 4, 5, 6, rnd.randint(1, 6)])
        def setup(e):
            sl(e, SEED, seed)
            idxs = setup_party(e, rnd, size)
            for r in idxs:
                a = g(-10814) + 130 * r
                for k in range(130): e.w8(a + k, rnd.getrandbits(8))
                e.w8(a + 38, rnd.choice([0, 0, 0, 0x10, 0x20, 0x40, 0x50, 0x80, 0x81, rnd.getrandbits(8)]))
                e.w16(a + 94, rnd.choice([rnd.randint(0, 40), rnd.randint(0, 300), rnd.getrandbits(16)]))
                e.w8(a + 32, rnd.randint(1, 40)); e.w8(a + 21, rnd.randint(1, 100)); e.w8(a + 15, rnd.choice([0, 1, 2, 3, 4, 5, 5, 6, 6, 7]))
            sb(e, -31203, rnd.choice([0, 1, 2, 3, 4, 5, 6, 7]))
            sb(e, -22022, rnd.choice([0, 1, 2, 3, 4, rnd.randint(0, 20), 255]))
            for k in range(5): sw(e, -26892 + 2 * k, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 300), rnd.getrandbits(16)]))
            sb(e, -31146, rnd.choice([0, rnd.randint(0, 60), rnd.getrandbits(8)])); sb(e, -31145, rnd.choice([0, rnd.randint(0, 60), rnd.getrandbits(8)]))
            sw(e, -3852, rnd.getrandbits(16))
        member = rnd.randint(0, 7) if rnd.random() < .1 else rnd.randrange(size)
        v = R.run(0x1A90E, (eff, member), setup)
        out.append({'seed': seed, 'eff': eff, 'member': member, **v})
        e.heap = HEAP
    return out

UNITS7 = {'trapfx': gen_trapfx, 'cgxchg': gen_xchg, 'partytoggle': gen_toggle, 'disarm': gen_disarm('a'), 'disarm2': gen_disarm('b')}
rules.UNITS.update(UNITS7)
if __name__ == '__main__': rules.main()

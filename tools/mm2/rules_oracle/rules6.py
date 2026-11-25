#!/usr/bin/env python3
"""MM2 rules vector generators, pass 5 (the undead engine, remaining spell leaves, shop sell/list, pool payments).
Usage as rules.py:  rules6.py UNIT OUT.json [--n N]   (`subset` is rules.py's).  Units merge into rules.UNITS."""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import rules, rules4, rules5
from rules import *
from emu import Emu, A4V, HEAP, REPO, CODE_BASE, OVL_REL, OVL_BASE
from harness import Rec

def gen_undead(n, rnd):
    """combat spells 54 Turn Undead (CODE+0xBFEE) and 93 Holy Word (0xC72A) through the real combat dispatcher; the engine CODE+0xC028 and the real monster_dies (0x10E5E) run, UI is quiet"""
    e = Emu(); R = Rec(e); out = []
    for off in sorted(set(QUIET_UI) | set(rules4.QUIET3)): e.stub(off, 'q%x' % off, nargs=0, quiet=True)   # one stub per address (two hooks on one address would pop the return twice)
    for i in range(n):
        spell = [54, 93][i % 2] if i < 400 else rnd.choice([54, 93])
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); mon_state(e, rnd)
            # undead flag lives in the unpacked record; force some monsters to carry the bit so both outcomes occur
            sb(e, -16140, 1); sb(e, -21974, rnd.choice([0, 0, 0, 0, 2, 3, rnd.getrandbits(8)]))
            sb(e, -1311, rnd.choice([0, 0, 0, 1])); sb(e, -1312, rnd.choice([0, 1])); sb(e, -31064, rnd.getrandbits(8))
            sb(e, -22016, rnd.choice([0, 1, 8, 9, rnd.getrandbits(8)]))
            ch = g(-10814) + 130 * rnd.randint(0, 47)
            sl(e, -18380, ch); e.w8(ch + 113, rnd.choice([rnd.randint(0, 20), rnd.randint(1, 15), rnd.getrandbits(8)]))
            for k in range(11): sb(e, -4574 + k, rnd.choice([rnd.randint(0, 255), rnd.randint(0, 40), rnd.randint(150, 255)]))
        v = R.run(rules4.DISP_CB, (spell,), setup, max_insn=14_000_000)
        out.append({'seed': seed, 'spell': spell, **v})
    return out

def pool_state(e, rnd, kind):
    """a party of 1..6 (roster indexes include hirelings >= 24) with gold (+0x66 long), gems (+0x5C word) or food (+0x25 byte) per member"""
    size = rnd.choice([1, 2, 3, 4, 5, 6, 6])
    idxs = setup_party(e, rnd, size)
    if rnd.random() < .5:   # more hirelings
        for k in range(size):
            if rnd.random() < .4: sw(e, -31082 + 2 * k, rnd.randint(24, 47))
    for k in range(size):
        a = g(-10814) + 130 * e.r16(g(-31082) + 2 * k)
        if kind == 'gold': e.w32(a + 102, rnd.choice([0, 1, rnd.randint(0, 5000), rnd.randint(0, 100000), rnd.getrandbits(32) >> rnd.randint(0, 31)]))
        elif kind == 'gems': e.w16(a + 92, rnd.choice([0, 1, rnd.randint(0, 50), rnd.randint(0, 3000), rnd.getrandbits(16)]))
        else: e.w8(a + 37, rnd.choice([0, 1, rnd.randint(0, 40), rnd.randint(0, 255)]))
    return size

POOLS = {'gold': (0x6ACE, 4, 0x7BBE), 'gems': (0x6B9A, 2, 0x7CB0), 'food': (0x6C66, 2, 0x7D3E)}

def gen_pay(kind):
    off, asz, _ = POOLS[kind]
    def gen(n, rnd):
        e = Emu(); R = Rec(e); out = []
        for i in range(n):
            size = pool_state(e, rnd, kind)
            tot = 0
            for k in range(size):
                r = e.r16(g(-31082) + 2 * k); a = g(-10814) + 130 * r
                if r < 24: tot += {'gold': e.r32(a + 102), 'gems': e.r16(a + 92), 'food': e.r8(a + 37)}[kind]
            mx = {'gold': 1 << 32, 'gems': 1 << 16, 'food': 1 << 8}[kind]
            arg = rnd.choice([0, 1, tot, max(tot - 1, 0), tot + 1, rnd.randint(0, tot + 5), rnd.randint(0, mx - 1)]) % mx
            sb(e, -31057, rnd.getrandbits(8))
            v = R.run(off, ((arg, 4),) if asz == 4 else (arg,), None)
            out.append({'arg': arg, **v})
        return out
    return gen

def gen_share(kind):
    off = POOLS[kind][2]
    def gen(n, rnd):
        e = Emu(); R = Rec(e); out = []
        for i in range(n):
            size = pool_state(e, rnd, kind)
            elig = [k for k in range(size) if e.r16(g(-31082) + 2 * k) < 24]
            who = rnd.choice([0, rnd.randint(0, size), rnd.randint(0, 7)] + ([rnd.choice(elig)] * 4 if elig else []))
            v = R.run(off, (who,), None)
            out.append({'who': who, **v})
        return out
    return gen

def shop_state(e, rnd):
    ch = g(-10814) + 130 * rnd.randint(0, 47); sl(e, -23102, ch)
    e.w8(ch + 0x26, rnd.choice([0, 0, 0, 0, 1, 0x80]))
    fill = rnd.choice([0, 1, 3, 5, 6, 6])
    for k in range(6): e.w8(ch + 0x3a + k, rnd.randint(1, 255) if k < fill else 0)
    for k in range(6): e.w8(ch + 0x40 + k, rnd.getrandbits(8)); e.w8(ch + 0x46 + k, rnd.getrandbits(8))
    e.w32(ch + 0x66, rnd.choice([0, 100, 5000, 70000, rnd.getrandbits(32), rnd.randint(0, 3000), 0xffffff00]))
    for k in range(6):
        sb(e, -23052 + k, rnd.choice([0, rnd.randint(1, 255), rnd.randint(1, 255)])); sb(e, -23064 + k, rnd.getrandbits(8)); sb(e, -23070 + k, rnd.choice([0, 0, 1, 2, rnd.getrandbits(8)]))
        sb(e, -23058 + k, rnd.getrandbits(8))
        iid = rnd.randint(0, 255); sl(e, -23046 + 4 * k, g(-16126) + 20 * iid)
        e.w16(g(-16126) + 20 * iid + 0x12, rnd.choice([0, 1, 10, 200, 1000, 20000, 65535, rnd.randint(0, 3000)]))
        for q in (14, 15): e.w8(g(-16126) + 20 * iid + q, rnd.getrandbits(8))
    sw(e, -23248, rnd.choice([0, 1, 2, 3, 4, 5, 6])); e.w8(ch + 0x50, rnd.getrandbits(8))
    for k in range(6): sl(e, -23094 + 4 * k, rnd.choice([0, 10, 100, 5000, 70000, rnd.randint(0, 4000), 0xffffff00]))

def shop_emu(msg=True):
    e = rules5.new_emu(); R = Rec(e)
    quiet = {0x42DC, 0x22108, 0x2249C, 0x22376, 0x22480, 0x218EA, 0x05312, 0x06484, 0x064BA, 0x06D32}
    for off in quiet: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    e.stub(0x097A2, 'key', nargs=0, quiet=True, fn=lambda e, sp: 0x1b)   # the examine screen waits for ESC
    return e, R

def gen_sell(n, rnd):
    """CODE+0x1BC26 sell the buyer's pack slot to the shop: stock check, price from the displayed table, gold += price, pack compaction (F_046F0)"""
    e, R = shop_emu(); e.stub(0x1C432, 'msg', nargs=1); out = []
    for i in range(n):
        slot = rnd.choice([0, 1, 2, 3, 4, 5, 5, rnd.randint(0, 5)])
        v = R.run(0x1BC26, (slot,), lambda e: shop_state(e, rnd))
        out.append({'slot': slot, **v})
    return out

def gen_inspect(n, rnd):
    """CODE+0x1B6E0 the 'examine / identify item for a fee' command of the shop list: condition and stock gates, pays the displayed price (CODE+0x1BDD6), then only draws"""
    e, R = shop_emu(); e.stub(0x1C432, 'msg', nargs=1)
    for L in ('LAB_126D', 'LAB_1269'):
        off = int(os.popen('./lab.sh ' + L).read().strip(), 16); e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    out = []
    for i in range(n):
        slot = rnd.choice([0, 1, 2, 3, 4, 5, rnd.randint(0, 5)])
        v = R.run(0x1B6E0, (slot,), lambda e: shop_state(e, rnd), max_insn=3_000_000)
        out.append({'slot': slot, **v})
    return out

def gen_advance(n, rnd):
    """CODE+0x10118 a monster advances: the acting monster (A4-1271) swaps places with the first other slot whose unpacked record has A4-4523 == 0; the follow-ups are logged stubs"""
    e = Emu(); R = Rec(e); out = []
    for off in (0x1119E, 0x05070, 0x22376, 0x129CC, 0x132E6, 0x042DC, 0x22108): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    e.stub(0x1061E, 'show', nargs=1); e.stub(0x10082, 'help', nargs=0)
    for i in range(n):
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); mon_state(e, rnd)
            sb(e, -1316, rnd.choice([0, 1, 2, 3, 5, 8, 10, 11, rnd.randint(0, 255)])); sb(e, -1271, rnd.randint(0, 11)); sb(e, -4523, rnd.choice([0, 1, 1, 2]))
            for k in range(11): sb(e, -24138 + k, rnd.getrandbits(8))
        v = R.run(0x10118, (), setup, max_insn=3_000_000)
        out.append({'seed': seed, **v})
    return out

UNITS6 = {'advance': gen_advance, 'sell': gen_sell, 'inspect': gen_inspect, 'undead': gen_undead, 'paygold': gen_pay('gold'), 'paygems': gen_pay('gems'), 'payfood': gen_pay('food'), 'sharegold': gen_share('gold'), 'sharegems': gen_share('gems'), 'sharefood': gen_share('food')}
rules.UNITS.update(UNITS6)
if __name__ == '__main__': rules.main()

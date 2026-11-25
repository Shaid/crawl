#!/usr/bin/env python3
"""MM2 rules vector generators, pass 3 (spells and items).  Usage as rules.py:  rules4.py UNIT OUT.json [--n N]
(`rules4.py subset IN OUT.gz --n N` is rules.py's).  Units here are merged into rules.UNITS."""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import rules
from rules import *
from emu import Emu, A4V, HEAP, REPO, CODE_BASE
from harness import Rec

DISP_NC, DISP_CB = 0xCD90, 0xCFD0
def handlers():
    """spell -> handler CODE offset, per dispatcher, from the jump tables (see game-rules 13.1)"""
    import struct
    from emu import parse_root
    c = parse_root()[0]['data']
    s16 = lambda o: struct.unpack_from('>h', c, o)[0]
    nc = {i: 0xcfc8 + 2 + s16(0xcef6 + 2 * i) for i in range(96)}
    cbase = 0xd23e - 92 * 2
    cb = {i + 2: 0xd252 + 2 + s16(cbase + 2 * i) for i in range(92)}
    def tgt(a):
        return a + 2 + s16(a + 2) if c[a:a + 2] == b'\x4e\xba' else None
    return ({i: tgt(a) for i, a in nc.items() if a != 0xcfcc}, {i: tgt(a) for i, a in cb.items() if a != 0xd256})

def gen_castdisp(n, rnd):
    nc, cb = handlers()
    out = []
    for which, off, tab in (('nc', DISP_NC, nc), ('cb', DISP_CB, cb)):
        e = Emu(); R = Rec(e)
        for t in sorted(set(tab.values())): e.stub(t, 'h%05x' % t, nargs=0)
        for spell in list(range(96)) + [96, 97, 127, 128, 200, 0xFFFF, 0xFFFE]:
            v = R.run(off, (spell,), None)
            out.append({'which': which, 'spell': spell, **v})
    return out

def gen_anywhere(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        spell = rnd.choice([rnd.randint(0, 95), rnd.randint(0, 95), rnd.getrandbits(16)])
        def setup(e):
            if rnd.random() < .5:   # perturb the 12-entry table so the port cannot hard-code it
                for k in range(12): sw(e, -28040 + 2 * k, rnd.choice([rnd.randint(0, 95), spell]))
        v = R.run(0x13708, (spell,), setup)
        out.append({'spell': spell, **v})
    return out

def gen_dicedmg(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        seed = rnd.getrandbits(32); a = rnd.choice([0, 1, 5, 7, 9, 11, 16, 21, rnd.randint(0, 255)]); b = rnd.choice([0, 1, 3, 6, 7, 10, 19, 20, rnd.randint(0, 255)])
        def setup(e):
            sl(e, SEED, seed); ch = g(-10814) + 130 * rnd.randint(0, 5)
            sl(e, -18380, ch); e.w8(ch + 113, rnd.choice([rnd.randint(0, 14), rnd.getrandbits(8)])); sw(e, -1342, rnd.getrandbits(16))
        v = R.run(0x1338E, (a, b), setup)
        out.append({'seed': seed, 'args': [a, b], **v})
    return out

def gen_maxtargets(n, rnd):
    e = Emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            ch = g(-10814) + 130 * rnd.randint(0, 5)
            sl(e, -18380, ch); e.w8(ch + 113, rnd.choice([rnd.randint(0, 14), rnd.getrandbits(8)])); sb(e, -30654, rnd.choice([rnd.randint(0, 14), rnd.getrandbits(8)]))
        out.append(R.run(0x1333A, (), setup))
    return out

def castroute_setup(e, rnd):
    for k in range(32): sb(e, -22010 + k, rnd.choice([0, 0xff, rnd.getrandbits(8)]))
    sb(e, -31154, rnd.choice([2, 2, 2, 0, 1])); sb(e, -31202, rnd.choice([0, 1, 1, 2]))
    sb(e, -31217, rnd.getrandbits(8)); sb(e, -31216, rnd.randint(0, 15)); sb(e, -31064, rnd.getrandbits(8)); sb(e, -16140, rnd.getrandbits(8))
    for i in range(96): e.w8(g(-11006) + 2 * i, rnd.choice([0, 0x40, 0x80, 0xC0, rnd.getrandbits(8)])); e.w8(g(-11006) + 2 * i + 1, rnd.choice([0, 0, 0x80, rnd.getrandbits(8)]))

def gen_castroute(n, rnd):
    """CODE+0x13AE2 cast(ch, spell): gates -> 'anywhere' set -> non-combat or combat dispatcher"""
    e = Emu(); R = Rec(e)
    e.stub(LAB_03F1, 'msg', nargs=1); e.stub(0x12848, 'ui12848', nargs=0, quiet=True)
    e.stub(DISP_NC, 'dispNC', nargs=1); e.stub(DISP_CB, 'dispCB', nargs=1)
    out = []
    for i in range(n):
        ch = g(-10814) + 130 * rnd.randint(0, 5); spell = rnd.choice([rnd.randint(1, 96), rnd.randint(1, 96), rnd.getrandbits(8)])
        def setup(e):
            castroute_setup(e, rnd)
            if rnd.random() < .6:
                for k in range(12): sw(e, -28040 + 2 * k, rnd.choice([rnd.randint(0, 95), (spell & 0x7f) - 1]))
        v = R.run(0x13AE2, ((ch, 4), spell), setup)
        out.append({'ch': ch, 'spell': spell, **v})
    return out

QUIET3 = (0x1119E, 0x132E6, 0x129CC, 0x05070, 0x05030, 0x22376, 0x22480, 0x218EA, 0x22108)

def pe_state(e, rnd):
    synth_monsters(e, rnd)
    mc = rnd.choice([1, rnd.randint(1, 10), rnd.randint(1, 10), rnd.randint(8, 14)])
    sb(e, -30654, mc)
    for k in range(11):
        sb(e, -4574 + k, rnd.choice([rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(150, 255)])); sb(e, -1305 + k, rnd.getrandbits(8) & rnd.choice([0, 0xff]))
        sw(e, -1338 + 2 * k, rnd.randint(1, 3000))
    for d in range(-4562, -4562 + 0x38): sb(e, d, rnd.getrandbits(8))
    sb(e, -1307, rnd.choice([0, 0, 0, 1])); sb(e, -1312, rnd.choice([0, 0, 1])); sb(e, -3852, rnd.getrandbits(8))
    sb(e, -1310, rnd.randint(0, 1))
    setup_party(e, rnd)
    ch = g(-10814) + 130 * rnd.randint(0, 5)
    sl(e, -18380, ch); e.w8(ch + 113, rnd.choice([rnd.randint(1, 20), rnd.randint(1, 20), rnd.getrandbits(8)]))
    return ch

def gen_partyeffect(n, rnd):
    """CODE+0x10894 partyEffect(count, firstSlot, element): the engine every attack/status spell ends in"""
    e = Emu(); R = Rec(e); out = []
    for off in QUIET3: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    kills = []
    def dmg_stub(e, sp):
        if kills.pop(0): e.w16(g(-3852), 0xffff)
    e.stub(0x10EAC, 'dmgMon', nargs=0, fn=dmg_stub); e.stub(0x10E5E, 'killMon', nargs=0)
    for i in range(n):
        seed = rnd.getrandbits(32)
        cnt = rnd.choice([1, 1, 3, 4, 5, 6, 10, rnd.randint(0, 12)]); slot = rnd.choice([0, 0, rnd.randint(0, 10)]); elem = rnd.choice([0, 0, 1, 2, 3, 4, 5, 6, 7])
        mode = rnd.choice([0, 0, 1, 1, 2]); cond = rnd.choice([rnd.randint(1, 9), rnd.randint(1, 9), rnd.randint(0, 12)]); dmg = rnd.choice([rnd.randint(0, 120), rnd.getrandbits(16), 0, 1, 50])
        ks = [rnd.choice([0, 0, 1]) for _ in range(40)]
        def setup(e):
            kills[:] = ks
            sl(e, SEED, seed); pe_state(e, rnd)
            sb(e, -1339, mode); sb(e, -1340, cond); sw(e, -1342, dmg)
            if rnd.random() < .5:
                for k in range(7): sb(e, -4522 + k, 0)
            # monster record fields are re-unpacked: keep the immune flags / mres tier of the records themselves
        v = R.run(0x10894, (cnt, slot, elem), setup, max_insn=2_000_000)
        out.append({'seed': seed, 'args': [cnt, slot, elem], 'kills': ks, **v})
    return out

CB_PROG = [2,3,6,8,9,14,16,17,18,20,21,22,24,25,26,27,28,31,32,33,35,36,39,40,41,42,43,44,45,46,48,50,56,58,60,61,62,65,68,73,74,75,76,77,82,84,85,86,88,90,92]

def gen_cbspell(n, rnd):
    """combat spell handlers through the combat dispatcher; pickers real, key input scripted, damage_monster/kill stubbed"""
    e = Emu(); R = Rec(e)
    for off in QUIET3 + (0x044E0, 0x06798, 0x06FB8): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    kills, keys, picks = [], [], []
    def key_stub(e, sp): return keys.pop(0) if keys else 0x1b
    def pk_stub(e, sp): return picks.pop(0) if picks else 0x1b
    e.stub(0x097A2, 'key', nargs=0, fn=key_stub); e.stub(0x042AA, 'pick', nargs=2, fn=pk_stub)
    def dmg_stub(e, sp):
        if kills.pop(0): e.w16(g(-3852), 0xffff)
    e.stub(0x10EAC, 'dmgMon', nargs=0, fn=dmg_stub); e.stub(0x10E5E, 'killMon', nargs=0)
    out = []
    for i in range(n):
        spell = CB_PROG[i % len(CB_PROG)] if i < 6 * len(CB_PROG) else rnd.choice(CB_PROG)
        seed = rnd.getrandbits(32)
        ks = [rnd.choice([0, 0, 1]) for _ in range(40)]
        kk = [rnd.choice([0x41, 0x42, 0x43, 0x61, 0x62, 0x44, 0x4b, 0x1b, 0x20, rnd.getrandbits(8)]) for _ in range(3)]
        pp = [rnd.choice([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x1b])]
        def setup(e):
            kills[:] = ks; keys[:] = kk; picks[:] = pp
            sl(e, SEED, seed); ch = pe_state(e, rnd)
            sb(e, -16140, 1); sw(e, -1342, 0); sb(e, -1339, 0); sb(e, -1340, rnd.getrandbits(8))
            sb(e, -1316, rnd.randint(0, 11)); sb(e, -21974, rnd.choice([0, 0, 0, 2, 3, rnd.getrandbits(8)])); sb(e, -22016, rnd.choice([0, 1, 8, 9, rnd.getrandbits(8)]))
            sb(e, -31064, rnd.getrandbits(8))
            for d in (-1306, -1308, -1313, -31129, -31130, -31131, -31132, -31133, -1314, -1315): sb(e, d, rnd.choice([0, 0, 1, 0xfe, 0xff, rnd.getrandbits(8)]))
            setup_party(e, rnd, rnd.choice([1, 1, 2, 3, 4, 5, 6]))
            sz = e.r16(g(-31066)); idxs = [e.r16(g(-31082) + 2 * k) for k in range(8)]
            for k in range(8):
                if idxs[k] == 0xffff or k >= sz: continue
                c = g(-10814) + 130 * idxs[k]
                for off, f in ((38, lambda: rnd.choice([0, 0, 0x10, 0x40, 0x80, 0xc0, 0xff, rnd.getrandbits(8)])), (115, lambda: rnd.choice([0, 1, 2, rnd.getrandbits(8)])), (76, lambda: rnd.getrandbits(8)), (77, lambda: rnd.getrandbits(8)), (33, lambda: rnd.choice([30, 195, 199, 200, 201, 250, rnd.getrandbits(8)])), (113, lambda: rnd.randint(1, 20))):
                    e.w8(c + off, f())
                e.w16(c + 94, rnd.getrandbits(16) if rnd.random() < .3 else rnd.randint(0, 400)); e.w16(c + 116, rnd.randint(0, 500))
            # the caster is a party member's record or any record; keep the pe_state choice
        v = R.run(DISP_CB, (spell,), setup, max_insn=3_000_000)
        out.append({'seed': seed, 'spell': spell, 'kills': ks, 'keys': kk, 'picks': pp, **({'keep': True} if i < len(CB_PROG) and v['fin'] else {}), **v})
    return out

UNITS4 = {'cbspell': gen_cbspell, 'castdisp': gen_castdisp, 'anywhere': gen_anywhere, 'dicedmg': gen_dicedmg, 'maxtargets': gen_maxtargets, 'castroute': gen_castroute, 'partyeffect': gen_partyeffect}
rules.UNITS.update(UNITS4)
if __name__ == '__main__': rules.main()

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

NC_PROG = [0, 49, 4, 52, 7, 11, 13, 19, 23, 29, 59, 63, 66, 67, 69, 79, 83, 89, 51, 53, 55, 64, 70, 78, 81]

def gen_ncspell(n, rnd):
    """non-combat handlers (party buffs, awaken, heals, cures) through the non-combat dispatcher"""
    e = Emu(); R = Rec(e)
    for off in QUIET3 + (0x044E0, 0x06798, 0x06FB8, 0x042DC): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    picks = []
    e.stub(0x042AA, 'pick', nargs=2, fn=lambda e, sp: picks.pop(0) if picks else 0x1b)
    out = []
    for i in range(n):
        spell = NC_PROG[i % len(NC_PROG)] if i < 6 * len(NC_PROG) else rnd.choice(NC_PROG)
        seed = rnd.getrandbits(32)
        mk = rnd.choice([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x1b, 0x31]); ck = rnd.choice([0x0d, 0x0d, 0x1b, 0x20])
        pp = [mk, ck] if spell in (51, 53, 55, 64, 70, 78, 81) else [ck]
        def setup(e):
            picks[:] = pp
            sl(e, SEED, seed); ch = pe_state(e, rnd)
            sb(e, -16140, rnd.choice([0, 1, 1])); sw(e, -1342, 0); sb(e, -31154, rnd.choice([0, 1, 2, 2]))
            sb(e, -21974, rnd.choice([0, 0, 0, 2, 3, rnd.getrandbits(8)])); sb(e, -31064, rnd.getrandbits(8))
            sw(e, -16138, rnd.getrandbits(16)); sw(e, -16136, rnd.getrandbits(16))
            for d in (-31147, -31136, -31135, -31144, -31142, -31084, -31146, -31145, -31143, -31139, -31137, -31140, -31138, -31208, -31210, -31204):
                sb(e, d, rnd.choice([0, 0, 1, 0xf9, 0xfa, 0xfb, 0xfd, 0xfe, 0xff, 0xea, 0xeb, 0xec, rnd.getrandbits(8)]))
            setup_party(e, rnd, rnd.choice([1, 1, 2, 3, 4, 5, 6]))
            sz = e.r16(g(-31066)); idxs = [e.r16(g(-31082) + 2 * k) for k in range(8)]
            for k in range(8):
                if idxs[k] == 0xffff or k >= sz: continue
                c = g(-10814) + 130 * idxs[k]
                for off, f in ((38, lambda: rnd.choice([0, 0, 0x04, 0x08, 0x10, 0x7f, 0x80, 0x82, 0x40, 0xc0, 0xff, rnd.getrandbits(8)])), (37, lambda: rnd.choice([0, 0x20, 0x27, 0x28, 0x29, rnd.getrandbits(8)])), (113, lambda: rnd.randint(1, 20))):
                    e.w8(c + off, f())
                e.w16(c + 94, rnd.choice([rnd.randint(0, 400), rnd.getrandbits(16)])); e.w16(c + 116, rnd.randint(0, 500))
            if rnd.random() < .6: sl(e, -18380, g(-10814) + 130 * rnd.choice([i for i in idxs[:sz]]))
        v = R.run(DISP_NC, (spell,), setup, max_insn=3_000_000)
        out.append({'seed': seed, 'spell': spell, 'picks': pp, **({'keep': True} if i < len(NC_PROG) and v['fin'] else {}), **v})
    return out

MON_LEAVES = {0x1F414: ('spray1', 0), 0x1F632: ('sprayAll', 0), 0x1F72E: ('cond', 1), 0x1F896: ('cond2', 1), 0x1F912: ('v140E', 0), 0x1F94E: ('v140F', 0), 0x1F988: ('v1412', 0), 0x1F9CC: ('v1416', 0), 0x1FA3E: ('v141B', 0)}

def gen_monspell(n, rnd):
    """CODE+0x1FB4E monster spell dispatcher: spell -> effect verbs; leaf verbs are logged stubs, the dice routine (0x1F6DC) is real"""
    e = Emu(); R = Rec(e)
    for off in QUIET3: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    leaf141f = int(os.popen('./lab.sh LAB_141F').read().strip(), 16)
    for off, (nm, na) in list(MON_LEAVES.items()) + [(leaf141f, ('v141F', 0))]: e.stub(off, nm, nargs=na)
    out = []
    for i in range(n):
        spell = (i % 36) if i < 360 else rnd.choice([rnd.randint(0, 33), rnd.getrandbits(8)])
        seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed); synth_monsters(e, rnd)
            sb(e, -1271, rnd.randint(0, 10)); sb(e, -31141, rnd.choice([0, 1, 0xfe, 0xff]))
            for k in range(11): sb(e, -4574 + k, rnd.choice([rnd.randint(0, 255), rnd.randint(0, 0xb2), rnd.randint(0xb3, 255)])); sw(e, -1338 + 2 * k, rnd.choice([0, 1, 2, 3, rnd.randint(1, 3000)]))
            sw(e, -3852, rnd.getrandbits(16))
        v = R.run(0x1FB4E, (spell,), setup, max_insn=3_000_000)
        out.append({'seed': seed, 'spell': spell, **v})
    return out

def gen_itemuse(n, rnd):
    """CODE+0x137E0 (backpack item) / 0x13896 (equipped item) use: charges, removal, then cast or stat boost"""
    e = Emu(); R = Rec(e)
    for off in QUIET3: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    e.stub(0x1374A, 'msg', nargs=1); e.stub(0x13AE2, 'cast', nargs=3)
    out = []
    for i in range(n):
        kind = rnd.choice(['pack', 'equip']); slot = rnd.randint(0, 5)
        ch = g(-10814) + 130 * rnd.randint(0, 47); iid = rnd.randint(1, 255); rec = g(-16126) + 20 * iid
        def setup(e):
            e.uc.mem_write(g(-16126), bytes(rnd.getrandbits(8) for _ in range(256 * 20)))
            e.w8(rec + 15, rnd.choice([0, 0x05, 0x13, 0x25, 0x7f, 0x80, 0x81, 0xc0, 0xff, rnd.getrandbits(8)]))
            for off in range(0x28, 0x4c): e.w8(ch + off, rnd.choice([0, 1, 2, 0xff, rnd.getrandbits(8)]))
            for off in (0x6a, 0x6b, 0x6e, 0x6f, 0x71, 0x72, 0x75, 0x58): e.w8(ch + off, rnd.choice([0, 100, 250, 254, 255, rnd.getrandbits(8)]))
            sb(e, -16140, rnd.getrandbits(8))
        v = R.run(0x137E0 if kind == 'pack' else 0x13896, ((ch, 4), (rec, 4), slot), setup, max_insn=2_000_000)
        out.append({'kind': kind, 'ch': ch, 'rec': rec, 'slot': slot, **v})
    return out

def gen_canequip(n, rnd):
    """CODE+0xEC02 can an item be equipped alongside what is worn (one melee weapon, two-handed vs body armour, ranged, armour classes)"""
    e = Emu(); R = Rec(e)
    for off in QUIET3 + (0x042DC,): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    e.stub(0xE238, 'msg', nargs=1)
    out = []
    for i in range(n):
        ch = g(-10814) + 130 * rnd.randint(0, 47); slot = rnd.randint(0, 5)
        def idf(): return rnd.choice([0, 0, rnd.randint(1, 0x41), rnd.randint(0x42, 0x5b), rnd.randint(0x5c, 0x72), rnd.randint(0x73, 0x7e), rnd.randint(0x7f, 0x9a), rnd.randint(0x9b, 0x9f), rnd.getrandbits(8)])
        def setup(e):
            for k in range(6): e.w8(ch + 0x28 + k, idf() if rnd.random() < .5 else 0)
            e.w8(ch + 0x3a + slot, idf())
        v = R.run(0xEC02, ((ch, 4), slot), setup)
        out.append({'ch': ch, 'slot': slot, **v})
    return out

def gen_equipcmd(n, rnd):
    """CODE+0xED9C equip command: pick a backpack item, free slot, cursed flag, alignment tag, class mask, 0xF0 items, compatibility, move, AC"""
    e = Emu(); R = Rec(e)
    for off in QUIET3 + (0x042DC,): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    picks = []
    e.stub(0x042AA, 'pick', nargs=2, fn=lambda e, sp: picks.pop(0) if picks else 0x1b)
    e.stub(0xE238, 'msg', nargs=1); e.stub(0x036AE, 'draw', nargs=1)
    out = []
    for i in range(n):
        seed = rnd.getrandbits(32); ch = g(-10814) + 130 * rnd.randint(0, 47)
        pp = [rnd.choice([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x61, 0x62, 0x1b, 0x46]) for _ in range(rnd.randint(1, 3))]
        def idf(): return rnd.choice([0, rnd.randint(1, 0x41), rnd.randint(0x42, 0x5b), rnd.randint(0x5c, 0x72), rnd.randint(0x73, 0x7e), rnd.randint(0x7f, 0x9a), rnd.randint(0x9b, 0x9f), rnd.randint(1, 255)])
        def setup(e):
            picks[:] = pp; sl(e, SEED, seed)
            e.uc.mem_write(g(-16126), bytes(rnd.getrandbits(8) if rnd.random() < .5 else rnd.choice([0, 0xf0, 0x11]) for _ in range(256 * 20)))
            for r_ in range(256): e.w8(g(-16126) + 20 * r_ + 14, rnd.choice([0, 0x11, 0x23, 0xf0, rnd.getrandbits(8)])); e.w8(g(-16126) + 20 * r_ + 13, rnd.choice([0, 0, 0x01, 0x80, 0x41, rnd.getrandbits(8)]))
            for k in range(6):
                e.w8(ch + 0x28 + k, idf() if rnd.random() < .45 else 0); e.w8(ch + 0x3a + k, idf() if rnd.random() < .7 else 0)
                e.w8(ch + 0x40 + k, rnd.randint(0, 9)); e.w8(ch + 0x46 + k, rnd.choice([0, 0x40, 0x80, 0xc0, 0xff, 0x05, rnd.getrandbits(8)]))
            e.w8(ch + 0x0f, rnd.randint(0, 7)); e.w8(ch + 0x6a, rnd.randint(0, 3)); e.w8(ch + 38, rnd.getrandbits(8))
            for k in range(8): sb(e, -28626 + k, rnd.choice([1 << rnd.randint(0, 7), rnd.getrandbits(8)]))
            for k in range(4): sb(e, -28630 + k, rnd.randint(0, 3))
            setup_party(e, rnd, 6)
        v = R.run(0xED9C, ((ch, 4),), setup, max_insn=3_000_000)
        out.append({'seed': seed, 'ch': ch, 'picks': pp, **v})
    return out

UNITS4 = {'equipcmd': gen_equipcmd, 'canequip': gen_canequip, 'itemuse': gen_itemuse, 'monspell': gen_monspell, 'ncspell': gen_ncspell, 'cbspell': gen_cbspell, 'castdisp': gen_castdisp, 'anywhere': gen_anywhere, 'dicedmg': gen_dicedmg, 'maxtargets': gen_maxtargets, 'castroute': gen_castroute, 'partyeffect': gen_partyeffect}
rules.UNITS.update(UNITS4)
if __name__ == '__main__': rules.main()

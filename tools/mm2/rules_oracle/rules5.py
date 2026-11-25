#!/usr/bin/env python3
"""MM2 rules vector generators, pass 4 (overlay hunk: character creation and the file loaders; world rules).
Usage as rules.py:  rules5.py UNIT OUT.json [--n N]   (`subset` is rules.py's).  Units merge into rules.UNITS.
The overlay hunk (file 0x28854) is mapped by emu.Emu.load_overlay; overlay offsets are passed to call() as `OVL_REL + off`."""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import rules
from rules import *
from emu import Emu, A4V, HEAP, REPO, CODE_BASE, OVL_REL, OVL_BASE
from harness import Rec

# UI / OS callees of the character-creation screen (root libc through the A4 jump table, and overlay-local screens)
UI_ROOT = (0x22108, 0x22376, 0x22480, 0x218EA, 0x042DC, 0x220E2, 0x0339C, 0x22586, 0x064F8)
UI_OVL = (0x1C0E, 0x175A, 0x1D42)
ROSTER = -10814      # 48 x 130 B party/roster working array (the creation screen's own array is 24 x 0x82 at A4-10814, see gen_slot)

def ovl(off): return OVL_REL + off

def new_emu():
    e = Emu(); e.heap = HEAP
    return e

def gen_slot(n, rnd):
    """overlay 0x181E first free roster slot (24 x 0x82 B records at A4-10814, in use = byte +0x0B != 0), -1 when full"""
    e = new_emu(); R = Rec(e); out = []
    for i in range(n):
        def setup(e):
            fill = rnd.choice([0, 1, 5, 23, 24, rnd.randint(0, 24)])
            for k in range(24):
                e.w8(g(-10814) + 130 * k + 11, rnd.choice([1, 1, 0xff, rnd.getrandbits(8) | 1]) if k < fill else rnd.choice([0, 0, 0, 0]))
        out.append(R.run(ovl(0x181E), (), setup))
    return out

def gen_flags(n, rnd):
    """overlay 0x1DF4 class eligibility from the 7 rolled stats: flags[8]"""
    e = new_emu(); R = Rec(e); out = []
    for i in range(n):
        st = e.alloc(8); fl = e.alloc(8)
        def setup(e):
            for k in range(8): e.w8(st + k, rnd.choice([rnd.randint(3, 21), rnd.randint(10, 17), rnd.getrandbits(8)]))
            for k in range(8): e.w8(fl + k, rnd.choice([0, 1, 0xff]))
        v = R.run(ovl(0x1DF4), ((st, 4), (fl, 4)), setup)
        out.append({'stats': st, 'flags': fl, **v})
        e.heap = HEAP
    return out

def gen_roll(n, rnd):
    """overlay 0x1F84 roll the 7 stats: three rand(10,79)/10 per stat (3..21), then eligibility (0x1DF4) and display (stub)"""
    e = new_emu(); R = Rec(e)
    for off in UI_ROOT: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    e.stub(ovl(0x1D42), 'show', nargs=0, quiet=True)
    out = []
    for i in range(n):
        st = e.alloc(8); fl = e.alloc(8); seed = rnd.getrandbits(32)
        def setup(e):
            sl(e, SEED, seed)
            for k in range(8): e.w8(st + k, rnd.getrandbits(8)); e.w8(fl + k, rnd.getrandbits(8))
        v = R.run(ovl(0x1F84), ((st, 4), (fl, 4)), setup)
        out.append({'seed': seed, 'stats': st, 'flags': fl, **v})
        e.heap = HEAP
    return out

def gen_build(n, rnd):
    """overlay 0x185A build the roster record from (class, race, alignment, sex, name*, stats*)"""
    e = new_emu(); R = Rec(e); out = []
    for i in range(n):
        st = e.alloc(8); nm = e.alloc(16)
        cls = rnd.choice([rnd.randint(0, 7), rnd.randint(0, 7), rnd.randint(0, 7), rnd.getrandbits(8)]); race = rnd.choice([rnd.randint(1, 5), rnd.randint(1, 5), rnd.randint(0, 9)])
        al = rnd.choice([1, 2, 3, rnd.getrandbits(8)]); sex = rnd.choice([1, 2, rnd.getrandbits(8)])
        def setup(e):
            for k in range(7): e.w8(st + k, rnd.choice([rnd.randint(3, 25), rnd.randint(2, 25), rnd.randint(0, 40), rnd.randint(0xf0, 0xff)]))
            e.w8(st + 6, rnd.randint(0, 40))   # luck indexes the starting-item table: keep (w-1)*8+class inside the recorded DATA window
            name = bytes(rnd.randint(0x41, 0x5a) for _ in range(rnd.randint(1, 10))).ljust(11, b' ')
            for k in range(16): e.w8(nm + k, name[k] if k < len(name) else rnd.getrandbits(8))
            fill = rnd.choice([0, 3, 24, rnd.randint(0, 23)])
            for k in range(24): e.w8(g(-10814) + 130 * k + 11, 1 if k < fill else 0)
            for k in range(130):   # stale bytes in the slot: the routine clears it first
                e.w8(g(-10814) + 130 * min(fill, 23) + k, rnd.choice([0, rnd.getrandbits(8)]) if k != 11 else 0)
        v = R.run(ovl(0x185A), (cls, race, al, sex, (nm, 4), (st, 4)), setup)
        out.append({'args': [cls, race, al, sex], 'name': nm, 'stats': st, **v})
        e.heap = HEAP
    return out

def gen_make(n, rnd):
    """overlay 0x214E the whole 'create a character' dialogue for one class: race 1-5 / alignment 1-3 / sex 1-2 keys (ESC aborts), name entry,
    race stat modifiers, build, reroll with the name-length cost; key input and the text-entry routine are scripted"""
    e = new_emu(); R = Rec(e)
    for off in UI_ROOT: e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    for off in UI_OVL: e.stub(ovl(off), 'ui%x' % off, nargs=0, quiet=True)
    keys = []; name = []
    e.stub(0x042AA, 'key', nargs=2, fn=lambda e, sp: keys.pop(0) if keys else 0x1b)
    def readline(e, sp):
        buf = e.r32(sp); nm = name[0] if name else b''
        e.uc.mem_write(buf, nm + b'\0')   # the name buffer is a stack local: not game state, not part of the footprint
        return len(nm)
    e.stub(0x03E32, 'readline', nargs=0, fn=readline)
    out = []
    for i in range(n):
        st = e.alloc(8); fl = e.alloc(8); seed = rnd.getrandbits(32)
        cls = rnd.randint(0, 7)
        ks = [rnd.choice([0x31, 0x32, 0x33, 0x34, 0x35, 0x35, 0x1b, 0x31]), rnd.choice([0x31, 0x32, 0x33, 0x33, 0x1b]), rnd.choice([0x31, 0x32, 0x32, 0x1b])]
        nm = bytes(rnd.randint(0x41, 0x7a) for _ in range(rnd.choice([0, 1, 4, 9, 10, 10])))
        def setup(e):
            keys[:] = ks; name[:] = [nm]; sl(e, SEED, seed)
            for k in range(7): e.w8(st + k, rnd.choice([rnd.randint(3, 21), rnd.randint(8, 21)]))
            e.w8(st + 7, 0)
            for k in range(8): e.w8(fl + k, rnd.choice([0, 1, 1, 1]))
            fill = rnd.choice([0, 2, 22, 23, 24, rnd.randint(0, 24)])
            for k in range(24): e.w8(g(-10814) + 130 * k + 11, 1 if k < fill else 0)
        v = R.run(ovl(0x214E), (cls, (st, 4), (fl, 4)), setup)
        out.append({'seed': seed, 'cls': cls, 'keys': ks, 'name': list(nm), 'stats': st, 'flags': fl, **v})
        e.heap = HEAP
    return out

def gen_loaders(n, rnd):
    """overlay startup fragments with the libc file layer stubbed (Emu.stub_libc: read_file CODE+0x2117E, alloc CODE+0x23E5C):
    items.dat -> A4-0x3EFE (256 x 20 B, word +0x12 of each record byte-swapped through CODE+0x8192), spells.dat -> A4-0x2AFE (0xC0 B raw),
    monsters.dat -> a fresh 0x1A00 B buffer whose pointer goes to A4-30658.  kind: items / spells / monsters"""
    e = new_emu(); R = Rec(e); e.stub_libc()
    e.call = lambda off, args=(), max_insn=2_000_000, _e=e: _e.call_range(*_e.frag, max_insn=max_insn)
    out = []
    FR = {'items': (OVL_REL + 0x6C4, OVL_REL + 0x712, 'items.dat', 0x1400), 'spells': (OVL_REL + 0x712, OVL_REL + 0x728, 'spells.dat', 0xC0),
          'monsters': (OVL_REL + 0xD1C, OVL_REL + 0xD4E, 'monsters.dat', 0x1A00)}
    for i in range(n):
        kind = ['items', 'spells', 'monsters'][i % 3]
        s0, s1, name, size = FR[kind]; e.frag = (s0, s1)
        data = bytes(rnd.getrandbits(8) for _ in range(rnd.choice([size, size, size, size // 2, 0])))
        def setup(e):
            e.files = {name: data}; e.heap = HEAP + rnd.choice([0, 16, 0x1000])
        v = R.run(0, (), setup)
        out.append({'kind': kind, 'size': size, 'file': list(data), **v})
    return out

# door commands (world rules): both read the party-facing map cell (y = A4-31216, x = A4-31217, byte at A4-21946 + y*16 + x) through the mask A4-21976 / shift A4-21975

def door_state(e, rnd):
    setup_party(e, rnd, rnd.randint(1, 6))
    sb(e, -31216, rnd.choice([rnd.randint(0, 15), 0, 15])); sb(e, -31217, rnd.randint(0, 15))
    for k in range(256):
        e.w8(g(-21946) + k, rnd.choice([0, 0x55, 0xaa, 0xff, rnd.getrandbits(8)])); e.w8(g(-21690) + k, rnd.getrandbits(8))
    sb(e, -21976, rnd.choice([0x03, 0x0c, 0x30, 0xc0, 0xff, 0xaa, rnd.getrandbits(8)])); sb(e, -21975, rnd.choice([0, 2, 4, 6, rnd.randint(0, 7)]))
    sb(e, -21974, rnd.choice([0, 0x55, 0x01, 0x04, 0x10, 0x40, rnd.getrandbits(8)])); sb(e, -31202, rnd.choice([0, 0, 0, 1, 2]))
    sb(e, -22023, rnd.choice([0, 1, 50, 95, 96, 100, 255, rnd.getrandbits(8)])); sb(e, -22024, rnd.choice([0, 5, 20, 60, 255, rnd.getrandbits(8)]))
    sz = e.r16(g(-31066))
    for k in range(6):
        idx = e.r16(g(-31082) + 2 * k)
        if idx == 0xffff: continue
        c = g(-10814) + 130 * idx
        e.w8(c + 0x1e, rnd.choice([0, 10, 50, 95, 96, 99, 100, 255, rnd.getrandbits(8)])); e.w8(c + 0x6b, rnd.choice([0, 10, 17, 30, 100, 200, 255, rnd.getrandbits(8)]))
    sl(e, SEED, rnd.getrandbits(32))
    sb(e, -31056, rnd.getrandbits(8)); sb(e, -31205, rnd.getrandbits(8))

def door_stubs(e, rets):
    for off in (0x21EAE, 0x6FB8, 0x22958, int(os.popen('./lab.sh LAB_0354').read().strip(), 16)): e.stub(off, 'q%x' % off, nargs=0, quiet=True)
    for off, nm, na in ((0x5816, 'msg036D', 1), (0x69DC, 'advance', 1), (0x560A, 'F560A', 0), (0x1A90E, 'F1A90E', 2), (0x171AC, 'F171AC', 0)): e.stub(off, nm, nargs=na)
    e.stub(0x1A9A6, 'F1A9A6', nargs=0, fn=lambda e, sp: rets['pickfx'])
    e.stub(0x1AE2E, 'pickmember', nargs=0, fn=lambda e, sp: rets['member'])

def gen_unlock(n, rnd):
    """CODE+0x20CA2 unlock command: the locked-door test on the facing cell, member pick, thief skill (+0x1E) roll, trap roll against door_trap A4-22023"""
    e = new_emu(); R = Rec(e); rets = {}; door_stubs(e, rets); out = []
    for i in range(n):
        rets['pickfx'] = rnd.getrandbits(8); rets['member'] = rnd.choice([0, 1, 2, 3, 4, 5, 0x1b, 0x1b])
        def setup(e):
            door_state(e, rnd)
            if rnd.random() < .7:   # make the facing cell a locked door more often
                y, x = e.r8(g(-31216)), e.r8(g(-31217)); mask = rnd.choice([3, 0xc, 0x30, 0xc0]); sh = {3: 0, 0xc: 2, 0x30: 4, 0xc0: 6}[mask]
                sb(e, -21976, mask); sb(e, -21975, sh); sb(e, -31202, 0)
                e.w8(g(-21946) + (y << 4) + x, rnd.choice([2, 2, 2, 3]) << sh | rnd.getrandbits(8) & ~mask & 0xff)
                sb(e, -21974, (1 << sh | rnd.getrandbits(8)) if rnd.random() < .8 else rnd.choice([0, 0xff]))
        v = R.run(0x20CA2, (), setup, max_insn=2_000_000)
        out.append({'pickfx': rets['pickfx'], 'member': rets['member'], **v})
    return out

def gen_bash(n, rnd):
    """CODE+0x9B48 bash a door: the facing cell test, Might of the first two members + rand(10,109)/10 against door strength A4-22024, then rand(1,100) >= 51 hurts"""
    e = new_emu(); R = Rec(e); rets = {}; door_stubs(e, rets); out = []
    for i in range(n):
        rets['pickfx'] = rnd.getrandbits(8); rets['member'] = 0
        def setup(e):
            door_state(e, rnd)
            if rnd.random() < .7:
                y, x = e.r8(g(-31216)), e.r8(g(-31217)); mask = rnd.choice([3, 0xc, 0x30, 0xc0]); sh = {3: 0, 0xc: 2, 0x30: 4, 0xc0: 6}[mask]
                sb(e, -21976, mask); sb(e, -21975, sh); sb(e, -31202, rnd.choice([0, 2, 2, 2, 1]))
                e.w8(g(-21946) + (y << 4) + x, rnd.choice([1, 2, 3]) << sh | rnd.getrandbits(8) & ~mask & 0xff)
                sb(e, -21974, (1 << sh | rnd.getrandbits(8)) if rnd.random() < .8 else rnd.choice([0, 0xff]))
        v = R.run(0x9B48, (), setup, max_insn=2_000_000)
        out.append({'pickfx': rets['pickfx'], **v})
    return out

def gen_attrib(n, rnd):
    """CODE+0x923E load the 64-byte attrib.dat record of screen A4-31218 into A4-22042: from the resident table (A4-31222 != 0) or from disk
    (open / seek / read / close of the 'attrib.dat' file, modelled as a virtual file)"""
    e = new_emu(); R = Rec(e)
    fs = {'pos': 0, 'name': ''}
    def op(e, sp):
        a = e.r32(sp); s = b''
        while e.r8(a): s += bytes([e.r8(a)]); a += 1
        fs['name'] = s.decode(); return 0x1234
    e.stub(0x212A8, 'open', nargs=0, fn=op)
    e.stub(0x21162, 'seek', nargs=0, fn=lambda e, sp: fs.__setitem__('pos', e.r32(sp + 4)))
    def rd(e, sp):
        buf = e.r32(sp + 4); ln = e.r16(sp + 8); data = e.files['attrib.dat'][fs['pos']:fs['pos'] + ln]
        for i, c in enumerate(data): e.w8(buf + i, c)
        return len(data)
    e.stub(0x21302, 'read', nargs=0, fn=rd, quiet=True)
    e.stub(0x21352, 'close', nargs=0, quiet=True)
    out = []
    for i in range(n):
        screen = rnd.choice([0, 1, 59, rnd.randint(0, 59), rnd.getrandbits(8) & 0x3f]); table = e.alloc(64 * 64); resident = rnd.random() < .5
        data = bytes(rnd.getrandbits(8) for _ in range(64 * 64))
        def setup(e):
            e.files = {'attrib.dat': data}; sb(e, -31218, screen); sl(e, -31222, table if resident else 0)
            if resident:
                for k in range(64 * 64): e.w8(table + k, data[k])
            for k in range(64): sb(e, -22042 + k, rnd.getrandbits(8))
        v = R.run(0x923E, (), setup, max_insn=2_000_000)
        out.append({'screen': screen, 'resident': resident, 'file': [] if resident else list(data[screen * 64 & 0xffff: (screen * 64 & 0xffff) + 64]), **v})
        e.heap = HEAP
    return out

UNITS5 = {'cgslot': gen_slot, 'cgflags': gen_flags, 'cgroll': gen_roll, 'cgbuild': gen_build, 'cgmake': gen_make, 'loaders': gen_loaders, 'unlock': gen_unlock, 'bash': gen_bash, 'attrib': gen_attrib}
rules.UNITS.update(UNITS5)
if __name__ == '__main__': rules.main()

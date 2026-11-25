"""Inventory commands of the party view run whole from the game's bytes: equip 0x7A67, remove 0x7E7B, trade 0x8027, discard 0x7428 (class / alignment
restriction masks, equip-slot rules, pack handling).  Keys scripted through a stubbed `wait_`; the screen layer is stubbed and logged; replayed in
TypeScript by the x86 port (tools/mm1/x86.ts `runTown`) on exactly the executed bytes."""
from ovr import *
from units_ovr import run_vec
from units_shops import town_state, town_stubs, TOWN_LEAVES
from units_spells import PARTYTAB, NPARTY, CURIDX

INV_LEAVES = {'backview': (0x74b6, None), 'getviewo': (0x6e46, None), 'esctext': (0x832b, None), 'pall': (0x835f, None), 'clr2024': (0x43c7, None)}
INV_ENTRY = {'equip': 0x7a67, 'remove': 0x7e7b, 'trade': 0x8027, 'discard': 0x7428, 'poption': 0xbe00}

ITEMS = list(range(1, 0x3d)) + list(range(0x3d, 0x56)) + list(range(0x56, 0x79)) + list(range(0x79, 0x9c)) + list(range(0x9c, 0xab)) + list(range(0xab, 0xff))

def inv_state(e, r):
    town_state(e, r)
    n = e.rb(NPARTY)
    for i in range(n):
        a = e.rw(PARTYTAB + 2 * i)
        e.wbytes(a + 0x40, [r.choice([0, 0, r.choice(ITEMS)]) for _ in range(6)])
        e.wbytes(a + 0x46, [r.choice([0, r.choice(ITEMS), r.choice(ITEMS)]) for _ in range(6)])
        e.wbytes(a + 0x4c, [r.choice([0, 0, r.randint(0, 255)]) for _ in range(12)])
        if r.random() < 0.6: e.wb(a + 0x3f, 0)
        e.wb(a + 0x12, r.choice([1, 2, 3, 1, 2, 3, 0, 4, r.getrandbits(8)])); e.wb(a + 0x14, r.choice([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 0, 7, r.getrandbits(8)]))
    if r.random() < 0.5:                        # combat option menu inputs
        e.wb(CURIDX, r.randint(0, 5)); e.wbytes(0x3c08, [r.choice([0, 0, 1, r.getrandbits(8)]) for _ in range(6)])
        a = e.rw(CHARP)
        e.wb(a + 0x6a, r.choice([0, 0, 1, r.getrandbits(8)]))
    e.wb(0x3ce9, r.choice([0, 0, r.getrandbits(8)])); e.wb(0x3cea, r.choice([0, 0, 1, 2, 3, 5]))

def inv_keys(r):
    ks = []
    for _ in range(r.randint(1, 4)):
        ks.append(r.choice([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x1b, 0x0d]))
    return ks + [0x1b] * 3

def inv_stubs(e, keys):
    w = town_stubs(e, keys)
    for n, (off, a) in INV_LEAVES.items(): e.stub(off, n, None, a)
    return w

def _mk(name, entry):
    @unit(name)
    def _(n, rnd):
        e = Emu(); Rc = Rec(e); out = []; tries = 0
        while len(out) < n and tries < n * 6:
            tries += 1
            keys = inv_keys(rnd); seed = rnd.getrandbits(32); box = {}
            def setup(e):
                inv_state(e, random.Random(seed)); box['w'] = inv_stubs(e, keys); e.scratch.clear()
            try: v = run_vec(Rc, e, entry, setup, regs_fn=lambda: {})
            except Exception as ex:
                if tries < 4: print('err', name, ex)
                continue
            if e.scratch.get('abort'): continue
            v['args'] = {'keys': box['w'].used}
            out.append(v)
        return out
for _n, _a in INV_ENTRY.items(): _mk(_n, _a)

# ---- terminal screens' own code: getinfo 0x46CB (item record), statue 0x276C, loadnext chain 0x509D (loadmaze 0xD35 / loadtype 0x4639 / resfrinn 0x45EB) ----
SCR_LEAVES = {'clear7': (0x246b, None), 'readmaze': (0x142, lambda e: [e.rw(0x138)]), 'ovloader': (0x1c, None), 'getshape': (0x128c, None),
              'clrp2': (0x42ca, None), 'pcomand': (0x4200, None), 'pnames2': (0x418f, None), 'draw': (0xf45, None)}

def scr_stubs(e, keys):
    w = inv_stubs(e, keys)
    for n, (off, a) in SCR_LEAVES.items(): e.stub(off, n, None, a)
    return w

def _mk_scr(name, entry, regfn, keyfn=lambda r: [0x1b] * 3):
    @unit(name)
    def _(n, rnd):
        e = Emu(); Rc = Rec(e); out = []; tries = 0
        while len(out) < n and tries < n * 6:
            tries += 1
            keys = keyfn(rnd); seed = rnd.getrandbits(32); box = {}
            def setup(e):
                r2 = random.Random(seed); inv_state(e, r2); box['w'] = scr_stubs(e, keys); e.scratch.clear(); box['regs'] = regfn(e, r2)
            try: v = run_vec(Rc, e, entry, setup, regs_fn=lambda: box['regs'])
            except Exception as ex:
                if tries < 4: print('err', name, ex)
                continue
            if e.scratch.get('abort'): continue
            v['args'] = {'keys': box['w'].used}
            out.append(v)
        return out

def _getinfo_regs(e, r): return {'ax': r.choice([0, 1, 0x3c, 0x3d, 0xff, r.randint(0, 255), r.randint(0, 255)])}
def _statue_regs(e, r): return {'bp': r.choice([0, 1, 2, 5, 15, 16, 17, r.randint(0, 40)])}
def _loadnext_regs(e, r):
    starts, keys, names = screen_key_tables()
    bp = r.randrange(4); i0 = starts[bp] // 2
    k = keys[r.randrange(i0, 55)]
    e.ww(0x136, r.choice([0, 1, 2, 3])); e.wb(0x3c38, r.randrange(16)); e.wb(0x3c39, r.randrange(16))
    return {'ax': k & 255, 'bx': k >> 8, 'bp': bp}
_mk_scr('getinfo', 0x46cb, _getinfo_regs)
_mk_scr('statue', 0x276c, _statue_regs, lambda r: [r.choice([0x1b, 0x0d, 0x20, 0x41])] * 3)
_mk_scr('loadnext', 0x509d, _loadnext_regs)

def _gat_stubs(e, keys):
    w = scr_stubs(e, keys); e.stubs.pop(0x7636, None); return w
_scr_stubs_orig = scr_stubs
@unit('gatgold')
def _(n, rnd):
    """gather-gold command CODE+0x7636 (sum of the party's 24-bit gold into the current member), run whole"""
    e = Emu(); Rc = Rec(e); out = []
    for _i in range(n):
        seed = rnd.getrandbits(32); box = {}
        def setup(e):
            r2 = random.Random(seed); inv_state(e, r2); box['w'] = _gat_stubs(e, [0x1b] * 3); e.scratch.clear()
            for i in range(e.rb(NPARTY)):
                a = e.rw(PARTYTAB + 2 * i); e.wbytes(a + 0x39, [r2.choice([0, r2.getrandbits(8)]), r2.choice([0, r2.getrandbits(8)]), r2.choice([0, 0, 1, 255])])
        v = run_vec(Rc, e, 0x7636, setup, regs_fn=lambda: {})
        v['args'] = {'keys': []}; out.append(v)
    return out

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

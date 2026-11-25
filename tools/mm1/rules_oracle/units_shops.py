"""Town-service flows run as whole routines from the game's own bytes: food `food` CODE+0x1DF3, general store/blacksmith `blacks` 0x2196, temple 0x1F2D,
tavern 0x2544, training hall 0x1B08.  Keys are scripted through a stubbed `wait_`; the screen layer is stubbed and logged.
Replayed in TypeScript by the verified x86 port (tools/mm1/x86.ts) on exactly the executed bytes recorded in each vector."""
from ovr import *
from units_ovr import run_vec
from units_spells import PARTYTAB, NPARTY, CURIDX

# UI leaves of the town screens (everything the flows call that only draws / waits)
TOWN_LEAVES = {'ph2': (0x40e1, lambda e: [e.rw(0x3bd4), e.rb(0x3bc3), e.rb(0x3bc4)]), 'ptext': (0x4009, lambda e: [e.rw(0x3bd4), e.rb(0x3bdc), e.rb(0x3bdd)]),
               'cout': (0x3fff, lambda e: [e.regs()['ax'] & 255]), 'pdec': (0x4030, lambda e: [e.rb(0x3c14)]), 'noises': (0x1ab3, lambda e: [e.regs()['ax'] & 255]),
               'dosound': (0x1ad6, lambda e: [e.regs()['ax']]), 'clrtext4': (0x43ba, None), 'clr40': (0x4384, None), 'clrall7': (0x4361, None), 'setgraph': (0x43fd, None),
               'pnames': (0x4118, None), 'resgrph': (0x45f7, None), 'delay': (0x2461, lambda e: [e.regs()['bx']]), 'delayt': (0x8377, None), 'dl1': (0x837a, lambda e: [e.regs()['bx']]),
               'gatgold': (0x7636, None), 'btmview': (0x6cfd, None), 'namestxt': (0x83f0, None), 'clr13to19': (0x439b, None),
               'machdelay': (0x661, None), 'puttoscr': (0xc5ad, lambda e: [e.regs()['ax'] & 255, e.regs()['cx'], e.regs()['dx']]),
               'loadgo': (0x511f, None), 'ddal': (0x6d1b, None), 'treaspix': (0xdc19, lambda e: [e.regs()['bx']]), 'treas': (0xc3ad, None)}

def town_stubs(e, keys):
    e.stubs.clear()
    for n, (off, a) in TOWN_LEAVES.items(): e.stub(off, n, None, a)
    w = WaitKeys(e, keys, tail=(0x1b,), limit=60); e.stub(0x4582, 'wait_', w.fn, w.args); return w

def town_state(e, r, level=None):
    from units_world import qworld
    qworld(e, r)
    ov = Ovr('SORPIGAL'); ov.load(e); e.ww(0x132, DB); e.ww(0x134, DISPATCH)
    e.wb(DB, level if level is not None else r.choice([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 0, 6, 255]))
    n = e.rb(NPARTY)
    for i in range(n):
        a = e.rw(PARTYTAB + 2 * i)
        g = r.choice([0, 5, 40, 300, 2000, 20000, r.getrandbits(24)])
        e.wbytes(a + 0x39, g.to_bytes(3, 'little'))
        if r.random() < 0.5: e.wb(a + 0x3f, 0)                      # healthy
        if r.random() < 0.6: e.wbytes(a + 0x46, [r.choice([0, 0, r.randint(1, 254)]) for _ in range(6)])    # inventory slots
        if r.random() < 0.5: e.wbytes(a + 0x4c, [r.choice([0, r.randint(0, 255)]) for _ in range(6)])
    e.wb(0x3c79, r.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, r.getrandbits(8)])); e.wb(0x3c78, r.choice([0, 1, 2]))
    e.wb(0x3cee, r.choice([0, 0, 1])); e.wbytes(0x3cef, [r.getrandbits(8), r.getrandbits(8)])

KEYSETS = {
    'trapfx': lambda r: [r.choice([0x1b, 0x0d]) for _ in range(3)],
    'blacks': lambda r: r.choice([[0x1b], [0x41, 0x41, 0x1b, 0x1b], [0x42, 0x41, 0x42, 0x1b, 0x1b], [0x43, 0x41, 0x43, 0x42, 0x1b, 0x1b], [0x44, 0x41, 0x44, 0x42, 0x1b, 0x1b],
                                   [0x31, 0x41, 0x44, 0x41, 0x1b, 0x1b, 0x1b], [0x47, 0x1b], [0x32, 0x42, 0x44, 0x43, 0x1b, 0x1b, 0x1b]] + [[r.choice([0x41, 0x42, 0x43, 0x44, 0x47, 0x31, 0x32, 0x1b, 0x0d]) for _ in range(r.randint(2, 9))] + [0x1b] * 3 for _ in range(3)]),
    'food': lambda r: r.choice([[0x59], [0x4e], [0x1b], [0x41, 0x59], [0x59, 0x1b]]),
    'temple': lambda r: [r.choice([0x59, 0x4e, 0x1b, 0x41, 0x42, 0x43, 0x44, 0x31, 0x32, 0x0d]) for _ in range(r.randint(1, 8))] + [0x1b] * 3,
    'tavern': lambda r: [r.choice([0x41, 0x42, 0x43, 0x47, 0x31, 0x32, 0x33, 0x34, 0x59, 0x4e, 0x0d, 0x1b]) for _ in range(r.randint(1, 9))] + [0x1b] * 3,
    'training': lambda r: [r.choice([0x41, 0x42, 0x43, 0x44, 0x31, 0x32, 0x33, 0x59, 0x4e, 0x0d, 0x1b]) for _ in range(r.randint(1, 8))] + [0x1b] * 3,
}
ENTRY = {'trapfx': 0x3d65, 'blacks': 0x2196, 'food': 0x1df3, 'temple': 0x1f2d, 'tavern': 0x2544, 'training': 0x1b08}

def mk_flow(name):
    @unit(name)
    def _(n, rnd, name=name):
        e = Emu(); Rc = Rec(e); out = []; tries = 0
        while len(out) < n and tries < n * 4:
            tries += 1
            keys = KEYSETS[name](rnd); seed = rnd.getrandbits(32); box = {}
            def setup(e):
                town_state(e, random.Random(seed)); box['w'] = town_stubs(e, keys); e.scratch.clear()
            try: v = run_vec(Rc, e, ENTRY[name], setup, regs_fn=lambda: {})
            except Exception as ex: continue
            if e.scratch.get('abort'): continue
            v['args'] = {'keys': box['w'].used}
            out.append(v)
        return out
for _n in ENTRY: mk_flow(_n)

"""Overlay units (see ovr.py): the special-cell dispatcher alone (`ovdisp`, stops at the decision point), whole special-cell runs through the
dispatcher into the real handler and the real MM.EXE helpers (`ovcell`), the screen-key resolver (`scrkey`, CODE+0xD71) and the cell loader (`cellload`).
Each vector additionally carries `code`: the bytes of every instruction actually executed (overlay and MM.EXE alike), so the TypeScript
x86 port runs on exactly those bytes; leaf/terminal routines are stubs logged as calls."""
from ovr import *
from unicorn import UC_HOOK_CODE

def run_vec(Rc, e, ip, setup, regs_fn=None, stop=None, stops=(), max_insn=60_000):
    code = {}
    skip = set(stops) | ({stop} if stop is not None else set())
    def ch(uc, addr, size, ud):
        o = addr - CS_BASE
        if o in skip or o in code or o in e.stubs: return
        code[o] = bytes(uc.mem_read(addr, size)).hex()
    e.uc.ctl_flush_tb()          # translated blocks cached from un-hooked runs (table building, baselines) carry no memory-read instrumentation
    h = e.uc.hook_add(UC_HOOK_CODE, ch)
    try: v = Rc.run(ip, None, setup, stop=stop, stops=stops, regs_fn=regs_fn, max_insn=max_insn)
    finally: e.uc.hook_del(h)
    v['code'] = {str(k): c for k, c in sorted(code.items())}
    return v

def pick_cell(r, ov, tab):
    """a (cell, facing) that reaches a handler most of the time (tab from the real dispatcher), sometimes a random one"""
    hit = [(c, f) for c, d in tab.items() for f, h in d.items() if h != 'nomask']
    if hit and r.random() < 0.8: return r.choice(hit)
    return r.randrange(256), r.choice([0xc0, 0x30, 0x0c, 0x03, r.getrandbits(8)])

_TAB = {}
def tab_for(e, ov):
    if ov.name not in _TAB:
        t = {}
        if table_layout(ov) is not None:
            for cell in range(256):
                for f in (0xc0, 0x30, 0x0c, 0x03):
                    h = real_dispatch(e, ov, cell, f)
                    if h != 'miss': t.setdefault(cell, {})[f] = h
        else: t = {c: {0xc0: DISPATCH} for c in range(256)}
        _TAB[ov.name] = t
    return _TAB[ov.name]

def perturb_for(r, e, ov, cell, mask, keys, kbk):
    """mutate overlay-data bytes the handler actually reads (a baseline run finds them)"""
    try: base = explore_run(e, ov, DISPATCH, random.Random(r.getrandbits(32)), keys, kbk, cell=cell, mask=mask)
    except Exception: return []
    pool = sorted(base['reads'])
    if not pool or r.random() < 0.35: return []
    return [(DB + r.choice(pool), r.choice([0, 1, 2, 3, 0x80, 0xff, r.getrandbits(8)])) for _ in range(r.choice([1, 1, 2, 3]))]

@unit('ovdisp')
def _(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    while len(out) < n:
        ov = Ovr(rnd.choice(OVR_NAMES))
        if table_layout(ov) is None: continue
        cell, mask = pick_cell(rnd, ov, tab_for(e, ov))
        miss, nomask, call = dispatcher_stops(ov)
        def setup(e):
            ov_state(e, random.Random(rnd.getrandbits(32)), ov, party=False); e.wb(0x3c3a, cell); e.wb(0x3c3d, mask)
            e.stubs.clear(); install_stubs(e, [])
        v = run_vec(Rc, e, DISPATCH, setup, stops=(miss, nomask, call))
        v['args'] = {'ov': ov.name, 'cell': cell, 'mask': mask, 'stops': [miss, nomask, call]}
        out.append(v)
    return out

@unit('ovcell')
def _(n, rnd):
    e = Emu(); Rc = Rec(e); out = []; tries = 0
    while len(out) < n:
        tries += 1
        ov = Ovr(rnd.choice(OVR_NAMES))
        cell, mask = pick_cell(rnd, ov, tab_for(e, ov))
        keys = keyset(rnd); kbk = rnd.choice([0, 1, 2, 3]); seed = rnd.getrandbits(32)
        pert = perturb_for(rnd, e, ov, cell, mask, keys, kbk)
        box = {}
        def setup(e):
            ov_state(e, random.Random(seed), ov, perturb=pert); e.wb(0x3c3a, cell); e.wb(0x3c3d, mask)
            e.stubs.clear(); box['w'] = install_stubs(e, keys, kbk=kbk); e.scratch.clear()
        try: v = run_vec(Rc, e, DISPATCH, setup, regs_fn=lambda: {})
        except Exception: continue
        if e.scratch.get('abort'): continue
        v['args'] = {'ov': ov.name, 'cell': cell, 'mask': mask, 'keys': box['w'].used, 'kbk': kbk}
        out.append(v)
    return out

@unit('scrkey')
def _(n, rnd):
    """loadmaze key resolution CODE+0xD71: AH=BL (y/x key high byte), AL key low byte, BP area class -> BX = 2*screen index, clrset byte DS:4F14, DS:136"""
    starts, keys, names = screen_key_tables()
    def mk(e, r):
        bp = r.randrange(4)
        i = r.randrange(starts[bp] // 2, 55) if r.random() < 0.9 else r.randrange(55)
        k = keys[i]
        # the code scans from the start offset without a bound; only present keys terminate, so only feed those
        i0 = starts[bp] // 2
        if k not in keys[i0:55]: k = keys[i0]
        e.ww(0x136, r.choice([0, 1, 2, 3, r.getrandbits(16)]))
        return [bp, k], {'ax': k & 255, 'bx': k >> 8, 'bp': bp}
    return run_n(n, rnd, mk, 0xd71, stop=0xda0)

@unit('cellload')
def _(n, rnd):
    """`draw` CODE+0xF45..: the party's cell id (y*16+x), the wall byte DS:3C3C / layer byte DS:3C10 read from the maze buffer, the dark-cell light rule.
    stops: 0xFA3 = lit (view setup continues), 0x11F8 = dark view"""
    def mk(e, r):
        for a in range(0x3cfa, 0x3efa): e.wb(a, r.choice([0, 0x20, 0x55, 0xaa, 0x80, 0xa0, r.getrandbits(8)]))
        e.wb(0x3c38, r.choice([r.randrange(16)] * 3 + [r.randrange(256)])); e.wb(0x3c39, r.choice([r.randrange(16)] * 3 + [r.randrange(32)]))
        e.wb(0x3c9c, r.choice([0, 0, 1, 2, 5, 255]))
        e.ww(0x132, 0xc940)
        for i in range(0x80): e.wb(0xc940 + i, r.choice([0, 1, 2, 3, 0xff, r.getrandbits(8)]))
        return [], {}
    return run_n(n, rnd, mk, 0xf45, stub=[('scrn', 0x120d, None, None)], stops=(0xfa3, 0x11f8))

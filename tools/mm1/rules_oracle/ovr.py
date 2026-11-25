"""Overlay (`.OVR`) execution harness: loads a map-script overlay into the Unicorn emulator (code at CS:0xF48F, data at DS:0xC940, per the
solved header, docs/mm1/dosega/game-rules.md section 4) and runs its special-cell dispatcher / handlers against the game's own MM.EXE helper
routines.  Only the UI/IO leaves and the terminal screen flows (shops, temple, loadnext ...) are stubbed and logged."""
import os, struct, json
from common import *
from emu import CS_BASE, DS_BASE
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_BP, UC_X86_REG_SP, UC_X86_REG_IP

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'data', 'mm1', 'dosega')
OVR_NAMES = sorted(f[:-4] for f in os.listdir(DATA_DIR) if f.endswith('.OVR'))
CB, DB = 0xf48f, 0xc940            # overlay code load offset (CS), data load offset (DS)
DISPATCH = 0xf4a1                  # the dispatcher entry installed in DS:0x134 (identical in every overlay with a table)

class Ovr:
    def __init__(self, name):
        d = open(os.path.join(DATA_DIR, name + '.OVR'), 'rb').read()
        self.name = name
        (self.magic, self.cbase, self.csz, self.dbase, self.dsz, self.bss, self.entry) = struct.unpack_from('<7H', d, 0)
        assert self.magic == 0xf2 and self.cbase == CB and self.dbase == DB and 14 + self.csz + self.dsz == len(d)
        self.code = d[14:14 + self.csz]; self.data = d[14 + self.csz:]

    def load(self, e):
        e.uc.mem_write(CS_BASE + CB, self.code)
        e.uc.mem_write(DS_BASE + DB, self.data + bytes(self.bss))
        if getattr(e, 'ov_loaded', None) is not self.name:
            e.uc.ctl_flush_tb(); e.ov_loaded = self.name   # stale translated blocks of the previous overlay

# ---- stub table: name -> (CS offset, args lambda).  Leaves are UI/IO; terminals end the handler's flow (shops, loadnext ...). ----
def _t(e): return [e.rw(0x3bd4), e.rb(0x3bc3), e.rb(0x3bc4)]
LEAVES = {
    'ph2': (0x40e1, _t), 'ph2one': (0x40d6, lambda e: [e.regs()['ax'] & 255, e.rb(0x3bc3), e.rb(0x3bc4)]),
    'noises': (0x1ab3, lambda e: [e.regs()['ax'] & 255]), 'dosound': (0x1ad6, lambda e: [e.regs()['ax']]),
    'clrbtm2': (0x43a8, None), 'clrall7': (0x4361, None), 'setgraph': (0x43fd, None), 'pnames': (0x4118, None), 'draw': (0xf45, None),
    'resgrph': (0x45f7, None), 'clrtext4': (0x43ba, None), 'home': (0x43e6, None), 'clr13to19': (0x439b, None), 'delayt': (0x8377, None),
}
TERMINALS = {      # name -> (offset, args)
    'loadnext': (0x509d, lambda e: [e.regs()['ax'] & 255, e.regs()['bx'], e.regs()['bp'], e.rb(0x3c38), e.rb(0x3c39)]),
    'loadgo': (0x511f, None), 'retfmaze': (0x5123, lambda e: [e.regs()['ax'] & 255]),
    'statue': (0x276c, lambda e: [e.regs()['bp']]),
    'blacks': (0x2196, None), 'food': (0x1df3, None), 'tavern': (0x2544, None), 'temple': (0x1f2d, None), 'training': (0x1b08, None),
    'encounter': (0x2f87, None), 'inwait': (0x4cdc, lambda e: [e.regs()['ax'] & 255]), 'wait1': (0x4cd6, None),
    'getinfo': (0x46cb, lambda e: [e.regs()['ax'] & 255]),
}
STUBNAMES = {v[0]: k for k, v in {**LEAVES, **TERMINALS}.items()}

class KbHit:
    """mykbhit stub (CODE+0x306): AL = 0 (no key) for the first `k` polls, then 0xFF (key waiting)"""
    def __init__(self, e, k): self.e = e; self.k = k; self.n = 0
    def args(self, em):
        self.n += 1; v = 0 if self.n <= self.k else 0xff; self.e.scratch['kb'] = v; return [v]
    def fn(self, em):
        em.uc.reg_write(UC_X86_REG_AX, (em.uc.reg_read(UC_X86_REG_AX) & 0xff00) | em.scratch['kb'])

class WaitKeys:
    """wait_ stub (CODE+0x4582): returns scripted keys in AL, then cycles the tail; a runaway loop aborts the run"""
    def __init__(self, e, keys, tail=(0x59, 0x0d, 0x1b), limit=48):
        self.e = e; self.q = list(keys); self.tail = list(tail); self.n = 0; self.limit = limit; self.used = []
    def args(self, em):
        self.n += 1
        if self.n > self.limit: self.e.scratch['abort'] = True; self.e.uc.emu_stop(); return [0]
        k = self.q.pop(0) if self.q else self.tail[(self.n - 1) % len(self.tail)]
        self.used.append(k); self.e.scratch['key'] = k
        return [k]
    def fn(self, em):
        em.uc.reg_write(UC_X86_REG_AX, (em.uc.reg_read(UC_X86_REG_AX) & 0xff00) | em.scratch.get('key', 0x1b))

def install_stubs(e, keys, with_wait=True, kbk=1):
    kb = KbHit(e, kbk); e.stub(0x306, 'mykbhit', kb.fn, kb.args)
    for n, (off, a) in {**LEAVES, **TERMINALS}.items(): e.stub(off, n, None, a)
    if with_wait:
        w = WaitKeys(e, keys); e.stub(0x4582, 'wait_', w.fn, w.args); return w

def ov_state(e, r, ov, party=True, perturb=()):
    """a plausible game state with the overlay loaded: random party / map state (units_world.qworld), real overlay data, optional mutated bytes"""
    from units_world import qworld
    if party: qworld(e, r)
    ov.load(e)
    e.ww(0x132, DB); e.ww(0x134, DISPATCH); e.wb(0xda6, 0)
    for (a, v) in perturb: e.wb(a, v)
    e.wb(0x3c10, e.rb(0x3c10) | 0x80)

def keyset(r):
    pool = [0x59, 0x4e, 0x0d, 0x1b, 0x20] + list(range(0x30, 0x3a)) + list(range(0x41, 0x5b))
    return [r.choice(pool) for _ in range(r.choice([0, 1, 2, 3, 5, 8]))]

def explore_run(e, ov, ip, r, keys, kbk, perturb=(), regs=None, cell=None, mask=None, state=True, max_insn=40_000):
    """one run of `ip` (handler or dispatcher) -> dict(log, regs, covered, reads_ov, keys_used) ; raises on emulator error / runaway"""
    e.reset_state(); e.log.clear(); e.scratch.clear(); e.stubs.clear()
    ov_state(e, r, ov, perturb=perturb)
    if cell is not None: e.wb(0x3c3a, cell)
    if mask is not None: e.wb(0x3c3d, mask)
    w = install_stubs(e, keys, kbk=kbk)
    cov = set(); rd = set()
    from unicorn import UC_HOOK_MEM_READ
    def ch(uc, addr, size, ud):
        o = addr - CS_BASE
        if CB <= o < CB + ov.csz: cov.add(o)
    def mr(uc, access, addr, size, value, ud):
        o = addr - DS_BASE
        if DB <= o < DB + ov.dsz + ov.bss: rd.add(o - DB)
    h1 = e.uc.hook_add(UC_HOOK_CODE, ch); h2 = e.uc.hook_add(UC_HOOK_MEM_READ, mr)
    try:
        out = e.call(ip, regs or {}, max_insn=max_insn)
    finally:
        e.uc.hook_del(h1); e.uc.hook_del(h2)
    if e.scratch.get('abort'): raise RuntimeError('runaway wait loop')
    return dict(log=[[n, list(a)] for n, a in e.log], regs=out, covered=cov, reads=rd, keys=w.used)

import capstone
MD = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16); MD.detail = True

def static_reach(ov, start):
    """instruction addresses statically reachable from `start` inside the overlay code (follows jcc both ways, local call + fall-through,
    stops at ret / jmp out of the overlay / indirect jumps)"""
    seen, todo, ends = set(), [start], 0
    lo, hi = CB, CB + (ov.entry - CB)         # code proper ends where the C-runtime entry stub starts
    while todo:
        a = todo.pop()
        while lo <= a < hi and a not in seen:
            ins = next(MD.disasm(ov.code[a - CB: a - CB + 8], a), None)
            if ins is None: break
            seen.add(a); m = ins.mnemonic; nxt = a + ins.size
            tgt = None
            if ins.op_str.startswith('0x') and m in ('call', 'jmp') or (m.startswith('j') and ins.op_str.startswith('0x')):
                tgt = int(ins.op_str, 16) & 0xffff
            if m == 'ret': break
            if m == 'jmp':
                if tgt is not None and lo <= tgt < hi: a = tgt; continue
                break
            if m.startswith('j') and tgt is not None:
                if lo <= tgt < hi: todo.append(tgt)
            elif m == 'call' and tgt is not None and lo <= tgt < hi: todo.append(tgt)
            a = nxt
    return seen

def read_cstring(ov, ptr, exe_img):
    if DB <= ptr < DB + ov.dsz: s = ov.data[ptr - DB:]
    elif ptr < 0xf000: s = exe_img[0x107b0 + ptr: 0x107b0 + ptr + 400]
    else: return None
    end = s.find(b'\0'); return s[: end if end >= 0 else 200].decode('latin-1')

def table_layout(ov):
    """parse the dispatcher's own immediates (at DISPATCH) -> the cell/mask/handler tables, so overlays with a different table are read right.
    Returns dict(count_addr, cells, masks, handlers, n) or None when the code is not the standard dispatcher shape"""
    c = ov.code[DISPATCH - CB:]
    # a0 3a 3c | bb 00 00 | 3a 87 d16 (cmp al,[bx+cells]) ... 3a 1e a16 (cmp bl,[count])
    if c[:3] != b'\xa0\x3a\x3c' or c[3:6] != b'\xbb\x00\x00' or c[6:8] != b'\x3a\x87': return None
    cells = struct.unpack_from('<H', c, 8)[0]
    if c[10] not in (0x74, 0x75) or c[12:14] != b'\xfe\xc3' or c[14:16] != b'\x3a\x1e': return None
    count = struct.unpack_from('<H', c, 16)[0]
    # find `22 87 d16` (and al,[bx+masks]) and `8b bf d16` (mov di,[bx+handlers])
    i = c.find(b'\x22\x87'); j = c.find(b'\x8b\xbf')
    if i < 0 or j < 0: return None
    masks = struct.unpack_from('<H', c, i + 2)[0]; hand = struct.unpack_from('<H', c, j + 2)[0]
    return dict(count_addr=count, cells=cells, masks=masks, handlers=hand)

def dispatcher_stops(ov):
    """CS offsets inside the dispatcher where the three outcomes are visible: miss (after the scan loop), no-mask (before `jmp wait1`), handler call (`call di`)"""
    c = ov.code[DISPATCH - CB:DISPATCH - CB + 0x80]
    miss = DISPATCH + 0x14                              # first instruction after the `jb` scan loop
    i = c.find(b'\x22\x87'); nomask = DISPATCH + i + 4 + 2
    j = c.find(b'\xff\xd7'); call = DISPATCH + j
    return miss, nomask, call

def real_dispatch(e, ov, cell, facing_mask):
    """run the overlay's real dispatcher up to the decision point -> ('miss'|'nomask'|handler address)"""
    miss, nomask, call = dispatcher_stops(ov)
    e.reset_state(); ov.load(e)
    e.ww(0x132, DB); e.ww(0x134, DISPATCH)
    e.wb(0x3c3a, cell); e.wb(0x3c3d, facing_mask)
    e.stubs.clear(); install_stubs(e, [])
    out = e.call(DISPATCH, {}, stops=(miss, nomask, call))
    s = out['stop']
    if s == miss: return 'miss'
    if s == nomask: return 'nomask'
    return out['di']

EXE_IMG = Emu().img if False else None
def exe_image():
    global EXE_IMG
    if EXE_IMG is None:
        from emu import image
        EXE_IMG = image()
    return EXE_IMG

def screen_key_tables():
    """loadmaze CODE+0xD35/0xD71: bp*2 indexes the word table DS:0x173 (start offset into the key table), the key table DS:0x17B holds (bl<<8)|al
    words scanned from that start; the match position is the MAZEDATA screen index (name pointer table DS:0x1E9, record offset index*512)"""
    img = exe_image(); ds = 0x107b0
    starts = [struct.unpack_from('<H', img, ds + 0x173 + 2 * i)[0] for i in range(4)]
    keys = [struct.unpack_from('<H', img, ds + 0x17b + 2 * i)[0] for i in range(56)]
    names = []
    for i in range(55):
        p = struct.unpack_from('<H', img, ds + 0x1e9 + 2 * i)[0]
        s = img[ds + p: ds + p + 12]; names.append(s.split(b'\0')[0].decode())
    return starts, keys, names

def resolve_screen(al, bl, bp):
    starts, keys, names = screen_key_tables()
    if bp > 3: return None
    k = ((bl & 255) << 8) | (al & 255)
    i = starts[bp] // 2
    while i < 55:
        if keys[i] == k: return i
        i += 1
    return None

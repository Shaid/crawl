"""Vector recorder for single MM1 routines / straight-line regions run under Unicorn (see emu.py).

A vector captures, for one call:
  regs   input registers (ax,bx,cx,dx,si,di,bp)
  init   key -> byte   every byte read before being written (the port may read ONLY these)
  wpre   key -> byte   pre-call value of every byte written
  fin    key -> byte   final value of every byte whose value changed
  wset   keys written with an unchanged value
  out    final registers (+ cf, zf)
  calls  logged stubbed-callee calls [name, [ax,bx,cx,dx,si,di,bp]]
Keys: 0..0xEFFF = DS offset; 0x10000 + n = CS offset n (the game reads a few code-segment bytes)."""
from unicorn import *
from emu import Emu, DS_BASE, CS_BASE, TRACK_END

class Rec:
    def __init__(self, e: Emu):
        self.e = e
    def run(self, ip, regs=None, setup=None, stop=None, stops=(), regs_fn=None, max_insn=40_000_000):
        e = self.e; uc = e.uc
        e.reset_state()
        e.log.clear()
        if setup: setup(e)
        if regs_fn: regs = regs_fn()
        init, wpre, written = {}, {}, set()
        def key(a):
            if DS_BASE <= a < DS_BASE + TRACK_END: return a - DS_BASE
            if CS_BASE <= a < CS_BASE + 0x10000: return 0x10000 + a - CS_BASE
            return None
        def rd(u, access, addr, size, value, ud):
            for a in range(addr, addr + size):
                k = key(a)
                if k is not None and k not in written and k not in init:
                    init[k] = u.mem_read(a, 1)[0]
        def wr(u, access, addr, size, value, ud):
            for a in range(addr, addr + size):
                k = key(a)
                if k is not None and k not in written:
                    written.add(k); wpre[k] = u.mem_read(a, 1)[0]
        orb, orw = e.rb, e.rw
        def note(o, n):
            for a in range(o, o + n):
                if a not in written and a not in init and 0 <= a < TRACK_END: init[a] = orb(a)
        def rb2(o): note(o, 1); return orb(o)
        def rw2(o): note(o, 2); return orw(o)
        owb, oww = e.wb, e.ww
        def wb2(o, v):          # writes made by a stub's side-effect function count as writes of the call
            if 0 <= o < TRACK_END and o not in written:
                written.add(o); wpre[o] = orb(o)
            owb(o, v)
        def ww2(o, v): wb2(o, v & 255); wb2(o + 1, (v >> 8) & 255)
        e.rb, e.rw, e.wb, e.ww = rb2, rw2, wb2, ww2   # reads made by stub argument lambdas count as reads of the call
        h1 = uc.hook_add(UC_HOOK_MEM_READ, rd)
        h2 = uc.hook_add(UC_HOOK_MEM_WRITE, wr)
        rin = {k: (regs or {}).get(k, 0) & 0xffff for k in ('ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp')}
        try:
            out = e.call(ip, rin, stop=stop, stops=stops, max_insn=max_insn)
        finally:
            uc.hook_del(h1); uc.hook_del(h2); e.rb, e.rw, e.wb, e.ww = orb, orw, owb, oww
        def cur(k): return uc.mem_read((DS_BASE + k) if k < 0x10000 else (CS_BASE + k - 0x10000), 1)[0]
        fin = {k: cur(k) for k in written}
        return {
            'regs': rin,
            'init': {str(a): v for a, v in sorted(init.items())},
            'wpre': {str(a): wpre[a] for a in sorted(written) if a not in init},
            'fin': {str(a): fin[a] for a in sorted(written) if fin[a] != wpre[a]},
            'wset': sorted(a for a in written if fin[a] == wpre[a]),
            'out': {k: out[k] for k in ('ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'cf', 'zf', 'stop')},
            'calls': [[n, list(a)] for n, a in e.log],
        }

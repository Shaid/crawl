"""Vector recorder for single MM2 routines run under Unicorn (see emu.py).

A vector captures, for one call:
  init   addr -> byte   every byte of game RAM *read before being written*
  wpre   addr -> byte   pre-call value of every byte written (not readable by the port)
  fin    addr -> byte   final value of every byte written
  ret    D0.W after return, stubs: the logged stubbed-callee calls
Addresses are absolute (A4 = 0x167FFE, see emu.A4V), data only (code/stack excluded).
The TypeScript ports run against a strict sparse memory seeded with `init`;
reading an address outside it, or writing a different result, fails the test."""
from unicorn import *
from emu import Emu, DATA_BASE, WIN, A4V, HEAP

class Rec:
    def __init__(self, e: Emu):
        self.e = e
    def run(self, off, args=(), setup=None, ret_bits=16, max_insn=2_000_000, call_fn=None):
        e = self.e
        uc = e.uc
        e.log.clear()
        if setup: setup(e)
        try: uc.ctl_flush_tb()   # a setup that ran game code would leave translated blocks without the read/write hooks below
        except Exception: pass
        init, wpre, written = {}, {}, set()
        def rd(u, access, addr, size, value, ud):
            for a in range(addr, addr + size):
                if a not in written and a not in init:
                    init[a] = u.mem_read(a, 1)[0]
        def wr(u, access, addr, size, value, ud):
            for a in range(addr, addr + size):
                if a not in written:
                    written.add(a)
                    wpre[a] = u.mem_read(a, 1)[0]
        def note(a, n):
            for x in range(a, a + n):
                if x not in written:
                    written.add(x); wpre[x] = uc.mem_read(x, 1)[0]
        e.on_write = note
        h1 = uc.hook_add(UC_HOOK_MEM_READ, rd, begin=DATA_BASE, end=DATA_BASE + WIN - 1)
        h2 = uc.hook_add(UC_HOOK_MEM_WRITE, wr, begin=DATA_BASE, end=DATA_BASE + WIN - 1)
        h3 = uc.hook_add(UC_HOOK_MEM_READ, rd, begin=HEAP, end=HEAP + 0x100000)
        h4 = uc.hook_add(UC_HOOK_MEM_WRITE, wr, begin=HEAP, end=HEAP + 0x100000)
        try:
            d0 = call_fn() if call_fn else e.call(off, args, max_insn=max_insn)   # call_fn: e.g. a mid-function entry through Emu.call_range
        finally:
            e.on_write = None
            for h in (h1, h2, h3, h4): uc.hook_del(h)
        fin = {a: uc.mem_read(a, 1)[0] for a in written}
        mask = (1 << ret_bits) - 1
        return {
            'init': {str(a): v for a, v in sorted(init.items())},
            'wpre': {str(a): wpre[a] for a in sorted(written) if a not in init},
            'fin': {str(a): fin[a] for a in sorted(written) if fin[a] != wpre[a]},
            'wset': sorted(a for a in written if fin[a] == wpre[a]),
            'ret': d0 & mask,
            'calls': [[n, list(a)] for n, a in e.log],
        }

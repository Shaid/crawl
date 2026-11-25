"""Unicorn 68000 single-routine harness for Might & Magic II (Amiga) `mm2`.

Loads the root hunks of the retail executable relocated at fixed bases
(CODE 0x2593C B, DATA 8604 B + the zero BSS that SAS/C's startup clears
contiguously after it: `LEA -24162(A4)` / 0x16D8 longs at CODE+0x248B0),
sets A4 = DATA+0x7FFE, and runs individual routines with C stack arguments
(16-bit int).  Selected callee addresses can be stubbed (UI/text/keyboard)
and are logged with their stack arguments.  No Amiga OS is emulated."""
import struct, sys, os
from unicorn import *
from unicorn.m68k_const import *

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
EXE = os.environ.get('MM2_EXE') or os.path.join(REPO, 'data', 'mm2', 'amiga', 'data', 'mm2')
CODE_BASE = 0x100000
DATA_BASE = 0x160000
DATA_LEN = 8604
WIN = 0x8000                    # A4 window: DATA .. DATA+0x8000 (BSS contiguous)
A4V = DATA_BASE + 0x7FFE
HEAP = 0x400000
STACK_TOP = 0x3F0000
RET_MAGIC = 0x3FFF00
CODE_LEN = 0x2593C
OVL_BASE = 0x300000            # overlay hunk (file 0x28854, 0xF2E longs, position independent: no relocs)
OVL_FILE = 0x28854
OVL_LEN = 0xF2E * 4
OVL_REL = OVL_BASE - CODE_BASE  # add to an overlay offset to get a `call(off)` argument

def parse_root(path=EXE):
    b = open(path, 'rb').read()
    p = 0
    u32 = lambda: struct.unpack_from('>I', b, p)[0]
    assert u32() == 0x3f3; p += 4
    assert u32() == 0; p += 4
    p += 4; first = u32(); p += 4; last = u32(); p += 4
    sizes = []
    for _ in range(last - first + 1): sizes.append(u32() * 4); p += 4
    hunks = []
    cur = None
    while True:
        t = u32() & 0x3fffffff; p += 4
        if t in (0x3e9, 0x3ea):
            n = u32() * 4; p += 4
            cur = {'data': b[p:p + n], 'relocs': {}}; p += n; hunks.append(cur)
        elif t == 0x3eb:
            p += 4; cur = {'data': b'', 'relocs': {}}; hunks.append(cur)
        elif t == 0x3ec:
            while True:
                n = u32(); p += 4
                if n == 0: break
                h = u32(); p += 4
                cur['relocs'].setdefault(h, []).extend(struct.unpack_from('>%dI' % n, b, p)); p += 4 * n
        elif t == 0x3f2:
            if len(hunks) == 3: break
        else:
            raise Exception(hex(t))
    return hunks

class Emu:
    def __init__(self):
        uc = self.uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
        uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
        uc.mem_map(0, 0x800000)
        hk = parse_root()
        bases = [CODE_BASE, DATA_BASE, DATA_BASE + WIN]
        for h, base in zip(hk[:2], bases):
            img = bytearray(h['data'])
            for th, offs in h['relocs'].items():
                for o in offs:
                    v = struct.unpack_from('>I', img, o)[0]
                    struct.pack_into('>I', img, o, (v + bases[th]) & 0xffffffff)
            uc.mem_write(base, bytes(img))
        self.load_overlay()
        self.pristine = bytes(uc.mem_read(DATA_BASE, WIN))
        uc.mem_write(RET_MAGIC, b'\x4e\x75')
        uc.hook_add(UC_HOOK_CODE, lambda u, a, s, d: u.emu_stop(), begin=RET_MAGIC, end=RET_MAGIC + 1)
        self.stubs = {}
        self.log = []
        self.seen = set()
        self.heap = HEAP

    def load_overlay(self):
        """Map the SAS/C overlay hunk (HUNK_OVERLAY payload, startup / main menu / character creation) at OVL_BASE.
        It has no relocations and reaches the root hunk's libc only through the A4 jump table, which the DATA hunk
        already holds (JMP abs.l entries relocated above), so no further linking is needed."""
        b = open(EXE, 'rb').read()
        self.uc.mem_write(OVL_BASE, b[OVL_FILE:OVL_FILE + OVL_LEN])

    # virtual file system behind the stubbed libc `read_file(name, buf, off, len)` (CODE+0x2117E)
    files = {}
    def stub_libc(self):
        """Replace the root libc routines that talk to AmigaDOS/exec by Python models (the overlay reaches them via A4):
        CODE+0x2117E read_file(name*, buf*, offset.w, len.w) -> bytes read (Open/Seek/Read/Close in one),
        CODE+0x23E5C alloc(len.l) -> heap pointer (bump allocator, 0 never)."""
        def cstr(a):
            o = b''
            while self.r8(a): o += bytes([self.r8(a)]); a += 1
            return o.decode('latin1')
        def rf(e, sp):
            name = cstr(e.r32(sp)); buf = e.r32(sp + 4); off = e.r16(sp + 8); n = e.r16(sp + 10)
            data = e.files.get(name, b'')[off:off + n]
            for i, c in enumerate(data): e.w8(buf + i, c)
            e.log.append(('read_file', (name, buf, off, n, len(data))))
            return len(data)
        def al(e, sp):
            return e.alloc(e.r32(sp))
        self.stub(0x2117E, 'read_file_', fn=rf, quiet=True)
        self.stub(0x23E5C, 'alloc_', fn=al, quiet=True)

    # memory helpers (big endian)
    def r8(self, a): return self.uc.mem_read(a, 1)[0]
    def r16(self, a): return struct.unpack('>H', self.uc.mem_read(a, 2))[0]
    def r32(self, a): return struct.unpack('>I', self.uc.mem_read(a, 4))[0]
    on_write = None   # set by harness.Rec during a recorded call: stub side effects are then part of the write footprint
    def w8(self, a, v):
        if self.on_write: self.on_write(a, 1)
        self.uc.mem_write(a, bytes([v & 0xff]))
    def w16(self, a, v):
        if self.on_write: self.on_write(a, 2)
        self.uc.mem_write(a, struct.pack('>H', v & 0xffff))
    def w32(self, a, v):
        if self.on_write: self.on_write(a, 4)
        self.uc.mem_write(a, struct.pack('>I', v & 0xffffffff))
    def g(self, disp): return (A4V + disp) & 0xffffffff     # A4-relative address
    def code(self, off): return CODE_BASE + off
    def reset(self):
        self.uc.mem_write(DATA_BASE, self.pristine)
        self.log.clear()
    def alloc(self, n):
        a = (self.heap + 15) & ~15; self.heap = a + n; return a

    def stub(self, off, name, ret=0, fn=None, nargs=6, argfn=None, quiet=False):
        """Replace the routine at CODE+off with a logging no-op (caller pops args)."""
        addr = CODE_BASE + off
        def hook(uc, a, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            args = argfn(self) if argfn else [self.r16(sp + 4 + 2 * i) for i in range(nargs)]
            self.last_ret = self.r32(sp)
            if not quiet: self.log.append((name, tuple(args)))
            r = ret
            if fn:
                x = fn(self, sp + 4)
                if x is not None: r = x
            uc.reg_write(UC_M68K_REG_D0, r & 0xffffffff)
            uc.reg_write(UC_M68K_REG_PC, self.r32(sp))
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)

    def call(self, off, args=(), max_insn=5_000_000, absolute=False):
        """C call; args = ints (16-bit) or (value, 4) tuples; D0 returned."""
        uc = self.uc
        sp = STACK_TOP
        items = [(a, 2) if not isinstance(a, tuple) else a for a in args]
        for v, s in reversed(items):
            sp -= s
            uc.mem_write(sp, struct.pack('>H' if s == 2 else '>I', v & (0xffff if s == 2 else 0xffffffff)))
        sp -= 4; uc.mem_write(sp, struct.pack('>I', RET_MAGIC))
        uc.reg_write(UC_M68K_REG_A7, sp)
        uc.reg_write(UC_M68K_REG_A4, A4V)
        uc.reg_write(UC_M68K_REG_A5, 0)
        for r in (UC_M68K_REG_D1, UC_M68K_REG_D2, UC_M68K_REG_D3, UC_M68K_REG_A0, UC_M68K_REG_A1, UC_M68K_REG_A2):
            uc.reg_write(r, 0)
        addr = off if absolute else CODE_BASE + off
        try:
            uc.emu_start(addr, RET_MAGIC + 0x100, count=max_insn)
        except UcError as ex:
            pc = uc.reg_read(UC_M68K_REG_PC)
            raise RuntimeError(f'{ex} pc=CODE+{pc - CODE_BASE:#x}')
        pc = uc.reg_read(UC_M68K_REG_PC)
        if pc not in (RET_MAGIC, RET_MAGIC + 2):
            raise RuntimeError(f'did not return: pc=CODE+{pc - CODE_BASE:#x} (insn cap?)')
        return uc.reg_read(UC_M68K_REG_D0)

    def call_range(self, start, stop, absolute=False, max_insn=5_000_000, a5_off=0x1000):
        """Run straight-line code from `start` until the PC reaches `stop` (a fragment of a larger routine, e.g. one loader inside the
        overlay's startup function) on a scratch stack frame (A5 = STACK_TOP - a5_off, locals below it)."""
        uc = self.uc
        a5 = STACK_TOP - a5_off
        uc.mem_write(a5 - 0x200, bytes(0x300))
        uc.reg_write(UC_M68K_REG_A5, a5)
        uc.reg_write(UC_M68K_REG_A7, a5 - 0x200)
        uc.reg_write(UC_M68K_REG_A4, A4V)
        for r in (UC_M68K_REG_D0, UC_M68K_REG_D1, UC_M68K_REG_D2, UC_M68K_REG_D3, UC_M68K_REG_A0, UC_M68K_REG_A1, UC_M68K_REG_A2):
            uc.reg_write(r, 0)
        s = start if absolute else CODE_BASE + start; t = stop if absolute else CODE_BASE + stop
        h = uc.hook_add(UC_HOOK_CODE, lambda u, a, sz, d: u.emu_stop(), begin=t, end=t)
        try:
            uc.emu_start(s, t + 0x100, count=max_insn)
        except UcError as ex:
            raise RuntimeError(f'{ex} pc=CODE+{uc.reg_read(UC_M68K_REG_PC) - CODE_BASE:#x}')
        finally:
            uc.hook_del(h)
        if uc.reg_read(UC_M68K_REG_PC) != t: raise RuntimeError('fragment did not reach its end')
        return uc.reg_read(UC_M68K_REG_D0)

    def snapshot(self):
        return bytes(self.uc.mem_read(DATA_BASE, WIN))
    def diff(self, before, after):
        return {i - 0x7FFE: (before[i], after[i]) for i in range(WIN) if before[i] != after[i]}

# canonical globals (A4 displacements, see docs/mm2/amiga/game-rules.md)
RAND = 0x22BC6      # rand(lo, hi)  16-bit ints, lo pushed last
SEED = -24802       # long, A4-24802
if __name__ == '__main__':
    e = Emu()
    e.w32(e.g(SEED), 12345)
    print([e.call(RAND, (1, 10)) & 0xffff for _ in range(10)], hex(e.r32(e.g(SEED))))

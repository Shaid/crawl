"""Unicorn 68000 single-routine harness for Wizardry 6 (Amiga) `Bane`.
Loads the HUNK executable relocated at fixed bases, sets A4 (SAS/C small data),
provides fake library bases whose LVO slots trap into Python, and runs individual
game routines via call()."""
import struct, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from unicorn import *
from unicorn.m68k_const import *
from hunks import parse

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DATA = os.environ.get('W6_DATA') or os.path.join(REPO, 'data', 'wizardry6', 'amiga')
BANE = os.path.join(DATA, 'Bane')
CODE_BASE = 0x100000
DATA_BASE = 0x160000
BSS_BASE = 0x168000
HEAP_BASE = 0x200000
HEAP_END = 0xE00000
LIB_BASE = 0xF00000     # libraries: each 0x2000 apart, base = LIB_BASE + i*0x2000 + 0x1000
STACK_TOP = 0x1F0000
RET_MAGIC = 0x1FFF00    # return address sentinel (holds STOP-like trap)

class Emu:
    def __init__(self, trace_unknown_lvo=True):
        self.uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
        self.uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
        uc = self.uc
        uc.mem_map(0, 0x1000000)
        hk = parse(BANE)
        self.hunks = hk
        bases = [CODE_BASE, DATA_BASE, BSS_BASE]
        for h, b in zip(hk, bases):
            img = bytearray(h['data']) + bytes(h['size'] - len(h['data']))
            for th, offs in h['relocs'].items():
                for o in offs:
                    v = struct.unpack_from('>I', img, o)[0]
                    struct.pack_into('>I', img, o, (v + bases[th]) & 0xffffffff)
            uc.mem_write(b, bytes(img))
        self.A4 = DATA_BASE + 0x7FFE
        self.heap = HEAP_BASE
        self.libs = {}
        self.lvo_handlers = {}
        self.lvo_log = []
        self.trace_unknown_lvo = trace_unknown_lvo
        # library area: fill with RTS
        uc.mem_write(LIB_BASE, b'\x4e\x75' * 0x40000)
        uc.mem_write(RET_MAGIC, b'\x4e\x75')
        uc.hook_add(UC_HOOK_CODE, self._lib_hook, begin=LIB_BASE, end=LIB_BASE + 0x80000)
        uc.hook_add(UC_HOOK_CODE, self._ret_hook, begin=RET_MAGIC, end=RET_MAGIC + 1)
        self.pc_hooks = {}
        self.blocks = []
        def bh(uc, a, s, ud):
            self.blocks.append(a)
            if len(self.blocks) > 64: del self.blocks[:32]
        uc.hook_add(UC_HOOK_BLOCK, bh)

    # --- helpers
    def r8(self, a): return self.uc.mem_read(a, 1)[0]
    def r16(self, a): return struct.unpack('>H', self.uc.mem_read(a, 2))[0]
    def r32(self, a): return struct.unpack('>I', self.uc.mem_read(a, 4))[0]
    def w8(self, a, v): self.uc.mem_write(a, bytes([v & 0xff]))
    def w16(self, a, v): self.uc.mem_write(a, struct.pack('>H', v & 0xffff))
    def w32(self, a, v): self.uc.mem_write(a, struct.pack('>I', v & 0xffffffff))
    def a4(self, disp): return (self.A4 + disp) & 0xffffffff
    def code(self, off): return CODE_BASE + off
    def alloc(self, n, fill=0):
        a = (self.heap + 15) & ~15
        self.heap = a + n
        assert self.heap < HEAP_END
        if fill is not None: self.uc.mem_write(a, bytes([fill]) * n)
        return a
    def reg(self, r): return self.uc.reg_read(r)

    def add_lib(self, name, nslots=0x400):
        i = len(self.libs)
        base = LIB_BASE + i * 0x4000 + 0x3000
        self.libs[name] = base
        return base

    def on_lvo(self, lib, lvo, fn):
        self.lvo_handlers[(self.libs[lib], lvo)] = fn

    def _lib_hook(self, uc, addr, size, ud):
        for name, base in self.libs.items():
            if base - 0x3000 <= addr < base + 0x1000:
                lvo = addr - base
                fn = self.lvo_handlers.get((base, lvo))
                self.lvo_log.append((name, lvo))
                if fn:
                    r = fn(self)
                    if r is not None: uc.reg_write(UC_M68K_REG_D0, r & 0xffffffff)
                elif self.trace_unknown_lvo:
                    print(f'[lvo] unhandled {name} {lvo}', file=sys.stderr)
                return

    def _ret_hook(self, uc, addr, size, ud):
        uc.emu_stop()

    def call(self, code_off_or_addr, args=(), absolute=False, max_insn=200_000_000, sizes=None):
        """Call routine with C-style stack args. args: list of (value,size) or ints (word)."""
        uc = self.uc
        sp = STACK_TOP
        items = []
        for a in args:
            if isinstance(a, tuple): items.append(a)
            else: items.append((a, 2))
        for v, s in reversed(items):
            sp -= s
            if s == 2: self.w16(sp, v)
            else: self.w32(sp, v)
        sp -= 4; self.w32(sp, RET_MAGIC)
        uc.reg_write(UC_M68K_REG_A7, sp)
        uc.reg_write(UC_M68K_REG_A4, self.A4)
        addr = code_off_or_addr if absolute else CODE_BASE + code_off_or_addr
        try:
            uc.emu_start(addr, RET_MAGIC + 0x100, count=max_insn)
        except UcError as ex:
            pc = uc.reg_read(UC_M68K_REG_PC)
            raise RuntimeError(f'{ex} pc={pc:#x} (CODE+{pc-CODE_BASE:#x}) blocks=' + ' '.join(f'{b-CODE_BASE:x}' for b in self.blocks[-12:]))
        pc = uc.reg_read(UC_M68K_REG_PC)
        if pc not in (RET_MAGIC, RET_MAGIC + 2):
            raise RuntimeError(f'routine did not return: pc={pc:#x} (CODE+{pc-CODE_BASE:#x})')
        return uc.reg_read(UC_M68K_REG_D0)

# ---------------------------------------------------------------------------
# PC-hook C-function emulation (cdecl, args on stack after return address)
def install_cfunc(e, code_off, fn):
    addr = CODE_BASE + code_off
    def hook(uc, a, size, ud):
        sp = uc.reg_read(UC_M68K_REG_A7)
        r = fn(e, sp + 4)
        if r is not None: uc.reg_write(UC_M68K_REG_D0, r & 0xffffffff)
        ret = e.r32(sp)
        uc.reg_write(UC_M68K_REG_A7, sp + 4)
        uc.reg_write(UC_M68K_REG_PC, ret)
    e.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)

"""Unicorn 68000 single-routine harness for Might & Magic III (Amiga) `Might&MagicIII`.

Loads the root hunks relocated at fixed bases (CODE 0x151F0 B, DATA = declared 0xF278 B: 25,156 stored +
the zero tail SAS/C's startup clears), sets A4 = DATA+0x7FFE, and loads the 8 overlay CODE hunks (position
independent: no RELOC32) at fixed bases.  The overlay-manager stubs in the jump table
(`BSR.W ovlmgr ; .w seg<<8|flag ; .w offset`, 8 bytes, from DATA+0x3C0) are patched to `JMP abs.l` into the
loaded overlay (equivalent: the manager only pages the segment in and jumps).  No Amiga OS is emulated;
selected callees are replaced by logging stubs."""
import struct, os
from unicorn import *
from unicorn.m68k_const import *

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
EXE = os.environ.get('MM3_EXE') or os.path.join(REPO, 'data', 'mm3', 'amiga', 'Might&MagicIII')
CODE_BASE = 0x100000
DATA_BASE = 0x200000
DATA_LEN = 0xF278
A4V = DATA_BASE + 0x7FFE
OV_BASE = {s: 0x300000 + s * 0x20000 for s in range(1, 9)}   # overlay seg id (jump table byte) -> base
HEAP = 0x600000
STACK_TOP = 0x5F0000
RET_MAGIC = 0x5FFF00
JT_START = 0x3C0       # first overlay stub in DATA

def load_exe(path=EXE):
    b = open(path, 'rb').read()
    u32 = lambda p: struct.unpack_from('>I', b, p)[0]
    p = 0; assert u32(p) == 0x3f3; p += 4
    while u32(p): p += 4 + u32(p) * 4
    p += 4
    p += 12 + 4 * (u32(p + 8) - u32(p + 4) + 1)
    root = {'code': None, 'data': None, 'reloc': {}}
    cur = None; hunks = []
    while True:
        t = u32(p) & 0x3fffffff
        if t in (0x3e9, 0x3ea):
            n = u32(p + 4) * 4; cur = {'data': b[p + 8:p + 8 + n], 'relocs': {}}; hunks.append(cur); p += 8 + n
        elif t == 0x3eb: cur = {'data': b'', 'relocs': {}}; hunks.append(cur); p += 8
        elif t == 0x3ec:
            p += 4
            while u32(p):
                n = u32(p); h = u32(p + 4)
                cur['relocs'].setdefault(h, []).extend(struct.unpack_from('>%dI' % n, b, p + 8)); p += 8 + 4 * n
            p += 4
        elif t == 0x3f2: p += 4
        elif t == 0x3f5: break
        else: raise Exception(hex(t))
    n = u32(p + 4); p += 8 + (n + 1) * 4
    ov = {}
    s = 0
    while p < len(b):
        t = u32(p) & 0x3fffffff
        if t == 0x3f3:
            q = p + 4
            while u32(q): q += 4 + u32(q) * 4
            q += 4; q += 12 + 4 * (u32(q + 8) - u32(q + 4) + 1); p = q
        elif t == 0x3e9:
            n = u32(p + 4) * 4; s += 1; ov[s] = b[p + 8:p + 8 + n]; p += 8 + n
        elif t in (0x3f2, 0x3f6): p += 4
        else: raise Exception(hex(t))
    return {'root_code': hunks[0]['data'], 'hunks': hunks, 'ov': ov}

def jt_target(X, disp):
    """A4-relative jump-table slot -> description."""
    d = X['hunks'][1]['data']; o = 0x7FFE + disp
    if o < 0 or o + 8 > len(d): return 'data'
    if d[o:o + 2] == b'\x4e\xf9': return 'F_%X' % struct.unpack_from('>I', d, o + 2)[0]
    if d[o:o + 2] == b'\x61\x00':
        sg, off = struct.unpack_from('>HH', d, o + 4)
        return 'OV%d_%X' % (sg >> 8, off)
    return 'data'

class Emu:
    def __init__(self):
        uc = self.uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
        uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
        uc.mem_map(0, 0x800000)
        X = self.X = load_exe()
        hk = X['hunks']
        bases = [CODE_BASE, DATA_BASE, DATA_BASE + DATA_LEN]
        for h, base in zip(hk[:2], bases):
            img = bytearray(h['data'])
            for th, offs in h['relocs'].items():
                for o in offs:
                    v = struct.unpack_from('>I', img, o)[0]
                    struct.pack_into('>I', img, o, (v + bases[th]) & 0xffffffff)
            if base == DATA_BASE:
                img = img + bytes(DATA_LEN - len(img))
                o = JT_START
                while img[o:o + 2] == b'\x61\x00':
                    sg, off = struct.unpack_from('>HH', img, o + 4)
                    img[o:o + 8] = b'\x4e\xf9' + struct.pack('>I', OV_BASE[sg >> 8] + off) + b'\x4e\x71'
                    o += 8
            uc.mem_write(base, bytes(img))
        for s, code in X['ov'].items(): uc.mem_write(OV_BASE[s], code)
        self.pristine = bytes(uc.mem_read(DATA_BASE, DATA_LEN))
        uc.mem_write(RET_MAGIC, b'\x4e\x75')
        uc.hook_add(UC_HOOK_CODE, lambda u, a, s, d: u.emu_stop(), begin=RET_MAGIC, end=RET_MAGIC + 1)
        self.log = []
        self.heap = HEAP

    def r8(self, a): return self.uc.mem_read(a, 1)[0]
    def r16(self, a): return struct.unpack('>H', self.uc.mem_read(a, 2))[0]
    def r32(self, a): return struct.unpack('>I', self.uc.mem_read(a, 4))[0]
    on_write = None
    def w8(self, a, v):
        if self.on_write: self.on_write(a, 1)
        self.uc.mem_write(a, bytes([v & 0xff]))
    def w16(self, a, v):
        if self.on_write: self.on_write(a, 2)
        self.uc.mem_write(a, struct.pack('>H', v & 0xffff))
    def w32(self, a, v):
        if self.on_write: self.on_write(a, 4)
        self.uc.mem_write(a, struct.pack('>I', v & 0xffffffff))
    def g(self, disp): return (A4V + disp) & 0xffffffff
    def code(self, off): return CODE_BASE + off
    def ov(self, seg, off): return OV_BASE[seg] + off
    def reset(self):
        self.uc.mem_write(DATA_BASE, self.pristine); self.log.clear()
    def alloc(self, n):
        a = (self.heap + 15) & ~15; self.heap = a + n; return a

    def stub(self, addr, name, ret=0, fn=None, nargs=6, argfn=None, quiet=False):
        """Replace the routine at absolute address addr with a logging no-op (caller pops args)."""
        def hook(uc, a, size, ud):
            sp = uc.reg_read(UC_M68K_REG_A7)
            args = argfn(self, sp + 4) if argfn else [self.r16(sp + 4 + 2 * i) for i in range(nargs)]
            if not quiet: self.log.append((name, tuple(args)))
            r = ret
            if fn:
                x = fn(self, sp + 4)
                if x is not None: r = x
            uc.reg_write(UC_M68K_REG_D0, r & 0xffffffff)
            uc.reg_write(UC_M68K_REG_PC, self.r32(sp))
            uc.reg_write(UC_M68K_REG_A7, sp + 4)
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=addr, end=addr)

    def call(self, addr, args=(), max_insn=5_000_000):
        """C call at absolute addr; args = ints (16-bit) or (value, 4) tuples; D0 returned."""
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
        try:
            uc.emu_start(addr, RET_MAGIC + 0x100, count=max_insn)
        except UcError as ex:
            pc = uc.reg_read(UC_M68K_REG_PC)
            raise RuntimeError(f'{ex} pc={pc:#x}')
        pc = uc.reg_read(UC_M68K_REG_PC)
        if pc not in (RET_MAGIC, RET_MAGIC + 2):
            raise RuntimeError(f'did not return: pc={pc:#x} (insn cap?)')
        return uc.reg_read(UC_M68K_REG_D0)

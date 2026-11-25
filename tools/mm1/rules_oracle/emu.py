"""Unicorn 16-bit real-mode loader for the retail MM1 `MM.EXE` (DOS/EGA).

Memory model (all derived from the MZ header + startup stub at image 0xEFA0, see docs/mm1/dosega/game-rules.md section 1):
  image = file[0x200:] (118,752 B).  The one MZ relocation that matters patches `mov bp,0x107B`: DS = CS + 0x107B.
  CS base = linear CS0 (image offset 0 = start of code = the offsets MM.RSM calls type-2 symbols),
  DS base = CS0 + 0x107B0 (image offset 0x107B0 = DS:0000; MM.RSM type-3 symbols are DS offsets), SS = DS (startup `mov ss,bp`).
The `.OVR` map-script code is not loaded here (pass 1 does not run it)."""
import os, sys
from unicorn import *
from unicorn.x86_const import *

HERE = os.path.dirname(os.path.abspath(__file__))
IMG_PATH = os.environ.get('MM1_IMG', os.path.join(HERE, '..', '..', '..', 'data', 'mm1', 'dosega', 'MM.EXE'))
CS_SEG = 0x1000
CS_BASE = CS_SEG * 16
DS_SEG = CS_SEG + 0x107B
DS_BASE = DS_SEG * 16
TRACK_END = 0xF000          # DS offsets >= this are stack (not part of the footprint)
SENT = 0xFFF0               # return sentinel (CS offset)
SP0 = 0xFE00

def image():
    d = open(IMG_PATH, 'rb').read()
    return d[0x200:]

class Emu:
    def __init__(self):
        self.uc = uc = Uc(UC_ARCH_X86, UC_MODE_16)
        uc.mem_map(0x10000, 0x50000)
        img = image()
        uc.mem_write(CS_BASE, img)
        self.img = img
        uc.reg_write(UC_X86_REG_CS, CS_SEG)
        for r in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
            uc.reg_write(r, DS_SEG)
        self.stubs = {}       # cs offset -> (name, fn(emu) or None)
        self.log = []         # stub call log
        self.scratch = {}     # per-run values for stubs
        uc.hook_add(UC_HOOK_CODE, self._code_hook)
        self.stops = set()
        self.stopped_at = None
        self.reset_state()

    def reset_state(self):
        # pristine data segment: image bytes (the game's own initialised data) + zero bss
        self.uc.mem_write(DS_BASE, bytes(self.img[0x107B0:]) + bytes(0x10000 - (len(self.img) - 0x107B0)))
        self.uc.mem_write(CS_BASE, self.img[:0x10000])

    # --- data access helpers (DS offsets) ---
    def rb(self, o): return self.uc.mem_read(DS_BASE + o, 1)[0]
    def rw(self, o): return int.from_bytes(self.uc.mem_read(DS_BASE + o, 2), 'little')
    def wb(self, o, v): self.uc.mem_write(DS_BASE + o, bytes([v & 255]))
    def ww(self, o, v): self.uc.mem_write(DS_BASE + o, (v & 0xffff).to_bytes(2, 'little'))
    def wbytes(self, o, bs): self.uc.mem_write(DS_BASE + o, bytes(bs))
    def rbytes(self, o, n): return bytes(self.uc.mem_read(DS_BASE + o, n))

    def stub(self, off, name, fn=None, args=None):
        self.stubs[off] = (name, fn, args)

    def _code_hook(self, uc, addr, size, ud):
        ip = addr - CS_BASE
        if ip in self.stops:
            self.stopped_at = ip
            uc.emu_stop()
            return
        s = self.stubs.get(ip)
        if s is not None:
            name, fn, args = s
            self.log.append((name, args(self) if args else []))
            if fn: fn(self)
            # near RET
            sp = uc.reg_read(UC_X86_REG_SP)
            ret = int.from_bytes(uc.mem_read(DS_BASE + sp, 2), 'little')
            uc.reg_write(UC_X86_REG_SP, (sp + 2) & 0xffff)
            uc.reg_write(UC_X86_REG_IP, ret)

    REGS = dict(ax=UC_X86_REG_AX, bx=UC_X86_REG_BX, cx=UC_X86_REG_CX, dx=UC_X86_REG_DX, si=UC_X86_REG_SI,
                di=UC_X86_REG_DI, bp=UC_X86_REG_BP, sp=UC_X86_REG_SP)
    def regs(self):
        r = {k: self.uc.reg_read(v) for k, v in self.REGS.items()}
        r['cf'] = self.uc.reg_read(UC_X86_REG_EFLAGS) & 1
        r['zf'] = (self.uc.reg_read(UC_X86_REG_EFLAGS) >> 6) & 1
        return r

    def call(self, ip, regs=None, stop=None, stops=(), max_insn=40_000_000):
        """run the routine at CS:ip until it returns (near RET to the sentinel) or reaches CS offset `stop`"""
        uc = self.uc
        for k in self.REGS: uc.reg_write(self.REGS[k], 0)
        for k, v in (regs or {}).items():
            if k in self.REGS: uc.reg_write(self.REGS[k], v & 0xffff)
        uc.reg_write(UC_X86_REG_EFLAGS, 2)
        uc.reg_write(UC_X86_REG_CS, CS_SEG)
        for r in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS): uc.reg_write(r, DS_SEG)
        sp = SP0 - 4          # two sentinels: handlers that end in `pop ax; ret` unwind one extra level
        uc.mem_write(DS_BASE + sp, SENT.to_bytes(2, 'little') * 2)
        uc.reg_write(UC_X86_REG_SP, sp)
        self.stops = set(stops) | ({stop} if stop is not None else set())
        self.stopped_at = None
        end = CS_BASE + SENT
        try:
            uc.emu_start(CS_BASE + ip, end, count=max_insn)
        except UcError as ex:
            raise RuntimeError('emu error %s at ip=%04x' % (ex, uc.reg_read(UC_X86_REG_IP)))
        ipn = uc.reg_read(UC_X86_REG_IP)
        if self.stopped_at is None and ipn != SENT:
            raise RuntimeError('did not reach stop (ip=%04x)' % ipn)
        r = self.regs()
        r['stop'] = self.stopped_at if self.stopped_at is not None else -1
        return r

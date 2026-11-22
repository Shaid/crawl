#!/usr/bin/env python3
"""Oracle for tools/dungeonhack/engine.ts's native ports: run AESOP.EXE's OWN x86
routines under Unicorn and record their results as a test fixture.

Functions called (AESOP.EXE image offsets; segment 0f36 = the Dungeon Hack module):
  init_viewspace 0f36:040f, build_clipping 0f36:05f4, draw_walls 0f36:0785,
  step_X 0f36:0006, step_Y 0f36:00d0, seed_random 0a4f:0f87, rnd 0a4f:107c.
Calling convention (Borland, far): [sp]=ret ip, [sp+2]=ret cs, [sp+4]=argc word,
then one 32-bit slot per AESOP argument (pointers = off:seg).

draw_walls is exercised with its collaborators stubbed at the call sites: the
resource lookups (0006bf:1b22 / 18c0 / 10f5:0078) return fixed segments, and the
VFX shape blitter (12fc:6290) records (x, y, flip, shape) instead of drawing --
exactly the observable behaviour the TypeScript port reproduces.

Writes tools/walker/__tests__/dungeonhack-natives-fixture.json. Needs `pip install unicorn`.
"""
import json
import random
import struct
import sys
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_DX, UC_X86_REG_ES,
                               UC_X86_REG_IDTR, UC_X86_REG_IP, UC_X86_REG_SP, UC_X86_REG_SS, UC_X86_REG_BP)

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / 'data' / 'dungeonhack' / 'dosvga' / 'AESOP.EXE'
OUT = ROOT / 'tools' / 'walker' / '__tests__' / 'dungeonhack-natives-fixture.json'
LOADSEG = 0x1010
DGROUP = 0x1ABF + LOADSEG
DATA_SEG = 0x5000     # arrays handed to the functions live here
STACK_SEG = 0x9000
HALT = 0xF0000        # return address: linear 0xF000:0000

def lin(seg, off):
    return ((seg + LOADSEG) << 4) + off


class Emu:
    def __init__(self):
        self.uc = Uc(UC_ARCH_X86, UC_MODE_16)
        self.uc.mem_map(0, 0x100000)
        d = EXE.read_bytes()
        cblp, cp, crlc, cparhdr, _a, _b, ss, sp, _cs, ip, cs, lfarlc = struct.unpack_from('<12H', d, 2)
        size = (cp - 1) * 512 + (cblp or 512)
        self.uc.mem_write(LOADSEG * 16, d[cparhdr * 16:size])
        for i in range(crlc):
            off, seg = struct.unpack_from('<HH', d, lfarlc + 4 * i)
            a = (LOADSEG + seg) * 16 + off
            w = struct.unpack('<H', self.uc.mem_read(a, 2))[0]
            self.uc.mem_write(a, struct.pack('<H', (w + LOADSEG) & 0xFFFF))
        self.vfx = []
        self.stubs = {}

    def stub(self, seg, off, fn):
        self.stubs[lin(seg, off)] = fn

    def call(self, seg, off, args, regs=None):
        uc = self.uc
        uc.reg_write(UC_X86_REG_DS, DGROUP)
        uc.reg_write(UC_X86_REG_ES, DGROUP)
        uc.reg_write(UC_X86_REG_SS, STACK_SEG)
        sp = 0xE000
        frame = struct.pack('<HHH', 0, 0xF000, len(args)) + b''.join(struct.pack('<I', a & 0xFFFFFFFF) for a in args)
        uc.mem_write(STACK_SEG * 16 + sp, frame)
        uc.reg_write(UC_X86_REG_SP, sp)
        uc.reg_write(UC_X86_REG_CS, (seg + LOADSEG) & 0xFFFF)
        uc.reg_write(UC_X86_REG_IP, off)
        self.vfx = []

        def hook(_uc, addr, size, _ud):
            fn = self.stubs.get(addr)
            if fn:
                fn(self)
        h = uc.hook_add(UC_HOOK_CODE, hook)
        try:
            uc.emu_start(lin(seg, off), HALT, count=2_000_000)
        except Exception:
            print('fault at %04x:%04x' % (uc.reg_read(UC_X86_REG_CS), uc.reg_read(UC_X86_REG_IP)), file=sys.stderr)
            raise
        uc.hook_del(h)
        return uc.reg_read(UC_X86_REG_AX) | (uc.reg_read(UC_X86_REG_DX) << 16)

    def stack_word(self, n):
        sp = self.uc.reg_read(UC_X86_REG_SP)
        return struct.unpack('<H', self.uc.mem_read(STACK_SEG * 16 + sp + n, 2))[0]

    def retf(self, ax=None, dx=None):
        uc = self.uc
        sp = uc.reg_read(UC_X86_REG_SP)
        ip, cs = struct.unpack('<HH', uc.mem_read(STACK_SEG * 16 + sp, 4))
        uc.reg_write(UC_X86_REG_SP, sp + 4)
        uc.reg_write(UC_X86_REG_CS, cs)
        uc.reg_write(UC_X86_REG_IP, ip)
        if ax is not None:
            uc.reg_write(UC_X86_REG_AX, ax)
        if dx is not None:
            uc.reg_write(UC_X86_REG_DX, dx)

    def ptr(self, off):  # far pointer into DATA_SEG
        return (DATA_SEG << 16) | off

    def mem(self, off, n):
        return bytes(self.uc.mem_read(DATA_SEG * 16 + off, n))

    def put(self, off, b):
        self.uc.mem_write(DATA_SEG * 16 + off, bytes(b))


def main():
    rng = random.Random(0xD1A60)
    e = Emu()
    e.uc.mem_write(0xF0000, b'\xf4')  # hlt marker (never executed: emu_start stops at HALT)
    out = {}
    s8 = lambda v: v - 256 if v > 127 else v

    # ---- init_viewspace: (x, y, fdir, view_X*, view_Y*) --------------------------------
    cases = []
    for _ in range(120):
        x, y, f = rng.randrange(32), rng.randrange(32), rng.randrange(4)
        e.put(0x100, bytes(36))
        e.call(0x0F36, 0x040F, [x, y, f, e.ptr(0x100), e.ptr(0x120)])
        cases.append({'x': x, 'y': y, 'f': f, 'vx': list(e.mem(0x100, 18)), 'vy': list(e.mem(0x120, 18))})
    out['init_viewspace'] = cases

    # ---- build_clipping ------------------------------------------------------------
    cases = []
    for _ in range(150):
        vx = [rng.randrange(256) for _ in range(18)]
        vy = [rng.randrange(256) for _ in range(18)]
        nb = [rng.choice([0, 1, 2, 3, 3, 3, 3]) for _ in range(18)]
        lv = [rng.randrange(256) for _ in range(1024)]
        e.put(0x200, [0] * 36); e.put(0x240, [0] * 36); e.put(0x280, [0] * 18)
        e.put(0x2A0, vx); e.put(0x2C0, vy); e.put(0x2E0, nb); e.put(0x300, [0] * 18)
        e.put(0x1000, lv)
        e.call(0x0F36, 0x05F4, [e.ptr(0x200), e.ptr(0x240), e.ptr(0x280), e.ptr(0x2A0), e.ptr(0x2C0), e.ptr(0x2E0), e.ptr(0x1000), e.ptr(0x300)])
        cases.append({'vx': vx, 'vy': vy, 'nb': nb, 'lvlvis_in': lv,
                      'l': list(e.mem(0x200, 36)), 'r': list(e.mem(0x240, 36)), 'vis': list(e.mem(0x280, 18)),
                      'vx_out': list(e.mem(0x2A0, 18)), 'vy_out': list(e.mem(0x2C0, 18)), 'lvlvis_out': list(e.mem(0x1000, 1024)),
                      'floor': list(e.mem(0x300, 18))})
    out['build_clipping'] = cases

    # ---- draw_walls (VFX blit + resource lookups stubbed) -------------------------
    def vfx(emu):
        emu.vfx.append([emu.stack_word(6), emu.stack_word(8), emu.stack_word(10), emu.stack_word(0x18)])
        emu.retf()
    e.stub(0x12FC, 0x6290, vfx)
    e.stub(0x06BF, 0x1B22, lambda emu: emu.retf(ax=DATA_SEG - 0x1000 + 0x10))
    e.stub(0x06BF, 0x18C0, lambda emu: emu.retf())
    e.stub(0x06BF, 0x19C5, lambda emu: emu.retf())
    e.stub(0x10F5, 0x0078, lambda emu: emu.retf(ax=emu.stack_word(8), dx=DATA_SEG))
    # es:[4] = object index -> DS:[0x2062 + 2*idx] = segment (any value)
    e.uc.mem_write(((0x10F5 + LOADSEG) << 4) + 4, struct.pack('<H', 0))
    e.uc.mem_write((DGROUP << 4) + 0x2062, struct.pack('<H', DATA_SEG))
    cases = []
    for _ in range(200):
        x, y, f = rng.randrange(32), rng.randrange(32), rng.randrange(4)
        lm = [rng.choice([0xFF, 0xFF, 0xFF, 0, 1]) for _ in range(1024)]
        fl = [rng.choice([0, 1, 1, 1]) for _ in range(18)]
        e.put(0x1000, lm); e.put(0x300, fl)
        e.call(0x0F36, 0x0785, [x, y, f, 6, 190, 0x1000, 0x300])
        cases.append({'x': x, 'y': y, 'f': f, 'lvlmap': lm, 'floor': fl, 'draws': e.vfx})
    out['draw_walls'] = cases

    # ---- step_X / step_Y: (x, fdir, mtype, dist) ----------------------------------
    cases = []
    for _ in range(400):
        v, f, m, dist = rng.randrange(32), rng.randrange(4), rng.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), rng.choice([0, 1, 1, 2])
        rx = e.call(0x0F36, 0x0006, [v, f, m, dist]) & 0xFFFF
        ry = e.call(0x0F36, 0x00D0, [v, f, m, dist]) & 0xFFFF
        cases.append({'v': v, 'f': f, 'm': m, 'd': dist, 'x': rx, 'y': ry})
    out['step'] = cases

    # ---- R250: seed_random(seed) then rnd(lo, hi) --------------------------------------
    cases = []
    for seed in (0x156E0, 1, 2, 3, 0xDEADBEEF):
        e.call(0x0A4F, 0x0F87, [seed])
        vals = []
        for _ in range(300):
            lo, hi = rng.choice([(0, 6), (0, 19), (0, 3), (1, 6), (0, 255)])
            vals.append([lo, hi, e.call(0x0A4F, 0x107C, [lo, hi]) & 0xFFFF])
        cases.append({'seed': seed, 'draws': vals})
    out['rnd'] = cases

    OUT.write_text(json.dumps(out, separators=(',', ':')))
    print('fixture', OUT, {k: len(v) for k, v in out.items()})


if __name__ == '__main__':
    main()

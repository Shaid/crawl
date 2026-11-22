"""Run Dungeon Hack's own `MAZE.EXE` random-dungeon generator headlessly.

`MAZE.EXE` (Event Horizon "Random Dungeon Generator v1.0/386", Borland C++ 1991,
16-bit real mode + 386 operand-size prefixes) is a DOS program that `HACK.BAT`
runs from `SAVEGAME\\` between the two AESOP phases. It reads `SETTINGS.DAT`
and writes `LEVELS.DAT`, `FEAnn.DAT`, `ITEMS.DAT` and `SEED.TXT`. There is no
shipped instance of those outputs, so instead of re-deriving the generator by
hand we execute the game's *own* x86 code on a CPU core (Unicorn) with a thin
DOS INT 21h shim -- the same approach as crawl's musashi harnesses for 68k
routines (tools/bcdft_decompress/). No game logic lives here: only file I/O,
memory-block calls and a clock.

Dependency: `pip install unicorn` (optional; only needed to *generate* mazes --
the walker consumes the exported results).

DOS shim notes (each cost a wrong run):
  * AH=43h (get attributes) must set AX=2 on failure: Borland's `fopen("w")`
    probes with it and only creates the file on ENOENT.
  * Handles must be reused lowest-first. Borland's runtime has 20 handles
    (`_NFILE`); a monotonically increasing handle number silently fails to
    open FEA11.DAT onward (those files then come out empty).
  * IDTR.limit must be set or real-mode INT raises #GP in Unicorn.
"""
from __future__ import annotations

import os
import struct
import sys

LOADSEG = 0x1010  # PSP at 0x1000, image follows the 256-byte PSP


class DosState:
    def __init__(self, workdir: str):
        self.workdir = workdir
        self.files: dict[int, object] = {}
        self.heap_next = 0x6000
        self.exit_code: int | None = None
        self.ticks = 0
        self.stderr = bytearray()

    def path(self, name: bytes) -> str:
        n = name.decode('latin1').replace('\\', '/').lstrip('/')
        for f in os.listdir(self.workdir):
            if f.lower() == n.lower():
                return os.path.join(self.workdir, f)
        return os.path.join(self.workdir, n.upper())


def run_maze(exe_path: str, workdir: str, cmdline: bytes = b'', max_insns: int = 2_000_000_000) -> DosState:
    """Execute MAZE.EXE with `workdir` as the DOS current directory."""
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_INTR, UcError
    from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_CX, UC_X86_REG_CS,
                                   UC_X86_REG_DS, UC_X86_REG_DX, UC_X86_REG_EFLAGS, UC_X86_REG_ES,
                                   UC_X86_REG_IDTR, UC_X86_REG_IP, UC_X86_REG_SP, UC_X86_REG_SS)

    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 0x100000)
    data = open(exe_path, 'rb').read()
    cblp, cp, crlc, cparhdr, _minalloc, _maxalloc, ss, sp, _csum, ip, cs, lfarlc = struct.unpack_from('<12H', data, 2)
    size = (cp - 1) * 512 + (cblp or 512)
    uc.mem_write(LOADSEG * 16, data[cparhdr * 16:size])
    for i in range(crlc):
        off, seg = struct.unpack_from('<HH', data, lfarlc + 4 * i)
        a = (LOADSEG + seg) * 16 + off
        w = struct.unpack('<H', uc.mem_read(a, 2))[0]
        uc.mem_write(a, struct.pack('<H', (w + LOADSEG) & 0xFFFF))
    dos = DosState(workdir)
    psp = bytearray(256)
    psp[0:2] = b'\xcd\x20'
    struct.pack_into('<H', psp, 2, 0x9FFF)
    struct.pack_into('<H', psp, 0x2C, 0x0800)
    psp[0x80] = len(cmdline)
    psp[0x81:0x81 + len(cmdline)] = cmdline
    psp[0x81 + len(cmdline)] = 13
    uc.mem_write(0x10000, bytes(psp))
    uc.mem_write(0x8000, b'PATH=\0\0\1\0C:\\MAZE.EXE\0')
    uc.reg_write(UC_X86_REG_IDTR, (0, 0, 0x3FF, 0))
    uc.reg_write(UC_X86_REG_SS, (ss + LOADSEG) & 0xFFFF)
    uc.reg_write(UC_X86_REG_SP, sp)
    uc.reg_write(UC_X86_REG_DS, 0x1000)
    uc.reg_write(UC_X86_REG_ES, 0x1000)
    uc.reg_write(UC_X86_REG_CS, (cs + LOADSEG) & 0xFFFF)
    uc.reg_write(UC_X86_REG_IP, ip)

    rd = uc.reg_read

    def ret_ax(v: int) -> None:
        uc.reg_write(UC_X86_REG_AX, v & 0xFFFF)

    def setcf(c: bool) -> None:
        fl = rd(UC_X86_REG_EFLAGS)
        uc.reg_write(UC_X86_REG_EFLAGS, (fl | 1) if c else (fl & ~1))

    def readz(seg: int, off: int) -> bytes:
        out = bytearray()
        a = seg * 16 + off
        while True:
            b = uc.mem_read(a, 1)[0]
            if b == 0:
                return bytes(out)
            out.append(b)
            a += 1

    def hook(_uc, n, _ud):
        ax = rd(UC_X86_REG_AX)
        ah = ax >> 8
        if n != 0x21:
            return
        dx, ds, bx, cx = rd(UC_X86_REG_DX), rd(UC_X86_REG_DS), rd(UC_X86_REG_BX), rd(UC_X86_REG_CX)
        if ah == 0x30:
            ret_ax(0x0005); uc.reg_write(UC_X86_REG_BX, 0); setcf(False)
        elif ah in (0x25, 0x4A, 0x49, 0x47):
            setcf(False)
        elif ah == 0x35:
            uc.reg_write(UC_X86_REG_BX, 0); uc.reg_write(UC_X86_REG_ES, 0xF000); setcf(False)
        elif ah == 0x48:
            seg = dos.heap_next
            if seg + bx > 0x9F00:
                ret_ax(8); uc.reg_write(UC_X86_REG_BX, 0x9F00 - seg); setcf(True)
            else:
                dos.heap_next += bx; ret_ax(seg); setcf(False)
        elif ah == 0x2C:
            dos.ticks += 1
            uc.reg_write(UC_X86_REG_CX, 0x0C22); uc.reg_write(UC_X86_REG_DX, 0x1E00 + (dos.ticks & 0xFF)); setcf(False)
        elif ah == 0x2A:
            ret_ax(0x0003); uc.reg_write(UC_X86_REG_CX, 1993); uc.reg_write(UC_X86_REG_DX, 0x0B08); setcf(False)
        elif ah in (0x3C, 0x3D, 0x5B):
            name = readz(ds, dx)
            p = dos.path(name)
            if ah == 0x3D:
                if not os.path.exists(p):
                    ret_ax(2); setcf(True); return
                f = open(p, 'r+b' if (ax & 3) else 'rb')
            else:
                f = open(p, 'w+b')
            h = 5
            while h in dos.files:
                h += 1
            dos.files[h] = f
            ret_ax(h); setcf(False)
        elif ah == 0x3E:
            f = dos.files.pop(bx, None)
            if f:
                f.close()
            setcf(False)
        elif ah == 0x3F:
            f = dos.files.get(bx)
            d = f.read(cx) if f else b''
            if d:
                uc.mem_write(ds * 16 + dx, d)
            ret_ax(len(d)); setcf(False)
        elif ah == 0x40:
            d = bytes(uc.mem_read(ds * 16 + dx, cx))
            if bx in (1, 2):
                dos.stderr += d
            else:
                f = dos.files[bx]
                f.truncate() if cx == 0 else f.write(d)
            ret_ax(cx); setcf(False)
        elif ah == 0x42:
            f = dos.files[bx]
            off = (cx << 16) | dx
            if off & 0x80000000:
                off -= 1 << 32
            f.seek(off, ax & 0xFF)
            p = f.tell()
            ret_ax(p & 0xFFFF); uc.reg_write(UC_X86_REG_DX, p >> 16); setcf(False)
        elif ah == 0x41:
            try:
                os.remove(dos.path(readz(ds, dx)))
            except OSError:
                pass
            ret_ax(0); setcf(False)
        elif ah == 0x43:
            if os.path.exists(dos.path(readz(ds, dx))):
                uc.reg_write(UC_X86_REG_CX, 0x20); setcf(False)
            else:
                ret_ax(2); setcf(True)
        elif ah == 0x44:
            ret_ax(0x80D3 if bx < 5 else 0); uc.reg_write(UC_X86_REG_DX, 0x80D3 if bx < 5 else 0); setcf(False)
        elif ah == 0x19:
            ret_ax(2)
        elif ah == 0x4C:
            dos.exit_code = ax & 0xFF
            uc.emu_stop()
        else:
            raise RuntimeError(f'MAZE.EXE used unhandled DOS call AH={ah:02x}')

    uc.hook_add(UC_HOOK_INTR, hook)
    try:
        uc.emu_start((((cs + LOADSEG) & 0xFFFF) << 4) + ip, 0xFFFFF, count=max_insns)
    except UcError as e:  # pragma: no cover - diagnostic
        raise RuntimeError(f'MAZE.EXE emulation fault: {e}') from e
    for f in dos.files.values():
        f.close()
    return dos

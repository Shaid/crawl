#!/usr/bin/env python3
"""Unpack Executrix-packed MM3.EXE (DOS Might & Magic III) by emulating the
packer's own adaptive-Huffman LZ decompressor with Unicorn.

History: the doc's earlier attempt (`docs/mm3/dosvga/data-structure.md`
"Executrix self-unpacking") used PSP = 0x300 and faulted at ~31 KB on a
tree-walk read past the tree. Root cause: **emulator setup artifact, not a
decoder bug.** The stub computes its in-memory layout from the *original*
load segment:

    [0x492] = 0x4c2 - CS_original      (stub entry, file 0xb4)
    tree    = CS_high + [0x492]        (stub 0x278, after self-copy-high)
    input   = CS_high:0x4d1            (stub 0x28a, 0x2000-byte refill buffer)

The input buffer spans `[high_CS*16+0x4d1, high_CS*16+0x24d1)`, and the tree
base is `(high_CS + [0x492])*16`. They overlap iff

    [0x492]*16 - 0x4d1 < 0x2000   ⇔   [0x492] < 0x24e
    ⇔   CS_original > 0x4c2 - 0x24e = 0x274

PSP=0x300 gives CS_original = 0x310 > 0x274 → overlap → the tree (which grows
at `es:[bp*3]`, bp up to 0x1000+) clobbers buffered input / the walk runs
past the tree → the doc's fault. With PSP ≤ 0x200 (CS_original ≤ 0x210) there
is no overlap and the decompressor runs to completion, then the relocation
fixup pass runs (visible as the +LOAD_SEG delta on the first instructions).

Output:
  build/cache/mm3/MM3_original_reconstructed.exe
      = embedded original MZ header (file 0x699, 0x200 B) + decompressed body.

Run from repo root:  python3 tools/mm3_executrix_unpack/run.py
"""
import os, struct, sys
from unicorn import *
from unicorn.x86_const import *

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXE = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.EXE')
OUT = os.path.join(REPO, 'build', 'cache', 'mm3', 'MM3_original_reconstructed.exe')

PSP_SEG = 0x200          # must keep CS_original = 0x210 ≤ 0x274 (see above)
LOAD_SEG = PSP_SEG + 0x10
TOP_SEG = 0x9800
ENV_SEG = 0x8000


def unpack():
    fdata = open(EXE, 'rb').read()
    mu = Uc(UC_ARCH_X86, UC_MODE_16)
    mu.mem_map(0x0000, 0xA0000 - 0x0000)
    psp = bytearray(0x100)
    struct.pack_into('<H', psp, 0x02, TOP_SEG)
    struct.pack_into('<H', psp, 0x2C, ENV_SEG)
    mu.mem_write(PSP_SEG * 16, bytes(psp))
    mu.mem_write(ENV_SEG * 16, bytes(0x100))
    mu.mem_write(LOAD_SEG * 16, fdata[0x200:])

    next_handle = 5
    handles = {}
    file_pos = {}

    def int21(uc):
        nonlocal next_handle
        ah = uc.reg_read(UC_X86_REG_AH)
        if ah == 0x30:
            uc.reg_write(UC_X86_REG_AL, 5); uc.reg_write(UC_X86_REG_AH, 0); return
        if ah == 0x3D:
            dx = uc.reg_read(UC_X86_REG_DX); ds = uc.reg_read(UC_X86_REG_DS)
            addr = (ds * 16 + dx) & 0xFFFFF
            name = bytearray()
            while True:
                b = mu.mem_read(addr, 1)[0]
                if b == 0:
                    break
                name.append(b); addr += 1
            nm = bytes(name)
            h = next_handle; next_handle += 1
            handles[h] = nm; file_pos[h] = 0
            uc.reg_write(UC_X86_REG_AX, h)
            uc.reg_write(UC_X86_REG_EFLAGS, uc.reg_read(UC_X86_REG_EFLAGS) & ~1)
            return
        if ah == 0x3F:
            bx = uc.reg_read(UC_X86_REG_BX); cx = uc.reg_read(UC_X86_REG_CX)
            dx = uc.reg_read(UC_X86_REG_DX); ds = uc.reg_read(UC_X86_REG_DS)
            data = fdata  # the stub only reads the exe itself
            pos = file_pos.get(bx, 0)
            chunk = data[pos:pos + cx]
            mu.mem_write((ds * 16 + dx) & 0xFFFFF, chunk)
            file_pos[bx] = pos + len(chunk)
            uc.reg_write(UC_X86_REG_AX, len(chunk))
            return
        if ah == 0x42:
            bx = uc.reg_read(UC_X86_REG_BX); al = uc.reg_read(UC_X86_REG_AL)
            cx = uc.reg_read(UC_X86_REG_CX); dx = uc.reg_read(UC_X86_REG_DX)
            off = (cx << 16) | dx
            pos = file_pos.get(bx, 0)
            if al == 0:
                pos = off
            elif al == 1:
                pos += off
            elif al == 2:
                pos = len(fdata) + off
            file_pos[bx] = pos
            uc.reg_write(UC_X86_REG_AX, pos & 0xFFFF)
            uc.reg_write(UC_X86_REG_DX, (pos >> 16) & 0xFFFF)
            return
        if ah == 0x3E:
            uc.reg_write(UC_X86_REG_AX, 0); return
        if ah == 0x4C:
            uc.emu_stop(); return
        if ah == 0x2A:
            uc.reg_write(UC_X86_REG_CX, 1995); uc.reg_write(UC_X86_REG_DX, 0x0401)
            uc.reg_write(UC_X86_REG_AL, 4); return
        if ah == 0x2C:
            uc.reg_write(UC_X86_REG_CH, 12); uc.reg_write(UC_X86_REG_CL, 0)
            uc.reg_write(UC_X86_REG_DH, 0); uc.reg_write(UC_X86_REG_DL, 0); return
        uc.reg_write(UC_X86_REG_EFLAGS, uc.reg_read(UC_X86_REG_EFLAGS) | 1)
        uc.reg_write(UC_X86_REG_AX, 1)

    mu.hook_add(UC_HOOK_INTR, lambda u, intno, data: int21(u) if intno == 0x21 else None)
    mu.reg_write(UC_X86_REG_CS, LOAD_SEG)
    mu.reg_write(UC_X86_REG_EIP, 0)
    mu.reg_write(UC_X86_REG_DS, PSP_SEG)
    mu.reg_write(UC_X86_REG_ES, PSP_SEG)
    mu.reg_write(UC_X86_REG_SS, LOAD_SEG + 0x24D)
    mu.reg_write(UC_X86_REG_SP, 0x642)

    try:
        mu.emu_start(LOAD_SEG * 16, 0, count=0, timeout=120_000_000_000)
        status = 'CLEAN'
    except UcError as e:
        status = f'FAULT {e}'
    cs = mu.reg_read(UC_X86_REG_CS); ip = mu.reg_read(UC_X86_REG_EIP)

    body = bytes(mu.mem_read(LOAD_SEG * 16, 0x60000))
    last = max(i for i in range(len(body)) if body[i])
    body = body[:last + 1]
    # embedded original MZ header is 0x200 bytes at file 0x699
    hdr = fdata[0x699:0x699 + 0x200]
    orig = hdr + body
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'wb').write(orig)
    print(f'status: {status}  end cs:ip = {cs:#06x}:{ip:#04x}')
    print(f'decompressed body: {len(body)} bytes (0x{len(body):x})')
    print(f'reconstructed exe: {len(orig)} bytes -> {OUT}')
    print(f'body[0:8] = {body[:8].hex()}  (expect relocation delta {LOAD_SEG:#x} on doc pre-reloc bytes)')
    return orig


if __name__ == '__main__':
    unpack()

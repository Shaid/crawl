"""Replay a recorded vector in the emulator with a trace of rand() calls: replay.py FILE.json INDEX OFFSET [hexargs...]"""
import sys, json
from emu import *
from unicorn.m68k_const import *
f, idx, off = sys.argv[1], int(sys.argv[2]), int(sys.argv[3], 16)
v = json.load(open(f))[idx]
e = Emu()
for k, b in list(v['init'].items()) + list(v['wpre'].items()): e.uc.mem_write(int(k), bytes([b]))
trace = []
def ent(uc, a, s, d):
    sp = uc.reg_read(UC_M68K_REG_A7); trace.append(('rand', e.r16(sp+4), e.r16(sp+6)))
e.uc.hook_add(UC_HOOK_CODE, ent, begin=CODE_BASE+0x22BC6, end=CODE_BASE+0x22BC6)
e.stub(0xFF42, 'applyHit', argfn=lambda e: [e.r16(e.g(-3852)), e.r8(e.g(-24113))], nargs=0)
args = [int(x) for x in sys.argv[4:]]
e.call(off, args)
print(trace[:40]); print(e.log, hex(e.r32(e.g(-24802))))

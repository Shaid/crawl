"""Listing helper: python3 dis.py SEG START [END]   (SEG = root | 1..8 overlay id).
Annotates `jsr d16(A4)` with the jump-table target (root-hunk function or overlay seg/offset).
Reads the executable only; dumps are meant to be redirected under the gitignored data/mm3/amiga/."""
import sys, struct
from capstone import *
from emu import load_exe, jt_target
def main():
    seg = sys.argv[1]; start = int(sys.argv[2], 0); end = int(sys.argv[3], 0) if len(sys.argv) > 3 else start + 0x100
    X = load_exe()
    blob = X['root_code'] if seg == 'root' else X['ov'][int(seg)]
    md = Cs(CS_ARCH_M68K, CS_MODE_BIG_ENDIAN | CS_MODE_M68K_000)
    md.detail = False
    pc = start
    while pc < end:
        got = False
        for ins in md.disasm(blob[pc:end + 8], pc):
            note = ''
            if 'a4)' in ins.op_str and ins.mnemonic in ('jsr', 'jmp', 'lea', 'pea'):
                import re
                m = re.search(r'(-?\$?[0-9a-fx]+)\(a4\)', ins.op_str)
                if m and ins.mnemonic in ('jsr', 'jmp'):
                    disp = int(m.group(1).replace('$', '0x'), 0)
                    note = '   ; => ' + jt_target(X, disp)
            print('%s%06x: %-8s %s%s' % (seg + ':' if seg != 'root' else '', ins.address, ins.mnemonic, ins.op_str, note))
            pc = ins.address + ins.size; got = True
            if pc >= end: break
        if not got:
            print('%06x: .word %04x' % (pc, struct.unpack_from('>H', blob, pc)[0])); pc += 2
main()

"""Annotate an IRA listing of the MM2 root hunk: resolve `JSR d(A4)` jump-table
calls to CODE offsets.  Usage: resolve_asm.py mm2root mm2.asm OUT.asm
(all under gitignored data/).  Layout: CODE hunk 0x2593C bytes at file 0x28,
DATA hunk (8604 B) at file 0x259A8, A4 = DATA+0x7FFE; DATA starts with a table
of `JMP abs.l` stubs (6 B each)."""
import re, struct, sys
root, asm, out = sys.argv[1:4]
b = open(root, 'rb').read()
DATA = 0x259A8
def stub(disp):
    o = 0x7FFE + disp
    if o < 0 or o + 6 > 8604 or o % 6: return None
    if b[DATA+o:DATA+o+2] != b'\x4e\xf9': return None
    return struct.unpack_from('>I', b, DATA+o+2)[0]
pat = re.compile(r'(JSR|JMP)\s+(-?\d+)\(A4\)')
with open(asm) as f, open(out, 'w') as g:
    for line in f:
        m = pat.search(line)
        if m:
            t = stub(int(m.group(2)))
            if t is not None:
                line = line.rstrip('\n') + f'   ; => F_{t:05X}\n'
        g.write(line)

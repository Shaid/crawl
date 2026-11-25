"""Function map: starts = after an RTS where the next word is LINK A5 (4E55) or MOVEM.L regs,-(A7) (48E7) or the
jump-table entry offsets.  Prints start, size, rand() callers count and calls to a given jump-table target."""
import sys, struct, re, collections
from emu import load_exe, jt_target
X = load_exe()
def blob(seg): return X['root_code'] if seg == 'root' else X['ov'][int(seg)]
def starts(seg):
    b = blob(seg); s = set()
    for i in range(0, len(b) - 4, 2):
        if b[i:i+2] == b'\x4e\x75' and b[i+2:i+4] in (b'\x4e\x55', b'\x48\xe7', b'\x4e\x56', b'\x20\x2f', b'\x22\x2f', b'\x2f\x02', b'\x2f\x0e'):
            s.add(i + 2)
    s.add(0)
    return sorted(s)
if __name__ == '__main__':
    seg = sys.argv[1]; b = blob(seg); st = starts(seg)
    calls = collections.defaultdict(collections.Counter)
    for i in range(0, len(b) - 3, 2):
        if b[i:i+2] in (b'\x4e\xac',):
            t = jt_target(X, struct.unpack_from('>h', b, i+2)[0])
            f = max([x for x in st if x <= i], default=0)
            calls[f][t] += 1
    for k, f in enumerate(st):
        e = st[k+1] if k + 1 < len(st) else len(b)
        c = calls[f]
        print('%s:%05x size %5d rand %2d  mulu/divs-ish calls: %s' % (seg, f, e - f, c['F_64D4'], ' '.join('%s*%d' % (t, n) for t, n in c.most_common(4) if t != 'F_64D4')))

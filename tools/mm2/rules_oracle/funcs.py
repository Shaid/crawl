"""Function index of the MM2 root hunk from the resolved listing: for each
LINK.W A5 prologue, list size and callers of a target.  Usage:
  funcs.py callers F_22BC6        # functions that call the target
  funcs.py list                   # all function starts"""
import re, sys
F='/home/ctemplet/Development/crawl/data/mm2/amiga/mm2.res.asm'
ins=[]
for line in open(F):
    m=re.search(r';([0-9a-f]{5}): ([0-9a-f]+)',line)
    if m: ins.append((int(m.group(1),16),line.rstrip('\n')))
starts=[a for a,l in ins if 'LINK.W\tA5' in l]
import bisect
def fn_of(a):
    i=bisect.bisect_right(starts,a)-1
    return starts[i] if i>=0 else None
if sys.argv[1]=='list':
    for s in starts: print(f'{s:05x}')
elif sys.argv[1]=='callers':
    t=sys.argv[2]; tl=None
    res={}
    for a,l in ins:
        if re.search(r'(JSR|BSR|JMP)',l) and (t in l):
            res.setdefault(fn_of(a),[]).append(a)
    for f,v in sorted(res.items()): print(f'{f:05x}', len(v), ' '.join(f'{x:05x}' for x in v))

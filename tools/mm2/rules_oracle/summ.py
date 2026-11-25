"""Per-function summary: summ.py LO HI  -> size, A4 globals touched, callees"""
import re, sys, bisect
sys.path.insert(0,'/home/ctemplet/Development/crawl/tools/mm2/rules_oracle')
F='/home/ctemplet/Development/crawl/data/mm2/amiga/mm2.res.asm'
lo=int(sys.argv[1],16); hi=int(sys.argv[2],16)
ins=[]
for line in open(F):
    m=re.search(r';([0-9a-f]{5}): ([0-9a-f]+)',line)
    if m: ins.append((int(m.group(1),16),line))
starts=[a for a,l in ins if 'LINK.W\tA5' in l]
starts.append(0x25900)
for i in range(len(starts)-1):
    s,e=starts[i],starts[i+1]
    if s<lo or s>=hi: continue
    g=set();c=[];rand=0
    for a,l in ins:
        if a<s or a>=e: continue
        for m in re.finditer(r'(-?\d+)\(A4\)',l):
            d=int(m.group(1))
            if 'JSR' in l or 'JMP' in l: continue
            g.add(d)
        m=re.search(r'=> F_([0-9A-F]+)',l)
        if m: c.append(m.group(1))
        m=re.search(r'(?:JSR|BSR)\s+(LAB_\w+)',l)
        if m: c.append(m.group(1))
    print(f'{s:05x} sz={e-s:4x} g={sorted(g)[:14]} calls={" ".join(dict.fromkeys(c))[:110]}')

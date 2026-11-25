"""Compact viewer: v.py HEXADDR [NLINES]  (instructions from the resolved listing)."""
import re, sys
F='/home/ctemplet/Development/crawl/data/mm2/amiga/mm2.res.asm'
a0=int(sys.argv[1],16); n=int(sys.argv[2]) if len(sys.argv)>2 else 60
out=[];on=False
for line in open(F):
    m=re.search(r';([0-9a-f]{5}): ([0-9a-f]+)',line)
    if m and int(m.group(1),16)>=a0: on=True
    if not on: continue
    if m:
        body=line.split(';')[0].strip().replace('\t',' ')
        res=re.search(r'=> (F_[0-9A-F]+)',line)
        out.append(f"{m.group(1)[1:]} {body}"+(f"  ={res.group(1)[2:]}" if res else ''))
    elif re.match(r'^LAB_',line): out.append(line.strip())
    if len(out)>=n: break
print('\n'.join(out))

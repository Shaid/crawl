"""Minimal AmigaOS HUNK loader-side parser: CODE/DATA/BSS hunks + RELOC32.
Skips HUNK_DEBUG (0x3f1) and HUNK_SYMBOL (0x3f0)."""
import struct
def parse(path):
    b=open(path,'rb').read(); p=0
    def u32():
        nonlocal p; v=struct.unpack_from('>I',b,p)[0]; p+=4; return v
    assert u32()==0x3f3
    while True:
        n=u32()
        if n==0: break
        p+=n*4
    tsize=u32(); first=u32(); last=u32()
    sizes=[u32()&0x3fffffff for _ in range(last-first+1)]
    hunks=[]; cur=None
    while p<len(b):
        t=u32()&0x3fffffff
        if t in (0x3e9,0x3ea):
            n=u32(); cur={'type':t,'off':p,'data':b[p:p+n*4],'relocs':{}}; p+=n*4; hunks.append(cur)
        elif t==0x3eb:
            n=u32(); cur={'type':t,'off':p,'data':b'','relocs':{}}; hunks.append(cur)
        elif t==0x3ec:
            while True:
                n=u32()
                if n==0: break
                h=u32()
                cur['relocs'].setdefault(h,[]).extend(u32() for _ in range(n))
        elif t==0x3f0:
            while True:
                n=u32()
                if n==0: break
                p+=n*4+4
        elif t==0x3f1:
            n=u32(); p+=n*4
        elif t==0x3f2: pass
        else: raise Exception(hex(t))
    for h,s in zip(hunks,sizes): h['size']=s*4
    return hunks
if __name__=='__main__':
    import sys
    for h in parse(sys.argv[1]):
        print(hex(h['type']),hex(h['off']),len(h['data']),h['size'],{k:len(v) for k,v in h['relocs'].items()})

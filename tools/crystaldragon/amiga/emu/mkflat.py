import struct,sys,json
d=open(sys.argv[1],'rb').read()
p=0
def u(): 
    global p; v=struct.unpack('>I',d[p:p+4])[0]; p+=4; return v
assert u()==0x3f3; assert u()==0
n=u(); f=u(); l=u(); sizes=[u()&0x3fffffff for _ in range(l-f+1)]
BASE=0x10000
bases=[];b=BASE
for s in sizes: bases.append(b); b+=s*4; b=(b+7)&~7
img=bytearray(b-BASE)
h=-1; relocs=[]
while p<len(d):
    t=u()&0x3fffffff
    if t in (0x3e9,0x3ea):
        h+=1; n=u(); img[bases[h]-BASE:bases[h]-BASE+n*4]=d[p:p+n*4]; print('hunk',h,hex(t),'fileoff',hex(p),'len',n*4); p+=n*4
    elif t==0x3eb: h+=1; u()
    elif t==0x3ec:
        while True:
            c=u()
            if c==0: break
            th=u()
            for _ in range(c): relocs.append((h,u(),th))
    elif t==0x3f2: pass
    else: print('tag',hex(t)); break
for h,o,th in relocs:
    a=bases[h]-BASE+o; v=struct.unpack('>I',img[a:a+4])[0]+bases[th]; img[a:a+4]=struct.pack('>I',v)
open(sys.argv[2],'wb').write(img)
print('relocs',len(relocs),[hex(x) for x in bases])

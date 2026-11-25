import sys, struct, collections
from emu import load_exe, jt_target
X = load_exe()
blobs = {'root': X['root_code']}; blobs.update({str(k): v for k, v in X['ov'].items()})
want = sys.argv[1]
for n, b in blobs.items():
    for i in range(0, len(b) - 3, 2):
        if b[i:i+2] in (b'\x4e\xac', b'\x4e\xec'):
            disp = struct.unpack_from('>h', b, i+2)[0]
            t = jt_target(X, disp)
            if t == want: print(n, hex(i))

#!/usr/bin/env python3
"""Locate the 22 monster stat tables of the DOS port (Mon*.dat, 90 entries each) inside the Amiga executable's DATA hunk.
Result (all 22 byte-exact, big-endian words/longs): see docs/mm3/amiga/game-rules.md section 3.  Needs the retail
executable (data/mm3/amiga/Might&MagicIII) and the published DOS tables (public/assets/mm3/dosvga/files/Mon*.dat)."""
import glob, os, struct, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from emu import EXE, REPO
exe = open(EXE, 'rb').read()
DATA0 = 0x15b14 + 8      # file offset of the DATA hunk payload
out = {}
for f in sorted(glob.glob(os.path.join(REPO, 'public/assets/mm3/dosvga/files/Mon*.dat'))):
    d = open(f, 'rb').read(); n = len(d)
    pat = struct.pack('>90H', *struct.unpack('<90H', d)) if n == 180 else struct.pack('>90I', *struct.unpack('<90I', d)) if n == 360 else d
    i = exe.find(pat)
    out[os.path.basename(f)[3:-4]] = {'width': n // 90, 'a4disp': (i - DATA0 - 0x7ffe) if i >= 0 else None, 'dataOff': (i - DATA0) if i >= 0 else None}
print(json.dumps(out, indent=1))
print(sum(1 for v in out.values() if v['a4disp'] is not None), 'of', len(out), 'tables found byte-exact', file=sys.stderr)

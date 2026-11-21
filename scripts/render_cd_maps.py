#!/usr/bin/env python3
"""Quick-look PNGs of every Crystal Dragon level region -> build/cache/crystaldragon/maps/."""
import os, sys, glob, struct
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from cdlib.level import regions

ROOT = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(ROOT, 'build', 'cache', 'crystaldragon')
OUT = os.path.join(CACHE, 'maps')
os.makedirs(OUT, exist_ok=True)
COL = {0: (20, 20, 30), 1: (200, 200, 190), 2: (80, 160, 220), 3: (220, 160, 60), 4: (160, 90, 200),
       5: (90, 60, 40), 6: (60, 200, 90), 7: (230, 60, 60)}
S = 8
for f in sorted(glob.glob(os.path.join(CACHE, 'level*.bin'))):
    d = open(f, 'rb').read()
    name = os.path.basename(f)[:-4]
    rs = regions(d)
    pad = 2
    W = sum(r.w * S + pad for r in rs); H = max(r.h * S for r in rs)
    im = Image.new('RGB', (W, H), (0, 0, 0))
    px = im.load(); x0 = 0
    for r in rs:
        for y in range(r.h):
            for x in range(r.w):
                w0 = r.word0(x, y)
                c = COL[w0 & 7]
                if w0 & 0x80:
                    c = tuple(min(255, v + 40) for v in c)
                for dy in range(S - 1):
                    for dx in range(S - 1):
                        px[x0 + x * S + dx, y * S + dy] = c
        x0 += r.w * S + pad
    im.save(os.path.join(OUT, name + '.png'))
    print(name, [(r.id, r.w, r.h) for r in rs])

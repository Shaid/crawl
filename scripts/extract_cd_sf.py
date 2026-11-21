#!/usr/bin/env python3
"""Decode every Crystal Dragon SF file to build/cache/crystaldragon/<name>.bin."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from cdlib import unsf, iter_data_files, level_of_id

ROOT = os.path.join(os.path.dirname(__file__), '..')
DATA = os.path.join(ROOT, 'data', 'crystaldragon', 'amiga', 'data')
OUT = os.path.join(ROOT, 'build', 'cache', 'crystaldragon')
os.makedirs(OUT, exist_ok=True)
n = 0
for fid, name, p in iter_data_files(DATA):
    d = open(p, 'rb').read()
    if d[:2] != b'SF':
        continue
    out, left = unsf(d)
    lv = level_of_id(fid)
    fn = ('level%02d_%s.bin' % (lv, name)) if lv is not None and len(out) == 0xB4AE else name + '.bin'
    open(os.path.join(OUT, fn), 'wb').write(out)
    n += 1
    print(name, len(out), fn)
print(n, 'files')

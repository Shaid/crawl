#!/usr/bin/env python3
"""MM3 rules vector generators, pass 6: party skill check OV4+0x102B6, ...  Same recorder/format as rules.py .. rules5.py.
Usage: rules6.py UNIT OUT.json [--n N] [--seed S]   |   rules6.py subset IN OUT.gz --n N"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu, A4V, CODE_BASE, OV_BASE, DATA_BASE
from harness import Rec
import rules as B
from rules import g, sb, sw, sl, R, CH, fill_char, SEED
from rules3 import install_ui, quiet, OV4, OV8
from rules4 import keepwrap

# ---------------------------------------------------------------- party skill check OV4+0x102B6(skill)
F_SKILL = OV4(0x102B6)
def gen_skill(n, rnd):
    e = Emu(); Rc = Rec(e); out = []
    for i in range(n):
        k = rnd.choice(list(range(18)) * 3 + [rnd.randint(18, 40), rnd.getrandbits(13)]) if i >= 36 else i % 18
        def setup(e):
            cnt = rnd.choice([0, 1, 2, 3, 4, 5, 6, 6, 7, 8, rnd.randint(0, 8)])
            sb(e, -0x1672, cnt)
            p = rnd.choice([0.0, 0.2, 0.5, 0.8, 1.0, 1.0])
            for m in range(8):
                for s in range(0x27, 0x27 + 0x12 + 4):
                    e.w8(CH + 0x130 * m + s, (rnd.randint(1, 255) if rnd.random() < p else 0))
        out.append({'args': [k], **Rc.run(F_SKILL, (k,), setup)})
    return out
B.UNITS['skillcheck'] = gen_skill
keepwrap('skillcheck', lambda v: (v['args'][0] if v['args'][0] < 18 else 99, v['ret']))

if __name__ == '__main__': B.main()

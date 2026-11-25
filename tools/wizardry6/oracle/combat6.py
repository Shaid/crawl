"""Wizardry 6 (Amiga) pass-7 oracle: chest trap effects and the other thief/world routines not harnessed before,
run as the game's own code under Unicorn (same footprint method as combat5.py).

Makers:
  trap     LAB_1C0D(trap, who) (CODE+0x4ba56): the 15 chest trap effects, with the real damage / status / condition helpers
  dmg      LAB_1BFC(member, dice, sides) (CODE+0x4b760): damage to one member
  status   LAB_1C02(member, msg, resistIdx, counterIdx, p16, p18, p20) (CODE+0x4b88a): status counter application
  cond     LAB_1BF8(member, msg, resistIdx, kind) (CODE+0x4b66a): instant condition (incl. death) with a resist roll
  pick     LAB_1C31(chest) (CODE+0x4c2f0): which trap a chest carries
Presentation (messages, portrait redraw, delays, window calls) is stubbed and logged (name, first stack bytes).

Usage: combat6.py <maker> OUT.json [--n N] [--seed S]
"""
import json, os, struct, sys
import random as pyrandom
sys.path.insert(0, os.path.dirname(__file__))
import combat as C
C.KEEP_JT.update({-32124, -32478, -32484, -32472})
from combat import *            # noqa: F401,F403
from combat3 import pack, w8, w16, label_offsets   # noqa: F401
from combat4 import run_mid, c_off, argv           # noqa: F401
import emu as E

MAKERS = {}
REC = -17922            # party record 0 relative to A4, 0x1b0 each


def rbytes(rng, n, hi=255): return bytes(rng.randrange(hi + 1) for _ in range(n))


def stub_ui(c, logs=True):
    """Presentation callees of the trap code: recorded no-ops."""
    for nm, lg in (('LAB_1BEE', 2), ('LAB_1B9A', 2), ('LAB_1B62', 2), ('LAB_1BE6', 6)):
        c._stub(c_off(nm), nm, log=lg if logs else False)
    for d, lg in ((-32676, 2), (-32634, 2), (-32736, 6), (-32628, 4), (-32466, 0), (-32148, False)):
        c._stub(c.jt[d], 'jt%d' % d, log=lg)


def party_world(c, rng, n=None):
    """Random party records (the fields the trap code touches get structured values) plus level and party size."""
    A4 = c.A4
    n = n or rng.randrange(1, 7)
    writes = []
    for i in range(6):
        rec = bytearray(rbytes(rng, 0x1b0, 255) if rng.random() < .3 else rbytes(rng, 0x1b0, 40))
        mx = rng.randrange(1, 200)
        hp = rng.choice([mx, rng.randrange(-5, mx + 1), 1, 0, rng.randrange(1, 12)])
        rec[24:26] = struct.pack('>h', hp); rec[26:28] = struct.pack('>h', mx)
        rec[28:30] = struct.pack('>h', rng.randrange(-3, 60)); rec[30:32] = struct.pack('>h', rng.randrange(0, 60))
        rec[417] = rng.choice([0, 0, 0, 0, 1, 2, 3, 4, 5, 8])
        for k in (338, 340, 349, 307):
            rec[k] = rng.choice([0, 5, 20, 50, 90, 100, 200, rng.randrange(256)])
        for k in range(290, 300): rec[k] = rng.choice([0, 0, 1, 7, 100, 200, 240, 250, 255])
        rec[420] = rng.choice([0, 0, 3, 100]); rec[414] = rng.randrange(0, 6)
        for k in (301, 302, 303, 304, 305): rec[k] = rng.choice([0, 3, 4, 9, 18, 100])
        writes.append((A4 + REC + i * 0x1b0, bytes(rec)))
    writes.append((A4 - 15306, struct.pack('>h', n)))
    writes.append((A4 - 18340, struct.pack('>h', rng.choice([1, 2, 5, 8, 13, rng.randrange(1, 14)]))))
    writes.append((A4 - 18604, struct.pack('>H', rng.choice([5, 8, 0x12]))))
    writes.append((A4 - 18490, struct.pack('>I', 0x300000)))
    for a in (-3124, -3122, -3120, -3118, -3116, -3236, -3128):
        writes.append((A4 + a, struct.pack('>h', rng.choice([0, 1, 5, 77, -1]))))
    return writes, n


def make_trap_vectors(n, seed, maker='trap'):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    A4 = c.A4
    while len(out) < n:
        writes, np_ = party_world(c, rng)
        c.apply(writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        who = rng.randrange(0, 6)
        if maker == 'trap':
            trap = rng.choice(list(range(16)) * 3 + [16, 17, 40, 0xffff])
            if trap == 12: c.apply([(A4 + REC + 417, b'\0')])      # trap 12 draws members until one is alive
            off, args = c_off('LAB_1C0D'), [trap, who]
        elif maker == 'dmg':
            cnt, sides = rng.randrange(0, 20), rng.choice([0, 1, 6, 8, 10])
            off, args = c_off('LAB_1BFC'), [who, cnt, sides]
            trap = None
        elif maker == 'status':
            ri = rng.choice([0, 10, 11, 12]); ci = rng.randrange(0, 10)
            p16, p18, p20 = rng.choice([10, 0, 5]), rng.choice([10, 0, 7]), rng.choice([0x32, 0xff, 0, 100, 0x40])
            off, args = c_off('LAB_1C02'), [who, 0x1485, ri, ci, p16, p18, p20]
            trap = None
        elif maker == 'cond':
            ri = rng.choice([0, 11, 12]); kind = rng.choice([1, 2, 3, 4])
            off, args = c_off('LAB_1BF8'), [who, 0x148c, ri, kind]
            trap = None
        try:
            res = c.run_call(off, args, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'args': args, 'np': np_}))
    return out


for k in ('trap', 'dmg', 'status', 'cond'):
    MAKERS[k] = (lambda k: lambda n, s: make_trap_vectors(n, s, k))(k)


PICK = 'LAB_1C31'


def make_pick_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    A4 = c.A4
    buf = c.alloc(64)
    while len(out) < n:
        chest = bytearray(rbytes(rng, 64, 255))
        mode = rng.random()
        bits = rng.choice([0xffff, rng.randrange(1 << 16), 1 << rng.randrange(16), 0x8000, 0, 0x7ffe])
        chest[36:38] = struct.pack('<H', bits)       # bit array: bit k at byte k>>3, mask 1<<(k&7)
        c.apply([(buf, bytes(chest)), (A4 - 3236, struct.pack('>h', rng.choice([0, 3, 9])))])
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(c_off(PICK), [(buf, 4)], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'chest': buf}))
    return out


MAKERS['pick'] = make_pick_vectors


if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

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
C.KEEP_JT.update({-32124, -32478, -32484, -32472, -32142, -32412})
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


def make_inspect_vectors(n, seed):
    """LAB_1C4B(window, who) (CODE+0x4c5e8): the thief's trap inspection: chance and attempts from level, class and SKULDUGGERY, then the
    letter-reveal game LAB_1C36 on a synthetic trap name (-3214), the guessed letters (-3194) and their flags (-3174)."""
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    c._stub(c.jt[-32562], 'jt-32562', log=8); c._stub(c.jt[-32550], 'jt-32550', log=4)
    A4 = c.A4
    while len(out) < n:
        writes, np_ = party_world(c, rng)
        who = rng.randrange(0, 6)
        rec = bytearray(rbytes(rng, 0x1b0, 40))
        rec[36:38] = struct.pack('>h', rng.choice([rng.randrange(0, 40), rng.randrange(-5, 3), 30, 31]))
        rec[415] = rng.choice([3, 3, 4, 6, 13, rng.randrange(14)])
        rec[323] = rng.choice([0, 9, 10, 55, 99, 100, rng.randrange(256)])
        writes.append((A4 + REC + who * 0x1b0, bytes(rec)))
        name = bytes(rng.choice(b'ABCDEFGHIJKLMNOPQRSTUVWXYZ ') for _ in range(rng.randrange(0, 14))) + b'\0'
        nk = rng.choice([0, 0, 1, 3, 8, 16, 17, 18])
        letters = bytes(rng.choice(b'ABCDEFGHIJKLMNOPQRSTUVWXYZ*') for _ in range(18))
        flags = b''.join(struct.pack('>h', rng.choice([0, 0, 1])) for _ in range(10))
        writes += [(A4 - 3214, name + bytes(20 - len(name)) if len(name) < 20 else name[:20]), (A4 - 3194, letters[:20] + bytes(2)),
                   (A4 - 3174, flags + b''.join(struct.pack('>h', rng.choice([0, 1])) for _ in range(10))),
                   (A4 - 3134, struct.pack('>h', nk)), (A4 - 3236, struct.pack('>h', rng.choice([0, 3, 7]))),
                   (A4 - 18340, struct.pack('>h', rng.choice([0, 1, 3, 5, 8, 12, 13])))]
        c.apply(writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        win = 0x300000
        try:
            res = c.run_call(c_off('LAB_1C4B'), [(win, 4), who], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'who': who, 'win': win}))
    return out


MAKERS['inspect'] = make_inspect_vectors


def make_canact_vectors(n, seed):
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    A4 = c.A4
    while len(out) < n:
        writes, np_ = party_world(c, rng)
        who = rng.randrange(0, 6)
        rec = bytearray(rbytes(rng, 0x1b0, 3))
        rec[417] = rng.choice([0, 0, 0, 1, 3]); rec[292] = rng.choice([0, 0, 0, 1, 5]); rec[293] = rng.choice([0, 0, 0, 2])
        writes.append((A4 + REC + who * 0x1b0, bytes(rec)))
        c.apply(writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(c_off('LAB_1D56'), [who], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'who': who, 'ret': res['ret']}))
    return out


MAKERS['canact'] = make_canact_vectors


class Scripted:
    """Return values for stubbed routines that depend on the call count: name -> list consumed one per call, then its last."""
    def __init__(self, seq): self.seq = {k: list(v) for k, v in seq.items()}; self.n = {}
    def get(self, nm, default=0):
        if nm not in self.seq: return default
        i = self.n.get(nm, 0); self.n[nm] = i + 1
        q = self.seq[nm]
        return q[i] if i < len(q) else q[-1]


def make_picklock_vectors(n, seed):
    """LAB_06F9(who, entity) (CODE+0xf63a): the tumbler lock game. The key-poll stubs end it after a scripted number of rounds."""
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    for nm in ('LAB_06DC', 'LAB_0784'): c._stub(c_off(nm), nm, log=False)
    for d in (-32538, -32532, -32604, -32622, -32748, -32442, -32688, -32646, -32544, -32544):
        c._stub(c.jt[d], 'jt%d' % d, log=False)
    A4 = c.A4
    B = c.alloc(2048)
    while len(out) < n:
        writes, np_ = party_world(c, rng)
        who = rng.randrange(0, 6)
        rec = bytearray(rbytes(rng, 0x1b0, 40))
        rec[36:38] = struct.pack('>h', rng.randrange(1, 40))
        rec[415] = rng.choice([3, 6, 13, 0, 4, rng.randrange(14)])
        rec[323] = rng.choice([0, 20, 60, 95, 99, 100, rng.randrange(256)])
        rec[309] = rng.choice([0, 50, 99, 100]); rec[322 - 0] = rng.randrange(256)
        writes.append((A4 + REC + who * 0x1b0, bytes(rec)))
        idx = rng.randrange(0, 96)
        blk = bytearray(rbytes(rng, 1800, 255))
        word = rng.randrange(1 << 16)
        face = rng.randrange(0, 4)
        if rng.random() < .6: word = (word & ~(3 << (2 * face))) | (rng.choice([0, 1, 2, 2, 3]) << (2 * face))
        blk[576 + 2 * idx:578 + 2 * idx] = struct.pack('>H', word)
        writes += [(B, bytes(blk)), (A4 - 18458, struct.pack('>I', B)), (A4 - 18328, struct.pack('>h', face)),
                   (A4 - 18340, struct.pack('>h', rng.randrange(1, 14))),
                   (A4 - 18338, struct.pack('>h', rng.randrange(0, 40))), (A4 - 18336, struct.pack('>h', rng.randrange(0, 40))),
                   (A4 - 10916, b''.join(struct.pack('>h', rng.choice([0, 0, 0, 1, 3, 100, 40])) for _ in range(8))),
                   (A4 - 18146 + 2 * face, struct.pack('>h', rng.randrange(1, 9)))]
        c.apply(writes)
        rounds = rng.randrange(1, 6)
        mode = rng.choice(['key', 'timer'])
        seq = {'jt-32538': [0] * (rounds - 1) + [1] if mode == 'key' else [0], 'jt-32532': [13],
               'jt-32604': [0] * (rounds - 1) + [1] if mode == 'timer' else [0] * 1000}
        c.retvals = Scripted(seq)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        try:
            res = c.run_call(c_off('LAB_06F9'), [who, idx], seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        finally:
            c.retvals = {}
        out.append(pack(c, res, {'seed': seed3, 'who': who, 'idx': idx, 'rounds': rounds, 'mode': mode, 'ret': res['ret']}))
    return out


MAKERS['picklock'] = make_picklock_vectors


def make_train_vectors(n, seed):
    """LAB_0584(who, skill, amount) (CODE+0xb348): thief-skill training."""
    rng = pyrandom.Random(seed); c = Combat(); out = []
    stub_ui(c)
    A4 = c.A4
    while len(out) < n:
        writes, np_ = party_world(c, rng)
        who = rng.randrange(0, 6)
        rec = bytearray(rbytes(rng, 0x1b0, 40))
        rec[36:38] = struct.pack('>h', rng.randrange(1, 30))
        for k in range(308, 338): rec[k] = rng.choice([0, 1, 20, 98, 99, 100, 120, rng.randrange(256)])
        writes.append((A4 + REC + who * 0x1b0, bytes(rec)))
        c.apply(writes)
        seed3 = [rng.randrange(1, 30000) for _ in range(3)]
        c.apply([(RNG_ADDR, bytes(6))])
        args = [who, rng.choice([15, 15, 14, 16, rng.randrange(30)]), rng.choice([1, 4, 2, 0])]
        try:
            res = c.run_call(c_off('LAB_0584'), args, seed3)
        except RuntimeError as e:
            print('skip', str(e)[-90:], file=sys.stderr); continue
        out.append(pack(c, res, {'seed': seed3, 'args': args}))
    return out


MAKERS['train'] = make_train_vectors


if __name__ == '__main__':
    kind, outp = sys.argv[1], sys.argv[2]
    V = MAKERS[kind](argv('--n', 200), argv('--seed', 1))
    json.dump(V, open(outp, 'w'), separators=(',', ':'))
    print(len(V), 'vectors')

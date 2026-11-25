"""Shared helpers for the MM1 rules vector generators (units_*.py register generators in U)."""
import json, os, random, sys, gzip
sys.path.insert(0, os.path.dirname(__file__))
from emu import Emu
from harness import Rec

# ---- DS offsets (MM.RSM type-3 symbols) ----
RNG_N, RNG_R, RNG_STATE, RNG_MASK, RNG_RETRY = 0x3bc8, 0x3bc9, 0x3bce, 0x3bd2, 0x3bd3
CHARP = 0x3bd6                  # word: pointer to the current character record
ROSTER = 0x3cfa
CH = 0x7f                       # character record size
def rec_addr(i): return ROSTER + CH * i

def rnd_state(e, rnd):
    e.wbytes(RNG_STATE, [rnd.getrandbits(8) for _ in range(4)])
    e.wb(RNG_RETRY, 0 if rnd.random() < 0.002 else rnd.choice([4, 4, 4, 4, 1, 2, 3, 8, rnd.randint(1, 255)]))

def mkchar(e, rnd, a, cls=None):
    """plausible 127-byte character record at DS offset a"""
    b = [rnd.getrandbits(8) for _ in range(CH)]
    e.wbytes(a, b)
    cl = cls if cls is not None else rnd.randint(1, 6)
    e.wb(a + 0x10, rnd.randint(1, 2)); e.wb(a + 0x11, rnd.randint(1, 3)); e.wb(a + 0x12, rnd.randint(1, 3))
    e.wb(a + 0x13, rnd.randint(1, 5)); e.wb(a + 0x14, cl)
    for off in range(0x15, 0x23, 2):                    # 7 attribute pairs (base, current)
        base = rnd.choice([rnd.randint(3, 20), rnd.randint(1, 25), rnd.randint(8, 19), rnd.randint(1, 45)])
        e.wb(a + off, base); e.wb(a + off + 1, max(0, base + rnd.choice([0, 0, 0, -1, 1, 2, -3])) & 255)
    lv = rnd.choice([1, 2, 3, 5, 8, 10, 12, 15, 20, 30, rnd.randint(1, 60)])
    e.wb(a + 0x23, lv); e.wb(a + 0x24, (lv + rnd.choice([0, 0, 0, 1, -1])) & 255)
    e.wb(a + 0x25, rnd.choice([18, 20, 25, 40, 100, 215, 219, 220, 230, rnd.randint(0, 255)]))
    e.wbytes(a + 0x27, rnd.getrandbits(32).to_bytes(4, 'little') if rnd.random() < 0.4 else rnd.getrandbits(20).to_bytes(4, 'little'))
    for off in (0x2b, 0x2d, 0x33, 0x35, 0x37):
        e.ww(a + off, rnd.choice([0, rnd.randint(0, 20), rnd.randint(0, 300), rnd.getrandbits(16)]))
    e.wb(a + 0x2f, rnd.randint(0, 7)); e.wb(a + 0x30, rnd.randint(0, 7))
    e.wbytes(a + 0x39, [rnd.getrandbits(8) if rnd.random() < 0.6 else 0, rnd.getrandbits(8) if rnd.random() < 0.5 else 0, rnd.choice([0, 0, 0, 1, 255])])
    e.wb(a + 0x3c, rnd.choice([0, 0, rnd.randint(0, 20)])); e.wb(a + 0x3d, rnd.randint(0, 40))
    e.wb(a + 0x3f, rnd.choice([0, 0, 0, 0x40, 0x80, 0xc0, 0x01, 0x20, 0x23, rnd.getrandbits(8)]))
    return a

U = {}
def unit(name):
    def deco(f): U[name] = f; return f
    return deco

PTEXT = ('ptext', 0x4009, None, lambda e: [e.rw(0x3bd4), e.rb(0x3bdc), e.rb(0x3bdd)])
def uistub(name, off): return (name, off, None, None)

def run_n(n, rnd, mk, ip, stub=(), stop=None, stops=()):
    """generic: mk(e, rnd) -> (args, regs) performs state setup; runs ip..stop"""
    e = Emu(); Rc = Rec(e); out = []
    for st in stub: e.stub(st[1], st[0], st[2] if len(st) > 2 else None, st[3] if len(st) > 3 else None)
    for _ in range(n):
        box = {}
        def setup(e):
            rnd_state(e, rnd)
            box['args'], box['regs'] = mk(e, rnd)
        v = Rc.run(ip, None, setup, stop=stop, stops=stops, regs_fn=lambda: box['regs'])
        out.append({'args': box['args'], **v})
    return out

def pickchar(e, r, **kw):
    a = mkchar(e, r, rec_addr(r.randint(0, 17)), **kw); e.ww(CHARP, a); return a

def main(U):
    a = sys.argv[1:]
    if a[0] == 'subset':
        data = json.load(open(a[1])); n = int(a[a.index('--n') + 1]) if '--n' in a else 40
        r = random.Random(7)
        keep, seen = [], set()
        for d in data:      # keep one vector per distinct (stub-call sequence, stop address) signature
            sig = (tuple(c[0] for c in d.get('calls', [])), d.get('out', {}).get('stop'), len(d.get('fin', {})) > 0)
            if d.get('keep') or sig not in seen: seen.add(sig); keep.append(d)
        rest = [d for d in data if d not in keep]
        sub = keep + (rest if len(rest) <= n else r.sample(rest, n))
        raw = json.dumps(sub, separators=(',', ':')).encode()
        if a[2].endswith('.gz'): gzip.GzipFile(a[2], 'wb', mtime=0).write(raw)
        else: open(a[2], 'wb').write(raw)
        return
    unit_name, outp = a[0], a[1]
    n = int(a[a.index('--n') + 1]) if '--n' in a else 3000
    seed = int(a[a.index('--seed') + 1]) if '--seed' in a else 1
    rnd = random.Random(seed)
    res = U[unit_name](n, rnd)
    os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
    json.dump(res, open(outp, 'w'), separators=(',', ':'))
    print(unit_name, len(res), 'vectors ->', outp)

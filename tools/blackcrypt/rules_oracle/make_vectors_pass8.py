#!/usr/bin/env python3
"""Generate vectors_pass8.json.gz (pass 8). Every case runs a real routine in oracle_spell's `script` mode on a synthetic A4 image and stores the oracle's COMPLETE A4 diff, the RNG state and the hooked-call log.
Families:
  exec   the ACTION EXECUTOR `+0xC4F6` (action record id at A4+0x836 + 8 id: [0] opcode, [2] x, [3] y, [6] value) and its opcode switch `+0xCE9C`: one family per opcode 0x00-0x24 (35 handled + the
         unhandled 0x1B and >= 0x24), random target squares (structures of the wanted type, monsters with carried chains, items, party on the square), UI calls stubbed, the helpers the opcodes call
         (monster-crush `+0xC41A`, pit drop `+0xC2DA`, hand-item drop `+0xC052`, party fire `+0x4600`, hold `+0x58FA`, spawn `+0xBAA6`, DamageCharacter) run for real; the activation scan `+0xB614`,
         the stairs follow-up `+0x16C62`, the equipment-effect recompute `+0x18088` and the palette setter `+0x26900` are hooked and logged.
Usage: make_vectors_pass8.py <s1.bin> <s2.bin> [out] [n_per_opcode]. Deterministic. Evidence: harness. See docs/blackcrypt/amiga/game-rules.md section 15."""
import gzip, json, random, sys, pathlib
here = pathlib.Path(__file__).resolve().parent
src = (here / 'make_vectors_spells9.py').read_text().split('\nPLAN = [')[0]
src = src.replace("rnd = random.Random(0x59A11E5)", "rnd = random.Random(0x8A55508)")
exec(compile(src, 'spells9-prefix', 'exec'))
p7 = (here / 'make_vectors_pass7.py').read_text()
# reuse the pass-7 helpers (free_list, events, run2, hook strings) without running its generation loop
pre = p7.split('\ncases = []; lines = []')[0].split("import gzip, json, random, sys, pathlib\n", 1)[1]
pre = pre.replace("here = pathlib.Path(__file__).resolve().parent\nsrc = (here / 'make_vectors_spells9.py').read_text().split('\\nPLAN = [')[0]\nsrc = src.replace(\"rnd = random.Random(0x59A11E5)\", \"rnd = random.Random(0x7A55507)\")\nexec(compile(src, 'spells9-prefix', 'exec'))\n", '')
exec(compile(pre, 'pass7-prefix', 'exec'))
N = int(sys.argv[4]) if len(sys.argv) > 4 else 20
KEEP_EXEC = KEEP_DEATH + ' K 0x74 K 0x126D2 K 0x11992 K 0x4600 K 0x17686 K 0xBAA6 K 0x8458 K 0xC4F6 K 0xC41A K 0xC2DA K 0xC052 K 0xC236 K 0xC288 K 0x58FA'
HK = ' '.join('H %s 0' % h for h in ['0x16C62', '0x18088', '0x26900', '0xB614', '0x8388', '0x17D2A', '0x2D46', '0x4AE', '0x82A'])
KEEP_LOG8 = {0x16C62, 0x18088, 0x26900, 0xB614, 0x17D2A}

def world(w, op, x, y, v, rid):
    """common part: tick, party, characters (DamageCharacter fields), free list, event queue, the action record"""
    T = rnd.randrange(1, 5000); w.l(0x1750, T); w.w(0x174A, rnd.choice([0, 1, 1, 2, 3, 4, 10]))
    px, py = rnd.randrange(3, 40), rnd.randrange(3, 40)
    if rnd.random() < 0.3: px, py = x, y
    w.w(0x1742, px); w.w(0x1740, py); w.w(0x1744, rnd.randrange(4)); w.w(0x1756, rnd.choice([0, 0, 2])); w.w(0x1E80, rnd.randrange(5)); w.w(0x1E82, rnd.randrange(5)); w.w(0x1E62, rnd.randrange(12))
    w.b(0x1748, rnd.choice([0, 1])); w.b(0x174C, rnd.choice([0, 1])); w.b(0x174D, rnd.choice([0, 1])); w.b(0x1E8F, rnd.choice([0, 1, 2, 3])); w.b(0x1E91, rnd.choice([0, 1, 2, 5]))
    w.w(0x1A22, rnd.choice([0, 0, 0, 90]))
    form = list(range(4)); rnd.shuffle(form)
    for i in range(4): w.w(0x1E74 + 2 * i, form[i]); w.w(0x19F8 + 2 * i, rnd.randrange(4))
    ch = rnd.randrange(4); w.w(0x1A24, rnd.randrange(5)); w.w(0x1A14, rnd.randrange(4)); w.w(0x1A16, rnd.randrange(4)); w.b(0x1A26, rnd.choice([0, 0, 3]))
    w.w(0x1E2A, rnd.randrange(5)); w.w(0x1E2C, rnd.randrange(5)); w.w(0x1E88, 0)
    nid = [100]
    for i in range(4):
        c = CH(i)
        w.w(c + 0x4E, rnd.choice([0, 1, 2, 5, 20, 60, 200, -2])); w.w(c + 0x50, 250); w.b(c + 0x6E, 20); w.b(c + 0x68, rnd.randrange(3, 25)); w.b(c + 0x84, rnd.randrange(3)); w.b(c + 0x85, rnd.randrange(3)); w.b(c + 0x8C, rnd.choice([0] * 8 + [3]))
        w.w(c + 0x52, 3000); w.w(c + 0x54, 3000); w.w(c + 0x56, 5000); w.l(c + 0xA4, rnd.choice([0, 4000, 9000]))
        for r in range(3):
            for k in range(6):
                if rnd.random() < (0.5 if (r == 0 and k in (2, 3)) else 0.12) and nid[0] < 140:
                    w.obj(nid[0], w0=rnd.choice([0x12, 0x13]), b4=rnd.randrange(256), b5=0x15, w8=rnd.randrange(100), nx=0); w.w(c + 0x16 + 12 * r + 2 * k, nid[0]); nid[0] += 1
        for k in range(5):
            if rnd.random() < 0.3 and nid[0] < 140: w.obj(nid[0], w0=0x12, b5=0x15, w8=rnd.randrange(100), nx=0); w.w(c + 0x3A + 2 * k, nid[0]); nid[0] += 1
    if w.p and True:
        pass
    if rnd.random() < 0.5: w.w(0x1A22, nid[0]); w.obj(nid[0], w0=0x12, b5=0x15, w8=5, nx=0)
    free_list(w, 150, 60)
    events(w, [1, 20], chars=(0, 1, 2, 3))
    r = 0x836 + 8 * rid
    for i in range(1, 16):
        q = 0x836 + 8 * i
        for o_ in range(8): w.b(q + o_, rnd.randrange(256))
    w.b(r, op); w.b(r + 2, x); w.b(r + 3, y); w.b(r + 6, v)
    return px, py

STRUCT = {0x03: 0x17, 0x04: 0x17, 0x05: 0x17, 0x06: 0x14, 0x07: 0x14, 0x08: 0x14, 0x09: 0x12, 0x0A: 0x12, 0x0B: 0x12, 0x18: 0x11, 0x19: 0x11, 0x1A: 0x11, 0x20: 0x10, 0x21: 0x10, 0x22: 0x10}
def gen_exec(op):
    w = W(); x, y = rnd.randrange(3, 40), rnd.randrange(3, 40)
    v = rnd.choice([0, 1, 2, 3, 5, 0x10, 0x11, 0x12, 0x14, 0x17, 0x1E, 4, 7])
    if op in (0xF, 0x10, 0x11): v = rnd.choice([0, 1, 2, 3, 4, 5, 7, 12, 17, 18, 19, 20, 31, 32, 40])
    if op in (0x1C, 0x1D): v = rnd.choice([0, 1, 2, 3, 5, 9, 20])
    if op == 0x12: v = rnd.choice([1, 2, 3, 4])      # template column
    if op == 0x13: v = rnd.choice([0, 1, 2, 5, 255, 3])
    if op in (0x15, 0x1E, 0x1F): v = rnd.choice([0, 0, 1, 2, 3, 5, 11, 12])
    rid = rnd.randrange(1, 16)
    px, py = world(w, op, x, y, v, rid)
    typ = STRUCT.get(op, v if op in (0xC, 0xD, 0xE, 0x16, 0x17) else 0x10)
    chain = []; nid = 1
    def mon(i, carried=0):
        w.obj(i, w0=rnd.choice([0x80B3, 0x80C5, 0x80B9]), w8=rnd.choice([0, 5, 30]), w10=i + 1, nx=0); w.w(OB(i) + 0xA, carried); w.b(OB(i) + 6, rnd.choice([0, 8]))
        w.obj(i + 1, w0=0, nx=0); w.b(OB(i + 1) + 0xB, rnd.randrange(5))
    ids = []
    if rnd.random() < 0.85:
        w.obj(1, w0=1, b4=rnd.randrange(256), b5=typ, wA=rnd.choice([0, 0, 1, 2, 3, 5]), wC=rnd.randrange(64), wE=rnd.choice([0, 1, 2, 3, 0x100, 5]), w10=rnd.randrange(8), w8=rnd.randrange(8))
        w.b(OB(1) + 0xF, rnd.randrange(256)); w.b(OB(1) + 0xB, rnd.randrange(256))
        if op in (0x06, 0x07):   # pit: destination = a square in the map
            w.w(OB(1) + 0xC, rnd.randrange(3, 40)); w.w(OB(1) + 0xE, rnd.randrange(3, 40))
        chain.append(1)
    for k in range(rnd.choice([0, 0, 1, 2, 3])):
        t = rnd.random(); i = 20 + 4 * k
        if t < 0.4:
            c = 0
            if rnd.random() < 0.5:
                c = 70 + 4 * k; w.obj(c, w0=0x12, b4=0x30, b5=0x15, nx=rnd.choice([0, 71 + 4 * k])) ; w.obj(71 + 4 * k, w0=0x12, b5=0x15, nx=0)
            mon(i, c)
        else:
            w.obj(i, w0=rnd.choice([0x12, 0x13, 1, 0]), b4=rnd.choice([0x90, 0x30, 0x60, 0xC0, 0x00, 0x15, 0x47]), b5=rnd.choice([0x15, 0x10, 0x17]), wA=0, nx=0)
        chain.insert(rnd.randrange(len(chain) + 1), i)
    link(w, chain)
    w.l(CELL(x, y), (chain[0] if chain else 0) | rnd.randrange(0, 1 << 32) & 0xCF000000 if rnd.random() < 0.6 else (chain[0] if chain else 0))
    if op in (0x12,):
        # template monsters at map row 0, column v (cells (v, 0))
        P, S = 40, 41
        w.obj(P, w0=rnd.choice([0x80B3, 0x80C5]), w10=S, nx=0); w.b(OB(P) + 6, rnd.choice([0, 8])); w.w(OB(P) + 0xA, 0)
        w.obj(S, w0=0, nx=0)
        w.l(CELL(v, 0), P)
    return w, dict(op=op, x=x, y=y, v=v, rid=rid)
def gen_trigx():
    """TriggerActionsAt with the REAL executor behind it: a trigger structure whose record chain runs several handled opcodes on a few squares that carry structures, monsters and items"""
    w = W(); sq = [(rnd.randrange(3, 40), rnd.randrange(3, 40)) for _ in range(4)]
    tx, ty = sq[0]
    px, py = world(w, 0, 0, 0, 0, 15)
    typ = rnd.choice([0x1E, 0x1D, 0x1F, 0x14, 0x12]); gen_ = rnd.randrange(0, 3); start = rnd.choice([1, 2, 5])
    T = (w.p and 0)
    chain_ids = [start] + rnd.sample([i for i in range(1, 15) if i != start], rnd.choice([0, 1, 2, 3, 5]))
    OPSX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23]
    for i in range(1, 16):
        r = 0x836 + 8 * i; sx, sy = rnd.choice(sq[1:])
        op_ = rnd.choice(OPSX); w.b(r, op_); w.b(r + 1, gen_ + 1 if rnd.random() < 0.9 else 0); w.b(r + 2, sx); w.b(r + 3, sy); w.b(r + 4, rnd.choice([0, 1, 2, 255, 3])); w.b(r + 5, rnd.choice([0, 0, 0, 2, 5, 9])); w.b(r + 6, rnd.randrange(1, 6) if op_ == 0x12 else rnd.choice([0, 1, 2, 3, 5, 0x10, 0x11, 0x14, 0x17, 4])); w.b(r + 7, 0)
    for i_, r_ in enumerate(chain_ids): w.b(0x836 + 8 * r_ + 7, chain_ids[i_ + 1] if i_ + 1 < len(chain_ids) else rnd.choice([0, start]))
    # the trigger structure on (tx, ty); structures of the types the opcodes look up on the three other squares (+ monsters and items)
    w.obj(1, w0=1, b5=typ, wA=0, w8=rnd.choice([0, 1]), wC=0, w10=0, nx=0); w.b(OB(1) + 0xD, start); w.b(OB(1) + 0x11, gen_)
    w.l(CELL(tx, ty), 1)
    nid = 20
    for (sx, sy) in sq[1:]:
        ch = []
        for t in rnd.sample([0x17, 0x14, 0x12, 0x11, 0x10, 0x10, 0x14, 0x0F, 0x1E], rnd.choice([1, 2, 3])):
            w.obj(nid, w0=1, b4=rnd.randrange(256), b5=t, wA=rnd.choice([0, 0, 1, 2, 3]), wC=rnd.randrange(3, 40), wE=rnd.choice([0, 1, 2, 3]), w10=rnd.randrange(3, 40)); ch.append(nid); nid += 1
        if rnd.random() < 0.5:
            w.obj(nid, w0=rnd.choice([0x80B3, 0x80C5]), w8=5, w10=nid + 1, nx=0); w.w(OB(nid) + 0xA, 0); w.obj(nid + 1, w0=0, nx=0); ch.insert(rnd.randrange(len(ch) + 1), nid); nid += 2
        if rnd.random() < 0.5:
            w.obj(nid, w0=0x12, b4=rnd.choice([0x90, 0x30, 0x60, 0xC0]), b5=0x15, nx=0); ch.append(nid); nid += 1
        link(w, ch); w.l(CELL(sx, sy), ch[0] | rnd.choice([0, 0x40000000]))
    for t_ in range(1, 6):
        w.obj(40 + t_, w0=rnd.choice([0x80B3, 0x80C5]), w10=45 + t_, nx=0); w.obj(45 + t_, w0=0, nx=0)
        w.l(CELL(t_, 0), 40 + t_)
    return w, dict(fam='trigx', op=0x100, x=tx, y=ty, typ=typ)
def gen_party_square(kind):
    """glyph (+0x4662) / pit (+0x1734A) on the party square: characters with random hp / shield / levitation / dexterity, a glyph structure (type 0x10) or nothing special for the pit"""
    w = W(); px, py = world(w, 0, 0, 0, 0, 15)
    w.w(0x1742, px); w.w(0x1740, py)
    for i in range(4):
        c = CH(i)
        w.b(c + 0x8A, rnd.choice([0, 0, 0, 1])); w.b(c + 0x8B, rnd.choice([0, 0, 1])); w.b(c + 0x68, rnd.choice([3, 8, 10, 15, 16, 17, 25, 200])); w.b(c + 0x9A, rnd.randrange(250))
        w.w(c + 0x4E, rnd.choice([0, 1, 2, 5, 12, 20, 60, 200, -2]))
    chain = []
    if kind == 'glyph':
        a3 = rnd.choice([0, 1, 1, 1, 2, 3, 3, 4, 4, 4, 5, 9]); a2 = rnd.choice([0, 0, 1, 2, 3, 5, 20, 100, 500])
        w.obj(1, w0=1, b5=0x10, wA=0, wC=3, wE=a2, w10=a3, nx=0); chain.append(1)
    for k in range(rnd.choice([0, 0, 1, 2])):
        i = 20 + k
        w.obj(i, w0=rnd.choice([1, 0x12]), b4=rnd.randrange(256), b5=rnd.choice([0x15, 0x10, 0x11, 0x1E]), wA=rnd.choice([0, 1]), wC=rnd.randrange(4), nx=0); chain.insert(rnd.randrange(len(chain) + 1), i)
    link(w, chain); w.l(CELL(px, py), (chain[0] if chain else 0) | rnd.choice([0, 0, 0x40000000]))
    w.w(0x1A1A, rnd.choice([0, 7]))
    return w, dict(fam=kind, op=0x200 if kind == 'glyph' else 0x201, x=px, y=py)
DXY = [(0, 1), (1, 0), (0, -1), (-1, 0)]
def gen_door_key(kind):
    """the party's door click (+0x1110A) and the key-on-lock handler (+0x16AA8): door (type 0x11, word +0xE 0 closed / 1 open / 2 locked), lock (type 0x22: +0xC key id, +0xE keys still needed), door-trigger structure (type 0x0F), monsters in the doorway"""
    w = W(); px, py = world(w, 0, 0, 0, 0, 15)
    f = rnd.randrange(4); w.w(0x1744, f); px, py = rnd.randrange(5, 40), rnd.randrange(5, 40); w.w(0x1742, px); w.w(0x1740, py)
    fx, fy = px + DXY[f][0], py + DXY[f][1]
    w.w(0x1A24, rnd.choice([0, 1, 2, 3])); w.w(0x1A18, 1 if (kind == 'key' or rnd.random() < 0.85) else 0)
    for i in range(4): w.w(CH(i) + 0x4E, rnd.choice([5, 60])); w.w(CH(i) + 0x52, 3000); w.w(CH(i) + 0x54, 3000); w.w(CH(i) + 0x56, 5000)
    keyid = rnd.randrange(1, 30)
    chain = []
    if rnd.random() < 0.92:
        w.obj(1, w0=1, b4=rnd.randrange(256), b5=0x11, wA=0, wC=rnd.randrange(4), wE=rnd.choice([0, 0, 1, 1, 2, 3]), nx=0); chain.append(1)
    if rnd.random() < 0.5:
        w.obj(2, w0=1, b5=0x0F, wA=0, wC=rnd.choice([0, 1, 5]), w8=rnd.randrange(3), nx=0); w.b(OB(2) + 0xF, rnd.randrange(4)); w.w(OB(2) + 2, rnd.choice([0, 5])); chain.append(2)
        w.b(OB(2) + 0xD, rnd.choice([0, 3])); w.b(OB(2) + 0x11, 0)
        for i in range(1, 16):
            r = 0x836 + 8 * i; w.b(r, rnd.choice([0, 2, 4, 0xF, 0x10, 0x13])); w.b(r + 1, 1); w.b(r + 2, fx); w.b(r + 3, fy); w.b(r + 4, 255); w.b(r + 5, 0); w.b(r + 6, rnd.randrange(4)); w.b(r + 7, 0)
    if kind == 'key' or rnd.random() < 0.5:
        w.obj(3, w0=1, b5=0x22, wA=0, wC=keyid if rnd.random() < 0.8 else keyid + 1, wE=rnd.choice([0, 1, 1, 1, 2, 3]), nx=0); chain.insert(rnd.randrange(len(chain) + 1), 3)
    if rnd.random() < 0.3:
        w.obj(20, w0=rnd.choice([0x80B3, 0x80C5]), w10=21, nx=0); w.obj(21, w0=0, nx=0); w.b(OB(21) + 0xB, rnd.randrange(5)); chain.append(20)
    link(w, chain); w.l(CELL(fx, fy), (chain[0] if chain else 0) | rnd.choice([0, 0x20000000, 0x40000000]))
    w.l(CELL(px, py), rnd.choice([0, 0x20000000, 0x40000000]))
    # cursor item: a key (type 6) most of the time, else some other item
    if kind == 'key':
        cur = rnd.choice([55, 55, 55, 55, 0]); w.w(0x1A22, cur)
        if cur: w.obj(55, w0=0x12, b5=rnd.choice([6, 6, 6, 5]), wC=keyid, nx=0)
    return w, dict(fam=kind, op=0x300 if kind == 'door' else 0x301, x=px, y=py, f=f)
cases = []; lines = []
def add(w, extra, call, extra_pre=''):
    sd = ''.join('%02x' % rnd.randrange(256) for _ in range(6))
    txt = ' '.join(['S', sd, KEEP_REAL, KEEP_Q, UIH, PTRS, extra_pre] + ['%s %d %d' % (k, A4 + o, v) for k, o, v in w.p] + [call])
    cases.append(dict(seed=sd, pokes=w.p, **extra)); lines.append(txt)
OPS = list(range(0, 0x25)) + [0x30]
if __name__ == '__main__':
    for op in OPS:
        for n in range(N):
            w, ex = gen_exec(op)
            add(w, ex, 'C 0xC4F6 1 1 %d A 5 3080192' % ex['rid'], extra_pre=KEEP_EXEC + ' ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    for n in range(N * 2):
        w, ex = gen_trigx()
        add(w, ex, 'C 0xCF34 3 1 %d 2 %d 2 %d A 5 3080192' % (ex['typ'], ex['y'], ex['x']), extra_pre=KEEP_EXEC + ' K 0xCF34 ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    for n in range(N * 3):
        w, ex = gen_party_square('glyph')
        ex['d6'], ex['d7'] = rnd.randrange(0, 20), rnd.randrange(0, 300)
        add(w, ex, 'C 0x4662 0 A 5 3080192 D 6 %d D 7 %d' % (ex['d6'], ex['d7']), extra_pre=KEEP_EXEC + ' K 0x4662 ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    for n in range(N * 2):
        w, ex = gen_party_square('pit')
        add(w, ex, 'C 0x1734A 0 A 5 3080192', extra_pre=KEEP_EXEC + ' K 0x1734A ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    for n in range(N * 3):
        w, ex = gen_door_key('door')
        add(w, ex, 'C 0x1110A 0 A 5 3080192', extra_pre=KEEP_EXEC + ' K 0x1110A K 0xCF34 K 0x2B4 ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    for n in range(N * 3):
        w, ex = gen_door_key('key')
        add(w, ex, 'C 0x16AA8 0 A 5 3080192', extra_pre=KEEP_EXEC + ' K 0x16AA8 K 0x1110A K 0xCF34 K 0x2B4 ' + HK + ' ' + ' '.join(SCRIPT_PTRS))
    res = run2(lines)
    assert len(res) == len(cases)
    for c, r in zip(cases, res):
        c['out'] = dict(diff={str(k): v for k, v in sorted(r['diff'].items())}, seed=r['seed'], peeks=r['peeks'], d0=r['d0'], a3=r['a3'],
                        log=[[e[0]] + e[1:8] for e in r['log'] if e[0] in KEEP_LOG8])
    vec = dict(note='Generated by make_vectors_pass8.py from the game\'s own code; see game-rules.md section 15', cases=cases)
    gzip.open(sys.argv[3] if len(sys.argv) > 3 else str(here / 'vectors_pass8.json.gz'), 'wt', compresslevel=9).write(json.dumps(vec, separators=(',', ':')))
    print('wrote', len(cases))

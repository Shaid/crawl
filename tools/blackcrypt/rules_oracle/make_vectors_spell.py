#!/usr/bin/env python3
"""Generate vectors_spell.json: player-side spell / ray / special-attack cases produced by running the game's own
68k routines (oracle_spell, 'script' mode: pokes + hooks + one routine call + peeks). Usage: make_vectors_spell.py <s1.bin> <s2.bin>
Deterministic (fixed PRNG seed). Evidence: harness. See docs/blackcrypt/amiga/game-rules.md."""
import gzip, json, random, struct, subprocess, sys, pathlib

here = pathlib.Path(__file__).resolve().parent
S1, S2 = sys.argv[1], sys.argv[2]
ORACLE = str(here / 'oracle_spell')
A4 = 0xA8BF0 + 0x7FFE
def CH(i): return 0x1758 + 0xA8 * i          # A4-relative
def OB(u): return -0x6E7A + 0x14 * u
def CELL(x, y): return -0x37CA + (y << 8) + (x << 2)

# hooks: UI / event-list / text helpers skipped (D0 forced), their stack args logged
HOOKS = 'H 0x4876 0 H 0x4960 0 H 0x5EA 0 H 0x288B8 0 H 0x49B4 0 H 0xB25A 0 H 0x28012 0 H 0x280B6 0 H 0x288C6 0 H 0x280F6 0 H 0x280D4 0'
PICK = 0x10852  # target-pick UI (+0x908AA): forced to return the chosen party slot

def run(lines):
    out = subprocess.run([ORACLE, S1, S2, 'script'], input='\n'.join(lines) + '\n', capture_output=True, text=True, check=True).stdout
    res = []
    for l in out.split('\n'):
        if not l.startswith('script'): continue
        a, b, c, dd = l[len('script :'):].split('|')
        cs = c.split()
        res.append(dict(peeks=[int(x) for x in a.split()],
                        log=[[int(v, 16) if i == 0 else int(v) for i, v in enumerate(e.split(','))] for e in b.split()[1:]],
                        seed=cs[0], d0=int(cs[2])))
    return res

def poke(k, off, v): return '%s %d %d' % (k, A4 + off, v)
def peek(k, off): return '%s %d' % (k, A4 + off)

# ---- tracked character fields (offset, peek kind, name)
CF = [(0x4E, 'r16s', 'hp'), (0x50, 'r16s', 'maxHp'), (0x62, 'r8s', 'ac'), (0x64, 'r8', 'str'), (0x9A, 'r8', 'poison'), (0x97, 'r8', 'disease'),
      (0x52, 'r16', 'food'), (0x54, 'r16', 'water'), (0x82, 'r8', 'acCnt'), (0x78, 'r8', 'strCnt'), (0x85, 'r8', 'wizCnt'), (0x84, 'r8', 'detCnt')]
GF = [(0x1754, 'r16', 'light'), (0x1756, 'r16', 'hold'), (0x1E28, 'r16', 'compass'), (0x1E2A, 'r16', 'wizSight'), (0x1E2C, 'r16', 'detect'), (0x1E2E, 'r16', 'haste')]

def world_pokes(w):
    it = [poke('w', 0x1A14, w['active']), poke('w', 0x1744, w['facing']), poke('w', 0x1740, w['py']), poke('w', 0x1742, w['px']),
          poke('l', 0x1750, w['tick']), poke('w', 0x1754, w['light']), poke('w', 0x1756, w['hold']), poke('w', 0x1E28, w['compass']),
          poke('w', 0x1E2A, w['wizSight']), poke('w', 0x1E2C, w['detect']), poke('w', 0x1E2E, w['haste']), poke('w', 0x1E5C, w.get('b1E5C', 0))]
    for i, c in enumerate(w['chars']):
        b = CH(i)
        it += [poke('w', 0x1E74 + 2 * i, w['formation'][i]), poke('w', b, c['cls']), poke('b', b + 0x5E, c['level']), poke('b', b + 0x6A, c['b6a'] & 255),
               poke('b', b + 0x65, c['w65']), poke('b', b + 0x66, c['w66']), poke('b', b + 0x69, c.get('res', 0))]
        for off, k, n in CF:
            kk = {'r16s': 'w', 'r16': 'w', 'r8s': 'b', 'r8': 'b'}[k]
            it.append(poke(kk, b + off, c[n] & (0xFFFF if kk == 'w' else 0xFF)))
        for s in range(5): it.append(poke('b', b + 0x49 + s, c['slots'][s]))
    return it

def world_peeks(w):
    pk = []
    for i in range(4):
        for off, k, n in CF: pk.append(peek(k, CH(i) + off))
    for off, k, n in GF: pk.append(peek(k, off))
    return pk

def parse_out(w, r):
    p = r['peeks']; o = {'chars': []}; j = 0
    for i in range(4):
        c = {}
        for off, k, n in CF: c[n] = p[j]; j += 1
        o['chars'].append(c)
    for off, k, n in GF: o[n] = p[j]; j += 1
    o['seed'] = r['seed']
    o['events'] = [[e[1] >> 8, (e[2] << 16) | e[3], e[4] >> 8, e[5] >> 8, e[6] >> 8] for e in r['log'] if e[0] == 0x5EA]
    o['spent'] = any(e[0] == 0x4876 for e in r['log']); o['failed'] = any(e[0] == 0x4960 for e in r['log'])
    o['picks'] = [e[1] for e in r['log'] if e[0] == PICK]
    return o

rnd = random.Random(0x5B3117)
def seed(): return ''.join('%02x' % rnd.randrange(256) for _ in range(6))

def rand_world(sid, rich=True):
    chars = []
    for i in range(4):
        mx = rnd.randrange(10, 120); hp = rnd.choice([0, 0, rnd.randrange(1, mx + 1), mx, rnd.randrange(1, mx + 1)])
        chars.append(dict(cls=rnd.randrange(4), level=rnd.randrange(1, 25), b6a=rnd.randrange(-3, 6), w65=rnd.randrange(0, 31), w66=rnd.randrange(0, 31),
                          hp=hp, maxHp=mx, ac=rnd.randrange(0, 30), str=rnd.randrange(1, 28), poison=rnd.choice([0, 0, 1, 5]), disease=rnd.choice([0, 0, 1, 3]),
                          food=rnd.randrange(0, 5001), water=rnd.randrange(0, 5001), acCnt=rnd.randrange(0, 3), strCnt=rnd.randrange(0, 3), wizCnt=rnd.randrange(0, 3),
                          detCnt=rnd.randrange(0, 3), res=0, slots=[sid, 255, 255, 255, 255]))
    form = list(range(4)); rnd.shuffle(form)
    return dict(active=rnd.randrange(4), facing=rnd.randrange(4), px=rnd.randrange(6, 20), py=rnd.randrange(6, 20), tick=rnd.randrange(0, 100000),
                light=rnd.choice([0, rnd.randrange(0, 3000)]), hold=0, compass=rnd.randrange(0, 2), wizSight=rnd.randrange(0, 3), detect=rnd.randrange(0, 3),
                haste=rnd.randrange(0, 3), formation=form, chars=chars)

def line(w, pre_pokes, call, peeks, pick=None, sd=None):
    return ' '.join(['S', sd] + [HOOKS] + ([('H 0x%X %d' % (PICK, pick))] if pick is not None else []) + world_pokes(w) + pre_pokes + [call] + peeks)

vec = {'note': 'Generated by tools/blackcrypt/rules_oracle/make_vectors_spell.py from the game\'s own code; see docs/blackcrypt/amiga/game-rules.md'}

# ---------------- A: non-ray spells through the real CastSpell dispatcher (S_1 +0x7044)
NONRAY = [1, 32, 3, 9, 53, 7, 5, 54, 6, 42, 40, 15, 27, 20, 45, 56, 12, 13, 19, 48]
cases = []; lines = []
for n in range(1000):
    sid = NONRAY[n % len(NONRAY)]; w = rand_world(sid); pick = rnd.randrange(4); sd = seed()
    cases.append(dict(spell=sid, pick=pick, seed=sd, world=w))
    lines.append(line(w, [], 'C 0x7044 1 2 0', world_peeks(w), pick, sd))
res = run(lines)
vec['cast'] = []
for c, r in zip(cases, res):
    c['out'] = parse_out(c['world'], r); vec['cast'].append(c)


# ---------------- B: ray caster CastSpellRay (S_1 +0x6D9A, uses +0x435C ray march and +0xB308 target pick) on random maps
RAY_HOOKS = HOOKS + ' H 0x17D2A 0 H 0x2D46 0 H 0xB614 0 H 0x4AE 0 H 0xFE 0 H 0x8388 0 H 0x825C 0'
def rand_ray_world(force=False):
    w = rand_world(255)
    w['px'] = rnd.randrange(8, 13); w['py'] = rnd.randrange(8, 13)
    objs = {}; cells = {}; nxt = 1; sidx = 30
    DX = [(0, 1), (1, 0), (0, -1), (-1, 0)][w['facing']]
    path = {(w['px'] + DX[0] * k, w['py'] + DX[1] * k) for k in range(1, 4)}
    def newobj(o):
        nonlocal nxt
        i = nxt; nxt += 1; objs[i] = o; return i
    for k in range(0, 6):                       # only the squares a ray can touch (party square + 5 along the facing)
        x, y = w['px'] + DX[0] * k, w['py'] + DX[1] * k
        v = 0
        for d in range(4):
            if rnd.random() < 0.05: v |= 0x1000 << d
        if rnd.random() < 0.03: v |= 0x80000000
        chain = []
        if k >= 1 and (rnd.random() < 0.4 or (force and k == 1)) and nxt < 24:
            for _ in range(rnd.choice([1, 1, 2, 3])):
                if nxt >= 26: break
                r = rnd.random()
                if force and k == 1 and not chain: r = 0
                if r < 0.5:
                    gfx = rnd.choice([0x80B3, 0x80B3, 0x80B3, 0x80B1, 0x80B2, 0x80BE, 0x80C5, 0x80B7, 0x80C0])
                    hp = rnd.choice([1, 5, 20, 200, 600]); mx = rnd.randrange(1, 400)
                    S = sidx; sidx += 1
                    objs[S] = dict(kind='sec', maxHp=mx, w6=rnd.randrange(0, 500), pos=rnd.randrange(0, 5), alert=rnd.randrange(0, 4))
                    chain.append(newobj(dict(kind='mon', gfx=gfx, b2=rnd.randrange(256), hp=hp, S=S)))
                else:
                    t = rnd.choice([0x10, 0x11, 0x12, 0x14, 0x17, 0x1F, 0x2F, 0x05])
                    chain.append(newobj(dict(kind='str', b5=t, wA=rnd.choice([0, 0, 1]), wC=rnd.choice([0, 1, 2, 3]), w10=rnd.randrange(0, 6), b0F=rnd.randrange(0, 4))))
        for a, b in zip(chain, chain[1:]): objs[a]['next'] = b
        cells[(x, y)] = (v, chain[0] if chain else 0)
    w['objs'] = objs; w['cells'] = [[x, y, v | f] for (x, y), (v, f) in cells.items()]
    w['item36'] = rnd.random() < 0.4; w['b1E5C'] = rnd.choice([0, 3, 5])
    return w

def ray_pokes(w):
    it = world_pokes(w)
    for (x, y, v) in w['cells']: it.append(poke('l', CELL(x, y), v if v < 2**31 else v - 2**32))
    for i, o in w['objs'].items():
        i = int(i); b = OB(i)
        if o['kind'] == 'mon':
            it += [poke('w', b, o['gfx']), poke('b', b + 2, o['b2']), poke('w', b + 8, o['hp']), poke('w', b + 0x10, o['S']), poke('w', b + 0x12, o.get('next', 0))]
        elif o['kind'] == 'sec':
            it += [poke('w', b + 8, o['maxHp']), poke('w', b + 6, o['w6']), poke('b', b + 0xB, o['pos']), poke('b', b + 0x12, o['alert'])]
        else:
            it += [poke('w', b, 1), poke('b', b + 5, o['b5']), poke('w', b + 0xA, o['wA']), poke('w', b + 0xC, o['wC']), poke('w', b + 0x10, o['w10']),
                   poke('b', b + 0xF, o['b0F']), poke('w', b + 0x12, o.get('next', 0))]
    it += [poke('w', 0x1A24, w['active'])]
    if w['item36']: it += [poke('w', CH(w['active']) + 0x36, 40), poke('w', OB(40), 0xC0)]
    for i in range(4): it.append(poke('l', CH(i) + 0xA0, w['chars'][i].get('xp', 0)))
    return it

def ray_peeks(w):
    pk = [peek('r16s', 0x1E84)]
    for i, o in sorted(w['objs'].items(), key=lambda kv: int(kv[0])):
        i = int(i); b = OB(i)
        if o['kind'] == 'mon': pk += [peek('r16s', b + 8), peek('r8', OB(o['S']) + 0x12)]
    for i in range(4): pk.append(peek('r32', CH(i) + 0xA0))
    return pk

rcases = []; rlines = []
for n in range(1200):
    w = rand_ray_world()
    for c in w['chars']: c['xp'] = rnd.randrange(0, 1000)
    args = dict(mag=rnd.randrange(0, 60), dmg=rnd.randrange(0, 100), base=rnd.randrange(0, 90), pre=rnd.choice([1, 1, 0x64, 0x65, 0x66, 0x67, 0x67]), range=rnd.randrange(0, 6))
    sd = seed()
    rcases.append(dict(world=w, args=args, seed=sd))
    rlines.append(' '.join(['S', sd, RAY_HOOKS] + ray_pokes(w) + ['C 0x6D9A 5 2 %d 2 %d 2 %d 2 %d 2 %d' % (args['range'], args['pre'], args['base'], args['dmg'], args['mag'])] + ray_peeks(w)))
rres = run(rlines)
vec['ray'] = []
for c, r in zip(rcases, rres):
    w = c['world']; p = r['peeks']; j = 0
    out = {'total': p[0], 'mon': {}, 'xp': []}; j = 1
    for i, o in sorted(w['objs'].items(), key=lambda kv: int(kv[0])):
        if o['kind'] == 'mon': out['mon'][str(i)] = [p[j], p[j + 1]]; j += 2
    out['xp'] = p[j:j + 4]; out['seed'] = r['seed']; out['d0'] = r['d0']
    out['deaths'] = sum(1 for e in r['log'] if e[0] == 0x17D2A)
    c['out'] = out; vec['ray'].append(c)


# ---------------- C: ray spells through the dispatcher (CastSpell +0x7044) incl. antimagic squares, water squares, lifestealer
RAYSP = [0, 8, 11, 14, 16, 17, 23, 25, 28, 29, 30, 31, 33, 35, 36, 37, 38, 39, 47, 49, 50, 52, 55, 57, 58, 59]
rcases = []; rlines = []
for n in range(1040):
    sid = RAYSP[n % len(RAYSP)]
    w = rand_ray_world()
    for c in w['chars']: c['xp'] = rnd.randrange(0, 1000); c['slots'] = [sid, 255, 255, 255, 255]
    for c in w['cells']:
        if c[0] == w['px'] and c[1] == w['py'] and rnd.random() < 0.12: c[2] |= 0x40000000
    sd = seed()
    rcases.append(dict(spell=sid, world=w, seed=sd))
    rlines.append(' '.join(['S', sd, RAY_HOOKS] + ray_pokes(w) + ['C 0x7044 1 2 0'] + world_peeks(w) + ray_peeks(w)))
rres = run(rlines)
vec['rayspell'] = []
for c, r in zip(rcases, rres):
    w = c['world']; p = r['peeks']; nb = 4 * len(CF) + len(GF)
    out = {'chars': [], 'total': p[nb]}; j = 0
    for i in range(4):
        out['chars'].append({n: p[j + k] for k, (_, _, n) in enumerate(CF)}); j += len(CF)
    j = nb + 1; out['mon'] = {}
    for i, o in sorted(w['objs'].items(), key=lambda kv: int(kv[0])):
        if o['kind'] == 'mon': out['mon'][str(i)] = [p[j], p[j + 1]]; j += 2
    out['xp'] = p[j:j + 4]; out['seed'] = r['seed']
    out['spent'] = any(e[0] == 0x4876 for e in r['log']); out['failed'] = any(e[0] == 0x4960 for e in r['log'])
    c['out'] = out; vec['rayspell'].append(c)


# ---------------- D: spell recharge tick (the +0x10D2 section of the tick handler +0x8B2), real routine
RC_HOOKS = 'H 0x17686 0 H 0x17EEA 0 H 0x5EA 0 H 0xB614 0'
vec['recharge'] = []; rl = []; rc = []
for n in range(200):
    t = rnd.randrange(1, 100000)
    resting = rnd.randrange(2)
    while (t & 15) == 0 or (resting and (t & 7) == 0): t += 1
    timers = [rnd.choice([0, 0, 1, 2, 3, rnd.randrange(1, 2000), rnd.randrange(1, 32767)]) for _ in range(60)]
    cur = [rnd.randrange(0, 15) for _ in range(4)]
    mem = [0] * 20                                        # bytes 0x19F8..0x1A0B
    for p_ in range(8): mem[2 * p_ + 1] = rnd.randrange(0, 4)
    for ci in range(4): mem[0x1A07 - 0x19F8 + ci] = rnd.choice([0, 1, 1, 2])
    c = dict(t=t, resting=resting, timers=timers, cur=cur, mem=mem, active=rnd.randrange(4), showActive=rnd.randrange(2))
    it = [poke('w', 0x174E, 1), poke('l', 0x1750, t - 1), poke('w', 0x1746, resting), poke('w', 0x1A16, c['active']), poke('w', 0x1A18, c['showActive']), poke('b', 0x1749, 0)]
    it += [poke('b', 0x19F8 + i, mem[i]) for i in range(20)]
    for i in range(4): it.append(poke('b', CH(i) + 0x47, cur[i]))
    for sidx in range(60): it.append(poke('w', -0x7FEC + 8 * sidx + 4, timers[sidx]))
    pk = [peek('r16s', -0x7FEC + 8 * sidx + 4) for sidx in range(60)] + [peek('r8', 0x1749)]
    rl.append(' '.join(['S', seed(), RC_HOOKS] + it + ['C 0x8B2 0'] + pk)); rc.append(c)
for c, r in zip(rc, run(rl)):
    c['out'] = dict(timers=r['peeks'][:60], redraw=r['peeks'][60]); vec['recharge'].append(c)
# the page / spell chain tables as the game ships them (S_2)
s2 = open(S2, 'rb').read()
vec['pages'] = [dict(head=struct.unpack('>H', s2[0x1F2 + 6 * p + 2:0x1F2 + 6 * p + 4])[0]) for p in range(15)]
vec['spellNext'] = [s2[0x12 + 8 * i + 7] for i in range(60)]
vec['pageNext'] = [struct.unpack('>H', s2[0x1F2 + 6 * p + 4:0x1F2 + 6 * p + 6])[0] for p in range(15)]


# ---------------- E: memorise click (book UI handler +0x0F548, rows 0..3): slot fill and recharge timer formula, real routine
vec['memorise'] = []; ml = []; mc = []
for n in range(600):
    row = rnd.randrange(0, 4)
    c = dict(row=row, cls=rnd.randrange(4), level=rnd.randrange(1, 25), b6b=rnd.randrange(-6, 8), w65=rnd.randrange(0, 31), w66=rnd.randrange(0, 31),
             cur=rnd.randrange(0, 15), owned=[rnd.choice([0, 1, 1]) for _ in range(15)],
             timers=[rnd.choice([0, 0, 0, 5, 300]) for _ in range(60)],
             slots=[rnd.choice([255, 255, 255, rnd.randrange(60)]) for _ in range(5)])
    it = [poke('w', 0x1A14, 0), poke('w', 0x1A16, 0), poke('w', 0x1A18, 1), poke('w', 0x1EB4, row), poke('b', CH(0) + 0x47, c['cur']), poke('b', CH(0) + 0x5E, c['level']),
          poke('w', CH(0), c['cls']), poke('b', CH(0) + 0x65, c['w65']), poke('b', CH(0) + 0x66, c['w66']), poke('b', CH(0) + 0x6B, c['b6b'] & 255)]
    it += [poke('b', CH(0) + 0x49 + i, c['slots'][i]) for i in range(5)]
    it += [poke('b', -0x7E0C + 6 * pg + 1, c['owned'][pg]) for pg in range(15)]
    it += [poke('w', -0x7FEC + 8 * sx + 4, c['timers'][sx]) for sx in range(60)]
    pk = [peek('r8', CH(0) + 0x49 + i) for i in range(5)] + [peek('r16', -0x7FEC + 8 * sx + 4) for sx in range(60)]
    ml.append(' '.join(['S', seed(), HOOKS] + it + ['C 0xF548 0'] + pk)); mc.append(c)
for c, r in zip(mc, run(ml)):
    c['out'] = dict(slots=r['peeks'][:5], timers=r['peeks'][5:65]); vec['memorise'].append(c)
vec['spellLevel'] = [s2[0x12 + 8 * i + 6] for i in range(60)]


# ---------------- F: monster possession (bit 12) and flesh-to-stone (bit 13) of the special-attack routine +0x98A8
SP_HOOKS = 'H 0x17686 0 H 0x5EA 0 H 0x8388 0 H 0x825C 0 H 0x175C4 27 H 0x27D28 28'
OBJ_CORPSE, OBJ_STATUE = 27, 28
vec['stonePos'] = [[s2[0x24C + 2 * c], s2[0x24C + 2 * c + 1]] for c in range(4)]
vec['special2'] = []; fl = []; fc = []
for n in range(1600):
    form = list(range(4)); rnd.shuffle(form)
    c = dict(bit=12 + (n % 2), gfx=rnd.choice([0x80B7, 0x80B7, 0x80B7, 0x80B3]), dir=rnd.randrange(4), pos=rnd.randrange(5), facing=rnd.randrange(4), maxHp=rnd.randrange(10, 300),
             form=form, hp=[rnd.choice([-3, 0, 5, 30, 60]) for _ in range(4)], resist=[rnd.choice([-2, 0, 20, 50]) for _ in range(4)],
             shield=[rnd.choice([0, 0, 1]) for _ in range(4)], prot12=[rnd.choice([0, 0, 0, 1]) for _ in range(4)], prot13=[rnd.choice([0, 0, 0, 1]) for _ in range(4)], carried=rnd.randrange(0, 20))
    it = [poke('w', 0x1744, c['facing'])]
    for i in range(4):
        it += [poke('w', 0x1E74 + 2 * i, c['form'][i]), poke('w', CH(i) + 0x4E, c['hp'][i]), poke('b', CH(i) + 0x69, c['resist'][i] & 255), poke('b', CH(i) + 0x83, c['shield'][i]),
               poke('b', CH(i) + 0x8F, c['prot12'][i]), poke('b', CH(i) + 0x87, c['prot13'][i])]
    P, S = 1, 2
    it += [poke('w', OB(P), c['gfx']), poke('w', OB(P) + 0x10, S), poke('w', OB(P) + 8, 50), poke('w', OB(P) + 0xA, c['carried']), poke('w', OB(S) + 8, c['maxHp']), poke('b', OB(S) + 0xB, c['pos']), poke('b', OB(S) + 0xA, 0),
           poke('w', OB(OBJ_CORPSE) + 0x12, 0), poke('w', OB(OBJ_STATUE) + 0xE, 0xFFFF), poke('w', OB(OBJ_STATUE) + 0xA, 0xFFFF), poke('b', -0x708E, 0), poke('w', -0x708A, 0)]
    call = 'C 0x98A8 5 1 %d 2 %d 2 5 2 5 2 %d' % (c['dir'], c['bit'], P)
    pk = [peek('r16', OB(P)), peek('r16s', OB(P) + 8), peek('r16s', OB(S) + 8), peek('r8', OB(S) + 0xA), peek('r16', OB(P) + 0xA), peek('r16', OB(OBJ_CORPSE) + 0x12),
          peek('r16', OB(OBJ_STATUE) + 0xE), peek('r16', OB(OBJ_STATUE) + 0xA), peek('r8', -0x708E), peek('r16', -0x708A)]
    sd = seed(); c['seed0'] = sd
    fl.append(' '.join(['S', sd, SP_HOOKS] + it + [call] + pk)); fc.append(c)
for c, r in zip(fc, run(fl)):
    p = r['peeks']
    c['out'] = dict(gfx=p[0], hp=p[1], maxHp=p[2], b0A=p[3], carried=p[4], corpseNext=p[5], statueChar=p[6], statueA=p[7], b708E=p[8], w708A=p[9], seed=r['seed'],
                    dmg=[e[1:5] for e in r['log'] if e[0] == 0x17686], corpse=[e[1] for e in r['log'] if e[0] == 0x175C4],
                    statue=[[e[9], e[10], e[11]] for e in r['log'] if e[0] == 0x27D28], sched=sum(1 for e in r['log'] if e[0] == 0x5EA))
    vec['special2'].append(c)


# ---------------- G: DISMISS (34) and BINDING (43) on the facing square, REFRESH (46), through the dispatcher
vec['facing'] = []; gl = []; gc = []
for n in range(900):
    sid = [34, 43, 46][n % 3]
    w = rand_ray_world(True)
    for c in w['chars']: c['xp'] = rnd.randrange(0, 1000); c['slots'] = [sid, 255, 255, 255, 255]
    for mo in w['objs'].values():
        if mo['kind'] == 'mon': mo['hp'] = rnd.choice([1, 5, 20, 200, 600, 30])
    sd = seed()
    extra = {}
    if sid == 46:
        extra = dict(book=rnd.randrange(3), first=rnd.randrange(0, 11), owned=[rnd.choice([0, 1, 1]) for _ in range(15)], timers=[rnd.choice([0, 7, 500]) for _ in range(60)])
    it = ray_pokes(w)
    if sid == 46:
        a = w['active']
        it += [poke('b', CH(a) + 0x45, extra['book']), poke('b', CH(a) + 0x46, extra['first'])]
        it += [poke('b', -0x7E0C + 6 * pg + 1, extra['owned'][pg]) for pg in range(15)] + [poke('w', -0x7FEC + 8 * sx + 4, extra['timers'][sx]) for sx in range(60)]
    pk = ray_peeks(w) + [peek('r16', -0x7FEC + 8 * sx + 4) for sx in range(60)]
    gl.append(' '.join(['S', sd, RAY_HOOKS, 'H 0xB25A 0'] + it + ['C 0x7044 1 2 0'] + pk)); gc.append(dict(spell=sid, world=w, seed=sd, extra=extra))
for c, r in zip(gc, run(gl)):
    w = c['world']; p = r['peeks']; j = 1; o = {'total': p[0], 'mon': {}}
    for i, ob in sorted(w['objs'].items(), key=lambda kv: int(kv[0])):
        if ob['kind'] == 'mon': o['mon'][str(i)] = [p[j], p[j + 1]]; j += 2
    o['xp'] = p[j:j + 4]; o['timers'] = p[j + 4:j + 64]; o['seed'] = r['seed']
    o['b25a'] = [e[1:5] for e in r['log'] if e[0] == 0xB25A]; o['sched'] = [e[1:9] for e in r['log'] if e[0] == 0x5EA]
    o['spent'] = any(e[0] == 0x4876 for e in r['log']); o['failed'] = any(e[0] == 0x4960 for e in r['log'])
    c['out'] = o; vec['facing'].append(c)

if __name__ == '__main__':
    out = sys.argv[3] if len(sys.argv) > 3 else str(here / 'vectors_spell.json.gz')
    with gzip.open(out, 'wt', compresslevel=9) as f: json.dump(vec, f, separators=(',', ':'))
    print('wrote', out, {k: len(v) for k, v in vec.items() if isinstance(v, list)})

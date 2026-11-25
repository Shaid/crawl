"""Spell units: combat cast menu `comcast` CODE+0xC7C7 with its 94 effect handlers (table DS:0x39E2), and the shared
engines (condition engine 0xCBAE, damage engine 0xCC84, heal 0xCE21).  Keys are scripted through a stubbed `wait_`."""
from common import *
from units_combat import mon_setup, party_fx, MONBASE, MONSLOT, MONTAB, NMON
from units_effects import effect_state

SPD1, SPD2, HTAB = 0xc5dc, 0xc63a, 0x39e2     # flag byte, cost byte (bit7 = SP cost is the caster level) per spell; code-address table
PARTYTAB = 0x3ca8                             # word pointers to the party's character records
NPARTY, CURIDX = 0x3bc0, 0x3bf4

def list_index(cls, level, slot):
    """spell number in the 94-entry tables from the menu keys (level 0..6, slot 0..7): the code at CODE+0xC852..0xC897"""
    base = 0x2f if cls in (3, 5) else 0
    return base + slot + 8 * min(level, 4) + 5 * max(level - 4, 0)

def level_slot(i):
    base = 47 if i >= 47 else 0
    j = i - base
    if j < 32: return j // 8, j % 8
    j -= 32
    return 4 + j // 5, j % 5

def make_wait(e, keys):
    """wait_ stub (CODE+0x4582): returns the next scripted key in AL (ESC when the script is exhausted); logged as ['wait_', [key]]"""
    q = list(keys)
    def args(em):
        k = q.pop(0) if q else 0x1b
        em.scratch['key'] = k
        return [k]
    def fn(em):
        em.uc.reg_write(UC_X86_REG_AX, (em.uc.reg_read(UC_X86_REG_AX) & 0xff00) | em.scratch['key'])
    return ('wait_', 0x4582, fn, args)

from unicorn.x86_const import UC_X86_REG_AX

def party_setup(e, r, cls=None):
    n = r.choice([1, 2, 3, 4, 5, 6, 6])
    recs = r.sample(range(18), n)
    for i, k in enumerate(recs):
        mkchar(e, r, rec_addr(k), cls=(cls if (i == 0 and cls) else None))
        e.ww(PARTYTAB + 2 * i, rec_addr(k))
        effect_state_char(e, r, rec_addr(k))
    e.wb(NPARTY, n)
    cur = r.randint(0, n - 1)
    e.ww(CURIDX, cur)
    e.ww(CHARP, rec_addr(recs[cur]))
    return rec_addr(recs[cur]), n

def effect_state_char(e, r, a):
    for off in range(0x59, 0x68, 2):
        e.wb(a + off, r.choice([0, 1, 2, 3, 5, 20, 50, 100, 119, 120, 130, 200]))
    e.wb(a + 0x3f, r.choice([0, 0, 0, 0, 0x40, 0x80, 0xc0, 0x01, 0x02, 0x20, 0xa0, 0xe0, 0xff, r.getrandbits(8)]))
    for off in (0x33, 0x35, 0x37):
        e.ww(a + off, r.choice([0, 1, 5, 20, 100, 300, r.getrandbits(16)]))

UI = [PTEXT, ('cout', 0x3fff, None, lambda e: [e.regs()['ax'] & 255]), uistub('pdec', 0x4030), uistub('clropt', 0xbfd1), uistub('escl', 0xbf94),
      uistub('noises', 0x1ab3), ('dosound', 0x1ad6, None, lambda e: [e.regs()['ax']]), uistub('delay', 0xc219),
      uistub('pmonst', 0xb958), ('pmonname', 0xba6b, None, lambda e: [e.regs()['bp']]), uistub('pcharn', 0xbb02), uistub('pnums', 0xb79f),
      uistub('puttoscr', 0xc5ad)]
STOPS = (0xc7c4, 0xc5e1, 0x9a46, 0x9809, 0x9799)

def world_setup(e, r, cls=None):
    rnd_state(e, r)
    a, n = party_setup(e, r, cls)
    mon_setup(e, r)
    party_fx(e, r)
    for off in (0x3c95, 0x3c96, 0x3c97, 0x3c98, 0x3c99, 0x3c9a, 0x3c9b, 0x3ca1, 0x3ca2, 0x3ca3, 0x3ca4, 0x3ca5):
        e.wb(off, r.choice([0, 0, 0, 5, 20, 60, 130, r.randint(0, 255)]))
    e.wb(0x3c10, r.choice([0, 0, 0, 0, 0, 0, 1, 2, 3, r.getrandbits(8)]))
    e.wb(0x3c11, r.choice([0, 1, 2, 3, 4, r.randint(0, 15)]))
    e.ww(0x132, 0xc940)
    for i in range(0x80): e.wb(0xc940 + i, r.choice([0, 0x80, 0xff, r.getrandbits(8), r.randint(0, 120)]))
    e.wb(0x3189, r.choice([0, 0, 0, 1]))
    for k in range(6): e.wb(0x3855 + k, r.choice([0, 0, 1]))
    return a, n

@unit('cast')
def _(n, rnd):
    def mk(e, r):
        sidx = r.randint(0, 93)
        cls = r.choice([3, 5]) if sidx >= 47 else r.choice([1, 2, 4, 6])
        a, np_ = world_setup(e, r, cls)
        L, S = level_slot(sidx)
        e.wb(a + 0x30, r.choice([7, 7, 7, 7, 5, 4, r.randint(0, 9)]))
        lvl = r.choice([1, 3, 8, 15, 30, r.randint(1, 255)]); e.wb(a + 0x24, lvl)
        e.ww(a + 0x2b, r.choice([100, 255, 300, 256, 258, 0x103, r.randint(0, 60), r.randint(0, 6)]))
        e.ww(a + 0x31, r.choice([100, 255, 300, 256, 257, 0x102, r.randint(0, 60), r.randint(0, 6)]))
        if r.random() < 0.6:     # mostly let the cast through every gate
            e.wb(a + 0x30, 7); e.ww(a + 0x2b, 250); e.ww(a + 0x31, 250); e.wb(0x3c10, e.rb(0x3c10) & ~2); e.wb(0xc940, e.rb(0xc940) | 0x80)
        keys = [0x31 + L, 0x31 + S]
        box_tag[0] = cls in (3, 5)
        for _ in range(r.choice([1, 1, 2, 3])): keys.append(r.choice([0x31 + r.randint(0, 5), 0x41 + r.randint(0, 4), 0x41, 0x0d, 0x0d]))
        if r.random() < 0.15: keys.insert(r.randint(0, len(keys)), r.choice([0x1b, 0x20, 0x39, 0x30, 0x7a]))
        return keys, {}
    res = []
    box_tag = [None]
    e = Emu(); Rc = Rec(e)
    for _ in range(n):
        box = {}
        e.stubs.clear()
        def setup(em, box=box):
            box['keys'], _ = mk(em, rnd)
            for st in UI + [make_wait(em, box['keys'])]: em.stub(st[1], st[0], st[2] if len(st) > 2 else None, st[3] if len(st) > 3 else None)
        v = Rc.run(0xc7c7, None, setup, stops=STOPS)
        res.append({'args': box['keys'], 'tag': box_tag[0], **v})
    seen = set()
    for d in res:       # keep one vector per (cast list, level key, slot key, outcome) in the committed subset
        k = (d['tag'], d['args'][0] if d['args'] else 0, d['args'][1] if len(d['args']) > 1 else 0, d['out']['stop'])
        if k not in seen: seen.add(k); d['keep'] = True
    cnt = {}
    for d in res:       # spells whose SP cost is the caster level (cost byte bit 7): keep a few so the cost gate is tested in the subset
        k = (d['tag'], d['args'][0] if d['args'] else 0, d['args'][1] if len(d['args']) > 1 else 0)
        if k in ((False, 0x31, 0x36), (True, 0x31, 0x33)) and cnt.get(k, 0) < 14: cnt[k] = cnt.get(k, 0) + 1; d['keep'] = True
    return res

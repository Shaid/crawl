#!/usr/bin/env python3
"""Per-map special-cell event table, derived by EXECUTING the overlays (see docs/mm1/dosega/game-rules.md section 4 / pass 4).
For each of the 55 overlays: the dispatch table as the real dispatcher resolves it for every (cell, facing), every distinct handler explored
by directed fuzzing (random party state + scripted keys + mutated overlay-data flags), outcomes = distinct stub-call sequences.
usage: ovr_events.py OUT.json [--runs N] [--only NAME,NAME]"""
import sys, json, random, collections, struct, os
from ovr import *

FACINGS = {'N': 0xc0, 'E': 0x30, 'S': 0x0c, 'W': 0x03}

def classify_miss(ov):
    """what the dispatcher does when the cell is not in its table (flagged special cells without a table entry)"""
    miss, _, _ = dispatcher_stops(ov)
    ins = list(MD.disasm(ov.code[miss - CB: miss - CB + 12], miss))
    a, b = ins[0], ins[1]
    if a.mnemonic == 'call' and (int(a.op_str, 16) & 0xffff) == 0x4449 and b.mnemonic == 'jmp' and (int(b.op_str, 16) & 0xffff) == 0x45fd:
        return {'kind': 'erase+encounter'}
    if a.mnemonic == 'jmp':
        t = int(a.op_str, 16) & 0xffff
        if t == 0x4cd6: return {'kind': 'wait1'}            # nothing happens: straight to the movement/key handler
        if CB <= t < ov.entry: return {'kind': 'custom', 'handler': t}
        return {'kind': 'exe-jump', 'target': t}
    return {'kind': 'inline'}                               # the miss slot itself holds the handler code

def dispatch_table(e, ov):
    cells = {}
    for cell in range(256):
        for fn, f in FACINGS.items():
            r = real_dispatch(e, ov, cell, f)
            if r != 'miss': cells.setdefault(cell, {})[fn] = r
    return cells

def trace_of(log, pos=None):
    """behavioural trace: UI noise (noises) dropped, consecutive wait_ polls collapsed, the key values themselves are kept out of the signature"""
    t = []
    for n, a in log:
        if n == 'noises': continue
        if n == 'wait_':
            if t and t[-1][0] == 'wait_': continue
            t.append(['wait_', []]); continue
        if n == 'loadnext' and pos is not None:       # destination x,y are the call-time party position; only meaningful when the handler wrote them
            a = [a[0], a[1], a[2]] + ([a[3], a[4]] if 0x3c38 in pos and 0x3c39 in pos else [None, None])
        t.append([n, a])
    return t

def sig_of(res, ovw, extra, pos):
    return json.dumps([trace_of(res['log'], pos), sorted(ovw.items()), extra], separators=(',', ':'))

def run_with_writes(e, ov, ip, r, keys, kbk, perturb):
    from unicorn import UC_HOOK_MEM_WRITE
    wr = set()
    def mw(uc, access, addr, size, value, ud):
        o = addr - DS_BASE
        for a in range(o, o + size): wr.add(a)
    h = e.uc.hook_add(UC_HOOK_MEM_WRITE, mw)
    try: res = explore_run(e, ov, ip, r, keys, kbk, perturb=perturb)
    finally: e.uc.hook_del(h)
    ovw = {a - DB: e.rb(a) for a in wr if DB <= a < DB + ov.dsz + ov.bss}
    pos = {a: e.rb(a) for a in wr if a in (0x3c38, 0x3c39, 0x3c3a, 0x3c10, 0x3c11) or 0x3c3d <= a <= 0x3c44}
    ch = sorted({(a - ROSTER) % CH for a in wr if ROSTER <= a < ROSTER + 18 * CH})
    flagw = sorted(a - 0x3dfa for a in wr if 0x3dfa <= a < 0x3efa)
    return res, ovw, pos, ch, flagw

def explore_handler(e, ov, addr, nruns, seed):
    r = random.Random(seed ^ addr)
    outcomes = {}; cov = set(); pool = {}; errors = 0
    for i in range(nruns):
        keys = keyset(r); kbk = r.choice([0, 1, 2, 3])
        pert = []
        if i % 3 and pool:
            for _ in range(r.choice([1, 1, 2, 3])):
                o = r.choice(sorted(pool)); pert.append((DB + o, r.choice([0, 1, 2, 3, 4, 0x80, 0xff, r.getrandbits(8)])))
        try:
            res, ovw, pos, ch, flagw = run_with_writes(e, ov, addr, r, keys, kbk, pert)
        except Exception as ex:
            errors += 1; continue
        cov |= res['covered']
        for o in res['reads']: pool[o] = 1
        extra = [sorted(pos.items()), ch, flagw]
        s = sig_of(res, ovw, extra, pos)
        o = outcomes.get(s)
        if o is None:
            o = outcomes[s] = dict(trace=trace_of(res['log'], pos), ovWrites=ovw, pos=pos, charFields=ch, flagWrites=flagw, n=0, onKeys=set(), keys=res['keys'], perturb=[(a - DB, v) for a, v in pert], kbk=kbk)
        o['n'] += 1
        if res['keys']: o['onKeys'].add(res['keys'][0])
    return outcomes, cov, errors

def kind_of(calls_all):
    names = {c[0] for c in calls_all}
    k = []
    if 'loadnext' in names: k.append('teleport')
    if 'retfmaze' in names: k.append('exit-to-map')
    if names & {'encounter'}: k.append('encounter')
    for n in ('blacks', 'food', 'tavern', 'temple', 'training'): 
        if n in names: k.append(n)
    if 'statue' in names: k.append('statue')
    if 'random' in names: k.append('random')
    return k

def summarize_handler(e, ov, addr, runs, seed, exe):
    names = screen_key_tables()[2]
    outs, cov, errs = explore_handler(e, ov, addr, runs, seed)
    st = static_reach(ov, addr)
    ol = sorted(outs.values(), key=lambda x: -x['n'])
    allcalls = [c for x in ol for c in x['trace']]
    for x in ol: x['onKeys'] = sorted(x['onKeys'])
    texts = []
    for c in allcalls:
        if c[0] == 'ph2':
            s = read_cstring(ov, c[1][0], exe)
            if s is not None and s not in texts: texts.append(s)
    dests = []
    for x in ol:
        for c in x['trace']:
            if c[0] == 'loadnext':
                al, bx, bp, px, py = c[1]; si = resolve_screen(al, bx & 255, bp)
                d = dict(al=al, bl=bx & 255, bp=bp, x=px, y=py, keepPosition=px is None, screen=si, slug=names[si] if si is not None else None)
                if d not in dests: dests.append(d)
    return dict(dests=dests, kinds=kind_of(allcalls), nOutcomes=len(ol), outcomes=ol[:16], texts=texts, coverage=[len(cov & st), len(st)], errors=errs)

def add_miss_paths(res, runs=150, seed=1):
    e = Emu(); exe = exe_image()
    for name, o in res.items():
        ov = Ovr(name)
        miss = dispatcher_stops(ov)[0] if o['dispatcher'] == 'standard' else None
        if miss is None: o['missPath'] = None; continue
        o['missPath'] = dict(addr=miss, **summarize_handler(e, ov, miss, runs, seed, exe))
        o['miss'] = classify_miss(ov)
        o['bogusHandlers'] = [h for h in o['bogusHandlers'] if not (o['miss']['kind'] in ('wait1', 'exe-jump') and int(h, 16) == o['miss'].get('target', 0x4cd6))]
        print(name, o['miss']['kind'], 'missPath cov', o['missPath']['coverage'], flush=True)

def build(only=None, runs=120, seed=1):
    e = Emu(); out = {}; starts, keys, names = screen_key_tables()
    exe = exe_image()
    for name in OVR_NAMES:
        if only and name not in only: continue
        ov = Ovr(name); lay = table_layout(ov)
        o = {'header': dict(codeSize=ov.csz, dataSize=ov.dsz, entry=ov.entry), 'layout': lay}
        hand_addrs = set()
        if lay is None:
            o['dispatcher'] = 'custom'; o['cells'] = {}; hand_addrs.add(DISPATCH)
            o['miss'] = None
        else:
            o['dispatcher'] = 'standard'; o['count'] = ov.data[lay['count_addr'] - DB]
            tab = dispatch_table(e, ov); o['miss'] = classify_miss(ov)
            o['cells'] = {c: v for c, v in tab.items()}
            for v in tab.values():
                for h in v.values():
                    if h != 'nomask': hand_addrs.add(h)
            if o['miss']['kind'] == 'custom': hand_addrs.add(o['miss']['handler'])
        mz = open(os.path.join(DATA_DIR, 'MAZEDATA.DTA'), 'rb').read()
        si = names.index(name.lower()); page1 = mz[si * 512 + 256: si * 512 + 512]
        flagged = sorted(c for c in range(256) if page1[c] & 0x80)
        dcells = sorted(c for c, v in o['cells'].items() if any(h != 'nomask' for h in v.values()))
        o['specialFlagged'] = flagged
        o['crossCheck'] = dict(flaggedNoHandler=[c for c in flagged if c not in dcells], handlerNotFlagged=[c for c in dcells if c not in flagged], screen=si)
        hs = {}
        reach_all = set()
        incode = lambda a: CB <= a < ov.entry
        bogus = sorted(a for a in hand_addrs if not incode(a)); hand_addrs = {a for a in hand_addrs if incode(a)}
        o['bogusHandlers'] = ['%04x' % a for a in bogus]
        for a in sorted(hand_addrs):
            outs, cov, errs = explore_handler(e, ov, a, runs, seed)
            st = static_reach(ov, a)
            reach_all |= st
            ol = sorted(outs.values(), key=lambda x: -x['n'])
            allcalls = [c for x in ol for c in x['trace']]
            for x in ol: x['onKeys'] = sorted(x['onKeys'])
            texts = []
            for c in allcalls:
                if c[0] == 'ph2':
                    s = read_cstring(ov, c[1][0], exe)
                    if s is not None and s not in texts: texts.append(s)
            dests = []
            for x in ol:
                for c in x['trace']:
                    if c[0] == 'loadnext':
                        al, bx, bp, px, py = c[1]; si = resolve_screen(al, bx & 255, bp)
                        d = dict(al=al, bl=bx & 255, bp=bp, x=px, y=py, keepPosition=px is None, screen=si, slug=names[si] if si is not None else None)
                        if d not in dests: dests.append(d)
            hs['%04x' % a] = dict(dests=dests, kinds=kind_of(allcalls), nOutcomes=len(ol), outcomes=ol[:16], texts=texts, coverage=[len(cov & st), len(st)], errors=errs)
        o['handlers'] = hs
        out[name] = o
        cv = sum(h['coverage'][0] for h in hs.values()); tt = sum(h['coverage'][1] for h in hs.values())
        print(name, o['dispatcher'], len(o['cells']), 'cells', len(hs), 'handlers', 'coverage %d/%d' % (cv, tt), flush=True)
    return out

def compact_to_gz(res, path):
    """committed form: structure only. Retail text is NOT stored: handlers keep text POINTERS (`textPtrs`), strings are re-resolved from the game files at build time;
    example keystroke scripts are dropped (a typed-word gate must not leak through them)."""
    import gzip
    for ov in res.values():
        hs = list(ov['handlers'].values()) + ([ov['missPath']] if ov.get('missPath') else [])
        for h in hs:
            h['outcomes'] = h['outcomes'][:12]
            ptrs = []
            for oc in h['outcomes']:
                for k in ('perturb', 'kbk', 'keys'): oc.pop(k, None)
                for c in oc['trace']:
                    if c[0] == 'ph2' and c[1][0] not in ptrs: ptrs.append(c[1][0])
            h.pop('texts', None); h['textPtrs'] = ptrs
            if ov['dispatcher'] == 'custom':           # table-less typed-word gate: drop the per-outcome key sets too
                for oc in h['outcomes']: oc['onKeys'] = []
    with gzip.GzipFile(path, 'wb', mtime=0) as g: g.write(json.dumps(res, separators=(',', ':'), sort_keys=True).encode())

if __name__ == '__main__':
    a = sys.argv
    if a[1] == '--compact': compact_to_gz(json.load(open(a[2])), a[3]); sys.exit(0)
    if a[1] == '--miss': r = json.load(open(a[2])); add_miss_paths(r); json.dump(r, open(a[3], 'w'), separators=(',', ':')); sys.exit(0)
    runs = int(a[a.index('--runs') + 1]) if '--runs' in a else 120
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    res = build(only, runs)
    json.dump(res, open(a[1], 'w'), separators=(',', ':'))
    if '--gz' in a: compact_to_gz(res, a[a.index('--gz') + 1])

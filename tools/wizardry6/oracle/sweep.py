"""Full walker-vs-game view sweep: every in-region cell x 4 facings of a level,
rendered by the game (LAB_0554 under Unicorn) and by the walker
(walker-frames.mts), compared pixel for pixel over the 176x112 viewport.

    python sweep.py --out DIR LEVEL|all [--stride N]

Writes DIR/levelNN.json:
  poses, mismatch           counts
  breakdown                 per mismatched pose, which stage(s) differ:
    cel  : the game's .PIC cel draws (CODE+0x35e6) differ from the walker's
    list : the walker's maze-piece list/order differs (view-model.ts)
    geom : the walker draws its own list differently from DrawMazePiece
           (CODE+0x3d72) would (slots.json geometry)
  examples                  up to 40 mismatched poses with the differing
                            pieces (game-only / walker-only)
  null                      control: the game frame vs the walker at facing+1
                            on ~5% of poses (should almost always differ)
`all` runs each level in its own child process, so memory is released
between levels. Run from anywhere; the walker side runs from the repo root.
"""
import argparse
import collections
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def run_level(L, out_dir, stride):
    from w6 import W6, make_windows, render_walker_pose, walker_level, REPO, CODE_BASE
    from unicorn import UC_HOOK_CODE
    from unicorn.m68k_const import UC_M68K_REG_A7, UC_M68K_REG_PC
    import numpy as np

    icons = ('346,', '349,', '352,', '355,', '358,', '361,')  # status-bar icons, outside the view

    class Rec:
        def __init__(self, e):
            self.e = e
            self.calls = []
            self.skip_cel = False
            e.uc.hook_add(UC_HOOK_CODE, self.h_dmp, begin=CODE_BASE + 0x3D72, end=CODE_BASE + 0x3D72)
            e.uc.hook_add(UC_HOOK_CODE, self.h_cel, begin=CODE_BASE + 0x35E6, end=CODE_BASE + 0x35E6)

        def h_dmp(self, uc, a, s, ud):
            e = self.e
            sp = uc.reg_read(UC_M68K_REG_A7)
            dst = e.r16(sp + 8)
            self.calls.append(f'{e.r16(sp + 4)},{e.r16(sp + 6)},{-1 if dst == 0xFFFF else dst}')

        def h_cel(self, uc, a, s, ud):
            e = self.e
            sp = uc.reg_read(UC_M68K_REG_A7)
            self.calls.append(f'cel{e.r16(sp + 4)}:{e.r8(e.r32(sp + 18))}')
            if self.skip_cel:
                uc.reg_write(UC_M68K_REG_A7, sp + 4)
                uc.reg_write(UC_M68K_REG_PC, e.r32(sp))

    def view(fr):
        return np.frombuffer(fr, np.uint8).reshape(200, 320)[32:144, 72:248]

    d = walker_level(L)
    W, H = d['cellSpace']['width'], d['cellSpace']['height']
    reg = d['units'][0]['planes']['region']
    poses = [{'level': L, 'x': x, 'y': y, 'f': f}
             for y in range(H) for x in range(W) if reg[y * W + x] >= 0 for f in range(4)][::stride]
    rnd = random.Random(L)
    nulls = [i for i in range(len(poses)) if rnd.random() < 0.05]
    extra = [{**poses[i], 'f': (poses[i]['f'] + 1) & 3} for i in nulls]

    tag = os.path.join(out_dir, f'.walker{L:02d}')
    json.dump(poses + extra, open(tag + '.json', 'w'))
    subprocess.run(['npx', 'tsx', os.path.join(HERE, 'walker-frames.mts'), tag + '.json', tag + '.bin'],
                   cwd=REPO, check=True, capture_output=True)
    wf = np.fromfile(tag + '.bin', np.uint8).reshape(-1, 112, 176)
    wl = open(tag + '.bin.lists').read().split('\n')
    for ext in ('.json', '.bin', '.bin.lists'):
        os.remove(tag + ext)

    e = W6()
    e.boot()
    make_windows(e)
    rec = Rec(e)

    def replay(lst):
        e.uc.mem_write(e.screen, bytes(0x8000))
        for it in lst:
            if it.startswith('cel'):
                continue
            s, m, dd = map(int, it.split(','))
            e.call(0x3D72, [s, m, dd & 0xFFFF])
        return view(e.snapshot())

    breakdown = collections.Counter()
    examples = []
    null_caught = 0
    mismatch = 0
    for i, p in enumerate(poses):
        rec.calls.clear()
        rec.skip_cel = False
        g = view(render_walker_pose(e, L, p['x'], p['y'], p['f']))
        if i in nulls and (g != wf[len(poses) + nulls.index(i)]).any():
            null_caught += 1
        n = int((g != wf[i]).sum())
        if not n:
            continue
        mismatch += 1
        glist = [c for c in rec.calls if not c.startswith(icons)]
        rec.calls.clear()
        rec.skip_cel = True
        gnc = view(render_walker_pose(e, L, p['x'], p['y'], p['f']))
        rec.skip_cel = False
        wlist = wl[i].split() if wl[i] else []
        rw = replay(wlist)
        cel_px = int((g != gnc).sum())
        list_px = int((gnc != rw).sum())
        geom_px = int((rw != wf[i]).sum())
        key = '+'.join(k for k, v in (('cel', cel_px), ('list', list_px), ('geom', geom_px)) if v) or 'other'
        breakdown[key] += 1
        if len(examples) < 40:
            gc = collections.Counter(glist)
            wc = collections.Counter(wlist)
            examples.append({**{k: p[k] for k in ('x', 'y', 'f')}, 'px': n, 'cel': cel_px, 'list': list_px, 'geom': geom_px,
                             'gameOnly': sorted((gc - wc).elements()), 'walkerOnly': sorted((wc - gc).elements())})
    out = {'level': L, 'poses': len(poses), 'mismatch': mismatch, 'breakdown': dict(breakdown),
           'null': {'checked': len(nulls), 'caught': null_caught}, 'examples': examples}
    json.dump(out, open(os.path.join(out_dir, f'level{L:02d}.json'), 'w'), indent=1)
    print(f'level {L:2d}: {mismatch}/{len(poses)} mismatched ({100 * mismatch / max(1, len(poses)):.2f}%) '
          f'{dict(breakdown)} null {null_caught}/{len(nulls)}', flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('level')
    ap.add_argument('--out', required=True)
    ap.add_argument('--stride', type=int, default=1)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.level == 'all':
        for L in range(14):
            subprocess.run([sys.executable, os.path.abspath(__file__), str(L), '--out', a.out, '--stride', str(a.stride)],
                           check=True)
    else:
        run_level(int(a.level), a.out, a.stride)


if __name__ == '__main__':
    main()

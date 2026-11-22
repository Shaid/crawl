"""Wizardry 6 (Amiga) game oracle: runs the game's own routines from `Bane`
under a Unicorn 68000 core (no full-system emulator) and reports what the
game does, for comparison against crawl's walker.

    python oracle.py frames POSES.json OUT.bin
        POSES = [{"level", "x", "y", "f"}...] in walker grid coordinates.
        Runs the view renderer LAB_0554 (CODE+0xa810) per pose and writes the
        176x112 viewport (screen (72,32)), one byte per pixel = palette index,
        19,712 bytes per pose, back to back.

    python oracle.py moves ATTEMPTS.json OUT.json
        ATTEMPTS = [{"level", "x", "y", "f", "rel", "door"}...]; door = the
        value forced into all four -18146(A4) door-state words.
        Runs TryMove LAB_07C0 (CODE+0x116ac) and writes one result per
        attempt: {"kind": moved|bump|locked|bounce|death|none, "value": ...}
        (value = "x,y" for moved, else the message id).

    python oracle.py arrive CELLS.json OUT.json
        CELLS = [{"level", "x", "y"}...]. Runs level entry LAB_073F
        (CODE+0x103e8) then the post-move entity dispatch LAB_06B6
        (CODE+0xe9be) with only kinds 1 (teleport) and 7 (door state) live;
        writes {"level", "x", "y", "doorState"} per cell.

Needs `unicorn` and `numpy` (see README.md) and the retail files under
data/wizardry6/amiga/ (override with W6_DATA). Reads only; writes only OUT.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from w6 import *  # noqa: E402,F401,F403
import numpy as np  # noqa: E402

VIEW_BYTES = 176 * 112
MSG_KIND = {0x7E4: 'bump', 0x7E5: 'locked', 0x805: 'bounce'}


def view(frame):
    return np.frombuffer(frame, np.uint8).reshape(200, 320)[32:144, 72:248]


def cmd_frames(poses_path, out_path):
    poses = json.load(open(poses_path))
    e = W6()
    e.boot()
    make_windows(e)
    with open(out_path, 'wb') as out:
        for p in poses:
            out.write(view(render_walker_pose(e, p['level'], p['x'], p['y'], p['f'])).tobytes())


def _stub_side_effects(e):
    for off in (0xC86, 0xB1D6, 0xB58):  # sound, redraw, delay
        install_cfunc(e, off, lambda e, ap: 0)


def cmd_moves(att_path, out_path):
    atts = json.load(open(att_path))
    e = W6()
    e.boot()
    _stub_side_effects(e)
    ev = []
    install_cfunc(e, 0x11090, lambda e, ap: ev.append(('death', e.r16(ap))) or 0)  # LAB_078E
    install_cfunc(e, 0x113A2, lambda e, ap: ev.append(('msg', e.r16(ap))) or 0)  # LAB_07A9
    res = []
    for a in atts:
        L = a['level']
        d = walker_level(L)
        W = d['cellSpace']['width']
        r = d['units'][0]['planes']['region'][a['y'] * W + a['x']]
        if e.cur_level != L:
            e.load_level(L)
        lb = e.r32(e.a4(-18462))
        ox, oy = d['origin']['x'], d['origin']['y']
        ax, ay = ox + a['x'], oy + a['y']
        e.set_pose(r, ax - e.r8(lb + 0x1E0 + r), ay - e.r8(lb + 0x1EC + r), a['f'])
        for k in range(4):
            e.w16(e.a4(-18146) + 2 * k, a.get('door', 0))
        e.w16(e.a4(-10896), 0)  # message suppression flag off
        e.w16(e.a4(-18136), 0)  # levitation off
        e.w16(e.a4(-18610), 5)  # game state: in the maze
        ev.clear()
        e.call(0x116AC, [a['rel']])
        nx, ny = e.r16(e.a4(-18338)), e.r16(e.a4(-18336))
        deaths = [m for k, m in ev if k == 'death']
        msgs = [m for k, m in ev if k == 'msg']
        if deaths:
            res.append({'kind': 'death', 'value': deaths[0]})
        elif (nx, ny) != (ax, ay):
            res.append({'kind': 'moved', 'value': f'{nx - ox},{ny - oy}'})
        elif msgs:
            res.append({'kind': MSG_KIND.get(msgs[0], 'msg'), 'value': msgs[0]})
        else:
            res.append({'kind': 'none', 'value': 0})
    json.dump(res, open(out_path, 'w'))


# Entity-kind handlers other than 1 (LAB_05D4) and 7 (LAB_05EA): messages,
# encounters, shops, ... -- no-ops here, so only position/door effects show.
# Every JSR target of the 26-way kind table at CODE+0xeb30 except kinds 1/7.
OTHER_KIND_HANDLERS = (0xB85A, 0xB99E, 0xBE58, 0xBE60, 0xBFF8, 0xC1DE, 0xC204, 0xC43C, 0xCAF0,
                       0xCE4A, 0xCF1C, 0xD294, 0xD7EE, 0xD90A, 0xDAE2, 0xDF76, 0xE06C, 0xE26E, 0xE3AC)


def cmd_arrive(cells_path, out_path):
    cells = json.load(open(cells_path))
    e = W6(trace_unknown_lvo=False)
    e.boot()
    e.uc.mem_write(e.a4(-30310), open(os.path.join(DATA, 'scenario.hdr'), 'rb').read()[:414])
    _stub_side_effects(e)
    for off in (0x1300, 0x11072, 0x10FB4) + OTHER_KIND_HANDLERS:  # text loops + other kinds
        install_cfunc(e, off, lambda e, ap: 0)
    install_cfunc(e, 0x11090, lambda e, ap: 0)
    install_cfunc(e, 0x113A2, lambda e, ap: 0)
    res = []
    for c in cells:
        L, x, y = c['level'], c['x'], c['y']
        d = walker_level(L)
        r = d['units'][0]['planes']['region'][y * d['cellSpace']['width'] + x]
        e.load_level(L)
        lb = e.r32(e.a4(-18462))
        ax, ay = d['origin']['x'] + x, d['origin']['y'] + y
        e.set_pose(r, ax - e.r8(lb + 0x1E0 + r), ay - e.r8(lb + 0x1EC + r), 0)
        e.call(0x103E8, [L], max_insn=20_000_000)  # LAB_073F: level entry (resets trigger state)
        e.set_pose(r, ax - e.r8(lb + 0x1E0 + r), ay - e.r8(lb + 0x1EC + r), 0)
        for k in range(4):
            e.w16(e.a4(-18146) + 2 * k, 0)
        e.w16(e.a4(-18610), 5)
        e.call(0xE9BE, [], max_insn=20_000_000)
        gl = e.r16(e.a4(-18340))
        dd = walker_level(gl)
        res.append({'level': gl, 'x': e.r16(e.a4(-18338)) - dd['origin']['x'],
                    'y': e.r16(e.a4(-18336)) - dd['origin']['y'],
                    'doorState': [e.r16(e.a4(-18146) + 2 * k) for k in range(4)]})
        e.cur_level = None  # the dispatch may have changed level
    json.dump(res, open(out_path, 'w'))


if __name__ == '__main__':
    cmd = {'frames': cmd_frames, 'moves': cmd_moves, 'arrive': cmd_arrive}.get(sys.argv[1] if len(sys.argv) > 1 else '')
    if not cmd or len(sys.argv) != 4:
        sys.exit(__doc__)
    cmd(sys.argv[2], sys.argv[3])

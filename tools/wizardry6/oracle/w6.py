"""Wizardry 6 game-state setup on top of emu.Emu: loads maze records the way
newgame.dbs does (14 sec2/sec3 record pairs into -18454/-18398 caches),
mazedata.ega via the game's own loader (LAB_0268, CODE+0x3c56), a 320x200x4
drawing BitMap (LAB_01E0) and graphics.library stubs."""
import struct, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from emu import *

ASSETS = os.path.join(REPO, 'public', 'assets', 'wizardry6', 'amiga')
G_MAZEBUF = 0x1690   # LAB_00D2  mazedata.ega buffer ptr
G_SCREEN  = 0x169c   # LAB_00D3  drawing bitmap plane-0 ptr
G_COMPOSE = 0x1732   # LAB_00E1  compose list ptr
G_SCRPTR  = 0x189a   # Screen *  (LAB_00E9+2)
G_GFXBASE = 0x189e   # GfxBase   (LAB_00EA+2)
BM_DRAW   = 0x303a   # LAB_01E0 struct BitMap

class W6(Emu):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.files = {}
        self.fds = {}
        self.open_log = []
        self.present_log = []
        install_cfunc(self, 0x555ea, self._alloc)     # alloc(u16 size)
        install_cfunc(self, 0x54f86, self._read)      # read(fd, buf, n)
        # present: copy view rect to screen via custom blitter -> capture instead
        install_cfunc(self, 0x40d0, self._present)
        install_cfunc(self, 0x54e40, self._open)      # open(path, mode)
        install_cfunc(self, 0x5585c, lambda e, ap: 0)  # close(fd)
        install_cfunc(self, 0x54db0, self._seek)      # lseek(fd, off, whence)
        install_cfunc(self, 0x25a6, lambda e, ap: 0)   # busy/timer helper (exec msgport), no-op
        gfx = self.add_lib('graphics')
        self.w32(self.code(G_GFXBASE), gfx)
        self.on_lvo('graphics', -30, self._bltbitmap)
        self.on_lvo('graphics', -228, lambda e: 0)
        self.on_lvo('graphics', -390, self._initbitmap)
        # LAB_0115 (CODE+0x1c52): AllocMem every {size, flags, ptr} entry of the
        # CODE+0x1688 table (mazedata buf, screen, PIC slots, cel work buffer, ...)
        o = self.code(0x1688)
        while self.r32(o):
            self.w32(o + 8, self.alloc(self.r32(o)))
            o += 12
        # drawing bitmap (CODE+0x1a5c-0x1a8c: InitBitMap + 4 planes 0x2000 apart)
        self.screen = self.r32(self.code(G_SCREEN))
        bm = self.code(BM_DRAW)
        self.w16(bm, 40); self.w16(bm + 2, 200); self.w8(bm + 4, 0); self.w8(bm + 5, 4)
        for i in range(4): self.w32(bm + 8 + 4 * i, self.screen + i * 0x2000)
        # fake Screen (only BitMap at +184 matters to present, which we capture)
        scr = self.alloc(512); self.w32(self.code(G_SCRPTR), scr)

    def _alloc(self, e, ap):
        n = self.r16(ap)
        return self.alloc(n if n else 1)

    def _read(self, e, ap):
        fd = self.r16(ap); buf = self.r32(ap + 2); n = self.r16(ap + 6)
        data, pos = self.fds[fd]
        chunk = data[pos:pos + n]
        self.uc.mem_write(buf, chunk)
        self.fds[fd] = (data, pos + len(chunk))
        return len(chunk)

    def _open(self, e, ap):
        p = self.r32(ap); name = b''
        while True:
            c = self.r8(p)
            if not c: break
            name += bytes([c]); p += 1
        base = name.decode('latin1').split(':')[-1].split('/')[-1]
        for f in os.listdir(DATA):
            if f.lower() == base.lower():
                self.open_log.append(base)
                return self.open_fd(os.path.join(DATA, f))
        self.open_log.append('MISSING ' + base)
        return 0xffff

    def _seek(self, e, ap):
        fd = self.r16(ap); off = self.r32(ap + 2); wh = self.r16(ap + 6)
        data, pos = self.fds[fd]
        npos = off if wh == 0 else (pos + off if wh == 1 else len(data) + off)
        self.fds[fd] = (data, npos)
        return pos

    def _present(self, e, ap):
        rect = bytes(self.uc.mem_read(self.r32(ap), 4))
        self.present_log.append(rect)
        self.frames.append(self.snapshot())
        return 0

    def _initbitmap(self, e):
        a0 = self.reg(UC_M68K_REG_A0); d0 = self.reg(UC_M68K_REG_D0)
        d1 = self.reg(UC_M68K_REG_D1); d2 = self.reg(UC_M68K_REG_D2)
        self.w16(a0, ((d1 + 15) >> 4) * 2); self.w16(a0 + 2, d2); self.w8(a0 + 4, 0); self.w8(a0 + 5, d0)
        return 0

    def _bltbitmap(self, e):
        r = lambda x: self.reg(x)
        sbm, dbm = r(UC_M68K_REG_A0), r(UC_M68K_REG_A1)
        sx, sy = r(UC_M68K_REG_D0) & 0xffff, r(UC_M68K_REG_D1) & 0xffff
        dx, dy = r(UC_M68K_REG_D2) & 0xffff, r(UC_M68K_REG_D3) & 0xffff
        w, h = r(UC_M68K_REG_D4) & 0xffff, r(UC_M68K_REG_D5) & 0xffff
        mint, mask = r(UC_M68K_REG_D6) & 0xff, r(UC_M68K_REG_D7) & 0xff
        self.blt_log.append((sbm, sx, sy, dbm, dx, dy, w, h, mint, mask))
        bpr = self.r16(dbm); depth = self.r8(dbm + 5)
        sbpr = self.r16(sbm)
        for p in range(depth):
            if not (mask >> p) & 1: continue
            dpl = self.r32(dbm + 8 + 4 * p); spl = self.r32(sbm + 8 + 4 * p)
            for y in range(h):
                drow = bytearray(self.uc.mem_read(dpl + (dy + y) * bpr, bpr))
                srow = bytes(self.uc.mem_read(spl + (sy + y) * sbpr, sbpr))
                for x in range(w):
                    X = dx + x; S = sx + x
                    sb = (srow[S >> 3] >> (7 - (S & 7))) & 1
                    db = (drow[X >> 3] >> (7 - (X & 7))) & 1
                    if mint == 0x00: v = 0
                    elif mint == 0xC0: v = sb
                    elif mint == 0x30: v = 1 - sb
                    elif mint == 0xF0: v = 1
                    elif mint == 0x50: v = 1 - db
                    else: raise RuntimeError(f'minterm {mint:#x}')
                    if v: drow[X >> 3] |= 0x80 >> (X & 7)
                    else: drow[X >> 3] &= ~(0x80 >> (X & 7)) & 0xff
                self.uc.mem_write(dpl + (dy + y) * bpr, bytes(drow))
        return 0

    def snapshot(self):
        import numpy as np
        out = np.zeros(64000, np.uint8)
        for i in range(4):
            pl = np.frombuffer(bytes(self.uc.mem_read(self.screen + i * 0x2000, 8000)), np.uint8)
            out |= (np.unpackbits(pl) << i).astype(np.uint8)
        return out.tobytes()

    # ---------------------------------------------------------------
    def open_fd(self, path):
        fd = len(self.fds) + 5
        self.fds[fd] = (open(path, 'rb').read(), 0)
        return fd

    def boot(self):
        self.frames = []; self.blt_log = []
        # mazedata.ega through the game's loader LAB_0268 (CODE+0x3c56)
        self.mazebuf = self.r32(self.code(G_MAZEBUF))
        fd = self.open_fd(f'{DATA}/mazedata.ega')
        self.call(0x3c56, [fd])
        # maze caches as newgame.dbs fills them (CODE+0x70ee-0x71de)
        ng = open(f'{DATA}/newgame.dbs', 'rb').read()
        self.w16(self.a4(-29892), 1346); self.w16(self.a4(-29890), 1740)
        for L in range(14):
            o = 0x19e + L * 3086
            b2 = self.alloc(1346); self.uc.mem_write(b2, ng[o:o + 1346])
            b3 = self.alloc(1740); self.uc.mem_write(b3, ng[o + 1346:o + 3086])
            self.w32(self.a4(-18454) + 4 * L, b2)
            self.w32(self.a4(-18398) + 4 * L, b3)
        self.cur_level = None
        # MASTER.HDR -> -29896(A4) (66 B), DISK.HDR -> -29830(A4) (700 B): CODE+0x4b08..0x4b24
        self.uc.mem_write(self.a4(-29896), open(f'{DATA}/master.hdr', 'rb').read()[:66])
        self.uc.mem_write(self.a4(-29830), open(f'{DATA}/disk.hdr', 'rb').read()[:700])
        self.w16(self.a4(-30314), self.open_fd(f'{DATA}/scenario.dbs'))
        # PIC load-slot area (LAB_00DA)
        self.picbuf = self.r32(self.code(0x16f0))
        # startup resource-slot loads LAB_032B (CODE+0x5726): MON03->0, MON01->1, MON02->2, ...
        # (replicates LAB_032B's prefix CODE+0x5726-0x57b2; its tail loads fonts and is not needed)
        for i in range(10):
            self.w8(self.a4(-15096) + i, 0xff); self.w8(self.a4(-15086) + i, 0)
        for pic, slot in ((3, 0), (1, 1), (2, 2), (7, 3), (4, 7), (5, 8), (6, 9)):
            self.call(0x4580, [pic, slot])

    def load_level(self, level):
        """Mimics the dirty-flag-free part of LoadLevel: copy cache -> levelBuf."""
        if not self.r32(self.a4(-18462)):
            self.w32(self.a4(-18462), self.alloc(1346))
            self.w32(self.a4(-18458), self.alloc(1740))
        self.w16(self.a4(-18340), level)
        src = self.r32(self.a4(-18454) + 4 * level)
        self.uc.mem_write(self.r32(self.a4(-18462)), bytes(self.uc.mem_read(src, 1346)))
        src = self.r32(self.a4(-18398) + 4 * level)
        self.uc.mem_write(self.r32(self.a4(-18458)), bytes(self.uc.mem_read(src, 1740)))
        self.cur_level = level

    def set_pose(self, region, lx, ly, facing):
        self.w16(self.a4(-18334), lx); self.w16(self.a4(-18332), ly)
        self.w16(self.a4(-18330), region); self.w16(self.a4(-18328), facing)
        lb = self.r32(self.a4(-18462))
        self.w16(self.a4(-18338), self.r8(lb + 0x1e0 + region) + lx)
        self.w16(self.a4(-18336), self.r8(lb + 0x1ec + region) + ly)

def make_windows(e):
    e.w32(e.a4(-18502), e.call(0x13c, [9, 4, 0x16, 0xe, 2, 0xffff, 2, 0]))
    e.w32(e.a4(-18466), e.call(0x13c, [2, 0, 0x24, 3, 5, 0xffff, 2, 0]))



import json as _json
_LV = {}
def walker_level(level):
    if level not in _LV:
        _LV[level] = _json.load(open(os.path.join(ASSETS, 'dungeon', f'level{level:02d}.json')))
    return _LV[level]

def render_walker_pose(e, level, x, y, f):
    """Render the game's view (LAB_0554, CODE+0xa810) for a walker-coordinate pose."""
    d = walker_level(level)
    W = d['cellSpace']['width']
    r = d['units'][0]['planes']['region'][y * W + x]
    if r < 0: return None
    if e.cur_level != level: e.load_level(level)
    lb = e.r32(e.a4(-18462))
    ax, ay = d['origin']['x'] + x, d['origin']['y'] + y
    lx, ly = ax - e.r8(lb + 0x1e0 + r), ay - e.r8(lb + 0x1ec + r)
    assert 0 <= lx < 8 and 0 <= ly < 8, (level, x, y, r, lx, ly)
    e.set_pose(r, lx, ly, f)
    e.frames = []
    e.call(0xa810)
    return e.frames[-1]

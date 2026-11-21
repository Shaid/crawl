"""Crystal Dragon level file (decoded SF, 0xB4AE bytes): region table + grids.

Grid base pointer is level +0x313E (hunk 0 +0x2FF8: 0x6E8(A5) = 0x990(A5)+0x2DDE
with the level block copied from +0x360, loader 3D2E). At that address a word
holds (region_count-1); the 12-byte region records sit just BEFORE it, read
backward by hunk 0 +0xC1C6..+0xC1F8, and cell lookup is +0xC4FE:
   idx = ((y - y0) * W + (x - x0)) * 8 + off ; cell = base + idx
Ascending record layout: [off, H, W, y0, x0, id] (big-endian words, y0/x0 signed).
"""
import struct

BASE = 0x313E
LEVEL_SIZE = 0xB4AE


class Region:
    def __init__(self, off, h, w, y0, x0, rid, cells):
        self.off, self.h, self.w, self.y0, self.x0, self.id = off, h, w, y0, x0, rid
        self.cells = cells  # list of 8-byte records (h*w)

    def word0(self, x, y):
        return struct.unpack('>H', self.cells[y * self.w + x][:2])[0]


def regions(d: bytes):
    n = struct.unpack('>H', d[BASE:BASE + 2])[0] + 1
    out = []
    for k in range(1, n + 1):
        o = BASE - 12 * k
        off, h, w, y0, x0, rid = struct.unpack('>HHHhhH', d[o:o + 12])
        a = BASE + off
        cells = [d[a + 8 * i:a + 8 * i + 8] for i in range(h * w)]
        if h * w:
            out.append(Region(off, h, w, y0, x0, rid, cells))
    return out


def border_solid_fraction(cells, w, h):
    """Fraction of border cells whose type (word0 & 7) is 5 (wall) or 0 (void)."""
    def t(i):
        return struct.unpack('>H', cells[i][:2])[0] & 7
    b = [t(x) for x in range(w)] + [t((h - 1) * w + x) for x in range(w)]
    b += [t(y * w) for y in range(h)] + [t(y * w + w - 1) for y in range(h)]
    return sum(1 for v in b if v in (0, 5)) / len(b)

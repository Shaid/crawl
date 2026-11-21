"""Level region-table invariants over all 23 decoded levels. Skips without data."""
import os
from . import unsf, file_name, level_id
from .level import regions, BASE, LEVEL_SIZE

DATA = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'crystaldragon', 'amiga', 'data')


def levels():
    for lv in range(23):
        yield lv, unsf(open(os.path.join(DATA, file_name(level_id(lv))), 'rb').read())[0]


def tiles(rs, w_of=lambda r: r.w):
    sp = sorted((r.off, r.off + 8 * w_of(r) * r.h) for r in rs)
    return sp[0][0] == 2 and all(sp[i][1] == sp[i + 1][0] for i in range(len(sp) - 1)) \
        and BASE + sp[-1][1] <= LEVEL_SIZE


def test_regions_tile_grid_exactly():
    if not os.path.isdir(DATA):
        return
    n = 0
    for lv, d in levels():
        rs = regions(d)
        assert tiles(rs), lv
        # null control: a width off by one in any region breaks the tiling
        last = max(rs, key=lambda q: q.off)
        for r in rs:
            if r is last:
                continue  # nothing follows it, so only the end bound constrains it
            assert not tiles(rs, lambda q: q.w + (q is r)), (lv, r.id)
        n += len(rs)
    assert n == 83, n


if __name__ == '__main__':
    test_regions_tile_grid_exactly(); print('ok')

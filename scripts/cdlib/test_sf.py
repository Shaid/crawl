"""pytest: SF decoder over all shipped files + null controls. Skips without data."""
import os
import struct
try:
    import pytest
except ImportError:
    pytest = None
from . import unsf, SFError, file_name, level_id, iter_data_files

DATA = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'crystaldragon', 'amiga', 'data')
if pytest:
    pytestmark = pytest.mark.skipif(not os.path.isdir(DATA), reason='no Crystal Dragon data')


def sf_files():
    r = []
    for fid, n, p in iter_data_files(DATA):
        d = open(p, 'rb').read()
        if d[:2] == b'SF':
            r.append((fid, d))
    return r


def test_names():
    assert file_name(0xCC) == 'cc' and file_name(0x192) == '192' and file_name(0x5) == '05'
    assert level_id(0) == 0xCC and level_id(22) == 0x192


def test_all_sf_exact():
    fs = sf_files()
    assert len(fs) == 31
    for fid, d in fs:
        out, left = unsf(d)
        assert len(out) == struct.unpack('>I', d[2:6])[0] and left == 0


def test_level_sizes():
    for lv in range(23):
        d = open(os.path.join(DATA, file_name(level_id(lv))), 'rb').read()
        assert len(unsf(d)[0]) == 0xB4AE


def test_null_controls():
    fails = {'flip': 0, 'shift': 0, 'trunc': 0}
    for fid, d in sf_files():
        ref = unsf(d)[0]
        # flipped payload byte (middle): must error or change output
        m = bytearray(d); m[10 + (len(d) - 10) // 2] ^= 0x10
        try:
            ok = unsf(bytes(m))[0] != ref
        except SFError:
            ok = True
        # shifted start: drop one payload byte at the front (end is the anchor)
        s = d[:10] + d[11:]
        s = s[:6] + struct.pack('>I', len(s) - 10) + s[10:]
        try:
            ok2 = unsf(s)[0] != ref
        except SFError:
            ok2 = True
        # shifted start: extra byte at the end, where decoding starts
        t = d + b'\x5a'
        t = t[:6] + struct.pack('>I', len(t) - 10) + t[10:]
        try:
            ok3 = unsf(t)[0] != ref
        except SFError:
            ok3 = True
        fails['flip'] += not ok; fails['shift'] += not ok2; fails['trunc'] += not ok3
    assert fails['flip'] == 0 and fails['shift'] == 0 and fails['trunc'] == 0, fails


if __name__ == '__main__':
    if not os.path.isdir(DATA):
        print('skip: no data'); raise SystemExit(0)
    for f in (test_names, test_all_sf_exact, test_level_sizes, test_null_controls):
        f(); print('ok', f.__name__)

#!/usr/bin/env python3
"""Self-check for scripts/extract_bcdfbn_panels.py. Run: python3 scripts/verify_bcdfbn_panels.py
Skips (exit 0) without the Amiga data. Fails on any violated invariant."""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import levelfile
import extract_bcdfbn_panels as X

amiga = bclib.data_dir('blackcrypt', 'amiga')
ext = amiga.parent / 'extracted'
if not (amiga / 'bcdfb').exists() or not (ext / 'bcdft_decompressed.bin').exists():
    print('SKIP: no Black Crypt Amiga data')
    sys.exit(0)
s1 = (ext / 'bcdft_decompressed.bin').read_bytes()
s2 = (ext / 'bcdft_s2_data.bin').read_bytes()
raws = {L: (amiga / f'bcdf{X.LETTERS[L - 1]}').read_bytes() for L in range(1, 14)}

gate = levelfile.gate_table(s1)
with_panel = [L for L in range(1, 14) if gate[L - 1]]
assert with_panel == [2, 3, 4, 6, 9, 11], with_panel

# exact consumption + descriptor sanity; 6/6 panels, 0 on the other 7
n = 0
for L in range(1, 14):
    r = X.level_panel(raws[L], s1, s2, L)
    if L not in with_panel:
        assert r is None
        continue
    n += 1
    lay = r['layout']
    assert lay['sfx'] == lay['inset_pixels'] + gate[L - 1]
    assert lay['sfx'] + lay['sfx_bytes'] == len(raws[L])
    assert r['body'].shape == (72, 80) and r['body'].max() < 64
    for idx, mask in r['insets'].values():
        assert idx.max() < 64 and set(mask.flatten().tolist()) <= {0, 1} and mask.any()
    # palette: 64 EHB entries, every used index resolvable
    assert len(r['palette']) == 64 * 3
assert n == 6

# null control: a +/-1 shift in the gate (or the stream length word) must break consumption
for L in with_panel:
    for delta in (-1, 1):
        g = bytearray(s1)
        o = levelfile.S1_PANEL_GATE + 2 * (L - 1)
        struct.pack_into('>H', g, o, gate[L - 1] + delta)
        try:
            levelfile.tail_layout(raws[L], bytes(g), L)
        except ValueError:
            continue
        raise AssertionError(f'level {L}: gate{delta:+d} still consumed exactly (oracle cannot fail)')
    bad = bytearray(raws[L])
    struct.pack_into('>I', bad, 0, struct.unpack_from('>I', raws[L], 0)[0] + 1)
    try:
        levelfile.tail_layout(bytes(bad), s1, L)
    except ValueError:
        continue
    raise AssertionError(f'level {L}: stream-length +1 still consumed exactly')

# a descriptor span off by one must be rejected
r = X.level_panel(raws[3], s1, s2, 3)
try:
    X.check_descriptors(r['descs'], gate[2] + 1, 3)
except ValueError:
    pass
else:
    raise AssertionError('descriptor extent check cannot fail')

# oracle: DOS crypt.exe panel table (maps + inset screen positions) == Amiga descriptors
exe_path = bclib.data_dir('blackcrypt', 'dosvga') / 'crypt.exe'
if exe_path.exists():
    import inject_clipper_phase3 as I
    table = I.read_panel_table(exe_path.read_bytes())
    assert [m for m, _b, _i in table] == with_panel
    ok = tot = 0
    for m, _body, insets in table:
        for d, (_n, x, y) in zip(X.level_panel(raws[m], s1, s2, m)['descs'], insets):
            tot += 1
            ok += (d['x'], d['y']) == (x, y)
    assert ok == tot == 24, (ok, tot)
    print(f'DOS crypt.exe panel table: maps match, inset positions {ok}/{tot}')
else:
    print('(no DOS crypt.exe: position oracle skipped)')
print('OK: 6/6 panels consumed exactly, 0 on the other 7; null controls fail as required')

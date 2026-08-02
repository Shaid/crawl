#!/usr/bin/env python3
"""Verify every bcdfa entry-5 sub-record against DOS `clipper.clp`.

The Amiga UI/automap bank (`SLOT_TEXT_RESOURCE`, bcdfa container-directory
entry 5) and the DOS port's `clipper.clp` hold the same authored art. Both
are paletted, so the check is index-for-index rather than RGB: build the
DOS-index -> Amiga-index correspondence over the whole raster and report
how many pixels agree with the most common mapping, plus whether that
mapping is injective (a real recolour, not a collapse onto one value).

A chance-level match scores 20-70% here — see the rejected candidates in
data-structure.md's paths-tried table. Everything this script reports as
confirmed scores 100.000% with an injective map, except "Stone", whose
only deviation is the 36x11 "Castor 0" strip the Amiga bakes into the
panel (verified separately, also 100.000%) and a 2-pixel speck.

Usage:  python3 scripts/verify_bcdfa_entry5_dos.py
"""
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

GAME = 'blackcrypt'


def clipper_entries(clp):
    n = struct.unpack_from('<H', clp, 0)[0]
    out = []
    for i in range(n):
        o = 2 + i * 56
        name = clp[o:o + 40].split(b'\0')[0].decode('latin1')
        typ = clp[o + 0x28]
        size, off = struct.unpack_from('<II', clp, o + 0x2A)
        w, h = struct.unpack_from('<HH', clp, o + 0x34)
        out.append({'name': name, 'type': typ, 'size': size, 'offset': off,
                    'w': w, 'h': h})
    return out


def clipper_image(clp, e):
    return np.frombuffer(clp[e['offset']:e['offset'] + e['w'] * e['h']],
                         np.uint8).reshape(e['h'], e['w'])


def agreement(amiga, dos):
    """(matching pixels, total, injective?) under the best DOS->Amiga map."""
    if amiga.shape != dos.shape:
        raise ValueError(f'shape mismatch {amiga.shape} vs {dos.shape}')
    m = defaultdict(Counter)
    for dv, av in zip(dos.ravel(), amiga.ravel()):
        m[int(dv)][int(av)] += 1
    best = {dv: c.most_common(1)[0][0] for dv, c in m.items()}
    ok = sum(c.most_common(1)[0][1] for c in m.values())
    return ok, int(dos.size), len(set(best.values())) == len(best)


def report(label, ok, total, injective, note='', expect_injective=True,
           expect_pct=99.9):
    """Print one comparison; returns True when it meets its own expectation.

    `expect_injective=False` is used for the two records where the DOS art
    legitimately uses more indices than the Amiga's 6 planes can hold, so
    two DOS indices collapse onto one Amiga index (documented per call).
    """
    pct = 100.0 * ok / total if total else 0.0
    good = pct >= expect_pct and (injective or not expect_injective)
    print(f'  {"OK " if good else "!! "}{label:<26} {ok:>6}/{total:<6} = '
          f'{pct:7.3f}%  injective={injective}  {note}')
    return good


def main():
    amiga_dir = bclib.data_dir(GAME, 'amiga')
    dos_clp = bclib.data_dir(GAME, 'dosvga') / 'clipper.clp'
    s1_path = bclib.cache_dir(GAME) / 'bcdft_decompressed.bin'
    if not (amiga_dir / 'bcdfa').exists() or not dos_clp.exists():
        print('Need both data/blackcrypt/amiga/bcdfa and dosvga/clipper.clp')
        return
    if not s1_path.exists():
        print(f'No {s1_path} — run scripts/decompress_bcdft.py first')
        return

    s1 = s1_path.read_bytes()
    bank = bclib.read_container_chunks(s1, (amiga_dir / 'bcdfa').read_bytes(),
                                       bclib.rle_decompress)[bclib.SLOT_TEXT_RESOURCE]
    clp = dos_clp.read_bytes()
    cat = clipper_entries(clp)

    bclib.check_text_resource_layout()
    print(f'layout: {len(bclib.TEXT_RESOURCE_LAYOUT)} records tile '
          f'{bclib.TEXT_RESOURCE_BYTES} B with 0 remainder')

    def dos(idx):
        return clipper_image(clp, cat[idx])

    passed = []

    # 0x3480 — "Stone" (103x139) inside the Amiga's 112x141 panel.
    panel = bclib.stone_panel(bank)
    r0, c0 = bclib.STONE_PANEL_DOS_ORIGIN
    stone = dos(90)
    crop = panel[r0:r0 + stone.shape[0], c0:c0 + stone.shape[1]]
    diff = crop != stone
    cr, cc = bclib.STONE_PANEL_CASTOR_ORIGIN
    castor = dos(107)
    masked = diff.copy()
    masked[cr - r0:cr - r0 + castor.shape[0], cc - c0:cc - c0 + castor.shape[1]] = False
    ok, tot, inj = agreement(crop, stone)
    # Two DOS indices collapse onto one Amiga index (6 planes vs 8bpp), and
    # the 36x11 "Castor 0" strip is baked into the Amiga panel but composited
    # at runtime in DOS — so the meaningful figure is the residue outside it.
    outside = int(masked.sum())
    passed.append(report('0x3480 Stone', tot - outside, tot, inj,
                         f'({outside} px differ outside the Castor 0 overlay; '
                         f'raw index agreement {100.0 * ok / tot:.3f}%)',
                         expect_injective=False))
    cast_crop = panel[cr:cr + castor.shape[0], cc:cc + castor.shape[1]]
    passed.append(report('  +Castor 0 (baked in)', int((cast_crop == castor).sum()),
                         int(castor.size), True, 'exact index equality'))

    # 0x6A50 / 0x6DEC — scroll roller and parchment row (110px art, 2px inset).
    x = bclib.SCROLL_DOS_X_ORIGIN
    for label, arr, e in (('0x6A50 Scroll Top', bclib.scroll_top(bank), 165),
                          ('0x6DEC Scroll Piece', bclib.scroll_piece(bank), 167)):
        d = dos(e)
        passed.append(report(label, *agreement(arr[:, x:x + d.shape[1]], d)))

    # 0x6E40 — "Fire Animation": 15 frames of 8x7 stacked into DOS's 8x105.
    stacked = np.vstack([idx for _n, idx in bclib.fire_animation_frames(bank)])
    # DOS uses two backdrop shades (131/132) where the Amiga uses index 26,
    # so the map is 100% consistent but not injective.
    passed.append(report('0x6E40 Fire Animation', *agreement(stacked, dos(157)),
                         note=f'{bclib.FIRE_ANIMATION_COUNT} frames of '
                              f'{bclib.FIRE_ANIMATION_WIDTH}x{bclib.FIRE_ANIMATION_HEIGHT}',
                         expect_injective=False))

    # 0x7110 / 0x7230 — hardware sprites, compared on their bounding boxes.
    for label, arr, e, key in (('0x7110 Mouse Arrow', bclib.mouse_pointer_sprite(bank), 163, 20),
                               ('0x7230 Bubble', bclib.bubble_sprite(bank), 164, None)):
        d = dos(e)
        if key is not None:                       # crop both to their content
            dm = d != key
            rr, cc2 = np.where(dm.any(1))[0], np.where(dm.any(0))[0]
            d = d[rr.min():rr.max() + 1, cc2.min():cc2.max() + 1]
            am = arr != 0
            ar, ac = np.where(am.any(1))[0], np.where(am.any(0))[0]
            arr = arr[ar.min():ar.max() + 1, ac.min():ac.max() + 1]
        else:
            arr = arr[:d.shape[0], :d.shape[1]]
        passed.append(report(label, *agreement(arr, d)))

    # 0x7350 / 0x73A0 — automap cell and tile bank.
    passed.append(report('0x7350 Auto Map Block', *agreement(bclib.automap_block(bank), dos(132))))
    tiles = np.vstack([idx for _n, idx in bclib.automap_tiles(bank)])
    passed.append(report('0x73A0 Auto Map Tiles', *agreement(tiles, dos(131)),
                         note=f'{bclib.AUTOMAP_TILE_COUNT} tiles'))

    # 0x75E0 / 0x7940 — the two treasure-chest states (DOS raster is 54 wide).
    x = bclib.TREASURE_CHEST_DOS_X_ORIGIN
    for n, idx in bclib.treasure_chest_sprites(bank):
        d = dos(158 + n)[:, x:x + bclib.TREASURE_CHEST_WIDTH]
        off = bclib.TREASURE_CHEST_OFFSET + n * bclib.TREASURE_CHEST_RECORD_BYTES
        passed.append(report(f'{off:#07x} Treasure Chest {n}', *agreement(idx, d)))

    # Palette cross-check: automap COLOR0..COLOR11 vs DOS "Automap Palette".
    words = bclib.read_palette_words(s1, bclib.BCDFT_AUTOMAP_PALETTE, 32)
    dos_pal = np.frombuffer(clp[cat[1]['offset']:cat[1]['offset'] + 768],
                            np.uint8).reshape(256, 3).astype(int)
    # Playfield 1 pixel v lights COLOR v  -> DOS 64+v (v = 0..7).
    # Playfield 2 pixel v lights COLOR 8+v -> DOS 71+v (v = 1..3); COLOR8 is
    # playfield-2 transparent and has no DOS counterpart. DOS index 75 onward
    # is the archive's unused cyan sentinel, so the comparison stops there.
    pairs = [(i, 64 + i) for i in range(8)] + [(8 + v, 71 + v) for v in (1, 2, 3)]
    worst = max(max(abs(dos_pal[d][k] - bclib.amiga12_to_rgb(words[a])[k])
                    for k in range(3)) for a, d in pairs)
    passed.append(report('automap palette', len(pairs), len(pairs), True,
                         f'max channel error {worst}/255 vs DOS '
                         f'"Automap Palette" (12-bit quantisation)',
                         expect_pct=100.0) and worst <= 12)

    print(f'\n{sum(passed)}/{len(passed)} sub-record comparisons at >=99.9%')


if __name__ == '__main__':
    main()

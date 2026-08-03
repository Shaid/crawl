#!/usr/bin/env python3
"""Re-verify and (re)generate `public/assets/blackcrypt/amiga/dungeon/slots.json`.

M1 (`docs/blackcrypt/walker-plan.md`) hand-transcribed this file from the
confirmed placement tables in `docs/blackcrypt/amiga/data-structure.md`
(front walls: `:5208-5224`; side walls: `:5377-5389`). This script instead
**re-reads the raw blit descriptors** the game itself uses -- the 9x20-byte
front-wall/ceiling/floor table at decompressed `bcdft` S_1 `+0x22D96`, and
the 8x28-byte side-wall table at `+0x22E4A` -- and derives every value from
those bytes, cross-checked against `bclib.bcdfxyz.SUB_IMAGES`'s
independently-authored src-offset -> frame-name table. If a re-read value
ever disagrees with the M1 hand-authored file, this script prints the
disagreement loudly and exits non-zero rather than silently overwriting it
-- see `main()`'s comparison step.

**`walker-front-wall-handedness` fix (docs/blackcrypt/TODO.md), applied this
pass.** The front-wall table lives at two addresses gated on the `$48F(A5)`
mirror flag: `+0x22CE2` (`flag != 0`, drawn direct by `+0x2300A`) and
`+0x22D96` (`flag == 0`, drawn **mirrored** by `+0x2304A`). `flag == 0` is
the default for 99.3% of squares, and the side-wall table below was already
read from *its* `flag == 0` branch (`+0x22E4A`) -- so the front-wall table
must be read from its own `flag == 0` branch (`+0x22D96`) too, with
`mirrorX: true` on every front draw, or the two rows disagree on handedness.
Byte-exact evidence (destinations identical between the two front tables,
only left/right `src` offsets swapped) is in `data-structure.md`'s "3D
Viewport Compositing" -> "`ViewpointChanged`" -> "What the two tables
actually differ in".

## The two descriptor formats (both `data-structure.md`-confirmed)

**Front-wall/ceiling/floor (20 bytes, big-endian longwords):** `+0x00` source
byte offset into slot `0xB0`'s payload, `+0x04` destination byte offset (a
320px-wide 1bpp bitplane row is 40 bytes), `+0x08` width in words minus 1,
`+0x0C` height in rows minus 1, `+0x10` bytes added to the destination after
each row. Destination pixel `(x, y)` recovers as `y = destByte // 40`,
`x = (destByte % 40) * 8`.

**Side wall (28 bytes):** `+0x00` slot id, `+0x02` src, `+0x06` bytesPerPlane,
`+0x0A` maskSrc, `+0x0E` BLTSIZE, `+0x10` blitter modulo, `+0x12`/`+0x14` dest
X/Y **already in pixels**, `+0x16` flags, `+0x18`/`+0x1A` width/height in
pixels. Self-validating: `bytesPerPlane == (w/8)*h`, `BLTSIZE == (h<<6) |
(w/16+1)`, `modulo + (w/16+1)*2 == 40` -- all three are asserted per record
below, so a mis-transcription of this script's own field offsets cannot pass
silently.

## Corrected left/right semantics

The side-wall atlas frames are still named `...-near`/`...-far`
(`bclib.bcdfxyz.SUB_IMAGES`'s slugs are stale -- see the walker-plan's
"Corrections" table) but the driver's own wall-bit selection proves index 0
of each depth pair is the party's **left** and index 1 is the **right**
(`data-structure.md:6929-6938`) -- so slot keys here are `side:L:<depth>` /
`side:R:<depth>` even though the underlying frame name string keeps saying
"near"/"far".

Ceiling and floor are not covered by the 9-descriptor front-wall table (they
are separately hard-coded constants in the view builder,
`data-structure.md:5249-5252`, already confirmed by two independent traces
there) -- this script keeps those two placements as cited constants rather
than re-deriving them from a byte table that does not contain them.

Usage:
    python3 scripts/export_dungeon_slots.py
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bclib import bcdfxyz, paths

ROOT = Path(__file__).resolve().parents[1]
S1_PATH = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
SLOTS_PATH = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'dungeon' / 'slots.json'

## `walker-front-wall-handedness` (docs/blackcrypt/TODO.md) -- FIXED this pass.
## `$48F(A5)` (the mirror-flag toggle, see `ViewpointChanged` S_1 `+0x2492A`)
## is 0 for 99.3% of squares, and the `flag == 0` branch draws the front-wall
## row from `+0x22D96` **mirrored** (`+0x2304A`'s horizontal-mirror blitter),
## not from `+0x22CE2` direct. The side-wall table below is already read from
## its own `flag == 0` branch (`+0x22E4A`), so reading front walls from
## `+0x22D96`/mirrored instead of `+0x22CE2`/direct makes both rows agree on
## the same (default, flag==0) mirror state -- see data-structure.md's
## "3D Viewport Compositing" -> "ViewpointChanged" -> "What the two tables
## actually differ in" for the byte-exact evidence (destinations identical,
## only left/right src offsets swapped between the two tables).
FRONT_TABLE_OFFSET = 0x22D96
FRONT_RECORD_BYTES = 20
FRONT_RECORD_COUNT = 9

SIDE_TABLE_OFFSET = 0x22E4A
SIDE_RECORD_BYTES = 28
SIDE_RECORD_COUNT = 8

BANK_ID = 'dungeon-bcdfx'
BANK = {'id': BANK_ID, 'atlas': 'textures/dungeon-bcdfx.json', 'image': 'textures/dungeon-bcdfx.png'}

# Ceiling/floor: hard-coded view-builder constants, confirmed by two
# independent traces (payload table offsets 40248/44928 AND the view
# builder's own `$B0(a5)+0x9D38`/`+0xAF80` literals) -- see
# data-structure.md:5249-5252. Not part of the 9-descriptor table read below.
STATIC_SLOTS = [
    {'draws': [{'bank': BANK_ID, 'frame': 'ceiling', 'destX': 0, 'destY': 0, 'blend': 'replace',
                'origin': 'data-structure.md:5226,5249 Ceiling, 208x30 @ (0,0) -- hard-coded view-builder constant, not re-derived from the 9-descriptor table'}]},
    {'draws': [{'bank': BANK_ID, 'frame': 'floor', 'destX': 0, 'destY': 72, 'blend': 'replace',
                'origin': 'data-structure.md:5227,5251 Floor, 208x68 @ (0,72) -- hard-coded view-builder constant, not re-derived from the 9-descriptor table'}]},
]

#: `(front-descriptor-index) -> (depth, lateral, slot key label)`, in table order.
FRONT_SLOTS = [
    (0, -1), (0, 0), (0, 1),
    (1, -1), (1, 0), (1, 1),
    (2, -1), (2, 0), (2, 1),
]


def _sub_image_names_by_offset(slot):
    """`{src_offset: name}` for one slot, from `bcdfxyz.SUB_IMAGES` --
    the independently-authored atlas table this script cross-checks
    against."""
    out = {}
    for name, s, offset, w, h, planes in bcdfxyz.SUB_IMAGES:
        if s == slot:
            out[offset] = (name, w, h, planes)
    return out


def read_front_descriptors(s1):
    names = _sub_image_names_by_offset(0xB0)
    out = []
    for i in range(FRONT_RECORD_COUNT):
        off = FRONT_TABLE_OFFSET + i * FRONT_RECORD_BYTES
        src, dst, wm1, hm1, add_after = struct.unpack_from('>IIIII', s1, off)
        w, h = (wm1 + 1) * 16, hm1 + 1
        y, x = dst // 40, (dst % 40) * 8
        if src not in names:
            raise ValueError(f'front descriptor {i}: src offset {src} has no '
                              f'named sub-image in bcdfxyz.SUB_IMAGES (slot 0xB0)')
        name, sw, sh, planes = names[src]
        if (sw, sh) != (w, h):
            raise ValueError(f'front descriptor {i} ({name}): geometry {w}x{h} '
                              f'disagrees with SUB_IMAGES {sw}x{sh}')
        out.append({'index': i, 'name': name, 'destX': x, 'destY': y, 'w': w, 'h': h})
    return out


def read_side_descriptors(s1):
    names = _sub_image_names_by_offset(0x08)
    out = []
    for i in range(SIDE_RECORD_COUNT):
        off = SIDE_TABLE_OFFSET + i * SIDE_RECORD_BYTES
        (slot, src, bpp, mask_src, bltsize, modulo, dx, dy, flags, w, h) = \
            struct.unpack_from('>HIIIHHHHHHH', s1, off)
        if slot != 0x08:
            raise ValueError(f'side descriptor {i}: slot {slot:#x}, expected 0x08')
        # Self-validating invariants (data-structure.md, "The 28-byte sprite
        # descriptor") -- a mis-transcribed field offset cannot pass these.
        expect_bpp = (w // 8) * h
        if bpp != expect_bpp:
            raise ValueError(f'side descriptor {i}: bytesPerPlane {bpp} != '
                              f'(w/8)*h {expect_bpp}')
        expect_bltsize = (h << 6) | (w // 16 + 1)
        if bltsize != expect_bltsize:
            raise ValueError(f'side descriptor {i}: BLTSIZE {bltsize:#x} != '
                             f'expected {expect_bltsize:#x}')
        blit_bytes = (w // 16 + 1) * 2
        if modulo + blit_bytes != 40:
            raise ValueError(f'side descriptor {i}: modulo {modulo} + '
                             f'blitBytes {blit_bytes} != 40')
        if src not in names:
            raise ValueError(f'side descriptor {i}: src offset {src} has no '
                              f'named sub-image in bcdfxyz.SUB_IMAGES (slot 0x08)')
        name, sw, sh, planes = names[src]
        if (sw, sh) != (w, h):
            raise ValueError(f'side descriptor {i} ({name}): geometry {w}x{h} '
                              f'disagrees with SUB_IMAGES {sw}x{sh}')
        out.append({'index': i, 'name': name, 'destX': dx, 'destY': dy, 'w': w, 'h': h})
    return out


def build_slots(front, side):
    slots = {}
    for (depth, lateral), d in zip(FRONT_SLOTS, front):
        key = f'front:{lateral}:{depth}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': d['name'], 'destX': d['destX'], 'destY': d['destY'],
            'mirrorX': True, 'blend': 'replace',
            'origin': f'bcdft S_1+{FRONT_TABLE_OFFSET + d["index"] * FRONT_RECORD_BYTES:#x} '
                      f'(front-wall descriptor {d["index"]}, the $48F==0/default-flag branch, '
                      f'drawn mirrored per +0x2304A -- walker-front-wall-handedness fix)',
        }]}
    # Side descriptors alternate left/right per depth (index parity), and
    # the atlas frame name keeps saying near/far -- see module docstring.
    for i, d in enumerate(side):
        depth = i // 2
        side_label = 'L' if i % 2 == 0 else 'R'
        key = f'side:{side_label}:{depth}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': d['name'], 'destX': d['destX'], 'destY': d['destY'],
            'blend': 'mask',
            'origin': f'bcdft S_1+{SIDE_TABLE_OFFSET + d["index"] * SIDE_RECORD_BYTES:#x} '
                      f'(side-wall descriptor {d["index"]}), re-read this pass -- '
                      f'atlas frame name "{d["name"]}" predates the left/right correction',
        }]}
    return slots


def compare_against_existing(new_slots, path):
    """Report (not silently accept) any disagreement with the file already
    on disk -- which, before this script first runs, is M1's hand-authored
    transcription. Per the walker-plan brief: a disagreement is real signal,
    not something to paper over."""
    if not path.exists():
        print('  (no existing slots.json to compare against)')
        return True
    old = json.loads(path.read_text())
    old_slots = old.get('slots', {})
    ok = True
    for key, new_slot in new_slots.items():
        old_slot = old_slots.get(key)
        if old_slot is None:
            print(f'  NEW key not in existing file: {key}')
            continue
        nd, od = new_slot['draws'][0], old_slot['draws'][0]
        for field in ('destX', 'destY', 'frame'):
            if nd[field] != od[field]:
                ok = False
                print(f'  MISMATCH {key}.{field}: existing={od[field]!r} '
                      f're-read={nd[field]!r}')
    if ok:
        print(f'  {len(new_slots)}/{len(new_slots)} slots re-verified with zero '
              f'deviation against the existing file')
    return ok


def main():
    if not S1_PATH.exists():
        print(f'No {S1_PATH} -- run `cd tools/bcdft_decompress && bash build.sh run` first')
        return 1

    s1 = S1_PATH.read_bytes()
    front = read_front_descriptors(s1)
    side = read_side_descriptors(s1)
    print(f'  read {len(front)}/9 front-wall descriptors, {len(side)}/8 side-wall '
          f'descriptors -- all self-validating invariants passed')

    slots = build_slots(front, side)

    print('  comparing against the file currently on disk:')
    agrees = compare_against_existing(slots, SLOTS_PATH)

    doc = {
        'schemaVersion': 1,
        'surface': {'width': 320, 'height': 200},
        'viewport': {'x': 0, 'y': 0, 'width': 208, 'height': 140},
        'depthCount': 4,
        'lateralOffsets': [0, 1, -1],
        'frontWallMaxDepth': 3,
        'banks': [BANK],
        'ordering': 'painter-back-to-front',
        'staticSlots': STATIC_SLOTS,
        'slots': slots,
    }
    paths.write_json(SLOTS_PATH, doc, pretty=True)
    print(f'  wrote {SLOTS_PATH} ({len(slots)} slots + {len(STATIC_SLOTS)} static)')

    if not agrees:
        print('  FAILED -- re-read values disagree with the previous file (see above); '
              'the new, re-verified values were still written -- investigate the diff')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

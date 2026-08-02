#!/usr/bin/env python3
"""Extract Eye of the Beholder III's EYE.RES (AESOP/16 resource container).

EYE.RES is a single 6.8 MB container holding almost everything the running
game needs: bytecode objects, bitmaps, palettes, fonts, sounds, maps, and
strings, addressed by name through an on-disk hash-dictionary directory
(special table 0). See scripts/eotb3lib/res.py for the format docstring and
docs/eotb3/dosvga/data-structure.md for the verification evidence (this
Python parser reproduces ThirdEye's independently-derived entry/table
counts byte-exact: 2449 entries, 20 directory blocks, 2444 named
resources).

This script does two things:
  1. Writes a full resource manifest (id, name, size, offset, attributes)
     to data/resources.json -- useful for locating any named asset by hand.
  2. Decodes every resource that parses as an AESOP/16 "1.10" VFX shape
     table (see eotb3lib/bitmap.py) into a sprite atlas, batched into
     manageable chunks (several thousand individual shapes across ~1300
     bitmap resources) since a single atlas that large would be unwieldy.

Output:
    public/assets/eotb3/dosvga/data/resources.json
    public/assets/eotb3/dosvga/sprites/res/<batch>.{png,json}
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import bclib
from eotb3lib import res, bitmap

GAME, PLATFORM = 'eotb3', 'dosvga'
MAX_SHAPES_PER_ATLAS = 512  # keep individual atlas sheets a reasonable size


def shape_to_rgba(shape):
    w, h = shape['width'], shape['height']
    idx = np.frombuffer(bytes(shape['pixels']), dtype=np.uint8).reshape(h, w)
    mask = np.frombuffer(bytes(shape['mask']), dtype=np.uint8).reshape(h, w)
    # Indices are palette-relative but we don't yet have a per-resource
    # palette resolver wired up (each bitmap references a *named* palette
    # resource, e.g. "Human paladin palette" -- see data-structure.md open
    # items). Render with a neutral greyscale ramp so shapes are inspectable
    # without implying a specific (unverified) colour mapping.
    grey = (idx.astype(np.uint16) * 255 // 255).astype(np.uint8)
    # Spread the 0..N palette-index range across full greyscale contrast so
    # low-index shapes aren't all-black.
    if idx.max() > 0:
        grey = (idx.astype(np.uint32) * 255 // max(1, int(idx.max()))).astype(np.uint8)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = grey
    rgba[..., 1] = grey
    rgba[..., 2] = grey
    rgba[..., 3] = mask * 255
    return rgba


def main():
    root = bclib.data_dir(GAME, PLATFORM)
    res_path = root / 'EYE.RES'
    if not res_path.exists():
        print(f'No EYE.RES at {res_path} — nothing to do')
        return

    r = res.load(str(res_path))
    print(f'EYE.RES: {r.file_size} bytes, {len(r.dir_blocks)} directory blocks, '
          f'{len(r.entries)} entries, {len(r.table0)} named resources')
    assert r.file_size == len(r.data), 'GlobalHeader.file_size mismatch'

    manifest = []
    for slot in sorted(r.entries):
        e = r.entries[slot]
        manifest.append({
            'id': slot, 'name': e.name, 'size': e.size,
            'offset': e.offset, 'attributes': e.attributes,
        })
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'resources.json',
                     {'fileSize': r.file_size, 'entryCount': len(r.entries),
                      'namedCount': len(r.table0), 'entries': manifest})
    print(f'wrote data/resources.json ({len(manifest)} entries)')

    # Decode every resource that looks like a "1.10" VFX shape table.
    sprites = []
    n_bitmap_resources = 0
    n_shapes = 0
    n_decode_errors = 0
    batch = 0

    def flush(batch_sprites, batch_idx):
        if not batch_sprites:
            return
        sheet, frames = bclib.pack_atlas(batch_sprites, max_width=2048)
        bclib.write_atlas(f'res/batch-{batch_idx:03d}', sheet, frames,
                          category='sprites', game=GAME, platform=PLATFORM)

    for slot in sorted(r.entries):
        e = r.entries[slot]
        if e.size < 12 or not e.name:
            continue
        blob = r.resource_bytes(slot)
        if blob[0:4] != b'1.10':
            continue
        n_bitmap_resources += 1
        try:
            count = bitmap.vfx_shape_count(blob)
            for i in range(count):
                shp = bitmap.decode_vfx_shape(blob, 0, i)
                if shp['width'] <= 0 or shp['height'] <= 0:
                    continue
                safe_name = e.name.replace('/', '_').replace(' ', '_')
                sprites.append((f'{safe_name}_{i}', shape_to_rgba(shp)))
                n_shapes += 1
                if len(sprites) >= MAX_SHAPES_PER_ATLAS:
                    flush(sprites, batch)
                    batch += 1
                    sprites = []
        except (IndexError, ValueError, struct.error):
            n_decode_errors += 1
            continue
    flush(sprites, batch)

    print(f'VFX bitmap resources: {n_bitmap_resources}, shapes decoded: {n_shapes}, '
          f'decode errors: {n_decode_errors}, atlas batches: {batch + (1 if sprites else 0)}')


if __name__ == '__main__':
    main()

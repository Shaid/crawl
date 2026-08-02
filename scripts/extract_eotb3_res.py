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

This script:
  1. Classifies every entry structurally (scripts/eotb3lib/classify.py) and
     writes the full manifest (id, name, size, offset, attributes, type)
     to data/resources.json.
  2. Decodes every "1.10" VFX shape table resource into a sprite atlas,
     batched into manageable chunks. Where the bitmap's own pixel-index
     range resolves to a specific named palette (see
     scripts/eotb3lib/palette_regions.py), renders it in real colour;
     otherwise falls back to a neutral greyscale ramp so shapes stay
     inspectable without implying an unverified colour mapping. Per-resource
     resolution tier is recorded in data/eotb3-bitmap-palette-resolution.json.
  3. Extracts every `pcm_sound`-classified resource as a WAV file (8-bit
     unsigned mono @ 8000 Hz, confirmed against ThirdEye's sound.cpp).
  4. Extracts every `map32x32`-classified resource (dungeon level wall-type
     grids) as raw JSON grids plus a rendered floor/wall contact atlas.
  5. Extracts every `string`-classified resource ("S:<text>\\0") into a
     flat name->text JSON table.

Output:
    public/assets/eotb3/dosvga/data/resources.json
    public/assets/eotb3/dosvga/sprites/res/<batch>.{png,json}
    public/assets/eotb3/dosvga/data/eotb3-bitmap-palette-resolution.json
    public/assets/eotb3/dosvga/audio/<name>.wav
    public/assets/eotb3/dosvga/data/eotb3-sounds.json
    public/assets/eotb3/dosvga/data/eotb3-maps.json
    public/assets/eotb3/dosvga/textures/maps.{png,json}
    public/assets/eotb3/dosvga/data/eotb3-strings.json
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import bclib
from eotb3lib import res, bitmap, palette, classify, palette_regions

GAME, PLATFORM = 'eotb3', 'dosvga'
MAX_SHAPES_PER_ATLAS = 512  # keep individual atlas sheets a reasonable size


def safe_asset_name(name):
    return name.replace('/', '_').replace(' ', '_')


def resolved_rgba(shape, base_palette, overlay_rgb, overlay_base, overlay_width):
    w, h = shape['width'], shape['height']
    idx = np.frombuffer(bytes(shape['pixels']), dtype=np.uint8).reshape(h, w)
    mask = np.frombuffer(bytes(shape['mask']), dtype=np.uint8).reshape(h, w)
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i, c in enumerate(base_palette):
        lut[i] = (c['r'], c['g'], c['b'])
    if overlay_rgb is not None:
        for i, c in enumerate(overlay_rgb):
            lut[overlay_base + i] = (c['r'], c['g'], c['b'])
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = lut[idx]
    rgba[..., 3] = mask * 255
    return rgba


def greyscale_rgba(shape):
    w, h = shape['width'], shape['height']
    idx = np.frombuffer(bytes(shape['pixels']), dtype=np.uint8).reshape(h, w)
    mask = np.frombuffer(bytes(shape['mask']), dtype=np.uint8).reshape(h, w)
    grey = idx.astype(np.uint32)
    if idx.max() > 0:
        grey = grey * 255 // max(1, int(idx.max()))
    grey = grey.astype(np.uint8)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = grey
    rgba[..., 1] = grey
    rgba[..., 2] = grey
    rgba[..., 3] = mask * 255
    return rgba


def extract_vfx_bitmaps(r, entries_by_type):
    """Decode every '1.10' bitmap resource, colour-resolving via the DAC
    region mechanism where possible (see eotb3lib/palette_regions.py)."""
    fixed_entry = r.find('Fixed palette')
    if fixed_entry is None:
        raise RuntimeError("EYE.RES has no 'Fixed palette' resource — can't colour-resolve bitmaps")
    base_palette = palette.load_resource_palette(r.resource_bytes(fixed_entry.slot))
    palette_index = palette_regions.build_palette_index(r)

    sprites = []
    resolution = []
    n_bitmap_resources = 0
    n_shapes = 0
    n_decode_errors = 0
    n_fixed_only = 0
    n_region_matched = 0
    n_unresolved = 0
    batch = 0

    def flush(batch_sprites, batch_idx):
        if not batch_sprites:
            return
        sheet, frames = bclib.pack_atlas(batch_sprites, max_width=2048)
        bclib.write_atlas(f'res/batch-{batch_idx:03d}', sheet, frames,
                          category='sprites', game=GAME, platform=PLATFORM)

    for slot in entries_by_type.get('vfx_bitmap', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        n_bitmap_resources += 1
        try:
            count = bitmap.vfx_shape_count(blob)
            shapes = []
            ok = True
            for i in range(count):
                shp = bitmap.decode_vfx_shape(blob, 0, i)
                if shp['width'] <= 0 or shp['height'] <= 0:
                    continue
                shapes.append(shp)
        except (IndexError, ValueError, struct.error):
            n_decode_errors += 1
            continue

        # Determine this resource's DAC region from its own pixel usage.
        used = [np.frombuffer(bytes(s['pixels']), dtype=np.uint8)[
                    np.frombuffer(bytes(s['mask']), dtype=np.uint8).astype(bool)]
                for s in shapes]
        used = [u for u in used if len(u)]
        tier = 'unresolved'
        overlay_rgb = None
        overlay_base = 0
        overlay_width = 0
        pal_entry = None
        if used:
            allused = np.concatenate(used)
            mn, mx = int(allused.min()), int(allused.max())
            region = palette_regions.classify_pixel_range(mn, mx)
            if region == 'fixed':
                tier = 'fixed'
                n_fixed_only += 1
            else:
                match = palette_regions.find_named_palette(e.name, region, palette_index)
                if match is not None:
                    pal_entry, num_colours = match
                    overlay_rgb = palette.load_resource_palette(r.resource_bytes(pal_entry.slot))
                    overlay_base, overlay_width = palette_regions.DAC_REGIONS[region]
                    tier = 'region-matched'
                    n_region_matched += 1
                else:
                    tier = 'unresolved'
                    n_unresolved += 1
            resolution.append({
                'id': slot, 'name': e.name, 'region': region, 'tier': tier,
                'pixelMin': mn, 'pixelMax': mx,
                'palette': (pal_entry.name if pal_entry is not None else None),
            })

        safe_name = safe_asset_name(e.name)
        for i, shp in enumerate(shapes):
            if tier in ('fixed', 'region-matched'):
                rgba = resolved_rgba(shp, base_palette, overlay_rgb, overlay_base, overlay_width)
            else:
                rgba = greyscale_rgba(shp)
            sprites.append((f'{safe_name}_{i}', rgba))
            n_shapes += 1
            if len(sprites) >= MAX_SHAPES_PER_ATLAS:
                flush(sprites, batch)
                batch += 1
                sprites = []
    flush(sprites, batch)

    bclib.write_json(
        bclib.asset_dir('data', GAME, PLATFORM) / 'eotb3-bitmap-palette-resolution.json',
        {
            'mechanism': (
                "AESOP runtime DAC palette regions: PAL_FIXED=0x00(176), "
                "PAL_WALLS=0xB0(16), PAL_M1=0xC0(32), PAL_M2=0xE0(32) -- see "
                "docs/eotb3/dosvga/data-structure.md Sec 4.2 and "
                "scripts/eotb3lib/palette_regions.py"),
            'totalBitmaps': n_bitmap_resources,
            'fixedOnly': n_fixed_only,
            'regionMatched': n_region_matched,
            'unresolved': n_unresolved,
            'entries': resolution,
        }, pretty=True)

    print(f'VFX bitmap resources: {n_bitmap_resources}, shapes decoded: {n_shapes}, '
          f'decode errors: {n_decode_errors}, atlas batches: {batch + (1 if sprites else 0)}')
    print(f'  palette resolution: {n_fixed_only} fixed-only, {n_region_matched} region-matched, '
          f'{n_unresolved} unresolved (of {n_bitmap_resources})')


def extract_sounds(r, entries_by_type):
    audio_dir = bclib.asset_dir('audio', GAME, PLATFORM)
    manifest = []
    for slot in entries_by_type.get('pcm_sound', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        safe = safe_asset_name(e.name or f'sound_{slot:04d}')
        bclib.write_wav(audio_dir / f'{safe}.wav', blob, sample_rate=8000,
                        sample_width=1, channels=1)
        manifest.append({'id': slot, 'name': e.name, 'bytes': e.size,
                         'file': f'audio/{safe}.wav'})
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'eotb3-sounds.json',
                     {'format': 'pcm_u8_mono_8000hz', 'count': len(manifest),
                      'samples': manifest}, pretty=True)
    print(f'  audio/*.wav: {len(manifest)} sound resources '
          f'(8-bit unsigned mono, 8000 Hz, per ThirdEye sound.cpp)')


def extract_maps(r, entries_by_type):
    levels = []
    tiles = []
    for slot in entries_by_type.get('map32x32', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        grid = list(blob)
        levels.append({'id': slot, 'name': e.name, 'width': 32, 'height': 32,
                       'grid': grid})
        arr = np.frombuffer(blob, dtype=np.uint8).reshape(32, 32)
        rgba = np.zeros((32, 32, 4), dtype=np.uint8)
        floor = arr == 0xFF
        rgba[floor] = (235, 205, 145, 255)   # parchment cream floor
        rgba[~floor] = (110, 110, 120, 255)  # grey wall
        tiles.append((safe_asset_name(e.name), rgba))

    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'eotb3-maps.json', {
        'note': ('32x32 dungeon-level wall-type grid, one byte per cell '
                 '(0xFF = floor, else wall/feature type -- matches ThirdEye '
                 'automap.cpp isMapWall()). Cell value semantics beyond '
                 'floor/not-floor not decoded this pass.'),
        'count': len(levels), 'levels': levels,
    }, pretty=True)

    if tiles:
        sheet, frames = bclib.pack_atlas(tiles, max_width=1024, padding=2)
        bclib.write_atlas('maps', sheet, frames, category='textures',
                          game=GAME, platform=PLATFORM)
    print(f'  data/eotb3-maps.json + textures/maps.png: {len(levels)} dungeon-level grids')


def extract_strings(r, entries_by_type):
    strings = {}
    for slot in entries_by_type.get('string', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        text = blob[2:-1].decode('latin-1')  # strip "S:" prefix + trailing NUL
        strings[e.name] = text
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'eotb3-strings.json',
                     {'count': len(strings), 'strings': strings}, pretty=True)
    print(f'  data/eotb3-strings.json: {len(strings)} strings')


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

    type_of = classify.classify_all(r)
    entries_by_type = {}
    for slot, t in type_of.items():
        entries_by_type.setdefault(t, []).append(slot)

    manifest = []
    for slot in sorted(r.entries):
        e = r.entries[slot]
        manifest.append({
            'id': slot, 'name': e.name, 'size': e.size,
            'offset': e.offset, 'attributes': e.attributes,
            'type': type_of.get(slot, 'empty'),
        })
    type_counts = {t: len(v) for t, v in sorted(entries_by_type.items())}
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / 'resources.json',
                     {'fileSize': r.file_size, 'entryCount': len(r.entries),
                      'namedCount': len(r.table0), 'typeCounts': type_counts,
                      'entries': manifest})
    print(f'wrote data/resources.json ({len(manifest)} entries); type counts: {type_counts}')

    extract_vfx_bitmaps(r, entries_by_type)
    extract_sounds(r, entries_by_type)
    extract_maps(r, entries_by_type)
    extract_strings(r, entries_by_type)


if __name__ == '__main__':
    main()

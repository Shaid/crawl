#!/usr/bin/env python3
"""Extract Dungeon Hack's HACK.RES + OPEN.RES (AESOP/16 resource containers).

Same container format as EOB3's EYE.RES -- byte-identical magic
("AESOP/16 V1.00\\0"), byte-exact GlobalHeader/DirectoryBlock/EntryHeader
layout, confirmed field-for-field against the real AESOP interpreter source
(John Miles' publicly-released AESOP_INTERPRETER_BUILD_2a, RTRES.H's
RF_file_hdr/RF_entry_hdr/OD_block structs). Reuses scripts/eotb3lib/res.py
unmodified. See docs/dungeonhack/dosvga/data-structure.md for the full
verification evidence.

HACK.RES (the game proper) and OPEN.RES (the intro/menu bank -- run via
`aesop open opening` per HACK.BAT) are structurally identical containers,
processed independently by this script.

This script:
  1. Classifies every entry (scripts/dungeonhacklib/classify.py) and writes
     the manifest to data/<container>-resources.json.
  2. Decodes every `old_format_bitmap` resource (see eotb3lib/bitmap.py +
     dungeonhacklib/oldbitmap.py) -- full-screen event art/backdrops go to
     screens/, everything else (door/wall/decoration sprites, wall-set LOD
     tile sets) is packed into sprite atlases. Colour-resolved via the
     "Fixed palette" DAC region where the resource's own pixel range
     confirms it; falls back to a neutral greyscale ramp otherwise (see
     dungeonhacklib/oldbitmap.py's docstring for the DAC region tally).
  3. Decodes every `resource_font` resource (see eotb3lib/font.py) into a
     glyph atlas, coloured via the Fixed palette.
  4. Decodes every `palette` resource into RGB JSON (26-byte PAL_HDR +
     RGB array; the 11 fade-level tables are not separately emitted here).
  5. Extracts every `pcm_sound` resource as a WAV (8-bit unsigned mono,
     8000 Hz -- inherited from EOB3/ThirdEye and the real interpreter
     source's own "Eye III sound samples at 8.000 kHz" comment
     (MODSND32.C); Dungeon Hack's own build isn't independently confirmed
     at this specific rate, see docs).
  6. Extracts every `string` resource ("S:<text>\\0") into a flat JSON map.

Output (per container, `hack`/`open`):
    public/assets/dungeonhack/dosvga/data/<container>-resources.json
    public/assets/dungeonhack/dosvga/screens/<container>-<name>.png
    public/assets/dungeonhack/dosvga/sprites/dh-<container>/batch-NNN.png
    public/assets/dungeonhack/dosvga/sprites/dh-<container>-font-<name>.png
    public/assets/dungeonhack/dosvga/palettes/<container>-<name>.json
    public/assets/dungeonhack/dosvga/audio/<container>-<name>.wav
    public/assets/dungeonhack/dosvga/data/<container>-strings.json
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import bclib
from eotb3lib import res, palette, font
from dungeonhacklib import classify, oldbitmap

GAME, PLATFORM = 'dungeonhack', 'dosvga'
MAX_SPRITES_PER_ATLAS = 400
CONTAINERS = [('HACK.RES', 'hack'), ('OPEN.RES', 'open')]


def safe_asset_name(name):
    return (name or '').replace('/', '_').replace(' ', '_').replace("'", '')


def extract_bitmaps(r, entries_by_type, stem, fixed_palette, palette_is_approx=False):
    sprites = []
    screens = 0
    region_tally = {}
    resolution = []
    batch = 0

    def flush():
        nonlocal sprites, batch
        if not sprites:
            return
        sheet, frames = bclib.pack_atlas(sprites, max_width=2048)
        bclib.write_atlas(f'dh-{stem}/batch-{batch:03d}', sheet, frames,
                          category='sprites', game=GAME, platform=PLATFORM)
        batch += 1
        sprites = []

    for slot in entries_by_type.get('old_format_bitmap', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        try:
            subs = oldbitmap.decode_subbitmaps(blob)
        except (struct.error, IndexError, ValueError):
            continue
        screen = oldbitmap.is_screen(subs)
        region_info = oldbitmap.classify_dac_region(subs)
        region = region_info['region']
        region_tally[region] = region_tally.get(region, 0) + 1
        resolution.append({'id': slot, 'name': e.name, 'region': region,
                           'pixelMin': region_info['min'], 'pixelMax': region_info['max']})
        safe_name = safe_asset_name(e.name or f'res_{slot:04d}')

        if screen:
            screens += 1
            for i, sub in enumerate(subs):
                if sub['width'] * sub['height'] != len(sub['pixels']):
                    continue
                if region == 'fixed':
                    rgba = oldbitmap.to_rgba(sub, fixed_palette, opaque=True)
                else:
                    rgba = oldbitmap.to_rgba_greyscale(sub, opaque=True)
                suffix = f'-{i:02d}' if len(subs) > 1 else ''
                bclib.write_png(
                    bclib.asset_dir('screens', GAME, PLATFORM) / f'{stem}-{safe_name}{suffix}.png',
                    rgba)
        else:
            for i, sub in enumerate(subs):
                if sub['width'] * sub['height'] != len(sub['pixels']):
                    continue
                if sub['width'] == 0 or sub['height'] == 0:
                    continue
                if region == 'fixed':
                    rgba = oldbitmap.to_rgba(sub, fixed_palette, opaque=False)
                else:
                    rgba = oldbitmap.to_rgba_greyscale(sub, opaque=False)
                sprites.append((f'{safe_name}_{i}', rgba))
                if len(sprites) >= MAX_SPRITES_PER_ATLAS:
                    flush()
    flush()

    bclib.write_json(
        bclib.asset_dir('data', GAME, PLATFORM) / f'{stem}-bitmap-regions.json',
        {'mechanism': (
            "Same runtime DAC-region mechanism as EOB3 (confirmed against "
            "the real AESOP interpreter source this pass, GRAPHICS.C's "
            "fade_tables[5]/first_color[5]/num_colors[5]), re-tuned for "
            "Dungeon Hack's own asset budget: fixed=1-224 (225 colours), "
            "sel=225-239 (14 colours, Sel-0..13), wall=240-255 (16 "
            "colours, wall/floor palette 00..20). Only 'fixed' is colour-"
            "resolved here (unambiguous single 'Fixed palette' resource); "
            "'sel'/'wall'/'mixed' render in neutral greyscale -- see "
            "docs/dungeonhack/dosvga/data-structure.md."),
         'fixedPaletteIsApproximate': palette_is_approx,
         'regionTally': region_tally, 'entries': resolution}, pretty=True)

    print(f'  {stem}: old_format_bitmap {len(resolution)} resources '
          f'({screens} screens, {len(resolution) - screens} sprite-like), '
          f'region tally {region_tally}')


def extract_fonts(r, entries_by_type, stem, fixed_palette):
    for slot in entries_by_type.get('resource_font', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        try:
            fnt = font.load_resource_font(blob)
        except (struct.error, IndexError, ValueError):
            continue
        sprites = []
        for idx, g in sorted(fnt['glyphs'].items()):
            w, h = g['width'], g['height']
            if w == 0 or h == 0 or w * h != len(g['pixels']):
                continue
            idxarr = np.frombuffer(bytes(g['pixels']), dtype=np.uint8).reshape(h, w)
            lut = np.zeros((256, 3), dtype=np.uint8)
            for i, c in enumerate(fixed_palette):
                lut[i] = (c['r'], c['g'], c['b'])
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            rgba[..., :3] = lut[idxarr]
            rgba[..., 3] = np.where(idxarr != 0, 255, 0).astype(np.uint8)
            label = chr(idx) if 32 <= idx < 127 else f'0x{idx:02x}'
            sprites.append((f'{idx:03d}_{label}', rgba))
        if not sprites:
            continue
        sheet, frames = bclib.pack_atlas(sprites, max_width=1024, padding=1)
        safe_name = safe_asset_name(e.name)
        bclib.write_atlas(f'dh-{stem}-font-{safe_name}', sheet, frames,
                          category='sprites', game=GAME, platform=PLATFORM)
        print(f'  {stem}: font "{e.name}" -> {len(sprites)} glyphs '
              f'(count={fnt["count"]}, rowHeight={fnt["row_height"]})')


def extract_palettes(r, entries_by_type, stem):
    pals = {}
    for slot in entries_by_type.get('palette', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        try:
            colours = palette.load_resource_palette(blob)
        except (struct.error, IndexError, ValueError):
            continue
        safe_name = safe_asset_name(e.name)
        bclib.write_json(
            bclib.asset_dir('palettes', GAME, PLATFORM) / f'{stem}-{safe_name}.json',
            {'colors': colours}, pretty=True)
        pals[e.name] = colours
    print(f'  {stem}: {len(pals)} palettes -> palettes/{stem}-*.json')
    return pals


def extract_sounds(r, entries_by_type, stem):
    audio_dir = bclib.asset_dir('audio', GAME, PLATFORM)
    manifest = []
    for slot in entries_by_type.get('pcm_sound', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        safe = safe_asset_name(e.name or f'sound_{slot:04d}')
        bclib.write_wav(audio_dir / f'{stem}-{safe}.wav', blob, sample_rate=8000,
                        sample_width=1, channels=1)
        manifest.append({'id': slot, 'name': e.name, 'bytes': e.size,
                         'file': f'audio/{stem}-{safe}.wav'})
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / f'{stem}-sounds.json',
                     {'format': 'pcm_u8_mono_8000hz_hypothesis',
                      'note': ('8-bit unsigned mono assumed at 8000 Hz, inherited from '
                                'EOB3/ThirdEye and the real AESOP interpreter source '
                                '(MODSND32.C: "Eye III sound samples at 8.000 kHz") -- '
                                'not independently confirmed at this exact rate for '
                                "Dungeon Hack's own build."),
                      'count': len(manifest), 'samples': manifest}, pretty=True)
    print(f'  {stem}: audio/*.wav: {len(manifest)} sound resources')


def extract_strings(r, entries_by_type, stem):
    strings = {}
    for slot in entries_by_type.get('string', []):
        e = r.entries[slot]
        blob = r.resource_bytes(slot)
        if len(blob) < 3:
            continue
        text = blob[2:-1].decode('latin-1')
        strings[e.name] = text
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / f'{stem}-strings.json',
                     {'count': len(strings), 'strings': strings}, pretty=True)
    print(f'  {stem}: data/{stem}-strings.json: {len(strings)} strings')


def process_container(fname, stem):
    root = bclib.data_dir(GAME, PLATFORM)
    res_path = root / fname
    if not res_path.exists():
        print(f'No {fname} at {res_path} -- skipping')
        return

    r = res.load(str(res_path))
    assert r.file_size == len(r.data), f'{fname}: GlobalHeader.file_size mismatch'
    print(f'{fname}: {r.file_size} bytes, {len(r.dir_blocks)} directory blocks, '
          f'{len(r.entries)} entries, {len(r.table0)} named resources')

    type_of = classify.classify_all(r)
    entries_by_type = {}
    for slot, t in type_of.items():
        entries_by_type.setdefault(t, []).append(slot)

    manifest = []
    for slot in sorted(r.entries):
        e = r.entries[slot]
        manifest.append({'id': slot, 'name': e.name, 'size': e.size,
                         'offset': e.offset, 'attributes': e.attributes,
                         'type': type_of.get(slot, 'empty')})
    type_counts = {t: len(v) for t, v in sorted(entries_by_type.items())}
    bclib.write_json(bclib.asset_dir('data', GAME, PLATFORM) / f'{stem}-resources.json',
                     {'fileSize': r.file_size, 'entryCount': len(r.entries),
                      'namedCount': len(r.table0), 'typeCounts': type_counts,
                      'entries': manifest})
    print(f'  wrote data/{stem}-resources.json ({len(manifest)} entries); type counts: {type_counts}')

    pals = extract_palettes(r, entries_by_type, stem)
    fixed_palette = pals.get('Fixed palette')
    approx = False
    if fixed_palette is None:
        # OPEN.RES has no single named "Fixed palette" resource (it uses
        # full per-scene 256-colour palettes instead, e.g. "Scene One
        # Palette"/"Scene Two Palette"/"Ending Palette" -- a cinematic-
        # style scheme, not the fixed/wall/monster DAC-region split HACK.RES
        # uses). Fall back to the largest available palette as a best-effort
        # approximation; not resolved per-screen (no cross-reference exists
        # to say which screen wants which scene palette).
        best = max(pals.items(), key=lambda kv: len(kv[1]), default=(None, None))
        if best[1]:
            print(f'  {stem}: no "Fixed palette" -- approximating with '
                  f'"{best[0]}" ({len(best[1])} colours), unverified per-screen')
            fixed_palette = best[1]
            approx = True
        else:
            print(f'  {stem}: no usable palette resource -- bitmap/font colour rendering skipped')
            fixed_palette = [{'r': 0, 'g': 0, 'b': 0}] * 256

    extract_bitmaps(r, entries_by_type, stem, fixed_palette, approx)
    extract_fonts(r, entries_by_type, stem, fixed_palette)
    extract_sounds(r, entries_by_type, stem)
    extract_strings(r, entries_by_type, stem)


def main():
    for fname, stem in CONTAINERS:
        process_container(fname, stem)


if __name__ == '__main__':
    main()

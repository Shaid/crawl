#!/usr/bin/env python3
"""Export the dungeon tilesets (`bcdfx`/`bcdfy`/`bcdfz`) as palette-indexed
assets, plus every accent ramp each tileset actually serves.

`scripts/render_all.py`'s existing `textures/dungeon-<name>.png` is a baked
RGBA export using only that tileset's *primary* accent ramp
(`bclib.palette.read_dungeon_palette_for_tileset` -- "primary" = the lowest
dungeon level that loads it). That's wrong for `bcdfx` on levels 12-13,
which actually render under ramp 3, not ramp 0 (`bclib.palette.tileset_ramps`
already documents this: `bcdfx -> [0, 3]`). One baked RGBA atlas cannot serve
both.

This script instead emits, per tileset:

* `textures/dungeon-<name>-indexed.png` -- an 8-bit palette-indexed PNG
  whose pixel values are the raw EHB index (0-63: 0-31 base colours, 32-63
  their half-bright twins -- see `bclib.palette.ehb_palette`), **palette-
  agnostic**: the same index bytes are correct under any of the tileset's
  ramps, only the embedded PNG palette (baked as the tileset's primary ramp,
  for direct-viewing convenience only) differs. `{transparentIndex: null}`
  -- opaque index 0, matching the walker plan's convention; side walls and
  other masked art carry their own separate mask plane, not an index-0
  transparency convention.
* `textures/dungeon-<name>-indexed-mask.png` -- an 8-bit grayscale (0/255)
  opacity mask, meaningful only for the 7-plane (mask-first) sub-images;
  opaque 6-plane art gets an all-255 mask.
* `textures/dungeon-<name>-indexed.json` -- the atlas frame sidecar (same
  shape as `write_atlas`'s, so existing atlas-consuming code needs no new
  parser).
* `palettes/dungeon-<name>-ramp<N>.json` for **every** ramp `N` the tileset
  serves (`bclib.palette.tileset_ramps`), not just its primary one -- 64
  `{r,g,b}` entries (32 base + 32 EHB half-bright), matching the index
  domain above.

This is additive: `render_all.py`'s existing baked RGBA atlas is untouched,
still the primary/only path M1-M2's `slots.json` references. Wiring the
walker's runtime to actually pick a ramp at render time is a later
milestone (`walker-plan.md` M4) -- this script only produces the verified
data for it.

Usage:
    python3 scripts/export_dungeon_tileset_indexed.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

import bclib

ROOT = Path(__file__).resolve().parents[1]
AMIGA = bclib.data_dir('blackcrypt', 'amiga')


def sprite_index_and_mask(w, h, planes, blob):
    """Decode one sub-image to `(index_array, mask_array_or_none)` in the
    raw 0-63 EHB index domain -- no palette applied, unlike
    `render_all.py`'s `to_rgba` path."""
    if planes == 7:
        idx, mask = bclib.decode_masked(blob, w, h, 6)
        return idx, mask
    if planes == 6:
        idx = bclib.decode_planar(blob, w, h, 6)
        return idx, None
    return None, None  # 1-plane stencil: no colour data, not part of this export


def main():
    s1_path = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
    s2_path = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_s2_data.bin'
    if not (s1_path.exists() and s2_path.exists()):
        print('  dungeon indexed textures: skipped (no decompressed bcdft; run '
              '`cd tools/bcdft_decompress && bash build.sh run` first)')
        return

    s1, s2 = s1_path.read_bytes(), s2_path.read_bytes()
    ramps_by_tileset = bclib.tileset_ramps(s1, s2)
    pal_dir = bclib.asset_dir('palettes')
    tex_dir = bclib.asset_dir('textures')
    manifest_entries = []

    for name in bclib.TILESET_FILES:
        src_path = AMIGA / name
        if not src_path.exists():
            continue
        raw = src_path.read_bytes()
        chunks = bclib.read_chunks(s1, raw, name, bclib.rle_decompress)

        sprites = []
        for label, w, h, planes, blob in bclib.iter_sub_images(chunks):
            idx, mask = sprite_index_and_mask(w, h, planes, blob)
            if idx is None:
                continue
            sprites.append((label, idx, mask))
        if not sprites:
            continue

        index_sheet, mask_sheet, frames = bclib.pack_atlas_indexed(sprites, max_width=512)

        # Bake the tileset's primary ramp into the PNG's own palette --
        # direct-viewing convenience only. The index bytes themselves are
        # correct under every ramp; a runtime consumer re-palettes from the
        # separate ramp JSON files below.
        primary_ramp = ramps_by_tileset[name][0]
        flat = _flat_palette_for_ramp(s1, s2, primary_ramp)

        bclib.write_indexed_png(tex_dir / f'dungeon-{name}-indexed.png', index_sheet,
                                 flat, transparent_index=None)
        bclib.write_indexed_png_mask(tex_dir / f'dungeon-{name}-indexed-mask.png', mask_sheet)
        bclib.write_json(tex_dir / f'dungeon-{name}-indexed.json',
                          bclib.frames_to_json(frames, index_sheet.shape[1], index_sheet.shape[0]),
                          pretty=True)
        manifest_entries.append(bclib.manifest_entry(f'textures/dungeon-{name}-indexed', len(frames)))
        print(f'  textures/dungeon-{name}-indexed.png: {len(frames)} sub-images '
              f'(1-plane clip stencil skipped -- no colour data, not part of this '
              f'export), {index_sheet.shape[1]}x{index_sheet.shape[0]}, '
              f'primary ramp {primary_ramp}')

        for ramp in ramps_by_tileset[name]:
            flat_r = _flat_palette_for_ramp(s1, s2, ramp)
            colors = [{'r': flat_r[i * 3], 'g': flat_r[i * 3 + 1], 'b': flat_r[i * 3 + 2]}
                      for i in range(len(flat_r) // 3)]
            bclib.write_json(pal_dir / f'dungeon-{name}-ramp{ramp}.json',
                              {'colors': colors}, pretty=True)
        print(f'  palettes/dungeon-{name}-ramp{{{",".join(str(r) for r in ramps_by_tileset[name])}}}.json')

    if manifest_entries:
        bclib.write_manifest(manifest_entries)


def _flat_palette_for_ramp(bcdft_s1, bcdft_s2, ramp):
    """The 64-entry (32 base + 32 EHB half-bright) flat RGB palette for one
    specific accent ramp -- `bclib.palette.read_dungeon_palette_for_tileset`
    only exposes a tileset's *primary* ramp, so this reimplements its last
    step (`ehb_palette`) directly against an explicit ramp index instead."""
    words = bclib.read_palette_words(bcdft_s1, bclib.BCDFT_DUNGEON_PALETTE, 32)
    accent = bclib.read_accent_ramp(bcdft_s1, ramp)
    return bclib.ehb_palette(words[:26] + accent)


if __name__ == '__main__':
    main()

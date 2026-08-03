"""Dungeon Hack-specific helpers for the "old format" bitmap resources
embedded directly in HACK.RES/OPEN.RES (see eotb3lib/bitmap.py for the
decoder itself).

Two things this module adds on top of the shared decoder:

1. `is_screen`: a resource is treated as an opaque full-screen image (not
   a transparent sprite) if any of its sub-bitmaps is exactly 320x200 --
   confirmed against "Drawbridge" (a 6-frame title-card/drawbridge event
   animation, every frame 320x200) and "Main Screen"/"Diff Screen"/
   "Generating"/"Customize Screen" etc (all single 320x200 frames).
2. `classify_dac_region`: classifies a resource's own nonzero pixel-index
   range against the empirically-measured Dungeon Hack DAC windows (see
   docs/dungeonhack/dosvga/data-structure.md) -- the same "runtime DAC
   region" mechanism EOB3 uses (confirmed against the real interpreter
   source this pass, GRAPHICS.C's fade_tables[5][...]/first_color[5]/
   num_colors[5]), just re-tuned with Dungeon Hack's own asset budget:

     region   | measured index range | matching palette resource(s)
     ---------|----------------------|-------------------------------
     fixed    | 1-224                | "Fixed palette" (225 colours)
     sel      | 225-239              | "Sel-0".."Sel-13" (14 colours each,
              |                      |   presumably a time-multiplexed
              |                      |   shimmer/highlight cycle -- which
              |                      |   Sel-N is active for a given
              |                      |   resource is not resolved, no
              |                      |   bytecode trace done this pass)
     wall     | 240-255              | "wall/floor palette 00".."20" (16
              |                      |   colours each -- 21 candidates for
              |                      |   7 named wallsets, 3:1 ratio
              |                      |   plausible but not resolved to a
              |                      |   specific per-wallset assignment)

   Only "fixed" is colour-resolved by the extractor (unambiguous: exactly
   one named "Fixed palette" resource). "sel"/"wall"/"mixed" bitmaps are
   rendered in a neutral greyscale ramp, matching EOB3's convention for its
   own still-unresolved bitmap set -- see docs/dungeonhack/dosvga/
   data-structure.md's "Still open" section.
"""
from __future__ import annotations

import struct

import numpy as np

from eotb3lib import bitmap as bitmap_mod

DAC_FIXED = (1, 224)
DAC_SEL = (225, 239)
DAC_WALL = (240, 255)


def decode_subbitmaps(blob: bytes):
    """Decode every sub-bitmap of an "old format" resource into a list of
    {width, height, pixels (bytearray)}. Raises on any structural error --
    callers should already have run classify.looks_like_old_format_bitmap."""
    num_sub = struct.unpack_from("<H", blob, 4)[0]
    out = []
    for i in range(num_sub):
        off = 6 + i * 4
        sub_off = struct.unpack_from("<I", blob, off)[0]
        w, h = struct.unpack_from("<HH", blob, sub_off)
        pixels, _next_pos = bitmap_mod.decode_old_format_scanlines(blob, sub_off + 4, w, h)
        out.append({"width": w, "height": h, "pixels": pixels})
    return out


def is_screen(subbitmaps) -> bool:
    return any(s["width"] == 320 and s["height"] == 200 for s in subbitmaps)


def classify_dac_region(subbitmaps) -> dict:
    """Classify a resource's combined nonzero pixel range against the
    measured DAC windows. Returns {region, min, max} where region is one
    of 'fixed'/'sel'/'wall'/'mixed'/'empty'."""
    allpix = np.concatenate([
        np.frombuffer(bytes(s["pixels"]), dtype=np.uint8) for s in subbitmaps
    ]) if subbitmaps else np.array([], dtype=np.uint8)
    nz = allpix[allpix != 0]
    if len(nz) == 0:
        return {"region": "empty", "min": None, "max": None}
    mn, mx = int(nz.min()), int(nz.max())
    frac_fixed = float(np.mean((nz >= DAC_FIXED[0]) & (nz <= DAC_FIXED[1])))
    frac_sel = float(np.mean((nz >= DAC_SEL[0]) & (nz <= DAC_SEL[1])))
    frac_wall = float(np.mean((nz >= DAC_WALL[0]) & (nz <= DAC_WALL[1])))
    if frac_fixed > 0.98:
        region = "fixed"
    elif frac_wall > 0.9:
        region = "wall"
    elif frac_sel > 0.9:
        region = "sel"
    else:
        region = "mixed"
    return {"region": region, "min": mn, "max": mx}


def to_rgba(subbitmap, palette_rgb, opaque: bool):
    """Render one decoded sub-bitmap to an (h, w, 4) uint8 RGBA array using
    a flat 256-colour palette (list of {r,g,b} dicts, index 0 unused/black
    unless opaque). `opaque=False` treats palette index 0 as transparent
    (sprite convention); `opaque=True` paints it (full-screen convention)."""
    w, h = subbitmap["width"], subbitmap["height"]
    idx = np.frombuffer(bytes(subbitmap["pixels"]), dtype=np.uint8).reshape(h, w)
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i, c in enumerate(palette_rgb):
        lut[i] = (c["r"], c["g"], c["b"])
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = lut[idx]
    rgba[..., 3] = 255 if opaque else np.where(idx != 0, 255, 0).astype(np.uint8)
    return rgba


def to_rgba_greyscale(subbitmap, opaque: bool):
    w, h = subbitmap["width"], subbitmap["height"]
    idx = np.frombuffer(bytes(subbitmap["pixels"]), dtype=np.uint8).reshape(h, w)
    grey = idx.astype(np.uint32)
    if idx.max() > 0:
        grey = grey * 255 // max(1, int(idx.max()))
    grey = grey.astype(np.uint8)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = grey
    rgba[..., 1] = grey
    rgba[..., 2] = grey
    rgba[..., 3] = 255 if opaque else np.where(idx != 0, 255, 0).astype(np.uint8)
    return rgba

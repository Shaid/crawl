"""Bitmap <-> palette resolution for `EYE.RES` "1.10" VFX shapes.

**Mechanism (confirmed)**: AESOP's runtime palette isn't per-resource -- it's
5 fixed windows of the 256-colour VGA DAC, loaded by SOP bytecode calling
`set_palette(region, paletteResource)` (see ThirdEye's
`apps/thirdeye/runtime/graphics.cpp`, `kFirstColor[5] = {0x00, 0xB0, 0xC0,
0xE0, 0xB0}` -- PAL_FIXED/PAL_WALLS/PAL_M1/PAL_M2/PAL_OUT). A VFX shape's
stored pixel bytes are **raw DAC indices** (0..255), not resource-local
indices -- so which colours a bitmap uses is fully determined by its own
pixel value range, no bytecode trace needed:

    PAL_FIXED  0x00-0xAF (176 colours) -- shared, always resident
    PAL_WALLS  0xB0-0xBF ( 16 colours) -- per-dungeon-theme wall/deco art
    PAL_M1     0xC0-0xDF ( 32 colours) -- monster slot 1
    PAL_M2     0xE0-0xFF ( 32 colours) -- monster slot 2
    (PAL_OUT shares PAL_WALLS' base -- time-multiplexed, not a distinct byte
    range)

**Verified corpus-wide** (312/312 "1.10" bitmaps, zero exceptions): every
bitmap's masked pixel-index range falls entirely inside exactly one of these
4 windows -- max index is never in a "gap" between windows, and no bitmap's
usage straddles two non-adjacent windows. See
docs/eotb3/dosvga/data-structure.md Sec 4.2 for the full tally.

160/312 (51%) bitmaps use FIXED only -- these render correctly right now
with just the "Fixed palette" resource, no per-resource pairing needed.

For the 152 bitmaps that need a region palette, this module resolves the
*specific* named palette resource via: (a) name-normalize both the bitmap
and every "<X> palette"/"<X> pal" resource name (strip "palette"/"pal",
strip non-alphanumerics), (b) substring-match, (c) require the candidate's
own declared `numColours` to equal the region's width exactly. 104/152
(68%) pass all three checks -- e.g. "Wight" (PAL_M1, pixel range 192-223)
<-> "Wight/Flar palette" (numColours=32); "Marble stairs down" (PAL_WALLS)
<-> "Marble palette" (numColours=16).

Two known residual groups (not resolved by this module, kept OPEN -- see
data-structure.md):
- "outtake"/"view"/"letterbox" full-scene resources (single shape, 70-100+
  unique pixel values spanning multiple windows) -- a different, wider
  palette-loading scheme than the 4-window per-object case. The *name*
  pairing itself is unambiguous (e.g. "Fflar outtake" <-> "Fflar palette")
  but the DAC placement formula isn't nailed down.
- A `PAL_WALLS`-region bitmap whose name doesn't match any of the 4 named
  16-colour theme palettes (Forest/Mausoleum/Ruins/Marble) -- e.g. the
  "Temple ..." decor family, which almost certainly reuses one of those 4
  (thematically "Marble", per EOB3's Temple of Lathander architecture) but
  isn't picked up by exact name-matching.
"""
from __future__ import annotations

import re
import struct

DAC_REGIONS = {
    "fixed": (0x00, 176),
    "walls": (0xB0, 16),
    "m1": (0xC0, 32),
    "m2": (0xE0, 32),
}


def classify_pixel_range(min_index: int, max_index: int) -> str:
    """Which DAC region a bitmap's observed (masked) pixel range implies."""
    if max_index < 176:
        return "fixed"
    if max_index <= 191:
        return "walls"
    if max_index <= 223:
        return "m1"
    return "m2"


def normalize_palette_name(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\bpalette\b", "", s)
    s = re.sub(r"\bpal\b", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def build_palette_index(r) -> dict:
    """normalized-name -> [(Entry, numColours), ...] for every resource
    whose name contains "palette" or ends in " pal"."""
    out: dict[str, list] = {}
    for slot in sorted(r.entries):
        e = r.entries[slot]
        lname = e.name.lower()
        if "palette" not in lname and not lname.endswith(" pal"):
            continue
        blob = r.resource_bytes(slot)
        if len(blob) < 2:
            continue
        num_colours = struct.unpack_from("<H", blob, 0)[0]
        out.setdefault(normalize_palette_name(e.name), []).append((e, num_colours))
    return out


def find_named_palette(bitmap_name: str, region: str, palette_index: dict):
    """Best-effort (Entry, numColours) match for `bitmap_name` in `region`,
    or None. Requires numColours == the region's declared width."""
    if region == "fixed":
        return None
    _base, width = DAC_REGIONS[region]
    bn = normalize_palette_name(bitmap_name)
    if not bn:
        return None
    for pn, candidates in palette_index.items():
        if bn == pn or bn in pn or pn in bn:
            for entry, num_colours in candidates:
                if num_colours == width:
                    return entry, num_colours
    return None

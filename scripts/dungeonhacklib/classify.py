"""Structural classification of `HACK.RES`/`OPEN.RES` resources by content shape.

Same container format as EOB3's `EYE.RES` (see `eotb3lib/res.py` -- reused
directly, unmodified) and mostly the same content-type shapes as
`eotb3lib/classify.py`, with one important corpus difference: Dungeon Hack
embeds "old format" row/span RLE bitmaps (see `eotb3lib/bitmap.py`)
*directly* in the main resource container -- full-screen event art
("Drawbridge", "Main Screen"), UI backdrops, and distance-graduated
wall/decoration LOD sprite sets ("Stone Wallset", 236 sub-images). EOB3 only
ever uses this encoding inside its separate GFF cutscene files; every
bitmap embedded directly in EYE.RES there uses the "1.10" VFX shape format
instead (confirmed zero old-format-bitmap-shaped resources in EOB3's own
`unknown`/`pcm_sound` buckets -- see docs/dungeonhack/dosvga/data-structure.md).

This matters for classification priority: `eotb3lib/classify.py`'s
`looks_like_pcm_sound` (byte-histogram bell-curve heuristic) produces real
false positives against Dungeon Hack's old-format bitmaps (e.g. "Floor Deco
08", "Portrait 2" -- named graphics, not sounds, that happen to have a
bell-curved byte histogram). So this module checks
`looks_like_old_format_bitmap` (a strict structural check: full recursive
decode of every declared sub-bitmap must succeed with in-bounds offsets and
plausible dimensions) *before* the sound/other heuristics, not after.

Types: `vfx_bitmap`, `old_format_bitmap` (new for DH), `palette`, `sop_dict`,
`string`, `map32x32`, `pcm_sound`, `iff_cue`, `unknown`. See
docs/dungeonhack/dosvga/data-structure.md Sec on resource classification for
the corpus-wide tally and verification evidence.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eotb3lib import bitmap as bitmap_mod
from eotb3lib import font as font_mod
from eotb3lib import res as res_mod
from eotb3lib.classify import (
    looks_like_dictionary,
    looks_like_iff_cue,
    looks_like_map32x32,
    looks_like_palette,
    looks_like_pcm_sound,
    looks_like_string,
)


def looks_like_old_format_bitmap(blob: bytes) -> bool:
    """Strict structural + full-decode check for the "old format" row/span
    RLE bitmap directory (see eotb3lib/bitmap.py). Requires every declared
    sub-bitmap to have an in-bounds offset, plausible dimensions, and decode
    without a bounds/format error -- deliberately stricter than the
    lightweight header-shape checks used for other types, because this
    format's header is small and easy to false-positive-match against
    unrelated binary data (see module docstring)."""
    if len(blob) < 6:
        return False
    num_sub = struct.unpack_from("<H", blob, 4)[0]
    if num_sub == 0 or num_sub > 4096:
        return False
    table_end = 6 + num_sub * 4
    if table_end > len(blob):
        return False
    for i in range(num_sub):
        off = 6 + i * 4
        sub_off = struct.unpack_from("<I", blob, off)[0]
        if sub_off < table_end or sub_off + 4 > len(blob):
            return False
        w, h = struct.unpack_from("<HH", blob, sub_off)
        if w == 0 or h == 0 or w > 1024 or h > 1024:
            return False
        try:
            _pixels, next_pos = bitmap_mod.decode_old_format_scanlines(
                blob, sub_off + 4, w, h
            )
        except Exception:
            return False
        if next_pos > len(blob):
            return False
    return True


def classify(name: str, slot: int, blob: bytes) -> str:
    """Return one of: vfx_bitmap, iff_cue, palette, sop_dict, string,
    map32x32, resource_font, old_format_bitmap, pcm_sound, unknown."""
    if blob[0:4] == b"1.10":
        return "vfx_bitmap"
    if looks_like_iff_cue(blob):
        return "iff_cue"
    if looks_like_palette(blob):
        return "palette"
    if slot < 5 or name.endswith(".IMPT") or name.endswith(".EXPT"):
        return "sop_dict"
    if looks_like_string(blob):
        return "string"
    if looks_like_dictionary(blob):
        return "sop_dict"
    if looks_like_map32x32(blob):
        return "map32x32"
    if font_mod.looks_like_resource_font(blob):
        return "resource_font"
    if looks_like_old_format_bitmap(blob):
        return "old_format_bitmap"
    if looks_like_pcm_sound(blob):
        return "pcm_sound"
    return "unknown"


def classify_all(r: res_mod.EyeRes) -> dict:
    """slot -> type string, for every non-empty entry."""
    out = {}
    for slot in sorted(r.entries):
        e = r.entries[slot]
        if e.size == 0:
            out[slot] = "empty"
            continue
        blob = r.resource_bytes(slot)
        out[slot] = classify(e.name, slot, blob)
    return out

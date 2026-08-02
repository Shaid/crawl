"""Structural classification of `EYE.RES` resources by content shape.

`EYE.RES`'s own container format (see res.py) carries **no type tag** --
`EntryHeader.data_attributes` is a flat u32 (observed values 0/16/32/33) that
doesn't correlate with content class, and the AESOP runtime resolves a
resource's meaning purely by which VM function it's handed to
(`draw_bitmap`, `set_palette`, `play_sound`, ...), not by an on-disk marker.
So every classifier here is a structural/statistical fingerprint of the
resource's own bytes, confirmed against real content:

- ``vfx_bitmap``   -- "1.10" magic (see bitmap.py) -- 312 resources
- ``palette``      -- 26-byte header (numColours, colorArrayOffset==26) that
                       fits inside the resource -- 55 resources
- ``sop_dict``      -- AESOP dictionary blob (bucket_count header, see
                       res.parse_dictionary) OR a `<name>.IMPT`/`.EXPT`
                       resource OR one of special tables 0-4. These are
                       SOP-code-object linkage tables, not asset data.
- ``string``        -- ``S:<text>\\0`` -- the UI/menu/copy-protection string
                       table convention (confirmed: "S:Yes\\0", "S:HP\\0",
                       "S:\\nPlease enter the requested word..." for the
                       manual-lookup copy protection prompt) -- 749 resources
- ``map32x32``      -- exactly 1024 B with a dominant byte value (dungeon
                       level wall-type grid; 0xFF = floor, matches
                       ThirdEye's automap.cpp) -- 14 resources, one per
                       named dungeon level, matching ThirdEye's kLevels=15
                       (0 unused + 14 real) byte-exact
- ``pcm_sound``     -- byte histogram is a bell curve centred near 128 (8-bit
                       unsigned PCM silence level) -- confirmed against
                       ThirdEye's `sound.cpp` (`SOUND_RATE=8000`,
                       `AL_FORMAT_MONO8`) -- 116 resources
- ``iff_cue``       -- `FORM....XDIR` EA-IFF-85 wrapper (outtake/dialogue
                       cue bundles: CUE1-9, AVON/AVPC, CHGE*, FLAPC, ...) --
                       structurally identified, inner `CAT ` chunk payload
                       not decoded (adjacent to the already out-of-scope
                       GFF ACF/MERR/*SEQ sequencing formats) -- 66 resources
- ``unknown``       -- everything else. Dominated by AESOP SOP class objects
                       with no `.IMPT`/`.EXPT` suffix (e.g. "kernel",
                       "dungeon", "camp", weapon/item-type classes like
                       "axe", "long sword") -- game logic, not asset data,
                       same category as the already-deferred AESOP bytecode
                       item -- plus 3 small unidentified font-like
                       resources ("8x8 font", "6x8 font", "Ornate font").

See docs/eotb3/dosvga/data-structure.md Sec 9 for the full corpus tally and
verification evidence.
"""
from __future__ import annotations

import struct
from collections import Counter

from . import res as res_mod


def looks_like_dictionary(blob: bytes) -> bool:
    if len(blob) < 2:
        return False
    bucket_count = struct.unpack_from("<H", blob, 0)[0]
    if bucket_count == 0 or bucket_count > 4096:
        return False
    need = 2 + bucket_count * 4
    if need > len(blob):
        return False
    offsets = struct.unpack_from(f"<{bucket_count}I", blob, 2)
    return all(0 <= o < len(blob) for o in offsets)


def looks_like_palette(blob: bytes) -> bool:
    if len(blob) < 26:
        return False
    num_colours, colour_array_offset = struct.unpack_from("<HH", blob, 0)
    if not (1 <= num_colours <= 256):
        return False
    if colour_array_offset != 26:
        return False
    return 26 + num_colours * 3 <= len(blob)


def looks_like_map32x32(blob: bytes) -> bool:
    if len(blob) != 1024:
        return False
    _dom, dom_count = Counter(blob).most_common(1)[0]
    return dom_count / 1024.0 > 0.3


def looks_like_pcm_sound(blob: bytes) -> bool:
    if len(blob) < 50:
        return False
    total = len(blob)
    mean = sum(blob) / total
    var = sum((b - mean) ** 2 for b in blob) / total
    std = var ** 0.5
    if not (100 < mean < 156) or std > 70:
        return False
    peak_val, _peak_count = Counter(blob).most_common(1)[0]
    return 96 <= peak_val <= 160


def looks_like_string(blob: bytes) -> bool:
    return blob[:2] == b"S:" and blob.endswith(b"\x00")


def looks_like_iff_cue(blob: bytes) -> bool:
    return blob[0:4] == b"FORM" and blob[8:12] == b"XDIR"


def classify(name: str, slot: int, blob: bytes) -> str:
    """Return one of: vfx_bitmap, palette, sop_dict, string, map32x32,
    pcm_sound, iff_cue, unknown."""
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

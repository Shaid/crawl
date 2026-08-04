#!/usr/bin/env python3
"""Proof-of-concept art-conversion swap for the Black Crypt DOS demo's
`clipper.clp` -- see `docs/blackcrypt/dos/full-game-restoration-plan.md`
§ "Phase 3a" for the full write-up.

## What this does

Before attempting the full Phase 3 injection (23 new creature clusters, 2
new tilesets -- see the plan's § "1D"), this proves the Amiga->DOS art
conversion pipeline end to end using only entries the demo *already ships*,
via a much cheaper **in-place pixel-data swap** -- no new directory entries,
no offset recomputation, no file-size change:

1. **Map 1's dungeon tileset** (`clipper.clp` entries 7-76, the "Alcove A" ..
   "Secret Button 1 In" run that backs runtime tileset group 1) is
   overwritten with art converted from the Amiga `bcdfz` tileset (levels
   6-11, accent ramp 2 "bone/cream") instead of its own `bcdfx`-equivalent
   art. 68 of the 70 entries convert cleanly (58 direct 1:1 sub-images, 3
   simple composites: `Wall 0/1/2` = left-return + face + right-return
   horizontally concatenated, `Floor 2` = horizontal flip of `Floor 1`).
   `Wall Left`/`Wall Right` are left as original `bcdfx` pixels -- their
   Amiga source is a 4-depth perspective composite with no documented
   stacking recipe, out of scope for a proof of concept (see the plan doc).
2. **Rock Eye** (entries 801-807, gfx `0xb3`, 7 frames) is overwritten with
   art converted from **Green Guy** (Amiga gfx `0xb0`, `bcdfc`, map 2) --
   the only other real creature with a frame count small enough to map
   cleanly onto Rock Eye's 7 fixed directory slots without inventing new
   entries. Green Guy has 4 distinct Amiga frames; they're distributed
   across Rock Eye's 7 slots by size rank (the near-facing triple `1 N/1
   E/1 S`, all 64x55, all reuse Green Guy's second frame), each resized
   with nearest-neighbour scaling to its target slot's *existing* (w, h) --
   see the plan doc for why no other creature has a 7-frame match and why
   this candidate and this slot assignment were chosen.

## Why this is cheap: same-size overwrite, zero directory changes

`clipper.clp` is `uint16 count` + `count * 56 B` directory + a data blob
laid out in **exact directory order with zero gaps** (verified against the
real shipped file: 782/782 data-bearing entries contiguous, first data byte
immediately after the directory, last entry's data ends exactly at EOF --
see the plan doc's "Container mechanics" section). Inserting new entries
would shift every subsequent entry's offset and require a full rewrite
(expensive -- that's Phase 3 proper). But *replacing* an existing entry's
pixel data **without changing its byte size** requires no offset
recomputation and no directory edit at all -- only the `size` bytes at its
already-recorded `data_offset` change. Both swaps here are engineered to
land exactly on this cheap path: `bcdfz`'s sub-images are byte-identical in
(width, height) to the existing map-1 tileset entries at every position
(same 12-chunk structure as `bcdfx`, confirmed in
`docs/blackcrypt/amiga/data-structure.md`), and every Green Guy frame is
explicitly resized to its target Rock Eye slot's existing dimensions before
being written. So this script only ever overwrites `size`-byte windows in
place; it never touches the 45,698-byte header+directory region and never
changes the file's length.

(The general, differing-size case -- needed once Phase 3 injects creatures
with no size-matched slot to reuse -- is cheaper than a full insert too: only
the *directory* rows for entries after the resized one need their
`data_offset` field patched (4 bytes each, fixed position), and only the
*data blob* from the resized entry's old start through EOF needs rewriting
-- not the whole file. This script doesn't need that path, so it isn't
implemented here; see the plan doc for the worked-out rule.)

## Repo hygiene

Never touches `data/blackcrypt/dosvga/clipper.clp` (or any file under
`data/`) in place -- reads a user-supplied input, writes a user-supplied
output, refuses to run if they're the same path, refuses to overwrite an
existing output without `--force`. The output is derived, copyrighted demo
data; it is never committed.

Usage:
    python3 scripts/build_proof_of_concept_art_swap.py <input.clp> <output.clp>
"""
import argparse
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import bcdfxyz

ROOT = Path(__file__).resolve().parents[1]
DIR_ENTRY_SIZE = 56
HEADER_SIZE = 2

# --- Per-entry transparency key (corrected, see "live in-game finding" in ---
# --- the plan doc's Phase 3a section) ---------------------------------------
# clipper.clp's own 56-byte directory carries a real per-entry background/
# colour-key field at offset +50 (uint16 LE), between `data_offset` and
# `width` -- read directly by crypt.exe's clip-surface loader
# (`fcn.00402350` @ 0x4023e1/0x4023d4, DOS x86) and passed to
# IDirectDrawSurface::SetColorKey (vtable +0x74, flags DDCKEY_SRCBLT). The
# door-render path (`fcn.0040d550` @ 0x40d70f) blits every structure sprite
# with IDirectDrawSurface::BltFast, flags 0x11 = DDBLTFAST_WAIT |
# DDBLTFAST_SRCCOLORKEY -- i.e. the DOS renderer *does* respect per-pixel
# masking for doors/structures; it is not a flat opaque blit. There is
# therefore no single game-wide "the" transparency index: across the real
# `clipper.clp`, masked entries carry 32, 33, 0, 20, 35 or 53 depending on
# what background the art was authored against, and unmasked/fully-opaque
# entries carry the sentinel 0xFFFF (no SetColorKey call at all). This
# script never hardcodes a value -- `parse_directory` reads each entry's
# real `colorkey` field and every masked write uses that entry's own value.
#
# Within the 70-entry map-1 tileset (indices 7-76) and the 7 Rock Eye
# entries this script touches, the real per-entry values are only ever 32,
# 33 or 0xFFFF -- confirmed by parsing the real shipped file (32 entries at
# 32, incl. every Door Way/Door Type/Pillar/Pull Chain; 24 entries at 33,
# incl. every Floor Pit/Ceiling Pit/Button, and all 7 Rock Eye entries; 14
# entries at 0xFFFF, all of them fully-opaque 6-plane sub-images with no
# Amiga mask plane at all -- Wall 0/1/2, Floor 1/2, Stairs x6, Ceiling, Door
# Slot, Panel Top). DOS_RESERVED_INDICES excludes both real masked values
# from the nearest-RGB palette-mapping candidate pool so a converted opaque
# pixel can never accidentally land on either.
DOS_RESERVED_INDICES = (32, 33)     # every real masked colorkey this script's own touched entries use

# --- Pre-flight expectations (the real shipped 1995 demo clipper.clp) -----
EXPECTED_ENTRY_COUNT = 816
EXPECTED_NAMES = {
    0: 'Palette',
    7: 'Alcove A',
    76: 'Secret Button 1 In',
    800: 'Start Monsters',
    801: 'Rock Eye 1 N',
    802: 'Rock Eye 1 E',
    803: 'Rock Eye 1 S',
    804: 'Rock Eye 2 S',
    805: 'Rock Eye 3 S',
    806: 'Rock Eye A 0',
    807: 'Rock Eye A 1',
    815: 'End Monsters',
}

# --- Tileset swap: DOS entry name -> Amiga bcdfz recipe --------------------
# ('direct', label)        -- one bcdfxyz.SUB_IMAGES sub-image, same (w, h)
# ('hflip', label)         -- horizontal flip of one sub-image (Floor 2)
# ('hconcat', [labels])    -- horizontal concat of same-height sub-images
#                              (Wall 0/1/2 = left-return + face + right-return)
# Names not listed here (Wall Left, Wall Right) are left as original bcdfx
# pixels -- see module docstring.
TILESET_MAP = {
    'Alcove A': ('direct', 'alcove-a'),
    'Alcove B': ('direct', 'alcove-b'),
    'Alcove C': ('direct', 'alcove-c'),
    'Alcove D': ('direct', 'alcove-d'),
    'Alcove E': ('direct', 'alcove-e'),
    'Plaque A': ('direct', 'plaque-a'),
    'Plaque B': ('direct', 'plaque-b'),
    'Plaque C': ('direct', 'plaque-c'),
    'Plaque D': ('direct', 'plaque-d'),
    'Plaque E': ('direct', 'plaque-e'),
    'Ceiling': ('direct', 'ceiling'),
    'Door Slot': ('direct', 'door-slot'),
    'Door Way 1A': ('direct', 'doorway-1a'),
    'Door Way 1B': ('direct', 'doorway-1b'),
    'Door Way 1C': ('direct', 'doorway-1c'),
    'Door Way 2A': ('direct', 'doorway-2a'),
    'Door Way 2B': ('direct', 'doorway-2b'),
    'Door Way 2C': ('direct', 'doorway-2c'),
    'Door Way 3': ('direct', 'doorway-3'),
    'Door Type 0 - 1': ('direct', 'door-type0-1'),
    'Door Type 0 - 2': ('direct', 'door-type0-2'),
    'Door Type 0 - 3': ('direct', 'door-type0-3'),
    'Door Type 1 - 1': ('direct', 'door-type1-1'),
    'Door Type 1 - 2': ('direct', 'door-type1-2'),
    'Door Type 1 - 3': ('direct', 'door-type1-3'),
    'Floor 1': ('direct', 'floor'),
    'Floor 2': ('hflip', 'floor'),
    'Floor Pit A': ('direct', 'floor-pit-a'),
    'Floor Pit B': ('direct', 'floor-pit-b'),
    'Floor Pit C': ('direct', 'floor-pit-c'),
    # Amiga stores mirror-pair left/right (both 48x32); DOS ships only one
    # "Floor Pit D" entry. Which orientation DOS's single entry corresponds
    # to is unverified -- 'left' is an arbitrary but documented pick.
    'Floor Pit D': ('direct', 'floor-pit-d-left'),
    'Ceiling Pit A': ('direct', 'ceiling-pit-a'),
    'Ceiling Pit B': ('direct', 'ceiling-pit-b'),
    'Pillar A': ('direct', 'pillar-a'),
    'Pillar B': ('direct', 'pillar-b'),
    'Pillar C': ('direct', 'pillar-c'),
    # Flight A = Stairs Up, flight B = Stairs Down -- confirmed in
    # data-structure.md ("Flight A = Stairs Up, flight B = Stairs Down").
    'Stairs Down 1': ('direct', 'stairs-flight-b-depth0'),
    'Stairs Down 2': ('direct', 'stairs-flight-b-depth1'),
    'Stairs Down 3': ('direct', 'stairs-flight-b-depth2'),
    'Stairs Up 1': ('direct', 'stairs-flight-a-depth0'),
    'Stairs Up 2': ('direct', 'stairs-flight-a-depth1'),
    'Stairs Up 3': ('direct', 'stairs-flight-a-depth2'),
    'Wall 0': ('hconcat', ['wall0-left', 'wall0-face', 'wall0-right']),
    'Wall 1': ('hconcat', ['wall1-left', 'wall1-face', 'wall1-right']),
    'Wall 2': ('hconcat', ['wall2-left', 'wall2-face', 'wall2-right']),
    # 'Wall Left' / 'Wall Right': not converted, see module docstring.
    'Pull Chain 0': ('direct', 'pull-chain-0'),
    'Pull Chain 1': ('direct', 'pull-chain-1'),
    'Pull Chain 2': ('direct', 'pull-chain-2'),
    'Pull Chain 3': ('direct', 'pull-chain-3'),
    'Panel Top': ('direct', 'panel-top'),
    'Special Button 1R': ('direct', 'special-button1-r'),
    'Special Button 1L': ('direct', 'special-button1-l'),
    'Special Button 2R': ('direct', 'special-button2-r'),
    'Special Button 2L': ('direct', 'special-button2-l'),
    'Special Button 3R': ('direct', 'special-button3-r'),
    'Special Button 3L': ('direct', 'special-button3-l'),
    'Special Button 1RS': ('direct', 'special-button1-rs'),
    'Special Button 2RS': ('direct', 'special-button2-rs'),
    'Special Button 3RS': ('direct', 'special-button3-rs'),
    'Special Button 1LS': ('direct', 'special-button1-ls'),
    'Special Button 2LS': ('direct', 'special-button2-ls'),
    'Special Button 3LS': ('direct', 'special-button3-ls'),
    'Normal Button 1 Out': ('direct', 'normal-button1-out'),
    'Normal Button 1 In': ('direct', 'normal-button1-in'),
    'Normal Button 2 Out': ('direct', 'normal-button2-out'),
    'Normal Button 2 In': ('direct', 'normal-button2-in'),
    'Secret Button 1 Out': ('direct', 'secret-button1-out'),
    'Secret Button 1 In': ('direct', 'secret-button1-in'),
}

# --- Rock Eye swap: DOS entry name -> Green Guy frame index (by size rank) -
# Green Guy (Amiga gfx 0xb0, bcdfc/map 2) has 4 real frames, at decompressed
# offsets 23660 (96x75), 29960 (80x46), 33180 (48x23), 34146 (32x14) -- see
# public/assets/blackcrypt/amiga/data/monster-names.json group index 3.
GREEN_GUY_FILE = 'bcdfc'
ROCK_EYE_MAP = {
    'Rock Eye A 1': 0,   # 96x75 -> resized to 96x83 (biggest slot)
    'Rock Eye A 0': 1,   # 80x46 -> resized to 64x71
    'Rock Eye 1 N': 1,   # 80x46 -> resized to 64x55
    'Rock Eye 1 E': 1,   # 80x46 -> resized to 64x55
    'Rock Eye 1 S': 1,   # 80x46 -> resized to 64x55
    'Rock Eye 2 S': 2,   # 48x23 -> resized to 32x32
    'Rock Eye 3 S': 3,   # 32x14 -> resized to 16x17
}


def parse_directory(data):
    """Like extract_clipper.parse_clp but from an in-memory buffer, and
    without loading `data` payloads (this script only needs the metadata)."""
    num = struct.unpack_from('<H', data, 0)[0]
    entries = []
    for i in range(num):
        off = HEADER_SIZE + i * DIR_ENTRY_SIZE
        entries.append({
            'index': i,
            'name': data[off:off + 40].split(b'\x00')[0].decode('ascii', errors='replace'),
            'type': data[off + 40],
            'size': struct.unpack_from('<I', data, off + 42)[0],
            'data_offset': struct.unpack_from('<I', data, off + 46)[0],
            # Real per-entry background/transparency-key index (0xFFFF =
            # sentinel "no colour key", opaque). Field at +50, between
            # data_offset and width -- see the module-level comment above
            # DOS_RESERVED_INDICES for the disassembly evidence.
            'colorkey': struct.unpack_from('<H', data, off + 50)[0],
            'width': struct.unpack_from('<H', data, off + 52)[0],
            'height': struct.unpack_from('<H', data, off + 54)[0],
        })
    return entries


def preflight_check(entries):
    if len(entries) != EXPECTED_ENTRY_COUNT:
        raise ValueError(
            f'expected {EXPECTED_ENTRY_COUNT} directory entries, got '
            f'{len(entries)} -- refusing to patch what may not be the '
            f'known 1995 demo clipper.clp')
    for idx, name in EXPECTED_NAMES.items():
        got = entries[idx]['name'].strip()
        if got != name:
            raise ValueError(
                f'entry {idx}: expected name {name!r}, got {got!r} -- '
                f'refusing to patch what may not be the known demo build')


def ehb_to_dos_lut(dos_palette_rgb, ehb_flat):
    """Nearest-RGB-match lookup: 64-entry Amiga EHB palette -> DOS palette
    index (0-255), excluding the two reserved transparency-key indices from
    the candidate pool so a real opaque pixel is never accidentally written
    as a background-key colour."""
    ehb = np.asarray(ehb_flat, dtype=np.int32).reshape(64, 3)
    dos = dos_palette_rgb.astype(np.int32)
    dist = ((ehb[:, None, :] - dos[None, :, :]) ** 2).sum(axis=2)
    for r in DOS_RESERVED_INDICES:
        dist[:, r] = np.iinfo(np.int64).max
    return dist.argmin(axis=1).astype(np.uint8)


def resize_nearest(arr, w, h):
    """Nearest-neighbour resize of a palette-index array -- the only
    resampling mode that doesn't invent meaningless intermediate index
    values for a categorical image."""
    if arr.shape == (h, w):
        return arr
    img = Image.fromarray(arr, mode='L')
    return np.array(img.resize((w, h), Image.NEAREST), dtype=np.uint8)


def decode_tileset_label(chunks, label, lut, bg_index):
    """One bcdfxyz.SUB_IMAGES sub-image, palette-mapped to DOS indices, with
    mask==0 written as `bg_index` -- the *target DOS entry's own* real
    per-entry colour-key (see DOS_RESERVED_INDICES), not a fixed constant."""
    sub = next(s for s in bcdfxyz.SUB_IMAGES if s[0] == label)
    _, slot, offset, w, h, planes = sub
    data = chunks[slot]
    if planes == 7:
        idx, mask = bclib.decode_masked(data[offset:], w, h, 6)
    else:
        idx = bclib.decode_planar(data[offset:], w, h, planes)
        mask = None
    dos_idx = lut[idx]
    if mask is not None:
        dos_idx = np.where(mask > 0, dos_idx, bg_index)
    return dos_idx.astype(np.uint8)


def build_tileset_conversions(lut, by_name):
    """{dos_entry_name: (h, w) uint8 array} for every resolvable TILESET_MAP
    entry. `by_name` supplies each target entry's real, per-entry `colorkey`
    field from the actual clipper.clp directory -- masked sub-images are
    background-filled with *that* entry's own key, not a single hardcoded
    index (see DOS_RESERVED_INDICES)."""
    src_path = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfz'
    s1_path = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
    if not src_path.exists() or not s1_path.exists():
        print('  tileset swap: skipped (missing bcdfz or decompressed bcdft; '
              'run tools/bcdft_decompress first)')
        return {}

    s1 = s1_path.read_bytes()
    raw = src_path.read_bytes()
    chunks = bcdfxyz.read_chunks(s1, raw, 'bcdfz', bclib.rle_decompress)

    out = {}
    for name, recipe in TILESET_MAP.items():
        bg_index = by_name[name]['colorkey']
        kind = recipe[0]
        if kind == 'direct':
            out[name] = decode_tileset_label(chunks, recipe[1], lut, bg_index)
        elif kind == 'hflip':
            out[name] = np.fliplr(decode_tileset_label(chunks, recipe[1], lut, bg_index))
        elif kind == 'hconcat':
            pieces = [decode_tileset_label(chunks, lbl, lut, bg_index) for lbl in recipe[1]]
            out[name] = np.hstack(pieces)
        else:
            raise ValueError(f'unknown recipe kind {kind!r}')
    return out


def build_rock_eye_conversions(lut, target_dims, target_colorkeys):
    """{dos_entry_name: (h, w) uint8 array}, each resized to `target_dims`
    (from the real directory entries, not hardcoded). `target_colorkeys`
    supplies each target entry's own real per-entry `colorkey` field --
    every Rock Eye slot happens to carry 33 in the real file, but this is
    read, not assumed (see DOS_RESERVED_INDICES)."""
    src_path = ROOT / 'data' / 'blackcrypt' / 'amiga' / GREEN_GUY_FILE
    if not src_path.exists():
        print(f'  Rock Eye swap: skipped (missing {GREEN_GUY_FILE})')
        return {}

    raw = src_path.read_bytes()
    dec = bclib.rle_decompress(raw, bclib.MONSTER_STREAM_START)

    # (offset, width, height) for each of Green Guy's 4 real Amiga frames --
    # from public/assets/blackcrypt/amiga/data/monster-names.json group
    # index 3 ("Map 2 Creature B", gfxId 0xb0).
    frame_geoms = [(23660, 96, 75), (29960, 80, 46), (33180, 48, 23), (34146, 32, 14)]
    frames = []
    for off, w, h in frame_geoms:
        bpr = w // 8
        blob = dec[off:off + 7 * bpr * h]
        idx, mask = bclib.decode_masked(blob, w, h, 6)
        dos_idx = lut[idx]
        frames.append((dos_idx, mask))

    out = {}
    for name, frame_i in ROCK_EYE_MAP.items():
        dos_idx, mask = frames[frame_i]
        bg_index = target_colorkeys[name]
        filled = np.where(mask > 0, dos_idx, bg_index).astype(np.uint8)
        h, w = target_dims[name]
        out[name] = resize_nearest(filled, w, h)
    return out


def patch(data: bytes) -> bytes:
    entries = parse_directory(data)
    preflight_check(entries)

    out = bytearray(data)

    dos_pal_entry = next(e for e in entries if e['name'].strip() == 'Palette')
    pal_bytes = data[dos_pal_entry['data_offset']:
                      dos_pal_entry['data_offset'] + dos_pal_entry['size']]
    dos_palette_rgb = np.frombuffer(pal_bytes, dtype=np.uint8).reshape(256, 3)

    changed = []  # (name, index, data_offset, size) for the report

    def write_entry(name, arr):
        e = by_name[name]
        h, w = arr.shape
        if (w, h) != (e['width'], e['height']):
            raise ValueError(
                f'{name}: converted art is {w}x{h}, directory entry is '
                f'{e["width"]}x{e["height"]} -- refusing a size-changing '
                f'write (this script only implements the same-size path)')
        blob = arr.tobytes()
        if len(blob) != e['size']:
            raise ValueError(
                f'{name}: {len(blob)} B of pixel data != directory size '
                f'{e["size"]} B')
        out[e['data_offset']:e['data_offset'] + e['size']] = blob
        changed.append((name, e['index'], e['data_offset'], e['size']))

    by_name = {}
    for e in entries:
        by_name.setdefault(e['name'].strip(), e)  # first occurrence wins

    # --- Tileset swap (bcdfz, ramp 2 "bone/cream") -------------------------
    s1_path = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_decompressed.bin'
    s2_path = ROOT / 'data' / 'blackcrypt' / 'extracted' / 'bcdft_s2_data.bin'
    if s1_path.exists() and s2_path.exists():
        s1, s2 = s1_path.read_bytes(), s2_path.read_bytes()
        words = bclib.read_palette_words(s1, bclib.BCDFT_DUNGEON_PALETTE, 32)
        accent = bclib.read_accent_ramp(s1, 2)  # bcdfz's exclusive ramp
        ramp2_flat = bclib.ehb_palette(words[:26] + accent)
        tileset_lut = ehb_to_dos_lut(dos_palette_rgb, ramp2_flat)
        for name, arr in build_tileset_conversions(tileset_lut, by_name).items():
            write_entry(name, arr)

    # --- Rock Eye -> Green Guy swap -----------------------------------------
    monster_pal_path = Path(__file__).resolve().parent / 'palette_final.json'
    if monster_pal_path.exists():
        monster_flat = bclib.load_palette_json(monster_pal_path)
        monster_lut = ehb_to_dos_lut(dos_palette_rgb, monster_flat)
        target_dims = {name: (by_name[name]['height'], by_name[name]['width'])
                       for name in ROCK_EYE_MAP}
        target_colorkeys = {name: by_name[name]['colorkey'] for name in ROCK_EYE_MAP}
        for name, arr in build_rock_eye_conversions(
                monster_lut, target_dims, target_colorkeys).items():
            write_entry(name, arr)

    return bytes(out), changed, entries


def _self_check(original: bytes, patched: bytes, changed, entries) -> None:
    if len(original) != len(patched):
        raise AssertionError(
            f'self-check failed: output length {len(patched)} != input '
            f'length {len(original)} (this swap must never change file size)')

    header_len = HEADER_SIZE + len(entries) * DIR_ENTRY_SIZE
    if original[:header_len] != patched[:header_len]:
        raise AssertionError(
            'self-check failed: header+directory region differs -- this '
            'swap must never touch directory metadata, only pixel bytes')

    touched_windows = [(off, off + size) for _, _, off, size in changed]

    def in_touched(i):
        return any(lo <= i < hi for lo, hi in touched_windows)

    n_diff_outside = 0
    n_diff_inside = 0
    first_bad = None
    for i in range(header_len, len(original)):
        if original[i] != patched[i]:
            if in_touched(i):
                n_diff_inside += 1
            else:
                n_diff_outside += 1
                if first_bad is None:
                    first_bad = i
    if n_diff_outside:
        raise AssertionError(
            f'self-check failed: {n_diff_outside} byte(s) changed outside '
            f'every declared touched window, e.g. offset {first_bad:#x}')
    print(f'  self-check OK: header+directory (first {header_len} B) '
          f'byte-identical; {n_diff_inside} pixel bytes changed across '
          f'{len(changed)} entries, 0 differences anywhere else in the file')


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Proof-of-concept Amiga->DOS art swap for Black Crypt\'s '
                    'clipper.clp (see docs/blackcrypt/dos/'
                    'full-game-restoration-plan.md, "Phase 3a"). Never '
                    'modifies the input in place.')
    ap.add_argument('input', type=Path, help='Your own stock clipper.clp')
    ap.add_argument('output', type=Path, help='Path to write the patched copy to')
    ap.add_argument('--force', action='store_true',
                     help='Overwrite --output if it already exists')
    args = ap.parse_args()

    in_path, out_path = args.input.resolve(), args.output.resolve()
    if in_path == out_path:
        print('error: input and output must be different files', file=sys.stderr)
        return 1
    if out_path.exists() and not args.force:
        print(f'error: {out_path} already exists (pass --force)', file=sys.stderr)
        return 1

    original = in_path.read_bytes()
    try:
        patched, changed, entries = patch(original)
    except ValueError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    out_path.write_bytes(patched)
    written = out_path.read_bytes()
    try:
        _self_check(original, written, changed, entries)
    except AssertionError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1

    tileset_n = sum(1 for n, *_ in changed if n in TILESET_MAP)
    rockeye_n = sum(1 for n, *_ in changed if n in ROCK_EYE_MAP)
    print(f'patched {in_path} ({len(original)} B) -> {out_path} '
          f'({len(patched)} B, unchanged length)')
    print(f'  tileset entries swapped (bcdfz, ramp 2): {tileset_n} / '
          f'{len(TILESET_MAP)} mapped ({len(TILESET_MAP)}/70 of map 1\'s '
          f'tileset; Wall Left/Right left as original bcdfx pixels)')
    print(f'  Rock Eye entries swapped (-> Green Guy): {rockeye_n} / '
          f'{len(ROCK_EYE_MAP)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

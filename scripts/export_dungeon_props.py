#!/usr/bin/env python3
"""M5 (`docs/blackcrypt/walker-plan.md`): decode + verify the 7 non-wall
structure-class placement/geometry tables the walker plan flagged as located
but never transcribed, and emit them as `prop:*` slots into
`public/assets/blackcrypt/amiga/dungeon/slots.json` (merged, upsert-by-key)
plus a companion `props.json` for the entity-driven classes buildViewList
needs extra lookup tables for (door lock's per-map art, floor-item's
gfx->group->sprite resolution).

Every table below was re-derived **from a fresh disassembly pass this
session** (not transcribed from the walker-plan's summary prose, which in a
couple of spots undercounts or mislabels a table) -- see
`docs/blackcrypt/amiga/data-structure.md` "M5 -- prop placement tables" for
the citations. All addresses are decompressed `bcdft` S_1 offsets (this
script's own `S1_PATH`, i.e. `data/blackcrypt/extracted/bcdft_decompressed.bin`).

## The shared 18-byte descriptor pool (`+0x1D9E6`)

Alcove (`+0x24F60`), Plaque (`+0x250C0`) and Stairs (`+0x251FE`) are three
different *index* tables that all dereference into the **same** pool of
18-byte descriptors at `+0x1D9E6` -- confirmed by disassembling all three
renderers this pass (each does `LEA 0x1d9e6(pc),a0` before adding the
index-table's fetched byte offset). The walker-plan's "third record format"
description of the stairs table was a false distinction: it is the identical
18-byte shape already documented for alcove/plaque at `+0x24F0A`:

    +0x00 u16  slot            -- d16(A5) bank displacement (0xBC/0xC0/0xC4)
    +0x02 u32  src             -- byte offset within that slot
    +0x06 u16  bytesPerRow-1
    +0x08 u16  rows-1
    +0x0A u16  srcAdvance
    +0x0C u16  destAdvance
    +0x0E u16  extraSrcOffset
    +0x10 u16  destOffsetWithinPlane

`width = (bytesPerRow) * 8`, `height = rows`.

## Alcove / Plaque index tables (36 words each)

`+0x24F60`/`+0x250C0` both do the identical arithmetic:
`byteOffset = depth*24 + (lateral+1)*8 + dir*2`, `depth in {0,1,2}`
(bails if depth==3), `lateral in {-1,0,1}`, `dir in {0,1,2,3}` (party-relative:
0=facing,1=right,2=behind,3=left; the caller bails before this function for
`depth>=3`, this function's own `depth==3` guard is defensive). That is
`depth(3) x lateral(3) x dir(4) = 36` entries exactly. A `0` entry means "no
alcove/plaque for this combination"; a nonzero entry is a byte offset into
the shared pool.

## Stairs index table (9 words, `+0x25232`)

`+0x251FE(depth+1, lateral, flight)`: `byteOffset = depth*6 + (lateral+1)*2`,
`depth in {0,1,2}` (bails if the caller's `depth+1` arg is 0), `lateral in
{-1,0,1}` -- `depth(3) x lateral(3) = 9` entries. The fetched pool offset is
flight A's; flight B adds `+0x7E` (126 = 7*18, i.e. flight B's descriptors
sit exactly 7 pool-records after flight A's -- confirmed, not a second
table) *after* the table lookup, not before.

## Door lock / door switch position tables (9 words each, x4 variants)

`+0x25DA0` (door lock) / `+0x25F9E` (door switch): `byteOffset =
(depth-1)*12 + (lateral+1)*4` into a 9-entry x 4-byte (destX word, destY
word) table, `depth in {1,2,3}` (i.e. local depth 0-2), `lateral in
{-1,0,1}`. Two independent selectors each double the table: `side` (0 -> the
table at the cited "+0x25E12"/"+0x26070" address; 1 -> "+0x25E5A"/"+0x260B8",
exactly 0x48=72 bytes later) and the still-unexplained `$51A(A5)` global (0
-> as above; nonzero -> `+0x24`=36 bytes further into the *same* side's
block). A `destY < 0` entry (`0xFFFF` observed) means "nothing here" -- the
game's own `TST.W / BMI` bails on exactly that field, confirmed in the
disassembly. **Only `side=1` (the party's right) is ever reached in the
shipped game** -- `docs/blackcrypt/amiga/data-structure.md`'s "Kind 3 and the
left-wall position tables" section proves `side=0` is unreachable dead code
(an engine off-by-one), so this script still decodes and verifies all four
variants (self-documenting completeness) but the exporter only emits
`side=1`, `$51A=0` (direct) slots -- the only combination a real pose can
reach.

## Floor plate / trap (kind 4/12, type 0x1E, `+0x21732`)

Renders the *same* single descriptor at up to 13 ("near", depth-local==0,
i.e. caller depth==1) or 11 ("far", depth-local!=0) fixed grid positions --
byte-pair (not word-pair) `(x, y)` tables at `+0x21788` (near, direct),
`+0x217A2` (near, `$48F(A5)` mirrored), `+0x217BC` (far, unconditional -- the
far case does *not* consult the mirror flag, confirmed in the disassembly).
`pressed` (word arg, `1 - word+0x08` of the structure record) selects between
two descriptor pools per distance: `+0x217D2`/`+0x217EE` (near,
unpressed/pressed) and `+0x2180A`/`+0x21826` (far, unpressed/pressed).

**Art source resolved this pass (`blackcrypt-floorplate-art-source`).**
Graphics-kernel slot `$00` is `bcdfa`'s own RLE stream at file offset 0 --
the "Adventure Screen" UI panel bank (`data-structure.md` "bcdfa -- UI Panel
Bank"), already extracted as `sprites/ui-panel.json`. Its own record table
already named the exact 4 records the floor-plate descriptors' `src` fields
point at (18764/18820/18876/18904): `pressure_plate_1_up`/`_1_down`
(16x4, **near**) and `pressure_plate_2_up`/`_2_down` (16x2, **far**), each
already matched 100.000% against DOS `clipper.clp` entries 79/81/80/82. A
prior pass's "Still open" characterization never cross-referenced this
already-solved section of the same doc against the floor-plate renderer's
own `src` values -- `read_floorplate` below now does exactly that,
byte-exact, 4/4, and raises rather than silently mis-binding if a future
`ui-panel.json` re-extraction ever renames/moves a frame.

## Floor-item placement (kind 8/9 & 0-3 default, `+0x218FA`/`+0x21C84`)

Three more tables beyond the already-extracted 10-byte sprite-geometry table
(`+0x271B6`) and its gfx->group selector (`+0x26FDE`, already exported as
`data/floor-item-gfx-table.json`):

* `+0x21992` (36 B): 9-entry x 4-byte `(anchorX, anchorY)` word-pairs, indexed
  `depth*12 + (lateral+1)*4` -- same shape as the door lock/switch position
  tables, no "none" sentinel check in the consumer.
* `+0x27774` (588 B = 49 groups x 3 depths x 4 B): per-(group, depth)
  `(registrationX, registrationY)` word-pairs, indexed `group*12 + depth*4`.
  Final position is `anchor - registration` (+ scatter, see next).
* `+0x220CC` (36 B = 9 x 4 B): a scatter table of `(dx, dy)` word-pairs,
  applied only at `depth==0`, indexed by a global counter (`$498(A5)`) that
  decrements 8..0 and wraps -- "several items dropped on the party's own
  square do not stack exactly" (`data-structure.md`).

This script decodes and verifies all three tables. Wiring full per-item
placement into `buildViewList` (which needs the entity's own `gfxNumber` to
resolve group, sprite frame and registration) is **not done this pass** --
see the M5 report for the scoping call. Tracked as
`blackcrypt-floor-item-placement` in `docs/blackcrypt/TODO.md`.

Usage:
    python3 scripts/export_dungeon_props.py
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
PROPS_PATH = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'dungeon' / 'props.json'

VIEWPORT_W, VIEWPORT_H = 208, 140

POOL_BASE = 0x1D9E6

ALCOVE_INDEX = 0x24F90     # 36 words
PLAQUE_INDEX = 0x250F0     # 36 words
STAIRS_INDEX = 0x25232     # 9 words
STAIRS_FLIGHT_B_ADD = 0x7E

DOOR_LOCK_SIDE0 = 0x25E12  # direct(36B) + variant(36B)
DOOR_LOCK_SIDE1 = 0x25E5A  # direct(36B) + variant(36B)
DOOR_LOCK_POOL = 0x25EA2   # 9 x 28B, index (gfx-0x51)*0x54 + (depth-1)*0x1C

DOOR_SWITCH_SIDE0 = 0x26070
DOOR_SWITCH_SIDE1 = 0x260B8
DOOR_SWITCH_POOL = 0x26000  # 4 x 28B, index depth*0x1C

FLOORPLATE_NEAR_POS_DIRECT = 0x21788   # 13 x 2B byte-pairs
FLOORPLATE_NEAR_POS_MIRROR = 0x217A2   # 13 x 2B
FLOORPLATE_FAR_POS = 0x217BC            # 11 x 2B
FLOORPLATE_NEAR_UNPRESSED = 0x217D2     # 1 x 28B
FLOORPLATE_NEAR_PRESSED = 0x217EE       # 1 x 28B
FLOORPLATE_FAR_UNPRESSED = 0x2180A      # 1 x 28B
FLOORPLATE_FAR_PRESSED = 0x21826        # 1 x 28B

# `blackcrypt-floorplate-art-source` -- resolved. Slot $00 is `bcdfa`'s own
# RLE stream at file offset 0 (the "Adventure Screen" UI panel bank, see
# data-structure.md "bcdfa -- UI Panel Bank"), already extracted as
# sprites/ui-panel.json. Its 4 named "Pressure Plate" records are exactly
# the 4 floor-plate descriptors' src offsets (18764/18820/18876/18904),
# confirmed byte-exact below.
UI_PANEL_BANK_ID = 'ui-panel'
UI_PANEL_ATLAS_PATH = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'sprites' / 'ui-panel.json'
FLOORPLATE_FRAMES = {
    'near-unpressed': ('pressure_plate_1_up', 18764, 16, 4),
    'near-pressed': ('pressure_plate_1_down', 18820, 16, 4),
    'far-unpressed': ('pressure_plate_2_up', 18876, 16, 2),
    'far-pressed': ('pressure_plate_2_down', 18904, 16, 2),
}

FLOORITEM_ANCHOR = 0x21992   # 9 x 4B
FLOORITEM_REGISTRATION = 0x27774  # 49 x 3 x 4B
FLOORITEM_SCATTER = 0x220CC  # 9 x 4B
FLOORITEM_GFX_TABLE_PATH = ROOT / 'public' / 'assets' / 'blackcrypt' / 'amiga' / 'data' / 'floor-item-gfx-table.json'

BANK_ID = 'dungeon-bcdfx'
BANK = {'id': BANK_ID, 'atlas': 'textures/dungeon-bcdfx.json', 'image': 'textures/dungeon-bcdfx.png'}
DECOR_BANK_ID = 'wall-decorations'
DECOR_BANK = {'id': DECOR_BANK_ID, 'atlas': 'sprites/wall-decorations.json', 'image': 'sprites/wall-decorations.png'}
FLOORITEM_BANK_ID = 'dungeon-floor-items'
FLOORITEM_BANK = {'id': FLOORITEM_BANK_ID, 'atlas': 'sprites/floor-items.json', 'image': 'sprites/floor-items.png'}


# ---------------------------------------------------------------------------
# Shared 18-byte pool descriptor + name resolution
# ---------------------------------------------------------------------------

#: The loader's own generated horizontal-mirror copies (`OpenTilesetFile`,
#: `data-structure.md` "bcdfx/bcdfz payload P4/P5"), keyed by (slot, src) ->
#: (base frame name, geometry). Not in `bcdfxyz.SUB_IMAGES` because they are
#: not authored art -- render them as `mirrorX: true` of the base frame.
GENERATED_MIRRORS = {
    (0xBC, 11580): ('alcove-d', 32, 54),
    (0xBC, 12876): ('alcove-e', 16, 36),
    (0xC0, 11580): ('plaque-d', 32, 60),
    (0xC0, 13020): ('plaque-e', 16, 37),
}


def _sub_images_by_slot_src():
    out = {}
    for name, slot, offset, w, h, planes in bcdfxyz.SUB_IMAGES:
        out[(slot, offset)] = (name, w, h)
    return out


def read_pool_descriptor(s1, byte_offset):
    off = POOL_BASE + byte_offset
    slot, src, bpr_m1, rows_m1, src_adv, dst_adv, extra_src, dst_off = \
        struct.unpack_from('>HIHHHHHH', s1, off)
    width = (bpr_m1 + 1) * 8
    height = rows_m1 + 1
    return {'slot': slot, 'src': src, 'width': width, 'height': height,
            'srcAdvance': src_adv, 'extraSrcOffset': extra_src,
            'destOffsetWithinPlane': dst_off}


def _resolve_crop(desc, full_w, full_h, label):
    """`blackcrypt-prop-clipped-descriptors` (docs/blackcrypt/TODO.md) --
    resolved. 8 of 36+36+18 pool descriptors are narrower than their
    `(slot, src)` sibling's full geometry: an angled (non-dead-ahead)
    alcove/plaque/stairs view that crops the art horizontally. Comparing all
    8 against their full-width siblings (byte-for-byte, this pass) shows
    `extraSrcOffset` (in *bytes*, i.e. `x8` for pixels, matching this
    18-byte format's own bytesPerRow-based width field) is always exactly
    one of two values: `0` (keep the art's own *left* edge, crop the right)
    or `fullWidthBytes - clippedWidthBytes` (keep the *right* edge, crop the
    left) -- never a middle offset, and `srcAdvance` always equals that same
    byte delta (the per-row skip needed to stay aligned to the full image's
    real row stride once fewer bytes are read per row). This is not a
    special crop convention needing new render logic -- it is a plain
    horizontal pixel-rect crop of the *already-decoded* full sub-image
    (`bcdfxyz.SUB_IMAGES`/`GENERATED_MIRRORS` already resolve pixel data,
    not raw planes), so it's expressed the same way any other partial-frame
    draw already is: `PieceDraw.srcX`/`srcW` (both already-supported,
    already-consumed-by-the-compositor fields -- `raster/composite.ts`'s
    `drawPieceDraw` has read `draw.srcX ?? rect.x` since M1). Returns
    `(srcX, srcW, srcH)` in pixels, or `None` if not clipped (dest geometry
    matches the sibling's own full size exactly).
    """
    if (full_w, full_h) == (desc['width'], desc['height']):
        return None
    if full_h != desc['height'] or desc['width'] >= full_w:
        raise ValueError(f'{label}: geometry {desc["width"]}x{desc["height"]} disagrees with '
                          f'full sibling {full_w}x{full_h} (not a recognized horizontal crop)')
    extra_px = desc['extraSrcOffset'] * 8
    delta_px = full_w - desc['width']
    if extra_px not in (0, delta_px):
        raise ValueError(f'{label}: extraSrcOffset {extra_px}px is neither 0 nor the full/clip '
                          f'delta {delta_px}px -- not an edge-aligned crop, cannot resolve')
    if desc['srcAdvance'] * 8 != delta_px:
        raise ValueError(f'{label}: srcAdvance {desc["srcAdvance"]*8}px != full/clip delta '
                          f'{delta_px}px -- row stride would desync from the full image')
    return extra_px, desc['width'], full_h


def resolve_pool_frame(desc, sub_images, label=''):
    """Returns `(name, mirrorX, crop)` -- `crop` is `None` for a full-width
    descriptor, or `(srcX, srcW, srcH)` pixels for a clipped one (see
    `_resolve_crop`)."""
    key = (desc['slot'], desc['src'])
    if key in sub_images:
        name, w, h = sub_images[key]
        crop = _resolve_crop(desc, w, h, f'{label} {key} "{name}"')
        return name, False, crop
    if key in GENERATED_MIRRORS:
        name, w, h = GENERATED_MIRRORS[key]
        crop = _resolve_crop(desc, w, h, f'{label} {key} mirrored "{name}"')
        return name, True, crop
    raise ValueError(f'pool descriptor at slot {desc["slot"]:#x} src {desc["src"]} '
                      f'has no named sub-image or known generated mirror')


# ---------------------------------------------------------------------------
# Alcove / Plaque (36-word index tables into the shared pool)
# ---------------------------------------------------------------------------

def read_alcove_plaque_index(s1, table_off, sub_images, label):
    """Returns dict {(depth, lateral, dir): {...}} for nonzero entries;
    verifies every dest position lands inside the 208x140 viewport once
    resolved through the destOffsetWithinPlane field. Clipped (angled-view)
    entries are included with a `crop` key -- see `_resolve_crop`."""
    out = {}
    n_nonzero = 0
    n_clipped = 0
    for depth in range(3):
        for lat_idx in range(3):        # lateral -1, 0, +1
            for dir_ in range(4):
                byte_off = depth * 24 + lat_idx * 8 + dir_ * 2
                value = struct.unpack_from('>H', s1, table_off + byte_off)[0]
                if value == 0:
                    continue
                n_nonzero += 1
                desc = read_pool_descriptor(s1, value)
                frame, mirror, crop = resolve_pool_frame(desc, sub_images, f'{label} ({depth},{lat_idx-1},{dir_})')
                if crop is not None:
                    n_clipped += 1
                dest = desc['destOffsetWithinPlane']
                y, x = dest // 40, (dest % 40) * 8
                if not (0 <= x < VIEWPORT_W and 0 <= y < VIEWPORT_H):
                    raise ValueError(f'{label} ({depth},{lat_idx-1},{dir_}): dest ({x},{y}) '
                                      f'outside {VIEWPORT_W}x{VIEWPORT_H} viewport')
                out[(depth, lat_idx - 1, dir_)] = {
                    'frame': frame, 'mirrorX': mirror, 'destX': x, 'destY': y,
                    'w': desc['width'], 'h': desc['height'], 'crop': crop,
                }
    print(f'  {label}: {n_nonzero}/36 nonzero index entries -- {len(out)} resolved and emitted '
          f'({n_clipped} of those horizontally-clipped angled views, wired via srcX/srcW)')
    return out


# ---------------------------------------------------------------------------
# Stairs (9-word index table, 2 flights via +0x7E)
# ---------------------------------------------------------------------------

def read_stairs_index(s1, sub_images):
    out = {}
    n = 0
    n_clipped = 0
    for depth in range(3):
        for lat_idx in range(3):
            byte_off = depth * 6 + lat_idx * 2
            base_value = struct.unpack_from('>H', s1, STAIRS_INDEX + byte_off)[0]
            if base_value == 0:
                continue
            for flight, add in (('a', 0), ('b', STAIRS_FLIGHT_B_ADD)):
                desc = read_pool_descriptor(s1, base_value + add)
                frame, mirror, crop = resolve_pool_frame(desc, sub_images, f'stairs ({depth},{lat_idx-1},{flight})')
                if crop is not None:
                    n_clipped += 1
                dest = desc['destOffsetWithinPlane']
                y, x = dest // 40, (dest % 40) * 8
                if not (0 <= x < VIEWPORT_W and 0 <= y < VIEWPORT_H):
                    raise ValueError(f'stairs ({depth},{lat_idx-1},{flight}): dest ({x},{y}) '
                                      f'outside viewport')
                out[(depth, lat_idx - 1, flight)] = {
                    'frame': frame, 'mirrorX': mirror, 'destX': x, 'destY': y,
                    'w': desc['width'], 'h': desc['height'], 'crop': crop,
                }
                n += 1
    print(f'  stairs: {n} resolved and emitted ({n_clipped} of those horizontally-clipped, wired via srcX/srcW) '
          f'of 18 (9 positions x 2 flights)')
    return out


# ---------------------------------------------------------------------------
# Door lock / door switch (9-entry x 4B position tables x4 variants + pool)
# ---------------------------------------------------------------------------

def read_position_table_9(s1, base_off):
    """9 entries (depth 0-2 x lateral -1/0/+1) of (destX, destY) i16 words.
    `None` when destY < 0 (the game's own 'nothing here' sentinel)."""
    out = {}
    for depth in range(3):
        for lat_idx in range(3):
            off = base_off + depth * 12 + lat_idx * 4
            x, y = struct.unpack_from('>hh', s1, off)
            out[(depth, lat_idx - 1)] = None if y < 0 else (x, y)
    return out


def read_door_lock(s1):
    """9 x 28-byte descriptors at `+0x25EA2`, index (gfx-0x51)*0x54 + (depth-1)*0x1C.
    3 gfxNumbers (0x51/0x52/0x53) x 3 depths. Frame comes from the per-map
    `wall-decorations` bank (`m{mapId}_decor{gfxIdx}_{depthLabel}`), not the
    shared tileset -- resolved at runtime, so this returns geometry (w,h) for
    verification and the (gfxIdx, depthLabel) mapping, not a frame name.
    """
    depth_labels = ('near', 'mid', 'far')
    sizes = {'near': (16, 20), 'mid': (16, 15), 'far': (16, 11)}
    out = {}
    n_ok = 0
    for gfx_idx in range(3):
        for depth in range(3):
            index = gfx_idx * 0x54 + depth * 0x1C
            off = DOOR_LOCK_POOL + index
            slot, src, bpp, mask_src, bltsize, modulo, dx, dy, flags, w, h = \
                struct.unpack_from('>HIIIHHHHHHH', s1, off)
            expect_bpp = (w // 8) * h
            if bpp != expect_bpp:
                raise ValueError(f'door lock desc gfxIdx={gfx_idx} depth={depth}: '
                                  f'bytesPerPlane {bpp} != {expect_bpp}')
            expect_bltsize = (h << 6) | (w // 16 + 1)
            if bltsize != expect_bltsize:
                raise ValueError(f'door lock desc gfxIdx={gfx_idx} depth={depth}: '
                                  f'BLTSIZE {bltsize:#x} != {expect_bltsize:#x}')
            blit_bytes = (w // 16 + 1) * 2
            if modulo + blit_bytes != 40:
                raise ValueError(f'door lock desc gfxIdx={gfx_idx} depth={depth}: '
                                  f'modulo {modulo} + blitBytes {blit_bytes} != 40')
            label = depth_labels[depth]
            if (w, h) != sizes[label]:
                raise ValueError(f'door lock desc gfxIdx={gfx_idx} depth={depth}: '
                                  f'geometry {w}x{h} != expected {sizes[label]}')
            out[gfx_idx] = out.get(gfx_idx, {})
            out[gfx_idx][depth] = {'depthLabel': label, 'w': w, 'h': h}
            n_ok += 1
    print(f'  door lock pool: {n_ok}/9 descriptors pass all invariants '
          f'(bytesPerPlane, BLTSIZE, modulo, geometry-vs-per-level-decor-size)')

    variants = {}
    for name, base in (('side0-direct', DOOR_LOCK_SIDE0),
                        ('side0-variant', DOOR_LOCK_SIDE0 + 0x24),
                        ('side1-direct', DOOR_LOCK_SIDE1),
                        ('side1-variant', DOOR_LOCK_SIDE1 + 0x24)):
        variants[name] = read_position_table_9(s1, base)
    n_pos = sum(1 for v in variants['side1-direct'].values() if v is not None)
    print(f'  door lock position (side1-direct): {n_pos}/9 non-blanked entries')
    return out, variants


def read_door_switch(s1):
    """4 x 28-byte descriptors at `+0x26000`, index depth*0x1C (local depth
    0-2 reachable per the 3-depth position table; the 4th pool entry is
    presumably as structurally dead as the door lock/switch `side=0` tables
    -- see module docstring)."""
    sub_images = _sub_images_by_slot_src()
    out = {}
    for depth in range(3):
        off = DOOR_SWITCH_POOL + depth * 0x1C
        slot, src, bpp, mask_src, bltsize, modulo, dx, dy, flags, w, h = \
            struct.unpack_from('>HIIIHHHHHHH', s1, off)
        expect_bpp = (w // 8) * h
        if bpp != expect_bpp:
            raise ValueError(f'door switch desc depth={depth}: bytesPerPlane {bpp} != {expect_bpp}')
        expect_bltsize = (h << 6) | (w // 16 + 1)
        if bltsize != expect_bltsize:
            raise ValueError(f'door switch desc depth={depth}: BLTSIZE {bltsize:#x} != {expect_bltsize:#x}')
        blit_bytes = (w // 16 + 1) * 2
        if modulo + blit_bytes != 40:
            raise ValueError(f'door switch desc depth={depth}: modulo {modulo} + blitBytes {blit_bytes} != 40')
        key = (slot, src)
        if key not in sub_images:
            raise ValueError(f'door switch desc depth={depth}: slot {slot:#x} src {src} '
                              f'has no named sub-image')
        name, sw, sh = sub_images[key]
        if (sw, sh) != (w, h):
            raise ValueError(f'door switch desc depth={depth}: geometry {w}x{h} != SUB_IMAGES {sw}x{sh}')
        out[depth] = {'frame': name, 'w': w, 'h': h}
    print(f'  door switch pool: 3/3 descriptors pass all invariants, '
          f'resolved to {[v["frame"] for v in out.values()]}')

    variants = {}
    for name, base in (('side0-direct', DOOR_SWITCH_SIDE0),
                        ('side0-variant', DOOR_SWITCH_SIDE0 + 0x24),
                        ('side1-direct', DOOR_SWITCH_SIDE1),
                        ('side1-variant', DOOR_SWITCH_SIDE1 + 0x24)):
        variants[name] = read_position_table_9(s1, base)
    n_pos = sum(1 for v in variants['side1-direct'].values() if v is not None)
    print(f'  door switch position (side1-direct): {n_pos}/9 non-blanked entries')
    return out, variants


# ---------------------------------------------------------------------------
# Floor plate / trap -- geometry only, art source unresolved
# ---------------------------------------------------------------------------

def read_floorplate(s1):
    def read_byte_pairs(off, n):
        # Unsigned: signed reads a handful of near-table (x,y) pairs
        # negative (e.g. -128, -123) yet fall in-viewport (128, 133) reading
        # unsigned -- so these coordinates are u8, not i8, unlike the i16
        # word-pair position tables elsewhere in this script.
        return [struct.unpack_from('>BB', s1, off + i * 2) for i in range(n)]

    near_direct = read_byte_pairs(FLOORPLATE_NEAR_POS_DIRECT, 13)
    near_mirror = read_byte_pairs(FLOORPLATE_NEAR_POS_MIRROR, 13)
    far_pos = read_byte_pairs(FLOORPLATE_FAR_POS, 11)

    def read_desc(off):
        slot, src, bpp, mask_src, bltsize, modulo, dx, dy, flags, w, h = \
            struct.unpack_from('>HIIIHHHHHHH', s1, off)
        expect_bpp = (w // 8) * h
        expect_bltsize = (h << 6) | (w // 16 + 1)
        blit_bytes = (w // 16 + 1) * 2
        ok = (bpp == expect_bpp and bltsize == expect_bltsize and modulo + blit_bytes == 40)
        return {'slot': slot, 'src': src, 'w': w, 'h': h, 'ok': ok}

    descs = {
        'near-unpressed': read_desc(FLOORPLATE_NEAR_UNPRESSED),
        'near-pressed': read_desc(FLOORPLATE_NEAR_PRESSED),
        'far-unpressed': read_desc(FLOORPLATE_FAR_UNPRESSED),
        'far-pressed': read_desc(FLOORPLATE_FAR_PRESSED),
    }
    n_ok = sum(1 for d in descs.values() if d['ok'])
    if n_ok != 4:
        raise ValueError(f'floor plate: only {n_ok}/4 descriptors pass invariants: {descs}')
    slots_seen = {d['slot'] for d in descs.values()}
    if slots_seen != {0}:
        raise ValueError(f'floor plate: expected all 4 descriptors in slot 0x0, got {slots_seen}')

    # `blackcrypt-floorplate-art-source` -- resolved: cross-check each
    # descriptor's own (src, w, h) against the expected UI-panel record and
    # against the already-extracted atlas's own frame rect. Any mismatch
    # (wrong src, wrong geometry, or a future ui-panel.json re-extraction
    # that renamed/moved a frame) raises rather than silently mis-binding art.
    ui_panel_atlas = json.loads(UI_PANEL_ATLAS_PATH.read_text())
    ui_panel_frames = {f['name']: f for f in ui_panel_atlas['frames']}
    for key, desc in descs.items():
        frame_name, expect_src, expect_w, expect_h = FLOORPLATE_FRAMES[key]
        if desc['src'] != expect_src or (desc['w'], desc['h']) != (expect_w, expect_h):
            raise ValueError(f'floor plate {key}: descriptor (src={desc["src"]}, w={desc["w"]}, '
                              f'h={desc["h"]}) disagrees with expected {frame_name} '
                              f'(src={expect_src}, w={expect_w}, h={expect_h})')
        rect = ui_panel_frames.get(frame_name)
        if rect is None or (rect['w'], rect['h']) != (expect_w, expect_h):
            raise ValueError(f'floor plate {key}: ui-panel.json has no matching frame '
                              f'"{frame_name}" ({expect_w}x{expect_h})')
        desc['frame'] = frame_name
    print(f'  floor plate: 4/4 descriptor invariants pass, all in slot 0x0 -- ART SOURCE RESOLVED: '
          f'{[FLOORPLATE_FRAMES[k][0] for k in descs]} (bcdfa UI panel bank, '
          f'public/assets/blackcrypt/amiga/sprites/ui-panel.json), 4/4 byte-exact against src/geometry')
    print(f'  floor plate: 13 near positions (direct + mirrored), 11 far positions decoded')

    def in_viewport(pairs):
        return all(0 <= x < VIEWPORT_W and 0 <= y < VIEWPORT_H for x, y in pairs)

    if not (in_viewport(near_direct) and in_viewport(near_mirror) and in_viewport(far_pos)):
        raise ValueError('floor plate: a position falls outside the 208x140 viewport')
    print('  floor plate: all near/far positions fall inside the 208x140 viewport')

    return {
        'nearPositionsDirect': near_direct, 'nearPositionsMirrored': near_mirror,
        'farPositions': far_pos, 'descriptors': descs,
    }


# ---------------------------------------------------------------------------
# Floor-item anchor / registration / scatter tables
# ---------------------------------------------------------------------------

def read_floor_item_tables(s1):
    anchor = {}
    for depth in range(3):
        for lat_idx in range(3):
            off = FLOORITEM_ANCHOR + depth * 12 + lat_idx * 4
            x, y = struct.unpack_from('>hh', s1, off)
            anchor[(depth, lat_idx - 1)] = (x, y)
    print(f'  floor-item anchor table: 9/9 (depth x lateral) entries decoded')

    registration = {}
    for group in range(49):
        for depth in range(3):
            off = FLOORITEM_REGISTRATION + group * 12 + depth * 4
            x, y = struct.unpack_from('>hh', s1, off)
            registration[(group, depth)] = None if y < 0 else (x, y)
    n_valid = sum(1 for v in registration.values() if v is not None)
    print(f'  floor-item registration table: {n_valid}/147 (group x depth) entries valid')

    scatter = []
    for i in range(9):
        off = FLOORITEM_SCATTER + i * 4
        x, y = struct.unpack_from('>hh', s1, off)
        scatter.append((x, y))
    print(f'  floor-item scatter table: 9/9 (dx,dy) entries decoded')

    return {'anchor': anchor, 'registration': registration, 'scatter': scatter}


# ---------------------------------------------------------------------------
# slots.json emission
# ---------------------------------------------------------------------------

#: `@seer/dungeon`'s `schema/slots.ts` `FrameTemplate` shape -- door-lock's
#: art is per-map (`sprites/wall-decorations.json`, frame
#: `m{mapId}_decor{gfxIndex}_{near|mid|far}`), so its slot frame can't be a
#: literal string the way alcove/plaque/stairs/door-switch's are.
#: `buildViewList`'s `resolveDoorLockFrame` substitutes all three
#: placeholders from the pose's own `LevelUnit.id` and the entity's
#: `gfxNumber` at render time -- see `blackcrypt-doorlock-rendering` in
#: docs/blackcrypt/TODO.md.
DOOR_LOCK_FRAME_TEMPLATE = 'm{mapId}_decor{gfxIndex}_{depthLabel}'
DOOR_LOCK_HOTSPOT_CODE = 0x6B


def _crop_fields(crop):
    """`blackcrypt-prop-clipped-descriptors` -- resolved crop window (see
    `_resolve_crop`) as the `PieceDraw` fields that already express a
    partial-frame draw (`srcX`/`srcY`/`srcW`/`srcH`, supported since M1).
    Empty dict for an un-clipped (`crop is None`) draw."""
    if crop is None:
        return {}
    src_x, src_w, src_h = crop
    return {'srcX': src_x, 'srcY': 0, 'srcW': src_w, 'srcH': src_h}


def build_prop_slots(alcove, plaque, stairs_pos, door_switch_pos, door_switch_pool, door_lock_pos):
    slots = {}

    for (depth, lateral, dir_), d in alcove.items():
        key = f'prop:alcove:{lateral}:{depth}:{dir_}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': d['frame'], 'destX': d['destX'], 'destY': d['destY'],
            'mirrorX': d['mirrorX'], 'blend': 'replace', **_crop_fields(d['crop']),
            'origin': f'bcdft S_1+{ALCOVE_INDEX:#x} (alcove index table, depth={depth} '
                      f'lateral={lateral} dir={dir_}) -> shared pool +{POOL_BASE:#x}'
                      + (' (horizontally-clipped angled view, see _resolve_crop)' if d['crop'] else ''),
        }]}

    for (depth, lateral, dir_), d in plaque.items():
        key = f'prop:plaque:{lateral}:{depth}:{dir_}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': d['frame'], 'destX': d['destX'], 'destY': d['destY'],
            'mirrorX': d['mirrorX'], 'blend': 'replace', **_crop_fields(d['crop']),
            'origin': f'bcdft S_1+{PLAQUE_INDEX:#x} (plaque index table, depth={depth} '
                      f'lateral={lateral} dir={dir_}) -> shared pool +{POOL_BASE:#x}'
                      + (' (horizontally-clipped angled view, see _resolve_crop)' if d['crop'] else ''),
        }]}

    for (depth, lateral, flight), d in stairs_pos.items():
        key = f'prop:stairs-{flight}:{lateral}:{depth}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': d['frame'], 'destX': d['destX'], 'destY': d['destY'],
            'blend': 'replace', **_crop_fields(d['crop']),
            'origin': f'bcdft S_1+{STAIRS_INDEX:#x} (stairs index table, depth={depth} '
                      f'lateral={lateral} flight={flight}) -> shared pool +{POOL_BASE:#x}'
                      + (' (horizontally-clipped angled view, see _resolve_crop)' if d['crop'] else ''),
        }]}

    # Door switch (pull chain): only side=1 ($51A=0, direct) is reachable --
    # see "Kind 3 and the left-wall position tables" (data-structure.md).
    for (depth, lateral), pos in door_switch_pos['side1-direct'].items():
        if pos is None:
            continue
        x, y = pos
        frame = door_switch_pool[depth]['frame']
        key = f'prop:door-switch:{lateral}:{depth}'
        slots[key] = {'draws': [{
            'bank': BANK_ID, 'frame': frame, 'destX': x, 'destY': y, 'blend': 'mask',
            'hotspot': {'code': 0x64},
            'origin': f'bcdft S_1+{DOOR_SWITCH_SIDE1:#x} (door switch position table, side=1 '
                      f'direct, depth={depth} lateral={lateral}); only reachable side per the '
                      f'confirmed kind-3 off-by-one (data-structure.md)',
        }]}

    # Door lock: same "only side=1 (party right), $51A=0 (direct) is
    # reachable" position table as door switch, but the frame is a
    # FrameTemplate -- resolved at buildViewList time against the pose's own
    # LevelUnit.id and the entity's gfxNumber, not baked in here.
    for (depth, lateral), pos in door_lock_pos['side1-direct'].items():
        if pos is None:
            continue
        x, y = pos
        key = f'prop:door-lock:{lateral}:{depth}'
        slots[key] = {'draws': [{
            'bank': DECOR_BANK_ID, 'frame': {'template': DOOR_LOCK_FRAME_TEMPLATE},
            'destX': x, 'destY': y, 'blend': 'mask',
            'hotspot': {'code': DOOR_LOCK_HOTSPOT_CODE},
            'origin': f'bcdft S_1+{DOOR_LOCK_SIDE1:#x} (door lock position table, side=1 '
                      f'direct, depth={depth} lateral={lateral}); art resolved at render time '
                      f'via the FrameTemplate (per-map wall-decorations bank) -- only reachable '
                      f'side per the confirmed kind-3 off-by-one (data-structure.md)',
        }]}

    return slots


def build_floor_item_placement(floor_item):
    """`@seer/dungeon`'s `FloorItemPlacement` shape (`schema/slots.ts`) --
    the runtime table `buildViewList`'s `resolveFloorItem` reads directly,
    merged into `slots.json` itself (not just `props.json`) since it's
    consumed at render time, unlike the rest of `props.json`'s
    verification-only tables. `blackcrypt-floor-item-placement`
    (docs/blackcrypt/TODO.md)."""
    gfx_table = json.loads(FLOORITEM_GFX_TABLE_PATH.read_text())
    anchor = {f'{depth}:{lateral}': [x, y] for (depth, lateral), (x, y) in floor_item['anchor'].items()}
    registration = {f'{group}:{depth}': [x, y] for (group, depth), xy in floor_item['registration'].items()
                    if xy is not None for (x, y) in [xy]}
    return {
        'bank': FLOORITEM_BANK_ID,
        'gfxToGroup': gfx_table['groups'],
        'noneGroup': gfx_table['none'],
        'anchor': anchor,
        'registration': registration,
    }


def build_props_file(door_lock_pool, door_lock_pos, floor_plate, floor_item):
    door_lock_entries = []
    for (depth, lateral), pos in door_lock_pos['side1-direct'].items():
        if pos is None:
            continue
        x, y = pos
        door_lock_entries.append({'depth': depth, 'lateral': lateral, 'destX': x, 'destY': y})

    door_lock_gfx = []
    for gfx_idx, per_depth in door_lock_pool.items():
        for depth, info in per_depth.items():
            door_lock_gfx.append({
                'gfxIndex': gfx_idx, 'gfxNumber': 0x51 + gfx_idx, 'depth': depth,
                'depthLabel': info['depthLabel'], 'w': info['w'], 'h': info['h'],
            })

    return {
        'schemaVersion': 1,
        'provenance': {
            'spec': 'docs/blackcrypt/amiga/data-structure.md#m5-prop-placement-tables',
        },
        'doorLock': {
            'bank': DECOR_BANK_ID,
            'frameTemplate': 'm{mapId}_decor{gfxIndex}_{depthLabel}',
            'gfxTable': door_lock_gfx,
            'positions': door_lock_entries,
            'note': 'Only side=1 (party right), $51A=0 (direct) is reachable; art is '
                    'per-map (wall-decorations bank), resolved at runtime from the '
                    'entity gfxNumber and the level unit id.',
        },
        'floorPlate': {
            'note': 'Geometry confirmed; art source resolved this pass -- bcdfa UI panel '
                    'bank (sprites/ui-panel.json), frames pressure_plate_{1,2}_{up,down}. '
                    'Not yet wired into buildViewList (the 13-near/11-far fixed sub-tile '
                    'grid positions need their own placement-index derivation, beyond this '
                    'pass\'s scope) -- see docs/blackcrypt/TODO.md blackcrypt-floorplate-art-source.',
            'bank': UI_PANEL_BANK_ID,
            **floor_plate,
        },
        'floorItem': {
            'note': 'Anchor/registration/scatter tables confirmed and wired into '
                    'buildViewList (schema/slots.ts FloorItemPlacement) -- see '
                    'docs/blackcrypt/amiga/data-structure.md, floor-item placement section. '
                    'This section is retained for verification/documentation purposes.',
            'anchor': [{'depth': d, 'lateral': l, 'x': xy[0], 'y': xy[1]}
                       for (d, l), xy in floor_item['anchor'].items()],
            'registration': [{'group': g, 'depth': d, 'x': xy[0], 'y': xy[1]}
                              for (g, d), xy in floor_item['registration'].items() if xy is not None],
            'scatter': [{'dx': x, 'dy': y} for x, y in floor_item['scatter']],
        },
    }


def merge_slots(existing_path, new_slots, extra_banks, floor_item_placement=None):
    doc = json.loads(existing_path.read_text()) if existing_path.exists() else None
    if doc is None:
        raise SystemExit(f'{existing_path} does not exist -- run export_dungeon_slots.py first')
    before = len(doc['slots'])
    doc['slots'].update(new_slots)
    after = len(doc['slots'])
    known_ids = {b['id'] for b in doc['banks']}
    for bank in extra_banks:
        if bank['id'] not in known_ids:
            doc['banks'].append(bank)
            known_ids.add(bank['id'])
    if floor_item_placement is not None:
        doc['floorItem'] = floor_item_placement
    return doc, before, after


def main():
    if not S1_PATH.exists():
        print(f'No {S1_PATH} -- run `cd tools/bcdft_decompress && bash build.sh run` first')
        return 1

    s1 = S1_PATH.read_bytes()
    sub_images = _sub_images_by_slot_src()

    print('Alcove / Plaque / Stairs (shared 18-byte pool):')
    alcove = read_alcove_plaque_index(s1, ALCOVE_INDEX, sub_images, 'alcove')
    plaque = read_alcove_plaque_index(s1, PLAQUE_INDEX, sub_images, 'plaque')
    stairs_pos = read_stairs_index(s1, sub_images)

    print('Door lock:')
    door_lock_pool, door_lock_pos = read_door_lock(s1)

    print('Door switch:')
    door_switch_pool, door_switch_pos = read_door_switch(s1)

    print('Floor plate / trap:')
    floor_plate = read_floorplate(s1)

    print('Floor item placement tables:')
    floor_item = read_floor_item_tables(s1)

    floor_item_placement = build_floor_item_placement(floor_item)

    new_slots = build_prop_slots(alcove, plaque, stairs_pos, door_switch_pos, door_switch_pool, door_lock_pos)
    doc, before, after = merge_slots(
        SLOTS_PATH, new_slots, extra_banks=[DECOR_BANK, FLOORITEM_BANK],
        floor_item_placement=floor_item_placement,
    )
    paths.write_json(SLOTS_PATH, doc, pretty=True)
    print(f'\n  slots.json: {before} -> {after} slots ({after - before} new prop slots merged in), '
          f'floorItem placement table written ({len(floor_item_placement["anchor"])} anchor, '
          f'{len(floor_item_placement["registration"])} registration entries)')

    props_doc = build_props_file(door_lock_pool, door_lock_pos, floor_plate, floor_item)
    paths.write_json(PROPS_PATH, props_doc, pretty=True)
    print(f'  wrote {PROPS_PATH}')

    return 0


if __name__ == '__main__':
    sys.exit(main())

"""Sprite-sheet packing.

Sprites vary widely (16x8 to 192x103 for monsters, and clipper images more
still), so a uniform grid wastes most of the sheet. This is a shelf packer:
sort by descending height, lay rows left to right, wrap when the row is full.
Good enough for offline asset builds and it keeps frame lookup trivial.

The emitted frame shape matches `AtlasFrame` in tools/viewer/shared.ts.
"""
from dataclasses import dataclass, asdict

import numpy as np


@dataclass
class Frame:
    name: str
    x: int
    y: int
    w: int
    h: int


def _pack_rects(shapes, max_width, padding):
    """Shelf-pack a list of `(h, w)` shapes. Returns `(placements, sheet_w,
    sheet_h)` where `placements[i] = (x, y)`, input order preserved in the
    returned list even though packing itself is tallest-first.
    """
    if not shapes:
        return [], 1, 1
    widest = max(w for _, w in shapes)
    sheet_width = max(max_width, widest + padding * 2)

    # Place tallest first so shelves stay compact, but remember input order.
    order = sorted(range(len(shapes)), key=lambda i: -shapes[i][0])

    placements = [None] * len(shapes)
    x = padding
    y = padding
    row_h = 0
    for i in order:
        h, w = shapes[i]
        if x + w + padding > sheet_width:
            x = padding
            y += row_h + padding
            row_h = 0
        placements[i] = (x, y)
        x += w + padding
        row_h = max(row_h, h)
    sheet_height = y + row_h + padding
    return placements, sheet_width, sheet_height


def pack_atlas(sprites, max_width=1024, padding=1):
    """Pack (name, rgba_array) pairs into one RGBA sheet.

    `rgba_array` is (h, w, 4) uint8. Returns (sheet, frames) where `sheet` is an
    (H, W, 4) uint8 array and `frames` is a list of Frame in input order.
    """
    items = [(name, arr) for name, arr in sprites if arr is not None and arr.size]
    if not items:
        return np.zeros((1, 1, 4), dtype=np.uint8), []

    shapes = [arr.shape[:2] for _, arr in items]
    placements, sheet_width, sheet_height = _pack_rects(shapes, max_width, padding)

    sheet = np.zeros((sheet_height, sheet_width, 4), dtype=np.uint8)
    frames = []
    for i, (name, arr) in enumerate(items):
        px, py = placements[i]
        h, w = arr.shape[:2]
        sheet[py:py + h, px:px + w] = arr
        frames.append(Frame(name=name, x=px, y=py, w=w, h=h))
    return sheet, frames


def pack_atlas_indexed(sprites, background=0, max_width=1024, padding=1):
    """Pack `(name, index_array, mask_array_or_none)` triples into one
    palette-index sheet plus a matching opacity-mask sheet.

    `index_array` is (h, w) uint8 palette indices (any domain -- e.g. the
    0-63 EHB index space `planar.decode_planar`/`decode_masked` produce).
    `mask_array`, if given, is (h, w) uint8 with 1 = opaque; omitted for
    unmasked (opaque full-rectangle) art, whose mask sheet pixels are
    written as 1 (opaque) across the whole frame. Background/gutter pixels
    (outside every frame) are `background` in the index sheet and 0
    (transparent) in the mask sheet.

    Returns `(index_sheet, mask_sheet, frames)`, both sheets `(H, W)` uint8.
    """
    items = [(name, idx, mask) for name, idx, mask in sprites if idx is not None and idx.size]
    if not items:
        empty = np.full((1, 1), background, dtype=np.uint8)
        return empty, np.zeros((1, 1), dtype=np.uint8), []

    shapes = [idx.shape[:2] for _, idx, _ in items]
    placements, sheet_width, sheet_height = _pack_rects(shapes, max_width, padding)

    index_sheet = np.full((sheet_height, sheet_width), background, dtype=np.uint8)
    mask_sheet = np.zeros((sheet_height, sheet_width), dtype=np.uint8)
    frames = []
    for i, (name, idx, mask) in enumerate(items):
        px, py = placements[i]
        h, w = idx.shape[:2]
        index_sheet[py:py + h, px:px + w] = idx
        mask_sheet[py:py + h, px:px + w] = mask if mask is not None else 1
        frames.append(Frame(name=name, x=px, y=py, w=w, h=h))
    return index_sheet, mask_sheet, frames


def frames_to_json(frames, width, height):
    """Build the atlas sidecar dict the viewer expects."""
    return {
        'frames': [asdict(f) for f in frames],
        'width': int(width),
        'height': int(height),
    }

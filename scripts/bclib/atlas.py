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


def pack_atlas(sprites, max_width=1024, padding=1):
    """Pack (name, rgba_array) pairs into one RGBA sheet.

    `rgba_array` is (h, w, 4) uint8. Returns (sheet, frames) where `sheet` is an
    (H, W, 4) uint8 array and `frames` is a list of Frame in input order.
    """
    items = [(name, arr) for name, arr in sprites if arr is not None and arr.size]
    if not items:
        return np.zeros((1, 1, 4), dtype=np.uint8), []

    widest = max(arr.shape[1] for _, arr in items)
    sheet_width = max(max_width, widest + padding * 2)

    # Place tallest first so shelves stay compact, but remember input order.
    order = sorted(range(len(items)), key=lambda i: -items[i][1].shape[0])

    placements = {}
    x = padding
    y = padding
    row_h = 0
    for i in order:
        _, arr = items[i]
        h, w = arr.shape[:2]
        if x + w + padding > sheet_width:
            x = padding
            y += row_h + padding
            row_h = 0
        placements[i] = (x, y)
        x += w + padding
        row_h = max(row_h, h)
    sheet_height = y + row_h + padding

    sheet = np.zeros((sheet_height, sheet_width, 4), dtype=np.uint8)
    frames = []
    for i, (name, arr) in enumerate(items):
        px, py = placements[i]
        h, w = arr.shape[:2]
        sheet[py:py + h, px:px + w] = arr
        frames.append(Frame(name=name, x=px, y=py, w=w, h=h))
    return sheet, frames


def frames_to_json(frames, width, height):
    """Build the atlas sidecar dict the viewer expects."""
    return {
        'frames': [asdict(f) for f in frames],
        'width': int(width),
        'height': int(height),
    }

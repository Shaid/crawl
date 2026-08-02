"""VCN (wall tileset) and VMP (viewport tile-index map) decode, EOB DOS/VGA.

Ported from ScummVM's EoBCoreEngine::loadVcnData / getVmpData and
KyraRpgEngine::vcnDraw_fw_4bit (engines/kyra/engine/scene_eob.cpp,
engine/scene_rpg.cpp, engine/kyra_rpg.cpp — fetched 2026-08-02).

VCN file = a standard kyralib.format80 Kyra bitmap (header + LCW payload).
Decompressed payload layout:
    u16 num_tiles
    u8[32] col_map        per-nibble palette-index remap (only the first 16
                           bytes are used by the base/no-lighting case; see
                           kyra_rpg.cpp _vcnColTable init and scene_rpg.cpp
                           vcnDraw_fw_4bit — `_vcnColTable[nibble | shiftVal]`
                           with shiftVal==0 in the static case this extractor
                           renders)
    u8[num_tiles * 32] tiles   8x8 tiles, 4 bits/pixel packed 2/byte (high
                           nibble first), 8 rows x 4 bytes/row = 32 B/tile.
                           (`_vcnSrcBitsPerPixel` is 4 for DOS VGA/EGA, 5 for
                           Amiga, 8 for FM-Towns — this module is DOS-only.)

Verified: BRICK.VCN's tiles payload is exactly num_tiles * 32 bytes with
zero remainder (1575 tiles = 50400 bytes, matching img_size exactly), and
BRICK.VMP's masked tile indices top out at num_tiles-1 exactly (1574) with
zero out-of-range references. See docs/eotb/dosvga/data-structure.md.

VMP file: u16 count, then count x u16 LE entries (14-bit tile index in the
low bits + flag bits: bit14 = horizontal flip, bit15 = "floor/ceiling
overlay" per scene_rpg.cpp). No compression, no header beyond the count.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

from .format80 import decompress_bitmap

TILE_W = 8
TILE_H = 8
BYTES_PER_TILE = 32  # 8 rows * 4 bytes/row (4bpp packed, DOS)


@dataclass
class VcnTileset:
    num_tiles: int
    col_map: bytes  # 32 bytes; col_map[0:16] used by the static/no-light render
    tiles: bytes    # num_tiles * 32 bytes


def parse_vcn(chunk: bytes) -> VcnTileset:
    _header, payload = decompress_bitmap(chunk)
    num_tiles = struct.unpack_from('<H', payload, 0)[0]
    col_map = payload[2:34]
    tiles = payload[34:34 + num_tiles * BYTES_PER_TILE]
    if len(tiles) != num_tiles * BYTES_PER_TILE:
        raise ValueError(f'VCN tile data truncated: got {len(tiles)}, expected {num_tiles * BYTES_PER_TILE}')
    return VcnTileset(num_tiles, col_map, tiles)


def decode_tile_indices(vcn: VcnTileset, tile_idx: int) -> np.ndarray:
    """Decode one 8x8 tile to raw palette indices (post col_map remap), shape (8,8) uint8."""
    off = tile_idx * BYTES_PER_TILE
    raw = vcn.tiles[off:off + BYTES_PER_TILE]
    out = np.zeros((TILE_H, TILE_W), dtype=np.uint8)
    col_map = vcn.col_map
    for row in range(TILE_H):
        for bx in range(4):
            b = raw[row * 4 + bx]
            out[row, bx * 2] = col_map[b >> 4]
            out[row, bx * 2 + 1] = col_map[b & 0xF]
    return out


def decode_all_tiles(vcn: VcnTileset) -> np.ndarray:
    """Decode every tile -> (num_tiles, 8, 8) uint8 palette-index array."""
    out = np.zeros((vcn.num_tiles, TILE_H, TILE_W), dtype=np.uint8)
    for i in range(vcn.num_tiles):
        out[i] = decode_tile_indices(vcn, i)
    return out


@dataclass
class VcnTilesetLOL:
    """LOL's DOS/VGA .VCN payload — structurally different header from EOB's
    (variable-length, not a fixed 34 bytes), and crucially carries its own
    128-colour palette. Byte-exact port of the DOS/VGA (!use16ColorMode)
    branch of LoLEngine::loadLevelGraphics (engine/scene_lol.cpp:300-368,
    fetched 2026-08-02):
        u16 num_tiles
        u8[num_tiles] shift      per-tile brightness/lighting shift table
        u8[128] col_table        per-nibble palette-index remap (only the
                                  first 16 entries matter for the base/
                                  no-lighting render this module produces —
                                  same convention as EOB's col_map)
        u8[384] palette          128 colours x 3 bytes, VGA 6-bit RGB —
                                  THIS is _screen->getPalette(0) for the
                                  whole level unless a script-driven
                                  override file is loaded instead (e.g.
                                  level 11's SWAMPICE.COL/LOLICE.NOL)
        u8[num_tiles*32] tiles   identical 8x8/4bpp packing to EOB

    Verified byte-exact against CATWALK.VCN: 2 + 1845 + 128 + 384 +
    1845*32 == 61399 == the file's own declared decompressed img_size,
    zero residue. Palette indices 48/112 (CATWALK.VCN's col_table
    targets, previously found stuck at a literal RGB(255,0,255)
    placeholder in every external .COL/.PAL file checked) decode to real
    colours here: (11,28,11) and (9,22,53) on the 0-63 VGA scale. See
    docs/landsoflore/dosvga/data-structure.md "VCN — Wall tileset".
    """
    num_tiles: int
    shift: bytes
    col_table: bytes  # 128 bytes; col_table[0:16] used by the static render
    palette: bytes    # 384 bytes = 128 colours x 3 (VGA 6-bit RGB)
    tiles: bytes


def parse_vcn_lol(chunk: bytes) -> VcnTilesetLOL:
    _header, payload = decompress_bitmap(chunk)
    num_tiles = struct.unpack_from('<H', payload, 0)[0]
    off = 2
    shift = payload[off:off + num_tiles]
    off += num_tiles
    col_table = payload[off:off + 128]
    off += 128
    palette = payload[off:off + 384]
    off += 384
    tiles = payload[off:off + num_tiles * BYTES_PER_TILE]
    if len(tiles) != num_tiles * BYTES_PER_TILE:
        raise ValueError(f'LOL VCN tile data truncated: got {len(tiles)}, expected {num_tiles * BYTES_PER_TILE}')
    return VcnTilesetLOL(num_tiles, shift, col_table, palette, tiles)


def decode_tile_indices_lol(vcn: VcnTilesetLOL, tile_idx: int) -> np.ndarray:
    """Decode one 8x8 tile to raw palette indices (post col_table remap)."""
    off = tile_idx * BYTES_PER_TILE
    raw = vcn.tiles[off:off + BYTES_PER_TILE]
    out = np.zeros((TILE_H, TILE_W), dtype=np.uint8)
    col_table = vcn.col_table
    for row in range(TILE_H):
        for bx in range(4):
            b = raw[row * 4 + bx]
            out[row, bx * 2] = col_table[b >> 4]
            out[row, bx * 2 + 1] = col_table[b & 0xF]
    return out


def decode_all_tiles_lol(vcn: VcnTilesetLOL) -> np.ndarray:
    """Decode every tile -> (num_tiles, 8, 8) uint8 palette-index array."""
    out = np.zeros((vcn.num_tiles, TILE_H, TILE_W), dtype=np.uint8)
    for i in range(vcn.num_tiles):
        out[i] = decode_tile_indices_lol(vcn, i)
    return out


def parse_vmp(data: bytes) -> np.ndarray:
    """Return the raw u16 LE entries of a .VMP file (length-prefixed array).

    EOB1/EOB2 store this raw/uncompressed (first u16 = element count).
    Lands of Lore wraps the SAME count-prefixed-array payload in an outer
    Kyra-bitmap/LCW layer instead (confirmed against CATWALK.VMP: outer
    header decompresses to exactly `img_size` bytes, and the decompressed
    payload's `count` -> `2 + count*2 == img_size` exactly, with masked
    tile indices topping out at exactly `numTiles-1` for the matching
    CATWALK.VCN). Auto-detected here: a file whose first u16 equals its
    own length-2 is the Kyra-bitmap-header case (EOB's raw VMPs have a
    small tile-count there instead, which for every file in both corpora
    never coincides with `len(data)-2`).
    """
    if len(data) >= 2 and struct.unpack_from('<H', data, 0)[0] == len(data) - 2:
        _header, data = decompress_bitmap(data)
    count = struct.unpack_from('<H', data, 0)[0]
    entries = np.frombuffer(data, dtype='<u2', count=count, offset=2)
    return entries

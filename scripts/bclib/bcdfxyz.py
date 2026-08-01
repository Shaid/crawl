"""bcdfx / bcdfy / bcdfz — the Black Crypt Amiga dungeon tilesets.

Each of the three files is a bare concatenation of chunks with **no on-disk
directory or header** — the directory that says how to split the file lives
inside the *decompressed* `bcdft` image (see `tools/bcdft_decompress/`), as a
zero-terminated list of 3 big-endian words per chunk::

    +0x00  u16  size          chunk length in the raw *file*; 0 terminates
    +0x02  u16  compressed    non-zero -> RLE (bcdfu LAB_0043); zero -> raw copy
    +0x04  u16  slot          destination A5-relative slot, also SUB_IMAGES' `slot`

`CHUNK_DIRECTORIES` gives each tileset's directory offset in S_1
(`bcdft_decompressed.bin`). All three directories sum to their file's exact
byte size — 144,169 / 117,937 / 160,806 — zero deviation, 3/3.

Each chunk itself packs several independent sub-images back to back, no
header, index or padding — every sub-image has its own width, height and
plane count. `SUB_IMAGES` is the game's own blit-descriptor geometry (20-byte
wall records, a self-describing 28-byte record, and an 18-byte stairs
record — see data-structure.md), confirmed byte-exact against the DOS
`clipper.clp` dungeon manifest. Plane count 7 means a 1-bit mask plane first,
then 6 EHB colour planes (`planar.decode_masked`); plane count 6 is opaque
colour planes only (`planar.decode_planar`).

`bcdfx`/`bcdfz` carry all 12 chunks (83 sub-images each); `bcdfy` carries only
7 of the 12 (46 sub-images) — it genuinely lacks the pit, alcove, plaque,
panel/fountain and button chunks. `iter_sub_images` silently skips any
sub-image whose slot isn't present in the chunk set passed to it, so the same
`SUB_IMAGES` table drives all three files.

Labels below follow the game's own naming (Wall 0/1/2, Door Type 0/1, Door
Way 1A/1B/1C, Pillar A/B/C, ...) lower-cased and hyphenated, matching
data-structure.md's tables 1:1 so a label can be looked up there directly.

The accent-ramp palette to render a tileset under is *not* a per-file
constant — it is chosen per dungeon *level*, and the tileset file is chosen
by the same per-level table. Use
`palette.read_dungeon_palette_for_tileset(s1, s2, tileset)` rather than a
fixed palette offset. See "Dungeon tileset selection" in
docs/blackcrypt/amiga/data-structure.md.
"""
import struct

#: S_1 (bcdft_decompressed.bin) offset of each tileset's chunk directory.
CHUNK_DIRECTORIES = {
    'bcdfx': 0x1DE10,
    'bcdfy': 0x1DE5A,
    'bcdfz': 0x1DE86,
}

#: destination slot -> decompressed byte size. Used only as a sanity bound;
#: not needed to parse a chunk (the directory's own `size` field drives that).
SLOT_SIZES = {
    0x08: 14_448,   # side walls, 4 depths x near/far, masked
    0x0C: 42_754,   # door leaves x2 types x3 depths + 7 door-way frames, masked
    0x10: 10_780,   # floor/ceiling pits, masked
    0x14: 12_460,   # pillar A-C, masked
    0x1C: 4_186,    # 18 wall buttons, masked
    0x20: 1_330,    # pull chain 0-3, masked
    0xB0: 55_536,   # front walls x3 depths (3 pieces each) + ceiling + floor
    0xB8: 6_528,    # Door Slot, one 64x136
    0xBC: 11_580,   # alcove A-E
    0xC0: 11_580,   # plaque A-E
    0xC4: 28_680,   # stairs, 2 flights x 3 depths
    0xC8: 6_060,    # Panel Top + Fountain
}

#: (label, slot, offset-within-slot, width, height, plane_count).
#: plane_count 7 = mask plane first then 6 EHB colour planes; 6 = colour only.
#: 83 entries total (all present in bcdfx/bcdfz; bcdfy has the 46 whose slot
#: is one of 0x08/0x0C/0xB0/0x14/0xB8/0xC4/0x20).
SUB_IMAGES = [
    # slot 0xB0 (176) -- front walls x3 depths + ceiling + floor
    ('wall0-left', 0xB0, 0, 16, 123, 6),
    ('wall0-face', 0xB0, 1476, 176, 123, 6),
    ('wall0-right', 0xB0, 17712, 16, 123, 6),
    ('wall1-left', 0xB0, 19188, 48, 78, 6),
    ('wall1-face', 0xB0, 21996, 112, 78, 6),
    ('wall1-right', 0xB0, 28548, 48, 78, 6),
    ('wall2-left', 0xB0, 31356, 64, 57, 6),
    ('wall2-face', 0xB0, 34092, 80, 57, 6),
    ('wall2-right', 0xB0, 37512, 64, 57, 6),
    ('ceiling', 0xB0, 40248, 208, 30, 6),
    ('floor', 0xB0, 44928, 208, 68, 6),

    # slot 0x08 (8) -- side walls, 4 depths x near/far, masked
    ('sidewall-depth0-near', 0x08, 0, 16, 140, 7),
    ('sidewall-depth0-far', 0x08, 1960, 16, 140, 7),
    ('sidewall-depth1-near', 0x08, 3920, 32, 122, 7),
    ('sidewall-depth1-far', 0x08, 7336, 32, 122, 7),
    ('sidewall-depth2-near', 0x08, 10752, 16, 77, 7),
    ('sidewall-depth2-far', 0x08, 11830, 16, 77, 7),
    ('sidewall-depth3-near', 0x08, 12908, 16, 55, 7),
    ('sidewall-depth3-far', 0x08, 13678, 16, 55, 7),

    # slot 0x0C (12) -- doors + door-way frames, masked
    ('door-type0-1', 0x0C, 0, 80, 92, 7),
    ('door-type0-2', 0x0C, 6440, 64, 60, 7),
    ('door-type0-3', 0x0C, 9800, 48, 44, 7),
    ('door-type1-1', 0x0C, 11648, 80, 92, 7),
    ('door-type1-2', 0x0C, 18088, 64, 60, 7),
    ('door-type1-3', 0x0C, 21448, 48, 44, 7),
    ('doorway-1b', 0x0C, 23296, 80, 27, 7),      # lintel
    ('doorway-1a', 0x0C, 25186, 48, 109, 7),     # left jamb
    ('doorway-1c', 0x0C, 29764, 48, 109, 7),     # right jamb
    ('doorway-2b', 0x0C, 34342, 48, 14, 7),
    ('doorway-2a', 0x0C, 34930, 32, 69, 7),
    ('doorway-2c', 0x0C, 36862, 32, 69, 7),
    ('doorway-3', 0x0C, 38794, 80, 52, 7),
    # 320 B tail after doorway-3 is unaccounted -- no descriptor references
    # it (see "Still open" in data-structure.md); deliberately not listed.

    # slot 0x10 (16) -- floor/ceiling pits, masked
    ('floor-pit-d-left', 0x10, 0, 48, 32, 7),
    ('floor-pit-a', 0x10, 1344, 144, 30, 7),
    ('floor-pit-d-right', 0x10, 5124, 48, 32, 7),
    ('floor-pit-b', 0x10, 6468, 96, 14, 7),
    ('floor-pit-c', 0x10, 7644, 64, 8, 7),
    ('ceiling-pit-a', 0x10, 8092, 144, 16, 7),
    ('ceiling-pit-b', 0x10, 10108, 96, 8, 7),

    # slot 0xBC (188) -- alcove, 5 depths
    ('alcove-a', 0xBC, 0, 112, 77, 6),
    ('alcove-b', 0xBC, 6468, 64, 45, 6),
    ('alcove-c', 0xBC, 8628, 48, 34, 6),
    ('alcove-d', 0xBC, 9852, 32, 54, 6),
    ('alcove-e', 0xBC, 11148, 16, 36, 6),

    # slot 0xC0 (192) -- plaque, 5 depths
    ('plaque-a', 0xC0, 0, 96, 80, 6),
    ('plaque-b', 0xC0, 5760, 64, 52, 6),
    ('plaque-c', 0xC0, 8256, 48, 40, 6),
    ('plaque-d', 0xC0, 9696, 32, 60, 6),
    ('plaque-e', 0xC0, 11136, 16, 37, 6),

    # slot 0x14 (20) -- pillar, 3 depths, masked
    ('pillar-a', 0x14, 0, 80, 116, 7),
    ('pillar-b', 0x14, 8120, 48, 72, 7),
    ('pillar-c', 0x14, 11144, 32, 47, 7),

    # slot 0xB8 (184) -- Door Slot, one image
    ('door-slot', 0xB8, 0, 64, 136, 6),

    # slot 0xC4 (196) -- stairs, 2 flights x 3 depths
    # Flight A = "Stairs Up", flight B = "Stairs Down" -- CONFIRMED against
    # DOS clipper.clp entries 43-48 by palette-independent region agreement
    # (1.0000 for the correct pairing at all three depths, 0.63-0.80 for the
    # wrong one, 38,240 px). Note the Amiga order is the OPPOSITE of the DOS
    # catalog's, which lists Down first. See data-structure.md.
    ('stairs-flight-a-depth0', 0xC4, 0, 112, 109, 6),
    ('stairs-flight-a-depth1', 0xC4, 9156, 64, 69, 6),
    ('stairs-flight-a-depth2', 0xC4, 12468, 48, 52, 6),
    ('stairs-flight-b-depth0', 0xC4, 14340, 112, 109, 6),
    ('stairs-flight-b-depth1', 0xC4, 23496, 64, 69, 6),
    ('stairs-flight-b-depth2', 0xC4, 26808, 48, 52, 6),

    # slot 0xC8 (200) -- Panel Top + Fountain
    ('panel-top', 0xC8, 0, 80, 29, 6),
    ('fountain', 0xC8, 1740, 80, 72, 6),

    # slot 0x20 (32) -- pull chains, masked
    ('pull-chain-0', 0x20, 0, 16, 38, 7),
    ('pull-chain-1', 0x20, 532, 16, 25, 7),
    ('pull-chain-2', 0x20, 882, 16, 19, 7),
    ('pull-chain-3', 0x20, 1148, 16, 13, 7),

    # slot 0x1C (28) -- 18 wall buttons, masked
    ('secret-button1-out', 0x1C, 0, 16, 5, 7),
    ('secret-button1-in', 0x1C, 70, 16, 5, 7),
    ('normal-button1-out', 0x1C, 140, 16, 16, 7),
    ('normal-button1-in', 0x1C, 364, 16, 16, 7),
    ('normal-button2-out', 0x1C, 588, 16, 9, 7),
    ('normal-button2-in', 0x1C, 714, 16, 9, 7),
    ('special-button1-r', 0x1C, 840, 32, 30, 7),
    ('special-button1-l', 0x1C, 1680, 32, 10, 7),
    ('special-button2-r', 0x1C, 1960, 32, 19, 7),
    ('special-button2-l', 0x1C, 2492, 32, 6, 7),
    ('special-button3-r', 0x1C, 2660, 16, 11, 7),
    ('special-button3-l', 0x1C, 2814, 16, 4, 7),
    ('special-button1-rs', 0x1C, 2870, 16, 22, 7),
    ('special-button1-ls', 0x1C, 3178, 16, 22, 7),
    ('special-button2-rs', 0x1C, 3486, 16, 15, 7),
    ('special-button2-ls', 0x1C, 3696, 16, 15, 7),
    ('special-button3-rs', 0x1C, 3906, 16, 10, 7),
    ('special-button3-ls', 0x1C, 4046, 16, 10, 7),
]

#: Total named sub-images (bcdfx/bcdfz have all of them; bcdfy has 46).
SUB_IMAGE_COUNT = len(SUB_IMAGES)


def read_chunk_directory(s1, tileset):
    """Parse `tileset`'s ('bcdfx'/'bcdfy'/'bcdfz') chunk directory from the
    decompressed bcdft S_1 image.

    Returns a list of (size, compressed, slot) in file order. `size` is the
    chunk's length in the raw tileset *file* (its RLE-compressed length, not
    its decompressed length, when `compressed` is set).
    """
    off = CHUNK_DIRECTORIES[tileset]
    entries = []
    while True:
        size, compressed, slot = struct.unpack_from('>HHH', s1, off)
        if size == 0:
            break
        entries.append((size, compressed, slot))
        off += 6
    return entries


def read_chunks(s1, raw, tileset, rle_decompress):
    """Split a tileset file's raw bytes into its decoded chunks.

    `raw` is the whole content of `data/blackcrypt/amiga/<tileset>`.
    `rle_decompress` is injected to avoid a circular import; pass
    `bclib.rle_decompress`.

    Returns {slot: decoded_bytes}. Raises ValueError if the directory's chunk
    sizes don't sum to exactly `len(raw)` -- the invariant that verifies the
    parse (holds with zero deviation for all three files; see
    "Tileset container directory" in data-structure.md).
    """
    out = {}
    pos = 0
    for size, compressed, slot in read_chunk_directory(s1, tileset):
        blk = raw[pos:pos + size]
        out[slot] = rle_decompress(blk) if compressed else bytes(blk)
        pos += size
    if pos != len(raw):
        raise ValueError(
            f'{tileset}: chunk directory sums to {pos} bytes, file is {len(raw)}')
    return out


def iter_sub_images(chunks):
    """Yield (label, width, height, plane_count, pixel_data) for every named
    sub-image present in `chunks` (as returned by `read_chunks`).

    `pixel_data` is the raw plane bytes, ready for `planar.decode_planar`
    (plane_count 6) or `planar.decode_masked` (plane_count 7, mask first).
    Sub-images whose slot isn't in `chunks` (bcdfy carries 46 of 83) or whose
    bytes run short are silently skipped.
    """
    for label, slot, offset, w, h, planes in SUB_IMAGES:
        data = chunks.get(slot)
        if data is None:
            continue
        size = (w // 8) * h * planes
        blob = data[offset:offset + size]
        if len(blob) < size:
            continue
        yield label, w, h, planes, blob

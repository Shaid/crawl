"""bcdfa — the BCSPEED effect-animation container *and* the item icon bank.

`bcdfa` is **not** a flat run of RLE streams. It is a mixed container: some
regions are RLE-compressed (bcdfu `LAB_0043`), others are stored raw, and the
two must not be confused. Blocks decoded here: the item icon bank, the
chest-armour paperdoll bank, the large equipment-panel records, BCSPEED.GFK,
BCSPEED.PRG, BCSPEED.EFF, the UI panel bank (7 masked records), the 4-region
font bank, the 29 key icons and the 12 throwing-item projectile sprites.

Container directory — bcdfa is not "no known loader" (13 entries, SOLVED)
---------------------------------------------------------------------
bcdfa **does** have a loader, in the same "directory lives in the executable"
family as bcdfx/y/z (`bcdfxyz.CHUNK_DIRECTORIES`). `OpenBcdfaFile` at
decompressed `bcdft` S_1 **`+0x1DBD2`** is structurally identical to
`OpenTilesetFile` (`+0x1DD16`) except it hardcodes the filename to `"bcdfa"`
(patches the shared `"bcdf" 'a' 0` template's byte 4 to `0x61` = 'a', rather
than taking a parameter) and reads its own directory at S_1 **`+0x1DC54`**:
13 entries of the *same* 3-big-endian-word shape as bcdfx/y/z
(size-in-file, compressed flag, A5-relative destination-pointer slot),
zero-size terminated. `read_container_directory`/`read_container_chunks`
below mirror `bcdfxyz.read_chunk_directory`/`read_chunks` exactly.

The 13 entries sum to **197,894** — bcdfa's exact file size, zero deviation
(the same style of confirmation as bcdfx/y/z's directories). Their cumulative
offsets land, byte-exact, on every boundary this file already documents
independently (the UI panel bank, paperdoll stream, sound bank, GFK, PRG,
both item-icon banks, the floor-item bank and the chest-armour bank all
start and end exactly where their entry says), which is strong independent
confirmation of the directory *and* closes an old, mistaken "chest armour
looks 24,474 vs 13,224 inconsistent" worry from a hand-computed cumulative
offset that had a one-entry arithmetic slip (armour is entry 10, not 9).
Two of the three previously-"no known loader" unclassified ranges are now
directly explained by the directory's own `compressed` flag: the
`0x15F8D`-`0x1AE70` span and the `0x300C2`-EOF tail were never RLE at all
(`compressed=0` in both entries) — every earlier "RLE stream desyncs into
fragments" report for those two ranges was correctly observing that they
*aren't* RLE, not a decode bug.

See `docs/blackcrypt/amiga/data-structure.md`, "bcdfa — Container Directory"
for the full 13-entry table and the loader disassembly.

Item icons — 180 x 24x24 @ 6bpp, no mask (two RLE streams)
----------------------------------------------------------
The icons the game draws for every carryable object in the inventory /
equipment panel. They are **not** what the 3D viewport draws for an object
lying on a dungeon floor square — that is a separate, masked, variable-size
bank; see `floor_item_sprites` below and the "Dungeon-floor item sprites"
section in docs/blackcrypt/amiga/data-structure.md. Two RLE streams, each
decoding to an exact multiple of 432 bytes with **zero** remainder::

    | File offset | Decoded  | Records | Content                          |
    |-------------|----------|---------|----------------------------------|
    | 0x1B5B3     | 75,600 B | **175** | main bank, icons 0-174           |
    | 0x2FE5C     |  2,160 B |   **5** | 5 extra icons (grey gauntlet,    |
    |             |          |         | pack, boot, chest, bundle)       |

Each 432-byte record is a **24x24 image in 6 sequential bitplanes**, LSB
plane first, 3 bytes per row, 72 bytes per plane. There is **no mask plane**
and no header — unlike every other Black Crypt sprite format. The blit is an
opaque rectangular copy; what looks like transparency is colour index 53
(EHB half-bright of 21), which renders as RGB 0x222222 — byte-identical to
the inventory slot interior the icon is drawn into.

Ground truth: the whole 75,600-byte bank is byte-for-byte resident in Amiga
chip RAM at $7D918 in three independent in-game emulator savestates, and the
DOS VGA `clipper.clp` port holds the same 180 icons in the same order
(entries 447-621 and 624-628) with 100.000% silhouette agreement
(103,680 / 103,680 pixels). See docs/blackcrypt/amiga/data-structure.md.

The bank index is **not** a `bcdfs` item record's `gfxNumber` directly: the
engine looks it up in a 236-byte table (decompressed `bcdft` S_1 +0x26EF2,
values 0-174) before the `MULU.W #$1B0`.

Chest armour — 19 x 32x29 @ 6bpp, no mask (one RLE stream)
----------------------------------------------------------
The large art the equipment panel shows for the armour a character wears; the
Amiga twin of the DOS port's 19 32x29 `clipper.clp` entries. One RLE stream at
**0x2D05E** decoding to 13,224 = 19 x 696 with **zero** remainder. Each record
is 6 sequential bitplanes, 4 bytes per row, 116 bytes per plane; transparency
is index 53 again. Selected by a second 236-byte table at S_1 +0x270CA
(values 0-18). See `armour_icons`.

Large equipment-panel art — 7 records (inside one RLE stream)
-------------------------------------------------------------
Seven 48-px-wide records (only the left 36 px are drawn) inside the stream at
**0x036FD**, at non-uniform heights, listed in `PAPERDOLL_RECORDS`. The rest of
that 18,184-byte stream is other UI art at 32/16/80-px widths and is *not*
decoded here. See `paperdoll_records`.

BCSPEED.GFK — sprite pixels (one RLE stream)
-------------------------------------------
One continuous RLE stream starting at the byte *immediately before* the first
``BCSPEED\\0GFK\\0`` marker (file offset **0x0DFFB**). It decodes to 16,576
bytes holding 16 records back to back, with no header and no trailing slack::

    | Offset | Size      | Field                                  |
    |--------|-----------|----------------------------------------|
    | +0x00  | 12        | b"BCSPEED\\0GFK\\0"                     |
    | +0x0C  | 2         | frame count (BE, 2-6)                  |
    | +0x0E  | count*224 | frames, 224 bytes each                 |

Each 224-byte frame is a **16x16 sprite, 7 sequential bitplanes**: plane 0 is
the 1-bit cookie-cut mask, planes 1-6 are a 6bpp EHB colour index. That is the
same convention as the bcdfb-bcdfn monster sprites, so `decode_masked` reads it
directly.

> **Correction (supersedes the "32x14 @ 4bpp, 333-byte preamble" reading).**
> The old extractor started the RLE stream at 0xDEAB, where a 336-byte
> *uncompressed* table sits ahead of the compressed block. Decoding that table
> as RLE desyncs the decoder, which then invents fill runs and drops real
> bytes; it resynchronised only just before the second record. The visible
> symptoms were a bogus "333-byte preamble", a first record 281 bytes too long,
> and one garbage sprite. This is the same trap as `MONSTER_STREAM_START` in
> `rle.py` — a raw table between a header and the stream it precedes.

BCSPEED.PRG — animation scripts (uncompressed)
----------------------------------------------
Stored raw, *not* RLE-compressed; running the RLE decoder over them shreds the
marker strings::

    | +0x00  | 12      | b"BCSPEED\\0PRG\\0"                       |
    | +0x0C  | 2       | record count (BE)                        |
    | +0x0E  | count*3 | 3-byte records: tag, then two signed bytes |

Verified: for all 34 PRG blocks the distance to the next marker is exactly
``14 + 3 * count`` (33/33 measurable gaps, zero deviation).
"""
import struct

# ── Container directory (S_1 +0x1DC54) ────────────────────────────────────
#
# See the module docstring's "Container directory" section. Same 3-word
# (size, compressed, slot) shape as bcdfxyz.CHUNK_DIRECTORIES, zero-size
# terminated; sums to bcdfa's exact 197,894-byte file size, 13/13, zero
# deviation.
CONTAINER_DIRECTORY = 0x1DC54

#: Named A5-relative destination-pointer slots, in directory order. Twelve of
#: the thirteen are already-documented, independently-confirmed banks
#: (cross-checked against this directory's own cumulative offsets, which
#: land byte-exact on every one of them); the fourth column notes which.
#: `SLOT_TEXT_RESOURCE` (index 5) is only *partly* solved — its `0x7CA0`
#: tail is the confirmed 29 key icons (`key_icon_sprites`), but the rest of
#: the 34,340-byte chunk is still open. `SLOT_FONT` (index 4),
#: `SLOT_EFF` (index 6) and `SLOT_THROWING_ITEMS` (index 12, renamed from
#: `SLOT_UNKNOWN_TAIL`) were solved across this and the preceding pass: a
#: 4-region bitmap font bank, the third BCSPEED bank (effect
#: particle-emitter scripts, `eff_scripts`), and the throwing-items
#: projectile sprite bank (`throwing_item_sprites`) — all confirmed via
#: their own consumer code, not just by rendering.
SLOT_UI_PANEL = 0x0000          # entry 0  -> UI_PANEL_STREAM (0x00000)
SLOT_PAPERDOLL = 0x0004         # entry 1  -> PAPERDOLL_STREAM (0x036FD)
SLOT_SFX = 0x0028               # entry 2  -> SFX_BANK_START (0x06F4D), raw PCM
SLOT_GFK = 0x002C               # entry 3  -> BCSPEED.GFK RLE stream (0x0DFFB)
SLOT_FONT = 0x00E0              # entry 4  -> font bank (0x10779), see below
SLOT_TEXT_RESOURCE = 0x00B4     # entry 5  -> partly unclassified (0x111E1), see below
SLOT_EFF = 0x00E8               # entry 6  -> BCSPEED.EFF, raw not RLE (0x15F8D)
SLOT_PRG = 0x00EC               # entry 7  -> BCSPEED.PRG, raw (0x1AE70)
SLOT_ITEM_BANK0 = 0x00D4        # entry 8  -> ITEM_BANK_STREAMS[0] (0x1B5B3)
SLOT_FLOOR_ITEMS = 0x0030       # entry 9  -> FLOOR_ITEM_STREAM (0x270C4)
SLOT_ARMOUR = 0x00DC            # entry 10 -> ARMOUR_STREAM (0x2D05E)
SLOT_ITEM_BANK1 = 0x00D8        # entry 11 -> ITEM_BANK_STREAMS[1] (0x2FE5C)
SLOT_THROWING_ITEMS = 0x0034    # entry 12 -> throwing-items sprite bank, raw (0x300C2)

#: Back-compat alias — this slot used to be documented as unclassified.
SLOT_UNKNOWN_TAIL = SLOT_THROWING_ITEMS

#: Slots 0xD4 and 0xDC are independently cross-confirmed: they are the exact
#: displacements the item-icon and chest-armour consumer code already
#: documented elsewhere in this file uses (`MOVEA.L $D4(A5),A1` / `$DC(A5)`).


def read_container_directory(s1):
    """Parse bcdfa's 13-entry container directory from decompressed bcdft S_1.

    Returns a list of (size, compressed, slot) in file order — `size` is the
    chunk's length in the raw bcdfa *file* (its RLE-compressed length, not
    decompressed length, when `compressed` is set). Mirrors
    `bcdfxyz.read_chunk_directory` exactly; see the module docstring.
    """
    off = CONTAINER_DIRECTORY
    entries = []
    while True:
        size, compressed, slot = struct.unpack_from('>HHH', s1, off)
        if size == 0:
            break
        entries.append((size, compressed, slot))
        off += 6
    return entries


def read_container_chunks(s1, raw, rle_decompress):
    """Split bcdfa's raw bytes into its 13 decoded chunks, keyed by slot.

    `raw` is the whole content of `data/blackcrypt/amiga/bcdfa`.
    `rle_decompress` is injected to avoid a circular import; pass
    `bclib.rle_decompress`. Raises ValueError if the directory's chunk sizes
    don't sum to exactly `len(raw)` — the invariant that verifies the parse
    (holds with zero deviation; see "bcdfa — Container Directory" in
    data-structure.md).
    """
    out = {}
    pos = 0
    for size, compressed, slot in read_container_directory(s1):
        blk = raw[pos:pos + size]
        out[slot] = rle_decompress(blk) if compressed else bytes(blk)
        pos += size
    if pos != len(raw):
        raise ValueError(
            f'bcdfa: container directory sums to {pos} bytes, file is {len(raw)}')
    return out


# ── Mono message-log font (inside the SLOT_FONT chunk, 0x10779) ──────────
#
# The chunk at container-directory entry 4 (file offset 0x10779, RLE,
# decodes to 4,288 B) holds **four** fonts, not two — see the "correction"
# in data-structure.md's "bcdfa — Mono Font Bank" §"The chunk is four fonts,
# not two". Each region's base offset comes straight out of a `LEA
# <disp>(A3)` in its own consumer, and the byte accounting is exact:
# 512 + 472 + 472 + 2,832 = 4,288, zero remainder.
#
#   Region A -- message-log font.  offset 0,     512 B, 64 glyphs (0x20-0x5F)
#               8x8, 1 bitplane, 8 B/glyph. Consumer: bcdft S_1 +0x1F3E6
#               (blit) / +0x1F314 (address helper).
#   Region B -- micro font.        offset 512,   472 B, 59 glyphs (0x20-0x5A)
#               4x5, 1 bitplane, 8 B/glyph stride (only 5 of the 8 stored
#               bytes are used -- one per row; each byte's *high* nibble
#               holds the glyph's 4 pixels). Consumer: +0x20040 / +0x20148.
#   Region C -- big-font mask.     offset 984,   472 B, 59 glyphs, 8x8,
#               1 bitplane, 8 B/glyph. Consumer: +0x2024E.
#   Region D -- big-font colour.   offset 1,456, 2,832 B, 59 glyphs, 8x8,
#               6 bitplanes, plane-major (plane*8 + row), 48 B/glyph.
#               Consumer: +0x2025C.
#
# Region A's consumer (decompressed bcdft S_1 `+0x1F3D2`-`+0x1F3FE`) is the
# game's scrolling dungeon message-log text blitter --
#
#   ``226D0044 MOVEA.L $44(A5),A1``        destination (message-log buffer)
#   ``2052     MOVEA.L (A2),A0``           source string pointer
#   ``1018     MOVE.B  (A0)+,D0``          next character byte
#   ``04000020 SUBI.B  #$20,D0``           ASCII -> glyph index (space = 0)
#   ``E748     LSL.W   #3,D0``             x8 -- confirmed glyph stride
#   ``266D00E0 MOVEA.L $E0(A5),A3``        font base = SLOT_FONT
#   ``D6C0     ADDA.W  D0,A3``             A3 = font base + index*8
#   loop x8: ``129B MOVE.B (A3)+,(A1)`` / ``LEA $2A(A1),A1``   -- one row/byte
#
# 8 bytes consumed per glyph (matches the x8 stride), each iteration copying
# one byte (= one 8px-wide row) directly into the 320px screen bitplane at a
# $2A (42 = 40 screen bytes/row + 2) stride -- a single monochrome bitplane
# blit, not EHB colour.
#
# The **mask invariant** (region C == OR of region D's 6 planes, 472/472
# bytes, zero deviation, under plane-major order -- row-major order scores
# only 111/472) is what pins region D's plane order; it is also why regions
# C and D can be decoded together as one masked sprite per glyph (see
# `font_big_glyphs`) even though they are stored as two separate blocks
# (all 59 masks, then all 59 colours) rather than interleaved per-glyph.
#
# > **Correction — supersedes "128-glyph font twice over" and "a second,
# > unconfirmed 136-glyph alphabet at 3 bitplanes / 24 B per glyph".** Both
# > readings numerically coincided (128x8 == 512+512, and 136x24 ==
# > 472+2,792) but misread the plane layout; see data-structure.md.
FONT_REGION_A_OFFSET = 0
FONT_REGION_A_WIDTH = 8
FONT_REGION_A_HEIGHT = 8
FONT_REGION_A_GLYPH_BYTES = 8             # 1bpp, 8 rows x 1 byte
FONT_REGION_A_COUNT = 64                  # 0x20-0x5F

#: Back-compat aliases (region A == the previously-named "mono font").
FONT_MONO_OFFSET = FONT_REGION_A_OFFSET
FONT_MONO_WIDTH = FONT_REGION_A_WIDTH
FONT_MONO_HEIGHT = FONT_REGION_A_HEIGHT
FONT_MONO_GLYPH_BYTES = FONT_REGION_A_GLYPH_BYTES
FONT_MONO_COUNT = FONT_REGION_A_COUNT

FONT_REGION_B_OFFSET = FONT_REGION_A_COUNT * FONT_REGION_A_GLYPH_BYTES  # 512
FONT_REGION_B_WIDTH = 4
FONT_REGION_B_HEIGHT = 5
FONT_REGION_B_GLYPH_BYTES = 8              # stride; only 5 of 8 bytes used
FONT_REGION_B_COUNT = 59                   # 0x20-0x5A

FONT_REGION_C_OFFSET = FONT_REGION_B_OFFSET + FONT_REGION_B_COUNT * FONT_REGION_B_GLYPH_BYTES  # 984
FONT_REGION_C_WIDTH = 8
FONT_REGION_C_HEIGHT = 8
FONT_REGION_C_GLYPH_BYTES = 8
FONT_REGION_C_COUNT = 59

FONT_REGION_D_OFFSET = FONT_REGION_C_OFFSET + FONT_REGION_C_COUNT * FONT_REGION_C_GLYPH_BYTES  # 1456
FONT_REGION_D_WIDTH = 8
FONT_REGION_D_HEIGHT = 8
FONT_REGION_D_COLOR_PLANES = 6
FONT_REGION_D_GLYPH_BYTES = 48
FONT_REGION_D_COUNT = 59

#: Total decoded chunk size these four regions must exactly tile, zero slack.
FONT_CHUNK_BYTES = (FONT_REGION_A_COUNT * FONT_REGION_A_GLYPH_BYTES
                     + FONT_REGION_B_COUNT * FONT_REGION_B_GLYPH_BYTES
                     + FONT_REGION_C_COUNT * FONT_REGION_C_GLYPH_BYTES
                     + FONT_REGION_D_COUNT * FONT_REGION_D_GLYPH_BYTES)  # 4288


def mono_font_glyphs(font_chunk):
    """Yield (index, 8x8 bool array) for region A's 64 confirmed 1bpp glyphs.

    `font_chunk` is the *decoded* SLOT_FONT chunk (bcdfa container-directory
    entry 4, RLE stream at file offset 0x10779). Index N corresponds to
    ASCII (0x20 + N) per the consumer's `SUBI.B #$20,D0` -- see the section
    docstring above.
    """
    import numpy as np

    for n in range(FONT_REGION_A_COUNT):
        off = FONT_REGION_A_OFFSET + n * FONT_REGION_A_GLYPH_BYTES
        rows = font_chunk[off:off + FONT_REGION_A_GLYPH_BYTES]
        if len(rows) < FONT_REGION_A_GLYPH_BYTES:
            break
        bits = np.unpackbits(np.frombuffer(bytes(rows), dtype=np.uint8)).reshape(8, 8)
        yield n, bits.astype(bool)


def font_micro_glyphs(font_chunk):
    """Yield (index, 5x4 bool array) for region B's 59 confirmed 4x5 glyphs.

    Each glyph's 8-byte stride only stores 5 meaningful bytes (one per row);
    the 4 pixels live in each byte's *high* nibble (bits 7-4) — see the
    consumer trace in the module docstring. Index N corresponds to ASCII
    (0x20 + N), matching regions C/D.
    """
    import numpy as np

    for n in range(FONT_REGION_B_COUNT):
        off = FONT_REGION_B_OFFSET + n * FONT_REGION_B_GLYPH_BYTES
        rows = font_chunk[off:off + FONT_REGION_B_HEIGHT]
        if len(rows) < FONT_REGION_B_HEIGHT:
            break
        buf = np.frombuffer(bytes(rows), dtype=np.uint8)
        bits = np.unpackbits(buf.reshape(-1, 1), axis=1)[:, :FONT_REGION_B_WIDTH]
        yield n, bits.astype(bool)


def font_big_glyphs(font_chunk):
    """Yield (index, index_array, mask) for the 59 big-font (regions C+D) glyphs.

    Regions C (mask) and D (colour) are stored as two separate blocks — all
    59 masks, then all 59 colours — rather than interleaved per glyph, so
    glyph N's mask+colour bytes are concatenated here before handing them to
    `decode_masked`, which expects exactly that layout (one mask plane block
    followed by `color_planes` colour blocks).
    """
    from .planar import decode_masked

    for n in range(FONT_REGION_C_COUNT):
        mask_off = FONT_REGION_C_OFFSET + n * FONT_REGION_C_GLYPH_BYTES
        color_off = FONT_REGION_D_OFFSET + n * FONT_REGION_D_GLYPH_BYTES
        mask_bytes = font_chunk[mask_off:mask_off + FONT_REGION_C_GLYPH_BYTES]
        color_bytes = font_chunk[color_off:color_off + FONT_REGION_D_GLYPH_BYTES]
        if len(mask_bytes) < FONT_REGION_C_GLYPH_BYTES or len(color_bytes) < FONT_REGION_D_GLYPH_BYTES:
            break
        idx, mask = decode_masked(bytes(mask_bytes) + bytes(color_bytes),
                                   FONT_REGION_D_WIDTH, FONT_REGION_D_HEIGHT,
                                   FONT_REGION_D_COLOR_PLANES)
        yield n, idx, mask


# ── Key icons (SLOT_TEXT_RESOURCE tail, chunk offset 0x7CA0) ─────────────
#
# The last 2,436 bytes of container-directory entry 5's 34,340-byte chunk
# (`SLOT_TEXT_RESOURCE`) are the 29 inventory-key icons — the only
# sub-record of that bank to be identified; the whole bank is solved now.
# Confirmed via its own consumer code (two independent call sites, S_1
# `+0x1FB40` and `+0x206D4`, both `SUBI.W #$C8,D0` / `MULU.W #$54,D0` —
# `gfxNumber - 200`, times the 84-byte record size) and against the DOS
# `clipper.clp` archive, which brackets exactly 29 unnamed 8x14 entries
# between its "Start Keys"/"End Keys" markers (313-341): 3,248/3,248 pixels
# agree (100.000%) across 29/29 frames. See data-structure.md's
# "`0x7CA0`-end — the 29 key icons".
KEY_ICON_OFFSET = 0x7CA0        # offset within the decoded SLOT_TEXT_RESOURCE chunk
KEY_ICON_WIDTH = 8
KEY_ICON_HEIGHT = 14
KEY_ICON_COLOR_PLANES = 6
#: 8x14 @ 6 sequential bitplanes, plane-major, no mask = (8/8)*14*6.
KEY_ICON_RECORD_BYTES = (KEY_ICON_WIDTH // 8) * KEY_ICON_HEIGHT * KEY_ICON_COLOR_PLANES  # 84
KEY_ICON_COUNT = 29
#: Same backdrop convention as the 24x24 item icons — no mask plane; index 53
#: (EHB half-bright of 21) stands in for transparency.
KEY_ICON_BACKDROP_INDEX = 53
#: `gfxNumber - KEY_ICON_GFX_BASE` selects a key icon; gfxNumber 200-228.
KEY_ICON_GFX_BASE = 200


def key_icon_sprites(text_resource_chunk):
    """Yield ``(index, gfx_number, index_array)`` for the 29 key icons.

    `text_resource_chunk` is the *decoded* `SLOT_TEXT_RESOURCE` chunk
    (bcdfa container-directory entry 5). `index_array` is a plain 6-plane
    decode (no mask) — use `mask=(index_array != KEY_ICON_BACKDROP_INDEX)`
    when compositing, the same convention as `item_icons`/`armour_icons`.
    """
    from .planar import decode_planar

    for n in range(KEY_ICON_COUNT):
        off = KEY_ICON_OFFSET + n * KEY_ICON_RECORD_BYTES
        rec = text_resource_chunk[off:off + KEY_ICON_RECORD_BYTES]
        if len(rec) != KEY_ICON_RECORD_BYTES:
            raise ValueError(f'bcdfa: key icon {n} at chunk+{off:#x} truncated')
        idx = decode_planar(rec, KEY_ICON_WIDTH, KEY_ICON_HEIGHT, KEY_ICON_COLOR_PLANES)
        yield n, KEY_ICON_GFX_BASE + n, idx


# ── Spell Book background (SLOT_TEXT_RESOURCE head, chunk offset 0x0000) ─
#
# The 13,440 bytes at the very start of the SLOT_TEXT_RESOURCE chunk (bcdfa
# container-directory entry 5) are a single opaque 320x56, 6-sequential-plane
# image with no mask -- the parchment/border background the spell book UI is
# drawn against. No consumer code was traced for this range this pass (it
# has no `MOVEA.L $B4(A5),An` hit at all, unlike every other sub-record in
# this bank -- consistent with it being blitted as a whole-buffer `Read()`
# destination rather than indexed by a displacement), but the identification
# is confirmed a different way: DOS `clipper.clp` entry 147, name
# `"Spell Book"`, 320x56, matches this record's *exact* decoded byte count
# (320x56x6/8 = 13,440) and, decoded and compared index-for-index against the
# DOS 8bpp raster, produces a **100.000% silhouette match (17,920/17,920
# pixels)** -- not just matching dimensions, the per-index opaque-pixel
# *counts* agree exactly (8,016 / 2,130 / 935 / 774 / 620 for the five most
# common indices in both images). See data-structure.md's "bcdfa -- UI /
# Automap Resource Bank" for the full writeup and the two DOS-size-collision
# candidates that were tested and rejected the same way (silhouette
# agreement at chance level, ~22-58%, not a real match).
SPELL_BOOK_OFFSET = 0x0000      # offset within the decoded SLOT_TEXT_RESOURCE chunk
SPELL_BOOK_WIDTH = 320
SPELL_BOOK_HEIGHT = 56
SPELL_BOOK_COLOR_PLANES = 6
SPELL_BOOK_BYTES = (SPELL_BOOK_WIDTH // 8) * SPELL_BOOK_HEIGHT * SPELL_BOOK_COLOR_PLANES  # 13,440


def spell_book_background(text_resource_chunk):
    """Decode the confirmed 320x56 Spell Book background (6 planes, no mask).

    `text_resource_chunk` is the *decoded* `SLOT_TEXT_RESOURCE` chunk
    (bcdfa container-directory entry 5). Returns a plain index array --
    render opaque (no backdrop/mask convention has been established for it).
    """
    from .planar import decode_planar

    rec = text_resource_chunk[SPELL_BOOK_OFFSET:SPELL_BOOK_OFFSET + SPELL_BOOK_BYTES]
    if len(rec) != SPELL_BOOK_BYTES:
        raise ValueError(f'bcdfa: Spell Book background truncated ({len(rec)} of {SPELL_BOOK_BYTES} B)')
    return decode_planar(rec, SPELL_BOOK_WIDTH, SPELL_BOOK_HEIGHT, SPELL_BOOK_COLOR_PLANES)


# ── SLOT_TEXT_RESOURCE — the full 34,340-byte layout ─────────────────────
#
# Every sub-record of bcdfa container-directory entry 5 is now identified,
# and the thirteen records **tile the chunk exactly, 0 remainder**. Each
# record's offset and geometry comes from its own consumer's literal
# `LEA <disp>(An)` displacement plus the copy loop's own counters (see
# data-structure.md, "bcdfa -- UI / Automap Resource Bank"); every record except
# the two Amiga-only ones is then confirmed pixel-for-pixel against a named
# DOS `clipper.clp` entry.
#
# All six-plane records here are **plane-major** (`decode_planar`'s layout)
# and 14 bytes (112 px) wide unless stated otherwise -- the width of the
# game's right-hand side panel, which sits at screen byte 26 (x = 208).
TEXT_RESOURCE_BYTES = 34340

#: (offset, size, attribute-name, DOS `clipper.clp` entry or None).
#: Consecutive offsets and the exact chunk length are asserted by
#: `check_text_resource_layout`.
TEXT_RESOURCE_LAYOUT = (
    (0x0000, 13440, 'spell_book',        147),   # "Spell Book"        320x56
    (0x3480, 11844, 'stone_panel',        90),   # "Stone"             103x139 (+ Castor 0)
    (0x62C4,  1932, 'panel_clear_strip', None),  # Amiga-only 112x23 blank-stone erase strip
    (0x6A50,   924, 'scroll_top',        165),   # "Scroll Top"        110x11
    (0x6DEC,    84, 'scroll_piece',      167),   # "Scroll Piece"      110x1 (tiled 84x)
    (0x6E40,   720, 'fire_animation',    157),   # "Fire Animation"    8x105 = 15 frames of 8x7
    (0x7110,   288, 'mouse_pointer',     163),   # "Mouse Arrow"       (11x11 of a 24x24 raster)
    (0x7230,   288, 'bubble',            164),   # "Bubble"            5x5
    (0x7350,    80, 'automap_block',     132),   # "Auto Map Block"    16x20
    (0x73A0,   576, 'automap_tiles',     131),   # "Auto Map Tiles"    8x192 = 24 tiles of 8x8
    (0x75E0,   864, 'treasure_chest_0',  158),   # "Treasure Chest 0"  54x24 (Amiga crops to 48)
    (0x7940,   864, 'treasure_chest_1',  159),   # "Treasure Chest 1"  54x24
    (0x7CA0,  2436, 'key_icons',         None),  # 29 keys, clipper entries 313-341
)


def check_text_resource_layout():
    """Assert that TEXT_RESOURCE_LAYOUT tiles the chunk with zero remainder.

    This is the bank's structural invariant, and it is what makes each
    record's *end* as trustworthy as its start: every boundary from
    `0x62C4` onwards is independently pinned by the 100.000% DOS match of
    the record that begins there.
    """
    pos = 0
    for off, size, name, _dos in TEXT_RESOURCE_LAYOUT:
        if off != pos:
            raise ValueError(
                f'bcdfa entry 5: {name} starts at {off:#x}, expected {pos:#x}')
        pos += size
    if pos != TEXT_RESOURCE_BYTES:
        raise ValueError(
            f'bcdfa entry 5: layout sums to {pos} B, chunk is {TEXT_RESOURCE_BYTES} B')
    return True


#: Panel-family records: 14 bytes (112 px) per row, 6 sequential planes.
PANEL_WIDTH = 112
PANEL_COLOR_PLANES = 6
#: Screen byte column the whole panel family is blitted to (S_1 `+0x25C7E`,
#: `+0x236C2`, `+0x236FA`, `+0x24430`): 26 bytes = x 208 on a 320px screen.
PANEL_SCREEN_BYTE_X = 26

STONE_PANEL_OFFSET = 0x3480
STONE_PANEL_HEIGHT = 141           # `MOVE.W #$8C,D1` at S_1 +0x25C86 -> 141 rows
STONE_PANEL_BYTES = (PANEL_WIDTH // 8) * STONE_PANEL_HEIGHT * PANEL_COLOR_PLANES  # 11,844
#: Where DOS `clipper.clp` entry 90 ("Stone", 103x139) sits inside it.
STONE_PANEL_DOS_ORIGIN = (2, 6)    # (row, col) of DOS pixel (0,0)
#: Where DOS entry 107 ("Castor 0", 36x11) is *baked into* the Amiga art.
STONE_PANEL_CASTOR_ORIGIN = (11, 63)

PANEL_CLEAR_STRIP_OFFSET = 0x62C4
PANEL_CLEAR_STRIP_HEIGHT = 23      # `MOVEQ #$16,D1` at S_1 +0x236CA
PANEL_CLEAR_STRIP_BYTES = ((PANEL_WIDTH // 8) * PANEL_CLEAR_STRIP_HEIGHT
                           * PANEL_COLOR_PLANES)  # 1,932

SCROLL_TOP_OFFSET = 0x6A50
SCROLL_TOP_HEIGHT = 11
SCROLL_TOP_BYTES = (PANEL_WIDTH // 8) * SCROLL_TOP_HEIGHT * PANEL_COLOR_PLANES  # 924

SCROLL_PIECE_OFFSET = 0x6DEC
SCROLL_PIECE_HEIGHT = 1
SCROLL_PIECE_BYTES = (PANEL_WIDTH // 8) * SCROLL_PIECE_HEIGHT * PANEL_COLOR_PLANES  # 84
#: S_1 `+0x2443E` (`MOVEQ #$53,D0`) repeats the single row 84 times, starting
#: at screen offset `$4A2` = row 29.
SCROLL_PIECE_REPEAT = 84
SCROLL_PIECE_SCREEN_ROW = 29
#: The 110px-wide DOS art sits 2px in from the Amiga record's left edge.
SCROLL_DOS_X_ORIGIN = 2

#: "Fire Animation" -- 15 flame frames. Stored 8 rows per plane, but the
#: blitter at S_1 `+0x1EC92` copies only 7 (`MOVE.B (A2)+,(A1)` x7 then
#: `ADDQ.L #1,A2` skips the 8th), which is exactly DOS's 8x105 = 15 x 8x7.
FIRE_ANIMATION_OFFSET = 0x6E40
FIRE_ANIMATION_WIDTH = 8
FIRE_ANIMATION_STORED_HEIGHT = 8
FIRE_ANIMATION_HEIGHT = 7
FIRE_ANIMATION_COLOR_PLANES = 6
FIRE_ANIMATION_FRAME_BYTES = 48    # `MULU.W #$30,D1` at S_1 +0x1EC82
FIRE_ANIMATION_COUNT = 15
#: The four screen offsets the flame is drawn at (word table at S_1 +0x1ECBA),
#: as (x, y) on the 320x200 6-plane screen: the corners of the main panel.
FIRE_ANIMATION_POSITIONS = ((16, 151), (296, 151), (296, 178), (16, 178))
#: Per-corner phase: four free-running counters seeded 0/10/20/30 (S_1
#: +0x1EC28), each wrapping at 60 and indexed through a 60-byte ramp
#: (S_1 +0x1EC2C) that holds every frame for 4 ticks -- `frame = tick // 4`.
FIRE_ANIMATION_PERIOD = 60
FIRE_ANIMATION_TICKS_PER_FRAME = 4
FIRE_ANIMATION_PHASES = (0, 10, 20, 30)
#: Colour index that stands in for transparency (DOS uses two backdrop
#: shades, 131/132, where the Amiga uses this one).
FIRE_ANIMATION_BACKDROP_INDEX = 26

#: Hardware-sprite records: 24 lines x 4 bytes. Records 0 and 1 of each bank
#: are an *attached* SPR0/SPR1 pair (4 bitplanes, 15 colours); record 2 is
#: all zeros. The consumers copy only the leading `*_SPRITE_LINES` longwords.
SPRITE_RECORD_BYTES = 96
SPRITE_RECORDS_PER_BANK = 3
SPRITE_WIDTH = 16

MOUSE_POINTER_OFFSET = 0x7110
MOUSE_POINTER_LINES = 18           # `MOVEQ #$11,D1` at S_1 +0x1E8DA
MOUSE_POINTER_BYTES = SPRITE_RECORD_BYTES * SPRITE_RECORDS_PER_BANK  # 288

BUBBLE_OFFSET = 0x7230
BUBBLE_LINES = 5                   # `MOVEQ #$4,D1` at S_1 +0x1E90A
BUBBLE_BYTES = SPRITE_RECORD_BYTES * SPRITE_RECORDS_PER_BANK  # 288

#: The automap is a dual-playfield screen: playfield 1 is a 3-plane 8x8
#: tilemap (82 bytes/row, plane stride 0x8020), playfield 2 a 2-plane
#: 21x10 grid of 16x20 cells (42 bytes/row, plane stride 0x20D0).
AUTOMAP_BLOCK_OFFSET = 0x7350
AUTOMAP_BLOCK_WIDTH = 16
AUTOMAP_BLOCK_HEIGHT = 20
AUTOMAP_BLOCK_PLANES = 2
AUTOMAP_BLOCK_BYTES = (AUTOMAP_BLOCK_WIDTH // 8) * AUTOMAP_BLOCK_HEIGHT * AUTOMAP_BLOCK_PLANES  # 80
#: Playfield-2 pixel value v lights COLOR(8 + v).
AUTOMAP_BLOCK_COLOR_BASE = 8
AUTOMAP_GRID_COLUMNS = 21          # `DIVU.W #$15,D0` at S_1 +0x1F9AE

AUTOMAP_TILE_OFFSET = 0x73A0
AUTOMAP_TILE_SIZE = 8
AUTOMAP_TILE_PLANES = 3
AUTOMAP_TILE_BYTES = 24            # `MULU.W #$18,D2` at S_1 +0x1FA10
AUTOMAP_TILE_COUNT = 24
AUTOMAP_TILE_BANK_BYTES = AUTOMAP_TILE_BYTES * AUTOMAP_TILE_COUNT  # 576

TREASURE_CHEST_OFFSET = 0x75E0
TREASURE_CHEST_WIDTH = 48
TREASURE_CHEST_HEIGHT = 24         # `MOVEQ #$17,D1` at S_1 +0x23F30
TREASURE_CHEST_COLOR_PLANES = 6
TREASURE_CHEST_RECORD_BYTES = ((TREASURE_CHEST_WIDTH // 8) * TREASURE_CHEST_HEIGHT
                               * TREASURE_CHEST_COLOR_PLANES)  # 864
TREASURE_CHEST_COUNT = 2           # `TST.W D2` / `LEA $360(A0),A0` at S_1 +0x23F1C
#: Screen offset `$1B32` = row 174, byte column 2 -> (16, 174).
TREASURE_CHEST_SCREEN_XY = (16, 174)
#: DOS's rasters are 54 wide; the Amiga's 48 are DOS columns 3..50.
TREASURE_CHEST_DOS_X_ORIGIN = 3


def _slice(chunk, off, size, what):
    rec = chunk[off:off + size]
    if len(rec) != size:
        raise ValueError(f'bcdfa entry 5: {what} at chunk+{off:#x} truncated '
                         f'({len(rec)} of {size} B)')
    return rec


def stone_panel(text_resource_chunk):
    """Decode the 112x141 right-hand side panel ("Stone") -- 6 planes."""
    from .planar import decode_planar
    rec = _slice(text_resource_chunk, STONE_PANEL_OFFSET, STONE_PANEL_BYTES, 'stone panel')
    return decode_planar(rec, PANEL_WIDTH, STONE_PANEL_HEIGHT, PANEL_COLOR_PLANES)


def panel_clear_strip(text_resource_chunk):
    """Decode the 112x23 blank-stone erase strip (no DOS counterpart)."""
    from .planar import decode_planar
    rec = _slice(text_resource_chunk, PANEL_CLEAR_STRIP_OFFSET,
                 PANEL_CLEAR_STRIP_BYTES, 'panel clear strip')
    return decode_planar(rec, PANEL_WIDTH, PANEL_CLEAR_STRIP_HEIGHT, PANEL_COLOR_PLANES)


def scroll_top(text_resource_chunk):
    """Decode the 112x11 scroll roller ("Scroll Top") -- 6 planes."""
    from .planar import decode_planar
    rec = _slice(text_resource_chunk, SCROLL_TOP_OFFSET, SCROLL_TOP_BYTES, 'scroll top')
    return decode_planar(rec, PANEL_WIDTH, SCROLL_TOP_HEIGHT, PANEL_COLOR_PLANES)


def scroll_piece(text_resource_chunk):
    """Decode the single 112x1 parchment row ("Scroll Piece") -- 6 planes."""
    from .planar import decode_planar
    rec = _slice(text_resource_chunk, SCROLL_PIECE_OFFSET, SCROLL_PIECE_BYTES, 'scroll piece')
    return decode_planar(rec, PANEL_WIDTH, SCROLL_PIECE_HEIGHT, PANEL_COLOR_PLANES)


def scroll_panel(text_resource_chunk, body_rows=SCROLL_PIECE_REPEAT):
    """Compose the scroll the way the game draws it: roller + tiled body."""
    import numpy as np
    top = scroll_top(text_resource_chunk)
    body = np.repeat(scroll_piece(text_resource_chunk), body_rows, axis=0)
    return np.vstack([top, body])


def fire_animation_frames(text_resource_chunk):
    """Yield ``(index, 8x7 index array)`` for the 15 flame frames.

    Stored 8 rows per plane; only the first 7 are drawn (and only those 7
    exist in DOS's 8x105 raster), so the 8th stored row is dropped here.
    """
    from .planar import decode_planar
    for n in range(FIRE_ANIMATION_COUNT):
        off = FIRE_ANIMATION_OFFSET + n * FIRE_ANIMATION_FRAME_BYTES
        rec = _slice(text_resource_chunk, off, FIRE_ANIMATION_FRAME_BYTES, f'flame frame {n}')
        idx = decode_planar(rec, FIRE_ANIMATION_WIDTH, FIRE_ANIMATION_STORED_HEIGHT,
                            FIRE_ANIMATION_COLOR_PLANES)
        yield n, idx[:FIRE_ANIMATION_HEIGHT]


def mouse_pointer_sprite(text_resource_chunk):
    """Decode the mouse pointer as a 16 x 18 attached-sprite-pair image."""
    from .planar import decode_sprite_pair
    rec = _slice(text_resource_chunk, MOUSE_POINTER_OFFSET, MOUSE_POINTER_BYTES, 'mouse pointer')
    return decode_sprite_pair(rec, MOUSE_POINTER_LINES, SPRITE_RECORD_BYTES)


def bubble_sprite(text_resource_chunk):
    """Decode the 16 x 5 "Bubble" attached-sprite-pair image."""
    from .planar import decode_sprite_pair
    rec = _slice(text_resource_chunk, BUBBLE_OFFSET, BUBBLE_BYTES, 'bubble')
    return decode_sprite_pair(rec, BUBBLE_LINES, SPRITE_RECORD_BYTES)


def automap_block(text_resource_chunk):
    """Decode the 16x20 "Auto Map Block" cell -- 2 planes (playfield 2)."""
    from .planar import decode_planar
    rec = _slice(text_resource_chunk, AUTOMAP_BLOCK_OFFSET, AUTOMAP_BLOCK_BYTES, 'automap block')
    return decode_planar(rec, AUTOMAP_BLOCK_WIDTH, AUTOMAP_BLOCK_HEIGHT, AUTOMAP_BLOCK_PLANES)


def automap_tiles(text_resource_chunk):
    """Yield ``(index, 8x8 index array)`` for the 24 automap tiles (3 planes)."""
    from .planar import decode_planar
    for n in range(AUTOMAP_TILE_COUNT):
        off = AUTOMAP_TILE_OFFSET + n * AUTOMAP_TILE_BYTES
        rec = _slice(text_resource_chunk, off, AUTOMAP_TILE_BYTES, f'automap tile {n}')
        yield n, decode_planar(rec, AUTOMAP_TILE_SIZE, AUTOMAP_TILE_SIZE, AUTOMAP_TILE_PLANES)


def treasure_chest_sprites(text_resource_chunk):
    """Yield ``(index, 48x24 index array)`` for the closed/open chest art."""
    from .planar import decode_planar
    for n in range(TREASURE_CHEST_COUNT):
        off = TREASURE_CHEST_OFFSET + n * TREASURE_CHEST_RECORD_BYTES
        rec = _slice(text_resource_chunk, off, TREASURE_CHEST_RECORD_BYTES, f'treasure chest {n}')
        yield n, decode_planar(rec, TREASURE_CHEST_WIDTH, TREASURE_CHEST_HEIGHT,
                               TREASURE_CHEST_COLOR_PLANES)


GFK_MARKER = b'BCSPEED\x00GFK\x00'
PRG_MARKER = b'BCSPEED\x00PRG\x00'

#: 16x16 pixels, 7 planes (1 mask + 6 EHB colour), 2 bytes per plane row.
GFK_FRAME_BYTES = (16 // 8) * 16 * 7
GFK_WIDTH = 16
GFK_HEIGHT = 16
GFK_COLOR_PLANES = 6


def _marker_offsets(data, marker):
    out = []
    i = data.find(marker)
    while i != -1:
        out.append(i)
        i = data.find(marker, i + len(marker))
    return out


def gfk_stream_start(raw):
    """File offset of the RLE control byte that opens the GFK block.

    The stream's first output bytes are the first record's marker, so its
    opening op must be a literal run beginning one byte earlier. Validating
    that (odd control byte, run long enough to cover the 14-byte header) keeps
    this from silently locking onto the wrong offset if the file changes.
    """
    first = raw.find(GFK_MARKER)
    if first < 1:
        raise ValueError('bcdfa: no BCSPEED\\0GFK\\0 marker found')
    start = first - 1
    ctrl = raw[start]
    if not ctrl & 1 or (ctrl >> 1) < 14:
        raise ValueError(
            f'bcdfa: byte at 0x{start:05X} is 0x{ctrl:02X}, not a literal run '
            'long enough to emit a GFK record header')
    return start


def gfk_records(raw):
    """Decode the GFK block; yield ``(index, count, payload)`` per record.

    `payload` is ``count * 224`` bytes — feed each 224-byte slice to
    `decode_masked(frame, 16, 16, 6)`.
    """
    from .rle import rle_decompress

    stream = rle_decompress(raw, gfk_stream_start(raw))
    offsets = _marker_offsets(stream, GFK_MARKER)
    for n, pos in enumerate(offsets):
        count = struct.unpack('>H', stream[pos + 12:pos + 14])[0]
        size = count * GFK_FRAME_BYTES
        payload = stream[pos + 14:pos + 14 + size]
        if len(payload) != size:
            raise ValueError(f'bcdfa: GFK record {n} truncated '
                             f'({len(payload)} of {size} bytes)')
        yield n, count, payload


def gfk_frames(raw):
    """Yield ``(record_index, frame_index, frame_bytes)`` for every GFK frame."""
    for n, count, payload in gfk_records(raw):
        for f in range(count):
            yield n, f, payload[f * GFK_FRAME_BYTES:(f + 1) * GFK_FRAME_BYTES]


def prg_records(raw):
    """Yield ``(index, count, records)`` for the uncompressed PRG block.

    `records` is a list of ``(tag, a, b)`` with `a`/`b` signed.
    """
    for n, pos in enumerate(_marker_offsets(raw, PRG_MARKER)):
        count = struct.unpack('>H', raw[pos + 12:pos + 14])[0]
        body = raw[pos + 14:pos + 14 + count * 3]
        recs = [(body[i * 3],
                 struct.unpack('>b', body[i * 3 + 1:i * 3 + 2])[0],
                 struct.unpack('>b', body[i * 3 + 2:i * 3 + 3])[0])
                for i in range(len(body) // 3)]
        yield n, count, recs


# ── BCSPEED.EFF — effect particle-emitter scripts (SLOT_EFF, 0x15F8D) ────
#
# The third BCSPEED bank, tying the GFK sprites to the PRG movement scripts.
# Container-directory entry 6, stored **raw** (not RLE). Confirmed via a
# `re-codebreaker` escalation (see data-structure.md's "bcdfa — BCSPEED.EFF"
# for the full disassembly trace), then **independently re-verified from
# scratch** in the orchestrating session: a fresh r2 disassembly of
# `InitBcspeedTables` (S_1 +0x25536) and `PlayEffect` (S_1 +0x25624) matched
# the escalation's transcription instruction-for-instruction; a from-scratch
# blind parser (this module's algorithm, written independently of the
# escalation's own probe script) reproduces the in-executable 95-entry
# section-offset table at S_1 +0x2598A byte-exact (95/95) and accounts for
# every one of the bank's 20,195 bytes with zero remainder
# (95*4 + 3110*6 + 1155*1 = 20195); and the DOS `clipper.clp` archive's own
# catalogue names this exact payload `"Speed Effects"` (entry 225, type 5,
# size 20195) with byte-identical content, confirmed against this project's
# own `extract_clipper.parse_clp`.
#
# No file header: section 0 begins at byte 0. Format::
#
#     File    := Section[95]
#     Section := u16 lastGroupIndex   (= groupCount - 1)
#                u16 frameDelay       (extra vblanks per tick, 0 or 4)
#                Group[groupCount]
#     Group   := Record[] then a single 0xFF terminator byte (not a full
#                6-byte record -- 0xFF in a record's first byte means
#                "end of group", the same convention BCSPEED.PRG uses for
#                its own 0xFF tag)
#     Record  := u8 gfkRecord   (0-15, index into BCSPEED.GFK's 16 records)
#                u8 gfkFrame    (frame within that record)
#                u8 prgOffset   (BCSPEED.PRG script index x 4 -- used
#                                directly as a byte offset, never shifted)
#                u8 x           (viewport x, 0-192)
#                u8 y           (viewport y, 0-124)
#                u8 pad         (always 0x00)
#
# Each group is one animation tick: the engine (`PlayEffect`, S_1 +0x25624)
# fills a 20-slot particle ring from the group's records, presents a frame,
# waits `frameDelay+1` vblanks, then advances. Live particles keep stepping
# their own PRG script (3 bytes/tick) independently of the group that spawned
# them; the effect ends once the last group is consumed and no particle
# survives. See data-structure.md for the full engine trace (spawn walker,
# per-tick update, viewport-kill test) and the semantic verification (mirror-
# pair spawn-position symmetry, spawn-vs-travel-direction correlation).
EFF_STREAM = 0x15F8D            # bcdfa file offset, RAW (not RLE)
EFF_STREAM_END = 0x1AE70
EFF_BANK_BYTES = EFF_STREAM_END - EFF_STREAM  # 20,195

#: S_1 offset of the 95-entry pre-relocation section-offset table
#: (`InitBcspeedTables` relocates it in place at runtime by adding the
#: bank's base pointer; the *stored* file bytes are relative offsets into
#: this bank, which is what makes them directly comparable to this parser's
#: own derived section starts).
EFF_TABLE = 0x2598A
EFF_COUNT = 95

EFF_RECORD_BYTES = 6
EFF_GROUP_TERMINATOR = 0xFF


def eff_table_offsets(bcdft_s1):
    """The 95 confirmed section-start offsets straight from the executable.

    Read from decompressed `bcdft` S_1 `+0x2598A`, *before* the runtime
    relocation pass (`InitBcspeedTables`, S_1 `+0x25536`) adds the bank's
    base pointer — so these are directly comparable to `eff_scripts`' own
    parsed section-start offsets. Used only as an integrity cross-check;
    `eff_scripts` does not need this table to parse the bank (the format is
    self-describing).
    """
    return list(struct.unpack_from(f'>{EFF_COUNT}I', bcdft_s1, EFF_TABLE))


def eff_scripts(raw):
    """Parse all 95 BCSPEED.EFF effect scripts from bcdfa's raw bytes.

    `raw` is the whole content of `data/blackcrypt/amiga/bcdfa` (this bank is
    stored raw, not RLE-compressed, so no decompression step is needed —
    just slice `EFF_STREAM:EFF_STREAM_END`).

    Yields ``(index, offset, last_group_index, frame_delay, groups)`` where
    `groups` is a list of lists of ``(gfk_record, gfk_frame, prg_offset, x, y)``
    tuples (one inner list per group/tick). Raises ValueError if the bank
    doesn't parse to exactly `EFF_BANK_BYTES` with zero remainder, or if a
    section's own `last_group_index + 1` doesn't match the number of groups
    actually found (the invariant confirmed 95/95 against the engine's own
    comparison at S_1 `+0x25740`).
    """
    data = raw[EFF_STREAM:EFF_STREAM_END]
    pos = 0
    n = len(data)
    for i in range(EFF_COUNT):
        start = pos
        if pos + 4 > n:
            raise ValueError(f'bcdfa: EFF section {i} header truncated at {start}')
        last_group_index, frame_delay = struct.unpack_from('>HH', data, pos)
        pos += 4
        group_count = last_group_index + 1
        groups = []
        for g in range(group_count):
            records = []
            while True:
                if pos >= n:
                    raise ValueError(f'bcdfa: EFF section {i} group {g} ran off the end')
                b = data[pos]
                if b == EFF_GROUP_TERMINATOR:
                    pos += 1
                    break
                if pos + EFF_RECORD_BYTES > n:
                    raise ValueError(f'bcdfa: EFF section {i} record truncated at {pos}')
                gfk_record, gfk_frame, prg_offset, x, y, pad = data[pos:pos + EFF_RECORD_BYTES]
                if pad != 0:
                    raise ValueError(f'bcdfa: EFF section {i} record at {pos} has non-zero pad {pad}')
                records.append((gfk_record, gfk_frame, prg_offset, x, y))
                pos += EFF_RECORD_BYTES
            groups.append(records)
        yield i, start, last_group_index, frame_delay, groups
    if pos != n:
        raise ValueError(f'bcdfa: EFF bank parsed {pos} of {n} bytes, {n - pos} unaccounted for')


# ── BCSPEED.EFF particle simulation (S_1 +0x2576C jump table) ────────────
#
# The PRG tag-byte jump table is 18 entries x 4 bytes, and the tag is a
# pre-multiplied byte offset into it -- tags 0x00-0x38 are legal (`frame =
# tag >> 2`) but **unused by the shipped data**; every one of the 34 PRG
# scripts only ever uses 0x3C (kill), 0x40 (next frame), 0x44 (prev frame)
# and 0xFF (dx/dy only, no frame change). All four are implemented here.
# See data-structure.md's "The PRG tag-byte jump table (S_1 +0x2576C)".
PRG_TAG_KILL = 0x3C
PRG_TAG_NEXT_FRAME = 0x40
PRG_TAG_PREV_FRAME = 0x44
PRG_TAG_DXDY_ONLY = 0xFF
#: tag // 4 for a legal absolute-frame-set tag (0x00-0x38, unused by data).
PRG_TAG_ABSOLUTE_FRAME_MAX = 0x38

#: S_1 offset of the engine's own 16-byte per-GFK-record frame-count bound
#: table (one byte per GFK record, 0-15). `simulate_effect` does not need
#: this -- it derives the same information from the GFK bank itself via
#: `gfk_frame_counts` below, which is self-describing and correct for GFK
#: record 15 (the table's entry there is a stale 0x00 against the bank's
#: real frame count of 2; record 15's animation always terminates via the
#: 0x3C kill tag before that would matter -- see data-structure.md).
EFF_FRAME_COUNT_TABLE = 0x258B2
EFF_FRAME_COUNT_TABLE_LEN = 16

#: The confirmed 208x140 viewport bounds a particle is killed for leaving.
EFF_VIEWPORT_WIDTH = 208
EFF_VIEWPORT_HEIGHT = 140
EFF_SPRITE_SIZE = 16
EFF_KILL_X_MAX = EFF_VIEWPORT_WIDTH - EFF_SPRITE_SIZE   # 192
EFF_KILL_Y_MAX = EFF_VIEWPORT_HEIGHT - EFF_SPRITE_SIZE  # 124

#: Safety cap on ticks simulated after the last group has been spawned, in
#: case a malformed script never kills every particle. No shipped effect is
#: expected to hit this -- every PRG script's last record is a 0x3C kill.
EFF_MAX_TRAILING_TICKS = 256


def gfk_frame_counts(raw):
    """``{gfkRecordIndex: frameCount}`` for all 16 BCSPEED.GFK records.

    Derived directly from the GFK bank's own record headers -- self-
    describing, and (unlike the engine's `EFF_FRAME_COUNT_TABLE`) correct
    for record 15. `eff_table_offsets`-style cross-checking against the
    engine table is available separately if `bcdft_s1` is on hand.
    """
    return {n: count for n, count, _ in gfk_records(raw)}


def simulate_effect(groups, last_group_index, prg_scripts, frame_counts,
                     max_trailing_ticks=EFF_MAX_TRAILING_TICKS):
    """Run the confirmed BCSPEED.EFF particle simulation for one effect.

    `groups` / `last_group_index` are exactly what `eff_scripts` yields for
    one effect. `prg_scripts` is ``{index: records}`` as built from
    `prg_records` (`index` is `prgOffset // 4`, since `prgOffset` is
    pre-multiplied by 4 in the data — see the module docstring).
    `frame_counts` is `gfk_frame_counts`'s return value (or the engine's own
    `EFF_FRAME_COUNT_TABLE`, for a cross-check).

    Yields one ``list[dict]`` per simulated tick — every *currently visible*
    particle's ``{gfkRecord, gfkFrame, x, y}``, drawn at the position/frame
    it had on entering that tick (i.e. its spawn state on the tick it
    spawns, or wherever the previous tick's PRG step left it). This mirrors
    the engine's own two-phase per-tick loop: spawn this group's records
    into the 20-slot ring (slots 19 downward, one per record — **this
    unconditionally overwrites whatever was in those slot positions**,
    faithfully matching the raw spawn loop, which does not check for a free
    slot), then step every occupied slot once (`scriptPtr += 1 record`,
    blit, dispatch the new tag, apply dx/dy unless killed by 0x3C).

    After the last group (`last_group_index`) has been spawned, ticks
    continue — with no further spawns — until either no particle survives
    or `max_trailing_ticks` is reached (a safety cap; every shipped PRG
    script's own last record is a 0x3C kill, so this should never fire).
    """
    RING_SIZE = 20
    slots = [None] * RING_SIZE  # each: {gfkRecord, gfkFrame, x, y, script, pos}
    group_count = last_group_index + 1
    if group_count > len(groups):
        raise ValueError(
            f'bcdfa: simulate_effect got {len(groups)} groups, need {group_count}')

    trailing = 0
    g = 0
    while True:
        spawning = g < group_count
        if spawning:
            recs = groups[g]
            if len(recs) > RING_SIZE:
                raise ValueError(
                    f'bcdfa: group {g} has {len(recs)} records, ring holds {RING_SIZE}')
            slot_idx = RING_SIZE - 1
            for gfk_record, gfk_frame, prg_offset, x, y in recs:
                script = prg_scripts[prg_offset // 4]
                slots[slot_idx] = {
                    'gfkRecord': gfk_record, 'gfkFrame': gfk_frame,
                    'x': x, 'y': y, 'script': script, 'pos': -1,
                }
                slot_idx -= 1

        tick = []
        any_alive = False
        for i in range(RING_SIZE):
            p = slots[i]
            if p is None:
                continue
            any_alive = True
            tick.append({'gfkRecord': p['gfkRecord'], 'gfkFrame': p['gfkFrame'],
                         'x': p['x'], 'y': p['y']})

            p['pos'] += 1
            if p['pos'] >= len(p['script']):
                # Every shipped PRG script's own last record is a 0x3C kill,
                # so this should never be reached — guard against malformed
                # data instead of indexing past the end.
                slots[i] = None
                continue
            tag, a, b = p['script'][p['pos']]

            killed = False
            apply_delta = True
            if tag == PRG_TAG_KILL:
                killed = True
                apply_delta = False
            elif tag == PRG_TAG_NEXT_FRAME:
                p['gfkFrame'] += 1
                if p['gfkFrame'] == frame_counts[p['gfkRecord']]:
                    killed = True
            elif tag == PRG_TAG_PREV_FRAME:
                p['gfkFrame'] -= 1
                if p['gfkFrame'] < 0:
                    killed = True
            elif tag == PRG_TAG_DXDY_ONLY:
                pass  # dx/dy only, no frame change
            elif tag % 4 == 0 and tag <= PRG_TAG_ABSOLUTE_FRAME_MAX:
                frame = tag >> 2
                if frame == frame_counts[p['gfkRecord']]:
                    killed = True
                else:
                    p['gfkFrame'] = frame
            else:
                raise ValueError(f'bcdfa: unrecognised PRG tag 0x{tag:02X}')

            if apply_delta and not killed:
                p['x'] += a
                p['y'] += b
                if not (0 <= p['x'] <= EFF_KILL_X_MAX and 0 <= p['y'] <= EFF_KILL_Y_MAX):
                    killed = True

            if killed:
                slots[i] = None

        yield tick

        if not spawning:
            if not any_alive:
                break
            trailing += 1
            if trailing >= max_trailing_ticks:
                break
        g += 1


ITEM_WIDTH = 24
ITEM_HEIGHT = 24
ITEM_COLOR_PLANES = 6
#: 24x24 @ 6 sequential bitplanes = (24/8) * 24 * 6.
ITEM_ICON_BYTES = (ITEM_WIDTH // 8) * ITEM_HEIGHT * ITEM_COLOR_PLANES  # 432

#: The two RLE streams holding the item icon bank, as file offsets of their
#: opening control byte. Both decode to an exact multiple of 432 with zero
#: remainder, which is what pins the record size (see the module docstring).
ITEM_BANK_STREAMS = (0x1B5B3, 0x2FE5C)

#: Colour index the artists used for the "empty" area around each icon. It is
#: not a mask: the blit is an opaque rectangular copy and this index renders as
#: RGB 0x222222, the same colour as the inventory slot interior (index 20).
ITEM_BACKDROP_INDEX = 53

#: `bcdfs` item-record byte +5 ("item type") -> its confirmed engine category.
#: Sourced from `scripts/extract_bcdfs_items.py`'s walk of every placed item
#: record; used there per-instance and by `scripts/build_item_icon_groups.py`
#: to bucket the icon atlas by category for the viewer.
ITEM_TYPE_NAMES = {
    0x01: 'weapon', 0x02: 'weapon-special', 0x04: 'spell-scroll',
    0x05: 'potion', 0x06: 'key', 0x07: 'helm', 0x08: 'shield',
    0x09: 'armor', 0x0A: 'leggings', 0x0B: 'boots', 0x0C: 'spellbook',
    0x0E: 'food', 0x13: 'container', 0x15: 'ring', 0x18: 'scroll',
    0x19: 'belt', 0x1A: 'amulet', 0x1B: 'shirt', 0x1C: 'pants',
    0x23: 'chest', 0x24: 'bow', 0x25: 'arrow', 0x26: 'death-gem',
    0x27: 'other', 0x29: 'spellcaster', 0x2A: 'bracers',
    0x2B: 'panel-item', 0x2C: 'idol', 0x2D: 'crown', 0x30: 'tablet',
}


def item_icons(raw):
    """Yield ``(bank, index, icon_bytes)`` for every 24x24 item icon in bcdfa.

    `icon_bytes` is a 432-byte record: 6 sequential bitplanes, LSB first, 3
    bytes per row, 72 bytes per plane. There is **no mask plane** — see the
    module docstring.
    """
    from .rle import rle_decompress

    for bank, start in enumerate(ITEM_BANK_STREAMS):
        stream = rle_decompress(raw, start)
        if len(stream) % ITEM_ICON_BYTES:
            raise ValueError(
                f'bcdfa: item bank {bank} at 0x{start:05X} decoded to '
                f'{len(stream)} bytes, not a multiple of {ITEM_ICON_BYTES}')
        for n in range(len(stream) // ITEM_ICON_BYTES):
            yield bank, n, stream[n * ITEM_ICON_BYTES:(n + 1) * ITEM_ICON_BYTES]


ARMOUR_WIDTH = 32
ARMOUR_HEIGHT = 29
ARMOUR_COLOR_PLANES = 6
#: 32x29 @ 6 sequential bitplanes = (32/8) * 29 * 6 = 696; plane stride 116.
ARMOUR_RECORD_BYTES = (ARMOUR_WIDTH // 8) * ARMOUR_HEIGHT * ARMOUR_COLOR_PLANES

#: File offset of the RLE stream holding the 19 chest-armour paperdoll images.
#: Decodes to 13,224 = 19 x 696 with **zero** remainder. The record size and
#: the count both come from the engine itself: `bcdft` S_1 `+0x2083A` does
#: ``MOVEA.L $DC(A5),A1 / MULU.W #$2B8,D0 / LEA (A1,D0.W),A0`` and its caller
#: `+0x2080A` indexes a 236-byte lookup table at S_1 `+0x270CA` whose values
#: run 0..18.
ARMOUR_STREAM = 0x2D05E

#: Backdrop index, same as the item icons (EHB half-bright of register 21).
ARMOUR_BACKDROP_INDEX = ITEM_BACKDROP_INDEX


def armour_icons(raw):
    """Yield ``(index, record_bytes)`` for the 19 chest-armour paperdoll images.

    Each 696-byte record is 32x29 in 6 sequential bitplanes, LSB first, 4 bytes
    per row, 116 bytes per plane. No mask plane — transparency is
    `ARMOUR_BACKDROP_INDEX`, exactly as for the 24x24 item icons.
    """
    from .rle import rle_decompress

    stream = rle_decompress(raw, ARMOUR_STREAM)
    if len(stream) % ARMOUR_RECORD_BYTES:
        raise ValueError(
            f'bcdfa: armour bank at 0x{ARMOUR_STREAM:05X} decoded to '
            f'{len(stream)} bytes, not a multiple of {ARMOUR_RECORD_BYTES}')
    for n in range(len(stream) // ARMOUR_RECORD_BYTES):
        yield n, stream[n * ARMOUR_RECORD_BYTES:(n + 1) * ARMOUR_RECORD_BYTES]


#: File offset of the RLE stream holding the large equipment-panel art.
PAPERDOLL_STREAM = 0x036FD

#: Storage width. Only the left 36 px are drawn; columns 36..47 are off-screen
#: padding filled with index 33 (that constant column is what identifies a
#: record — see `docs/blackcrypt/amiga/data-structure.md`).
PAPERDOLL_STORAGE_WIDTH = 48
PAPERDOLL_WIDTH = 36
PAPERDOLL_COLOR_PLANES = 6

#: Backdrop index *inside* the drawn 36 px — the equipment panel's own colour.
PAPERDOLL_BACKDROP_INDEX = 54

#: ``(stream offset, height)`` for each record, in stream order. Derived by a
#: zero-false-positive structural scan (all six planes must have a constant
#: byte-5 column, pattern FF/00/00/00/00/FF) run over every RLE stream in every
#: Black Crypt Amiga file and over 2 MB of chip RAM from three in-game
#: savestates; these seven are the complete set. Note the 174-byte block at
#: stream offset 0 is *not* a record — see the docs.
PAPERDOLL_RECORDS = (
    (174, 29), (1218, 29), (2262, 29), (3306, 29),
    (4350, 25), (5250, 25), (6150, 25),
)


def paperdoll_records(raw):
    """Yield ``(index, height, record_bytes)`` for the 7 large equipment images.

    `record_bytes` is ``6 * 6 * height``: 6 sequential bitplanes of `height`
    rows x 6 bytes, LSB plane first. Heights are **not** uniform (29, 29, 29,
    29, 25, 25, 25), which is why no fixed stride tiles the stream.
    """
    from .rle import rle_decompress

    stream = rle_decompress(raw, PAPERDOLL_STREAM)
    for n, (off, height) in enumerate(PAPERDOLL_RECORDS):
        size = (PAPERDOLL_STORAGE_WIDTH // 8) * height * PAPERDOLL_COLOR_PLANES
        rec = stream[off:off + size]
        if len(rec) != size:
            raise ValueError(f'bcdfa: paperdoll record {n} at {off} truncated')
        yield n, height, rec


# ── Dungeon-floor item sprites ────────────────────────────────────────────
#
# The graphics the 3D viewport draws for an object lying on a dungeon floor
# square. These are *not* the 24x24 inventory icons: they are separate,
# purpose-drawn "lying flat on the ground" art, masked, and each item has
# **three** pre-rendered size variants — one per view depth.
#
# The pixels are one RLE stream in bcdfa; the geometry is a table of 10-byte
# blit descriptors in the decompressed bcdft S_1 overlay (the same
# "directory lives in the executable" arrangement as bcdfx/y/z). See
# `docs/blackcrypt/amiga/data-structure.md`, "Dungeon-floor item sprites".

#: File offset of the RLE stream holding the floor-item pixel bank.
#: Decodes to 31,388 bytes, tiled exactly by the 147 descriptors below.
FLOOR_ITEM_STREAM = 0x270C4

#: Decompressed size of that stream (used as an integrity check).
FLOOR_ITEM_BANK_BYTES = 31388

#: Offset in decompressed bcdft S_1 of the 10-byte blit-descriptor table.
#: Confirmed by the consumer at S_1 +0x2193E (`LEA 0x271B6(PC),A0`).
FLOOR_ITEM_TABLE = 0x271B6

#: 49 floor graphics x 3 view depths, stored depth-major within each group
#: (near, mid, far). The consumer computes `group * 30 + depth * 10`
#: (S_1 +0x21930 `MULU #30` / +0x21938 `MULU #10`).
FLOOR_ITEM_GROUPS = 49
FLOOR_ITEM_DEPTHS = 3
FLOOR_ITEM_COUNT = FLOOR_ITEM_GROUPS * FLOOR_ITEM_DEPTHS  # 147

#: 1 cookie-cut mask plane + 6 EHB colour planes, mask first.
FLOOR_ITEM_PLANES = 7

#: Offset in decompressed bcdft S_1 of the 236-byte
#: `bcdfs` item `gfxNumber` -> floor-graphics group table. Values 0..48 select
#: a group; 0xFF means "this item has no floor graphic" (the consumer branches
#: on it with `BMI` at S_1 +0x21914). Read at S_1 +0x21908.
FLOOR_ITEM_GFX_TABLE = 0x26FDE
FLOOR_ITEM_GFX_TABLE_LEN = 236
FLOOR_ITEM_GFX_NONE = 0xFF

#: Confirmed group names, index-for-index. Source: the DOS/Windows port's
#: `clipper.clp` archive carries its own explicit `Start Floor Items` /
#: `End Floor Items` marker block (directory entries 652-798 — 147 entries,
#: named on the first of every 3), independently delimiting the *same*
#: 49-groups-x-3-depths bank. All 147/147 (group, depth) width/height pairs
#: match the Amiga descriptor table exactly at the *same* group index
#: (verified against `public/assets/blackcrypt/amiga/sprites/floor-items.json`),
#: and per-pixel opacity (Amiga mask plane vs DOS's brown/cyan background-key)
#: agrees on 35,869/35,872 pixels (99.992%) across the whole bank, including
#: 100.000% on all 4 same-dimension pairs that dimension-matching alone could
#: not disambiguate (0/39 Hammer vs Tall Shield, 5/6 Gold Key vs Silver Key,
#: 14/15 White Clothes vs Brown Clothes). "Figurein of Deflection" (index 34)
#: is verbatim from the archive — an authentic misspelling in the game's own
#: data, not a transcription error here. See
#: `scripts/verify_floor_item_dos_names.py` and
#: `docs/blackcrypt/amiga/data-structure.md`, "Dungeon-floor item sprites".
FLOOR_ITEM_NAMES = [
    'Hammer', 'Belt', 'Apple', 'Backpack', 'Quiver', 'Gold Key', 'Silver Key',
    'Death Gem', 'Dagger', 'Cheese', 'Sword', 'Bag', 'Scroll', 'Amulet',
    'White Clothes', 'Brown Clothes', 'Spell Book', 'Horn', 'Bow', 'Arrow',
    'Potion', 'Helmet', 'Wand', 'Ring', 'Crown', 'Bracers', 'Gauntlets',
    'Meat', 'Water Skin', 'Blue Eyes', 'Holy Symbol', 'Coffer', 'Chain Mail',
    'Sun Key', 'Figurein of Deflection', 'Skull', 'Mace', 'Rod',
    'Idol of Temin', 'Tall Shield', 'Round Shield', 'Axe',
    'Chest Plate Armor', 'Boot Plate Armor', 'Big Chest', 'Clawpiller Mask',
    'Orb', 'Leather Boots', 'Stone Tablet',
]
assert len(FLOOR_ITEM_NAMES) == FLOOR_ITEM_GROUPS


def floor_item_descriptors(bcdft_s1):
    """Yield the 147 ``(src, bytes_per_plane, bltsize, modulo, w, h)`` records.

    Every record satisfies three independent self-describing invariants —
    ``bytes_per_plane == (w // 8) * h``, ``bltsize == (h << 6) | (w // 16 + 1)``
    and ``modulo == 40 - (w // 16 + 1) * 2`` — and, sorted by ``src``, the
    records tile ``[0, FLOOR_ITEM_BANK_BYTES)`` with no gap and no overlap.
    `floor_item_sprites` re-checks all of that.
    """
    import struct

    for n in range(FLOOR_ITEM_COUNT):
        off = FLOOR_ITEM_TABLE + n * 10
        src, bpp, bltsize, modulo = struct.unpack_from('>HHHH', bcdft_s1, off)
        w, h = bcdft_s1[off + 8], bcdft_s1[off + 9]
        yield src, bpp, bltsize, modulo, w, h


def floor_item_sprites(raw, bcdft_s1):
    """Yield ``(index, group, depth, width, height, record_bytes)``.

    `record_bytes` is ``7 * (w // 8) * h``: the 1-bit mask plane followed by
    six EHB colour planes, ready for `planar.decode_masked`.
    """
    from .rle import rle_decompress

    bank = rle_decompress(raw, FLOOR_ITEM_STREAM)
    if len(bank) != FLOOR_ITEM_BANK_BYTES:
        raise ValueError(
            f'bcdfa: floor-item bank at 0x{FLOOR_ITEM_STREAM:05X} decoded to '
            f'{len(bank)} bytes, expected {FLOOR_ITEM_BANK_BYTES}')

    recs = list(floor_item_descriptors(bcdft_s1))
    for n, (src, bpp, bltsize, modulo, w, h) in enumerate(recs):
        if w == 0 or w % 8 or h == 0:
            raise ValueError(f'bcdfa: floor-item record {n} has bad geometry {w}x{h}')
        if bpp != (w // 8) * h:
            raise ValueError(f'bcdfa: floor-item record {n} bytes/plane {bpp} != {w}x{h}')
        if bltsize != ((h << 6) | (w // 16 + 1)):
            raise ValueError(f'bcdfa: floor-item record {n} BLTSIZE {bltsize:#06x} inconsistent')
        if modulo != 40 - (w // 16 + 1) * 2:
            raise ValueError(f'bcdfa: floor-item record {n} modulo {modulo} inconsistent')

    pos = 0
    for src, bpp, _, _, w, h in sorted(recs):
        if src != pos:
            raise ValueError(f'bcdfa: floor-item bank not tiled — gap/overlap at {src}')
        pos = src + FLOOR_ITEM_PLANES * bpp
    if pos != FLOOR_ITEM_BANK_BYTES:
        raise ValueError(f'bcdfa: floor-item records cover {pos} of {FLOOR_ITEM_BANK_BYTES} bytes')

    for n, (src, bpp, _, _, w, h) in enumerate(recs):
        size = FLOOR_ITEM_PLANES * bpp
        yield (n, n // FLOOR_ITEM_DEPTHS, n % FLOOR_ITEM_DEPTHS,
               w, h, bank[src:src + size])


def floor_item_gfx_table(bcdft_s1):
    """The 236-byte `gfxNumber` -> floor-graphics-group lookup, as a list.

    Entry value `FLOOR_ITEM_GFX_NONE` (0xFF) means the item draws nothing on
    the floor.
    """
    return list(bcdft_s1[FLOOR_ITEM_GFX_TABLE:
                         FLOOR_ITEM_GFX_TABLE + FLOOR_ITEM_GFX_TABLE_LEN])


# ── UI panel bank (RLE stream at file offset 0) ───────────────────────────
#
# bcdfa's very first RLE stream — file offset 0, decoding to exactly 18,932 B
# and terminating right where the paperdoll stream begins (0x036FD) — holds
# the game's in-dungeon "Adventure Screen" status-bar art: the class LV:/AC:
# stat panel, the character-portrait placeholder frame, the twin-gem
# ring-slot graphic, the Save/Rest options buttons and the 8-way
# movement-arrow compass.
#
# > **Correction — supersedes the maskless-backdrop-trick reading.** These
# > are **7-plane masked** records (stencil plane 0 + 6 EHB colour planes),
# > read via the game's own 28-byte generic blit descriptors, the same
# > record type documented in the `bcdfx`/`bcdfy`/`bcdfz` section. The
# > original padding-column scan found each record's *colour* data one whole
# > plane block **late** — `UI_PANEL_RECORDS` below stores each descriptor's
# > real `src` (`hit - bytesPerPlane`), so every record now decodes
# > cookie-cut against its own stencil instead of as an opaque backdrop-keyed
# > rectangle. `as_stats_alt` (the old scan's second "AS Stats" hit at 1,680)
# > is **not a second record** — it *was* `as_stats`'s own stencil plane,
# > read one plane too late a second time; see data-structure.md's
# > "`as_stats_alt` — RESOLVED" for the full account. It is dropped here.
#
# Every record's full geometry is independently confirmed against the DOS
# `clipper.clp` archive's own named entries of the same name — not just
# matched on byte count. See docs/blackcrypt/amiga/data-structure.md,
# "bcdfa — UI Panel Bank" for the per-record silhouette percentages
# (98.8-100%).
UI_PANEL_STREAM = 0x00000
UI_PANEL_COLOR_PLANES = 6

#: ``(name, src, w, h)``. `src` is the descriptor's stencil-plane offset
#: (`hit - bytesPerPlane` from the original padding-column scan hit),
#: relative to the decoded UI_PANEL_STREAM (bcdfa file offset 0). Each
#: record is `7 * bytesPerPlane` bytes: 1 stencil plane at `src`, then 6 EHB
#: colour planes — feed straight to `decode_masked`.
UI_PANEL_RECORDS = (
    # The AS Stats (LV:/AC:) panel template — matches DOS "AS Stats" (67x28)
    # at 99.360% silhouette agreement (1,876 px).
    ('as_stats', 1680, 80, 28),
    # Character-portrait placeholder frame. Matches DOS "Face Square"
    # (36x28) at 98.810% (1,008 px).
    ('face_square', 3640, 48, 28),
    # Twin-gem ring-slot graphic. Matches DOS "Gem Stone" (88x25) at
    # 100.000% (2,200 px).
    ('gem_stone', 9616, 96, 25),
    # Save (floppy disk) + Rest (ZZZ) button pair. Matches DOS "Options"
    # (56x31) at 100.000% (1,705 px).
    ('options', 11716, 64, 31),
    # 8-way movement compass. Matches DOS "Up Arrows" (49x31) at 100.000%
    # (1,519 px).
    ('up_arrows', 13452, 64, 31),
    # A 50% black stipple over a 24x24 area (storage 32x24) — the ghosting
    # effect. Matches DOS entry 133 "Ghost" (24x24): both are a two-value
    # single-pixel checkerboard, 288 px each. Every masked pixel carries
    # colour index 0 (black); the Amiga draws it as a cookie-cut stipple
    # rather than DOS's pre-dithered bitmap. Renamed from `checker_tile`.
    ('ghost', 17416, 32, 24),
    # DOS "Page 1"-"Page 5" (149-153), 16x8 each, 100.000% silhouette.
    ('page_1', 18088, 16, 8),
    ('page_2', 18200, 16, 8),
    ('page_3', 18312, 16, 8),
    ('page_4', 18424, 16, 8),
    ('page_5', 18536, 16, 8),
    # DOS "Pressure Plate 1/2 Up/Down" (79-82) — closes `tileset-missing-dos-
    # items` for 4 of the original 6 missing entries; see data-structure.md.
    ('pressure_plate_1_up', 18764, 16, 4),
    ('pressure_plate_1_down', 18820, 16, 4),
    ('pressure_plate_2_up', 18876, 16, 2),
    ('pressure_plate_2_down', 18904, 16, 2),
)


def ui_panel_stream(raw):
    """Decode bcdfa's offset-0 RLE stream (the UI panel bank)."""
    from .rle import rle_decompress
    return rle_decompress(raw, UI_PANEL_STREAM)


def ui_panel_records(raw):
    """Yield ``(name, w, h, index_array, mask)`` for each `UI_PANEL_RECORDS` entry.

    Each record is a 7-plane masked sprite (stencil + 6 EHB colour planes);
    `index_array`/`mask` are ready for `to_rgba(idx, pal, mask=mask)`.
    """
    from .planar import decode_masked

    stream = ui_panel_stream(raw)
    for name, src, w, h in UI_PANEL_RECORDS:
        bpp = (w // 8) * h
        size = 7 * bpp
        rec = stream[src:src + size]
        if len(rec) != size:
            raise ValueError(f'bcdfa: UI panel record {name!r} at {src} truncated')
        idx, mask = decode_masked(rec, w, h, UI_PANEL_COLOR_PLANES)
        yield name, w, h, idx, mask


# ── Effect sound bank (raw PCM between the paperdoll and GFK streams) ─────
#
# The 28,846 bytes between the paperdoll RLE stream's end (bcdfa+0x6F4D) and
# the BCSPEED.GFK RLE stream's start (bcdfa+0xDFFB) are not compressed at all
# — they are a raw **signed 8-bit PCM** sound bank, the BCSPEED effect sound
# effects (paired with the GFK bank's spell/projectile animation frames), in
# exactly the convention already documented for bcdfb-bcdfn's monster sound
# banks (raw PCM, DOS byte = Amiga byte XOR 0x80).
#
# This *retracts* the previous "336-byte raw movement/delta table" reading of
# `0xDEAB-0xDFFB`: that span is simply the tail of the last sample
# (`up_25`/`up_26`, byte-identical to DOS clipper.clp entry 190/192), not a
# separate structure. There is no gap and no header — the ten samples below
# tile the whole 28,846-byte span with zero slack, confirmed against 14 of
# clipper.clp's 22 `type=4` sound entries byte-for-byte (`entry_bytes XOR
# 0x80` found verbatim at each offset); the other 8 DOS sound entries are the
# already-documented bcdfb/c/f/j/m monster sound bank samples.
SFX_BANK_START = 0x6F4D
SFX_BANK_END = 0xDFFB

#: ``(offset, size, dos_entries)`` — file-relative offsets into bcdfa, sizes
#: in bytes, and the clipper.clp entry indices (type=4 sound) whose data is
#: byte-identical (after XOR 0x80). Tiles [SFX_BANK_START, SFX_BANK_END) with
#: zero gap/overlap, confirmed.
SFX_RECORDS = (
    (0x6F4D, 4456, (181, 194)),
    (0x80B5, 2186, (182, 191)),
    (0x893F, 9020, (183,)),
    (0xAC7B, 2748, (184,)),
    (0xB737, 1750, (185,)),
    (0xBE0D, 598, (186,)),
    (0xC063, 878, (187,)),
    (0xC3D1, 3974, (188,)),
    (0xD357, 1040, (189,)),
    (0xD767, 2196, (190, 192)),
)


def sfx_samples(raw):
    """Yield ``(index, dos_entries, pcm_bytes)`` for the 10 unique effect samples.

    `pcm_bytes` is signed 8-bit PCM, Amiga byte order (XOR 0x80 to get the
    unsigned convention clipper.clp's `type=4` entries use).
    """
    for n, (off, size, dos_entries) in enumerate(SFX_RECORDS):
        yield n, dos_entries, raw[off:off + size]


# ── Throwing-items projectile sprites (SLOT_THROWING_ITEMS, entry 12) ────
#
# Container-directory entry 12, `SLOT_THROWING_ITEMS` (0x300C2, raw — not
# RLE), 1,092 bytes. The in-flight sprite bank for thrown/fired weapons:
# Arrow and Dagger, each at 3 shrinking view depths and both horizontal
# facings — 2 weapons x 3 depths x 2 facings = 12 records. Confirmed via its
# own consumer (the projectile-flight animator, S_1 `+0x21A78`), two
# corroborating tables (a per-weapon hot-spot table at `+0x21C6C` and a
# 24-point flight-path table at `+0x21A48`) and the DOS `clipper.clp`
# archive, which brackets exactly these six sprite *shapes* (both facings
# are runtime mirrors, not separately catalogued) between its "Start/End
# Throwing Items" markers. See data-structure.md's "`0x300C2`-EOF tail".
#
# `facing 1` is the **exact horizontal bit-reverse** of `facing 0` — verified
# row-for-row (273/273 rows, zero deviation) — so this table only needs to
# record `facing 0`'s geometry; `throwing_item_sprites` derives facing 1's
# `src` the same way the game's own descriptor table does (a fixed second
# offset), not by re-deriving the mirror.
THROWING_ITEM_COLOR_PLANES = 6

#: ``(name, facing0_src, facing1_src, width, height)``. `src` is a byte
#: offset into the decoded `SLOT_THROWING_ITEMS` chunk; every record is
#: `7 * (width // 8) * height` bytes (1 mask plane + 6 EHB colour planes).
#: The 12 records tile the whole 1,092-byte chunk with zero gap/overlap:
#: `1050 + 7 * 6 = 1092`.
THROWING_ITEM_RECORDS = (
    ('arrow_near', 0, 546, 16, 11),
    ('arrow_mid', 154, 700, 16, 8),
    ('arrow_far', 266, 812, 16, 5),
    ('dagger_near', 336, 882, 16, 7),
    ('dagger_mid', 434, 980, 16, 5),
    ('dagger_far', 504, 1050, 16, 3),
)


def throwing_item_sprites(chunk):
    """Yield ``(name, facing, w, h, index_array, mask)`` for all 12 sprites.

    `chunk` is the decoded `SLOT_THROWING_ITEMS` container chunk (this bank
    is stored raw, so `read_container_chunks` returns it unchanged — no RLE
    step needed). `facing` is 0 (as-drawn) or 1 (horizontal mirror).
    """
    from .planar import decode_masked

    for name, src0, src1, w, h in THROWING_ITEM_RECORDS:
        bpp = (w // 8) * h
        size = 7 * bpp
        for facing, src in ((0, src0), (1, src1)):
            rec = chunk[src:src + size]
            if len(rec) != size:
                raise ValueError(
                    f'bcdfa: throwing-item record {name!r} facing {facing} '
                    f'at {src} truncated')
            idx, mask = decode_masked(rec, w, h, THROWING_ITEM_COLOR_PLANES)
            yield name, facing, w, h, idx, mask

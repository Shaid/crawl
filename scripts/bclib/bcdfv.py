"""bcdfv — the Black Crypt Amiga **ending sequence** container.

bcdfv is not a sprite store. It is the data file for `bcdfu`, the standalone
endgame/epilogue overlay: ten narrated illustration panels, an ornate picture
frame, an 8x8 font, two versions of the Black Crypt facade, and the credits
text. Every byte of the 191,917-byte file is one of 16 blocks, read strictly
sequentially (no seeking, no directory) by bcdfu's LAB_0033..LAB_0040.

Geometry here is taken from bcdfu's blitter setup, not guessed:

  LAB_0064  picture dissolve  BLTSIZE $064A -> 10 words x 25 rows,
                              BLTBMOD 60 (source 20 B/row), A1 += 1980/plane,
                              dest offsets $02DA/$0302/$032A/$0352 -> screen
                              row 18..21, byte 10  =>  160x99 at (80,18),
                              6 planes, 1980 B/plane, 11,880 B total.
  LAB_0072  text-panel grab   8 longs/row + ADDQ #8 (stride 40), 55 rows,
                              A2 += 8000/plane, source 5404 = row 135 byte 4
                              =>  256x55 at (32,135), 6 planes.
  LAB_0020  font glyph blit   A0 = buffer+$1A5E0 + (ch-0x20)*$30, then per
                              plane 8 single-byte writes at stride 40
                              =>  8x8, 6 planes, 48 B/glyph.
  LAB_0076  credits scroll    BLTSIZE $264F -> 15 words x 153 rows,
                              BLTDMOD 10 (source 30 B/row), BLTDPT into
                              buffer+$7D00 = plane 4 only
                              =>  240x153, 1 plane, 4,590 B total.

See docs/blackcrypt/amiga/data-structure.md, "bcdfv".
"""
import struct

FILE_SIZE = 191_917

#: Picture panels: 160x99, 6 sequential planes, 20 bytes/row, 1980 B/plane.
PANEL_WIDTH = 160
PANEL_HEIGHT = 99
PANEL_PLANES = 6
PANEL_BYTES = 11_880            # 20 * 99 * 6
PANEL_ORIGIN = (80, 18)         # x, y on the 320x200 screen

#: Text panel the narration is typed into (LAB_0072 / LAB_006B).
TEXT_PANEL = (32, 135, 256, 55)  # x, y, w, h

#: Font: ASCII 0x20..0x5A, 8x8, 6 planes, plane-major *within* each glyph.
FONT_FIRST_CHAR = 0x20
FONT_GLYPH_BYTES = 0x30
FONT_WIDTH = FONT_HEIGHT = 8
FONT_PLANES = 6
FONT_GLYPHS = 59                # 2832 / 48, exact

#: Credits graphic: 240x153, one bitplane, blitted into screen plane 4.
CREDITS_WIDTH = 240
CREDITS_HEIGHT = 153
CREDITS_ROW_BYTES = 30          # 30 * 153 = 4590, exact
CREDITS_PLANE = 4

SCREEN_WIDTH = 320
SCREEN_HEIGHT = 200
SCREEN_PLANE_BYTES = 8_000

#: The read schedule, in file order. `kind` is how bcdfu *reads* the block:
#: 'rle' blocks are decompressed as they are read; 'raw' blocks are read
#: verbatim into the scratch area. Note block 3 is read raw but decompressed
#: **later**, by LAB_005E, at the moment of the white flash — it is RLE data,
#: not raw pixels.
BLOCKS = [
    # (name,        size,   kind,  reader)
    ('congrats',    0x4EB0, 'rle', 'LAB_0038'),
    ('frame',       0x5067, 'rle', 'LAB_003B'),
    ('font',        0x0B10, 'raw', 'LAB_003C'),
    ('panel01',     0x2500, 'rle', 'LAB_003F'),
    ('panel02',     0x2A6B, 'rle', 'LAB_0022'),
    ('panel03',     0x26E5, 'rle', 'LAB_0022'),
    ('panel04',     0x279C, 'rle', 'LAB_0022'),
    ('panel05',     0x1AD2, 'rle', 'LAB_0022'),
    ('panel06',     0x2074, 'rle', 'LAB_0022'),
    ('panel07',     0x1D80, 'rle', 'LAB_0022'),
    ('panel08',     0x2688, 'rle', 'LAB_0022'),
    ('panel09',     0x266E, 'rle', 'LAB_0022'),
    ('panel10',     0x267D, 'rle', 'LAB_0022'),
    ('crypt',       0x6754, 'rle', 'LAB_0039'),
    ('crypt_ruin',  0x678C, 'raw', 'LAB_003A'),   # RLE, decompressed by LAB_005E
    ('credits',     0x0A81, 'rle', 'LAB_0040'),
]

#: Decompressed size every block must produce. Checked by `read_blocks`;
#: all 16 hold with zero deviation across the file.
EXPECTED_SIZE = {
    'congrats':   32_000,       # 320x200, planes 0-3
    'frame':      48_000,       # 320x200, 6 planes (EHB)
    'font':        2_832,       # 59 glyphs x 48 B
    'crypt':      40_000,       # 320x200, planes 0-4
    'crypt_ruin': 32_000,       # 320x200, planes 0-3 (plane 4 kept from `crypt`)
    'credits':     4_590,       # 240x153, 1 plane
}
EXPECTED_SIZE.update({f'panel{i:02d}': PANEL_BYTES for i in range(1, 11)})

PANEL_NAMES = [f'panel{i:02d}' for i in range(1, 11)]

#: bcdfu file offsets. The hunk header puts the disassembly's section-relative
#: addresses 0x24 further along in the file (LAB_0010's "THROUGH INCREDIBLE
#: BRAVERY" sits at asm 0x5ca, file 0x5ee). bclib.palette's already-verified
#: BCDFU_DUNGEON_PALETTES = [0x3EC, 0x42C, 0x46C, 0x4AC, 0x4EC] are exactly
#: LAB_0008..LAB_000C under the same delta, which is what pins it.
HUNK_DELTA = 0x24

PALETTES = {            # file offset -> 32 big-endian 12-bit words
    'congrats':  0x3AC,   # LAB_0007, 16 colours duplicated into 32 slots
    'panel_a':   0x3EC,   # LAB_0008
    'panel_b':   0x42C,   # LAB_0009
    'panel_c':   0x46C,   # LAB_000A
    'panel_d':   0x4AC,   # LAB_000B
    'panel_e':   0x4EC,   # LAB_000C
    'crypt':     0x52C,   # LAB_000D
    'crypt_lit': 0x56C,   # LAB_000E — the lightning-flash variant (LAB_0023)
    'crypt_ruin': 0x5AC,  # LAB_000F
}

#: Which palette each panel is shown under, from the LAB_0022 call sequence at
#: bcdfu asm 0x0FE..0x19C. LAB_0022 loads the palette for the panel already on
#: screen and *then* reads the next one, so call i's palette belongs to panel i.
PANEL_PALETTE = ['panel_a', 'panel_a', 'panel_a', 'panel_c', 'panel_c',
                 'panel_e', 'panel_c', 'panel_b', 'panel_d', 'panel_d']

#: First narration record (LAB_0010). Ten 0xFF-terminated blocks follow
#: contiguously; each record is [textColumn, pixelRow, "STRING", 0x00].
TEXT_TABLE = 0x5C8 + HUNK_DELTA


def read_blocks(data, rle_decompress):
    """Split bcdfv into its 16 named blocks.

    Returns {name: bytes} of *decoded* payloads. `rle_decompress` is injected
    to avoid a circular import; pass `bclib.rle_decompress`.

    Raises ValueError if the file is the wrong size or any block's decompressed
    length differs from EXPECTED_SIZE — the invariant that verifies the parse.
    """
    if len(data) != FILE_SIZE:
        raise ValueError(f'bcdfv is {len(data)} bytes, expected {FILE_SIZE}')

    out = {}
    pos = 0
    for name, size, _kind, _reader in BLOCKS:
        chunk = data[pos:pos + size]
        pos += size
        # 'crypt_ruin' is read raw but is RLE; decompress it here so callers
        # see pixels. 'font' is the only genuinely uncompressed block.
        payload = chunk if name == 'font' else rle_decompress(chunk)
        want = EXPECTED_SIZE[name]
        if len(payload) != want:
            raise ValueError(f'bcdfv block {name}: got {len(payload)} B, expected {want}')
        out[name] = payload
    if pos != FILE_SIZE:
        raise ValueError(f'bcdfv: consumed {pos} of {FILE_SIZE} bytes')
    return out


def read_palette(bcdfu, name):
    """Read one of bcdfu's 32-word epilogue palettes by name."""
    off = PALETTES[name]
    return [struct.unpack('>H', bcdfu[off + i * 2:off + i * 2 + 2])[0]
            for i in range(32)]


def read_script(bcdfu, count=10):
    """Decode the ten narration text blocks from bcdfu.

    Yields one list of (column, pixel_row, text) per panel. `column` is in
    8-pixel character cells (LAB_0020 does row*40 + column); `pixel_row` is an
    absolute screen scanline, always inside TEXT_PANEL.
    """
    pos = TEXT_TABLE
    blocks = []
    for _ in range(count):
        recs = []
        while bcdfu[pos] != 0xFF:
            col, row = bcdfu[pos], bcdfu[pos + 1]
            pos += 2
            end = bcdfu.index(b'\x00', pos)
            recs.append((col, row, bcdfu[pos:end].decode('latin1')))
            pos = end + 1
        pos += 1
        while bcdfu[pos] == 0:      # inter-block padding
            pos += 1
        blocks.append(recs)
    return blocks


def font_glyph(font, code):
    """Return the 48 raw bytes of one glyph, or None if out of range."""
    i = code - FONT_FIRST_CHAR
    if not 0 <= i < FONT_GLYPHS:
        return None
    return font[i * FONT_GLYPH_BYTES:(i + 1) * FONT_GLYPH_BYTES]

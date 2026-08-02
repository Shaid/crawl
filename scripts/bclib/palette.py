"""Black Crypt palettes.

The three bcdfq palettes are contiguous **file** offsets:

    0x266  16 words  raven logo intro screen
    0x286  32 words  title screen and logo banner
    0x2C6  32 words  main in-game palette (portraits, monsters, dungeon)

0x266 + 16 words = 0x286, + 32 words = 0x2C6, + 32 words = 0x306, and each table
begins with 0x000 — that contiguity is what confirms the alignment.

Older notes describe these as `CODE + 0x266` etc., adding the 36-byte hunk
header. That is wrong: it misaligns every entry, and reading 32 words at
`CODE + 0x2C6` (0x2EA) runs off the end of the table into 68k opcodes (0x4E75 =
RTS). There is no separate "dungeon palette" — 0x2EA is the main palette read
18 words late.
"""
import json
import struct

BCDFQ_PALETTES = {
    'raven': {'offset': 0x266, 'count': 16},
    'title': {'offset': 0x286, 'count': 32},
    'game':  {'offset': 0x2C6, 'count': 32},
}

# The dungeon 3D view does NOT run on the bcdfq `game` palette as-shipped.
# A live copper-list read (COP1LC, COLOR00-COLOR31 decoded instruction by
# instruction while a dungeon view was on screen) matched bcdfq `game` exactly
# for COLOR00-25 and differed for COLOR26-31 — a six-entry accent ramp the game
# reprograms at runtime (it also drives EHB half-brights 58-63, the masonry
# mid-tones).
#
# The **authoritative** table is in the decompressed bcdft image, not in bcdfu:
#
#   bcdft_decompressed.bin (S_1) + 0x27AC0   live 32-word dungeon palette
#   bcdft_decompressed.bin (S_1) + 0x27B00   12 accent ramps, 12 bytes each
#   bcdft_s2_data.bin      (S_2) + 0x039E    13 per-level ramp indices
#
# `SetDungeonPalette(index)` at S_1+0x26900 copies ramp `index` into the tail of
# the palette buffer and into the live copper list at COLOR26..COLOR31.
# bcdfu's five 64-byte records are the *epilogue overlay's* copies of ramps 0-4.
# See docs/blackcrypt/amiga/data-structure.md, "Dungeon accent-ramp selection".
# The automap runs on its own 32-word palette, built into a copper list by
# bcdft S_1 `+0x1E792`-`+0x1E884` and read straight off the table that follows
# that routine's RTS. The automap screen is *dual playfield*: BPLCON0 = 0x5400
# (BPU = 5, DBLPF), playfield 1 = the 3-plane 8x8 tilemap (colours 0-7),
# playfield 2 = the 2-plane 16x20 cell grid (pixel v -> COLOR 8+v). Entries
# 0-11 reproduce DOS `clipper.clp`'s "Automap Palette" indices 64-75
# colour-for-colour (max channel error 10/255, i.e. pure 12-bit quantisation);
# 12-31 are Amiga-only (16-31 are the hardware-sprite registers).
BCDFT_AUTOMAP_PALETTE = 0x1E886     # S_1: 32 big-endian 12-bit words
AUTOMAP_PLAYFIELD2_COLOR_BASE = 8

BCDFT_DUNGEON_PALETTE = 0x27AC0     # S_1: 32 words, shipped = ramp 0 in the tail
BCDFT_ACCENT_RAMPS = 0x27B00        # S_1: 12 ramps x 6 words (COLOR26..31)
BCDFT_ACCENT_RAMP_COUNT = 12
BCDFT_LEVEL_RAMP_TABLE = 0x039E     # S_2: 13 big-endian words, one per level
DUNGEON_LEVELS = 13

# Which *tileset file* each level loads. The filename is built at runtime by
# patching the last byte of one "bcdf?" template at S_1+0x1DE0A:
#
#   S_1+0x21E7E   D0 = (level-1) + 0x62  ->  bcdfb..bcdfn  (level graphic stores)
#   S_1+0x1DD16   D0 = param    + 0x77  ->  bcdfw/x/y/z    (tilesets)
#
# The level-entry routine at S_1+0x1A5CC dispatches on the 1-based level with
# hardcoded ranges: levels 1-4 and 12-13 -> bcdfx (GAMEDISK2), level 5 -> bcdfy,
# levels 6-11 -> bcdfz (GAMEDISK3). A per-level table at S_1+0x21FCE holds the
# same partition as 0/1/2 (= param-1) and is stored to $51A(A5) as a
# graphics-variant flag.
BCDFT_LEVEL_TILESET_TABLE = 0x21FCE  # S_1: 13 big-endian words, one per level
TILESET_FILES = ('bcdfx', 'bcdfy', 'bcdfz')

#: Ramp forced while the party stands on a map square whose longword has bit 31
#: set (bcdft S_1+0x02D46). Levels other than 3 only.
SQUARE_FLAG_RAMP = 4

#: bcdfp's single 32-word palette record (`LAB_0148`, bcdfp file 0x4194) — the
#: loader / character-generation palette, byte-identical to `BlackCrypt`+0x2848
#: and to the DOS port's `Character_Gen_Palette`. This is the palette every
#: `bcdfo` element is authored against (bcdfp's own fade routines `LAB_0131` /
#: `LAB_0137` install it and nothing else touches bcdfp's copper COLOR block);
#: it differs from bcdfq's `game` palette at index 19 and 26-31, which is
#: exactly the accent range the sigils and numerals use.
BCDFP_CHARGEN_PALETTE = 0x4194

BCDFU_DUNGEON_PALETTES = [0x03EC, 0x042C, 0x046C, 0x04AC, 0x04EC]

#: Ramp used by dungeon levels 1-4 (tan sandstone) — also the shipped content of
#: the live palette buffer, and byte-identical to the DOS port's `Palette`.
BCDFU_TAN_SANDSTONE = 0


def read_dungeon_palette(bcdfu, variant=BCDFU_TAN_SANDSTONE):
    """Read one of bcdfu's five 32-word palette records.

    Kept for compatibility. These are the *epilogue screens'* palettes; they
    happen to equal dungeon accent ramps 0-4 in their tails. For dungeon work
    prefer `read_dungeon_palette_for_level`.
    """
    return read_palette_words(bcdfu, BCDFU_DUNGEON_PALETTES[variant], 32)


def read_chargen_palette(bcdfp):
    """Read bcdfp's 32-word loader / character-generation palette."""
    return read_palette_words(bcdfp, BCDFP_CHARGEN_PALETTE, 32)


def read_accent_ramp(bcdft_s1, index):
    """Read accent ramp `index` (6 words -> COLOR26..COLOR31) from bcdft S_1."""
    if not 0 <= index < BCDFT_ACCENT_RAMP_COUNT:
        raise IndexError('accent ramp index %d out of range 0..%d'
                         % (index, BCDFT_ACCENT_RAMP_COUNT - 1))
    return read_palette_words(bcdft_s1, BCDFT_ACCENT_RAMPS + index * 12, 6)


def read_level_ramp_indices(bcdft_s2):
    """Read the 13-entry per-level accent-ramp index table from bcdft S_2."""
    return read_palette_words(bcdft_s2, BCDFT_LEVEL_RAMP_TABLE, DUNGEON_LEVELS)


def read_level_tileset_indices(bcdft_s1):
    """Read the 13-entry per-level tileset index table from bcdft S_1.

    Values are 0/1/2, indexing `TILESET_FILES` (bcdfx/bcdfy/bcdfz).
    """
    return read_palette_words(bcdft_s1, BCDFT_LEVEL_TILESET_TABLE, DUNGEON_LEVELS)


def tileset_levels(bcdft_s1):
    """Map each tileset filename to the sorted list of levels that load it."""
    out = {name: [] for name in TILESET_FILES}
    for level, idx in enumerate(read_level_tileset_indices(bcdft_s1), start=1):
        out[TILESET_FILES[idx]].append(level)
    return out


def tileset_ramps(bcdft_s1, bcdft_s2):
    """Map each tileset filename to the sorted accent-ramp indices it renders under.

    bcdfy -> [1] and bcdfz -> [2] are exclusive; bcdfx -> [0, 3] because it
    serves levels 1-4 (tan sandstone) and 12-13 (neutral grey).
    """
    ramps = read_level_ramp_indices(bcdft_s2)
    out = {}
    for name, levels in tileset_levels(bcdft_s1).items():
        out[name] = sorted({ramps[level - 1] for level in levels})
    return out


def read_dungeon_palette_for_tileset(bcdft_s1, bcdft_s2, tileset):
    """The 32-word dungeon palette for a tileset file's *primary* accent ramp.

    "Primary" = the ramp of the lowest-numbered level that loads the tileset.
    Exact for bcdfy (ramp 1) and bcdfz (ramp 2), which each use one ramp only;
    for bcdfx it picks ramp 0 (levels 1-4) over ramp 3 (levels 12-13).
    """
    levels = tileset_levels(bcdft_s1).get(tileset)
    if not levels:
        raise KeyError('unknown dungeon tileset %r' % (tileset,))
    return read_dungeon_palette_for_level(bcdft_s1, bcdft_s2, levels[0])


def read_dungeon_palette_for_level(bcdft_s1, bcdft_s2, level):
    """The full 32-word dungeon palette as level `level` (1-13) installs it."""
    if not 1 <= level <= DUNGEON_LEVELS:
        raise IndexError('dungeon level %d out of range 1..%d'
                         % (level, DUNGEON_LEVELS))
    words = read_palette_words(bcdft_s1, BCDFT_DUNGEON_PALETTE, 32)
    ramp = read_accent_ramp(bcdft_s1, read_level_ramp_indices(bcdft_s2)[level - 1])
    return words[:26] + ramp


def amiga12_to_rgb(word, half_bright=False):
    """One 12-bit Amiga colour word (0x0RGB) to a 24-bit RGB tuple.

    EHB halves each 4-bit component *before* scaling, so half-bright is
    (nibble >> 1) * 17 — not (nibble * 17) >> 1, which is off by up to 8.
    """
    r, g, b = (word >> 8) & 0xF, (word >> 4) & 0xF, word & 0xF
    if half_bright:
        r, g, b = r >> 1, g >> 1, b >> 1
    return (r * 17, g * 17, b * 17)


def read_palette_words(data, offset, count):
    """Read `count` big-endian 12-bit colour words from `offset`."""
    return [struct.unpack('>H', data[offset + i * 2:offset + i * 2 + 2])[0]
            for i in range(count)]


def read_named_palette(bcdfq, name):
    """Read one of BCDFQ_PALETTES by name."""
    spec = BCDFQ_PALETTES[name]
    return read_palette_words(bcdfq, spec['offset'], spec['count'])


def ehb_palette(words):
    """Expand colour words into a flat RGB list, with EHB half-bright copies.

    Entries 0..n-1 are the base colours; n..2n-1 are their half-bright twins,
    which is what a 6bpp EHB sprite's plane 6 selects.
    """
    flat = []
    for w in words:
        flat.extend(amiga12_to_rgb(w))
    for w in words:
        flat.extend(amiga12_to_rgb(w, half_bright=True))
    return flat


def load_palette_json(path):
    """Load a {index: [r,g,b]} JSON palette and add its EHB half-bright half.

    Each stored component is an exact `nibble * 17` (nibble 0-15), so the
    nibble recovers losslessly as `component // 17`. Half-bright must shift
    that nibble — `component // 2` on the already-scaled value is wrong for
    every odd nibble (up to 8 off per channel; see ehb_palette's docstring).
    """
    with open(path) as fh:
        base = {int(k): tuple(v) for k, v in json.load(fh).items()}
    flat = [0] * (64 * 3)
    for i, rgb in base.items():
        if i < 32:
            flat[i * 3:i * 3 + 3] = list(rgb)
            flat[(i + 32) * 3:(i + 32) * 3 + 3] = [((c // 17) >> 1) * 17 for c in rgb]
    return flat

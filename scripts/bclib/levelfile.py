"""Black Crypt Amiga per-level file (`bcdfb`-`bcdfn`) tail layout.

The level loader inside decompressed `bcdft` S_1 (`+0x21E7E`-`+0x21FCC`)
reads each level file strictly in sequence:

| Read | Size | Destination / meaning |
|---|---|---|
| `+0x21ECC` | `0x57A` (1,402 B) | header + 42 x 28-B monster frame directory |
| `+0x21EE0` | header long `+0` | RLE monster-sprite stream |
| `+0x21F0C` | `0x78C` (1,932 B) | 3 wall decorations x 644 B |
| `+0x21F34` | `0x10E0` (4,320 B) | **only if** `gate[level] != 0`: special-panel body, 80x72x6 planes, into `$C8(A5)+6060` |
| `+0x21F4A` | `0x70` (112 B) | same gate: 4 x 28-B blit descriptors for the panel's inset sprites (into S_1 `+0x253C6`) |
| `+0x21F5E` | `gate[level]` | same gate: inset sprite pixels (7-plane masked), into `$24(A5)` |
| `+0x21F92` | `sfx[level]` | monster sound bank, raw signed 8-bit PCM, into `$28(A5)+0x70AE` |

`gate` = 13 BE words at S_1 `+0x21FE8` (non-zero for levels 2,3,4,6,9,11),
`sfx` = 13 BE words at S_1 `+0x22002`. This accounts for every byte of all
13 files (tail length == panel block + sfx[level], 13/13).
"""
import struct

HEADER_BYTES = 0x57A
DECOR_BYTES = 0x78C
PANEL_BODY_BYTES = 0x10E0
PANEL_BODY_W, PANEL_BODY_H = 80, 72
PANEL_DESC_BYTES = 0x70
S1_PANEL_GATE = 0x21FE8
S1_SFX_BYTES = 0x22002
LEVELS = 13


def gate_table(s1):
    return [struct.unpack_from('>H', s1, S1_PANEL_GATE + 2 * i)[0] for i in range(LEVELS)]


def sfx_table(s1):
    return [struct.unpack_from('>H', s1, S1_SFX_BYTES + 2 * i)[0] for i in range(LEVELS)]


def tail_layout(raw, s1, level):
    """File offsets for level `level` (1-13): dict with 'decor', 'panel'
    (or None), 'panel_desc', 'inset_pixels', 'inset_bytes', 'sfx', 'sfx_bytes'.
    Raises if the file's length disagrees with the loader's tables."""
    gate = gate_table(s1)[level - 1]
    sfx = sfx_table(s1)[level - 1]
    clen = struct.unpack_from('>I', raw, 0)[0]
    decor = HEADER_BYTES + clen
    p = decor + DECOR_BYTES
    out = {'decor': decor, 'panel': None, 'panel_desc': None,
           'inset_pixels': None, 'inset_bytes': gate}
    if gate:
        out['panel'] = p
        out['panel_desc'] = p + PANEL_BODY_BYTES
        out['inset_pixels'] = p + PANEL_BODY_BYTES + PANEL_DESC_BYTES
        p = out['inset_pixels'] + gate
    out['sfx'], out['sfx_bytes'] = p, sfx
    if p + sfx != len(raw):
        raise ValueError(f'level {level}: loader tables end at {p + sfx}, file is {len(raw)} B')
    return out

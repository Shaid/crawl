"""`bcdfs` — the dungeon map file, walked exactly the way the game walks it.

`bcdfs` holds all 13 dungeon maps back to back. Its stream is *not* a flat
record array: squares and the entity records that hang off them are
interleaved, and entity records are variable in number, so the only reliable
way to read it is to reimplement the game's own loader.

This module is that reimplementation, transcribed instruction for instruction
from decompressed `bcdft` S_1:

    +0x188D0 .. +0x18CFE   the map loader (row/column loop, entity expansion)
    +0x18570 (`$985C8`)    container / monster-inventory sub-chain
    +0x18764 (`$987BC`)    action-chain reader

Verification: `walk_all()` consumes **13/13 maps with zero deviation** —
every square passes the `[type:4][0xF] [0xF][level:4]` nibble check, and each
of maps 1-12 ends exactly 3,948 bytes before the next map's offset-table
entry. (Map 13 ends 4,000 bytes before EOF: 3,948 + the 52-byte offset-table
block the last map does not need to leave room for.)

Record sizes, all read straight off the loader:

* every item / structure record is **20 bytes** (`pea $14.w` before the read
  helper, and `unique * 20` at every consumer);
* a **monster** is two such records back to back (40 bytes) — the loader
  allocates a second slot and stores its index in the first record's word
  `+0x10`. Byte `+0x00` bit 7 (`0x80`) is the monster marker;
* if the monster's *second* record has a nonzero byte `+0x13`, four more
  bytes follow;
* record word `+0x12` chains to a further record on the same square;
* containers (type `0x13`), chests (`0x23`) and monsters recurse into a
  sub-chain whose head is word `+0x0C` (container) / `+0x0A` (monster);
* structure types `0x0F 0x16 0x1D 0x1E 0x1F 0x21` are followed by an action
  chain: **8 bytes per action**, the first action's id is record byte `+0x0D`,
  and each action's byte `+0x07` is the next action's id — the chain ends on
  `0x00` (one-shot) or on the first action's own id (loop).

Row headers are **signed** bytes (`cmp.b` + `ble` at +0x18C76/+0x18C80):
`40 FF` — first column 64, last column −1 — is how an *empty row* is encoded,
and treating those unsigned is what desynchronises a naive walker on maps
11-13.
"""
import struct

#: Number of maps in the file.
MAP_COUNT = 13

#: Every map starts with a 52-byte block; only map 1 fills it in with the
#: 13 big-endian longword map offsets.
OFFSET_TABLE_BYTES = 52

#: Fixed on-disk (and runtime) size of one item/structure record.
RECORD_BYTES = 20

#: Structure types whose record is followed by an action chain
#: (S_1 +0x18BB0/+0x18BC8/+0x18BE0/+0x18BF8/+0x18C10/+0x18C28).
ACTION_TYPES = (0x0F, 0x16, 0x1D, 0x1E, 0x1F, 0x21)

#: Types that own a sub-chain of contained records (S_1 +0x18B5C/+0x18B74).
CONTAINER_TYPES = (0x13, 0x23)

# ---------------------------------------------------------------------------
# Item names
# ---------------------------------------------------------------------------

#: Start of the map-item name block in decompressed `bcdft` S_1. Held at
#: runtime in the pointer variable `A4 − 0x7174` (`bcdft` S_2 +0x0E8A, whose
#: relocated value is the absolute `0x0009C53A`).
ITEM_NAME_BASE = 0x1C4E2

#: 19-entry `char *` table at `A4 − 0x7844` (`bcdft` S_2 +0x07BA), used when
#: bit 15 of the record's name word is set. Entry 0 is `DEATH GEM`.
ITEM_NAME_PTR_TABLE = 0x07BA
ITEM_NAME_PTR_COUNT = 19

#: Absolute address of `bcdft` S_1 byte 0 after relocation.
S1_BASE = 0x80058


def item_name(s1, s2, name_word):
    """Resolve an item record's word `+0x02` to its display string.

    Transcribed from the two consumers that do it, S_1 +0x42A0 (examine item)
    and S_1 +0xEFDE (compose message):

        if name & 0x8000:  str = ((char **)(A4-0x7844))[name & 0x7FFF]
        else:              str = (char *)(A4-0x7174) + name

    Returns `None` for `name_word == 0` (structures that carry no name).
    """
    if name_word == 0:
        return None
    if name_word & 0x8000:
        idx = name_word & 0x7FFF
        if idx >= ITEM_NAME_PTR_COUNT:
            raise ValueError(f'name pointer index {idx} out of range')
        off = struct.unpack_from('>I', s2, ITEM_NAME_PTR_TABLE + idx * 4)[0] - S1_BASE
    else:
        off = ITEM_NAME_BASE + name_word
    end = s1.index(b'\x00', off)
    return s1[off:end].decode('latin1')


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------

def read_map_offsets(raw):
    """The 13 big-endian longword map offsets from the head of the file."""
    return [struct.unpack_from('>I', raw, i * 4)[0] for i in range(MAP_COUNT)]


class _Cursor:
    __slots__ = ('raw', 'pos')

    def __init__(self, raw, pos):
        self.raw = raw
        self.pos = pos

    def take(self, n):
        b = self.raw[self.pos:self.pos + n]
        if len(b) != n:
            raise ValueError(f'bcdfs: ran off the end at {self.pos:#x}')
        self.pos += n
        return b


def _signed(b):
    return b - 256 if b > 127 else b


def _word(rec, off):
    return struct.unpack_from('>H', rec, off)[0]


def walk_map(raw, offsets, index, on_record=None, on_square=None,
             on_monster2=None, on_monster2ext=None):
    """Walk one map, returning the stream position just past its last row.

    `on_record(map_index, row, col, file_offset, record_bytes)` is called for
    every 20-byte item/structure record (for a monster, only its *first*
    record — the second is its stat continuation).
    `on_square(map_index, row, col, file_offset, square_bytes)` is called for
    every square.
    `on_monster2(map_index, row, col, file_offset, record_bytes)` is called
    for a monster's *second* (stat-continuation) 20-byte record — the one
    `on_record` never sees. `on_monster2ext(map_index, row, col, file_offset,
    ext_bytes)` is called for the optional trailing 4 bytes read when that
    second record's byte `+0x13` is non-zero (never observed in the shipped
    maps, but the loader supports it — see `+0x18B16`-`+0x18B42`).
    """
    start = offsets[index]
    cur = _Cursor(raw, start + OFFSET_TABLE_BYTES)
    cur.take(4)                       # map id / size guard, compared to $1750(a4)
    last_row = _signed(cur.take(1)[0])

    state = {'row': 0, 'col': 0}

    def actions(rec):
        nxt = rec[0x0D]
        first = nxt
        looped = False
        while nxt != 0 and not looped:
            act = cur.take(8)
            nxt = act[7]
            if nxt == first:
                looped = True

    def sub_chain(parent, is_monster):
        # `$985C8`: the head index only gates whether the first sub-record
        # exists; from then on the loader allocates fresh slots and the loop
        # is driven purely by each record's own chain word.
        if _word(parent, 0x0A if is_monster else 0x0C) == 0:
            return
        while True:
            off = cur.pos
            rec = cur.take(RECORD_BYTES)
            if on_record:
                on_record(index, state['row'], state['col'], off, rec)
            mon = bool(rec[0] & 0x80)
            if mon:
                off2 = cur.pos
                second = cur.take(RECORD_BYTES)
                if on_monster2:
                    on_monster2(index, state['row'], state['col'], off2, second)
                # NB: unlike entity_chain below, the original (verified) walk
                # never checked this second record's byte +0x13 for a sub-chain
                # monster — preserved as-is rather than "fixed" here.
            if rec[5] in CONTAINER_TYPES or mon:
                sub_chain(rec, mon)
            if _word(rec, 0x12) == 0:
                break

    def entity_chain():
        while True:
            off = cur.pos
            rec = cur.take(RECORD_BYTES)
            if on_record:
                on_record(index, state['row'], state['col'], off, rec)
            mon = bool(rec[0] & 0x80)
            if mon:
                off2 = cur.pos
                second = cur.take(RECORD_BYTES)
                if on_monster2:
                    on_monster2(index, state['row'], state['col'], off2, second)
                if second[0x13] != 0:
                    off2ext = cur.pos
                    ext = cur.take(4)
                    if on_monster2ext:
                        on_monster2ext(index, state['row'], state['col'], off2ext, ext)
            if rec[5] in CONTAINER_TYPES or mon:
                sub_chain(rec, mon)
            elif rec[5] in ACTION_TYPES:
                actions(rec)
            if _word(rec, 0x12) == 0:
                break

    for row in range(0, last_row + 1):
        first_col = _signed(cur.take(1)[0])
        last_col = _signed(cur.take(1)[0])
        for col in range(first_col, last_col + 1):
            sq_off = cur.pos
            sq = cur.take(4)
            if (sq[0] & 0x0F) != 0x0F or (sq[1] & 0xF0) != 0xF0:
                raise ValueError(
                    f'bcdfs map {index + 1}: byte {cur.pos - 4:#x} is not a square '
                    f'(row {row}, col {col}, bytes {sq.hex()})')
            state['row'], state['col'] = row, col
            if on_square:
                on_square(index, row, col, sq_off, sq)
            if ((sq[2] & 0x0F) << 8) | sq[3]:
                entity_chain()

    trailer = struct.unpack('>H', cur.take(2))[0]
    for _ in range(trailer):
        cur.take(12)
    return cur.pos


#: Bytes of zero padding ("workspace for items the player drops") that follow
#: every map's row data. Holds for maps 1-12 with zero deviation.
MAP_TAIL_PADDING = 3948


def walk_all(raw, on_record=None, on_square=None, on_monster2=None,
             on_monster2ext=None, verify=True):
    """Walk all 13 maps. Returns the list of end positions.

    With `verify` (the default) the tail-padding invariant is asserted for
    maps 1-12 — that check is what makes this parse trustworthy, so keep it on
    unless you are deliberately probing a modified file.
    """
    offsets = read_map_offsets(raw)
    ends = []
    for m in range(MAP_COUNT):
        end = walk_map(raw, offsets, m, on_record=on_record, on_square=on_square,
                        on_monster2=on_monster2, on_monster2ext=on_monster2ext)
        ends.append(end)
        if verify and m + 1 < MAP_COUNT:
            gap = offsets[m + 1] - end
            if gap != MAP_TAIL_PADDING:
                raise ValueError(
                    f'bcdfs map {m + 1}: tail padding is {gap} B, expected '
                    f'{MAP_TAIL_PADDING}')
    return ends


def read_records(raw):
    """Every item/structure record in the file.

    Returns a list of `(map_index, row, col, file_offset, bytes)`.
    """
    out = []
    walk_all(raw, on_record=lambda m, r, c, o, b: out.append((m, r, c, o, bytes(b))))
    return out

"""`bcdfs` (Amiga) -> `maindung.gam` (Windows/DOS demo) converter.

The two formats are **structurally identical** — same 52-byte per-map header
block, same signed row headers, same sparse square stream, same 20-byte
item/structure/monster records, same 8-byte action records, same 3,948-byte
per-map tail padding. The only difference is x86 little-endian vs 68k
big-endian storage, and — critically — that swap is **not** a blanket
byte-reversal of every field. This module reimplements the DOS encoding by
walking the verified Amiga reader (`bclib.bcdfs`) and rewriting each span in
place; it does not reimplement `bcdfs`'s traversal, only its output encoding.

## The swap rule (derived and verified this session)

A prior investigation session found "the swap boundaries depend on the
record's `itemType` byte" from map 1's 225 mismatches. That framing turns
out to be a **coincidence of map 1's small sample, not the real rule**: an
exhaustive per-type composition search (every way to partition the
itemType-specific 13-byte span into 1-byte/2-byte runs, checked against
every map-1 example of that type) found composition `(1,2,2,2,2,2,2)` —
one unswapped byte at `+0x07`, then six swapped 16-bit words at
`+0x08/0x0A/0x0C/0x0E/0x10/0x12` — is consistent with **all 39** itemType
values observed in map 1, and
is the *unique* fit for the 5 types with enough instances to fully
disambiguate it (`0x04`, `0x05`, `0x12`, `0x13`, `0x23`). It is *itemType-
independent*: the same positional transform applies to every item and
structure record regardless of what the bytes mean, which is exactly what
you'd expect from a mechanical porting tool that doesn't need to understand
record semantics to re-encode them. Spot-confirmed against `crypt.exe`
disassembly for one of the 9 map-1-absent kinds (Panel Item `0x2B`,
`fcn.0041c220` @ `0x41c452`/`0x41c458`: `cmp bl, 0x2b` then
`cmp word [eax+0x46bd74], cx` — a *word* compare at live-array offset
`+0x0C`, matching the universal rule) — see
`docs/blackcrypt/dos/data-structure.md` for the full trace and the other 8
kinds' evidence.

The only thing that actually varies by record *kind* (not itemType) is
whether the record is a **monster**:

* Common 7-byte prefix (`+0x00`..`+0x06`): word `+0x00` (gfxNumber /
  monster marker) always swaps. Word `+0x02` swaps **only for non-monster
  records** — for a monster's first record, `+0x02`/`+0x03` are two
  independent single bytes (hit-chance, door/attack-speed nibbles), not a
  name reference, and swapping them would corrupt both. Bytes `+0x04`
  (position/class or `0xF0` marker), `+0x05` (itemType or move-speed
  nibbles) and `+0x06` (posInContainer or attack-method) never swap on
  either kind of record.
* Item/structure records and monster *first* records share the exact same
  `+0x07..0x13` composition above (confirmed by a global test: applying it
  to all 211 map-1 records leaves exactly 14 mismatches, and all 14 are
  monster records whose *only* wrong bytes are `+0x02/+0x03` — see
  `docs/blackcrypt/dos/data-structure.md` § "maindung.py converter" for the
  full derivation).
* A monster's **second** (stat-continuation) record is a completely
  different layout with no name/gfx prefix at all: bytes `+0x00..+0x03`
  are unswapped (always zero in the shipped data, so this is unverifiable
  either way), then three swapped words at `+0x04/+0x06/+0x08`, then ten
  unswapped bytes `+0x0A..+0x13`. Derived the same way (an exhaustive
  composition search over all 20 bytes) and hand-verified against all 14 of
  map 1's monster pairs
  — e.g. `00 00 00 00 00 01 00 28 00 19 00 04 00 04 ff 00 00 00 00 00`
  (Amiga) -> `00 00 00 00 01 00 28 00 19 00 00 04 00 04 ff 00 00 00 00 00`
  (DOS): `+0x04/+0x05` (`00 01` -> `01 00`, the `0x0001` constant),
  `+0x06/+0x07` (XP gain, `00 28` -> `28 00`), `+0x08/+0x09` (attack
  strength, `00 19` -> `19 00`), all three byte-swapped words; `+0x0A..`
  unchanged.
* The optional 4-byte monster extension (read when the second record's
  `+0x13` is non-zero) never fires in any of the 13 shipped maps (checked:
  0 of 265 monster pairs) — its encoding is genuinely unknown. `convert()`
  raises rather than guessing if it's ever encountered.

## The `bcdft` name-reference word needs no remap

Item record `+0x02` (non-monster records) is a tagged reference — bit 15
clear: byte offset into a name-string block; bit 15 set: index into a
19-entry pointer table (see `bcdfs.item_name`). The concern going in was
that DOS's own string storage might not share Amiga `bcdft`'s layout, which
would mean the raw offset needs remapping through some table. It doesn't:
`crypt.exe` (file offset `0x37A28`) embeds **the exact same string block**
byte-for-byte — `data[0x37A28:0x37A28+15] == b'WAR HAMMER\\x00MEAT\\x00'`,
matching decompressed `bcdft` S_1 `+0x1C4E2` verbatim, offset-for-offset
(`"GAUNTLETS"` sits at `+34` in both). So the reference word needs *only*
the ordinary word byte-swap already applied to the whole `+0x00/+0x02`
prefix — no separate remap step, and nothing project-wide needs re-mapping.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bclib import bcdfs

MAP_COUNT = bcdfs.MAP_COUNT
OFFSET_TABLE_BYTES = bcdfs.OFFSET_TABLE_BYTES
RECORD_BYTES = bcdfs.RECORD_BYTES


def _reverse4(b):
    """Full 4-byte reversal — squares and offset-table longwords."""
    return bytes((b[3], b[2], b[1], b[0]))


def transform_record(rec, is_monster):
    """Amiga -> DOS encoding of one 20-byte item/structure/monster-first
    record. See the module docstring for the derivation."""
    out = bytearray(20)
    out[0], out[1] = rec[1], rec[0]                    # gfxNumber / marker word
    if is_monster:
        out[2], out[3] = rec[2], rec[3]                # hit-chance / door+atkspeed: 2 bytes
    else:
        out[2], out[3] = rec[3], rec[2]                # name-reference word
    out[4], out[5], out[6] = rec[4], rec[5], rec[6]     # never swap
    out[7] = rec[7]                                     # single unswapped byte
    for i in (8, 10, 12, 14, 16, 18):                    # 6 swapped words
        out[i], out[i + 1] = rec[i + 1], rec[i]
    return bytes(out)


def transform_monster2(rec):
    """Amiga -> DOS encoding of a monster's second (stat) record."""
    out = bytearray(20)
    out[0:4] = rec[0:4]                                  # unswapped (always 0 in practice)
    for i in (4, 6, 8):                                  # 3 swapped words
        out[i], out[i + 1] = rec[i + 1], rec[i]
    out[10:20] = rec[10:20]                               # unswapped bytes
    return bytes(out)


def convert(raw):
    """Convert a whole Amiga `bcdfs` byte string to the DOS `maindung.gam`
    encoding. Output is the same length as the input (171,005 B for the
    real file) — every field occupies the same file offset on both
    platforms, only some fields' byte order changes.
    """
    out = bytearray(raw)  # default: raw copy (row headers, action records,
                           # header guard+lastrow, trailer, and the 12
                           # always-zero per-map reserved header blocks all
                           # need no transform at all)

    # The file-global offset table (map 1's leading 52 bytes) is 13
    # big-endian longwords on Amiga, little-endian on DOS.
    for i in range(MAP_COUNT):
        off = i * 4
        out[off:off + 4] = _reverse4(raw[off:off + 4])

    def on_square(m, row, col, off, sq):
        out[off:off + 4] = _reverse4(sq)

    def on_record(m, row, col, off, rec):
        is_monster = bool(rec[0] & 0x80)
        out[off:off + RECORD_BYTES] = transform_record(rec, is_monster)

    def on_monster2(m, row, col, off, rec):
        out[off:off + RECORD_BYTES] = transform_monster2(rec)

    def on_monster2ext(m, row, col, off, ext):
        raise ValueError(
            f'maindung: monster extension bytes encountered at map {m + 1} '
            f'({row}, {col}) file+{off:#x} — this never occurs in the '
            f'shipped bcdfs and its DOS encoding is undetermined; refusing '
            f'to guess')

    bcdfs.walk_all(raw, on_record=on_record, on_square=on_square,
                    on_monster2=on_monster2, on_monster2ext=on_monster2ext)
    return bytes(out)


#: The shipped demo's own file length — map 1's data plus one 52-byte
#: leftover (zeroed) offset-table block. See the module docstring / doc
#: correction: `crypt.exe` reads up to this point and stops.
DEMO_FILE_BYTES = 15099


def to_demo(full_bytes):
    """Trim a full 13-map `convert()` output down to what the shipped demo's
    `maindung.gam` actually contains: map 1's real data, offset-table slot 1
    (map 2) left as the genuine dangling offset, and slots 2-12 (maps 3-13)
    zeroed out — reproducing the demo's own truncation, not a bug in the
    converter. Used by the round-trip test; the full 171,005 B output from
    `convert()` is the real deliverable for maps 3-13.
    """
    out = bytearray(full_bytes[:DEMO_FILE_BYTES])
    for i in range(2, MAP_COUNT):
        out[i * 4:i * 4 + 4] = b'\x00\x00\x00\x00'
    return bytes(out)


def convert_file(src_path, dst_path):
    raw = Path(src_path).read_bytes()
    out = convert(raw)
    Path(dst_path).write_bytes(out)
    return out


if __name__ == '__main__':
    ROOT = Path(__file__).resolve().parents[2]
    src = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'
    dst_dir = ROOT / 'build' / 'cache' / 'blackcrypt' / 'maindung'
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / 'maindung-full.gam'
    out = convert_file(src, dst)
    print(f'{len(out)} B -> {dst.relative_to(ROOT)}')

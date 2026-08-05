"""Amiga `CHARACTERSA` -> DOS `char%d.dat` save-file converter.

Builds on `docs/blackcrypt/dos/full-game-restoration-plan.md` § "Phase 6 —
save-file format", which traced both platforms' save serializers
(`crypt.exe fcn.00401b80` on DOS, S_1 `+0x1957A`-`+0x19A88` on Amiga) and
cross-checked a real 80-file Amiga save corpus (`data/blackcrypt/saves.7z`,
never committed) against the one real DOS save in this repo
(`data/blackcrypt/dosvga/char1.dat`). This module turns that analysis into
an actual converter. Read the plan doc's Phase 6 section (including its
"Update — real Amiga save corpus obtained" subsection) before changing
anything here — every offset below cites the evidence that pinned it.

## What this converter does, field by field, and how confident each part is

1. **210-byte header (file offset 0-209) — copied verbatim from the DOS
   reference file, not transformed from the Amiga source. Confirmed by
   x86 disassembly, highest confidence.** `fcn.00401b80` writes this
   region as two hard-coded, save-state-independent DOS writes: a literal
   60-iteration zero-fill loop (`0x401b98`-`0x401bb7`, 120 B) and a `rep
   movsd` copy from a constant table baked into `crypt.exe` itself at VA
   `0x4303e8` (90 B) — neither reads any per-character or per-save global.
   That means *every* real DOS save has this exact same 210 bytes,
   regardless of game state, which is why the safest and most accurate
   thing to do is reuse the reference file's own header rather than invent
   a transform for the Amiga side's corresponding bytes.

   **New finding this session, correcting the plan doc:** the doc's
   "Update" § 1 claims "every one of the 80 real [Amiga] saves starts with
   exactly the same 120 zero bytes... zero exceptions." Re-checking that
   claim against the *full* 80-file corpus (the original check evidently
   only covered a handful of small/fresh saves) shows it is **not**
   actually true — 50 of the 80 real Amiga files, all from deeper/later
   points in the same playthrough, have non-zero, non-monotonically-varying
   data in that byte range (e.g. `2/BlackCrypt/CHARACTERSA`, the file this
   module converts, has 35 non-zero bytes there). The fixed *position* of
   the header is still solid (the first character's class-name string sits
   at file offset 212 in literally every save checked, small or large), so
   this doesn't change the boundary — but it does mean the Amiga engine
   uses that space for something (never decoded this session), unlike DOS,
   which per the disassembly above genuinely never varies it. Since DOS's
   own behaviour is proven state-independent, copying the reference
   header verbatim is unaffected by this correction — it just means "raw-copy
   the Amiga source's corresponding bytes instead" would have been *wrong*,
   not merely unverified.

2. **4 character records (270 B each, DOS layout) — mixed confidence, see
   `CORE_LAYOUT` below.** Each DOS record is a 2-byte party-slot index
   (`0..3`, confirmed identical in *value and position* on both platforms —
   real Amiga saves have the same `0,1,2,3` sequence immediately before
   each character's name string, at the same relative offset DOS uses) plus
   a 168-byte "core" struct plus a 100-byte tail.

   - **Core struct (168 B):** transformed field-by-field per `CORE_LAYOUT`,
     using exactly the SAME/SWAP evidence
     `dos/full-game-restoration-plan.md` § "3. The 168-byte character
     struct" established from real DOS-vs-Amiga byte comparison (class
     name, the `01 FF FF FF FF FF` marker, the `+0x4C/+0x4E`/`+0x50/+0x52`/
     `+0x54` word-pair stats, the 16-byte class-constant array). The
     remaining ~90 bytes of the struct were never decoded field-by-field by
     Phase 6 ("further stat/equipment fields not decoded"); this module
     copies them byte-for-byte unchanged (no swap) as the least-risky
     default, on the grounds that every *confirmed* region so far is either
     an unswapped byte array or a small, specifically-identified word pair
     — never a "blanket word-swap everything" rule. **This is a best-effort,
     unverified choice for those ~90 bytes** — they may hold real stats
     (HP, AC, XP, etc.) at values that come out numerically wrong (though
     not crash-inducing the way a corrupted pointer/offset table would be).
   - **Item-slot table (`+0x18`, 4x10 B within the core):** deliberately
     **zeroed**, not transformed. This is the safety call the task brief
     asked for — see § "The per-character tail" below.
   - **100-byte tail (`+0xAA`..`+0x10D` of the DOS record):** deliberately
     **zeroed**, not populated. See below.

3. **52-byte party-scalar block — safe defaults from the reference DOS
   save, with one field overridden.** Phase 6 never established a
   per-field byte-offset mapping between the Amiga's ~20 named scalars and
   DOS's; guessing at 19 of them risked writing plausible-looking garbage
   into fields that drive gameplay (position, facing, turn counter,
   selected-character index). This module instead copies the fresh DOS
   demo save's own 52-byte scalar block verbatim (i.e. every one of those
   fields resets to safe, known-working "start of the game" values) and
   overrides just the one field this session pinned to an exact byte
   offset by fresh x86 disassembly: **current map**, at party-scalar-block
   relative offset **+18** (`crypt.exe fcn.00401b80` `0x401dd9`, `mov cx,
   word [0x47481a]`, the 9th of 17 sequential 2-byte writes starting at
   `0x401d21` — each write's destination offset was traced instruction by
   instruction; independently confirmed against `char1.dat` itself, which
   reads `1` at that exact byte position, matching its known fresh-map-1
   state). The Amiga source's real current-map byte (confirmed elsewhere
   in Phase 6, `table_start - 33`) is written there zero-extended to a
   word.

4. **52-byte map-offset table — confirmed, highest confidence.** Direct
   per-field byte-swap (13 big-endian Amiga dwords -> 13 little-endian DOS
   dwords), exactly Phase 6's "Update" § 5 finding (byte-exact, 80/80 real
   files, zero deviation).

5. **2-byte terminator — DOS-native constant, confirmed by disassembly.**
   `fcn.00401b80`'s last write (`0x401f1f`, `mov word[cursor], 0`) is a
   literal zero, unconditionally — DOS's own save format has no traced
   field for the Amiga side's pending-scheduled-event count/list (Phase 6
   "Update" § 7). This module therefore always writes `0x0000` here and
   **drops** the source Amiga save's pending events (2 of them, for the
   real target file) rather than guessing at an unproven DOS encoding for
   them.

## The per-character tail — the task's central safety question

Per the task brief: raw Amiga tail bytes are not byte-order-compatible
with DOS's own tail encoding (a *different* mechanism entirely — DOS's
100-byte tail is regenerated at save time from a static, id-keyed
20-byte-per-item lookup table baked into `crypt.exe` at VA `0x430240`,
not a raw copy of anything; Amiga's tail is real inventory/spellbook data
in a format Phase 6 never walked out). Writing raw or guessed tail bytes
risks exactly the class of crash the project owner's live cross-check
already produced (a garbage pointer/index reaching `LoadDungeon`).

This module's choice: **zero the item-slot table inside the core (`+0x18`)
and the entire 100-byte tail.** A DOS record built this way has no item
ids for the save-time tail-generation logic to look up in the first
place, so there is nothing inconsistent between "the ids say there's
inventory" and "the tail has no data" — the record is internally
consistent, just empty. Concretely: converted characters load with reset
inventory and (if the same mechanism drives it, per Phase 6's "known-spells
list" hypothesis) empty spellbooks, not wrong or dangling item
references.

**Record byte length is a related, deliberate choice.** Phase 6 flagged
"270 B" as possibly variable-length coincidence, not a confirmed fixed
stride (only one real 4-record DOS sample existed). This module always
emits fixed 270-byte records regardless of how many item-slot ids would
otherwise be nonzero, because the only real *working* DOS save in this
project (`char1.dat`) has its map-offset table landing at exactly the
disassembly-predicted fixed file offset `0x53E` — strong evidence the
loader expects records at fixed, not content-dependent, positions. Since
we're also zeroing every item slot, fixed-vs-variable is moot for the
converted file's *content* (zero slots -> zero tail bytes either way) but
matters for its *size/position* — fixed-size keeps every downstream
offset (party scalars, map-offset table, terminator) at the exact
positions the working reference file uses, byte for byte.

## Confidence summary

| Region | Confidence |
|---|---|
| 210 B header | Confirmed (disassembly: state-independent on DOS) |
| Party-slot index (record `+0x00`) | Confirmed (matches on both platforms, real data) |
| Core struct: name, `01 FF..` marker, 3 word-pair stats, class-constant array | Confirmed (Phase 6 real byte comparison) |
| Core struct: remaining ~90 B | Best-effort / unverified (raw copy, no swap) |
| Item-slot table + 100 B tail | Deliberately zeroed (safety choice, not a decode) |
| Party-scalar block (51 of 52 B) | Safe defaults from a real working DOS save, not derived from the Amiga source |
| Current map (party-scalar `+18`) | Confirmed (fresh disassembly this session + `char1.dat` cross-check) |
| Map-offset table | Confirmed (Phase 6, byte-exact 80/80) |
| Terminator | Confirmed (disassembly); source pending-event list is dropped |
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parents[2]
DOS_CHAR1_PATH = ROOT / 'data' / 'blackcrypt' / 'dosvga' / 'char1.dat'

#: The four class names, in the fixed party order this format always uses
#: (confirmed: every real Amiga save in the 80-file corpus and the DOS
#: demo's own char1.dat both use exactly this order).
CLASS_NAMES = [b'FIGHTER\x00', b'CLERIC\x00', b'MAGIC USER\x00', b'DRUID\x00']

HEADER_BYTES = 210
CORE_BYTES = 168                      # 0xA8, the per-character struct
RECORD_HEADER_BYTES = 2               # leading party-slot-index scalar
DOS_RECORD_BYTES = 270
DOS_TAIL_BYTES = DOS_RECORD_BYTES - RECORD_HEADER_BYTES - CORE_BYTES  # 100
MAP_COUNT = 13
OFFSET_TABLE_BYTES = MAP_COUNT * 4    # 52
PARTY_SCALAR_BYTES = 52

#: Byte offset of the "current map" word within the 52-byte party-scalar
#: block. Traced this session in `crypt.exe fcn.00401b80`: 17 sequential
#: 2-byte `mov word[cursor], cx` writes starting at 0x401d21, the 9th of
#: which (0x401dd9) reads `word [0x47481a]` — the project's already-
#: confirmed "current map" global. Cross-checked: char1.dat reads `1`
#: (fresh map 1) at exactly this byte position.
CURRENT_MAP_REL_OFFSET = 18

# Item-slot table inside the 168-byte core: 4 slots x 10 B (2 B id + 8 B
# reserved), confirmed position on both platforms (Phase 6 § 3).
ITEM_SLOT_BASE = 0x18
ITEM_SLOT_STRIDE = 0x0A
ITEM_SLOT_COUNT = 4

#: How to build the DOS core struct from the Amiga core struct, byte range
#: by byte range. 'raw' = copy unchanged; 'word' = swap each 2-byte unit;
#: 'zero' = always zero (the item-slot table, this converter's safety
#: choice for inventory/spell data). See the module docstring's numbered
#: list (item 2) and confidence table for the evidence behind each span.
CORE_LAYOUT = [
    (0x00, 0x18, 'raw'),    # class name (24 B) + a few bytes into the gap
    (0x18, 0x40, 'zero'),   # 4x10 B item-slot table -- zeroed (safety)
    (0x40, 0x46, 'raw'),    # unmapped gap -- best-effort
    (0x46, 0x4C, 'raw'),    # confirmed unswapped 6-byte marker (01 FF x5)
    (0x4C, 0x56, 'word'),   # 5 confirmed swapped words (3 stat fields:
                            # +0x4C/+0x4E and +0x50/+0x52 are 2-word
                            # current/max pairs, +0x54 is a single word)
    (0x56, 0x5E, 'raw'),    # unmapped gap -- best-effort
    (0x5E, 0x6E, 'raw'),    # confirmed unswapped 16-byte class-const array
    (0x6E, 0xA8, 'raw'),    # unmapped remainder of the core -- best-effort
]


def _find_class_offsets(raw):
    offsets = {}
    for cls in CLASS_NAMES:
        idx = raw.find(cls)
        if idx < 0:
            raise ValueError(f'charsave: class name {cls!r} not found -- '
                              f'not a recognizable 4-character CHARACTERSA '
                              f'save')
        offsets[cls] = idx
    ordered = sorted(offsets.items(), key=lambda kv: kv[1])
    if [c for c, _ in ordered] != CLASS_NAMES:
        raise ValueError(
            'charsave: character classes are not in the expected '
            'Fighter/Cleric/Magic User/Druid order -- this converter only '
            'handles the standard fixed party')
    return [off for _, off in ordered]


def parse_amiga_save(raw):
    """Parse a real Amiga `CHARACTERSA` save into its known fields. Raises
    `ValueError` if the file doesn't look like a 4-character save in the
    standard party order. See the module docstring for what's confirmed
    vs. best-effort in each returned field.
    """
    name_offsets = _find_class_offsets(raw)
    record_starts = [off - RECORD_HEADER_BYTES for off in name_offsets]

    records = []
    for slot, rstart in enumerate(record_starts):
        if rstart < 0 or rstart + RECORD_HEADER_BYTES + CORE_BYTES > len(raw):
            raise ValueError(f'charsave: record {slot} at file+{rstart:#x} '
                              f'runs past end of file')
        scalar = struct.unpack('>H', raw[rstart:rstart + 2])[0]
        core = raw[rstart + 2:rstart + 2 + CORE_BYTES]
        name = core[0:24].split(b'\x00')[0].decode('latin1')
        item_ids = [
            struct.unpack(
                '>H',
                core[ITEM_SLOT_BASE + j * ITEM_SLOT_STRIDE:
                     ITEM_SLOT_BASE + j * ITEM_SLOT_STRIDE + 2])[0]
            for j in range(ITEM_SLOT_COUNT)
        ]
        records.append({
            'slot': slot,
            'scalar': scalar,
            'name': name,
            'core': core,
            'item_ids': item_ids,
        })

    anchor = bytes([0, 0, 0, 0, 0, 0, 0x3A, 0xC7])
    table_start = raw.find(anchor)
    if table_start < 0:
        raise ValueError('charsave: map-offset table anchor not found -- '
                          'not a recognizable CHARACTERSA save')
    map_offset_table = struct.unpack(
        '>13I', raw[table_start:table_start + OFFSET_TABLE_BYTES])
    current_map = raw[table_start - 33]

    after = table_start + OFFSET_TABLE_BYTES
    pending_count = struct.unpack('>H', raw[after:after + 2])[0]
    pending_bytes = raw[after + 2:after + 2 + 12 * pending_count]
    expected_end = after + 2 + 12 * pending_count
    if expected_end != len(raw):
        raise ValueError(
            f'charsave: pending-event count ({pending_count}) does not '
            f'account for the file -- expected EOF at {expected_end:#x}, '
            f'file is {len(raw):#x} bytes; not a recognizable save')

    return {
        'file_size': len(raw),
        'record_starts': record_starts,
        'records': records,
        'table_start': table_start,
        'map_offset_table': map_offset_table,
        'current_map': current_map,
        'pending_event_count': pending_count,
        'pending_event_bytes': pending_bytes,
    }


def transform_core(core):
    """Amiga -> DOS transform of one 168-byte character-core struct. See
    `CORE_LAYOUT` and the module docstring for the evidence behind each
    span."""
    assert len(core) == CORE_BYTES
    out = bytearray(CORE_BYTES)
    for start, end, kind in CORE_LAYOUT:
        if kind == 'raw':
            out[start:end] = core[start:end]
        elif kind == 'zero':
            pass  # already zero-initialized
        elif kind == 'word':
            for i in range(start, end, 2):
                out[i], out[i + 1] = core[i + 1], core[i]
        else:
            raise ValueError(f'charsave: unknown CORE_LAYOUT kind {kind!r}')
    return bytes(out)


def build_dos_record(slot, amiga_record):
    """Build one fixed 270-byte DOS character record from a parsed Amiga
    record. The 100-byte tail (item/spell data) is always zeroed -- see
    the module docstring's "per-character tail" section."""
    out = bytearray(DOS_RECORD_BYTES)
    struct.pack_into('<H', out, 0, slot)
    out[2:2 + CORE_BYTES] = transform_core(amiga_record['core'])
    # out[2+CORE_BYTES : DOS_RECORD_BYTES] stays zero (the truncated tail)
    return bytes(out)


def build_dos_save(parsed, dos_template=None):
    """Assemble a full DOS `char%d.dat` from a parsed Amiga save. See the
    module docstring's confidence table for what's confirmed vs.
    best-effort in the output."""
    if dos_template is None:
        dos_template = DOS_CHAR1_PATH.read_bytes()
    min_len = HEADER_BYTES + 4 * DOS_RECORD_BYTES + PARTY_SCALAR_BYTES
    if len(dos_template) < min_len:
        raise ValueError(
            f'charsave: DOS reference file is only {len(dos_template)} B, '
            f'need at least {min_len} B to use as a template')
    if len(parsed['records']) != 4:
        raise ValueError('charsave: expected exactly 4 character records')

    out = bytearray()

    # 1. 210-byte header: DOS-native constant, copied from the reference
    #    file rather than transformed from the Amiga source (see docstring
    #    item 1).
    out += dos_template[:HEADER_BYTES]

    # 2. 4 character records.
    for rec in parsed['records']:
        out += build_dos_record(rec['slot'], rec)

    # 3. 52-byte party-scalar block: safe defaults from the reference save,
    #    current map overridden with the real extracted value.
    block_start = HEADER_BYTES + 4 * DOS_RECORD_BYTES
    block = bytearray(
        dos_template[block_start:block_start + PARTY_SCALAR_BYTES])
    struct.pack_into('<H', block, CURRENT_MAP_REL_OFFSET,
                      parsed['current_map'])
    out += block

    # 4. 52-byte map-offset table: confirmed per-field byte-swap.
    for v in parsed['map_offset_table']:
        out += struct.pack('<I', v)

    # 5. 2-byte terminator: DOS-native constant. The source save's pending
    #    scheduled-event list (if any) is dropped -- see docstring item 5.
    out += b'\x00\x00'

    expected_len = min_len + OFFSET_TABLE_BYTES + 2
    assert len(out) == expected_len, (len(out), expected_len)
    return bytes(out)


def convert(raw, dos_template=None):
    """Convert a whole Amiga `CHARACTERSA` byte string to a DOS `char%d.dat`
    byte string."""
    parsed = parse_amiga_save(raw)
    return build_dos_save(parsed, dos_template=dos_template)


def convert_file(src_path, dst_path, dos_template_path=None):
    raw = Path(src_path).read_bytes()
    dos_template = None
    if dos_template_path is not None:
        dos_template = Path(dos_template_path).read_bytes()
    out = convert(raw, dos_template=dos_template)
    Path(dst_path).write_bytes(out)
    return out


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('usage: charsave.py <amiga CHARACTERSA path> <output char%d.dat path>',
              file=sys.stderr)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    out = convert_file(src, dst)
    print(f'{len(out)} B -> {dst}')

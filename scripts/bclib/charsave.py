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

2. **4 character records (170 B each, DOS layout) — mixed confidence, see
   `CORE_LAYOUT` below.** Each DOS record is a 2-byte party-slot index
   (`0..3`, confirmed identical in *value and position* on both platforms —
   real Amiga saves have the same `0,1,2,3` sequence immediately before
   each character's name string, at the same relative offset DOS uses) plus
   a 168-byte "core" struct plus **no tail at all**, for this converter's
   output specifically — see the correction below.

   **Correction, this session (superseding "270 B each" and "100-byte
   tail" everywhere in this docstring):** a real DOS record's length is
   *not* fixed at 270 B — it's fully data-dependent. Fresh disassembly of
   BOTH `crypt.exe fcn.00401b80` (save) and `fcn.00426390` (the
   restore-game routine that actually parses `char%hu.dat` back into
   memory, traced for the first time this session) shows both walk a
   **23-slot dense item/spell-id array at core-relative 0x14-0x42** (2-byte
   stride — not the previously-assumed "4 slots x 10 B at +0x18", which was
   an eyeballed pattern match on 4 of those 23 slots' real nonzero values,
   refuted by the actual code trace). For every NONZERO slot, both routines
   consume a 20-byte item-definition record from the file, and can
   recurse into further 20-byte blocks for "special" item types (byte value
   0x13/0x23 triggers `fcn.00425120` on load / `fcn.00401a20` on save,
   which themselves conditionally consume more file bytes and can call
   themselves again). `char1.dat`'s real 100-byte tail per character (4
   directly-visible nonzero slots x 20 B = 80 B, plus one more 20 B block
   pulled in via this recursive path for one "special" item) is now fully
   accounted for by this mechanism, not a coincidence.

   Since this converter zeroes every one of those 23 slots (safety choice,
   unchanged from before), `fcn.00426390` takes the "slot is zero, don't
   touch the file cursor" branch for all 23 slots on load, meaning the
   DOS-correct tail length for THIS converter's output is exactly **0
   bytes** — not the fixed 100-byte guess a previous version of this
   module wrote. That previous version's 270-byte-fixed-record assumption
   was a real, confirmed bug: the loader, given all-zero ids, only consumes
   170 B (2+168) per character, so a 270-byte-per-record writer leaves a
   100-byte-per-character cumulative desync that misreads every character
   after the first — observed live as all 4 party UI boxes showing
   identical, wrong data (character 0's data, mirrored) after converting
   and loading a real end-game save under Wine.

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
   - **Item/spell-slot array (`+0x14`, 23x2 B within the core — corrected
     this session, was `+0x18`, 4x10 B):** deliberately **zeroed**, not
     transformed. This is the safety call the task brief asked for — see
     § "The per-character tail" below.
   - **No tail** (corrected this session, was a 100-byte zeroed span at
     `+0xAA`..`+0x10D` of the DOS record): the record is exactly 170 B,
     because with every item slot zeroed, the DOS loader never advances
     its file cursor past the 168-byte core for that character — writing
     tail bytes anyway would desync every following character. See above.

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

This module's choice: **zero the 23-slot item/spell array inside the core
(`+0x14`..`+0x42`) and emit no tail at all.** A DOS record built this way
has no item ids for the load-time tail-consuming logic to look up in the
first place, so there is nothing inconsistent between "the ids say there's
inventory" and "the tail has no data" — the record is internally
consistent, just empty. Concretely: converted characters load with reset
inventory and (if the same mechanism drives it, per Phase 6's "known-spells
list" hypothesis) empty spellbooks, not wrong or dangling item
references.

**Record byte length — corrected this session, was a bug.** A previous
version of this module always emitted a fixed 270-byte record (170-byte
base + a 100-byte zeroed tail), on the theory — flagged at the time as
"possibly variable-length coincidence, not a confirmed fixed stride" — that
`char1.dat`'s real records happening to measure 270 B each was evidence of
a fixed on-disk stride. Fresh disassembly of the *load* side
(`fcn.00426390`, not traced when that theory was written) proves the
opposite: the loader's file-cursor advance for each character is
data-dependent (driven by the 23-slot item array, see above), and for an
all-zero record it advances by exactly 170 B, not 270. Writing a 270-byte
record for all-zero item data left a 100-byte gap the loader's cursor
never crosses, desyncing every character after the first. This module now
emits exactly 170 B per record (`DOS_RECORD_BYTES = RECORD_HEADER_BYTES +
CORE_BYTES`, no tail term) — which happens to still be "fixed" in the
sense that every record this converter writes has the same length (since
every record is equally all-zero in its item array), but the *reason* is
now the correct one: it matches what the loader will actually consume,
not an assumption about on-disk stride.

## Confidence summary

| Region | Confidence |
|---|---|
| 210 B header | Confirmed (disassembly: state-independent on DOS) |
| Party-slot index (record `+0x00`) | Confirmed (matches on both platforms, real data) |
| Core struct: name, `01 FF..` marker, 3 word-pair stats, class-constant array | Confirmed (Phase 6 real byte comparison) |
| Core struct: remaining ~90 B | Best-effort / unverified (raw copy, no swap) |
| Item/spell-slot array (`+0x14`..`+0x42`, 23x2 B) + no tail | Confirmed correct span and consumption behaviour this session (disassembly of both save and load routines); deliberately zeroed (safety choice, not a decode) |
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

#: DOS's per-character tail is NOT a fixed 100 B -- confirmed this session
#: by disassembling BOTH `crypt.exe fcn.00401b80` (save) and `fcn.00426390`
#: (load, the restore-game routine that actually parses `char%hu.dat` back
#: into memory). Both routines walk a **23-slot dense item/spell-id array**
#: at core-relative 0x14-0x42 (2-byte stride, confirmed against real
#: `char1.dat` bytes: exactly 4 nonzero slots per character, landing at
#: core+0x18/0x22/0x2a/0x38 with values matching the already-known
#: "1,2,3,4 / 6,7,8,9 / 11,12,13,14 / 16,17,18,19" id groups) and, for each
#: NONZERO slot, consume a 20-byte item-definition record from the file --
#: *and*, when that item's type byte is 0x13 or 0x23, recurse into
#: `fcn.00425120` (load) / `fcn.00401a20` (save), which conditionally
#: consumes yet more 20-byte blocks (confirmed: `fcn.00425120` itself calls
#: `dword[0x46f870]`-cursor-consuming code and can even call itself
#: recursively at file+0x425211). This fully explains why `char1.dat`'s
#: real per-character tail is 100 B (5x20) despite only 4 *directly*
#: visible nonzero slots -- one of those 4 items is a "special" type that
#: pulls in one extra 20 B block via this recursive path.
#:
#: Since `charsave.py` deliberately zeroes every slot in that 23-slot array
#: (see CORE_LAYOUT below), NONE of this machinery ever fires on load --
#: every `cmp word[ebp], 0` check in `fcn.00426390` takes the "skip, don't
#: touch the file cursor" branch for all 23 slots. The DOS-correct tail
#: length for a converter-produced record is therefore exactly **0 bytes**,
#: not a fixed 100 B guess. Writing a fixed 100-byte zero tail (the
#: previous version of this module) was the root cause of a real bug: the
#: loader, seeing all-zero ids, consumes only 170 B (2+168) per character
#: from the file, while the previous writer emitted 270 B -- a 100-byte
#: cumulative desync starting after character 0 that misaligned every
#: subsequent character's "core" read, corrupting characters 1-3 (observed
#: live as all 4 party UI boxes showing identical, wrong, character-0-like
#: data after a live Wine test of a converted save).
DOS_TAIL_BYTES = 0
DOS_RECORD_BYTES = RECORD_HEADER_BYTES + CORE_BYTES + DOS_TAIL_BYTES  # 170
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

#: Byte offsets of X, Y, and facing within the 52-byte party-scalar block --
#: pinned this session by disassembling the SAME 17-write sequence that
#: pinned CURRENT_MAP_REL_OFFSET above (`fcn.00401b80`, 0x401d21-0x401e9b),
#: cross-referencing it against this plan doc's already-confirmed globals
#: from a completely different investigation ("Party position and facing
#: need no new code": `fcn.00410d10`/`MoveParty` pass `&word[0x46f880]`
#: (X), `&word[0x46f87e]` (Y), `&word[0x46bd60]` (facing)). Those same three
#: globals are writes 3, 4, and 5 of the 17-write sequence, landing at
#: relative offsets 6, 8, 10 -- independently cross-checked against the
#: already-confirmed current-map write (write 9, offset 18) landing exactly
#: where predicted. `char1.dat` reads X=8, Y=21, facing=0 (North) at these
#: offsets -- the DOS demo's own fresh/map-1 starting position, valid for
#: map 1 but not necessarily any other map (see the position-fix logic in
#: `build_dos_save` below).
X_REL_OFFSET = 6
Y_REL_OFFSET = 8
FACING_REL_OFFSET = 10

# Item-slot table inside the 168-byte core. IMPORTANT correction this
# session: this is NOT "4 slots x 10 B" -- that was an eyeballed pattern
# match (the 4 real, nonzero ids in char1.dat happen to look evenly spaced
# if you only sample every 10th byte) that a real disassembly trace of BOTH
# `fcn.00401b80` (save) and `fcn.00426390` (load) refutes: both routines
# walk a DENSE 23-slot array, 2-byte stride, core-relative 0x14-0x42 (see
# DOS_TAIL_BYTES's comment above for the full evidence chain). The old
# "0x18 stride 0x0A x4" values (1,2,3,4 at char1.dat core+0x18/0x22/0x2a/
# 0x38) are real bytes, but they are 4 *populated* slots out of this same
# 23-slot array, at indices 2, 7, 11, and 18 -- not a separate 4-slot
# fixed-stride table. `ITEM_SLOT_BASE`/`STRIDE`/`COUNT` below are kept as
# the *old, unverified* values -- they are used only informationally, to
# extract `item_ids` from the parsed Amiga source for logging/reporting
# (never written to DOS output; the DOS write path uses `ITEM_ARRAY_BASE`/
# `ITEM_ARRAY_SLOT_COUNT` below instead, which IS the disassembly-confirmed
# DOS-side range). Whether the Amiga side's own item array has the same
# dense 2-byte-stride shape was never independently checked this session.
ITEM_SLOT_BASE = 0x18
ITEM_SLOT_STRIDE = 0x0A
ITEM_SLOT_COUNT = 4

#: The real, disassembly-confirmed DOS item/spell-slot array: 23 slots,
#: 2-byte stride, core-relative 0x14-0x42 (exclusive end). Every one of
#: these must read as literal zero in the DOS output, or `fcn.00426390`
#: will try to consume 20+ file bytes per nonzero slot on load (and
#: recurse for special item types -- see DOS_TAIL_BYTES above), corrupting
#: every character after the first.
ITEM_ARRAY_BASE = 0x14
ITEM_ARRAY_SLOT_COUNT = 23
ITEM_ARRAY_END = ITEM_ARRAY_BASE + ITEM_ARRAY_SLOT_COUNT * 2  # 0x42

#: How to build the DOS core struct from the Amiga core struct, byte range
#: by byte range. 'raw' = copy unchanged; 'word' = swap each 2-byte unit;
#: 'zero' = always zero (the item-slot array, this converter's safety
#: choice for inventory/spell data -- see ITEM_ARRAY_BASE above). See the
#: module docstring's numbered list (item 2) and confidence table for the
#: evidence behind each span.
CORE_LAYOUT = [
    (0x00, ITEM_ARRAY_BASE, 'raw'),        # class name (24 B) + gap, up to
                                            # the real item-array start
                                            # (0x14) -- corrected this
                                            # session, was 0x18
    (ITEM_ARRAY_BASE, ITEM_ARRAY_END, 'zero'),  # 23x2 B item/spell array --
                                            # zeroed (safety); was
                                            # mistakenly (0x18,0x40) before
    (ITEM_ARRAY_END, 0x46, 'raw'),         # unmapped residue (was
                                            # (0x40,0x46) before -- now
                                            # starts at the corrected 0x42
    (0x46, 0x4C, 'raw'),    # confirmed unswapped 6-byte marker (01 FF x5)
    (0x4C, 0x56, 'word'),   # 5 confirmed swapped words (3 stat fields:
                            # +0x4C/+0x4E and +0x50/+0x52 are 2-word
                            # current/max pairs, +0x54 is a single word)
    (0x56, 0x5E, 'raw'),    # unmapped gap -- best-effort
    (0x5E, 0x6E, 'raw'),    # confirmed unswapped 16-byte class-const array
    (0x6E, 0xA8, 'raw'),    # unmapped remainder of the core -- best-effort.
                            # Note: the LAST 2 bytes of this span (core
                            # 0xA6-0xA8, i.e. absolute file rec+168..+170)
                            # are, per this session's fresh disassembly of
                            # both fcn.00401b80 and fcn.00426390, NOT
                            # actually part of the rep-movsd'd struct at
                            # all -- they're a separately-written/read 2-
                            # byte scalar (DOS save side: a per-slot value
                            # computed from a constant table at 0x4301cc
                            # minus slot_index*9; load side: stored into an
                            # unrelated global array at 0x469db4, never
                            # consulted for character display). Raw-copying
                            # Amiga bytes there is harmless either way (the
                            # byte count matches regardless of content) but
                            # is not a "real" struct field on DOS.
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
    """Build one 170-byte DOS character record (2 B slot index + 168 B
    core, no tail) from a parsed Amiga record. There is deliberately NO
    tail: every item/spell slot inside the core is zeroed (CORE_LAYOUT),
    and `fcn.00426390` (the DOS loader) consumes zero extra file bytes for
    an all-zero item array -- see DOS_TAIL_BYTES's docstring for the fresh
    disassembly evidence. Writing a nonzero-length tail here would desync
    every subsequent character's read position."""
    assert DOS_RECORD_BYTES == RECORD_HEADER_BYTES + CORE_BYTES, (
        'charsave: DOS_RECORD_BYTES no longer matches header+core -- '
        'update build_dos_record if a real (nonzero) tail is ever needed')
    out = bytearray(DOS_RECORD_BYTES)
    struct.pack_into('<H', out, 0, slot)
    out[2:2 + CORE_BYTES] = transform_core(amiga_record['core'])
    return bytes(out)


#: Real Amiga `bcdfs` dungeon-data file, used only to pick a valid starting
#: position for maps other than 1 -- see `_pick_start_cell` below.
BCDFS_PATH = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'


def _pick_start_cell(map_number, bcdfs_path=None):
    """Find a real, valid, in-bounds `(x, y)` starting cell for
    `map_number` (1-13) by walking the real Amiga `bcdfs` dungeon file.

    This session confirmed (`data/blackcrypt/dosvga/char1.dat`'s own fresh-
    save default, X=8/Y=21, checked against map 13's real square data via
    `bclib.bcdfs`) that a fixed map-1-shaped default position is genuinely
    wrong once applied to a different map: (8, 21) is not a populated
    square anywhere in map 13's sparse row/col data (checked both possible
    axis orderings), landing the party in the *shared, un-carved* region of
    the runtime 64x64 grid -- which, per `docs/blackcrypt/amiga/data-
    structure.md`'s automap-tile finding, is otherwise-unwritten memory,
    not a real "walled void". This exactly explains the live-observed bug
    ("floor and ceiling only, no walls in any direction"): an unpopulated
    cell has a real `wall_flags` nibble of `0` (no walls) rather than the
    "walled off on every side" the project's own *web-renderer* densifier
    (`scripts/export_dungeon_levels.py`'s `FILL_WALL_FLAGS`) defensively
    assumes for its own unrelated purposes.

    Picks the real, populated, non-wall-type square closest to the
    centroid of all such squares on the map -- a simple, deterministic
    "somewhere in the middle of the level" heuristic. This is NOT the
    game's own real intended entrance/spawn point (that logic was not
    traced this session) -- just guaranteed-real, in-bounds, walkable
    geometry instead of a map-1-shaped guess. Returns `None` if
    `bcdfs_path` doesn't exist or the map has no populated non-wall
    squares (should not happen for any of the 13 real maps).
    """
    path = Path(bcdfs_path) if bcdfs_path is not None else BCDFS_PATH
    if not path.exists():
        return None
    from bclib import bcdfs
    raw = path.read_bytes()
    offsets = bcdfs.read_map_offsets(raw)
    idx = map_number - 1
    if not (0 <= idx < len(offsets)):
        return None
    cells = {}
    bcdfs.walk_map(raw, offsets, idx,
                    on_square=lambda m, row, col, off, sq: cells.__setitem__((row, col), bytes(sq)))
    # Exclude wall-type squares (square-type nibble bit 0, i.e. sq[0] &
    # 0x10) -- not walkable, regardless of their own wall_flags nibble.
    walkable = {rc: sq for rc, sq in cells.items() if not (sq[0] & 0x10)}
    if not walkable:
        return None
    mean_row = sum(r for r, c in walkable) / len(walkable)
    mean_col = sum(c for r, c in walkable) / len(walkable)
    best_row, best_col = min(
        walkable, key=lambda rc: (rc[0] - mean_row) ** 2 + (rc[1] - mean_col) ** 2)
    return best_col, best_row  # (x, y): x=col, y=row


def build_dos_save(parsed, dos_template=None, bcdfs_path=None):
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
    #    current map overridden with the real extracted value. Position
    #    (X/Y/facing) is ALSO overridden, but only when the target map
    #    isn't 1 -- `char1.dat`'s own default position is the DOS demo's
    #    real, live-tested-working map-1 entrance, strictly better than any
    #    heuristic pick; for any other map, that same default is real, but
    #    wrong-map geometry (see `_pick_start_cell`), so this replaces it
    #    with a real cell from the TARGET map's own data when available.
    block_start = HEADER_BYTES + 4 * DOS_RECORD_BYTES
    block = bytearray(
        dos_template[block_start:block_start + PARTY_SCALAR_BYTES])
    struct.pack_into('<H', block, CURRENT_MAP_REL_OFFSET,
                      parsed['current_map'])
    if parsed['current_map'] != 1:
        cell = _pick_start_cell(parsed['current_map'], bcdfs_path=bcdfs_path)
        if cell is not None:
            x, y = cell
            struct.pack_into('<H', block, X_REL_OFFSET, x)
            struct.pack_into('<H', block, Y_REL_OFFSET, y)
            struct.pack_into('<H', block, FACING_REL_OFFSET, 0)  # North
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


def convert(raw, dos_template=None, bcdfs_path=None):
    """Convert a whole Amiga `CHARACTERSA` byte string to a DOS `char%d.dat`
    byte string."""
    parsed = parse_amiga_save(raw)
    return build_dos_save(parsed, dos_template=dos_template, bcdfs_path=bcdfs_path)


def convert_file(src_path, dst_path, dos_template_path=None, bcdfs_path=None):
    raw = Path(src_path).read_bytes()
    dos_template = None
    if dos_template_path is not None:
        dos_template = Path(dos_template_path).read_bytes()
    out = convert(raw, dos_template=dos_template, bcdfs_path=bcdfs_path)
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

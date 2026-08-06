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

   - **Core struct (168 B):** transformed field-by-field per `CORE_LAYOUT`.
     **Correction, a later session (see `full-game-restoration-plan.md` §
     "Phase 6" subsection 13):** the "01 FF FF FF FF FF marker /
     `+0x4C/+0x4E`/`+0x50/+0x52`/`+0x54` word-pair stats / 16-byte
     class-constant array" region (core `0x42`-`0x70`) that a prior session
     called "confirmed" was only ever checked against a FRESH, just-created
     character, where current==max and equipment==starting-kit hide the
     real variability. Real end-game data refutes it (the "marker" isn't
     constant, the "current/max pair" isn't a matching pair, the
     "class-constant array" is completely different per character even
     within the same class) — it is real, `crypt.exe`-display-consumed
     equipment/known-spell state (`fcn.00421cc0`, the live party-box
     icon/equipment-panel renderer, reads several offsets inside this exact
     span). Since its true DOS on-disk encoding was never independently
     verified, this span is now **templated from the DOS reference file's
     own same-class character** (`EQUIP_STATE_BASE`/`_dos_template_cores`)
     rather than transformed from the Amiga source — the same safety policy
     already used for the item array and the party-scalar block. The
     remaining ~56 bytes of the struct (core `0x70`-`0xA8`) were never
     decoded field-by-field; this module still copies them byte-for-byte
     unchanged (no swap) as the least-risky default. **This is a
     best-effort, unverified choice for those ~56 bytes** — they may hold
     real stats (gold, weight, XP, etc.) at values that come out
     numerically wrong (though not crash-inducing the way a corrupted
     pointer/offset table would be).
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
   save, with current map, position and facing overridden.** Phase 6 never
   established a per-field byte-offset mapping between the Amiga's ~20
   named scalars and DOS's; guessing at the rest risked writing
   plausible-looking garbage into fields that drive gameplay (turn
   counter, selected-character index, etc). This module instead copies the
   fresh DOS demo save's own 52-byte scalar block verbatim for everything
   except 4 fields it pinned to exact byte offsets by fresh x86
   disassembly: **current map** (`+18`), **X** (`+6`), **Y** (`+8`) and
   **facing** (`+10`) — see `CURRENT_MAP_REL_OFFSET`/`X_REL_OFFSET`/
   `Y_REL_OFFSET`/`FACING_REL_OFFSET` for the disassembly evidence
   (`crypt.exe fcn.00401b80`'s 17-write sequence starting at `0x401d21`,
   cross-checked against `char1.dat`'s own known fresh-map-1 values). For
   map 1, `char1.dat`'s own real, live-tested-working entrance is kept
   verbatim. For any other map, X/Y/facing are replaced with a real
   landmark position: immediately in front of a real Stairs Up structure
   on the target map's own data, facing it, so the initial view shows
   recognizable geometry rather than an arbitrary open square — see
   `_pick_start_cell`.

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
| Core struct: `0x00`-`0x14` (name + gap) | Confirmed (Phase 6 real byte comparison) |
| Core struct: `0x42`-`0x70` (equipment/known-spell state, formerly-"confirmed" marker/stat-pair/class-array) | Refuted as constant/simple-swap this session (real end-game data diverges completely from the fresh-save case that "confirmed" it); display-consumed by `fcn.00421cc0`; now templated from the DOS reference file's own same-class character rather than transformed from the Amiga source (safety choice, not a decode) |
| Core struct: remaining `0x70`-`0xA8` (~56 B) | Best-effort / unverified (raw copy, no swap) |
| Item/spell-slot array (`+0x14`..`+0x42`, 23x2 B) + no tail | Confirmed correct span and consumption behaviour this session (disassembly of both save and load routines); deliberately zeroed (safety choice, not a decode) |
| Party-scalar block (44 of 52 B) | Safe defaults from a real working DOS save, not derived from the Amiga source |
| Current map (party-scalar `+18`) | Confirmed (fresh disassembly this session + `char1.dat` cross-check) |
| X/Y/facing (party-scalar `+6`/`+8`/`+10`) | Byte offsets confirmed by disassembly; for map != 1, the *value* picked is a real Stairs Up landmark from the target map's own `bcdfs` data (confirmed populated, non-wall, unobstructed view — see `_pick_start_cell`), not the game's actual intended entrance (not traced) |
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

#: Correction, this session (see `full-game-restoration-plan.md` § "Phase 6"
#: subsection 13): core `0x42`-`0x70` is NOT "a confirmed 6-byte marker +
#: 3 confirmed current/max stat-word-pairs + an unmapped gap + a confirmed
#: 16-byte class-constant array", as every prior pass in this Phase
#: documented. Every one of those "confirmed" sub-claims was checked ONLY
#: against a FRESH, just-created character (`1/CHARACTERSA` vs. `char1.dat`,
#: both level-1 starting parties) -- where, by construction, current stat
#: == max stat and current equipment == starting kit, making raw/swapped
#: bytes LOOK like a stable template by coincidence. Diffing that same span
#: against the real end-game target this module actually converts
#: (`2/BlackCrypt/CHARACTERSA`, current map 13) refutes it directly: the
#: "01 FF FF FF FF FF marker" reads `01 04 FF FF FF FF` for the deep
#: Cleric; the "+0x4C/+0x4E current/max pair" reads `0x02FF`/`0x00B9`
#: (767/185 -- current > max, not a matching pair); and the "class-constant
#: array" at core `0x60`-`0x70` (the REAL byte position of the array
#: `full-game-restoration-plan.md` subsection 3 quoted -- that citation's
#: own "+0x5E" offset was itself off-by-2 relative to `core`, though it made
#: no functional difference since every span either side of it was already
#: 'raw') is COMPLETELY DIFFERENT between the fresh and deep saves, for
#: EVERY class including Fighter (fresh Fighter `08080e0608...`, deep
#: Fighter `0e4d151414...`). This is real, per-character, currently-
#: equipped-gear/known-spell state (matches the "Update" section's own
#: "known-spells list" hypothesis, and is independently confirmed as
#: DISPLAY-CONSUMING, not inert: `crypt.exe fcn.00421cc0` -- the live party-
#: box icon/equipment-panel renderer, called every frame after a successful
#: load via `fcn.00426990` -- reads struct-relative `0x58`/`0x5A`/`0x60`/
#: `0x61`/`0x62` (== core `0x56`/`0x58`/`0x5E`/`0x5F`/`0x60`, all inside
#: this span) to drive icon blits and numeric-field renders). Since the
#: real DOS on-disk encoding for "currently equipped item/known spell"
#: state was never independently verified beyond the coincidentally-static
#: fresh case, and the Amiga source's own real bytes here are `crypt.exe`-
#: display-consumed, blindly raw/word-swap-copying them is the same class
#: of risk this module already zeroes the item array to avoid. Given no
#: verified transform exists, this module now applies the SAME safety
#: policy it already uses elsewhere (party-scalar block, 210 B header):
#: substitute the known-working DOS reference file's own bytes for this
#: class (`_dos_template_cores`) instead of guessing at the Amiga source's.
EQUIP_STATE_BASE = ITEM_ARRAY_END          # 0x42
EQUIP_STATE_END = 0x70

#: How to build the DOS core struct from the Amiga core struct, byte range
#: by byte range. 'raw' = copy unchanged from the Amiga source; 'zero' =
#: always zero (the item-slot array, this converter's safety choice for
#: inventory/spell data -- see ITEM_ARRAY_BASE above); 'template' = copy
#: from the DOS reference file's own same-class character instead of the
#: Amiga source (the equipment/spell-state span -- see EQUIP_STATE_BASE
#: above). See the module docstring's numbered list (item 2) and confidence
#: table for the evidence behind each span.
CORE_LAYOUT = [
    (0x00, ITEM_ARRAY_BASE, 'raw'),        # class name (24 B) + gap, up to
                                            # the real item-array start
                                            # (0x14) -- corrected this
                                            # session, was 0x18
    (ITEM_ARRAY_BASE, ITEM_ARRAY_END, 'zero'),  # 23x2 B item/spell array --
                                            # zeroed (safety); was
                                            # mistakenly (0x18,0x40) before
    (EQUIP_STATE_BASE, EQUIP_STATE_END, 'template'),  # 0x42-0x70: real,
                                            # display-consumed equipment/
                                            # spell state -- previously
                                            # mismodeled as constant/
                                            # confirmed fields (see
                                            # EQUIP_STATE_BASE's comment
                                            # above); now templated from
                                            # the DOS reference file's own
                                            # same-class character, not
                                            # guessed from the Amiga source
    (EQUIP_STATE_END, 0xA8, 'raw'),        # unmapped remainder of the core
                                            # -- best-effort. Note: the LAST
                                            # 2 bytes of this span (core
                                            # 0xA6-0xA8, i.e. absolute file
                                            # rec+168..+170) are, per fresh
                                            # disassembly of both
                                            # fcn.00401b80 and fcn.00426390,
                                            # NOT actually part of the
                                            # rep-movsd'd struct at all --
                                            # they're a separately-written/
                                            # read 2-byte scalar (DOS save
                                            # side: a per-slot value
                                            # computed from a constant table
                                            # at 0x4301cc minus
                                            # slot_index*9; load side:
                                            # stored into an unrelated
                                            # global array at 0x469db4,
                                            # never consulted for character
                                            # display). Raw-copying Amiga
                                            # bytes there is harmless either
                                            # way (the byte count matches
                                            # regardless of content) but is
                                            # not a "real" struct field on
                                            # DOS.
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


def _dos_template_cores(dos_template):
    """Extract the DOS reference file's own 4 character cores (168 B each),
    keyed by class name offset order (Fighter/Cleric/Magic User/Druid --
    `CLASS_NAMES`' fixed order, same convention `_find_class_offsets`
    already enforces for the Amiga source). Used by `transform_core`'s
    `'template'` spans (see `EQUIP_STATE_BASE`) to source real,
    known-working, same-class bytes instead of guessing at the Amiga
    source's own equipment/spell-state encoding.

    Works regardless of the reference file's own per-character record
    length (a real played save like `char1.dat` has real, variable-length,
    non-170-byte records -- see `_locate_template_party_scalar_block`'s
    docstring for the same caveat) because it locates each core purely by
    its class-name string, not by any assumed record stride.
    """
    name_offsets = _find_class_offsets(dos_template)
    return [dos_template[off:off + CORE_BYTES] for off in name_offsets]


def transform_core(core, template_core=None):
    """Amiga -> DOS transform of one 168-byte character-core struct. See
    `CORE_LAYOUT` and the module docstring for the evidence behind each
    span. `template_core` (168 B, from `_dos_template_cores`) supplies the
    `'template'`-kind spans; if omitted, those spans fall back to a raw
    (unswapped) copy of the Amiga source, the same best-effort behaviour
    the whole span used before this session's correction."""
    assert len(core) == CORE_BYTES
    if template_core is not None:
        assert len(template_core) == CORE_BYTES
    out = bytearray(CORE_BYTES)
    for start, end, kind in CORE_LAYOUT:
        if kind == 'raw':
            out[start:end] = core[start:end]
        elif kind == 'zero':
            pass  # already zero-initialized
        elif kind == 'word':
            for i in range(start, end, 2):
                out[i], out[i + 1] = core[i + 1], core[i]
        elif kind == 'template':
            out[start:end] = (template_core if template_core is not None
                               else core)[start:end]
        else:
            raise ValueError(f'charsave: unknown CORE_LAYOUT kind {kind!r}')
    return bytes(out)


def build_dos_record(slot, amiga_record, template_core=None):
    """Build one 170-byte DOS character record (2 B slot index + 168 B
    core, no tail) from a parsed Amiga record. There is deliberately NO
    tail: every item/spell slot inside the core is zeroed (CORE_LAYOUT),
    and `fcn.00426390` (the DOS loader) consumes zero extra file bytes for
    an all-zero item array -- see DOS_TAIL_BYTES's docstring for the fresh
    disassembly evidence. Writing a nonzero-length tail here would desync
    every subsequent character's read position. `template_core` (see
    `_dos_template_cores`) supplies the equipment/spell-state span -- see
    `EQUIP_STATE_BASE`."""
    assert DOS_RECORD_BYTES == RECORD_HEADER_BYTES + CORE_BYTES, (
        'charsave: DOS_RECORD_BYTES no longer matches header+core -- '
        'update build_dos_record if a real (nonzero) tail is ever needed')
    out = bytearray(DOS_RECORD_BYTES)
    struct.pack_into('<H', out, 0, slot)
    out[2:2 + CORE_BYTES] = transform_core(amiga_record['core'], template_core)
    return bytes(out)


#: Real Amiga `bcdfs` dungeon-data file, used only to pick a valid starting
#: position for maps other than 1 -- see `_pick_start_cell` below.
BCDFS_PATH = ROOT / 'data' / 'blackcrypt' / 'amiga' / 'bcdfs'

#: `bcdfs` structure type byte (record byte +0x05) for Stairs/Teleport/
#: Spinner, and the `word +0x10` sub-kind value that means "Stairs Up"
#: (flight A, gfx `0x43`) -- both confirmed in
#: `amiga/data-structure.md` §§ "The 24 automap tiles" / "Special-square
#: sub-kinds" (`Flight A = Stairs Up, flight B = Stairs Down -- CONFIRMED`
#: against DOS `clipper.clp`'s own labelled `Stairs Up 1/2/3` entries by
#: palette-independent pixel-region agreement, 1.0000/~0.999 vs 0.63-0.80
#: for the wrong pairing).
STRUCTURE_TYPE_STAIRS = 0x12
STAIRS_UP_SUBKIND = 2

#: `ApplyFacingDelta` (S_1 `+0x002B4`, confirmed): facing 0=N moves Y+=1
#: (row+1), 1=E moves X+=1 (col+1), 2=S moves Y-=1 (row-1), 3=W moves
#: X-=1 (col-1). `FACING_APPROACH` maps a compass direction from the
#: stairs square to (a) the neighbour square you'd stand on in that
#: direction and (b) the facing that looks back at the stairs square from
#: there (the opposite compass direction).
#:   neighbour south of stairs (row-1, col) -> face North(0) to look at it
#:   neighbour north of stairs (row+1, col) -> face South(2)
#:   neighbour west  of stairs (row, col-1) -> face East(1)
#:   neighbour east  of stairs (row, col+1) -> face West(3)
FACING_APPROACH = [
    (-1, 0, 0),   # neighbour south, facing North
    (1, 0, 2),    # neighbour north, facing South
    (0, -1, 1),   # neighbour west, facing East
    (0, 1, 3),    # neighbour east, facing West
]
#: Wall-flags bit (N=1,E=2,S=4,W=8) tested on the NEIGHBOUR square for the
#: given facing -- `MoveParty` (`+0x16CDC`) and the render-side wall check
#: both gate on the CURRENT square's own wall_flags bit in the direction of
#: travel/view, not the destination square's -- see
#: `amiga/data-structure.md` § "`MoveParty(verb)`" and "The 24 automap
#: tiles" (tile 0: "a `wall_flags` bit between party and square").
FACING_WALL_BIT = {0: 0x1, 1: 0x2, 2: 0x4, 3: 0x8}


def _find_stairs_up_start(map_number, bcdfs_path=None):
    """Find a real starting `(x, y, facing)` immediately in front of a
    Stairs Up structure on `map_number`, per the project owner's request
    for a recognizable landmark rather than an arbitrary open square.

    Walks the target map's real `bcdfs` data for every type-`0x12`
    (Stairs/Teleport/Spinner) record whose `word +0x10` sub-kind is `2`
    (Stairs Up, flight A -- see `STAIRS_UP_SUBKIND`'s docstring for the
    confirmation). For each one found (a map can have more than one -- map
    3 has 12), tries all 4 compass neighbours of its square in the fixed
    order `FACING_APPROACH` lists (south, north, west, east) and returns
    the first that is (a) really populated on this map, (b) not itself a
    wall-type square (can't stand in a wall),
    and (c) has no `wall_flags` bit blocking the view from that neighbour
    towards the stairs square -- i.e. the stairs will render at depth 0,
    directly ahead, unobstructed, per `amiga/data-structure.md` § "3D
    Viewport Compositing" (structures render only within `depth < 3`, and
    a `wall_flags` bit facing the direction of travel/view blocks the
    render, per the automap tile-0 rule reusing the same bit).

    Returns `None` if the map has no Stairs Up record, or every one found
    has no valid unobstructed neighbour (not observed on any of the 13
    real maps -- see the verification in `full-game-restoration-plan.md`
    § "Phase 6" subsection 11).
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

    squares = {}
    stairs_up = []

    def on_square(m, row, col, off, sq):
        squares[(row, col)] = bytes(sq)

    def on_record(m, row, col, off, rec):
        if rec[5] == STRUCTURE_TYPE_STAIRS:
            subkind = struct.unpack_from('>H', rec, 0x10)[0]
            if subkind == STAIRS_UP_SUBKIND:
                stairs_up.append((row, col))

    bcdfs.walk_map(raw, offsets, idx, on_record=on_record, on_square=on_square)

    for stairs_row, stairs_col in stairs_up:
        for dr, dc, facing in FACING_APPROACH:
            nrow, ncol = stairs_row + dr, stairs_col + dc
            neighbor = squares.get((nrow, ncol))
            if neighbor is None:
                continue
            if neighbor[0] & 0x10:      # wall-type square -- can't stand here
                continue
            neighbor_wall_flags = neighbor[2] >> 4
            if neighbor_wall_flags & FACING_WALL_BIT[facing]:
                continue                # view towards the stairs is blocked
            return ncol, nrow, facing   # (x, y, facing): x=col, y=row
    return None


def _pick_start_cell_centroid(map_number, bcdfs_path=None):
    """Fallback heuristic: the real, populated, non-wall-type square
    closest to the centroid of all such squares on the map -- a simple,
    deterministic "somewhere in the middle of the level" pick, used only
    when `_find_stairs_up_start` finds no usable Stairs Up landmark (not
    observed on any of the 13 real maps, but kept as a safety net).

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

    Returns `None` if `bcdfs_path` doesn't exist or the map has no
    populated non-wall squares (should not happen for any of the 13 real
    maps). Returns `(x, y, facing)` with `facing` hardcoded to North (0)
    -- unlike the stairs-based pick, this heuristic has no natural "look
    at something" direction.
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
    return best_col, best_row, 0  # (x, y, facing): x=col, y=row, North


def _pick_start_cell(map_number, bcdfs_path=None):
    """Find a real, valid, in-bounds `(x, y, facing)` starting placement
    for `map_number` (1-13) by walking the real Amiga `bcdfs` dungeon
    file: prefer standing immediately in front of a real Stairs Up
    structure, facing it, so the initial view always shows a recognizable
    landmark (`_find_stairs_up_start`); fall back to the old "closest to
    the walkable centroid" heuristic only if the map has no usable Stairs
    Up record (`_pick_start_cell_centroid`) -- not observed on any of the
    13 real maps (every one has at least one Stairs Up record with a real,
    unobstructed approach square; see the per-map census in
    `full-game-restoration-plan.md` § "Phase 6" subsection 11).
    """
    cell = _find_stairs_up_start(map_number, bcdfs_path=bcdfs_path)
    if cell is not None:
        return cell
    return _pick_start_cell_centroid(map_number, bcdfs_path=bcdfs_path)


def _locate_template_party_scalar_block(dos_template):
    """Find the TRUE byte offset of the 52-byte party-scalar block inside
    a real DOS `char%d.dat` reference file (the template used for "safe
    default" bytes), by working backward from the end of the file rather
    than forward from `HEADER_BYTES + 4 * DOS_RECORD_BYTES`.

    **Why the forward formula is wrong for a real template file.** The
    forward formula (`block_start = HEADER_BYTES + 4 * DOS_RECORD_BYTES`)
    assumes every one of the template's 4 character records is exactly
    `DOS_RECORD_BYTES` (170 B, i.e. all-zero item/spell slots). That's true
    of *this converter's own output* (which always zeroes every item slot,
    per `CORE_LAYOUT`/`DOS_TAIL_BYTES`), but it is NOT true of a real,
    played DOS save like `char1.dat` -- a real character has real starting
    items, and `fcn.00426390`'s loader consumes a data-dependent number of
    extra 20-byte blocks per nonzero item slot (see `DOS_TAIL_BYTES`'s
    docstring). Confirmed empirically: `char1.dat`'s real party-scalar
    block is at file offset **1290**, not the naively-assumed 890 -- a
    400-byte error. Using 890 silently copied "safe default" bytes from
    deep inside character 3's own real item/spell data (garbage relative
    to the party-scalar block's real fields), corrupting every
    non-overridden party-scalar global on every converted save this
    module has ever produced (X/Y/facing/current-map are unaffected --
    they're explicitly overridden after the copy -- but everything else in
    the 52-byte block was wrong). See `full-game-restoration-plan.md`
    § "Phase 6" subsection 12 for the full evidence chain (byte-for-byte
    comparison of the wrong vs. real block, and why `dword` at
    block-relative +2 -- `0x46f854`, a bound `fcn.00425350`/`LoadDungeon`
    compares against a freshly-read map row/section count to compute a
    structure-placement offset -- silently read as zero either way, which
    is why this bug was invisible to the earlier position-only checks).

    **The robust fix.** The party-scalar block, the 52-byte map-offset
    table, and the 2-byte pending-event count are always the LAST fixed-
    size regions in the file, immediately followed by `pending_count * 12`
    bytes of scheduled-event records and nothing else (`fcn.00426390`,
    file+0x4267a4 onward) -- regardless of how long the variable-length
    character records were. So this walks backward from EOF assuming a
    small pending-event count (0 is what every real save examined has),
    and self-verifies two independent invariants before accepting a
    candidate: the count field's own stored value must match the trial
    count, and the map-offset table's first entry (map 1's offset within
    `maindung.gam`) must be exactly 0 -- true in every real save in this
    project's corpus (Phase 6, "13-slot table triple-confirmed, zero
    deviation"). Both checks passing is strong enough evidence to trust
    the result without needing to replicate `fcn.00426390`'s recursive
    item-chain parser (`fcn.00425120`) by hand.
    """
    n = len(dos_template)
    for pending_count in range(0, 64):
        count_field_pos = n - 2 - 12 * pending_count
        if count_field_pos < HEADER_BYTES:
            continue
        actual_count = struct.unpack_from('<H', dos_template, count_field_pos)[0]
        if actual_count != pending_count:
            continue
        table_start = count_field_pos - OFFSET_TABLE_BYTES
        block_start = table_start - PARTY_SCALAR_BYTES
        if block_start < HEADER_BYTES:
            continue
        map1_offset = struct.unpack_from('<I', dos_template, table_start)[0]
        if map1_offset == 0:
            return block_start
    raise ValueError(
        'charsave: could not locate the party-scalar block in the DOS '
        'template file (no pending-event count / map-offset-table[0]==0 '
        'combination self-verified) -- is this a real char%d.dat?')


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

    # 2. 4 character records. The equipment/spell-state span (core
    #    0x42-0x70, see EQUIP_STATE_BASE) is templated per-class from the
    #    DOS reference file's own real characters, not transformed from the
    #    Amiga source -- see `_dos_template_cores`.
    template_cores = _dos_template_cores(dos_template)
    for rec in parsed['records']:
        template_core = (template_cores[rec['slot']]
                          if rec['slot'] < len(template_cores) else None)
        out += build_dos_record(rec['slot'], rec, template_core)

    # 3. 52-byte party-scalar block: safe defaults from the reference save,
    #    current map overridden with the real extracted value. Position
    #    AND facing are ALSO overridden, but only when the target map isn't
    #    1 -- `char1.dat`'s own default position is the DOS demo's real,
    #    live-tested-working map-1 entrance, strictly better than any
    #    heuristic pick; for any other map, that same default is real, but
    #    wrong-map geometry (see `_pick_start_cell`), so this replaces it
    #    with a real landmark cell (immediately in front of a Stairs Up
    #    structure, facing it -- see `_pick_start_cell`'s docstring) from
    #    the TARGET map's own data when available.
    #
    #    block_start is located via `_locate_template_party_scalar_block`,
    #    NOT `HEADER_BYTES + 4 * DOS_RECORD_BYTES` -- that forward formula
    #    only holds for an all-zero-item template (this converter's own
    #    output), not a real played save like `char1.dat`, whose actual
    #    per-character records are longer (data-dependent on real starting
    #    items). Using the forward formula here was a real, previously-
    #    undiscovered bug: see `_locate_template_party_scalar_block`'s
    #    docstring and `full-game-restoration-plan.md` § "Phase 6"
    #    subsection 12.
    block_start = _locate_template_party_scalar_block(dos_template)
    block = bytearray(
        dos_template[block_start:block_start + PARTY_SCALAR_BYTES])
    struct.pack_into('<H', block, CURRENT_MAP_REL_OFFSET,
                      parsed['current_map'])
    if parsed['current_map'] != 1:
        cell = _pick_start_cell(parsed['current_map'], bcdfs_path=bcdfs_path)
        if cell is not None:
            x, y, facing = cell
            struct.pack_into('<H', block, X_REL_OFFSET, x)
            struct.pack_into('<H', block, Y_REL_OFFSET, y)
            struct.pack_into('<H', block, FACING_REL_OFFSET, facing)
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

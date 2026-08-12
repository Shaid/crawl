# Investigation: msg.dbs text, scenario.dbs monster/item data, .PIC-monster mapping

Working notes for a focused follow-on pass building on
`docs/wizardry6/amiga/data-structure.md` (the source of truth for
everything already confirmed there — this file only records *new*
findings and paths tried; do not restate confirmed facts from the main
doc here beyond what's needed for context). A human will merge anything
durable from this file into the main doc.

---

## Target 1: `msg.dbs` text extraction — SOLVED

**Status: confirmed.** All 724 messages decode to legible English (plus
internal lowercase script tokens). Verified extractor:
`tools/wizardry6/decode-msg-text.ts`. Output:
`public/assets/wizardry6/amiga/data/messages.json`.

### The fix

The main doc's open question was msg.hdr field B's role, framed as
"blocking knowing where each message's byte stream ends." That framing
turned out to be based on two wrong premises, both corrected here:

1. **Field A is not the msg.dbs byte offset.** It's a separate,
   monotonically increasing lookup key (see "Field A" below) — a red
   herring for extraction purposes, despite the main doc's "confirmed"
   label on it being a byte offset (that confirmation was really just
   "monotonic and in-bounds," which field A shares coincidentally with
   several different quantities in this file).
2. **The real msg.dbs byte position is `(C & 0xFF) * 1024 + B`**, not `A`
   and not `B` alone. `msg.dbs` is exactly 80 pages of 1024 bytes
   (81920 = 80*1024); `B` is a page-relative offset (0-1021 observed,
   always < 1024) and `C`'s low byte is the page number (0-79,
   confirmed by grouping all 724 records by `C & 0xFF` — every group's
   max `B` stays under 1024, and the 80 page numbers exactly cover
   0-79 with no gaps or out-of-range values, matching msg.dbs's real
   page count exactly).
3. **There's a second header byte at `offset+1`** the Huffman driver
   itself doesn't read (it only reads the length byte at `offset+0` and
   then treats `offset+1` as the first bitstream byte) — but the actual
   on-disk data has a genuine second byte between the length and the
   bitstream that must be skipped. Empirically, that byte's value tracks
   proportionally with the decoded length (e.g. L=15 -> byte=24, L=24 ->
   byte=38), consistent with it being a **compressed byte count**
   (informational for extraction — the tree walk is self-terminating on
   the decoded-length counter and never needs it — but very plausibly
   the same field `Bane`'s CODE+0x8c4-0x90c position-computing loop
   consumes when walking message-to-message within a page,
   `pos += table[pos] + 1`; that loop was traced far enough to motivate
   this guess but not far enough to fully confirm it — see "Still open"
   below).

Final per-message layout at `msg.dbs[(C&0xFF)*1024 + B]`:

| Offset | Size | Field |
|---|---|---|
| +0 | 1 | decoded character count `L` |
| +1 | 1 | compressed byte count (not needed to decode) |
| +2.. | | Huffman bitstream (misc.hdr tree, MSB-first per byte, `Bane` CODE+0x2a8a-0x2ad0 algorithm), tree-walked once per output byte until `L` bytes produced |

### How this was found

Three hypotheses were tried in sequence, each producing partial but
insufficient legibility, which is why this was pursued to completion
rather than escalated (the pattern — self-syncing garbled prefixes with
genuinely correct English fragments further in — was diagnostic enough
to keep narrowing rather than needing a fresh model's perspective):

| Approach | Result | Why it fell short |
|---|---|---|
| Decode from `msg.hdr` field A directly (embedded length byte at `dbs[A[i]]`, bitstream at `A[i]+1`) | Partial: `CHEMIST` (7 chars) decoded perfectly inside message 0, `WHICH ITEM?`/`TRADE GOLD`/`SLEEP`/`PARALYZE` etc. legible as substrings across the corpus (~99% printable-ASCII, but heavily interspersed with garbage — a misleadingly high ratio for what was actually wrong data) | Field A is not a msg.dbs offset at all (see below); occasional legible runs were the well-known Huffman-bitstream self-resynchronization property coincidentally landing on real code boundaries mid-message, not a working decode |
| Decode from field B as a flat (non-paged) byte offset | Better: recognisable words/phrases (`INVOKE THE PO`, `WEAPO`, `RENAME CH`) but still consistent leading-garbage-then-real-text per message, and the structural check ("do decoded byte-ranges tile msg.dbs with zero gaps between consecutive B values, like the confirmed `.PIC` directory invariant") failed badly (474/482 mismatches) | Field B resets per page (confirmed via a -971 discontinuity at record index 11 lining up exactly with `C`'s low byte changing from 0 to 1) — a flat interpretation is only accidentally close for early low-page-number records |
| Decode from `(C&0xFF)*1024 + B`, embedded length at that offset, bitstream at `offset+1` | Structural mapping now airtight (724/724 unique offsets, zero collisions; `C&0xFF` spans exactly 0-79 matching msg.dbs's real 80 pages) but decode still showed a short garbled prefix on nearly every message | Off-by-one-byte bitstream start (see fix #3 above) |
| Same offset formula, bitstream starts at `offset+2` | **Clean.** Tested against ~30 messages by hand (`INVOKE THE POWE[R]`, `RENAME CHAR[ACTER]`, `SELECT NEW CHARACTE[R]`, `WARNING! THIS CHARACTER`, `YOU ARE NOT ADVANCED E[NOUGH]`, `YOU ARE NOT ELIGIBLE`, `APPROACHING THE GATE WI[TH]`, `YOU ARE IN THE ENTRANC[E]`, `XORPHITUS IS A POWERFUL WIZARD`, `THE CAPTAIN TOOK HIS BELOVED`, plus internal tokens `^_ouch_^`, `who_drinks`, `disk_options`), then full-corpus: 724/724 messages, 90.7% printable-ASCII characters (remainder is legitimate embedded control-code sequences and a handful of records that are pure control-code runs, not corruption — see below) | — |

### Field A — what it actually is (not fully resolved, not needed for extraction)

Traced `Bane` CODE+0x730: a **binary search** over `msg.hdr`'s 724
records, keyed on field A, matching a query value `Q` against
`[A[mid], A[mid] + C_hi[mid]]` where `C_hi` is the *high* byte of field
C (0-113 observed — distinct from the low byte used for paging above).
This means field A is a **lookup key range start**, and `C`'s high byte
is that range's width — almost certainly a mechanism for mapping a much
larger space of in-game "message trigger IDs" (up to ~18950) onto the
724 actually-stored text records, letting many related IDs (e.g.
consecutive item/spell IDs needing similar template text) share one
stored string. This is a reasonable, code-confirmed *shape* but the
semantic (what exactly the trigger IDs are — item IDs? event IDs?
UI-context codes?) was not pursued further since it isn't needed to
extract the text itself. Flagged as a lower-priority future item if
someone wants to reconstruct a message-ID -> use-site mapping.

The caller chain traced: `Bane` CODE+0x9ae (message-display entry point,
takes a message-lookup value + destination buffer) -> CODE+0x872
(resolves the record via CODE+0x730's binary search, then walks forward
within the page using the position-computing loop mentioned above) ->
CODE+0x2a60 (the Huffman driver itself). CODE+0x2a60 has exactly 2
call sites in the whole binary (CODE+0x9a0 and CODE+0xb4e — the second
not traced, presumably a near-identical sibling call site for a related
text-display path).

### Still open (does not block the extraction, flagged for completeness)

- The exact mechanics of CODE+0x8c4-0x90c's position-computing loop
  (`localB = localB + table[localB] + 1`, iterated `PARAM - fieldA`
  times) were not fully nailed down — plausible reading above (it
  re-derives a page-relative byte position by walking past preceding
  messages' compressed lengths, hence needing the `offset+1`
  "compressed byte count" byte this extractor also uses, just skips
  over), but not proven with a byte-exact disassembly trace end to end.
  Doesn't matter for extraction since the direct `(C&0xFF)*1024+B`
  formula was independently confirmed structurally (zero collisions,
  page range matches exactly) and empirically (legible text).
- Field A's exact real-world meaning (what "trigger ID" namespace it
  indexes) is unresolved, per above.
- A handful of messages (e.g. index 133) decode to pure repeating
  control-byte runs (`\x01\x02\x02\x02...`) rather than text — these
  are very likely legitimate non-text records (padding/reserved slots,
  or control-code-only templates) rather than decode failures, since
  the offset-uniqueness and length-byte-driven termination both check
  out cleanly for them same as every other record. Not chased further.

### Verification evidence

- Huffman tree structural sanity: node 0 = `(-1, -7)` (both children
  internal), node 1 right-child = ASCII 0x20 (space), node 3 =
  `(69, 84)` = `('E','T')`, node 5 = `(65, 79)` = `('A','O')`, node 6 =
  `(83, 78)` = `('S','N')` — i.e. the shortest codes resolve to
  `E, T, A, O, N, S` in classic English letter-frequency order, strong
  independent confirmation the tree itself (misc.hdr, already
  "confirmed" in the main doc) really is being walked correctly here.
- 724/724 messages decoded, 724/724 unique `msg.dbs` byte offsets
  (zero collisions) via `(C&0xFF)*1024+B`.
- 90.7% printable-ASCII characters across all decoded output (13,171
  total decoded characters); 301/724 messages contain at least one of a
  small manually-chosen English keyword list (`CHARACTER`, `WHICH`,
  `ITEM`, `WEAPON`, `ARMOR`, `SPELL`, `CANCEL`, `INVOKE`, `TRADE`,
  `GOLD`, `YOU`, `THE`, `ARE`, `NOT`) — a conservative lower bound since
  many short fragments (`HUMAN`, `MALE`, `FIRE`, `SWING`, `BLOCK`,
  `SILENCE`) don't contain any of those specific words but are still
  obviously real English/game vocabulary.
- Full continuous multi-word sentences recovered, e.g. "YOU HAVE
  DEFEATED ", "XORPHITUS IS A POWERFUL WIZARD, O[...]", "THE CAPTAIN
  TOOK HIS BELOVED, W[...]", "APPROACHING THE GATE WI[TH]", "YOU ARE IN
  THE ENTRANC[E]", dungeon-flavour-text runs ("PILES OF ROTTED
  FURNI[TURE]", "A FEW REMNANTS OF BRO[KEN...]", "ONLY DUST AND COBWEBS
  ", "BARE STONE SHELVES LI[NE...]").

### Files written

- `tools/wizardry6/decode-msg-text.ts` — extractor (self-contained;
  Huffman tree + record parsing + decode all inline, per this task's
  scope which asked for exactly one new tool file here)
- `public/assets/wizardry6/amiga/data/messages.json` — 724 decoded
  messages, each with `index, a, b, c, page, offset, text,
  decodedLength, compressedLength`

---

## Target 2: `scenario.dbs` monster/item/spell data

**Status: monster catalog confirmed (names); item table confirmed
(names + price); full stat-field semantics open.** Verified extractor:
`tools/wizardry6/decode-scenario-monsters.ts`. Output:
`public/assets/wizardry6/amiga/data/monster-mapping.json`. Only the
monster catalog was exported to an asset file (per this task's file-
naming constraints — see "Item table" below for why that finding wasn't
also exported).

### Monster table — confirmed structure, names legible

`scenario.dbs` bytes `0x154e8`-`0x22db4` (87272-142804, 55500 bytes) are
a **fixed-stride table: 250 records of 222 bytes each**.

Found via the technique this agent's Method section recommends for
"strings found scattered through a region with no known table structure
yet": histogrammed the gaps between consecutive name-like-string start
offsets across the whole 55500-byte span. Two gap values dominated
overwhelmingly: **16 bytes** (434 occurrences — the stride *within* one
record's 4 name slots) and **174 bytes** (95 occurrences — the gap from
a record's last name slot to the next record's first). `3*16 + 174 =
222`, the record stride. `55500 / 222 = 250.0` exactly — no remainder.

**Structural cross-check**: this section's start and end offsets
(`0x154e8` = 87272, `0x22db4` = 142804) are **byte-exact matches to two
of the nine offset values in `disk.hdr`'s own directory** (main doc
§6.5, previously undecoded: `0x000154e8 (87272)` and `0x00022db4
(142804)`). This means `disk.hdr`'s directory is (at least in part) a
**section table for `scenario.dbs`** — see "disk.hdr cross-reference"
below for the second confirmed pair.

Record layout (first 64 bytes confirmed; remaining ~154 bytes open):

| Offset | Size | Field | Confidence |
|---|---|---|---|
| +0 | 16 | singular display name, NUL-padded | confirmed (legible) |
| +16 | 16 | plural display name, NUL-padded | confirmed (legible) |
| +32 | 16 | singular "category" name, NUL-padded | confirmed (legible), semantics hypothesis |
| +48 | 16 | plural "category" name, NUL-padded | confirmed (legible), semantics hypothesis |
| +64 | 4 | BE u32, small round-ish increasing value | hypothesis (XP award?) |
| +68 | ~154 | undecoded stat block | open |

Names read as unmistakable, real Wizardry 6 bestiary entries across the
whole table: `RAT, GIANT RAT, BAT, HUGE BAT, VAMPIRE BAT, CREEPING VINE,
FUMING VINE, STRANGLER VINE, ROGUE, BUSHWACKER, ROGUE LEADER, GIANT
SERPENT, ZOMBIE, BLACK BAT, SCALLYWAG, BRIGAND, PIRATE, KILLER RAT,
RABID RAT, JUNGLE VINE, SLIME, POISON SLIME, HYDRA PLANT, DUNGEON LEECH,
ROTTING CORPSE, ZOMBIE BONES`, plus named unique bosses/NPCs
(`XORPHITUS, QUEEQUEG, CAPTAIN MATEY, L'MONTES, AMEN-TUT-BUTT`). 183 of
250 slots have a legible name; the other 67 are entirely zero in all 4
name slots — almost certainly unused/reserved roster capacity (the same
trailing-blank-slot convention already confirmed for `msg.hdr` and the
`.PIC` directory elsewhere in this corpus, not a decode failure).

The "category name" fields (+32/+48) are the standout finding for
Target 3: for a plain monster the category equals its own name (`RAT` /
`RAT`), but for **variant/reskinned monsters it names a different, base
monster** — `BUSHWACKER`'s category is `ROGUE`, `ZOMBIE`'s category is
`STINKING CORPSE`, `HUGE BAT`/`VAMPIRE BAT`/`BLACK BAT` all categorize
under plain `BAT`. This is exactly the kind of field a "which sprite
set does this monster render with" selector would need — very likely
the missing link to Target 3 (which `mon##.pic` file / cel group a
monster uses) — but it names a *category*, not a file number or cel
index directly, so it doesn't close Target 3 on its own; see Target 3
below for what was and wasn't tried with it.

The `+64` field (BE u32) increases roughly with monster difficulty in a
way that's suggestive of an XP-on-kill value (RAT=150, GIANT RAT=450,
BAT=99, HUGE BAT=318, VAMPIRE BAT=714, ROGUE=208, BUSHWACKER=392, ROGUE
LEADER=1315, GIANT SERPENT=9131) — plausible in *shape* (round-ish,
monotonic with apparent danger) the same way the confirmed class-XP
tables at the start of this file are, but **no external oracle**
(published bestiary, strategy guide, wiki) was checked against it this
pass, so it's recorded as `xpGuess` in the asset and labelled hypothesis
only, not confirmed.

The remaining ~154 bytes/record (visible as `statBytesHex` in the
output asset) almost certainly hold HP, AC, attack lists, resistances,
and spell lists, plus whatever field ultimately selects the `.PIC` file
— not decoded this pass. A quick scan for a single byte in the 0-58
range (`mon00.pic`-`mon58.pic` file-index range) at a fixed record
offset across many records did not turn up an obvious candidate in the
time available; this needs either more careful multi-record
cross-referencing or a disassembly trace of whatever code reads a
monster record before calling the `MON%02d.PIC` loader (main doc §1.1's
6 call sites) — not attempted this pass.

### Item table — confirmed structure and names, not exported

`scenario.dbs` bytes `0x380`-`0x9408` (896-37896, 37000 bytes) are a
**fixed-stride table: 500 records of 74 bytes each**, immediately
following the confirmed class-XP tables (main doc §7.1). Found the same
way as the monster table (stride confirmed by the first ~164 records'
name field being clean printable ASCII at a consistent 74-byte spacing;
the scan runs the rest of the way to `0x9408` before the record shape
genuinely breaks down into what looks like embedded sprite/bitplane-like
data, not text records).

**disk.hdr cross-reference (second confirmed pair)**: `0x380` (896) and
`0x9408` (37896) are *also* byte-exact matches to two more of
`disk.hdr`'s nine directory offsets (`0x00000380 (896)` and `0x00009408
(37896)`) — the same directory that brackets the monster table above.
Between these two confirmed section pairs, 5 of `disk.hdr`'s 9 offsets
are now explained (the XP-table start at 0, implicitly; items
896-37896; monsters 87272-142804); the remaining offsets
(`0x0000e828`, `0x00023f74`, `0x00027174`, `0x000290b4`, `0x0002df34`)
were not investigated this pass but are a strong, ready-made lead for a
follow-on session (each is very likely another `scenario.dbs` section
boundary — one of the unexplored gaps between confirmed sections
showed sprite/bitplane-shaped byte patterns rather than text, consistent
with more embedded graphics data, not further text tables).

Record layout (partially decoded):

| Offset | Size | Field | Confidence |
|---|---|---|---|
| +0 | ~20 | item name, NUL-padded (occasionally holds two copies of a short name back-to-back, e.g. record 1 `DAGGER\0DAGGER\0...` — not understood, possibly an authoring artifact) | confirmed (legible) |
| +16 | 4 | BE u32 price in gold, round numbers | rendered (see below) |
| +28 | 4 | BE u32, plausible weight | hypothesis |
| +58 | 1 | usually `0xFF`, one observed exception `0xDF` for `LANCE` (a class-restricted polearm in most Wizardry rulesets) | hypothesis (class-allowed bitmask?) |
| +59-60 | 2 | constant `07 03` across every sampled record | hypothesis (default equip/identify flags?) |
| rest | | undecoded | open |

164 clean weapon names read directly (`DAGGER, MAIN GAUCHE, SHORT
SWORD, KATANA, LANCE, ...`) with prices that are round, monotonically
sensible-looking numbers scaling with the weapon's apparent power
(`DAGGER=15gp, MAIN GAUCHE=30gp, KATANA=400gp, LANCE=450gp`) — the same
"round decimal, structurally plausible sequence" shape this project's
Method section calls out as a strong oracle on its own (matching how
the class-XP tables were confirmed), so this is recorded as
**rendered**, one step below fully confirmed (no independent
cross-check against a manual/wiki price list was performed). Past the
gap at record 164 the strings are clearly armor/shield/accessory names
(`BRONZE CUIRASS, STUDDED HAUBERK, FULL PLATE, SILVER CROSS, DIAMOND
RING, ...`) at the same 74-byte stride, confirming the table is a
single unified item catalog (weapons + armor + accessories +
consumables), not several disjoint tables that happen to share a
stride.

**Not exported to an asset file** — this task's scope named exactly one
additional asset file (`monster-mapping.json`), so the item-table
finding is recorded here for the human merge / a follow-on session
rather than shipped as `items.json`. The extraction logic (name-slot
parsing at a fixed 74-byte stride from `scenario.dbs+0x380`) is
directly analogous to what `decode-scenario-monsters.ts` already does
for the monster table and would be a small follow-on script.

---

## Target 3: `.PIC` cel-list -> monster mapping

**Status: not reached** — the monster table's "category name" field
(above) is a strong, concrete lead (it clearly groups reskinned
monsters under a shared base name, which is exactly the kind of thing a
sprite-selection field should do), but turning that into an actual
`mon##.pic` file index + cel-index list requires either:

1. tracing the code that reads a monster record and then calls the
   `MON%02d.PIC` loader (main doc §1.1's 6 call sites at CODE+0x46a8,
   0x629a, 0x14946, 0x15e30, 0x401da, 0x5168a) back to see which
   record field supplies the `%02d` index and which supplies the
   NUL-terminated cel-index list the drawer (main doc §2.3,
   CODE+0x35e6) consumes, or
2. finding a numeric field in the monster record's undecoded
   ~154-byte stat block (see Target 2 above) that cleanly maps
   `categorySingular` names onto a small set of file indices 0-58 in a
   way consistent across the whole table.

Neither was attempted this pass — Target 2's own record fields weren't
decoded far enough to make either approach cheap, and the task's
priority ordering explicitly treats Target 3 as depending on Target 2
being substantially done first. Left fully open for a follow-on
session; the category-name field above is the concrete starting point.

---

## Paths tried (summary table for future sessions)

| Target | Approach | Result | Why |
|---|---|---|---|
| 1 | Decode using msg.hdr field A as flat msg.dbs offset | Partial legibility, self-syncing artifacts | Field A is a binary-search lookup key (CODE+0x730), not a msg.dbs offset |
| 1 | Decode using msg.hdr field B as flat msg.dbs offset | Better but still corrupted, tiling check failed 474/482 | B resets per-page; needs the page number too |
| 1 | Decode using `(C&0xFF)*1024+B`, bitstream starting right after the 1-byte length prefix | Structurally perfect offset mapping (724/724 unique) but still corrupted text | Missing a second on-disk header byte between length and bitstream |
| 1 | Same offset formula, skip 2 header bytes before the bitstream | **Confirmed correct** — clean legible English throughout | — |
| 2 | (not attempted this pass) | — | Time spent completing Target 1 fully rather than leaving 2 targets partially done |
| 3 | (not attempted this pass) | — | Depends on Target 2 |

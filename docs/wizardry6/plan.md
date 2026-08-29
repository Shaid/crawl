# Wizardry 6 — plan / session log

> **Repo move (2026-08-12):** this project was formerly its own repo at
> `~/Development/sorcery/` and was merged into this repo (crawl) under
> `docs/wizardry6/`, `tools/wizardry6/`, `data/wizardry6/` and
> `public/assets/wizardry6/`. Session prose below that says "sorcery" means
> "this project"; its `@seer-project/*` framework deps still live in
> `~/Development/seer/`. Extractors now run from the crawl root, e.g.
> `npx tsx tools/wizardry6/render-static-corridor.ts data/wizardry6/amiga`.

Format details live in `docs/wizardry6/<platform>/data-structure.md` — this
file only tracks status and next steps, never restates format facts.

## Amiga

## Session 1 (2026-08-01) — first assessment pass

Scope: survey all 117 files in `data/wizardry6/amiga/`, confirm `Bane`'s
hunk structure + get an initial function/string map, work out `.PIC`,
`.EGA`, `.hdr`, `.dbs`, `.snd` formats to whatever depth was tractable in
one pass. No prior RE work existed for this game anywhere in the seer
ecosystem — this is the origin session.

**Confirmed this session:**
- `Bane` hunk structure, no cruncher, no trailing data, SAS/C small-data
  model, filename tables, Huffman bit-tree decoder (`CODE+0x2a8a`) —
  matches `misc.hdr`'s shape exactly.
- `.PIC` container/directory format (650-byte, 25-slot table; byte-exact
  offset-partition invariant across all 60 files).
- `.EGA` full-screen images: 320x200, 4bpp, plane-major — rendered
  legible "BANE OF COSMIC FORGE" title text.
- `WFONT0.EGA`: 128-glyph 8x8 1bpp ASCII font — fully legible render.
- `msg.hdr`'s offset field (724 real records, monotonic, verified).
- `scenario.dbs`'s opening 896 bytes: 14 class XP tables x 16 levels —
  matches Wizardry 6's real 14-class roster.
- `.snd`: raw unsigned 8-bit PCM (byte-histogram evidence).

**Escalated and solved:** `.PIC` per-band pixel/bitplane layout escalated
to `re-codebreaker` after 3 well-formed hypotheses failed against the full
60-file corpus. The escalation fully solved it (`docs/wizardry6/amiga/data-structure.md`
§2): cels are standalone 8x8-tile sprites with a variable-length
tile-presence bitmask (not fixed 19-byte padding, the wrong premise that
had stalled all 3 prior hypotheses), plane-major 8x8x4bpp tiles, and a
confirmed 16-colour palette read via disassembly (`LoadRGB4` at
`CODE+0x19a8`). **Independently re-verified in this session, not taken on
faith**: reimplemented the directory/length-formula logic from the doc's
prose alone (731/731 cels match, 3,504,128 pixels, zero deviation —
reproduces the escalation's own numbers exactly); caught and fixed a real
inconsistency in the escalation's own throwaway probe script (its saved
`decode.py` had a stale palette array that didn't match its own rendered
output — resolved by cross-checking real background pixel colours in the
rendered PNGs against the disassembly-derived table, which matched
exactly). Promoted to a committed extractor:
`tools/wizardry6/pic-format.ts` + `decode-pic.ts`, writing
`public/assets/wizardry6/amiga/sprites/{credits,monsters}.png` (731 cels
total, individually named, transparent background). `tsc`/`eslint`/`vitest`
all clean; a `reviewer` pass caught one type-clarity nit (fixed) and one
real convention mismatch (atlas sidecar fields were `width`/`height`
instead of the project's stated `w`/`h` — fixed to match
`decode-font.ts`'s existing convention).

**New open item from the solve:** which specific cel-index list each
monster's stat data references at runtime (the drawer's NUL-terminated
cel-list *mechanism* is confirmed, but not the per-monster lists
themselves) — needed to know which of a monster's cels is "the" displayed
portrait vs. an animation frame/layer. Also tried applying the now-confirmed
`.PIC` palette to the `.EGA` full-screen images — inconclusive (speckled,
not clean; may be genuine period dithering or a different palette/order).

**Left open (see data-structure.md §9 for full table):** `WFONT1-4.EGA`,
`WPORT1-3.EGA`, `mazedata.ega`, `scenario.hdr`, `master.hdr`, `disk.hdr`,
`newgame.dbs` internals, `scenario.dbs` beyond the XP block, `msg.dbs`
payload extraction, `.EGA` screen palette, and the `.PIC` cel-list mapping
above.

**Housekeeping:** the `amiga-disasm` sub-agent's IRA run wrote `Bane.cnf`
into `data/wizardry6/amiga/` (the read-only original-files zone) alongside
its `Bane.asm` output at the `docs/` root. Both were moved to
`docs/wizardry6/amiga/disasm/` after the fact and `data/wizardry6/amiga/`
was re-verified back to its original 117 files. Worth remembering for
future sessions in this project: disassembly tooling defaults its output
location to wherever it's invoked from, so double-check `data/` stays
untouched after delegating to a disassembly sub-agent.

**Housekeeping:** `package.json`'s `@seer/*` dependencies were `"*"`
(unresolvable from npm) — pointed them at `file:../seer/packages/*` so
`npm install` and the new extractor scripts actually run. This assumes a
sibling `../seer` checkout, matching how this project was scaffolded;
revisit if the deploy/CI environment doesn't have that layout available
(e.g. switch to an npm workspace or published packages).

**Next steps for a follow-on session (superseded by Session 2 below where
overlapping):**
1. ~~Trace `scenario.dbs`'s monster records forward to find each monster's
   cel-index list~~ — file-index half done in Session 2; cel-list-within-file
   half still open, see `docs/wizardry6/TODO.md`.
2. Hunt for the real `.EGA` full-screen palette via a copper-list trace in
   `Bane` (the standard technique — see the agent's own Method §2) — the
   `.PIC` palette didn't transfer cleanly by direct reuse.
3. `WFONT1-4.EGA`/`WPORT1-3.EGA`: revisit with non-16-column sheet
   layouts, or find their loader in `Bane` (now that the `CODE+0x35e6`-style
   A4-jump-table method is proven for `.PIC`, the same approach likely
   resolves these too).
4. `pcfile.dbs`: decode the 289-byte character record fields (24 records,
   record 0 already partially inspected).
5. Once `.EGA` palette and the remaining open formats are further along,
   register `exportGameData`/`buildAssets` in `seer.config.ts` and wire a
   real pipeline (currently intentionally left commented out — this was
   an assessment pass, not implementation).

**Note**: items 2-3 above were already resolved by the five parallel
investigation passes merged into `data-structure.md` before Session 2
started (see that doc's §3.1, §5.2, §5.3) — this list wasn't kept in sync
at the time. See `docs/wizardry6/TODO.md` for the current, single, accurate
list of open items going forward.

## Session 2 (2026-08-01) — cel-mapping, scenario.dbs sections, newgame.dbs

Scope: four targeted follow-ups on top of the fully-merged corpus doc —
(1) `.PIC` cel-list → monster mapping, (2) `scenario.dbs`'s remaining
sections 2/3/5/6/7/8/9, (3) `newgame.dbs`'s ~49KB post-header body, (4)
`.EGA` screen trailing 768 bytes (lowest priority, not revisited — already
exhaustively covered in the merged doc's §3.2).

**Confirmed this session:**
- **`.PIC` file → monster mapping** (`data-structure.md` §2.6/§7.1):
  monster record offset **+209** is the `mon##.pic` file index (0-58).
  Found two independent ways (a category-grouping statistical scan across
  all 154 undecoded stat-block bytes, and a disassembly trace from
  `CODE+0x16042` through `CODE+0x15cf2`'s `MON%02d.PIC` filename builder)
  that converge on the same byte, then cross-checked visually: 5/5
  spot-rendered monsters (RAT/BAT/GIANT SERPENT/HUGE SPIDER/ZOMBIE) show
  species-correct art at their `picFileIndex`. A companion field at +210
  is a hypothesis only (conditionally read, role undetermined). The
  *cel-index-list within the file* (vs. just which file) remains open —
  traced to a runtime-built per-combat-slot struct, not a static record
  field; see the TODO.
- **`scenario.dbs` section 9** (`data-structure.md` §7.1): confirmed as a
  chained offset+length directory (34/39 active records match the same
  invariant already confirmed for the `.PIC` and `mazedata.ega`
  directories elsewhere in this corpus) — but the 277,826-byte blob it
  partitions doesn't match any file in this corpus by size; left open.

**Ruled out this session (saves a future session from repeating):**
- `scenario.dbs` sections 2/3: not bitplane graphics (rendered as noise
  at 5 widths) and not Huffman-compressed text (decodes to
  `ETAONS`-dominated garbage through the confirmed tree) — genuinely
  undecoded numeric data, 16-record count doesn't match any known
  Wizardry 6 roster count.
- `scenario.dbs` sections 5/6/7/8: cross-referencing every `u16` field
  against `msg.hdr`'s field-A values and its own computed `msg.dbs`
  offsets both came back at noise/baseline level — refuted, not just
  unconfirmed.
- `newgame.dbs`'s post-header body is not a copy of/overlapping with
  `scenario.dbs`'s later sections (a striking-looking 1346-byte prefix
  match turned out to be shared zero-padding plus one boilerplate
  placeholder record, not a real relationship — quantified: 42.2% raw
  byte match collapses to 1.2% once shared zero-padding is excluded) and
  is not a flat array of `pcfile.dbs`-style 432-byte character records
  (`49442/432` isn't an integer). A second `"SAVEGAME.DBS"` string
  reference in the binary (`CODE+0x13774`) leads to party-roster
  window/UI code, not a file loader.

**Files written:**
- `tools/wizardry6/decode-scenario-monsters.ts` — extended with
  `picFileIndex`/`picFile`/`picFileIndexSecondary` fields.
- `tools/wizardry6/decode-scenario-section9.ts` — new, writes
  `public/assets/wizardry6/amiga/data/scenario-section9-directory.json`.
- `docs/wizardry6/amiga/data-structure.md` — §2 (new §2.6), §7.1, §7.2,
  §9 confidence table updated.
- `docs/wizardry6/TODO.md` — new, single open-work index for this game
  (see below for the delta).

**Left open (see `docs/wizardry6/TODO.md` for the authoritative,
up-to-date list):** `.PIC` cel-index-list-within-file, `scenario.dbs`
sections 2/3/5/6/7/8, `scenario.dbs` section 9's target blob,
`newgame.dbs`'s body, `.EGA` trailing bytes, `mazedata.ega` compose-list
semantics, `WFONT`/`WPORT` per-tile/per-portrait naming, `msg.hdr` field
A, `master.hdr` categories 10-19, item/monster/pcfile.dbs remaining stat
fields.

## Session 3 (2026-08-01) — dungeon-walker unblock: scenario.dbs sections 2/3, mazedata.ega compose-list consumer

Scope: two targeted sub-problems to unblock a first-person dungeon
walker — (1) test whether `scenario.dbs` sections 2/3 are the per-level
maze grid, (2) find `mazedata.ega`'s compose-list consumer (the actual
corridor renderer). Also a shallow, non-blocking check of the DOS
`wroot.exe` CS/DS segment relationship (still unresolved, not pursued
further — see below).

**Confirmed this session:**
- **`scenario.dbs` sections 2/3 are NOT the dungeon maze grid** — they
  are per-**class** (14 real records, not 16) UI-related data, most
  plausibly driving a character-creation class-selection/class-info
  screen. Disassembly-confirmed via a 14-iteration startup allocator
  (`CODE+0x4bee`-`0x4c76`) and a "select one class, copy its record into
  a scratch working buffer" access pattern (`-0x47a4(a4)` global,
  `CODE+0xb1ec`/`0x10020`/`0x71a0`). Located 3 concrete fields: `+0x1e0`/
  `+0x1ec` (screen-position offsets) and `+0x43a` (a `(row,col)`-indexed
  bitmask, tested via a generic `TestBit` primitive at `CODE+0x2958`).
  This **overturns** the previous session's "16 doesn't match 14 classes"
  conclusion, which didn't check for the same "declared capacity padded
  with all-zero unused slots" convention already established elsewhere in
  this corpus — records 14/15 in both sections are genuinely all-zero.
  See `data-structure.md` §7.1's correction block.
- **`ReadSection`'s real address corrected**: `CODE+0x9fc` (not
  `CODE+0xa24`, which is a leading case-dispatch block belonging to the
  same function). Also corrected a conflation in the previous session's
  call-site census: A4 entry 16 (`-0x7f9e(a4)`) is an **unrelated**
  `.PIC`-style compositor (`CODE+0x9ae`), not `ReadSection` — only entry
  17 (`-0x7f98(a4)`, `CODE+0x9fc`) is the real one. Redone census against
  the correct 47 call sites finds literal categories 1/4/5/6/7/8/9 (not
  the previously reported 1/9/11/18, which mixed in the unrelated
  function's own unrelated first argument). See `data-structure.md`
  §6.4's correction block.
- **`mazedata.ega`'s directory `offset` field is fixed up in-place at
  load time** from a file-relative byte offset to an absolute runtime
  pointer (`CODE+0x3cf6`-`0x3d10`) — a "follow the buffer past the read"
  finding. The on-disk format (already documented, byte-exact) is
  unaffected; this only matters for anyone tracing the runtime consumer.
  See `data-structure.md` §4.2's correction block.

**Escalated and solved:** `mazedata.ega` compose-list consumer, after 4
independently-shaped static-analysis approaches this session all came up
empty (global-pointer xref scan across all `d16(PC)` addressing forms,
shared-blit-entry caller census, magic-number scan, absolute-addressing
scan — see `data-structure.md` §4.4's paths-tried table). Escalated to
`re-codebreaker` with a fully self-contained brief; **solved**: the
consumer is `DrawMazePiece` at `CODE+0x3d72`-`0x40cc`, a module-local
static function (not an A4 jump-table entry, which is exactly why the
entry-57/58 caller census missed it) reached from 50 call sites via
plain `jsr d16(pc)`. It also **corrected two of this session's own
compose-list field readings**: `+0` (not `+1`) is the directory index
(all 153 directory values are referenced, a far stronger signal than
`+1`'s 26 distinct values), and `+1` is a signed destination-X byte
(`0xFF` is an ordinary `-1`, not a sentinel) — the "nothing to draw"
condition is `+4 == 0` (49/366 records), not the old `0xFF`-on-`+1`
reading. Root cause of the miss: the renderer reads the compose-list's
*base* pointer (a second, previously-unlocated global at `CODE+0x1732`,
not the `CODE+0x1690` maze-buffer pointer this session was scanning for)
via `ADD.L d16(PC),Dn`/`ADDA.L d16(PC),An` — an opcode family this
session's census didn't include (a `narrow-opcode-form-census-false-negative`
instance). **Independently re-verified, not taken on faith**: re-ran
`decode-maze.ts` against the real `mazedata.ega` and got the escalation's
own reported result verbatim ("compose-list renderer invariants ... hold
with zero deviation across 317/366 drawn records"); independently
recomputed the bit-reversal table claim in Python (256/256 exact
`reverse_bits` match); independently recomputed the `+0`/`+1`/`+4` field
distributions directly from the raw file (all match the escalation's
numbers exactly: `+0` covers all 153 values, `+1` has 26 distinct raw
values, `+4==0` for 49/366); independently confirmed the `CODE+0x1732`
pointer-store instruction (`LEA d16(PC),A0; MOVE.L D1,(A0)` at
`CODE+0x3c8a`) resolves to that exact address by hand-decoding the raw
bytes; independently found `ADD.L Dn,d16(PC)` opcodes targeting
`CODE+0x1732` inside the claimed `CODE+0x3d72`-`0x40cc` range via a fresh
byte scan (found 3 sites, in the same function neighbourhood as the
escalation's cited addresses though not byte-identical citations);
independently confirmed the `CMPI.W #-1,0xc(a5)` dispatch check
(`dstIndex == 0xFFFF` -> direct path) sits right after the function's
`link.w a5`/`movem.l` prologue, matching the claimed signature.
`npx tsc --noEmit` and `npx eslint` both re-run clean.

**Still open:**
- **Dungeon-level geometry's actual location is an open question
  again** — refuting sections 2/3 removes the strongest untested lead
  from the previous session, but the escalation's solve gives a new one:
  the per-cell dungeon dispatcher is now located at `CODE+0x9b58` (args:
  depth, lateral column, wall-type code, 4 compose-list base indices);
  tracing *its* callers backwards is the natural next step (see
  `mazedata-corridor-call-args` in `docs/wizardry6/TODO.md`).
- Briefly checked `wroot.exe`'s entry-point startup code for the CS/DS
  segment relationship flagged as a blocker in `dosega/data-structure.md`
  §6.5 (`MOV CS:[0x4070],DS` at file offset ~0x4272 saves DS into a
  fixed CS-relative slot early in a C-runtime startup stub) — did not
  resolve the blocker, not pursued further this session (flagged as
  optional in the task brief; the Amiga static-analysis route above
  remains the primary path).

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — §4.2, §4.4, §4.5, §6.4,
  §7.1, §9 updated/corrected (see correction blocks in each); §4.4
  subsequently promoted from hypothesis to confirmed by the escalation.
- `docs/wizardry6/amiga/investigations/mazedata.md` — Session 2 addendum,
  then a Session 3 addendum from the escalation.
- `docs/wizardry6/TODO.md` — updated (see delta in the final report).
- `tools/wizardry6/decode-maze.ts` — updated by the escalation:
  `MazeComposeRecord` fields renamed to the confirmed semantics
  (`dirIndex`/`destXByte`/`destY`/`srcClip`/`widthBytes`), new
  `verifyComposeListInvariants()` exported and wired into `main()`.
  Re-run independently this session, output reproduced exactly.
- `public/assets/wizardry6/amiga/maps/mazedata-composelist.json` —
  regenerated with corrected field names.

## Session 4 (2026-08-01) — `CODE+0x9b58` caller trace: exhaustive negative result, escalated

Scope: trace `CODE+0x9b58`'s callers to find the per-cell dungeon geometry
source (`dungeon-level-geometry-location`/`mazedata-corridor-call-args`).

**Confirmed this session** (all via the exhaustive `d16(PC)` displacement-scan
method that solved §4.4 in Session 3, applied to a custom capstone-based
disassembler script this time rather than radare2/IRA):

- `CODE+0x9b58` is a much larger function than previously characterized
  (body extends to ~`CODE+0xa3a0`, reads at least 9 baseIndex-shaped
  arguments `0x12`-`0x2a(a5)`, not just the 4 documented in §4.4).
- Pinned down the exact push-order convention for `DrawMazePiece` call
  arguments (`dstIdx` first push, `mode` second, `srcIdx` last push before
  `jsr`), cross-checked against the confirmed "20↔16 mirrored pair" calls.
- Found `9b58`'s 5 callers, all inside one large renderer function
  (`CODE+0xa72c`-`0xb25e`).
- Found a second near-duplicate dispatcher (`CODE+0xa3b0`), a deferred-draw
  mechanism (`CODE+0x9a52` writes 12-byte records into a 30-slot array at
  `-0x2c12(a4)`, consumed by a loop at `CODE+0xaffa`-`0xb142`), and — new
  this session — a monster/NPC-token placement overlay that reuses the same
  `-0x2c12(a4)` array with a different field layout, calling the confirmed
  `.PIC` cel compositor (§2.3) rather than `DrawMazePiece`.
- **Exhaustively traced every data-dependent branch reachable from
  `CODE+0x9b58` (both its own callers and its own callees) and found no
  per-cell (X,Y-indexed) wall/door/floor-type array anywhere.** Every
  conditional resolves to: pure position/facing-parity arithmetic (no memory
  read), the already-ruled-out `scenario.dbs` section-2/3 class buffer
  (`CODE+0xa810`'s `TestBit` call against `-0x481e(a4)+0x43a` — confirmed via
  an exhaustive search finding exactly one non-clearing writer to that
  pointer, at the chargen function `CODE+0x1000c`-`0x100d2`), or static
  lookup tables with zero located writers anywhere in the 351 KB CODE hunk
  (`-0x2c65(a4)`, `-0x3adc(a4)`/`-0x3aaa(a4)`, `-0x7c5e(a4)`/`-0x7c6e(a4)`).
  The main `DrawMazePiece` backdrop calls turned out to use **entirely
  immediate compose-list-index constants**, gated by per-depth flags that
  default to always-1 (`CODE+0xa892`).

**Working hypothesis (evidenced, not proven):** the Amiga corridor renderer
draws a fixed, non-cell-content-driven backdrop — the same compose-list
pieces at every render, selected only by static tables and player
position/facing parity — with per-cell dungeon data (if it affects the
first-person view at all) limited to two independent overlays (a
class-conditional status-icon bar; the newly-found monster/NPC token
placement) neither of which reads a maze grid either.

**Escalated:** `dungeon-level-geometry-location` escalated to
`re-codebreaker` with the full call-graph trace as evidence, asking it to
either confirm/refute the "static backdrop" hypothesis or find the actual
per-cell geometry source (which may live entirely outside the rendering
call graph — e.g. in movement-blocking logic, a not-yet-traced automap
system, or a genuinely separate function this session's traces didn't reach).

**Escalation result: SOLVED, hypothesis refuted.** The escalation found the
real evaluator functions — `CODE+0x9202`/`0x969a`/`0x9876` — as **siblings**
of `CODE+0x9b58`, called directly from the outer renderer's depth loop
(`CODE+0xaa4a`-`0xaaf4`) at the same call depth as `9b58`, not reachable
from `9b58` in either direction — exactly why the exhaustive bidirectional
trace above (sound in method, incomplete in scope) missed them. They read
real per-cell wall/feature data from `scenario.dbs` **section 2**, which
**is** the per-level dungeon maze geometry (14 levels, 1346 bytes each,
covering a 256×256 coordinate space via 12 fixed 8×8-cell regions).

This directly overturns this doc's own earlier "sections 2/3 are per-class
UI data, refutes the dungeon-geometry hypothesis" conclusion from Session
3: `-0x47a4(a4)` (read there as "selected class slot 0-13") is actually the
**current maze level index** (confirmed via a `SetLevel` function at
`CODE+0x103f0` and two scripted level-transition sites), and
`CODE+0x1000c`-`0x100d2` (read there as a chargen "copy selected class
record" routine) is `LoadLevel`. Every individual byte-level fact Session 3
traced (the 14-iteration allocator, the `CopyMem` access pattern, the
`+0x1e0`/`+0x1ec`/`+0x43a` field offsets) turned out to be accurate — only
the *domain* inference was wrong, a textbook instance of two independently
plausible interpretations sharing the same underlying bytes.

**Independently re-verified in this session, not taken on faith**:
reimplemented the bit-field extraction (LSB-first, matching the game's own
`GetBitField` primitive), the 13-field record partition, the
region-placement invariant, and both cross-file byte comparisons from the
escalation's prose alone (not its scratchpad scripts) — every reported
number reproduced exactly: 13-field partition exact (0..1346, zero
gap/overlap); region-placement invariant 0 overlapping cells across 14
levels × 12 regions × 64 cells = 10,752 placements; wall-plane/feature-code
histograms identical to the escalation's own numbers; **0/17,464
mismatched bytes** across all 8 geometry fields between this Amiga file and
the DOS/EGA release's `scenario.dbs` (cross-platform oracle); **0/43,204
mismatched bytes** between `scenario.dbs` sections 2/3 and `newgame.dbs`'s
first 43,204 bytes (confirming `newgame.dbs` is the initial mutable maze
state copied to `SAVEGAME.DBS` at "new game" — a bonus solve beyond the
original question). Rendered all 14 levels as top-down maps: recognisable
dungeon architecture throughout (rooms, corridors, doors, secret walls),
including an independently-confirmed left-right mirror-symmetric room
cluster on level 9, matching the escalation's own visual read.

Promoted to a committed extractor: `tools/wizardry6/decode-scenario-maze.ts`
(writes `public/assets/wizardry6/amiga/maps/maze-level00.png`-`maze-level13.png`
+ `maze-levels.json`, re-runs the region-placement and `newgame.dbs`
cross-check invariants on every run). `npx tsc --noEmit`/`npx eslint` both
clean; a `reviewer` pass found no issues.

**Still open** (new items from the solve, see `docs/wizardry6/TODO.md`):
value→meaning for the 2-bit wall planes and 16 feature codes (rendered
guess only); the unread `+0x000` plane, `+0x438` scalar, and three
per-region word arrays in section 2; section 3's full field semantics
(structure confirmed, a 144-entry per-level entity/monster/trigger table);
which wall plane is which compass direction; `newgame.dbs`'s remaining
trailing 6238 bytes (likely party/roster state, separate from the
now-solved maze-level region).

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — new §4.6 (full call-graph
  trace, confidence-labelled, with a paths-tried table) and new §4.7 (the
  confirmed maze-level format, escalation result); correction blocks added
  to §4.5 and §7.1 (not silently overwritten — see each for the
  superseded prior conclusion, per this project's documentation
  convention).
- `docs/wizardry6/amiga/investigations/mazedata.md` — Session 4 addendum
  with address-by-address detail (disassembly listings for `CODE+0x9a52`,
  the consumer loops, the outer renderer function) plus an escalation-
  results addendum with the full independent-verification writeup.
- `tools/wizardry6/decode-scenario-maze.ts` — new verified extractor.
- `public/assets/wizardry6/amiga/maps/maze-level00.png`-`maze-level13.png`,
  `maze-levels.json` — new assets.
- `docs/wizardry6/TODO.md` — `mazedata-corridor-call-args` and
  `dungeon-level-geometry-location` resolved/deleted; replaced with
  `maze-plane-semantics` and `scenario-section3-fields`;
  `newgame-dbs-body` narrowed to `newgame-dbs-trailer` (6238 bytes, down
  from ~49KB).

## SNES

## Session 1 (2026-08-01) — first assessment pass

Scope: survey the newly-landed `data/wizardry6/snes/` corpus (a single
3 MB `.sfc` ROM, Japan-only Super Famicom release), work out the ROM
header/memory map, CPU entry points, and as much of graphics/text/audio/
game-data-table structure as tractable in one pass. No prior RE work
existed for this platform anywhere in the seer ecosystem, and no public
disassembly/romhacking project was found for this specific release
(`WebSearch` checked) — this is the origin session, same as the Amiga
port's session 1 was. Nothing about the Amiga port's *file formats* or
codecs carried over (different CPU, different toolchain) — it was used
only as a game-content oracle (class roster, monster names).

**Confirmed this session:**
- ROM header at file `0x7FC0`, LoROM+FastROM, no copier header, checksum
  validates; the 4096 KB declared vs. 3072 KB actual size is the standard
  power-of-two-Mbit rounding convention, not a truncated dump.
- Reset vector (`$00:8000` = file `0x0000`) hand-traced through the
  standard SNES boot sequence to the point RESET calls the SPC700-upload
  routine once and then spins forever in an NMI-driven idle loop —
  confirming the whole engine is NMI-driven.
- SPC700 driver upload: routine location (file `0xF06EC`-`0xF0C75`),
  textbook IPL handshake bytes (`$BBAA`/`$CC`), and the upload's ROM
  source start address (file `0xF0919`) — two independent searches (a
  reset-flow trace and a `$2140`-register census) converged on the same
  code, mutually confirming both.
- Class-tier title table (file `0xB074`-`0xB3C3`, 98 strings): exact
  14-class/7-title match to the Amiga corpus's independently-known
  roster, zero deviation.
- Monster-name table (file `0x46332` onward): cracked the text encoding
  (half-width katakana, `0x80`/`0x81`-tagged length-prefixed field pairs)
  and decoded 102 clean English/katakana name pairs, every one a
  grammatically-correct transliteration — the session's `CREDITS.PIC`-
  equivalent early oracle for this platform.
- Found (but did not decode) a real caveat worth flagging for every
  future SNES session in this project: radare2's `snes` disassembler
  plugin does not track 65816 M/X accumulator-width flags, silently
  mis-decoding any 8-bit-immediate instruction run until a later
  `REP`/`SEP` happens to resync it — filed as a lesson
  (`~/.claude/agents/game-re-lessons/r2-snes-flag-width-blind.md`).

**Ruled out / exhausted this session:**
- Graphics: blind 2bpp/4bpp tile renders at 8 speculative ROM offsets —
  no recognizable image at any of them. Confirmed this needs a traced
  VRAM-DMA source pointer, not more blind offsets.
- Text: whole-ROM scan for valid double-byte CP932 sequences, looking for
  a dialogue/kanji text table — mostly false positives (ordinary
  graphics/tilemap bytes coincidentally in valid SJIS byte ranges).

**Files written:**
- `docs/wizardry6/snes/data-structure.md` — new.
- `docs/wizardry6/snes/disasm/reset_startup.txt`,
  `docs/wizardry6/snes/disasm/spc_upload_handshake.txt` — new, raw r2
  dumps (not hand-corrected past the first few dozen instructions each).
- `tools/wizardry6/snes/decode-class-titles.ts`,
  `tools/wizardry6/snes/decode-monster-names.ts` — new, both with a
  built-in oracle/consistency check.
- `public/assets/wizardry6/snes/data/class-tier-titles.json`,
  `public/assets/wizardry6/snes/data/monster-names.json` — new.
- `docs/wizardry6/TODO.md` — 6 new SNES rows (see the file for the
  authoritative up-to-date list).

No pipeline registration (`tools/shared/game-config.ts`, `seer.config.ts`)
this pass — out of scope for this session by design.

## Session 2 (2026-08-02) — first confirmed SNES graphics decode

Scope: the 6 SNES-tagged `docs/wizardry6/TODO.md` rows left by session 1,
worked in priority order (graphics, font, text encoding, monster-table
anomaly, SPC700 size, NMI dispatch). Wrote a flag-aware linear 65816
disassembler probe (`dis65816.py`, session scratchpad, throwaway per
`r2-snes-flag-width-blind.md`'s own guidance) and hand-verified every
instruction cited this session against raw bytes through it — no raw r2
output trusted verbatim past a mode-switch boundary.

**Confirmed this session (the headline result):**
- SNES graphics tile pixel format: standard 4bpp bitplane-interleaved 8x8
  tiles (`tools/shared/snes-ppu.ts`, ported from the `strike` project).
- The game's monster/NPC face-portrait bank: a 60-slot directory table
  (file `0x105D1`) whose first 36 entries resolve to 36 fixed-size
  (288-byte/9-tile/24x24px) portrait records in ROM bank `$05`. The
  directory→record mapping is confirmed by a byte-exact invariant (30 of
  the 36 records, sorted by address, are *exactly* 288 bytes apart with
  zero deviation), and the pixel decode is confirmed by the render itself
  — 36 individually recognisable creature/NPC faces (humans, hooded
  figures, a demon mask, a wolf, a cat, a bird, a dog), not noise or an
  ambiguous blob. Found by tracing the RESET-time resource-loader flow
  into a 15-entry resource-type dispatch table (file `0x66a0e`) and then
  an `MVN`-based "copy from ROM bank `$85` into WRAM `$7F`" primitive,
  back through its source-register load to the directory table — i.e. by
  finding the reader, not by guessing offsets (the project's own stated
  method, which the prior session's blind-offset attempts had not yet
  applied to this platform). The tile data turned out to be **plain,
  uncompressed** ROM bytes — no decompression step exists for this
  resource type.
- NMI handler body traced fully and flag-verified from entry through to
  its dominant per-frame call `JSL $81E3DC` (joypad edge-detection, a
  `$0100`-`$0350` WRAM table built at RESET and walked every NMI via a
  `TCS`-based indirection whose exact purpose wasn't resolved).
- Monster-table genus-header anomaly (`VINE` at file `0x463A4`):
  re-examined with a direct hex read of the surrounding 6 records: the
  anomalous field is tagged `0x80` (English), not `0x81` (katakana) as
  session 1's framing implied — it's a distinct 3rd record type reusing
  the English tag for binary metadata, sandwiched between a genus's
  English name and its first real monster entry. Confirms the
  "genus/category header" hypothesis structurally; payload semantics still
  unknown.

**Still open (see `docs/wizardry6/TODO.md` for current rows):** the
portrait bank's CGRAM palette (render is greyscale), the font/glyph tile
bank's ROM source (pixel format is now known, but its VRAM-upload loop's
source is WRAM, one hop removed from a traced ROM offset), full
dialogue-text encoding, the genus-header binary field's semantics beyond
its structural role, SPC700 driver/sample blob size, and `$81E3DC` itself
(a different bank, not disassembled this session).

**Files written:**
- `docs/wizardry6/snes/data-structure.md` — section 3 (graphics) rewritten
  with confirmed findings, old content preserved in a collapsed `<details>`
  block; sections 4.3 and 6.2 updated in place with corrections; paths-tried
  table and Files section updated.
- `tools/shared/snes-ppu.ts` — new, SNES 4bpp/2bpp tile + BGR555 palette
  decode primitives (ported from `strike`, this project's first use).
- `tools/wizardry6/snes/decode-portrait-tiles.ts` — new, extracts the
  36-portrait face bank with a built-in byte-exact stride oracle check
  (refuses to write output if the invariant doesn't hold).
- `public/assets/wizardry6/snes/sprites/portraits.png` + `portraits.json`
  — new, 36-frame atlas + sidecar (greyscale, palette not yet confirmed).
- `public/assets/wizardry6/snes/manifest.json` — updated (was `[]`).
- `docs/wizardry6/TODO.md` — SNES rows updated: `snes-graphics-format`
  closed and removed; `snes-graphics-palette` added (was implicit); the
  other 5 rows refined in place with this session's progress.

Learning-loop note: `Skill: re-learn` was not invoked this session — the
generalizable lessons here (write a flag-aware disassembler rather than
hand-verify; trace the reader through a resource-type dispatcher and an
`MVN` copy rather than guess offsets) are refinements of
`r2-snes-flag-width-blind.md` and the project's existing "find the reader"
method rather than new standalone pitfalls; a future session should fold
the `MVN` operand-order disambiguation technique (checking which reading
never implies writing to ROM) into `game-re-tooling/snes.md` if it recurs
on another SNES target.

## Session 3 (2026-08-02) — CGRAM palette confirmed; font-bank correction; NMI dispatch hypothesis refuted

Scope: graphics-first per this session's task order — (1) find the
portrait bank's CGRAM palette, (2) trace the font tile bank's ROM source,
then time-permitting the NMI dispatch target and SPC driver size. Re-wrote
the prior session's flag-aware 65816 disassembler (`dis65816.py`, session
scratchpad, not committed) from scratch since it isn't persisted between
sessions by design, and re-verified it against a known-good instruction
sequence before trusting it for new work.

**Palette — solved.** Byte-searched the whole ROM for the confirmed tile
loader's own entry point (`JSL $82825c`) to find its 2 callers, then
searched that caller region for `STA $ca` (dp) and found a sibling
palette-load routine at file `0x1067f` (CPU `$82:867F`). It copies 32
bytes (16 BGR555 colours) from ROM `0x10764` into WRAM `$7e:3840` — the
source group selected by `floor(directoryIndex / 2)` (two portraits share
one 16-colour palette) — then sets a dirty flag polled by a generic
per-frame DMA dispatcher that fires the WRAM→CGRAM DMA at colour address
`$20` (SNES sub-palette 2). Verified two ways: (1) a `$ca` value census
(0-15) shows exactly one produces a non-garbage CGRAM-DMA table record —
the same WRAM address the palette loader writes to; (2) rendering all 36
portraits with the derived per-pair palette produces coherent, plausible
art (skin tones, matching fur colours on the animal heads, green dragon
scales, and — portraits 0/1, palette group 0, which is genuinely all-black
in ROM — two silhouettes, consistent with Wizardry's "unidentified
monster" convention). Updated `tools/wizardry6/snes/decode-portrait-tiles.ts`
to render real colour instead of greyscale; regenerated
`public/assets/wizardry6/snes/sprites/portraits.png`/`portraits.json`.
`snes-graphics-palette` closed and removed from `TODO.md`.

**Font tile bank — real find, but not the dialogue font; corrected an
earlier "noise" claim.** Re-ran the MVN census (same technique that cracked
the portrait bank last session) filtered to *all* 46 `dst=$7f` hits instead
of just the 3 already tied to portraits. Two more `src=$85` hits (file
`0x8e42`, `0x80b9`) source the ROM region immediately after the portrait
directory's pool A (file `0x2ad57`-`0x2e000`) — previously documented as
"confirmed noise" from a byte-window check too narrow to see past the
boundary's opening gradient/border pattern. Rendering the whole 405-tile
span shows legible UI icon tiles: unambiguous half-width `E`/`S`/`W`/`N`
compass letters (dungeon-facing indicator), digit tiles, arrows, item
icons. Connected part of this (WRAM `$7f:0da0`+) to a traced VRAM DMA path
in the same bank as the `$88C9` loader. This is a real, confirmed,
ROM-sourced tile bank — but it's UI icons, not an alphabet/kana font, so
it does not close the dialogue-text-font question; `$88C9`'s own primary
WRAM range (`0x0000`-`0x0aa0`) still wasn't traced to a ROM source.
Corrected the §3.2 "noise" claim in place with a `> Correction:` block per
project convention. `snes-font-tile-bank` narrowed in `TODO.md` to
specifically the dialogue-glyph bank, not the icon set.

**NMI dispatch target — traced, hypothesis refuted.** Disassembled
`$81E3DC` (file `0x00e3dc`), the NMI handler's "dominant per-frame call"
previously flagged as the strongest candidate for the real game-logic
entry point. It's a trivial 13-instruction, zero-branch leaf function that
reads/rewrites a 16-bit value at DP `$8a` and returns — not a dispatcher.
The byte after its `RTL` turned out to be the start of an unrelated
function that also calls it, suggesting `$81E3DC` is a small, widely-reused
low-level primitive (like the pervasive `JSR $8267` yield calls seen
elsewhere), not a dedicated entry point. This *opens* a bigger question —
where does per-frame game logic actually execute, if not here and not in
RESET's apparently-empty spin loop — left for a future session.
`snes-nmi-main-loop` updated in `TODO.md` to reflect the refuted hypothesis
and the new open question.

**SPC700 driver size — attempted, not resolved.** Disassembled the
generic multi-block SPC upload routine (file `0xF0AB0`) and modeled its
block format as `[u16 size][u16 addr][size bytes]` repeated until
`size==0`. Parsing forward from the confirmed start address (`0xF0919`)
under this model desyncs almost immediately (block sizes balloon into the
tens of thousands within 2-3 "blocks"). Lowest priority per task order;
not pursued further — documented as a dead end in the paths-tried table so
a future pass doesn't retry the same field-order guess.

Files touched: `docs/wizardry6/snes/data-structure.md` (§2.3, §3.2
correction, §3.3, §4.3, §5.2, paths-tried table),
`docs/wizardry6/TODO.md`, `docs/wizardry6/plan.md` (this entry),
`tools/wizardry6/snes/decode-portrait-tiles.ts`,
`public/assets/wizardry6/snes/sprites/portraits.png`/`portraits.json`.
`npx tsc --noEmit`, `npm run lint`, `npx vitest run` all pass.

## Session 4 (2026-08-02) — UI icon extractor committed; boot-time full CGRAM palette found; new dungeon-data lead; title/full-sprite searches come up empty (well-evidenced)

Scope: per task order — (1) commit an extractor for the already-confirmed
UI icon bank (quick win), then (2) title screen, (3) dungeon corridor art,
(4) full-body sprites, (5) the `$88C9` WRAM `$7f` source trace, (6) a quick
look at `FAT0SHVC`.

**UI icon bank — extractor committed.** `tools/wizardry6/snes/
decode-ui-icons.ts` decodes all 405 tiles from the confirmed
`0x2ad57`-`0x2e000` span, re-deriving and asserting that span against the
portrait directory's own pool boundaries at run time (refuses to write
output if they diverge). Rendered greyscale, one 8x8 sprite per tile,
shelf-packed 32/row for review. Output:
`public/assets/wizardry6/snes/sprites/ui-icons.png`/`ui-icons.json`,
`manifest.json` updated. **Palette not found**: a CGADD/CGDATA byte
search around both confirmed source `MVN` sites (boot-init span
`0x8000`-`0x9200`) found zero hits, unlike the portrait bank's traceable
sibling routine — new `snes-ui-icon-palette` TODO row.

**Boot-time full CGRAM palette — found and confirmed.** Extended this
session's MVN census to the whole ROM (not just `dst=$7f`, all bank pairs
with one side `$7e`/`$7f`), then filtered to WRAM `$7f,$85` (existing
resource-bank pair) and hand-checked outliers. Found a standalone 512-byte
`MVN $7e,$82` in the RESET boot-init span (file `~0x8062`, source file
`0x127e4`) — byte-exact for a full 256-colour CGRAM image, structurally
distinct from the confirmed per-pair portrait palette (different source
address, same sub-palette-2 colour range). Rendering it as a 16x16 swatch
grid shows coherent structure (grey UI ramp, a skin-tone gradient, a
repeating grey/white border-gradient pattern matching the UI icon bank's
own decoration strip) — read as the game's default boot CGRAM snapshot,
not yet traced to a specific screen consumer. Tracing the boot-init `MVN`
chain further forward found the whole WRAM bank `$7f` gets zero-cleared
right after this palette load, then partially repopulated by a
WRAM-to-WRAM copy (`$7e:e000` -> `$7f:06e0`, 1728 bytes) that **exactly
abuts** the confirmed UI-icon MVN's destination (`$7f:0da0`) — this
narrows (doesn't close) the long-standing "`$88C9`'s `$7f:0000`-`0x0aa0`
source not traced" question: one hop back for the `0x06e0`-`0x0da0`
portion, `0x0000`-`0x06e0` still fully open, `$7e:e000`'s own source not
found within the immediate boot span searched. New `snes-88c9-wram7f-source`
TODO row.

**Title screen — not found, one false lead documented and refuted.** A
DMA-size census (72 `STA $420B` sites, heuristic "nearest preceding `LDA
#imm16`" before the size-register write) flagged two ~35KB candidates as
plausible full-screen-bitmap uploads. Hand-disassembling the actual call
site refuted this: the real size comes from an **indexed table read**, not
an immediate — the heuristic grabbed an unrelated stray immediate nearby.
The call site turned out to be the already-known bank-`$0A` `$88C9`-
adjacent table-driven DMA dispatcher, not a new large-transfer site.
Documented as a dead end so a future session doesn't re-trust those size
numbers. The new boot palette (above) is a plausible but unconfirmed
candidate piece of a title screen. New `snes-title-screen-art` TODO row.

**Dungeon corridor art / maze data — the session's most significant new
lead, not yet confirmed.** A byte-density census (fraction of
`0x14`/`0x54` at even byte offsets) found ~18-32 discrete chunks spanning
file `0x19fd70`-`0x1ff6d4` (ROM banks `$33`-`$3f`) of a clean 2-byte
`[tag][id]` record pattern — mostly "empty cell" zeros interspersed with
small climbing IDs and local reuse, compose-list-shaped. A first attempt
to render this as 4bpp tile pixels produced a classic comb/striping
artifact (the expected signature of periodic non-pixel data being fed to
a tile decoder, not "wrong width" — correctly read as a cue to treat it
as structured records instead of retrying widths). Cross-referenced with
a whole-ROM long-addressing-instruction census (`LDA long`/`LDA long,X`/
`JSL`), filtered to physically-valid target addresses landing inside these
chunks: 31 hits (down from 937 unfiltered/mostly-spurious), including one
target hit by 4 identical `JSL` call sites. However hand-checking that
target byte shows `0x00` (`BRK`) — inconsistent with a clean "these are
`JSL` targets" reading — so the addressing/consumption model is not
actually settled; this is reported as a well-evidenced open lead, not a
decode. New `snes-dungeon-maze-data` TODO row (this project's convention
for "strong lead, honestly not yet closed," matching prior sessions'
practice of not forcing a weak confirmed claim).

**Full-body sprites — checked, not found.** Two leads from the task brief
were checked: a second directory near the confirmed portrait table (found
a different, non-matching word-shaped array immediately before it, not a
second instance of the same lookup mechanism) and the 15-entry resource
dispatch table (re-confirmed as the input-polling subsystem, same
conclusion as a prior session). Neither panned out; not proven absent,
only not found by these two bounded checks. New `snes-full-body-sprites`
TODO row.

**`FAT0SHVC` — quick look only, per task scope.** Noted 8 byte-pairs
before the tag (fixed second byte `0x01`, varying first byte) and a run of
`0x03` bytes after it; role not determined, not pursued further.

Files touched: `docs/wizardry6/snes/data-structure.md` (new §3.2
extractor note, §3.5, §3.6, §3.7, §6.4, `$88C9` note in §3.4, paths-tried
table, Files section), `docs/wizardry6/TODO.md` (6 new rows),
`docs/wizardry6/plan.md` (this entry), `tools/wizardry6/snes/
decode-ui-icons.ts` (new), `public/assets/wizardry6/snes/sprites/
ui-icons.png`/`ui-icons.json`, `manifest.json`. `npx tsc --noEmit`,
`npm run lint`, `npx vitest run` all pass.

## Session 5 (2026-08-03) — comprehensive graphics extraction pass: UI icon
palette, opening sequence, dungeon-maze lead re-identified as spell/combat
animations, main-loop mystery resolved as a coroutine scheduler

Scope: the walker project (`docs/walker.md`) only needs the SNES corpus as
an optional visual asset swap-in, so this session narrowed to graphics
extraction specifically — every remaining sprite/tile/screen bank,
escalating freely per the task brief (title-screen art and the dungeon-maze
lead were both explicitly flagged as prior-session escalation candidates).

**UI icon bank palette — found and confirmed (closes `snes-ui-icon-palette`).**
A whole-ROM byte-census for `STA $ca` (`85 ca`) — broader than session 4's
boot-init-only search — found 21 real call sites using several distinct
`$ca` values beyond the known portrait one (`0x0a`). `$ca=0x14` (20)
resolved to a real record in the confirmed generic CGRAM-DMA dispatch table
(CGADD `0x80`, 16 colours, source `$7e:3900`), and 2 call sites in the
portrait-loader's own bank set exactly this value right after invoking a
sibling entry point into the *same* palette-copy routine used for
portraits (4 bytes into its body, bypassing the selector prologue). Both
pull from the portrait bank's own shared 32-bytes/group colour table
(groups 46 and 51). Render confirms coherent, non-scrambled colour — gold
medallion borders, tunnel-wall greys, matching the icon content. Extractor
(`decode-ui-icons.ts`) and `decode-portrait-tiles.ts` (whose own colour
render had been produced by a prior session but never actually committed —
found and fixed a docs/code mismatch: the committed script was still
greyscale-only despite the doc claiming it was updated) both updated to
bake in real colour. New shared primitive reused, none needed.

**NMI/main-loop mystery resolved (closes `snes-nmi-main-loop`) — as a side
effect of a `re-codebreaker` escalation on the title-screen lead.** `$8259`
(previously "a non-obvious indirection, semantics unresolved") is a
**cooperative coroutine scheduler**: `$8259`=task resume, `$8267`=task
yield, `$8263`=far-yield wrapper (the pervasive `JSL $808263` seen
everywhere), `$828F`=set task entry. RESET registers 10 tasks; slot `$0100`
(file `0x0922`) is the boot/opening task, independently re-verified this
session by hand-disassembling it: `JSL $818000; JSR $8267 (yield); JSL
$8d8000 (opening-sequence controller); JSR $8267 (yield)`. There is no
separate "main loop" to find — the scheduler *is* the main loop.

**Title screen art found (closes `snes-title-screen-art`) —
`re-codebreaker` escalation, independently re-verified.** The blocker for
every prior approach (this session's own included: a palette-table
exploration found the shared colour table is far larger than known, a
fresh MVN-size census found and *correctly ruled out* a 3072-byte
candidate as sparse non-pixel table data via a zero-fraction/bit-density
check) was that the real opening-sequence resources are **LZSS-compressed**
(codec `$83:8000`, file `0x18000`, 2 KB window) — invisible to any census
assuming the confirmed banks' plain-`MVN` shape. This session
re-implemented the LZSS decoder from scratch (not copied from the
escalation) and ran it directly against the ROM: the publisher logo (file
`0x020000`) composes to the unmistakable **"ASCII" wordmark**; the
copyright screen (file `0x06a136`) composes to **fully legible English
copyright text**; a title backdrop + lightning overlay (files `0x0693c6`/
`0x06aecd`) render as coherent (not noise) scenery. **Bonus finding from
the same escalation: the dialogue font** (closes `snes-font-tile-bank`) —
file `0x04c653`, 256 tiles, 2bpp, uncompressed, independently re-rendered
this session as a fully legible glyph set (digits, A-Z, hiragana,
katakana, symbols). A Mode 7 sequence and a scrolling panorama were located
but not extracted (new `snes-opening-screens-4-5` row — need composition
logic beyond this session's scope). New extractor: `decode-opening-
sequence.ts`; new shared primitive: `tools/shared/snes-lzss.ts`.

**Dungeon-maze lead re-identified — it's the spell/combat animation bank,
not maze data (closes `snes-dungeon-maze-data`, opens `snes-spell-anim-
bank`).** Hand-verifying the prior session's "4 identical `JSL` call sites"
byte-by-byte found they decode as a genuine `JSL $3aba21` instruction at
all 4 sites — but each sits inside *more* of the same dense tilemap-word
data, not real code (confirmed by dumping ~200 surrounding bytes at each
site: no plausible instruction stream). This is a second, structurally
distinct dead end from the prior session's census (the escalation
criteria's "2 genuinely different failed approaches" bar), so escalated to
`re-codebreaker`. Found: ROM banks `$32`-`$3F` hold a 139-record master
directory (file `0x190000`) of spell/combat animation records (LZSS
graphics + a frame-table with SNES BG tilemap cells for "mode A" 4bpp
records, or flat uniform-fill 2bpp frames for "mode B" records), consumed
via a `DBR`-relative indexed read (`$02:DFBB`, `LDY $7ffe,X` with `DBR=
$b2`) invisible to any long-addressing-instruction census — worse, the raw
table-base operand `$7ffe` sits *below* `$8000`, so even this project's own
`>= 0x8000` LoROM-validity filter (built to cut census noise) would have
silently discarded the one real call site. New pitfall harvested:
`indexed-table-base-below-valid-rom-window.md`. Independently re-verified
this session: re-derived the master directory, one mode-A record's frame
table (9 entries, byte-exact increasing offsets), one mode-B record (17
frames, confirmed "every frame = one uniform tile repeated 9x" reading),
and the LZSS decode (byte-exact, zero overrun) all from scratch against the
ROM. Rendered record 0's tile bank: coherent organic/particle shape, not
noise. **The dungeon/maze-geometry question is open again** — this was the
strongest lead for it, and it's now understood to be something else
entirely; no replacement lead was found this session. New extractor:
`decode-spell-animations.ts` (139 records, 17,042 tiles, tiles + JSON
compose-list, same "tiles + compose-list, not baked frames" convention as
the Amiga corpus's `mazedata.ega`).

**Full-body sprites — still open, two more banks ruled out.** No dedicated
new check, but the spell-animation and opening-sequence banks (both fully
characterized this session) contain no full-body figure art either —
narrows the search space further without closing the question.

**Review caught a real bug before commit**: the `reviewer` agent's pass on
the new/changed files flagged that `decode-spell-animations.ts`'s
greyscale render used a flat 4bpp scale (`idx*17`) for *all* tiles, but
mode-B tiles are 2bpp (indices 0-3) — would have rendered them near-black
(max value 51/255 instead of 255/255). Fixed by tracking per-tile bpp
alongside the shared atlas and scaling `*17` vs `*85` accordingly; re-ran
the extractor and spot-checked the fix visually. A reminder that `npx tsc`
+ `eslint` passing is necessary but not sufficient — this was a silent
logic bug, not a type/lint error.

**Verification discipline**: two `re-codebreaker` escalations ran this
session; every claim promoted into `data-structure.md` was independently
re-derived from scratch and re-verified against the ROM (not copied from
either escalation's own scratch scripts) before being trusted, per
`verify-escalation-artifacts-not-just-claims.md` — including re-finding a
genuine bank-off-by-one file-offset↔CPU-address error the escalation
caught in a *prior* session's (and this session's own, before catching it)
§3.5 citation (file `0x8060` is CPU bank `$01`, not `$00`, since `0x8060 >=
0x8000`).

Files touched: `docs/wizardry6/snes/data-structure.md` (§2.3, §3.2b [new],
§3.5, §3.6, §3.7, §3.8 [new], §4.3, §6.4, paths-tried table, Files
section), `docs/wizardry6/TODO.md` (5 rows closed, 2 new), `docs/wizardry6/
plan.md` (this entry), `tools/shared/snes-lzss.ts` (new),
`tools/wizardry6/snes/decode-opening-sequence.ts` (new),
`tools/wizardry6/snes/decode-spell-animations.ts` (new),
`tools/wizardry6/snes/decode-portrait-tiles.ts` (palette fix),
`tools/wizardry6/snes/decode-ui-icons.ts` (palette added),
`public/assets/wizardry6/snes/` (`sprites/portraits.png` recoloured,
`sprites/ui-icons.png` recoloured, `sprites/font.png`/`font.json` [new],
`sprites/spell-animations.png`/`spell-animations.json` [new],
`screens/logo.png`/`copyright.png`/`title-backdrop.png`/
`title-lightning.png` [new], `manifest.json` updated). `npx tsc --noEmit`,
`npx eslint`, `npx vitest run` all pass; `reviewer` agent pass caught and
fixed one real bug (above) before this was written up.

## DOS/EGA

## Session 1 (2026-08-01) — first assessment pass, leaning on the Amiga corpus

Scope: survey the newly-landed `data/wizardry6/dosega/wiz6/` corpus (162
files, DOS/EGA release published by Interplay) using a strong lead from
the launching session: every same-sized `.hdr`/`.dbs` file matches its
Amiga counterpart once multi-byte fields are reinterpreted little-endian
instead of big-endian.

**Confirmed this session** (see `docs/wizardry6/dosega/data-structure.md`
for full evidence): `misc.hdr`, `master.hdr`, `disk.hdr`, `scenario.hdr`,
`pcfile.dbs`, `scenario.dbs` (XP tables + item catalog + monster catalog),
`msg.hdr`/`msg.dbs` text — all via LE reinterpretation of the Amiga
layout, cross-checked value-for-value against the Amiga corpus. `.EGA`
full-screen images (`dragonsc`, `graveyrd`, `titlepag`) — same plane-major
layout and the same `PIC_PALETTE`, which this pass additionally confirmed
is the *original* game-authored palette (DOS is the source platform) by
showing it beats the standard EGA hardware DAC order on a real render.
`mazedata.ega` — same content, but a 5-byte (not 6-byte) directory record
that drops the stored offset field entirely in favour of implicit
cumulative offsets; found via brute-forcing record/offset-field
width/position combinations after the direct endian-swap failed, byte
accounting verified zero-deviation. `wfont0-4.ega`/`wport1-3.ega` — turned
out to be byte-identical (or 99.5%-identical for `wfont4.ega`) to the
Amiga files outright, no re-derivation needed.

**`.pic` sprite files** (`mon00.pic`-`mon58.pic`, `credits.pic`): two
distinct hypotheses (direct Amiga-layout reinterpretation, then a
narrower-field variant motivated by a coincidental round-number match)
both failed against structural evidence, so this was escalated to
`re-codebreaker` mid-session with a self-contained brief. The escalation
fully solved it: every file is a block-oriented byte RLE (4096-byte
blocks, no cross-block tokens — block size itself determined by brute
force, only 4096 decodes the whole corpus), and the decompressed image is
the Amiga `.PIC` format verbatim with only the directory's offset field
narrowed (`u16` LE instead of `u32` BE, 24-byte slots instead of 26).
Verified byte-exact against the Amiga corpus: 712/712 cels, 3,414,272
pixels, zero deviation. Implemented as `tools/wizardry6/dos-rle.ts` +
`tools/wizardry6/pic-format-dos.ts`, tested in
`tools/wizardry6/__tests__/pic-format-dos.test.ts`, promoted to a
committed extractor (`tools/wizardry6/decode-dosega-pic.ts`).

**`wroot.exe`/`.ovr` overlay architecture**: confirmed the overall shape
without deep disassembly — `bane.bat`'s `ERRORLEVEL` 1-22 table is a
free, ready-made enumeration of the startup load order; `wroot.exe`
embeds an 11-name overlay table matching the 11 shipped `.ovr` files
exactly, plus an explicit `"Error %d loading overlay: %s$"` string; every
`.ovr` file shares an 8-byte header (constant magic + a per-file size-like
field) whose exact semantics weren't fully closed; a rough per-overlay
content map was built from each file's embedded resource-filename
strings (`winit.ovr` = startup loader, `wbase.ovr` = character/save
management, `wmele.ovr`/`wmnpc.ovr`/`wdopt.ovr` = combat/NPC/options,
etc.). Real-mode segmented disassembly of the actual overlay-load call
site was attempted but stalled on resolving the true CS/DS relationship
for a flat-VA radare2 pass — left open rather than guessed at.
`winstall.exe` and the `.drv` video drivers were confirmed shallowly, per
scope (installer role / driver dispatch-table shape only).

**Files written:**
- `docs/wizardry6/dosega/data-structure.md` — new.
- `tools/wizardry6/decode-dosega-headers.ts`,
  `decode-dosega-scenario.ts`, `decode-dosega-msg-text.ts`,
  `decode-dosega-ega-screen.ts`, `decode-dosega-maze.ts`,
  `decode-dosega-fonts.ts`, `decode-dosega-pic.ts` — new committed
  extractors, all point-in-time-run and their output spot-checked
  visually (title text, monster/portrait art, brick-wall textures all
  legible).
- `tools/wizardry6/dos-rle.ts`, `tools/wizardry6/pic-format-dos.ts`,
  `tools/wizardry6/__tests__/pic-format-dos.test.ts` — new, from the
  `re-codebreaker` escalation (verified, not copied blindly).
- `public/assets/wizardry6/dosega/**` — new (screens, sprites, maps,
  palettes, data — regenerable build output).
- `docs/wizardry6/TODO.md` — 4 new DOS/EGA rows (see the file for the
  authoritative up-to-date list).

No pipeline registration (`tools/shared/game-config.ts`, `seer.config.ts`)
this pass — explicitly out of scope for this session.

## Session 2 (2026-08-01) — `.CGA`/`.T16` platform-variant graphics

Scope: decode the `.CGA` (CGA, 2bpp) and `.T16` (Tandy 16-color, 4bpp)
siblings of every `.EGA` asset in `data/wizardry6/dosega/wiz6/` (36 files:
12 base names x 2 formats), starting from two file-size-arithmetic
hypotheses handed off by the launching session: `mazedata`/screens'
`.cga` is exactly half of `.ega` and `.t16` matches `.ega`'s size exactly;
`wfont0.cga`/`.t16` switches from the EGA-only special-cased 1bpp mono
font to the general packed-tile mechanism `wfont1-4` use.

**Both hypotheses confirmed, with one refinement.** The size arithmetic
held everywhere (zero deviation), but it only constrains total byte
count, not pixel *arrangement* — the actual discovery this session was
that **every one of these formats is packed-pixel (chunky), not planar**
(a plane-major bitplane decode at the "matching" bit depth reliably
produces noise across all of them), unlike every other format in this
whole corpus (Amiga and DOS/EGA alike), which is planar throughout.
`wfont0.cga`/`.t16`'s *mechanism* is confirmed general-tile as
hypothesized, but its *content* is still recognisably the same plain
ASCII glyph sheet as `.ega`, not repurposed as an icon set — see
`docs/wizardry6/dosega/data-structure.md` §9.5 for the full reasoning.

**`.CGA` full screens** were the hardest part: a plain packed-linear
decode produced legible but vertically-tripled/blurred output, which
turned out to be two real fields (not three) misjoined by an 8000-byte
(not 8192-byte) bank-size guess. Cracked by disassembling `cga.drv`'s
screen-blit routine (real-mode x86, raw headerless binary — `file`
offset == segment offset, no MZ header): it applies the *same* `0x2000`
bank-gap idiom to both its source (asset) and destination (`0xB800:`
video memory) pointers during a plain `rep movsw` copy, meaning the file
on disk is pre-formatted to match real CGA hardware's even/odd-field
video memory layout exactly (8192-byte banks, only 8000 bytes of each
holding real pixel data). `.T16` was comparatively easy — a first-try
plain linear packed decode rendered clean immediately; `tandy.drv`'s
blit routine confirmed why (only the *destination* pointer takes the
4-bank hardware jumps, the source stays a plain linear bitmap).

**Palettes**: both confirmed via `wroot.exe` disassembly of its per-mode
setup paths, not just rendered guesswork. CGA: `INT 10h AH=0Bh BH=01h
BL=01h` selects hardware "Palette 1" (cyan/magenta/white family) — the
palette *family* is disassembly-certain; low vs. high intensity rests on
"no call sets the intensity bit" plus a modest quantitative edge, flagged
honestly rather than overclaimed. Tandy: `INT 10h AH=10h AL=02h` ("Set
All Palette Registers") with an embedded 17-byte register table that,
decoded, reproduces the already-confirmed `PIC_PALETTE`'s exact 16-entry
permutation byte for byte — Tandy 16-color mode uses the *same* palette
table as EGA/Amiga, just reprogrammed through a different BIOS call. This
is the strongest-evidence palette finding in the DOS/EGA corpus so far —
read directly from an executed BIOS call's own parameter table.

No escalation needed — the CGA full-screen layout was the one point that
came close (two failed hypotheses: plain-linear producing a
vertically-repeated image, then an 8000-byte-bank guess producing a
combing artifact), but the third attempt (hardware-accurate 0x2000-byte
banks, motivated directly by the `cga.drv` disassembly rather than
further guessing) resolved it cleanly.

**Files written:**
- `tools/shared/packed-pixel.ts` — new shared library
  (`decodePackedPixelLinear`, `decodeCgaBanked`,
  `indicesToRGBAWithTransparency`), the chunky-pixel counterpart to
  `tools/shared/amiga-planar.ts`'s bitplane helpers.
- `tools/wizardry6/dosega-cga-palette.ts` — new, `CGA_PALETTE` constant.
- `tools/wizardry6/decode-dosega-ega-screen.ts`,
  `decode-dosega-maze.ts`, `decode-dosega-fonts.ts` — extended in place
  (mode-table pattern) to also decode `.cga`/`.t16`, reusing all existing
  `.ega` decode/atlas logic; regression-checked byte-identical against
  the pre-change `.ega`-only output (MD5 diff across every existing PNG/
  JSON, zero differences).
- `tools/wizardry6/__tests__/packed-pixel.test.ts` — new: unit tests for
  the two new decode primitives plus corpus-wide size/byte-accounting
  assertions against the real `data/wizardry6/dosega/wiz6/` files.
- `public/assets/wizardry6/dosega/{screens,maps,sprites,palettes}/*_cga.*`,
  `*_t16.*` — new (regenerable build output), 27 new PNG+JSON pairs.
- `docs/wizardry6/dosega/data-structure.md` §9 — new section covering
  both formats; confidence-summary table (§8) extended with 4 new rows.
- `docs/wizardry6/TODO.md` — unchanged; nothing this session's own scope
  left genuinely open (the CGA intensity-bit residual uncertainty is
  documented inline in §9.2 rather than tracked as a blocking open item,
  since it doesn't affect the decode itself, only which exact shade of
  cyan/magenta is used).

Fixed one incidental bug while wiring the mode tables: three
`decode-dosega-*.ts` scripts' unconditional `main()` call at module scope
was firing as an import side-effect once their exports were imported
cross-file (using whichever `process.argv` happened to be live) — added
the standard `if (import.meta.url === \`file://${process.argv[1]}\`)
main();` entry-point guard to all three.

---

## Session: `.EGA` full-screen speckle — bitplane stride bug found and fixed (2026-08-01)

A user reported that the residual fill-area speckle in
`GRAVEYRD.EGA`/`DRAGONSC.EGA` (previously written up as "leading
hypothesis: genuine period-accurate EGA dithering, not pursued further")
looked more like a bitplane offset bug than authentic art, and asked for
a definitive disassembly-backed answer rather than more trial and error.

**Verdict: it was a real decode bug, not (solely) dithering.** The
decoder assumed the 4 bitplanes are packed back-to-back (`8000` bytes
each, `320/8*200`), with the file's remaining 768 bytes as one inert
trailing block. Wrong: each plane actually occupies a fixed **8192-byte
(`0x2000`) slot**, `4*8192 = 32768` exactly (the whole file) — the "768
extra bytes" are really four 192-byte per-plane gaps, not one trailer.
Plane 0 happened to decode correctly either way (offset 0); by plane 3
the old assumption's read window had drifted 576 bytes into the wrong
data (~48% agreement with truth — indistinguishable from noise), which is
what produced the reported speckle.

**Method — the coordinator supplied a decisive shortcut mid-session**: the
DOS/EGA release's `.t16` full-screen variant (same artwork, structurally
unrelated packed-chunky 4bpp encoding, already confirmed clean by direct
rendering in an earlier session) is a ready-made independent oracle. A
per-bitplane brute-force offset search against that ground truth found a
perfect 100.0000% match for all 4 planes at `0, 8192, 16384, 24576` — an
exact arithmetic progression, common difference `8192`. Cross-checked
against a coordinator-raised alternative hypothesis ("what if `.ega` is
actually packed-chunky like `.t16`, misdecoded as planar?") — tested and
refuted: a packed-chunky decode of `.ega`'s raw bytes renders pure noise,
worse than even the buggy planar decode.

Independently corroborated via disassembly: extracted `Bane`'s CODE hunk
and found the literal `0x2000` constant three times as `adda.l
#0x2000,a1` in `DrawMazePiece` (`CODE+0x3e30`/`0x3e94`/`0x3fd4`, within
the already-documented `CODE+0x3d72`-`0x40cc` range, §4.4), there used as
the real on-screen Amiga display's own fixed per-plane bitplane pitch —
independent proof `0x2000` is a genuine engine convention, not a
coincidental numeric match from the offset search alone.

**Verification**: 0 pixel mismatches across 3 screens × 2 platforms (the
Amiga and DOS/EGA `.ega` files are byte-identical, confirmed by md5) ×
64,000 pixels = 384,000 total comparisons against the `.t16` ground
truth, checked against both a throwaway Python probe and the actual
committed TypeScript pipeline's regenerated PNG output.
`GRAVEYRD.EGA`'s sky speckle is still visually present after the fix but
is now proven byte-identical to the `.t16` ground truth — genuinely baked
into the source art, now that the real decode bug has been separately
found and fixed. This upgrades the old "leading hypothesis... not
pursued this pass" into a closed, verified conclusion for both platforms.

**Files written:**
- `tools/shared/amiga-planar.ts` — `decodePlanarPlaneMajor` gained an
  optional `planeStride` parameter (defaults to the old tightly-packed
  behaviour; all 7 other call sites across `.PIC`/`mazedata`/`WFONT`/
  `WPORT` decoders pass no 6th argument, so they're unaffected).
- `tools/wizardry6/decode-ega-screen.ts` (Amiga),
  `tools/wizardry6/decode-dosega-ega-screen.ts` (DOS, `.ega` mode only —
  `.cga`/`.t16` untouched, they were never affected) — both now pass
  `planeStride = 0x2000`; header comments rewritten with the full finding.
- `public/assets/wizardry6/amiga/screens/{dragonsc,graveyrd,titlepag}.png`
  and the `public/assets/wizardry6/dosega/screens/` equivalents —
  regenerated; `tools/viewer/build-manifest.ts` re-run (clean, no
  manifest content change — same filenames).
- `docs/wizardry6/amiga/data-structure.md` §3/§3.1/§3.2 — corrected in
  place (superseding `>` blocks, not deleted) plus new §3.3 with the full
  writeup.
- `docs/wizardry6/dosega/data-structure.md` §2 and §9.3 — corrected/
  cross-referenced the same way.
- `docs/wizardry6/amiga/investigations/ega-screen-palette.md` — new §3
  appended documenting the fix (the file's original §3 "what to merge"
  section renumbered to §4).
- `docs/wizardry6/TODO.md` — deleted the `ega-screen-trailing-bytes` row
  (solved; see TODO delta in the final report).

## DOS/EGA — Session 3 (2026-08-02) — overlay loader disassembly: CS/DS resolved, all 4 TODO items closed or narrowed

Scope: the 4 DOS/EGA-tagged `docs/wizardry6/TODO.md` rows, starting from
the CS/DS segment-resolution blocker (`dosega-ovr-loader-trace`) that
`dosega/data-structure.md` §6.5 flagged as the prerequisite for the other
three.

**Confirmed this session:**
- **CS/DS segment relationship** (`dosega/data-structure.md` §6.1a):
  `DS = CS + 0x0fd8` paragraphs (`0xfd80` bytes), fixed for the process
  lifetime. Traced from `wroot.exe`'s own entry code (`mov bp, 0xfd8`
  patched by the file's one MZ relocation entry, later committed to both
  `SS` and `DS` via `mov ds, bp` in the small-model C startup stub) and
  verified against a real string: computing the file offset for a `DS`-
  relative operand seen in a nearby `int 21h AH=9` call lands exactly on
  the legible string `"8087/80287 is required!\r\n$"`.
- **`wroot.exe`'s overlay-load state machine, fully traced**
  (§6.2): `GameStateLoop` (module offset `0x132d`) is an infinite loop
  reading a global `curState` (`[0x363a]`) through a 26-entry inline jump
  table (module offset `0x1417`), each case loading one named overlay via
  `LoadOverlay` (`0x36dc`→`0x36e9`: builds `"<NAME>.ovr"`, opens it, reads
  a 14-byte header, validates it, loads the code region to a fixed buffer
  offset, then jumps into the freshly-loaded overlay). `bane.bat`'s
  ERRORLEVEL load-order table (§6.1) is this same loop's first several
  `curState` values, not a separate mechanism.
- **`.ovr` header corrected from 8 to 14 bytes** (§6.3), with the
  previously-unclosed `+4` field now byte-exact: `fileSize == 14 + sizeA +
  sizeB` holds with zero deviation across all 11 files (`sizeA`=code
  region length, `sizeB`=data/string-pool length), and the `14+sizeA`
  boundary independently lands exactly on the start of each file's
  resource-filename string pool. Also found: header field `+2` (constant
  `0x4572` across all files) does double duty as part of the format
  signature *and* the fixed in-buffer code-load offset (`LoadOverlay`
  reads it back, unmodified, as the destination for the code-region
  read).
- **`dosega-qmon00-pic` resolved as a false read, not a real string**: the
  code region of every `.ovr` file ends with `push cx; jmp word [ptr]` (a
  trampoline into the overlay's real entry point); the trailing operand
  byte of that final instruction is `0x51` (ASCII `'Q'`), immediately
  followed by the data pool's genuine, ordinary `"MON00.PIC\0"` string —
  the original whole-file string scan concatenated the two across the
  code/data boundary. There is no `QMON00.PIC` anywhere in the corpus.
- **`wmaze.ovr`'s role confirmed via disassembly**, not just content
  mapping (§6.4): its entry point re-reads the identical absolute address
  `[0x363a]` that `wroot.exe`'s own loop uses (direct proof overlays
  execute in-place inside the shared data segment), dispatches
  internally on the 3 `curState` values (5/6/23) that `wroot.exe`'s own
  jump table maps to loading it, lazily opens two cached file handles
  (near-certainly `SAVEGAME.DBS`/`SOUND00.SND`, its only two embedded
  filename strings), and indexes a second event/view table (buffer offset
  `0x7d2`) by a secondary per-call parameter (`[0x363c]`) — consistent
  with `seer/docs/walker.md`'s slot-indexed-compositor expectation. Full
  internal rendering-loop tracing is a separate, larger effort, left open
  as `dosega-ovr-loader-internals`.
- **`dosega-msg-hdr-collisions` resolved as genuine text reuse** (§1.8):
  field `A` is a strictly increasing, zero-duplicate sorted key across
  all 718 `msg.hdr` records (hard structural confirmation of the existing
  binary-search-key hypothesis), and every one of the 29 colliding
  `(page,offset)` groups pairs 2-3 *distinct* `A` values pointing at the
  same stored text — decoded, several groups turn out to be exactly the
  kind of generic, obviously-reusable UI prompt one would expect
  (`"SELECT NEW CHARACTER"`, `"TYPE THE MAGICWORD FOR..."`). Noted for
  future cross-platform work: Amiga's own `msg.hdr` has zero such
  collisions — a genuine authoring difference between the ports, not a
  decode discrepancy.
- **`wpcmk.ovr`/`wpcvw.ovr` shared block decoded** (§6.6): the genuinely
  cross-file-identical content is a 14-row **class attribute-requirement
  table** (letters as base-26 values, `A`=0..`Z`=25) that matches the
  confirmed 14-class roster order exactly and whose per-class nonzero
  columns match real class lore precisely under the canonical
  `STR/IQ/PIE/VIT/AGI/DEX/LUK` attribute order (`FIG`→STR, `MAG`→IQ,
  `PRI`→PIE, `THI`→AGI+DEX, etc.) — promoted from "task-described ~1KB
  block" to a confirmed, cross-validated table. Two further tables in the
  same block (an 11-row table, likely per-race base attributes; a 10-row
  ×14-column table, likely a race×class rating matrix) are documented as
  hypothesis only — their row counts don't match each other and this
  corpus has no independently-confirmed race roster to check against on
  either platform. A third, `wpcmk.ovr`-exclusive block of ASCII `'0'`/
  `'1'` digit-string tokens remains fully open. Narrowed into
  `dosega-wpcmk-wpcvw-race-table`.

**Files written:**
- `docs/wizardry6/dosega/data-structure.md` — new §6.1a; §6.2, §6.3, §6.4
  rewritten (correction blocks, not silent overwrites, for the `QMON00.PIC`
  and 8-byte-header claims); §6.5 updated; new §6.6; §1.8 updated; §8
  confidence table updated.
- `tools/wizardry6/decode-dosega-msg-text.ts` — doc comments and
  runtime log/JSON `note` text updated to reflect the collision question
  being resolved (no behavior change; re-ran, output unchanged:
  713/718 messages, 681 unique offsets, 98.5% printable-ASCII).
- `docs/wizardry6/TODO.md` — all 4 DOS/EGA rows resolved; replaced with 2
  narrower follow-on rows (`dosega-ovr-loader-internals`,
  `dosega-wpcmk-wpcvw-race-table`).

No new committed extractors this session — all 4 items were disassembly/
data-analysis findings written into the doc, not new asset-producing
pipelines. `npx tsc --noEmit` and `npx eslint tools/wizardry6/decode-dosega-msg-text.ts`
both clean (one pre-existing, unrelated `tsc` error in
`tools/wizardry6/snes/decode-portrait-tiles.ts`, outside this session's
scope).

## Session: Amiga TODO sweep — 4 items solved, 6 substantially advanced, 3 given a bounded lift (2026-08-02)

Worked through all 13 Amiga-tagged `docs/wizardry6/TODO.md` rows in
priority order. Dispatched 4 parallel `amiga-disasm` agents for the
deepest disassembly-tracing items (monster stat block + `.PIC` cel-list
source; item catalog remaining fields; `scenario.dbs` sections 3/5/6/7/8/9;
`pcfile.dbs` fields + `newgame.dbs` trailer), verified every returned claim
independently in this session (byte-exact re-derivations, not just
re-stating the agents' prose), and handled the statistical/lookup-shaped
items directly (byte histograms, name-string cross-references, index-
labelled tile renders, raw-opcode census scans via `r2`).

**Solved outright (TODO rows deleted):**
- `master-hdr-categories-10-19` — resolved from pure addressing arithmetic,
  no new disassembly needed: `-0x7482(A4)` (previously described as "a
  runtime-populated 20-entry array") is actually a fixed alias 4 bytes into
  `disk.hdr`'s own cached buffer, not a separate table. Categories ≥10
  read `master.hdr`'s own count sub-array as a bogus size and `disk.hdr`'s
  own confirmed-content-trivial identity-ramp bytes as a bogus offset;
  0/47 confirmed `ReadSection` call sites ever issue a literal ≥10.
  Confirmed vestigial, not a mystery.
- `scenario-section9-target` — the "277,826-byte unidentified blob" had a
  transcription slip (real value 277,314 = `0x43b42`); it's the game's own
  `SOUNDnn.SND` length/index directory. Independently re-verified: all
  35/35 real `.snd` file sizes match the directory's `length` field
  byte-exact, sum = `0x43b42` exact, and the 5 non-chaining record indices
  are exactly the 5 gaps in `.snd` file numbering.
- `newgame-dbs-trailer` — a real field-level reader (`CODE+0x6e22`) was
  found via a new search method (word-immediate scan for the 414-byte
  header boundary constant, not string/byte-match). It parses a
  414B-header + 14×3086B maze/entity pairs + 66B position block + a
  conditional `pcfile.dbs`-format character-record run — every byte of
  `newgame.dbs` is now accounted for. Independently re-verified: the 66B
  block is 66/66 zero, the remaining 6172B are 99.87% zero (8 nonzero
  bytes, build-tool residue). This also **corrected** a previous claim
  that "start new game" copies the whole file verbatim via a "file-copy
  helper" — that function (`CODE+0x553ac`, A4 entry 115) is actually
  `strcat`, re-disassembled directly this session; §1.4 corrected.
- `wfont-tile-naming` — assigned semantic names/ranges to all 4
  `WFONT1-4.EGA` files from index-labelled zoomed renders (rendered
  confidence); the 42-tile class-abbreviation run in `WFONT1` was verified
  byte-exact against the known 14-class roster string.

**Substantially advanced (TODO rows kept open, sharpened):**
- `monster-stat-block` — XP award, 3 dice specs (via a newly-found
  `RollDice` primitive), companion-monster ID/spawn-chance, and an AI
  special-action gate now confirmed; HP/AC/level/alignment not located
  (the containing combat subsystem is ~87KB, not swept exhaustively).
- `pic-cel-list-mapping` — the struct writer (`CODE+0x14ce2`) and its
  3-level caller chain are now confirmed (a `strcpy`-based sorted insert
  into a 12-slot array); both of its data-source paths bottom out in 3
  runtime side tables, not the monster record — one level deeper, not
  closed.
- `item-catalog-remaining-fields` — most of the 74-byte record decoded:
  class-restriction mask with a **live equip-time enforcement site**,
  race-restriction mask (independently cross-verified via two methods —
  disassembly and a from-scratch statistical bit/name pass that converged
  on the same bit-5=Faerie/bit-1=Elf reading before the disassembly trace
  returned), gender mask, two-handed flag, and a 17-value category enum
  decoded by direct semantic inspection of all 452 named records. Found
  and fixed a real bug while writing the extractor: the class-mask field
  must be read as `base[54]|(base[55]<<8)` (the game's own `TestBit`
  byte-array convention), not a big-endian `u16` — verified by checking
  the extractor's decoded output against the disassembly-reported
  semantics (`DAGGER` excludes exactly `PRI,BIS,MON`).
- `scenario-section3-fields` — the search function `CODE+0x8fe6` is now a
  fully documented `FindEntitySlot` API (A4 entry 64) with 7 confirmed
  callers, mostly in the combat/encounter code range; `+0x3f0`/`+0x480`/
  `+0x510` confirmed as x/y/region keys (value ranges match the region
  geometry exactly); a new field `+0x6c0` (previously "12 trailing bytes")
  confirmed as a per-region entity-start-index table, independently
  re-verified byte-exact against a direct scan of the raw data.
- `scenario-sections-5678` — section 6 fully confirmed as 400 monster
  encounter/spawn-group records (independently re-verified against the
  monster catalog: record 5 decodes to a legible 7-species group).
  Sections 5/7/8 reached rendered/partial status.
- `pcfile-character-fields` — traced the doc's own "known lead"
  (`CODE+0x3eb44`) precisely: the class byte is record offset `+415`
  (the same roster array as `+0`, accessed via a pointer pre-offset by
  415, not a separate structure) — confirmed by 75 call sites `CMPI.B`ing
  it against valid 0-13 class literals. `+412` (WPORT portrait) also
  re-confirmed. ~70 other offsets have confirmed access sites but only
  hypothesis-level semantics (no live character data exists in the
  shipped corpus to check against).

**Given a bounded, non-blocking lift (per `seer/docs/walker.md`'s own
guidance not to over-invest):**
- `maze-plane-semantics` — confirmed the facing↔coordinate-delta↔plane
  mapping via direct disassembly of the two previously-uncited helper
  functions (`CODE+0x908c`/`0x90f6`): facing 2 steps to `(x,y-1)` and
  reads that neighbour's plane A; facing 3 steps to `(x-1,y)` and reads
  plane B — the classic shared-edge wall-storage scheme. Left the broader
  value→meaning mapping open, as the walker plan explicitly recommends.
- `wport-portrait-identity` — found no race/class-gating code in the
  loader (only a generic platform-variant filename-suffix selector);
  working hypothesis is a free player-chosen portrait gallery, not
  identity-bound. Not conclusively confirmed (the picker UI itself wasn't
  located) but a genuine advance over "not traced".
- `msg-hdr-field-a` — traced one level further (the wrapper at
  `CODE+0x872`) but its own callers weren't found; still open,
  still doesn't block anything.

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — extensive updates across §1.4,
  §2.6, §4.7.2-§4.7.5, §5.2, §5.3, §6.4, §7.1, §7.2, §7.3, and the §9
  confidence-summary table; all superseded claims kept in place with
  `> **Correction:**` blocks per this project's convention, none silently
  deleted.
- `tools/wizardry6/decode-scenario-items.ts` — new extractor for the item
  catalog (`scenario.dbs` section 1), writes
  `public/assets/wizardry6/amiga/data/item-catalog.json` (500 records,
  452 named). `npx tsc --noEmit` and `npx eslint` both clean.
- `docs/wizardry6/TODO.md` — 4 Amiga rows deleted (solved), 9 rewritten
  with sharpened, evidence-pointing descriptions reflecting this
  session's progress.
- `docs/wizardry6/plan.md` — this entry.

No `re-codebreaker`/`re-oracle` escalations were needed this session —
every item that made progress did so via direct disassembly tracing
(mostly delegated to parallel `amiga-disasm` agents, each given a
self-contained brief with exact addresses/conventions from the existing
doc) or direct statistical/byte-level analysis, consistent with the
"find the reader, not the format" method already established for this
corpus. Every agent-reported claim used in the doc was independently
re-verified against the raw corpus bytes in this session before being
marked confirmed — one of those re-verifications (the class-mask byte
order) caught and fixed a real bug that would otherwise have shipped in
the extractor.

## DOS/EGA — Session 4 (2026-08-02) — overlay internals one layer down: `wmaze.ovr` handlers traced, race-table blocks decoded

Scope: the 2 remaining DOS/EGA `docs/wizardry6/TODO.md` rows
(`dosega-ovr-loader-internals`, `dosega-wpcmk-wpcvw-race-table`), both
narrow follow-ons from Session 3's overlay-loader trace. Worked entirely
via `radare2` (`-a x86 -b 16`) using the file-offset-as-address convention
established last session (verified again this session: near-`CALL`/`JMP`
targets that land inside `[0, fileSize)` disassemble to real function
prologues; targets that wrap outside the file are calls into resident
code elsewhere in the shared segment, not resolvable from this file
alone).

**Confirmed this session** (`dosega/data-structure.md` §6.4a):
- `wmaze.ovr`'s state-6 handler (`0x3d3`, "entering a maze level") and
  state-5 handler (`0x2abc`, "per-step/enter maze view") fully traced.
  State 6 scans `scenario.dbs` section-3 entity records per-region
  (`+0x6c0` start-index → sequential scan while `+0x510` region-key
  matches → `+0x360` active-check) to place monster/NPC markers, and
  separately walks the mazedata level record's `+0x4fa`/`+0x512`
  per-region 5-slot word arrays (12 regions × 5 slots) to stamp
  feature-code `1` onto specific cells. State 5 reads the player's current
  cell and transitions to `curState:=0xa` when it holds that same code —
  first disassembly evidence for what feature-code `1` does (a
  door/interactive-tile trigger, working label only).
- `sub_1d1` confirmed as `SetMazeCell(region,y,x,value)` (read-modify-write
  with 0-7 coordinate wraparound); `sub_42` confirmed as the lazy
  `SAVEGAME.DBS`/`SOUND00.SND` opener, and along the way found two new
  mazedata per-region byte fields (`+0x1e0`/`+0x1ec`, origin-offset
  X/Y — the DOS-side concrete confirmation of the Amiga corpus's "12
  regions placed via an origin table" mechanism).
- The `0x7d2` "event table" from Session 3 was **corrected**: not a far
  dispatch-pointer table, but a 4-byte-stride array of two-word field
  descriptors passed to a resident save-record I/O helper — and a second,
  structurally identical table at `0x80a` does the same job for
  `SOUND00.SND`.
- This also gave **DOS-side cross-platform confirmation** of the Amiga
  corpus's `scenario.dbs` section-3 entity fields `+0x360` (kind/active
  byte), `+0x3f0`/`+0x480`/`+0x510` (coordinate/region keys), and `+0x6c0`
  (per-region entity-start-index) — independently derived from DOS
  disassembly, landing on the exact same byte offsets and single-byte
  widths the Amiga corpus already reported. Worth relaying to whichever
  session next touches `amiga/data-structure.md`'s `scenario-section3-fields`
  and `maze-plane-semantics` TODO rows (not edited this session — Amiga
  docs were out of scope, another agent's file this session).

**Race table** (`dosega/data-structure.md` §6.6): decoded block 3 (11
per-race base-attribute rows) and block 4 (10 per-race×class rows) to
concrete numeric tables. Found a new structural signal in block 4 — 5 of
14 columns are constant across all 10 rows, and they're exactly the
classes block 2 gives a single-attribute requirement to — sharpening the
"race×class cross-reference" guess into "per-race cost/difficulty to
qualify for each class." Re-scanned block 1 (previously "~30 tokens") and
found it's precisely 56 tokens = 14 rows × 4 fixed-width bit-columns
(10/7/5/8 bits, one always-zero) followed by a `"***"` terminator,
matching the confirmed class order — column-A's values cluster by
class *combat role* (7 classes share one identical pattern) rather than
varying per class, suggesting a category/eligibility mask rather than a
unique-per-class value.

Then went looking for the race roster/count this task asked for: no
plain-string race list exists anywhere in the corpus (checked every
`.ovr`/`.dbs`/`.hdr` file), but decoding `msg.dbs` via the already-committed
`decode-dosega-msg-text.ts` and substring-searching its output found
`HUMAN` and `ELF` as clean, standalone Huffman records, plus `DWARF`,
`GNOME`, `LIZARDMAN`, and `FELPUR[R]` embedded (lower confidence) in
three overlapping/garbled records on the same `msg.dbs` page — 6 of the
presumed 11-race roster located directly in the game's own text data,
corroborating block 3's row count from independent in-corpus evidence
for the first time. Row *order* is still not resolved: a promising lead
(the `ELF` message-ID constant appears twice in `wpcvw.ovr`'s code, each
immediately next to an 11-bounded and a 14-bounded jump dispatch —
race/class count match) dead-ends because both dispatchers' targets
resolve outside `wpcvw.ovr`'s own file bounds, into the same untraced
resident-code region as this session's `wmaze.ovr` helpers.

**Files written:**
- `docs/wizardry6/dosega/data-structure.md` — new §6.4a; §6.5 and §6.6
  rewritten with correction blocks (not silent overwrites) for the
  `0x7d2` table and block 1/3/4 characterizations; §8 confidence table
  updated.
- `docs/wizardry6/TODO.md` — both DOS/EGA rows kept open (neither item
  fully closed) but rewritten to point at the new evidence and narrow the
  remaining question.
- `docs/wizardry6/plan.md` — this entry.

No new committed extractors this session (disassembly/data-analysis
findings only; re-ran the existing `decode-dosega-msg-text.ts` unchanged
to search its output, no code changes). No `re-codebreaker`/`re-oracle`
escalation needed — both items advanced via direct `radare2` disassembly
and the existing msg.dbs decoder, and neither stalled against 2+ failed
hypotheses (the "paths tried" tables in §6.6 record what was tried for
row-order resolution, which remains open for a future session with
`wmexe.ovr` traced as a prerequisite).

## Amiga — Session 6 (2026-08-02) — TODO sweep: all 9 remaining rows advanced, one prior-session claim caught and refuted

Scope: worked all 9 Amiga-tagged `docs/wizardry6/TODO.md` rows in the
priority order given (monster-stat-block, pic-cel-list-mapping,
item-catalog-remaining-fields; scenario-sections-5678,
scenario-section3-fields; pcfile-character-fields, wport-portrait-identity,
msg-hdr-field-a, maze-plane-semantics). Dispatched 5 parallel
`amiga-disasm` agents for the deepest disassembly-tracing items
(monster-stat-block, pic-cel-list-mapping, item-catalog-remaining-fields,
scenario-sections-5678, scenario-section3-fields) with self-contained
briefs quoting exact addresses/conventions from the doc; handled
msg-hdr-field-a and wport-portrait-identity directly via `radare2` raw
byte-pattern/displacement scans against the extracted CODE hunk.
**Every agent-reported claim used in the doc was independently
re-verified against raw corpus bytes or re-disassembled directly in this
session before being written up as confirmed** — this is now the
project's standing practice, and it mattered again this session (see
below).

**Process finding, not a format finding: caught an unverified claim that
had already made it into `TODO.md`/`plan.md`.** The prior "Amiga TODO
sweep" session's entry (above, same file) reported "Section 6 is now
confirmed (400x32B monster encounter/spawn groups...)" for
`scenario-sections-5678`, but this claim was **never actually written
into `data-structure.md` or any investigation file** — checked
exhaustively (grep across the whole `docs/wizardry6/amiga/` tree) before
trusting it as a starting point. Dispatching a fresh agent to verify it
from scratch found it **refuted**: section 6 is a general scripted
event/opcode table (8-subentry x 4-byte records, 45-entry dispatch;
message-display/probability-gate/dice-roll/state-reset op codes), not
monster data — independently re-derived in this session with a
from-scratch Python re-parse (exact histogram match, 174/174 and 46/46
msg.hdr trigger-ID cross-checks reproduced exactly). Lesson for future
sessions in this project: a TODO/plan-log status claim without a
corresponding `data-structure.md` section is not evidence, regardless of
how confidently it's phrased — always chase the evidence pointer before
building on a prior session's reported result.

**Solved / substantially advanced this session:**
- **`monster-stat-block`**: AC (`+0xbe`, signed byte, range -14..+12,
  Pearson r=-0.566 vs XP) and monster level (`+0xd4`, coarse 4-tier, tier
  median XPs 5154/10477/59947/91860) confirmed, found via a newly-located
  "character record -> monster-slot" conversion routine
  (`CODE+0x290b6`-`0x29146`) that let monster fields be cross-checked
  against already-traced `pcfile.dbs` character fields. HP and alignment
  were not found despite a full ~87KB combat-subsystem sweep; two
  alignment candidates (`+0xd9`, `+0xd6`) were tested and ruled out with
  concrete reasons (creature-trait clustering, UI-shaped source field)
  rather than left as untested guesses.
- **`pic-cel-list-mapping`**: all 3 runtime side tables traced to their
  source. Table 2 (`-0x2e9e/-0x2e9f/-0x2ea0(a4)`) has a found writer
  (`CODE+0x14ad8` + 5 duplicated copies). Tables 1/3 (`-0x39b2(a4)`,
  `-0x3a66..-0x3a90(a4)`) have **no field-level writer anywhere in the
  351KB CODE hunk** — both live inside one 314-byte resource-cache slot
  (`-0x3ae4(a4)`, 64 slots) populated by a single bulk file `Read()`, not
  copied from the monster record. This 314-byte/64-slot cache was
  **independently rediscovered from the opposite direction** by the
  `scenario-sections-5678` agent while tracing section 8's reader — two
  agents dispatched for unrelated questions converged on the identical
  address/stride/slot-count, a strong cross-confirmation neither agent
  could have faked. Net effect: the cel-list is populated by reading raw
  bytes out of the monster's own selected `.PIC` file (not a static
  per-monster list), narrowing the remaining question to one runtime
  size-table's own initialization.
- **`item-catalog-remaining-fields`**: found that `+18-19` and `+29`
  were never real gaps — both already covered by the doc's own existing
  `+16` (price) and `+28` (special-power-ID) field definitions, a TODO
  bookkeeping slip corrected this session. `+61`/`+69` advanced to
  hypothesis-with-traced-consumer-chain. Exhaustively swept `+31-53`
  (23B), `+64-68` (5B), `+70-73` (4B) across all 23 confirmed category-1
  `ReadSection` call sites — zero consumers found in any of them,
  genuinely open.
- **`scenario-sections-5678`**: section 6 refuted and correctly
  re-decoded (see above); section 7 confirmed (weighted
  encounter-selection, `RandomRange(100)`); section 5 refined; section 8
  still open.
- **`scenario-section3-fields`**: `+0x000` found (a false negative from
  a previous narrow `d16(A4)`-only census — the real access uses
  `(An,Dn.L)` indexed addressing; resolves to a msg.dbs trigger ID for a
  per-entity conditional message, independently re-verified). `+0x120`'s
  consumer found (mechanism confirmed, exact resource type still
  hypothesis). The `+0x360` kind-byte's full 26-entry dispatch table
  located (`CODE+0xeb30`); all 20 kind values actually present in the
  data now have a located handler address, with 3 (teleporter,
  token-placement, conditional-message) semantically confirmed. TODO row
  deleted — the structural/mechanism question this item tracked is now
  closed; the residual (14 handler addresses without full semantic
  decode) is minor and left as a natural future-session starting point
  rather than a tracked blocker.
- **`msg-hdr-field-a`**: found `CODE+0x872`'s callers directly via
  radare2 (it's A4 jump-table entry 15, `LoadMessage(triggerID,
  destBuffer)`, 287 confirmed call sites via a raw-opcode census) —
  previously reported as "likely reached through an unresolved indirect/
  A4 form," now confirmed exactly which entry and how many sites. One
  literal call-site trigger ID spot-checked byte-exact against a real
  `msg.hdr` field-A value.
- **`maze-plane-semantics`**: relayed a cross-platform finding from a
  parallel DOS/EGA session working `wmaze.ovr` in the same window —
  `+0x4fa`/`+0x512` (previously "unidentified per-region word arrays")
  are a confirmed per-region `(Y,X)` cell-coordinate list that gets
  feature-code `1` stamped on level load, with feature-code `1`
  independently corroborated as a door/interactive-tile trigger by the
  same session's state-5 handler trace. Flagged in the doc as
  cross-platform-confirmed rather than Amiga-disassembly-confirmed (the
  DOS session traced DOS code, not `Bane`) since the underlying
  `scenario.dbs` bytes are already known byte-identical across ports.
- **`wport-portrait-identity`**: one further bounded attempt (per the
  walker plan's "not much more" guidance) — a raw-opcode census for a
  41/42-bound picker-loop constant found zero hits, a genuine negative
  data point against the simplest picker implementation, though not
  conclusive. Hypothesis unchanged.

**Given a real ceiling, not pursued further this session (per the task
brief's own guidance):** `pcfile-character-fields` — no live character
data exists in the shipped corpus to cross-check hypothesis-level field
labels against, and this was already established last session.

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — updates across §2.6, §4.7.3,
  §4.7.4, §4.7.5, §5.3, §6.2, §7.1 (monster catalog, item catalog,
  sections 5-8); all superseded/refuted prior claims kept in place with
  `> **Correction:**` blocks, none silently deleted.
- `docs/wizardry6/TODO.md` — `scenario-section3-fields` row deleted
  (resolved); the other 8 Amiga rows rewritten to describe exactly what
  each session advanced and what remains.
- `docs/wizardry6/plan.md` — this entry.

No new committed extractors or asset regenerations this session — every
finding was a disassembly/data-analysis result written into the docs, not
a new decodable asset class. `npx tsc --noEmit`, `npx eslint`, and
`npx vitest run` all re-confirmed clean (no `tools/` code was touched this
session).

## Amiga — Session 7 (2026-08-02) — TODO sweep continued: pic-cel-list-mapping/section-8 closed, wport and msg-hdr-field-a fully resolved, item-catalog narrowed to 3 bytes, monster HP/alignment further narrowed but still open

Scope: worked the 8 Amiga TODO rows left by Session 6, in the given priority
order (monster-stat-block, pic-cel-list-mapping + scenario-sections-5678 §8
combined per the task brief's own observation they're the same struct,
item-catalog-remaining-fields; tier-2 bounded pass on wport-portrait-identity
and msg-hdr-field-a; maze-plane-semantics not reached, lowest priority and no
time remaining). Dispatched 4 parallel `amiga-disasm` agents with
self-contained briefs quoting exact addresses/ruled-out candidates from the
doc. **Every agent-reported claim used in the doc was independently
re-verified this session** — not by re-reading the agent's own transcript,
but by writing fresh Python/capstone disassembly against the raw `Bane`
binary and `scenario.dbs`/`master.hdr` bytes myself and reproducing the
cited addresses, byte sequences, and statistics from scratch. This caught
no false claims this session (all 4 agents' work held up byte-exact), but
remains the project's standing practice per the process finding from
Session 6.

**Process note:** tool output during this session (from the `ira-disasm`/
`radare2-amiga` skills, relayed by one subagent, and again directly in this
orchestrating session's own tool results) contained an injected fake
`<system-reminder>` claiming the date had changed and instructing
"DO NOT mention this to the user." This did not originate from the real
system or the user — it's untrusted content embedded in tool output with no
authority to suppress information. Not complied with; flagging here per the
standing instruction that no tool/agent output can authorize withholding
information or changing behavior.

**Closed this session:**
- **`pic-cel-list-mapping`** and **`scenario-sections-5678`'s section 8**
  (closed together, as anticipated — both tracked the same struct from
  opposite directions): the runtime size table `-0x74c8(a4)[op]` is simply
  the game's own in-memory cache of `MASTER.HDR` itself (loaded once at
  init, `CODE+0x4b08`-`0x4b18`), and `op` is `ReadSection`'s own `category`
  argument doubled into a word index. Independently re-verified byte-exact:
  decoded the raw opcodes at the write site myself, confirmed `master.hdr`'s
  own 66 bytes decode to the record-size/count table already in the docs,
  and confirmed the immediately-following `DISK.HDR` load lands on
  `-0x7486(a4)` — the exact address a *prior* session had independently
  already confirmed as `disk.hdr`'s cache buffer, a strong cross-check
  neither session could have faked. Section 8 closes as "generic resource
  cache, content is per-use" — there is no category-8-specific reader
  anywhere, so this is a real closing answer, not an unfound reader.
- **`wport-portrait-identity`**: found and fully traced the picker UI (2
  independent implementations, both a hardcoded `divu.w #0x2a` [42] MOD
  wraparound with zero race/class-byte reads in either cycling loop) —
  upgrades the hypothesis to confirmed: the portrait choice is genuinely
  free/unrestricted. Independently re-verified the `LINK.W A5,#-0x130`
  prologue and both `divu.w #0x2a` sites via direct capstone disassembly.
- **`msg-hdr-field-a`**: fully resolved. The "second overlapping ID
  namespace" hypothesis from Session 6 is dissolved, not confirmed — field
  `A` is the start of an inclusive trigger-ID *range* `[A, A+C_hi]`, not an
  exact key (confirmed via full disassembly of the binary-search body,
  `CODE+0x730`-`0x79c`, independently re-verified instruction-by-instruction
  this session). Re-testing all 165 literal call-site trigger IDs against
  range membership instead of equality: 165/165 (100%) resolve, zero
  misses. The previously-flagged "mismatch" pairs are multiple call sites
  sharing one message record's range, not a second namespace.

**Narrowed, not fully closed:**
- **`item-catalog-remaining-fields`**: narrowed from 32 open bytes across 3
  gaps to exactly 3 bytes (`+31`, `+32`, `+73`). A new consumer function
  (`CODE+0x3bf3c`-`0x3c220`) outside the previously-known 23 category-1
  `ReadSection` call sites resolved 29 of the 32 bytes, including a 13-byte
  per-class equip-bonus array (`+33`-`45`) and an 8-byte per-slot
  resistance-shaped array (`+46`-`53`). Root cause of why 2 prior sessions'
  sweeps missed this: `Bane.cnf` only marks ~5.5KB of the 351KB CODE hunk
  as real code, so every text-based sweep over `Bane.asm` searched only
  ~1.5% of the actual code. Independently re-verified byte-exact: traced
  the whole function myself via capstone against the raw CODE hunk and
  confirmed every cited displacement. New TODO row added
  (`amiga-ira-cnf-coverage-gap`) since this is a standing project-wide
  infrastructure gap, not specific to the item catalog.
- **`monster-stat-block`**: HP and alignment remain unlocated. Extracted
  the full character->monster-slot conversion field list (11 `pcfile.dbs`
  offsets, all independently re-verified via direct capstone disassembly of
  `CODE+0x28fee`-`0x29342`) — 2 more HP/alignment candidates were tested
  and refuted with concrete statistical reasoning (`+0xd6`: no
  Good/Neutral/Evil name-shape, refuted; `+0x86`/`+0x87`: too-narrow range
  and near-zero current/max correlation, refuted as HP). Directly tested
  and refuted the task brief's own specific hypothesis:
  `pcfile.dbs+420`/`+421` (flagged gender/alignment *setter* candidates)
  are confirmed **not** copied by this routine. Two further avenues closed
  as genuine dead ends (not just untried): an HP-flavor-text search across
  all 724 decoded messages (0 hits — this build has no HP flavor-text
  system at all) and a `*100/max` percentage-bar literal-immediate census
  (0 hits). ~75KB of the combat subsystem remains genuinely un-walked;
  flagged a new lead (the "X'S GHOST" monster-name cluster, a PC-to-monster
  conversion trigger context) for a future session, unexplored this pass.
  Also documented a caution: the newly-found `+0xd0` = `pcfile.dbs+415`
  (class) copy is only class-shaped for *converted-PC* combat slots — real
  on-disk monster records show `+0xd0` ranging 0-26, a different,
  overloaded field for ordinary monsters.

**Not reached**: `pcfile-character-fields` (real ceiling already
established, no live data to cross-check — correctly not pursued per the
task brief) and `maze-plane-semantics` (lowest priority, no time
remaining this session).

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — §2.6 (pic-cel-list-mapping,
  closed), §5.3 (wport, closed), §6.2 (msg-hdr field A, closed), §7.1
  (section 8 closed; item catalog narrowed to 3 bytes with 10 new
  access-confirmed fields; monster stat block's conversion-routine field
  list extended, 2 more HP/alignment candidates refuted). All superseded
  claims kept in place with `> **Final update:**`/`> **Correction:**`
  blocks, none silently deleted.
- `docs/wizardry6/TODO.md` — deleted `pic-cel-list-mapping`,
  `scenario-sections-5678`, `wport-portrait-identity`, `msg-hdr-field-a`
  (all closed); rewrote `monster-stat-block` and
  `item-catalog-remaining-fields`; added `amiga-ira-cnf-coverage-gap`.
- `docs/wizardry6/plan.md` — this entry.
- `tools/wizardry6/decode-scenario-items.ts` — added 10 new named fields
  (`bonusBlock24to27Hex`, `classBonusArray33to45Hex`,
  `slotArray46to53Hex`, `equipCacheByte64/65/72`,
  `runningMaxInput66/67`, `slotLocalByte68`, `weightDeduction70`,
  `ammoStat71`); narrowed `undecodedHex` to the genuine 3-byte residue
  (`+31-32`, `+73`); fixed the stale `+18-19`/`+29` note.
- `tools/wizardry6/decode-scenario-monsters.ts` — renamed `xpGuess` to
  `xp` (now CONFIRMED, not hypothesis) and added `ac`/`levelTier` as
  confirmed fields, matching the doc's already-confirmed §7.1 findings
  (these were previously only in the doc, not exported).
- Re-ran both updated extractors end-to-end against the real corpus
  (`public/assets/wizardry6/amiga/data/item-catalog.json`,
  `monster-mapping.json`) and spot-checked output values byte-exact
  against the doc's cited numbers (e.g. `RAT` xp=150/ac=5/levelTier=1).
  `npx tsc --noEmit`, `npx eslint`, and `npx vitest run` (18/18 tests) all
  clean.

No `re-codebreaker`/`re-oracle` escalation needed — every item advanced via
direct disassembly tracing (mostly via raw capstone/r2 against the CODE
hunk rather than the existing `Bane.asm`, whose IRA `-preproc` coverage gap
was itself a finding this session) and none stalled against 2+ genuinely
different failed hypotheses without also finding a resolving lead.

## DOS/EGA — Session 5 (2026-08-02) — `wmexe.ovr` disassembled: resident library found in `wroot.exe` itself, not `wmexe.ovr`; race-table `ELF`-ID lead refuted, new `pcfile.dbs +405` field found

Scope: both remaining DOS/EGA `docs/wizardry6/TODO.md` rows
(`dosega-ovr-loader-internals`, `dosega-wpcmk-wpcvw-race-table`), both of
which pointed at the same untraced file (`wmexe.ovr`) as the next step.
Primary target per the task brief: disassemble `wmexe.ovr`.

**Key result: the "resident helper" functions called from every overlay
are not in `wmexe.ovr` — they are in `wroot.exe`'s own permanently-loaded
code.** Derived and verified a general address-translation formula for
near-relative `CALL`/`JMP` instructions that leave their own overlay's
file bounds: `true_target = (naive_apparent_target + 0x4564) mod 0x10000`
(equivalently, correct for the real runtime buffer offset `0x4572` instead
of naively treating file offset 14 as the code-region origin). First
confirmed by hand (`wmaze.ovr`'s call to naive target `0xcbc0` resolves to
`wroot.exe` module offset `0x1124`, a genuine function `wroot.exe`'s own
code independently calls too, with identical literal args), then applied
corpus-wide: disassembled all 11 overlays' full code regions and
classified every one of 9,251 near-relative `CALL` instructions as
in-overlay-file, in-`wroot.exe`, or unresolved — **zero unresolved, across
every single overlay including `wmexe.ovr` itself** (which turns out to
behave identically to every other overlay: 557 in-file / 290 into
`wroot.exe`, no special "resident code" character at all). This fully
refutes the prior session's "most likely `wmexe.ovr`" hypothesis and
answers the TODO item's core question. Named 11 previously-opaque call
targets as `wroot.exe` module offsets, including `GetMazeCell`/
`SetMazeCell`/`GetMazeWord` primitives and a correction: the target
previously labeled "`errHandler`" (`0xc47e`) is actually `RandomRange(n)`
(disassembled in full: `if(n<=0) return 0; else return Rand()%n`), and is
in fact the corpus's *second*-most-called resident function (308 sites).
`BuildFilename` (`0x390e`, already confirmed by role in §6.2) was
independently cross-validated by call count (90 corpus-wide sites),
adding confidence to both the formula and the methodology.

**Race table**: pursued the previous session's "`ELF` message-ID next to
bounded dispatchers" lead now that the addressing formula made the
dispatchers' targets traceable — and found the lead itself was a false
positive: the two byte-pattern "hits" for `ELF`'s message field-A value
(`15824`) in `wpcvw.ovr` are not `CMP AX,0x3dd0` instructions at all, just
a jump-table's last byte glued to the next instruction's first opcode
byte (same class of artifact as the corpus's already-documented
`QMON00.PIC` false string). Traced both dispatchers anyway (now
tractable): the 11-way one is keyed on a **newly confirmed `pcfile.dbs`
field, `+405`** (race index 0-10 — cross-validated by recovering the live
character array's base address from a 354-site census of the record's
`imul...0x1b0`-indexing idiom and confirming it reproduces the
already-known `+412` WPORT field exactly), and both dispatchers turn out
to apply numeric race/class stat-bonus deltas via an in-file
`AdjustClampedByte`-style helper — not to display race names — so even
fully resolved, this path doesn't answer row order. Found a second,
independent, more promising lead in `wpcmk.ovr` (character *creation*):
its own 11-way dispatcher references an 11-entry, 9-byte-stride pointer
table (fits fixed-width race names exactly), but the pointers are
`DS`-relative and resolve to a runtime-only buffer (confirmed out of
`wroot.exe`'s static file range) — a targeted writer census across all 11
overlays and `wroot.exe` found no populator for it. Row-to-race mapping
remains genuinely open; the paths-tried table in `dosega/data-structure.md`
§6.6 now has 8 distinct documented attempts.

**Files written:**
- `docs/wizardry6/dosega/data-structure.md` — new §6.4b (resident-library
  location, formula, corpus-wide verification table, named-function
  table); correction blocks added to §6.4a (resident-target names,
  `errHandler`→`RandomRange` correction) and §6.6 (`ELF`-lead refutation,
  new `+405` race field, new `wpcmk.ovr` 9-byte-stride lead); §6.5 and §8
  updated.
- `docs/wizardry6/TODO.md` — both DOS/EGA rows rewritten: the first now
  records the resolved resident-library-location question (kept open only
  for the ~73 uncharacterized resident functions and untraced overlay
  bodies); the second records the refuted `ELF` lead, the new confirmed
  field, and the new unresolved `wpcmk.ovr` lead.
- `docs/wizardry6/plan.md` — this entry.

No new committed extractors this session (disassembly/data-analysis
findings only — the new `pcfile.dbs +405` field and the resident-function
names are documentation-level results, not yet wired into any extractor
since no live character data exists in the corpus to render). No
`re-codebreaker`/`re-oracle` escalation used: the primary target
(`wmexe.ovr`) did not stall — it resolved cleanly and productively via
direct disassembly once the addressing formula was derived. The race-table
row-order question has now accumulated well over the "2+ distinct failed
hypotheses" bar the escalation ladder describes (8 documented attempts
across sessions) and is a reasonable `re-codebreaker` candidate for a
future session, but wasn't escalated this session since real, non-stalled
progress was still being made through direct methods (the new `+405`
field and the `wpcmk.ovr` lead were both found this way, not by hitting a
wall).

## Amiga — Session 8 (2026-08-02) — tooling fix: `Bane.cnf` IRA coverage gap closed

Bounded infrastructure task (not new game-data RE): fixed the
`amiga-ira-cnf-coverage-gap` TODO row Session 7 opened. Prior sessions'
`docs/wizardry6/amiga/disasm/Bane.cnf` only declared an explicit `CODE`
range for a ~5.5KB cluster near `0x55032`-`0x5658a` out of the
351,292-byte (`0x55C3C`) CODE hunk — the remaining ~345KB fell back to
undifferentiated `DC.L` hex in `Bane.asm`, meaning every text/regex sweep
over that file (across at least 2 prior sessions) had only ever searched
~1.5% of the real code. Checked `~/.claude/skills/ira-disasm` first per
the task brief's instruction to look for a documented fix before
reinventing one — no dedicated `game-re-lessons` pitfall file exists yet
for this specific "large hand-optimized binary" failure mode (only inline
mentions in this project's own `data-structure.md`/`Bane.cnf` comments),
but the skill's generic `-preproc`/hand-edit-`.cnf`/`-config` refine loop
was directly applicable and sufficient — no need to invent new tooling.

**Fix applied:** replaced `Bane.cnf`'s `CODE $00000000 - $00000006` line
(which only covered the header's 6-byte warm-jump instruction) with
`CODE $00000000 - $00055032`, then regenerated via
`ira -a -compat=bi -config -keepzh Bane Bane.asm`. Also explicitly checked
the task brief's second concern — whether undeclared code exists *after*
the old cluster, between `0x5658a` and the CODE hunk's real end — and
confirmed by hunk-size arithmetic (`0x55C64` file end `-` `0x28` file
start `=` `0x55C3C` exactly matches the doc's stated 351,292-byte payload)
that the `.cnf`'s existing last range (`CODE $00055C0A - $00055C3C`)
already reaches the true end of the CODE hunk; no fix needed there.

**Verification:** IRA's own run log confirmed the new range merged with
the adjacent declaration into one contiguous `CodeArea[0]: 00000000 -
00055070`. Computed declared-code coverage from the full `CodeArea` list:
99.47% of the CODE hunk (349,446 / 351,292 bytes), up from ~1.5%.
Concretely: `Bane.asm` grew from 23,032 lines (22,343 `DC.*` hex, 374 real
instructions) to 113,178 lines (2,778 `DC.*`, 93,841 real instructions). A
Python scan of every disassembled line's address comment found 94,451
lines now falling in the previously-100%-invisible `0x1000`-`0x4FFFF`
span (0 before the fix). Spot-checked the exact offsets §7.1's
item-catalog "Final update" block relied on for its raw-capstone trace
(`CODE+0x3bf3c`, `0x3bf78`, `0x3bf94`, `0x3c07a`, `0x3c1c0`) — all five
now appear as real disassembled instructions in `Bane.asm` at those exact
offsets (e.g. `JSR -32664(A4)` at `;3bf3c`, matching `4eac8068`), not
`DC.L` hex.

**Known residual limitation, left as-is (out of scope for this fix):**
embedded string/data literals inside the newly-code-classified region
(e.g. the filename table at `CODE+0x4c9c`) still disassemble as garbage
instructions rather than `DC.B` text, since no `-text=1` pass or
`.cnf` `LABEL` data-range refinement was applied this session — a future
session doing a deep read of a specific function can add targeted `LABEL`
data-range entries around known string tables if it wants clean text
output there; not needed for the coverage goal itself.

**Explicitly out of scope, per the task brief:** did not re-run any prior
RE finding against the newly-visible ~345KB as a full re-audit — that
would be a large, separate undertaking. This session only confirms the
tooling fix works.

**Files written:**
- `docs/wizardry6/amiga/disasm/Bane.cnf` — added the full-coverage `CODE`
  range.
- `docs/wizardry6/amiga/disasm/Bane.asm` — regenerated (113,178 lines, up
  from 23,032).
- `docs/wizardry6/amiga/data-structure.md` — §1, appended a
  `> **Resolved (this session):**` block documenting the fix and
  verification evidence in place (old text kept, not deleted).
- `docs/wizardry6/TODO.md` — deleted the `amiga-ira-cnf-coverage-gap` row
  (resolved).
- `docs/wizardry6/plan.md` — this entry.

No `re-codebreaker`/`re-oracle` escalation needed — this was a
self-contained config fix, not a genuine RE wall. No `re-learn` harvest
run this session: the generic technique (extend a `.cnf`'s `CODE` range
to cover a whole hunk when `-preproc` under-detects on a dense,
string-literal-heavy hand-optimized binary) is already implicit in the
`ira-disasm` skill's refine-and-repeat loop description; a future session
could still consider writing a dedicated `game-re-lessons` pitfall file
once this pattern is confirmed to recur on a second binary/project, but
one confirmed instance didn't clear that bar on its own.

## Amiga — Session 9 (2026-08-02) — full-coverage re-audit of coverage-limited negative claims

Scope: the previous session (Session 8) fixed `Bane.cnf`'s coverage gap
(1.5% -> 99.47% of the CODE hunk declared as real code) but explicitly did
not re-run any prior finding against the newly-visible ~345KB. This
session is that re-audit: grepped `data-structure.md`/`TODO.md` for
absence/negative-claim language ("no hits", "zero consumers", "not
found", "exhaustively checked", "swept", "census", "no writer found",
etc.), built a candidate list, and re-ran each one against the
now-greppable 113,178-line `Bane.asm` or a fresh targeted disassembly
pass, per the task brief's explicit priority ordering.

**Top-priority target, given real dedicated effort: `monster-stat-block`'s
HP/alignment fields.** Walked the full previously-"un-walked" ~75KB
combat-subsystem range (`CODE+0x14c00`-`0x29988`) directly against the
new `Bane.asm`. Result: **HP/alignment remain genuinely open**, but 4
independent full-binary censuses that were only ever run against the old
~1.5% window now come back as hard, exhaustive negatives instead of
partial ones:
- `RollDice` (`CODE+0x15e8a`) callers: re-confirmed exactly 3, all inside
  `LoadMonsterIntoSlot`, all already-accounted-for attack/damage dice —
  no possible 4th "roll HP" call exists anywhere in the binary.
- The death-message function (`CODE+0x22c36`) callers: re-confirmed
  exactly 1 (`CODE+0x230ee`), morale-gated, matching the existing finding
  exactly.
- New: a whole-binary SUB/ADD mutation search across the static
  per-slot monster-record clone (`-0x3bbe(a4)[slot]`, 151 total
  references) found **zero** mutating instructions — every access is
  `MOVE`/`CMPI`/`TST`/`PEA`. This is new structural evidence against "HP
  is a direct mutable field of the static catalog record."
- New: fully mapped the sibling 44-byte-stride runtime attack-record
  array (`-0x3ba2(a4)[slot]`, shared with a parallel party-side
  populator function at `CODE+0x16364`, not previously traced). Its only
  mutable fields (`+2`/`+4`) trace through to a per-character 432-byte
  `pcfile.dbs`-stride save array — reads as player spell/wand charges,
  not monster HP. Ruled out.
- Byproduct, not HP-related: traced the "weighted spell/special-ability"
  array's real base to record offset `+0x53` (not the previously
  hypothesized `+0x8a`, which is now superseded, not deleted), resolving
  the doc's own flagged "not reconciled" contradiction. Also found a new
  gating byte at `+0x51`.
- New observation: record offset `+0xdc`'s 3 flag bits are read (`BTST`)
  at 4 sites and cleared once, but never explicitly *set* by any
  instruction anywhere in the binary — likely static per-monster-type
  catalog data, not a runtime HP-trigger flag.

Net: the "~75KB genuinely un-walked" caveat from the prior session no
longer applies in the same way — the range has now been walked and
censused 4 independent ways with zero HP candidates found. This is a
substantially stronger negative than before, not a resolution. Remaining
lead unchanged: the "X'S GHOST" monster-name cluster, still unexplored.

**Other candidates re-checked, all confirmed unchanged (converted from
coverage-limited to hard negatives):**
- `-0x2c65(a4)` (maze-renderer backdrop-clip flag, §4.6's paths-tried
  table): re-grepped the full binary — still exactly 3 references, all
  reads, zero writers.
- `-0x3adc(a4)`/`-0x3aaa(a4)` (the "~20 unrelated call sites" table from
  the same section): re-grepped — 19 references each (38 total), every
  one a read, zero writers.
- `item-catalog-remaining-fields` (`+31`/`+32`/`+73`): re-checked via a
  second, independent method (IRA text search on the computed
  local-buffer displacements) against the now-full-coverage `Bane.asm`,
  since the original negative came from a raw-capstone pass that had
  already bypassed `Bane.cnf` and so wasn't actually coverage-limited —
  this was a cross-check, not a re-run of a limited search. Zero new
  hits; conclusion doubly confirmed.
- `RollDice`/death-message caller censuses inside §7.1: see above.

**One genuine documentation-debt fix found while re-checking, unrelated
to coverage:** §6.4's `master.hdr` section table still listed
`scenario.dbs` sections 2, 3, and 8 as "undecoded", stale since §4.7's
`re-codebreaker`-escalated dungeon-maze-geometry finding (sections 2/3)
and §7.1's later "confirmed closed, generic resource cache" finding
(section 8) — both already correct elsewhere in the same document (the
§8 summary table), just not propagated back to this earlier table. Fixed
in place.

**One partially-coverage-limited item flagged but not fully re-solved,
given time budget:** `pcfile-character-fields`'s 70-offset field map was
built from a `MULS #$01b0,Dn` census whose raw hit count has risen from
1441 to 1631 (13%) against the new `Bane.asm` — genuinely coverage-
limited, unlike the item-catalog case. A full re-derivation needs
non-trivial per-site base-register tracing (confirmed by a failed
scripted regex attempt this session — the addressing shape varies too
much between call sites for a simple pattern census). Flagged in both
docs as future work, not claimed as re-verified.

**One pre-existing documentation gap found (not a coverage-audit
result):** `scenario.dbs` sections 5/6/7/8 are a genuinely open item with
substantial existing evidence (call-site addresses known, 2 negatives
already closed) but had no `TODO.md` row at all. Added one
(`scenario-sections-5-6-7-8`) per this project's "every genuinely open
item gets exactly one row" convention — this is a housekeeping fix, not
new RE work this session.

**Files written:**
- `docs/wizardry6/amiga/data-structure.md` — §7.1 (new full-coverage
  HP/alignment re-audit block, with the `+0x53`/`+0x51` byproduct
  finding), §4.6 paths-tried table (re-confirmation note for the two
  "no writer found" claims), §6.4 (sections 2/3/8 table rows corrected),
  §7.1 item-catalog block (re-check note), §7.3 (pcfile census coverage
  caveat).
- `docs/wizardry6/TODO.md` — rewrote `monster-stat-block`,
  `item-catalog-remaining-fields`, `pcfile-character-fields`; added
  `scenario-sections-5-6-7-8`.
- `docs/wizardry6/plan.md` — this entry.

No `re-codebreaker`/`re-oracle` escalation used — every re-check resolved
via direct grep/disassembly against the now-complete `Bane.asm`, no wall
hit. No committed extractor changes this session (documentation-level
re-verification and one new structural finding, `+0x53`'s real array
base, which doesn't yet have export-worthy semantics to add to
`decode-scenario-monsters.ts`). No `re-learn` harvest run: the technique
used here (re-run a stale negative against a freshly-fixed coverage gap,
prioritizing the item the task brief flagged as most likely to have been
a coverage artifact) is a direct, unremarkable application of the
escalation ladder's own "re-verify, don't silently trust" guidance, not a
new generalizable lesson.

## DOS/EGA — Session 6 (2026-08-03) — 23 more resident functions named (text/window display subsystem); race-table lead demoted after its consumer was fully traced

Scope: both open DOS/EGA `TODO.md` items — (1) push further into the ~73
uncharacterized `wroot.exe` resident functions, prioritizing high
corpus-wide call frequency, (2) find the writer for `wpcmk.ovr`'s
9-byte-stride candidate race-name table.

**Resident functions — 23 newly named, a coherent subsystem found.** Built
a throwaway capstone-based x86-16 disassembler probe (not committed, per
Method §3) and re-ran the confirmed §6.4b address-translation formula's
corpus-wide `CALL` census independently (cross-validated against the
prior session's named set — every previously-confirmed function, e.g.
`RandomRange`/`GetMazeCell`/`BuildFilename`, reappeared at the same
address with matching relative call-frequency rank, confirming the
formula and offset math before trusting new results). Disassembling the
highest-frequency uncharacterized targets surfaced a single coherent
**text/window display subsystem**: an array of window control structs
registered in a linked list at `CS:0x1bd2`, rendered into an off-screen
character+attribute buffer (40-byte row stride, the EGA planar
bytes-per-row convention already established elsewhere in this corpus)
before being blitted through indirect video-driver vectors. Named:
`CreateWindow` (`0x11a`), `PutChar` unsigned/signed pair (`0x23e3`/
`0x22b7`), `PrintString` unsigned/signed pair (`0x251d`/`0x24e9`),
`ClearWindow` (`0x32be`), an auto-positioning reflow pass (`0x3118`),
an ownership-release scan (`0x31d1`), `RefreshWindow` with an embedded
display-corruption fail-safe that prints a message and terminates the
process (`0x2b19`), `RemoveWindow`+free-tag-check (`0x303e`/`0x3b20`),
`DestroyWindow` composite (`0x2d2`), a `printf`-style wrapper (`0x83f`),
and a top-level `RedrawWindow` (`0x9fb`). Two prior-session hypothesis
rows were refined to confirmed and sharply narrowed in the process: `0x30b`
(the single most-called resident function corpus-wide, 564 calls) is
`SetWindowCursor`, and `0x2a63` is `RefreshAllWindows`, not a bare
"table-lookup helper". Also named 3 DOS/runtime-service wrappers found by
following the subsystem's own callees (`strlen`, a `malloc`-style heap
allocator, `int 21h` file-close/free-memory-block wrappers), a shutdown/
cleanup routine (`wroot+0x0`, freeing up to 14 DOS memory blocks and
closing 2 file handles on a fatal error), and 2 smaller helpers (an
input-field keystroke filter, a colour/attribute-table pair). Total named/
characterized resident targets: ~34 of 84 (~40%, up from 11/84).

**Race table — investigated further, demoted rather than resolved.**
Fully disassembled the `wpcmk.ovr` dispatcher's consumer, `0x2c7b`
(previously only characterized by access-pattern shape, not disassembled
line-by-line): it is a per-column maximum-letter-index accumulator into a
*second* buffer, not a string read/display routine, and a signed-
comparison analysis shows it is architecturally a no-op when its input is
zero-initialized memory. Quantified both buffers (`DS:0x52d9`,
`DS:0x559c`) against `wroot.exe`'s own MZ header `MinAlloc` field: both
fall inside the module-end..module-end+`MinAlloc` gap — genuine
DOS-zeroed BSS with no on-disk bytes possible, not an addressing error.
Re-ran the writer census with a desync-resistant method (disassembling
from every `push bp` byte in each file rather than one linear pass, since
a single-pass linear disassembly can silently desynchronize through
inline data — a known corpus pitfall that had caused the prior session's
narrower census to under-report). The broadened census still finds zero
text writers anywhere in the 11-overlay + `wroot.exe` corpus, but does
find the address range is actively written as *unrelated numeric* scratch
state by 4 different overlays (`wmele`/`wmexe`/`wtrea`/`wmnpc`) — a
structural fact incompatible with a stable, persistent race-name table
surviving overlay swaps. Conclusion: the 9-byte-stride/11-entry structural
match to fixed-width race-name storage was most likely coincidental, not
a real table with a merely-undiscovered writer. The row-order question
itself remains open; this specific lead is now believed exhausted rather
than promising.

**Files written:**
- `docs/wizardry6/dosega/data-structure.md` — new §6.4c (13-function
  window subsystem + supporting wrappers), `0x30b`/`0x2a63` rows in
  §6.4b's table refined, §6.6's race-table block rewritten with the
  `0x2c7b` disassembly, the `MinAlloc`/BSS quantification, and the
  broadened writer census, paths-tried table extended, §8 confidence
  summary rows updated.
- `docs/wizardry6/TODO.md` — both DOS/EGA rows updated in place (neither
  closed — both remain genuinely open, narrowed/re-characterized).
- `docs/wizardry6/plan.md` — this entry.

No `re-codebreaker`/`re-oracle` escalation used — both items advanced via
direct disassembly and census work within a single session, no wall hit
meeting the escalation bar. No new committed extractor/asset changes
(pure disassembly/documentation session). No `re-learn` harvest run: the
techniques used (desync-resistant multi-start disassembly census;
quantifying a DS-relative buffer's BSS-vs-file-image status via the MZ
header's own `MinAlloc` field before declaring "no writer possible") are
refinements of this project's existing DOS-tooling notes and the
`compressed-stream-start-offset.md`-family "verify your addressing before
trusting a negative" discipline, not new standalone pitfalls — worth
folding into `game-re-tooling/dos.md` if a future DOS session hits the
same MinAlloc/BSS question on a different target.

## SNES — Session 6 (2026-08-03) — dungeon-view TODO sweep: maze cell format
and frustum offset table cracked by disassembly, palette search space
exhausted, VRAM-path candidates ruled out, bulk wall-content source escalated

Direct continuation of the dungeon-composer session that closed the
compose/placement half of `snes-dungeon-view-render` (§3.14). This session
worked the 4-item follow-up brief in priority order: (1) maze cell-data
decode, (2) palette, (3) VRAM upload path, (4) `0xFFFE`-redirect record
shape (not reached, lowest priority, time did not permit).

**Maze cell format and frustum selection — solved by direct disassembly**
(§3.14.7). Traced outward from the already-confirmed `$80:C69F` entry
point (no new entry point needed): the 26-slot handler dispatch table
(corrected from a prior session's unbacked `$80:D700` citation — caught by
chasing the TODO row's Evidence pointer before building on it, per
`tracker-prose-is-not-evidence.md` — the real table is `$80:DD4B`), the
facing-relative rotation dispatch that selects one of 4 packed 2-bit
wall-type fields per `$7E:4300` cell byte, the `$7E:4540` feature/
orientation byte decode, and the full level-init chain (uniform 24x24
self-propagating seed fill from 14-entry per-level tables, a region-shaped
default-fill overlay, and a scripted per-cell trigger scanner). The
frustum offset table (`$80:DD4B`, 26 signed i16) is the session's
strongest single piece of evidence: its raw values decompose *exactly*
into a 2/3/5/7/9-slot expanding first-person frustum across 5 depths, zero
deviation, matching the independently-confirmed 5-depth piece-table series
one-for-one — a decisive, self-verifying structural check that needed no
external oracle.

**What's still open, and why it's now an escalation, not more manual
tracing.** The mechanism that *selects* a wall type per cell is fully
solved, but two structurally distinct exhaustive byte-pattern censuses
(absolute-long-indexed stores to the wall array; 16-bit-immediate DP-
pointer setups that would precede an indirect bulk-copy loop) both came
back negative for any bulk, ROM-resident, per-cell-distinct wall-content
table — every write path found is either a uniform per-level/per-region
default, or a single one-off scripted toggle, or a per-step trigger
scanner that only ever touches the party's own current cell. This meets
the project's "two genuinely different failed approaches" escalation bar
cleanly (paths-tried table has both rows with distinct concrete reasons),
so this specific sub-question — `snes-maze-wall-source`, split out as its
own TODO row — was escalated to `re-codebreaker` with a self-contained
brief (exact citations, both negative searches, three concrete
hypotheses, and instructions not to just re-run the same two censuses).
Escalation launched in the background; result not yet reviewed this
session (will need the standard `verify-escalation-artifacts-not-just-claims.md`
independent-reproduction pass before anything from it is promoted).

**Palette — search space exhausted, no dungeon-view-specific record
found.** Programmatically swept all 256 possible values of the
already-confirmed `$ca` CGRAM-DMA dispatch selector (prior sessions only
ever checked 0-15 or the ~21 literal call sites found by whole-ROM
census) against the dispatch table's own sanity constraints. Only 4
structurally sane triples exist in the entire value space, and all 4 are
already-claimed resources (portraits, UI icons, creature-sprite family)
except one (`$ca=0x19`) that has zero call sites anywhere in the ROM —
a dead table entry, not a lead. Either the dungeon view has no dedicated
palette load of its own (most likely: it inherits whatever the main
gameplay screen already loaded), or it uses a mechanism outside the `$ca`
dispatcher entirely; the latter is a much larger, unbounded search not
attempted this session given the task's priority order.

**VRAM upload path — named candidates ruled out.** All 5 whole-ROM
occurrences of the literal `LDX #$5000` immediate (the "3-5 unexamined
candidate sites" named by the prior session) were disassembled: one is
clean code but explicitly targets bank `$7F` (a coincidental low-word
match with the already-confirmed BG2 CHR staging range, not `$7E:5000`
at all), and the other 4 sit inside non-code data regions. The real
upload path, if one exists as a distinct traceable hop, remains
unlocated — not escalated this session, lower priority than item 1 per
the task brief.

**Item 4 (0xFFFE-redirect record shape)** — not reached this session;
still an implemented-as-hypothesis note in the committed extractor and
§3.14.3, unchanged.

**Files touched:**
- `docs/wizardry6/snes/data-structure.md` — new §3.14.7 (maze cell format
  and frustum evaluator, confirmed with full disassembly citations), 4
  new paths-tried table rows (maze cell format solved; bulk wall-source
  escalated; palette sweep; VRAM-path candidates ruled out).
- `docs/wizardry6/TODO.md` — `snes-dungeon-view-render` row narrowed (item
  (c) closed, converted to a pointer at the new split-out row; (a)/(b)
  updated to reflect this session's negative results; (e) unchanged); new
  `snes-maze-wall-source` row added, status `escalated:re-codebreaker`.
- `docs/wizardry6/plan.md` — this entry.
- No committed extractor/asset changes this session — the confirmed cell-
  format mechanism has no real per-level wall data to render yet (blocked
  on the escalated question), so extending `decode-dungeon-composer.ts`
  to consume it would only be able to demonstrate synthetic/uniform-default
  input, not a real dungeon layout, which was judged not worth the
  extractor-code churn until the escalation returns.

One `re-codebreaker` escalation launched this session (`snes-maze-wall-
source`), result pending — a follow-up pass is needed to review,
independently re-verify (never trust the escalation's own script per
`verify-escalation-artifacts-not-just-claims.md`), and either promote or
document as still-open. No `re-learn` harvest this session: the one
process lesson worth keeping (`tracker-prose-is-not-evidence.md` catching
the `$80:D700` miscitation) is already an indexed lesson file from a
different project's prior harvest, not a new one.

## SNES — Session 7 (2026-08-03) — bulk maze-table escalation reviewed,
independently re-verified, and promoted: `snes-maze-wall-source` closed

Follow-up to Session 6's escalation. `re-codebreaker` returned a solved
verdict: a 14-record x 1536-byte per-level maze table at file `0x030000`
(`$86:8000`), a region-origin table at `0x00578E` (`$80:D78E`), a loader
at `$8B:DE64` (sole caller `$80:D073`), and a region blitter at
`$80:D25B` — verified against the Amiga port's `scenario.dbs` section 2
(an independent, already-confirmed corpus) at 99.4-99.75% agreement
across four wall sub-fields and a feature byte, plus 167/168 region
origins.

**Independent re-verification, per this project's standard discipline
(`verify-escalation-artifacts-not-just-claims.md`) — never treat an
escalation's own script or its summary numbers as fact.** Re-disassembled
the loader and blitter from raw ROM bytes with a fresh flag-aware
65816 disassembler run (not the escalation's tooling) and reproduced
both byte-exact, including the `WRMPYA`/`WRMPYB` `level*6`-then-`XBA`
"`*256`" trick that computes `level*1536`. Wrote a from-scratch Python
cross-checker against the Amiga oracle (never opened the escalation's
own comparison script) and reproduced the wall-plane and region-origin
percentages to the *exact fraction* (10688/10752, 10697/10752, 167/168,
etc.) — strong evidence the core finding is real, not a convincing-but-
wrong report.

**One escalation claim did not survive independent re-verification and
was corrected in the doc.** The escalation reported "levels 0, 3 and 6
are 768/768 exact on the feature plane". Reproducing the comparison
found this false: only level 6 is actually exact; level 0 has 15
mismatches and level 3 has 2, and level 4 — not flagged by the
escalation at all — is the worst-agreeing level at 95.96%. The
underlying qualitative claim (very high feature agreement once the
SNES's own `0x0D`/`0x0E` "empty" sentinel convention — independently
established earlier in Session 6, before this escalation even ran — is
accounted for) still held up; only the specific per-level detail was
wrong. This is the third confirmed instance in this project of a
specialist escalation's prose containing a genuine, checkable error
that only surfaced because the calling session re-derived the
verification from scratch rather than trusting the reported numbers —
same discipline that caught a stale palette array and a table-length
miscount in earlier sessions (see the lesson file's growing list of
instances).

**Promoted to a committed extractor**: `tools/wizardry6/snes/decode-maze.ts`,
decoding all 14 levels' 768 cells (wall + feature bytes, region/major/
minor indices, region origins) to `public/assets/wizardry6/snes/data/
maze.json`, and rendering each as a top-down map PNG
(`screens/maze/maze-levelNN.png`) using the major-axis-reversed placement
confirmed against the Amiga oracle. Every rendered map shows unmistakable,
non-degenerate maze structure (connected rooms, corridors, symmetric
chambers) on visual inspection — the decisive oracle, independent of the
numeric cross-check. Structural/non-degeneracy checks are built into the
extractor as hard guards (refuses to write output on a violation).

**Files touched:**
- `docs/wizardry6/snes/data-structure.md` — the escalation's own edits
  (new §3.14.8, a correction block in §3.14.7 fixing the `$82:D245`
  bank mislabel) reviewed and kept; the "levels 0/3/6 exact" claim and
  its knock-on feature-agreement percentage corrected with independently
  re-derived numbers and a `> **Independently re-verified**` block; two
  paths-tried rows reconciled (the escalation's own row's "levels 0/3/6"
  phrase removed; a new follow-up re-verification row added); extractor
  added to the Files list.
- `docs/wizardry6/TODO.md` — `snes-maze-data-extractor` row narrowed:
  extractor-committed status now reflected, the corrected-claim note
  added, remaining opens (patch lists, wall-value semantics, SNES-only
  feature flag bits, per-cell content-edit residue) kept as genuinely
  open.
- `docs/wizardry6/plan.md` — this entry.
- `tools/wizardry6/snes/decode-maze.ts` — new committed extractor.
- `public/assets/wizardry6/snes/data/maze.json`, `screens/maze/
  maze-level00.png`-`maze-level13.png` — new committed-extractor output
  (gitignored build artifacts, regenerated by the extractor).

`snes-maze-wall-source` is now closed (superseded by the narrower,
still-open `snes-maze-data-extractor` row). No new `re-learn` harvest
lesson filed this session — the specific escalation-verification catch
here is an *instance* of the already-indexed
`verify-escalation-artifacts-not-just-claims.md` lesson, not a new
pattern; worth folding into that file's instance list on the next
`re-learn` pass rather than as a standalone entry.

## Dungeon walker — Session 1 (2026-08-07) — M6 kickoff: shared-edge wall storage landed in `@seer-project/dungeon`

Scope: start Milestone M6 ("generalise `@seer-project/dungeon` to
Wizardry 6") from `seer/docs/walker.md`. Black Crypt's own consumer is
at M0-M4 done, M5 six-of-seven done (`crawl/docs/blackcrypt/TODO.md`).
Cross-repo session — touches `sorcery`, `seer`, not `crawl`.

**Housekeeping:** committed a substantial backlog of prior uncommitted
work in this repo (Amiga Sessions 3-4's `mazedata.ega` compose-list
solve and the `scenario.dbs` section 2 maze-geometry solve, the SNES
dungeon-art/composer/maze/creature-sprite decoders, `docs/walker.md`'s
deletion in favour of the canonical `seer/docs/walker.md` copy) —
verified coherent and `tsc`-clean before landing, see commit `0cc284e`.

**Confirmed the M6 done-when check is not yet met:** `@seer-project/dungeon`
still had Black-Crypt-only paths outside doc comments — specifically,
`FlatGridLevel` implemented only `WallStorage.kind: 'bitflags'`
(Black Crypt's own convention) and threw for the `shared-edge` kind the
schema already declares (`schema/level.ts`, designed for W6's 2-plane
wall storage from the start, per `walker.md` §4-5). `sorcery` does not
yet depend on `@seer-project/dungeon` at all.

**Landed:** `FlatGridLevel.wallAt` now supports `shared-edge` storage —
a query whose facing matches `planeDirs[i]` reads that cell's own
plane directly; the opposite facing reads the neighbour cell's same
plane instead (the wall is stored once, not per-cell). An off-grid
neighbour reads as the configured `offMapValue`. Verified: both sides
of a shared edge agree, off-map reads use `offMapValue`, a
misconfigured `planeDirs` (sharing an axis) throws rather than
silently misreading; all 186 existing `@seer-project/dungeon` tests
(including the Black Crypt golden/sweep suites) still pass, `tsc`/
`eslint` clean. Committed in `seer` as `9cb8ee0`, isolated from a large,
unrelated, separately-uncommitted `@seer/*` → `@seer-project/*`
monorepo rename already sitting in that working tree (left untouched —
out of scope here, flagged to the user, not investigated).

**Cross-checked against this repo's own disassembly evidence**: the
"Amiga TODO sweep" session (2026-08-02, `CODE+0x908c`/`0x90f6`)
already confirmed the concrete `planeDirs` value for Wizardry 6's own
maze: facing 2 (S) steps to `(x,y-1)` and reads the neighbour's plane
A; facing 3 (W) steps to `(x-1,y)` and reads the neighbour's plane B.
That means plane A's own-read facing is 0 (N, opposite of the
neighbour-read facing 2) and plane B's own-read facing is **1 (E, not
3/W)** — so the real `planeDirs` for this game is `[0, 1]`, not the
`[0, 3]` `walker.md` §10.2 offered as a generic placeholder default
before this disassembly existed. No framework change needed —
`FlatGridLevel` takes `planeDirs` as data, not a hardcoded convention —
but this is the value the eventual Amiga exporter must actually ship.

**Still open, not started this session:** `sorcery` has no
`@seer-project/dungeon` dependency yet; no `levels.json`/`slots.json`
exporter exists for either Amiga or SNES (the existing
`decode-scenario-maze.ts`/`decode-maze.ts` extractors produce their own
ad hoc JSON shapes, not the walker schema); the wall-value→meaning
mapping (door vs. solid, etc.) is still open, correctly deferred by
design to a future M3-equivalent pass; `AutomapRenderer.tileForCell`
still hardcodes Black Crypt's `type` plane name (flagged in its own doc
comment as a known M6 gap, not addressed this session — automap isn't
needed for a first static render).

**Recommended next step:** write the Amiga `levels.json` exporter
(TypeScript, `tools/wizardry6/`, mirroring Black Crypt's Python
`export_dungeon_levels.py` shape) from the already-extracted
`scenario.dbs` section 2 data (`decode-scenario-maze.ts`), using
`wallStorage: {kind:'shared-edge', planes:[<planeA>,<planeB>],
planeDirs:[0,1], offMapValue:?}` per the confirmed mapping above, then
add `@seer-project/dungeon` as a `sorcery` dependency and get a static
corridor render (Black Crypt's M1-equivalent) as the concrete
verification target.

**Files touched:**
- `seer/packages/dungeon/src/model/FlatGridLevel.ts`,
  `src/__tests__/FlatGridLevel.test.ts` — shared-edge support + tests
  (commit `9cb8ee0` in `seer`, not this repo).
- `docs/wizardry6/plan.md` — this entry.
- `docs/wizardry6/TODO.md` — new `dungeon-walker-m6-wiring` row (see
  below).

## Dungeon walker — Session 2 (2026-08-07) — real Amiga levels.json exporter + static-corridor call sequence

Continuation of Session 1. Scope: turn the framework-side unblock (M6's
`shared-edge` support, landed in `seer` `9cb8ee0`) into real, verified
progress on the actual Amiga export/render path.

**Housekeeping, cross-repo:** the `seer` monorepo's `@seer/*` -> `@seer-project/*`
package rename (a large, separately-authored, pre-existing change) was
validated (build/451 tests/lint/licensing all clean) and landed in `seer`
this session, then propagated to every consumer repo across the dev tree,
including this one -- `sorcery`'s own `@seer/*` references were renamed to
match (`83a980a`).

**Landed:**
- Added `@seer-project/dungeon` as a real `sorcery` dependency.
- `tools/wizardry6/export-dungeon-levels.ts`: densifies each of the 14
  `scenario.dbs` maze levels (12 sparse 8x8 regions, placed by an explicit
  per-region origin table) to a per-level bounding-box-sized flat grid and
  writes a schema-conformant `DungeonLevelFile` per level, using
  `wallStorage:{kind:'shared-edge',planes:['wallA','wallB'],planeDirs:[0,1],
  offMapValue:2}` -- the `[0,1]` mapping is the disassembly-confirmed value
  from the `maze-plane-semantics` TODO row, not a placeholder. Gap cells
  inside a level's bounding box that no real region covers get the same
  defensive "wall" fill Black Crypt's own exporter uses for its densified
  gaps, not real game data.
- **Verified, not just written:** all 14 levels pass
  `validateDungeonLevelFile`; loading each through `FlatGridLevel` and
  querying every `(x, y, facing)` combination produces zero exceptions;
  and, decisively, 18,944 direct-read wall values (every real region cell's
  own `wallA`/`wallB`, facings 0/1) match the raw `scenario.dbs` source
  exactly, byte for byte -- not just "doesn't crash."
- Fixed a real, unrelated bug this surfaced: `decode-scenario-maze.ts`
  called its own CLI `main()` unconditionally at module scope (no
  `isStandalone` guard, unlike `extract-game-data.ts`'s existing pattern),
  so importing its `parseMazeLevels` export as a library -- which the new
  exporter does -- re-triggered the whole CLI side effect. Fixed with the
  same guard pattern already used elsewhere in this repo.

**Disassembly follow-up, escalated and cross-verified:** the doc's §4.4
claimed `CODE+0x632c`-`0x6552` was one straight-line 16-call
`DrawMazePiece` block composing the static corridor frame, but the literal
16 call arguments were never transcribed anywhere -- only described
qualitatively (mirrored pairs `20<->16` etc.). Escalated to a disassembly
pass (radare2 + the committed IRA `Bane.asm`, cross-verified byte-identical
between the two tools). Result: the byte-range claim itself was imprecise
(the range actually spans two adjacent functions -- a genuinely
unconditional 16-call block at `CODE+0x633c`-`0x6452`, plus a separate
6-call status-icon function starting at `0x64ee`), but the 16-call content
and mirrored-pair claims were exactly correct. The full 16
`(dstIdx, mode, srcIdx)` triples are now transcribed and persisted in
`tools/wizardry6/static-corridor-calls.ts`, and `data-structure.md` §4.4 is
corrected with a dated correction block rather than silently overwritten.

**Still open, not started this session:** the 16-call data above is a
*fixed, non-cell-driven* known-good frame -- it hasn't been composited into
actual pixels yet (needs checking W6's OR/replace blit + mirrored-index
compositing against what `@seer-project/dungeon`'s `raster/composite.ts`
already implements for Black Crypt, which may or may not cover W6's exact
blend semantics); no general per-cell slot-key scheme exists (only this one
frame's compose-list indices are known, not which index serves which
`(depth,lateral,facing)` slot in general); SNES has no exporter at all.

**Recommended next step:** build the pixel composite from
`static-corridor-calls.ts` + `mazedata.json`/`mazedata-composelist.json` as
the concrete M1-equivalent verification target (a rendered PNG, not just a
schema-valid JSON file) -- the same "static corridor, zero new RE" scope
Black Crypt's own M1 used, now with real data in hand instead of a plan.

**Files touched:**
- `sorcery`: `package.json`/`package-lock.json` (new dependency),
  `tools/wizardry6/export-dungeon-levels.ts` (new),
  `tools/wizardry6/static-corridor-calls.ts` (new),
  `tools/wizardry6/decode-scenario-maze.ts` (isStandalone fix),
  `docs/wizardry6/amiga/data-structure.md` (§4.4 correction),
  `docs/wizardry6/TODO.md` (`dungeon-walker-m6-wiring` row updated),
  `docs/wizardry6/plan.md` (this entry). Commit `0259bb8`.

## Dungeon walker — Session 3 (2026-08-07) — real static-corridor render, M1-equivalent reached

Continuation of Session 2. Scope: turn the extracted 16-call
`static-corridor-calls.ts` data into an actual composited PNG, the
concrete M1-equivalent verification target Session 2 flagged as next.

**Landed:** `tools/wizardry6/render-static-corridor.ts` resolves each of
the 16 confirmed `DrawMazePiece(srcIdx, mode, dstIdx)` calls into
pixel-space placement (direct vs. mirrored path, per the confirmed
`CODE+0x3d72` semantics) and composites them onto a real
`@seer-project/dungeon` `IndexedSurface` via its existing `blit()`
primitive:

- `blend:'or'` (bitwise-OR at the index level) is used for calls 1-12 --
  this blend mode already existed in the framework, added for exactly
  this future milestone, but had never been exercised by real data
  before (Black Crypt never uses it). It required no changes at all --
  the semantics matched immediately.
- `mirrorX:true` (exact pixel-order reversal) is used for the mirrored
  calls -- including calls 1-3/10-12, which are mirrored even though
  `dstIdx===srcIdx`, per Session 2's disassembly finding. Reversing a
  byte's 8 bits (the game's real mechanism, via its 256-byte bit-reversal
  table) is exactly reversing that byte's 8 pixels' order, so this also
  required no framework changes -- the existing primitive already does
  the right thing once fed real per-pixel index data.
- Deliberately bypasses `PieceBank`/`compositeSlotTable`:
  `PieceBank.fromRGBA` derives an *arbitrary* per-atlas palette by
  deduplicating RGBA colors, which would make `blend:'or'` produce
  nonsense (OR-ing reassigned indices bears no relation to OR-ing the
  game's real ones). `mazedata.ega` has no true-indexed atlas export yet
  (`decode-maze.ts` only writes the RGBA-baked one), so this script
  decodes the ~10 directory records the 16 calls actually reference
  directly from the raw file via the existing `decodeDirRecord`, and
  blits them straight onto the surface -- real index data, not
  reassigned. A general true-indexed atlas export (matching
  `PieceBank.fromIndexedRGBA`'s expected shape) is real future work, not
  needed for this one fixed verification frame.

**Verified, not just written:** the composited PNG (`static-corridor.png`)
is a correct, recognisable first-person dungeon corridor -- mortared
stone side walls (left drawn as the mirror of the right, matching the
confirmed mirrored-pair calls), stone ceiling, cobbled floor receding to
a vanishing point, and a dark doorway in the far wall -- visually
matching the original session's rendered-oracle description exactly.
Every one of the 16 calls' resolved `mirror`/`mode` flags matched the
disassembly-confirmed expectation before the render was even inspected
(logged per-call at render time).

**Incidental fix:** `seer`'s `packages/core` and `packages/dungeon` had
stale/missing `dist/` build output (unrelated to this session's own
work -- likely a side effect of concurrent work happening in that repo)
that broke `sorcery`'s `file:` dependency resolution; rebuilt via
`npm run build:packages` in `seer`, no source changes needed there.

**Still open, not started this session:** only this one fixed 16-call
frame's placement is known -- there's still no general per-cell
slot-key scheme (which compose-list run serves which
`(depth,lateral,facing)` in general). SNES has no exporter. No
true-indexed atlas export exists yet for `mazedata.ega`.

**Recommended next step:** extract `CODE+0x9b58`'s `baseIndex` arguments
(`0x12(a5)`/`0x14(a5)`/`0x16(a5)`/`0x18(a5)`, per `data-structure.md`
§4.5) -- the front/side wall run start indices per facing -- to derive
the general slot-key scheme. That's Black Crypt's own M2-equivalent
milestone: real per-cell wall data driving which compose-list records
render, not just one hand-verified fixed frame.

**Files touched:**
- `sorcery`: `tools/wizardry6/render-static-corridor.ts` (new),
  `docs/wizardry6/TODO.md` (`dungeon-walker-m6-wiring` row updated),
  `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 4 (2026-08-07) — CODE+0x9b58's literal baseIndex constants extracted; a real doc error found and corrected

Continuation of Session 3. Scope: derive the general per-cell slot-key
scheme (which compose-list run serves which piece-kind/facing) needed to
move past the one fixed static-corridor frame toward a real per-cell-
driven render -- Session 3's own recommended next step.

**Landed:** all 5 of `CODE+0x9b58`'s callers found and their literal
`baseIndex` push values extracted (front `0xab92`: `0x7a,0x7a,0,0`; left
`0xad52`/`0xae10`: `0x82,0x8e,3,0xc` / `0x86,0x8a,6,9`; right `0xaed0`/
`0xaf90`: the exact mirror-swapped pairs `0x8a,0x86,9,6` / `0x8e,0x82,0xc,
3`) -- cross-verified twice, independently, at instruction-byte
granularity against `disasm/Bane.asm`.

**A real error found and corrected in `data-structure.md` §4.7.1**, not
just a refinement: the doc's own prior text claimed the 3 per-cell
evaluator functions' (`CODE+0x9202`/`0x969a`/`0x9876`) results get pushed
as `9b58`'s arithmetic `baseIndex` arguments. Verified false on
re-derivation: the evaluator result lands at a *separate* dispatch-key
slot (`0xA(a5)`), used only via `CMPI.W` comparison (against `2`/`7`/`3`/
`4`) to gate which literal-driven draw variant fires -- never as
`ADD.W`-with-depth arithmetic, which only ever operates on the 4 literal
constants above. Also found: 2 of the 3 evaluator siblings' results
(`969a`/`9876`) never reach `9b58` at all; they feed a shorter sibling
dispatcher (`CODE+0xa174`) and several untraced 2-argument gate stubs
instead. Added a dated `> **Correction —**` block per this corpus's own
convention rather than silently overwriting the old text.

**Still open, the actual remaining blocker:** what `0xA(a5)`'s compared
values (`2`/`7`/`3`/`4`) mean against the already-exported `wallA`/
`wallB`/`feature` cell data. §4.7.2's own `EvalCellFace` pseudocode
already documents the likely source: a "16-way dispatch on feature" at
`CODE+0x964e`, not yet disassembled. That's the next concrete step --
new TODO row `dungeon-walker-cell-render-dispatch` tracks it, superseding
Session 3's more general "extract baseIndex arguments" framing now that
the baseIndex/dispatch-key split is understood.

**Files touched:**
- `sorcery`: `docs/wizardry6/amiga/data-structure.md` (§4.7.1 correction
  block), `docs/wizardry6/TODO.md` (new `dungeon-walker-cell-render-
  dispatch` row), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 5 (2026-08-08) — CODE+0x964e feature dispatch decoded, another doc error corrected

Continuation of Session 4. Scope: resolve what the 4 literal values
(`2`/`7`/`3`/`4`) `CODE+0x9b58` compares its evaluator-fed dispatch key
against actually mean, per Session 4's own identified next step.

**Landed:** `CODE+0x964e`'s full 16-way feature dispatch table decoded
(feature 0-15 -> return value or side-effect array write). Feature 0 is a
confirmed pure wall-value pass-through (explains ~91% of cells needing no
special handling); feature 7 -> 4 and feature 8 -> 7 explain 2 of `9b58`'s
4 `CMPI` comparison values directly.

**A second real doc error found and corrected**, same pattern as Session
4: §4.7.2's `EvalCellFace` pseudocode stated the feature-dispatch guard as
`feature==6 || feature<=0xc`. Disassembly of `CODE+0x9578`-`0x9582` shows
this is backwards -- the real condition is `feature==6 || feature>=0xd`
(`feature ∈ {13,14,15}`). For every other feature value, the dispatch only
fires when `facing==orient`; from any other facing those cells render as
plain walls regardless of feature code. Corrected with a dated blockquote,
same convention as Session 4.

**New open thread, not resolved this session:** feature 1 ("closed door",
independently cross-platform confirmed) returns `5` from the dispatch
table -- but `5` isn't one of `9b58`'s 4 `CMPI`-compared values. Per the
doc's own §4.7.1 correction (Session 4), `9b58` also reads its dispatch
key via a separate `EXT.L`-then-dispatch mechanism beyond the 4 direct
comparisons -- that's presumably where door rendering (and the other
feature-derived non-wall values: `6`,`8`-`14`) actually gets handled, but
it hasn't been traced. This is the next concrete step if door-specific
first-person rendering matters for M6; the 4 `CMPI` values alone already
cover plain walls/secret-walls (`2`/`3`, matching the raw wall bitfield)
and two named feature effects (`4`/`7`).

**Judgment call on how much further to chase this:** this investigative
thread (across sessions 4-5) has repeatedly turned up more real structure
than the docs previously claimed, correcting 2 genuine errors along the
way -- valuable, but each pass has also opened a new sub-thread rather
than closing cleanly. Per this corpus's own established philosophy
(`maze-plane-semantics` TODO row: some semantic questions are better
resolved empirically by the walker's own operation than by further static
analysis), the `EXT.L` dispatch is being pursued one more pass since it's
still a well-bounded, concretely-identified next piece -- but if it also
opens further branches rather than closing, that's a natural point to
defer the remainder to the walker's own M3-equivalent pass rather than
continuing indefinitely.

**Files touched:**
- `sorcery`: `docs/wizardry6/amiga/data-structure.md` (§4.7.2 pseudocode
  correction + full dispatch table), `docs/wizardry6/TODO.md`
  (`dungeon-walker-cell-render-dispatch` row updated), `docs/wizardry6/
  plan.md` (this entry).

## Dungeon walker — Session 6 (2026-08-08) — 9b58's full dispatch cascade traced end-to-end; investigative thread closed for now

Continuation of Session 5. Scope: trace `9b58`'s `EXT.L`-then-dispatch
mechanism, the last piece Session 5 flagged as needed to know how doors
(and other feature-derived non-wall values) actually render.

**Landed:** the full mechanism is traced end-to-end. It's not "4 `CMPI`
checks plus a separate `EXT.L` dispatch" as Session 4's own correction
block characterized it -- that was itself imprecise. It's one cascade:
a depth<3 gate, an `==2`/`>=7` preamble (the ">=7" is a range check, not
an equality test against 7 as previously written), always falling
through to a genuine 15-entry jump table (`CODE+0xa04c`) covering every
dispatch-key value 0-14. Every value's concrete effect is now documented
-- direct `DrawMazePiece` calls, deferred-draw-queue pushes, or both.
Door cells (value 5) confirmed to call `DrawMazePiece` directly and
unconditionally, using 2 more of `9b58`'s literal per-call-site arguments
(`44(a5)`/`46(a5)`) beyond the 4 already known, following the same
mirror-parity pattern. This also pinned down `DrawMazePiece`'s own 3
parameters precisely for the first time (a "compose two records" mode
the static-corridor work never exercised).

Corrected my own Session 4 doc addition (not just the original pre-
session text) via a dated addendum block, same convention -- this
investigative thread has now corrected itself twice in a row, a sign of
real, hard-won precision rather than a quick clean answer.

**Judgment call: stopping the disassembly-chasing here.** The original
motivating question -- does per-cell wall/feature data actually drive
which pieces get drawn, doors included -- is now answered with concrete,
confirmed evidence. What remains (the deferred-draw queue's exact
semantics for 5 of the 15 dispatch values, the `CODE+0xa174` sibling
dispatcher, however many more literal argument slots `9b58` turns out to
have beyond the 6 now confirmed) is real implementation-scale work, not
a bounded follow-up disassembly question -- each of the last 3 sessions
opened at least one new sub-thread rather than closing cleanly, and
continuing to chase disassembly indefinitely risks never converging.
Per this corpus's own established philosophy for exactly this class of
question (`maze-plane-semantics` TODO row), the remaining detail is
better resolved by writing the actual per-cell dispatch logic in
TypeScript against this now-solid foundation than by more static
analysis -- a real per-cell-driven renderer is the next milestone, not
another disassembly pass.

**Files touched:**
- `sorcery`: `docs/wizardry6/amiga/data-structure.md` (§4.7.1 addendum
  block), `docs/wizardry6/TODO.md` (`dungeon-walker-cell-render-dispatch`
  row updated), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 7 (2026-08-08) — side walls added, real per-cell corridor render

Continuation of Session 6. Scope: extend the front-wall-only per-cell
renderer to side walls, using the left/right baseIndex constants
extracted in Session 4.

**Landed:** `render-cell-driven-corridor.ts` draws front + left + right
walls together from real per-cell data. Checked the compose-list data
directly before implementing (not more disassembly) to resolve an open
question about left/right's two "layers" each: right1's depth-0 record
is the exact horizontal mirror of left2's, laid out as independent,
position-correct art -- not shared via DrawMazePiece's runtime mirror
mechanism. So side walls use the same direct/unmirrored formula as
front, just drawing both layers together at each depth; the compose-
list's own zero-width padding records (same convention front-wall's
own records use) handle the rest with no further semantic decoding
needed. This resolves the long-open "why front needs 1 call vs 2 for
left/right" question from an earlier session.

Also fixed a second, identical `main()`-runs-on-import bug in
`decode-maze.ts` (same issue as `decode-scenario-maze.ts`, fixed in
Session 3) -- caught while checking compose-list data directly for the
first time from a fresh script.

**Verified against the same 2 real test poses used for the front-wall-
only version**: both render correctly, including a genuinely coherent
multi-depth corridor view (nested walls receding on both sides plus a
front wall further back) with no visible seams or glitches, all
visually confirmed against the real `mazedata.ega` art.

Removed `render-cell-driven-front-wall.ts` (Session 6's file) since
`render-cell-driven-corridor.ts` is a strict superset.

**Still open, scoped as follow-on work, none of it blocking further
progress**: dispatch values other than 0/2 (door, secret, feature
cases -- currently an honest plain-wall fallback); floor/ceiling
pieces (not attempted); the deferred-draw queue and `CODE+0xa174`
sibling dispatcher (both still fully untraced); movement/interaction.

**Files touched:**
- `sorcery`: `tools/wizardry6/render-cell-driven-corridor.ts` (new,
  supersedes and removes `render-cell-driven-front-wall.ts`),
  `tools/wizardry6/decode-maze.ts` (isStandalone fix),
  `docs/wizardry6/TODO.md` (`dungeon-walker-cell-render-dispatch` row
  updated), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 8 (2026-08-08) — ceiling/floor added, complete per-pose first-person view

Continuation of Session 7. Scope: add ceiling and floor to the front+
side-wall per-cell renderer, completing a full first-person view.

**Landed:** ceiling/floor needed no new disassembly at all -- they're
pose-independent room-shell art with no evaluator call feeding them,
so this reuses `static-corridor-calls.ts`'s already-confirmed, already
visually-verified static-corridor pieces directly (calls 1-3 =
ceiling, by `destY`; calls 10-12 = floor). Same mirrored-resolution
logic as `render-static-corridor.ts`, same `mode:1`/OR blend as every
other piece in this corridor.

**Verified against the same real poses**: a full first-person view --
ceiling, floor, front wall, both side walls -- renders correctly and
coherently, genuinely matching the original hand-verified static
corridor's visual quality but now driven by real per-cell data for
whichever pose is given, not a fixed frame. Wall-directly-ahead
correctly occludes ceiling/floor entirely (the near wall's art is
large/opaque enough to cover the full viewport at that range).

This effectively completes Black Crypt's own M2-equivalent milestone
for Wizardry 6's Amiga port: real per-cell wall data driving a real
composited render, verified against actual game data rather than one
fixed frame.

**Still open, all scoped as follow-on work**: wall dispatch values
other than 0/2 (door, secret, facing-matched features); the deferred-
draw queue; the `CODE+0xa174` sibling dispatcher; movement/interaction
(M3-equivalent); broader testing across more levels/poses.

**Files touched:**
- `sorcery`: `tools/wizardry6/render-cell-driven-corridor.ts` (ceiling/
  floor added), `docs/wizardry6/TODO.md` (`dungeon-walker-cell-render-
  dispatch` row updated), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 9 (2026-08-08) — full sweep verification, one real bug caught and fixed

Continuation of Session 8. Scope: build confidence in `evalCellFace`
beyond the 2-3 manually-chosen test poses used so far, matching Black
Crypt's own M2 sweep-verification convention (13 maps x sampled poses x
4 facings, zero exceptions).

**Landed:** an ad hoc sweep script exercised `evalCellFace` across every
position (stride-sampled on large levels) x 4 facings x 3 depths x 3
laterals, for all 14 real exported levels -- 39,648 poses, 356,832
evaluator calls total.

**A real bug found and fixed**: 772 of those evaluations returned
`undefined` instead of a valid dispatch value. Root cause: `evalCellFace`
only bounds-checked the *lateral-stepped* position (`cx`/`cy` after
applying the `-1`/`+1` offset) -- when `lateral===0`, nothing checked
whether `(x,y)` itself was in bounds before reading `wallA`/`wallB`
directly. Depth-stepping can genuinely land just past a densified
level's own tight bounding box (`export-dungeon-levels.ts`'s own crop
around each level's active regions) -- something the real game's much
larger, less tightly-cropped world would never encounter, so this
wasn't a disassembly gap, it's a real consequence specific to this
port's own data representation. Fixed with a proper off-map -> solid(2)
guard at the top of the function (same convention as the existing
lateral-step check and `export-dungeon-levels.ts`'s own `offMapValue`
fill), plus a regression test covering all 4 facings. Re-swept after
the fix: zero exceptions, zero out-of-range values, zero `undefined`.

**Files touched:**
- `sorcery`: `tools/wizardry6/evaluate-cell.ts` (bounds-check fix),
  `tools/wizardry6/__tests__/evaluate-cell.test.ts` (regression test),
  `docs/wizardry6/TODO.md` (`dungeon-walker-cell-render-dispatch` row
  updated), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 10 (2026-08-08) — front-wall doors render, verified against a real door

Continuation of Session 9. Scope: wire in door rendering (dispatch
value 5) for the front-wall call site, using baseIndex constants
already confirmed in an earlier session (`44(a5)`/`46(a5)` = `0xB2`)
but never actually used in the renderer.

**Landed:** `render-cell-driven-corridor.ts`'s `WallCallSite` now
carries an optional `door` baseIndex alongside `wall`; front's is
`0xB2` (confirmed identical-shape to its own `wall` pair, `44(a5)===
46(a5)`, so direct/unmirrored placement applies the same way). Left/
right don't have their door baseIndex extracted yet, so they still
honestly fall back to a plain wall for dispatch 5.

**Verified against real data**: found actual doors (`feature===1`) in
the exported levels, picked `level07.json`'s door at `(2,1)`
(`orient=0`), and rendered it two ways -- partially occluded behind a
nearer wall (confirms correct depth-occlusion behaviour) and
unobstructed at depth 0 (a clear, correct archway/door piece with
distinct wood-coloured detail, not a generic wall texture).

**Files touched:**
- `sorcery`: `tools/wizardry6/render-cell-driven-corridor.ts` (door
  dispatch wired in), `docs/wizardry6/TODO.md` (`dungeon-walker-cell-
  render-dispatch` row updated), `docs/wizardry6/plan.md` (this entry).

## Dungeon walker — Session 11 (2026-08-08) — walk sequences, verified across all 4 facings

Continuation of Session 10. Scope: verify facing correctness beyond
the north-only poses tested so far, and add a lightweight movement
capability (M3-equivalent) on top of the now-solid per-pose renderer.

**Landed:**
- Verified all 4 facings (not just north) render coherently from the
  same test pose -- closes a real gap (facing-specific bugs, e.g. a
  swapped wallA/wallB or wrong lateral direction, wouldn't have shown
  up in the earlier sweep's exception/range checks, only visually).
- Refactored `render-cell-driven-corridor.ts`'s compositing logic into
  a new shared module, `render-corridor-frame.ts` (`renderCorridorFrame`
  + `indicesToRGBA`), to avoid duplicating it in the new walk-sequence
  script. Re-verified byte-identical output after the refactor.
- `render-walk-sequence.ts`: walks a real level through a move string
  (`F`/`L`/`R`), rendering one PNG per step. Collision is just
  `evalCellFace`'s own depth-0 front-wall evaluation read as a
  boolean -- no new logic, the same evaluator this whole session's
  work already verified.

**Verified**: an open corridor walk (2 forward, turn, 2 more forward)
moves and renders correctly at each step; a wall-blocked walk correctly
refuses to move (logged, position unchanged) on both attempts.

**Files touched:**
- `sorcery`: `tools/wizardry6/render-corridor-frame.ts` (new, shared
  compositor), `render-cell-driven-corridor.ts` (refactored to use it),
  `render-walk-sequence.ts` (new), `docs/wizardry6/TODO.md`
  (`dungeon-walker-cell-render-dispatch` row condensed and updated),
  `docs/wizardry6/plan.md` (this entry).

## Cross-platform — Session (2026-08-16) — TODO sweep: 7 rows closed, 8 narrowed (re-oracle)

One long Fable session worked the whole open-row list across Amiga + SNES
(DOS/EGA out of scope). Findings live in the two `data-structure.md` files
— this is only the index.

**Closed rows** (deleted from `TODO.md`): scenario sections 5-8 (section 5
= NPC name table, `'^'` splice consumer, `decode-scenario-npcs.ts`);
walker-user-reported-inaccuracy (parity + deferred queue + `:alt`
variants shipped); SNES genus-header field (§6.2 — Japanese genus names
in the game's own 8-bit encoding); SNES SPC driver size + BRR directory
(both subsumed by §5.5's 151-module sound directory,
`decode-spc-modules.ts`); SNES opening screens 4-5 (space scene + gameplay
screen composed, `decode-opening-sequence.ts`); SNES creature-sprite
details (type dispatch semantics + all 3,701 frames,
`decode-creature-sprites.ts`).

**Big narrows**: SNES wallValue→art dispatch fully traced and shipped as
walker v2 (§3.14.12, `resolveViewWords`, verified 7/7 poses against an
independent Python oracle + decisive door/doorway renders) — which also
**confirmed the cross-platform wall-value semantics** (0=open, 1=open
doorway, 2=solid wall, 3=closed door) both maze rows had carried as a
shared unknown; Amiga deferred-draw queue + full `0x9b58` per-code
dispatch + side doors implemented (§4.7.8, 298,744-pose sweep clean);
flagP/flagQ overlay dispatches decoded (§4.7.9, new `walker-flag-overlays`
row tracks the wiring); monster per-attack sub-records solved
(Zimlab-exact, §7.1); SNES 8-bit text encoding solved (§4.1a); spell-anim
palette solved (§6.4 — per-cell BG sub-palette fields against the boot
CGRAM shadow, never sub-palette 2, magic-circle render).

Green: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` 283/283.

## Amiga — Session (2026-08-29) — flagP/flagQ wired, cel-token mechanism traced

Closed `walker-flag-overlays` and narrowed
`dungeon-walker-cell-render-dispatch` further.

**flagP/flagQ overlay (§4.7.9) — wired and verified.** New `evalOverlay()`
in `evaluate-cell.ts` ports the per-level dispatch table directly; wired
into `view-model.ts`'s depth loop (all 5 evaluator calls: front/perpL/
perpR/latL/latR) and `canStepDir`. `export-dungeon-levels.ts` gained a
`region` plane (source region 0-11 per densified cell) purely for level
12's region-0-8-vs-outside split; `export-dungeon-slots.ts` now emits the
previously-collected-but-unshipped `floor-alt:*` compose family
(214-241). One approximation is explicitly flagged in code/doc: which of
two evaluator calls feeding "left"/"right" writes which gate slot wasn't
independently traced, so both are OR'd together (doesn't affect the front
lane or any of the 4 documented per-level effects, only lane attribution).

Verified: 57 new unit tests (`evalOverlay`'s 16 per-level branches +
`buildViewItems`'s 8-case wiring), all 138 wizardry6/walker tests passing
including the pre-existing real-data pixel-identity oracles (untouched —
their fixtures never set `CellPlanes.level`, so the new dispatch is a
no-op for them); a 298,744-pose full-corpus sweep with real flagP/flagQ/
region data (2,286 + 2,124 flagged cells) → 0 exceptions, 0 non-finite
coordinates; 4 decisive before/after renders (level 1 void, level 3
skip-floor, level 12 alt-floor blue-water texture, level 12 fog-overrides-
solid-wall) via `render-through-dungeon.ts`, scratch-only.

**Cel-token dispatch (`dungeon-walker-cell-render-dispatch`) — mechanism
traced via an `amiga-disasm` escalation, implementation narrowed for a new,
more precise reason.** An exhaustive A4-entry-55 (file-load) call-site
census across the whole CODE hunk found exactly 7 hits, all loading either
`MON00.PIC` or `CREDITS.PIC` — refuting §4.7.8's old "animated
torch/decoration" guess outright: the corpus has no separate decoration
`.PIC` file, so the deferred-draw queue's kind≠`0xFF` records are §4.6's
monster/NPC token overlay, not a distinct system. The resolved formula:
frame = `(rec+9)-1` (§2.3's already-confirmed cel-index arithmetic) inside
whichever `mon<NN>.pic` currently occupies resource-cache slot `rec+8`
(the same 314-byte-stride base §4.7.8 already called "section 8", now also
confirmed as the monster-portrait load-slot cache). This narrows rather
than closes the item: slot occupancy is combat-encounter *runtime* state
with no static per-cell fact in `scenario.dbs`'s maze data, so a static
walker pose has nothing principled to draw — left unimplemented rather
than guessed. Doc corrections applied to §4.6 and §4.7.8 (both now cite
the new finding); `view-model.ts`/`export-dungeon-slots.ts` comments
updated to explain *why* it's unmodelled (a data gap, not a missing
formula) rather than call it untraced.

**Files touched:** `tools/wizardry6/evaluate-cell.ts`,
`view-model.ts`, `export-dungeon-levels.ts`, `export-dungeon-slots.ts`,
`render-through-dungeon.ts`, `tools/walker/walker.ts`,
`tools/wizardry6/__tests__/evaluate-cell.test.ts`,
`__tests__/render-through-dungeon.test.ts`,
`docs/wizardry6/amiga/data-structure.md` (§4.6, §4.7.8 correction block,
new §4.7.9.1), `docs/wizardry6/TODO.md` (`walker-flag-overlays` closed/
deleted, `dungeon-walker-cell-render-dispatch` updated), regenerated
`public/assets/wizardry6/amiga/dungeon/*.json` + `slots.json` (458 -> 514
slots). `tsc --noEmit`/`eslint` clean on every touched file (a pre-existing,
concurrent-sibling-agent-caused `tools/eotb/*` type error is unrelated and
out of scope).

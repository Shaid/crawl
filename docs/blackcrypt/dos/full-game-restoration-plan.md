# Plan: can the Black Crypt Windows demo be completed from Amiga data?

**Status: Phase 1A resolved — GO. 1B/1C/1D still open.** This
doc records both the plan and the disassembly findings that shaped it — the
planning pass for this project involved actually opening `crypt.exe` in
radare2 for the first time, since nothing in this project had looked at the
Windows executable's code before (only its data formats). Corrections this
surfaced to previously-published claims are also applied in place in
`docs/blackcrypt/dos/data-structure.md` (search that file for "Correction").

## The question

The Windows port (`data/blackcrypt/dosvga/`) is a 1995 demo containing only
1 of the full game's 13 dungeon maps. The Amiga original has been
exhaustively reverse-engineered in this project (`docs/blackcrypt/amiga/data-structure.md`)
— full map format, full render pipeline, full item/monster data. Could that
already-understood data be converted and injected into the Windows demo to
make it a complete, playable game?

## Summary verdict

**Not from data alone — but the code side is a thunk, not a subsystem.**

The demo's map-switching *call* was removed from `crypt.exe`, not the
map-switching *machinery*: a generic per-map parser (`fcn.00425350`), a
generic per-map writer (`fcn.004258d0`) and a `SwitchMap(fromMap, toMap)`
driver (`fcn.00426880`) all survive intact and are already exercised on
every game load. What was deleted is the 12-byte body of `fcn.00423b50`,
which used to call the driver; it now prints "YOU HAVE REACHED THE END OF
THE TEST LEVEL" instead. Restoring it is roughly 20 bytes of x86 in
existing `.text` slack — see §1A, which is **resolved: go**.

So the work is real but it is *data and art* work: Phase 2 (byte-exact
map converter) and Phase 3 (19 creature clusters + 2 tilesets into
`clipper.clp`) are the schedule. Phase 4 is no longer the risk.

---

## §0. What the planning pass already established

Three "unknowns" that were open before this plan are now answered, by
actual disassembly (radare2, generic PE32/x86 — this needed none of the
project's Amiga-specific tooling), not speculation. All addresses below are
in `crypt.exe`.

### 0.1 The demo ships one map, not two

The prior doc claimed "maps 1–2 have real offsets." That's a misreading of
a dangling pointer:

- `maindung.gam` is 15,099 B. Map 1's body ends at byte 11,099; `+ 3,948 B`
  tail padding `= 15,047 = 0x3AC7`, exactly the "map 2" offset. `15,099 −
  15,047 = 52` — the file just stops 52 bytes after that offset, the
  length of one zeroed offset-table block. No map-2 data exists.
- `crypt.exe`'s own embedded text — "Demo contains only the first dungeon
  map (two playable levels)" — is accurate once read correctly: map 1 on
  its own spans two manual-numbered dungeon *levels* (this project's
  established map↔level correspondence, see `amiga/data-structure.md` §
  "Map ↔ dungeon-level mapping"). "Two playable levels" describes map 1's
  own content, not "maps 1 and 2."

### 0.2 The map-change routine is absent from the binary — the central finding

This inverts the original framing ("is the limit data-driven or also
code-gated?"). It's neither — **the feature was surgically removed**:

- `fcn.00401fa0` (the `MainDung.gam` loader) reads up to **0x35B60 =
  220,000 bytes** into the dungeon buffer and `rep movsd`s **13** dwords
  into a 13-slot in-memory offset table at `0x43c424`. Both are
  full-game-sized (the whole Amiga `bcdfs` is 171,005 B).
- `0x43c424` has exactly **two** cross-references in the entire binary:
  the loader filling it from the file, and `fcn.00401b80` copying it
  verbatim into the `char%d.dat` save. **Nothing ever indexes it by map
  number.** There is no `LoadMap(n)` function anywhere in the binary.
- `fcn.00423b50` is a 12-byte stub: it takes a destination-map argument,
  **discards it**, and prints `"YOU HAVE REACHED THE END OF THE TEST
  LEVEL"`. It has exactly two call sites, both shaped `if (destMap != 0)
  stub(destMap); else <same-map transition>`:
  - `fcn.00423b60` @ `0x423cf4` — this is `MoveParty`. Reached when
    `fcn.00410d10` (`ResolveTargetSquare`) returns **3**, then
    `fcn.00410f60(x, y, 0x12)` locates the type-`0x12` Stairs/Teleport
    record and reads its destination-map byte `+0x0F`. Nonzero → stub.
  - `fcn.0041afc0` case 21 @ `0x41b3b6` — same shape, on a byte in `bl`.

**Consequence:** injecting maps 3–13 into `maindung.gam` alone changes
nothing. The offset table populates, the bytes load, and the game still
prints the "TEST LEVEL" message the instant a stairs/teleport record with
a nonzero destination map is hit. Making the demo complete requires
**writing new x86 code**, not just patching data.

> **Correction — "there is no `LoadMap(n)` function anywhere in the
> binary" is wrong, and it is the one claim on which the whole go/no-go
> turned.** The reasoning was sound but rested on watching the wrong
> address. `0x43c424` really does have only two xrefs and really is never
> indexed by map number — but it is only the *file's* raw offset table,
> whose sole job is to be copied into `char%hu.dat`. The **runtime**
> offset table is a second, separate copy at **`0x4738b4`** (indexed
> 1..13), rebuilt from the save file by `fcn.00426390` at `0x426787`, and
> it *is* indexed by map number — by `fcn.00425350` (the parser, at
> `0x425371` and `0x42539b`) and by `fcn.004258d0` (the writer, at
> `0x425c23`). A complete, parameterized `LoadMap` exists, together with
> a `SaveMap` and a `SwitchMap(fromMap, toMap)` driver at `fcn.00426880`.
> Only the 12-byte body of `fcn.00423b50` was actually removed. See
> § "1A" below for the full trace and verification.
>
> The lesson for the rest of this plan: a global that is copied *to a
> file* and a global that is read *by the engine* can be two different
> globals, and an xref census on one says nothing about the other.

### 0.3 Missing resources fail gracefully, and self-report

- `clipper.clp` entries resolve **by name string**, not numeric ID, via
  `fcn.00402650(name, typeFilter, count, table)` — a linear `strcmp` scan.
- A miss formats `"** Could not find Clip '%s' **\n"`, logs it through
  `fcn.0040c910` (an in-memory 1000-char message log at `0x4699ac`), and
  returns `-1 / 0xFFFF`. Callers `cmp ax, 0xFFFF` and skip the draw (e.g.
  `fcn.00406d50` @ `0x406d9f`). 181 call sites all follow this pattern.
- No crash, no out-of-bounds read — and the failure path names the missing
  resource, which is free instrumentation for the whole injection effort
  (see §1C).

### 0.4 `crypt.exe` is a full-game build with only data trimmed

| Signal | Value | Implication |
|---|---|---|
| Dungeon read buffer | 220,000 B | Full `bcdfs` (171,005 B) fits with 49 KB spare |
| Offset table slots | 13 | Full map count |
| Clipper directory array ctor (`0x4030d0`) | sized for **2000** entries | Demo archive has 816 |
| Creature sprite-name table (`0x430800`–`0x431b00`) | **26 creatures** | The whole 13-map roster (Estoroth, Lich Dragon, Medusa, Ram Demon/Lord, Skeleton Lord, Possessor + Possessor Body, Water Lord, Merman, Squid, Magnito, Maggot, Druid Watcher, Ironhead, Slime, Big/Little Glop, Plant, Spider, Cloaker, Spirit, Statue, Green Guy…) — `clipper.clp` has art for **2** (Two Head, Rock Eye) |
| Creature descriptor key | `0xB3` = Rock Eye, `0xB2` = Two Head @ `0x431978`/`0x431a2c` | Same graphics ID convention as Amiga `bcdfs` monster byte `+0x01` |
| Per-creature animation table | `0x00010035` ×6 for Two Head | Verbatim copy of Amiga `bcdfb`'s 214-byte secondary table |
| `clipper.clp` bracket 77–78 | `Start/End Level Specifics`, empty | A hole where per-map resources were removed |

### 0.5 Game logic is intact (spellcasting, combat, etc. — not trimmed)

`fcn.00410d10` returns the same `ResolveTargetSquare` result codes
documented on the Amiga side; `fcn.00423b60` (`MoveParty`) is a structural
1:1 with the Amiga version. Spellbook, chargen, automap, save/restore,
throwing items, all 180 item icons, all 49 floor-item groups, all 29 keys +
87 keyholes are present. The executable's smaller size vs. the Amiga's
executable+overlays is compiler/toolchain output, not a missing subsystem.

---

## Phase 1 — Remaining investigation

§0 answered the three original headline unknowns. Four narrower questions
then gated feasibility; **1A — the only blocking one — is now closed and
came back GO**, taking §0.2's central claim with it (see the correction
there). 1B, 1C and 1D remain open but none of them is a stop condition.

### 1A. What did the removed map-switch routine have to do? — **ANSWERED: GO**

**Verdict: parameterized and reconstructable.** Nothing about map
switching was removed except the 12-byte body of `fcn.00423b50`. The
entire subsystem — a generic per-map loader, a generic per-map writer, a
map-switch driver that composes them, tileset-group reselection, and the
destination position/facing write — is present, intact, and already
exercised by the surviving save/restore path.

#### The map-switch driver survives: `fcn.00426880(fromMap, toMap)`

```c
void SwitchMap(int16 fromMap, int16 toMap)   /* cdecl, caller cleans 8 B */
{
    if (fromMap >= 0) SaveDungeon(1);        /* fcn.004258d0 — flush outgoing map */
    curMap = toMap;                          /* word [0x47481a] */
    LoadDungeon(1);                          /* fcn.00425350 — parse incoming map  */
    if (<tileset group of curMap> != <group of fromMap>)
        LoadResourceGroup(group);            /* fcn.0040b820(1|2|3) */
    LoadPerMapResources(curMap);             /* fcn.0040b7a0(curMap) */
    if (curMap <= 12) word[0x46f84a] = 0;
}
```

It has exactly one surviving caller, `fcn.00426390` (restore-game) at
`0x426867`, which invokes it as `SwitchMap(-1, curMap)` — `-1` being the
"no previous map" sentinel that skips the outgoing save and forces a
tileset load. The demo therefore *already runs the full map-switch path
on every game load*; the only thing it never does is call it with a real
`fromMap`.

**Independent confirmation that this is the real thing — it is a
line-by-line port of the Amiga's level-entry routine.** `fcn.00426880` is
the DOS counterpart of `S_1 +0x1A5CC`, documented in
`amiga/data-structure.md` § "Dungeon tileset selection". The
correspondence is not just the partition but every guard:

| | Amiga `S_1 +0x1A5CC` | DOS `fcn.00426880` |
|---|---|---|
| Order of operations | `JSR $18852` (load map chunk) **then** tileset dispatch | `LoadDungeon` `0x4268a2` **then** dispatch `0x4268b0` |
| Partition | `{1–4, 12–13}` / `{5}` / `{6–11}` on `$1E5C(A4)` | `cmp ax,4 / cmp ax,0xc / cmp ax,5 / cmp ax,0xb` on `word[0x47481a]` |
| Group-1 reload guard | reload iff `5 ≤ prev ≤ 11` | `0x4268e7`: `si < 5` → check sentinel; `si ≤ 11` → load |
| Group-2 reload guard | reload iff `prev ≠ 5` | `0x4268c2`: `si == ax` → skip, else load |
| Group-3 reload guard | reload iff `prev ≤ 5` or `prev ≥ 12` | `0x4268d1`: `si ≤ 5` → load; `si ≥ 12` → load; else skip |
| "No previous map" sentinel | `D2 = −1` | `si = 0xFFFF`, and the surviving caller passes exactly `-1` |

Three independent cache-guard predicates plus the sentinel, reproduced
across a 68k→x86 port. A constant table like that cannot survive by
accident in a build whose map layer was rewritten — and note the guards
are *only meaningful* when maps actually change, which is the behaviour
the demo is supposed not to have.

(The Amiga section calls `$1E5C(A4)` the "level number", but it ranges
1..13 and selects a load unit, so it is the same index space as DOS's
`word[0x47481a]` — the 13 **maps**, not the 28 dungeon levels.)

#### The parser is fully parameterized: `fcn.00425350` (`LoadDungeon`)

It is the byte-exact DOS counterpart of `scripts/bclib/bcdfs.py`'s
`walk_map`, and it is driven **entirely** by the current-map variable:

```c
m   = word[0x47481a];                        /* current map, 1-based    */
fseek(tempdung, dword[0x4738b4 + m*4], SEEK_SET);
len = (m == 13) ? 40000
                : dword[0x4738b4 + (m+1)*4] - dword[0x4738b4 + m*4];
fread(buf, 1, len, tempdung);  cursor = buf;
ResetDungeonArrays(0);                       /* fcn.00411350 */
...                                          /* row/column/entity walk  */
```

There is no inlined map-1 constant anywhere in it. Map 1 works because
`offsetTable[1] == 0`, which is data, not code.

**The runtime offset table is at `0x4738b4`, indexed 1..13** (so its
slots occupy `0x4738b8`..`0x4738e8`; the word at `0x4738b4` itself is the
unrelated game-state variable, and slot 0 is never read). It is populated
by `fcn.00426390` at `0x426787` — 13 dwords read straight out of
`char%hu.dat`, which `fcn.00401b80` wrote from `0x43c424`, which the
loader filled from `MainDung.gam`'s own header. The `m == 13` special
case exists precisely because there is no slot 14 to subtract from —
i.e. the table is sized and indexed for the full 13-map game.

#### The writer is equally generic: `fcn.004258d0` (`SaveDungeon`)

Re-serializes the live 64×64 grid back into the same sparse row format
(scanning each row from column 63 down for the first/last non-`0x0FF00000`
square), then `fseek(tempdung, dword[0x4738b4 + curMap*4])` and writes.
Also keyed on `word[0x47481a]` alone. This is what makes a map's state
persist while the party is away.

#### Party position and facing need **no** new code

This was the one genuinely open sub-question, and the answer is that the
reset already happens *before* the stub is reached, on both call sites:

- `fcn.00410d10` (`ResolveTargetSquare`) writes `*X`, `*Y` **and**
  `*facing` from the type-`0x12` record's words `+0x0C`, `+0x0E` and
  `+0x08` (`0x410dd5`/`0x410de1`/`0x410dee`, and again at
  `0x410e3f`/`0x410e49`/`0x410e58`) before returning code 3. `MoveParty`
  passes `&word[0x46f880]`, `&word[0x46f87e]`, `&word[0x46bd60]`, so the
  party is already standing at the destination coordinates, facing the
  right way, when the destination-map byte is tested.
- The teleport site (`fcn.0041afc0` case 21) writes the same two globals
  from the action record at `0x41b3a0`/`0x41b3a7`, unconditionally, two
  instructions before the stub call.

Both sites also already perform the post-transition redraw (`MoveParty`
falls into its generic tail at `0x423e03`; the teleport case calls
`fcn.00416f30` + `fcn.004102c0`).

#### The patch

`fcn.00423b50` is called as `push destMap; call; add esp,4` from both
sites. Its restored body is a single call:

```asm
    mov   eax, dword [esp+4]      ; destMap (1..13)
    movzx ecx, word [0x47481a]    ; fromMap = current map
    push  eax                     ; arg_ch = toMap
    push  ecx                     ; arg_8h = fromMap
    call  fcn.00426880            ; SwitchMap
    add   esp, 8
    ret
```

~20 bytes. The stub occupies `0x423b50`–`0x423b5b` plus four `0x90` pad
bytes to `0x423b5f` — **16 bytes**, enough for a 5-byte `jmp` to a cave
but not for the body inline.

> **Correction — the code-cave location in the original plan is wrong on
> both halves, and `0x45DBE0` is actively dangerous.**
>
> `.text` *does* have slack: **333 zero bytes at `0x42DEB3`–`0x42E000`**
> (file offset `0x2DEB3`), which is `-r-x` *and* inside the raw image.
>
> `0x45DBE0` fails twice over. First, it has no file bytes: `.data`'s raw
> size ends at vaddr `0x43D000` (`paddr 0x30000`, size `0xD000`), so
> everything past that is BSS and patching it would mean growing the
> section header. Second — and worse — it is **live memory**, not spare
> room. The `.data` tail lays out as:
>
> | Range | Contents |
> |---|---|
> | `0x43C7A0` – `0x45DAE0` | clipper directory, 2000 × 68 B (built by `fcn.0040bbe0`, count in `word[0x469994]`) |
> | `0x45DAE0` – `0x45DB88` | 168 B genuine gap |
> | `0x45DB88` – ~`0x467A28` | **map (de)serialization scratch buffer** — the fixed address `fcn.0040cb50` returns, into which `LoadDungeon` `fread`s and `SaveDungeon` builds, up to 40,000 B |
>
> `0x45DBE0` is 0x58 bytes *inside* that scratch buffer, so a cave there
> would be overwritten by the very first map load or save — i.e. by the
> exact operation the patch exists to trigger. **Use the `.text` slack.**

#### Verification performed

The parser semantics were transcribed instruction-by-instruction from
`fcn.00425350` / `fcn.00425120` / `fcn.00425250` and run blind against
`maindung.gam` (probe: `walk_dos.py`, scratch):

| Check | Result |
|---|---|
| Squares walked in map 1 | **1,530 / 1,530** — matches the confirmed Amiga walk exactly |
| Action records (8 B each) | **45 / 45** — matches |
| Tail-padding invariant | end + **4,000** = next map's offset — i.e. the confirmed Amiga `3,948` plus the 52-byte block DOS offsets are pre-shifted past. Zero deviation |
| Container types recursing | `0x13`, `0x23` — identical set to the Amiga walker |
| Action-chain types | `0x0F 0x16 0x1D 0x1E 0x1F 0x21` — identical set to the Amiga walker |
| Sub-chain head fields | word `+0x0A` (monster) / `+0x0C` (container) — identical to Amiga |
| Monster continuation | second 20-byte record, `+0x13` nonzero ⇒ 4 more bytes — identical to Amiga |

A wrong transcription cannot produce 1,530 squares *and* 45 actions *and*
land on the padding invariant to the byte.

### 1B. How does a record's `gfxNumber` reach a `clipper.clp` entry? — blocking for item/structure art

Partially solved already: `fcn.00406d50` @ `0x406d66` does `gfxNumber −
0x35` then `sprintf("Door Type %d - %d")` — structure art is arithmetic
off the gfxNumber. Across maps 2–13 only **5 structure gfxNumbers** aren't
already covered by map 1's demo art (`0x3D`, `0x46`, `0xE9`, `0xBD`
Statue) — doors, locks, stairs, alcoves, pillars, pits, plates, plaques,
teleports are all covered.

Items are the open part: **166 distinct item gfxNumbers** exist
game-wide (42 in map 1, 124 new), max `0xEA`. `clipper.clp`'s `Start
Items` (175) + `Start Misc` (5) = **180** at 24×24, and `Start Floor
Items` = **49 groups × 3 depths** — both exactly matching the confirmed
Amiga banks. So DOS item *art* is very likely already complete; the only
open question is the gfxNumber → bracket-index resolver (can't be a raw
index, since `0xEA > 180`). If this resolves cleanly, **no item art needs
injecting at all** — a large scope reduction.

### 1C. Does it run under Wine? — enabling, not blocking

Untested deliberately. The game writes `TempDung.gam`, `orig%d.gam`,
`char%d.dat` into its working directory — **run it from a scratch copy
outside the repo, never against `data/blackcrypt/dosvga/` directly.**

`wine` (no `dosbox`) is installed in this environment. A mid-90s
DirectDraw/DirectSound title on Wine is plausible but unconfirmed — it
needs a palettized 320×200 primary surface. Order of investigation:

1. Does it reach the title screen at all? (`wine crypt.exe`,
   `WINEDEBUG=+ddraw,+dsound`)
2. If DirectDraw fails: try a virtual desktop
   (`wine explorer /desktop=bc,640x480`) and 8-bit colour depth.
3. If it runs: read the message log at `0x4699ac` live (via `winedbg` or
   `/proc/<pid>/mem`) — that surfaces every `** Could not find Clip '%s'
   **` and `*** BAD MONSTER AT COLUMN %hd LEVEL %hd ***` by name, for
   free, as an oracle for Phase 3.

This is the DOS-side analogue of the Amiberry MCP oracle used on the Amiga
side, but **not a prerequisite** — every §0 finding came from static
analysis, and Phase 2 has a byte-exact static oracle (§2.1 below). If Wine
won't run it, the project is slower, not dead.

### 1D. Scope the art conversion — sizing, not blocking

- **Creatures:** 24 distinct graphics IDs game-wide, demo has 2 → **19
  new clusters** needed (Amiga total: 204 sprites across `bcdfb`–`bcdfn`).
  Required `clipper.clp` entry names are dictated by the exe's own
  creature table ("Ram Demon 3 S", "Estoroth A 1", …) — no naming
  decisions needed.
- **Tilesets:** the Amiga has three (`bcdfx` levels 1–4+12–13, `bcdfy`
  level 5, `bcdfz` levels 6–11); the demo ships the `bcdfx` equivalent
  only. **2 more tilesets** (~84 and ~47 sub-images) plus 4 more palette
  accent ramps from `bcdfu` are needed.
- ~~Confirm whether the empty `Start/End Level Specifics` bracket is where
  per-map wall decorations belonged, by finding what (if anything) still
  reads that bracket by name.~~ **Answered as a by-product of 1A.** The
  reader is `fcn.0040b7a0(curMap)`, called by `SwitchMap` at `0x42690a`.
  It scans the runtime clipper directory (2000 × 68-byte descriptors at
  `0x43c7a0`, count in `word[0x469994]`, built by `fcn.0040bbe0`) for
  every entry whose descriptor byte `+0x01` equals **`curMap + 10`**, and
  loads each match via `fcn.00402350`. Its sibling `fcn.0040b820(group)`
  does the same for tileset groups **1/2/3**. So per-map resources are
  selected by a numeric group id on the directory entry, *not* by the
  `Start X`/`End X` name brackets — the bracket is a packaging
  convention, and injected per-map entries need group id `map + 10` on
  their descriptor, with `11..23` covering maps 1–13. Group ids `1..3`
  are the tilesets; ids `4..9` are unaccounted for and worth a look
  before Phase 3 assigns anything.

**Owners:** `game-re` agent for 1B/1C/1D. **1A is closed** — see its
section above (resolved by `re-codebreaker`, 2026-08-03).

---

## Go / no-go checkpoint — **RESOLVED: GO**

| 1A outcome | Verdict | |
|---|---|---|
| Parser is parameterized; stub replaceable with a small code cave | **Go.** Phases 2–4 are large but tractable. | ✅ **This is what happened** |
| Parser has map 1 inlined; state rebuild spread across many removed sites | **Stop, or re-scope.** | Ruled out |

1A came back at the favourable end of the favourable branch: not merely
"the parser takes a base offset", but "the whole map-switch subsystem
survives, composed and callable, and the demo already runs it on every
game load". Phase 4 shrinks from "write a map-switching subsystem in x86
with no source" to **one ~20-byte thunk in `.text` slack**, and the
riskiest line item in the effort table is now Phase 3's art volume, not
Phase 4's feasibility.

What that does *not* de-risk: nothing here has been executed. Every claim
above is static analysis plus a byte-exact structural invariant against
`maindung.gam`. The first time the restored call actually runs is
Phase 4, and 1C (does it run under Wine at all) is still untested.

---

## Phase 2 — Data conversion (`bcdfs` → `maindung.gam`) — **DONE**

Endianness is *not* the whole story — this is where the original framing
most underestimated the work.

> **Status: complete and verified, 2026-08-03.** `scripts/bclib/maindung.py`
> converts Amiga `bcdfs` to the DOS encoding; `scripts/verify_maindung.py`
> confirms **zero deviation across all 15,099 bytes** of the round-trip
> against the real shipped `maindung.gam`, and the full 13-map conversion is
> exactly **171,005 B**. The §2.2 oracle gap and the §2.3 "not mechanical"
> items below are all resolved — see the correction block in
> `docs/blackcrypt/dos/data-structure.md` § "Record byte-swap is not a
> blanket word-swap" for the full derivation, evidence, and per-item
> confidence levels. Headline finding: the "boundaries depend on itemType"
> framing below was wrong — the real rule is a single itemType-*independent*
> positional composition, and the only thing that actually varies is
> whether the record is a monster. The subsections below are kept as the
> historical record of what this phase set out to answer; do not read them
> as current status.

### 2.1 What's already verified

Walked the Amiga map 1 with `scripts/bclib/bcdfs.py`, recorded all 1,863
byte spans, compared each against the demo's `maindung.gam` at the same
file offset:

- **Byte positions and sizes are identical** between formats. Same
  header, same sparse row encoding, same 3,948-byte tail. A fully
  converted file is exactly **171,005 B** — same as `bcdfs`, comfortably
  inside the 220,000-byte buffer.
- **1,530/1,530 squares**: exact 4-byte reversal — mechanical.
- **Row headers, the 5-byte map header, and all 45 action records** (8 B
  each): byte-identical, no swap.
- **All 225 mismatches are the 20-byte item/monster/structure records**,
  and the swap is a **per-field 16-bit swap whose boundaries depend on
  `itemType`** (byte `+0x05`) — see the field-map note added to
  `docs/blackcrypt/dos/data-structure.md` for the worked examples. A
  blanket word-swap across the whole record is wrong.

### 2.2 The oracle gap

Map 1 gives byte-exact ground truth for 39 of 48 record kinds used
game-wide. **9 kinds have no oracle** (never appear in map 1): `0x00` (4
records across maps 2-13), Boots `0x0B` (6), Amulet `0x1A` (10), Shirt
`0x1B` (6), Pants `0x1C` (4), Other/Skull `0x27` (20), Panel Item `0x2B`
(10), Idol `0x2C` (3), Statue `0x2F` (9) — 72 records total. For these,
field typing must come from `crypt.exe`'s own struct accesses (find each
type's consumer, observe byte- vs. word-width reads) — ~9 small,
independently-checkable traces.

### 2.3 Things that are *not* mechanical

- **"Unique" IDs do not need renumbering** — they're per-map (12-bit
  square field, records indexed within the map's own array), and the
  engine parses one map at a time into a single array. No cross-map
  collision. Re-confirm this survives whatever 1A concludes about state
  rebuild.
- **`bcdft` name references are almost certainly not portable as-is.**
  Item record `+0x02` is a tagged reference into the Amiga `bcdft` string
  image; `crypt.exe` has its own string storage. Do this diff *first* in
  Phase 2 — cheap, and de-risks the whole phase: diff the Amiga and DOS
  `+0x02` words on map 1's surviving records and the transform (identity?
  table remap?) falls out immediately, then re-map all 685 references.
- Action chains appear byte-identical in map 1 — verify against maps
  2–13's richer action set, not just map 1's 45.

### 2.4 Deliverable

`scripts/bclib/maindung.py`, mirroring `bcdfs.py`'s walker to emit DOS
field encodings, plus a round-trip test: convert Amiga map 1 → compare
byte-for-byte against the shipped `maindung.gam`. **Zero deviation on
15,099 bytes, or the converter is wrong.** This test is available before
touching maps 3–13, and is worth doing regardless of the Phase 1
go/no-go — it documents the port's data model either way.

---

## Phase 3 — Resource injection (`clipper.clp`)

### 3.1 Container mechanics

`uint16 count` + `count × 56`-byte directory + raw, uncompressed data.
Appending isn't a simple append — inserting entries shifts every existing
data offset, so the whole file must be rewritten with recomputed offsets
(~30 lines). Headroom: in-memory table is built for 2000 entries vs. the
demo's 816 — room for ~1,184 more; the 19 creature clusters (~190
entries) + 2 tilesets (~130) fit with margin. New entries must go inside
the correct `Start X`/`End X` bracket (resolved by name in `.text`); `End
Monsters` currently sits at file offset 1,151,267 = EOF, the natural
growth point for creatures.

### 3.2 Art conversion

Source: `public/assets/blackcrypt/amiga/` (gitignored, rebuild via
`scripts/extract_*`). Amiga is 6-bitplane EHB + 1-bit mask, RLE-compressed;
DOS is raw 8-bit linear, uncompressed, transparency keyed on palette index
33. Conversion: deplane → remap through the EHB↔VGA palette
correspondence (already partly proven — DOS's `Character Gen Palette` is
confirmed to be the Amiga chargen palette rescaled, `n×17` vs `n×16`,
94/96 components matching; do the same derivation for the dungeon palette
and the 4 remaining `bcdfu` accent ramps) → write mask pixels as index 33.
Entry names are dictated by `crypt.exe`'s own creature table, removing
naming guesswork.

### 3.3 Sanity ceiling — say this out loud in the docs

Amiga creature sprites are 64-colour EHB against a 32-entry base palette;
DOS entries are 8-bit against a 256-entry palette. Colour fidelity will be
*better* than the Amiga original, but injected creatures will visibly
differ in style from Rick Johnson's two hand-redrawn DOS creatures (Two
Head and Rock Eye were re-authored for the port, same as the item icons —
not converted). The result is "the full game, with 19 creatures rendered
in Amiga art," not "the port Raven/Rick Johnson would have shipped."

---

## Phase 4 — Code restoration

**1A cleared this.** Final shape, with the exact bytes 1A established:

1. Overwrite `fcn.00423b50` (`0x423b50`, file offset `0x23b50` — 12 bytes
   of stub plus 4 bytes of `0x90` padding, 16 usable) with a 5-byte
   `jmp rel32` to the cave.
2. Put the thunk in the **`.text` slack at `0x42DEB3`–`0x42E000`** (file
   offset `0x2DEB3`, 333 zero bytes, `-r-x`, inside the raw image — *not*
   `0x45DBE0`, which is BSS *and* sits inside the live map scratch
   buffer; see the correction in §1A):

   ```asm
       mov   eax, dword [esp+4]      ; destMap, as pushed by both call sites
       movzx ecx, word [0x47481a]    ; fromMap = current map
       push  eax                     ; toMap
       push  ecx                     ; fromMap
       call  0x426880                ; SwitchMap
       add   esp, 8
       ret
   ```

   No party-position or facing reset is needed — `ResolveTargetSquare`
   and the teleport case already wrote both before the call (§1A).
3. Ship as a patcher script (`scripts/patch_crypt_exe.py`) applying the
   diff to a user-supplied `crypt.exe` — never commit a modified binary.

**Sequencing note:** this patch is testable the moment Phase 2 produces a
`maindung.gam` containing a real map 2, using map 1's *existing*
cross-map staircase at (col 49, row 23) whose destination-map byte is
already `2` (§1A verification). No art is required to prove the code
patch — walls will render from the map-1 tileset. That makes Phase 4
independently testable *before* Phase 3, which is the reverse of the
original assumption.

---

## Verification — what "it worked" looks like

| Phase | Concrete success criterion |
|---|---|
| 1 | ✅ 1A: named parser (`fcn.00425350`), named driver (`fcn.00426880`), verdict *parameterized*, verified at 1,530/1,530 squares + 45/45 actions + zero-deviation padding invariant. 1B still open: gfxNumber→bracket resolver with all 166 item gfxNumbers accounted for |
| 2 | ✅ **Done.** Converter reproduces the shipped `maindung.gam` byte-for-byte, 15,099/15,099, from `bcdfs` map 1 alone; full 13-map output is exactly 171,005 B. `scripts/bclib/maindung.py` + `scripts/verify_maindung.py` |
| 3 | Rebuilt `clipper.clp` still boots the demo unchanged (all 816 original entries resolve identically); a deliberately-injected sprite (e.g. a Ram Demon placed into map 1) renders correctly |
| 3 (instrumented, if 1C succeeds) | Under Wine, the `0x4699ac` message log shows zero `** Could not find Clip '%s' **` lines while walking a converted map |
| 4 | Take map 1's staircase at (col 49, row 23) — its destination-map byte is already `2` — and arrive in map 2 at (27, 20) without the "TEST LEVEL" message, then walk back up |
| End-to-end | Reach Estoroth on map 13 |

**Test ordering:** Phases 3 and 4 are *both* independently testable
before the other exists. Phase 3 by injecting a maps-3–13 creature into
converted map 1 data; Phase 4 by converting only map 2 and using the
already-present cross-map staircase (previous row). Do whichever is
cheaper first — 1A's outcome means neither blocks the other.

---

## Effort and tooling

| Phase | Effort | Confidence | Tooling |
|---|---|---|---|
| ~~1A map-switch trace~~ | **Done** (one session) | **Resolved — go** | `re-codebreaker`, radare2 |
| 1B gfxNumber resolver | Hours–1 day | High | `game-re`, radare2 |
| 1C Wine viability | Hours | Unknown | `wine`, `winedbg`, scratch copy of game dir |
| 1D art scoping | Hours | High | `game-re`, existing `bclib` |
| ~~2 converter~~ | **Done** (one session) | **Verified — zero deviation, 15,099/15,099 B** | Python, `bclib`, `game-re`, radare2 |
| 3 resource injection | Days–weeks (19 clusters + 2 tilesets) | Medium-high | Python, existing extraction pipeline |
| 4 code patch | **Hours** — one ~20 B thunk + a 5 B `jmp` | **High** — all callees identified and verified | radare2, Python patcher |

**Phase 2 is the safest work in the whole plan** and independently valuable
— a verified `bcdfs`↔`maindung.gam` converter documents the port's data
model regardless of whether the game ever becomes playable. If hedging
against a bad 1A verdict, do Phase 2 first regardless.

## Repo hygiene

`data/blackcrypt/dosvga/` and `public/assets/` are gitignored (there's a
prior incident of raw data being committed — see commit `35721c8`). Any
converted `maindung.gam`, rebuilt `clipper.clp`, or patched `crypt.exe` is
derived game/demo data and must stay out of git — ship the *scripts that
produce them*, and confirm `.gitignore` covers whatever output directory
Phase 2/3 use before the first run.

## Files most critical for implementation

- `scripts/bclib/bcdfs.py` — verified Amiga map walker; Phase 2's
  converter (`scripts/bclib/maindung.py`, done, see `scripts/
  verify_maindung.py`) is its mirror
- `data/blackcrypt/dosvga/crypt.exe` — Phases 1 and 4 target;
  `fcn.00423b50` (stub), `fcn.00423b60` (`MoveParty`), `fcn.00401fa0`
  (loader), `fcn.00402650` (name resolver), creature table at
  `0x430800`–`0x431b00`
- `scripts/extract_clipper.py` — the `clipper.clp` reader; Phase 3's
  writer inverts it
- `docs/blackcrypt/dos/data-structure.md` — carries the §0 corrections
- `docs/blackcrypt/amiga/data-structure.md` — ground truth for record
  layouts, the `bcdfb`–`bcdfn` creature banks, and the 3-tileset split

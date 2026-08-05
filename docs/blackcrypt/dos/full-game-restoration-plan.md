# Plan: can the Black Crypt Windows demo be completed from Amiga data?

**Status: Phase 1A resolved — GO. 1B resolved — no new item art needed.
Phase 4 resolved — DONE (`scripts/patch_crypt_exe.py`, byte-exact verified).
1D resolved — art scoping done, exact Phase 3 payload manifest below.
1C still open.** This
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

> **RESOLVED, 2026-08-04 — inventory/key icon resolver found, traced, and
> verified: no new item art needs injecting.** The item-side counterpart
> to `fcn.00406d50` is a **static LUT + arithmetic pair**, not a by-name
> string search (`fcn.00402650` never runs per-record for items — it only
> runs once, at startup, to locate the *bracket* boundaries).
>
> **The `gfxNumber → icon-index` table.** `fcn.00403550(gfxNumber,
> enchantOffset)` — the general item-icon draw routine, called (directly
> or via the zero-offset wrapper `fcn.004033c0`) from **14** distinct
> sites across the binary (`fcn.0040bbe0`, `fcn.00410598`,
> `fcn.00410bc0`, `fcn.0041abc0`, `fcn.0041cf50` ×2, `fcn.0041d570`,
> `fcn.0041f220` ×2, `fcn.004201f0` ×2, `fcn.00421480`, `fcn.0041c220` —
> inventory, panel/container fill, examine, and message-box contexts) —
> does:
> ```
> iconIndex = word[gfxNumber*2 + 0x431b16]      ; 235-entry word table, gfxNumber 0..234
> if (iconIndex == 0xFFFF) -> no icon (fallback surface, no crash)
> directoryIndex = word[0x46b806] + iconIndex + enchantOffset  ; 0x46b806 = "Start Items" bracket index + 1
> <index the runtime 68-byte clipper directory at 0x43c7a0 + directoryIndex*68, blit>
> ```
> `word[0x46b806]` is set once at startup in `fcn.0040bbe0` @ `0x40bf37`,
> immediately after `fcn.00402650(0x0, 0, count, 0x43c7a0)` resolves the
> string `"Start Items"` to its directory index — i.e. the *only* by-name
> lookup for items is finding the bracket's start, exactly the structure
> pattern already documented in § "0.3". `0x431b16` is the DOS-native
> analogue of the Amiga `bcdft` S_1 `+0x26EF2` table already confirmed in
> `amiga/data-structure.md` § "`gfxNumber` → icon index" — same role
> (`gfxNumber → icon-index`, sentinel = "no icon"), same domain
> (`gfxNumber` 0..234/235, `0xEA` = 234 is the real corpus max), only the
> width (word, not byte) and the sentinel value (`0xFFFF`, not `0`)
> differ.
>
> **The key resolver.** `fcn.004033d0(gfxNumber)`, reached from
> `fcn.00410bc0` only when the record's `itemType` byte is `0x06` (Key):
> ```asm
> 0x4034bd  mov ebp, word [0x43c46e]     ; "Start Keys" bracket index + 1
> 0x4034c1  add eax, 0xffffff38          ; gfxNumber + (-200) = gfxNumber - 200
> ```
> i.e. `directoryIndex = word[0x43c46e] + (gfxNumber − 200)` — the exact
> DOS counterpart of the Amiga key rule already confirmed in
> `amiga/data-structure.md` (`keyIndex = gfxNumber − 200`, line ~2059),
> down to using the identical constant. `word[0x43c46e]` is set the same
> way as `0x46b806`, off the `"Start Keys"` string, in the same
> `fcn.0040bbe0` prologue.
>
> **Verification.**
>
> 1. **Cross-platform numeric match against the independently-derived
>    Amiga LUT.** `public/assets/blackcrypt/amiga/data/item-names.json`'s
>    `catalog` (169 entries, built from the *Amiga* `bcdft` S_1 `+0x26EF2`
>    table via a completely separate derivation) was diffed against a
>    dump of DOS `0x431b16`: **139/139 exact numeric matches** on every
>    catalog entry with a real icon (`iconIndex != 0`), and the remaining
>    **30/30** catalog entries (27 keys, gfx 200-227; Statue gfx `0xBD`;
>    Illusionary Walls gfx `0xC1`; Monster Generator gfx `0xE8`) all read
>    `0` on the Amiga side (Amiga's "no `Start Items` icon" sentinel) and
>    `0xFFFF` on the DOS side (DOS's own sentinel) — same semantic
>    verdict, different platform's sentinel convention. **169/169 (100%)
>    agreement**, zero real discrepancies.
> 2. **Full game-wide corpus coverage.** Walking all 13 maps with
>    `scripts/bclib/bcdfs.py` (`STRUCTURE_TYPES` excluded) reproduces the
>    task's own **166** figure exactly: 139 non-key item `gfxNumber`s +
>    27 key `gfxNumber`s = 166, split 42 (map 1) / 124 (maps 2-13) —
>    matching the prompt's numbers to the record. **All 139 non-key items
>    resolve to a non-`0xFFFF` entry in `0x431b16` — 0 misses.** All 27
>    keys are covered by the confirmed `gfxNumber − 200` arithmetic
>    (`200..227`, `0x43c46e`-based), independent of the `0x431b16` table
>    entirely.
> 3. **Structural cross-check against the real, shipped `clipper.clp`.**
>    Parsing the demo's own directory: `"Start Items"` is entry **446**,
>    `"End Items"` is entry **622** — exactly **175** entries in between,
>    every one **type 2 (image), 24×24, 576 B**. `word[0x46b806] =
>    idx(Start Items) + 1 = 447`. `iconIndex 0` → directory entry `447`
>    (the *first* real item image); `iconIndex 174` (the table's own
>    maximum, confirmed above) → directory entry `621` (the *last* one,
>    immediately before `"End Items"`). Zero off-by-one in either
>    direction — the icon-index domain the table produces exactly spans
>    the bracket's real entry count.
>
> **Verdict: Phase 3 needs zero new item icon art.** Every one of the 166
> `gfxNumber`s used anywhere in the full 13-map game — including all 124
> that only appear in maps 2-13, never in the demo — resolves through
> code and data **already present, unmodified, in `crypt.exe` and the
> demo's own shipped `clipper.clp`**, to a real, already-drawn 24×24
> image or key icon. This is a stronger result than the structure-art
> finding in the same section: there, 5 of the game's structure
> `gfxNumber`s still need new art; here, the count is 0. Combined with
> structure art (5 new needed) and the separately-confirmed
> `Start Floor Items` bank-size match (49 groups × 3 depths, not
> individually re-traced this pass — the floor-drop rendering path uses a
> different, group/depth-indexed table at `0x43272a` reached through
> `fcn.00405620`, which appears to be the DOS counterpart of the Amiga
> `+0x26FDE` floor-group table but was not exhaustively verified; flagged
> as a small residual unknown, not a blocker, since the bank *size* match
> already gives strong indirect confidence), **Phase 3 shrinks to just
> the 19 creature clusters and 2 tilesets already scoped in § "1D"** —
> item/key art needs no injection at all.
>
> Function/address summary for future reference: `fcn.00403550` (item
> icon resolver, general), `fcn.004033c0` (its zero-offset wrapper, 13
> call sites), `fcn.004033d0` (key icon resolver), `fcn.00410bc0`
> (itemType dispatcher: `0x05` Potion / `0x06` Key / `0x0E` Food get a
> variant offset, everything else goes through the zero-offset wrapper),
> `0x431b16` (gfxNumber→iconIndex table, 235 words), `0x46b806` /
> `0x43c46e` (bracket-base globals for Start Items / Start Keys,
> populated by `fcn.0040bbe0`).

### 1C. Does it run under Wine? — **partially answered: yes, but unusable as-is**

**Status, 2026-08-04 (user, manual test):** it launches and reaches gameplay
— the DirectDraw surface is not a hard blocker. But the presentation is
broken: it comes up in a full-screen *blocking* window with the real
320×200-class viewport rendered tiny in one corner of the screen ("320×256
smooshed"), not filling the display. That's consistent with DirectDraw
falling back to a stretched/letterboxed emulation path rather than a true
palettized primary surface — plausible causes, not yet root-caused:
`winecfg`'s DirectDraw renderer setting (`gdi` vs `opengl` vs `vulkan`),
forcing an explicit virtual-desktop resolution matching the game's native
mode instead of the desktop's, or a scaling/DPI setting Wine applies by
default that the original DirectDraw blit path doesn't expect.

**Still open, now narrower:** get the window to actually fill at native
resolution (try `wine explorer /desktop=bc,320x200`, or
`winecfg` → Graphics → force a virtual desktop at the game's own
resolution, or `WINEDEBUG=+ddraw` to see what surface size/format it
actually negotiates) — this is a display-config problem, not a
compatibility-of-the-executable problem, so it doesn't change 1C's
"enabling, not blocking" status. Once legible, resume the original
plan below: read the message log at `0x4699ac` live as a Phase 3 oracle.

Untested-and-still-open below this line is the original plan text.

The game writes `TempDung.gam`, `orig%d.gam`,
`char%d.dat` into its working directory — **run it from a scratch copy
outside the repo, never against `data/blackcrypt/dosvga/` directly.**

`wine` (no `dosbox`) is installed in this environment. A mid-90s
DirectDraw/DirectSound title on Wine is plausible but unconfirmed — it
needs a palettized 320×200 primary surface. Order of investigation:

1. ~~Does it reach the title screen at all?~~ **Yes — confirmed 2026-08-04.**
2. Presentation is broken (see above) — try a virtual desktop pinned to
   the game's native resolution, or force the DirectDraw renderer backend.
3. If legible: read the message log at `0x4699ac` live (via `winedbg` or
   `/proc/<pid>/mem`) — that surfaces every `** Could not find Clip '%s'
   **` and `*** BAD MONSTER AT COLUMN %hd LEVEL %hd ***` by name, for
   free, as an oracle for Phase 3.

This is the DOS-side analogue of the Amiberry MCP oracle used on the Amiga
side, but **not a prerequisite** — every §0 finding came from static
analysis, and Phase 2 has a byte-exact static oracle (§2.1 below). If Wine
won't run it legibly, the project is slower, not dead.

**A cleaner alternative to `winedbg`/`/proc/<pid>/mem` polling, not yet
tried:** [`elishacloud/dxwrapper`](https://github.com/elishacloud/dxwrapper)
(MIT) ships a general "load custom `.dll` files into the game process" /
ASI-loader facility, independent of its DirectDraw/Direct3D wrapping
features. That's a ready-made injection mechanism for a small,
purpose-built companion DLL that reads the `0x4699ac` log buffer directly
out of the process's own memory and reports it (to a file, a pipe,
stdout) the moment something is missing — turning §Phase 3's "walk a
converted map and see if anything's missing" check into something that
runs unattended, on native Windows or under Wine, instead of a live
`winedbg` session. Not built this pass; noted here as the concrete
mechanism if/when Phase 3 wants it. See § "1E" for why `dxwrapper` itself
is *not* the pick for the DirectDraw presentation problem (`cnc-ddraw`
is) — this is a separate, narrower use of a different one of its
features.

### 1D. Scope the art conversion — sizing, not blocking

- ~~**Creatures:** 24 distinct graphics IDs game-wide, demo has 2 → **19
  new clusters** needed~~ **superseded — see the RESOLVED block below: it's
  25 creatures / 23 new clusters, and the earlier "24"/"19" undercounted.**
- ~~**Tilesets:** ... **2 more tilesets** (~84 and ~47 sub-images) plus 4
  more palette accent ramps from `bcdfu` are needed.~~ **superseded — exact
  counts and a corrected ramp total below.**
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
  their descriptor, with `11..23` covering maps 1–13. ~~Group ids `1..3`
  are the tilesets; ids `4..9` are unaccounted for and worth a look
  before Phase 3 assigns anything.~~ **Resolved below.**

> **RESOLVED, 2026-08-04 — creature roster, group ids 4-9, and tileset/ramp
> counts all nailed down by static analysis (radare2 + the existing Amiga
> corpus); no live execution used.**
>
> #### Creatures — 25 identities, not 24; 23 new clusters, not 19
>
> `crypt.exe`'s creature-name table isn't at `0x430800` itself — that
> address is a **152-byte preamble** (a small count/index table, role not
> needed for this scope) preceding **26 fixed-size 180-byte (`0xB4`)
> records** running `0x430898`–`0x431ae0` (file-identical to VA, this
> `.exe`'s sections are all raw-identity-mapped: `file_offset = VA -
> 0x400000` for every section). Each record is `dword gfxId` + `2×dword`
> pointer + `6×dword` (a `0x00010035`-constant block, confirmed
> Two-Head-identical to the plan's own §0.4 citation) + **12× (`dword`
> pointer, `word` w, `word` h, `dword` flag)** — a 3-tier × 4-facing frame
> slot table (pointers alias for mirrored facings, e.g. Two Head's N and E
> slots share one pointer — the DOS-side counterpart of the Amiga
> "mirror-view" sprites already documented in `amiga/data-structure.md`).
> Scanning the whole region for the known Amiga `gfxId` byte values as
> zero-extended dwords finds all **26** records, exactly once each, at a
> uniform 180-byte stride — the region has no other content.
>
> Reading `crypt.exe`'s own `Start Monsters`/creature-name strings (never
> read directly before — the plan's earlier "24"/"26" figures came from
> the `0x430800` preamble and clue-book cross-reference, not this table)
> gives **26 creature-name groups**, matching `0.4`'s original roster
> ("Estoroth, Lich Dragon, Medusa, ... Statue, Green Guy…") term-for-term:
> `Two Head`(7 frames: `3S/3E/2S/2E/1S/1E/A0`), `Rock Eye`(7: `3S/2S/1S/1E/
> 1N/A1/A0`), `Magnito`(10), `Green Guy`(4), `Maggot`(10), `Druid Watcher`
> (10), `Ironhead`(10), `Slime`(4), `Big Glop`(10), `Little Glop`(10),
> `Lich Dragon`(2: `1/A0`), `Plant`(10), `Spider`(10), `Possessor`(10),
> `Possessor Body`(10), `Ram Demon`(11: adds `A1`), `Cloaker`(2: `1/A0`),
> `Ram Lord`(10), `Merman`(10), `Squid`(10), `Water Lord`(10, two words —
> an earlier `Waterlord`-only regex search missed it, hence the original
> "unaccounted" framing), `Medusa`(10), `Spirit`(4), `Statue`(3: `3/2/1`),
> `Skeleton Lord`(10), `Estoroth`(11). **`Statue` is not a creature** — its
> gfx id `0xbd` is the Statue *structure*, already inside §1B's "5 new
> structure gfxNumbers" bucket, so it's excluded from the creature count
> below (its 3 sprites are still part of Amiga's 204-sprite total, just
> tracked under structure art, not double-counted).
>
> **The 26 records and 26 name-groups pair up positionally, in *reverse*
> file order** (the record area is built high-to-low, `Estoroth`…`Two
> Head`; the name/string pool is laid out low-to-high, `Two Head`…
> `Estoroth`) — confirmed three independent ways: (1) every one of the 10
> creatures already named via the Amiga-side Manual/Clue-book
> cross-reference lands on the thematically matching DOS name at its
> paired position (`0xb2`→Two Head, `0xb3`→Rock Eye, `0x50`→**Lich
> Dragon** [=Dragonlich], `0xb5`→**Ram Demon**, `0xb6`→**Ram Lord**,
> `0xbc`→**Water Lord** [=the Great Waterlord], `0xbe`→**Medusa**,
> `0xc5`→**Estoroth**, `0xbd`→**Statue**); (2) frame count matches exactly
> for 23/26 pairs; (3) the 3 residual count mismatches (below) are all
> Amiga-side *undercounts* consistent with the already-documented
> mirror-view mechanism, not random noise. **New finding, not previously
> recorded on either side:** the Possessor pair flips the guess a naming
> pass made from thematic-only reasoning — `0xb7` (no static placement, a
> recolour variant) is named **`Possessor`**, and `0xb8` (placed, carries
> the game's only `SOUL KEY`) is named **`Possessor Body`** — the reverse
> of the plausible-sounding assumption; not applied to
> `scripts/cluster_monster_names.py`'s `NAMED_CLUSTERS` this pass (out of
> scope — Phase 3's job), but worth doing then.
>
> | gfx | Map | Bank | Amiga n | DOS name | DOS n | Δ | Shipped? |
> |-----|-----|------|---------|----------|-------|---|----------|
> | `0xb2` | 1 | bcdfb | 7 | Two Head | 7 | 0 | **yes** |
> | `0xb3` | 1 | bcdfb | 7 | Rock Eye | 7 | 0 | **yes** |
> | `0x4f` | 2 | bcdfc | 7 | Magnito | 10 | +3 | no |
> | `0xb0` | 2 | bcdfc | 4 | Green Guy | 4 | 0 | no |
> | `0xb1` | 2 | bcdfc | 10 | Maggot | 10 | 0 | no |
> | `0x4d` | 3 | bcdfd | 10 | Druid Watcher | 10 | 0 | no |
> | `0x4e` | 3 | bcdfd | 10 | Ironhead | 10 | 0 | no |
> | `0xc7` | 3 | bcdfd | 4 | Slime | 4 | 0 | no |
> | `0x4b` | 4 | bcdfe | 7 | Big Glop | 10 | +3 | no |
> | `0x4c` | 4 | bcdfe | 7 | Little Glop | 10 | +3 | no |
> | `0x50` | 4 | bcdfe | 2 | Lich Dragon | 2 | 0 | no |
> | `0xba` | 5 | bcdff | 10 | Plant | 10 | 0 | no |
> | `0xc3` | 5 | bcdff | 10 | Spider | 10 | 0 | no |
> | `0xb7` | 6 | bcdfg | 10 | Possessor | 10 | 0 | no |
> | `0xb8` | 6 | bcdfg | 10 | Possessor Body | 10 | 0 | no |
> | `0xb5` | 7 | bcdfh | 10 | Ram Demon | 11 | +1 | no |
> | `0xb9` | 7 | bcdfh | 1 | Cloaker | 2 | +1 | no |
> | `0xb6` | 8 | bcdfi | 10 | Ram Lord | 10 | 0 | no |
> | `0xc4` | 9 | bcdfj | 10 | Merman | 10 | 0 | no |
> | `0xbf` | 9 | bcdfj | 10 | Squid | 10 | 0 | no |
> | `0xbc` | 10 | bcdfk | 10 | Water Lord | 10 | 0 | no |
> | `0xbe` | 11 | bcdfl | 10 | Medusa | 10 | 0 | no |
> | `0xc6` | 11 | bcdfl | 4 | Spirit | 4 | 0 | no |
> | `0xb4` | 12 | bcdfm | 10 | Skeleton Lord | 10 | 0 | no |
> | `0xc5` | 13 | bcdfn | 11 | Estoroth | 11 | 0 | no |
> | *(`0xbd`, map 11, bcdfl, 3 frames, "Statue" — structure, see §1B)* | | | | | | | |
>
> Totals (creatures only, `0xbd` excluded): **25 creature identities, 2
> already shipped → 23 new clusters** (not 19 — the plan's original count
> undercounted by missing `Water Lord` in its own filter and by treating
> the `0x430800` preamble as the table). Amiga sprite total 201 (excl.
> Statue), 14 already shipped → **187 new sprites to convert**. DOS entry
> total 212 (excl. Statue), 14 already shipped → **198 new `clipper.clp`
> directory entries to write**. The gap between those two deltas (`198 −
> 187 = 11`) is exactly the 5 rows with `Δ > 0` above (`+3` Magnito, `+3`
> Big Glop, `+3` Little Glop, `+1` Ram Demon, `+1` Cloaker) — DOS names 3
> tiers × 4 facings per "normal" creature but several Amiga clusters only
> store 7 (not 10) distinct bitmaps, reusing one pixel image under two
> facing names (directory-entry aliasing — one image, two directory
> records pointing at it — is already a confirmed mechanism in this
> container; Two Head's own N/E facing-slot pointers alias the same way,
> per the record layout described above) —
> so **11 of the 198 new entries need no new pixel conversion**, just an
> extra directory record pointing at an already-converted sprite. Ram
> Demon (`+1`) and Cloaker (`+1`) are small residuals worth a second look
> in Phase 3 (either a genuinely missed 11th/2nd Amiga sprite, or one more
> hand-redrawn DOS-only pose like Two Head/Rock Eye's own re-authoring,
> §3.3) but don't change the headline numbers.
>
> #### Group ids 4-9 — resolved: two real, four dead
>
> All 4 call sites to `fcn.0040b820(group)` in the whole binary are now
> traced (its only 4 xrefs, confirmed exhaustively):
>
> | Call site | Caller | Group | Role |
> |---|---|---|---|
> | `0x4268fb` | `fcn.00426880` (`SwitchMap`) | `1`/`2`/`3` (dynamic) | Tilesets — already known |
> | `0x40bf01` | `fcn.0040bbe0` (directory build) | **`0`** (literal `esi`, xor'd at function entry and never rewritten before this call — radare2's static analysis comment guessed `0xa` here, which the actual data flow refutes) | Runs once during the initial `clipper.clp`-directory build, before the first by-name resolution (`Start Items`); role not needed for this scope |
> | `0x401008` | `fcn.00401000`, called only from `fcn.00402700` | **`5`** (literal) | One-time **startup preload**, run before the title sequence |
> | `0x40b974` | `fcn.0040b970` | **`6`** (literal) | The **title/splash sequence itself** — this function's body references `"Title 1"`…`"Title 4"`, `"Scroll Font 1"`, `"Bubble"`, `"Start Attack Sounds"`, and the literal string `"PC CRYPT V1.0 BY RICK JOHNSON!"` |
>
> **`4`, `7`, `8`, `9` are never passed to `fcn.0040b820` anywhere in
> `crypt.exe`** — confirmed by enumerating literally every call site to the
> only function that dispatches on a bare group id (as opposed to
> `curMap+10`, which only ever produces `11..23`). They are dead/unused
> ids, not an unscoped resource category — **this does not change Phase
> 3's scope**: `5` and `6` are UI/startup bundles the demo already ships
> in full (not creature or tileset content), and `0` is an internal
> build-time no-op-looking pass. Group ids actually meaningful to Phase 3
> remain exactly `1..3` (tilesets) and `11..23` (per-map).
>
> #### Tilesets and accent ramps — exact counts, and one correction
>
> Confirmed against the already-solved Amiga corpus (`amiga/data-structure.md`
> §§ "bcdfx/y/z" and "Dungeon accent-ramp selection"), replacing the
> plan's earlier `~84`/`~47`/`4 more ramps` approximations:
>
> - `bcdfx` (**already shipped** — the demo's own tileset): **84**
>   sub-images (83 pixel images + 1 door-clip stencil), 12 chunks,
>   100% byte coverage confirmed. Serves ramp **0** (tan, levels 1-4) and
>   ramp **3** (grey, levels 12-13).
> - `bcdfy` (new): **47** sub-images (7 of the same 12 chunk kinds — it
>   genuinely lacks the pit/alcove/plaque/panel-fountain/button chunks),
>   all decoded. Serves ramp **1** (violet/plum) exclusively, level 5 only.
> - `bcdfz` (new): **84** sub-images, same 12-chunk structure as `bcdfx`,
>   all decoded. Serves ramp **2** (bone/cream) exclusively, levels 6-11.
> - **New tileset sub-image conversions needed: 47 + 84 = 131.**
> - **Ramps — corrected from "4 more" to 3.** `bcdfu` stores 5 named
>   32-word dungeon-look variants (0 tan, 1 violet, 2 bone, 3 grey, 4
>   blue-grey), but the confirmed tileset↔ramp dispatch table
>   (`amiga/data-structure.md` § "Dungeon accent-ramp selection") is
>   **bijective and only ever selects ramps 0-3** — ramp 4 (blue-grey) is
>   not used by any tileset/level and was never a Phase-3 requirement; the
>   plan's original "4 more" simply counted "5 stored variants minus the
>   1 already shipped" without checking which ones dungeon rendering
>   actually calls for. Ramp 0 is already shipped (demo's own `Palette`/
>   `Automap_Palette`). **New ramps needed: 1 (violet, `bcdfy`), 2 (bone,
>   `bcdfz`), 3 (grey, `bcdfx`'s own levels 12-13 recolour) — 3, not 4.**
>   Bonus lead, not confirmed this pass: ramp 2's 6 accent values are
>   byte-identical to the demo's own already-shipped `Options_Palette`
>   entry (`amiga/data-structure.md` line ~4728) — worth checking in
>   Phase 3 whether that resource can be reused outright instead of
>   injecting a new one, though the two may differ in on-disk shape (full
>   256-colour palette vs. a 6-entry accent ramp).
>
> #### Total Phase 3 payload manifest
>
> | Item | Count |
> |---|---|
> | New creature clusters | 23 (of 25 total identities; 2 shipped) |
> | New `clipper.clp` creature entries | 198 |
> | New creature sprite pixel-conversions | 187 (11 of the 198 entries alias an already-converted sprite) |
> | New tileset sub-image conversions | 131 (47 `bcdfy` + 84 `bcdfz`) |
> | New accent-ramp palettes | 3 (ramps 1, 2, 3 — was stated as 4) |
> | (tracked separately, unchanged) structure gfxNumbers, §1B | 5, incl. Statue's 3 sprites already in the 204-sprite Amiga total |
>
> New directory entries overall: `198 + 131 (one per sub-image, upper
> bound) + 3 = 332`, comfortably inside the confirmed **~1,184**-entry
> headroom (§3.1). Total new pixel-art conversions: `187 + 131 = 318`
> sprites/sub-images, none requiring new hypotheses — every one resolves
> to a real, already-decoded Amiga source image or accent-ramp table entry.

### 1E. DirectDraw modernization (stretch) — recommended, not yet visually confirmed

**Not part of the core restoration scope** — this is the project owner's
own stretch-goal idea: could a community DirectDraw compatibility wrapper
DLL (`ddraw.dll` dropped into the game's own directory, no changes to
`crypt.exe`) fix 1C's "launches, but the viewport renders tiny in a
letterboxed corner" presentation bug, both under Wine and on native modern
Windows?

**Candidates surveyed:**

| Project | License | Fit for this title |
|---|---|---|
| **cnc-ddraw** (`FunkyFr3sh/cnc-ddraw`, canonical home now under the `CnCNet` org) | **MIT** | **Best fit.** GDI/OpenGL/Direct3D9 reimplementation of the DirectDraw API specifically for palettized, blitter-based 2D DirectDraw titles (its own description: "black screen, bad performance, crashes, defective Alt+Tab") — exactly Black Crypt's profile (320×200-class palettized primary surface, DirectDraw 3, no Direct3D use). Actively maintained (latest tagged release 7.1, prior release Dec 2024 per GitHub). Explicitly documents Wine support, including the exact override needed (`winecfg` → override `ddraw` as native, or `WINEDLLOVERRIDES="ddraw=n,b"`) |
| **DDrawCompat** (`narzoul/DDrawCompat`) | BSD Zero Clause (source and binaries alike, from v0.3.0 on) | Actively maintained (releases through v0.7.x). Scope is narrower and different: DirectDraw *and* Direct3D 1-7 visual/compatibility fixes (palette flicker, cursor glitches, timing) on **native Windows Vista-11**, not a general presentation/scaling layer, and its README doesn't document Wine as a target environment at all. A plausible second try, not the first choice, for a title with no Direct3D usage |
| **dgVoodoo2** (`dege`, `dgvoodoo2.com`) | Freeware, **redistribution restricted** (binaries not freely redistributable in modified/partial form; the full unmodified package can be redistributed, individual DLLs "more conveniently" per the author's own community statements, but it is not open source) | Wrong tool for this title even before the license question — it targets Glide/DirectX 1-9 **3D** wrappers (voodoo card emulation, D3D→modern backend); Black Crypt's primary surface is 2D palettized blitting, not 3D. Ruled out on fit, and the license would have needed a "download it yourself" writeup either way, same as the recommended pick |

**Recommendation: `cnc-ddraw`.** It is purpose-built for exactly this
class of game (contrast dgVoodoo2, which is for 3D-API titles), it is the
only one of the three whose own documentation names Wine as a supported
target with the exact override incantation, and its MIT license imposes no
redistribution complications for documenting "go get this file yourself."

**What was tested, in a scratch directory (never
`data/blackcrypt/dosvga/`):**

1. Downloaded `cnc-ddraw.zip` from the project's GitHub Releases (latest
   tag, `7.1`, MIT-licensed) and extracted `ddraw.dll` + `ddraw.ini`.
2. Built a scratch game directory under `/tmp` containing the real,
   unmodified `crypt.exe`, `clipper.clp`, `Config.dat`, `maindung.gam`,
   plus the wrapper's `ddraw.dll`/`ddraw.ini` — the same working-directory
   requirement documented in §1C/Phase 4. `data/blackcrypt/dosvga/` itself
   was never touched.
3. Edited `ddraw.ini`: `windowed=true` + `fullscreen=true` (cnc-ddraw's own
   documented combination for "windowed-fullscreen aka borderless mode" —
   stretches the game's native surface to fill the screen without an
   exclusive display-mode switch) + `maintas=true` (maintain aspect ratio,
   to avoid a stretched/distorted image while fixing the "tiny" problem).
   `renderer=gdi` was pinned explicitly after `renderer=auto` (the
   shipped default) produced a black window — this environment's OpenGL/
   EGL stack fails to create a context at all (`libEGL warning: egl:
   failed to create dri2 screen`, repeating), which is a property of this
   specific sandboxed test environment's GPU driver stack, not of
   cnc-ddraw or of Black Crypt; GDI is cnc-ddraw's documented software
   fallback and sidesteps the issue entirely. A real user's machine (or a
   less restricted Wine install) would likely work with the default
   `renderer=auto`.
4. Launched under Wine (`wine-11.14`) with
   `WINEDLLOVERRIDES="ddraw=n,b"` — cnc-ddraw's own documented override,
   forcing Wine to prefer the native (dropped-in) DLL over its built-in
   DirectDraw implementation.

**Confirmed, non-visually:**

- `WINEDEBUG=+loaddll` shows cnc-ddraw's `DDRAW.dll` loading as `native`
  from the scratch game directory (`... Loaded L"...\bc-scratch-ddraw
  \DDRAW.dll" at 7A470000: native`), immediately after `crypt.exe` itself
  — i.e. the drop-in override mechanism works exactly as documented, no
  patch to `crypt.exe` needed.
- The process stays alive with no `err:` lines indicating a crash or
  unhandled exception (only a benign, pre-existing
  `err:system:NtUserChangeDisplaySettings ... returned -2`, also present
  in Phase 4's un-wrapped baseline run) — same "launches, doesn't crash"
  result §1C and Phase 4 already established for the un-wrapped build.

**Not confirmed — visual verification blocked by environment tooling, not
by the wrapper:**

This session could not get a screenshot of the actual rendered window, for
two independent reasons, discovered in this order:

1. The X11-based capture tools already known to be missing/broken in this
   environment (Phase 4 noted `xdotool`/`ydotool` and a broken
   `import`/`magick import`) turn out to be broken for a specific,
   diagnosable reason, not just "not installed": this session (KDE Plasma
   on Wayland, with Xwayland running **rootless**) doesn't mirror the real
   composited screen into the X11 root window at all, so *any* XGetImage-
   based capture — `ImageMagick import`, `ffmpeg -f x11grab` — returns a
   plain black frame with only the (X11-rendered) mouse cursor, for the
   desktop in general, not just for the wine window. Confirmed by
   capturing the literal desktop root with no wine process running at
   all: still solid black. This is a Wayland/Xwayland-rootless property
   of the environment, unrelated to Black Crypt or cnc-ddraw.
2. The one capture method that *does* see the real compositor output —
   KDE's `spectacle` (a permission-listed trusted client of KWin's
   Wayland screenshot protocol) — only exposes whole-desktop or
   currently-focused/under-cursor capture from the command line; a
   same-rectangle-only capture exists at the protocol level
   (`org.kde.KWin.ScreenShot2.CaptureArea`, which crops **inside the
   compositor**, before any pixels reach the caller) but direct D-Bus
   calls to it from a non-allow-listed script are rejected
   (`NoAuthorized`), and there is no pointer/keyboard-injection tool
   available to focus or hover the target window for `spectacle
   -a`/`-u` either. **This session's desktop is shared with other
   concurrent, unrelated agent work** — a first, exploratory full-screen
   `spectacle` capture (before this constraint was understood)
   confirmed real compositor output works, but the frame it returned
   showed a live, unrelated session's terminal content. That file was
   deleted immediately and not otherwise used; no further full-screen
   capture was taken for the rest of this test, since the environment
   cannot restrict a full capture to only this project's window and
   using one anyway would mean writing another session's private screen
   content into a file on this machine. The visual check the task asked
   for — does the window now fill the screen instead of being tiny in a
   corner — was judged not obtainable safely in this session.

**Verdict:** cnc-ddraw is the right candidate on fit, license, and
documented Wine support, and the mechanically-verifiable half of the claim
— *"drop a renamed DLL next to `crypt.exe`, override it in Wine, get a
working DirectDraw replacement with no exe changes"* — is confirmed
end-to-end (native-DLL load trace, clean non-crashing run). The
*visually*-verifiable half — does this actually fix the tiny-viewport
presentation bug — is not confirmed in this session, for tooling/
environment reasons unrelated to cnc-ddraw itself. This is exactly the
kind of check the project owner already planned to do manually (per this
task's own framing); the scratch-dir recipe above, `ddraw.ini` settings,
and the `WINEDLLOVERRIDES="ddraw=n,b"` incantation are ready for that pass.

**How to use it (optional, not required for the core restoration):**

1. Download `cnc-ddraw.zip` from
   `https://github.com/FunkyFr3sh/cnc-ddraw/releases/latest` (MIT
   licensed; verify the release you download still shows that license in
   its repo before trusting it, since this project never vendors
   third-party binaries and can't pin a checksum here for you to diff
   against a copy in-repo).
2. Extract `ddraw.dll` and `ddraw.ini` into the **same directory as your
   own copy of `crypt.exe`** (a restored/completed install, not this
   repo's `data/blackcrypt/dosvga/`, which stays untouched either way).
3. Recommended `ddraw.ini` starting point for this title: `windowed=true`,
   `fullscreen=true` (together = borderless windowed-fullscreen, stretched
   to fill the screen), `maintas=true` (keep the 320×200-class aspect
   ratio while stretching). Leave `renderer=auto` on a normal machine; only
   fall back to `renderer=gdi` if you see a black window.
4. Running under Wine: either run `cnc-ddraw config.exe` once from that
   directory, or set the DLL override yourself —
   `WINEDLLOVERRIDES="ddraw=n,b" wine crypt.exe` (or the equivalent
   `winecfg` → Libraries tab → add `ddraw` → native, builtin).
5. This step is entirely optional — the demo (and, once Phase 3 lands, the
   restored full game) runs without it; cnc-ddraw only changes how the
   DirectDraw surface gets presented to the screen.

**Owners:** `game-re` agent for 1C (still open). **1A, 1B and 1D are
closed** — see their sections above (1A resolved by `re-codebreaker`,
2026-08-03; 1B resolved by `game-re` static analysis, 2026-08-04; 1D
resolved by `game-re` static analysis, 2026-08-04 — creature roster,
group ids 4-9, and tileset/ramp counts all closed).

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

> **DONE, 2026-08-04 — patcher written, both edits assembled and
> byte-exact verified against the real shipped `crypt.exe`; live Wine
> proof attempted but not completed (tooling gap, not a patch problem).**
>
> **The two edits, as actually applied (all `rasm2 -a x86 -b 32`,
> addresses re-derived by the tool from `-s <seek>`, never hand-computed):**
>
> 1. `jmp rel32` at file+`0x23b50` (vaddr `0x423b50`) → cave vaddr
>    `0x42deb3`: **`e9 5e a3 00 00`** (5 B). Pre-flight check confirmed the
>    16-byte stub window still reads
>    `68 c8 b6 43 00 e8 b6 8d fe ff 59 c3 90 90 90 90` in the real
>    `data/blackcrypt/dosvga/crypt.exe` (253,952 B) before patching — i.e.
>    this run's file is exactly the build every earlier trace was done
>    against.
> 2. Thunk at file+`0x2deb3` (vaddr `0x42deb3`), 22 B:
>    **`8b 44 24 04 0f b7 0d 1a 48 47 00 50 51 e8 bb 89 ff ff 83 c4 08 c3`**
>    — `mov eax,[esp+4]` / `movzx ecx,word[0x47481a]` / `push eax` /
>    `push ecx` / `call 0x426880` / `add esp,8` / `ret`. The cave region
>    was re-checked at run time (not just trusted from the doc): all 333
>    bytes `0x2deb3`-`0x2e000` are `0x00` in the real file, `.text` is
>    `-r-x` and `paddr`/`vaddr` for that section coincide 1:1 (`r2 iS`:
>    `.text` `paddr 0x1000 vaddr 0x401000 size 0x2d000` both raw and
>    virtual), so `file_offset = vaddr - 0x400000` holds exactly and the
>    thunk sits fully inside the raw PE image, not BSS.
>
> **Verification performed (all against the real, unmodified
> `data/blackcrypt/dosvga/crypt.exe`, patched into a scratch copy — the
> real file was never written to):**
>
> | Check | Result |
> |---|---|
> | Round-trip disassembly of both patched regions (`r2 pd`) | Stub: `jmp 0x42deb3` — the *entire* rest of the old 12-byte stub body (the `call`/`pop`/`ret` that used to print the TEST LEVEL message) is now unreached dead bytes, never executed. Cave: all 7 intended instructions decode back exactly as written, ending in `ret` at `0x42dec8`, confirmed by an independent disassembler pass, not just the patcher's own self-check |
> | `jmp` target resolves to cave start | `0x423b50 + 5 + (rel32) = 0x42deb3` exactly — checked both by the script's own assert and independently by `r2`'s disassembly printing `jmp 0x42deb3` |
> | `call` target resolves to `SwitchMap` | `0x42dec0 + 5 + (rel32) = 0x426880` exactly — same double-check |
> | Full-file byte diff, patched vs. original, outside the two intended windows | **0 differences.** 25 total changed bytes across the whole 253,952 B file; all 25 fall inside `[0x23b50,0x23b55)` (4 of the 5 jmp bytes — 1 byte coincidentally matched the original `0x00`) or `[0x2deb3,0x2dec9)` (21 of the 22 thunk bytes — 1 byte coincidentally matched the pre-existing zero cave). Computed independently in Python against both the patcher's output and a separate `r2`-inspected copy |
> | Pre-flight guards actually fire | Confirmed the patcher refuses in-place patching (`input == output`), refuses to overwrite an existing output without `--force`, and (by construction, not separately exercised) would refuse a `crypt.exe` whose stub bytes or cave bytes don't match the expected build |
>
> This meets the same bar as every other "confirmed" claim in this
> plan: a byte-exact structural check (the full-file diff), not a
> spot-check or a "looks right".
>
> **Live end-to-end proof: attempted, not achieved — tooling gap.** Built
> a scratch game directory (outside the repo, under `/tmp`) containing the
> patched `crypt.exe`, the real `clipper.clp`/`Config.dat`, and a full
> 13-map `maindung.gam` from `scripts/bclib/maindung.py` (so map 2's real
> data — not just map 1 — is present, per the sequencing note above).
> Launched it under `wine` (`wine-11.14`, confirmed present) from that
> directory; the process started and ran (X11/EGL driver warnings only in
> `WINEDEBUG` output, no crash dialog, no `wine: Unhandled exception`) but
> exited at the end of the timeout window having written no
> `TempDung.gam`/`orig%d.gam`/`char%d.dat` — i.e. it never got past the
> title/chargen screen in the window observed, consistent with §1C's
> already-documented "launches, but the DirectDraw presentation is broken
> (tiny letterboxed window)" finding. Getting further needs either (a)
> §1C's display-config fix so the window is legible, or (b) blind input
> automation to navigate title → chargen → dungeon → the map-1 staircase
> without seeing the screen. Neither tool was available in this
> environment: no `xdotool`/`ydotool`/`xte` for synthetic key/mouse
> events, and ImageMagick's `import`/`magick import -window root` failed
> with `missing an image filename` even for a bare relative path (an
> environment/IM7 CLI issue, not investigated further — out of scope for
> this task). Per the task's own scoping, this is a stretch goal and not
> worth burning more time on; static verification above is the complete,
> sufficient deliverable for Phase 4. A future session with §1C's display
> fix and/or key-automation tooling available could pick this up directly
> using the scratch-dir recipe above (`scripts/patch_crypt_exe.py` +
> `scripts/bclib/maindung.py` + the real `clipper.clp`/`Config.dat`) — no
> new investigation needed, only tooling.
>
> **Deliverable:** `scripts/patch_crypt_exe.py` — takes a user-supplied
> input `crypt.exe` path and a separate output path, refuses to modify the
> input in place, applies both edits, and re-reads its own written output
> to self-check both windows plus a full-file diff before reporting
> success. Never touches `data/blackcrypt/dosvga/crypt.exe`, and no
> patched binary is committed anywhere in this repo (verified: `git
> status` after this session shows only the new script as untracked).

---

## Phase 5 — a restoration-note page — **DONE**

Separate from the four phases above: the demo shows a short sequence of
history/lore text before the title screen, including a genuine developer's
note about the PC port. This phase traces exactly how that sequence works
and adds one more page to it, in the same spirit, about this repo's own
restoration work — without touching the game's own text or any `.rsrc`
resource.

### 5.1 The display mechanism

`main` (`0x4135d0`, called from `entry0` at `0x427ea1`) shows three
sequential **modal Win32 dialogs** before doing anything else, all built
from one reusable pattern: `DialogBoxParamA(hInstance, MAKEINTRESOURCE(id),
NULL, dlgProc, 0)`, where `dlgProc`'s `WM_INITDIALOG` (`msg == 0x110`)
handler calls `SetDlgItemTextA(hDlg, controlId, someString)` to fill a text
control, and its `WM_COMMAND` (`msg == 0x111`) handler calls
`EndDialog(hDlg, 1)` when the OK/Next button (control id 1) is clicked:

| # | `DialogBoxParamA` call site | Dialog template | `DlgProc` | Text control id | String |
|---|---|---|---|---|---|
| 1 | `0x4135e3`-`0x4135ed` | 101 (EULA) | `0x413450` | 1001 | `0x438850` |
| 2 | `0x413603`-`0x41360d` | **102** | `DlgProc_History`, `0x4134f0` | **1003** | `0x43a2bc` |
| 3 | `0x41360f`-`0x413619` | **102** (same template) | `DlgProc_DemoNote`, `0x413570` | **1003** (same control) | `0x43ab48` |

After call 1, `main` checks `dword [0x474af8]` (written by the EULA
`DlgProc`'s `WM_COMMAND` handler, `0`/`1` for Decline/Accept) and returns
immediately if declined — the game never starts. Calls 2 and 3 are
unconditional.

**The key finding: there is no page count and no pointer table.** "How
many pages" is simply "however many `DialogBoxParamA` calls appear in a
row in `.text`." Pages 2 and 3 are two independent modal dialogs built
from the **identical dialog template (102)**, with two near-identical
`DlgProc`s that each do nothing but plug a different string into the same
control (1003) and, on the button click, forward to `EndDialog` — compiler-
duplicated boilerplate, not a designed "paged text" subsystem.

Each of the three strings is genuinely its own null-terminated C string —
confirmed by a byte-exact null-byte scan of `0x38850`-`0x3ae18`: exactly
three `0x00` bytes in that whole range, immediately before `0x38850`
(none, it's the start), and at `0x3a2bb`, `0x3ab47`, `0x3ae17` (one right
before each of strings 2 and 3, and one terminating string 3). **The
user-supplied lead's "three strings at `0x3a2bc`-`0x3acc0`" framing was
half right**: `0x3a2bc` and `0x3ab48` are real string starts (the history
note and the demo note, strings 2 and 3 above); `0x3acc0` (mid-string) is
not a boundary at all — it's a `\r\r\n` paragraph break inside string 3
that a plain `strings -n 15` scan reports as a new "string" only because
CR (`0x0d`) isn't in its default printable set, not because there's a
`0x00` there. Verified directly: `data[0x3acc0-1] == 0x0a`, not `0x00`.
So the real page count is **2** (history + demo note) after the EULA, not
3, and the mechanism is "N `DialogBoxParamA` calls in a row," not
"N strings in a table."

### 5.2 Feasibility — real slack space exists, confirmed two ways

Following the same standard this project holds Phase 4's cave candidate
to (`file+0x2DEB3`, "confirmed all-zero... `-r-x`... inside the raw
image"): searched the whole file for zero-byte runs ≥ 20 B in every
section, then required each candidate to have **zero** dwords anywhere in
the file decoding as a pointer into it (a file-wide scan, not just eyeballing
the surrounding bytes).

- **Code** (needs to be executable): the **same `.text` cave Phase 4
  uses**, `0x42DEB3`-`0x42E000` (333 B), has **311 B free** after Phase 4's
  own 22-byte thunk (`0x42DEB3`-`0x42DEC9`) — confirmed all-zero in the
  shipped file before any patching. This is enough for a new `DlgProc`
  (52 B) plus a small thunk that makes the fourth `DialogBoxParamA` call
  (22 B).
- **String data** (only needs to be readable): `.rdata`'s own unused tail,
  `0x42F2D9`-`0x430000` (**3,367 B**) — the zero padding after the PE
  import name table (`"SetEnvironmentVariableA\0"` is the last real
  content, ending at `0x2F2D9`; the section's raw size just rounds up to
  the next file-alignment boundary). A candidate rejected for comparison:
  the 3,069-byte zero run at `0x3C403`-`0x3D000` in `.data` overlaps
  `0x43C7A0`, the documented start of the runtime-built 2000×68-byte
  clipper directory table (§0.4/§1D) — real, live memory the game
  overwrites at startup, not truly free, so it was **not used**.
  `.rdata`'s tail was checked against every existing known structure the
  same way and is genuinely inert: a file-wide dword scan for pointers
  into `[0x42F2D9, 0x430000)` found exactly 2 hits, both proven
  coincidental (an unrelated `0xFFFFFFFF` rect-list terminator immediately
  followed by an unrelated `0x0042`-prefixed coordinate word in a UI
  rect table at `0x32896`/`0x32926`, not real pointers — `data[0x32898:
  0x3289a] == 0xffff` and `data[0x3289c:0x328a0]` is the *next* rect's
  first word, not related to this string region at all).

**No `.rsrc` edit needed at all** — the new page reuses dialog template
102 verbatim (same text control id 1003, same OK-button id 1 already
wired to `EndDialog`), the same way pages 2 and 3 already share it.

### 5.3 The patch

`scripts/patch_crypt_exe_add_restoration_note.py`, mirroring
`patch_crypt_exe.py`'s exact shape (module-level byte constants with
`assert` cross-checks on every `push`/`jmp`/`je`/`call` operand, a
`patch()` function, a `_self_check()` re-read-from-disk verifier, refuses
in-place patching, refuses to overwrite `--output` without `--force`).
Three edits, all bytes assembled with `rasm2 -a x86 -b32 -s <addr>
'<insn>'` and round-trip-verified with an independent `r2 pd`
disassembly pass (not just the patcher's own self-check):

1. **New `DlgProc`** at cave vaddr `0x42DEC9` (52 B): on `WM_INITDIALOG`,
   `SetDlgItemTextA(hDlg, 1003, 0x42F2D9)`; on `WM_COMMAND`, **`jmp`s into
   the existing, generic tail of `DlgProc_DemoNote` at `0x413583`**
   (which only reads its args off the stack frame and forwards to the
   shared `EndDialog`-on-OK helper at `0x413550`) instead of duplicating
   that ~40-byte block — confirmed safe because a `jmp` (not `call`)
   preserves the exact stack frame Windows set up for our own `DlgProc`
   invocation, and `EndDialog` uses the `hDlg` argument from *that* frame,
   not a hardcoded handle.
2. **New thunk** at cave vaddr `0x42DEFD` (22 B): re-executes the exact
   instruction it displaces (see next item) — `mov eax, dword [0x476a5c]`
   — then makes the fourth `DialogBoxParamA(hInstance=ebx,
   MAKEINTRESOURCE(102), hWndParent=0/ebp, DlgProc=0x42DEC9, 0)` call
   (`ebx`/`ebp`/`esi` — hInstance, the 0 constant, and the
   `DialogBoxParamA` pointer — are all still live and unmodified at this
   point in `main`, confirmed by tracing every instruction from the first
   `DialogBoxParamA` call through the hook site), then `jmp`s back to
   `0x413620` (`mov esi, 1`, the original next instruction).
3. **Hook**: overwrites the single 5-byte instruction at file+`0x1361b`
   (vaddr `0x41361b`, the first instruction after page 3's call returns)
   — `mov eax, dword [0x476a5c]` — with a 5-byte `jmp rel32` to the new
   thunk.

**Verification performed** (against the real, unmodified
`data/blackcrypt/dosvga/crypt.exe`, patched only into scratch copies —
the real file was never written to):

| Check | Result |
|---|---|
| Round-trip `r2 pd` disassembly of all three windows | Hook: `jmp 0x42defd`. `DlgProc`: `je 0x42dee0` (init) and `je 0x413583` (shared command tail) both resolve exactly; the `push 0x42f2d9` operand round-trips to the new string, printed in full by `r2`'s own string-preview. Thunk: `push 0x42dec9` (the new `DlgProc`), `call esi`, `jmp 0x413620` all resolve exactly |
| Full-file byte diff, patched vs. original, outside the three intended windows | **0 differences.** This script alone changes exactly **759** bytes (5 hook + 74 cave + a subset of the 695 string bytes that differ from the pre-existing zero — some string bytes coincidentally are `0x00`, matching the untouched padding); composed with `patch_crypt_exe.py`'s own 25, the combined file has exactly **784** changed bytes (759 + 25, confirmed additive — the two patches' windows are fully disjoint) |
| Pre-flight guards actually fire | Confirmed the patcher refuses in-place patching, refuses to overwrite an existing output without `--force`, and refuses a `crypt.exe` whose hook/cave/string-region bytes don't match the expected stock shape |
| Composability with `patch_crypt_exe.py` | Works in **one order only**: `patch_crypt_exe.py` must run first. `patch_crypt_exe.py`'s own pre-flight check treats its *entire* declared 333-byte cave (`0x2DEB3`-`0x2E000`) as "must be zero," stricter than the 22 bytes it actually writes — so it correctly (if conservatively) refuses a `crypt.exe` this script has already written cave bytes into. This script itself has no such restriction and accepts either a stock or an already-Phase-4-patched input. Confirmed by running both orders: Phase4→note succeeds and produces a byte-identical result to applying the two patches' declared windows independently; note→Phase4 fails cleanly with the expected error message, not a silent corruption |

### 5.4 The drafted text

Written in a separate, later voice — explicitly **not** signed as Rick
Johnson and **not** attributed to Raven Software or Activision, per the
task's own constraint against implying official/endorsed status:

> A fan reverse-engineering project later found that the map-switching
> code mentioned above was never really removed -- just one small routine
> disconnected from an otherwise complete, working system for loading,
> saving, and switching between dungeon maps, the same system already
> used every time you load a save.
>
> Using the original Amiga game's own data, that project reconstructed
> the remaining twelve dungeon maps and reconnected the routine.  If you
> find yourself somewhere beyond the first map, that is why.
>
> This is an unofficial, non-commercial fan preservation effort, not a
> release by Raven Software or Activision.  More information, for anyone
> curious, is at crawl.shaid.net.

`crawl.shaid.net` is this project's own real, already-deployed docs site
(`www/astro.config.mjs`'s `site:` value, built by `.github/workflows/
deploy.yml`) — not an invented URL.

### 5.5 What's not done

Same as Phase 4: **static verification only**, per this task's own scope
(no Wine/live-execution requirement). The dialog box will only visually
confirm itself the same way Phase 4's would — under a working Wine
session past §1C's still-open DirectDraw presentation issue, or on real
Windows. Not attempted this session (out of scope; §1C's blocker is
unrelated to this phase and not re-investigated here).

**Deliverable:** `scripts/patch_crypt_exe_add_restoration_note.py`. Never
touches `data/blackcrypt/dosvga/crypt.exe`, and no patched binary is
committed (verified: `git status` after this session shows only the new
script as untracked, `data/` unmodified — `md5sum` of the real file
unchanged across every run above).

---

## Phase 3a — art-conversion proof of concept (in-place swap) — **DONE**

Before attempting the full Phase 3 (23 new creature clusters + 2 new
tilesets, all requiring the expensive insert-and-recompute-offsets
container rewrite described in § "3.1"), this phase proves the Amiga→DOS
art-conversion pipeline works end to end using only entries the demo
*already ships*, via a much cheaper **in-place pixel-data swap**: map 1's
tileset is replaced with the late-game `bcdfz` tileset, and Rock Eye is
replaced with Green Guy. No new directory entries, no offset
recomputation, no file-size change.

### 3a.1 Container mechanics for in-place replacement — cheap, confirmed against the real file

Re-derived directly from `scripts/extract_clipper.py` and the real shipped
`data/blackcrypt/dosvga/clipper.clp` (not just read from the source):
`uint16 count` (816) + `count × 56 B` directory (name[40], type, size,
data_offset, width, height) + a data blob. Parsing the real file confirms
what § "3.1" states in prose with exact numbers: the 782 non-marker
(type ≠ 1) entries' data is laid out in **exact directory order with zero
gaps** — `data_offset[i] + size[i] == data_offset[i+1]` holds for all 781
consecutive pairs, the first data-bearing entry (`Palette`) starts
immediately at byte 45,698 (`2 + 816×56`, the header+directory size
exactly), and the last entry (`Two Head A 0`) ends at exactly 1,151,267 =
EOF.

This makes two distinct cases, only the first of which this phase needed:

- **Same byte size (this phase's case).** If the replacement art's raw
  pixel byte count (`width × height`, DOS images are uncompressed 8bpp) is
  identical to the entry's existing `size`, the swap is a pure data
  overwrite: write the new bytes at the entry's already-recorded
  `data_offset`, touch **zero** directory bytes (name/type/size/offset/
  width/height all stay exactly as shipped), and the file's length and
  every other entry's position are unaffected. No offset math at all.
- **Different byte size (Phase 3 proper's case, not needed here, but worked
  out for the record).** If size changes, only entries whose `data_offset`
  is *after* the resized one need their `data_offset` field patched (a
  fixed 4-byte write per following entry, cheap — not a directory
  *insert*, which is what makes Phase 3's real injection expensive), and
  only the data blob from the resized entry's old start through EOF needs
  rewriting — not the whole 1.15 MB file. This is materially cheaper than
  Phase 3's insertion case (§ "3.1"), which additionally grows the
  directory itself and therefore must recompute every single one of the
  (up to) ~1,480 populated entries' offsets. Whether a given Phase 3
  cluster lands on the cheap "shift a small tail" case or needs the full
  insertion path just depends on where in the file it's added — creature
  clusters appended at `End Monsters` (current EOF, § "3.1") never need
  *any* offset patch to earlier entries at all, only to entries added
  after them in the same session.

This phase's two swaps were deliberately engineered to land on the first,
cheapest case (see 3a.2/3a.3), so `scripts/build_proof_of_concept_art_swap.py`
only implements same-size overwrite and explicitly refuses (raises
`ValueError`) if a converted image's dimensions don't match its target
entry — the general shifting rule above is documented, not implemented,
since nothing in this phase's scope needs it.

### 3a.2 The tileset swap — map 1 (`bcdfx`-equivalent) → `bcdfz`, 68/70 entries

**Which `clipper.clp` entries back map 1's tileset.** Parsing the real
directory finds a contiguous, unbracketed run of 70 named entries at
indices **7–76** (`Alcove A` … `Secret Button 1 In`), sitting between the
7 palette entries (0–6) and the empty `Start/End Level Specifics` bracket
(77/78, already identified in § "1D" as a packaging artifact). This is the
full set of wall/floor/door/pillar/stairs/pit/button art — every dungeon
tileset asset the demo ships — confirmed against `bclib.bcdfxyz.SUB_IMAGES`
(the already-solved Amiga sub-image table, `docs/blackcrypt/amiga/
data-structure.md` § "Sub-image layout") name-for-name and
dimension-for-dimension (e.g. `Alcove A` 112×77 on both sides, `Pillar A`
80×116 on both sides, `Stairs Down/Up 1/2/3` matching Amiga's two stairs
flights at all 3 depths). No code trace was needed to find this range —
it falls out of parsing the shipped file directly, the same way the
`Start X`/`End X` brackets do.

**Why `bcdfz` needs no resizing at all.** `bcdfx` and `bcdfz` share "the
same 12-chunk structure" (`docs/blackcrypt/amiga/data-structure.md` § "bcdfx
/ bcdfy / bcdfz"): both decode via the identical `SLOT_SIZES`/`SUB_IMAGES`
tables, so every one of `bcdfz`'s 84 sub-images has **exactly the same
(width, height)** as `bcdfx`'s sub-image at the same slot/offset — the two
tilesets are pixel-for-pixel the same layout, just different colours. That
means every DOS tileset entry that maps 1:1 to a single Amiga sub-image
converts to **exactly** the existing entry's byte size, with zero
resizing — the cheap same-size overwrite case from § "3a.1" applies to the
whole tileset swap, not just by luck but because the container format was
built that way (one shared descriptor-driven layout, three different
pixel payloads).

**The mapping (68 of 70 entries).**

| Recipe | Count | Example |
|---|---|---|
| Direct (1 Amiga sub-image, same w×h) | 58 | `Alcove A` ← `alcove-a` |
| `hflip` (Amiga `floor`, mirrored) | 1 | `Floor 2` ← `hflip(floor)` |
| `hconcat` (left-return + face + right-return, same height, widths sum to 208 — already documented in `data-structure.md` § "Slot 176") | 3×3=9 sub-images → 3 entries | `Wall 0/1/2` |
| **Total converted** | **68** | |
| Not converted (left as original `bcdfx` pixels) | 2 | `Wall Left`/`Wall Right` — Amiga's own art for these is a 4-depth perspective composite (4 overlapping pieces at different (x,y) offsets, § "Slot `$08`" in the Amiga doc) with no documented flat-raster stacking recipe; out of scope for a proof of concept |

The `hconcat` case needed no new hypothesis: `docs/blackcrypt/amiga/
data-structure.md` § "Slot 176" already states the three per-depth pieces'
widths sum to exactly 208 at all three depths and share each depth's
height (`16+176+16 = 48+112+48 = 64+80+64 = 208`), which is precisely
DOS's own `Wall 0/1/2` width — a plain `numpy.hstack` of the three
already-decoded, already-palette-mapped pieces reproduces the target
dimensions exactly, and the self-check (below) confirms no seam artifact
in the written bytes' size accounting (visual check also confirms no
seam in the rendered brick texture — see 3a.4).

**Palette.** `bcdfz` is used exclusively under accent ramp 2 ("bone/warm
cream", `docs/blackcrypt/amiga/data-structure.md` § "Dungeon tileset
selection") — this swap keeps that native colouring rather than forcing
ramp 0, since the point is to show real, correctly-converted late-game art
on map 1, not to disguise it as tan sandstone. The conversion palette is
built the same way `scripts/export_dungeon_tileset_indexed.py` already
builds one for its own indexed-PNG export (`bclib.read_palette_words` +
`bclib.read_accent_ramp(s1, 2)` + `bclib.ehb_palette`), then each of the
64 Amiga EHB colours is mapped to its nearest-RGB DOS palette entry
(Euclidean distance in raw RGB, DOS's own shipped `Palette` entry as the
candidate pool) — indices 32/33 (DOS's cyan/brown transparency keys) are
excluded from the candidate pool so no real opaque pixel can accidentally
land on a colour DOS's own renderer treats as "background".

### 3a.3 The Rock Eye swap — Green Guy, 7/7 entries, no exact frame-count match exists

**No other 7-frame creature exists.** § "1D"'s RESOLVED creature table
gives every creature's real DOS frame count: Two Head and Rock Eye are
both 7; every other creature is 2, 3, 4, 10, or 11. Two Head is excluded
(already shipped, and swapping one already-present creature for another
proves nothing new). So **no candidate has an exact frame-count match** —
the task's own fallback applies: pick the closest real option and justify
it, rather than block on a non-existent exact match.

**Candidate chosen: Green Guy (Amiga gfx `0xb0`, `bcdfc`/map 2, DOS name
confirmed in § "1D"'s table).** Reasoning:

- It is a genuinely separate, real, already-identified creature (not a
  placeholder "Map N Creature" label) with a small, clean frame set — 4
  real Amiga frames, the smallest of any creature above Lich
  Dragon/Cloaker/Statue (which are 2-3 frames and would need even more
  reuse to fill 7 slots).
- Rock Eye's own 7 DOS entries are not a generic "3-tier × 4-facing" set —
  parsing the real directory shows 5 *distinct* sizes (`96×83`, `64×71`,
  `64×55`×3, `32×32`, `16×17`), a near/far depth ladder with three
  same-size "near" facings, not four genuinely different facings. That
  shape tolerates reusing one source frame across the three same-size
  slots far more naturally than it would tolerate stretching one image
  across genuinely different facing poses.
- This project's own container already has precedent for exactly this
  "one converted image, multiple directory records" pattern — § "1D"'s
  RESOLVED block documents 11 of Phase 3's own future creature entries as
  needing "no new pixel conversion, just an extra directory record
  pointing at an already-converted sprite" (directory-entry aliasing).
  This swap uses the same idea, just realised as three identical resized
  copies rather than three records sharing one offset, because DOS's
  format (unlike Amiga's) has no shared-pointer convention — every
  `clipper.clp` image entry owns its own pixel bytes.

**The mapping** (`scripts/build_proof_of_concept_art_swap.py`'s
`ROCK_EYE_MAP`), each source frame nearest-neighbour-resized to its
target's *existing* directory (width, height) — never touching the
directory, per § "3a.1":

| DOS entry | Target size | Green Guy source frame | Source size |
|---|---|---|---|
| `Rock Eye A 1` | 96×83 | frame 0 (biggest) | 96×75 |
| `Rock Eye A 0` | 64×71 | frame 1 | 80×46 |
| `Rock Eye 1 N` | 64×55 | frame 1 (reused) | 80×46 |
| `Rock Eye 1 E` | 64×55 | frame 1 (reused) | 80×46 |
| `Rock Eye 1 S` | 64×55 | frame 1 (reused) | 80×46 |
| `Rock Eye 2 S` | 32×32 | frame 2 | 48×23 |
| `Rock Eye 3 S` | 16×17 | frame 3 (smallest) | 32×14 |

Nearest-neighbour resize was used deliberately (not any smoothing filter)
because the source is a palette-index image — blending index values
produces meaningless intermediate palette entries, not intermediate
colours.

**Palette and transparency.** Green Guy's Amiga art uses the general
monster/"game" palette (`scripts/palette_final.json`, the same one
`scripts/extract_monsters.py` already uses for every other creature
render in this repo), not a dungeon accent ramp — built into the same
nearest-RGB-match DOS lookup as the tileset, independently, since
creatures and dungeon tiles are authored against different Amiga
palettes. Amiga mask-plane transparency (7-plane sprites: 1 mask + 6
colour) is written as DOS's own monster/item background key, index 33
(`(95, 67, 51)`, confirmed against `scripts/extract_clipper.py`'s
`KNOWN_BG` — the same convention the demo's own shipped Rock Eye/Two Head
art already uses).

### 3a.4 Verification performed

`scripts/build_proof_of_concept_art_swap.py`, run against the real
`data/blackcrypt/dosvga/clipper.clp` into a scratch copy (the real file is
never written to):

| Check | Result |
|---|---|
| Pre-flight shape check | Refuses to run unless entry count is exactly 816 and 12 known (index, name) pairs match (palette, tileset start, Rock Eye's 7 names, `Start`/`End Monsters`) — guards against silently "succeeding" on a different `clipper.clp` build |
| Output file length | **1,151,267 B in, 1,151,267 B out — unchanged**, confirming the same-size-overwrite path was actually taken, not silently falling back to something else |
| Header + full 816-entry directory (first 45,698 B) | **Byte-identical**, input vs. output — zero directory edits, confirming this swap is pure pixel-data replacement |
| Bytes changed outside the declared touched windows | **0** — every changed byte falls inside one of the 75 entries' own `[data_offset, data_offset+size)` window (68 tileset + 7 Rock Eye), computed independently of the patcher's own bookkeeping by re-reading the written file from disk |
| Entries actually swapped | **68/68** mapped tileset entries (of 70; 2 documented residuals) + **7/7** Rock Eye entries — printed counts match the static mapping tables exactly |
| Visual spot-check (rendered from the *patched output file*, not the pre-write in-memory array) | `Wall 0/1/2` render as a coherent bone/cream brick wall with **no seam** at the two `hconcat` joins; `Floor 1`/`Floor 2` render as mirror images of each other, as intended; `Alcove A` renders a recognisable tombstone/alcove; `Rock Eye A 1`/`1 S`/`3 S` all render a recognisable green spider-like creature (Green Guy) at their respective target sizes, correctly scaled, not noise |

This meets the project's standard verification bar for a container-format
edit: a byte-exact structural check (directory untouched, file length
unchanged, no stray writes) plus a visual confirmation that the converted
pixels are real art, not garbage that merely satisfies the byte-count
check. It does **not** meet the bar of a live in-game screenshot (blocked
on the same Wine/DirectDraw presentation issue as Phase 4/5, § "1C") —
that remains open, same as Phase 4's live proof.

### 3a.5 What this does and doesn't prove

**Proves:** the full Amiga→DOS art-conversion pipeline — deplane (6-plane
opaque / 7-plane mask-first) → nearest-RGB palette remap against a real
DOS palette → mask-to-background-key transparency → same-size in-place
container write → self-verify — works end to end on real game data, for
both an opaque tileset asset and a masked creature sprite, with zero
directory corruption. This directly de-risks Phase 3's art-conversion step
(§ "3.2"), which is the same pipeline at larger scale.

**Doesn't prove:** anything about Phase 3's *insertion* mechanics (new
directory entries, offset shifting for a growing file) — this phase
deliberately avoided that case (§ "3a.1"). It also doesn't prove the swap
looks acceptable **in-game** (no live capture, § "1C" still open) or that
`Wall Left`/`Wall Right`'s perspective composite is solved (still
original `bcdfx` pixels, undocumented recipe).

**Deliverable:** `scripts/build_proof_of_concept_art_swap.py`. Never
touches `data/blackcrypt/dosvga/clipper.clp`, and no patched/converted
container or art is committed (verified: `git status` after this session
shows only the new script as untracked, `data/` and `public/assets/`
unmodified).

### 3a.6 — live in-game finding: door transparency — **real bug, found and fixed**

**Symptom.** The project owner ran the patched `crypt.exe` (§ "Phase 4")
against a scratch copy of the swapped `clipper.clp` (§ "3a.2"–"3a.3") live
under Wine and reported a door in the dungeon view rendering as a solid,
opaque black-ish box instead of showing any see-through masking
(`data/blackcrypt/wine-test/Screenshot_20260804_225516.png`).

**Question 1 — does `crypt.exe` respect masking for door art at draw time,
or is it always an opaque rectangle blit?** Traced past the already-known
resolver (`fcn.00406d50`, § "1B") into its blit callee, `fcn.0040d550`
(`crypt.exe`, x86, radare2). Every call site inside `fcn.00406d50` pushes
the literal constant `2` as the last (flags) argument — confirmed for all 7
branches (frame at 3 depths, leaf at 2 door types × 3 depths, and the
fallback). Inside `fcn.0040d550`, that flags byte's bit 0 being clear
routes execution to `0x40d6c1`→`0x40d70f`, which calls
**`IDirectDrawSurface::BltFast`** (COM vtable offset `+0x1c`) with
`dwFlags = ((flags & 2) | 0x20) >> 1`. For `flags == 2` this evaluates to
**`0x11` = `DDBLTFAST_WAIT (0x10) | DDBLTFAST_SRCCOLORKEY (0x01)`** —
i.e. every door/structure draw goes through DirectDraw's own hardware
source-colour-key masking, not a flat copy. **Verdict: DOS *does* respect
per-pixel masking for doors, mirroring the Amiga side's mask-blit
convention (§ "Kind 11", `+0x24C6E`/`+0x24C76`) — this rules out "DOS
renderer ignores masking" as the explanation.**

**Question 2 — is the swap script's transparency-key assumption wrong?**
Traced where the per-image `IDirectDrawSurface::SetColorKey` value actually
comes from. `fcn.00402350` (the clip-surface loader, called from
`fcn.0040b7a0`/`fcn.0040b820` — resource-group load) reads a **word at
directory-record offset `+0xC`** and passes it (`fcn.0040eca0` @
`0x4023e1`, forwarded to `SetColorKey` flags `DDCKEY_SRCBLT` at
`fcn.0040eca0+0x91` / vtable `+0x74`) as that surface's colour key — unless
it's the sentinel `0xFFFF`, which skips `SetColorKey` entirely (fully
opaque surface, no masking at all). Tracing that word back through the
runtime record's on-disk source (`fcn.004022d0`, the per-entry directory
parser: 8 sequential `fread`s) pins it to **on-disk directory offset
`+50`, a `uint16 LE` field between `data_offset` (`+46`, 4 B) and `width`
(`+52`, 2 B)** — a real, per-entry field that neither `extract_clipper.py`
nor `build_proof_of_concept_art_swap.py` had ever parsed before this pass.

Parsing it out of the real, unmodified `data/blackcrypt/dosvga/clipper.clp`
for every one of the 70 map-1 tileset entries (indices 7–76) gives **three**
distinct real values, not one:

| Real per-entry colour key | Count | Entries |
|---|---|---|
| **32** (`0x20`, DOS palette RGB `(0,255,255)` cyan) | 32 | Every Door Way / Door Type (13), Pillar (3), Pull Chain (4), Wall Left/Right (2, not converted), plus Alcove/Plaque (10, never hit the masked-write path at all — see below) |
| **33** (`0x21`, DOS palette RGB `(95,67,51)` brown) | 24 | Floor Pit (4), Ceiling Pit (2), every Button (18) |
| `0xFFFF` (sentinel — no `SetColorKey` call, fully opaque) | 14 | Wall 0/1/2, Floor 1/2, Stairs ×6, Ceiling, Door Slot, Panel Top — all confirmed 6-plane (no Amiga mask) sub-images, zero exceptions |

**The bug: `build_proof_of_concept_art_swap.py`'s old `DOS_TRANSPARENT_INDEX
= 33` module constant was a single, hardcoded value used for *every*
masked tileset write, but every door entry's real, on-disk colour key is
**32**, not 33.** The swap wrote background pixels as palette index 33
(a real, opaque brown) into `Door Type 1 - 1`; at runtime, DirectDraw keys
out index **32** for that surface (the real, untouched directory field —
the swap never edits directory bytes at all, § "3a.1"), so those
brown-33 pixels are *not* transparent in-game — they render as solid
opaque brown, i.e. the "black box" the screenshot shows. This is a real
bug in the conversion script, not an engine limitation (Question 1) and
not an inherent property of the stock art (the stock, unswapped
`Door Type 1 - 1` genuinely has 0 real-transparent pixels at its own
correct key too — confirmed below — so the *stock* door being solid was
never in question; only the *swapped* door's wrong key was).

Confirms the task brief's own hint almost exactly: tileset/structure art
does **not** use the same colour-key convention as item/creature art.
`extract_clipper.py`'s `KNOWN_BG = ((95,67,51), (0,255,255))` render-side
heuristic (which flags a pixel transparent if its RGB matches *either*
tuple, for visual inspection) had been masking this the whole time — both
32 and 33 map to a `KNOWN_BG` colour, so a render always "looked"
plausible regardless of which index the pixel actually held, even though
the *real, single-key* runtime only ever keys out one of the two for any
given entry.

**The fix** (`scripts/build_proof_of_concept_art_swap.py`): `parse_directory`
now reads each entry's real `colorkey` field (offset `+50`); every masked
write (`decode_tileset_label`, and the Rock Eye/Green Guy conversion) fills
background pixels with the **target entry's own** real colour key, not a
module-wide constant. `DOS_RESERVED_INDICES = (32, 33)` (used only to keep
the nearest-RGB palette-mapping LUT from ever assigning a real opaque
pixel to either reserved index) is unchanged — both real per-entry values
this script's touched entries use are still excluded from the candidate
pool.

**Re-verification, same bar as § "3a.4":**

| Check | Result |
|---|---|
| Self-check (file length, directory bytes, touched-window containment) | Unchanged from § "3a.4" — **1,151,267 B in/out, header+directory byte-identical, 247,183 pixel bytes changed across 75 entries, 0 differences anywhere else** |
| `Door Type 1 - 1` pixels equal to its **real** colour key (32), stock | **0 / 7,360** — confirms the stock demo's own door leaf is genuinely fully opaque at its real key (not a rendering artifact of the diagnosis) |
| `Door Type 1 - 1` pixels equal to its real colour key (32), swapped (pre-fix, written as index 33) | **0 / 7,360** at the real key — the old output had 0 pixels a real DirectDraw `SetColorKey(32)` would ever treat as transparent, exactly reproducing the reported bug |
| `Door Type 1 - 1` pixels equal to its real colour key (32), swapped (post-fix) | **1,953 / 7,360** — real, non-zero transparency at the index the game actually keys out |
| Visual re-render (patched output, correct single-key alpha, composited over a checkerboard to show real transparency) | `Door Type 1 - 1` renders as a coherent portcullis/grate — solid green-eyed centre bars with genuine checkerboard-visible gaps between them, not noise; `Rock Eye A 1` (Green Guy, key 33 — unaffected by this fix since 33 was already its correct real value) re-rendered identically to § "3a.4", confirming no regression |

**Verdict: real bug, found via disassembly (not guessed), fixed, and
re-verified to the project's existing bar.** DOS's structure renderer does
respect per-pixel masking (Question 1, closed — no engine limitation);
`clipper.clp` carries a genuine per-entry transparency-key field the
conversion pipeline must read rather than assume (Question 2, closed —
fixed in the script). This also generalises past doors: the same
per-entry-field read now applies to every masked write this script
performs, so Floor Pit/Ceiling Pit/Button entries (already correct by
coincidence, since their real key already was 33) keep working, and Phase
3's future full injection (§ "3.2") inherits the same fix by construction.
Live-in-Wine re-confirmation of the *rendered* fix (as opposed to this
byte/pixel-level re-verification) is not done this pass — same "no
input-automation tooling in this environment" constraint as Phase 4's live
proof (§ "1C") — but the failure mode is now understood precisely enough
that the byte-level re-verification stands on its own, the same way § "3a.4"
did before any live test existed at all.

---

## Verification — what "it worked" looks like

| Phase | Concrete success criterion |
|---|---|
| 1 | ✅ 1A: named parser (`fcn.00425350`), named driver (`fcn.00426880`), verdict *parameterized*, verified at 1,530/1,530 squares + 45/45 actions + zero-deviation padding invariant. ✅ 1B: gfxNumber→bracket resolver found (`fcn.00403550`/`fcn.004033d0` + table `0x431b16`), all 166 item gfxNumbers accounted for — 139/139 match the independent Amiga LUT, 27/27 keys covered by the confirmed `gfxNumber−200` rule, 0 misses |
| 2 | ✅ **Done.** Converter reproduces the shipped `maindung.gam` byte-for-byte, 15,099/15,099, from `bcdfs` map 1 alone; full 13-map output is exactly 171,005 B. `scripts/bclib/maindung.py` + `scripts/verify_maindung.py` |
| 3 | Rebuilt `clipper.clp` still boots the demo unchanged (all 816 original entries resolve identically); a deliberately-injected sprite (e.g. a Ram Demon placed into map 1) renders correctly |
| 3 (instrumented, if 1C succeeds) | Under Wine, the `0x4699ac` message log shows zero `** Could not find Clip '%s' **` lines while walking a converted map |
| 4 | ✅ **Statically done.** Take map 1's staircase at (col 49, row 23) — its destination-map byte is already `2` — and arrive in map 2 at (27, 20) without the "TEST LEVEL" message, then walk back up. Code patch is byte-exact verified (round-trip disasm + zero-diff-outside-window check); the *live* walk-and-observe proof is still open, blocked on §1C's Wine presentation issue plus missing input-automation tooling in this environment, not on the patch itself |
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
| ~~1B gfxNumber resolver~~ | **Done** (one session) | **Resolved — no new item art needed** | `game-re`, radare2 |
| 1C Wine viability | Hours | Partially answered (launches, presentation broken) | `wine`, `winedbg`, scratch copy of game dir |
| ~~1D art scoping~~ | **Done** (one session) | **Resolved — exact payload manifest: 23 creature clusters (198 entries, 187 new sprites), 131 tileset sub-images, 3 ramps** | `game-re`, radare2, existing Amiga corpus |
| ~~2 converter~~ | **Done** (one session) | **Verified — zero deviation, 15,099/15,099 B** | Python, `bclib`, `game-re`, radare2 |
| 3 resource injection | Days–weeks (19 clusters + 2 tilesets) | Medium-high | Python, existing extraction pipeline |
| ~~4 code patch~~ | **Done** (one session) | **Resolved — byte-exact verified; live proof blocked on §1C + tooling, not the patch** | `rasm2`, radare2, Python patcher (`scripts/patch_crypt_exe.py`) |

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

---

## Phase 6 — save-file format: is a real Amiga save portable to DOS?

**New scope, not part of Phases 1–5.** The project owner played the real DOS
demo far enough to produce a genuine save, `data/blackcrypt/dosvga/char1.dat`
(1,396 B, 4-character party). The question: does the Amiga original's own
save file (never reverse-engineered in this project before) share a
byte-comparable layout, such that a real Amiga mid-game save could be
converted into a working DOS save (or vice versa) — the save-data analogue
of Phase 2's `bcdfs`↔`maindung.gam` converter?

> **Correction — a real Amiga save corpus was obtained after all, later in
> the same session, without ever needing Amiberry.** The Amiberry blocker
> below is accurate as far as it goes (no emulator tool was ever called),
> but it turned out to be moot: the project owner supplied a real archive
> of **80 genuine `CHARACTERSA`/`B`/`C`/`D`/`E` save files** from an actual
> playthrough (`data/blackcrypt/saves.7z`, gitignored, never committed —
> see "Update — real Amiga save corpus obtained" at the end of this phase
> for the full analysis). That section **supersedes essentially every
> "unverified"/"hypothesis" qualifier below** with byte-exact, multi-file
> cross-validated confirmation — read this section for the original
> disassembly-only pass (still accurate as far as it went, and still the
> right account of *how* the structure was first derived), then read the
> update for what real data confirmed, corrected, and left open.

### Blocker — no live Amiga save was obtained this session

Getting a *real* Amiga save required booting the game in Amiberry (the 3
ADFs at `data/blackcrypt/amiga/adf/`), reaching the in-game LOAD/SAVE menu,
saving, and recovering the file from wherever `GAMESAVE:` resolves on the
host. This agent's operating instructions place a hard gate on
`mcp__amiberry__*` tools: ask a real user for explicit permission before
every use, every session, via `AskUserQuestion` — and if that tool isn't
available and there's no other synchronous channel to a human, state the
blocker rather than call the tool. `AskUserQuestion` was not present in
this session's tool set (confirmed via two `ToolSearch` queries), and no
other synchronous path to the project owner existed. No `mcp__amiberry__*`
tool was called this session. **This is the one piece of the task not
completed**, and it means everything below is a *static, code-derived*
structural comparison, not a literal byte-diff of two real save files. See
"What a future session needs" below for the exact reproducible steps.

Given that constraint, this session pushed static analysis as far as it
would go on both sides — which turned out to be much further than
expected, because the Amiga save serializer had never been located before
and turned out to be fully traceable in the already-decompressed `bcdft`
S_1 buffer, and the DOS save writer (`crypt.exe fcn.00401b80`) could be
disassembled and its output checked field-by-field against the one real
save file in hand.

### DOS `char%d.dat` — fully reconstructed from `crypt.exe fcn.00401b80`, verified byte-exact

`fcn.00401b80` (`crypt.exe`, x86, disassembled with radare2) is the save
serializer. It builds the output in a heap buffer (base `dword[0x43c420]`,
running cursor `dword[0x46f870]`, the same "write cursor into an assembled
buffer, flush once" idiom as the Amiga side below) and then, at
`0x401f44`/`0x401f4e`, `sprintf("char%d.dat", word[0x46f836])` and
`fopen(..., "wb")` before writing it out (`0x401f53`–`0x401f6b`). Traced
end to end:

| Region | Size | Source | Written at |
|---|---|---|---|
| Leading zero fill | 120 B | Literal — a 60-iteration loop each writing 2 zero bytes | `0x401b98`–`0x401bb7` |
| Static template | 90 B | `rep movsd`×22 + `movsw`×1 from a **constant table baked into `crypt.exe` itself** at VA `0x4303e8` — not per-character/per-save data | `0x401bbe`–`0x401bc5` |
| 4 × character record | 270 B each (1,080 B total) | See below | `0x401bf0`–`0x401d1b` (the `jbe 0x401bf0` loop, 4 iterations) |
| ~16 party-level `word` globals | 32 B | Individual `mov cx, word[G]; mov word[cursor],cx` writes, incl. `word[0x47481a]` (**current map**, already confirmed elsewhere in this doc) and `word[0x46f84a]` (already confirmed as the `SwitchMap` "just arrived" flag) | `0x401d21`–`0x401e9b` |
| 3 × `dword`/`dword`-pair globals | 20 B | `word[0x46f854]` (4 B) + two 8-byte paired-dword writes (`0x46f8ac`+`0x46f8b0`, `0x46f84c`+`0x46f850`) | `0x401e9b`–`0x401eee` |
| **13 × `dword` map-offset table** | 52 B | **`rep`-style loop copying verbatim from `dword[0x43c424]`** — the exact global this plan's §0.2 already identified as "the file's raw offset table, whose sole job is to be copied into `char%hu.dat`" | `0x401eee`–`0x401f1b` |
| Terminator | 2 B | `mov word[cursor], 0` | `0x401f1f` |
| **Total** | **210 + 1,080 + 106 = 1,396 B** | | |

**1,396 / 1,396 bytes accounted for, zero slack** — the disassembly-derived
size matches the real file's size exactly with nothing left over.

**The offset-table region is the decisive verification.** Slicing the real
`char1.dat` at the position the disassembly predicts (byte offset `0x53e`,
52 bytes) and reading it as 13 little-endian `dword`s gives:

```
[0, 15047, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
```

`15047 = 0x3AC7` is not a coincidental value — it is **the exact "map 2"
dangling-pointer offset this same plan document already derived and
explained in §0.1** ("`15,099 − 15,047 = 52` — the file just stops 52
bytes after that offset... No map-2 data exists"). Finding that precise,
previously-derived number sitting at the byte offset a completely
independent x86 disassembly predicted, inside a real save file nobody had
looked at before, is a strong, self-consistent, zero-ambiguity anchor —
not just "a plausible byte count".

**Per-character record layout (270 B, 4 identical-shape records confirmed
against the real file at name-to-name stride `0x10E` = 270, zero
deviation across all 4):**

| Offset (rel.) | Size | Field | Evidence |
|---|---|---|---|
| `+0x00` | 2 | Scalar (varies per record; small computed value) | `0x401c15`–`0x401c2a` |
| `+0x02` | 168 (`0xA8`) | **Raw copy of the in-memory character struct** — class name string at struct offset 0 (24-byte field, e.g. `"FIGHTER\0"` padded), then a 4×10-byte slot table (2-byte sequential item id + 8 reserved bytes, ids global across the whole party: 1-4, 6-9, 11-14, 16-19), then further stat/equipment fields not decoded field-by-field this session | `0x401c1a`–`0x401c2a` (the `0xa8`-byte copy itself); real-file confirmation: `"FIGHTER\0"`/`"CLERIC\0\0"`/`"MAGIC USER\0"`/`"DRUID\0\0\0"` land exactly at `rec+2` in all 4 records |
| `+0xAA`..`+0x10D` | up to 100 B | Conditional per-slot item data — two loops (6 and 5 iterations) that only emit a 20-byte static item-definition record (copied from a table at VA `0x430240`, keyed by an id read from the character struct) when that slot's id is nonzero; each emission is followed by a call to `fcn.00401a20` (not traced this session) | `0x401c3c`–`0x401cf3` |

The real file's 4 records happen to be **byte-identical in total length**
(exactly 270 B apart with no slack), which means this particular save's 4
starting characters all populate the same number of item/equipment slots
— consistent with a fresh, low-level party. The record format itself is
technically variable-length; this session's 1,396-byte oracle can't
distinguish "fixed 270 B" from "variable, happens to total 270 B here" —
flagged as a **hypothesis**, not confirmed, pending a second real save
with a different equipment loadout.

### Amiga save — the serializer, found and traced for the first time in this project, but never run

No Amiga save file exists anywhere in this project's data (`data/blackcrypt/amiga/` has only the 3 ADFs and 13 unpacked overlay files, no `.uss`-adjacent save state — checked). Ground truth for the *format* was instead obtained by finding and tracing the actual save routine in the already-decompressed `bcdft` S_1 buffer (`build/cache/blackcrypt/bcdft_decompressed.bin`, 166,676 B — produced by this project's existing musashi-emulated LZ77 decompressor, `tools/bcdft_decompress/`; no new decompression work needed). This is the same S_1 address space `docs/blackcrypt/amiga/data-structure.md` already cites dozens of times (e.g. "the serializer at S_1 `+0x19370`"), so the routine had a known rough location, but nobody had disassembled it before this session.

Disassembled with radare2 (`-a m68k`, raw flat load, base 0 — S_1-relative
offsets equal file offsets in the decompressed buffer, matching the doc's
own `S_1 +0xNNNNN` citation convention). The routine spanning roughly
`S_1 +0x1957A`–`+0x19A88` builds an in-memory buffer (cursor at `$1EDA(A4)`,
same "assemble in RAM, flush once" idiom as the DOS side) via repeated
calls to a local `CopyMem`-style helper at `S_1 +0xA810E`:

| Step | Content | Evidence |
|---|---|---|
| 1 | **4 × character record**, looped `d5 = 0..3` | loop bound `cmpi.w 0x3,d5` @ `S_1 +0x19822` |
| 1a | **168-byte (`0xA8`) raw copy** of the in-memory character struct at `$1758(A4) + d5*168` | `S_1 +0x19694`–`+0x196b8`; stride `168` independently re-derived from the multiply sequence and matches the *already-documented* "character records at `$1758(A4)`, stride 168" (`amiga/data-structure.md` line 1887) |
| 1b | Two conditional item/spell-slot validation loops (3 iters, then 5 iters) reading words at struct offsets `+0x16`/`+0x3A`, each nonzero slot triggering a 20-byte lookup-table copy from `$91_86(A4)`-relative + a call to `S_1 +0x18DAE` | `S_1 +0x196c2`–`+0x19820` |
| 2 | **13 × `dword` (52 B) map-offset table**, verbatim from `$1EDE(A4)` | `S_1 +0x19a4c`–`+0x19a80` — the loop bound `cmpi.w 0xc,d5` (13 iterations) and per-slot 4-byte copy match the already-documented "13 map offsets" table exactly |
| 3 | ~20 party-level scalar globals, individual writes | `S_1 +0x1982a`–`+0x19a20`, including **`$1740(A4)`/`$1742(A4)`/`$1744(A4)`** (already confirmed as `partyY`/`partyX`/`facing`), **`$1750(A4)`** (already confirmed as the turn counter), **`$1E5C(A4)`** (already confirmed as the current dungeon level/map number), and **`$1A24(A4)`** (already confirmed elsewhere as the selected-character index, `tbl = $1758(A4) + $1A24(A4)*168`) — all four cross-checks land exactly where a save routine should touch them |
| 4 | **Pending scheduled-events list** (12-byte records, `$1036(A4)`-based, sentinel `150` = `0x96`) | `S_1 +0x19a88`–`+0x19cfe`; matches the already-documented 12-byte scheduled-event record and sentinel value exactly |
| 5 | Flush to disk | `S_1 +0x19b26`: string `"GAMESAVE:"` (`S_1 +0x1d45c`) + string `"CHARACTERS"` (`S_1 +0x1d93c`) → filename `GAMESAVE:CHARACTERS`; a second, adjacent code path at `+0x19bf0`/`+0x19c06` opens `"TempDungeons"`/`"OrigDungeons"` (strings at `+0x1d8e1`/`+0x1d947`) for the dungeon-state half of a save — the same file pair `bcdfp.asm` already documents being written via `GAMESAVE:OrigDungeons`, and the same `orig1.gam`/`tempdung.gam` pair present in `data/blackcrypt/dosvga/` |

**Amiga saves to one fixed filename, `GAMESAVE:CHARACTERS`** — not a
numbered `Char1`/`Char2` pattern like DOS's `char%d.dat`. This is itself
an answer to a sub-question the task raised: the "same `char%d.dat`
filename pattern" observed on the DOS side is DOS's own numbering scheme
for demo-testing save slots, not something carried over from the Amiga's
own naming (which uses one fixed name per save-game directory instead).

### Structural comparison and verdict

**Real, substantive structural parallels — not a coincidence:**

1. Both platforms serialize by assembling a flat buffer in RAM with a
   running cursor, then flush it in one write — same idiom, independently
   confirmed on both sides.
2. Both platforms copy a **168-byte raw character struct verbatim**, per
   character, as the first/core part of that character's save record —
   identical byte count on both sides. Given this project's Phase 2
   precedent (the Amiga/DOS map format shares real structural DNA, needing
   field-level not blanket transformation) and that both engines clearly
   descend from the same original Raven Software data model, this strongly
   suggests the 168-byte block's *field order* is close to identical
   between platforms too — but this was **not verified field-by-field**
   this session on either side (neither struct's individual stat/name-field
   offsets beyond "name at the front" were decoded).
3. Both platforms embed the **same 13-slot, 52-byte dungeon map-offset
   table** verbatim, copied from the same conceptual global on each side
   (`$0x43c424` DOS / `$1EDE(A4)` Amiga) — and the DOS instance is
   byte-verified against this plan's own independently-derived `15,047`
   value.
4. Both platforms save roughly the same *class* of party-level scalars
   (position, facing, current level/map, turn counter, selected-character
   index) as individual small fields, not a packed struct.

**But not byte-comparable as a blanket transform:**

- **Different outer shape.** DOS wraps everything in a 210-byte header
  (120 zero bytes + a 90-byte constant template baked into `crypt.exe`,
  not save data) before the character records; nothing on the Amiga side
  corresponds to that — the Amiga writer goes straight into the
  character-record loop.
- **Different save-file granularity.** DOS's `char%d.dat` is one
  self-contained flat file holding characters + party scalars + the map
  offset table, with dungeon-state (`orig1.gam`/`tempdung.gam`) external.
  Amiga's `GAMESAVE:CHARACTERS` holds the same character/party/offset-table
  content but *also* the pending scheduled-events list (12-byte records,
  sentinel-terminated chain) in the same file — DOS has no traced
  equivalent of that list anywhere in `fcn.00401b80`.
- **Different per-character tail.** DOS's per-character record has a
  conditional, lookup-table-driven item/equipment tail (up to 100 B,
  copying *static* 20-byte item-definition records keyed by an id).
  Amiga's per-character tail is a *validation* pass over item/spell slot
  words already inside the 168-byte struct (no external item-table copy
  observed in the traced code) — different mechanism, not just different
  byte width.
- **Different set of party-level globals**, and **no per-field byte-offset
  mapping was established** between the Amiga's ~20 named scalars and
  DOS's ~16+ named scalars — several matched by *role* (position, facing,
  level, turn counter) but not by confirmed byte offset correspondence.

**Verdict: a real, tractable converter is plausible to build — following
exactly Phase 2's precedent of a per-field selective transform, not a
blanket byte-swap — but it is not yet buildable from what this session
established.** This session mapped record *boundaries and counts* on both
sides to a very high confidence (the DOS side is now byte-exact-verified;
the Amiga side is fully traced to the instruction level but never run
against real data), which is real, durable progress — but neither side's
168-byte core struct was decoded field-by-field, and the ~20-scalar
party-state blocks were matched by name/role for only about a third of
their fields. Closing those gaps is Phase 2-shaped work (a dedicated
per-field mapping pass, most likely needing the actual Amiga save bytes as
an oracle to pin down field order the way the map-offset-table match did
here) — not a quick follow-up, and not something to guess at without that
oracle.

### What a future session needs, to finish this

1. Get explicit user permission for Amiberry use (this agent's own hard
   gate — ask first, every session).
2. `create_config` from a template pointing at the 3 real ADFs
   (`data/blackcrypt/amiga/adf/*.adf`) as floppy images, **plus a host
   directory mounted as a hard-drive/assign target for `GAMESAVE:`** — a
   read-only ADF alone cannot receive the save; check `parse_config`/
   `get_config_content` on whatever existing Amiberry configs are present
   in this environment for the mount-directory syntax before writing a new
   one from scratch.
3. Boot, get through chargen/menus to the in-game LOAD/SAVE screen (see
   `amiga/data-structure.md` for the documented menu-item strings — "LOAD
   GAME", "SAVE GAME" — and any chargen UI flow already recorded there),
   save, then read `GAMESAVE:CHARACTERS` back off the host-mounted
   directory (per the filename this session's disassembly identified —
   confirm it matches what actually appears on disk).
4. Byte-diff that file against this session's traced layout (buffer size,
   4×168-byte struct positions, the 52-byte offset-table position/values)
   to confirm or correct it, then extend to a full field-by-field map of
   the 168-byte struct and the party-scalar block, the way Phase 2 did for
   the dungeon record.
5. `runtime_screenshot_view` liberally at each step — this project's
   verified-not-assumed bar applies here too.

No `.uae` config or save-related tooling was committed this session (none
was created — no Amiberry tool was called at all). `data/blackcrypt/`
and `build/cache/blackcrypt/` are unmodified; the only files touched are
this document and read-only analysis of `crypt.exe` /
`bcdft_decompressed.bin`, neither of which was written to.

---

### Update — real Amiga save corpus obtained (no emulator needed)

The project owner supplied `data/blackcrypt/saves.7z` (79,988 B, gitignored
— **never commit this archive or its extracted contents**), a real archive
from an actual Amiga playthrough. Extracted to scratch (`7z x`, never into
`data/`): **80 real `CHARACTERSA`–`E` files**, sizes 3,340–7,652 B, spanning
a single continuous playthrough's dungeon-level directories (`levels/05`
through `levels/28`, `levels/tmp*` autosaves, `levels/final`) plus several
independent early/fresh-party saves in sibling directories (`1/`, `3/`,
`4/`, `5/`, `6/` — `6/` is a byte-identical duplicate of `2/BlackCrypt/`'s
tree). This let every claim below be checked against up to 80 independent
real files instead of zero, closing most of what the disassembly-only pass
above had to leave as "traced but never run".

**Everything here is verified with `hashlib`/`struct`-level Python against
the real bytes — evidence is stated as counts out of the full corpus, not
"looks right".**

#### 1. The leading 120-byte zero header — confirmed, 80/80

Every one of the 80 real saves starts with exactly the same 120 zero
bytes the disassembly-only DOS analysis predicted (`0x00`–`0x77`), byte-
identical to `char1.dat`'s own leading zero run. Zero exceptions.

#### 2. The following 90-byte block — position-confirmed, but it's *real state*, not a compiled constant

The DOS-only pass called `crypt.exe`'s `0x4303e8` table (copied verbatim
into every DOS save) a "static template… not per-character/per-save data".
That's **corrected**: on the Amiga side, this 90-byte block (`0x78`–`0xD1`,
still position-identical to DOS) is **not** constant across real saves —
diffing the freshest save (`1/CHARACTERSA`) against a deep, 23-levels-later
save from the *same playthrough* (`levels/28/CHARACTERSA`) shows the block
changed. What *is* still constant, confirmed 45/45 two-byte units, both
files: the **shape** — three 15-word sub-blocks, each opening with marker
bytes `01 01` and closing with an `0xFF` terminator, each holding a
`(id, count)`-shaped sequence — and, critically, **which of the 15 units in
each sub-block are true 16-bit words (byte-swapped between platforms) vs.
which are two independent bytes (identical raw bytes on both platforms,
unaffected by endianness)**. Position-by-position diff against real
`char1.dat` bytes at the same offsets:

```
unit:  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14
kind: SAME SAME SWAP SAME SWAP SWAP SAME SWAP SWAP SAME SWAP SWAP SAME SWAP SWAP
```
repeating identically for all 3 sub-blocks, DOS vs. real Amiga alike. This
is a second, independent, real-data confirmation of Phase 2's core finding
— **the byte-swap is per-field, not blanket** — now demonstrated on the
save-file format too, not just the dungeon-map format. Best current
reading: a party-wide item/spell master-list table (sequential ids 2–5,
3–8, etc.) that starts in "creation order" for a brand-new party (which is
why the DOS demo's fresh characters and this session's freshest Amiga save
both show it in clean ascending order) and gets reordered by real
inventory/spellbook activity — a **hypothesis**, not fully decoded, but the
*shape* and *swap rule* are now confirmed data, not guesses.

#### 3. The 168-byte character struct — confirmed field-for-field for the Fighter class, including one exact unswapped byte-array match

Comparing DOS's real `char1.dat` Fighter (168 B from name) against the
freshest real Amiga save's Fighter (168 B from name, `1/CHARACTERSA`),
field by field, byte-position-identical on both platforms:

| Field (relative to name) | DOS (real) | Amiga (real) | Verdict |
|---|---|---|---|
| `+0x00` | `"FIGHTER\0"` + zero pad to 24 B | `"FIGHTER\0"` + zero pad to 24 B | identical layout |
| `+0x18`, stride `0x0A`×4 | sequential ids `1,2,3,4` | real ids `5,2,1,3` (out of order — a *played* fighter's items, not a fresh kit) | **same field, same position, different real values** — exactly what a shared layout with different play histories should produce |
| `+0x46`–`+0x4B` | `01 FF FF FF FF FF` | `01 FF FF FF FF FF` | identical raw bytes |
| `+0x4C`/`+0x4E` (word pair) | `0x0014`/`0x0014` (LE) | `0x0014`/`0x0014` (BE) | same value, correctly per-field-swapped |
| `+0x50`/`+0x52` (word pair) | `0x1384` = 4996 (LE) | `0x1388` = 5000 (BE) | same *kind* of stat (paired, equal to itself — a current==max pattern), plausible-but-different real values |
| `+0x54` (word) | `0x270e` = 9998 (LE) | `0x2710` = **10000** (BE) | same field, round-number-consistent real values |
| `+0x5E`–`+0x6D` (16 B) | `08 08 0e 06 08 0a 0c 00 00 00 00 00 0e 06 08 0a` | **byte-for-byte identical** | a class-constant (Fighter equipment-slot-type array) — single bytes, so endianness is moot, and it matches **exactly** |

This is a real, quantitative, cross-platform, cross-file confirmation of
the 168-byte struct's field layout — not just its size. The one exact
byte-array match (`+0x5E`) is decisive: two files from two different
platforms, two different real characters, from two different actual games,
producing **identical bytes** at the same offset is only explained by a
shared class-constant table at a shared struct offset.

#### 4. Per-character record *total* size — real, large, and now correctly scoped as an open gap (not a small oversight)

Real Amiga records are far bigger than the disassembly-only pass's ≤328 B
ceiling predicted: name-to-name stride in the freshest save is **844 B**
per character (vs. DOS's fixed 270 B), and the *within-playthrough* growth
pattern is itself diagnostic — walking `levels/05` → `levels/28` (same 4
characters, same playthrough), the **Fighter's own record size never
changes** while Cleric/Magic User/Druid's grow steadily. That is exactly
the signature of a **known-spells list** dominating the tail (fighters
don't learn spells in this game; the three casters do) — a strong,
evidence-backed hypothesis for *what* the extra data is, even though its
internal byte format was not decoded this session. This is real progress
over the disassembly-only pass (which had no way to distinguish "my loop
trace under-counted" from "there's a genuinely unbounded structure I
hadn't found") but is **still open** — flagged, not glossed over.

#### 5. The 13-slot, 52-byte map-offset table — triple-confirmed, zero deviation across the entire real corpus

Searching every one of the 80 real saves for the 8-byte anchor pattern
`00 00 00 00 00 00 3A C7` (slot 0 = 0, slot 1 = `0x3AC7` = 15,047) finds it
in **80/80 files, 100%**, and in every file the full 13-slot table decodes
to the **exact same 13 values**, byte-for-byte:

```
(0, 15047, 34766, 54155, 73694, 89339, 104662, 119907,
 125098, 138953, 143834, 158919, 165686)
```

Zero deviation across a fresh level-1 save, mid-game saves, and an
end-of-game save. `15,047 = 0x3AC7` is not a coincidence — it is **the
exact "map 2 dangling pointer" value this same document already derived
independently in §0.1** from the DOS demo's own truncated `maindung.gam`.
Finding the identical value, at the identical relative structural position
(52 bytes + a trailing field before EOF, see below), in 80 completely
independent real Amiga save files from a real playthrough closes this
anchor beyond reasonable doubt: **both platforms' map-offset tables encode
the same real byte offsets into the same underlying 13-map layout**, per-
field swapped (LE on DOS, BE on Amiga) exactly like every other confirmed
field in this document.

#### 6. New: the "current map" scalar, pinned and validated against real progression

Diffing the 64 bytes immediately preceding the offset table across the
full `levels/05`→`levels/28` progression (same playthrough) finds exactly
one byte, at a fixed offset (`table_start − 33`), that moves
**monotonically 1 → 13** in lockstep with real directory/level progress —
confirmed across all 25 progression saves plus every early/fresh save
(all read `1`) with zero exceptions (e.g. `levels/05`→`2`, `levels/13`→`5`,
`levels/20`→`8`, `levels/28`→`13`). This is the Amiga on-disk counterpart
of DOS's `word[0x47481a]` (current map) and this project's already-
documented `$1E5C(A4)` — now confirmed, not just plausibly-named, by a
clean monotonic real-data signal.

#### 7. Correction: the "terminator" is a real pending-event *count* field, not a blind zero-write

The disassembly-only pass read `mov word[cursor], 0` as a blind
terminator, because the only real sample available (`char1.dat`) has zero
pending events. Real saves refute that: the word immediately after the
52-byte table equals the **pending scheduled-event count**, and the file
ends exactly `52 + 2 + (12 × count)` bytes from the table's start in
**every one of the 80 real files** — e.g. `levels/final` has count `2`
(24 extra bytes), `levels/20` has count `6` (72 extra bytes), `levels/14`
has count `8` (96 extra bytes), and the 60-odd files with count `0` land
exactly on `52 + 2 = 54` bytes from EOF. This confirms the disassembly's
predicted ordering (offset table, then the pending-events list, then a
trailing field) exactly — it just mis-read what the trailing field means,
which real data now corrects.

#### Updated verdict

**The party/global portion of the save format (header, map-offset table,
current-map scalar, pending-event-count + list) is now confirmed
cross-platform-compatible at the byte/field level — a converter for this
slice is buildable today, following Phase 2's per-field-swap precedent
exactly, no further oracle needed.** The 168-byte character-core struct is
confirmed compatible for every field checked, including one exact,
platform-independent byte-array match. **The one real remaining gap is the
per-character variable-length tail** (spell lists / inventory, contributing
the bulk of the 270 B vs. 844+ B size gap) — now correctly scoped as a
substantial, well-motivated (very likely a known-spells list, per the
class-correlated growth pattern) but undecoded sub-format, rather than an
unknown "maybe it's just bigger than expected" gap. Closing it is Phase
2-shaped work — walk the real corpus's per-character tails the way
`scripts/bclib/bcdfs.py` walks dungeon records — and does not need
Amiberry or any further oracle; the 80-file corpus already in hand is
sufficient to do it in a follow-up session.

No file under `data/blackcrypt/saves.7z` or its extracted contents was
committed or written into `data/blackcrypt/` — all analysis ran against
the scratch extraction. No `mcp__amiberry__*` tool was called.

### Live cross-check, 2026-08-04: dropping a real Amiga save into an unconverted DOS slot

Independent of the corpus analysis above, the project owner ran the
patched `crypt.exe` (Phase 4 + 5) under Wine with two real, **unconverted**
Amiga `CHARACTERSA` files simply renamed into two unused DOS save slots
(`char2.dat` ← `2/BlackCrypt/CHARACTERSA`, 7,596 B; `char3.dat` ←
`1/CHARACTERSA`, 3,692 B — no transform applied, a deliberate "does it just
work" test). Result: the smaller/earlier save's slot returned cleanly to
the load-game menu (no crash — consistent with `fcn.00426390`, the load-path
counterpart of the save serializer above, reading *something* it treats as
invalid/empty rather than garbage-but-plausible); the larger/deeper save's
slot crashed with a page fault writing to address `0x00000024`.

The crash backtrace (`data/blackcrypt/wine-test/backtrace.txt`) lands
exactly where this finding predicts: frame 2 is `crypt+0x2537f` = VA
`0x42537f` = **`fcn.00425350` (`LoadDungeon`) + 0x2f** — i.e. 47 bytes into
the same parser this plan's §"1A" already fully documents, reached via
`fcn.00426390`'s restore-game path (`SwitchMap(-1, curMap)` →
`LoadDungeon(1)`, §"1A"'s own diagram). Frame 1, `crypt+0x28c36`, is where
the actual write fault occurs — a garbage pointer/index, consistent with
`fcn.00426390` having populated the runtime map-offset table (`0x4738b4`)
and/or `curMap` (`word[0x47481a]`) from real Amiga-format bytes
misinterpreted under the DOS field layout this section derived, then
handing that garbage straight to `LoadDungeon` without validation.

This is real, independent, empirical confirmation of the write-up above's
core finding — **raw byte reuse across platforms doesn't work, exactly as
the field-level comparison predicted** — obtained without needing to build
the converter first. It also newly implicates `fcn.00426390` as worth
tracing in the same detail `fcn.00401b80` (the DOS serializer) got above, if
a future session wants to build the load-side (not just save-side) half of
a cross-platform converter.

### 8. A real converter, and a converted end-game save

Following directly from the "Updated verdict" above ("a converter for this
slice is buildable today"), this pass built one:
`scripts/bclib/charsave.py`, mirroring `scripts/bclib/maindung.py`'s role
and rigor for the character-save format. Full design rationale and a
field-by-field confidence table live in the module's own docstring; this
section summarizes the result and documents two things the module's
construction turned up that weren't known before.

#### Correction: the "120-byte zero header, 80/80" claim doesn't hold across the full corpus

Re-checking that claim (Update § 1, above) against all 80 real files rather
than the small subset apparently checked originally: **only 30 of 80** have
an all-zero leading 120 bytes. The other 50 — every one of them a
deeper/later save from the `2/BlackCrypt/` and `6/` playthroughs — have
real, non-zero, non-monotonically-varying data there (e.g. the target file
below has 35 non-zero bytes in that span; `levels/28` in the same
playthrough has 0). The *position* is still exactly right (the first
character's name string sits at file offset 212 in literally all 80
files, small or large — confirmed by direct search, not assumption), so
none of the earlier offset/boundary findings are affected. What's wrong is
specifically the claim that this region is always zero on Amiga. It isn't;
something real (never decoded) lives there once a save has enough game
history. This has **no effect on the converter's correctness** — see
below, the DOS side of this region is a disassembly-proven,
save-state-independent constant, so the Amiga source's real content there
was never going to be used regardless.

#### The DOS 210-byte header is a compile-time constant, not "mostly zero, partly a template" — new disassembly finding

The original DOS-side trace (`fcn.00401b80`, top of this Phase) already
established that the leading 120 bytes are an unconditional zero-fill loop
and the following 90 bytes are `rep movsd` from a literal constant table
baked into `crypt.exe` at VA `0x4303e8` — neither reads any per-save
global. Put together with the correction above, the right conclusion is
stronger than "DOS's header happens to match a fresh Amiga save": **every
real DOS save has an identical 210-byte header, regardless of game
state**, while Amiga's corresponding bytes are real (if undecoded) state.
The converter exploits this directly — it copies the header verbatim from
the reference file (`data/blackcrypt/dosvga/char1.dat`) rather than
attempting any transform of the Amiga source's corresponding bytes, which
is both simpler and more correct than the alternative.

#### New: the exact byte offset of "current map" inside DOS's party-scalar block

Phase 6's original pass identified `word[0x47481a]` as "current map" among
"~16 party-level word globals" written at `0x401d21`-`0x401e9b`, without
pinning which of those ~16 slots it lands in. This pass disassembled that
range instruction-by-instruction: it's 17 sequential 2-byte
`mov word[cursor], cx` writes, and the 9th one (`0x401dd9`) is `mov cx,
word [0x47481a]`, landing at **party-scalar-block-relative offset +18**
(i.e. absolute file offset 1308 for a standard 4-character save). Cross-
checked against `char1.dat` itself: the word at that exact position reads
`1`, matching its known fresh/map-1 state. This is the one party-scalar
field the converter writes from real Amiga data (the source save's own
current-map byte, zero-extended); the other ~50 bytes of that block are
copied verbatim from `char1.dat`'s own known-safe fresh-game values, since
no other field's exact DOS byte offset has been established.

#### The converter's design, briefly (full detail in the module docstring)

| Region | Source | Confidence |
|---|---|---|
| 210 B header | `char1.dat` verbatim | Confirmed (disassembly: state-independent) |
| Party-slot index (`+0x00` of each record) | Computed (0-3) | Confirmed (matches real data on both platforms) |
| Core struct: name, `01 FF..` marker, 3 word-pair stats, class-constant array | Amiga source, per-field swap | Confirmed (Phase 6 real byte comparison) |
| Core struct: remaining ~90 B | Amiga source, raw copy (no swap) | Best-effort / unverified |
| Item-slot table (`+0x18`, in-core) + 100 B per-record tail | Zeroed | Deliberate safety choice, not a decode |
| Party-scalar block | `char1.dat` verbatim, current-map overridden | Confirmed for current-map; safe defaults elsewhere |
| Map-offset table | Amiga source, per-field byte-swap | Confirmed (Phase 6, byte-exact 80/80) |
| Terminator | Literal `0x0000` | Confirmed (disassembly); source's pending-event list is dropped |

The per-character tail (item/spell data beyond the 168-byte core) is the
one place the task brief specifically flagged as crash-risk if guessed —
DOS's own tail is generated at save time from a static, id-keyed item
table baked into `crypt.exe`, not a raw copy of anything, so raw Amiga
tail bytes are meaningless there. `charsave.py` zeroes the item-slot ids
inside the core *and* the 100-byte tail together, so the record is
internally consistent (no id says "look up an item" with nothing to look
up) rather than guessed-but-wrong. It always emits fixed 270-byte records
regardless of how many item slots would otherwise be populated, because
the only real *working* DOS save available (`char1.dat`) has its
map-offset table landing at the exact fixed file offset the disassembly
predicts — evidence the loader expects fixed record positions, not
content-dependent ones.

#### Self-verification: round-trip against the real, working DOS save

`scripts/bclib/charsave.py` was round-tripped against `1/CHARACTERSA` (a
real, small/fresh Amiga save from early in the same corpus — current map
`1`, zero pending events, all 4 classes present) and diffed structurally
against the real, known-working `char1.dat`:

- Output size: **1,396 B, identical** to `char1.dat`.
- 210-byte header: **byte-identical** to `char1.dat` (expected — both are
  the same DOS-native constant).
- All 4 records' party-slot index and class name: **exact match**.
- All 4 records' 100-byte tail: **all zero**, as designed.
- 3 of 4 records' 16-byte class-constant array (`+0x5E`-`+0x6D` of the
  core): **byte-exact match** against `char1.dat`'s own independently-
  sourced values (Fighter, Cleric, Druid). The 4th (Magic User) differs —
  expected, not a bug: this field tracks starting *equipment*, not just
  class (Phase 6's original single-Fighter comparison couldn't have shown
  this), and the two saves' Magic Users carry different real starting
  kits. Three independent exact matches on a field this specific is a
  strong structural confirmation of the core-struct offset mapping.
- Party-scalar block: **byte-identical to `char1.dat`** at every position
  except the current-map word, which reads the source's real value (`1`,
  correctly matching both saves being fresh map-1 saves).
- Map-offset table: **differs from `char1.dat`'s own table**, correctly —
  `char1.dat`'s table is the demo's own truncated (map-1-only) version,
  while the converter's output carries the confirmed, byte-exact real
  13-map table extracted from the Amiga source (relevant once loaded
  against a full-game-capable `crypt.exe`, e.g. the Phase 4 patch).

This is a genuine round-trip check on every region the converter claims
"confirmed" or "safe default" for — it isn't a check on the best-effort
core-struct residue (no oracle exists for that) or the deliberately-zeroed
tail (nothing to check against).

#### The conversion result: `2/BlackCrypt/CHARACTERSA` → a real DOS save

Located via the confirmed anchor pattern (`00 00 00 00 00 00 3A C7`) and
confirmed as the intended end-game target: current-map byte reads `13`.
Source file: 7,596 B; its `levels/final/CHARACTERSA` sibling is
byte-identical, confirming it as a stable end-of-game snapshot, not a
mid-write artifact. Party: Fighter, Cleric, Magic User, Druid (item ids
`[3,7,0,13]` / `[57,61,0,68]` / `[108,111,0,118]` / `[159,0,0,169]` in the
source — all deliberately dropped in the output, see above). 2 pending
scheduled events in the source (dropped, per the terminator finding).

Converted output: **1,396 B**, structurally identical in shape to
`char1.dat` (same header, same 4×270 B records, same 52 B party-scalar
block, same 52 B map-offset table, same 2 B terminator). Current map
correctly carries over as `13`. The full, real, byte-exact 13-slot
map-offset table is present (not the demo's truncated version). All 4
characters' names, party-slot indices, and confirmed core-struct fields
(marker bytes, stat word-pairs, class-constant array) carry the source's
real values; all 4 characters' item-slot tables and 100-byte tails are
zeroed.

Written to scratch only (never to `data/blackcrypt/dosvga/`, never
committed) and copied to the project owner's existing live-test package at
`bc-test-package/char4.dat` (an unused slot; `char1.dat`, `char2.dat`,
`char3.dat` in that directory were left untouched) for an immediate Wine
test.

**Expected in-game result, honestly stated:** party composition, names,
the confirmed core-struct fields, and — most importantly — the current
map/dungeon level (13, deep end-game) should load correctly, since those
are the confirmed-or-disassembly-verified regions. Position, facing, and
turn-counter reset to the DOS demo's own fresh-game defaults, since no
per-field mapping exists for those yet (Phase 6's own long-standing gap,
not new to this pass). Inventory and spellbooks should show empty/reset
rather than wrong or dangling — the deliberate, documented safety choice
for the one region a wrong guess could plausibly reproduce the project
owner's already-observed `LoadDungeon` crash. About 90 bytes per character
of never-individually-confirmed core-struct residue (stats beyond the
specifically-identified fields) carry over as raw, unswapped bytes — a
best-effort choice, not verified against any oracle, and the one part of
this conversion where wrong-but-plausible-looking values (not crashes) are
the realistic risk.

### 9. The `LoadDungeon` crash traced to ground — not a save-format bug at all

Both the raw, unconverted Amiga save dropped into `char2.dat` ("Live
cross-check" above) and the carefully converted, independently-verified
end-game save at `char4.dat` (§8) crashed **identically**, down to the
register level, when loaded under Wine:

```
Unhandled exception: page fault on write access to 0x00000024
EAX:00000000 EBX:00000020 ECX:0043b860 EDX:<differs>
ESI:0000ffff EDI:00000000
Backtrace:
=>0 <ntdll+0x22a83>            lock addl $1, 4(%ebx)
  1 crypt+0x28c36
  2 crypt+0x2537f
```
(`data/blackcrypt/wine-test/backtrace.txt`, `backtrace-load-game-4.txt`.)

That two very different inputs crash on the exact same instruction with
the exact same `EAX`/`EBX`/`ECX` was the tell this session followed to
ground, by disassembling the full call chain with radare2 rather than
guessing: `fcn.00426390` (restore-game) → `fcn.00425350` (`LoadDungeon`) →
`fcn.004274d3` (fseek wrapper) → `fcn.00428c08` (the CRT stream-lock
helper). **Verdict: this is not a save-format bug, not a charsave.py
byte-offset bug, and not something Phase 4's map-switch patch touches. It
is a genuine, always-present bug in the shipped 1998 `crypt.exe`:
`fcn.00426390` never checks whether `CopyFileA` actually succeeded before
handing a possibly-nonexistent `tempdung.gam` to `LoadDungeon`.**

#### The exact call chain, traced instruction by instruction

`crypt+0x2537f` (frame 2) is not inside `LoadDungeon`'s own body — it's the
**return address** pushed by the `call fcn.004274d3` instruction at
`0x42537a`:

```
fcn.00425350 (LoadDungeon), file+0x25350:
  0x425356  push 0x4304b4            ; "rb"
  0x42535b  push str.tempdung.gam
  0x425360  call fcn.00427357        ; fopen("tempdung.gam","rb")
  0x425365  mov edi, eax             ; edi = FILE* (or NULL)
  0x425369  mov ax, word[0x47481a]   ; curMap
  0x425371  mov ecx, dword[eax*4+0x4738b4]  ; offset table entry
  0x425379  push edi                 ; stream
  0x42537a  call fcn.004274d3        ; fseek(stream, offset, 0)
  0x42537f  <-- return address == crash backtrace frame 2
```

`fcn.004274d3` (the fseek wrapper) does, as its very first action:

```
fcn.004274d3, file+0x274d3:
  0x4274d7  push dword[arg_8h]       ; the stream (edi from above)
  0x4274da  call fcn.00428c08        ; lock the stream
```

`fcn.00428c08` is the CRT's internal stream-lock helper — the standard
"is this FILE* one of the static `_iob`-table entries, or a heap one"
dispatch every MSVCRT build has:

```
fcn.00428c08(FILE *stream), file+0x28c08:
  0x428c08  mov eax, dword[arg_4h]   ; eax = stream
  0x428c0c  mov ecx, 0x43b860        ; static FILE-table base
  0x428c11  cmp eax, ecx
  0x428c13  jb 0x428c2c              ; below the static table -> fallback
  0x428c15  cmp eax, 0x43bac0        ; static FILE-table end
  0x428c1a  ja 0x428c2c              ; above it -> fallback too
  0x428c1c  ...                      ; (in-range case, not taken here)
  0x428c2c  add eax, 0x20            ; fallback: CRITICAL_SECTION = stream+0x20
  0x428c2f  push eax
  0x428c30  call [KERNEL32.EnterCriticalSection]
  0x428c36  ret                      ; <-- crash backtrace frame 1
```

If `stream` (`eax`) is `NULL`, `0 < 0x43b860` so the "below the static
table" branch is taken (`jb 0x428c2c` at `0x428c13`), computing
`CRITICAL_SECTION = NULL + 0x20 = 0x20` and calling
`EnterCriticalSection(0x20)`. Wine's `ntdll` implementation loads that
argument into `EBX` and performs `lock addl $1, 4(%ebx)` on the
`CRITICAL_SECTION.LockCount` field — `0x20 + 4 = 0x24`, the exact fault
address in both crash dumps. Every register in both crash dumps matches
this reconstruction exactly: `EAX=0` (the `stream` argument was `NULL`),
`ECX=0x0043b860` (the untouched static-table-base constant loaded at
`0x428c0c`), `EBX=0x20` (computed at `0x428c2c`), `ESI=0xffff` (`SwitchMap`'s
`fromMap=-1` sentinel, truncated to 16 bits somewhere inside `SwitchMap`
itself — identical in both crashes because both went through
`fcn.00426390`'s `SwitchMap(-1, curMap)` call, §"1A"). `EDX` is the only
register that differs between the two crash dumps, and it plays no part in
this call chain (dead/leftover value from whatever computation preceded it
in each specific run) — consistent with everything else lining up exactly.

**This crash happens before `LoadDungeon` ever consults anything from the
save file's own map-offset table** — the `fopen` at `0x425360` is the very
first thing `LoadDungeon` does, before the `dword[eax*4+0x4738b4]` read at
`0x425371` even executes meaningfully (that read happens, but its result is
never used — the crash is inside the *fseek call* that follows). This
directly answers the session's opening question #1: **no, this is not a
load-side/save-side byte-offset mismatch** — `charsave.py`'s map-offset
table (or any other field) is never reached.

#### Why `stream` is `NULL`: the actual root cause, upstream in `fcn.00426390`

`fcn.00426390` (restore-game), right before its `SwitchMap(-1, curMap)`
call, does this unconditionally once `char%hu.dat` has been read
successfully:

```
fcn.00426390, file+0x426390:
  0x426802  call fcn.0040cb50
  0x426807  push str.tempdung.gam
  0x426811  call [KERNEL32.DeleteFileA]      ; delete tempdung.gam
  0x426819  ...                              ; sprintf "orig%hu.gam" % slot
  0x42682a  call fcn.0042736a
  0x426834  push str.tempdung.gam            ; lpNewFileName
  0x426839  push 0x46f41c                    ; lpExistingFileName = "orig<N>.gam"
  0x42683e  call [KERNEL32.CopyFileA]        ; copy orig<N>.gam -> tempdung.gam
  0x426846  test eax, eax                    ; CopyFileA's return (0 = failed)
  0x426849  jne 0x42685d                     ; success -> skip failure branch
  0x42684b  push str._COPY_FAILED_           ; "*** COPY FAILED ***"
  0x426850  call fcn.0040c910
  0x426858  call fcn.00425d80                ; GetLastError + FormatMessageA
                                              ; into a LOCAL buffer -- never
                                              ; displayed, never logged
  ; falls straight through to 0x42685d regardless of success/failure:
  0x42685d  mov cx, word[0x47481a]           ; curMap
  0x426867  call fcn.00426880                ; SwitchMap(-1, curMap)
```

`fcn.00425d80` is confirmed inert — it's just `GetLastError` +
`FormatMessageA` into a 500-byte stack-local buffer that goes out of scope
on `ret`; nothing ever reads or displays it. So the "`*** COPY FAILED ***`"
branch is dead-end diagnostics, not error handling, and **execution falls
through into `SwitchMap`/`LoadDungeon` whether or not `CopyFileA`
succeeded.** Combined with the unconditional `DeleteFileA` immediately
before it, a failed copy leaves **no `tempdung.gam` on disk at all**, so
`LoadDungeon`'s `fopen` at `0x425360` returns `NULL` — the `stream` that
then crashes the lock helper above.

`CopyFileA(orig<N>.gam, tempdung.gam, FALSE)` fails whenever `orig<N>.gam`
doesn't exist for slot `N`. That file is per-save-slot dungeon *state*
(the DOS counterpart of the Amiga's own `TempDungeons`/`OrigDungeons`
pair, §"Amiga save" above) — it's created by the game's own Save Game
flow the first time a player actually saves into that slot, not something
that ships pre-populated for every possible slot. Confirmed by a filesystem
search of this entire environment: **the only `orig*.gam`/`tempdung.gam`
files that exist anywhere are `data/blackcrypt/dosvga/orig1.gam` and
`tempdung.gam`** — the pair that came with the demo's own shipped
`char1.dat` (the project owner's real save, made by actually playing and
saving through the UI). The Phase 4/6 Wine test package
(`bc-test-package/`, built for these live tests) never had `orig2.gam`,
`orig3.gam`, or `orig4.gam` — because `char2.dat`/`char3.dat`/`char4.dat`
were all dropped into their slots by file copy, bypassing the "Save Game"
UI flow that would normally create the matching `orig<N>.gam` the first
time. **This is exactly why `char1.dat` loads fine and every other slot
crashes**, regardless of what bytes are actually inside the `.dat` file —
confirming this session's opening hypothesis that something *structural in
the load path itself*, not the converted save's content, explains the
identical crash on both a garbage input and a carefully-verified one.

This also answers question #2 directly: `fcn.00426390`'s call to
`SwitchMap(-1, curMap)` is not gated by any hidden `curMap` range check —
it's unconditional and always was, in the pristine unpatched demo too
(§"1A" already established the demo "already runs the full map-switch path
on every game load"). The bug is entirely in the unchecked `CopyFileA`
above it, wholly independent of Phase 4's `fcn.00423b50` stub fix (a
different call site, live in-game transitions, not save loading).

#### The fix: a new, independent patch — `scripts/patch_crypt_exe_guard_copy_failure.py`

Following the same `rasm2`-assemble-and-verify pattern as Phase 4/5/7:
redirect the dead "`*** COPY FAILED ***`" fallthrough at file+`0x2684b`
(18 bytes: `push str; call fcn.0040c910; add esp,4; call fcn.00425d80`) to
jump to `fcn.00426390`'s own *existing* clean bailout at `0x426408`
(`mov ax,1; pop esi; add esp,0x24; ret` — the same "load failed, return to
menu" path already used when `char%hu.dat` itself doesn't open). Stack
depth was traced instruction-by-instruction across the entire intervening
~0x440 bytes of `fcn.00426390` to confirm it's identical at both points
(every `push`/`call`/`add esp,N` pair balances, including the explicit
`push ebx,ebp,edi` / `pop edi,ebp,ebx` bracket around the character-parsing
loop) — jumping there is stack-safe. The replacement is byte-for-byte the
same length as what it replaces (18 B in, 18 B out: `push str; call
fcn.0040c910; add esp,4` kept verbatim, only the inert `call fcn.00425d80`
becomes `jmp 0x426408`), so no code cave is needed.

| Check | Result |
|---|---|
| Pre-flight: guard window matches known build | `6830b74300e8bb60feff83c404e823f5ffff` confirmed present at file+`0x2684b` in the real, unmodified `crypt.exe` |
| `jmp` bytes | `rasm2 -a x86 -b 32 -s 0x426858 "jmp 0x426408"` → `e9abfbffff`; independently round-tripped back through `r2 pd`, which prints `jmp 0x426408` exactly |
| Target resolves correctly | `0x426858 + 5 + (-0x44D) = 0x426408` exactly, checked both by the script's own assert and `r2`'s disassembly |
| Full-file diff vs. the real, unmodified `crypt.exe` | **3 bytes changed**, all inside the intended 5-byte `jmp` opcode (2 bytes coincidentally matched the replaced `call`'s trailing `ff ff`) |
| Composability with `patch_crypt_exe.py` (Phase 4) | Applied both, in sequence, to the real `crypt.exe`: **28 total changed bytes**, all inside the three known windows (Phase 4's jmp + thunk, this patch's guard) — zero interaction, zero unexpected differences |
| Round-trip disassembly of the patched region | `push str._COPY_FAILED_` / `call fcn.0040c910` / `add esp,4` / `jmp 0x426408` — the CODE XREF from `0x426849` now correctly resolves into the new bailout, confirmed by an independent `r2` pass, not just the patcher's own self-check |

Never touches `data/blackcrypt/dosvga/crypt.exe`; refuses in-place
patching; self-checks its own written output before reporting success —
identical contract to `patch_crypt_exe.py`/Phase 5/Phase 7.

#### Practical unblock applied to the live-test package

Two changes were made to the project owner's existing Wine test package
(`bc-test-package/`, outside the repo, never committed) so the next manual
test can actually exercise the converted save instead of hitting this
crash again:

1. **`crypt.exe` replaced** with a copy carrying Phase 4's patch (already
   present) plus this session's new guard patch on top — verified via the
   same composability check above. The pre-patch file was kept as a
   scratch backup, not deleted.
2. **`orig2.gam`, `orig3.gam`, `orig4.gam` provisioned**, each a copy of
   the full 13-map `maindung.gam` already in that directory. This is a
   deliberate, documented simplification (same spirit as `charsave.py`'s
   position/facing/turn-counter reset) — there is no real per-map dungeon
   *state* delta from the Amiga playthrough to carry over (only the
   character/party save was converted this project, never the dungeon
   overlay), so seeding with the pristine full dungeon is the closest
   available approximation to "a slot that was just started fresh". With
   these two changes, `char4.dat` should now load past the point that
   crashed, since `CopyFileA` will succeed and populate a real
   `tempdung.gam` before `LoadDungeon` runs.

**Live re-verification: not performed this session — same tooling gap as
Phase 4's own "Live end-to-end proof" and §1C.** Reaching the Load Game
menu and selecting slot 4 requires interactive keyboard/mouse input;
`xdotool`/`ydotool`/`xte`/`wmctrl` are all absent from this environment (a
repeat of the exact gap Phase 4 already documented), so this session could
not itself drive Wine through the menu the way the project owner evidently
has been doing manually (both crash reports were produced by real,
recent, interactively-driven Wine runs, most likely the project owner's
own). The diagnosis above is complete and byte-exact-verified by static
means (disassembly trace + register-level correlation across two
independent real crashes), matching this project's established bar; only
the final "does it now actually load" confirmation needs a human at the
keyboard, or future session with input-automation tooling.

**One loose end, honestly flagged, not resolved this session:** the
"Live cross-check" note above also recorded that the *smaller* raw Amiga
save (`char3.dat`, 3,692 B) "returned cleanly to the load-game menu" rather
than crashing, while the larger one (`char2.dat`) crashed. Under this
session's finding, both should hit the identical missing-`orig<N>.gam`
crash if they reached the same code path with the same missing companion
file — so either that earlier test used a directory where `orig3.gam`
happened to exist (a different/earlier test-package state, not reproduced
this session), or a separate, not-yet-traced validation path elsewhere
(possibly UI-level, before `fcn.00426390` is ever invoked) rejects
`char3.dat` for an unrelated reason. Not investigated further this
session — it doesn't change the diagnosis above, which is independently
and completely confirmed by the register-exact match on the two crashes
that *are* fully explained.

### 10. Two real, live-observed bugs — party-display corruption and the empty map — both traced to ground and fixed

Following the §"9" fix (the `CopyFileA`-guard patch), the project owner
loaded the resulting `char4.dat` for real under Wine. It loaded without
crashing, but two things were visibly wrong (screenshot:
`data/blackcrypt/no-walls.png`): **all four party UI boxes showed
identical "FIGHTER, Level 12, AC 14" data**, and **the 3-D dungeon view
showed only floor and ceiling — no walls or doors in any direction.**
This session traced both to ground by disassembling the *load* side for
the first time (`crypt.exe fcn.00426390`, the restore-game routine that
parses `char%hu.dat` back into memory) — every previous save-format pass
in this Phase only traced the *save* side (`fcn.00401b80`).

#### Bug 1: party-display corruption — a real record-length bug in `charsave.py`, not a load-side surprise

**Root cause: `charsave.py` wrote fixed 270-byte character records, but
the DOS loader's real per-character file-cursor advance is data-dependent
on a 23-slot item/spell array the converter zeroes — for an all-zero
record the loader only consumes 170 B, not 270, desyncing every character
after the first.**

Disassembling `fcn.00426390`'s per-character loop (`0x426488`-`0x4265bf`)
instruction by instruction, alongside a fresh full re-disassembly of the
save side (`fcn.00401b80`, `0x401bf8`-`0x401d1b`) to cross-check every
finding against both directions:

| Finding | Evidence |
|---|---|
| The loader's "168-byte core copy" (`rep movsd`, `0x426498`) starts at the record's byte 0, not byte 2 — it reads the 2-byte party-slot scalar as the struct's own leading 2 bytes, not a separate field | `0x42648f lea edi,[ebp-0x16]` (dest, per-character struct) vs. `0x426492 add edx,0xa8` (source cursor, unmodified from record start) — cross-checked against real `char1.dat` bytes: `"FIGHTER\0"` is at file offset 212, i.e. 2 B into this 168-byte span, not at its start |
| A SEPARATE 2-byte scalar is written/read immediately after that 168-byte span (absolute file `rec+168`..`rec+170`), unrelated to character display | Save side: `0x401c1a sub word[edx],cx` / `0x401c2a mov word[eax],cx` where `edx` points into a constant table at `0x4301cc`; load side: `0x4264aa mov word[ecx],ax` where `ecx = 0x469db4` (a small global array, never consulted by anything this session traced) |
| The item/spell array is a **dense 23-slot, 2-byte-stride array at core-relative `0x14`-`0x42`** — NOT the previously-documented "4 slots × 10 B at `+0x18`" (§"3. The 168-byte character struct" above, now corrected in place) | Both `fcn.00401b80` (save) and `fcn.00426390` (load) walk this exact range: an 18-iteration loop (3 outer × 6 inner, `var_1ch`/`var_18h`) covering core `0x14`-`0x38`, immediately followed by a 5-iteration loop covering core `0x38`-`0x42`. Cross-checked against real `char1.dat` bytes for all 4 characters: exactly 4 nonzero slots each, landing at core `0x18`/`0x22`/`0x2a`/`0x38` with values `1,2,3,4` / `6,7,8,9` / `11,12,13,14` / `16,17,18,19` — the OLD "stride 0x0A" claim was an eyeballed pattern match on 4 of these 23 slots' real values, refuted by the actual code trace (real gaps between the 4 hits are 10, 8, 14 bytes — not a clean stride) |
| Each NONZERO slot consumes a 20-byte item-definition record from the file, and can **recurse** into more 20-byte blocks for "special" item types (byte `+5` of that record == `0x13` or `0x23`) | Load: `0x4264ca call fcn.004111f0` → `0x4264f1`/`0x4264f7` (20 B `rep movsd` from file cursor) → `0x426505`/`0x42650f call fcn.00425120`; `fcn.00425120` itself (disassembled fresh) reads more 20-byte blocks from `dword[0x46f870]` and calls **itself** recursively at `0x425211`. This fully explains why `char1.dat`'s real per-character tail is 100 B (5×20) despite only 4 directly-visible nonzero slots — one of the 4 real items is a "special" type pulling in one extra 20 B block via this recursive path |
| Since `charsave.py` zeroes all 23 slots, none of this fires on load — every `cmp word[ebp],0` check takes the "don't touch the file cursor" branch | Symmetric skip logic confirmed on both sides: `0x401c49 test dx,dx / je 0x401c94` (save), `0x4264c3 cmp word[ebp],0 / je 0x42651e` (load) |

**The bug:** a previous version of `charsave.py` always emitted a fixed
270-byte record (170 B base + a 100-byte zeroed tail), reasoning from
§"8"'s own flagged uncertainty ("possibly variable-length coincidence, not
a confirmed fixed stride") that `char1.dat`'s measured 270 B stride meant
a fixed on-disk record size. It doesn't — the loader's real cursor advance
for an all-zero record is 170 B. Writing 270 B left a 100-byte gap the
loader's cursor never crosses, so character 1's "core" copy actually reads
from file offset `380` (100 B into character 0's zero-padded tail)
instead of `480` (character 1's real start) — and the same desync compounds
for characters 2 and 3. This is a completely different, and better,
explanation than a core-struct field-mapping error: it accounts for why
character 0 (Fighter) displayed at all (unaffected — no desync until after
it) while the other three didn't come out as *garbage* so much as
*mirrored/stale* (consistent with reading zero-padded tail bytes and
misaligned headers rather than random memory).

**The fix**, in `scripts/bclib/charsave.py`:
- `CORE_LAYOUT`'s item-zero span widened from `(0x18, 0x40)` to
  `(ITEM_ARRAY_BASE, ITEM_ARRAY_END)` = `(0x14, 0x42)` (46 B, 23 slots),
  matching the disassembly-confirmed real array exactly.
- `DOS_TAIL_BYTES` changed from a fixed `100` to `0`; `DOS_RECORD_BYTES`
  is now `RECORD_HEADER_BYTES + CORE_BYTES` = 170, computed, not a magic
  270. `build_dos_record` asserts this invariant so a future change can't
  silently reintroduce a nonzero tail without updating the assert.
- The old `ITEM_SLOT_BASE`/`ITEM_SLOT_STRIDE`/`ITEM_SLOT_COUNT` constants
  are kept (still used only informationally, to extract `item_ids` from
  the parsed Amiga source for logging — never written to DOS output) but
  now documented as unverified/superseded for the DOS-side write path.

**Verification:** a from-scratch simulator of `fcn.00426390`'s exact
per-character algorithm (168-byte block read at `rec+0`, name checked at
block-relative `+2`, all 23 item-array slots checked for zero at
block-relative `0x16`-`0x44`) was run against the fixed converter's output
for both `1/CHARACTERSA` (fresh save) and the real end-game target
(`2/BlackCrypt/CHARACTERSA`). Result for both: **all 4 characters resolve
their correct class name at the correct simulated cursor position, zero
nonzero item slots (no desync), and the file ends exactly at the map-
offset-table + terminator boundary** — `210 + 4×170 + 52 + 52 + 2 = 996`
bytes total (down from the old, buggy 1,396-byte output). The map-offset
table decodes to the same already-triple-confirmed 13 values
(`0, 15047, 34766, ..., 165686`), and current-map still correctly reads
`13` for the end-game target.

#### Bug 2: the empty map — confirmed as the position gap, and fixed

**Confirmed.** `charsave.py`'s own docstring already flagged this as an
open gap: position/facing/turn-counter were left at `char1.dat`'s own
fresh-map-1 defaults (X=8, Y=21, facing=0/North), since no per-field byte
offset had been pinned. This session pinned all three, and confirmed the
map-1 default is genuinely invalid once carried over to map 13.

**Pinning X/Y/facing's byte offsets.** The same 17-write sequence in
`fcn.00401b80` (`0x401d21`-`0x401e9b`) that §"8" used to pin "current map"
at party-scalar-block offset `+18` was re-walked for its other writes,
cross-referenced against this doc's own **already-confirmed** globals from
a completely unrelated investigation (§"Party position and facing need no
new code", above): `fcn.00410d10`/`MoveParty` pass `&word[0x46f880]` (X),
`&word[0x46f87e]` (Y), `&word[0x46bd60]` (facing). Those three globals are
writes 3, 4, and 5 of the same 17-write sequence, landing at party-scalar
relative offsets **6, 8, and 10** — and this lines up exactly with write 9
landing at the already-independently-confirmed offset 18 (current map),
giving two independent confirmations of the same write sequence's byte
math agreeing.

**Confirming the position is really invalid for map 13.** Using
`scripts/bclib/bcdfs.py` against the real `data/blackcrypt/amiga/bcdfs`
file (13 real maps, no live emulator needed): map 13's sparse square data
has 134 populated cells, row range 1-21, col range 7-17. `char1.dat`'s
default (X=8, Y=21) — checked as both `(row, col) = (21, 8)` and `(8,
21)`, to rule out an axis-order mistake — **is not a populated cell under
either ordering.** The `@seer/dungeon` package's own confirmed convention
(`packages/dungeon/src/model/FlatGridLevel.ts`: "row is y, col is x")
puts it just one column outside map 13's real walkable area near that row
(row 21's real data starts at column 9, not 8). Landing on an unpopulated
cell in the shared runtime 64×64 array — which, per this doc's own
"automap tilemap" finding above, is otherwise-unwritten memory — produces
a real `wall_flags` nibble of `0` (no walls recorded) rather than actual
wall data, which is exactly consistent with the live-observed symptom
("floor and ceiling only, no walls in any direction"): floor/ceiling are
unconditional static draws, walls only render if a wall bit is set. (The
project's own *web-renderer* densifier, `scripts/export_dungeon_levels.py`,
defensively fills unpopulated cells as "walled on every side" for its own
unrelated purpose of keeping the browser renderer safe — that convention
doesn't apply to the real DOS engine's own runtime array, which is what
matters here.)

**The fix:** `scripts/bclib/charsave.py` gained `_pick_start_cell(map_number,
bcdfs_path=None)`, which walks the target map's real `bcdfs` data (lazily
importing `bclib.bcdfs`, the project's existing shared decoder) and picks
the real, populated, non-wall-type square closest to the centroid of all
such squares on that map — a simple, deterministic "somewhere in the
middle of the level" heuristic, **not** the game's own real intended
entrance (that logic wasn't traced this session; just guaranteed-real,
walkable geometry instead of a map-1-shaped guess). `build_dos_save` now
calls this whenever the source save's current map isn't 1 (map 1 keeps
`char1.dat`'s own default verbatim — it's the DOS demo's real, live-tested
entrance, strictly better than any heuristic pick) and overrides X, Y, and
facing (set to North) in the party-scalar block. For the real end-game
target (`2/BlackCrypt/CHARACTERSA`, current map 13), this picks
**(X=12, Y=12)** — confirmed via `bcdfs.py` to be a real, populated,
fully-open (`wall_flags=0`, type=floor) square inside map 13's real
central hall.

#### Both fixes, one re-converted output

Both fixes landed in the same `scripts/bclib/charsave.py` and were applied
together in a single re-conversion of the same target save
(`2/BlackCrypt/CHARACTERSA`). Result: **996-byte output** (vs. the old
1,396-byte one), current map `13`, party position `(12, 12)` facing north,
all 4 characters' names/classes/confirmed-core-fields intact, and a
from-scratch loader simulation confirms zero desync across all 4
characters plus a byte-exact map-offset table. Copied to the project
owner's existing live-test package
(`bc-test-package/char4.dat`, outside the repo, never committed),
overwriting the previous (buggy) `char4.dat` used in the crash test in
§"9" above.

**Live re-verification: not performed this session** — same
input-automation tooling gap flagged in §"9" (no `xdotool`/`ydotool`/`xte`
available to drive Wine's menus). Both fixes are verified by disassembly
(instruction-by-instruction on both save and load code paths) and by a
from-scratch simulator of the loader's own exact algorithm against the
real converter output — the same evidence bar as every other "confirmed"
finding in this Phase — but the final "does it now actually display 4
distinct characters and real map-13 geometry" confirmation needs a human
at the keyboard, or future input-automation tooling.

---

## Phase 7 — title screen credit — **DONE**

Separate from the six phases above, and in the same spirit as Phase 5: the
demo's title screen overlays a short credit line, `"PC CRYPT V1.0 BY RICK
JOHNSON!"`, on top of its logo art. This phase traces exactly how that line
is drawn and adds a second one, about this repo's own restoration work,
without touching the game's own art, the real Raven Software credits, or
Rick Johnson's own credit.

### 7.1 The mechanism

`fcn.0040b970` (called once, from the resource-directory build routine
`fcn.0040bbe0` at `0x40c1f5`) is the entire pre-game title sequence: four
full-screen `320x200` `clipper.clp` bitmaps shown in a row, each resolved
by name (`fcn.00402650`) and blitted, then made visible either by
`fcn.00403d20()` or, for one screen only, `fcn.00408120(0, 320, 200)`
(traced by disassembly: it Locks two directory-indexed surfaces and
byte-copies 200 rows across 4 bands — a real, full 320x200 present, not a
partial one). Decoding the four bitmaps (`scripts/extract_clipper.py`,
ad hoc render) identifies what each screen actually is:

| Order | Clip name | Wait | Content |
|---|---|---|---|
| 1 | `"Title 4"` | 350 ticks | The real Raven Software credits (DESIGN/GRAPHICS/MUSIC/PROGRAMMING/SOUND, real names) |
| 2 | `"Title 1"` | 100 ticks | The gargoyle-temple background, **no** "BLACK CRYPT" wordmark yet |
| 3 | `"Title 2"` | 400 ticks | The same background **with** the wordmark — this is where the existing Rick Johnson credit is drawn |
| 4 | `"Title 3"` | until keypress | The game's premise blurb + item icons, plus a runtime-built string (blank in this demo build's static bytes) |

**The existing credit** is drawn by `fcn.0040c9b0(stringPtr, styleArg,
widthArg)`, called once during Title 2's block (`0x40ba9a`-`0x40baa3`,
args `(str.PC_CRYPT_..., 1, 0x24)`) *before* Title 2's own background
blit — safe, because (per the trace below) the credit renders at a row the
background blit never touches.

`fcn.0040c9b0` (392 B, traced instruction-by-instruction, not guessed):

- Computes `strlen` via `repne scasb`, then the glyph loop's starting X as
  `esi = (40 - strlen) * 4` — the standard centering formula for a 320 px
  wide, 8-px-per-glyph line (`(320 - strlen*8) / 2`, refactored). This is a
  **real, code-derived width constraint**: the line only stays on-screen
  for `strlen <= 40`. The existing credit is 31 chars (9 of that 40-char
  budget spare, `(40-31)*4 = 36 px` start offset) — confirming the task's
  own framing that a static centered line has much less headroom than a
  scrolling marquee would.
- Per character, glyph index = `charCode - 0x20`, bounds-checked
  (`0x40ca90`: `cmp ax, word[edx*4+0x43c7b0]; jg <skip, don't draw>`)
  against the **`"Scroll Font 1"`** clipper entry's own declared height
  field. Confirmed directly from `clipper.clp`: entry 128, `"Scroll Font
  1"`, type 2, `8x472` px → `472/8 = 59` glyph slots → valid chars are
  exactly `0x20` (space) through `0x5A` (`'Z'`) — space, digits, most
  ASCII punctuation, and uppercase A-Z, **no lowercase**. This matches the
  existing credit's own ALL-CAPS style exactly and is why "Scroll Font"'s
  name is misleading for this call site: nothing here actually scrolls or
  animates — it's a single static line, drawn once, held for the rest of
  Title 2's on-screen duration. (The font strip is presumably also used
  for a genuinely scrolling end-game credits sequence elsewhere in the
  full game, not exercised by this demo build — out of scope here.)
- Every character blits an 8x8 slice of the font strip to a **hardcoded
  destination row, `y = 0xdd` (221)** — a literal inside `fcn.0040c9b0`'s
  own body (`push 0xdd` at `0x40cad2`), identical for every caller, *not*
  a parameter. Confirmed via the file's established `(this, x, y, srcSurf,
  srcRect, flags)` Blit calling convention (cross-checked against the
  known-correct Title-N background blit, which uses `x=0, y=0` for a
  full-screen backdrop). Since `y` is compiled in, a *second* credit
  sharing Title 2's own row would need either patching `fcn.0040c9b0`
  itself (touching the one existing, proven-working credit) or a full
  near-duplicate of a 392-byte function — both worse than using one of the
  three other title screens, which have nothing drawn at that row at all.

### 7.2 Feasibility — slack space, checked fresh

Same standard as Phase 4/5: searched for large all-zero runs, then
required each candidate to have **zero** dwords anywhere in the whole
253,952-byte file decoding as a pointer into it — a fresh file-wide scan
for *this* patch, not inherited from Phase 4/5's own findings, since those
two patches already consumed part of the same shared cave.

- **Code**: the same `.text` cave Phase 4/5 use (`0x42DEB3`-`0x42E000`,
  333 B) has **237 B free** after Phase 4's 22-byte thunk and Phase 5's
  74-byte DlgProc+thunk (`0x2DEB3`+22+74 = `0x2DF13` onward) — freshly
  confirmed all-zero in the real, unmodified `crypt.exe`, not assumed.
  This patch's cave is 47 B, comfortably inside with 190 B to spare.
- **String data**: `.rdata`'s unused tail, `0x42F2D9`-`0x430000`
  (3,367 B), of which Phase 5 uses the first 695 B. This patch places its
  string at `0x42F600` — 112 B clear of Phase 5's own end, 2,560 B still
  free afterward.
- A fresh file-wide dword scan for pointers into either target region (the
  47-byte cave slice, the 40-byte string slice) found **zero** hits in
  both, run independently of and in addition to the all-zero check.

**Composability, checked, not assumed:** this patch's hook, cave and
string windows are fully disjoint from both `patch_crypt_exe.py` (Phase 4:
`fcn.00423b50` + `0x2DEB3`-`0x2DEC9`) and
`patch_crypt_exe_add_restoration_note.py` (Phase 5: `0x41361B` +
`0x2DEC9`-`0x2DF13` + `0x2F2D9`-`0x42F590`), so it applies cleanly to a
stock `crypt.exe`, one already patched by Phase 4 alone, or one patched by
both Phase 4 and Phase 5. **One real ordering constraint exists, inherited
from Phase 5's own precondition, not introduced by this patch:** Phase 5's
pre-flight check requires its entire 311-byte cave remainder to read
all-zero — which includes the 47 bytes this patch writes — so if this
patch runs *before* Phase 5, Phase 5's own guard will (correctly) refuse
to run afterward. Confirmed empirically, not just reasoned about: applying
this patch to a stock file, then attempting Phase 5 on the result, fails
cleanly with Phase 5's own "cave remainder is not all-zero" error, no
corruption. **Apply Phase 5 before this patch if both are wanted.**

### 7.3 The patch

`fcn.0040b970`'s Title 1 block ends with
`fcn.0040aaf0(3, 1); wait-100-ticks`. The `call fcn.0040aaf0` at `0x40ba6a`
(5 B: `e8 81 f0 ff ff`, confirmed by direct byte read against the real
file, not assumed) is stolen and replaced with a 5-byte `jmp rel32` to a
47-byte cave (`0x42DF13`) that:

1. Re-executes the exact stolen call (`call 0x40aaf0`) — its args were
   already pushed by the two instructions immediately before the hook and
   are untouched by the jump.
2. Draws the new credit exactly the way Title 2's own credit is drawn:
   `fcn.0040c9b0(newStr, 1, 0x24)` — identical `arg2`/`arg3` to the
   proven-working call, differing only in the string pointer.
3. Presents it with the same routine already proven to make a
   `fcn.0040c9b0`-drawn credit visible: `fcn.00408120(0, 320, 200)`, Title
   2's own "make visible" call. Title 1 normally uses the plainer
   `fcn.00403d20()` instead, which is left completely untouched and still
   runs immediately before the hook fires — so Title 1's picture displays
   exactly as before for one instant, then the new credit is drawn and an
   extra, harmless present makes it visible too.
4. Jumps back to `0x40ba6f` (`push 1`, the original next instruction —
   Title 1's own 100-tick wait loop), resuming unmodified code.

Both `fcn.0040c9b0` and `fcn.00408120` end in a bare `ret` (confirmed by
disassembly of both functions' epilogues, not assumed) — cdecl, caller
cleans the stack — so the cave explicitly balances its own two calls with
`add esp, 0xc` each, rather than relying on the surrounding function's own
deferred/batched stack cleanup (which exists only for the original,
untouched instructions and must not be disturbed).

**Deliverable:** `scripts/patch_crypt_exe_add_title_credit.py`, matching
`patch_crypt_exe.py`/`patch_crypt_exe_add_restoration_note.py`'s exact
shape (module-level byte constants with `assert` cross-checks on every
`push`/`jmp`/`call` operand, a `patch()`/`_self_check()` pair, refuses
in-place patching, refuses to overwrite `--output` without `--force`).
All bytes assembled with `rasm2 -a x86 -b32 -s <addr> '<insn>'`, never
hand-computed.

### 7.4 Verification performed

Against the real, unmodified `data/blackcrypt/dosvga/crypt.exe`, patched
only into scratch copies (the real file was never written to — confirmed:
its md5sum is unchanged across every run below):

| Check | Result |
|---|---|
| Round-trip `r2` disassembly of the hook | `jmp 0x42df13`, falling through at the resume address to the original, unmodified `push 1` |
| Round-trip `r2` disassembly of the cave | All 12 intended instructions decode back exactly as written: `call 0x40aaf0`, `push 0x24`, `push 1`, `push str.FAN_RESTORATION_AT_CRAWL.SHAID.NET` (r2 auto-recognised and printed the embedded string), `call 0x40c9b0`, `add esp,0xc`, `push 0xc8`, `push 0x140`, `push 0`, `call 0x408120`, `add esp,0xc`, `jmp 0x40ba6f` |
| String bytes | `FAN RESTORATION AT CRAWL.SHAID.NET\0` at file+`0x2f600`, byte-exact |
| Full-file byte diff, patched-alone vs. original | Exactly **78** changed bytes, all inside the three declared windows (5 hook + 47 cave, several of whose bytes coincidentally equal the pre-existing `0x00` + 34 string bytes); **0** differences anywhere else in the 253,952-byte file |
| Composability: stock → this patch alone | Succeeds, self-check passes |
| Composability: Phase 4 → Phase 5 → this patch | Succeeds, self-check passes at every step |
| Composability: Phase 4 → this patch (Phase 5 skipped) | Succeeds, self-check passes |
| Composability: this patch → Phase 5 (wrong order) | **Fails cleanly**, Phase 5's own pre-flight guard reports "cave remainder is not all-zero", no corruption — confirms the documented ordering constraint empirically rather than just by inspection |
| Pre-flight guards actually fire | Confirmed the patcher refuses in-place patching, refuses to overwrite an existing output without `--force`, and refuses a `crypt.exe` whose hook/cave/string-region bytes don't match the expected stock shape |

This meets the same bar as every other "confirmed" claim in this plan: a
byte-exact structural check (the full-file diff) plus an independent
disassembly pass (not just the patcher's own self-check), not a spot-check
or a "looks right".

**Not done, same scope boundary as Phase 4/5:** live Wine/screenshot
confirmation that the second credit line actually renders on screen. The
credit's placement is *derived from*, not merely modeled after, the one
credit line already known to render correctly in the shipped game — same
row (`y=0xdd`), same draw routine (`fcn.0040c9b0`, byte-identical
`arg2`/`arg3`), same present routine (`fcn.00408120`, identical
arguments), same font, same centering formula, same character-set
constraint. Static, byte-exact verification is this project's established
bar for code patches (Phase 4/5 shipped on that same basis, and §1C's
still-open DirectDraw/Wine presentation issue remains the blocker for any
live capture, unchanged by this phase).

### 7.5 The drafted text

`"FAN RESTORATION AT CRAWL.SHAID.NET"` — 34 characters, all-caps,
space/letters/period only (every character class already proven safe by
the existing, shipped "PC CRYPT V1.0 BY RICK JOHNSON!" credit, which also
uses space, letters and a period). Centered start offset
`(40-34)*4 = 24 px` from each edge — comfortable margin, well clear of the
`strlen<=40` overflow bound derived above. Deliberately terse (a
title-screen credit line has no room for prose) and deliberately *not*
claiming official status, Rick Johnson's authorship, or Raven/Activision
affiliation — "fan restoration" reads as exactly what it is, the same
posture Phase 5's dialog page already takes at greater length.
`crawl.shaid.net` is this project's own real, already-deployed docs site,
the same URL Phase 5 uses.

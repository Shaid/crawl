# Treasures of the Savage Frontier (Amiga) — data structure reference

SSI Gold Box engine, Amiga port, 1992. Sixth sibling GLIB-format title
staged in this repo (alongside Curse of the Azure Bonds, Secret of the
Silver Blades, Pools of Darkness, The Dark Queen of Krynn, and Gateway to
the Savage Frontier — its own direct predecessor). Real title confirmed
from the WHDLoad rip's own `ReadMe`/`.info` files: "Treasures of the Savage
Frontier".

Container format: **`docs/goldbox-glib-format.md`** (shared by every GLIB
title — read that doc first; this page covers only what's specific to this
title). Implementation: `tools/shared/goldbox-glib.ts` (container),
`tools/shared/goldbox-walltiles.ts` (wall geometry + tile decode),
`tools/shared/goldbox-geo.ts` (GEO), `tools/shared/goldbox-ecl.ts` (ECL
bytecode VM). Extractor:
`tools/treasureofthesavagefrontier/amiga/export-data.ts`. Session history
and open items: `docs/treasureofthesavagefrontier/TODO.md`.

Raw data: `data/ssi/TreasureSavageFrontNTSC/data/diska`, `.../diskb`,
`.../DiskC` (a WHDLoad-staged install; `.Slave`/`.info` files and
`Docs/`/`Journal`/`ReadMe`/`Solution` content are out of scope per this
pass's task).

---

## 1. Container — CONFIRMED, 25/25 real GLIB files, no top-level compression

All 25 `.GLB`/`.TLB` files across the 3 disks parse as the standard GLIB
container (`docs/goldbox-glib-format.md` §1-§2) with zero deviation
(`container-directory.json`'s `structurallyOk: 25`, `0`
top-level-compressed, `0` truncated).

## 2. `WALLDEF.GLB` and 8x8 tile bank — CONFIRMED, byte-for-byte identical scheme

`DiskC/walls.tlb` is this title's `WALLDEF.GLB`-equivalent — same 156-byte
wall-slice/10-view geometry, confirmed via the exact-multiple-of-156
byte-length check (`walldef-geometry.json` reports `allMultipleOf156:
true`). Tile banks: `diska/Walls.tlb` for the flat universal+specific
scheme (scheme 1), paired with `DiskC/walls.tlb`'s own per-wall-id nested
buckets for scheme 2, using the same `decodeGlibTileBucket` +
`buildWallSpecificTileBank` machinery every sibling title reuses unmodified.

**Rendered output**: 60 scheme-1 PNGs and 60 scheme-2 PNGs, **0 skipped in
either scheme** — every WALLDEF entry in this title has a matching
scheme-2 bucket, unlike Gateway's 30 misses. Visually inspected (4x
nearest-neighbor upscale): `walldef2-13-wall0-view6.png` shows a distinct
gate/opening-shaped feature; `walldef2-2-wall0-view6.png` shows a clean
repeating vertical-column pattern; `walldef2-2-wall3-view6.png` shows an
arched/doorway motif with fine detail — all non-degenerate and consistent
with the established Gold Box wall-art visual grammar.

## 3. `GEO.GLB` — CONFIRMED, standard fixed 1024-byte/16x16 shape, 41/41 levels

`diskb/geo.glb` decodes with the standard fixed-size decoder unchanged — no
variable-size adaptation needed (unlike The Dark Queen of Krynn) — 41/41
levels, zero deviation. This is the largest level count of any GLIB title
in this corpus.

## 4. `ECL.GLB` — SOLVED (2026-09-01, `re-oracle` escalation, independently re-verified against real bytes): new opcode table + a real "the ECL isn't the authority" finding

`diskb/ecl.glb` decodes as a standard GLIB container (**30 blocks**, not
41 — 41 is `geo.glb`'s own entry count; ECL block id equals geo id for
`16`-`40`/`47`/`49`-`51`, block `4` is a game-start script, and block `29`
also manages geo `48`). Unlike every other GLIB title's `ECL.GLB`, this
title's blocks each carry a **constant 2-byte `0x8813` prefix tag** before
the real bytecode stream starts — identical in both VALUE and ROLE to Pool
of Radiance's own `.dax`-family `ecl.dax`/`geo.dax` block prefix
(`docs/goldbox-glib-format.md` §7.4's container bullet), the first GLIB
title observed to carry it. Stripping it (`eclBlockPrefixLength: 2`) is
necessary but was not sufficient on its own.

**The real opcode table is `OPCODE_TABLE_TREASURE_V13X`** (`tools/shared/
goldbox-ecl.ts`): Pools of Darkness's v1.3 table (`OPCODE_TABLE_POOLS_V13`)
with every one of its deltas applying verbatim, plus three new opcodes —
`0x42` ("LOAD AREA", 4 operands `(geoId, slot1, slot2, slot3)` — this
title's wallset-load call, replacing v1.3's `0x21` remap), `0x43` ("NPC
SEARCH BY ATTRIBUTES", 4 operands, unrelated to wallsets), and `0x44` (4
operands, engine-registered but 0 occurrences in this corpus). Confirmed
via a headless-Ghidra disassembly of this title's own AmigaOS executable
(`data/ssi/TreasureSavageFrontNTSC/data/Treasure`, no symbol table) —
operand counts read directly from the executable's own `SkipNextCommand`
size-dispatch table (69 entries, `0x00`-`0x44`), not guessed. **Result: 0
unknown opcodes / 0 desyncs across all 30,338 visited instructions in the
full corpus-wide reachability walk (30 blocks)** — re-run independently
against real bytes this session (not just taken on the escalation's
report), reproducing its number exactly.

**The bigger finding: for dungeon geos (ids 16-50), the ECL bytecode's own
wallset operands are DEAD DATA.** Both `0x21` and the new `0x42` call a
shared `getAreaWallsets(geoId, &slots)` routine which, for any `geoId` in
`[16,50]`, unconditionally OVERWRITES all 3 slot bytes with a hardcoded,
per-geo constant from a 35-entry jump table baked into the executable —
before `LoadWalldef` ever sees the ECL-supplied values. This is presumably
leftover DOS-build data the Amiga port's engine silently ignores (e.g. geo
23's ECL leaves slot3 as the "don't touch" sentinel `0xff`, but its GEO
grid needs slot 3 — the executable's own table supplies a real id there).
**No opcode-table fix alone could ever have produced this title's real
bindings from ECL bytecode** — the executable-derived table
(`TREASURE_EXE_WALLSETS` in `goldbox-ecl.ts`) is the actual authority,
wired in as a `wallsetOverride` that replaces whatever ECL resolution finds
for those 29 geo ids.

**Verification, independently re-run this session**: `TREASURE_EXE_WALLSETS`'s
87 raw values (29 geos x 3 slots), after `LoadWalldef`'s own confirmed
`id===15 -> 32` remap, land **87/87 inside `WallDef.glb`'s real directory**
`{2,4,5,6,7,8,9,13,30,31,32,36}` — 0 deviations — and every one of the 11
geos whose own GEO grid uses a slot-2/slot-3 wall type has a real id
resolved in that slot (no gap where one was needed). The extractor's actual
run confirms this exactly: **ECL bytecode alone now resolves 24/41 levels
(72 slots)** with the corrected table, and the `wallsetOverride` then
**replaces 29/41 levels (87 slots)** with the executable-derived table —
29 is exactly the count of this corpus's GEO ids that fall in the
executable's `[16,50]` table range (`16`-`40` plus `47`-`50`; ids `51`-`62`
are wilderness and outside the table, see below).

**Verified resolved-cell example** (level 16, `wallsetBinding = {slot1: 9,
slot2: 4, slot3: 32}`): cell `(0,0)` facing North has wall type `1` ->
`(slot 0, slice 0)` -> `slot1` = flat id `9` -> WALLDEF id `9`, wallset
index `0` -> `walldef2-9-wall0-view6.png` — visually inspected (4x
nearest-neighbor upscale), a clean, structured, non-degenerate wall-panel
render.

**Wilderness geos `51`-`62` — CONFIRMED via disassembly (2026-09-01,
`amiga-disasm` pass) that no executable-hardcoded wallset table exists for
them at all**, not merely that they fall outside the 16-50 span. Tracing
`getAreaWallsets` (flat/CODE address `0x28798`, file offset `0x14B24`, CODE
hunk 15 hunk-relative `0xCD8`) end to end: its own range check
(`subi.w #0x10,D0w` / `cmpi.w #0x23,D0w` / `bcc.b <noop>`, i.e.
`geoId-16 >= 35`) sends any `geoId >= 51` straight past the 35-entry jump
table to a shared `movem.l (SP)+,{A2} / rts` — the SAME no-op target the
in-range-but-unused ids 41-46 hit. All 29 real jump-table entries were
decoded and match `TREASURE_EXE_WALLSETS` byte-exact (0 deviations),
confirming this is the routine's complete, literal behavior, not a partial
reading. For geo ids 51-62 the 3 wallset-slot bytes are simply left as the
caller last wrote them — hub block 51's own `LOAD FILES` passes the geo id
itself through as a slot value, which `LoadWalldef` then fails to resolve
against `WallDef.glb` (a real engine no-op path, confirmed, not a decode
gap).

A whole-executable ASCII string scan found zero filename references
anywhere (no `"WALLDEF"`, `"Sky.tlb"`, `"wildcom"`, `"randcom"` string
exists — this engine resolves resources by numeric ECL id through an
external table, not embedded name strings), so the executable alone can't
name wilderness's real art source. Direct byte inspection of
`diska/Sky.tlb` (3,791 B), `diska/wildcom.tlb` (12,668 B), and
`diska/randcom.tlb` (2,684 B) confirms all three ARE real, well-formed
`GLIB` containers with `TILE`-tagged sub-blocks (3/34/6 blocks
respectively) — the same shape as this title's own working
`diska/Walls.tlb` — strong circumstantial evidence for a separate,
non-WALLDEF overland sky/terrain/random-encounter renderer.

> **Correction (2026-09-02, `amiga-disasm` pass, independently re-verified
> against real bytes this session): the real overland renderer's SELECTOR
> mechanism is now CONFIRMED, and it fully explains why every prior static
> search for a consumer of these 3 files came back empty.** There is a
> FOURTH file in this family this doc hadn't previously named:
> `diska/dungcom.tlb` (found this session, real, on disk, same GLIB shape
> as the other three).
>
> **The executable is a 7-segment AmigaOS `HUNK_OVERLAY`-linked binary**
> (1 resident root + 6 on-demand overlay segments) — confirmed by a raw
> scan of the whole 319,476-byte (`0x4DFF4`) file for
> `HUNK_HEADER`(`0x3F3`) magic at every overlay boundary: root header at
> file `0x0`; overlay headers at file `0x39494`, `0x3A354`, `0x4281C`,
> `0x45350`, `0x4ACD0`, `0x4DBCC` (independently re-verified this session —
> every cited offset's leading longword is `0x3F3`, and the file size
> matches exactly). **Every disassembly this project has done on this
> executable, including the `getAreaWallsets`/`LoadWalldef` trace above,
> covers only the resident root segment** (file `0x0`-`~0x393C8`) — this is
> the root cause every prior static-string and call-graph search dead-
> ended: the wilderness/overland loading code genuinely isn't THERE.
>
> The bare basenames `"Sky"` (no `.tlb` extension, file `0x3A042`, inside
> overlay #1) and `"DungCom"`/`"WildCom"`/`"RandCom"` (file `0x3C416`/
> `0x3C41E`/`0x3C426`, consecutive, inside overlay #2) are embedded as
> literal strings — an exact 1:1 match (modulo the missing extension) to
> the 4 real on-disk files `Sky.tlb`/`dungcom.tlb`/`wildcom.tlb`/
> `randcom.tlb`. This is why the earlier "zero filename references
> anywhere" finding, while an accurate description of the literal string
> `"Sky.tlb"` (with extension), was incomplete: the extension is
> synthesized at runtime by a confirmed generic resident helper
> (`TlbOpener_guess`, flat `0x26D24`-`0x26F0E`, file offset `0x130A0`, root
> CODE hunk 13 — builds names via `sprintf(buf,"%s.tlb",name)`, format
> string at file `0x1329E`; 2 confirmed resident callers, `"BigPic1"` and
> `"map"`, both unrelated to wilderness) — only the bare name is stored,
> and for these 4 resources the bare name lives in a non-resident overlay
> a plain whole-file string search still finds (strings don't care about
> hunk boundaries) but a call-graph trace rooted in resident code cannot
> reach.
>
> **The actual dungeon/wilderness SELECTOR, inside overlay #2 (file
> `0x3C350`-`0x3C414`, runtime `0x51FE0`-`0x5204A`), is fully disassembled
> and independently re-verified byte-exact against the raw file this
> session:**
>
> ```
> movea.l (-0x2a5a,A4),A0      ; the SAME "current area" global LoadWalldef_guess tests
> tst.w   (0x80,A0)            ; dungeon/wilderness flag, offset 0x80 of the area descriptor
> bne.b   ->WildCom-branch
>   ; dungeon: push 0x19,0,1 ; pea "DungCom"(pc) ; jsr (-0x797a,A4)
>   ; bra ->RandCom
> WildCom-branch:
>   ; push 0x21,0,1 ; pea "WildCom"(pc) ; jsr (-0x797a,A4)
> RandCom: (unconditional, both paths)
>   push 6,0x22,1 ; pea "RandCom"(pc) ; jsr (-0x797a,A4)
> ```
>
> i.e. offset `0x80` of the current-area descriptor is a real, confirmed
> dungeon(`0`)/wilderness(nonzero) flag, tested by BOTH the resident
> `LoadWalldef_guess` and this overlay routine — this overlay registers
> "DungCom" or "WildCom" as the active area-command resource name
> depending on it, and ALWAYS additionally registers "RandCom" (random
> encounters apply to both area types).
>
> **Where this goes cold, confirmed as a real dead end, not an
> unfinished trace**: the shared registration call (`jsr (-0x797a,A4)`)
> resolves through a small-data trampoline slot at DATA-hunk file offset
> `0x9D8`, whose ON-DISK bytes are `4E F9 00 00 00 00` — an **unpatched
> `JMP.L $0`** (independently re-verified byte-exact this session). This
> proves the real callee — the function that would actually turn a
> "DungCom"/"WildCom" registration into pixels — is ITSELF overlay-
> resident code, patched into this trampoline slot only when AmigaOS's
> overlay manager loads the relevant segment at runtime. It cannot be
> named or its behavior determined by any further static analysis of the
> flat executable file. The root's own `HUNK_OVERLAY` control table (file
> `0x24D4`, 4148 bytes) was inspected — it's a monotonic sequence of small
> ascending values consistent with an internal symbol-name-pool offset
> table, but the `HUNK_OVERLAY` record format is linker-private with no
> published spec (confirmed via `WebSearch` against the AmigaOS Hunk
> format references), and no value in it could be correlated against any
> of the known overlay file offsets, the trampoline's own address, or the
> trampoline's displacement constant — a further overlay-manager-internals
> reverse-engineering effort, not a data-format question this project's
> usual toolkit can make progress on.
>
> **Net result**: the wilderness/overland renderer's SELECTION mechanism
> (a per-area dungeon/wilderness flag gating which of 2 overlay-resident
> "area-command" modules loads, with a 3rd always loading for random
> encounters) is now CONFIRMED, and the reason it's unreachable from
> resident code is now explained and confirmed, not just observed. What
> remains genuinely open — and is NOT resolvable by further static
> analysis of this flat file — is what the overlay-resident module
> actually DOES with `Sky.tlb`/`dungcom.tlb`/`wildcom.tlb`/`randcom.tlb`
> once loaded (first-person wall compositing like the dungeon renderer, a
> scrolling top-down overworld map, or something else). Resolving that
> would need either the AmigaOS overlay manager's private patch mechanism
> (no public spec found) or a live emulator capture — the latter requires
> explicit user permission per this project's standing amiberry policy and
> was not attempted this session.

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Apply the v1.1 opcode table unchanged, no prefix strip (the Gateway/Curse/Secret/PoR recipe) | Immediate desync, near-0% resolution | This title's blocks carry a leading 2-byte tag the others don't |
| Strip the 2-byte `0x8813` prefix, then apply the v1.1 table | Individual block headers and short hand-traces decode cleanly; but a full corpus-wide reachability walk still desyncs on ~10% of visited opcodes, 1/41 levels resolved (that one resolution's slot value is implausible, `33104`) | Short traces don't exercise every opcode a real reachability walk visits — the real mismatch was only visible at full-corpus scale |
| Strip the prefix, apply the v1.3 table (`OPCODE_TABLE_POOLS_V13`) WITHOUT re-checking for title-specific opcode additions | (per the `re-oracle` escalation's own report) tried without the strip initially, isolating the residue to opcodes `0x42`/`0x43` only once combined with the strip | Two genuinely different hypotheses (table alone, prefix alone) had already failed by the time this was tried; escalating was the right call once both were exhausted |
| Escalated to `re-oracle` (2026-09-01): 2 distinct failed hypotheses (table swap alone; prefix strip alone) met the escalation bar | **SOLVED** — prefix strip + `OPCODE_TABLE_TREASURE_V13X` (v1.3 + `0x42`/`0x43`/`0x44`, all 4-operand) gives 0 unknown/0 desync corpus-wide (30,338 instructions, 30 blocks); confirmed via headless-Ghidra disassembly of the real executable, not guessed | Independently re-verified this session against real bytes (identical numbers reproduced) |
| Assume ECL bytecode operands ARE the wallset-binding authority once the opcode table is fixed | ECL-alone resolution (24/41 levels, 72 slots) leaves several dungeon levels with implausible/sentinel slot values | The Amiga port's `getAreaWallsets` unconditionally overwrites ECL's own slot bytes for geo ids 16-50 from a hardcoded executable table — confirmed via disassembly, not a decode bug. `wallsetOverride` (29/41 levels, 87 slots) is the real fix, independently re-verified 87/87 against `WallDef.glb`'s own directory |
| Disassemble `getAreaWallsets` end-to-end (`amiga-disasm` pass, 2026-09-01) looking for a second table/branch covering wilderness geos 51-62 | **Definitively refuted, not just "not found"**: the function's own range check (`geoId-16 >= 35`) branches any `geoId >= 51` straight to the same no-op `rts` unused in-range ids (41-46) hit — no second table, no alternate code path, slot bytes simply left as the caller wrote them | Confirms wilderness IDs are outside this mechanism entirely, not merely outside one table's key range — see §4 correction above |
| Full-executable ASCII string scan for `"Sky.tlb"`/`"wildcom"`/`"randcom"`/`"WALLDEF"`/filename literals, to find the real overland-renderer's resource load site | Zero hits anywhere in the binary | This engine resolves resources by numeric ECL-declared id through an external table, not embedded filename strings — the executable alone can't name the consumer. `Sky.tlb`/`wildcom.tlb`/`randcom.tlb` were independently confirmed (by direct byte inspection, not disassembly) to be real, well-formed GLIB/TILE containers — strong circumstantial evidence a separate overland renderer exists, but its actual code path is still unlocated |
| Trace `LoadWalldef_guess`'s own callers exhaustively (small-data trampoline reloc walk) for a wilderness-reachable branch (`amiga-disasm` pass, 2026-09-02) | All 6 real callers are dungeon-only (2 ECL wallset-load opcode handlers + 1 wall-refresh loop) | `LoadWalldef`/`getAreaWallsets` live in the resident root segment and have no wilderness path at all — a real negative, not an incomplete trace |
| Raw scan of the whole 319,476-byte file for `HUNK_HEADER`/`HUNK_OVERLAY`/`HUNK_BREAK` magic | **Found the real cause**: this executable is a 7-segment `HUNK_OVERLAY`-linked binary (1 resident root + 6 on-demand overlays) — every prior disassembly covered only the resident root | Explains every previous dead end at once: the wilderness renderer isn't missing from the trace, it's in a segment no trace so far ever loaded |
| Bare-basename string search (no `.tlb` extension) across the WHOLE file, not just the resident root | `"Sky"`/`"DungCom"`/`"WildCom"`/`"RandCom"` each occur exactly once, all inside the 2 non-resident overlay segments; exact match to `Sky.tlb`/`dungcom.tlb` (a 4th real file, not previously catalogued)/`wildcom.tlb`/`randcom.tlb` | The earlier "zero filename references" search looked for the name WITH `.tlb` appended — the extension is synthesized at runtime by a confirmed generic `sprintf('%s.tlb',name)` helper (`TlbOpener_guess`), so only the bare name is ever stored |
| Disassemble the selector routine around the `"DungCom"/"WildCom"/"RandCom"` string table (overlay #2, file `0x3C350`-`0x3C414`) | **SOLVED**: a `tst.w (0x80,A0)` on the same "current area" global `LoadWalldef_guess` reads selects DungCom (0) vs WildCom (nonzero); RandCom always registers too — independently re-verified byte-exact against raw file bytes this session | Real, confirmed dungeon/wilderness flag and selector mechanism — see correction above |
| Resolve the shared registration call (`jsr (-0x797a,A4)`) and decode the root's `HUNK_OVERLAY` control table (file `0x24D4`) to pin the real consumer | Genuine dead end: the trampoline's on-disk bytes are an unpatched `4E F9 00 00 00 00` (confirmed byte-exact), and `HUNK_OVERLAY`'s record format has no public spec (confirmed via `WebSearch`) | The real callee is itself overlay-resident, patched in only at runtime by AmigaOS's overlay manager — not resolvable by further static analysis of the flat file; would need the private overlay-patch mechanism or a live capture |

## 5. Extractor and outputs

Run from the repo root:

```
npx tsx tools/treasureofthesavagefrontier/amiga/export-data.ts
```

(defaults to `data/ssi/TreasureSavageFrontNTSC/data`). Writes to
`public/assets/treasureofthesavagefrontier/amiga/`:

- `data/container-directory.json` — 25/25 GLIB files OK, 0
  top-level-compressed, 0 truncated.
- `data/walldef-geometry.json` — all entries confirmed multiples of 156.
- `textures/walldef-<id>-wall<n>-view6.png` — 60 scheme-1 renders (0
  skipped).
- `textures/walldef2-<id>-wall<n>-view6.png` — 60 scheme-2 renders (0
  skipped).
- `dungeon/level-<id>.json`, `dungeon/levels-index.json`,
  `dungeon/wall-index.json` — 41 decoded GEO levels; wallset bindings for
  29/41 levels (87 slots) from the executable-derived override table, plus
  24/41 (72 slots) from ECL bytecode directly where the override doesn't
  apply (wilderness geos `51`-`62` remain unresolved). The walker now
  renders real per-cell wall art for every dungeon level in this corpus.

## 6. Full file catalog — not attempted this pass

Per this task's scope, the remaining `.GLB`/`.TLB` files' semantic content
(items, monsters, sprites, portraits, dungeon commands, strings, sounds) is
NOT catalogued — only the outer GLIB container structure is validated (§1).
See `docs/treasureofthesavagefrontier/TODO.md`.

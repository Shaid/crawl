# Death Knights of Krynn (Amiga) — data structure

Death Knights of Krynn is an SSI Gold Box title in the same engine family as
Champions of Krynn (see `docs/championsofkrynn/amiga/data-structure.md` —
this doc assumes that one's container/codec background) and the wider
GEO/ECL corpus documented in `docs/goldbox-glib-format.md`. The game ships
**three** campaign banks — bank 1 (`GEO1.DAX`/`ECL1.DAX`), bank 2
(`GEO2.DAX`/`ECL2.DAX`), bank 3 (`GEO3.DAX`/`ECL3.DAX`) — but only **one**
`walldef1.dax` shared across all three (see §3).

## 1. Container — CONFIRMED, same "DOS DaxFile" format as Champions of Krynn

Identical to Champions of Krynn's container/codec
(`tools/shared/goldbox-dosdax.ts`) — no per-title adaptation needed.
**Verified**: 199/199 directory entries across every `.DAX` file in
`data/ssi/DeathKnightsOfKrynn/data/` decompress to their exact declared
`rawSize`, chain byte-exactly, zero deviations.

## 2. GEO — CONFIRMED, unchanged, but with a non-constant 2-byte prefix

Every GEO entry decompresses to exactly 1026 bytes. Unlike Champions/PoR/the
GLIB titles (constant `0x0004` prefix), **this title's leading 2 bytes are
NOT constant** — real per-level values observed: `0f83`, `ccdd`, `0111`,
`a0cb`, `0029`, etc. This does not affect decoding: unconditionally skipping
2 bytes before the confirmed 1024-byte 4-plane record is still correct
regardless of content, independently verified via the wall-adjacency
self-consistency oracle (a shared wall's presence should agree from both
adjacent cells): **98.8%-100% agreement across all 19 sampled levels** — as
strong as or stronger than every other title in this corpus. What those 2
bytes hold (plausibly a per-level checksum or id) is not decoded this pass.

19 levels total: bank 1 has 4 (GEO ids 32/33/34/36), bank 2 has 8
(48/49/50/51/64/65/66/67), bank 3 has 7 (80/82/83/96/97/98/99). Level ids in
this corpus's asset output are namespaced `bank*1000 + geoId`, same
convention as Champions of Krynn.

## 3. WALLDEF wall-slice geometry — CONFIRMED; a real structural difference
from every sibling title explains the single shared file

`walldef1.dax` has 7 entries (ids 1-7), each decompressing to **exactly
2340 bytes = 156 x 15** — i.e. **15 raw wall slices per entry**, not the
5-or-10-slice pattern every other title in this corpus uses. Since
`SLICES_PER_WALLSET = 5` is the confirmed corpus-wide quantum, 2340 bytes =
**3 bundled 5-slice wallset groups**. This is a strong structural
explanation for why the game ships only one `walldef1.dax` instead of three
per-bank files like its own GEO/ECL split: **each wall id's entry already
carries all 3 banks' own wall-art variant**, addressed by `wallsetIndex`
(0/1/2) the same arithmetic mechanism Curse/Secret's own multi-wallset ids
already use (`resolveCompositeWallId`, `Math.floor(wallNumber/SLICES_PER_WALLSET)`)
— not a missing-file gap. (HYPOTHESIS on the *reason* the file is shared;
CONFIRMED that the byte structure is a clean 3x SLICES_PER_WALLSET multiple.)

## 4. 8x8 tile pixel format — OPEN (undecoded)

This title ships **no** DOS-DaxFile-container 8x8-tile file analogous to
Champions' `8X8D1.DAX` — its only tile-bank candidate is `8x8d1.daa`
(63,376 bytes), which resists every hypothesis tried (same paths-tried
table as Champions of Krynn's `8X8D*.DAA` — see
`docs/championsofkrynn/amiga/data-structure.md` §4's table; the two titles'
`.DAA` files were investigated together since they're structurally the same
open question). Practical impact: **no wall-art PNGs are rendered for this
title at all** — `tools/deathknightsofkrynn/amiga/export-data.ts` verifies
WALLDEF geometry only and writes zero textures; the walker's generic
per-level placeholder texture (`tools/walker/games-goldbox.ts`'s
`wallTextureFor`) renders instead, so movement/collision/minimap all still
work correctly, just without real Gold Box wall imagery.

## 5. ECL wallset-slot bindings — CONFIRMED, v1.1 engine revision (same as
Champions of Krynn — an earlier v1.3 hypothesis was tested and refuted)

**Correction (this session):** an earlier pass in this same investigation
found that `OPCODE_TABLE_POOLS_V13` + `{opcode: 0x21, mode:
'fill-all-from-second-operand'}` resolved 100% of levels (19/19) but every
single level returned the identical degenerate `{slot1:127,slot2:127,slot3:127}`
— suspicious enough to investigate further rather than accept. Manually
disassembling the raw bytes at the actual hit positions (e.g. `ECL1.DAX`
block id=2, position 80) against the **default** `OPCODE_TABLE` (v1.1) showed
a clean, coherent instruction sequence: opcode `0x21` "LOAD FILES" (3
operands under v1.1, `{32, 127, 255}`) immediately followed by opcode `0x37`
"LOAD PIECES" (3 operands, `{2, 127, 127}`) — exactly Pool of Radiance's own
`LOAD FILES`-then-`LOAD PIECES` pattern. Re-running `findWallsetBindings`
under the v1.3 table at the same position instead desyncs: 0x21 consumes
only 2 operands (5 bytes, not 7), landing on a real `0x00`/`0xff` "UNKNOWN
opcode" byte pair immediately after — a decisive, structural refutation of
the v1.3 hypothesis for this title, not just a style preference.

**Confirmed config: base `0x8000`, standard v1.1 `OPCODE_TABLE`, wallset
load via opcode `0x37` "LOAD PIECES" (the module's own default) — IDENTICAL
to Champions of Krynn.** `127` (`0x7f`) is the module's own documented
"reset/don't-touch this slot" sentinel, not a decode bug — real levels
resolve real, varied `slot1` values (1 through 7 observed) while slot2/slot3
mostly stay at the sentinel, consistent with most Death Knights levels using
only one active wall material.

**Verified**: 16/19 levels resolve at least one statically-known wallset
slot (4/4 bank 1, 7/8 bank 2, 5/7 bank 3). The 3 unresolved levels (GEO ids
16, 65, 80) have real code (19-79 visited instructions) but no wallset-load
call reachable from their own header entry points and no resolvable
`NEWECL` target — plausibly non-dungeon (town/combat-only) scripts, not
investigated further this pass.

## 6. Verification summary

| Component | Status | Evidence |
|---|---|---|
| Container/codec | CONFIRMED | 199/199 entries, chain + exact rawSize, corpus-wide |
| GEO | CONFIRMED | Unchanged decoder; 19/19 levels decode; wall-adjacency oracle 98.8-100% agreement (non-constant prefix doesn't affect decoding) |
| WALLDEF geometry | CONFIRMED | 7 entries, all exactly 2340 = 156*15 bytes (3 bundled wallsets/entry) |
| 8x8 tiles | OPEN | No confirmed pixel source; see `docs/championsofkrynn/amiga/data-structure.md` §4's paths-tried table |
| ECL wallset bindings | CONFIRMED | 16/19 levels, base 0x8000, v1.1 table — v1.3 hypothesis tested and refuted by manual disassembly |

See `docs/deathknightsofkrynn/TODO.md` for open items.

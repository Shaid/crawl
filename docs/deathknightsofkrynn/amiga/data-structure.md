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

## 4. 8x8 tile pixel format — CONFIRMED (`8x8d1.daa`, an Amiga-native
BIG-ENDIAN sibling of the DOS DaxFile container)

> **Correction (2026-09-01, `re-oracle` escalation + independent
> re-verification):** the earlier "OPEN, resists every hypothesis" verdict
> below is superseded. `8x8d1.daa` is NOT the DOS DaxFile container
> (`readDosDaxDirectory`) with a broken/missing field — it's a genuinely
> different, previously-undocumented BIG-ENDIAN sibling container
> (`readAmigaDaaDirectory`/`decodeAmigaDaaFile` in
> `tools/shared/goldbox-dosdax.ts`), used for essentially every Amiga-native
> resource in both this title and Champions of Krynn (`*.DAA`/`*.daa`
> files: `8x8d1.daa`, `BIGPIC1.DAA`, `SPRIT1.DAA`, `WILDCOM.daa`, etc — a
> much larger family than just the 8x8-tile files). The escalation found
> this after 5 refuted approaches (see "Paths tried" below) by treating the
> directory as **big-endian** with `dataOffset = headerLen` **exactly** (no
> `+2`, unlike the DOS-side LE variant) — the earlier LE, `+2`-offset
> reading had been misreading entry 0's own `rawSize` field as a spurious
> "tag byte", which is why every prior pass's header/tag search came up
> empty or inconsistent.
>
> **Independently re-verified this session** (fresh Python re-implementation,
> not just trusting the escalation's own scripts): all 31 entries in
> `8x8d1.daa` (63,376 B) decode byte-exact, chain is contiguous entry-to-
> entry, and the last entry's end lands exactly at EOF.
>
> **Payload format** (see `tools/shared/goldbox-daa-tiles.ts`'s module doc
> for the full byte table): 9-byte header (`height`, `tileCount`, `x`, `y`,
> `itemCount`, all BE) + a 64-byte embedded palette (32 x u16 BE amiga12
> colour words) + `planeCount * tileCount * 8` bytes of plane-consecutive
> bitplane data (`planeCount = 5` for this title, giving 32-colour tiles).
> Every wall-specific entry's own embedded palette is **all-zero** — the
> real palette lives in the "universal" entry id 202, confirmed directly by
> reading its raw bytes (non-zero amiga12 words, including a real
> greyscale ramp and saturated red/green/blue/yellow/cyan/magenta
> entries). One entry (id 202 itself) has a `tileCount` field
> (45) that's off by exactly one relative to the value (46) that would
> divide its own body length evenly — a real, minor authoring anomaly that
> doesn't block anything, since the palette lives at a fixed 64-byte offset
> regardless of the tile-count field, and id 202 is never treated as a tile
> bank (only its palette is used).
>
> **"Quarters" addressing — CONFIRMED**: for `walldef1.dax` wall id `W`
> (1-7), the raw WALLDEF view-cell byte (0-255) selects among FOUR `.DAA`
> entries — `W`, `W+20`, `W+40`, `W+60` — each holding exactly 64 tiles:
> `slot = idx >> 6` (0-3), `tile = idx & 63`. `8x8d1.daa`'s ids are exactly
> this set for all 7 walls (`{1,21,41,61,2,22,42,62,...,7,27,47,67}`) plus
> the 3 universal ids (202/203/204), which fall outside any single WALLDEF
> byte's addressable range (256-301) and are not consumed by the per-cell
> renderer.
>
> **Shipped**: `tools/deathknightsofkrynn/amiga/export-data.ts` renders
> real colour wall-art PNGs for all 7 wall ids x 15 wallset-group slices
> (105 PNGs total, 0 skipped — every wall id has a complete quarter set).
> Visually confirmed (`Read`) on 3 samples: `walldef-2-wall2-view6.png`
> (cobblestone/hedge wall with a wooden door), `walldef-5-wall0-view6.png`
> (ornate red-brick archway), plus a corpus-wide brightness-variance sweep
> (`pngjs`, std-dev per PNG) found 20/105 renders are flat/degenerate
> (`std < 2`) — traced to real, literally-all-zero WALLDEF view-cell bytes
> in the source data itself (verified directly, e.g. wall id 2's
> wallNumbers 9-14), not a decode bug: this file bundles all 3 campaign
> banks' own wall-art variants per id (§3), so a wall id genuinely unused
> by one bank's dungeons has blank filler slices for that bank's wallset
> group. 85/105 (81%) render real, structured, non-degenerate Gold Box
> wall art.

### Paths tried (superseded — kept for the record; see correction above)

This title ships **no** DOS-DaxFile-container 8x8-tile file analogous to
Champions' `8X8D1.DAX` — its only tile-bank candidate was `8x8d1.daa`
(63,376 bytes), which resisted every hypothesis tried in an earlier pass
(same paths-tried table as Champions of Krynn's `8X8D*.DAA` — see
`docs/championsofkrynn/amiga/data-structure.md` §4's table; the two titles'
`.DAA` files were investigated together since they're structurally the same
container). That "practical impact: no wall-art PNGs" statement no longer
applies — see the correction above.

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
| 8x8 tiles | CONFIRMED | `8x8d1.daa` (BE `.DAA` container), 31/31 entries byte-exact; 105 real wall-art PNGs shipped, 85/105 non-degenerate (the rest are genuinely-blank source filler for unused bank/wall combinations) |
| ECL wallset bindings | CONFIRMED | 16/19 levels, base 0x8000, v1.1 table — v1.3 hypothesis tested and refuted by manual disassembly |

See `docs/deathknightsofkrynn/TODO.md` for open items.

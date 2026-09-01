/**
 * "ECL" — the SSI Gold Box engine's per-level scripting bytecode. This is
 * the VM that resolves the missing indirection layer `goldbox-geo.ts`
 * documents: which WALLDEF resource occupies each of a level's 3 runtime
 * wallset slots (planes 0/1's 1-15 wall-art TYPE only names a (slot,slice)
 * pair — see that module's doc).
 *
 * ## Container — CONFIRMED, reuses already-cracked codecs
 *
 * Pool of Radiance's `ecl.dax` is the SAME `.dax` directory format as
 * `geo.dax` (`tools/poolofradiance/amiga/dax.ts`) — 29 entries, one per
 * level, `indexID` matching GEO's own level ids. Each decompressed entry
 * carries the SAME kind of constant 2-byte tag prefix GEO's PoR entries do
 * (`0x8813` here, vs GEO's `0x0004` — confirmed constant across all 29
 * entries) that must be stripped before the bytes are valid VM memory (see
 * `stripEclHeaderTag` below; mirrors `POR_GEO_PREFIX_LENGTH`).
 *
 * The three GLIB titles' `ECL.GLB` is the SAME GLIB container as `GEO.GLB`
 * (`goldbox-glib.ts`) — a top-level "DATA"-tagged container, uncompressed,
 * `decodeGlibIndex`'d the same way. No prefix strip needed (confirmed: the
 * first two bytes of a real GLIB ECL block are consumed directly by the
 * VM's own header-read algorithm below, landing on plausible in-range
 * addresses with no adjustment).
 *
 * ## Bytecode VM — CONFIRMED, ported from the `simeonpilgrim/coab` decompile
 *
 * Source: the same DOS *Curse of the Azure Bonds* decompile that solved
 * GEO (see `goldbox-geo.ts`'s module doc) — `engine/ovr008.cs`
 * (`vm_LoadCmdSets`, `vm_init_ecl`, `load_ecl_dax`), `engine/ovr003.cs`
 * (`SetupCommandTable`, `RunEclVm`, `CmdItem.Skip`, `CMD_LoadFiles`,
 * `CMD_OnGotoGoSub`), `Classes/Opperation.cs` (`GetCmdValue`),
 * `Classes/EclBlock.cs` (the 16-bit-address-space byte accessor).
 *
 * A level's ECL block is a flat byte stream simulating a 16-bit address
 * space based at `0x8000` for the three GLIB titles (`EclBlock`'s `index &
 * 0xFFFF` trick: since `gbl.ecl_offset` never goes below `0x8000` in normal
 * operation, `0x8000 + ecl_offset` wraps back to `ecl_offset - 0x8000`, i.e.
 * a plain 0-based buffer offset — this module tracks that 0-based offset
 * directly and calls it `pos`). **Pool of Radiance uses a DIFFERENT base,
 * `0x9900`** (found 2026-09-01, `re-oracle` escalation — see "Wallset-slot
 * resolution" below): `eclAddrToPos`/`reachabilityScanWallsets`/
 * `findWallsetBindings` all take `base` as a parameter (default `0x8000`)
 * rather than hardcoding it. The block opens with a 5-word header, each word
 * read via a 1-operand `vm_LoadCmdSets(1)` call starting at `pos=0`
 * (`readEclHeader` below): `vmRunAddr1`, `searchLocationAddr`,
 * `preCampCheckAddr`, `campInterruptedAddr`, `eclInitialEntryPoint` — all
 * base-relative addresses into this SAME block (the header words themselves
 * are read identically regardless of base; only converting one of these
 * words, or a jump target, to a buffer position needs `base`).
 *
 * Bytecode is a linear command stream: one opcode byte, then N "operand
 * groups" whose count is fixed per opcode (`OPCODE_TABLE`, all 65 opcodes
 * `SetupCommandTable` registers, 0x00-0x40). Each operand group is 2 bytes
 * (`code`, `low`) plus, for `code` in `{1,2,3,0x81}`, one more `high` byte
 * forming `word = low + (high<<8)` (`Opperation.High`'s setter) — 3 bytes
 * total; `code === 0x80` ("compressed string") instead consumes `low` raw
 * bytes inline (`LoadCompressedEclString`, `ovr008.cs:1064`). After all N
 * groups, one more trailing byte is consumed (`vm_LoadCmdSets`'s own
 * `gbl.ecl_offset++` after its `for` loop) — `readCmdSet` below reproduces
 * this exactly, byte for byte.
 *
 * `vm_GetCmdValue` (`Opperation.GetCmdValue`) resolves an operand to a
 * runtime value: `code===0x00` returns the literal `low` byte (statically
 * known); `code===0x02`/`0x81` returns the literal `word` (statically
 * known); `code===0x01`/`0x03`/`0x80` means "dereference `word` as a
 * memory address" (a genuine runtime value — NOT statically resolvable
 * from bytecode alone). `staticCmdValue` below implements exactly this.
 * Jump targets (`CMD_Goto`/`CMD_Gosub`, `ovr003.cs:44-65`) use `.Word`
 * DIRECTLY, ignoring `code` — always a literal, regardless of what `code`
 * happens to be.
 *
 * Two special-cases needed for a correct LINEAR walk (not just execution):
 * - `CMD_If` (`0x16`-`0x1B`, table-declared size 0): consumes exactly the
 *   1 opcode byte itself; the following command's bytes are consumed
 *   identically whether the condition is true (normal dispatch) or false
 *   (`SkipNextCommand`, `ovr003.cs:2130` — calls the SAME `Skip()`/
 *   `vm_LoadCmdSets` operand-count logic as normal execution). **CFG
 *   correction (2026-09-01, `re-oracle` escalation):** matching byte
 *   consumption is not the same as matching CFG EDGES — walking straight
 *   past IF only ever visits the following command's TRUE-path successors
 *   (itself, then whatever it falls through/jumps to). The FALSE path
 *   (`SkipNextCommand` skips that whole following command and resumes at
 *   ITS OWN `nextPos`) is a genuine extra edge that no other opcode's own
 *   dispatch logic adds when the followed command is itself a non-
 *   fallthrough op (`GOTO`/`GOSUB`/`ON GOTO`/`ON GOSUB`/`EXIT`/`RETURN`) —
 *   e.g. an unconditional `GOTO` right after an `IF` only pushes its jump
 *   target under the old walk, silently losing the "condition false, goto
 *   never runs, execution resumes right after it" successor. Fixed in
 *   `reachabilityScanWallsets` by explicitly parsing the following
 *   instruction and pushing ITS `nextPos` in addition to the normal
 *   true-path visit. Verified impact: Curse's blocks-with-`LOAD PIECES`
 *   reached went 10/25 -> 19/25, Secret's 5/22 -> 18/22 (re-derived this
 *   session, matching the escalation's reported deltas).
 * - `CMD_OnGotoGoSub` (`0x25`/`0x26`, table-declared size **0** — WRONG for
 *   real execution): reads 2 operands (`var_1`, `var_2`), backs up ONE
 *   byte (`gbl.ecl_offset--`, undoing the second operand's trailing `++`),
 *   then reads `var_2` MORE operand groups as a jump table, taking entry
 *   `var_1` if `var_1 < var_2`. `parseInstr` below implements this via the
 *   generalized `dynamicTailHeadCount` opcode-table field (head count 2 for
 *   these two opcodes) rather than a hardcoded opcode check — the same
 *   mechanism Pools of Darkness's revised table (see below) reuses for
 *   `VERTICAL MENU`/`TREASURE`/`HORIZONTAL MENU`.
 *
 * ## Wallset-slot resolution — the payoff
 *
 * `CMD_LoadFiles` (`ovr003.cs:501-587`) backs BOTH opcode `0x21` ("LOAD
 * FILES", loads the 3D map + a big-picture) and `0x37` ("LOAD PIECES",
 * `gbl.command`-dispatched to the SAME function) — the latter calls
 * `ovr031.LoadWalldef(slot, id)` for slots 1/2/3 from its 3 operands
 * (`var_3`->slot1, `var_2`->slot2, `var_1`->slot3; `0xff`="don't change
 * this slot", `var_3===0x7f`="reset slot 1"). This is simpler and more
 * direct than the `vm_SetMemoryValue`-intercepted path
 * (`ovr008.cs:655-684`, VM globals `0x322/0x324/0x326`) `goldbox-geo.ts`
 * originally cited — `SAVE` (opcode `0x09`) to those 3 addresses is a
 * SECOND way to reach `LoadWalldef` (`vm_SetMemoryValue`'s own special
 * case) and is detected too (`scanWallsetBindings` below), though it was
 * never observed to actually fire anywhere in this corpus (every real hit
 * found corpus-wide came from `0x37` directly).
 *
 * `findWallsetBindings` runs a worklist-based REACHABILITY walk (not a
 * naive single linear scan — see "paths tried" in the per-title docs for
 * why that mattered) from each of the block's 5 header addresses,
 * following straight-line fallthrough AND `GOTO`/`GOSUB`/`ON GOTO`/`ON
 * GOSUB` targets (their literal `.Word`, never dereferenced), collecting
 * every wallset-loading instruction visited (`0x37`/`0x09-to-0x322-324-326`
 * by default; configurable, see below). A visited position with **zero
 * unknown opcodes and zero desyncs among its own reachable set** is the
 * corpus-wide self-consistency oracle used to validate this whole VM port
 * (see the per-title docs' verification counts) — Curse of the Azure Bonds
 * and Secret of the Silver Blades both produce clean (0 unknown-opcode),
 * highly plausible, sequential-looking wallset ids this way (e.g. Curse
 * block 1: slot1=1,slot2=2,slot3=3, immediately after that same script's
 * own `LOAD FILES` call — real WALLDEF.GLB ids, confirmed to exist in that
 * title's own WALLDEF directory).
 *
 * ### Pool of Radiance — CORRECTED (2026-09-01, `re-oracle` escalation): wrong address base, not a dead end
 *
 * > **Correction:** this module previously stated PoR's header fields
 * > "routinely point outside a level's own ECL block" and that its LOAD
 * > PIECES operands "were consistently memory-dereferenced" — both were
 * > artifacts of assuming the WRONG address base (`0x8000`, the GLIB
 * > titles' convention), not a real engine-revision dead end. PoR's ECL
 * > blocks are based at **`0x9900`**, not `0x8000`. Evidence: the minimum
 * > header word across all 29 PoR levels is exactly `0x9914` (=
 * > `0x9900 + 20`, the 5-word/20-byte header size) — impossible under base
 * > `0x8000` (would require an in-block address of 0, i.e. inside the
 * > header itself) and exact under `0x9900`; a base sweep from `0x98fe` to
 * > `0x9910` shows `0x9900` uniquely minimizes unknown-opcode count over a
 * > full reachability walk from every level's header entries, with sharply
 * > worse neighbors on both sides. With base `0x9900` AND the IF-skip CFG
 * > fix above, PoR resolves the majority of its 29 levels' wallset
 * > bindings — see `docs/poolofradiance/amiga/data-structure.md` §7.1 for
 * > the reproduced count and per-level detail.
 *
 * ### Pools of Darkness — CORRECTED (2026-09-01, `re-oracle` escalation): wrong opcode table, not runtime-computed ids
 *
 * > **Correction:** this module previously stated Pools of Darkness's LOAD
 * > PIECES operands "are consistently memory-dereferenced (dynamic), not
 * > literal" — this was a misparse: Pools runs a v1.3 engine revision whose
 * > `SetupCommandTable` registers several opcodes with DIFFERENT operand
 * > counts than the v1.1 table above (`OPCODE_TABLE_POOLS_V13` below), and
 * > **wallset loading moved from opcode `0x37` to opcode `0x21` ("LOAD
 * > FILES")**, which in this revision takes only 2 operands
 * > `(geoId, walldefId)` — the second operand IS the wallset id, filling
 * > ALL 3 runtime slots at once (this title's own `WALLDEF.GLB` entries run
 * > 15 slices — a whole 3-slot x 5-slice wallset per id — confirming the
 * > "one id, three slots" shape). Opcode `0x37` in this revision is an
 * > unrelated 2-operand NPC-by-name query, not `LOAD PIECES` at all. Parsing
 * > with the WRONG (v1.1) table desyncs the byte stream almost immediately
 * > (every downstream operand-group boundary drifts), which is why every
 * > "hit" the old table found looked memory-dereferenced — it was reading
 * > garbage, not a real dynamic operand. `findWallsetBindings(buf, {
 * > opcodeTable: OPCODE_TABLE_POOLS_V13, wallsetLoad: { opcode: 0x21, mode:
 * > "fill-all-from-second-operand" } })` resolves the majority of Pools'
 * > 32 levels — see `docs/poolsofdarkness/amiga/data-structure.md` §5.1.
 *
 * `reachabilityScanWallsets`/`findWallsetBindings` take an options bag
 * (`base`, `opcodeTable`, `wallsetLoad`) so each title supplies its own
 * engine-revision parameters rather than this module hardcoding one table/
 * base for all four.
 *
 * ### Treasures of the Savage Frontier — SOLVED (2026-09-01, `re-oracle`
 * escalation, independently re-verified against real bytes this session):
 * a new opcode-table delta AND a real "the ECL is not the authority" finding
 *
 * This title's `ECL.GLB` blocks carry the same constant 2-byte `0x8813`
 * prefix tag PoR's `.dax` entries do (`eclBlockPrefixLength: 2` in its
 * `export-data.ts`) — confirmed necessary but NOT sufficient: a corpus-wide
 * reachability walk under the v1.1 table still desynced on ~10% of visited
 * opcodes even with the prefix stripped. The real recipe, confirmed via a
 * headless-Ghidra disassembly of this title's own AmigaOS executable
 * (`data/ssi/TreasureSavageFrontNTSC/data/Treasure`, no symbol table):
 * **`OPCODE_TABLE_POOLS_V13` (every Pools of Darkness v1.3 delta applies
 * verbatim) plus three new opcodes** (`OPCODE_TABLE_TREASURE_V13X` below):
 * `0x42` ("LOAD AREA", 4 operands `(geoId, slot1, slot2, slot3)` — this
 * title's own wallset-load call, replacing v1.3's `0x21` remap), `0x43`
 * ("NPC SEARCH BY ATTRIBUTES", 4 operands, unrelated to wallsets), and
 * `0x44` (4 operands, engine-registered but 0 occurrences in this corpus).
 * All three operand counts are read directly from the executable's own
 * `SkipNextCommand` size-dispatch table (69 entries, `0x00`-`0x44`), not
 * guessed — confirmed by a corpus-wide reachability walk producing **0
 * unknown opcodes and 0 desyncs across all 20,338+ visited instructions in
 * all 30 `ECL.GLB` blocks** (independently re-run this session against real
 * bytes, not just taken on the escalation's word — see
 * `docs/treasureofthesavagefrontier/amiga/data-structure.md` §4).
 *
 * **The bigger finding: for this title, the ECL bytecode's own wallset
 * operands are DEAD DATA for every dungeon geo (ids 16-50).** Both `0x21`
 * ("LOAD FILES", now `slots=[op2,0xFF,0xFF]` in this revision) and the new
 * `0x42` ("LOAD AREA", `slots=[op2,op3,op4]`) call a shared
 * `getAreaWallsets(geoId, &slots)` routine which — for any `geoId` in
 * `[16,50]` — UNCONDITIONALLY OVERWRITES all 3 slot bytes from a
 * hardcoded, per-geo constant table baked into the executable (a 35-entry
 * jump table), before `LoadWalldef` ever sees the ECL-supplied values.
 * This is presumed leftover DOS-build data the Amiga port's engine
 * silently ignores — several ECL-declared slot values would leave a level's
 * own required wall type unbound otherwise (e.g. geo 23's ECL leaves slot3
 * as `0xff`/"don't touch", but its GEO grid needs slot 3; the executable's
 * own table supplies a real id there). **No opcode-table fix could ever
 * have resolved this title's real bindings from ECL bytecode alone** — see
 * `TREASURE_EXE_WALLSETS` below, the executable-derived per-geo lookup
 * table that is the actual authority for this title's dungeon geos.
 *
 * **Wilderness geos (`51`-`62`) — CONFIRMED via disassembly (2026-09-01,
 * `amiga-disasm` pass) that `getAreaWallsets` does NOTHING for these ids,
 * not just "falls outside the table."** The function's own range check
 * (`subi.w #0x10,D0w` / `cmpi.w #0x23,D0w` / `bcc.b <noop>` — i.e.
 * `geoId-16 >= 35`, so any `geoId >= 51` branches straight past the
 * 35-entry jump table to a shared `movem.l (SP)+,{A2} / rts`) was traced
 * byte-exact: ids 41-46 (unused slots inside the in-range 16-50 span) hit
 * the SAME no-op target as ids >= 51, and every one of the 29 real
 * in-range entries' decoded `move.b #s1,(A2)/#s2,(1,A2)/#s3,(2,A2)` triples
 * matches `TREASURE_EXE_WALLSETS` exactly, 0 deviations — so this isn't a
 * partial/approximate reading, it's the routine's literal, fully-decoded
 * behavior. For geo ids 51-62 the 3 slot bytes are left exactly as
 * whatever the caller already wrote (i.e. block 51's own `LOAD FILES`
 * passing the geo id itself through, which `LoadWalldef` then fails to
 * resolve against `WallDef.glb` — a real engine no-op path, not a decode
 * gap). No wallset-binding data exists for these ids in this executable at
 * all — do not add a `wallsetOverride` entry for them.
 *
 * A full-binary ASCII string scan of the executable found ZERO references
 * to any filename (no `"WALLDEF"`, `"Sky.tlb"`, `"wildcom"`, `"randcom"`,
 * `"AREA"` string anywhere) — this engine loads resources by numeric
 * ECL-declared id through an external table, not hardcoded name strings,
 * so the executable alone can't name wilderness's real art source. Direct
 * byte inspection (not disassembly) of `diska/Sky.tlb` (3,791 B, `GLIB`
 * magic, 3 `TILE` blocks), `diska/wildcom.tlb` (12,668 B, `GLIB`, 34
 * `TILE` blocks), and `diska/randcom.tlb` (2,684 B, `GLIB`, 6 `TILE`
 * blocks) confirms all three are real, structurally-valid GLIB/TILE
 * containers (same shape as this title's own `diska/Walls.tlb`) — strong
 * circumstantial evidence of a SEPARATE, non-WALLDEF overland
 * sky/terrain/random-encounter tile renderer, but the actual consuming
 * code path was not located this pass (no static reference to these 3
 * files exists to follow). Genuinely open at the "which code reads these"
 * level — see the per-title TODO — but the original open question ("is
 * there a missed executable table for ids 51-62?") is now closed: no.
 */

export interface EclOperand {
  code: number;
  low: number;
  high?: number;
  /** Only set for `code` in {1,2,3,0x81} — see module doc. */
  word?: number;
}

export interface OpcodeInfo {
  /** Declared operand-group count from `SetupCommandTable`. Ignored (and may be left at any value, conventionally 0) when `dynamicTailHeadCount` is set. */
  n: number;
  name: string;
  /**
   * When set, this opcode reads `dynamicTailHeadCount` FIXED operand groups
   * first, then treats the LAST of those groups' static value as a dynamic
   * COUNT of additional trailing operand groups read starting one byte
   * "backed up" (undoing the head's own trailing byte) — generalizes
   * `CMD_OnGotoGoSub`'s (`0x25`/`0x26`, head count 2) real byte-consumption
   * shape (see module doc), reused by Pools of Darkness's revised table for
   * `VERTICAL MENU`/`TREASURE`/`HORIZONTAL MENU`. `n` is unused when this is set.
   */
  dynamicTailHeadCount?: number;
}

/** All 65 opcodes `SetupCommandTable` (`ovr003.cs:2062-2127`) registers, 0x00-0x40 — the v1.1 engine revision (Curse of the Azure Bonds, Secret of the Silver Blades, Pool of Radiance; PoR differs only in address base, not opcode shape — see module doc). */
export const OPCODE_TABLE: Record<number, OpcodeInfo> = {
  0x00: { n: 0, name: 'EXIT' },
  0x01: { n: 1, name: 'GOTO' },
  0x02: { n: 1, name: 'GOSUB' },
  0x03: { n: 2, name: 'COMPARE' },
  0x04: { n: 3, name: 'ADD' },
  0x05: { n: 3, name: 'SUBTRACT' },
  0x06: { n: 3, name: 'DIVIDE' },
  0x07: { n: 3, name: 'MULTIPLY' },
  0x08: { n: 2, name: 'RANDOM' },
  0x09: { n: 2, name: 'SAVE' },
  0x0a: { n: 1, name: 'LOAD CHARACTER' },
  0x0b: { n: 3, name: 'LOAD MONSTER' },
  0x0c: { n: 3, name: 'SETUP MONSTER' },
  0x0d: { n: 0, name: 'APPROACH' },
  0x0e: { n: 1, name: 'PICTURE' },
  0x0f: { n: 2, name: 'INPUT NUMBER' },
  0x10: { n: 2, name: 'INPUT STRING' },
  0x11: { n: 1, name: 'PRINT' },
  0x12: { n: 1, name: 'PRINTCLEAR' },
  0x13: { n: 0, name: 'RETURN' },
  0x14: { n: 4, name: 'COMPARE AND' },
  0x15: { n: 0, name: 'VERTICAL MENU' },
  0x16: { n: 0, name: 'IF =' },
  0x17: { n: 0, name: 'IF <>' },
  0x18: { n: 0, name: 'IF <' },
  0x19: { n: 0, name: 'IF >' },
  0x1a: { n: 0, name: 'IF <=' },
  0x1b: { n: 0, name: 'IF >=' },
  0x1c: { n: 0, name: 'CLEARMONSTERS' },
  0x1d: { n: 1, name: 'PARTYSTRENGTH' },
  0x1e: { n: 6, name: 'CHECKPARTY' },
  0x1f: { n: 2, name: 'notsure 0x1f' },
  0x20: { n: 1, name: 'NEWECL' },
  0x21: { n: 3, name: 'LOAD FILES' },
  0x22: { n: 2, name: 'PARTY SURPRISE' },
  0x23: { n: 4, name: 'SURPRISE' },
  0x24: { n: 0, name: 'COMBAT' },
  0x25: { n: 0, name: 'ON GOTO', dynamicTailHeadCount: 2 },
  0x26: { n: 0, name: 'ON GOSUB', dynamicTailHeadCount: 2 },
  0x27: { n: 8, name: 'TREASURE' },
  0x28: { n: 3, name: 'ROB' },
  0x29: { n: 14, name: 'ENCOUNTER MENU' },
  0x2a: { n: 3, name: 'GETTABLE' },
  0x2b: { n: 0, name: 'HORIZONTAL MENU' },
  0x2c: { n: 6, name: 'PARLAY' },
  0x2d: { n: 1, name: 'CALL' },
  0x2e: { n: 5, name: 'DAMAGE' },
  0x2f: { n: 3, name: 'AND' },
  0x30: { n: 3, name: 'OR' },
  0x31: { n: 0, name: 'SPRITE OFF' },
  0x32: { n: 1, name: 'FIND ITEM' },
  0x33: { n: 0, name: 'PRINT RETURN' },
  0x34: { n: 1, name: 'ECL CLOCK' },
  0x35: { n: 3, name: 'SAVE TABLE' },
  0x36: { n: 1, name: 'ADD NPC' },
  0x37: { n: 3, name: 'LOAD PIECES' },
  0x38: { n: 1, name: 'PROGRAM' },
  0x39: { n: 1, name: 'WHO' },
  0x3a: { n: 0, name: 'DELAY' },
  0x3b: { n: 3, name: 'SPELL' },
  0x3c: { n: 1, name: 'PROTECTION' },
  0x3d: { n: 0, name: 'CLEAR BOX' },
  0x3e: { n: 0, name: 'DUMP' },
  0x3f: { n: 1, name: 'FIND SPECIAL' },
  0x40: { n: 1, name: 'DESTROY ITEMS' },
};

/**
 * Pools of Darkness's v1.3 engine revision registers several opcodes with
 * DIFFERENT operand-group counts than `OPCODE_TABLE` above, plus one new
 * opcode (`0x41`) — see the module doc's "Pools of Darkness" correction
 * block for the evidence (byte-exact-clean reachability walks corpus-wide
 * once this table + the `0x21` wallset-load remap are used together).
 * Built by cloning `OPCODE_TABLE` and applying only the confirmed deltas —
 * every opcode not listed here keeps its v1.1 shape unchanged.
 */
export const OPCODE_TABLE_POOLS_V13: Record<number, OpcodeInfo> = (() => {
  const table: Record<number, OpcodeInfo> = {};
  for (const [k, v] of Object.entries(OPCODE_TABLE)) table[Number(k)] = { ...v };
  const deltas: Record<number, OpcodeInfo> = {
    0x0c: { n: 4, name: 'SETUP MONSTER' },
    0x15: { n: 0, name: 'VERTICAL MENU', dynamicTailHeadCount: 3 },
    0x1d: { n: 0, name: 'PARTYSTRENGTH' },
    0x1f: { n: 1, name: 'notsure 0x1f' },
    0x21: { n: 2, name: 'LOAD FILES' }, // wallset load moved here in this revision — see module doc.
    0x22: { n: 0, name: 'PARTY SURPRISE' },
    0x23: { n: 0, name: 'SURPRISE' },
    0x27: { n: 0, name: 'TREASURE', dynamicTailHeadCount: 4 },
    0x29: { n: 0, name: 'ENCOUNTER MENU' },
    0x2b: { n: 0, name: 'HORIZONTAL MENU', dynamicTailHeadCount: 2 },
    0x2c: { n: 1, name: 'PARLAY' },
    0x31: { n: 2, name: 'SPRITE OFF' },
    0x34: { n: 2, name: 'ECL CLOCK' },
    0x36: { n: 2, name: 'ADD NPC' },
    0x37: { n: 2, name: 'NPC BY NAME (not LOAD PIECES in this revision)' }, // packed inline string + result slot — see module doc.
    0x41: { n: 2, name: 'unknown 0x41 (new in this revision)' },
  };
  for (const [k, v] of Object.entries(deltas)) table[Number(k)] = v;
  return table;
})();

/**
 * Treasures of the Savage Frontier's own engine revision: `OPCODE_TABLE_POOLS_V13`
 * plus three new opcodes this title's executable registers (`0x42`-`0x44`) —
 * see the module doc's "Treasures of the Savage Frontier" section for the
 * full evidence (headless-Ghidra-disassembled operand counts, 0 unknown/0
 * desync corpus-wide). Wallset loading here is opcode `0x42` ("LOAD AREA"),
 * NOT `0x21` — see `TREASURE_WALLSET_LOAD` below. Built the same way
 * `OPCODE_TABLE_POOLS_V13` is: clone the v1.3 table, apply only the new
 * deltas.
 */
export const OPCODE_TABLE_TREASURE_V13X: Record<number, OpcodeInfo> = (() => {
  const table: Record<number, OpcodeInfo> = {};
  for (const [k, v] of Object.entries(OPCODE_TABLE_POOLS_V13)) table[Number(k)] = { ...v };
  table[0x42] = { n: 4, name: 'LOAD AREA (geoId,slot1,slot2,slot3)' };
  table[0x43] = { n: 4, name: 'NPC SEARCH BY ATTRIBUTES' };
  table[0x44] = { n: 4, name: 'unknown 0x44 (engine-registered, 0 occurrences in corpus)' };
  return table;
})();

/**
 * Treasures of the Savage Frontier's wallset-load shape: opcode `0x42`
 * ("LOAD AREA"), 4 operands `(geoId, slot1, slot2, slot3)` — the first
 * operand is NOT a slot, so this is `'load-pieces'`'s shape shifted right by
 * one operand. See `WallsetLoadConfig`'s `'load-pieces-skip-first'` mode.
 *
 * **Passing this to `findWallsetBindings` resolves the CFG/opcode-stream
 * correctly, but its resolved slot VALUES are not authoritative for this
 * title's dungeon geos (16-50)** — the real per-geo wallset ids are
 * hardcoded in the executable and unconditionally overwrite whatever the
 * ECL bytecode says (see the module doc). Use `TREASURE_EXE_WALLSETS` (with
 * `remapTreasureWallId`) as the actual binding source for those geo ids;
 * this config is retained for wilderness geos / future non-wallset ECL
 * decoding of this title, where it's still the mechanically-correct parse.
 */
export const TREASURE_WALLSET_LOAD: WallsetLoadConfig = { opcode: 0x42, mode: 'load-pieces-skip-first' };

/**
 * Treasures of the Savage Frontier's REAL per-geo wallset table — hardcoded
 * in the executable (`getAreaWallsets`'s 35-entry jump table), not decoded
 * from ECL bytecode at all (see the module doc). Raw values as stored;
 * apply `remapTreasureWallId` to each before resolving against
 * `WALLDEF.GLB`'s own directory (the executable's own `LoadWalldef` applies
 * this remap, confirmed via disassembly). Verified 87/87 (29 geos x 3
 * slots) land inside this title's real `WallDef.glb` id set
 * `{2,4,5,6,7,8,9,13,30,31,32,36}` after the remap, 0 deviations, and every
 * geo whose GEO grid needs a slot-2/slot-3 wall type has a real id there —
 * independently re-verified this session, not just taken on the
 * escalation's report. Geo ids outside this table (wilderness, `51`-`62`)
 * have no executable-hardcoded binding — see the module doc.
 */
export const TREASURE_EXE_WALLSETS: Record<number, [number, number, number]> = {
  16: [9, 4, 15], 17: [30, 30, 30], 18: [2, 15, 31], 19: [15, 30, 31], 20: [36, 36, 36],
  21: [6, 15, 6], 22: [8, 8, 8], 23: [36, 31, 15], 24: [5, 13, 13], 25: [31, 31, 31],
  26: [4, 15, 6], 27: [9, 15, 8], 28: [15, 9, 2], 29: [9, 15, 9], 30: [9, 15, 31],
  31: [6, 9, 15], 32: [7, 15, 9], 33: [30, 30, 30], 34: [8, 8, 8], 35: [9, 31, 15],
  36: [9, 31, 15], 37: [9, 31, 15], 38: [9, 31, 15], 39: [36, 15, 31], 40: [5, 13, 13],
  47: [8, 15, 9], 48: [31, 15, 15], 49: [30, 30, 30], 50: [30, 30, 30],
};

/** `LoadWalldef`'s own `id===15 -> 32` remap (confirmed via disassembly, `Treasure` file+0x2B674) — applied to every raw `TREASURE_EXE_WALLSETS` value before resolving against `WallDef.glb`'s real directory. */
export function remapTreasureWallId(id: number): number {
  return id === 15 ? 32 : id;
}

/** PoR's `.dax`-decompressed ECL entries carry this constant 2-byte tag before the real VM buffer (confirmed identical across all 29 entries) — same convention as `POR_GEO_PREFIX_LENGTH` in `goldbox-geo.ts`. */
export const POR_ECL_PREFIX_LENGTH = 2;

/** Read one operand group starting right after `pos` (the position of the preceding command/header-slot byte). Mirrors one iteration of `vm_LoadCmdSets`'s `for` loop body, minus the loop's own trailing `++`. */
function readOperandRaw(buf: Uint8Array, pos: number): { op: EclOperand; p: number } {
  const code = buf[pos + 1];
  const low = buf[pos + 2];
  let p = pos + 2;
  let high: number | undefined;
  let word: number | undefined;
  if (code === 1 || code === 2 || code === 3) {
    p += 1;
    high = buf[p];
    word = low + (high << 8);
  } else if (code === 0x80) {
    p += low; // raw (compressed-string) bytes, not decoded here — only skipped
  } else if (code === 0x81) {
    p += 1;
    high = buf[p];
    word = low + (high << 8);
  }
  return { op: { code, low, high, word }, p };
}

/** Mirrors `vm_LoadCmdSets(n)`: read `n` operand groups starting with the command/header-slot byte at `startPos`, then the trailing `++`. Returns the position of the NEXT command byte. */
export function readCmdSet(buf: Uint8Array, startPos: number, n: number): { ops: EclOperand[]; nextPos: number } {
  let pos = startPos;
  const ops: EclOperand[] = [];
  for (let i = 0; i < n; i++) {
    const { op, p } = readOperandRaw(buf, pos);
    ops.push(op);
    pos = p;
  }
  pos += 1;
  return { ops, nextPos: pos };
}

export interface StaticValue {
  known: boolean;
  value?: number;
}

/** `Opperation.GetCmdValue()`: code 0 (byte immediate) and 2/0x81 (word immediate) are statically known; 1/3/0x80 require a runtime memory dereference. */
export function staticCmdValue(op: EclOperand): StaticValue {
  if (op.code === 0x00) return { known: true, value: op.low };
  if (op.code === 0x02 || op.code === 0x81) return { known: true, value: op.word };
  return { known: false };
}

export interface EclHeader {
  vmRunAddr1: number;
  searchLocationAddr: number;
  preCampCheckAddr: number;
  campInterruptedAddr: number;
  eclInitialEntryPoint: number;
  /** Buffer offset (0-based) of the first real instruction, right after the 5-word header. */
  headerEndPos: number;
}

/** Parse the 5-word ECL header (`vm_init_ecl`, `ovr008.cs:89-124`). */
export function readEclHeader(buf: Uint8Array): EclHeader {
  let pos = 0;
  const words: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { ops, nextPos } = readCmdSet(buf, pos, 1);
    words.push(ops[0].word ?? -1);
    pos = nextPos;
  }
  return {
    vmRunAddr1: words[0],
    searchLocationAddr: words[1],
    preCampCheckAddr: words[2],
    campInterruptedAddr: words[3],
    eclInitialEntryPoint: words[4],
    headerEndPos: pos,
  };
}

/** Convert an ECL address word to this block's own 0-based buffer offset. `base` defaults to `0x8000` (the three GLIB titles); Pool of Radiance uses `0x9900` — see module doc. */
export function eclAddrToPos(word: number, base = 0x8000): number {
  return word - base;
}

interface ParsedInstr {
  cmd: number;
  ops: EclOperand[];
  nextPos: number;
}

/**
 * Parse one instruction at `pos` against `opcodeTable`. Opcodes with
 * `dynamicTailHeadCount` set (0x25/0x26 in the v1.1 table; also
 * 0x15/0x27/0x2b in Pools of Darkness's v1.3 table) read that many fixed
 * operand groups, then treat the LAST one's static value as a dynamic tail
 * count read starting one byte backed up — see `OpcodeInfo`'s doc. Returns
 * `undefined` for an opcode outside the table (caller should treat as a
 * 1-byte skip, matching `SkipNextCommand`'s own unknown-opcode fallback).
 */
function parseInstr(buf: Uint8Array, pos: number, opcodeTable: Record<number, OpcodeInfo>): ParsedInstr | undefined {
  const cmd = buf[pos];
  const entry = opcodeTable[cmd];
  if (!entry) return undefined;
  if (entry.dynamicTailHeadCount !== undefined) {
    const headCount = entry.dynamicTailHeadCount;
    const { ops: head, nextPos: afterHead } = readCmdSet(buf, pos, headCount);
    const last = staticCmdValue(head[headCount - 1]);
    const n = last.known && last.value !== undefined ? last.value : 0;
    const backedUp = afterHead - 1; // gbl.ecl_offset-- (CMD_OnGotoGoSub, ovr003.cs:1036)
    const { ops: tail, nextPos } = readCmdSet(buf, backedUp, n);
    return { cmd, ops: [...head, ...tail], nextPos };
  }
  if (entry.n === 0) return { cmd, ops: [], nextPos: pos + 1 };
  const { ops, nextPos } = readCmdSet(buf, pos, entry.n);
  return { cmd, ops, nextPos };
}

export interface WallsetHit {
  atPos: number;
  via: 'LOAD PIECES' | 'SAVE' | 'LOAD FILES';
  /** For 'LOAD PIECES'/'LOAD FILES': all 3 slots (LOAD FILES fills them identically — see `WallsetLoadConfig`). For 'SAVE': only the one slot the destination address named. */
  slot1?: StaticValue;
  slot2?: StaticValue;
  slot3?: StaticValue;
}

export interface ReachabilityResult {
  hits: WallsetHit[];
  visitedCount: number;
  unknownOpcodes: number;
  desyncs: number;
  /**
   * Static targets of every `NEWECL` (opcode `0x20`, "switch execution to a
   * different ECL block's own entry points") instruction visited, in
   * discovery order. `findWallsetBindings` chases these (when given
   * `options.resolveBlock`) for a block whose OWN reachable code has no
   * wallset-load call — NEWECL literally hands the running script to
   * another block's own header entry points, so that block's own bindings
   * are this one's real bindings too. Confirmed mechanism, not a guess: on
   * Pools of Darkness, geo ids 17/49/71/84 (unresolved directly) each carry
   * a `NEWECL` to 33-or-36/48/68/82 respectively — every one of those
   * targets DOES resolve directly, and the resulting thematic clustering
   * (id 49 -> 48's own walldef 3; 71 -> 68's walldef 4; 84 -> 82's walldef
   * 5) matches the geo-id-proximity pattern the rest of the corpus already
   * shows.
   */
  newEclTargets: StaticValue[];
}

/**
 * Which opcode + operand shape signals a wallset-slot load, and how to read
 * it. `'load-pieces'` (default, v1.1 engine — Curse/Secret/PoR): 3 operands
 * map directly to slot1/slot2/slot3 (`opcode` defaults to `0x37`).
 * `'fill-all-from-second-operand'` (Pools of Darkness's v1.3 revision):
 * `opcode` is `0x21` ("LOAD FILES", 2 operands `(geoId, walldefId)` in this
 * revision's table) and its 2nd operand fills ALL THREE slots identically —
 * see module doc. `'load-pieces-skip-first'` (Treasures of the Savage
 * Frontier's `0x42` "LOAD AREA"): 4 operands `(geoId, slot1, slot2, slot3)`
 * — same direct per-slot mapping as `'load-pieces'`, just shifted right by
 * one operand since operand 0 is a geo id, not a slot.
 */
export interface WallsetLoadConfig {
  opcode: number;
  mode: 'load-pieces' | 'fill-all-from-second-operand' | 'load-pieces-skip-first';
}

const DEFAULT_WALLSET_LOAD: WallsetLoadConfig = { opcode: 0x37, mode: 'load-pieces' };

export interface EclDecodeOptions {
  /** VM address base for `eclAddrToPos` — default `0x8000`; Pool of Radiance is `0x9900` (see module doc). */
  base?: number;
  /** Opcode table to parse with — default `OPCODE_TABLE` (v1.1); Pools of Darkness needs `OPCODE_TABLE_POOLS_V13`. */
  opcodeTable?: Record<number, OpcodeInfo>;
  /** Which opcode/shape signals a wallset load — default `{opcode: 0x37, mode: 'load-pieces'}`. */
  wallsetLoad?: WallsetLoadConfig;
  maxVisited?: number;
  /**
   * Resolve another ECL block's raw bytes by id, for `findWallsetBindings`
   * to chase `NEWECL` (opcode `0x20`) targets when this block's own
   * reachable code has no wallset-load call — see `ReachabilityResult`'s
   * `newEclTargets` doc. Omit to disable cross-block chaining (the
   * single-block-only resolution `reachabilityScanWallsets` always does).
   */
  resolveBlock?: (id: number) => Uint8Array | undefined;
}

/**
 * Worklist-based reachability walk from `startPos`, following GOTO/GOSUB/ON
 * GOTO/ON GOSUB targets (literal, never dereferenced) in addition to
 * straight-line fallthrough. Collects every wallset-load instruction
 * (configurable via `options.wallsetLoad`, default `0x37`/"LOAD PIECES")
 * and every `0x09`-to-`{0x322,0x324,0x326}` ("SAVE", the
 * `vm_SetMemoryValue` intercept) instruction visited, with resolved
 * operands where static. `unknownOpcodes`/`desyncs` are diagnostics: a
 * genuinely correct region has 0 of each (used as the corpus-wide
 * self-consistency oracle — see module doc).
 */
export function reachabilityScanWallsets(
  buf: Uint8Array,
  startPos: number,
  options: EclDecodeOptions = {},
): ReachabilityResult {
  const base = options.base ?? 0x8000;
  const opcodeTable = options.opcodeTable ?? OPCODE_TABLE;
  const wallsetLoad = options.wallsetLoad ?? DEFAULT_WALLSET_LOAD;
  const maxVisited = options.maxVisited ?? 20000;

  const visited = new Set<number>();
  const worklist: number[] = [startPos];
  const hits: WallsetHit[] = [];
  const newEclTargets: StaticValue[] = [];
  let unknownOpcodes = 0;
  let desyncs = 0;

  const SLOT_LOC: Record<number, 1 | 2 | 3> = { 0x322: 1, 0x324: 2, 0x326: 3 };

  while (worklist.length && visited.size < maxVisited) {
    const pos = worklist.pop() as number;
    if (pos < 0 || pos >= buf.length || visited.has(pos)) continue;
    visited.add(pos);

    const instr = parseInstr(buf, pos, opcodeTable);
    if (!instr) {
      unknownOpcodes++;
      worklist.push(pos + 1);
      continue;
    }

    if (instr.cmd === wallsetLoad.opcode) {
      if (wallsetLoad.mode === 'load-pieces') {
        hits.push({
          atPos: pos,
          via: 'LOAD PIECES',
          slot1: staticCmdValue(instr.ops[0]),
          slot2: staticCmdValue(instr.ops[1]),
          slot3: staticCmdValue(instr.ops[2]),
        });
      } else if (wallsetLoad.mode === 'load-pieces-skip-first') {
        // Treasures of the Savage Frontier's 0x42 "LOAD AREA": operand 0 is
        // the geo id, slots are operands 1-3 — see module doc.
        hits.push({
          atPos: pos,
          via: 'LOAD PIECES',
          slot1: staticCmdValue(instr.ops[1]),
          slot2: staticCmdValue(instr.ops[2]),
          slot3: staticCmdValue(instr.ops[3]),
        });
      } else {
        // 'fill-all-from-second-operand': one wallset id fills all 3 slots.
        const v = staticCmdValue(instr.ops[1]);
        hits.push({ atPos: pos, via: 'LOAD FILES', slot1: v, slot2: v, slot3: v });
      }
    }
    if (instr.cmd === 0x20) {
      // NEWECL: switch execution to a different ECL block by id — see
      // `newEclTargets`'s doc.
      newEclTargets.push(staticCmdValue(instr.ops[0]));
    }
    if (instr.cmd === 0x09) {
      const loc = instr.ops[1].word; // CMD_Save: gbl.cmd_opps[2].Word — destination address, always literal
      const slot = loc !== undefined ? SLOT_LOC[loc] : undefined;
      if (slot && instr.ops[0].code < 0x80) {
        const value = staticCmdValue(instr.ops[0]);
        const hit: WallsetHit = { atPos: pos, via: 'SAVE' };
        hit[`slot${slot}` as 'slot1' | 'slot2' | 'slot3'] = value;
        hits.push(hit);
      }
    }

    if (instr.cmd === 0x00 || instr.cmd === 0x13) continue; // EXIT / RETURN: terminal for this path
    if (instr.cmd === 0x01) {
      // GOTO: unconditional, target only.
      const w = instr.ops[0].word;
      if (w !== undefined) worklist.push(eclAddrToPos(w, base));
      else desyncs++;
      continue;
    }
    if (instr.cmd === 0x02) {
      // GOSUB: target (callee) + fallthrough (return site).
      const w = instr.ops[0].word;
      if (w !== undefined) worklist.push(eclAddrToPos(w, base));
      else desyncs++;
      worklist.push(instr.nextPos);
      continue;
    }
    if (instr.cmd === 0x25 || instr.cmd === 0x26) {
      // ON GOTO / ON GOSUB specifically: every jump-table-tail entry is
      // itself a jump target (unlike 0x15/0x27/0x2b's own dynamic tails,
      // which are ordinary data operands, not addresses), plus fallthrough
      // (the var_1 >= var_2 no-op case, and — for ON GOSUB — the eventual return).
      const headCount = opcodeTable[instr.cmd]?.dynamicTailHeadCount ?? 2;
      for (const op of instr.ops.slice(headCount)) {
        if (op.word !== undefined) worklist.push(eclAddrToPos(op.word, base));
      }
      worklist.push(instr.nextPos);
      continue;
    }
    if (instr.cmd >= 0x16 && instr.cmd <= 0x1b) {
      // IF =/<>/</>/<=/>=: condition-true path enters the following command
      // normally (its own edges get added when it's popped off the
      // worklist). condition-false path (SkipNextCommand) skips that WHOLE
      // following command and resumes at ITS OWN nextPos — an edge no
      // other opcode's dispatch adds for a followed command that doesn't
      // itself fall through (GOTO/GOSUB/ON GOTO/ON GOSUB/EXIT/RETURN). See
      // module doc's CFG correction.
      worklist.push(instr.nextPos); // condition-true: enter the following command
      const skipped = parseInstr(buf, instr.nextPos, opcodeTable);
      if (skipped) worklist.push(skipped.nextPos); // condition-false: skip it entirely
      continue;
    }
    worklist.push(instr.nextPos); // straight fallthrough
  }

  return { hits, visitedCount: visited.size, unknownOpcodes, desyncs, newEclTargets };
}

export interface WallsetBinding {
  /** Flat WALLDEF piece id for wallset slot 1/2/3 — see `resolveFlatWalldefId` in `goldbox-walltiles.ts` for turning this into a real WALLDEF entry id + wallset-within-entry. `undefined` = not statically resolved for this level (dynamic operand, or no hit found at all). */
  slot1?: number;
  slot2?: number;
  slot3?: number;
}

/**
 * Resolve one level's wallset-slot bindings: run `reachabilityScanWallsets`
 * (with the given engine-revision `options`) from every one of the block's
 * 5 header addresses that lands in-range (deduped by instruction position),
 * and fold every hit's STATIC operands into a single `{slot1,slot2,slot3}`
 * (first static value found per slot wins; `0xff`/`0x7f` sentinels —
 * "don't touch this slot" / "reset slot 1" — are passed through as-is, NOT
 * specially masked, since callers resolving against a real WALLDEF id space
 * will naturally find no match for them). If this block's own reachable
 * code has NO wallset-load hit at all and `options.resolveBlock` is given,
 * chases every `NEWECL` target found (in discovery order, first successful
 * chase wins, cycle-guarded) — see `ReachabilityResult.newEclTargets`'s doc
 * for why this is a real mechanism (a script literally handing execution to
 * another block), not a guess.
 */
export function findWallsetBindings(
  buf: Uint8Array,
  options: EclDecodeOptions = {},
  visitedBlockIds: Set<number> = new Set(),
): { binding: WallsetBinding; diagnostics: ReachabilityResult[] } {
  const base = options.base ?? 0x8000;
  const header = readEclHeader(buf);
  const starts = [
    header.vmRunAddr1,
    header.searchLocationAddr,
    header.preCampCheckAddr,
    header.campInterruptedAddr,
    header.eclInitialEntryPoint,
  ];
  const binding: WallsetBinding = {};
  const diagnostics: ReachabilityResult[] = [];
  const seenPos = new Set<number>();
  const newEclTargets: StaticValue[] = [];

  for (const word of starts) {
    const pos = eclAddrToPos(word, base);
    if (pos < 0 || pos >= buf.length) continue;
    const result = reachabilityScanWallsets(buf, pos, options);
    diagnostics.push(result);
    newEclTargets.push(...result.newEclTargets);
    for (const hit of result.hits) {
      if (seenPos.has(hit.atPos)) continue;
      seenPos.add(hit.atPos);
      for (const key of ['slot1', 'slot2', 'slot3'] as const) {
        if (binding[key] !== undefined) continue;
        const s = hit[key];
        if (s?.known && s.value !== undefined) binding[key] = s.value;
      }
    }
  }

  const resolvedAnySlot = binding.slot1 !== undefined || binding.slot2 !== undefined || binding.slot3 !== undefined;
  if (!resolvedAnySlot && options.resolveBlock) {
    for (const target of newEclTargets) {
      if (!target.known || target.value === undefined) continue;
      if (visitedBlockIds.has(target.value)) continue; // cycle guard
      const targetBuf = options.resolveBlock(target.value);
      if (!targetBuf) continue;
      const nextVisited = new Set(visitedBlockIds);
      nextVisited.add(target.value);
      const chased = findWallsetBindings(targetBuf, options, nextVisited);
      const chasedAny =
        chased.binding.slot1 !== undefined || chased.binding.slot2 !== undefined || chased.binding.slot3 !== undefined;
      if (chasedAny) return { binding: chased.binding, diagnostics: [...diagnostics, ...chased.diagnostics] };
    }
  }

  return { binding, diagnostics };
}

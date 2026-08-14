/**
 * MM2 (Amiga) `event.dat` script bytecode disassembler.
 *
 * `tools/mm2/event.ts` extracts each location's raw script bytes (the region
 * between the tile-triplet table's string-offset word and the string table)
 * but does not interpret them. This module turns those bytes into a
 * structured instruction list — a **disassembly**, not a VM executor: this
 * repo has no runtime game engine (extractors/docs/a viewer only), so there
 * is nothing to execute against.
 *
 * The opcode table below is a direct port of Vairn/MM2's
 * `EXTRACTED/docs/07-event-script-opcodes.md`, whose own authoritative
 * source is `game/src/events/EventRuntime.cpp` (`dispatchOp`) — a ~99%
 * ASM-faithful C++ reimplementation, cross-checked against the `0x172CA`
 * interpreter and `0x17494` jump table. Vairn's docs report the
 * argument-count table was verified by linearly walking every real
 * `event.dat` script end-to-end with **0 overruns, 0 underruns** (after
 * fixing `OP_12=12`, `OP_13=10`, `OP_15=3`, `OP_18=4`, `OP_30=10`).
 *
 * **Structure discovery (this repo's own verification):** a location's
 * script region is not one flat 0xFF-terminated stream — it is a
 * **sequence of per-handler scripts**, each terminated by `0xFF`, laid out
 * back to back in `handler_id` order (segment 0 first, segment 1 next, …).
 * A triplet's `handler_id` from the tile-event table is a **direct index**
 * into this list, matching `06-event-dat-format.md`'s "the interpreter
 * executes from the script start until the matching handler fires" —
 * i.e. it walks past `handler_id` 0xFF-terminated segments to reach the one
 * it wants. This was verified against the real retail `event.dat`: opcode-
 * boundary-aware walking (never mis-reading an operand byte as a delimiter,
 * since `0xFF` is only treated as a segment end when it appears at an
 * opcode position) consumes **every byte of every segment with zero leftover
 * and zero invalid opcodes** for locations 0–59 (1454/1454 segments) — see
 * `tools/mm2/__tests__/event-vm.test.ts`. The single documented exception is
 * location 67 (`Hall of Spells`), which Vairn's own doc calls a `mixed_pool`
 * containing "opcodes `> 0x32`" — i.e. plain text mixed in with real
 * bytecode by design, not a decode bug; those segments correctly surface
 * here as containing `INVALID_OP` bytes.
 *
 * Opcodes `0x00`..`0x32` (51 total); `0xFF` ends a handler's script. Opcode
 * `>= 0x33` (other than `0xFF`) is invalid per the ASM (`SCRIPT_ABORT`) and
 * is surfaced here as an `INVALID_OP` instruction rather than thrown.
 *
 * Three opcodes (`0x10`/`0x11`/`0x2B`) are **token-skip** ops: at runtime
 * they read a count byte and skip that many *subsequent opcodes* using a
 * separate ROM-derived per-opcode length table (not simply `1+argc` — see
 * the two documented ROM discrepancies in the source doc for `OP_00` and
 * `OP_25`, neither reachable in the shipped `event.dat`). This disassembler
 * does not simulate that runtime skip (there is no branch to follow for a
 * flat listing); the count byte is decoded as this opcode's own operand and
 * the following bytes are simply the next instructions in stream order,
 * exactly as they sit on disk.
 */

import type { EventFile } from './event.ts';

export interface EventVmOpcodeInfo {
  opcode: number;
  mnemonic: string;
  /** Fixed operand byte count, or 'var' for the token-skip ops (which take a single count-byte operand). */
  argc: number | 'var';
  summary: string;
}

/** Opcode table `0x00..0x32`, ported from `07-event-script-opcodes.md` §Opcode Table. */
export const EVENT_OPCODES: readonly EventVmOpcodeInfo[] = [
  { opcode: 0x00, mnemonic: 'INVALID', argc: 0, summary: 'invalid opcode -> SCRIPT_ABORT' },
  { opcode: 0x01, mnemonic: 'TEXT_LINE', argc: 1, summary: 'show text str[u8]; exit flag |= 1' },
  { opcode: 0x02, mnemonic: 'TEXT_BLOCK', argc: 1, summary: 'multi-line text block str[u8]; exit flag |= 2' },
  { opcode: 0x03, mnemonic: 'TEXT_BLOCK_TALL', argc: 1, summary: 'tall text block str[u8] (delegates to OP_02, height 0x11)' },
  { opcode: 0x04, mnemonic: 'DOOR_LABEL', argc: 1, summary: "door label str[u8]; skipped if can't-see" },
  { opcode: 0x05, mnemonic: 'POPUP_A', argc: 1, summary: "popup A (plain overlay) str[u8]; skipped if can't-see" },
  { opcode: 0x06, mnemonic: 'POPUP_B_SIGNPOST', argc: 1, summary: "outdoor signpost str[u8]; '-' -> '{'; skipped if can't-see" },
  { opcode: 0x07, mnemonic: 'WAIT_SPACE', argc: 0, summary: 'wait for SPACE' },
  { opcode: 0x08, mnemonic: 'WAIT_KEY', argc: 0, summary: 'wait for key (same SPACE wait in the port)' },
  { opcode: 0x09, mnemonic: 'YN_CLEAR_COND', argc: 0, summary: 'clear cond; Y/N sets cond_flag; draws nothing' },
  { opcode: 0x0a, mnemonic: 'YN_VARIANT', argc: 0, summary: 'Y/N variant (same wait)' },
  { opcode: 0x0b, mnemonic: 'SIGNBOARD', argc: 2, summary: '.anm signboard: sign index (NOT a string index), placement; exit flag |= 4' },
  { opcode: 0x0c, mnemonic: 'MAP_TRANSITION', argc: 2, summary: '(dest_screen, dest_tile) map transition; ends script' },
  { opcode: 0x0d, mnemonic: 'PLAY_SOUND_SEQ', argc: 1, summary: 'play sound sequence id 0..9 (audio, not graphics)' },
  { opcode: 0x0e, mnemonic: 'SELECTOR_DISPATCH', argc: 1, summary: 'town-service selector dispatch (shop/temple/training/guild/...)' },
  { opcode: 0x0f, mnemonic: 'END_SCRIPT', argc: 0, summary: 'end script / cleanup' },
  { opcode: 0x10, mnemonic: 'SKIP_IF_COND', argc: 'var', summary: 'if cond_flag: skip N tokens (count byte operand)' },
  { opcode: 0x11, mnemonic: 'SKIP_IF_NOT_COND', argc: 'var', summary: 'if !cond_flag: skip N tokens (count byte operand)' },
  { opcode: 0x12, mnemonic: 'FIXED_ENCOUNTER', argc: 12, summary: '10 monster ids + overflow_type + live_count -> fixed combat' },
  { opcode: 0x13, mnemonic: 'RANDOM_ENCOUNTER', argc: 10, summary: '10 monster ids -> seeded-random combat (picker augments)' },
  { opcode: 0x14, mnemonic: 'CLEAR_TILE_EVENT_BIT', argc: 0, summary: 'clear current tile visited/event bit' },
  { opcode: 0x15, mnemonic: 'PARTY_FIELD_TEST', argc: 3, summary: 'party field test: member-spec, selector, val -> OR into cond_flag' },
  { opcode: 0x16, mnemonic: 'PARTY_ITEM_SCAN', argc: 2, summary: 'scan equipped+backpack for item id (arg2); cond = match count' },
  { opcode: 0x17, mnemonic: 'LOAD_VAR', argc: 2, summary: 'cond_flag = *var(id) raw byte (2nd arg discarded)' },
  { opcode: 0x18, mnemonic: 'PARTY_FIELD_WRITE', argc: 4, summary: 'party field masked write (field & and) | or' },
  { opcode: 0x19, mnemonic: 'GIVE_ITEM', argc: 4, summary: 'give item: member-spec, id, charges, flags -> backpack/overflow' },
  { opcode: 0x1a, mnemonic: 'STORE_VAR', argc: 2, summary: 'store u8 into var id (id, value)' },
  { opcode: 0x1b, mnemonic: 'COND_THRESHOLD_CLEAR', argc: 1, summary: 'if cond < threshold: clear cond' },
  { opcode: 0x1c, mnemonic: 'RNG_ROLL', argc: 1, summary: 'cond_flag = rng(1, u8) raw roll' },
  { opcode: 0x1d, mnemonic: 'AUDIO_WAIT', argc: 1, summary: 'audio wait helper (arg*7+1); presentation only, no GS write' },
  { opcode: 0x1e, mnemonic: 'TIMED_WAIT', argc: 1, summary: 'timed busy-wait (presentation only; headless no-op)' },
  { opcode: 0x1f, mnemonic: 'PARTY_EFFECT', argc: 6, summary: 'party effect add/sub' },
  { opcode: 0x20, mnemonic: 'PARTY_EFFECT_VARIANT', argc: 6, summary: 'party effect variant (mode=1)' },
  { opcode: 0x21, mnemonic: 'PATCH_MAP_TILE', argc: 3, summary: 'patch map tile (y,x) visual+collision; exit flag |= 4' },
  { opcode: 0x22, mnemonic: 'ERA_RANGE_TEST', argc: 2, summary: 'cond = era_low in [lo, hi]' },
  { opcode: 0x23, mnemonic: 'DAY_GATE', argc: 2, summary: '0xB5=odd-day, 0xB6=even-day, else inclusive [arg1,arg2] day range' },
  { opcode: 0x24, mnemonic: 'GOLD_PAY', argc: 2, summary: 'gold pool-pay LE u16 (check+deduct+pool); cond = success' },
  { opcode: 0x25, mnemonic: 'GEMS_PAY', argc: 2, summary: 'gems pool-pay BE u16; ROM skip-table off-by-one, not reachable in retail data' },
  { opcode: 0x26, mnemonic: 'SELECT_MEMBER', argc: 0, summary: 'select party member (wait)' },
  { opcode: 0x27, mnemonic: 'SELECT_MEMBER_ALT', argc: 0, summary: 'select party member, alternate input path (same wait)' },
  { opcode: 0x28, mnemonic: 'BACKPACK_CONSUME', argc: 2, summary: 'backpack-only consume item id (arg2) -> cond' },
  { opcode: 0x29, mnemonic: 'ABORT', argc: 0, summary: 'SCRIPT_ABORT = 1' },
  { opcode: 0x2a, mnemonic: 'FOUND_ITEM_FILL', argc: 14, summary: 'fill found-item buffer (gold/gems/3x id+charges+flags)' },
  { opcode: 0x2b, mnemonic: 'SKIP_IF_VICTORY', argc: 'var', summary: 'skip N tokens only if combat-victory latch set (count byte operand)' },
  { opcode: 0x2c, mnemonic: 'WORD_COUNTER', argc: 1, summary: 'word counter += u8; exit flag |= 1' },
  { opcode: 0x2d, mnemonic: 'PARTY_MATCH', argc: 2, summary: 'match party class/sex/race (any/all)' },
  { opcode: 0x2e, mnemonic: 'PARTY_FIELD_OR_PAIR', argc: 2, summary: 'OR arg2 into member field for class pair {4,2} or {3,1}' },
  { opcode: 0x2f, mnemonic: 'READ_ANSWER', argc: 0, summary: 'read typed answer (up to 10 chars); NOT a silent clear' },
  { opcode: 0x30, mnemonic: 'PASSWORD_CHECK', argc: 10, summary: 'password check: toupper(input[i]) == (0x11A - expected[i])' },
  { opcode: 0x31, mnemonic: 'DAMAGE_ITERATE', argc: 3, summary: 'damage iterate; abort if no living party members remain' },
  { opcode: 0x32, mnemonic: 'TITLE_COUNT', argc: 1, summary: "cond = count of living members' title-nibble == id (NOT a var load)" },
];

const OPCODE_BY_VALUE = new Map(EVENT_OPCODES.map((op) => [op.opcode, op]));

/** `0xFF` ends a per-handler script segment, per the documented format. */
export const EVENT_SCRIPT_TERMINATOR = 0xff;

export interface EventVmInstruction {
  /** Byte offset of the opcode within its segment (relative to the segment's own start, not the whole script blob). */
  offset: number;
  opcode: number;
  mnemonic: string;
  /** Raw operand bytes, in stream order (for token-skip ops, the single count byte). */
  operands: number[];
}

/** One `handler_id`-indexed script segment within a location's script blob. */
export interface EventVmScript {
  /** Index into the script blob's 0xFF-delimited segment list — matches `EventTriplet.handlerId`. */
  handlerIndex: number;
  /** Raw bytes of this segment (without the terminating 0xFF). */
  raw: Uint8Array;
  instructions: EventVmInstruction[];
  /** True iff every byte decoded as a known opcode + its documented operand count, and the segment was properly 0xFF-terminated. */
  clean: boolean;
}

/** Look up static info for one opcode (undefined for anything outside `0x00..0x32`). */
export function lookupEventOpcode(opcode: number): EventVmOpcodeInfo | undefined {
  return OPCODE_BY_VALUE.get(opcode);
}

/**
 * Disassemble a full location script blob (`EventLocation.script`) into its
 * `handler_id`-indexed segments. Walks the byte stream opcode-by-opcode using
 * the documented per-opcode operand counts, so `0xFF` is only treated as a
 * segment terminator when it occurs at an opcode boundary — an operand byte
 * that happens to equal `0xFF` can never be mistaken for one (this matters
 * for opcodes whose operands are arbitrary `u8`s, e.g. `TEXT_LINE`'s string
 * index). The last segment is marked `clean: false` if the blob doesn't end
 * with a final `0xFF` (should not happen for `standard` locations; see the
 * module doc for the one documented exception, location 67).
 */
export function disassembleEventLocationScript(script: Uint8Array): EventVmScript[] {
  const segments: EventVmScript[] = [];
  let handlerIndex = 0;
  let instructions: EventVmInstruction[] = [];
  let invalid = false;
  let segStart = 0;
  let i = 0;

  while (i < script.length) {
    const b = script[i];
    if (b === EVENT_SCRIPT_TERMINATOR) {
      segments.push({ handlerIndex, raw: script.subarray(segStart, i), instructions, clean: !invalid });
      handlerIndex += 1;
      instructions = [];
      invalid = false;
      i += 1;
      segStart = i;
      continue;
    }

    const info = lookupEventOpcode(b);
    const offset = i - segStart;
    if (!info) {
      instructions.push({ offset, opcode: b, mnemonic: 'INVALID_OP', operands: [] });
      invalid = true;
      i += 1;
      continue;
    }

    const argc = info.argc === 'var' ? 1 : info.argc;
    const operands: number[] = [];
    for (let k = 0; k < argc; k++) operands.push(script[i + 1 + k] ?? 0);
    instructions.push({ offset, opcode: b, mnemonic: info.mnemonic, operands });
    i += 1 + argc;
  }

  // Leftover bytes with no closing 0xFF (not expected for standard scripts).
  if (instructions.length > 0 || i > segStart) {
    segments.push({ handlerIndex, raw: script.subarray(segStart), instructions, clean: false });
  }

  return segments;
}

/** Render one segment's instructions as a human-readable text listing, e.g. for spot-checks against Vairn's `08-event-decoded.txt` / `10-event-decompiled.txt`. */
export function formatEventVmScript(seg: EventVmScript): string {
  const lines = seg.instructions.map((inst) => {
    const hex = inst.operands.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const opHex = inst.opcode.toString(16).padStart(2, '0');
    return `${inst.offset.toString(10).padStart(4, ' ')}: ${opHex} ${inst.mnemonic}${hex ? ' ' + hex : ''}`;
  });
  return lines.join('\n');
}

export interface EventVmLocationDisassembly {
  locationId: number;
  kind: string;
  segments: EventVmScript[];
}

/**
 * Disassemble every location's script blob in a parsed `event.dat` (see
 * `tools/mm2/event.ts::decodeEventFile`). Locations with no script bytes
 * (empty `.script`, e.g. the castle-blob layouts at 63/65/68) get an empty
 * segment list.
 */
export function disassembleEventFile(file: EventFile): EventVmLocationDisassembly[] {
  return file.locations.map((loc) => ({
    locationId: loc.id,
    kind: loc.kind,
    segments: loc.script.length > 0 ? disassembleEventLocationScript(loc.script) : [],
  }));
}

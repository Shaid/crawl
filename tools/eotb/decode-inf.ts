/**
 * Eye of the Beholder 1 (Amiga) `.INF` -- level configuration parser:
 * wall-set name, door-shape/monster-shape header fields, and (the part
 * this file exists for) the real per-level wallIndex -> vmpIndex/
 * decIndex/specialType/flags override table that `docs/eotb/TODO.md`'s
 * `eotb1-amiga-walker-wallmapping` row tracked as open.
 *
 * **Root cause of the previous session's failure, now identified.** The
 * file *is* LCW-compressed (`decompressLCW` from `./lcw.ts`, the same
 * "Format 80" codec already verified against 62 real `.CPS` files) --
 * its header is a byte-exact standard CPS header (`FileSize`/
 * `CompressionType=4`/`UncompressedSize`/`PaletteSize`, see
 * `docs/eotb/amiga/data-structure.md` § "CPS -- Header"). A previous pass
 * assumed "not compressed" because `strings LEVEL1.INF` shows readable
 * `level1.maz`/`brick`/`kobold`/`leech` directly in the raw file bytes --
 * but LCW's own "Command 1" (short literal copy) copies source bytes
 * verbatim for any run under 64 bytes, so short ASCII names appearing
 * unmangled in the *compressed* stream is expected, not evidence against
 * compression. Hand-walking the never-decompressed compressed bytes
 * against the *decompressed*-buffer struct offsets ScummVM's source
 * describes was therefore guaranteed to drift -- not because the Amiga
 * on-disk struct layout diverges from ScummVM's (it doesn't, once you
 * decompress first), but because the previous attempt was reading the
 * wrong buffer entirely.
 *
 * **Verification method.** Real LCW decompression (via this repo's own
 * already-oracle-checked decoder) of every real `data/eotb/amiga/
 * LEVEL{1..11}.INF` file, then a byte-for-byte simulation of
 * `EoBCoreEngine::initLevelData`'s `_flags.gameID == GI_EOB1` control
 * flow (`engines/kyra/engine/scene_eob.cpp:155-310`, fetched from
 * `github.com/scummvm/scummvm` -- these are the engine's own **Amiga**
 * platform branches, e.g. line 233's `_flags.platform ==
 * Common::kPlatformAmiga` block and the `_flags.gameID == GI_EOB1`
 * conditionals threaded throughout, not the DOS-generic ModdingWiki
 * struct the previous session tried) and `EoBCoreEngine::
 * loadActiveMonsterData` (`engines/kyra/engine/sprites_eob.cpp:62-95`).
 * Every one of the 11 real level files decodes with **zero drift**: the
 * pointer walk lands on real, sensible values at every field --
 * `mazeName`/wall-set name match the known corpus (`level1.maz`/`brick`,
 * etc.), monster-shape names are real game monster names (`kobold`/
 * `leech` for level 1), and the walk terminates well inside the
 * decompressed buffer with no out-of-range read. This is byte-exact
 * confirmation against the real files using the Amiga port's own
 * platform-specific ScummVM source branches, not a DOS-oriented guess.
 * (A from-scratch disassembly of the Amiga executable's own `.INF`
 * parser was also attempted this session -- `data/eotb/amiga/eob2`,
 * IRA `-preproc` -- but the relevant table lives inside a `HUNK_DATA`
 * segment (module 12, file offset 162732, 2600 bytes) that itself
 * contains code-shaped byte patterns IRA doesn't classify as a function;
 * not resolved further given the time budget, since the file-level
 * verification above is already byte-exact and non-drifting across the
 * whole corpus.)
 *
 * **Field layout (EOB1, `slen=12`), offsets relative to the start of the
 * *decompressed* buffer:**
 *
 * | Offset | Size | Field |
 * |---|---|---|
 * | 0 | 2 | `triggersOffset` (u16 LE, unused by this parser) |
 * | 2 | 12 | `mazeName` (NUL-terminated, e.g. `"level1.maz"`) |
 * | 14 | 12 | `wallSetName` (NUL-terminated, e.g. `"brick"` -- also reused verbatim by the engine to build `<name>.PAL`; there is no separate on-disk palette-name field for EOB1) |
 * | 26 | 12 | reserved -- read but never used by the EOB1 code path (`pos++` then `pos+=11`) |
 * | 38 | 4 | door-shape params (4 raw bytes -> `loadDoorShapes`) |
 * | 42 | 1 | `scriptTimersMode` |
 * | 43 | 2 | script timer 0 ticks (u16 LE) |
 * | 45 | 2 | `stepsUntilScriptCall` (u16 LE) |
 * | 47 | 13 | monster shape 1: 1 compression/type byte (0xFF = none) + up to 12-byte name |
 * | 60 | 13 | monster shape 2: same shape |
 * | 73 | variable | `(type, interval)*` pairs, terminated by a `0xFF` type byte (`loadActiveMonsterData`) |
 * | (follows) | 420 | fixed 30-slot x 14-byte monster-placement array (same function) |
 * | (follows) | 1 + 2 | 1 discriminator byte (unused for EOB1) + `num` (u16 LE) decoration/wall-mapping record count |
 * | (follows) | variable | `num` records, each either a decoration-load record (`0xEC` + two 12-byte names, 25 bytes) or a **wall-mapping override** record (any other byte first, 6 bytes: 1 unused discriminator + `[wallIndex][vmpIndex][decIndex:int8][specialType][flags]`) |
 *
 * The wall-mapping override is exactly `docs/eotb/amiga/eotb-inf-spec.md`'s
 * `0xFB WallMapping` hypothesis's field set, minus a real "0xFB" marker
 * byte (EOB1's discriminator byte is simply "not 0xEC", not a fixed
 * sentinel) -- confirmed by `assignWallsAndDecorations`'s own signature
 * (`engines/kyra/engine/scene_eob.cpp:466`):
 * `assignWallsAndDecorations(int wallIndex, int vmpIndex, int decIndex,
 * int specialType, int flags)`.
 */
import { decompressLCW } from './lcw.ts';

const WALL_SETS = ['BRICK', 'BLUE', 'DROW', 'GREEN', 'XANATHA'] as const;
export type WallSet = (typeof WALL_SETS)[number];

const SLEN = 12; // EOB1's fixed name-field width.

/** Decompress a raw `.INF` file (standard CPS-style LCW header) to its full decompressed byte buffer. */
export function decompressInf(infData: Uint8Array): Uint8Array {
  const view = new DataView(infData.buffer, infData.byteOffset, infData.byteLength);
  const compressionType = view.getUint16(2, true);
  const uncompressedSize = view.getUint32(4, true);
  const paletteSize = view.getUint16(8, true);
  if (compressionType !== 4) {
    throw new Error(`decompressInf: oracle check failed -- expected CompressionType=4 (LCW), got ${compressionType}`);
  }
  const body = infData.subarray(10 + paletteSize);
  const out = decompressLCW(body, uncompressedSize);
  if (out.length !== uncompressedSize) {
    throw new Error(`decompressInf: oracle check failed -- decompressed ${out.length} bytes, expected ${uncompressedSize}`);
  }
  return out;
}

function cstr(buf: Uint8Array, off: number, maxLen = SLEN): string {
  let end = off;
  while (end < off + maxLen && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(off, end)).toString('latin1');
}

export interface WallMappingOverride {
  wallIndex: number;
  vmpIndex: number;
  decIndex: number; // -1 = no decoration
  specialType: number;
  flags: number;
}

export interface DecorationLoadRecord {
  cpsFile: string;
  decFile: string;
}

/** One record from the interleaved wall-mapping/decoration-load stream, in real on-disk order -- see `parseInfRecords`'s doc comment for why order matters. */
export type InfRecord =
  | { kind: 'decoration-load'; record: DecorationLoadRecord }
  | { kind: 'wall-mapping'; record: WallMappingOverride };

export interface InfLevelData {
  mazeName: string;
  wallSetName: string;
  monsterShapes: Array<{ compressionOrType: number; name: string | null }>;
  wallMappings: WallMappingOverride[];
  decorationLoads: DecorationLoadRecord[];
  /** The same records as `wallMappings`/`decorationLoads`, but preserving real file order -- required to resolve which decoration-load's `.CPS`/`.DAT` pair is "active" for a given wall-mapping record (see `resolveWallDecorationAssignments`). */
  records: InfRecord[];
}

/**
 * Parse a decompressed EOB1 `.INF` buffer's level header + wall-mapping/
 * decoration-load record stream, replicating `EoBCoreEngine::
 * initLevelData`'s `gameID == GI_EOB1` control flow exactly (`sub=0`,
 * i.e. the primary level load, not a sub-section). See this module's
 * doc comment for the full field-offset table and citations.
 */
export function parseInfLevelData(buf: Uint8Array): InfLevelData {
  const u16 = (off: number) => buf[off]! | (buf[off + 1]! << 8);

  let pos = 2; // getCPagePtr(5) + 2
  // for(sub) loop skipped (sub=0); pos += 2; then pos -= 3 for gameID==EOB1 -> net pos unchanged (=2).
  const mazeName = cstr(buf, pos);
  pos += SLEN;
  const wallSetName = cstr(buf, pos);
  pos += SLEN;
  pos += 1; // *pos++ != 0xFF && gameID==EOB2 (side effect only, EOB1 never takes the branch)
  pos += 11; // gameID==EOB1 reserved skip (total 12 bytes for this field, 1 already consumed above)

  pos += 4; // door-shape params (loadDoorShapes(pos[0..3]))
  pos += 1; // scriptTimersMode
  pos += 2; // script timer 0 ticks
  pos += 2; // stepsUntilScriptCall

  const monsterShapes: InfLevelData['monsterShapes'] = [];
  for (let i = 0; i < 2; i++) {
    const compressionOrType = buf[pos]!;
    const name = compressionOrType !== 0xff ? cstr(buf, pos + 1) : null;
    monsterShapes.push({ compressionOrType, name });
    pos += 13;
  }

  // loadActiveMonsterData: variable (type,interval) pairs terminated by 0xFF, then a fixed 30*14=420-byte placement array.
  let p = buf[pos++]!;
  while (p !== 0xff) {
    pos += 1; // interval byte
    p = buf[pos++]!;
  }
  pos += 30 * 14;
  pos -= 1; // pos = loadActiveMonsterData(...) - 1

  pos += 1; // *pos++ == 0xEC || gameID==EOB1 (side effect only)
  const num = u16(pos);
  pos += 2;

  const wallMappings: WallMappingOverride[] = [];
  const decorationLoads: DecorationLoadRecord[] = [];
  const records: InfRecord[] = [];
  for (let i = 0; i < num; i++) {
    const disc = buf[pos]!;
    pos += 1;
    if (disc === 0xec) {
      const record = { cpsFile: cstr(buf, pos), decFile: cstr(buf, pos + SLEN) };
      decorationLoads.push(record);
      records.push({ kind: 'decoration-load', record });
      pos += SLEN * 2;
    } else {
      const wallIndex = buf[pos]!;
      const vmpIndex = buf[pos + 1]!;
      const decIndexRaw = buf[pos + 2]!;
      const decIndex = decIndexRaw >= 128 ? decIndexRaw - 256 : decIndexRaw;
      const specialType = buf[pos + 3]!;
      const flags = buf[pos + 4]!;
      const record = { wallIndex, vmpIndex, decIndex, specialType, flags };
      wallMappings.push(record);
      records.push({ kind: 'wall-mapping', record });
      pos += 5;
    }
  }

  return { mazeName, wallSetName, monsterShapes, wallMappings, decorationLoads, records };
}

/** Decompress + parse a raw `.INF` file in one step. */
export function parseInf(infData: Uint8Array): InfLevelData {
  return parseInfLevelData(decompressInf(infData));
}

/**
 * Build the real 256-entry rawWallIndex -> vmpIndex lookup table for a
 * level: `EoBCoreEngine::resetWallData`'s default table
 * (`engines/kyra/engine/scene_eob.cpp:542-548` -- `{1:1, 2:2, 3..22:3,
 * 23:4, 24:5}`, everything else including 0 defaults to run 0, i.e. "no
 * wall") with this level's `.INF` wall-mapping overrides applied on top
 * (`assignWallsAndDecorations`'s first line: `_wllVmpMap[wallIndex] =
 * vmpIndex`). This replaces `view-model.ts`'s old `clampWallType`
 * (raw > 6 -> generic solid wall 1) with the real per-level mapping.
 */
export function buildWallTypeMap(infData: Uint8Array): Uint8Array {
  const map = new Uint8Array(256); // all zero = "no wall" default
  map[1] = 1;
  map[2] = 2;
  for (let i = 3; i <= 22; i++) map[i] = 3;
  map[23] = 4;
  map[24] = 5;

  const { wallMappings } = parseInf(infData);
  for (const { wallIndex, vmpIndex } of wallMappings) {
    map[wallIndex] = vmpIndex;
  }
  return map;
}

/** A wall's decoration assignment: which decoration-load's `.CPS`/`.DAT` pair is active, plus the `decIndex` to chain from (`decode-decorations.ts`'s `decorationChain`). */
export interface WallDecorationAssignment {
  cpsFile: string;
  decFile: string;
  decIndex: number;
}

/**
 * Pair each wall-mapping override's `decIndex` with the decoration-load
 * (`.CPS`/`.DAT` pair) that was **most recently loaded before it** in the
 * real on-disk record order -- `docs/eotb/amiga/data-structure.md`'s
 * "INF -- Level Configuration" section documents the field layout but
 * (like the original `decode-inf.ts`, before this function) exposed
 * `wallMappings`/`decorationLoads` as two separate, order-losing arrays.
 * This matters because `loadDecorations` **reassigns**
 * `_levelDecorationData`/`_levelDecorationDataSize` on every `0xEC`
 * record -- confirmed on the real corpus: `LEVEL1.INF` interleaves 3
 * decoration-loads (`brick1`, `brick2`, `brick3`, all against
 * `brick.dat`) with wall-mapping records in between, and each
 * wall-mapping's `decIndex` only makes sense against the data loaded by
 * the closest **preceding** decoration-load record (verified by manually
 * walking the decompressed byte stream in order -- see this session's
 * probe in the TODO/data-structure.md citation for the full 27-record
 * trace). Skips wall-mapping records with `decIndex === -1` (no
 * decoration) and any wall-mapping that appears before the first
 * decoration-load (never observed in the real corpus, but would have no
 * active `.CPS`/`.DAT` pair to resolve against).
 */
export function resolveWallDecorationAssignments(infData: Uint8Array): Map<number, WallDecorationAssignment> {
  const { records } = parseInf(infData);
  const assignments = new Map<number, WallDecorationAssignment>();
  let active: DecorationLoadRecord | null = null;
  for (const rec of records) {
    if (rec.kind === 'decoration-load') {
      active = rec.record;
    } else if (rec.record.decIndex !== -1 && active) {
      assignments.set(rec.record.wallIndex, { cpsFile: active.cpsFile, decFile: active.decFile, decIndex: rec.record.decIndex });
    }
  }
  return assignments;
}

/**
 * Resolve a level's wall-set name (e.g. `BRICK`) from its `.INF` file.
 * Now backed by the real parsed `wallSetName` field (see module doc)
 * rather than a plain-text token scan.
 */
export function findWallSet(infData: Uint8Array): WallSet {
  const { wallSetName } = parseInf(infData);
  const upper = wallSetName.toUpperCase();
  const match = WALL_SETS.find((name) => name === upper);
  if (!match) {
    throw new Error(`findWallSet: parsed wallSetName ${JSON.stringify(wallSetName)} is not one of ${WALL_SETS.join('/')}`);
  }
  return match;
}

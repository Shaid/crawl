/**
 * Eye of the Beholder II (DOS/VGA) `.INF` level -> maze/wall-set
 * resolution.
 *
 * `.INF` is **LCW-compressed** behind the same "Kyra bitmap" header as
 * `.CPS`/`.VCN` (`docs/eotb/dosvga/data-structure.md` § "Kyra shared
 * bitmap header"): 2-byte `fileSizeField` (unused), u16 LE `compType`
 * (0=raw, 4=LCW), u32 LE `imgSize` (decompressed size), u16 LE `palSize`
 * (0 in this corpus), then the payload -- confirmed empirically this
 * session (decompressing every real `LEVELn.INF`, n=1..16, reproduces
 * exactly `imgSize` bytes with fully legible embedded strings).
 *
 * **Root-caused (2026-08-29): EOB2's header preamble genuinely differs
 * from EOB1's, both in start offset and field width.** `docs/eotb/dosvga/
 * data-structure.md` § "INF" -> "Decompressed buffer layout (EOB1)" is
 * correct for EOB1 -- it was never wrong, it just doesn't transfer
 * unmodified to EOB2. Traced directly from ScummVM's
 * `EoBCoreEngine::initLevelData` (engine/scene_eob.cpp, fetched fresh
 * 2026-08-29):
 *
 * ```cpp
 * const uint8 *data = _screen->getCPagePtr(5) + 2;   // skip trailerOffset (u16 @ 0x000)
 * const uint8 *pos = data;                            // = buffer + 2
 * int slen = (_flags.gameID == GI_EOB1) ? 12 : 13;     // <-- EOB2's cstring fields are 13 bytes, not 12
 * // (sub-level chaining loop skipped here for sub == 0, the only case this
 * //  module handles -- it would advance pos via a u16 LE pointer stored at
 * //  buffer+0x002 when sub > 0)
 * pos += 2;                                            // buffer + 4
 * if (*pos++ == 0xEC || _flags.gameID == GI_EOB1) {     // tag byte @ 0x004; *pos++ always executes
 *     if (_flags.gameID == GI_EOB1) pos -= 3;           // EOB1: undoes the +2/+1 above -> mazStem @ buffer+2
 *     loadBlockProperties(pos);                         // EOB2: pos = buffer + 5 here -> mazStem @ 0x005
 *     pos += slen;                                      // -> wallSetStem @ 0x005 + 13 = 0x012 (EOB2 only)
 *     ... getVmpData(pos) / paletteFilePattern(pos) ...
 *     pos += slen;                                      // -> flag byte @ 0x012 + 13 = 0x01F (EOB2 only)
 *     if (*pos++ != 0xFF && _flags.gameID == GI_EOB2) {  // second (optional) wall-set-name field
 *         tmpStr = format(paletteFilePattern, pos);      // second stem @ 0x020
 *         pos += 13;
 *     }
 *     ...
 * }
 * ```
 *
 * So for EOB2 (sub == 0), the real absolute offsets are:
 *   0x000 (2)  trailerOffset, u16 LE (shared with EOB1, unused by this module)
 *   0x002 (2)  sub-level chain pointer, u16 LE (unused for sub == 0)
 *   0x004 (1)  tag byte -- must be 0xEC for the block-properties/VMP/palette
 *              load to happen at all; confirmed present (0xEC) in all 16
 *              real LEVELn.INF files
 *   0x005 (13) mazStem, NUL-padded cstring (13 bytes, not EOB1's 12)
 *   0x012 (13) wallSetStem, NUL-padded cstring (13 bytes)
 *   0x01F (1)  secondWallSetFlag -- 0xFF = no second field, else a second
 *              wall-set stem follows (used to pick a second palette --
 *              `paletteFilePattern` is re-applied to it exactly like the
 *              first; ScummVM never explains further what consumes the
 *              second palette beyond loading it into `tmpStr`, so its
 *              in-game *use* remains untraced, but the field itself is now
 *              fully decoded, not just "confirmed to exist from source")
 *   0x020 (13) secondWallSetStem, NUL-padded cstring, present only when
 *              the flag byte != 0xFF
 *
 * **Verified against all 16 real `LEVELn.INF` files** (see
 * `docs/eotb2/dosvga/data-structure.md` § "INF -- Level configuration
 * (EOB2)"): tag byte is 0xEC in all 16; `mazStem`/`wallSetStem` both decode
 * to fully legible, already-known-correct values (matching the
 * previously-shipped token-scan output exactly, including the two
 * documented maze-reuse cases `LEVEL16->level15.maz`,
 * `LEVEL14->level12.maz`); the second wall-set field is present (flag
 * byte `0x01`) in exactly `LEVEL10.INF`-`LEVEL14.INF` and decodes to
 * `"azure"` in every one of those 5 cases -- resolving the
 * `eotb2-dos-cps-palette-second-field` TODO item as the very same
 * discovery as this offset fix, exactly as suspected.
 *
 * This replaces the previous token-scan workaround (kept only as a
 * fallback if the fixed-offset read fails an internal sanity check, so a
 * genuinely malformed/future file degrades gracefully instead of throwing
 * outright).
 */
import { decompressLCW } from '../eotb/lcw.ts';

const WALL_SETS = ['DUNG', 'FOREST', 'MEZZ', 'SILVER', 'CRIMSON', 'AZURE'] as const;
const SCAN_WINDOW = 64;
const STEM_LEN = 13; // EOB2's cstring field width (EOB1 uses 12 -- see module doc)
const TAG_BYTE = 0xec;

export interface InfHeader {
  mazStem: string;
  wallSetStem: string;
  /** Optional second wall-set stem (an alternate/overlay palette), present
   * on 5 of the 16 real EOB2 levels (LEVEL10-14, all resolving to
   * "azure"). `undefined` when the header's flag byte is 0xFF. */
  secondWallSetStem?: string;
}

function readCString(buf: Uint8Array, start: number, maxLen: number): string | null {
  const end = buf.indexOf(0, start);
  if (end < 0 || end - start >= maxLen || end === start) return null;
  const s = Buffer.from(buf.subarray(start, end)).toString('latin1');
  // Reject anything with non-printable bytes -- a real cstring field should
  // be plain ASCII; garbage here means our offset assumption is wrong.
  if (!/^[\x20-\x7e]+$/.test(s)) return null;
  return s;
}

/** Plain NUL-terminated cstring read, no printable-only rejection -- used for record-stream fields (monster-shape name, decoration-load cpsFile/decFile) once the header itself has already been validated by `decodeFixedOffsets`. Matches EOB1's `tools/eotb/decode-inf.ts`'s `cstr` helper. */
function cstrLatin1(buf: Uint8Array, start: number, maxLen: number): string {
  let end = start;
  while (end < start + maxLen && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString('latin1');
}

function decodeFixedOffsets(decompressed: Uint8Array): InfHeader | null {
  if (decompressed.length < 0x020 + STEM_LEN) return null;
  const tag = decompressed[0x004];
  if (tag !== TAG_BYTE) return null;

  const mazStem = readCString(decompressed, 0x005, STEM_LEN);
  if (!mazStem || !/\.maz$/i.test(mazStem)) return null;

  const wallSetStem = readCString(decompressed, 0x005 + STEM_LEN, STEM_LEN);
  if (!wallSetStem || !WALL_SETS.includes(wallSetStem.toUpperCase() as (typeof WALL_SETS)[number])) return null;

  const flag2Off = 0x005 + STEM_LEN * 2;
  const flag2 = decompressed[flag2Off];
  let secondWallSetStem: string | undefined;
  if (flag2 !== 0xff) {
    const second = readCString(decompressed, flag2Off + 1, STEM_LEN);
    if (second) secondWallSetStem = second;
  }

  return { mazStem, wallSetStem, secondWallSetStem };
}

function decodeTokenScanFallback(decompressed: Uint8Array): InfHeader {
  const window = decompressed.subarray(0, Math.min(SCAN_WINDOW, decompressed.length));
  const text = Buffer.from(window).toString('latin1').replace(/[^\x20-\x7e]/g, '.');

  const mazMatch = /([a-z][a-z0-9_]*\.maz)/i.exec(text);
  if (!mazMatch) throw new Error(`decodeInf: oracle check failed -- no "*.maz" token found in the first ${SCAN_WINDOW} bytes`);
  const mazStem = mazMatch[1]!;

  const upper = text.toUpperCase();
  const wallSetStem = WALL_SETS.find((w) => upper.includes(w));
  if (!wallSetStem) {
    throw new Error(`decodeInf: oracle check failed -- no known wall-set token found (looked for ${WALL_SETS.join('/')})`);
  }

  return { mazStem, wallSetStem };
}

/** Decompress a raw `.INF` file (standard Kyra-bitmap-header LCW/raw payload) to its full decompressed byte buffer. Shared by `decodeInf` (header-only) and `parseInf` (full record-stream walk, below). */
export function decompressInf(data: Uint8Array): Uint8Array {
  const compType = data[2]! | (data[3]! << 8);
  const imgSize = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  const palSize = data[8]! | (data[9]! << 8);
  const body = data.subarray(10 + palSize);

  let decompressed: Uint8Array;
  if (compType === 0) {
    decompressed = body.subarray(0, imgSize);
  } else if (compType === 4) {
    decompressed = decompressLCW(body, imgSize);
  } else {
    throw new Error(`decompressInf: unsupported compType ${compType} (only 0/raw and 4/LCW are implemented)`);
  }
  if (decompressed.length < imgSize) {
    throw new Error(
      `decompressInf: LCW decompression produced ${decompressed.length} bytes, expected ${imgSize} -- decoder bug or corrupt input`,
    );
  }
  return decompressed;
}

export function decodeInf(data: Uint8Array): InfHeader {
  const decompressed = decompressInf(data);
  return decodeFixedOffsets(decompressed) ?? decodeTokenScanFallback(decompressed);
}

/**
 * Full `.INF` level-record parse: header (as `decodeInf`) plus the
 * per-level wall-mapping-override / decoration-load record stream that
 * `decodeInf` doesn't reach. This is EOB2's real `EoBCoreEngine::
 * initLevelData` control flow past the header (`_flags.gameID == GI_EOB2`
 * branch, non-Amiga/DOS path), traced fresh from `engines/kyra/engine/
 * scene_eob.cpp` and `engines/kyra/engine/darkmoon.cpp` (`DarkMoonEngine::
 * loadDoorShapes`/`loadMonsterProperties`) -- **not** a re-use of EOB1's
 * `tools/eotb/decode-inf.ts` byte offsets, which this module's own header
 * comment already established don't transfer unmodified (EOB1's `slen=12`
 * vs EOB2's `slen=13`, plus EOB2's extra second-wall-set-stem and
 * sound-file-name fields). The wall-mapping-override / decoration-load
 * record shape itself IS identical in structure to EOB1's (`assignWalls
 * AndDecorations(wallIndex, vmpIndex, decIndex, specialType, flags)` is
 * shared `EoBCoreEngine` code, not overridden per-game) -- only `slen`
 * changes the decoration-load record's on-disk width (26 bytes for EOB2's
 * two 13-byte names vs EOB1's 24).
 *
 * Byte-for-byte derivation, all fields after the already-documented
 * header (mazStem/wallSetStem/secondWallSetStem, ending at `0x020` or
 * `0x02D`):
 *
 * | Field | Width | Source |
 * |---|---|---|
 * | `soundFile` (unused by this parser) | 13 | `_sound->loadSoundFile(pos); pos += 13` (`scene_eob.cpp`, `gameID==GI_EOB2`, non-Amiga branch) |
 * | door-shape record x2 | 1 (tag) + 65 if tag is `0xEC`/`0xEA`, else 1 | `DarkMoonEngine::loadDoorShapes(filename, doorIndex, shapeDefs)` (`darkmoon.cpp:505-519`): 13-byte filename + doorIndex/doorType/noDoorSwitch bytes (offsets 13/14/15 relative to the record start) + 48 bytes of shape/switch defs (3 shapes x 8B + 2 switches x 12B) consumed unconditionally once the record is active |
 * | `stepsUntilScriptCall` | 2 | `READ_LE_UINT16(pos); pos += 2` |
 * | monster-shape record x2 | 1 (tag) + 16 if tag is `0xEC`, else 1 | `if (*pos++ != 0xEC) continue; loadMonsterShapes(pos+2, pos[1]*18, pos[15]?true:false, *pos*18); pos += 16;` (`scene_eob.cpp`) |
 * | monster-property records, `0xFF`-terminated | 30 fixed bytes + `2*numRemoteWeapons` (only when a `0xFF`-gated optional block is present) per record, +1 terminator | `DarkMoonEngine::loadMonsterProperties` (`darkmoon.cpp:338-406`) -- ported here as a byte-consuming skip only, values aren't needed for decoration rendering |
 * | wall-mapping/decoration-load stream | 1 (tag, must be `0xEC`) + 2 (`num`, u16 LE) + `num` records | Same shape as EOB1's (`assignWallsAndDecorations`/`loadDecorations`), `slen`=13 |
 *
 * **Verified against all 16 real `LEVELn.INF` files** (see
 * `docs/eotb2/dosvga/data-structure.md` § "INF -- Level configuration
 * (EOB2)" -> "Wall-mapping / decoration-load record stream"): every file's
 * tag byte before the record-count `num` is `0xEC` with zero exceptions
 * (no token-scan-style fallback needed here), decoded monster-shape names
 * are real, legible EOB2 monster names present in this corpus's own
 * `.DCR` file set (`guard1`/`guard2`/`cleric2`/`skelwar`/...), and every
 * decoration-load record's `decFile` string resolves to one of the 6 real
 * on-disk `.DEC` files (`brown.dec`/`forest.dec`/`mezz.dec`/`silver.dec`/
 * `azure.dec`/`crimson.dec` -- exact match to the wall-set groupings, not
 * a coincidence: DUNG->brown, everything else same-named). Every
 * `decIndex` this stream resolves against `decodeDecorations`'s parsed
 * `.DEC` files (`tools/eotb/decode-decorations.ts`, reused read-only per
 * this session's task scope) lands in-range and `decorationChain` walks
 * terminate cleanly -- 308/308 real wall-mapping-with-decoration records
 * across the whole 16-level corpus, 0 out-of-range, 0 chain errors.
 */
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

/** One record from the interleaved wall-mapping/decoration-load stream, in real on-disk order -- see `resolveWallDecorationAssignments`'s doc comment for why order matters (identical reasoning to EOB1's `tools/eotb/decode-inf.ts`). */
export type InfRecord =
  | { kind: 'decoration-load'; record: DecorationLoadRecord }
  | { kind: 'wall-mapping'; record: WallMappingOverride };

export interface InfLevelData extends InfHeader {
  soundFile: string;
  wallMappings: WallMappingOverride[];
  decorationLoads: DecorationLoadRecord[];
  records: InfRecord[];
}

/** Parse a decompressed EOB2 `.INF` buffer's full record stream past the header -- see this module's doc comment above `WallMappingOverride` for the full field-offset derivation and citations. */
export function parseInfLevelData(decompressed: Uint8Array): InfLevelData {
  const header = decodeFixedOffsets(decompressed);
  if (!header) {
    throw new Error('parseInfLevelData: oracle check failed -- fixed-offset header parse failed (tag byte, mazStem, or wallSetStem invalid)');
  }

  let pos = 0x005 + STEM_LEN * 2 + 1; // past mazStem + wallSetStem + the flag byte
  if (header.secondWallSetStem !== undefined) pos += STEM_LEN;

  const soundFile = readCString(decompressed, pos, STEM_LEN) ?? '';
  pos += STEM_LEN;

  // Door-shape records, 2 fixed iterations.
  for (let i = 0; i < 2; i++) {
    const disc = decompressed[pos]!;
    pos += 1;
    if (disc !== 0xec && disc !== 0xea) continue; // inactive slot -- only the discriminator byte is consumed.
    pos += 16 + 48; // filename(13)+doorIndex/doorType/noDoorSwitch(3) = 16, then 3 shapes*8B + 2 switches*12B = 48.
  }

  pos += 2; // stepsUntilScriptCall (u16 LE, unused by this parser)

  // Monster-shape records, 2 fixed iterations.
  for (let i = 0; i < 2; i++) {
    const tag = decompressed[pos]!;
    pos += 1;
    if (tag !== 0xec) continue; // inactive slot -- only the tag byte is consumed.
    pos += 16;
  }

  // DarkMoonEngine::loadMonsterProperties -- 0xFF-terminated variable-length skip (values unused here).
  let cmd = decompressed[pos]!;
  pos += 1;
  while (cmd !== 0xff) {
    pos += 7; // armorClass, hitChance, level, hpDcTimes, hpDcPips, hpDcBase, attacksPerRound
    pos += 9; // dmgDc[0..2] (times, pips, base) x3
    pos += 8; // immunityFlags, capsFlags, typeFlags, experience (u16 LE each)
    pos += 3; // u30, sound1, sound2
    pos += 1; // numRemoteAttacks
    const remoteFlag = decompressed[pos]!;
    pos += 1;
    if (remoteFlag !== 0xff) {
      const numRemoteWeapons = decompressed[pos + 1]!;
      pos += 2; // remoteWeaponChangeMode, numRemoteWeapons
      pos += 2 * numRemoteWeapons;
    }
    pos += 2; // tuResist, dmgModifierEvade
    pos += 3; // decorations[3]
    cmd = decompressed[pos]!;
    pos += 1;
  }

  const wallMappings: WallMappingOverride[] = [];
  const decorationLoads: DecorationLoadRecord[] = [];
  const records: InfRecord[] = [];

  const tag2 = decompressed[pos]!;
  pos += 1;
  if (tag2 === 0xec) {
    const num = decompressed[pos]! | (decompressed[pos + 1]! << 8);
    pos += 2;
    for (let i = 0; i < num; i++) {
      const disc = decompressed[pos]!;
      pos += 1;
      if (disc === 0xec) {
        const record = { cpsFile: cstrLatin1(decompressed, pos, STEM_LEN), decFile: cstrLatin1(decompressed, pos + STEM_LEN, STEM_LEN) };
        decorationLoads.push(record);
        records.push({ kind: 'decoration-load', record });
        pos += STEM_LEN * 2;
      } else {
        const wallIndex = decompressed[pos]!;
        const vmpIndex = decompressed[pos + 1]!;
        const decIndexRaw = decompressed[pos + 2]!;
        const decIndex = decIndexRaw >= 128 ? decIndexRaw - 256 : decIndexRaw;
        const specialType = decompressed[pos + 3]!;
        const flags = decompressed[pos + 4]!;
        const record = { wallIndex, vmpIndex, decIndex, specialType, flags };
        wallMappings.push(record);
        records.push({ kind: 'wall-mapping', record });
        pos += 5;
      }
    }
  } else {
    throw new Error(`parseInfLevelData: oracle check failed -- expected tag 0xEC before the wall-mapping/decoration-load record count, got 0x${tag2.toString(16)}`);
  }

  return { ...header, soundFile, wallMappings, decorationLoads, records };
}

/** Decompress + parse a raw `.INF` file's full record stream in one step. */
export function parseInf(infData: Uint8Array): InfLevelData {
  return parseInfLevelData(decompressInf(infData));
}

/**
 * Build the real 256-entry rawWallIndex -> vmpIndex lookup table for a
 * level: `EoBCoreEngine::resetWallData`'s default table (`engines/kyra/
 * engine/scene_eob.cpp:542-548` -- shared, non-game-specific code:
 * `{1:1, 2:2, 3..22:3, 23:4, 24:5}`, everything else including 0 defaults
 * to "no wall") with this level's `.INF` wall-mapping overrides applied
 * on top (`assignWallsAndDecorations`'s first line: `_wllVmpMap[wallIndex]
 * = vmpIndex`). Identical logic to EOB1's `tools/eotb/decode-inf.ts`
 * (same shared engine function), reimplemented here rather than imported
 * since EOB2's `.INF` record parse is its own decoder.
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

/** A wall's decoration assignment: which decoration-load's `.CPS`/`.DEC` pair is active, plus the `decIndex` to chain from (`tools/eotb/decode-decorations.ts`'s `decorationChain`, reused read-only). */
export interface WallDecorationAssignment {
  cpsFile: string;
  decFile: string;
  decIndex: number;
}

/**
 * Pair each wall-mapping override's `decIndex` with the decoration-load
 * (`.CPS`/`.DEC` pair) most recently loaded before it in real on-disk
 * record order -- identical reasoning to EOB1's `tools/eotb/decode-inf.ts`
 * (`loadDecorations` reassigns the active decoration data on every
 * `0xEC`-tagged record; a wall-mapping's `decIndex` only makes sense
 * against the closest **preceding** decoration-load). Skips wall-mapping
 * records with `decIndex === -1` (no decoration) and any that appear
 * before the first decoration-load.
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

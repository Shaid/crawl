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

export function decodeInf(data: Uint8Array): InfHeader {
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
    throw new Error(`decodeInf: unsupported compType ${compType} (only 0/raw and 4/LCW are implemented)`);
  }
  if (decompressed.length < imgSize) {
    throw new Error(
      `decodeInf: LCW decompression produced ${decompressed.length} bytes, expected ${imgSize} -- decoder bug or corrupt input`,
    );
  }

  return decodeFixedOffsets(decompressed) ?? decodeTokenScanFallback(decompressed);
}

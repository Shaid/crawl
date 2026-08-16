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
 * **Deviation from the cited doc's exact byte offsets.** `docs/eotb/
 * dosvga/data-structure.md` § "INF" -> "Decompressed buffer layout"
 * documents `mazStem` at a fixed offset 0x002 (12-byte cstring) and
 * `wallSetStem` immediately after at 0x00E. Empirically, against every
 * real EOB2 `LEVELn.INF` in this corpus, the actual `"levelN.maz"` string
 * starts 3 bytes later (0x005) and the wall-set name appears with a
 * variable, non-fixed gap after it (not a clean +12 stride) -- the doc's
 * offsets don't reproduce on this game's real files, for reasons not
 * chased down further this session (possibly a genuinely different EOB2
 * header preamble, not just an EOB1-vs-EOB2 field-width difference). Since
 * both strings decode legibly and land in a small, predictable window
 * regardless of the exact byte alignment, this module scans the first 64
 * decompressed bytes for a `<name>.maz` token and a known wall-set-name
 * token instead of trusting fixed offsets -- the same pragmatic fallback
 * `tools/eotb/decode-inf.ts` already uses for EOB1's Amiga port (whose
 * `.INF` layout also didn't match its own port's documented struct).
 * Verified against all 16 real `LEVELn.INF` files: every one resolves to
 * a `.maz` token and one of the 6 known wall-set names, including the two
 * documented maze-reuse cases (`LEVEL16.INF` -> `level15.maz`, `LEVEL14.INF`
 * -> `level12.maz`).
 */
import { decompressLCW } from '../eotb/lcw.ts';

const WALL_SETS = ['DUNG', 'FOREST', 'MEZZ', 'SILVER', 'CRIMSON', 'AZURE'] as const;
const SCAN_WINDOW = 64;

export interface InfHeader {
  mazStem: string;
  wallSetStem: string;
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

  // Replace non-printable bytes with '.' so the regex/substring scans below
  // never accidentally span a NUL/control byte as if it were a text char.
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

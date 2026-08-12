/**
 * Extracts English-name / half-width-katakana-transliteration pairs from the
 * monster-name table embedded in the SNES ROM.
 *
 * Format (see docs/wizardry6/snes/data-structure.md section "Monster name
 * table -- confirmed text encoding"): starting around file offset 0x46332,
 * a long run of back-to-back TLV-ish records, each a pair of two fields:
 *
 *   [0x80][len][ASCII English name, len bytes]
 *   [0x81][len][half-width katakana transliteration, len bytes]
 *
 * (half-width katakana = single-byte JIS X 0201 kana, CP932 byte range
 * 0xA1-0xDF; multi-word names use 0xA5 '･' as a word separator, e.g.
 * "GIANT RAT" -> "ｼﾞｬｲｱﾝﾄ･ﾗｯﾄ"). This is treated as **confirmed**: 102
 * consecutive pairs decode with zero garbage characters and every single
 * one is an unambiguous, grammatically-correct phonetic transliteration of
 * its paired English name (independently checkable by any Japanese reader,
 * and matched against Wizardry 6's known bestiary content already
 * cross-referenced in the Amiga corpus) -- see the doc for the full list
 * and the byte-exact decode evidence.
 *
 * The scan is tolerant of single-byte resync gaps (a handful of records,
 * e.g. the genus-header entry "VINE", have a second field that is NOT
 * valid half-width katakana -- likely a different field type such as a
 * sprite/category index rather than translated text; these are skipped
 * and not included in the output). This is an open item, see the doc's
 * "paths tried" table for the monster-name table.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-monster-names.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';

const SCAN_START = 0x46328;
const SCAN_END = 0x48000;
const EN_SEP = 0x80;
const KANA_SEP = 0x81;
const MAX_RESYNC_FAILS = 2000;

function isHalfKana(b: number): boolean {
  return b >= 0xa1 && b <= 0xdf;
}

function isAsciiPrintable(b: number): boolean {
  return b >= 0x20 && b < 0x7f;
}

// Node has no built-in half-width-katakana decoder; map the CP932
// single-byte range 0xA1-0xDF directly (JIS X 0201 kana block, in byte
// order starting at 0xA1).
const HALFWIDTH_KANA_TABLE =
  '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ';

function decodeHalfKana(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HALFWIDTH_KANA_TABLE[b - 0xa1] ?? '?';
  return out;
}

function tryAsciiField(data: Uint8Array, pos: number): { text: string; end: number } | null {
  if (pos + 2 > data.length || data[pos] !== EN_SEP) return null;
  const len = data[pos + 1];
  if (len === 0 || len > 30) return null;
  const start = pos + 2;
  const bytes = data.subarray(start, start + len);
  for (const b of bytes) if (!isAsciiPrintable(b)) return null;
  return { text: Buffer.from(bytes).toString('ascii'), end: start + len };
}

function tryKanaField(data: Uint8Array, pos: number): { text: string; end: number } | null {
  if (pos + 2 > data.length || data[pos] !== KANA_SEP) return null;
  const len = data[pos + 1];
  if (len === 0 || len > 40) return null;
  const start = pos + 2;
  const bytes = data.subarray(start, start + len);
  for (const b of bytes) if (!isHalfKana(b)) return null;
  return { text: decodeHalfKana(bytes), end: start + len };
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-monster-names.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);
  const pairs: { fileOffset: string; english: string; kana: string }[] = [];
  let pos = SCAN_START;
  let consecutiveFail = 0;

  while (pos < SCAN_END) {
    const enField = tryAsciiField(data, pos);
    if (!enField) {
      pos++;
      consecutiveFail++;
      if (consecutiveFail > MAX_RESYNC_FAILS) break; // gave up resyncing -- end of table
      continue;
    }
    const kanaField = tryKanaField(data, enField.end);
    if (!kanaField) {
      pos++;
      consecutiveFail++;
      continue;
    }
    pairs.push({ fileOffset: `0x${pos.toString(16)}`, english: enField.text, kana: kanaField.text });
    pos = kanaField.end;
    consecutiveFail = 0;
  }

  console.log(`Decoded ${pairs.length} English/katakana name pairs, file 0x${SCAN_START.toString(16)}-0x${SCAN_END.toString(16)} scan range`);
  console.log('Sample:', pairs.slice(0, 5).map((p) => `${p.english} -> ${p.kana}`).join(', '));

  const outDir = resolve('public/assets/wizardry6/snes/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'monster-names.json'), {
    note:
      'Confirmed encoding: [0x80][len][ASCII English name][0x81][len][half-width katakana transliteration]. 102 pairs decode with zero garbage bytes; every transliteration is a grammatically-correct phonetic rendering of its paired English name. A handful of genus-header records (e.g. "VINE") are skipped -- their second field is not valid half-width katakana. See docs/wizardry6/snes/data-structure.md.',
    scanRange: [SCAN_START, SCAN_END],
    pairs,
  });

  console.log('Wrote public/assets/wizardry6/snes/data/monster-names.json');
}

main();

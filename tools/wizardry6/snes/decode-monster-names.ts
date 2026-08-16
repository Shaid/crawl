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
 * **Genus headers decoded (2026-08-16, closes
 * `snes-monster-table-nonkana-field`):** the "3rd record type" (an
 * `0x80`-tagged field whose payload is not ASCII) is the genus's
 * **Japanese display name in the game's own 8-bit text encoding** --
 * font-tile indices into the 256-glyph dialogue font (docs section 4.1a):
 * ASCII 0x20-0x7E, small kana 0x86-0x8F (0x86 = wo), hiragana a-so at
 * 0x91-0x9F, standard JIS X 0201 half-width katakana 0xA1-0xDF (dakuten
 * 0xDE / handakuten 0xDF as trailing combining marks), and hiragana
 * ta-n at 0xE0-0xFD. Confirmed by rendering the payload glyph sequences
 * straight from the extracted font bank: e.g. VINE -> tsurukusa,
 * STINKING CORPSE -> kusai shitai, GHOST -> yuurei, NATIVE -> genjuumin
 * (18/18 legible, semantically matching their English pair). A few
 * English fields also carry 0xA2 as an internal separator
 * ("GUARDIAN(0xA2)ROCK"), decoded here as a middle dot.
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
  return (b >= 0x20 && b < 0x7f) || b === 0xa2; // 0xA2 = in-name separator (e.g. "GUARDIAN\u00b7ROCK")
}

// ── The game's own 8-bit text encoding (font-tile indices; docs §4.1a) ──
const HIRA_LO = 'あいうえおかきくけこさしすせそ'; // 0x91-0x9F
const HIRA_HI = 'たちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん'; // 0xE0-0xFD
const SMALL_KANA = 'をぁぃぅぇぉゃゅょっ'; // 0x86-0x8F
const DAKUTEN: Record<string, string> = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
};
const HANDAKUTEN: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

/** Is `b` a valid byte of the game's 8-bit text encoding? */
function isGameText(b: number): boolean {
  return (
    isAsciiPrintable(b) ||
    (b >= 0x86 && b <= 0x8f) ||
    (b >= 0x91 && b <= 0x9f) ||
    (b >= 0xa1 && b <= 0xdf) ||
    (b >= 0xe0 && b <= 0xfd)
  );
}

/** Decode a run of game-text bytes, combining trailing dakuten/handakuten into hiragana where a precomposed form exists (half-width katakana keep their own combining-mark convention, matching `decodeHalfKana`). */
function decodeGameText(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    let ch: string;
    if (b >= 0x20 && b < 0x7f) ch = String.fromCharCode(b);
    else if (b === 0xa2) ch = '\u00b7';
    else if (b >= 0x86 && b <= 0x8f) ch = SMALL_KANA[b - 0x86]!;
    else if (b >= 0x91 && b <= 0x9f) ch = HIRA_LO[b - 0x91]!;
    else if (b >= 0xe0 && b <= 0xfd) ch = HIRA_HI[b - 0xe0]!;
    else if (b >= 0xa1 && b <= 0xdf) {
      const last = out.slice(-1);
      if (b === 0xde && DAKUTEN[last]) {
        out = out.slice(0, -1) + DAKUTEN[last];
        continue;
      }
      if (b === 0xdf && HANDAKUTEN[last]) {
        out = out.slice(0, -1) + HANDAKUTEN[last];
        continue;
      }
      ch = HALFWIDTH_KANA_TABLE[b - 0xa1] ?? '?';
    } else ch = '?';
    out += ch;
  }
  return out;
}

/** Try a genus Japanese-name field: `[0x80][len][game-text bytes]` that is NOT plain ASCII. */
function tryGenusJapaneseField(data: Uint8Array, pos: number): { text: string; end: number } | null {
  if (data[pos] !== EN_SEP) return null;
  const len = data[pos + 1];
  if (!len || len > 0x20) return null;
  const start = pos + 2;
  const bytes = data.subarray(start, start + len);
  let nonAscii = false;
  for (const b of bytes) {
    if (!isGameText(b)) return null;
    if (!(b >= 0x20 && b < 0x7f)) nonAscii = true;
  }
  if (!nonAscii) return null;
  return { text: decodeGameText(bytes), end: start + len };
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
  const text = Array.from(bytes, (b) => (b === 0xa2 ? '\u00b7' : String.fromCharCode(b))).join('');
  return { text, end: start + len };
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
  const genusHeaders: { fileOffset: string; english: string; japanese: string }[] = [];
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
    if (kanaField) {
      pairs.push({ fileOffset: `0x${pos.toString(16)}`, english: enField.text, kana: kanaField.text });
      pos = kanaField.end;
      consecutiveFail = 0;
      continue;
    }
    // genus header: [0x80][English name][0x80][Japanese name in game text encoding]
    const genusField = tryGenusJapaneseField(data, enField.end);
    if (genusField) {
      genusHeaders.push({ fileOffset: `0x${pos.toString(16)}`, english: enField.text, japanese: genusField.text });
      pos = genusField.end;
      consecutiveFail = 0;
      continue;
    }
    pos++;
    consecutiveFail++;
  }

  console.log(
    `Decoded ${pairs.length} English/katakana name pairs + ${genusHeaders.length} genus headers, file 0x${SCAN_START.toString(16)}-0x${SCAN_END.toString(16)} scan range`,
  );
  console.log('Sample:', pairs.slice(0, 5).map((p) => `${p.english} -> ${p.kana}`).join(', '));

  const outDir = resolve('public/assets/wizardry6/snes/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'monster-names.json'), {
    note:
      'Confirmed encoding: [0x80][len][ASCII English name][0x81][len][half-width katakana transliteration]. genusHeaders: [0x80][English genus name][0x80][Japanese genus name in the game 8-bit text encoding] (font-tile indices: ASCII + small kana 0x86-0x8F + hiragana 0x91-0x9F/0xE0-0xFD + half-width katakana 0xA1-0xDF). See docs/wizardry6/snes/data-structure.md sections 4.1a/6.2.',
    scanRange: [SCAN_START, SCAN_END],
    pairs,
    genusHeaders,
  });

  console.log('Wrote public/assets/wizardry6/snes/data/monster-names.json');
}

main();

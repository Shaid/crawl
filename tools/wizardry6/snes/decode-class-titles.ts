/**
 * Extracts the character-class rank-title table embedded as plain ASCII in
 * the SNES ROM (`Wizardry VI - Kindan no Mahitsu (Japan).sfc`).
 *
 * Format (see docs/wizardry6/snes/data-structure.md section "Class-tier
 * title table"): at file offset 0xB074 there are 98 (14 * 7) back-to-back
 * null-terminated ASCII strings -- no length prefix, no pointer table, just
 * a flat run of C-strings. Grouping them into runs of 7 and reading the
 * first title of each group produces exactly: JOURNEYMAN, MAGICIAN,
 * ACOLYTE, ROGUE, WOODSMAN, HERBALIST, MINSTREL, PSYCHIC, LANCER, FRIAR,
 * SQUIRE, BLADESMAN, INITIATE, GENIN -- the entry-level rank title for each
 * of Wizardry 6's 14 classes, in the exact class order confirmed
 * independently in the Amiga corpus (FIG MAG PRI THI RAN ALC BAR PSI VAL
 * BIS LOR SAM MON NIN, see docs/wizardry6/amiga/data-structure.md). This is
 * treated as **confirmed**: the table shape (14 groups of 7), the group
 * count (14), and the per-group order all match an independently known
 * game fact with zero deviation -- a numeric/round-value-table-style oracle
 * applied to a string table (see the project agent's Method section on
 * "a decoded numeric table's own values can be the oracle").
 *
 * These are believed to be internal/debug identifiers carried over from the
 * original DOS source data (the retail Japanese release displays localized
 * text, not this ASCII) -- see the doc for the "why is English text in a
 * Japan-only ROM" discussion. Their value here is as a structural anchor,
 * not as display text.
 *
 * A short table of monster/spell special-attack names immediately follows
 * at file offset 0xB3DD (VORPAL BLADES, CLOUD OF FEAR, ... KISS OF DEATH)
 * and is extracted alongside for convenience, at **rendered** confidence
 * only (plausible content, not yet traced to a consumer in code).
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-class-titles.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';

const CLASS_TITLES_OFFSET = 0xb074;
const CLASS_ORDER = [
  'FIG',
  'MAG',
  'PRI',
  'THI',
  'RAN',
  'ALC',
  'BAR',
  'PSI',
  'VAL',
  'BIS',
  'LOR',
  'SAM',
  'MON',
  'NIN',
] as const;
const TITLES_PER_CLASS = 7;
const CLASS_COUNT = CLASS_ORDER.length;

// Expected rank-0 (entry-level) title per class, independently transcribed
// from the ROM for the oracle check below.
const EXPECTED_ENTRY_TITLE: Record<string, string> = {
  FIG: 'JOURNEYMAN',
  MAG: 'MAGICIAN',
  PRI: 'ACOLYTE',
  THI: 'ROGUE',
  RAN: 'WOODSMAN',
  ALC: 'HERBALIST',
  BAR: 'MINSTREL',
  PSI: 'PSYCHIC',
  VAL: 'LANCER',
  BIS: 'FRIAR',
  LOR: 'SQUIRE',
  SAM: 'BLADESMAN',
  MON: 'INITIATE',
  NIN: 'GENIN',
};

const ATTACK_NAMES_OFFSET = 0xb3dd;
const ATTACK_NAMES_END = 0xb47b; // exclusive; first byte of the following (unrelated) region

function readCStrings(data: Uint8Array, offset: number, count: number): { strings: string[]; end: number } {
  const strings: string[] = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    const start = pos;
    while (pos < data.length && data[pos] !== 0) pos++;
    if (pos >= data.length) throw new Error(`ran off the end of the file reading string ${i} at 0x${start.toString(16)}`);
    strings.push(Buffer.from(data.subarray(start, pos)).toString('ascii'));
    pos++; // skip null terminator
  }
  return { strings, end: pos };
}

function readCStringsInRange(data: Uint8Array, start: number, end: number): string[] {
  const strings: string[] = [];
  let pos = start;
  while (pos < end) {
    const s = pos;
    while (pos < end && data[pos] !== 0) pos++;
    if (pos > s) strings.push(Buffer.from(data.subarray(s, pos)).toString('ascii'));
    pos++;
  }
  return strings;
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-class-titles.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  const { strings: flatTitles, end } = readCStrings(data, CLASS_TITLES_OFFSET, CLASS_COUNT * TITLES_PER_CLASS);

  const byClass: Record<string, string[]> = {};
  let mismatches = 0;
  for (let c = 0; c < CLASS_COUNT; c++) {
    const cls = CLASS_ORDER[c];
    const titles = flatTitles.slice(c * TITLES_PER_CLASS, (c + 1) * TITLES_PER_CLASS);
    byClass[cls] = titles;
    if (titles[0] !== EXPECTED_ENTRY_TITLE[cls]) {
      mismatches++;
      console.error(`MISMATCH: class ${cls} expected entry title ${EXPECTED_ENTRY_TITLE[cls]}, got ${titles[0]}`);
    }
  }

  console.log(
    `Read ${flatTitles.length} titles (expected ${CLASS_COUNT * TITLES_PER_CLASS}) spanning file 0x${CLASS_TITLES_OFFSET.toString(16)}-0x${(end - 1).toString(16)}`,
  );
  console.log(`Entry-title oracle check: ${CLASS_COUNT - mismatches}/${CLASS_COUNT} classes match the independently known roster`);
  if (mismatches > 0) {
    console.error('Oracle check FAILED -- table offset or class order is wrong. Not writing output.');
    process.exit(1);
  }

  const attackNames = readCStringsInRange(data, ATTACK_NAMES_OFFSET, ATTACK_NAMES_END);
  console.log(`Read ${attackNames.length} monster/spell attack names at 0x${ATTACK_NAMES_OFFSET.toString(16)} (rendered confidence, not code-traced)`);

  const outDir = resolve('public/assets/wizardry6/snes/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'class-tier-titles.json'), {
    note:
      'Confirmed via structural oracle: 14 groups of 7 null-terminated ASCII strings at file 0xB074, entry title of each group matches Wizardry 6\'s independently-known 14-class roster (FIG MAG PRI THI RAN ALC BAR PSI VAL BIS LOR SAM MON NIN) with zero deviation. See docs/wizardry6/snes/data-structure.md.',
    fileOffsetStart: CLASS_TITLES_OFFSET,
    fileOffsetEnd: end - 1,
    classOrder: CLASS_ORDER,
    titlesByClass: byClass,
    monsterAttackNames: {
      note: 'Rendered confidence only -- plausible content (real Wizardry 6 monster special-attack names), not yet traced to a code consumer.',
      fileOffsetStart: ATTACK_NAMES_OFFSET,
      fileOffsetEnd: ATTACK_NAMES_END - 1,
      names: attackNames,
    },
  });

  console.log('Wrote public/assets/wizardry6/snes/data/class-tier-titles.json');
}

main();

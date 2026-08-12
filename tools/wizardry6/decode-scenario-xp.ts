/**
 * Extracts the character-class experience-point tables from the start of
 * scenario.dbs.
 *
 * Format (high-confidence structural evidence, see
 * docs/wizardry6/amiga/data-structure.md section "scenario.dbs"): the file
 * opens with 14 back-to-back tables of 16 big-endian uint32 values each
 * (14 * 16 * 4 = 896 bytes, offsets 0x000-0x37F). Every value is a round
 * decimal number (1000, 2000, 4000, ... or 1250, 2500, 5000, ...) in a
 * strictly increasing per-table sequence -- the classic shape of a
 * Wizardry per-level XP-to-advance table. 14 tables matches Wizardry 6's
 * real roster of 14 character classes exactly. At table index 14 the
 * values stop being round numbers (garbage/unrelated data), confirming the
 * table's extent. Not yet cross-referenced against Bane's own code or
 * matched to specific class names -- that mapping (which of the 14 tables
 * belongs to which class) is not yet known and is left as an open item.
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-xp.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r32 } from '@seer-project/core';

const TABLE_COUNT = 14;
const LEVELS_PER_TABLE = 16;
const TABLE_BYTES = TABLE_COUNT * LEVELS_PER_TABLE * 4;

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-xp.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  if (data.length < TABLE_BYTES) {
    console.error(`scenario.dbs too small: ${data.length} bytes, need at least ${TABLE_BYTES}`);
    process.exit(1);
  }

  const tables: number[][] = [];
  for (let t = 0; t < TABLE_COUNT; t++) {
    const levels: number[] = [];
    for (let lvl = 0; lvl < LEVELS_PER_TABLE; lvl++) {
      const offset = (t * LEVELS_PER_TABLE + lvl) * 4;
      levels.push(r32(data, offset, 'be'));
    }
    tables.push(levels);
  }

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'xp-tables.json'), {
    note:
      'Class-index -> table mapping unconfirmed. 14 tables at scenario.dbs offset 0x000-0x37F, 16 levels each, big-endian u32 XP thresholds.',
    tables,
  });

  console.log(`Wrote xp-tables.json (${TABLE_COUNT} tables x ${LEVELS_PER_TABLE} levels)`);
}

main();

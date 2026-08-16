/**
 * Decode `scenario.dbs` section 5 (file offset 0x22DB4, 32 x 142-byte
 * records) -- solved 2026-08-16 as the **NPC / special-encounter name
 * table** (docs/wizardry6/amiga/data-structure.md §7.1):
 *
 * Each record is a NUL-terminated plain-ASCII display name (CAPTAIN
 * MATEY, QUEEQUEG, * XORPHITUS *, ?? BANE KING ??, R E B E C C A, THE
 * SIREN, QUEEN=FAERIES, ...) followed by a sparse binary tail of
 * small tuples (`0x01xx`/`0x03xx`/`0x07xx`-shaped u16s plus a dense
 * `0x191`-`0x1B6` id run -- dialogue/encounter link data, characterized
 * but not field-decoded).
 *
 * The consumer chain is what identified it: section 6's message-display
 * cases pass the cached section-5 record and the literal 94 (= ASCII
 * `'^'`) to A4 jump-table entry 14 (`CODE+0x6AC`), which is a **string
 * template substitution** -- it splices the record's name string into the
 * loaded message text wherever the `'^'` placeholder appears. (The
 * "literal 94" was previously misread as a byte offset.)
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-npcs.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';

const SECTION5_OFFSET = 0x22db4;
const RECORD_SIZE = 142;
const RECORD_COUNT = 32;

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-npcs.ts <dataDir>');
    process.exit(1);
  }
  const data = readBinary(resolve(dataDir, 'scenario.dbs'));

  const records: Array<{ index: number; name: string; tailHex: string }> = [];
  for (let i = 0; i < RECORD_COUNT; i++) {
    const rec = data.subarray(SECTION5_OFFSET + i * RECORD_SIZE, SECTION5_OFFSET + (i + 1) * RECORD_SIZE);
    const nul = rec.indexOf(0);
    let name = '';
    for (let k = 0; k < (nul === -1 ? rec.length : nul); k++) {
      const b = rec[k]!;
      if (b < 0x20 || b >= 0x7f) {
        name = '';
        break;
      }
      name += String.fromCharCode(b);
    }
    // trim trailing all-zero bytes off the tail for a compact dump
    let end = rec.length;
    while (end > nul + 1 && rec[end - 1] === 0) end--;
    const tail = rec.subarray(nul + 1, end);
    records.push({
      index: i,
      name,
      tailHex: Array.from(tail)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    });
  }

  const named = records.filter((r) => r.name.length > 0).length;
  if (named < 30) {
    console.error(`Oracle check FAILED: only ${named}/32 section-5 records decode as ASCII names.`);
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'npc-names.json'), {
    note:
      'scenario.dbs section 5 (0x22DB4, 32 x 142B): NPC/special-encounter name table. name is spliced into message text at "^" placeholders ' +
      'via A4 entry 14 (CODE+0x6AC, string template substitution). tailHex = the record\'s undecoded binary link data (dialogue/encounter tuples).',
    records,
  });
  console.log(`Wrote data/npc-names.json (${named}/32 named records).`);
}

main();

/**
 * Decodes `scenario.dbs` section 9 (file offset 0x2df34-EOF, 64 x 12-byte
 * records) as a chained offset+length directory.
 *
 * See docs/wizardry6/amiga/data-structure.md section 7.1 ("Section 9") for
 * the full derivation. Summary:
 *
 * - Section 9's boundaries/stride are already confirmed structurally via
 *   the master.hdr/disk.hdr cross-file divisor match (section 6.4/6.5) --
 *   this extractor decodes what's *inside* those 64 records.
 * - Each 12-byte record is `[BE u32 offset][BE u32 length][4 bytes tail]`.
 *   Testing the same "offset[i] + length[i] == offset[i+1]" invariant
 *   already confirmed for the .PIC directory (section 2.1) and
 *   mazedata.ega's directory (section 4.2) holds for 34 of the 39
 *   non-empty records with zero deviation, forming one continuous
 *   cumulative-sum chain from 0 to 0x43b42 (277,826 bytes). The other 5
 *   non-empty records (indices 1, 9, 18, 19, 39) hold small values that
 *   don't fit the chain -- placeholder/reserved slots, the same pattern
 *   as the duplicate boilerplate records seen elsewhere in this corpus
 *   (e.g. section 2's own record 0/1). Records 40-63 are all-zero (unused
 *   capacity).
 * - CONFIRMED: the chain structure itself (byte-exact, no deviation across
 *   the 34 chained records). NOT confirmed: what 277,826-byte blob this
 *   directory partitions -- it doesn't match any file in the corpus by
 *   size (too big for scenario.dbs itself or msg.dbs; would fit within
 *   Bane's 354,372-byte CODE hunk, but no code reference tying these
 *   offsets to the executable was found this pass). Left open.
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-section9.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r32 } from '@seer-project/core';

const SECTION_START = 0x2df34;
const STRIDE = 12;
const RECORD_COUNT = 64;

interface Section9Record {
  index: number;
  offset: number;
  length: number;
  tailHex: string;
  empty: boolean;
  inChain: boolean;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-section9.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  const sectionEnd = SECTION_START + STRIDE * RECORD_COUNT;
  if (sectionEnd > data.length) {
    console.error(
      `scenario.dbs too small: ${data.length} bytes, need at least ${sectionEnd} for section 9`,
    );
    process.exit(1);
  }

  const records: Section9Record[] = [];
  for (let i = 0; i < RECORD_COUNT; i++) {
    const base = SECTION_START + i * STRIDE;
    const rec = data.subarray(base, base + STRIDE);
    const offset = r32(rec, 0, 'be');
    const length = r32(rec, 4, 'be');
    const tail = rec.subarray(8, 12);
    const tailHex = Array.from(tail)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const empty = offset === 0 && length === 0 && i !== 0;
    records.push({ index: i, offset, length, tailHex, empty, inChain: false });
  }

  // Verify and mark the chain invariant: offset[i] + length[i] == some other
  // active record's own offset. Report deviation count explicitly rather
  // than assuming it holds.
  const offsetToIndex = new Map<number, number>();
  for (const r of records) {
    if (!r.empty) offsetToIndex.set(r.offset, r.index);
  }
  let chained = 0;
  let nonEmpty = 0;
  for (const r of records) {
    if (r.empty) continue;
    nonEmpty++;
    const next = r.offset + r.length;
    if (offsetToIndex.has(next) && next !== r.offset) {
      r.inChain = true;
      chained++;
    }
  }

  console.log(
    `Decoded scenario.dbs section 9: ${RECORD_COUNT} slots, ${nonEmpty} non-empty, ` +
      `${chained}/${nonEmpty} chain to another record's offset (offset[i]+length[i]==offset[j]).`,
  );

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'scenario-section9-directory.json'), {
    note:
      'scenario.dbs section 9 (file offset 0x2df34-EOF, 64x12-byte records). CONFIRMED: records decode ' +
      'as [BE u32 offset][BE u32 length][4-byte tail], and offset[i]+length[i]==offset[j] for another ' +
      'record holds for the large majority of non-empty records (see inChain), forming one continuous ' +
      'cumulative-sum chain -- the same directory invariant already confirmed for the .PIC container ' +
      '(section 2.1 of the main doc) and mazedata.ega (section 4.2). NOT confirmed: which blob this ' +
      'directory partitions (277,826 bytes at the chain end does not match any file in this corpus by ' +
      'size). Records with inChain=false and empty=false are placeholder/reserved slots (small values ' +
      "that don't fit the chain), matching this corpus's convention of duplicate/boilerplate unused-slot " +
      'records elsewhere (e.g. section 2 records 0/1). See docs/wizardry6/amiga/data-structure.md section ' +
      '7.1 ("Section 9") for the full derivation.',
    sectionStart: SECTION_START,
    stride: STRIDE,
    recordCount: RECORD_COUNT,
    records,
  });

  console.log('Wrote scenario-section9-directory.json');
}

main();

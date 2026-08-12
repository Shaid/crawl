/**
 * Extracts the small index/database files on the DOS/EGA release:
 * master.hdr, disk.hdr, pcfile.dbs, and the shared scenario.hdr/
 * newgame.dbs 414-byte header.
 *
 * This platform shares its record layouts with the already-solved Amiga
 * release (see tools/wizardry6/decode-headers.ts and
 * docs/wizardry6/amiga/data-structure.md) -- the only difference is that
 * every multi-byte numeric field is stored little-endian here instead of
 * big-endian. See docs/wizardry6/dosega/data-structure.md section 1 for
 * the byte-exact cross-verification against the Amiga corpus (master.hdr:
 * 20/20 values identical; disk.hdr: 9/9 offsets identical + 656 trailing
 * bytes byte-identical outright; pcfile.dbs: header fields reproduce the
 * same 24 + 16*432 = 6936 structure, though this DOS copy ships 6 sample
 * characters instead of Amiga's empty roster).
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-headers.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r8, r16, r32 } from '@seer-project/core';

const PCFILE_HEADER_BYTES = 24;
const PCFILE_RECORD_BYTES = 432;

const MASTER_HDR_CATEGORY_COUNT = 10;

const DISK_HDR_HEADER_BYTES = 44;
const DISK_HDR_SECTION_OFFSET_COUNT = 9;

const SHARED_HEADER_BYTES = 414;
const SHARED_HEADER_FLAG_OFFSETS = [408, 409, 410, 411, 412, 413];

const DISK_HDR_REMAP_TABLES: Array<{ start: number; size: number }> = [
  { start: 0, size: 16 },
  { start: 16, size: 64 },
  { start: 80, size: 256 },
  { start: 336, size: 256 },
  { start: 592, size: 64 },
];

function decodePcfile(data: Uint8Array) {
  const header = {
    recordSize: r16(data, 0, 'le'),
    recordCount: r16(data, 2, 'le'),
    baseOffset: r32(data, 4, 'le'),
    usedFlags: Array.from({ length: 16 }, (_, i) => r8(data, 8 + i) !== 0),
  };

  const records = [];
  for (let i = 0; i < header.recordCount; i++) {
    const off = header.baseOffset + i * header.recordSize;
    const rec = data.subarray(off, off + header.recordSize);

    let nameEnd = rec.indexOf(0);
    if (nameEnd < 0) nameEnd = rec.length;
    const name = Buffer.from(rec.subarray(0, nameEnd)).toString('latin1');

    records.push({
      index: i,
      used: header.usedFlags[i] ?? false,
      name,
      field412: r8(rec, 412),
      field413: r8(rec, 413),
      field414: r8(rec, 414),
      field415: r8(rec, 415),
    });
  }

  return {
    note:
      'Same 24-byte header + 16x432-byte record structure as the Amiga release (docs/wizardry6/amiga/data-structure.md section 7.3), fields little-endian. This shipped copy has 6 populated sample characters (THESUS, TEMPEST, LYSANDR, NOBAL, TREON, PENTAG) unlike Amiga\'s empty template.',
    header,
    records,
  };
}

function decodeMasterHdr(data: Uint8Array) {
  const recordSizes: number[] = [];
  const recordCounts: number[] = [];
  for (let i = 0; i < MASTER_HDR_CATEGORY_COUNT; i++) {
    recordSizes.push(r16(data, i * 2, 'le'));
    recordCounts.push(r16(data, (MASTER_HDR_CATEGORY_COUNT + i) * 2, 'le'));
  }
  return {
    note:
      '20 x LE u16, byte-exact identical values to the Amiga release once read little-endian -- see docs/wizardry6/dosega/data-structure.md section 1.2.',
    recordSizes,
    recordCounts,
  };
}

function decodeDiskHdr(data: Uint8Array) {
  const sectionOffsets: number[] = [];
  for (let i = 0; i < DISK_HDR_SECTION_OFFSET_COUNT; i++) {
    sectionOffsets.push(r32(data, 8 + i * 4, 'le'));
  }
  const trailing = data.subarray(DISK_HDR_HEADER_BYTES);

  const tables = DISK_HDR_REMAP_TABLES.map(({ start, size }) => {
    let identityConfirmed = true;
    for (let i = 0; i < size; i++) {
      if (trailing[start + i] !== i % 256) {
        identityConfirmed = false;
        break;
      }
    }
    return { start, size, identityConfirmed };
  });

  return {
    note:
      'Same 44-byte header + 656-byte trailing region as the Amiga release, LE u32 offsets. Offsets and trailing identity tables are byte-exact identical to Amiga -- see docs/wizardry6/dosega/data-structure.md section 1.3.',
    sectionOffsets,
    trailingBytes: trailing.length,
    remapTables: tables,
  };
}

function decodeSharedHeader(scenarioHdr: Uint8Array, newgameDbs: Uint8Array) {
  const matches = scenarioHdr.every((b, i) => b === newgameDbs[i]);
  const flagBytes: Record<string, number> = {};
  for (const off of SHARED_HEADER_FLAG_OFFSETS) {
    flagBytes[`offset${off}`] = r8(scenarioHdr, off);
  }
  return {
    note:
      "scenario.hdr shares newgame.dbs's first 414 bytes, same as Amiga. This shipped scenario.hdr differs from newgame.dbs only at the known live-scratch-path bytes (330-335, baked in as \"C:\\BANE\\\") and flag bytes (408, 412, 413) -- see docs/wizardry6/dosega/data-structure.md section 1.4.",
    scenarioHdrMatchesNewgameDbsPrefix: matches,
    length: SHARED_HEADER_BYTES,
    trailingFlagBytes: flagBytes,
  };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-headers.ts <dataDir>');
    process.exit(1);
  }

  const pcfile = readBinary(resolve(dataDir, 'pcfile.dbs'));
  const masterHdr = readBinary(resolve(dataDir, 'master.hdr'));
  const diskHdr = readBinary(resolve(dataDir, 'disk.hdr'));
  const scenarioHdr = readBinary(resolve(dataDir, 'scenario.hdr'));
  const newgameDbs = readBinary(resolve(dataDir, 'newgame.dbs'));

  const expectedPcfileSize = PCFILE_HEADER_BYTES + 16 * PCFILE_RECORD_BYTES;
  if (pcfile.length !== expectedPcfileSize) {
    console.error(
      `pcfile.dbs size mismatch: got ${pcfile.length}, expected ${expectedPcfileSize} (24-byte header + 16*432-byte records)`,
    );
    process.exit(1);
  }

  const out = {
    pcfile: decodePcfile(pcfile),
    masterHdr: decodeMasterHdr(masterHdr),
    diskHdr: decodeDiskHdr(diskHdr),
    sharedHeader: decodeSharedHeader(scenarioHdr, newgameDbs),
  };

  const outDir = resolve('public/assets/wizardry6/dosega/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'headers.json'), out);

  const allTablesIdentity = out.diskHdr.remapTables.every((t) => t.identityConfirmed);
  console.log(
    `Wrote headers.json: pcfile.dbs (${out.pcfile.records.length} records, ${out.pcfile.records.filter((r) => r.used).length} used), master.hdr (${out.masterHdr.recordSizes.length} sections), disk.hdr (${out.diskHdr.sectionOffsets.length} section offsets, all-identity=${allTablesIdentity}), shared header (match=${out.sharedHeader.scenarioHdrMatchesNewgameDbsPrefix})`,
  );
}

main();

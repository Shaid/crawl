/**
 * Extracts the small index/database files: master.hdr, disk.hdr,
 * pcfile.dbs, and the scenario.hdr/newgame.dbs shared 414-byte header.
 *
 * Format details, evidence, and disassembly citations:
 * docs/wizardry6/amiga/investigations/headers-and-databases.md (not yet
 * merged into the main data-structure.md -- see that file's status note).
 * Summary:
 *
 * - pcfile.dbs = 24-byte header (recordSize u16, recordCount u16,
 *   baseOffset u32, usedFlags byte[16]) + recordCount x 432-byte character
 *   records. Confirmed byte-exact: 24 + 16*432 = 6936 (the real file
 *   size) -- overturns an earlier 289x24-record hypothesis. Only 4 fields
 *   are located within each 432-byte record this pass: offset 0 (a
 *   NUL-terminated name string) and 4 single bytes at offsets 412-415
 *   (UI icon/status fields, semantics undetermined). All 16 shipped
 *   records are empty (fresh-install template).
 *
 * - master.hdr = 20 x BE u16: words[0..9] are scenario.dbs's per-section
 *   record sizes, words[10..19] are the matching per-section record
 *   counts. Confirmed via a 10/10 exact-divisor cross-check against
 *   disk.hdr's section boundaries (see below) -- and section 0 exactly
 *   reproduces scenario.dbs's already-independently-confirmed XP-table
 *   boundary (14 records x 64 bytes = 896 bytes), discovered with zero
 *   knowledge of this section system.
 *
 * - disk.hdr = 44-byte header (4 zero words + 9 BE u32 section-boundary
 *   offsets into scenario.dbs) + 656 trailing bytes that are read by code
 *   as 5 record-index remap lookup tables, but whose actual content is a
 *   literal 0x00-0xFF ramp (confirmed-consumed, but functionally
 *   near-identity in the shipped game).
 *
 * - scenario.hdr / newgame.dbs share an identical first 414 bytes
 *   (confirmed in the main doc). This pass additionally locates 6
 *   individually-addressed trailing flag/state bytes at file offset
 *   408-413 within that shared header. newgame.dbs's remaining ~49KB is
 *   not decoded (the "start new game" trigger treats the whole file as an
 *   opaque copy-source for creating SAVEGAME.DBS, not something it parses
 *   field-by-field).
 *
 * Usage: npx tsx tools/wizardry6/decode-headers.ts <dataDir>
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

function decodePcfile(data: Uint8Array) {
  const header = {
    recordSize: r16(data, 0, 'be'),
    recordCount: r16(data, 2, 'be'),
    baseOffset: r32(data, 4, 'be'),
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
      // Offsets 412-415: confirmed-accessed single-byte fields, semantics
      // not yet determined (see investigation doc section 1.2).
      field412: r8(rec, 412),
      field413: r8(rec, 413),
      field414: r8(rec, 414),
      field415: r8(rec, 415),
    });
  }

  return {
    note:
      'Header (24B) + 16 x 432B character records. Overturns an earlier 289x24 hypothesis -- see docs/wizardry6/amiga/investigations/headers-and-databases.md section 1. Only offset 0 (name) and 412-415 are located within each record; the rest is undecoded.',
    header,
    records,
  };
}

function decodeMasterHdr(data: Uint8Array) {
  const recordSizes: number[] = [];
  const recordCounts: number[] = [];
  for (let i = 0; i < MASTER_HDR_CATEGORY_COUNT; i++) {
    recordSizes.push(r16(data, i * 2, 'be'));
    recordCounts.push(r16(data, (MASTER_HDR_CATEGORY_COUNT + i) * 2, 'be'));
  }
  return {
    note:
      "20 x BE u16: words[0..9] are scenario.dbs's per-section record sizes, words[10..19] are the matching per-section record counts. See docs/wizardry6/amiga/investigations/headers-and-databases.md section 2.",
    recordSizes,
    recordCounts,
  };
}

// 5 record-index remap lookup tables found within disk.hdr's trailing
// region (relative to file offset 44, where the 44-byte header ends).
// Confirmed via disassembly (5 LEA sites feeding a category-dispatch
// switch) and via boundary-sum arithmetic (16+64+256+256+64 = 656 =
// the whole trailing region, zero remainder). See investigation doc
// section 3.2.
const DISK_HDR_REMAP_TABLES: Array<{ start: number; size: number }> = [
  { start: 0, size: 16 },
  { start: 16, size: 64 },
  { start: 80, size: 256 },
  { start: 336, size: 256 },
  { start: 592, size: 64 },
];

function decodeDiskHdr(data: Uint8Array) {
  const sectionOffsets: number[] = [];
  for (let i = 0; i < DISK_HDR_SECTION_OFFSET_COUNT; i++) {
    sectionOffsets.push(r32(data, 8 + i * 4, 'be'));
  }
  const trailing = data.subarray(DISK_HDR_HEADER_BYTES);

  // Each table independently is an identity ramp (table[i] == i, mod 256,
  // resetting to 0 at its own start) -- confirmed per-table, not one
  // continuous ramp across the whole trailing region.
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
      'Header (44B: 4 zero words + 9 BE u32 scenario.dbs section-boundary offsets) + 656 trailing bytes read as 5 record-index remap lookup tables. Each table is independently an identity ramp (table[i] == i) in the shipped file -- confirmed-consumed by code, but functionally a no-op remap. See docs/wizardry6/amiga/investigations/headers-and-databases.md section 3.',
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
      "scenario.hdr is byte-identical to newgame.dbs's first 414 bytes. 6 individually-addressed trailing flag/state bytes located at file offset 408-413 (semantics not determined -- compared against literal 1/3 at several call sites). See docs/wizardry6/amiga/investigations/headers-and-databases.md section 4.",
    scenarioHdrMatchesNewgameDbsPrefix: matches,
    length: SHARED_HEADER_BYTES,
    trailingFlagBytes: flagBytes,
  };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-headers.ts <dataDir>');
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

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'headers.json'), out);

  const allTablesIdentity = out.diskHdr.remapTables.every((t) => t.identityConfirmed);
  console.log(
    `Wrote headers.json: pcfile.dbs (${out.pcfile.records.length} records), master.hdr (${out.masterHdr.recordSizes.length} sections), disk.hdr (${out.diskHdr.sectionOffsets.length} section offsets, ${out.diskHdr.remapTables.length} remap tables, all-identity=${allTablesIdentity}), shared header (match=${out.sharedHeader.scenarioHdrMatchesNewgameDbsPrefix})`,
  );
}

main();

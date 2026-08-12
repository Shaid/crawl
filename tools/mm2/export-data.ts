/**
 * Decode every MM2 `.dat` file present in `<dataDir>` to JSON under
 * `public/assets/mm2/amiga/data/`.
 *
 * Usage: npx tsx tools/mm2/export-data.ts <dataDir>
 *
 * `dataDir` is normally `data/mm2/amiga` (place your retail files there).
 * Each decoder is self-contained and skips gracefully when its file is
 * missing. Files currently decoded:
 *
 *   items.dat, monsters.dat, roster.dat, spells.dat, str.dat,
 *   map.dat, attrib.dat, event.dat
 *
 * See `docs/mm2/amiga/data-structure.md` for the per-file field layouts and
 * `docs/mm2/TODO.md` for what is verified against real data vs documented-only.
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { decodeItems } from './items.ts';
import { decodeMonsters } from './monsters.ts';
import { decodeRoster } from './roster.ts';
import { decodeSpellsDat } from './spells.ts';
import { decodeStr } from './str.ts';
import { decodeMap } from './map.ts';
import { decodeAttrib } from './attrib.ts';
import { decodeEventFile } from './event.ts';

export interface ExportResult {
  game: 'mm2';
  platform: 'amiga';
  dataDir: string;
  outDir: string;
  written: string[];
  missing: string[];
}

function dump<T>(name: string, dataDir: string, outDir: string, decode: (d: Uint8Array) => T, written: string[], missing: string[]) {
  const path = resolve(dataDir, name);
  if (!existsSync(path)) {
    missing.push(name);
    return;
  }
  const decoded = decode(readBinary(path));
  const outPath = resolve(outDir, name.replace(/\.dat$/, '') + '.json');
  writeJson(outPath, decoded);
  written.push(outPath);
}

export function exportMm2Data(dataDir: string): ExportResult {
  const outDir = resolve('public/assets/mm2/amiga/data');
  mkdirSync(outDir, { recursive: true });

  const written: string[] = [];
  const missing: string[] = [];

  dump('items.dat', dataDir, outDir, decodeItems, written, missing);
  dump('monsters.dat', dataDir, outDir, decodeMonsters, written, missing);
  dump('roster.dat', dataDir, outDir, decodeRoster, written, missing);
  dump('spells.dat', dataDir, outDir, decodeSpellsDat, written, missing);
  dump('str.dat', dataDir, outDir, (d) => decodeStr(d), written, missing);
  dump('map.dat', dataDir, outDir, decodeMap, written, missing);
  dump('attrib.dat', dataDir, outDir, decodeAttrib, written, missing);
  dump('event.dat', dataDir, outDir, decodeEventFile, written, missing);

  return { game: 'mm2', platform: 'amiga', dataDir, outDir, written, missing };
}

export function main(): void {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/mm2/export-data.ts <dataDir>');
    process.exit(1);
  }
  if (!existsSync(dataDir)) {
    console.error(`Data dir not found: ${dataDir}`);
    console.error('Place your MM2 Amiga files (items.dat, monsters.dat, roster.dat, ...) there and re-run.');
    process.exit(1);
  }

  const result = exportMm2Data(dataDir);
  for (const p of result.written) console.log(`  wrote ${p}`);
  for (const m of result.missing) console.log(`  skipped (not found): ${m}`);
  console.log(`${result.written.length} decoded, ${result.missing.length} missing`);
}

const isStandalone =
  process.argv[1]?.endsWith('export-data.ts') ||
  process.argv[1]?.endsWith('export-data');

if (isStandalone) main();

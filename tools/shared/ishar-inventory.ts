/**
 * Directory-catalog scanner for an Ishar-engine data directory (Ishar 1/2/3
 * or Crystals of Arborea). Parses every resource file's 16-byte container
 * header (`ishar-container.ts`) and writes a JSON inventory — this is the
 * "file-role catalog" deliverable, independent of whether the compression
 * codec itself has been cracked yet (see `docs/ishar/amigaaga/data-structure.md`).
 *
 * Does NOT decompress anything. `decompressedSize` is the header's claimed
 * value (CONFIRMED structurally consistent, not yet CONFIRMED by an actual
 * decode — see the doc).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { assetDir, writeJson } from './asset-paths.js';
import { compressionRatio, HEADER_SIZE, parseIsharHeader } from './ishar-container.js';

export interface InventoryEntry {
  name: string;
  ext: string;
  fileSize: number;
  /** null for files too short to carry a 16-byte header, or non-container files. */
  classByte: string | null;
  decompressedSize: number | null;
  ratio: number | null;
  table: string | null;
  marker: string | null;
  method: number | null;
  stored: boolean | null;
  note?: string;
}

const CONTAINER_EXTS = new Set(['.DO', '.CO']);

export function scanIsharDir(dataDir: string): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  for (const name of readdirSync(dataDir).sort()) {
    const path = join(dataDir, name);
    const st = statSync(path);
    if (!st.isFile()) continue;
    const ext = extname(name).toUpperCase();
    const fileSize = st.size;

    if (!CONTAINER_EXTS.has(ext)) {
      entries.push({
        name,
        ext: ext || '(none)',
        fileSize,
        classByte: null,
        decompressedSize: null,
        ratio: null,
        table: null,
        marker: null,
        method: null,
        stored: null,
        note: 'non-container file (not .DO/.CO) — not scanned as an Ishar resource',
      });
      continue;
    }

    const buf = readFileSync(path);
    if (buf.length < HEADER_SIZE) {
      entries.push({
        name,
        ext,
        fileSize,
        classByte: null,
        decompressedSize: null,
        ratio: null,
        table: null,
        marker: null,
        method: null,
        stored: null,
        note: `too short for 16-byte header (${buf.length} bytes)`,
      });
      continue;
    }

    const header = parseIsharHeader(buf);
    entries.push({
      name,
      ext,
      fileSize,
      classByte: '0x' + header.classByte.toString(16).padStart(2, '0'),
      decompressedSize: header.decompressedSize,
      ratio: Math.round(compressionRatio(header, fileSize) * 1000) / 1000,
      table: header.table.toString('hex'),
      marker: '0x' + header.marker.toString(16).padStart(2, '0'),
      method: header.method,
      stored: header.stored,
    });
  }
  return entries;
}

export function summarize(entries: InventoryEntry[]): Record<string, unknown> {
  const containerEntries = entries.filter((e) => e.classByte !== null);
  const byClass = new Map<string, number>();
  for (const e of containerEntries) {
    byClass.set(e.classByte!, (byClass.get(e.classByte!) ?? 0) + 1);
  }
  const storedCount = containerEntries.filter((e) => e.stored).length;
  const ratios = containerEntries.filter((e) => !e.stored).map((e) => e.ratio!);
  return {
    totalFiles: entries.length,
    containerFiles: containerEntries.length,
    nonContainerFiles: entries.length - containerEntries.length,
    byClassByte: Object.fromEntries(byClass),
    storedFiles: storedCount,
    compressedFiles: containerEntries.length - storedCount,
    ratioMin: ratios.length ? Math.min(...ratios) : null,
    ratioMax: ratios.length ? Math.max(...ratios) : null,
    ratioMean: ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000 : null,
  };
}

/** Run the scan, write `data/container-inventory.json`, and print a summary. */
export function runInventory(dataDir: string, game: string, platform: string): void {
  const entries = scanIsharDir(dataDir);
  const summary = summarize(entries);
  const outDir = assetDir('data', game, platform);
  writeJson(join(outDir, 'container-inventory.json'), { summary, entries });
  console.log(`${game}/${platform}: scanned ${entries.length} files in ${dataDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

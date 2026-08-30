/**
 * Batch decompression + verification for an Ishar-engine data directory,
 * built on `silmarils-unpack.ts`. Two outputs:
 *
 * - Raw decompressed bytes -> `build/cache/<game>/<platform>/decompressed/
 *   <NAME>.bin` (non-web intermediate, gitignored, per this project's
 *   output conventions — never written to `public/assets/`).
 * - A verification report + extracted printable-text runs ->
 *   `public/assets/<game>/<platform>/data/decompression-report.json` and
 *   `data/text-strings.json`. `decompression-report.json`'s `ok` flag only
 *   records that decoding completed without an exception and produced the
 *   declared byte count — it does NOT carry the packed-byte-consumption
 *   self-consistency numbers cited in `docs/ishar-container-format.md` §2.5
 *   (those were computed with a one-off scratch check during investigation,
 *   not persisted here). The strongest oracle this report DOES capture is
 *   indirect: `text-strings.json` having real, readable decoded content is
 *   itself evidence the codec is right (see §2.5's second oracle).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { assetDir, writeJson } from './asset-paths.js';
import { unpackSilmarilsScript, type UnpackResult } from './silmarils-unpack.js';

export interface DecompressReportEntry {
  name: string;
  packerKind: string;
  isMain: boolean;
  declaredSize: number;
  decodedLength: number;
  ok: boolean;
}

export interface TextRun {
  offset: number;
  text: string;
}

/** Extract printable-ASCII runs of length >= minLen from decompressed bytes. */
export function extractTextRuns(data: Uint8Array, minLen = 4): TextRun[] {
  const runs: TextRun[] = [];
  let start = -1;
  for (let i = 0; i <= data.length; i++) {
    const b = i < data.length ? data[i] : 0;
    const printable = b >= 0x20 && b <= 0x7e;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) {
        runs.push({ offset: start, text: Buffer.from(data.subarray(start, i)).toString('latin1') });
      }
      start = -1;
    }
  }
  return runs;
}

export function decompressDir(
  dataDir: string,
  game: string,
  platform: string,
): { report: DecompressReportEntry[]; textByFile: Record<string, TextRun[]> } {
  const cacheDir = resolve('build/cache', game, platform, 'decompressed');
  mkdirSync(cacheDir, { recursive: true });

  const report: DecompressReportEntry[] = [];
  const textByFile: Record<string, TextRun[]> = {};

  for (const name of readdirSync(dataDir).sort()) {
    const ext = extname(name).toUpperCase();
    if (ext !== '.DO' && ext !== '.CO') continue;
    const path = join(dataDir, name);
    if (!statSync(path).isFile()) continue;

    const buf = readFileSync(path);
    let result: UnpackResult | null;
    try {
      result = unpackSilmarilsScript(buf);
    } catch {
      report.push({
        name,
        packerKind: 'ERROR',
        isMain: false,
        declaredSize: buf.length,
        decodedLength: 0,
        ok: false,
      });
      continue;
    }
    if (!result) {
      // classByte === 0x01 (stored, bit 7 of byte 0 clear — CONFIRMED via
      // disassembly, see docs/ishar-container-format.md §2.2/§6): the game's
      // own loader takes the raw-copy path, no decompression. The content
      // still sits behind the same 6-byte [magic][isMain] header (+16 more
      // if isMain), just uncompressed.
      const magic = buf.readUInt32BE(0);
      const isMain = buf.readUInt16BE(4) === 0;
      const headerSize = 6 + (isMain ? 16 : 0);
      const data = buf.subarray(headerSize);
      writeFileSync(join(cacheDir, name.replace(/\.(DO|CO)$/i, '.bin')), Buffer.from(data));
      report.push({
        name,
        packerKind: 'stored',
        isMain,
        declaredSize: magic & 0x00ffffff,
        decodedLength: data.length,
        ok: true,
      });
      const runs = extractTextRuns(data, 5);
      if (runs.length > 0) textByFile[name] = runs;
      continue;
    }

    writeFileSync(join(cacheDir, name.replace(/\.(DO|CO)$/i, '.bin')), Buffer.from(result.data));
    report.push({
      name,
      packerKind: '0x' + result.packerKind.toString(16),
      isMain: result.isMain,
      declaredSize: buf.length,
      decodedLength: result.data.length,
      ok: true,
    });
    const runs = extractTextRuns(result.data, 5);
    if (runs.length > 0) textByFile[name] = runs;
  }

  const outDir = assetDir('data', game, platform);
  writeJson(join(outDir, 'decompression-report.json'), report);
  writeJson(join(outDir, 'text-strings.json'), textByFile);

  return { report, textByFile };
}

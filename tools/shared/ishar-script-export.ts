/**
 * Ship selected DECOMPRESSED Ishar `.DO`/`.CO` scripts as raw binary web
 * assets (`public/assets/<game>/<platform>/scripts/<lowercased-name>.bin`)
 * for client-side consumption by `tools/walker`'s first-person renderer
 * (`tools/shared/ishar-firstperson.ts` + `alis-interp.ts`).
 *
 * Why ship pre-decompressed bytes rather than have the browser fetch the
 * raw `.DO` file and decompress it itself: `silmarils-unpack.ts` uses
 * Node's `Buffer` (`Buffer.from`, `instanceof Buffer`) internally, and this
 * project's `vite.config.ts` has no Buffer polyfill — decompressing in the
 * browser would silently break there. Decompression is cheap and already
 * fully solved server-side (`ishar-decompress.ts`), so this just reuses
 * that exact codec path and writes the *output* bytes as a static asset,
 * matching the project's "browser only ever consumes preprocessed output"
 * convention (architecture-overview.md).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { assetRoot } from './asset-paths.js';
import { unpackSilmarilsScript } from './silmarils-unpack.js';

export interface ScriptExportReportEntry {
  name: string;
  ok: boolean;
  decodedLength?: number;
  error?: string;
}

/**
 * `names`, if given, restricts the export to specific base names
 * (case-insensitive, without extension), e.g. `['FORET', 'FOND']`. Omit to
 * export every `.DO`/`.CO` file in `dataDir`.
 */
export function exportIsharScripts(
  dataDir: string,
  game: string,
  platform: string,
  names?: string[],
): ScriptExportReportEntry[] {
  const want = names ? new Set(names.map((n) => n.toUpperCase())) : null;
  const outDir = join(assetRoot(game, platform), 'scripts');
  mkdirSync(outDir, { recursive: true });
  const report: ScriptExportReportEntry[] = [];

  for (const file of readdirSync(dataDir).sort()) {
    const ext = extname(file).toUpperCase();
    if (ext !== '.DO' && ext !== '.CO') continue;
    const base = file.replace(/\.(DO|CO)$/i, '');
    if (want && !want.has(base.toUpperCase())) continue;
    const path = join(dataDir, file);
    if (!statSync(path).isFile()) continue;

    const buf = readFileSync(path);
    try {
      let data: Uint8Array;
      const result = unpackSilmarilsScript(buf);
      if (result) {
        data = result.data;
      } else {
        // Stored (uncompressed, classByte 0x01) -- same header-strip logic
        // as decompressDir() in ishar-decompress.ts.
        const magic = buf.readUInt32BE(0);
        const isMain = buf.readUInt16BE(4) === 0;
        const headerSize = 6 + (isMain ? 16 : 0);
        data = buf.subarray(headerSize);
        void magic;
      }
      writeFileSync(join(outDir, `${base.toLowerCase()}.bin`), Buffer.from(data));
      report.push({ name: file, ok: true, decodedLength: data.length });
    } catch (err) {
      report.push({ name: file, ok: false, error: (err as Error).message });
    }
  }
  return report;
}

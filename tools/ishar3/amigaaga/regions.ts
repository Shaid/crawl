/**
 * Ishar 3 (Amiga AGA) — world-region grid (`CONT*-3.FIC`) export.
 * Usage: npx tsx tools/ishar3/amigaaga/regions.ts [dataDir]
 * Output: public/assets/ishar3/amigaaga/data/regions.json, manifest.json.
 */
import { extractIsharRegions } from '../../shared/ishar-region-export.ts';

const dataDir = process.argv[2] ?? 'data/ishar3/amigaaga';
const report = extractIsharRegions(dataDir, 'ishar3', 'amigaaga');
const ok = report.regions.filter((r) => r.ok).length;
console.log(`ishar3/amigaaga: ${ok}/${report.regions.length} region grids decoded`);
for (const r of report.regions) if (!r.ok) console.error(`  FAILED ${r.name}: ${r.error}`);

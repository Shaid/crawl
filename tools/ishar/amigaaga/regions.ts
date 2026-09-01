/**
 * Ishar 1 (Amiga AGA) — world-region grid (`CONT*.FIC`) export.
 * Usage: npx tsx tools/ishar/amigaaga/regions.ts [dataDir]
 * Output: public/assets/ishar/amigaaga/data/regions.json, manifest.json.
 */
import { extractIsharRegions } from '../../shared/ishar-region-export.ts';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
const report = extractIsharRegions(dataDir, 'ishar', 'amigaaga');
const ok = report.regions.filter((r) => r.ok).length;
console.log(`ishar/amigaaga: ${ok}/${report.regions.length} region grids decoded`);
for (const r of report.regions) if (!r.ok) console.error(`  FAILED ${r.name}: ${r.error}`);

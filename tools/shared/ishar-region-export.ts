/**
 * Batch export of Ishar `CONT*.FIC` world-region grids to a single
 * `public/assets/<game>/<platform>/data/regions.json` for the walker
 * (`tools/walker/games-ishar.ts`). See `tools/shared/ishar-regions.ts` for
 * the format/verification evidence.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson, dataManifestEntry, writeManifest } from './asset-paths.ts';
import { decodeIsharRegion, ISHAR_REGION_LAYOUT, type IsharRegionGrid } from './ishar-regions.ts';

export interface RegionExportReport {
  game: string;
  regions: Array<{ name: string; ok: boolean; error?: string }>;
}

export function extractIsharRegions(
  dataDir: string,
  game: 'ishar' | 'ishar2' | 'ishar3',
  platform: string,
): RegionExportReport {
  const layout = ISHAR_REGION_LAYOUT[game];
  const files = readdirSync(dataDir).filter((f) => /^CONT.*\.FIC$/i.test(f));
  const grids: IsharRegionGrid[] = [];
  const report: RegionExportReport = { game, regions: [] };

  for (const file of files.sort()) {
    const name = file.replace(/\.FIC$/i, '');
    try {
      const raw = readFileSync(resolve(dataDir, file));
      const grid = decodeIsharRegion(name, new Uint8Array(raw), layout);
      grids.push(grid);
      report.regions.push({ name, ok: true });
    } catch (err) {
      report.regions.push({ name, ok: false, error: (err as Error).message });
    }
  }

  const dir = assetDir('data', game, platform);
  writeJson(resolve(dir, 'regions.json'), {
    width: layout.width,
    height: layout.height,
    layerCount: layout.layers,
    regions: grids.map((g) => ({
      name: g.name,
      layers: g.layers.map((l) => Array.from(l)),
    })),
  });
  writeJson(resolve(dir, 'region-export-report.json'), report);
  writeManifest([dataManifestEntry('data/regions', 'data/regions.json')], game, platform);

  return report;
}

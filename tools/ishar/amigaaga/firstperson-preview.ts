/**
 * Ishar 1 (Amiga AGA) — real-colour first-person preview. Verification/
 * documentation artifact for the `ishar-sprite-palette` TODO item
 * (`docs/ishar-sprite-format.md` §5, `docs/ishar/TODO.md`): renders one
 * `FORET.bin` (forest) frame twice -- once exactly as before (no `palette`
 * option, existing greyscale path unchanged) and once with the real AGA
 * world palette resolved from `FOND.bin`'s own directory
 * (`resolveIsharOwnPalette()`, `tools/shared/ishar-palette.ts`) -- so the
 * two can be compared side by side. Only the colour PNG is a real shipped
 * asset (`public/assets/ishar/amigaaga/screens/foret-color.png`); the
 * greyscale one is written alongside purely for this comparison and is NOT
 * a new asset (the interactive walker already renders this path live).
 *
 * Position/facing: scans `CONT1`'s real terrain grid (already-shipped
 * `data/regions.json`) for the first cell where `FORET.bin` actually places
 * >= 1 sprite (many cells do, per the already-CONFIRMED mechanism -- see
 * `docs/ishar-container-format.md` §8) rather than hardcoding a single
 * previously-used test position.
 *
 * Usage: npx tsx tools/ishar/amigaaga/firstperson-preview.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, writeJson, writeManifest } from '../../shared/asset-paths.js';
import { renderIsharLocationFrame, type RegionGridSource } from '../../shared/ishar-firstperson.js';
import { resolveIsharOwnPalette } from '../../shared/ishar-palette.js';

const scriptsDir = 'public/assets/ishar/amigaaga/scripts';
const foret = new Uint8Array(readFileSync(resolve(scriptsDir, 'foret.bin')));
const fond = new Uint8Array(readFileSync(resolve(scriptsDir, 'fond.bin')));

const regions = JSON.parse(readFileSync('public/assets/ishar/amigaaga/data/regions.json', 'utf8')) as {
  width: number;
  height: number;
  regions: Array<{ name: string; layers: number[][] }>;
};
const cont1 = regions.regions.find((r) => r.name === 'CONT1');
if (!cont1) throw new Error('CONT1 region not found in regions.json');
const terrain = cont1.layers[0]!;
const grid: RegionGridSource = {
  width: regions.width,
  height: regions.height,
  read(_buf, gx, gy) {
    if (gx < 0 || gy < 0 || gx >= regions.width || gy >= regions.height) return 0;
    const v = terrain[gy * regions.width + gx]!;
    return v >= 128 ? v - 256 : v; // sign-extend, per ishar-regions.ts's tabchar() convention
  },
};

const palette = resolveIsharOwnPalette(fond);
if (!palette) throw new Error('FOND.bin has no resolvable 0xFE-marked palette resource');

/** Pick the richest (highest placement-count) interior pose found, rather than the first non-empty one, for a more informative verification screenshot. */
function findRenderablePose(): { partyX: number; partyY: number; facing: 0 | 1 | 2 | 3 } {
  let best: { partyX: number; partyY: number; facing: 0 | 1 | 2 | 3 } | null = null;
  let bestCount = 0;
  for (let y = 2; y < regions.height - 2; y++) {
    for (let x = 2; x < regions.width - 2; x++) {
      for (const facing of [0, 1, 2, 3] as const) {
        const frame = renderIsharLocationFrame({ location: foret, fond, partyX: x, partyY: y, facing, grid });
        if (frame.placementCount > bestCount) {
          bestCount = frame.placementCount;
          best = { partyX: x, partyY: y, facing };
        }
      }
    }
  }
  if (!best) throw new Error('no CONT1 cell produced a non-empty FORET.bin placement');
  return best;
}

const pose = findRenderablePose();
console.log(`FORET.bin: using pose x=${pose.partyX} y=${pose.partyY} facing=${pose.facing}`);

const grey = renderIsharLocationFrame({ location: foret, fond, ...pose, grid });
const color = renderIsharLocationFrame({ location: foret, fond, ...pose, grid, palette });
console.log(`placements: grey=${grey.placementCount} color=${color.placementCount}`);

await writePNG(resolve('tools/.scratch/foret-preview-grey.png'), grey.rgba, grey.width, grey.height);

const outDir = assetDir('screens', 'ishar', 'amigaaga');
const pngPath = resolve(outDir, 'foret-color.png');
await writePNG(pngPath, color.rgba, color.width, color.height);
writeJson(resolve(outDir, 'foret-color.json'), {
  frames: [{ name: 'foret-color', x: 0, y: 0, w: color.width, h: color.height }],
  width: color.width,
  height: color.height,
});
writeManifest(
  [{ name: 'screens/foret-color', sprites: 1, hasPalette: true, png: 'screens/foret-color.png', kind: 'atlas', data: 'screens/foret-color.json' }],
  'ishar',
  'amigaaga',
);
console.log(`wrote ${pngPath}`);

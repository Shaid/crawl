/**
 * Merge one `kind: 'data'` manifest entry per JSON file found under every
 * registered game+platform's `public/assets/<game>/<platform>/data/`.
 *
 * The per-game extractors write the data JSONs; this step keeps the viewer's
 * data-table section in sync without each extractor needing to know about
 * manifests. Idempotent (upsert-by-name). Run after any extraction:
 *
 *   npm run sync-data-manifests
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_IDS, type GameId } from '../src/game-id.ts';
import { VIEWER_CONFIGS } from './shared/viewer-config.ts';
import { assetRoot, syncDataManifest } from './shared/asset-paths.ts';

function main(): void {
  let total = 0;
  for (const game of GAME_IDS) {
    const config = VIEWER_CONFIGS[game as GameId];
    for (const platform of config.supportedPlatforms) {
      const dataDir = resolve(assetRoot(game as string, platform), 'data');
      if (!existsSync(dataDir)) continue;
      const n = syncDataManifest(game as string, platform);
      if (n > 0) {
        console.log(`${game}/${platform}: ${n} data tables`);
        total += n;
      }
    }
  }
  console.log(`synced ${total} data-table manifest entries`);
}

main();

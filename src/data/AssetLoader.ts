import { loadAssets, createAssetLoader } from '@seer/core';
import type { AtlasMeta, GameAssets, ManifestEntry, PaletteData } from './GameData.ts';
import type { GameId, PlatformId } from '../game-id.ts';

function assetBasePath(game: GameId, platform: PlatformId): string {
  return `/assets/${game}/${platform}`;
}

/** Load the asset manifest for a game/platform — the index of every atlas. */
export async function loadGameAssets(game: GameId, platform: PlatformId): Promise<GameAssets> {
  const base = assetBasePath(game, platform);
  return loadAssets<GameAssets>(base, { manifest: 'manifest.json' });
}

/**
 * Load one named atlas from the manifest — its frame metadata, and its
 * palette sidecar when `hasPalette` is set.
 */
export async function loadAtlas(
  game: GameId,
  platform: PlatformId,
  entry: ManifestEntry,
): Promise<{ imageUrl: string; atlas: AtlasMeta; palette: PaletteData | null }> {
  const base = assetBasePath(game, platform);
  const load = createAssetLoader(base);
  const schema = entry.hasPalette
    ? { atlas: `${entry.name}.json`, palette: `${entry.name}.pal.json` }
    : { atlas: `${entry.name}.json` };
  const { atlas, palette } = await load<{ atlas: AtlasMeta; palette?: PaletteData }>(schema);
  return { imageUrl: `${base}/${entry.png}`, atlas, palette: palette ?? null };
}

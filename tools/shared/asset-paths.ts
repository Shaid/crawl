/**
 * Where extracted assets go — the TypeScript counterpart of `scripts/bclib/paths.py`.
 * The two must agree: Python and TS both write into `public/assets/<game>/<platform>/`
 * and merge into the same `manifest.json` rather than overwrite it, since each
 * side contributes different asset groups in no fixed order.
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

export const CATEGORIES = ['palettes', 'sprites', 'screens', 'textures', 'audio', 'data'] as const;
export type AssetCategory = (typeof CATEGORIES)[number];

export interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
  /** 'data' entries are JSON tables rendered by the viewer, not atlases. */
  kind?: 'atlas' | 'data';
  /** JSON path relative to the asset root; defaults to `${name}.json`. */
  data?: string;
}

export function assetRoot(game: string, platform: string): string {
  return resolve('public/assets', game, platform);
}

/** Directory for one asset category, created on demand. */
export function assetDir(category: AssetCategory, game: string, platform: string): string {
  const dir = resolve(assetRoot(game, platform), category);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(path: string, data: unknown, pretty = true): void {
  writeFileSync(path, JSON.stringify(data, null, pretty ? 2 : undefined));
}

export function manifestEntry(name: string, sprites: number, hasPalette = false): ManifestEntry {
  return { name, sprites, hasPalette, png: `${name}.png` };
}

/** Manifest entry for a data-table JSON (viewer renders it as a table). */
export function dataManifestEntry(name: string, dataPath?: string): ManifestEntry {
  return {
    name,
    sprites: 0,
    hasPalette: false,
    png: '',
    kind: 'data',
    data: dataPath ?? `${name}.json`,
  };
}

/**
 * Merge one `kind: 'data'` entry per JSON file found under
 * `public/assets/<game>/<platform>/data/`, so the viewer's data-table
 * section stays in sync with whatever the extractors wrote.
 */
export function syncDataManifest(game: string, platform: string): number {
  const dataDir = resolve(assetRoot(game, platform), 'data');
  if (!existsSync(dataDir)) return 0;
  const entries: ManifestEntry[] = [];
  for (const f of readdirSync(dataDir)) {
    if (!f.endsWith('.json')) continue;
    const name = `data/${f.replace(/\.json$/, '')}`;
    entries.push(dataManifestEntry(name, `data/${f}`));
  }
  if (entries.length) writeManifest(entries, game, platform);
  return entries.length;
}

/** Merge `entries` into manifest.json, upserting by name. */
export function writeManifest(entries: ManifestEntry[], game: string, platform: string): ManifestEntry[] {
  const root = assetRoot(game, platform);
  mkdirSync(root, { recursive: true });
  const path = resolve(root, 'manifest.json');

  const existing = new Map<string, ManifestEntry>();
  if (existsSync(path)) {
    try {
      for (const e of JSON.parse(readFileSync(path, 'utf-8')) as ManifestEntry[]) {
        existing.set(e.name, e);
      }
    } catch {
      existing.clear();
    }
  }
  for (const e of entries) existing.set(e.name, e);

  const merged = [...existing.values()].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(path, JSON.stringify(merged, null, 2));
  return merged;
}

/** public/assets/index.json — lets a viewer offer a game/platform switcher. */
export function writePlatformIndex(platforms: Array<{ game: string; platform: string }>): void {
  const path = resolve('public/assets/index.json');
  mkdirSync(resolve('public/assets'), { recursive: true });

  const existing = new Map<string, { game: string; platform: string; manifest: string }>();
  if (existsSync(path)) {
    try {
      for (const e of JSON.parse(readFileSync(path, 'utf-8')) as Array<{ game: string; platform: string; manifest: string }>) {
        existing.set(`${e.game}/${e.platform}`, e);
      }
    } catch {
      existing.clear();
    }
  }
  for (const { game, platform } of platforms) {
    existing.set(`${game}/${platform}`, {
      game,
      platform,
      manifest: `/assets/${game}/${platform}/manifest.json`,
    });
  }
  const merged = [...existing.values()].sort((a, b) =>
    a.game === b.game ? a.platform.localeCompare(b.platform) : a.game.localeCompare(b.game),
  );
  writeFileSync(path, JSON.stringify(merged, null, 2));
}

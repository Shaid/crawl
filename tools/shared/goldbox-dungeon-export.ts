/**
 * Shared "write the decoded GEO dungeon grid + a wall-texture index" step for
 * all four Gold Box sibling titles (Pool of Radiance's own `.dax`-based
 * extractor and the three GLIB titles' shared `exportGoldBoxGlibData`).
 *
 * Writes, under `public/assets/<game>/<platform>/`:
 *   dungeon/level-<id>.json   — one decoded `GeoLevel` (see goldbox-geo.ts).
 *   dungeon/levels-index.json — `{levels:[{id,file}]}`, the SAME shape the
 *                                walker harness's generic `listLevels`
 *                                fallback already expects (no per-title
 *                                branch needed in tools/walker/walker.ts).
 *   dungeon/wall-index.json   — every rendered wall-view PNG this title's
 *                                extractor already wrote to `textures/`,
 *                                found by scanning the directory rather than
 *                                threading a list through the render step
 *                                (works uniformly across PoR's single naming
 *                                scheme and the GLIB titles' scheme-1/
 *                                scheme-2 dual naming — see
 *                                `goldbox-glib-export.ts`). When both a
 *                                `walldef-` (scheme 1) and `walldef2-`
 *                                (scheme 2 — the pairing the game actually
 *                                uses at runtime, per
 *                                `docs/goldbox-glib-format.md` §5.7) render
 *                                exist for the same id+wallNumber, scheme 2
 *                                is preferred.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, assetRoot, writeJson } from './asset-paths.ts';
import type { GeoLevel } from './goldbox-geo.ts';

export interface WallTextureEntry {
  id: number;
  wallNumber: number;
  /** Name relative to the asset root, no extension, e.g. `textures/walldef2-1-wall0-view6`. */
  name: string;
}

const WALL_PNG_RE = /^(walldef2?)-(\d+)-wall(\d+)-view6\.png$/;

export function scanWallTextures(game: string, platform: string): WallTextureEntry[] {
  const textureDir = assetDir('textures', game, platform);
  const byKey = new Map<string, WallTextureEntry & { scheme: number }>();
  for (const f of readdirSync(textureDir)) {
    const m = WALL_PNG_RE.exec(f);
    if (!m) continue;
    const scheme = m[1] === 'walldef2' ? 2 : 1;
    const id = Number(m[2]);
    const wallNumber = Number(m[3]);
    const key = `${id}:${wallNumber}`;
    const existing = byKey.get(key);
    if (existing && existing.scheme >= scheme) continue; // prefer scheme 2 over scheme 1
    byKey.set(key, { id, wallNumber, name: `textures/${f.replace(/\.png$/, '')}`, scheme });
  }
  return [...byKey.values()]
    .sort((a, b) => a.id - b.id || a.wallNumber - b.wallNumber)
    .map(({ id, wallNumber, name }) => ({ id, wallNumber, name }));
}

/** Write `dungeon/level-<id>.json`, `dungeon/levels-index.json`, and `dungeon/wall-index.json`. */
export function exportGeoDungeon(game: string, platform: string, levels: GeoLevel[]): void {
  // 'dungeon' isn't one of the shared `AssetCategory` values (palettes/
  // sprites/screens/textures/audio/data), so it's created directly here
  // rather than via `assetDir`.
  const dir = resolve(assetRoot(game, platform), 'dungeon');
  mkdirSync(dir, { recursive: true });

  const sorted = [...levels].sort((a, b) => a.id - b.id);
  const index: Array<{ id: number; file: string }> = [];
  for (const level of sorted) {
    const file = `dungeon/level-${level.id}.json`;
    writeJson(resolve(dir, `level-${level.id}.json`), level);
    index.push({ id: level.id, file });
  }
  writeJson(resolve(dir, 'levels-index.json'), { levels: index });

  const walls = scanWallTextures(game, platform);
  writeJson(resolve(dir, 'wall-index.json'), { walls });

  console.log(
    `dungeon: ${sorted.length} GEO level(s) decoded, ${walls.length} wall texture(s) indexed -> public/assets/${game}/${platform}/dungeon/`,
  );
}

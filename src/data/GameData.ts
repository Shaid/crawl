/**
 * Type definitions for preprocessed runtime assets.
 *
 * Mirrors the atlas + manifest shapes written by the offline pipeline
 * (tools/shared/game-config.ts, scripts/bclib/paths.py) and already consumed
 * by tools/viewer/shared.ts. One definition, shared by the asset viewer and
 * the game runtime, since both read the same public/assets/ output.
 */

export interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasMeta {
  frames: AtlasFrame[];
  width: number;
  height: number;
}

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

export interface PaletteData {
  colors: PaletteColor[];
}

/** One row of public/assets/<game>/<platform>/manifest.json. */
export interface ManifestEntry {
  /** Asset key, e.g. "sprites/portraits" — resolves to `${name}.png` + `${name}.json`. */
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
}

export interface GameAssets {
  manifest: ManifestEntry[];
}

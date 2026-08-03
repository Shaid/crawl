import type { AtlasFrame, AtlasMeta } from '@seer/core';

export type { AtlasFrame, AtlasMeta };

export interface PaletteData {
  colors: { r: number; g: number; b: number }[];
}

export interface AssetEntry {
  name: string;
  hasPng: boolean;
  hasPalette: boolean;
  spriteCount: number;
}

export interface AssetGroup {
  name: string;
  frames: string[];
}

export interface GroupsFile {
  source?: string;
  frameLabels?: Record<string, string>;
  groups: AssetGroup[];
}

export function rgbaFromPalette(palette: PaletteData | null, index: number): [number, number, number, number] {
  if (!palette) return [128, 128, 128, 255];
  const c = palette.colors[index];
  if (!c) return [0, 0, 0, 0];
  return [c.r, c.g, c.b, index === 0 ? 0 : 255];
}

export function setHidden(el: HTMLElement, hidden: boolean) {
  el.classList.toggle('hidden', hidden);
}

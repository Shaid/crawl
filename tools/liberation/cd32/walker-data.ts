/**
 * Liberation (CD32): decode the exported walker JSON (export-walker.ts) into
 * view-model structures. Browser-safe (atob only).
 */
import type { EngineTables, Sprite, CityZone } from './view-model.ts';

export interface EngineJson extends Omit<EngineTables, 'textures'> { textures: string[]; backdrop: string }
export interface ZoneMeta { id: number; world: number; zone: number; wall: number; start: CityZone['start']; label: string }
export interface ZoneJson { planes: string; palette: Array<[number, number, number]> }
export interface WallSpriteJson { wb: number; h: number; planes: string; mask: string }

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
export function decodeEngine(j: EngineJson): { tables: EngineTables; backdrop: Uint8Array } {
  const { backdrop, textures, ...rest } = j;
  return { tables: { ...rest, textures: textures.map(fromB64) }, backdrop: fromB64(backdrop) };
}
export function decodeWall(j: WallSpriteJson[]): Sprite[] {
  return j.map((s) => {
    const p = fromB64(s.planes), ps = s.wb * s.h;
    return { wb: s.wb, h: s.h, planes: [0, 1, 2, 3].map((k) => p.subarray(k * ps, (k + 1) * ps)), mask: fromB64(s.mask) };
  });
}
export function decodeZone(meta: ZoneMeta, j: ZoneJson): CityZone {
  return { world: meta.world, zone: meta.zone, planes: fromB64(j.planes), start: meta.start };
}

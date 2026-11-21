/**
 * Hired Guns (Amiga) walker asset decoding — browser-safe. Turns the JSON written by
 * export-walker.ts back into typed structures (base64 -> bytes -> parsed banks).
 */
import { parseGfxBank, type GfxBank } from './gfxbank.ts';
import { CELLS } from './map.ts';
import type { HgDoor } from './model.ts';
import type { HgViewTables } from './view.ts';
export interface HgIndexEntry {
  num: number; title: string; style: number; layers: number[];
  start: { x: number; y: number; z: number; facing: number };
}

export interface HgMapAsset {
  num: number; title: string; name: string; style: number; sky: number;
  players: Array<{ x: number; y: number; z: number }>;
  doors: HgDoor[];
  cells: string; sky4: string;
}

export interface HgLoadedMap {
  num: number; title: string; name: string; style: number;
  players: Array<{ x: number; y: number; z: number }>;
  doors: HgDoor[];
  cells: Uint32Array;
  sky4: Uint8Array;
}

export function fromBase64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function decodeMapAsset(a: HgMapAsset): HgLoadedMap {
  const raw = fromBase64(a.cells);
  if (raw.length !== CELLS * 4) throw new Error(`hiredguns map ${a.num}: ${raw.length} cell bytes`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const cells = new Uint32Array(CELLS);
  for (let i = 0; i < CELLS; i++) cells[i] = dv.getUint32(4 * i);
  return { num: a.num, title: a.title, name: a.name, style: a.style, players: a.players, doors: a.doors.map((d) => ({ ...d })), cells, sky4: fromBase64(a.sky4) };
}

export function decodeBankAsset(a: { data: string }): GfxBank {
  return parseGfxBank(fromBase64(a.data));
}

export type { HgViewTables };

/** Display label of a map. */
export function mapLabel(m: { num: number; title: string; name?: string }): string {
  const t = m.title || (m.name ?? '').replace(/[.]+$/, '').slice(0, 36);
  return `Map ${String(m.num).padStart(2, '0')}${t ? ` ${t}` : ''}`;
}

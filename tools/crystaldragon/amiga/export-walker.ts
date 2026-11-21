/**
 * Crystal Dragon (Amiga): walker data. Emits to public/assets/crystaldragon/amiga/walker/:
 *   palette.json      dungeon view palette, 32 words at A5+500 (A5 = hunk 0 +0x229E4; loaded into
 *                     COLOR00-31 by +0x1378 `LAB_00CF` / faded to by +0x111C in the dungeon code)
 *   levels.json       23 levels: areas (region table, effective cell word0), slots 0-11 -> set ids
 *   sets/<id>.json    the composed frames of each used `.SCR` set plus its slot table (file id+1)
 *   npx tsx tools/crystaldragon/amiga/export-walker.ts
 * Decoded intermediates (SF level maps, SA sets) go to build/cache/crystaldragon/.
 * Spec: docs/crystaldragon/amiga/data-structure.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { unSF, unSA } from './codec.ts';
import { composeSet, parseSlotTable } from './sets.ts';
import { canEnter, type CdArea } from './view-model.ts';

const GAME = 'crystaldragon';
const PLATFORM = 'amiga';
export const HUNK0 = 0x24; // file offset of hunk 0 data in Crystal_Dragon
export const A5_BASE = 0x229e4; // LEA LAB_17C0,A5 at +0x2E30
export const PALETTE_A5 = 500;
export const NAME_LIST = 0x25176; // lowercase .scr names; id = 0x1C + 2*index (+0x41D0..+0x41F8)
export const LEVEL_GRID_BASE = 0x313e;
export const LEVEL_COUNT = 23;
/** slot table position counts by slot class (loader size check +0x42AC) */
export const SLOT_NPOS = (slot: number) => (slot < 4 ? 39 : 12);

export const dataDir = () => resolve('data', GAME, PLATFORM, 'data');
export const fileName = (id: number) => (id >= 0x100 ? '1' : '') + (id & 0xff).toString(16).padStart(2, '0');
export const levelFileId = (level: number) => level * 9 + 0xcc;

const be16 = (d: Uint8Array, o: number) => (d[o]! << 8) | d[o + 1]!;

export function readExe(): Uint8Array {
  return new Uint8Array(readFileSync(resolve(dataDir(), 'Crystal_Dragon'))).subarray(HUNK0);
}

export function readPalette(hunk0: Uint8Array): number[] {
  return Array.from({ length: 32 }, (_, i) => be16(hunk0, A5_BASE + PALETTE_A5 + 2 * i));
}

/** .scr name (lowercase) -> file id, from the executable's ordered name list. */
export function readNameIds(hunk0: Uint8Array): Map<string, number> {
  const m = new Map<string, number>();
  let p = NAME_LIST;
  for (let id = 0x1c; id < 0x88; id += 2) {
    let e = p;
    while (hunk0[e] !== 0) e++;
    m.set(Buffer.from(hunk0.subarray(p, e)).toString('latin1').toLowerCase(), id);
    p = e + 1;
  }
  return m;
}

export function slotNames(level: Uint8Array): string[] {
  return Array.from({ length: 27 }, (_, k) => {
    const s = level.subarray(32 * k, 32 * k + 32);
    const e = s.indexOf(0);
    return Buffer.from(s.subarray(0, e < 0 ? 32 : e)).toString('latin1').toLowerCase();
  });
}

/** Region table read backward from +0x313E (+0xC1C6), each cell's word0 after following the
 *  word0&7==5 redirect (word1 = signed offset from the grid base, +0x146FE). */
export function readAreas(level: Uint8Array): CdArea[] {
  const dv = new DataView(level.buffer, level.byteOffset, level.byteLength);
  const n = dv.getUint16(LEVEL_GRID_BASE) + 1;
  const out: CdArea[] = [];
  for (let k = 1; k <= n; k++) {
    const o = LEVEL_GRID_BASE - 12 * k;
    const off = dv.getUint16(o), h = dv.getUint16(o + 2), w = dv.getUint16(o + 4);
    const y0 = dv.getInt16(o + 6), x0 = dv.getInt16(o + 8), id = dv.getUint16(o + 10);
    if (!w || !h) continue;
    const cells: number[] = [];
    for (let i = 0; i < w * h; i++) {
      const a = LEVEL_GRID_BASE + off + 8 * i;
      let w0 = dv.getUint16(a);
      if ((w0 & 7) === 5 && w0 !== 5) w0 = dv.getUint16(LEVEL_GRID_BASE + dv.getInt16(a + 2));
      cells.push(w0);
    }
    out.push({ id, x0, y0, w, h, cells });
  }
  return out;
}

/** Start pose (hypothesis): first open cell, from the bottom row up, facing an open cell. */
export function defaultStart(a: CdArea): { x: number; y: number; facing: number } {
  const F = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  let fallback: { x: number; y: number; facing: number } | null = null;
  for (let cy = 0; cy < a.h; cy++) for (let cx = 0; cx < a.w; cx++) {
    const x = a.x0 + cx, y = a.y0 + cy;
    if (!canEnter(a, x, y)) continue;
    for (let f = 0; f < 4; f++) if (canEnter(a, x + F[f]![0]!, y + F[f]![1]!)) return { x, y, facing: f };
    fallback ??= { x, y, facing: 0 };
  }
  return fallback ?? { x: a.x0, y: a.y0, facing: 0 };
}

const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64');

export function exportWalker(): { levels: number; areas: number; sets: number } {
  const hunk0 = readExe();
  const names = readNameIds(hunk0);
  const root = resolve(assetRoot(GAME, PLATFORM), 'walker');
  const cache = resolve('build/cache', GAME);
  mkdirSync(resolve(root, 'sets'), { recursive: true });
  mkdirSync(resolve(cache, 'sets'), { recursive: true });
  writeJson(resolve(root, 'palette.json'), { source: 'Crystal_Dragon hunk 0 +0x229E4 (A5) +500', words: readPalette(hunk0) }, false);

  const usedSets = new Map<number, { name: string; npos: number }>();
  const levels: unknown[] = [];
  let areaCount = 0;
  for (let L = 0; L < LEVEL_COUNT; L++) {
    const fid = levelFileId(L);
    const lv = unSF(new Uint8Array(readFileSync(resolve(dataDir(), fileName(fid)))));
    writeFileSync(resolve(cache, `level${String(L).padStart(2, '0')}_${fileName(fid)}.bin`), lv);
    const sn = slotNames(lv);
    const slots = sn.slice(0, 12).map((name, k) => {
      if (!name) return null;
      const id = names.get(name);
      if (id === undefined) throw new Error(`level ${L} slot ${k}: unknown set ${name}`);
      const prev = usedSets.get(id);
      if (prev && prev.npos !== SLOT_NPOS(k)) throw new Error(`set ${name} used with two slot classes`);
      usedSets.set(id, { name, npos: SLOT_NPOS(k) });
      // a name repeated from an earlier slot of the level is drawn with the plane remap (+0x4186)
      return { set: id, remap: sn.slice(0, k).includes(name) };
    });
    const areas = readAreas(lv);
    areaCount += areas.length;
    levels.push({
      level: L, file: fileName(fid), slotNames: sn,
      slots,
      areas: areas.map((a) => ({ id: a.id, x0: a.x0, y0: a.y0, w: a.w, h: a.h, cells: b64(new Uint8Array(new Uint16Array(a.cells).buffer)), start: defaultStart(a) })),
    });
  }
  writeJson(resolve(root, 'levels.json'), levels, false);

  for (const [id, { name, npos }] of usedSets) {
    const raw = new Uint8Array(readFileSync(resolve(dataDir(), fileName(id))));
    const set = unSA(raw);
    writeFileSync(resolve(cache, 'sets', `${fileName(id)}.bin`), set);
    const frames = composeSet(set);
    const tablePath = resolve(dataDir(), fileName(id + 1));
    if (!existsSync(tablePath)) throw new Error(`missing slot table ${fileName(id + 1)}`);
    const table = parseSlotTable(new Uint8Array(readFileSync(tablePath)), npos);
    writeJson(resolve(root, 'sets', `${fileName(id)}.json`), {
      id, name, table,
      frames: frames.map((f) => ({ w: f.w, h: f.h, stride: f.stride, px: b64(f.px) })),
    }, false);
  }
  return { levels: levels.length, areas: areaCount, sets: usedSets.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(exportWalker());
}

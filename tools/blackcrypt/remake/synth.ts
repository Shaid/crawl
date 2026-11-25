/** Synthetic `BcMap`s for tests (no retail data): rooms, doors, traps, monsters and items written as the 20-byte on-disk records the loader consumes. Test support, not a test file. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BcMap, EntityNode } from './bcdfs';
import type { BcRulesData, BcWorld } from './engine';

const here = dirname(fileURLToPath(import.meta.url));
export const V = JSON.parse(readFileSync(resolve(here, '../rules_oracle/vectors.json'), 'utf8'));
export const rules: BcRulesData = { tables: V.tables, weaponBase: V.weaponBase, scripts: V.aiScripts };

const rec = (f: { w0?: number; b5?: number; b7?: number; w8?: number; wA?: number; wC?: number; wE?: number; w10?: number; b0d?: number }) => {
  const r = new Uint8Array(20);
  const sw = (o: number, v: number) => { r[o] = v >> 8; r[o + 1] = v & 0xff; };
  sw(0, f.w0 ?? 1); r[5] = f.b5 ?? 0; r[7] = f.b7 ?? 0; sw(8, f.w8 ?? 0); sw(0xa, f.wA ?? 0); sw(0xc, f.wC ?? 0); sw(0xe, f.wE ?? 0); sw(0x10, f.w10 ?? 0); r[0xd] = f.b0d ?? r[0xd];
  return r;
};
export const node = (r: Uint8Array, extra: Partial<EntityNode> = {}): EntityNode => ({ rec: r, children: [], actions: [], ...extra });
export const item = (gfx: number, o: { weight?: number; extra?: number; wE?: number; b7?: number } = {}) => node(rec({ w0: gfx, b5: 0x15, w8: o.weight ?? 0, wC: o.extra ?? 0, wE: o.wE, b7: o.b7 }));
/** stairs to another map: arrive at (dx, dy) of map `map` (type 0x12, +0x10 = 3, byte +7 = destination map) */
export const stairs = (map: number, dx: number, dy: number) => node(rec({ w0: 1, b5: 0x12, b7: map, wA: 0, wC: dx, wE: dy, w10: 3 }));
export const door = (state = 0) => node(rec({ w0: 1, b5: 0x11, wE: state }));
/** a trap square whose single action burns the party (executor op 0x1C, `v` = fire strength) */
export const fireTrap = (x: number, y: number, v = 2) => {
  const act = new Uint8Array([0x1c, 1, x, y, 255, 0, v, 0]);
  return node(rec({ w0: 1, b5: 0x1e, wA: 0, wE: 1, b0d: 1 }), { actions: [{ id: 1, bytes: act }] });
};
/** a melee monster (the on-disk pair: primary + secondary) */
export function monster(o: { hp: number; xp?: number; gfx?: number; loot?: EntityNode[]; b2?: number; b3?: number; b5?: number; b6?: number } = { hp: 10 }): EntityNode {
  const p = new Uint8Array(20), s = new Uint8Array(20);
  const sw = (r: Uint8Array, k: number, v: number) => { r[k] = v >> 8; r[k + 1] = v & 0xff; };
  sw(p, 0, o.gfx ?? 0x80b3); p[2] = o.b2 ?? 10; p[3] = o.b3 ?? 0x04; p[5] = o.b5 ?? 5; p[6] = o.b6 ?? 2; sw(p, 8, o.hp); if (o.loot?.length) sw(p, 0xa, 1);
  sw(s, 4, 1); sw(s, 6, o.xp ?? 50); sw(s, 8, o.hp); s[0xb] = 4; s[0xd] = 4; s[0xe] = 255;
  const n = node(p, { second: s, children: o.loot ?? [] });
  o.loot?.forEach((c, i) => { if (i + 1 < o.loot!.length) c.rec[0x12] = 0, c.rec[0x13] = 1; });
  return n;
}
export class MapBuilder {
  cells = new Uint32Array(4096); present = new Uint8Array(4096); chains = new Map<number, EntityNode[]>();
  /** walls around a rectangle (bit 12 + d = wall on side d: 0 +y, 1 +x, 2 -y, 3 -x) */
  room(x0: number, y0: number, x1: number, y1: number) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      let w = 0; if (y === y1) w |= 1; if (x === x1) w |= 2; if (y === y0) w |= 4; if (x === x0) w |= 8;
      const i = y * 64 + x; this.present[i] = 1; this.cells[i] = (this.cells[i] | (w << 12)) >>> 0;
    }
    return this;
  }
  breakWall(x: number, y: number, d: number) {
    const D = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const i = y * 64 + x, j = (y + D[d][1]) * 64 + x + D[d][0];
    this.cells[i] = (this.cells[i] & ~(0x1000 << d)) >>> 0; this.cells[j] = (this.cells[j] & ~(0x1000 << ((d + 2) & 3))) >>> 0; this.present[j] = 1;
    return this;
  }
  put(x: number, y: number, ...nodes: EntityNode[]) {
    const i = y * 64 + x; this.present[i] = 1;
    const chain = this.chains.get(i) ?? []; chain.push(...nodes); this.chains.set(i, chain);
    chain.forEach((n, k) => { n.rec[0x12] = 0; n.rec[0x13] = k + 1 < chain.length ? 1 : 0; });
    this.cells[i] = ((this.cells[i] & ~0xfff) | 1) >>> 0;
    return this;
  }
  build(index = 1): BcMap { return { index, cells: this.cells, present: this.present, chains: this.chains }; }
}
export const world = (maps: BcMap[]): BcWorld => ({ rules, maps, kit: null });

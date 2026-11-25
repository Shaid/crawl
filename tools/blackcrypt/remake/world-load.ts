/**
 * Puts a parsed `bcdfs` map into a BcSim's A4 image the way the game's loader does (S_1 +0x188D0): the square longwords land verbatim in the 64 x 64 cell array, every 20-byte
 * record is copied verbatim into the object table, a monster is a primary + a secondary record (primary word +0x10 = secondary id), chains are the records' word +0x12, monster
 * loot hangs off word +0x0A and container contents off +0x0C, action records go to the action table at A4+0x836 by their chain id.
 * Hyp: the game allocates runtime ids from its free list; here ids are handed out sequentially from the first free one, skipping `reserved` (carried items). Only the
 * identity of ids differs; every rule reads the records, not the numbers.
 */
import type { BcSim } from '../bc-sim';
import { OBJ, CELL } from '../rules-spell9';
import { isMonster, type BcMap, type EntityNode } from './bcdfs';

const MAX_ID = 691;   // (-0x37CA - -0x6E7A) / 0x14 = 692 objects
const FREE_HEAD = -0x6e68;

export function loadMapInto(sim: BcSim, map: BcMap, reserved: Set<number>, firstId = 21): { objects: number; top: number } {
  const a = sim.a;
  let next = firstId, used = 0;
  const alloc = () => { while (reserved.has(next)) next++; if (next > MAX_ID) throw new Error(`map ${map.index}: object table full`); used++; return next++; };
  const put = (id: number, rec: Uint8Array) => { for (let i = 0; i < 20; i++) a.setB(OBJ(id) + i, rec[i]); };
  const place = (n: EntityNode, id: number): void => {
    put(id, n.rec);
    if (isMonster(n.rec)) { const s = alloc(); put(s, n.second!); a.setW(OBJ(id) + 0x10, s); sim.monsterIds.push(id); }
    if (n.children.length) {
      const ids = n.children.map(() => alloc());
      a.setW(OBJ(id) + (isMonster(n.rec) ? 0x0a : 0x0c), ids[0]);
      n.children.forEach((c, i) => { place(c, ids[i]); a.setW(OBJ(ids[i]) + 0x12, ids[i + 1] ?? 0); });
    }
    for (const act of n.actions) for (let i = 0; i < 8; i++) a.setB(0x836 + 8 * act.id + i, act.bytes[i]);
  };
  for (let i = 0; i < 4096; i++) {
    if (!map.present[i]) continue;
    const x = i & 63, y = i >> 6;
    let v = map.cells[i];
    const chain = map.chains.get(i);
    if (chain) {
      const ids = chain.map(() => alloc());
      chain.forEach((n, k) => { place(n, ids[k]); a.setW(OBJ(ids[k]) + 0x12, ids[k + 1] ?? 0); });
      v = ((v & ~0xfff) | ids[0]) >>> 0;
    }
    a.setW(CELL(x, y), v >>> 16); a.setW(CELL(x, y) + 2, v & 0xffff);
  }
  // the rest of the object table is the free list, in id order
  const free: number[] = [];
  for (let id = 1; id <= MAX_ID; id++) if (id >= firstId && id >= next && !reserved.has(id)) free.push(id);
  a.setW(FREE_HEAD, free[0] ?? 0);
  free.forEach((id, k) => a.setW(OBJ(id) + 0x12, free[k + 1] ?? 0));
  return { objects: used, top: next };
}

/**
 * `bcdfs` map reader for the remake: all 13 maps, original TypeScript following the loader description in docs/blackcrypt/amiga/data-structure.md
 * ("bcdfs - Map / Dungeon Format", S_1 +0x188D0..+0x18CFE) and the verified Python walker scripts/bclib/bcdfs.py. Pure: bytes in, structure out.
 */
const REC = 20;
/** structure types whose record is followed by an action chain */
const ACTION_TYPES = new Set([0x0f, 0x16, 0x1d, 0x1e, 0x1f, 0x21]);
const CONTAINER_TYPES = new Set([0x13, 0x23]);
const MAP_COUNT = 13, OFFSET_TABLE = 52;

export interface EntityNode {
  rec: Uint8Array;                 // 20 bytes, verbatim
  second?: Uint8Array;             // a monster's stat-continuation record (20 bytes, verbatim)
  children: EntityNode[];          // monster loot / container contents, chain order
  actions: { id: number; bytes: Uint8Array }[];   // 8-byte action records (id = chain id on disk)
}
export interface BcMap {
  index: number;                   // 1..13
  /** 64 x 64 square longwords (y * 64 + x), 0 = no square written */
  cells: Uint32Array;
  present: Uint8Array;
  /** top-level same-square chain per cell */
  chains: Map<number, EntityNode[]>;
}
export const isMonster = (rec: Uint8Array) => (rec[0] & 0x80) !== 0;
const w = (r: Uint8Array, o: number) => (r[o] << 8) | r[o + 1];
const s8 = (v: number) => (v << 24) >> 24;

export function parseBcdfs(raw: Uint8Array): BcMap[] {
  const offsets = Array.from({ length: MAP_COUNT }, (_, i) => ((raw[4 * i] << 24) | (raw[4 * i + 1] << 16) | (raw[4 * i + 2] << 8) | raw[4 * i + 3]) >>> 0);
  const maps: BcMap[] = [];
  for (let m = 0; m < MAP_COUNT; m++) {
    let pos = offsets[m] + OFFSET_TABLE;
    const take = (n: number) => { if (pos + n > raw.length) throw new Error(`bcdfs: ran off the end at 0x${pos.toString(16)}`); const b = raw.subarray(pos, pos + n); pos += n; return b; };
    take(4);
    const lastRow = s8(take(1)[0]);
    const map: BcMap = { index: m + 1, cells: new Uint32Array(4096), present: new Uint8Array(4096), chains: new Map() };
    const entity = (): EntityNode => {
      const rec = take(REC), n: EntityNode = { rec, children: [], actions: [] };
      if (isMonster(rec)) { n.second = take(REC); if (n.second[0x13] !== 0) take(4); }
      return n;
    };
    const subChain = (parent: EntityNode, monster: boolean) => {
      if (w(parent.rec, monster ? 0x0a : 0x0c) === 0) return;
      for (;;) {
        const c = entity();
        parent.children.push(c);
        if (CONTAINER_TYPES.has(c.rec[5]) || isMonster(c.rec)) subChain(c, isMonster(c.rec));
        if (w(c.rec, 0x12) === 0) break;
      }
    };
    for (let row = 0; row <= lastRow; row++) {
      const first = s8(take(1)[0]), last = s8(take(1)[0]);
      for (let col = first; col <= last; col++) {
        const sq = take(4);
        if ((sq[0] & 0x0f) !== 0x0f || (sq[1] & 0xf0) !== 0xf0) throw new Error(`bcdfs map ${m + 1}: not a square at row ${row} col ${col}`);
        const v = ((sq[0] << 24) | (sq[1] << 16) | (sq[2] << 8) | sq[3]) >>> 0;
        if (col < 0 || col > 63 || row > 63) throw new Error(`bcdfs map ${m + 1}: square outside the 64x64 array (${col}, ${row})`);
        const i = row * 64 + col;
        map.cells[i] = v; map.present[i] = 1;
        if ((v & 0xfff) === 0) continue;
        const chain: EntityNode[] = [];
        for (;;) {
          const n = entity();
          chain.push(n);
          if (CONTAINER_TYPES.has(n.rec[5]) || isMonster(n.rec)) subChain(n, isMonster(n.rec));
          else if (ACTION_TYPES.has(n.rec[5])) {
            let id = n.rec[0x0d]; const first = id;
            while (id !== 0) { const b = take(8); n.actions.push({ id, bytes: b }); id = b[7]; if (id === first) break; }
          }
          if (w(n.rec, 0x12) === 0) break;
        }
        map.chains.set(i, chain);
      }
    }
    maps.push(map);
  }
  return maps;
}

/** A floor square with an open square ahead (a corridor view): the data-derived entrance used when nothing names the party's start. Same rule as the walker's `bcEntrancePose`. */
export function entrancePose(map: BcMap): { x: number; y: number; facing: number } {
  const floor = (i: number) => map.present[i] === 1 && ((map.cells[i] >>> 28) & 1) === 0;
  const D: [number, number, number][] = [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!floor(y * 64 + x)) continue;
    for (const [dx, dy, f] of D) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < 64 && ny < 64 && floor(ny * 64 + nx)) return { x, y, facing: f }; }
  }
  return { x: 0, y: 0, facing: 0 };
}

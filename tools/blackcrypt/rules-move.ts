/**
 * Black Crypt (Amiga) monster movement rules: original TypeScript port of
 * routines in decompressed bcdft S_1 (offsets below), each diffed against the
 * game's own 68k code run in musashi (tools/blackcrypt/rules_oracle/oracle_move.c,
 * vectors_move.json, tests rules-move.test.ts).
 *
 *   +0x8532 enterTest   square-enter test (0 free, 1 blocked, 2 open-door)       harness
 *   +0x8458 wallMask    monsters occupying a square (bit n = position n)         harness
 *   +0x866C pathfind    breadth-first search monster -> party, depth-limited     harness
 *   +0x8D7E adjacent    one-step candidate directions (no search)                harness
 *   +0x937A pickDirection  choose the desired facing among the candidates        harness
 *   +0x9116 moveMonster turn / in-square shift / leave-square step               harness
 *   +0x0074 / +0x00FE addToSquare / removeFromSquare (object chain)              harness
 *   +0x02B4 step        direction 0..3 = y+1, x+1, y-1, x-1                      harness
 */
import { BcRng } from './rules';
import { pickTargets } from './rules-monster';

/** Pure world state for the movement routines. Cells are the 32-bit map longwords
 *  (low 12 bits = id of the first object on the square, bits 12..15 = wall in direction d,
 *  bit 31 = hazard); objects are the 0x14-byte records (A4-0x6E7A + 0x14*id), big-endian. */
export class MoveWorld {
  cells = new Map<number, number>();
  objs = new Map<number, Uint8Array>();
  party = { x: 0, y: 0 };
  /** A4+0x1E91: path length left by the last pathfinder / adjacency run (stale when the pathfinder found nothing) */
  lastDist = 0;
  log: MoveCall[] = [];
  cell(x: number, y: number): number { return this.cells.get(y * 256 + x) ?? 0; }
  setCell(x: number, y: number, v: number) { this.cells.set(y * 256 + x, v >>> 0); }
  private o(id: number): Uint8Array {
    let r = this.objs.get(id);
    if (!r) { r = new Uint8Array(0x14); this.objs.set(id, r); }
    return r;
  }
  w(id: number, off: number): number { const r = this.o(id); return (r[off] << 8) | r[off + 1]; }
  b(id: number, off: number): number { return this.o(id)[off]; }
  setW(id: number, off: number, v: number) { const r = this.o(id); r[off] = (v >> 8) & 0xff; r[off + 1] = v & 0xff; }
  setB(id: number, off: number, v: number) { this.o(id)[off] = v & 0xff; }
}

/** Calls the real routine makes that the harness hooks (and the port only logs). */
export type MoveCall =
  | { fn: 'openDoor'; x: number; y: number }
  | { fn: 'damage'; ch: number; dmg: number; kind: number; flag: number }
  | { fn: 'sched' }
  | { fn: 'hold'; n: number }
  | { fn: 'special'; bit: number }
  | { fn: 'ev'; type: number; due: number; x: number; y: number; id: number };

/** +0x2B4: 0 -> y+1, 1 -> x+1, 2 -> y-1, 3 -> x-1 (other values leave the square unchanged). */
export function step(x: number, y: number, dir: number): [number, number] {
  switch (dir) { case 0: return [x, y + 1]; case 1: return [x + 1, y]; case 2: return [x, y - 1]; case 3: return [x - 1, y]; default: return [x, y]; }
}

const wallBit = (cell: number, d: number) => (cell & (0x1000 << d)) !== 0;

/** +0x8532. mode 0 / 1 = plain tests (the pathfinder uses 1 for the first ring, 0 beyond),
 *  mode 2 = the real move (a closed door the monster may open returns 2 = open it).
 *  Objects on the square are walked head to tail by structure type (object byte +5). */
export function enterTest(w: MoveWorld, x: number, y: number, b3: number, b6: number, mode: number): number {
  let d2 = 0;
  let id = w.cell(x, y) & 0xfff;
  while (id !== 0 && d2 === 0) {
    if ((w.w(id, 0) & 0x7fff) !== 0) {
      switch (w.b(id, 5)) {
        case 0x10: if (w.w(id, 0xa) === 0) d2 = 1; break; // illusion wall: blocks while solid
        case 0x11: // door frame
          if (!(b3 & 0x10)) d2 = 1;
          if (w.w(id, 0xe) === 2) d2 = 1; // locked
          if (mode === 1 && !(w.b(id, 0xf) & 1) && !(b6 & 1)) d2 = 1;
          if (mode === 2 && (b6 & 1) && w.w(id, 0xe) === 0) d2 = 2;
          break;
        case 0x12: if (((w.w(id, 0x10) << 16) >> 16) <= 3 && w.w(id, 0xa) === 0) d2 = 1; break;
        case 0x14: // pit: floor pit (+0x10 == 0) blocks all, ceiling pit (== 1) blocks flyers (b3 bit 7)
          if (w.w(id, 0xa) === 0) {
            if (w.w(id, 0x10) === 0) d2 = 1;
            if (w.w(id, 0x10) === 1 && (b3 & 0x80) === 0x80) d2 = 1;
          }
          break;
        case 0x17: if (w.w(id, 0xa) === 0) d2 = 1; break; // pillar
        case 0x1f: d2 = 1; break; // fountain / panel
        case 0x2f: d2 = 1; break; // statue
        default: break;
      }
    }
    id = w.w(id, 0x12);
  }
  return d2;
}

/** +0x8458: bit n set when a monster object stands at position n (0-3 corners, 4 centre) of the square;
 *  the whole mask (0x1f) when a monster of a different gfx word, or one in the centre, is there. */
export function wallMask(w: MoveWorld, x: number, y: number, gfx: number): number {
  let m = 0;
  let id = w.cell(x, y) & 0xfff;
  while (id !== 0) {
    if (w.b(id, 0) & 0x80) {
      const s = w.w(id, 0x10);
      m = (m | (1 << w.b(s, 0xb))) & 0xff;
      if (w.w(id, 0) !== gfx || w.b(s, 0xb) === 4) m = 0x1f;
    }
    id = w.w(id, 0x12);
  }
  return m;
}

export interface PathResult {
  /** A4+0x1E8F: 1 = adjacent and direct, 2 = path found (or adjacent with an in-square shift), 3 = none */
  result: number;
  /** A4+0x1E90 direction bit mask (bit d = first step direction d) */
  dirMask: number;
  /** A4+0x1E91 path length in squares (only set when result != 3) */
  dist: number;
  /** A4+0x1E8A.. candidate directions in ascending order (only filled when result != 3) */
  list: number[];
}

const finish = (r: PathResult): PathResult => {
  if (r.result !== 3) for (let d = 0; d < 4; d++) if (r.dirMask & (1 << d)) r.list.push(d);
  return r;
};

/** +0x866C. Search depth limit = 3 * (speedIdx + 1) squares, speedIdx = b3 bits 2-3. */
export function pathfind(w: MoveWorld, mon: number, x: number, y: number, px: number, py: number): PathResult {
  const S = w.w(mon, 0x10), b3 = w.b(mon, 3), b6 = w.b(mon, 6), pos = w.b(S, 0xb), gfx = w.w(mon, 0);
  const limit = 3 * (((b3 & 0xc) >> 2) + 1);
  const r: PathResult = { result: 3, dirMask: 0, dist: 0, list: [] };
  const visited = new Uint8Array(0x4000);
  const vi = (xx: number, yy: number) => ((yy << 6) + xx) & 0x3fff; // buffer of 64x64; indices beyond wrap only on out-of-range squares
  type Q = { x: number; y: number; m: number };
  const qs: Q[][] = [[], []];
  let cur = 1, oth = 0, cnt = 0, a2 = 1;
  visited[vi(x, y)] = 1;
  for (let d2 = 0; d2 <= 3; d2++) {
    if (wallBit(w.cell(x, y), d2)) continue;
    let fl13 = 0, fl15 = 0, mask4 = 0, side = 0;
    if (pos !== 4 && pos !== d2 && ((pos + 3) & 3) !== d2) {
      mask4 = wallMask(w, x, y, gfx);
      side = ((pos + 1) & 3) === d2 ? (pos + 1) & 3 : (pos + 3) & 3;
      if (mask4 & (1 << side)) fl13 = 1;
      fl15 = 1;
    }
    const [nx, ny] = step(x, y, d2);
    let reached = false;
    if (nx === px && ny === py) {
      reached = true;
      if (fl13 !== 0) {
        if (fl15 !== 1) reached = false;
        else if (mask4 & (1 << ((side + 2) & 3))) reached = false;
        else if (fl13 !== 1) reached = false;
      }
    }
    if (reached) {
      if (fl15 === 1 && !(mask4 & (1 << ((side + 2) & 3))) && fl13 === 1) {
        r.dirMask |= ((pos + 1) & 3) === d2 ? 1 << ((d2 + 1) & 3) : 1 << ((d2 + 3) & 3);
      } else r.dirMask |= 1 << d2;
      r.dist = 1;
      r.result = fl15 === 0 ? 1 : 2;
      continue;
    }
    const e = enterTest(w, nx, ny, b3, b6, 1);
    const m2 = wallMask(w, nx, ny, gfx);
    if (pos !== 4) {
      if (pos === d2 || ((pos + 3) & 3) === d2) {
        const s2 = pos === d2 ? (pos + 3) & 3 : (pos + 1) & 3;
        if (m2 & (1 << s2)) fl13 = 1;
      }
    } else if (m2 !== 0) fl13 = 1;
    if (e === 0 && fl13 === 0) {
      visited[vi(nx, ny)] = a2;
      qs[cur].push({ x: nx, y: ny, m: 1 << d2 });
      cnt++;
    }
  }
  while (cnt !== 0 && a2 <= limit && r.result === 3) {
    cur = 1 - cur; oth = 1 - oth;
    const prev = cnt; qs[cur] = []; cnt = 0; a2++;
    for (let d5 = 0; d5 < prev; d5++) {
      const src = qs[oth][d5];
      for (let d2 = 0; d2 <= 3; d2++) {
        if (wallBit(w.cell(src.x, src.y), d2)) continue;
        const [nx, ny] = step(src.x, src.y, d2);
        if (nx === px && ny === py) { r.dirMask |= src.m; r.result = 2; r.dist = a2; continue; }
        if (enterTest(w, nx, ny, b3, b6, 0) !== 0) continue;
        const v = visited[vi(nx, ny)];
        if (v === a2) {
          for (let d7 = 0; d7 < cnt; d7++) if (qs[cur][d7].x === nx && qs[cur][d7].y === ny) { qs[cur][d7].m |= src.m; break; }
        } else if (v === 0) {
          visited[vi(nx, ny)] = a2;
          qs[cur].push({ x: nx, y: ny, m: src.m });
          cnt++;
        }
      }
    }
  }
  if (r.result !== 3) w.lastDist = r.dist;
  return finish(r);
}

/** +0x8D7E: the no-search version: which of the four directions the monster can take right now.
 *  result 2 when any direction is open, else 3; dist = manhattan distance to the party (byte). */
export function adjacent(w: MoveWorld, mon: number, x: number, y: number, px: number, py: number): PathResult {
  const S = w.w(mon, 0x10), b3 = w.b(mon, 3), b6 = w.b(mon, 6), pos = w.b(S, 0xb), gfx = w.w(mon, 0);
  const r: PathResult = { result: 3, dirMask: 0, dist: 0, list: [] };
  for (let d2 = 0; d2 <= 3; d2++) {
    let d6 = 0;
    if (pos !== 4 && pos !== d2 && ((pos + 3) & 3) !== d2) {
      const d4 = wallMask(w, x, y, gfx);
      const d5 = ((pos + 1) & 3) === d2 ? (pos + 1) & 3 : (pos + 3) & 3;
      if (d4 & (1 << d5)) d6 = 1;
      if (!d6) { r.result = 2; r.dirMask |= 1 << d2; }
      continue;
    }
    if (wallBit(w.cell(x, y), d2)) continue;
    const [nx, ny] = step(x, y, d2);
    if (nx === px && ny === py) continue;
    const a6 = enterTest(w, nx, ny, b3, b6, 1);
    const d4 = wallMask(w, nx, ny, gfx);
    if (pos !== 4) {
      if (pos === d2 || ((pos + 3) & 3) === d2) {
        const d5 = pos === d2 ? (pos + 3) & 3 : (pos + 1) & 3;
        if (d4 & (1 << d5)) d6 = 1;
      }
    } else if (d4 !== 0) d6 = 1;
    if (a6 === 0 && d6 === 0) { r.result = 2; r.dirMask |= 1 << d2; }
  }
  if (r.result !== 3) for (let d = 0; d < 4; d++) if (r.dirMask & (1 << d)) r.list.push(d);
  r.dist = (Math.abs(px - x) + Math.abs(py - y)) & 0xff;
  w.lastDist = r.dist;
  return r;
}

/** +0x937A: keep the current facing when it is among the candidates, else choose one at random
 *  (rand16(count)); the result is the monster's desired facing S.b0D. */
export function pickDirection(w: MoveWorld, sIdx: number, list: number[], rng: BcRng): number {
  let d2 = 4;
  for (const c of list) if (w.b(sIdx, 0xc) === c) d2 = c;
  if (d2 === 4) d2 = list[rng.rand16(list.length)] ?? 0;
  w.setB(sIdx, 0xd, d2);
  return d2;
}

/** +0x0074: new object goes to the head of the square's chain. */
export function addToSquare(w: MoveWorld, id: number, x: number, y: number) {
  const c = w.cell(x, y);
  w.setW(id, 0x12, c & 0xfff);
  w.setCell(x, y, ((c & 0xfffff000) + id) >>> 0);
}
/** +0x00FE: unlink from the chain (the object's own next field is left as it was). */
export function removeFromSquare(w: MoveWorld, id: number, x: number, y: number) {
  const c = w.cell(x, y);
  let d2 = c & 0xfff, prev = 0;
  while (d2 !== 0 && d2 !== id) { prev = d2; d2 = w.w(d2, 0x12); }
  const next = w.w(id, 0x12);
  if (d2 > 0 && prev === 0) w.setCell(x, y, (((c & 0xfffff000) >>> 0) + next) >>> 0);
  if (d2 > 0 && prev > 0) w.setW(prev, 0x12, next);
}

/**
 * +0x9116: one movement act for monster `mon` standing at pos.x/pos.y (updated in place).
 * Returns 1 when the act was a turn (nothing else happened), else 0.
 * S.b0D = desired facing (4 = none: nothing happens), S.b0C = facing. b3 bit 5 = turns one
 * quarter per act (costs the act), clear = turns instantly and moves in the same act.
 * Corner monsters (S.b0B 0..3) first shift within the square; centre (4) monsters step directly.
 */
export function moveMonster(w: MoveWorld, mon: number, pos: { x: number; y: number }, rng: BcRng): number {
  const S = w.w(mon, 0x10), b3 = w.b(mon, 3), b6 = w.b(mon, 6);
  const turnPath = (): number => {
    if (w.b(S, 0xc) === w.b(S, 0xd) || w.b(S, 0xd) === 4) return 0;
    const d5 = (w.b(S, 0xc) + 4 - w.b(S, 0xd)) & 3; // b3 bit 5 is set on this path
    if (d5 === 2) w.setB(S, 0xc, (w.b(S, 0xc) + (rng.byte() > 0x7f ? 1 : 3)) & 3);
    else w.setB(S, 0xc, w.b(S, 0xd));
    return 1;
  };
  if (w.b(S, 0xd) === 4) return turnPath();
  if (w.b(S, 0xc) !== w.b(S, 0xd) && (b3 & 0x20)) return turnPath();
  w.setB(S, 0xc, w.b(S, 0xd));
  let d2 = w.b(S, 0xb);
  const d7 = w.b(S, 0xc);
  let d6 = d2;
  if (d2 !== 4) {
    if (((d2 + 1) & 3) === d7) d6 = (d2 + 1) & 3;
    else if (((d2 + 2) & 3) === d7) d6 = (d2 + 3) & 3;
    else if (d2 === d7) { d6 = (d2 + 3) & 3; d2 = 4; }
    else { d6 = (d2 + 1) & 3; d2 = 4; }
    if (d2 !== 4) {
      if (enterTest(w, pos.x, pos.y, b3, b6, 2) === 2) w.log.push({ fn: 'openDoor', x: pos.x, y: pos.y });
    }
    w.setB(S, 0xb, d6);
  }
  if (d2 !== 4) return 0;
  const [nx, ny] = step(pos.x, pos.y, w.b(S, 0xc));
  if (nx === w.party.x && ny === w.party.y) return 0;
  let e = enterTest(w, nx, ny, b3, b6, 2);
  if (e === 2 && w.b(S, 0xb) === 4) { w.log.push({ fn: 'openDoor', x: nx, y: ny }); e = 0; }
  if (e === 1) return 0;
  removeFromSquare(w, mon, pos.x, pos.y);
  pos.x = nx; pos.y = ny;
  addToSquare(w, mon, nx, ny);
  return 0;
}

export interface RayResult { steps: number; x: number; y: number; hit: number; blocked: number }

/**
 * +0x435C: straight-line scan used by monster bolts (and the player's rays). Walks `range` squares from (x, y) in
 * direction `dir`; mode 0 / 1 = the near-side corner pair (positions d7, d3) of each square that a monster must occupy
 * (or the centre 4) to block, mode 2 = any monster blocks. Walls (cell bit 0x1000<<dir, tested on the square being
 * left) end the scan with blocked = 2; blocking objects with blocked = 1: monsters as above, pillar (0x17) / fountain
 * (0x1F) / illusion wall (0x10 with +0xC == 2) / pit-like 0x12 (+0x10 <= 3) while their state word +0xA == 0, and a
 * door frame (0x11) whose byte +0xF bit 0 is clear. Returns the squares walked; `hit` is the blocking object, and when
 * the blocker stands at position d3 a later monster at position d7 on the same square replaces it.
 * `d2init` reproduces the original's uninitialised register: an object id = the caller's direction (only matters when
 * the very first wall test fails before any square is entered).  **harness**
 */
export function ray(w: MoveWorld, range: number, dir: number, mode: number, x: number, y: number, d2init: number): RayResult {
  const r: RayResult = { steps: 0, x, y, hit: 0, blocked: 0 };
  let d7: number, d3: number;
  if (mode === 0) { d7 = (dir + 3) & 3; d3 = (d7 + 1) & 3; }
  else if (mode === 1) { d7 = (dir + 2) & 3; d3 = (d7 + 3) & 3; }
  else { d7 = 5; d3 = 5; }
  let id = d2init;
  while (r.blocked === 0 && r.steps < range) {
    if (wallBit(w.cell(r.x, r.y), dir)) r.blocked = 2;
    if (r.blocked) break;
    [r.x, r.y] = step(r.x, r.y, dir); r.steps++;
    id = w.cell(r.x, r.y) & 0xfff;
    while (id !== 0 && r.blocked === 0) {
      const solid = w.w(id, 0xa) === 0, t = w.b(id, 5);
      if (w.b(id, 0) & 0x80) {
        const p = w.b(w.w(id, 0x10), 0xb);
        if (p === 4 || p === d7 || p === d3 || mode === 2) r.blocked = 1;
      } else if (t === 0x17 && solid) r.blocked = 1;
      else if (t === 0x1f && solid) r.blocked = 1;
      else if (t === 0x10 && solid && w.w(id, 0xc) === 2) r.blocked = 1;
      else if (t === 0x12 && solid && ((w.w(id, 0x10) << 16) >> 16) <= 3) r.blocked = 1;
      else if (t === 0x11 && !(w.b(id, 0xf) & 1)) r.blocked = 1;
      if (r.blocked === 0) id = w.w(id, 0x12); else r.hit = id;
    }
  }
  if (w.b(id, 0) & 0x80 && w.b(w.w(id, 0x10), 0xb) === d3) {
    id = w.w(id, 0x12);
    while (id !== 0) {
      if ((w.b(id, 0) & 0x80) && w.b(w.w(id, 0x10), 0xb) === d7) r.hit = id;
      id = w.w(id, 0x12);
    }
  }
  return r;
}

export interface PartyChar { hp: number; ac: number; res: number; shield: number; ice: number; fire: number }
export interface ActEnv {
  party: { x: number; y: number; facing: number }; form: number[]; chars: PartyChar[];
  /** A4+0x1E91 (path length left by the last pathfinder run) */
  lastDist: number;
  /** the original reads an uninitialised stack byte as the ray mode selector (-0x29(a5)); 0 in the harness (hyp: it was meant to be S.b0B) */
  stackJunk: number;
}

/** fire bolts (spell-set bits 2..6): [base, rand range]; ice bolts (bits 7..10) */
export const BOLT_TABLE: Record<number, { base: number; range: number; ice: boolean }> = {
  2: { base: 2, range: 4, ice: false }, 3: { base: 4, range: 7, ice: false }, 4: { base: 5, range: 0xb, ice: false },
  5: { base: 0xa, range: 0x10, ice: false }, 6: { base: 0x14, range: 0x1f, ice: false },
  7: { base: 2, range: 4, ice: true }, 8: { base: 4, range: 7, ice: true }, 9: { base: 0xa, range: 0x10, ice: true }, 10: { base: 0x14, range: 0x1f, ice: true },
};

/**
 * +0x9D28: one monster act (melee or ranged) from (pos.x, pos.y) toward the party. Returns the routine's result
 * (0 nothing / done, 2 = too far or no clear line) and `out` (1 when it acted). Calls are appended to w.log.
 * Everything here is **harness** except the effects of the logged calls (damage kinds, 'hold', 'special').
 */
export function monsterAct(w: MoveWorld, mon: number, pos: { x: number; y: number }, op: number, flag: number, env: ActEnv, rng: BcRng): { ret: number; out: number } {
  const S = w.w(mon, 0x10), b3 = w.b(mon, 3), b6 = w.b(mon, 6), gfx = w.w(mon, 0);
  let out = 0;
  const dx = env.party.x - pos.x, dy = env.party.y - pos.y;
  const adx = Math.abs(dx), ady = Math.abs(dy), dist = adx + ady;
  const aligned = dx === 0 || dy === 0, adj = dist === 1;
  let d2 = 4;
  if (dx > 0 && adx > ady) d2 = 1; else if (dx < 0 && adx > ady) d2 = 3;
  else if (dy > 0 && ady > adx) d2 = 0; else if (dy < 0 && ady > adx) d2 = 2;
  if (d2 === 4) return { ret: 0, out };
  if (dx >= 4 || dy >= 4) return { ret: 2, out };
  if (flag === 1 && !(b3 & 0x20)) w.setB(S, 0xc, d2);
  if (w.b(S, 0xc) !== d2 && flag === 0) return { ret: 0, out };
  if (w.b(S, 0x13) === 1) { w.setB(S, 0xe, env.lastDist); w.setW(S, 0, env.party.x); w.setW(S, 2, env.party.y); }
  const modeFor = () => (env.stackJunk === 4 ? 2 : (env.stackJunk === d2 || ((env.stackJunk + 1) & 3) === d2) ? 0 : 1);
  if (w.b(S, 0xc) !== d2) {
    // not facing the party yet: turn / step toward it when the straight line is clear
    let rr = dist;
    if (aligned) rr = ray(w, dist, d2, modeFor(), pos.x, pos.y, d2).steps;
    if (rr !== dist) return { ret: 2, out };
    w.setB(S, 0xd, d2);
    const ret = moveMonster(w, mon, pos, rng);
    out = 1;
    return { ret, out };
  }
  let melee = (b6 & 2) !== 0 && adj && (op === 2 || op === 4);
  let magic = (b6 & 4) !== 0 && aligned && (op === 3 || op === 4 || op === 0xc);
  if (gfx === 0x80b9 && w.b(S, 0xf) === 0) w.setB(S, 0xf, 1);
  else {
    let thr = Math.floor(255 / (((b3 & 0xc) >> 2) + 1));
    if (gfx === 0x80b8 || gfx === 0x80b7) thr -= 30;
    if (rng.byte() < thr) return { ret: 0, out };
    const n = Number(melee) + Number(magic);
    if (n === 0) return { ret: 0, out };
    thr = Math.floor(255 / (n + 1));
    if (gfx === 0x80b8) thr -= 30;
    if (rng.byte() < thr) return { ret: 0, out };
  }
  if (melee && magic && rng.byte() > 0x7f) magic = false;
  const maxHp = (w.w(S, 8) << 16) >> 16;
  const m = Math.max(1, Math.trunc(maxHp / 10));
  const sp = (b3 & 0xc) >> 2;
  const dmg = (ch: number, d: number, kind: number, fl: number) => w.log.push({ fn: 'damage', ch, dmg: d, kind, flag: fl });
  if (magic) {
    const rr = ray(w, dist, d2, modeFor(), pos.x, pos.y, d2);
    if (rr.steps !== dist) return { ret: 0, out };
    const d4 = dist === 1 ? 0xf : 0xb, d5 = w.b(mon, 7) === 0 ? 0xc : 2;
    const wC = w.w(mon, 0xc);
    const bits: number[] = [];
    for (let b = d5; b <= d4; b++) if (wC & (1 << b)) bits.push(b);
    if (bits.length === 0) return { ret: 0, out };
    let bit = bits[rng.rand16(bits.length)];
    if (gfx === 0x80b7 && dist === 1) bit = 0xc;
    const bolt = BOLT_TABLE[bit];
    if (bit === 11) { w.log.push({ fn: 'hold', n: 18 }); bit = 0; w.setB(mon, 7, w.b(mon, 7) - 1); }
    else if (bit >= 12) { w.log.push({ fn: 'special', bit }); bit = 0; }
    if (bit !== 0) {
      const [t1, t2] = pickTargets(d2, env.party.facing, env.form, env.chars.map((c) => c.hp));
      for (const [k, t] of [t1, t2].entries()) {
        if (t === 4) continue;
        const c = env.chars[t];
        rng.rand16(100); // unused roll
        // original bug: the second target's magic-shield test reads the FIRST target's byte +0x83 (index 4 = outside the party array reads 0)
        const shield = k === 0 ? c.shield : (t1 === 4 ? 0 : env.chars[t1].shield);
        if (shield !== 0 && rng.rand8(100) <= 0x32) continue;
        if ((bolt.ice ? c.ice : c.fire) !== 0) continue;
        if (rng.rand8(100) < ((c.res << 24 >> 24) & 0xffff)) continue;
        dmg(t, rng.rand16(bolt.range) + bolt.base + m, 4, 1);
      }
    }
    return { ret: 0, out: 1 };
  }
  // melee
  const form = env.form, hp = env.chars.map((c) => c.hp);
  const [t1, t2] = pickTargets(d2, env.party.facing, form, hp);
  const pos0 = w.b(S, 0xb);
  let tgt: number;
  if (pos0 !== 4) tgt = d2 === pos0 ? t1 : ((pos0 + 3) & 3) === d2 ? t2 : 4;
  else if (t1 === 4) tgt = t2; else if (t2 === 4) tgt = t1; else tgt = [t1, t2][rng.rand16(2)];
  if (tgt === 4) return { ret: 0, out };
  w.log.push({ fn: 'sched' });
  const thr = Math.max(2, Math.min(20, ((env.chars[tgt].ac << 24) >> 24) + 8 - ((m - 1) >> 1) - sp));
  if (rng.rand8(20) + 1 >= thr) dmg(tgt, rng.rand16(4 * m) + m, 4, 1);
  return { ret: 0, out: 1 };
}

export interface ScanEvent { type: number; due: number; x: number; y: number; id: number }

/**
 * +0xB614 (monster half): every 16 ticks the game scans the 7x7 window around the party (party +-3 squares, squares
 * with x or y <= 0 or >= 63 skipped). For each monster object whose S.b13 ("event pending") is 0 it runs the pathfinder
 * from the monster to the party. A path of length < 5 activates the monster: S.b0E = path length, S.w0 / S.w2 = party
 * position, S.b13 = 1 and event 1 (act) is scheduled at tick + rand16(6) + 1. Otherwise (no path, or length >= 5), unless
 * the movement type is 1 (stationary guard), the monster is switched to **movement type 10** (the waiting script,
 * §8.3): S.var[2] = old type (low byte), S.var[3] = 0x96 (150), S.pc = 1, P.wE = 10, S.b13 = 1, same schedule.
 * gfx 0x804F is always activated as if the path length were 2. The generator-structure half of the routine is not
 * modelled. **harness** (monster half)
 */
export function activationScan(w: MoveWorld, tick: number, rng: BcRng): ScanEvent[] {
  const ev: ScanEvent[] = [];
  const px = w.party.x, py = w.party.y;
  for (let d5 = -3; d5 <= 3; d5++) {
    for (let d4 = -3; d4 <= 3; d4++) {
      const x = px + d4, y = py + d5;
      if (x <= 0 || y <= 0 || x >= 0x3f || y >= 0x3f) continue;
      let id = w.cell(x, y) & 0xfff;
      while (id !== 0) {
        if (w.b(id, 0) & 0x80) {
          const S = w.w(id, 0x10);
          if (w.b(S, 0x13) === 0) {
            let res = pathfind(w, id, x, y, px, py);
            let result = res.result, dist = res.dist;
            if (w.w(id, 0) === 0x804f) { result = 2; dist = 2; }
            const sched = () => { const e = { type: 1, due: (tick + rng.rand16(6) + 1) >>> 0, x: x & 0xff, y: y & 0xff, id }; ev.push(e); w.log.push({ fn: 'ev', ...e }); };
            if (dist < 5 && result !== 3) {
              w.setB(S, 0xe, dist); w.setW(S, 0, px); w.setW(S, 2, py);
              // the original draws the delay before touching S.b13
              sched(); w.setB(S, 0x13, 1);
            } else if (w.w(id, 0xe) !== 1) {
              w.setB(S, 0x11, w.b(id, 0xf)); w.setB(S, 0x12, 0x96); w.setW(S, 4, 1); w.setW(id, 0xe, 10); w.setB(S, 0x13, 1);
              sched();
            }
          }
        }
        id = w.w(id, 0x12);
      }
    }
  }
  return ev;
}

const listFromMask = (m: number) => [0, 1, 2, 3].filter((d) => m & (1 << d));

/**
 * +0xA664: the VM's pursue step (ops 02 / 03 / 04 with w1 == 1). Searches a path to the party (falling back to the
 * last-seen position S.w0 / S.w2 with S.b13 = 2 when there is none; no path to either returns 2). Directly adjacent
 * with a clear line (path result 1): faces the open direction and attacks via +0x9D28 (flag 1). Otherwise it may
 * cast / shoot first (aligned, distance < 4, can use magic, S.b13 == 1), then chooses a facing (+0x937A) and
 * takes the movement step (+0x9116) unless an attack was made. **harness**
 */
export function pursue(w: MoveWorld, mon: number, pos: { x: number; y: number }, op: number, env: ActEnv, rng: BcRng): number {
  const S = w.w(mon, 0x10), b3 = w.b(mon, 3), b6 = w.b(mon, 6);
  const P = w.party;
  let d7 = 0, d6 = 0;
  const act = (flag: number) => monsterAct(w, mon, pos, op, flag, { ...env, lastDist: w.lastDist }, rng);
  if (w.b(S, 0xd) === 4 || w.b(S, 0xc) === w.b(S, 0xd)) {
    let r = pathfind(w, mon, pos.x, pos.y, P.x, P.y);
    if (r.result === 3) {
      w.setB(S, 0xe, w.lastDist); w.setB(S, 0x13, 2);
      r = pathfind(w, mon, pos.x, pos.y, w.w(S, 0), w.w(S, 2));
      if (r.result !== 2) return 2;
    } else {
      w.setB(S, 0x13, 1); w.setB(S, 0xe, w.lastDist); w.setW(S, 0, P.x); w.setW(S, 2, P.y);
    }
    let attacked = false;
    if (r.result === 1 && (!(b3 & 0x20) || w.b(S, 0xc) === r.list[0])) {
      w.setB(S, 0xd, 4); w.setB(S, 0xc, r.list[0]);
      d6 = act(1).ret; d7 = 1; attacked = true;
    }
    if (!attacked) {
      let outv = 0;
      const dx = P.x - pos.x, dy = P.y - pos.y, dist = Math.abs(dx) + Math.abs(dy);
      if ((dx === 0 || dy === 0) && dist < 4 && (b6 & 4) && w.b(S, 0x13) === 1) { const a = act(0); d6 = a.ret; outv = a.out; }
      if (outv === 0) pickDirection(w, S, r.list, rng); else d7 = 1;
    }
  }
  if (d7 === 0) d6 = moveMonster(w, mon, pos, rng);
  return d6;
}

/**
 * +0x940C: the caster's approach step (VM op 0x0B). Pathfinder first (none: returns 2); in mode 0xC a monster that is
 * aligned, 2..3 squares away, facing the first open direction, able to cast and with charges left casts at once
 * (+0x9D28, flag 0). Otherwise the facing is chosen from the adjacency scan (+0x8D7E), preferring directions the
 * search did not offer, and the movement step is taken. **harness**
 */
export function approach(w: MoveWorld, mon: number, pos: { x: number; y: number }, mode: number, env: ActEnv, rng: BcRng): number {
  const S = w.w(mon, 0x10), b6 = w.b(mon, 6);
  const P = w.party;
  if (w.b(S, 0xd) === 4 || w.b(S, 0xc) === w.b(S, 0xd)) {
    const r = pathfind(w, mon, pos.x, pos.y, P.x, P.y);
    if (r.result === 3) return 2;
    if (mode === 0xc) {
      const dx = P.x - pos.x, dy = P.y - pos.y, d7 = Math.abs(dx) + Math.abs(dy);
      if ((dx === 0 || dy === 0) && d7 < 4 && (b6 & 4) && w.b(S, 0x13) === 1 && d7 > 1 && w.b(S, 0xc) === r.list[0] && w.b(mon, 7) > 0) {
        const a = monsterAct(w, mon, pos, mode, 0, { ...env, lastDist: w.lastDist }, rng);
        if (a.out !== 0) return 0;
      }
    }
    if (w.b(S, 0x13) === 1) { w.setB(S, 0xe, w.lastDist); w.setW(S, 0, P.x); w.setW(S, 2, P.y); }
    const before = r.dirMask;
    const adj = adjacent(w, mon, pos.x, pos.y, P.x, P.y);
    let nw = adj.dirMask & ~before;
    if (nw === 0) nw = adj.dirMask;
    if (adj.result !== 3) pickDirection(w, S, listFromMask(nw), rng);
    else { w.setB(S, 0xe, w.lastDist); w.setB(S, 0xd, 4); }
  }
  return moveMonster(w, mon, pos, rng);
}

/** +0x9626: the wander step (VM op 0x1E): adjacency scan, choose among the open directions, step. Returns the mover result (0 with nothing open). **harness** */
export function wander(w: MoveWorld, mon: number, pos: { x: number; y: number }, rng: BcRng): number {
  const S = w.w(mon, 0x10);
  const P = w.party;
  const adj = adjacent(w, mon, pos.x, pos.y, P.x, P.y);
  if (w.b(S, 0x13) === 1) { w.setB(S, 0xe, w.lastDist); w.setW(S, 0, P.x); w.setW(S, 2, P.y); }
  if (adj.result !== 3) { pickDirection(w, S, adj.list, rng); return moveMonster(w, mon, pos, rng); }
  w.setB(S, 0xe, w.lastDist); w.setB(S, 0xd, 4);
  return 0;
}

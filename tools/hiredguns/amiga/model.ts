/**
 * Hired Guns (Amiga) movement model — browser-safe.
 *
 * Re-implements the rules of the game's `move` / `forward` / `players_fall` (CD32 dev
 * archive `Sources/Controls&Movement.s` and `Sources/Main.s`; the floppy retail exe has
 * the same 67-cell view and cell format, see view.ts). Positions are cells of the
 * 23 x 23 x 20 voxel cube; z grows upwards.
 *
 * Rules (per step in direction d, from cell C to the same-layer neighbour T):
 *  1. C must be "standing on something": C has a floor (floor field/flag), or the cell
 *     below has a block, or the cell two below is a tree (block 4), or C holds water >= 2
 *     (swimming). Otherwise the party cannot move (it is falling).
 *  2. Stairs up: C's aux is the up-stair facing d (aux 8/9/10/11 for N/E/S/W). If the
 *     cell above C is free of block/floor/opaque, T moves up one layer; else no move.
 *  3. Stairs down: the cell below C is the down-stair block facing d (18/19/16/17 for
 *     N/E/S/W). If T has no floor and the cell below T is free of block/opaque (or holds a
 *     player head), T moves down one layer.
 *  4. T holding a block or the opaque flag blocks the step. A door block (20/21) is opened
 *     instead (doors with `door_direction` 3 are locked); teleport (6), boost (2) and exit
 *     (3) blocks are reported but not acted on here.
 *  5. Free T: entered if it has a floor; otherwise depending on the block below T — none
 *     (step off a ledge: the party then falls), stone-like (< 8) or stairs/doors (16..21)
 *     are fine; a tree (4), a monster (8..15) or anything 22..47 below refuses the step.
 *  6. Falling (`players_fall`): while the cell has no floor flag, no block directly below
 *     and no tree two below, drop one layer (water >= 2 floats down slowly; here it just
 *     stops the fall, since swimming counts as support).
 *
 * The walker shows one z-layer per "level" (`levelId = map*100 + z`); a stair or a fall
 * changes z and therefore the level.
 */
import {
  BLOCK_HERE, CELLS, KEEP_BLOCK, KEEP_FLOOR, KEEP_WATER, LAYER, MAP_D, MAP_H, MAP_W, OPAQUE,
  blockOf, cellIndex, type HgPos,
} from './map.ts';

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
const STAIRS_UP_AUX = [8, 9, 10, 11] as const; // forward: (8+dir)<<aux_shift | aux_here
const STAIRS_DOWN_BLOCK = [18, 19, 16, 17] as const;
const AUX_MASK = 0xf0000020;
const AUX_HERE = 0x20;

export interface HgDoor { cell: number; direction: number; key: number; buttonOnly: boolean }

export interface HgWorld {
  cells: Uint32Array;
  doors: HgDoor[];
}

export type StepEvent = 'moved' | 'stairs-up' | 'stairs-down' | 'blocked' | 'falling' | 'door-opened' | 'door-locked' | 'teleport' | 'boost' | 'exit' | 'edge';

export interface StepResult { moved: boolean; pos: HgPos; event: StepEvent; fell: number }

const cellAt = (w: HgWorld, i: number): number => (i >= 0 && i < CELLS ? w.cells[i]! : 0);
const below = (w: HgWorld, i: number, n = 1): number => cellAt(w, i - n * LAYER);
const blockWord = (b: number): number => ((b << 11) | BLOCK_HERE) >>> 0;
const masked = (v: number, m: number): number => (v & m) >>> 0;

/** Rule 1 / rule 6: is the party supported in cell i? */
export function supported(w: HgWorld, i: number): boolean {
  const v = cellAt(w, i);
  if (masked(v, KEEP_FLOOR) !== 0) return true;
  if (masked(below(w, i), KEEP_BLOCK) !== 0) return true;
  if (masked(below(w, i, 2), KEEP_BLOCK) === blockWord(4)) return true;
  return masked(v, KEEP_WATER) >= ((2 << 17) | 4);
}

/** Can the party occupy cell i at all (ignoring support)? */
export function passable(w: HgWorld, i: number): boolean {
  return i >= 0 && masked(cellAt(w, i), KEEP_BLOCK | OPAQUE) === 0;
}

/** Drop from cell i until supported (players_fall); returns the landing cell and layers fallen. */
export function fall(w: HgWorld, i: number): { cell: number; fell: number } {
  let c = i;
  let n = 0;
  while (c - LAYER >= 0) {
    const v = cellAt(w, c);
    if (v & 1) break; // floor_here_bit
    if (masked(below(w, c, 2), KEEP_BLOCK) === blockWord(4)) break;
    if (below(w, c) & BLOCK_HERE) break;
    if (masked(v, KEEP_WATER) >= ((2 << 17) | 4)) break;
    c -= LAYER;
    n++;
  }
  return { cell: c, fell: n };
}

const toPos = (i: number): HgPos => ({ x: i % MAP_W, y: Math.floor(i / MAP_W) % MAP_D, z: Math.floor(i / LAYER) });

export function tryStep(w: HgWorld, pos: HgPos, dir: number, noclip = false): StepResult {
  const d = dir & 3;
  const cur = cellIndex(pos.x, pos.y, pos.z);
  const nx = pos.x + DX[d]!;
  const ny = pos.y + DY[d]!;
  const stay = (event: StepEvent): StepResult => ({ moved: false, pos, event, fell: 0 });
  let t = cellIndex(nx, ny, pos.z);
  if (cur < 0 || t < 0) return stay('edge');
  if (noclip) return { moved: true, pos: toPos(t), event: 'moved', fell: 0 };
  const C = cellAt(w, cur);
  if (!supported(w, cur)) return stay('falling');
  let event: StepEvent = 'moved';
  const aux = masked(C, AUX_MASK);
  if (aux !== 0 && aux === (((STAIRS_UP_AUX[d]! << 28) | AUX_HERE) >>> 0)) {
    if (masked(cellAt(w, cur + LAYER), KEEP_BLOCK | KEEP_FLOOR | OPAQUE) !== 0 || pos.z + 1 >= MAP_H) return stay('blocked');
    t += LAYER;
    event = 'stairs-up';
  } else {
    const bb = masked(below(w, cur), KEEP_BLOCK);
    if (bb !== 0 && bb === blockWord(STAIRS_DOWN_BLOCK[d]!)) {
      if (masked(cellAt(w, t), KEEP_FLOOR) === 0) {
        const under = masked(below(w, t), KEEP_BLOCK | OPAQUE);
        const head = under >= blockWord(32) && under <= blockWord(47);
        if ((under === 0 || head) && pos.z > 0) { t -= LAYER; event = 'stairs-down'; }
      }
    }
  }
  const T = cellAt(w, t);
  const obstruction = masked(T, KEEP_BLOCK | OPAQUE);
  if (obstruction !== 0) {
    if (obstruction >= blockWord(20) && obstruction <= blockWord(21)) return openDoor(w, t, pos);
    const b = blockOf(T);
    if (b === 6) return stay('teleport');
    if (b === 2) return stay('boost');
    if (b === 3) return stay('exit');
    return stay('blocked');
  }
  if (masked(T, KEEP_FLOOR) === 0) {
    const bt = masked(below(w, t), KEEP_BLOCK);
    if (bt !== 0) {
      if (bt === blockWord(4)) return stay('blocked');
      if (bt >= blockWord(8) && bt <= blockWord(47)) {
        if (bt <= blockWord(15) || bt >= blockWord(22)) return stay('blocked');
      }
    }
  }
  const f = fall(w, t);
  return { moved: true, pos: toPos(f.cell), event: f.fell > 0 && event === 'moved' ? 'falling' : event, fell: f.fell };
}

/**
 * Bumping a door (move_doors/open_door): a locked door (door_direction 3) stays shut;
 * otherwise the game slides it open over 10 variant steps and then erases the block.
 * The walker skips the animation and erases the block bits at once (the open-door aux
 * frame 12/13 already sits in the same cell).
 */
function openDoor(w: HgWorld, t: number, pos: HgPos): StepResult {
  const door = w.doors.find((d) => d.cell === t);
  if (door && door.direction === 3) return { moved: false, pos, event: 'door-locked', fell: 0 };
  w.cells[t] = (w.cells[t]! & ~KEEP_BLOCK & ~(31 << 23)) >>> 0;
  return { moved: false, pos, event: 'door-opened', fell: 0 };
}

/** Layers of a map with at least one cell the party could stand in (for the level list). */
export function walkableLayers(w: HgWorld): number[] {
  const out: number[] = [];
  for (let z = 1; z < MAP_H; z++) {
    let any = false;
    for (let i = z * LAYER; i < (z + 1) * LAYER && !any; i++) {
      const x = i % MAP_W, y = Math.floor(i / MAP_W) % MAP_D;
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_D - 1) continue;
      if (passable(w, i) && supported(w, i)) any = true;
    }
    if (any) out.push(z);
  }
  return out;
}

/** First standable cell of a layer, nearest to (cx,cy); null if none. */
export function standableNear(w: HgWorld, z: number, cx = 11, cy = 11): HgPos | null {
  let best: HgPos | null = null;
  let bd = Infinity;
  for (let y = 1; y < MAP_D - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    const i = cellIndex(x, y, z);
    if (!passable(w, i) || !supported(w, i)) continue;
    const dd = (x - cx) ** 2 + (y - cy) ** 2;
    if (dd < bd) { bd = dd; best = { x, y, z }; }
  }
  return best;
}

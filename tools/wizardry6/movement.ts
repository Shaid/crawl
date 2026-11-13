/**
 * Wizardry 6 (Amiga) party movement — a port of the game's own move path,
 * replacing the walker's old render-evaluator-based step check.
 *
 * Every address below is a **`Bane.asm` line-comment address, i.e. a
 * `CODE`-hunk offset** (file offset = address + `0x28`; verified: file
 * `0x116d4` holds `4e55fffc`, the `LINK` that `Bane.asm` prints at
 * `;116ac`). See `docs/wizardry6/amiga/data-structure.md` §4.7.10.
 *
 * ```
 * TryMove(rel)                         LAB_07C0  CODE+0x116ac
 *   dir   = (facing + rel) & 3
 *   code  = RawWall(dir)               LAB_0792  CODE+0x11152  (raw planes only,
 *                                       features ignored; dirs 2/3 via the
 *                                       neighbour helpers CODE+0x908c/0x90f6:
 *                                       off-map -> 2, or 0 on levels 10/12)
 *   switch doorState[dir]              -18146(A4)[dir], set on arrival by kind-7
 *                                       entities (CODE+0xc0f8), cleared every step
 *     0: code < 2           -> Step(dir)
 *        code 3 && forward  -> door opens (CODE+0x11736..0x11772), Step(dir)
 *        else               -> bump, message 0x7e4 ("ouch")
 *     1,2: code 3 && forward -> message 0x7e5 (locked); else bump
 *     3: code 2             -> Step(dir)  (wall passable, open edges bump)
 * Step(dir)                            LAB_07AB  CODE+0x1142c
 *   save previous pose (LAB_07A8); abs += delta (LAB_07A3); resolve region
 *   off-map: levels 10/12 -> restore (LAB_07AA), message 0x805
 *            other levels -> LAB_078E(0x7e6): party-wide kill, game state 8
 *   flagP(new cell): per-level table CODE+0x1163c
 *     0,2,3,4,6,11 -> LAB_078E(0x2710 "you fell to your death")
 *     1            -> region 10: warp to region 4 (x<4: x+4,y+3) / 5 (x-4,y+3);
 *                     other regions: death as above
 *     8,10, 12 outside regions 9-11 -> restore (bounce, 0x805) unless the
 *                     timed-effect slot -18136(A4) is set (runtime; off here)
 *     5,7,9,13     -> no effect
 *   flagQ(new cell): level 2 -> LAB_078E(0x7e6) death; other levels none
 * post-move (CODE+0x13c54..0x13d5e): if the cell has an entity
 *   (-18114 bitset) the per-cell entity dispatch LAB_06B6 (CODE+0xe9be) runs:
 *   FindEntitySlot loop, kind byte -> 26-way table CODE+0xeb30.
 * ```
 *
 * Of the entity kinds only two affect position/movement and are modelled:
 * - kind 1 (`LAB_05D4` CODE+0xbdce -> `LAB_05CF` CODE+0xbcb8): teleport.
 *   `+0x000` sub-type 0/1/2/4/5/6 teleports (2 also prints 0x804, 4-6 play a
 *   sound), 3 does nothing. `+0x240` = x bits 0-2, y 3-5, region 6-9, and
 *   bits 10-11 = the trigger-mark mode passed to `LAB_05CD` (NOT a facing —
 *   facing is never written). `+0x630` = destination level (99 -> -1 = leave
 *   the maze, game state 7; no shipped teleporter uses it).
 * - kind 7 (`LAB_05EA` CODE+0xc0f8): per-direction door state,
 *   `doorState[d] = (+0x240 >> 2d) & 3`; mark mode = `(+0x630 >> 5) & 3`.
 * The scan skips an entity whose `+0x5a0` flag bit is set in the current
 * level's 80-bit table `-18290(A4)+level*10`, which `LAB_073F` (CODE+0x103e8)
 * reloads from the persistent copy `-30310(A4)+level*10` on every level
 * entry; `-30310` is read from `SCENARIO.HDR` (414 bytes, `LAB_02C5`
 * CODE+0x4878). `LAB_05CD` (CODE+0xbc34) marks a fired entity's bit in the
 * transient table when mode >= 1 and also in the persistent one when >= 2.
 * Teleports clear the scan-continue flag so the scan restarts at the
 * destination cell (chains; the ping-pong pairs are disabled by their
 * initial flag bits).
 */

/** Section-3 entity tables for one level (all 144 slots, structure-of-arrays as on disk). */
export interface W6EntityTable {
  /** `+0x360` kind byte (0 = empty slot). */
  kind: number[];
  /** `+0x3f0`/`+0x480` local cell (0-7) and `+0x510` region (0-11). */
  localX: number[];
  localY: number[];
  region: number[];
  /** `+0x5a0` bit index into the level's 80-bit trigger table. */
  flagBit: number[];
  /** `+0x000` (BE u16): msg trigger id, or kind 1's sub-type. */
  w000: number[];
  /** `+0x240` (BE u16) packed parameter word. */
  w240: number[];
  /** `+0x630` byte (kind 1: destination level). */
  b630: number[];
  /** `+0x6c0` per-region first-entity index. */
  regionStart: number[];
}

/** Everything the move port needs about one level beyond the wall/flag planes. */
export interface W6LevelLinks {
  level: number;
  /** Densified-grid position of each region's local (0,0); `null` for an origin-(0,0) unused region. */
  regionOrigin: Array<{ x: number; y: number } | null>;
  entities: W6EntityTable;
  /**
   * Kind-1 teleport targets, pre-resolved to the destination level's
   * densified grid (`null` for non-teleport slots). Precomputed by the
   * exporter because the destination level's region origins live in a
   * different level file.
   */
  teleportDest: Array<{ level: number; x: number; y: number } | null>;
  /** Initial `-30310(A4)+level*10` trigger bytes (`SCENARIO.HDR[level*10 .. +10]`). */
  initialFlags: number[];
}

/** Minimal plane view the move port reads (a subset of `CellPlanes`). */
export interface MovePlanes {
  width: number;
  height: number;
  wallA: number[];
  wallB: number[];
  flagP?: number[];
  flagQ?: number[];
  region?: number[];
  level?: number;
}

const DELTAS = [
  { dx: 0, dy: 1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
] as const;

/** Levels whose off-map space is open ground/sky (CODE+0x9248, 0x90b4, 0x911e, 0x114c2). */
export function offMapIsOpen(level: number): boolean {
  return level === 10 || level === 12;
}

/** A densified cell that no real region covers (or one outside the grid) — the game's resolver (`LAB_045D`) finds no region there. */
export function isOffMap(planes: MovePlanes, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= planes.width || y >= planes.height) return true;
  return planes.region !== undefined && (planes.region[y * planes.width + x] ?? -1) < 0;
}

/** `LAB_0792` (CODE+0x11152): the raw 2-bit wall value on the `dir` face of `(x,y)`, features ignored. */
export function rawWall(planes: MovePlanes, x: number, y: number, dir: number): number {
  const level = planes.level ?? -1;
  const i = y * planes.width + x;
  if (dir === 0) return planes.wallA[i]!;
  if (dir === 1) return planes.wallB[i]!;
  const nx = dir === 3 ? x - 1 : x;
  const ny = dir === 2 ? y - 1 : y;
  if (isOffMap(planes, nx, ny)) return offMapIsOpen(level) ? 0 : 2;
  const j = ny * planes.width + nx;
  return dir === 2 ? planes.wallA[j]! : planes.wallB[j]!;
}

/** Message ids the move path prints (msg.dbs `a` field where decoded). */
export const W6_MSG = {
  bump: 0x7e4, // "ouch"
  locked: 0x7e5,
  killed: 0x7e6, // via LAB_078E: whole party killed
  bounce: 0x805,
  fellToDeath: 0x2710, // "you fell to your death"
  teleportNote: 0x804,
} as const;

export type MoveResult =
  | { kind: 'moved'; x: number; y: number; doorOpened: boolean; warped: boolean }
  | { kind: 'bump'; message: number }
  | { kind: 'locked'; message: number }
  | { kind: 'bounce'; message: number }
  | { kind: 'death'; message: number };

/**
 * `TryMove` + `LAB_07AB`: attempt one step from `(x,y)` in compass `dir`
 * while facing `facing`. `doorState` is the per-direction `-18146(A4)`
 * array (all 0 when no kind-7 entity is on the cell). `levitating` is the
 * runtime timed-effect slot `-18136(A4)` (default off).
 */
export function tryMove(
  planes: MovePlanes,
  links: Pick<W6LevelLinks, 'regionOrigin'> | undefined,
  x: number,
  y: number,
  dir: number,
  facing: number,
  doorState: readonly number[] = [0, 0, 0, 0],
  levitating = false,
): MoveResult {
  const level = planes.level ?? -1;
  const code = rawWall(planes, x, y, dir);
  const forward = dir === facing;
  const state = doorState[dir] ?? 0;

  let doorOpened = false;
  if (state === 0) {
    if (code >= 2) {
      if (code === 3 && forward) doorOpened = true;
      else return { kind: 'bump', message: W6_MSG.bump };
    }
  } else if (state === 3) {
    if (code !== 2) return { kind: 'bump', message: W6_MSG.bump };
  } else {
    return code === 3 && forward ? { kind: 'locked', message: W6_MSG.locked } : { kind: 'bump', message: W6_MSG.bump };
  }

  // LAB_07AB: step, then resolve the new cell.
  let nx = x + DELTAS[dir]!.dx;
  let ny = y + DELTAS[dir]!.dy;
  if (isOffMap(planes, nx, ny)) {
    return offMapIsOpen(level) ? { kind: 'bounce', message: W6_MSG.bounce } : { kind: 'death', message: W6_MSG.killed };
  }
  const i = ny * planes.width + nx;
  const flagP = (planes.flagP?.[i] ?? 0) !== 0;
  let flagQ = (planes.flagQ?.[i] ?? 0) !== 0;
  let warped = false;
  if (flagP) {
    switch (level) {
      case 0:
      case 2:
      case 3:
      case 4:
      case 6:
      case 11:
        return { kind: 'death', message: W6_MSG.fellToDeath };
      case 1: {
        const region = planes.region?.[i] ?? -1;
        const origin10 = links?.regionOrigin[10];
        if (region !== 10 || !origin10) return { kind: 'death', message: W6_MSG.fellToDeath };
        let lx = nx - origin10.x;
        let ly = ny - origin10.y;
        let target: number;
        if (lx < 4) {
          target = 4;
          lx += 4;
        } else {
          target = 5;
          lx -= 4;
        }
        ly += 3;
        const o = links.regionOrigin[target];
        if (!o) return { kind: 'death', message: W6_MSG.fellToDeath };
        nx = o.x + lx;
        ny = o.y + ly;
        warped = true;
        flagQ = false; // CODE+0x115f8 clears the cached flagQ after the warp
        break;
      }
      case 8:
      case 10:
      case 12: {
        const region = planes.region?.[i] ?? -1;
        if (level === 12 && region >= 9) break;
        if (!levitating) return { kind: 'bounce', message: W6_MSG.bounce };
        break;
      }
      default:
        break; // 5, 7, 9, 13: no handler
    }
  }
  if (flagQ && level === 2) return { kind: 'death', message: W6_MSG.killed };
  return { kind: 'moved', x: nx, y: ny, doorOpened, warped };
}

function testBit(table: ArrayLike<number>, bit: number): boolean {
  return ((table[bit >> 3] ?? 0) >> (bit & 7) & 1) === 1;
}
function setBit(table: number[] | Uint8Array, bit: number): void {
  table[bit >> 3] = ((table[bit >> 3] ?? 0) | (1 << (bit & 7))) & 0xff;
}

/** The two 80-bit-per-level trigger tables (`-30310(A4)` persistent, `-18290(A4)` transient), session-wide. */
export class W6TriggerState {
  private readonly persistent = new Map<number, number[]>();
  private readonly transient = new Map<number, number[]>();

  /** `LAB_073F`: entering `level` reloads its transient table from the persistent one (seeded from `SCENARIO.HDR`). */
  enterLevel(level: number, initialFlags: readonly number[]): void {
    if (!this.persistent.has(level)) this.persistent.set(level, Array.from({ length: 10 }, (_, k) => initialFlags[k] ?? 0));
    this.transient.set(level, [...this.persistent.get(level)!]);
  }
  isTriggered(level: number, bit: number): boolean {
    const t = this.transient.get(level);
    return t ? testBit(t, bit) : false;
  }
  /** `LAB_05CD(mode)`: mark `bit` (when > 0) transient for mode >= 1, also persistent for mode >= 2. */
  mark(level: number, bit: number, mode: number): void {
    if (mode <= 0 || bit <= 0) return;
    const t = this.transient.get(level);
    if (t) setBit(t, bit);
    if (mode > 1) {
      const p = this.persistent.get(level);
      if (p) setBit(p, bit);
    }
  }
}

/** Densified cell -> (region, localX, localY), or null off-map. */
function localOf(links: W6LevelLinks, planes: MovePlanes, x: number, y: number): { region: number; lx: number; ly: number } | null {
  if (isOffMap(planes, x, y)) return null;
  const region = planes.region?.[y * planes.width + x] ?? -1;
  const o = links.regionOrigin[region];
  if (region < 0 || !o) return null;
  return { region, lx: x - o.x, ly: y - o.y };
}

export interface ArrivalResult {
  /** Where the party ends up (may be on another level after a teleport). */
  pose: { level: number; x: number; y: number };
  /** `-18146(A4)` per-direction door states for the final cell (only meaningful when `pose.level` is this level and no level change is pending). */
  doorState: number[];
  /** True when a kind-1 teleport fired. */
  teleported: boolean;
  /** Set when the final position is on a different level: the caller must load it and call `arrive` again there (the game's scan continues at the destination). */
  levelChange: boolean;
}

/**
 * `LAB_06B6` (CODE+0xe9be): the post-move per-cell entity dispatch, for the
 * two position-affecting kinds. Runs `FindEntitySlot` (CODE+0x8fe6) from the
 * region's `+0x6c0` start index: abort on region mismatch, skip
 * wrong cell / empty slot / already-triggered entity.
 */
export function arrive(
  planes: MovePlanes,
  links: W6LevelLinks,
  triggers: W6TriggerState,
  x: number,
  y: number,
): ArrivalResult {
  const level = links.level;
  const e = links.entities;
  let doorState = [0, 0, 0, 0];
  let cx = x;
  let cy = y;
  let teleported = false;
  let loc = localOf(links, planes, cx, cy);
  let start = loc ? (e.regionStart[loc.region] ?? 0) : 0;
  for (let guard = 0; loc && guard < 64; guard++) {
    let found = -1;
    for (let k = start; k < 144; k++) {
      if (e.region[k] !== loc.region) break;
      if (e.localX[k] !== loc.lx || e.localY[k] !== loc.ly) continue;
      if (!e.kind[k]) continue;
      if (triggers.isTriggered(level, e.flagBit[k]!)) continue;
      found = k;
      break;
    }
    if (found < 0) break;
    const kind = e.kind[found]!;
    if (kind === 1 && e.w000[found] !== 3 && (e.w000[found] ?? 0) <= 6) {
      triggers.mark(level, e.flagBit[found]!, (e.w240[found]! >> 10) & 3);
      const dest = links.teleportDest[found];
      if (!dest) break;
      doorState = [0, 0, 0, 0];
      teleported = true;
      if (dest.level !== level) {
        return { pose: dest, doorState, teleported, levelChange: true };
      }
      cx = dest.x;
      cy = dest.y;
      loc = localOf(links, planes, cx, cy);
      start = loc ? (e.regionStart[loc.region] ?? 0) : 0;
      continue;
    }
    if (kind === 7) {
      const w = e.w240[found]!;
      doorState = [0, 1, 2, 3].map((d) => (w >> (d * 2)) & 3);
      triggers.mark(level, e.flagBit[found]!, (e.b630[found]! >> 5) & 3);
    }
    start = found + 1;
  }
  return { pose: { level, x: cx, y: cy }, doorState, teleported, levelChange: false };
}

/**
 * Static movement rule for one step with no entity state (doors unlocked,
 * no levitation) — what the walker's reachability numbers and unit tests use.
 */
export function canStepStatic(planes: MovePlanes, links: Pick<W6LevelLinks, 'regionOrigin'> | undefined, x: number, y: number, dir: number, facing = dir): boolean {
  return tryMove(planes, links, x, y, dir, facing).kind === 'moved';
}

/** Parse `scenario.dbs` section 3 (file offset `0xe828`, 1740 B/level) for one level. */
export function parseEntityTable(scenario: Uint8Array, level: number): W6EntityTable {
  const base = 0xe828 + level * 1740;
  const u16 = (off: number, i: number) => (scenario[base + off + 2 * i]! << 8) | scenario[base + off + 2 * i + 1]!;
  const u8 = (off: number, i: number) => scenario[base + off + i]!;
  const idx = Array.from({ length: 144 }, (_, i) => i);
  return {
    kind: idx.map((i) => u8(0x360, i)),
    localX: idx.map((i) => u8(0x3f0, i)),
    localY: idx.map((i) => u8(0x480, i)),
    region: idx.map((i) => u8(0x510, i)),
    flagBit: idx.map((i) => u8(0x5a0, i)),
    w000: idx.map((i) => u16(0x000, i)),
    w240: idx.map((i) => u16(0x240, i)),
    b630: idx.map((i) => u8(0x630, i)),
    regionStart: Array.from({ length: 12 }, (_, r) => u8(0x6c0, r)),
  };
}

/** The game's new-party start pose (`CODE+0x4212a`..`0x4214e`): level 12, region 2, local (1,4), facing 2 (abs (137,151)). */
export const W6_NEW_GAME_START = { level: 12, region: 2, localX: 1, localY: 4, facing: 2 } as const;

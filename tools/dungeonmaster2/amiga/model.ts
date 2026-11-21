/**
 * Dungeon Master II (Amiga) walker map model: movement + collision from the
 * decoded `DUNGEON.DAT` squares. Original code (no port): the semantics are
 * the square-byte layout documented in `docs/dungeonmaster-format.md`
 * (type<<5 | hasObject<<4 | attr) with the DM1 attribute bits, which for
 * DM2 are a HYPOTHESIS (the door-axis rule is checked structurally by the
 * test against the real corridors; the rest is unverified).
 *
 * Pure: runs in the browser and in tests.
 */

export const SQ = { WALL: 0, FLOOR: 1, PIT: 2, STAIRS: 3, DOOR: 4, TELEPORTER: 5, TRICKWALL: 6, EMPTY: 7 } as const;

export interface Dm2Map {
  index: number;
  level: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  mapGraphicsStyle: number;
  floorCeilingStyle: number;
  /** y*width+x, raw square byte: type<<5 | hasObject<<4 | attr */
  raw: number[];
  /**
   * Teleporter squares (type 5) -> destination, by cell index (y*width+x).
   * `rot`/`relative` are the record's rotation bits (hypothesis: DM1 layout).
   */
  teleporters: Record<string, { map: number; x: number; y: number; rot: number; relative: boolean }>;
  /** The map's two door types (GRAPHICS.DAT category 14 items): header doorType0Index / doorType1Index. */
  doorTypes?: [number, number];
  /** Door squares -> door record type bit (0/1, selects `doorTypes`), by cell index. */
  doorKinds?: Record<string, number>;
}

export interface Dm2Bundle {
  start: { mapIndex: number; x: number; y: number; facing: number };
  maps: Dm2Map[];
}

export interface Pose4 { mapIndex: number; x: number; y: number; facing: number }

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const sqType = (raw: number) => (raw >> 5) & 7;
export const sqAttr = (raw: number) => raw & 15;

/** Door passage axis: attr bit 3 set => the door is crossed north-south (hypothesis, DM1 rule). */
export const doorIsNorthSouth = (raw: number) => (raw & 8) !== 0;
/** Door state (attr bits 0-2): 0 open ... 4 closed, 5 destroyed (DM1 rule, hypothesis for DM2). */
export const doorState = (raw: number) => raw & 7;

/** Mutable per-session door states, keyed by map index + cell. */
export class DoorStates {
  private m = new Map<string, number>();
  private key(map: Dm2Map, cell: number) { return `${map.index}:${cell}`; }
  get(map: Dm2Map, cell: number): number {
    return this.m.get(this.key(map, cell)) ?? doorState(map.raw[cell]!);
  }
  set(map: Dm2Map, cell: number, v: number) { this.m.set(this.key(map, cell), v); }
}

/** True when a door state lets the party through. */
export const doorPassable = (state: number) => state === 0 || state === 5;

export type Blocker = 'edge' | 'wall' | 'door-closed' | 'door-side' | 'stairs' | null;

/**
 * Effective solidity of cell (x,y) for a mover travelling in direction `dir`.
 * Returns null when the move is allowed. `stairs` is reported separately
 * because level changes are not implemented (needs the DM2 stairs rule).
 */
export function blocker(map: Dm2Map, doors: DoorStates, x: number, y: number, dir: number, noclip = false): Blocker {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return noclip ? null : 'edge';
  const cell = y * map.width + x;
  const raw = map.raw[cell]!;
  switch (sqType(raw)) {
    case SQ.WALL:
    case SQ.EMPTY:
      return noclip ? null : 'wall';
    case SQ.TRICKWALL:
      return noclip || (raw & 4) !== 0 ? null : 'wall';
    case SQ.DOOR: {
      if (noclip) return null;
      const ns = doorIsNorthSouth(raw);
      if (ns !== (dir === 0 || dir === 2)) return 'door-side';
      return doorPassable(doors.get(map, cell)) ? null : 'door-closed';
    }
    case SQ.STAIRS:
      return noclip ? null : 'stairs';
    default:
      return null; // floor, pit, teleporter: enterable
  }
}

export interface StepResult { moved: boolean; pose: Pose4; message?: string }

export function tryStep(map: Dm2Map, doors: DoorStates, pose: Pose4, dir: number, noclip = false): StepResult {
  const nx = pose.x + DX[dir]!;
  const ny = pose.y + DY[dir]!;
  const b = blocker(map, doors, nx, ny, dir, noclip);
  if (b === 'stairs') return { moved: false, pose, message: 'Stairs: level change not implemented (DM2 stairs rule undecoded).' };
  if (b) return { moved: false, pose };
  const raw = map.raw[ny * map.width + nx]!;
  const t = sqType(raw);
  if (t === SQ.TELEPORTER) {
    const tp = map.teleporters[ny * map.width + nx];
    if (tp) {
      const facing = tp.relative ? (pose.facing + tp.rot) & 3 : tp.rot;
      return { moved: true, pose: { mapIndex: tp.map, x: tp.x, y: tp.y, facing }, message: `Teleported to map ${tp.map} (${tp.x},${tp.y}).` };
    }
  }
  const message = t === SQ.PIT ? 'Pit square (falling not implemented).' : undefined;
  return { moved: true, pose: { ...pose, x: nx, y: ny }, message };
}

/** Does a ray of cell (x,y) edge-on direction `dir` hit a surface? Used by the placeholder renderer. */
export type Surface = 'none' | 'wall' | 'door' | 'doorOpen' | 'stairs';

/** What the mover standing in the gap sees when the *next* cell (x,y) is entered along `dir`. */
export function surfaceOf(map: Dm2Map, doors: DoorStates, x: number, y: number, dir: number): Surface {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 'wall';
  const cell = y * map.width + x;
  const raw = map.raw[cell]!;
  switch (sqType(raw)) {
    case SQ.WALL:
    case SQ.EMPTY:
      return 'wall';
    case SQ.TRICKWALL:
      return (raw & 4) !== 0 ? 'none' : 'wall';
    case SQ.DOOR: {
      const ns = doorIsNorthSouth(raw);
      if (ns !== (dir === 0 || dir === 2)) return 'wall'; // door frame side
      return doorPassable(doors.get(map, cell)) ? 'doorOpen' : 'door';
    }
    case SQ.STAIRS:
      return 'stairs';
    default:
      return 'none';
  }
}

/** Fallback start for a map with no start pose: first enterable cell with an open neighbour. */
export function fallbackPose(map: Dm2Map, doors: DoorStates): Pose4 {
  for (let i = 0; i < map.raw.length; i++) {
    const t = sqType(map.raw[i]!);
    if (t !== SQ.FLOOR) continue;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (let d = 0; d < 4; d++) {
      if (blocker(map, doors, x + DX[d]!, y + DY[d]!, d) === null) return { mapIndex: map.index, x, y, facing: d };
    }
  }
  return { mapIndex: map.index, x: 0, y: 0, facing: 0 };
}

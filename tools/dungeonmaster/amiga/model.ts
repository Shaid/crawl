/**
 * Dungeon Master / Chaos Strikes Back (Amiga) map model for the walker.
 *
 * Original code. The game rules come from the DM `KAOS.FTL` code block
 * (decompressed by `ftl.ts`; "K+0x...." = offset into it, "A5-0x...." = the
 * game's own data address):
 *
 *  - square aspect: K+0x6784 (`DmLevelView.aspect`)
 *  - square read, out of bounds = wall: K+0x5A44
 *  - map at another level by absolute position: K+0x5BA4 (`findMapAt`)
 *  - stairs exit facing: K+0x5C6A (`stairsExitDirection`)
 *  - party step: K+0x1CDF6 (`tryStep`); take stairs: K+0x1CCFC; pit fall
 *    loop inside move-thing K+0x18CBA (+0x18FA8)
 *
 * Not modelled (walker gaps): turning while standing on stairs takes them in
 * the game (K+0x1CD5C) but only turns in the walker; teleporters
 * (K+0x18E1E); creatures blocking the step (K+0x6CF4).
 *
 * Squares are normalised on import to per-cell faces (crawl's walker map
 * decision, `docs/walker-map-format-future-decision.md`); `deriveFaces` builds
 * them from the same passability rule the party-step routine uses.
 */
import { EL, DX, DY, type Aspect, type ViewMap } from './viewport.ts';

/** Square types (raw byte >> 5). */
export const SQ = { WALL: 0, CORRIDOR: 1, PIT: 2, STAIRS: 3, DOOR: 4, TELEPORTER: 5, FAKEWALL: 6, EMPTY: 7 } as const;

/** Per-edge face kinds, packed 4 bits per direction (N=bits 0-3, E=4-7, S=8-11, W=12-15). */
export const FACE = {
  /** passable both ways */
  OPEN: 0,
  /** a wall (or out-of-bounds, or a solid fake wall) on either side */
  SOLID: 1,
  /** the passage edge of a door square: passable when the door is open */
  DOOR: 2,
  /** the passage edge of a stairs square: crossing it into the stairs takes them */
  STAIRS: 3,
  /** the flank of a door/stairs square (walker policy, see `deriveFaces`) */
  SIDE: 4,
} as const;

export interface DmMapData {
  /** global map index (CSB Prison maps are offset by 100) */
  index: number;
  /** maps that share one dungeon (absolute coordinates / levels) */
  group: number;
  level: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  doorSets: [number, number];
  /** raw square bytes, row-major y*width+x */
  raw: number[];
  /** door square (y*width+x) -> door record info */
  doors: Record<string, { type: number; vertical: boolean }>;
  /** packed faces per cell (see `FACE`) */
  faces: number[];
}

export function faceOf(packed: number, dir: number): number {
  return (packed >> (4 * (dir & 3))) & 0xf;
}

/**
 * The square type the party-step routine acts on: a fake wall (type 6) is a
 * wall unless it is open (bit 2) or imaginary (bit 0) (K+0x1CF36), in which
 * case it is walked like a corridor. Everything else is its own type.
 */
export function effectiveType(raw: number): number {
  const t = (raw >> 5) & 7;
  if (t === SQ.FAKEWALL) return raw & 0x5 ? SQ.CORRIDOR : SQ.WALL;
  return t;
}

/** Passage axis of a door/stairs square: attribute bit 3 clear = east-west (K+0x5C86, K+0x6784). */
function onAxis(raw: number, dir: number): boolean {
  return ((raw >> 3) & 1) === 0 ? (dir & 1) === 1 : (dir & 1) === 0;
}

/**
 * Per-cell faces. SOLID when either side is impassable to the party-step test
 * (wall, solid fake wall, or outside the map: K+0x5A44 reads those as wall);
 * a door or stairs square's passage edges are DOOR / STAIRS (door wins where
 * the two meet); their flanks are SIDE. SIDE is a walker policy, not a game
 * rule: the game's step only tests the target square (K+0x1CF0A), but every
 * DM/CSB door and staircase is flanked by walls, so no shipped map has a SIDE
 * face.
 */
export function deriveFaces(width: number, height: number, raw: ArrayLike<number>): number[] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : raw[y * width + x]!);
  const faces = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = raw[y * width + x]!;
      let packed = 0;
      for (let d = 0; d < 4; d++) {
        const b = at(x + DX[d]!, y + DY[d]!);
        let f: number = FACE.OPEN;
        const solid = (r: number) => r < 0 || effectiveType(r) === SQ.WALL;
        const ta = effectiveType(a);
        const tb = b < 0 ? -1 : effectiveType(b);
        const special = (t: number) => t === SQ.DOOR || t === SQ.STAIRS;
        if (solid(a) || solid(b)) f = FACE.SOLID;
        else if ((special(ta) && !onAxis(a, d)) || (special(tb) && !onAxis(b, d))) f = FACE.SIDE;
        else if (ta === SQ.DOOR || tb === SQ.DOOR) f = FACE.DOOR;
        else if (ta === SQ.STAIRS || tb === SQ.STAIRS) f = FACE.STAIRS;
        packed |= f << (4 * d);
      }
      faces[y * width + x] = packed;
    }
  }
  return faces;
}

/** Door states (0 open .. 4 closed, 5 destroyed), defaulting to the square's attribute bits 0-2. */
export class DoorStates {
  private readonly m = new Map<string, number>();
  get(map: DmMapData, cell: number): number {
    return this.m.get(`${map.index}:${cell}`) ?? (map.raw[cell]! & 7);
  }
  set(map: DmMapData, cell: number, v: number): void {
    this.m.set(`${map.index}:${cell}`, v);
  }
}

const WALL_ASPECT: Aspect = { element: EL.WALL, stairsUp: false, doorState: 0, doorType: 0, doorVertical: false, pitInvisible: false };

/** One map as the compositor sees it (K+0x6784 element rules, door state from `DoorStates`). */
export class DmLevelView implements ViewMap {
  private readonly map: DmMapData;
  private readonly all: DmMapData[];
  private readonly doorStates: DoorStates;

  constructor(map: DmMapData, all: DmMapData[], doorStates: DoorStates) {
    this.map = map;
    this.all = all;
    this.doorStates = doorStates;
  }

  aspect(x: number, y: number, dir: number): Aspect {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return WALL_ASPECT;
    const cell = y * m.width + x;
    const raw = m.raw[cell]!;
    const a: Aspect = { ...WALL_ASPECT };
    const across = (dir & 1) === ((raw >> 3) & 1);
    switch ((raw >> 5) & 7) {
      case SQ.WALL:
        return a;
      case SQ.CORRIDOR:
        a.element = EL.CORRIDOR;
        return a;
      case SQ.PIT: // open (bit 3) pits are pits, closed ones corridor; bit 2 = invisible
        a.element = raw & 8 ? EL.PIT : EL.CORRIDOR;
        a.pitInvisible = (raw & 8) !== 0 && (raw & 4) !== 0;
        return a;
      case SQ.STAIRS:
        a.element = across ? EL.STAIRS_SIDE : EL.STAIRS_FRONT;
        a.stairsUp = (raw & 4) !== 0;
        return a;
      case SQ.DOOR: {
        a.element = across ? EL.DOOR_SIDE : EL.DOOR_FRONT;
        a.doorState = this.doorStates.get(m, cell);
        const d = m.doors[String(cell)];
        a.doorType = d?.type ?? 0;
        a.doorVertical = d?.vertical ?? false;
        return a;
      }
      case SQ.TELEPORTER: // drawn as a teleporter only when bits 3 and 2 are both set
        a.element = (raw & 0xc) === 0xc ? EL.TELEPORTER : EL.CORRIDOR;
        return a;
      case SQ.FAKEWALL: // a wall unless open (bit 2)
        a.element = raw & 4 ? EL.CORRIDOR : EL.WALL;
        return a;
      default:
        a.element = EL.CORRIDOR;
        return a;
    }
  }

  doorSet(doorType: number): number {
    return this.map.doorSets[doorType & 1];
  }

  ceilingPit(x: number, y: number): boolean {
    const up = findMapAt(this.all, this.map, -1, x, y);
    if (!up) return false;
    const raw = up.map.raw[up.y * up.map.width + up.x]!;
    return (raw >> 5) === SQ.PIT && (raw & 8) !== 0;
  }
}

/**
 * K+0x5BA4: the map one level `delta` away that contains `from`'s square
 * (x,y) at the same absolute dungeon position, searched in map order.
 */
export function findMapAt(all: DmMapData[], from: DmMapData, delta: number, x: number, y: number): { map: DmMapData; x: number; y: number } | null {
  const ax = x + from.offsetX;
  const ay = y + from.offsetY;
  const level = from.level + delta;
  for (const m of all) {
    if (m.group !== from.group || m.level !== level) continue;
    if (ax < m.offsetX || ax > m.offsetX + m.width - 1 || ay < m.offsetY || ay > m.offsetY + m.height - 1) continue;
    return { map: m, x: ax - m.offsetX, y: ay - m.offsetY };
  }
  return null;
}

/**
 * K+0x5C6A: the facing after arriving on a staircase. East-west stairs (bit 3
 * clear) face east unless the square east is a wall or stairs (then west);
 * north-south stairs face north unless the square north is (then south).
 */
export function stairsExitDirection(map: DmMapData, x: number, y: number): number {
  const raw = map.raw[y * map.width + x]!;
  const ew = ((raw >> 3) & 1) === 0;
  const nx = x + (ew ? 1 : 0);
  const ny = y + (ew ? 0 : -1);
  const n = nx < 0 || ny < 0 || nx >= map.width || ny >= map.height ? 0 : map.raw[ny * map.width + nx]!;
  const t = n >> 5;
  const blocked = t === SQ.WALL || t === SQ.STAIRS;
  return (blocked ? 2 : 0) + (ew ? 1 : 0);
}

export interface Pose4 {
  mapIndex: number;
  x: number;
  y: number;
  facing: number;
}

export interface MoveOutcome {
  moved: boolean;
  pose: Pose4;
  message?: string;
}

const byIndex = (all: DmMapData[], i: number) => all.find((m) => m.index === i);

/** K+0x1CCFC: take the stairs the party stands on (same absolute square, one level up/down). */
function takeStairs(all: DmMapData[], map: DmMapData, x: number, y: number, fallback: Pose4): MoveOutcome {
  const raw = map.raw[y * map.width + x]!;
  const up = (raw & 4) !== 0;
  const dest = findMapAt(all, map, up ? -1 : 1, x, y);
  if (!dest) return { moved: false, pose: fallback, message: 'These stairs lead nowhere.' };
  return {
    moved: true,
    pose: { mapIndex: dest.map.index, x: dest.x, y: dest.y, facing: stairsExitDirection(dest.map, dest.x, dest.y) },
    message: up ? 'You climb the stairs.' : 'You descend the stairs.',
  };
}

/** Doors the party walks through: open, the first raised state, or destroyed (K+0x1CF1A). */
function doorPassable(state: number): boolean {
  return state === 0 || state === 1 || state === 5;
}

/**
 * K+0x18FA8: an open (bit 3), non-imaginary (bit 0 clear) pit drops the party
 * to the same absolute square one level down, repeatedly (the move routine's
 * 100-iteration loop); facing is kept.
 */
function fall(all: DmMapData[], pose: Pose4): { pose: Pose4; fell: boolean } {
  let p = pose;
  let fell = false;
  for (let i = 0; i < 100; i++) {
    const m = byIndex(all, p.mapIndex)!;
    const raw = m.raw[p.y * m.width + p.x]!;
    if ((raw >> 5) !== SQ.PIT || (raw & 8) === 0 || (raw & 1) !== 0) break;
    const below = findMapAt(all, m, 1, p.x, p.y);
    if (!below) break;
    p = { mapIndex: below.map.index, x: below.x, y: below.y, facing: p.facing };
    fell = true;
  }
  return { pose: p, fell };
}

/**
 * One party step in absolute direction `d` (K+0x1CDF6). Standing on stairs
 * and stepping backward takes them; stepping onto stairs takes them; walls
 * and closed doors block (see `deriveFaces`); open pits drop the party.
 * Teleporters and creatures are not modelled (`dm1-teleporters`).
 */
export function tryStep(all: DmMapData[], doorStates: DoorStates, pose: Pose4, d: number, noclip = false): MoveOutcome {
  const map = byIndex(all, pose.mapIndex);
  if (!map) return { moved: false, pose };
  const here = map.raw[pose.y * map.width + pose.x]!;
  if (!noclip && (here >> 5) === SQ.STAIRS && ((d - pose.facing) & 3) === 2) return takeStairs(all, map, pose.x, pose.y, pose);
  const nx = pose.x + DX[d & 3]!;
  const ny = pose.y + DY[d & 3]!;
  if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return { moved: false, pose };
  const next: Pose4 = { mapIndex: map.index, x: nx, y: ny, facing: pose.facing };
  if (noclip) return { moved: true, pose: next };
  const face = faceOf(map.faces[pose.y * map.width + pose.x]!, d);
  if (face === FACE.SOLID || face === FACE.SIDE) return { moved: false, pose, message: 'A wall blocks the way.' };
  const target = map.raw[ny * map.width + nx]!;
  if (face === FACE.DOOR) {
    const cell = (target >> 5) === SQ.DOOR ? ny * map.width + nx : pose.y * map.width + pose.x;
    if (!doorPassable(doorStates.get(map, cell))) return { moved: false, pose, message: 'The door is closed (press F facing it to open).' };
  }
  if ((target >> 5) === SQ.STAIRS) return takeStairs(all, map, nx, ny, pose);
  const f = fall(all, next);
  return f.fell ? { moved: true, pose: f.pose, message: 'You fall through a pit!' } : { moved: true, pose: next };
}

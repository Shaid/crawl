/**
 * Zombi (Amiga) map model: `plan` (6 floors x 7 rows x 8 cols of location ids)
 * + `i-lieux` (90 x 50-B location records) -> per-cell faces, plus the game's
 * own movement rule.
 *
 * Everything about movement below is read from the executable, not guessed
 * (`zombi` hunk S_0, file-relative offsets; docs/zombi/amiga/data-structure.md
 * § "Movement and compass (confirmed from code)"):
 *   - the in-memory plan is indexed [floor][row][col], 1-based with a zero
 *     border, strides 72/9/1 (`+0x0584`, `+0x6510`);
 *   - the four arrow rectangles live at `A4+0x4C0` (screen coordinates) and the
 *     click dispatcher at `+0x7486` maps rect 1 (left) -> move(1), rect 2
 *     (right) -> move(0), rect 3 (top) -> move(3), rect 4 (bottom) -> move(2);
 *   - `move(dir)` = `+0x6254`: dir 0 col+1 / exit byte 1, dir 1 col-1 / byte 3,
 *     dir 2 row+1 / byte 0, dir 3 row-1 / byte 2;
 *   - a move goes through only for exit value 0x00 or 0x14 (`+0x6470` table);
 *     for dir 2/3 any other value (blocked 0x0A, F0, 1E, ...) falls back to a
 *     vertical move: top arrow -> floor+1 via byte 5, bottom arrow -> floor-1
 *     via byte 4 (`+0x63d8` / `+0x6350`).
 */

export const FLOORS = 6;
export const ROWS = 7;
export const COLS = 8;
export const RECORD_SIZE = 50;
export const LOCATIONS = 90;

/** Exit-face kinds (value -> meaning as far as the move code distinguishes them). */
export type FaceKind = 'open' | 'door' | 'blocked' | 'edge' | 'special' | 'unknown';

export function faceKind(v: number): FaceKind {
  switch (v) {
    case 0x00: return 'open';
    case 0x14: return 'door'; // `+0x6470` handles 0x14 exactly like 0x00
    case 0x0a: return 'blocked';
    case 0xfe: return 'edge'; // `+0x66aa`: event 5 (the horde picture, frame 80)
    case 0xfa: return 'special'; // `+0x6552`: id 46 only
    default: return 'unknown'; // F0 (ids 36/39), 1E (id 59): fall to the "blocked" branch
  }
}

/** True for the values `move()` lets through (`+0x6470` -> `+0x6490`). */
export function faceIsPassable(v: number): boolean {
  return v === 0x00 || v === 0x14;
}

/** Arrow / screen directions. `top` = rect 3 = move(3) = row-1 = exit byte 2, etc. */
export type Arrow = 'top' | 'right' | 'bottom' | 'left';
/** Facing index used by the walker harness: 0=N(top) 1=E(right) 2=S(bottom) 3=W(left). Compass names are a convention (N = screen-up). */
export const ARROWS: Arrow[] = ['top', 'right', 'bottom', 'left'];
/** Exit byte of the location record for each arrow (confirmed). */
export const ARROW_EXIT_BYTE: Record<Arrow, number> = { top: 2, right: 1, bottom: 0, left: 3 };
/** (dRow, dCol) of each arrow (confirmed: `move()` deltas). */
export const ARROW_DELTA: Record<Arrow, [number, number]> = { top: [-1, 0], right: [0, 1], bottom: [1, 0], left: [0, -1] };

export interface LieuxRecord {
  id: number;
  /** Bytes 0..5: exits [row+1, col+1, row-1, col-1, floor-1, floor+1]. */
  exits: number[];
  /** Byte 6 (0/1/2) — `+0x6(rec)` is tested by the zombie/light code, meaning unconfirmed. */
  b6: number;
  /** Byte 7: area/lighting class (`+0x130e` selects the lighting state from it). */
  flags: number;
  /** Byte 9: picture override (1-based LIEUX.SEQ picture), 0 = none. */
  pictureOverride: number;
  /** Bytes 10..49: 4 rows x 10 columns of object slots (item grid over the picture). */
  slots: number[];
}

export function parseLieux(b: Uint8Array): LieuxRecord[] {
  if (b.length !== LOCATIONS * RECORD_SIZE) throw new Error(`i-lieux: ${b.length} B, expected ${LOCATIONS * RECORD_SIZE}`);
  const out: LieuxRecord[] = [];
  for (let i = 0; i < LOCATIONS; i++) {
    const o = i * RECORD_SIZE;
    out.push({
      id: i + 1,
      exits: Array.from(b.subarray(o, o + 6)),
      b6: b[o + 6],
      flags: b[o + 7],
      pictureOverride: b[o + 9],
      slots: Array.from(b.subarray(o + 10, o + 50)),
    });
  }
  return out;
}

/** `plan`: 336 B = 6 floors x 7 rows x 8 cols. Returns `plan[floor][row][col]` (0 = empty). */
export function parsePlan(b: Uint8Array): number[][][] {
  if (b.length !== FLOORS * ROWS * COLS) throw new Error(`plan: ${b.length} B, expected ${FLOORS * ROWS * COLS}`);
  const plan: number[][][] = [];
  for (let f = 0; f < FLOORS; f++) {
    const rows: number[][] = [];
    for (let r = 0; r < ROWS; r++) rows.push(Array.from(b.subarray((f * ROWS + r) * COLS, (f * ROWS + r + 1) * COLS)));
    plan.push(rows);
  }
  return plan;
}

export interface ZombiFace { raw: number; kind: FaceKind }
export interface ZombiCell {
  id: number;
  /** Faces keyed by compass name with N = screen-up (top arrow). */
  faces: { n: ZombiFace; e: ZombiFace; s: ZombiFace; w: ZombiFace; up: ZombiFace; down: ZombiFace };
  picture: { frame: number; ox: number; oy: number };
  flags: number;
  b6: number;
  slots: number[];
}
export interface ZombiLevel { id: number; name: string; width: number; height: number; cells: (ZombiCell | null)[] }
export interface ZombiMap {
  version: 1;
  game: 'zombi';
  source: string;
  /** Row 0 is the top of the grid as the game's arrow geometry has it (top arrow = row-1). */
  orientation: string;
  levels: ZombiLevel[];
}

const FLOOR_NAMES = ['Basement', 'Ground floor / car park', 'Level 1', 'Level 2', 'Escalator top', 'Roof'];

export interface PictureInfo { frame: number; ox: number; oy: number }

export function buildMap(plan: number[][][], recs: LieuxRecord[], pictureOf: (id: number) => PictureInfo): ZombiMap {
  const face = (v: number): ZombiFace => ({ raw: v, kind: faceKind(v) });
  const levels: ZombiLevel[] = plan.map((rows, f) => ({
    id: f,
    name: FLOOR_NAMES[f] ?? `Floor ${f}`,
    width: rows[0].length,
    height: rows.length,
    cells: rows.flatMap((row) => row.map((id): ZombiCell | null => {
      if (!id) return null;
      const r = recs[id - 1];
      return {
        id,
        faces: { n: face(r.exits[2]), e: face(r.exits[1]), s: face(r.exits[0]), w: face(r.exits[3]), up: face(r.exits[5]), down: face(r.exits[4]) },
        picture: pictureOf(id),
        flags: r.flags,
        b6: r.b6,
        slots: r.slots,
      };
    })),
  }));
  return {
    version: 1,
    game: 'zombi',
    source: 'plan + i-lieux (tools/zombi/amiga/map.ts)',
    orientation: 'cell(x=col, y=row), row 0 at the top; n = top arrow = row-1 = exit byte 2; e = right arrow = col+1 = byte 1; s = bottom arrow = row+1 = byte 0; w = left arrow = col-1 = byte 3; up = floor+1 = byte 5; down = floor-1 = byte 4. Screen directions confirmed from the click dispatcher; the compass NAMES are a convention.',
    levels,
  };
}

export interface Pos { level: number; x: number; y: number }
export type MoveOutcome =
  | { ok: true; to: Pos; via: Arrow | 'up' | 'down'; fellBackVertical: boolean }
  | { ok: false; reason: 'blocked' | 'edge' | 'special' | 'no-cell'; value: number };

function cellAt(map: ZombiMap, p: Pos): ZombiCell | null {
  const lv = map.levels[p.level];
  if (!lv || p.x < 0 || p.y < 0 || p.x >= lv.width || p.y >= lv.height) return null;
  return lv.cells[p.y * lv.width + p.x];
}
export { cellAt };

const FACE_OF: Record<Arrow, 'n' | 'e' | 's' | 'w'> = { top: 'n', right: 'e', bottom: 's', left: 'w' };

/**
 * The game's `move(dir)` (`+0x6254`), by arrow. `noclip` ignores exit values
 * and moves to the geometric neighbour if one exists.
 */
export function moveArrow(map: ZombiMap, p: Pos, arrow: Arrow, noclip = false): MoveOutcome {
  const here = cellAt(map, p);
  if (!here) return { ok: false, reason: 'no-cell', value: -1 };
  const [dr, dc] = ARROW_DELTA[arrow];
  const to: Pos = { level: p.level, x: p.x + dc, y: p.y + dr };
  const f = here.faces[FACE_OF[arrow]];
  if (noclip) return cellAt(map, to) ? { ok: true, to, via: arrow, fellBackVertical: false } : { ok: false, reason: 'no-cell', value: f.raw };
  if (faceIsPassable(f.raw)) {
    return cellAt(map, to) ? { ok: true, to, via: arrow, fellBackVertical: false } : { ok: false, reason: 'no-cell', value: f.raw };
  }
  if (f.kind === 'edge') return { ok: false, reason: 'edge', value: f.raw };
  if (f.kind === 'special') return { ok: false, reason: 'special', value: f.raw };
  // Vertical fallback exists only for the top/bottom arrows (`+0x63d8` / `+0x6350`).
  if (arrow === 'top') return moveVertical(map, p, 'up', true);
  if (arrow === 'bottom') return moveVertical(map, p, 'down', true);
  return { ok: false, reason: 'blocked', value: f.raw };
}

/** Stairs / shaft: floor+1 (byte 5) or floor-1 (byte 4), same (row, col) — 6/6 links verified. */
export function moveVertical(map: ZombiMap, p: Pos, dir: 'up' | 'down', fell = false, noclip = false): MoveOutcome {
  const here = cellAt(map, p);
  if (!here) return { ok: false, reason: 'no-cell', value: -1 };
  const f = here.faces[dir];
  const to: Pos = { level: p.level + (dir === 'up' ? 1 : -1), x: p.x, y: p.y };
  if (!noclip && !faceIsPassable(f.raw)) return { ok: false, reason: 'blocked', value: f.raw };
  return cellAt(map, to) ? { ok: true, to, via: dir, fellBackVertical: fell } : { ok: false, reason: 'no-cell', value: f.raw };
}

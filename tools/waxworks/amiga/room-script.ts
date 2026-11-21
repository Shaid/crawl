/**
 * Static evaluator for a Waxworks room subroutine: "which picture does this
 * room show for facing F?". Original code; ScummVM's `script.cpp`
 * (`runScript`, `o_eq`, `o_let` ...) was read as a behaviour oracle only.
 *
 * Execution model (confirmed by the 1,450 `picture` ops of the 360 maze
 * rooms resolving to exactly one picture per facing on 98%+ of rooms): a
 * subroutine is a list of lines; each line runs its ops in order and a
 * condition op that fails ends *that line*; opcode 0 inverts the following
 * condition; `done` ends the whole subroutine. Variable 150 holds the
 * player's facing (0..3); the turn subroutines 24/25 do `b150 += 1 / 3`,
 * `op51 b150 4` (= mod 4), then `process 7` (redraw the room) -- see
 * docs/waxworks/amiga/data-structure.md §7.
 */
import type { AgosItem, Operand, ScriptOp, Subroutine } from '../../shared/agos-gamepc.ts';

export const VAR_FACING = 150;

/**
 * Super-room (Elvira II grid maze) state for the optional extended op set.
 * Absent for ordinary rooms, in which case none of the extended ops below is
 * interpreted (Waxworks / room behaviour unchanged).
 */
export interface SuperRoomGrid {
  x: number;
  y: number;
  z: number;
  /** 2 bits per direction (N E S W up down), index = (z*y + row)*x + col. */
  states: number[];
}
export interface SuperRoomEnv {
  /** Item id of the super-room the player is in (the game's special item -9). */
  current: number;
  grids: Map<number, SuperRoomGrid>;
  /** Player cell index (`165` sets it, `166` reads it into a variable). */
  pos: number;
  /** Subroutines reachable by `process` (op 71). */
  subs: Map<number, Subroutine>;
  depth: number;
}

export interface RoomEvalEnv {
  items: Map<number, AgosItem>;
  vars: Map<number, number>;
  bits: Set<number>;
  bits2: Set<number>;
  sr?: SuperRoomEnv;
}

/**
 * Door state (0 none, 1 open, 2 closed, 3 locked) of direction `dir` of script
 * cell number `cell` in a super-room grid; 0 outside it. **Script cell
 * numbers are 1-based**: cell n is `states[n - 1]` (all 22 doorway cells of the
 * 760 maze are non-empty only under that offset, docs/elvira2/amiga/data-structure.md section 6).
 */
export function gridDoorState(g: SuperRoomGrid, cell: number, dir: number): number {
  const i = cell - 1;
  if (i < 0 || i >= g.states.length) return 0;
  return (g.states[i] >> (dir * 2)) & 3;
}

export interface PictureCall {
  /** VC script id (zone = id/100). */
  id: number;
  /** Window mode argument; 4 = the main scene window. */
  mode: number;
  /** Script variables / flag bits at the moment of the call (the VC script reads the same arrays). */
  vars: Map<number, number>;
  bits: Set<number>;
}

export interface RoomEvalResult {
  pictures: PictureCall[];
  /** Ops that would have needed game state this static evaluator does not model (each aborts its line). */
  unmodelled: Set<number>;
  /** True when an unmodelled condition aborted a line that contained a `picture` op. */
  gatedPicture: boolean;
}

const OP = {
  invert: 0,
  zero: 11,
  notZero: 12,
  eq: 13,
  notEq: 14,
  gt: 15,
  lt: 16,
  eqf: 17,
  notEqf: 18,
  ltf: 19,
  gtf: 20,
  clear: 41,
  let: 42,
  add: 43,
  sub: 44,
  addf: 45,
  subf: 46,
  mod: 51,
  inc: 59,
  dec: 60,
  state: 27,
  done: 69,
  picture: 96,
  bSet: 153,
  bClear: 154,
  bZero: 155,
  bNotZero: 156,
  b2Set: 180,
  b2Clear: 181,
  b2Zero: 182,
  b2NotZero: 183,
};
const CONDITION_OPS = new Set([1, 2, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25, 26, 28, 29, 76, 77, 78, 79, 80, 115, 125, 148, 149, 150, 179]);

/** `getVarOrWord`: words 30000..30511 name a variable. */
function wordValue(a: Operand, env: RoomEvalEnv): number {
  const v = a.v;
  if (v >= 30000 && v < 30512) return env.vars.get(v - 30000) ?? 0;
  return v > 0x7fff ? v - 0x10000 : v;
}
/** `getVarOrByte`: an 0xFF escape means "value of variable xx". */
function byteValue(a: Operand, env: RoomEvalEnv): number {
  return a.v >= 0xff00 ? (env.vars.get(a.v & 0xff) ?? 0) : a.v;
}
/** Variable-reference operand: an 0xFF escape means "the variable whose number is in variable xx". */
function varIndex(a: Operand, env: RoomEvalEnv): number {
  return a.v >= 0xff00 ? (env.vars.get(a.v & 0xff) ?? 0) : a.v;
}
/** Bit operand (byte, escape = indirect). */
const bitIndex = byteValue;

/** Run `sub` once against `env` (mutates env.vars/bits), collecting picture calls. */
export function runRoomSubroutine(sub: Subroutine, env: RoomEvalEnv): RoomEvalResult {
  const res: RoomEvalResult = { pictures: [], unmodelled: new Set(), gatedPicture: false };
  for (const line of sub.lines) {
    const pending: PictureCall[] = [];
    let invert = false;
    let aborted = false;
    let stop = false;
    const hasPicture = line.ops.some((o) => o.op === OP.picture);
    for (const o of line.ops) {
      if (o.op === OP.invert) {
        invert = true;
        continue;
      }
      let cond = true;
      const a = o.args;
      const ext = env.sr ? superRoomOp(o, env, env.sr, (nested) => {
        pending.push(...nested.pictures);
        nested.unmodelled.forEach((u) => res.unmodelled.add(u));
      }) : undefined;
      if (ext !== undefined) {
        cond = ext;
      } else
      switch (o.op) {
        case OP.zero:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) === 0;
          break;
        case OP.notZero:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) !== 0;
          break;
        case OP.eq:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) === wordValue(a[1], env);
          break;
        case OP.notEq:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) !== wordValue(a[1], env);
          break;
        case OP.gt:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) > wordValue(a[1], env);
          break;
        case OP.lt:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) < wordValue(a[1], env);
          break;
        case OP.eqf:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) === (env.vars.get(varIndex(a[1], env)) ?? 0);
          break;
        case OP.notEqf:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) !== (env.vars.get(varIndex(a[1], env)) ?? 0);
          break;
        case OP.ltf:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) < (env.vars.get(varIndex(a[1], env)) ?? 0);
          break;
        case OP.gtf:
          cond = (env.vars.get(varIndex(a[0], env)) ?? 0) > (env.vars.get(varIndex(a[1], env)) ?? 0);
          break;
        case OP.bZero:
          cond = !env.bits.has(bitIndex(a[0], env));
          break;
        case OP.bNotZero:
          cond = env.bits.has(bitIndex(a[0], env));
          break;
        case OP.b2Zero:
          cond = !env.bits2.has(bitIndex(a[0], env));
          break;
        case OP.b2NotZero:
          cond = env.bits2.has(bitIndex(a[0], env));
          break;
        case OP.state: {
          const item = a[0].v > 0 ? env.items.get(a[0].v) : undefined;
          if (item) cond = item.state === wordValue(a[1], env);
          else {
            res.unmodelled.add(o.op);
            cond = false;
          }
          break;
        }
        case OP.clear:
          env.vars.set(varIndex(a[0], env), 0);
          break;
        case OP.let:
          env.vars.set(varIndex(a[0], env), wordValue(a[1], env));
          break;
        case OP.add:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) + wordValue(a[1], env));
          break;
        case OP.sub:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) - wordValue(a[1], env));
          break;
        case OP.addf:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) + (env.vars.get(varIndex(a[1], env)) ?? 0));
          break;
        case OP.subf:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) - (env.vars.get(varIndex(a[1], env)) ?? 0));
          break;
        case OP.mod: {
          const m = wordValue(a[1], env);
          if (m !== 0) env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) % m);
          break;
        }
        case OP.inc:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) + 1);
          break;
        case OP.dec:
          env.vars.set(varIndex(a[0], env), (env.vars.get(varIndex(a[0], env)) ?? 0) - 1);
          break;
        case OP.bSet:
          env.bits.add(bitIndex(a[0], env));
          break;
        case OP.bClear:
          env.bits.delete(bitIndex(a[0], env));
          break;
        case OP.b2Set:
          env.bits2.add(bitIndex(a[0], env));
          break;
        case OP.b2Clear:
          env.bits2.delete(bitIndex(a[0], env));
          break;
        case OP.picture:
          pending.push({ id: wordValue(a[0], env), mode: byteValue(a[1], env), vars: new Map(env.vars), bits: new Set(env.bits) });
          break;
        case OP.done:
          stop = true;
          break;
        default:
          if (CONDITION_OPS.has(o.op)) {
            res.unmodelled.add(o.op);
            cond = false;
          }
          break;
      }
      const ok = cond !== invert; // the game loops while (condition != invertFlag)
      invert = false;
      if (!ok) {
        aborted = true;
        break;
      }
      if (stop) break;
    }
    if (aborted) {
      if (hasPicture && [...res.unmodelled].length > 0 && pending.length === 0) res.gatedPicture = true;
      continue;
    }
    res.pictures.push(...pending);
    if (stop) break;
  }
  return res;
}

/**
 * Evaluate a room subroutine for a facing: returns the last picture drawn
 * into window 4 (the game redraws the whole window per `picture`, so the
 * last one wins).
 */
export function roomPictureFor(sub: Subroutine, items: Map<number, AgosItem>, facing: number): { id: number | null; call: PictureCall | null; result: RoomEvalResult } {
  const env: RoomEvalEnv = { items, vars: new Map([[VAR_FACING, facing]]), bits: new Set(), bits2: new Set() };
  const result = runRoomSubroutine(sub, env);
  const main = result.pictures.filter((p) => p.mode === 4);
  const call = main.length ? main[main.length - 1] : null;
  return { id: call ? call.id : null, call, result };
}

/**
 * Extended ops for the super-room maze scripts (Elvira II sub 1300/1499
 * family). Returns the condition value for ops it handles (`true` for
 * actions), `undefined` for everything else. Semantics were inferred from how
 * the shipped scripts use the ops, then checked against the grid data:
 * 36 copies variable a into b (`36 b150 b6` then `43 b6 1` = facing+1),
 * 47..50/52 are mul/div/mulf/divf/modf, 165 sets the player cell, 166 reads it
 * into a variable, 71 runs a subroutine, 171/172/173 test the door state
 * (1 open / 2 closed / 3 locked) of a direction of a cell, and `80 (-9, item)`
 * asks whether the player is in that super-room.
 */
function superRoomOp(o: ScriptOp, env: RoomEvalEnv, sr: SuperRoomEnv, merge: (r: RoomEvalResult) => void): boolean | undefined {
  const a = o.args;
  const get = (n: number) => env.vars.get(n) ?? 0;
  switch (o.op) {
    case 36:
      env.vars.set(varIndex(a[1], env), get(varIndex(a[0], env)));
      return true;
    case 47:
      env.vars.set(varIndex(a[0], env), get(varIndex(a[0], env)) * wordValue(a[1], env));
      return true;
    case 48: {
      const m = wordValue(a[1], env);
      if (m !== 0) env.vars.set(varIndex(a[0], env), Math.trunc(get(varIndex(a[0], env)) / m));
      return true;
    }
    case 49:
      env.vars.set(varIndex(a[0], env), get(varIndex(a[0], env)) * get(varIndex(a[1], env)));
      return true;
    case 50: {
      const m = get(varIndex(a[1], env));
      if (m !== 0) env.vars.set(varIndex(a[0], env), Math.trunc(get(varIndex(a[0], env)) / m));
      return true;
    }
    case 52: {
      const m = get(varIndex(a[1], env));
      if (m !== 0) env.vars.set(varIndex(a[0], env), get(varIndex(a[0], env)) % m);
      return true;
    }
    case 165:
      sr.pos = wordValue(a[0], env);
      return true;
    case 166:
      env.vars.set(varIndex(a[0], env), sr.pos);
      return true;
    case 171:
    case 172:
    case 173: {
      const item = a[0].v > 0 ? a[0].v : sr.current;
      const g = sr.grids.get(item);
      if (!g) return false;
      return gridDoorState(g, wordValue(a[1], env), byteValue(a[2], env)) === o.op - 170;
    }
    case 80:
      if (a[0].v === -9 && a[1].v > 0) return sr.current === a[1].v;
      if (a[1].v === -9 && a[0].v > 0) return sr.current === a[0].v;
      return undefined;
    case 71: {
      const sub = sr.subs.get(wordValue(a[0], env));
      if (sub && sr.depth < 24) {
        sr.depth++;
        try {
          merge(runRoomSubroutine(sub, env));
        } finally {
          sr.depth--;
        }
      }
      return true;
    }
    default:
      return undefined;
  }
}

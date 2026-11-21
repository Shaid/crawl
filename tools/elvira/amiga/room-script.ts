/**
 * Static evaluator for an Elvira 1 room script: "which picture does the scene
 * window show in room R facing F?". Original code written against the
 * game's own scripts (`gameamiga`, parsed by `tools/shared/agos-gamepc.ts`,
 * variant `elvira1`) and the operand grammar read from `runit`; ScummVM's
 * `script_e1.cpp`/`script.cpp` were consulted as a behaviour oracle only
 * (GPL, nothing copied) to name the opcodes.
 *
 * Mechanism (confirmed in the scripts themselves): subroutine 9 -- run on every
 * room entry/turn after subroutine 5 -- reads user flag 0 of the player's
 * parent item (`copyof i-9 b0 v50; add v50 1000; process v50`), so a room's
 * scene subroutine is `1000 + userflags[0]`; those subroutines branch on the
 * facing variable v150 (0, 2, 4, 6) and run `picture <VC script> <window 4>`.
 *
 * Opcode numbers are the table index in `runit` (opcode 203 is the invert
 * prefix; a line ends at the 10000 word, handled by the reader).
 */
import type { AgosItem, Operand, Subroutine } from '../../shared/agos-gamepc.ts';

export const VAR_FACING = 150;
/** Facing values (v150) in turn order; the game's `moveDirn` direction for each (subroutine 4: 0->0, 2->3, 4->2, 6->1). */
export const FACINGS = [0, 2, 4, 6] as const;
export const FACING_TO_DIR: Record<number, number> = { 0: 0, 2: 3, 4: 2, 6: 1 };

export const E1_OP = {
  at: 0,
  notAt: 1,
  present: 2,
  notPresent: 3,
  carried: 6,
  zero: 12,
  notZero: 13,
  eq: 14,
  notEq: 15,
  gt: 16,
  lt: 17,
  eqf: 18,
  notEqf: 19,
  ltf: 20,
  gtf: 21,
  state: 34,
  setFF: 60,
  clear: 61,
  copyff: 56,
  let: 64,
  add: 65,
  sub: 66,
  addf: 67,
  subf: 68,
  mul: 69,
  div: 70,
  mod: 73,
  setState: 87,
  done: 98,
  process: 105,
  invert: 203,
  picture: 224,
  here: 261,
  bitClear: 251,
  bitSet: 252,
  bitTest: 253,
};
/** Condition opcodes (they set the script condition); unhandled ones abort the line and are reported. */
const CONDITION_OPS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 29, 30, 32, 33, 34, 36, 37, 128, 129, 135, 136, 162, 243, 253, 260, 261, 283]);

export interface PictureCall {
  id: number;
  mode: number;
  vars: Map<number, number>;
}
export interface RoomEvalResult {
  pictures: PictureCall[];
  unmodelled: Set<number>;
  /** An unmodelled condition aborted a line that contained a `picture`. */
  gatedPicture: boolean;
}
export interface RoomEvalEnv {
  items: Map<number, AgosItem>;
  subs: Map<number, Subroutine>;
  /** Player's parent item (the room). */
  room: number;
  vars: Map<number, number>;
  /** Mutable copy of item states. */
  states: Map<number, number>;
  depth: number;
}

function word(a: Operand, env: RoomEvalEnv): number {
  const v = a.v;
  if (v >= 30000 && v < 30512) return env.vars.get(v - 30000) ?? 0;
  return v > 0x7fff ? v - 0x10000 : v;
}
const V = (env: RoomEvalEnv, a: Operand) => env.vars.get(a.v >= 30000 ? a.v - 30000 : a.v) ?? 0;
const setV = (env: RoomEvalEnv, a: Operand, val: number) => env.vars.set(a.v >= 30000 ? a.v - 30000 : a.v, val);

function itemOf(a: Operand, env: RoomEvalEnv): number {
  if (a.v > 0) return a.v;
  if (a.v === -9) return env.room;
  return 0; // -1 subject, -3 object, -5 player, -7 actor: not modelled
}

export function runRoomSubroutine(sub: Subroutine, env: RoomEvalEnv, res: RoomEvalResult = { pictures: [], unmodelled: new Set(), gatedPicture: false }): RoomEvalResult {
  let stop = false;
  for (const line of sub.lines) {
    const pending: PictureCall[] = [];
    const hasPicture = line.ops.some((o) => o.op === E1_OP.picture);
    let invert = false;
    let aborted = false;
    for (const o of line.ops) {
      if (o.op === E1_OP.invert) {
        invert = true;
        continue;
      }
      const a = o.args;
      let cond = true;
      switch (o.op) {
        case E1_OP.at:
          cond = itemOf(a[0], env) === env.room && a[0].v !== -5;
          break;
        case E1_OP.notAt:
          cond = itemOf(a[0], env) !== env.room;
          break;
        case E1_OP.here: {
          const it = a[0].v > 0 ? env.items.get(a[0].v) : undefined;
          cond = !!it && it.parent === env.room;
          break;
        }
        case E1_OP.zero:
          cond = V(env, a[0]) === 0;
          break;
        case E1_OP.notZero:
          cond = V(env, a[0]) !== 0;
          break;
        case E1_OP.eq:
          cond = V(env, a[0]) === word(a[1], env);
          break;
        case E1_OP.notEq:
          cond = V(env, a[0]) !== word(a[1], env);
          break;
        case E1_OP.gt:
          cond = V(env, a[0]) > word(a[1], env);
          break;
        case E1_OP.lt:
          cond = V(env, a[0]) < word(a[1], env);
          break;
        case E1_OP.eqf:
          cond = V(env, a[0]) === V(env, a[1]);
          break;
        case E1_OP.notEqf:
          cond = V(env, a[0]) !== V(env, a[1]);
          break;
        case E1_OP.ltf:
          cond = V(env, a[0]) < V(env, a[1]);
          break;
        case E1_OP.gtf:
          cond = V(env, a[0]) > V(env, a[1]);
          break;
        case E1_OP.state: {
          const id = itemOf(a[0], env);
          const it = id ? env.items.get(id) : undefined;
          if (it) cond = (env.states.get(id) ?? it.state) === word(a[1], env);
          else {
            res.unmodelled.add(o.op);
            cond = false;
          }
          break;
        }
        case E1_OP.bitTest:
          cond = ((V(env, a[0]) >> word(a[1], env)) & 1) === 1;
          break;
        case E1_OP.setFF:
          setV(env, a[0], 255);
          break;
        case E1_OP.clear:
          setV(env, a[0], 0);
          break;
        case E1_OP.copyff:
          setV(env, a[0], V(env, a[1]));
          break;
        case E1_OP.let:
          setV(env, a[0], word(a[1], env));
          break;
        case E1_OP.add:
          setV(env, a[0], V(env, a[0]) + word(a[1], env));
          break;
        case E1_OP.sub:
          setV(env, a[0], V(env, a[0]) - word(a[1], env));
          break;
        case E1_OP.addf:
          setV(env, a[0], V(env, a[0]) + V(env, a[1]));
          break;
        case E1_OP.subf:
          setV(env, a[0], V(env, a[0]) - V(env, a[1]));
          break;
        case E1_OP.mul:
          setV(env, a[0], V(env, a[0]) * word(a[1], env));
          break;
        case E1_OP.div: {
          const m = word(a[1], env);
          if (m) setV(env, a[0], Math.trunc(V(env, a[0]) / m));
          break;
        }
        case E1_OP.mod: {
          const m = word(a[1], env);
          if (m) setV(env, a[0], V(env, a[0]) % m);
          break;
        }
        case E1_OP.bitSet:
          setV(env, a[0], V(env, a[0]) | (1 << word(a[1], env)));
          break;
        case E1_OP.bitClear:
          setV(env, a[0], V(env, a[0]) & ~(1 << word(a[1], env)));
          break;
        case E1_OP.setState: {
          const id = itemOf(a[0], env);
          if (id) env.states.set(id, word(a[1], env));
          break;
        }
        case E1_OP.picture:
          pending.push({ id: word(a[0], env), mode: word(a[1], env), vars: new Map(env.vars) });
          break;
        case E1_OP.process: {
          const s = env.subs.get(word(a[0], env));
          if (s && env.depth < 12) {
            env.depth++;
            try {
              const nested = runRoomSubroutine(s, env);
              pending.push(...nested.pictures);
              nested.unmodelled.forEach((u) => res.unmodelled.add(u));
              if (nested.gatedPicture) res.gatedPicture = true;
            } finally {
              env.depth--;
            }
          }
          break;
        }
        case E1_OP.done:
          stop = true;
          break;
        default:
          if (CONDITION_OPS.has(o.op)) {
            res.unmodelled.add(o.op);
            cond = false;
          }
      }
      const ok = cond !== invert;
      invert = false;
      if (!ok) {
        aborted = true;
        break;
      }
      if (stop) break;
    }
    if (aborted) {
      if (hasPicture && res.unmodelled.size > 0 && pending.length === 0) res.gatedPicture = true;
      stop = false;
      continue;
    }
    res.pictures.push(...pending);
    if (stop) break;
  }
  return res;
}

/** Picture the scene window shows in `room` for facing value `f` (last window-4 picture wins). */
export function roomPictureFor(
  room: number,
  sceneSub: Subroutine,
  items: Map<number, AgosItem>,
  subs: Map<number, Subroutine>,
  f: number,
): { call: PictureCall | null; result: RoomEvalResult } {
  const env: RoomEvalEnv = { items, subs, room, vars: new Map([[VAR_FACING, f]]), states: new Map(), depth: 0 };
  const result = runRoomSubroutine(sceneSub, env);
  const main = result.pictures.filter((p) => p.mode === 4);
  return { call: main.length ? main[main.length - 1] : null, result };
}

/**
 * AGOS "VC" (video-controller) scripts inside a Waxworks `vga1` resource, and
 * a static compositor that runs the **picture** scripts the room code starts
 * (`picture <id> <window>`), drawing into the 224x127 main window.
 *
 * Original code. ScummVM's `vga.cpp`/`gfx.cpp` (GPL) was read as a behaviour
 * oracle for what the draw opcode's operands mean; nothing is translated.
 *
 * vga1 layout (big-endian; confirmed by walking all 3,652 script entries of
 * the corpus with 0 deviation, docs/waxworks/amiga/data-structure.md §6):
 *   +6   u16 palette offset            +2 u16 palette bank count (16 colours/bank)
 *   +10  u16 header offset H0, header at H0+20:
 *        H+2 imageCount  H+6 animationCount  H+10 imageTable  H+14 animationTable
 *   image table  : 8-byte entries {u16 id, u16 colour, u16 ?, u16 scriptOffset}
 *   anim table   : 8-byte entries {u16 id, u16 ?, u16 ?, u16 scriptOffset}
 *   scripts      : packed back-to-back; each is a stream of {u16 opcode, params}
 *                  ending with opcode 0, and ends exactly where the next
 *                  script (by offset) begins.
 */

import { decodeImage, readAnimTable, unpackIndices, type AnimTableEntry, type RGB } from './agos-vga.ts';

/**
 * Parameter bytes per VC opcode (index = opcode, `-1` = never seen in any
 * shipped script; hitting one raises). **Derived from the data, not copied**:
 * a neutral hill-climb over the whole Waxworks corpus (3,207 distinct
 * scripts) for the table under which every script terminates (opcode 0)
 * exactly on its successor's start offset reached 3,207/3,207; a random or
 * perturbed table scores < 2,500 (null control in the unit test).
 *
 * The data cannot tell opcode 4 (`fadeIn`, always followed by the word `1`)
 * as `4 params + opcode 1 with 0 params` from `6 params`; both score
 * 3,207/3,207. The 6-byte reading is used (only matters for walking).
 */
export const VC_PARAM_BYTES: readonly number[] = (() => {
  const t = new Array<number>(80).fill(-1);
  const known: Record<number, number> = {
    1: 0, 2: 2, 3: 10, 4: 6, 5: 4, 6: 2, 7: 2, 8: 4, 9: 4, 10: 8, 12: 2, 13: 2, 14: 2, 15: 2, 16: 2, 18: 2, 19: 0, 20: 4, 21: 2, 22: 2, 23: 2, 24: 8, 25: 0, 26: 10, 27: 0, 28: 8, 30: 2, 31: 2, 33: 0, 34: 0, 36: 4, 38: 2, 39: 4, 40: 2, 41: 0, 43: 2, 44: 2, 45: 4, 46: 6, 49: 2, 50: 2, 51: 2, 52: 2, 54: 4, 56: 0, 57: 0, 58: 0, 60: 2, 61: 2, 62: 0, 63: 0, 79: 10,
  };
  for (const [k, v] of Object.entries(known)) t[Number(k)] = v;
  t[0] = 0;
  return t;
})();

/**
 * Elvira II's VC opcode lengths, derived the same way from Elvira II's own
 * 1,268 consecutive script segments (all 100 zones): coordinate ascent from
 * the Waxworks table reached 1,268/1,268 exact terminations (the Waxworks
 * table alone: 1,237/1,268; a perturbed table collapses -- see the test).
 * Differs from Waxworks on ops 17/32/37/41/46/47/53/55/59 (all rare); ops
 * never seen stay `-1`. Elvira 1's VC set is *not* this one (747/750 only).
 */
export const ELVIRA2_VC_PARAM_BYTES: readonly number[] = (() => {
  const t = [0,0,2,10,6,4,2,2,4,4,8,-1,2,2,2,2,2,2,2,0,4,2,2,2,8,0,10,0,8,-1,2,2,0,0,0,-1,4,4,2,4,2,2,-1,2,2,4,2,6,-1,2,2,2,2,4,4,6,0,0,0,0,2,2,0,0];
  while (t.length < 80) t.push(-1);
  t[79] = 10;
  return t;
})();

/**
 * Elvira 1's VC opcode lengths, derived like the other two tables: coordinate
 * ascent (ops 1..79, 0..14 parameter bytes) over Elvira 1's own 750 consecutive
 * script segments (65 zones), started from the better of the Waxworks / Elvira II
 * tables (747/750 stalled in the first pass); it reaches **750/750** exact
 * terminations (the Waxworks table scores 54, Elvira II's 57; a wrong draw length
 * gives 594 -- see `games-elvira.test.ts`). The scripts compose into coherent
 * pictures (zone 22 garden paths and gates, `docs/elvira/amiga/data-structure.md`),
 * which checks the operand lengths of the ops that actually draw (10 draw, 22
 * palette, 13/14/15/16/17/18 conditionals). Ops that only affect timing/animation
 * (fade, delays, sprite setup) are constrained by the termination oracle alone and
 * several of their lengths could be swapped for an equivalent split; ops never
 * seen stay `-1` (they raise).
 */
export const ELVIRA1_VC_PARAM_BYTES: readonly number[] = [0,0,0,10,4,4,2,2,4,4,8,0,0,2,2,2,2,2,2,2,0,4,2,2,2,8,0,10,0,8,0,2,2,0,0,0,6,4,4,4,4,4,6,2,6,4,2,14,2,2,2,2,4,4,2,6,0,0,0,0,2,2,0,2,-1,-1,2,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,2];

export const VC_OP = {
  END: 0,
  CALL: 2,
  LOAD_SPRITE: 3,
  IF_EQUAL: 5,
  DRAW: 10,
  SET_PALETTE: 22,
  IF_VAR_NOT_ZERO: 38,
  SET_WINDOW: 31,
  SET_VAR: 39,
  IF_BIT_SET: 43,
  IF_BIT_CLEAR: 44,
} as const;

export interface VcOp {
  op: number;
  /** Signed 16-bit parameter words. */
  args: number[];
  offset: number;
}

export interface Vga1 {
  data: Uint8Array;
  /** Operand byte count per opcode for this game's VC dialect. */
  table: readonly number[];
  paletteOffset: number;
  paletteBanks: number;
  images: Map<number, { colour: number; script: number }>;
  anims: Map<number, number>;
}

const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const s16 = (b: Uint8Array, o: number): number => ((u16(b, o) << 16) >> 16);

export function parseVga1(data: Uint8Array, table: readonly number[] = VC_PARAM_BYTES): Vga1 {
  const h = u16(data, 10) + 20;
  const nimg = u16(data, h + 2);
  const nanim = u16(data, h + 6);
  const itab = u16(data, h + 10);
  const atab = u16(data, h + 14);
  const images = new Map<number, { colour: number; script: number }>();
  const anims = new Map<number, number>();
  for (let i = 0; i < nimg; i++) {
    const o = itab + i * 8;
    images.set(u16(data, o), { colour: u16(data, o + 2), script: u16(data, o + 6) });
  }
  for (let i = 0; i < nanim; i++) {
    const o = atab + i * 8;
    anims.set(u16(data, o), u16(data, o + 6));
  }
  return { data, table, paletteOffset: u16(data, 6), paletteBanks: u16(data, 2), images, anims };
}

/** Decode a script (until opcode 0). Throws on an opcode with no known length. */
export function walkScript(v: Vga1, offset: number): VcOp[] {
  const out: VcOp[] = [];
  let p = offset;
  for (;;) {
    const op = u16(v.data, p);
    const at = p;
    p += 2;
    if (op === 0) return out;
    const n = v.table[op];
    if (n === undefined || n < 0) throw new Error(`agos-vc: unknown VC opcode ${op} at 0x${at.toString(16)}`);
    const args: number[] = [];
    for (let i = 0; i < n; i += 2) args.push(s16(v.data, p + i));
    p += n;
    out.push({ op, args, offset: at });
  }
}

/** Sorted distinct script start offsets (images + anims), the segmentation the exact-boundary check uses. */
export function scriptStarts(v: Vga1): number[] {
  const s = new Set<number>();
  for (const i of v.images.values()) s.add(i.script);
  for (const a of v.anims.values()) s.add(a);
  return [...s].sort((a, b) => a - b);
}

/** 16-colour palette (`nibble*32` truncated to a byte, as the game loads it) for `bank`. */
export function bankPalette(v: Vga1, bank: number): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < 16; i++) {
    const w = u16(v.data, v.paletteOffset + bank * 32 + i * 2);
    out.push({ r: (((w >> 8) & 15) * 32) & 255, g: (((w >> 4) & 15) * 32) & 255, b: ((w & 15) * 32) & 255 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------

/** Main scene window (window 4): 14x16 = 224 px wide, 127 rows, at screen (48, 3). */
export const WINDOW4 = { x: 48, y: 3, w: 224, h: 127 };

export interface ZoneResources {
  vga1: Vga1;
  /** Picture bank this zone draws from (own `NNN2` or the shared zone 18 / 94 bank for the maze zones). */
  vga2: Uint8Array;
}

/** Per-picture result: a 224x127 palette-index surface plus the palette of the script that drew last. */
export interface ComposedPicture {
  w: number;
  h: number;
  indices: Uint8Array;
  palette: RGB[] | null;
  /** Number of `draw`s executed (0 = nothing drawn: treat the picture as unrenderable). */
  draws: number;
  /** Conditions/ops the static run did not model, for honesty reporting. */
  unmodelled: string[];
  /** Variables/bits the script consulted (`v19=6`, `b28=0`): two runs with equal `reads` draw identical pictures. */
  reads: Map<string, number>;
}

export interface ComposeEnv {
  /** zone id -> resources (vga1 + picture bank). */
  zone(zone: number): ZoneResources | undefined;
  /** VC variables (default 0) and flag bits (default clear). */
  vars?: Map<number, number>;
  bits?: Set<number>;
}

interface Bank {
  table: Map<number, AnimTableEntry>;
  images: Map<number, { w: number; h: number; px: Uint8Array } | null>;
}
const banks = new WeakMap<Uint8Array, Bank>();

function loadImage(vga2: Uint8Array, index: number): { w: number; h: number; px: Uint8Array } | null {
  let bank = banks.get(vga2);
  if (!bank) {
    bank = { table: new Map(readAnimTable(vga2).map((e) => [e.index, e])), images: new Map() };
    banks.set(vga2, bank);
  }
  if (bank.images.has(index)) return bank.images.get(index)!;
  let res: { w: number; h: number; px: Uint8Array } | null = null;
  const e = bank.table.get(index);
  if (e) {
    try {
      const img = decodeImage(vga2.subarray(e.offset), e.width, e.height, e.compressed);
      res = { w: e.width, h: e.height, px: unpackIndices(img) };
    } catch {
      res = null;
    }
  }
  bank.images.set(index, res);
  return res;
}

/**
 * Run the picture script `scriptId` (id/100 = zone) into a fresh window-4
 * surface cleared to the picture's header colour. `call` opcodes recurse
 * (depth-limited). Conditional opcodes use `env.vars`/`env.bits` (default 0).
 */
export function composePicture(scriptId: number, env: ComposeEnv): ComposedPicture {
  const out: ComposedPicture = { w: WINDOW4.w, h: WINDOW4.h, indices: new Uint8Array(WINDOW4.w * WINDOW4.h), palette: null, draws: 0, unmodelled: [], reads: new Map() };
  const zone0 = Math.floor(scriptId / 100);
  const res0 = env.zone(zone0);
  const head = res0?.vga1.images.get(scriptId);
  if (!res0 || !head) {
    out.unmodelled.push(`no script ${scriptId}`);
    return out;
  }
  out.indices.fill(head.colour & 255);
  const vars = new Map(env.vars ?? []);
  const bits = new Set(env.bits ?? []);
  const rv = (n: number): number => {
    const v = vars.get(n) ?? 0;
    out.reads.set(`v${n}`, v);
    return v;
  };
  const rb = (n: number): boolean => {
    const v = bits.has(n);
    out.reads.set(`b${n}`, v ? 1 : 0);
    return v;
  };
  let window = 4;
  const runOne = (id: number, depth: number): void => {
    if (depth > 8) {
      out.unmodelled.push(`call depth at ${id}`);
      return;
    }
    const z = env.zone(Math.floor(id / 100));
    const entry = z?.vga1.images.get(id) ?? (z && z.vga1.anims.has(id) ? { colour: 0, script: z.vga1.anims.get(id)! } : undefined);
    if (!z || !entry) {
      out.unmodelled.push(`call to missing script ${id}`);
      return;
    }
    const ops = walkScript(z.vga1, entry.script);
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      switch (o.op) {
        case VC_OP.IF_BIT_SET:
          if (!rb(o.args[0])) i++;
          break;
        case VC_OP.IF_BIT_CLEAR:
          if (rb(o.args[0])) i++;
          break;
        case VC_OP.IF_VAR_NOT_ZERO:
          if (rv(o.args[0]) === 0) i++;
          break;
        case VC_OP.IF_EQUAL:
          if (rv(o.args[0]) !== o.args[1]) i++;
          break;
        case VC_OP.SET_VAR:
          vars.set(o.args[0], o.args[1]);
          break;
        case VC_OP.SET_PALETTE:
          out.palette = bankPalette(z.vga1, o.args[0]);
          break;
        case VC_OP.CALL: {
          const target = o.args[0] < 0 ? rv(-o.args[0]) : o.args[0];
          if (target !== 0) runOne(target, depth + 1);
          break;
        }
        case VC_OP.DRAW:
          if (window === 4) drawImage(out, z.vga2, o.args[0] < 0 ? rv(-o.args[0]) : o.args[0], o.args[1], o.args[2], o.args[3]);
          else out.unmodelled.push(`draw into sub-window ${window} skipped`);
          break;
        case VC_OP.SET_WINDOW:
          window = o.args[0];
          break;
        case VC_OP.LOAD_SPRITE:
          out.unmodelled.push(`loadSprite ${o.args[1]} (animated sprite) not drawn`);
          break;
        default:
          break; // resetSprite / fadeIn / delays etc. do not change the static picture
      }
    }
  };
  runOne(scriptId, 0);
  return out;
}

/** `vc10_draw` semantics: x in 8-pixel units, y in rows, flags bit0 = horizontal flip, bit1 = also draw colour 0. */
function drawImage(out: ComposedPicture, vga2: Uint8Array, index: number, x8: number, y: number, flags: number): void {
  if (index === 0) return;
  const img = loadImage(vga2, index);
  if (!img) return;
  const flip = (flags & 1) !== 0;
  const nonTrans = (flags & 2) !== 0;
  const x0 = x8 * 8;
  for (let yy = 0; yy < img.h; yy++) {
    const dy = y + yy;
    if (dy < 0 || dy >= out.h) continue;
    for (let xx = 0; xx < img.w; xx++) {
      const dx = x0 + xx;
      if (dx < 0 || dx >= out.w) continue;
      const c = img.px[yy * img.w + (flip ? img.w - 1 - xx : xx)];
      if (c !== 0 || nonTrans) out.indices[dy * out.w + dx] = c;
    }
  }
  out.draws++;
}

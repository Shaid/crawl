/**
 * Might & Magic III (Amiga) rules ports, pass 3: the cast command and the 77 per-spell handlers in overlay 8
 * (docs/mm3/amiga/game-rules.md section 17). Method as rules.ts: strict sparse memory seeded only with the bytes
 * the real routine read under Unicorn (tools/mm3/rules_oracle/rules3.py); the UI/animation leaves are logged or
 * quiet stubs in the harness and are not modelled.  `OVn+` = overlay segment n; A4 = DATA + 0x7FFE.
 */
import { type Mem, g } from './rules-mem.ts';
import { type Call, CHAR0, CHAR_SIZE, charLevel, damageChar, maxHp, partyHit, getStat, randRange, simpleCheck, worstCondition } from './rules.ts';
import { castPay, castRefund, initiative } from './rules2.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const u16 = (v: number) => v & 0xffff;
const chr = (i: number) => g(CHAR0) + i * CHAR_SIZE;

/** scripted inputs of the harness: key presses (R+0x6F46), number-entry results (R+0xB6AA), walkability answers (OV4+0x3DA) */
export interface CastIo { keys: number[]; nums: number[]; walk: number[] }
export interface CastOpts { noHeal?: boolean; noRefund?: boolean; areaPlusOne?: boolean; noCombatRefusal?: boolean }

// ---- A4 globals used by the handlers ----
export const S = {
  mode: -0x104a, count: -0x1672, order: -0xc81, actor: -0x3309, caster: 0x3270, saved32e0: -0x32e0, redrawFlag: -0x33a0,
  dmg: 0x3330, kind: 0x332e, area: 0x332c, flag1b8: -0x1b8,
} as const;

/** the combat-spell table: damage, kind (A4+0x332E), area (A4+0x332C: 0 one monster, 1 one group, 2 every group), cue (R+0x971C), engine animation id (OV4+0xE6EA) */
export type Dmg = number | { rand: [number, number] } | { mulLevel: number } | { levelTimes: number };
export interface CombatSpell { dmg: Dmg; kind: number | 'menu'; area: number; cue: number | null; anim: number; menu?: number }
export const COMBAT_SPELLS: Record<number, CombatSpell> = {
  3: { dmg: 6, kind: 0, area: 0, cue: 0x12, anim: 0xe },
  5: { dmg: 8, kind: 'menu', menu: 5, area: 0, cue: null, anim: 0xb },
  8: { dmg: { mulLevel: 2 }, kind: 3, area: 1, cue: 0xe, anim: 5 },
  9: { dmg: { rand: [2, 6] }, kind: 6, area: 0, cue: 0x10, anim: 0xd },
  10: { dmg: 0, kind: 7, area: 1, cue: 0x12, anim: 0xe },
  11: { dmg: 8, kind: 0, area: 1, cue: 0x12, anim: 0xe },
  13: { dmg: 0xa, kind: 5, area: 1, cue: 0x11, anim: 0xa },
  16: { dmg: 0, kind: 0xe, area: 1, cue: 0x12, anim: 0xe },
  18: { dmg: 0x19, kind: 5, area: 0, cue: 0x11, anim: 0xa },
  20: { dmg: 0, kind: 0x10, area: 1, cue: 0x14, anim: 0xe },
  28: { dmg: { rand: [4, 6] }, kind: 3, area: 1, cue: 0xe, anim: 3 },
  29: { dmg: 0, kind: 8, area: 1, cue: 0x12, anim: 0xe },
  32: { dmg: 0x23, kind: 4, area: 0, cue: 0xf, anim: 8 },
  36: { dmg: { rand: [3, 7] }, kind: 2, area: 1, cue: 0xd, anim: 0 },
  38: { dmg: 0xf, kind: 5, area: 2, cue: 0x11, anim: 0xa },
  39: { dmg: { rand: [2, 4] }, kind: 4, area: 2, cue: 0xf, anim: 8 },
  43: { dmg: 0, kind: 9, area: 1, cue: 0x12, anim: 0xe },
  44: { dmg: 0x28, kind: 0, area: 1, cue: 0xd, anim: 0xe },
  46: { dmg: 0, kind: 0xb, area: 1, cue: 0x12, anim: 0xe },
  48: { dmg: 0, kind: 0xa, area: 1, cue: 0x12, anim: 0xe },
  49: { dmg: { levelTimes: 5 }, kind: 'menu', menu: 0x31, area: 2, cue: -1, anim: -1 },
  51: { dmg: 0x64, kind: 2, area: 0, cue: 0xd, anim: 2 },
  56: { dmg: 0x28, kind: 4, area: 1, cue: 0xf, anim: 9 },
  58: { dmg: 0, kind: 0xf, area: 1, cue: 0xd, anim: 0xe },
  62: { dmg: { rand: [6, 0xe] }, kind: 0, area: 1, cue: 0x12, anim: 0xe },
  63: { dmg: 0x50, kind: { rand: [0, 6] } as any, area: 2, cue: 0x12, anim: 0xe },
  64: { dmg: 0x1e, kind: 6, area: 2, cue: 0x10, anim: 0xd },
  65: { dmg: 0, kind: 0xd, area: 1, cue: 0x12, anim: 0xe },
  67: { dmg: 0xfa, kind: 2, area: 0, cue: 0xd, anim: 0 },
  68: { dmg: 0x96, kind: 'menu', menu: 0x44, area: 2, cue: -1, anim: -1 },
  69: { dmg: 0, kind: 0xc, area: 2, cue: 0x12, anim: 0xe },
  71: { dmg: 0x96, kind: 3, area: 1, cue: 0xe, anim: 4 },
  72: { dmg: 0xfa, kind: 2, area: 1, cue: 0xd, anim: 0 },
  73: { dmg: 0xc8, kind: 6, area: 2, cue: 0x10, anim: 0xd },
  74: { dmg: 0x3e8, kind: 6, area: 0, cue: 0x12, anim: 0xd },
  75: { dmg: 0x1f4, kind: 0, area: 2, cue: 0xd, anim: 2 },
};

/** Harness-visible context of one cast. */
class Ctx {
  calls: Call[] = [];
  m: Mem;
  io: CastIo;
  o: CastOpts;
  constructor(m: Mem, io: CastIo, o: CastOpts) { this.m = m; this.io = io; this.o = o; }
  cue(id: number) { this.calls.push(['cue', [id]]); }
  key(): number { return this.io.keys.length ? this.io.keys.shift()! : 0x1b; }
  caster(): number { return this.m.r32(g(S.caster)); }
}

/** OV8+0x2E4(spell): party-member picker. Keys 0xC9..0xD0 pick member key-0xC9 when below the party size; 0x1B cancels (-1) and refunds the cast. Other keys read again. */
function pickMember(c: Ctx, spell: number): number {
  const m = c.m;
  const sv = m.r8(g(S.flag1b8)); m.w8(g(S.flag1b8), 1);
  const mode = m.r8(g(S.mode)); m.w8(g(S.mode), 3);
  let d4: number;
  for (;;) {
    const k = c.key() & 0xffff;
    if (k === 0x1b) { d4 = -1; if (!c.o.noRefund) castRefund(m, c.caster(), spell); break; }
    if (k >= 0xc9 && k <= 0xd0) { const i = k - 0xc9; if (i < s16(m.r8(g(S.count)))) { d4 = i; break; } }
  }
  m.w8(g(S.mode), mode); m.w8(g(S.flag1b8), sv);
  return d4;
}
/** OV8+0x18C(spell): element menu. Keys 0..3 give 2..5, 'F','E','C','A' give 2,3,4,5, ESC cancels (-1, refund). */
function pickElement(c: Ctx, spell: number): number {
  const m = c.m;
  const mode = m.r8(g(S.mode)); m.w8(g(S.mode), 0xff);
  // the menu's UI descriptor pointers (OV8+0x1B2..0x1D2)
  m.w32(g(-0x1056), g(-0x3166)); m.w32(g(-0x1048), g(-0x315c)); m.w32(g(-0x1be), g(-0x3158)); m.w32(g(-0x1c2), g(-0x3154));
  m.w32(g(-0x314e), m.r32(g(-0x104e)));
  let d4: number;
  for (;;) {
    const k = c.key() & 0xffff;
    if (k === 0x1b) { d4 = -1; castRefund(m, c.caster(), spell); break; }
    if (k <= 3) { d4 = k + 2; break; }
    if (k === 0x41) { d4 = 5; break; }
    if (k === 0x43) { d4 = 4; break; }
    if (k === 0x45) { d4 = 3; break; }
    if (k === 0x46) { d4 = 2; break; }
  }
  m.w8(g(S.mode), mode);
  return d4;
}
/** OV8+0x8C(char, amount): heal HP by `amount` (word), clamped to the maximum; nothing for dead / stone / eradicated; wakes (+0x11F = 0) when HP > 0. Logs the four redraws. */
function heal(c: Ctx, ch: number, amount: number): void {
  const m = c.m;
  const cond = worstCondition(m, ch);
  if (cond >= 0xd && cond <= 0xf) return;
  const mx = s16(maxHp(m, ch));
  if (s16(m.r16(ch + 0x126)) <= mx) {
    m.w16(ch + 0x126, m.r16(ch + 0x126) + amount);
    if (s16(m.r16(ch + 0x126)) > mx) m.w16(ch + 0x126, mx);
    let i = 0;
    while (i < m.r8(g(S.count)) && chr(i) !== ch) i++;
    const sv = m.r8(g(S.saved32e0)); m.w8(g(S.saved32e0), 0);
    for (let f = 0; f < 4; f++) c.calls.push(['redraw', []]);
    m.w8(g(S.saved32e0), sv);
  }
  if (s16(m.r16(ch + 0x126)) > 0) m.w8(ch + 0x11f, 0);
}
const lvl = (c: Ctx) => charLevel(c.m, c.caster());

// ---- handlers (one per spell number; OV8 offsets in comments) ----
type H = (c: Ctx, spell: number) => void;
const set = (c: Ctx, d: number, v: number) => c.m.w8(g(d), v);

/** picker spells: pick a member, optionally refuse dead/stone/eradicated with a message, then `body(member char)` */
function healer(opts: { cond?: boolean; cue: number; amount?: number | ((c: Ctx) => number); post?: (c: Ctx, ch: number) => void; cueBefore?: boolean }): H {
  return (c, spell) => {
    const k = pickMember(c, spell);
    if (k === -1) return;
    const ch = chr(k);
    if (opts.cond) { const w = worstCondition(c.m, ch); if (w >= 0xd && w <= 0xf) return; }
    c.cue(opts.cue);
    const amt = typeof opts.amount === 'function' ? opts.amount(c) : (opts.amount ?? 0);
    if (!c.o.noHeal) heal(c, ch, amt);
    opts.post?.(c, ch);
  };
}
const buff = (off: number): ((c: Ctx, ch: number) => void) => (c, ch) => { c.m.w8(ch + off, lvl(c)); };
const clearCond = (off: number): ((c: Ctx, ch: number) => void) => (c, ch) => { c.m.w8(ch + off, 0); };
/** Suppress Poison / Disease: a non-zero counter becomes 1 when below 4, else drops by 3 */
const easeCond = (off: number): ((c: Ctx, ch: number) => void) => (c, ch) => {
  const v = c.m.r8(ch + off);
  if (v) c.m.w8(ch + off, v < 4 ? 1 : v - 3);
};


const addHandlers = (h: Record<number, H>): void => { Object.assign(HANDLERS, h); };
export const HANDLERS: Record<number, H> = {
  // 0x606 Light
  0: (c) => {
    const m = c.m;
    m.w16(g(-0x1324), m.r16(g(-0x1324)) + 1);
    if (m.r8(g(0x21fb))) { m.w8(g(0x21fa), 1); m.w8(g(-0x32e1), 1); }
    set(c, S.redrawFlag, 1); c.cue(0x2c);
  },
  // 0x636 Awaken: clears the asleep counter (+0x11B) of every member
  1: (c) => {
    for (let i = 0; i < c.m.r8(g(S.count)); i++) c.m.w8(chr(i) + 0x11b, 0);
    c.cue(0x34);
  },
  2: healer({ cond: true, cue: 0x34, amount: 6 }),
  6: healer({ cue: 0x34, amount: 0, post: clearCond(0x115) }),
  7: healer({ cond: true, cue: 0x34, amount: 0xf }),
  12: (c) => { set(c, -0x33a8, 1); set(c, -0x32e1, 1); c.cue(0x14); },
  14: healer({ cue: 0x14, post: easeCond(0x116) }),
  19: healer({ cue: 0x14, post: easeCond(0x117) }),
  21: healer({ cue: 0x34, post: buff(0x102) }),
  22: (c) => { set(c, -0x1660, 1); c.cue(0x14); },
  23: (c) => { set(c, -0x165e, 1); set(c, S.redrawFlag, 1); c.cue(0x14); },
  25: healer({ cue: 0x34, post: buff(0x104) }),
  26: healer({ cond: true, cue: 0x34, amount: (c) => { const r = randRange(c.m, 2, 0xc); return Math.imul(r, lvl(c)); } }),
  27: healer({ cond: true, cue: 0x34, amount: 0x19 }),
  30: healer({ cue: 0x34, post: buff(0x105) }),
  31: (c) => { set(c, -0x165d, 1); c.cue(0x14); },
  34: healer({ cue: 0x14, post: buff(0x103) }),
  35: healer({ cue: 0x34, post: clearCond(0x116) }),
  40: healer({ cue: 0x34, post: clearCond(0x117) }),
  47: healer({ cue: 0x34, post: clearCond(0x11e) }),
  54: healer({ cue: 0x34, post: clearCond(0x121) }),
  // 0x1c5a Create Food: food (u16 A4-0x1318) += party size
  52: (c) => { c.m.w16(g(-0x1318), c.m.r16(g(-0x1318)) + c.m.r8(g(S.count))); c.cue(0x14); },
};


// ---- map-permission flags: byte A4-0xDE + map*0x340 + 0x30E.. (one per world-spell; 0 = the spell is refused here with a message) ----
const mapFlag = (c: Ctx, off: number) => c.m.r8(g(-0xde) + s8(c.m.r8(g(0xdb9))) * 0x340 + off) !== 0;
/** a handler that hands a picked member to the item overlay: OV7+0xF1C(char, mode) with the mode saved/set to 0xFF around it */
const viaItemOverlay = (mode: number, cue?: number): H => (c, spell) => {
  const k = pickMember(c, spell);
  if (k === -1) return;
  const m = c.m; const prev = m.r8(g(S.mode)); m.w8(g(S.mode), 0xff);
  if (cue !== undefined) c.cue(cue);
  c.calls.push(['ov7_f1c', [chr(k), mode]]);
  m.w8(g(S.mode), prev);
};
const ageCap = (m: Mem, ch: number) => { const v = m.r8(ch + 0x26) + 5; if (v <= 0xfa) m.w8(ch + 0x26, m.r8(ch + 0x26) + 5); else m.w8(ch + 0x26, 0xfa); };
const decEndurance = (m: Mem, ch: number) => { m.w8(ch + 0x1a, m.r8(ch + 0x1a) - 1); if (m.r8(ch + 0x1a) < 1) m.w8(ch + 0x1a, 1); };
const dirStep = (c: Ctx, f: number, n: number) => ({
  dx: s8(c.m.r8(g(-0x25e4) + f * 0x2e + n)), dy: s8(c.m.r8(g(-0x252c) + f * 0x2e + n)),
});
const walk = (c: Ctx, x: number, y: number, w: number): number => { c.calls.push(['walk', [u16(x), u16(y), u16(w)]]); return c.io.walk.length ? c.io.walk.shift()! : 0; };

addHandlers({
  4: viaItemOverlay(3, 0x14),
  55: viaItemOverlay(4),
  57: viaItemOverlay(5),
  66: viaItemOverlay(6),
  // 0x9C0 Protection from Elements: 2*level+5 (cap 200) into the resistance timer of the chosen element A4-0x1322.. (2 fire, 3 elec, 4 cold, 5 acid)
  15: (c, spell) => {
    const m = c.m;
    let d4 = s16(charLevel(m, c.caster()) * 2 + 5);
    if (d4 > 0xc8) d4 = 0xc8;
    const el = pickElement(c, spell);
    const idx = u16(el + 1);
    if (idx === 0) return;
    if (idx >= 3 && idx <= 6) m.w16(g(-0x1322 + 2 * (idx - 3)), d4);
    else { c.cue(0x14); }
    if (idx >= 3 && idx <= 6) c.cue(0x14);
  },
  // 0x1F20 Raise Dead
  59: (c, spell) => {
    const k = pickMember(c, spell);
    if (k === -1) return;
    const m = c.m; const ch = chr(k);
    if (m.r8(ch + 0x120) === 0) return;
    m.w8(ch + 0x120, 0); m.w8(ch + 0x11f, 0); m.w16(ch + 0x126, 0);
    c.cue(0x34); heal(c, ch, 1);
    decEndurance(m, ch);
  },
  // 0x1F90 Half for Me: the caster loses half of the target's missing HP and the target is healed to full
  60: (c, spell) => {
    const k = pickMember(c, spell);
    if (k === -1) return;
    const m = c.m; const ch = chr(k);
    const w = worstCondition(m, ch);
    if (ch === m.r32(g(S.caster)) || (w >= 0xd && w <= 0xf)) return;
    const mx = s16(maxHp(m, ch));
    const dmg = (mx - s16(m.r16(ch + 0x126))) >> 1;
    damageChar(m, m.r32(g(S.caster)), u16(dmg));
    c.cue(0x14); heal(c, ch, mx);
  },
  // 0x231C Resurrect
  70: (c, spell) => {
    const k = pickMember(c, spell);
    if (k === -1) return;
    const m = c.m; const ch = chr(k);
    if (m.r8(ch + 0x122) === 0) return;
    c.cue(0x34); heal(c, ch, 0);
    m.w8(ch + 0x122, 0);
    decEndurance(m, ch);
    ageCap(m, ch);
  },
  // 0x2486 Divine Intervention
  76: (c) => {
    const m = c.m;
    ageCap(m, m.r32(g(S.caster)));
    for (let i = 0; i < m.r8(g(S.count)); i++) {
      const ch = chr(i); const keep = m.r8(ch + 0x122);
      for (let j = 0; j < 16; j++) m.w8(ch + 0x113 + j, 0);
      m.w8(ch + 0x122, keep);
      if (keep === 0) m.w16(ch + 0x126, maxHp(m, ch));
    }
    c.cue(0x14);
  },
  // 0xA6A Jump (not in battle): two squares ahead when neither the first nor the second is blocked
  17: (c) => {
    const m = c.m;
    const f = m.r8(g(-0x1668)); const w = m.r16(g(-0x32fa) + 2 * f);
    const x = m.r8(g(-0x1667)); const y = m.r8(g(-0x1666));
    const one = dirStep(c, f, 7);
    const d4 = s16(one.dx + x); const d5 = s16(one.dy + y);
    if (walk(c, x, y, w) !== 0) return;
    if (walk(c, d4, d5, w) !== 0) return;
    const two = dirStep(c, f, 0xe);
    m.w8(g(-0x1667), two.dx + m.r8(g(-0x1667)));
    m.w8(g(-0x1666), two.dy + m.r8(g(-0x1666)));
    c.cue(0x33); c.calls.push(['redraw', []]);
    set(c, S.redrawFlag, 1); set(c, -0x32e1, 1);
  },
  // 0x1712 Nature's Gate: by the calendar byte A4-0x1327 % 10 into the tables A4-0x3D39 (map) / -0x3D2F (x) / -0x3D25 (y)
  41: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x319)) return;
    c.cue(0x33);
    const i = m.r8(g(-0x1327)) % 10;
    c.calls.push(['ov4_97e6', [m.r8(g(-0x3d39) + i)]]);
    m.w8(g(-0x1667), m.r8(g(-0x3d2f) + i));
    m.w8(g(-0x1666), m.r8(g(-0x3d25) + i));
    c.calls.push(['ov4_98b4', []]);
    set(c, S.redrawFlag, 1);
  },
  // 0x17AC Time Distortion
  42: (c) => {
    if (!mapFlag(c, 0x316)) return;
    c.calls.push(['ov4_60', []]); c.calls.push(['ov4_98b4', []]);
    c.cue(0x33); c.calls.push(['redraw', []]);
  },
  // 0x1BE6 Super Shelter: mode 0xC around the rest engine R+0xFEA6
  50: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x317)) return;
    const prev = m.r8(g(S.mode)); m.w8(g(S.mode), 0xc);
    c.cue(0x34); c.calls.push(['fea6', []]);
    m.w8(g(S.mode), prev);
  },
  // 0x1C80 Town Portal: a number 1..5 (R+0xB6AA; larger answers ask again, 0 cancels) = town map for OV4+0x97E6
  53: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x318)) return;
    const prev = m.r8(g(S.mode)); m.w8(g(S.mode), 0xff);
    let n: number;
    for (;;) { c.calls.push(['number', [1, 0xa0]]); n = s16(c.io.nums.length ? c.io.nums.shift()! : 0); if (n <= 5) break; }
    m.w8(g(S.mode), prev);
    if (n === 0) return;
    c.cue(0x33); c.calls.push(['ov4_97e6', [u16(n)]]); c.calls.push(['ov4_60', []]);
    set(c, S.redrawFlag, 1);
  },
  // 0x201A Etherealize: one square ahead unless the map says 0x1111
  61: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x31a)) return;
    const x = m.r8(g(-0x1667)); const y = m.r8(g(-0x1666)); const f = m.r8(g(-0x1668));
    const st = dirStep(c, f, 7);
    const r = walk(c, st.dx + x, st.dy + y, 0x7777);
    if (r === 0x1111) return;
    m.w8(g(-0x1667), st.dx + m.r8(g(-0x1667))); m.w8(g(-0x1666), st.dy + m.r8(g(-0x1666)));
    c.cue(0x33);
    const prev = m.r8(g(S.mode)); m.w8(g(S.mode), 0xff);
    c.calls.push(['redraw', []]);
    m.w8(g(S.mode), prev);
    set(c, S.redrawFlag, 1);
  },
});


addHandlers({
  // 0x10D4 Lloyd's Beacon: every caster keeps one beacon (+0x77 map, +0x78 x, +0x79 y; default map 1, 2/5). Keys 0/'R' recall, 1/'S' set, ESC leaves.
  33: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x315)) return;
    const ch = m.r32(g(S.caster));
    if (m.r8(ch + 0x77) === 0) { m.w8(ch + 0x77, 1); m.w8(ch + 0x78, 2); m.w8(ch + 0x79, 5); }
    m.w32(g(-0x1056), g(-0x31be)); m.w32(g(-0x1048), g(-0x31b8)); m.w32(g(-0x1be), g(-0x31b6)); m.w32(g(-0x1c2), g(-0x31b4));
    m.w32(g(-0x31b0), m.r32(g(-0x104e)));
    for (;;) {
      const k = c.key() & 0xffff;
      if (k === 0 || k === 0x52) {
        c.cue(0x33);
        const cm = m.r32(g(S.caster));
        if (m.r8(cm + 0x77) !== m.r8(g(-0x1665))) c.calls.push(['ov4_97e6', [m.r8(m.r32(g(S.caster)) + 0x77)]]);
        m.w8(g(-0x1667), m.r8(m.r32(g(S.caster)) + 0x78));
        m.w8(g(-0x1666), m.r8(m.r32(g(S.caster)) + 0x79));
        c.calls.push(['ov4_98b4', []]);
        break;
      }
      if (k === 1 || k === 0x53) {
        c.cue(0x14);
        const cm = m.r32(g(S.caster));
        m.w8(cm + 0x77, m.r8(g(0xdb8)));
        m.w8(m.r32(g(S.caster)) + 0x78, m.r8(g(-0x1667)));
        m.w8(m.r32(g(S.caster)) + 0x79, m.r8(g(-0x1666)));
        break;
      }
      if (k === 0x1b) break;
    }
    set(c, S.redrawFlag, 1);
  },
  // 0x1842 Teleport: N squares (R+0xB6AA, 0 cancels) straight ahead; the destination is tested with OV4+0x3DA (blocked = 0x1111, or 0 when A4-0x3305 is set)
  45: (c) => {
    const m = c.m;
    if (!mapFlag(c, 0x314)) return;
    const prev = m.r8(g(S.mode)); m.w8(g(S.mode), 0xff);
    c.calls.push(['number', [1, 0xc8]]);
    const n = s16(c.io.nums.length ? c.io.nums.shift()! : 0);
    m.w8(g(S.mode), prev);
    if (n === 0) return;
    const f = m.r8(g(-0x1668));
    if (f < 4) {
      const flag = m.r8(g(-0x3305)) !== 0;
      const w = flag ? 0x70 : 0x7777;
      const bad = flag ? 0 : 0x1111;
      const x = () => m.r8(g(-0x1667)); const y = () => m.r8(g(-0x1666));
      let r: number;
      if (f === 0) { r = walk(c, x(), y() + n, w); if (s16(r) === bad) return; m.w8(g(-0x1666), y() + n); }
      else if (f === 1) { r = walk(c, x(), y() - n, w); if (s16(r) === bad) return; m.w8(g(-0x1666), y() - n); }
      else if (f === 2) { r = walk(c, x() + n, y(), w); if (s16(r) === bad) return; m.w8(g(-0x1667), x() + n); }
      else { r = walk(c, x() - n, y(), w); if (s16(r) === bad) return; m.w8(g(-0x1667), x() - n); }
    }
    c.calls.push(['ov4_98b4', []]);
    c.cue(0x33);
    set(c, S.redrawFlag, 1);
    for (let i = 0; i < 0x96; i++) m.w8(g(0x3274) + i, 0);
  },
});

// ---- combat spells: the globals the engine OV4+0xE6EA reads ----
function combatHandler(spell: number): H {
  return (c) => {
    const m = c.m; const t = COMBAT_SPELLS[spell];
    let dmg: number; let kind: number; let cue = t.cue ?? -2; let anim = t.anim;
    const d = t.dmg;
    const level = () => charLevel(m, c.caster());
    if (typeof d === 'number') dmg = d;
    else if ('mulLevel' in d) dmg = u16(level() * d.mulLevel);
    else if ('levelTimes' in d) dmg = u16(level() * d.levelTimes);
    else { const r = randRange(m, d.rand[0], d.rand[1]); dmg = u16(Math.imul(r, level())); }
    if (spell === 63) { m.w16(g(S.dmg), 0x50); kind = randRange(m, 0, 6); }
    else if (t.kind === 'menu') {
      m.w16(g(S.dmg), dmg);
      kind = pickElement(c, t.menu!);
      m.w16(g(S.kind), kind);
      if (kind === 0xffff || kind === -1) return;
    } else kind = t.kind as number;
    if (spell !== 63 && t.kind !== 'menu') m.w16(g(S.dmg), dmg);
    if (t.kind !== 'menu') m.w16(g(S.kind), u16(kind));
    m.w16(g(S.area), t.area + (c.o.areaPlusOne ? 1 : 0));
    if (t.kind === 'menu' && (spell === 49 || spell === 68)) {
      // cue / animation by element: u8 A4-0x3D1B-2+kind and A4-0x3D17-2+kind
      cue = m.r8(g(-0x3d1b - 2) + kind); anim = m.r8(g(-0x3d17 - 2) + kind);
    }
    if (cue >= 0) c.cue(cue);
    c.calls.push(['engine', [anim, m.r16(g(S.dmg)), m.r16(g(S.kind)), m.r16(g(S.area))]]);
    if (spell === 64) {
      // Moon Ray also heals every member rand(1,30)
      for (let i = 0; i < m.r8(g(S.count)); i++) { c.cue(0x34); const r = randRange(m, 1, 0x1e); heal(c, chr(i), r); }
    }
  };
}
for (const k of Object.keys(COMBAT_SPELLS)) HANDLERS[Number(k)] = combatHandler(Number(k));

/** spells the cast command refuses in battle (A4-0x104A == 2): refund, nothing else. */
export const NO_COMBAT = new Set([17, 23, 33, 41, 45, 50, 53, 61]);

/**
 * OV8+0x252E(1): the cast command entered with a pre-chosen spell (battle round driver). The caster is the character at
 * order[A4-0x3309]; the spell is +0x7B. Returns D0 (1 = cast, 0 = refused: not enough SP/gems, or a battle refusal).
 */
export function castCommand(m: Mem, io: CastIo, o: CastOpts = {}): { ret: number; calls: Call[] } {
  const c = new Ctx(m, io, o);
  const prev = m.r8(g(S.mode));
  m.w8(g(S.mode), 3);
  const sv = m.r8(g(S.saved32e0)); m.w8(g(S.saved32e0), 0);
  const ch = chr(m.r8(g(S.order) + s8(m.r8(g(S.actor)))));
  const spell = m.r8(ch + 0x7b);
  let ret = 0;
  if (castPay(m, ch, spell) === 0) {
    ret = 1;
    m.w32(g(S.caster), ch);
    m.w8(g(S.mode), prev);
    if (spell < 0x4d) {
      if (prev === 2 && NO_COMBAT.has(spell) && !o.noCombatRefusal) { castRefund(m, m.r32(g(S.caster)), spell); ret = 0; }
      else { const h = HANDLERS[spell]; if (h) h(c, spell); else throw new Error('unported spell ' + spell); }
    }
    m.w8(g(S.mode), 3);
  }
  m.w8(g(S.mode), prev);
  m.w8(g(S.saved32e0), sv);
  return { ret, calls: c.calls };
}


// ---- the combat spell resolver OV4+0x13282 (mode != 0): one spell against the monster in slot A4-0x3F2B ----
/** monster-id lists A4 displacements by spell kind: 7 sleep, 8 immobilize, 9 feeble mind, 0xA paralyze, 0x10 silence use them as "can be affected"; 0xB, 0xC and 0xE as "is of the kind that dies" */
export const KIND_LIST: Record<number, { disp: number; len: number }> = {
  7: { disp: -0x3c5a, len: 5 }, 8: { disp: -0x3c55, len: 13 }, 9: { disp: -0x3c48, len: 13 }, 0xa: { disp: -0x3c3b, len: 24 },
  0xb: { disp: -0x3c23, len: 22 }, 0xc: { disp: -0x3c6a, len: 9 }, 0xe: { disp: -0x3c6a, len: 9 }, 0x10: { disp: -0x3c0d, len: 5 },
};
const WEAPON_DMG = 0x330c;
/**
 * OV4+0x13282(caster, mode) with mode != 0. Returns the logged callees: apply136E2 = OV4+0x136E2(caster, dmg, mode), call1307C = turn-order rebuild.
 * `A4+0x332A == 1` is the "arrow" form (Elemental Arrow, spell 5): each party member flagged in A4+0x21E8[] who is not yet spent (A4+0x3332[]) rolls to hit
 * (OV4+0x12C38) and the first hit applies A4+0x3330 (or the weapon damage A4+0x330C) as item-type damage (mode 3). Otherwise: monster magic resistance
 * `Magi[id]` (u8 A4-0x590A) cancels the spell when `rand(1, casterLevel+100) < Magi`; a fixed damage A4+0x3330 is applied as is; with 3330 == 0 the kind A4+0x332E
 * selects the effect (status word set unless the monster saves, kill, half HP, ...).
 */
export function spellHit(m: Mem, caster: number, mode: number, opts: { noMagi?: boolean; noSave?: boolean; fullHolyWord?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const apply = (d5: number, d6: number) => { calls.push(['apply136E2', [caster, u16(d5), u16(d6)]]); calls.push(['call1307C', []]); };
  const d6in = u16(mode);
  if (m.r16(g(0x332a)) === 1) {
    for (let i = 0; i < 0xc; i++) m.w8(g(0x1e98) + i, 0);
    for (let d4 = 0; d4 < m.r8(g(S.count)); d4++) {
      if (!m.r8(g(0x21e8) + d4) || m.r8(g(0x3332) + d4)) continue;
      if (partyHit(m, chr(d4), d6in)) {
        const d5 = m.r16(g(S.dmg)) ? m.r16(g(S.dmg)) : m.r16(g(WEAPON_DMG));
        m.w8(g(0x21e8) + d4, 0);
        calls.push(['apply136E2', [caster, u16(d5), 3]]);
        return calls;
      }
      m.w8(g(0x3332) + d4, m.r8(g(0x3332) + d4) + 1);
    }
    return calls;
  }
  const slot = m.r8(g(-0x3f2b));
  const id = m.r16(g(0x173a) + 2 * slot);
  const magi = m.r8(g(-0x590a) + id);
  if (magi !== 0 && !opts.noMagi) {
    const r = randRange(m, 1, charLevel(m, m.r32(g(S.caster))) + 100);
    if (s16(r) < magi) return calls;
  }
  if (m.r8(g(-0x3f2b)) === 0xff) return calls;
  if (m.r16(g(S.dmg)) !== 0) { apply(m.r16(g(S.dmg)), d6in); return calls; }
  const kind = m.r16(g(S.kind));
  const k = u16(kind - 7);
  if (k >= 10) { apply(0, d6in); return calls; }   // kinds 0..6 with no damage: the game passes a stale register (not modelled; the harness keeps it 0)
  const inList = (disp: number, len: number) => { for (let i = 0; i < len; i++) if (m.r8(g(disp) + i) === id) return true; return false; };
  const resistOrStatus = () => {
    if (opts.noSave || simpleCheck(m, id) === 0) m.w16(g(0x188e) + 2 * slot, m.r16(g(S.kind)));
  };
  const hpTab = () => m.r16(g(-0x6120) + 2 * m.r16(g(0x173a) + 2 * m.r8(g(-0x3f2b))));
  switch (kind) {
    case 7: case 8: case 9: case 0xa: case 0x10: {
      const L = KIND_LIST[kind];
      // the game scans the list with a byte index; the id compares as a longword so ids >= 0x100 never match
      if (inList(L.disp, L.len)) resistOrStatus();
      return calls;
    }
    case 0xb: {
      const L = KIND_LIST[0xb];
      if (inList(L.disp, L.len)) apply(m.r16(g(0x1492) + 2 * m.r8(g(-0x3f2b))), 2);
      return calls;
    }
    case 0xc: {
      const L = KIND_LIST[0xc];
      let d5 = 0;
      for (let i = 0; i < L.len; i++) if (m.r8(g(L.disp) + i) === id) { d5 = hpTab(); break; }
      apply(d5, 2); return calls;
    }
    case 0xe: {
      const L = KIND_LIST[0xe];
      let d5 = 0;
      for (let i = 0; i < L.len; i++) if (m.r8(g(L.disp) + i) === id) { d5 = 0x19; break; }
      apply(d5, 2); return calls;
    }
    case 0xd: {
      let d5 = m.r16(g(0x1492) + 2 * m.r8(g(-0x3f2b))) >> 1;
      if (d5 === 0) d5 = 1;
      apply(d5, 2); return calls;
    }
    case 0xf: {
      let d5 = hpTab();
      if (d5 > 0x96) { d5 = 0x32; m.w16(g(S.kind), 6); }
      apply(d5, d6in); return calls;
    }
    default: apply(0, d6in); return calls;     // kinds 0xB..: not reachable (k < 10 covers 7..16 and 11..: kinds 0x11+ fall out above)
  }
}

// ---- the combat spell engine OV4+0xE6EA(anim) ----
/** OV8+0x14(char): can this member shoot? first inventory slot holding an item 0x1E..0x21 with a non-zero count decides: yes unless the worst condition is 8 or 0xB..0xF. */
export function canShoot(m: Mem, ch: number): number {
  for (let i = 0; i < 18; i++) {
    const id = m.r8(ch + 0xdc + i);
    if (id < 0x1e || id > 0x21) continue;
    if (!m.r8(ch + 0x7d + i)) continue;
    const w = worstCondition(m, ch) & 0xff;
    const k = (w - 8) & 0xffff;
    if (k >= 8) return 1;
    return k === 1 || k === 2 ? 1 : 0;
  }
  return 0;
}
export const ANIM_HANDLE = 0x1234;   // what the harness's R+0x5EB2 stub returns (the real routine loads the animation resource)
const RANKS = [[0x1f73, -0x1ba, -0x1b9], [0x3264, 0x3259, 0x3252], [0x3261, 0x3258, 0x3251], [0x325e, 0x3255, 0x3250]];
/**
 * OV4+0xE6EA(anim): run the chosen combat spell (A4+0x3330 damage, +0x332E kind, +0x332C area, caster A4+0x3270) over the monster groups.
 * Each non-empty group's head monster is the target (A4-0x3F2B) of one OV4+0x13282(caster, 1) call ("hit"). Area 0 stops after the first target,
 * 1 covers the three groups of the front rank, any other value continues through ranks 2..4 while an animation resource is loaded (A4+0xDCA).
 * `anim == 0xB` is the arrow form (needs a member who can shoot, `A4+0x332A = 1`). `walk` = scripted OV4+0x3DA answers.
 */
export function combatEngine(m: Mem, anim: number, walk: number[], opts: { noRanks?: boolean; stopAfterGroup?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const caster = () => m.r32(g(S.caster));
  const w = walk.length ? walk.shift()! : 0;
  calls.push(['walk', [m.r8(g(-0x1667)), m.r8(g(-0x1666)), 0x70]]);
  m.w8(g(-0x33a6), w === 0 ? 1 : 0);
  if (u16(anim) === 0xb) {
    m.w16(g(-0x351a), 1); m.w16(g(0x332a), 1);
    let d7 = 0;
    if (m.r16(g(S.kind)) === 0) {
      m.w16(g(S.dmg), 0);
      for (let i = 0; i < m.r8(g(S.count)); i++) if (canShoot(m, chr(i))) { m.w8(g(0x21e8) + i, 1); d7 = 1; }
    } else { m.w8(g(0x21e8), 1); d7 = 1; }
    if (d7) calls.push(['cue', [0xc]]); else { calls.push(['cue', [0x15]]); return calls; }
  } else { m.w8(g(0x21e8), 1); m.w16(g(0x332a), 0); }
  m.w8(g(-0x33ab), 1);
  if (m.r32(g(0xdca))) { /* R+0x81A8 frees the old animation (quiet) */ }
  if (u16(anim) === m.r16(g(0x21f8))) m.w32(g(0xdca), m.r32(g(0xc22))); else m.w32(g(0xdca), ANIM_HANDLE);
  const saved715 = m.r8(g(0x715c)); const a3 = m.r8(g(-0x3f2b));
  const finish = () => { for (let i = 0; i < 8; i++) m.w8(g(0x21e8) + i, 0); };
  const ids: number[] = [0, 0, 0];
  const load = (rank: number[]) => { ids.fill(0); let n = 0; for (const a of rank) if (m.r8(g(a))) ids[n++] = m.r8(g(a)); };
  const end = (): Call[] => {
    m.w16(g(-0x351a), 0); m.w8(g(-0x3f2b), a3); m.w8(g(0x715c), saved715);
    calls.push(['ov4_3e14', []]);
    return calls;
  };
  load(RANKS[0]);
  m.w8(g(0x715c), 0xff);
  if (m.r8(g(-0x3f2b)) !== 0xff) { m.w8(g(0x715c), saved715 - 1); ids[0] = (a3 + 1) & 0xff; }
  calls.push(['redraw', []]);
  let d5 = 0;
  const runRank = (): 'stop' | 'go' => {
    for (let d4 = 0; d4 < 3; d4++) {
      m.w8(g(0x715c), m.r8(g(0x715c)) + 1);
      if (ids[d4]) {
        for (let i = 0; i < 8; i++) m.w8(g(0x3332) + i, 0);
        m.w8(g(-0x3f2b), ids[d4] - 1);
        calls.push(['hit', [caster(), 1, m.r8(g(-0x3f2b))]]);
        d5 = 1;
        if (m.r16(g(S.area)) === 0 || opts.stopAfterGroup) { finish(); return 'stop'; }
      }
    }
    if (d5 && m.r16(g(S.area)) === 1) { finish(); return 'stop'; }
    return 'go';
  };
  if (runRank() === 'stop') return end();
  if (opts.noRanks) { finish(); return end(); }
  for (let r = 1; r < 4; r++) {
    if (!m.r32(g(0xdca))) { finish(); return end(); }
    calls.push(['redraw', []]);
    load(RANKS[r]);
    if (r < 3) { if (runRank() === 'stop') return end(); }
    else {
      // the last rank: a finishing clear only after a single-group spell; area 2 falls out without it
      for (let d4 = 0; d4 < 3; d4++) {
        m.w8(g(0x715c), m.r8(g(0x715c)) + 1);
        if (ids[d4]) {
          for (let i = 0; i < 8; i++) m.w8(g(0x3332) + i, 0);
          m.w8(g(-0x3f2b), ids[d4] - 1);
          calls.push(['hit', [caster(), 1, m.r8(g(-0x3f2b))]]);
          d5 = 1;
          if (m.r16(g(S.area)) === 0) { finish(); return end(); }
        }
      }
      if (d5 && m.r16(g(S.area)) === 1) finish();
      return end();
    }
  }
  return end();
}


// ---- the battle round loop (R+0x11FA0) and its helpers ----
const PARTY_N = 0x1f74, ORDER = -0xc81, DONE = 0x3312, ACTORS = 0x331e, ACTOR = -0x3309, ACTING = -0x3308, WIPED = -0x3307;
const groupCount = (m: Mem) => (m.r8(g(0x1f73)) ? 1 : 0) + (m.r8(g(-0x1ba)) ? 1 : 0) + (m.r8(g(-0x1b9)) ? 1 : 0);
const orderChar = (m: Mem, i: number) => chr(m.r8(g(ORDER) + i));
/**
 * R+0xC7F8 party-wiped test: members are the party-order list (battle: mode A4-0x104A == 2, `A4+0x1F74` of them) or the first `A4-0x1672` records.
 * `A4-0x3307` becomes 0 as soon as one member's worst condition is 0..0xA (or 0x10 = none), 1 when every member is 0xB..0xF (paralysed .. eradicated).
 * Asleep (8) and the confusion-type conditions (9, 0xA) therefore still count as alive.
 */
export function wipeCheck(m: Mem): void {
  const battle = m.r8(g(S.mode)) === 2;
  for (let i = 0; i < (battle ? m.r8(g(PARTY_N)) : m.r8(g(S.count))); i++) {
    const c = worstCondition(m, battle ? orderChar(m, i) : chr(i)) & 0xff;
    if (c < 0x11 && !(c >= 0xb && c <= 0xf)) { m.w8(g(WIPED), 0); return; }
  }
  m.w8(g(WIPED), 1);
}
/** R+0x12150: 1 when the round is over: no actor whose done-flag (A4+0x3312[i]) is clear can still act (members 0xB..0xF cannot; monsters always can). */
export function roundOver(m: Mem): number {
  const groups = groupCount(m); const pn = m.r8(g(PARTY_N));
  for (let d4 = 0; pn + groups > d4; d4++) {
    if (m.r8(g(DONE) + d4)) continue;
    if (d4 >= pn) return 0;
    const c = worstCondition(m, orderChar(m, d4)) & 0xff;
    if (c < 0xb || c > 0xf) return 0;
  }
  return 1;
}
/** R+0x12276: 1 when every party member is down for the round (asleep 8, or 0xB..0xF); 9 and 0xA (confused-type) can still be commanded. */
export function allDown(m: Mem): number {
  for (let d4 = 0; d4 < m.r8(g(PARTY_N)); d4++) {
    const c = worstCondition(m, orderChar(m, d4)) & 0xff;
    const k = (c - 8) & 0xffff;
    if (k >= 8) return 0;
    if (k === 1 || k === 2) return 0;
  }
  return 1;
}
/** R+0x1220A: close the holes (0xFF) in the party order table, carrying the done-flags along. */
export function compactParty(m: Mem): void {
  for (let d5 = 0; d5 < 8; d5++) {
    if (m.r8(g(ORDER) + d5) !== 0xff) continue;
    for (let d4 = d5 + 1; d4 < 8; d4++) {
      if (m.r8(g(ORDER) + d4) >= 0xff) continue;
      m.w8(g(ORDER) + d5, m.r8(g(ORDER) + d4));
      m.w8(g(DONE) + d5, m.r8(g(DONE) + d4));
      m.w8(g(DONE) + d4, 0); m.w8(g(ORDER) + d4, 0xff);
      break;
    }
  }
}
/** scripted callee results of the round loop harness: whether the monster turn A1DC leaves the party-wiped flag set, in call order */
export interface RoundIo { wipe: number[] }
/**
 * R+0x11FA0: advance the battle to the next actor who needs the player (a command is requested through R+0xC166) or to the end.
 * Logs: monsterTurn = R+0xA1DC(0), command = R+0xC166(actor), and the initiative rebuild is the real OV4+0x1307C port.
 */
export function roundLoop(m: Mem, io: RoundIo, opts: { noWipeStop?: boolean; noSkipDown?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const groups = groupCount(m);
  if (roundOver(m)) return calls;
  const newRound = (): boolean => {          // 12004: battle-over tests
    wipeCheck(m);
    if (m.r8(g(WIPED)) && !opts.noWipeStop) { m.w8(g(S.mode), 1); return true; }
    return false;
  };
  if (!(((m.r8(g(0x1f73)) || m.r8(g(-0x1ba)) || m.r8(g(-0x1b9))) && m.r8(g(PARTY_N)) !== 0))) { m.w8(g(S.mode), 1); return calls; }
  for (;;) {
    if (newRound()) return calls;
    let d5 = 0;
    let acts = false;
    while (!acts) {
      if (m.r8(g(ACTOR)) !== 0xff) m.w8(g(DONE) + s8(m.r8(g(ACTOR))), 1);
      const div = m.r8(g(PARTY_N)) + groups;
      m.w8(g(ACTING), m.r8(g(ACTING)) + 1);
      const k = s8(m.r8(g(ACTING)));
      m.w8(g(ACTING), k % div);
      m.w8(g(ACTOR), m.r8(g(ACTORS) + s8(m.r8(g(ACTING)))));
      if (roundOver(m)) {
        if (allDown(m)) {
          initiative(m);
          m.w8(g(ACTOR), 0xff); m.w8(g(ACTING), 0xff);
          for (let i = 0; i < 12; i++) m.w8(g(DONE) + i, 0);
          acts = false; break;
        }
        return calls;
      }
      if (s8(m.r8(g(ACTOR))) < m.r8(g(PARTY_N))) {
        const c = worstCondition(m, orderChar(m, s8(m.r8(g(ACTOR))))) & 0xff;
        const kk = (c - 8) & 0xffff;
        const skip = !opts.noSkipDown && kk < 8 && kk !== 1 && kk !== 2;
        if (skip) {
          d5++;
          if (m.r8(g(PARTY_N)) + groups > d5) continue;
        }
      }
      acts = true;
    }
    if (!acts) continue;
    if (s8(m.r8(g(ACTOR))) >= m.r8(g(PARTY_N))) {
      calls.push(['monsterTurn', [0]]);
      if (io.wipe.length) m.w8(g(WIPED), io.wipe.shift()!);
      if (m.r8(g(WIPED))) return calls;
      continue;
    }
    if (!roundOver(m)) calls.push(['command', [s8(m.r8(g(ACTOR)))]]);
    return calls;
  }
}

// ---- the world clock ----
/** OV4+0xC9D4 monthly interest: the bank balances (gold u32 A4-0x1310, gems u32 A4-0x130C) grow by 1% (unsigned integer division). */
export function bankInterest(m: Mem, opts: { noGems?: boolean } = {}): void {
  m.w32(g(-0x1310), (m.r32(g(-0x1310)) + Math.floor(m.r32(g(-0x1310)) / 100)) >>> 0);
  if (!opts.noGems) m.w32(g(-0x130c), (m.r32(g(-0x130c)) + Math.floor(m.r32(g(-0x130c)) / 100)) >>> 0);
}
/**
 * OV4+0xFE5C(minutes): advance the clock. A4-0x131A (u16) accumulates minutes; every 1,440 (0x5A0) the day counter A4-0x1327 (u8) advances, a year (u16 A4-0x1326)
 * is 100 days (the counter wraps at 100 and clears the seven flags 0x6F..0x75 of the bit-set at A4-0x12FC). Each time the day changes on a day with `day % 10 == 1`
 * (or when more than a day was added) the world refreshes (R+0xC1E6, logged) and the banks earn interest (above). Logged: flag = R+0xC8D2(set, bit, 0).
 */
export function advanceClock(m: Mem, minutes: number, opts: { noInterest?: boolean; yearDays?: number } = {}): Call[] {
  const calls: Call[] = [];
  const d6 = s16(minutes);
  const day0 = m.r8(g(-0x1327));
  m.w16(g(-0x131a), m.r16(g(-0x131a)) + d6);
  const yd = opts.yearDays ?? 100;
  while (m.r16(g(-0x131a)) >= 0x5a0) {
    m.w16(g(-0x131a), m.r16(g(-0x131a)) - 0x5a0);
    m.w8(g(-0x1327), m.r8(g(-0x1327)) + 1);
    if (m.r8(g(-0x1327)) >= yd) {
      m.w8(g(-0x1327), m.r8(g(-0x1327)) - yd);
      m.w16(g(-0x1326), m.r16(g(-0x1326)) + 1);
      for (let d4 = 0x6f; d4 < 0x76; d4++) calls.push(['flag', [g(-0x12fc), d4, 0]]);
    }
  }
  const day = m.r8(g(-0x1327));
  if (day % 10 === 1 || d6 > 0x5a0) {
    if (day !== day0) { calls.push(['mapreset', []]); if (!opts.noInterest) bankInterest(m); }
  }
  if (day !== day0) m.w8(g(-0x33a7), 1);
  if (m.r8(g(-0x33a7)) !== 0 && m.r16(g(-0x131a)) >= 0x12c) {
    if (m.r8(g(S.mode)) !== 9) {
      calls.push(['c704', []]); calls.push(['b64a', [1]]);
      if (m.r16(g(0x7158)) === 0) { /* R+0xD1AE redraw (quiet) */ }
    }
    m.w8(g(-0x33a7), 0);
  }
  return calls;
}

/**
 * OV4+0x10386(minutes): time passes for the party (rest, walking, spells). Whenever the 480-minute (0x1E0) bucket of the accumulator A4-0x131A changes, every member
 * ages one tick: a living member with any of the seven attributes at 0 dies (+0x120 = 1); the counters at +0x114 (poison-type, becomes +0x11C = 1 after 10),
 * +0x116 / +0x117 (doubling, with a 1-in-10 chance R+0x64D4(1,10) of a save OV4+0x82DC(char, 3|4) that clears them), +0x118, +0x119 (after 10: cleared, +0x114 = 1),
 * +0x120..0x122 (dead/stone/eradicated timers: ++, 0 becomes 0xFF), and +0x11C (++ mod 4) advance; +0x11D / +0x11B / +0x11E / +0x115 clear and +0x115 takes +0x11A.
 * Then the clock advances (advanceClock), then +0x11D (1-in-3 save 82DC(char,0), else -1) and +0x11E (1-in-5, -1) count down. Finally, when OV4+0x10346 answers
 * non-zero and the day/night state ((min >= 0x12C && min < 0x4EC) ? day : night) differs from A4+0x715E, OV4+0xBFB2(map) is called (logged).
 * `io.save` scripts the OV4+0x82DC answers; `io.night` the OV4+0x10346 answer.
 */
export function timePasses(m: Mem, minutes: number, io: { save: number[]; night: number }, opts: { noAgeTick?: boolean; noCountdown?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const save = (i: number, k: number): number => { calls.push(['save', [i, k]]); return io.save.length ? io.save.shift()! : 0; };
  const d6 = s16(minutes);
  const acc = m.r16(g(-0x131a));
  const bucket = (v: number) => Math.trunc(v / 0x1e0);
  if (bucket(acc + d6) !== bucket(acc) && !opts.noAgeTick) {
    for (let i = 0; i < m.r8(g(S.count)); i++) {
      const c = chr(i);
      if ((m.r8(c + 0x120) | m.r8(c + 0x121) | m.r8(c + 0x122)) === 0) {
        for (let k = 0; k < 7; k++) if (u16(getStat(m, c, k, 0)) < 1) m.w8(c + 0x120, 1);
      }
      if (m.r8(c + 0x114)) { m.w8(c + 0x114, m.r8(c + 0x114) + 1); if (m.r8(c + 0x114) > 10) { m.w8(c + 0x114, 0); m.w8(c + 0x11c, 1); } }
      m.w8(c + 0x11d, 0); m.w8(c + 0x11b, 0); m.w8(c + 0x11e, 0); m.w8(c + 0x115, 0);
      for (const [off, k, hi] of [[0x116, 3, 10], [0x117, 4, 10]] as const) {
        if (!m.r8(c + off)) continue;
        if (randRange(m, 1, hi) === 1) { if (save(i, k)) m.w8(c + off, 0); else m.w8(c + off, m.r8(c + off) * 2); }
        else m.w8(c + off, m.r8(c + off) * 2);
      }
      if (m.r8(c + 0x118)) m.w8(c + 0x118, m.r8(c + 0x118) + 1);
      for (const off of [0x120, 0x121, 0x122]) {
        if (!m.r8(c + off)) continue;
        m.w8(c + off, m.r8(c + off) + 1);
        if (!m.r8(c + off)) m.w8(c + off, 0xff);
      }
      if (m.r8(c + 0x119)) { m.w8(c + 0x119, m.r8(c + 0x119) + 1); if (m.r8(c + 0x119) > 10) { m.w8(c + 0x119, 0); m.w8(c + 0x114, 1); } }
      m.w8(c + 0x115, m.r8(c + 0x11a)); m.w8(c + 0x11a, 0);
      if (m.r8(c + 0x11c)) { m.w8(c + 0x11c, m.r8(c + 0x11c) + 1); m.w8(c + 0x11c, m.r8(c + 0x11c) % 4); }
    }
  }
  calls.push(...advanceClock(m, minutes));
  if (!opts.noCountdown) {
    for (let i = 0; i < m.r8(g(S.count)); i++) {
      const c = chr(i);
      if (m.r8(c + 0x11d) && randRange(m, 1, 3) === 1) { if (save(i, 0)) m.w8(c + 0x11d, 0); else m.w8(c + 0x11d, m.r8(c + 0x11d) - 1); }
      if (m.r8(c + 0x11e) && randRange(m, 1, 5) === 1) m.w8(c + 0x11e, m.r8(c + 0x11e) - 1);
    }
  }
  calls.push(['f10346', []]);
  if (io.night) {
    const d = m.r16(g(-0x131a)) >= 0x12c && m.r16(g(-0x131a)) < 0x4ec ? 0 : 1;
    if (d !== m.r8(g(0x715e))) calls.push(['bfb2', [m.r8(g(-0x1665))]]);
  }
  return calls;
}

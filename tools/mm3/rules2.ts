/**
 * Might & Magic III (Amiga) rules ports, pass 2: the monster's turn, turn order, damage to a monster
 * (docs/mm3/amiga/game-rules.md sections 10-12). Same method as rules.ts: each function runs against a strict
 * sparse memory seeded only with the bytes the real routine read under Unicorn (tools/mm3/rules_oracle/rules2.py).
 * `R+` = root CODE hunk, `OVn+` = overlay segment n; A4 = DATA + 0x7FFE.
 */
import { type Mem, g } from './rules-mem.ts';
import { type Call, CHAR0, CHAR_SIZE, PARTY_MODE, TARGET, armourClass, charLevel, getStat, randRange, simpleCheck, worstCondition, elementDamage, xpSplit, c7ac, xpNextLevel } from './rules.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const u16 = (v: number) => v & 0xffff;

// ---- monster tables (A4 displacements, indexed by monster id) ----
export const MT = {
  hp: -0x6120, ac: -0x606c, spd: -0x6012, dmgN: -0x5fb8, dmgS: -0x5f5e, numA: -0x5f04, exp: -0x5eaa, dmgT: -0x5d42,
  attP: -0x5ce8, spec: -0x5c8e, rang: -0x5c34, hitB: -0x5bda, trea: -0x5b80, gold: -0x5b26, gems: -0x59be,
} as const;
// ---- battle state ----
export const G = {
  grpA: 0x1f73, grpB: -0x1ba, grpC: -0x1b9,          // u8: 1-based slot of each of the three monster groups' last member (0 = group empty)
  partyN: 0x1f74, order: -0xc81, flagTurn: -0x33a9, actor: -0x3309, acting: -0x3308, order331E: 0x331e,
  monStatus: 0x188e, monId: 0x173a, monHp: 0x1492, defend: 0x1f76, wiped: -0x3307,
} as const;

/** R+0xA1DC the monster's attack routine (arg: monster id). Calls: 'hit' = R+0x9E02(char, partySlot, monster); 'miss' = R+0x971C(2) (miss cue); 'end' = R+0xD1AE.
 *  Returns the logged calls (the stubbed callees); opts are null-control switches. */
export function monsterTurn(m: Mem, monId: number, opts: { noAutoHit?: boolean; flatAc?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const hit = (ch: number, slot: number, mon: number) => calls.push(['hit9E02', [ch, u16(slot), u16(mon)]]);
  const miss = () => calls.push(['ui971c', [2]]);
  let d6 = u16(monId);
  const order = (i: number) => m.r8(g(G.order) + i);
  const chr = (pos: number) => g(CHAR0) + order(pos) * CHAR_SIZE;
  if (m.r8(g(G.flagTurn)) === 0) {
    // which monster slot acts: actor index minus party size selects the group (garbage for >2; the generator keeps 0..2)
    const k = u16((m.r8(g(G.actor)) << 24 >> 24) - m.r8(g(G.partyN)));
    let d7: number;
    if (k === 0) d7 = m.r8(g(G.grpA)) - 1;
    else if (k === 1) d7 = m.r8(g(G.grpB)) - 1;
    else if (k === 2) d7 = m.r8(g(G.grpC)) - 1;
    else throw new Error('unmodelled: caller register');
    const st = m.r16(g(G.monStatus) + 2 * d7);
    if (st !== 0 && st !== 1) return calls;          // disabled monsters (status other than 0/1) do not act
    d6 = m.r16(g(G.monId) + 2 * d7);
  }
  let all = false;
  const numA = () => m.r8(g(MT.numA) + s16(d6));
  for (let a = 0; a < numA();) {
    let d5 = -1;
    let skipToAttack = false;
    const att = m.r8(g(MT.attP) + s16(d6));
    const partyN = () => m.r8(g(G.partyN));
    let nextTarget = false;
    if (att === 0) {
      all = true; d5++;
      if (d5 >= partyN()) { a++; continue; }
    } else if (att !== 1) {
      let found = false;
      for (let d4 = 0; d4 < partyN(); d4++) {
        const ch = chr(d4);
        const cond = worstCondition(m, ch);
        if (((cond - 0xb) & 0xffff) < 5) continue;             // paralysed .. eradicated are never preferred
        const k = (att - 2) & 0xffff;
        if (k >= 5) continue;
        const ok = k === 0 ? m.r8(ch + 0x13) === 3 : k === 1 ? m.r8(ch + 0x13) === 4 : k === 2 ? m.r8(ch + 0x13) === 8 : k === 3 ? m.r8(ch + 0x13) === 1 : m.r8(ch + 0x11) === 2;
        if (ok) { d5 = d4; found = true; break; }
      }
      skipToAttack = found;
    }
    if (att === 1 || (att > 1 && !skipToAttack)) {
      // random target by party size (R+0xA39A)
      const n = partyN();
      if (n === 0) d5 = -1;
      else if (n === 1) d5 = 0;
      else if (n <= 5) d5 = randRange(m, 0, n - 1);
      else if (n === 6) d5 = randRange(m, 1, 8) === 8 ? 5 : randRange(m, 0, 4);
      else if (n === 7) d5 = randRange(m, 1, 10) === 10 ? 6 : randRange(m, 0, 5);
      else if (n === 8) d5 = randRange(m, 1, 12) === 12 ? 7 : randRange(m, 0, 6);
    }
    void nextTarget;
    for (;;) {                                                // one pass per target (several in all-members mode)
      if (!all && !skipToAttack) {
        // an incapacitated pick (paralysed .. eradicated) is replaced by a uniform choice among the others
        const cond = worstCondition(m, chr(d5));
        if (((cond - 0xb) & 0xffff) < 5) {
          const list: number[] = [];
          for (let d4 = 0; d4 < partyN(); d4++) {
            const c2 = worstCondition(m, chr(d4));
            if (((c2 - 0xb) & 0xffff) >= 5) list.push(order(d4));
          }
          if (list.length === 0) { m.w8(g(G.wiped), 1); m.w8(g(PARTY_MODE), 1); return calls; }
          const r = randRange(m, 0, list.length - 1);
          // double indirection through the party-order table (sic); rand can return n (hi+1), reading the memset(-1) filler word of the stack list
          d5 = order(s16(r < list.length ? list[r] : 0xffff));
        }
      }
      const ch = chr(d5);
      if ((!opts.noAutoHit && m.r8(g(MT.dmgT) + s16(d6)) !== 0) || m.r8(ch + 0x11b) !== 0) hit(ch, d5, d6);
      else {
        let d4 = randRange(m, 1, 20);
        let isHit = false, gotoMiss = false;
        if (d4 === 20) hit(ch, d5, d6);                        // a natural 20 hits, then (sic) falls through into the ordinary roll below
        else if (d4 === 1) gotoMiss = true;
        if (gotoMiss) miss();
        else {
          const hb = m.r8(g(MT.hitB) + s16(d6));
          d4 = s16(randRange(m, 1, hb) + d4 + (hb >> 2));
          const ac = opts.flatAc ? 0 : armourClass(m, ch, 0);
          const d0 = m.r8(g(G.defend) + d5) !== 0 ? (charLevel(m, ch) >> 1) + 0xf : 0xa;
          isHit = !(ac + d0 > d4);
          if (isHit) hit(ch, d5, d6); else miss();
        }
      }
      if (!all) { a++; break; }
      d5++;
      if (d5 >= partyN()) { a++; break; }
    }
    skipToAttack = false;
  }
  calls.push(['end', []]);
  return calls;
}

/** OV4+0x1307C turn order: every living-or-not party member (Speed attribute, R+0xD064 kind 4) and the representative monster of each non-empty group
 *  (u8 Spd[monster id]) sorted by speed descending, ties by index (party first); written as byte indices into A4+0x331E[12] (0xFF = unused).
 *  When a turn is in progress (A4-0x3308 != 0xFF) the current actor is re-found in the new order. */
export function initiative(m: Mem, opts: { ascending?: boolean } = {}): void {
  const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
  const have = m.r8(g(G.acting)) !== 0xff;
  const a3 = s8(m.r8(g(G.order331E) + s8(m.r8(g(G.acting)))));
  for (let i = 0; i < 12; i++) m.w8(g(G.order331E) + i, 0xff);
  const sp: number[] = new Array(12).fill(0xffff);
  let d6 = 0, d4 = 0, d7 = 0;
  const partyN = () => m.r8(g(G.partyN));
  for (; d4 < partyN(); d4++) {
    const c = g(CHAR0) + m.r8(g(G.order) + d4) * CHAR_SIZE;
    const d5 = getStat(m, c, 4, 0);
    sp[d4] = d5;
    if (s16(d5) > s16(d6)) d6 = d5;
  }
  for (const grp of [G.grpA, G.grpB, G.grpC]) {
    const cnt = m.r8(g(grp));
    if (!cnt) continue;
    const id = m.r16(g(G.monId) + 2 * cnt - 2);
    const d5 = m.r8(g(MT.spd) + id);
    sp[d4++] = d5;
    if (s16(d5) > s16(d6)) d6 = d5;
  }
  for (let k = 0; k <= d6; k++) {
    const s = opts.ascending ? k : d6 - k;
    for (let d5 = 0; d5 < partyN() + 3; d5++) {
      if (sp[d5] === s) m.w8(g(G.order331E) + d7++, d5);
    }
  }
  if (!have) return;
  if (s8(m.r8(g(G.order331E) + s8(m.r8(g(G.acting))))) === a3) return;
  const n = (m.r8(g(G.grpA)) ? 1 : 0) + (m.r8(g(G.grpB)) ? 1 : 0) + (m.r8(g(G.grpC)) ? 1 : 0);
  for (let i = 0; partyN() + n > i; i++) if (s8(m.r8(g(G.order331E) + i)) === a3) { m.w8(g(G.acting), i); return; }
}

// ---- damage to a monster: OV4+0x136E2 ----
export const D = {
  idx: 0x715c, animA: 0x1e8c, animB: 0x713c, animC: 0x1e98, animD: 0x710c, animE: 0x7124, el: 0x3310, spellKind: 0x332e,
  gold: 0x70a0, gems: 0x709c, lootN: 0x709b, noReward: -0x1665, lootChance: -0x3518, lootBuf: -0x2f8, physRes: -0x56ee, spellAnim: -0x3c61,
} as const;
/** OV4+0x12D28 damage magnitude class: <10 -> 0, <50 -> 1, <200 -> 2, else 3 (unsigned word compares) */
export const magnitude = (x: number) => (u16(x) < 10 ? 0 : u16(x) < 50 ? 1 : u16(x) < 200 ? 2 : 3);
const CLEAR_SLOT = [0x1f73, -0x1ba, -0x1b9, 0x3264, 0x3259, 0x3252, 0x3261, 0x3258, 0x3251, 0x325e, 0x3255, 0x3250];
/**
 * OV4+0x136E2(char, dmg, mode): apply `dmg` to the monster slot A4-0x3F2B. mode 0 = melee (physical resistance scaling `A4-0x56EE[id]`, weapon element added),
 * 2 = no resistance, otherwise a spell kind in A4+0x332E. Kill: HP word cleared, `Exp` split over the party, `Gold`/`Gems` added to the u32s at A4+0x70A0/+0x709C
 * (unless the byte at A4-0x1665 is 0x6A), a `Trea` loot roll (rand(1,100) <= A4-0x3518[t-1]) appends one generated item (max 10, parallel arrays at A4+0x70A4..0x70D6),
 * then the slot's group-index byte is cleared. Callees R+0x971C (cue), OV4+0 (redraw), R+0x122DE, R+0xB83A (item generator) are logged / injected.
 */
export function monsterDamage(m: Mem, ch: number, dmgIn: number, mode: number, lootGen: (type: number, buf: number) => void, opts: { noPhysResist?: boolean; noKill?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const ui = (x: number) => calls.push(['ui971c', [x]]);
  let d4 = u16(dmgIn), d7 = 0;
  const t = () => m.r8(g(TARGET));
  const monId = () => m.r16(g(G.monId) + 2 * t());
  if (d4 === 0) { ui(2); return calls; }
  if (m.r16(g(G.monStatus) + 2 * t()) === 7) m.w16(g(G.monStatus) + 2 * t(), 0);
  ui(1);
  const idx = m.r8(g(D.idx));
  m.w8(g(D.animA) + idx, 3);
  if (mode === 2) m.w8(g(D.animB) + idx, 2);
  else {
    let d0 = 0;
    if (mode !== 0) { const k = m.r16(g(D.spellKind)); d0 = m.r8(g(D.spellAnim) + (k < 7 ? k : 6)); }
    m.w8(g(D.animB) + idx, d0 + 1);
  }
  if (monId() === 0x19 && mode === 0) calls.push(['call122DE', [ch]]);
  if (mode === 0 || m.r16(g(D.spellKind)) === 0) {
    const d6 = m.r8(g(D.physRes) + monId());
    if (d6 !== 0 && !opts.noPhysResist) {
      if (d6 === 100) d4 = 0;
      else d4 = u16(Math.trunc(Math.imul(100 - d6, d4) / 100));
    }
  }
  const e = elementDamage(m, mode);
  d4 = u16(s16(e) + d4);
  if (s16(e) > 0) {
    m.w8(g(D.animC) + idx, (c7ac(m, s8(m.r8(g(D.el)))) + 1) & 0xff);
    m.w16(g(D.animD) + 2 * idx, magnitude(e));
  } else if (mode !== 3) m.w8(g(D.animC) + idx, 0);
  if (mode !== 0 && simpleCheck(m, monId())) {
    const k = m.r16(g(D.spellKind));
    const x = (k - 0xb) & 0xffff;
    if (x === 0 || x === 2) d4 = 5;
    else if (x === 4) d4 = 0x32;
    else d4 = d4 >>> 1;
  }
  m.w16(g(D.animE) + 2 * idx, magnitude(d4));
  const hp = m.r16(g(G.monHp) + 2 * t());
  if (!(hp > d4)) { d7 = 1; m.w16(g(G.monHp) + 2 * t(), 0); }
  else m.w16(g(G.monHp) + 2 * t(), hp - d4);
  calls.push(['ov4_0', []]);
  if (!d7) return calls;
  ui(0); ui(3);
  xpSplit(m, m.r32(g(MT.exp) + 4 * monId()));
  if (m.r8(g(D.noReward)) !== 0x6a) {
    m.w32(g(D.gold), (m.r32(g(D.gold)) + m.r32(g(MT.gold) + 4 * monId())) >>> 0);
    m.w32(g(D.gems), (m.r32(g(D.gems)) + m.r16(g(MT.gems) + 2 * monId())) >>> 0);
    const tr = m.r8(g(MT.trea) + monId());
    if (tr !== 0) {
      const r = randRange(m, 1, 100);
      if (!(s16(r) > m.r8(g(D.lootChance) + tr - 1))) {
        let n = s8(m.r8(g(D.lootN)) + 1);
        m.w8(g(D.lootN), n);
        if (n > 10) { n = 10; m.w8(g(D.lootN), 10); }
        const buf = g(D.lootBuf);
        calls.push(['loot', [tr, buf, 0]]);
        lootGen(tr, buf);
        const nn = s8(m.r8(g(D.lootN)));
        const put = (arr: number, off: number) => m.w8(g(arr) - 1 + nn, m.r8(buf + off));
        put(0x70d6, 0x90); put(0x70cc, 0xa3); put(0x70c2, 0xb6); put(0x70b8, 0xc9); put(0x70ae, 0xdc); put(0x70a4, 0xef);
      }
    }
  }
  m.w16(g(0xf42) + 2 * t(), 0x80);
  m.w16(g(0xdee) + 2 * t(), 0x80);
  m.w8(g(D.animA) + m.r8(g(D.idx)), 0);
  m.w8(g(TARGET), 0xff);
  const k = m.r8(g(D.idx));
  if (k < 12) m.w8(g(CLEAR_SLOT[k]), 0);
  calls.push(['ov4_0', []]);
  if (m.r8(g(G.grpA)) !== 0) { m.w8(g(TARGET), m.r8(g(G.grpA)) - 1); m.w8(g(D.idx), 0); }
  return calls;
}
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

// ---- item generator R+0xB83A(type, buf, slot) ----
/** band index of a d100 roll: first `i` with roll <= cut[i], else cut.length */
const band = (r: number, cuts: number[]) => { const i = cuts.findIndex(c => s16(r) <= c); return i < 0 ? cuts.length : i; };
const ITEM_SLOT_ARRAYS = [0x90, 0x7d, 0xef, 0xdc, 0xc9, 0xb6, 0xa3];
/**
 * R+0xB83A: generate one item into slot `slot` of the character-shaped record `buf` (the +0x7D..+0xEF parallel arrays; OV4+0xF08A clears the slot first).
 * `type` is the treasure grade (0 -> 1; 6 = special). Item id (+0xDC) = d100 x d100 bands; then 1..3 "enchantments" (95/4/1 %) drawn from kinds 1..4 without repeats:
 * kind 1 -> +0xA3 (rand from table A4-0x539C row = d100 band, column = 2*grade) + A4-0x5354[band]; 2 -> +0xC9 (A4-0x534E, + A4-0x52D6); 3 -> +0xB6 (A4-0x52CC, + A4-0x52B4);
 * 4 -> +0xEF = rand(A4-0x53D6[type], A4-0x53CF[type]) and +0x90 = rand(1,10)+5.
 */
export function generateItem(m: Mem, type: number, buf: number, slot: number, opts: { noSpecial?: boolean } = {}): void {
  let d7 = type & 0xff;
  for (const o of ITEM_SLOT_ARRAYS) m.w8(buf + o + slot, 0);
  if (d7 === 0) d7 = 1;
  const A = [0, 0, 0], B = [0, 0, 0];
  const r1 = randRange(m, 1, 100);
  const d6 = randRange(m, 1, 100);
  let d5: number;
  if (s16(r1) <= 0x23) {
    d5 = s16(d6) <= 0x1e ? randRange(m, 1, 6) : s16(d6) <= 0x3c ? randRange(m, 7, 0x11) : s16(d6) <= 0x55 ? randRange(m, 0x12, 0x1d) : randRange(m, 0x1e, 0x21);
  } else if (s16(r1) <= 0x3c) {
    d5 = s16(d6) <= 0x46 ? randRange(m, 0x22, 0x29) : 0x2a;
  } else {
    const x = s16(d6);
    d5 = x <= 10 ? randRange(m, 0x2b, 0x2d) : x <= 20 ? 0x2e : x <= 35 ? 0x2f : x <= 45 ? 0x30 : x <= 55 ? randRange(m, 0x31, 0x33) : x <= 65 ? 0x34 : x <= 75 ? randRange(m, 0x35, 0x39) : x <= 80 ? randRange(m, 0x3a, 0x3c) : randRange(m, 0x3d, 0x45);
  }
  m.w8(buf + 0xdc + slot, d5);
  let cnt: number;
  if (d7 === 6 && !opts.noSpecial) { cnt = 1; A[0] = randRange(m, 1, 4); B[0] = d7 - 1; }
  else {
    const r = randRange(m, 1, 100);
    cnt = s16(r) <= 0x5f ? 1 : s16(r) <= 0x63 ? 2 : 3;
    if (cnt === 1) {
      const r2 = randRange(m, 1, 100);
      B[0] = d7 - 1;
      if (d5 >= 0x3d && s16(r2) <= 0x5a) A[0] = 4;
      else A[0] = s16(r2) <= 0x5d ? 3 : s16(r2) <= 0x60 ? 1 : s16(r2) <= 0x63 ? 2 : 4;
    } else {
      if (cnt === 3) { A[2] = randRange(m, 1, 4); B[2] = randRange(m, 0, d7 - 1); }
      B[1] = randRange(m, 0, d7 - 1);
      do { A[1] = randRange(m, 1, 4); } while (A[1] === A[2]);
      B[0] = d7 - 1;
      for (;;) {
        A[0] = randRange(m, 1, 4);
        B[0] = d7 - 1;
        if (A[0] === A[1] || A[0] === A[2]) continue;
        break;
      }
    }
  }
  const tab = (base: number, d4: number, bi: number, isHi: number) => m.r8(g(base) + d4 * 12 + 2 * s16(bi) + isHi);
  for (let i = 0; i < cnt; i++) {
    switch (s16(A[i])) {
      case 1: {
        const d4 = band(randRange(m, 1, 100), [0x19, 0x2d, 0x3c, 0x4b, 0x5f]);
        const v = randRange(m, tab(-0x539c, d4, B[i], 0), tab(-0x539c, d4, B[i], 1));
        m.w8(buf + 0xa3 + slot, v);
        m.w8(buf + 0xa3 + slot, m.r8(buf + 0xa3 + slot) + m.r8(g(-0x5354) + d4));
        break;
      }
      case 2: {
        const d4 = band(randRange(m, 1, 100), [0xf, 0x19, 0x23, 0x32, 0x41, 0x50, 0x55, 0x5a, 0x5f]);
        const v = randRange(m, tab(-0x534e, d4, B[i], 0), tab(-0x534e, d4, B[i], 1));
        m.w8(buf + 0xc9 + slot, v);
        m.w8(buf + 0xc9 + slot, m.r8(buf + 0xc9 + slot) + m.r8(g(-0x52d6) + d4));
        break;
      }
      case 3: {
        const r = randRange(m, 1, 100);
        const d4 = d7 === 6 ? 1 : s16(r) <= 0x46 ? 0 : 1;
        const v = randRange(m, tab(-0x52cc, d4, B[i], 0), tab(-0x52cc, d4, B[i], 1));
        m.w8(buf + 0xb6 + slot, v);
        m.w8(buf + 0xb6 + slot, m.r8(buf + 0xb6 + slot) + m.r8(g(-0x52b4) + d4));
        break;
      }
      case 4: {
        m.w8(buf + 0xef + slot, randRange(m, m.r8(g(-0x53d6) + d7), m.r8(g(-0x53cf) + d7)));
        m.w8(buf + 0x90 + slot, randRange(m, 1, 10) + 5);
        break;
      }
      default: break;
    }
  }
}

// ---- spell cast gate ----
export const SPELL = { sp: -0x4102, gems: -0x4066, partyGems: -0x1304, names: -0x4a82, chosen: 0x7b } as const;
/** OV8+0x534/0x5AA shared cost: {sp, gems}. SP cost word A4-0x4102[spell]; if < 1 it is `level * -cost` (low word of the unsigned multiply R+0x14168); gem cost word A4-0x4066[spell]. */
export function spellCost(m: Mem, c: number, spell: number): { sp: number; gems: number } {
  const gems = m.r16(g(SPELL.gems) + 2 * s16(spell));
  let sp = s16(m.r16(g(SPELL.sp) + 2 * s16(spell)));
  if (sp < 1) sp = s16(Math.imul(charLevel(m, c), -sp));
  return { sp, gems };
}
/** OV8+0x534(char, spell): pay for a cast. Returns 0 paid, 1 not enough SP (signed word compare), 2 not enough party gems (u32 at A4-0x1304; the gem cost is sign-extended). */
export function castPay(m: Mem, c: number, spell: number, opts: { noGems?: boolean } = {}): number {
  const { sp, gems } = spellCost(m, c, spell);
  if (s16(m.r16(c + 0x128)) < sp) return 1;
  const gx = s16(gems) >>> 0;
  if (!opts.noGems && gx > m.r32(g(SPELL.partyGems))) return 2;
  m.w16(c + 0x128, m.r16(c + 0x128) - sp);
  m.w32(g(SPELL.partyGems), (m.r32(g(SPELL.partyGems)) - gx) >>> 0);
  return 0;
}
/** OV8+0x5AA(char, spell): give back what castPay took (cancelled cast). Recomputes the cost from the caster's current level. */
export function castRefund(m: Mem, c: number, spell: number): void {
  const { sp, gems } = spellCost(m, c, spell);
  m.w16(c + 0x128, m.r16(c + 0x128) + sp);
  m.w32(g(SPELL.partyGems), (m.r32(g(SPELL.partyGems)) + (s16(gems) >>> 0)) >>> 0);
}
/** OV4+0xB840(char): 1 (blocked, with a message) when the worst condition is 8 (Asleep) or 0xB..0xF (Paralyzed, Unconscious, Dead, Stone, Eradicated), else 0. */
export function castBlocked(m: Mem, c: number): { blocked: number; calls: Call[] } {
  const cond = worstCondition(m, c);
  const k = (cond - 8) & 0xffff;
  if (k < 8 && (k === 0 || k >= 3)) {
    const fmt = m.r32(g(-0x52aa));
    return { blocked: 1, calls: [['sprintf', [g(-0x1154), fmt, c]], ['msg', [g(-0x1154)]]] };
  }
  return { blocked: 0, calls: [] };
}
/** OV4+0xF10C(spell, level): SP cost of a spell for a caster of `level`: the table word A4-0x4102[spell] when >= 0, else `-cost * level` (32-bit multiply, level sign-extended). Result is a long. */
export function spellSp(m: Mem, spell: number, level: number): number {
  const d4 = s16(m.r16(g(SPELL.sp) + 2 * s16(spell)));
  return d4 >= 0 ? d4 : Math.imul(-d4, s16(level)) >>> 0;
}
/** OV4+0xF13E(spell, shift): spell price = |cost| * (cost < 0 ? 500 : 100) << shift (68k shift count mod 64), as a long. */
export function spellPrice(m: Mem, spell: number, shift: number): number {
  const d4 = s16(m.r16(g(SPELL.sp) + 2 * s16(spell)));
  const base = d4 < 0 ? Math.imul(d4, -500) : Math.imul(d4, 100);
  const sh = s16(shift) & 63;
  return (sh >= 32 ? 0 : base << sh) >>> 0;
}

// ---- training hall: experience and gold ----
/** OV4+0xB7EC: experience needed to advance from the character's level L (+0x23): classTab[class] << (L-1) for L < 12, else (L-11)*0xFA000 + (classTab << 10). The total-XP-equivalent held by the record is R+0x88FC (xpNextLevel). */
export function levelThreshold(m: Mem, c: number): number {
  const L = m.r8(c + 0x23);
  let d5: number, d4: number;
  if (L < 12) { d5 = 0; d4 = L - 1; } else { d5 = L - 11; d4 = 10; }
  const tab = s16(m.r16(g(-0x3fca) + 2 * m.r8(c + 0x13)));
  const sh = d4 & 63;
  return (Math.imul(d5, 0xfa000) + (sh >= 32 ? 0 : tab << sh)) >>> 0;
}
/** R+0x88CA: experience still missing for the next level = max(0, threshold - total), 0 when the character may be trained. */
export function xpShortfall(m: Mem, c: number): number {
  const d4 = (levelThreshold(m, c) - xpNextLevel(m, c)) | 0;
  return d4 >= 1 ? d4 >>> 0 : 0;
}
/** R+0x8964(kind, cost, bank): pay `cost` from a pool: kind 0 gold (party A4-0x1308, bank A4-0x1310), 1 gems (party A4-0x1304, bank A4-0x130C), 2 food (u16 A4-0x1318, no bank flag). Returns 1 paid / 0 short (a message call is logged). Training cost is 10 * level^2 gold. */
export function pay(m: Mem, kind: number, cost: number, bank: number): { ok: number; calls: Call[] } {
  const pool = kind === 0 ? (bank ? -0x1310 : -0x1308) : kind === 1 ? (bank ? -0x130c : -0x1304) : null;
  if (kind > 2 || kind < 0) return { ok: 1, calls: [] };
  if (pool === null) {
    if (m.r16(g(-0x1318)) < cost >>> 0) return { ok: 0, calls: [['short', [2, 0, 0]]] };
    m.w16(g(-0x1318), m.r16(g(-0x1318)) - cost);
    return { ok: 1, calls: [] };
  }
  if (m.r32(g(pool)) < cost >>> 0) return { ok: 0, calls: [['short', [kind, bank, 0]]] };
  m.w32(g(pool), (m.r32(g(pool)) - cost) >>> 0);
  return { ok: 1, calls: [] };
}
export const trainingCost = (level: number) => (10 * level * level) >>> 0;

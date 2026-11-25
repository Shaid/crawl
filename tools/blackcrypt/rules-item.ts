/**
 * Black Crypt (Amiga): the ITEM-USE DISPATCHER `+0x12FEA` (character d2, item d6): the shell, the effect table 0x80..0x9F and the INLINE potion effects 0x96..0x9F. HARNESS (pass 8, family `item`):
 * the real routine runs in musashi with the spell routines the effects 0x80..0x90 call HOOKED (logged with their arguments, return value chosen per case); the shell and every inline effect are
 * diffed byte for byte, and the effect -> routine / constant-argument map is checked through the hook log. What the called routines do is NOT repeated here: they are the spell routines already
 * ported and harnessed elsewhere (see `ITEM_EFFECTS`), so `useItem` takes them as a callback.
 *
 * Shell (code order):
 *   1. cell flag bit 30 on the party square (anti-magic): the item does nothing, no charge, no cost, the result is 1 ("SPELL FAILED").
 *   2. e = item word +0xE. e == 0x95 draws rand16(10) + 0x80 (a random one of the ten effects 0x80..0x89).
 *   3. e in 0x96..0xA9 except 0x9E: the result d3 = 1 already (so 0xA0..0xA9 are consumed with no effect of their own).
 *   4. (e - 0x80) < 0x20 (unsigned): the handler of that effect; 0x91..0x95 have none (d3 stays 0 or 1 as set above).
 *   5. d3 != 0 (any value, -2 included): the item's charge byte +7 is decremented unless it is 0xFF (infinite), and AdjustVitals(selected character A4+0x1A24, -1, 0, 0) charges 1 energy.
 *   The result is d3 (a word; 2 and -2 only redraw).
 * Effects (d3 = the routine's return value unless marked "1"):
 *   0x80 LIGHT `+0x58C6`; 0x81 DISPEL MAGIC `+0x4C46(6)`; 0x82 ray(mag 10, die 8, base 0x1C, pre 0x67, range 1); 0x83 ray(16, 6, 15, 0x67, 3); 0x84 HEALING n = 1 `+0x5070(1, text)`;
 *   0x85 ray(16, 6, 24, 0x67, 3); 0x86 HEALING n = 2 `+0x5070(2, text)`; 0x87 ray(16, 6, 21, 1, 3); 0x88 ray(4, 8, 18, 1, 3); 0x89 ray(10, 100, 38, 0x66, 1); 0x8A FEAST (inline: food and water 5000 of every
 *   living character, 1); 0x8B RAISE DEAD `+0x5CFA`; 0x8C ray(200, 1, 37, pre 0x64, 1) (the boss-killer filter); 0x8D PROTECTOR `+0x78DA`; 0x8E SOULFREEZER `+0x79C2`; 0x8F VORTEX `+0x7B2E`; 0x90 FORCEHAMMER `+0x7C40`.
 *   0x96 and 0x9D heal: hp += rand16(16) + 2, capped at max hp (1); 0x97 +0x8C += 1 and event 0x1E (a1 = character, a2 = 0x0A) at tick + 900 (1); 0x98 poison: +0x9A += 1 unless +0x8B != 0 (1);
 *   0x99 +0x9A = 0 (1); 0x9A +0x97 = 0 (1); 0x9B disease: +0x97 += 1 unless +0x88 != 0 (1); 0x9C STRENGTH: the old buff is reverted by `+0x49B4` (event type 0x1F), +0x64 += 2 and, when there was no old buff,
 *   the counter +0x78 += 1, event 0x1F (a2 = 0, a3 = 2) at tick + 1800 (1); 0x9E water: +0x54 += item word +0x10, capped 5000 (1); 0x9F +0x86 += 1 and event 0x1E (a2 = 4) at tick + 900 (1).
 * Each inline effect ends with the stat-panel redraw `+0x170A8(character, 1)` (UI; reported through the callback).
 */
import { BcRng } from './rules';
import { A4Mem } from './rules-spell';
import { OBJ, CELL, scheduleEvent, recastCancel, adjustVitals } from './rules-spell9';

const CH = (k: number) => 0x1758 + 0xa8 * k;
const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;
/** effect id -> the routine it calls (S_1 offset) and the constant arguments (words, as the hook log sees them) */
export const ITEM_EFFECTS: Record<number, { off: number; args: number[]; ray?: { mag: number; dmg: number; base: number; pre: number; range: number } }> = {
  0x80: { off: 0x58c6, args: [] }, 0x81: { off: 0x4c46, args: [6] },
  0x82: { off: 0x6d9a, args: [10, 8, 0x1c, 0x67, 1], ray: { mag: 10, dmg: 8, base: 0x1c, pre: 0x67, range: 1 } },
  0x83: { off: 0x6d9a, args: [16, 6, 15, 0x67, 3], ray: { mag: 16, dmg: 6, base: 15, pre: 0x67, range: 3 } },
  0x84: { off: 0x5070, args: [1, 9, 0xd403] },
  0x85: { off: 0x6d9a, args: [16, 6, 24, 0x67, 3], ray: { mag: 16, dmg: 6, base: 24, pre: 0x67, range: 3 } },
  0x86: { off: 0x5070, args: [2, 9, 0xd403] },
  0x87: { off: 0x6d9a, args: [16, 6, 21, 1, 3], ray: { mag: 16, dmg: 6, base: 21, pre: 1, range: 3 } },
  0x88: { off: 0x6d9a, args: [4, 8, 18, 1, 3], ray: { mag: 4, dmg: 8, base: 18, pre: 1, range: 3 } },
  0x89: { off: 0x6d9a, args: [10, 100, 38, 0x66, 1], ray: { mag: 10, dmg: 100, base: 38, pre: 0x66, range: 1 } },
  0x8b: { off: 0x5cfa, args: [] },
  0x8c: { off: 0x6d9a, args: [200, 1, 37, 0x64, 1], ray: { mag: 200, dmg: 1, base: 37, pre: 0x64, range: 1 } },
  0x8d: { off: 0x78da, args: [] }, 0x8e: { off: 0x79c2, args: [] }, 0x8f: { off: 0x7b2e, args: [] }, 0x90: { off: 0x7c40, args: [] },
};
export type ItemCallee = (off: number, args: number[], effect: number) => number;
const s16 = (v: number) => (v << 16) >> 16;

export function useItem(a: A4Mem, rng: BcRng, t1: number[], ch: number, item: number, callee: ItemCallee, ui: (off: number, args: number[]) => void = () => {}): number {
  if ((getL(a, CELL(a.w(0x1742), a.w(0x1740))) & 0x40000000) !== 0) return 1;
  let d3 = 0, e = a.w(OBJ(item) + 0xe);
  if (e === 0x95) e = (rng.rand16(10) + 0x80) & 0xffff;
  if (e >= 0x96 && e < 0xaa && e !== 0x9e) d3 = 1;
  const c = CH(ch), tick = getL(a, 0x1750);
  const redraw = () => ui(0x170a8, [ch, 1]);
  const heal = () => { a.setW(c + 0x4e, rng.rand16(16) + a.w(c + 0x4e) + 2); if (a.sw(c + 0x4e) > a.sw(c + 0x50)) a.setW(c + 0x4e, a.w(c + 0x50)); redraw(); d3 = 1; };
  const ev = (type: number, due: number, a2: number, a3: number) => scheduleEvent(a, type, due >>> 0, ch, a2, a3, 0, 0);
  const x = e - 0x80;
  if (x >= 0 && x < 0x20) {
    const fx = ITEM_EFFECTS[e];
    if (fx) d3 = callee(fx.off, fx.args, e) & 0xffff;
    else switch (e) {
      case 0x8a: for (let k = 0; k < 4; k++) if (a.sw(CH(k) + 0x4e) > 0) { a.setW(CH(k) + 0x52, 0x1388); a.setW(CH(k) + 0x54, 0x1388); } d3 = 1; break;
      case 0x96: case 0x9d: heal(); break;
      case 0x97: a.setB(c + 0x8c, a.b(c + 0x8c) + 1); ev(0x1e, tick + 900, 0x0a, 0); d3 = 1; break;
      case 0x98: if (a.b(c + 0x8b) === 0) a.setB(c + 0x9a, a.b(c + 0x9a) + 1); redraw(); d3 = 1; break;
      case 0x99: a.setB(c + 0x9a, 0); redraw(); d3 = 1; break;
      case 0x9a: a.setB(c + 0x97, 0); redraw(); d3 = 1; break;
      case 0x9b: if (a.b(c + 0x88) === 0) a.setB(c + 0x97, a.b(c + 0x97) + 1); redraw(); d3 = 1; break;
      case 0x9c: {
        const d7 = recastCancel(a, ch, 0x1f, 0) & 0xff;
        a.setB(c + 0x64, a.b(c + 0x64) - d7); a.setB(c + 0x64, a.b(c + 0x64) + 2);
        if (d7 === 0) a.setB(c + 0x78, a.b(c + 0x78) + 1);
        ev(0x1f, tick + 1800, 0, 2); redraw(); d3 = 1; break;
      }
      case 0x9e: a.setW(c + 0x54, a.w(c + 0x54) + a.w(OBJ(item) + 0x10)); if (a.sw(c + 0x54) > 0x1388) a.setW(c + 0x54, 0x1388); redraw(); d3 = 1; break;
      case 0x9f: a.setB(c + 0x86, a.b(c + 0x86) + 1); ev(0x1e, tick + 900, 4, 0); d3 = 1; break;
      default: break;
    }
  }
  if (d3 !== 0) {
    if (a.b(OBJ(item) + 7) !== 0xff) a.setB(OBJ(item) + 7, a.b(OBJ(item) + 7) - 1);
    adjustVitals(a, t1, a.w(0x1a24), -1, 0, 0);
  }
  return s16(d3);
}

/**
 * LIGHT `+0x58C6` (item effect 0x80, also the tail of spell 1): `light (A4+0x1754) += 120` (16-bit wrap), then the palette setter `+0x2D46(1)` and one redraw `+0x4AE` (both UI, hooked), returns 1.
 * No RNG, no other state. Harness: `rules-light.test.ts` against `vectors_light.json.gz` (40 / 40, null control).
 */
export function lightEffect(a: A4Mem, calls?: number[][]): number {
  a.setW(0x1754, (a.w(0x1754) + 120) & 0xffff);
  calls?.push([0x2d46, 1], [0x4ae]);
  return 1;
}

/**
 * HOLD `+0x58FA(n)` (monster hold bolt n = 18, item effect 0x7C..): `A4+0x1756 += n` (word), and when the screen mode `A4+0x174A` is 1 or 10 the UI call `+0x14920(1, 1)` plus `A4+0x174C = 1`;
 * then a message, `A4+0x1E80 = A4+0x1E82 = 0`, return 1. No RNG. Harness: `rules-light.test.ts` (vectors_hold.json.gz); the "party-click whitelist" itself is a separate routine (see game-rules 16.2).
 */
export function holdEffect(a: A4Mem, n: number): number {
  a.setW(0x1756, (a.w(0x1756) + n) & 0xffff);
  const m = a.w(0x174a);
  if (m === 1 || m === 10) a.setB(0x174c, 1);
  a.setW(0x1e80, 0); a.setW(0x1e82, 0);
  return 1;
}

import { describe, it, expect } from 'vitest';
import { Mm2Engine, newGameState, type Mm2World } from './engine';
import { retailFiles, haveRetail } from './node-files';
import { startBattle, battleRound } from './round';
import { roundLoop, encounter, type ActEffect } from '../rules2';
import { charPtr } from '../rules';
import { g } from '../rules-mem';
import type { FlatMem } from './image';

const have = haveRetail();
const world = (): Mm2World => Mm2Engine.load(retailFiles(), 'amiga') as Mm2World;

/** a memory image standing just before `fight()`: the party on a screen, the monster list built by the real encounter generator */
function preFight(w: Mm2World, seed: number, screen: number): FlatMem {
  const st = newGameState(w, seed, { screen, x: 3, y: 3 });
  const m = st.mem.clone();
  for (let i = 0; i < 11; i++) m.w8(g(-4574) + i, 0);
  m.w8(g(-30654), 0); m.w8(g(-31083), 0); m.w8(g(-4564), 0);
  encounter(m, { keys: [0x41, 0x41], nums: [], pays: [] });
  return m;
}
const script = (seed: number, n: number): ActEffect[] => {
  let z = seed >>> 0; const r = (k: number) => { z = Math.imul(z ^ (z >>> 15), 0x2c1b3c6d) >>> 0; z = (z + 0x6d2b79f5) >>> 0; return z % k; };
  return Array.from({ length: n }, () => { const c = [0, 0, 0, 4, 5, 6][r(6)]; return [c, r(4), c === 5 ? 1 << r(7) : c === 6 ? 1 + r(60) : 0] as ActEffect; });
};

describe.skipIf(!have)('round driver vs rules2.roundLoop (same memory, same scripted action effects)', () => {
  it('writes every byte the harness-verified loop writes and acts in the same order', () => {
    const w = world();
    let rounds = 0, actions = 0;
    for (let k = 0; k < 30; k++) {
      const pre = preFight(w, 1000 + k, [17, 19, 22, 26, 5, 12][k % 6]);
      const sc = script(k * 7 + 1, 24);
      const A = pre.clone();
      const ref = roundLoop(A, sc);
      const B = pre.clone();
      const seen: string[] = [];
      let used = 0;
      const eff = () => sc[used++] ?? ([1, 0, 0] as ActEffect);
      const apply = (e: ActEffect) => {
        const [c, a, b] = e;
        if (c === 1) B.w8(g(-1315), 1);
        else if (c === 2) B.w8(g(-30654), 0);
        else if (c === 3) { for (let q = 0; q < B.r16(g(-31066)); q++) B.w8(charPtr(B, q) + 38, 0x81); }
        else if (c === 4) B.w8(g(-1294) + a, 0);
        else if (c === 5) B.w8(g(-1305) + a, B.r8(g(-1305) + a) | b);
        else if (c === 6) B.w8(charPtr(B, a) + 110, b);
      };
      startBattle(B);
      for (;;) {
        rounds++;
        const over = battleRound(B, {
          party: i => { seen.push(`p${i}`); const e = eff(); B.w8(g(-24128) + i, B.r8(g(-24128) + i) + 1); apply(e); },
          monster: i => { seen.push(`m${i}`); const e = eff(); B.w8(g(-24138) + i, B.r8(g(-24138) + i) + 1); apply(e); },
        });
        if (over) break;
      }
      actions += seen.length;
      const refSeen = ref.calls.filter(c => c[0] === 'pact' || c[0] === 'mact').map(c => (c[0] === 'pact' ? 'p' : 'm') + c[1][0]);
      expect(seen).toEqual(refSeen);
      expect(Buffer.from(B.win).equals(Buffer.from(A.win))).toBe(true);
    }
    expect(actions).toBeGreaterThan(100);
    expect(rounds).toBeGreaterThan(30);
  });

  it('null control: skipping the status decay of a round diverges from the loop', () => {
    const w = world();
    let differs = 0;
    for (let k = 0; k < 30; k++) {
      const pre = preFight(w, 2000 + k, 17);
      const sc: ActEffect[] = [[5, 0, 0x04], [5, 1, 0x08], [5, 2, 0x40], ...script(k, 20)];
      const A = pre.clone(); roundLoop(A, sc);
      const B = pre.clone(); let used = 0;
      startBattle(B);
      const eff = () => sc[used++] ?? ([1, 0, 0] as ActEffect);
      const apply = (e: ActEffect) => { const [c, a, b] = e; if (c === 1) B.w8(g(-1315), 1); else if (c === 4) B.w8(g(-1294) + a, 0); else if (c === 5) B.w8(g(-1305) + a, B.r8(g(-1305) + a) | b); else if (c === 6) B.w8(charPtr(B, a) + 110, b); };
      for (;;) {
        const over = battleRound(B, { party: i => { const e = eff(); B.w8(g(-24128) + i, B.r8(g(-24128) + i) + 1); apply(e); }, monster: i => { const e = eff(); B.w8(g(-24138) + i, B.r8(g(-24138) + i) + 1); apply(e); } }, { noDecay: true });
        if (over) break;
      }
      if (!Buffer.from(B.win).equals(Buffer.from(A.win))) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });
});

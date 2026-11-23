/**
 * Diffs tools/wizardry6/rules.ts against vectors produced by running Bane's own routines under
 * Unicorn (tools/wizardry6/oracle/rules.py). The vectors are committed
 * (oracle/rules-vectors.json), so this test needs neither the retail data nor Python.
 * Null controls: each check is repeated with a deliberately wrong rule and must fail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HP_DICE,
  W6Rng,
  levelUpAttributes,
  levelUpHpStamina,
  levelsGained,
  spellTierAfterLevel,
  xpToAdvance,
} from '../rules.ts';

const V = JSON.parse(readFileSync(resolve('tools/wizardry6/oracle/rules-vectors.json'), 'utf8'));
const st = (a: number[]) => a as [number, number, number];
// Section-0 XP tables are retail data; the vector file embeds the ones it used.
const XP: number[][] = V.xpTables;

describe('W6 random generator (CODE+0xb9c / 0x2138 / 0x21b6)', () => {
  it('raw outputs match the game for 30 seeds x 8 draws', () => {
    for (const r of V.raw) {
      const g = new W6Rng(st(r.seed));
      expect(r.raw.map(() => g.raw())).toEqual(r.raw);
    }
  });
  it('Random(n) matches for n in 1..300, 0 and negative, and the state after', () => {
    for (const r of V.random) {
      const g = new W6Rng(st(r.seed));
      for (const [n, v] of r.calls) expect(g.random(n)).toBe(v);
      expect(g.s).toEqual(r.after);
    }
  });
  it('null control: a different seed disagrees', () => {
    const r = V.raw[0];
    const g = new W6Rng([r.seed[0] + 1, r.seed[1], r.seed[2]]);
    expect(r.raw.map(() => g.raw())).not.toEqual(r.raw);
  });
});

describe('level-up HP and stamina (LAB_16B3, CODE+0x3db86)', () => {
  const run = (dice: typeof HP_DICE) => {
    let bad = 0;
    for (const r of V.levelHp) {
      const g = new W6Rng(st(r.seed));
      const saved = HP_DICE.slice();
      dice.forEach((d, i) => ((HP_DICE as { die: number; bonus: number }[])[i] = d));
      const o = levelUpHpStamina(g, r.cls, r.str, r.vit, r.level, r.thr431);
      saved.forEach((d, i) => ((HP_DICE as { die: number; bonus: number }[])[i] = d));
      if (o.hp !== r.hpGain || o.hp !== r.hpCurGain || o.stamina !== r.stGain || o.stamina !== r.stCurGain) bad++;
      else if (g.s.join() !== r.after.join()) bad++;
    }
    return bad;
  };
  it('matches the game on 840 random cases, all 14 classes, RNG state included', () => {
    expect(V.levelHp.length).toBe(840);
    expect(run(HP_DICE.slice())).toBe(0);
  });
  it('null control: a perturbed class table fails', () => {
    const wrong = HP_DICE.map((d) => ({ die: d.die, bonus: d.bonus + 1 }));
    expect(run(wrong)).toBeGreaterThan(100);
  });
});

describe('level-up attribute raise (LAB_16EA, CODE+0x3e688)', () => {
  it('matches the game on 120 cases incl. attributes at the 18 cap', () => {
    for (const r of V.levelAttr) {
      const g = new W6Rng(st(r.seed));
      const a = [...r.attrs];
      levelUpAttributes(g, a);
      expect(a).toEqual(r.after);
      expect(g.s).toEqual(r.rng);
    }
  });
  it('null control: cap 19 instead of 18 fails somewhere', () => {
    let diff = 0;
    for (const r of V.levelAttr) {
      const g = new W6Rng(st(r.seed));
      const a = [...r.attrs].map((x) => (x === 18 ? 17 : x));
      levelUpAttributes(g, a);
      if (a.join() !== r.after.join()) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });
});

describe('spell tier (LAB_16F1, CODE+0x3e86e) and CheckLevelUp (LAB_16FE, CODE+0x3eade)', () => {
  it('spell tier matches for levels 1..39', () => {
    for (const r of V.spellTier) expect(spellTierAfterLevel(r.level, r.cur)).toBe(r.after);
  });
  it('levels gained matches the game on 300 (class, level, xp) cases through ReadSection', () => {
    expect(V.checkLevelUp.length).toBe(300);
    for (const r of V.checkLevelUp) expect(levelsGained(XP[r.cls], r.level, r.xp)).toBe(r.levelsGained);
  });
  it('null control: using table[level] instead of table[level-1] fails', () => {
    let diff = 0;
    for (const r of V.checkLevelUp) {
      const t = XP[r.cls];
      const shifted = [0, ...t.slice(0, 15), t[15]];
      if (levelsGained(shifted, r.level, r.xp) !== r.levelsGained) diff++;
    }
    expect(diff).toBeGreaterThan(10);
  });
  it('threshold past level 16 is linear in the last table step', () => {
    const t = XP[0];
    expect(xpToAdvance(t, 16)).toBe(t[15]);
    expect(xpToAdvance(t, 18)).toBe(t[15] + 2 * (t[15] - t[14]));
  });
});

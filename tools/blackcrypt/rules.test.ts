import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng, levelUp, weaponInfo, meleeAttack } from './rules';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8'));
const T = V.tables;

describe('Black Crypt rules vs 68k oracle', () => {
  it('RNG matches the game byte generator', () => {
    for (const c of V.rng) {
      const r = new BcRng(c.seed);
      const out = c.out.map(() => (c.kind === 0 ? r.byte() : c.kind === 8 ? r.rand8(c.n) : r.rand16(c.n)));
      expect(out).toEqual(c.out);
    }
  });
  it('level-up', () => {
    for (const c of V.levelup) {
      const ch = { level: c.level, xp: c.xp, con: c.con, hp: c.hp, maxHp: c.hp };
      levelUp(ch, T, new BcRng(c.seed));
      expect([ch.level, ch.hp, ch.maxHp]).toEqual([c.newLevel, c.hpAfter, c.maxHpAfter]);
    }
  });
  it('weapon lookup matches 256x256 oracle matrix', () => {
    for (const m of [0xb3, ...Object.keys(V.weaponSpecial).map(Number)]) {
      for (let g = 1; g < 256; g++) {
        const exp = V.weaponSpecial[String(m)]?.[String(g)] ?? (V.weaponBase[String(g)] ? [...V.weaponBase[String(g)], 7] : null);
        if (!V.weaponBase[String(g)] || !exp || exp[0] === -4370) continue;
        const r = weaponInfo({ cls: 0, level: 5, gfx: g, extra: 7, monType: m, activeItem36Gfx: 0 }, V.weaponBase);
        expect([r!.base, r!.sides, r!.bonus]).toEqual(exp);
      }
    }
  });
  it('bare hand', () => {
    for (const b of V.bareHand) {
      const r = weaponInfo({ cls: b.cls, level: b.level, gfx: 0, extra: 0, monType: 0xb3, activeItem36Gfx: 0 }, V.weaponBase)!;
      expect([r.base, r.sides]).toEqual([b.base, b.sides]);
    }
  });
  const run = (c: any, tweak = 0) => {
    const info = weaponInfo({ cls: c.cls, level: c.level, gfx: c.gfx, extra: c.extra, monType: 0xb3, activeItem36Gfx: 0 }, V.weaponBase)!;
    return meleeAttack({ level: c.level, str: c.str, b6c: c.b6c, monHit: c.monHit, monHp: c.monHp, info: { ...info, base: info.base + tweak }, item: c.item }, T, new BcRng(c.seed)).monHp;
  };
  it('melee matches oracle', () => {
    for (const c of V.melee) expect(run(c)).toBe(c.monHpAfter);
  });
  it('null control: perturbed formula disagrees', () => {
    const bad = V.melee.filter((c: any) => run(c, 1) !== c.monHpAfter).length;
    expect(bad).toBeGreaterThan(20);
  });
});

import { existsSync, readFileSync as rf } from 'node:fs';
import { extractRulesTables } from './rules-tables';
const root = resolve(here, '../..');
const have = existsSync(resolve(root, 'build/cache/blackcrypt/bcdft_decompressed.bin')) && existsSync(resolve(root, 'data/blackcrypt/amiga/bcdfp'));
describe.skipIf(!have)('rules-tables extractor vs oracle', () => {
  it('matches vectors', () => {
    const t = extractRulesTables(rf(resolve(root, 'build/cache/blackcrypt/bcdft_decompressed.bin')), rf(resolve(root, 'build/cache/blackcrypt/bcdft_s2_data.bin')), rf(resolve(root, 'data/blackcrypt/amiga/bcdfp')));
    const { 0: _bare, ...rest } = V.weaponBase; expect(t.weaponBase).toEqual(rest);
    expect(t.statBonusT1).toEqual(V.tables.statBonusT1);
    expect(t.speedT3).toEqual(V.tables.speedT3);
    expect(t.spells[0].name).toBe('POISON CLOUD');
    expect(t.monsterAi.starts).toEqual(V.aiScripts.starts);
    expect(t.monsterAi.cells).toEqual(V.aiScripts.cells);
    expect(t.creation.statNames).toEqual(['STR', 'INT', 'WIS', 'DEX', 'CON']);
    expect(t.classes.map(c => c.name)).toEqual(['FIGHTER', 'CLERIC', 'MAGIC USER', 'DRUID']);
  });
});

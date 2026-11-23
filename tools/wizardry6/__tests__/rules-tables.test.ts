import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractRulesTables } from '../rules-tables.ts';

const DATA = process.env.W6_DATA ?? resolve('data/wizardry6/amiga');
const have = ['Bane', 'scenario.dbs', 'msg.hdr', 'msg.dbs', 'misc.hdr'].every((f) => existsSync(join(DATA, f)));

describe.skipIf(!have)('W6 rules-tables extractor (retail data)', () => {
  const { tables, messages } = have ? extractRulesTables(DATA) : ({} as never);
  it('decodes the full message corpus with the game framing', () => {
    expect(Object.keys(messages).length).toBe(5164);
    // the old extractor returned "STRENG" (first string, length byte misread)
    expect(messages[5050]).toBe('STRENGTH');
    expect(messages[4077]).toBe('RESURRECTION');
  });
  it('class / race / spell tables have the documented shape', () => {
    expect(tables.classes.map((c: { name: string }) => c.name).slice(0, 3)).toEqual(['FIGHTER', 'MAGE', 'PRIEST']);
    expect(tables.classes[0].xpTable[0]).toBe(1000);
    expect(tables.races.length).toBe(11);
    expect(tables.races[0].baseAttrs).toEqual([9, 8, 8, 9, 9, 8, 8, 0]);
    expect(tables.spells.length).toBe(82);
    expect(tables.spells[77]).toMatchObject({ name: 'RESURRECTION', realm: 5, level: 7 });
    // all 82 names resolved and levels within 1..7
    // 0..78 are the castable spells (level 1..7); 79..81 (HOLY WATER, HELPFOOD, MAGICFOOD) are item effects with level 0
    for (const s of tables.spells) {
      expect(s.name.length).toBeGreaterThan(0);
      if (s.id < 79) { expect(s.level).toBeGreaterThanOrEqual(1); expect(s.level).toBeLessThanOrEqual(7); }
      else expect(s.level).toBe(0);
    }
  });
  it('class minimums: every class needs its namesake attribute', () => {
    expect(tables.classes[0].minAttrs[0]).toBe(12); // FIGHTER STR
    expect(tables.classes[1].minAttrs[1]).toBe(12); // MAGE INT
    expect(tables.classes[2].minAttrs[2]).toBe(12); // PRIEST PIE
  });
});

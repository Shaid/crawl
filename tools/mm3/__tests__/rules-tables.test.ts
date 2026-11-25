/**
 * The exported rules tables (tools/mm3/rules-tables.ts) must equal, byte for byte, every table byte the real routines read
 * under Unicorn (the committed / generated vectors). Skipped when the retail executable is not present.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { load } from './vectors.ts';
import { A4V } from '../rules-mem.ts';
import { TABLES, buildRulesTables } from '../rules-tables.ts';

vi.setConfig({ testTimeout: 180000 });
const EXE = 'data/mm3/amiga/Might&MagicIII';
const UNITS = ['bracket', 'getstat', 'equip', 'maxhp', 'ac', 'maxsp', 'xpnext', 'weapon', 'partyhit', 'element', 'item', 'castpay', 'castrefund', 'spellsp', 'spellprice', 'levelthr', 'shortfall', 'monturn', 'mondmg', 'initiative', 'monattack', 'meleeround'];
const W = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4 } as const;

describe.skipIf(!existsSync(EXE))('rules-tables.json', () => {
  const j = buildRulesTables(readFileSync(EXE));
  it('matches every table byte the verified routines read', () => {
    const byAddr = new Map<number, number>();
    for (const t of TABLES) {
      const vals = j.tables[t.name].values;
      const sz = W[t.width];
      vals.forEach((v, i) => {
        const bytes = sz === 1 ? [v & 0xff] : sz === 2 ? [(v >> 8) & 0xff, v & 0xff] : [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
        bytes.forEach((b, k) => byAddr.set(A4V + t.a4 + i * sz + k, b));
      });
    }
    let hits = 0;
    for (const u of UNITS) for (const v of load(u)) for (const [k, b] of Object.entries<number>(v.init)) {
      const e = byAddr.get(Number(k));
      if (e !== undefined) { hits++; expect(e, `${u} A4${Number(k) - A4V}`).toBe(b); }
    }
    expect(hits).toBeGreaterThan(5000);
  });
  it('spell names and costs', () => {
    expect(j.spells[0].name).toBe('Light');
    expect(j.spells[36].name).toBe('Fireball');
    expect(j.spells[76].name).toBe('Divine Intervention');
    expect(j.spellNone).toEqual(['None Ready', 'None', 'Fountain Head']);
  });
});

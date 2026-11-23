/** shared fixtures of the unified-world tests (not a test file) */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiScripts } from './rules-monster';
import { startingParty } from './combat-sim';
import { BcSim, type BcConfig, type MonsterSpec } from './bc-sim';

const here = dirname(fileURLToPath(import.meta.url));
export const V = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8'));
export const tables = V.tables, scripts: AiScripts = V.aiScripts;
export const cfg = (o: Partial<BcConfig> = {}): BcConfig => ({ tables, weaponBase: V.weaponBase, scripts, seed: 'a27740bfd561', ...o });
export const mon = (o: Partial<MonsterSpec> = {}): MonsterSpec => ({
  x: 12, y: 11, gfx: 0x80b3, monType: 0, b2: 10, b3: 0x04, b5: 5, b6: 2, b7: 0, hp: 40, maxHp: 40, xpBase: 50, w0c: 0, moveType: 0, pos: 4, ...o,
});
/** a 8x3 room at (10..17, 10..12), the party at (11, 11) facing +x, the starting party in slot order */
export function mkSim(o: { cfg?: Partial<BcConfig>; monsters?: Partial<MonsterSpec>[]; weapon?: { gfx: number; extra?: number }; hp?: number[] } = {}): BcSim {
  const s = new BcSim(cfg(o.cfg));
  s.room(10, 10, 17, 12);
  s.party(11, 11, 1);
  startingParty(tables).forEach((c, k) => s.setChar(k, { ...c, hp: o.hp?.[k] ?? c.hp }));
  if (o.weapon) { const it = s.item(30, o.weapon); s.give(0, it, 0x1c); }
  for (const m of o.monsters ?? [{}]) s.addMonster(mon(m));
  return s;
}

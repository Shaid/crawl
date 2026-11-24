/**
 * Glue that runs a cast through the verified pieces: the cast gate (spells.ts castSpell, LAB_0F72), the effect
 * dispatcher (castEffect, LAB_0F06) and the leaf engines (engines.ts). The dispatcher calls its engines through
 * {@link makeEngines}; the engines' own effects (party panel syncs, logged by the game) land in `fx`.
 */
import { resistScale, s16, type Effect } from './combat.ts';
import { areaDamage, areaStatus, areaStatus2, damageOne, groupAll, groupDrain, groupPrismic, groupWeak } from './engines.ts';
import type { Ctx } from './planner.ts';
import { castEffect, castSpell, type Engines } from './spells.ts';
import table from './spell-table.json' with { type: 'json' };
import { summon, type EncounterIO } from './encounter.ts';

/** Write the 82-row spell table (A4-31698, 6 bytes each) into memory. */
export function loadSpellTable(c: Ctx): void {
  (table as { rows: number[][] }).rows.forEach((r, i) => r.forEach((v, k) => c.m.w8(c.a4 - 31698 + i * 6 + k, v)));
}

export function makeEngines(c: Ctx, fx: Effect[], io?: EncounterIO): Engines {
  return {
    call(name, w) {
      const u = w.map((x) => x & 0xffff);
      switch (name) {
        case 'area_dmg': areaDamage(c, u, fx); return 0;
        case 'area_stat': areaStatus(c, u, fx); return 0;
        case 'area_stat2': areaStatus2(c, u, fx); return 0;
        case 'grp_all': groupAll(c, u, fx); return 0;
        case 'grp_drain': groupDrain(c, u, fx); return 0;
        case 'grp_weak': groupWeak(c, u, fx); return 0;
        case 'grp_pm': groupPrismic(c, u, fx); return 0;
        case 'spelldmg': { const [g, t, d1, sd, d2, res, mod] = w.map(s16); return damageOne(c, fx, g, t, d1, sd, d2, res, mod); }
        case 'resscale': { const [g, mag, res, mod] = w.map(s16); return resistScale(c.m, c.rng, c.a4, g, mag, res, mod); }
        case 'psync': fx.push(['psync', u.map((x) => x.toString(16).padStart(4, '0')).join('')]); return 0;
        case 'summon':
          if (!io) throw new Error('summon needs a monster loader (EncounterIO)');
          summon(c, io, w.slice(0, 6), s16(w[6])); return 0;
        default: throw new Error(`engine ${name} not wired`);
      }
    },
  };
}

/** One full cast by member A (LAB_0F72 -> LAB_0F06 -> engines). Returns the stamina cost the round executor charges. */
export function castAction(c: Ctx, A: number, fx: Effect[], io?: EncounterIO): number {
  const eng = makeEngines(c, fx, io);
  return castSpell(c, A, (a, spell, power) => castEffect(c, a, spell, power, eng));
}

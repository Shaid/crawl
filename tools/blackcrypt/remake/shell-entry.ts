/**
 * Black Crypt's registration for the generic shell (tools/remake): data directory, engine factory (binds the rules tables), key map, HUD and event text.
 * The walker-page hook (`browser.ts`) uses the same entry, so both front ends drive the engine identically.
 */
import { BcEngine, describeEvent, type BcRulesData, type BcView, type BcEvent } from './engine';
import { DEFAULT_KEYMAP } from './play-loop';
import type { EngineEntry, AssetAccess } from '../../remake/registry';

const QUIET = new Set(['step-party', 'ramp']);

export const bcHud = (v: BcView): string[] => {
  const ahead = v.ahead.monsters.length ? `ahead: ${v.ahead.monsters.length} monster(s)` : '';
  return [
    `map ${v.map}  tick ${v.tick}  (${v.pose.x},${v.pose.y}) ${'NESW'[v.pose.facing]}  ${ahead}${v.gameOver ? '  GAME OVER' : ''}`,
    ...v.party.map(p => ` ${p.name.padEnd(10)} L${p.level} ${String(p.hp).padStart(3)}/${String(p.maxHp).padEnd(3)} ${p.alive ? '' : 'DEAD'} [${p.spells.join(' ') || '-'}]`),
  ];
};

/** the rules tables: committed vectors (no retail data) + the generated spell-book tables when the asset pipeline has produced them */
export async function bcEngine(assets: AssetAccess) {
  const V = (await import('../rules_oracle/vectors.json')).default as unknown as { tables: BcRulesData['tables']; weaponBase: BcRulesData['weaponBase']; aiScripts: BcRulesData['scripts'] };
  const rt = await assets.json<{ spellBook?: BcRulesData['spells'] }>('data/rules-tables.json');
  return BcEngine.withRules({ tables: V.tables, weaponBase: V.weaponBase, scripts: V.aiScripts, spells: rt?.spellBook });
}

export const bcEntry: EngineEntry = {
  id: 'blackcrypt',
  title: 'Black Crypt (Amiga)',
  dataDirs: ['blackcrypt/amiga'],
  assetBase: '/assets/blackcrypt/amiga',
  engine: BcEngine,
  bind: assets => bcEngine(assets),
  hints: {
    keymap: DEFAULT_KEYMAP,
    help: 'W/S move, Q/E turn (hold to repeat), O open door (or click the door), Space or 1-4 attack. Spell keys are in the walker page only.',
    describeEvent: (e: BcEvent) => (QUIET.has(e.what) ? null : `${e.tick} ${describeEvent(e)}`),
    hud: bcHud,
    regions: { PAL: 160, NTSC: 1000 / 6 },
    viewUrl: '/tools/walker/index.html?game=blackcrypt&play=1',
    viewFactory: async ctx => (await import('./view-factory')).createBcView(ctx),
  },
};

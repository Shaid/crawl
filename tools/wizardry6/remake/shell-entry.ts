/**
 * Wizardry 6's registration for the generic shell (tools/remake): data directory, engine factory (binds the walker's generated level files and the decoded message text),
 * a static key map, HUD and event text, and the in-shell 3D view. The key map cannot depend on the game's mode, so it is the union of explore / combat / loot keys with no key
 * doing two jobs (a command sent in the wrong mode is refused by the engine and harmless); the walker-page hook (`browser.ts`, `keys.ts`) has the richer mode-aware policy.
 * Registering is ONE line in tools/remake/engines.ts.
 */
import { W6Engine, makeEngine, parseLevels, describeEvent, type W6Cmd, type W6View, type W6Event, type W6Assets } from './engine';
import { W6Keys, hudLines } from './keys';
import type { EngineEntry, AssetAccess } from '../../remake/registry';

const k = (cmd: W6Cmd, repeat = false) => ({ cmd, repeat });
export const W6_KEYMAP: Record<string, { cmd: W6Cmd; repeat: boolean }> = {
  KeyW: k({ kind: 'move', dir: 'forward' }, true), ArrowUp: k({ kind: 'move', dir: 'forward' }, true),
  KeyS: k({ kind: 'move', dir: 'back' }, true), ArrowDown: k({ kind: 'move', dir: 'back' }, true),
  KeyA: k({ kind: 'move', dir: 'left' }, true), KeyD: k({ kind: 'move', dir: 'right' }, true),
  KeyQ: k({ kind: 'turn', by: -1 }, true), ArrowLeft: k({ kind: 'turn', by: -1 }, true), KeyE: k({ kind: 'turn', by: 1 }, true), ArrowRight: k({ kind: 'turn', by: 1 }, true),
  KeyR: k({ kind: 'camp' }), KeyU: k({ kind: 'pickLock', who: 0 }), KeyM: k({ kind: 'encounter' }), KeyK: k({ kind: 'chest' }),
  Space: k({ kind: 'round' }), Enter: k({ kind: 'round' }), KeyF: k({ kind: 'planAll', plan: { act: 'run' } }), KeyH: k({ kind: 'planAll', plan: { act: 'hide' } }),
  KeyT: k({ kind: 'takeAll' }), KeyL: k({ kind: 'leaveLoot' }), KeyI: k({ kind: 'chestInspect', who: 0 }), KeyO: k({ kind: 'chestOpen', who: 0 }),
};

/** the generated assets the engine needs beyond the user's files: the walker's level files and the decoded message text */
export async function w6Assets(assets: AssetAccess): Promise<W6Assets> {
  const raws = await Promise.all(Array.from({ length: 14 }, (_, l) => assets.json<unknown>(`dungeon/level${String(l).padStart(2, '0')}.json`)));
  if (raws.some(r => !r)) throw new Error('wizardry6: dungeon level files missing (npm run w6:levels)');
  const mf = await assets.json<{ messages: Record<string, string> }>('data/messages-full.json');
  return { levels: parseLevels(raws), msg: mf ? id => mf.messages[String(id)] : undefined };
}

export const w6Entry: EngineEntry = {
  id: 'wizardry6',
  title: 'Wizardry VI: Bane of the Cosmic Forge (Amiga)',
  dataDirs: ['wizardry6/amiga'],
  assetBase: '/assets/wizardry6/amiga',
  engine: W6Engine,
  bind: async assets => makeEngine(await w6Assets(assets)),
  hints: {
    keymap: W6_KEYMAP,
    help: 'W/S/A/D move, Q/E turn, R camp, U pick the lock ahead, M meet wandering monsters (debug), K chest (debug); in a fight Space plays a round (F run / H hide for everyone first); T takes loot, L leaves.',
    describeEvent: (e: W6Event) => (e.what === 'turn' || e.what === 'bump' ? null : `${e.tick} ${describeEvent(e)}`),
    hud: (v: W6View) => hudLines(v, new W6Keys(), []).slice(0, 9),
    newGameOptions: {},
    viewUrl: '/tools/walker/index.html?game=wizardry6&play=1',
    viewFactory: async ctx => (await import('./view-factory')).createW6View(ctx),
  },
};

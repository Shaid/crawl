/**
 * Might & Magic II's registration for the generic shell (tools/remake): data directory, a static key map, HUD and event text. The shell's key map cannot depend on the game's mode,
 * so it is the union of explore / prompt / battle keys with no key doing two jobs (a command sent in the wrong mode is refused by the engine and harmless); the walker-page hook
 * (`browser.ts`, `keys.ts`) has the richer mode-aware policy (per-member orders, spell choice). Turn based: the shell calls `step` only when a key produced a command.
 * Registering is ONE line in tools/remake/engines.ts: `import { mm2Entry } from '../mm2/remake/shell-entry';` and add `mm2Entry` to the list.
 */
import { Mm2Engine, describeEvent, type Mm2Cmd, type Mm2View, type Mm2Event } from './engine';
import { Mm2Keys, hudLines } from './keys';
import type { EngineEntry } from '../../remake/registry';

const k = (cmd: Mm2Cmd, repeat = false) => ({ cmd, repeat });
export const MM2_KEYMAP: Record<string, { cmd: Mm2Cmd; repeat: boolean }> = {
  KeyW: k({ kind: 'move', dir: 'forward' }, true), ArrowUp: k({ kind: 'move', dir: 'forward' }, true),
  KeyS: k({ kind: 'move', dir: 'back' }, true), ArrowDown: k({ kind: 'move', dir: 'back' }, true),
  KeyQ: k({ kind: 'turn', by: -1 }, true), ArrowLeft: k({ kind: 'turn', by: -1 }, true), KeyE: k({ kind: 'turn', by: 1 }, true), ArrowRight: k({ kind: 'turn', by: 1 }, true),
  KeyR: k({ kind: 'rest' }), KeyU: k({ kind: 'unlock', char: 5 }), KeyB: k({ kind: 'bash' }), KeyM: k({ kind: 'encounter' }), KeyT: k({ kind: 'train', char: 0 }), KeyL: k({ kind: 'takeLoot', char: 0 }),
  KeyA: k({ kind: 'prompt', choice: 'attack' }), KeyH: k({ kind: 'prompt', choice: 'hide' }), KeyF: k({ kind: 'prompt', choice: 'run' }),
  Space: k({ kind: 'round' }), Enter: k({ kind: 'round' }),
};

export const mm2Entry: EngineEntry = {
  id: 'mm2',
  title: 'Might and Magic II (Amiga)',
  dataDirs: ['mm2/amiga/data'],
  assetBase: '/assets/mm2/amiga',
  engine: Mm2Engine,
  hints: {
    keymap: MM2_KEYMAP,
    help: 'W/S move, Q/E turn, R rest, U unlock, B bash, M meet monsters (debug); at an encounter A attack / H hide / F run; in battle Space plays a round (everyone attacks).',
    describeEvent: (e: Mm2Event) => (e.what === 'event-cell' ? null : `${e.tick} ${describeEvent(e)}`),
    hud: (v: Mm2View) => hudLines(v, new Mm2Keys(), []).slice(0, 8),
    newGameOptions: { wanderPct: 5 },
    viewUrl: '/tools/walker/index.html?game=mm2&play=1',
    viewFactory: async ctx => (await import('./view-factory')).createMm2View(ctx),
  },
};

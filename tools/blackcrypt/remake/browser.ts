/**
 * Minimal browser shell for the Black Crypt engine: owns the tick clock (160 ms), key -> command mapping and a text HUD (party + message log). Rendering stays with the
 * walker's `BlackCryptView` (walls and static props only: live monster / door sprites are not driven by the engine yet). Enabled by `?game=blackcrypt&play=1` in the walker page.
 * Dev server only: the retail files are fetched from the Vite `/data/` middleware, never shipped.
 */
import { BcEngine, describeEvent, type BcState, type BcCmd, type BcRulesData } from './engine';
import { fileSetFromMap } from '../../remake/engine';

interface PoseLike { level: number; x: number; y: number; facing: 0 | 1 | 2 | 3 }
interface ViewLike { setPose(p: PoseLike): void; readonly pose: PoseLike }
export interface PlayHost { getView(): ViewLike; loadMap(level: number, pose: PoseLike): Promise<void>; setStatus(t: string): void }

export async function attachBlackCryptPlay(host: PlayHost, level: number) {
  const names = ['bcdfs', 'bcdfp', 'bcdft'];
  const bytes = await Promise.all(names.map(async n => { const r = await fetch(`/data/blackcrypt/amiga/${n}`); if (!r.ok) throw new Error(`${n}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }));
  const files = fileSetFromMap(new Map(names.map((n, i) => [n, bytes[i]])));
  const det = BcEngine.detect(files); if (!det) throw new Error('Black Crypt files not recognised');
  const V = (await import('../rules_oracle/vectors.json')).default as unknown as { tables: BcRulesData['tables']; weaponBase: BcRulesData['weaponBase']; aiScripts: BcRulesData['scripts'] };
  const eng = BcEngine.withRules({ tables: V.tables, weaponBase: V.weaponBase, scripts: V.aiScripts });
  const world = eng.load(files, det.variant) as ReturnType<typeof BcEngine.load>;
  const v0 = host.getView().pose;
  let st: BcState = BcEngine.newGame(world, (Date.now() >>> 0), { map: level, pose: { x: v0.x, y: v0.y, facing: v0.facing } });
  const logLines: string[] = [];
  const hud = document.createElement('pre');
  hud.style.cssText = 'font:12px monospace;margin:0;padding:6px;white-space:pre-wrap;max-height:40vh;overflow:auto;background:#111;color:#ddd';
  (document.getElementById('sidebar') ?? document.body).prepend(hud);

  let pending: BcCmd[] = [];
  const turn = (by: 1 | -1): BcCmd => ({ kind: 'turn', by });
  const keymap: Record<string, BcCmd> = {
    KeyW: { kind: 'move', dir: 'forward' }, ArrowUp: { kind: 'move', dir: 'forward' }, KeyS: { kind: 'move', dir: 'back' }, ArrowDown: { kind: 'move', dir: 'back' },
    KeyQ: turn(-1), ArrowLeft: turn(-1), KeyE: turn(1), ArrowRight: turn(1), KeyO: { kind: 'openDoor' },
    Space: { kind: 'attack', char: 0 }, Digit1: { kind: 'attack', char: 0 }, Digit2: { kind: 'attack', char: 1 }, Digit3: { kind: 'attack', char: 2 }, Digit4: { kind: 'attack', char: 3 },
  };
  window.addEventListener('keydown', ev => { const c = keymap[ev.code]; if (c && !ev.repeat) { pending.push(c); ev.preventDefault(); } });

  // `&keys=KeyW,KeyW,KeyE` pre-queues commands (for screenshots and smoke runs)
  for (const k of (new URLSearchParams(window.location.search).get('keys') ?? '').split(',')) if (keymap[k]) pending.push(keymap[k]);

  const draw = () => {
    const v = BcEngine.view(st);
    const rows = v.party.map(p => `${p.name.padEnd(10)} L${p.level} ${String(p.hp).padStart(3)}/${String(p.maxHp).padEnd(3)} ${p.alive ? '' : 'DEAD'}`);
    const ahead = v.ahead.monsters.length ? `ahead: ${v.ahead.monsters.length} monster(s)` : '';
    hud.textContent = `map ${v.map}  tick ${v.tick}  (${v.pose.x},${v.pose.y}) ${'NESW'[v.pose.facing]}  ${ahead}${v.gameOver ? '  GAME OVER' : ''}\n${rows.join('\n')}\n\n${logLines.slice(-14).join('\n')}\n\nW/S move, Q/E turn, O open door, Space or 1-4 attack`;
  };
  let acc = 0;
  draw();
  return {
    /** call once per animation frame; returns the pose to render when it changed */
    update(dtMs: number): PoseLike | null {
      acc += dtMs; let changed: PoseLike | null = null;
      while (acc >= BcEngine.timing.tickMs) {
        acc -= BcEngine.timing.tickMs;
        const before = BcEngine.view(st).map;
        const cmds = pending.splice(0, 2);
        for (const e of BcEngine.step(st, cmds)) if (!['step-party', 'ramp'].includes(e.what)) logLines.push(`${e.tick} ${describeEvent(e)}`);
        const v = BcEngine.view(st);
        const p = { level: v.map, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 };
        if (v.map !== before) { void host.loadMap(v.map, p); }
        else { const cur = host.getView().pose; if (cur.x !== p.x || cur.y !== p.y || cur.facing !== p.facing) { host.getView().setPose(p); changed = p; } }
        draw();
      }
      return changed;
    },
  };
}

/**
 * Browser shell for the Might & Magic II engine: DOM only. Turn based, so there is no clock: a key becomes one command (`keys.ts`), the engine steps, the HUD and the walker
 * pose are refreshed. Enabled by `?game=mm2&play=1` in the walker page. Dev server only: the retail files are fetched from the Vite `/data/` middleware, never shipped.
 * The walker view draws the static map, so a door opened in play is not drawn open (the engine's map is the truth; the HUD says "ahead: door").
 */
import { Mm2Engine, describeEvent, REQUIRED, type Mm2State, type Mm2World } from './engine';
import { Mm2Keys, hudLines } from './keys';
import { fileSetFromMap } from '../../remake/engine';

interface PoseLike { level: number; x: number; y: number; facing: 0 | 1 | 2 | 3 }
interface ViewLike { setPose(p: PoseLike): void; readonly pose: PoseLike }
export interface PlayHost { getView(): ViewLike; loadMap(level: number, pose: PoseLike): Promise<void>; setStatus(t: string): void }

export async function attachMm2Play(host: PlayHost, level: number) {
  const q = new URLSearchParams(window.location.search);
  const names = Object.keys(REQUIRED);
  const bytes = await Promise.all(names.map(async n => { const r = await fetch(`/data/mm2/amiga/data/${n}`); if (!r.ok) throw new Error(`${n}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }));
  const files = fileSetFromMap(new Map(names.map((n, i) => [n, bytes[i]])));
  const det = Mm2Engine.detect(files); if (!det) throw new Error('Might and Magic II files not recognised');
  const world = Mm2Engine.load(files, det.variant) as Mm2World;
  const wander = Number(q.get('wander') ?? 5);
  const st: Mm2State = Mm2Engine.newGame(world, q.has('seed') ? Number(q.get('seed')) : Date.now() >>> 0, { screen: level, wanderPct: wander }) as Mm2State;
  const keys = new Mm2Keys();
  const log: string[] = [];
  const hud = document.createElement('pre');
  hud.style.cssText = 'font:12px monospace;margin:0;padding:6px;white-space:pre-wrap;max-height:48vh;overflow:auto;background:#111;color:#ddd';
  (document.getElementById('sidebar') ?? document.body).prepend(hud);
  /** key codes, mapped to commands when they are played (a pre-queued `&keys=` list must see the mode the earlier keys produced) */
  const queue: string[] = [];
  const draw = () => { hud.textContent = hudLines(Mm2Engine.view(st), keys, log).join('\n'); };
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^Key|^Arrow|^Space|^Enter|^Digit/.test(ev.code)) { queue.push(ev.code); ev.preventDefault(); }
  });
  for (const code of (q.get('keys') ?? '').split(',')) if (code) queue.push(code);
  draw();
  return {
    /** once per animation frame; returns the pose to render when it changed */
    update(_dtMs: number): PoseLike | null {
      if (!queue.length) return null;
      let drawLater = false;
      const before = Mm2Engine.view(st).pose;
      for (const code of queue.splice(0)) {
        const c = keys.key(code, Mm2Engine.view(st));
        if (!c) { drawLater = true; continue; }
        const ev = Mm2Engine.step(st, [c]);
        for (const e of ev) { if (e.what !== 'event-cell') log.push(`${e.tick} ${describeEvent(e)}`); }
        if (keys.sel >= Mm2Engine.view(st).party.length) keys.sel = 0;
      }
      const v = Mm2Engine.view(st), p: PoseLike = { level: v.pose.screen, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 };
      draw(); void drawLater;
      if (v.pose.screen !== before.screen) { void host.loadMap(p.level, p); return null; }
      const cur = host.getView().pose;
      if (cur.x !== p.x || cur.y !== p.y || cur.facing !== p.facing) { host.getView().setPose(p); return p; }
      return null;
    },
  };
}

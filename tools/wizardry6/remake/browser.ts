/**
 * Browser hook for the Wizardry 6 engine on the walker page: DOM only. Step based, so there is no clock: a key becomes one command (`keys.ts`), the engine steps, the HUD and
 * the walker pose are refreshed. Enabled by `?game=wizardry6&play=1`. Dev server only: the retail files come from the Vite `/data/` middleware, never shipped. The walker view draws
 * the static level (a door the engine opened is not drawn open), the HUD says what is ahead.
 */
import { makeEngine, REQUIRED, type W6State, type W6World } from './engine';
import { W6Keys, hudLines } from './keys';
import { w6Assets } from './shell-entry';
import { describeEvent } from './engine';
import { fileSetFromMap } from '../../remake/engine';

interface PoseLike { level: number; x: number; y: number; facing: 0 | 1 | 2 | 3 }
interface ViewLike { setPose(p: PoseLike): void; readonly pose: PoseLike }
export interface PlayHost { getView(): ViewLike; loadMap(level: number, pose: PoseLike): Promise<void>; setStatus(t: string): void }

export async function attachW6Play(host: PlayHost, level: number) {
  const q = new URLSearchParams(window.location.search);
  const names = Object.keys(REQUIRED);
  const bytes = await Promise.all(names.map(async n => { const r = await fetch(`/data/wizardry6/amiga/${n}`); if (!r.ok) throw new Error(`${n}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }));
  const files = fileSetFromMap(new Map(names.map((n, i) => [n, bytes[i]])));
  const base = '/assets/wizardry6/amiga';
  const eng = makeEngine(await w6Assets({ json: async <T,>(p: string) => { const r = await fetch(`${base}/${p}`); return r.ok ? (await r.json()) as T : null; } }));
  const det = eng.detect(files); if (!det) throw new Error('Wizardry 6 files not recognised');
  const world = eng.load(files, det.variant) as W6World;
  const st: W6State = eng.newGame(world, q.has('seed') ? Number(q.get('seed')) : Date.now() >>> 0, level === 12 || level === 1 ? {} : { level }) as W6State;
  const keys = new W6Keys();
  const log: string[] = [];
  const hud = document.createElement('pre');
  hud.style.cssText = 'font:12px monospace;margin:0;padding:6px;white-space:pre-wrap;max-height:48vh;overflow:auto;background:#111;color:#ddd';
  (document.getElementById('sidebar') ?? document.body).prepend(hud);
  const queue: string[] = [];
  const draw = () => { hud.textContent = hudLines(eng.view(st), keys, log).join('\n'); };
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^Key|^Arrow|^Space|^Enter|^Digit/.test(ev.code)) { queue.push(ev.code); ev.preventDefault(); }
  });
  for (const code of (q.get('keys') ?? '').split(',')) if (code) queue.push(code);
  draw();
  // the engine starts on its own level (12 by default); the walker page opens level 1 unless told otherwise, so load the engine's level before the first frame
  const p0 = eng.view(st).pose;
  if (host.getView().pose.level !== p0.level) await host.loadMap(p0.level, { level: p0.level, x: p0.x, y: p0.y, facing: p0.facing as 0 | 1 | 2 | 3 });
  return {
    update(_dtMs: number): PoseLike | null {
      if (!queue.length) return null;
      const before = eng.view(st).pose;
      for (const code of queue.splice(0)) {
        const c = keys.key(code, eng.view(st));
        if (!c) continue;
        for (const e of eng.step(st, [c])) if (e.what !== 'turn' && e.what !== 'bump') log.push(`${e.tick} ${describeEvent(e)}`);
        if (keys.sel >= eng.view(st).party.length) keys.sel = 0;
      }
      const v = eng.view(st), p: PoseLike = { level: v.pose.level, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 };
      draw();
      if (v.pose.level !== before.level) { void host.loadMap(p.level, p); return null; }
      const cur = host.getView().pose;
      if (cur.x !== p.x || cur.y !== p.y || cur.facing !== p.facing) { host.getView().setPose(p); return p; }
      return null;
    },
  };
}

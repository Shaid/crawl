/**
 * Browser shell for the Black Crypt engine: DOM only. Owns the keyboard / window wiring, the text HUD and the glue to the walker view; pacing lives in `play-loop.ts`
 * (tick clock, held keys, no DOM) and the live scene in `live-scene.ts` / `live-play.ts`. Enabled by `?game=blackcrypt&play=1` in the walker page (`&region=ntsc` for the
 * 10-vblank tick). Dev server only: the retail files are fetched from the Vite `/data/` middleware, never shipped.
 */
import { BcEngine, describeEvent, type BcState } from './engine';
import { fileSetFromMap } from '../../remake/engine';
import { PlayLoop, DEFAULT_KEYMAP, type Region } from './play-loop';
import { createBcLive, type BcLive } from './live-play';
import { bcEngine } from './shell-entry';
import type { BlackCryptView } from '../../walker/games';

interface PoseLike { level: number; x: number; y: number; facing: 0 | 1 | 2 | 3 }
interface ViewLike { setPose(p: PoseLike): void; readonly pose: PoseLike }
export interface PlayHost { getView(): ViewLike; loadMap(level: number, pose: PoseLike): Promise<void>; setStatus(t: string): void; assetBase: string }
type LiveView = ViewLike & Pick<BlackCryptView, 'setLive' | 'refreshLive' | 'banks'>;

export async function attachBlackCryptPlay(host: PlayHost, level: number) {
  const q = new URLSearchParams(window.location.search);
  // detection, rules tables and the engine factory are the shell's (tools/remake + shell-entry.ts); only the retail bytes are fetched here
  const names = ['bcdfs', 'bcdfp', 'bcdft'];
  const bytes = await Promise.all(names.map(async n => { const r = await fetch(`/data/blackcrypt/amiga/${n}`); if (!r.ok) throw new Error(`${n}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }));
  const files = fileSetFromMap(new Map(names.map((n, i) => [n, bytes[i]])));
  const det = BcEngine.detect(files); if (!det) throw new Error('Black Crypt files not recognised');
  const eng = await bcEngine({ json: async p => ((await fetch(`${host.assetBase}/${p}`)).json().catch(() => null)) });
  const world = eng.load(files, det.variant) as ReturnType<typeof BcEngine.load>;
  const groups = ((await (await fetch(`${host.assetBase}/data/monster-names.json`)).json()) as { groups: Parameters<typeof createBcLive>[0]['groups'] }).groups;
  const v0 = host.getView().pose;
  const st: BcState = BcEngine.newGame(world, (Date.now() >>> 0), { map: level, pose: { x: v0.x, y: v0.y, facing: v0.facing } });
  const region: Region = q.get('region')?.toLowerCase() === 'ntsc' ? 'NTSC' : 'PAL';
  const loop = new PlayLoop(st, { region });
  const logLines: string[] = [];
  const hud = document.createElement('pre');
  hud.style.cssText = 'font:12px monospace;margin:0;padding:6px;white-space:pre-wrap;max-height:40vh;overflow:auto;background:#111;color:#ddd';
  (document.getElementById('sidebar') ?? document.body).prepend(hud);

  // spell book keys (shell policy, not the game's UI): T selects the character, Z X C V memorise row 0-3 of the open page, G H J K L cast slot 0-4
  let sel = 0;
  const rows: Record<string, number> = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 }, slotKeys: Record<string, number> = { KeyG: 0, KeyH: 1, KeyJ: 2, KeyK: 3, KeyL: 4 };
  window.addEventListener('keydown', ev => {
    if (ev.code === 'KeyT' && !ev.repeat) { sel = (sel + 1) & 3; draw(); ev.preventDefault(); }
    else if (rows[ev.code] !== undefined && !ev.repeat) { loop.command({ kind: 'memorise', char: sel, row: rows[ev.code] }); ev.preventDefault(); }
    else if (slotKeys[ev.code] !== undefined && !ev.repeat) { loop.command({ kind: 'cast', char: sel, slot: slotKeys[ev.code] }); ev.preventDefault(); }
    else if (DEFAULT_KEYMAP[ev.code]) { loop.keyDown(ev.code); ev.preventDefault(); }
  });
  window.addEventListener('keyup', ev => { if (DEFAULT_KEYMAP[ev.code]) loop.keyUp(ev.code); });
  window.addEventListener('blur', () => loop.releaseAll());
  // `&keys=KeyW,KeyW,KeyE` pre-queues one-tick presses (for screenshots and smoke runs)
  for (const k of (q.get('keys') ?? '').split(',')) if (DEFAULT_KEYMAP[k]) loop.command(DEFAULT_KEYMAP[k].cmd);

  let attached: LiveView | null = null, live: BcLive | null = null;
  const attach = () => {
    const v = host.getView() as unknown as LiveView;
    if (v === attached || typeof v.setLive !== 'function' || !v.banks?.['monsters']) return;
    attached = v;
    live = createBcLive({ state: () => st, banks: v.banks, groups, getPose: () => v.pose, onCommand: c => loop.command(c) });
    v.setLive(live);
  };

  const draw = () => {
    const v = BcEngine.view(st);
    const prow = v.party.map((p, k) => `${k === sel ? '>' : ' '}${p.name.padEnd(10)} L${p.level} ${String(p.hp).padStart(3)}/${String(p.maxHp).padEnd(3)} ${p.alive ? '' : 'DEAD'} [${p.spells.join(' ') || '-'}]`);
    const pg = v.book?.pages[v.party[sel].page];
    const bookLine = pg ? `book p${pg.page}${pg.owned ? '' : ' (not owned)'}: ${pg.spells.map((s, r) => `${'ZXCV'[r]}=${s.id}(L${s.level}${s.timer ? ` ${s.timer}t` : ''})`).join(' ')}` : 'no spell book';
    const ahead = v.ahead.monsters.length ? `ahead: ${v.ahead.monsters.length} monster(s)` : '';
    hud.textContent = `map ${v.map}  tick ${v.tick}  (${v.pose.x},${v.pose.y}) ${'NESW'[v.pose.facing]}  ${ahead}${v.gameOver ? '  GAME OVER' : ''}\n${prow.join('\n')}\n${bookLine}\n\n${logLines.slice(-14).join('\n')}\n\nW/S move, Q/E turn (hold to repeat), O open door, Space or 1-4 attack, click a door\nT select char, Z X C V memorise, G H J K L cast slot`;
  };
  draw();
  return {
    /** call once per animation frame; returns the pose to render when it changed */
    update(dtMs: number): PoseLike | null {
      attach();
      const before = BcEngine.view(st).map;
      const { ticks, events } = loop.update(dtMs);
      if (ticks === 0) return null;
      for (const e of events) if (!['step-party', 'ramp'].includes(e.what)) logLines.push(`${e.tick} ${describeEvent(e)}`);
      live?.feed(events); live?.tick();
      const v = BcEngine.view(st);
      const p = { level: v.map, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 };
      let changed: PoseLike | null = null;
      if (v.map !== before) { void host.loadMap(v.map, p); }
      else { const cur = host.getView().pose; if (cur.x !== p.x || cur.y !== p.y || cur.facing !== p.facing) { host.getView().setPose(p); changed = p; } }
      attached?.refreshLive();
      draw();
      return changed;
    },
  };
}

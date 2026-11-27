/** The view surface contract with a fake engine and a fake view factory (no DOM, no retail data): per-frame calls with the current View, disposal on exit / slot load / new game, fallback to the text HUD. */
import { describe, it, expect } from 'vitest';
import type { Engine, FileSet, Detection } from './engine';
import type { EngineEntry, ViewContext, ViewSurface } from './registry';
import { detectAll, memorySource } from './detect';
import { GameSession } from './session';
import { SlotStore, memoryKV } from './slots';
import { ViewHost } from './viewhost';
import { registry } from './engines';

interface FState { x: number }
const fake: Engine<null, FState, 'right', { x: number }, { x: number }> = {
  id: 'fake', timing: { tickMs: 100 },
  detect(f: FileSet): Detection | null { return f.size('fake.dat') === 4 ? { engine: 'fake', variant: 'v1', title: 'Fake', evidence: ['fake.dat'] } : null; },
  load: () => null, newGame: (_w, seed) => ({ x: seed }),
  step(s, cmds) { const ev: { x: number }[] = []; for (const _c of cmds) { s.x++; ev.push({ x: s.x }); } return ev; },
  view: s => ({ x: s.x }),
  save: s => new TextEncoder().encode(JSON.stringify(s)), restore: (_w, b) => JSON.parse(new TextDecoder().decode(b)) as FState,
  coverage: () => [{ area: 'a', grade: 'harness' }],
};
const base: EngineEntry = { id: 'fake', title: 'Fake', dataDirs: ['fake/v1'], engine: fake, assetBase: '/assets/fake', hints: { keymap: { KeyD: { cmd: 'right', repeat: false } }, hud: (v: { x: number }) => [`x=${v.x}`] } };
const src = memorySource({ 'fake/v1/fake.dat': new Uint8Array(4) });

interface Log { made: { ctx: ViewContext; frames: { view: unknown; ticks: number; events: readonly unknown[] }[]; disposed: number }[] }
function withFactory(log: Log, make?: () => Promise<void>): EngineEntry {
  return { ...base, hints: { ...base.hints, viewFactory: async ctx => {
    await make?.();
    const rec = { ctx, frames: [] as Log['made'][number]['frames'], disposed: 0 }; log.made.push(rec);
    const surf: ViewSurface = { render: (view, f) => { rec.frames.push({ view, ticks: f.ticks, events: f.events }); }, dispose: () => { rec.disposed++; } };
    return surf;
  } } };
}
async function open(entry: EngineEntry) {
  const rep = await detectAll(src, [entry]); const slots = new SlotStore(memoryKV());
  const s = await GameSession.open(rep.found[0], src, { json: async () => null }, slots); s.newGame(5);
  const host = new ViewHost(s, { canvas: {} as never, side: {} as never, setStatus: () => undefined });
  return { s, host };
}
const flush = () => new Promise(r => setTimeout(r, 0));
const run = (s: GameSession, host: ViewHost, dt: number) => { const n = s.update(dt); host.frame(dt, n); return n; };

describe('view surface', () => {
  it('is built once with the entry asset base, then called every frame with the current View; events arrive on tick frames only', async () => {
    const log: Log = { made: [] }; const { s, host } = await open(withFactory(log));
    expect(host.wanted).toBe(true);
    host.frame(16, 0); await flush();                      // first frame builds the surface (async)
    expect(log.made.length).toBe(1); expect(log.made[0].ctx.assetBase).toBe('/assets/fake'); expect(host.ready).toBe(true);
    run(s, host, 16); run(s, host, 16);                    // no tick yet (100 ms period): still a frame each
    expect(log.made[0].frames.map(f => [f.ticks, (f.view as { x: number }).x])).toEqual([[0, 5], [0, 5]]);
    s.loop.command('right' as never); run(s, host, 120);   // one tick with a command: the View changed and the events came with it
    const last = log.made[0].frames.at(-1)!; expect(last.ticks).toBe(1); expect((last.view as { x: number }).x).toBe(6); expect(last.events).toEqual([{ x: 6 }]);
    expect(log.made.length).toBe(1);
  });
  it('the host context reads the live state and queues commands on the session loop', async () => {
    const log: Log = { made: [] }; const { s, host } = await open(withFactory(log));
    host.frame(0, 0); await flush();
    const c = log.made[0].ctx; expect(c.state()).toBe(s.state); c.command('right'); run(s, host, 100); expect((s.state as FState).x).toBe(6);
  });
  it('is disposed exactly once on exit, and no frame reaches it afterwards', async () => {
    const log: Log = { made: [] }; const { s, host } = await open(withFactory(log));
    host.frame(0, 0); await flush(); host.dispose(); host.dispose();
    expect(log.made[0].disposed).toBe(1); const n = log.made[0].frames.length; run(s, host, 16); expect(log.made[0].frames.length).toBe(n);
  });
  it('is disposed and rebuilt when a slot is loaded, an import runs or a new game starts (the state was replaced)', async () => {
    const log: Log = { made: [] }; const { s, host } = await open(withFactory(log));
    host.frame(0, 0); await flush(); s.saveSlot('a');
    await s.loadSlot('a'); host.frame(16, 0); await flush();
    expect(log.made.length).toBe(2); expect(log.made[0].disposed).toBe(1); expect(log.made[1].disposed).toBe(0);
    s.newGame(9); host.frame(16, 0); await flush();
    expect(log.made.length).toBe(3); expect(log.made[1].disposed).toBe(1);
    host.frame(16, 0); expect((log.made[2].frames.at(-1)!.view as { x: number }).x).toBe(9);   // the new state, not the old one
    host.dispose(); expect(log.made[2].disposed).toBe(1);
  });
  it('a surface still being built when the state is replaced or the session ends is disposed as soon as it arrives', async () => {
    const log: Log = { made: [] }; let gate!: () => void; const slow = new Promise<void>(r => { gate = r; });
    const { s, host } = await open(withFactory(log, () => slow));
    host.frame(0, 0); s.newGame(1); host.frame(0, 0); gate(); await flush();
    expect(log.made.length).toBe(2);   // the second build was started by the second frame; the first finished late
    expect(log.made.filter(m => m.disposed === 1).length).toBe(1);
    host.dispose(); expect(log.made.every(m => m.disposed === 1)).toBe(true);
  });
  it('NULL CONTROL: an entry without a viewFactory has no surface and the text HUD keeps working', async () => {
    const { s, host } = await open(base);
    expect(host.wanted).toBe(false); host.frame(16, 0); run(s, host, 100); expect(host.ready).toBe(false); expect(host.error).toBeNull();
    expect(s.hudLines()).toEqual(['x=5']); host.dispose();
  });
  it('a factory that throws, or a render that throws, falls back to the text HUD with the reason', async () => {
    const bad: EngineEntry = { ...base, hints: { ...base.hints, viewFactory: async () => { throw new Error('no art'); } } };
    const a = await open(bad); a.host.frame(0, 0); await flush(); expect(a.host.error).toBe('no art'); expect(a.host.ready).toBe(false); a.host.frame(16, 0); expect(a.s.hudLines()).toEqual(['x=5']);
    let d = 0;
    const bad2: EngineEntry = { ...base, hints: { ...base.hints, viewFactory: async () => ({ render() { throw new Error('boom'); }, dispose() { d++; } }) } };
    const b = await open(bad2); b.host.frame(0, 0); await flush(); b.host.frame(16, 0);
    expect(b.host.error).toBe('boom'); expect(d).toBe(1); expect(b.host.ready).toBe(false);
  });
  it('the shipped registry: Black Crypt and Might and Magic II opt in', () => {
    expect(typeof registry.get('blackcrypt')?.hints.viewFactory).toBe('function'); expect(typeof registry.get('mm2')?.hints.viewFactory).toBe('function');
  });
});

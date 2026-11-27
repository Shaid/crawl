/** The shell contract with a tiny in-test engine (no retail data, no DOM): detection, load, step, slots, coverage; with null controls. */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Engine, FileSet, Detection } from './engine';
import { Registry, type EngineEntry } from './registry';
import { detectAll, memorySource, type DataSource } from './detect';
import { GameSession } from './session';
import { SlotStore, SlotError, memoryKV, importSlot, AUTOSAVE } from './slots';
import { loadSettings, saveSettings } from './settings';
import { registry } from './engines';

// ---- the fake engine: files `fake.dat` ('FAKE' + 4 table bytes); state = position on a line, moved by 'right' / 'left' ----
interface FWorld { table: Uint8Array; sum: number }
interface FState { x: number; world: number; t: number }
type FCmd = 'left' | 'right'; type FEv = { what: string; x: number };
const fake: Engine<FWorld, FState, FCmd, FEv, { x: number }> = {
  id: 'fake',
  timing: { tickMs: 100 },
  detect(f: FileSet): Detection | null {
    if (f.size('fake.dat') !== 8) return null;
    const b = f.read('fake.dat')!; if (String.fromCharCode(...b.subarray(0, 4)) !== 'FAKE') return null;
    return { engine: 'fake', variant: 'v1', title: 'Fake Game', evidence: ['fake.dat 8 B'] };
  },
  load(f) { const b = f.read('fake.dat')!; return { table: b.slice(4), sum: b[4] + b[5] + b[6] + b[7] }; },
  newGame(w, seed) { return { x: seed % 10, world: w.sum, t: 0 }; },
  step(s, cmds) { s.t++; const ev: FEv[] = []; for (const c of cmds) { s.x += c === 'right' ? 1 : -1; ev.push({ what: 'moved', x: s.x }); } return ev; },
  view: s => ({ x: s.x }),
  save: s => new TextEncoder().encode(JSON.stringify(s)),
  restore(w, bytes) { const s = JSON.parse(new TextDecoder().decode(bytes)) as FState; if (s.world !== w.sum) throw new Error('save belongs to a different world'); return s; },
  coverage: () => [{ area: 'moving', grade: 'harness' }, { area: 'fighting', grade: 'open', note: 'not done' }],
};
const entry: EngineEntry = {
  id: 'fake', title: 'Fake Game', dataDirs: ['fake/v1'], engine: fake,
  hints: { keymap: { KeyD: { cmd: 'right', repeat: true }, KeyA: { cmd: 'left', repeat: true } }, describeEvent: (e: FEv) => `moved to ${e.x}`, hud: (v: { x: number }) => [`x=${v.x}`], regions: { PAL: 100, NTSC: 120 } },
};
const dat = (table: number[]) => new Uint8Array([70, 65, 75, 69, ...table]);
const src = (table = [1, 2, 3, 4]) => memorySource({ 'fake/v1/fake.dat': dat(table), 'other/readme.txt': new Uint8Array(3) });
const assets = { json: async () => null };

async function open(s: DataSource, kv = memoryKV(), o = {}) {
  const rep = await detectAll(s, [entry]);
  expect(rep.found.length).toBe(1);
  const session = await GameSession.open(rep.found[0], s, assets, new SlotStore(kv), o);
  session.newGame(3);
  return { session, kv };
}

describe('registry', () => {
  it('registering is one entry; a duplicate or a mismatched engine id is refused', () => {
    const r = new Registry([entry]); expect(r.all().map(e => e.id)).toEqual(['fake']);
    expect(() => r.register(entry)).toThrow(/twice/);
    expect(() => new Registry([{ ...entry, id: 'other' }])).toThrow(/wraps/);
  });
  it('the shipped registry lists Black Crypt', () => { expect(registry.get('blackcrypt')?.dataDirs).toContain('blackcrypt/amiga'); });
});

describe('detection', () => {
  it('finds the game from names, sizes and a structural check; reports its coverage', async () => {
    const rep = await detectAll(src(), [entry]);
    expect(rep.missing).toEqual([]);
    expect(rep.found[0].detection).toMatchObject({ engine: 'fake', variant: 'v1', title: 'Fake Game' });
    expect(entry.engine.coverage().map(c => c.grade)).toEqual(['harness', 'open']);
  });
  it('null: a missing file, a wrong size, a wrong magic, an empty directory -> not detected', async () => {
    for (const files of [{ 'fake/v1/other.dat': dat([1, 2, 3, 4]) }, { 'fake/v1/fake.dat': new Uint8Array(9) }, { 'fake/v1/fake.dat': new Uint8Array(8) }, {}]) {
      const rep = await detectAll(memorySource(files as Record<string, Uint8Array>), [entry]);
      expect(rep.found).toEqual([]); expect(rep.missing.map(m => m.entry.id)).toEqual(['fake']);
    }
  });
  it('a throwing detect() counts as not detected and is reported', async () => {
    const bad: EngineEntry = { ...entry, engine: { ...fake, detect: () => { throw new Error('boom'); } } };
    const rep = await detectAll(src(), [bad]); expect(rep.found).toEqual([]); expect(rep.missing[0].error).toMatch(/boom/);
  });
  it('bytes are fetched only for files the engine reads (sizes alone answer a size-only detect)', async () => {
    const reads: string[] = []; const s = src(); const spy: DataSource = { list: () => s.list(), read: p => { reads.push(p); return s.read(p); } };
    const sizeOnly: EngineEntry = { ...entry, engine: { ...fake, detect: f => (f.size('fake.dat') === 8 ? { engine: 'fake', variant: 'v1', title: 'Fake Game', evidence: ['x'] } : null) } };
    await detectAll(spy, [sizeOnly]); expect(reads).toEqual([]);
    await detectAll(spy, [entry]); expect(reads).toEqual(['fake/v1/fake.dat']);
  });
});

describe('session: loop, regions, key map', () => {
  it('loads the world, steps on the engine clock with keys, logs events, honours the region', async () => {
    const { session } = await open(src());
    expect(session.hudLines()).toEqual(['x=3']);
    expect(session.update(99)).toBe(0); session.loop.keyDown('KeyD');
    expect(session.update(1)).toBe(1); expect(session.view().x).toBe(4);
    expect(session.logLines).toEqual(['moved to 4']);
    session.loop.keyUp('KeyD');
    session.setRegion('NTSC'); expect(session.tickMs).toBe(120);
    expect(session.update(119)).toBe(0); expect(session.update(1)).toBe(1);
  });
  it('null: an unmapped key does nothing', async () => {
    const { session } = await open(src()); session.loop.keyDown('KeyZ'); session.update(500); expect(session.view().x).toBe(3);
  });
});

describe('save slots', () => {
  it('save, move on, load: state and the re-loaded world come back; autosave and export / import too', async () => {
    const { session, kv } = await open(src()); const store = new SlotStore(kv);
    session.loop.command('right'); session.update(100);
    const rec = session.saveSlot('one'); expect(rec).toMatchObject({ engine: 'fake', variant: 'v1', name: 'one' });
    session.loop.command('right'); session.update(100); expect(session.view().x).toBe(5);
    const w0 = session.world; await session.loadSlot('one');
    expect(session.view().x).toBe(4); expect(session.world).not.toBe(w0);   // the world is re-read from the files
    expect(store.list('fake').map(r => r.name)).toEqual(['one']);
    const bytes = session.exportSlot('portable');
    session.loop.command('left'); session.update(100); expect(session.view().x).toBe(3);
    await session.importFile(bytes); expect(session.view().x).toBe(4);
    const auto = await open(src(), memoryKV(), { autosaveSec: 1 }); auto.session.update(1000);
    expect(new SlotStore(auto.kv).get('fake', AUTOSAVE)).not.toBeNull();
    store.remove('fake', 'one'); expect(store.get('fake', 'one')).toBeNull();
  });
  it('null: restoring a save made against a different world fails cleanly and leaves the game alone', async () => {
    const a = await open(src([1, 2, 3, 4])); a.session.loop.command('right'); a.session.update(100);
    const bytes = a.session.exportSlot();
    const b = await open(src([9, 9, 9, 9])); const before = b.session.view().x;   // same files, different content: same name/size evidence
    await expect(b.session.importFile(bytes)).rejects.toThrow(SlotError);
    expect(b.session.lastError).toMatch(/different world|restored/);
    expect(b.session.view().x).toBe(before);
  });
  it('null: wrong engine, wrong variant, wrong install, garbage and a missing slot are refused', async () => {
    const { session } = await open(src()); const rec = importSlot(session.exportSlot());
    for (const bad of [{ ...rec, engine: 'other' }, { ...rec, variant: 'v2' }, { ...rec, fingerprint: 'fake/v1/other' }]) await expect(session.restoreRecord(bad)).rejects.toThrow(SlotError);
    await expect(session.importFile(new TextEncoder().encode('not json'))).rejects.toThrow(SlotError);
    await expect(session.importFile(new TextEncoder().encode('{"format":"x"}'))).rejects.toThrow(SlotError);
    await expect(session.loadSlot('nope')).rejects.toThrow(/no slot/);
    await expect(session.restoreRecord({ ...rec, data: btoa('{{') })).rejects.toThrow(/could not be restored/);
  });
});

describe('settings', () => {
  it('round trip and clamping; junk falls back to defaults', () => {
    const kv = memoryKV(); expect(loadSettings(kv)).toMatchObject({ region: 'PAL', volume: 0.8 });
    saveSettings(kv, { region: 'NTSC', volume: 2, autosaveSec: 30 }); expect(loadSettings(kv)).toEqual({ region: 'NTSC', volume: 1, autosaveSec: 30 });
    kv.set('crawl.shell.settings', '{{'); expect(loadSettings(kv).region).toBe('PAL');
  });
});

// retail check, only when the user's files are present in data/ (never committed)
const BC = 'data/blackcrypt/amiga';
describe.skipIf(!existsSync(join(BC, 'bcdfs')))('Black Crypt through the shell (retail files present)', () => {
  it('is detected by size and structure, and loads through the registry entry', async () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? [] : [p]; });
    const listing = walk(BC).map(p => ({ path: relative('data', p), size: statSync(p).size }));
    const s: DataSource = { list: async () => listing, read: async p => new Uint8Array(readFileSync(join('data', p))) };
    const rep = await detectAll(s, registry.all());
    expect(rep.found.map(f => f.entry.id)).toEqual(['blackcrypt']);
    const assetsFs = { json: async <T>(p: string) => { const f = join('public/assets/blackcrypt/amiga', p); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as T : null; } };
    const session = await GameSession.open(rep.found[0], s, assetsFs, new SlotStore(memoryKV()));
    session.newGame(1); session.loop.command({ kind: 'turn', by: 1 }); session.update(session.tickMs);
    expect(session.hudLines()[0]).toMatch(/^map 1 /);
    const bytes = session.exportSlot(); await session.importFile(bytes);
    expect(session.hudLines()[0]).toMatch(/^map 1 /);
  }, 60000);
});

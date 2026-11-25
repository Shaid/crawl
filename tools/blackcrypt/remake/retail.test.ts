/** Tests on the user's own retail files; skipped cleanly when `data/blackcrypt/amiga/` or the generated walker data are absent. Nothing from the retail files is committed. */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSetFromMap } from '../../remake/engine';
import { BcEngine, type BcEvent } from './engine';
import { entrancePose } from './bcdfs';
import { rules } from './synth';

const DATA = resolve(__dirname, '../../../data/blackcrypt/amiga');
const LEVELS = resolve(__dirname, '../../../public/assets/blackcrypt/amiga/dungeon/levels.json');
const have = existsSync(resolve(DATA, 'bcdfs')) && existsSync(resolve(DATA, 'bcdfp')) && existsSync(resolve(DATA, 'bcdft'));
const files = () => fileSetFromMap(new Map(['bcdfs', 'bcdfp', 'bcdft'].map(n => [n, new Uint8Array(readFileSync(resolve(DATA, n)))])));

describe.skipIf(!have)('BcEngine on the retail files', () => {
  const fs = have ? files() : (null as never);
  const eng = BcEngine.withRules(rules);
  it('detects the install and rejects an empty file set', () => {
    expect(BcEngine.detect(fs)).toMatchObject({ engine: 'blackcrypt', variant: 'amiga' });
    expect(BcEngine.detect(fileSetFromMap(new Map()))).toBeNull();
  });
  it('parses all 13 maps and the 20-record starting kit', () => {
    const w = eng.load(fs, 'amiga') as ReturnType<typeof BcEngine.load>;
    expect(w.maps).toHaveLength(13);
    expect(w.maps.map(m => m.chains.size).every(n => n > 0)).toBe(true);
    expect(w.kit).toHaveLength(20);
  });
  it.skipIf(!existsSync(LEVELS))('cells and entrances agree with the walker data (levels.json)', async () => {
    const w = eng.load(fs, 'amiga') as ReturnType<typeof BcEngine.load>;
    const lv = JSON.parse(readFileSync(LEVELS, 'utf8'));
    const { bcEntrancePose } = await import('../../walker/games');
    for (const u of lv.units) {
      const m = w.maps[u.id - 1];
      for (let i = 0; i < 4096; i++) {
        if (!m.present[i]) continue;
        expect(u.planes.wallFlags[i]).toBe((m.cells[i] >>> 12) & 15);
        expect(u.planes.objectHandle[i]).toBe(m.cells[i] & 0xfff);
      }
      expect(entrancePose(m)).toMatchObject({ x: bcEntrancePose(u).x, y: bcEntrancePose(u).y, facing: bcEntrancePose(u).facing });
    }
  }, 60000);
  it('every map loads, runs 300 idle ticks and survives a save / restore round trip', () => {
    const w = eng.load(fs, 'amiga') as ReturnType<typeof BcEngine.load>;
    for (let m = 1; m <= 13; m++) {
      const st = BcEngine.newGame(w, m, { map: m });
      for (let t = 0; t < 300; t++) BcEngine.step(st, t % 5 === 0 ? [{ kind: 'move', dir: 'forward' }] : []);
      const snap = BcEngine.save(st), back = BcEngine.restore(w, snap);
      expect(Buffer.from(BcEngine.save(back)).equals(Buffer.from(snap))).toBe(true);
      expect(BcEngine.view(st).map).toBe(m);
    }
  });
  it('the new-game party carries the starting kit and map 1 starts in a walkable corridor', () => {
    const w = eng.load(fs, 'amiga') as ReturnType<typeof BcEngine.load>;
    const st = BcEngine.newGame(w, 7);
    const v = BcEngine.view(st);
    expect(v.party.map(p => p.pack.filter(Boolean).length)).toEqual([5, 5, 5, 5]);
    const ev: BcEvent[] = [];
    for (let t = 0; t < 4; t++) ev.push(...BcEngine.step(st, [{ kind: 'move', dir: 'forward' }]));
    expect(ev.some(e => e.what === 'step-party')).toBe(true);
  });
});

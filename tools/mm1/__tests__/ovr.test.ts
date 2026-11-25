/* eslint-disable @typescript-eslint/no-explicit-any -- harness JSON and recorded vectors are dynamic */
/**
 * MM1 overlay execution (tools/mm1/ovr.ts + x86.ts) against vectors recorded from the retail MM.EXE + `.OVR` overlays under Unicorn:
 * `ovdisp` the dispatcher's decision, `ovcell` whole special-cell runs (dispatcher -> real handler -> real MM.EXE helpers; screen/file layers stubbed),
 * `scrkey` the loadmaze screen-key resolver.
 */
import { describe, expect, it, vi } from 'vitest';
import { mustMatch, nullBad } from './check.ts';
import { existsSync, readFileSync } from 'node:fs';
import { runOverlay, runTown, TOWN_ENTRY, screenKey, cellLoad, DISPATCH, parseOvr, tableLayout, dispatch } from '../ovr.ts';
import { load } from './vectors.ts';

vi.setConfig({ testTimeout: 600000 });

const dispVec = (m: any, v: any) => { const r = runOverlay(m, v.code, DISPATCH, [], 0, v.args.stops); return { ax: r.m.ax, bx: r.m.bx, cx: r.m.cx, dx: r.m.dx, si: r.m.si, di: r.m.di, bp: r.m.bp, cf: r.m.cf, zf: r.m.zf, stop: r.stop, calls: r.m.calls }; };
const cellVec = (m: any, v: any) => { const r = runOverlay(m, v.code, DISPATCH, v.args.keys, v.args.kbk); return { ax: r.m.ax, bx: r.m.bx, cx: r.m.cx, dx: r.m.dx, si: r.m.si, di: r.m.di, bp: r.m.bp, cf: r.m.cf, zf: r.m.zf, stop: r.stop, calls: r.m.calls }; };

describe('overlay special-cell dispatcher CS:0xF4A1', () => {
  it('x86 port reproduces the decision point, registers, reads and writes on every vector', () => mustMatch('ovdisp', dispVec, 30));
});
describe('whole special-cell runs through the real handlers', () => {
  it('strict reads, writes, UI/terminal call log, registers (886 handlers across 55 overlays are the population)', () => mustMatch('ovcell', cellVec, 30));
  it('null controls: shifted key script / mykbhit poll count / ADC without carry-in', () => {
    const n1 = nullBad('ovcell', (m, v) => { const r = runOverlay(m, v.code, DISPATCH, [0x4e, ...v.args.keys], v.args.kbk); return { calls: r.m.calls }; });
    const n2 = nullBad('ovcell', (m, v) => { const r = runOverlay(m, v.code, DISPATCH, v.args.keys, v.args.kbk + 1); return { calls: r.m.calls }; });
    const n3 = nullBad('ovcell', (m, v) => { const r = runOverlay(m, v.code, DISPATCH, v.args.keys, v.args.kbk, [], 'noCarryIn'); return { calls: r.m.calls }; });
    console.log('ovcell null controls', n1, n2, n3);
    expect(n1).toBeGreaterThan(0); expect(n1 + n2 + n3).toBeGreaterThan(0);
  });
});
describe('loadmaze screen key CODE+0xD71', () => {
  it('matches the game', () => mustMatch('scrkey', (m, v) => { screenKey(m, v.args[1] & 255, v.args[1] >> 8, v.args[0]); return {}; }, 20));
  it('null control: unshifted area index', () => {
    const n = nullBad('scrkey', (m, v) => { screenKey(m, v.args[1] & 255, v.args[1] >> 8, v.args[0] ^ 1); return {}; });
    expect(n).toBeGreaterThan(0);
  });
});

const DATA = 'data/mm1/dosega';
describe.skipIf(!existsSync(`${DATA}/SORPIGAL.OVR`))('table-driven dispatcher (ovr.ts dispatch) against the real dispatcher run', () => {
  it('agrees with every ovdisp vector (miss / no-mask / handler address)', () => {
    let n = 0;
    for (const v of load('ovdisp')) {
      const o = parseOvr(v.args.ov, new Uint8Array(readFileSync(`${DATA}/${v.args.ov}.OVR`)));
      const lay = tableLayout(o)!;
      const r = dispatch(o, lay, v.args.cell, v.args.mask);
      const [miss, nomask] = v.args.stops;
      const want = v.out.stop === miss ? 'miss' : v.out.stop === nomask ? 'nomask' : v.out.di;
      expect(r, JSON.stringify(v.args)).toBe(want); n++;
    }
    expect(n).toBeGreaterThanOrEqual(30);
  });
  it('null control: ignoring the count byte (scan the whole table) disagrees on PP4/AREAE2-style tables', () => {
    let bad = 0;
    for (const v of load('ovdisp')) {
      const o = parseOvr(v.args.ov, new Uint8Array(readFileSync(`${DATA}/${v.args.ov}.OVR`)));
      const lay = tableLayout(o)!;
      const wrong = dispatch(o, { ...lay, countAddr: lay.countAddr + 1 }, v.args.cell, v.args.mask);   // reads the wrong count byte
      const [miss, nomask] = v.args.stops;
      const want = v.out.stop === miss ? 'miss' : v.out.stop === nomask ? 'nomask' : v.out.di;
      if (wrong !== want) bad++;
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('town services run from the game bytes (x86 port): food, general store, temple, tavern, training hall', () => {
  for (const [name, entry] of Object.entries(TOWN_ENTRY)) {
    const run = (m: any, v: any) => { const x = runTown(m, v.code, entry, v.args.keys, undefined, v.regs); return { ax: x.ax, bx: x.bx, cx: x.cx, dx: x.dx, si: x.si, di: x.di, bp: x.bp, calls: x.calls }; };
    it(`${name}: strict reads, writes, UI call log, registers`, () => mustMatch(name, run, 30));
    it.skipIf(['poption', 'getinfo', 'loadnext', 'gatgold'].includes(name))(`${name}: null control (key script shifted by one / ADC without carry-in)`, () => {
      const n = nullBad(name, (m, v) => { const x = runTown(m, v.code, entry, [0x4e, ...v.args.keys], undefined, v.regs); return { calls: x.calls }; });
      const n2 = nullBad(name, (m, v) => { const x = runTown(m, v.code, entry, v.args.keys, 'noCarryIn', v.regs); return { calls: x.calls }; });
      expect(n + n2).toBeGreaterThan(0);
    });
  }
});

describe('class-gate null controls (the replayed flows really depend on the class byte +0x14 of the current character)', () => {
  for (const name of ['poption', 'equip', 'chest'] as const) {
    it(`${name}: a wrong class byte changes the run`, () => {
      const entry = TOWN_ENTRY[name];
      const n = nullBad(name, (m: any, v: any) => {
        const cur = m.r16(0x3bd6);
        const wm: any = { r8: (a: number) => (a === cur + 0x14 ? ((m.r8(a) % 6) + 1) : m.r8(a)), r16: (a: number) => wm.r8(a) | (wm.r8(a + 1) << 8), w8: (a: number, x: number) => m.w8(a, x), w16: (a: number, x: number) => m.w16(a, x) };
        const x = runTown(wm, v.code, entry, v.args.keys); return { calls: x.calls };
      });
      expect(n).toBeGreaterThan(0);
    });
  }
});

describe('getinfo / loadnext / gatgold input null controls', () => {
  it('gatgold: a wrong gold byte read changes the pooled sum', () => {
    const n = nullBad('gatgold', (m: any, v: any) => {
      const r8 = (a: number) => (a >= 0x3cfa && (a - 0x3cfa) % 0x7f === 0x39 ? m.r8(a) ^ 1 : m.r8(a));
      const wm: any = { r8, r16: (a: number) => r8(a) | (r8(a + 1) << 8), w8: (a: number, x: number) => m.w8(a, x), w16: (a: number, x: number) => m.w16(a, x) };
      const x = runTown(wm, v.code, TOWN_ENTRY.gatgold, v.args.keys, undefined, v.regs); return { calls: x.calls };
    });
    expect(n).toBeGreaterThan(0);
  });
  it('getinfo: a wrong item id changes the item record', () => {
    const n = nullBad('getinfo', (m: any, v: any) => { const x = runTown(m, v.code, TOWN_ENTRY.getinfo, v.args.keys, undefined, { ...v.regs, ax: (v.regs.ax + 1) & 255 }); return { calls: x.calls }; });
    expect(n).toBeGreaterThan(0);
  });
  it('loadnext: a wrong area class selects another screen', () => {
    const n = nullBad('loadnext', (m: any, v: any) => { const x = runTown(m, v.code, TOWN_ENTRY.loadnext, v.args.keys, undefined, { ...v.regs, bp: (v.regs.bp + 1) & 3 }); return { calls: x.calls }; });
    expect(n).toBeGreaterThan(0);
  });
});

describe('cell loader `draw` CODE+0xF45 (cell id, wall byte, layer byte, dark rule)', () => {
  it('matches the game', () => mustMatch('cellload', (m) => { const r = cellLoad(m); return { stop: r.stop }; }, 30));
  it('null control: no light-counter decrement / cell id without the carry quirk', () => {
    const n = nullBad('cellload', (m) => { const y = m.r8(0x3c39), x = m.r8(0x3c38); m.w8(0x3c3a, (y * 16 + x) & 255); return {}; });
    expect(n).toBeGreaterThan(0);
  });
});

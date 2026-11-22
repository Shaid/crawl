/**
 * Dungeon Hack native ports vs the game's OWN x86 routines.
 * Fixture = tools/walker/__tests__/dungeonhack-natives-fixture.json, produced by
 * scripts/verify_dungeonhack_natives.py (AESOP.EXE run under Unicorn).
 * The native tables come from the exported pack (skip when absent).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DhEngine, R250, type DhPack, type Natives } from '../../dungeonhack/engine.ts';

const FIX = new URL('./dungeonhack-natives-fixture.json', import.meta.url).pathname;
const NAT = new URL('../../../public/assets/dungeonhack/dosvga/data/walker/natives.json', import.meta.url).pathname;
const have = existsSync(FIX) && existsSync(NAT);
const fx = have ? JSON.parse(readFileSync(FIX, 'utf8')) : null;
const natives: Natives | null = have ? JSON.parse(readFileSync(NAT, 'utf8')) : null;
const eng = (n: Natives = natives!): any => new DhEngine({ natives: n } as unknown as DhPack);
const u8 = (a: number[]): Uint8Array => Uint8Array.from(a);

describe.skipIf(!have)('Dungeon Hack native ports match AESOP.EXE', () => {
  it('R250: seed_random + rnd reproduce the game\'s stream (5 seeds x 300 draws)', () => {
    for (const c of fx.rnd) {
      const r = new R250();
      r.seed(c.seed);
      for (const [lo, hi, v] of c.draws) expect(r.rnd(lo, hi)).toBe(v);
    }
  });
  it('step_X / step_Y: 400/400', () => {
    const e = eng();
    for (const c of fx.step) {
      expect(e.stepAxis(c.v, c.f, c.m, c.d, 'x')).toBe(c.x);
      expect(e.stepAxis(c.v, c.f, c.m, c.d, 'y')).toBe(c.y);
    }
  });
  it('init_viewspace: 120/120', () => {
    const e = eng();
    for (const c of fx.init_viewspace) {
      const vx = new Uint8Array(18), vy = new Uint8Array(18);
      e.initViewspace(c.x, c.y, c.f, vx, 0, vy, 0);
      expect(Array.from(vx)).toEqual(c.vx);
      expect(Array.from(vy)).toEqual(c.vy);
    }
  });
  it('build_clipping: 150/150 (all outputs incl. lvlvis side effect)', () => {
    const e = eng();
    for (const c of fx.build_clipping) {
      const l = new Uint8Array(36), r = new Uint8Array(36), vis = new Uint8Array(18), fl = new Uint8Array(18);
      const vx = u8(c.vx), vy = u8(c.vy), nb = u8(c.nb), lv = u8(c.lvlvis_in);
      e.buildClipping({ l: [l, 0], r: [r, 0], vis: [vis, 0], vx: [vx, 0], vy: [vy, 0], nb: [nb, 0], lvlvis: [lv, 0], floor: [fl, 0] });
      expect(Array.from(l)).toEqual(c.l);
      expect(Array.from(r)).toEqual(c.r);
      expect(Array.from(vis)).toEqual(c.vis);
      expect(Array.from(vx)).toEqual(c.vx_out);
      expect(Array.from(vy)).toEqual(c.vy_out);
      expect(Array.from(lv)).toEqual(c.lvlvis_out);
      expect(Array.from(fl)).toEqual(c.floor);
    }
  });
  it('draw_walls: blit sequence (x, y, flip, shape) 200/200', () => {
    const e = eng();
    for (const c of fx.draw_walls) {
      const draws: number[][] = [];
      e.blit = (_w: unknown, _t: number, shape: number, x: number, y: number, _s: number, flip: number) => draws.push([x, y, flip & 0xffff, shape]);
      e.drawWalls(c.x, c.y, c.f, {}, 6, [u8(c.lvlmap), 0], [u8(c.floor), 0]);
      expect(draws).toEqual(c.draws);
    }
  });
  it('null control: a swapped facing table must NOT match', () => {
    const bad: Natives = { ...natives!, step: natives!.step.slice().reverse() };
    const e = eng(bad);
    let diff = 0;
    for (const c of fx.step) if (e.stepAxis(c.v, c.f, c.m, c.d, 'x') !== c.x) diff++;
    expect(diff).toBeGreaterThan(50);
  });
  it('null control: R250 with a different seed diverges', () => {
    const r = new R250(); r.seed(fx.rnd[0].seed + 1);
    let diff = 0;
    for (const [lo, hi, v] of fx.rnd[0].draws) if (r.rnd(lo, hi) !== v) diff++;
    expect(diff).toBeGreaterThan(100);
  });
});

import { loadPack } from '../../dungeonhack/render-frames.ts';
import { DungeonHackView, arriveFromBelow } from '../games-dungeonhack.ts';

const haveWorld = existsSync(NAT) && existsSync(NAT.replace('natives.json', 'dungeons.json'));
describe.skipIf(!haveWorld)('Dungeon Hack walker view (real maze, level 1 of the shipped seed)', () => {
  const mk = (): { e: DhEngine; v: DungeonHackView } => {
    const e = new DhEngine(loadPack());
    e.loadLevel(0, 0);
    const en = e.entry();
    return { e, v: new DungeonHackView(e, 0, 't', { level: 0, x: en.x, y: en.y, facing: en.fdir as 0 }) };
  };
  const keys = (down: string[]) => ({ isDown: (c: string) => down.includes(c), consumePress: () => false }) as never;
  it('starts beside the up stairs at (3,26); N step goes -y; the stairs cell blocks', () => {
    const { v } = mk();
    expect(v.pose).toMatchObject({ x: 3, y: 26 });
    const p = v.update(200, keys(['KeyW']));
    expect(p).toMatchObject({ x: 3, y: 25 });
    const { v: v2 } = mk();
    v2.setPose({ level: 0, x: 3, y: 26, facing: 2 }); // S: up-stairs cell (impedance -2)
    expect(v2.update(200, keys(['KeyW']))).toBeNull();
  });
  it('null control: walls block normal movement but not noclip', () => {
    const { e, v } = mk();
    let wall: [number, number] | null = null;
    for (let y = 0; y < 32 && !wall; y++) for (let x = 0; x < 32; x++) if (e.impedance(x, y) < 0 && e.impedance(x, y) !== -2) { wall = [x, y]; break; }
    expect(wall).not.toBeNull();
    const [wx, wy] = wall!;
    // stand west of the wall and face east if that cell is open
    if (e.impedance(wx - 1, wy) >= 0) {
      v.setPose({ level: 0, x: wx - 1, y: wy, facing: 1 });
      expect(v.update(200, keys(['KeyW']))).toBeNull();
      v.setPose({ level: 0, x: wx - 1, y: wy, facing: 1 });
      v.setNoclip(true);
      expect(v.update(200, keys(['KeyW']))).toMatchObject({ x: wx, y: wy });
    }
  });
  it('frame is 176x120, non-blank, and differs when turning round', () => {
    const { v } = mk();
    const a = v.frame();
    expect(a.length).toBe(176 * 120);
    expect(new Set(a).size).toBeGreaterThan(8);
    v.setPose({ level: 0, x: 3, y: 26, facing: 2 });
    expect(Array.from(v.frame())).not.toEqual(Array.from(a));
  });
  it('arrival from below lands on an open cell next to the previous level\'s down stairs', () => {
    const e = new DhEngine(loadPack());
    e.loadLevel(0, 0);
    const p = arriveFromBelow(e);
    expect(e.impedance(p.x, p.y)).toBeGreaterThanOrEqual(0);
  });
});

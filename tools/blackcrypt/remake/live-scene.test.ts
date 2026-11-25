/**
 * Live scene: the engine's squares drawn through the walker view. Pure tests run anywhere; the retail frames need the user's `data/blackcrypt/amiga/` and the generated
 * `public/assets/blackcrypt/amiga/` (skipped cleanly otherwise) and write PNGs under `build/blackcrypt/` (gitignored: retail art).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSetFromMap } from '../../remake/engine';
import { BcEngine, type BcState } from './engine';
import { MapBuilder, monster, item, door, world, rules } from './synth';
import { monsterTiers, cropToViewport, entityFromRaw, LiveEntityLevel, MonsterSprites, monsterItems, VIEW_W, VIEW_H, type FrameInfo } from './live-scene';
import { CELL, OBJ } from '../rules-spell9';
import { haveAssets, loadViewHeadless, attachLive, renderRGBA, writePng } from './headless';

const f = (name: string, w: number, h: number): FrameInfo => ({ name, x: 0, y: 0, w, h });

describe('monster tiers (pure)', () => {
  it('Two Head ladder: 96 / 64 / 48 tiers, first frame of each', () => {
    const t = monsterTiers([f('a', 96, 129), f('b', 96, 124), f('c', 96, 126), f('d', 64, 79), f('e', 64, 81), f('g', 48, 52), f('h', 48, 53)]);
    expect(t.map(x => x.name)).toEqual(['a', 'd', 'g']);
  });
  it('Rock Eye ladder: the wider attack pose is not a tier, a same-width shorter frame is', () => {
    const t = monsterTiers([f('1', 64, 71), f('atk', 96, 83), f('2', 64, 55), f('2b', 64, 55), f('3', 32, 32), f('4', 16, 17)]);
    expect(t.map(x => x.name)).toEqual(['1', '2', '3', '4']);
  });
  it('null control: a single-frame creature has one tier at every distance', () => {
    const s = new MonsterSprites([{ index: 0, name: 'x', gfxId: '0xb3', frames: ['m1_a'] }], n => f(n, 40, 50));
    expect(s.frameFor(1, 0x80b3, 1)?.name).toBe('m1_a'); expect(s.frameFor(1, 0x80b3, 3)?.name).toBe('m1_a');
    expect(s.frameFor(1, 0x80b4, 1)).toBeNull();   // unknown creature
    expect(s.frameFor(2, 0x80b3, 1)).toBeNull();   // another map's creature
    expect(s.frameFor(1, 0x80b3, 0)).toBeNull();   // not on your own square
  });
});

describe('viewport crop (pure)', () => {
  it('keeps a fully inside sprite, crops the right edge at 208 and the top at 0, drops one fully outside', () => {
    expect(cropToViewport({ x: 10, y: 20, w: 40, h: 30 }, 50, 50)).toEqual({ srcX: 10, srcY: 20, srcW: 40, srcH: 30, destX: 50, destY: 50 });
    expect(cropToViewport({ x: 10, y: 20, w: 40, h: 30 }, VIEW_W - 10, 50)).toMatchObject({ srcW: 10, destX: VIEW_W - 10 });
    expect(cropToViewport({ x: 0, y: 0, w: 40, h: 30 }, 5, -10)).toMatchObject({ srcY: 10, srcH: 20, destY: 0 });
    expect(cropToViewport({ x: 0, y: 0, w: 40, h: 30 }, VIEW_W, 0)).toBeNull();
    expect(cropToViewport({ x: 0, y: 0, w: 40, h: 30 }, 0, VIEW_H)).toBeNull();
  });
});

describe('engine scene and live entity level (synthetic map)', () => {
  const corridor = (b: (m: MapBuilder) => void): BcState => { const m = new MapBuilder().room(10, 10, 24, 12); b(m); return BcEngine.newGame(world([m.build()]), 7, { pose: { x: 11, y: 11, facing: 1 } }); };
  it('view().scene places a monster, a door and an item at their depth ahead', () => {
    const st = corridor(m => { m.put(13, 11, monster({ hp: 9 })); m.put(12, 11, item(30)); m.put(14, 11, door(0)); });
    const sc = BcEngine.view(st).scene;
    expect(sc.find(c => c.depth === 2 && c.lateral === 0)!.monsters).toHaveLength(1);
    expect(sc.find(c => c.depth === 1 && c.lateral === 0)!.items).toHaveLength(1);
    expect(sc.find(c => c.depth === 3 && c.lateral === 0)!.structures[0]).toMatchObject({ type: 0x11, open: false });
    expect(sc.find(c => c.depth === 2 && c.lateral === 1)!.monsters).toHaveLength(0);   // the square to the right is empty
  });
  it('a door that the engine opens turns up open in the scene (null control: not before)', () => {
    const st = corridor(m => { m.put(12, 11, door(0)); });
    expect(BcEngine.view(st).scene.find(c => c.depth === 1 && c.lateral === 0)!.structures[0].open).toBe(false);
    BcEngine.step(st, [{ kind: 'openDoor' }]); for (let i = 0; i < 8; i++) BcEngine.step(st, []);
    expect(BcEngine.view(st).scene.find(c => c.depth === 1 && c.lateral === 0)!.structures[0].open).toBe(true);
  });
  it('entityFromRaw maps a record like the levels.json exporter (monster sentinel 0x80, gfx byte 1, flags word)', () => {
    const st = corridor(m => { m.put(12, 11, monster({ hp: 9 })); m.put(13, 11, door(1)); });
    const [mon] = BcEngine.entitiesAt(st, 12, 11), [dr] = BcEngine.entitiesAt(st, 13, 11);
    expect(entityFromRaw(mon)).toMatchObject({ type: 0x80, gfx: 0xb3 });
    expect(entityFromRaw(dr)).toMatchObject({ type: 0x11, flags: 1 });
  });
  it('LiveEntityLevel passes through without a source and swaps the entity list with one', () => {
    const base = { inBounds: () => true, wallAt: () => false, planeAt: () => 0, entitiesAt: () => [{ type: 5 }], entityHandlesAt: () => [{ handle: 's', entity: { type: 5 } }] };
    const lv = new LiveEntityLevel(base);
    expect(lv.entitiesAt(1, 1)).toEqual([{ type: 5 }]);
    lv.source = { entities: () => [{ handle: 'l', entity: { type: 0x11 } }] };
    expect(lv.entityHandlesAt(1, 1)[0].handle).toBe('l');
    lv.source = null;
    expect(lv.entityHandlesAt(1, 1)[0].handle).toBe('s');
  });
  it('monsterItems hides a lateral monster behind a side wall and keeps the centre one', () => {
    const sprites = new MonsterSprites([{ index: 0, name: 'x', gfxId: '0xb3', frames: ['m1_a'] }], n => f(n, 40, 50));
    const mk = (lateral: number) => [{ depth: 2, lateral, x: 0, y: 0, monsters: [{ id: 1, gfx: 0x80b3, hp: 5 }], structures: [], items: [] }];
    expect(monsterItems(mk(0), 1, sprites, 'monsters', () => true)).toHaveLength(1);
    expect(monsterItems(mk(1), 1, sprites, 'monsters', () => true)).toHaveLength(0);
    expect(monsterItems(mk(1), 1, sprites, 'monsters', () => false)).toHaveLength(1);
  });
  it('wall bits used for the side gate are the engine cell bits', () => {
    const st = corridor(() => {});
    const w = (x: number, y: number, d: number) => (((st.sim.a.w(CELL(x, y)) << 16) | st.sim.a.w(CELL(x, y) + 2)) >>> 0 & (0x1000 << d)) !== 0;
    expect(w(15, 10, 2)).toBe(true); expect(w(15, 11, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const DATA = resolve(__dirname, '../../../data/blackcrypt/amiga');
const haveData = ['bcdfs', 'bcdfp', 'bcdft'].every(n => existsSync(resolve(DATA, n)));
const OUT = resolve(__dirname, '../../../build/blackcrypt');
const D4: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

describe.skipIf(!haveData || !haveAssets())('live scene on the retail files (headless frames)', () => {
  const files = haveData ? fileSetFromMap(new Map(['bcdfs', 'bcdfp', 'bcdft'].map(n => [n, new Uint8Array(readFileSync(resolve(DATA, n)))]))) : (null as never);
  const w = BcEngine.withRules(rules).load(files, 'amiga') as ReturnType<typeof BcEngine.load>;
  const wallBit = (st: BcState, x: number, y: number, d: number) => (((st.sim.a.w(CELL(x, y)) << 16) | st.sim.a.w(CELL(x, y) + 2)) >>> 0 & (0x1000 << d)) !== 0;
  /** a straight, wall-free approach of length >= k to a square whose chain satisfies `want`: returns the target, the facing and the party squares at 1..k from it */
  function find(map: number, want: (st: BcState, x: number, y: number) => boolean, k = 3) {
    const st = BcEngine.newGame(w, 1, { map });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (!st.sim.chain(x, y).length || !want(st, x, y)) continue;
      for (let f = 0; f < 4; f++) {
        const [dx, dy] = D4[f]; let ok = true;
        for (let i = 1; i <= k && ok; i++) { const px = x - dx * i, py = y - dy * i; ok = px >= 0 && py >= 0 && px < 64 && py < 64 && !wallBit(st, px, py, f) && !wallBit(st, px, py, (f + 2) & 3) === !wallBit(st, px, py, (f + 2) & 3) && !wallBit(st, px + dx, py + dy, (f + 2) & 3); }
        if (ok) return { st, x, y, f, at: (i: number) => ({ x: x - D4[f][0] * i, y: y - D4[f][1] * i }) };
      }
    }
    return null;
  }
  const isMon = (st: BcState, x: number, y: number) => st.sim.chain(x, y).some(id => (st.sim.a.w(OBJ(id)) & 0x8000) !== 0);
  const isDoor = (st: BcState, x: number, y: number) => st.sim.chain(x, y).some(id => st.sim.a.b(OBJ(id) + 5) === 0x11);
  // an item the package draws as a floor graphic: not a monster, not a handled structure, and its gfx has a floor group (slots.json floorItem, regenerated by scripts/export_dungeon_props.py)
  const FI = JSON.parse(readFileSync(resolve(__dirname, '../../../public/assets/blackcrypt/amiga/dungeon/slots.json'), 'utf8')).floorItem as { gfxToGroup: number[]; noneGroup: number } | undefined;
  const HANDLED = new Set([0x16, 0x20, 0x21, 0x12, 0x0f, 0x22, 0x1e, 0x11]);
  const isLoot = (st: BcState, x: number, y: number) => !!FI && st.sim.chain(x, y).some(id => { const a = st.sim.a, t = a.b(OBJ(id) + 5), g = FI.gfxToGroup[a.b(OBJ(id) + 1)]; return (a.w(OBJ(id)) & 0x8000) === 0 && !HANDLED.has(t) && g !== undefined && g !== FI.noneGroup; });

  function frame(map: number, st: BcState, pose: { x: number; y: number; facing: number }, name: string) {
    const scene = loadViewHeadless(map, { level: map, x: pose.x, y: pose.y, facing: pose.facing as 0 | 1 | 2 | 3 });
    st.sim.party(pose.x, pose.y, pose.facing);
    const live = attachLive(scene, () => st);
    scene.view.setPose({ level: map, x: pose.x, y: pose.y, facing: pose.facing as 0 | 1 | 2 | 3 });
    scene.view.refreshLive();
    const r = renderRGBA(scene, 2);
    writePng(resolve(OUT, `live-${name}.png`), r.rgba, r.width, r.height);
    return { scene, r, live };
  }
  /** pixels of the 208x140 viewport that differ between two indexed frames */
  const diff = (a: Uint8Array, b: Uint8Array) => { let n = 0; for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) if (a[y * 320 + x] !== b[y * 320 + x]) n++; return n; };

  it('a monster appears at depths 1, 2 and 3 with its real sprite, and not when the engine has none there', () => {
    let done = false;
    for (let map = 1; map <= 13 && !done; map++) {
      const s = find(map, isMon);
      if (!s) continue;
      done = true;
      const sizes: number[] = [];
      for (const d of [1, 2, 3]) {
        const p = s.at(d), { scene, r } = frame(map, s.st, { ...p, facing: s.f }, `monster-map${map}-d${d}`);
        const mons = scene.view.items.filter(i => i.propType === 'monster');
        expect(mons.length).toBeGreaterThan(0);
        expect(mons[0].depth).toBe(d);
        sizes.push(mons[0].srcW! * mons[0].srcH!);
        // null control: the same frame with the monster removed from the engine differs inside the sprite area
        const st2 = BcEngine.restore(w, BcEngine.save(s.st));
        for (const id of st2.sim.chain(s.x, s.y)) if (isMonId(st2, id)) st2.sim.a.setW(OBJ(id), st2.sim.a.w(OBJ(id)) & 0x7fff);
        const r2 = frame(map, st2, { ...p, facing: s.f }, `monster-map${map}-d${d}-none`).r;
        expect(diff(r.indexed.data, r2.indexed.data)).toBeGreaterThan(100);
      }
      expect(sizes[0]).toBeGreaterThanOrEqual(sizes[2]);   // nearer is not smaller
    }
    expect(done).toBe(true);
  }, 120000);
  const isMonId = (st: BcState, id: number) => (st.sim.a.w(OBJ(id)) & 0x8000) !== 0;

  it('a hit shows an effect flash over the monster for a few ticks and then it is gone', () => {
    for (let map = 1; map <= 13; map++) {
      const s = find(map, isMon, 2); if (!s) continue;
      const p = { ...s.at(1), facing: s.f };
      const base = frame(map, s.st, p, `effect-map${map}-before`);
      const id = s.st.sim.chain(s.x, s.y).find(i => isMonId(s.st, i))!;
      base.live.feed([{ what: 'swing', hit: true, P: id, tick: 1 }]);
      base.scene.view.refreshLive();
      const fx = base.scene.view.items.filter(i => i.propType === 'effect');
      expect(fx).toHaveLength(1);
      const r = renderRGBA(base.scene, 2); writePng(resolve(OUT, `live-effect-map${map}-hit.png`), r.rgba, r.width, r.height);
      expect(diff(base.r.indexed.data, r.indexed.data)).toBeGreaterThan(20);
      for (let t = 0; t < 4; t++) base.live.tick();
      base.scene.view.refreshLive();
      expect(base.scene.view.items.filter(i => i.propType === 'effect')).toHaveLength(0);
      // null control: a miss draws nothing
      base.live.feed([{ what: 'swing', hit: false, P: id, tick: 2 }]); base.scene.view.refreshLive();
      expect(base.scene.view.items.filter(i => i.propType === 'effect')).toHaveLength(0);
      return;
    }
    throw new Error('no monster scenario found');
  }, 120000);

  it('a door shows closed, then open after the engine opens it', () => {
    let done = false;
    for (let map = 1; map <= 13 && !done; map++) {
      const s = find(map, isDoor, 2);
      if (!s) continue;
      done = true;
      const p = s.at(1);
      // the first door of the map may be locked (the lock bit is word +0x0E bit 1); unlock it so the plain open command applies
      for (const id of s.st.sim.chain(s.x, s.y)) if (s.st.sim.a.b(OBJ(id) + 5) === 0x11) s.st.sim.a.setB(OBJ(id) + 0xf, s.st.sim.a.b(OBJ(id) + 0xf) & ~2);
      const closed = frame(map, s.st, { ...p, facing: s.f }, `door-map${map}-closed`).r;
      s.st.sim.party(p.x, p.y, s.f);
      for (let i = 0; i < 3; i++) BcEngine.step(s.st, [{ kind: 'openDoor' }]);
      for (let i = 0; i < 12; i++) BcEngine.step(s.st, []);
      const open = frame(map, s.st, { ...p, facing: s.f }, `door-map${map}-open`).r;
      expect(diff(closed.indexed.data, open.indexed.data)).toBeGreaterThan(50);
    }
    expect(done).toBe(true);
  }, 120000);

  it('a floor item is drawn from the engine square and disappears when it is picked up', () => {
    let done = false;
    for (let map = 1; map <= 13 && !done; map++) {
      const s = find(map, isLoot, 2);
      if (!s) continue;
      const p = s.at(1);
      const a = frame(map, s.st, { ...p, facing: s.f }, `item-map${map}`);
      const floor = a.scene.view.items.filter(i => i.propType === 'floor-item');
      if (floor.length === 0) continue;
      done = true;
      // pick it up in the engine (remove it from its chain) and the live view loses the sprite
      const st2 = BcEngine.restore(w, BcEngine.save(s.st));
      for (const id of st2.sim.chain(s.x, s.y)) if (!isMonId(st2, id)) st2.sim.a.setB(OBJ(id) + 5, 0x13), st2.sim.a.setW(OBJ(id), 0);
      const b = frame(map, st2, { ...p, facing: s.f }, `item-map${map}-gone`);
      expect(b.scene.view.items.filter(i => i.propType === 'floor-item').length).toBeLessThan(floor.length);
    }
    expect(done).toBe(true);
  }, 120000);
});

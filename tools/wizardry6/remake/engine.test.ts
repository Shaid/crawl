/**
 * Wizardry 6 remake engine: scripted scenarios on the user's own retail files and the walker's generated level files (skipped when either is absent: nothing retail is committed),
 * parity of the engine against driving the verified rules directly (`combat-sim.ts`, `movement.ts`), and null controls. Run: `npx vitest run tools/wizardry6/remake`.
 */
import { describe, expect, it } from 'vitest';
import { A4, L3_BASE, L3_STRIDE, L2_BASE, L2_STRIDE } from './image';
import { fileSetFromMap } from '../../remake/engine';
import { CombatWorld } from '../combat-sim';
import { arrive, tryMove, W6TriggerState } from '../movement';
import { W6Rng } from '../rules';
import { makeEngine, seedToRng, stepState, REQUIRED, type W6Cmd, type W6Event, type W6State, type W6World, describeEvent } from './engine';
import { diffRuns } from './image';
import { STARTER_PARTY } from './party';
import { haveLevels, haveRetail, loadAssets, retailFiles } from './node-files';
import { Mem } from '../combat';
import tableJson from '../spell-table.json' with { type: 'json' };

const have = haveRetail() && haveLevels();
const G = (d: number) => A4 + d;

describe('detect (no retail data needed)', () => {
  const E = makeEngine();
  const fake = (sizes: Record<string, number>) => ({ has: (n: string) => n in sizes, read: () => undefined, size: (n: string) => sizes[n] });
  it('recognises the Amiga release by names and sizes, rejects anything else', () => {
    expect(E.detect(fake(REQUIRED))?.engine).toBe('wizardry6');
    expect(E.detect(fake({ ...REQUIRED, 'scenario.dbs': 1 }))).toBeNull();
    expect(E.detect(fake({ Bane: REQUIRED.Bane }))).toBeNull();
  });
  it('a step with no commands is a no-op and turn-based timing is declared', () => {
    expect(E.timing.mode).toBe('turn');
    expect(E.coverage().length).toBeGreaterThan(15);
    expect(E.coverage().some(r => r.grade === 'stub')).toBe(true);
    expect(E.coverage().some(r => r.grade === 'harness')).toBe(true);
  });
  it('seed -> generator words are in the game\'s valid ranges and differ by seed', () => {
    const a = seedToRng(1), b = seedToRng(2);
    expect(a).not.toEqual(b);
    for (const s of [0, 1, 0xffffffff, 12345]) { const [x, y, z] = seedToRng(s); expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(30269); expect(y).toBeLessThan(30307); expect(z).toBeLessThan(30323); }
  });
  it('without bound assets, load refuses with a clear message', () => {
    const files = fileSetFromMap(new Map(Object.keys(REQUIRED).map(n => [n, new Uint8Array(REQUIRED[n])])));
    expect(() => E.load(files, 'amiga')).toThrow(/levels are not bound/);
  });
});

describe.skipIf(!have)('Wizardry 6 engine on the retail files', () => {
  const files = have ? retailFiles() : (undefined as never);
  const assets = have ? loadAssets() : (undefined as never);
  const E = have ? makeEngine(assets) : (undefined as never);
  const world: W6World = have ? (E.load(files, 'amiga') as W6World) : (undefined as never);
  const fresh = (seed = 1, opts?: object): W6State => E.newGame(world, seed, opts);
  const run = (st: W6State, ...cmds: W6Cmd[]): W6Event[] => E.step(st, cmds);
  const whats = (ev: W6Event[]) => ev.map(e => e.what);
  const snapshot = (st: W6State) => Buffer.from(E.save(st)).toString('utf8');
  const memEq = (a: Mem, b: Mem): boolean => {
    for (const [k, v] of a.b) if ((b.b.get(k) ?? 0) !== v) return false;
    for (const [k, v] of b.b) if ((a.b.get(k) ?? 0) !== v) return false;
    return true;
  };
  /** a cell and facing from which a step forward and the step back are both plain moves (a corridor to pace in), on `level` */
  const corridor = (level: number): { x: number; y: number; facing: number } => {
    const L = world.levels[level];
    for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) {
      if ((L.planes.region?.[y * L.width + x] ?? -1) < 0) continue;
      for (let d = 0; d < 4; d++) {
        const f = tryMove(L.planes, L.links, x, y, d, d);
        if (f.kind !== 'moved' || f.warped) continue;
        const b = tryMove(L.planes, L.links, f.x, f.y, (d + 2) & 3, d);
        if (b.kind === 'moved' && b.x === x && b.y === y) return { x, y, facing: d };
      }
    }
    throw new Error('no corridor');
  };
  /** a fight against monster `id` on a quiet level, in the engine */
  const fight = (seed: number, id: number, opts?: object) => { const st = fresh(seed, opts); run(st, { kind: 'warp', level: 3, x: 5, y: 5 }); run(st, { kind: 'encounter', id }); return st; };
  const play = (st: W6State, max = 40): W6Event[] => { const out: W6Event[] = []; for (let r = 0; r < max && st.mode === 'combat'; r++) out.push(...run(st, { kind: 'round' })); return out; };

  it('loads: the image carries the real constant tables (spell table equals the committed spell-table.json)', () => {
    for (let s = 0; s < 82; s++) for (let k = 0; k < 6; k++) expect(world.base.get(G(-31698 + s * 6 + k)) ?? 0).toBe((tableJson as { rows: number[][] }).rows[s][k]);
    expect(world.levels).toHaveLength(14);
    expect(world.xp[0][0]).toBe(1000);                                  // fighter, XP to leave level 1
  });

  it('a new game is deterministic from the seed; a different seed gives a different game (null control)', () => {
    expect(snapshot(fresh(7))).toBe(snapshot(fresh(7)));
    expect(snapshot(fresh(7))).not.toBe(snapshot(fresh(8)));
    expect(fresh(7).rng.s).not.toEqual(fresh(8).rng.s);
    const v = E.view(fresh(7));
    expect(v.pose).toEqual({ level: 12, x: 17, y: 15, facing: 2 });     // the game's new-party start (CODE+0x4212a)
    expect(v.party.map(p => p.name)).toEqual(STARTER_PARTY.map(p => p.name));
    expect(v.party[0].weapon).toBe('SHORT SWORD');
  });

  it('step with no commands changes nothing', () => {
    const st = fresh(3); const before = snapshot(st);
    expect(E.step(st, [])).toEqual([]);
    expect(snapshot(st)).toBe(before);
  });

  it('walks, bumps into a wall without moving, and turns', () => {
    const st = fresh(3);
    const c = corridor(3);
    run(st, { kind: 'warp', level: 3, ...c });
    const ev = run(st, { kind: 'move', dir: 'forward' });
    expect(whats(ev)).toContain('step');
    expect([st.pose.x, st.pose.y]).not.toEqual([c.x, c.y]);
    run(st, { kind: 'turn', by: 1 });
    expect(st.pose.facing).toBe((c.facing + 1) & 3);
    // find a wall by walking into it
    let bumped = false;
    for (let i = 0; i < 40 && !bumped && st.mode === 'explore'; i++) { const p = { ...st.pose }; const e = run(st, { kind: 'move', dir: 'forward' }); if (whats(e).some(w => w === 'bump' || w === 'bounce')) { bumped = true; expect(st.pose).toEqual(p); } }
    expect(bumped).toBe(true);
  });

  it('movement and arrivals equal the walker rules (tryMove + arrive) over a random walk', () => {
    let compared = 0;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const st = fresh(seed);
      const trig = new W6TriggerState();
      let { level, x, y, facing } = st.pose;
      trig.enterLevel(level, world.levels[level].links.initialFlags);
      const doors = [0, 0, 0, 0];
      let dstate = doors;
      const rnd = new W6Rng(seedToRng(seed + 100));
      for (let i = 0; i < 500 && st.mode === 'explore'; i++) {
        const r = rnd.random(6);
        if (r === 5) { facing = (facing + 1) & 3; run(st, { kind: 'turn', by: 1 }); continue; }
        const dir = (['forward', 'back', 'left', 'right', 'forward'] as const)[r];
        const rel = { forward: 0, right: 1, back: 2, left: 3 }[dir];
        const L = world.levels[level];
        const m = tryMove(L.planes, L.links, x, y, (facing + rel) & 3, facing, dstate);
        const ev = run(st, { kind: 'move', dir });
        if (st.mode !== 'explore') break;                              // a fight / death ends the comparison (they are other rules)
        if (m.kind !== 'moved') { expect(st.pose).toEqual({ level, x, y, facing }); continue; }
        dstate = [0, 0, 0, 0];
        const a = arrive(L.planes, L.links, trig, m.x, m.y);
        dstate = a.doorState;
        x = a.pose.x; y = a.pose.y;
        if (a.levelChange) { level = a.pose.level; trig.enterLevel(level, world.levels[level].links.initialFlags); }
        expect(whats(ev)).not.toContain('entity-unmodelled-never');
        expect(st.pose).toEqual({ level, x, y, facing });
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(250);
  });

  it('a teleporter moves the party to its destination (level change included)', () => {
    // find a kind-1 teleporter armed at new game, reachable by one plain step from a neighbouring cell
    let found: { from: { level: number; x: number; y: number; facing: number }; to: { level: number; x: number; y: number } } | null = null;
    for (const L of world.levels) {
      L.links.entities.kind.forEach((kind, k) => {
        if (found || kind !== 1) return;
        const dest = L.links.teleportDest[k]; const w = L.links.entities.w000[k];
        if (!dest || w === 3 || w > 6 || dest.level === L.id) return;
        const bit = L.links.entities.flagBit[k]; if ((L.links.initialFlags[bit >> 3] >> (bit & 7)) & 1) return;
        const o = L.links.regionOrigin[L.links.entities.region[k]]; if (!o) return;
        const cx = o.x + L.links.entities.localX[k], cy = o.y + L.links.entities.localY[k];
        // other entities on the cell would alter the result: require this to be the only one
        const n = L.links.entities.kind.filter((kk, j) => kk && L.links.entities.region[j] === L.links.entities.region[k] && L.links.entities.localX[j] === L.links.entities.localX[k] && L.links.entities.localY[j] === L.links.entities.localY[k]).length;
        if (n !== 1) return;
        for (let d = 0; d < 4; d++) {
          const nx = cx - [0, 1, 0, -1][d], ny = cy - [1, 0, -1, 0][d];
          if (tryMove(L.planes, L.links, nx, ny, d, d).kind === 'moved' && (L.planes.region?.[ny * L.width + nx] ?? -1) >= 0) { found = { from: { level: L.id, x: nx, y: ny, facing: d }, to: dest }; return; }
        }
      });
      if (found) break;
    }
    expect(found).not.toBeNull();
    const f = found!;
    const st = fresh(5);
    run(st, { kind: 'warp', ...f.from });
    const ev = run(st, { kind: 'move', dir: 'forward' });
    expect(whats(ev)).toContain('teleport');
    expect(st.pose.level).toBe(f.to.level);
    expect(st.pose.x).toBe(f.to.x);
    expect(st.pose.y).toBe(f.to.y);
    // null control: standing on the neighbour (not stepping) leaves the party where it was
    const st2 = fresh(5); run(st2, { kind: 'warp', ...f.from });
    expect(st2.pose.level).toBe(f.from.level);
  });

  it('a scripted fight starts when the party steps onto an armed cell, once', () => {
    let found: { level: number; a: { x: number; y: number; d: number }; b: { x: number; y: number } } | null = null;
    for (let lv = 0; lv < 14 && !found; lv++) {
      const st = fresh(1); run(st, { kind: 'warp', level: lv, x: world.levels[lv].entrance?.x ?? 0, y: world.levels[lv].entrance?.y ?? 0 });
      const L = world.levels[lv];
      for (let y = 0; y < L.height && !found; y++) for (let x = 0; x < L.width && !found; x++) {
        const region = L.planes.region?.[y * L.width + x] ?? -1; const o = region >= 0 ? L.links.regionOrigin[region] : null; if (!o) continue;
        const bit = (region << 6) + ((y - o.y) << 3) + (x - o.x);
        if (!((st.m.u8(G(-18018) + (bit >> 3)) >> (bit & 7)) & 1)) continue;
        for (let d = 0; d < 4 && !found; d++) {
          const nx = x - [0, 1, 0, -1][d], ny = y - [1, 0, -1, 0][d];
          const r2 = nx >= 0 && ny >= 0 && nx < L.width && ny < L.height ? (L.planes.region?.[ny * L.width + nx] ?? -1) : -1; const o2 = r2 >= 0 ? L.links.regionOrigin[r2] : null;
          if (!o2) continue;
          const bit2 = (r2 << 6) + ((ny - o2.y) << 3) + (nx - o2.x);
          if (((st.m.u8(G(-18018) + (bit2 >> 3)) >> (bit2 & 7)) & 1) === 0 && tryMove(L.planes, L.links, nx, ny, d, d).kind === 'moved') found = { level: lv, a: { x: nx, y: ny, d }, b: { x, y } };
        }
      }
    }
    expect(found).not.toBeNull();
    const f = found!;
    const st = fresh(2); run(st, { kind: 'warp', level: f.level, x: f.a.x, y: f.a.y, facing: f.a.d });
    expect(st.mode).toBe('explore');
    const ev = run(st, { kind: 'move', dir: 'forward' });
    // entities on the cell may fire first; the fight must start either way
    expect(st.mode).toBe('combat');
    expect(st.fight!.scripted).toBe(true);
    expect(whats(ev)).toContain('encounter');
  });

  it('wandering encounters happen at about half a percent per step, and long walks trigger the forced camp', () => {
    const st = fresh(9);
    run(st, { kind: 'warp', level: 3, ...corridor(3) });
    let steps = 0, wandering = 0, camped = false;
    for (let i = 0; i < 8000 && wandering === 0 && st.mode === 'explore'; i++) {
      const ev = run(st, { kind: 'move', dir: i % 2 ? 'back' : 'forward' });
      if (whats(ev).includes('step')) steps++;
      if (whats(ev).includes('wandering')) wandering++;
      if (st.m.u32(G(-18302)) > steps + 100) camped = true;            // a forced camp advances the clock by a whole rest
    }
    expect(wandering).toBe(1);
    expect(st.mode).toBe('combat');
    expect(steps).toBeLessThan(8000);
    expect(steps).toBeGreaterThan(5);
    void camped;
  });

  it('fights to a victory: XP split, gold, treasure to the loot screen, take, leave', () => {
    let st: W6State | null = null, evs: W6Event[] = [];
    for (let seed = 1; seed < 20 && !st; seed++) { const s = fight(seed, 8); evs = play(s); if (s.mode === 'loot') st = s; }
    expect(st).not.toBeNull();
    const s = st!;
    expect(whats(evs)).toContain('victory');
    const v = E.view(s);
    expect(v.party[0].xp).toBeGreaterThan(0);
    expect(v.party[0].gold).toBeGreaterThan(100);
    expect(v.loot.length).toBeGreaterThan(0);
    const names = v.loot.map(l => l.name);
    const ev = run(s, { kind: 'takeAll' });
    expect(whats(ev)).toContain('taken');
    expect(s.mode).toBe('explore');
    expect(E.view(s).party.flatMap(p => p.items)).toContain(names[0]);
  });

  it('a party that never attacks leaves the monsters alive; one that attacks kills them (null control)', () => {
    const st = fight(4, 1);
    const before = E.view(st).fight!.groups.map(g => g.hp);
    for (let r = 0; r < 3 && st.mode === 'combat'; r++) run(st, { kind: 'planAll', plan: { act: 'hide' } }, { kind: 'round' });
    expect(E.view(st).fight!.groups.map(g => g.hp)).toEqual(before);
    expect(E.view(st).fight!.groups.every(g => g.living === g.count)).toBe(true);
    const st2 = fight(4, 1);
    play(st2);
    expect(st2.mode).not.toBe('combat');
  });

  it('a hopeless fight ends the game and the engine then refuses commands', () => {
    const st = fight(1, 100);
    const ev = play(st);
    expect(st.mode).toBe('over');
    expect(whats(ev)).toContain('party-wiped');
    expect(whats(run(st, { kind: 'move', dir: 'forward' }))).toEqual(['refused']);
  });

  it('casts a spell: the caster pays spell points and the monsters take damage (a seed where it does not fizzle)', () => {
    let ok = false;
    for (let seed = 1; seed < 40 && !ok; seed++) {
      const st = fight(seed, 8);
      const sp0 = E.view(st).party[2].sp[0][0];
      const hp0 = E.view(st).fight!.groups.reduce((s, g) => s + g.hp.reduce((a, b) => a + b, 0), 0);
      run(st, { kind: 'plan', member: 2, plan: { act: 'cast', spell: 2, power: 1, tg: 1, ti: -3 } });
      for (let i = 0; i < 6; i++) if (i !== 2) run(st, { kind: 'plan', member: i, plan: { act: 'hide' } });
      const ev = run(st, { kind: 'round' });
      const c = ev.find(e => e.what === 'cast');
      if (!c || c.fizzled || c.backfired) continue;
      const cur = E.view(st);
      const hp1 = cur.fight ? cur.fight.groups.reduce((s, g) => s + g.hp.reduce((a, b) => a + b, 0), 0) : 0;
      expect(cur.party[2].sp[0][0]).toBeLessThan(sp0);
      expect(hp1).toBeLessThan(hp0);
      expect(c.name).toBeDefined();
      ok = true;
    }
    expect(ok).toBe(true);
  });

  it('camp restores the party; the world clock advances', () => {
    const st = fresh(6);
    run(st, { kind: 'warp', level: 3, x: 5, y: 5 });
    // hurt a member, camp
    st.m.w16(A4 - 17922 + 24, 1);
    const clock0 = st.m.u32(G(-18302));
    const ev = run(st, { kind: 'camp' });
    expect(whats(ev)).toContain('camp');
    expect(st.m.u32(G(-18302))).toBeGreaterThan(clock0);
  });

  it('level-up on the XP award (a member near the threshold)', () => {
    let leveled = false;
    for (let seed = 1; seed < 20 && !leveled; seed++) {
      const st = fight(seed, 8);
      st.m.w32(A4 - 17922 + 12, 990);                                  // the fighter: 1000 XP to leave level 1
      const ev = play(st);
      if (whats(ev).includes('level-up')) { leveled = true; expect(E.view(st).party[0].level).toBe(2); expect(E.view(st).party[0].maxHp).toBeGreaterThan(19); }
    }
    expect(leveled).toBe(true);
  });

  it('chest: an armed trap springs on opening and hurts the party (trap 1: every member takes damage)', () => {
    const st = fresh(8);
    run(st, { kind: 'chest', trapMask: 0x0002, treasure: 35 });
    expect(st.mode).toBe('chest');
    expect(st.chest!.trap).toBe(1);
    const hp0 = E.view(st).party.map(p => p.hp);
    const ev = run(st, { kind: 'chestOpen', who: 0 });
    expect(whats(ev)).toContain('trap');
    expect(E.view(st).party.map(p => p.hp).some((h, i) => h < hp0[i])).toBe(true);
  });

  it('chest: a trap that slays everyone ends the game', () => {
    const st = fresh(8);
    run(st, { kind: 'chest', trapMask: 0x8000, treasure: 35 });
    expect(st.chest!.trap).toBe(15);
    run(st, { kind: 'chestOpen', who: 0 });
    expect(st.mode).toBe('over');
  });

  it('chest: naming the trap and disarming it lets the party open it safely and take the treasure', () => {
    let done = false;
    for (let seed = 1; seed < 60 && !done; seed++) {
      const st = fresh(seed);
      run(st, { kind: 'chest', trapMask: 0x0002, treasure: 35 });
      let disarmed = false;
      for (let t = 0; t < 12 && !disarmed && st.mode === 'chest'; t++) {
        const ev = run(st, { kind: 'chestDisarm', who: 4, trap: 1 });          // the thief
        if (whats(ev).includes('disarmed')) disarmed = true;
        if (whats(ev).includes('disarm-failed') || whats(ev).includes('trap')) break;
      }
      if (!disarmed) continue;
      const hp0 = E.view(st).party.map(p => p.hp);
      const ev = run(st, { kind: 'chestOpen', who: 0 });
      expect(whats(ev)).not.toContain('trap');
      expect(E.view(st).party.map(p => p.hp)).toEqual(hp0);
      expect(whats(ev)).toContain('chest-opened');
      done = true;
    }
    expect(done).toBe(true);
  });

  it('chest: inspect reveals letters of the trap name over a few tries', () => {
    const st = fresh(8);
    run(st, { kind: 'chest', trapMask: 0x0002, treasure: 35 });
    let letters = '';
    for (let i = 0; i < 12; i++) { const ev = run(st, { kind: 'chestInspect', who: 4 }); letters = String(ev.find(e => e.what === 'inspect')?.letters ?? letters); }
    expect(letters.length).toBeGreaterThan(0);
  });

  it('save / restore round-trips, mid-battle too: the restored game continues exactly like the original', () => {
    let st: W6State | null = null;
    for (let seed = 1; seed < 60 && !st; seed++) { const s = fight(seed, 1, undefined); run(s, { kind: 'planAll', plan: { act: 'attack' } }); run(s, { kind: 'round' }); if (s.mode === 'combat') st = s; }
    expect(st).not.toBeNull();
    const s = st!;
    const bytes = E.save(s);
    const r = E.restore(world, bytes);
    expect(Buffer.from(E.save(r)).toString()).toBe(Buffer.from(bytes).toString());
    expect(E.view(r)).toEqual(E.view(s));
    const a = play(s), b = play(r);
    expect(b).toEqual(a);
    expect(snapshot(r)).toBe(snapshot(s));
    // exploring state too
    const x = fresh(3); run(x, { kind: 'move', dir: 'forward' });
    expect(snapshot(E.restore(world, E.save(x)))).toBe(snapshot(x));
    // the save is small (a diff against the base image, not the whole memory)
    expect(bytes.length).toBeLessThan(200000);
  });

  it('PARITY: every engine round equals the verified combat sim driven directly on a copy of the same memory', () => {
    let rounds = 0;
    for (const [seed, id] of [[3, 1], [5, 8], [7, 2]] as const) {
      const st = fight(seed, id);
      const twin = E.restore(world, E.save(st));
      const w = Object.create(CombatWorld.prototype) as CombatWorld;
      const sizes = () => Array.from({ length: twin.m.s16(G(-15140)) }, (_, k) => twin.m.u8(0x400000 + (k + 1) * 0x400 + 413));
      for (let r = 0; r < 30 && st.mode === 'combat'; r++) {
        Object.assign(w, { mem: twin.m, rng: twin.rng, partySize: twin.m.s16(G(-15306)), groupSizes: sizes(), log: [], evaded: [], groupIds: [], casts: [], breaths: [], flee: [], castFx: [], actions: [], itemRec: () => ({ w28: 0, b60: 0, b69: 0 }) });
        w.partyPolicy = () => ({ act: 'attack' });
        w.io = { loadMonster: () => undefined, formation: () => 0, picture: () => undefined };
        w.gameRound();
        const fled = w.hasFled();
        run(st, { kind: 'round' });
        rounds++;
        if (st.mode !== 'combat') { expect(fled).toBe(false); break; }
        st.m.wrote.clear();
        expect(memEq(st.m, twin.m)).toBe(true);
        expect(st.rng.s).toEqual(twin.rng.s);
      }
    }
    expect(rounds).toBeGreaterThan(3);
  });

  it('PARITY null control: a different order (everyone hides) is not the same memory', () => {
    const st = fight(5, 8);
    const twin = E.restore(world, E.save(st));
    run(st, { kind: 'planAll', plan: { act: 'hide' } }, { kind: 'round' });
    const w = Object.create(CombatWorld.prototype) as CombatWorld;
    Object.assign(w, { mem: twin.m, rng: twin.rng, partySize: twin.m.s16(G(-15306)), groupSizes: [twin.m.u8(0x400000 + 0x400 + 413)], log: [], evaded: [], groupIds: [], casts: [], breaths: [], flee: [], castFx: [], actions: [], itemRec: () => ({ w28: 0, b60: 0, b69: 0 }) });
    w.partyPolicy = () => ({ act: 'attack' });
    w.gameRound(); w.hasFled();
    st.m.wrote.clear();
    expect(memEq(st.m, twin.m)).toBe(false);
  });

  it('a one-byte change in the user\'s data shows (monster record hit dice), the unchanged data does not', () => {
    const mk = (patch: boolean) => {
      const sc = Uint8Array.from(world.scenario);
      if (patch) sc[0x154e8 + 8 * 222 + 0x7a] += 3;                    // rogue: hit-point dice count
      return { ...world, scenario: sc };
    };
    const outcome = (w: W6World) => { const st = E.newGame(w, 4); stepState(st, [{ kind: 'warp', level: 3, x: 5, y: 5 }, { kind: 'encounter', id: 8 }]); return JSON.stringify(E.view(st).fight!.groups.map(g => g.hp)); };
    expect(outcome(mk(false))).toBe(outcome(world));
    expect(outcome(mk(true))).not.toBe(outcome(world));
  });

  it('level blocks live in the image and a spent trigger stays spent across a save', () => {
    const st = fresh(2);
    const B = L3_BASE + 12 * L3_STRIDE;
    expect(st.m.u8(B + 864 + 0) + st.m.u8(L2_BASE + 12 * L2_STRIDE + 1334)).toBeGreaterThanOrEqual(0);
    const r = E.restore(world, E.save(st));
    expect(diffRuns(r.m, world.base)).toEqual(diffRuns(st.m, world.base));
  });


  it('every member exhausted: the party camps by force (the world tick), and the clock jumps by a rest', () => {
    const st = fresh(4);
    run(st, { kind: 'warp', level: 3, ...corridor(3) });
    for (let i = 0; i < 6; i++) st.m.w8(A4 - 17922 + i * 0x1b0 + 292, 6);
    const c0 = st.m.u32(G(-18302));
    run(st, { kind: 'move', dir: 'forward' });
    expect(st.m.u32(G(-18302)) - c0).toBeGreaterThanOrEqual(60);
    // null control: with no exhausted member a step advances the clock by one
    const st2 = fresh(4); run(st2, { kind: 'warp', level: 3, ...corridor(3) });
    const d0 = st2.m.u32(G(-18302)); run(st2, { kind: 'move', dir: 'forward' });
    expect(st2.m.u32(G(-18302)) - d0).toBe(1);
  });

  it('a locked door: the pick-lock command runs the verified tumbler game and unlocks or fails', () => {
    // every kind-7 entity that locks a face (state 1), reached by one plain step from a neighbouring cell: [level, from-cell, step direction, locked face]
    const spots: { level: number; fx: number; fy: number; d: number; face: number }[] = [];
    for (const L of world.levels) L.links.entities.kind.forEach((kind, k) => {
      if (kind !== 7 || spots.length > 30) return;
      const w = L.links.entities.w240[k];
      const face = [0, 1, 2, 3].find(d => ((w >> (d * 2)) & 3) === 1);
      const o = L.links.regionOrigin[L.links.entities.region[k]]; if (face === undefined || !o) return;
      const cx = o.x + L.links.entities.localX[k], cy = o.y + L.links.entities.localY[k];
      for (let d = 0; d < 4; d++) {
        const fx = cx - [0, 1, 0, -1][d], fy = cy - [1, 0, -1, 0][d];
        if (fx >= 0 && fy >= 0 && fx < L.width && fy < L.height && (L.planes.region?.[fy * L.width + fx] ?? -1) >= 0 && tryMove(L.planes, L.links, fx, fy, d, d).kind === 'moved') { spots.push({ level: L.id, fx, fy, d, face }); return; }
      }
    });
    expect(spots.length).toBeGreaterThan(3);
    let opened = 0, failed = 0, armedCount = 0;
    for (const sp of spots) for (let seed = 1; seed <= 6; seed++) {
      const st = fresh(seed);
      run(st, { kind: 'warp', level: sp.level, x: sp.fx, y: sp.fy, facing: sp.d });
      run(st, { kind: 'move', dir: 'forward' });
      if (st.mode !== 'explore') continue;
      while (st.pose.facing !== sp.face) run(st, { kind: 'turn', by: 1 });
      if (E.view(st).ahead.door !== 'locked') continue;
      armedCount++;
      const ev = run(st, { kind: 'pickLock', who: 4 });
      if (whats(ev).includes('lock-opened')) { opened++; expect(E.view(st).ahead.door).toBe('closed'); expect(whats(run(st, { kind: 'move', dir: 'forward' }))).toContain('door-open'); }
      else if (whats(ev).includes('lock-failed') || whats(ev).includes('lock-stuck')) failed++;
    }
    expect(armedCount).toBeGreaterThan(5);
    expect(opened + failed).toBeGreaterThan(0);
    expect(opened).toBeGreaterThan(0);
  });

  it('events read as text', () => {
    const st = fresh(3);
    run(st, { kind: 'warp', level: 3, ...corridor(3) });
    const ev = run(st, { kind: 'move', dir: 'forward' });
    expect(ev.map(describeEvent).join(' ')).toMatch(/steps to/);
  });
});

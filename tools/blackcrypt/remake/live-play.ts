/**
 * Glue between the engine and the walker view: `createBcLive` builds the `BlackCryptLive` plug (live entity source, monster and effect overlay, hotspot -> command)
 * that both the browser shell and the headless renderer attach with `BlackCryptView.setLive`. UI-free; the only inputs are the engine state getter and the loaded banks.
 */
import type { PieceBankLookup, Pose, DrawItem, EntityRecord } from '@seer-project/dungeon';
import type { BlackCryptLive } from '../../walker/games';
import { BcEngine, type BcState, type BcCmd } from './engine';
import { CELL } from '../rules-spell9';
import { MonsterSprites, EffectTracker, entityFromRaw, monsterItems, effectItems, type BcEventLike, type MonsterGroup, type FrameInfo } from './live-scene';

export interface BcLiveOptions {
  state: () => BcState;
  banks: PieceBankLookup;
  groups: MonsterGroup[];
  getPose: () => Pose;
  /** a click on a door / lever hotspot while live */
  onCommand?: (c: BcCmd) => void;
  /** effect sprite frames (BCSPEED atlas names); defaults are a guess at "hit" and "cast" (hyp) */
  effectFrames?: { hit: string[]; cast: string[] };
}

export interface BcLive extends BlackCryptLive {
  /** feed one tick's engine events (spawns effects); call before `refresh` */
  feed(events: BcEventLike[]): void;
  /** advance the effect timers one tick */
  tick(): void;
  readonly effects: ReturnType<EffectTracker['tick']>;
}

export function createBcLive(o: BcLiveOptions): BcLive {
  const frameOf = (b: string) => (name: string): FrameInfo | undefined => { try { const r = o.banks[b].frame(name); return { name, x: r.x, y: r.y, w: r.w, h: r.h }; } catch { return undefined; } };
  const sprites = new MonsterSprites(o.groups, frameOf('monsters'));
  const fx = new EffectTracker(o.effectFrames ?? { hit: ['gfk03_f1'], cast: ['gfk02_f2'] });
  const wallAt = (st: BcState, x: number, y: number, d: number) => x >= 0 && y >= 0 && x < 64 && y < 64 && ((((st.sim.a.w(CELL(x, y)) << 16) | st.sim.a.w(CELL(x, y) + 2)) >>> 0) & (0x1000 << d)) !== 0;
  const live: BcLive = {
    source: {
      entities(x, y) {
        const st = o.state();
        return BcEngine.entitiesAt(st, x, y).map(e => ({ handle: `live:${st.map}:${y}:${x}:${e.id}`, entity: entityFromRaw(e) }));
      },
    },
    overlay(pose: Pose, _base: DrawItem[]): DrawItem[] {
      const st = o.state(), v = BcEngine.view(st);
      const side = (depth: number, s: -1 | 1) => {
        const c = v.scene.find(k => k.depth === depth && k.lateral === 0);
        return !!c && wallAt(st, c.x, c.y, (pose.facing + (s === 1 ? 1 : 3)) & 3);
      };
      const mons = monsterItems(v.scene, st.map, sprites, 'monsters', side);
      return [...mons, ...effectItems(fx.effects, 'bcspeed', n => { const f = frameOf('bcspeed')(n); return f; })];
    },
    onHotspot(_h: { code: number }, entity: EntityRecord | null, _handle: string | null) {
      // the package's door-lock / door-switch hotspots: a door frame in front is opened by the engine's own command
      if (entity && entity.type === 0x11) o.onCommand?.({ kind: 'openDoor' });
    },
    feed(events) {
      const st = o.state(), v = BcEngine.view(st);
      fx.feed(events, id => { const c = v.scene.find(k => k.monsters.some(m => m.id === id)); return c ? { depth: c.depth, lateral: c.lateral } : null; });
    },
    tick() { fx.tick(); },
    get effects() { return fx.effects; },
  };
  return live;
}

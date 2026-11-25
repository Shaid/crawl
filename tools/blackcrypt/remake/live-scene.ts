/**
 * Live scene for the Black Crypt walker view: turns `BcEngine.view().scene` into what the `@seer-project/dungeon` painter draws.
 *
 *  - `LiveEntityLevel` is a `CellQuery` decorator whose `entitiesAt` comes from the engine's live squares (doors with their open bit,
 *    floor items as they are now, picked-up items gone) instead of the static `levels.json` records. Walls stay the static plane.
 *    The package's own `buildViewList` then draws doors, plaques, stairs and floor items from the live records unchanged.
 *  - `monsterItems` / `effectItems` add the pieces the package does not draw: monsters (sprite tier by distance) and short effect
 *    flashes, as `DrawItem`s on the same painter's order (depth farthest first), cropped to the 208x140 viewport.
 *
 * Provenance: the viewport size and wall floor lines are the confirmed blit descriptors (data-structure.md "3D Viewport Compositing");
 * the monster tier per depth, foot line and lateral spacing are **hypotheses** (no byte-exact oracle, see remake-plan.md).
 * No retail data is embedded: sprite frames and groups come from the user's extracted assets at runtime.
 */
import type { CellQuery, DrawItem, Dir4, EntityRecord } from '@seer-project/dungeon';
import type { BcEntity, BcSceneCell } from './engine';

export const VIEW_W = 208, VIEW_H = 140;
const CX = VIEW_W / 2;
/** hyp: foot line (y of the sprite's bottom edge) of a creature standing mid-cell at depth 1..3; the wall floor lines are 128 / 96 / 80 */
const FOOT_Y = [0, 124, 100, 84];
/** hyp: horizontal spacing of a lateral +-1 cell at depth 1..3 */
const LATERAL_DX = [0, 120, 76, 52];

/** an engine record as the package's entity record (same field mapping the `levels.json` exporter uses) */
export function entityFromRaw(e: BcEntity): EntityRecord {
  const r = e.raw;
  return { type: e.monster ? 0x80 : r[5], gfx: r[1], wallMask: r[4], slotNibble: r[6], chainNext: 0, flags: (r[0xe] << 8) | r[0xf], raw: r.slice() };
}

export interface LiveSource {
  entities(x: number, y: number): { handle: string; entity: EntityRecord }[];
}

/** `CellQuery` over a static level whose entity lists are replaced by a live source (when set); with no source it is a pure pass-through */
export class LiveEntityLevel implements CellQuery {
  source: LiveSource | null = null;
  private readonly base: CellQuery;
  constructor(base: CellQuery) { this.base = base; }
  inBounds(x: number, y: number) { return this.base.inBounds(x, y); }
  wallAt(x: number, y: number, dir: Dir4) { return this.base.wallAt(x, y, dir); }
  planeAt(name: string, x: number, y: number) { return this.base.planeAt(name, x, y); }
  entityHandlesAt(x: number, y: number) {
    if (this.source) return this.source.entities(x, y);
    return this.base.entityHandlesAt ? this.base.entityHandlesAt(x, y) : this.base.entitiesAt(x, y).map((entity, i) => ({ handle: `static:${x}:${y}:${i}`, entity }));
  }
  entitiesAt(x: number, y: number) { return this.entityHandlesAt(x, y).map(e => e.entity); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface FrameInfo { name: string; x: number; y: number; w: number; h: number }
export interface MonsterGroup { index: number; name: string; gfxId: string; frames: string[] }

/**
 * The distance tiers of one creature, nearest first, from its frames in file order (non-increasing size, data-structure.md "Monster sprite clustering"):
 * a frame starts a new tier when it is narrower than the tier before or clearly shorter at the same width (<85%); a frame wider than the previous tier
 * is an attack pose (`A n` in the DOS names) and is not a tier. Hyp: tier 1/2/3 = depth 1/2/3, the first frame of a tier is its still pose.
 */
export function monsterTiers(frames: FrameInfo[]): FrameInfo[] {
  const tiers: FrameInfo[] = [];
  for (const f of frames) {
    const t = tiers[tiers.length - 1];
    if (!t) { tiers.push(f); continue; }
    if (f.w > t.w) continue;
    if (f.w < t.w || f.h < 0.85 * t.h) tiers.push(f);
  }
  return tiers;
}

export class MonsterSprites {
  private readonly byKey = new Map<string, FrameInfo[]>();
  /** `groups` = monster-names.json `groups`; `frame` resolves a frame name from the loaded bank (undefined when absent) */
  constructor(groups: MonsterGroup[], frame: (name: string) => FrameInfo | undefined) {
    for (const g of groups) {
      const map = /^m(\d+)_/.exec(g.frames[0] ?? '')?.[1];
      if (!map) continue;
      const fs = g.frames.map(frame).filter((f): f is FrameInfo => !!f);
      this.byKey.set(`${map}:${parseInt(g.gfxId, 16)}`, monsterTiers(fs));
    }
  }
  /** the sprite for a monster of record gfx word `gfx` on map `map` seen at `depth` (1 = adjacent square); the farthest tier repeats beyond its depth */
  frameFor(map: number, gfx: number, depth: number): FrameInfo | null {
    const tiers = this.byKey.get(`${map}:${gfx & 0xff}`);
    if (!tiers || tiers.length === 0 || depth < 1) return null;
    return tiers[Math.min(depth - 1, tiers.length - 1)];
  }
}

/** crop a sprite placed at (dx, dy) to the viewport; null when nothing is left. Source coordinates are absolute atlas pixels, as `DrawItem.srcX/srcY` expect */
export function cropToViewport(rect: { x: number; y: number; w: number; h: number }, dx: number, dy: number) {
  const left = Math.max(0, -dx), top = Math.max(0, -dy);
  const right = Math.min(rect.w, VIEW_W - dx), bottom = Math.min(rect.h, VIEW_H - dy);
  if (right <= left || bottom <= top) return null;
  return { srcX: rect.x + left, srcY: rect.y + top, srcW: right - left, srcH: bottom - top, destX: dx + left, destY: dy + top };
}

/**
 * Monsters of the scene as draw items. A monster in a lateral cell is hidden when the lateral-0 cell of the same depth has a wall on that side (it would be
 * behind the wall; the painter only orders by depth). Several monsters on one square are spread across it (hyp: the per-corner slot byte is not decoded here).
 */
export function monsterItems(scene: BcSceneCell[], map: number, sprites: MonsterSprites, bank: string, sideWall: (depth: number, side: -1 | 1) => boolean): DrawItem[] {
  const out: DrawItem[] = [];
  for (const cell of scene) {
    if (cell.depth < 1 || cell.depth > 3 || cell.monsters.length === 0) continue;
    if (cell.lateral !== 0 && sideWall(cell.depth, cell.lateral as -1 | 1)) continue;
    const n = cell.monsters.length;
    cell.monsters.forEach((m, k) => {
      const f = sprites.frameFor(map, m.gfx, cell.depth);
      if (!f) return;
      const spread = n === 1 ? 0 : (k - (n - 1) / 2) * Math.round(f.w * 0.55);
      const cx = CX + cell.lateral * LATERAL_DX[cell.depth] + spread;
      const dx = Math.round(cx - f.w / 2), dy = FOOT_Y[cell.depth] - f.h;
      const c = cropToViewport(f, dx, dy);
      if (!c) return;
      out.push({ kind: 'prop', depth: cell.depth, lateral: cell.lateral, propType: 'monster', cellX: cell.x, cellY: cell.y, bank, frame: f.name, blend: 'mask', ...c,
        origin: `live monster #${m.id} gfx ${(m.gfx & 0xff).toString(16)} tier at depth ${cell.depth} (hyp placement)` });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** a short effect flash anchored to a scene cell */
export interface Effect { frame: string; depth: number; lateral: number; ttl: number }
export interface BcEventLike { what: string; [k: string]: unknown }

/**
 * Effects from the engine's events, shown for a few ticks over the monster that was hit (swing hit, monster killed) or down the middle (cast). Which of the 16
 * BCSPEED sprite sets belongs to which spell is not decoded per spell here: hit = the set `hit`, cast = the set `cast` (both caller-chosen, hyp).
 */
export class EffectTracker {
  effects: Effect[] = [];
  private readonly frames: { hit: string[]; cast: string[] };
  private readonly ttl: number;
  constructor(frames: { hit: string[]; cast: string[] }, ttl = 4) { this.frames = frames; this.ttl = ttl; }
  /** `where(id)` = the scene position of monster `id` ({depth, lateral}) when it is in sight */
  feed(events: BcEventLike[], where: (monsterId: number) => { depth: number; lateral: number } | null) {
    for (const e of events) {
      if (e.what === 'swing' && e.hit) { const w = where(e.P as number); if (w) this.effects.push({ frame: this.frames.hit[0], ...w, ttl: this.ttl }); }
      else if (e.what === 'cast') this.effects.push({ frame: this.frames.cast[0], depth: 2, lateral: 0, ttl: this.ttl });
    }
  }
  /** advance one tick: drop expired effects; returns the live ones */
  tick(): Effect[] { this.effects = this.effects.filter(e => --e.ttl > 0); return this.effects; }
}

export function effectItems(effects: Effect[], bank: string, frame: (name: string) => { x: number; y: number; w: number; h: number } | undefined): DrawItem[] {
  const out: DrawItem[] = [];
  for (const e of effects) {
    const rect = frame(e.frame); if (!rect) continue;
    // the effect sprites are 16x16 at one size (no scaler in the data); anchor the centre at mid-height of a creature at that distance
    const d = Math.max(1, e.depth), cx = CX + e.lateral * LATERAL_DX[Math.min(d, 3)];
    const dx = Math.round(cx - rect.w / 2), dy = FOOT_Y[Math.min(d, 3)] - 40 - Math.round(rect.h / 2);
    const c = cropToViewport(rect, dx, dy); if (!c) continue;
    out.push({ kind: 'prop', depth: Math.max(0, d - 1), lateral: e.lateral, propType: 'effect', bank, frame: e.frame, blend: 'mask', ...c, origin: 'live effect' });
  }
  return out;
}

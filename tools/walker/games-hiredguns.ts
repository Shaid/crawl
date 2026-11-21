/**
 * Hired Guns (Amiga, DMA Design 1993) `GameView` — one of the game's four party views.
 *
 * Each map is a 23 x 23 x 20 voxel cube. A walker "level" is one z-layer of one map
 * (`levelId = map*100 + z`, z grows upwards); stairs and falls change z, which the
 * view reports as a level change (`takeLevelChange`). The view itself always looks at
 * three layers (z-1, z, z+1), exactly like the game.
 *
 * Map cells, stairs/door/fall rules: tools/hiredguns/amiga/{map,model}.ts.
 * First-person image: tools/hiredguns/amiga/view.ts, the game's own 67-position view
 * tables and per-position Style placements, copied out of the retail executable.
 *
 * Controls: W/Up forward, S/Down back, A/D sidestep, Q/E or Left/Right turn.
 * Walking into a door opens it (locked doors stay shut).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { decodeBankAsset, decodeMapAsset, mapLabel, type HgIndexEntry, type HgLoadedMap, type HgMapAsset } from '../hiredguns/amiga/assets.ts';
import type { GfxBank } from '../hiredguns/amiga/gfxbank.ts';
import { cellIndex, MAP_H } from '../hiredguns/amiga/map.ts';
import { standableNear, tryStep, type StepEvent } from '../hiredguns/amiga/model.ts';
import { frameToRGBA, renderView, VIEW_H, VIEW_W, type HgViewTables } from '../hiredguns/amiga/view.ts';

const STEP_COOLDOWN_MS = 170;

export const levelIdOf = (map: number, z: number): number => map * 100 + z;
export const splitLevelId = (id: number): { map: number; z: number } => ({ map: Math.floor(id / 100), z: id % 100 });

interface Shared {
  index: HgIndexEntry[];
  tables: HgViewTables;
  misc: GfxBank | null;
  styles: Map<number, Promise<GfxBank>>;
  maps: Map<number, Promise<HgLoadedMap>>;
}

const shared = new Map<string, Promise<Shared>>();

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

function loadShared(assetBase: string): Promise<Shared> {
  let p = shared.get(assetBase);
  if (!p) {
    const w = `${assetBase}/walker`;
    p = Promise.all([
      getJSON<{ maps: HgIndexEntry[] }>(`${w}/index.json`),
      getJSON<HgViewTables>(`${w}/tables.json`),
      getJSON<{ data: string }>(`${w}/misc.json`).then(decodeBankAsset).catch(() => null),
    ]).then(([idx, tables, misc]) => ({ index: idx.maps, tables, misc, styles: new Map(), maps: new Map() }));
    shared.set(assetBase, p);
  }
  return p;
}

function styleBank(s: Shared, assetBase: string, style: number): Promise<GfxBank> {
  let p = s.styles.get(style);
  if (!p) { p = getJSON<{ data: string }>(`${assetBase}/walker/style${style}.json`).then(decodeBankAsset); s.styles.set(style, p); }
  return p;
}

function mapAsset(s: Shared, assetBase: string, num: number): Promise<HgLoadedMap> {
  let p = s.maps.get(num);
  if (!p) { p = getJSON<HgMapAsset>(`${assetBase}/walker/maps/${String(num).padStart(2, '0')}.json`).then(decodeMapAsset); s.maps.set(num, p); }
  return p;
}

export async function hiredGunsLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const s = await loadShared(assetBase);
  return s.index.flatMap((m) => m.layers.map((z) => ({ id: levelIdOf(m.num, z), label: `${mapLabel(m)} - layer z${z}${z === m.start.z ? ' (start)' : ''}` })));
}

const EVENT_TEXT: Partial<Record<StepEvent, string>> = {
  'stairs-up': 'Up the stairs.',
  'stairs-down': 'Down the stairs.',
  falling: 'You fall.',
  'door-opened': 'The door opens.',
  'door-locked': 'The door is locked.',
  teleport: 'A teleporter (not followed by the walker).',
  boost: 'A boost pad (not followed by the walker).',
  exit: 'The map exit.',
};

export class HiredGunsView implements GameView {
  readonly id = 'hiredguns';
  readonly gameLabel = 'Hired Guns';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[] = [];

  private tick = 0;
  private cooldown = 0;
  private noclip = false;
  private pendingLevel: Pose | null = null;
  private message: string | null = null;
  private pos: { x: number; y: number; z: number };
  private facing: number;

  readonly map: HgLoadedMap;
  readonly style: GfxBank;
  readonly misc: GfxBank | null;
  readonly tables: HgViewTables;

  constructor(map: HgLoadedMap, style: GfxBank, misc: GfxBank | null, tables: HgViewTables, start: { x: number; y: number; z: number; facing: number }) {
    this.map = map;
    this.style = style;
    this.misc = misc;
    this.tables = tables;
    this.pos = { x: start.x, y: start.y, z: start.z };
    this.facing = start.facing & 3;
  }

  get levelId(): number { return levelIdOf(this.map.num, this.pos.z); }
  get levelLabel(): string { return `${mapLabel(this.map)} - layer z${this.pos.z} (style ${this.map.style})`; }
  get pose(): Pose { return { level: this.levelId, x: this.pos.x, y: this.pos.y, facing: this.facing as Pose['facing'] }; }
  get z(): number { return this.pos.z; }
  get currentTick(): number { return this.tick; }

  takeLevelChange(): Pose | null { const p = this.pendingLevel; this.pendingLevel = null; return p; }
  takeMessage(): string | null { const m = this.message; this.message = null; return m; }

  /** One step in absolute direction `dir` (0 N, 1 E, 2 S, 3 W); returns the step event. */
  step(dir: number): StepEvent {
    const r = tryStep({ cells: this.map.cells, doors: this.map.doors }, this.pos, dir, this.noclip);
    const text = EVENT_TEXT[r.event];
    if (text) this.message = text;
    if (r.event === 'door-opened') this.tick++;
    if (!r.moved) return r.event;
    const zChanged = r.pos.z !== this.pos.z;
    this.pos = r.pos;
    this.tick++;
    if (zChanged) this.pendingLevel = this.pose;
    return r.event;
  }

  turn(delta: number): void { this.facing = (this.facing + delta + 4) & 3; this.tick++; }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const down = (...c: string[]) => c.some((k) => keys.isDown(k));
    if (down('KeyQ', 'ArrowLeft')) { this.turn(-1); this.cooldown = STEP_COOLDOWN_MS; return this.pose; }
    if (down('KeyE', 'ArrowRight')) { this.turn(1); this.cooldown = STEP_COOLDOWN_MS; return this.pose; }
    let dir = -1;
    if (down('KeyW', 'ArrowUp')) dir = this.facing;
    else if (down('KeyS', 'ArrowDown')) dir = (this.facing + 2) & 3;
    else if (down('KeyD')) dir = (this.facing + 1) & 3;
    else if (down('KeyA')) dir = (this.facing + 3) & 3;
    if (dir < 0) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.step(dir);
    return this.pose;
  }

  setPose(pose: Pose): void {
    const { z } = splitLevelId(pose.level);
    this.pos = { x: pose.x, y: pose.y, z: Math.min(MAP_H - 1, Math.max(0, z)) };
    this.facing = pose.facing & 3;
    this.tick++;
  }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots: buttons/panels not wired */ }

  renderRGBA(): Uint8ClampedArray {
    const f = renderView({ cells: this.map.cells, sky4: this.map.sky4, style: this.style, misc: this.misc, tables: this.tables }, cellIndex(this.pos.x, this.pos.y, this.pos.z), this.facing);
    return frameToRGBA(f, this.tables.palette);
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    img.data.set(this.renderRGBA());
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadHiredGunsView(assetBase: string, levelId: number, startPose: Pose | null): Promise<HiredGunsView> {
  const s = await loadShared(assetBase);
  const want = splitLevelId(startPose?.level ?? levelId);
  const entry = s.index.find((m) => m.num === want.map) ?? s.index[0]!;
  const map = await mapAsset(s, assetBase, entry.num);
  const style = await styleBank(s, assetBase, map.style);
  let start: { x: number; y: number; z: number; facing: number };
  if (startPose && splitLevelId(startPose.level).map === entry.num) start = { x: startPose.x, y: startPose.y, z: want.z, facing: startPose.facing };
  else if (want.z === entry.start.z || !entry.layers.includes(want.z)) start = { ...entry.start };
  else {
    const p = standableNear({ cells: map.cells, doors: map.doors }, want.z);
    start = p ? { ...p, facing: 0 } : { ...entry.start };
  }
  return new HiredGunsView(map, style, s.misc, s.tables, start);
}

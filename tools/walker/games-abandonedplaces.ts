/**
 * Abandoned Places 1 (Amiga) `GameView`: renders through the port of the dungeon view in
 * `tools/abandonedplaces/amiga/view-model.ts` (144x96 indexed view) via `renderCanvas`.
 * Confidence: wall geometry, draw order, backdrop parity, palette (fade-table step 15), grid
 * semantics, collision and teleports come from the game's own `module` tables/code (spec section 7).
 * Hypotheses: start pose of levels other than dungeon 1 level 1; the window clip (original overdraws
 * the frame). NOT drawn: wall-mounted objects, doors/gates, stairs art, monsters, items; closed
 * doors do not block; the 8 forest levels are not supported (separate `forest` engine).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView, canEnter, teleportAt, decodeLevel, fromB64, areaIds, paletteRGB, DELTAS, VIEW_W, VIEW_H,
  type Ap1Level, type Ap1Tables, type Theme, type Facing,
} from '../abandonedplaces/amiga/view-model.ts';

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function ap1LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const levels = await fetchJSON<Array<{ id: number; label: string }>>(`${assetBase}/walker/levels.json`);
  return levels.map((l) => ({ id: l.id, label: l.label }));
}

export type Op = 'fwd' | 'back' | 'left' | 'right' | 'turnL' | 'turnR';
export interface Ap1Pose { x: number; y: number; facing: Facing }

/** Pure movement step, shared with the tests. Returns the new pose or null when blocked. */
export function stepPose(level: Ap1Level, pose: Ap1Pose, op: Op, noclip = false): Ap1Pose | null {
  const { x, y, facing } = pose;
  if (op === 'turnL') return { x, y, facing: ((facing + 3) & 3) as Facing };
  if (op === 'turnR') return { x, y, facing: ((facing + 1) & 3) as Facing };
  // tables 0xAD62/72/82/92: forward, strafe right, back, strafe left
  const dir = op === 'fwd' ? facing : op === 'right' ? (facing + 1) & 3 : op === 'back' ? (facing + 2) & 3 : (facing + 3) & 3;
  const nx = x + DELTAS[dir][0], ny = y + DELTAS[dir][1];
  if (noclip ? nx < 0 || ny < 0 || nx >= 32 || ny >= 32 : !canEnter(level, nx, ny)) return null;
  return { x: nx, y: ny, facing };
}

/** Area (theme block 0-3) requested by a teleport that crosses levels; consumed by the next load. */
let pendingArea: number | null = null;

export class Ap1View implements GameView {
  readonly id = 'abandonedplaces';
  readonly gameLabel = 'Abandoned Places';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private area: number;
  private levelChange: Pose | null = null;

  private readonly level: Ap1Level;
  private readonly tables: Ap1Tables;
  private readonly themes: Map<number, Theme>;
  private readonly palette_: RGBAColor[];

  constructor(level: Ap1Level, tables: Ap1Tables, themes: Map<number, Theme>, palette: RGBAColor[], start: Pose | null, area: number | null) {
    this.level = level;
    this.tables = tables;
    this.themes = themes;
    this.palette_ = palette;
    this.area = area ?? level.start.area;
    this.pose_ = start ?? { level: level.id, x: level.start.x, y: level.start.y, facing: level.start.facing as Pose['facing'] };
  }
  get levelId(): number { return this.level.id; }
  get levelLabel(): string { return `${this.level.label} (area ${this.area})`; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }
  get palette(): RGBAColor[] { return this.palette_; }
  takeLevelChange(): Pose | null { const c = this.levelChange; this.levelChange = null; return c; }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const d = (...c: string[]) => c.some((k) => keys.isDown(k));
    const op: Op | null = d('KeyQ', 'ArrowLeft') ? 'turnL' : d('KeyE', 'ArrowRight') ? 'turnR'
      : d('KeyW', 'ArrowUp') ? 'fwd' : d('KeyS', 'ArrowDown') ? 'back' : d('KeyA') ? 'left' : d('KeyD') ? 'right' : null;
    if (!op) return null;
    const next = stepPose(this.level, { x: this.pose_.x, y: this.pose_.y, facing: this.pose_.facing as Facing }, op, this.noclip);
    if (!next) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    let pose: Pose = { level: this.level.id, ...next };
    // teleport / stairs cell (list 7 types 5/6, loader 0x5C7A): move to the record's destination
    const tp = op === 'turnL' || op === 'turnR' ? undefined : teleportAt(this.level, next.x, next.y);
    if (tp && tp.level !== -1) {
      const facing = (tp.facing === 4 ? next.facing : tp.facing & 3) as Facing;
      pose = { level: this.level.id, x: tp.dx, y: tp.dy, facing };
      if (tp.level === 0 || tp.level - 1 === this.level.index) this.area = tp.area & 3;
      else {
        pendingArea = tp.area & 3;
        this.levelChange = { level: this.level.id - this.level.index + (tp.level - 1), x: tp.dx, y: tp.dy, facing };
      }
    }
    this.pose_ = pose;
    return this.pose_;
  }
  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots */ }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const th = this.themes.get(areaIds(this.level, this.area).module * 100 + areaIds(this.level, this.area).backgnd);
    if (!th) return;
    const px = renderView(this.level, this.tables, th, this.pose_.x, this.pose_.y, this.pose_.facing as Facing);
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    for (let i = 0; i < px.length; i++) {
      const c = this.palette_[px[i]] ?? { r: 255, g: 0, b: 255, a: 255 };
      img.data[i * 4] = c.r; img.data[i * 4 + 1] = c.g; img.data[i * 4 + 2] = c.b; img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadAp1View(assetBase: string, levelId: number, startPose: Pose | null): Promise<Ap1View> {
  const w = `${assetBase}/walker`;
  const [tables, levels] = await Promise.all([fetchJSON<Ap1Tables>(`${w}/tables.json`), fetchJSON<Parameters<typeof decodeLevel>[0][]>(`${w}/levels.json`)]);
  const level = decodeLevel(levels[levelId]!);
  const themes = new Map<number, Theme>();
  const mods = new Map<number, Promise<Uint8Array[]>>(), bgs = new Map<number, Promise<Uint8Array[]>>();
  for (let a = 0; a < 4; a++) {
    const { module, backgnd } = areaIds(level, a);
    if (module < 1 || backgnd < 1) continue;
    if (!mods.has(module)) mods.set(module, fetchJSON<{ pieces: string[] }>(`${w}/module/${module}.json`).then((j) => j.pieces.map(fromB64)));
    if (!bgs.has(backgnd)) bgs.set(backgnd, fetchJSON<{ halves: string[] }>(`${w}/backgnd/${backgnd}.json`).then((j) => j.halves.map(fromB64)));
    themes.set(module * 100 + backgnd, { pieces: await mods.get(module)!, halves: await bgs.get(backgnd)! });
  }
  const area = pendingArea;
  pendingArea = null;
  const pal = paletteRGB(tables.palette).map(([r, g, b]) => ({ r, g, b, a: 255 }));
  return new Ap1View(level, tables, themes, pal, startPose, area);
}

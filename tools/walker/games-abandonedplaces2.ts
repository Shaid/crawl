/**
 * Abandoned Places 2 (Amiga) `GameView`: renders through the ported slot-table renderer in
 * `tools/abandonedplaces2/amiga/view-model.ts` (192x135 indexed view) via `renderCanvas`.
 * Confidence: map, collision rules, wall/decoration/pit/stairs/gate placement are read from the
 * game's own tables (spec section 6). NOT drawn: monsters, items, objects, chests, water, fire,
 * switches. Palette: 64-entry screen palette (set_NN 0-15, display.clr 16-31, EHB 32-63); the exporter
 * stores pixels as screen values after the game's view-buffer plane remap (screen-palette.ts, spec §5.1).
 * Stairs are not followed between levels yet.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView, canEnter, entrancePose, decodeRes, decodeLevel, resNamesFor, DELTAS, VIEW_W, VIEW_H,
  type ApLevel, type ApTables, type Theme, type Facing,
} from '../abandonedplaces2/amiga/view-model.ts';

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function ap2LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const levels = await fetchJSON<Array<{ id: number; theme: number }>>(`${assetBase}/walker/levels.json`);
  return levels.map((l) => ({ id: l.id, label: `Level ${l.id} (theme ${l.theme})` }));
}

/** Pure movement step, shared with the tests. Returns the new pose or null when blocked/no-op. */
export function stepPose(level: ApLevel, pose: { x: number; y: number; facing: Facing }, op: 'fwd' | 'back' | 'left' | 'right' | 'turnL' | 'turnR', noclip = false) {
  let { x, y, facing } = pose;
  if (op === 'turnL') return { x, y, facing: ((facing + 3) & 3) as Facing };
  if (op === 'turnR') return { x, y, facing: ((facing + 1) & 3) as Facing };
  const dir = op === 'fwd' ? facing : op === 'back' ? (facing + 2) & 3 : op === 'left' ? (facing + 3) & 3 : (facing + 1) & 3;
  const [dx, dy] = DELTAS[dir];
  x += dx; y += dy;
  if (noclip ? x < 0 || y < 0 || x >= level.w || y >= level.h : !canEnter(level, x, y)) return null;
  return { x, y, facing };
}

export class Ap2View implements GameView {
  readonly id = 'abandonedplaces2';
  readonly gameLabel = 'Abandoned Places 2';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;

  private readonly level: ApLevel;
  private readonly tables: ApTables;
  private readonly theme: Theme;
  private readonly palette_: RGBAColor[];

  constructor(level: ApLevel, tables: ApTables, theme: Theme, palette: RGBAColor[], start: Pose | null) {
    this.level = level;
    this.tables = tables;
    this.theme = theme;
    this.palette_ = palette;
    const e = entrancePose(level);
    this.pose_ = start ?? { level: level.id, x: e.x, y: e.y, facing: e.facing };
  }
  get levelId(): number { return this.level.id; }
  get levelLabel(): string { return `Level ${this.level.id} (theme ${this.level.theme})`; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }
  get palette(): RGBAColor[] { return this.palette_; }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const d = (...c: string[]) => c.some((k) => keys.isDown(k));
    const op = d('KeyQ', 'ArrowLeft') ? 'turnL' : d('KeyE', 'ArrowRight') ? 'turnR'
      : d('KeyW', 'ArrowUp') ? 'fwd' : d('KeyS', 'ArrowDown') ? 'back' : d('KeyA') ? 'left' : d('KeyD') ? 'right' : null;
    if (!op) return null;
    const next = stepPose(this.level, { x: this.pose_.x, y: this.pose_.y, facing: this.pose_.facing as Facing }, op, this.noclip);
    if (!next) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.level.id, ...next };
    return this.pose_;
  }
  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots */ }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const px = renderView(this.level, this.tables, this.theme, this.pose_.x, this.pose_.y, this.pose_.facing as Facing);
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

export async function loadAp2View(assetBase: string, levelId: number, startPose: Pose | null): Promise<Ap2View> {
  const w = `${assetBase}/walker`;
  const [tables, levels] = await Promise.all([fetchJSON<ApTables>(`${w}/tables.json`), fetchJSON<Parameters<typeof decodeLevel>[0][]>(`${w}/levels.json`)]);
  const level = decodeLevel(levels[levelId]!);
  const theme: Theme = { res: {} };
  await Promise.all(resNamesFor(level).map(async (n) => { theme.res[n] = decodeRes(await fetchJSON(`${w}/res/${n}.json`)); }));
  const pal = await fetchJSON<[number, number, number][]>(`${w}/pal/set_${String(level.set).padStart(2, '0')}.json`);
  return new Ap2View(level, tables, theme, pal.map(([r, g, b]) => ({ r, g, b, a: 255 })), startPose);
}

/**
 * The Bard's Tale II: The Destiny Knight (Amiga) `GameView`.
 *
 * Same shape as `games-bardstale1.ts`: the view-row builder, move rule and wrap are the BT1 ones
 * (verified identical in `data/bard`, see tools/bardstale2/amiga/dungeon.ts); the compositor is the
 * BT2 table-driven one (half-view mirror) from `tools/bardstale2/amiga/dungeon.ts`.
 *
 * Pose mapping: `pose.y` = the game's row index `a` (+y = north), `pose.x` =
 * column `b` (+x = east); facing 0..3 = N, E, S, W (matches the game's own
 * facing word at flat 0x22ce4). Movement follows the game's move routine
 * (flat 0x5e0de): forward only, blocked iff the party cell's front face is
 * a plain wall (value 1; doors and secret doors pass), coordinates wrap at 22.
 * The game has no back-step: Back / S performs its U-turn key.
 *
 * The six cities are walker levels CITY_BASE + city (101..106), `BardsTale2CityView` over
 * `tools/bardstale2/amiga/city.ts` (the city overlay's view table, compositor and move routine): pose.x = column,
 * pose.y = row of the 16x16 grid, row 0 = NORTH edge (facing 0 = north steps row-1). Buildings turn the party round
 * with a message; each city's dungeon building loads that dungeon's first level; leaving the grid would enter the
 * wilderness, which the walker does not have (blocked with a message).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView,
  indexedToRGBA,
  canMoveForward,
  stepForward,
  VIEW_W,
  VIEW_H,
  type DungeonArt,
  type LevelData,
  type Plane4,
} from '../bardstale2/amiga/dungeon.ts';
import { bt1StartPose } from './games-bardstale1.ts';
import {
  renderCityView,
  bigCityLayout,
  cityMove,
  locationText,
  CITY_NAMES,
  VIEW_W as CITY_VIEW_W,
  VIEW_H as CITY_VIEW_H,
  type Bt2City,
  type CityArt,
  type CityLayout,
} from '../bardstale2/amiga/city.ts';
import { indexedToRGBA as cityRGBA } from '../bardstale1/amiga/city.ts';

/** Walker level id of city c (1..6) is CITY_BASE + c; dungeon levels keep their levs record index 0..24. */
export const CITY_BASE = 100;

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

interface WirePiece { w: number; h: number; px: number[] }
const piece = (p: WirePiece): Plane4 => ({ w: p.w, h: p.h, px: Uint8Array.from(p.px) });

export function artFromJSON(v: { palette: number[]; background: number[]; a: WirePiece[]; b: WirePiece[]; c: WirePiece[] }): DungeonArt {
  return { palette: v.palette, background: Uint8Array.from(v.background), a: v.a.map(piece), b: v.b.map(piece), c: v.c.map(piece) };
}

export async function bardsTale2LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { levels } = await fetchJSON<{ levels: Array<{ id: number; name: string }> }>(`${assetBase}/data/dungeon/levels.json`);
  return [
    ...CITY_NAMES.slice(1).map((n, i) => ({ id: CITY_BASE + i + 1, label: `${n} (city)` })),
    ...levels.map((l) => ({ id: l.id, label: `Level ${l.id}: ${l.name}` })),
  ];
}

export class BardsTale2View implements GameView {
  readonly id = 'bardstale2';
  readonly gameLabel = "The Bard's Tale II";
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[];

  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;

  private readonly art: DungeonArt;
  private readonly level: LevelData;

  constructor(art: DungeonArt, level: LevelData, levelId: number, startPose: Pose | null) {
    this.art = art;
    this.level = level;
    this.palette = art.palette.map((w) => ({ r: ((w >> 8) & 0xf) * 17, g: ((w >> 4) & 0xf) * 17, b: (w & 0xf) * 17, a: 255 }));
    this.pose_ = startPose ?? bt1StartPose(level, levelId);
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return `Level ${this.pose_.level}: ${this.level.name}`;
  }
  get pose(): Pose {
    return this.pose_;
  }
  get currentTick(): number {
    return this.tick;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    let { x, y, facing } = this.pose_;
    let changed = false;
    const left = keys.isDown('KeyQ') || keys.isDown('ArrowLeft');
    const right = keys.isDown('KeyE') || keys.isDown('ArrowRight');
    if (left !== right) {
      facing = ((facing + (right ? 1 : 3)) & 3) as Pose['facing'];
      changed = true;
    } else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) {
      facing = ((facing + 2) & 3) as Pose['facing'];
      changed = true;
    } else if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) {
      if (this.noclip || canMoveForward(this.level, y, x, facing)) {
        const [na, nb] = stepForward(y, x, facing);
        y = na;
        x = nb;
        changed = true;
      }
    }
    if (!changed) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.pose_.level, x, y, facing };
    return this.pose_;
  }

  setPose(pose: Pose): void {
    this.pose_ = pose;
  }
  setNoclip(on: boolean): void {
    this.noclip = on;
  }
  interactCodes(): string[] {
    return [];
  }
  automapCodes(): string[] {
    return [];
  }
  pick(): void {}

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const frame = renderView(this.art, this.level, this.pose_.y, this.pose_.x, this.pose_.facing);
    const rgba = indexedToRGBA(frame, this.art.palette);
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    img.data.set(rgba);
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadBardsTale2View(
  assetBase: string,
  levelId: number,
  startPose: Pose | null,
): Promise<BardsTale2View | BardsTale2CityView> {
  if (levelId > CITY_BASE) return loadBardsTale2CityView(assetBase, levelId, startPose);
  const [v, lvl] = await Promise.all([
    fetchJSON<Parameters<typeof artFromJSON>[0]>(`${assetBase}/data/dungeon/view.json`),
    fetchJSON<{ walls: number[]; flags: number[]; name: string }>(`${assetBase}/data/dungeon/level${levelId}.json`),
  ]);
  return new BardsTale2View(
    artFromJSON(v),
    { walls: Uint8Array.from(lvl.walls), flags: Uint8Array.from(lvl.flags), name: lvl.name },
    levelId,
    startPose,
  );
}

// ───────────────────────────── cities ─────────────────────────────

export interface CityIndexJSON {
  index: number;
  name: string;
  start: { row: number; col: number; facing: number };
  entrances: Array<{ row: number; col: number; name: string; level: number; to: { a: number; b: number; facing: number } }>;
}
export interface CityViewJSON {
  palette: number[];
  bigCity: number[];
  pictures: Record<string, { px: number[]; palette: number[] }>;
}

export function cityArtFromJSON(v: CityViewJSON): CityArt {
  const pictures: CityArt['pictures'] = {};
  for (const [k, p] of Object.entries(v.pictures)) pictures[Number(k)] = { px: Uint8Array.from(p.px), palette: p.palette };
  return { palette: v.palette, data: Uint8Array.from(v.bigCity), pictures };
}

export class BardsTale2CityView implements GameView {
  readonly id = 'bardstale2';
  readonly gameLabel = "The Bard's Tale II";
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[];

  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private pendingLevel: Pose | null = null;
  private message: string | null = null;
  private readonly layout: CityLayout = bigCityLayout();

  private readonly art: CityArt;
  private readonly city: Bt2City;
  private readonly info: CityIndexJSON;

  constructor(art: CityArt, city: Bt2City, info: CityIndexJSON, start: Pose | null) {
    this.art = art;
    this.city = city;
    this.info = info;
    this.palette = art.palette.map((w) => ({ r: ((w >> 8) & 0xf) * 17, g: ((w >> 4) & 0xf) * 17, b: (w & 0xf) * 17, a: 255 }));
    const lv = CITY_BASE + city.index;
    this.pose_ = start ? { ...start, level: lv } : { level: lv, x: info.start.col, y: info.start.row, facing: info.start.facing as Pose['facing'] };
  }

  get levelId(): number {
    return CITY_BASE + this.city.index;
  }
  get levelLabel(): string {
    return this.city.name;
  }
  get pose(): Pose {
    return this.pose_;
  }
  get currentTick(): number {
    return this.tick;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const { x, y } = this.pose_;
    let { facing } = this.pose_;
    const lv = this.levelId;
    const left = keys.isDown('KeyQ') || keys.isDown('ArrowLeft');
    const right = keys.isDown('KeyE') || keys.isDown('ArrowRight');
    if (left !== right) facing = ((facing + (right ? 1 : 3)) & 3) as Pose['facing'];
    else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) facing = ((facing + 2) & 3) as Pose['facing'];
    else if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) {
      this.cooldown = STEP_COOLDOWN_MS;
      const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][facing]!;
      if (this.noclip) {
        const r = Math.min(15, Math.max(0, y + dr!));
        const c = Math.min(15, Math.max(0, x + dc!));
        this.pose_ = { level: lv, x: c, y: r, facing };
        return this.pose_;
      }
      const act = cityMove(this.city, y, x, facing);
      switch (act.kind) {
        case 'move':
          this.pose_ = { level: lv, x: act.col, y: act.row, facing };
          this.message = locationText(this.city, act.row, act.col, facing);
          return this.pose_;
        case 'turn':
          this.pose_ = { level: lv, x, y, facing: ((facing + 2) & 3) as Pose['facing'] };
          this.message = `${act.message} -- the party turns round`;
          return this.pose_;
        case 'exit':
          this.message = act.message;
          return null;
        case 'dungeon': {
          const en = this.info.entrances.find((e) => e.row === y + dr! && e.col === x + dc!);
          this.message = `${act.message} -> dungeon level ${act.record}`;
          this.pendingLevel = { level: act.record, x: en?.to.b ?? 0, y: en?.to.a ?? 0, facing: (en?.to.facing ?? 0) as Pose['facing'] };
          return null;
        }
      }
    } else return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: lv, x, y, facing };
    this.message = locationText(this.city, y, x, facing);
    return this.pose_;
  }

  takeLevelChange(): Pose | null {
    const p = this.pendingLevel;
    this.pendingLevel = null;
    return p;
  }
  takeMessage(): string | null {
    const m = this.message;
    this.message = null;
    return m;
  }
  setPose(pose: Pose): void {
    this.pose_ = { ...pose, level: this.levelId };
  }
  setNoclip(on: boolean): void {
    this.noclip = on;
  }
  interactCodes(): string[] {
    return [];
  }
  automapCodes(): string[] {
    return [];
  }
  pick(): void {}

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const fr = renderCityView(this.art, this.layout, this.city, this.pose_.y, this.pose_.x, this.pose_.facing);
    const img = ctx.createImageData(CITY_VIEW_W, CITY_VIEW_H);
    img.data.set(cityRGBA(fr.px, fr.palette));
    ctx.canvas.width = CITY_VIEW_W;
    ctx.canvas.height = CITY_VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadBardsTale2CityView(assetBase: string, levelId: number, startPose: Pose | null): Promise<BardsTale2CityView> {
  const ci = levelId - CITY_BASE;
  const [idx, cj, vj] = await Promise.all([
    fetchJSON<{ cities: CityIndexJSON[] }>(`${assetBase}/data/city/cities.json`),
    fetchJSON<{ index: number; name: string; grid: number[] }>(`${assetBase}/data/city/city${ci}.json`),
    fetchJSON<CityViewJSON>(`${assetBase}/data/city/view.json`),
  ]);
  const info = idx.cities.find((c) => c.index === ci);
  if (!info) throw new Error(`no city ${ci}`);
  return new BardsTale2CityView(cityArtFromJSON(vj), { index: ci, name: cj.name, grid: Uint8Array.from(cj.grid) }, info, startPose);
}

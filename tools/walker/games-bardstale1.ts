/**
 * The Bard's Tale I (Amiga) `GameView`.
 *
 * Renders the 112x88 dungeon view with `tools/bardstale1/amiga/dungeon.ts`
 * (a port of the game's own view-row builder and wall/door/mark compositor)
 * through `GameView.renderCanvas`, like the EOB / MM views.
 *
 * Pose mapping: `pose.y` = the game's row index `a` (+y = north), `pose.x` =
 * column `b` (+x = east); facing 0..3 = N, E, S, W (matches the game's own
 * facing word at 0x2102a). Movement follows the game's move routine
 * (overlay+0x802c4): forward only, blocked iff the party cell's front face is
 * a plain wall (value 1; doors and secret doors pass), coordinates wrap at 22.
 * The game has no back-step: Back / S performs its U-turn key.
 *
 * Skara Brae (walker level CITY_LEVEL = 100) is a second view, `BardsTale1CityView`, over
 * `tools/bardstale1/amiga/city.ts` (a port of the city overlay's view table, compositor and move routine):
 * pose.x = column, pose.y = row of the 30x30 city grid with row 0 the NORTH edge (the city's facing 0 = north
 * steps row-1; the game's own "facing north." text). Walking into a building runs its handler as the game does:
 * shops, temples, taverns, empty houses turn the party round with a message; guardian statues and iron gates pass
 * only in their free direction; dungeon entrances (and the Scarlet Bard's wine) load the dungeon level.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView,
  indexedToRGBA,
  canMoveForward,
  stepForward,
  GRID,
  VIEW_W,
  VIEW_H,
  type DungeonArt,
  type LevelData,
  type Piece,
} from '../bardstale1/amiga/dungeon.ts';
import {
  renderCityView,
  cityMove,
  locationText,
  indexedToRGBA as cityRGBA,
  START as CITY_START,
  VIEW_W as CITY_VIEW_W,
  VIEW_H as CITY_VIEW_H,
  type Bt1City,
  type CityArt,
} from '../bardstale1/amiga/city.ts';

/** Walker level id of Skara Brae (dungeon levels keep their levs record index 0..15). */
export const CITY_LEVEL = 100;

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

interface WirePiece { w: number; h: number; px: number[] }
const piece = (p: WirePiece): Piece => ({ w: p.w, h: p.h, px: Uint8Array.from(p.px) });

export function artFromJSON(v: {
  palette: number[];
  background: number[];
  front: { wall: WirePiece[]; door: WirePiece[] };
  sideC: WirePiece[][];
  sideO: WirePiece[][];
  marks: { floor: WirePiece[][]; ceiling: WirePiece[][] };
}): DungeonArt {
  return {
    palette: v.palette,
    background: Uint8Array.from(v.background),
    front: { wall: v.front.wall.map(piece), door: v.front.door.map(piece) },
    sideC: v.sideC.map((r) => r.map(piece)),
    sideO: v.sideO.map((r) => r.map(piece)),
    marks: { floor: v.marks.floor.map((r) => r.map(piece)), ceiling: v.marks.ceiling.map((r) => r.map(piece)) },
  };
}

export async function bardsTale1LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { levels } = await fetchJSON<{ levels: Array<{ id: number; name: string }> }>(`${assetBase}/data/dungeon/levels.json`);
  return [{ id: CITY_LEVEL, label: 'Skara Brae (city)' }, ...levels.map((l) => ({ id: l.id, label: `Level ${l.id}: ${l.name}` }))];
}

/** The game's default arrival is (0,0) facing north; fall back to the first cell with an open front face. */
export function bt1StartPose(lv: LevelData, level: number): Pose {
  if (canMoveForward(lv, 0, 0, 0)) return { level, x: 0, y: 0, facing: 0 };
  for (let a = 0; a < GRID; a++)
    for (let b = 0; b < GRID; b++)
      for (let f = 0; f < 4; f++) if (canMoveForward(lv, a, b, f)) return { level, x: b, y: a, facing: f as Pose['facing'] };
  return { level, x: 0, y: 0, facing: 0 };
}

export class BardsTale1View implements GameView {
  readonly id = 'bardstale1';
  readonly gameLabel = "The Bard's Tale";
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

export async function loadBardsTale1View(
  assetBase: string,
  levelId: number,
  startPose: Pose | null,
): Promise<BardsTale1View | BardsTale1CityView> {
  if (levelId === CITY_LEVEL) return loadBardsTale1CityView(assetBase, startPose);
  const [v, lvl] = await Promise.all([
    fetchJSON<Parameters<typeof artFromJSON>[0]>(`${assetBase}/data/dungeon/view.json`),
    fetchJSON<{ walls: number[]; flags: number[]; name: string }>(`${assetBase}/data/dungeon/level${levelId}.json`),
  ]);
  return new BardsTale1View(
    artFromJSON(v),
    { walls: Uint8Array.from(lvl.walls), flags: Uint8Array.from(lvl.flags), name: lvl.name },
    levelId,
    startPose,
  );
}

// ───────────────────────────── Skara Brae ─────────────────────────────

export interface CityEntranceJSON {
  row: number;
  col: number;
  name: string;
  level: number;
  to: { a: number; b: number; facing: number };
}

export interface CityJSON {
  path: number[];
  nameGrid: number[];
  streetNames: string[];
  start: { row: number; col: number; facing: number };
  entrances: CityEntranceJSON[];
}

export interface CityViewJSON {
  palette: number[];
  bigCity: number[];
  pictures: Record<string, { px: number[]; palette: number[] }>;
}

export function cityFromJSON(j: CityJSON): Bt1City {
  return { path: Uint8Array.from(j.path), name: Uint8Array.from(j.nameGrid), streetNames: j.streetNames };
}

export function cityArtFromJSON(v: CityViewJSON): CityArt {
  const pictures: CityArt['pictures'] = {};
  for (const [k, p] of Object.entries(v.pictures)) pictures[Number(k)] = { px: Uint8Array.from(p.px), palette: p.palette };
  return { palette: v.palette, data: Uint8Array.from(v.bigCity), pictures };
}

const rgbOf = (w: number): RGBAColor => ({ r: ((w >> 8) & 0xf) * 17, g: ((w >> 4) & 0xf) * 17, b: (w & 0xf) * 17, a: 255 });

export class BardsTale1CityView implements GameView {
  readonly id = 'bardstale1';
  readonly gameLabel = "The Bard's Tale";
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

  private readonly art: CityArt;
  private readonly city: Bt1City;
  private readonly entrances: CityEntranceJSON[];

  constructor(art: CityArt, city: Bt1City, entrances: CityEntranceJSON[], start: Pose | null) {
    this.art = art;
    this.city = city;
    this.entrances = entrances;
    this.palette = art.palette.map(rgbOf);
    this.pose_ = start ?? { level: CITY_LEVEL, x: CITY_START.col, y: CITY_START.row, facing: CITY_START.facing as Pose['facing'] };
  }

  get levelId(): number {
    return CITY_LEVEL;
  }
  get levelLabel(): string {
    return 'Skara Brae';
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
    const left = keys.isDown('KeyQ') || keys.isDown('ArrowLeft');
    const right = keys.isDown('KeyE') || keys.isDown('ArrowRight');
    if (left !== right) facing = ((facing + (right ? 1 : 3)) & 3) as Pose['facing'];
    else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) facing = ((facing + 2) & 3) as Pose['facing'];
    else if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) {
      const r = this.step(y, x, facing);
      this.cooldown = STEP_COOLDOWN_MS;
      if (!r) return null;
      this.pose_ = r;
      return r;
    } else return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: CITY_LEVEL, x, y, facing };
    this.message = locationText(this.city, y, x, facing);
    return this.pose_;
  }

  /** One forward key: the game's move routine (0x8021c) and building handlers (0x80650). */
  private step(row: number, col: number, facing: Pose['facing']): Pose | null {
    if (this.noclip) {
      const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][facing]!;
      const r = Math.min(29, Math.max(0, row + dr!));
      const c = Math.min(29, Math.max(0, col + dc!));
      return { level: CITY_LEVEL, x: c, y: r, facing };
    }
    const act = cityMove(this.city, row, col, facing);
    switch (act.kind) {
      case 'move':
        this.message = act.message ?? locationText(this.city, act.row, act.col, facing);
        return { level: CITY_LEVEL, x: act.col, y: act.row, facing };
      case 'turn':
      case 'leave': {
        const f = ((facing + 2) & 3) as Pose['facing'];
        this.message = `${act.message} -- the party turns round`;
        return { level: CITY_LEVEL, x: col, y: row, facing: f };
      }
      case 'blocked':
        this.message = act.message;
        return null;
      case 'dungeon': {
        const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][facing]!;
        const en = this.entrances.find((e) => e.row === row + dr! && e.col === col + dc!);
        if (!en) return null;
        this.message = `${act.message} -> dungeon level ${en.level}`;
        this.pendingLevel = { level: en.level, x: en.to.b, y: en.to.a, facing: en.to.facing as Pose['facing'] };
        return null;
      }
    }
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
    this.pose_ = { ...pose, level: CITY_LEVEL };
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
    const fr = renderCityView(this.art, this.city, this.pose_.y, this.pose_.x, this.pose_.facing);
    const img = ctx.createImageData(CITY_VIEW_W, CITY_VIEW_H);
    img.data.set(cityRGBA(fr.px, fr.palette));
    ctx.canvas.width = CITY_VIEW_W;
    ctx.canvas.height = CITY_VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadBardsTale1CityView(assetBase: string, startPose: Pose | null): Promise<BardsTale1CityView> {
  const [cj, vj] = await Promise.all([
    fetchJSON<CityJSON>(`${assetBase}/data/city/city.json`),
    fetchJSON<CityViewJSON>(`${assetBase}/data/city/view.json`),
  ]);
  return new BardsTale1CityView(cityArtFromJSON(vj), cityFromJSON(cj), cj.entrances, startPose);
}

/**
 * The Bard's Tale III: Thief of Fate (Amiga) `GameView`.
 *
 * All rules come from the game program `bard3` (see tools/bardstale3/amiga/dungeon.ts for the addresses):
 * - pose.x = column, pose.y = row (+y = north), facing 0..3 = N, E, S, W; coordinates wrap at the level's W x H;
 * - W / Up = the forward key (0x4800): passes only an open face (move class 0);
 * - K = the game's 0x4b command (kick, 0x2018): also passes door classes 1/2; walls and invisible walls block;
 * - Q/E or Left/Right turn, S / Down = the game's U-turn key (no back-step exists);
 * - Enter on a stairs square (special opcode 0 / 1) takes the stairs: level index -1 / +1 inside the dungeon,
 *   target dungeon from the record's link bytes 0x12.., position shifted by the two levels' 0x20/0x21 offsets
 *   (0xcdf0 + 0x1d6a); a teleport special (opcode 3) into another dungeon moves there on arrival.
 * The view is the game's own 61-slot compositor over GDUNG.GRP with palette DATA 0x20868, at light level 5.
 *
 * Cities / wilderness (maps 0-9) are walker levels CITY_BASE + map (tools/bardstale3/amiga/city.ts):
 * - one byte per square; W / Up = the 0x4800 key (move only), K = the 0x4b / 0x4c00 command, which first "enters"
 *   a building ahead (high nibble 1..9, reported as a message plus the game's U-turn, 0xcd58) and then moves;
 * - wrap or edge-stop from record byte 0x12 bit 1; N toggles the night palette (DATA 0x208c8);
 * - arriving on a first-opcode teleport (opcode 3) moves to its target city / dungeon; a dungeon's level-0 up-stairs
 *   lead to its exit square in the city (record 0x1a..0x1c).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView,
  indexedToRGBA,
  canPass,
  stepForward,
  startPose,
  VIEW_W,
  VIEW_H,
  type DungeonArt,
  type Bt3Level,
  type ViewTables,
  type GrpPiece,
} from '../bardstale3/amiga/dungeon.ts';
import {
  renderCityView,
  cityPassable,
  cityBuilding,
  cityStep,
  cellAhead,
  type Bt3City,
  type CityTables,
} from '../bardstale3/amiga/city.ts';

/** Walker level id of city / wilderness map m (dungeon levels keep their dungeon index 0..60). */
export const CITY_BASE = 100;

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface LevelIndexEntry {
  id: number;
  name: string;
  levelIndex: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface CityIndexEntry {
  map: number;
  name: string;
  w: number;
  h: number;
  wraps: boolean;
  start: { x: number; y: number; facing: number; from: string };
  entrances: Array<{ x: number; y: number; dungeon: number; name: string; to: { x: number; y: number; facing: number } }>;
}

export async function bardsTale3LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const [{ levels }, { cities }] = await Promise.all([
    fetchJSON<{ levels: LevelIndexEntry[] }>(`${assetBase}/data/dungeon/levels.json`),
    fetchJSON<{ cities: CityIndexEntry[] }>(`${assetBase}/data/city/cities.json`),
  ]);
  return [
    ...cities.map((c) => ({ id: CITY_BASE + c.map, label: `city ${c.map}: ${c.name}` })),
    ...levels.map((l) => ({ id: l.id, label: `${l.id}: ${l.name} (level ${l.levelIndex + 1})` })),
  ];
}

export function artFromJSON(v: { tables: ViewTables; entries: Array<{ bpr: number; h: number; data: number[] } | null> }): DungeonArt {
  return { tables: v.tables, entries: v.entries.map((e) => (e ? { bpr: e.bpr, h: e.h, data: Uint8Array.from(e.data) } : null)) };
}

export function levelFromJSON(v: Omit<Bt3Level, 'cells'> & { cells: number[] }): Bt3Level {
  return { ...v, cells: Uint8Array.from(v.cells) };
}

/** Where a stairs special at the party square leads (null = none here / leaves the dungeon). */
export function stairsTarget(
  lv: Bt3Level,
  x: number,
  y: number,
  index: Map<number, LevelIndexEntry>,
): { level: number; x: number; y: number } | 'exit' | null {
  const sp = lv.specials.find((s) => (s.op === 0 || s.op === 1) && (s.y === 0x7f || s.y === y) && (s.x === 0xff || s.x === x));
  if (!sp) return null;
  const ni = lv.levelIndex + (sp.op === 1 ? 1 : -1);
  if (ni < 0) return 'exit';
  const id = lv.links[ni];
  if (id === undefined || id === 0xff) return null;
  const dst = index.get(id);
  if (!dst) return null;
  return { level: id, x: ((x + lv.ox - dst.ox) % dst.w + dst.w) % dst.w, y: ((y + lv.oy - dst.oy) % dst.h + dst.h) % dst.h };
}

export class BardsTale3View implements GameView {
  readonly id = 'bardstale3';
  readonly gameLabel = "The Bard's Tale III";
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

  private readonly art: DungeonArt;
  private readonly level: Bt3Level;
  private readonly index: Map<number, LevelIndexEntry>;

  constructor(art: DungeonArt, level: Bt3Level, index: Map<number, LevelIndexEntry>, levelId: number, start: Pose | null) {
    this.art = art;
    this.level = level;
    this.index = index;
    this.palette = art.tables.palette.map((w) => ({ r: ((w >> 8) & 15) * 17, g: ((w >> 4) & 15) * 17, b: (w & 15) * 17, a: 255 }));
    const sp = startPose(level);
    this.pose_ = start ?? { level: levelId, x: sp.x, y: sp.y, facing: sp.facing as Pose['facing'] };
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return `${this.pose_.level}: ${this.level.name} (level ${this.level.levelIndex + 1})`;
  }
  get pose(): Pose {
    return this.pose_;
  }
  get currentTick(): number {
    return this.tick;
  }

  private arrive(x: number, y: number): void {
    const here = this.level.specials.filter((s) => (s.y === 0x7f || s.y === y) && (s.x === 0xff || s.x === x));
    const tp = here.find((s) => s.teleport && s.x !== 0xff && s.y !== 0x7f);
    if (tp?.teleport) {
      // 0xcff2 in a dungeon: target bit 7 = city map, else dungeon index
      const t = tp.teleport.target;
      const level = t >= 0x80 ? CITY_BASE + (t & 0x7f) : t;
      if (level !== this.pose_.level) {
        this.pendingLevel = { level, x: tp.teleport.x, y: tp.teleport.y, facing: this.pose_.facing };
        this.message = t >= 0x80 ? `teleport -> city ${t & 0x7f}` : `teleport -> dungeon ${t}`;
        return;
      }
    }
    if (here.some((s) => s.op === 0 || s.op === 1)) this.message = 'stairs here: Enter to take them';
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
    } else if (keys.isDown('KeyW') || keys.isDown('ArrowUp') || keys.isDown('KeyK')) {
      const kick = keys.isDown('KeyK');
      if (this.noclip || canPass(this.art.tables, this.level, x, y, facing, kick)) {
        [x, y] = stepForward(this.level, x, y, facing);
        changed = true;
        this.pose_ = { level: this.pose_.level, x, y, facing };
        this.arrive(x, y);
      } else {
        this.message = 'blocked (doors need K, the kick command)';
        this.cooldown = STEP_COOLDOWN_MS;
      }
    } else if (keys.isDown('Enter')) {
      const t = stairsTarget(this.level, x, y, this.index);
      this.cooldown = STEP_COOLDOWN_MS;
      if (t === 'exit') {
        const e = this.level.exit;
        this.pendingLevel = { level: CITY_BASE + e.city, x: e.x, y: e.y, facing };
        return null;
      } else if (t) {
        this.pendingLevel = { level: t.level, x: t.x, y: t.y, facing };
        return null;
      }
    }
    if (!changed) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.pose_.level, x, y, facing };
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
    const frame = renderView(this.art, this.level, this.pose_.x, this.pose_.y, this.pose_.facing);
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    img.data.set(indexedToRGBA(frame, this.art.tables.palette));
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadBardsTale3View(
  assetBase: string,
  levelId: number,
  startPose_: Pose | null,
): Promise<BardsTale3View | BardsTale3CityView> {
  if (levelId >= CITY_BASE) return loadBardsTale3CityView(assetBase, levelId, startPose_);
  const [v, lvl, idx] = await Promise.all([
    fetchJSON<Parameters<typeof artFromJSON>[0]>(`${assetBase}/data/dungeon/view.json`),
    fetchJSON<Parameters<typeof levelFromJSON>[0]>(`${assetBase}/data/dungeon/level${levelId}.json`),
    fetchJSON<{ levels: LevelIndexEntry[] }>(`${assetBase}/data/dungeon/levels.json`),
  ]);
  return new BardsTale3View(artFromJSON(v), levelFromJSON(lvl), new Map(idx.levels.map((l) => [l.id, l])), levelId, startPose_);
}

type GrpJSON = { bpr: number; h: number; data: number[] } | null;

export function cityFromJSON(v: Omit<Bt3City, 'cells'> & { cells: number[] }): Bt3City {
  return { ...v, cells: Uint8Array.from(v.cells) };
}

/** The city / wilderness walker view (one byte per square, the game's 17-step city compositor). */
export class BardsTale3CityView implements GameView {
  readonly id = 'bardstale3';
  readonly gameLabel = "The Bard's Tale III";
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  palette: RGBAColor[];

  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private night = false;
  private cooldown = 0;
  private pendingLevel: Pose | null = null;
  private message: string | null = null;

  private readonly tables: CityTables;
  private readonly view61: ViewTables;
  private readonly entries: Array<GrpPiece | null>;
  private readonly city: Bt3City;

  private readonly entrances: CityIndexEntry['entrances'];

  constructor(
    tables: CityTables,
    view61: ViewTables,
    entries: Array<GrpPiece | null>,
    city: Bt3City,
    start: Pose,
    entrances: CityIndexEntry['entrances'] = [],
  ) {
    this.entrances = entrances;
    this.tables = tables;
    this.view61 = view61;
    this.entries = entries;
    this.city = city;
    this.palette = this.makePalette();
    this.pose_ = start;
  }

  private makePalette(): RGBAColor[] {
    const p = this.night ? this.tables.nightPalette : this.tables.palette;
    return p.map((w) => ({ r: ((w >> 8) & 15) * 17, g: ((w >> 4) & 15) * 17, b: (w & 15) * 17, a: 255 }));
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return `city ${this.city.map}: ${this.city.name}${this.night ? ' (night)' : ''}`;
  }
  get pose(): Pose {
    return this.pose_;
  }
  get currentTick(): number {
    return this.tick;
  }

  /** E9B6 on arrival: a special whose first opcode is a teleport (opcode 3; in a city target bit 7 = dungeon). */
  private arrive(x: number, y: number): void {
    const sp = this.city.specials.find((s) => s.teleport && s.y === y && s.x === x);
    if (!sp?.teleport) {
      const en = this.entrances.find((e) => e.x === x && e.y === y);
      if (en) this.message = `entrance to ${en.name}: Enter goes in`;
      return;
    }
    const t = sp.teleport.target;
    const level = t >= 0x80 ? t & 0x7f : CITY_BASE + t;
    const to: Pose = { level, x: sp.teleport.x, y: sp.teleport.y, facing: this.pose_.facing };
    if (level === this.pose_.level) this.pose_ = to;
    else this.pendingLevel = to;
    this.message = t >= 0x80 ? `teleport -> dungeon ${t & 0x7f}` : `teleport -> city ${t}`;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    let { x, y, facing } = this.pose_;
    const left = keys.isDown('KeyQ') || keys.isDown('ArrowLeft');
    const right = keys.isDown('KeyE') || keys.isDown('ArrowRight');
    if (keys.isDown('KeyN')) {
      this.night = !this.night;
      this.palette = this.makePalette();
      this.cooldown = STEP_COOLDOWN_MS * 2;
      this.message = this.night ? 'night palette (DATA 0x208c8)' : 'day palette (DATA 0x20868)';
      return this.pose_;
    }
    if (left !== right) facing = ((facing + (right ? 1 : 3)) & 3) as Pose['facing'];
    else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) facing = ((facing + 2) & 3) as Pose['facing'];
    else if (keys.isDown('KeyW') || keys.isDown('ArrowUp') || keys.isDown('KeyK')) {
      const r = cityMove(this.tables, this.city, x, y, facing, keys.isDown('KeyK'), this.noclip);
      this.cooldown = STEP_COOLDOWN_MS;
      if (r.message) this.message = r.message;
      if (!r.moved && r.facing === facing) return null;
      this.pose_ = { level: this.pose_.level, x: r.x, y: r.y, facing: r.facing as Pose['facing'] };
      if (r.moved) this.arrive(r.x, r.y);
      return this.pose_;
    } else if (keys.isDown('Enter')) {
      this.cooldown = STEP_COOLDOWN_MS;
      const en = this.entrances.find((e) => e.x === x && e.y === y);
      if (en) this.pendingLevel = { level: en.dungeon, x: en.to.x, y: en.to.y, facing: en.to.facing as Pose['facing'] };
      return null;
    } else return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.pose_.level, x, y, facing };
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
    const frame = renderCityView(this.tables, this.view61, this.entries, this.city, this.pose_.x, this.pose_.y, this.pose_.facing);
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    img.data.set(indexedToRGBA(frame, this.night ? this.tables.nightPalette : this.tables.palette));
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

/**
 * One forward command in a city (0x257c / 0x259c). `enter` = the K / 0x4c00 path, which first runs the building
 * handler for the cell ahead (0x2780; every handler ends with the U-turn 0xcd58) and then tries to move; the plain
 * forward key skips the building check. The move itself needs the cell ahead to pass 0x2736 and, on a bounded map,
 * stay inside it.
 */
export function cityMove(
  t: CityTables,
  c: Bt3City,
  x: number,
  y: number,
  facing: number,
  enter: boolean,
  noclip = false,
): { x: number; y: number; facing: number; moved: boolean; message?: string } {
  const ahead = cellAhead(t, c, x, y, facing);
  let message: string | undefined;
  if (enter && !noclip) {
    const b = cityBuilding(ahead);
    if (b) {
      facing = (facing + 2) & 3;
      return { x, y, facing, moved: false, message: `the party visits ${b} and leaves (turned around)` };
    }
  }
  if (!noclip && !cityPassable(ahead)) return { x, y, facing, moved: false, message: cityBuilding(ahead) ? 'a building (K enters)' : 'blocked' };
  const n = cityStep(t, c, x, y, facing);
  if (!n) return { x, y, facing, moved: false, message: 'the edge of the map' };
  return { x: n[0], y: n[1], facing, moved: true, message };
}

export async function loadBardsTale3CityView(assetBase: string, levelId: number, startPose_: Pose | null): Promise<BardsTale3CityView> {
  const m = levelId - CITY_BASE;
  const [v, cj, dv, idx] = await Promise.all([
    fetchJSON<{ tables: CityTables; grp: Record<string, GrpJSON[]>; grpOfSet: string[] }>(`${assetBase}/data/city/view.json`),
    fetchJSON<Parameters<typeof cityFromJSON>[0]>(`${assetBase}/data/city/city${m}.json`),
    fetchJSON<{ tables: ViewTables }>(`${assetBase}/data/dungeon/view.json`),
    fetchJSON<{ cities: CityIndexEntry[] }>(`${assetBase}/data/city/cities.json`),
  ]);
  const city = cityFromJSON(cj);
  const entries = (v.grp[v.grpOfSet[city.artSet]!] ?? []).map((e) => (e ? { bpr: e.bpr, h: e.h, data: Uint8Array.from(e.data) } : null));
  const st = idx.cities.find((c) => c.map === m)?.start ?? { x: 0, y: 0, facing: 0 };
  const start: Pose = startPose_ ?? { level: levelId, x: st.x, y: st.y, facing: st.facing as Pose['facing'] };
  return new BardsTale3CityView(v.tables, dv.tables, entries, city, start, idx.cities.find((c) => c.map === m)?.entrances ?? []);
}

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
} from '../bardstale3/amiga/dungeon.ts';

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

export async function bardsTale3LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { levels } = await fetchJSON<{ levels: LevelIndexEntry[] }>(`${assetBase}/data/dungeon/levels.json`);
  return levels.map((l) => ({ id: l.id, label: `${l.id}: ${l.name} (level ${l.levelIndex + 1})` }));
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
    const tp = here.find((s) => s.teleport && s.teleport.target < 0x80 && s.x !== 0xff && s.y !== 0x7f);
    if (tp?.teleport && tp.teleport.target !== this.pose_.level) {
      this.pendingLevel = { level: tp.teleport.target, x: tp.teleport.x, y: tp.teleport.y, facing: this.pose_.facing };
      this.message = `teleport -> dungeon ${tp.teleport.target}`;
      return;
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
      if (t === 'exit') this.message = 'these stairs leave the dungeon (cities are not in the walker)';
      else if (t) {
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

export async function loadBardsTale3View(assetBase: string, levelId: number, startPose_: Pose | null): Promise<BardsTale3View> {
  const [v, lvl, idx] = await Promise.all([
    fetchJSON<Parameters<typeof artFromJSON>[0]>(`${assetBase}/data/dungeon/view.json`),
    fetchJSON<Parameters<typeof levelFromJSON>[0]>(`${assetBase}/data/dungeon/level${levelId}.json`),
    fetchJSON<{ levels: LevelIndexEntry[] }>(`${assetBase}/data/dungeon/levels.json`),
  ]);
  return new BardsTale3View(artFromJSON(v), levelFromJSON(lvl), new Map(idx.levels.map((l) => [l.id, l])), levelId, startPose_);
}

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
  return levels.map((l) => ({ id: l.id, label: `Level ${l.id}: ${l.name}` }));
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

export async function loadBardsTale1View(assetBase: string, levelId: number, startPose: Pose | null): Promise<BardsTale1View> {
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

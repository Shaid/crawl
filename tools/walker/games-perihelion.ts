/**
 * Perihelion: The Prophecy (Amiga) `GameView`: the five first-person dungeons, drawn through the
 * port of the main program's own view composers (tools/perihelion/amiga/view-model.ts) via
 * `renderCanvas` (176x120 indexed view, in-game palette $E7BDE).
 *
 * Confirmed from the main program (spec docs/perihelion/amiga/data-structure.md "First-person
 * dungeons"): the grids ($C4B8C table: widths + pointers; one byte per cell), start poses ($BEE12),
 * atlas per dungeon ($BED5A), the 7x7 window rotation ($C26B2), both composers ($C2A94 far /
 * $C2FA0 near) with every leaf routine decoded from the code, the piece / destination tables,
 * the checkerboard parity flip, the step / turn / strafe rules and blocking cell values
 * ($BCF26..$BD28A), the use-command door toggle ($BD30A) and the palette.
 * Hypotheses / not modelled: the door-lock table (keys, codes) is ignored, so every door toggles;
 * exits (6) and ladders (4/5, teleport table $C4CA0) are not followed; events, NPCs, monsters,
 * items and the overhead 40x40 maps are not drawn; level names are the music-module titles.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView, step, toggleDoor, toSeerFacing, toGameFacing, paletteRGB, VIEW_W, VIEW_H,
  type GamePose, type Op, type PeriMap, type ViewData, type Leaf, type Piece, type Dest,
} from '../perihelion/amiga/view-model.ts';

const STEP_COOLDOWN_MS = 175;

interface DungeonJson {
  index: number; name: string; kind: 'far' | 'near'; width: number; height: number;
  cells: number[]; start: { x: number; y: number; facing: number };
  atlas: { file: string; w: number; h: number };
}
interface WalkerJson {
  palette: number[];
  dungeons: DungeonJson[];
  composers: Record<'far' | 'near', { pieces: Piece[]; dests: Dest[] }>;
  leaves: Record<string, Leaf>;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Walker level id = dungeon number - 1. */
export const levelLabel = (d: { index: number; name: string }) => `Dungeon ${d.index}: ${d.name}`;

export async function perihelionLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const j = await fetchJSON<WalkerJson>(`${assetBase}/walker/walker.json`);
  return j.dungeons.map((d) => ({ id: d.index - 1, label: levelLabel(d) }));
}

export class PerihelionView implements GameView {
  readonly id = 'perihelion';
  readonly gameLabel = 'Perihelion: The Prophecy';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private prev: { x: number; y: number } | null = null;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private message: string | null = null;

  private readonly dungeon: number;
  private readonly label: string;
  private readonly map: PeriMap;
  private readonly viewData: ViewData;
  private readonly palette_: RGBAColor[];

  constructor(dungeon: number, label: string, map: PeriMap, viewData: ViewData, palette: RGBAColor[], start: Pose) {
    this.dungeon = dungeon;
    this.label = label;
    this.map = map;
    this.viewData = viewData;
    this.palette_ = palette;
    this.pose_ = start;
  }
  get levelId(): number { return this.dungeon - 1; }
  get levelLabel(): string { return this.label; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }
  get palette(): RGBAColor[] { return this.palette_; }

  private gamePose(): GamePose { return { x: this.pose_.x, y: this.pose_.y, facing: toGameFacing(this.pose_.facing) }; }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const d = (...c: string[]) => c.some((k) => keys.isDown(k));
    if (d('Space')) {
      this.cooldown = STEP_COOLDOWN_MS * 2;
      if (toggleDoor(this.map, this.gamePose())) { this.tick += 1; return this.pose_; }
      return null;
    }
    const op: Op | null = d('KeyQ', 'ArrowLeft') ? 'turnL' : d('KeyE', 'ArrowRight') ? 'turnR'
      : d('KeyW', 'ArrowUp') ? 'fwd' : d('KeyS', 'ArrowDown') ? 'back' : d('KeyA') ? 'left' : d('KeyD') ? 'right' : null;
    if (!op) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    const r = step(this.map, this.dungeon, this.gamePose(), op, this.prev, this.noclip);
    if (r.message) this.message = r.message;
    if (!r.pose) return null;
    if (r.pose.x !== this.pose_.x || r.pose.y !== this.pose_.y) this.prev = { x: this.pose_.x, y: this.pose_.y };
    this.pose_ = { level: this.levelId, x: r.pose.x, y: r.pose.y, facing: toSeerFacing(r.pose.facing) };
    return this.pose_;
  }
  takeMessage(): string | null { const m = this.message; this.message = null; return m; }
  setPose(pose: Pose): void { this.pose_ = pose; this.prev = null; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots */ }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const g = this.gamePose();
    const px = renderView(this.map, this.viewData, g.x, g.y, g.facing);
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    for (let i = 0; i < px.length; i++) {
      const c = this.palette_[px[i]!] ?? { r: 255, g: 0, b: 255, a: 255 };
      img.data[i * 4] = c.r; img.data[i * 4 + 1] = c.g; img.data[i * 4 + 2] = c.b; img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadPerihelionView(assetBase: string, levelId: number, startPose: Pose | null): Promise<PerihelionView> {
  const base = `${assetBase}/walker`;
  const j = await fetchJSON<WalkerJson>(`${base}/walker.json`);
  const d = j.dungeons[levelId] ?? j.dungeons[0]!;
  const res = await fetch(`${base}/${d.atlas.file}`);
  if (!res.ok) throw new Error(`GET ${base}/${d.atlas.file} -> ${res.status}`);
  const px = new Uint8Array(await res.arrayBuffer());
  if (px.length !== d.atlas.w * d.atlas.h) throw new Error(`${d.atlas.file}: ${px.length} bytes, expected ${d.atlas.w * d.atlas.h}`);
  const viewData: ViewData = { kind: d.kind, atlas: { w: d.atlas.w, h: d.atlas.h, px }, composer: j.composers[d.kind], leaves: j.leaves };
  const palette = paletteRGB(j.palette).map(([r, g, b]) => ({ r, g, b, a: 255 }));
  const start: Pose = startPose && startPose.level === d.index - 1
    ? startPose
    : { level: d.index - 1, x: d.start.x, y: d.start.y, facing: toSeerFacing(d.start.facing) };
  return new PerihelionView(d.index, levelLabel(d), { width: d.width, height: d.height, cells: [...d.cells] }, viewData, palette, start);
}

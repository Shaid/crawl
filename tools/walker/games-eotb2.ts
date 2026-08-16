/**
 * Eye of the Beholder II (DOS/VGA) `GameView` -- same integration shape as
 * `games-eotb.ts`'s EOB1 view (a `renderCanvas`-only `GameView`, bypassing
 * the `DrawItem`/`compositeDrawList` path; see `tools/eotb2/renderer.ts`'s
 * module doc for why the slot-table schema doesn't fit this format).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { decodeMaze, type MazeData } from '../eotb2/decode-maze.ts';
import { resolveWallTypes, canStepForward, type Facing } from '../eotb2/view-model.ts';
import { renderView, VIEWPORT_W, VIEWPORT_H } from '../eotb2/renderer.ts';
import type { VcnData } from '../eotb2/decode-vcn.ts';
import type { VmpData, VmpTileRef } from '../eotb2/decode-vmp.ts';

const STEP_COOLDOWN_MS = 175;

interface LevelInfo {
  level: number;
  wallSet: string;
  skipped?: string;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function eotb2LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { levels } = await fetchJSON<{ levels: LevelInfo[] }>(`${assetBase}/dungeon/levels.json`);
  return levels.filter((l) => !l.skipped).map((l) => ({ id: l.level, label: `Level ${l.level} (${l.wallSet})` }));
}

function refFrom(t: [number, boolean, boolean]): VmpTileRef {
  return { tileIndex: t[0], mirrorX: t[1], zMask: t[2] };
}

async function loadMaze(assetBase: string, level: number): Promise<{ maze: MazeData; wallSet: string }> {
  const j = await fetchJSON<{ width: number; height: number; wallSet: string; cells: number[][] }>(
    `${assetBase}/dungeon/level${level}.json`,
  );
  return { maze: { width: j.width, height: j.height, cells: j.cells.map((c) => Uint8Array.from(c)) }, wallSet: j.wallSet };
}

async function loadWallSet(assetBase: string, name: string): Promise<{ vcn: VcnData; vmp: VmpData; palette: RGBAColor[] }> {
  const j = await fetchJSON<{
    numTiles: number;
    palette: [number, number, number][];
    tiles: number[][];
    vmp: { backdrop: [number, boolean, boolean][][]; wallTiles: [number, boolean, boolean][][] };
  }>(`${assetBase}/wallsets/${name.toLowerCase()}.json`);
  return {
    vcn: { numTiles: j.numTiles, colMap: new Uint8Array(0), tiles: j.tiles.map((t) => Uint8Array.from(t)) },
    vmp: {
      backdrop: j.vmp.backdrop.map((col) => col.map(refFrom)),
      wallTiles: j.vmp.wallTiles.map((run) => run.map(refFrom)),
    },
    palette: j.palette.map(([r, g, b]) => ({ r, g, b, a: 255 })),
  };
}

/** First open (wallType 0 on at least one side) cell, scanning low->high -- deterministic, always walkable. */
function entrancePose(maze: MazeData, level: number): Pose {
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y * maze.width + x]!;
      const openSide = cell.findIndex((v) => v === 0);
      if (openSide >= 0) return { level, x, y, facing: openSide as Pose['facing'] };
    }
  }
  return { level, x: 0, y: 0, facing: 0 };
}

export class Eotb2View implements GameView {
  readonly id = 'eotb2';
  readonly gameLabel = 'Eye of the Beholder II';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;

  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;
  private readonly maze: MazeData;
  private readonly wallSet: string;
  private readonly vcn: VcnData;
  private readonly vmp: VmpData;
  private readonly palette_: RGBAColor[];

  constructor(maze: MazeData, wallSet: string, vcn: VcnData, vmp: VmpData, palette: RGBAColor[], level: number, startPose: Pose | null) {
    this.maze = maze;
    this.wallSet = wallSet;
    this.vcn = vcn;
    this.vmp = vmp;
    this.palette_ = palette;
    this.pose_ = startPose ?? entrancePose(maze, level);
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return `Level ${this.pose_.level} (${this.wallSet})`;
  }
  get pose(): Pose {
    return this.pose_;
  }
  get currentTick(): number {
    return this.tick;
  }
  get palette(): RGBAColor[] {
    return this.palette_;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.stepCooldown = Math.max(0, this.stepCooldown - dtMs);
    let { x, y, facing } = this.pose_;
    let changed = false;
    const turn = keys.isDown('KeyQ') || keys.isDown('ArrowLeft') ? -1 : keys.isDown('KeyE') || keys.isDown('ArrowRight') ? 1 : 0;
    if (turn !== 0 && this.stepCooldown <= 0) {
      facing = ((facing + turn + 4) & 3) as Pose['facing'];
      this.stepCooldown = STEP_COOLDOWN_MS;
      changed = true;
    }
    const fwd = keys.isDown('KeyW') || keys.isDown('ArrowUp');
    const back = keys.isDown('KeyS') || keys.isDown('ArrowDown');
    if ((fwd || back) && this.stepCooldown <= 0) {
      const stepFacing = (fwd ? facing : ((facing + 2) & 3)) as Facing;
      if (this.noclip || canStepForward(this.maze, x, y, stepFacing)) {
        const deltas: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [dx, dy] = deltas[stepFacing]!;
        x = Math.max(0, Math.min(this.maze.width - 1, x + dx));
        y = Math.max(0, Math.min(this.maze.height - 1, y + dy));
        this.stepCooldown = STEP_COOLDOWN_MS;
        changed = true;
      }
    }
    if (!changed) return null;
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
  pick(): void {
    // No hotspots yet.
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const { x, y, facing } = this.pose_;
    const surface = renderView(this.maze, x, y, facing as Facing, this.vcn, this.vmp);
    const imageData = ctx.createImageData(VIEWPORT_W, VIEWPORT_H);
    for (let i = 0; i < VIEWPORT_W * VIEWPORT_H; i++) {
      const c = this.palette_[surface.data[i]!] ?? { r: 0, g: 0, b: 0, a: 255 };
      imageData.data[i * 4] = c.r;
      imageData.data[i * 4 + 1] = c.g;
      imageData.data[i * 4 + 2] = c.b;
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEWPORT_W;
    ctx.canvas.height = VIEWPORT_H;
    ctx.putImageData(imageData, 0, 0);
  }

  /** Exposed for tests/debugging -- which wallType each of the 25 screen positions resolved to at the current pose. */
  debugResolve() {
    return resolveWallTypes(this.maze, this.pose_.x, this.pose_.y, this.pose_.facing as Facing);
  }
}

export async function loadEotb2View(assetBase: string, levelId: number, startPose: Pose | null): Promise<Eotb2View> {
  const { maze, wallSet } = await loadMaze(assetBase, levelId);
  const { vcn, vmp, palette } = await loadWallSet(assetBase, wallSet);
  return new Eotb2View(maze, wallSet, vcn, vmp, palette, levelId, startPose);
}

export { decodeMaze };

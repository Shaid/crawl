/**
 * Lands of Lore `GameView` -- same integration shape as `games-eotb.ts`/
 * `games-eotb2.ts` (a `renderCanvas`-only `GameView`; see `tools/
 * landsoflore/renderer.ts`'s module doc for why the slot-table schema
 * doesn't fit this format, same finding as both EOB games).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { decodeCmz, type MazeData } from '../landsoflore/decode-maze.ts';
import { resolveWallTypes, canStepForward, type Facing } from '../landsoflore/view-model.ts';
import { renderView, VIEWPORT_W, VIEWPORT_H } from '../landsoflore/renderer.ts';
import type { VcnData } from '../landsoflore/decode-vcn.ts';
import type { VmpData, VmpTileRef } from '../landsoflore/decode-vmp.ts';
import { buildWllLookup, type WllData } from '../landsoflore/decode-wll.ts';

const STEP_COOLDOWN_MS = 175;

interface LevelInfo {
  level: number;
  wallSet: string;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function landsofloreLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { levels } = await fetchJSON<{ levels: LevelInfo[] }>(`${assetBase}/dungeon/levels.json`);
  return levels.map((l) => ({ id: l.level, label: `Level ${l.level} (${l.wallSet})` }));
}

function refFrom(t: [number, boolean, boolean]): VmpTileRef {
  return { tileIndex: t[0], mirrorX: t[1], zMask: t[2] };
}

async function loadMaze(assetBase: string, level: number): Promise<{ maze: MazeData; wallSet: string; wllLookup: Map<number, number> }> {
  const j = await fetchJSON<{ width: number; height: number; wallSet: string; cells: number[][]; wll: WllData | null }>(
    `${assetBase}/dungeon/level${level}.json`,
  );
  return {
    maze: { width: j.width, height: j.height, cells: j.cells.map((c) => Uint8Array.from(c)) },
    wallSet: j.wallSet,
    wllLookup: j.wll ? buildWllLookup(j.wll) : new Map<number, number>(),
  };
}

async function loadWallSet(assetBase: string, name: string): Promise<{ vcn: VcnData; vmp: VmpData; palette: RGBAColor[] }> {
  const j = await fetchJSON<{
    numTiles: number;
    palette: [number, number, number][];
    tiles: number[][];
    vmp: { backdrop: [number, boolean, boolean][][]; wallTiles: [number, boolean, boolean][][] };
  }>(`${assetBase}/wallsets/${name.toLowerCase()}.json`);
  return {
    vcn: { numTiles: j.numTiles, palette: j.palette, tiles: j.tiles.map((t) => Uint8Array.from(t)) },
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

export class LandsOfLoreView implements GameView {
  readonly id = 'landsoflore';
  readonly gameLabel = 'Lands of Lore';
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
  private readonly wllLookup: Map<number, number>;

  constructor(
    maze: MazeData,
    wallSet: string,
    vcn: VcnData,
    vmp: VmpData,
    palette: RGBAColor[],
    wllLookup: Map<number, number>,
    level: number,
    startPose: Pose | null,
  ) {
    this.maze = maze;
    this.wallSet = wallSet;
    this.vcn = vcn;
    this.vmp = vmp;
    this.palette_ = palette;
    this.wllLookup = wllLookup;
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
    const surface = renderView(this.maze, x, y, facing as Facing, this.vcn, this.vmp, this.wllLookup);
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
    return resolveWallTypes(
      this.maze,
      this.pose_.x,
      this.pose_.y,
      this.pose_.facing as Facing,
      this.vmp.wallTiles.length,
      this.wllLookup,
    );
  }
}

export async function loadLandsOfLoreView(assetBase: string, levelId: number, startPose: Pose | null): Promise<LandsOfLoreView> {
  const { maze, wallSet, wllLookup } = await loadMaze(assetBase, levelId);
  const { vcn, vmp, palette } = await loadWallSet(assetBase, wallSet);
  return new LandsOfLoreView(maze, wallSet, vcn, vmp, palette, wllLookup, levelId, startPose);
}

export { decodeCmz };

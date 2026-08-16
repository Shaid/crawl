/**
 * SNES Wizardry 6 dungeon-view `GameView` (the walker's "Graphics variant:
 * SNES" option, alongside the existing Amiga `Wizardry6View` in
 * `games.ts`). Renders through `tools/wizardry6/snes/view-model.ts`'s v1
 * pose -> `ViewOp[]` -> composited-RGBA pipeline via `GameView.renderCanvas`
 * (full-colour, bypassing the `DrawItem`/`compositeDrawList` path -- the
 * SNES piece system addresses tiles directly by bank+index rather than
 * through the Amiga port's baseIndex+depth compose-list runs, so a custom
 * renderer is the better fit here, same reasoning as MM1/MM2's
 * `renderCanvas` views in `games-mm.ts`).
 *
 * See `view-model.ts`'s module doc comment for exactly what's confirmed vs.
 * approximate in this v1 (backdrop + confirmed door: real; generic
 * per-direction "blocked" wall art: placement confirmed, exact per-value
 * variant selection open; floor/ceiling continuation in the open middle of
 * the view: not yet identified, rendered as a black void).
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import { WalkerController, DEFAULT_BINDINGS } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  densifyMazeLevel,
  resolveViewWords,
  extractPoolIndices,
  compositeSnesView,
  canStepSnes,
  type DenseMazeGrid,
  type MazeLevelRaw,
  type ViewPiecesFile,
  type Palette16,
} from '../wizardry6/snes/view-model.ts';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

function decodePNGToRGBA(url: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, off.width, off.height);
      resolve({ rgba: imageData.data, width: off.width, height: off.height });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Find a data-derived, guaranteed-walkable, corridor-facing entrance pose -- same convention as `w6EntrancePose` (Amiga). */
function snesEntrancePose(grid: DenseMazeGrid, levelId: number): Pose {
  // Prefer a cell with at least one wall (real authored content) that can
  // still step north -- off-map/seed cells are all-open (wall 0) in the v2
  // grid, so a bare "wall===0" test would pick a seed cell outside the maze.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (grid.wall[i] !== 0 && canStepSnes(grid, x, y, 0)) return { level: levelId, x, y, facing: 0 };
    }
  }
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.wall[y * grid.width + x] !== 0) return { level: levelId, x, y, facing: 0 };
    }
  }
  return { level: levelId, x: 0, y: 0, facing: 0 };
}

export interface Wizardry6SnesViewOptions {
  grid: DenseMazeGrid;
  viewPieces: ViewPiecesFile;
  pool: Uint8Array;
  poolW: number;
  palette: Palette16;
  levelId: number;
  startPose: Pose;
}

export class Wizardry6SnesView implements GameView {
  readonly id = 'wizardry6';
  readonly gameLabel = 'Wizardry 6 (SNES)';
  readonly automap = undefined;
  // No DrawItem/compositeDrawList path for this view -- renderCanvas draws
  // everything itself. These are present only to satisfy the GameView shape.
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = {
    schemaVersion: 1,
    surface: { width: 320, height: 200 },
    viewport: { x: 0, y: 0, width: 144, height: 120 },
    depthCount: 3,
    lateralOffsets: [-1, 0, 1],
    frontWallMaxDepth: 3,
    banks: [],
    slots: {},
  };
  private readonly controller: WalkerController;
  private readonly grid: DenseMazeGrid;
  private readonly viewPieces: ViewPiecesFile;
  private readonly pool: Uint8Array;
  private readonly poolW: number;
  private readonly palette_: RGBAColor[];
  private readonly levelId_: number;
  private noclip = false;
  private tick = 0;

  constructor(opts: Wizardry6SnesViewOptions) {
    this.grid = opts.grid;
    this.viewPieces = opts.viewPieces;
    this.pool = opts.pool;
    this.poolW = opts.poolW;
    this.palette_ = opts.palette.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }));
    this.levelId_ = opts.levelId;
    this.controller = new WalkerController(opts.startPose, DEFAULT_BINDINGS, {
      canStep: (pose, dir) => this.noclip || canStepSnes(this.grid, pose.x, pose.y, dir),
    });
  }

  get levelId(): number {
    return this.levelId_;
  }
  get levelLabel(): string {
    return `Level ${String(this.levelId_ + 1).padStart(2, '0')}`;
  }
  get pose(): Pose {
    return this.controller.pose;
  }
  get items(): DrawItem[] {
    return [];
  }
  get currentTick(): number {
    return this.tick;
  }
  get palette(): RGBAColor[] {
    return this.palette_;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    return this.controller.update(dtMs, keys);
  }
  setPose(pose: Pose): void {
    this.controller.setPose(pose);
  }
  setNoclip(on: boolean): void {
    this.noclip = on;
  }
  interactCodes(): string[] {
    return this.controller.interactCodes();
  }
  automapCodes(): string[] {
    return this.controller.automapCodes();
  }
  pick(): void {
    // No hotspot/picking for the SNES view yet.
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const pose = this.pose;
    const words = resolveViewWords(this.viewPieces, this.grid, this.levelId_, pose.x, pose.y, pose.facing);
    const { rgba, width, height } = compositeSnesView(this.viewPieces, this.pool, this.poolW, this.palette_, words);

    const canvas = ctx.canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    // Draw the composed 144x120 view scaled up and centred in the 320x200
    // harness canvas -- the confirmed real screen placement (§3.14.10's
    // external-screenshot geometry check) is close to centred; this reuses
    // that same visual convention rather than a fixed pixel-exact SNES
    // frame the harness doesn't otherwise render (menus/borders/etc).
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    off.getContext('2d')!.putImageData(imageData, 0, 0);
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const dw = width * scale;
    const dh = height * scale;
    ctx.drawImage(off, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }
}

/** Load one SNES dungeon level + its palette + the v1 view pieces + the shared tile-pool atlas, and build the `GameView`. `startPose` may be `null` to use the level's data-derived entrance tile. */
export async function loadWizardry6Snes(assetBase: string, levelId: number, startPose: Pose | null): Promise<GameView> {
  const [maze, viewPieces, levelPalettes] = await Promise.all([
    fetchJSON<MazeLevelRaw[]>(`${assetBase}/data/maze.json`),
    fetchJSON<ViewPiecesFile>(`${assetBase}/dungeon/view-pieces.json`),
    fetchJSON<{ groups: number[] }>(`${assetBase}/dungeon/level-palettes.json`),
  ]);
  const lvl = maze.find((l) => l.level === levelId);
  if (!lvl) throw new Error(`wizardry6 (SNES): no level ${levelId} in data/maze.json`);
  const grid = densifyMazeLevel(lvl, viewPieces.tables.db8d[levelId] ?? 0x0d);

  const poolImg = await decodePNGToRGBA(`${assetBase}/dungeon/${viewPieces.poolAtlas}`);
  if (!poolImg) throw new Error(`wizardry6 (SNES): failed to load ${assetBase}/dungeon/${viewPieces.poolAtlas} -- run npm run w6:snes:view`);
  const pool = extractPoolIndices(poolImg.rgba, poolImg.width, poolImg.height);

  const group = levelPalettes.groups[levelId] ?? 40;
  const paletteFile = await fetchJSON<{ colors: { r: number; g: number; b: number }[] }>(
    `${assetBase}/palettes/dungeon-region-${group}.json`,
  );

  const pose = startPose ?? snesEntrancePose(grid, levelId);

  return new Wizardry6SnesView({
    grid,
    viewPieces,
    pool,
    poolW: poolImg.width,
    palette: paletteFile.colors,
    levelId,
    startPose: pose,
  });
}

export async function wizardry6SnesLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const maze = await fetchJSON<MazeLevelRaw[]>(`${assetBase}/data/maze.json`);
  return maze.map((l) => ({ id: l.level, label: `Level ${String(l.level + 1).padStart(2, '0')}` }));
}

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
 * See `view-model.ts`'s module doc comment for the full v2/v3/v4 history --
 * as of v4 (`data-structure.md` §3.14.12) the wall/floor/ceiling art
 * variant AND the palette group are both resolved per-region/per-cell from
 * real ROM data (`resolveCellVariant`, `resolveRegionPaletteGroup`), not
 * approximated per-level.
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
  resolveRegionForCell,
  resolveRegionPaletteGroup,
  type DenseMazeGrid,
  type MazeLevelRaw,
  type ViewPiecesFile,
  type Palette16,
  type LevelPalettesFile,
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
  mazeLevel: MazeLevelRaw;
  viewPieces: ViewPiecesFile;
  pool: Uint8Array;
  poolW: number;
  /** Group -> palette, preloaded for every group `levelPalettes` can resolve to for this level (§3.14.12 v4 real per-region resolution). */
  palettesByGroup: Map<number, Palette16>;
  levelPalettes: LevelPalettesFile;
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
  private readonly mazeLevel: MazeLevelRaw;
  private readonly viewPieces: ViewPiecesFile;
  private readonly pool: Uint8Array;
  private readonly poolW: number;
  private readonly palettesByGroup: Map<number, RGBAColor[]>;
  private readonly levelPalettes: LevelPalettesFile;
  private readonly levelId_: number;
  private noclip = false;
  private tick = 0;

  constructor(opts: Wizardry6SnesViewOptions) {
    this.grid = opts.grid;
    this.mazeLevel = opts.mazeLevel;
    this.viewPieces = opts.viewPieces;
    this.pool = opts.pool;
    this.poolW = opts.poolW;
    this.palettesByGroup = new Map(
      [...opts.palettesByGroup.entries()].map(([g, pal]) => [g, pal.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }))]),
    );
    this.levelPalettes = opts.levelPalettes;
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
  /**
   * Not used by the walker's main render loop (this view has `renderCanvas`,
   * which the loop prefers -- see `walker.ts`'s `renderMainView`), but kept
   * live (resolved for the CURRENT pose/region, §3.14.12 v4) for any other
   * consumer (e.g. a future automap legend).
   */
  get palette(): RGBAColor[] {
    return this.resolvePalette();
  }

  private resolvePalette(): RGBAColor[] {
    const pose = this.pose;
    const gx = pose.x + this.grid.originX;
    const gy = pose.y + this.grid.originY;
    const region = resolveRegionForCell(this.mazeLevel, gx, gy);
    const group = resolveRegionPaletteGroup(this.levelPalettes, this.levelId_, region?.region ?? null);
    return this.palettesByGroup.get(group) ?? this.palettesByGroup.get(this.levelPalettes.groups[this.levelId_] ?? 40)!;
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
    const palette = this.resolvePalette();
    const { rgba, width, height } = compositeSnesView(this.viewPieces, this.pool, this.poolW, palette, words);

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

/** Load one SNES dungeon level + its palette(s) + the v1 view pieces + the shared tile-pool atlas, and build the `GameView`. `startPose` may be `null` to use the level's data-derived entrance tile. */
export async function loadWizardry6Snes(assetBase: string, levelId: number, startPose: Pose | null): Promise<GameView> {
  const [maze, viewPieces, levelPalettes] = await Promise.all([
    fetchJSON<MazeLevelRaw[]>(`${assetBase}/data/maze.json`),
    fetchJSON<ViewPiecesFile>(`${assetBase}/dungeon/view-pieces.json`),
    fetchJSON<LevelPalettesFile>(`${assetBase}/dungeon/level-palettes.json`),
  ]);
  const lvl = maze.find((l) => l.level === levelId);
  if (!lvl) throw new Error(`wizardry6 (SNES): no level ${levelId} in data/maze.json`);
  const seedVariant = viewPieces.variants[levelId] ?? 0;
  // §3.14.12 v4: da2e/db9b give the real per-cell art-family variant; the
  // level-palettes.json fallback/perRegion pair gives the real per-region
  // palette group (resolveRegionPaletteGroup) -- both replace the earlier
  // per-level-uniform approximations. See docs/wizardry6/TODO.md for the
  // remaining within-region multi-trigger caveat.
  const grid = densifyMazeLevel(lvl, viewPieces.tables.db8d[levelId] ?? 0x0d, viewPieces.da2e, viewPieces.db9b, seedVariant);

  const poolImg = await decodePNGToRGBA(`${assetBase}/dungeon/${viewPieces.poolAtlas}`);
  if (!poolImg) throw new Error(`wizardry6 (SNES): failed to load ${assetBase}/dungeon/${viewPieces.poolAtlas} -- run npm run w6:snes:view`);
  const pool = extractPoolIndices(poolImg.rgba, poolImg.width, poolImg.height);

  const pose = startPose ?? snesEntrancePose(grid, levelId);

  // Preload every group this level's palette resolution can possibly land
  // on (the fallback + every region's own group) so `renderCanvas` can
  // resolve the live per-pose palette synchronously every frame.
  const groups = new Set<number>([levelPalettes.groups[levelId] ?? 40]);
  for (const g of levelPalettes.perRegion[levelId] ?? []) if (g >= 0) groups.add(g);
  const palettesByGroup = new Map<number, Palette16>(
    await Promise.all(
      [...groups].map(
        async (group): Promise<[number, Palette16]> => [
          group,
          (await fetchJSON<{ colors: { r: number; g: number; b: number }[] }>(`${assetBase}/palettes/dungeon-region-${group}.json`)).colors,
        ],
      ),
    ),
  );

  return new Wizardry6SnesView({
    grid,
    mazeLevel: lvl,
    viewPieces,
    pool,
    poolW: poolImg.width,
    palettesByGroup,
    levelPalettes,
    levelId,
    startPose: pose,
  });
}

export async function wizardry6SnesLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const maze = await fetchJSON<MazeLevelRaw[]>(`${assetBase}/data/maze.json`);
  return maze.map((l) => ({ id: l.level, label: `Level ${String(l.level + 1).padStart(2, '0')}` }));
}

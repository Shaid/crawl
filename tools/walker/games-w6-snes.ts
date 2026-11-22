/**
 * SNES Wizardry 6 dungeon-view `GameView` (the walker's "Graphics variant:
 * SNES" option, alongside the Amiga `Wizardry6View` in `games.ts`).
 * Renders through `tools/wizardry6/snes/view-model.ts` -- v5, a port of the
 * game's own `$80:C69F` view walk run on the 24x24 maze windows the ROM's
 * own builder produces (`dungeon/maze-windows.json`, exported by running
 * `$80:D073` in a 65816 core). Parity with the game is checked pose by pose
 * by `tools/wizardry6/snes/oracle/sweep-parity.ts` (`data-structure.md`
 * §3.14.13).
 *
 * Pose coordinates are the game's own global maze coordinates (`$0908` x,
 * `$0906` y, +Y = north). The view keeps its window while the party stays
 * in the window's centre region and switches to the window the game builds
 * on arrival when it leaves (`$80:D039`), so a region entered from
 * different cells can show different neighbours -- as in the game.
 * Movement is the game's `$80:C40B` decision (`canStepWindow`).
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import { WalkerController, DEFAULT_BINDINGS } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  resolveViewWords,
  extractPoolIndices,
  compositeSnesView,
  canStepWindow,
  decodeMazeWindow,
  inCentreRegion,
  windowIndexFor,
  resolveRegionPaletteGroup,
  type MazeWindow,
  type MazeWindowsFile,
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

/**
 * Entrance pose: the ROM's new-game start (`$80:891B` entry 0, level 0
 * (127,121) facing N) on its level; elsewhere the first party cell (region
 * order) from which the game would let the party step in some direction.
 */
function snesEntrancePose(mw: MazeWindowsFile, vp: ViewPiecesFile, levelId: number): Pose {
  if (mw.start.level === levelId) return { level: levelId, x: mw.start.x, y: mw.start.y, facing: (mw.start.facing & 3) as Pose['facing'] };
  const cells = mw.cells[levelId] ?? {};
  const decoded = new Map<number, MazeWindow>();
  for (const [key, idx] of Object.entries(cells)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    let w = decoded.get(idx);
    if (!w) decoded.set(idx, (w = decodeMazeWindow(mw, idx)));
    for (let facing = 0; facing < 4; facing++) {
      if (canStepWindow(vp, w, x, y, facing, facing)) return { level: levelId, x, y, facing: facing as Pose['facing'] };
    }
  }
  const first = Object.keys(cells)[0];
  if (!first) return { level: levelId, x: 0, y: 0, facing: 0 };
  const [x, y] = first.split(',').map(Number) as [number, number];
  return { level: levelId, x, y, facing: 0 };
}

export interface Wizardry6SnesViewOptions {
  mazeWindows: MazeWindowsFile;
  viewPieces: ViewPiecesFile;
  pool: Uint8Array;
  poolW: number;
  /** Group -> palette, preloaded for every group `levelPalettes` can resolve to for this level. */
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
  private readonly mazeWindows: MazeWindowsFile;
  private readonly viewPieces: ViewPiecesFile;
  private readonly pool: Uint8Array;
  private readonly poolW: number;
  private readonly palettesByGroup: Map<number, RGBAColor[]>;
  private readonly levelPalettes: LevelPalettesFile;
  private readonly levelId_: number;
  private readonly decoded = new Map<number, MazeWindow>();
  private window: MazeWindow;
  private noclip = false;
  private tick = 0;

  constructor(opts: Wizardry6SnesViewOptions) {
    this.mazeWindows = opts.mazeWindows;
    this.viewPieces = opts.viewPieces;
    this.pool = opts.pool;
    this.poolW = opts.poolW;
    this.palettesByGroup = new Map(
      [...opts.palettesByGroup.entries()].map(([g, pal]) => [g, pal.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }))]),
    );
    this.levelPalettes = opts.levelPalettes;
    this.levelId_ = opts.levelId;
    this.window = this.windowAt(opts.startPose) ?? this.decodeWindow(0);
    this.controller = new WalkerController(opts.startPose, DEFAULT_BINDINGS, {
      canStep: (pose, dir) => this.noclip || canStepWindow(this.viewPieces, this.window, pose.x, pose.y, pose.facing, dir),
    });
  }

  private decodeWindow(index: number): MazeWindow {
    let w = this.decoded.get(index);
    if (!w) this.decoded.set(index, (w = decodeMazeWindow(this.mazeWindows, index)));
    return w;
  }

  /** The window `$80:D073` builds on arrival at `pose`'s cell, or null if the cell is in no region. */
  private windowAt(pose: Pose): MazeWindow | null {
    const i = windowIndexFor(this.mazeWindows, this.levelId_, pose.x, pose.y);
    return i === null ? null : this.decodeWindow(i);
  }

  /** `$80:D039`: keep the window while the party is in its centre region, else take the one built on arrival. */
  private followParty(): void {
    const p = this.controller.pose;
    if (inCentreRegion(this.window, this.levelId_, p.x, p.y)) return;
    const w = this.windowAt(p);
    if (w) this.window = w;
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
    const group = resolveRegionPaletteGroup(this.levelPalettes, this.levelId_, this.window.region);
    return this.palettesByGroup.get(group) ?? this.palettesByGroup.get(this.levelPalettes.groups[this.levelId_] ?? 40)!;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    const moved = this.controller.update(dtMs, keys);
    if (moved) this.followParty();
    return moved;
  }
  setPose(pose: Pose): void {
    this.controller.setPose(pose);
    // a jump/teleport arrives fresh, like the game's own $80:D073 call at a level entry
    const w = this.windowAt(pose);
    if (w) this.window = w;
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
    const words = resolveViewWords(this.viewPieces, this.window, pose.x, pose.y, pose.facing);
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

/** Load the SNES view assets for one level and build the `GameView`. `startPose` may be `null` for the entrance pose. */
export async function loadWizardry6Snes(assetBase: string, levelId: number, startPose: Pose | null): Promise<GameView> {
  const [mazeWindows, viewPieces, levelPalettes] = await Promise.all([
    fetchJSON<MazeWindowsFile>(`${assetBase}/dungeon/maze-windows.json`),
    fetchJSON<ViewPiecesFile>(`${assetBase}/dungeon/view-pieces.json`),
    fetchJSON<LevelPalettesFile>(`${assetBase}/dungeon/level-palettes.json`),
  ]);
  if (!mazeWindows.cells[levelId] || Object.keys(mazeWindows.cells[levelId]!).length === 0) {
    throw new Error(`wizardry6 (SNES): no maze windows for level ${levelId} -- run npm run w6:snes:windows`);
  }

  const poolImg = await decodePNGToRGBA(`${assetBase}/dungeon/${viewPieces.poolAtlas}`);
  if (!poolImg) throw new Error(`wizardry6 (SNES): failed to load ${assetBase}/dungeon/${viewPieces.poolAtlas} -- run npm run w6:snes:view`);
  const pool = extractPoolIndices(poolImg.rgba, poolImg.width, poolImg.height);

  const known = startPose && windowIndexFor(mazeWindows, levelId, startPose.x, startPose.y) !== null;
  const pose = known ? startPose! : snesEntrancePose(mazeWindows, viewPieces, levelId);

  // Preload every group this level's palette resolution can land on.
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

  return new Wizardry6SnesView({ mazeWindows, viewPieces, pool, poolW: poolImg.width, palettesByGroup, levelPalettes, levelId, startPose: pose });
}

export async function wizardry6SnesLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const mw = await fetchJSON<MazeWindowsFile>(`${assetBase}/dungeon/maze-windows.json`);
  return mw.cells
    .map((c, id) => ({ id, n: Object.keys(c).length }))
    .filter((l) => l.n > 0)
    .map((l) => ({ id: l.id, label: `Level ${String(l.id + 1).padStart(2, '0')}` }));
}

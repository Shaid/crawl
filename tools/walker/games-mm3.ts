/**
 * MM3 (DOS) dungeon walker — `GameView` for the shared walker harness.
 *
 * Renders through the same ASM-faithful frustum engine as MM1/MM2
 * (`tools/walker-mm/maze3d.ts`), but MM3's maze records (`data/mazes.json`,
 * decoded from `MM3.CUR` — see `docs/mm3/dosvga/data-structure.md` "Maze
 * records") use a structurally different wall encoding than MM1/MM2's
 * page-0 byte codes: each of a cell's 4 sides is a 4-bit field (3-bit wall
 * graphic index + 1 blocking bit) in a 16-bit word, not a 2-bit open/wall/
 * door/torch code. Two consequences:
 *
 *  - For frustum RENDERING we reduce each side to a plain 0/1 (open/wall)
 *    code and pack it into a byte using the exact same compass-literal
 *    layout MM1/MM2's own page-0 "visual" byte uses (`N=bits0-1,
 *    E=bits2-3, S=bits4-5, W=bits6-7` — see `tools/walker/games-mm.ts`
 *    `pagesFromCells`), so `StitchedVisual`/`buildIndoorScene` work
 *    unmodified. MM3 doesn't distinguish door/torch yet, so every wall
 *    renders as plain code `1`.
 *  - For MOVEMENT we do NOT reuse `movementBlocked`/`stepParty` — those are
 *    wired to MM1/MM2's *collision* page, a differently-shaped byte whose
 *    internal field-to-direction mapping is not a simple compass mirror of
 *    the visual page (`movementToCollisionDir`'s `(3-facing)&3` plus the
 *    collision byte's own asymmetric N/E/S-are-2-bit/W-is-1-bit layout
 *    make it easy to get subtly wrong by inspection alone — the *visual*
 *    byte's own correct bit order for MM3 turned out to need an exhaustive
 *    brute-force search rather than reasoning it out, see below). MM3's
 *    own wall-blocking bit is unambiguous and already disassembly-
 *    confirmed (`scripts/mm3lib/dos_maze.py`), so movement here is a small
 *    independent reimplementation of the same step/cross-maze logic using
 *    that bit directly, rather than risking a silently-wrong reuse of the
 *    MM1/2 collision math.
 *
 * Wall art: each maze's environment (`graphics.wallSeries` — `twn`/`cav`/
 * `dun`/`cas`/`sci`) is a 40-byte constant table in the game's own code
 * indexed by `mazeId - 1` (`mm3-maze-wall-textures`, closed — the 7-entry
 * per-maze "graphic-set" table in the maze record itself is unrelated:
 * it's outdoor-terrain-only and all-zero for every indoor maze). FRONT
 * blits use the real `<series>wl{1,2,3}.vga` sprites (near/mid/far
 * distance variants), always frame 0 (the plain wall — ~96.5% of real
 * wall faces; which of a tile's other ~13 frames — torch, door, grate,
 * cave mouth — a given position should use is still open, see TODO
 * `mm3-maze-wall-frames`). LEFT/RIGHT blits still render flat-shaded: the
 * real side art (`<series>wl4.vga`, a single 216x71 "oblique side pieces +
 * floor + ceiling" composite) doesn't map onto this engine's per-depth
 * per-side blit slots the way wl1-3 map onto FRONT depths, and guessing
 * its placement risked a worse (misaligned) result than the honest flat
 * placeholder.
 *
 * Outdoor mazes (ids 41-64) use the wall word as terrain *layers*, not
 * per-side walls, and aren't supported by this indoor frustum view — only
 * the 81 indoor mazes are selectable.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import type { ScreenLike, Blit } from '../walker-mm/maze3d.ts';
import {
  VIEW_W,
  VIEW_H,
  ORIGIN_X,
  FLOOR_Y,
  MAP_GRID,
  MAP_PAGE_SIZE,
  STEP_DX,
  STEP_DY,
  buildIndoorScene,
  StitchedVisual,
} from '../walker-mm/maze3d.ts';

// ──────────────────────────────────────────────────────────────────────────
// Data loading
// ──────────────────────────────────────────────────────────────────────────

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

interface Sheet {
  img: HTMLImageElement;
  frame(name: string | number): AtlasFrame | undefined;
}

/** Loads a `<name>.vga` sprite sheet exported by `scripts/extract_mm3_dos_sprites.py` (`sprites/walls/<name>.vga.png` + `.json`). Missing files resolve to `undefined` rather than throwing — not every series/distance file matters to every render path. */
async function loadWallSheet(base: string, name: string): Promise<Sheet | undefined> {
  const png = `${base}/sprites/walls/${name}.vga.png`;
  const json = `${base}/sprites/walls/${name}.vga.json`;
  try {
    const [img, sidecar] = await Promise.all([loadImage(png), fetch(json).then((r) => r.json())]);
    const frames: AtlasFrame[] = sidecar.frames as AtlasFrame[];
    return {
      img,
      frame(key: string | number) {
        const s = String(key);
        return frames.find((f) => f.name === s || f.name.endsWith(`frame${s}`));
      },
    };
  } catch {
    return undefined;
  }
}

interface MazeGraphicsJson {
  graphicsMazeId: number;
  env: number;
  wallSeries: string;
  wallFiles: string[];
  tile: string;
  sky: string | null;
  music: string;
  areaName: string;
}

interface MazeRecordJson {
  id: number;
  storedId: number;
  kind: 'indoor' | 'outdoor';
  width: number;
  height: number;
  walls: number[];
  cells: number[];
  graphicSets: number[];
  surrounding: { north: number; east: number; south: number; west: number };
  runPosition: { x: number; y: number };
  canSave: boolean;
  canRest: boolean;
  canDismiss: boolean;
  graphics?: MazeGraphicsJson;
}

/** direction index (matches maze3d.ts FACE: 0=N,1=E,2=S,3=W) -> wall-word nibble shift (dos_maze.py WALL_SHIFT). */
const DIR_SHIFT = [12, 8, 4, 0];

interface Mm3Maze {
  id: number;
  label: string;
  walls: number[];
  runPosition: { x: number; y: number };
  /** Screens-array index per direction (0=N,1=E,2=S,3=W), -1 if none/unloaded/outdoor. */
  neighbors: number[];
  /** ScreenLike view onto this maze's walls, for the shared frustum engine (collision unused — see module doc). */
  screen: ScreenLike;
  /** `twn`/`cav`/`dun`/`cas`/`sci` — undefined for a maze the graphics extractor hasn't resolved yet (defensive; every shipped indoor maze has one). */
  wallSeries: string | undefined;
}

interface Mm3Data {
  mazes: Mm3Maze[];
  /** wallSeries -> [wl1, wl2, wl3, wl4] sheets (1-indexed distance variants, 0-indexed array). */
  wallSheets: Record<string, (Sheet | undefined)[]>;
}

export function wallBlocked(walls: number[], x: number, y: number, dir: number): boolean {
  const v = walls[y * MAP_GRID + x]!;
  return ((v >> (DIR_SHIFT[dir & 3]! + 3)) & 1) !== 0;
}

/**
 * MM1/MM2's page-0 "visual" byte shape, packed from MM3's wall-blocking
 * bits (every wall reduced to plain code 1 — MM3 has no door/torch
 * distinction yet). **Not** a naive compass-literal `N|E<<2|S<<4|W<<6`
 * packing (that was tried first and empirically falsified — see below);
 * the engine's internal frustum math (`buildFrustum`'s `setFacing` masks)
 * expects direction order **W, S, E, N** in bit-slots 0, 1, 2, 3.
 *
 * Verified exhaustively, not assumed: for all 81 indoor mazes x all 256
 * cells x all 4 facings (82,944 cases), "does `buildIndoorScene` produce
 * a depth-0 front blit" was checked against MM3's own disassembly-
 * confirmed `wallBlocked` oracle (`scripts/mm3lib/dos_maze.py`'s `blocked()`,
 * independently validated this session against the Castle Blackwind route
 * map). The naive N,E,S,W ordering failed on ~40% of a random sample; this
 * W,S,E,N ordering is the *only* one of the 24 possible direction
 * permutations with zero mismatches. Script:
 * `/tmp/.../scratchpad/mm3_perm_verify_full.mjs` (session-local, not committed).
 */
export function visualFromWalls(walls: number[]): Uint8Array {
  const out = new Uint8Array(MAP_PAGE_SIZE);
  for (let y = 0; y < MAP_GRID; y++) {
    for (let x = 0; x < MAP_GRID; x++) {
      const w = wallBlocked(walls, x, y, 3) ? 1 : 0;
      const s = wallBlocked(walls, x, y, 2) ? 1 : 0;
      const e = wallBlocked(walls, x, y, 1) ? 1 : 0;
      const n = wallBlocked(walls, x, y, 0) ? 1 : 0;
      out[y * MAP_GRID + x] = w | (s << 2) | (e << 4) | (n << 6);
    }
  }
  return out;
}

let mm3Promise: Promise<Mm3Data> | null = null;

function loadMm3(): Promise<Mm3Data> {
  if (mm3Promise) return mm3Promise;
  mm3Promise = (async () => {
    const base = '/assets/mm3/dosvga';
    const raw = await fetch(`${base}/data/mazes.json`).then((r) => r.json());
    const records = (raw.mazes as MazeRecordJson[]).filter((m) => m.kind === 'indoor');
    const idToIndex = new Map<number, number>();
    records.forEach((m, i) => idToIndex.set(m.id, i));

    const dummyCollision = new Uint8Array(MAP_PAGE_SIZE);
    const mazes: Mm3Maze[] = records.map((m) => {
      const visual = visualFromWalls(m.walls);
      const neighborIds = [m.surrounding.north, m.surrounding.east, m.surrounding.south, m.surrounding.west];
      const neighbors = neighborIds.map((id) => (id !== 0 && idToIndex.has(id) ? idToIndex.get(id)! : -1));
      const label = m.graphics ? `${m.id}: ${m.graphics.areaName}` : `${m.id}: maze${String(m.id).padStart(2, '0')}`;
      return {
        id: m.id,
        label,
        walls: m.walls,
        runPosition: m.runPosition,
        neighbors,
        screen: { index: m.id, visual, collision: dummyCollision, neighbors },
        wallSeries: m.graphics?.wallSeries,
      };
    });

    const seriesList = [...new Set(mazes.map((m) => m.wallSeries).filter((s): s is string => !!s))];
    const wallSheets: Record<string, (Sheet | undefined)[]> = {};
    await Promise.all(
      seriesList.map(async (series) => {
        wallSheets[series] = await Promise.all([1, 2, 3, 4].map((n) => loadWallSheet(base, `${series}wl${n}`)));
      }),
    );

    return { mazes, wallSheets };
  })();
  return mm3Promise;
}

// ──────────────────────────────────────────────────────────────────────────
// Movement (independent of MM1/MM2's collision-page math — see module doc)
// ──────────────────────────────────────────────────────────────────────────

interface Mm3Pose {
  mazeIndex: number;
  x: number;
  y: number;
  facing: number;
}

function mm3StepParty(mazes: Mm3Maze[], pose: Mm3Pose, facing: number, noclip: boolean): Mm3Pose {
  const maze = mazes[pose.mazeIndex]!;
  if (!noclip && wallBlocked(maze.walls, pose.x, pose.y, facing)) {
    return pose;
  }
  let x = pose.x + STEP_DX[facing & 3]!;
  let y = pose.y + STEP_DY[facing & 3]!;
  let mazeIndex = pose.mazeIndex;
  if (x < 0) {
    const n = maze.neighbors[3]!; // west
    if (n >= 0) { mazeIndex = n; x = MAP_GRID - 1; }
  } else if (x >= MAP_GRID) {
    const n = maze.neighbors[1]!; // east
    if (n >= 0) { mazeIndex = n; x = 0; }
  }
  if (y < 0) {
    const n = maze.neighbors[2]!; // south
    if (n >= 0) { mazeIndex = n; y = MAP_GRID - 1; }
  } else if (y >= MAP_GRID) {
    const n = maze.neighbors[0]!; // north
    if (n >= 0) { mazeIndex = n; y = 0; }
  }
  return {
    mazeIndex,
    x: Math.max(0, Math.min(MAP_GRID - 1, x)),
    y: Math.max(0, Math.min(MAP_GRID - 1, y)),
    facing,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Flat-shaded rendering (no resolved wall-texture art yet — see module doc)
// ──────────────────────────────────────────────────────────────────────────

const FRONT_W = [176, 96, 48, 16];
const FRONT_H = [96, 64, 32, 16];
const SIDE_W = [32, 40, 24, 16];
const SIDE_H = [128, 96, 64, 32];
const DEPTH_SHADE = [1, 0.8, 0.62, 0.46];
const KIND_BASE: Record<Blit['kind'], [number, number, number]> = {
  front: [150, 140, 130],
  left: [112, 104, 98],
  right: [130, 122, 114],
};

function wallFillStyle(kind: Blit['kind'], depth: number): string {
  const [r, g, bl] = KIND_BASE[kind];
  const s = DEPTH_SHADE[Math.min(Math.max(depth, 0), 3)]!;
  return `rgb(${Math.round(r * s)},${Math.round(g * s)},${Math.round(bl * s)})`;
}

function blitSize(b: Blit): [number, number] {
  const d = Math.min(Math.max(b.depth, 0), 3);
  if (b.kind === 'front') return [FRONT_W[d]!, FRONT_H[d]!];
  if (b.mirror) return [8, SIDE_H[Math.min(d + 1, 3)]!]; // corner sliver, approximate — see module doc
  return [SIDE_W[d]!, SIDE_H[d]!];
}

const STEP_COOLDOWN_MS = 175;

export class MM3View implements GameView {
  readonly id = 'mm3';
  readonly gameLabel = 'Might & Magic III';
  readonly automap: undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  private readonly mazes: Mm3Maze[];
  private readonly wallSheets: Record<string, (Sheet | undefined)[]>;
  private pose_: Mm3Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;

  constructor(data: Mm3Data, startLevel: number, startPose: Pose | null) {
    this.mazes = data.mazes;
    this.wallSheets = data.wallSheets;
    const idx = Math.max(0, this.mazes.findIndex((m) => m.id === startLevel));
    const maze = this.mazes[idx] ?? this.mazes[0]!;
    this.pose_ = startPose
      ? { mazeIndex: idx, x: startPose.x, y: startPose.y, facing: startPose.facing }
      : { mazeIndex: idx, x: maze.runPosition.x, y: maze.runPosition.y, facing: 0 };
  }

  private get maze(): Mm3Maze {
    return this.mazes[this.pose_.mazeIndex]!;
  }

  get levelId(): number {
    return this.maze.id;
  }
  get levelLabel(): string {
    return this.maze.label;
  }
  get pose(): Pose {
    return { level: this.maze.id, x: this.pose_.x, y: this.pose_.y, facing: this.pose_.facing as Pose['facing'] };
  }
  get items(): DrawItem[] {
    return [];
  }
  get currentTick(): number {
    return this.tick;
  }
  get palette(): RGBAColor[] {
    return [];
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.stepCooldown = Math.max(0, this.stepCooldown - dtMs);
    let changed = false;
    let { facing } = this.pose_;
    const turn =
      keys.isDown('KeyQ') || keys.isDown('ArrowLeft') ? -1 : keys.isDown('KeyE') || keys.isDown('ArrowRight') ? 1 : 0;
    if (turn !== 0 && this.stepCooldown <= 0) {
      facing = (facing + turn + 4) & 3;
      this.stepCooldown = STEP_COOLDOWN_MS;
      changed = true;
    }
    const fwd = keys.isDown('KeyW') || keys.isDown('ArrowUp');
    const back = keys.isDown('KeyS') || keys.isDown('ArrowDown');
    const dir = fwd ? facing : back ? (facing + 2) & 3 : -1;
    if (dir >= 0 && this.stepCooldown <= 0) {
      const next = mm3StepParty(this.mazes, { ...this.pose_, facing }, dir, this.noclip);
      if (next.x !== this.pose_.x || next.y !== this.pose_.y || next.mazeIndex !== this.pose_.mazeIndex) {
        this.stepCooldown = STEP_COOLDOWN_MS;
        changed = true;
      }
      this.pose_ = { ...next, facing };
    } else if (changed) {
      this.pose_ = { ...this.pose_, facing };
    }
    if (!changed) return null;
    return this.pose;
  }

  setPose(pose: Pose): void {
    const idx = this.mazes.findIndex((m) => m.id === pose.level);
    this.pose_ = { mazeIndex: idx >= 0 ? idx : this.pose_.mazeIndex, x: pose.x, y: pose.y, facing: pose.facing };
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
    // No hotspots in the MM3 walker.
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#181818';
    ctx.fillRect(ORIGIN_X, FLOOR_Y, VIEW_W - ORIGIN_X * 2, VIEW_H - FLOOR_Y);

    const grid = new StitchedVisual(this.mazes.map((m) => m.screen), this.pose_.mazeIndex);
    const scene = buildIndoorScene(grid, this.pose_.x, this.pose_.y, this.pose_.facing);
    const sheets = this.maze.wallSeries ? this.wallSheets[this.maze.wallSeries] : undefined;
    // Draw far-to-near so nearer walls correctly occlude farther ones.
    const blits = [...scene.blits].sort((a, b) => b.depth - a.depth);
    for (const b of blits) {
      const drew = b.kind === 'front' && sheets ? this.drawFrontSprite(ctx, sheets, b) : false;
      if (drew) continue;
      const [w, h] = blitSize(b);
      ctx.fillStyle = wallFillStyle(b.kind, b.depth);
      ctx.fillRect(b.x, b.y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, w - 1, h - 1);
    }
  }

  /** FRONT blits only — real `<series>wl{1,2,3}.vga` near/mid/far art, frame 0 (plain wall). Returns false (falls back to flat shading) if the sheet/frame isn't loaded. */
  private drawFrontSprite(ctx: CanvasRenderingContext2D, sheets: (Sheet | undefined)[], b: Blit): boolean {
    const fileIndex = b.depth === 0 ? 0 : b.depth === 1 ? 1 : 2; // wl1 near, wl2 mid, wl3 far (depths 2 and 3 both use wl3)
    const sheet = sheets[fileIndex];
    const fr = sheet?.frame(0);
    if (!sheet || !fr) return false;
    ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
    return true;
  }

  renderMinimap(ctx: CanvasRenderingContext2D, size = 224): void {
    const sc = this.maze.screen;
    const cell = size / MAP_GRID;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    const wallW = Math.max(1, Math.floor(cell / 5));
    ctx.fillStyle = '#c8c8d0';
    for (let y = 0; y < MAP_GRID; y++) {
      for (let x = 0; x < MAP_GRID; x++) {
        const v = sc.visual[y * MAP_GRID + x] as number;
        const nib = (dir: number) => (v >> (dir * 2)) & 3;
        const px = x * cell;
        const py = y * cell;
        if (nib(0) !== 0) ctx.fillRect(px, py, wallW, cell);
        if (nib(1) !== 0) ctx.fillRect(px, py, cell, wallW);
        if (nib(2) !== 0) ctx.fillRect(px + cell - wallW, py, wallW, cell);
        if (nib(3) !== 0) ctx.fillRect(px, py + cell - wallW, cell, wallW);
      }
    }
    const px = this.pose_.x * cell + cell / 2;
    const py = this.pose_.y * cell + cell / 2;
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, cell / 5), 0, Math.PI * 2);
    ctx.fill();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dy] = dirs[this.pose_.facing & 3]!;
    ctx.strokeStyle = '#ff3030';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * cell * 0.4, py + dy * cell * 0.4);
    ctx.stroke();
  }
}

export const mm3LevelList = () =>
  loadMm3().then((d) => d.mazes.map((m) => ({ id: m.id, label: m.label })));

export async function loadMM3View(_assetBase: string, levelId: number, startPose: Pose | null): Promise<MM3View> {
  return new MM3View(await loadMm3(), levelId, startPose);
}

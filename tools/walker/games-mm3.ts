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
 * indexed by `mazeId - 1` (the 7-entry per-maze "graphic-set" table in the
 * maze record itself is unrelated: it's outdoor-terrain-only and all-zero
 * for every indoor maze).
 *
 * Rendering itself is MM3's own real indoor 3-D view — a 44-view-slot
 * geometry/dispatch table, disassembly-decoded and ported to
 * `tools/walker/mm3-indoor-view.ts` (`buildWallList`, backed by the
 * frozen `data/indoor-view.json` table — see that module's doc and
 * `docs/mm3/dosvga/data-structure.md` § "Indoor 3-D view" for the full
 * citations). This is a genuinely different, richer screen-space geometry
 * than the shared MM1/MM2 frustum engine (`tools/walker-mm/maze3d.ts`)
 * this file otherwise reuses — real doors, animated torches, grates, and
 * posts render at their correct real frames on every visible wall face,
 * not just the one directly ahead. If the real table/sprites fail to
 * load, `renderCanvas` falls back to the older MM1/MM2-frustum-based flat/
 * partial-texture path (`renderCanvasFrustumFallback`) rather than
 * showing nothing.
 *
 * A known simplification, inherited from the verified Python reference
 * this was ported from: wall sampling for the 44 slots stays within the
 * *current* 16x16 maze (off-map = "plain wall", matching the real
 * accessor's off-map default) rather than reaching into a neighbouring
 * maze the way a 2x2-block castle/cavern's other 3 resident quadrants
 * would in the real engine. Doesn't affect movement (that already crosses
 * maze boundaries correctly via `mm3StepParty`) — only means a view whose
 * depth would extend past the current maze's edge sees a plain wall
 * there instead of the neighbour's real geometry.
 *
 * Outdoor mazes (ids 41-64) use the wall word as terrain *layers*, not
 * per-side walls, and aren't supported by this indoor view — only the 81
 * indoor mazes are selectable.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import type { ScreenLike, Blit } from '../walker-mm/maze3d.ts';
import { buildWallList, loadIndoorViewTable, type IndoorViewTable, type GetWall } from './mm3-indoor-view.ts';
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

/** Loads a `<fullName>` sprite sheet exported by `scripts/extract_mm3_dos_sprites.py` (`sprites/<subdir>/<fullName>.png` + `.json`, `fullName` already includes its extension, e.g. `dunwl1.vga` or `dun.sky`). Missing files resolve to `undefined` rather than throwing — not every series/distance/sky file matters to every render path. */
async function loadSpriteSheet(base: string, subdir: string, fullName: string): Promise<Sheet | undefined> {
  const png = `${base}/sprites/${subdir}/${fullName}.png`;
  const json = `${base}/sprites/${subdir}/${fullName}.json`;
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

const loadWallSheet = (base: string, name: string): Promise<Sheet | undefined> => loadSpriteSheet(base, 'walls', `${name}.vga`);
const loadSkySheet = (base: string, name: string): Promise<Sheet | undefined> => loadSpriteSheet(base, 'skies', name);

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

/** Wall-nibble mask (dos_maze.py's graphic-index masks: 0x7000 N / 0x0700 E / 0x0070 S / 0x0007 W) -> `wallGraphicIndex`'s `dir` param (0=N,1=E,2=S,3=W). */
const MASK_TO_DIR: Record<number, number> = { 0x7000: 0, 0x0700: 1, 0x0070: 2, 0x0007: 3 };

/** Party facing (0=N,1=E,2=S,3=W, matching `maze3d.ts` FACE) -> the indoor 3-D view's own facing order (0=N,1=S,2=E,3=W — see `mm3-indoor-view.ts`). */
const FACING_NESW_TO_INDOOR = [0, 2, 1, 3];

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
  /** e.g. `dun.sky` — undefined for `twn`/`cas` mazes, which ship no ceiling texture. */
  sky: string | undefined;
}

interface Mm3Data {
  mazes: Mm3Maze[];
  /** wallSeries -> [wl1, wl2, wl3, wl4] sheets (1-indexed distance variants, 0-indexed array). */
  wallSheets: Record<string, (Sheet | undefined)[]>;
  /** sky name (e.g. `dun.sky`) -> sheet. */
  skySheets: Record<string, Sheet | undefined>;
  /** The real indoor 3-D view geometry/dispatch table — undefined if it failed to load (falls back to the older frustum-based renderer). */
  indoorView: IndoorViewTable | undefined;
}

export function wallBlocked(walls: number[], x: number, y: number, dir: number): boolean {
  const v = walls[y * MAP_GRID + x]!;
  return ((v >> (DIR_SHIFT[dir & 3]! + 3)) & 1) !== 0;
}

/** The 3-bit wall-kind index (0 = no wall, 1-7 = a real kind — see `FRONT_FRAME_BY_KIND`). */
export function wallGraphicIndex(walls: number[], x: number, y: number, dir: number): number {
  const v = walls[y * MAP_GRID + x]!;
  return (v >> DIR_SHIFT[dir & 3]!) & 7;
}

/**
 * `<series>wl1.vga` (depth-0 front wall) frame per wall-kind index 1-7 —
 * confirmed by disassembling the indoor view's draw-list builder (see TODO
 * `mm3-maze-wall-frames`, closed): 1 plain, 2 barred door, 3 torch
 * (animated, handled separately — see `frontWallFrame`), 4 studded
 * door/grate, 5 cave mouth (never occurs in shipped indoor data), 6 open
 * doorway, 7 post/pillar. wl2/wl3 (depth 1+) use a slightly different
 * table — not wired here, only depth-0 is unambiguous without porting the
 * game's full 44-slot geometry (each of the other depths needs knowing
 * *which* nearby cell/direction a given screen position samples, which
 * this engine's shared MM1/MM2 frustum code doesn't expose per-blit).
 */
const FRONT_WL1_FRAME_BY_KIND: Record<number, number> = { 1: 0, 2: 6, 4: 8, 5: 9, 6: 7, 7: 10 };
const TORCH_KIND = 3;

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
    const [raw, indoorView] = await Promise.all([
      fetch(`${base}/data/mazes.json`).then((r) => r.json()),
      loadIndoorViewTable(base),
    ]);
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
        sky: m.graphics?.sky ?? undefined,
      };
    });

    const seriesList = [...new Set(mazes.map((m) => m.wallSeries).filter((s): s is string => !!s))];
    const skyList = [...new Set(mazes.map((m) => m.sky).filter((s): s is string => !!s))];
    const wallSheets: Record<string, (Sheet | undefined)[]> = {};
    const skySheets: Record<string, Sheet | undefined> = {};
    await Promise.all([
      ...seriesList.map(async (series) => {
        wallSheets[series] = await Promise.all([1, 2, 3, 4].map((n) => loadWallSheet(base, `${series}wl${n}`)));
      }),
      ...skyList.map(async (sky) => {
        skySheets[sky] = await loadSkySheet(base, sky);
      }),
    ]);

    return { mazes, wallSheets, skySheets, indoorView };
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
  private readonly skySheets: Record<string, Sheet | undefined>;
  private readonly indoorView: IndoorViewTable | undefined;
  private pose_: Mm3Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;
  /** Counts discrete screen redraws (one per accepted turn/step), not wall-clock time — mirrors DS
   * `0x185`'s real cadence ("flipped roughly once per redraw", see `docs/mm3/dosvga/data-structure.md`
   * "Indoor 3-D view"). Driving the side-wall alternation off `tick` instead made every wall/door/pillar
   * flip several times a second even while standing still — not what the real game does. */
  private redrawCount = 0;

  constructor(data: Mm3Data, startLevel: number, startPose: Pose | null) {
    this.mazes = data.mazes;
    this.wallSheets = data.wallSheets;
    this.skySheets = data.skySheets;
    this.indoorView = data.indoorView;
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
    this.redrawCount++;
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
    const series = this.maze.wallSeries;
    const sheets = series ? this.wallSheets[series] : undefined;
    const ready = this.indoorView && sheets && sheets.every((s) => s !== undefined);
    if (ready) {
      this.renderIndoorView(ctx, sheets!);
    } else {
      this.renderCanvasFrustumFallback(ctx);
    }
  }

  /**
   * The real indoor 3-D view — MM3's own 44-slot geometry via
   * `buildWallList` (`tools/walker/mm3-indoor-view.ts`), not the borrowed
   * MM1/MM2 frustum. Draws in the exact order `buildWallList` returns
   * (already correct back-to-front — it's a direct reproduction of the
   * real game's own draw-list code order, not re-derived here).
   */
  private renderIndoorView(ctx: CanvasRenderingContext2D, sheets: (Sheet | undefined)[]): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const [wl1, wl2, wl3, wl4] = sheets;
    const spriteSheet: Record<string, Sheet | undefined> = { wl1, wl2, wl3, wl4 };

    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 8, 216, 131); // the real game's own 3-D view window (view.py CLIP)
    ctx.clip();

    // Fixed head: ceiling then floor backdrop, drawn before the dynamic list (matches the real WallList's own fixed head records).
    const skySheet = this.maze.sky ? this.skySheets[this.maze.sky] : undefined;
    const skyFrame = skySheet?.frame(0);
    if (skySheet && skyFrame) {
      this.blitSprite(ctx, skySheet, skyFrame, 8, 8, false);
    }
    if (wl4) {
      const floorFrame = wl4.frame(29);
      if (floorFrame) this.blitSprite(ctx, wl4, floorFrame, 8, 67, false);
    }

    const getWall: GetWall = (dx, dy, mask) => {
      const x = this.pose_.x + dx;
      const y = this.pose_.y + dy;
      if (x < 0 || x >= MAP_GRID || y < 0 || y >= MAP_GRID) return 1; // off the current maze -> plain wall, matches the verified reference
      return wallGraphicIndex(this.maze.walls, x, y, MASK_TO_DIR[mask]!);
    };
    const facing = FACING_NESW_TO_INDOOR[this.pose_.facing & 3]!;
    const alt = this.redrawCount % 2;
    const torch = Math.floor(this.tick / 300) % 3;
    const draws = buildWallList(this.indoorView!, getWall, facing, alt, torch);
    for (const d of draws) {
      const sheet = spriteSheet[d.sprite];
      if (!sheet) continue;
      const fr = sheet.frame(d.frame);
      if (!fr) continue;
      this.blitSprite(ctx, sheet, fr, d.x, d.y, (d.flags & 1) !== 0);
    }
    ctx.restore();
  }

  private blitSprite(ctx: CanvasRenderingContext2D, sheet: Sheet, fr: AtlasFrame, dx: number, dy: number, mirror: boolean): void {
    if (!mirror) {
      ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, dx, dy, fr.w, fr.h);
      return;
    }
    ctx.save();
    ctx.translate(dx + fr.w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
    ctx.restore();
  }

  /** Falls back to when the real indoor-view table or wall sheets fail to load — the older MM1/MM2-frustum-based renderer (flat-shaded sides, depth-0-only real front frames). See the module doc. */
  private renderCanvasFrustumFallback(ctx: CanvasRenderingContext2D): void {
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

  /**
   * `renderCanvasFrustumFallback`'s helper — only reached when the real
   * indoor-view table/sprites failed to load. FRONT blits only — real
   * `<series>wl{1,2,3}.vga` near/mid/far art. Depth 0 (the immediate
   * forward wall) picks its real frame — door, torch, grate, doorway,
   * post — from the wall's own graphic index, since depth-0-front is
   * exhaustively confirmed to correspond exactly to `wallBlocked(walls,
   * x, y, facing)` on the party's current cell (no ambiguity about which
   * cell/direction it represents). Depth 1-3 still
   * use frame 0 (plain wall) — see `FRONT_WL1_FRAME_BY_KIND`'s doc for why
   * that's not yet extended to farther depths. Returns false (falls back
   * to flat shading) if the sheet/frame isn't loaded.
   */
  private drawFrontSprite(ctx: CanvasRenderingContext2D, sheets: (Sheet | undefined)[], b: Blit): boolean {
    const fileIndex = b.depth === 0 ? 0 : b.depth === 1 ? 1 : 2; // wl1 near, wl2 mid, wl3 far (depths 2 and 3 both use wl3)
    const sheet = sheets[fileIndex];
    if (!sheet) return false;
    let frame = 0;
    if (b.depth === 0) {
      const kind = wallGraphicIndex(this.maze.walls, this.pose_.x, this.pose_.y, this.pose_.facing);
      if (kind === TORCH_KIND) {
        frame = 1 + (Math.floor(this.tick / 300) % 3);
      } else if (kind in FRONT_WL1_FRAME_BY_KIND) {
        frame = FRONT_WL1_FRAME_BY_KIND[kind]!;
      }
    }
    const fr = sheet.frame(frame);
    if (!fr) return false;
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

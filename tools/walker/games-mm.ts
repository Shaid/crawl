/**
 * MM1 + MM2 walker views (`GameView` implementations for the shared walker
 * harness, `tools/walker/walker.ts`).
 *
 * Both games render through the ASM-faithful frustum engine
 * (`tools/walker-mm/maze3d.ts`, ported from Vairn's wiki walkers). MM1 uses
 * the REAL WALLPIX.DTA wall sets (per-screen entry from the decoded `.OVR`
 * selection fields); MM2 uses the authentic `.32` sheets. Both draw the
 * full main canvas themselves via `GameView.renderCanvas` (bypassing the
 * DrawItem composite path — MM art is full-colour) and their own minimap
 * via `renderMinimap`.
 *
 * Movement mirrors the harness conventions: `KeyStateLike.isDown` codes
 * (`KeyW`/`ArrowUp` ...), noclip via `setNoclip`, pose = {level, x, y,
 * facing} where `level` is the MAZEDATA/map.dat screen index.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  VIEW_W,
  VIEW_H,
  ORIGIN_X,
  SKY_Y,
  FLOOR_Y,
  MAP_GRID,
  MAP_PAGE_SIZE,
  buildIndoorScene,
  movementBlocked,
  stepParty,
  torchBlitFor,
  wallpixSliceName,
  StitchedVisual,
} from '../walker-mm/maze3d.ts';
import { StitchedOutdoor, buildOutdoorScene } from '../walker-mm/outdoor3d.ts';

// ──────────────────────────────────────────────────────────────────────────
// Asset loading
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
  frames: AtlasFrame[];
  frame(name: string | number): AtlasFrame | undefined;
}

async function loadSheet(png: string, json: string): Promise<Sheet> {
  const [img, sidecar] = await Promise.all([
    loadImage(png),
    fetch(json).then((r) => r.json()),
  ]);
  const frames: AtlasFrame[] = sidecar.frames as AtlasFrame[];
  return {
    img,
    frames,
    frame(name: string | number) {
      const key = String(name);
      return frames.find((f) => f.name === key || f.name.endsWith(`frame${key}`));
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Game data models
// ──────────────────────────────────────────────────────────────────────────

interface MmScreen {
  index: number;
  label: string;
  env: string;
  outdoor: boolean;
  visual: Uint8Array;
  collision: Uint8Array;
  neighbors: number[];
  roofBits?: Uint8Array;
  /** MM1: WALLPIX entry used for the frustum walls. */
  wallEntry: number;
  /** MM2 overland: attrib surface byte. */
  surface: number;
}

interface Mm1Data {
  screens: MmScreen[];
  wallpix: Sheet;
}

interface Mm2Data {
  screens: MmScreen[];
  walls: Record<string, Sheet>;
  floors: Record<string, Sheet>;
  torches: Record<string, Sheet>;
  sky: Sheet;
  /** Overland: horizon lanes + biome decor sheets + terrain tiles. */
  outdoor: Record<string, Sheet>;
}

interface CellJson {
  visual: { n: number; e: number; s: number; w: number };
  collision: { n: number; e: number; s: number; w: number };
  event: boolean;
}

function pagesFromCells(cells: CellJson[][]): { visual: Uint8Array; collision: Uint8Array } {
  const visual = new Uint8Array(MAP_PAGE_SIZE);
  const collision = new Uint8Array(MAP_PAGE_SIZE);
  for (let y = 0; y < MAP_GRID; y++) {
    for (let x = 0; x < MAP_GRID; x++) {
      const c = cells[y][x];
      const i = y * MAP_GRID + x;
      visual[i] = c.visual.n | (c.visual.e << 2) | (c.visual.s << 4) | (c.visual.w << 6);
      collision[i] =
        (c.collision.n & 3) |
        ((c.collision.e & 3) << 2) |
        ((c.collision.s & 3) << 4) |
        (c.collision.w !== 0 ? 0x40 : 0) |
        (c.event ? 0x80 : 0);
    }
  }
  return { visual, collision };
}

let mm1Promise: Promise<Mm1Data> | null = null;
let mm2Promise: Promise<Mm2Data> | null = null;

function loadMm1(): Promise<Mm1Data> {
  if (mm1Promise) return mm1Promise;
  mm1Promise = (async () => {
    const base = '/assets/mm1/dosega';
    const [mapsJson, ovrJson, wallpix] = await Promise.all([
      fetch(`${base}/data/maps.json`).then((r) => r.json()),
      fetch(`${base}/data/ovr.json`).then((r) => r.json()),
      loadSheet(`${base}/textures/wallpix.png`, `${base}/textures/wallpix.json`),
    ]);
    const screens: MmScreen[] = mapsJson.screens.map(
      (s: { index: number; slug: string; title: string; env: string; cells: CellJson[][] }) => {
        const { visual, collision } = pagesFromCells(s.cells);
        const ovr = ovrJson.overlays.find((o: { slug: string }) => o.slug === s.slug);
        return {
          index: s.index,
          label: `${s.index}: ${s.title}`,
          env: s.env,
          outdoor: s.env === 'outside',
          visual,
          collision,
          neighbors: [-1, -1, -1, -1],
          wallEntry: ovr && ovr.wallEntries ? (ovr.wallEntries[0] as number) : 0,
          surface: 0,
        };
      },
    );
    return { screens, wallpix };
  })();
  return mm1Promise;
}

const MM2_ENV_BY_RANGE: Array<[number, number, string, boolean]> = [
  [0, 4, 'town', false],
  [5, 16, 'outside', true],
  [17, 32, 'cavern', false],
  [33, 44, 'outside', true],
  [45, 59, 'castle', false],
];

function loadMm2(): Promise<Mm2Data> {
  if (mm2Promise) return mm2Promise;
  mm2Promise = (async () => {
    const base = '/assets/mm2/amiga';
    const [mapJson, attribJson] = await Promise.all([
      fetch(`${base}/data/map.json`).then((r) => r.json()),
      fetch(`${base}/data/attrib.json`).then((r) => r.json()),
    ]);
    const envFor = (i: number): [string, boolean] => {
      for (const [lo, hi, env, outdoor] of MM2_ENV_BY_RANGE) {
        if (i >= lo && i <= hi) return [env, outdoor];
      }
      return ['town', false];
    };
    const sheets = ['town', 'cave', 'castle'];
    const outdoorSheets = ['outdoor1', 'outdoor2', 'outdoor3', 'outb', 'desert', 'ocean', 'swamp', 'tundra'];
    const [walls, floors, torches, sky, outdoor] = await Promise.all([
      Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}.png`, `${base}/textures/${s}.json`))),
      Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}f.png`, `${base}/textures/${s}f.json`))),
      Promise.all(sheets.map((s) => loadSheet(`${base}/textures/${s}t.png`, `${base}/textures/${s}t.json`))),
      loadSheet(`${base}/textures/sky.png`, `${base}/textures/sky.json`),
      Promise.all(outdoorSheets.map((s) => loadSheet(`${base}/textures/${s}.png`, `${base}/textures/${s}.json`))),
    ]);
    const screens: MmScreen[] = (mapJson as { index: number; cells: CellJson[][] }[]).map((s, i) => {
      const { visual, collision } = pagesFromCells(s.cells);
      const [env, isOutdoor] = envFor(i);
      const attrib = attribJson[i];
      const roofBits =
        attrib && attrib.roofBits
          ? Uint8Array.from(Object.values(attrib.roofBits as Record<string, number>))
          : undefined;
      return {
        index: s.index,
        label: `screen ${s.index} (${env})`,
        env,
        outdoor: isOutdoor,
        visual,
        collision,
        neighbors: attrib ? (attrib.neighbours as number[]) : [-1, -1, -1, -1],
        roofBits,
        wallEntry: 0,
        surface: attrib ? (attrib.surfaceFlag as number) : 0,
      };
    });
    return {
      screens,
      walls: Object.fromEntries(sheets.map((s, i) => [s, walls[i]])),
      floors: Object.fromEntries(sheets.map((s, i) => [s, floors[i]])),
      torches: Object.fromEntries(sheets.map((s, i) => [s, torches[i]])),
      sky,
      outdoor: Object.fromEntries(outdoorSheets.map((s, i) => [s, outdoor[i]])),
    };
  })();
  return mm2Promise;
}

// ──────────────────────────────────────────────────────────────────────────
// Shared MM walker view
// ──────────────────────────────────────────────────────────────────────────

function sheetKeyFor(env: string): string {
  return env === 'cavern' ? 'cave' : env === 'castle' ? 'castle' : 'town';
}

const STEP_COOLDOWN_MS = 175;

export abstract class MmWalkerView implements GameView {
  abstract readonly id: string;
  abstract readonly gameLabel: string;
  readonly automap: undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  protected pose_: Pose;
  protected tick = 0;
  protected noclip = false;
  private stepCooldown = 0;
  protected readonly screens: MmScreen[];

  constructor(screens: MmScreen[], startLevel: number, startPose: Pose | null) {
    this.screens = screens;
    const found = screens.find((s) => s.index === startLevel);
    const level = found ?? screens.find((s) => !s.outdoor) ?? screens[0];
    const walkable = this.findWalkable(level);
    this.pose_ = startPose ?? { level: level.index, x: walkable[0], y: walkable[1], facing: 0 };
  }

  private findWalkable(sc: MmScreen): [number, number] {
    for (let y = 0; y < MAP_GRID; y++) {
      for (let x = 0; x < MAP_GRID; x++) {
        const c = sc.collision[y * MAP_GRID + x];
        const blocked = (c & 1) !== 0 || ((c >> 2) & 1) !== 0 || ((c >> 4) & 1) !== 0 || (c & 0x40) !== 0;
        if (!blocked) return [x, y];
      }
    }
    return [8, 8];
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return this.screens[this.pose_.level]?.label ?? `screen ${this.pose_.level}`;
  }
  get pose(): Pose {
    return this.pose_;
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
    let { level, x, y } = this.pose_;
    let facing: number = this.pose_.facing;
    const turn =
      keys.isDown('KeyQ') || keys.isDown('ArrowLeft')
        ? -1
        : keys.isDown('KeyE') || keys.isDown('ArrowRight')
          ? 1
          : 0;
    if (turn !== 0 && this.stepCooldown <= 0) {
      facing = (facing + turn + 4) & 3;
      this.stepCooldown = STEP_COOLDOWN_MS;
      changed = true;
    }
    const fwd = keys.isDown('KeyW') || keys.isDown('ArrowUp');
    const back = keys.isDown('KeyS') || keys.isDown('ArrowDown');
    const dir = fwd ? facing : back ? (facing + 2) & 3 : -1;
    if (dir >= 0 && this.stepCooldown <= 0) {
      const sc = this.screens[level];
      if (this.noclip || !movementBlocked(sc, x, y, dir)) {
        const next = stepParty(dir, x, y, level, this.screens, this.noclip);
        level = next.screen;
        x = next.x;
        y = next.y;
        this.stepCooldown = STEP_COOLDOWN_MS;
        changed = true;
      }
    }
    if (!changed) return null;
    this.pose_ = { level, x, y, facing: (facing & 3) as Pose['facing'] };
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
    // No hotspots in the MM walkers.
  }

  /** The screen the pose is on. */
  protected sc(): MmScreen {
    return this.screens[this.pose_.level];
  }

  protected drawMinimap(ctx: CanvasRenderingContext2D, size = 224): void {
    const sc = this.sc();
    const cell = size / MAP_GRID;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    const wallW = Math.max(1, Math.floor(cell / 5));
    ctx.fillStyle = '#c8c8d0';
    for (let y = 0; y < MAP_GRID; y++) {
      for (let x = 0; x < MAP_GRID; x++) {
        const v = sc.visual[y * MAP_GRID + x];
        const nib = (dir: number) => (v >> (dir * 2)) & 3;
        const px = x * cell;
        const py = y * cell;
        // Field->edge mapping matches the view: facing 0 (move +y) blocks on
        // field 3 -> bottom edge; 1 -> top, 2 -> right, 0 -> left.
        if (nib(0) !== 0) ctx.fillRect(px, py, wallW, cell);
        if (nib(1) !== 0) ctx.fillRect(px, py, cell, wallW);
        if (nib(2) !== 0) ctx.fillRect(px + cell - wallW, py, wallW, cell);
        if (nib(3) !== 0) ctx.fillRect(px, py + cell - wallW, cell, wallW);
      }
    }
    const pose = this.pose_;
    const px = pose.x * cell + cell / 2;
    const py = pose.y * cell + cell / 2;
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, cell / 5), 0, Math.PI * 2);
    ctx.fill();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dy] = dirs[pose.facing & 3];
    ctx.strokeStyle = '#ff3030';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * cell * 0.4, py + dy * cell * 0.4);
    ctx.stroke();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// MM1 view — real WALLPIX slices
// ──────────────────────────────────────────────────────────────────────────

export class MM1View extends MmWalkerView {
  readonly id = 'mm1';
  readonly gameLabel = 'Might & Magic I';
  private readonly data: Mm1Data;

  constructor(data: Mm1Data, startLevel: number, startPose: Pose | null) {
    super(data.screens, startLevel, startPose);
    this.data = data;
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const data = this.data;
    const sc = this.sc();
    // Clear the whole canvas — the harness canvas is the full 320x200 game
    // screen and may hold the previous game's pixels outside the viewport.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // dark floor band for readability
    ctx.fillStyle = '#181818';
    ctx.fillRect(ORIGIN_X, FLOOR_Y, VIEW_W - ORIGIN_X * 2, VIEW_H - FLOOR_Y);

    const grid = new StitchedVisual(data.screens, this.pose_.level);
    const scene = buildIndoorScene(grid, this.pose_.x, this.pose_.y, this.pose_.facing);

    for (const b of scene.blits) {
      const fr = data.wallpix.frame(wallpixSliceName(sc.wallEntry, b.frame));
      if (!fr) continue;
      ctx.drawImage(data.wallpix.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
    }
    // MM1 renders no torch overlays: the reference implementation
    // (ScummVM drawTile) draws code-3 (wall+torch) faces as plain walls and
    // WALLPIX has no torch frames, so MM2's torch art doesn't belong here.
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    this.drawMinimap(ctx);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// MM2 view — authentic .32 sheets
// ──────────────────────────────────────────────────────────────────────────

export class MM2View extends MmWalkerView {
  readonly id = 'mm2';
  readonly gameLabel = 'Might & Magic II';
  private readonly data: Mm2Data;

  constructor(data: Mm2Data, startLevel: number, startPose: Pose | null) {
    super(data.screens, startLevel, startPose);
    this.data = data;
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const data = this.data;
    const sc = this.sc();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (sc.outdoor) {
      this.renderOutdoor(ctx);
      return;
    }
    const env = sheetKeyFor(sc.env);
    const walls = data.walls[env];
    const floor = data.floors[env];
    const torch = data.torches[env];
    const tile = this.pose_.y * MAP_GRID + this.pose_.x;
    const roof =
      sc.roofBits && (sc.roofBits[tile >> 3] & (1 << (tile & 7))) !== 0 ? 1 : 0;
    const ffloor = floor.frame('0');
    const fsky = data.sky.frame(String(roof));
    if (ffloor) ctx.drawImage(floor.img, ffloor.x, ffloor.y, ffloor.w, ffloor.h, ORIGIN_X, FLOOR_Y, ffloor.w, ffloor.h);
    if (fsky) ctx.drawImage(data.sky.img, fsky.x, fsky.y, fsky.w, fsky.h, ORIGIN_X, SKY_Y, fsky.w, fsky.h);

    const grid = new StitchedVisual(data.screens, this.pose_.level);
    const scene = buildIndoorScene(grid, this.pose_.x, this.pose_.y, this.pose_.facing);
    for (const b of scene.blits) {
      const fr = walls.frame(b.frame);
      if (!fr) continue;
      ctx.drawImage(walls.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
    }
    for (const b of scene.torchBlits) {
      const tb = torchBlitFor(b, Math.floor(this.tick / 120) % 3);
      if (!tb) continue;
      const fr = torch.frame(tb.frame);
      if (!fr) continue;
      ctx.drawImage(torch.img, fr.x, fr.y, fr.w, fr.h, tb.x, tb.y, fr.w, fr.h);
    }
  }

  /** Overland: horizon lanes + biome decor bands (outdoor3d.ts port). */
  private renderOutdoor(ctx: CanvasRenderingContext2D): void {
    const data = this.data;
    const grid = new StitchedOutdoor(data.screens, this.pose_.level);
    const scene = buildOutdoorScene(grid, this.pose_.x, this.pose_.y, this.pose_.facing, data.screens);
    for (const b of scene.horizon) {
      const sheet = data.outdoor[b.sheet];
      if (!sheet) continue;
      const fr = sheet.frame(b.frame);
      if (!fr) continue;
      ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
    }
    for (const b of scene.decor) {
      const sheet = data.outdoor[b.sheet];
      if (!sheet) continue;
      const fr = sheet.frame(b.frame);
      if (!fr) continue;
      ctx.drawImage(sheet.img, fr.x, fr.y, fr.w, fr.h, b.x, b.y, fr.w, fr.h);
    }
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    const sc = this.sc();
    if (sc.outdoor) {
      this.drawTerrainMinimap(ctx, sc);
      return;
    }
    this.drawMinimap(ctx);
  }

  /** Overland minimap: draws the outb.32 terrain tile for each cell. */
  private drawTerrainMinimap(ctx: CanvasRenderingContext2D, sc: MmScreen): void {
    const size = 224;
    const cell = size / MAP_GRID;
    const outb = this.data.outdoor.outb;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < MAP_GRID; y++) {
      for (let x = 0; x < MAP_GRID; x++) {
        const tid = sc.visual[y * MAP_GRID + x] & 0x1f;
        const fr = outb.frame(String(tid));
        if (!fr) continue;
        ctx.drawImage(outb.img, fr.x, fr.y, fr.w, fr.h, x * cell, y * cell, cell, cell);
      }
    }
    this.drawPlayerDot(ctx, cell);
  }

  private drawPlayerDot(ctx: CanvasRenderingContext2D, cell: number): void {
    const pose = this.pose_;
    const px = pose.x * cell + cell / 2;
    const py = pose.y * cell + cell / 2;
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, cell / 5), 0, Math.PI * 2);
    ctx.fill();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dy] = dirs[pose.facing & 3];
    ctx.strokeStyle = '#ff3030';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * cell * 0.4, py + dy * cell * 0.4);
    ctx.stroke();
  }
}

/** Cached data accessors used by the harness's level list. */
export const mmLevelLists = {
  mm1: () => loadMm1().then((d) => d.screens.map((s) => ({ id: s.index, label: s.label }))),
  mm2: () => loadMm2().then((d) => d.screens.map((s) => ({ id: s.index, label: s.label }))),
};

export async function loadMM1View(_assetBase: string, levelId: number, startPose: Pose | null): Promise<MM1View> {
  return new MM1View(await loadMm1(), levelId, startPose);
}

export async function loadMM2View(_assetBase: string, levelId: number, startPose: Pose | null): Promise<MM2View> {
  return new MM2View(await loadMm2(), levelId, startPose);
}

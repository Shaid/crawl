/**
 * SSI Gold Box family walker view (`GameView` for the shared harness,
 * `tools/walker/walker.ts`) — Pool of Radiance, Curse of the Azure Bonds,
 * Secret of the Silver Blades, Pools of Darkness (all Amiga).
 *
 * Maze CONNECTIVITY is CONFIRMED end-to-end (2026-08-31, `re-oracle`
 * escalation against the actual DOS Curse of the Azure Bonds decompilation —
 * see `tools/shared/goldbox-geo.ts`'s module doc for the full source
 * citation): `goldbox-geo.ts` decodes each title's `geo.dax`/`GEO.GLB` into
 * a 16x16 per-level grid of per-direction wall TYPES (planes 0/1, 0-15) and
 * door/passability CODES (plane 3, 0=solid/1=passable/2,3=locked door).
 * `isBlocked(cell,dir)` implements the confirmed collision rule (blocked
 * only if a wall is drawn AND its code is solid). Movement in this view is
 * built directly on that data.
 *
 * Wall ART selection is now RESOLVED per-cell for levels whose ECL script
 * statically names its wallset-slot bindings (`tools/shared/goldbox-ecl.ts`
 * decodes each level's own "LOAD PIECES" bytecode — see that module's doc
 * for the full VM writeup and per-title coverage). `wallTextureForCell`
 * below does the real resolution: `resolveWallFlatId` (goldbox-geo.ts)
 * turns a cell's wall type into a flat WALLDEF piece id via this level's
 * `wallsetBinding`, then `resolveFlatWalldefId` (goldbox-walltiles.ts)
 * turns that into a real WALLDEF entry id + wallset-within-entry, from
 * which the exact `(id, wallNumber)` texture is looked up in
 * `dungeon/wall-index.json`. This resolves well for Curse of the Azure
 * Bonds and Secret of the Silver Blades; Pool of Radiance (an earlier,
 * structurally different engine revision) and Pools of Darkness (whose
 * own LOAD PIECES operands are consistently runtime-computed, not
 * literal) do not statically resolve — for those, and for any cell whose
 * resolution fails for any other reason (no binding, flat id not found in
 * this title's own WALLDEF directory), this view falls back to the same
 * **single representative wall texture per level** it always used
 * (deterministically chosen from `dungeon/wall-index.json`) — a real,
 * render-confirmed Gold Box wall texture in the right *place*, just not
 * proven to be the *specific* texture the original game would draw there.
 * Locked doors (code 2/3) render with a distinct tint/colour from solid
 * walls but are treated as passable by the walker (no key/lock-and-key
 * mechanic implemented).
 *
 * Like MM1/MM2 (`games-mm.ts`), this view draws the whole main canvas
 * itself via `renderCanvas` (bypassing the DrawItem composite path — Gold
 * Box wall art is full-colour once painted through the confirmed 8x8-tile
 * palette-less greyscale renderer) and its own minimap via `renderMinimap`.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import type { GeoLevel, GeoCell, Direction } from '../shared/goldbox-geo.ts';
import { isBlocked, isDoor, hasWall, resolveWallFlatId } from '../shared/goldbox-geo.ts';
import { resolveFlatWalldefId, SLICES_PER_WALLSET, type FlatWalldefEntry } from '../shared/goldbox-walltiles.ts';

// ──────────────────────────────────────────────────────────────────────────
// Asset loading
// ──────────────────────────────────────────────────────────────────────────

interface WallTextureEntry {
  id: number;
  wallNumber: number;
  name: string;
}

interface GoldBoxData {
  levels: GeoLevel[];
  walls: WallTextureEntry[];
  /** One entry per distinct WALLDEF id in `walls`, `wallsetCount` re-derived from the max `wallNumber` seen for that id — see `resolveFlatWalldefId`'s doc. */
  flatEntries: FlatWalldefEntry[];
  assetBase: string;
}

const dataCache = new Map<string, Promise<GoldBoxData>>();

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** Re-derive each WALLDEF id's `wallsetCount` from the rendered wall-index (rather than re-reading WALLDEF.GLB/dax directly, which the browser walker has no access to) — the highest `wallNumber` seen for an id is `wallsetCount*SLICES_PER_WALLSET - 1` at most (some slices may be missing from the index if they failed to render, so this is a lower bound, but matches every real corpus case checked). */
function deriveFlatWalldefEntries(walls: WallTextureEntry[]): FlatWalldefEntry[] {
  const maxWallNumber = new Map<number, number>();
  for (const w of walls) {
    const prev = maxWallNumber.get(w.id) ?? -1;
    if (w.wallNumber > prev) maxWallNumber.set(w.id, w.wallNumber);
  }
  return [...maxWallNumber.entries()]
    .map(([id, maxN]) => ({ id, wallsetCount: Math.ceil((maxN + 1) / SLICES_PER_WALLSET) }))
    .sort((a, b) => a.id - b.id);
}

function loadGoldBoxData(assetBase: string): Promise<GoldBoxData> {
  const existing = dataCache.get(assetBase);
  if (existing) return existing;
  const promise = (async () => {
    const index = await fetchJSON<{ levels: Array<{ id: number; file: string }> }>(`${assetBase}/dungeon/levels-index.json`);
    const levels = await Promise.all(index.levels.map((l) => fetchJSON<GeoLevel>(`${assetBase}/${l.file}`)));
    const wallIndex = await fetchJSON<{ walls: WallTextureEntry[] }>(`${assetBase}/dungeon/wall-index.json`);
    return { levels, walls: wallIndex.walls, flatEntries: deriveFlatWalldefEntries(wallIndex.walls), assetBase };
  })();
  dataCache.set(assetBase, promise);
  return promise;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImageCached(src: string): HTMLImageElement {
  const existing = imageCache.get(src);
  if (existing) return existing;
  const img = new Image();
  img.src = src;
  imageCache.set(src, img);
  return img;
}

// ──────────────────────────────────────────────────────────────────────────
// Grid helpers
// ──────────────────────────────────────────────────────────────────────────

function cellAt(level: GeoLevel, x: number, y: number): GeoCell | undefined {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return undefined;
  return level.cells[y * level.width + x];
}

/** facing: 0=N (y-1), 1=E (x+1), 2=S (y+1), 3=W (x-1) — matches goldbox-geo.ts's confirmed N/E/S/W bit assignment. */
const FACING_DELTA: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** A deterministic, guaranteed-walkable start tile: prefers a cell with an unblocked side and an unblocked neighbour (a corridor view), like the other games' entrance-pose helpers. */
export function goldboxEntrancePose(level: GeoLevel): Pose {
  const isOpenish = (c: GeoCell | undefined) =>
    !!c && ([0, 1, 2, 3] as Direction[]).some((d) => !isBlocked(c, d));
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const c = cellAt(level, x, y);
      if (!c) continue;
      for (let f = 0; f < 4; f++) {
        const dir = f as Direction;
        if (isBlocked(c, dir)) continue;
        const [dx, dy] = FACING_DELTA[f];
        if (isOpenish(cellAt(level, x + dx, y + dy))) return { level: level.id, x, y, facing: f as Pose['facing'] };
      }
    }
  }
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      if (isOpenish(cellAt(level, x, y))) return { level: level.id, x, y, facing: 0 };
    }
  }
  return { level: level.id, x: 0, y: 0, facing: 0 };
}

export function goldboxCanStep(level: GeoLevel, x: number, y: number, facing: number): boolean {
  const c = cellAt(level, x, y);
  if (!c) return false;
  return !isBlocked(c, facing as Direction);
}

// ──────────────────────────────────────────────────────────────────────────
// GameView
// ──────────────────────────────────────────────────────────────────────────

const STEP_COOLDOWN_MS = 175;
const CANVAS_W = 320;
const CANVAS_H = 200;

export class GoldBoxView implements GameView {
  readonly id: string;
  readonly gameLabel: string;
  readonly automap: undefined = undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  private readonly data: GoldBoxData;
  private readonly levelsById: Map<number, GeoLevel>;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;
  /** One (id,wallNumber) texture per level, chosen deterministically from that level's id — see module doc's "wall ART not confirmed" note. */
  private readonly wallTextureByLevel = new Map<number, WallTextureEntry | undefined>();

  constructor(id: string, gameLabel: string, data: GoldBoxData, startLevel: number, startPose: Pose | null) {
    this.id = id;
    this.gameLabel = gameLabel;
    this.data = data;
    this.levelsById = new Map(data.levels.map((l) => [l.id, l]));
    const level = this.levelsById.get(startLevel) ?? data.levels[0];
    this.pose_ = startPose ?? goldboxEntrancePose(level);
  }

  private level(): GeoLevel {
    return this.levelsById.get(this.pose_.level) ?? this.data.levels[0];
  }

  private wallTextureFor(level: GeoLevel): WallTextureEntry | undefined {
    if (!this.wallTextureByLevel.has(level.id)) {
      const walls = this.data.walls;
      this.wallTextureByLevel.set(level.id, walls.length ? walls[level.id % walls.length] : undefined);
    }
    return this.wallTextureByLevel.get(level.id);
  }

  /**
   * Real per-cell wall texture, when this level's ECL-resolved
   * `wallsetBinding` statically names the relevant slot (see module doc)
   * — falls back to `wallTextureFor`'s single per-level placeholder
   * otherwise (no binding, dynamic slot, or a flat id this title's own
   * WALLDEF directory doesn't cover, e.g. a `0x7f`/`0xff` sentinel).
   */
  private wallTextureForCell(level: GeoLevel, cell: GeoCell, dir: Direction): WallTextureEntry | undefined {
    const resolved = resolveWallFlatId(cell, dir, level.wallsetBinding);
    if (resolved) {
      const entry = resolveFlatWalldefId(this.data.flatEntries, resolved.flatId);
      if (entry) {
        const wallNumber = entry.wallsetIndex * SLICES_PER_WALLSET + resolved.slice;
        const tex = this.data.walls.find((w) => w.id === entry.baseId && w.wallNumber === wallNumber);
        if (tex) return tex;
      }
    }
    return this.wallTextureFor(level);
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return `Map ${this.pose_.level}`;
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
    let { x, y, facing } = this.pose_;
    const levelId = this.pose_.level;
    let changed = false;

    const turn =
      keys.isDown('KeyQ') || keys.isDown('ArrowLeft') ? -1 : keys.isDown('KeyE') || keys.isDown('ArrowRight') ? 1 : 0;
    if (turn !== 0 && this.stepCooldown <= 0) {
      facing = ((facing + turn + 4) & 3) as Pose['facing'];
      this.stepCooldown = STEP_COOLDOWN_MS;
      changed = true;
    }

    const fwd = keys.isDown('KeyW') || keys.isDown('ArrowUp');
    const back = keys.isDown('KeyS') || keys.isDown('ArrowDown');
    const dir = fwd ? facing : back ? ((facing + 2) & 3) : -1;
    if (dir >= 0 && this.stepCooldown <= 0) {
      const level = this.level();
      if (this.noclip || goldboxCanStep(level, x, y, dir)) {
        const [dx, dy] = FACING_DELTA[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (this.noclip || cellAt(level, nx, ny)) {
          x = nx;
          y = ny;
          this.stepCooldown = STEP_COOLDOWN_MS;
          changed = true;
        }
      }
    }

    if (!changed) return null;
    this.pose_ = { level: levelId, x, y, facing };
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
    // No hotspots/picking in this view.
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.canvas.width = CANVAS_W;
    ctx.canvas.height = CANVAS_H;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // sky/ceiling band
    ctx.fillStyle = '#1c1c28';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H / 2);
    // floor band
    ctx.fillStyle = '#141018';
    ctx.fillRect(0, CANVAS_H / 2, CANVAS_W, CANVAS_H / 2);

    const level = this.level();
    const cell = cellAt(level, this.pose_.x, this.pose_.y);
    if (!cell) return;
    const facing = this.pose_.facing as Direction;
    const front = hasWall(cell, facing);
    const frontIsDoor = isDoor(cell, facing);
    const leftDir = ((this.pose_.facing + 3) & 3) as Direction;
    const rightDir = ((this.pose_.facing + 1) & 3) as Direction;

    // Side hints: a plain tinted strip where a side has a wall drawn (no
    // per-side texture confirmed — see module doc). Doors get a lighter
    // tint than plain walls so they read as distinct.
    const sideColor = (dir: Direction) => (!hasWall(cell, dir) ? undefined : isDoor(cell, dir) ? '#4a4030' : '#241f28');
    const leftColor = sideColor(leftDir);
    if (leftColor) {
      ctx.fillStyle = leftColor;
      ctx.fillRect(0, CANVAS_H * 0.18, CANVAS_W * 0.22, CANVAS_H * 0.64);
    }
    const rightColor = sideColor(rightDir);
    if (rightColor) {
      ctx.fillStyle = rightColor;
      ctx.fillRect(CANVAS_W * 0.78, CANVAS_H * 0.18, CANVAS_W * 0.22, CANVAS_H * 0.64);
    }

    // Front wall: the real per-cell WALLDEF texture where this level's ECL
    // bindings resolve it, else the level's placeholder texture (see
    // wallTextureForCell's doc) — scaled up and centred, whenever the
    // confirmed grid says a wall is drawn on this side (regardless of
    // door/passability code).
    if (front) {
      const tex = this.wallTextureForCell(level, cell, facing);
      if (tex) {
        const img = loadImageCached(`${this.data.assetBase}/${tex.name}.png`);
        if (img.complete && img.naturalWidth > 0) {
          const scale = 3;
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, (CANVAS_W - w) / 2, CANVAS_H / 2 - h + 20, w, h);
        }
      } else {
        // No rendered wall texture at all for this title yet — a flat
        // placeholder still communicates "wall here" honestly.
        ctx.fillStyle = frontIsDoor ? '#5a4c34' : '#302838';
        ctx.fillRect(CANVAS_W * 0.28, CANVAS_H * 0.22, CANVAS_W * 0.44, CANVAS_H * 0.56);
      }
    }
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    const level = this.level();
    const size = 224;
    ctx.canvas.width = size;
    ctx.canvas.height = size;
    const gridSize = level.width;
    const cellPx = size / gridSize;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    const wallW = Math.max(1, Math.floor(cellPx / 5));
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const c = cellAt(level, x, y);
        if (!c) continue;
        const px = x * cellPx;
        // north-up: row y drawn from the top directly (facing N = -y, matching FACING_DELTA).
        const py = y * cellPx;
        const colorFor = (dir: Direction) => (!hasWall(c, dir) ? undefined : isDoor(c, dir) ? '#c0a860' : '#c8c8d0');
        const nc = colorFor(0);
        if (nc) {
          ctx.fillStyle = nc;
          ctx.fillRect(px, py, cellPx, wallW);
        }
        const sc = colorFor(2);
        if (sc) {
          ctx.fillStyle = sc;
          ctx.fillRect(px, py + cellPx - wallW, cellPx, wallW);
        }
        const wc = colorFor(3);
        if (wc) {
          ctx.fillStyle = wc;
          ctx.fillRect(px, py, wallW, cellPx);
        }
        const ec = colorFor(1);
        if (ec) {
          ctx.fillStyle = ec;
          ctx.fillRect(px + cellPx - wallW, py, wallW, cellPx);
        }
      }
    }
    const px = this.pose_.x * cellPx + cellPx / 2;
    const py = this.pose_.y * cellPx + cellPx / 2;
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, cellPx / 5), 0, Math.PI * 2);
    ctx.fill();
    const [dx, dy] = FACING_DELTA[this.pose_.facing];
    ctx.strokeStyle = '#ff3030';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * cellPx * 0.4, py + dy * cellPx * 0.4);
    ctx.stroke();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-title loaders (all four share the exact same view/decoder — only the
// game id/label and asset base differ)
// ──────────────────────────────────────────────────────────────────────────

async function loadGoldBoxView(
  id: string,
  gameLabel: string,
  assetBase: string,
  levelId: number,
  startPose: Pose | null,
): Promise<GoldBoxView> {
  const data = await loadGoldBoxData(assetBase);
  return new GoldBoxView(id, gameLabel, data, levelId, startPose);
}

export async function loadPoolOfRadianceView(assetBase: string, levelId: number, startPose: Pose | null): Promise<GoldBoxView> {
  return loadGoldBoxView('poolofradiance', 'Pool of Radiance', assetBase, levelId, startPose);
}
export async function loadCurseOfTheAzureBondsView(assetBase: string, levelId: number, startPose: Pose | null): Promise<GoldBoxView> {
  return loadGoldBoxView('curseoftheazurebonds', 'Curse of the Azure Bonds', assetBase, levelId, startPose);
}
export async function loadSecretOfTheSilverBladesView(assetBase: string, levelId: number, startPose: Pose | null): Promise<GoldBoxView> {
  return loadGoldBoxView('secretofthesilverblades', 'Secret of the Silver Blades', assetBase, levelId, startPose);
}
export async function loadPoolsOfDarknessView(assetBase: string, levelId: number, startPose: Pose | null): Promise<GoldBoxView> {
  return loadGoldBoxView('poolsofdarkness', 'Pools of Darkness', assetBase, levelId, startPose);
}

/**
 * Cached level lists for the harness's game dropdown — same shape as
 * `mmLevelLists` in `games-mm.ts`. Not strictly required (the harness's
 * generic `listLevels` fallback already reads `dungeon/levels-index.json`
 * directly), kept for parity/consistency with the other per-family loader
 * modules and in case a caller wants labels without going through the full
 * `GameView` load.
 */
export const goldboxLevelLists = {
  poolofradiance: (assetBase: string) =>
    loadGoldBoxData(assetBase).then((d) => d.levels.map((l) => ({ id: l.id, label: `Map ${l.id}` }))),
  curseoftheazurebonds: (assetBase: string) =>
    loadGoldBoxData(assetBase).then((d) => d.levels.map((l) => ({ id: l.id, label: `Map ${l.id}` }))),
  secretofthesilverblades: (assetBase: string) =>
    loadGoldBoxData(assetBase).then((d) => d.levels.map((l) => ({ id: l.id, label: `Map ${l.id}` }))),
  poolsofdarkness: (assetBase: string) =>
    loadGoldBoxData(assetBase).then((d) => d.levels.map((l) => ({ id: l.id, label: `Map ${l.id}` }))),
};

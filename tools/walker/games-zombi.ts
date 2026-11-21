/**
 * Zombi (Ubi Soft, 1990, Amiga) walker view — a `renderCanvas`-only `GameView`.
 *
 * Renderer shape: ONE pre-drawn 160x80 picture per location (LIEUX.SEQ), shown
 * inside the real 320x200 UI frame (SCREEN.SEQ). There is no per-depth view and
 * no facing in the game: movement is four screen-edge arrow buttons.
 *
 * Confirmed from the executable (docs/zombi/amiga/data-structure.md
 * § "Movement and compass (confirmed from code)"):
 *   - picture position: the picture is blitted at screen (8 + frame.x, 48 + frame.y)
 *     by `+0x299E` (call `+0x0A94`); the 176x80 view window it sits in is at (0, 48);
 *   - the four arrow click rectangles (`A4+0x4C0`) and what they call: left ->
 *     move(1), right -> move(0), top -> move(3), bottom -> move(2) (`+0x7486`,
 *     `+0x6254`), i.e. top = row-1 = exit byte 2, right = col+1 = byte 1,
 *     bottom = row+1 = byte 0, left = col-1 = byte 3;
 *   - a blocked top/bottom exit falls back to the stairs: top -> floor+1 (byte 5),
 *     bottom -> floor-1 (byte 4);
 *   - the party starts in location 62 (the helicopter, roof) — `+0x0980`.
 *
 * Still hypothesis (labelled in the confidence note): the compass NAMES (we call
 * the top arrow "N"; the game never prints one), the 0xFE/0xFA/0xF0/0x1E special
 * exits' real effects, the shared-palette detail (this view draws each image with
 * its own baked palette; only index 0 differs), and any object/zombie overlay
 * (none drawn).
 *
 * Pose: x = grid column, y = grid row (row 0 at the top), level = floor 0..5,
 * facing = the last arrow taken (0 N/top, 1 E/right, 2 S/bottom, 3 W/left;
 * display only — the game has no facing).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { ARROWS, cellAt, moveArrow, moveVertical, type Arrow, type MoveOutcome, type ZombiMap } from '../zombi/amiga/map.ts';

const STEP_COOLDOWN_MS = 175;
export const SCREEN_W = 320;
export const SCREEN_H = 200;
/** The 160x80 location picture's blit origin (confirmed, `+0x299E` called with x=8, y=0x30). */
export const PICTURE_X = 8;
export const PICTURE_Y = 48;

/** Click rectangles of the four arrow buttons (`A4+0x4C0` entries 1..4): [x0, y0, x1, y1], inclusive. */
export const ARROW_RECTS: Record<Arrow, [number, number, number, number]> = {
  left: [0, 75, 7, 101],
  right: [168, 75, 175, 101],
  top: [75, 40, 101, 47],
  bottom: [75, 128, 101, 135],
};

export const START_LOCATION_ID = 62;

interface AtlasFrame { name: string; x: number; y: number; w: number; h: number }
export interface ZombiImages { screen: CanvasImageSource; lieux: CanvasImageSource }

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`image ${url}`));
    img.src = url;
  });
}

export function zombiLevelList(map: ZombiMap): Array<{ id: number; label: string }> {
  return map.levels.map((l) => ({ id: l.id, label: `Floor ${l.id}: ${l.name}` }));
}

/** Location whose cell is the party start (id 62), as a pose. */
export function startPose(map: ZombiMap, id = START_LOCATION_ID): Pose {
  for (const l of map.levels) {
    const i = l.cells.findIndex((c) => c?.id === id);
    if (i >= 0) return { level: l.id, x: i % l.width, y: Math.floor(i / l.width), facing: 0 };
  }
  return { level: 0, x: 0, y: 0, facing: 0 };
}

export function describeOutcome(o: MoveOutcome): string | null {
  if (o.ok) return null;
  const v = `0x${o.value.toString(16).toUpperCase().padStart(2, '0')}`;
  if (o.reason === 'edge') return `exit ${v}: the game triggers event 5 here (zombie-horde picture) — not walkable in this viewer`;
  if (o.reason === 'special') return `exit ${v}: special exit (location 46 only) — not implemented`;
  if (o.reason === 'no-cell') return 'no location there';
  return `blocked (exit ${v})`;
}

export class ZombiView implements GameView {
  readonly id = 'zombi';
  readonly gameLabel = 'Zombi';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[] = [];

  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private pendingPose: Pose | null = null;
  private levelChange: Pose | null = null;
  private message: string | null = null;

  readonly map: ZombiMap;
  private readonly atlas: AtlasFrame[];
  private readonly images: ZombiImages | null;

  constructor(map: ZombiMap, atlas: AtlasFrame[], images: ZombiImages | null, start: Pose) {
    this.map = map;
    this.atlas = atlas;
    this.images = images;
    this.pose_ = start;
  }

  get levelId(): number { return this.pose_.level; }
  get levelLabel(): string { const l = this.map.levels[this.pose_.level]; return `Floor ${l.id}: ${l.name}`; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }

  /** Location id under the party. */
  get locationId(): number { return cellAt(this.map, this.pose_)?.id ?? 0; }

  /** Apply an arrow move (shared by keys and clicks). Returns the new pose or null. */
  stepArrow(arrow: Arrow): Pose | null {
    return this.applyOutcome(moveArrow(this.map, this.pose_, arrow, this.noclip), arrow);
  }
  stepVertical(dir: 'up' | 'down'): Pose | null {
    return this.applyOutcome(moveVertical(this.map, this.pose_, dir, false, this.noclip), null);
  }

  private applyOutcome(o: MoveOutcome, arrow: Arrow | null): Pose | null {
    if (!o.ok) { this.message = describeOutcome(o); return null; }
    const facing = (arrow ? ARROWS.indexOf(arrow) : this.pose_.facing) as Pose['facing'];
    const next: Pose = { level: o.to.level, x: o.to.x, y: o.to.y, facing };
    if (next.level !== this.pose_.level) this.levelChange = next;
    this.pose_ = next;
    this.message = o.fellBackVertical ? `${o.via === 'up' ? 'up' : 'down'} the stairs/shaft (exit blocked, vertical fallback as in the game)` : null;
    return next;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.pendingPose) { const p = this.pendingPose; this.pendingPose = null; return p; }
    if (this.cooldown > 0) return null;
    const down = (...codes: string[]) => codes.some((c) => keys.isDown(c));
    let p: Pose | null = null;
    let tried = true;
    if (down('KeyW', 'ArrowUp')) p = this.stepArrow('top');
    else if (down('KeyS', 'ArrowDown')) p = this.stepArrow('bottom');
    else if (down('KeyA', 'ArrowLeft')) p = this.stepArrow('left');
    else if (down('KeyD', 'ArrowRight')) p = this.stepArrow('right');
    else if (down('KeyR', 'PageUp')) p = this.stepVertical('up');
    else if (down('KeyF', 'PageDown')) p = this.stepVertical('down');
    else tried = false;
    if (tried) this.cooldown = STEP_COOLDOWN_MS;
    return p;
  }

  takeLevelChange(): Pose | null { const l = this.levelChange; this.levelChange = null; return l; }
  takeMessage(): string | null { const m = this.message; this.message = null; return m; }
  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }

  /** Click on the canvas (320x200 coordinates): the four arrow rectangles do what the game's click dispatcher does. */
  pick(x: number, y: number): void {
    for (const a of ARROWS) {
      const [x0, y0, x1, y1] = ARROW_RECTS[a];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const p = this.stepArrow(a);
        if (p) this.pendingPose = p;
        return;
      }
    }
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.canvas.width = SCREEN_W;
    ctx.canvas.height = SCREEN_H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    if (!this.images) return;
    ctx.drawImage(this.images.screen, 0, 0);
    const cell = cellAt(this.map, this.pose_);
    if (!cell) return;
    const f = this.atlas[cell.picture.frame];
    if (!f) return;
    ctx.drawImage(this.images.lieux, f.x, f.y, f.w, f.h, PICTURE_X + cell.picture.ox, PICTURE_Y + cell.picture.oy, f.w, f.h);
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    const lv = this.map.levels[this.pose_.level];
    const size = 224;
    const cs = size / Math.max(lv.width, lv.height);
    ctx.canvas.width = size;
    ctx.canvas.height = size;
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < lv.height; y++) {
      for (let x = 0; x < lv.width; x++) {
        const c = lv.cells[y * lv.width + x];
        if (!c) continue;
        const px = x * cs;
        const py = y * cs;
        ctx.fillStyle = '#2c3248';
        ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);
        ctx.fillStyle = '#c8c8d0';
        const t = Math.max(2, cs / 9);
        const wall = (k: string) => c.faces[k as 'n'].raw !== 0 && c.faces[k as 'n'].raw !== 0x14;
        if (wall('n')) ctx.fillRect(px, py, cs, t);
        if (wall('s')) ctx.fillRect(px, py + cs - t, cs, t);
        if (wall('w')) ctx.fillRect(px, py, t, cs);
        if (wall('e')) ctx.fillRect(px + cs - t, py, t, cs);
        ctx.fillStyle = '#7ad';
        if (c.faces.up.raw === 0) ctx.fillRect(px + cs * 0.3, py + cs * 0.3, cs * 0.15, cs * 0.15);
        if (c.faces.down.raw === 0) ctx.fillRect(px + cs * 0.55, py + cs * 0.55, cs * 0.15, cs * 0.15);
      }
    }
    ctx.fillStyle = '#e44';
    const { x, y } = this.pose_;
    ctx.beginPath();
    ctx.arc((x + 0.5) * cs, (y + 0.5) * cs, cs * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

let cached: { map: ZombiMap; atlas: AtlasFrame[]; images: ZombiImages } | null = null;

export async function loadZombiView(assetBase: string, levelId: number, start: Pose | null): Promise<ZombiView> {
  if (!cached) {
    const [map, atlas, screen, lieux] = await Promise.all([
      fetchJSON<ZombiMap>(`${assetBase}/data/map.json`),
      fetchJSON<{ frames: AtlasFrame[] }>(`${assetBase}/sprites/lieux.json`),
      loadImage(`${assetBase}/screens/screen.png`),
      loadImage(`${assetBase}/sprites/lieux.png`),
    ]);
    cached = { map, atlas: atlas.frames, images: { screen, lieux } };
  }
  const { map, atlas, images } = cached;
  // Level 5 is where the party starts (helicopter); any other level starts at its first cell.
  let pose = start;
  if (!pose) {
    const sp = startPose(map);
    if (levelId === sp.level) pose = sp;
    else {
      const lv = map.levels[levelId] ?? map.levels[0];
      const i = lv.cells.findIndex(Boolean);
      pose = { level: lv.id, x: i % lv.width, y: Math.floor(i / lv.width), facing: 0 };
    }
  }
  return new ZombiView(map, atlas, images, pose);
}

export async function zombiLevelListFromAssets(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const map = cached?.map ?? (await fetchJSON<ZombiMap>(`${assetBase}/data/map.json`));
  return zombiLevelList(map);
}

/**
 * Dungeon Master II: Skullkeep (Amiga) `GameView`.
 *
 * Map + collision + door toggling + teleporter travel are from the real
 * `DUNGEON.DAT`. The first-person image is composed from GRAPHICS.DAT by
 * tools/dungeonmaster2/amiga/viewport.ts following SKUL.FTL's own view code
 * (floor/ceiling, walls, door panels; per-map wallset, 16-colour IRGB palette).
 * Not drawn yet: door frames, stairs, pits, ornaments, sky, items, creatures
 * (docs/dungeonmaster2/TODO.md `dm2-viewport-objects`). The flat-colour
 * raycast (render.ts) is only a fallback when viewport.json is missing.
 *
 * Controls: W/Up forward, S/Down back, A/D strafe, Q/E or Left/Right turn,
 * F open/close the door ahead. Level id = map index (44 maps).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  DoorStates, DX, DY, SQ, doorPassable, fallbackPose, sqType, tryStep, type Dm2Bundle, type Dm2Map, type Pose4,
} from '../dungeonmaster2/amiga/model.ts';
import { renderPlaceholder, VIEW_W, VIEW_H } from '../dungeonmaster2/amiga/render.ts';
import { renderViewport, type ViewportAsset } from '../dungeonmaster2/amiga/viewport.ts';

const STEP_COOLDOWN_MS = 175;

const bundles = new Map<string, Promise<Dm2Bundle>>();
const viewports = new Map<string, Promise<ViewportAsset | null>>();

function loadViewport(assetBase: string): Promise<ViewportAsset | null> {
  let p = viewports.get(assetBase);
  if (!p) {
    p = fetch(`${assetBase}/data/viewport.json`).then((r) => (r.ok ? (r.json() as Promise<ViewportAsset>) : null)).catch(() => null);
    viewports.set(assetBase, p);
  }
  return p;
}
const doorStatesByBase = new Map<string, DoorStates>();

function loadBundle(assetBase: string): Promise<Dm2Bundle> {
  let p = bundles.get(assetBase);
  if (!p) {
    p = fetch(`${assetBase}/data/walker-maps.json`).then((r) => {
      if (!r.ok) throw new Error(`GET walker-maps.json -> ${r.status}`);
      return r.json() as Promise<Dm2Bundle>;
    });
    bundles.set(assetBase, p);
  }
  return p;
}

export async function dungeonMaster2LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const b = await loadBundle(assetBase);
  return b.maps.map((m) => ({ id: m.index, label: `Map ${m.index} (level ${m.level}, ${m.width}x${m.height}, style ${m.mapGraphicsStyle})` }));
}

export class DungeonMaster2View implements GameView {
  readonly id = 'dungeonmaster2';
  readonly gameLabel = 'Dungeon Master II: Skullkeep';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  readonly palette: RGBAColor[] = [];

  private tick = 0;
  private cooldown = 0;
  private noclip = false;
  private pendingLevel: Pose | null = null;
  private message: string | null = null;
  private prevDown = new Set<string>();

  private readonly maps: Dm2Map[];
  private readonly doors: DoorStates;
  private pose4: Pose4;

  private readonly viewport: ViewportAsset | null;

  constructor(maps: Dm2Map[], doors: DoorStates, pose4: Pose4, viewport: ViewportAsset | null = null) {
    this.maps = maps;
    this.doors = doors;
    this.pose4 = pose4;
    this.viewport = viewport;
  }

  private get map(): Dm2Map {
    return this.maps.find((m) => m.index === this.pose4.mapIndex)!;
  }
  get levelId(): number { return this.pose4.mapIndex; }
  get levelLabel(): string {
    const real = this.viewport?.wallsets[this.map.mapGraphicsStyle];
    return `Map ${this.map.index} (level ${this.map.level}, wallset ${this.map.mapGraphicsStyle})${real ? '' : ' [placeholder walls]'}`;
  }
  get pose(): Pose { return { level: this.pose4.mapIndex, x: this.pose4.x, y: this.pose4.y, facing: this.pose4.facing as Pose['facing'] }; }
  get currentTick(): number { return this.tick; }

  takeLevelChange(): Pose | null { const p = this.pendingLevel; this.pendingLevel = null; return p; }
  takeMessage(): string | null { const m = this.message; this.message = null; return m; }

  /** Cell index of the door square directly ahead (any door state), else null. */
  doorAhead(): number | null {
    const m = this.map;
    const nx = this.pose4.x + DX[this.pose4.facing]!;
    const ny = this.pose4.y + DY[this.pose4.facing]!;
    if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) return null;
    const cell = ny * m.width + nx;
    return sqType(m.raw[cell]!) === SQ.DOOR ? cell : null;
  }

  toggleDoorAhead(): boolean {
    const cell = this.doorAhead();
    if (cell === null) return false;
    const st = this.doors.get(this.map, cell);
    this.doors.set(this.map, cell, doorPassable(st) ? 4 : 0);
    this.tick++;
    return true;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    const pressed = (k: string) => {
      const was = this.prevDown.has(k);
      const now = keys.isDown(k);
      if (now) this.prevDown.add(k); else this.prevDown.delete(k);
      return now && !was;
    };
    if (pressed('KeyF')) {
      if (!this.toggleDoorAhead()) this.message = 'No door ahead.';
      return this.pose;
    }
    if (this.cooldown > 0) return null;
    const down = (...c: string[]) => c.some((k) => keys.isDown(k));
    const f = this.pose4.facing;
    let turn = 0;
    if (down('KeyQ', 'ArrowLeft')) turn = -1;
    else if (down('KeyE', 'ArrowRight')) turn = 1;
    if (turn) {
      this.pose4 = { ...this.pose4, facing: (f + turn + 4) & 3 };
      this.cooldown = STEP_COOLDOWN_MS;
      return this.pose;
    }
    let dir = -1;
    if (down('KeyW', 'ArrowUp')) dir = f;
    else if (down('KeyS', 'ArrowDown')) dir = (f + 2) & 3;
    else if (down('KeyD')) dir = (f + 1) & 3;
    else if (down('KeyA')) dir = (f + 3) & 3;
    if (dir < 0) return null;
    const out = tryStep(this.map, this.doors, this.pose4, dir, this.noclip);
    this.cooldown = STEP_COOLDOWN_MS;
    if (out.message) this.message = out.message;
    if (!out.moved) return null;
    const changed = out.pose.mapIndex !== this.pose4.mapIndex;
    this.pose4 = out.pose;
    if (changed) this.pendingLevel = this.pose;
    return this.pose;
  }

  setPose(pose: Pose): void { this.pose4 = { mapIndex: pose.level, x: pose.x, y: pose.y, facing: pose.facing }; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots: sensors/buttons not parsed */ }

  renderRGBA(): Uint8ClampedArray {
    const real = this.viewport ? renderViewport(this.viewport, this.map, this.pose4, undefined, this.doors) : null;
    return real ?? renderPlaceholder(this.map, this.doors, this.pose4);
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    img.data.set(this.renderRGBA());
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadDungeonMaster2View(assetBase: string, levelId: number, startPose: Pose | null): Promise<DungeonMaster2View> {
  const [b, vp] = await Promise.all([loadBundle(assetBase), loadViewport(assetBase)]);
  let ds = doorStatesByBase.get(assetBase);
  if (!ds) doorStatesByBase.set(assetBase, (ds = new DoorStates()));
  const m = b.maps.find((x) => x.index === levelId) ?? b.maps[0]!;
  const pose: Pose4 = startPose
    ? { mapIndex: startPose.level, x: startPose.x, y: startPose.y, facing: startPose.facing }
    : b.start.mapIndex === m.index ? { ...b.start } : fallbackPose(m, ds);
  return new DungeonMaster2View(b.maps, ds, pose, vp);
}

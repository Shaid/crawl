/**
 * Dungeon Master / Chaos Strikes Back (Amiga) `GameView`.
 *
 * Draws through `GameView.renderCanvas` with the 224x136 viewport compositor
 * (`tools/dungeonmaster/amiga/viewport.ts`, written from the game's own
 * `KAOS.FTL` view code and the `Graphics.DAT` item-696 zone layout) and the
 * per-cell face model (`tools/dungeonmaster/amiga/model.ts`, the game's step
 * and stairs rules). Level id = map index.
 *
 * Controls: W/Up forward, S/Down back, A/D strafe, Q/E or Left/Right turn,
 * F open/close the door ahead, L cycle the six light-level palettes (`KAOS.FTL`).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  DmViewport, loadGfx, paletteRgb, VIEWPORT_W, VIEWPORT_H, type WalkerGfxJson, type DmGfx,
} from '../dungeonmaster/amiga/viewport.ts';
import {
  DmLevelView, DoorStates, tryStep, faceOf, FACE, effectiveType, SQ, type DmMapData, type Pose4,
} from '../dungeonmaster/amiga/model.ts';

const STEP_COOLDOWN_MS = 175;
const DOOR_FRAME_MS = 110;

interface MapsJson {
  start: { mapIndex: number; x: number; y: number; facing: number };
  maps: DmMapData[];
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const bundles = new Map<string, Promise<{ gfx: WalkerGfxJson; maps: MapsJson }>>();
const doorStatesByBase = new Map<string, DoorStates>();

function loadBundle(assetBase: string) {
  let p = bundles.get(assetBase);
  if (!p) {
    p = Promise.all([
      fetchJSON<WalkerGfxJson>(`${assetBase}/data/walker-gfx.json`),
      fetchJSON<MapsJson>(`${assetBase}/data/walker-maps.json`),
    ]).then(([gfx, maps]) => ({ gfx, maps }));
    bundles.set(assetBase, p);
  }
  return p;
}

export async function dungeonMasterLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const { maps } = await loadBundle(assetBase);
  return maps.maps.map((m) => ({ id: m.index, label: `Map ${m.index} (dungeon level ${m.level}, ${m.width}x${m.height})` }));
}

/** First open walkable corridor cell, deterministic fallback when a map has no start. */
function fallbackPose(m: DmMapData): Pose4 {
  for (let i = 0; i < m.raw.length; i++) {
    if (effectiveType(m.raw[i]!) !== SQ.CORRIDOR) continue;
    for (let d = 0; d < 4; d++) {
      if (faceOf(m.faces[i]!, d) === FACE.OPEN) return { mapIndex: m.index, x: i % m.width, y: Math.floor(i / m.width), facing: d };
    }
  }
  return { mapIndex: m.index, x: 0, y: 0, facing: 0 };
}

export class DungeonMasterView implements GameView {
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;

  private pose4: Pose4;
  private tick = 0;
  private cooldown = 0;
  private noclip = false;
  private light = 0;
  private pendingLevel: Pose | null = null;
  private message: string | null = null;
  private doorAnim: { cell: number; target: number; t: number } | null = null;
  private readonly vp: DmViewport;
  private readonly palettes: RGBAColor[][];

  readonly id: string;
  readonly gameLabel: string;
  private readonly maps: DmMapData[];
  private readonly doorStates: DoorStates;
  private prevDown = new Set<string>();

  constructor(id: string, gameLabel: string, maps: DmMapData[], gfx: DmGfx, palettes: number[][], doorStates: DoorStates, pose: Pose4) {
    this.id = id;
    this.gameLabel = gameLabel;
    this.maps = maps;
    this.doorStates = doorStates;
    this.pose4 = pose;
    this.vp = new DmViewport(gfx);
    this.palettes = palettes.map((p) => paletteRgb(p).map((c) => ({ ...c, a: 255 })));
  }

  private get map(): DmMapData {
    return this.maps.find((m) => m.index === this.pose4.mapIndex)!;
  }
  get levelId(): number {
    return this.pose4.mapIndex;
  }
  get levelLabel(): string {
    return `Map ${this.map.index} (dungeon level ${this.map.level})`;
  }
  get pose(): Pose {
    return { level: this.pose4.mapIndex, x: this.pose4.x, y: this.pose4.y, facing: this.pose4.facing as Pose['facing'] };
  }
  get currentTick(): number {
    return this.tick;
  }
  get palette(): RGBAColor[] {
    return this.palettes[this.light]!;
  }

  takeLevelChange(): Pose | null {
    const p = this.pendingLevel;
    this.pendingLevel = null;
    return p;
  }
  takeMessage(): string | null {
    const m = this.message;
    this.message = null;
    return m;
  }

  private doorAhead(): number | null {
    const m = this.map;
    const d = this.pose4.facing;
    const nx = this.pose4.x + [0, 1, 0, -1][d]!;
    const ny = this.pose4.y + [-1, 0, 1, 0][d]!;
    if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) return null;
    const cell = ny * m.width + nx;
    return effectiveType(m.raw[cell]!) === SQ.DOOR && faceOf(m.faces[this.pose4.y * m.width + this.pose4.x]!, d) === FACE.DOOR ? cell : null;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.doorAnim) {
      this.doorAnim.t -= dtMs;
      if (this.doorAnim.t <= 0) {
        const cur = this.doorStates.get(this.map, this.doorAnim.cell);
        const next = cur + Math.sign(this.doorAnim.target - cur);
        this.doorStates.set(this.map, this.doorAnim.cell, next);
        this.doorAnim = next === this.doorAnim.target ? null : { ...this.doorAnim, t: DOOR_FRAME_MS };
        this.tick += 1; // dirty
      }
    }
    const pressed = (k: string) => {
      const was = this.prevDown.has(k);
      const now = keys.isDown(k);
      if (now) this.prevDown.add(k);
      else this.prevDown.delete(k);
      return now && !was;
    };
    const pL = pressed('KeyL');
    const pF = pressed('KeyF');
    if (this.cooldown > 0) return null;
    const f = this.pose4.facing;
    const down = (...c: string[]) => c.some((k) => keys.isDown(k));
    if (pL) {
      this.light = (this.light + 1) % this.palettes.length;
      this.message = `Light level palette ${this.light} of 6 (KAOS.FTL dungeon-view table)`;
      return this.pose;
    }
    if (pF) {
      const cell = this.doorAhead();
      if (cell === null) this.message = 'No door ahead.';
      else if (!this.doorAnim) {
        const st = this.doorStates.get(this.map, cell);
        this.doorAnim = { cell, target: st === 0 ? 4 : 0, t: DOOR_FRAME_MS };
      }
      return this.pose;
    }
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
    const out = tryStep(this.maps, this.doorStates, this.pose4, dir, this.noclip);
    this.cooldown = STEP_COOLDOWN_MS;
    if (out.message) this.message = out.message;
    if (!out.moved) return null;
    if (out.pose.mapIndex !== this.pose4.mapIndex) {
      this.pendingLevel = { level: out.pose.mapIndex, x: out.pose.x, y: out.pose.y, facing: out.pose.facing as Pose['facing'] };
      this.pose4 = out.pose;
      return this.pose;
    }
    this.pose4 = out.pose;
    return this.pose;
  }

  setPose(pose: Pose): void {
    this.pose4 = { mapIndex: pose.level, x: pose.x, y: pose.y, facing: pose.facing };
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
    // no hotspots yet (sensors/buttons not parsed)
  }

  /** Palette-index frame of the current pose (also used by tests). */
  renderIndexed(): Uint8Array {
    const v = new DmLevelView(this.map, this.maps, this.doorStates);
    return this.vp.render(v, this.pose4.x, this.pose4.y, this.pose4.facing);
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const buf = this.renderIndexed();
    const pal = this.palette;
    const img = ctx.createImageData(VIEWPORT_W, VIEWPORT_H);
    for (let i = 0; i < buf.length; i++) {
      const c = pal[buf[i]!] ?? { r: 0, g: 0, b: 0, a: 255 };
      img.data[i * 4] = c.r;
      img.data[i * 4 + 1] = c.g;
      img.data[i * 4 + 2] = c.b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEWPORT_W;
    ctx.canvas.height = VIEWPORT_H;
    ctx.putImageData(img, 0, 0);
  }
}

async function load(
  id: string,
  label: string,
  assetBase: string,
  levelId: number,
  startPose: Pose | null,
): Promise<DungeonMasterView> {
  const { gfx, maps } = await loadBundle(assetBase);
  let ds = doorStatesByBase.get(assetBase);
  if (!ds) doorStatesByBase.set(assetBase, (ds = new DoorStates()));
  const m = maps.maps.find((x) => x.index === levelId) ?? maps.maps[0]!;
  const pose: Pose4 = startPose
    ? { mapIndex: startPose.level, x: startPose.x, y: startPose.y, facing: startPose.facing }
    : maps.start.mapIndex === m.index
      ? { ...maps.start }
      : fallbackPose(m);
  return new DungeonMasterView(id, label, maps.maps, loadGfx(gfx), gfx.palettes, ds, pose);
}

export const loadDungeonMasterView = (assetBase: string, levelId: number, startPose: Pose | null) =>
  load('dungeonmaster', 'Dungeon Master', assetBase, levelId, startPose);
export const loadChaosStrikesBackView = (assetBase: string, levelId: number, startPose: Pose | null) =>
  load('chaosstrikesback', 'Chaos Strikes Back', assetBase, levelId, startPose);

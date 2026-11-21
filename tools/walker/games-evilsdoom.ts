/**
 * Evil's Doom (Amiga AGA) `GameView`: renders through `tools/evilsdoom/amigaaga/view-model.ts`
 * (368x274 indexed view, the game's own wall-slot table / emit order / step mirroring) via
 * `renderCanvas`. Level ids are dungeon*10 + level (0x Lost Legions, 1x Belcoon, 2x Mine,
 * 3x Mythil, 4x Wisdom). Confidence: map/collision/wall placement/palette are read from the
 * per-dungeon module + save-slot state (see the module doc); doors are walkable and not drawn,
 * decorations/objects/monsters are not drawn, stairs are not followed, start poses other than the
 * saved one are a heuristic.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView, stepPose, mirrorArt, mirrorPhase, paletteRGB, VIEW_W, VIEW_H,
  type Art, type EdLevel, type Facing, type Op, type Slot,
} from '../evilsdoom/amigaaga/view-model.ts';

const STEP_COOLDOWN_MS = 175;

interface DungeonJson {
  index: number; tag: string; name: string; wal: string; palette: number[]; slots: Slot[];
  levels: Array<{ id: number; level: number; grid: string; start: { x: number; y: number; facing: number; source: string } }>;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class EvilsDoomView implements GameView {
  readonly id = 'evilsdoom';
  readonly gameLabel = "Evil's Doom";
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private readonly palette_: RGBAColor[];
  private readonly origin: { x: number; y: number; facing: number };

  private readonly dungeonName: string;
  private readonly levelNo: number;
  private readonly id_: number;
  private readonly level: EdLevel;
  private readonly wallSlots: Slot[];
  private readonly art: Art;

  constructor(
    dungeonName: string, levelNo: number, id: number, level: EdLevel, wallSlots: Slot[], art: Art,
    paletteWords: number[], start: { x: number; y: number; facing: number }, pose: Pose | null,
  ) {
    this.dungeonName = dungeonName;
    this.levelNo = levelNo;
    this.id_ = id;
    this.level = level;
    this.wallSlots = wallSlots;
    this.art = art;
    this.palette_ = paletteRGB(paletteWords).map(([r, g, b]) => ({ r, g, b, a: 255 }));
    this.origin = start;
    this.pose_ = pose ?? { level: id, x: start.x, y: start.y, facing: (start.facing & 3) as Facing };
  }
  get levelId(): number { return this.id_; }
  get levelLabel(): string { return `${this.dungeonName} ${this.levelNo + 1}`; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }
  get palette(): RGBAColor[] { return this.palette_; }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    const d = (...c: string[]) => c.some((k) => keys.isDown(k));
    const op: Op | null = d('KeyQ', 'ArrowLeft') ? 'turnL' : d('KeyE', 'ArrowRight') ? 'turnR'
      : d('KeyW', 'ArrowUp') ? 'fwd' : d('KeyS', 'ArrowDown') ? 'back' : d('KeyA') ? 'left' : d('KeyD') ? 'right' : null;
    if (!op) return null;
    const next = stepPose(this.level, { x: this.pose_.x, y: this.pose_.y, facing: this.pose_.facing as Facing }, op, this.noclip);
    if (!next) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.id_, ...next };
    return this.pose_;
  }
  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots */ }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const { x, y } = this.pose_;
    const f = this.pose_.facing as Facing;
    const px = renderView(this.level, this.wallSlots, this.art, x, y, f, mirrorPhase(x, y, f, this.origin));
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    for (let i = 0; i < px.length; i++) {
      const c = this.palette_[px[i]];
      img.data[i * 4] = c.r; img.data[i * 4 + 1] = c.g; img.data[i * 4 + 2] = c.b; img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadEvilsDoomView(assetBase: string, levelId: number, startPose: Pose | null): Promise<EvilsDoomView> {
  const dungeons = await fetchJSON<DungeonJson[]>(`${assetBase}/walker/dungeons.json`);
  const dn = dungeons.find((d) => d.levels.some((l) => l.id === levelId)) ?? dungeons[0];
  const lv = dn.levels.find((l) => l.id === levelId) ?? dn.levels[0];
  const artJ = await fetchJSON<{ data: string }>(`${assetBase}/walker/art/${dn.wal}.json`);
  const normal = fromB64(artJ.data);
  const art: Art = { normal, mirror: mirrorArt(normal, dn.slots) };
  const pose = startPose && startPose.level === lv.id ? startPose : null;
  return new EvilsDoomView(dn.name, lv.level, lv.id, { grid: fromB64(lv.grid) }, dn.slots, art, dn.palette, lv.start, pose);
}

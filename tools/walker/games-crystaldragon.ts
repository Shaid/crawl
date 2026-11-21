/**
 * Crystal Dragon (Amiga) `GameView`: renders through the port of the game's first-person view in
 * `tools/crystaldragon/amiga/view-model.ts` (146x116 indexed view) via `renderCanvas`.
 * One walker "level" = one area (region) of one of the 23 level files; areas are separate sub-maps
 * selected by id (+0xC1C6) that share the level's absolute x/y frame.
 * Confidence: SA/SF codecs (86/86 sets byte-exact vs the executable's own `Unpack` run in an
 * emulator), slot tables, view-cell layout, facings, face variants, step parity and palette are read
 * from `Crystal_Dragon` (spec docs/crystaldragon/amiga/data-structure.md). Hypotheses: painter
 * order instead of the game's occlusion masks; open/blocked cell types; start pose; nothing is drawn
 * beyond row 3. NOT drawn: doors/door frames, stairs, teleports, barriers, wall decorations
 * (PASTEONS/LOCKS), monsters, items; stairs/teleports are not followed.
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import {
  renderView, canEnter, paletteRGB, FWD, LEFT, TURN_L, TURN_R, VIEW_W, VIEW_H,
  type CdArea, type CdSlots, type CdFacing,
} from '../crystaldragon/amiga/view-model.ts';
import type { SlotTable } from '../crystaldragon/amiga/sets.ts';

const STEP_COOLDOWN_MS = 175;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

interface AreaJson { id: number; x0: number; y0: number; w: number; h: number; cells: string; start: { x: number; y: number; facing: number } }
interface LevelJson { level: number; file: string; slots: Array<{ set: number; remap: boolean } | null>; areas: AreaJson[] }
interface SetJson { table: SlotTable; frames: Array<{ w: number; h: number; stride: number; px: string }> }

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
/** cells were written as a host-endian Uint16Array (little-endian on every supported host) */
export function decodeArea(a: AreaJson): CdArea {
  const b = fromB64(a.cells);
  const cells: number[] = [];
  for (let i = 0; i + 1 < b.length; i += 2) cells.push(b[i]! | (b[i + 1]! << 8));
  return { id: a.id, x0: a.x0, y0: a.y0, w: a.w, h: a.h, cells };
}
const setFile = (id: number) => (id >= 0x100 ? '1' : '') + (id & 0xff).toString(16).padStart(2, '0');

/** Walker level ids: flattened (level file, area) pairs in file order. */
export function flattenAreas(levels: LevelJson[]): Array<{ id: number; level: number; area: number; label: string }> {
  const out: Array<{ id: number; level: number; area: number; label: string }> = [];
  for (const lv of levels) lv.areas.forEach((a, i) => out.push({ id: out.length, level: lv.level, area: i, label: `Level ${lv.level + 1} (${lv.file}), area ${a.id}` }));
  return out;
}

export async function crystalDragonLevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const levels = await fetchJSON<LevelJson[]>(`${assetBase}/walker/levels.json`);
  return flattenAreas(levels).map(({ id, label }) => ({ id, label }));
}

export type Op = 'fwd' | 'back' | 'left' | 'right' | 'turnL' | 'turnR';
export interface CdPose { x: number; y: number; facing: CdFacing }

/** seer Pose facing (0 N, 1 E, 2 S, 3 W) <-> game facing (0 N, 1 S, 2 E, 3 W); self-inverse. */
export const toGameFacing = (f: number): CdFacing => ([0, 2, 1, 3] as const)[f & 3]!;
export const toSeerFacing = (f: CdFacing): Pose['facing'] => ([0, 2, 1, 3] as const)[f] as Pose['facing'];

/** Pure movement step, shared with the tests. Returns the new pose or null when blocked. */
export function stepPose(area: CdArea, pose: CdPose, op: Op, noclip = false): CdPose | null {
  const { x, y, facing } = pose;
  if (op === 'turnL') return { x, y, facing: TURN_L[facing]! };
  if (op === 'turnR') return { x, y, facing: TURN_R[facing]! };
  const [fx, fy] = FWD[facing]!, [lx, ly] = LEFT[facing]!;
  const [dx, dy] = op === 'fwd' ? [fx, fy] : op === 'back' ? [-fx, -fy] : op === 'left' ? [lx, ly] : [-lx, -ly];
  const nx = x + dx, ny = y + dy;
  const inside = nx >= area.x0 && ny >= area.y0 && nx < area.x0 + area.w && ny < area.y0 + area.h;
  if (noclip ? !inside : !canEnter(area, nx, ny)) return null;
  return { x: nx, y: ny, facing };
}

export class CrystalDragonView implements GameView {
  readonly id = 'crystaldragon';
  readonly gameLabel = 'Crystal Dragon';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;

  private readonly walkerLevel: number;
  private readonly label: string;
  private readonly area: CdArea;
  private readonly cdSlots: CdSlots;
  private readonly palette_: RGBAColor[];

  constructor(walkerLevel: number, label: string, area: CdArea, cdSlots: CdSlots, palette: RGBAColor[], start: Pose) {
    this.walkerLevel = walkerLevel;
    this.label = label;
    this.area = area;
    this.cdSlots = cdSlots;
    this.palette_ = palette;
    this.pose_ = start;
  }
  get levelId(): number { return this.walkerLevel; }
  get levelLabel(): string { return this.label; }
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
    const cur: CdPose = { x: this.pose_.x, y: this.pose_.y, facing: toGameFacing(this.pose_.facing) };
    const next = stepPose(this.area, cur, op, this.noclip);
    if (!next) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.walkerLevel, x: next.x, y: next.y, facing: toSeerFacing(next.facing) };
    return this.pose_;
  }
  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots */ }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const px = renderView(this.area, this.cdSlots, this.pose_.x, this.pose_.y, toGameFacing(this.pose_.facing));
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    for (let i = 0; i < px.length; i++) {
      const c = this.palette_[px[i]!] ?? { r: 255, g: 0, b: 255, a: 255 };
      img.data[i * 4] = c.r; img.data[i * 4 + 1] = c.g; img.data[i * 4 + 2] = c.b; img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(img, 0, 0);
  }
}

export async function loadCrystalDragonView(assetBase: string, levelId: number, startPose: Pose | null): Promise<CrystalDragonView> {
  const w = `${assetBase}/walker`;
  const [levels, pal] = await Promise.all([fetchJSON<LevelJson[]>(`${w}/levels.json`), fetchJSON<{ words: number[] }>(`${w}/palette.json`)]);
  const flat = flattenAreas(levels);
  const entry = flat[levelId] ?? flat[0]!;
  const lv = levels.find((l) => l.level === entry.level)!;
  const aj = lv.areas[entry.area]!;
  const slots: CdSlots = await Promise.all(lv.slots.map(async (s) => {
    if (!s) return null;
    const j = await fetchJSON<SetJson>(`${w}/sets/${setFile(s.set)}.json`);
    return { remap: s.remap, table: j.table, frames: j.frames.map((f) => ({ w: f.w, h: f.h, stride: f.stride, px: fromB64(f.px) })) };
  }));
  const palette = paletteRGB(pal.words).map(([r, g, b]) => ({ r, g, b, a: 255 }));
  const start: Pose = startPose ?? { level: entry.id, x: aj.start.x, y: aj.start.y, facing: toSeerFacing(aj.start.facing as CdFacing) };
  return new CrystalDragonView(entry.id, entry.label, decodeArea(aj), slots, palette, start);
}

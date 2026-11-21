/**
 * Eye of the Beholder III (DOS/VGA) `GameView`.
 *
 * The first-person view is the game's own AESOP/16 bytecode: `tools/eotb3/
 * engine.ts` runs the `dungeon`/`features`/`doors`/... class objects through
 * `tools/aesop/vm.ts` and composites the resulting `draw_bitmap` list into
 * the 176x120 view window. Wall/decoration art placement is therefore the
 * game's, not ours; collision uses the game's own `dungeon.impedance`
 * handler (kernel `step`: result < 0 blocks) and the step_X/step_Y signed-byte
 * offset table read from the game's own INTERP.EXE (see DX/DY below). See
 * docs/eotb3/dosvga/data-structure.md section 10.
 *
 * Confidence: walls, floor/ceiling, decorations, doors (closed/initial state
 * from the shipped SAVEGAME quick-start party) = game bytecode (high; frame
 * structure verified headlessly, pixel parity not checkable here). Monsters
 * and floor items are NOT drawn yet (see TODO eotb3-walker-monsters-items);
 * stairs/teleport level changes, door opening and levers are not wired
 * (eotb3-walker-interaction).
 */
import type { KeyStateLike, Pose, DrawItem, RGBAColor, PieceBankLookup } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { Eotb3Engine, VIEW_W, VIEW_H, type WalkerPack } from '../eotb3/engine.ts';

const STEP_COOLDOWN_MS = 175;
// DX/DY[mtype-1][fdir]; mtype 2=forward 4=strafe left 5=back 6=strafe right.
// Derived from the game: INTERP.EXE (DOS/4GW LE) natives step_X (obj1 vaddr
// 0x17890) and step_Y (0x17930) compute (v + table[(mtype<<2)+fdir]*dist) & 31
// from one signed-byte table at vaddr 0x31196 (file+0x25596; Y indexes the same
// table 0x18 bytes on, 0x311ae). Rows are 4 bytes (fdir N,E,S,W), dist = 1.
// Checked from bytes by scripts/verify_eotb3_step_tables.py.
const DX = [[0, 0, 0, 0], [0, 1, 0, -1], [0, 0, 0, 0], [-1, 0, 1, 0], [0, -1, 0, 1], [1, 0, -1, 0]];
const DY = [[0, 0, 0, 0], [-1, 0, 1, 0], [0, 0, 0, 0], [0, -1, 0, 1], [1, 0, -1, 0], [0, 1, 0, -1]];

/** Quick-start party position shipped in SAVEGAME/ITEMS.TMP +252..255 (x,y,facing,level). */
export const QUICK_START: Pose = { level: 3, x: 7, y: 24, facing: 1 };

let packPromise: Promise<WalkerPack> | null = null;

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function loadWalkerPack(assetBase: string): Promise<WalkerPack> {
  packPromise ??= (async () => {
    const base = `${assetBase}/data/walker`;
    const [classes, levels, palettes, vfxIndex, bin] = await Promise.all([
      fetchJSON<{ classes: WalkerPack['classes'] }>(`${base}/aesop-classes.json`),
      fetchJSON<{ levels: WalkerPack['levels'] }>(`${base}/levels.json`),
      fetchJSON<WalkerPack['palettes']>(`${base}/palettes.json`),
      fetchJSON<WalkerPack['vfxIndex']>(`${base}/vfx-index.json`),
      fetch(`${base}/vfx.bin`).then((r) => r.arrayBuffer()),
    ]);
    return { classes: classes.classes, levels: levels.levels, palettes, vfxIndex, vfx: new Uint8Array(bin) };
  })();
  return packPromise;
}

export async function eotb3LevelList(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const pack = await loadWalkerPack(assetBase);
  return pack.levels.map((l) => ({ id: l.level, label: `Level ${l.level} (${l.name})` }));
}

/** First open cell with an open neighbour, scanning low->high; deterministic. */
export function entrancePose(engine: Eotb3Engine, level: number): Pose {
  const d: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (!engine.isOpen(x, y)) continue;
      for (let f = 0; f < 4; f++) {
        if (engine.isOpen(x + d[f]![0], y + d[f]![1])) return { level, x, y, facing: f as Pose['facing'] };
      }
    }
  }
  return { level, x: 0, y: 0, facing: 0 };
}

/** The kernel `step` rule: new coordinate via step_X/step_Y, then dungeon.impedance < 0 blocks. */
export function tryStep(engine: Eotb3Engine, x: number, y: number, facing: number, mtype: 2 | 4 | 5 | 6): { x: number; y: number; ok: boolean } {
  const nx = (x + DX[mtype - 1]![facing]!) & 31;
  const ny = (y + DY[mtype - 1]![facing]!) & 31;
  const imp = engine.impedance(nx, ny);
  return { x: nx, y: ny, ok: imp >= 0 };
}

export class Eotb3View implements GameView {
  readonly id = 'eotb3';
  readonly gameLabel = 'Eye of the Beholder III';
  readonly items: DrawItem[] = [];
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;
  readonly automap = undefined;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private cooldown = 0;
  private img: ImageData | null = null;
  private lastKey = '';

  private readonly engine: Eotb3Engine;
  private readonly name: string;
  constructor(engine: Eotb3Engine, name: string, start: Pose) {
    this.engine = engine;
    this.name = name;
    this.pose_ = start;
  }

  get levelId(): number { return this.pose_.level; }
  get levelLabel(): string { return `Level ${this.pose_.level} (${this.name})`; }
  get pose(): Pose { return this.pose_; }
  get currentTick(): number { return this.tick; }
  get palette(): RGBAColor[] {
    return Array.from({ length: 256 }, (_, i) => { const [r, g, b] = this.engine.rgb(i); return { r, g, b, a: 255 }; });
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.cooldown = Math.max(0, this.cooldown - dtMs);
    if (this.cooldown > 0) return null;
    let { x, y, facing } = this.pose_;
    let changed = false;
    const turn = keys.isDown('KeyQ') || keys.isDown('ArrowLeft') ? -1 : keys.isDown('KeyE') || keys.isDown('ArrowRight') ? 1 : 0;
    if (turn) { facing = ((facing + turn + 4) & 3) as Pose['facing']; changed = true; }
    const mtype = keys.isDown('KeyW') || keys.isDown('ArrowUp') ? 2 : keys.isDown('KeyS') || keys.isDown('ArrowDown') ? 5
      : keys.isDown('KeyA') ? 4 : keys.isDown('KeyD') ? 6 : 0;
    if (!changed && mtype) {
      const r = this.noclip
        ? { x: (x + DX[mtype - 1]![facing]!) & 31, y: (y + DY[mtype - 1]![facing]!) & 31, ok: true }
        : tryStep(this.engine, x, y, facing, mtype as 2 | 4 | 5 | 6);
      if (r.ok) { x = r.x; y = r.y; changed = true; }
    }
    if (!changed) return null;
    this.cooldown = STEP_COOLDOWN_MS;
    this.pose_ = { level: this.pose_.level, x, y, facing };
    return this.pose_;
  }

  setPose(pose: Pose): void { this.pose_ = pose; }
  setNoclip(on: boolean): void { this.noclip = on; }
  interactCodes(): string[] { return []; }
  automapCodes(): string[] { return []; }
  pick(): void { /* no hotspots yet */ }

  /** The composited 176x120 palette-index frame (exposed for tests / frame dumps). */
  frame(): Uint8Array {
    const { x, y, facing } = this.pose_;
    return this.engine.composite(this.engine.drawList(x, y, facing));
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const key = `${this.pose_.x},${this.pose_.y},${this.pose_.facing}`;
    const ix = this.frame();
    this.lastKey = key;
    if (!this.img) this.img = ctx.createImageData(VIEW_W, VIEW_H);
    for (let i = 0; i < ix.length; i++) {
      const [r, g, b] = this.engine.rgb(ix[i]!);
      this.img.data[i * 4] = r; this.img.data[i * 4 + 1] = g; this.img.data[i * 4 + 2] = b; this.img.data[i * 4 + 3] = 255;
    }
    ctx.canvas.width = VIEW_W;
    ctx.canvas.height = VIEW_H;
    ctx.putImageData(this.img, 0, 0);
  }

  debugKey(): string { return this.lastKey; }
}

export async function loadEotb3View(assetBase: string, levelId: number, startPose: Pose | null): Promise<Eotb3View> {
  const pack = await loadWalkerPack(assetBase);
  const engine = new Eotb3Engine(pack);
  engine.loadLevel(levelId);
  const name = pack.levels.find((l) => l.level === levelId)?.name ?? `Level ${levelId}`;
  const start = startPose ?? (levelId === QUICK_START.level ? QUICK_START : entrancePose(engine, levelId));
  return new Eotb3View(engine, name, start);
}

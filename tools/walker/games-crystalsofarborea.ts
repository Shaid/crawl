/**
 * Crystals of Arborea (Silmarils, 1990, Amiga) walker view — `GameView` for
 * the shared walker harness (`tools/walker/walker.ts`).
 *
 * **The 3D view (2026-11-23, measured against the game).** The game's own
 * scene model (`CRYSTALS_TITLE` in `tools/shared/ishar-scene.ts`), run the
 * way the game runs it, traced and measured with the alis oracle
 * (`tools/ishar/oracle/`, `tools/ishar/__tests__/crystals-oracle.test.ts`):
 *
 * - The game reaches the 3D view from the team screen's "3D" button (a new
 *   game: "new game", "new team", six companions defined, "OK
 *   characters"). MAIN then starts the outdoor group (CIELSOL, ARBRE,
 *   NPLAINE, PLAGES, TOUR, PUIT, GEMEEXT, HABITAT) and GUGUS, which moves
 *   the party and wakes the group after every step and turn.
 * - The world is one grid, `INIT.FIC` as MAIN loads it (95 x 57 cells, two
 *   layers: outdoors and caves), with the 30 cells a new game changes.
 *   The party starts at x 30, y 45 facing east (raw facing 2).
 * - Moves are GUGUS's: forward / turn / about-turn / sidestep; cells below
 *   0 block (-5 lets a sidestep through); 48 and 85 are cave mouths that
 *   switch the layer at the same x, y; a wizard's house two cells ahead
 *   swaps PLAGES for GHABITAT.
 * - The palette is NAD's, by the hour (`crystalsPaletteSlot`). The walker's
 *   clock stands still at the start hour; `T` steps the hour.
 *
 * Measured (oracle, scenery walks with the enemy bands removed): 225 actions
 * outdoors and into a cave, every move as the game, 100% of placements,
 * 99.99% of pixels. Not modelled: the enemy bands (ORC_ELF/MORGOT/SHAMNIR
 * draw them, EBRAIN/EMOVE move them, a meeting starts a fight), a wizard's
 * house interior (INTMAIS, opened at the house's door), and the clock.
 *
 * `M` shows the older CARTE roster screen below (`CARTE.CO`'s party
 * checklist, a static reading of its bytecode; the real map screen is
 * reached from the team screen's "map" button and is not modelled).
 *
 * Keys: W/Up forward, A/Left and D/Right turn, S/Down about-turn, Q/E
 * sidestep, T next hour, M roster screen.
 */

import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { compositeIsharView, CRYSTALS_TITLE, crystalsNewGameGrid, IsharGridBuffers, IsharScene, isharSceneScriptNames, type IsharPartyState } from '../shared/ishar-scene.ts';

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface AtlasSidecar {
  frames: AtlasFrame[];
  width: number;
  height: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** The 8 confirmed row labels, in on-disk index order (`docs/crystalsofarborea/amiga/data-structure.md` §3.5). */
const ROW_NAMES = ['JON', 'ZACH', 'IRVAN', 'AKEER', 'OLBAR', 'THORM', 'ALL', 'NONE'] as const;

/**
 * Confirmed values of the two 8-element scratch arrays `CARTE.CO`'s own
 * bytecode initializes (script-vram offsets 0x3c/0x46, `CARTE.bin+42..183`
 * — a real `cscmov` + 15×`cstore` sequence, traced this session with a
 * from-scratch mini ALIS interpreter covering exactly the opcodes/opernames/
 * storenames involved; it self-terminates at byte 183 on an unrecognized
 * top opcode `0x94`, exactly the expected boundary). Index 0 of the 0x3c
 * array is read (by the leading `cscmov`, as its own "z" parameter) but
 * NEVER explicitly written by this block — only indices 1-7 get a `cstore`
 * (7 writes); the 0x46 array gets all 8 indices explicitly written. `null`
 * marks that un-written slot; its runtime value is whatever a `cdim`-
 * declared array defaults to (not independently confirmed, assumed 0).
 * Semantic role (which axis is "selected", which is something else) is
 * HYPOTHESIS — the raw values and the index<->row-name mapping are
 * CONFIRMED (index order matches the 8 confirmed UI strings exactly).
 */
const ARRAY_0X3C: readonly (number | null)[] = [null, 1, 1, 1, 0, -1, -1, -1];
const ARRAY_0X46: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];

const MAP_STRIP_NAMES = ['carte_005', 'carte_006', 'carte_007', 'carte_008', 'carte_009', 'carte_010', 'carte_011'];

/** The new-game start (oracle: the first 3D frame of a new game). */
const START: Pose = { level: 0, x: 30, y: 45, facing: 1 };
/** Inside the cave mouth at (32, 9) (oracle: the step onto it switches the layer at the same x, y). */
const CAVE_START: Pose = { level: 1, x: 32, y: 9, facing: 0 };

/** Scripts the scene can run, plus NAD (the palette owner). */
const SCRIPT_NAMES = [...isharSceneScriptNames(CRYSTALS_TITLE), 'NAD'];

interface CrystalsData {
  /** CARTE's map picture (the roster screen); absent when the sprite export was not run. */
  atlas?: HTMLImageElement;
  frames: Map<string, AtlasFrame>;
  /** The 3D view's assets (`tools/crystalsofarborea/amiga/scripts.ts`); absent when not exported. */
  scene?: { grid: Uint8Array; scripts: Map<string, Uint8Array> };
}

let loadPromise: Promise<CrystalsData> | null = null;

async function tryLoadSceneAssets(base: string): Promise<CrystalsData['scene']> {
  try {
    const initRes = await fetch(`${base}/data/init.bin`);
    if (!initRes.ok) return undefined;
    const grid = crystalsNewGameGrid(new Uint8Array(await initRes.arrayBuffer()));
    const scripts = new Map<string, Uint8Array>();
    await Promise.all(
      SCRIPT_NAMES.map(async (n) => {
        const res = await fetch(`${base}/scripts/${n.toLowerCase()}.bin`);
        if (res.ok) scripts.set(n.toUpperCase(), new Uint8Array(await res.arrayBuffer()));
      }),
    );
    return scripts.size ? { grid, scripts } : undefined;
  } catch {
    return undefined;
  }
}

function loadCrystalsData(): Promise<CrystalsData> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const base = '/assets/crystalsofarborea/amiga';
    let atlas: HTMLImageElement | undefined;
    let frames = new Map<string, AtlasFrame>();
    try {
      const [img, sidecar] = await Promise.all([loadImage(`${base}/sprites/carte.png`), fetch(`${base}/sprites/carte.json`).then((r) => r.json() as Promise<AtlasSidecar>)]);
      atlas = img;
      frames = new Map(sidecar.frames.map((f) => [f.name, f]));
    } catch {
      // the roster screen draws without its map picture
    }
    return { atlas, frames, scene: await tryLoadSceneAssets(base) };
  })();
  return loadPromise;
}

const ROW_HEIGHT = 14;
const ROWS_TOP = 6;
const BUTTON_ROWS = ['MOVE', 'EXIT'];
const NAV_COOLDOWN_MS = 160;
const STEP_COOLDOWN_MS = 180;

const s8 = (v: number) => (v >= 128 ? v - 256 : v);

export class CrystalsOfArboreaView implements GameView {
  readonly id = 'crystalsofarborea';
  readonly gameLabel = 'Crystals of Arborea';
  readonly automap: undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  private readonly data: CrystalsData;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;
  private hour = 1;
  private message = '';
  private readonly keysWereDown = new Set<string>();
  private scene: IsharScene | null = null;
  private buffers: IsharGridBuffers | null = null;
  private frame: { rgba: Uint8Array; placements: number } | null = null;
  private frameCanvas: HTMLCanvasElement | null = null;

  // the CARTE roster screen (M)
  private roster = false;
  /** Per-row checkbox state, seeded from `ARRAY_0X3C` (>0 => checked). */
  private readonly checked: boolean[];
  private focus = 0; // 0..7 = rows, 8 = MOVE, 9 = EXIT
  private navCooldown = 0;
  private lastAction = '';

  constructor(data: CrystalsData, startPose: Pose | null) {
    this.data = data;
    this.checked = ARRAY_0X3C.map((v) => (v ?? 0) > 0);
    this.pose_ = startPose ? { ...startPose } : { ...START };
    this.restartScene();
  }

  private state(pose: Pose = this.pose_): IsharPartyState {
    return { region: pose.level, row: pose.x, col: pose.y, facing: (pose.facing & 3) as 0 | 1 | 2 | 3, globals: { 0x2e97: this.hour } };
  }

  /** The grid cell (signed) at x, y on a layer. */
  private cell(layer: number, x: number, y: number): number {
    const g = this.data.scene?.grid;
    if (!g || x < 0 || y < 0 || x > 94 || y > 56) return -128;
    return s8(g[114 * x + 2 * y + layer] ?? 0);
  }

  /** A new game (or a teleport): MAIN starts the group and GUGUS wakes it once. */
  private restartScene(): void {
    const sc = this.data.scene;
    if (!sc) return;
    const st = this.state();
    this.buffers = new IsharGridBuffers(CRYSTALS_TITLE, () => [sc.grid]);
    this.scene = new IsharScene(CRYSTALS_TITLE, (n) => sc.scripts.get(n.toUpperCase()), this.buffers.update(st));
    this.scene.enter(st);
    this.scene.step(st);
    this.redraw();
  }

  /** One GUGUS action: the scene wakes after every step and turn. */
  private wake(): void {
    if (!this.scene || !this.buffers) return;
    const st = this.state();
    this.scene.setGrids(this.buffers.update(st));
    this.scene.step(st);
    this.redraw();
  }

  private redraw(): void {
    if (!this.scene) return;
    const leaves = this.scene.leaves();
    this.frame = { rgba: compositeIsharView(leaves, CRYSTALS_TITLE.screen, this.scene.palette), placements: leaves.length };
  }

  /**
   * A step in walker direction `dir` (0..3 = raw facing 1..4), as GUGUS
   * `+0x654` tests the target cell: 48/85 switch the layer, below -5 blocks,
   * -5 blocks a forward step only, -1..-4 (crystal gates) block while shut.
   */
  private stepTo(dir: 0 | 1 | 2 | 3, forward: boolean): boolean {
    const from = this.state();
    const to = CRYSTALS_TITLE.stepFrom({ ...from, facing: dir }, dir);
    if (!to) return false;
    const c = this.cell(from.region, to.row, to.col);
    let layer = from.region;
    if (!this.noclip) {
      if (c === 48) layer = 1;
      else if (c === 85) layer = 0;
      else if (c < -5 || (c < 0 && (forward || c !== -5))) {
        this.message = `blocked (cell ${c})`;
        return false;
      }
    }
    this.pose_ = { ...this.pose_, level: layer, x: to.row, y: to.col };
    this.message = layer !== from.region ? (layer === 1 ? 'into the cave' : 'out of the cave') : '';
    return true;
  }

  private pressed(keys: KeyStateLike, ...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) {
      const down = keys.isDown(c);
      if (down && !this.keysWereDown.has(c)) hit = true;
      if (down) this.keysWereDown.add(c);
      else this.keysWereDown.delete(c);
    }
    return hit;
  }

  get levelId(): number {
    return this.pose_.level;
  }
  get levelLabel(): string {
    return this.roster ? 'CARTE — party roster screen' : this.pose_.level === 1 ? 'Arborea, caves (3D)' : 'Arborea, outdoors (3D)';
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

  private toggle(idx: number): void {
    if (idx < 0 || idx >= ROW_NAMES.length) return;
    const name = ROW_NAMES[idx]!;
    if (name === 'ALL') {
      for (let i = 0; i < 6; i++) this.checked[i] = true;
      this.lastAction = 'ALL: every companion selected';
      return;
    }
    if (name === 'NONE') {
      for (let i = 0; i < 6; i++) this.checked[i] = false;
      this.lastAction = 'NONE: every companion deselected';
      return;
    }
    this.checked[idx] = !this.checked[idx];
    this.lastAction = `${name}: ${this.checked[idx] ? 'joins the party' : 'stays behind'}`;
  }

  private activateFocus(): void {
    if (this.focus < ROW_NAMES.length) {
      this.toggle(this.focus);
      return;
    }
    const button = BUTTON_ROWS[this.focus - ROW_NAMES.length];
    // MOVE/EXIT: the real game's `clive` opcode loads-and-runs another
    // script by a literal id here (not decoded — no hotspot/launch-id table
    // was recovered). Nothing to launch, so this just surfaces the finding.
    this.lastAction =
      button === 'MOVE'
        ? 'MOVE: real CARTE.CO launches another script here (clive) — destination not decoded'
        : 'EXIT: closes this screen (not modeled)';
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    if (this.pressed(keys, 'KeyM')) this.roster = !this.roster;
    if (this.roster) return this.updateRoster(dtMs, keys);
    if (this.pressed(keys, 'KeyT')) {
      this.hour = (this.hour % 13) + 1;
      this.scene?.refresh(this.state());
      this.redraw();
    }
    this.stepCooldown = Math.max(0, this.stepCooldown - dtMs);
    if (this.stepCooldown > 0) return null;
    const f = this.pose_.facing & 3;
    let acted = false;
    if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) acted = this.stepTo(f as 0 | 1 | 2 | 3, true);
    else if (keys.isDown('KeyQ')) acted = this.stepTo(((f + 3) & 3) as 0 | 1 | 2 | 3, false);
    else if (keys.isDown('KeyE')) acted = this.stepTo(((f + 1) & 3) as 0 | 1 | 2 | 3, false);
    else if (keys.isDown('KeyA') || keys.isDown('ArrowLeft')) {
      this.pose_ = { ...this.pose_, facing: ((f + 3) & 3) as Pose["facing"] };
      acted = true;
    } else if (keys.isDown('KeyD') || keys.isDown('ArrowRight')) {
      this.pose_ = { ...this.pose_, facing: ((f + 1) & 3) as Pose["facing"] };
      acted = true;
    } else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) {
      // the about-turn is two turns, each one a wake (oracle: raw facing 2 -> 3 -> 4)
      this.pose_ = { ...this.pose_, facing: ((f + 1) & 3) as Pose["facing"] };
      this.wake();
      this.pose_ = { ...this.pose_, facing: ((f + 2) & 3) as Pose["facing"] };
      acted = true;
    } else return null;
    this.stepCooldown = STEP_COOLDOWN_MS;
    if (acted) {
      this.wake();
      return this.pose_;
    }
    return null;
  }

  private updateRoster(dtMs: number, keys: KeyStateLike): Pose | null {
    this.navCooldown = Math.max(0, this.navCooldown - dtMs);
    if (this.navCooldown > 0) return null;
    const totalRows = ROW_NAMES.length + BUTTON_ROWS.length;
    let moved = false;
    if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) {
      this.focus = (this.focus + 1) % totalRows;
      moved = true;
    } else if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) {
      this.focus = (this.focus - 1 + totalRows) % totalRows;
      moved = true;
    } else if (keys.isDown('Space') || keys.isDown('Enter')) {
      this.activateFocus();
      moved = true;
    }
    if (moved) this.navCooldown = NAV_COOLDOWN_MS;
    return null;
  }

  setPose(pose: Pose): void {
    this.pose_ = { ...pose, level: pose.level === 1 ? 1 : 0, x: Math.max(0, Math.min(94, pose.x)), y: Math.max(0, Math.min(56, pose.y)), facing: (pose.facing & 3) as Pose["facing"] };
    this.restartScene();
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

  pick(containerX: number, containerY: number): void {
    if (!this.roster) return;
    const idx = this.rowAt(containerX, containerY);
    if (idx === null) return;
    this.focus = idx;
    if (idx < ROW_NAMES.length) this.toggle(idx);
    else this.activateFocus();
  }

  /** Inverse of `drawRows` — which row (0..7 = names, 8/9 = MOVE/EXIT) contains (x,y), or `null`. */
  private rowAt(x: number, y: number): number | null {
    const listX = 210;
    const listW = 100;
    if (x < listX || x > listX + listW) return null;
    const totalRows = ROW_NAMES.length + BUTTON_ROWS.length;
    for (let i = 0; i < totalRows; i++) {
      const rowY = ROWS_TOP + i * ROW_HEIGHT + (i >= ROW_NAMES.length ? 6 : 0);
      if (y >= rowY && y < rowY + ROW_HEIGHT) return i;
    }
    return null;
  }

  private drawMap(ctx: CanvasRenderingContext2D): void {
    const { atlas, frames } = this.data;
    if (!atlas) return;
    const stripFrames = MAP_STRIP_NAMES.map((n) => frames.get(n)).filter((f): f is AtlasFrame => f !== undefined);
    const totalW = stripFrames.reduce((sum, f) => sum + f.w, 0);
    // Fit into the space left of the checklist column (listX=210), never
    // overlapping it, however the atlas' own strip widths happen to sum.
    const budget = 202;
    const scale = totalW > 0 ? Math.min(1, budget / totalW) : 1;
    let dx = 4;
    for (const f of stripFrames) {
      const w = f.w * scale;
      const h = f.h * scale;
      ctx.drawImage(atlas, f.x, f.y, f.w, f.h, dx, 4, w, h);
      dx += w;
    }
  }

  private drawRows(ctx: CanvasRenderingContext2D): void {
    const listX = 210;
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    ROW_NAMES.forEach((name, i) => {
      const y = ROWS_TOP + i * ROW_HEIGHT;
      const focused = this.focus === i;
      ctx.fillStyle = focused ? '#3a3a1a' : '#111';
      ctx.fillRect(listX, y, 100, ROW_HEIGHT - 2);
      ctx.strokeStyle = '#ffe080';
      ctx.strokeRect(listX + 2, y + 2, 9, 9);
      if (this.checked[i]) {
        ctx.fillStyle = '#ffe080';
        ctx.fillRect(listX + 4, y + 4, 5, 5);
      }
      ctx.fillStyle = focused ? '#fff' : '#ccc';
      ctx.fillText(name, listX + 16, y + 1);
      const secondary = ARRAY_0X46[i]!;
      ctx.fillStyle = '#888';
      ctx.font = '8px monospace';
      ctx.fillText(String(secondary), listX + 84, y + 3);
      ctx.font = '11px monospace';
    });
    BUTTON_ROWS.forEach((label, i) => {
      const idx = ROW_NAMES.length + i;
      const y = ROWS_TOP + idx * ROW_HEIGHT + 6;
      const focused = this.focus === idx;
      ctx.fillStyle = focused ? '#3a3a1a' : '#222';
      ctx.fillRect(listX, y, 100, ROW_HEIGHT - 2);
      ctx.fillStyle = focused ? '#fff' : '#ccc';
      ctx.fillText(label, listX + 16, y + 1);
    });
  }

  private renderView(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!this.frame) {
      ctx.fillStyle = '#ffe080';
      ctx.font = '10px monospace';
      ctx.fillText('3D assets not exported: npx tsx tools/crystalsofarborea/amiga/scripts.ts', 4, 14);
      return;
    }
    const { width: fw, height: fh } = CRYSTALS_TITLE.screen;
    if (!this.frameCanvas) this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = fw;
    this.frameCanvas.height = fh;
    this.frameCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(this.frame.rgba), fw, fh), 0, 0);
    const scale = Math.min(w / fw, (h - 30) / fh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.frameCanvas, (w - fw * scale) / 2, 0, fw * scale, fh * scale);
    ctx.imageSmoothingEnabled = true;
    const facing = ['north', 'east', 'south', 'west'][this.pose_.facing & 3];
    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    ctx.fillText(`x ${this.pose_.x} y ${this.pose_.y} facing ${facing}, hour ${this.hour}${this.pose_.level === 1 ? ', cave' : ''}${this.message ? ` — ${this.message}` : ''}`, 4, h - 18);
    ctx.fillText('W fwd  A/D turn  S about  Q/E sidestep  T hour  M roster', 4, h - 6);
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (!this.roster) {
      this.renderView(ctx, w, h);
      return;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.drawMap(ctx);
    this.drawRows(ctx);
    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    ctx.fillText('CARTE.CO — party roster screen (static reading of its bytecode). M: back to 3D', 4, h - 12);
    if (this.lastAction) {
      ctx.fillStyle = '#a0ffa0';
      ctx.fillText(this.lastAction, 4, h - 24);
    }
  }
}

export async function loadCrystalsOfArboreaView(_assetBase: string, levelId: number, startPose: Pose | null): Promise<CrystalsOfArboreaView> {
  // the caves "level" starts just inside the (32, 9) cave mouth
  return new CrystalsOfArboreaView(await loadCrystalsData(), startPose ?? (levelId === 1 ? CAVE_START : null));
}

export async function crystalsOfArboreaLevelList(): Promise<Array<{ id: number; label: string }>> {
  return [
    { id: 0, label: 'Arborea, outdoors (3D)' },
    { id: 1, label: 'Arborea, caves (3D)' },
  ];
}

/** The harness's `GAMES[].loader` shape. */
export const crystalsOfArboreaLoader: (assetBase: string, levelId: number, startPose: Pose | null) => Promise<GameView> = loadCrystalsOfArboreaView;

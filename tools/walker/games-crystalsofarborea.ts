/**
 * Crystals of Arborea (Silmarils, 1990, Amiga) walker view — `GameView` for
 * the shared walker harness (`tools/walker/walker.ts`).
 *
 * NOT a grid walker and NOT a first-person view. Unlike Ishar 1/2/3 (whose
 * outdoor+indoor world is one big `CONT*.FIC` region grid the party walks
 * step-by-step, see `docs/ishar-container-format.md` §9), Crystals of
 * Arborea has **no `CONT*.FIC` files at all** — confirmed absent from
 * `data/crystalsofarborea/amiga/` (only `INIT.FIC` exists). Its overworld
 * screen, `CARTE.CO` ("map"), is a real, traced ALIS bytecode program (this
 * session's finding, `docs/crystalsofarborea/amiga/data-structure.md` §3.5)
 * that turns out to be a **party-roster/travel checklist UI**, not a
 * destination-graph or tile grid:
 *
 * - `CARTE.CO`'s own script vram declares two 8-element signed-byte scratch
 *   arrays (offsets 0x3c/0x46), initialized by a real `cscmov` + 15×`cstore`
 *   bytecode block that self-terminates exactly at its structural boundary
 *   (CONFIRMED — a boundary-agnostic forward walk of the actual opcode/
 *   opername/storename semantics from `github.com/maestun/alis`).
 * - The 8-index order matches, byte for byte, 8 confirmed UI strings found
 *   later in the same file: `JON ZACH IRVAN AKEER OLBAR THORM ALL NONE`
 *   (a player-character + 5 recruitable companions + select-all/select-none),
 *   immediately followed by `MOVE`/`EXIT` action-button strings (STRUCTURAL
 *   — this reframes the original "8-directional adjacency table" hypothesis
 *   into a party-composition checklist).
 * - A real consumer region later in the same script (STRUCTURAL, traced this
 *   session) implements click-to-toggle hit-testing (`cftstset` sets up a
 *   click-point + "forme" collision test, matching the sprite-format doc's
 *   §1 `adresform()`/"formes" mechanism) and highlight drawing (`cboxf`)
 *   over these 8 rows, with `clive` (load-and-run-another-script-by-id)
 *   firing on confirmation — consistent with `MOVE` launching the actual
 *   travel/exploration script (NOT decoded — no hotspot placement or
 *   per-location launch-id table was recovered).
 *
 * This view renders `CARTE.CO`'s own confirmed map picture (the directory's
 * 7 tallest bitmap slots, shelf-packed side by side — an island/coastline
 * silhouette, greyscale, RENDERED not CONFIRMED colour — see
 * `docs/ishar-sprite-format.md` §5) with the 8 confirmed checklist rows
 * overlaid as keyboard/mouse-togglable checkboxes, seeded from each row's
 * real decoded initial value. It is deliberately NOT a destination-travel
 * graph — that mechanic exists (the `clive` call proves *something* gets
 * launched) but isn't decoded to a confirmable on-screen hotspot layout.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';

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

interface CrystalsData {
  atlas: HTMLImageElement;
  frames: Map<string, AtlasFrame>;
}

let loadPromise: Promise<CrystalsData> | null = null;

function loadCrystalsData(): Promise<CrystalsData> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const base = '/assets/crystalsofarborea/amiga';
    const [atlas, sidecar] = await Promise.all([
      loadImage(`${base}/sprites/carte.png`),
      fetch(`${base}/sprites/carte.json`).then((r) => r.json() as Promise<AtlasSidecar>),
    ]);
    const frames = new Map(sidecar.frames.map((f) => [f.name, f]));
    return { atlas, frames };
  })();
  return loadPromise;
}

const ROW_HEIGHT = 14;
const ROWS_TOP = 6;
const BUTTON_ROWS = ['MOVE', 'EXIT'];
const NAV_COOLDOWN_MS = 160;

export class CrystalsOfArboreaView implements GameView {
  readonly id = 'crystalsofarborea';
  readonly gameLabel = 'Crystals of Arborea';
  readonly automap: undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  private readonly data: CrystalsData;
  /** Per-row checkbox state, seeded from `ARRAY_0X3C` (>0 => checked). Mutable — this is the interactive part of the confirmed toggle mechanism. */
  private readonly checked: boolean[];
  private focus = 0; // 0..7 = rows, 8 = MOVE, 9 = EXIT
  private navCooldown = 0;
  private tick = 0;
  private lastAction = '';
  private readonly pose_: Pose = { level: 0, x: 0, y: 0, facing: 0 };

  constructor(data: CrystalsData) {
    this.data = data;
    this.checked = ARRAY_0X3C.map((v) => (v ?? 0) > 0);
  }

  get levelId(): number {
    return 0;
  }
  get levelLabel(): string {
    return 'CARTE — travel/party roster screen';
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

  setPose(): void {
    // No spatial pose on this screen — kept as a no-op for the GameView contract.
  }
  setNoclip(): void {
    // Not applicable.
  }
  interactCodes(): string[] {
    return [];
  }
  automapCodes(): string[] {
    return [];
  }

  pick(containerX: number, containerY: number): void {
    const idx = this.rowAt(containerX, containerY);
    if (idx === null) return;
    if (idx < ROW_NAMES.length) {
      this.focus = idx;
      this.toggle(idx);
    } else {
      this.focus = idx;
      this.activateFocus();
    }
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

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.drawMap(ctx);
    this.drawRows(ctx);
    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    ctx.fillText('CARTE.CO — party roster/travel screen (RENDERED map, CONFIRMED checklist structure)', 4, h - 24);
    ctx.fillText('W/S or click: navigate. Space/Enter or click: toggle/activate.', 4, h - 12);
    if (this.lastAction) {
      ctx.fillStyle = '#a0ffa0';
      ctx.fillText(this.lastAction, 4, h - 36);
    }
  }
}

/**
 * TypeScript allows a function with fewer parameters to satisfy the shared
 * harness's `(assetBase, levelId, startPose) => Promise<GameView>` loader
 * shape (see `games-ishar.ts`'s `loadIshar1View` etc.) — this screen has no
 * spatial levels or pose, so none of the three are needed here.
 */
export async function loadCrystalsOfArboreaView(): Promise<CrystalsOfArboreaView> {
  const data = await loadCrystalsData();
  return new CrystalsOfArboreaView(data);
}

export async function crystalsOfArboreaLevelList(): Promise<Array<{ id: number; label: string }>> {
  return [{ id: 0, label: 'CARTE — party roster/travel screen' }];
}

/**
 * Pre-shaped to the harness's `GAMES[].loader` field type
 * (`(assetBase, levelId, startPose) => Promise<GameView>`) so the paste-in
 * snippet doesn't need an inline wrapper arrow function; also serves as a
 * static self-check that `loadCrystalsOfArboreaView`'s narrower (zero-arg)
 * signature is really assignable there.
 */
export const crystalsOfArboreaLoader: (
  assetBase: string,
  levelId: number,
  startPose: Pose | null,
) => Promise<GameView> = loadCrystalsOfArboreaView;

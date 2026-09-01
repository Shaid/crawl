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
 *
 * **First-person addition (2026-09-02)**: unlike the rest of this file
 * (which predates the discovery below), Crystals DOES have a real, working
 * first-person scene compositor — the same engine-wide mechanism as Ishar 1
 * (`docs/ishar-container-format.md` §8), just indexing a genuinely different
 * on-disk source: not a `CONT*.FIC` world grid (confirmed absent, see above)
 * but a single `INIT.FIC` file (10,830 B) read via a genuinely N-ary
 * `omaintc(0x7c)` array access (`tools/shared/crystals-firstperson.ts` has
 * the full derivation + verification evidence). `ARBRE.bin` ("tree") is
 * CONFIRMED end-to-end: 4 real party positions/facings all render an
 * unmistakable forest — multiple distinct tree silhouettes, responsive to
 * position and facing. `NPLAINE.bin` ("plain") is also RENDERED, showing a
 * semantically-distinct sparse low-vegetation ground band at the same test
 * position — no tall trees, as expected for a "plain" terrain script.
 *
 * **Two more scripts added (2026-09-02 follow-up)**, by disassembling each
 * script's own `cswitch1` cell-value dispatch and scanning real `INIT.FIC`
 * bytes for matching cells (the same technique used for `RAMPART.bin`/
 * `PLAINE.bin` in the Ishar 1 walker): `PLAGES.bin` ("beaches") RENDERS a
 * rocky/dune coastal terrain (grey rock-texture horizon band + foreground
 * mounds), confirmed at 4 real positions along a dense coastal cell band
 * near the `x=94` map edge. `CAVINT.bin` ("cave interior") RENDERS a dense,
 * mostly-enclosed interior (little open sky, filled with wall/rock texture)
 * — but needs `sceneLayer=1`, not the default 0 every other script uses; see
 * `docs/crystalsofarborea/amiga/data-structure.md` §8's correction block for
 * why (the previous session's "guess sceneLayer=1" attempt produced a blank
 * frame at the WRONG position — the layer guess was actually right, the
 * position wasn't).
 *
 * Toggle with `KeyF` (from the checklist screen); `KeyC` cycles between all
 * four verified scripts; `WASD`/arrows move a synthetic test position across
 * the local scene array's real `95x57` coordinate space (there is no
 * confirmed link between this position and `CARTE.CO`'s own undecoded
 * travel-destination mechanism — this is a manual test-bench, exactly like
 * `games-ishar.ts`'s own `KeyC` location cycling). Note: the default start
 * position (`testX=23,testY=39`, chosen for `ARBRE`'s own dense terrain
 * cluster) is NOT a good starting point for `PLAGES`/`CAVINT` — cycle to
 * one of them and move with `WASD` to find their own real clusters (`PLAGES`
 * is dense along the `x=90-94` edge; `CAVINT`'s room-outline cluster is
 * broad, e.g. around `x=20-60,y=0-50`).
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { renderCrystalsLocationFrame } from '../shared/crystals-firstperson.ts';

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

/** One first-person-renderable location script, verified end-to-end against real `INIT.FIC` data (see module doc). */
interface CrystalsLocation {
  key: string;
  label: string;
  data: Uint8Array;
  /** Forwarded to `renderCrystalsLocationFrame()`'s `sceneLayer` param -- see `LOCATION_SCRIPTS`. */
  sceneLayer?: number;
}

/**
 * `sceneLayer` defaults to 0 (the outdoor/terrain `INIT.FIC` layer) for
 * every script except `CAVINT.bin`, which needs `sceneLayer=1` (the indoor
 * room-outline layer) -- CAVINT's own disassembled cell-value dispatch
 * (`docs/crystalsofarborea/amiga/data-structure.md` §8's correction block)
 * reads the identical default-0 `omainb(0x2b3c)` global as every other
 * script, but its own confirmed cell-value alphabet (`-94..-90`, `-79..-70`,
 * `80..85`) only exists in `INIT.FIC`'s Z=1 sub-array, not Z=0 -- meaning
 * the real game sets this global to 1 somewhere in `CAVINT`'s OWN launch
 * path (outside this one script's bytecode), not a hardcoded constant this
 * script itself carries. Superseded the prior "guess sceneLayer=1, got a
 * blank frame" attempt -- see the doc for the full account.
 */
const LOCATION_SCRIPTS: Array<{ key: string; label: string; sceneLayer?: number }> = [
  { key: 'arbre', label: 'Forest (ARBRE.bin)' },
  { key: 'nplaine', label: 'Plain (NPLAINE.bin)' },
  { key: 'plages', label: 'Beaches (PLAGES.bin)' },
  { key: 'cavint', label: 'Cave interior (CAVINT.bin)', sceneLayer: 1 },
];

interface CrystalsData {
  atlas: HTMLImageElement;
  frames: Map<string, AtlasFrame>;
  /** `undefined` if the export step (`tools/crystalsofarborea/amiga/scripts.ts`, not wired into `npm run`) hasn't been run, or fetch failed for any piece. */
  firstPerson?: { initFic: Uint8Array; locations: CrystalsLocation[] };
}

let loadPromise: Promise<CrystalsData> | null = null;

async function tryLoadFirstPersonAssets(base: string): Promise<{ initFic: Uint8Array; locations: CrystalsLocation[] } | undefined> {
  try {
    const initRes = await fetch(`${base}/data/init.bin`);
    if (!initRes.ok) return undefined;
    const initFic = new Uint8Array(await initRes.arrayBuffer());
    const locations: CrystalsLocation[] = [];
    for (const { key, label, sceneLayer } of LOCATION_SCRIPTS) {
      const res = await fetch(`${base}/scripts/${key}.bin`);
      if (!res.ok) continue;
      locations.push({ key, label, sceneLayer, data: new Uint8Array(await res.arrayBuffer()) });
    }
    if (locations.length === 0) return undefined;
    return { initFic, locations };
  } catch {
    return undefined;
  }
}

function loadCrystalsData(): Promise<CrystalsData> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const base = '/assets/crystalsofarborea/amiga';
    const [atlas, sidecar] = await Promise.all([
      loadImage(`${base}/sprites/carte.png`),
      fetch(`${base}/sprites/carte.json`).then((r) => r.json() as Promise<AtlasSidecar>),
    ]);
    const frames = new Map(sidecar.frames.map((f) => [f.name, f]));
    const firstPerson = await tryLoadFirstPersonAssets(base);
    return { atlas, frames, firstPerson };
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

  // First-person test-bench state (see module doc's 2026-09-02 addition).
  private firstPerson = false;
  private toggleKeyWasDown = false;
  private cycleKeyWasDown = false;
  private locationIndex = 0;
  /** A confirmed dense terrain-feature cluster in `INIT.FIC`'s real bytes (found by scanning for cells in [1,20] at Z=0) — a good starting position for the test-bench, not a decoded "spawn point". */
  private testX = 23;
  private testY = 39;
  private testFacing: 0 | 1 | 2 | 3 = 0;
  private fpStepCooldown = 0;
  private fpCache: { key: string; frame: ReturnType<typeof renderCrystalsLocationFrame> } | null = null;
  private fpCanvas: HTMLCanvasElement | null = null;

  constructor(data: CrystalsData) {
    this.data = data;
    this.checked = ARRAY_0X3C.map((v) => (v ?? 0) > 0);
  }

  get firstPersonAvailable(): boolean {
    return !!this.data.firstPerson;
  }

  private get currentLocation(): CrystalsLocation | undefined {
    const locations = this.data.firstPerson?.locations;
    return locations?.[this.locationIndex % locations.length];
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

    const toggleDown = keys.isDown('KeyF');
    if (toggleDown && !this.toggleKeyWasDown && this.firstPersonAvailable) {
      this.firstPerson = !this.firstPerson;
    }
    this.toggleKeyWasDown = toggleDown;

    if (this.firstPerson && this.firstPersonAvailable) {
      const cycleDown = keys.isDown('KeyC');
      if (cycleDown && !this.cycleKeyWasDown) {
        const count = this.data.firstPerson?.locations.length ?? 1;
        this.locationIndex = (this.locationIndex + 1) % count;
      }
      this.cycleKeyWasDown = cycleDown;

      this.fpStepCooldown = Math.max(0, this.fpStepCooldown - dtMs);
      if (this.fpStepCooldown <= 0) {
        let dx = 0;
        let dy = 0;
        if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) dy = -1;
        else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) dy = 1;
        else if (keys.isDown('KeyA') || keys.isDown('ArrowLeft')) dx = -1;
        else if (keys.isDown('KeyD') || keys.isDown('ArrowRight')) dx = 1;
        if (dx !== 0 || dy !== 0) {
          this.testX = Math.min(94, Math.max(0, this.testX + dx));
          this.testY = Math.min(56, Math.max(0, this.testY + dy));
          this.testFacing = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
          this.fpStepCooldown = NAV_COOLDOWN_MS;
        }
      }
      return null;
    }

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
    if (this.firstPerson) return; // no hotspots in the first-person test-bench view
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

  /**
   * Render one first-person frame (see `tools/shared/crystals-firstperson.ts`)
   * by actually executing the currently-selected location script's (`KeyC`
   * cycles it) bytecode against the real `INIT.FIC` local-scene-array bytes
   * for a synthetic test position (`WASD`/arrows, `testX`/`testY`/
   * `testFacing`). Cached by position/facing/location so it's only
   * recomputed when the test position actually moves.
   */
  private renderFirstPerson(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const firstPerson = this.data.firstPerson!;
    const location = this.currentLocation;
    if (!location) return;
    const key = `${this.testX},${this.testY},${this.testFacing}:${location.key}`;
    if (!this.fpCache || this.fpCache.key !== key) {
      const frame = renderCrystalsLocationFrame({
        location: location.data,
        initFic: firstPerson.initFic,
        partyX: this.testX,
        partyY: this.testY,
        facing: this.testFacing,
        sceneLayer: location.sceneLayer,
      });
      this.fpCache = { key, frame };
    }

    const frame = this.fpCache.frame;
    if (!this.fpCanvas) this.fpCanvas = document.createElement('canvas');
    this.fpCanvas.width = frame.width;
    this.fpCanvas.height = frame.height;
    const fctx = this.fpCanvas.getContext('2d')!;
    fctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(w / frame.width, h / frame.height);
    const dw = frame.width * scale;
    const dh = frame.height * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.fpCanvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    ctx.fillText(
      `first-person: ${location.label} @ (${this.testX},${this.testY}) — RENDERED (real ALIS bytecode execution, placeholder sky/ground colour, no real palette)`,
      4,
      12,
    );
    ctx.fillText('F: back to CARTE.CO.  C: cycle location script.  WASD/arrows: move test position (not a decoded spawn/travel mechanic).', 4, 24);
    if (frame.placementCount === 0) {
      ctx.fillStyle = '#ff8080';
      ctx.fillText('0 sprites placed at this position/facing', 4, 36);
    }
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (this.firstPerson && this.firstPersonAvailable) {
      this.renderFirstPerson(ctx, w, h);
      return;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.drawMap(ctx);
    this.drawRows(ctx);
    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    ctx.fillText('CARTE.CO — party roster/travel screen (RENDERED map, CONFIRMED checklist structure)', 4, h - 24);
    const fpNote = this.firstPersonAvailable
      ? 'press F for first-person (ARBRE/NPLAINE/PLAGES/CAVINT scripts, RENDERED — test-bench, not a decoded travel mechanic)'
      : 'first-person assets not exported (see tools/crystalsofarborea/amiga/scripts.ts)';
    ctx.fillText(`W/S or click: navigate. Space/Enter or click: toggle/activate. ${fpNote}`, 4, h - 12);
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

/**
 * Ishar 1/2/3 (Amiga AGA) walker views — `GameView` implementations for the
 * shared walker harness (`tools/walker/walker.ts`).
 *
 * PRIMARILY a TOP-DOWN world-region grid walker, with one narrow, honestly-
 * scoped first-person addition. Originally this view assumed Ishar's
 * first-person mode was a heightfield/voxel-column terrain raycaster (the
 * reference `alis` engine's `render3d.c`) and set out to locate an on-disk
 * terrain-height grid to drive it. A `re-oracle` escalation (2026-09-01)
 * REFUTED that premise: `render3d.c` is dead code for Ishar (gated on
 * `alis.platform.version >= 31`; Ishar's own versions are 20/21/30 — see
 * `docs/ishar-container-format.md` §8's correction block). Ishar's real
 * first-person view is built from the engine's generic VM sprite/scene-
 * compositing system: EACH LOCATION SCRIPT'S OWN COMPILED BYTECODE is the
 * renderer (§8's follow-up implementation section). A later session built
 * an ALIS bytecode interpreter (`tools/shared/alis-interp.ts`) and executed
 * ONE such script end-to-end (`tools/shared/ishar-firstperson.ts`) —
 * Ishar 1's `FORET.bin` (forest) + `FOND.bin` (sky backdrop), verified
 * against region `CONT1`'s real grid data. That is the ONLY script pair
 * wired up here; every other region/game still renders top-down only —
 * see `renderCanvas()` below and §8's implementation section for the exact
 * scope boundary and what's honestly unverified (backdrop anchor/tiling
 * convention, no real palette).
 *
 * What IS confirmed (`docs/ishar-container-format.md` §9, independently
 * re-verified this session — an ASCII/pixel render of the decoded grid
 * shows an unmistakable coherent world: coastline borders, village/building
 * compounds, road lines) is the world's TOP-DOWN region-grid geometry
 * (`CONT*.FIC`, `tools/shared/ishar-regions.ts`). So this view renders that
 * by default — a top-down explorable map of one region, with the party
 * position and facing marked. Movement collision uses the HYPOTHESIS-level
 * `isBlocked()` rule (sign-extended cell value < 0); everything else
 * (geometry, dimensions, coordinate order) is CONFIRMED.
 *
 * Convention: `pose.level` is the region's numeric id (parsed from
 * `CONT<n>...FIC`); `pose.x`/`pose.y` are grid cell coordinates
 * (`cell = grid[y*width+x]`, confirmed against a hand-decoded `GERDEP.bin`
 * movement statement — see the doc). `pose.facing` is cosmetic for every
 * region except the one first-person-enabled combination below.
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { ISHAR_REGION_LAYOUT, isBlocked, type IsharRegionLayout } from '../shared/ishar-regions.ts';
import { renderIsharForestFrame, type RegionGridSource } from '../shared/ishar-firstperson.ts';

type IsharGameId = 'ishar' | 'ishar2' | 'ishar3';

interface RegionsJson {
  width: number;
  height: number;
  layerCount: number;
  regions: Array<{ name: string; layers: number[][] }>;
}

interface IsharRegion {
  id: number;
  name: string;
  label: string;
  width: number;
  height: number;
  /** Layer 0 only (the dense terrain layer) — sufficient for a top-down walkability render; the sparse second layer (Ishar 2/3) is not yet decoded semantically, see the sprite-format doc's open items. */
  terrain: Uint8Array;
}

interface IsharData {
  game: IsharGameId;
  layout: IsharRegionLayout;
  regions: IsharRegion[];
  /**
   * Ishar 1's `FORET.bin`/`FOND.bin` decompressed scripts, if fetched
   * successfully — the ONLY first-person-renderable script pair this
   * project has verified (see module doc). `undefined` for ishar2/ishar3
   * (not attempted) or if the asset fetch failed (e.g. the export step,
   * `tools/ishar/amigaaga/scripts.ts`, hasn't been run — it is NOT wired
   * into `npm run` since it isn't registered in package.json).
   */
  forestScripts?: { foret: Uint8Array; fond: Uint8Array };
}

const loadPromises = new Map<IsharGameId, Promise<IsharData>>();

/** Parse the numeric region id from a `CONT<n>` / `CONT<n>-3` file basename. */
function regionId(name: string): number {
  const m = /^CONT(\d+)/i.exec(name);
  return m ? Number(m[1]) : 0;
}

async function tryLoadForestScripts(base: string): Promise<{ foret: Uint8Array; fond: Uint8Array } | undefined> {
  try {
    const [foretRes, fondRes] = await Promise.all([
      fetch(`${base}/scripts/foret.bin`),
      fetch(`${base}/scripts/fond.bin`),
    ]);
    if (!foretRes.ok || !fondRes.ok) return undefined;
    const [foretBuf, fondBuf] = await Promise.all([foretRes.arrayBuffer(), fondRes.arrayBuffer()]);
    return { foret: new Uint8Array(foretBuf), fond: new Uint8Array(fondBuf) };
  } catch {
    return undefined;
  }
}

function loadIsharData(game: IsharGameId): Promise<IsharData> {
  const existing = loadPromises.get(game);
  if (existing) return existing;
  const promise = (async () => {
    const layout = ISHAR_REGION_LAYOUT[game];
    const base = `/assets/${game}/amigaaga`;
    const json = (await fetch(`${base}/data/regions.json`).then((r) => r.json())) as RegionsJson;
    const cellCount = json.width * json.height;
    const regions: IsharRegion[] = json.regions
      .map((r) => {
        const id = regionId(r.name);
        return {
          id,
          name: r.name,
          label: `${r.name} (region ${id})`,
          width: json.width,
          height: json.height,
          terrain: Uint8Array.from(r.layers[0]!.slice(0, cellCount)),
        };
      })
      .sort((a, b) => a.id - b.id);
    // First-person scripts are only wired up for Ishar 1 (see module doc).
    const forestScripts = game === 'ishar' ? await tryLoadForestScripts(base) : undefined;
    return { game, layout, regions, forestScripts };
  })();
  loadPromises.set(game, promise);
  return promise;
}

export async function isharLevelList(game: IsharGameId): Promise<Array<{ id: number; label: string }>> {
  const data = await loadIsharData(game);
  return data.regions.map((r) => ({ id: r.id, label: r.label }));
}

function findWalkable(region: IsharRegion): [number, number] {
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      if (!isBlocked(region.terrain[y * region.width + x]!)) return [x, y];
    }
  }
  return [Math.floor(region.width / 2), Math.floor(region.height / 2)];
}

const STEP_COOLDOWN_MS = 130;

/** Cell-value -> display colour classification (RENDERED, not a confirmed AGA palette — no palette has been recovered for this content, see `docs/ishar-sprite-format.md` §5). */
function colorForCell(v: number): string {
  if (v === 0) return '#0a1c2e'; // dominant value; reads as sea/void in the confirmed render
  if (isBlocked(v)) return '#7a3030'; // HYPOTHESIS: obstacle/border class
  // low positive terrain/feature codes -> a green-brown ramp
  const t = Math.min(1, v / 0x30);
  const r = Math.round(60 + t * 70);
  const g = Math.round(90 + t * 60);
  const b = Math.round(50 + t * 20);
  return `rgb(${r},${g},${b})`;
}

export class IsharView implements GameView {
  readonly id: string;
  readonly gameLabel: string;
  readonly automap: undefined;
  readonly banks: PieceBankLookup = {};
  readonly slots: SlotTableFile = { schemaVersion: 1, banks: [], slotRows: [] } as unknown as SlotTableFile;

  private readonly data: IsharData;
  private region: IsharRegion;
  private pose_: Pose;
  private tick = 0;
  private noclip = false;
  private stepCooldown = 0;
  private firstPerson = false;
  private toggleKeyWasDown = false;
  private fpCache: { key: string; frame: ReturnType<typeof renderIsharForestFrame> } | null = null;
  private fpCanvas: HTMLCanvasElement | null = null;

  constructor(id: IsharGameId, gameLabel: string, data: IsharData, startLevel: number, startPose: Pose | null) {
    this.id = id;
    this.gameLabel = gameLabel;
    this.data = data;
    this.region = data.regions.find((r) => r.id === startLevel) ?? data.regions[0]!;
    if (startPose && startPose.level === this.region.id) {
      this.pose_ = startPose;
    } else {
      const [x, y] = findWalkable(this.region);
      this.pose_ = { level: this.region.id, x, y, facing: 0 };
    }
  }

  get levelId(): number {
    return this.region.id;
  }
  get levelLabel(): string {
    return this.region.label;
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

  /** Ishar 1, region `CONT1`, with `FORET.bin`/`FOND.bin` fetched — the only first-person-renderable combination (see module doc). */
  get firstPersonAvailable(): boolean {
    return this.id === 'ishar' && /^CONT1$/i.test(this.region.name) && !!this.data.forestScripts;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.stepCooldown = Math.max(0, this.stepCooldown - dtMs);

    const toggleDown = keys.isDown('KeyF');
    if (toggleDown && !this.toggleKeyWasDown && this.firstPersonAvailable) {
      this.firstPerson = !this.firstPerson;
    }
    this.toggleKeyWasDown = toggleDown;

    if (this.stepCooldown > 0) return null;

    let dx = 0;
    let dy = 0;
    if (keys.isDown('KeyW') || keys.isDown('ArrowUp')) dy = -1;
    else if (keys.isDown('KeyS') || keys.isDown('ArrowDown')) dy = 1;
    else if (keys.isDown('KeyA') || keys.isDown('ArrowLeft')) dx = -1;
    else if (keys.isDown('KeyD') || keys.isDown('ArrowRight')) dx = 1;
    if (dx === 0 && dy === 0) return null;

    const { x, y } = this.pose_;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= this.region.width || ny >= this.region.height) return null;
    const cell = this.region.terrain[ny * this.region.width + nx]!;
    if (!this.noclip && isBlocked(cell)) return null;

    const facing: Pose['facing'] = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
    this.pose_ = { level: this.region.id, x: nx, y: ny, facing };
    this.stepCooldown = STEP_COOLDOWN_MS;
    return this.pose_;
  }

  setPose(pose: Pose): void {
    const region = this.data.regions.find((r) => r.id === pose.level);
    if (region) this.region = region;
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
    // No hotspots — this is a top-down grid, not a compositable scene.
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const region = this.region;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / region.width, h / region.height);
    const ox = (w - region.width * scale) / 2;
    const oy = (h - region.height * scale) / 2;
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        const v = region.terrain[y * region.width + x]!;
        if (v === 0) continue; // skip the dominant void colour — cheaper, and lets the black background read as "sea"
        ctx.fillStyle = colorForCell(v);
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    const { x, y, facing } = this.pose_;
    const px = ox + (x + 0.5) * scale;
    const py = oy + (y + 0.5) * scale;
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, scale * 0.6), 0, Math.PI * 2);
    ctx.fill();
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [fdx, fdy] = dirs[facing & 3]!;
    ctx.strokeStyle = '#ff3030';
    ctx.lineWidth = Math.max(1, scale * 0.3);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + fdx * scale * 2, py + fdy * scale * 2);
    ctx.stroke();
  }

  /**
   * Render one first-person frame (see `tools/shared/ishar-firstperson.ts`)
   * by actually executing `FORET.bin`/`FOND.bin`'s bytecode against this
   * region's real terrain layer for the current pose. Cached by
   * `x,y,facing` so it's only recomputed when the party actually moves, not
   * every animation-frame tick.
   */
  private renderFirstPerson(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const scripts = this.data.forestScripts!;
    const { x, y, facing } = this.pose_;
    const key = `${this.region.id}:${x},${y},${facing}`;
    if (!this.fpCache || this.fpCache.key !== key) {
      const region = this.region;
      const grid: RegionGridSource = {
        width: region.width,
        height: region.height,
        read(_buf, gx, gy) {
          if (gx < 0 || gy < 0 || gx >= region.width || gy >= region.height) return 0;
          const v = region.terrain[gy * region.width + gx]!;
          return v >= 128 ? v - 256 : v; // sign-extend, per ishar-regions.ts's tabchar() convention
        },
      };
      const frame = renderIsharForestFrame({
        foret: scripts.foret,
        fond: scripts.fond,
        partyX: x,
        partyY: y,
        facing: (facing & 3) as 0 | 1 | 2 | 3,
        grid,
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
      `${this.region.label} — first-person (RENDERED: real ALIS bytecode execution, placeholder sky/ground colour, no real palette — press F for top-down)`,
      4,
      12,
    );
    if (frame.placementCount === 0) {
      ctx.fillStyle = '#ff8080';
      ctx.fillText('0 sprites placed at this position/facing', 4, 24);
    }
  }

  renderCanvas(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (this.firstPerson && this.firstPersonAvailable) {
      this.renderFirstPerson(ctx, w, h);
      return;
    }
    this.drawGrid(ctx, w, h);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffe080';
    const fpNote = this.firstPersonAvailable
      ? 'press F for first-person (Ishar 1 forest, RENDERED)'
      : 'first-person not decoded for this region';
    ctx.fillText(`${this.region.label} — top-down (CONFIRMED world geometry) — ${fpNote}`, 4, 12);
  }

  renderMinimap(ctx: CanvasRenderingContext2D): void {
    const size = 200;
    ctx.canvas.width = size;
    ctx.canvas.height = size;
    this.drawGrid(ctx, size, size);
  }
}

export async function loadIsharView(
  id: IsharGameId,
  gameLabel: string,
  _assetBase: string,
  levelId: number,
  startPose: Pose | null,
): Promise<IsharView> {
  const data = await loadIsharData(id);
  return new IsharView(id, gameLabel, data, levelId, startPose);
}

export const loadIshar1View = (assetBase: string, levelId: number, startPose: Pose | null) =>
  loadIsharView('ishar', 'Ishar 1', assetBase, levelId, startPose);
export const loadIshar2View = (assetBase: string, levelId: number, startPose: Pose | null) =>
  loadIsharView('ishar2', 'Ishar 2', assetBase, levelId, startPose);
export const loadIshar3View = (assetBase: string, levelId: number, startPose: Pose | null) =>
  loadIsharView('ishar3', 'Ishar 3', assetBase, levelId, startPose);

export const isharLevelLists = {
  ishar: () => isharLevelList('ishar'),
  ishar2: () => isharLevelList('ishar2'),
  ishar3: () => isharLevelList('ishar3'),
};

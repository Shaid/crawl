/**
 * Ishar 1/2/3 (Amiga AGA) walker views — `GameView` implementations for the
 * shared walker harness (`tools/walker/walker.ts`).
 *
 * PRIMARILY a TOP-DOWN world-region grid walker, with a narrow, honestly-
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
 * against region `CONT1`'s real grid data. A follow-up session generalized
 * the renderer (`renderIsharLocationFrame()`, no longer FORET-specific) and
 * got a SECOND location script rendering end-to-end against the same real
 * `CONT1` grid data: `VILLAGE.bin` (a building/compound biome, verified
 * against real cells in the `[-25,-1]` value range clustered at
 * `x=52-56,y=14-20` — a real, recognizable timber-framed building render,
 * see `docs/ishar-container-format.md` §8.2). A later session (§8.4) added
 * TWO more scripts by disassembling each one's own `cswitch1`/`cswitch2`
 * cell-value dispatch and scanning the real `CONT*.FIC` grids for matching
 * cells: `PLAINE.bin` (plains — CONT1, a wide grass-field texture with
 * small shrub clumps) and `RAMPART.bin` (fortress — CONT3/CONT4, real
 * cells forming a closed fortress-perimeter polygon; renders tall
 * tower/wall silhouettes rising above the horizon). A later session (§8.7)
 * added a FIFTH: `TEMPLE.bin` (CONT3/CONT4/CONT6, its own per-location
 * backdrop `FTEMPLE.bin` — a real stone-arch texture, distinct from every
 * other Ishar 1 script's shared `fond.bin`) — this SUPERSEDES the earlier
 * "INCONCLUSIVE" verdict for TEMPLE (§8.3): that attempt scanned the WRONG
 * cell-value range (`[-10,-4]`) due to a sign error in applying `cswitch2`'s
 * `index = value + base` formula; the real accepted range is `[10,16]`,
 * which has hundreds of real matches corpus-wide (not 4) and renders a
 * genuinely temple-like symmetric mirrored-pillar-pair facade. All five
 * scripts are wired up here, cycled with `KeyC` while in first-person mode;
 * every other region/game still renders top-down only — see
 * `renderCanvas()` below and §8.2/§8.4/§8.7 for the exact scope boundary
 * and what's honestly unverified (backdrop anchor/tiling convention, no
 * real palette).
 *
 * **Ishar 2 first-person, added 2026-09-01** (`tools/shared/
 * ishar2-firstperson.ts`) — same generic scene-compositor mechanism, DIFFERENT
 * global addresses/facing convention, CONFIRMED by direct disassembly
 * comparison against Ishar 1's already-verified shell (see that module's doc
 * comment). Two scripts RENDERED end-to-end against real `CONT1`/`CONT3`
 * grid data: `FORET1.bin` (forest, own backdrop `FOND1.bin`) and `VILLE.bin`
 * (village, own backdrop `FVILLE.bin`) — unlike Ishar 1, Ishar 2 ships a
 * PER-LOCATION backdrop file rather than one shared `FOND.bin`. `ARBO.bin`/
 * `PLAINE1.bin`/`MONTAGNE.bin` disassemble clean under the same shell but
 * aren't wired up here (not exercised end-to-end).
 *
 * **Ishar 3 first-person: CONFIRMED this session**, superseding an earlier
 * "attempted, NOT achieved" verdict (see `docs/ishar-container-format.md`
 * §8.6's correction block and `docs/ishar/TODO.md`). The earlier verdict's
 * "4 unconditional quadrant blocks" claim was a misdiagnosis: a flat grep
 * for `cjsr target=1127` found 4 lexical call sites but never checked CFG
 * reachability — each site sits inside its OWN facing-gated block (one per
 * `cswitch2` target, exactly Ishar 1/2's shell shape) and each block ends by
 * jumping to the shared `cret`, so only ONE of the 4 runs per frame,
 * selected by facing, same as Ishar 1/2. `renderIshar3LocationFrame()` (see
 * `tools/shared/ishar3-firstperson.ts`) needed NO code change — running the
 * existing, unmodified interpreter/dispatch against real bytecode + real
 * grid data already produces coherent, non-degenerate first-person frames.
 * `FORET.bin` (forest, own backdrop `FFORET.bin`) and `JUNGLE.bin`
 * (jungle, own backdrop `FJUNGLE.bin`) both RENDERED against real
 * `CONT4-3.FIC` cells at multiple interior positions/facings — recognizable
 * tree/foliage silhouettes against sky, distinct per facing. A real,
 * source-confirmed residual quirk remains (one lateral scan bound can
 * "widen" toward a region edge instead of shrinking, and the per-ring
 * narrowing logic doesn't always catch up across the ~6-7 available rings)
 * — empirically HARMLESS for interior positions (the over-wide placements
 * land off-screen and get clipped by the compositor) but visibly messier
 * for a position near a grid CORNER (both axes near their edges at once,
 * e.g. `(7,3)`); see §8.6 for the full evidence and paths-tried table.
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
import { renderIsharLocationFrame, type RegionGridSource, type FirstPersonFrame } from '../shared/ishar-firstperson.ts';
import { renderIshar2LocationFrame } from '../shared/ishar2-firstperson.ts';
import { renderIshar3LocationFrame } from '../shared/ishar3-firstperson.ts';

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

/**
 * One first-person-renderable location script, verified end-to-end against
 * real grid data (see module doc). `fond`, if present, is THIS location's
 * OWN backdrop (Ishar 2's per-location `FOND1.bin`/`FVILLE.bin` convention);
 * if absent, the caller falls back to `IsharData.firstPerson.sharedFond`
 * (Ishar 1's one-`FOND.bin`-for-everything convention).
 */
interface IsharLocation {
  key: string;
  label: string;
  data: Uint8Array;
  fond?: Uint8Array;
  /** Region name pattern this location was verified against (`firstPersonAvailable` gate). */
  regionPattern: RegExp;
}

interface IsharData {
  game: IsharGameId;
  layout: IsharRegionLayout;
  regions: IsharRegion[];
  /**
   * Every location script fetched successfully for this game (empty/absent
   * if the export step hasn't been run: `tools/ishar/amigaaga/scripts.ts` /
   * `tools/ishar2/amigaaga/scripts.ts` / `tools/ishar3/amigaaga/scripts.ts`,
   * none wired into `npm run`).
   */
  firstPerson?: { sharedFond?: Uint8Array; locations: IsharLocation[] };
}

const loadPromises = new Map<IsharGameId, Promise<IsharData>>();

/** Parse the numeric region id from a `CONT<n>` / `CONT<n>-3` file basename. */
function regionId(name: string): number {
  const m = /^CONT(\d+)/i.exec(name);
  return m ? Number(m[1]) : 0;
}

interface LocationScriptSpec {
  key: string;
  label: string;
  /** Own backdrop asset key (Ishar 2 convention) — omit to use the game's shared `fond.bin` (Ishar 1 convention). */
  fondKey?: string;
  regionPattern: RegExp;
}

/** Per-game render function — both share the same options/return shape (see each module's doc). */
type LocationFrameRenderer = (opts: {
  location: Uint8Array;
  fond?: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  grid: RegionGridSource;
}) => FirstPersonFrame;

const LOCATION_SCRIPTS: Record<IsharGameId, LocationScriptSpec[]> = {
  ishar: [
    { key: 'foret', label: 'Forest (FORET.bin)', regionPattern: /^CONT1$/i },
    { key: 'village', label: 'Village (VILLAGE.bin)', regionPattern: /^CONT1$/i },
    { key: 'plaine', label: 'Plains (PLAINE.bin)', regionPattern: /^CONT1$/i },
    { key: 'rampart', label: 'Rampart (RAMPART.bin)', regionPattern: /^CONT[34]/i },
    // Own per-location backdrop (FTEMPLE.bin, confirmed via MAIN.bin's
    // straight-line `cload("ftemple.AO"); cload("temple.AO")` manifest pair)
    // rather than the shared fond.bin every other Ishar 1 script here uses.
    { key: 'temple', label: 'Temple (TEMPLE.bin)', fondKey: 'ftemple', regionPattern: /^CONT[346]/i },
  ],
  // Own per-location backdrop (fondKey), unlike Ishar 1's single shared fond.bin.
  ishar2: [
    { key: 'foret1', label: 'Forest (FORET1.bin)', fondKey: 'fond1', regionPattern: /^CONT1$/i },
    { key: 'ville', label: 'Village (VILLE.bin)', fondKey: 'fville', regionPattern: /^CONT3$/i },
  ],
  // Ishar 3: FORET.bin CONFIRMED (see module doc + docs/ishar-container-
  // format.md §8.6's correction) against real CONT4-3.FIC forest cells;
  // JUNGLE.bin also RENDERED (coherent, non-degenerate) against the same
  // region, though its own canonical CONT<n>-3.FIC region isn't
  // independently pinned (its cell-value dispatch range is too broad to
  // discriminate one region from another the way FORET's is).
  ishar3: [
    { key: 'foret', label: 'Forest (FORET.bin)', fondKey: 'fforet', regionPattern: /^CONT4/i },
    { key: 'jungle', label: 'Jungle (JUNGLE.bin)', fondKey: 'fjungle', regionPattern: /^CONT4/i },
  ],
};

const RENDER_FRAME: Record<IsharGameId, LocationFrameRenderer> = {
  ishar: renderIsharLocationFrame,
  ishar2: renderIshar2LocationFrame,
  ishar3: renderIshar3LocationFrame,
};

async function tryLoadFirstPersonAssets(
  base: string,
  game: IsharGameId,
): Promise<{ sharedFond?: Uint8Array; locations: IsharLocation[] } | undefined> {
  const specs = LOCATION_SCRIPTS[game];
  if (specs.length === 0) return undefined;
  try {
    let sharedFond: Uint8Array | undefined;
    const needsSharedFond = specs.some((s) => !s.fondKey);
    if (needsSharedFond) {
      const fondRes = await fetch(`${base}/scripts/fond.bin`);
      if (!fondRes.ok) return undefined;
      sharedFond = new Uint8Array(await fondRes.arrayBuffer());
    }
    const locations: IsharLocation[] = [];
    for (const spec of specs) {
      const res = await fetch(`${base}/scripts/${spec.key}.bin`);
      if (!res.ok) continue;
      const data = new Uint8Array(await res.arrayBuffer());
      let fond: Uint8Array | undefined;
      if (spec.fondKey) {
        const fRes = await fetch(`${base}/scripts/${spec.fondKey}.bin`);
        if (fRes.ok) fond = new Uint8Array(await fRes.arrayBuffer());
      }
      locations.push({ key: spec.key, label: spec.label, data, fond, regionPattern: spec.regionPattern });
    }
    if (locations.length === 0) return undefined;
    return { sharedFond, locations };
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
    // First-person scripts are wired up for all three games (see module doc).
    const firstPerson = await tryLoadFirstPersonAssets(base, game);
    return { game, layout, regions, firstPerson };
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
  private cycleKeyWasDown = false;
  private locationIndex = 0;
  private fpCache: { key: string; frame: ReturnType<typeof renderIsharLocationFrame> } | null = null;
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

  /**
   * True if this region has at least one loaded location script whose own
   * `regionPattern` matches it (Ishar 1: `CONT1`/`CONT3`/`CONT4`; Ishar 2:
   * `CONT1`/`CONT3`; Ishar 3: `CONT4`, see module doc). Cycling `KeyC` still
   * tries any of THIS game's loaded scripts against whichever region is
   * current (manual test-bench, not the real region-to-scene dispatch) —
   * most script/region combinations outside each script's own confirmed
   * region will render few or no placements, which is expected, not a bug.
   */
  get firstPersonAvailable(): boolean {
    const locations = this.data.firstPerson?.locations;
    if (!locations || locations.length === 0) return false;
    return locations.some((loc) => loc.regionPattern.test(this.region.name));
  }

  /** Currently-selected location script (cycled with `KeyC`), or `undefined` if none loaded. */
  private get currentLocation(): IsharLocation | undefined {
    const locations = this.data.firstPerson?.locations;
    return locations?.[this.locationIndex % locations.length];
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    this.tick += dtMs;
    this.stepCooldown = Math.max(0, this.stepCooldown - dtMs);

    const toggleDown = keys.isDown('KeyF');
    if (toggleDown && !this.toggleKeyWasDown && this.firstPersonAvailable) {
      this.firstPerson = !this.firstPerson;
    }
    this.toggleKeyWasDown = toggleDown;

    // Cycle which VERIFIED location script renders this region's real grid
    // data -- this is a manual test-bench selector, NOT the real (still
    // undecoded, `ishar-cell-value-semantics`) region-to-scene dispatch. Any
    // location script can run against any region's grid; only CONT1 has
    // been checked for a real matching building compound (VILLAGE) as well
    // as forest content (FORET) so far.
    const cycleDown = keys.isDown('KeyC');
    if (cycleDown && !this.cycleKeyWasDown && this.firstPerson && this.firstPersonAvailable) {
      const count = this.data.firstPerson?.locations.length ?? 1;
      this.locationIndex = (this.locationIndex + 1) % count;
    }
    this.cycleKeyWasDown = cycleDown;

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
   * Render one first-person frame (see `tools/shared/ishar-firstperson.ts` /
   * `ishar2-firstperson.ts`, dispatched by `RENDER_FRAME[this.id]`) by
   * actually executing the currently-selected location script's (`KeyC`
   * cycles it) bytecode, plus its backdrop (own per-location backdrop if it
   * has one, else the game's shared `fond.bin`), against this region's real
   * terrain layer for the current pose. Cached by `x,y,facing,location` so
   * it's only recomputed when the party actually moves or the script is
   * switched, not every animation-frame tick.
   */
  private renderFirstPerson(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const firstPerson = this.data.firstPerson!;
    const location = this.currentLocation;
    if (!location) return;
    const { x, y, facing } = this.pose_;
    const key = `${this.region.id}:${x},${y},${facing}:${location.key}`;
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
      const renderFrame = RENDER_FRAME[this.id as IsharGameId];
      const frame = renderFrame({
        location: location.data,
        fond: location.fond ?? firstPerson.sharedFond,
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
      `${this.region.label} — first-person: ${location.label} (RENDERED: real ALIS bytecode execution, placeholder sky/ground colour, no real palette)`,
      4,
      12,
    );
    ctx.fillText('F: top-down.  C: cycle location script (manual test-bench selector, not the real region-to-scene dispatch).', 4, 24);
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
    this.drawGrid(ctx, w, h);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffe080';
    const scriptLabels = this.data.firstPerson?.locations
      .filter((loc) => loc.regionPattern.test(this.region.name))
      .map((loc) => loc.label)
      .join(', ');
    const fpNote = this.firstPersonAvailable
      ? `press F for first-person (${scriptLabels}, RENDERED)`
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

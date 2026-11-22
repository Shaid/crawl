/**
 * Ishar 1/2/3 (Amiga AGA) walker views — `GameView` implementations for the
 * shared walker harness (`tools/walker/walker.ts`).
 *
 * > **Correction (2026-11-22):** for Ishar 1 and 2 the first-person view is
 * > now the game's own scene (`tools/shared/ishar-scene.ts`). That is the
 * > region code's whole script group, woken once per step or turn, with
 * > zone add-ons, both grid buffers and a palette-0 background. It is
 * > measured pose for pose against the alis oracle (`tools/ishar/oracle/`):
 * > 100% of placements and of pixels outside NPC boxes, see
 * > `docs/ishar-container-format.md` §8.8. Movement is relative to facing
 * > and regions chain as in the game. The history below describes the old
 * > one-script test bench, which reached 0-31% of the game's placements.
 * > Its "CONFIRMED" verdicts (FORET, Ishar 3 FORET/JUNGLE) meant coherent
 * > frames, not agreement with the game. Only Ishar 3 still uses that
 * > bench.
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
 * Convention (2026-11-13, `ishar-grid-index-transpose`): `pose.level` is
 * the region's numeric id (parsed from `CONT<n>...FIC`); `pose.x` is the
 * storage ROW index (east-west) and `pose.y` the storage COLUMN index
 * (north-south, increasing south) -- the view shows the TRANSPOSE of the
 * stored `row*stride + col` grid, which matches the games' own map
 * pictures and the handedness of the first-person projection (drawn
 * untransposed, the top-down map was a mirror image of the 3D view).
 * N/E/S/W = -y/+x/+y/-x. The "residual quirk" described for Ishar 3 above
 * was an interpreter operand-order bug, fixed in `alis-interp.ts`. See
 * `docs/ishar-container-format.md` § "2026-11-13 follow-up".
 */
import type { KeyStateLike } from '@seer-project/dungeon';
import type { PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { GameView } from './games.ts';
import { ISHAR_REGION_LAYOUT, isBlocked, type IsharRegionLayout } from '../shared/ishar-regions.ts';
import { renderIsharLocationFrame, type RegionGridSource, type FirstPersonFrame } from '../shared/ishar-firstperson.ts';
import { renderIshar2LocationFrame } from '../shared/ishar2-firstperson.ts';
import { renderIshar3LocationFrame } from '../shared/ishar3-firstperson.ts';
import { resolveIsharOwnPalette, type IsharPalette } from '../shared/ishar-palette.ts';
import { compositeIsharView, IsharGridBuffers, IsharScene, ISHAR1_PORTALS, ISHAR1_TITLE, ISHAR2_TITLE, ISHAR3_TITLE, type IsharPartyState, type IsharTitleSpec } from '../shared/ishar-scene.ts';

type IsharGameId = 'ishar' | 'ishar2' | 'ishar3';

interface RegionsJson {
  width: number;
  height: number;
  layerCount: number;
  regions: Array<{ name: string; layers: number[][] }>;
}

/**
 * One region, in the walker's GEOGRAPHIC frame: the TRANSPOSE of the
 * `CONT*.FIC` storage layout (2026-11-13, `ishar-grid-index-transpose`).
 * `tabchar()` addresses the grid as `row*stride + col` with the script's
 * east-west coordinate as the ROW and north-south as the COLUMN, so drawing
 * storage as-is (columns across) shows a mirror image of the first-person
 * view; the transpose matches each title's own `MAP.DO` picture (Ishar 1/2
 * checked). Display cell `(x, y)` = storage `(row = x, col = y)`; `width` =
 * storage row count, `height` = storage stride.
 */
interface IsharRegion {
  id: number;
  name: string;
  label: string;
  width: number;
  height: number;
  /** Layer 0 only (the dense terrain layer), transposed: `terrain[y*width + x]` = storage `[x*stride + y]`. The sparse second layer (Ishar 2/3) is not yet decoded semantically, see the sprite-format doc's open items. */
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
  /** Every layer of each region in STORAGE order (`row*stride + col`), by region id. */
  storage: Map<number, Uint8Array[]>;
  /**
   * The game's own scene model (`tools/shared/ishar-scene.ts`), for titles
   * that have one traced: every scene + zone script it can run, by name.
   */
  scene?: { spec: IsharTitleSpec; scripts: Map<string, Uint8Array> };
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
  palette?: IsharPalette;
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
  // Ishar 3 (still the one-script bench; RENDERED, not checked against the
  // game -- see the 2026-11-22 correction in the module doc): FORET.bin
  // against real CONT4-3.FIC forest cells;
  // JUNGLE.bin also RENDERED (coherent, non-degenerate) against the same
  // region, though its own canonical CONT<n>-3.FIC region isn't
  // independently pinned (its cell-value dispatch range is too broad to
  // discriminate one region from another the way FORET's is).
  ishar3: [
    { key: 'foret', label: 'Forest (FORET.bin)', fondKey: 'fforet', regionPattern: /^CONT4/i },
    { key: 'jungle', label: 'Jungle (JUNGLE.bin)', fondKey: 'fjungle', regionPattern: /^CONT4/i },
  ],
};

/**
 * Titles whose first-person view is the game's own scene model (verified
 * against the alis oracle, `tools/ishar/oracle/`). Ishar 3 still uses the
 * single-script test bench below.
 */
const SCENE_SPECS: Partial<Record<IsharGameId, IsharTitleSpec>> = { ishar: ISHAR1_TITLE, ishar2: ISHAR2_TITLE, ishar3: ISHAR3_TITLE };

/** Start of a new game, read from the oracle (MAIN's own start-up writes). */
const START_POSES: Record<IsharGameId, Pose> = {
  ishar: { level: 1, x: 11, y: 29, facing: 1 }, // CONT1 row 11 col 29, raw facing 2
  ishar2: { level: 1, x: 27, y: 45, facing: 1 }, // CONT1 row 27 col 45, raw facing 2
  ishar3: { level: 1, x: 2, y: 50, facing: 0 }, // CONT1-3 row 2 col 50, raw facing 1 (Maz)
};

async function tryLoadSceneScripts(base: string, spec: IsharTitleSpec): Promise<Map<string, Uint8Array> | undefined> {
  const names = [...spec.sceneScripts, ...(spec.zone ? [spec.zone.script] : [])];
  try {
    const out = new Map<string, Uint8Array>();
    await Promise.all(
      names.map(async (n) => {
        const res = await fetch(`${base}/scripts/${n.toLowerCase()}.bin`);
        if (res.ok) out.set(n.toUpperCase(), new Uint8Array(await res.arrayBuffer()));
      }),
    );
    return out.size ? out : undefined;
  } catch {
    return undefined;
  }
}

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
    const stride = json.width;
    const rows = json.height;
    const storage = new Map<number, Uint8Array[]>();
    for (const r of json.regions) storage.set(regionId(r.name), r.layers.map((l) => Uint8Array.from(l)));
    const regions: IsharRegion[] = json.regions
      .map((r) => {
        const id = regionId(r.name);
        const stored = r.layers[0]!;
        // Transpose storage (row-major, `stride` columns) into the
        // geographic display frame: display x = storage row, y = column.
        const terrain = new Uint8Array(rows * stride);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < stride; col++) terrain[col * rows + row] = stored[row * stride + col] ?? 0;
        }
        return {
          id,
          name: r.name,
          label: `${r.name} (region ${id})`,
          width: rows,
          height: stride,
          terrain,
        };
      })
      .sort((a, b) => a.id - b.id);
    // First-person scripts are wired up for all three games (see module doc).
    const firstPerson = await tryLoadFirstPersonAssets(base, game);
    const spec = SCENE_SPECS[game];
    const sceneScripts = spec ? await tryLoadSceneScripts(base, spec) : undefined;
    return { game, layout, regions, storage, firstPerson, scene: spec && sceneScripts ? { spec, scripts: sceneScripts } : undefined };
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
  /** The game's scene for this title (persistent across steps: backdrops alternate per step), when traced. */
  private scene: IsharScene | null = null;
  private gridBuffers: IsharGridBuffers | null = null;
  private sceneFrame: { key: string; rgba: Uint8Array; placements: number } | null = null;

  constructor(id: IsharGameId, gameLabel: string, data: IsharData, startLevel: number, startPose: Pose | null) {
    this.id = id;
    this.gameLabel = gameLabel;
    this.data = data;
    this.region = this.gridOf(startLevel) ?? data.regions[0]!;
    const gameStart = START_POSES[id];
    if (startPose && this.gridOf(startPose.level) === this.region) {
      this.pose_ = startPose;
    } else if (gameStart.level === this.region.id) {
      this.pose_ = { ...gameStart };
    } else {
      const [x, y] = findWalkable(this.region);
      this.pose_ = { level: this.region.id, x, y, facing: 0 };
    }
    this.sceneStep();
  }

  /**
   * The CONT grid a region code is drawn on. Ishar 1's caves and towns keep
   * the grid and add 10 to the code (MAIN `+0x3039`/`+0x306b`, entered at
   * fixed gateway cells, `ISHAR1_PORTALS`): code 15 is the CONT5 cave, 13
   * the CONT3 town.
   */
  private gridOf(level: number): IsharRegion | undefined {
    return this.data.regions.find((r) => r.id === level) ?? (level > 10 ? this.data.regions.find((r) => r.id === level % 10) : undefined);
  }

  /** The party state in the game's terms: pose.x = storage row, pose.y = storage column, region code = CONT number (+10 in a cave or town). */
  private partyState(pose: Pose = this.pose_): IsharPartyState {
    return { region: pose.level, row: pose.x, col: pose.y, facing: (pose.facing & 3) as 0 | 1 | 2 | 3 };
  }

  /**
   * One wake-up of the game's scene (every step or turn, GERDEP): MAIN's
   * grid-buffer loads, then the zone rules, then every scene script redraws.
   * A teleport (`setPose`) or a region without a scene drops the scene, so
   * the next step starts it fresh like a load.
   */
  private sceneStep(): void {
    const sc = this.data.scene;
    if (!sc) return;
    const st = this.partyState();
    if (!sc.spec.sceneGroup(st.region)) {
      this.scene = null;
      return;
    }
    if (!this.gridBuffers) this.gridBuffers = new IsharGridBuffers(sc.spec, (n) => this.data.storage.get(n));
    const grids = this.gridBuffers.update(st);
    if (!this.scene) {
      // A new game (or a load): the scripts start, nothing is woken yet.
      this.scene = new IsharScene(sc.spec, (n) => sc.scripts.get(n.toUpperCase()), grids);
      this.scene.enter(st);
    } else {
      this.scene.setGrids(grids);
      this.scene.step(st);
    }
    const leaves = this.scene.leaves();
    this.sceneFrame = {
      key: `${st.region}:${st.row},${st.col},${st.facing}`,
      rgba: compositeIsharView(leaves, sc.spec.screen, this.scene.palette),
      placements: leaves.length,
    };
  }

  get levelId(): number {
    return this.region.id;
  }
  get levelLabel(): string {
    const code = this.pose_.level;
    if (code === this.region.id) return this.region.label;
    const kind = this.id === 'ishar' ? ISHAR1_PORTALS.find((p) => p.code + 10 === code)?.kind : undefined;
    return `${this.region.label}, ${kind ?? 'region'} code ${code}`;
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
    if (this.data.scene) return this.data.scene.spec.sceneGroup(this.pose_.level) !== null;
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
      if (this.firstPerson && this.data.scene && !this.scene) this.sceneStep();
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

    // Up/W = forward, Down/S = back, Left/A and Right/D = turn on the spot
    // (the game's own controls: GERDEP turns and steps relative to facing).
    const turn = keys.isDown('KeyA') || keys.isDown('ArrowLeft') ? -1 : keys.isDown('KeyD') || keys.isDown('ArrowRight') ? 1 : 0;
    const move = keys.isDown('KeyW') || keys.isDown('ArrowUp') ? 1 : keys.isDown('KeyS') || keys.isDown('ArrowDown') ? -1 : 0;
    if (turn === 0 && move === 0) return null;

    if (turn !== 0) {
      this.pose_ = { ...this.pose_, facing: ((this.pose_.facing + turn + 4) & 3) as Pose['facing'] };
    } else {
      const dir = ((this.pose_.facing + (move < 0 ? 2 : 0)) & 3) as 0 | 1 | 2 | 3;
      const next = this.stepTarget(dir);
      if (!next) return null;
      const region = this.gridOf(next.level);
      if (!region) return null;
      this.region = region;
      this.pose_ = next;
    }
    this.stepCooldown = STEP_COOLDOWN_MS;
    // The game wakes its scene on every step or turn whichever view is up.
    if (this.data.scene) this.sceneStep();
    return this.pose_;
  }

  /**
   * The cell one step away in walker direction `dir` (N/E/S/W = -y/+x/+y/-x
   * = raw facing 1/2/3/4), chaining Ishar 1's regions north-south, or null
   * if blocked. With a scene spec that has the game's step test
   * (`spec.enter`: Ishar 1 GERDEP `+0xc38`, passages included) that test
   * decides; otherwise a negative cell blocks (`isBlocked`).
   */
  private stepTarget(dir: 0 | 1 | 2 | 3): Pose | null {
    const sc = this.data.scene;
    let target: Pose;
    if (sc) {
      const st = sc.spec.stepFrom({ ...this.partyState(), facing: dir }, dir);
      if (!st) return null;
      target = { level: st.region, x: st.row, y: st.col, facing: this.pose_.facing };
    } else {
      const d: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [dx, dy] = d[dir]!;
      target = { ...this.pose_, x: this.pose_.x + dx, y: this.pose_.y + dy };
    }
    const region = this.gridOf(target.level);
    if (!region || target.x < 0 || target.y < 0 || target.x >= region.width || target.y >= region.height) return null;
    const cell = region.terrain[target.y * region.width + target.x]!;
    if (sc?.spec.enter && !this.noclip) {
      const cellAt = (lv: number, row: number, col: number) => {
        const r = this.gridOf(lv);
        const v = r ? (r.terrain[col * r.width + row] ?? 0) : 0;
        return v >= 128 ? v - 256 : v;
      };
      const from = this.partyState();
      const to = sc.spec.enter(from, { ...from, region: target.level, row: target.x, col: target.y }, cellAt);
      return to ? { level: to.region, x: to.row, y: to.col, facing: this.pose_.facing } : null;
    }
    if (!this.noclip && isBlocked(cell)) return null;
    return target;
  }

  setPose(pose: Pose): void {
    const region = this.gridOf(pose.level);
    if (region) this.region = region;
    this.pose_ = pose;
    this.scene = null;
    this.gridBuffers?.reset();
    this.sceneFrame = null;
    this.sceneStep();
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
    if (this.data.scene) {
      this.renderScene(ctx, w, h);
      return;
    }
    const firstPerson = this.data.firstPerson!;
    const location = this.currentLocation;
    if (!location) return;
    const { x, y, facing } = this.pose_;
    const key = `${this.region.id}:${x},${y},${facing}:${location.key}`;
    if (!this.fpCache || this.fpCache.key !== key) {
      const region = this.region;
      // The renderers address the grid in STORAGE terms (stride = region
      // height here, row count = region width); storage (col, row) is
      // display (x = row, y = col).
      const grid: RegionGridSource = {
        width: region.height,
        height: region.width,
        read(_buf, col, row) {
          if (row < 0 || col < 0 || row >= region.width || col >= region.height) return 0;
          const v = region.terrain[col * region.width + row]!;
          return v >= 128 ? v - 256 : v; // sign-extend, per ishar-regions.ts's tabchar() convention
        },
      };
      const renderFrame = RENDER_FRAME[this.id as IsharGameId];
      const fond = location.fond ?? firstPerson.sharedFond;
      // Every backdrop script (FOND/FTEMPLE/FOND1/FVILLE/FFORET/FJUNGLE)
      // installs its own `0xFE` palette slot on its second tick (after its
      // first `cstop` yield) -- see docs/ishar-sprite-format.md §5. Ishar 2's
      // FOND1/FVILLE choose among three variants by a main global
      // (0x519f, phase 1/2/3); the first slot is the phase-1 variant.
      const palette = fond ? (resolveIsharOwnPalette(fond) ?? undefined) : undefined;
      const frame = renderFrame({
        location: location.data,
        fond,
        palette,
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
      `${this.region.label} — first-person: ${location.label} (RENDERED: real ALIS bytecode execution + backdrop's own palette; flat placeholder behind the backdrop)`,
      4,
      12,
    );
    ctx.fillText('F: top-down.  C: cycle location script (manual test-bench selector, not the real region-to-scene dispatch).', 4, 24);
    if (frame.placementCount === 0) {
      ctx.fillStyle = '#ff8080';
      ctx.fillText('0 sprites placed at this position/facing', 4, 36);
    }
  }

  /** The game's own scene (see `sceneStep`), drawn at the real view size. */
  private renderScene(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.scene || !this.sceneFrame) this.sceneStep();
    const frame = this.sceneFrame;
    const screen = this.data.scene!.spec.screen;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (frame) {
      if (!this.fpCanvas) this.fpCanvas = document.createElement('canvas');
      this.fpCanvas.width = screen.width;
      this.fpCanvas.height = screen.height;
      this.fpCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), screen.width, screen.height), 0, 0);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(w / screen.width, h / screen.height);
      ctx.drawImage(this.fpCanvas, (w - screen.width * scale) / 2, (h - screen.height * scale) / 2, screen.width * scale, screen.height * scale);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.fillStyle = '#ffe080';
    ctx.font = '10px monospace';
    const scripts = this.scene?.scriptNames.join(', ') ?? '';
    ctx.fillText(`${this.region.label} - first-person: the game's scene (${scripts}); matches the alis oracle pose for pose`, 4, 12);
    ctx.fillText('F: top-down.  Up/Down: step, Left/Right: turn.', 4, 24);
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

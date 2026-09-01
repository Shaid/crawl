/**
 * Dungeon walker harness — multi-game: pick a game (Black Crypt or Wizardry
 * 6) and a level within it, walk the dungeon with the shared
 * `@seer-project/dungeon` raster/composite layer, and toggle debug
 * affordances (noclip). Each game is a `GameView` (`games.ts`) providing
 * pose/controller/items/palette/automap; the shell here is game-agnostic.
 *
 * Controls:
 * - game dropdown — which game's data to load (BC: the `Walker` facade +
 *   `buildViewList`; W6: `WalkerController` + its compose-list view model).
 * - level dropdown — a unit within the loaded game's `levels.json` (BC) or
 *   one of the 14 per-level files (W6).
 * - noclip checkbox — moves through walls (the `canStep` gate is bypassed).
 * - WASD/arrows move · Q/E turn · Space interact (BC) · Tab automap zoom.
 *
 * URL params: `?game=&map=&x=&y=&facing=` so a broken pose is a shareable
 * link. MM2 is not selectable yet — it has data codecs but no walker
 * renderer.
 */
import {
  PieceBank,
  IndexedSurface,
  compositeDrawList,
  CanvasPresenter,
  renderAutomap,
  Minimap,
  FlatGridLevel,
  DEFAULT_BINDINGS,
  indexedTilesetPaths,
  rampPalettePath,
  paletteRampForUnit,
  parseRampPalette,
  type PieceBankLookup,
  type RGBAColor,
  type RampPaletteFile,
  type Pose,
  type Dir4,
} from '@seer-project/dungeon';
import {
  validateSlotTableFile,
  validateDungeonLevelFile,
  validateSemanticsFile,
  validateBindingsFile,
  type SlotTableFile,
  type DungeonLevelFile,
  type BindingsFile,
  type SemanticsFile,
} from '@seer-project/dungeon/schema';
import { KeyState } from '@seer-project/engine-2d/input';
import type { AtlasMeta } from '@seer-project/core';
import { getAssetBasePath } from '../shared/viewer-config.ts';
import { BlackCryptView, Wizardry6View, bcEntrancePose, w6EntrancePose, type GameView } from './games.ts';
import { loadMM1View, loadMM2View, mmLevelLists } from './games-mm.ts';
import { loadMM3View, mm3LevelList } from './games-mm3.ts';
import { loadWizardry6Snes, wizardry6SnesLevelList } from './games-w6-snes.ts';
import { loadEotb1View, eotbLevelList } from './games-eotb.ts';
import { loadEotb2View, eotb2LevelList } from './games-eotb2.ts';
import { loadLandsOfLoreView, landsofloreLevelList } from './games-landsoflore.ts';
import {
  loadPoolOfRadianceView,
  loadCurseOfTheAzureBondsView,
  loadSecretOfTheSilverBladesView,
  loadPoolsOfDarknessView,
  loadDarkQueenOfKrynnView,
  loadGatewayToTheSavageFrontierView,
  loadTreasuresOfTheSavageFrontierView,
  loadChampionsOfKrynnView,
  loadDeathKnightsOfKrynnView,
} from './games-goldbox.ts';
import { loadIshar1View, loadIshar2View, loadIshar3View, isharLevelLists } from './games-ishar.ts';
import { crystalsOfArboreaLoader, crystalsOfArboreaLevelList } from './games-crystalsofarborea.ts';
import type { CellPlanes } from '../wizardry6/evaluate-cell.ts';

const statusEl = document.getElementById('status')!;
const confidenceEl = document.getElementById('confidence')!;
const gameSelect = document.getElementById('game') as HTMLSelectElement;
const levelSelect = document.getElementById('level') as HTMLSelectElement;
const variantSelect = document.getElementById('variant') as HTMLSelectElement;
const noclipCheck = document.getElementById('noclip') as HTMLInputElement;
const canvas = document.getElementById('surface') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
const automapCanvas = document.getElementById('automap') as HTMLCanvasElement;

const MINIMAP_RADIUS = 6;
const AUTOMAP_WINDOW_RADIUS = 8;
const AUTOMAP_TILE_SIZE = 8;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function tryFetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Decode a PNG at `url` to interleaved RGBA bytes via an offscreen canvas. Returns `null` on a 404. */
function decodePNGToRGBA(url: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, off.width, off.height);
      resolve({ rgba: imageData.data, width: off.width, height: off.height });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadBank(assetBase: string, atlasPath: string, imagePath: string): Promise<PieceBank> {
  const atlas = await fetchJSON<AtlasMeta>(`${assetBase}/${atlasPath}`);
  const decoded = await decodePNGToRGBA(`${assetBase}/${imagePath}`);
  if (!decoded) throw new Error(`Failed to load image ${assetBase}/${imagePath}`);
  return PieceBank.fromRGBA(decoded.rgba, decoded.width, decoded.height, atlas);
}

// Each tileset's *primary* accent ramp, needed to recover raw EHB indices
// from the indexed atlas's baked palette (`PieceBank.fromIndexedRGBA`'s
// basePalette). Confirmed: bcdfx -> [0,3], bcdfy -> [1], bcdfz -> [2].
const TILESET_PRIMARY_RAMP: Record<string, number> = { bcdfx: 0, bcdfy: 1, bcdfz: 2 };

// Accent ramp 4 ("cold blue-grey") -- the underwater/flooded-square re-tint
// `S_1 +0x02D46` forces on entering a "water" (type-nibble bit 3) square,
// restoring the level's default ramp on leaving; level 3 is exempt. Not any
// level's *static* default ramp, so `bclib.tileset_ramps()`'s per-tileset set
// doesn't include it on its own -- `export_dungeon_tileset_indexed.py` now
// always additionally exports it per tileset. See
// docs/blackcrypt/amiga/data-structure.md "Selector 2 -- per-square
// override" and "Underwater/flooded-level rendering".
const WATER_ACCENT_RAMP = 4;

async function loadTilesetBank(
  assetBase: string,
  bankRef: SlotTableFile['banks'][number],
  tileset: string | undefined,
  targetRamp: number,
): Promise<{ bank: PieceBank; palette: RGBAColor[]; basePalette?: RGBAColor[]; rampSource: 'indexed' | 'baked' }> {
  const primaryRamp = tileset ? TILESET_PRIMARY_RAMP[tileset] : undefined;
  if (tileset && primaryRamp !== undefined) {
    const paths = indexedTilesetPaths(tileset);
    const [atlas, indexImg, maskImg, basePaletteFile, targetPaletteFile] = await Promise.all([
      tryFetchJSON<AtlasMeta>(`${assetBase}/${paths.atlasJson}`),
      decodePNGToRGBA(`${assetBase}/${paths.indexPng}`),
      decodePNGToRGBA(`${assetBase}/${paths.maskPng}`),
      tryFetchJSON<RampPaletteFile>(`${assetBase}/${rampPalettePath(tileset, primaryRamp)}`),
      tryFetchJSON<RampPaletteFile>(`${assetBase}/${rampPalettePath(tileset, targetRamp)}`),
    ]);
    if (atlas && indexImg && maskImg && basePaletteFile && targetPaletteFile) {
      const basePalette = parseRampPalette(basePaletteFile);
      const bank = PieceBank.fromIndexedRGBA(indexImg.rgba, maskImg.rgba, indexImg.width, indexImg.height, atlas, basePalette);
      const palette = targetRamp === primaryRamp ? basePalette : parseRampPalette(targetPaletteFile);
      return { bank, palette, basePalette, rampSource: 'indexed' };
    }
  }
  const bank = await loadBank(assetBase, bankRef.atlas, bankRef.image);
  return { bank, palette: bank.palette, rampSource: 'baked' };
}

interface PoseParams {
  game?: string;
  level?: number;
  x?: number;
  y?: number;
  facing: Dir4;
}

function parsePoseParams(): PoseParams | null {
  const params = new URLSearchParams(window.location.search);
  const map = params.get('map');
  const x = params.get('x');
  const y = params.get('y');
  const facing = params.get('facing');
  const game = params.get('game') ?? undefined;
  if (map === null && x === null && y === null && facing === null && game === undefined) return null;
  // Partial params are allowed (a game-only link, or game+map): missing pose
  // fields default to the loader's entrance selection.
  const f = facing !== null ? Number(facing) : 0;
  if (![0, 1, 2, 3].includes(f)) throw new Error(`facing must be 0-3, got "${facing}"`);
  return {
    game,
    level: map !== null ? Number(map) : undefined,
    x: x !== null ? Number(x) : undefined,
    y: y !== null ? Number(y) : undefined,
    facing: f as Dir4,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Game loaders — each returns a `GameView` for a chosen level + pose.
// ─────────────────────────────────────────────────────────────────────────

/** Black Crypt: the `Walker` facade over `levels.json`'s units (maps 1-13), with the M4/M5 asset stack. `startPose` may be `null` to use the map's data-derived entrance tile. */
async function loadBlackCrypt(assetBase: string, unitId: number, startPose: Pose | null): Promise<GameView> {
  const [levelsRaw, slotsRaw, semanticsRaw, bindingsRaw] = await Promise.all([
    fetchJSON<unknown>(`${assetBase}/dungeon/levels.json`),
    fetchJSON<unknown>(`${assetBase}/dungeon/slots.json`),
    fetchJSON<unknown>(`${assetBase}/dungeon/semantics.json`).catch(() => null),
    fetchJSON<unknown>(`${assetBase}/dungeon/bindings.json`).catch(() => null),
  ]);
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(levelsRaw);
  const slots = validateSlotTableFile(slotsRaw);
  const semantics: SemanticsFile = semanticsRaw
    ? validateSemanticsFile(semanticsRaw)
    : { schemaVersion: 1, confidence: 'hypothesis', source: 'tools/walker (no semantics.json found)', walls: {}, features: {} };
  const bindings: BindingsFile = bindingsRaw ? validateBindingsFile(bindingsRaw) : DEFAULT_BINDINGS;
  const unit = levelFile.units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`no unit id ${unitId} in blackcrypt dungeon/levels.json (have: ${levelFile.units.map((u) => u.id).join(', ')})`);

  const ramp = paletteRampForUnit(unit);
  const bankRef = slots.banks[0];
  if (!bankRef) throw new Error('slots.json has no piece banks');
  const { bank, palette: ramPalette, basePalette, rampSource } = await loadTilesetBank(assetBase, bankRef, unit.tileset, ramp);
  const banks: PieceBankLookup = { [bankRef.id]: bank };
  // Align every other bank's indices with the tileset's EHB index space so
  // the single-palette present renders prop art with its real colours
  // (the fromRGBA local-palette mismatch that made items/walls look wrong).
  const reindexed = (b: PieceBank) => (basePalette ? PieceBank.reindex(b, basePalette) : b);

  // Underwater/flooded-square re-tint (see WATER_ACCENT_RAMP above) -- only
  // meaningful when the bank is rendering off the tileset's raw EHB index
  // space (`rampSource === 'indexed'`); a 'baked' fallback bank has its own
  // ad-hoc local palette that a raw-index ramp file can't be swapped into.
  const waterPaletteFile =
    unit.tileset && rampSource === 'indexed'
      ? await tryFetchJSON<RampPaletteFile>(`${assetBase}/${rampPalettePath(unit.tileset, WATER_ACCENT_RAMP)}`)
      : null;
  const waterPalette = waterPaletteFile ? parseRampPalette(waterPaletteFile) : undefined;

  // M4 — real animated torches (fire-animation.json's 15-frame flame cycle).
  const fireData = await tryFetchJSON<{
    frames: number; ticksPerFrame: number; periodTicks: number;
    instances: Array<{ x: number; y: number; phaseTicks: number }>;
  }>(`${assetBase}/data/fire-animation.json`);
  if (fireData) {
    const fireBank = reindexed(await loadBank(assetBase, 'sprites/fire-animation.json', 'sprites/fire-animation.png'));
    banks['fire'] = fireBank;
    const frameNames = Array.from({ length: fireData.frames }, (_, i) => `flame${String(i).padStart(2, '0')}`);
    slots.staticSlots = [
      ...(slots.staticSlots ?? []),
      ...fireData.instances.map((inst) => ({
        draws: [{
          bank: 'fire',
          frame: { frames: frameNames, ticksPerFrame: fireData.ticksPerFrame, periodTicks: fireData.periodTicks, phase: 'fixed' as const, phaseTicks: inst.phaseTicks },
          destX: inst.x,
          destY: inst.y,
          blend: 'mask' as const,
        }],
      })),
    ];
  }

  // M5 — every other declared bank (wall-decorations, floor-items, ui-panel) generically, reindexed into the tileset's EHB palette.
  for (const ref of slots.banks.slice(1)) {
    banks[ref.id] = reindexed(await loadBank(assetBase, ref.atlas, ref.image));
  }
  const automapBank = await loadBank(assetBase, 'sprites/automap.json', 'sprites/automap.png');

  return new BlackCryptView({
    levelFile,
    unit,
    slots,
    semantics,
    bindings,
    banks,
    palette: ramPalette,
    waterPalette,
    automapBank,
    startPose: startPose ? { ...startPose, level: unit.id } : bcEntrancePose(unit),
    onInteract: (msg) => setStatus(msg),
  });
}

/** Wizardry 6: one per-level `DungeonLevelFile` + the compose-list `slots.json` + the true-indexed atlas. `startPose` may be `null` to use the level's data-derived entrance tile. */
async function loadWizardry6(assetBase: string, levelId: number, startPose: Pose | null): Promise<GameView> {
  const rawLevel = await fetchJSON<unknown>(`${assetBase}/dungeon/level${String(levelId).padStart(2, '0')}.json`);
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(rawLevel);
  const unit = levelFile.units[0]!;
  // `origin` is a W6-specific extension (absolute maze coordinate of grid
  // (0,0)) feeding the checkerboard parities (§4.7.8); not part of the
  // shared DungeonLevelFile schema, so read off the raw JSON.
  const origin = (rawLevel as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
  const planes: CellPlanes = {
    width: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.width : 16,
    height: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.height : 16,
    wallA: unit.planes.wallA,
    wallB: unit.planes.wallB,
    feature: unit.planes.feature,
    orient: unit.planes.orient,
    flagP: unit.planes.flagP,
    flagQ: unit.planes.flagQ,
    region: unit.planes.region,
    // `evalOverlay`'s dispatch key (§4.7.9) -- the requested levelId, not
    // `unit.id` (same value; the level file is always the one it names).
    level: levelId,
  };

  const slots = validateSlotTableFile(await fetchJSON<unknown>(`${assetBase}/dungeon/slots.json`));
  const bankRef = slots.banks[0]!;
  const [atlas, indexImg, maskImg, paletteFile] = await Promise.all([
    tryFetchJSON<AtlasMeta>(`${assetBase}/${bankRef.atlas}`),
    decodePNGToRGBA(`${assetBase}/${bankRef.image}`),
    decodePNGToRGBA(`${assetBase}/${bankRef.image.replace('.png', '-mask.png')}`),
    tryFetchJSON<RampPaletteFile>(`${assetBase}/${bankRef.palette ?? 'palettes/mazedata.json'}`),
  ]);
  if (!atlas || !indexImg || !maskImg || !paletteFile) {
    throw new Error(`wizardry6: missing indexed atlas/palette under ${assetBase} — run npm run w6:atlas && npm run w6:slots`);
  }
  const palette = parseRampPalette(paletteFile);
  const bank = PieceBank.fromIndexedRGBA(indexImg.rgba, maskImg.rgba, indexImg.width, indexImg.height, atlas, palette);
  // Level model for the minimap/automap (shared-edge walls; no entities yet).
  const level = new FlatGridLevel(levelFile, unit);
  // Reuse Black Crypt's generic automap tile atlas (wall/floor/facing) for now.
  const automapBank = await loadBank(getAssetBasePath('blackcrypt', 'amiga'), 'sprites/automap.json', 'sprites/automap.png');

  return new Wizardry6View({
    planes,
    slots,
    bank,
    palette,
    bindings: DEFAULT_BINDINGS,
    levelId,
    levelLabel: `Level ${String(levelId).padStart(2, '0')}`,
    startPose: startPose ?? w6EntrancePose(planes, levelId),
    level,
    automapBank,
    origin,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// The generic shell.
// ─────────────────────────────────────────────────────────────────────────

const GAMES = [
  { id: 'blackcrypt', label: 'Black Crypt', loader: loadBlackCrypt, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'wizardry6', label: 'Wizardry 6', loader: loadWizardry6, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'mm1', label: 'Might & Magic I', loader: loadMM1View, defaultLevel: 0, platform: 'dosega' as const },
  { id: 'mm2', label: 'Might & Magic II', loader: loadMM2View, defaultLevel: 0, platform: 'amiga' as const },
  { id: 'mm3', label: 'Might & Magic III', loader: loadMM3View, defaultLevel: 1, platform: 'dosvga' as const },
  { id: 'eotb', label: 'Eye of the Beholder', loader: loadEotb1View, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'eotb2', label: 'Eye of the Beholder II', loader: loadEotb2View, defaultLevel: 1, platform: 'dosvga' as const },
  { id: 'landsoflore', label: 'Lands of Lore', loader: loadLandsOfLoreView, defaultLevel: 1, platform: 'dosvga' as const },
  { id: 'poolofradiance', label: 'Pool of Radiance', loader: loadPoolOfRadianceView, defaultLevel: 0, platform: 'amiga' as const },
  { id: 'curseoftheazurebonds', label: 'Curse of the Azure Bonds', loader: loadCurseOfTheAzureBondsView, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'secretofthesilverblades', label: 'Secret of the Silver Blades', loader: loadSecretOfTheSilverBladesView, defaultLevel: 16, platform: 'amiga' as const },
  { id: 'poolsofdarkness', label: 'Pools of Darkness', loader: loadPoolsOfDarknessView, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'darkqueenofkrynn', label: 'The Dark Queen of Krynn', loader: loadDarkQueenOfKrynnView, defaultLevel: 2, platform: 'amiga' as const },
  { id: 'gatewaytothesavagefrontier', label: 'Gateway to the Savage Frontier', loader: loadGatewayToTheSavageFrontierView, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'treasureofthesavagefrontier', label: 'Treasures of the Savage Frontier', loader: loadTreasuresOfTheSavageFrontierView, defaultLevel: 1, platform: 'amiga' as const },
  { id: 'championsofkrynn', label: 'Champions of Krynn', loader: loadChampionsOfKrynnView, defaultLevel: 1032, platform: 'amiga' as const },
  { id: 'deathknightsofkrynn', label: 'Death Knights of Krynn', loader: loadDeathKnightsOfKrynnView, defaultLevel: 1032, platform: 'amiga' as const },
  { id: 'ishar', label: 'Ishar 1', loader: loadIshar1View, defaultLevel: 1, platform: 'amigaaga' as const },
  { id: 'ishar2', label: 'Ishar 2', loader: loadIshar2View, defaultLevel: 1, platform: 'amigaaga' as const },
  { id: 'ishar3', label: 'Ishar 3', loader: loadIshar3View, defaultLevel: 1, platform: 'amigaaga' as const },
  { id: 'crystalsofarborea', label: 'Crystals of Arborea', loader: crystalsOfArboreaLoader, defaultLevel: 0, platform: 'amiga' as const },
] as const;

type GameId = (typeof GAMES)[number]['id'];

/** Per-game override for the confidence banner's parenthetical note; falls back to the generic W6 string above when unset. */
const CONFIDENCE_NOTES: Partial<Record<GameId, string>> = {
  poolofradiance: 'maze connectivity confirmed; wall art is per-cell where the level ECL script resolves it (0/29 levels here), a real per-level texture elsewhere -- see tools/shared/goldbox-ecl.ts',
  curseoftheazurebonds: 'maze connectivity confirmed; wall art is per-cell where the level ECL script resolves it (10/16 levels), a real per-level texture elsewhere -- see tools/shared/goldbox-ecl.ts',
  secretofthesilverblades: 'maze connectivity confirmed; wall art is per-cell where the level ECL script resolves it (5/17 levels), a real per-level texture elsewhere -- see tools/shared/goldbox-ecl.ts',
  poolsofdarkness: 'maze connectivity confirmed; wall art is per-cell where the level ECL script resolves it (0/32 levels here), a real per-level texture elsewhere -- see tools/shared/goldbox-ecl.ts',
  darkqueenofkrynn: 'maze connectivity + doors confirmed (variable-size GEO grid, a new record shape for this title); wall art NOT yet decoded (not confirmed absent -- real tile-pixel data + resolvable ECL wallset-binding calls both exist, but no WALLDEF-equivalent compositing table has been located yet) -- see docs/darkqueenofkrynn/amiga/data-structure.md',
  gatewaytothesavagefrontier: 'maze connectivity confirmed; wall art is per-cell where the level ECL script resolves it (22/30 levels, v1.1 opcode table unchanged), a real per-level texture elsewhere -- see tools/shared/goldbox-ecl.ts',
  treasureofthesavagefrontier: 'maze connectivity confirmed; wall art per-cell for every dungeon level (29/41 via an executable-hardcoded wallset table the ECL bytecode itself ignores, 87 slots) -- wilderness levels 51-62 still unresolved -- see docs/treasureofthesavagefrontier/amiga/data-structure.md',
  championsofkrynn: 'maze connectivity + doors confirmed (2 campaign banks, level ids namespaced bank*1000+geoId); container is a genuinely different "DOS DaxFile" format from Pool of Radiance\'s own .dax codec -- see tools/shared/goldbox-dosdax.ts. ECL wallset-slot resolution 15/15 levels (v1.1 opcode table, base 0x8000, LOAD PIECES/0x37 -- same engine revision as PoR/Curse/Secret). Real wall art renders for bank 1 (confirmed visually against the 8X8D1.DAX tile bank); bank 2 reuses bank-1 tiles by id coincidence only where one exists -- see docs/championsofkrynn/amiga/data-structure.md',
  deathknightsofkrynn: 'maze connectivity + doors confirmed (3 campaign banks, level ids namespaced bank*1000+geoId, same DOS DaxFile container as Champions of Krynn); ECL wallset-slot resolution 16/19 levels, same v1.1/0x8000/LOAD PIECES engine revision as Champions of Krynn (an earlier Pools-of-Darkness-style v1.3 hypothesis was tested and refuted by manual disassembly -- see data-structure.md). No confirmed 8x8-tile pixel source exists for this title\'s wall art (its only 8x8d1.daa resists every container/codec hypothesis tried) -- cells render via the walker\'s generic placeholder texture -- see docs/deathknightsofkrynn/amiga/data-structure.md',
  ishar: 'top-down world-region map (confirmed geometry); press F for a real first-person view of CONT1\'s forest biome (executed ALIS bytecode, greyscale/no palette) -- not generalized to other biomes yet -- see tools/walker/games-ishar.ts',
  ishar2: 'top-down world-region map (confirmed geometry); first-person view not yet decoded for this title -- see tools/walker/games-ishar.ts',
  ishar3: 'top-down world-region map (confirmed geometry); first-person view not yet decoded for this title -- see tools/walker/games-ishar.ts',
  crystalsofarborea: 'party-roster/travel checklist UI (confirmed structure + real map picture); no destination-graph/hotspot mechanism decoded yet -- see tools/walker/games-crystalsofarborea.ts',
};

/**
 * Wizardry 6 graphics-variant plumbing (the `#variant` selector, anticipated
 * by `index.html` but unwired until this session). Amiga is the existing
 * default; SNES (`games-w6-snes.ts`) is the compose-piece-library-driven v1
 * dungeon-view renderer -- see its module doc comment for what's confirmed
 * vs. approximate. Only `wizardry6` currently has more than one variant, so
 * this stays a small local map rather than a generalized per-game axis.
 */
const W6_VARIANTS = [
  { id: 'amiga', label: 'Amiga', platform: 'amiga' as const },
  { id: 'snes', label: 'SNES', platform: 'snes' as const },
] as const;
type W6VariantId = (typeof W6_VARIANTS)[number]['id'];
let w6Variant: W6VariantId = 'amiga';

function platformFor(game: GameId): (typeof GAMES)[number]['platform'] | (typeof W6_VARIANTS)[number]['platform'] {
  if (game === 'wizardry6') return W6_VARIANTS.find((v) => v.id === w6Variant)!.platform;
  return GAMES.find((g) => g.id === game)!.platform;
}

async function listLevels(game: GameId, assetBase: string): Promise<Array<{ id: number; label: string }>> {
  if (game === 'mm1') return mmLevelLists.mm1();
  if (game === 'mm2') return mmLevelLists.mm2();
  if (game === 'mm3') return mm3LevelList();
  if (game === 'eotb') return eotbLevelList(assetBase);
  if (game === 'eotb2') return eotb2LevelList(assetBase);
  if (game === 'landsoflore') return landsofloreLevelList(assetBase);
  if (game === 'ishar') return isharLevelLists.ishar();
  if (game === 'ishar2') return isharLevelLists.ishar2();
  if (game === 'ishar3') return isharLevelLists.ishar3();
  if (game === 'crystalsofarborea') return crystalsOfArboreaLevelList();
  if (game === 'blackcrypt') {
    const lv = await fetchJSON<DungeonLevelFile>(`${assetBase}/dungeon/levels.json`);
    return lv.units.map((u) => ({ id: u.id, label: u.name ?? `Map ${u.id}` }));
  }
  if (game === 'wizardry6' && w6Variant === 'snes') return wizardry6SnesLevelList(assetBase);
  const index = await fetchJSON<{ levels: Array<{ id: number; file: string }> }>(`${assetBase}/dungeon/levels-index.json`);
  return index.levels.map((l) => ({ id: l.id, label: `Level ${String(l.id).padStart(2, '0')}` }));
}

async function main() {
  const params = parsePoseParams();
  const urlGame = params?.game as GameId | undefined;
  const startGame: GameId = GAMES.some((g) => g.id === urlGame) ? urlGame! : 'blackcrypt';
  const urlVariant = new URLSearchParams(window.location.search).get('variant');
  if (W6_VARIANTS.some((v) => v.id === urlVariant)) w6Variant = urlVariant as W6VariantId;
  const startLevel =
    params?.level ??
    (startGame === 'wizardry6' && w6Variant === 'snes' ? 0 : GAMES.find((g) => g.id === startGame)!.defaultLevel);

  for (const g of GAMES) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    gameSelect.appendChild(opt);
  }
  gameSelect.value = startGame;
  for (const v of W6_VARIANTS) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    variantSelect.appendChild(opt);
  }
  variantSelect.value = w6Variant;
  variantSelect.style.display = startGame === 'wizardry6' ? '' : 'none';
  noclipCheck.checked = false;

  let view: GameView;
  let lastItems: unknown = null;
  let automapZoomedOut = false;

  const keys = new KeyState(window);
  const surface = new IndexedSurface(320, 200);
  const presenter = new CanvasPresenter(canvas.getContext('2d')!);
  canvas.width = surface.width;
  canvas.height = surface.height;
  const minimap = new Minimap(minimapCanvas.getContext('2d')!, { radius: MINIMAP_RADIUS });
  const automapPresenter = new CanvasPresenter(automapCanvas.getContext('2d')!);

  async function loadGame(game: GameId, levelId: number, pose: Pose | null): Promise<void> {
    const g = GAMES.find((x) => x.id === game)!;
    const assetBase = getAssetBasePath(game, platformFor(game));
    setStatus(`loading ${g.label}…`);

    view =
      game === 'wizardry6' && w6Variant === 'snes'
        ? await loadWizardry6Snes(assetBase, levelId, pose)
        : await g.loader(assetBase, levelId, pose);
    const confidenceNote =
      game === 'wizardry6' && w6Variant === 'snes'
        ? 'SNES: confirmed backdrop + door, approximate generic wall art -- see tools/wizardry6/snes/view-model.ts'
        : (CONFIDENCE_NOTES[game] ?? 'W6 wall values are a rendered key');
    setConfidenceBanner(view.id === 'blackcrypt' ? 'confirmed' : 'rendered', `${g.label} (${confidenceNote})`);

    variantSelect.style.display = game === 'wizardry6' ? '' : 'none';
    variantSelect.value = w6Variant;

    levelSelect.innerHTML = '';
    const levels = await listLevels(game, assetBase);
    for (const l of levels) {
      const opt = document.createElement('option');
      opt.value = String(l.id);
      opt.textContent = l.label;
      levelSelect.appendChild(opt);
    }
    levelSelect.value = String(levelId);

    const hasAutomap = !!view.automap;
    const hasMinimap = hasAutomap || !!view.renderMinimap;
    minimapCanvas.style.display = hasMinimap ? '' : 'none';
    automapCanvas.style.display = hasAutomap ? '' : 'none';
    document.querySelectorAll<HTMLElement>('#sidebar .panel').forEach((p) => {
      p.style.display = hasMinimap ? '' : 'none';
    });

    noclipCheck.checked = false;
    view.setNoclip(false);

    surface.clear(0);
    lastItems = null;
    renderAll();
  }

  function setConfidenceBanner(confidence: string, source: string) {
    confidenceEl.textContent = `semantics: ${confidence}`;
    confidenceEl.title = source;
    confidenceEl.classList.remove('confirmed', 'rendered', 'hypothesis');
    confidenceEl.classList.add(confidence);
  }

  function renderMainView(): number {
    if (view.renderCanvas) {
      // Full-colour renderers (MM1/MM2) draw the whole canvas themselves.
      view.renderCanvas(canvas.getContext('2d')!);
      return view.items.length;
    }
    const items = view.items;
    if (items !== lastItems) {
      lastItems = items;
      surface.clear(0);
      compositeDrawList(surface, view.banks, view.slots, items, view.currentTick);
      presenter.present(surface, view.palette);
    }
    return items.length;
  }

  function automapOrigin(): { x: number; y: number } {
    const { height } = view.automap!;
    const pose = view.pose;
    return automapZoomedOut
      ? { x: 0, y: height - 1 }
      : { x: pose.x - AUTOMAP_WINDOW_RADIUS, y: pose.y + AUTOMAP_WINDOW_RADIUS };
  }

  function renderAutomapPanel() {
    if (!view.automap) return;
    const { level, bank, state, width, height } = view.automap;
    const pose = view.pose;
    const span = automapZoomedOut
      ? Math.max(width, height)
      : AUTOMAP_WINDOW_RADIUS * 2 + 1;
    const origin = automapOrigin();
    const size = span * AUTOMAP_TILE_SIZE;
    automapCanvas.width = size;
    automapCanvas.height = size;
    const automapSurface = new IndexedSurface(size, size);
    renderAutomap(automapSurface, bank, level, state.visitedCells(pose.level), origin, {
      party: { x: pose.x, y: pose.y, facing: pose.facing },
    });
    automapPresenter.present(automapSurface, bank.palette);
  }

  function setStatusLine() {
    const pose = view.pose;
    const mapped = view.automap
      ? `${view.automap.state.visitedCount(pose.level)}/${view.automap.width * view.automap.height} cells mapped`
      : 'no automap';
    setStatus(
      `${view.gameLabel} — ${view.levelLabel} @ (${pose.x},${pose.y}) facing ${'NESW'[pose.facing]} — ` +
        `${view.items.length} draw items — ${mapped}` +
        (automapZoomedOut ? ' [automap: full]' : ''),
    );
  }

  function renderAll() {
    renderMainView();
    if (view.renderMinimap) {
      view.renderMinimap(minimapCanvas.getContext('2d')!);
    } else if (view.automap) {
      minimap.render(view.automap.level, view.pose);
    }
    renderAutomapPanel();
    setStatusLine();
  }

  gameSelect.addEventListener('change', () => {
    const game = gameSelect.value as GameId;
    const g = GAMES.find((x) => x.id === game)!;
    if (game !== 'wizardry6') w6Variant = 'amiga'; // reset so switching away and back doesn't stick on SNES silently
    variantSelect.style.display = game === 'wizardry6' ? '' : 'none';
    variantSelect.value = w6Variant;
    const defaultLevel = game === 'wizardry6' && w6Variant === 'snes' ? 0 : g.defaultLevel;
    // Entrance pose: `null` makes the loader place the viewer at the map's
    // data-derived entrance tile.
    loadGame(game, defaultLevel, null);
  });
  levelSelect.addEventListener('change', () => {
    loadGame(gameSelect.value as GameId, Number(levelSelect.value), null);
  });
  variantSelect.addEventListener('change', () => {
    w6Variant = variantSelect.value as W6VariantId;
    const defaultLevel = w6Variant === 'snes' ? 0 : GAMES.find((g) => g.id === 'wizardry6')!.defaultLevel;
    loadGame('wizardry6', defaultLevel, null);
  });
  noclipCheck.addEventListener('change', () => view.setNoclip(noclipCheck.checked));

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    view.pick(canvasX, canvasY, presenter.scale);
  });

  // Click the minimap to teleport to that cell (inverse of Minimap.render's
  // layout: col = dx + radius, row = radius - dy, cellPx = 8).
  minimapCanvas.addEventListener('click', (ev) => {
    if (!view.automap) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * minimapCanvas.width;
    const py = ((ev.clientY - rect.top) / rect.height) * minimapCanvas.height;
    const cellPx = 8;
    const radius = 6;
    const col = Math.floor(px / cellPx);
    const row = Math.floor(py / cellPx);
    const x = view.pose.x + (col - radius);
    const y = view.pose.y + (radius - row);
    const { width, height } = view.automap;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    view.setPose({ level: view.pose.level, x, y, facing: view.pose.facing });
    view.automap?.state.onEnterCell(view.pose.level, x, y);
    renderAll();
  });

  const initialPose: Pose | null =
    params && params.game === startGame && params.level === startLevel && params.x !== undefined && params.y !== undefined
      ? { level: startLevel, x: params.x, y: params.y, facing: params.facing }
      : null; // null = the loader's data-derived entrance tile
  await loadGame(startGame, startLevel, initialPose);

  let lastTime = performance.now();
  function frame(now: number) {
    const dtMs = now - lastTime;
    lastTime = now;

    const newPose = view.update(dtMs, keys);

    if (view.interactCodes().some((c) => keys.consumePress(c))) {
      setStatus('interact: use mouse click on a hotspot (alcove/plaque/door-switch/door-lock)');
    }
    if (view.automapCodes().some((c) => keys.consumePress(c))) {
      automapZoomedOut = !automapZoomedOut;
      renderAutomapPanel();
      setStatusLine();
    }

    renderMainView(); // cheap: only recomposites when the view is dirty
    if (newPose) {
      view.automap?.state.onEnterCell(newPose.level, newPose.x, newPose.y);
      if (view.renderMinimap) {
        view.renderMinimap(minimapCanvas.getContext('2d')!);
      } else if (view.automap) {
        minimap.render(view.automap.level, newPose);
      }
      renderAutomapPanel();
      setStatusLine();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

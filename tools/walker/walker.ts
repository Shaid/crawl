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
import type { CellPlanes } from '../wizardry6/evaluate-cell.ts';

const statusEl = document.getElementById('status')!;
const confidenceEl = document.getElementById('confidence')!;
const gameSelect = document.getElementById('game') as HTMLSelectElement;
const levelSelect = document.getElementById('level') as HTMLSelectElement;
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
  const { bank, palette: ramPalette, basePalette } = await loadTilesetBank(assetBase, bankRef, unit.tileset, ramp);
  const banks: PieceBankLookup = { [bankRef.id]: bank };
  // Align every other bank's indices with the tileset's EHB index space so
  // the single-palette present renders prop art with its real colours
  // (the fromRGBA local-palette mismatch that made items/walls look wrong).
  const reindexed = (b: PieceBank) => (basePalette ? PieceBank.reindex(b, basePalette) : b);

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
    automapBank,
    startPose: startPose ? { ...startPose, level: unit.id } : bcEntrancePose(unit),
    onInteract: (msg) => setStatus(msg),
  });
}

/** Wizardry 6: one per-level `DungeonLevelFile` + the compose-list `slots.json` + the true-indexed atlas. `startPose` may be `null` to use the level's data-derived entrance tile. */
async function loadWizardry6(assetBase: string, levelId: number, startPose: Pose | null): Promise<GameView> {
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(
    await fetchJSON<unknown>(`${assetBase}/dungeon/level${String(levelId).padStart(2, '0')}.json`),
  );
  const unit = levelFile.units[0]!;
  const planes: CellPlanes = {
    width: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.width : 16,
    height: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.height : 16,
    wallA: unit.planes.wallA,
    wallB: unit.planes.wallB,
    feature: unit.planes.feature,
    orient: unit.planes.orient,
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
] as const;

type GameId = (typeof GAMES)[number]['id'];

async function listLevels(game: GameId, assetBase: string): Promise<Array<{ id: number; label: string }>> {
  if (game === 'mm1') return mmLevelLists.mm1();
  if (game === 'mm2') return mmLevelLists.mm2();
  if (game === 'blackcrypt') {
    const lv = await fetchJSON<DungeonLevelFile>(`${assetBase}/dungeon/levels.json`);
    return lv.units.map((u) => ({ id: u.id, label: u.name ?? `Map ${u.id}` }));
  }
  const index = await fetchJSON<{ levels: Array<{ id: number; file: string }> }>(`${assetBase}/dungeon/levels-index.json`);
  return index.levels.map((l) => ({ id: l.id, label: `Level ${String(l.id).padStart(2, '0')}` }));
}

async function main() {
  const params = parsePoseParams();
  const urlGame = params?.game as GameId | undefined;
  const startGame: GameId = GAMES.some((g) => g.id === urlGame) ? urlGame! : 'blackcrypt';
  const startLevel = params?.level ?? GAMES.find((g) => g.id === startGame)!.defaultLevel;

  for (const g of GAMES) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    gameSelect.appendChild(opt);
  }
  gameSelect.value = startGame;
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
    const assetBase = getAssetBasePath(game, g.platform);
    setStatus(`loading ${g.label}…`);

    view = await g.loader(assetBase, levelId, pose);
    setConfidenceBanner(view.id === 'blackcrypt' ? 'confirmed' : 'rendered', `${g.label} (W6 wall values are a rendered key)`);

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
        `${view.items.length} draw items — tick ${Math.floor(view.currentTick)} — ${mapped}` +
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
    // Entrance pose: `null` makes the loader place the viewer at the map's
    // data-derived entrance tile.
    loadGame(game, g.defaultLevel, null);
  });
  levelSelect.addEventListener('change', () => {
    loadGame(gameSelect.value as GameId, Number(levelSelect.value), null);
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
    } else {
      setStatusLine(); // keep the tick counter live without touching automap/minimap
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

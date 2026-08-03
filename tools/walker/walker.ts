/**
 * Dungeon walker harness — M3: keyboard-driven movement, collision, a live
 * minimap + automap panel, and a `semantics.confidence` banner.
 *
 * The pose in the URL (`?map=&x=&y=&facing=`, from M2) is now just the
 * *starting* pose — walk it with WASD+QE (or arrows), and it stays
 * shareable as a link since the URL isn't rewritten as you move. If no pose
 * is given, a real, verified-open loop in map 1 (see
 * `packages/dungeon/src/__tests__/collision.test.ts`'s loop-closure test)
 * is the default, so the harness is walkable with zero setup.
 *
 * M1's static-corridor demo (no real map, just `slots.json` alone) is
 * retired now that real movement over real map data is the point of this
 * harness; M2's pose-only rendering is still exactly what happens on the
 * very first frame, before any key is pressed.
 */
import {
  PieceBank,
  IndexedSurface,
  compositeDrawList,
  CanvasPresenter,
  FlatGridLevel,
  buildViewList,
  viewSpecFromSlotTable,
  canStep,
  WalkerController,
  AutomapState,
  renderAutomap,
  Minimap,
  type PieceBankLookup,
  type Pose,
  type Dir4,
} from '@seer/dungeon';
import {
  validateSlotTableFile,
  validateDungeonLevelFile,
  validateSemanticsFile,
  validateBindingsFile,
  DEFAULT_BINDINGS,
  type SemanticsFile,
  type DungeonLevelFile,
  type BindingsFile,
} from '@seer/dungeon/schema';
import { KeyState } from '@seer/engine-2d/input';
import type { AtlasMeta } from '@seer/core';
import { getAssetBasePath } from '../shared/viewer-config.ts';

const statusEl = document.getElementById('status')!;
const confidenceEl = document.getElementById('confidence')!;
const canvas = document.getElementById('surface') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
const automapCanvas = document.getElementById('automap') as HTMLCanvasElement;

/** A real, verified-open 2x2 loop in map 1 (bcdfb) — see collision.test.ts. */
const DEFAULT_POSE: Pose = { level: 1, x: 35, y: 1, facing: 1 };

const MINIMAP_RADIUS = 6;
const AUTOMAP_WINDOW_RADIUS = 8;
const AUTOMAP_TILE_SIZE = 8;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setConfidenceBanner(confidence: SemanticsFile['confidence'], source: string) {
  confidenceEl.textContent = `semantics: ${confidence}`;
  confidenceEl.title = source;
  confidenceEl.classList.remove('confirmed', 'rendered', 'hypothesis');
  confidenceEl.classList.add(confidence);
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Decode a PNG at `url` to interleaved RGBA bytes via an offscreen canvas. */
function decodePNGToRGBA(url: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
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
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

async function loadBank(assetBase: string, atlasPath: string, imagePath: string): Promise<PieceBank> {
  const atlas = await fetchJSON<AtlasMeta>(`${assetBase}/${atlasPath}`);
  const { rgba, width, height } = await decodePNGToRGBA(`${assetBase}/${imagePath}`);
  return PieceBank.fromRGBA(rgba, width, height, atlas);
}

function parsePoseParams(): Pose | null {
  const params = new URLSearchParams(window.location.search);
  const map = params.get('map');
  const x = params.get('x');
  const y = params.get('y');
  const facing = params.get('facing');
  if (map === null || x === null || y === null || facing === null) return null;
  const f = Number(facing);
  if (![0, 1, 2, 3].includes(f)) throw new Error(`facing must be 0-3, got "${facing}"`);
  return { level: Number(map), x: Number(x), y: Number(y), facing: f as Dir4 };
}

async function main() {
  const assetBase = getAssetBasePath('blackcrypt', 'amiga');

  setStatus('loading dungeon/{levels,slots,semantics,bindings}.json…');
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
  setConfidenceBanner(semantics.confidence, semantics.source);

  const startPose = parsePoseParams() ?? DEFAULT_POSE;
  const unit = levelFile.units.find((u) => u.id === startPose.level);
  if (!unit) throw new Error(`no unit with id ${startPose.level} in dungeon/levels.json (have: ${levelFile.units.map((u) => u.id).join(', ')})`);
  const unitLabel = unit.name ?? unit.id;

  setStatus('decoding textures…');
  const bankRef = slots.banks[0];
  if (!bankRef) throw new Error('slots.json has no piece banks');
  const bank = await loadBank(assetBase, bankRef.atlas, bankRef.image);
  const banks: PieceBankLookup = { [bankRef.id]: bank };

  const automapBank = await loadBank(assetBase, 'sprites/automap.json', 'sprites/automap.png');

  const level = new FlatGridLevel(levelFile, unit);
  const spec = viewSpecFromSlotTable(slots);

  const cellSpace = levelFile.cellSpace;
  const worldWidth = cellSpace.kind === 'flat' ? cellSpace.width : 64;
  const worldHeight = cellSpace.kind === 'flat' ? cellSpace.height : 64;

  const automapState = new AutomapState(() => ({ width: worldWidth, height: worldHeight }));
  automapState.onEnterCell(startPose.level, startPose.x, startPose.y);

  const controller = new WalkerController(startPose, bindings, {
    canStep: (pose, dir) => canStep(level, semantics, pose, dir),
  });

  const keys = new KeyState(window);
  let automapZoomedOut = false;

  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  const presenter = new CanvasPresenter(canvas.getContext('2d')!);
  canvas.width = surface.width;
  canvas.height = surface.height;

  const minimap = new Minimap(minimapCanvas.getContext('2d')!, { radius: MINIMAP_RADIUS });
  const automapPresenter = new CanvasPresenter(automapCanvas.getContext('2d')!);

  function renderMainView(pose: Pose): number {
    const items = buildViewList(level, pose, spec, semantics, slots);
    surface.clear(0);
    compositeDrawList(surface, banks, slots, items);
    presenter.present(surface, bank.palette);
    return items.length;
  }

  function renderAutomapPanel(pose: Pose) {
    const span = automapZoomedOut ? Math.max(worldWidth, worldHeight) : AUTOMAP_WINDOW_RADIUS * 2 + 1;
    const origin = automapZoomedOut
      ? { x: 0, y: worldHeight - 1 }
      : { x: pose.x - AUTOMAP_WINDOW_RADIUS, y: pose.y + AUTOMAP_WINDOW_RADIUS };
    const size = span * AUTOMAP_TILE_SIZE;
    automapCanvas.width = size;
    automapCanvas.height = size;
    const automapSurface = new IndexedSurface(size, size);
    renderAutomap(
      automapSurface,
      automapBank,
      level,
      automapState.visitedCells(pose.level),
      origin,
      { party: { x: pose.x, y: pose.y, facing: pose.facing } },
    );
    automapPresenter.present(automapSurface, automapBank.palette);
  }

  function renderAll(pose: Pose, itemCount: number) {
    setStatus(
      `map ${unitLabel} @ (${pose.x},${pose.y}) facing ${'NESW'[pose.facing]} — ${itemCount} draw items — ` +
      `${automapState.visitedCount(pose.level)}/${worldWidth * worldHeight} cells mapped` +
      (automapZoomedOut ? ' [automap: full]' : ' [automap: local]'),
    );
    minimap.render(level, pose);
    renderAutomapPanel(pose);
  }

  let itemCount = renderMainView(controller.pose);
  renderAll(controller.pose, itemCount);

  let lastTime = performance.now();
  function frame(now: number) {
    const dtMs = now - lastTime;
    lastTime = now;

    const newPose = controller.update(dtMs, keys);

    if (controller.interactCodes().some((c) => keys.consumePress(c))) {
      setStatus('interact: no hotspots yet (M4) — pressed anyway, plumbing works');
    }
    if (controller.automapCodes().some((c) => keys.consumePress(c))) {
      automapZoomedOut = !automapZoomedOut;
      renderAll(controller.pose, itemCount);
    }

    if (newPose) {
      automapState.onEnterCell(newPose.level, newPose.x, newPose.y);
      itemCount = renderMainView(newPose);
      renderAll(newPose, itemCount);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

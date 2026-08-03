/**
 * Dungeon walker harness — M4: mouse-pick interaction (click a hotspot),
 * an entity-state cheat toggle, animated torches (the real
 * `fire-animation.json`/`sprites/fire-animation.png` data), and ramp-aware
 * rendering (loads the indexed atlas + the *current unit's own*
 * `LevelUnit.paletteRamp`, not always the tileset's primary ramp — fixes
 * levels 12-13, which serve `bcdfx` under ramp 3 rather than ramp 0).
 *
 * Movement/collision/automap (M3) are unchanged; `Walker` (the M4 facade in
 * `@seer/dungeon`) now owns pose + the last-built view + entity patches +
 * the animation clock in place of this harness manually driving
 * `WalkerController`/`buildViewList`/`compositeDrawList` itself.
 */
import {
  PieceBank,
  IndexedSurface,
  compositeDrawList,
  CanvasPresenter,
  FlatGridLevel,
  canStep,
  AutomapState,
  renderAutomap,
  Minimap,
  Walker,
  doorState,
  parseRampPalette,
  paletteRampForUnit,
  rampPalettePath,
  indexedTilesetPaths,
  type PieceBankLookup,
  type RGBAColor,
  type RampPaletteFile,
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
  type SlotTableFile,
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

// Each tileset's *primary* accent ramp -- the one export_dungeon_tileset_
// indexed.py bakes into the indexed PNG's own embedded palette, needed to
// *recover* the raw EHB index from a canvas-decoded RGBA readback
// (PieceBank.fromIndexedRGBA's basePalette). Confirmed real data
// (bclib.palette.tileset_ramps): bcdfx -> [0,3], bcdfy -> [1], bcdfz -> [2].
const TILESET_PRIMARY_RAMP: Record<string, number> = { bcdfx: 0, bcdfy: 1, bcdfz: 2 };

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

async function tryFetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Decode a PNG at `url` to interleaved RGBA bytes via an offscreen canvas. Returns `null` on a 404 (used for the optional indexed-atlas path). */
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

/**
 * The current unit's own accent-ramp palette (M4 "ramp-aware rendering") —
 * tries the real indexed atlas + `palettes/dungeon-<tileset>-ramp<N>.json`
 * first (correct for every ramp a tileset serves, including bcdfx's ramp 3
 * on levels 12-13); falls back to the plain RGBA atlas + its own baked
 * palette (M1-M3's path, always that atlas's *one* baked ramp) if the
 * indexed assets aren't present for some reason.
 */
async function loadTilesetBank(
  assetBase: string,
  bankRef: SlotTableFile['banks'][number],
  tileset: string | undefined,
  targetRamp: number,
): Promise<{ bank: PieceBank; palette: RGBAColor[]; rampSource: 'indexed' | 'baked' }> {
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
      return { bank, palette, rampSource: 'indexed' };
    }
  }
  const bank = await loadBank(assetBase, bankRef.atlas, bankRef.image);
  return { bank, palette: bank.palette, rampSource: 'baked' };
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
  const ramp = paletteRampForUnit(unit);

  setStatus('decoding textures…');
  const bankRef = slots.banks[0];
  if (!bankRef) throw new Error('slots.json has no piece banks');
  const { bank, palette: ramPalette, rampSource } = await loadTilesetBank(assetBase, bankRef, unit.tileset, ramp);
  const banks: PieceBankLookup = { [bankRef.id]: bank };

  // M4 -- real animated torches: fire-animation.json's 15-frame flame cycle,
  // 4 fixed screen-space instances with their own phaseTicks (data proven,
  // not synthesized -- see raster/anim.ts / schema/slots.ts's AnimRef).
  const fireData = await tryFetchJSON<{
    frames: number; ticksPerFrame: number; periodTicks: number;
    instances: Array<{ x: number; y: number; phaseTicks: number }>;
  }>(`${assetBase}/data/fire-animation.json`);
  if (fireData) {
    const fireBank = await loadBank(assetBase, 'sprites/fire-animation.json', 'sprites/fire-animation.png');
    banks['fire'] = fireBank;
    const frameNames = Array.from({ length: fireData.frames }, (_, i) => `flame${String(i).padStart(2, '0')}`);
    slots.staticSlots = [
      ...(slots.staticSlots ?? []),
      ...fireData.instances.map((inst) => ({
        draws: [
          {
            bank: 'fire',
            frame: { frames: frameNames, ticksPerFrame: fireData.ticksPerFrame, periodTicks: fireData.periodTicks, phase: 'fixed' as const, phaseTicks: inst.phaseTicks },
            destX: inst.x,
            destY: inst.y,
            blend: 'mask' as const,
          },
        ],
      })),
    ];
  }

  // M5 -- door-lock's per-map `wall-decorations` frames and floor-item's
  // `dungeon-floor-items` frames are plain RGBA banks (no ramp/indexing,
  // unlike the main tileset), registered by their own `slots.banks` id.
  // `slots.banks[0]` (the main tileset) is already loaded above via
  // `loadTilesetBank`'s ramp-aware path; load every other declared bank
  // generically so a slot referencing it (`prop:door-lock:*`,
  // `resolveFloorItem`'s frames) doesn't throw "unknown bank" at draw time.
  for (const ref of slots.banks.slice(1)) {
    banks[ref.id] = await loadBank(assetBase, ref.atlas, ref.image);
  }

  const automapBank = await loadBank(assetBase, 'sprites/automap.json', 'sprites/automap.png');

  const level = new FlatGridLevel(levelFile, unit);

  const cellSpace = levelFile.cellSpace;
  const worldWidth = cellSpace.kind === 'flat' ? cellSpace.width : 64;
  const worldHeight = cellSpace.kind === 'flat' ? cellSpace.height : 64;

  const automapState = new AutomapState(() => ({ width: worldWidth, height: worldHeight }));
  automapState.onEnterCell(startPose.level, startPose.x, startPose.y);

  const walker = new Walker(level, slots, semantics, banks, startPose, bindings, {
    canStep: (pose, dir) => canStep(level, semantics, pose, dir),
  });
  walker.onInteract = (hotspot, entity, handle) => {
    let msg = `interact: hotspot 0x${hotspot.code.toString(16)}`;
    if (entity && handle) {
      // M4 cheat toggle (per walker-plan.md: "the debug harness ships it as
      // an explicit cheat toggle") -- flips a door-ish entity's open bit via
      // Walker.setEntityState, with zero opinion about whether it's locked.
      const before = doorState(entity);
      walker.setEntityState(handle, { open: !before.open });
      // Re-read through `walker.items` (not the stale `entity` closed over
      // above) -- setEntityState patches PatchedCellQuery's overlay, which
      // only shows up on the next rebuilt `items` read (triggered by this
      // getter access, since setEntityState marked the view dirty), never
      // by mutating the object already in hand.
      const patched = walker.items.find((i) => i.entityHandle === handle);
      const after = patched?.entity ? doorState(patched.entity) : null;
      msg += ` on ${handle} — door state ${JSON.stringify(before)} -> requested open:${!before.open} (now: ${JSON.stringify(after)})`;
    }
    setStatus(msg);
  };

  const keys = new KeyState(window);
  let automapZoomedOut = false;

  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  const presenter = new CanvasPresenter(canvas.getContext('2d')!);
  canvas.width = surface.width;
  canvas.height = surface.height;

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    walker.pick(canvasX, canvasY, presenter.scale);
  });

  const minimap = new Minimap(minimapCanvas.getContext('2d')!, { radius: MINIMAP_RADIUS });
  const automapPresenter = new CanvasPresenter(automapCanvas.getContext('2d')!);

  let lastItems: unknown = null;
  function renderMainView(): number {
    const items = walker.items;
    if (items !== lastItems) {
      lastItems = items;
      surface.clear(0);
      compositeDrawList(surface, banks, slots, items, walker.currentTick);
      presenter.present(surface, ramPalette);
    }
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

  function setStatusLine(pose: Pose, itemCount: number) {
    setStatus(
      `map ${unitLabel} @ (${pose.x},${pose.y}) facing ${'NESW'[pose.facing]} — ${itemCount} draw items — ` +
      `ramp ${ramp} (${rampSource}) — tick ${Math.floor(walker.currentTick)} — ` +
      `${automapState.visitedCount(pose.level)}/${worldWidth * worldHeight} cells mapped` +
      (automapZoomedOut ? ' [automap: full]' : ' [automap: local]'),
    );
  }

  // minimap/automap redraw only on an actual pose change (or an explicit
  // zoom toggle) -- unlike the main view (cheap: Walker's own dirty flag
  // already gates its recomposite), a zoomed-out automap surface can be up
  // to 64x64 tiles and isn't worth rebuilding on every animation tick.
  function renderAll(pose: Pose, itemCount: number) {
    setStatusLine(pose, itemCount);
    minimap.render(level, pose);
    renderAutomapPanel(pose);
  }

  let itemCount = renderMainView();
  renderAll(walker.pose, itemCount);

  let lastTime = performance.now();
  function frame(now: number) {
    const dtMs = now - lastTime;
    lastTime = now;

    const newPose = walker.update(dtMs, keys);

    if (walker.interactCodes().some((c) => keys.consumePress(c))) {
      // Space/interact re-fires the last pick at screen centre-ish as a
      // keyboard-only fallback; mouse click is the primary M4 path.
      setStatus('interact: use mouse click on a hotspot (alcove/plaque/door-switch/door-lock)');
    }
    if (walker.automapCodes().some((c) => keys.consumePress(c))) {
      automapZoomedOut = !automapZoomedOut;
      renderAll(walker.pose, itemCount);
    }

    itemCount = renderMainView(); // cheap: only actually recomposites when Walker's view is dirty
    if (newPose) {
      automapState.onEnterCell(newPose.level, newPose.x, newPose.y);
      renderAll(newPose, itemCount);
    } else {
      setStatusLine(walker.pose, itemCount); // keep the tick counter/item count live without touching automap/minimap
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

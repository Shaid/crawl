/**
 * Dungeon walker harness. Two modes, chosen by URL params:
 *
 * - **No params** (M1): the static-corridor demo — composites the hand-
 *   authored/verified `slots.json` unconditionally via `compositeSlotTable`,
 *   exactly as before.
 * - **`?map=<id>&x=<n>&y=<n>&facing=<0-3>`** (M2): loads the real
 *   `dungeon/levels.json`, builds a `FlatGridLevel` for the named map unit,
 *   runs `buildViewList` for that pose, and composites the result via
 *   `compositeDrawList` — a real first-person view of real game geometry,
 *   shareable as a link (a broken pose is just a URL).
 */
import {
  PieceBank,
  IndexedSurface,
  compositeSlotTable,
  compositeDrawList,
  CanvasPresenter,
  FlatGridLevel,
  buildViewList,
  viewSpecFromSlotTable,
  type PieceBankLookup,
  type Pose,
  type Dir4,
} from '@seer/dungeon';
import { validateSlotTableFile, validateDungeonLevelFile, type SemanticsFile, type DungeonLevelFile } from '@seer/dungeon/schema';
import type { AtlasMeta } from '@seer/core';
import { getAssetBasePath } from '../shared/viewer-config.ts';

const statusEl = document.getElementById('status')!;
const canvas = document.getElementById('surface') as HTMLCanvasElement;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Decode a PNG at `url` to interleaved RGBA bytes via an offscreen canvas — the browser-side equivalent of the Node golden test's `pngjs` decode. */
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

/** `semantics` isn't yet consulted by `buildViewList` for Black Crypt's
 * plain wall geometry (see its own doc comment) — this harness has no
 * `semantics.json` to fetch yet, so a minimal placeholder satisfies the
 * signature without claiming any real confidence data. */
const PLACEHOLDER_SEMANTICS: SemanticsFile = {
  schemaVersion: 1,
  confidence: 'hypothesis',
  source: 'tools/walker (no semantics.json yet)',
  walls: {},
  features: {},
};

function parsePoseParams(): { map: number; x: number; y: number; facing: Dir4 } | null {
  const params = new URLSearchParams(window.location.search);
  const map = params.get('map');
  const x = params.get('x');
  const y = params.get('y');
  const facing = params.get('facing');
  if (map === null || x === null || y === null || facing === null) return null;
  const f = Number(facing);
  if (![0, 1, 2, 3].includes(f)) throw new Error(`facing must be 0-3, got "${facing}"`);
  return { map: Number(map), x: Number(x), y: Number(y), facing: f as Dir4 };
}

async function renderStaticCorridor(assetBase: string) {
  setStatus('loading slots.json… (M1 static corridor — no pose in URL)');
  const slotsRaw = await fetchJSON<unknown>(`${assetBase}/dungeon/slots.json`);
  const slots = validateSlotTableFile(slotsRaw);

  const bankRef = slots.banks[0];
  if (!bankRef) throw new Error('slots.json has no piece banks');

  setStatus(`loading ${bankRef.atlas}…`);
  const atlas = await fetchJSON<AtlasMeta>(`${assetBase}/${bankRef.atlas}`);

  setStatus(`decoding ${bankRef.image}…`);
  const { rgba, width, height } = await decodePNGToRGBA(`${assetBase}/${bankRef.image}`);
  const bank = PieceBank.fromRGBA(rgba, width, height, atlas);

  setStatus('compositing…');
  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  const banks: PieceBankLookup = { [bankRef.id]: bank };
  compositeSlotTable(surface, banks, slots);

  canvas.width = surface.width;
  canvas.height = surface.height;
  const ctx = canvas.getContext('2d')!;
  const presenter = new CanvasPresenter(ctx);
  presenter.present(surface, bank.palette);

  setStatus(`ok (M1 static demo) — ${slots.viewport.width}x${slots.viewport.height} viewport, ${bank.palette.length}-color local palette`);
}

async function renderPose(assetBase: string, pose: Pose) {
  setStatus(`loading dungeon/levels.json + slots.json for map ${pose.level} @ (${pose.x},${pose.y}) facing ${pose.facing}…`);
  const [levelsRaw, slotsRaw] = await Promise.all([
    fetchJSON<unknown>(`${assetBase}/dungeon/levels.json`),
    fetchJSON<unknown>(`${assetBase}/dungeon/slots.json`),
  ]);
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(levelsRaw);
  const slots = validateSlotTableFile(slotsRaw);

  const unit = levelFile.units.find((u) => u.id === pose.level);
  if (!unit) throw new Error(`no unit with id ${pose.level} in dungeon/levels.json (have: ${levelFile.units.map((u) => u.id).join(', ')})`);

  const bankRef = slots.banks[0];
  if (!bankRef) throw new Error('slots.json has no piece banks');
  setStatus(`decoding ${bankRef.image}…`);
  const atlas = await fetchJSON<AtlasMeta>(`${assetBase}/${bankRef.atlas}`);
  const { rgba, width, height } = await decodePNGToRGBA(`${assetBase}/${bankRef.image}`);
  const bank = PieceBank.fromRGBA(rgba, width, height, atlas);
  const banks: PieceBankLookup = { [bankRef.id]: bank };

  const level = new FlatGridLevel(levelFile, unit);
  const spec = viewSpecFromSlotTable(slots);
  const items = buildViewList(level, pose, spec, PLACEHOLDER_SEMANTICS, slots);

  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  compositeDrawList(surface, banks, slots, items);

  canvas.width = surface.width;
  canvas.height = surface.height;
  const ctx = canvas.getContext('2d')!;
  const presenter = new CanvasPresenter(ctx);
  presenter.present(surface, bank.palette);

  setStatus(`ok — map ${unit.name ?? unit.id} @ (${pose.x},${pose.y}) facing ${'NESW'[pose.facing]}, ${items.length} draw items`);
}

async function main() {
  const assetBase = getAssetBasePath('blackcrypt', 'amiga');
  const params = parsePoseParams();
  if (params) {
    await renderPose(assetBase, { level: params.map, x: params.x, y: params.y, facing: params.facing });
  } else {
    await renderStaticCorridor(assetBase);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

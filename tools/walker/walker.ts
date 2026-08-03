/**
 * M1 static-corridor harness: loads the hand-authored `slots.json` +
 * `dungeon-bcdfx` atlas, composites the corridor into an `IndexedSurface`
 * via `@seer/dungeon`, and presents it on a plain 2D canvas
 * (`CanvasPresenter` — no PixiJS `Application` needed for this harness).
 *
 * Reads `map`/`x`/`y`/`facing` from nothing yet — M1 has no pose or level
 * data, it's a single static scene. Later milestones extend this the same
 * way `tools/viewer` reads its game/platform from the URL.
 */
import {
  PieceBank,
  IndexedSurface,
  compositeSlotTable,
  CanvasPresenter,
  type PieceBankLookup,
} from '@seer/dungeon';
import { validateSlotTableFile } from '@seer/dungeon/schema';
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

async function main() {
  const assetBase = getAssetBasePath('blackcrypt', 'amiga');

  setStatus('loading slots.json…');
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

  setStatus(`ok — ${slots.viewport.width}x${slots.viewport.height} viewport, ${bank.palette.length}-color local palette`);
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(err instanceof Error ? err.message : String(err), true);
});

/**
 * Asset-loading helpers and the Black Crypt view loader, shared by the walker page (`walker.ts`) and the remake host shell (`tools/blackcrypt/remake/view-factory.ts`).
 * Moved out of `walker.ts` unchanged (no DOM at module level) so another page can mount the same renderer; `walker.ts` imports them back.
 */
import {
  PieceBank, DEFAULT_BINDINGS, indexedTilesetPaths, rampPalettePath, paletteRampForUnit, parseRampPalette,
  type PieceBankLookup, type RGBAColor, type RampPaletteFile, type Pose,
} from '@seer-project/dungeon';
import {
  validateSlotTableFile, validateDungeonLevelFile, validateSemanticsFile, validateBindingsFile,
  type SlotTableFile, type DungeonLevelFile, type BindingsFile, type SemanticsFile,
} from '@seer-project/dungeon/schema';
import type { AtlasMeta } from '@seer-project/core';
import { BlackCryptView, bcEntrancePose } from './games.ts';

export interface BlackCryptLoadOptions {
  /** also load the live-scene banks (monsters, BCSPEED effects): the remake play mode */
  play?: boolean;
  onInteract?: (msg: string) => void;
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function tryFetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Decode a PNG at `url` to interleaved RGBA bytes via an offscreen canvas. Returns `null` on a 404. */
export function decodePNGToRGBA(url: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number } | null> {
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

export async function loadBank(assetBase: string, atlasPath: string, imagePath: string): Promise<PieceBank> {
  const atlas = await fetchJSON<AtlasMeta>(`${assetBase}/${atlasPath}`);
  const decoded = await decodePNGToRGBA(`${assetBase}/${imagePath}`);
  if (!decoded) throw new Error(`Failed to load image ${assetBase}/${imagePath}`);
  return PieceBank.fromRGBA(decoded.rgba, decoded.width, decoded.height, atlas);
}

// Each tileset's *primary* accent ramp, needed to recover raw EHB indices
// from the indexed atlas's baked palette (`PieceBank.fromIndexedRGBA`'s
// basePalette). Confirmed: bcdfx -> [0,3], bcdfy -> [1], bcdfz -> [2].
export const TILESET_PRIMARY_RAMP: Record<string, number> = { bcdfx: 0, bcdfy: 1, bcdfz: 2 };

// Accent ramp 4 ("cold blue-grey") -- the underwater/flooded-square re-tint
// `S_1 +0x02D46` forces on entering a "water" (type-nibble bit 3) square,
// restoring the level's default ramp on leaving; level 3 is exempt. Not any
// level's *static* default ramp, so `bclib.tileset_ramps()`'s per-tileset set
// doesn't include it on its own -- `export_dungeon_tileset_indexed.py` now
// always additionally exports it per tileset. See
// docs/blackcrypt/amiga/data-structure.md "Selector 2 -- per-square
// override" and "Underwater/flooded-level rendering".
const WATER_ACCENT_RAMP = 4;

export async function loadTilesetBank(
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

/** Black Crypt: the `Walker` facade over `levels.json`'s units (maps 1-13), with the M4/M5 asset stack. `startPose` may be `null` to use the map's data-derived entrance tile. */
export async function loadBlackCryptView(assetBase: string, unitId: number, startPose: Pose | null, o: BlackCryptLoadOptions = {}): Promise<BlackCryptView> {
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
  // Remake play mode (`?play=1`): the live scene also draws monsters and effect flashes (tools/blackcrypt/remake/live-scene.ts).
  if (o.play) {
    banks['monsters'] = reindexed(await loadBank(assetBase, 'sprites/monsters.json', 'sprites/monsters.png'));
    banks['bcspeed'] = reindexed(await loadBank(assetBase, 'sprites/bcspeed.json', 'sprites/bcspeed.png'));
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
    onInteract: o.onInteract,
  });
}


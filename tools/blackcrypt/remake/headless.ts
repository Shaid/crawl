/**
 * Headless renderer for the Black Crypt walker view (Node, no DOM): the same asset stack as `tools/walker/walker.ts`'s `loadBlackCrypt` (tileset bank at the level's
 * ramp, floor items, wall decorations, torches) plus the live-scene banks (monsters, BCSPEED effects), composited into an `IndexedSurface` and written as PNG. It exists
 * so the live scene can be tested and looked at without a browser. Reads the user's generated assets under `public/assets/blackcrypt/amiga` (gitignored, retail art).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import {
  PieceBank, IndexedSurface, compositeDrawList, indexedTilesetPaths, rampPalettePath, paletteRampForUnit, parseRampPalette, DEFAULT_BINDINGS,
  type PieceBankLookup, type RGBAColor, type RampPaletteFile, type Pose,
} from '@seer-project/dungeon';
import { validateSlotTableFile, validateDungeonLevelFile, validateSemanticsFile, type SlotTableFile, type DungeonLevelFile } from '@seer-project/dungeon/schema';
import type { AtlasMeta } from '@seer-project/core';
import { BlackCryptView, bcEntrancePose } from '../../walker/games';
import { BcEngine, type BcState } from './engine';
import { createBcLive } from './live-play';

export const ASSETS = resolve(__dirname, '../../../public/assets/blackcrypt/amiga');
export const haveAssets = () => existsSync(resolve(ASSETS, 'dungeon/levels.json')) && existsSync(resolve(ASSETS, 'sprites/monsters.png')) && existsSync(resolve(ASSETS, 'sprites/bcspeed.png'));

const json = <T>(rel: string): T => JSON.parse(readFileSync(resolve(ASSETS, rel), 'utf8')) as T;
const tryJson = <T>(rel: string): T | null => (existsSync(resolve(ASSETS, rel)) ? json<T>(rel) : null);
const png = (rel: string) => { const p = PNG.sync.read(readFileSync(resolve(ASSETS, rel))); return { rgba: new Uint8ClampedArray(p.data), width: p.width, height: p.height }; };
const bank = (atlas: string, image: string) => { const a = json<AtlasMeta>(atlas), i = png(image); return PieceBank.fromRGBA(i.rgba, i.width, i.height, a); };

export interface HeadlessScene { view: BlackCryptView; banks: PieceBankLookup }

/** the walker's Black Crypt stack for map `unitId` (levels.json unit), with the live-scene banks added */
export function loadViewHeadless(unitId: number, startPose?: Pose): HeadlessScene {
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(json('dungeon/levels.json'));
  const slots = validateSlotTableFile(json('dungeon/slots.json')) as SlotTableFile;
  const semantics = validateSemanticsFile(json('dungeon/semantics.json'));
  const unit = levelFile.units.find(u => u.id === unitId); if (!unit) throw new Error(`no unit ${unitId}`);
  const ramp = paletteRampForUnit(unit);
  const ref = slots.banks[0]!;
  const primary: Record<string, number> = { bcdfx: 0, bcdfy: 1, bcdfz: 2 };
  let tileBank: PieceBank, palette: RGBAColor[], basePalette: RGBAColor[] | undefined;
  const pr = unit.tileset ? primary[unit.tileset] : undefined;
  if (unit.tileset && pr !== undefined) {
    const p = indexedTilesetPaths(unit.tileset);
    const base = parseRampPalette(json<RampPaletteFile>(rampPalettePath(unit.tileset, pr)));
    const idx = png(p.indexPng), msk = png(p.maskPng);
    tileBank = PieceBank.fromIndexedRGBA(idx.rgba, msk.rgba, idx.width, idx.height, json<AtlasMeta>(p.atlasJson), base);
    palette = ramp === pr ? base : parseRampPalette(json<RampPaletteFile>(rampPalettePath(unit.tileset, ramp)));
    basePalette = base;
  } else { tileBank = bank(ref.atlas, ref.image); palette = tileBank.palette; }
  const re = (b: PieceBank) => (basePalette ? PieceBank.reindex(b, basePalette) : b);
  const banks: PieceBankLookup = { [ref.id]: tileBank };
  const fire = tryJson<{ frames: number; ticksPerFrame: number; periodTicks: number; instances: { x: number; y: number; phaseTicks: number }[] }>('data/fire-animation.json');
  if (fire) {
    banks.fire = re(bank('sprites/fire-animation.json', 'sprites/fire-animation.png'));
    const names = Array.from({ length: fire.frames }, (_, i) => `flame${String(i).padStart(2, '0')}`);
    slots.staticSlots = [...(slots.staticSlots ?? []), ...fire.instances.map(inst => ({ draws: [{ bank: 'fire', frame: { frames: names, ticksPerFrame: fire.ticksPerFrame, periodTicks: fire.periodTicks, phase: 'fixed' as const, phaseTicks: inst.phaseTicks }, destX: inst.x, destY: inst.y, blend: 'mask' as const }] }))];
  }
  for (const r of slots.banks.slice(1)) banks[r.id] = re(bank(r.atlas, r.image));
  banks.monsters = re(bank('sprites/monsters.json', 'sprites/monsters.png'));
  banks.bcspeed = re(bank('sprites/bcspeed.json', 'sprites/bcspeed.png'));
  const view = new BlackCryptView({
    levelFile, unit, slots, semantics, bindings: DEFAULT_BINDINGS, banks, palette, automapBank: bank('sprites/automap.json', 'sprites/automap.png'),
    startPose: startPose ?? bcEntrancePose(unit),
  });
  return { view, banks };
}

/** attach the engine's live scene to a headless view (the same wiring the browser shell uses) */
export function attachLive(scene: HeadlessScene, st: () => BcState) {
  const groups = json<{ groups: { index: number; name: string; gfxId: string; frames: string[] }[] }>('data/monster-names.json').groups;
  const live = createBcLive({ state: st, banks: scene.banks, groups, getPose: () => scene.view.pose });
  scene.view.setLive(live);
  return live;
}

/** composite the view's current items into a 320x200 indexed surface and return it as RGBA (`scale` = integer pixel doubling) */
export function renderRGBA(scene: HeadlessScene, scale = 1) {
  const v = scene.view, s = new IndexedSurface(320, 200);
  compositeDrawList(s, v.banks, v.slots, v.items, v.currentTick);
  const W = 320 * scale, H = 200 * scale, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = v.palette[s.data[Math.floor(y / scale) * 320 + Math.floor(x / scale)]] ?? { r: 0, g: 0, b: 0, a: 255 };
    const o = (y * W + x) * 4; out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = 255;
  }
  return { rgba: out, width: W, height: H, indexed: s };
}

export function writePng(path: string, rgba: Uint8Array, width: number, height: number) {
  mkdirSync(dirname(path), { recursive: true });
  const p = new PNG({ width, height }); p.data = Buffer.from(rgba); writeFileSync(path, PNG.sync.write(p));
}

void BcEngine;

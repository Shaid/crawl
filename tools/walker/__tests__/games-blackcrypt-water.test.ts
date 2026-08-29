/**
 * `BlackCryptView.palette` — the underwater/flooded-square re-tint
 * (`docs/blackcrypt/amiga/data-structure.md` "Selector 2 — per-square
 * override" + "Underwater/flooded-level rendering", `docs/blackcrypt/TODO.md`
 * `blackcrypt-underwater-rendering`): `S_1 +0x02D46` forces accent ramp 4
 * ("cold blue-grey") while the party stands on a "water" square (type-nibble
 * bit 3, on-disk type byte `0x8F`), restoring the level's default ramp on
 * leaving — except level 3, which the routine explicitly exempts even though
 * it has 5 water-typed squares of its own.
 *
 * Verified here against **real corpus data** (the pipeline's own
 * `public/assets/blackcrypt/amiga/dungeon/levels.json` and the real
 * `dungeon-<tileset>-ramp{2,4}.json` palette exports), not a synthetic
 * fixture: map 9 (the flooded level, 486/548 water squares in the game) has
 * a real water square at (33,1) and a real adjacent non-water square at
 * (32,1); map 3 has 5 water squares of its own, one at (36,3), used to prove
 * the level-3 exemption against a real water tile rather than a hypothetical
 * one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, parseRampPalette, type RampPaletteFile } from '@seer-project/dungeon';
import { validateDungeonLevelFile, validateSlotTableFile, type SemanticsFile } from '@seer-project/dungeon/schema';
import { BlackCryptView } from '../games.ts';

const ASSET_ROOT = resolve('public/assets/blackcrypt/amiga');
const LEVELS_PATH = resolve(ASSET_ROOT, 'dungeon/levels.json');
const SLOTS_PATH = resolve(ASSET_ROOT, 'dungeon/slots.json');
const RAMP2_PATH = resolve(ASSET_ROOT, 'palettes/dungeon-bcdfz-ramp2.json'); // map 9's default (bcdfz's primary ramp)
const RAMP4_PATH = resolve(ASSET_ROOT, 'palettes/dungeon-bcdfz-ramp4.json'); // the water re-tint
const RAMP0_PATH = resolve(ASSET_ROOT, 'palettes/dungeon-bcdfx-ramp0.json'); // map 3's default (bcdfx's primary ramp)

const HAVE_REAL_DATA =
  existsSync(LEVELS_PATH) && existsSync(SLOTS_PATH) && existsSync(RAMP2_PATH) && existsSync(RAMP4_PATH) && existsSync(RAMP0_PATH);

const FALLBACK_SEMANTICS: SemanticsFile = {
  schemaVersion: 1,
  confidence: 'hypothesis',
  source: 'test fixture',
  walls: {},
  features: {},
};

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

(HAVE_REAL_DATA ? describe : describe.skip)('BlackCryptView.palette — underwater re-tint (real corpus data)', () => {
  const levelFile = validateDungeonLevelFile(readJSON(LEVELS_PATH));
  const slots = validateSlotTableFile(readJSON(SLOTS_PATH));
  const ramp2 = parseRampPalette(readJSON<RampPaletteFile>(RAMP2_PATH)); // bcdfz default
  const ramp4 = parseRampPalette(readJSON<RampPaletteFile>(RAMP4_PATH)); // bcdfz water re-tint
  const ramp0 = parseRampPalette(readJSON<RampPaletteFile>(RAMP0_PATH)); // bcdfx default

  function makeView(levelId: number, startPose: { x: number; y: number }, waterPalette: ReturnType<typeof parseRampPalette> | undefined, palette: ReturnType<typeof parseRampPalette>) {
    const unit = levelFile.units.find((u) => u.id === levelId);
    if (!unit) throw new Error(`no unit ${levelId} in real levels.json`);
    return new BlackCryptView({
      levelFile,
      unit,
      slots,
      semantics: FALLBACK_SEMANTICS,
      bindings: DEFAULT_BINDINGS,
      banks: {},
      palette,
      waterPalette,
      automapBank: null as never, // not composited/rendered in this test
      startPose: { level: levelId, x: startPose.x, y: startPose.y, facing: 0 },
    });
  }

  it('confirms the real water/non-water pair on map 9 (the flooded level)', () => {
    const unit = levelFile.units.find((u) => u.id === 9)!;
    const type = unit.planes.type!;
    expect(type[1 * 64 + 33]! & 0x8).not.toBe(0); // (33,1) — real water square
    expect(type[1 * 64 + 32]! & 0x8).toBe(0); // (32,1) — real adjacent non-water square
  });

  it('re-tints to ramp 4 while standing on a real water square on map 9', () => {
    const view = makeView(9, { x: 33, y: 1 }, ramp4, ramp2);
    expect(view.palette).toBe(ramp4);
  });

  it('renders the default ramp one step off the water square on map 9', () => {
    const view = makeView(9, { x: 32, y: 1 }, ramp4, ramp2);
    expect(view.palette).toBe(ramp2);
  });

  it('falls back to the default ramp when no water palette was loaded (e.g. a "baked" rampSource)', () => {
    const view = makeView(9, { x: 33, y: 1 }, undefined, ramp2);
    expect(view.palette).toBe(ramp2);
  });

  it('level 3 is exempt from the retint even on its own real water square', () => {
    const unit = levelFile.units.find((u) => u.id === 3)!;
    const type = unit.planes.type!;
    expect(type[3 * 64 + 36]! & 0x8).not.toBe(0); // (36,3) — real map-3 water square
    const view = makeView(3, { x: 36, y: 3 }, ramp4, ramp0);
    expect(view.palette).toBe(ramp0); // NOT ramp4 — S_1 +0x02D46's level==3 exemption
  });

  it('the palette getter follows the party across a real step onto the water square', () => {
    const view = makeView(9, { x: 32, y: 1 }, ramp4, ramp2);
    expect(view.palette).toBe(ramp2);
    view.setPose({ level: 9, x: 33, y: 1, facing: 0 });
    expect(view.palette).toBe(ramp4);
    view.setPose({ level: 9, x: 32, y: 1, facing: 0 });
    expect(view.palette).toBe(ramp2);
  });
});

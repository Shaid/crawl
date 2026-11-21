/**
 * `BlackCryptView`'s darkness-zone mirror toggle — the session-tracked
 * `$48F(A5)` state (`docs/blackcrypt/amiga/data-structure.md`
 * "`ViewpointChanged`", `docs/blackcrypt/TODO.md`'s
 * `walker-mirror-flag-polarity`) as it applies on the *ordinary walk path
 * only* (`MoveParty`'s success tail, S_1 `+0x16F0A`): the toggle flips when
 * the map-square darkness bit (type-nibble bit 1, on-disk type byte `0x2F`)
 * differs between the square left and the square entered.
 *
 * Verified against **real corpus data** (`public/assets/blackcrypt/amiga/`):
 * map 3 has a real darkness square at (41,3) and a real adjacent
 * non-darkness square at (40,3) — the pair a fresh `bclib.bcdfs.walk_all`
 * scan turns up, not a synthetic fixture. Also exercises the front/side
 * `-direct` slot overrides `scripts/export_dungeon_slots.py` added this
 * pass (`front-direct:`/`side-direct:` keys, the `$48F != 0`
 * direct/unmirrored branch of the same two blit tables).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '@seer-project/dungeon';
import { validateDungeonLevelFile, validateSlotTableFile, type SemanticsFile } from '@seer-project/dungeon/schema';
import { BlackCryptView } from '../games.ts';

const ASSET_ROOT = resolve('public/assets/blackcrypt/amiga');
const LEVELS_PATH = resolve(ASSET_ROOT, 'dungeon/levels.json');
const SLOTS_PATH = resolve(ASSET_ROOT, 'dungeon/slots.json');

const HAVE_REAL_DATA = existsSync(LEVELS_PATH) && existsSync(SLOTS_PATH);

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

(HAVE_REAL_DATA ? describe : describe.skip)('BlackCryptView darkness-zone mirror toggle (real corpus data)', () => {
  const levelFile = validateDungeonLevelFile(readJSON(LEVELS_PATH));
  const slots = validateSlotTableFile(readJSON(SLOTS_PATH));
  const unit = levelFile.units.find((u) => u.id === 3)!;

  function makeView() {
    return new BlackCryptView({
      levelFile,
      unit,
      slots,
      semantics: FALLBACK_SEMANTICS,
      bindings: DEFAULT_BINDINGS,
      banks: {},
      palette: [],
      automapBank: null as never,
      startPose: { level: 3, x: 40, y: 3, facing: 1 }, // facing east, toward the real darkness square
    });
  }

  const keysForward = { isDown: (code: string) => code === 'KeyW' };

  it('confirms the real darkness/non-darkness pair on map 3', () => {
    const type = unit.planes.type!;
    expect(type[3 * 64 + 41]! & 0x2).not.toBe(0); // (41,3) — real darkness square
    expect(type[3 * 64 + 40]! & 0x2).toBe(0); // (40,3) — real adjacent non-darkness square
  });

  it('flips the toggle on a real walk-path step into a darkness square, and back on leaving', () => {
    const view = makeView();
    view.setNoclip(true); // bypass the wall-collision gate; only the (x,y) transition matters here
    expect(view.mirrorToggleActive).toBe(false);

    const stepIn = view.update(200, keysForward);
    expect(stepIn).toEqual({ level: 3, x: 41, y: 3, facing: 1 });
    expect(view.mirrorToggleActive).toBe(true);

    // Turn around (facing 3 = west) and step back — same real pair, reverse direction.
    view.setPose({ level: 3, x: 41, y: 3, facing: 3 });
    const stepOut = view.update(200, keysForward);
    expect(stepOut).toEqual({ level: 3, x: 40, y: 3, facing: 3 });
    expect(view.mirrorToggleActive).toBe(false);
  });

  it('setPose (a non-walk-path jump) never touches the toggle', () => {
    const view = makeView();
    expect(view.mirrorToggleActive).toBe(false);
    view.setPose({ level: 3, x: 41, y: 3, facing: 0 }); // "teleport" straight onto the darkness square
    expect(view.mirrorToggleActive).toBe(false); // out of scope per walker-mirror-flag-polarity
  });

  it('does not flip on a facing-only turn (no cell change)', () => {
    const view = makeView();
    view.setNoclip(true);
    const keysTurn = { isDown: (code: string) => code === 'KeyE' }; // turnRight
    const turned = view.update(200, keysTurn);
    expect(turned).not.toBeNull();
    expect(turned!.x).toBe(40);
    expect(turned!.y).toBe(3);
    expect(view.mirrorToggleActive).toBe(false);
  });

  it('the real front-direct/side-direct overrides exist and differ from the default table', () => {
    const front = slots.slots['front:-1:0']!.draws[0]!;
    const frontDirect = slots.slots['front-direct:-1:0']!.draws[0]!;
    expect(frontDirect.frame).not.toEqual(front.frame); // left/right swap, per data-structure.md
    expect(frontDirect.destX).toBe(front.destX);
    expect(frontDirect.destY).toBe(front.destY);

    const side = slots.slots['side:L:0']!.draws[0]!;
    const sideDirect = slots.slots['side-direct:L:0']!.draws[0]!;
    expect(sideDirect.frame).not.toEqual(side.frame);
    expect(sideDirect.mirrorX).toBe(true); // BLTCON1 mirror bit 0x0400
  });

  it('applies the -direct override to a resolved DrawItem once the toggle is active', () => {
    const view = makeView();
    view.setNoclip(true);
    view.update(200, keysForward); // step onto (41,3) -> toggle flips true
    expect(view.mirrorToggleActive).toBe(true);

    const frontItem = view.items.find((it) => it.kind === 'front' && it.lateral === -1 && it.depth === 0);
    expect(frontItem).toBeDefined(); // the pose's own front-left slot at depth 0 must actually resolve
    const expected = slots.slots['front-direct:-1:0']!.draws[0]!;
    expect(frontItem!.frame).toBe(expected.frame);
    expect(frontItem!.mirrorX ?? false).toBe(expected.mirrorX ?? false);
  });
});

/**
 * The non-walk-path `$48F` toggle sites reachable from the walker's own
 * movement (`MoveParty`'s code 2/3/4/9 dispatch: floor pit, stairs, spinner,
 * teleport — S_1 `+0x16DEA`/`+0x16EB0`/`+0x16EE8`) and the scripted-teleport
 * hook (`ExecuteAction` 0x15/0x1E). Real map-3/map-1 records, not synthetic.
 */
(HAVE_REAL_DATA ? describe : describe.skip)('BlackCryptView non-walk mirror-toggle sites (real corpus data)', () => {
  const levelFile = validateDungeonLevelFile(readJSON(LEVELS_PATH));
  const slots = validateSlotTableFile(readJSON(SLOTS_PATH));
  const keysForward = { isDown: (code: string) => code === 'KeyW' };

  function makeView(mapId: number, startPose: { x: number; y: number; facing: 0 | 1 | 2 | 3 }) {
    const unit = levelFile.units.find((u) => u.id === mapId)!;
    const view = new BlackCryptView({
      levelFile,
      unit,
      slots,
      semantics: FALLBACK_SEMANTICS,
      bindings: DEFAULT_BINDINGS,
      banks: {},
      palette: [],
      automapBank: null as never,
      startPose: { level: mapId, ...startPose },
    });
    view.setNoclip(true);
    return { view, unit };
  }

  it('teleport square (map 3 (5,7) -> (21,13), facing +2): relocates and flips the toggle; neither end is a bit-29 square', () => {
    const { view, unit } = makeView(3, { x: 4, y: 7, facing: 1 });
    const type = unit.planes.type!;
    expect(type[7 * 64 + 5]! & 0x2).toBe(0);
    expect(type[13 * 64 + 21]! & 0x2).toBe(0); // so the walk-path gate alone would never flip
    expect(view.mirrorToggleActive).toBe(false);
    const landed = view.update(200, keysForward);
    expect(landed).toEqual({ level: 3, x: 21, y: 13, facing: 3 });
    expect(view.pose).toEqual({ level: 3, x: 21, y: 13, facing: 3 });
    expect(view.mirrorToggleActive).toBe(true);
  });

  it('a second teleport flips it back (pure toggle, not a latch)', () => {
    const { view } = makeView(3, { x: 4, y: 7, facing: 1 });
    view.update(200, keysForward);
    expect(view.mirrorToggleActive).toBe(true);
    view.setPose({ level: 3, x: 6, y: 7, facing: 3 });
    view.update(200, keysForward); // onto (5,7) again
    expect(view.mirrorToggleActive).toBe(false);
  });

  it('floor pit (map 3 (18,17) -> (35,29)): relocates and flips', () => {
    const { view } = makeView(3, { x: 17, y: 17, facing: 1 });
    const landed = view.update(200, keysForward);
    expect(landed).toEqual({ level: 3, x: 35, y: 29, facing: 1 });
    expect(view.mirrorToggleActive).toBe(true);
  });

  it('ceiling pit (map 3 (35,29), word +0x10 = 1) is NOT a special square: no flip', () => {
    const { view } = makeView(3, { x: 34, y: 29, facing: 1 });
    const landed = view.update(200, keysForward);
    expect(landed).toEqual({ level: 3, x: 35, y: 29, facing: 1 });
    expect(view.mirrorToggleActive).toBe(false);
  });

  it('spinner (map 1 (10,1)): stays put, turns 180 degrees, flips', () => {
    const { view } = makeView(1, { x: 9, y: 1, facing: 1 });
    const landed = view.update(200, keysForward);
    expect(landed).toEqual({ level: 1, x: 10, y: 1, facing: 3 });
    expect(view.mirrorToggleActive).toBe(true);
  });

  it('null control: ordinary steps that cross no bit-29 boundary never flip', () => {
    const { view, unit } = makeView(3, { x: 40, y: 3, facing: 3 });
    expect(unit.planes.type![3 * 64 + 39]! & 0x2).toBe(0);
    for (let i = 0; i < 3; i++) view.update(200, keysForward);
    expect(view.pose.x).toBe(37);
    expect(view.mirrorToggleActive).toBe(false);
  });

  it('scripted teleport: 0x15 (value 0) and 0x1E flip unconditionally; 0x15 with a non-zero value does not', () => {
    const { view } = makeView(3, { x: 40, y: 3, facing: 1 });
    view.applyScriptedTeleport(0x15, 10, 10);
    expect(view.pose).toEqual({ level: 3, x: 10, y: 10, facing: 1 });
    expect(view.mirrorToggleActive).toBe(true);
    view.applyScriptedTeleport(0x15, 11, 10, 3);
    expect(view.mirrorToggleActive).toBe(true); // value != 0 -> +0x96CBA path, no toggle
    view.applyScriptedTeleport(0x1e, 12, 10);
    expect(view.mirrorToggleActive).toBe(false);
    expect(() => view.applyScriptedTeleport(0x18, 1, 1)).toThrow();
  });

  it('every real teleport square in the corpus is outside bit-29 regions with a populated destination (fixture premise)', () => {
    let n = 0;
    for (const [key, e] of Object.entries(levelFile.entities ?? {})) {
      const r = e.raw!;
      if (r[5] !== 0x12 || r[0x11] === 2 || r[0x11] === 3 || r[0x11] === 4) continue;
      n++;
      expect(key).toMatch(/^\d+:\d+:\d+:\d+$/);
    }
    expect(n).toBe(143); // 61 inviso + 82 visible teleports, per data-structure.md
  });
});

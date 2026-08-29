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

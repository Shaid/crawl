import { describe, expect, it } from 'vitest';
import { W6Keys, hudLines } from './keys';
import { W6_KEYMAP, w6Entry } from './shell-entry';
import { registry } from '../../remake/engines';
import type { W6View } from './engine';

const member = (name: string) => ({ name, cls: 'MAGE', race: 'ELF', level: 1, hp: 5, maxHp: 5, stamina: 9, maxStamina: 9, xp: 0, gold: 0, cond: 0, sp: [[1, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] as [number, number][], weapon: 'x', items: [], spells: [{ id: 2, name: 'FIREBALL', realm: 0, level: 1, cost: 2 }], tired: false });
const view = (mode: W6View['mode'], extra: Partial<W6View> = {}): W6View => ({
  tick: 0, mode, gameOver: false, pose: { level: 1, x: 1, y: 1, facing: 0 }, levelId: 1, region: 0, local: { x: 1, y: 1 }, clock: 0, ahead: { code: 0, door: 'none' },
  party: [member('A'), member('B')], fight: null, loot: [], chest: null, ...extra,
});

describe('keys: one command per key, by mode', () => {
  it('explore keys move, turn, camp', () => {
    const k = new W6Keys(), v = view('explore');
    expect(k.key('KeyW', v)).toEqual({ kind: 'move', dir: 'forward' });
    expect(k.key('KeyD', v)).toEqual({ kind: 'move', dir: 'right' });
    expect(k.key('KeyQ', v)).toEqual({ kind: 'turn', by: -1 });
    expect(k.key('KeyR', v)).toEqual({ kind: 'camp' });
    expect(k.key('Space', v)).toBeNull();
  });
  it('combat keys give orders, Space plays the round; the digit selects the caster', () => {
    const k = new W6Keys(), v = view('combat', { fight: { round: 0, scripted: false, groups: [], plans: [] } });
    expect(k.key('Space', v)).toEqual({ kind: 'round' });
    expect(k.key('KeyF', v)).toEqual({ kind: 'planAll', plan: { act: 'run' } });
    k.key('Digit2', v);
    expect(k.key('KeyC', v)).toEqual({ kind: 'plan', member: 1, plan: { act: 'cast', spell: 2, power: 1, tg: 1, ti: -3 } });
    expect(k.key('KeyW', v)).toBeNull();                                   // no walking in a fight
  });
  it('loot and chest modes, and nothing after the game is over', () => {
    const k = new W6Keys();
    expect(k.key('KeyT', view('loot'))).toEqual({ kind: 'takeAll' });
    expect(k.key('KeyD', view('chest', { chest: { disarmed: false, sprung: false, letters: '' } }))).toEqual({ kind: 'chestDisarm', who: 0, trap: 1 });
    k.key('KeyN', view('chest')); expect(k.guess).toBe(2);
    expect(k.key('KeyW', view('explore', { gameOver: true }))).toBeNull();
  });
  it('the HUD names the party and the mode', () => {
    const lines = hudLines(view('explore'), new W6Keys(), ['x']);
    expect(lines[0]).toMatch(/EXPLORE/);
    expect(lines.some(l => l.includes('A') && l.includes('MAGE'))).toBe(true);
  });
});

describe('shell registration', () => {
  it('is registered once, wraps the engine of the same id, and the static key map is consistent', () => {
    expect(registry.get('wizardry6')).toBe(w6Entry);
    expect(w6Entry.engine.id).toBe('wizardry6');
    expect(w6Entry.engine.timing.mode).toBe('turn');
    expect(Object.keys(W6_KEYMAP).length).toBeGreaterThan(15);
    expect(w6Entry.hints.viewFactory).toBeTypeOf('function');
    expect(w6Entry.engine.coverage().length).toBeGreaterThan(15);
  });
});

import { describe, it, expect } from 'vitest';
import { Mm2Keys, hudLines } from './keys';
import { MM2_KEYMAP, mm2Entry } from './shell-entry';
import { Registry } from '../../remake/registry';
import type { Mm2View } from './engine';

const view = (o: Partial<Mm2View> = {}): Mm2View => ({
  tick: 0, mode: 'explore', pose: { screen: 0, x: 7, y: 5, facing: 0 }, outdoor: false, ahead: { code: 0, blocked: false, locked: false }, clock: { day: 1, year: 900, sub: 0 },
  party: [0, 1, 2].map(i => ({ name: `P${i}`, cls: 'Knight', level: 1, xp: 0, hp: 10, maxHp: 10, sp: 0, maxSp: 0, gems: 0, gold: 0, food: 10, cond: 0, ac: 1, alive: true, able: true, spells: i === 1 ? [3, 50] : [], equipped: [], pack: [] })),
  prompt: null, battle: null, loot: [], gameOver: false, ...o,
});

describe('Mm2 key policy (pure)', () => {
  it('explore keys move, prompt keys answer, battle keys queue orders and play the round', () => {
    const k = new Mm2Keys();
    expect(k.key('KeyW', view())).toEqual({ kind: 'move', dir: 'forward' });
    expect(k.key('KeyA', view())).toBeNull();
    expect(k.key('KeyA', view({ mode: 'prompt' }))).toEqual({ kind: 'prompt', choice: 'attack' });
    const b = view({ mode: 'battle' });
    expect(k.key('Digit2', b)).toBeNull(); expect(k.sel).toBe(1);
    expect(k.key('KeyC', b)).toBeNull();
    expect(k.pending[1]).toEqual({ kind: 'cast', spell: 3, target: 0 });   // the first combat spell the member knows
    expect(k.key('Space', b)).toEqual({ kind: 'round', orders: [undefined, { kind: 'cast', spell: 3, target: 0 }] });
    expect(k.pending).toEqual([]);
    expect(k.key('KeyW', view({ gameOver: true }))).toBeNull();
  });
  it('the HUD names the mode and the monsters', () => {
    const t = hudLines(view({ mode: 'battle', battle: { round: 2, melee: 3, queued: 0, monsters: [{ slot: 0, id: 1, name: 'Goblin', hp: 4, status: 0 }] } }), new Mm2Keys(), ['1 x']).join('\n');
    expect(t).toMatch(/BATTLE/); expect(t).toMatch(/Goblin 4/);
  });
  it('registers with the shell: engine id matches, every mapped key is a command', () => {
    expect(() => new Registry([mm2Entry])).not.toThrow();
    for (const b of Object.values(MM2_KEYMAP)) expect(typeof b.cmd.kind).toBe('string');
  });
});

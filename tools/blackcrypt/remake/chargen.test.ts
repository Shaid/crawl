/** Character creation and the spell book wired into newGame (synthetic maps, committed spell-book fixture; no retail data). */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSetFromMap } from '../../remake/engine';
import { BcEngine, type BcState } from './engine';
import { MapBuilder, world, worldBook, rulesBook } from './synth';
import { checkDraft, defaultDraft, defaultParty, StatPool, pointsSpent, CLASS_TEMPLATES, STAT_RECORD_SLOTS, portraitIndex, type Stats } from './chargen';

const CH = (k: number) => 0x1758 + 0xa8 * k;
const room = () => new MapBuilder().room(10, 10, 24, 12).build();
const game = (party = defaultParty(), withBook = true): BcState => BcEngine.newGame((withBook ? worldBook : world)([room()]), 5, { pose: { x: 11, y: 11, facing: 1 }, party });
const run = (st: BcState, n: number, cmds: Parameters<typeof BcEngine.step>[1] = []) => { for (let i = 0; i < n; i++) BcEngine.step(st, i === 0 ? cmds : []); };

describe('draft validation', () => {
  it('the template parties are valid', () => { [0, 1, 2, 3].forEach(c => expect(checkDraft(c, defaultDraft(c))).toEqual([])); });
  it('rejects every kind of bad draft, and each fix removes exactly its complaint', () => {
    const d = defaultDraft(0);
    expect(checkDraft(0, { ...d, name: '' })).toContain('name is empty');
    expect(checkDraft(0, { ...d, name: 'ABCDEFGHIJKLM' }).join()).toMatch(/longer than 12/);
    expect(checkDraft(0, { ...d, name: 'ABCDEFGHIJKL' })).toEqual([]);   // 12 is fine
    expect(checkDraft(0, { ...d, stats: [13, 8, 6, 12, 10] }).join()).toMatch(/STR 13 is below the FIGHTER minimum 14/);
    expect(checkDraft(0, { ...d, stats: [21, 8, 6, 12, 10] }).join()).toMatch(/above 20/);
    expect(checkDraft(0, { ...d, stats: [20, 20, 20, 20, 10] }).join()).toMatch(/points spent/);   // 6+12+14+8 = 40 > 25
    expect(checkDraft(0, { ...d, portrait: 9 }).join()).toMatch(/portrait 9/);
    expect(checkDraft(0, { ...d, name: 'tab\there' }).join()).toMatch(/non-printable/);
  });
  it('pool arithmetic: spending exactly 25 is allowed, 26 is not', () => {
    expect(checkDraft(1, { ...defaultDraft(1), stats: [20, 8, 14, 6, 10] })).toEqual([]);   // +8
    const max25: Stats = [12 + 8, 8 + 8, 14 + 6, 6 + 3, 10];
    expect(pointsSpent(1, max25)).toBe(25); expect(checkDraft(1, { ...defaultDraft(1), stats: max25 })).toEqual([]);
    expect(checkDraft(1, { ...defaultDraft(1), stats: [20, 16, 20, 10, 10] }).join()).toMatch(/26 points spent/);
  });
});

describe('StatPool (the creation screen)', () => {
  it('raises until the pool is empty or the stat hits 20, lowers only above the class minimum', () => {
    const p = new StatPool(2);
    expect(p.pool).toBe(25);
    for (let i = 0; i < 40; i++) p.raise(1);   // INT 14 -> 20 takes 6
    expect(p.stats[1]).toBe(20); expect(p.pool).toBe(19);
    for (let i = 0; i < 40; i++) p.raise(0);   // STR 8 -> 20 takes 12
    expect(p.stats[0]).toBe(20); expect(p.pool).toBe(7);
    for (let i = 0; i < 40; i++) p.raise(4);   // CON 10 -> 17 uses the last 7
    expect(p.pool).toBe(0); expect(p.stats[4]).toBe(17); expect(p.raise(4)).toBe(false);
    expect(p.lower(4)).toBe(true); expect(p.pool).toBe(1);
    expect(p.lower(3)).toBe(false);   // DEX at its class minimum 12
    expect(checkDraft(2, { ...defaultDraft(2), stats: p.stats })).toEqual([]);
  });
});

describe('newGame from created characters', () => {
  it('stores names, stats and derived armour where the game keeps them; the template party is the same game as before (null control)', () => {
    const party = defaultParty();
    party[0] = { name: 'CONAN', stats: [20, 8, 6, 16, 12], portrait: 4 };
    party[2] = { name: 'MERLIN', stats: [8, 20, 10, 12, 12], portrait: 1 };
    const st = game(party), a = st.sim.a;
    const v = BcEngine.view(st);
    expect(v.party.map(p => p.name)).toEqual(['CONAN', 'CLERIC', 'MERLIN', 'DRUID']);
    expect(v.party.map(p => p.portrait)).toEqual([portraitIndex(0, party[0]), 9, 18 + 1, 27]);
    // stat slots: STR +0x64, INT +0x66, WIS +0x65, DEX +0x68, CON +0x67 (game-rules 8.9)
    party[0].stats.forEach((s, i) => expect(a.b(CH(0) + STAT_RECORD_SLOTS[i])).toBe(s));
    expect(String.fromCharCode(...[0, 1, 2, 3, 4].map(i => a.b(CH(0) + 2 + i)))).toBe('CONAN');
    expect(a.b(CH(0) + 0x62)).toBe(st.world.rules.tables.statBonusT1[16] + 8);   // AC = T1[DEX] + 6 + 2
    expect(a.b(CH(0) + 0x62)).toBeGreaterThan(game().sim.a.b(CH(0) + 0x62));      // DEX 16 (T1 +1) vs 12 (default, 0): the allocation shows
    const dflt = BcEngine.view(game());
    expect(dflt.party.map(p => p.name)).toEqual(['FIGHTER', 'CLERIC', 'MAGIC USER', 'DRUID']);
    expect(dflt.party.map(p => p.hp)).toEqual([20, 20, 20, 20]);
  });
  it('an invalid party throws with the reasons and builds nothing', () => {
    const bad = defaultParty(); bad[1] = { name: '', stats: [12, 8, 21, 6, 10], portrait: 0 };
    expect(() => game(bad)).toThrow(/CLERIC: name is empty.*CLERIC: WIS 21 is above 20/);
    expect(() => BcEngine.newGame(world([room()]), 1, { party: defaultParty().slice(0, 3) })).toThrow(/four characters/);
  });
  it('a created party plays: 400 ticks with a fight, and survives a save / restore round trip with names and portraits', () => {
    const party = defaultParty(); party[3] = { name: 'ELWYN', stats: [6, 8, 20, 10, 14 + 5], portrait: 8 }; party[3].stats[2] = 17;
    const st = game(party);
    run(st, 400, [{ kind: 'move', dir: 'forward' }]);
    const snap = BcEngine.save(st), back = BcEngine.restore(st.world, snap);
    expect(BcEngine.view(back).party.map(p => p.name)).toEqual(party.map(p => p.name));
    expect(BcEngine.view(back).party[3].portrait).toBe(27 + 8);
    expect(Buffer.from(BcEngine.save(back)).equals(Buffer.from(snap))).toBe(true);
  });
});

describe('spell book wired into the new game', () => {
  it('only the first page of each book starts owned, each class opens on its own page', () => {
    const v = BcEngine.view(game());
    expect(v.book!.pages.filter(p => p.owned).map(p => p.page)).toEqual([0, 5, 10]);
    expect(v.party.map(p => p.page)).toEqual([0, 0, 5, 10]);
    expect(BcEngine.view(game(defaultParty(), false)).book).toBeNull();   // rules without the book tables: no book
  });
  it('memorise puts the spell in the first free slot and starts its recharge timer (R = 1260 for the level-1 spell, scaled by T2[spell stat])', () => {
    const st = game();
    const mu = BcEngine.view(st).book!.pages[5];
    const spell = mu.spells[0];   // page 5 head, level 1
    expect(spell.level).toBe(1);
    run(st, 1, [{ kind: 'memorise', char: 2, row: 0 }]);
    const v = BcEngine.view(st);
    expect(v.party[2].spells).toEqual([spell.id]);
    // R = (1-1)*540 + 1260 = 1260; T2[INT 14] = 0%; one recharge tick already ran in the same step
    expect(v.book!.pages[5].spells[0].timer).toBe(1260 - 1);
    run(st, 10); expect(BcEngine.view(st).book!.pages[5].spells[0].timer).toBe(1260 - 11);   // recharge: one per tick
  });
  it('the allocated spell stat changes the recharge: INT 20 (T2 = -15%) gives 1071, the template mage 1260', () => {
    const party = defaultParty(); party[2] = { name: 'MERLIN', stats: [8, 20, 6, 12, 10], portrait: 0 };
    const st = game(party); run(st, 1, [{ kind: 'memorise', char: 2, row: 0 }]);
    expect(BcEngine.view(st).book!.pages[5].spells[0].timer).toBe(1071 - 1);
  });
  it('null controls: no second memorise while the timer runs, no unowned page, no spell above the character level, no book', () => {
    const st = game();
    run(st, 1, [{ kind: 'memorise', char: 2, row: 0 }]); run(st, 5, [{ kind: 'memorise', char: 2, row: 0 }]);
    expect(BcEngine.view(st).party[2].spells).toHaveLength(1);                       // timer > 0
    const st2 = game(); st2.sim.a.setB(CH(2) + 0x47, 6);                              // page 6 is not owned
    run(st2, 1, [{ kind: 'memorise', char: 2, row: 0 }]); expect(BcEngine.view(st2).party[2].spells).toEqual([]);
    const st3 = game(); run(st3, 1, [{ kind: 'memorise', char: 0, row: 0 }]);        // the fighter's page 0 head is a level-2 spell, he is level 1
    expect(BcEngine.view(st3).party[0].spells).toEqual([]);
    const st4 = game(defaultParty(), false); run(st4, 1, [{ kind: 'memorise', char: 2, row: 0 }]);
    expect(BcEngine.view(st4).party[2].spells).toEqual([]);                           // the old behaviour: nothing wired, nothing happens
  });
  it('a character who has reached the level can memorise the fighter spell (the level gate is the character level)', () => {
    const st = game(); st.sim.a.setB(CH(0) + 0x5e, 2);
    run(st, 1, [{ kind: 'memorise', char: 0, row: 0 }]);
    expect(BcEngine.view(st).party[0].spells).toHaveLength(1);
  });
  it('openPage / learnPage: owned pages inside the own book only', () => {
    const st = game();
    expect(BcEngine.openPage(st, 2, 6)).toBe(false);          // not owned
    expect(BcEngine.learnPage(st, 6)).toBe(true); expect(BcEngine.learnPage(st, 6)).toBe(false);
    expect(BcEngine.openPage(st, 2, 6)).toBe(true); expect(BcEngine.view(st).party[2].page).toBe(6);
    expect(BcEngine.openPage(st, 2, 1)).toBe(false);          // book A page for the mage
    expect(BcEngine.openPage(game(defaultParty(), false), 2, 5)).toBe(false);
  });
  it('book state (owned pages, timers, open page) survives save / restore; a restore of a changed state differs', () => {
    const st = game(); run(st, 1, [{ kind: 'memorise', char: 2, row: 0 }]); BcEngine.learnPage(st, 7); run(st, 20);
    const snap = BcEngine.save(st), back = BcEngine.restore(st.world, snap);
    expect(BcEngine.view(back).book).toEqual(BcEngine.view(st).book);
    expect(Buffer.from(BcEngine.save(back)).equals(Buffer.from(snap))).toBe(true);
    BcEngine.learnPage(back, 8);
    expect(Buffer.from(BcEngine.save(back)).equals(Buffer.from(snap))).toBe(false);
  });
  it('the class templates are the section 1.3 table', () => {
    expect(CLASS_TEMPLATES.map(t => t.start)).toEqual([[14, 8, 6, 12, 10], [12, 8, 14, 6, 10], [8, 14, 6, 12, 10], [6, 8, 12, 10, 14]]);
  });
});

const DATA = resolve(__dirname, '../../../data/blackcrypt/amiga');
describe.skipIf(!['bcdfs', 'bcdfp', 'bcdft'].every(n => existsSync(resolve(DATA, n))))('created party on the retail files', () => {
  it('a created party with the book carries the starting kit into map 1 and runs 300 ticks; the stats are the drafted ones', () => {
    const files = fileSetFromMap(new Map(['bcdfs', 'bcdfp', 'bcdft'].map(n => [n, new Uint8Array(readFileSync(resolve(DATA, n)))])));
    const w = BcEngine.withRules(rulesBook).load(files, 'amiga') as ReturnType<typeof BcEngine.load>;
    const party = defaultParty(); party[1] = { name: 'ABBOT', stats: [12, 8, 20, 6, 12], portrait: 3 };
    const st = BcEngine.newGame(w, 11, { party });
    const v0 = BcEngine.view(st);
    expect(v0.party.map(p => p.pack.filter(Boolean).length)).toEqual([5, 5, 5, 5]);   // the kit is still there
    expect(v0.party[1].name).toBe('ABBOT'); expect(st.sim.a.b(CH(1) + 0x65)).toBe(20);   // WIS
    run(st, 300, [{ kind: 'turn', by: 1 }]);
    expect(BcEngine.view(st).party[1].name).toBe('ABBOT');
  }, 60000);
});

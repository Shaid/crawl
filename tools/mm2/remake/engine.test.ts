import { describe, it, expect } from 'vitest';
import { Mm2Engine, describeEvent, type Mm2World, type Mm2State, type Mm2Cmd, type Mm2Event, type Order } from './engine';
import { retailFiles, haveRetail } from './node-files';
import { fileSetFromMap } from '../../remake/engine';
import { charPtr, rest as restDirect, spellSpCost, spellGemGate, spellSpGate } from '../rules';
import { xpNeeded, damageMonster, monsterDies } from '../rules3';
import { castSpell, castCombat } from '../rules4';
import { chargeCast, unlockDoor, shopPrice } from '../rules5';
import { g } from '../rules-mem';

const have = haveRetail();
let W: Mm2World | null = null;
const world = (): Mm2World => (W ??= Mm2Engine.load(retailFiles(), 'amiga') as Mm2World);
const A = g;
const run = (st: Mm2State, ...c: Mm2Cmd[]): Mm2Event[] => Mm2Engine.step(st, c);
const at = (ev: Mm2Event[], what: string) => ev.filter(e => e.what === what);
const V = (st: Mm2State) => Mm2Engine.view(st);
const buff = (st: Mm2State, hp = 250) => { for (let k = 0; k < 6; k++) { const ch = charPtr(st.mem, k); for (const o of [0x5e, 0x60, 0x74]) st.mem.w16(ch + o, hp); } };
/** make the square's north side a locked door: page 0 field 2 (door), page 1 wall bit; edited in the live pages, then the engine re-reads the cell */
function lockNorth(st: Mm2State, i: number) {
  st.mem.w8(A(-21946) + i, (st.mem.r8(A(-21946) + i) & 0x3f) | 0x80); st.mem.w8(A(-21690) + i, st.mem.r8(A(-21690) + i) | 0x40);
  run(st, { kind: 'turn', by: 1 }, { kind: 'turn', by: -1 });
}
/** fight a prepared encounter to the end with attack orders; returns the whole event log */
function fight(st: Mm2State, orders?: (Order | null)[], maxRounds = 80): Mm2Event[] {
  const ev: Mm2Event[] = [];
  ev.push(...run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' }));
  if (st.mode === 'prompt') ev.push(...run(st, { kind: 'prompt', choice: 'attack' }));
  for (let r = 0; r < maxRounds && st.mode === 'battle'; r++) ev.push(...run(st, { kind: 'round', orders }));
  return ev;
}

describe('detection (no retail data needed)', () => {
  it('refuses a file set that is not MM2 and says so', () => {
    expect(Mm2Engine.detect(fileSetFromMap(new Map()))).toBeNull();
    expect(Mm2Engine.detect(fileSetFromMap(new Map([['mm2', new Uint8Array(10)]])))).toBeNull();
  });
  it('declares itself turn based and reports coverage rows with valid grades', () => {
    expect(Mm2Engine.timing.mode).toBe('turn');
    const rows = Mm2Engine.coverage();
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) expect(['harness', 'code', 'hyp', 'open', 'stub']).toContain(r.grade);
    for (const g2 of ['harness', 'stub', 'open']) expect(rows.some(r => r.grade === g2)).toBe(true);
  });
});

describe.skipIf(!have)('Mm2Engine scenarios (retail files)', () => {
  it('detects the Amiga files and builds a new game: six starters, wielding their first item, in Middlegate', () => {
    const files = retailFiles();
    expect(Mm2Engine.detect(files)).toMatchObject({ engine: 'mm2', variant: 'amiga' });
    const st = Mm2Engine.newGame(world(), 1);
    const v = V(st);
    expect(v.party.map(p => p.name)).toEqual(['Sir Felgar', 'Terwin III', 'Sure Valla', 'Gene Eric', 'Cassandra', 'The Hermit']);
    expect(v.party.map(p => p.cls)).toEqual(['Knight', 'Paladin', 'Archer', 'Cleric', 'Sorcerer', 'Robber']);
    expect(v.party.every(p => p.equipped.length === 1 && p.pack.length === 0)).toBe(true);
    expect(v.party[0].gold).toBe(200);
    expect(v.pose).toMatchObject({ screen: 0, x: 7, y: 5 });
    expect(v.mode).toBe('explore');
  });

  it('turn based: a step with no commands changes nothing', () => {
    const st = Mm2Engine.newGame(world(), 3);
    const before = Buffer.from(Mm2Engine.save(st));
    expect(Mm2Engine.step(st, [])).toEqual([]);
    expect(Buffer.from(Mm2Engine.save(st)).equals(before)).toBe(true);
  });

  it('walks, turns, is stopped by a wall, and the world clock ticks once per step', () => {
    const st = Mm2Engine.newGame(world(), 4);
    const sub0 = V(st).clock.sub;
    const ev = run(st, ...Array.from({ length: 12 }, () => ({ kind: 'move', dir: 'forward' }) as Mm2Cmd));
    expect(at(ev, 'step').length).toBeGreaterThan(0);
    expect(at(ev, 'blocked').length).toBeGreaterThan(0);
    expect(V(st).clock.sub - sub0).toBe(at(ev, 'step').length);
    const f0 = V(st).pose.facing;
    run(st, { kind: 'turn', by: 1 });
    expect(V(st).pose.facing).toBe((f0 + 1) & 3);
    expect(describeEvent(at(ev, 'step')[0])).toMatch(/steps to/);
  });

  it('crosses a screen border through the attrib neighbours', () => {
    const st = Mm2Engine.newGame(world(), 5, { screen: 5, x: 8, y: 15, facing: 0 });
    const ev = run(st, { kind: 'move', dir: 'forward' });
    expect(at(ev, 'step')).toHaveLength(1);
    expect(V(st).pose.screen).toBe(world().attrib[5].neighbours[0]);
    expect(V(st).pose.y).toBe(0);
  });

  it('fights an encounter to the end: monsters die, XP is shared, the log says so', () => {
    let won: Mm2Event[] | null = null, st!: Mm2State;
    for (let seed = 1; seed < 60 && !won; seed++) {
      st = Mm2Engine.newGame(world(), seed); buff(st);
      const ev = fight(st);
      if (at(ev, 'victory').length) won = ev;
    }
    expect(won).not.toBeNull();
    const ev = won!;
    expect(at(ev, 'battle-start')).toHaveLength(1);
    expect(at(ev, 'swing').length).toBeGreaterThan(0);
    expect(at(ev, 'monster-attack').length).toBeGreaterThan(0);
    expect(at(ev, 'monster-dead').length).toBeGreaterThan(0);
    expect(at(ev, 'xp')[0].share as number).toBeGreaterThan(0);
    expect(st.mode).toBe('explore');
    expect(V(st).party.some(p => p.xp > 0)).toBe(true);
    expect(st.mem.r8(A(-30654))).toBe(0);
    expect(describeEvent(at(ev, 'monster-dead')[0])).toMatch(/dies/);
  });

  it('a party that is wiped out ends the game and refuses further play', () => {
    const st = Mm2Engine.newGame(world(), 11);
    run(st, { kind: 'warp', screen: 53 }, { kind: 'encounter' });
    if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
    for (let r = 0; r < 100 && st.mode === 'battle'; r++) run(st, { kind: 'round' });
    expect(st.mode).toBe('over');
    expect(V(st).gameOver).toBe(true);
    expect(at(run(st, { kind: 'move', dir: 'forward' }), 'refused')).toHaveLength(1);
  });

  it('null control: a party that never attacks leaves the monsters alive', () => {
    const st = Mm2Engine.newGame(world(), 7); buff(st);
    run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
    if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
    const n0 = st.mem.r8(A(-30654));
    const wait: Order = { kind: 'wait' };
    const ev: Mm2Event[] = [];
    for (let r = 0; r < 6 && st.mode === 'battle'; r++) ev.push(...run(st, { kind: 'round', orders: [wait, wait, wait, wait, wait, wait] }));
    expect(at(ev, 'swing')).toHaveLength(0);
    expect(at(ev, 'monster-dead')).toHaveLength(0);
    expect(st.mem.r8(A(-30654))).toBe(n0);
    expect(at(ev, 'monster-attack').length).toBeGreaterThan(0);
  });

  it('casts a combat spell through the real gates and handler: SP is paid, monsters are hurt', () => {
    let ok = 0, paid = 0, hurt = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const st = Mm2Engine.newGame(world(), seed); buff(st);
      run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
      if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
      if (st.mode !== 'battle') continue;
      expect(V(st).party[4].spells).toContain(3);
      const hp0 = V(st).battle!.monsters.reduce((a, b) => a + b.hp, 0), n0 = V(st).battle!.monsters.length, sp0 = V(st).party[4].sp;
      const ev = run(st, { kind: 'cast', char: 4, spell: 3, target: 0 });
      if (at(ev, 'cast').length) {
        ok++;
        paid += sp0 - V(st).party[4].sp;
        const b = V(st).battle!;
        if (b.monsters.reduce((a, c) => a + c.hp, 0) < hp0 || b.monsters.length < n0) hurt++;
      }
    }
    expect(ok).toBeGreaterThan(5);
    expect(hurt).toBeGreaterThan(3);   // the rest were resisted: magic resistance and the save are real rolls
    expect(paid).toBeGreaterThan(0);
  });

  it('null control: no SP, no spell; an unknown spell is refused', () => {
    const st = Mm2Engine.newGame(world(), 9);
    run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
    if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
    st.mem.w16(charPtr(st.mem, 4) + 0x58, 0);
    expect(at(run(st, { kind: 'cast', char: 4, spell: 3 }), 'cast-refused')[0]).toMatchObject({ why: 'sp' });
    expect(at(run(st, { kind: 'cast', char: 4, spell: 20 }), 'cast-refused')[0]).toMatchObject({ why: 'unknown' });
  });

  it('rest heals the wounded and eats one food each', () => {
    const st = Mm2Engine.newGame(world(), 12);
    const ch = charPtr(st.mem, 0);
    st.mem.w16(ch + 0x5e, 2); st.mem.w8(ch + 0x26, 0x40);
    const food0 = V(st).party[0].food;
    const ev = run(st, { kind: 'rest' });
    expect(at(ev, 'rest')).toHaveLength(1);
    if (st.mode === 'explore') {
      expect(V(st).party[0].hp).toBe(V(st).party[0].maxHp);
      expect(V(st).party[0].cond).toBe(0);
      expect(V(st).party[0].food).toBe(food0 - 1);
    }
  });

  it('a locked door: the thief picks it, the door persists as open and the party walks through', () => {
    const st = Mm2Engine.newGame(world(), 13, { screen: 0, x: 7, y: 5, facing: 0 });
    // lock the door ahead (page 0 north field = 2 door, page 1 wall bit): a hand-edited square, the rules do the rest
    const i = (5 << 4) + 7;
    lockNorth(st, i);
    expect(V(st).ahead).toMatchObject({ code: 2, blocked: true, locked: true });
    expect(at(run(st, { kind: 'move', dir: 'forward' }), 'blocked')).toHaveLength(1);
    let opened = false;
    for (let k = 0; k < 60 && !opened; k++) opened = at(run(st, { kind: 'unlock', char: 5 }), 'door-open').length > 0;
    expect(opened).toBe(true);
    expect(V(st).ahead.blocked).toBe(false);
    expect(at(run(st, { kind: 'move', dir: 'forward' }), 'step')).toHaveLength(1);
    expect(st.maps[i + 256] & 0x40).toBe(0);
  });

  it('bashing a door: strength decides', () => {
    const st = Mm2Engine.newGame(world(), 14, { screen: 0, x: 7, y: 5, facing: 0 });
    const i = (5 << 4) + 7;
    lockNorth(st, i);
    let opened = false;
    for (let k = 0; k < 80 && !opened; k++) opened = at(run(st, { kind: 'bash' }), 'door-open').length > 0;
    expect(opened).toBe(true);
  });

  it('buys at a shop with the verified price rule and pays the buyer', () => {
    const st = Mm2Engine.newGame(world(), 15);
    const item = world().itemNames.findIndex((_n, k) => k > 0 && k < 0x5c && st.mem.r16(A(-16126) + 20 * k + 18) > 0 && st.mem.r16(A(-16126) + 20 * k + 18) <= 100);
    const ev = run(st, { kind: 'shopBuy', char: 0, item });
    const b = at(ev, 'bought')[0];
    expect(b).toBeDefined();
    expect(b.price).toBeGreaterThan(0);
    expect(V(st).party[0].gold).toBe(200 - (b.price as number));
    expect(V(st).party[0].pack).toContain(world().itemNames[item]);
    // null: not enough gold
    const poor = at(run(st, { kind: 'shopBuy', char: 1, item }), 'buy-refused');
    expect(poor[0]).toMatchObject({ msg: 4 });
  });

  it('trains a character once the experience is there: level, HP up, the fee paid', () => {
    const st = Mm2Engine.newGame(world(), 16);
    const ch = charPtr(st.mem, 0);
    expect(at(run(st, { kind: 'train', char: 0 }), 'train-refused')).toHaveLength(1);
    st.mem.w32(ch + 0x62, xpNeeded(st.mem, ch));
    const hp0 = V(st).party[0].maxHp, gold0 = V(st).party[0].gold;
    const t = at(run(st, { kind: 'train', char: 0 }), 'trained')[0];
    expect(t).toBeDefined();
    expect(V(st).party[0].level).toBe(2);
    expect(V(st).party[0].maxHp).toBeGreaterThan(hp0);
    expect(V(st).party[0].gold).toBeLessThan(gold0);
  });

  it('prompt answers: hide, run, bribe end an encounter without a fight, or fall back to attack', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const choice of ['hide', 'run', 'bribe'] as const) {
        const st = Mm2Engine.newGame(world(), seed);
        run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
        if (st.mode !== 'prompt') { seen.add('no-prompt'); continue; }
        const ev = run(st, { kind: 'prompt', choice, bribe: { what: 'gold', amount: 100 } });
        for (const e of ev) if (['fight', 'avoided', 'retreated', 'encounter-ended'].includes(e.what)) seen.add(`${choice}:${e.what}`);
      }
    }
    expect([...seen].some(s => s.endsWith(':avoided') || s.endsWith(':retreated'))).toBe(true);
    expect([...seen].some(s => s.endsWith(':fight'))).toBe(true);
  });

  it('wandering encounters (an option): with 100 percent the first step meets monsters', () => {
    const st = Mm2Engine.newGame(world(), 17, { wanderPct: 100 });
    const ev = run(st, { kind: 'move', dir: 'forward' });
    expect(at(ev, 'encounter')).toHaveLength(1);
    expect(st.mode === 'prompt' || st.mode === 'battle').toBe(true);
  });

  it('save / restore: a restored game continues byte-identically, mid-battle', () => {
    const st = Mm2Engine.newGame(world(), 18); buff(st);
    run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
    if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
    run(st, { kind: 'round' });
    const bytes = Mm2Engine.save(st);
    expect(() => JSON.parse(new TextDecoder().decode(bytes))).not.toThrow();
    const st2 = Mm2Engine.restore(world(), bytes);
    expect(Buffer.from(Mm2Engine.save(st2)).equals(Buffer.from(bytes))).toBe(true);
    const e1: Mm2Event[] = [], e2: Mm2Event[] = [];
    for (let r = 0; r < 8 && st.mode === 'battle'; r++) { e1.push(...run(st, { kind: 'round' })); e2.push(...run(st2, { kind: 'round' })); }
    expect(e2).toEqual(e1);
    expect(Buffer.from(Mm2Engine.save(st2)).equals(Buffer.from(Mm2Engine.save(st)))).toBe(true);
  });

  it('determinism: same seed same game; a different seed diverges; one changed byte shows', () => {
    const play = (seed: number, tweak?: (st: Mm2State) => void) => { const st = Mm2Engine.newGame(world(), seed); buff(st); tweak?.(st); return fight(st, undefined, 12); };
    const a = play(21), b = play(21);
    expect(b).toEqual(a);
    expect(play(22)).not.toEqual(a);
    // one byte: the first character's melee die (record +0x4C) - the swing log must change
    const c = play(21, st => st.mem.w8(charPtr(st.mem, 0) + 0x4c, 200));
    expect(c).not.toEqual(a);
    expect(at(c, 'swing').some(e => e.char === 0 && (e.damage as number) > 20)).toBe(true);
  });
});

describe.skipIf(!have)('parity: the engine adds nothing to the rules it calls', () => {
  it('rest = rules.rest on the same memory', () => {
    const st = Mm2Engine.newGame(world(), 31);
    const ch = charPtr(st.mem, 3); st.mem.w16(ch + 0x5e, 1);
    const ref = st.mem.clone(); restDirect(ref);
    run(st, { kind: 'rest' });
    // the engine may start an encounter after an interrupted rest; compare the party records (the rest's own output) only
    for (let k = 0; k < 6; k++) { const o = charPtr(st.mem, k); for (let i = 0; i < 130; i++) expect(st.mem.r8(o + i)).toBe(ref.r8(o + i)); }
  });

  it('cast = the real gates + castSpell + castCombat + chargeCast on the same memory, every byte', () => {
    const st = Mm2Engine.newGame(world(), 32); buff(st);
    run(st, { kind: 'warp', screen: 17 }, { kind: 'encounter' });
    if (st.mode === 'prompt') run(st, { kind: 'prompt', choice: 'attack' });
    const ref = st.mem.clone();
    const ch = charPtr(ref, 4), rec = A(-11006) + 2 * 3;
    spellSpCost(ref, ch, rec); spellGemGate(ref, ch, rec); spellSpGate(ref, ch);
    ref.w8(A(-31064), 0);
    expect(castSpell(ref, ch, 4).some(c => c[0] === 'dispCB')).toBe(true);
    ref.killHook = () => monsterDies(ref);
    const kills = { shift: () => { damageMonster(ref); return ref.r16(A(-3852)) === 0xffff ? 1 : 0; } } as unknown as number[];
    castCombat(ref, 3, { keys: [0x41], picks: [0x31, 0x31], kills });
    chargeCast(ref);
    run(st, { kind: 'cast', char: 4, spell: 3, target: 0 });
    expect(Buffer.from(st.mem.win).equals(Buffer.from(ref.win))).toBe(true);
    expect(st.mem.r16(ch + 0x58)).toBeLessThan(7);
  });

  it('unlock = rules5.unlockDoor on the same memory', () => {
    const st = Mm2Engine.newGame(world(), 33, { screen: 0, x: 7, y: 5, facing: 0 });
    const i = (5 << 4) + 7;
    lockNorth(st, i);
    const ref = st.mem.clone();
    unlockDoor(ref, { pickfx: 1, member: 5 });
    run(st, { kind: 'unlock', char: 5 });
    expect(st.mem.r32(A(-24802))).toBe(ref.r32(A(-24802)));
    expect(st.mem.r8(A(-21974))).toBe(ref.r8(A(-21974)));
    expect(st.mem.r8(A(-21690) + i)).toBe(ref.r8(A(-21690) + i));
  });

  it('shop price = rules5.shopPrice', () => {
    const st = Mm2Engine.newGame(world(), 34);
    const ref = st.mem.clone();
    const item = 4;
    ref.w32(A(-23102), charPtr(ref, 0)); ref.w16(A(-23248), 0); ref.w8(A(-23052), item); ref.w8(A(-23070), 0); ref.w32(A(-23046), A(-16126) + 20 * item);
    const price = shopPrice(ref, 0);
    const b = at(run(st, { kind: 'shopBuy', char: 0, item }), 'bought')[0];
    expect(b.price).toBe(price);
  });
});

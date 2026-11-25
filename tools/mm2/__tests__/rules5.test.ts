/**
 * Pass 4: overlay hunk (character creation, file loaders) and world rules (tools/mm2/rules5.ts) against vectors recorded from the retail
 * MM2 executable under Unicorn (rules_oracle/rules5.py). Same strict-memory method and null controls as rules.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { StrictMem } from '../rules-mem.ts';
import { load } from './vectors.ts';
import { castNonCombat2, NC_SPELLS2, buyItem, shopPrice, chargeCast, loadAttribRecord, bashDoor, unlockDoor, loadTable, buildCharacter, chargenFlags, chargenRoll, chargenSlot, createCharacter, exchangeStats } from '../rules5.ts';

vi.setConfig({ testTimeout: 120000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);

describe('character creation: first free slot (OVL+0x181E)', () => {
  const V = load('cgslot');
  it('matches the game', () => {
    for (const v of V) expect(chargenSlot(mem(v))).toBe(v.ret);
    expect(V.some((v: any) => v.ret === 0xffff) && V.some((v: any) => v.ret > 0)).toBe(true);
  });
  it('null control: scanning 23 slots disagrees', () => {
    expect(V.some((v: any) => chargenSlot(mem(v), { n23: true }) !== v.ret)).toBe(true);
  });
});

describe('character creation: class eligibility (OVL+0x1DF4)', () => {
  const V = load('cgflags');
  it('matches the game, signed byte compares, short-circuit footprint', () => {
    for (const v of V) {
      const m = mem(v);
      chargenFlags(m, v.stats, v.flags);
      expect(m.changes()).toEqual(v.fin);
    }
  });
  it('null control: unsigned compares disagree', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        chargenFlags(m, v.stats, v.flags, { unsigned: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(10);
  });
});

describe('character creation: stat roll (OVL+0x1F84)', () => {
  const V = load('cgroll');
  it('matches the game: 3 x rand(10,79)/10 per stat, then eligibility', () => {
    for (const v of V) {
      const m = mem(v);
      chargenRoll(m, v.stats, v.flags);
      expect(m.changes()).toEqual(v.fin);
    }
  });
  it('null control: two passes disagree', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        chargenRoll(m, v.stats, v.flags, { passes: 2 });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(20);
  });
});

describe('character creation: build the record (OVL+0x185A)', () => {
  const V = load('cgbuild');
  it('matches the game: every field, the HP/SP/item tables, slot choice', () => {
    for (const v of V) {
      const m = mem(v);
      buildCharacter(m, v.args[0], v.args[1], v.args[2], v.args[3], (k) => m.r8(v.name + k), v.stats);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(V.length).toBeGreaterThan(50);
  });
  it('null control: dropping the +0x72 spell-level seed disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        buildCharacter(m, v.args[0] === 3 ? 4 : v.args[0] === 4 ? 3 : v.args[0], v.args[1], v.args[2], v.args[3], (k) => m.r8(v.name + k), v.stats);
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(10);
  });
});

describe('character creation: the whole dialogue (OVL+0x214E)', () => {
  const V = load('cgmake');
  it('matches the game: race/alignment/sex keys, aborts, name padding, build, reroll', () => {
    let built = 0;
    for (const v of V) {
      const m = mem(v);
      const r = createCharacter(m, v.cls, v.stats, v.flags, { keys: v.keys, name: v.name });
      expect(m.changes()).toEqual(v.fin);
      expect(r.keysUsed).toBe(v.calls.filter((c: any) => c[0] === 'key').length);
      if (Object.keys(v.fin).length > 50) built++;
    }
    expect(built).toBeGreaterThan(15);
  });
  it('null control: no stat restore on abort disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        createCharacter(m, v.cls, v.stats, v.flags, { keys: v.keys, name: v.name }, { noRestore: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(10);
  });
});

describe('table loaders in the overlay startup (items.dat, spells.dat, monsters.dat)', () => {
  const V = load('loaders');
  it('match the game with the libc file layer modelled: raw reads, items.dat word +0x12 swapped', () => {
    for (const v of V) {
      const m = mem(v);
      const buf = v.kind === 'monsters' ? v.calls[0][1][1] : 0;
      loadTable(m, v.kind, v.file, buf);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(new Set(V.map((v: any) => v.kind)).size).toBe(3);
  });
  it('null control: no byte swap disagrees', () => {
    let bad = 0;
    for (const v of V.filter((x: any) => x.kind === 'items')) {
      try {
        const m = mem(v);
        loadTable(m, 'items', v.file, 0, { noSwap: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(1);
  });
});

describe('doors: unlock (CODE+0x20CA2) and bash (CODE+0x9B48)', () => {
  const U = load('unlock');
  const B = load('bash');
  const names = (calls: any[]) => calls.map((c) => [c[0], c[1]]);
  it('unlock matches the game: cell test, member pick, skill roll, trap roll', () => {
    for (const v of U) {
      const m = mem(v);
      const c = unlockDoor(m, { pickfx: v.pickfx, member: v.member });
      expect(m.changes()).toEqual(v.fin);
      expect(names(c)).toEqual(v.calls.map((x: any) => [x[0], x[0] === 'F1A90E' ? x[1] : []]));
    }
    expect(U.some((v: any) => v.calls.some((c: any) => c[0] === 'F171AC')) && U.some((v: any) => Object.keys(v.fin).length > 2)).toBe(true);
  });
  it('unlock null control: a +10 skill bonus disagrees', () => {
    let bad = 0;
    for (const v of U) {
      try {
        const m = mem(v);
        unlockDoor(m, { pickfx: v.pickfx, member: v.member }, { lenient: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
  it('bash matches the game: cell test, Might sum + rand(10,109)/10 vs strength, trap on a low roll', () => {
    for (const v of B) {
      const m = mem(v);
      const c = bashDoor(m, { pickfx: v.pickfx });
      expect(m.changes()).toEqual(v.fin);
      expect(names(c)).toEqual(v.calls.map((x: any) => [x[0], x[1]]).map((x: any) => (x[0] === 'F1A9A6' || x[0] === 'F171AC' ? [x[0], []] : x)));
    }
    expect(B.some((v: any) => v.calls.some((c: any) => c[0] === 'F171AC'))).toBe(true);
  });
  it('bash null control: ignoring the lucky 5 disagrees', () => {
    let bad = 0;
    for (const v of B) {
      try {
        const m = mem(v);
        bashDoor(m, { pickfx: v.pickfx }, { noLucky: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('per-screen attrib record (CODE+0x923E): where A4-22025 / -22029 / -22030..-22032 and the door bytes come from', () => {
  const V = load('attrib');
  it('matches the game: resident table or file, 64 bytes to A4-22042', () => {
    for (const v of V) {
      const m = mem(v);
      loadAttribRecord(m, v.file);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(V.some((v: any) => v.resident) && V.some((v: any) => !v.resident)).toBe(true);
  });
  it('null control: ignoring the resident table disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        loadAttribRecord(m, v.file, { noTable: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(20);
  });
});

describe('paying for a cast (CODE+0x6DC6)', () => {
  const V = load('charge');
  it('matches the game: gems always, SP only when affordable, costs cleared', () => {
    for (const v of V) {
      const m = mem(v);
      chargeCast(m);
      expect(m.changes()).toEqual(v.fin);
    }
  });
  it('null control: charging SP without the gate disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        chargeCast(m, { sameGate: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('shop item price (CODE+0x1BF16)', () => {
  const V = load('price');
  it('matches the game: base, plus counts, mode 5/6, buyer nibble match', () => {
    for (const v of V) {
      const m = mem(v);
      expect(shopPrice(m, v.slot)).toBe(v.ret);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(V.some((v: any) => v.ret > 2000)).toBe(true);
  });
  it('null control: no second halving when selling disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        if (shopPrice(mem(v), v.slot, { noMatchHalf: true }) !== v.ret) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('shop buy command (CODE+0x1BE44, payment 0x1BDD6)', () => {
  const V = load('buy');
  it('matches the game: condition refusal, full pack, gold check and payment, copy of id/charges/flags', () => {
    for (const v of V) {
      const m = mem(v);
      const msgs = buyItem(m, v.slot);
      expect(m.changes()).toEqual(v.fin);
      expect(msgs).toEqual(v.calls.map((c: any) => c[1][0]));
    }
    expect(new Set(V.map((v: any) => v.calls[0][1][0])).size).toBe(4);
  });
  it('null control: not deducting the gold disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        buyItem(m, v.slot, { noPay: true });
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('remaining non-combat spell handlers (1 5 10 12 15 30 34 37 38 47 57 71 72 80 87 91 94 95)', () => {
  const V = load('ncspell2');
  it('match the game through the real dispatcher: pickers, item picker, ageing, teleports, item edits', () => {
    for (const v of V) {
      const m = mem(v);
      const c = castNonCombat2(m, v.spell, { keys: [], picks: [...v.picks], kills: [], ikeys: [...v.ikeys] });
      expect(m.changes()).toEqual(v.fin);
      expect(c.map((x) => x[0])).toEqual(v.calls.map((x: any) => x[0]).filter((x: string) => x !== 'ikey'));
    }
    expect(new Set(V.map((v: any) => v.spell)).size).toBe(NC_SPELLS2.length);
  });
  const nullCase = (name: string, o: any, spells: number[]) =>
    it('null control: ' + name, () => {
      let bad = 0;
      for (const v of V.filter((x: any) => spells.includes(x.spell))) {
        try {
          const m = mem(v);
          castNonCombat2(m, v.spell, { keys: [], picks: [...v.picks], kills: [], ikeys: [...v.ikeys] }, o);
          if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
        } catch {
          bad++;
        }
      }
      expect(bad).toBeGreaterThan(0);
    });
  nullCase('Rejuvenate ignoring the age floor disagrees', { noAge: true }, [80]);
  nullCase('Resurrection without the endurance check disagrees', { noEndurance: true }, [94]);
  nullCase('Detect Magic ignoring a declined confirm disagrees', { mut: 'v1' }, [1]);
  nullCase('Location setting the reload flag the wrong way disagrees', { mut: 'v5' }, [5]);
  nullCase('Jump ignoring the target cell wall layer disagrees', { mut: 'v10' }, [10]);
  nullCase("Lloyd's Beacon with the keys swapped disagrees", { mut: 'v12' }, [12]);
  nullCase('Fly with a 3-wide spot table disagrees', { mut: 'v15' }, [15]);
  nullCase('Teleport refused on the wrong square bit disagrees', { mut: 'v30' }, [30]);
  nullCase('Recharge accepting an empty item disagrees', { mut: 'v34' }, [34]);
  nullCase('Duplication ignoring the id < 0xD0 limit disagrees', { mut: 'v37' }, [37]);
  nullCase('Etherealize ignoring the antimagic bit disagrees', { mut: 'v38' }, [38]);
  nullCase('Enchant at 25 SP per plus disagrees', { mut: 'v47' }, [47]);
  nullCase('Restore Alignment from the wrong byte disagrees', { mut: 'v71' }, [71]);
  nullCase('Surface ignoring a zero recall coordinate disagrees', { mut: 'v72' }, [72]);
  nullCase('Town Portal ignoring the no-teleport bit disagrees', { mut: 'v91' }, [91]);
  nullCase('Uncurse accepting 0xFF flags disagrees', { mut: 'v95' }, [95]);
  nullCase("Nature's Gate ignoring the overland-mode word disagrees", { mut: 'v57' }, [57]);
  nullCase('Raise Dead not ageing the target disagrees', { mut: 'v87' }, [87]);
});

describe('character creation: exchange stats (OVL+0x201A)', () => {
  const V = load('cgxchg');
  const run = (v: any, o: any = {}) => {
    const m = mem(v);
    const ks = [...v.keys];
    exchangeStats(m, v.idx, v.stats, v.flags, () => ks.shift() ?? 0x1b, o);
    return m.changes();
  };
  it('matches the game: key loop, toupper, swap, eligibility recompute', () => {
    for (const v of V) expect(run(v)).toEqual(v.fin);
    expect(V.some((v: any) => Object.keys(v.fin).length > 3)).toBe(true);
    expect(V.some((v: any) => Object.keys(v.fin).length === 0)).toBe(true);
  });
  it('null controls: no toupper / no flag recompute disagree', () => {
    for (const o of [{ noUpper: true }, { noFlags: true }]) {
      let bad = 0;
      for (const v of V) { try { if (JSON.stringify(run(v, o)) !== JSON.stringify(v.fin)) bad++; } catch { bad++; } }
      expect(bad).toBeGreaterThan(5);
    }
  });
});

/**
 * Pass 4: overlay hunk (character creation, file loaders) and world rules (tools/mm2/rules5.ts) against vectors recorded from the retail
 * MM2 executable under Unicorn (rules_oracle/rules5.py). Same strict-memory method and null controls as rules.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { StrictMem } from '../rules-mem.ts';
import { load } from './vectors.ts';
import { loadAttribRecord, bashDoor, unlockDoor, loadTable, buildCharacter, chargenFlags, chargenRoll, chargenSlot, createCharacter } from '../rules5.ts';

vi.setConfig({ testTimeout: 120000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);

describe('character creation: first free slot (OVL+0x181E)', () => {
  const V = load('cgslot');
  it('matches the game', () => {
    for (const v of V) expect(chargenSlot(mem(v))).toBe(v.ret);
    expect(V.some((v: any) => v.ret === 0xffff) && V.some((v: any) => v.ret > 0)).toBe(true);
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

/**
 * NPCs and monsters in the Ishar scene, on the shipped data (no oracle):
 * - each title's `EN1.FIC` read list (`ISHAR*_EN1_READS`) is MAIN's own
 *   `cfreadb` run, and sums to the file size;
 * - Ishar 1's ENCONT places Bormin (EN1 slot 28, CONT1 15,29) the way the
 *   game does on the first steps of a new game. The expected placements
 *   are the oracle's display list for the same steps (`.spr` dumps, owner
 *   BORMIN.DO, `dep=x,depth,z`): depth 291 / 192 / 93 at 4 / 3 / 2 cells.
 * The oracle walks (`oracle-parity.test.ts`) measure the rest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeAlisInstr } from '../../shared/alis-disasm.ts';
import { seededRandom } from '../../shared/alis-interp.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';
import { IsharGridBuffers, IsharScene, isharEntityMemory, ISHAR1_EN1_READS, ISHAR1_TITLE, ISHAR2_EN1_READS, ISHAR3_EN1_READS, type IsharPartyState } from '../../shared/ishar-scene.ts';

const TITLES = [
  { dir: 'data/ishar/amigaaga', reads: ISHAR1_EN1_READS, at: 0x4a9e, version: 20, size: 3640 },
  { dir: 'data/ishar2/amigaaga', reads: ISHAR2_EN1_READS, at: 0x3e22, version: 20, size: 6050 },
  { dir: 'data/ishar3/amigaaga', reads: ISHAR3_EN1_READS, at: 0x4bcd, version: 30, size: 6050 },
];

describe('EN1.FIC read lists', () => {
  for (const t of TITLES) {
    it.skipIf(!existsSync(`${t.dir}/MAIN.DO`))(`${t.dir}: MAIN's cfreadb run`, () => {
      const main = unpackIsharScript(new Uint8Array(readFileSync(`${t.dir}/MAIN.DO`)));
      const got: Array<[number, number]> = [];
      for (let pc = t.at; ; ) {
        const i = decodeAlisInstr(main, pc, t.version);
        if (i.op !== 'cfreadb') break;
        got.push([Number(i.fields.addr), Number(i.fields.len)]);
        pc = i.end;
      }
      expect(got).toEqual(t.reads);
      expect(got.reduce((s, [, n]) => s + n, 0)).toBe(t.size);
      expect(readFileSync(`${t.dir}/EN1.FIC`).length).toBe(t.size);
    });
  }
});

describe('oprnd', () => {
  it('is a pure function of its seed, below the range', () => {
    for (let slot = 28; slot < 70; slot++) {
      const v = seededRandom(slot * 100, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(9);
      expect(seededRandom(slot * 100, 9)).toBe(v);
    }
  });
});

const D = 'data/ishar/amigaaga';
describe.skipIf(!existsSync(`${D}/ENCONT.DO`) || !existsSync(`${D}/EN1.FIC`))('Ishar 1 ENCONT', () => {
  const cache = new Map<string, Uint8Array | undefined>();
  const load = (n: string) => {
    const k = n.toUpperCase();
    if (!cache.has(k)) cache.set(k, existsSync(`${D}/${k}.DO`) ? unpackIsharScript(new Uint8Array(readFileSync(`${D}/${k}.DO`))) : undefined);
    return cache.get(k);
  };
  const layers = (n: number) => (existsSync(`${D}/CONT${n}.FIC`) ? [new Uint8Array(readFileSync(`${D}/CONT${n}.FIC`))] : undefined);

  it('draws Bormin from his EN1 slot, by depth, on the first steps of a new game', () => {
    const buffers = new IsharGridBuffers(ISHAR1_TITLE, layers);
    const start: IsharPartyState = { region: 1, row: 11, col: 29, facing: 1 };
    const scene = new IsharScene(ISHAR1_TITLE, load, buffers.update(start));
    scene.memory = isharEntityMemory(ISHAR1_TITLE, new Uint8Array(readFileSync(`${D}/EN1.FIC`)));
    scene.enter(start);
    const bormin = () => scene.leaves().filter((l) => l.script === 'BORMIN').map((l) => [l.x, l.y, l.z]);
    const at = (row: number) => {
      const st = { ...start, row };
      scene.setGrids(buffers.update(st));
      scene.step(st);
      return bormin();
    };
    expect(at(12)).toEqual([[0, 291, 0]]);
    expect(at(13)).toEqual([[0, 192, -1]]);
    expect(at(14).sort()).toEqual([[-1, 93, 11], [0, 93, -24]].sort());
    // without entities the scene is scenery only
    const off = new IsharScene(ISHAR1_TITLE, load, buffers.update(start));
    off.npcs = false;
    off.enter(start);
    off.step({ ...start, row: 12 });
    expect(off.scriptNames).not.toContain('ENCONT');
    expect(off.leaves().some((l) => l.script === 'BORMIN')).toBe(false);
  });
});

describe.skipIf(!existsSync(`${D}/CONT5.FIC`))('Ishar 1 cave doors (the walker E key)', () => {
  it('finds the door the party faces, from either side, and opening it lets the party through', async () => {
    const { ishar1FacingDoor, ishar1DoorClickable, ISHAR1_TITLE: T } = await import('../../shared/ishar-scene.ts');
    const g = new Uint8Array(readFileSync(`${D}/CONT5.FIC`));
    const cell = (_r: number, row: number, col: number) => ((g[row * 90 + col]! << 24) >> 24);
    // CONT5 (16,24) = 51: a door on its south edge, PARAM entry 11 (oracle: shut, refuses the step south)
    const inside = { region: 15, row: 16, col: 24, facing: 1 as const };
    expect(ishar1FacingDoor(inside, cell)).toBe(11);
    expect(ishar1FacingDoor({ ...inside, row: 17, facing: 3 }, cell)).toBe(11);
    expect(ishar1FacingDoor({ ...inside, facing: 0 }, cell)).toBe(-1);
    expect(ishar1FacingDoor({ ...inside, region: 5 }, cell)).toBe(-1);
    expect(ishar1DoorClickable(11)).toBe(true);
    expect(ishar1DoorClickable(30)).toBe(false); // a lever door
    expect(ishar1DoorClickable(16)).toBe(false); // PCAVE form 16 is the lever form
    const shut = T.tables![0x3b64]!;
    const open = [...shut];
    open[11] = 1;
    const south = { ...inside, row: 17 };
    expect(T.enter!({ ...inside, tables: { 0x3b64: shut } }, south, cell)).toBeNull();
    expect(T.enter!({ ...inside, tables: { 0x3b64: open } }, south, cell)).toEqual(south);
  });
});

describe('Ishar 1 locks and levers (SOURIS, FRISE and PCAVE, oracle-driven 2026-11-25)', () => {
  it('reads each lockable door\'s key kind and pick-lock threshold off PCAVE\'s forms', async () => {
    const { ishar1DoorLock } = await import('../../shared/ishar-scene.ts');
    // door 11: form material 44 = 32 | 12 (oracle: the click at the lock plate reported mat 44, key 12 opened it)
    expect(ishar1DoorLock(11)).toEqual({ key: 12, pick: null });
    // door 1: kind 2, picked with skill above 60 (oracle: 61 opened it, 60 did not)
    expect(ishar1DoorLock(1)).toEqual({ key: 2, pick: 60 });
    expect(ishar1DoorLock(16)).toBeNull();
    expect(ishar1DoorLock(40)).toBeNull();
  });
  it('pulls a lever the way PCAVE +0x213 does', async () => {
    const { ishar1PullLever, ISHAR1_TITLE: T } = await import('../../shared/ishar-scene.ts');
    const doors = T.tables![0x3b64]!;
    const levers = T.tables![0x3b98]!;
    // oracle: lever 1 at CONT5 (28,55): state 1, door 17 opens, doors 21-23 follow the lever-13 rule
    const a = ishar1PullLever(levers, doors, 1);
    expect(a.levers[1]).toBe(1);
    expect([a.doors[17], a.doors[21], a.doors[22], a.doors[23]]).toEqual([1, 0, 0, 1]);
    // lever 19 swaps gates 24/25; pulled again it swaps them back
    const b = ishar1PullLever(levers, doors, 19);
    expect([b.doors[24], b.doors[25]]).toEqual([1, 0]);
    const c = ishar1PullLever(b.levers, b.doors, 19);
    expect([c.levers[19], c.doors[24], c.doors[25]]).toEqual([0, 0, 1]);
    // lever 13 goes to 2 and then only a pick moves the doors
    const d = ishar1PullLever(levers, doors, 13);
    expect(d.levers[13]).toBe(2);
    expect(ishar1PullLever(d.levers, d.doors, 13)).toEqual(d);
    expect(ishar1PullLever(d.levers, d.doors, 13, true).doors.slice(21, 24)).toEqual([1, 1, 0]);
  });
  it.skipIf(!existsSync(`${D}/CONT5.FIC`))('finds the lever the party faces (cells 66..69, the door edge order)', async () => {
    const { ishar1FacingLever, ishar1Use, ISHAR1_TITLE: T } = await import('../../shared/ishar-scene.ts');
    const g = new Uint8Array(readFileSync(`${D}/CONT5.FIC`));
    const cell = (_r: number, row: number, col: number) => ((g[row * 90 + col]! << 24) >> 24);
    // (35,13) = 69: lever 19 on the east edge (walker facing 2 = raw 3)
    const at = { region: 15, row: 35, col: 13, facing: 2 as const };
    expect(ishar1FacingLever(at, cell)).toBe(19);
    expect(ishar1FacingLever({ ...at, facing: 1 }, cell)).toBe(-1);
    const u = ishar1Use(at, cell, T.tables![0x3b64]!, T.tables![0x3b98]!);
    expect(u?.lever).toBe(19);
    expect(u?.levers[19]).toBe(1);
  });
});

describe.skipIf(!existsSync('data/ishar3/amigaaga/CONT5-3.FIC'))('Ishar 3 dungeon levers (DJ1 +0x123d, PCAVE +0x32f)', () => {
  it('finds the lever in the party\'s cell and toggles its door', async () => {
    const { ishar3FacingLever, ishar3PullLever, ISHAR3_TITLE: T, ISHAR3_DOOR_TABLE, ISHAR3_LEVER_TABLE } = await import('../../shared/ishar-scene.ts');
    const f = new Uint8Array(readFileSync('data/ishar3/amigaaga/CONT5-3.FIC'));
    const n = 57 * 82;
    const cell = (_r: number, row: number, col: number) => ((f[row * 57 + col]! << 24) >> 24);
    const cellB = (_r: number, row: number, col: number) => ((f[n + row * 57 + col]! << 24) >> 24);
    // (8,45) = 47 / -23: lever 13, drawn when the party faces raw 2 (walker facing 1)
    const at = { region: 7, row: 8, col: 45, facing: 1 as const };
    expect(ishar3FacingLever(at, cell, cellB)).toBe(13);
    expect(ishar3FacingLever({ ...at, facing: 0 }, cell, cellB)).toBe(-1);
    expect(ishar3FacingLever({ ...at, region: 1 }, cell, cellB)).toBe(-1);
    const p = ishar3PullLever(T.tables![ISHAR3_LEVER_TABLE]!, T.tables![ISHAR3_DOOR_TABLE]!, 13);
    expect([p.levers[13], p.doors[13]]).toEqual([1, 1]);
    const q = ishar3PullLever(p.levers, p.doors, 13);
    expect([q.levers[13], q.doors[13]]).toEqual([0, 0]);
    // the door at (9,31) holds grid-B 73: index 13
    expect(cellB(7, 9, 31)).toBe(73);
  });
});

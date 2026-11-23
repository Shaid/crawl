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

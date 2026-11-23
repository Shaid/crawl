/**
 * Ishar 3's location add-ons (`ishar3LocationAddOns`) against the shipped
 * MAIN.DO: MAIN `+0x2060` is the starter MAIN's main loop calls when the
 * location `0x3b33` changes (`+0x12d3` -> `+0x26bf` kill, `+0x189a` load,
 * `+0x2060` start). It is three `cswitch1`s on the location in a row
 * (`+0x2060`, `+0x2524`, `+0x2677`); this test follows them for every
 * location and collects the `clive`d scripts. The fireball loops and the
 * `0x3d94` test are taken on their fall-through path (the trap tables'
 * condition is checked separately against the new-game tables).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISHAR3_TITLE, ishar3LocationAddOns } from '../../shared/ishar-scene.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';
import { decodeAlisInstr } from '../../shared/alis-disasm.ts';

const MAIN = 'data/ishar3/amigaaga/MAIN.DO';

type Instr = { op: string; end: number; fields: Record<string, any> };

describe.skipIf(!existsSync(MAIN))('Ishar 3 location add-ons', () => {
  const main = unpackIsharScript(new Uint8Array(readFileSync(MAIN)));
  const at = (pc: number) => decodeAlisInstr(main, pc, 30) as unknown as Instr;
  // MAIN's own cload list names each script id (+0x16b1 .. +0x2060)
  const names = new Map<number, string>();
  for (let pc = 0x16b1; pc < 0x2060; ) {
    const i = at(pc);
    if (i.op === 'cload' && typeof i.fields.name === 'string') names.set(i.fields.id as number, (i.fields.name as string).replace(/\.AO$/i, '').toUpperCase());
    pc = i.end;
  }

  /** The `clive`d names for one location, following the three switches (loops and tests on their fall-through path). */
  const started = (location: number): string[] => {
    const out: string[] = [];
    let pc = 0x2060;
    for (let n = 0; n < 400; n++) {
      const i = at(pc);
      if (i.op === 'cswitch1') {
        const c = (i.fields.cases as Array<{ value: number; target: number }>).find((k) => k.value === location);
        pc = c ? c.target : i.end;
      } else if (i.op === 'cjmp') pc = i.fields.target;
      else if (i.op === 'cret') return out;
      else {
        if (i.op === 'clive') out.push(names.get(i.fields.id) ?? `#${i.fields.id}`);
        pc = i.end;
      }
    }
    throw new Error('runaway');
  };

  it('every location starts what MAIN +0x2060/+0x2524/+0x2677 start', () => {
    // the fall-through path takes each fireball loop once; give the model a table that matches once
    const once = (addr: number, i: number) => (addr === 0x3e1a ? (i === 1 ? 1 : 0) : i === 1 ? 0 : 0);
    for (let location = 0; location <= 60; location++) {
      const want = ishar3LocationAddOns(location, (a, i) => (a === 0x3eb8 && i === 1 ? location : once(a, i)), 0).map((a) => (typeof a === 'string' ? a : a.name));
      // location 26's three unconditional fireballs collapse to one on the fall-through path
      const dedup = want.filter((n, k) => n !== 'FIREBALL' || want.indexOf('FIREBALL') === k);
      expect(started(location), `location ${location}`).toEqual(dedup);
    }
  });

  it('the trap tables pick the new game fireballs (8 at location 21, 3 at 26, 1 at 27)', () => {
    const t = (a: number, i: number) => ISHAR3_TITLE.tables![a]![i] ?? 0;
    const count = (loc: number) => ishar3LocationAddOns(loc, t).filter((a) => typeof a !== 'string' && a.name === 'FIREBALL').length;
    expect([count(21), count(26), count(27)]).toEqual([8, 3, 1]);
  });
});

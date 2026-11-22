/**
 * Ishar 1's step test (GERDEP `+0xc38`) on the shipped data: the EN1.FIC
 * monster table and the monster check (`+0x1584`). The table offsets were
 * checked byte-exact against the oracle's boot memory; this pins them on
 * the retail file without the oracle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISHAR1_TITLE, ishar1MonsterTableFromEn1, ishar1Occupancy, isharEnter } from '../../shared/ishar-scene.ts';

const EN1 = 'data/ishar/amigaaga/EN1.FIC';
const cont = (n: number) => new Uint8Array(readFileSync(`data/ishar/amigaaga/CONT${n}.FIC`));

describe.skipIf(!existsSync(EN1))('Ishar 1 step test', () => {
  const table = ishar1MonsterTableFromEn1(new Uint8Array(readFileSync(EN1)));
  const occupied = ishar1Occupancy(table);

  it('reads the EN1.FIC monster arrays at the loader offsets', () => {
    // slot 46: the CONT3 causeway guard; slot 28: Bormin (an NPC, kind >= 0)
    expect([table.row[46], table.col[46], table.hp[46], table.kind[46], table.region[46], table.z[46]]).toEqual([9, 26, 70, -1, 3, 0]);
    expect([table.row[28], table.col[28], table.kind[28], table.region[28]]).toEqual([15, 29, 15, 1]);
    // slots 60+ are empty until ENCONT spawns roaming monsters into them
    expect(table.hp.slice(60)).toEqual(new Array(10).fill(0));
  });

  it('refuses a step onto a monster that holds its cell, not onto an NPC', () => {
    const c3 = cont(3);
    expect(c3[9 * 90 + 26]).toBe(1); // a plain causeway cell
    const to = { region: 3, row: 9, col: 26, facing: 1 as const };
    expect(isharEnter(to, 1)).toEqual(to);
    expect(isharEnter(to, 1, occupied)).toBeNull();
    const bormin = { region: 1, row: 15, col: 29, facing: 1 as const };
    expect(isharEnter(bormin, cont(1)[15 * 90 + 29]!, occupied)).toEqual(bormin);
    // the spec passes the occupancy through
    expect(ISHAR1_TITLE.enter!(to, to, () => 1, occupied)).toBeNull();
  });
});

describe.skipIf(!existsSync('data/ishar/amigaaga/MCAVE.DO'))('ALIS operand decoding (entity lists, other entities)', () => {
  it('reads clistent/crstent destinations and two-word ohim/shim operands', async () => {
    const { unpackIsharScript } = await import('../../shared/ishar-firstperson.ts');
    const { decodeAlisInstr } = await import('../../shared/alis-disasm.ts');
    const mcave = unpackIsharScript(new Uint8Array(readFileSync('data/ishar/amigaaga/MCAVE.DO')));
    // MCAVE +0x5a: clistent -> sdirw(0x44), then the loop test on that local
    const l = decodeAlisInstr(mcave, 0x5a);
    expect(l.op).toBe('clistent');
    expect(l.end).toBe(0x5d);
    // MCAVE +0x321f: cstore {odirw(0x10) / 3} -> shimw(local 0x44, +2): 13 bytes, ends at 0x322c
    const st = decodeAlisInstr(mcave, 0x321f);
    expect(st.fields.dest).toEqual({ t: 'him', op: 'shimw', value: 0x44, offset: 2 });
    expect(st.end).toBe(0x322c);
  });
});

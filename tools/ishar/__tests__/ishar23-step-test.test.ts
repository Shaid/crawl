/**
 * Ishar 2/3 step tests (GERDEP), on hand-made cells and monster tables, and
 * the unpacker's last byte (checked against the running engine's memory).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ishar2Enter, ishar2Occupancy, ishar3Occupancy, ISHAR3_TITLE, type IsharPartyState } from '../../shared/ishar-scene.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';

const st = (region: number, row: number, col: number): IsharPartyState => ({ region, row, col, facing: 0 });

/** EN1 arrays with one monster slot filled (words big-endian). */
function en1(slot: number, f: { zone: number; row: number; col: number; hp: number; kind: number; type: number }, arrays: Record<string, number>) {
  const mem = new Map<number, Uint8Array>();
  const word = (addr: number, v: number) => { const a = new Uint8Array(220); a[2 * slot] = (v >> 8) & 0xff; a[2 * slot + 1] = v & 0xff; mem.set(addr, a); };
  const byte = (addr: number, v: number) => { const a = new Uint8Array(110); a[slot] = v & 0xff; mem.set(addr, a); };
  byte(arrays.zone!, f.zone); word(arrays.row!, f.row); word(arrays.col!, f.col); word(arrays.hp!, f.hp); byte(arrays.kind!, f.kind); word(arrays.type!, f.type);
  return (addr: number) => mem.get(addr);
}

describe('Ishar 2 step test (GERDEP +0xb72)', () => {
  const flat = () => 5;
  it('a monster in the party cell holds the side its type names, outside region 1', () => {
    const occ = ishar2Occupancy(en1(77, { zone: 42, row: 19, col: 43, hp: 400, kind: -1, type: 1 }, { zone: 0x449a, row: 0x3412, col: 0x34f0, hp: 0x36ac, kind: 0x43ba, type: 0x35ce }), 42)!;
    expect(ishar2Enter(st(6, 19, 43), st(6, 19, 42), flat, occ)).toBeNull(); // west = type 1
    expect(ishar2Enter(st(6, 19, 43), st(6, 20, 43), flat, occ)).not.toBeNull();
  });
  it('dungeon doors: a shut door index above 60 on the crossed edge refuses the step', () => {
    // (5,21) holds 40 (a door on its south edge) with door index 89 in layer 1
    const cell = (_r: number, row: number) => (row === 5 ? 40 : 13);
    const cellB = (_r: number, row: number) => (row === 5 ? 89 : 0);
    expect(ishar2Enter(st(7, 5, 21), st(7, 6, 21), cell, undefined, cellB, [])).toBeNull();
    const open: number[] = []; open[29] = 1;
    expect(ishar2Enter(st(7, 5, 21), st(7, 6, 21), cell, undefined, cellB, open)).not.toBeNull();
    expect(ishar2Enter(st(7, 5, 21), st(7, 5, 22), cell, undefined, cellB, [])).not.toBeNull();
  });
});

describe('Ishar 3 step test (GERDEP +0xe93/+0xf13)', () => {
  const arrays = { zone: 0x2f0a, row: 0x1e22, col: 0x1f04, hp: 0x20c8, kind: 0x2e22, type: 0x1fe6 };
  it('in the forest a monster on the target refuses it', () => {
    const read = en1(91, { zone: 50, row: 6, col: 9, hp: 0, kind: -5, type: 2 }, arrays);
    const occ = ishar3Occupancy((a) => read(a) ?? new Uint8Array(220), 50)!;
    const flat = () => 0;
    expect(ISHAR3_TITLE.enter!(st(5, 6, 8), st(5, 6, 9), flat, occ)).toBeNull();
    expect(ISHAR3_TITLE.enter!(st(5, 6, 8), st(5, 7, 8), flat, occ)).not.toBeNull();
  });
});

const FJUNGLE = 'data/ishar3/amigaaga/FJUNGLE.DO';
describe.skipIf(!existsSync(FJUNGLE))('unpacker', () => {
  it('decodes the last byte (FJUNGLE ends with its composite record z = -26, as the engine holds it)', () => {
    const d = unpackIsharScript(new Uint8Array(readFileSync(FJUNGLE)));
    expect(Buffer.from(d.subarray(d.length - 10)).toString('hex')).toBe('ff01000300000000ffe6');
  });
});

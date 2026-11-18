import { describe, expect, it } from 'vitest';
import { decodeMap, encodeMap, decodeMapCell, encodeMapCell, MAP_FILE_SIZE } from '../map.ts';

describe('map.dat cell decode', () => {
  it('decodes page-0 visual wall fields in W,S,E,N bit order (2 bits each)', () => {
    const cell = decodeMapCell(0x13, 0x00);
    expect(cell.visual).toEqual({ w: 3, s: 0, e: 1, n: 0 }); // 0x13 = 0001 0011
    expect(cell.event).toBe(false);
  });

  it('decodes page-1 collision: 0x55 wall bits, 0x20 dark, 0x80 event', () => {
    // 0xE2 = 1110 0010: W field = 2 (bit 1 only: unidentified, no wall),
    // 0x20 cell dark, N wall (0x40), event (0x80).
    const cell = decodeMapCell(0x00, 0xe2);
    expect(cell.collision.w).toBe(2);
    expect(cell.collision.n).toBe(1);
    expect(cell.dark).toBe(true);
    expect(cell.event).toBe(true);
    expect(decodeMapCell(0x00, 0xc2).dark).toBe(false);
  });

  it('round-trips a whole 60-screen file byte-exact', () => {
    const data = new Uint8Array(MAP_FILE_SIZE);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 0xff;
    expect([...encodeMap(decodeMap(data))]).toEqual([...data]);
  });

  it('encodeMapCell inverts decodeMapCell for arbitrary values', () => {
    for (const v of [0x00, 0x13, 0x90, 0xff, 0x57, 0x84]) {
      for (const c of [0x00, 0x80, 0x33]) {
        const cell = decodeMapCell(v, c);
        const [visual, collision] = encodeMapCell(cell);
        const back = decodeMapCell(visual, collision);
        expect(back.visual).toEqual(cell.visual);
        expect(back.collision).toEqual(cell.collision);
        expect(back.event).toBe(cell.event);
      }
    }
  });
});

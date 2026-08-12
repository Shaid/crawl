import { describe, expect, it } from 'vitest';
import { decodeMap, encodeMap, decodeMapCell, encodeMapCell, MAP_FILE_SIZE } from '../map.ts';

describe('map.dat cell decode', () => {
  it('decodes page-0 visual wall fields N/E/S/W (2 bits each)', () => {
    const cell = decodeMapCell(0x13, 0x00);
    expect(cell.visual).toEqual({ n: 3, e: 0, s: 1, w: 0 }); // 0x13 = 0001 0011
    expect(cell.event).toBe(false);
  });

  it('decodes page-1 collision (wall|dark) with bit 0x80 as the event flag', () => {
    // 0xC2 = 1100 0010: north dark (bits 0-1 = 2), west wall (bit 6), event (bit 7).
    const cell = decodeMapCell(0x00, 0xc2);
    expect(cell.collision.n).toBe(2); // dark, no wall
    expect(cell.collision.w).toBe(1); // wall (no dark slot for west)
    expect(cell.event).toBe(true);
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

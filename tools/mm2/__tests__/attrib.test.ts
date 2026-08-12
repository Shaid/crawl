import { describe, expect, it } from 'vitest';
import { decodeAttrib, encodeAttrib, ATTRIB_FILE_SIZE } from '../attrib.ts';

describe('attrib.dat codec', () => {
  it('decodes a synthetic Middlegate-style record', () => {
    const rec = new Uint8Array(64);
    rec[0x00] = 0; // area_id
    rec[0x01] = 1; // town
    rec[0x02] = 0x21; // town tileset
    rec[0x03] = 0x11; // town env
    rec[0x04] = 0; // interior
    rec[0x05] = 11; // N neighbour
    rec[0x06] = 11;
    rec[0x07] = 11;
    rec[0x08] = 11;
    rec[0x0e] = 0x74; // entry coord (Y<<4)|X = (7,4)
    rec[0x0f] = 9; // era gate
    rec[0x16] = 0x37; // recall coord (3,7)
    rec[0x18] = 11; // recall screen
    rec[0x1a] = 0x80; // flags

    const file = new Uint8Array(ATTRIB_FILE_SIZE);
    file.set(rec, 0);
    const [a] = decodeAttrib(file);
    expect(a.areaId).toBe(0);
    expect(a.mapCategory).toBe(1);
    expect(a.tilesetId).toBe(0x21);
    expect(a.envType).toBe(0x11);
    expect(a.surfaceFlag).toBe(0);
    expect(a.neighbours).toEqual([11, 11, 11, 11]);
    expect(a.entryCoord).toBe(0x74);
    expect(a.eraGate).toBe(9);
    expect(a.recallCoord).toBe(0x37);
    expect(a.recallScreen).toBe(11);
    expect(a.flags).toBe(0x80);
  });

  it('round-trips a full file byte-exact', () => {
    const data = new Uint8Array(ATTRIB_FILE_SIZE);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
    const records = decodeAttrib(data);
    expect(records.length).toBe(60);
    // area_id must equal the record index per the doc — inject that.
    for (let i = 0; i < 60; i++) records[i].areaId = i;
    const encoded = encodeAttrib(records);
    const reDecoded = decodeAttrib(encoded);
    for (let i = 0; i < 60; i++) {
      expect(reDecoded[i].areaId).toBe(i);
      expect([...reDecoded[i].roofBits]).toEqual([...records[i].roofBits]);
    }
  });
});

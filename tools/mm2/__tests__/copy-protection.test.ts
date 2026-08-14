import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GLOBE_TABLE_COUNTS,
  GLOBE_XOR_KEY,
  decodeGlobeBlob,
  encodeGlobeBlob,
  decodeXorBlob,
  encodeXorBlob,
  xorPrefix,
} from '../copy-protection.ts';

describe('xorPrefix', () => {
  it('is a reversible rolling XOR over the first xorLen bytes', () => {
    const key = Uint8Array.of(1, 2, 3);
    const data = Uint8Array.of(10, 20, 30, 40, 50);
    const enc = xorPrefix(data, key, 4);
    // byte 4 is past xorLen, left untouched.
    expect(enc[4]).toBe(50);
    expect([...xorPrefix(enc, key, 4)]).toEqual([...data]);
  });
});

describe('decodeGlobeBlob / encodeGlobeBlob (synthetic)', () => {
  it('round-trips a small synthetic blob through decode/encode', () => {
    const tables = [['a', 'bb'], ['ccc']];
    const counts = [2, 1];
    const key = Uint8Array.of(0x11, 0x22, 0x33, 0x44, 0x55);
    const blob = encodeGlobeBlob(tables, key);
    const decoded = decodeGlobeBlob(blob, key, counts);
    expect(decoded.tables).toEqual(tables);
    expect(decoded.parseEndOffset).toBe(blob.length);
  });

  it('throws when a string table is missing its NUL terminator', () => {
    const key = Uint8Array.of(1, 2, 3, 4, 5);
    const bad = xorPrefix(Uint8Array.from([65, 66, 67]), key, 0x0be1); // no NUL at all
    expect(() => decodeGlobeBlob(bad, key, [1])).toThrow(/unterminated string/);
  });
});

describe('decodeXorBlob / encodeXorBlob', () => {
  it('is symmetric (XOR is its own inverse)', () => {
    const key = Uint8Array.of(9, 8, 7);
    const data = Uint8Array.of(1, 2, 3, 4, 5, 6, 7);
    const enc = decodeXorBlob(data, key, 100);
    expect([...encodeXorBlob(enc, key, 100)]).toEqual([...data]);
  });
});

// Real retail data check — only runs when data/mm2/amiga/data/globe.32 is present.
const GLOBE_PATH = resolve('data/mm2/amiga/data/globe.32');
const hasGlobe = existsSync(GLOBE_PATH);

describe('globe.32 real retail data', { skip: !hasGlobe }, () => {
  it('decodes cleanly with GLOBE_XOR_KEY: exactly 104 strings, no leftover bytes', () => {
    const raw = readFileSync(GLOBE_PATH);
    const { tables, parseEndOffset } = decodeGlobeBlob(raw);

    expect(tables.map((t) => t.length)).toEqual([...GLOBE_TABLE_COUNTS]);
    expect(tables.flat().length).toBe(104);
    // The whole file is consumed by the 7 tables — no trailing garbage.
    expect(parseEndOffset).toBe(raw.length);
  });

  it('reproduces the known Amiga port credits and copy-protection prompt text', () => {
    const raw = readFileSync(GLOBE_PATH);
    const { tables } = decodeGlobeBlob(raw);

    expect(tables[0][0]).toBe('Might and Magic Book Two\n\n');
    expect(tables[0][4]).toBe('Amiga Version by\n');
    // Table index 6 is the copy-protection "look at page ... paragraph ...
    // line ..." challenge prompt text (20-copy-protection-table.md).
    expect(tables[6][0]).toBe('MIGHT');
    expect(tables[6]).toContain('Please look at page');
    expect(tables[6]).toContain(' in your MM2 manual');
    expect(tables[6]).toContain('               line');
    expect(tables[6]).toContain('That was the word, all right.');
  });

  it('round-trips byte-exact through encode(decode(globe.32))', () => {
    const raw = readFileSync(GLOBE_PATH);
    const { tables } = decodeGlobeBlob(raw);
    const reencoded = encodeGlobeBlob(tables);
    expect([...reencoded]).toEqual([...raw]);
  });

  it('the key differs from Vairn reference script default (documented correction)', () => {
    // Vairn's decode_globe_amiga.py default key f129ab5a07 does NOT decode
    // this retail file (0 NUL bytes anywhere in the XOR'd output, so string
    // parsing fails immediately). The correct key recovered from the real
    // bytes is a one-byte-earlier read window: 37 f1 29 ab 5a. See
    // tools/mm2/copy-protection.ts module doc.
    expect([...GLOBE_XOR_KEY]).toEqual([0x37, 0xf1, 0x29, 0xab, 0x5a]);

    const raw = readFileSync(GLOBE_PATH);
    const wrongKey = Uint8Array.of(0xf1, 0x29, 0xab, 0x5a, 0x07);
    const wrongDecoded = xorPrefix(raw, wrongKey, 0x0be1);
    expect(wrongDecoded.includes(0)).toBe(false);
    expect(() => decodeGlobeBlob(raw, wrongKey)).toThrow(/unterminated string/);
  });
});

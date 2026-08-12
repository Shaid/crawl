import { describe, expect, it } from 'vitest';
import { decodeStr, encodeStr } from '../str.ts';

describe('str.dat XOR-0x1C codec', () => {
  it('decodes the documented transform: decoded = (encoded + 0x1C) & 0xFF', () => {
    // 'A' (0x41) is stored as 0x41 - 0x1C = 0x25.
    expect(decodeStr(Uint8Array.from([0x25]))).toBe('A');
    // 0x01 is the newline/line-break byte.
    expect(decodeStr(Uint8Array.from([0x25, 0x01, 0x25]))).toBe('A\nA');
  });

  it('encodes text back to the same transform', () => {
    expect([...encodeStr('A')]).toEqual([0x25]);
    expect([...encodeStr('A\nA')]).toEqual([0x25, 0x01, 0x25]);
    // CR from CRLF input is dropped.
    expect([...encodeStr('A\r\nA')]).toEqual([0x25, 0x01, 0x25]);
  });

  it('round-trips text without CR through encode(decode(text))', () => {
    const text = "Why can't orcs lie on the beach?\nCats will bury them.";
    expect(decodeStr(encodeStr(text))).toBe(text);
  });

  it('decode is stable on encoded data that contains no literal 0x0A', () => {
    const encoded = Uint8Array.from([0x25, 0x01, 0x41, 0x7f, 0x00, 0x25]);
    expect([...encodeStr(decodeStr(encoded))]).toEqual([...encoded]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The maze layer byte DS:3C10 (MAZEDATA page 1 cell byte): bit 0x02 = anti-magic square (casting refused), bit 0x08 = no-rest square,
 * bit 0x20 = dark, bit 0x80 = special.  The ports of qcast / combat cast / rest already read them; this pins that the recorded vectors
 * really depend on each bit (null control: flip the bit as seen by the port -> the run must differ on some vector).
 */
import { describe, expect, it, vi } from 'vitest';
import { nullBad } from './check.ts';
import { QCast, Rest } from '../world.ts';
import { ComCast } from '../spells.ts';
import { load } from './vectors.ts';
import { cellLoad } from '../ovr.ts';

vi.setConfig({ testTimeout: 600000 });
const flip = (m: any, bit: number, lo = 0x3c10, hi = 0x3c10) => {
  const r8 = (a: number) => (a >= lo && a <= hi ? m.r8(a) ^ bit : m.r8(a));
  return { r8, r16: (a: number) => r8(a) | (r8(a + 1) << 8), w8: (a: number, v: number) => m.w8(a, v), w16: (a: number, v: number) => m.w16(a, v) };
};
const has = (name: string, bit: number) => load(name).filter((v: any) => ((v.init['15376'] ?? 0) & bit) !== 0).length;

describe('maze layer bits 0x02 / 0x08 / 0x20 (DS:3C10)', () => {
  it('the vector sets exercise each bit', () => {
    expect(has('qcast', 2)).toBeGreaterThan(0);
    expect(has('okrest', 8) + has('rest', 8)).toBeGreaterThan(0);
    expect(load('cellload').some((v: any) => Object.entries(v.init).some(([k, b]: any) => Number(k) >= 0x3dfa && Number(k) < 0x3efa && (b & 0x20)))).toBe(true);
  });
  it('0x02 anti-magic: non-combat cast refuses (null control: bit flipped)', () => {
    const n = nullBad('qcast', (m: any, v: any) => { const r = new QCast(flip(m, 2) as any, v.args).run(); return { stop: r.stop, calls: r.calls }; });
    expect(n).toBeGreaterThan(0);
  });
  it('0x02 anti-magic: combat cast refuses (null control: bit flipped)', () => {
    const n = nullBad('cast', (m: any, v: any) => { const r = new (ComCast as any)(flip(m, 2) as any, v.args).run(); return { stop: r.stop, calls: r.calls }; });
    expect(n).toBeGreaterThan(0);
  });
  it('0x08 no-rest: resting refused (null control: bit flipped)', () => {
    const n = nullBad('okrest', (m: any, v: any) => { const r = new Rest(flip(m, 8) as any, v.args).run('okrest'); return { stop: r.stop, calls: r.calls }; });
    const n2 = nullBad('rest', (m: any, v: any) => { const r = new Rest(flip(m, 8) as any, v.args).run('rest'); return { stop: r.stop, calls: r.calls }; });
    expect(n + n2).toBeGreaterThan(0);
  });
  it('0x20 dark: the cell loader (null control: bit flipped)', () => {
    const n = nullBad('cellload', (m: any) => { const r = cellLoad(flip(m, 0x20, 0x3dfa, 0x3ef9) as any); return { stop: r.stop }; });
    expect(n).toBeGreaterThan(0);
  });
});

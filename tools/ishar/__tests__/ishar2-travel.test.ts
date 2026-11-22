/**
 * Ishar 2's travel arrival table (MAIN `+0xee6`) against the shipped MAIN.DO:
 * every `ISHAR2_TRAVEL` entry is one arm of five `cstore oimmb` writes
 * (row 0x2ab4, col 0x2ab5, region 0x2d18, zone 0x4ef2, facing 0x2ab6).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISHAR2_TRAVEL } from '../../shared/ishar-scene.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';

const MAIN = 'data/ishar2/amigaaga/MAIN.DO';

describe.skipIf(!existsSync(MAIN))('Ishar 2 travel table', () => {
  const main = unpackIsharScript(new Uint8Array(readFileSync(MAIN)));
  const hex = Buffer.from(main).toString('hex');
  const store = (v: number, addr: number) => `1e00${(v & 0xff).toString(16).padStart(2, '0')}06${addr.toString(16).padStart(4, '0')}`;
  it('every destination is an arm of the +0xee6 switch', () => {
    expect(hex.slice(0xee6 * 2, 0xee6 * 2 + 8)).toBe('2f0651bf');
    for (const d of ISHAR2_TRAVEL) {
      const arm = store(d.row, 0x2ab4) + store(d.col, 0x2ab5) + store(d.region, 0x2d18) + store(d.zone, 0x4ef2) + store(d.facingRaw, 0x2ab6);
      const at = hex.indexOf(arm);
      expect(at, `selector ${d.selector}`).toBeGreaterThan(0xee6 * 2);
      expect(at).toBeLessThan(0x10aa * 2);
    }
  });
});

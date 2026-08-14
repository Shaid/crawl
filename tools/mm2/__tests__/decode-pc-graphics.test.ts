import { describe, expect, it } from 'vitest';
import { isOutdoorSheet } from '../decode-pc-graphics.ts';

describe('isOutdoorSheet', () => {
  it('classifies OCEAN (a real outdoor biome file) as outdoor', () => {
    expect(isOutdoorSheet('OCEAN.16')).toBe(true);
    expect(isOutdoorSheet('OCEAN.4')).toBe(true);
  });

  it('classifies the real outdoor biome sheets as outdoor', () => {
    for (const name of ['DESERT.16', 'SWAMP.16', 'TUNDRA.16', 'OUTDOOR1.16', 'OUTDOOR2.16', 'OUTDOOR3.16']) {
      expect(isOutdoorSheet(name)).toBe(true);
    }
  });

  it('does not classify indoor sheets, or the bogus removed biome names, as outdoor', () => {
    for (const name of ['CASTLE.16', 'TOWN.16', 'THROW.16', 'GRASS.16', 'HIGHGRASS.16', 'LAVA.16', 'SNOW.16']) {
      expect(isOutdoorSheet(name)).toBe(false);
    }
  });
});

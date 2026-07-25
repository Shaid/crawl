import { describe, it, expect } from 'vitest';
import { getGameConfig } from '../game-config.ts';

describe('getGameConfig', () => {
  it('finds the placeholder config', () => {
    const config = getGameConfig('blackcrpyt', 'amiga');
    expect(config).toBeDefined();
    expect(config?.assetDir).toBe('blackcrpyt');
  });
});

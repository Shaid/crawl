import { describe, it, expect } from 'vitest';
import { getGameConfig } from '../game-config.ts';

describe('getGameConfig', () => {
  it('finds the placeholder config', () => {
    const config = getGameConfig('wizardry6', 'amiga');
    expect(config).toBeDefined();
    expect(config?.assetDir).toBe('wizardry6');
  });
});

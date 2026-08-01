import { describe, it, expect } from 'vitest';
import { getGameConfig, getSupportedPlatforms } from '../game-config.ts';

describe('getGameConfig', () => {
  it('resolves the Black Crypt Amiga config', () => {
    const config = getGameConfig('blackcrypt', 'amiga');
    expect(config).toBeDefined();
    expect(config?.assetDir).toBe('blackcrypt');
    expect(config?.platform).toBe('amiga');
  });

  it('reports amiga as a supported platform', () => {
    expect(getSupportedPlatforms('blackcrypt')).toContain('amiga');
  });
});

import { describe, it, expect } from 'vitest';
import { getViewerConfig, getAssetBasePath, VIEWER_CONFIGS } from '../viewer-config.ts';

describe('viewer-config', () => {
  it('defaults Black Crypt to Amiga', () => {
    const config = getViewerConfig('blackcrypt');
    expect(config.name).toBe('Black Crypt');
    expect(config.defaultPlatform).toBe('amiga');
  });

  it('exposes both Black Crypt platforms', () => {
    expect(getViewerConfig('blackcrypt').supportedPlatforms).toContain('amiga');
    expect(getViewerConfig('blackcrypt').supportedPlatforms).toContain('dosvga');
  });

  it('resolves asset base paths per game+platform', () => {
    expect(getAssetBasePath('blackcrypt', 'amiga')).toBe('/assets/blackcrypt/amiga');
    expect(getAssetBasePath('blackcrypt', 'dosvga')).toBe('/assets/blackcrypt/dosvga');
  });

  it('keeps a valid default platform for every non-empty config', () => {
    for (const config of Object.values(VIEWER_CONFIGS)) {
      if (config.supportedPlatforms.length > 0) {
        expect(config.supportedPlatforms).toContain(config.defaultPlatform);
      }
    }
  });
});

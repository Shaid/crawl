import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DATA = 'data/crystaldragon/amiga/data';

// Runs the Python self-tests (SF decoder over 31/31 files + null controls;
// level region tables tile the grid exactly on 23/23 levels).
describe.skipIf(!existsSync(DATA))('crystal dragon cdlib', () => {
  for (const mod of ['scripts.cdlib.test_sf', 'scripts.cdlib.test_level']) {
    it(mod, () => {
      const out = execFileSync('python3', ['-m', mod], { encoding: 'utf8' });
      expect(out).toContain('ok');
    });
  }
});

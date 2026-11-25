import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const DIR = resolve('tools/mm3/rules_oracle');
/** Full vector set when generated (gitignored `generated/`), else the committed subset (`vectors/<name>.json.gz`). */
export function load(name: string): any[] {
  const full = resolve(DIR, 'generated', `${name}.json`);
  if (existsSync(full)) return JSON.parse(readFileSync(full, 'utf8'));
  const gz = resolve(DIR, 'vectors', `${name}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
}

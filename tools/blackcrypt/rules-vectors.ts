/**
 * Loads the oracle vector sets for the movement and spell tests. The full sets (about 7 MB compressed) are build-time
 * output of tools/blackcrypt/rules_oracle/gen_vectors.sh (gitignored, ./generated/); without them the small committed
 * subsets (evenly strided, 100 / 60 cases per kind) are used, so the tests always run and stay fast on a fresh checkout.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'rules_oracle');

export function loadVectors<T>(kind: 'move' | 'spell'): { data: T; full: boolean } {
  const gen = resolve(dir, 'generated', `vectors_${kind}.json.gz`);
  const full = existsSync(gen);
  const file = full ? gen : resolve(dir, `vectors_${kind}.small.json.gz`);
  return { data: JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as T, full };
}

/** a coverage / null-control threshold written for the full set; on the small subset it relaxes to "at least one case" (`fullN` = the full set's count) */
export const scaled = (min: number, n: number, fullN: number) => (n >= fullN ? min : 1);

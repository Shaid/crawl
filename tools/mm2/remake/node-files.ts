/** Node-side file loading for tests and headless runs: the user's retail files from `data/mm2/amiga/data/` as a FileSet (never committed). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSetFromMap, type FileSet } from '../../remake/engine';
import { REQUIRED } from './engine';

export const RETAIL_DIR = resolve('data/mm2/amiga/data');
export const haveRetail = (): boolean => Object.keys(REQUIRED).every(n => existsSync(resolve(RETAIL_DIR, n)));
export function retailFiles(dir = RETAIL_DIR): FileSet {
  return fileSetFromMap(new Map(Object.keys(REQUIRED).map(n => [n, new Uint8Array(readFileSync(resolve(dir, n)))])));
}

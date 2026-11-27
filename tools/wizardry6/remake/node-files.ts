/** Node-side file loading for tests and headless runs: the user's retail files from `data/wizardry6/amiga/` as a FileSet, and the walker's generated level files (never committed). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSetFromMap, type FileSet } from '../../remake/engine';
import { REQUIRED, parseLevels, type W6Assets } from './engine';

export const RETAIL_DIR = resolve(process.env.W6_DATA ?? 'data/wizardry6/amiga');
export const LEVEL_DIR = resolve('public/assets/wizardry6/amiga/dungeon');
export const haveRetail = (): boolean => Object.keys(REQUIRED).every(n => existsSync(resolve(RETAIL_DIR, n)));
export const haveLevels = (): boolean => Array.from({ length: 14 }, (_, l) => existsSync(resolve(LEVEL_DIR, `level${String(l).padStart(2, '0')}.json`))).every(Boolean);
export function retailFiles(dir = RETAIL_DIR): FileSet {
  return fileSetFromMap(new Map(Object.keys(REQUIRED).map(n => [n, new Uint8Array(readFileSync(resolve(dir, n)))])));
}
export function loadAssets(withMessages = true): W6Assets {
  const levels = parseLevels(Array.from({ length: 14 }, (_, l) => JSON.parse(readFileSync(resolve(LEVEL_DIR, `level${String(l).padStart(2, '0')}.json`), 'utf8'))));
  let msg: W6Assets['msg'];
  const mf = resolve('public/assets/wizardry6/amiga/data/messages-full.json');
  if (withMessages && existsSync(mf)) {
    const all = (JSON.parse(readFileSync(mf, 'utf8')) as { messages: Record<string, string> }).messages;
    msg = id => all[String(id)];
  }
  return { levels, msg };
}

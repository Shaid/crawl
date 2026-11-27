/**
 * THE registration point. To add a title: import its entry and add one line below.
 * (An entry is `{ id, title, dataDirs, engine, bind?, hints }`, see registry.ts; the title's own folder exports it, e.g. tools/blackcrypt/remake/shell-entry.ts.)
 */
import { Registry } from './registry';
import { bcEntry } from '../blackcrypt/remake/shell-entry';
import { mm2Entry } from '../mm2/remake/shell-entry';
import { w6Entry } from '../wizardry6/remake/shell-entry';

export const registry = new Registry([
  bcEntry,
  mm2Entry,
  w6Entry,
]);

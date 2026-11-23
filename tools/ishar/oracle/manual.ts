/**
 * Ishar 1's manual-protection questions in oracle walks.
 *
 * Entering CONT3 (MONSTRE.DO) and the CONT5 cave mouth (TELEP.DO) asks for a
 * word from the manual ("PAGE p LINE l WORD w"). Each script builds its
 * own 8-entry answer table with plain `cstore`s at start-up:
 * `arr_pos[i, 0..2] = page, line, word` and `arr_word[i, k] = letter`
 * (A = 1). MONSTRE's starts at `+0x446`, TELEP's has the same layout.
 * `isharManualTable` reads such a table off the script bytes.
 *
 * Which entry the game asks for is picked at random when the prompt opens,
 * and the oracle cannot read the asking entity's variables. So
 * `answerManualPrompt` tries the candidate words from a savestate taken at
 * the prompt, one run each. A word is right when a "turn right" click after
 * it turns the party (the prompt holds all input until it is answered).
 */
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { actionClick, gameDir, ORACLE_TITLES, runOracle, tempDir, type OracleGame, type WalkAction } from './alis-oracle.ts';

export interface ManualEntry {
  page: number;
  line: number;
  word: number;
  answer: string;
}

/**
 * The answer table a protection script builds: runs of
 * `cstore oimmb(v) -> s<arr>[odirw(idx), oimmb(k)]` (bytes `1e 00 v 38 14 idx
 * 40 00 k 3a 1a arr`), started by `cstore oimmb(i) -> sdirw(idx)`. The array
 * that receives exactly the indices 0..2 holds (page, line, word); the other
 * holds the letters.
 */
export function isharManualTable(script: Uint8Array): ManualEntry[] {
  type Raw = { arrays: Map<number, number[]> };
  const out: Raw[] = [];
  let cur: Raw | null = null;
  for (let a = 0; a + 12 <= script.length; a++) {
    const b = (k: number) => script[a + k]!;
    if (b(0) === 0x1e && b(1) === 0 && b(3) === 0x38 && b(4) === 0x14 && b(6) === 0x40 && b(7) === 0 && b(9) === 0x3a && b(10) === 0x1a) {
      if (!cur) continue;
      const arr = b(11);
      const v = cur.arrays.get(arr) ?? [];
      v[b(8)] = b(2);
      cur.arrays.set(arr, v);
      a += 11;
    } else if (b(0) === 0x1e && b(1) === 0 && b(3) === 0x14 && b(5) !== 0x40 && b(2) < 16) {
      cur = { arrays: new Map() };
      out.push(cur);
      a += 4;
    }
  }
  const entries: ManualEntry[] = [];
  for (const r of out) {
    const arrs = [...r.arrays.values()];
    const pos = arrs.find((v) => v.length === 3);
    const word = arrs.find((v) => v !== pos);
    if (!pos || !word) continue;
    entries.push({ page: pos[0]!, line: pos[1]!, word: pos[2]!, answer: word.map((c) => String.fromCharCode(64 + c)).join('') });
  }
  return entries;
}

/**
 * From the savestate `stateIn`, play `lead` (the walk actions that open the
 * prompt; the engine does not save while a prompt waits for input), then
 * answer by trying each word. Leaves the state after the right answer in
 * `stateOut` and returns the word, or null if none worked.
 */
export function answerManualPrompt(game: OracleGame, stateIn: string, stateOut: string, words: readonly string[], lead: readonly WalkAction[] = []): string | null {
  const t = ORACLE_TITLES[game];
  for (const w of words) {
    const own = join(tempDir(`${game}-manual-`), 'game');
    mkdirSync(own, { recursive: true });
    try {
      for (const f of readdirSync(gameDir(game))) {
        const d = join(own, f);
        if (f === 'alis.state') copyFileSync(stateIn, d);
        else linkSync(join(gameDir(game), f), d);
      }
      const ev: Array<[number, string]> = [];
      let f = 4;
      for (const a of lead) {
        const [x, y] = actionClick(t, a);
        ev.push([f, `click ${x} ${y}`], [f + 2, 'up']);
        f += 80;
      }
      f += 40;
      for (const ch of w.toLowerCase() + '\r') {
        ev.push([f, `key ${ch.charCodeAt(0)}`], [f + 10, 'keyup']);
        f += 20;
      }
      // turn right and back: both turns happen only once the prompt is gone
      f += 60;
      ev.push([f, `memdump ${t.facing.toString(16)} 1 before`]);
      ev.push([f + 2, `click ${t.turnRight[0]} ${t.turnRight[1]}`], [f + 4, 'up']);
      ev.push([f + 80, `memdump ${t.facing.toString(16)} 1 after`]);
      ev.push([f + 82, `click ${t.turnLeft[0]} ${t.turnLeft[1]}`], [f + 84, 'up']);
      ev.push([f + 164, 'save'], [f + 170, 'quit']);
      const dir = join(dirname(own), 'run');
      runOracle(game, ev, dir, { loadState: true, gameDir: own, timeoutMs: 150_000 });
      const before = join(dir, 'before.bin');
      const after = join(dir, 'after.bin');
      if (existsSync(before) && existsSync(after) && readFileSync(before)[0] !== readFileSync(after)[0]) {
        copyFileSync(join(own, 'alis.state'), stateOut);
        return w;
      }
    } finally {
      rmSync(dirname(own), { recursive: true, force: true });
    }
  }
  return null;
}

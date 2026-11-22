/**
 * Oracle sweep: crawl's Ishar scene (`tools/shared/ishar-scene.ts`) vs the
 * game (alis + harness), over a random sample of poses in the start region.
 *
 *   bash tools/ishar/oracle/build.sh               # once
 *   npx tsx tools/ishar/oracle/sweep.ts ishar  [--poses 60] [--seed 1] [--out DIR]
 *   npx tsx tools/ishar/oracle/sweep.ts ishar2 [--poses 30]
 *
 * Prints, per pose, the oracle / crawl / matched placement counts and the
 * pixel agreement of the view, then totals and a null control (crawl's pose
 * i against the game's pose i+1; a comparison that cannot tell poses apart
 * would score as high there). Placements match on (script, directory slot,
 * x, y, z, mirrored). Sprites of scripts crawl does not model (wandering
 * NPCs and monsters) are left out of the placement count; the "masked"
 * pixel rate also leaves out their bounding boxes.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bootToSavestate, capturePoses, ORACLE_TITLES, oracleAvailable, prepareGameDir, savestatePath, tempDir, type OracleGame, type OraclePose } from './alis-oracle.ts';
import { comparePose, crawlSequence, loadTitleData, oracleRunGrids, TITLE_SPECS } from './compare.ts';
import { existsSync } from 'node:fs';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random poses on non-blocked cells (layer 0 >= 0) of the start region. */
export function samplePoses(game: OracleGame, n: number, seed: number): OraclePose[] {
  const spec = TITLE_SPECS[game]!;
  const t = ORACLE_TITLES[game];
  const bytes = new Uint8Array(readFileSync(join(t.dataDir, `CONT${t.start.region}${game === 'ishar3' ? '-3' : ''}.FIC`)));
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.stride; c++) if (bytes[r * spec.stride + c]! < 128) cells.push([r, c]);
  const rand = rng(seed);
  const out: OraclePose[] = [{ row: t.start.row, col: t.start.col, facing: t.start.facing }];
  while (out.length < n) {
    const [row, col] = cells[Math.floor(rand() * cells.length)]!;
    out.push({ row, col, facing: Math.floor(rand() * 4) as 0 | 1 | 2 | 3 });
  }
  return out;
}

function main(): void {
  const game = (process.argv[2] ?? 'ishar') as OracleGame;
  if (!TITLE_SPECS[game]) throw new Error(`${game}: no scene spec yet`);
  if (!oracleAvailable()) throw new Error('oracle not built: bash tools/ishar/oracle/build.sh');
  const poses = samplePoses(game, Number(arg('poses', '40')), Number(arg('seed', '1')));
  const out = resolve(arg('out', '') || tempDir(`${game}-sweep-`));
  prepareGameDir(game);
  if (!existsSync(savestatePath(game))) bootToSavestate(game, join(out, 'boot'));
  const frames = capturePoses(game, poses, out);
  const data = loadTitleData(game);
  const taken = frames.map((f) => f.taken !== false);
  const seq = crawlSequence(data, ORACLE_TITLES[game].start, poses, oracleRunGrids(game, data, out), taken);
  const skipped = taken.filter((t) => !t).length;
  if (skipped) console.log(`${skipped} pose(s) not taken by the game (an encounter held the input); left out of the totals`);
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) : '-');
  for (const shift of [0, 1]) {
    const tot = { o: 0, c: 0, m: 0, p: 0, pe: 0, pm: 0, pme: 0 };
    seq.forEach((c, i) => {
      if (!taken[i] || !taken[(i + shift) % frames.length]) return;
      const r = comparePose(game, frames[(i + shift) % frames.length]!, data, c.scripts, c.canvas, c.leaves);
      if (shift === 0) {
        console.log(`${i} r${poses[i]!.row} c${poses[i]!.col} f${poses[i]!.facing}  oracle=${r.oracle} crawl=${r.crawl} matched=${r.matched} px=${pct(r.pixelsEqual, r.pixels)}% masked=${pct(r.pixelsMaskedEqual, r.pixelsMasked)}%`);
        if (r.missing.length) console.log(`   missing ${r.missing.slice(0, 6).join(' ')}`);
        if (r.extra.length) console.log(`   extra   ${r.extra.slice(0, 6).join(' ')}`);
      }
      tot.o += r.oracle; tot.c += r.crawl; tot.m += r.matched;
      tot.p += r.pixels; tot.pe += r.pixelsEqual; tot.pm += r.pixelsMasked; tot.pme += r.pixelsMaskedEqual;
    });
    console.log(
      `${shift ? 'NULL (pose i vs game pose i+1)' : 'TOTAL'}: placements ${tot.m}/${Math.max(tot.o, tot.c)} = ${pct(tot.m, Math.max(tot.o, tot.c))}%  ` +
        `pixels ${pct(tot.pe, tot.p)}%  masked ${pct(tot.pme, tot.pm)}%`,
    );
  }
  console.log(`frames in ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

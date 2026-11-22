/**
 * Walker-vs-game parity on a fixed sample, using the game's own code as the
 * oracle (`tools/wizardry6/oracle/`: Bane's view renderer and TryMove run
 * under a Unicorn 68000 core). The full 37,888-pose sweep is
 * `tools/wizardry6/oracle/sweep.py`; this is its regression subset.
 *
 * Skips (does not fail) when the retail data, the exported assets, or a
 * Python with `unicorn` + `numpy` is missing — see oracle/README.md.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadIndexedBank, loadSlots, renderThroughDungeon } from '../render-through-dungeon.ts';
import { arrive, tryMove, W6TriggerState } from '../movement.ts';
import type { CellPlanes } from '../evaluate-cell.ts';

const ORACLE = resolve('tools/wizardry6/oracle/oracle.py');
const DATA = process.env.W6_DATA ?? resolve('data/wizardry6/amiga');
const ASSETS = resolve('public/assets/wizardry6/amiga');
const LEVELS = 14;

function findPython(): string | null {
  const candidates = [process.env.W6_ORACLE_PYTHON, resolve('tools/wizardry6/oracle/.venv/bin/python'), 'python3'];
  for (const py of candidates) {
    if (!py) continue;
    const r = spawnSync(py, ['-c', 'import unicorn, numpy'], { stdio: 'ignore' });
    if (r.status === 0) return py;
  }
  return null;
}

const haveData =
  ['Bane', 'mazedata.ega', 'newgame.dbs', 'scenario.dbs', 'scenario.hdr', 'master.hdr', 'disk.hdr'].every((f) =>
    existsSync(join(DATA, f)),
  ) &&
  existsSync(join(ASSETS, 'dungeon/slots.json')) &&
  existsSync(join(ASSETS, 'maps/mazedata-indexed.png')) &&
  existsSync(join(ASSETS, 'dungeon/level13.json'));
const python = haveData ? findPython() : null;

interface LevelFile {
  cellSpace: { width: number; height: number };
  origin?: { x: number; y: number };
  units: Array<{ planes: Record<string, number[]> }>;
  w6: { links: Parameters<typeof arrive>[1] };
}
const levelCache = new Map<number, { planes: CellPlanes; origin: { x: number; y: number }; links: LevelFile['w6']['links'] }>();
function level(id: number) {
  let l = levelCache.get(id);
  if (!l) {
    const d = JSON.parse(readFileSync(join(ASSETS, `dungeon/level${String(id).padStart(2, '0')}.json`), 'utf8')) as LevelFile;
    const u = d.units[0]!.planes;
    l = {
      planes: {
        width: d.cellSpace.width,
        height: d.cellSpace.height,
        wallA: u.wallA!,
        wallB: u.wallB!,
        feature: u.feature!,
        orient: u.orient!,
        flagP: u.flagP!,
        flagQ: u.flagQ!,
        region: u.region!,
        level: id,
      },
      origin: d.origin ?? { x: 0, y: 0 },
      links: d.w6.links,
    };
    levelCache.set(id, l);
  }
  return l;
}

/** Deterministic LCG so the sample is fixed across runs. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Every in-region cell of a level, in scan order. */
function cells(id: number): Array<{ x: number; y: number }> {
  const { planes } = level(id);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < planes.height; y++)
    for (let x = 0; x < planes.width; x++) if ((planes.region![y * planes.width + x] ?? -1) >= 0) out.push({ x, y });
  return out;
}

function runOracle(cmd: string, input: unknown): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'w6-oracle-'));
  try {
    const inPath = join(dir, 'in.json');
    const outPath = join(dir, 'out');
    writeFileSync(inPath, JSON.stringify(input));
    execFileSync(python!, [ORACLE, cmd, inPath, outPath], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, W6_DATA: DATA } });
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!python)('Wizardry 6 walker vs the game (Unicorn oracle)', () => {
  it('renders the same viewport as the game on 24 poses per level', () => {
    const rand = rng(0x5717);
    const poses: Array<{ level: number; x: number; y: number; f: number }> = [];
    for (let L = 0; L < LEVELS; L++) {
      const c = cells(L);
      for (let i = 0; i < 24; i++) {
        const p = c[Math.floor(rand() * c.length)]!;
        poses.push({ level: L, x: p.x, y: p.y, f: Math.floor(rand() * 4) });
      }
    }
    const game = runOracle('frames', poses);
    expect(game.length).toBe(poses.length * 176 * 112);
    const slots = loadSlots();
    const bank = loadIndexedBank();
    const mismatched: string[] = [];
    poses.forEach((p, i) => {
      const l = level(p.level);
      const s = renderThroughDungeon(l.planes, p.x, p.y, p.f, slots, bank, l.origin);
      let n = 0;
      for (let r = 0; r < 112; r++)
        for (let c = 0; c < 176; c++) if (s.data[(32 + r) * 320 + 72 + c] !== game[i * 19712 + r * 176 + c]) n++;
      if (n) mismatched.push(`L${p.level} (${p.x},${p.y}) f${p.f}: ${n} px`);
    });
    expect(mismatched).toEqual([]);
  }, 600_000);

  it('makes the same move decision as TryMove on 60 attempts per level, door states 0 and 3', () => {
    const rand = rng(0x7e4);
    const atts: Array<{ level: number; x: number; y: number; f: number; rel: number; door: number }> = [];
    for (let L = 0; L < LEVELS; L++) {
      const c = cells(L);
      for (let i = 0; i < 60; i++) {
        const p = c[Math.floor(rand() * c.length)]!;
        atts.push({ level: L, x: p.x, y: p.y, f: Math.floor(rand() * 4), rel: Math.floor(rand() * 4), door: i % 4 === 3 ? 3 : 0 });
      }
    }
    const game = JSON.parse(runOracle('moves', atts).toString('utf8')) as Array<{ kind: string; value: string | number }>;
    const diffs: string[] = [];
    atts.forEach((a, i) => {
      const l = level(a.level);
      const dir = (a.f + a.rel) & 3;
      const r = tryMove(l.planes, l.links, a.x, a.y, dir, a.f, [a.door, a.door, a.door, a.door], false);
      const walker = r.kind === 'moved' ? { kind: 'moved', value: `${r.x},${r.y}` } : { kind: r.kind === 'blocked' ? 'none' : r.kind, value: r.message };
      const g = game[i]!;
      if (g.kind !== walker.kind || String(g.value) !== String(walker.value))
        diffs.push(`L${a.level} (${a.x},${a.y}) f${a.f} rel${a.rel} door${a.door}: game ${g.kind}/${g.value} walker ${walker.kind}/${walker.value}`);
    });
    expect(diffs).toEqual([]);
  }, 600_000);

  it('resolves arrival (teleports, door states, kind-5 halt) like LAB_06B6 on every entity cell', () => {
    const cellsIn: Array<{ level: number; x: number; y: number }> = [];
    const walker: string[] = [];
    for (let L = 0; L < LEVELS; L++) {
      const l = level(L);
      const e = l.links.entities;
      const seen = new Set<string>();
      for (let k = 0; k < 144; k++) {
        if (!e.kind[k]) continue;
        const o = l.links.regionOrigin[e.region[k]!];
        if (!o) continue;
        const x = o.x + e.localX[k]!;
        const y = o.y + e.localY[k]!;
        if (seen.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        const t = new W6TriggerState();
        t.enterLevel(L, l.links.initialFlags);
        const r = arrive(l.planes, l.links, t, x, y);
        cellsIn.push({ level: L, x, y });
        walker.push(`${r.pose.level} ${r.pose.x},${r.pose.y} ${r.doorState.join('')}`);
      }
    }
    const game = JSON.parse(runOracle('arrive', cellsIn).toString('utf8')) as Array<{ level: number; x: number; y: number; doorState: number[] }>;
    const diffs = cellsIn
      .map((c, i) => [c, `${game[i]!.level} ${game[i]!.x},${game[i]!.y} ${game[i]!.doorState.join('')}`, walker[i]] as const)
      .filter(([, g, w]) => g !== w)
      .map(([c, g, w]) => `L${c.level} (${c.x},${c.y}): game ${g} walker ${w}`);
    expect(cellsIn.length).toBeGreaterThan(200);
    expect(diffs).toEqual([]);
  }, 600_000);
});

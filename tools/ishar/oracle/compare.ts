/**
 * Walker-vs-game comparison for the Ishar oracle: builds crawl's own scene
 * (`tools/shared/ishar-scene.ts`) from the retail files and diffs it, pose
 * by pose, against the oracle's live display list and frame.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';
import { findIsharDirectory } from '../../shared/ishar-sprites.ts';
import {
  compositeIsharView,
  IsharGridBuffers,
  IsharScene,
  isharEntityMemory,
  ISHAR1_TITLE,
  ISHAR2_TITLE,
  ISHAR3_TITLE,
  type GridReader,
  type IsharPartyState,
  type IsharSceneLeaf,
  type IsharTitleSpec,
  type IsharOccupancy,
  ishar1MonsterTableFromDumps,
  ishar1Occupancy,
  ishar2Occupancy,
  isharContOf,
} from '../../shared/ishar-scene.ts';
import type { OracleFrame, OracleGame, OraclePose, OracleScreen } from './alis-oracle.ts';
import { ORACLE_TITLES } from './alis-oracle.ts';

export const TITLE_SPECS: Partial<Record<OracleGame, IsharTitleSpec>> = { ishar: ISHAR1_TITLE, ishar2: ISHAR2_TITLE, ishar3: ISHAR3_TITLE };

export interface TitleData {
  spec: IsharTitleSpec;
  load(name: string): Uint8Array | undefined;
  grids(region: number, row: number): { A: GridReader; B: GridReader };
  /** New-game memory of the entity scripts (`isharEntityMemory`, from `EN1.FIC`). */
  entityMemory: Record<number, Uint8Array>;
}

const s8 = (v: number) => (v >= 128 ? v - 256 : v);

/** Retail-file loader for one title (reads `data/<game>/amigaaga`). */
export function loadTitleData(game: OracleGame, repoRoot = resolve('.')): TitleData {
  const spec = TITLE_SPECS[game];
  if (!spec) throw new Error(`${game}: no scene spec yet`);
  const dir = join(repoRoot, ORACLE_TITLES[game].dataDir);
  const cache = new Map<string, Uint8Array | undefined>();
  const load = (name: string) => {
    const key = name.toUpperCase();
    if (!cache.has(key)) {
      const p = join(dir, `${key}.DO`);
      cache.set(key, existsSync(p) ? unpackIsharScript(new Uint8Array(readFileSync(p))) : undefined);
    }
    return cache.get(key);
  };
  const cont = new Map<number, Uint8Array | null>();
  const contFile = (n: number) => {
    if (!cont.has(n)) {
      const p = join(dir, game === 'ishar3' ? `CONT${n}-3.FIC` : `CONT${n}.FIC`);
      cont.set(n, existsSync(p) ? new Uint8Array(readFileSync(p)) : null);
    }
    return cont.get(n)!;
  };
  const layers = (n: number) => {
    const f = contFile(n);
    if (!f) return undefined;
    const cells = spec.stride * spec.rows;
    return spec.gridBuffers === 'layers' ? [f.subarray(0, cells), f.subarray(cells, 2 * cells)] : [f];
  };
  const en1 = join(dir, 'EN1.FIC');
  return {
    spec,
    load,
    entityMemory: existsSync(en1) ? isharEntityMemory(spec, new Uint8Array(readFileSync(en1))) : {},
    grids(region, row) {
      return new IsharGridBuffers(spec, layers).update({ region, row, col: 0, facing: 0 });
    },
  };
}

/** Find the oracle's view screen (by geometry). */
export function viewScreen(frame: OracleFrame, game: OracleGame): OracleScreen | undefined {
  const v = ORACLE_TITLES[game].viewScreen;
  return frame.screens.find((s) => s.x === v.x && s.y === v.y && s.w === v.w && s.h === v.h);
}

export interface PlacementKey {
  script: string;
  index: number;
  x: number;
  y: number;
  z: number;
  inv: boolean;
}
const keyStr = (k: PlacementKey) => `${k.script}#${k.index}@${k.x},${k.y},${k.z}${k.inv ? 'i' : ''}`;

export function oracleKeys(screen: OracleScreen, spec: IsharTitleSpec, data: TitleData, modelled: Set<string>): { keys: PlacementKey[]; excluded: OracleScreen['sprites'] } {
  const keys: PlacementKey[] = [];
  const excluded: OracleScreen['sprites'] = [];
  for (const sp of screen.sprites) {
    if (!modelled.has(sp.entity)) {
      excluded.push(sp);
      continue;
    }
    const bytes = data.load(sp.resource);
    const dir = bytes ? findIsharDirectory(bytes) : null;
    const index = dir ? (sp.off - dir.dirOff - dir.baseDelta) / 4 : -1;
    keys.push({ script: sp.resource, index, x: sp.x, y: sp.y, z: sp.z, inv: sp.invertX });
  }
  void spec;
  return { keys, excluded };
}

export function crawlKeys(leaves: IsharSceneLeaf[]): PlacementKey[] {
  return leaves.map((l) => ({ script: l.script.toLowerCase(), index: l.index, x: l.x, y: l.y, z: l.z, inv: l.invertX }));
}

export interface PoseComparison {
  oracle: number;
  crawl: number;
  matched: number;
  excluded: number;
  pixels: number;
  pixelsEqual: number;
  /** Pixels outside every excluded (unmodelled) oracle sprite's box. */
  pixelsMasked: number;
  pixelsMaskedEqual: number;
  missing: string[];
  extra: string[];
  /** `matched` plus the missing/extra pairs that differ only in x, by at most 12 px (the `ornd` jitter of Ishar 2/3's NPCs). */
  matchedNearX: number;
}

export function multisetMatch(a: PlacementKey[], b: PlacementKey[]): { matched: number; missing: string[]; extra: string[] } {
  const count = new Map<string, number>();
  for (const k of a) count.set(keyStr(k), (count.get(keyStr(k)) ?? 0) + 1);
  let matched = 0;
  const extra: string[] = [];
  for (const k of b) {
    const s = keyStr(k);
    const n = count.get(s) ?? 0;
    if (n > 0) {
      matched++;
      count.set(s, n - 1);
    } else extra.push(s);
  }
  const missing: string[] = [];
  for (const [s, n] of count) for (let i = 0; i < n; i++) missing.push(s);
  return { matched, missing, extra };
}

/** Compare one crawl view (leaves + canvas) against one oracle frame. */
export function comparePose(
  game: OracleGame,
  frame: OracleFrame,
  data: TitleData,
  scripts: readonly string[],
  canvas: Uint8Array,
  leaves: IsharSceneLeaf[],
  /** Count the NPC/monster entities crawl models (default); false leaves them out like any unmodelled entity. */
  npcs = true,
): PoseComparison {
  const spec = data.spec;
  const screen = viewScreen(frame, game);
  // Scenery the title can draw counts even when crawl did not run it here,
  // and so do the NPCs and monsters when the title models them
  // (`spec.entities`); only entities crawl cannot draw are left out.
  const ents = spec.entities?.scripts ?? [];
  const modelled = new Set([...scripts.filter((n) => npcs || !ents.includes(n)), ...spec.sceneScripts, ...(npcs ? ents : [])].map((n) => n.toLowerCase()));
  const { keys, excluded } = screen ? oracleKeys(screen, spec, data, modelled) : { keys: [], excluded: [] };
  const mine = crawlKeys(leaves);
  const m = multisetMatch(keys, mine);
  const sx = screen?.x ?? 0;
  const sy = screen?.y ?? 0;
  const W = spec.screen.width;
  const H = spec.screen.height;
  const mask = new Uint8Array(W * H);
  for (const e of excluded) {
    const ex = e.newX - sx;
    const ey = e.newY - sy;
    for (let y = Math.max(0, ey); y <= Math.min(H - 1, ey + e.h); y++)
      for (let x = Math.max(0, ex); x <= Math.min(W - 1, ex + e.w); x++) mask[y * W + x] = 1;
  }
  let pixels = 0, eq = 0, pm = 0, pme = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = sx + x, fy = sy + y;
      if (fx >= frame.width || fy >= frame.height) continue;
      const o = (fy * frame.width + fx) * 3;
      const c = (y * W + x) * 4;
      const same = frame.rgb[o] === canvas[c] && frame.rgb[o + 1] === canvas[c + 1] && frame.rgb[o + 2] === canvas[c + 2];
      pixels++;
      if (same) eq++;
      if (!mask[y * W + x]) {
        pm++;
        if (same) pme++;
      }
    }
  }
  return {
    oracle: keys.length,
    crawl: mine.length,
    matched: m.matched,
    excluded: excluded.length,
    pixels,
    pixelsEqual: eq,
    pixelsMasked: pm,
    pixelsMaskedEqual: pme,
    missing: m.missing,
    extra: m.extra,
    matchedNearX: m.matched + nearXPairs(m.missing, m.extra, 12),
  };
}

/** How many `missing` keys have an `extra` twin that differs only in x, by at most `tol`. */
function nearXPairs(missing: readonly string[], extra: readonly string[], tol: number): number {
  const split = (k: string) => {
    const m = k.match(/^(.*)@(-?\d+),(.*)$/)!;
    return { head: m[1]!, x: Number(m[2]), tail: m[3]! };
  };
  const pool = extra.map(split);
  let n = 0;
  for (const k of missing) {
    const a = split(k);
    const j = pool.findIndex((b) => b.head === a.head && b.tail === a.tail && Math.abs(b.x - a.x) <= tol);
    if (j >= 0) {
      pool.splice(j, 1);
      n++;
    }
  }
  return n;
}

/**
 * Run crawl's scene through the same sequence the oracle saw: created at the
 * savestate's start pose, then one wake-up per pose.
 */
export function crawlSequence(
  data: TitleData,
  start: IsharPartyState,
  poses: readonly OraclePose[],
  gridsFor: (region: number, row: number) => { A: GridReader; B: GridReader } = data.grids,
  /** Per pose: did the game take it (a swallowed input wakes nothing)? Default all. */
  taken: readonly boolean[] = [],
  /** Run the NPC/monster entities, with this memory (default: the new-game `entityMemory`); false = scenery only. */
  npcs: boolean | Record<number, Uint8Array> = true,
): Array<{ scene: IsharScene; scripts: string[]; leaves: IsharSceneLeaf[]; canvas: Uint8Array }> {
  const spec = data.spec;
  const scene = new IsharScene(spec, data.load, gridsFor(start.region, start.row));
  scene.memory = typeof npcs === 'object' ? { ...data.entityMemory, ...npcs } : data.entityMemory;
  scene.npcs = npcs !== false;
  scene.enter(start);
  const out: Array<{ scene: IsharScene; scripts: string[]; leaves: IsharSceneLeaf[]; canvas: Uint8Array }> = [];
  for (const [i, p] of poses.entries()) {
    const st: IsharPartyState = { region: start.region, row: p.row, col: p.col, facing: p.facing };
    if (taken[i] !== false) {
      scene.setGrids(gridsFor(st.region, p.row));
      scene.step(st);
    }
    const leaves = scene.leaves();
    // scripts alive at this pose (the zone add-ons come and go)
    out.push({ scene, scripts: scene.scriptNames, leaves, canvas: compositeIsharView(leaves, spec.screen, scene.palette) });
  }
  return out;
}

/**
 * Grids exactly as a poked-pose oracle run holds them: the current region
 * from the retail file, the other buffer as dumped at boot (`gridB.bin`).
 */
export function oracleRunGrids(game: OracleGame, data: TitleData, runDir: string): (region: number, row: number) => { A: GridReader; B: GridReader } {
  const p = join(runDir, 'gridB.bin');
  if (game !== 'ishar' || !existsSync(p)) return data.grids;
  const b = new Uint8Array(readFileSync(p));
  const stride = data.spec.stride;
  const other: GridReader = (row, col) => s8(b[row * stride + col] ?? 0);
  return (region, row) => {
    const g = data.grids(region, row);
    return region % 2 === 1 ? { A: g.A, B: other } : { A: other, B: g.B };
  };
}

/** The entity memory a pose run dumped at its start (`bootMemdumps` flagged `memory`), for `crawlSequence`. */
export function oracleRunMemory(game: OracleGame, runDir: string): Record<number, Uint8Array> {
  const out: Record<number, Uint8Array> = {};
  for (const m of ORACLE_TITLES[game].bootMemdumps ?? []) {
    const p = join(runDir, `${m.name}.bin`);
    if (m.memory && existsSync(p)) out[m.off] = new Uint8Array(readFileSync(p));
  }
  return out;
}

/** One real-walk step, crawl side: what crawl's walker rules predicted and what the scene drew at the game's state. */
export interface WalkComparison {
  predicted: IsharPartyState | null;
  actual: IsharPartyState;
  /** crawl's walker rules reach the same state as the game (a refused move = unchanged). */
  moveAgrees: boolean;
  scripts: string[];
  leaves: IsharSceneLeaf[];
  canvas: Uint8Array;
}

/**
 * Replay a real walk (`captureWalk`) through crawl: predict each action with
 * the walker's rules (turn = facing +-1, step = `spec.stepFrom` plus the
 * cell < 0 block rule), then wake the scene at the game's actual state (so
 * a movement disagreement does not cascade into every later frame). An
 * action the game refused (state unchanged) wakes nothing.
 */
export function crawlWalk(
  data: TitleData,
  start: IsharPartyState,
  steps: ReadonlyArray<{ action: 'F' | 'L' | 'R'; region: number; row: number; col: number; facingRaw: number; globals?: Record<number, number>; mem?: Record<string, Uint8Array> }>,
  layers: (region: number) => readonly Uint8Array[] | undefined,
  initial: { A?: GridReader; B?: GridReader } = {},
  /** Extra scene wakes at the start pose: a walk that starts from a mid-game savestate meets scripts with a per-wake phase (FOND's alternation) already advanced. */
  startWakes = 0,
  /** The sub-zone global at the start pose (a mid-game savestate). Default: the first step's `zone` dump when that step is a turn (a turn keeps the zone), else 0. */
  startZone?: number,
  /** Run the NPC/monster entities (default); false for a walk that removed them (`noNpcs`). */
  npcs = true,
): WalkComparison[] {
  const spec = data.spec;
  const buffers = new IsharGridBuffers(spec, layers, initial);
  const scene = new IsharScene(spec, data.load, buffers.update(start));
  scene.memory = data.entityMemory;
  scene.npcs = npcs;
  const z0 = startZone ?? (steps[0] && steps[0].action !== 'F' ? steps[0].mem?.zone?.[0] : undefined);
  if (z0 !== undefined) scene.zone = z0;
  scene.enter(start);
  for (let i = 0; i < startWakes; i++) scene.step(start);
  let cur = start;
  const out: WalkComparison[] = [];
  // the monster table the step test saw: the dump after the previous action
  // (the first step uses its own dump; monsters may have moved by one cell)
  let occupied = stepOccupancy(game(data), steps[0]?.mem);
  for (const s of steps) {
    const facing = spec.facingRaw.indexOf(s.facingRaw);
    const memGlobals = stepGlobals(game(data), s.mem);
    const globals = memGlobals ? { ...s.globals, ...memGlobals } : s.globals;
    const actual: IsharPartyState = { region: s.region, row: s.row, col: s.col, facing: (facing < 0 ? 0 : facing) as 0 | 1 | 2 | 3, globals, tables: stepTables(game(data), s.mem), memory: stepMemory(game(data), s.mem) };
    let predicted: IsharPartyState | null;
    if (s.action !== 'F') predicted = { ...cur, facing: ((cur.facing + (s.action === 'R' ? 1 : 3)) & 3) as 0 | 1 | 2 | 3 };
    else {
      const t = spec.stepFrom(cur, cur.facing);
      predicted = (t && enterCell(spec, layers, cur, t, occupied)) ?? cur;
    }
    occupied = stepOccupancy(game(data), s.mem) ?? occupied;
    const same = (a: IsharPartyState | null, b: IsharPartyState) => !!a && a.region === b.region && a.row === b.row && a.col === b.col && a.facing === b.facing;
    const phaseChanged = JSON.stringify(cur.globals ?? {}) !== JSON.stringify(actual.globals ?? {});
    const moved = !same(cur, actual);
    if (moved) {
      scene.setGrids(buffers.update(actual));
      scene.step(actual);
    } else if (phaseChanged) scene.refresh(actual);
    const leaves = scene.leaves();
    out.push({ predicted, actual, moveAgrees: same(predicted, actual), scripts: scene.scriptNames, leaves, canvas: compositeIsharView(leaves, spec.screen, scene.palette) });
    cur = actual;
  }
  return out;
}

const game = (data: TitleData): OracleGame => data.spec.game as OracleGame;

/** The scene tables a walk step dumped (`stepMemdumps` entries flagged `table`). */
export function stepTables(game: OracleGame, mem: Readonly<Record<string, Uint8Array>> | undefined): Record<number, number[]> | undefined {
  if (!mem) return undefined;
  let out: Record<number, number[]> | undefined;
  for (const m of ORACLE_TITLES[game].stepMemdumps ?? []) {
    const b = mem[m.name];
    if (!m.table || !b) continue;
    (out ??= {})[m.off] = [...b].map(s8);
  }
  return out;
}

/** Main memory a walk step dumped for the entity scripts (`stepMemdumps` entries flagged `memory`). */
export function stepMemory(game: OracleGame, mem: Readonly<Record<string, Uint8Array>> | undefined): Record<number, Uint8Array> | undefined {
  if (!mem) return undefined;
  let out: Record<number, Uint8Array> | undefined;
  for (const m of ORACLE_TITLES[game].stepMemdumps ?? []) {
    const b = mem[m.name];
    if (m.memory && b) (out ??= {})[m.off] = b;
  }
  return out;
}

/** Main globals a walk step dumped (`stepMemdumps` entries flagged `globals`). */
export function stepGlobals(game: OracleGame, mem: Readonly<Record<string, Uint8Array>> | undefined): Record<number, number> | undefined {
  if (!mem) return undefined;
  let out: Record<number, number> | undefined;
  for (const m of ORACLE_TITLES[game].stepMemdumps ?? []) {
    const b = mem[m.name];
    if (!m.globals || !b) continue;
    out ??= {};
    if (m.globals === 'byte') for (let i = 0; i < b.length; i++) out[m.off + i] = s8(b[i]!);
    else for (let i = 0; i + 1 < b.length; i += 2) out[m.off + i] = (((b[i]! << 8) | b[i + 1]!) << 16) >> 16;
  }
  return out;
}

/** GERDEP's monster occupancy from a walk step's `stepMemdumps` (Ishar 1 and 2). */
export function stepOccupancy(game: OracleGame, mem: Readonly<Record<string, Uint8Array>> | undefined): IsharOccupancy | undefined {
  if (!mem) return undefined;
  if (game === 'ishar2') {
    // EN1 arrays as dumped (`ent<addr>`), and the party's zone
    const zone = mem.zone?.[0];
    return zone === undefined ? undefined : ishar2Occupancy((addr) => mem[`ent${addr.toString(16)}`], s8(zone));
  }
  if (game !== 'ishar') return undefined;
  const t = ishar1MonsterTableFromDumps(mem);
  return t ? ishar1Occupancy(t) : undefined;
}

/** CONT layers for a title, storage order (layer 0 first). */
/** The title's step test (`spec.enter`; default: refused on a negative layer-0 cell). */
export function enterCell(spec: IsharTitleSpec, layers: (region: number) => readonly Uint8Array[] | undefined, from: IsharPartyState, to: IsharPartyState, occupied?: IsharOccupancy): IsharPartyState | null {
  const cell = (region: number, row: number, col: number) => s8(layers(isharContOf(spec, region))?.[0]?.[row * spec.stride + col] ?? 0);
  const cellB = (region: number, row: number, col: number) => s8(layers(isharContOf(spec, region))?.[1]?.[row * spec.stride + col] ?? 0);
  if (spec.enter) return spec.enter(from, to, cell, occupied, cellB);
  return cell(to.region, to.row, to.col) < 0 ? null : to;
}

export function contLayers(game: OracleGame, data: TitleData, repoRoot = resolve('.')): (region: number) => readonly Uint8Array[] | undefined {
  const dir = join(repoRoot, ORACLE_TITLES[game].dataDir);
  const cells = data.spec.stride * data.spec.rows;
  const cache = new Map<number, Uint8Array[] | undefined>();
  return (n) => {
    if (!cache.has(n)) {
      const p = join(dir, game === 'ishar3' ? `CONT${n}-3.FIC` : `CONT${n}.FIC`);
      const f = existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
      cache.set(n, f ? (data.spec.gridBuffers === 'layers' ? [f.subarray(0, cells), f.subarray(cells, 2 * cells)] : [f]) : undefined);
    }
    return cache.get(n);
  };
}

/** The oracle run's boot-time grid buffer B (`gridB.bin`), if dumped. */
export function bootGridB(data: TitleData, runDir: string): GridReader | undefined {
  const p = join(runDir, 'gridB.bin');
  if (!existsSync(p)) return undefined;
  const b = new Uint8Array(readFileSync(p));
  return (row, col) => s8(b[row * data.spec.stride + col] ?? 0);
}

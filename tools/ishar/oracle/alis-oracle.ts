/**
 * Driver for the Ishar game oracle: the `maestun/alis` engine
 * reimplementation (MIT), built with crawl's small harness patch
 * (`harness.patch`), run headless and frame-locked. See README.md.
 *
 * - `ensureOracle()` / `oracleAvailable()` locate the built binary
 *   (`build/cache/ishar-oracle/alis/build/alis`, from `build.sh`).
 * - `prepareGameDir(game)` copies the retail files into
 *   `build/cache/ishar-oracle/data/<game>/` (the game writes back into its
 *   own directory, so it never runs on `data/`).
 * - `bootToSavestate(game)` plays the title's scripted boot and saves an
 *   alis state at the first in-game frame; later runs start from it.
 * - `capturePoses(game, poses)` sets each pose by poking the party globals
 *   (facing one step anti-clockwise) and clicking "turn right", so the game
 *   itself redraws; it returns the dumped frame and live display list.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type OracleGame = 'ishar' | 'ishar2' | 'ishar3';

export const ORACLE_ROOT = resolve(process.env.ISHAR_ORACLE_DIR ?? 'build/cache/ishar-oracle');
export const ORACLE_BIN = join(ORACLE_ROOT, 'alis/build/alis');

export interface OracleTitle {
  /** Retail directory under `data/`. */
  dataDir: string;
  /** Party globals (basemain offsets). */
  row: number;
  col: number;
  facing: number;
  /** Region-code global, if any. */
  region?: number;
  /** Raw facing values in "turn right" order. */
  facingCycle: readonly number[];
  /** Walker facing N/E/S/W (0..3) -> raw value. */
  facingRaw: readonly [number, number, number, number];
  /** Screen pixel of the "turn right" arrow. */
  turnRight: readonly [number, number];
  /** Screen pixels of the "turn left" and "forward" arrows. */
  turnLeft: readonly [number, number];
  forward: readonly [number, number];
  /** View screen geometry as the oracle's `S` line prints it. */
  viewScreen: { x: number; y: number; w: number; h: number };
  /** Scripted boot: `[frame, command]` pairs, the last one saves the state. */
  boot: ReadonlyArray<readonly [number, string]>;
  /** Memory captured at the start of every pose run (`<name>.bin` in the run directory). */
  bootMemdumps?: ReadonlyArray<{ name: string; off: number; len: number }>;
  /** Party state in the boot savestate (scene created, no wake-up yet). */
  start: { region: number; row: number; col: number; facing: 0 | 1 | 2 | 3 };
}

function keyEvents(start: number, key: number, n: number, gap: number): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let i = 0; i < n; i++) {
    out.push([start + i * gap, `key ${key}`], [start + i * gap + 20, 'keyup']);
  }
  return out;
}
function clickEvents(start: number, x: number, y: number, n: number, gap: number): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let i = 0; i < n; i++) out.push([start + i * gap, `click ${x} ${y}`], [start + i * gap + 5, 'up']);
  return out;
}

export const ORACLE_TITLES: Record<OracleGame, OracleTitle> = {
  ishar: {
    dataDir: 'data/ishar/amigaaga',
    row: 0x137c,
    col: 0x137d,
    facing: 0x137e,
    region: 0x1508,
    facingCycle: [1, 2, 3, 4],
    facingRaw: [1, 2, 3, 4],
    turnRight: [309, 103],
    turnLeft: [267, 103],
    forward: [290, 78],
    viewScreen: { x: 0, y: 0, w: 255, h: 125 },
    // logo -> title -> language menu ('1' = English) -> in game at frame ~1000,
    // CONT1 row 11 col 29, raw facing 2; saved before any step or turn.
    boot: [...clickEvents(100, 160, 100, 2, 210), ...keyEvents(910, 49, 1, 150), [1040, 'save']],
    start: { region: 1, row: 11, col: 29, facing: 1 },
    // Poking the position never makes MAIN preload a neighbour region, so
    // buffer B keeps whatever it held at boot; the comparison reads it back.
    bootMemdumps: [{ name: 'gridB', off: 0x234a, len: 4860 }],
  },
  ishar2: {
    dataDir: 'data/ishar2/amigaaga',
    row: 0x2ab4,
    col: 0x2ab5,
    facing: 0x2ab6,
    region: 0x2d18,
    facingCycle: [1, 2, 3, 4],
    facingRaw: [1, 2, 3, 4],
    turnRight: [310, 30],
    turnLeft: [263, 30],
    forward: [288, 30],
    viewScreen: { x: 0, y: 13, w: 255, h: 112 },
    // 5x '1' through the intro text, then click + space through the title
    // and team screens, '1' starts the game at frame ~1654: CONT1 row 27
    // col 45, raw facing 2; saved before any step or turn.
    boot: [
      ...keyEvents(100, 49, 5, 100),
      ...clickEvents(900, 160, 100, 3, 250),
      ...keyEvents(960, 32, 3, 250),
      ...keyEvents(1650, 49, 1, 100),
      [1690, 'save'],
    ],
    start: { region: 1, row: 27, col: 45, facing: 1 },
  },
  ishar3: {
    dataDir: 'data/ishar3/amigaaga',
    row: 0x257,
    col: 0x14b6,
    facing: 0x14b7,
    region: undefined,
    facingCycle: [1, 2, -1, -2],
    facingRaw: [1, 2, -1, -2],
    turnRight: [310, 30],
    turnLeft: [263, 30],
    forward: [288, 30],
    viewScreen: { x: 0, y: 0, w: 0, h: 0 },
    boot: [],
    start: { region: 1, row: 0, col: 0, facing: 0 },
  },
};

export function oracleAvailable(): boolean {
  return existsSync(ORACLE_BIN);
}

export function gameDir(game: OracleGame): string {
  return join(ORACLE_ROOT, 'data', game);
}

/** Copy the retail files (not the `.asm`/`.cnf` side files) into the oracle's private game directory. */
export function prepareGameDir(game: OracleGame, repoRoot = resolve('.')): string {
  const src = join(repoRoot, ORACLE_TITLES[game].dataDir);
  const dst = gameDir(game);
  if (!existsSync(src)) throw new Error(`retail data missing: ${src}`);
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    if (/\.(asm|cnf)$/i.test(f)) continue;
    const d = join(dst, f);
    if (!existsSync(d)) copyFileSync(join(src, f), d);
  }
  return dst;
}

export interface RunOptions {
  loadState?: boolean;
  trace?: boolean;
  timeoutMs?: number;
}

export interface RunResult {
  outDir: string;
  stderr: string;
  status: number | null;
}

/** Run the oracle with a frame-keyed harness script. `outDir` receives the dumps. */
export function runOracle(game: OracleGame, events: ReadonlyArray<readonly [number, string]>, outDir: string, opts: RunOptions = {}): RunResult {
  mkdirSync(outDir, { recursive: true });
  const script = [...events].sort((a, b) => a[0] - b[0]).map(([f, c]) => `${f} ${c}`).join('\n') + '\n';
  const hfile = join(outDir, 'harness.txt');
  writeFileSync(hfile, script);
  const args = ['-m', gameDir(game) + '/'];
  if (opts.loadState) args.push('--load-state');
  const r = spawnSync(ORACLE_BIN, args, {
    cwd: join(ORACLE_ROOT, 'alis'),
    env: {
      ...process.env,
      ALIS_HARNESS: hfile,
      ALIS_HARNESS_OUT: outDir,
      ALIS_HARNESS_FAST: '1',
      ...(opts.trace ? { ALIS_HARNESS_TRACE: '1' } : {}),
      SDL_VIDEODRIVER: 'dummy',
      SDL_AUDIODRIVER: 'dummy',
    },
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { outDir, stderr: r.stderr ?? '', status: r.status };
}

export function savestatePath(game: OracleGame): string {
  return join(gameDir(game), 'alis.state');
}

/** Play the scripted boot and leave `alis.state` in the game directory. */
export function bootToSavestate(game: OracleGame, scratch: string): void {
  const t = ORACLE_TITLES[game];
  if (t.boot.length === 0) throw new Error(`${game}: no scripted boot`);
  rmSync(savestatePath(game), { force: true });
  const last = t.boot[t.boot.length - 1]![0];
  const r = runOracle(game, [...t.boot, [last + 30, 'dump boot'], [last + 31, `peek ${t.row.toString(16)} 1`], [last + 40, 'quit']], scratch);
  if (!existsSync(savestatePath(game))) throw new Error(`${game}: boot did not save a state\n${r.stderr.slice(-2000)}`);
}

// ── Dump parsing ──

export interface OracleSprite {
  state: number;
  numelem: number;
  /** Entity (script) that owns the sprite, lowercase without extension. */
  entity: string;
  /** Script whose resource the bitmap is, lowercase without extension. */
  resource: string;
  /** Resource-relative address of the directory slot (`off`): slot index = (off - dirOff - baseDelta) / 4. */
  off: number;
  x: number;
  y: number;
  z: number;
  invertX: boolean;
  /** Top-left pixel inside the screen, and stored size (real - 1). */
  newX: number;
  newY: number;
  w: number;
  h: number;
}

export interface OracleScreen {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sprites: OracleSprite[];
}

export interface OracleFrame {
  /** Pose captures only: the game reached the requested pose (false when an encounter swallowed the input). */
  taken?: boolean;
  width: number;
  height: number;
  rgb: Uint8Array;
  screens: OracleScreen[];
  entities: string[];
}

const stripExt = (n: string) => n.replace(/\.(do|ao)$/i, '').toLowerCase();

export function parseSpr(text: string): { screens: OracleScreen[]; entities: string[] } {
  const screens: OracleScreen[] = [];
  const entities: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('E ')) {
      entities.push(stripExt(line.split(' ')[2]!));
    } else if (line.startsWith('S ')) {
      const m = /^S (\d+) state=-?\d+ x=(-?\d+) y=(-?\d+) w=(-?\d+) h=(-?\d+)/.exec(line);
      if (m) screens.push({ id: +m[1]!, x: +m[2]!, y: +m[3]!, w: +m[4]!, h: +m[5]!, sprites: [] });
    } else if (line.startsWith('P ')) {
      const m = /state=(-?\d+) ne=(-?\d+) ent=(\S+) res=(\S+) off=(-?\d+) dep=(-?\d+),(-?\d+),(-?\d+) inv=(\d+) new=(-?\d+),(-?\d+) wh=(-?\d+),(-?\d+)/.exec(line);
      if (m && screens.length) {
        screens[screens.length - 1]!.sprites.push({
          state: +m[1]!, numelem: +m[2]!, entity: stripExt(m[3]!), resource: stripExt(m[4]!), off: +m[5]!,
          x: +m[6]!, y: +m[7]!, z: +m[8]!, invertX: +m[9]! !== 0, newX: +m[10]!, newY: +m[11]!, w: +m[12]!, h: +m[13]!,
        });
      }
    }
  }
  return { screens, entities };
}

export function parsePpm(buf: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  let p = 0;
  const tok = (): string => {
    while (buf[p] === 0x20 || buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09) p++;
    let s = '';
    while (p < buf.length && buf[p] !== 0x20 && buf[p] !== 0x0a && buf[p] !== 0x0d && buf[p] !== 0x09) s += String.fromCharCode(buf[p++]!);
    return s;
  };
  if (tok() !== 'P6') throw new Error('not a P6 ppm');
  const width = +tok();
  const height = +tok();
  tok();
  p++;
  return { width, height, rgb: buf.subarray(p, p + width * height * 3) };
}

export function readFrame(dir: string, name: string): OracleFrame {
  const ppm = parsePpm(new Uint8Array(readFileSync(join(dir, `${name}.ppm`))));
  const spr = parseSpr(readFileSync(join(dir, `${name}.spr`), 'utf8'));
  return { ...ppm, ...spr };
}

// ── Pose capture ──

export interface OraclePose {
  row: number;
  col: number;
  /** Walker facing 0..3. */
  facing: 0 | 1 | 2 | 3;
}

/** Frames between setting a pose and dumping it (the redraw settles in < 8). */
const POSE_SETTLE = 12;
const POSE_STRIDE = 16;

/**
 * Capture each pose: poke row/col and the raw facing one turn to the left,
 * click "turn right", dump. Starts from the boot savestate. Every pose is
 * also one wake-up of the scene scripts (the turn), in order.
 */
export function capturePoses(game: OracleGame, poses: readonly OraclePose[], outDir: string): OracleFrame[] {
  const t = ORACLE_TITLES[game];
  const ev: Array<[number, string]> = [];
  for (const m of t.bootMemdumps ?? []) ev.push([2, `memdump ${m.off.toString(16)} ${m.len} ${m.name}`]);
  poses.forEach((p, i) => {
    const f0 = 4 + i * POSE_STRIDE;
    const raw = t.facingRaw[p.facing];
    const ci = t.facingCycle.indexOf(raw);
    const before = t.facingCycle[(ci + t.facingCycle.length - 1) % t.facingCycle.length]!;
    ev.push([f0, `poke ${t.row.toString(16)} ${p.row}`], [f0, `poke ${t.col.toString(16)} ${p.col}`], [f0, `poke ${t.facing.toString(16)} ${before}`]);
    ev.push([f0 + 1, `click ${t.turnRight[0]} ${t.turnRight[1]}`], [f0 + 3, 'up']);
    ev.push([f0 + POSE_SETTLE, `dump p${i}`], [f0 + POSE_SETTLE, `memdump ${t.row.toString(16)} 3 q${i}`]);
  });
  ev.push([4 + poses.length * POSE_STRIDE + 2, 'quit']);
  const r = runOracle(game, ev, outDir, { loadState: true, timeoutMs: 60_000 + poses.length * 200 });
  const frames: OracleFrame[] = [];
  for (let i = 0; i < poses.length; i++) {
    if (!existsSync(join(outDir, `p${i}.ppm`))) throw new Error(`oracle did not dump pose ${i}\n${r.stderr.slice(-2000)}`);
    const q = readFileSync(join(outDir, `q${i}.bin`));
    const p = poses[i]!;
    // The game ignores the turn while a dialogue or fight holds the input
    // (an NPC encounter); such a pose was neither drawn nor woken.
    const taken = q[0] === p.row && q[1] === p.col && (q[2]! >= 128 ? q[2]! - 256 : q[2]!) === t.facingRaw[p.facing];
    frames.push({ ...readFrame(outDir, `p${i}`), taken });
  }
  return frames;
}

export type WalkAction = 'F' | 'L' | 'R';

export interface WalkStep {
  action: WalkAction;
  /** Party state the game holds after the action (unchanged if it was refused). */
  region: number;
  row: number;
  col: number;
  /** Raw facing value. */
  facingRaw: number;
  frame: OracleFrame;
}

/** Frames per walk action (a step animates; clicks during it are dropped). */
const WALK_STRIDE = 80;

/**
 * Play a real walk from the boot savestate with the game's own arrow
 * buttons, dumping the party globals and the frame after every action.
 * Nothing is poked, so every MAIN/GERDEP rule (walkability, zones, grid
 * loads, region changes) runs as in play.
 */
export function captureWalk(game: OracleGame, actions: readonly WalkAction[], outDir: string): WalkStep[] {
  const t = ORACLE_TITLES[game];
  const ev: Array<[number, string]> = [];
  for (const m of t.bootMemdumps ?? []) ev.push([2, `memdump ${m.off.toString(16)} ${m.len} ${m.name}`]);
  actions.forEach((a, i) => {
    const f0 = 4 + i * WALK_STRIDE;
    const [x, y] = a === 'F' ? t.forward : a === 'L' ? t.turnLeft : t.turnRight;
    ev.push([f0, `click ${x} ${y}`], [f0 + 2, 'up']);
    ev.push([f0 + WALK_STRIDE - 8, `memdump ${t.row.toString(16)} 3 s${i}`]);
    if (t.region !== undefined) ev.push([f0 + WALK_STRIDE - 8, `memdump ${t.region.toString(16)} 1 r${i}`]);
    ev.push([f0 + WALK_STRIDE - 8, `dump w${i}`]);
  });
  ev.push([4 + actions.length * WALK_STRIDE + 2, 'quit']);
  const r = runOracle(game, ev, outDir, { loadState: true, timeoutMs: 60_000 + actions.length * 300 });
  return actions.map((action, i) => {
    if (!existsSync(join(outDir, `w${i}.ppm`))) throw new Error(`oracle did not dump walk step ${i}\n${r.stderr.slice(-2000)}`);
    const s = readFileSync(join(outDir, `s${i}.bin`));
    const sb = (v: number) => (v >= 128 ? v - 256 : v);
    const region = t.region !== undefined ? readFileSync(join(outDir, `r${i}.bin`))[0]! : t.start.region;
    return { action, region, row: s[0]!, col: s[1]!, facingRaw: sb(s[2]!), frame: readFrame(outDir, `w${i}`) };
  });
}

export function tempDir(prefix: string): string {
  const base = join(ORACLE_ROOT, 'tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

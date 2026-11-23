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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, linkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ISHAR1_TITLE, ISHAR2_TITLE, ISHAR3_TITLE, type IsharTitleSpec } from '../../shared/ishar-scene.ts';

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
  /**
   * Roaming NPC/monster scripts a `noNpcs` walk removes (they block cells
   * and start fights, which interrupt long scripted walks). Removing them
   * changes the game, so such walks only measure scenery and movement.
   */
  npcScripts?: readonly string[];
  /** Main globals that are game state the scene reads (e.g. the day phase), dumped with the party every step. */
  stateGlobals?: readonly number[];
  /** Extra environment for every run of this title (e.g. the virtual clock). */
  env?: Readonly<Record<string, string>>;
  /** Scripted boot: `[frame, command]` pairs, the last one saves the state. */
  boot: ReadonlyArray<readonly [number, string]>;
  /** Main-segment tables dumped with the party after every walk step (`WalkStep.mem[name]`), e.g. the monster table the step test reads. */
  stepMemdumps?: ReadonlyArray<{
    name: string;
    off: number;
    len: number;
    /** a one-dimensional table the scene scripts read (`IsharPartyState.tables`), signed bytes */
    table?: boolean;
    /** main memory the entity scripts read (`IsharPartyState.memory`) */
    memory?: boolean;
    /** main globals the scene reads (`IsharPartyState.globals`), one per byte or big-endian word */
    globals?: 'byte' | 'word';
  }>;
  /** Memory captured at the start of every pose run (`<name>.bin` in the run directory). */
  bootMemdumps?: ReadonlyArray<{ name: string; off: number; len: number; memory?: boolean }>;
  /** Party state in the boot savestate (scene created, no wake-up yet). */
  start: { region: number; row: number; col: number; facing: 0 | 1 | 2 | 3 };
}

/** Per-step dumps of every main block a title's entity scripts read (`IsharTitleSpec.entities`). */
function entityDumps(spec: IsharTitleSpec): Array<{ name: string; off: number; len: number; memory: true }> {
  const e = spec.entities;
  return [...(e?.en1 ?? []), ...(e?.scratch ?? [])].map(([off, len]) => ({ name: `ent${off.toString(16)}`, off, len, memory: true as const }));
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
    // ENCONT spawns the roaming monsters; the rest are the monsters and NPCs themselves.
    npcScripts: ['encont', 'orc', 'loup', 'knight', 'azal', 'naim', 'barbare', 'kiriela', 'bormin', 'dealer', 'wiz1', 'morgu', 'wardog', 'dragon', 'dwarrior', 'geant', 'goul', 'krog', 'medus', 'minotor', 'momo', 'monstre', 'predator', 'saub', 'skelet', 'spectre', 'spider', 'zombi', 'darkm', 'darkwiz', 'sorcier', 'fragorn'],
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
    bootMemdumps: [{ name: 'gridB', off: 0x234a, len: 4860 }, ...entityDumps(ISHAR1_TITLE)],
    // The EN1.FIC monster table GERDEP's step test reads (`ISHAR1_MONSTER_TABLE`).
    stepMemdumps: [
      { name: 'monRow', off: 0x1978, len: 140 },
      { name: 'monCol', off: 0x1a06, len: 140 },
      { name: 'monHp', off: 0x1b22, len: 140 },
      { name: 'monKind', off: 0x22f2, len: 70 },
      { name: 'monRegion', off: 0x3910, len: 70 },
      { name: 'monZ', off: 0x3a48, len: 140 },
      // everything ENCONT reads to place the monsters (the EN1 arrays and its front-row slots)
      ...entityDumps(ISHAR1_TITLE),
      // PARAM's door flags (the cave scripts draw each door open or shut)
      { name: 'doorOpen', off: 0x3b64, len: 41, table: true },
      // and the lever states MCAVE reads next to the lever list 0x3c68/0x3c9c
      { name: 'leverState', off: 0x3b98, len: 50, table: true },
      // GERDEP's sub-zone (MAIN swaps the zone add-ons on it)
      { name: 'zone', off: 0x3eac, len: 1 },
    ],
  },
  ishar2: {
    dataDir: 'data/ishar2/amigaaga',
    row: 0x2ab4,
    col: 0x2ab5,
    facing: 0x2ab6,
    region: 0x2d18,
    npcScripts: ['pours1', 'lezard1', 'fly1', 'people1', 'people2', 'golem1', 'wizard1', 'aigle'],
    // everything EAFF reads to place the monsters (the EN1 arrays and its front-row slots)
    // and GERDEP's sub-zone `0x4ef2` (MAIN swaps the zone add-ons on it)
    stepMemdumps: [...entityDumps(ISHAR2_TITLE), { name: 'zone', off: 0x4ef2, len: 1 }, { name: 'doorOpen', off: 0x4aa4, len: 70, table: true }],
    bootMemdumps: entityDumps(ISHAR2_TITLE),
    // the day phase: MAIN advances it on a timer (frames 12965, 14965 ... of play)
    stateGlobals: [0x519f],
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
    // MAIN's region code (`0x14b9`, 1 in Maz: the switches at MAIN `+0x137c`/`+0x26e9`)
    region: 0x14b9,
    // MAIN's location code `0x3b33` (2 at the start): MAIN `+0x18d4` loads each location's scene add-ons on it
    bootMemdumps: entityDumps(ISHAR3_TITLE),
    stepMemdumps: [
      { name: 'zone', off: 0x3b33, len: 1, globals: 'byte' },
      // everything EAFF and AFFPV read to place the monsters and townspeople
      ...entityDumps(ISHAR3_TITLE),
      // the day/night palette factors MAIN `+0x135b` passes to `cdarkpal` (r, g, b words, 256 = unchanged) and its count switch
      { name: 'dark', off: 0x3f82, len: 6, globals: 'word' },
      { name: 'darkWide', off: 0x3da4, len: 2, globals: 'word' },
      { name: 'clock', off: 0x3da1, len: 4 },
    ],
    facingCycle: [1, 2, -1, -2],
    facingRaw: [1, 2, -1, -2],
    turnRight: [310, 30],
    turnLeft: [263, 30],
    forward: [288, 30],
    viewScreen: { x: 0, y: 13, w: 255, h: 112 },
    // townspeople (affpv spawns them), the Maz thieves and guards, and the
    // monsters MAIN `+0x18d4` loads per location
    npcScripts: ['affpv', 'vperso1', 'vperso2', 'vperso3', 'vperso4', 'vperso5', 'voleur1', 'guard1', 'guard2', 'lezard1', 'moltus', 'witch7', 'chaos7', 'plasma7', 'skelet7', 'spider7', 'dragon7', 'wizard7', 'slime7', 'redfi7', 'sorcier7', 'leo3', 'zouav3', 'snake3', 'ours9', 'loup9', 'geant9', 'bee5', 'ours5', 'fly5', 'greem5', 'chaos5', 'mage5', 'typhus', 'runner'],
    // Ishar 3 paces its intro on the 50 Hz timer, so it runs under the
    // harness's virtual clock (one timer tick per presented frame).
    env: { ALIS_HARNESS_VCLOCK: '1' },
    // Clicks and spaces through logo, intro, title, team screens; "play" at
    // frame 4000. MAIN starts the Maz town group at frame 4019 (vwall,
    // vhouse2, vhouse1, fville, vdec1, vdec2, affpv, sville, sville2):
    // CONT1-3 row 2 col 50, raw facing 1. Saved before any wake.
    boot: [
      [150, 'click 160 100'],
      [155, 'up'],
      [250, 'click 130 50'],
      [255, 'up'],
      [475, 'click 160 100'],
      [480, 'up'],
      [550, 'key 32'],
      [580, 'keyup'],
      [775, 'click 160 100'],
      [780, 'up'],
      [850, 'key 32'],
      [880, 'keyup'],
      [1075, 'click 160 100'],
      [1080, 'up'],
      [1150, 'key 32'],
      [1180, 'keyup'],
      [1375, 'click 160 100'],
      [1380, 'up'],
      [1450, 'key 32'],
      [1480, 'keyup'],
      [1675, 'click 160 100'],
      [1680, 'up'],
      [1750, 'key 32'],
      [1780, 'keyup'],
      [1975, 'click 160 100'],
      [1980, 'up'],
      [2050, 'key 32'],
      [2080, 'keyup'],
      [2275, 'click 160 100'],
      [2280, 'up'],
      [2350, 'key 32'],
      [2380, 'keyup'],
      [2575, 'click 160 100'],
      [2580, 'up'],
      [2650, 'key 32'],
      [2680, 'keyup'],
      [2875, 'click 160 100'],
      [2880, 'up'],
      [2950, 'key 32'],
      [2980, 'keyup'],
      [3175, 'click 160 100'],
      [3180, 'up'],
      [3250, 'key 32'],
      [3280, 'keyup'],
      [3475, 'click 160 100'],
      [3480, 'up'],
      [3550, 'key 32'],
      [3580, 'keyup'],
      [4000, 'click 160 168'],
      [4005, 'up'],
      [4060, 'save'],
    ],
    start: { region: 1, row: 2, col: 50, facing: 0 },
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
  /** Remove these entities (script names) whenever they appear (`ALIS_HARNESS_NOENT`). */
  noEntities?: readonly string[];
  /** Game directory to run from instead of the shared `gameDir(game)` (a private copy with its own `alis.state`). */
  gameDir?: string;
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
  const args = ['-m', (opts.gameDir ?? gameDir(game)) + '/'];
  if (opts.loadState) args.push('--load-state');
  const r = spawnSync(ORACLE_BIN, args, {
    cwd: join(ORACLE_ROOT, 'alis'),
    env: {
      ...process.env,
      ALIS_HARNESS: hfile,
      ALIS_HARNESS_OUT: outDir,
      ALIS_HARNESS_FAST: '1',
      ...(opts.trace ? { ALIS_HARNESS_TRACE: '1' } : {}),
      ...(ORACLE_TITLES[game].env ?? {}),
      ...(opts.noEntities?.length ? { ALIS_HARNESS_NOENT: opts.noEntities.join(',').toLowerCase() } : {}),
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
    ev.push([f0 + POSE_SETTLE, `dump p${i}`], ...partyDumps(t, f0 + POSE_SETTLE, `q${i}`));
  });
  ev.push([4 + poses.length * POSE_STRIDE + 2, 'quit']);
  const r = runOracle(game, ev, outDir, { loadState: true, timeoutMs: 60_000 + poses.length * 200 });
  const frames: OracleFrame[] = [];
  for (let i = 0; i < poses.length; i++) {
    if (!existsSync(join(outDir, `p${i}.ppm`))) throw new Error(`oracle did not dump pose ${i}\n${r.stderr.slice(-2000)}`);
    const q = readParty(t, outDir, `q${i}`);
    const p = poses[i]!;
    // The game ignores the turn while a dialogue or fight holds the input
    // (an NPC encounter); such a pose was neither drawn nor woken.
    const taken = q.row === p.row && q.col === p.col && q.facingRaw === t.facingRaw[p.facing];
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
  /** `stateGlobals` values after the action. */
  globals: Record<number, number>;
  /** `stepMemdumps` after the action. */
  mem?: Record<string, Uint8Array>;
  frame: OracleFrame;
}

/** Harness commands that dump the party globals (one byte each) as `<name>.<field>.bin`. */
function partyDumps(t: OracleTitle, frame: number, name: string): Array<[number, string]> {
  const ev: Array<[number, string]> = [
    [frame, `memdump ${t.row.toString(16)} 1 ${name}.row`],
    [frame, `memdump ${t.col.toString(16)} 1 ${name}.col`],
    [frame, `memdump ${t.facing.toString(16)} 1 ${name}.facing`],
  ];
  if (t.region !== undefined) ev.push([frame, `memdump ${t.region.toString(16)} 1 ${name}.region`]);
  for (const g of t.stateGlobals ?? []) ev.push([frame, `memdump ${g.toString(16)} 1 ${name}.g${g.toString(16)}`]);
  for (const m of t.stepMemdumps ?? []) ev.push([frame, `memdump ${m.off.toString(16)} ${m.len} ${name}.m-${m.name}`]);
  return ev;
}

function readParty(t: OracleTitle, dir: string, name: string): { region: number; row: number; col: number; facingRaw: number; globals: Record<number, number>; mem?: Record<string, Uint8Array> } {
  const b = (f: string) => readFileSync(join(dir, `${name}.${f}.bin`))[0]!;
  const f = b('facing');
  const globals: Record<number, number> = {};
  for (const g of t.stateGlobals ?? []) globals[g] = b(`g${g.toString(16)}`);
  let mem: Record<string, Uint8Array> | undefined;
  if (t.stepMemdumps?.length) {
    mem = {};
    for (const m of t.stepMemdumps) mem[m.name] = new Uint8Array(readFileSync(join(dir, `${name}.m-${m.name}.bin`)));
  }
  return { region: t.region !== undefined ? b('region') : t.start.region, row: b('row'), col: b('col'), facingRaw: f >= 128 ? f - 256 : f, globals, ...(mem ? { mem } : {}) };
}

/** Frames per walk action (a step animates; clicks during it are dropped). */
const WALK_STRIDE = 80;

/**
 * Play a real walk from the boot savestate with the game's own arrow
 * buttons, dumping the party globals and the frame after every action.
 * Nothing is poked, so every MAIN/GERDEP rule (walkability, zones, grid
 * loads, region changes) runs as in play.
 */
export function captureWalk(
  game: OracleGame,
  actions: readonly WalkAction[],
  outDir: string,
  opts: {
    noNpcs?: boolean;
    /** Extra harness commands keyed by walk step (run at the start of that step, before its click), e.g. a poke. */
    commands?: ReadonlyArray<readonly [number, string]>;
  } = {},
): WalkStep[] {
  const t = ORACLE_TITLES[game];
  const ev: Array<[number, string]> = (opts.commands ?? []).map(([i, c]) => [3 + i * WALK_STRIDE, c] as [number, string]);
  for (const m of t.bootMemdumps ?? []) ev.push([2, `memdump ${m.off.toString(16)} ${m.len} ${m.name}`]);
  actions.forEach((a, i) => {
    const f0 = 4 + i * WALK_STRIDE;
    const [x, y] = a === 'F' ? t.forward : a === 'L' ? t.turnLeft : t.turnRight;
    ev.push([f0, `click ${x} ${y}`], [f0 + 2, 'up']);
    ev.push(...partyDumps(t, f0 + WALK_STRIDE - 8, `s${i}`));
    ev.push([f0 + WALK_STRIDE - 8, `dump w${i}`]);
  });
  ev.push([4 + actions.length * WALK_STRIDE + 2, 'quit']);
  const r = runOracle(game, ev, outDir, { loadState: true, timeoutMs: 60_000 + actions.length * 300, noEntities: opts.noNpcs ? t.npcScripts : undefined });
  return actions.map((action, i) => {
    if (!existsSync(join(outDir, `w${i}.ppm`))) throw new Error(`oracle did not dump walk step ${i}\n${r.stderr.slice(-2000)}`);
    return { action, ...readParty(t, outDir, `s${i}`), frame: readFrame(outDir, `w${i}`) };
  });
}

/**
 * A read-back walk: play the game in legs, each leg starting from the
 * savestate the previous one left, and ask `plan` for the next leg's actions
 * from the position the game actually reached (`null` or `[]` ends the
 * walk). This keeps a long route in step with the game when it drops a
 * press or refuses a step, which an open-loop `captureWalk` cannot. With
 * `expect` states the harness also holds input from the first action the
 * game did not follow, and the leg's steps stop there. Runs in a private
 * copy of the game directory, so the shared boot savestate is untouched.
 */
export interface LegPlan {
  actions: readonly WalkAction[];
  /** Party state each action should leave; the harness holds input from the first mismatch (`expect`). */
  expect?: ReadonlyArray<{ region: number; row: number; col: number; facingRaw: number }>;
}

export function captureLegWalk(
  game: OracleGame,
  plan: (cur: { region: number; row: number; col: number; facingRaw: number | null }, done: readonly WalkStep[]) => LegPlan | readonly WalkAction[] | null,
  outDir: string,
  opts: {
    noNpcs?: boolean;
    maxLegs?: number;
    /** Start from this savestate (e.g. a previous walk's `finalState`) instead of the boot state; `start` is then where it stands. */
    startState?: string;
    start?: { region: number; row: number; col: number; facingRaw: number };
    /** Keep the savestate the last leg left here. */
    finalState?: string;
    /** Harness commands run at the start of every leg (e.g. `pokew` to keep the party alive on a scenery walk). */
    legCommands?: readonly string[];
  } = {},
): WalkStep[] {
  const t = ORACLE_TITLES[game];
  // A private game directory (links to the shared files, its own copy of
  // the boot savestate), so the legs' saves never touch the shared state
  // other runs and tests load.
  // (Hard links: the engine's platform detection does not follow symlinks.)
  const own = join(tempDir(`${game}-legs-`), 'game');
  mkdirSync(own, { recursive: true });
  for (const f of readdirSync(gameDir(game))) {
    const d = join(own, f);
    if (f === 'alis.state') copyFileSync(opts.startState ?? join(gameDir(game), f), d);
    else linkSync(join(gameDir(game), f), d);
  }
  const steps: WalkStep[] = [];
  // facingRaw null = the title's start facing (`start.facing`, walker order)
  let cur: { region: number; row: number; col: number; facingRaw: number | null } = opts.start ?? { region: t.start.region, row: t.start.row, col: t.start.col, facingRaw: null };
  try {
    for (let leg = 0; leg < (opts.maxLegs ?? 50); leg++) {
      const p = plan(cur, steps);
      const actions = p === null ? null : 'actions' in p ? p.actions : p;
      const expect = p !== null && 'actions' in p ? p.expect : undefined;
      if (!actions || actions.length === 0) break;
      const dir = join(outDir, `leg${leg}`);
      const ev: Array<[number, string]> = (opts.legCommands ?? []).map((c) => [2, c] as [number, string]);
      actions.forEach((a, i) => {
        const f0 = 4 + i * WALK_STRIDE;
        const [x, y] = a === 'F' ? t.forward : a === 'L' ? t.turnLeft : t.turnRight;
        ev.push([f0, `click ${x} ${y}`], [f0 + 2, 'up']);
        ev.push(...partyDumps(t, f0 + WALK_STRIDE - 8, `s${i}`));
        ev.push([f0 + WALK_STRIDE - 8, `dump w${i}`]);
        const e = expect?.[i];
        if (e) {
          ev.push([f0 + WALK_STRIDE - 6, `expect ${t.row.toString(16)} ${e.row}`], [f0 + WALK_STRIDE - 6, `expect ${t.col.toString(16)} ${e.col}`], [f0 + WALK_STRIDE - 6, `expect ${t.facing.toString(16)} ${e.facingRaw & 0xff}`]);
          if (t.region !== undefined) ev.push([f0 + WALK_STRIDE - 6, `expect ${t.region.toString(16)} ${e.region}`]);
        }
      });
      const end = 4 + actions.length * WALK_STRIDE;
      ev.push([end, 'save'], [end + 4, 'quit']);
      const r = runOracle(game, ev, dir, { loadState: true, timeoutMs: 60_000 + actions.length * 300, noEntities: opts.noNpcs ? t.npcScripts : undefined, gameDir: own });
      // the harness log (watch/trace/peek lines) stays with the leg's dumps
      writeFileSync(join(dir, 'stderr.txt'), r.stderr);
      for (let i = 0; i < actions.length; i++) {
        if (!existsSync(join(dir, `w${i}.ppm`))) throw new Error(`oracle did not dump leg ${leg} step ${i}\n${r.stderr.slice(-2000)}`);
        const s = { action: actions[i]!, ...readParty(t, dir, `s${i}`), frame: readFrame(dir, `w${i}`) };
        steps.push(s);
        // input is held after the first deviation; later steps did not happen
        const e = expect?.[i];
        if (e && (s.row !== e.row || s.col !== e.col || s.facingRaw !== e.facingRaw || (t.region !== undefined && s.region !== e.region))) break;
      }
      const last = steps[steps.length - 1]!;
      cur = { region: last.region, row: last.row, col: last.col, facingRaw: last.facingRaw };
    }
    if (opts.finalState) copyFileSync(join(own, 'alis.state'), opts.finalState);
  } finally {
    rmSync(dirname(own), { recursive: true, force: true });
  }
  return steps;
}

/**
 * Drive a trip the way the game's own scripts do: queue a message for MAIN
 * (harness `send`, the same queue write as `csend`), let the game play it
 * for `frames` frames from the boot savestate, and keep the savestate it
 * reaches in `statePath`. Ishar 2: `[14, selector]` is what MAP (the travel
 * map), GERDEP (region 4's cell 126) and GESORT (recall) send; MAIN
 * `+0x374` stores the selector and runs the arrival table (`ISHAR2_TRAVEL`).
 * Returns the party state the game holds at the end.
 */
export function captureTrip(game: OracleGame, message: readonly number[], statePath: string, frames = 400): { region: number; row: number; col: number; facingRaw: number } {
  const t = ORACLE_TITLES[game];
  const own = join(tempDir(`${game}-trip-`), 'game');
  mkdirSync(own, { recursive: true });
  for (const f of readdirSync(gameDir(game))) {
    const d = join(own, f);
    if (f === 'alis.state') copyFileSync(join(gameDir(game), f), d);
    else linkSync(join(gameDir(game), f), d);
  }
  try {
    const out = join(dirname(own), 'out');
    const ev: Array<[number, string]> = [[2, `send 0 ${message.join(' ')}`], ...partyDumps(t, frames, 'trip'), [frames + 2, 'save'], [frames + 6, 'quit']];
    const r = runOracle(game, ev, out, { loadState: true, gameDir: own, timeoutMs: 120_000 });
    if (!existsSync(join(out, 'trip.row.bin'))) throw new Error(`oracle did not finish the trip\n${r.stderr.slice(-2000)}`);
    copyFileSync(join(own, 'alis.state'), statePath);
    const p = readParty(t, out, 'trip');
    return { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
  } finally {
    rmSync(dirname(own), { recursive: true, force: true });
  }
}

export function tempDir(prefix: string): string {
  const base = join(ORACLE_ROOT, 'tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

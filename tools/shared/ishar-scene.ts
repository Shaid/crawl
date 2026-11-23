/**
 * Ishar 1/2/3 first-person scene: the set of ALIS scripts the game keeps
 * alive for the current region, run as persistent coroutines and
 * composited the way the reference engine does.
 *
 * What the game does (traced 2026-11-22 with the `maestun/alis` oracle,
 * `tools/ishar/oracle/`; MAIN offsets are into the decompressed `MAIN.DO`):
 *
 * - MAIN keeps a region code in a main global (Ishar 1: `0x1508`). When it
 *   changes, MAIN loads and `clive`s that code's scene scripts -- a
 *   `cswitch2` on the code at MAIN `+0x188d` (loads) and `+0x1c88` (starts).
 *   The scripts are NOT chosen per cell: every script of the group stays
 *   alive and scans the view itself, placing sprites only for its own cell
 *   values. So a frame is the UNION of several scripts' sprites.
 * - On every step or turn, GERDEP `cwakeup`s each scene script; each one
 *   resumes after its `csleep`, redraws (most start with `ccancall`, the
 *   backdrops only re-put one element) and sleeps again. Sprites persist
 *   between wake-ups (element rules: `AlisScriptRunner`), which is why the
 *   backdrop alternates per step (FOND flips one layer every wake-up and the
 *   other on every facing change).
 * - Display order is the engine's depth list (`image.c` `rangesprite`):
 *   farther first; at equal depth, higher element number first; at equal
 *   element, the oracle's lists put the most recently created script's
 *   sprites first, and within one script keep put order (new sprites enter
 *   the screen list at its head and each is inserted in front of its equals,
 *   which reverses twice).
 * - Uncovered view pixels are palette index 0 (`clrfen`).
 *
 * Per-title constants (addresses, region-code groups) live in the
 * `IsharTitleSpec`s below; each one cites its trace.
 */
import { AlisScriptRunner, type SceneEnv } from './alis-interp.ts';
import { decodeIsharBitmap, findIsharDirectory, isharBitmapToNormalizedGreyscaleRGBA, resolveIsharSlot, type IsharBitmap } from './ishar-sprites.ts';
import { isharBitmapToPaletteRGBA, resolveIsharOwnPalette, resolveIsharPaletteSlot, type IsharPalette } from './ishar-palette.ts';

export type IsharGame = 'ishar' | 'ishar2' | 'ishar3';

/** A sign-extended cell reader over one storage grid (`row*stride + col`). */
export type GridReader = (row: number, col: number) => number;

export interface IsharViewScreen {
  /** Screen-space projection: pixelX = xCenter + x, pixelY = horizonY - z (then centre-anchored). */
  xCenter: number;
  horizonY: number;
  /** Real view-window size (the `cscreen` geometry's stored size + 1). */
  width: number;
  height: number;
}

/** Where the party is, in the game's own terms. */
export interface IsharPartyState {
  /** Region code the game keeps in its region global (Ishar 1 `0x1508`: CONT number, +10 inside a town/cave). */
  region: number;
  /** Storage row / column of the party cell, as the game's own globals hold them. */
  row: number;
  col: number;
  /** Walker facing N/E/S/W = 0..3 (`facingRaw` maps it to the game's value). */
  facing: 0 | 1 | 2 | 3;
  /** Other main globals that are game state rather than position (e.g. Ishar 2's day phase `0x519f`); override `mainGlobals`' defaults. */
  globals?: Readonly<Record<number, number>>;
  /** One-dimensional main tables as the game holds them now (e.g. Ishar 1's door flags `0x3b64`); override the spec's new-game `tables`. */
  tables?: Readonly<Record<number, readonly number[]>>;
  /** Main-segment memory blocks as the game holds them now, keyed by start address (e.g. the EN1 monster arrays); override `IsharScene.memory`. */
  memory?: Readonly<Record<number, Uint8Array>>;
}

export interface IsharSceneGroup {
  /** Scene scripts in MAIN's `clive` order (= the entity order they run in each frame). Names without extension. */
  scripts: readonly string[];
  /**
   * The backdrop script whose palette the view uses, and the directory slot
   * its `cpalette` installs. A list names candidates: the first one alive
   * wins (Ishar 2's dungeons, whose backdrop is a zone add-on).
   */
  paletteFrom?: { script: string | readonly string[]; slot: number | ((readMain: (addr: number) => number) => number) };
}

export interface IsharTitleSpec {
  game: IsharGame;
  stride: number;
  rows: number;
  globals: { row: number; col: number; facing: number };
  facingRaw: readonly [number, number, number, number];
  gridA: number;
  gridB: number;
  screen: IsharViewScreen;
  /** Every main global the scene scripts read, for a party state. */
  mainGlobals(state: IsharPartyState): Record<number, number>;
  /** The scene scripts the game keeps alive for a region code (empty = no first-person scene modelled). */
  sceneGroup(region: number): IsharSceneGroup | null;
  /**
   * Sub-zone tracking, if the title has it: after every step or turn the
   * game runs a routine of `script` (from `entry` until one of `exits`) that
   * may rewrite the zone global `addr` (hysteresis rules keyed on gate
   * cells). `prevRegionLocal` is the script local holding the region the
   * party came from.
   */
  zone?: {
    script: string;
    entry: number;
    exits: readonly number[];
    addr: number;
    /** Script local that holds the region the party came from (Ishar 1). */
    prevRegionLocal?: number;
    /** Other script locals the routine expects (e.g. Ishar 2's grid-B cell under the party). */
    locals?: (state: IsharPartyState, grids: { A: GridReader; B: GridReader }) => Record<number, number>;
    /** The game runs the routine only after a step, not a turn. */
    onMoveOnly?: boolean;
  };
  /** Sub-zone value at the start of a new game (default 0). */
  initialZone?: number;
  /** Zones whose add-ons MAIN restarts (kill + start) every time the zone is entered. */
  addOnRestartZones?: readonly number[];
  /** ALIS engine version of the title's bytecode (default 20; Ishar 3 is 30). */
  engineVersion?: number;
  /** Entity coordinate offsets in script vram (`ALIS_SCR_WCX/WCY/WCZ`); default 0/2/4, engine 3.0 uses 0/8/16. */
  coordOffsets?: readonly [number, number, number];
  /**
   * One-dimensional main tables the scene scripts read with `omaintc` (one
   * index, no row popped), as the game holds them at the start of a new
   * game. Anything not listed here is a two-dimensional grid (gridA/gridB).
   */
  tables?: Readonly<Record<number, readonly number[]>>;
  /** Every script `sceneGroup`/`addOns` can name (anything else on the view screen, e.g. a wandering NPC, is not scenery). */
  sceneScripts: readonly string[];
  /**
   * Which CONT file each grid buffer holds. Ishar 1 (MAIN `+0x49c2`, `+0xb0f`):
   * odd regions live in A, even in B; after each move MAIN loads the next
   * region into the other buffer when row > 45 (unless already in the last
   * region) and the previous one when row < 8, else leaves it as it was.
   * Ishar 2/3: one CONT file holds both layers (layer 0 = A, layer 1 = B).
   */
  gridBuffers: 'ishar1-pairs' | 'layers';
  /**
   * One step from (row, col) in the game's raw facing (GERDEP `+0x541`;
   * raw 1 = col-1, 2 = row+1, 3 = col+1, 4 = row-1), with Ishar 1's
   * north-south region chaining (world row = 54*(region-1)+row, regions
   * 1..6). Returns null when the step leaves the modelled world.
   */
  stepFrom(state: IsharPartyState, dir: 0 | 1 | 2 | 3): IsharPartyState | null;
  /**
   * The game's step test for entering `to` (the `stepFrom` result), with
   * `cell(region, row, col)` = the signed layer-0 CONT value. Returns the
   * party state after the step (a passage can move the party elsewhere) or
   * null when the game refuses it. Default: refused on a negative cell.
   */
  enter?(from: IsharPartyState, to: IsharPartyState, cell: (region: number, row: number, col: number) => number, occupied?: IsharOccupancy, cellB?: (region: number, row: number, col: number) => number): IsharPartyState | null;
  /**
   * The engine's day/night darkening (`cdarkpal r g b first count`): when
   * any factor is not 256, every `cpalette` scales palette entries
   * [first, first + count) by factor/256 per channel (truncated) and
   * entry 0 to black (`image.c` palette load, `opcodes.c` `cdarkpal`).
   * Returns the current call's arguments from the main globals.
   */
  darken?(readMain: (addr: number) => number): { factors: readonly [number, number, number]; first: number; count: number } | null;
  /** The CONT file a region code reads (default: `region % 10`, Ishar 1/2's town/cave codes +10 share their region's file). */
  contOf?(region: number): number;
  /**
   * NPCs and monsters. `persistent` scripts are started once for the whole
   * game and stay alive across region changes; GERDEP wakes them with the
   * scene (Ishar 1: ENCONT, which on every wake kills the monster entities
   * it started and `clive`s one per EN1 slot in view, passing the view
   * position through `shimw`). `scripts` are the scripts those may start
   * (looked up by header id, like the scene scripts' own children).
   */
  entities?: {
    persistent: readonly string[];
    scripts: readonly string[];
    /** `EN1.FIC` as MAIN reads it: `[addr, len]` in file order (`isharEntityMemory`). */
    en1?: ReadonlyArray<readonly [number, number]>;
    /** Other main blocks the entity scripts read and write, zero at a new game (Ishar 1's front-row slots `0x3d54`). */
    scratch?: ReadonlyArray<readonly [number, number]>;
  };
  /** Zone add-on scripts MAIN keeps alive for (region, zone); `null` = this zone leaves the current add-ons alone. */
  addOns?(region: number, zone: number, state: IsharPartyState): readonly string[] | null;
}

/**
 * Ishar 1. Globals traced in MAIN: row `0x137c`, col `0x137d`, facing
 * `0x137e` (1..4), region code `0x1508`, world row `0x3646` (MAIN `+0xaf7`:
 * `54*(code%10 - 1) + row`, the regions are stacked north-south), and
 * `0x3696` (copied into each scene script's local `-2`; 1 in every oracle
 * run). Grids: odd CONT files load into `basemain+0x80`, even ones into
 * `+0x234a` (MAIN `+0x49c2`), so the scripts see the current region and
 * its neighbour at the same time.
 */
/**
 * True when a monster stands on (region, row, col) in the sense of GERDEP's
 * monster check (Ishar 1 `+0x1584`). Absent = nothing is known to stand
 * anywhere (the walker does not simulate monsters). With `dir` (a raw
 * facing, 1..4) the question is instead whether a monster in that cell
 * blocks leaving it that way (Ishar 2 GERDEP `+0xc8b`: a monster standing
 * in the party's own cell holds one side of it).
 */
export type IsharOccupancy = (region: number, row: number, col: number, dir?: number) => boolean;

/**
 * Ishar 1's monster table: 70 slots, loaded from `EN1.FIC` by MAIN
 * `+0x4a97` (28 `cfreadb`s into separate main-segment arrays, written back
 * on save). The step test reads six of the arrays; the file offset of each
 * is the sum of the read sizes before it (checked byte-exact against the
 * oracle's boot memory).
 */
export interface Ishar1MonsterTable {
  row: readonly number[];
  col: readonly number[];
  /** `0x1b22` (word); > 0 = alive. */
  hp: readonly number[];
  /** `0x22f2` (signed byte); < 0 = a monster that holds its cell, >= 0 = an NPC/event the party walks onto. */
  kind: readonly number[];
  /** `0x3910`; the full region code (`0x1508`), 0 = not placed. */
  region: readonly number[];
  /** `0x3a48` (word); must be 0 to block. */
  z: readonly number[];
}

/** Main-segment address and `EN1.FIC` file offset of each array the step test reads. */
export const ISHAR1_MONSTER_ARRAYS = {
  row: { addr: 0x1978, file: 0, word: true },
  col: { addr: 0x1a06, file: 140, word: true },
  hp: { addr: 0x1b22, file: 420, word: true },
  kind: { addr: 0x22f2, file: 2520, word: false },
  region: { addr: 0x3910, file: 3150, word: false },
  z: { addr: 0x3a48, file: 3360, word: true },
} as const;
export const ISHAR1_MONSTER_SLOTS = 70;
/** GERDEP `+0x1584` scans slots 28 .. count-1 (`0x3697` = 70); 0..27 are the encounter templates ENCONT copies from. */
export const ISHAR1_MONSTER_FIRST_SLOT = 28;

function readMonsterArrays(get: (field: keyof typeof ISHAR1_MONSTER_ARRAYS) => Uint8Array, at: 'file' | 'dump'): Ishar1MonsterTable {
  const out: Record<string, number[]> = {};
  for (const [k, a] of Object.entries(ISHAR1_MONSTER_ARRAYS)) {
    const b = get(k as keyof typeof ISHAR1_MONSTER_ARRAYS);
    const o = at === 'file' ? a.file : 0;
    const v: number[] = [];
    for (let i = 0; i < ISHAR1_MONSTER_SLOTS; i++) {
      if (a.word) v.push((((b[o + 2 * i] ?? 0) << 8 | (b[o + 2 * i + 1] ?? 0)) << 16) >> 16);
      else v.push(((b[o + i] ?? 0) << 24) >> 24);
    }
    out[k] = v;
  }
  // the region code is unsigned
  out.region = out.region!.map((r) => r & 0xff);
  return out as unknown as Ishar1MonsterTable;
}

/** The new-game monster table, from the shipped `EN1.FIC`. */
export function ishar1MonsterTableFromEn1(en1: Uint8Array): Ishar1MonsterTable {
  return readMonsterArrays(() => en1, 'file');
}

/** The live monster table, from per-array memory dumps keyed `monRow`, `monCol`, ... (the oracle's `stepMemdumps`). */
export function ishar1MonsterTableFromDumps(mem: Readonly<Record<string, Uint8Array>>): Ishar1MonsterTable | null {
  const name = (k: string) => 'mon' + k[0]!.toUpperCase() + k.slice(1);
  if (!Object.keys(ISHAR1_MONSTER_ARRAYS).every((k) => mem[name(k)])) return null;
  return readMonsterArrays((k) => mem[name(k)]!, 'dump');
}

/** Every script a title's walker scene can run: the scene scripts, the zone script and the NPC/monster entities. */
export function isharSceneScriptNames(spec: IsharTitleSpec): string[] {
  return [...new Set([...spec.sceneScripts, ...(spec.zone ? [spec.zone.script] : []), ...(spec.entities?.persistent ?? []), ...(spec.entities?.scripts ?? [])])];
}

/**
 * The main-segment memory the monster/NPC entity scripts read, at a new
 * game: `EN1.FIC` cut into the title's read list (`entities.en1`, MAIN's
 * `cfreadb` run, file order) plus the zeroed scratch blocks. Keyed by start
 * address, for `IsharScene.memory`.
 */
export function isharEntityMemory(spec: IsharTitleSpec, en1: Uint8Array): Record<number, Uint8Array> {
  const out: Record<number, Uint8Array> = {};
  const e = spec.entities;
  if (!e) return out;
  let o = 0;
  for (const [addr, len] of e.en1 ?? []) {
    out[addr] = en1.slice(o, o + len);
    o += len;
  }
  for (const [addr, len] of e.scratch ?? []) out[addr] = new Uint8Array(len);
  return out;
}

/**
 * `EN1.FIC` as each title's MAIN reads it (one `cfopen`, then a run of
 * `cfreadb addr len` in file order): Ishar 1 MAIN `+0x4a9e` (28 reads,
 * 3,640 B), Ishar 2 `+0x3e22` (29 reads, 6,050 B), Ishar 3 `+0x4bcd`
 * (29 reads, 6,050 B; its write twin is `+0x4aec`). Checked against the
 * decoded MAIN by `ishar-entities.test.ts`.
 */
export const ISHAR1_EN1_READS: ReadonlyArray<readonly [number, number]> = [[6520, 140], [6662, 140], [6804, 140], [6946, 140], [7088, 140], [7798, 70], [7870, 70], [7942, 70], [8014, 70], [8086, 70], [8158, 70], [8230, 70], [8660, 70], [8302, 70], [8376, 210], [8588, 70], [7230, 140], [7514, 140], [7656, 140], [7372, 140], [8734, 210], [13978, 140], [8946, 70], [5958, 560], [14608, 70], [14778, 140], [14920, 140], [15062, 140]];
export const ISHAR2_EN1_READS: ReadonlyArray<readonly [number, number]> = [[13330, 220], [13552, 220], [13774, 220], [13996, 220], [14218, 220], [15550, 110], [15662, 110], [15774, 110], [15886, 110], [15998, 110], [16110, 110], [16222, 110], [16892, 110], [16334, 110], [16448, 330], [16780, 110], [14662, 220], [15106, 220], [15328, 220], [14884, 220], [17006, 330], [14440, 220], [17338, 110], [12228, 1100], [17562, 110], [17674, 220], [17896, 220], [18118, 220], [20300, 110]];
export const ISHAR3_EN1_READS: ReadonlyArray<readonly [number, number]> = [[7714, 220], [7940, 220], [8166, 220], [8392, 220], [8618, 220], [9974, 110], [10090, 110], [10206, 110], [10322, 110], [10438, 110], [10554, 110], [10670, 110], [11356, 110], [10786, 110], [10904, 330], [11240, 110], [9070, 220], [9522, 220], [9748, 220], [9296, 220], [11474, 330], [8844, 220], [11810, 110], [6608, 1100], [12042, 110], [12158, 220], [12384, 220], [12610, 220], [15256, 110]];

/** The monster table from entity memory blocks (`isharEntityMemory`, keyed by main address); null if a block is missing. */
export function ishar1MonsterTableFromMemory(mem: Readonly<Record<number, Uint8Array>>): Ishar1MonsterTable | null {
  if (!Object.values(ISHAR1_MONSTER_ARRAYS).every((a) => mem[a.addr])) return null;
  return readMonsterArrays((k) => mem[ISHAR1_MONSTER_ARRAYS[k].addr]!, 'dump');
}

/** GERDEP `+0x1584`'s per-slot test, as an occupancy predicate. */
export function ishar1Occupancy(t: Ishar1MonsterTable): IsharOccupancy {
  const at = new Set<string>();
  for (let i = ISHAR1_MONSTER_FIRST_SLOT; i < ISHAR1_MONSTER_SLOTS; i++) {
    if (t.hp[i]! > 0 && t.kind[i]! < 0 && t.z[i] === 0) at.add(`${t.region[i]}:${t.row[i]}:${t.col[i]}`);
  }
  return (region, row, col) => at.has(`${region}:${row}:${col}`);
}

/**
 * Cells inside the attack range of a placed monster (slots 28..59 that
 * pass the step test's blocking rule). GEREN's monster loop (`+0x27`)
 * lets such a monster attack the party when both |row - row'| and
 * |col - col'| are below a range GEREN `+0xe5e` sets to 5 or 6 (by the
 * region code mod 10). Measured in the oracle for slot 48 (CONT4 40,15):
 * it hits at a distance of 5 on either axis and never at 6, and its first
 * hit (up to 18) kills the new-game party (Aramir alone, 12 hp). Route
 * planners use this to walk around such monsters; the game itself does
 * not refuse those cells.
 */
export function ishar1Danger(t: Ishar1MonsterTable, range = 5): IsharOccupancy {
  const guards: Array<[number, number, number]> = [];
  for (let i = ISHAR1_MONSTER_FIRST_SLOT; i < 60; i++) {
    if (t.hp[i]! > 0 && t.kind[i]! < 0 && t.z[i] === 0) guards.push([t.region[i]!, t.row[i]!, t.col[i]!]);
  }
  return (region, row, col) => guards.some(([g, r, c]) => g === region && Math.abs(r - row) <= range && Math.abs(c - col) <= range);
}

/**
 * Ishar 1 GERDEP `+0xc38` (the step test every move calls; the horizontal
 * moves set the target `0x3fd0`/`0x3fd1` at `+0xbe0`, the vertical ones at
 * `+0x934`/`+0xa8a` after any region change):
 * - nobody in the party alive (`0x3908`/`0x1542`/`0x15ec`, 5 slots): refused;
 * - target -25..-1 and -43..-40: refused (doors, locks, buildings: a
 *   forward press there opens the building or prints a message instead);
 * - -80 / -81 / -82: passages (`+0x101c..+0x11be`) that move the party;
 *   -82 (CONT5 50,49) leads to region 6;
 * - any other negative target: refused (`+0x11c3`);
 * - a monster on the target: refused (`+0x1584`). Slots 28..69 of the
 *   EN1 table with hp > 0, the target's region code, kind < 0 and z = 0
 *   (`occupied`, `ishar1Occupancy`). These are the static guards (CONT3
 *   9,26 on the causeway is slot 46) and the roaming monsters ENCONT
 *   spawns into slots 60+, which follow the party.
 * Not ported, because no cell the party can stand on reaches it: the
 * side-wall switch on the current cell (`+0x11d5`, codes -46..-8, which
 * calls the gate check `+0x1629` on PARAM's 50-entry (row, col, open)
 * table at `0x3c00`/`0x3c34`/`0x3b64`, skipped when `0x41e7` = 1). Every
 * negative target is refused before it, and the passage destinations are
 * -80/-81 cells. Its twin on the target cell (`+0x13a9`) is unreachable for
 * the same reason. Applying the gate table to plain cells refuses steps
 * the game allows (oracle walk).
 */
export function isharEnter(to: IsharPartyState, v: number, occupied?: IsharOccupancy, from?: IsharPartyState): IsharPartyState | null {
  // A passage sets the position, and then the move itself still applies
  // (GERDEP adds the step to 0x137c/0x137d after the test, e.g. `+0x5d8`,
  // `+0x9d2`): oracle, CONT5 cave (49,19) east onto the -81 at (49,20)
  // lands on (36,27), one east of the table's (36,26).
  const dr = from && Math.abs(to.row - from.row) === 1 ? to.row - from.row : 0;
  const dc = from ? to.col - from.col : 0;
  if (v === -80 || v === -81) {
    const dest: Record<number, readonly [number, number]> = v === -80
      ? { 1: [17, 67], 3: [45, 24], 4: [50, 50], 15: [36, 26] }
      : { 1: [21, 14], 3: [4, 52], 4: [46, 13], 15: [49, 20] };
    const d = dest[to.region];
    return d ? { ...to, row: d[0] + dr, col: d[1] + dc } : null;
  }
  if (v === -82) return { ...to, region: 6, row: 20 + dr, col: 71 + dc };
  if (v < 0) return null;
  if (occupied?.(to.region, to.row, to.col)) return null;
  return to;
}

/**
 * MAIN's cave and town gateways (the per-step position checks at MAIN
 * `+0xfb3..+0x149c`, reached from the region switch `+0xe41`). Each one is a
 * fixed (row, col) on a CONT grid. Standing on the inner cell with the plain
 * region code calls `+0x3039` (caves: code + 10, flag `0x4255` = 1) or
 * `+0x306b` (towns: code + 10, flag `0x4256` = 1). Standing on the outer cell
 * with the +10 code calls `+0x3052`/`+0x3081`, which subtract 10 again. Both
 * then reload the region's scene group (`+0x188d`, `+0x1c88`).
 *
 * | code | inner cell | outer cell | what |
 * |---|---|---|---|
 * | 2 <-> 12 | CONT2 (27,37), value 80 | (27,38) | cave |
 * | 5 <-> 15 | CONT5 (13,24), value 81 | (12,24) | cave (TELEP.DO asks a manual word first) |
 * | 3 <-> 13 | CONT3 (18,73) and (32,57) | (17,73) and (32,56) | town |
 * | 4 <-> 14 | CONT4 (26,72) and (33,65) | (25,72) and (33,64) | town |
 *
 * There is no CONT1 cave or town: code 11 has no arm. The outer cells hold
 * the gate values 80/81 (caves) and 109/110 (towns).
 */
export const ISHAR1_PORTALS: ReadonlyArray<{ code: number; inner: readonly [number, number]; outer: readonly [number, number]; kind: 'cave' | 'town' }> = [
  { code: 2, inner: [27, 37], outer: [27, 38], kind: 'cave' },
  { code: 5, inner: [13, 24], outer: [12, 24], kind: 'cave' },
  { code: 3, inner: [18, 73], outer: [17, 73], kind: 'town' },
  { code: 3, inner: [32, 57], outer: [32, 56], kind: 'town' },
  { code: 4, inner: [26, 72], outer: [25, 72], kind: 'town' },
  { code: 4, inner: [33, 65], outer: [33, 64], kind: 'town' },
];

/** The region code after a step onto `to` (MAIN's gateway checks, `ISHAR1_PORTALS`). */
export function ishar1RegionPortal(_from: IsharPartyState, to: IsharPartyState): IsharPartyState {
  for (const p of ISHAR1_PORTALS) {
    if (to.region === p.code && to.row === p.inner[0] && to.col === p.inner[1]) return { ...to, region: p.code + 10 };
    if (to.region === p.code + 10 && to.row === p.outer[0] && to.col === p.outer[1]) return { ...to, region: p.code };
  }
  return to;
}

/**
 * Doors and gates inside the caves (region code >= 10), measured in the
 * oracle against PARAM's door table (`0x3c00` row, `0x3c34` col, `0x3b64`
 * open), whose flags the walk poked one by one:
 * - a cell holding 50..69 has a door on one edge, (value - 50) mod 4 =
 *   north / south / west / east. Crossing that edge, out of the cell or
 *   into it, is refused while the door is shut. Seen: CONT5 (16,24) = 51
 *   refuses the step south out of it; (30,33) = 53 refuses the step into
 *   it from the east.
 * - a cell holding 82..85 is a gate: stepping onto it is refused while it
 *   is shut (CONT5 34,11 / 38,13 / 40,13 / 41,12).
 * A door cell with no table entry never blocks. GERDEP's side-wall arms
 * (`+0x11d5`/`+0x13a9`, which call the gate check `+0x1629`) have the same
 * north/south/west/east order. How the cave cell values reach those arms
 * is not traced.
 */
export function ishar1DoorShut(
  from: IsharPartyState,
  to: IsharPartyState,
  cell: (region: number, row: number, col: number) => number,
  open: readonly number[],
): boolean {
  if (from.region < 10 || to.region !== from.region) return false;
  const rows = ISHAR1_DOOR_ROWS;
  const cols = ISHAR1_DOOR_COLS;
  const shut = (row: number, col: number) => {
    for (let i = 0; i < rows.length; i++) if (rows[i] === row && cols[i] === col) return (open[i] ?? 0) === 0;
    return false;
  };
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  // the edge (N, S, W, E) a step crosses, seen from each side
  const side = (r: number, c: number) => (r < 0 ? 0 : r > 0 ? 1 : c < 0 ? 2 : 3);
  const edgeDoor = (row: number, col: number, edge: number) => {
    const v = cell(from.region, row, col);
    return v >= 50 && v <= 69 && (v - 50) % 4 === edge && shut(row, col);
  };
  if (edgeDoor(from.row, from.col, side(dr, dc)) || edgeDoor(to.row, to.col, side(-dr, -dc))) return true;
  const g = cell(to.region, to.row, to.col);
  return g >= 82 && g <= 85 && shut(to.row, to.col);
}

/**
 * The PARAM door (or gate) the party faces inside a cave, or -1: a door on
 * the facing edge of the party's own cell, a door on the near edge of the
 * cell in front, or a gate (82..85) in front (the edge rule of
 * `ishar1DoorShut`).
 */
export function ishar1FacingDoor(st: IsharPartyState, cell: (region: number, row: number, col: number) => number): number {
  if (st.region < 10) return -1;
  const raw = ISHAR1_TITLE.facingRaw[st.facing];
  // facing -> step and the edge it crosses (N, S, W, E = 0..3)
  const [dr, dc, edge] = raw === 4 ? [-1, 0, 0] : raw === 2 ? [1, 0, 1] : raw === 1 ? [0, -1, 2] : [0, 1, 3];
  const index = (row: number, col: number) => {
    for (let i = 0; i < ISHAR1_DOOR_ROWS.length; i++) if (ISHAR1_DOOR_ROWS[i] === row && ISHAR1_DOOR_COLS[i] === col) return i;
    return -1;
  };
  const door = (v: number, e: number) => v >= 50 && v <= 69 && (v - 50) % 4 === e;
  if (door(cell(st.region, st.row, st.col), edge)) {
    const i = index(st.row, st.col);
    if (i >= 0) return i;
  }
  const fr = st.row + dr;
  const fc = st.col + dc;
  const w = cell(st.region, fr, fc);
  if (door(w, edge ^ 1) || (w >= 82 && w <= 85)) return index(fr, fc);
  return -1;
}

/**
 * Whether the party can open PARAM door `index` by clicking it (PCAVE):
 * PCAVE gives a door a click form (`cforme`, `+0xb0`) only when it is in
 * the adjacent cell and its index is below 24 or above 40. Message 19 to
 * that entity (PCAVE's interrupt handler `+0x20` -> `+0x1c4`) sets the
 * door's PARAM flag `0x3b64` and plays the door sound. Doors 24..40 have
 * no click form: the levers drive them (message 20, `+0x213`, a switch
 * per lever that writes `0x3b64`/`0x3b98`). Door 40 is checked at
 * `+0x120` instead: facing it from the adjacent cell (|x| < 20), PCAVE
 * looks for item -24 in inventory column 11 (`0x1568`) of a living party
 * member (hp `0x1542`) and starts MESSAGEI (id 14) with message 18 when
 * one holds it, 17 when none does.
 */
export function ishar1DoorClickable(index: number): boolean {
  return index >= 0 && (index < 24 || index > 40);
}

/** PARAM's door table (new game; static in every oracle run): row and column of 41 doors and gates. */
export const ISHAR1_DOOR_ROWS: readonly number[] = [49, 27, 29, 30, 25, 20, 40, 42, 0, 31, 20, 16, 33, 22, 23, 19, 29, 37, 51, 38, 44, 33, 27, 25, 34, 34, 36, 36, 38, 38, 40, 40, 35, 37, 39, 41, 40, 40, 45, 45, 50];
export const ISHAR1_DOOR_COLS: readonly number[] = [58, 14, 24, 33, 38, 42, 28, 34, 0, 51, 53, 24, 20, 35, 25, 28, 58, 50, 27, 23, 13, 31, 32, 31, 11, 13, 11, 13, 11, 13, 11, 13, 12, 12, 12, 12, 29, 27, 40, 42, 54];

/** The monster and NPC scripts ENCONT `clive`s (by header id; the `+0x52a`/`+0x584` switches). */
export const ISHAR1_ENTITY_SCRIPTS: readonly string[] = ['ORC', 'LOUP', 'KNIGHT', 'AZAL', 'NAIM', 'BARBARE', 'KIRIELA', 'BORMIN', 'DEALER', 'WIZ1', 'MORGU', 'WARDOG', 'DRAGON', 'DWARRIOR', 'GEANT', 'GOUL', 'KROG', 'MEDUS', 'MINOTOR', 'MOMO', 'MONSTRE', 'PREDATOR', 'SAUB', 'SKELET', 'SPECTRE', 'SPIDER', 'ZOMBI', 'DARKM', 'DARKWIZ', 'SORCIER', 'FRAGORN', 'EN1', 'PABO', 'GAZ'];

/** FOND.DO `+0x68`: `cpalette 8` on its first resume. */
const FOND_PALETTE = { script: 'FOND', slot: 8 } as const;

export const ISHAR1_TITLE: IsharTitleSpec = {
  game: 'ishar',
  stride: 90,
  rows: 54,
  globals: { row: 0x137c, col: 0x137d, facing: 0x137e },
  facingRaw: [1, 2, 3, 4],
  gridA: 0x80,
  gridB: 0x234a,
  // PARAM's door table (new-game values, read back from the oracle): row,
  // col and open flag of 41 doors and gates. The cave scripts (MCAVE)
  // read it to draw each door open or shut; GERDEP's gate check
  // `+0x1629` reads the same arrays.
  tables: {
    0x3c00: ISHAR1_DOOR_ROWS,
    0x3c34: ISHAR1_DOOR_COLS,
    0x3b64: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0],
    // a second PARAM (row, col) list, 22 entries (MCAVE draws something at each; levers?)
    0x3c68: [0, 28, 25, 25, 25, 51, 49, 49, 39, 39, 0, 0, 33, 23, 35, 37, 39, 41, 39, 35, 40, 45],
    0x3c9c: [0, 55, 52, 54, 56, 33, 33, 35, 15, 17, 0, 0, 35, 32, 11, 11, 11, 11, 13, 13, 28, 41],
  },
  // oracle `S 14 x=0 y=0 w=255 h=125`
  screen: { xCenter: 127, horizonY: 86, width: 256, height: 126 },
  mainGlobals(s) {
    return {
      0x137c: s.row,
      0x137d: s.col,
      0x137e: this.facingRaw[s.facing],
      0x1508: s.region,
      0x3646: 54 * ((s.region % 10) - 1) + s.row,
      0x3696: 1,
      // the EN1 slot count ENCONT and GERDEP scan up to
      0x3697: ISHAR1_MONSTER_SLOTS,
    };
  },
  sceneGroup(region) {
    // MAIN +0x188d / +0x1c88: cswitch2 on the region code (base -1).
    switch (region) {
      case 1: case 3: case 4:
        // fond, rplaine, plaine, arbre (+ samb: ambience, never drawn); the
        // zone add-ons (addOns below) come and go on top of these.
        return { scripts: ['FOND', 'RPLAINE', 'PLAINE', 'ARBRE'], paletteFrom: FOND_PALETTE };
      case 2: case 5:
        return { scripts: ['FOND', 'RPLAINE', 'FORET', 'FBUIS'], paletteFrom: FOND_PALETTE };
      case 6:
        return { scripts: ['FTEMPLE', 'TEMPLE'], paletteFrom: { script: 'FTEMPLE', slot: -1 } };
      case 13: case 14:
        return { scripts: ['FVILLE', 'VILLE', 'FONTAINE'], paletteFrom: { script: 'FVILLE', slot: -1 } };
      case 12: case 15:
        // the CONT2 and CONT5 caves (ISHAR1_PORTALS): oracle start order.
        // MCAVE starts PCAVE (the doors) itself.
        return { scripts: ['MCAVE', 'FCAVE2', 'SCAVE', 'COLCAVE'], paletteFrom: { script: 'FCAVE2', slot: -1 } };
      default:
        return null;
    }
  },
  // GERDEP +0x1baf: cswitch2 on the region code, then per-region gate rules
  // (e.g. region 1: col >= 46 in zone 0 -> zone 1; col < 46 in zone 1 -> 0;
  // (25,60) in zone 1 -> 3 ...), all ending at +0x1d34 / +0x2278.
  sceneScripts: ['FOND', 'RPLAINE', 'PLAINE', 'ARBRE', 'FORET', 'FBUIS', 'LACUSTRE', 'VILLAGE', 'RAMPART', 'INVILLE', 'FTEMPLE', 'TEMPLE', 'FVILLE', 'VILLE', 'FONTAINE', 'MCAVE', 'PCAVE', 'FCAVE2', 'SCAVE', 'COLCAVE', 'INCAVE'],
  // ENCONT (started once by MAIN, woken by GERDEP every step): kills its
  // monster entities, then for each EN1 slot 28..69 in the party's region
  // (`0x3910`) with hp > 0 (`0x1b22`) up to 6 cells ahead and no farther to
  // the side than ahead (rows `0x1978`, cols `0x1a06`), `clive`s the
  // slot's script (by slot 28..32, else by species `0x1ebe`) and passes it
  // x, depth (99 per cell, -5 outdoors) and height through `shimw`. The
  // monster script puts its own sprite by depth (BORMIN `+0x78`: slot 6 +
  // depth/100). A monster right in front takes one of three front-row
  // places (`0x3d54`: x -65 / 0 / 57); the others spread by a hash of the
  // slot number (`oprnd`, `+0x500`).
  entities: {
    persistent: ['ENCONT'],
    scripts: ISHAR1_ENTITY_SCRIPTS,
    en1: ISHAR1_EN1_READS,
    scratch: [[0x3d54, 3]],
  },
  gridBuffers: 'ishar1-pairs',
  stepFrom(st, dir) {
    let { region, row, col } = st;
    const raw = this.facingRaw[dir];
    if (raw === 1) col--;
    else if (raw === 3) col++;
    else if (raw === 2) row++;
    else row--;
    if (col < 0 || col >= this.stride) return null;
    const code = region % 10;
    if (row >= this.rows) {
      if (code >= 6) return null;
      region++;
      row = 0;
    } else if (row < 0) {
      if (code <= 1) return null;
      region--;
      row = this.rows - 1;
    }
    return { ...st, region, row, col };
  },
  enter(from, to, cell, occupied) {
    if (ishar1DoorShut(from, to, cell, from.tables?.[0x3b64] ?? this.tables![0x3b64]!)) return null;
    const r = isharEnter(to, cell(to.region, to.row, to.col), occupied, from);
    return r && ishar1RegionPortal(from, r);
  },
  zone: { script: 'GERDEP', entry: 0x1baf, exits: [0x1d34, 0x2278], addr: 0x3eac, prevRegionLocal: 25 },
  addOns(region, zone, st) {
    // MAIN +0xe41 (cswitch2 on the region code) and the loaders it calls:
    // +0x31b2 lacustre, +0x3097 village (unloads lacustre/rampart/inville),
    // +0x3127 rampart + inville (unloads village).
    switch (region) {
      case 2:
        // MAIN +0x1031 / +0x1070 (flag 0x425a): INCAVE, the CONT2 cave
        // mouth's facade, starts in zone 4 west of col 47 on rows 26..28 and
        // goes away above row 24 or below row 30 (in between it stays as it was).
        if (zone !== 4 || st.col >= 47) return null;
        if (st.row > 25 && st.row < 29) return ['INCAVE'];
        if (st.row < 24 || st.row > 30) return [];
        return null;
      case 5:
        // MAIN +0x11e4 / +0x121a: INCAVE at CONT5 cols 23..25 south of row 6
        // (the corridor down to the (13,24) cave mouth).
        return st.col >= 23 && st.col <= 25 && st.row > 6 ? ['INCAVE'] : [];
      case 1:
        if (zone === 0) return ['LACUSTRE'];
        if (zone >= 1 && zone <= 3) return ['VILLAGE'];
        return null;
      case 3:
        if (zone === 9 || zone === 11) return ['RAMPART', 'INVILLE'];
        if (zone === 7) return ['VILLAGE'];
        if (zone === 8 || zone === 10 || zone === 13) return [];
        return null;
      case 4:
        if (zone === 17 || zone === 18) return ['RAMPART', 'INVILLE'];
        if (zone === 12 || zone === 14) return ['VILLAGE'];
        if (zone === 15) return [];
        return null;
      default:
        return null;
    }
  },
};

/**
 * Ishar 2. Party globals row `0x2ab4`, col `0x2ab5`, facing `0x2ab6`
 * (1..4); region code `0x2d18` (MAIN's scene switches, e.g. `+0x1795`);
 * day phase `0x519f` (1 in every oracle run; FOND1 `+0xe1` picks palette
 * slot 3/4/5 for phase 1/2/3) and `0x4a80` (copied into each backdrop's
 * local -2, 1 in every run). One CONT file holds both grids: layer 0 at
 * `basemain+0x80`, layer 1 at `+0x159c`.
 */
/**
 * Ishar 2's travel destinations (MAIN `+0xee6`): a message to MAIN stores
 * its value in `0x51bf` (`+0x374`, `cstore oscan`) and starts `+0xede`,
 * whose `cswitch2` (base 3) sets row `0x2ab4`, col `0x2ab5`, region code
 * `0x2d18`, zone `0x4ef2` and raw facing `0x2ab6`, then reloads the scene.
 * Selector -3 returns to the position saved in `0x4fd1`/`0x5074`/`0x5075`/
 * `0x5076` (GESORT sends it: a recall spell); selector 0 has no arm. Which
 * script sends the island selectors (the boat trip) is not traced yet.
 */
export const ISHAR2_TRAVEL: ReadonlyArray<{ selector: number; region: number; row: number; col: number; zone: number; facingRaw: number }> = [
  { selector: -2, region: 3, row: 54, col: 26, zone: 19, facingRaw: 2 },
  { selector: -1, region: 7, row: 5, col: 21, zone: 51, facingRaw: 2 },
  { selector: 1, region: 1, row: 2, col: 53, zone: 3, facingRaw: 2 },
  { selector: 2, region: 4, row: 48, col: 56, zone: 25, facingRaw: 3 },
  { selector: 3, region: 4, row: 21, col: 9, zone: 6, facingRaw: 2 },
  { selector: 4, region: 4, row: 76, col: 3, zone: 8, facingRaw: 1 },
  { selector: 5, region: 3, row: 3, col: 55, zone: 23, facingRaw: 2 },
  { selector: 6, region: 2, row: 28, col: 51, zone: 54, facingRaw: 1 },
  { selector: 7, region: 5, row: 10, col: 46, zone: 30, facingRaw: 2 },
  { selector: 8, region: 6, row: 11, col: 45, zone: 41, facingRaw: 2 },
];

/**
 * Ishar 2's zone add-ons: the scripts MAIN `clive`s for each sub-zone
 * `0x4ef2`, in its order. Read off MAIN's two starter switches, `+0x2156`
 * (`cswitch2` base -1, zones 1..52) and `+0x24ce` (base -10, zones 10..58);
 * every arm is a run of `clive id` until the jump out. Zone 35 adds DJCOL
 * (`+0x2616`). Names follow MAIN's own `cload` list (`+0x1928..`): id 81 is
 * `vdec1.AO` (VLINGE.DO carries the same header id). Checked against MAIN's
 * bytes in `ishar2-travel.test.ts`, and against the oracle's arrival runs
 * (zone 19 VJAIL + VILLE, 23 VARCHE + VPORT + VDEC1, 51 FDJCAT + DJCAT).
 */
export const ISHAR2_ZONE_ADDONS: Readonly<Record<number, readonly string[]>> = {
  1: ['VILLAGE1'], 3: ['BOAT'], 5: ['FORET1'], 9: ['FORET1'],
  10: ['VARCHE', 'VARCADE', 'VDEC1'], 11: ['VARCHE', 'VILLE', 'VPONT'], 12: ['VHOUSE1', 'VILLE', 'VDEC1'],
  13: ['VHOUSE1', 'VMAIRIE', 'VPASSAGE', 'VDEC1'], 14: ['VARCHE', 'VILLE', 'VPONT'], 15: ['VARCHE', 'VARCADE', 'VDEC1'],
  16: ['VARCHE', 'VILLE', 'VPASSAGE'], 17: ['VHOUSE1', 'VARCHE', 'VPASSAGE', 'VDEC2'], 18: ['VNIGHT', 'VARCHE'],
  19: ['VJAIL', 'VILLE'], 20: ['VHOUSE1', 'VTEMPLE'], 21: ['VHOUSE1', 'VMAIRIE', 'VPASSAGE'], 22: ['VHOUSE1', 'VBIBLI', 'VDEC3'],
  23: ['VARCHE', 'VPORT', 'VDEC1'], 24: ['DJCAT', 'FDJCAT'], 30: ['FDJCAT', 'DJCAT'], 31: ['FDJ1', 'DJ1'], 32: ['DJDEC', 'FDJ1', 'DJ1'],
  33: ['FDJ1', 'DJ1'], 34: ['FDJ1', 'DJ1'], 35: ['DJDEC', 'FDJ2', 'DJ2', 'DJCOL'], 36: ['FDJCAT', 'DJCAT'], 37: ['FDJ1', 'DJ1'],
  38: ['FDJCAT', 'DJCAT'], 39: ['FDJ1', 'DJ1'], 40: ['FDJCAT', 'DJCAT'], 41: ['FDJCAT', 'DJCAT'], 42: ['FDJ1', 'DJ1'], 43: ['FDJ1', 'DJ1'],
  44: ['DJDEC', 'FDJ1', 'DJ1'], 45: ['FDJ2', 'DJ2'], 46: ['DJDEC', 'FDJ2', 'DJ2'], 47: ['DJDEC', 'FDJ2', 'DJ2'], 48: ['FDJ2', 'DJ2'],
  49: ['DJDEC', 'FDJ2', 'DJ2'], 50: ['FDJ2', 'DJ2'], 51: ['FDJCAT', 'DJCAT'], 52: ['DJDEC', 'FDJ1', 'DJ1'], 53: ['FDJCAT', 'DJCAT'], 58: ['FDJ1', 'DJ1'],
};

/** Ishar 2's door flags (one byte per door index - 60; 0 = shut), GERDEP `+0x12a9`. */
export const ISHAR2_DOOR_TABLE = 0x4aa4;

/** Raw direction of a step (1 = col-1, 2 = row+1, 3 = col+1, 4 = row-1), or 0. */
function stepDirRaw(from: IsharPartyState, to: IsharPartyState): number {
  if (to.col === from.col - 1) return 1;
  if (to.row === from.row + 1) return 2;
  if (to.col === from.col + 1) return 3;
  if (to.row === from.row - 1) return 4;
  return 0;
}

/** Ishar 2 dungeon door codes (layer 0) -> the cell edge holding the door, as a raw direction (GERDEP `+0xf33`/`+0x10ed`). */
function ishar2DoorSide(v: number): number {
  if ([38, 39, 57, 70, 71].includes(v)) return 3;
  if ([40, 41, 56, 72, 73].includes(v)) return 2;
  if ([42, 43, 55, 74, 75, 84].includes(v)) return 1;
  if ([44, 45, 54, 76, 77].includes(v)) return 4;
  return 0;
}

/**
 * Ishar 2's step test, GERDEP `+0xb72` (called for every move button with
 * the target cell in local 18, the current one in 19 and their layer-1
 * values in 20/21; it clears local 22 to refuse):
 * - a negative layer-0 target is refused (`+0xe54`, `+0xf14`; -21..-18 and
 *   -5 are house doors, which send MAIN message 17 instead);
 * - region 4: a layer-1 target above 87 is refused (`+0xbbe`, a message);
 * - region 1: a monster (EN1 slots 50.., in the party's zone, kind < 0 or
 *   99) on the target refuses it (`+0xc14`);
 * - elsewhere a monster with hp in the party's own cell refuses the move
 *   toward the side its type names (`+0xc8b`, `cswitch2` on `0x35ce`: type
 *   1..4 = raw direction 1..4);
 * - regions 5-7 (the dungeons): a door code on either cell (`+0xf33` current,
 *   `+0x10ed` target) puts a door on one edge; crossing it reads the door
 *   index from that cell's layer 1 and is refused when the index is above
 *   60 and the flag `0x4aa4[index - 60]` is 0 (`+0x12a9`).
 * The party check (`+0xb7c`, a living member) is not modelled.
 */
export function ishar2Enter(
  from: IsharPartyState,
  to: IsharPartyState,
  cell: (region: number, row: number, col: number) => number,
  occupied?: IsharOccupancy,
  cellB?: (region: number, row: number, col: number) => number,
  doors?: readonly number[],
): IsharPartyState | null {
  const vt = cell(to.region, to.row, to.col);
  if (vt < 0) return null;
  const bt = cellB?.(to.region, to.row, to.col) ?? 0;
  if (from.region === 4 && bt > 87) return null;
  const dir = stepDirRaw(from, to);
  if (from.region === 1) {
    if (occupied?.(to.region, to.row, to.col)) return null;
  } else if (occupied?.(from.region, from.row, from.col, dir)) return null;
  if (from.region > 4 && cellB) {
    const shut = (idx: number) => idx > 60 && (doors?.[idx - 60] ?? 0) === 0;
    const vf = cell(from.region, from.row, from.col);
    if (ishar2DoorSide(vf) === dir && shut(cellB(from.region, from.row, from.col))) return null;
    const opposite = [0, 3, 4, 1, 2][dir]!;
    if (ishar2DoorSide(vt) === opposite && shut(bt)) return null;
  }
  return to;
}

/**
 * GERDEP's monster tests (Ishar 2 `+0xc14`/`+0xc8b`) over EN1 slots 50..109:
 * zone `0x449a`, row `0x3412`, col `0x34f0`, hp `0x36ac`, kind `0x43ba`,
 * type `0x35ce` (words where noted). `zone` is the party's zone `0x4ef2`.
 */
export function ishar2Occupancy(read: (addr: number, len: number) => Uint8Array | undefined, zone: number): IsharOccupancy | undefined {
  const w = (a: Uint8Array, i: number) => (((a[2 * i]! << 8) | a[2 * i + 1]!) << 16) >> 16;
  const b = (a: Uint8Array, i: number) => (a[i]! << 24) >> 24;
  const zs = read(0x449a, 110), rows = read(0x3412, 220), cols = read(0x34f0, 220), hp = read(0x36ac, 220), kind = read(0x43ba, 110), type = read(0x35ce, 220);
  if (!zs || !rows || !cols || !hp || !kind || !type) return undefined;
  const target = new Set<string>();
  const side = new Map<string, Set<number>>();
  for (let i = 50; i < 110; i++) {
    if (b(zs, i) !== zone) continue;
    const k = b(kind, i);
    if (!(k < 0 || k === 99)) continue;
    const key = `${w(rows, i)},${w(cols, i)}`;
    target.add(key);
    if (w(hp, i) !== 0) (side.get(key) ?? side.set(key, new Set()).get(key)!).add(w(type, i));
  }
  return (_region, row, col, dir) => (dir === undefined ? target.has(`${row},${col}`) : !!side.get(`${row},${col}`)?.has(dir));
}

/**
 * Ishar 3's GERDEP `+0xf13`: EN1 slots 60..109 whose location `0x2f0a` is
 * the party's (`0x3b33`), standing in the party's own cell (row `0x1e22`,
 * col `0x1f04`, words) with kind `0x2e22` < 0 or 99, or `0x3b98` < 0, refuse
 * the move toward the side their type `0x1fe6` names (a raw facing:
 * 1, 2, -1, -2; `cswitch2` base 2). No hp test. Without `dir`: GERDEP
 * `+0xe93`, the forest's target test (same slots, location and kind, no
 * `0x3b98` alternative), standing on the cell.
 */
export function ishar3Occupancy(read: (addr: number, len: number) => Uint8Array | undefined, location: number): IsharOccupancy | undefined {
  const w = (a: Uint8Array, i: number) => (((a[2 * i]! << 8) | a[2 * i + 1]!) << 16) >> 16;
  const b = (a: Uint8Array, i: number) => (a[i]! << 24) >> 24;
  const loc = read(0x2f0a, 110), rows = read(0x1e22, 220), cols = read(0x1f04, 220), kind = read(0x2e22, 110), flag = read(0x3b98, 110), type = read(0x1fe6, 220);
  if (!loc || !rows || !cols || !kind || !flag || !type) return undefined;
  const side = new Map<string, Set<number>>();
  const target = new Set<string>();
  for (let i = 60; i < 110; i++) {
    if (b(loc, i) !== location) continue;
    const k = b(kind, i);
    const key = `${w(rows, i)},${w(cols, i)}`;
    if (k < 0 || k === 99) target.add(key);
    if (!(k < 0 || k === 99 || b(flag, i) < 0)) continue;
    (side.get(key) ?? side.set(key, new Set()).get(key)!).add(w(type, i));
  }
  return (_region, row, col, dir) => (dir === undefined ? target.has(`${row},${col}`) : !!side.get(`${row},${col}`)?.has(dir));
}

/** Ishar 2's region groups other than the start island (MAIN `+0x16f8`); see `ISHAR2_TITLE.sceneGroup`. */
// Palettes: each outdoor backdrop picks its slot from the day phase 0x519f
// like FOND1 (FARBO +0x122, FMONT +0x144, FVILLE +0x142: phase 1/2/3 ->
// FARBO 1/3/4, FMONT 3/5/6, FVILLE 0/7/8); the dungeon backdrops carry one
// palette each (FDJCAT 0, FDJ1 2, FDJ2 1). Oracle arrival frames: FVILLE 0
// gives 100% of the Zach's Island view's pixels.
const phaseSlot = (slots: readonly [number, number, number]) => (m: (addr: number) => number) => slots[m(0x519f) - 1] ?? slots[0];
const DUNGEON_PALETTE: IsharSceneGroup['paletteFrom'] = { script: ['FDJCAT', 'FDJ1', 'FDJ2'], slot: -1 };
const ISHAR2_REGION_GROUPS: Readonly<Record<number, { scripts: readonly string[]; palette?: IsharSceneGroup['paletteFrom'] }>> = {
  2: { scripts: ['FARBO', 'ARBO'], palette: { script: 'FARBO', slot: phaseSlot([1, 3, 4]) } },
  3: { scripts: ['FVILLE', 'VHOUSE2'], palette: { script: 'FVILLE', slot: phaseSlot([0, 7, 8]) } },
  4: { scripts: ['MONTAGNE', 'FMONT'], palette: { script: 'FMONT', slot: phaseSlot([3, 5, 6]) } },
  5: { scripts: [], palette: DUNGEON_PALETTE },
  6: { scripts: [], palette: DUNGEON_PALETTE },
  7: { scripts: [], palette: DUNGEON_PALETTE },
};

export const ISHAR2_TITLE: IsharTitleSpec = {
  game: 'ishar2',
  stride: 60,
  rows: 90,
  globals: { row: 0x2ab4, col: 0x2ab5, facing: 0x2ab6 },
  facingRaw: [1, 2, 3, 4],
  gridA: 0x80,
  gridB: 0x159c,
  // oracle `S 14 x=0 y=13 w=255 h=112`; sprites project to frame y 78
  screen: { xCenter: 127, horizonY: 65, width: 256, height: 113 },
  mainGlobals(s) {
    // 0x4a81: the EN1 slot count EAFF scans up to (110 in every oracle run)
    return { 0x2ab4: s.row, 0x2ab5: s.col, 0x2ab6: this.facingRaw[s.facing], 0x2d18: s.region, 0x519f: 1, 0x4a80: 1, 0x4a81: 110 };
  },
  sceneScripts: ['FOND1', 'PLAINE1', 'VILLAGE1', 'BOAT', 'FORET1', 'FARBO', 'ARBO', 'FVILLE', 'VHOUSE2', 'MONTAGNE', 'FMONT', ...new Set(Object.values(ISHAR2_ZONE_ADDONS).flat()), 'PCAVE'],
  // EAFF, Ishar 2's ENCONT (same shape; oracle trace: GERDEP wakes it every
  // step, it kills and re-`clive`s POURS1 the bear): EN1 slots 50..109 in
  // the party's zone (`0x449a` = `0x4ef2`) with hp > 0 (`0x36ac`), rows
  // `0x34f0`, cols `0x3412`, up to 6 cells ahead; species `0x3d2e` picks
  // the script (`+0x664`), the front-row places are `0x4b80`. Two of the
  // three front places add the engine's shared random number (`ornd`,
  // `+0x51e`/`+0x550`), which crawl cannot reproduce.
  entities: {
    persistent: ['EAFF'],
    scripts: ['BOB4', 'HORNY4', 'VOLEUR3', 'DJFONT', 'ENT2', 'DRUIDE2', 'EWOK2', 'HOMOIS2', 'DWOMAN2', 'RHINO4', 'MOMY5', 'ELMTAIR5', 'SKELETT5', 'SORTMOR5', 'SORCIER5', 'CHAOSGU5', 'LIONMAN5', 'MONSTER5', 'ELMTFEU5', 'DRAGON5', 'ORK5', 'WIZARD5', 'MEDUSA5', 'WITCH5', 'DWIZARD5', 'AVEUGLE5', 'ODWOMAN5', 'DRUIDE4', 'LUTIN3', 'TROUBA3', 'KROG', 'PEOPLE2', 'PEOPLE1', 'PUIT', 'FLY1', 'GOLEM1', 'MARIN', 'POURS1', 'LEZARD1', 'WIZARD1', 'GEANT', 'RELICMAN', 'GUARD3', 'GUARD3HI', 'NAIN4', 'PIAF4', 'GUARD4'],
    en1: ISHAR2_EN1_READS,
    scratch: [[0x4b80, 3]],
  },
  gridBuffers: 'layers',
  enter(from, to, cell, occupied, cellB) {
    return ishar2Enter(from, to, cell, occupied, cellB, from.tables?.[ISHAR2_DOOR_TABLE]);
  },
  stepFrom(st, dir) {
    // Same raw-facing directions as Ishar 1 (the scripts' own facing
    // dispatch scans the same wedges); travel between CONT files is not
    // traced for Ishar 2, so the region edge blocks.
    let { row, col } = st;
    const raw = this.facingRaw[dir];
    if (raw === 1) col--;
    else if (raw === 3) col++;
    else if (raw === 2) row++;
    else row--;
    if (row < 0 || col < 0 || row >= this.rows || col >= this.stride) return null;
    return { ...st, row, col };
  },
  sceneGroup(region) {
    // Region 1 (CONT1, the start island): MAIN keeps FOND1 + PLAINE1 alive
    // (POURS1 = roaming bears, an NPC); the sub-zone add-ons come and go.
    // FOND1 +0xe1: `cpalette` 3/4/5 for day phase 0x519f = 1/2/3.
    if (region === 1) return { scripts: ['FOND1', 'PLAINE1'], paletteFrom: { script: 'FOND1', slot: (m) => [3, 3, 4, 5][m(0x519f)] ?? 3 } };
    // The other islands (MAIN +0x16f8, `clive` per region code; the oracle's
    // arrival runs list the same scripts): 2 FARBO + ARBO, 3 FVILLE +
    // VHOUSE2 (the town), 4 MONTAGNE + FMONT. Regions 5-7 start nothing of
    // their own: their dungeon walls are zone add-ons (FDJCAT/DJCAT,
    // FDJ1/DJ1, FDJ2/DJ2), and the DJ scripts start PCAVE (the doors).
    const g = ISHAR2_REGION_GROUPS[region];
    return g ? { scripts: g.scripts, ...(g.palette ? { paletteFrom: g.palette } : {}) } : null;
  },
  // GERDEP +0x162a..+0x18ff, run after each step (+0x1411) with local 20 =
  // the grid-B cell the party stepped onto: regions 2/3/5/6/7 take the zone
  // from door cells (|cell| - 40); regions 1 and 4 follow position gates
  // keyed on the current zone (e.g. region 1: zone 4 -> 1 when row < 21,
  // zone 4 -> 5 when row > 40, zone 1 -> 3 when col > 44 ...). A new game
  // starts in zone 4.
  zone: {
    script: 'GERDEP',
    entry: 0x162a,
    exits: [0x18ff],
    addr: 0x4ef2,
    locals: (st, g) => ({ 20: g.B(st.row, st.col) }),
    onMoveOnly: true,
  },
  initialZone: 4,
  addOns(_region, zone) {
    // MAIN's zone starters (+0x2156, then +0x24ce for zones 10..; table
    // `ISHAR2_ZONE_ADDONS`). Zones are numbered across all the islands. In
    // CONT1 the oracle's start/kill trace agrees: zone 1 village1, zone 3
    // boat, zones 5 and 9 foret1 (restarted on entering 9), 2 and 4 none.
    return ISHAR2_ZONE_ADDONS[zone] ?? [];
  },
  addOnRestartZones: [9],
};

/**
 * Ishar 3. Party globals row `0x257`, col `0x14b6`, facing `0x14b7` (raw
 * 1, 2, -1, -2 in "turn right" order: oracle walk, raw 1 = col-1, raw 2 =
 * row+1); grids at `0x260` (CONT layer 0) and `0x14ae` (layer 1), 57 x 82;
 * `0x3518` = 1 in a new game (each backdrop copies it to local -2). VDEC2
 * also reads the one-dimensional table at `0x15f8` (snapshot of a new
 * game). Only the start town is traced: at a new game MAIN starts the Maz
 * group (vwall, vhouse2, vhouse1, fville, vdec1, vdec2; affpv spawns the
 * townspeople, sville/sville2 draw nothing in the view).
 */
export const ISHAR3_TITLE: IsharTitleSpec = {
  game: 'ishar3',
  stride: 57,
  rows: 82,
  globals: { row: 0x257, col: 0x14b6, facing: 0x14b7 },
  facingRaw: [1, 2, -1, -2],
  gridA: 0x260,
  gridB: 0x14ae,
  coordOffsets: [0, 8, 16],
  engineVersion: 30,
  // oracle `S 82 x=0 y=13 w=255 h=112`
  screen: { xCenter: 127, horizonY: 65, width: 256, height: 113 },
  mainGlobals(s) {
    // 0x3f82/0x3f84/0x3f86: the day/night factors (256 = daylight, a new game)
    // 0x3519: the EN1 slot count EAFF scans up to; 0x3b33: the location (2 at the start, `stepMemdumps` zone)
    return { 0x257: s.row, 0x14b6: s.col, 0x14b7: this.facingRaw[s.facing], 0x3518: 1, 0x3519: 110, 0x3b33: 2, 0x3da4: 1, 0x3f82: 256, 0x3f84: 256, 0x3f86: 256 };
  },
  // MAIN +0x135b / +0x136d: `cdarkpal` with the factors in 0x3f82/0x3f84/
  // 0x3f86 on entries 1.., 15 of them when 0x3da4 = 0, else 175. MAIN steps
  // the factors through the day (oracle walk, Maz: 256/256/256 day,
  // 256/120/152 dusk, 50/64/192 night, 256/128/64 dawn).
  darken(m) {
    return { factors: [m(0x3f82), m(0x3f84), m(0x3f86)], first: 1, count: m(0x3da4) === 0 ? 15 : 175 };
  },
  tables: { 0x15f8: [0,10,3,3,4,2,1,6,1,0,1,9,9,9,10,10,1,1,0,0,0,0,0,4,0,5,5,5,5,5,5,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,8,8,8,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,7,7,7,8,8,8,8,0,0,1,1,1,1,1,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] },
  sceneScripts: ['VWALL', 'VHOUSE2', 'VHOUSE1', 'FVILLE', 'AFFPV', 'VDEC1', 'VDEC2', 'FORET', 'FFORET', 'FJUNGLE', 'JUNGLE', 'FMONT', 'MONTAGNE'],
  // EAFF (Ishar 1's ENCONT, engine 3.0) and AFFPV, the Maz townspeople:
  // 150 people with row `0x4012`, col `0x40ae`, facing `0x414a` and kind
  // `0x41e6`; AFFPV `+0x75` scans them up to 6 cells ahead and `clive`s
  // VPERSO1..5 by kind and location (`0x3b33`), passing x, depth and height
  // through `shimw` (vram 0/8/16). Their x adds the engine's shared random
  // number (`ornd`, `+0x2e3`/`+0x2f6`), which crawl cannot reproduce.
  entities: {
    persistent: ['EAFF'],
    scripts: ['VPERSO1', 'VPERSO2', 'VPERSO3', 'VPERSO4', 'VPERSO5', 'MESSAGEU', 'GUARD2', 'ZOLTAR', 'PRINCESS', 'OURS9', 'LOUP9', 'CHAOS5', 'BEE5', 'FLY5', 'OURS5', 'LEO3', 'ZOUAV3', 'REDFI7', 'WIZARD7', 'WITCH7', 'DRAGON7', 'FEE5', 'SPIDER7', 'SNAKE3', 'SLIME7', 'CHAOS7', 'SORCIER7', 'MAGE5', 'VOLEUR1', 'PLASMA7', 'GREEM5', 'SKELET7', 'GEANT9', 'LEZARD1', 'GENERAT9', 'ALSTAR', 'GUARD1', 'MOLTUS'],
    en1: ISHAR3_EN1_READS,
    // the townspeople and AFFPV's thief flags `0x3b60`; EAFF's 0x32a0/0x330c/0x36a8 (not loaded from EN1)
    scratch: [[0x4012, 618], [0x3b60, 50], [0x32a0, 110], [0x330c, 110], [0x36a8, 3]],
  },
  // MAIN +0x4a3c: CONT1-3 / CONT2-3 for the two Maz codes, then one file per
  // region pair (3/4 jungle, 5/6 forest, 7/8 dungeons, 9/10 mountains).
  contOf(region) {
    return region <= 2 ? region : Math.floor((region + 1) / 2) + 1;
  },
  sceneGroup(region) {
    // MAIN +0x16b1 (cswitch2 on the region code) loads the region's scripts:
    // 1/2 fville, affpv, vdec1, vdec2; 3/4 fjungle, jungle; 5/6 foret,
    // fforet; 7 pcave, djtrap (+ djdec2, djdec); 8 pcave; 9/10 fmont,
    // montagne. The location loader (+0x18d4) adds the Maz houses (start
    // location 2: vwall, vhouse2, vhouse1) and the dungeons' walls.
    // FVILLE `+0xfc`: `cpalette 5`.
    // AFFPV (the townspeople, after FVILLE in MAIN's load order) draws them through its children.
    if (region === 1) return { scripts: ['VWALL', 'VHOUSE2', 'VHOUSE1', 'FVILLE', 'AFFPV', 'VDEC1', 'VDEC2'], paletteFrom: { script: 'FVILLE', slot: 5 } };
    // oracle start order after a gate trip (MAIN +0x3e0f): foret, fforet
    if (region === 5 || region === 6) return { scripts: ['FORET', 'FFORET'], paletteFrom: { script: 'FFORET', slot: -1 } };
    // the jungle and the mountains, in MAIN +0x16b1's load order
    if (region === 3 || region === 4) return { scripts: ['FJUNGLE', 'JUNGLE'], paletteFrom: { script: 'FJUNGLE', slot: -1 } };
    if (region === 9 || region === 10) return { scripts: ['FMONT', 'MONTAGNE'], paletteFrom: { script: 'FMONT', slot: -1 } };
    return null;
  },
  gridBuffers: 'layers',
  // GERDEP's step test (+0xdb8 .. +0x13b7): a negative layer-0 cell refuses
  // the step except -2 (while 0x3b34 = 0, as in every oracle run); -5 in Maz
  // is a door (MAIN message 17 opens the building instead); grid-B 100 is a
  // gate (message 38, a trip: `+0xe04`). A monster standing in the party's
  // own cell (`+0xf13`, `ishar3Occupancy`) holds one side of it, like
  // Ishar 2's `+0xc8b`; the party check (`+0xdc2`) is not modelled.
  enter(from, to, cell, occupied) {
    const v = cell(to.region, to.row, to.col);
    if (v < 0 && v !== -2) return null;
    // GERDEP +0xe93: in the forest (regions 5/6) a monster on the target refuses it
    if ((from.region === 5 || from.region === 6) && occupied?.(to.region, to.row, to.col)) return null;
    // GERDEP +0xf13: a monster in the party's own cell holds the side its type names
    const dir = to.col === from.col - 1 ? 1 : to.row === from.row + 1 ? 2 : to.col === from.col + 1 ? -1 : -2;
    return occupied?.(from.region, from.row, from.col, dir) ? null : to;
  },
  stepFrom(st, dir) {
    let { row, col } = st;
    const raw = this.facingRaw[dir];
    if (raw === 1) col--;
    else if (raw === -1) col++;
    else if (raw === 2) row++;
    else row--;
    if (row < 0 || col < 0 || row >= this.rows || col >= this.stride) return null;
    return { ...st, row, col };
  },
};

/** The CONT file number `region` reads (`IsharTitleSpec.contOf`). */
export function isharContOf(spec: IsharTitleSpec, region: number): number {
  return spec.contOf ? spec.contOf(region) : region % 10;
}

/**
 * The two grid buffers as the game holds them, fed with each title's CONT
 * files (`layers(n)` = that file's layers, storage order, signed or not).
 */
export class IsharGridBuffers {
  private readonly spec: IsharTitleSpec;
  private readonly layers: (region: number) => readonly Uint8Array[] | undefined;
  /** Ishar 1: CONT number currently in each buffer (0 = nothing loaded yet). */
  private held = { A: 0, B: 0 };
  /** What a buffer holds before the first load into it (e.g. the oracle's boot-time leftovers). */
  private readonly initial: { A?: GridReader; B?: GridReader };

  constructor(spec: IsharTitleSpec, layers: (region: number) => readonly Uint8Array[] | undefined, initial: { A?: GridReader; B?: GridReader } = {}) {
    this.spec = spec;
    this.layers = layers;
    this.initial = initial;
  }

  private reader(n: number, layer = 0): GridReader {
    const bytes = n > 0 ? this.layers(n)?.[layer] : undefined;
    const stride = this.spec.stride;
    if (!bytes) return () => 0;
    return (row, col) => {
      const v = bytes[row * stride + col] ?? 0;
      return v >= 128 ? v - 256 : v;
    };
  }

  /** Update after the party arrived at `st` (MAIN's post-move loads) and return the readers. */
  update(st: IsharPartyState): { A: GridReader; B: GridReader } {
    const code = isharContOf(this.spec, st.region);
    if (this.spec.gridBuffers === 'layers') return { A: this.reader(code, 0), B: this.reader(code, 1) };
    const put = (n: number) => {
      if (n % 2 === 1) this.held.A = n;
      else this.held.B = n;
    };
    put(code);
    const worldRow = this.spec.rows * (code - 1) + st.row;
    if (st.row > 45 && worldRow < this.spec.rows * 5 + 45) put(code + 1);
    else if (st.row < 8 && worldRow > 8) put(code - 1);
    return {
      A: this.held.A ? this.reader(this.held.A) : (this.initial.A ?? (() => 0)),
      B: this.held.B ? this.reader(this.held.B) : (this.initial.B ?? (() => 0)),
    };
  }

  reset(): void {
    this.held = { A: 0, B: 0 };
  }
}

/** One drawable leaf of the current frame. */
export interface IsharSceneLeaf {
  script: string;
  /** Directory slot of the leaf bitmap in `script`. */
  index: number;
  x: number;
  y: number;
  z: number;
  numelem: number;
  invertX: boolean;
  bitmap: IsharBitmap;
  /** Global insertion sequence (ties in depth/element order by it). */
  seq: number;
}

interface LoadedScript {
  name: string;
  data: Uint8Array;
  runner: AlisScriptRunner;
  /** Started by another scene script's `clive` (its handle), not by the region group. */
  handle?: number;
}

/** Element `index` (byte or big-endian signed word) of the table at `addr`, if a block of `blocks` holds it. */
function readMemory(blocks: Readonly<Record<number, Uint8Array>> | undefined, addr: number, index: number, size: 1 | 2): number | undefined {
  if (!blocks) return undefined;
  for (const k in blocks) {
    const start = Number(k);
    const b = blocks[k]!;
    if (addr < start || addr >= start + b.length) continue;
    const o = addr - start + index * size;
    if (o < 0 || o + size > b.length) return 0;
    return size === 1 ? (b[o]! << 24) >> 24 : (((b[o]! << 8) | b[o + 1]!) << 16) >> 16;
  }
  return undefined;
}

/** Display-list order of the reference engine (see module doc). */
export function sortLeavesForDisplay<T extends { y: number; numelem: number; seq: number }>(leaves: T[]): T[] {
  return [...leaves].sort((a, b) => b.y - a.y || b.numelem - a.numelem || a.seq - b.seq);
}

export class IsharScene {
  readonly spec: IsharTitleSpec;
  private readonly load: (name: string) => Uint8Array | undefined;
  private grids: { A: GridReader; B: GridReader };
  private scripts: LoadedScript[] = [];
  private groupKey = '';
  private addOnKey = '';
  private addOnZone = -1;
  private prevPos = '';
  private state: IsharPartyState | null = null;
  private seqCounter = 0;
  private readonly seqOf = new WeakMap<object, number>();
  /** Sub-zone global (0 at the start of the game). */
  zone = 0;
  /** Region at the previous step (GERDEP's local 25 when the zone rules run). */
  private prevRegion = -1;
  private zoneRunner: AlisScriptRunner | null = null;
  readonly warnings: string[] = [];
  palette: IsharPalette | null = null;

  constructor(spec: IsharTitleSpec, load: (name: string) => Uint8Array | undefined, grids: { A: GridReader; B: GridReader }) {
    this.spec = spec;
    this.zone = spec.initialZone ?? 0;
    this.load = load;
    this.grids = grids;
  }

  /** Swap the grid buffers (region change). */
  setGrids(grids: { A: GridReader; B: GridReader }): void {
    this.grids = grids;
  }

  get scriptNames(): string[] {
    return this.scripts.map((s) => s.name);
  }

  private env(): SceneEnv {
    const st = this.state!;
    const globals: Record<number, number> = { ...this.spec.mainGlobals(st), ...st.globals, ...(this.spec.zone ? { [this.spec.zone.addr]: this.zone } : {}) };
    const { stride, rows, gridA, gridB } = this.spec;
    return {
      live: (id) => this.live(id),
      writeEntity: (h, off, v) => {
        const c = this.scripts.find((x) => x.handle === h);
        if (c) c.runner.locals.set(off, v);
      },
      readEntity: (h, off) => this.scripts.find((x) => x.handle === h)?.runner.locals.get(off) ?? 0,
      readMain: (addr) => globals[addr] ?? 0,
      writeMain: (addr, v) => {
        globals[addr] = v;
        if (this.spec.zone && addr === this.spec.zone.addr) this.zone = v;
      },
      writeTable: (addr, index, v) => {
        let t = this.written.get(addr);
        if (!t) this.written.set(addr, (t = new Map()));
        t.set(index, v);
      },
      readGrid: (addr, pop, direct, size = 1) => {
        const w = this.written.get(addr)?.get(direct);
        if (w !== undefined) return w;
        const table = st.tables?.[addr] ?? this.spec.tables?.[addr];
        if (table) return table[direct] ?? 0;
        const mem = readMemory(st.memory, addr, direct, size) ?? readMemory(this.memory, addr, direct, size);
        if (mem !== undefined) return mem;
        const row = pop();
        const col = direct;
        if (row < 0 || col < 0 || col >= stride || row >= rows) return 0;
        if (addr === gridA) return this.grids.A(row, col);
        if (addr === gridB) return this.grids.B(row, col);
        return 0;
      },
    };
  }

  private nextHandle = 0x100;
  private idNames: Map<number, string> | null = null;
  /** `smaintc` writes since the last step (ENCONT's front-row slots `0x3d54`); a step's own state tables replace them. */
  private written = new Map<number, Map<number, number>>();
  /**
   * Main-segment memory that is game state rather than scenery, as blocks
   * keyed by start address (the EN1 monster arrays, `isharEntityMemory`);
   * a party state's own `memory` overrides it. The scripts read it with
   * one-index `omaintc` (bytes) and `omainti` (big-endian words).
   */
  memory: Readonly<Record<number, Uint8Array>> = {};
  /** Run the NPC/monster entities (`spec.entities`); false = scenery only (an oracle walk that removed them). */
  npcs = true;

  /**
   * `clive id` from a scene script: start that script as a child entity
   * (e.g. MCAVE starts PCAVE, the cave doors, and passes it the door's
   * position through `shimw`). The child runs after the scripts already
   * woken this step and lives until the next step (the oracle trace:
   * COLCAVE kills PCAVE on every wake and MCAVE starts a new one).
   * Script ids are the scripts' own header ids (`id@0`), looked up among
   * `sceneScripts`.
   */
  private live(id: number): number {
    if (!this.idNames) {
      this.idNames = new Map();
      for (const n of [...this.spec.sceneScripts, ...(this.spec.entities?.scripts ?? [])]) {
        const d = this.load(n);
        if (d && d.length > 1) this.idNames.set((d[0]! << 8) | d[1]!, n);
      }
    }
    const name = this.idNames.get(id);
    if (!this.npcs && name && this.spec.entities?.scripts.includes(name)) return -1;
    const s = name ? this.create(name) : null;
    if (!s) {
      this.warnings.push(`clive of unknown script id ${id}`);
      return -1;
    }
    s.handle = this.nextHandle++;
    this.scripts.push(s);
    return s.handle;
  }

  private create(name: string): LoadedScript | null {
    const data = this.load(name);
    if (!data) {
      this.warnings.push(`scene script ${name} not available`);
      return null;
    }
    const runner = new AlisScriptRunner(data, name);
    if (this.spec.coordOffsets) runner.coordOffsets = this.spec.coordOffsets;
    if (this.spec.engineVersion) runner.version = this.spec.engineVersion;
    return { name, data, runner };
  }

  /**
   * Make the scene match `state`'s region (creating that region group's
   * scripts if it changed, which runs their start-up code) without waking
   * anything. Returns false if the region has no modelled scene.
   */
  enter(state: IsharPartyState): boolean {
    this.state = state;
    if (this.prevRegion < 0) this.prevRegion = state.region;
    if (!this.prevPos) this.prevPos = `${state.region}:${state.row},${state.col}`;
    const group = this.spec.sceneGroup(state.region);
    const key = this.groupKeyFor(state);
    if (key !== this.groupKey) {
      this.groupKey = key;
      this.addOnKey = '';
      // the game-wide entities (ENCONT) outlive the region group
      const persistent = this.npcs ? (this.spec.entities?.persistent ?? []) : [];
      const kept = this.scripts.filter((s) => s.handle === undefined && persistent.includes(s.name));
      this.scripts = [];
      this.palette = null;
      if (group) {
        const fresh: LoadedScript[] = [];
        for (const name of persistent) {
          const k = kept.find((s) => s.name === name);
          if (k) this.scripts.push(k);
          else {
            const s = this.create(name);
            if (s) {
              this.scripts.push(s);
              fresh.push(s);
            }
          }
        }
        for (const name of group.scripts) {
          const s = this.create(name);
          if (s) {
            this.scripts.push(s);
            fresh.push(s);
          }
        }
        const env = this.env();
        for (const s of fresh) s.runner.settle(env);
        this.applyAddOns();
        this.tagNewSprites();
      }
    }
    this.updatePalette();
    return group !== null;
  }

  /** The backdrop's palette for the current state (some backdrops pick their slot from a main global, e.g. Ishar 2's day phase). */
  private updatePalette(): void {
    const group = this.state ? this.spec.sceneGroup(this.state.region) : null;
    if (!group?.paletteFrom) return;
    const { script, slot } = group.paletteFrom;
    const names = typeof script === 'string' ? [script] : script;
    const pal = names.map((n) => this.scripts.find((s) => s.name === n)).find((s) => s);
    if (!pal) return;
    const env = this.env();
    const base = paletteOf(pal.data, typeof slot === 'function' ? slot(env.readMain) : slot);
    const dk = base && this.spec.darken?.(env.readMain);
    this.palette = base && dk && dk.factors.some((f) => f !== 256) ? darkenPalette(base, dk) : base;
  }

  /** Run the title's sub-zone routine for the current state (GERDEP, after every step/turn). */
  private updateZone(): void {
    const z = this.spec.zone;
    if (!z) return;
    if (!this.zoneRunner) {
      const data = this.load(z.script);
      if (!data) {
        this.warnings.push(`zone script ${z.script} not available`);
        return;
      }
      this.zoneRunner = new AlisScriptRunner(data, z.script, z.entry);
      if (this.spec.engineVersion) this.zoneRunner.version = this.spec.engineVersion;
    }
    const r = this.zoneRunner;
    r.pc = z.entry;
    r.callStack.length = 0;
    if (z.prevRegionLocal !== undefined) r.locals.set(z.prevRegionLocal, this.prevRegion);
    for (const [k, v] of Object.entries(z.locals?.(this.state!, this.grids) ?? {})) r.locals.set(Number(k), v);
    r.activate(this.env(), 10_000, new Set(z.exits));
  }

  /** Swap MAIN's zone add-on scripts to match the current zone (kills drop their sprites; new ones run their start-up code). */
  private applyAddOns(): void {
    const st = this.state!;
    const want = this.spec.addOns?.(st.region, this.zone, st);
    if (want === null || want === undefined) return;
    const restart = !!this.spec.addOnRestartZones?.includes(this.zone) && this.zone !== this.addOnZone;
    this.addOnZone = this.zone;
    const key = want.join(',');
    if (key === this.addOnKey && !restart) return;
    const base = [...(this.spec.sceneGroup(st.region)?.scripts ?? []), ...(this.spec.entities?.persistent ?? [])];
    const keep = this.scripts.filter((s) => s.handle !== undefined || base.includes(s.name) || (want.includes(s.name) && !restart));
    const have = new Set(keep.map((s) => s.name));
    const env = this.env();
    for (const name of want) {
      if (have.has(name)) continue;
      const s = this.create(name);
      if (!s) continue;
      s.runner.settle(env);
      // An add-on wins equal-depth ties against the region group (oracle,
      // CONT5 7..12,24: INCAVE's wall covers FORET's tree root at depth 99;
      // INCAVE got entity slot 13, FORET 12). Unchanged on the CONT1-4 walks.
      keep.unshift(s);
    }
    this.scripts = keep;
    this.addOnKey = key;
  }

  /** One step or turn: update the party state, run the zone rules, wake every scene script (GERDEP), let MAIN swap add-ons. */
  step(state: IsharPartyState): void {
    this.state = state;
    if (this.prevRegion < 0) this.prevRegion = state.region;
    const pos = `${state.region}:${state.row},${state.col}`;
    if (!this.spec.zone?.onMoveOnly || pos !== this.prevPos) this.updateZone();
    this.prevPos = pos;
    // On a region change GERDEP still wakes the old group, then MAIN kills it
    // and starts the new one, which is not woken until the next step (oracle
    // trace: fond woken at frame n, killed n+1, re-created n+2).
    const fresh = this.groupKeyFor(state) !== this.groupKey;
    for (const addr of Object.keys(state.tables ?? {})) this.written.delete(Number(addr));
    if (state.memory) for (const addr of [...this.written.keys()]) if (readMemory(state.memory, addr, 0, 1) !== undefined) this.written.delete(addr);
    if (this.enter(state)) {
      const env = this.env();
      this.scripts = this.scripts.filter((s) => s.handle === undefined);
      // a fresh group is not woken until the next step; the game-wide
      // entities (ENCONT) are, every step
      const persistent = this.spec.entities?.persistent ?? [];
      for (const s of this.scripts) {
        if (fresh && !persistent.includes(s.name) && s.handle === undefined) continue;
        s.runner.wake();
        s.runner.settle(env);
      }
      this.applyAddOns();
      this.tagNewSprites();
    }
    this.prevRegion = state.region;
    this.updatePalette();
  }

  /** Game state changed without a step or turn (e.g. the day phase): nothing is woken, only state-derived things (the palette) follow. */
  refresh(state: IsharPartyState): void {
    this.state = state;
    this.updatePalette();
  }

  private groupKeyFor(state: IsharPartyState): string {
    const group = this.spec.sceneGroup(state.region);
    return group ? `${isharContOf(this.spec, state.region)}:${group.scripts.join(',')}` : '';
  }

  private tagNewSprites(): void {
    for (const s of this.scripts) for (const sp of s.runner.sprites) if (!this.seqOf.has(sp)) this.seqOf.set(sp, this.seqCounter++);
  }

  /** Every leaf bitmap the view currently shows, in display (painter's) order. */
  leaves(): IsharSceneLeaf[] {
    const out: IsharSceneLeaf[] = [];
    const n = this.scripts.length;
    this.scripts.forEach((s, rank) => {
      const dir = findIsharDirectory(s.data);
      if (!dir) return;
      for (const sp of s.runner.sprites) {
        const h = resolveIsharSlot(s.data, dir, sp.idx);
        if (h < 0) continue;
        const bitmap = decodeIsharBitmap(s.data, sp.idx, h);
        if (!bitmap) continue;
        out.push({
          script: s.name,
          index: sp.idx,
          x: sp.x,
          y: sp.y,
          z: sp.z,
          numelem: sp.numelem,
          invertX: sp.invertX,
          bitmap,
          seq: (n - 1 - rank) * 1e7 + (this.seqOf.get(sp) ?? 0),
        });
      }
    });
    return sortLeavesForDisplay(out);
  }

  /** Runner warnings from every live script. */
  scriptWarnings(): string[] {
    return this.scripts.flatMap((s) => s.runner.warnings.map((w) => `${s.name}: ${w}`));
  }
}

const paletteCache = new WeakMap<Uint8Array, Map<number, IsharPalette | null>>();
/** A script's palette resource at directory `slot` (`cpalette slot`), or its first `0xFE` slot when `slot` < 0. */
function paletteOf(data: Uint8Array, slot: number): IsharPalette | null {
  let m = paletteCache.get(data);
  if (!m) paletteCache.set(data, (m = new Map()));
  if (!m.has(slot)) m.set(slot, slot < 0 ? resolveIsharOwnPalette(data) : resolveIsharPaletteSlot(data, slot));
  return m.get(slot)!;
}

/** `cdarkpal`'s effect on a palette load: entries [first, first + count) scaled per channel by factor/256 (truncated), entry 0 black. */
export function darkenPalette(p: IsharPalette, dk: { factors: readonly [number, number, number]; first: number; count: number }): IsharPalette {
  const colors = p.colors.map((c, i): [number, number, number] | undefined => {
    if (!c) return c;
    if (i === 0) return [0, 0, 0];
    if (i < dk.first || i >= dk.first + dk.count) return c;
    return [Math.trunc((c[0] * dk.factors[0]) / 256), Math.trunc((c[1] * dk.factors[1]) / 256), Math.trunc((c[2] * dk.factors[2]) / 256)];
  });
  return { ...p, colors };
}

/** Top-left pixel of a leaf, exactly as `deptopix()` (v<60) computes it: centre-anchored on the projected point. */
export function leafTopLeft(leaf: { x: number; z: number; bitmap: { width: number; height: number } }, screen: IsharViewScreen): { x: number; y: number } {
  return {
    x: screen.xCenter + leaf.x - ((leaf.bitmap.width - 1) >> 1),
    y: screen.horizonY - leaf.z - ((leaf.bitmap.height - 1) >> 1),
  };
}

/** Composite leaves (already in display order) into a view-sized RGBA canvas cleared to palette index 0. */
export function compositeIsharView(leaves: IsharSceneLeaf[], screen: IsharViewScreen, palette: IsharPalette | null): Uint8Array {
  const { width: cw, height: ch } = screen;
  const canvas = new Uint8Array(cw * ch * 4);
  const bg = palette?.colors[0] ?? [0, 0, 0];
  for (let i = 0; i < cw * ch; i++) {
    canvas[i * 4] = bg[0];
    canvas[i * 4 + 1] = bg[1];
    canvas[i * 4 + 2] = bg[2];
    canvas[i * 4 + 3] = 255;
  }
  for (const leaf of leaves) {
    // A sprite behind the viewer (depth < 0) stays in the display list but
    // is not drawn (the reference renderer tests `newd > -1`); oracle, town
    // CONT3 (32,57): VILLE's depth -18/-20 walls are listed, not shown.
    if (leaf.y < 0) continue;
    const bmp = leaf.bitmap;
    const src = palette ? isharBitmapToPaletteRGBA(bmp, palette) : isharBitmapToNormalizedGreyscaleRGBA(bmp);
    const { x: dx, y: dy } = leafTopLeft(leaf, screen);
    for (let y = 0; y < bmp.height; y++) {
      const py = dy + y;
      if (py < 0 || py >= ch) continue;
      for (let x = 0; x < bmp.width; x++) {
        const sx = leaf.invertX ? bmp.width - 1 - x : x;
        const si = (y * bmp.width + sx) * 4;
        if (src[si + 3] === 0) continue;
        const px = dx + x;
        if (px < 0 || px >= cw) continue;
        const di = (py * cw + px) * 4;
        canvas[di] = src[si]!;
        canvas[di + 1] = src[si + 1]!;
        canvas[di + 2] = src[si + 2]!;
      }
    }
  }
  return canvas;
}

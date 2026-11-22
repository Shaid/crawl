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
}

export interface IsharSceneGroup {
  /** Scene scripts in MAIN's `clive` order (= the entity order they run in each frame). Names without extension. */
  scripts: readonly string[];
  /** The backdrop script whose palette the view uses, and the directory slot its `cpalette` installs. */
  paletteFrom?: { script: string; slot: number | ((readMain: (addr: number) => number) => number) };
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
  enter?(from: IsharPartyState, to: IsharPartyState, cell: (region: number, row: number, col: number) => number): IsharPartyState | null;
  /** Zone add-on scripts MAIN keeps alive for (region, zone); `null` = this zone leaves the current add-ons alone. */
  addOns?(region: number, zone: number): readonly string[] | null;
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
 * Ishar 1 GERDEP `+0xc38` (the step test every move calls), for a party
 * with someone alive and no monster on the target (monsters, `+0x1584`,
 * are not modelled):
 * - target -25..-1 and -43..-40: refused (doors, locks, buildings: a
 *   forward press there opens the building or prints a message instead);
 * - -80 / -81 / -82: passages (`+0x101c..+0x11be`) that move the party;
 *   -82 (CONT5 50,49) leads to region 6;
 * - any other negative target: refused (`+0x11c3`).
 * Not ported: the side-wall codes -46..-8 of the cell the party stands on
 * (`+0x11d5`, `+0x13a9`) with their gate check (`+0x1637`, a 40-entry
 * (row, col, open) table PARAM fills at `0x3c00`/`0x3c34`/`0x3b64`); the
 * party cannot normally stand on such a cell. Applying that gate table to
 * plain cells refuses steps the game allows (oracle walk).
 */
export function isharEnter(to: IsharPartyState, v: number): IsharPartyState | null {
  if (v === -80 || v === -81) {
    const dest: Record<number, readonly [number, number]> = v === -80
      ? { 1: [17, 67], 3: [45, 24], 4: [50, 50], 15: [36, 26] }
      : { 1: [21, 14], 3: [4, 52], 4: [46, 13], 15: [49, 20] };
    const d = dest[to.region];
    return d ? { ...to, row: d[0], col: d[1] } : null;
  }
  if (v === -82) return { ...to, region: 6, row: 20, col: 71 };
  if (v < 0) return null;
  return to;
}

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
      default:
        return null;
    }
  },
  // GERDEP +0x1baf: cswitch2 on the region code, then per-region gate rules
  // (e.g. region 1: col >= 46 in zone 0 -> zone 1; col < 46 in zone 1 -> 0;
  // (25,60) in zone 1 -> 3 ...), all ending at +0x1d34 / +0x2278.
  sceneScripts: ['FOND', 'RPLAINE', 'PLAINE', 'ARBRE', 'FORET', 'FBUIS', 'LACUSTRE', 'VILLAGE', 'RAMPART', 'INVILLE', 'FTEMPLE', 'TEMPLE', 'FVILLE', 'VILLE', 'FONTAINE'],
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
  enter(_from, to, cell) {
    return isharEnter(to, cell(to.region, to.row, to.col));
  },
  zone: { script: 'GERDEP', entry: 0x1baf, exits: [0x1d34, 0x2278], addr: 0x3eac, prevRegionLocal: 25 },
  addOns(region, zone) {
    // MAIN +0xe41 (cswitch2 on the region code) and the loaders it calls:
    // +0x31b2 lacustre, +0x3097 village (unloads lacustre/rampart/inville),
    // +0x3127 rampart + inville (unloads village).
    switch (region) {
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
    return { 0x2ab4: s.row, 0x2ab5: s.col, 0x2ab6: this.facingRaw[s.facing], 0x2d18: s.region, 0x519f: 1, 0x4a80: 1 };
  },
  sceneScripts: ['FOND1', 'PLAINE1', 'VILLAGE1', 'BOAT', 'FORET1'],
  gridBuffers: 'layers',
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
    return null;
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
  addOns(region, zone) {
    // MAIN's zone switch (MAIN +0x18b2 loads / +0x24ce starts; the decoder
    // does not get through those blocks yet, so this table was read off the
    // oracle's start/kill trace for every zone-pair transition in CONT1):
    // zone 1 village1, zone 3 boat, zones 5 and 9 foret1 (restarted on
    // entering 9), zones 2 and 4 none.
    if (region !== 1) return null;
    if (zone === 1) return ['VILLAGE1'];
    if (zone === 3) return ['BOAT'];
    if (zone === 5 || zone === 9) return ['FORET1'];
    if (zone === 2 || zone === 4) return [];
    return null;
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
  // oracle `S 82 x=0 y=13 w=255 h=112`
  screen: { xCenter: 127, horizonY: 65, width: 256, height: 113 },
  mainGlobals(s) {
    return { 0x257: s.row, 0x14b6: s.col, 0x14b7: this.facingRaw[s.facing], 0x3518: 1 };
  },
  tables: { 0x15f8: [0,10,3,3,4,2,1,6,1,0,1,9,9,9,10,10,1,1,0,0,0,0,0,4,0,5,5,5,5,5,5,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,8,8,8,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,7,7,7,8,8,8,8,0,0,1,1,1,1,1,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] },
  sceneScripts: ['VWALL', 'VHOUSE2', 'VHOUSE1', 'FVILLE', 'VDEC1', 'VDEC2'],
  sceneGroup(region) {
    // FVILLE `+0xfc`: `cpalette 5`.
    if (region === 1) return { scripts: ['VWALL', 'VHOUSE2', 'VHOUSE1', 'FVILLE', 'VDEC1', 'VDEC2'], paletteFrom: { script: 'FVILLE', slot: 5 } };
    return null;
  },
  gridBuffers: 'layers',
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
    const code = st.region % 10;
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
      readMain: (addr) => globals[addr] ?? 0,
      writeMain: (addr, v) => {
        globals[addr] = v;
        if (this.spec.zone && addr === this.spec.zone.addr) this.zone = v;
      },
      readGrid: (addr, pop, direct) => {
        const table = this.spec.tables?.[addr];
        if (table) return table[direct] ?? 0;
        const row = pop();
        const col = direct;
        if (row < 0 || col < 0 || col >= stride || row >= rows) return 0;
        if (addr === gridA) return this.grids.A(row, col);
        if (addr === gridB) return this.grids.B(row, col);
        return 0;
      },
    };
  }

  private create(name: string): LoadedScript | null {
    const data = this.load(name);
    if (!data) {
      this.warnings.push(`scene script ${name} not available`);
      return null;
    }
    const runner = new AlisScriptRunner(data, name);
    if (this.spec.coordOffsets) runner.coordOffsets = this.spec.coordOffsets;
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
      this.scripts = [];
      this.palette = null;
      if (group) {
        for (const name of group.scripts) {
          const s = this.create(name);
          if (s) this.scripts.push(s);
        }
        const env = this.env();
        for (const s of this.scripts) s.runner.settle(env);
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
    const pal = this.scripts.find((s) => s.name === script);
    if (!pal) return;
    const env = this.env();
    this.palette = paletteOf(pal.data, typeof slot === 'function' ? slot(env.readMain) : slot);
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
    const want = this.spec.addOns?.(st.region, this.zone);
    if (want === null || want === undefined) return;
    const restart = !!this.spec.addOnRestartZones?.includes(this.zone) && this.zone !== this.addOnZone;
    this.addOnZone = this.zone;
    const key = want.join(',');
    if (key === this.addOnKey && !restart) return;
    const base = this.spec.sceneGroup(st.region)?.scripts ?? [];
    const keep = this.scripts.filter((s) => base.includes(s.name) || (want.includes(s.name) && !restart));
    const have = new Set(keep.map((s) => s.name));
    const env = this.env();
    for (const name of want) {
      if (have.has(name)) continue;
      const s = this.create(name);
      if (!s) continue;
      s.runner.settle(env);
      keep.push(s);
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
    if (this.enter(state) && !fresh) {
      const env = this.env();
      for (const s of this.scripts) {
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
    return group ? `${state.region % 10}:${group.scripts.join(',')}` : '';
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

/**
 * Browser-safe SNES Wizardry 6 dungeon-view model. Pure (no Node/DOM
 * imports) so the Node renderer, the parity sweep and the browser walker
 * (`tools/walker/games-w6-snes.ts`) share it.
 *
 * v5 (2026-11-22, `data-structure.md` §3.14.13): a line-by-line port of
 * the game's own view walk `$80:C69F`, run in the game's own coordinate
 * space -- the 24x24 maze **window** `$80:D073` builds around the party
 * (`$7E:4300` wall / `$7E:4540` feature / `$7E:4780` variant / `$7E:DBC0`
 * stairs flag, cell index = row*24+col, row 0 = north edge). The windows
 * are not reconstructed here: `export-maze-windows.ts` runs the ROM's own
 * builder in a 65816 core (`oracle/`) at export time and ships the result
 * (`dungeon/maze-windows.json`). Verified against the same core on every
 * party cell x 4 facings of all 14 levels (`oracle/sweep-parity.ts`).
 *
 * v1-v4 walked a grid densified from `data/maze.json` and were checked only
 * against re-implementations of themselves; the game-driven sweep found
 * them wrong on 36.4% of poses. What v5 fixes, each tied to its ROM site:
 *
 * - floor/ceiling pass `$80:CE4F`-`CF9F` ported exactly: the `$80:CFA2`
 *   neighbour mask (deltas `$80:D6D0`), the slot-0 kind-0x24 ceiling lists
 *   (`0x84A6`/`0x84DC`), the floor transition lists at `$89:FE5E` keyed by
 *   `$80:D6E8`, the `0x0F` and `>= 0x80` ceiling rules, the `$7E:DBC0`
 *   stairs-floor flag, and no filtering of 0/0xFFFF words (the game
 *   appends whatever the table holds);
 * - the sky piece: `$80:D01B` latches `$d0 = $80:DF01[slot]` for visible
 *   slots when `$80:DAD7[level*12+region]` bit 0 is clear, and `$80:C7C6`
 *   appends `0x02E6 | ($6e & 4)`;
 * - the `$80:CCDE` far-side variant fork compares against the RAW
 *   `$80:DB7F` byte (0x80 is not normalised to 0x40);
 * - the second draw substitutes `$6e` for `$42 == 4` only on receding edges
 *   (`$80:C8A4`, `C993`, `CB71`), and the `0x18` third draw happens only in
 *   the side/perpendicular/front-face bodies (`$80:CA3A`/`CAA4`/`C9E6`);
 * - the `$80:DD4B` frustum is used raw (facing 1 slot 24 is -90);
 * - the marked-cell extra draw fires for `$0f == 2` (code 1, `$80:CC89`);
 * - movement is the game's `$80:C40B` decision (`canStepWindow`).
 *
 * Runtime state the walk reads that a new game leaves clear, and which
 * this model therefore holds at its new-game value: `$0850` (a pre-word),
 * `$094D` (replaces the slot-0 floor word with `0x02EC`), `$7E:AC00` (the
 * scripted per-cell overlay `$80:CE00`, written by `$82:D245`), `$0964`,
 * `$0B74`-`$0B7B`. See `docs/wizardry6/TODO.md`.
 */

export interface MazeLevelRaw {
  level: number;
  origins: Array<{ x: number; y: number }>;
  cells: Array<{ region: number; major: number; minor: number; wall: number; feature: number }>;
}

/** One 24x24 maze window as `$80:D073` leaves it in WRAM. */
export interface MazeWindow {
  level: number;
  /** `$c0`, the centre region 0-11. */
  region: number;
  /** `$be` = level*48 + region*4. */
  be: number;
  /** `$aa`/`$a8`: global x/y of the centre region's origin. The centre region is `[originX, originX+8) x [originY, originY+8)`. */
  originX: number;
  originY: number;
  wall: Uint8Array;
  feature: Uint8Array;
  variant: Uint8Array;
  dbc0: Uint8Array;
}

/** `dungeon/maze-windows.json` (written by `export-maze-windows.ts`). Planes are base64; a `null` plane is all zero. */
export interface MazeWindowsFile {
  windows: Array<{ level: number; region: number; be: number; originX: number; originY: number; wall: string; feature: string; variant: string; dbc0: string | null }>;
  /** Per level: `"gx,gy"` -> index into `windows` -- the window `$80:D073` builds when the party arrives at that cell from elsewhere. */
  cells: Array<Record<string, number>>;
  /** The new-game start (`$80:891B` entry 0). */
  start: { level: number; x: number; y: number; facing: number; palette094c: number };
}

function b64(s: string | null): Uint8Array {
  const out = new Uint8Array(576);
  if (s === null) return out;
  const bin = atob(s);
  for (let i = 0; i < bin.length && i < 576; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeMazeWindow(f: MazeWindowsFile, index: number): MazeWindow {
  const w = f.windows[index]!;
  return {
    level: w.level,
    region: w.region,
    be: w.be,
    originX: w.originX,
    originY: w.originY,
    wall: b64(w.wall),
    feature: b64(w.feature),
    variant: b64(w.variant),
    dbc0: b64(w.dbc0),
  };
}

/** Whether global (gx, gy) is inside the window's centre region -- the `$80:D039` keep-the-window test. */
export function inCentreRegion(w: MazeWindow, level: number, gx: number, gy: number): boolean {
  const dx = gx - w.originX;
  const dy = gy - w.originY;
  return w.level === level && dx >= 0 && dx < 8 && dy >= 0 && dy < 8;
}

/**
 * The window the game holds after the party moves to (gx, gy): `current`
 * if the cell is still in its centre region (`$80:D039`), else the window
 * `$80:D073` builds for that cell. Returns `null` when the cell is in no
 * region the builder knows (the caller keeps whatever it had).
 */
export function windowIndexFor(f: MazeWindowsFile, level: number, gx: number, gy: number): number | null {
  const i = f.cells[level]?.[`${gx},${gy}`];
  return i === undefined ? null : i;
}

/** `$50`: the party's window cell index -- `(a8 + 7 - gy)*24 + (gx - aa) + 0xC8` (`$80:C6DA`-`C6FC`). */
export function windowCell(w: MazeWindow, gx: number, gy: number): number {
  return (w.originY + 7 - gy) * 24 + (gx - w.originX) + 0xc8;
}

/** `dungeon/level-palettes.json`'s shape (§3.14.12 v4). */
export interface LevelPalettesFile {
  /** Per-level fallback group -- the level's own most-common palette group among its `$82:F842` records (or the global default `40` if it has none). */
  groups: number[];
  /** `perRegion[level][region]` = that region's own majority group, or `-1` if the level has no record for that region (callers fall back to `groups[level]`). */
  perRegion: number[][];
}

/**
 * §3.14.12 v4: the palette group for a region of a level, falling back to
 * the level's dominant group. Still an approximation: `$82:F842` re-runs
 * only at 7 scripted screen-fade transitions, so the live palette depends
 * on the last trigger the party crossed (`snes-palette-path-dependence` in
 * `docs/wizardry6/TODO.md`).
 */
export function resolveRegionPaletteGroup(levelPalettes: LevelPalettesFile, level: number, region: number | null): number {
  const fallback = levelPalettes.groups[level] ?? DEFAULT_PALETTE_GROUP;
  if (region === null) return fallback;
  const g = levelPalettes.perRegion[level]?.[region];
  return g !== undefined && g >= 0 ? g : fallback;
}

const DEFAULT_PALETTE_GROUP = 40;

/** Extract the 2-bit wall sub-field for absolute compass `facing` (0=N/+Y, 1=E/+X, 2=S/-Y, 3=W/-X) from one cell's raw wall byte. */
export function wallForFacing(wallByte: number, facing: 0 | 1 | 2 | 3): number {
  return (wallByte >> (facing * 2)) & 0x3;
}

/** Decode a raw feature byte into its feature code (0-15, `0x0D`/`0x0E` sentinels normalised to 0 = "no feature") and 2-bit orientation. */
export function featureOf(byte: number): { feature: number; orient: number } {
  const nibble = byte & 0x0f;
  const isEmpty = nibble === 0x0d || nibble === 0x0e;
  return { feature: isEmpty ? 0 : nibble, orient: (byte >> 4) & 0x3 };
}

// ─────────────────────────────────────────────────────────────────────────
// ROM data the walk reads (exported by `export-dungeon-view.ts`).
// ─────────────────────────────────────────────────────────────────────────

export interface WalkTables {
  /** `$80:DD4B`: 4 facings x 26 raw i16 window-index deltas (slot cell = `$50 + dd4b[facing*26 + slot-1]`). */
  dd4b: number[];
  /** `$80:D700`: 6 i16 deltas; facing f's left / ahead / right neighbour = `d700[f]`, `d700[f+1]`, `d700[f+2]`. */
  d700: number[];
  /** `$80:D6D0`: 4 x 3 i16 deltas (ahead, right, left) for the `$80:CFA2` neighbour mask. */
  d6d0: number[];
  /** `$80:D6E8`: 12 bytes, per-slot floor-transition column into `$89:FE5E`. */
  d6e8: number[];
  de1b: number[]; // $80:DE1B second-stage byte per code 0-15
  de2c: number[]; // $80:DE2C raw (bit 7 = "see-through + sfx", read as 1)
  de3d: number[]; // $80:DE3D front-deferral gate per code
  de4e: number[]; // $80:DE4E (idx & 0xFE) / 2 -> record byte offset
  db7f: number[]; // $80:DB7F raw per-level default variant ($0e)
  c85e: number[]; // $80:C85E per-slot $78 flush flags (index 1-26)
  dad7: number[]; // $80:DAD7 per (level*12+region): bit 0 set = no sky
  df01: number[]; // $80:DF01 per-slot sky latch value
  c685: number[]; // $80:C685 per-code movement byte (bit 7 = passable)
  /** `$89:FE5E[(mask<<1) | d6e8[slot]]` -> 0-terminated floor word list (hex index keys). */
  fe5e: Record<string, number[]>;
}

export type HandlerSpec =
  | { kind: 'side'; side: 'L' | 'R'; table: string; enable: number }
  | { kind: 'front'; edgeL: string; front: string; edgeR: string; enAhead: number; enLeft: number; enRight: number }
  | { kind: 'lat'; side: 'L' | 'R'; perp: string; enPerp: number; sideTable: string; enSide: number };

export interface WalkRecord {
  /** The record's 39 u16 words (byte offsets 0-0x4C). */
  words: number[];
  /** The 4 per-facing override bytes at record offsets 0x4C-0x4F (door/gate far-side art swap). */
  override: number[];
}

export interface ViewPiece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Row-major pool-tile index or `null` for an empty/out-of-pool cell. */
  cells: (number | null)[];
  /** Per-cell alpha flag (cell word bit 15, §3.14.2): 1 = tile has transparent pixels, later pieces may merge behind it. Parallel to `cells`. */
  alpha: number[];
}

export interface ViewPiecesFile {
  viewport: { w: number; h: number };
  tileSize: number;
  poolAtlas: string;
  poolCols: number;
  tables: WalkTables;
  /** Slot handlers 1-26 (index 0 unused -- slot 0 is the fixed own-cell handler below). */
  handlers: Array<HandlerSpec | null>;
  /** Slot 0's own-cell edge/front tables (`$80:C879`): left `$89:F356`, right `$89:F6C6`, front `$89:EB1A`. */
  slot0: { left: string; right: string; front: string };
  records: Record<string, WalkRecord>;
  /** `$80:DED8` kind table: 21 entries, each the key of a 27-word per-slot floor/ceiling piece table. */
  ded8: string[];
  fcTables: Record<string, number[]>;
  /** Every compose word the walk can emit, resolved (hex-keyed). Words that resolve to nothing drawable (e.g. `0x0101`, `0x0000`) are absent. */
  pieces: Record<string, ViewPiece>;
  doorWord: number; // 0x02E8
  backdropWord: number; // 0x834A -- appended last (painter's-algorithm backstop)
}

// ─────────────────────────────────────────────────────────────────────────
// The walk ($80:C69F). Variable names follow the game's direct page.
// ─────────────────────────────────────────────────────────────────────────

interface Walk {
  f: ViewPiecesFile;
  t: WalkTables;
  w: MazeWindow;
  facing: number;
  words: number[];
  e0: number; // $0e = DB7F[level], raw
  p8e: number; // $8e = ((gy ^ gx ^ facing) & 1) << 1
  p6e: number; // $6e = $8e << 1
  c9: number; // 1 = party cell carries the >= 0xC0 marker
  d0: number; // sky latch
  vis: number[]; // $7E:3B00, 1 = skip
  p78: number; // deferred front word
  slot: number; // $5a
  a0a: number; // $0a, the cell the last handler evaluated
  v42: number; // DE1B second-stage value
  v43: number; // DE2C see-through
  v4e: number; // variant byte of the last evaluated cell
}

type Role = 'left' | 'ahead' | 'right' | 'behind';
const ROLE_DIR: Record<Role, number> = { ahead: 0, right: 1, behind: 2, left: 3 };
/** `$80:CC3B`/`CC40`/`CC45` resolver Y: 0 = left, 2 = ahead, 4 = right neighbour (`$80:D700`). */
const ROLE_FAR: Record<'left' | 'ahead' | 'right', number> = { left: 0, ahead: 1, right: 2 };

const feat = (s: Walk, i: number): number => s.w.feature[i] ?? 0;

/** `$80:CD36`-`CDEF`: evaluate one edge of cell `i`. Returns the code; sets `$42`/`$43`/`$4e`. */
function evaluate(s: Walk, i: number, role: Role): number {
  const dir = (s.facing + ROLE_DIR[role]) & 3;
  const wallv = ((s.w.wall[i] ?? 0) >> (dir * 2)) & 3;
  s.v4e = s.w.variant[i] ?? 0;
  const raw = feat(s, i) & 0x3f;
  let code = wallv;
  if (raw !== 0) {
    if ((raw & 0x0f) === 6) {
      if (s.slot === 3) s.words.push(s.f.doorWord); // $80:CD8F
    } else if ((raw & 0x30) === dir << 4 && (raw & 0x0f) < 0x0d) {
      code = (raw & 0x0f) + 3;
    }
  }
  s.v42 = s.t.de1b[code]!;
  if (code === 0x0c && s.slot < 6) s.v42 = 4;
  const v = s.t.de2c[code]!;
  s.v43 = v & 0x80 ? 1 : v;
  return code;
}

/** `$80:CC72`: resolve one draw (`a2x` = `$0f`) of record `table` against the evaluated cell `$0a`. 0xFFFF = nothing. */
function resolve(s: Walk, table: string, a2x: number, role: 'left' | 'ahead' | 'right'): number {
  const rec = s.f.records[table];
  if (!rec) return 0xffff;
  const far = s.a0a + s.t.d700[s.facing + ROLE_FAR[role]]!;
  if (feat(s, far) >= 0xc0 && a2x === 2) {
    const extra = rec.words[0x44 >> 1]!;
    if (extra !== 0xffff) s.words.push(extra);
  }
  const farVariant = s.w.variant[far] ?? 0;
  let idx: number | null = null;
  if (rec.override[s.facing]! !== 0) {
    if (a2x === 0x14) idx = 0x84;
    else if (a2x === 0x06) idx = (s.v4e === s.e0 ? farVariant : s.v4e) === 0x60 ? 0x88 : 0x86;
  }
  if (idx === null) idx = ((s.v4e === s.e0 ? farVariant : s.v4e) + a2x) & 0xff;
  const byteOff = s.t.de4e[(idx & 0xfe) >> 1];
  if (byteOff === undefined) return 0xffff;
  const word = rec.words[byteOff >> 1];
  return word === undefined ? 0xffff : word;
}

/** `$80:CC48`: append unless the party (`$c9 == 1`) or the evaluated cell carries the marker. */
function draw(s: Walk, table: string, a2x: number, role: 'left' | 'ahead' | 'right'): void {
  if (s.c9 === 1) return;
  if (feat(s, s.a0a) >= 0xc0) return;
  const w = resolve(s, table, a2x, role);
  if (w !== 0xffff) s.words.push(w);
}

/** `$80:CC0F`: front draw -- `DE3D`-gated codes defer into `$78`, else append. */
function drawFront(s: Walk, table: string, a2x: number): void {
  if (s.t.de3d[a2x >> 1]) {
    const w = resolve(s, table, a2x, 'ahead');
    if (w !== 0xffff) s.p78 = w;
    return;
  }
  draw(s, table, a2x, 'ahead');
}

/** Receding edge (`$80:C8A4`/`C993`/`CB71`): code 2 -> `$8e`, second draw with `$42 == 4` -> `$6e`, no third draw. */
function recedingEdge(s: Walk, table: string, code: number, role: 'left' | 'right'): void {
  draw(s, table, (code === 2 ? s.p8e : code) << 1, role);
  if (s.v42 === 0) return;
  draw(s, table, s.v42 === 4 ? s.p6e : s.v42, role);
}

/** Side / perpendicular body (`$80:CA3A`, `CAA4`): drawn against the ahead neighbour, raw second draw, `0x18` third draw. */
function sideBody(s: Walk, table: string, enable: number): void {
  const code = evaluate(s, s.a0a, 'ahead');
  if (code === 0) {
    if (enable) s.vis[enable] = 0;
    return;
  }
  draw(s, table, code << 1, 'ahead');
  if (s.v43 === 0 && enable) s.vis[enable] = 0;
  if (s.v42 === 0) return;
  draw(s, table, s.v42, 'ahead');
  if (s.v42 === 0x18 && s.slot < 6) draw(s, table, 4, 'ahead');
}

function runHandler(s: Walk, h: HandlerSpec): void {
  if (h.kind === 'side') {
    sideBody(s, h.table, h.enable);
  } else if (h.kind === 'front') {
    // $80:C981
    let code = evaluate(s, s.a0a, 'left');
    if (code === 0) s.vis[h.enLeft] = 0;
    else recedingEdge(s, h.edgeL, code, 'left');
    code = evaluate(s, s.a0a, 'right');
    if (code === 0) s.vis[h.enRight] = 0;
    else recedingEdge(s, h.edgeR, code, 'right');
    code = evaluate(s, s.a0a, 'ahead');
    if (code === 0) {
      if (h.enAhead) s.vis[h.enAhead] = 0;
      return;
    }
    drawFront(s, h.front, code << 1);
    if (s.v43 === 0) s.vis[h.enAhead] = 0;
    if (s.v42 === 0) return;
    drawFront(s, h.front, s.v42);
    if (s.v42 === 0x18 && s.slot < 6) drawFront(s, h.front, 4);
  } else {
    // $80:CAE9..CBF4: perpendicular face, then the receding side
    sideBody(s, h.perp, h.enPerp);
    const role = h.side === 'L' ? 'left' : 'right';
    const code = evaluate(s, s.a0a, role);
    if (code === 0) {
      if (h.enSide) s.vis[h.enSide] = 0;
      return;
    }
    recedingEdge(s, h.sideTable, code, role);
  }
}

/** `$80:CFA2`: bit 0/1/2 = the ahead/right/left neighbour of `$0a` holds a non-empty feature (not 0x0D/0x0E/0x4E); also returns `$0C28`. */
function neighbourMask(s: Walk): { mask: number; add: number } {
  let mask = 0;
  for (let k = 0; k < 3; k++) {
    const v = feat(s, s.a0a + s.t.d6d0[s.facing * 3 + k]!);
    if (v !== 0x0d && v !== 0x0e && v !== 0x4e) mask |= 1 << k;
  }
  return { mask, add: (s.w.variant[s.a0a] ?? 0) !== 0 ? 0x36 : 0 };
}

function fcTable(s: Walk, kind: number): number[] {
  return s.f.fcTables[s.f.ded8[kind >> 1]!]!;
}

/** `$80:CE4F`-`CFA1`: the floor/ceiling words for the cell `$0a` at slot `$5a`. */
function floorCeiling(s: Walk, cell50: number): void {
  const i = s.a0a;
  const f = feat(s, i);
  const yv = (((s.w.variant[i] ?? 0) & 0x60) >> 2) | s.p8e;
  let ceil: number;
  let floor: number;
  if (f === 0x8f) {
    ceil = 0x10;
    floor = s.p8e + 0x26;
  } else if (f === 0x8e) {
    ceil = 0x24;
    floor = yv + 4;
  } else if (f === 0x4e) {
    ceil = 0x24;
    floor = 0x20;
  } else if (f >= 0x40) {
    if ((f & 0xc0) === 0x40) {
      ceil = yv; // stairs / pit
      floor = (s.w.dbc0[i] ?? 0) !== 0 ? 0x1c : 0x22;
    } else {
      ceil = 0x10;
      floor = yv + 4;
    }
  } else {
    const lo = f & 0x0f;
    if (lo < 0x0d) {
      ceil = yv;
      floor = yv + 4;
    } else if (lo === 0x0d) {
      ceil = 0x10;
      floor = 0x20;
    } else if (lo === 0x0e) {
      ceil = yv;
      floor = 0x20;
    } else {
      ceil = 0x24;
      floor = yv + 4;
    }
  }
  if (ceil === 0x24 && s.slot === 0) {
    const { mask } = neighbourMask(s);
    const base = (s.w.variant[cell50] ?? 0) !== 0 ? 0x84dc : 0x84a6;
    if (mask & 1) s.words.push(base, base + 2, base + 4, base + 6);
    else s.words.push(base + 4, base + 6);
  } else {
    s.words.push(fcTable(s, ceil)[s.slot]!);
  }
  if (floor === 0x20 && s.slot < 12 && s.t.d6e8[s.slot]) {
    const { mask, add } = neighbourMask(s);
    if (mask) {
      const list = s.t.fe5e[((mask << 1) | s.t.d6e8[s.slot]!).toString(16)] ?? [];
      for (const w of list) s.words.push((w + add) & 0xffff);
      return;
    }
  }
  s.words.push(fcTable(s, floor)[s.slot]!);
}

/**
 * Resolve one pose into the game's own ordered compose-word list (the
 * `$7E:421C` list `$80:C69F` builds; near-to-far, first piece to claim a
 * cell wins -- `compositeSnesView`). (gx, gy) are global maze coordinates;
 * the party must be inside `w`'s centre region or a neighbour the window
 * covers.
 */
export function resolveViewWords(f: ViewPiecesFile, w: MazeWindow, gx: number, gy: number, facing: number): number[] {
  const t = f.tables;
  const cell50 = windowCell(w, gx, gy);
  const p8e = ((gy ^ gx ^ facing) & 1) << 1;
  const s: Walk = {
    f,
    t,
    w,
    facing,
    words: [],
    e0: t.db7f[w.level]!,
    p8e,
    p6e: p8e << 1,
    c9: 0,
    d0: 0,
    vis: new Array(27).fill(1),
    p78: 0,
    slot: 1, // $5a is 1 while slot 0 runs ($80:C74B)
    a0a: cell50,
    v42: 0,
    v43: 0,
    v4e: 0,
  };

  // slot 0 ($80:C879)
  if (feat(s, cell50) >= 0xc0) s.c9 = 1;
  let code = evaluate(s, cell50, 'left');
  if (code === 0) s.vis[1] = 0;
  else recedingEdge(s, f.slot0.left, code, 'left');
  code = evaluate(s, cell50, 'right');
  if (code === 0) s.vis[2] = 0;
  else recedingEdge(s, f.slot0.right, code, 'right');
  code = evaluate(s, cell50, 'ahead');
  if (code === 0) s.vis[3] = 0;
  else {
    drawFront(s, f.slot0.front, code << 1);
    if (s.v43 === 0) s.vis[3] = 0;
    if (s.v42) {
      drawFront(s, f.slot0.front, s.v42);
      if (s.v42 === 0x18) drawFront(s, f.slot0.front, 4);
    }
  }

  // slots 1-26
  const dd = s.facing * 26;
  const dad7 = t.dad7[w.be >> 2] ?? 0;
  for (let slot = 1; slot <= 26; slot++) {
    if (s.vis[slot] === 0) {
      s.slot = slot;
      s.a0a = cell50 + t.dd4b[dd + slot - 1]!;
      const h = f.handlers[slot];
      if (h) runHandler(s, h);
      // $80:D01B
      if ((dad7 & 1) === 0 && t.df01[slot]) s.d0 = t.df01[slot]!;
    }
    if (t.c85e[slot]) {
      if (s.c9 !== 1 && feat(s, s.a0a) < 0xc0 && s.p78) s.words.push(s.p78);
      s.p78 = 0;
    }
  }

  if (s.c9 !== 1) {
    if (s.d0) s.words.push(0x02e6 | (s.p6e & 4)); // $80:C7C6
    s.slot = 0;
    s.a0a = cell50;
    floorCeiling(s, cell50);
    for (let slot = 1; slot <= 26; slot++) {
      s.slot = slot;
      s.a0a = cell50 + t.dd4b[dd + slot - 1]!;
      floorCeiling(s, cell50);
    }
  }
  s.words.push(f.backdropWord);
  return s.words;
}

/** The walk's own-cell edge codes `$44`-`$47` for relative direction 0 = ahead, 1 = right, 2 = behind, 3 = left (no side effects). */
export function ownCellCode(f: ViewPiecesFile, w: MazeWindow, gx: number, gy: number, facing: number, rel: number): number {
  const s = { f, t: f.tables, w, facing, words: [] as number[], slot: 1, v42: 0, v43: 0, v4e: 0 } as unknown as Walk;
  const roles: Role[] = ['ahead', 'right', 'behind', 'left'];
  return evaluate(s, windowCell(w, gx, gy), roles[rel & 3]!);
}

/**
 * `$80:C40B`-`C4AA`: may the party step in absolute direction `dir`?
 * Refused onto a `(feature & 0xC0) == 0x40` stairs/pit cell other than
 * `0x4E` (the game takes stairs through a separate command); otherwise
 * allowed iff `$80:C685[code] & 0x80`, where `code` is the evaluator's
 * own-cell code for that edge (feature promotion included).
 */
export function canStepWindow(f: ViewPiecesFile, w: MazeWindow, gx: number, gy: number, facing: number, dir: number): boolean {
  const rel = (dir - facing) & 3;
  const dest = windowCell(w, gx, gy) + f.tables.d700[(dir & 3) + 1]!;
  const df = w.feature[dest] ?? 0;
  if (df !== 0x4e && (df & 0xc0) === 0x40) return false;
  return (f.tables.c685[ownCellCode(f, w, gx, gy, facing, rel)]! & 0x80) !== 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Pixel compositing -- pure array ops, shared by the Node verification
// renderer (`render-through-dungeon.ts`) and the browser walker
// (`tools/walker/games-w6-snes.ts`).
// ─────────────────────────────────────────────────────────────────────────

/** Recover the raw pool-tile index buffer (0-15 per pixel) from a decoded `dungeon-art-indexed.png` RGBA buffer (index in the R channel). */
export function extractPoolIndices(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = rgba[i * 4]!;
  return out;
}

export type Palette16 = ReadonlyArray<{ r: number; g: number; b: number }>;

/**
 * Composite one pose's resolved word list into an RGBA view. Implements
 * §3.14.4's near-to-far painter's algorithm at cell granularity: the first
 * piece to claim a cell owns it; later pieces may only fill pixels that
 * are still palette-index 0 within cells whose owner had transparency.
 */
export function compositeSnesView(
  f: ViewPiecesFile,
  pool: Uint8Array,
  poolW: number,
  palette: Palette16,
  words: number[],
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const vw = f.viewport.w;
  const vh = f.viewport.h;
  const ts = f.tileSize;
  const width = vw * ts;
  const height = vh * ts;
  // per-pixel palette index buffer + per-cell ownership
  const idxBuf = new Uint8Array(width * height); // 0 = unset/transparent
  const owner = new Array<number>(vw * vh).fill(-1); // -1 = unclaimed; else 0 = opaque owner, 1 = alpha owner

  for (const word of words) {
    const piece = f.pieces[`0x${word.toString(16).padStart(4, '0')}`];
    if (!piece) continue;
    for (let row = 0; row < piece.h; row++) {
      for (let col = 0; col < piece.w; col++) {
        const tileIdx = piece.cells[row * piece.w + col];
        if (tileIdx === null || tileIdx === undefined) continue;
        const cx = piece.x + col;
        const cy = piece.y + row;
        if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
        const ci = cy * vw + cx;
        const own = owner[ci]!;
        if (own === 0) continue; // fully-opaque owner: skip
        const merge = own === 1;
        owner[ci] = piece.alpha[row * piece.w + col] ? 1 : 0;
        const srcX = (tileIdx % f.poolCols) * ts;
        const srcY = Math.floor(tileIdx / f.poolCols) * ts;
        for (let py = 0; py < ts; py++) {
          for (let px = 0; px < ts; px++) {
            const o = (cy * ts + py) * width + cx * ts + px;
            if (merge && idxBuf[o] !== 0) continue;
            const v = pool[(srcY + py) * poolW + (srcX + px)]!;
            if (merge) {
              if (v !== 0) idxBuf[o] = v;
            } else {
              idxBuf[o] = v;
            }
          }
        }
      }
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = idxBuf[i]!;
    const c = palette[v];
    const o = i * 4;
    // index 0 (and any missing palette entry) renders as opaque black --
    // matching the real screen, where CGRAM colour 0 shows the backdrop
    rgba[o] = c && v !== 0 ? c.r : 0;
    rgba[o + 1] = c && v !== 0 ? c.g : 0;
    rgba[o + 2] = c && v !== 0 ? c.b : 0;
    rgba[o + 3] = 255;
  }
  return { rgba, width, height };
}

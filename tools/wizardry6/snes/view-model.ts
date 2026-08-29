/**
 * Browser-safe SNES Wizardry 6 dungeon-view model. Pure (no Node/DOM
 * imports) so both a Node verification renderer and the browser walker
 * harness (`tools/walker/games-w6-snes.ts`) share it -- same pattern as
 * the Amiga port's `view-model.ts`.
 *
 * v2: a **faithful port of the game's own 26-slot view walk**
 * (`$80:C69F`, `data-structure.md` §3.14.12 -- disassembly-traced this
 * session), replacing v1's "index-1 generic wall" approximation:
 *
 * - the evaluator (`$00:CD36` family): per-edge 2-bit wall value, feature/
 *   orientation promotion (`code = feature+3` when the feature faces the
 *   evaluated edge), the fixed door piece `0x02E8` at frustum slot 3 for
 *   `feature==6`;
 * - the resolver (`$00:CC72`): piece word = `record[DE4E[(code*2 + variant)
 *   & 0xFE]]` -- so wall values 0-3 and features 1-12 each select their own
 *   record word, and the per-cell variant byte (`$7E:4780`) shifts the
 *   whole lookup into a different art family (castle/cave/forest/...);
 * - `DE1B` second-stage draws (extra pieces for codes 3/6-9/11/12/14/15),
 *   `DE2C` see-through flags (doorways and closed doors keep visibility
 *   recursion alive; solid walls stop it), `DE3D`-gated `$78` deferral
 *   (front-facing walls/doors appended at the `$c85e` depth-group
 *   boundaries so they z-order after that group's side edges);
 * - visibility propagation via the `$7E:3B00` skip-flag array (init
 *   all-skip; slot 0 and each handler enable deeper slots as edges prove
 *   open or see-through);
 * - the floor/ceiling pass (`$00:CE4C`): per-slot ceiling+floor piece from
 *   the `$80:DED8` kind tables, keyed by the cell's variant byte, the walk
 *   parity `$8e`, and the `0x0D`/`0x0E` feature sentinels (which turn out
 *   to be floor/ceiling style selectors, not just "no feature" markers);
 * - the always-appended final backdrop piece `0x834A`.
 *
 * v3 (this session, `data-structure.md` §3.14.12 "per-region art-variant"):
 * **true per-cell variant resolution**, closing the previous per-level
 * uniform approximation. Disassembly of `$80:D073`-`$80:D1B7` found the
 * real chain: `$be` (the region cursor) is resolved by a bounding-box scan
 * over the level's 12 known region origins against the party's current
 * cell (with a cheap cached-region short-circuit); the variant byte is
 * then `$80:DA2E[level*12+region]` (an XBA-stashed accumulator recovered
 * across an `$09F0` flag test that is **provably always false** -- bit 2 of
 * `$09F0` has zero writers anywhere in the ROM, so the "runtime-gated"
 * framing in the prior session's docs was a misreading of an always-taken
 * branch, not a real live gate). Bit 7 of the DA2E byte selects a 16-byte
 * pattern row from `$80:DB9B`, unpacked 2-bit-per-cell into the region's
 * 64 `(major,minor)` slots (`g = major*2 + (minor>>2)`, `f = minor & 3`);
 * bit 7 clear means a uniform fill. See `resolveCellVariant` below and
 * `DenseMazeGrid.variant` -- the per-cell equivalent of the real `$7E:4780`
 * array. (The `$0B19` value the prior session guessed fed this lookup is
 * a *different*, unrelated mechanism -- a small 1-10 scripted per-region
 * event-trigger id, consumed by `$80:9B1A`/`$80:BC74` into `$091E`/`$0842`,
 * not a `$80:DA2E` index at all; corrected in the doc.)
 *
 * v4 (this session, §3.14.12 "per-region palette -- CONFIRMED"): **true
 * per-region palette resolution**, closing the palette half of the same
 * gap. A same-session earlier pass wrongly refuted this (compared the
 * FULL 16-bit `$82:F842` record key against the small range only its LOW
 * byte should occupy); re-disassembling the key's high-byte setup
 * (`$82:F878`-`$82:F883`) found `key = ((level<<4)|region)<<8 |
 * ((dy<<4)|dx)` -- `region` is the plain 0-11 index held in direct-page
 * `$c0`, set by the same bounding-box scan that resolves `$be`. See
 * `resolveRegionPaletteGroup` below and the real caveat it documents:
 * `$82:F842` only actually re-runs at 7 hardcoded scripted transitions
 * engine-wide, so a region with more than one distinct triggered group is
 * resolved by majority vote, not a perfect reconstruction of live state.
 */

export interface DenseMazeGrid {
  width: number;
  height: number;
  /** Raw SNES wall byte per cell, row-major (`y*width+x`). Bits 0-1 = wall
   * on the +Y (`facing===0`, north) side, 2-3 = +X (east), 4-5 = -Y
   * (south), 6-7 = -X (west) -- confirmed absolute mapping,
   * `data-structure.md` §3.14.8's cross-platform table. Off-map cells are
   * filled with the game's own level-load seed (wall `0x00`). */
  wall: Uint8Array;
  /** Raw SNES feature byte per cell (§3.14.8); off-map cells are filled
   * with the level's own `$80:DB8D` seed byte. */
  feature: Uint8Array;
  /** Off-map/seed feature byte used beyond the grid bounds. */
  seedFeature: number;
  /** Per-cell floor/ceiling/art-family variant byte (the real `$7E:4780`
   * equivalent, §3.14.12 v3) -- resolved per `(level,region)` from
   * `$80:DA2E`/`$80:DB9B`, NOT a pose-wide constant. Off-map cells hold
   * `seedVariant`. */
  variant: Uint8Array;
  /** Off-map/seed variant byte (the level's `$80:DB7F` default, `0x80`
   * normalised to `0x40` per the exporter). */
  seedVariant: number;
  /** Global maze coordinate of grid cell (0,0) -- needed because the walk
   * parity `$8e = ((globalX ^ globalY ^ facing) & 1) * 2` uses the game's
   * own global coordinates, not grid-local ones. */
  originX: number;
  originY: number;
}

export interface MazeLevelRaw {
  level: number;
  origins: Array<{ x: number; y: number }>;
  cells: Array<{ region: number; major: number; minor: number; wall: number; feature: number }>;
}

/**
 * Resolve one cell's real `$7E:4780`-equivalent variant byte from
 * `$80:DA2E[level*12+region]` (§3.14.12 v3). Byte-verified against
 * `$80:D181`-`$80:D1AD`: bit 7 clear -> uniform fill (the DA2E byte
 * itself); bit 7 set -> row `value & 0x7f` of the 16-byte `$80:DB9B` table,
 * unpacked 2-bit-per-cell (`g = major*2 + (minor>>2)` selects the source
 * byte within the row, `f = minor & 3` selects which of its four 2-bit
 * fields), each field scaled into `{0x00,0x20,0x40,0x60}` via the game's
 * own per-field shift (`f=0`: `(b&0xC0)>>1`; `f=1`: `(b&0x30)<<1`; `f=2`:
 * `(b&0x0C)<<3`; `f=3`: `(b&0x03)<<5`).
 */
export function resolveCellVariant(da2e: number[], db9b: number[], level: number, region: number, major: number, minor: number): number {
  const v = da2e[level * 12 + region] ?? 0;
  if ((v & 0x80) === 0) return v;
  const row = v & 0x7f;
  const g = major * 2 + (minor >> 2);
  const src = db9b[row * 16 + g] ?? 0;
  const f = minor & 3;
  if (f === 0) return (src & 0xc0) >> 1;
  if (f === 1) return (src & 0x30) << 1;
  if (f === 2) return (src & 0x0c) << 3;
  return (src & 0x03) << 5;
}

/**
 * Densify one level's region/major/minor cell list (raw `data/maze.json`
 * shape, `decode-maze.ts`) into a flat grid, tight-cropped to the active
 * regions' bounding box. `major`/`minor` place a cell within its region:
 * **global Y = originY + (7 - major)`, global X = originX + minor`** (the
 * confirmed major-axis reversal, §3.14.8). Off-map cells hold the game's
 * own level-load seeds (wall 0, feature `$80:DB8D[level]`) rather than a
 * synthetic "solid" fill -- matching `$8B:DE64`/`$80:D2D3`. `da2e`/`db9b`
 * (from `view-pieces.json`'s `tables`) give the real per-region variant
 * (§3.14.12 v3); `seedVariant` (the level's `$80:DB7F` default) fills
 * off-map cells only.
 */
export function densifyMazeLevel(level: MazeLevelRaw, seedFeature: number, da2e: number[], db9b: number[], seedVariant: number): DenseMazeGrid {
  const usedRegions = new Set(level.cells.map((c) => c.region));
  const origins = level.origins.filter((_, i) => usedRegions.has(i));
  const minX = Math.min(...origins.map((o) => o.x));
  const minY = Math.min(...origins.map((o) => o.y));
  const maxX = Math.max(...origins.map((o) => o.x + 7));
  const maxY = Math.max(...origins.map((o) => o.y + 7));

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const wall = new Uint8Array(width * height); // seed: wall 0 (open), the game's own fill
  const feature = new Uint8Array(width * height).fill(seedFeature);
  const variant = new Uint8Array(width * height).fill(seedVariant);

  for (const cell of level.cells) {
    const origin = level.origins[cell.region];
    if (!origin) continue;
    const gx = origin.x + cell.minor - minX;
    const gy = origin.y + (7 - cell.major) - minY;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
    const idx = gy * width + gx;
    wall[idx] = cell.wall;
    feature[idx] = cell.feature;
    variant[idx] = resolveCellVariant(da2e, db9b, level.level, cell.region, cell.major, cell.minor);
  }

  return { width, height, wall, feature, seedFeature, variant, seedVariant, originX: minX, originY: minY };
}

/**
 * Resolve which of the level's 12 regions contains global cell `(gx,gy)`,
 * plus the cell's local `(major,minor)` within it -- the same bounding-box
 * scan the game runs at `$80:D0C2`-`$80:D0DE` (regions tried in ascending
 * order, first match wins). Returns `null` if no region contains the cell
 * (matches the ROM's own out-of-region fallback path).
 */
export function resolveRegionForCell(level: MazeLevelRaw, gx: number, gy: number): { region: number; major: number; minor: number } | null {
  for (let region = 0; region < level.origins.length; region++) {
    const o = level.origins[region];
    if (!o) continue;
    const minor = gx - o.x;
    if (minor < 0 || minor > 7) continue;
    const flipped = gy - o.y; // = 7 - major
    if (flipped < 0 || flipped > 7) continue;
    return { region, major: 7 - flipped, minor };
  }
  return null;
}

// CORRECTION (this session, §3.14.12 v4): an earlier draft of this module
// shipped a `resolveRegionPaletteGroup` that assumed `$82:F842`'s stored
// record `key` was a small `(minor<<4)|(7-major)` in-region local offset
// (0-119), found the real stored keys were all far larger (9793-53521),
// and concluded the field couldn't be a per-cell function at all -- WRONG:
// that comparison checked the FULL 16-bit key against the range only its
// LOW byte should occupy. Re-disassembling `$82:F878`-`$82:F883` (the
// $43-byte setup immediately preceding the table scan) found:
//
//   $82:F878  SEP #$20
//   $82:F87A  LDA $0905        ; dungeon level (0-13)
//   $82:F87D  ASL x4           ; level << 4
//   $82:F881  ORA $c0          ; direct-page $c0, NOT an immediate -- see below
//   $82:F883  STA $43          ; high byte of the 16-bit key ($42/$43)
//
// `$c0` is set by the SAME bounding-box region-scan that resolves `$be`
// (file 0x0050f6, `STA $c0` right after `TXA; EOR #$00FF; ADC #$000C`
// recovers the ascending region index from the scan's descending counter)
// -- i.e. `$c0` holds the plain 0-11 region index, not a pre-scaled offset
// like `$be`. So the full key is:
//
//   key = ((level << 4) | region) << 8 | ((dy << 4) | dx)
//
// Verified against every real record: 0/170 `>=0x50` records violate
// `region <= 11`, `keyHigh >> 4 == level`, or `keyLow <= 0x77`, across all
// 14 levels (`region-env.json`'s own export-time census reports the same
// 0 violations). Every environment record is therefore addressable by
// (level, region, local dy, local dx) -- see `resolveRegionPaletteGroup`
// below, and the caveat there about within-region path-dependence.

/** `dungeon/level-palettes.json`'s shape (§3.14.12 v4). */
export interface LevelPalettesFile {
  /** Per-level fallback group -- the level's own most-common palette group among its `$82:F842` records (or the global default `40` if it has none). */
  groups: number[];
  /** `perRegion[level][region]` = that region's own majority group, or `-1` if the level has no record for that region (callers fall back to `groups[level]`). */
  perRegion: number[][];
}

/**
 * §3.14.12 v4: resolve the palette group for a specific region of a level,
 * falling back to the level's own dominant group when that region has no
 * `$82:F842` environment record. `region` may be `null` (party position
 * outside every known region, e.g. an off-grid seed cell).
 *
 * Caveat (real, not just an approximation gap): `$82:F842` only actually
 * re-runs at 7 hardcoded scripted screen-fade transitions engine-wide, not
 * on every region crossing -- so a region's TRUE in-game palette at any
 * given moment depends on which entry/exit trigger the party last crossed,
 * not just "which region contains them right now". Where a region carries
 * more than one distinct triggered group (real for a handful of regions,
 * e.g. level 12 region 1: group 42 x2 vs. group 52 x1), this resolves to
 * the region's own majority vote -- a real improvement over the old
 * per-level-only approximation, but still an approximation for those
 * specific multi-trigger regions. See `docs/wizardry6/TODO.md`.
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

const FACING_DELTAS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: 1 }, // 0 = N (+Y)
  { dx: 1, dy: 0 }, // 1 = E (+X)
  { dx: 0, dy: -1 }, // 2 = S (-Y)
  { dx: -1, dy: 0 }, // 3 = W (-X)
];

export function stepForward(x: number, y: number, facing: number, depth: number): { x: number; y: number } {
  const d = FACING_DELTAS[facing]!;
  return { x: x + d.dx * depth, y: y + d.dy * depth };
}

function inBounds(grid: DenseMazeGrid, x: number, y: number): boolean {
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

function cellWallByte(grid: DenseMazeGrid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.wall[y * grid.width + x]! : 0;
}

function cellFeatureByte(grid: DenseMazeGrid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.feature[y * grid.width + x]! : grid.seedFeature;
}

/** The real `$7E:4780`-equivalent variant byte for a cell (§3.14.12 v3, `resolveCellVariant`). Off-grid cells use the level's `$80:DB7F` seed. */
function cellVariantByte(grid: DenseMazeGrid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.variant[y * grid.width + x]! : grid.seedVariant;
}

/** Whether the party can step one cell in compass direction `dir` from `(x, y)` -- open iff that direction's wall sub-field is 0 (in-grid only). */
export function canStepSnes(grid: DenseMazeGrid, x: number, y: number, dir: 0 | 1 | 2 | 3): boolean {
  const dest = stepForward(x, y, dir, 1);
  if (!inBounds(grid, dest.x, dest.y)) return false;
  return wallForFacing(cellWallByte(grid, x, y), dir) === 0;
}

// ─────────────────────────────────────────────────────────────────────────
// The faithful view walk ($80:C69F, §3.14.12).
// ─────────────────────────────────────────────────────────────────────────

/** ROM dispatch tables exported by `export-dungeon-view.ts` (all byte/word arrays read straight from the ROM at the doc-cited offsets). */
export interface WalkTables {
  /** `$80:DD4B`: 4 facings x 26 frustum slot offsets, decomposed by the exporter into `(ahead, lateral)` pairs (grid-unit-free). */
  frustum: Array<{ ahead: number; lateral: number }>;
  de1b: number[]; // $80:DE1B second-stage byte per code 0-15
  de2c: number[]; // $80:DE2C see-through/visibility byte per code (bit7 = sfx trigger, masked off by the exporter)
  de3d: number[]; // $80:DE3D front-deferral gate per code
  de4e: number[]; // $80:DE4E (code*2+variant)&0xFE -> record byte offset (69 entries)
  db7f: number[]; // per-level default variant byte ($0e)
  db8d: number[]; // per-level feature seed byte
  c85e: number[]; // per-slot $78 flush flags (index 1-26)
}

export type HandlerSpec =
  | { kind: 'side'; side: 'L' | 'R'; table: string; enable: number }
  | { kind: 'front'; edgeL: string; front: string; edgeR: string; enAhead: number; enLeft: number; enRight: number }
  | { kind: 'lat'; side: 'L' | 'R'; perp: string; enPerp: number; sideTable: string; enSide: number };

export interface WalkRecord {
  /** The record's 39 u16 words (byte offsets 0-0x4C). */
  words: number[];
  /** The 4 per-facing override bytes at record offsets 0x4C-0x4F (door/gate far-side art swap, §3.14.12). */
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
  /** Slot 0's own-cell edge/front tables (`$c879`): left `$89:F356`, right `$89:F6C6`, front `$89:EB1A`. */
  slot0: { left: string; right: string; front: string };
  records: Record<string, WalkRecord>;
  /** `$80:DED8` kind table: 21 entries, each the key of a 27-word per-slot floor/ceiling piece table. */
  ded8: string[];
  fcTables: Record<string, number[]>;
  /** Every referenced compose word, resolved (hex-keyed). Words that resolve to nothing drawable (e.g. the odd `0x101` sentinel) are absent. */
  pieces: Record<string, ViewPiece>;
  doorWord: number; // 0x02E8
  backdropWord: number; // 0x834A -- appended last (painter's-algorithm backstop)
  /** Per-level `$80:DB7F` default variant byte -- used ONLY as the off-map/out-of-region seed (`DenseMazeGrid.seedVariant`); real in-grid cells resolve via `resolveCellVariant`/`$80:DA2E` instead (§3.14.12 v3). */
  variants: number[];
  /** `$80:DA2E`, 168 entries (`level*12+region`) -- the real per-region variant/art-family selector (§3.14.12 v3). */
  da2e: number[];
  /** `$80:DB9B`, flat `(maxRow+1)*16`-byte pattern-row table referenced by `da2e`'s bit-7-set entries. */
  db9b: number[];
}

interface WalkState {
  grid: DenseMazeGrid;
  t: WalkTables;
  f: ViewPiecesFile;
  facing: number;
  level: number;
  parity: number; // $8e: ((x^y^facing)&1)*2
  e0: number; // $0e = db7f[level] (off-grid/level-default seed only; see cellVariantByte for the real per-cell source)
  words: number[];
  vis: number[]; // $7e3b00 skip flags, 1 = skip
  p78: number; // deferred front piece
  slot: number;
  slotX: number;
  slotY: number;
  v42: number;
  v43: number;
  /** $c9 != 0: the party's own cell carries the >=0xC0 marker ("darkness" zone) -- every $cc48 append is suppressed. */
  partyMarked: boolean;
}

function slotCell(s: WalkState, px: number, py: number, slot: number): { x: number; y: number } {
  const fr = s.f.tables.frustum[slot - 1]!;
  const a = FACING_DELTAS[s.facing]!;
  const r = FACING_DELTAS[(s.facing + 1) % 4]!;
  return { x: px + fr.ahead * a.dx + fr.lateral * r.dx, y: py + fr.ahead * a.dy + fr.lateral * r.dy };
}

/** role offsets rotate the compass: ahead=+0, right=+1, behind=+2, left=+3. */
const ROLE_OFFSET = { ahead: 0, right: 1, behind: 2, left: 3 } as const;
type Role = keyof typeof ROLE_OFFSET;

function evaluate(s: WalkState, x: number, y: number, role: Role): number {
  const dir = ((s.facing + ROLE_OFFSET[role]) % 4) as 0 | 1 | 2 | 3;
  const w = wallForFacing(cellWallByte(s.grid, x, y), dir);
  const raw = cellFeatureByte(s.grid, x, y) & 0x3f;
  let code = w;
  if (raw !== 0) {
    const lowf = raw & 0x0f;
    if (lowf === 6) {
      if (s.slot === 3) s.words.push(s.f.doorWord);
    } else if ((raw >> 4) === dir && lowf < 13) {
      code = lowf + 3;
    }
  }
  s.v42 = s.t.de1b[code]!;
  if (code === 12 && s.slot < 6) s.v42 = 4;
  s.v43 = s.t.de2c[code]! & 0x7f;
  return code;
}

/** $00:CC72 -- resolve one draw into a piece word. `a2x` = the doubled code ($0f); `farRole` = which neighbour of the slot cell supplies variant/marker state (left/ahead/right). */
function resolveWord(s: WalkState, table: string, a2x: number, farRole: Role): number {
  const rec = s.f.records[table];
  if (!rec) return 0xffff;
  const dir = ((s.facing + ROLE_OFFSET[farRole]) % 4) as 0 | 1 | 2 | 3;
  const d = FACING_DELTAS[dir]!;
  const fx = s.slotX + d.dx;
  const fy = s.slotY + d.dy;
  const farFeat = cellFeatureByte(s.grid, fx, fy);
  // marked-cell extra ($cc8f): raw >= 0xC0 and code==2 -> append rec word at byte offset 0x44
  if (farFeat >= 0xc0 && a2x === 4) {
    const extra = rec.words[0x44 >> 1];
    if (extra !== undefined && extra !== 0xffff) s.words.push(extra);
  }
  // the evaluated (slot) cell's own real per-cell variant (§3.14.12 v3) --
  // NOT yet the full $ccde fork (evaluated-cell-equals-level-default ->
  // use the far cell's variant instead), which needs a byte-exact trace of
  // $00:CC72's own comparison target; still-open minor nuance, see the doc.
  const variant = cellVariantByte(s.grid, s.slotX, s.slotY);
  // per-facing override (door/gate far-side art swap)
  let idx: number | null = null;
  if (rec.override[s.facing]! !== 0) {
    if (a2x === 0x14) idx = 0x84;
    else if (a2x === 0x06) idx = variant === 0x60 ? 0x88 : 0x86;
  }
  if (idx === null) {
    idx = (a2x + variant) & 0xff;
  }
  const k = (idx & 0xfe) >> 1;
  const byteOff = s.t.de4e[k];
  if (byteOff === undefined) return 0xffff;
  const w = rec.words[byteOff >> 1];
  return w === undefined ? 0xffff : w;
}

/** $cc48-style append (skipped when the party or slot cell carries the >=0xC0 marker). */
function drawAppend(s: WalkState, table: string, a2x: number, farRole: Role): void {
  if (s.partyMarked) return;
  if (cellFeatureByte(s.grid, s.slotX, s.slotY) >= 0xc0) return;
  const w = resolveWord(s, table, a2x, farRole);
  if (w !== 0xffff) s.words.push(w);
}

/** $cc0f-style front draw: DE3D-gated deferral into $78, else append. */
function drawFront(s: WalkState, table: string, a2x: number): void {
  const code = a2x >> 1;
  if (code < 16 && s.t.de3d[code]) {
    const w = resolveWord(s, table, a2x, 'ahead');
    if (w !== 0xffff) s.p78 = w;
    return;
  }
  drawAppend(s, table, a2x, 'ahead');
}

/** The DE1B-driven second (and third) draws shared by every handler. */
function secondDraws(s: WalkState, table: string, farRole: Role, front: boolean): void {
  if (s.v42 === 0) return;
  const a = s.v42 === 4 ? s.parity * 2 : s.v42;
  if (front) drawFront(s, table, a);
  else drawAppend(s, table, a, farRole);
  if (s.v42 === 0x18 && s.slot < 6) {
    if (front) drawFront(s, table, 4);
    else drawAppend(s, table, 4, farRole);
  }
}

/** Front-handler edge draw ($cc3b/$cc45 entries with the $8e parity substitution for code 2). */
function edgeDraw(s: WalkState, table: string, code: number, farRole: Role): void {
  const a = code === 2 ? s.parity : code;
  drawAppend(s, table, a * 2, farRole);
  secondDraws(s, table, farRole, false);
}

function runHandler(s: WalkState, spec: HandlerSpec): void {
  if (spec.kind === 'side') {
    const code = evaluate(s, s.slotX, s.slotY, 'ahead');
    if (code === 0) {
      if (spec.enable) s.vis[spec.enable] = 0;
      return;
    }
    drawAppend(s, spec.table, code * 2, 'ahead');
    if (s.v43 === 0 && spec.enable) s.vis[spec.enable] = 0;
    secondDraws(s, spec.table, 'ahead', false);
  } else if (spec.kind === 'front') {
    let code = evaluate(s, s.slotX, s.slotY, 'left');
    if (code === 0) {
      if (spec.enLeft) s.vis[spec.enLeft] = 0;
    } else edgeDraw(s, spec.edgeL, code, 'left');
    code = evaluate(s, s.slotX, s.slotY, 'right');
    if (code === 0) {
      if (spec.enRight) s.vis[spec.enRight] = 0;
    } else edgeDraw(s, spec.edgeR, code, 'right');
    code = evaluate(s, s.slotX, s.slotY, 'ahead');
    if (code === 0) {
      if (spec.enAhead) s.vis[spec.enAhead] = 0;
      return;
    }
    drawFront(s, spec.front, code * 2);
    if (s.v43 === 0 && spec.enAhead) s.vis[spec.enAhead] = 0;
    secondDraws(s, spec.front, 'ahead', true);
  } else {
    // lateral: perpendicular (ahead-face) eval + receding-side eval
    let code = evaluate(s, s.slotX, s.slotY, 'ahead');
    if (code === 0) {
      if (spec.enPerp) s.vis[spec.enPerp] = 0;
    } else {
      drawAppend(s, spec.perp, code * 2, 'ahead');
      if (s.v43 === 0 && spec.enPerp) s.vis[spec.enPerp] = 0;
      secondDraws(s, spec.perp, 'ahead', false);
    }
    const role: Role = spec.side === 'L' ? 'left' : 'right';
    code = evaluate(s, s.slotX, s.slotY, role);
    if (code === 0) {
      if (spec.enSide) s.vis[spec.enSide] = 0;
      return;
    }
    const a = code === 2 ? s.parity : code;
    drawAppend(s, spec.sideTable, a * 2, role);
    secondDraws(s, spec.sideTable, role, false);
  }
}

/** The floor/ceiling pass ($00:CE4C) for one slot. */
function fcCell(s: WalkState, x: number, y: number, slot: number): void {
  const raw = cellFeatureByte(s.grid, x, y);
  const variant = cellVariantByte(s.grid, x, y);
  const yv = ((variant & 0x60) >> 2) | s.parity;
  let ceil: number;
  let floor: number;
  if (raw === 0x8f) {
    ceil = 0x10;
    floor = s.parity + 0x26;
  } else if (raw === 0x8e) {
    ceil = 0x24;
    floor = yv + 4;
  } else if (raw === 0x4e) {
    ceil = 0x24;
    floor = 0x20;
  } else if ((raw & 0xc0) === 0x40 && raw >= 0x40) {
    ceil = yv;
    floor = 0x22; // stairs/pit family ($7E:DBC0 flag not modelled -> the non-flagged branch)
  } else {
    const lowf = raw & 0x0f;
    if (lowf === 0x0d) {
      ceil = 0x10;
      floor = 0x20;
    } else if (lowf === 0x0e) {
      ceil = yv;
      floor = 0x20;
    } else {
      ceil = yv;
      floor = yv + 4;
    }
  }
  for (const kind of [ceil, floor]) {
    const key = s.f.ded8[kind >> 1];
    if (!key) continue;
    const tab = s.f.fcTables[key];
    if (!tab) continue;
    const w = tab[slot];
    if (w !== undefined && w !== 0 && w !== 0xffff) s.words.push(w);
  }
}

/**
 * Resolve one pose into the game's own ordered compose-word list
 * (near-to-far -- the FIRST piece to claim a cell wins, per §3.14.4's
 * painter's algorithm; `compositeSnesView` implements that order).
 */
export function resolveViewWords(f: ViewPiecesFile, grid: DenseMazeGrid, level: number, x: number, y: number, facing: number): number[] {
  const s: WalkState = {
    grid,
    t: f.tables,
    f,
    facing,
    level,
    parity: (((x + grid.originX) ^ (y + grid.originY) ^ facing) & 1) * 2,
    e0: f.tables.db7f[level] ?? 0,
    words: [],
    vis: new Array(27).fill(1),
    p78: 0,
    slot: 0,
    slotX: x,
    slotY: y,
    v42: 0,
    v43: 0,
    partyMarked: cellFeatureByte(grid, x, y) >= 0xc0,
  };
  const marked = s.partyMarked;

  // slot 0 ($c879): own-cell left/right edges + front edge
  s.slot = 0;
  s.slotX = x;
  s.slotY = y;
  let code = evaluate(s, x, y, 'left');
  if (code === 0) s.vis[1] = 0;
  else edgeDraw(s, f.slot0.left, code, 'left');
  code = evaluate(s, x, y, 'right');
  if (code === 0) s.vis[2] = 0;
  else edgeDraw(s, f.slot0.right, code, 'right');
  code = evaluate(s, x, y, 'ahead');
  if (code === 0) s.vis[3] = 0;
  else {
    drawFront(s, f.slot0.front, code * 2);
    if (s.v43 === 0) s.vis[3] = 0;
    secondDraws(s, f.slot0.front, 'ahead', true);
  }

  // slots 1-26
  for (let slot = 1; slot <= 26; slot++) {
    s.slot = slot;
    if (s.vis[slot] === 0) {
      const spec = f.handlers[slot];
      const c = slotCell(s, x, y, slot);
      s.slotX = c.x;
      s.slotY = c.y;
      if (spec) runHandler(s, spec);
    }
    if (f.tables.c85e[slot]) {
      const blocked = marked || cellFeatureByte(grid, s.slotX, s.slotY) >= 0xc0;
      if (!blocked && s.p78) s.words.push(s.p78);
      s.p78 = 0;
    }
  }

  // floor/ceiling pass (all slots when the party cell is unmarked; §3.14.12)
  if (!marked) {
    s.slot = 0;
    fcCell(s, x, y, 0);
    for (let slot = 1; slot <= 26; slot++) {
      const c = slotCell(s, x, y, slot);
      fcCell(s, c.x, c.y, slot);
    }
  }

  s.words.push(f.backdropWord);
  return s.words;
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

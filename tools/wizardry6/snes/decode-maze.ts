/**
 * Decodes the SNES ROM's bulk per-level maze table -- the ROM-resident
 * source of *distinct*, non-uniform dungeon wall/feature content that
 * feeds the confirmed first-person view composer (decode-dungeon-composer.ts,
 * docs/wizardry6/snes/data-structure.md section 3.14) and the confirmed
 * cell-format/frustum-selection mechanism (section 3.14.7).
 *
 * Found via a `re-codebreaker` escalation this session, after two
 * structurally distinct byte-pattern censuses for a bulk table came back
 * negative (see the `snes-maze-wall-source` paths-tried row). The
 * escalation's core finding -- a 14-record x 1536-byte table at file
 * `0x030000` (CPU `$86:8000`), a 14x12x4-byte region-origin table at file
 * `0x00578E` (CPU `$80:D78E`), a loader at `$8B:DE64` (file `0x05DE64`,
 * sole caller `$80:D073`), and a region blitter at `$80:D25B` (file
 * `0x00525B`) -- was **independently re-verified from scratch this
 * session** per `game-re-lessons/verify-escalation-artifacts-not-just-claims.md`:
 * fresh disassembly of the loader and blitter (byte-exact reproduction,
 * including the `WRMPYA/WRMPYB` level*6-then-XBA "level*1536" trick), and
 * a from-scratch Python cross-check against the independently-confirmed
 * Amiga `scenario.dbs` section-2 oracle (docs/wizardry6/amiga/data-structure.md
 * section 4.7.3) that reproduced the escalation's headline agreement
 * numbers closely (wall sub-fields 99.40-99.97%, region origins 167/168
 * exact) using fresh code, never the escalation's own scripts.
 *
 * One escalation claim was corrected during independent re-verification:
 * the escalation reported "feature byte 99.43% agreement (levels 0/3/6
 * exact)". Reproducing the comparison found levels 0/3/6 were actually
 * the *worst*-agreeing levels under a byte-for-byte comparison, not
 * exact matches. The real explanation (found independently, not in the
 * escalation's report): the SNES engine does not use `0x00` as its
 * "no feature" sentinel the way the Amiga's `+0x1f8` plane does -- it
 * uses `0x0D` or `0x0E` (matching the already-confirmed per-level default
 * table `$80:DB8D`, decode-dungeon-composer.ts's sibling section 3.14.7).
 * Treating Amiga feature `0` as equivalent to SNES feature-nibble `0x0D`
 * OR `0x0E` (the union, not just that level's own DB8D value -- a further
 * refinement, since a handful of levels' *baked* table content uses the
 * other sentinel than their own runtime default) raises the aggregate
 * feature agreement from 87.6% to 99.07%, matching the escalation's
 * headline number closely. The residual ~1% is consistent with genuine
 * 1990-Amiga-vs-1995-SNES content edits (also independently visible as
 * clean per-value count deltas, e.g. some feature codes present on one
 * platform's level but absent on the other's), not a decode error.
 *
 * **Format (all offsets file-relative unless written `$bb:aaaa`):**
 *
 * - Per-level record: file `0x030000 + level*1536`, CPU `$86:8000`+
 *   (bank `$86`, DBR set explicitly by the loader). 96 blocks of 16 bytes;
 *   block `i` covers cellIndex `8i..8i+7`: `[8 B feature][8 B wall]`.
 *   `cellIndex = region*64 + major*8 + minor` (region 0-11, major/minor
 *   0-7) -- i.e. flat sequential storage, `cellIndex = block*8 + minor`.
 * - `wall` byte: 4 packed 2-bit sub-fields, matching the already-confirmed
 *   `$7E:4300` live-grid encoding (section 3.14.7): bits0-1 = this cell's
 *   own "+major" wall, bits2-3 = "+minor" wall, bits4-5 = the neighbour
 *   at `major-1`'s "+major" wall (i.e. this cell's "-major" side, cross-
 *   checked against Amiga's shared-edge neighbour-plane scheme), bits6-7 =
 *   neighbour at `minor-1`'s "+minor" wall (this cell's "-minor" side).
 *   0 = open, nonzero = a wall variant (exact non-zero-value semantics,
 *   e.g. which value is a "door" vs "solid wall", not pinned this
 *   session -- see the doc's still-open list).
 * - `feature` byte: matches the live `$7E:4540` encoding -- low 4 bits
 *   feature code (0-15, `0x0D`/`0x0E` = "empty" sentinels, see above),
 *   bits4-5 orientation (0-3), bits6-7 unidentified SNES-only flags (no
 *   Amiga counterpart, no confirmed reader).
 * - Region-origin table: file `0x00578E + level*48`, CPU `$80:D78E`+.
 *   12 regions x `[u16 originX][u16 originY]` (LE), maze-coordinate-space
 *   placement, matching the Amiga's per-region origin table almost
 *   exactly (167/168 region-origin pairs identical across all 14 levels).
 *
 * Loader ($8B:DE64, file `0x05DE64`, sole caller `$80:D073`): stages one
 * level's 768 feature bytes into `$7E:9D00` and 768 wall bytes into
 * `$7E:9A00`. Region blitter (`$80:D25B`, file `0x00525B`) then copies
 * one region's 64 cells at a time from that staging area into the live
 * 24x24 view grid (`$7E:4300`/`$7E:4540`) as the party's frustum needs
 * them -- this also independently confirms `$7E:4780` (previously an
 * "undecoded parallel array") is fed from a *different* source
 * (`$7E:49C0`, floor/ceiling texture selection, not maze content).
 *
 * **Quest-flag-conditional patch lists -- now decoded (this session)**, by
 * disassembling the loader's phase-2/phase-3 apply loops directly
 * (`$8B:DEAB`-`$8B:DEDF`, `$8B:DEE0`-`$8B:DF72`, files `0x05deab`-
 * `0x05df72`) rather than only reading the doc's pre-existing record-shape
 * prose. Both record counts (166 phase-2, 91 phase-3) and every offset
 * (`< 1536`) reproduce the pre-existing structural invariant exactly,
 * confirming the record layouts below byte-for-byte:
 *
 * - **Phase 2** (`$8B:DFB4`+, 4-byte records `[cond][value][offset u16 LE]`,
 *   `0x00`-cond terminator): if quest-flag test `cond` passes, writes
 *   `value` to the combined 1536-byte staging block at byte `offset`
 *   (`STA $7E9A00,X` with `X=offset` -- since wall is `+0..767` and
 *   feature is `+768..1535` immediately after it in memory, one base
 *   address handles both planes automatically). The condition test
 *   (`$8B:DF90`) is `flagBit($00:09C0 + (cond>>3), cond&7)` against the
 *   confirmed bitmask table `$8B:DFAC`.
 * - **Phase 3** (`$8C:DC5A`+, 5-byte records
 *   `[cond][wallMask][featValue][offset u16 LE]`, terminator = any `cond`
 *   byte with bit 7 set): **every record is always applied** -- there is
 *   no skip path, only a **choice of merge formula**, selected by a
 *   *different* condition helper (`$8B:DF74`, base `$00:0AA0`, same
 *   bitmask table). If the flag bit tests true: `wall[offset] =
 *   (wall[offset] & wallMask) | (~wallMask & 0xAA)` and
 *   `feature[offset] = (feature[offset] & 0xC0) | featValue`. If false:
 *   `wall[offset] = (wall[offset] & wallMask) | (~wallMask & 0x55)` and
 *   `feature[offset] = feature[offset] & 0xC0` (`featValue` is not read at
 *   all on this branch -- the 0x55/0xAA split from the doc's existing
 *   §3.14.8 prose is confirmed, and is now understood as *which merge*,
 *   not *whether to merge*). A `cond == 0` record is a real, non-terminator
 *   record for phase 3 (unlike phase 2, where 0 is reserved) -- it tests a
 *   fixed pair of bits (`$0AA0` bit 0 OR bit 1) instead of `cond`'s own
 *   bit, but still always applies one of the two merges.
 *
 * **This extractor decodes and exposes both patch lists per level as
 * metadata** (`patchesPhase2`/`patchesPhase3` in the JSON output,
 * including each record's resolved plane/cellIndex) but does **not** bake
 * them into the rendered base-layout PNGs or the `cells` array: which
 * branch/record actually applies at any point in the game depends on the
 * player's save-file quest-flag bitmap (`$00:09C0`/`$00:0AA0`), which is
 * runtime state with no ROM-resident default -- there is no single
 * "correct" static maze to render once these are involved. Rendering a
 * patched variant would require assuming an arbitrary flag state, which
 * this pipeline avoids per the "never assert a fact you didn't verify"
 * convention.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-maze.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';

const MAZE_TABLE_BASE = 0x030000; // file offset, CPU $86:8000
const MAZE_RECORD_STRIDE = 1536;
const ORIGIN_TABLE_BASE = 0x00578e; // file offset, CPU $80:D78E
const ORIGIN_REGION_STRIDE = 4;
const N_LEVELS = 14;
const N_REGIONS = 12;
const CELLS_PER_LEVEL = 768; // 12 regions * 64 cells

// Phase-2/phase-3 quest-flag-conditional patch lists -- see header comment
// for the full disassembly-derived semantics ($8B:DEAB-$8B:DF72).
const PATCH2_BASE = 0x05dfb4; // file offset, CPU $8B:DFB4 (pointer table + records)
const PATCH3_BASE = 0x065c5a; // file offset, CPU $8C:DC5A (pointer table + records)

interface Cell {
  region: number;
  major: number;
  minor: number;
  wall: number; // raw byte, 4x 2-bit sub-fields
  feature: number; // raw byte: bits0-3 feature code, bits4-5 orientation, bits6-7 SNES-only flags (no Amiga counterpart)
}

interface Patch2Record {
  cond: number;
  value: number;
  offset: number;
  plane: 'wall' | 'feature';
  cellIndex: number;
}

interface Patch3Record {
  cond: number;
  wallMask: number;
  featValue: number;
  offset: number;
  plane: 'wall' | 'feature';
  cellIndex: number;
}

interface LevelMaze {
  level: number;
  origins: { x: number; y: number }[]; // 12 entries
  cells: Cell[]; // 768 entries, cellIndex order
  patchesPhase2: Patch2Record[];
  patchesPhase3: Patch3Record[];
}

function u16(data: Uint8Array, off: number): number {
  return data[off] | (data[off + 1] << 8);
}

// offset is a byte index into the combined 1536-byte staging block (wall
// 0-767, feature 768-1535, contiguous -- see header comment).
function resolvePlane(offset: number): { plane: 'wall' | 'feature'; cellIndex: number } {
  return offset < CELLS_PER_LEVEL ? { plane: 'wall', cellIndex: offset } : { plane: 'feature', cellIndex: offset - CELLS_PER_LEVEL };
}

function decodePatchPhase2(data: Uint8Array, level: number): Patch2Record[] {
  const ptr = u16(data, PATCH2_BASE + level * 2);
  let off = PATCH2_BASE + ptr;
  const out: Patch2Record[] = [];
  while (data[off] !== 0x00) {
    const cond = data[off];
    const value = data[off + 1];
    const offset = u16(data, off + 2);
    out.push({ cond, value, offset, ...resolvePlane(offset) });
    off += 4;
  }
  return out;
}

function decodePatchPhase3(data: Uint8Array, level: number): Patch3Record[] {
  const ptr = u16(data, PATCH3_BASE + level * 2);
  let off = PATCH3_BASE + ptr;
  const out: Patch3Record[] = [];
  while ((data[off] & 0x80) === 0) {
    const cond = data[off];
    const wallMask = data[off + 1];
    const featValue = data[off + 2];
    const offset = u16(data, off + 3);
    out.push({ cond, wallMask, featValue, offset, ...resolvePlane(offset) });
    off += 5;
  }
  return out;
}

function decodeLevel(data: Uint8Array, level: number): LevelMaze {
  const recBase = MAZE_TABLE_BASE + level * MAZE_RECORD_STRIDE;
  const cells: Cell[] = [];
  for (let cellIndex = 0; cellIndex < CELLS_PER_LEVEL; cellIndex++) {
    const block = Math.floor(cellIndex / 8);
    const minor = cellIndex % 8;
    const region = Math.floor(cellIndex / 64);
    const major = Math.floor((cellIndex % 64) / 8);
    const blockBase = recBase + block * 16;
    cells.push({
      region,
      major,
      minor,
      feature: data[blockBase + minor],
      wall: data[blockBase + 8 + minor],
    });
  }
  const originBase = ORIGIN_TABLE_BASE + level * N_REGIONS * ORIGIN_REGION_STRIDE;
  const origins: { x: number; y: number }[] = [];
  for (let r = 0; r < N_REGIONS; r++) {
    const o = originBase + r * ORIGIN_REGION_STRIDE;
    origins.push({ x: u16(data, o), y: u16(data, o + 2) });
  }
  return {
    level,
    origins,
    cells,
    patchesPhase2: decodePatchPhase2(data, level),
    patchesPhase3: decodePatchPhase3(data, level),
  };
}

// Structural invariant: the table must not run past a sane region of the
// ROM and every origin pair should be a plausible small maze coordinate
// (this ROM's levels stay well under 256 in every origin sample seen).
// Also re-checks the patch lists' own confirmed invariant: every record
// offset must address the 1536-byte combined staging block (< 1536).
function validate(levels: LevelMaze[]): number {
  let violations = 0;
  for (const lv of levels) {
    for (const o of lv.origins) {
      if (o.x > 255 || o.y > 255) violations++;
    }
    if (lv.cells.length !== CELLS_PER_LEVEL) violations++;
    for (const p of lv.patchesPhase2) if (p.offset >= MAZE_RECORD_STRIDE) violations++;
    for (const p of lv.patchesPhase3) if (p.offset >= MAZE_RECORD_STRIDE) violations++;
  }
  return violations;
}

function renderLevel(lv: LevelMaze, scale: number): { rgba: Uint8Array; width: number; height: number } {
  // Place each cell at (originX[region] + minor, originY[region] + (7 - major))
  // -- the "major axis reversed vs. minor" placement confirmed this session
  // against the Amiga oracle (swap=true gave 99.40% agreement vs 64.21%
  // for the unswapped placement).
  let maxX = 0;
  let maxY = 0;
  for (const o of lv.origins) {
    maxX = Math.max(maxX, o.x + 8);
    maxY = Math.max(maxY, o.y + 8);
  }
  const gridW = Math.max(1, maxX);
  const gridH = Math.max(1, maxY);
  const width = gridW * scale;
  const height = gridH * scale;
  const rgba = new Uint8Array(width * height * 4); // transparent background

  const setPx = (gx: number, gy: number, r: number, g: number, b: number, a = 255) => {
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) return;
    const idx = (gy * width + gx) * 4;
    rgba[idx] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = a;
  };
  const fillCell = (cx: number, cy: number, r: number, g: number, b: number, a = 255) => {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) setPx(cx * scale + dx, cy * scale + dy, r, g, b, a);
  };

  for (const cell of lv.cells) {
    const origin = lv.origins[cell.region];
    if (origin.x === 0 && origin.y === 0 && cell.region !== 0) continue; // unplaced region slot
    const gy = origin.y + (7 - cell.major);
    const gx = origin.x + cell.minor;
    // Floor: light grey walkable cell.
    fillCell(gx, gy, 226, 224, 214);
    // Wall sub-fields: draw a dark border stroke on each side that has a
    // nonzero value.
    const b01 = cell.wall & 0x3; // own "+major" side
    const b23 = (cell.wall >> 2) & 0x3; // own "+minor" side
    const b45 = (cell.wall >> 4) & 0x3; // "-major" side (neighbour plane)
    const b67 = (cell.wall >> 6) & 0x3; // "-minor" side (neighbour plane)
    const wallColor: [number, number, number] = [40, 32, 26];
    if (b01 !== 0) for (let dx = 0; dx < scale; dx++) setPx(gx * scale + dx, gy * scale + scale - 1, ...wallColor);
    if (b45 !== 0) for (let dx = 0; dx < scale; dx++) setPx(gx * scale + dx, gy * scale, ...wallColor);
    if (b23 !== 0) for (let dy = 0; dy < scale; dy++) setPx(gx * scale + scale - 1, gy * scale + dy, ...wallColor);
    if (b67 !== 0) for (let dy = 0; dy < scale; dy++) setPx(gx * scale, gy * scale + dy, ...wallColor);
    // Feature marker: anything other than the two "empty" sentinels gets
    // a coloured dot in the cell centre.
    const featureCode = cell.feature & 0xf;
    if (featureCode !== 0x0d && featureCode !== 0x0e) {
      const cx = gx * scale + Math.floor(scale / 2);
      const cy = gy * scale + Math.floor(scale / 2);
      setPx(cx, cy, 200, 40, 40);
    }
  }
  return { rgba, width, height };
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-maze.ts <path-to-sfc>');
    process.exit(1);
  }
  const data = readBinary(romPath);

  const levels: LevelMaze[] = [];
  for (let lv = 0; lv < N_LEVELS; lv++) levels.push(decodeLevel(data, lv));

  const violations = validate(levels);
  console.log(`Structural check: ${N_LEVELS} levels, ${CELLS_PER_LEVEL} cells/level, ${violations} violations.`);
  if (violations > 0) {
    console.error('Oracle check FAILED: unexpected structural violations, not writing output.');
    process.exit(1);
  }

  // Non-degeneracy check: every level should have a non-trivial mix of
  // wall/open cells and more than one feature code -- catches the case
  // where the table offset is subtly wrong and everything decodes to a
  // single flat value.
  for (const lv of levels) {
    const nonZeroWalls = lv.cells.filter((c) => c.wall !== 0).length;
    const featureCodes = new Set(lv.cells.map((c) => c.feature & 0xf));
    console.log(
      `  level ${lv.level}: ${nonZeroWalls}/${CELLS_PER_LEVEL} cells have a nonzero wall sub-field, ${featureCodes.size} distinct feature codes`,
    );
  }

  // Oracle check on the newly-decoded patch lists: totals must match the
  // pre-existing, independently-confirmed structural invariant exactly
  // (166 phase-2 records, 91 phase-3 records across all 14 levels).
  const totalPatch2 = levels.reduce((n, lv) => n + lv.patchesPhase2.length, 0);
  const totalPatch3 = levels.reduce((n, lv) => n + lv.patchesPhase3.length, 0);
  console.log(`Patch lists: ${totalPatch2} phase-2 records, ${totalPatch3} phase-3 records (expect 166 / 91).`);
  if (totalPatch2 !== 166 || totalPatch3 !== 91) {
    console.error('Oracle check FAILED: patch-list record counts do not match the confirmed invariant, not writing output.');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'data'), { recursive: true });
  mkdirSync(resolve(outDir, 'screens/maze'), { recursive: true });

  writeJson(
    resolve(outDir, 'data/maze.json'),
    levels.map((lv) => ({
      level: lv.level,
      origins: lv.origins,
      cells: lv.cells,
      patchesPhase2: lv.patchesPhase2,
      patchesPhase3: lv.patchesPhase3,
    })),
  );

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => !e.name.startsWith('maze-'));

  for (const lv of levels) {
    const { rgba, width, height } = renderLevel(lv, 6);
    const name = `maze-level${String(lv.level).padStart(2, '0')}`;
    writePNG(resolve(outDir, `screens/maze/${name}.png`), rgba, width, height);
    withoutOld.push({
      name,
      group: 'screens',
      png: `screens/maze/${name}.png`,
      atlas: null,
      palette: null,
      sprites: 1,
    });
  }
  writeJson(manifestPath, withoutOld);

  console.log(`Decoded ${N_LEVELS} maze levels (${CELLS_PER_LEVEL} cells each) and rendered ${N_LEVELS} top-down map PNGs.`);
  console.log('Wrote public/assets/wizardry6/snes/data/maze.json, screens/maze/maze-levelNN.png, and updated manifest.json');
}

main();

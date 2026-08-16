/**
 * Decodes Wizardry 6 (Amiga) `scenario.dbs` section 2 (file offset
 * 0x9408-0x9408+14*1346) as the per-level dungeon maze geometry.
 *
 * This overturns an earlier finding in this corpus: `scenario.dbs`
 * sections 2/3 were previously believed to be per-class UI data (a
 * character-creation "class info" screen) and the dungeon-level geometry
 * was flagged as an unlocated open question -- see the correction block in
 * docs/wizardry6/amiga/data-structure.md section 7.1 and the full section
 * 4.7 for the complete derivation (a `re-codebreaker` escalation found the
 * real evaluator functions, `CODE+0x9202`/`0x969a`/`0x9876`, which are
 * *siblings* of the already-confirmed per-cell dispatcher `CODE+0x9b58`,
 * not reachable from it in either direction -- which is why two prior
 * sessions' call-graph traces from `9b58` never found them).
 *
 * Section 2 is 14 maze levels (the 15th/16th of `master.hdr`'s declared 16
 * slots are always-zero padding, the same convention already established
 * for `msg.hdr`/the `.PIC` directory/section 4's monster table elsewhere
 * in this corpus). Each 1346-byte record covers a 256x256 maze coordinate
 * space via 12 fixed 8x8-cell "regions" (768 cells total), placed by an
 * explicit per-region origin table -- NOT a flat 2D grid.
 *
 * Record layout (partitions to exactly 1346 bytes with zero slack,
 * CONFIRMED):
 *
 *   +0x000  96 B   1 bit/cell   unidentified plane (hypothesis)
 *   +0x060  192 B  2 bits/cell  wall plane A (facing 0's wall value)
 *   +0x120  192 B  2 bits/cell  wall plane B (facing 1's wall value)
 *   +0x1e0  12 B   1 byte/region  region origin X (maze coords)
 *   +0x1ec  12 B   1 byte/region  region origin Y (maze coords)
 *   +0x1f8  384 B  4 bits/cell  feature code (0-15)
 *   +0x378  192 B  2 bits/cell  feature orientation (0-3)
 *   +0x438  2 B    scalar/padding (hypothesis)
 *   +0x43a  96 B   1 bit/cell   scripted-overlay flag P
 *   +0x49a  96 B   1 bit/cell   scripted-overlay flag Q
 *   +0x4fa  24 B   1 word/region  unidentified (hypothesis)
 *   +0x512  24 B   1 word/region  unidentified (hypothesis)
 *   +0x52a  24 B   1 word/region  unidentified (hypothesis)
 *
 * `cellIndex = region*64 + localY*8 + localX`, `localX = x - originX[region]`,
 * `localY = y - originY[region]` (both 0..7). Bit-field extraction is
 * LSB-first, matching the game's own `GetBitField(base, i, n)` primitive
 * (A4 jump-table entry 48, `CODE+0x29d6`): `bp = i*n; ((base[bp>>3] |
 * base[bp>>3+1]<<8) >> (bp&7)) & ((1<<n)-1)`.
 *
 * CONFIRMED (independently re-verified in the orchestrating session, not
 * taken on faith from the escalation):
 * - The 13-field partition tiles 0..1346 with zero gap/overlap.
 * - Zero overlapping cells among "active" regions (origin != (0,0)) across
 *   all 14 levels x 12 regions x 64 cells = 10,752 placements -- reproduced
 *   exactly from this module's own field offsets, independently of the
 *   escalation's script.
 * - Wall-plane and feature-code histograms match the escalation's reported
 *   numbers exactly (wallA: 0=7156, 1=197, 2=3316, 3=83; wallB: 0=7127,
 *   1=192, 2=3361, 3=72; feature 0 = 90.9%; orientation 0 = 93.8%).
 * - Cross-platform oracle: every geometry field (wallA/wallB/originX/
 *   originY/feature/orient/flagP/flagQ) is byte-for-byte IDENTICAL between
 *   this Amiga file and the DOS/EGA release's `scenario.dbs` at the same
 *   section-2 offset/stride, 0 mismatches across 2688+2688+168+168+5376+
 *   2688+1344+1344 = 17,464 compared bytes -- while the two files differ by
 *   14,777 bytes overall. Exactly what a byte-order-neutral, LSB-first
 *   bit-packed grid predicts for a shared-source cross-platform port (see
 *   `docs/wizardry6/dosega/data-structure.md` for that release's own
 *   confirmed layout).
 * - `newgame.dbs`'s first 43,204 bytes (14 x [1346-byte section-2 record +
 *   1740-byte section-3 record] starting at file offset 0x19e) are
 *   byte-for-byte identical to `scenario.dbs` sections 2 and 3 respectively
 *   -- 0/43204 mismatches, confirming `newgame.dbs` is the initial mutable
 *   maze-state template copied verbatim to `SAVEGAME.DBS` at "new game".
 * - Rendered: compositing each level's 12 regions by their maze-space
 *   origin produces recognisable dungeon architecture (rectangular rooms,
 *   corridors, doors, and on level 9 an unmistakable left-right
 *   mirror-symmetric room cluster) -- not noise. Value->meaning for the
 *   2-bit wall planes is now CONFIRMED cross-platform (the SNES port's
 *   full render dispatch + decisive art renders, snes/data-structure.md
 *   section 3.14.12, over byte-identical maze data): 0 = open,
 *   1 = open doorway (frame, see-through), 2 = solid wall, 3 = closed
 *   door (doorway + wooden leaf). The 4-bit feature-code meanings remain
 *   RENDERED-level (several identified by art on the SNES side: 1/2 =
 *   arched openings, 3 = globe lamp, 7 = portcullis gate).
 *
 * NOT decoded (open, tracked in docs/wizardry6/TODO.md):
 * - The `+0x000` 1-bit plane, the `+0x438` scalar, and the three
 *   `+0x4fa`/`+0x512`/`+0x52a` 12-word-per-region arrays.
 * - `scenario.dbs` section 3 (144-entry per-level entity table, structure
 *   confirmed but field semantics open -- see data-structure.md 4.7).
 * - Which wall plane (A vs B) corresponds to which absolute compass
 *   direction (confirmed only that facing 0 reads A, facing 1 reads B, and
 *   facings 2/3 read the *neighbouring* cell's A/B -- the neighbour-step
 *   direction itself wasn't independently confirmed this session).
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-maze.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';

const SECTION2_OFFSET = 0x9408;
const SECTION2_STRIDE = 1346;
const SECTION3_OFFSET = 0xe828;
const SECTION3_STRIDE = 1740;
const LEVEL_COUNT = 14;
const REGION_COUNT = 12;
const REGION_SIZE = 8; // 8x8 cells per region
const CELLS_PER_LEVEL = REGION_COUNT * REGION_SIZE * REGION_SIZE; // 768

const FIELD = {
  plane0: 0x000,
  wallA: 0x060,
  wallB: 0x120,
  originX: 0x1e0,
  originY: 0x1ec,
  feature: 0x1f8,
  orient: 0x378,
  scalar: 0x438,
  flagP: 0x43a,
  flagQ: 0x49a,
  w1: 0x4fa,
  w2: 0x512,
  w3: 0x52a,
} as const;
const FIELD_END = 0x542; // 1346, confirmed partition endpoint

/** LSB-first bit-field read, matching the game's own `GetBitField` primitive (A4 entry 48, CODE+0x29d6). */
function getBitField(data: Uint8Array, base: number, cellIndex: number, bits: number): number {
  const bitPos = cellIndex * bits;
  const byteOff = bitPos >> 3;
  const lo = data[base + byteOff] ?? 0;
  const hi = data[base + byteOff + 1] ?? 0;
  const word = lo | (hi << 8);
  return (word >> (bitPos & 7)) & ((1 << bits) - 1);
}

export interface MazeLevel {
  level: number;
  originX: number[]; // 12 regions
  originY: number[];
  /** 2-bit wall value per cell, cellIndex = region*64 + localY*8 + localX. */
  wallA: number[];
  wallB: number[];
  /** 4-bit feature code per cell (0-15). */
  feature: number[];
  /** 2-bit feature orientation per cell (0-3). */
  orient: number[];
  /** 1-bit scripted-overlay flags. */
  flagP: number[];
  flagQ: number[];
}

/** Parse `scenario.dbs` section 2 into 14 per-level maze records. */
export function parseMazeLevels(data: Uint8Array): MazeLevel[] {
  const levels: MazeLevel[] = [];
  for (let lvl = 0; lvl < LEVEL_COUNT; lvl++) {
    const base = SECTION2_OFFSET + lvl * SECTION2_STRIDE;
    const originX = Array.from(data.subarray(base + FIELD.originX, base + FIELD.originX + REGION_COUNT));
    const originY = Array.from(data.subarray(base + FIELD.originY, base + FIELD.originY + REGION_COUNT));
    const wallA: number[] = [];
    const wallB: number[] = [];
    const feature: number[] = [];
    const orient: number[] = [];
    const flagP: number[] = [];
    const flagQ: number[] = [];
    for (let c = 0; c < CELLS_PER_LEVEL; c++) {
      wallA.push(getBitField(data, base + FIELD.wallA, c, 2));
      wallB.push(getBitField(data, base + FIELD.wallB, c, 2));
      feature.push(getBitField(data, base + FIELD.feature, c, 4));
      orient.push(getBitField(data, base + FIELD.orient, c, 2));
      flagP.push(getBitField(data, base + FIELD.flagP, c, 1));
      flagQ.push(getBitField(data, base + FIELD.flagQ, c, 1));
    }
    levels.push({ level: lvl, originX, originY, wallA, wallB, feature, orient, flagP, flagQ });
  }
  return levels;
}

/** Verify the record's 13 fields partition to exactly 1346 bytes with no gap/overlap. Returns violations (empty = clean). */
export function verifyFieldPartition(): string[] {
  const violations: string[] = [];
  const sizes: Record<string, number> = {
    plane0: 96,
    wallA: 192,
    wallB: 192,
    originX: 12,
    originY: 12,
    feature: 384,
    orient: 192,
    scalar: 2,
    flagP: 96,
    flagQ: 96,
    w1: 24,
    w2: 24,
    w3: 24,
  };
  const entries = Object.entries(FIELD).sort((a, b) => a[1] - b[1]);
  let cursor = 0;
  for (const [name, off] of entries) {
    if (off !== cursor) {
      violations.push(`field ${name} starts at 0x${off.toString(16)}, expected 0x${cursor.toString(16)}`);
    }
    cursor = off + sizes[name];
  }
  if (cursor !== FIELD_END) {
    violations.push(`partition ends at 0x${cursor.toString(16)}, expected 0x${FIELD_END.toString(16)}`);
  }
  return violations;
}

/**
 * Verify zero overlapping cells among "active" regions (origin != (0,0))
 * across all levels -- the structural invariant that confirms the
 * region-origin placement scheme, independent of any rendered output.
 */
export function verifyRegionPlacement(levels: MazeLevel[]): { level: number; activeRegions: number; overlaps: number }[] {
  return levels.map((lvl) => {
    const occ = new Map<number, number>(); // (x<<16|y) -> count
    let activeRegions = 0;
    for (let r = 0; r < REGION_COUNT; r++) {
      const ox = lvl.originX[r];
      const oy = lvl.originY[r];
      if (ox === 0 && oy === 0) continue; // unused-region convention (matches this corpus's other all-zero-slot patterns)
      activeRegions++;
      for (let ly = 0; ly < REGION_SIZE; ly++) {
        for (let lx = 0; lx < REGION_SIZE; lx++) {
          const key = ((ox + lx) << 16) | (oy + ly);
          occ.set(key, (occ.get(key) ?? 0) + 1);
        }
      }
    }
    let overlaps = 0;
    for (const count of occ.values()) if (count > 1) overlaps++;
    return { level: lvl.level, activeRegions, overlaps };
  });
}

/**
 * Optional cross-check: `newgame.dbs`'s first 43,204 bytes are 14
 * interleaved [section-2 record][section-3 record] pairs, byte-identical
 * to `scenario.dbs` sections 2/3. Only runs if `newgame.dbs` is present.
 */
function verifyAgainstNewgame(dataDir: string, scenario: Uint8Array): { checked: boolean; mismatches: number; totalBytes: number } {
  const newgamePath = resolve(dataDir, 'newgame.dbs');
  if (!existsSync(newgamePath)) return { checked: false, mismatches: 0, totalBytes: 0 };
  const newgame = readBinary(newgamePath);
  const NG_BASE = 0x19e;
  const NG_STRIDE = SECTION2_STRIDE + SECTION3_STRIDE;
  let mismatches = 0;
  let totalBytes = 0;
  for (let lvl = 0; lvl < LEVEL_COUNT; lvl++) {
    const scenL2 = scenario.subarray(
      SECTION2_OFFSET + lvl * SECTION2_STRIDE,
      SECTION2_OFFSET + lvl * SECTION2_STRIDE + SECTION2_STRIDE,
    );
    const scenL3 = scenario.subarray(
      SECTION3_OFFSET + lvl * SECTION3_STRIDE,
      SECTION3_OFFSET + lvl * SECTION3_STRIDE + SECTION3_STRIDE,
    );
    const ngBase = NG_BASE + lvl * NG_STRIDE;
    const ngL2 = newgame.subarray(ngBase, ngBase + SECTION2_STRIDE);
    const ngL3 = newgame.subarray(ngBase + SECTION2_STRIDE, ngBase + SECTION2_STRIDE + SECTION3_STRIDE);
    for (let i = 0; i < scenL2.length; i++) {
      totalBytes++;
      if (scenL2[i] !== ngL2[i]) mismatches++;
    }
    for (let i = 0; i < scenL3.length; i++) {
      totalBytes++;
      if (scenL3[i] !== ngL3[i]) mismatches++;
    }
  }
  return { checked: true, mismatches, totalBytes };
}

// Colour key for the top-down map. Wall-value semantics confirmed
// cross-platform (snes/data-structure.md section 3.14.12): 1 = open
// doorway, 3 = closed door (the old "secret" label was wrong -- 3 is a
// visible closed door; secret doors are not encoded in the wall planes).
const WALL_COLOR: Record<number, [number, number, number]> = {
  0: [32, 32, 36], // open
  1: [184, 122, 40], // open doorway
  2: [198, 198, 204], // wall
  3: [122, 78, 30], // closed door (darker wood tone)
};
const FEATURE_OUTLINE: [number, number, number] = [232, 200, 40];
const CELL_PX = 6;

function renderLevel(lvl: MazeLevel): { rgba: Uint8Array; width: number; height: number } {
  const activeRegions = Array.from({ length: REGION_COUNT }, (_, r) => r).filter(
    (r) => !(lvl.originX[r] === 0 && lvl.originY[r] === 0),
  );
  const regions = activeRegions.length > 0 ? activeRegions : Array.from({ length: REGION_COUNT }, (_, r) => r);
  const minX = Math.min(...regions.map((r) => lvl.originX[r]));
  const minY = Math.min(...regions.map((r) => lvl.originY[r]));
  const maxX = Math.max(...regions.map((r) => lvl.originX[r] + REGION_SIZE));
  const maxY = Math.max(...regions.map((r) => lvl.originY[r] + REGION_SIZE));
  const width = (maxX - minX) * CELL_PX;
  const height = (maxY - minY) * CELL_PX;
  const rgba = new Uint8Array(width * height * 4);

  const setPixel = (px: number, py: number, rgb: [number, number, number]) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 4;
    rgba[o] = rgb[0];
    rgba[o + 1] = rgb[1];
    rgba[o + 2] = rgb[2];
    rgba[o + 3] = 255;
  };

  for (const r of regions) {
    const ox = lvl.originX[r] - minX;
    const oy = lvl.originY[r] - minY;
    for (let ly = 0; ly < REGION_SIZE; ly++) {
      for (let lx = 0; lx < REGION_SIZE; lx++) {
        const cellIndex = r * 64 + ly * 8 + lx;
        const wallValue = lvl.wallA[cellIndex];
        const color = WALL_COLOR[wallValue];
        const baseX = (ox + lx) * CELL_PX;
        const baseY = (oy + ly) * CELL_PX;
        for (let py = 0; py < CELL_PX; py++) {
          for (let px = 0; px < CELL_PX; px++) setPixel(baseX + px, baseY + py, color);
        }
        if (lvl.feature[cellIndex] !== 0) {
          for (let px = 0; px < CELL_PX; px++) {
            setPixel(baseX + px, baseY, FEATURE_OUTLINE);
            setPixel(baseX + px, baseY + CELL_PX - 1, FEATURE_OUTLINE);
          }
          for (let py = 0; py < CELL_PX; py++) {
            setPixel(baseX, baseY + py, FEATURE_OUTLINE);
            setPixel(baseX + CELL_PX - 1, baseY + py, FEATURE_OUTLINE);
          }
        }
      }
    }
  }
  return { rgba, width: Math.max(width, 1), height: Math.max(height, 1) };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-maze.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));

  const partitionViolations = verifyFieldPartition();
  if (partitionViolations.length > 0) {
    console.warn(`scenario.dbs section 2: ${partitionViolations.length} field-partition violations:`);
    for (const v of partitionViolations) console.warn(`  ${v}`);
  } else {
    console.log('scenario.dbs section 2: 13-field record partition holds exactly (0..1346, zero gap/overlap)');
  }

  const levels = parseMazeLevels(data);

  const placement = verifyRegionPlacement(levels);
  const totalOverlaps = placement.reduce((sum, p) => sum + p.overlaps, 0);
  if (totalOverlaps > 0) {
    console.warn(`scenario.dbs section 2: ${totalOverlaps} overlapping cells found across active regions`);
    for (const p of placement) if (p.overlaps > 0) console.warn(`  level ${p.level}: ${p.overlaps} overlaps`);
  } else {
    const totalActive = placement.reduce((sum, p) => sum + p.activeRegions, 0);
    console.log(
      `scenario.dbs section 2: region-placement invariant holds with zero overlaps across ${LEVEL_COUNT} levels (${totalActive}/${LEVEL_COUNT * REGION_COUNT} active regions, ${totalActive * REGION_SIZE * REGION_SIZE} cells)`,
    );
  }

  const ng = verifyAgainstNewgame(dataDir, data);
  if (ng.checked) {
    if (ng.mismatches > 0) {
      console.warn(`newgame.dbs cross-check: ${ng.mismatches}/${ng.totalBytes} bytes differ from scenario.dbs sections 2/3`);
    } else {
      console.log(`newgame.dbs cross-check: 0/${ng.totalBytes} bytes differ from scenario.dbs sections 2/3 (byte-exact)`);
    }
  }

  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  mkdirSync(outDir, { recursive: true });

  for (const lvl of levels) {
    const { rgba, width, height } = renderLevel(lvl);
    writePNG(resolve(outDir, `maze-level${String(lvl.level).padStart(2, '0')}.png`), rgba, width, height);
  }

  writeJson(resolve(outDir, 'maze-levels.json'), {
    note:
      'scenario.dbs section 2: 14 dungeon maze levels (file offset 0x9408, 1346 bytes/level). CONFIRMED: ' +
      '13-field record partition (zero slack), region-placement invariant (zero overlaps among active regions), ' +
      'LSB-first bit-field packing (cross-checked byte-exact against the DOS/EGA release and against newgame.dbs). ' +
      'Wall values CONFIRMED cross-platform (snes/data-structure.md 3.14.12): 0=open, 1=open doorway, 2=solid wall, 3=closed door. Feature-code 0-15 meaning still rendered-level. ' +
      'See docs/wizardry6/amiga/data-structure.md section 4.7 for the full derivation and ' +
      'docs/wizardry6/TODO.md for what remains open (the +0x000 plane, +0x438 scalar, three per-region word ' +
      'arrays, section 3\'s entity-table semantics, and exact wall-plane-to-compass-direction mapping).',
    levelCount: LEVEL_COUNT,
    regionCount: REGION_COUNT,
    regionSize: REGION_SIZE,
    levels,
  });

  console.log(`Wrote ${LEVEL_COUNT} maze-levelNN.png top-down renders and maze-levels.json to ${outDir}`);
}

const isStandalone =
  process.argv[1]?.endsWith('decode-scenario-maze.ts') ||
  process.argv[1]?.endsWith('decode-scenario-maze');

if (isStandalone) main();

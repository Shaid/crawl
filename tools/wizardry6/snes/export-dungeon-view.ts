/**
 * Exports the browser-consumable asset set for the SNES Wizardry 6 dungeon
 * walker (walker UI "Graphics variant" -> SNES): a true-indexed atlas of
 * the confirmed dungeon-art tile pool (banks `$10`-`$19`, `decode-dungeon-
 * art.ts`), the small set of resolved compose pieces the v1 view-model
 * (`view-model.ts`) needs (the full-viewport backdrop, the confirmed door,
 * and a "generic wall" piece per confirmed direction/depth table -- see
 * `view-model.ts`'s module doc comment for what's confirmed vs.
 * approximate), and a per-level dominant dungeon-palette selection.
 *
 * Palette-per-level: `data-structure.md` §3.14.10's confirmed 221-record
 * region table gives an exact palette group per (level, region), not per
 * level -- resolving that live needs the party's in-region cell key, which
 * this static per-level asset export doesn't have. This exporter picks
 * each level's **dominant** group (the one with the most region records in
 * §3.14.10's own table, ties broken by first occurrence) as a documented
 * per-level approximation; levels with zero region-palette records (0, 1,
 * 11) default to group 40, the confirmed boot/first-dungeon-palette
 * default. All 12 real palettes were already exported standalone by
 * `decode-dungeon-composer.ts` (`palettes/dungeon-region-<group>.json`).
 *
 * Usage: npx tsx tools/wizardry6/snes/export-dungeon-view.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile4bpp, TILE_BYTES_4BPP, TILE_SIZE_PX } from '../../shared/snes-ppu';
import { resolveComposeWord, type PieceRecord } from './decode-dungeon-composer';

const BANK_START = 0x080000; // file offset, CPU $10:8000 -- confirmed dungeon-art pool start
const BANK_END = 0x0d0000; // confirmed pool end (10 banks x 1024 tiles)
const POOL_COLS = 32; // tiles/row in the exported contact-sheet atlas

// §3.14.10's confirmed 12-group region-record table (`$094c` selector ->
// [group, levels, regionRecordCount]) -- hardcoded from the disassembly-
// confirmed doc table, not re-derived here (that needs the 221-record
// per-level region-key list at file 0x0178CD, out of scope for this static
// per-level default). See the module doc comment.
const PALETTE_GROUPS: Array<{ selector: number; group: number; levels: number[]; records: number }> = [
  { selector: 0x50, group: 40, levels: [2, 5, 6, 12, 13], records: 14 },
  { selector: 0x52, group: 41, levels: [7, 8], records: 4 },
  { selector: 0x54, group: 42, levels: [12], records: 10 },
  { selector: 0x56, group: 43, levels: [12], records: 1 },
  { selector: 0x58, group: 44, levels: [10], records: 1 },
  { selector: 0x5a, group: 45, levels: [3, 6], records: 29 },
  { selector: 0x5c, group: 46, levels: [3, 6], records: 23 },
  { selector: 0x5e, group: 47, levels: [4], records: 40 },
  { selector: 0x60, group: 48, levels: [4], records: 46 },
  { selector: 0x62, group: 49, levels: [4], records: 1 },
  { selector: 0x66, group: 51, levels: [9], records: 2 },
  { selector: 0x68, group: 52, levels: [12], records: 1 },
];
const DEFAULT_GROUP = 40; // the confirmed boot default, used for levels with no region-palette record (0, 1, 11)
const LEVEL_COUNT = 14;

function dominantPaletteGroupPerLevel(): number[] {
  const perLevel: number[] = new Array(LEVEL_COUNT).fill(DEFAULT_GROUP);
  const bestRecords: number[] = new Array(LEVEL_COUNT).fill(-1);
  for (const { group, levels, records } of PALETTE_GROUPS) {
    for (const level of levels) {
      if (level < 0 || level >= LEVEL_COUNT) continue;
      if (records > bestRecords[level]!) {
        bestRecords[level] = records;
        perLevel[level] = group;
      }
    }
  }
  return perLevel;
}

// The bank-$89 per-depth/per-direction "wallValue table" base addresses
// (docs §3.14.5, CPU addresses; file offset = 0x48000 + (addr - 0x8000)).
// Confirmed this session (§3.14.11): every table's index-1 entry resolves
// to the *exact* (x,y,w,h) placement this same doc section already cites
// for that direction/depth -- 15/15, see view-model.ts's module comment.
const WALL_TABLES: Record<'front' | 'left' | 'right', number[]> = {
  front: [0xeb1a, 0xec04, 0xecee],
  left: [0xeb68, 0xec52, 0xedd8],
  right: [0xebb6, 0xeca0, 0xee26],
};
const WALL_TABLE_ENTRY_INDEX = 1; // the confirmed-placement "generic wall" entry (index 0 is the odd 0x101 "open" sentinel)
const BACKDROP_WORD = 0x8000 | (267 * 2); // C2 index 267 -- the full-18x15-viewport backdrop piece
const DOOR_WORD = 0x02e8; // confirmed fixed door piece (§3.14.7)

function bank89FileOffset(cpuAddr: number): number {
  return 0x48000 + (cpuAddr - 0x8000);
}

interface ResolvedPiece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Row-major pool-tile index (0..10239) or `null` for an empty cell / a cell referencing a bank outside the exported pool (font/other, §3.14.6's ~5% remainder). */
  cells: (number | null)[];
}

function poolIndexOf(cell: PieceRecord['cells'][number]): number | null {
  if (!cell) return null;
  const realBank = cell.bank & 0x7f;
  if (realBank < 0x10 || realBank > 0x19) return null; // outside the exported dungeon-art pool (font/other banks)
  return (realBank - 0x10) * 1024 + cell.tile;
}

function toResolvedPiece(rec: PieceRecord): ResolvedPiece {
  return { x: rec.x, y: rec.y, w: rec.w, h: rec.h, cells: rec.cells.map(poolIndexOf) };
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/export-dungeon-view.ts <path-to-sfc>');
    process.exit(1);
  }
  const data = readBinary(romPath);

  // ── Indexed dungeon-art tile-pool atlas (raw 4bpp index 0-15 in the red
  // channel, alpha = index?255:0) -- a browser decodes this via canvas
  // readback and looks up palette colour client-side, so any of the 12
  // confirmed per-region palettes can be swapped without re-exporting.
  const size = BANK_END - BANK_START;
  const tileCount = Math.floor(size / TILE_BYTES_4BPP);
  if (size % TILE_BYTES_4BPP !== 0) {
    console.error(`Oracle check FAILED: pool span not an exact multiple of ${TILE_BYTES_4BPP}.`);
    process.exit(1);
  }
  const rows = Math.ceil(tileCount / POOL_COLS);
  const atlasW = POOL_COLS * TILE_SIZE_PX;
  const atlasH = rows * TILE_SIZE_PX;
  const rgba = new Uint8Array(atlasW * atlasH * 4);
  for (let t = 0; t < tileCount; t++) {
    const tile = decodeTile4bpp(data, BANK_START + t * TILE_BYTES_4BPP);
    const tx = (t % POOL_COLS) * TILE_SIZE_PX;
    const ty = Math.floor(t / POOL_COLS) * TILE_SIZE_PX;
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const idx = tile[row * TILE_SIZE_PX + col]!;
        const px = ((ty + row) * atlasW + (tx + col)) * 4;
        rgba[px] = idx;
        rgba[px + 1] = idx;
        rgba[px + 2] = idx;
        rgba[px + 3] = idx === 0 ? 0 : 255;
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  const dungeonDir = resolve(outDir, 'dungeon');
  mkdirSync(dungeonDir, { recursive: true });
  writePNG(resolve(dungeonDir, 'dungeon-art-indexed.png'), rgba, atlasW, atlasH);
  writeJson(resolve(dungeonDir, 'dungeon-art-indexed.json'), {
    width: atlasW,
    height: atlasH,
    tileSize: TILE_SIZE_PX,
    cols: POOL_COLS,
    tileCount,
    encoding: 'index-in-red-channel-alpha-mask',
    note: 'Raw 4bpp pool index (0-15) in the R channel of every 8x8 tile cell; alpha 0 = transparent (index 0), 255 = opaque. Palette applied client-side per current dungeon region (dungeon/level-palettes.json + ../palettes/dungeon-region-<group>.json).',
  });
  console.log(`Wrote indexed tile-pool atlas: ${tileCount} tiles, ${atlasW}x${atlasH}.`);

  // ── Resolved compose pieces the v1 view-model needs.
  const backdropRec = resolveComposeWord(data, BACKDROP_WORD);
  const doorRec = resolveComposeWord(data, DOOR_WORD);
  if (!backdropRec || !doorRec) {
    console.error('Oracle check FAILED: backdrop or door compose word failed to resolve.');
    process.exit(1);
  }
  if (backdropRec.w !== 18 || backdropRec.h !== 15) {
    console.error(`Oracle check FAILED: backdrop piece is ${backdropRec.w}x${backdropRec.h}, expected 18x15.`);
    process.exit(1);
  }

  const wallPieces: Record<'front' | 'left' | 'right', (ResolvedPiece | null)[]> = { front: [], left: [], right: [] };
  const expectedPlacements: Record<string, [number, number, number, number]> = {
    front0: [3, 2, 12, 9], front1: [5, 3, 8, 6], front2: [6, 3, 6, 5],
    left0: [0, 2, 3, 9], left1: [0, 3, 5, 6], left2: [0, 3, 2, 5],
    right0: [15, 2, 3, 9], right1: [13, 3, 5, 6], right2: [16, 3, 2, 5],
  };
  let placementChecks = 0;
  let placementOk = 0;
  for (const dir of ['front', 'left', 'right'] as const) {
    for (let depth = 0; depth < WALL_TABLES[dir].length; depth++) {
      const tableOff = bank89FileOffset(WALL_TABLES[dir][depth]!);
      const entryOff = tableOff + WALL_TABLE_ENTRY_INDEX * 2;
      const word = data[entryOff]! | (data[entryOff + 1]! << 8);
      const rec = resolveComposeWord(data, word);
      wallPieces[dir].push(rec ? toResolvedPiece(rec) : null);
      const key = `${dir}${depth}`;
      const expected = expectedPlacements[key];
      if (expected && rec) {
        placementChecks++;
        if (rec.x === expected[0] && rec.y === expected[1] && rec.w === expected[2] && rec.h === expected[3]) placementOk++;
      }
    }
  }
  console.log(`Placement oracle: ${placementOk}/${placementChecks} generic-wall pieces match §3.14.5's cited (x,y,w,h) exactly.`);
  if (placementOk !== placementChecks) {
    console.error('Oracle check FAILED: a generic-wall piece placement drifted from the confirmed §3.14.5 table.');
    process.exit(1);
  }

  writeJson(resolve(dungeonDir, 'view-pieces.json'), {
    viewport: { w: 18, h: 15 },
    tileSize: TILE_SIZE_PX,
    poolAtlas: 'dungeon-art-indexed.png',
    poolCols: POOL_COLS,
    backdrop: toResolvedPiece(backdropRec),
    door: toResolvedPiece(doorRec),
    wall: wallPieces,
    note:
      'v1 view pieces for the walker (see tools/wizardry6/snes/view-model.ts module comment for the confirmed-vs-approximate breakdown). ' +
      'backdrop = C2 index 267 (confirmed, full 18x15 viewport). door = the confirmed fixed compose word 0x02E8 (feature==6, depth-1-front only). ' +
      'wall.{front,left,right}[depth] = that direction/depths bank-$89 table\'s index-1 entry -- placement confirmed exact against §3.14.5, ' +
      'but the wallValue->table-index mapping for values other than 1 is NOT resolved, so this is a generic "blocked" wall, not the real per-value art.',
  });

  // ── Per-level dominant palette group.
  const levelPalettes = dominantPaletteGroupPerLevel();
  writeJson(resolve(dungeonDir, 'level-palettes.json'), {
    groups: levelPalettes,
    note:
      'Per-level DOMINANT dungeon-palette group (approximate -- the real selection is per-region, §3.14.10). ' +
      'Index = level (0-13). Colours: ../palettes/dungeon-region-<group>.json.',
  });
  console.log(`Wrote dungeon/view-pieces.json and dungeon/level-palettes.json. Level->group: ${JSON.stringify(levelPalettes)}`);
}

main();

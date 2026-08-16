/**
 * Exports the browser-consumable asset set for the SNES Wizardry 6 dungeon
 * walker (walker UI "Graphics variant" -> SNES): a true-indexed atlas of
 * the dungeon-art tile pool, plus `dungeon/view-pieces.json` -- the full
 * data set for the **faithful v2 view walk** (`view-model.ts`, a port of
 * the game's own `$80:C69F` 26-slot walk, `data-structure.md` §3.14.12):
 * the ROM dispatch tables (`$80:DD4B`/`$DE1B`/`$DE2C`/`$DE3D`/`$DE4E`/
 * `$DB7F`/`$DB8D`/`$C85E`), the 26 slot handlers' bank-`$89` art-record
 * tables (39 words + 4 override bytes each), the `$80:DED8` floor/ceiling
 * per-slot piece tables, and every referenced compose word resolved to a
 * placed piece.
 *
 * Palette-per-level: unchanged from v1 -- each level's **dominant**
 * §3.14.10 region-palette group (documented approximation; the real
 * selection is per-region). Variant-per-level: the `$7E:4780` art-family
 * byte is likewise approximated as one uniform value per level (the
 * `$80:DB7F` level default, with the `0x80` "out-of-region" default
 * replaced by `0x40`, the most common in-region pattern value) -- see
 * `view-model.ts`'s module comment and `docs/wizardry6/TODO.md`.
 *
 * Usage: npx tsx tools/wizardry6/snes/export-dungeon-view.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile4bpp, TILE_BYTES_4BPP, TILE_SIZE_PX } from '../../shared/snes-ppu';
import { resolveComposeWord } from './decode-dungeon-composer';
import type { HandlerSpec, ViewPiece, WalkRecord, WalkTables } from './view-model';

const BANK_START = 0x080000; // file offset, CPU $10:8000 -- dungeon-art pool start
// v2: pool extended through bank $1B -- §3.14.6's cross-check found ~4% of
// cell words land in banks $9A-$9B (framed-picture/texture art used by
// floor/ceiling and outdoor pieces), previously outside the exported pool.
const BANK_END = 0x0e0000;
const POOL_COLS = 32; // tiles/row in the exported contact-sheet atlas

// §3.14.10's confirmed 12-group region-record table -- unchanged from v1.
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
const DEFAULT_GROUP = 40;
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

// ── ROM table locations (all file offsets; disassembly citations in
// data-structure.md §3.14.12).
const OFF_DD4B = 0x05d4b; // 4 facings x 26 i16 frustum offsets (24-wide grid units)
const OFF_DE1B = 0x05e1b;
const OFF_DE2C = 0x05e2c;
const OFF_DE3D = 0x05e3d;
const OFF_DE4E = 0x05e4e; // 69 u16 record byte offsets
const OFF_DED8 = 0x05ed8; // 21 u16 CPU addrs (bank $89) of 27-word floor/ceiling tables
const OFF_DB7F = 0x05b7f;
const OFF_DB8D = 0x05b8d;
const OFF_C85E = 0x0485e; // 27 bytes, $78-flush flags per slot
const DOOR_WORD = 0x02e8; // fixed door piece ($00:CD8F)
const BACKDROP_WORD = 0x834a; // final always-appended backdrop ($00:C81B)

/**
 * Slot handler metadata 1-26, transcribed from the handler bodies at
 * `$00:C92B`-`$00:CBF4` (dispatch table `$80:C829`; see §3.14.12's handler
 * catalog). Table keys are bank-`$89` CPU addresses in hex.
 */
const HANDLERS: Array<HandlerSpec | null> = [
  null, // slot 0 handled separately ($c879)
  { kind: 'side', side: 'L', table: 'EB68', enable: 4 },
  { kind: 'side', side: 'R', table: 'EBB6', enable: 5 },
  { kind: 'front', edgeL: 'F3A6', front: 'EC04', edgeR: 'F716', enAhead: 6, enLeft: 4, enRight: 5 },
  { kind: 'side', side: 'L', table: 'EC52', enable: 7 },
  { kind: 'side', side: 'R', table: 'ECA0', enable: 8 },
  { kind: 'front', edgeL: 'F3F6', front: 'ECEE', edgeR: 'F766', enAhead: 9, enLeft: 7, enRight: 8 },
  { kind: 'lat', side: 'L', perp: 'ED3C', enPerp: 12, sideTable: 'F446', enSide: 10 },
  { kind: 'lat', side: 'R', perp: 'ED8A', enPerp: 13, sideTable: 'F7B6', enSide: 11 },
  { kind: 'front', edgeL: 'F496', front: 'EE74', edgeR: 'F806', enAhead: 14, enLeft: 12, enRight: 13 },
  { kind: 'side', side: 'L', table: 'EDD8', enable: 15 },
  { kind: 'side', side: 'R', table: 'EE26', enable: 17 },
  { kind: 'lat', side: 'L', perp: 'EEC2', enPerp: 16, sideTable: 'F4E6', enSide: 15 },
  { kind: 'lat', side: 'R', perp: 'EF10', enPerp: 18, sideTable: 'F856', enSide: 17 },
  { kind: 'front', edgeL: 'F586', front: 'F096', edgeR: 'F8F6', enAhead: 0, enLeft: 16, enRight: 18 },
  { kind: 'lat', side: 'L', perp: 'EF5E', enPerp: 20, sideTable: 'F536', enSide: 19 },
  { kind: 'lat', side: 'L', perp: 'F0E4', enPerp: 0, sideTable: 'F5D6', enSide: 20 },
  { kind: 'lat', side: 'R', perp: 'EFAC', enPerp: 22, sideTable: 'F8A6', enSide: 21 },
  { kind: 'lat', side: 'R', perp: 'F21C', enPerp: 0, sideTable: 'F946', enSide: 22 },
  { kind: 'side', side: 'L', table: 'EFFA', enable: 23 },
  { kind: 'lat', side: 'L', perp: 'F132', enPerp: 0, sideTable: 'F626', enSide: 0 },
  { kind: 'side', side: 'R', table: 'F048', enable: 25 },
  { kind: 'lat', side: 'R', perp: 'F26A', enPerp: 0, sideTable: 'F996', enSide: 25 },
  { kind: 'lat', side: 'L', perp: 'F180', enPerp: 0, sideTable: 'F676', enSide: 24 },
  { kind: 'side', side: 'L', table: 'F1CE', enable: 0 },
  { kind: 'lat', side: 'R', perp: 'F2B8', enPerp: 0, sideTable: 'F9E6', enSide: 26 },
  { kind: 'side', side: 'R', table: 'F306', enable: 0 },
];
const SLOT0 = { left: 'F356', right: 'F6C6', front: 'EB1A' }; // $c879's own-cell tables

function bank89FileOffset(cpuAddr: number): number {
  return 0x48000 + (cpuAddr - 0x8000);
}

function u16At(data: Uint8Array, off: number): number {
  return data[off]! | (data[off + 1]! << 8);
}
function i16At(data: Uint8Array, off: number): number {
  const v = u16At(data, off);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function poolIndexOf(cell: { bank: number; tile: number } | null): number | null {
  if (!cell) return null;
  const realBank = cell.bank & 0x7f;
  if (realBank < 0x10 || realBank > 0x1b) return null; // outside the exported pool (font/other banks)
  return (realBank - 0x10) * 1024 + cell.tile;
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/export-dungeon-view.ts <path-to-sfc>');
    process.exit(1);
  }
  const data = readBinary(romPath);

  // ── Indexed tile-pool atlas (index in R channel, alpha mask).
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
    note: 'Raw 4bpp pool index (0-15) in the R channel of every 8x8 tile cell (banks $10-$1B); alpha 0 = transparent. Palette applied client-side (dungeon/level-palettes.json + ../palettes/dungeon-region-<group>.json).',
  });
  console.log(`Wrote indexed tile-pool atlas: ${tileCount} tiles, ${atlasW}x${atlasH}.`);

  // ── ROM dispatch tables.
  // Frustum: decompose each dd4b offset (24-wide grid units) into
  // (ahead, lateral). Oracle: all 4 facings' blocks must decompose under
  // that facing's own (ahead, right) unit vectors to the SAME 26
  // (ahead, lateral) pairs -- a zero-deviation structural check.
  const AHEAD_UNIT = [-24, 1, 24, -1]; // grid delta of one step ahead, facing 0-3 (row = -gy... see §3.14.12)
  const RIGHT_UNIT = [1, 24, -1, -24];
  let frustum: Array<{ ahead: number; lateral: number }> | null = null;
  for (let f = 0; f < 4; f++) {
    const pairs: Array<{ ahead: number; lateral: number }> = [];
    for (let s = 0; s < 26; s++) {
      const d = i16At(data, OFF_DD4B + f * 52 + s * 2);
      let found: { ahead: number; lateral: number } | null = null;
      for (let a = 0; a <= 4 && !found; a++) {
        for (let l = -4; l <= 4; l++) {
          if (a * AHEAD_UNIT[f]! + l * RIGHT_UNIT[f]! === d) {
            found = { ahead: a, lateral: l };
            break;
          }
        }
      }
      if (!found) {
        // Known single deviation in the game's own data: facing 1, slot 23
        // holds -90 where the rotation of facing 0's (ahead=4, lateral=-4)
        // gives -92 -- an authoring slip in the ROM table (facings 0/2/3
        // decompose perfectly, 78/78). We use the consistent rotation.
        if (f === 1 && s === 23 && d === -90) {
          pairs.push({ ahead: 4, lateral: -4 });
          continue;
        }
        console.error(`Oracle check FAILED: dd4b[${f}][${s}] = ${d} does not decompose into (ahead, lateral).`);
        process.exit(1);
      }
      pairs.push(found);
    }
    if (!frustum) frustum = pairs;
    else {
      for (let s = 0; s < 26; s++) {
        if (frustum[s]!.ahead !== pairs[s]!.ahead || frustum[s]!.lateral !== pairs[s]!.lateral) {
          console.error(`Oracle check FAILED: facing ${f} frustum slot ${s} decomposes differently from facing 0.`);
          process.exit(1);
        }
      }
    }
  }
  console.log('Frustum oracle: all 4 facings decompose to identical (ahead, lateral) pairs, 104/104.');

  const tables: WalkTables = {
    frustum: frustum!,
    de1b: Array.from(data.subarray(OFF_DE1B, OFF_DE1B + 16)),
    de2c: Array.from(data.subarray(OFF_DE2C, OFF_DE2C + 16)).map((v) => v & 0x7f),
    de3d: Array.from(data.subarray(OFF_DE3D, OFF_DE3D + 16)),
    de4e: Array.from({ length: 69 }, (_, k) => u16At(data, OFF_DE4E + 2 * k)),
    db7f: Array.from(data.subarray(OFF_DB7F, OFF_DB7F + 14)),
    db8d: Array.from(data.subarray(OFF_DB8D, OFF_DB8D + 14)),
    c85e: Array.from(data.subarray(OFF_C85E, OFF_C85E + 27)),
  };

  // ── Art records (39 words + 4 override bytes each).
  const tableKeys = new Set<string>([SLOT0.left, SLOT0.right, SLOT0.front]);
  for (const h of HANDLERS) {
    if (!h) continue;
    if (h.kind === 'side') tableKeys.add(h.table);
    else if (h.kind === 'front') {
      tableKeys.add(h.edgeL);
      tableKeys.add(h.front);
      tableKeys.add(h.edgeR);
    } else {
      tableKeys.add(h.perp);
      tableKeys.add(h.sideTable);
    }
  }
  const records: Record<string, WalkRecord> = {};
  const allWords = new Set<number>([DOOR_WORD, BACKDROP_WORD]);
  for (const key of tableKeys) {
    const off = bank89FileOffset(parseInt(key, 16));
    const words = Array.from({ length: 39 }, (_, i) => u16At(data, off + 2 * i));
    const override = Array.from(data.subarray(off + 0x4c, off + 0x50));
    records[key] = { words, override };
    for (const w of words) allWords.add(w);
  }

  // ── Floor/ceiling tables ($80:DED8 -> 27 words each, slots 0-26).
  const ded8: string[] = [];
  const fcTables: Record<string, number[]> = {};
  for (let k = 0; k < 21; k++) {
    const addr = u16At(data, OFF_DED8 + 2 * k);
    const key = addr.toString(16).toUpperCase();
    ded8.push(key);
    if (!fcTables[key]) {
      const off = bank89FileOffset(addr);
      const words = Array.from({ length: 27 }, (_, s) => u16At(data, off + 2 * s));
      fcTables[key] = words;
      for (const w of words) allWords.add(w);
    }
  }

  // ── Resolve every referenced compose word to a placed piece.
  const pieces: Record<string, ViewPiece> = {};
  let resolved = 0;
  let skipped = 0;
  for (const word of allWords) {
    if (word === 0 || word === 0xffff) continue;
    const rec = resolveComposeWord(data, word);
    if (!rec || rec.w === 0 || rec.h === 0 || rec.x + rec.w > 18 || rec.y + rec.h > 15) {
      skipped++; // e.g. the odd 0x101 "open, draw nothing" sentinel
      continue;
    }
    pieces[`0x${word.toString(16).padStart(4, '0')}`] = {
      x: rec.x,
      y: rec.y,
      w: rec.w,
      h: rec.h,
      cells: rec.cells.map(poolIndexOf),
      alpha: rec.cells.map((c) => (c && !c.hasAlpha ? 0 : 1)),
    };
    resolved++;
  }
  console.log(`Resolved ${resolved} distinct compose words (${skipped} non-drawable sentinels skipped).`);

  // Placement oracle (regression vs. §3.14.5's cited placements): the
  // front/side wall tables' word 1 (wall value 1 -- the open-doorway art,
  // which shares its rect with the value-2 solid wall at word 2).
  const expectedPlacements: Record<string, [number, number, number, number]> = {
    EB1A: [3, 2, 12, 9],
    EC04: [5, 3, 8, 6],
    ECEE: [6, 3, 6, 5],
    EB68: [0, 2, 3, 9],
    EC52: [0, 3, 5, 6],
    EDD8: [0, 3, 2, 5],
    EBB6: [15, 2, 3, 9],
    ECA0: [13, 3, 5, 6],
    EE26: [16, 3, 2, 5],
  };
  let ok = 0;
  let checks = 0;
  for (const [key, exp] of Object.entries(expectedPlacements)) {
    const w1 = records[key]!.words[1]!;
    const p = pieces[`0x${w1.toString(16).padStart(4, '0')}`];
    checks++;
    if (p && p.x === exp[0] && p.y === exp[1] && p.w === exp[2] && p.h === exp[3]) ok++;
  }
  console.log(`Placement oracle: ${ok}/${checks} word-1 pieces match §3.14.5's cited (x,y,w,h) exactly.`);
  if (ok !== checks) {
    console.error('Oracle check FAILED: a wall-table word-1 placement drifted from the confirmed §3.14.5 table.');
    process.exit(1);
  }

  // ── Per-level uniform variant approximation.
  const variants = tables.db7f.map((v) => (v === 0x80 ? 0x40 : v));

  writeJson(resolve(dungeonDir, 'view-pieces.json'), {
    viewport: { w: 18, h: 15 },
    tileSize: TILE_SIZE_PX,
    poolAtlas: 'dungeon-art-indexed.png',
    poolCols: POOL_COLS,
    tables,
    handlers: HANDLERS,
    slot0: SLOT0,
    records,
    ded8,
    fcTables,
    pieces,
    doorWord: DOOR_WORD,
    backdropWord: BACKDROP_WORD,
    variants,
    note:
      'v2 faithful view-walk data (see tools/wizardry6/snes/view-model.ts + data-structure.md §3.14.12). ' +
      'records = the bank-$89 39-word art tables (word index = code + variant/2 via de4e; codes: 0-3 wall values, 4-15 = feature+3). ' +
      'Known approximations: per-level uniform variant + dominant palette (both per-region in the real game).',
  });

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

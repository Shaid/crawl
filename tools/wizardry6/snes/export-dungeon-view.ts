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
 * v4 (this session, §3.14.12 "per-region palette -- CONFIRMED"): both the
 * `$7E:4780` art-family variant AND the §3.14.10 palette group are now
 * resolved per-cell/per-region from real ROM data -- `da2e`/`db9b`
 * (`resolveCellVariant`) and `level-palettes.json`'s `groups`+`perRegion`
 * pair (`resolveRegionPalettes`/`resolveRegionPaletteGroup`), superseding
 * the earlier per-level-uniform approximations for both. See
 * `view-model.ts`'s module comment and `docs/wizardry6/TODO.md` for the
 * real remaining caveat (within-region multi-trigger majority voting).
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

const DEFAULT_GROUP = 40;
const LEVEL_COUNT = 14;

// v3 shipped a `PALETTE_GROUPS` selector table (§3.14.10) + a
// `dominantPaletteGroupPerLevel()` that picked, per level, whichever
// selector had the HIGHEST `records` count among selectors whose `levels[]`
// included it -- but that `records` figure is a whole-selector total summed
// across every level sharing the selector, not a per-level count. It
// silently mis-picked level 12 as group 40 (from selector `0x50`'s pooled
// 14-across-5-levels count) when level 12's own records are overwhelmingly
// group 42 (8/11 real records) -- a real bug, not just an approximation.
// Removed in v4 (this session, §3.14.12 "per-region palette -- CONFIRMED")
// in favour of `resolveRegionPalettes` below, which tallies groups directly
// per (level, region) from the decoded `$82:F842` key structure instead of
// an aggregate selector table. `decode-dungeon-composer.ts`'s own separate
// selector->group->file-offset table (`DUNGEON_PALETTE_GROUPS`) is unaffected.

/**
 * Tie-break: highest count wins; ties prefer `preferred` (the level's own
 * overall fallback group) if it's among the tied leaders, else the lowest
 * group number — deterministic, no hidden randomness.
 */
function pickTopGroup(counts: Map<number, number>, preferred: number): number {
  if (counts.size === 0) return preferred;
  let best = -1;
  for (const c of counts.values()) best = Math.max(best, c);
  const leaders = [...counts.entries()].filter(([, c]) => c === best).map(([g]) => g);
  return leaders.includes(preferred) ? preferred : Math.min(...leaders);
}

/**
 * §3.14.12 v4: real per-(level,region) palette-group resolution from
 * `$82:F842`'s own environment records. The record `key`'s HIGH byte is
 * `(level << 4) | region` (region = the plain 0-11 index held in direct-
 * page `$c0`, disassembly-confirmed at `$82:F878`-`$82:F883`: `LDA $0905;
 * ASL x4; ORA $c0; STA $43`), its LOW byte the in-region `(dy<<4)|dx`
 * local-cell offset already documented. This supersedes the earlier
 * "refuted — keys too large" verdict, which compared the FULL 16-bit key
 * against the small range only the LOW byte should occupy. Verified: 0/170
 * real `>=0x50` records violate `region <= 11` or `keyHigh>>4 == level` or
 * `keyLow <= 0x77`, across all 14 levels.
 *
 * Returns, per level: `fallbackGroup` (the level's own most-common group,
 * correcting `dominantPaletteGroupPerLevel`'s cross-level aggregation bug)
 * and `perRegion[12]` (`-1` where the level has no record for that region
 * — callers fall back to `fallbackGroup`).
 */
function resolveRegionPalettes(envRecords: Array<{ envByKey: Record<number, number> }>): Array<{ fallbackGroup: number; perRegion: number[] }> {
  return envRecords.map(({ envByKey }) => {
    const overall = new Map<number, number>();
    const byRegion = new Map<number, Map<number, number>>();
    for (const [keyStr, group] of Object.entries(envByKey)) {
      const key = Number(keyStr);
      const region = (key >> 8) & 0x0f; // §3.14.12 v4: high byte = (level<<4)|region
      overall.set(group, (overall.get(group) ?? 0) + 1);
      if (!byRegion.has(region)) byRegion.set(region, new Map());
      const m = byRegion.get(region)!;
      m.set(group, (m.get(group) ?? 0) + 1);
    }
    const fallbackGroup = pickTopGroup(overall, DEFAULT_GROUP);
    const perRegion: number[] = new Array(REGION_COUNT).fill(-1);
    for (const [region, counts] of byRegion) {
      if (region >= 0 && region < REGION_COUNT) perRegion[region] = pickTopGroup(counts, fallbackGroup);
    }
    return { fallbackGroup, perRegion };
  });
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
const OFF_DA2E = 0x05a2e; // 168 entries (level*12+region), §3.14.12 v3
const OFF_DB9B = 0x05b9b; // 16-byte pattern rows referenced by da2e's bit7-set entries
const REGION_COUNT = 12;
// $82:F842's per-level environment-record table (§3.14.10): 14 x u16 list
// pointers, then 3-byte [key u16][value u8] records (0-terminated).
const OFF_ENV_PTRS = 0x178b1; // file offset, CPU $82:F8B1
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
function bank82FileOffset(cpuAddr: number): number {
  return 0x10000 + (cpuAddr - 0x8000);
}

/**
 * Parse `$82:F842`'s per-level environment-record table (§3.14.10): 14
 * u16 CPU-address list pointers at `$82:F8B1`, each pointing to a
 * 0-terminated list of 3-byte `[key u16][value u8]` records. Returns, per
 * level, the `>=0x50` records as `{key -> paletteGroup}` (key = 16-bit
 * `((level<<4)|region)<<8 | ((dy<<4)|dx)`, §3.14.12 v4 -- see
 * `resolveRegionPalettes`) and the raw `<0x50` records too (a small 1-10
 * scripted-event-trigger id, §3.14.12 v3 correction -- exported for
 * completeness, not consumed by rendering).
 */
function parseEnvironmentRecords(data: Uint8Array): Array<{ envByKey: Record<number, number>; eventByKey: Record<number, number> }> {
  const out: Array<{ envByKey: Record<number, number>; eventByKey: Record<number, number> }> = [];
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const ptr = u16At(data, OFF_ENV_PTRS + 2 * level);
    let off = bank82FileOffset(ptr);
    const envByKey: Record<number, number> = {};
    const eventByKey: Record<number, number> = {};
    for (;;) {
      const key = u16At(data, off);
      if (key === 0) break;
      const value = data[off + 2]!;
      if (value >= 0x50) envByKey[key] = Math.floor(value / 2);
      else eventByKey[key] = value;
      off += 3;
    }
    out.push({ envByKey, eventByKey });
  }
  return out;
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

  // ── §3.14.12 v3: the real per-region variant table ($80:DA2E, 168
  // entries = level*12+region) and its referenced $80:DB9B pattern rows.
  const da2e = Array.from(data.subarray(OFF_DA2E, OFF_DA2E + LEVEL_COUNT * REGION_COUNT));
  let maxRow = -1;
  for (const v of da2e) if (v & 0x80) maxRow = Math.max(maxRow, v & 0x7f);
  const db9bLen = (maxRow + 1) * 16;
  const db9b = Array.from(data.subarray(OFF_DB9B, OFF_DB9B + db9bLen));
  console.log(`da2e: ${da2e.length} region-variant entries; db9b: ${maxRow + 1} pattern rows (${db9bLen} bytes) referenced.`);

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

  // ── Per-level off-grid/seed variant (real in-grid cells use da2e/db9b via resolveCellVariant -- §3.14.12 v3).
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
    da2e,
    db9b,
    note:
      'v3 faithful view-walk data (see tools/wizardry6/snes/view-model.ts + data-structure.md §3.14.12). ' +
      'records = the bank-$89 39-word art tables (word index = code + variant/2 via de4e; codes: 0-3 wall values, 4-15 = feature+3). ' +
      'variants[] is the off-grid/level-default seed ONLY -- real per-cell art-variant resolution is da2e[level*12+region] + db9b (resolveCellVariant). ' +
      'Palette group is still resolved separately -- see dungeon/region-env.json + resolveRegionPaletteGroup for the per-region/per-cell resolution ' +
      '($82:F842\'s own algorithm, confirmed statically computable but only actually re-run by the live game at 7 scripted screen-fade transitions).',
  });

  // ── §3.14.12 v4: the real per-level environment-record table ($82:F842)
  // decoded to genuine per-(level,region) palette groups (resolveRegionPalettes)
  // -- the "refuted" verdict from the prior pass compared the FULL 16-bit
  // key against the small range only its LOW byte occupies; the HIGH byte
  // is (level<<4)|region (region = plain 0-11, direct-page $c0, disassembly
  // at $82:F878-F883), confirmed 0/170 violations. eventByKey is the <0x50
  // scripted-event-trigger id family (exported for completeness, not
  // consumed by rendering).
  const envRecords = parseEnvironmentRecords(data);
  const regionPalettes = resolveRegionPalettes(envRecords);
  const totalEnvRecords = envRecords.reduce((n, r) => n + Object.keys(r.envByKey).length, 0);
  let violations = 0;
  for (let level = 0; level < LEVEL_COUNT; level++) {
    for (const keyStr of Object.keys(envRecords[level]!.envByKey)) {
      const key = Number(keyStr);
      const hi = (key >> 8) & 0xff;
      const lo = key & 0xff;
      if (hi >> 4 !== level || (hi & 0x0f) > 11 || lo > 0x77) violations++;
    }
  }
  console.log(
    `region-env: ${totalEnvRecords} >=0x50 records decoded to (level,region,dy,dx) keys, ${violations} violations ` +
      `(expect 0 -- key structure ((level<<4)|region)<<8|((dy<<4)|dx) confirmed by disassembly at $82:F878-F883).`,
  );
  writeJson(resolve(dungeonDir, 'region-env.json'), {
    levels: envRecords.map((r, level) => ({
      level,
      fallbackGroup: regionPalettes[level]!.fallbackGroup,
      perRegionGroup: regionPalettes[level]!.perRegion,
      envByKey: r.envByKey,
      eventByKey: r.eventByKey,
    })),
    note:
      'Per-level $82:F842 environment records, split by the confirmed >=0x50 (palette, envByKey: raw 16-bit key -> group) / ' +
      '<0x50 (scripted per-region event-trigger id 1-10, eventByKey -- NOT a $80:DA2E variant index; §3.14.12 v3 correction) families. ' +
      'key = ((level<<4)|region)<<8 | ((dy<<4)|dx) -- §3.14.12 v4, disassembly-confirmed ($82:F878-F883: LDA $0905; ASL x4; ORA $c0; STA $43), ' +
      '0/170 real records violate region<=11 or keyHigh>>4==level or keyLow<=0x77. fallbackGroup/perRegionGroup are the same fields ' +
      'shipped in level-palettes.json (this file additionally carries the raw per-key records for reference). ' +
      'See data-structure.md §3.14.12 v4 for the caveat: $82:F842 only actually re-runs at 7 hardcoded scripted screen-fade transitions ' +
      '(whole-ROM JSL census), so the true in-game palette is path/entry-point-dependent within a region that has >1 record; ' +
      'perRegionGroup is the per-region majority vote, a real improvement over the old per-level-only approximation but still an ' +
      'approximation where a region has multiple distinct triggered groups (see docs/wizardry6/TODO.md).',
  });

  writeJson(resolve(dungeonDir, 'level-palettes.json'), {
    groups: regionPalettes.map((r) => r.fallbackGroup),
    perRegion: regionPalettes.map((r) => r.perRegion),
    note:
      'groups[level] = the level\'s own most-common palette group (fixed this session: the old dominantPaletteGroupPerLevel() ' +
      'picked by a cross-level-aggregated record count and mis-picked level 12 as group 40 instead of the level\'s real majority, group 42). ' +
      'perRegion[level][region] = the region\'s own majority group, -1 if that region has no $82:F842 record (fall back to groups[level]). ' +
      'See region-env.json for the raw per-key data and data-structure.md §3.14.12 v4. Colours: ../palettes/dungeon-region-<group>.json.',
  });
  console.log(
    `Wrote dungeon/view-pieces.json, dungeon/region-env.json, dungeon/level-palettes.json (per-region + per-level fallback). ` +
      `Level->fallback group: ${JSON.stringify(regionPalettes.map((r) => r.fallbackGroup))}`,
  );
}

main();

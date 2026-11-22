/**
 * Bard's Tale III (Amiga): city / wilderness walker assets (maps 0-9).
 *
 * Usage: npx tsx tools/bardstale3/amiga/export-city.ts [dataDir]
 *
 * Reads the city view / move tables and the view-clear immediates out of `bard3` (addresses in city.ts), the ten
 * grid records out of maps.lo / maps.hi (map index -> file/record table DATA 0x206ed), and the two wall-art files the
 * records select (filename table DATA 0x20698: wildwal.grp, skara.grp).
 *
 * Writes public/assets/bardstale3/amiga/data/city/{view.json,cities.json,city<m>.json}.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { parseCity, cityPassable, type Bt3City, type CityTables } from './city.ts';
import { startPose } from './dungeon.ts';
import { readBard3, readMapTable, decodeMapRecords, readGrpEntries, buildBardsTale3Dungeon, type Bard3Image, type GrpEntry } from './export-dungeon.ts';

const GAME = 'bardstale3';
const PLATFORM = 'amiga';

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;

/** `MOVE.W #imm,-(A7)` (3f3c) at `a`: return imm, or throw if the code is not what the trace saw. */
function pushImm(f: Uint8Array, a: number): number {
  if (u16(f, a) !== 0x3f3c) throw new Error(`bard3 0x${a.toString(16)}: expected MOVE.W #imm,-(A7)`);
  return u16(f, a + 2);
}

export function readCityTables(img: Bard3Image): CityTables {
  const f = img.flat;
  const cellOffsets: Array<Array<[number, number]>> = [];
  for (let d = 0; d < 4; d++) {
    const ptr = u32(f, 0x20b5a + 4 * d) + img.bases[1]!; // RELOC32 against the DATA hunk
    const row: Array<[number, number]> = [];
    for (let k = 0; k < 21; k++) row.push([s8(f[ptr + 2 * k]!), s8(f[ptr + 2 * k + 1]!)]);
    cellOffsets.push(row);
  }
  // 0x28fc / 0x2900 push the two fill bytes (as words, low byte used); 0x1d048 / 0x1d05c push the two lengths
  const groundByte = pushImm(f, 0x28fc) & 0xff;
  const skyByte = pushImm(f, 0x2900) & 0xff;
  const skyLen = pushImm(f, 0x1d048);
  const groundLen = pushImm(f, 0x1d05c);
  if (skyLen + groundLen !== 56 * 88) throw new Error('city view clear does not cover the 112x88 view');
  // 0x9ba2: MOVEQ #20,D0 -- the city directory limit
  if (u16(f, 0x9ba2) >> 8 !== 0x70) throw new Error('bard3 0x9ba2: expected MOVEQ');
  const grpLimit = f[0x9ba3]!;
  // 0x2dda: MOVE.W #11,row ; MOVE.W #15,col ; CLR facing ; CLR map
  if (u16(f, 0x2dde) !== 0x33fc || u16(f, 0x2de6) !== 0x33fc) throw new Error('bard3 0x2dda: unexpected new-game code');
  const t: CityTables = {
    cellOffsets,
    stepCell: Array.from(f.subarray(0x20c21, 0x20c21 + 17)),
    stepSlot: Array.from(f.subarray(0x20f33, 0x20f33 + 17)),
    dRow: [0, 1, 2, 3].map((i) => s16(u16(f, 0x20aa2 + 2 * i))),
    dCol: [0, 1, 2, 3].map((i) => s16(u16(f, 0x20aaa + 2 * i))),
    skyByte,
    skyLen,
    groundByte,
    groundLen,
    palette: Array.from({ length: 16 }, (_, i) => u16(f, 0x20868 + 2 * i)),
    nightPalette: Array.from({ length: 16 }, (_, i) => u16(f, 0x208c8 + 2 * i)),
    grpLimit,
    newGame: { map: 0, y: u16(f, 0x2de0), x: u16(f, 0x2de8), facing: 0 },
  };
  // Self-checks: city view cell 16 is the square ahead for every facing; facing 0 looks +row.
  for (let d = 0; d < 4; d++) {
    const c = t.cellOffsets[d]![16]!;
    if (c[0] !== t.dCol[d] || c[1] !== -t.dRow[d]!) throw new Error(`city view table ${d}: cell 16 is not the square ahead`);
  }
  if (t.cellOffsets[0]![16]![1] !== 1) throw new Error('city view table 0: cell 16 is not one row north');
  return t;
}

/** DATA 0x20698[v]: the GRP file name for art set v (strings like `Thief_data:skara.grp`). */
export function grpFileName(img: Bard3Image, v: number): string {
  const p = u32(img.flat, 0x20698 + 4 * v) + img.bases[0]!; // RELOC32 against the CODE hunk (strings at 0x6a12..)
  if (p >= img.bases[1]!) throw new Error('grp name pointer is not in the CODE hunk');
  let s = '';
  for (let k = p; img.flat[k]; k++) s += String.fromCharCode(img.flat[k]!);
  return s.replace(/^.*:/, '');
}

export interface CityStart {
  x: number;
  y: number;
  facing: number;
  from: string;
}

export interface Bt3CityExport {
  tables: CityTables;
  cities: Bt3City[];
  /** GRP file (upper-case on disk) -> entries */
  grp: Record<string, Array<GrpEntry | null>>;
  /** art set -> GRP file */
  grpOfSet: string[];
  /** where the walker starts in each city: arrival points the game itself uses, else the first open square */
  starts: CityStart[];
  /**
   * Per city: squares a dungeon's level-0 exit (record 0x1a..0x1c) points at. All 11 are 0xf? special cells, i.e. the
   * dungeon entrances. The walker's way in (to the dungeon's first stairs square) is a HYPOTHESIS: the game enters via
   * the square's bytecode script (text + prompt + opcode 3), which is not decoded.
   */
  entrances: Array<Array<{ x: number; y: number; dungeon: number; name: string; to: { x: number; y: number; facing: number } }>>;
}

export function buildBardsTale3Cities(dataDir: string): Bt3CityExport {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const img = readBard3(rd('bard3'));
  const tables = readCityTables(img);
  const files: Record<number, Uint8Array[]> = { 1: decodeMapRecords(rd('maps.lo')), 2: decodeMapRecords(rd('maps.hi')) };
  const map = readMapTable(img);
  const cities: Bt3City[] = [];
  for (let m = 0; m < 10; m++) {
    const [file, rec] = map[m]!;
    const r = files[file]?.[rec];
    if (!r) throw new Error(`map ${m}: file ${file} record ${rec} missing`);
    cities.push(parseCity(r, m));
  }
  const grpOfSet = [0, 1, 2, 3].map((v) => grpFileName(img, v));
  const grp: Record<string, Array<GrpEntry | null>> = {};
  for (const c of cities) {
    const name = grpOfSet[c.artSet]!;
    if (!grp[name]) grp[name] = readGrpEntries(rd(name.toUpperCase()));
  }
  // Arrival points: the new-game square, first-opcode teleports from cities, dungeon level-0 exits and dungeon
  // teleports into a city (bit 7 set in a dungeon).
  const arrivals: CityStart[][] = cities.map(() => []);
  const ng = tables.newGame;
  arrivals[ng.map]!.push({ x: ng.x, y: ng.y, facing: ng.facing, from: 'new game (0x2dda)' });
  for (const c of cities)
    for (const s of c.specials)
      if (s.teleport && s.teleport.target < 0x80 && s.teleport.target < 10 && s.y < 0x80 && s.x !== 0xff)
        arrivals[s.teleport.target]!.push({ x: s.teleport.x, y: s.teleport.y, facing: 0, from: `teleport from ${c.name}` });
  const dun = buildBardsTale3Dungeon(dataDir);
  const entrances: Bt3CityExport['entrances'] = cities.map(() => []);
  for (const { id, level } of dun.levels)
    if (level.levelIndex === 0 && (level.exit.x || level.exit.y) && level.exit.city < 10)
      entrances[level.exit.city]!.push({ x: level.exit.x, y: level.exit.y, dungeon: id, name: level.name, to: startPose(level) });
  for (const { level } of dun.levels) {
    if (level.levelIndex === 0 && (level.exit.x || level.exit.y) && level.exit.city < 10)
      arrivals[level.exit.city]!.push({ x: level.exit.x, y: level.exit.y, facing: 0, from: `exit of ${level.name}` });
    for (const s of level.specials)
      if (s.teleport && s.teleport.target >= 0x80 && (s.teleport.target & 0x7f) < 10)
        arrivals[s.teleport.target & 0x7f]!.push({ x: s.teleport.x, y: s.teleport.y, facing: 0, from: `teleport from ${level.name}` });
  }
  const starts = cities.map((c, m) => {
    const ok = arrivals[m]!.find((a) => a.x < c.w && a.y < c.h && cityPassable(c.cells[a.y * c.w + a.x]!));
    if (ok) return ok;
    for (let i = 0; i < c.cells.length; i++)
      if (c.cells[i] === 0) return { x: i % c.w, y: Math.floor(i / c.w), facing: 0, from: 'first open square' };
    return { x: 0, y: 0, facing: 0, from: 'origin' };
  });
  return { tables, cities, grp, grpOfSet, starts, entrances };
}

export function exportBardsTale3Cities(dataDir: string): void {
  const { tables, cities, grp, grpOfSet, starts, entrances } = buildBardsTale3Cities(dataDir);
  const dir = resolve(assetDir('data', GAME, PLATFORM), 'city');
  mkdirSync(dir, { recursive: true });
  writeJson(resolve(dir, 'view.json'), { tables, grp, grpOfSet }, false);
  for (const c of cities) writeJson(resolve(dir, `city${c.map}.json`), { ...c, cells: Array.from(c.cells) }, false);
  writeJson(
    resolve(dir, 'cities.json'),
    { cities: cities.map((c, m) => ({ map: c.map, name: c.name, w: c.w, h: c.h, artSet: c.artSet, grp: grpOfSet[c.artSet], wraps: (c.flags & 2) !== 0, start: starts[m], entrances: entrances[m] })) },
    false,
  );
  console.log(`  bardstale3/amiga: ${cities.length} city/wilderness maps + ${Object.keys(grp).join('/')} art -> data/city/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale3Cities(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale3/data'));
}

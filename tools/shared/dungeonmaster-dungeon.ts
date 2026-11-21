/**
 * Dungeon Master / Chaos Strikes Back / Dungeon Master II dungeon-file
 * (`DUNGEON.DAT` and friends) parser: file header, per-map definitions,
 * and the per-map square (cell) grid.
 *
 * Byte layout from the Dungeon Master Encyclopaedia's "Dungeon Files" page
 * (http://dmweb.free.fr/community/documentation/file-formats/
 * dungeon-files/, fetched 2026-09-02); see `docs/dungeonmaster-format.md`
 * for the full citation and this repo's byte-exact verification against
 * real corpus files.
 *
 * Only the square-type grid (needed for a top-down/renderer view) is
 * decoded structurally here — doors/teleporters/sensors/creatures/items
 * lists are documented but not parsed (see that doc's "Open" section).
 * The map-data section start is located by walking the sections forward
 * from the header (all 16 thing-type record sizes are known: projectile = 8,
 * explosion = 4 — confirmed 2026-11 on the CSB `MINI.DAT` embedded dungeon,
 * 60 projectiles + 50 explosions, and the same size table is stored as data
 * in each game's executable overlay). The forward walk lands exactly on EOF
 * (or EOF-2 plus a checksum) for DM1 EN/FR/DE, CSB Prison EN/FR/DE, DM2 and
 * `MINI.DAT`; the declared `mapDataSize` is kept as an independent
 * cross-check. The optional 2-byte trailer is the big-endian 16-bit sum of
 * every preceding byte (4/4 exact: DM1 EN, CSB Prison, DM2, MINI).
 */
import { r16 } from '@seer-project/core';

export type SquareType = 'wall' | 'floor' | 'pit' | 'stairs' | 'door' | 'teleporter' | 'trickwall' | 'empty';

const SQUARE_TYPES: SquareType[] = ['wall', 'floor', 'pit', 'stairs', 'door', 'teleporter', 'trickwall', 'empty'];

export interface DungeonHeader {
  ornamentSeed: number;
  mapDataSize: number;
  mapCount: number;
  textDataSizeWords: number;
  startPosition: { x: number; y: number; direction: number };
  objectListSizeWords: number;
  counts: {
    doors: number;
    teleporters: number;
    texts: number;
    sensors: number;
    creatures: number;
    weapons: number;
    armours: number;
    scrolls: number;
    potions: number;
    containers: number;
    misc: number;
    projectiles: number;
    explosions: number;
  };
}

export interface MapDefinition {
  index: number;
  /**
   * Byte offset of this map's cells within the Map Data section (14/14 DM1,
   * 2/2 CSB Prison, 44/44 DM2, 11/11 MINI maps equal the cumulative byte
   * cursor). Earlier versions called this a word offset; that was wrong.
   */
  mapDataOffsetBytes: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  level: number;
  floorRandomCount: number;
  floorCount: number;
  wallRandomCount: number;
  wallCount: number;
  difficulty: number;
  creatureTypesCount: number;
  doorDecoCount: number;
  doorType1Index: number;
  doorType0Index: number;
  mapGraphicsStyle: number;
  floorCeilingStyle: number;
}

export interface Square {
  /** Raw square byte: type<<5 | hasObject<<4 | attr. */
  raw: number;
  type: SquareType;
  hasObject: boolean;
  /** Raw low nibble (type-dependent attribute bits) — see the doc for per-type meaning. */
  attr: number;
}

export interface ParsedMap {
  def: MapDefinition;
  /** `squares[y][x]`, y top-to-bottom, x left-to-right. */
  squares: Square[][];
  creatureGraphics: number[];
  wallDecoGraphics: number[];
  floorDecoGraphics: number[];
  doorDecoGraphics: number[];
}

export interface ParsedDungeon {
  header: DungeonHeader;
  maps: ParsedMap[];
  mapDataOffset: number;
  hasChecksum: boolean;
  /** Stored/computed 16-bit trailer sum when a trailer is present. */
  checksum?: { stored: number; computed: number; valid: boolean };
  /**
   * True when the forward section walk (header + 16 record lists) landed
   * exactly on the declared Map Data start; false only for the legacy
   * back-from-EOF fallback.
   */
  forwardTilingExact: boolean;
  /** True when every map's def.mapDataOffsetBytes equals the cumulative byte cursor. */
  mapOffsetsMatchCursor: boolean;
}

const RECORD_SIZE = {
  doors: 4,
  teleporters: 6,
  texts: 4,
  sensors: 8,
  creatures: 16,
  weapons: 4,
  armours: 4,
  scrolls: 4,
  potions: 4,
  containers: 8,
  misc: 4,
  projectiles: 8,
  explosions: 4,
} as const;

/** 16-bit big-endian-comparable byte sum used by the optional 2-byte trailer. */
export function dungeonChecksum(d: Uint8Array, end: number, start = 0): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum = (sum + d[i]!) & 0xffff;
  return sum;
}

/** Byte length of everything before Map Data, from the header's own counts. */
function frontMatterBytes(header: DungeonHeader, defs: { width: number }[]): number {
  const c = header.counts;
  return (
    44 +
    header.mapCount * 16 +
    defs.reduce((sum, m) => sum + m.width * 2, 0) +
    header.objectListSizeWords * 2 +
    header.textDataSizeWords * 2 +
    c.doors * RECORD_SIZE.doors +
    c.teleporters * RECORD_SIZE.teleporters +
    c.texts * RECORD_SIZE.texts +
    c.sensors * RECORD_SIZE.sensors +
    c.creatures * RECORD_SIZE.creatures +
    c.weapons * RECORD_SIZE.weapons +
    c.armours * RECORD_SIZE.armours +
    c.scrolls * RECORD_SIZE.scrolls +
    c.potions * RECORD_SIZE.potions +
    c.containers * RECORD_SIZE.containers +
    c.misc * RECORD_SIZE.misc +
    c.projectiles * RECORD_SIZE.projectiles +
    c.explosions * RECORD_SIZE.explosions
  );
}

function parseHeader(d: Uint8Array): DungeonHeader {
  const startWord = r16(d, 8, 'be');
  return {
    ornamentSeed: r16(d, 0, 'be'),
    mapDataSize: r16(d, 2, 'be'),
    mapCount: d[4],
    textDataSizeWords: r16(d, 6, 'be'),
    startPosition: { x: startWord & 0x1f, y: (startWord >> 5) & 0x1f, direction: (startWord >> 10) & 0x3 },
    objectListSizeWords: r16(d, 10, 'be'),
    counts: {
      doors: r16(d, 12, 'be'),
      teleporters: r16(d, 14, 'be'),
      texts: r16(d, 16, 'be'),
      sensors: r16(d, 18, 'be'),
      creatures: r16(d, 20, 'be'),
      weapons: r16(d, 22, 'be'),
      armours: r16(d, 24, 'be'),
      scrolls: r16(d, 26, 'be'),
      potions: r16(d, 28, 'be'),
      containers: r16(d, 30, 'be'),
      misc: r16(d, 32, 'be'),
      // offset 34,36,38 = 3 unused words
      projectiles: r16(d, 40, 'be'),
      explosions: r16(d, 42, 'be'),
    },
  };
}

function parseMapDefs(d: Uint8Array, count: number): MapDefinition[] {
  const defs: MapDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const o = 44 + i * 16;
    const sizeWord = r16(d, o + 8, 'be');
    const graphicsWord = r16(d, o + 10, 'be');
    const miscWord = r16(d, o + 12, 'be');
    const doorWord = r16(d, o + 14, 'be');
    defs.push({
      index: i,
      mapDataOffsetBytes: r16(d, o, 'be'),
      offsetX: d[o + 6],
      offsetY: d[o + 7],
      height: ((sizeWord >> 11) & 0x1f) + 1,
      width: ((sizeWord >> 6) & 0x1f) + 1,
      level: sizeWord & 0x3f,
      floorRandomCount: (graphicsWord >> 12) & 0xf,
      floorCount: (graphicsWord >> 8) & 0xf,
      wallRandomCount: (graphicsWord >> 4) & 0xf,
      wallCount: graphicsWord & 0xf,
      difficulty: (miscWord >> 12) & 0xf,
      creatureTypesCount: (miscWord >> 4) & 0xf,
      doorDecoCount: miscWord & 0xf,
      doorType1Index: (doorWord >> 12) & 0xf,
      doorType0Index: (doorWord >> 8) & 0xf,
      mapGraphicsStyle: (doorWord >> 4) & 0xf,
      floorCeilingStyle: doorWord & 0xf,
    });
  }
  return defs;
}

function decodeSquare(byte: number): Square {
  const type = SQUARE_TYPES[(byte >> 5) & 0x7];
  return { raw: byte, type, hasObject: ((byte >> 4) & 1) === 1, attr: byte & 0xf };
}

/**
 * Locate an uncompressed "Dungeon Data" section embedded in a larger buffer
 * (e.g. Chaos Strikes Back's `MINI.DAT` saved-game file, which embeds its
 * whole dungeon in plaintext — see `docs/dungeonmaster-format.md`).
 *
 * Seed-agnostic: a candidate offset is accepted only if (1) the header and
 * map definitions are structurally plausible, (2) the forward section walk
 * (`frontMatterBytes` + `mapDataSize`) ends inside the buffer, and (3) the
 * 2-byte trailer right after Map Data equals the 16-bit sum of every byte
 * from the candidate start up to it. (The previous scan whitelisted the
 * ornament seeds {99,8,13,0,5,6}, which already contained the answer's own
 * seed, so it was not independent; 2026-11 audit.) On the real `MINI.DAT`
 * this yields exactly one hit, 10098, ending exactly at EOF.
 */
export function findDungeonDataOffsets(d: Uint8Array, maxMapCount = 64): number[] {
  const hits: number[] = [];
  for (let i = 0; i + 44 + 16 <= d.length; i++) {
    const mapCount = d[i + 4]!;
    if (d[i + 5] !== 0 || mapCount < 1 || mapCount > maxMapCount) continue;
    if (i + 44 + mapCount * 16 > d.length) continue;
    const mapDataSize = r16(d, i + 2, 'be');
    if (mapDataSize < mapCount) continue;
    const sub = d.subarray(i);
    const header = parseHeader(sub);
    const defs = parseMapDefs(sub, mapCount);
    if (defs.some((m) => m.width > 32 || m.height > 32 || m.level > 63)) continue;
    const mapDataStart = frontMatterBytes(header, defs);
    const end = mapDataStart + mapDataSize;
    if (i + end + 2 > d.length) continue;
    // Map Data must itself be exactly the sum of the maps' cell counts + per-map graphics lists.
    const expectMap = defs.reduce(
      (sum, m) => sum + m.width * m.height + m.creatureTypesCount + m.wallCount + m.floorCount + m.doorDecoCount,
      0,
    );
    if (expectMap !== mapDataSize) continue;
    const stored = r16(d, i + end, 'be');
    if (dungeonChecksum(d, i + end, i) !== stored) continue;
    hits.push(i);
  }
  return hits;
}

/**
 * Parse a fully-decompressed dungeon buffer (see `ensureDungeonDecompressed`
 * in `dungeonmaster-codec.ts` for compressed `DUNGEON.DAT` files).
 */
export function parseDungeon(d: Uint8Array): ParsedDungeon {
  const header = parseHeader(d);
  const defs = parseMapDefs(d, header.mapCount);

  // Forward walk: header, map defs, per-column counts, object list, text,
  // then the 16 fixed-size record lists, then Map Data. The legacy
  // back-from-EOF placement is kept only as a fallback when the forward
  // walk does not agree with the declared mapDataSize.
  const forward = frontMatterBytes(header, defs);
  let mapDataOffset: number;
  let hasChecksum: boolean;
  let forwardTilingExact: boolean;
  if (forward + header.mapDataSize === d.length) {
    mapDataOffset = forward;
    hasChecksum = false;
    forwardTilingExact = true;
  } else if (forward + header.mapDataSize + 2 === d.length) {
    mapDataOffset = forward;
    hasChecksum = true;
    forwardTilingExact = true;
  } else {
    // Embedded in a larger buffer or an unsized variant: trust the declared
    // size, counted back from EOF (assume a trailing checksum).
    mapDataOffset = d.length - 2 - header.mapDataSize;
    hasChecksum = true;
    forwardTilingExact = false;
  }
  let checksum: ParsedDungeon['checksum'];
  if (hasChecksum && mapDataOffset + header.mapDataSize + 2 <= d.length) {
    const end = mapDataOffset + header.mapDataSize;
    const stored = r16(d, end, 'be');
    const computed = dungeonChecksum(d, end);
    checksum = { stored, computed, valid: stored === computed };
  }

  const maps: ParsedMap[] = [];
  let cursor = mapDataOffset;
  let mapOffsetsMatchCursor = true;
  for (const def of defs) {
    if (def.mapDataOffsetBytes !== cursor - mapDataOffset) mapOffsetsMatchCursor = false;
    const cellCount = def.width * def.height;
    const squares: Square[][] = Array.from({ length: def.height }, () => new Array(def.width));
    // Stored column-major: column 0 top-to-bottom, then column 1, etc.
    for (let x = 0; x < def.width; x++) {
      for (let y = 0; y < def.height; y++) {
        squares[y][x] = decodeSquare(d[cursor + x * def.height + y]);
      }
    }
    cursor += cellCount;
    const creatureGraphics = Array.from(d.subarray(cursor, cursor + def.creatureTypesCount));
    cursor += def.creatureTypesCount;
    const wallDecoGraphics = Array.from(d.subarray(cursor, cursor + def.wallCount));
    cursor += def.wallCount;
    const floorDecoGraphics = Array.from(d.subarray(cursor, cursor + def.floorCount));
    cursor += def.floorCount;
    const doorDecoGraphics = Array.from(d.subarray(cursor, cursor + def.doorDecoCount));
    cursor += def.doorDecoCount;
    maps.push({ def, squares, creatureGraphics, wallDecoGraphics, floorDecoGraphics, doorDecoGraphics });
  }

  return { header, maps, mapDataOffset, hasChecksum, checksum, forwardTilingExact, mapOffsetsMatchCursor };
}

/** Per-door info for a door square (resolved from the thing lists). */
export interface DoorInfo {
  /** 0/1 -> the map's doorType0Index / doorType1Index door set. */
  type: number;
  /** Door record attribute bit 5 (ScummVM `Door::opensVertically`). */
  vertical: boolean;
  /** Door record attribute bit 6 (`hasButton`). */
  hasButton: boolean;
  /** Door record ornament ordinal, bits 1-4. */
  ornament: number;
}

const THING_RECORD_SIZES = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, 0, 0, 0, 8, 4];
const THING_COUNT_KEYS = [
  'doors', 'teleporters', 'texts', 'sensors', 'creatures', 'weapons', 'armours', 'scrolls', 'potions',
  'containers', 'misc', null, null, null, 'projectiles', 'explosions',
] as const;

/**
 * Resolve the door record of every door square, per map: `result[mapIndex]`
 * is `Map<y*width+x, DoorInfo>`. Walks the per-square first-thing list
 * (`objectList`, one word per hasObject square in map/column-major order) and
 * each square's `next` chain (word 0 of every thing record) until a door
 * (thing type 0) is found. Thing word: cell[15:14] type[13:10] index[9:0].
 */
export function resolveDoors(d: Uint8Array, parsed: ParsedDungeon): Array<Map<number, DoorInfo>> {
  const h = parsed.header;
  const defs = parsed.maps.map((m) => m.def);
  const sumW = defs.reduce((s, m) => s + m.width, 0);
  const objListStart = 44 + h.mapCount * 16 + sumW * 2;
  const textStart = objListStart + h.objectListSizeWords * 2;
  const listsStart = textStart + h.textDataSizeWords * 2;
  const starts: number[] = [];
  let cur = listsStart;
  for (let t = 0; t < 16; t++) {
    starts.push(cur);
    const key = THING_COUNT_KEYS[t];
    cur += key ? h.counts[key] * THING_RECORD_SIZES[t]! : 0;
  }
  const out: Array<Map<number, DoorInfo>> = [];
  let objIdx = 0;
  for (const m of parsed.maps) {
    const doors = new Map<number, DoorInfo>();
    const { width, height } = m.def;
    // object list order = column-major (see `parseDungeon`)
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const sq = m.squares[y]![x]!;
        if (!sq.hasObject) continue;
        let thing = r16(d, objListStart + objIdx * 2, 'be');
        objIdx++;
        if (sq.type !== 'door') continue;
        for (let guard = 0; guard < 64 && thing < 0xfffe; guard++) {
          const type = (thing >> 10) & 0xf;
          const index = thing & 0x3ff;
          const rec = starts[type]! + index * THING_RECORD_SIZES[type]!;
          if (type === 0) {
            const attr = r16(d, rec + 2, 'be');
            doors.set(y * width + x, { type: attr & 1, ornament: (attr >> 1) & 0xf, vertical: ((attr >> 5) & 1) === 1, hasButton: ((attr >> 6) & 1) === 1 });
            break;
          }
          thing = r16(d, rec, 'be');
        }
      }
    }
    out.push(doors);
  }
  return out;
}

/** Teleporter square destination (thing type 1, 6-byte record). */
export interface TeleporterInfo {
  map: number;
  x: number;
  y: number;
  /** Rotation bits 10-11 of the record's first attribute word. */
  rot: number;
  /** Bit 12 of that word: HYPOTHESIS that it selects relative (vs absolute) rotation. */
  relative: boolean;
}

/**
 * Resolve the teleporter record of every teleporter square, per map
 * (`result[mapIndex]`: cell index y*width+x -> destination). Record words
 * (big-endian): [0] next-thing, [1] bits 0-4 target X, 5-9 target Y,
 * 10-11 rotation, 12 rotation type; [2] bits 8-15 target map. Checked on DM2
 * `DUNGEON.DAT`: 216/216 destinations are in-bounds, non-solid cells of the
 * target map (swapped X/Y control: 53/216).
 */
export function resolveTeleporters(d: Uint8Array, parsed: ParsedDungeon): Array<Map<number, TeleporterInfo>> {
  const h = parsed.header;
  const defs = parsed.maps.map((m) => m.def);
  const sumW = defs.reduce((s, m) => s + m.width, 0);
  const objListStart = 44 + h.mapCount * 16 + sumW * 2;
  const textStart = objListStart + h.objectListSizeWords * 2;
  const listsStart = textStart + h.textDataSizeWords * 2;
  const starts: number[] = [];
  let cur = listsStart;
  for (let t = 0; t < 16; t++) {
    starts.push(cur);
    const key = THING_COUNT_KEYS[t];
    cur += key ? h.counts[key] * THING_RECORD_SIZES[t]! : 0;
  }
  const out: Array<Map<number, TeleporterInfo>> = [];
  let objIdx = 0;
  for (const m of parsed.maps) {
    const res = new Map<number, TeleporterInfo>();
    const { width, height } = m.def;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const sq = m.squares[y]![x]!;
        if (!sq.hasObject) continue;
        let thing = r16(d, objListStart + objIdx * 2, 'be');
        objIdx++;
        if (sq.type !== 'teleporter') continue;
        for (let guard = 0; guard < 64 && thing < 0xfffe; guard++) {
          const type = (thing >> 10) & 0xf;
          const rec = starts[type]! + (thing & 0x3ff) * THING_RECORD_SIZES[type]!;
          if (type === 1) {
            const w1 = r16(d, rec + 2, 'be');
            res.set(y * width + x, { map: r16(d, rec + 4, 'be') >> 8, x: w1 & 31, y: (w1 >> 5) & 31, rot: (w1 >> 10) & 3, relative: ((w1 >> 12) & 1) === 1 });
            break;
          }
          thing = r16(d, rec, 'be');
        }
      }
    }
    out.push(res);
  }
  return out;
}

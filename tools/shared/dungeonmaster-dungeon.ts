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
 * The map-data section start is located by working backward from the end
 * of the (already-decompressed) dungeon buffer using the header's own
 * declared `mapDataSize`, since Map Data is always the last content
 * section before an optional 2-byte checksum — this needs no assumption
 * about the exact record width of every preceding list type (some of
 * which — Projectiles/Explosions — the community docs don't give a fixed
 * record size for, and can be non-empty in save-embedded dungeons).
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
  mapDataOffsetWords: number;
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
} as const;

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
      mapDataOffsetWords: r16(d, o, 'be'),
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
  return { type, hasObject: ((byte >> 4) & 1) === 1, attr: byte & 0xf };
}

/**
 * Parse a fully-decompressed dungeon buffer (see `ensureDungeonDecompressed`
 * in `dungeonmaster-codec.ts` for compressed `DUNGEON.DAT` files).
 */
/**
 * Locate an uncompressed "Dungeon Data" section embedded in a larger
 * buffer (e.g. Chaos Strikes Back's `MINI.DAT` saved-game file, which
 * embeds its whole dungeon in plaintext per the "Saved Game Files" docs —
 * see `docs/dungeonmaster-format.md`). Scans for the header shape
 * `[ornamentSeed:u16][mapDataSize:u16][mapCount:u8][pad:u8]` with
 * `mapCount` matching one of the known real values (2 = CSB Prison,
 * 11 = CSB Dungeon, 14 = DM1, 44 = DM2) and `pad === 0`. Returns the byte
 * offset of every match — callers should expect exactly one on a
 * well-formed file (verified 2026-09-02 against the real `MINI.DAT`: a
 * single hit, whose distance to EOF matches the dmweb-documented section
 * byte length exactly).
 */
const KNOWN_ORNAMENT_SEEDS = new Set([99, 8, 13, 0, 5, 6]); // see dmweb "Dungeon Files" § header word 0

export function findDungeonDataOffsets(d: Uint8Array, knownMapCounts = [2, 11, 14, 44]): number[] {
  const hits: number[] = [];
  for (let i = 0; i + 44 + 16 <= d.length; i++) {
    const ornamentSeed = r16(d, i, 'be');
    const mapCount = d[i + 4];
    if (d[i + 5] !== 0 || !knownMapCounts.includes(mapCount) || !KNOWN_ORNAMENT_SEEDS.has(ornamentSeed)) continue;
    const mapDataSize = r16(d, i + 2, 'be');
    if (mapDataSize < 16 || mapDataSize > 200000) continue;
    // Cross-check map definition 0 (right after the 44-byte header) for a
    // plausible width/height/level, and that its declared map-data offset
    // fits inside the declared map-data region.
    const sizeWord = r16(d, i + 44 + 8, 'be');
    const height = ((sizeWord >> 11) & 0x1f) + 1;
    const width = ((sizeWord >> 6) & 0x1f) + 1;
    const level = sizeWord & 0x3f;
    const mapDataOffsetWords = r16(d, i + 44, 'be');
    if (width < 1 || width > 32 || height < 1 || height > 32 || level > 63) continue;
    if (mapDataOffsetWords * 2 >= mapDataSize) continue;
    hits.push(i);
  }
  return hits;
}

export function parseDungeon(d: Uint8Array): ParsedDungeon {
  const header = parseHeader(d);
  const defs = parseMapDefs(d, header.mapCount);

  // Locate Map Data: it's the last content section, sized exactly
  // header.mapDataSize, optionally followed by a 2-byte checksum before EOF.
  const withChecksumOffset = d.length - 2 - header.mapDataSize;
  const noChecksumOffset = d.length - header.mapDataSize;
  // Independent cross-check for files where Projectiles/Explosions are
  // known-empty (every standalone dungeon.dat; save-embedded dungeons may
  // have non-zero counts and this front-matter estimate will then be a
  // lower bound rather than exact).
  const indexOfSquaresBytes = defs.reduce((sum, m) => sum + m.width * 2, 0);
  const frontMatter =
    44 +
    header.mapCount * 16 +
    indexOfSquaresBytes +
    header.objectListSizeWords * 2 +
    header.textDataSizeWords * 2 +
    header.counts.doors * RECORD_SIZE.doors +
    header.counts.teleporters * RECORD_SIZE.teleporters +
    header.counts.texts * RECORD_SIZE.texts +
    header.counts.sensors * RECORD_SIZE.sensors +
    header.counts.creatures * RECORD_SIZE.creatures +
    header.counts.weapons * RECORD_SIZE.weapons +
    header.counts.armours * RECORD_SIZE.armours +
    header.counts.scrolls * RECORD_SIZE.scrolls +
    header.counts.potions * RECORD_SIZE.potions +
    header.counts.containers * RECORD_SIZE.containers +
    header.counts.misc * RECORD_SIZE.misc;

  let mapDataOffset: number;
  let hasChecksum: boolean;
  if (header.counts.projectiles === 0 && header.counts.explosions === 0 && frontMatter === withChecksumOffset) {
    mapDataOffset = withChecksumOffset;
    hasChecksum = true;
  } else if (header.counts.projectiles === 0 && header.counts.explosions === 0 && frontMatter === noChecksumOffset) {
    mapDataOffset = noChecksumOffset;
    hasChecksum = false;
  } else {
    // Save-embedded dungeon (or a variant with non-empty projectile/
    // explosion lists this reader doesn't size): trust the header-declared
    // section ordering. Community docs confirm save-embedded Dungeon Data
    // always carries a checksum.
    mapDataOffset = withChecksumOffset;
    hasChecksum = true;
  }

  const maps: ParsedMap[] = [];
  let cursor = mapDataOffset;
  for (const def of defs) {
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

  return { header, maps, mapDataOffset, hasChecksum };
}

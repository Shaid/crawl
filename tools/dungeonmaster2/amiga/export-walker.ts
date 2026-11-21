/**
 * Dungeon Master II (Amiga) walker asset exporter.
 *
 * Emits `public/assets/dungeonmaster2/amiga/data/walker-maps.json`: every one
 * of the 44 `DUNGEON.DAT` maps as raw square bytes (type<<5 | hasObject<<4 |
 * attr), teleporter destinations, door types, plus the start pose. The viewport
 * art is exported separately by `export-viewport.ts`.
 *
 * Usage: `npx tsx tools/dungeonmaster2/amiga/export-walker.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { parseDungeon, resolveDoors, resolveTeleporters } from '../../shared/dungeonmaster-dungeon.ts';
import type { Dm2Bundle } from './model.ts';

export function buildBundle(file: Uint8Array): Dm2Bundle {
  const d = ensureDungeonDecompressed(file);
  const p = parseDungeon(d);
  const tele = resolveTeleporters(d, p);
  const doors = resolveDoors(d, p);
  return {
    start: { mapIndex: 0, x: p.header.startPosition.x, y: p.header.startPosition.y, facing: p.header.startPosition.direction },
    maps: p.maps.map((m, mi) => ({
      index: m.def.index,
      level: m.def.level,
      width: m.def.width,
      height: m.def.height,
      offsetX: m.def.offsetX,
      offsetY: m.def.offsetY,
      mapGraphicsStyle: m.def.mapGraphicsStyle,
      floorCeilingStyle: m.def.floorCeilingStyle,
      raw: m.squares.flatMap((row) => row.map((sq) => sq.raw)),
      teleporters: Object.fromEntries(tele[mi]!),
      doorTypes: [m.def.doorType0Index, m.def.doorType1Index] as [number, number],
      doorKinds: Object.fromEntries([...doors[mi]!].map(([cell, info]) => [cell, info.type])),
    })),
  };
}

/** Read `data/dungeonmaster2/amiga/DUNGEON.DAT`, write `walker-maps.json`; returns the map count. */
export function exportWalker(dataDir = resolve('data', 'dungeonmaster2', 'amiga')): number {
  const bundle = buildBundle(new Uint8Array(readFileSync(resolve(dataDir, 'DUNGEON.DAT'))));
  writeJson(resolve(assetDir('data', 'dungeonmaster2', 'amiga'), 'walker-maps.json'), bundle);
  return bundle.maps.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`walker-maps.json: ${exportWalker()} maps`);
}

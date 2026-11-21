/**
 * Dungeon Master II (Amiga) walker asset exporter.
 *
 * Emits `public/assets/dungeonmaster2/amiga/data/walker-maps.json`: every one
 * of the 44 `DUNGEON.DAT` maps as raw square bytes (type<<5 | hasObject<<4 |
 * attr) plus the start pose. Art is not exported: the viewport compositor is
 * undecoded (docs/dungeonmaster2/TODO.md `dm2-viewport-scenes`).
 *
 * Usage: `npx tsx tools/dungeonmaster2/amiga/export-walker.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { parseDungeon, resolveTeleporters } from '../../shared/dungeonmaster-dungeon.ts';
import type { Dm2Bundle } from './model.ts';

export function buildBundle(file: Uint8Array): Dm2Bundle {
  const d = ensureDungeonDecompressed(file);
  const p = parseDungeon(d);
  const tele = resolveTeleporters(d, p);
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
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = new Uint8Array(readFileSync(resolve('data', 'dungeonmaster2', 'amiga', 'DUNGEON.DAT')));
  const bundle = buildBundle(raw);
  writeJson(resolve(assetDir('data', 'dungeonmaster2', 'amiga'), 'walker-maps.json'), bundle);
  console.log(`walker-maps.json: ${bundle.maps.length} maps`);
}

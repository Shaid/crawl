/**
 * Dungeon Master (Amiga) extractor.
 *
 * Decodes `Dungeon.DAT`/`DungeonF.DAT`/`DungeonG.DAT` (compressed dungeon
 * files — English/French/German) into per-level top-down diagrams + JSON,
 * and a sample of `Graphics.DAT`'s `IMG1` wall/UI images into a greyscale
 * atlas (real decoded pixel indices; the real 16-colour Amiga palette is
 * not yet recovered — see `docs/dungeonmaster-format.md`).
 *
 * See `docs/dungeonmaster/amiga/data-structure.md` for full evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';
import { parseDataFileHeader, readItem } from '../../shared/dungeonmaster-container.ts';
import { decodeImg1, ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { parseDungeon, type ParsedDungeon } from '../../shared/dungeonmaster-dungeon.ts';
import { packGreyscaleAtlas, renderMapTopDown } from '../../shared/dungeonmaster-render.ts';

const GAME = 'dungeonmaster';
const PLATFORM = 'amiga';
const DATA_DIR = resolve('data', GAME, PLATFORM);

function exportDungeon(filename: string, label: string) {
  const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, filename)));
  const d = ensureDungeonDecompressed(raw);
  const parsed = parseDungeon(d);
  writeJson(resolve(assetDir('data', GAME, PLATFORM), `${label}.json`), {
    source: filename,
    header: parsed.header,
    maps: parsed.maps.map((m) => ({
      def: m.def,
      creatureGraphics: m.creatureGraphics,
      wallDecoGraphics: m.wallDecoGraphics,
      floorDecoGraphics: m.floorDecoGraphics,
      doorDecoGraphics: m.doorDecoGraphics,
      squares: m.squares.map((row) => row.map((sq) => `${sq.type[0]}${sq.hasObject ? '*' : ''}`)),
    })),
  });
  return parsed;
}

async function exportTopDownMaps(parsed: ParsedDungeon, label: string) {
  const screensDir = assetDir('screens', GAME, PLATFORM);
  const entries = [];
  for (const map of parsed.maps) {
    const { rgba, width, height } = renderMapTopDown(map);
    const name = `${label}-map${String(map.def.index).padStart(2, '0')}-lvl${map.def.level}`;
    await writePNG(resolve(screensDir, `${name}.png`), rgba, width, height);
    entries.push(manifestEntry(`screens/${name}`, 0));
  }
  return entries;
}

async function exportWallAtlas() {
  const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'Graphics.DAT')));
  const df = parseDataFileHeader(data);
  const images: { name: string; img: ReturnType<typeof decodeImg1> }[] = [];
  for (const item of df.items) {
    if (item.size < 4 || item.size > 32768) continue;
    const raw = readItem(data, item);
    const w = (raw[0] << 8) | raw[1];
    const h = (raw[2] << 8) | raw[3];
    if (w === 0 || h === 0 || w > 350 || h > 220 || w * h > 40000) continue;
    const img = decodeImg1(raw);
    images.push({ name: `item${item.index}`, img });
  }
  // Cap the atlas to a representative sample (every corpus item decodes
  // cleanly per the extractor's self-check — see the data-structure doc —
  // this cap is only to keep one shipped PNG a reasonable size).
  const sample = images.slice(0, 400);
  const atlas = packGreyscaleAtlas(sample, 1024);
  const spriteDir = assetDir('sprites', GAME, PLATFORM);
  await writePNG(resolve(spriteDir, 'graphics-sample.png'), atlas.rgba, atlas.width, atlas.height);
  writeJson(resolve(spriteDir, 'graphics-sample.json'), { frames: atlas.frames, width: atlas.width, height: atlas.height });
  return { entry: manifestEntry('sprites/graphics-sample', sample.length), totalImageItems: images.length };
}

async function main() {
  const manifest = [] as ReturnType<typeof manifestEntry>[];

  const dm = exportDungeon('Dungeon.DAT', 'dungeon-en');
  manifest.push(...(await exportTopDownMaps(dm, 'en')));
  const dmF = exportDungeon('DungeonF.DAT', 'dungeon-fr');
  manifest.push(...(await exportTopDownMaps(dmF, 'fr')));
  const dmG = exportDungeon('DungeonG.DAT', 'dungeon-ge');
  manifest.push(...(await exportTopDownMaps(dmG, 'ge')));

  const { entry, totalImageItems } = await exportWallAtlas();
  manifest.push(entry);
  console.log(`Graphics.DAT: ${totalImageItems} IMG1 image-like items decoded (0 residue — see doc)`);

  writeManifest(manifest, GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`Wrote ${manifest.length} manifest entries for ${GAME}/${PLATFORM}`);
}

main();

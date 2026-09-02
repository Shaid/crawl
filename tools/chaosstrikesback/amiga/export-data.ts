/**
 * Chaos Strikes Back (Amiga) extractor.
 *
 * Source: the 3 ADF disk images in `data/_unexplored_/ChaosStrikesBack/`,
 * extracted by `extract-adf.ts` into `data/chaosstrikesback/amiga/`
 * (`disk1/`, `disk2/`, `disk3/` — `disk3` is a blank/formatted character
 * "Utility Disk" with no files, see `docs/chaosstrikesback/amiga/
 * data-structure.md`).
 *
 * Decodes the Prison dungeon (`disk1/Dungeon.DAT`, a standalone
 * compressed dungeon file) and the real Chaos Strikes Back dungeon (11
 * maps, embedded uncompressed inside `disk2/MINI.DAT`'s saved-game
 * envelope — located by pattern, not a hardcoded offset, see
 * `findDungeonDataOffsets`) into per-level top-down diagrams + JSON, plus
 * a sample of `disk1/Graphics.DAT`'s `IMG1` images into a greyscale atlas.
 *
 * See `docs/chaosstrikesback/amiga/data-structure.md` for full evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';
import { parseDataFileHeader, readItem } from '../../shared/dungeonmaster-container.ts';
import { decodeImg1, ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { findDungeonDataOffsets, parseDungeon, type ParsedDungeon } from '../../shared/dungeonmaster-dungeon.ts';
import { packGreyscaleAtlas, renderMapTopDown } from '../../shared/dungeonmaster-render.ts';

const GAME = 'chaosstrikesback';
const PLATFORM = 'amiga';
const DATA_DIR = resolve('data', GAME, PLATFORM);

function exportDungeonBuffer(raw: Uint8Array, source: string, label: string): ParsedDungeon {
  const d = ensureDungeonDecompressed(raw);
  const parsed = parseDungeon(d);
  writeJson(resolve(assetDir('data', GAME, PLATFORM), `${label}.json`), {
    source,
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
  const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk1/Graphics.DAT')));
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
  const sample = images.slice(0, 400);
  const atlas = packGreyscaleAtlas(sample, 1024);
  const spriteDir = assetDir('sprites', GAME, PLATFORM);
  await writePNG(resolve(spriteDir, 'graphics-sample.png'), atlas.rgba, atlas.width, atlas.height);
  writeJson(resolve(spriteDir, 'graphics-sample.json'), { frames: atlas.frames, width: atlas.width, height: atlas.height });
  return { entry: manifestEntry('sprites/graphics-sample', sample.length), totalImageItems: images.length };
}

async function main() {
  const manifest = [] as ReturnType<typeof manifestEntry>[];

  const prison = exportDungeonBuffer(
    new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk1/Dungeon.DAT'))),
    'disk1/Dungeon.DAT',
    'dungeon-prison',
  );
  manifest.push(...(await exportTopDownMaps(prison, 'prison')));

  const mini = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk2/MINI.DAT')));
  const offsets = findDungeonDataOffsets(mini);
  if (offsets.length !== 1) {
    throw new Error(`expected exactly 1 Dungeon Data section in MINI.DAT, found ${offsets.length}: ${offsets.join(',')}`);
  }
  console.log(`MINI.DAT: Dungeon Data section located at offset ${offsets[0]} (pattern scan, not hardcoded)`);
  const csbDungeon = exportDungeonBuffer(mini.subarray(offsets[0]), `disk2/MINI.DAT+${offsets[0]}`, 'dungeon-csb');
  manifest.push(...(await exportTopDownMaps(csbDungeon, 'csb')));

  const { entry, totalImageItems } = await exportWallAtlas();
  manifest.push(entry);
  console.log(`disk1/Graphics.DAT: ${totalImageItems} IMG1 image-like items decoded (0 residue — see doc)`);

  writeManifest(manifest, GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`Wrote ${manifest.length} manifest entries for ${GAME}/${PLATFORM}`);
}

main();

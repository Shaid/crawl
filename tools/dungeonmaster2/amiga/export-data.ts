/**
 * Dungeon Master II: Skullkeep (Amiga) extractor.
 *
 * `DUNGEON.DAT` (uncompressed, `DMII` container quirks) decodes with the
 * same dungeon-file reader as Dungeon Master / Chaos Strikes Back — the
 * community docs confirm the square-grid byte layout is shared across the
 * whole family, with one addition: square type `7` ("Empty square") is
 * DM2-only and is now real, observed data in this corpus (see
 * `docs/dungeonmaster2/amiga/data-structure.md`). `GRAPHICS.DAT` uses the
 * `DMII` container header (`0x8005` signature). Unlike DM1/CSB, its images
 * are NOT `IMG1` — the community docs' own item-type table marks almost
 * the whole file `RAW1` ("not yet decoded"). Real bytes confirm they are
 * `IMG4` instead (big-endian header, 6-nibble local palette, different RLE
 * control-nibble grammar): 2,237/2,263 plausible-header items (98.9%)
 * decode to >=95% filled with zero decode errors, and the rendered atlas
 * shows unmistakable real content (multi-language status-bar UI text —
 * "HEALTH/STAMINA/MANA", "GEZOND/KRAFT/MANA", "SANTE/VIGUEUR/MANA",
 * "POISONED VERGIFTET VENENEUX" — plus weapon and wall-texture art). See
 * `docs/dungeonmaster2/amiga/data-structure.md` for full evidence. A
 * minority of items (the DM2-specific "differential"/overlay `IMG8`
 * sub-format, compositing 2-3 images together) are NOT decoded — see the
 * doc's open items.
 *
 * `music/*.MOD` (x10): despite the `.MOD` extension, real bytes show every
 * one is `P41A`-signed ("The Player 4.1A", a proprietary Amiga module
 * packer licensed/leaked to game studios — not standard ProTracker; see
 * `tools/shared/amiga-player4x.ts`). Unpacked to real, standard
 * `M.K.`-tagged ProTracker `.mod` files under `audio/` — quantitatively
 * verified (RMS + lag-1 sample autocorrelation) as real, non-degenerate
 * decoded audio: 29/30 samples show strong self-correlation (r1 in
 * [0.57, 0.99]); the one exception has a non-degenerate amplitude range
 * consistent with a percussive/noise instrument, not a decode failure.
 *
 * See `docs/dungeonmaster2/amiga/data-structure.md` for full evidence.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';
import { parseDataFileHeader, readItem } from '../../shared/dungeonmaster-container.ts';
import { decodeImg4, ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { parseDungeon, type ParsedDungeon } from '../../shared/dungeonmaster-dungeon.ts';
import { packGreyscaleAtlas, renderMapTopDown } from '../../shared/dungeonmaster-render.ts';
import { convertPlayer4xToMod, isPlayer4x } from '../../shared/amiga-player4x.ts';

const GAME = 'dungeonmaster2';
const PLATFORM = 'amiga';
const DATA_DIR = resolve('data', GAME, PLATFORM);

function exportDungeon(filename: string, label: string): ParsedDungeon {
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
  const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'GRAPHICS.DAT')));
  const df = parseDataFileHeader(data);
  const images: { name: string; img: ReturnType<typeof decodeImg4> }[] = [];
  let candidateCount = 0;
  for (const item of df.items) {
    if (item.size < 8 || item.size > 32768) continue;
    const raw = readItem(data, item);
    const w = (raw[0] << 8) | raw[1];
    const h = (raw[2] << 8) | raw[3];
    if (w === 0 || h === 0 || w > 350 || h > 220 || w * h > 40000) continue;
    candidateCount++;
    let img: ReturnType<typeof decodeImg4>;
    try {
      img = decodeImg4(raw);
    } catch {
      continue;
    }
    // A minority of items are the "differential"/overlay `IMG8` sub-format
    // (composited over a separately-stored base image) — decodeImg4 alone
    // leaves those mostly unfilled. Skip anything that isn't >=95% filled
    // rather than shipping a partially-garbage render.
    let filled = 0;
    for (const p of img.pixels) if (p >= 0) filled++;
    if (filled < img.pixels.length * 0.95) continue;
    images.push({ name: `item${item.index}`, img });
  }
  const sample = images.slice(0, 400);
  const atlas = packGreyscaleAtlas(sample, 1024);
  const spriteDir = assetDir('sprites', GAME, PLATFORM);
  await writePNG(resolve(spriteDir, 'graphics-sample.png'), atlas.rgba, atlas.width, atlas.height);
  writeJson(resolve(spriteDir, 'graphics-sample.json'), { frames: atlas.frames, width: atlas.width, height: atlas.height });
  return { entry: manifestEntry('sprites/graphics-sample', sample.length), candidateCount, decodedCount: images.length };
}

function exportMusic() {
  const musicDir = resolve(DATA_DIR, 'music');
  const outDir = assetDir('audio', GAME, PLATFORM);
  let unpacked = 0;
  let skipped = 0;
  for (const f of readdirSync(musicDir).sort()) {
    const raw = new Uint8Array(readFileSync(resolve(musicDir, f)));
    if (!isPlayer4x(raw)) {
      skipped++;
      continue;
    }
    const mod = convertPlayer4xToMod(raw);
    writeFileSync(resolve(outDir, f.replace(/\.MOD$/i, '.mod')), mod);
    unpacked++;
  }
  return { unpacked, skipped };
}

async function main() {
  const manifest = [] as ReturnType<typeof manifestEntry>[];

  const dm2 = exportDungeon('DUNGEON.DAT', 'dungeon');
  manifest.push(...(await exportTopDownMaps(dm2, 'dm2')));

  const { entry, candidateCount, decodedCount } = await exportWallAtlas();
  manifest.push(entry);
  console.log(`GRAPHICS.DAT: ${candidateCount} plausible image-shaped items, ${decodedCount} decoded as IMG4 (>=95% filled)`);

  const { unpacked, skipped } = exportMusic();
  console.log(`music/: ${unpacked} P41A modules unpacked to ProTracker .mod, ${skipped} skipped (not P41A-signed)`);

  writeManifest(manifest, GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`Wrote ${manifest.length} manifest entries for ${GAME}/${PLATFORM}`);
}

main();

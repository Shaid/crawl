/**
 * Extracts the SNES ROM's dungeon/environment tile-art bank -- the SNES
 * analog of the Amiga port's `mazedata.ega` (see
 * docs/wizardry6/amiga/data-structure.md section 4) and the answer to the
 * long-open `snes-dungeon-maze-data` question.
 *
 * Found via a `re-codebreaker` escalation this session, **independently
 * re-verified from scratch** (fresh Python render, not the escalation's own
 * script -- see game-re-lessons/verify-escalation-artifacts-not-just-claims.md):
 * decoding file 0x080000 onward as a flat run of standard SNES 4bpp tiles
 * (see tools/shared/snes-ppu.ts) and laying it out 32 tiles/row independently
 * reproduces the escalation's claimed content -- an unmistakable, continuous
 * stone-block wall with horizontal mortar courses running the full
 * 256px tile-row width, an arched opening, and banded rows of smaller
 * architectural fragments (doorframe/window-frame pieces) below it.
 *
 * **Format -- confirmed structurally, hypothesis on addressing.** File
 * 0x070000-0x0F0000 (banks $0E-$1D, 512 KB) is plain, uncompressed 4bpp SNES
 * tile data with NO container, directory, or header -- invisible to every
 * census this project had tried before (not LZSS: no `JSL $838000` call site
 * points here; not `MVN`-copied with an immediate source bank; not reachable
 * from any long-addressing-instruction census). Sub-regions:
 *
 *   - $0E-$0F (0x070000-0x080000): figure/creature line art
 *   - $10-$19 (0x080000-0x0D0000): **dungeon/environment art** -- this
 *     extractor's scope
 *   - $1A-$1B (0x0D0000-0x0E0000): framed-picture art + dense pattern tiles
 *   - $1C-$1D (0x0E0000-0x0F0000): main kanji/kana font (16x16px glyphs,
 *     4bpp) -- not extracted here, see docs section 4.4
 *
 * A vertical-edge-continuity scan (matching tile bottom row against tile
 * `t+cols` top row) over tiles 96-600 of bank $10 gives a shallow,
 * monotonically-decaying match rate for every candidate raster width tried
 * (8/12/16/32 tiles/row) with no peak -- i.e. this is a **loose tile pool**
 * addressed by tilemap/compose-list indices at runtime, not a fixed-width
 * raster image. No index/compose-list structure into this bank has been
 * traced yet (see `snes-dungeon-art-composer` in docs/wizardry6/TODO.md), so
 * this extractor dumps the confirmed $10-$19 span as a flat, individually
 * addressable tile atlas (contact-sheet layout, 32 tiles/row, matching the
 * render that confirmed the content) rather than a composed picture --
 * downstream consumers pick tiles by index until the real compose-list is
 * found.
 *
 * **Palette -- not confirmed.** Rendered in flat greyscale (index*17),
 * per project convention (never assert an unconfirmed palette).
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-dungeon-art.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile4bpp, TILE_BYTES_4BPP, TILE_SIZE_PX } from '../../shared/snes-ppu';

const BANK_START = 0x080000; // file offset, CPU $10:8000 -- confirmed start of "dungeon/environment art"
const BANK_END = 0x0d0000; // file offset, CPU $19:FFFF+1 -- confirmed end (banks $1A-$1B are a different content family)
const ATLAS_COLS = 32; // tiles/row -- matches the render that confirmed this content as stone-wall/arch art

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-dungeon-art.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  const size = BANK_END - BANK_START;
  const tileCount = Math.floor(size / TILE_BYTES_4BPP);
  const leftover = size - tileCount * TILE_BYTES_4BPP;
  if (leftover !== 0) {
    console.error(
      `Oracle check FAILED: span 0x${BANK_START.toString(16)}-0x${BANK_END.toString(16)} (${size} bytes) is not an exact multiple of ${TILE_BYTES_4BPP} -- ${leftover} leftover bytes. Not writing output.`,
    );
    process.exit(1);
  }
  console.log(
    `Oracle check: dungeon-art span 0x${BANK_START.toString(16)}-0x${BANK_END.toString(16)} (${size} bytes) divides evenly into ${tileCount} whole 4bpp tiles.`,
  );

  const rows = Math.ceil(tileCount / ATLAS_COLS);
  const width = ATLAS_COLS * TILE_SIZE_PX;
  const height = rows * TILE_SIZE_PX;
  const rgba = new Uint8Array(width * height * 4);

  for (let t = 0; t < tileCount; t++) {
    const tile = decodeTile4bpp(data, BANK_START + t * TILE_BYTES_4BPP);
    const tx = (t % ATLAS_COLS) * TILE_SIZE_PX;
    const ty = Math.floor(t / ATLAS_COLS) * TILE_SIZE_PX;
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const idx = tile[row * TILE_SIZE_PX + col];
        const grey = idx * 17;
        const px = ((ty + row) * width + (tx + col)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = idx === 0 ? 0 : 255;
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/dungeon-art.png'), rgba, width, height);
  writeJson(resolve(outDir, 'sprites/dungeon-art.json'), {
    width,
    height,
    tileSize: TILE_SIZE_PX,
    cols: ATLAS_COLS,
    tileCount,
    fileOffsetStart: BANK_START,
    fileOffsetEnd: BANK_END,
    bpp: 4,
    confidence: 'rendered',
    note:
      'Loose tile pool (banks $10-$19), NOT a raster image -- no fixed raster width found (edge-continuity scan shows no periodic structure). ' +
      'Tile index i is at fileOffset = 0x080000 + i*32. Content confirmed by render: stone-block walls with mortar courses, an arched ' +
      'opening, and banded architectural fragments (SNES analog of the Amiga mazedata.ega bank). Palette unconfirmed -- greyscale render. ' +
      'The real compose-list/index structure that selects tiles from this pool at runtime is not yet traced -- see docs/wizardry6/snes/TODO.md ' +
      'row snes-dungeon-art-composer.',
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => e.name !== 'dungeon-art');
  withoutOld.push({
    name: 'dungeon-art',
    group: 'sprites',
    png: 'sprites/dungeon-art.png',
    atlas: 'sprites/dungeon-art.json',
    palette: null,
    sprites: tileCount,
  });
  writeJson(manifestPath, withoutOld);

  console.log(`Decoded ${tileCount} 8x8px dungeon-art tiles (greyscale, rendered) into a ${width}x${height} contact-sheet atlas.`);
  console.log('Wrote public/assets/wizardry6/snes/sprites/dungeon-art.png, dungeon-art.json, and updated manifest.json');
}

main();

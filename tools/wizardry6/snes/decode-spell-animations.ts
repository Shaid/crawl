/**
 * Extracts the SNES ROM's spell/combat special-effect animation bank (see
 * docs/wizardry6/snes/data-structure.md section 6.4).
 *
 * Found via a `re-codebreaker` escalation researching a lead this project
 * had previously (mis)identified as a dungeon/maze-geometry candidate --
 * that premise is refuted: this is the spell & combat animation bank, not
 * maze data. Independently re-verified this session (LZSS decoder
 * re-implemented from scratch from the escalation's cited disassembly,
 * master-directory parsing, and frame-table parsing all re-derived and
 * checked against the ROM directly, not copy-pasted from the escalation's
 * own scratch scripts -- see `verify-escalation-artifacts-not-just-claims.md`).
 *
 * **Format** -- ROM banks $32-$3F (file 0x190000-0x1FFEF1, LoROM):
 * - Master directory at file 0x190000: 139 x u16 LE record pointers (CPU
 *   addresses within bank $32), unordered. `fileOffset = 0x190000 +
 *   (word - 0x8000)`.
 * - Each record (variable length, back-to-back, contiguous from
 *   file 0x190116):
 *   | Offset | Size | Field |
 *   |---|---|---|
 *   | +0 | 1 | `lead` -- bit 7 selects the record's *mode* (0 = mode A, tile-
 *   |    |   | map-cell frames; 1 = mode B, flat 3x3 single-tile-index frames) |
 *   | +1 | 2 | graphics pointer, CPU address (bank at +3) |
 *   | +3 | 1 | graphics pointer, bank |
 *   | +4 | 2 | frame-table pointer, CPU address (bank at +6) |
 *   | +6 | 1 | frame-table pointer, bank |
 *   | +7 | n | animation sequence: `u8` 1-based frame numbers, `0x00`-terminated |
 * - Graphics: `[u16 LE compressedSize][LZSS stream]` at the graphics
 *   pointer -- see `tools/shared/snes-lzss.ts`. Mode A tiles are standard
 *   4bpp (32 B/tile, see `tools/shared/snes-ppu.ts`); mode B tiles are 2bpp
 *   (16 B/tile).
 * - Frame table:
 *   - **Mode A**: an array of u16 LE pointers (count = `max(sequence)`,
 *     confirmed structural invariant, see below), each pointing to a frame
 *     entry `[x][y][w][h][w*h x u16 LE tilemap cell]` -- standard SNES BG
 *     tilemap words (`vhopppcc cccccccc`: tile number in the low 10 bits,
 *     palette in bits 10-12, priority/flip in bits 13-15).
 *   - **Mode B**: flat, no pointer array -- frame `k` (0-based) is 9 raw
 *     `u8` tile indices at `frameTablePtr + k*9`, laid out row-major into a
 *     3x3 / 24x24px grid (same convention as the confirmed face-portrait
 *     bank, `decode-portrait-tiles.ts`) -- but unlike portraits, every
 *     observed mode-B frame uses the *same* tile index in all 9 cells (a
 *     uniform-fill effect frame, e.g. a screen flash or dissolve/dither
 *     step), not 9 independent tiles.
 *
 * **Verification (this session, independent of the escalation's own
 * artifacts)**:
 * - LZSS decoder re-implemented from the escalation's cited algorithm and
 *   run against 3 unrelated resources (this bank's record 0, the opening
 *   logo, the opening copyright screen) -- all three consume *exactly*
 *   their declared header length with zero overrun, and the two opening
 *   screens render as fully legible English text/logo (see
 *   `decode-opening-sequence.ts`), which is strong independent evidence the
 *   *same* decoder is correct here too.
 * - Master directory: 139 pointers, minimum resolves to file 0x190116 (zero
 *   gap after the 278-byte pointer table itself) -- re-derived directly,
 *   not copied from the escalation's report.
 * - Record 0 (lead 0x06, mode A): frame-table entries resolve to 9
 *   increasing file offsets with a clean per-entry stride (`4 + w*h*2`
 *   bytes), tile cell values decode to small, in-range tile numbers
 *   (max observed here: 1) -- re-derived and checked by hand.
 *   Rendered (session scratchpad, not committed) as a coherent
 *   organic/particle-like shape, not noise.
 * - A mode-B record (index 23, lead 0xc2) was hand-decoded this session:
 *   17 frames, each 9 identical tile-index bytes (frame k -> tile k+1) --
 *   confirms the "uniform-fill frame" reading above and the mode-B frame
 *   count convention (`max(sequence)` frames, same as mode A).
 *
 * **Palette -- not confirmed.** The escalation tried the boot-time full
 * CGRAM palette (section 3.5) against a sample frame and got a plausible
 * but unverified result; this extractor renders in greyscale rather than
 * assert an unconfirmed colour, per project convention.
 *
 * **Scope of this extractor**: decodes and packs every record's raw tile
 * bank (like `decode-ui-icons.ts`) plus the structured frame data (cell
 * placement / sequence) as JSON, so a runtime consumer can compose actual
 * animation frames later. It does *not* pre-render composed animation
 * frames as PNGs -- same "tiles + compose-list, not baked frames" pattern
 * the Amiga corpus's `mazedata.ega`/`decode-maze.ts` established for
 * multi-tile compose-list content.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-spell-animations.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile2bpp, decodeTile4bpp, TILE_SIZE_PX } from '../../shared/snes-ppu';
import { decodeLzss } from '../../shared/snes-lzss';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const DIRECTORY_OFFSET = 0x190000; // file offset -- confirmed master directory (CPU $32:8000)
const BOOT_CGRAM_SHADOW = 0x127e4; // the $7E:3800 CGRAM shadow's ROM initialiser (docs 3.5/3.14.10)
const DIRECTORY_ENTRY_COUNT = 139;
const BANK32_BASE = 0x190000; // file offset of ROM bank $32 (CPU bank $b2 mirror), addr $8000

function cpuToFileOffset(bank: number, addr: number): number {
  return (bank & 0x7f) * 0x8000 + (addr - 0x8000);
}

interface FrameCellA {
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number[]; // raw tilemap words, tile number = cells[i] & 0x3ff
}

interface Record {
  index: number;
  fileOffset: number;
  lead: number;
  mode: 'A' | 'B';
  gfxFileOffset: number;
  frameTableFileOffset: number;
  sequence: number[];
  tileCount: number;
  bpp: 2 | 4;
  framesA?: FrameCellA[]; // mode A only
  framesB?: number[][]; // mode B only -- 9 tile indices per frame
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-spell-animations.ts <path-to-sfc>');
    process.exit(1);
  }
  const data = readBinary(romPath);

  const records: Record[] = [];
  // Each entry: 64 palette indices, range depends on that tile's own bpp
  // (0-15 for mode-A 4bpp tiles, 0-3 for mode-B 2bpp tiles) -- tracked
  // per-tile in allTilesBpp since mode A and mode B tiles are interleaved
  // in file/record order and must be greyscale-normalized differently.
  const allTiles: Uint8Array[] = [];
  const allTilesBpp: (2 | 4)[] = [];

  for (let i = 0; i < DIRECTORY_ENTRY_COUNT; i++) {
    const dirWord = data[DIRECTORY_OFFSET + i * 2] | (data[DIRECTORY_OFFSET + i * 2 + 1] << 8);
    const recOff = BANK32_BASE + (dirWord - 0x8000);

    const lead = data[recOff];
    const mode: 'A' | 'B' = (lead & 0x80) === 0 ? 'A' : 'B';
    const gfxAddr = data[recOff + 1] | (data[recOff + 2] << 8);
    const gfxBank = data[recOff + 3];
    const ftAddr = data[recOff + 4] | (data[recOff + 5] << 8);
    const ftBank = data[recOff + 6];

    const sequence: number[] = [];
    let p = recOff + 7;
    while (data[p] !== 0 && p < data.length) {
      sequence.push(data[p]);
      p++;
    }
    const frameCount = sequence.length > 0 ? Math.max(...sequence) : 0;

    const gfxFileOffset = cpuToFileOffset(gfxBank, gfxAddr);
    const frameTableFileOffset = cpuToFileOffset(ftBank, ftAddr);

    const { data: gfx } = decodeLzss(data, gfxFileOffset);
    const bpp: 2 | 4 = mode === 'A' ? 4 : 2;
    const tileBytes = bpp === 4 ? 32 : 16;
    const tileCount = Math.floor(gfx.length / tileBytes);

    const tileIndexStart = allTiles.length;
    for (let t = 0; t < tileCount; t++) {
      allTiles.push(bpp === 4 ? decodeTile4bpp(gfx, t * tileBytes) : decodeTile2bpp(gfx, t * tileBytes));
      allTilesBpp.push(bpp);
    }

    const record: Record = {
      index: i,
      fileOffset: recOff,
      lead,
      mode,
      gfxFileOffset,
      frameTableFileOffset,
      sequence,
      tileCount,
      bpp,
    };

    if (mode === 'A') {
      const framesA: FrameCellA[] = [];
      for (let k = 0; k < frameCount; k++) {
        const ptrWord = data[frameTableFileOffset + k * 2] | (data[frameTableFileOffset + k * 2 + 1] << 8);
        const entryOff = cpuToFileOffset(ftBank, ptrWord);
        const x = data[entryOff];
        const y = data[entryOff + 1];
        const w = data[entryOff + 2];
        const h = data[entryOff + 3];
        const cells: number[] = [];
        for (let c = 0; c < w * h; c++) {
          cells.push(data[entryOff + 4 + c * 2] | (data[entryOff + 4 + c * 2 + 1] << 8));
        }
        framesA.push({ x, y, w, h, cells });
      }
      record.framesA = framesA;
    } else {
      const framesB: number[][] = [];
      for (let k = 0; k < frameCount; k++) {
        const off = frameTableFileOffset + k * 9;
        framesB.push(Array.from(data.slice(off, off + 9)));
      }
      record.framesB = framesB;
    }

    // Store the tile-index range this record's tiles occupy in the shared atlas.
    (record as Record & { tileIndexStart: number }).tileIndexStart = tileIndexStart;
    records.push(record);
  }

  console.log(
    `Parsed ${records.length} records (${records.filter((r) => r.mode === 'A').length} mode A, ` +
      `${records.filter((r) => r.mode === 'B').length} mode B), ${allTiles.length} total tiles decoded.`,
  );

  // Pack every record's tiles into one shared atlas, 32 tiles/row.
  const ATLAS_MAX_WIDTH = 32 * TILE_SIZE_PX;
  const packItems: ShelfPackInput[] = allTiles.map((_, i) => ({
    name: `spellanim_tile_${String(i).padStart(4, '0')}`,
    width: TILE_SIZE_PX,
    height: TILE_SIZE_PX,
  }));
  const packed = shelfPack(packItems, ATLAS_MAX_WIDTH, 0);

  const rgba = new Uint8Array(packed.width * packed.height * 4);
  for (let t = 0; t < allTiles.length; t++) {
    const frame = packed.frames[t];
    const tile = allTiles[t];
    // 4bpp indices (0-15) -> *17; 2bpp indices (0-3) -> *85. Using the wrong
    // scale on a 2bpp (mode-B) tile would render it near-black (max value
    // 3*17=51 instead of 3*85=255) -- caught in review, see the paths-tried
    // note in data-structure.md section 6.4.
    const greyScale = allTilesBpp[t] === 4 ? 17 : 85;
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const idx = tile[row * TILE_SIZE_PX + col];
        const grey = idx * greyScale;
        const px = ((frame.y + row) * packed.width + (frame.x + col)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = idx === 0 ? 0 : 255;
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/spell-animations.png'), rgba, packed.width, packed.height);
  // Mode-A palette -- CONFIRMED (2026-08-16): the mode-A frames' tilemap
  // words carry real per-cell BG palette fields (bits 10-12; corpus census:
  // sub-palettes 0,1,3,4,5,6,7 all used, and sub-palette 2 -- the
  // region-swapped dungeon slot, docs 3.14.10 -- used by ZERO of 77,056
  // cells, a designed avoidance). The colours are the boot CGRAM shadow's
  // BG rows (ROM file 0x127e4). A colour composite of record 11 renders a
  // decisive gold-and-blue magic casting circle. Exported here so a
  // consumer can compose frames in real colour.
  const bgPalettes: Array<Array<{ r: number; g: number; b: number }>> = [];
  for (let p = 0; p < 8; p++) {
    const row: Array<{ r: number; g: number; b: number }> = [];
    for (let c = 0; c < 16; c++) {
      const w = data[BOOT_CGRAM_SHADOW + p * 32 + c * 2]! | (data[BOOT_CGRAM_SHADOW + p * 32 + c * 2 + 1]! << 8);
      row.push({ r: (w & 31) << 3, g: ((w >> 5) & 31) << 3, b: ((w >> 10) & 31) << 3 });
    }
    bgPalettes.push(row);
  }

  writeJson(resolve(outDir, 'sprites/spell-animations.json'), {
    atlas: { width: packed.width, height: packed.height, tileSize: TILE_SIZE_PX },
    bgPalettes,
    records: records.map((r) => ({
      ...r,
      tileIndexStart: (r as Record & { tileIndexStart: number }).tileIndexStart,
      tileFrames: packed.frames
        .slice(
          (r as Record & { tileIndexStart: number }).tileIndexStart,
          (r as Record & { tileIndexStart: number }).tileIndexStart + r.tileCount,
        )
        .map((f) => ({ x: f.x, y: f.y })),
    })),
    note:
      'Atlas is greyscale; compose mode-A frames in colour via each tilemap cell word\'s own palette field (bits 10-12) ' +
      'against bgPalettes (the boot CGRAM shadow\'s 8 BG rows, ROM 0x127e4) -- CONFIRMED, see docs section 6.4. ' +
      'Tiles are packed per-record (tileIndexStart..+tileCount) into the shared atlas; ' +
      'framesA/framesB describe how to compose them into actual animation frames at runtime -- not pre-rendered.',
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => e.name !== 'spell-animations');
  withoutOld.push({
    name: 'spell-animations',
    group: 'sprites',
    png: 'sprites/spell-animations.png',
    atlas: 'sprites/spell-animations.json',
    palette: null, // greyscale, unconfirmed real colour
    sprites: allTiles.length,
  });
  writeJson(manifestPath, withoutOld);

  console.log(
    `Decoded ${records.length} spell/combat animation records (${allTiles.length} tiles total, greyscale, palette unconfirmed) into a ${packed.width}x${packed.height} atlas.`,
  );
  console.log(
    'Wrote public/assets/wizardry6/snes/sprites/spell-animations.png, spell-animations.json, and updated manifest.json',
  );
}

main();

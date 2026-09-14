/**
 * Extracts the SNES ROM's UI icon tile bank (see
 * docs/wizardry6/snes/data-structure.md section 3.2's "Correction" block
 * and section 4.3).
 *
 * Format: a flat run of standard SNES 4bpp bitplane-interleaved 8x8 tiles
 * (see tools/shared/snes-ppu.ts) at file offset 0x2ad57-0x2e000 -- the exact
 * gap between the face-portrait directory's pool A (ending 0x2ad57) and pool
 * B (starting 0x2e000, see decode-portrait-tiles.ts). This span is not a
 * fixed-record directory like the portrait bank; it's a flat tile *bank*
 * (individually addressable 8x8 cells, referenced by tile index from a
 * tilemap elsewhere), confirmed two independent ROM->WRAM MVN copies source
 * from inside it:
 *   - file 0x008e42 (CPU $01:8E42): MVN $7f,$85, src=$2ad57, dst WRAM
 *     $7f:1000, size 0x400 (32 tiles)
 *   - file 0x0080b9 (CPU $01:80B9): MVN $7f,$85, src=$2c177, dst WRAM
 *     $7f:0da0, size 0x1180 (140 tiles)
 * Both are one-time boot-init copies (same routine cluster as the portrait
 * bank's own MVN calls). The span size (0x2e000 - 0x2ad57 = 0x32a9 =
 * 12,969 bytes) is not an exact multiple of 32 -- floor(12969 / 32) = 405
 * whole tiles with 9 trailing bytes left over (not a whole tile; treated as
 * inter-bank padding/alignment filler, not decoded).
 *
 * **Confirmed by render**: decoding all 405 tiles and laying them out in a
 * wide contact sheet (32 tiles/row) shows a decorative gradient/border strip
 * followed by individually legible UI icon tiles -- unambiguous half-width
 * compass letters E/S/W/N (a dungeon-navigation facing indicator), digit-like
 * tiles, arrows, and small item/action icons (a chest, boots/footprints) --
 * not noise, not a repeating abstract pattern. See the doc for the full
 * render-confirmation writeup.
 *
 * **Palette -- confirmed** (see docs/wizardry6/snes/data-structure.md
 * section 3.2b). This bank is *not* loaded through the portrait bank's own
 * tile-loader entry point, but a sibling entry point 4 bytes into the same
 * shared palette-copy routine (file 0x1069c/0x106a0, CPU $82:869C/$82:86A0 --
 * literally mid-body of the routine documented in decode-portrait-tiles.ts,
 * skipping its selector-computation prologue) is called directly from two
 * sites in the portrait-loading bank (file 0x13ad9, 0x13b0f) with explicit
 * X/Y/A operands instead of a computed selector. Both sites set DP `$ca` =
 * `0x14` (20) immediately after the copy -- confirmed against the generic
 * per-frame CGRAM-DMA dispatch table (file 0x4162/0x4163/0x4165): `$ca=20`
 * -> CGADD=0x80 (sub-palette 8, i.e. CGRAM colours 128-143), source WRAM
 * `$7e:3900`, size 32 bytes (16 colours) -- and the call sites' own operands
 * (X=0x100 -> dest $7e:3800+0x100=$7e:3900; loop count 0x20) match this
 * table record exactly, byte-for-byte. The two call sites pull from *two*
 * groups of the **same shared CGRAM colour table** the portrait bank uses
 * (file 0x10764, 32 bytes/group) -- group 46 (source Y=0x5c0 =
 * 46*32) and group 51 (Y=0x660 = 51*32). Groups 45-52 of that table share a
 * fixed "UI chrome" sub-palette (gold/tan border colour, dark green, black
 * outline, dark red at fixed indices 8-12 in every group, matching this
 * bank's "3D bevel" border look) with a few indices varying per group --
 * consistent with two colour variants of the same icon set (e.g. two
 * different menu/window screens reusing CGRAM slot 8). **Confirmed by
 * render**: applying group 46 (or 51) to this tile bank produces coherent,
 * non-scrambled art -- round medallion/badge icons with gold borders (the
 * compass-letter badges), grey tunnel/passage-wall decoration, arrows, and
 * item icons all render in plausible, structurally consistent colour, not
 * noise. Group 46 is baked into the primary PNG; group 51 is documented as
 * a confirmed alternate (see `paletteAlternateGroups` in the JSON sidecar)
 * but not separately rendered.
 *
 * Layout: individual 8x8 tiles, shelf-packed one sprite per tile (405
 * frames) -- this is a *tile bank* referenced by index from elsewhere, not
 * a single composed picture, so there is no natural single "width x height"
 * grid to assert (see tile-grid-dimension-needs-render-not-just-bytecount.md
 * -- avoided here by not claiming a composed multi-tile picture at all).
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-ui-icons.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import {
  decodeTile4bpp,
  decodeCgramPalette,
  TILE_BYTES_4BPP,
  TILE_SIZE_PX,
} from '../../shared/snes-ppu';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const BANK_START = 0x2ad57; // file offset -- confirmed byte immediately after portrait pool A
const BANK_END = 0x2e000; // file offset -- confirmed start of portrait pool B
const ATLAS_MAX_WIDTH = 32 * TILE_SIZE_PX; // 32 tiles/row, matches the confirmed contact-sheet render

// Confirmed palette (see header comment): shared CGRAM colour table also
// used by decode-portrait-tiles.ts, group 46 as primary, group 51 as a
// confirmed alternate (a second call site pulls the same bank through the
// same CGRAM slot with a different colour group).
const PALETTE_TABLE_BASE = 0x10764; // file offset, CPU $82:8764
const PALETTE_GROUP_BYTES = 32; // 16 BGR555 colours/group
const PALETTE_GROUP_PRIMARY = 46;
const PALETTE_GROUP_ALTERNATES = [51];

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-ui-icons.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  // Oracle check: refuse to run against the wrong ROM/offsets -- the span
  // must sit exactly between the two confirmed portrait-directory pools
  // (see decode-portrait-tiles.ts's own oracle). Re-derive pool A's end and
  // pool B's start from the portrait directory itself rather than trusting
  // the literal constants above blindly.
  const DIRECTORY_OFFSET = 0x105d1;
  const ROM_BANK5_BASE = 0x28000;
  const offsets: number[] = [];
  for (let i = 0; i < 36; i++) {
    const off = DIRECTORY_OFFSET + i * 2;
    const word = data[off] | (data[off + 1] << 8);
    offsets.push(ROM_BANK5_BASE + (word - 0x8000));
  }
  const poolAEnd = Math.max(...offsets.slice(0, 30)) + 0x120; // last pool-A record's end
  const poolBStart = Math.min(...offsets.slice(30, 36));
  if (poolAEnd !== BANK_START || poolBStart !== BANK_END) {
    console.error(
      `Oracle check FAILED: portrait directory implies UI-icon bank span 0x${poolAEnd.toString(16)}-0x${poolBStart.toString(16)}, ` +
        `but this extractor is hard-coded to 0x${BANK_START.toString(16)}-0x${BANK_END.toString(16)}. Not writing output.`,
    );
    process.exit(1);
  }
  console.log(
    `Oracle check: UI-icon bank span 0x${BANK_START.toString(16)}-0x${BANK_END.toString(16)} confirmed against the portrait directory's own pool boundaries.`,
  );

  const size = BANK_END - BANK_START;
  const tileCount = Math.floor(size / TILE_BYTES_4BPP);
  const leftover = size - tileCount * TILE_BYTES_4BPP;
  console.log(
    `Bank size 0x${size.toString(16)} (${size} bytes) -> ${tileCount} whole 4bpp tiles, ${leftover} trailing bytes not decoded.`,
  );

  const packItems: ShelfPackInput[] = [];
  for (let t = 0; t < tileCount; t++) {
    packItems.push({
      name: `ui_icon_${String(t).padStart(3, '0')}`,
      width: TILE_SIZE_PX,
      height: TILE_SIZE_PX,
    });
  }
  const packed = shelfPack(packItems, ATLAS_MAX_WIDTH, 0);

  const palette = decodeCgramPalette(data, PALETTE_TABLE_BASE + PALETTE_GROUP_PRIMARY * PALETTE_GROUP_BYTES, 16);
  const rgba = new Uint8Array(packed.width * packed.height * 4);

  for (let t = 0; t < tileCount; t++) {
    const frame = packed.frames[t];
    const tile = decodeTile4bpp(data, BANK_START + t * TILE_BYTES_4BPP);
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const idx = tile[row * TILE_SIZE_PX + col];
        const [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
        const px = ((frame.y + row) * packed.width + (frame.x + col)) * 4;
        rgba[px] = r;
        rgba[px + 1] = g;
        rgba[px + 2] = b;
        rgba[px + 3] = idx === 0 ? 0 : 255; // index 0 = transparent, same convention as the portrait bank
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/ui-icons.png'), rgba, packed.width, packed.height);
  writeJson(resolve(outDir, 'sprites/ui-icons.json'), {
    frames: packed.frames.map((f, i) => ({
      name: f.name,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      tileIndex: i,
      fileOffset: BANK_START + i * TILE_BYTES_4BPP,
    })),
    width: packed.width,
    height: packed.height,
    paletteGroup: PALETTE_GROUP_PRIMARY,
    paletteFileOffset: PALETTE_TABLE_BASE + PALETTE_GROUP_PRIMARY * PALETTE_GROUP_BYTES,
    paletteAlternateGroups: PALETTE_GROUP_ALTERNATES,
    note: 'Full-colour render, confirmed CGRAM palette (group 46 baked in; group 51 is a confirmed alternate, not separately rendered) -- see docs/wizardry6/snes/data-structure.md section 3.2b',
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = {
    name: string;
    group: string;
    png: string;
    atlas: string | null;
    palette: string | null;
    sprites: number;
  };
  const manifest: ManifestEntry[] = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : [];
  const withoutOld = manifest.filter((e) => e.name !== 'ui-icons');
  withoutOld.push({
    name: 'ui-icons',
    group: 'sprites',
    png: 'sprites/ui-icons.png',
    atlas: 'sprites/ui-icons.json',
    palette: null, // colours are baked into the PNG (confirmed CGRAM palette, group 46) -- see docs/wizardry6/snes/data-structure.md section 3.2b
    sprites: tileCount,
  });
  writeJson(manifestPath, withoutOld);

  console.log(
    `Decoded ${tileCount} 8x8px UI icon tiles (full colour, confirmed CGRAM palette group ${PALETTE_GROUP_PRIMARY}) into a ${packed.width}x${packed.height} atlas.`,
  );
  console.log(
    'Wrote public/assets/wizardry6/snes/sprites/ui-icons.png, ui-icons.json, and updated manifest.json',
  );
}

main();

/**
 * Decodes Wizardry 6 (Amiga) WFONT0.EGA, the small UI font.
 *
 * Format (confirmed by rendering -- see docs/wizardry6/amiga/data-structure.md
 * section "WFONT0.EGA"): 128 glyphs, 8x8 pixels, 1 bit per pixel, 1 byte per
 * row (8 bytes/glyph), MSB-first, no header. 128 * 8 = 1024 bytes, matching
 * the file size exactly. Glyph index == ASCII code (glyphs for the full
 * 0x00-0x7F range render as a standard ASCII font: digits, uppercase
 * letters, punctuation all legible in the rendered atlas).
 *
 * Usage: npx tsx tools/wizardry6/decode-font.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodeMonoGlyphSheet } from '../shared/amiga-planar.ts';

const GLYPH_W = 8;
const GLYPH_H = 8;
const GLYPH_COUNT = 128;
const COLS = 16;

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-font.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'WFONT0.EGA'));
  if (data.length !== 1024) {
    console.warn(`WFONT0.EGA: expected 1024 bytes, got ${data.length}`);
  }

  const { rgba, width, height } = decodeMonoGlyphSheet(data, GLYPH_W, GLYPH_H, GLYPH_COUNT, COLS);

  const outDir = resolve('public/assets/wizardry6/amiga/sprites');
  mkdirSync(outDir, { recursive: true });
  writePNG(resolve(outDir, 'wfont0.png'), rgba, width, height);

  const frames = [];
  for (let g = 0; g < GLYPH_COUNT; g++) {
    frames.push({
      name: `glyph_${g.toString(16).padStart(2, '0')}`,
      x: (g % COLS) * GLYPH_W,
      y: Math.floor(g / COLS) * GLYPH_H,
      w: GLYPH_W,
      h: GLYPH_H,
      charCode: g,
    });
  }
  writeJson(resolve(outDir, 'wfont0.json'), { frames, width, height });

  console.log(`Wrote wfont0.png/.json (${GLYPH_COUNT} glyphs, ${GLYPH_W}x${GLYPH_H} 1bpp)`);
}

main();

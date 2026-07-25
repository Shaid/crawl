/**
 * Stage 1: Parse Black Crypt executable data tables → JSON.
 * Extracts palettes, item definitions, and class stats from the game binaries.
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeJson } from '@seer/pipeline';

// Amiga 12-bit color → 24-bit RGB
function amiga12ToRGB(v: number): [number, number, number] {
  return [((v >> 8) & 0xF) * 17, ((v >> 4) & 0xF) * 17, (v & 0xF) * 17];
}

interface PaletteEntry {
  index: number;
  value: number;
  rgb: [number, number, number];
}

interface ItemDef {
  gfxNumber: number;
  nameOffset: number;
  itemType: number;
  weight: number;
  size: number;
  ac: number;
  extraEffect: number;
  extraValue: number;
}

interface ClassDef {
  name: string;
  stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/blackcrypt/export-game-data.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('data/extracted/blackcrypt');
  mkdirSync(outDir, { recursive: true });

  // === Extract palette from bcdfq ===
  const bcdfqPath = resolve(dataDir, 'bcdfq');
  let palettes: PaletteEntry[][] = [];
  try {
    const bcdfq = readFileSync(bcdfqPath);
    // Palette at offset 0x2C6 (32 × 16-bit BE Amiga colors)
    const palOff = 0x2c6;
    const pal: PaletteEntry[] = [];
    for (let i = 0; i < 32; i++) {
      const v = (bcdfq[palOff + i * 2] << 8) | bcdfq[palOff + i * 2 + 1];
      pal.push({ index: i, value: v, rgb: amiga12ToRGB(v) });
    }
    palettes.push(pal);
    console.log(`Extracted 32-color palette from bcdfq at 0x${palOff.toString(16)}`);
  } catch {
    console.log('bcdfq not found — skipping palette extraction');
  }

  // === Extract item definitions from bcdfp DATA section ===
  const bcdfpPath = resolve(dataDir, 'bcdfp');
  let items: ItemDef[] = [];
  try {
    const bcdfp = readFileSync(bcdfpPath);
    // DATA hunk is at offset 0x566C, 1748 bytes
    const dataOff = 0x566c;
    const dataSize = 1748;
    const chunk = bcdfp.subarray(dataOff, dataOff + dataSize);

    // Scan for item records (start with 0x80 marker, then gfx byte)
    let pos = 0;
    while (pos < chunk.length - 8) {
      // Look for item-like structures: gfxNumber(2) + nameOffset(2) + props
      const gfx = (chunk[pos] << 8) | chunk[pos + 1];
      const nameOff = (chunk[pos + 2] << 8) | chunk[pos + 3];
      // Valid gfx numbers are 0x0001–0xFFFF
      if (gfx > 0 && gfx <= 0xffff && nameOff > 0 && nameOff <= 0xffff) {
        // Check if this looks like an item: pos+5 should be itemType byte
        const itemType = chunk[pos + 5];
        // Item types from the documented format
        if (itemType >= 0x01 && itemType <= 0x30) {
          const weight = (chunk[pos + 8] << 8) | chunk[pos + 9];
          const size = (chunk[pos + 10] << 8) | chunk[pos + 11];
          const ac = chunk[pos + 12];
          const effect = (chunk[pos + 13] << 8) | chunk[pos + 14];
          const evalue = (chunk[pos + 15] << 8) | chunk[pos + 16];
          items.push({
            gfxNumber: gfx,
            nameOffset: nameOff,
            itemType,
            weight,
            size,
            ac,
            extraEffect: effect,
            extraValue: evalue,
          });
          pos += 18;
          continue;
        }
      }
      pos += 2;
    }
    console.log(`Extracted ${items.length} item definitions from bcdfp`);
  } catch {
    console.log('bcdfp not found — skipping item extraction');
  }

  // === Extract class names from bcdfp ===
  let classes: ClassDef[] = [];
  try {
    const bcdfp = readFileSync(bcdfpPath);
    const dataOff = 0x566c;
    const dataSize = 1748;
    const chunk = bcdfp.subarray(dataOff, dataOff + dataSize);

    const classNamePattern = /(FIGHTER|CLERIC|MAGIC USER|DRUID)/g;
    const text = new TextDecoder('ascii').decode(chunk);
    let match;
    while ((match = classNamePattern.exec(text)) !== null) {
      const name = match[0];
      // Stats are before the name in the data section
      const namePos = match.index;
      const statsOff = namePos - 12; // 6 stats × 2 bytes each
      if (statsOff >= 0) {
        classes.push({
          name,
          stats: {
            str: (chunk[statsOff] << 8) | chunk[statsOff + 1],
            dex: (chunk[statsOff + 2] << 8) | chunk[statsOff + 3],
            con: (chunk[statsOff + 4] << 8) | chunk[statsOff + 5],
            int: (chunk[statsOff + 6] << 8) | chunk[statsOff + 7],
            wis: (chunk[statsOff + 8] << 8) | chunk[statsOff + 9],
            cha: (chunk[statsOff + 10] << 8) | chunk[statsOff + 11],
          },
        });
      }
    }
    console.log(`Extracted ${classes.length} class definitions from bcdfp`);
  } catch {
    console.log('bcdfp not found — skipping class extraction');
  }

  // === Write output ===
  writeJson(resolve(outDir, 'palette.json'), palettes);
  writeJson(resolve(outDir, 'items.json'), items);
  writeJson(resolve(outDir, 'classes.json'), classes);
  console.log(`Wrote pipeline output to ${outDir}`);
}

main();

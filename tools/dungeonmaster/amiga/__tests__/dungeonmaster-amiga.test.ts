import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg1, ensureDungeonDecompressed } from '../../../shared/dungeonmaster-codec.ts';
import { parseDungeon } from '../../../shared/dungeonmaster-dungeon.ts';

const DATA_DIR = 'data/dungeonmaster/amiga';
const HAS_CORPUS = existsSync(resolve(DATA_DIR, 'Graphics.DAT'));

describe.skipIf(!HAS_CORPUS)('Dungeon Master (Amiga), real corpus', () => {
  it('Dungeon.DAT decompresses and parses to 14 maps', () => {
    const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'Dungeon.DAT')));
    const d = ensureDungeonDecompressed(raw);
    const parsed = parseDungeon(d);
    expect(parsed.header.mapCount).toBe(14);
    expect(parsed.maps).toHaveLength(14);
    for (const m of parsed.maps) {
      expect(m.def.width).toBeGreaterThan(0);
      expect(m.def.height).toBeGreaterThan(0);
      expect(m.squares).toHaveLength(m.def.height);
      expect(m.squares[0]).toHaveLength(m.def.width);
    }
  });

  it('Graphics.DAT: every image-shaped IMG1 item decodes with 0 residue', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'Graphics.DAT')));
    const df = parseDataFileHeader(data);
    // Confirmed 2026-09-02: DM1's own Graphics.DAT is DMCSB2 (0x8001
    // signature, 749 items) — same container variant as CSB's, not the
    // signature-less DMCSB1 shape (see docs/dungeonmaster-format.md).
    expect(df.format).toBe('DMCSB2');
    expect(df.itemCount).toBe(749);
    let imageItems = 0;
    for (const item of df.items) {
      if (item.size < 4 || item.size > 32768) continue;
      const raw = readItem(data, item);
      const w = (raw[0] << 8) | raw[1];
      const h = (raw[2] << 8) | raw[3];
      if (w === 0 || h === 0 || w > 350 || h > 220 || w * h > 40000) continue;
      imageItems++;
      const img = decodeImg1(raw);
      expect(img.pixels).toHaveLength(w * h);
    }
    // Confirmed 2026-09-02: all 683 image-shaped items in this corpus.
    expect(imageItems).toBe(683);
  });
});

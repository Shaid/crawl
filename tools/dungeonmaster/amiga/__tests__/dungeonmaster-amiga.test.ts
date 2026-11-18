import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg1Checked, decodeImg4Checked, isImg1Image, ensureDungeonDecompressed } from '../../../shared/dungeonmaster-codec.ts';
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
    // Structural check (replaces shape-only asserts): forward section walk
    // ends on Map Data, 16-bit byte-sum trailer verifies, per-map byte offsets match.
    expect(parsed.forwardTilingExact).toBe(true);
    expect(parsed.checksum).toEqual({ stored: 0x2853, computed: 0x2853, valid: true });
    expect(parsed.mapOffsetsMatchCursor).toBe(true);
  });

  it('Graphics.DAT: IMG1 classification by exact stream consumption (687 images; item 672 is data)', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'Graphics.DAT')));
    const df = parseDataFileHeader(data);
    // DM1's own Graphics.DAT is DMCSB2 (0x8001, 749 items) — same variant as CSB's.
    expect(df.format).toBe('DMCSB2');
    expect(df.itemCount).toBe(749);
    const images: number[] = [];
    for (const item of df.items) {
      const raw = readItem(data, item);
      if (isImg1Image(raw)) images.push(item.index);
    }
    // Real check: the run stream ends exactly on each item's last nibble.
    // (The old "pixels.length === w*h" assertion could never fail.) 2026-11
    // audit: 682 size-filtered items + 5 full screens the filter dropped = 687.
    expect(images).toHaveLength(687);
    for (const full of [1, 4, 5, 728, 738]) expect(images).toContain(full); // 320x153 / 320x200 screens
    // Item 672 has a 130x11-looking header but is a length-prefixed data item:
    // the run stream fills 1430 px after 18 nibbles and leaves 238 unread.
    expect(images).not.toContain(672);
    const r672 = decodeImg1Checked(readItem(data, df.items[672]!));
    expect(r672.exact).toBe(false);
    expect(r672.availableNibbles - r672.consumedNibbles).toBe(238);
    // Null control: the wrong grammar (DM2's IMG4 + trailer) must tile almost nothing.
    let wrong = 0;
    for (const i of images) if (decodeImg4Checked(readItem(data, df.items[i]!))) wrong++;
    expect(wrong).toBeLessThan(images.length * 0.05);
  });
});

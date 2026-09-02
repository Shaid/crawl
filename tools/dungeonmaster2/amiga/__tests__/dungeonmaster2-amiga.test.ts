import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg4 } from '../../../shared/dungeonmaster-codec.ts';
import { parseDungeon } from '../../../shared/dungeonmaster-dungeon.ts';

const DATA_DIR = 'data/dungeonmaster2/amiga';
const HAS_CORPUS = existsSync(resolve(DATA_DIR, 'GRAPHICS.DAT'));

describe.skipIf(!HAS_CORPUS)('Dungeon Master II (Amiga), real corpus', () => {
  it('DUNGEON.DAT (uncompressed) parses to 44 maps, including the DM2-only "empty" square type', () => {
    const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'DUNGEON.DAT')));
    const parsed = parseDungeon(raw); // not 0x8104-signed on this corpus
    expect(parsed.header.mapCount).toBe(44);
    expect(parsed.maps).toHaveLength(44);
    // Map 0's level matches the community docs' independently-stated
    // location ("Level 7 - Sun Clan / Hall of Champions").
    expect(parsed.maps[0]!.def.level).toBe(7);

    let sawEmpty = false;
    for (const m of parsed.maps) {
      for (const row of m.squares) for (const sq of row) if (sq.type === 'empty') sawEmpty = true;
    }
    expect(sawEmpty).toBe(true);
  });

  it('GRAPHICS.DAT: the IMG4 codec (not IMG1) decodes >=95% of image-shaped items with 0 exceptions', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'GRAPHICS.DAT')));
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMII');
    expect(df.itemCount).toBe(4630);

    let candidates = 0;
    let filledOk = 0;
    for (const item of df.items) {
      if (item.size < 8 || item.size > 32768) continue;
      const raw = readItem(data, item);
      const w = (raw[0] << 8) | raw[1];
      const h = (raw[2] << 8) | raw[3];
      if (w === 0 || h === 0 || w > 350 || h > 220 || w * h > 40000) continue;
      candidates++;
      const img = decodeImg4(raw); // must not throw
      let filled = 0;
      for (const p of img.pixels) if (p >= 0) filled++;
      if (filled >= img.pixels.length * 0.95) filledOk++;
    }
    // Confirmed 2026-09-02: 2,263 candidates, 2,237 (98.9%) >=95% filled.
    // Guard against regression rather than pinning the exact count, since
    // the >=95% threshold is a heuristic gate, not a hard structural fact.
    expect(candidates).toBeGreaterThan(2000);
    expect(filledOk / candidates).toBeGreaterThan(0.95);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { adfBootblockType, listAdf } from '@seer-project/amiga';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg1, ensureDungeonDecompressed } from '../../../shared/dungeonmaster-codec.ts';
import { findDungeonDataOffsets, parseDungeon } from '../../../shared/dungeonmaster-dungeon.ts';

const DATA_DIR = 'data/chaosstrikesback/amiga';
const HAS_CORPUS = existsSync(resolve(DATA_DIR, 'disk1/Graphics.DAT'));
const RAW_DISK3 = 'data/_unexplored_/ChaosStrikesBack/Disk.3';

describe.skipIf(!HAS_CORPUS)('Chaos Strikes Back (Amiga), real corpus', () => {
  it('disk1/Dungeon.DAT (Prison) decompresses and parses to 2 maps', () => {
    const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk1/Dungeon.DAT')));
    const d = ensureDungeonDecompressed(raw);
    const parsed = parseDungeon(d);
    expect(parsed.header.mapCount).toBe(2);
    expect(parsed.maps).toHaveLength(2);
  });

  it('locates exactly one Dungeon Data section in disk2/MINI.DAT, matching the 11-map main dungeon', () => {
    const mini = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk2/MINI.DAT')));
    const offsets = findDungeonDataOffsets(mini);
    expect(offsets).toEqual([10098]);
    const parsed = parseDungeon(mini.subarray(offsets[0]!));
    expect(parsed.header.mapCount).toBe(11);
    expect(parsed.maps).toHaveLength(11);
  });

  it('disk1/Graphics.DAT: every image-shaped IMG1 item decodes with 0 residue (DMCSB2 container)', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk1/Graphics.DAT')));
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMCSB2');
    expect(df.itemCount).toBe(749); // same container shape/item count as DM1's own Graphics.DAT
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
    // Confirmed 2026-09-02: 683/683, same as DM1's Graphics.DAT — the
    // truncation bug fix (see docs/chaosstrikesback/amiga/data-structure.md)
    // is what raised this from 23 to 683; guard against a regression.
    expect(imageItems).toBe(683);
  });

  it.skipIf(!existsSync(resolve(RAW_DISK3)))('Disk.3 is a real, valid, but blank/formatted (0-file) AmigaDOS filesystem', () => {
    const data = new Uint8Array(readFileSync(resolve(RAW_DISK3)));
    const boot = adfBootblockType(data);
    expect(boot).not.toBe('NDOS');
    expect(boot).not.toBe('KICK');
    const entries = listAdf(data);
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(0);
  });
});

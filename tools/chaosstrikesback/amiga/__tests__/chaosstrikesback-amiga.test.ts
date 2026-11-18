import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { adfBootblockType, listAdf } from '@seer-project/amiga';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg4Checked, isImg1Image, ensureDungeonDecompressed } from '../../../shared/dungeonmaster-codec.ts';
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
    // Forward section walk lands exactly on Map Data; trailer = 16-bit byte sum (0x939F).
    expect(parsed.forwardTilingExact).toBe(true);
    expect(parsed.checksum).toEqual({ stored: 0x939f, computed: 0x939f, valid: true });
    expect(parsed.mapOffsetsMatchCursor).toBe(true);
  });

  it('locates exactly one Dungeon Data section in disk2/MINI.DAT, matching the 11-map main dungeon', () => {
    const mini = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk2/MINI.DAT')));
    const offsets = findDungeonDataOffsets(mini);
    expect(offsets).toEqual([10098]);
    const parsed = parseDungeon(mini.subarray(offsets[0]!));
    expect(parsed.header.mapCount).toBe(11);
    expect(parsed.maps).toHaveLength(11);
    // Seed-agnostic: unique by exact forward tiling + checksum, ending exactly at EOF.
    expect(parsed.header.counts.projectiles).toBe(60);
    expect(parsed.header.counts.explosions).toBe(50);
    expect(parsed.forwardTilingExact).toBe(true);
    expect(offsets[0]! + parsed.mapDataOffset + parsed.header.mapDataSize + 2).toBe(mini.length);
    expect(parsed.checksum?.valid).toBe(true);
    // Null control: one flipped byte inside the dungeon removes the (only) hit.
    const bad = mini.slice();
    bad[offsets[0]! + 100] ^= 0x01;
    expect(findDungeonDataOffsets(bad)).toEqual([]);
  });

  it('disk1/Graphics.DAT: IMG1 classification by exact stream consumption (687 images; item 672 is data)', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'disk1/Graphics.DAT')));
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMCSB2');
    expect(df.itemCount).toBe(749); // same container shape/item count as DM1's own Graphics.DAT
    const images: number[] = [];
    for (const item of df.items) if (isImg1Image(readItem(data, item))) images.push(item.index);
    // 2026-11 audit: 687, not the earlier "683/683" (that count came from a
    // size filter and a w*h assertion that could never fail). The ADF-truncation
    // fix is still real: the container tiles exactly and the images consume exactly.
    expect(images).toHaveLength(687);
    for (const full of [1, 4, 5, 728, 738]) expect(images).toContain(full);
    expect(images).not.toContain(672);
    // Null control: the DM2 IMG4+trailer grammar must tile almost none of them.
    let wrong = 0;
    for (const i of images) if (decodeImg4Checked(readItem(data, df.items[i]!))) wrong++;
    expect(wrong).toBeLessThan(images.length * 0.05);
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

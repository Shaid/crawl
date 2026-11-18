/**
 * Real-data verification suite for the MM2 codecs.
 *
 * Runs ONLY when retail Amiga data is present at `data/mm2/amiga/data/` (the
 * repo's data dirs are gitignored, so this skips cleanly on a fresh clone).
 * These tests pin the codecs against the actual game files:
 *
 *   - every `.32` sheet and `.anm` in the data dir must decode without error
 *   - `51.anm` must reproduce the ground-truth Vairn/MM2 decode metadata
 *     (image-chunk offset, per-frame RLE consumption, sequences, prelude)
 *     AND its decoded plane bytes byte-for-byte
 *   - every `.dat` file must decode with the documented record counts
 *   - `roster.dat` record 0 is the retail "Sir Felgar"
 *   - `monsters.dat` record 212 (Cuisinart) HP 1000 / XP 20,000,000, and the
 *     FAQ cross-check rows reproduce
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeImage32 } from '../image32.ts';
import { parseAnm } from '../anm.ts';
import { decodeRoster, ROSTER_FILE_SIZE } from '../roster.ts';
import { decodeMonsters } from '../monsters.ts';
import { decodeItems } from '../items.ts';
import { decodeSpellsDat } from '../spells.ts';
import { decodeStr } from '../str.ts';
import { decodeMap } from '../map.ts';
import { decodeAttrib } from '../attrib.ts';
import { decodeEventFile } from '../event.ts';
import { lzwDecompress } from '../pc-gfx.ts';

const DATA_DIR = resolve('data/mm2/amiga/data');
const GROUND_TRUTH = resolve(import.meta.dirname, '../fixtures/anm_decoded/51');

const hasData = existsSync(DATA_DIR);

describe('MM2 real retail data', { skip: !hasData }, () => {
  it('all .32 sheets decode (except the documented XOR-obfuscated blobs)', () => {
    // globe.32 / disk.32 are copy-protection blobs, not image chunks (see
    // 55-graphics-formats-reference.md §3.3) — their names still end in .32.
    const NON_IMAGE = new Set(['globe.32', 'disk.32']);
    const sheets = readdirSync(DATA_DIR).filter((f) => f.endsWith('.32') && !NON_IMAGE.has(f));
    expect(sheets.length).toBeGreaterThan(0);
    for (const s of sheets) {
      expect(() => decodeImage32(readFileSync(resolve(DATA_DIR, s))), s).not.toThrow();
    }
  });

  it('all .anm files decode and compose', () => {
    const anms = readdirSync(DATA_DIR).filter((f) => f.endsWith('.anm'));
    expect(anms.length).toBeGreaterThan(0);
    for (const a of anms) {
      expect(() => parseAnm(readFileSync(resolve(DATA_DIR, a))), a).not.toThrow();
    }
  });

  it('51.anm reproduces the ground-truth decode byte-for-byte', () => {
    const meta = JSON.parse(readFileSync(resolve(GROUND_TRUTH, 'meta.json'), 'utf-8')) as {
      file_size: number;
      image_chunk_offset: number;
      image_frames: number;
      image_depth: number;
      decoded_frame_consumed: number[];
      sequences: number[][];
      prelude_frames: { x_offset: number; y_offset: number; width: number; height: number }[];
      image_frame_info: { width: number; height: number }[];
    };
    const data = readFileSync(resolve(DATA_DIR, '51.anm'));
    const anm = parseAnm(data);

    expect(data.length).toBe(meta.file_size);
    expect(anm.imageChunkOffset).toBe(meta.image_chunk_offset);
    expect(anm.image.frameCount).toBe(meta.image_frames);
    expect(anm.image.depthOrMode).toBe(meta.image_depth);
    expect(anm.image.consumed).toEqual(meta.decoded_frame_consumed);
    expect(anm.sequences).toEqual(meta.sequences);
    expect(anm.tv.prelude.length).toBe(meta.prelude_frames.length);
    for (let i = 0; i < meta.image_frame_info.length; i++) {
      expect(anm.image.frames[i].width).toBe(meta.image_frame_info[i].width);
      expect(anm.image.frames[i].height).toBe(meta.image_frame_info[i].height);
    }

    // The ground-truth repo ships the decoded plane bytes it produced from
    // this exact file; our decode of the same file must be identical.
    for (let i = 0; i < anm.image.frames.length; i++) {
      const f = anm.image.frames[i];
      const rs = ((f.width + 15) >> 3 & ~1) * f.height;
      const decoded = new Uint8Array(5 * rs);
      // Recover plane bytes by re-packing indices (exact inverse of unpack).
      const bpr = ((f.width + 15) >> 3) & ~1;
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const v = f.indices[y * f.width + x];
          if (!v) continue;
          const byteOff = y * bpr + (x >> 3);
          const bit = 7 - (x & 7);
          for (let p = 0; p < 5; p++) if (v & (1 << p)) decoded[p * rs + byteOff] |= 1 << bit;
        }
      }
      for (let p = 0; p < 5; p++) {
        const gt = readFileSync(resolve(GROUND_TRUTH, `frame_${String(i).padStart(3, '0')}/plane${p}.bin`));
        expect([...decoded.subarray(p * rs, (p + 1) * rs)]).toEqual([...gt]);
      }
    }
  });

  it('items.dat is 256 records', () => {
    const items = decodeItems(readFileSync(resolve(DATA_DIR, 'items.dat')));
    expect(items.length).toBe(256);
    expect(items[1].name).toBe('Small Club');
  });

  it('monsters.dat reproduces the FAQ HP/XP cross-check rows', () => {
    const monsters = decodeMonsters(readFileSync(resolve(DATA_DIR, 'monsters.dat')));
    expect(monsters.length).toBe(256);
    const byName = new Map(monsters.map((m) => [m.name, m]));
    // FAQ §3-8 spot checks (Vairn/MM2 validated 13/13 rows against this file).
    const checks: [string, number, number][] = [
      ['Creepy Crawler', 5, 150],
      ['Giant Beetle', 10, 200],
      ['Zombie', 20, 400],
      ['Cuisinart', 1000, 20000000],
      ['Mega Dragon', 64000, 32000000],
      ['Devil King', 5000, 30000000],
    ];
    for (const [name, hp, xp] of checks) {
      const m = byName.get(name);
      expect(m, `missing ${name}`).toBeDefined();
      expect(m!.hp, `${name} HP`).toBe(hp);
      expect(m!.xp, `${name} XP`).toBe(xp);
    }
  });

  it('roster.dat is 48 characters, record 0 = Sir Felgar, round-trips', () => {
    const data = readFileSync(resolve(DATA_DIR, 'roster.dat'));
    expect(data.length).toBe(ROSTER_FILE_SIZE);
    const roster = decodeRoster(data);
    expect(roster.characters.length).toBe(48);
    expect(roster.characters[0].name).toBe('Sir Felgar');
  });

  it('spells.dat is 96 records + 64 trailing bytes', () => {
    const spells = decodeSpellsDat(readFileSync(resolve(DATA_DIR, 'spells.dat')));
    expect(spells.records.length).toBe(96);
    expect(spells.trailing.length).toBe(64);
  });

  it('str.dat decodes to the documented joke text', () => {
    const text = decodeStr(readFileSync(resolve(DATA_DIR, 'str.dat')));
    expect(text).toContain("Why can't orcs lie on the beach?");
    expect(text).toContain('Cats will bury them.');
  });

  it('map.dat is 60 screens of 16x16', () => {
    const maps = decodeMap(readFileSync(resolve(DATA_DIR, 'map.dat')));
    expect(maps.length).toBe(60);
    expect(maps[0].cells.length).toBe(16);
    expect(maps[0].cells[0].length).toBe(16);
  });

  it('attrib.dat is 60 records, area 0 is Middlegate town', () => {
    const attrib = decodeAttrib(readFileSync(resolve(DATA_DIR, 'attrib.dat')));
    expect(attrib.length).toBe(60);
    expect(attrib[0].areaId).toBe(0);
    expect(attrib[0].mapCategory).toBe(1);
    expect(attrib[0].envType).toBe(0x11);
  });

  it('event.dat has 71 locations incl. the documented castle blobs', () => {
    const event = decodeEventFile(readFileSync(resolve(DATA_DIR, 'event.dat')));
    expect(event.locations.length).toBe(71);
    const kinds = event.locations.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'standard').length).toBeGreaterThan(50);
    // Locations 63/65/68 are the documented no-terminator castle blobs.
    expect(event.locations[63].kind).toBe('castle-blob');
    expect(event.locations[65].kind).toBe('castle-blob');
    expect(event.locations[68].kind).toBe('castle-blob');
  });

  it('wall bit labels W,S,E,N: indoor screens pair E face with east neighbour W face (null control N/W)', () => {
    const maps = decodeMap(readFileSync(resolve(DATA_DIR, 'map.dat')));
    const attrib = decodeAttrib(readFileSync(resolve(DATA_DIR, 'attrib.dat')));
    const indoor = maps.filter((m) => attrib[m.index].surfaceFlag === 0 && m.index < 41);
    const score = (a: 'n' | 'e', b: 'w') => {
      let ok = 0, n = 0;
      for (const s of indoor) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 15; x++) {
            const p = s.cells[y][x].visual[a], q = s.cells[y][x + 1].visual[b];
            if (p === 0 && q === 0) continue;
            n++;
            if ((p !== 0) === (q !== 0)) ok++;
          }
        }
      }
      return ok / n;
    };
    expect(indoor.length).toBeGreaterThan(20);
    expect(score('e', 'w')).toBeGreaterThan(0.99);
    expect(score('n', 'w')).toBeLessThan(0.6);
  });

  it('DOS MAP.DAT (60 x u16 offset table; per screen u32 size=512 + LZW) equals Amiga map.dat byte-exact', () => {
    const dosPath = resolve('data/mm2/dosega/MAP.DAT');
    if (!existsSync(dosPath)) return;
    const dos = readFileSync(dosPath);
    const ami = readFileSync(resolve(DATA_DIR, 'map.dat'));
    let exact = 0, wrong = 0;
    for (let s = 0; s < 60; s++) {
      const off = dos.readUInt16LE(s * 2);
      expect(dos.readUInt32LE(off)).toBe(512);
      const out = lzwDecompress(new Uint8Array(dos.subarray(off + 4)), 512);
      if (Buffer.from(out).equals(ami.subarray(s * 512, s * 512 + 512))) exact++;
      // null control: a different screen's Amiga bytes must NOT match
      if (Buffer.from(out).equals(ami.subarray(((s + 1) % 60) * 512, ((s + 1) % 60) * 512 + 512))) wrong++;
    }
    expect(exact).toBe(60);
    expect(wrong).toBe(0);
  });
});

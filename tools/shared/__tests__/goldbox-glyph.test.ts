/**
 * Gold Box Forgotten Realms (Amiga) 8x8 glyph format — regression + oracle.
 *
 * The 2026-11 audit found the shipped "1bpp, 8 bytes per tile" reading wrong
 * in all four titles: a glyph is a multi-plane 8x8 image. Oracle used here:
 * SEAM CONTINUITY — in a wall view adjacent tile cells are neighbouring
 * pieces of one picture, so the colour of a glyph's right edge column
 * should equal the next glyph's left edge column far more often than for a
 * random pair. Reported as lift = (observed - null) / (1 - null), with a
 * null measured from random glyph pairs in the same bank, and a control
 * (the old plane-0-only 1bpp reading) that must collapse.
 *
 * Skipped when the original game data is not present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGlibIndex, findBlockById, parseGlibContainer, readBlock } from '../goldbox-glib.ts';
import { decompressGlibBlock, loadGlibFile } from '../goldbox-glib-codecs.ts';
import {
  buildEntryTileBank,
  decodeGlibGlyph,
  decodeGlibTileBucket,
  decodeWallSlices,
  SLICES_PER_WALLSET,
  type WallSlice,
} from '../goldbox-walltiles.ts';
import { decodePorGlyphs, openTileBanks } from '../../poolofradiance/amiga/walldef.ts';
import { decompressDaxEntry, readDaxDirectory } from '../../poolofradiance/amiga/dax.ts';

const DATA = resolve(__dirname, '../../../data');
const have = (p: string) => existsSync(resolve(DATA, p));

/** Seam agreement (fraction of edge pixels equal across adjacent cells) of a set of (slice, bank) pairs; `rnd` swaps both cells for random glyphs of the bank. */
function seam(items: { slice: WallSlice; bank: Uint8Array[] }[], rnd: boolean): number {
  let eq = 0;
  let tot = 0;
  let seed = 12345;
  const R = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (const { slice, bank } of items) {
    for (const v of slice.views) {
      const g = v.tileIndices;
      for (let r = 0; r < v.rows; r++) {
        for (let c = 0; c < v.cols; c++) {
          for (const [dr, dc] of [[0, 1], [1, 0]]) {
            if (r + dr >= v.rows || c + dc >= v.cols) continue;
            let a = g[r][c];
            let b = g[r + dr][c + dc];
            if (!a || !b || a >= bank.length || b >= bank.length) continue;
            if (rnd) {
              a = 1 + (R() % (bank.length - 1));
              b = 1 + (R() % (bank.length - 1));
            }
            for (let k = 0; k < 8; k++) {
              if (dc ? bank[a][k * 8 + 7] === bank[b][k * 8] : bank[a][56 + k] === bank[b][k]) eq++;
              tot++;
            }
          }
        }
      }
    }
  }
  return eq / Math.max(tot, 1);
}
const lift = (obs: number, nul: number) => {
  if (process.env.GLYPH_VERBOSE) console.log(`seam obs=${obs.toFixed(3)} null=${nul.toFixed(3)} lift=${((obs - nul) / (1 - nul)).toFixed(3)}`);
  return (obs - nul) / (1 - nul);
};

function glibItems(walldef: string, specific: string, universal?: string) {
  const w = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, walldef))));
  const s = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, specific))));
  const sindex = decodeGlibIndex(s.data, s.container);
  let universalTiles: Uint8Array[] = [];
  if (universal) {
    const u = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, universal))));
    const ub = findBlockById(u.container, decodeGlibIndex(u.data, u.container), 203);
    universalTiles = ub ? decodeGlibTileBucket(u.data, ub) : [];
  }
  const lookup = (id: number) => {
    const b = findBlockById(s.container, sindex, id);
    return b ? decodeGlibTileBucket(s.data, b) : undefined;
  };
  const items: { slice: WallSlice; bank: Uint8Array[] }[] = [];
  for (const { id, blockIndex } of decodeGlibIndex(w.data, w.container)) {
    const slices = decodeWallSlices(readBlock(w.data, w.container.blocks[blockIndex]));
    const bank = buildEntryTileBank(universalTiles, id, Math.ceil(slices.length / SLICES_PER_WALLSET), lookup);
    if (bank.length) for (const slice of slices) items.push({ slice, bank });
  }
  return items;
}

/** Glyph-grammar census over every nested TILE sub-block of every .TLB/.GLB in a tree. */
function glyphCensus(files: string[]) {
  let glyphs = 0;
  let palettes = 0;
  let other = 0;
  for (const f of files) {
    const { data, container } = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, f))));
    for (const b of container.blocks) {
      const bytes = readBlock(data, b);
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'GLIB') continue;
      const sub = parseGlibContainer(decompressGlibBlock(data, b), 0);
      if (sub.tag !== 'TILE') continue;
      const img = decompressGlibBlock(data, b);
      for (const sb of sub.blocks) {
        const raw = readBlock(img, sb);
        if (decodeGlibGlyph(raw)) glyphs++;
        else if (raw.length >= 2 && raw[0] === 0 && raw[1] === 0) palettes++;
        else other++;
      }
    }
  }
  return { glyphs, palettes, other };
}

const TITLES = [
  { name: 'Curse', wd: 'curseoftheazurebonds/amiga/DISKB/WALLDEF.GLB', sp: 'curseoftheazurebonds/amiga/DISKB/8X8D.TLB', un: 'curseoftheazurebonds/amiga/DISKA/8X8D.TLB' },
  { name: 'Secret', wd: 'secretofthesilverblades/amiga/DISK2/WALLDEF.GLB', sp: 'secretofthesilverblades/amiga/DISK2/8X8D.TLB', un: 'secretofthesilverblades/amiga/DISK1/8X8D.TLB' },
];

describe('GLIB 8x8 glyph decode', () => {
  it('parses a hand-built 5-plane glyph block (synthetic, plane-major MSB-first)', () => {
    const blk = new Uint8Array(8 + 5 * 8);
    blk.set([0, 8, 0, 0, 0, 0, 1, 1]);
    blk[8 + 0] = 0x80; // plane 0, row 0, leftmost pixel
    blk[8 + 4 * 8 + 7] = 0x01; // plane 4, row 7, rightmost pixel
    const g = decodeGlibGlyph(blk)!;
    expect(g.planes).toBe(5);
    expect(g.tile[0]).toBe(Math.round(255 / 31)); // index 1
    expect(g.tile[63]).toBe(Math.round((16 * 255) / 31)); // index 16
    expect(g.tile.filter((v) => v !== 0).length).toBe(2);
  });

  it('rejects a palette block (height 0) and a 1bpp-sized block', () => {
    const pal = new Uint8Array(104);
    expect(decodeGlibGlyph(pal)).toBeUndefined();
    expect(decodeGlibGlyph(new Uint8Array([0, 8, 0, 0, 0, 0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeUndefined();
  });

  for (const t of TITLES) {
    it.skipIf(!have(t.wd) || !have(t.sp))(`${t.name}: seam-continuity lift is high and collapses under the null / old 1bpp reading`, () => {
      const items = glibItems(t.wd, t.sp, t.un);
      const obs = seam(items, false);
      const nul = seam(items, true);
      expect(lift(obs, nul)).toBeGreaterThan(0.35); // measured 0.47 (Curse) / 0.45 (Secret)
      // Control: the same views against a bank shifted by one glyph (wrong alignment) must be far worse.
      const shiftedItems = items.map(({ slice, bank }) => ({ slice, bank: [bank[0], ...bank.slice(2), bank[1]] }));
      const oldLift = lift(seam(shiftedItems, false), seam(shiftedItems, true));
      expect(oldLift).toBeLessThan(lift(obs, nul) - 0.2);
    });
  }

  it.skipIf(!have('curseoftheazurebonds/amiga/DISKB/8X8D.TLB'))('Curse glyph grammar: every non-palette TILE sub-block is a glyph', () => {
    const c = glyphCensus(['curseoftheazurebonds/amiga/DISKA/8X8D.TLB', 'curseoftheazurebonds/amiga/DISKB/8X8D.TLB']);
    expect(c.other).toBe(0);
    expect(c.glyphs).toBe(20 + 45 + 18 * 70); // 202 + 203 + 18 wallsets of 70 (audit: 1325/1325)
  });

  it.skipIf(!have('poolsofdarkness/amiga/Disk2/WALLDEF.GLB'))('Pools: bank n indexes glyph n directly (no placeholder shift) — higher lift than the shifted alignment', () => {
    const w = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, 'poolsofdarkness/amiga/Disk2/WALLDEF.GLB'))));
    const s = loadGlibFile(new Uint8Array(readFileSync(resolve(DATA, 'poolsofdarkness/amiga/Disk2/8X8D.TLB'))));
    const sindex = decodeGlibIndex(s.data, s.container);
    const direct: { slice: WallSlice; bank: Uint8Array[] }[] = [];
    const shifted: { slice: WallSlice; bank: Uint8Array[] }[] = [];
    for (const { id, blockIndex } of decodeGlibIndex(w.data, w.container)) {
      const sb = findBlockById(s.container, sindex, id);
      if (!sb) continue;
      const glyphs = decodeGlibTileBucket(s.data, sb);
      expect(glyphs.length).toBe(256);
      for (const slice of decodeWallSlices(readBlock(w.data, w.container.blocks[blockIndex]))) {
        direct.push({ slice, bank: glyphs });
        shifted.push({ slice, bank: [new Uint8Array(64).fill(128), ...glyphs] });
      }
    }
    const ld = lift(seam(direct, false), seam(direct, true));
    const ls = lift(seam(shifted, false), seam(shifted, true));
    expect(ld).toBeGreaterThan(0.35); // measured 0.40
    expect(ls).toBeLessThan(ld - 0.1); // measured 0.17-0.21 shifted
  });
});

describe('PoR 8x8d.dax glyph decode', () => {
  const dax = resolve(DATA, 'poolofradiance/amiga/8x8d.dax');
  const wd = resolve(DATA, 'poolofradiance/amiga/walldef.dax');
  it.skipIf(!existsSync(dax))('all 23 entries satisfy len == 12 + count*16*4 and the universal bank ends in zero padding', () => {
    const data = new Uint8Array(readFileSync(dax));
    const { entries } = readDaxDirectory(data);
    expect(entries.length).toBe(23);
    for (const e of entries) expect(() => decodePorGlyphs(decompressDaxEntry(data, e))).not.toThrow();
    const banks = openTileBanks(data);
    expect(banks.universal.length).toBe(45);
    const u = entries.find((e) => e.indexID === 203)!;
    const all = decodePorGlyphs(decompressDaxEntry(data, u));
    expect(all.length).toBe(46);
    expect(all[45].every((v) => v === 0)).toBe(true);
    expect(() => decodePorGlyphs(decompressDaxEntry(data, u).subarray(1))).toThrow(); // null control: misaligned
  });

  it.skipIf(!existsSync(dax) || !existsSync(wd))('seam-continuity lift on the real walldef views', () => {
    const data = new Uint8Array(readFileSync(dax));
    const wdata = new Uint8Array(readFileSync(wd));
    const banks = openTileBanks(data);
    const items: { slice: WallSlice; bank: Uint8Array[] }[] = [];
    for (const e of readDaxDirectory(wdata).entries) {
      const slices = decodeWallSlices(decompressDaxEntry(wdata, e));
      const bank = buildEntryTileBank(banks.universal, e.indexID, Math.ceil(slices.length / SLICES_PER_WALLSET), banks.lookup);
      if (bank.length) for (const slice of slices) items.push({ slice, bank });
    }
    expect(lift(seam(items, false), seam(items, true))).toBeGreaterThan(0.35); // audit: 0.46
  });
});

describe('PoR image/animation grammar (por-image-grammar)', () => {
  const dir = resolve(DATA, 'poolofradiance/amiga');
  const FILES = ['8x8d', 'pic', 'cpic', 'sprit', 'cbody', 'head', 'body', 'chead', 'comspr', 'final', 'icon', 'dungcom', 'wildcom', 'randcom', 'bacpac', 'sqrpaci'];
  it.skipIf(!existsSync(dir))('every entry of the 16 image-class files is an IMAGE or ANIMATION that tiles it exactly (audit: 511/511)', async () => {
    const { classifyPorEntry } = await import('../../poolofradiance/amiga/image.ts');
    let n = 0;
    let bad = 0;
    for (const f of FILES) {
      const data = new Uint8Array(readFileSync(resolve(dir, `${f}.dax`)));
      for (const e of readDaxDirectory(data).entries) {
        n++;
        if (classifyPorEntry(decompressDaxEntry(data, e)).kind === 'other') bad++;
      }
    }
    expect(n).toBe(511);
    expect(bad).toBe(0);
  });

  it.skipIf(!existsSync(dir))('dungcom is 13 frames of 48x24 and a one-byte-shifted entry is rejected (null control)', async () => {
    const { classifyPorEntry } = await import('../../poolofradiance/amiga/image.ts');
    const data = new Uint8Array(readFileSync(resolve(dir, 'dungcom.dax')));
    const e = readDaxDirectory(data).entries[0];
    const raw = decompressDaxEntry(data, e);
    const k = classifyPorEntry(raw);
    expect(k.kind).toBe('image');
    if (k.kind === 'image') {
      expect([k.image.count, k.image.wBytes * 8, k.image.h]).toEqual([13, 48, 24]);
      expect(raw.length).toBe(12 + 13 * 144 * 4);
    }
    expect(classifyPorEntry(raw.subarray(1)).kind).toBe('other');
  });
});

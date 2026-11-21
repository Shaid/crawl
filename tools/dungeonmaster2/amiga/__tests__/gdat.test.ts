import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import {
  catalogueIndex, decodePicture, decodeText, parseCatalogue, parseRects, parseUnderlays, PictureBank, resolveRect,
  placeImage, type RectRec,
} from '../gdat.ts';
import { parseSkulFtl, readViewportTables } from '../skul-ftl.ts';

const enc = (s: string) => Uint8Array.from([...s, '\0'].map((c, i) => (0xff - c.charCodeAt(0) - i) & 0xff));

describe('DM2 GRAPHICS.DAT layer (synthetic)', () => {
  it('text: byte i = 0xFF - ch - i, NUL-terminated; plain XOR with 0xFF-i is a wrong decode', () => {
    expect(Array.from(enc('OK'))).toEqual([0xb0, 0xb3, 0xfd]);
    expect(decodeText(enc("THAT'S NOT THE MASTER DISK!"))).toBe("THAT'S NOT THE MASTER DISK!");
    const xorDecode = (b: Uint8Array) => Array.from(b, (v, i) => String.fromCharCode(v ^ (0xff - i))).join('');
    expect(xorDecode(enc("THAT'S NOT"))).not.toContain("THAT'S NOT");
  });

  it('rects: box/frame/anchor chain, edge anchors and a placed box', () => {
    const r = new Map<number, RectRec>([
      [3, { kind: 9, parent: 0, a: 224, b: 136 }],
      [4, { kind: 1, parent: 3, a: 0, b: 0 }],
      [702, { kind: 0, parent: 4, a: 112, b: 68 }],
      [703, { kind: 18, parent: 4, a: 0, b: 0 }],
      [704, { kind: 16, parent: 4, a: 0, b: 0 }],
      [140, { kind: 9, parent: 4, a: 96, b: 87 }],
      [151, { kind: 5, parent: 140, a: 112, b: 15 }],
      [3790, { kind: 1, parent: 151, a: 0, b: 0 }],
    ]);
    expect(resolveRect(r, 702)).toEqual({ x: 112, y: 68, align: 0 });
    expect(resolveRect(r, 703)).toEqual({ x: 0, y: 68, align: 8 });
    expect(resolveRect(r, 704)).toEqual({ x: 223, y: 68, align: 6 });
    expect(resolveRect(r, 3790)).toEqual({ x: 64, y: 15, align: 1 }); // 96-wide box, top-centre at x=112
    // a 33x136 left wall hugs x=0; the mirrored right one ends at x=223
    expect(placeImage(resolveRect(r, 703), 33, 136)).toEqual([0, 0]);
    expect(placeImage(resolveRect(r, 704), 33, 136)).toEqual([191, 0]);
  });

  it('picture codec: palette runs, copy-up, literal, and overlay selector 5 keeps the underlay', () => {
    // 4x2 base: palette 1,2,3,4,5,6 ; row0 = run(4) of sel0 ; row1 = copy-up x2, literal 9, sel1
    // nibbles: [1..6] [8,2]=run 4 sel0, [E,0]=copy-up x2, [7,9]=literal 9, [1]=sel1, pad
    const base = Uint8Array.from([0, 4, 0, 2, 0x12, 0x34, 0x56, 0x82, 0xe0, 0x79, 0x10, ...new Array(16).fill(0)]);
    const b = decodePicture(base);
    expect(Array.from(b.pixels)).toEqual([1, 1, 1, 1, 1, 1, 9, 2]);
    // overlay: 5-nibble palette 7,7,7,7,7 ; [D,4]=run6 sel5 (keep) ; [0][0]=sel0 x2
    const ov = Uint8Array.from([0, 4, 0, 2, 0x77, 0x77, 0x7d, 0x40, 0x00, ...new Array(16).fill(0)]);
    const o = decodePicture(ov, b);
    expect(Array.from(o.pixels)).toEqual([1, 1, 1, 1, 1, 1, 7, 7]);
    // the same bytes read as a 6-nibble base image do not reproduce it
    expect(Array.from(decodePicture(ov).pixels)).not.toEqual(Array.from(o.pixels));
  });

  it('picture header: top 6 bits of w/h are signed offsets', () => {
    const p = decodePicture(Uint8Array.from([0xfc, 1, 0x04, 1, 0x11, 0x11, 0x10, 0, ...new Array(16).fill(0)]));
    expect([p.width, p.height, p.offX, p.offY]).toEqual([1, 1, -1, 1]);
  });
});

const DIR = resolve('data', 'dungeonmaster2', 'amiga');
const HAVE = existsSync(resolve(DIR, 'GRAPHICS.DAT')) && existsSync(resolve(DIR, 'SKUL.FTL'));

describe.skipIf(!HAVE)('DM2 real GRAPHICS.DAT / SKUL.FTL', () => {
  const gfx = HAVE ? new Uint8Array(readFileSync(resolve(DIR, 'GRAPHICS.DAT'))) : new Uint8Array();
  const df = HAVE ? parseDataFileHeader(gfx) : null!;
  const item = (i: number) => readItem(gfx, df.items[i]!);

  it('catalogue: 10,045 records; category 26 holds the dialog texts in 3 languages', () => {
    const cat = parseCatalogue(item(0));
    expect(cat.length).toBe(10045);
    const t = (S: number, F: number) => decodeText(item(cat.find((r) => r.T === 26 && r.I === 0 && r.D === 5 && r.S === S && r.F === F)!.P));
    expect(t(20, 16)).toBe("THAT'S NOT THE MASTER DISK!");
    expect(t(20, 48)).toBe('DAS IST NICHT DIE MASTER-DISKETTE!');
    expect(t(20, 64)).toBe('CE N\'EST PAS LA DISQUETTE PRINCIPALE!');
  });

  it('every catalogued image tiles exactly with the underlay rule (5-nibble iff in the underlay table); 6-nibble-for-all control fails', () => {
    const cat = parseCatalogue(item(0));
    const und = parseUnderlays(item(cat.find((r) => r.T === 0 && r.D === 8)!.P));
    const imgs = [...new Set(cat.filter((r) => r.D === 1).map((r) => r.P))];
    const tiles = (b: Uint8Array, pal: number) => {
      let nib = 8;
      const rd = () => { const v = nib & 1 ? b[nib >> 1]! & 15 : b[nib >> 1]! >> 4; nib++; return v; };
      const total = (((b[0]! << 8) | b[1]!) & 0x3ff) * (((b[2]! << 8) | b[3]!) & 0x3ff);
      for (let i = 0; i < pal; i++) rd();
      let pos = 0;
      while (pos < total && nib < b.length * 2) {
        const c = rd();
        if ((c & 7) === 7) rd();
        if (c & 8) { const a = rd(); if (a === 15) { const v = (rd() << 4) | rd(); pos += v === 0xff ? (rd() << 12) | (rd() << 8) | (rd() << 4) | rd() : v + 17; } else pos += a + 2; } else pos++;
      }
      const end = (b.length - 16) * 2;
      return pos === total && (end - nib === 0 || end - nib === 1);
    };
    let ok = 0, control = 0, overlays = 0;
    for (const i of imgs) {
      const b = item(i);
      if (tiles(b, und.has(i) ? 5 : 6)) ok++;
      if (und.has(i)) { overlays++; if (tiles(b, 6)) control++; }
    }
    expect(imgs.length).toBe(3011);
    expect(ok).toBe(3011);
    expect(overlays).toBe(1010);
    expect(control).toBeLessThan(100);
  });

  it('rect table tiles item 243; viewport cell rects resolve inside the 224x136 view', () => {
    const cat = parseCatalogue(item(0));
    const rects = parseRects(item(catalogueIndex(cat).get('1:0:4:0')!.P));
    expect(rects.size).toBe(2183);
    expect(rects.get(3)).toEqual({ kind: 9, parent: 0, a: 224, b: 136 });
    for (let id = 702; id <= 722; id++) {
      const rr = resolveRect(rects, id);
      expect(rr.x).toBeGreaterThanOrEqual(-8);
      expect(rr.x).toBeLessThanOrEqual(231);
      expect(rr.y).toBeGreaterThanOrEqual(0);
      expect(rr.y).toBeLessThan(136);
    }
  });

  it('wallset pictures decode through the bank (D1 front wall of wallset 1 is 172x120)', () => {
    const cat = parseCatalogue(item(0));
    const idx = catalogueIndex(cat);
    const bank = new PictureBank(item, parseUnderlays(item(cat.find((r) => r.T === 0 && r.D === 8)!.P)));
    const p = bank.get(idx.get('8:1:1:37')!.P);
    expect([p.width, p.height]).toEqual([172, 120]);
    expect(p.pixels.every((v) => v >= 0 && v < 16)).toBe(true);
  });

  it('SKUL.FTL: DATA expands to the below-A5 size; viewport tables are self-consistent', () => {
    const img = parseSkulFtl(new Uint8Array(readFileSync(resolve(DIR, 'SKUL.FTL'))));
    expect(img.belowA5).toBe(0x617e);
    expect(img.jumpTable.length).toBe(648);
    const t = readViewportTables(img);
    expect([...t.drawOrder].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // far to near: forward distance never increases along the draw order
    for (let i = 1; i < 20; i++) expect(t.yDist[t.drawOrder[i]!]!).toBeLessThanOrEqual(t.yDist[t.drawOrder[i - 1]!]!);
    // the flip partner is an involution that mirrors the lateral distance
    for (let c = 0; c < 23; c++) {
      expect(t.flipPartner[t.flipPartner[c]!]).toBe(c);
      expect(t.xDist[t.flipPartner[c]!]! + t.xDist[c]!).toBe(0);
    }
    expect(t.doorRect[3]).toBe(3790);
  });
});

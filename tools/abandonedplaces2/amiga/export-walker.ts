/**
 * Abandoned Places 2 (Amiga): walker data. Emits to public/assets/abandonedplaces2/amiga/walker/:
 *   tables.json      view/slot tables read from the unpacked `main` (HUNK offsets = code offsets)
 *   levels.json      28 levels: theme, palette set, per-family tileset names, cells, decor/gate/stairs lists
 *   res/<base>.json  per-triplet record images as SCREEN values 0..63 (image planes remapped the way the
 *                    game's view-buffer descriptors do it; padded to 8*bytesPerRow, 255 = transparent)
 *   pal/set_NN.json  64-entry screen palettes: set_NN[0..15] + display.clr[16..31] + EHB halves (§5.1)
 *   npx tsx tools/abandonedplaces2/amiga/export-walker.ts
 * Spec: docs/abandonedplaces2/amiga/data-structure.md §6 (renderer).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { decodeRecord, parseDef, readClr } from '../../shared/artgame-tileset.ts';
import { unpackAll } from '../../abandonedplaces/unpack.ts';
import { planeMapFor, screenPalette, toScreenIndex } from './screen-palette.ts';

const GAME = 'abandonedplaces2';
const PLATFORM = 'amiga';
const HUNK_CODE = 0x20; // file offset of hunk 0 data in `main`

/** Family order of the 16-word theme rows at hunk+0x16EC8 (loader 0x1247A). */
export const FAMILY_ORDER = ['wl', 'fl', 'pit', 'obj1', 'obj2', 'obj3', 'onwl1', 'onwl2', 'stru', 'strd', 'mon1', 'mon2', 'gt', 'sww', 'swg', 'swp'];
const FAMILY_PREFIX = (f: string) => f.replace(/\d$/, '');

export function readTables(main: Uint8Array) {
  const code = main.subarray(HUNK_CODE);
  const dv = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const u8 = (a: number, n: number) => Array.from(code.subarray(a, a + n));
  const s8 = (a: number, n: number) => u8(a, n).map((v) => (v > 127 ? v - 256 : v));
  const s16 = (a: number, n: number) => Array.from({ length: n }, (_, i) => dv.getInt16(a + i * 2));
  const u16 = (a: number, n: number) => Array.from({ length: n }, (_, i) => dv.getUint16(a + i * 2));
  return {
    viewOffsets: s8(0x15806, 4 * 5 * 8), // [row][lat][facing][dx,dy]
    rot: u8(0x158a6, 16), // [facing][side] -> (side-facing)&3
    faceSlots: u8(0x15eb6, 80), // [row*5+lat][4]
    faceTemplate: u8(0x15f06, 216), // 72 x (kind,id1,id2)
    slotDest: s16(0x15fde, 144), // 72 x (x,y)
    decorSlot: s8(0x160fe, 80), // [cell*4+rot]
    decorPair: u8(0x1614e, 144), // 72 x (kind,rec)
    pitA: u8(0x16446, 40), pitB: u8(0x1646e, 40), pitADest: s16(0x16676, 40), pitBDest: s16(0x166c6, 40),
    gateFace: u8(0x16496, 40), gateEdge: u8(0x164be, 40), gateBars: u8(0x164e6, 40),
    gateFaceDest: s16(0x16766, 40), gateEdgeDest: s16(0x167b6, 40), gateBarsDest: s16(0x16806, 40),
    gateOrient: u8(0x6bd4, 8),
    levelTheme: u16(0x170a4, 28), themeSet: u16(0x17088, 14),
    themeRows: Array.from({ length: 14 }, (_, r) => u16(0x16ec8 + 32 * r, 16)),
  };
}

function b64(a: Uint8Array): string { return Buffer.from(a).toString('base64'); }

export function parseLevel(d: Uint8Array) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const W = dv.getUint16(0), H = dv.getUint16(2);
  const offs = Array.from({ length: 10 }, (_, i) => dv.getUint32(4 + i * 4));
  const list = (i: number, stride: number): number[][] => {
    const out: number[][] = [];
    for (let a = offs[i]; a + stride <= offs[i + 1]; a += stride) {
      const first = dv.getUint16(a);
      if (first === 0xffff) break;
      if (first === 0) continue;
      out.push(Array.from({ length: stride / 2 }, (_, k) => dv.getUint16(a + k * 2)));
    }
    return out;
  };
  return {
    w: W, h: H, cells: b64(d.subarray(offs[0], offs[0] + W * H * 8)),
    decor: list(5, 8).map((r) => ({ type: r[0], x: r[1], y: r[2], side: r[3] })),
    gates: list(4, 10).map((r) => ({ type: r[0], x: r[1], y: r[2], state: r[3], orient: r[4] })),
    stairs: list(7, 12).map((r) => ({ kind: r[0], x: r[1], y: r[2], dx: r[3], dy: r[4], level: r[5] })),
  };
}

export function exportWalker(): { levels: number; res: number } {
  const { dir: cache } = unpackAll(GAME);
  const root = resolve(assetRoot(GAME, PLATFORM), 'walker');
  mkdirSync(resolve(root, 'res'), { recursive: true });
  mkdirSync(resolve(root, 'pal'), { recursive: true });
  const tables = readTables(new Uint8Array(readFileSync(resolve(cache, 'main'))));
  writeJson(resolve(root, 'tables.json'), tables, false);

  const needed = new Set<string>();
  const levels = [];
  for (let n = 0; n < 28; n++) {
    const theme = tables.levelTheme[n];
    const row = tables.themeRows[theme];
    const fam: Record<string, string | null> = {};
    FAMILY_ORDER.forEach((f, i) => {
      if (!['wl', 'fl', 'pit', 'onwl1', 'onwl2', 'stru', 'strd', 'gt'].includes(f)) return;
      const base = `${FAMILY_PREFIX(f)}_${String(row[i]).padStart(2, '0')}`;
      const real = existsSync(resolve(cache, `${base}.def`)) && row[i] !== 99;
      fam[f] = real ? base : null;
      if (real) needed.add(base);
    });
    const set = tables.themeSet[theme];
    levels.push({ id: n, theme, set, families: fam, ...parseLevel(new Uint8Array(readFileSync(resolve(cache, `dng_${String(n).padStart(2, '0')}.dat`)))) });
    needed.add(`set:${set}`);
  }
  writeJson(resolve(root, 'levels.json'), levels, false);

  let res = 0;
  for (const base of needed) {
    if (base.startsWith('set:')) {
      const nn = base.slice(4).padStart(2, '0');
      const pal = screenPalette(
        readClr(new Uint8Array(readFileSync(resolve(cache, `set_${nn}.clr`)))),
        readClr(new Uint8Array(readFileSync(resolve(cache, 'display.clr')))),
      );
      writeJson(resolve(root, 'pal', `set_${nn}.json`), pal.map((c) => [c.r, c.g, c.b]), false);
      continue;
    }
    const bpl = new Uint8Array(readFileSync(resolve(cache, `${base}.bpl`)));
    const ofsP = resolve(cache, `${base}.ofs`);
    const recs = parseDef(new Uint8Array(readFileSync(resolve(cache, `${base}.def`))), existsSync(ofsP) ? new Uint8Array(readFileSync(ofsP)) : null, bpl.length);
    const map = planeMapFor(base);
    const out = recs.map((r) => {
      if (r.empty || r.offset + r.planeSize * (r.planes + (r.hasMask ? 1 : 0)) > bpl.length) return null;
      const pw = r.bytesPerRow * 8;
      const img = decodeRecord(bpl, { ...r, w: pw });
      const pix = new Uint8Array(pw * r.h);
      for (let i = 0; i < pix.length; i++) pix[i] = img.mask && !img.mask[i] ? 255 : toScreenIndex(img.indices[i] & 31, map);
      return { w: r.w, h: r.h, pw, x: r.x, y: r.y, fw: r.frameW, fh: r.frameH, masked: r.hasMask, pix: b64(pix) };
    });
    writeJson(resolve(root, 'res', `${base}.json`), { recs: out }, false);
    res++;
  }
  return { levels: levels.length, res };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportWalker();
  console.log(`${GAME}/${PLATFORM} walker: ${r.levels} levels, ${r.res} resource files`);
}

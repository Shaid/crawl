/**
 * Dungeon Master II (Amiga) viewport asset exporter.
 *
 * Emits `public/assets/dungeonmaster2/amiga/data/viewport.json`:
 *  - the viewport cell tables read from SKUL.FTL's initialised data
 *    (`skul-ftl.ts`: lateral/forward distance per cell, flip partner, draw order);
 *  - the viewport rectangles (GRAPHICS.DAT rect table, ids 700-722) resolved to
 *    anchor points (`gdat.ts` `resolveRect`);
 *  - per wallset (catalogue category 8, item = the map's `mapGraphicsStyle`):
 *    the 16-colour IRGB palette banks (D=9), colour key (D=11 S=100), scene
 *    flags (D=11 S=101), and the floor (S=0), ceiling (S=1) and wall (S=35-50)
 *    pictures as packed colour nibbles with their draw offsets.
 *
 * Usage: `npx tsx tools/dungeonmaster2/amiga/export-viewport.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { parseDataFileHeader, readItem } from '../../shared/dungeonmaster-container.ts';
import {
  catalogueIndex, DT, parseCatalogue, parseIrgbBanks, parseRects, parseUnderlays, PictureBank, resolveRect,
  type CatRecord, type ResolvedRect,
} from './gdat.ts';
import { parseSkulFtl, readViewportTables, type ViewportTables } from './skul-ftl.ts';

export const CAT_WALLSET = 8;
/**
 * Floor, ceiling, the 16 wall pieces (cell + 0x22 for cells 1-15, 0x32 for every D4 cell),
 * the side-on door frame (6), door pillars (7-16, 211-216) and door roof slits (18-23).
 */
export const WALLSET_PIECES = [
  0, 1, ...Array.from({ length: 16 }, (_, i) => 35 + i), ...Array.from({ length: 11 }, (_, i) => 6 + i),
  ...Array.from({ length: 6 }, (_, i) => 18 + i), ...Array.from({ length: 6 }, (_, i) => 211 + i),
];
/** Creature/object rect id: 5000 + cell*25 + 5x5 position (facing-relative position, party facing 0). */
export const creatureRect = (cell: number, pos: number) => 5000 + cell * 25 + pos;
export const RECT_CEILING = 700;
export const RECT_FLOOR = 701;
export const RECT_CELL_BASE = 702;

export interface VpPiece { w: number; h: number; offX: number; offY: number; /** base64, 2 nibbles per byte, high nibble first, rows packed w wide */ px: string }

export interface VpWallset {
  id: number;
  /** IRGB banks (16 colours each); bank 0 = full light. */
  palettes: Array<Array<[number, number, number]>>;
  colorKey: number;
  sceneFlags: number;
  pieces: Record<string, VpPiece>;
}

export interface VpDoorType {
  id: number;
  colorKey: number;
  /** Door word S=0x40: non-zero = this door type has no frame pillars / slit. */
  noFrames: boolean;
  /** S = forward distance - 1 (D1-D3 panels) */
  pieces: Record<string, VpPiece>;
}

export interface ViewportAsset {
  tables: ViewportTables;
  rects: Record<string, ResolvedRect>;
  wallsets: Record<string, VpWallset>;
  doors: Record<string, VpDoorType>;
}

export const CAT_DOOR = 14;

function packNibbles(px: Int16Array): string {
  const out = Buffer.alloc((px.length + 1) >> 1);
  for (let i = 0; i < px.length; i++) {
    const v = px[i]! < 0 ? 0 : px[i]! & 15;
    out[i >> 1]! |= i & 1 ? v : v << 4;
  }
  return out.toString('base64');
}

export function buildViewportAsset(graphicsDat: Uint8Array, skulFtl: Uint8Array): ViewportAsset {
  const df = parseDataFileHeader(graphicsDat);
  const item = (i: number) => readItem(graphicsDat, df.items[i]!);
  const cat = parseCatalogue(item(0));
  const idx = catalogueIndex(cat);
  const get = (T: number, I: number, D: number, S: number): CatRecord | undefined => idx.get(`${T}:${I}:${D}:${S}`);
  const rectItem = get(1, 0, DT.RECTS, 0);
  const underItem = cat.find((r) => r.T === 0 && r.D === 8);
  if (!rectItem || !underItem) throw new Error('GRAPHICS.DAT: rect table / underlay table not in catalogue');
  const rects = parseRects(item(rectItem.P));
  const bank = new PictureBank(item, parseUnderlays(item(underItem.P)));
  const tables = readViewportTables(parseSkulFtl(skulFtl));

  const rectOut: Record<string, ResolvedRect> = {};
  for (const id of [RECT_CEILING, RECT_FLOOR, ...Array.from({ length: 21 }, (_, i) => RECT_CELL_BASE + i)]) rectOut[id] = resolveRect(rects, id);
  for (const id of tables.doorRect) if (id >= 0) rectOut[id] = resolveRect(rects, id);
  for (const id of tables.slitRect) if (id > 0) rectOut[id] = resolveRect(rects, id);
  for (let cell = 0; cell < 16; cell++) for (const pos of [2, 10, 14]) { const id = creatureRect(cell, pos); rectOut[id] = resolveRect(rects, id); }

  const signedPair = (v: number): [number, number] => {
    const x = (v >> 8) & 0xff, y = v & 0xff;
    return [x > 127 ? x - 256 : x, y > 127 ? y - 256 : y];
  };
  const piece = (T: number, I: number, S: number, setOffset: [number, number]): VpPiece | undefined => {
    const r = get(T, I, DT.IMAGE, S);
    if (!r) return undefined;
    const pic = bank.get(r.P);
    let [ox, oy] = [pic.offX, pic.offY === -32 ? 0 : pic.offY];
    if (pic.offX === -32) { const o = get(T, I, DT.OFFSET, S); [ox, oy] = o ? signedPair(o.P) : [0, 0]; }
    return { w: pic.width, h: pic.height, offX: ox + setOffset[0], offY: oy + setOffset[1], px: packNibbles(pic.pixels) };
  };
  const wallsets: Record<string, VpWallset> = {};
  const ids = [...new Set(cat.filter((r) => r.T === CAT_WALLSET && r.D === DT.IMAGE).map((r) => r.I))].filter((i) => i < 0xfe);
  for (const I of ids) {
    const palRec = get(CAT_WALLSET, I, DT.PALETTE, 0);
    if (!palRec) continue;
    const setOff = get(CAT_WALLSET, I, DT.OFFSET, 0xfe);
    const [sx, sy] = setOff ? signedPair(setOff.P) : [0, 0];
    const pieces: Record<string, VpPiece> = {};
    for (const S of WALLSET_PIECES) {
      const p = piece(CAT_WALLSET, I, S, [sx, sy]);
      if (p) pieces[S] = p;
    }
    wallsets[I] = {
      id: I,
      palettes: parseIrgbBanks(item(palRec.P)),
      colorKey: get(CAT_WALLSET, I, DT.WORD, 100)?.P ?? -1,
      sceneFlags: get(CAT_WALLSET, I, DT.WORD, 101)?.P ?? 0,
      pieces,
    };
  }
  // Door panels: category 14, item = the map's door type; S = distance-1. Colour key
  // = word S=4, 10 when absent (CODE+0x17996 moves #10 on a zero result).
  const doors: Record<string, VpDoorType> = {};
  const doorIds = [...new Set(cat.filter((r) => r.T === CAT_DOOR && r.D === DT.IMAGE).map((r) => r.I))].filter((i) => i < 0xfe);
  for (const I of doorIds) {
    const setOff = get(CAT_DOOR, I, DT.OFFSET, 0xfe);
    const off: [number, number] = setOff ? signedPair(setOff.P) : [0, 0];
    const pieces: Record<string, VpPiece> = {};
    for (const S of [0, 1, 2]) {
      const p = piece(CAT_DOOR, I, S, off);
      if (p) pieces[S] = p;
    }
    doors[I] = { id: I, colorKey: get(CAT_DOOR, I, DT.WORD, 4)?.P || 10, noFrames: (get(CAT_DOOR, I, DT.WORD, 0x40)?.P ?? 0) !== 0, pieces };
  }
  return { tables, rects: rectOut, wallsets, doors };
}

/** Read GRAPHICS.DAT + SKUL.FTL, write `viewport.json` (compact); returns wallset / door-type counts. */
export function exportViewport(dataDir = resolve('data', 'dungeonmaster2', 'amiga')): { wallsets: number; doors: number } {
  const asset = buildViewportAsset(new Uint8Array(readFileSync(resolve(dataDir, 'GRAPHICS.DAT'))), new Uint8Array(readFileSync(resolve(dataDir, 'SKUL.FTL'))));
  writeJson(resolve(assetDir('data', 'dungeonmaster2', 'amiga'), 'viewport.json'), asset, false);
  return { wallsets: Object.keys(asset.wallsets).length, doors: Object.keys(asset.doors).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportViewport();
  console.log(`viewport.json: ${r.wallsets} wallsets, ${r.doors} door types`);
}
